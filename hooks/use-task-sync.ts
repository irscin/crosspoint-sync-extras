import { useCallback, useEffect } from 'react';

import { TaskBleLink, findConnectedTaskDevice, scanForTaskDevices, type TaskScanResult } from '@/services/task-ble';
import { describeTaskError } from '@/services/task-protocol';
import { useTaskStore } from '@/stores/task-store';
import type { TaskRequest, TaskSnapshot } from '@/types/task';

// One link for the whole app: the device accepts a single phone at a time.
const link = new TaskBleLink();
const stopScan: { current: (() => void) | null } = { current: null };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Find the device (it advertises only while To-do list > Phone sync is open on it), pair, and run
 * one request. Always ends disconnected so the device is free for the next session.
 */
async function withDevice(
  request: (deviceName: string) => TaskRequest,
): Promise<{ snapshot: TaskSnapshot; deviceName: string } | { error: string }> {
  const { setStatus } = useTaskStore.getState();
  try {
    setStatus('scanning');
    const found: { id: string | null; name: string } = { id: null, name: 'CrossPoint' };
    const existing = await findConnectedTaskDevice();
    if (existing) {
      found.id = existing.id;
      found.name = existing.name;
    }
    const scan: { stop: () => void; done: Promise<TaskScanResult> } = existing
      ? { stop: () => {}, done: Promise.resolve({ otherDevices: 0 }) }
      : await scanForTaskDevices((device) => {
          if (found.id) return;
          found.id = device.id;
          found.name = device.name;
          stopScan.current?.();
        });
    stopScan.current = scan.stop;
    if (found.id) scan.stop(); // found before the handle above existed
    const scanResult = await scan.done;
    stopScan.current = null;
    if (scanResult.error) return { error: `Bluetooth scan failed: ${scanResult.error}` };
    if (!found.id) {
      return {
        error:
          `No device found (saw ${scanResult.otherDevices} other Bluetooth device${scanResult.otherDevices === 1 ? '' : 's'}). ` +
          'On the device open To-do list, then Phone sync, and keep it open. If the device says "Phone connected" ' +
          'before you tap Send, something else holds its only Bluetooth link: turn Bluetooth off and on, or wait 20 seconds.',
      };
    }
    const foundId = found.id;
    const foundName = found.name;

    setStatus('connecting');
    await link.connect(foundId, useTaskStore.getState().pairingCode);
    setStatus('sending');
    const snapshot = await link.request(request(foundName));
    return { snapshot, deviceName: foundName };
  } catch (e) {
    return { error: messageOf(e) };
  } finally {
    await link.disconnect();
  }
}

/** Phone-side priorities list and the two device actions: send the draft, or load the device's list. */
export function useTaskSync() {
  const draft = useTaskStore((s) => s.draft);
  const dirty = useTaskStore((s) => s.dirty);
  const status = useTaskStore((s) => s.status);
  const message = useTaskStore((s) => s.message);
  const deviceName = useTaskStore((s) => s.deviceName);
  const pairingCode = useTaskStore((s) => s.pairingCode);
  const syncedAt = useTaskStore((s) => s.syncedAt);

  useEffect(() => {
    link.onDisconnected = null;
  }, []);

  const run = useCallback(async (request: () => TaskRequest, success: string) => {
    const { setStatus, adoptSnapshot } = useTaskStore.getState();
    if (!useTaskStore.getState().pairingCode) {
      setStatus('error', 'Enter the pairing code shown on the device first.');
      return false;
    }
    const result = await withDevice(request);
    if ('error' in result) {
      setStatus('error', result.error);
      return false;
    }
    // The device's reply is its whole list, so the draft always ends up equal to what it holds.
    adoptSnapshot(result.snapshot, result.deviceName);
    if (!result.snapshot.ok) {
      setStatus('error', describeTaskError(result.snapshot.err));
      return false;
    }
    setStatus('idle', success);
    return true;
  }, []);

  const sendToDevice = useCallback(
    () =>
      run(
        () => ({
          cmd: 'set',
          items: useTaskStore.getState().draft.map((t) => ({ id: t.id, title: t.title, note: t.note, done: t.done })),
        }),
        'Sent to your device.',
      ),
    [run],
  );

  const loadFromDevice = useCallback(() => run(() => ({ cmd: 'list' }), 'Loaded from your device.'), [run]);

  const busy = status === 'scanning' || status === 'connecting' || status === 'sending';
  return { draft, dirty, status, message, deviceName, pairingCode, syncedAt, busy, sendToDevice, loadFromDevice };
}
