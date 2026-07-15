import { redactSecrets } from "./redact";

const MAX_ERROR_TEXT = 2048;
const MAX_ERROR_CODE = 96;
const MAX_CODE_DEPTH = 4;
const SAFE_CODE = /^[A-Za-z0-9_.:-]+$/;
const REDACTION_MARKER = "[redacted]";

type ErrorRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is ErrorRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const boundedText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const withoutControls = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  const normalized = withoutControls.replace(/\s+/g, " ").trim();
  return normalized || null;
};

const errorCode = (value: unknown): string | null => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ERROR_CODE ||
    !SAFE_CODE.test(value)
  ) {
    return null;
  }
  return value;
};

const truncateDisplayText = (value: string): string => {
  if (value.length <= MAX_ERROR_TEXT) return value;
  const markerAt = value.lastIndexOf(REDACTION_MARKER, MAX_ERROR_TEXT - 1);
  if (
    markerAt >= 0 &&
    markerAt < MAX_ERROR_TEXT &&
    markerAt + REDACTION_MARKER.length > MAX_ERROR_TEXT
  ) {
    return `${value.slice(0, MAX_ERROR_TEXT - REDACTION_MARKER.length)}${REDACTION_MARKER}`;
  }
  return value.slice(0, MAX_ERROR_TEXT);
};

const collectErrorCodes = (value: unknown): string[] => {
  const codes: string[] = [];
  let current = value;
  for (let depth = 0; depth < MAX_CODE_DEPTH && isRecord(current); depth += 1) {
    const code = errorCode(current.code);
    if (code && codes[codes.length - 1] !== code) codes.push(code);
    current = current.details;
  }
  return codes;
};

const codeLabel = (code: string): string => {
  const known: Record<string, string> = {
    cancelled: "Connection cancelled",
    command_timed_out: "Connection command timed out",
    connection_refused: "Connection refused",
    delivery_unavailable: "Connection delivery unavailable",
    handshake_timeout: "Handshake timed out",
    invalid_configuration: "Invalid connection configuration",
    io: "I/O error",
    plaintext_acknowledgement_required: "Plaintext acknowledgement is required",
    reserved_source_port_unavailable: "Reserved source port is unavailable",
    server_diagnostic: "The server rejected the connection",
    session_limit_reached: "Connection session limit reached",
    transport: "Transport error",
    unsupported_route: "The requested network route is unsupported",
  };
  if (known[code]) return known[code];
  const words = code.replace(/[_.:-]+/g, " ").trim();
  return words
    ? `${words.charAt(0).toUpperCase()}${words.slice(1)}`
    : "Connection failed";
};

const structuredMessage = (error: ErrorRecord, codes: readonly string[]) => {
  const direct = boundedText(error.message);
  if (direct) return direct;
  if (codes[0] === "server_diagnostic") {
    return boundedText(error.details);
  }
  return null;
};

/**
 * Converts Error, string, and Tauri tagged-error values into bounded UI text.
 * Only explicit message fields (plus the documented RLogin server diagnostic)
 * are rendered. Arbitrary `details` payloads are never stringified.
 */
export function formatErrorForDisplay(
  error: unknown,
  secrets: readonly string[] = [],
): string {
  let message: string | null = null;
  let codes: string[] = [];

  if (error instanceof Error) {
    message = boundedText(error.message);
  } else if (typeof error === "string") {
    message = boundedText(error);
  } else if (isRecord(error)) {
    codes = collectErrorCodes(error);
    message = structuredMessage(error, codes);
  }

  const codePath = codes.join(" / ");
  const fallback = codes.length
    ? `${codeLabel(codes[codes.length - 1])}${codePath ? ` (${codePath})` : ""}`
    : "Connection failed.";
  const rendered = message
    ? `${message}${codePath ? ` (${codePath})` : ""}`
    : fallback;
  return truncateDisplayText(redactSecrets(rendered, secrets));
}
