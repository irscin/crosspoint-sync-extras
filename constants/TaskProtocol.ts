// BLE task-sync protocol. Must match the firmware (cross: src/network/TaskBleService.h,
// src/util/TaskSync.h) and docs/ble-tasks.md there.
export const TASK_SERVICE_UUID = '6f1a0001-5c7e-4b8a-9d3e-2a4c8f1b7e01';
export const TASK_RX_UUID = '6f1a0002-5c7e-4b8a-9d3e-2a4c8f1b7e01'; // phone -> device (write)
export const TASK_TX_UUID = '6f1a0003-5c7e-4b8a-9d3e-2a4c8f1b7e01'; // device -> phone (notify)

export const TASK_PROTOCOL_VERSION = 1;
export const TASK_MAX_MESSAGE = 4096;
export const TASK_FRAME_FIRST = 0x01;
export const TASK_FRAME_LAST = 0x02;
export const TASK_PREFERRED_MTU = 185;
/** ATT payload when no larger MTU was negotiated (MTU 23 minus the 3-byte header). */
export const TASK_DEFAULT_FRAME_BYTES = 20;

export const TASK_SCAN_TIMEOUT_MS = 15_000;
export const TASK_REQUEST_TIMEOUT_MS = 8_000;
export const TASK_MAX_TITLE_BYTES = 96;
export const TASK_MAX_NOTE_BYTES = 120;
/**
 * The pairing code is not a constant: the device reads it from /.crosspoint/phone-sync-code.txt
 * (random if missing) and shows it on its Phone sync screen; the user types it into the app once.
 * It keeps stray apps out but does not stop a determined attacker within Bluetooth range.
 */
export const TASK_CODE_MAX_CHARS = 32;
/** Service discovery right after connecting can come back empty; try again a few times. */
export const TASK_DISCOVERY_ATTEMPTS = 4;
export const TASK_DISCOVERY_RETRY_MS = 1_000;
