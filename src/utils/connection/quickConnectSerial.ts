/**
 * Quick Connect serial address parser.
 *
 * Accepted shapes (case-insensitive scheme and COM prefix):
 *   COM3, com3, COM3:115200, COM3:115200,8N1, \\.\COM12
 *   /dev/ttyUSB0, /dev/ttyACM0, /dev/cu.usbserial-1410, /dev/tty.usbmodem1
 *   serial://COM3?baud=9600&data=8&parity=none&stop=1&flow=none
 *   serial:///dev/ttyUSB0?baud=115200
 *
 * Only local device names are accepted: Windows COMn (1-256) and Unix
 * /dev/tty* or /dev/cu* nodes. Anything else (other /dev nodes, path
 * traversal, control characters, user-info, fragments) is rejected so a
 * Quick Connect address can never name an arbitrary file.
 */
import {
  normalizeSerialSettings,
  serialHostnameFor,
  type SerialSettingsV1,
} from "../../types/protocols/serial";

export const QUICK_CONNECT_SERIAL_MIN_BAUD = 300;
export const QUICK_CONNECT_SERIAL_MAX_BAUD = 4_000_000;
const MAX_ADDRESS_CHARS = 256;

export interface QuickConnectSerialTarget {
  /** Canonical port name: `COM12` or `/dev/ttyUSB0`. */
  portName: string;
  settings: SerialSettingsV1;
  /** Value to mirror into Connection.hostname. */
  hostname: string;
}

const WINDOWS_PORT_RE = /^(?:\\\\\.\\)?COM([1-9]\d{0,2})$/i;
const UNIX_PORT_RE = /^\/dev\/(?:tty|cu)[\w.-]+$/;
const SCHEME_RE = /^serial:\/\//i;

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

/** True when the text is unambiguously a serial address (not a hostname). */
export function looksLikeQuickConnectSerial(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (SCHEME_RE.test(value)) return true;
  const base = splitShorthand(value).port;
  return WINDOWS_PORT_RE.test(base) || /^\/dev\/(?:tty|cu)/.test(base);
}

function splitShorthand(value: string): {
  port: string;
  shorthand: string | null;
} {
  // `\\.\COM12:115200` and `COM3:9600,8N1`: the first colon after the device.
  const colon = value.indexOf(":");
  return colon < 0
    ? { port: value, shorthand: null }
    : { port: value.slice(0, colon), shorthand: value.slice(colon + 1) };
}

function parseBaud(value: string): number {
  if (!/^\d{1,7}$/.test(value)) {
    throw new Error("Serial baud rate must be a whole number.");
  }
  const baud = Number(value);
  if (
    baud < QUICK_CONNECT_SERIAL_MIN_BAUD ||
    baud > QUICK_CONNECT_SERIAL_MAX_BAUD
  ) {
    throw new Error(
      `Serial baud rate must be from ${QUICK_CONNECT_SERIAL_MIN_BAUD} to ${QUICK_CONNECT_SERIAL_MAX_BAUD}.`,
    );
  }
  return baud;
}

function parseParity(value: string): "none" | "odd" | "even" {
  switch (value.toLowerCase()) {
    case "n":
    case "none":
      return "none";
    case "o":
    case "odd":
      return "odd";
    case "e":
    case "even":
      return "even";
    default:
      throw new Error("Serial parity must be none, odd, or even.");
  }
}

function parseFlow(value: string): "none" | "xonXoff" | "rtsCts" {
  switch (value.toLowerCase()) {
    case "none":
      return "none";
    case "xonxoff":
    case "xon-xoff":
    case "software":
      return "xonXoff";
    case "rtscts":
    case "rts-cts":
    case "hardware":
      return "rtsCts";
    default:
      throw new Error("Serial flow control must be none, xonxoff, or rtscts.");
  }
}

function parseDataBits(value: string): "5" | "6" | "7" | "8" {
  if (value === "5" || value === "6" || value === "7" || value === "8") {
    return value;
  }
  throw new Error("Serial data bits must be 5, 6, 7, or 8.");
}

function parseStopBits(value: string): "1" | "2" {
  if (value === "1" || value === "2") return value;
  throw new Error("Serial stop bits must be 1 or 2.");
}

