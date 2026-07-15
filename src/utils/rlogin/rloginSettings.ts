import {
  DIRECT_RLOGIN_NETWORK_PATH,
  RLOGIN_DEFAULT_PORT,
  RLOGIN_ENCODINGS,
  RLOGIN_PLAINTEXT_ACKNOWLEDGEMENT_SCOPE,
  RLOGIN_SETTINGS_VERSION,
  RLOGIN_SOURCE_PORT_MODES,
  type RloginEncoding,
  type RloginNetworkPathCapability,
  type RloginPlaintextAcknowledgement,
  type RloginSettings,
  type RloginSettingsPatch,
  type RloginSourcePortMode,
} from "../../types/connection/rloginSettings";

const MAX_USERNAME_BYTES = 256;
const MAX_TERMINAL_TYPE_BYTES = 128;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

export const RLOGIN_ENCODING_OPTIONS = [
  {
    value: "utf-8",
    label: "UTF-8",
    description: "Full Unicode input and output",
  },
  {
    value: "windows-1252",
    label: "Windows-1252",
    description: "Western European legacy hosts",
  },
  {
    value: "iso-8859-1",
    label: "ISO-8859-1",
    description: "Latin-1 byte mapping",
  },
] as const satisfies readonly {
  value: RloginEncoding;
  label: string;
  description: string;
}[];

export const RLOGIN_SOURCE_PORT_OPTIONS = [
  {
    value: "ephemeral",
    label: "Ephemeral (recommended)",
    description: "Use a normal unprivileged client port.",
  },
  {
    value: "reserved",
    label: "Reserved 512–1023",
    description: "Required by some classic trusted-host servers.",
  },
  {
    value: "auto",
    label: "Try reserved, then ephemeral",
    description: "Compatibility attempt with a safe fallback.",
  },
] as const satisfies readonly {
  value: RloginSourcePortMode;
  label: string;
  description: string;
}[];

const createPlaintextAcknowledgement = (): RloginPlaintextAcknowledgement => ({
  version: 1,
  scope: RLOGIN_PLAINTEXT_ACKNOWLEDGEMENT_SCOPE,
  acknowledged: false,
});

export function createDefaultRloginSettings(): RloginSettings {
  return {
    version: RLOGIN_SETTINGS_VERSION,
    localUsername: "",
    remoteUsername: "",
    terminalType: "xterm-256color",
    terminalSpeed: 38_400,
    encoding: "utf-8",
    initialRows: 24,
    initialColumns: 80,
    localFlowControl: true,
    escapeEnabled: true,
    escapeCharacter: "~",
    sourcePortMode: "ephemeral",
    reservedPortStart: 512,
    reservedPortEnd: 1023,
    connectTimeoutMs: 10_000,
    handshakeTimeoutMs: 10_000,
    writeTimeoutMs: 10_000,
    idleTimeoutMs: 5 * 60 * 1_000,
    tcpNoDelay: true,
    tcpKeepAlive: true,
    tcpKeepAliveSeconds: 60,
    plaintextAcknowledgement: createPlaintextAcknowledgement(),
  };
}

export const DEFAULT_RLOGIN_SETTINGS: Readonly<RloginSettings> = Object.freeze(
  createDefaultRloginSettings(),
);

export interface RloginSettingsMigrationOptions {
  /** Use for import, sync, or clone boundaries where consent must not travel. */
  resetPlaintextAcknowledgement?: boolean;
}

