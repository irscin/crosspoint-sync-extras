/** One priority as the device stores it (see cross docs/ble-tasks.md). */
export interface Task {
  id: string;
  title: string;
  note: string;
  done: boolean;
}

/** Every device reply carries the full list, so any reply resyncs the app. */
export interface TaskSnapshot {
  ok: boolean;
  /** "full" | "not_found" | "bad_request" | "save_failed" when ok is false */
  err?: string;
  cap: number;
  items: Task[];
}

export type TaskRequest =
  /** Must be the first message on a connection; the device refuses everything else until it passes. */
  | { cmd: 'auth'; code: string }
  | { cmd: 'list' }
  | { cmd: 'add'; title: string; note?: string }
  | { cmd: 'toggle'; id: string; done: boolean }
  | { cmd: 'delete'; id: string }
  /** Replaces the device list in this order. Items without an id get one from the device. */
  | { cmd: 'set'; items: { id?: string; title: string; note?: string; done: boolean }[] };

/** A priority in the app's working copy; `id` is the device's id once it has been sent. */
export interface DraftTask {
  key: string;
  id?: string;
  title: string;
  note: string;
  done: boolean;
}

export type TaskLinkStatus = 'idle' | 'scanning' | 'connecting' | 'sending' | 'error';
