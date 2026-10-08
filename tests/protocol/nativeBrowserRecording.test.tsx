import React from "react";
import { Blob as NodeBlob } from "node:buffer";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  NATIVE_VIDEO_LIMITS,
  useNativeBrowserRecording,
  type NativeBrowserHarAdapter,
} from "../../src/hooks/protocol/useNativeBrowserRecording";
import NativeBrowserRecordingControls from "../../src/components/protocol/webBrowser/NativeBrowserRecordingControls";

const access = vi.hoisted(() => ({
  listener: undefined as (() => void) | undefined,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: (fn: () => void) => {
    access.listener = fn;
    return () => {
      access.listener = undefined;
    };
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));

class Track extends EventTarget {
  readyState = "live";
  stop = vi.fn(() => {
    this.readyState = "ended";
  });
}
class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported = vi.fn(() => true);
  state = "inactive";
  mimeType = "video/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    queueMicrotask(() => {
      this.data(new Blob(["final"]));
      this.onstop?.();
    });
  });
  pause = vi.fn(() => {
    this.state = "paused";
  });
  resume = vi.fn(() => {
    this.state = "recording";
  });
  constructor() {
    Recorder.instances.push(this);
  }
  data(blob: Blob) {
    this.ondataavailable?.({ data: blob });
  }
}
const identity = {
  ownerDatabaseId: "database",
  connectionId: "connection",
  sessionId: "session",
  attemptId: "attempt",
};
function options() {
  return {
    identity,
    viewId: null as string | null,
    enabled: true,
    assertOwner: vi.fn(),
    har: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
let tracks: Track[], capture: ReturnType<typeof vi.fn>;
function stream() {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  } as unknown as MediaStream;
}
const recorder = () => Recorder.instances[Recorder.instances.length - 1]!;
async function start(result: {
  current: ReturnType<typeof useNativeBrowserRecording>;
}) {
  await act(async () => {
    expect(await result.current.startVideo()).toBe(true);
  });
}
async function stop(result: {
  current: ReturnType<typeof useNativeBrowserRecording>;
}) {
  await act(async () => {
    result.current.stopVideo();
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  Recorder.instances = [];
  Recorder.isTypeSupported.mockReturnValue(true);
  tracks = [new Track(), new Track()];
  capture = vi.fn().mockImplementation(async () => stream());
  vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: capture } });
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("Blob", NodeBlob);
  vi.mocked(save).mockResolvedValue("C:/chosen/recording.webm");
  vi.mocked(writeFile).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded native video lifecycle", () => {
  it("captures once, pauses/resumes, stops every track, and requires explicit Save", async () => {
    const { result } = renderHook(() => useNativeBrowserRecording(options()));
    await start(result);
    await act(async () => {
      expect(await result.current.startVideo()).toBe(false);
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ audio: false }),
    );
    expect(recorder().start).toHaveBeenCalledWith(1000);
    act(() => result.current.pauseVideo());
    expect(result.current.video.phase).toBe("paused");
    act(() => result.current.pauseVideo());
    expect(result.current.video.phase).toBe("recording");
    act(() => recorder().data(new Blob(["first"])));
    await stop(result);
    expect(result.current.video.phase).toBe("ready");
    expect(result.current.video.bytes).toBe(10);
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    const written: number[][] = [];
    vi.mocked(writeFile).mockImplementation(async (_path, bytes) => {
      written.push([...(bytes as Uint8Array)]);
    });
    await act(async () => {
      expect(await result.current.saveVideo()).toBe(true);
    });
    expect(written[0]).toEqual([...new TextEncoder().encode("firstfinal")]);
    expect(result.current.video.phase).toBe("idle");
  });
  it("captures final chunks when sharing ends without exporting automatically", async () => {
    const { result } = renderHook(() => useNativeBrowserRecording(options()));
    await start(result);
    await act(async () => tracks[0].dispatchEvent(new Event("ended")));
    expect(result.current.video.phase).toBe("ready");
    expect(result.current.video.bytes).toBe(5);
    expect(save).not.toHaveBeenCalled();
    act(() => result.current.discardVideo());
    expect(result.current.video.bytes).toBe(0);
  });
  it.each(["disable", "attempt", "view", "unmount"])(
    "stops and discards on %s",
    async (change) => {
      const initial = options();
      const { result, rerender, unmount } = renderHook(
        (o) => useNativeBrowserRecording(o),
        { initialProps: initial },
      );
      await start(result);
      act(() => recorder().data(new Blob(["private"])));
      if (change === "unmount") unmount();
      else
        rerender({
          ...initial,
          enabled: change !== "disable",
          viewId: change === "view" ? "child" : null,
          identity:
            change === "attempt"
              ? { ...identity, attemptId: "new-attempt" }
              : identity,
        });
      for (const track of tracks) expect(track.stop).toHaveBeenCalled();
      expect(recorder().ondataavailable).toBeNull();
      expect(save).not.toHaveBeenCalled();
      if (change !== "unmount") expect(result.current.video.bytes).toBe(0);
    },
  );
  it("reacts synchronously to owner revocation without waiting for a rerender", async () => {
    const o = options();
    const { result } = renderHook(() => useNativeBrowserRecording(o));
    await start(result);
    o.assertOwner.mockImplementation(() => {
      throw new Error("revoked");
    });
    act(() => access.listener?.());
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
    expect(result.current.available).toBe(false);
    expect(result.current.video.bytes).toBe(0);
  });
  it.each(["cancel", "unmount", "view"])(
    "rejects a late capture picker after %s",
    async (change) => {
      const picker = deferred<MediaStream>();
      capture.mockReturnValue(picker.promise);
      const initial = options();
      const { result, rerender, unmount } = renderHook(
        (o) => useNativeBrowserRecording(o),
        { initialProps: initial },
      );
      let starting!: Promise<boolean>;
      act(() => {
        starting = result.current.startVideo();
      });
      if (change === "unmount") unmount();
      else if (change === "view") rerender({ ...initial, viewId: "child" });
      else act(() => result.current.discardVideo());
      await act(async () => {
        picker.resolve(stream());
        expect(await starting).toBe(false);
      });
      for (const track of tracks) expect(track.stop).toHaveBeenCalled();
      expect(Recorder.instances).toHaveLength(0);
    },
  );
  it("discards oversized chunks without retaining or exporting a corrupt partial recording", async () => {
    const { result } = renderHook(() => useNativeBrowserRecording(options()));
    await start(result);
    act(() => recorder().data({ size: NATIVE_VIDEO_LIMITS.bytes + 1 } as Blob));
    expect(result.current.video.phase).toBe("idle");
    expect(result.current.video.bytes).toBe(0);
    expect(result.current.video.message).toMatch(/memory limit/);
    expect(save).not.toHaveBeenCalled();
  });
  it("bounds the number of retained chunks", async () => {
    const { result } = renderHook(() => useNativeBrowserRecording(options()));
    await start(result);
    act(() => {
      for (let i = 0; i <= NATIVE_VIDEO_LIMITS.chunks; i++)
        recorder().data(new Blob(["a"]));
    });
    expect(result.current.video.phase).toBe("idle");
    expect(result.current.video.bytes).toBe(0);
    expect(recorder().ondataavailable).toBeNull();
  });
  it("stops at the elapsed-time limit even while paused", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const { result } = renderHook(() => useNativeBrowserRecording(options()));
    await start(result);
    act(() => result.current.pauseVideo());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NATIVE_VIDEO_LIMITS.milliseconds);
    });
    expect(result.current.video.phase).toBe("ready");
    expect(result.current.video.message).toMatch(/10-minute/);
    expect(save).not.toHaveBeenCalled();
  });
  it("cleans up a recorder that never emits stop", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const { result } = renderHook(() => useNativeBrowserRecording(options()));
    await start(result);
    recorder().stop.mockImplementation(() => {
      recorder().state = "inactive";
    });
    await stop(result);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.video.phase).toBe("idle");
    expect(result.current.video.message).toMatch(/did not finish/);
  });
  it("releases tracks when the recorder fails and does not expose raw error text", async () => {
    const { result } = renderHook(() => useNativeBrowserRecording(options()));
    await start(result);
    act(() => recorder().onerror?.());
    expect(result.current.video.phase).toBe("idle");
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
  });
  it("fails clearly without a supported capture API or codec", async () => {
    Recorder.isTypeSupported.mockReturnValue(false);
    const { result } = renderHook(() => useNativeBrowserRecording(options()));
    await act(async () => {
      expect(await result.current.startVideo()).toBe(false);
    });
    expect(capture).not.toHaveBeenCalled();
    expect(result.current.video.message).toMatch(/unavailable/);
  });
});

