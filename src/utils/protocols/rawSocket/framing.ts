import type { RawSocketTcpFraming } from "../../../types/protocols/rawSocket";
import { hexToBytes } from "./codecs";

const MAX_TCP_PARSER_INPUT_BYTES = 8 * 1024 * 1024;

export type RawSocketFrameErrorCode =
  | "invalid_configuration"
  | "frame_too_large"
  | "input_too_large"
  | "incomplete_frame";

export class RawSocketFrameError extends Error {
  constructor(
    public readonly code: RawSocketFrameErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RawSocketFrameError";
  }
}

export interface TcpFrameParserState {
  readonly pending: Uint8Array;
}

export interface TcpFrameParseResult {
  readonly frames: readonly Uint8Array[];
  readonly state: TcpFrameParserState;
}

export const createTcpFrameParserState = (): TcpFrameParserState => ({
  pending: new Uint8Array(),
});

function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  if (first.length + second.length > MAX_TCP_PARSER_INPUT_BYTES) {
    throw new RawSocketFrameError(
      "input_too_large",
      "Buffered TCP framing input exceeds the 8 MiB safety limit.",
    );
  }
  const combined = new Uint8Array(first.length + second.length);
  combined.set(first);
  combined.set(second, first.length);
  return combined;
}

function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  from: number,
): number {
  outer: for (
    let index = from;
    index <= haystack.length - needle.length;
    index++
  ) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function readPrefix(
  buffer: Uint8Array,
  offset: number,
  byteLength: 1 | 2 | 4,
  endian: "big" | "little",
): number {
  let value = 0;
  if (endian === "big") {
    for (let index = 0; index < byteLength; index++) {
      value = value * 256 + buffer[offset + index];
    }
  } else {
    for (let index = byteLength - 1; index >= 0; index--) {
      value = value * 256 + buffer[offset + index];
    }
  }
  return value;
}

function parseDelimiterFrames(
  buffer: Uint8Array,
  framing: Extract<RawSocketTcpFraming, { mode: "delimiter" }>,
): TcpFrameParseResult {
  const delimiter = hexToBytes(framing.delimiterHex, 64);
  if (delimiter.length === 0 || framing.maxFrameBytes < 1) {
    throw new RawSocketFrameError(
      "invalid_configuration",
      "Delimiter framing requires a delimiter and a positive maximum frame size.",
    );
  }
  const frames: Uint8Array[] = [];
  let cursor = 0;
  while (cursor <= buffer.length - delimiter.length) {
    const delimiterIndex = indexOfBytes(buffer, delimiter, cursor);
    if (delimiterIndex < 0) break;
    const payloadLength = delimiterIndex - cursor;
    if (payloadLength > framing.maxFrameBytes) {
      throw new RawSocketFrameError(
        "frame_too_large",
        "Delimited TCP frame is too large.",
      );
    }
    const end = framing.includeDelimiter
      ? delimiterIndex + delimiter.length
      : delimiterIndex;
    frames.push(buffer.slice(cursor, end));
    cursor = delimiterIndex + delimiter.length;
  }
  const pending = buffer.slice(cursor);
  if (pending.length > framing.maxFrameBytes + delimiter.length - 1) {
    throw new RawSocketFrameError(
      "frame_too_large",
      "Delimited TCP frame is too large.",
    );
  }
  return { frames, state: { pending } };
}

function parseFixedFrames(
  buffer: Uint8Array,
  framing: Extract<RawSocketTcpFraming, { mode: "fixed_length" }>,
): TcpFrameParseResult {
  if (!Number.isInteger(framing.frameBytes) || framing.frameBytes < 1) {
    throw new RawSocketFrameError(
      "invalid_configuration",
      "Fixed-length framing requires a positive whole-byte size.",
    );
  }
  if (framing.frameBytes > MAX_TCP_PARSER_INPUT_BYTES) {
    throw new RawSocketFrameError(
      "invalid_configuration",
      "Fixed-length frame size exceeds the parser safety limit.",
    );
  }
  const frames: Uint8Array[] = [];
  let cursor = 0;
  while (buffer.length - cursor >= framing.frameBytes) {
    frames.push(buffer.slice(cursor, cursor + framing.frameBytes));
    cursor += framing.frameBytes;
  }
  return { frames, state: { pending: buffer.slice(cursor) } };
}

function parseLengthPrefixFrames(
  buffer: Uint8Array,
  framing: Extract<RawSocketTcpFraming, { mode: "length_prefix" }>,
): TcpFrameParseResult {
  if (
    ![1, 2, 4].includes(framing.prefixBytes) ||
    framing.maxFrameBytes < 1 ||
    framing.maxFrameBytes > MAX_TCP_PARSER_INPUT_BYTES
  ) {
    throw new RawSocketFrameError(
      "invalid_configuration",
      "Length-prefix framing configuration is invalid.",
    );
  }
  const frames: Uint8Array[] = [];
  let cursor = 0;
  while (buffer.length - cursor >= framing.prefixBytes) {
    const declared = readPrefix(
      buffer,
      cursor,
      framing.prefixBytes,
      framing.endian,
    );
    const payloadLength = framing.lengthIncludesPrefix
      ? declared - framing.prefixBytes
      : declared;
    if (payloadLength < 0) {
      throw new RawSocketFrameError(
        "invalid_configuration",
        "Length prefix is smaller than its own header.",
      );
    }
    if (payloadLength > framing.maxFrameBytes) {
      throw new RawSocketFrameError(
        "frame_too_large",
        "Length-prefixed TCP frame is too large.",
      );
    }
    const totalLength = framing.prefixBytes + payloadLength;
    if (buffer.length - cursor < totalLength) break;
    const start = framing.includePrefix ? cursor : cursor + framing.prefixBytes;
    frames.push(buffer.slice(start, cursor + totalLength));
    cursor += totalLength;
  }
  return { frames, state: { pending: buffer.slice(cursor) } };
}

export function parseTcpFrameChunk(
  state: TcpFrameParserState,
  chunk: Uint8Array,
  framing: RawSocketTcpFraming,
): TcpFrameParseResult {
  if (framing.mode === "none") {
    if (chunk.length > MAX_TCP_PARSER_INPUT_BYTES) {
      throw new RawSocketFrameError(
        "input_too_large",
        "TCP input exceeds the 8 MiB safety limit.",
      );
    }
    return {
      frames: chunk.length === 0 ? [] : [chunk.slice()],
      state: createTcpFrameParserState(),
    };
  }
  const buffer = concatBytes(state.pending, chunk);
  if (framing.mode === "delimiter") {
    return parseDelimiterFrames(buffer, framing);
  }
  if (framing.mode === "fixed_length") {
    return parseFixedFrames(buffer, framing);
  }
  return parseLengthPrefixFrames(buffer, framing);
}

export function finalizeTcpFrameParser(
  state: TcpFrameParserState,
  emitRemainder = false,
): readonly Uint8Array[] {
  if (state.pending.length === 0) return [];
  if (emitRemainder) return [state.pending.slice()];
  throw new RawSocketFrameError(
    "incomplete_frame",
    "The TCP stream ended with an incomplete frame.",
  );
}
