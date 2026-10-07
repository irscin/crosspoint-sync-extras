import {
  TASK_FRAME_FIRST,
  TASK_FRAME_LAST,
  TASK_MAX_MESSAGE,
} from '../constants/TaskProtocol';
import type { Task, TaskRequest, TaskSnapshot } from '../types/task';

/** UTF-8 encode without relying on TextEncoder being present in the JS engine. */
export function utf8Encode(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return out;
}

export function utf8Decode(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b < 0xe0) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((bytes[i] & 0x3f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else {
      cp =
        ((b & 0x07) << 18) | ((bytes[i] & 0x3f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

/** Cut text to at most maxBytes of UTF-8 without splitting a character. */
export function clipUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let out = '';
  for (const ch of text) {
    const size = utf8Encode(ch).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += ch;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** react-native-ble-plx moves characteristic values as base64 strings. */
export function base64Encode(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

export function base64Decode(text: string): number[] {
  const clean = text.replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return out;
}

/** Split a message into frames of at most maxFrameBytes (header byte included). */
export function toFrames(message: string, maxFrameBytes: number): number[][] {
  if (maxFrameBytes < 2) return [];
  const bytes = utf8Encode(message);
  const payload = maxFrameBytes - 1;
  const frames: number[][] = [];
  let offset = 0;
  do {
    const take = Math.min(payload, bytes.length - offset);
    let header = 0;
    if (offset === 0) header |= TASK_FRAME_FIRST;
    if (offset + take >= bytes.length) header |= TASK_FRAME_LAST;
    frames.push([header, ...bytes.slice(offset, offset + take)]);
    offset += take;
  } while (offset < bytes.length);
  return frames;
}

export type ReassemblyResult = 'need_more' | 'complete' | 'error';

/** Rebuilds device replies from notification frames; mirrors tasksync::Reassembler. */
export class Reassembler {
  private buffer: number[] = [];
  private active = false;
  message = '';

  reset() {
    this.buffer = [];
    this.active = false;
  }

  push(frame: ArrayLike<number>): ReassemblyResult {
    if (frame.length === 0) return 'error';
    const header = frame[0];
    if (header & TASK_FRAME_FIRST) {
      this.buffer = [];
      this.active = true;
    } else if (!this.active) {
      return 'error';
    }
    if (this.buffer.length + frame.length - 1 > TASK_MAX_MESSAGE) {
      this.reset();
      return 'error';
    }
    for (let i = 1; i < frame.length; i++) this.buffer.push(frame[i]);
    if (header & TASK_FRAME_LAST) {
      this.active = false;
      this.message = utf8Decode(this.buffer);
      return 'complete';
    }
    return 'need_more';
  }
}

export function encodeRequest(request: TaskRequest): string {
  return JSON.stringify(request);
}

function asTask(value: unknown): Task | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.title !== 'string') return null;
  return {
    id: v.id,
    title: v.title,
    note: typeof v.note === 'string' ? v.note : '',
    done: v.done === true,
  };
}

/** Parse a device reply; null when it is not a valid snapshot. */
export function parseSnapshot(json: string): TaskSnapshot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.ok !== 'boolean' || !Array.isArray(r.items)) return null;
  const items = r.items.map(asTask).filter((t): t is Task => t !== null);
  return {
    ok: r.ok,
    err: typeof r.err === 'string' ? r.err : undefined,
    cap: typeof r.cap === 'number' ? r.cap : 10,
    items,
  };
}

const ERROR_TEXT: Record<string, string> = {
  full: 'The device list is full.',
  not_found: 'That task is no longer on the device.',
  bad_request: 'The device rejected the request.',
  save_failed: 'The device could not save to its SD card.',
  unauthorized: 'The device did not accept this app.',
  bad_code: 'The device rejected the pairing code. Update the app and the firmware to matching versions.',
};

export function describeTaskError(err?: string): string {
  return (err && ERROR_TEXT[err]) || 'The device reported an error.';
}
