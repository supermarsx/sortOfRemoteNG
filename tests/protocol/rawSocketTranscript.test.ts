import { describe, expect, it } from "vitest";
import {
  appendRawSocketTranscript,
  clearRawSocketTranscript,
  createRawSocketTranscript,
  normalizeRawSocketTranscriptLimits,
} from "../../src/utils/protocols/rawSocket/transcript";

const entry = (
  sequence: number,
  data: Uint8Array,
  transport: "tcp" | "udp" = "udp",
) => ({
  id: `frame-${sequence}`,
  sequence,
  timestampMs: sequence,
  direction: "inbound" as const,
  transport,
  data,
});

describe("raw socket transcript", () => {
  it("preserves each UDP datagram, including consecutive empty datagrams", () => {
    let transcript = createRawSocketTranscript({
      maxEntries: 10,
      maxBytes: 10,
    });
    transcript = appendRawSocketTranscript(
      transcript,
      entry(1, new Uint8Array()),
    );
    transcript = appendRawSocketTranscript(
      transcript,
      entry(2, new Uint8Array()),
    );
    transcript = appendRawSocketTranscript(
      transcript,
      entry(3, Uint8Array.of(1, 2)),
    );
    expect(transcript.entries.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(transcript.entries.map((item) => Array.from(item.data))).toEqual([
      [],
      [],
      [1, 2],
    ]);
  });

  it("evicts whole oldest entries to satisfy both count and byte bounds", () => {
    let transcript = createRawSocketTranscript({ maxEntries: 2, maxBytes: 5 });
    transcript = appendRawSocketTranscript(
      transcript,
      entry(1, Uint8Array.of(1, 2, 3)),
    );
    transcript = appendRawSocketTranscript(
      transcript,
      entry(2, Uint8Array.of(4, 5, 6)),
    );
    transcript = appendRawSocketTranscript(
      transcript,
      entry(3, Uint8Array.of(7, 8)),
    );
    expect(transcript.entries.map((item) => item.sequence)).toEqual([2, 3]);
    expect(transcript.totalBytes).toBe(5);
    expect(transcript.evictedEntries).toBe(1);
    expect(transcript.evictedBytes).toBe(3);
  });

  it("drops an oversized datagram atomically instead of truncating it", () => {
    const initial = createRawSocketTranscript({ maxEntries: 5, maxBytes: 2 });
    const next = appendRawSocketTranscript(
      initial,
      entry(1, Uint8Array.of(1, 2, 3)),
    );
    expect(next.entries).toEqual([]);
    expect(next.droppedOversizeEntries).toBe(1);
    expect(next.evictedBytes).toBe(3);
  });

  it("copies caller-owned bytes so later mutations cannot corrupt history", () => {
    const bytes = Uint8Array.of(1, 2);
    const transcript = appendRawSocketTranscript(
      createRawSocketTranscript(),
      entry(1, bytes, "tcp"),
    );
    bytes[0] = 9;
    expect(transcript.entries[0].data).toEqual(Uint8Array.of(1, 2));
  });

  it("maintains its bounds under a property-style sequence of varied payloads", () => {
    let transcript = createRawSocketTranscript({
      maxEntries: 17,
      maxBytes: 101,
    });
    for (let sequence = 0; sequence < 1_000; sequence++) {
      const size = (sequence * 37) % 29;
      transcript = appendRawSocketTranscript(
        transcript,
        entry(sequence, new Uint8Array(size)),
      );
      expect(transcript.entries.length).toBeLessThanOrEqual(17);
      expect(transcript.totalBytes).toBeLessThanOrEqual(101);
      expect(
        transcript.entries.reduce((sum, item) => sum + item.data.length, 0),
      ).toBe(transcript.totalBytes);
    }
  });

  it("clamps externally supplied limits and clears accounting", () => {
    expect(
      normalizeRawSocketTranscriptLimits({
        maxEntries: Number.POSITIVE_INFINITY,
        maxBytes: -5,
      }),
    ).toEqual({ maxEntries: 512, maxBytes: 0 });
    const cleared = clearRawSocketTranscript(
      appendRawSocketTranscript(
        createRawSocketTranscript({ maxEntries: 3, maxBytes: 3 }),
        entry(1, Uint8Array.of(1)),
      ),
    );
    expect(cleared.entries).toEqual([]);
    expect(cleared.evictedEntries).toBe(0);
    expect(cleared.limits).toEqual({ maxEntries: 3, maxBytes: 3 });
  });
});
