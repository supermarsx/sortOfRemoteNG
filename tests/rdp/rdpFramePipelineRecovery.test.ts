import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RdpFramePipeline } from "../../src/components/rdp/rdpFramePipeline";
import {
  parseAnnexBAccessUnit,
  type AnnexBAccessUnit,
} from "../../src/components/rdp/rdpRenderers";
import type { RdpH264RecoveryEvent } from "../../src/types/rdp/rdpEvents";

const NAL_MAGIC = 0x4e414c48;

function annexB(...nalUnits: number[][]): Uint8Array {
  return new Uint8Array(
    nalUnits.flatMap((unit, index) => [
      ...(index % 2 === 0 ? [0, 0, 0, 1] : [0, 0, 1]),
      ...unit,
    ]),
  );
}

function buildNalFrame(
  payload = annexB(
    [0x67, 0x42, 0x00, 0x1f],
    [0x68, 0xce, 0x06, 0xe2],
    [0x65, 0x88, 0x84, 0x21],
  ),
): ArrayBuffer {
  const frame = new ArrayBuffer(16 + payload.byteLength);
  const view = new DataView(frame);
  view.setUint32(0, NAL_MAGIC, true);
  view.setUint16(10, 1920, true);
  view.setUint16(12, 1080, true);
  new Uint8Array(frame, 16).set(payload);
  return frame;
}

function buildRgbaFrame(byteLength = 8): ArrayBuffer {
  return new ArrayBuffer(Math.max(8, byteLength));
}

function expectKinds(
  parsed: AnnexBAccessUnit,
  expected: Array<"sps" | "pps" | "idr" | "delta" | "other">,
): void {
  expect(parsed.valid).toBe(true);
  expect(parsed.nalUnits.map((unit) => unit.kind)).toEqual(expected);
}

