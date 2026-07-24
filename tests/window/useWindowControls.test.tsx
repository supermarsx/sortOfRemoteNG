import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWindowControls } from "../../src/hooks/window/useWindowControls";
import { useWindowTheme } from "../../src/hooks/window/useWindowTheme";
import { useWindowPersistence } from "../../src/hooks/window/useWindowPersistence";

const mocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(),
  isTauri: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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
