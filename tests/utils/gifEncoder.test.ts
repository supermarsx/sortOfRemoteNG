import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureCanvasFrame,
  createGifFrameCollector,
  encodeGifFromFrames,
  renderTerminalToGif,
  stripAnsi,
} from "../../src/utils/recording/gifEncoder";
import { IncrementalGifEncoder } from "../../src/utils/recording/gifEncodingCore";
import {
  blobBytes,
  decodeIndices,
  installGifWorker,
  mockCaptureCanvas,
  parseGif,
  pixels,
  TestGifWorker,
} from "../recording/gifTestSupport";

beforeEach(() => {
  installGifWorker();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GIF encoding", () => {
  it("encodes real GIF frames with independently decoded colors, dimensions, delays and trailer", async () => {
    const frames = [
      pixels(4, 3, [255, 0, 0, 255]),
      pixels(4, 3, [0, 255, 0, 255]),
    ];
    const blob = await encodeGifFromFrames(frames, {
      width: 4,
      height: 3,
      delayMs: 230,
    });
    expect(blob.type).toBe("image/gif");
    const gif = parseGif(await blobBytes(blob));
    expect([gif.width, gif.height]).toEqual([4, 3]);
    expect(gif.frames.map((frame) => frame.delay)).toEqual([230, 230]);
    for (let i = 0; i < 2; i++) {
      const indices = decodeIndices(gif.frames[i]);
      expect(indices).toHaveLength(12);
      for (const index of indices)
        expect(
          Array.from(gif.frames[i].palette.slice(index * 3, index * 3 + 3)),
        ).toEqual(i ? [0, 255, 0] : [255, 0, 0]);
    }
    expect(frames[0].data.byteLength).toBe(48);
    expect(TestGifWorker.instances[0].terminated).toBe(true);
  });

  it("does not execute codec work before returning; UI timers run while the worker is busy", async () => {
    TestGifWorker.responseDelay = 15;
    let settled = false;
    const encoding = encodeGifFromFrames([pixels()], {
      width: 2,
      height: 2,
    }).then((blob) => {
      settled = true;
      return blob;
    });
    expect(
      TestGifWorker.instances[0].messages.map((message) => message.type),
    ).toEqual(["init"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    await encoding;
  });

  it("rejects empty, oversize, mismatched and over-duration exports explicitly", async () => {
    await expect(
      encodeGifFromFrames([], { width: 2, height: 2 }),
    ).rejects.toThrow("No GIF frames");
    await expect(
      encodeGifFromFrames([pixels()], { width: 1920, height: 1080 }),
    ).rejects.toThrow("1280");
    await expect(
      encodeGifFromFrames([pixels()], { width: 1, height: 1 }),
    ).rejects.toThrow("dimensions changed");
    await expect(
      encodeGifFromFrames([pixels(), pixels()], {
        width: 2,
        height: 2,
        maxDurationMs: 100,
      }),
    ).rejects.toThrow("duration limit");
  });

  it("cancels an export waiting for a worker and terminates it", async () => {
    TestGifWorker.automatic = false;
    const controller = new AbortController();
    const encoding = encodeGifFromFrames(
      [pixels()],
      { width: 2, height: 2 },
      controller.signal,
    );
    controller.abort();
    await expect(encoding).rejects.toMatchObject({ name: "AbortError" });
    expect(TestGifWorker.instances[0].terminated).toBe(true);
  });

  it("preserves long busy gaps in GIF frame delays", async () => {
    const encoder = new IncrementalGifEncoder({ width: 2, height: 2 });
    encoder.addFrame(pixels().data.buffer as ArrayBuffer, 0);
    encoder.addFrame(pixels().data.buffer as ArrayBuffer, 2800);
    const result = encoder.finish(3100);
    expect(
      parseGif(await blobBytes(result.blob)).frames.map((frame) => frame.delay),
    ).toEqual([2800, 300]);
    expect(result.durationMs).toBe(3100);
  });

  it("returns a valid, bounded partial GIF with explicit status on encoded byte limits", async () => {
    const encoder = new IncrementalGifEncoder({
      width: 2,
      height: 2,
      maxEncodedBytes: 120,
    });
    let result = encoder.addFrame(pixels().data.buffer as ArrayBuffer, 0);
    for (let i = 1; i < 100 && !result; i++)
      result = encoder.addFrame(pixels().data.buffer as ArrayBuffer, i * 100);
    expect(result?.limit).toContain("size limit");
    expect(result!.blob.size).toBeLessThanOrEqual(120);
    const gif = parseGif(await blobBytes(result!.blob));
    expect(gif.frames.length).toBeGreaterThan(0);
    expect(gif.frames.reduce((sum, frame) => sum + frame.delay, 0)).toBe(
      result!.durationMs,
    );
  });
});

describe("bounded canvas capture", () => {
  it("reads only a staging canvas and downscales GPU/worker-owned source canvases", () => {
    const ctx = mockCaptureCanvas();
    const canvas = document.createElement("canvas");
    canvas.width = 3840;
    canvas.height = 2160;
    canvas.getContext = vi.fn(() => {
      throw new Error("Source belongs to a GPU worker");
    });
    const frame = captureCanvasFrame(canvas)!;
    expect([frame.width, frame.height]).toEqual([1280, 720]);
    expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 0, 0, 1280, 720);
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it("does not capture or queue pixels while initialization/encoding is busy", async () => {
    TestGifWorker.automatic = false;
    const ctx = mockCaptureCanvas();
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const collector = createGifFrameCollector(canvas);
    expect(collector.captureFrame(0)).toBe(true);
    for (let i = 0; i < 1000; i++)
      expect(collector.captureFrame(i)).toBe(false);
    expect(ctx.getImageData).not.toHaveBeenCalled();
    const worker = TestGifWorker.instances[0];
    worker.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.getImageData).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 1000; i++)
      expect(collector.captureFrame(i)).toBe(false);
    expect(worker.queue).toHaveLength(1);
    expect(worker.queue[0].type).toBe("frame");
    collector.clear();
    await expect(collector.encode(1000)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(worker.terminated).toBe(true);
  });

  it("finishes at the duration bound with a valid file and limit callback", async () => {
    mockCaptureCanvas();
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const onLimit = vi.fn();
    const collector = createGifFrameCollector(canvas, {
      maxDurationMs: 100,
      onLimit,
    });
    collector.captureFrame(0);
    await new Promise((resolve) => setTimeout(resolve, 15));
    collector.captureFrame(150);
    const blob = await collector.encode(150);
    expect(parseGif(await blobBytes(blob)).frames[0].delay).toBe(100);
    expect(onLimit).toHaveBeenCalledOnce();
    expect(collector.captureFrame(200)).toBe(false);
    expect(TestGifWorker.instances[0].terminated).toBe(true);
    collector.clear();
  });
});

describe("terminal GIF export", () => {
  it("shows output at time zero throughout a long idle gap, then the final output", async () => {
    const ctx = mockCaptureCanvas();
    const blob = await renderTerminalToGif(
      [
        { timestamp_ms: 0, data: "A", entry_type: "Output" },
        { timestamp_ms: 240_000, data: "B", entry_type: "Output" },
      ],
      { cols: 2, rows: 1, maxFrames: 3 },
    );
    expect(ctx.fillText.mock.calls.map((call) => call[0])).toEqual([
      "  ",
      "A ",
      "AB",
    ]);
    expect(
      parseGif(await blobBytes(blob)).frames.map((frame) => frame.delay),
    ).toEqual([240_000, 100]);
  });
  it("retains the terminal state immediately before a long idle gap", async () => {
    const ctx = mockCaptureCanvas();
    const blob = await renderTerminalToGif(
      [
        { timestamp_ms: 0, data: "A", entry_type: "Output" },
        { timestamp_ms: 100, data: "B", entry_type: "Output" },
        { timestamp_ms: 240_000, data: "C", entry_type: "Output" },
      ],
      { cols: 3, rows: 1, maxFrames: 3 },
    );
    expect(ctx.fillText.mock.calls.map((call) => call[0])).toEqual([
      "   ",
      "A  ",
      "AB ",
      "ABC",
    ]);
    expect(
      parseGif(await blobBytes(blob)).frames.map((frame) => frame.delay),
    ).toEqual([100, 239_900, 100]);
  });
  it("samples through the final state without shortening idle gaps or retaining RGBA frames", async () => {
    const ctx = mockCaptureCanvas();
    const blob = await renderTerminalToGif(
      [
        { timestamp_ms: 0, data: "A", entry_type: "Output" },
        { timestamp_ms: 1000, data: "B", entry_type: "Output" },
        { timestamp_ms: 2000, data: "C", entry_type: "Output" },
        { timestamp_ms: 9000, data: "Z", entry_type: "Output" },
      ],
      { cols: 4, rows: 1, maxFrames: 3 },
    );
    const gif = parseGif(await blobBytes(blob));
    expect(gif.frames.length).toBeLessThanOrEqual(3);
    expect(gif.frames.reduce((sum, frame) => sum + frame.delay, 0)).toBe(9100);
    expect(ctx.fillText).toHaveBeenLastCalledWith("ABCZ", 8, 8);
    expect(TestGifWorker.instances[0].terminated).toBe(true);
  });
  it("rejects long exports before allocating a worker", async () => {
    await expect(
      renderTerminalToGif(
        [{ timestamp_ms: 400_000, data: "hello", entry_type: "Output" }],
        { cols: 80, rows: 24 },
      ),
    ).rejects.toThrow("5 minutes");
    expect(TestGifWorker.instances).toHaveLength(0);
  });
});

describe("stripAnsi", () => {
  it.each([
    ["\x1b[31mhello\x1b[0m", "hello"],
    ["\x1b]0;title\x07text", "text"],
    ["plain text", "plain text"],
    ["", ""],
    ["\x1b[1m\x1b[32mBold Green\x1b[0m normal", "Bold Green normal"],
  ])("strips terminal escapes: %s", (input, expected) =>
    expect(stripAnsi(input)).toBe(expected),
  );
});
