#!/usr/bin/env npx tsx
/** Drag-and-drop reorder maths. Usage: npx tsx scripts/reorder-test.ts */
import assert from 'node:assert/strict';
import { dropIndex, moveItem, shiftFor, type RowBox } from '../utils/reorder';

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// Four rows: heights 50, 50, 80 (a wrapped title), 50.
const rows: RowBox[] = [
  { y: 0, h: 50 },
  { y: 50, h: 50 },
  { y: 100, h: 80 },
  { y: 180, h: 50 },
];

test('no movement keeps the row where it is', () => {
  for (let i = 0; i < rows.length; i++) assert.equal(dropIndex(rows, i, 0), i);
});

test('dragging down past the next row centre moves one place', () => {
  assert.equal(dropIndex(rows, 0, 20), 0); // centre 45, still inside row 0
  assert.equal(dropIndex(rows, 0, 40), 1); // centre 65, inside row 1
});

test('dragging up works the same way', () => {
  assert.equal(dropIndex(rows, 3, -50), 2); // centre 155, inside the tall row
  assert.equal(dropIndex(rows, 3, -120), 1); // centre 85
});

test('the target is clamped to the ends of the list', () => {
  assert.equal(dropIndex(rows, 1, -500), 0);
  assert.equal(dropIndex(rows, 1, 500), 3);
});

test('rows between the start and the target shift out of the way', () => {
  // Row 0 held over row 2: rows 1 and 2 move up by the dragged height.
  assert.deepEqual([0, 1, 2, 3].map((i) => shiftFor(i, 0, 2, 50)), [0, -50, -50, 0]);
  // Row 3 held over row 1: rows 1 and 2 move down.
  assert.deepEqual([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, 50)), [0, 50, 50, 0]);
  // Held over its own slot: nothing moves.
  assert.deepEqual([0, 1, 2, 3].map((i) => shiftFor(i, 2, 2, 80)), [0, 0, 0, 0]);
});

test('moveItem reorders without mutating', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(list, 3, 1), ['a', 'd', 'b', 'c']);
  assert.deepEqual(list, ['a', 'b', 'c', 'd']);
  assert.deepEqual(moveItem(list, 1, 1), list);
  assert.deepEqual(moveItem(list, 1, 9), list);
});

test('empty and single-row lists are safe', () => {
  assert.equal(dropIndex([], 0, 10), 0);
  assert.equal(dropIndex([{ y: 0, h: 40 }], 0, 300), 0);
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
