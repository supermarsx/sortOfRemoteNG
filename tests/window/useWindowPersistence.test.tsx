/**
 * Regression tests for the settings-save feedback loop found in t61-e5.
 *
 * `settingsManager.saveSettings` broadcasts `settings-updated`; `App` answers
 * by replacing its `appSettings` object. If `useWindowPersistence` re-ran its
 * sidebar-persist effect on every new `appSettings` object it re-saved the
 * unchanged sidebar values ~3×/s forever, re-rendering the whole app each
 * time. These tests wire a faithful stand-in for that broadcast/replace cycle
 * and assert the loop cannot come back.
 */
import React, { useEffect, useState } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowPersistence } from "../../src/hooks/window/useWindowPersistence";
import type { GlobalSettings } from "../../src/types/settings/settings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class LogicalSize {},
  LogicalPosition: class LogicalPosition {},
}));

vi.mock("../../src/utils/window/windowRepatriation", () => ({
  validateSavedPosition: vi.fn(),
}));

const noopDispatch = () => undefined;

const baseSettings = {
  persistSidebarWidth: true,
  persistSidebarPosition: true,
  persistSidebarCollapsed: true,
  sidebarWidth: 280,
  sidebarPosition: "left",
  sidebarCollapsed: false,
} as unknown as GlobalSettings;

/**
 * Minimal stand-in for SettingsManager + App's `settings-updated` listener:
 * every save merges the patch and hands back a NEW snapshot object, exactly
 * like `broadcastSettingsSync` → `setAppSettings(detail)` does at runtime.
 */
function makeSettingsManager(initial: GlobalSettings) {
  let current = initial;
  const saveSettings = vi.fn(async (patch: Partial<GlobalSettings>) => {
    current = { ...current, ...patch };
    window.dispatchEvent(
      new CustomEvent("settings-updated", { detail: { ...current } }),
    );
  });
  return {
    saveSettings,
    getSettings: () => current,
  };
}

/** Host that mirrors App: re-renders with a fresh settings object per broadcast. */
function Host({
  manager,
  initial,
  sidebarWidth,
  onRender,
}: {
  manager: ReturnType<typeof makeSettingsManager>;
  initial: GlobalSettings;
  sidebarWidth: number;
  onRender: () => void;
}) {
  const [appSettings, setAppSettings] = useState<GlobalSettings>(initial);
  const [width, setWidth] = useState(sidebarWidth);
  const [position, setPosition] = useState<"left" | "right">("left");
  useEffect(() => {
    const handler = (event: Event) =>
      setAppSettings((event as CustomEvent<GlobalSettings>).detail);
    window.addEventListener("settings-updated", handler);
    return () => window.removeEventListener("settings-updated", handler);
  }, []);
  useEffect(() => {
    setWidth(sidebarWidth);
  }, [sidebarWidth]);
  onRender();
  useWindowPersistence(
    appSettings,
    manager as never,
    true,
    () => false,
    width,
    setWidth,
    position,
    setPosition,
    false,
    noopDispatch,
  );
  return null;
}

describe("useWindowPersistence sidebar persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not re-save already-persisted sidebar state (no save→broadcast→save loop)", async () => {
    const manager = makeSettingsManager(baseSettings);
    const onRender = vi.fn();

    render(
      <Host
        manager={manager}
        initial={baseSettings}
        sidebarWidth={280}
        onRender={onRender}
      />,
    );

    // Let the debounce and several would-be loop iterations elapse.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(manager.saveSettings).not.toHaveBeenCalled();
    const rendersAfterMount = onRender.mock.calls.length;

    // Idle: nothing should keep rendering.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onRender.mock.calls.length).toBe(rendersAfterMount);
  });

  it("saves exactly once when the sidebar width actually changes, then settles", async () => {
    const manager = makeSettingsManager(baseSettings);
    const onRender = vi.fn();

    const view = render(
      <Host
        manager={manager}
        initial={baseSettings}
        sidebarWidth={280}
        onRender={onRender}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(manager.saveSettings).not.toHaveBeenCalled();

    view.rerender(
      <Host
        manager={manager}
        initial={baseSettings}
        sidebarWidth={360}
        onRender={onRender}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(manager.saveSettings).toHaveBeenCalledTimes(1);
    expect(manager.saveSettings).toHaveBeenCalledWith(
      { sidebarWidth: 360 },
      { silent: true },
    );
    expect(manager.getSettings().sidebarWidth).toBe(360);

    // The broadcast that followed the save must not trigger another save.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(manager.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("ignores identical settings objects with new identity", async () => {
    const manager = makeSettingsManager(baseSettings);
    const { rerender } = renderHook(
      ({ settings }: { settings: GlobalSettings }) =>
        useWindowPersistence(
          settings,
          manager as never,
          true,
          () => false,
          280,
          () => undefined,
          "left",
          () => undefined,
          false,
          () => undefined,
        ),
      { initialProps: { settings: baseSettings } },
    );

    for (let i = 0; i < 20; i++) {
      rerender({ settings: { ...baseSettings } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
    }

    expect(manager.saveSettings).not.toHaveBeenCalled();
  });

  it("does nothing when no persist flag is enabled", async () => {
    const manager = makeSettingsManager({
      ...baseSettings,
      persistSidebarWidth: false,
      persistSidebarPosition: false,
      persistSidebarCollapsed: false,
    } as GlobalSettings);
    renderHook(() =>
      useWindowPersistence(
        manager.getSettings(),
        manager as never,
        true,
        () => false,
        999,
        () => undefined,
        "right",
        () => undefined,
        true,
        () => undefined,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(manager.saveSettings).not.toHaveBeenCalled();
  });
});
