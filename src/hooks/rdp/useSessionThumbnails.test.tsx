import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useSessionThumbnails } from "./useSessionThumbnails";

const session = (id: string) => ({
  id,
  connected: true,
  desktop_width: 1920,
  desktop_height: 1080,
});
const rgba = () => new ArrayBuffer(160 * 90 * 4);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const settle = () =>
  act(async () => {
    await Promise.resolve();
  });

describe("session thumbnail scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockReset().mockResolvedValue(rgba());
    let url = 0;
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { putImageData: vi.fn() };
        }
        convertToBlob() {
          return Promise.resolve(new Blob());
        }
      },
    );
    vi.stubGlobal("ImageData", class {});
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:thumb-${++url}`,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([5000, 30000, 60000])(
    "honors %ims despite 3-second metadata refreshes and captures the latest list",
    async (interval) => {
      const { rerender, unmount } = renderHook(
        ({ sessions }) => useSessionThumbnails(sessions, interval),
        { initialProps: { sessions: [session("a")] } },
      );
      await settle();
      expect(invoke).toHaveBeenCalledTimes(1);
      for (let elapsed = 3000; elapsed < interval; elapsed += 3000) {
        await act(() => vi.advanceTimersByTimeAsync(3000));
        rerender({ sessions: [session("a"), session("b")] });
      }
      expect(invoke).toHaveBeenCalledTimes(1);
      await act(() =>
        vi.advanceTimersByTimeAsync(
          interval - Math.floor((interval - 1) / 3000) * 3000,
        ),
      );
      expect(
        vi
          .mocked(invoke)
          .mock.calls.slice(1)
          .map((call) => call[1]),
      ).toEqual([
        expect.objectContaining({ sessionId: "a" }),
        expect.objectContaining({ sessionId: "b" }),
      ]);
      unmount();
    },
  );

  it("serializes slow native work and cancels hidden captures before PNG encoding", async () => {
    const pending = deferred<ArrayBuffer>();
    vi.mocked(invoke).mockReturnValueOnce(pending.promise);
    const { rerender, result, unmount } = renderHook(
      ({ enabled }) =>
        useSessionThumbnails([session("a"), session("b")], 30000, enabled),
      { initialProps: { enabled: true } },
    );
    await act(() => vi.advanceTimersByTimeAsync(90000));
    expect(invoke).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });
    await act(async () => pending.resolve(rgba()));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(90000));
    expect(invoke).toHaveBeenCalledTimes(1);
    rerender({ enabled: true });
    await settle();
    expect(result.current).toEqual({ a: "blob:thumb-1", b: "blob:thumb-2" });
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("revokes removed thumbnails while paused and ignores encoding completed after unmount", async () => {
    const { rerender, result, unmount } = renderHook(
      ({ sessions, enabled }) => useSessionThumbnails(sessions, 5000, enabled),
      {
        initialProps: { sessions: [session("a"), session("b")], enabled: true },
      },
    );
    await settle();
    rerender({ sessions: [session("b")], enabled: false });
    expect(result.current).toEqual({ b: "blob:thumb-2" });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:thumb-1");
    const pending = deferred<Blob>();
    vi.spyOn(OffscreenCanvas.prototype, "convertToBlob").mockReturnValue(
      pending.promise,
    );
    rerender({ sessions: [session("b")], enabled: true });
    await settle();
    unmount();
    await act(async () => pending.resolve(new Blob()));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:thumb-2");
  });

  it("captures promptly after reactivation even when the old native capture is still pending", async () => {
    const pending = deferred<ArrayBuffer>();
    vi.mocked(invoke).mockReturnValueOnce(pending.promise);
    const { rerender, result, unmount } = renderHook(
      ({ enabled }) => useSessionThumbnails([session("a")], 60000, enabled),
      { initialProps: { enabled: true } },
    );
    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(rgba()));
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.current.a).toBe("blob:thumb-1");
    unmount();
  });
});
