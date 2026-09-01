import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { RdpFramePipeline } from "../../src/components/rdp/rdpFramePipeline";
import {
  normalizeRdpFramePayload,
  RdpFramePayloadError,
} from "../../src/utils/rdp/rdpFramePayload";

function buildRgbaFrame(width = 16, height = 16): ArrayBuffer {
  const frame = new ArrayBuffer(8 + width * height * 4);
  const header = new DataView(frame);
  header.setUint16(0, 1, true);
  header.setUint16(2, 2, true);
  header.setUint16(4, width, true);
  header.setUint16(6, height, true);
  new Uint8Array(frame, 8).fill(0x7f);
  return frame;
}

describe("RDP frame IPC payload normalization", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps owned ArrayBuffers and full typed-array views zero-copy", () => {
    const buffer = buildRgbaFrame();
    const fullView = new Uint8Array(buffer);

    expect(normalizeRdpFramePayload(buffer)).toBe(buffer);
    expect(normalizeRdpFramePayload(fullView)).toBe(buffer);
  });

  it("copies foreign-realm ArrayBuffers into the renderer realm", () => {
    const foreignBuffer = runInNewContext(
      "Uint8Array.from([1, 2, 3, 4]).buffer",
    ) as ArrayBuffer;

    expect(foreignBuffer).not.toBeInstanceOf(ArrayBuffer);

    const normalized = normalizeRdpFramePayload(foreignBuffer);

    expect(normalized).toBeInstanceOf(ArrayBuffer);
    expect(normalized).not.toBe(foreignBuffer);
    expect(Array.from(new Uint8Array(normalized))).toEqual([1, 2, 3, 4]);
  });

  it("copies only an offset view so worker transfer cannot detach unrelated bytes", () => {
    const backing = new Uint8Array([0xee, 1, 2, 3, 4, 0xff]);
    const frameView = backing.subarray(1, 5);

    const normalized = normalizeRdpFramePayload(frameView);

    expect(normalized).not.toBe(backing.buffer);
    expect(Array.from(new Uint8Array(normalized))).toEqual([1, 2, 3, 4]);
    expect(Array.from(backing)).toEqual([0xee, 1, 2, 3, 4, 0xff]);
  });

  it("accepts Tauri's postMessage-fallback number[] shape with one validated copy", () => {
    const source = Array.from(new Uint8Array(buildRgbaFrame()));

    const normalized = normalizeRdpFramePayload(source);

    expect(normalized).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(normalized))).toEqual(source);
  });

  it("rejects malformed or oversized serialized bytes instead of clamping them", () => {
    expect(() => normalizeRdpFramePayload([0, 1, 256])).toThrowError(
      RdpFramePayloadError,
    );
    expect(() => normalizeRdpFramePayload([0, 1, 1.5])).toThrowError(
      /invalid byte at index 2/,
    );
    expect(() => normalizeRdpFramePayload([0, 1, 2, 3], 3)).toThrowError(
      /maximum 3/,
    );
    expect(() => normalizeRdpFramePayload({ 0: 1, length: 1 })).toThrowError(
      /unsupported frame payload type/,
    );
  });

  it("keeps byte accounting finite and bounded under serialized-frame pressure", () => {
    const pipeline = new RdpFramePipeline({ scheduling: "vsync" });
    const serializedFrame = Array.from(new Uint8Array(buildRgbaFrame()));

    expect(() => {
      for (let index = 0; index < 1_000; index += 1) {
        pipeline.onFrame(serializedFrame);
      }
    }).not.toThrow();

    const metrics = pipeline.getMetrics();
    expect(metrics.receivedFrames).toBe(1_000);
    expect(metrics.queuedFrames).toBe(12);
    expect(metrics.queuedBytes).toBe(12 * serializedFrame.length);
    expect(Number.isFinite(metrics.queuedBytes)).toBe(true);
    expect(metrics.droppedFrames).toBe(988);
    expect(console.error).not.toHaveBeenCalled();
    pipeline.destroy();
  });

  it("drops and diagnoses malformed channel values without poisoning pressure metrics", () => {
    const pipeline = new RdpFramePipeline({ scheduling: "vsync" });

    pipeline.onFrame([0, 1, 2, 3, 4, 5, 6, 999]);
    pipeline.onFrame([0, 1, 2]);
    pipeline.onFrame({ byteLength: 8 });

    expect(pipeline.getMetrics()).toMatchObject({
      receivedFrames: 3,
      queuedFrames: 0,
      queuedBytes: 0,
      droppedFrames: 3,
      droppedBytes: 11,
    });
    expect(console.error).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Rejected malformed frame payload"),
    );
    pipeline.destroy();
  });
});