export function migrateRloginSettings(
  value: unknown,
  options: RloginSettingsMigrationOptions = {},
): RloginSettings {
  const defaults = createDefaultRloginSettings();
  if (!isRecord(value)) return defaults;

  const sourceVersion = integer(value.version);
  const settings: RloginSettings = {
    ...defaults,
    localUsername: safeString(
      value.localUsername ??
        value.local_username ??
        value.localUser ??
        value.local_user,
      defaults.localUsername,
    ),
    remoteUsername: safeString(
      value.remoteUsername ??
        value.remote_username ??
        value.remoteUser ??
        value.remote_user,
      defaults.remoteUsername,
    ),
    terminalType: safeString(
      value.terminalType ?? value.terminal_type,
      defaults.terminalType,
    ),
    terminalSpeed: boundedInteger(
      value.terminalSpeed ?? value.terminal_speed,
      defaults.terminalSpeed,
      1,
      4_000_000,
    ),
    encoding: normalizeRloginEncoding(value.encoding),
    initialRows: boundedInteger(
      value.initialRows ?? value.rows,
      defaults.initialRows,
      1,
      65_535,
    ),
    initialColumns: boundedInteger(
      value.initialColumns ?? value.columns,
      defaults.initialColumns,
      1,
      65_535,
    ),
    localFlowControl: safeBoolean(
      value.localFlowControl,
      defaults.localFlowControl,
    ),
    escapeEnabled: safeBoolean(value.escapeEnabled, defaults.escapeEnabled),
    escapeCharacter: normalizeEscapeCharacter(
      value.escapeCharacter ?? value.escapeChar,
      defaults.escapeCharacter,
    ),
    sourcePortMode: normalizeSourcePortMode(value.sourcePortMode),
    reservedPortStart: boundedInteger(
      value.reservedPortStart,
      defaults.reservedPortStart,
      512,
      1023,
    ),
    reservedPortEnd: boundedInteger(
      value.reservedPortEnd,
      defaults.reservedPortEnd,
      512,
      1023,
    ),
    connectTimeoutMs: boundedInteger(
      value.connectTimeoutMs,
      defaults.connectTimeoutMs,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    handshakeTimeoutMs: boundedInteger(
      value.handshakeTimeoutMs,
      defaults.handshakeTimeoutMs,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    writeTimeoutMs: boundedInteger(
      value.writeTimeoutMs,
      defaults.writeTimeoutMs,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    idleTimeoutMs: boundedInteger(
      value.idleTimeoutMs,
      defaults.idleTimeoutMs,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    tcpNoDelay: safeBoolean(value.tcpNoDelay, defaults.tcpNoDelay),
    tcpKeepAlive: safeBoolean(value.tcpKeepAlive, defaults.tcpKeepAlive),
    tcpKeepAliveSeconds: boundedInteger(
      value.tcpKeepAliveSeconds,
      defaults.tcpKeepAliveSeconds,
      1,
      86_400,
    ),
    plaintextAcknowledgement:
      sourceVersion === RLOGIN_SETTINGS_VERSION &&
      !options.resetPlaintextAcknowledgement
        ? normalizeAcknowledgement(value.plaintextAcknowledgement)
        : createPlaintextAcknowledgement(),
  };

  // Inactive values remain intact. Switching source-port, escape, or
  // keepalive modes must never erase a valid value the user may re-enable.
  return settings;
}

export const normalizeRloginSettings = migrateRloginSettings;

export function patchRloginSettings(
  settings: RloginSettings,
  patch: RloginSettingsPatch,
): RloginSettings {
  return { ...settings, ...patch, version: RLOGIN_SETTINGS_VERSION };
}

export function acknowledgeRloginPlaintext(
  settings: RloginSettings,
  acknowledgedAt: Date = new Date(),
): RloginSettings {
  return {
    ...settings,
    plaintextAcknowledgement: {
      version: 1,
      scope: RLOGIN_PLAINTEXT_ACKNOWLEDGEMENT_SCOPE,
      acknowledged: true,
      acknowledgedAt: acknowledgedAt.toISOString(),
    },
  };
}

export function resetRloginPlaintextAcknowledgement(
  settings: RloginSettings,
): RloginSettings {
  return {
    ...settings,
    plaintextAcknowledgement: createPlaintextAcknowledgement(),
  };
}

export function isRloginPlaintextAcknowledged(
  settings: RloginSettings,
): boolean {
  const acknowledgement = settings.plaintextAcknowledgement;
  return (
    acknowledgement.version === 1 &&
    acknowledgement.scope === RLOGIN_PLAINTEXT_ACKNOWLEDGEMENT_SCOPE &&
    acknowledgement.acknowledged === true &&
    isIsoTimestamp(acknowledgement.acknowledgedAt)
  );
}

export type RloginValidationSeverity = "error" | "warning";

export interface RloginValidationIssue {
  code:
    | "required"
    | "nul-byte"
    | "field-too-long"
    | "out-of-range"
    | "invalid-escape"
    | "invalid-encoding"
    | "network-path-unsupported"
    | "reserved-port-network-path"
    | "reserved-port-privileges"
    | "auto-port-network-path"
    | "plaintext-not-acknowledged";
  severity: RloginValidationSeverity;
  field: keyof RloginSettings | "port" | "networkPath";
  message: string;
}

export interface RloginValidationContext {
  port: number;
  networkPath?: RloginNetworkPathCapability;
}

export interface RloginValidationResult {
  valid: boolean;
  issues: readonly RloginValidationIssue[];
  errorsByField: Readonly<Record<string, string>>;
}

export function validateRloginSettings(
  settings: RloginSettings,
  context: RloginValidationContext,
): RloginValidationResult {
  const issues: RloginValidationIssue[] = [];
  validateHandshakeString(
    issues,
    "localUsername",
    "Local username",
    settings.localUsername,
    MAX_USERNAME_BYTES,
  );
  validateHandshakeString(
    issues,
    "remoteUsername",
    "Remote username",
    settings.remoteUsername,
    MAX_USERNAME_BYTES,
  );
  validateHandshakeString(
    issues,
    "terminalType",
    "Terminal type",
    settings.terminalType,
    MAX_TERMINAL_TYPE_BYTES,
  );

  validateIntegerRange(issues, "port", "Port", context.port, 1, 65_535);
  validateIntegerRange(
    issues,
    "terminalSpeed",
    "Terminal speed",
    settings.terminalSpeed,
    1,
    4_000_000,
  );
  validateIntegerRange(
    issues,
    "initialRows",
    "Initial rows",
    settings.initialRows,
    1,
    65_535,
  );
  validateIntegerRange(
    issues,
    "initialColumns",
    "Initial columns",
    settings.initialColumns,
    1,
    65_535,
  );
  validateIntegerRange(
    issues,
    "reservedPortStart",
    "Reserved port start",
    settings.reservedPortStart,
    512,
    1023,
  );
  validateIntegerRange(
    issues,
    "reservedPortEnd",
    "Reserved port end",
    settings.reservedPortEnd,
    512,
    1023,
  );
  if (settings.reservedPortStart > settings.reservedPortEnd) {
    issues.push({
      code: "out-of-range",
      severity: "error",
      field: "reservedPortEnd",
      message: "Reserved port end must be greater than or equal to its start.",
    });
  }

  for (const [field, label, value] of [
    ["connectTimeoutMs", "Connect timeout", settings.connectTimeoutMs],
    ["handshakeTimeoutMs", "Handshake timeout", settings.handshakeTimeoutMs],
    ["writeTimeoutMs", "Write timeout", settings.writeTimeoutMs],
    ["idleTimeoutMs", "Idle timeout", settings.idleTimeoutMs],
  ] as const) {
    validateIntegerRange(
      issues,
      field,
      label,
      value,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );
  }
  validateIntegerRange(
    issues,
    "tcpKeepAliveSeconds",
    "TCP keepalive interval",
    settings.tcpKeepAliveSeconds,
    1,
    86_400,
  );

  if (!RLOGIN_ENCODINGS.includes(settings.encoding)) {
    issues.push({
      code: "invalid-encoding",
      severity: "error",
      field: "encoding",
      message: "Select a supported RLogin terminal encoding.",
    });
  }
  if (
    settings.escapeEnabled &&
    parseRloginEscapeCharacter(settings.escapeCharacter) === undefined
  ) {
    issues.push({
      code: "invalid-escape",
      severity: "error",
      field: "escapeCharacter",
      message:
        "Escape character must be one non-NUL ASCII character, caret notation such as ^], or \\xNN.",
    });
  }

  const networkPath = context.networkPath ?? DIRECT_RLOGIN_NETWORK_PATH;
  if (!networkPath.supported) {
    issues.push({
      code: "network-path-unsupported",
      severity: "error",
      field: "networkPath",
      message: "The selected Network Path cannot provide an RLogin TCP stream.",
    });
  }
  if (networkPath.configured && settings.sourcePortMode === "reserved") {
    issues.push({
      code: "reserved-port-network-path",
      severity: "error",
      field: "sourcePortMode",
      message:
        "Reserved client ports cannot be guaranteed through a proxy, VPN, or SSH jump. Use a direct path or ephemeral mode.",
    });
  } else if (networkPath.configured && settings.sourcePortMode === "auto") {
    issues.push({
      code: "auto-port-network-path",
      severity: "warning",
      field: "sourcePortMode",
      message:
        "A Network Path forces the automatic source-port policy to use an ephemeral port; classic host-based trust may fail.",
    });
  }
  if (settings.sourcePortMode === "reserved") {
    issues.push({
      code: "reserved-port-privileges",
      severity: "warning",
      field: "sourcePortMode",
      message:
        "Binding ports 512–1023 may require elevated operating-system privileges.",
    });
  }

  if (!isRloginPlaintextAcknowledged(settings)) {
    issues.push({
      code: "plaintext-not-acknowledged",
      severity: "error",
      field: "plaintextAcknowledgement",
      message:
        "Acknowledge that RLogin sends usernames and terminal traffic in plaintext before connecting.",
    });
  }

  const errorsByField: Record<string, string> = {};
  for (const issue of issues) {
    if (issue.severity === "error" && !errorsByField[issue.field]) {
      errorsByField[issue.field] = issue.message;
    }
  }
  return {
    valid: Object.keys(errorsByField).length === 0,
    issues,
    errorsByField,
  };
}

function validateHandshakeString(
  issues: RloginValidationIssue[],
  field: "localUsername" | "remoteUsername" | "terminalType",
  label: string,
  value: string,
  maxBytes: number,
): void {
  if (!value) {
    issues.push({
      code: "required",
      severity: "error",
      field,
      message: `${label} is required.`,
    });
    return;
  }
  if (value.includes("\0")) {
    issues.push({
      code: "nul-byte",
      severity: "error",
      field,
      message: `${label} cannot contain a NUL character.`,
    });
  }
  if (new TextEncoder().encode(value).length > maxBytes) {
    issues.push({
      code: "field-too-long",
      severity: "error",
      field,
      message: `${label} cannot exceed ${maxBytes} UTF-8 bytes.`,
    });
  }
}

function validateIntegerRange(
  issues: RloginValidationIssue[],
  field: RloginValidationIssue["field"],
  label: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    issues.push({
      code: "out-of-range",
      severity: "error",
      field,
      message: `${label} must be an integer between ${minimum} and ${maximum}.`,
    });
  }
}

export function normalizeRloginEncoding(value: unknown): RloginEncoding {
  if (typeof value !== "string") return "utf-8";
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  const aliases: Readonly<Record<string, RloginEncoding>> = {
    utf8: "utf-8",
    latin1: "iso-8859-1",
    "latin-1": "iso-8859-1",
    iso88591: "iso-8859-1",
    cp1252: "windows-1252",
    windows1252: "windows-1252",
  };
  const candidate = aliases[normalized] ?? normalized;
  return RLOGIN_ENCODINGS.includes(candidate as RloginEncoding)
    ? (candidate as RloginEncoding)
    : "utf-8";
}

export interface RloginEncodedInput {
  bytes: Uint8Array;
  lossy: boolean;
}

const WINDOWS_1252_DECODE: Readonly<Record<number, number>> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};
const WINDOWS_1252_ENCODE = new Map(
  Object.entries(WINDOWS_1252_DECODE).map(([byte, codePoint]) => [
    codePoint,
    Number(byte),
  ]),
);

export function encodeRloginTerminalInput(
  text: string,
  encoding: RloginEncoding,
): RloginEncodedInput {
  if (encoding === "utf-8") {
    return { bytes: new TextEncoder().encode(text), lossy: false };
  }

  const bytes: number[] = [];
  let lossy = false;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0x3f;
    if (encoding === "iso-8859-1" && codePoint <= 0xff) {
      bytes.push(codePoint);
    } else if (
      encoding === "windows-1252" &&
      (codePoint <= 0x7f || (codePoint >= 0xa0 && codePoint <= 0xff))
    ) {
      bytes.push(codePoint);
    } else if (
      encoding === "windows-1252" &&
      WINDOWS_1252_ENCODE.has(codePoint)
    ) {
      bytes.push(WINDOWS_1252_ENCODE.get(codePoint)!);
    } else {
      bytes.push(0x3f);
      lossy = true;
    }
  }
  return { bytes: Uint8Array.from(bytes), lossy };
}

export class RloginTerminalDecoder {
  readonly encoding: RloginEncoding;
  private readonly utf8Decoder?: TextDecoder;

  constructor(encoding: RloginEncoding) {
    this.encoding = encoding;
    if (encoding === "utf-8") {
      this.utf8Decoder = new TextDecoder("utf-8", { fatal: false });
    }
  }

  decode(bytes: Uint8Array, stream = true): string {
    if (this.utf8Decoder) return this.utf8Decoder.decode(bytes, { stream });
    const codePoints = Array.from(bytes, (byte) =>
      this.encoding === "windows-1252"
        ? (WINDOWS_1252_DECODE[byte] ?? byte)
        : byte,
    );
    return String.fromCodePoint(...codePoints);
  }

  flush(): string {
    return this.utf8Decoder?.decode() ?? "";
  }
}

export type RloginTerminalMode = "cooked" | "raw";
export type RloginFlowControlAction = "pause-output" | "resume-output";

export function getRloginFlowControlAction(
  byte: number,
  terminalMode: RloginTerminalMode,
  localFlowControl: boolean,
): RloginFlowControlAction | undefined {
  if (!localFlowControl || terminalMode === "raw") return undefined;
  if (byte === 0x13) return "pause-output";
  if (byte === 0x11) return "resume-output";
  return undefined;
}

export function parseRloginEscapeCharacter(value: string): number | undefined {
  if (value.length === 1) {
    const code = value.charCodeAt(0);
    return code > 0 && code <= 0x7f ? code : undefined;
  }
  if (/^\^[\x40-\x5f?]$/.test(value)) {
    return value === "^?" ? 0x7f : value.charCodeAt(1) - 0x40;
  }
  const hex = /^\\x([0-7][0-9a-f])$/i.exec(value);
  if (!hex) return undefined;
  const byte = Number.parseInt(hex[1], 16);
  return byte === 0 ? undefined : byte;
}

export function formatRloginEscapeByte(byte: number): string {
  if (!Number.isInteger(byte) || byte <= 0 || byte > 0x7f) return "";
  if (byte >= 0x20 && byte <= 0x7e) return String.fromCharCode(byte);
  if (byte === 0x7f) return "^?";
  return `^${String.fromCharCode(byte + 0x40)}`;
}

function normalizeEscapeCharacter(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return parseRloginEscapeCharacter(value) === undefined ? fallback : value;
}

function normalizeSourcePortMode(value: unknown): RloginSourcePortMode {
  return RLOGIN_SOURCE_PORT_MODES.includes(value as RloginSourcePortMode)
    ? (value as RloginSourcePortMode)
    : "ephemeral";
}

function normalizeAcknowledgement(
  value: unknown,
): RloginPlaintextAcknowledgement {
  if (!isRecord(value)) return createPlaintextAcknowledgement();
  if (
    value.version !== 1 ||
    value.scope !== RLOGIN_PLAINTEXT_ACKNOWLEDGEMENT_SCOPE ||
    value.acknowledged !== true ||
    !isIsoTimestamp(value.acknowledgedAt)
  ) {
    return createPlaintextAcknowledgement();
  }
  return {
    version: 1,
    scope: RLOGIN_PLAINTEXT_ACKNOWLEDGEMENT_SCOPE,
    acknowledged: true,
    acknowledgedAt: value.acknowledgedAt,
  };
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function integer(value: unknown): number | undefined {
  const candidate = typeof value === "string" ? Number(value) : value;
  return typeof candidate === "number" && Number.isInteger(candidate)
    ? candidate
    : undefined;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = integer(value);
  return candidate !== undefined && candidate >= minimum && candidate <= maximum
    ? candidate
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { RLOGIN_DEFAULT_PORT };
