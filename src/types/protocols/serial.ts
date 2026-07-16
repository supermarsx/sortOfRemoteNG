/** Persisted and native-facing contract for local Serial / RS-232 sessions. */

export const SERIAL_SETTINGS_VERSION = 1 as const;

export const SERIAL_STANDARD_BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400,
  460800, 921600,
] as const;

export type SerialDataBits = "5" | "6" | "7" | "8";
export type SerialParity = "none" | "odd" | "even";
export type SerialStopBits = "1" | "2";
export type SerialFlowControl = "none" | "xonXoff" | "rtsCts";
export type SerialLineEnding = "none" | "cr" | "lf" | "crLf";

export interface SerialSettingsV1 {
  version: typeof SERIAL_SETTINGS_VERSION;
  portName: string;
  baudRate: number;
  dataBits: SerialDataBits;
  parity: SerialParity;
  stopBits: SerialStopBits;
  flowControl: SerialFlowControl;
  readTimeoutMs: number;
  writeTimeoutMs: number;
  rxBufferSize: number;
  txBufferSize: number;
  dtrOnOpen: boolean;
  rtsOnOpen: boolean;
  lineEnding: SerialLineEnding;
  charDelayMs: number;
  localEcho: boolean;
}

export const DEFAULT_SERIAL_SETTINGS: Readonly<SerialSettingsV1> =
  Object.freeze({
    version: SERIAL_SETTINGS_VERSION,
    portName: "",
    baudRate: 9600,
    dataBits: "8",
    parity: "none",
    stopBits: "1",
    flowControl: "none",
    readTimeoutMs: 100,
    writeTimeoutMs: 1000,
    rxBufferSize: 4096,
    txBufferSize: 4096,
    dtrOnOpen: true,
    rtsOnOpen: true,
    lineEnding: "crLf",
    charDelayMs: 0,
    localEcho: false,
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value.trim() : fallback;

const boundedInteger = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, Math.round(numeric)))
    : fallback;
};

const enumValue = <T extends string>(
  value: unknown,
  supported: readonly T[],
  fallback: T,
): T => (supported.includes(value as T) ? (value as T) : fallback);

export function normalizeSerialSettings(value: unknown): SerialSettingsV1 {
  const input = isRecord(value) ? value : {};
  return {
    version: SERIAL_SETTINGS_VERSION,
    portName: stringValue(
      input.portName ?? input.device ?? input.serialLine,
      DEFAULT_SERIAL_SETTINGS.portName,
    ),
    baudRate: boundedInteger(
      input.baudRate ?? input.serialSpeed,
      DEFAULT_SERIAL_SETTINGS.baudRate,
      1,
      4_000_000,
    ),
    dataBits: enumValue(
      String(input.dataBits ?? ""),
      ["5", "6", "7", "8"],
      DEFAULT_SERIAL_SETTINGS.dataBits,
    ),
    // The native transport intentionally does not expose Mark/Space parity:
    // its driver maps both to None. Normalizing them avoids claiming support.
    parity: enumValue(
      input.parity,
      ["none", "odd", "even"],
      DEFAULT_SERIAL_SETTINGS.parity,
    ),
    // The serialport driver maps 1.5 stop bits to 2, so only exact modes are
    // persisted and advertised.
    stopBits: enumValue(
      String(input.stopBits ?? ""),
      ["1", "2"],
      DEFAULT_SERIAL_SETTINGS.stopBits,
    ),
    // DTR/DSR is mapped to generic hardware flow control by the backend and
    // is therefore not exposed as a distinct capability.
    flowControl: enumValue(
      input.flowControl,
      ["none", "xonXoff", "rtsCts"],
      DEFAULT_SERIAL_SETTINGS.flowControl,
    ),
    readTimeoutMs: boundedInteger(
      input.readTimeoutMs,
      DEFAULT_SERIAL_SETTINGS.readTimeoutMs,
      0,
      60_000,
    ),
    writeTimeoutMs: boundedInteger(
      input.writeTimeoutMs,
      DEFAULT_SERIAL_SETTINGS.writeTimeoutMs,
      0,
      60_000,
    ),
    rxBufferSize: boundedInteger(
      input.rxBufferSize,
      DEFAULT_SERIAL_SETTINGS.rxBufferSize,
      256,
      1_048_576,
    ),
    txBufferSize: boundedInteger(
      input.txBufferSize,
      DEFAULT_SERIAL_SETTINGS.txBufferSize,
      256,
      1_048_576,
    ),
    dtrOnOpen:
      typeof input.dtrOnOpen === "boolean"
        ? input.dtrOnOpen
        : DEFAULT_SERIAL_SETTINGS.dtrOnOpen,
    rtsOnOpen:
      typeof input.rtsOnOpen === "boolean"
        ? input.rtsOnOpen
        : DEFAULT_SERIAL_SETTINGS.rtsOnOpen,
    lineEnding: enumValue(
      input.lineEnding,
      ["none", "cr", "lf", "crLf"],
      DEFAULT_SERIAL_SETTINGS.lineEnding,
    ),
    charDelayMs: boundedInteger(
      input.charDelayMs,
      DEFAULT_SERIAL_SETTINGS.charDelayMs,
      0,
      10_000,
    ),
    localEcho:
      typeof input.localEcho === "boolean"
        ? input.localEcho
        : DEFAULT_SERIAL_SETTINGS.localEcho,
  };
}

