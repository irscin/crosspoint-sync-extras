import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, ScanMode, State, type Device, type Subscription } from 'react-native-ble-plx';

import {
  TASK_DEFAULT_FRAME_BYTES,
  TASK_DISCOVERY_ATTEMPTS,
  TASK_DISCOVERY_RETRY_MS,
  TASK_PREFERRED_MTU,
  TASK_REQUEST_TIMEOUT_MS,
  TASK_RX_UUID,
  TASK_SCAN_TIMEOUT_MS,
  TASK_SERVICE_UUID,
  TASK_TX_UUID,
} from '@/constants/TaskProtocol';
import type { TaskRequest, TaskSnapshot } from '@/types/task';

import {
  Reassembler,
  base64Decode,
  base64Encode,
  describeTaskError,
  encodeRequest,
  parseSnapshot,
  toFrames,
} from './task-protocol';

export interface FoundTaskDevice {
  id: string;
  name: string;
  rssi: number | null;
}

let manager: BleManager | null = null;
function getManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

/** Ask for the runtime Bluetooth permissions Android needs; iOS prompts on first use. */
export async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(result).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
  }
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

async function waitForPoweredOn(ble: BleManager, timeoutMs = 4000): Promise<boolean> {
  if ((await ble.state()) === State.PoweredOn) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.remove();
      resolve(false);
    }, timeoutMs);
    const sub = ble.onStateChange((state) => {
      if (state === State.PoweredOn) {
        clearTimeout(timer);
        sub.remove();
        resolve(true);
      }
    }, true);
  });
}

/**
 * A device this phone is already connected to (a link left over from an earlier attempt). A
 * connected device stops advertising, so a scan would never see it; reuse the link instead.
 */
export async function findConnectedTaskDevice(): Promise<FoundTaskDevice | null> {
  try {
    const devices = await getManager().connectedDevices([TASK_SERVICE_UUID]);
    const device = devices[0];
    return device ? { id: device.id, name: device.localName ?? device.name ?? 'CrossPoint', rssi: null } : null;
  } catch {
    return null;
  }
}

export interface TaskScanResult {
  /** Devices seen that did not advertise the task service, for the "not found" message. */
  otherDevices: number;
  /** Set when the scan itself failed (permissions, Bluetooth/location off, ...). */
  error?: string;
}

const SERVICE_UUID_LOWER = TASK_SERVICE_UUID.toLowerCase();

/**
 * Scan for the device advertising the task service (only while "Phone sync" is open on it). The
 * scan is not filtered by UUID: Android only applies such a filter to the advertisement, and the
 * match here also looks at the scan response. `done` resolves on stop() or after the timeout.
 */
export async function scanForTaskDevices(
  onFound: (device: FoundTaskDevice) => void,
  timeoutMs = TASK_SCAN_TIMEOUT_MS,
): Promise<{ stop: () => void; done: Promise<TaskScanResult> }> {
  const ble = getManager();
  if (!(await ensureBlePermissions())) throw new Error('Bluetooth permission was denied.');
  if (!(await waitForPoweredOn(ble))) throw new Error('Bluetooth is turned off.');

  const result: TaskScanResult = { otherDevices: 0 };
  let finish: (r: TaskScanResult) => void = () => {};
  const done = new Promise<TaskScanResult>((resolve) => {
    finish = resolve;
  });
  let finished = false;
  const stop = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    ble.stopDeviceScan();
    finish(result);
  };
  const timer = setTimeout(stop, timeoutMs);
  const seen = new Set<string>();
  ble.startDeviceScan(null, { allowDuplicates: true, scanMode: ScanMode.LowLatency }, (error, device) => {
    if (error) {
      result.error = error.message;
      stop();
      return;
    }
    if (!device) return;
    const advertised = (device.serviceUUIDs ?? []).some((u) => u.toLowerCase() === SERVICE_UUID_LOWER);
    if (!advertised) {
      if (!seen.has(device.id)) {
        seen.add(device.id);
        result.otherDevices++;
      }
      return;
    }
    onFound({ id: device.id, name: device.localName ?? device.name ?? 'CrossPoint', rssi: device.rssi });
  });
  return { stop, done };
}