function parseCanonicalPort(value: string): string {
  const windows = WINDOWS_PORT_RE.exec(value);
  if (windows) {
    const number = Number(windows[1]);
    if (number < 1 || number > 256) {
      throw new Error("Serial COM port number must be from 1 to 256.");
    }
    return `COM${number}`;
  }
  if (UNIX_PORT_RE.test(value) && !value.includes("..")) return value;
  throw new Error(
    "Quick Connect serial requires a COM port (COM3) or a /dev/tty* or /dev/cu.* device.",
  );
}

/**
 * Parse a Quick Connect serial address. Throws an Error with a user-facing
 * message on any invalid input; never returns a partially valid target.
 */
export function parseQuickConnectSerial(raw: string): QuickConnectSerialTarget {
  const value = raw.trim();
  if (
    !value ||
    value.length > MAX_ADDRESS_CHARS ||
    hasControlCharacter(value)
  ) {
    throw new Error("Quick Connect serial address is empty or malformed.");
  }
  if (/[\s@#%]/.test(value)) {
    throw new Error(
      "Quick Connect serial address contains invalid characters.",
    );
  }

  const overrides: Record<string, unknown> = {};
  let portText: string;

  if (SCHEME_RE.test(value)) {
    const rest = value.replace(SCHEME_RE, "");
    const questionMark = rest.indexOf("?");
    portText = questionMark < 0 ? rest : rest.slice(0, questionMark);
    const query = questionMark < 0 ? "" : rest.slice(questionMark + 1);
    if (questionMark >= 0 && !query) {
      throw new Error("Serial address options are empty.");
    }
    const seen = new Set<string>();
    for (const pair of query ? query.split("&") : []) {
      const equals = pair.indexOf("=");
      if (equals <= 0 || equals === pair.length - 1) {
        throw new Error("Serial address options must be key=value pairs.");
      }
      const key = pair.slice(0, equals).toLowerCase();
      const optionValue = pair.slice(equals + 1);
      if (seen.has(key)) {
        throw new Error(`Serial address option "${key}" is repeated.`);
      }
      seen.add(key);
      switch (key) {
        case "baud":
          overrides.baudRate = parseBaud(optionValue);
          break;
        case "data":
          overrides.dataBits = parseDataBits(optionValue);
          break;
        case "parity":
          overrides.parity = parseParity(optionValue);
          break;
        case "stop":
          overrides.stopBits = parseStopBits(optionValue);
          break;
        case "flow":
          overrides.flowControl = parseFlow(optionValue);
          break;
        default:
          throw new Error(`Unknown serial address option "${key}".`);
      }
    }
    if (portText.includes(":")) {
      // Allow serial://COM3:115200 as the shorthand form too.
      const shorthand = splitShorthand(portText);
      portText = shorthand.port;
      applyShorthand(shorthand.shorthand, overrides, seen);
    }
  } else {
    if (value.includes("?")) {
      throw new Error("Serial options need the serial:// form (?baud=9600).");
    }
    const shorthand = splitShorthand(value);
    portText = shorthand.port;
    applyShorthand(shorthand.shorthand, overrides, new Set());
  }

  const portName = parseCanonicalPort(portText);
  const settings = normalizeSerialSettings({
    ...overrides,
    portName,
    portSelection: { mode: "fixed" },
  });
  return { portName, settings, hostname: serialHostnameFor(settings) };
}

function applyShorthand(
  shorthand: string | null,
  overrides: Record<string, unknown>,
  seen: Set<string>,
): void {
  if (shorthand === null) return;
  const [baudText, framing, ...extra] = shorthand.split(",");
  if (extra.length > 0) {
    throw new Error("Serial shorthand is baud[,8N1].");
  }
  if (seen.has("baud")) {
    throw new Error('Serial address option "baud" is repeated.');
  }
  overrides.baudRate = parseBaud(baudText);
  if (framing !== undefined) {
    const match = /^([5-8])([NOEnoe])([12])$/.exec(framing);
    if (!match) {
      throw new Error("Serial framing must look like 8N1.");
    }
    overrides.dataBits = parseDataBits(match[1]);
    overrides.parity = parseParity(match[2]);
    overrides.stopBits = parseStopBits(match[3]);
  }
}