export type NativeSerialBaudRate = string | { Custom: number };

export interface NativeSerialConfig {
  portName: string;
  baudRate: NativeSerialBaudRate;
  dataBits: SerialDataBits;
  parity: SerialParity;
  stopBits: SerialStopBits;
  flowControl: SerialFlowControl;
  readTimeoutMs: number;
  writeTimeoutMs: number;
  rxBufferSize: number;
  txBufferSize: number;
  dtrOnOpen: boolean;
  rtsOnOpen: boolean;
  lineEnding: SerialLineEnding;
  label: string | null;
  charDelayMs: number;
  localEcho: boolean;
}

export const toNativeSerialConfig = (
  value: unknown,
  label?: string,
): NativeSerialConfig => {
  const settings = normalizeSerialSettings(value);
  const standard = (SERIAL_STANDARD_BAUD_RATES as readonly number[]).includes(
    settings.baudRate,
  );
  return {
    portName: settings.portName,
    baudRate: standard
      ? String(settings.baudRate)
      : { Custom: settings.baudRate },
    dataBits: settings.dataBits,
    parity: settings.parity,
    stopBits: settings.stopBits,
    flowControl: settings.flowControl,
    readTimeoutMs: settings.readTimeoutMs,
    writeTimeoutMs: settings.writeTimeoutMs,
    rxBufferSize: settings.rxBufferSize,
    txBufferSize: settings.txBufferSize,
    dtrOnOpen: settings.dtrOnOpen,
    rtsOnOpen: settings.rtsOnOpen,
    lineEnding: settings.lineEnding,
    label: label?.trim() || null,
    charDelayMs: settings.charDelayMs,
    localEcho: settings.localEcho,
  };
};

export interface SerialControlLines {
  dtr: boolean;
  rts: boolean;
  cts: boolean;
  dsr: boolean;
  ri: boolean;
  dcd: boolean;
}

export interface SerialBackendSession {
  id: string;
  portName: string;
  configShorthand: string;
  state: "connecting" | "connected" | "disconnected" | "error";
  label: string | null;
  connectedAt: string;
  bytesRx: number;
  bytesTx: number;
  controlLines: SerialControlLines;
}

export interface SerialPortInfo {
  portName: string;
  portType: string;
  description: string | null;
  manufacturer: string | null;
  vid: number | null;
  pid: number | null;
  serialNumber: string | null;
  displayName: string;
  inUse: boolean;
}

export interface SerialScanResult {
  ports: SerialPortInfo[];
  scanTimeMs: number;
  totalFound: number;
}
