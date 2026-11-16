import { afterEach, describe, expect, it, vi } from "vitest";
import {
  preloadTab,
  registerTabPreloader,
  resetTabPreloadForTests,
  tabIntentHandlers,
  warmTabsWhenIdle,
} from "../../src/utils/preload/tabPreload";

afterEach(() => {
  resetTabPreloadForTests();
  vi.useRealTimers();
});

describe("tab preload triggers", () => {
  it("preloads on hover and focus, throttled", () => {
    const run = vi.fn();
    registerTabPreloader("documents", run);
    const handlers = tabIntentHandlers("documents");
    handlers.onPointerEnter();
    handlers.onFocus();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("warms registered tabs when idle (timer fallback)", () => {
    vi.useFakeTimers();
    const docs = vi.fn();
    const vault = vi.fn();
    registerTabPreloader("documents", docs);
    registerTabPreloader("credentialVault", vault);
    warmTabsWhenIdle();
    expect(docs).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(docs).toHaveBeenCalledOnce();
    expect(vault).toHaveBeenCalledOnce();
  });

  it("swallows a failing preloader", async () => {
    registerTabPreloader("documents", () =>
      Promise.reject(new Error("locked")),
    );
    expect(() => preloadTab("documents", true)).not.toThrow();
    await Promise.resolve();
  });
});
