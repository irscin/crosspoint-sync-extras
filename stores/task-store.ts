import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { TASK_MAX_TITLE_BYTES } from '@/constants/TaskProtocol';
import { clipUtf8 } from '@/services/task-protocol';
import { moveItem } from '@/utils/reorder';
import type { DraftTask, TaskLinkStatus, TaskSnapshot } from '@/types/task';

export const TASK_LIMIT = 10;

let keyCounter = 0;
const newKey = () => `k${Date.now().toString(36)}${(keyCounter++).toString(36)}`;

interface TaskState {
  /** The list being edited on the phone; "Send to Device" overwrites the device's list with it. */
  draft: DraftTask[];
  deviceName: string | null;
  /** The code the device shows on its Phone sync screen (and keeps in /.crosspoint/phone-sync-code.txt). */
  pairingCode: string;
  /** When the draft last matched the device (after a send or a load). */
  syncedAt: number | null;
  /** Edits since the last send or load. */
  dirty: boolean;
  status: TaskLinkStatus;
  message: string | null;

  add: (title: string) => boolean;
  toggle: (key: string) => void;
  remove: (key: string) => void;
  /** Move the task at `from` to slot `to` (drag and drop). */
  reorder: (from: number, to: number) => void;
  /** Replace the draft with the device's list (after a send or a load). */
  setPairingCode: (code: string) => void;
  adoptSnapshot: (snapshot: TaskSnapshot, deviceName?: string) => void;
  setStatus: (status: TaskLinkStatus, message?: string | null) => void;
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      draft: [],
      deviceName: null,
      pairingCode: '',
      syncedAt: null,
      dirty: false,
      status: 'idle',
      message: null,

      add: (title) => {
        const clean = clipUtf8(title.trim(), TASK_MAX_TITLE_BYTES);
        if (!clean || get().draft.length >= TASK_LIMIT) return false;
        set((s) => ({ draft: [...s.draft, { key: newKey(), title: clean, note: '', done: false }], dirty: true }));
        return true;
      },
      toggle: (key) =>
        set((s) => ({ draft: s.draft.map((t) => (t.key === key ? { ...t, done: !t.done } : t)), dirty: true })),
      remove: (key) => set((s) => ({ draft: s.draft.filter((t) => t.key !== key), dirty: true })),
      reorder: (from, to) => set((s) => ({ draft: moveItem(s.draft, from, to), dirty: true })),
      setPairingCode: (code) => set({ pairingCode: code.replace(/[^A-Za-z0-9]/g, '').slice(0, 32) }),
      adoptSnapshot: (snapshot, deviceName) =>
        set((s) => ({
          draft: snapshot.items.map((t) => ({ key: newKey(), id: t.id, title: t.title, note: t.note, done: t.done })),
          deviceName: deviceName ?? s.deviceName,
          syncedAt: Date.now(),
          dirty: false,
        })),
      setStatus: (status, message = null) => set({ status, message }),
    }),
    {
      name: 'crosspointsync-tasks-v2',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ draft: s.draft, deviceName: s.deviceName, pairingCode: s.pairingCode, syncedAt: s.syncedAt, dirty: s.dirty }),
    },
  ),
);
