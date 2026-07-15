import { describe, expect, it } from "vitest";
import {
  RawSocketFrameError,
  createTcpFrameParserState,
  finalizeTcpFrameParser,
  parseTcpFrameChunk,
  type TcpFrameParserState,
} from "../../src/utils/protocols/rawSocket/framing";
import type { RawSocketTcpFraming } from "../../src/types/protocols/rawSocket";

const collect = (
  bytes: Uint8Array,
  chunkSizes: readonly number[],
  framing: RawSocketTcpFraming,
) => {
  let state: TcpFrameParserState = createTcpFrameParserState();
  const frames: Uint8Array[] = [];
  let offset = 0;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    const size = chunkSizes[chunkIndex++ % chunkSizes.length];
    const result = parseTcpFrameChunk(
      state,
      bytes.slice(offset, offset + size),
      framing,
    );
    frames.push(...result.frames);
    state = result.state;
    offset += size;
  }
  return { frames, state };
};

describe("TCP framing parser", () => {
  it("copies unframed receive chunks and ignores empty reads", () => {
    const bytes = Uint8Array.of(1, 2, 3);
    const result = parseTcpFrameChunk(createTcpFrameParserState(), bytes, {
      mode: "none",
    });
    expect(result.frames).toEqual([bytes]);
    expect(result.frames[0]).not.toBe(bytes);
    expect(
      parseTcpFrameChunk(result.state, new Uint8Array(), { mode: "none" })
        .frames,
    ).toEqual([]);
  });

  it("finds multi-byte delimiters across arbitrary receive boundaries", () => {
    const framing = {
      mode: "delimiter",
      delimiterHex: "0d0a",
      includeDelimiter: false,
      maxFrameBytes: 16,
    } as const;
    const payload = Uint8Array.of(1, 2, 13, 10, 3, 13, 10);
    for (const sizes of [[1], [2, 1, 3], [7]]) {
      const { frames, state } = collect(payload, sizes, framing);
      expect(frames.map((frame) => Array.from(frame))).toEqual([[1, 2], [3]]);
      expect(state.pending).toHaveLength(0);
    }
  });

  it("optionally retains delimiter bytes and permits a partial delimiter after max payload", () => {
    const first = parseTcpFrameChunk(
      createTcpFrameParserState(),
      Uint8Array.of(1, 2, 13),
      {
        mode: "delimiter",
        delimiterHex: "0d0a",
        includeDelimiter: true,
        maxFrameBytes: 2,
      },
    );
    expect(first.state.pending).toEqual(Uint8Array.of(1, 2, 13));
    const second = parseTcpFrameChunk(first.state, Uint8Array.of(10), {
      mode: "delimiter",
      delimiterHex: "0d0a",
      includeDelimiter: true,
      maxFrameBytes: 2,
    });
    expect(second.frames).toEqual([Uint8Array.of(1, 2, 13, 10)]);
  });

  it("produces fixed-size frames independently of chunking", () => {
    const payload = Uint8Array.from({ length: 98 }, (_, index) => index);
    const expected = Array.from({ length: 14 }, (_, frame) =>
      Array.from(payload.slice(frame * 7, frame * 7 + 7)),
    );
    for (const sizes of [[1], [2, 9, 3, 11], [98]]) {
      const result = collect(payload, sizes, {
        mode: "fixed_length",
        frameBytes: 7,
      });
      expect(result.frames.map((frame) => Array.from(frame))).toEqual(expected);
      expect(result.state.pending).toHaveLength(0);
    }
  });

  it("parses big- and little-endian length prefixes, including empty frames", () => {
    const big = collect(Uint8Array.of(0, 3, 1, 2, 3, 0, 0), [1, 2], {
      mode: "length_prefix",
      prefixBytes: 2,
      endian: "big",
      lengthIncludesPrefix: false,
      includePrefix: false,
      maxFrameBytes: 16,
    });
    expect(big.frames.map((frame) => Array.from(frame))).toEqual([
      [1, 2, 3],
      [],
    ]);
    const little = collect(Uint8Array.of(5, 0, 0xaa, 0xbb, 0xcc), [2, 1], {
      mode: "length_prefix",
      prefixBytes: 2,
      endian: "little",
      lengthIncludesPrefix: true,
      includePrefix: true,
      maxFrameBytes: 16,
    });
    expect(little.frames).toEqual([Uint8Array.of(5, 0, 0xaa, 0xbb, 0xcc)]);
  });

  it("rejects oversized declared and unterminated frames without partial output", () => {
    expect(() =>
      parseTcpFrameChunk(createTcpFrameParserState(), Uint8Array.of(0, 20), {
        mode: "length_prefix",
        prefixBytes: 2,
        endian: "big",
        lengthIncludesPrefix: false,
        includePrefix: false,
        maxFrameBytes: 10,
      }),
    ).toThrowError(expect.objectContaining({ code: "frame_too_large" }));
    expect(() =>
      finalizeTcpFrameParser({ pending: Uint8Array.of(1) }),
    ).toThrowError(expect.objectContaining({ code: "incomplete_frame" }));
    expect(finalizeTcpFrameParser({ pending: Uint8Array.of(1) }, true)).toEqual(
      [Uint8Array.of(1)],
    );
  });

  it("rejects invalid configurations with typed errors", () => {
    expect(() =>
      parseTcpFrameChunk(createTcpFrameParserState(), Uint8Array.of(1), {
        mode: "fixed_length",
        frameBytes: 0,
      }),
    ).toThrow(RawSocketFrameError);
  });
});
