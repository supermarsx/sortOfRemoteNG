import type { RawSocketTransport } from "../../../types/protocols/rawSocket";

export type RawSocketTranscriptDirection = "inbound" | "outbound";

export interface RawSocketTranscriptEntry {
  readonly id: string;
  readonly sequence: number;
  readonly timestampMs: number;
  readonly direction: RawSocketTranscriptDirection;
  readonly transport: RawSocketTransport;
  readonly data: Uint8Array;
}

export interface RawSocketTranscriptLimits {
  readonly maxEntries: number;
  readonly maxBytes: number;
}

export interface RawSocketTranscript {
  readonly entries: readonly RawSocketTranscriptEntry[];
  readonly totalBytes: number;
  readonly evictedEntries: number;
  readonly evictedBytes: number;
  readonly droppedOversizeEntries: number;
  readonly limits: RawSocketTranscriptLimits;
}

export const RAW_SOCKET_TRANSCRIPT_LIMITS = {
  maxEntries: 4_096,
  maxBytes: 8 * 1024 * 1024,
} as const;

export function normalizeRawSocketTranscriptLimits(
  limits: Partial<RawSocketTranscriptLimits> = {},
): RawSocketTranscriptLimits {
  const finiteInteger = (value: unknown, fallback: number, max: number) => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed)
      ? Math.min(max, Math.max(0, Math.trunc(parsed)))
      : fallback;
  };
  return {
    maxEntries: finiteInteger(
      limits.maxEntries,
      512,
      RAW_SOCKET_TRANSCRIPT_LIMITS.maxEntries,
    ),
    maxBytes: finiteInteger(
      limits.maxBytes,
      2 * 1024 * 1024,
      RAW_SOCKET_TRANSCRIPT_LIMITS.maxBytes,
    ),
  };
}

export function createRawSocketTranscript(
  limits?: Partial<RawSocketTranscriptLimits>,
): RawSocketTranscript {
  return {
    entries: [],
    totalBytes: 0,
    evictedEntries: 0,
    evictedBytes: 0,
    droppedOversizeEntries: 0,
    limits: normalizeRawSocketTranscriptLimits(limits),
  };
}

export function appendRawSocketTranscript(
  transcript: RawSocketTranscript,
  entry: RawSocketTranscriptEntry,
): RawSocketTranscript {
  const data = entry.data.slice();
  if (
    transcript.limits.maxEntries === 0 ||
    transcript.limits.maxBytes === 0 ||
    data.length > transcript.limits.maxBytes
  ) {
    return {
      ...transcript,
      evictedEntries: transcript.evictedEntries + 1,
      evictedBytes: transcript.evictedBytes + data.length,
      droppedOversizeEntries: transcript.droppedOversizeEntries + 1,
    };
  }

  const entries = [...transcript.entries, { ...entry, data }];
  let totalBytes = transcript.totalBytes + data.length;
  let evictedEntries = transcript.evictedEntries;
  let evictedBytes = transcript.evictedBytes;
  while (
    entries.length > transcript.limits.maxEntries ||
    totalBytes > transcript.limits.maxBytes
  ) {
    const evicted = entries.shift();
    if (!evicted) break;
    totalBytes -= evicted.data.length;
    evictedEntries += 1;
    evictedBytes += evicted.data.length;
  }

  return {
    ...transcript,
    entries,
    totalBytes,
    evictedEntries,
    evictedBytes,
  };
}

export function clearRawSocketTranscript(
  transcript: RawSocketTranscript,
): RawSocketTranscript {
  return createRawSocketTranscript(transcript.limits);
}
