import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LogicalPosition,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/dpi";
import { useWindowControls } from "../../src/hooks/window/useWindowControls";
import { useWindowPersistence } from "../../src/hooks/window/useWindowPersistence";
import type { GlobalSettings } from "../../src/types/settings/settings";

const mocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(),
  validateSavedPosition: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));
vi.mock("../../src/utils/window/windowRepatriation", () => ({
  validateSavedPosition: mocks.validateSavedPosition,
  repatriateWindow: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const noop = (): void => undefined;
const initialSettings = {
  persistWindowSize: true,
  persistWindowPosition: true,
  autoRepatriateWindow: false,
  windowSize: { width: 1000, height: 700 },
  windowPosition: { x: -600, y: 100 },
} as GlobalSettings;

function makeWindow() {
  let resized = noop;
  let moved = noop;
  const unlistenResize = vi.fn();
  const unlistenMove = vi.fn();
  return {
    isAlwaysOnTop: vi.fn().mockResolvedValue(false),
    isMaximized: vi.fn().mockResolvedValue(false),
    isFullscreen: vi.fn().mockResolvedValue(false),
    isMinimized: vi.fn().mockResolvedValue(false),
    maximize: vi.fn().mockResolvedValue(undefined),
    unmaximize: vi.fn().mockResolvedValue(undefined),
    setFullscreen: vi.fn().mockResolvedValue(undefined),
    setSize: vi.fn().mockResolvedValue(undefined),
    setPosition: vi.fn().mockResolvedValue(undefined),
    center: vi.fn().mockResolvedValue(undefined),
    innerSize: vi.fn().mockResolvedValue(new PhysicalSize(2400, 1600)),
    outerPosition: vi.fn().mockResolvedValue(new PhysicalPosition(-1200, 200)),
    scaleFactor: vi.fn().mockResolvedValue(2),
    onResized: vi.fn(async (listener: () => void): Promise<() => void> => {
      resized = listener;
      return unlistenResize;
    }),
    onMoved: vi.fn(async (listener: () => void): Promise<() => void> => {
      moved = listener;
      return unlistenMove;
    }),
    resize: () => resized(),
    move: () => moved(),
    unlistenResize,
    unlistenMove,
  };
}

let nativeWindow: ReturnType<typeof makeWindow>;
const manager = { saveSettings: vi.fn().mockResolvedValue(undefined) };

function mountPersistence(settings = initialSettings, initialized = true) {
  return renderHook(
    ({ settings, initialized }) =>
      useWindowPersistence(
        settings,
        manager as never,
        initialized,
        () => false,
        280,
        noop,
        "left",
        noop,
        false,
        noop,
      ),
    { initialProps: { settings, initialized } },
  );
}

async function settle() {
  await act(async () => {});
}
async function saveEvent() {
  nativeWindow.resize();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  nativeWindow = makeWindow();
  mocks.getCurrentWindow.mockReturnValue(nativeWindow);
  mocks.validateSavedPosition.mockResolvedValue({
    position: { x: -1200, y: 200 },
    adjusted: false,
  });
  manager.saveSettings.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("native restore controls", () => {
  it("lets unmaximize restore native bounds even with a stale smaller saved size", async () => {
    nativeWindow.isMaximized.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useWindowControls(initialSettings, manager as never),
    );
    await act(() => result.current.handleMaximize());
    expect(nativeWindow.unmaximize).toHaveBeenCalledOnce();
    expect(nativeWindow.setSize).not.toHaveBeenCalled();
    expect(nativeWindow.maximize).not.toHaveBeenCalled();
  });

  it("exits fullscreen without altering underlying maximized or restore bounds", async () => {
    nativeWindow.isFullscreen.mockResolvedValue(true);
    nativeWindow.isMaximized.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useWindowControls(initialSettings, manager as never),
    );
    await act(() => result.current.handleMaximize());
    expect(nativeWindow.setFullscreen).toHaveBeenCalledWith(false);
    expect(nativeWindow.unmaximize).not.toHaveBeenCalled();
    expect(nativeWindow.setSize).not.toHaveBeenCalled();
  });

  it("does not toggle a minimized window", async () => {
    nativeWindow.isMinimized.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useWindowControls(initialSettings, manager as never),
    );
    await act(() => result.current.handleMaximize());
    expect(nativeWindow.maximize).not.toHaveBeenCalled();
    expect(nativeWindow.unmaximize).not.toHaveBeenCalled();
  });

  it("coalesces overlapping clicks and releases the guard after a failed command", async () => {
    const pending = deferred<void>();
    nativeWindow.maximize.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(() =>
      useWindowControls(initialSettings, manager as never),
    );
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.handleMaximize();
    });
    rerender();
    await act(() => result.current.handleMaximize());
    expect(nativeWindow.maximize).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve();
      await first;
    });
    nativeWindow.maximize.mockRejectedValueOnce(new Error("denied"));
    await act(async () => {
      await expect(result.current.handleMaximize()).rejects.toThrow("denied");
    });
    await act(() => result.current.handleMaximize());
    expect(nativeWindow.maximize).toHaveBeenCalledTimes(3);
  });
});