/** One connection to the device, with request/response over the framed GATT characteristics. */
export class TaskBleLink {
  private device: Device | null = null;
  private notifySub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private reassembler = new Reassembler();
  private pending: {
    resolve: (snapshot: TaskSnapshot) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private frameBytes = TASK_DEFAULT_FRAME_BYTES;
  onDisconnected: (() => void) | null = null;

  get connected(): boolean {
    return this.device !== null;
  }

  async connect(deviceId: string, code: string): Promise<void> {
    const ble = getManager();
    if (!(await ensureBlePermissions())) throw new Error('Bluetooth permission was denied.');
    if (!(await waitForPoweredOn(ble))) throw new Error('Bluetooth is turned off.');
    await this.disconnect();

    // refreshGatt: the phone may hold a stale copy of this device's services from an earlier
    // firmware.
    const device = await ble.connectToDevice(deviceId, {
      timeout: 10_000,
      ...(Platform.OS === 'android' ? { refreshGatt: 'OnConnected' as const } : {}),
    });
    try {
      await this.openService(device);
      let negotiated: Device = device;
      if (Platform.OS === 'android') {
        try {
          negotiated = await device.requestMTU(TASK_PREFERRED_MTU);
        } catch {
          // Stay on the default MTU; frames shrink to 20 bytes.
        }
      }
      // iOS negotiates the MTU on its own and reports it on the device object.
      this.frameBytes = Math.max(TASK_DEFAULT_FRAME_BYTES, (negotiated.mtu ?? 23) - 3);
    } catch (error) {
      await device.cancelConnection().catch(() => undefined);
      throw error;
    }
    this.device = device;
    this.disconnectSub = device.onDisconnected(() => {
      this.teardown();
      this.onDisconnected?.();
    });
    // The device refuses everything until the first message proves we know its code.
    try {
      const reply = await this.request({ cmd: 'auth', code });
      if (!reply.ok) throw new Error(describeTaskError(reply.err));
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  /** Discover the task service and subscribe to replies. Discovery can come back empty right after connecting. */
  private async openService(device: Device): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < TASK_DISCOVERY_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, TASK_DISCOVERY_RETRY_MS));
      try {
        await device.discoverAllServicesAndCharacteristics();
        const services = await device.services();
        if (!services.some((svc) => svc.uuid.toLowerCase() === TASK_SERVICE_UUID.toLowerCase())) {
          throw new Error('The device does not offer the to-do service.');
        }
        this.notifySub?.remove();
        this.reassembler.reset();
        this.notifySub = device.monitorCharacteristicForService(TASK_SERVICE_UUID, TASK_TX_UUID, (error, chr) => {
          if (error || !chr?.value) return;
          this.onFrame(base64Decode(chr.value));
        });
        return;
      } catch (error) {
        lastError = error;
        this.notifySub?.remove();
        this.notifySub = null;
        if (!(await device.isConnected().catch(() => false))) throw new Error('The device disconnected.');
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Could not open the to-do service.');
  }

  async disconnect(): Promise<void> {
    const device = this.device;
    this.teardown();
    if (device) await device.cancelConnection().catch(() => undefined);
  }

  private teardown() {
    this.notifySub?.remove();
    this.disconnectSub?.remove();
    this.notifySub = null;
    this.disconnectSub = null;
    this.device = null;
    this.reassembler.reset();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('The device disconnected.'));
      this.pending = null;
    }
  }

  private onFrame(frame: number[]) {
    if (this.reassembler.push(frame) !== 'complete') return;
    const snapshot = parseSnapshot(this.reassembler.message);
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    if (snapshot) pending.resolve(snapshot);
    else pending.reject(new Error('The device sent an unreadable reply.'));
  }

  /** Requests run one at a time; the device answers each with a full snapshot. */
  request(request: TaskRequest): Promise<TaskSnapshot> {
    const run = () => this.send(request);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async send(request: TaskRequest): Promise<TaskSnapshot> {
    const device = this.device;
    if (!device) throw new Error('Not connected to a device.');
    const reply = new Promise<TaskSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('The device did not answer in time.'));
      }, TASK_REQUEST_TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
    });
    try {
      for (const frame of toFrames(encodeRequest(request), this.frameBytes)) {
        await device.writeCharacteristicWithResponseForService(TASK_SERVICE_UUID, TASK_RX_UUID, base64Encode(frame));
      }
    } catch (error) {
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending = null;
      }
      throw error;
    }
    return reply;
  }
}
