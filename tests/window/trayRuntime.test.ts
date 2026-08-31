import { describe, expect, it, vi } from "vitest";

import {
  applyStartupWindowAction,
  handleCloseToTrayRequest,
} from "../../src/utils/window/trayRuntime";

describe("close-to-tray runtime", () => {
  it("prevents destruction, confirms the tray, then hides", async () => {
    const calls: string[] = [];

    const hidden = await handleCloseToTrayRequest({
      settings: { showTrayIcon: true, closeToTray: true },
      explicitQuit: false,
      preventDefault: () => calls.push("prevent"),
      ensureTray: async () => {
        calls.push("tray");
      },
      hide: async () => {
        calls.push("hide");
      },
      onError: vi.fn(),
    });

    expect(hidden).toBe(true);
    expect(calls).toEqual(["prevent", "tray", "hide"]);
  });

  it("falls through to normal close when native tray creation fails", async () => {
    const preventDefault = vi.fn();
    const hide = vi.fn();
    const onError = vi.fn();
    const failure = new Error("tray unavailable");

    const hidden = await handleCloseToTrayRequest({
      settings: { showTrayIcon: true, closeToTray: true },
      explicitQuit: false,
      preventDefault,
      ensureTray: () => Promise.reject(failure),
      hide,
      onError,
    });

    expect(hidden).toBe(false);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(hide).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("does not intercept explicit Quit or a disabled tray", async () => {
    const preventDefault = vi.fn();
    const ensureTray = vi.fn();

    expect(
      await handleCloseToTrayRequest({
        settings: { showTrayIcon: true, closeToTray: true },
        explicitQuit: true,
        preventDefault,
        ensureTray,
        hide: vi.fn(),
        onError: vi.fn(),
      }),
    ).toBe(false);
    expect(
      await handleCloseToTrayRequest({
        settings: { showTrayIcon: false, closeToTray: true },
        explicitQuit: false,
        preventDefault,
        ensureTray,
        hide: vi.fn(),
        onError: vi.fn(),
      }),
    ).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(ensureTray).not.toHaveBeenCalled();
  });
});

describe("startup tray runtime", () => {
  const makeWindow = () => ({
    show: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
    minimize: vi.fn().mockResolvedValue(undefined),
    maximize: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
  });

  it("starts hidden only after a usable tray was created", async () => {
    const window = makeWindow();
    const closeSplash = vi.fn().mockResolvedValue(undefined);

    await applyStartupWindowAction("hide-to-tray", true, window, closeSplash);

    expect(window.hide).toHaveBeenCalledTimes(1);
    expect(window.show).not.toHaveBeenCalled();
    expect(window.minimize).not.toHaveBeenCalled();
    expect(closeSplash).toHaveBeenCalledTimes(1);
  });

  it("falls back to a reachable taskbar minimize without a tray", async () => {
    const window = makeWindow();

    await applyStartupWindowAction(
      "hide-to-tray",
      false,
      window,
      vi.fn().mockResolvedValue(undefined),
    );

    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.minimize).toHaveBeenCalledTimes(1);
    expect(window.hide).not.toHaveBeenCalled();
  });

  it("supports normal minimized and maximized starts", async () => {
    const minimized = makeWindow();
    await applyStartupWindowAction(
      "minimize",
      false,
      minimized,
      vi.fn().mockResolvedValue(undefined),
    );
    expect(minimized.show).toHaveBeenCalledTimes(1);
    expect(minimized.minimize).toHaveBeenCalledTimes(1);
    expect(minimized.setFocus).not.toHaveBeenCalled();

    const maximized = makeWindow();
    await applyStartupWindowAction(
      "maximize",
      true,
      maximized,
      vi.fn().mockResolvedValue(undefined),
    );
    expect(maximized.show).toHaveBeenCalledTimes(1);
    expect(maximized.maximize).toHaveBeenCalledTimes(1);
    expect(maximized.setFocus).toHaveBeenCalledTimes(1);
  });
});