describe("window geometry persistence", () => {
  it("restores on initialization and preference enable using logical inner size", async () => {
    const view = mountPersistence(initialSettings, false);
    await settle();
    expect(nativeWindow.setSize).not.toHaveBeenCalled();
    view.rerender({ settings: initialSettings, initialized: true });
    await settle();
    expect(nativeWindow.setPosition).toHaveBeenCalledWith(
      new LogicalPosition(-600, 100),
    );
    expect(nativeWindow.setSize).toHaveBeenCalledWith(
      new LogicalSize(1000, 700),
    );
    expect(nativeWindow.setPosition.mock.invocationCallOrder[0]).toBeLessThan(
      nativeWindow.setSize.mock.invocationCallOrder[0],
    );

    view.rerender({
      settings: { ...initialSettings, persistWindowSize: false },
      initialized: true,
    });
    await settle();
    view.rerender({
      settings: {
        ...initialSettings,
        windowSize: { width: 1400, height: 900 },
      },
      initialized: true,
    });
    await settle();
    expect(nativeWindow.setSize).toHaveBeenLastCalledWith(
      new LogicalSize(1400, 900),
    );
    expect(nativeWindow.setSize).toHaveBeenCalledTimes(2);
  });

  it("does not replay saves or fresh geometry objects as restore commands", async () => {
    const view = mountPersistence();
    await settle();
    manager.saveSettings.mockImplementation(
      async (patch: Partial<GlobalSettings>) => {
        view.rerender({
          settings: { ...initialSettings, ...patch },
          initialized: true,
        });
      },
    );
    await saveEvent();
    expect(manager.saveSettings).toHaveBeenCalledExactlyOnceWith(
      { windowSize: { width: 1200, height: 800 } },
      { silent: true },
    );
    expect(nativeWindow.setSize).toHaveBeenCalledOnce();
    expect(nativeWindow.setPosition).toHaveBeenCalledOnce();
    await saveEvent();
    expect(manager.saveSettings).toHaveBeenCalledOnce();
    view.rerender({
      settings: {
        ...initialSettings,
        windowSize: { width: 1200, height: 800 },
      },
      initialized: true,
    });
    await settle();
    expect(nativeWindow.setSize).toHaveBeenCalledOnce();
  });

  it.each([1, 1.25, 2])(
    "round trips physical measurements at scale %s exactly once",
    async (scale) => {
      nativeWindow.scaleFactor.mockResolvedValue(scale);
      nativeWindow.innerSize.mockResolvedValue(
        new PhysicalSize(1200 * scale, 800 * scale),
      );
      nativeWindow.outerPosition.mockResolvedValue(
        new PhysicalPosition(-500 * scale, 150 * scale),
      );
      mountPersistence();
      await settle();
      await saveEvent();
      expect(manager.saveSettings).toHaveBeenCalledWith(
        {
          windowSize: { width: 1200, height: 800 },
          windowPosition: { x: -500, y: 150 },
        },
        { silent: true },
      );
    },
  );

  it.each(["isMaximized", "isFullscreen", "isMinimized"] as const)(
    "does not restore or save %s geometry",
    async (state) => {
      nativeWindow[state].mockResolvedValue(true);
      mountPersistence();
      await settle();
      await saveEvent();
      expect(nativeWindow.setSize).not.toHaveBeenCalled();
      expect(nativeWindow.setPosition).not.toHaveBeenCalled();
      expect(manager.saveSettings).not.toHaveBeenCalled();
      nativeWindow[state].mockResolvedValue(false);
      await saveEvent();
      expect(manager.saveSettings).toHaveBeenCalledOnce();
      expect(nativeWindow.setSize).not.toHaveBeenCalled();
    },
  );

  it.each(["isMaximized", "isFullscreen", "isMinimized"] as const)(
    "discards a sample entering %s during IPC reads",
    async (state) => {
      mountPersistence();
      await settle();
      const reading = deferred<PhysicalSize>();
      nativeWindow.innerSize.mockReturnValueOnce(reading.promise);
      await saveEvent();
      nativeWindow[state].mockResolvedValue(true);
      reading.resolve(new PhysicalSize(3840, 2160));
      await settle();
      expect(manager.saveSettings).not.toHaveBeenCalled();
    },
  );

  it("discards superseded geometry and saves the next settled resize", async () => {
    mountPersistence();
    await settle();
    const reading = deferred<PhysicalSize>();
    nativeWindow.innerSize.mockReturnValueOnce(reading.promise);
    await saveEvent();
    nativeWindow.resize();
    reading.resolve(new PhysicalSize(900, 600));
    await settle();
    expect(manager.saveSettings).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(manager.saveSettings).toHaveBeenCalledWith(
      { windowSize: { width: 1200, height: 800 } },
      { silent: true },
    );
  });

  it("discards a sample whose monitor scale changed during reads", async () => {
    mountPersistence();
    await settle();
    nativeWindow.scaleFactor.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await saveEvent();
    expect(manager.saveSettings).not.toHaveBeenCalled();
  });

  it.each([0, NaN, Infinity])("rejects invalid scale %s", async (scale) => {
    mountPersistence();
    await settle();
    nativeWindow.scaleFactor.mockResolvedValue(scale);
    await saveEvent();
    expect(manager.saveSettings).not.toHaveBeenCalled();
  });

  it("does not save zero-sized minimized transition geometry", async () => {
    mountPersistence();
    await settle();
    nativeWindow.innerSize.mockResolvedValue(new PhysicalSize(0, 0));
    await saveEvent();
    expect(manager.saveSettings).not.toHaveBeenCalled();
  });

  it("validates physical monitor bounds and applies logical size after the move", async () => {
    mocks.validateSavedPosition.mockResolvedValue({
      position: { x: 3000, y: 100 },
      adjusted: true,
    });
    mountPersistence({ ...initialSettings, autoRepatriateWindow: true });
    await settle();
    expect(mocks.validateSavedPosition).toHaveBeenCalledWith(
      new PhysicalPosition(-1200, 200),
      new PhysicalSize(2000, 1400),
    );
    expect(nativeWindow.setPosition).toHaveBeenCalledWith(
      new PhysicalPosition(3000, 100),
    );
    expect(nativeWindow.setSize).toHaveBeenCalledWith(
      new LogicalSize(1000, 700),
    );
  });

  it("clamps invalid saved size and centers when no monitor is available", async () => {
    mocks.validateSavedPosition.mockResolvedValue(null);
    mountPersistence({
      ...initialSettings,
      autoRepatriateWindow: true,
      windowSize: { width: Infinity, height: -10 },
    });
    await settle();
    expect(nativeWindow.center).toHaveBeenCalledOnce();
    expect(nativeWindow.setSize).toHaveBeenCalledWith(
      new LogicalSize(800, 600),
    );
  });

  it.each(["unmount", "disable", "maximize"])(
    "cancels delayed validation on %s",
    async (action) => {
      const validation = deferred<{
        position: { x: number; y: number };
        adjusted: boolean;
      }>();
      mocks.validateSavedPosition.mockReturnValueOnce(validation.promise);
      const view = mountPersistence({
        ...initialSettings,
        autoRepatriateWindow: true,
      });
      await settle();
      if (action === "unmount") view.unmount();
      if (action === "disable")
        view.rerender({
          settings: {
            ...initialSettings,
            persistWindowSize: false,
            persistWindowPosition: false,
          },
          initialized: true,
        });
      if (action === "maximize")
        nativeWindow.isMaximized.mockResolvedValue(true);
      validation.resolve({ position: { x: 400, y: 100 }, adjusted: true });
      await settle();
      expect(nativeWindow.setPosition).not.toHaveBeenCalled();
      expect(nativeWindow.setSize).not.toHaveBeenCalled();
    },
  );

  it("does not save transient geometry while a restore is pending", async () => {
    const resizing = deferred<void>();
    nativeWindow.setSize.mockReturnValueOnce(resizing.promise);
    mountPersistence();
    await settle();
    await saveEvent();
    expect(manager.saveSettings).not.toHaveBeenCalled();
    resizing.resolve();
    await settle();
  });

  it.each(["unmount", "disable"])(
    "discards in-flight saves on %s",
    async (action) => {
      const view = mountPersistence();
      await settle();
      const reading = deferred<PhysicalSize>();
      nativeWindow.innerSize.mockReturnValueOnce(reading.promise);
      await saveEvent();
      if (action === "unmount") view.unmount();
      else
        view.rerender({
          settings: {
            ...initialSettings,
            persistWindowSize: false,
            persistWindowPosition: false,
          },
          initialized: true,
        });
      reading.resolve(new PhysicalSize(2400, 1600));
      await settle();
      expect(manager.saveSettings).not.toHaveBeenCalled();
      expect(nativeWindow.unlistenResize).toHaveBeenCalledOnce();
      expect(nativeWindow.unlistenMove).toHaveBeenCalledOnce();
    },
  );

  it("unsubscribes listeners that finish registering after cleanup", async () => {
    const resize = deferred<() => void>();
    const move = deferred<() => void>();
    nativeWindow.onResized.mockReturnValueOnce(resize.promise);
    nativeWindow.onMoved.mockReturnValueOnce(move.promise);
    const view = mountPersistence();
    view.unmount();
    resize.resolve(nativeWindow.unlistenResize);
    move.resolve(nativeWindow.unlistenMove);
    await settle();
    expect(nativeWindow.unlistenResize).toHaveBeenCalledOnce();
    expect(nativeWindow.unlistenMove).toHaveBeenCalledOnce();
    expect(nativeWindow.setSize).not.toHaveBeenCalled();
  });

  it("ignores a late callback from a disposed listener without cancelling the current save", async () => {
    const view = mountPersistence();
    await settle();
    const oldResize = nativeWindow.onResized.mock.calls[0][0];
    view.rerender({
      settings: { ...initialSettings, persistWindowSize: false },
      initialized: true,
    });
    await settle();
    view.rerender({ settings: initialSettings, initialized: true });
    await settle();
    nativeWindow.resize();
    oldResize();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(manager.saveSettings).toHaveBeenCalledOnce();
  });

  it("preserves a resize followed immediately by maximize and restore before the save debounce", async () => {
    mountPersistence();
    const controls = renderHook(() =>
      useWindowControls(initialSettings, manager as never),
    );
    await settle();
    nativeWindow.resize();
    nativeWindow.isMaximized.mockResolvedValue(true);
    await act(() => controls.result.current.handleMaximize());
    nativeWindow.isMaximized.mockResolvedValue(false);
    await saveEvent();
    expect(nativeWindow.unmaximize).toHaveBeenCalledOnce();
    expect(nativeWindow.setSize).toHaveBeenCalledOnce(); // Startup only.
    expect(manager.saveSettings).toHaveBeenCalledWith(
      { windowSize: { width: 1200, height: 800 } },
      { silent: true },
    );
  });
});