describe("explicit video export", () => {
  it("retains a recording after destination cancellation or write failure", async () => {
    const { result } = renderHook(() => useNativeBrowserRecording(options()));
    await start(result);
    await stop(result);
    vi.mocked(save).mockResolvedValueOnce(null);
    await act(async () => {
      expect(await result.current.saveVideo()).toBe(false);
    });
    expect(result.current.video.phase).toBe("ready");
    expect(writeFile).not.toHaveBeenCalled();
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("private filename"));
    await act(async () => {
      expect(await result.current.saveVideo()).toBe(false);
    });
    expect(result.current.video.phase).toBe("ready");
    expect(result.current.video.message).not.toContain("private filename");
  });
  it("does not write after revocation while the destination picker is open", async () => {
    const o = options(),
      picker = deferred<string | null>();
    const { result } = renderHook(() => useNativeBrowserRecording(o));
    await start(result);
    await stop(result);
    vi.mocked(save).mockReturnValue(picker.promise);
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.saveVideo();
    });
    o.assertOwner.mockImplementation(() => {
      throw new Error();
    });
    await act(async () => {
      picker.resolve("C:/chosen/output.webm");
      expect(await saving).toBe(false);
    });
    expect(writeFile).not.toHaveBeenCalled();
  });
});

function har(): NativeBrowserHarAdapter {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    discard: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue("saved"),
  };
}
describe("native HAR adapter and panel", () => {
  it("uses final native counters even when Stop precedes the first poll", async () => {
    const adapter = har();
    vi.mocked(adapter.stop).mockResolvedValue({
      phase: "stopped",
      durationMs: 20,
      entryCount: 7,
      droppedEntries: 2,
    });
    const { result } = renderHook(() =>
      useNativeBrowserRecording({ ...options(), har: adapter }),
    );
    await act(async () => {
      await result.current.startHar();
      await result.current.stopHar();
    });
    expect(result.current.har.entryCount).toBe(7);
    expect(result.current.har.droppedEntries).toBe(2);
    expect(result.current.har.phase).toBe("ready");
    await act(async () => {
      await result.current.discardHar();
    });
    expect(result.current.har.entryCount).toBe(0);
    expect(result.current.har.droppedEntries).toBe(0);
  });
  it("ignores stale controls across a root-child-root selection round trip", async () => {
    const initial = options();
    const { result, rerender } = renderHook(
      (o) => useNativeBrowserRecording(o),
      { initialProps: initial },
    );
    const stale = result.current;
    rerender({ ...initial, viewId: "child" });
    rerender(initial);
    await act(async () => {
      expect(await stale.startVideo()).toBe(false);
    });
    expect(capture).not.toHaveBeenCalled();
    await start(result);
    act(() => {
      stale.stopVideo();
      stale.discardVideo();
      stale.pauseVideo();
    });
    expect(result.current.video.phase).toBe("recording");
  });
  it("polls HAR only while recording, reports native limits and never exports them automatically", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const adapter: NativeBrowserHarAdapter = {
      ...har(),
      status: vi.fn().mockResolvedValue({
        phase: "limitReached",
        durationMs: 1800000,
        entryCount: 2048,
        droppedEntries: 3,
      }),
    };
    const { result } = renderHook(() =>
      useNativeBrowserRecording({ ...options(), har: adapter }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(adapter.status).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.startHar();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.har.phase).toBe("ready");
    expect(result.current.har.entryCount).toBe(2048);
    expect(result.current.har.droppedEntries).toBe(3);
    expect(result.current.har.message).toMatch(/limit/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(adapter.status).toHaveBeenCalledTimes(1);
    expect(adapter.save).not.toHaveBeenCalled();
  });
  it("queues Stop behind an in-flight status without dropping the user's click", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const pending = deferred<null>();
    const adapter: NativeBrowserHarAdapter = {
      ...har(),
      status: vi.fn().mockReturnValue(pending.promise),
    };
    const { result } = renderHook(() =>
      useNativeBrowserRecording({ ...options(), har: adapter }),
    );
    await act(async () => {
      await result.current.startHar();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    let stopping!: Promise<boolean>;
    act(() => {
      stopping = result.current.stopHar();
    });
    expect(adapter.stop).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve(null);
      expect(await stopping).toBe(true);
    });
    expect(adapter.stop).toHaveBeenCalledTimes(1);
    expect(result.current.har.phase).toBe("ready");
  });
  it("targets the exact selected view and does not save on stop", async () => {
    const adapter = har();
    const { result } = renderHook(() =>
      useNativeBrowserRecording({
        ...options(),
        viewId: "child",
        har: adapter,
      }),
    );
    await act(async () => {
      await result.current.startHar();
      await result.current.stopHar();
    });
    expect(adapter.start).toHaveBeenCalledExactlyOnceWith({
      identity,
      viewId: "child",
    });
    expect(result.current.har.phase).toBe("ready");
    expect(adapter.save).not.toHaveBeenCalled();
    vi.mocked(adapter.save).mockResolvedValueOnce("cancelled");
    await act(async () => {
      await result.current.saveHar();
    });
    expect(result.current.har.phase).toBe("ready");
    await act(async () => {
      await result.current.discardHar();
    });
    expect(result.current.har.phase).toBe("idle");
  });
  it("discards a late HAR start after owner unmount and serializes duplicate starts", async () => {
    const adapter = har(),
      pending = deferred<void>();
    vi.mocked(adapter.start).mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() =>
      useNativeBrowserRecording({ ...options(), har: adapter }),
    );
    let starting!: Promise<boolean>;
    await act(async () => {
      starting = result.current.startHar();
    });
    await act(async () => {
      expect(await result.current.startHar()).toBe(false);
    });
    unmount();
    await act(async () => {
      pending.resolve();
      expect(await starting).toBe(false);
    });
    expect(adapter.start).toHaveBeenCalledTimes(1);
    expect(adapter.discard).toHaveBeenCalledExactlyOnceWith({
      identity,
      viewId: null,
    });
    expect(adapter.save).not.toHaveBeenCalled();
  });
  it("shows unavailable HAR, explicit video actions, and keeps capture across panel closure", async () => {
    const { result } = renderHook(() => useNativeBrowserRecording(options()));
    const panel = render(
      <NativeBrowserRecordingControls controller={result.current} />,
    );
    expect(screen.getByRole("button", { name: "Start HAR" })).toBeDisabled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Start video" })),
    );
    panel.rerender(
      <NativeBrowserRecordingControls controller={result.current} />,
    );
    expect(screen.getByRole("button", { name: "Pause video" })).toBeEnabled();
    panel.unmount();
    expect(recorder().state).toBe("recording");
    await stop(result);
    render(<NativeBrowserRecordingControls controller={result.current} />);
    expect(screen.getByRole("button", { name: "Save video…" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Discard video" }));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.video.phase).toBe("idle");
  });
});
