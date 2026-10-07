#!/usr/bin/env npx tsx
/**
 * BLE task protocol codec test. The firmware side (cross test/task_sync) checks the same
 * framing rules; keep the two in step.
 *
 * Usage: npx tsx scripts/task-protocol-test.ts
 */
import assert from 'node:assert/strict';
import {
  Reassembler,
  base64Decode,
  base64Encode,
  clipUtf8,
  describeTaskError,
  encodeRequest,
  parseSnapshot,
  toFrames,
  utf8Decode,
  utf8Encode,
} from '../services/task-protocol';

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const rebuild = (frames: number[][]) => {
  const r = new Reassembler();
  let result = 'need_more';
  for (const f of frames) result = r.push(f);
  assert.equal(result, 'complete');
  return r.message;
};

test('single frame carries FIRST|LAST', () => {
  const frames = toFrames('hello', 20);
  assert.equal(frames.length, 1);
  assert.equal(frames[0][0], 0x03);
  assert.equal(rebuild(frames), 'hello');
});

test('long message splits into <=20 byte frames and rebuilds', () => {
  const message = Array.from({ length: 1000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
  const frames = toFrames(message, 20);
  assert.equal(frames.length, Math.ceil(1000 / 19));
  assert.ok(frames.every((f) => f.length <= 20));
  assert.equal(rebuild(frames), message);
});

test('empty message still sends one frame', () => {
  const frames = toFrames('', 20);
  assert.equal(frames.length, 1);
  assert.equal(rebuild(frames), '');
});

test('multi-byte characters survive framing at any split', () => {
  const message = '{"title":"Café ☕ 重点 😀"}';
  for (const size of [2, 3, 4, 7, 20]) assert.equal(rebuild(toFrames(message, size)), message);
});

test('continuation without a start is rejected', () => {
  assert.equal(new Reassembler().push([0x02, 120]), 'error');
});

test('a new FIRST frame drops a half-finished message', () => {
  const r = new Reassembler();
  assert.equal(r.push([0x01, 111, 108, 100]), 'need_more');
  assert.equal(r.push([0x03, 110, 101, 119]), 'complete');
  assert.equal(r.message, 'new');
});

test('oversized message is dropped', () => {
  const r = new Reassembler();
  assert.equal(r.push([0x01, ...new Array(4096).fill(120)]), 'need_more');
  assert.equal(r.push([0x02, 121]), 'error');
});

test('utf8 and base64 round trip', () => {
  const text = 'añb☕😀';
  assert.equal(utf8Decode(utf8Encode(text)), text);
  for (const n of [0, 1, 2, 3, 4, 5, 19, 20]) {
    const bytes = Array.from({ length: n }, (_, i) => (i * 37) & 0xff);
    assert.deepEqual(base64Decode(base64Encode(bytes)), bytes);
  }
  assert.equal(base64Encode(utf8Encode('Man')), 'TWFu');
  assert.equal(base64Encode(utf8Encode('Ma')), 'TWE=');
});

test('clipUtf8 never splits a character', () => {
  assert.equal(clipUtf8('éééé', 5), 'éé');
  assert.equal(clipUtf8('abc', 10), 'abc');
});

test('requests encode as the firmware expects', () => {
  assert.equal(encodeRequest({ cmd: 'list' }), '{"cmd":"list"}');
  assert.deepEqual(JSON.parse(encodeRequest({ cmd: 'toggle', id: 't1', done: true })), {
    cmd: 'toggle',
    id: 't1',
    done: true,
  });
});

test('parses a firmware snapshot', () => {
  const snap = parseSnapshot(
    '{"v":1,"ok":true,"cap":10,"items":[{"id":"t1","title":"One","note":"","done":false},{"id":"t2","title":"Two","note":"n","done":true}]}',
  );
  assert.ok(snap);
  assert.equal(snap!.items.length, 2);
  assert.equal(snap!.items[1].done, true);
  assert.equal(snap!.cap, 10);
});

test('error replies still carry the list', () => {
  const snap = parseSnapshot('{"v":1,"ok":false,"err":"full","cap":10,"items":[]}');
  assert.equal(snap!.ok, false);
  assert.equal(snap!.err, 'full');
  assert.match(describeTaskError(snap!.err), /full/);
});

test('rejects garbage', () => {
  assert.equal(parseSnapshot('nope'), null);
  assert.equal(parseSnapshot('{"ok":true}'), null);
});

test('set request encodes ids only for known items', () => {
  const json = encodeRequest({
    cmd: 'set',
    items: [
      { id: 't1', title: 'One', note: '', done: true },
      { title: 'New', note: '', done: false },
    ],
  });
  const parsed = JSON.parse(json);
  assert.equal(parsed.cmd, 'set');
  assert.equal(parsed.items[0].id, 't1');
  assert.equal('id' in parsed.items[1], false);
});

test('ten full-length tasks fit in one message', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({
    id: `t${i}`,
    title: 'x'.repeat(96),
    note: 'y'.repeat(120),
    done: false,
  }));
  const message = encodeRequest({ cmd: 'set', items });
  assert.ok(utf8Encode(message).length <= 4096, `${utf8Encode(message).length} bytes`);
});

test('auth is the first message and carries the typed code', () => {
  assert.deepEqual(JSON.parse(encodeRequest({ cmd: 'auth', code: '482916' })), { cmd: 'auth', code: '482916' });
});

test('auth failures read clearly', () => {
  assert.match(describeTaskError('bad_code'), /pairing code/i);
  assert.match(describeTaskError('unauthorized'), /did not accept/i);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