describe("RDP frame pipeline recovery", () => {
  let nextAnimationFrameId = 1;
  let scheduledFrames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    scheduledFrames = new Map();
    nextAnimationFrameId = 1;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextAnimationFrameId++;
        scheduledFrames.set(id, callback);
        return id;
      }),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        scheduledFrames.delete(id);
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const flushScheduledFrames = () => {
    while (scheduledFrames.size > 0) {
      const callbacks = [...scheduledFrames.values()];
      scheduledFrames.clear();
      callbacks.forEach((callback) => callback(performance.now()));
    }
  };

  it("parses mixed three- and four-byte Annex-B access units by NAL type", () => {
    const parsed = parseAnnexBAccessUnit(
      annexB(
        [0x67, 0x42, 0x00, 0x1f],
        [0x68, 0xce, 0x06, 0xe2],
        [0x65, 0x88, 0x84, 0x21],
        [0x41, 0x9a, 0x22],
        [0x06, 0x05],
      ),
    );

    expectKinds(parsed, ["sps", "pps", "idr", "delta", "other"]);
    expect(parsed).toMatchObject({
      hasSps: true,
      hasPps: true,
      hasIdr: true,
      hasDelta: true,
    });
  });

  it.each([
    new Uint8Array([0x65, 0x01]),
    new Uint8Array([0, 0, 0, 1]),
    new Uint8Array([0xff, 0, 0, 1, 0x65]),
    new Uint8Array([0, 0, 1, 0x80]),
  ])("rejects malformed Annex-B input %#", (payload) => {
    const parsed = parseAnnexBAccessUnit(payload);
    expect(parsed.valid).toBe(false);
    expect(parsed.nalUnits).toEqual([]);
    expect(parsed.malformedReason).toBeTruthy();
  });

  it.each([100, 500, 1_000])(
    "keeps %i queued and pre-attach frames within both hard bounds",
    (frameCount) => {
      const pipeline = new RdpFramePipeline({ scheduling: "vsync" });
      for (let index = 0; index < frameCount; index += 1) {
        pipeline.onFrame(buildRgbaFrame());
      }

      let metrics = pipeline.getMetrics();
      expect(metrics.queuedFrames).toBeLessThanOrEqual(12);
      expect(metrics.queuedBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
      flushScheduledFrames();
      metrics = pipeline.getMetrics();
      expect(metrics.preAttachFrames).toBeLessThanOrEqual(4);
      expect(metrics.preAttachBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
      expect(metrics.queuedFrames).toBe(0);
      pipeline.destroy();
    },
  );

  it("enforces byte caps before insertion and never overshoots", () => {
    const pipeline = new RdpFramePipeline({ scheduling: "vsync" });
    for (let index = 0; index < 8; index += 1) {
      pipeline.onFrame(buildRgbaFrame(9 * 1024 * 1024));
    }
    expect(pipeline.getMetrics().queuedBytes).toBeLessThanOrEqual(
      32 * 1024 * 1024,
    );
    flushScheduledFrames();
    expect(pipeline.getMetrics().preAttachBytes).toBeLessThanOrEqual(
      16 * 1024 * 1024,
    );

    pipeline.onFrame(buildRgbaFrame(33 * 1024 * 1024));
    expect(pipeline.getMetrics().queuedBytes).toBe(0);
    pipeline.destroy();
  });

  it("atomically drops a broken NAL chain and remains gated across RGBA", () => {
    const recoveryEvents: RdpH264RecoveryEvent[] = [];
    const pipeline = new RdpFramePipeline({
      scheduling: "vsync",
      onH264RecoveryStateChange: (event) => recoveryEvents.push(event),
    });
    for (let index = 0; index < 13; index += 1) {
      pipeline.onFrame(buildNalFrame(annexB([0x41, index & 0xff])));
    }

    const overflowMetrics = pipeline.getMetrics();
    expect(overflowMetrics.queuedFrames).toBe(1);
    expect(overflowMetrics.h264RecoveryState).toBe("awaitingRecovery");
    expect(overflowMetrics.h264RecoveryReason).toBe("queue-overflow");
    expect(recoveryEvents).toEqual([
      {
        state: "awaitingRecovery",
        episode: 1,
        reason: "queue-overflow",
      },
    ]);

    pipeline.onFrame(buildRgbaFrame());
    expect(pipeline.getMetrics().h264RecoveryState).toBe("awaitingRecovery");
    expect(recoveryEvents).toHaveLength(1);
    pipeline.destroy();
  });

  it("clears local work in the background, keeps transport input bounded, and requests recovery on visibility", () => {
    const recoveryEvents: RdpH264RecoveryEvent[] = [];
    const pipeline = new RdpFramePipeline({
      scheduling: "vsync",
      onH264RecoveryStateChange: (event) => recoveryEvents.push(event),
    });
    pipeline.onFrame(buildNalFrame(annexB([0x41, 0x01])));
    pipeline.setVisibility(false);
    expect(pipeline.getMetrics()).toMatchObject({
      queuedFrames: 0,
      preAttachFrames: 0,
      h264RecoveryState: "awaitingRecovery",
      h264RecoveryReason: "background",
    });
    expect(recoveryEvents).toEqual([]);

    for (let index = 0; index < 1_000; index += 1) {
      pipeline.onFrame(
        index % 2 === 0
          ? buildNalFrame(annexB([0x41, index & 0xff]))
          : buildRgbaFrame(),
      );
    }
    expect(pipeline.getMetrics().queuedFrames).toBe(0);

    pipeline.setVisibility(true);
    expect(recoveryEvents).toEqual([
      {
        state: "awaitingRecovery",
        episode: 1,
        reason: "background",
      },
    ]);
    pipeline.destroy();
  });

  it("atomically removes old-size NALs from main and pre-attach queues while preserving RGBA", () => {
    const recoveryEvents: RdpH264RecoveryEvent[] = [];
    const pipeline = new RdpFramePipeline({
      scheduling: "vsync",
      onH264RecoveryStateChange: (event) => recoveryEvents.push(event),
    });
    pipeline.onFrame(buildNalFrame());
    pipeline.onFrame(buildRgbaFrame(64));

    pipeline.resize(1280, 720);
    expect(pipeline.getMetrics()).toMatchObject({
      queuedFrames: 1,
      h264RecoveryState: "awaitingRecovery",
      h264RecoveryReason: "resize",
    });
    flushScheduledFrames();
    expect(pipeline.getMetrics()).toMatchObject({
      queuedFrames: 0,
      preAttachFrames: 1,
    });

    pipeline.onFrame(buildNalFrame());
    flushScheduledFrames();
    expect(pipeline.getMetrics().preAttachFrames).toBe(2);
    pipeline.resize(1024, 768);
    expect(pipeline.getMetrics()).toMatchObject({
      queuedFrames: 0,
      preAttachFrames: 1,
      h264RecoveryState: "awaitingRecovery",
      h264RecoveryReason: "resize",
    });
    expect(recoveryEvents[0]).toMatchObject({
      state: "awaitingRecovery",
      reason: "resize",
    });
    pipeline.destroy();
  });

  it.each([100, 500, 1_000])(
    "keeps local work empty through %i inactive/active session switches",
    (switchCount) => {
      const pipeline = new RdpFramePipeline({ scheduling: "vsync" });
      for (let index = 0; index < switchCount; index += 1) {
        pipeline.setVisibility(false);
        pipeline.onFrame(buildNalFrame(annexB([0x41, index & 0xff])));
        pipeline.setVisibility(true);
      }
      expect(pipeline.getMetrics()).toMatchObject({
        queuedFrames: 0,
        queuedBytes: 0,
        preAttachFrames: 0,
        preAttachBytes: 0,
        h264RecoveryState: "awaitingRecovery",
      });
      pipeline.destroy();
    },
  );

  it("cleans every bounded buffer on destroy", () => {
    const pipeline = new RdpFramePipeline({ scheduling: "vsync" });
    for (let index = 0; index < 20; index += 1) {
      pipeline.onFrame(buildRgbaFrame(1024));
    }
    flushScheduledFrames();
    pipeline.destroy();
    expect(pipeline.getMetrics()).toMatchObject({
      queuedFrames: 0,
      queuedBytes: 0,
      preAttachFrames: 0,
      preAttachBytes: 0,
      destroyed: true,
    });
    expect(scheduledFrames.size).toBe(0);
  });

  it("holds native delivery completion until a queued frame is consumed or dropped", async () => {
    const pipeline = new RdpFramePipeline({ scheduling: "vsync" });
    let settled = false;
    const delivery = pipeline.onFrame(buildRgbaFrame(1024)).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(pipeline.getMetrics().queuedFrames).toBe(1);

    pipeline.setVisibility(false);
    await delivery;
    expect(settled).toBe(true);
    expect(pipeline.getMetrics().queuedFrames).toBe(0);
    pipeline.destroy();
  });

  it("settles a detached render batch and keeps scheduling after a renderer throws", async () => {
    const pipeline = new RdpFramePipeline({ scheduling: "vsync" });
    const pushRawBuffer = vi
      .fn<(data: ArrayBuffer) => void>()
      .mockImplementationOnce(() => {
        throw new Error("worker transfer failed");
      });
    const renderer = {
      name: "Throwing WebCodecs renderer",
      type: "webcodecs-worker",
      tripleBuffered: false,
      pushRawBuffer,
      paintRegion: vi.fn(),
      present: vi.fn(),
      resize: vi.fn(),
      destroy: vi.fn(),
    };
    Object.assign(pipeline as unknown as Record<string, unknown>, {
      canvas: document.createElement("canvas"),
      fb: {},
      renderer,
    });

    const failedDelivery = pipeline.onFrame(buildRgbaFrame(1024));
    flushScheduledFrames();
    await expect(failedDelivery).resolves.toBeUndefined();
    expect(pipeline.getMetrics()).toMatchObject({
      queuedFrames: 0,
      queuedBytes: 0,
      h264RecoveryState: "awaitingRecovery",
      h264RecoveryReason: "renderer-reset",
    });

    pushRawBuffer.mockImplementation(() => {});
    const nextDelivery = pipeline.onFrame(buildRgbaFrame(1024));
    flushScheduledFrames();
    await expect(nextDelivery).resolves.toBeUndefined();
    expect(pushRawBuffer).toHaveBeenCalledTimes(2);
    expect(scheduledFrames.size).toBe(0);
    pipeline.destroy();
  });

  it("settles pre-attach delivery when detached transferred-canvas setup throws", async () => {
    const pipeline = new RdpFramePipeline({ scheduling: "vsync" });
    const delivery = pipeline.onFrame(buildRgbaFrame(1024));
    flushScheduledFrames();
    expect(pipeline.getMetrics().preAttachFrames).toBe(1);

    const detachedCanvas = document.createElement("canvas");
    Object.defineProperty(detachedCanvas, "width", {
      configurable: true,
      get: () => 16,
      set: () => {
        throw new DOMException("Canvas was transferred", "InvalidStateError");
      },
    });

    expect(() => pipeline.attach(detachedCanvas, 16, 16, "canvas2d")).toThrow(
      /Canvas was transferred/,
    );
    await expect(delivery).resolves.toBeUndefined();
    expect(pipeline.getMetrics()).toMatchObject({
      queuedFrames: 0,
      queuedBytes: 0,
      preAttachFrames: 0,
      preAttachBytes: 0,
      canvasAttached: false,
    });
    pipeline.destroy();
  });

  it("starts full-snapshot recovery when native pressure drops only RGBA", () => {
    const recoveryEvents: RdpH264RecoveryEvent[] = [];
    const pipeline = new RdpFramePipeline({
      scheduling: "vsync",
      onH264RecoveryStateChange: (event) => recoveryEvents.push(event),
    });

    pipeline.handleNativeDeliveryPressure(2, false);

    expect(pipeline.getMetrics()).toMatchObject({
      h264RecoveryState: "awaitingRecovery",
      h264RecoveryReason: "queue-overflow",
    });
    expect(recoveryEvents).toEqual([
      {
        state: "awaitingRecovery",
        episode: 1,
        reason: "queue-overflow",
      },
    ]);
    pipeline.destroy();
  });
});
