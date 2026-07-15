import type {
  RawSocketLineEnding,
  RawSocketPayloadEncoding,
} from "../../../types/protocols/rawSocket";

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_INDEX = new Map(
  [...BASE64_ALPHABET].map((character, index) => [character, index]),
);
export const MAX_RAW_SOCKET_CODEC_BYTES = 8 * 1024 * 1024;

export type RawSocketCodecErrorCode =
  | "invalid_hex"
  | "invalid_base64"
  | "invalid_utf8"
  | "payload_too_large";

export class RawSocketCodecError extends Error {
  constructor(
    public readonly code: RawSocketCodecErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RawSocketCodecError";
  }
}

function assertBounded(size: number, maxBytes: number): void {
  const boundedMax = Math.min(
    MAX_RAW_SOCKET_CODEC_BYTES,
    Math.max(0, Math.trunc(maxBytes)),
  );
  if (size > boundedMax) {
    throw new RawSocketCodecError(
      "payload_too_large",
      `Payload exceeds the ${boundedMax}-byte codec limit.`,
    );
  }
}

export function textToBytes(
  value: string,
  maxBytes = MAX_RAW_SOCKET_CODEC_BYTES,
): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  assertBounded(bytes.length, maxBytes);
  return bytes;
}

export function bytesToText(
  bytes: Uint8Array,
  options: { fatal?: boolean; maxBytes?: number } = {},
): string {
  assertBounded(bytes.length, options.maxBytes ?? MAX_RAW_SOCKET_CODEC_BYTES);
  try {
    return new TextDecoder("utf-8", { fatal: options.fatal ?? false }).decode(
      bytes,
    );
  } catch {
    throw new RawSocketCodecError(
      "invalid_utf8",
      "Payload is not valid UTF-8 text.",
    );
  }
}

export function hexToBytes(
  value: string,
  maxBytes = MAX_RAW_SOCKET_CODEC_BYTES,
): Uint8Array {
  const tokens = value
    .trim()
    .split(/[\s,:_-]+/)
    .filter(Boolean);
  if (tokens.length === 0) return new Uint8Array();
  const compact = tokens
    .map((token) =>
      token.toLowerCase().startsWith("0x") ? token.slice(2) : token,
    )
    .join("");
  if (compact.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(compact)) {
    throw new RawSocketCodecError(
      "invalid_hex",
      "Hex input must contain complete byte pairs using 0-9 and A-F.",
    );
  }
  assertBounded(compact.length / 2, maxBytes);
  const bytes = new Uint8Array(compact.length / 2);
  for (let index = 0; index < compact.length; index += 2) {
    bytes[index / 2] = Number.parseInt(compact.slice(index, index + 2), 16);
  }
  return bytes;
}

export function bytesToHex(
  bytes: Uint8Array,
  options: { separator?: string; uppercase?: boolean; maxBytes?: number } = {},
): string {
  assertBounded(bytes.length, options.maxBytes ?? MAX_RAW_SOCKET_CODEC_BYTES);
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(options.separator ?? " ");
  return options.uppercase ? value.toUpperCase() : value;
}

export function bytesToBase64(
  bytes: Uint8Array,
  maxBytes = MAX_RAW_SOCKET_CODEC_BYTES,
): string {
  assertBounded(bytes.length, maxBytes);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    output +=
      second === undefined
        ? "="
        : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    output += third === undefined ? "=" : BASE64_ALPHABET[third & 0x3f];
  }
  return output;
}

export function base64ToBytes(
  value: string,
  maxBytes = MAX_RAW_SOCKET_CODEC_BYTES,
): Uint8Array {
  const compact = value
    .replace(/\s/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (!compact) return new Uint8Array();
  if (compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new RawSocketCodecError(
      "invalid_base64",
      "Base64 input is malformed.",
    );
  }
  const firstPadding = compact.indexOf("=");
  if (firstPadding >= 0 && firstPadding < compact.length - 2) {
    throw new RawSocketCodecError(
      "invalid_base64",
      "Base64 padding is only valid at the end.",
    );
  }
  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, "=");
  const padding = padded.endsWith("==") ? 2 : padded.endsWith("=") ? 1 : 0;
  const outputLength = (padded.length / 4) * 3 - padding;
  assertBounded(outputLength, maxBytes);
  const output = new Uint8Array(outputLength);
  let outputIndex = 0;
  for (let index = 0; index < padded.length; index += 4) {
    const characters = padded.slice(index, index + 4);
    const values = [...characters].map((character) =>
      character === "=" ? 0 : BASE64_INDEX.get(character),
    );
    if (values.some((entry) => entry === undefined)) {
      throw new RawSocketCodecError(
        "invalid_base64",
        "Base64 input contains an invalid character.",
      );
    }
    const [a, b, c, d] = values as number[];
    if (characters[2] === "=" && (b & 0x0f) !== 0) {
      throw new RawSocketCodecError(
        "invalid_base64",
        "Base64 input is not canonical.",
      );
    }
    if (characters[3] === "=" && characters[2] !== "=" && (c & 0x03) !== 0) {
      throw new RawSocketCodecError(
        "invalid_base64",
        "Base64 input is not canonical.",
      );
    }
    const combined = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputIndex < output.length) output[outputIndex++] = combined >> 16;
    if (outputIndex < output.length)
      output[outputIndex++] = (combined >> 8) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = combined & 0xff;
  }
  return output;
}

export function appendLineEnding(
  value: string,
  lineEnding: RawSocketLineEnding,
): string {
  if (lineEnding === "lf") return `${value}\n`;
  if (lineEnding === "crlf") return `${value}\r\n`;
  return value;
}

export function encodeRawSocketPayload(
  value: string,
  encoding: RawSocketPayloadEncoding,
  options: { lineEnding?: RawSocketLineEnding; maxBytes?: number } = {},
): Uint8Array {
  const maxBytes = options.maxBytes ?? MAX_RAW_SOCKET_CODEC_BYTES;
  const payload =
    encoding === "hex"
      ? hexToBytes(value, maxBytes)
      : encoding === "base64"
        ? base64ToBytes(value, maxBytes)
        : textToBytes(value, maxBytes);
  const lineEnding = options.lineEnding ?? "none";
  const suffix =
    lineEnding === "lf"
      ? Uint8Array.of(0x0a)
      : lineEnding === "crlf"
        ? Uint8Array.of(0x0d, 0x0a)
        : new Uint8Array();
  assertBounded(payload.length + suffix.length, maxBytes);
  if (suffix.length === 0) return payload;
  const combined = new Uint8Array(payload.length + suffix.length);
  combined.set(payload);
  combined.set(suffix, payload.length);
  return combined;
}

export function decodeRawSocketPayload(
  bytes: Uint8Array,
  encoding: RawSocketPayloadEncoding,
  options: { fatalText?: boolean; maxBytes?: number } = {},
): string {
  const maxBytes = options.maxBytes ?? MAX_RAW_SOCKET_CODEC_BYTES;
  if (encoding === "hex") return bytesToHex(bytes, { maxBytes });
  if (encoding === "base64") return bytesToBase64(bytes, maxBytes);
  return bytesToText(bytes, { fatal: options.fatalText, maxBytes });
}
