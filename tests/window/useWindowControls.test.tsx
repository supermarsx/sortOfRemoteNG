import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowControls } from "../../src/hooks/window/useWindowControls";
import { useWindowTheme } from "../../src/hooks/window/useWindowTheme";
import { useWindowPersistence } from "../../src/hooks/window/useWindowPersistence";

const mocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(),
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class LogicalSize {},
}));

vi.mock("../../src/utils/window/windowRepatriation", () => ({
  repatriateWindow: vi.fn(),
}));

describe("useWindowControls browser runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockReturnValue(false);
  });

  it("does not read Tauri window metadata outside the native shell", () => {
    renderHook(() => useWindowControls({} as never, {} as never));

    expect(mocks.isTauri).toHaveBeenCalled();
    expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
  });

  it("keeps browser theme CSS available without reading a native window", () => {
    renderHook(() =>
      useWindowTheme(
        {
          windowTransparencyEnabled: false,
          windowTransparencyOpacity: 1,
        } as never,
        () => false,
      ),
    );

    expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
    expect(
      document.documentElement.style.getPropertyValue("--app-surface-900"),
    ).not.toBe("");
  });

  it("keeps sidebar persistence available without reading a native window", () => {
    renderHook(() =>
      useWindowPersistence(
        {} as never,
        {} as never,
        true,
        () => false,
        280,
        () => undefined,
        "left",
        () => undefined,
        false,
        () => undefined,
      ),
    );

    expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
  });
});

describe("useWindowControls native tray behavior", () => {
  const nativeWindow = {
    hide: vi.fn().mockResolvedValue(undefined),
    minimize: vi.fn().mockResolvedValue(undefined),
    isAlwaysOnTop: vi.fn().mockResolvedValue(false),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockReturnValue(true);
    mocks.getCurrentWindow.mockReturnValue(nativeWindow);
    mocks.invoke.mockResolvedValue(undefined);
  });

  it("creates the restoration path before hiding on minimize", async () => {
    const { result } = renderHook(() =>
      useWindowControls(
        { showTrayIcon: true, minimizeToTray: true } as never,
        {} as never,
      ),
    );

    await act(() => result.current.handleMinimize());

    expect(mocks.invoke).toHaveBeenCalledWith("set_tray_icon_visible", {
      visible: true,
    });
    expect(nativeWindow.hide).toHaveBeenCalledTimes(1);
    expect(nativeWindow.minimize).not.toHaveBeenCalled();
  });

  it("falls back to a normal minimize when tray creation fails", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("tray unavailable"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useWindowControls(
        { showTrayIcon: true, minimizeToTray: true } as never,
        {} as never,
      ),
    );

    await act(() => result.current.handleMinimize());

    expect(nativeWindow.hide).not.toHaveBeenCalled();
    expect(nativeWindow.minimize).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it("does not hide when the tray icon is disabled", async () => {
    const { result } = renderHook(() =>
      useWindowControls(
        { showTrayIcon: false, minimizeToTray: true } as never,
        {} as never,
      ),
    );

    await act(() => result.current.handleMinimize());

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(nativeWindow.hide).not.toHaveBeenCalled();
    expect(nativeWindow.minimize).toHaveBeenCalledTimes(1);
  });
});
