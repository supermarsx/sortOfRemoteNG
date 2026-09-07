import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useRdpFrameBackpressure,
  resolveRdpFramePressureState,
} from "../../src/hooks/rdp/useRdpFrameBackpressure";
import type { RdpFramePipelineMetrics } from "../../src/types/rdp/rdpEvents";

function metrics(): RdpFramePipelineMetrics {
  return {
    queuedFrames: 0,
    queuedBytes: 0,
    preAttachFrames: 0,
    preAttachBytes: 0,
    receivedFrames: 1,
    presentedFrames: 1,
    droppedFrames: 0,
    droppedBytes: 0,
    coalescedFrames: 0,
    lastFrameRenderMs: 2,
    averageRenderMs: 2,
    activeScheduling: "low-latency",
    renderer: "worker",
    canvasAttached: true,
    destroyed: false,
    h264RecoveryState: "healthy",
    h264RecoveryEpisode: 0,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RDP telemetry cadence", () => {
  it("stops hidden sampling and publishes visible idle heartbeats for measured zero FPS", async () => {
    vi.useFakeTimers();
    const getMetrics = vi.fn(metrics);
    const sender = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(
      ({ visible }) =>
        useRdpFrameBackpressure({
          sessionId: "one",
          getMetrics,
          sender,
          isVisible: visible,
        }),
      { initialProps: { visible: false } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getMetrics).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(hook.result.current.lastUpdate?.isVisible).toBe(false);
    hook.rerender({ visible: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(sender).toHaveBeenCalledTimes(3);
    const idleUpdate = hook.result.current.lastUpdate;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(sender).toHaveBeenCalledTimes(4);
    expect(hook.result.current.lastUpdate?.presentedFrames).toBe(
      idleUpdate?.presentedFrames,
    );
    expect(hook.result.current.lastUpdate?.sampleSequence).toBeGreaterThan(
      idleUpdate?.sampleSequence ?? 0,
    );
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles document visibility without requiring a React render", async () => {
    vi.useFakeTimers();
    let visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility as DocumentVisibilityState,
    );
    const getMetrics = vi.fn(metrics);
    const sender = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(() =>
      useRdpFrameBackpressure({ sessionId: "one", getMetrics, sender }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(1);
    });
    const hiddenSamples = getMetrics.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getMetrics).toHaveBeenCalledTimes(hiddenSamples);
    expect(hook.result.current.lastUpdate?.isVisible).toBe(false);
    hook.unmount();
  });

  it("detects a stalled worker with one outstanding frame and no fake presentation samples", () => {
    expect(
      resolveRdpFramePressureState(
        {
          ...metrics(),
          queuedFrames: 1,
          presentedFrames: 0,
          averageRenderMs: 0,
          oldestPendingRenderMs: 500,
        },
        "healthy",
      ),
    ).toBe("backpressured");
  });
});
