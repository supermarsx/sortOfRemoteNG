import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionRecorder } from "../../src/hooks/recording/useSessionRecorder";
import {
  installGifWorker,
  mockCaptureCanvas,
  TestGifWorker,
} from "./gifTestSupport";

beforeEach(() => {
  vi.useFakeTimers();
  installGifWorker();
  mockCaptureCanvas();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const setup = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  return renderHook(() => useSessionRecorder({ current: canvas }));
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const frameTimes = (worker: TestGifWorker) =>
  worker.messages
    .filter((message) => message.type === "frame")
    .map((message) => (message.type === "frame" ? message.timestampMs : -1));

describe("GIF recording lifecycle", () => {
  it("preserves configured FPS after pause/resume and excludes paused time from the encoded duration", async () => {
    const { result, unmount } = setup();
    act(() => {
      expect(result.current.startRecording("gif", 2)).toBe(true);
    });
    await advance(400);
    const worker = TestGifWorker.instances[0];
    expect(frameTimes(worker)).toEqual([0]);
    act(() => {
      result.current.pauseRecording();
    });
    await advance(10_000);
    expect(frameTimes(worker)).toEqual([0]);
    act(() => {
      result.current.resumeRecording();
      result.current.resumeRecording();
    });
    await advance(499);
    expect(frameTimes(worker)).toEqual([0]);
    await advance(2);
    expect(frameTimes(worker)).toEqual([0, 900]);
    let stopped!: Promise<Blob | null>;
    act(() => {
      stopped = result.current.stopRecording();
    });
    expect(result.current.state.isFinalizing).toBe(true);
    await advance(10);
    expect(await stopped).toBeInstanceOf(Blob);
    expect(result.current.getRecordingDetails()?.durationMs).toBe(920);
    expect(worker.terminated).toBe(true);
    expect(result.current.state.isRecording).toBe(false);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmount cancels and settles a stop waiting on worker initialization", async () => {
    TestGifWorker.automatic = false;
    const { result, unmount } = setup();
    act(() => {
      result.current.startRecording("gif");
    });
    let stopped!: Promise<Blob | null>;
    act(() => {
      stopped = result.current.stopRecording();
    });
    unmount();
    expect(await stopped).toBeNull();
    expect(TestGifWorker.instances[0].terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects restarting while a requested save is finalizing, then permits a new recording", async () => {
    const { result, unmount } = setup();
    act(() => {
      result.current.startRecording("gif");
    });
    await advance(10);
    TestGifWorker.automatic = false;
    let stopped!: Promise<Blob | null>;
    act(() => {
      stopped = result.current.stopRecording();
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      expect(result.current.startRecording("gif", 3)).toBe(false);
    });
    expect(result.current.state.isFinalizing).toBe(true);
    await act(async () => {
      TestGifWorker.instances[0].flush();
      expect(await stopped).toBeInstanceOf(Blob);
    });
    expect(TestGifWorker.instances[0].terminated).toBe(true);
    act(() => {
      expect(result.current.startRecording("gif", 3)).toBe(true);
    });
    expect(result.current.state.isRecording).toBe(true);
    expect(result.current.state.error).toBeNull();
    unmount();
    expect(TestGifWorker.instances[1].terminated).toBe(true);
  });

  it("worker errors stop capture, release resources, and expose a user-visible error", async () => {
    const { result, unmount } = setup();
    act(() => {
      result.current.startRecording("gif");
    });
    await advance(10);
    const worker = TestGifWorker.instances[0];
    await act(async () => {
      worker.onerror?.({
        preventDefault() {},
        message: "Worker failed",
      } as ErrorEvent);
    });
    expect(result.current.state.isRecording).toBe(false);
    expect(result.current.state.error).toBeTruthy();
    expect(worker.terminated).toBe(true);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("automatically ends capture at the duration bound and exposes the valid result for saving", async () => {
    const { result, unmount } = setup();
    act(() => {
      result.current.startRecording("gif", 0.1);
    });
    await advance(300_010);
    expect(result.current.state.limitReached).toContain("duration limit");
    expect(result.current.state.isPaused).toBe(true);
    expect(result.current.state.duration).toBe(300);
    let stopped!: Promise<Blob | null>;
    act(() => {
      stopped = result.current.stopRecording();
    });
    await act(async () => {
      expect(await stopped).toBeInstanceOf(Blob);
    });
    expect(result.current.getRecordingDetails()?.durationMs).toBe(300_000);
    expect(TestGifWorker.instances[0].terminated).toBe(true);
    unmount();
  });

  it("rejects invalid FPS and unavailable workers without recording or leaving timers", () => {
    const { result, unmount } = setup();
    act(() => {
      expect(result.current.startRecording("gif", 0)).toBe(false);
    });
    expect(TestGifWorker.instances).toHaveLength(0);
    vi.stubGlobal("Worker", undefined);
    act(() => {
      expect(result.current.startRecording("gif")).toBe(false);
    });
    expect(result.current.state.error).toContain("Web Worker");
    expect(result.current.state.isRecording).toBe(false);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
