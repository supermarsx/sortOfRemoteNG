import { describe, it, expect, vi } from "vitest";

// Mock gifenc before importing the module
vi.mock("gifenc", () => {
  const mockGif = {
    writeFrame: vi.fn(),
    finish: vi.fn(),
    bytesView: vi.fn(() => new Uint8Array([71, 73, 70])), // GIF header bytes
  };
  return {
    default: vi.fn(() => mockGif),
    quantize: vi.fn(() => [[0, 0, 0]]),
    applyPalette: vi.fn(() => new Uint8Array([0])),
  };
});

import { encodeGifFromFrames, stripAnsi } from "../../src/utils/recording/gifEncoder";

function makeImageData(w: number, h: number) {
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h } as unknown as ImageData;
}

describe("gifEncoder", () => {
  describe("encodeGifFromFrames", () => {
    it("returns a Blob of type image/gif", () => {
      const blob = encodeGifFromFrames([makeImageData(2, 2)], {
        width: 2,
        height: 2,
        delayMs: 100,
      });
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("image/gif");
    });

    it("processes multiple frames without error", () => {
      const frames = [makeImageData(4, 4), makeImageData(4, 4), makeImageData(4, 4)];
      const blob = encodeGifFromFrames(frames, { width: 4, height: 4 });
      expect(blob).toBeInstanceOf(Blob);
    });

    it("uses default options when not specified", () => {
      const blob = encodeGifFromFrames([makeImageData(1, 1)], { width: 1, height: 1 });
      expect(blob).toBeInstanceOf(Blob);
    });
  });

  describe("stripAnsi", () => {
    it("strips CSI sequences", () => {
      expect(stripAnsi("\x1b[31mhello\x1b[0m")).toBe("hello");
    });

    it("strips OSC sequences", () => {
      expect(stripAnsi("\x1b]0;title\x07text")).toBe("text");
    });

    it("returns plain text unchanged", () => {
      expect(stripAnsi("plain text")).toBe("plain text");
    });

    it("handles empty string", () => {
      expect(stripAnsi("")).toBe("");
    });

    it("strips multiple nested sequences", () => {
      const input = "\x1b[1m\x1b[32mBold Green\x1b[0m normal";
      expect(stripAnsi(input)).toBe("Bold Green normal");
    });
  });
});
