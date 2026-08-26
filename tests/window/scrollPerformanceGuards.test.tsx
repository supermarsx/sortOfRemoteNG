/**
 * Scroll-performance guards (t61-e5).
 *
 * Mounts the real app root (same provider tree and Tauri mocks as
 * tests/app/AppRuntime.test.tsx) and asserts three invariants that, when
 * violated, make every scroll in the app feel sluggish:
 *
 * 1. No non-passive `wheel` / `touchmove` listener is registered on `window`
 *    or `document` (a non-passive one forces the compositor to wait for JS on
 *    every wheel tick).
 * 2. Dispatching `scroll` on a nested scroller does not re-render the app
 *    root (React Profiler commit count unchanged).
 * 3. Once mounted and settled, the app is quiescent: no `settings-updated`
 *    broadcasts and no root re-renders while idle. This pins the fix for the
 *    save→broadcast→save loop in useWindowPersistence that re-rendered the
 *    whole app ~3×/s and was the measured cause of the sluggish scrolling.
 */
import React, { Profiler } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Tauri mocks (hoisted) ────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  isTauri: vi.fn(() => true),
  transformCallback: vi.fn(),
  SERIALIZE_TO_IPC_FN: "__TAURI_TO_IPC_KEY__",
  Channel: class {
    id = 0;
    onmessage: ((data: unknown) => void) | null = null;
    constructor(handler?: (data: unknown) => void) {
      if (handler) this.onmessage = handler;
    }
    toJSON() {
      return `__CHANNEL__:${this.id}`;
    }
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => {
  const fns = () => ({
    show: vi.fn(() => Promise.resolve()),
    center: vi.fn(() => Promise.resolve()),
    setFocus: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
    onMoved: vi.fn(() => Promise.resolve(() => {})),
    onResized: vi.fn(() => Promise.resolve(() => {})),
    setAlwaysOnTop: vi.fn(() => Promise.resolve()),
    isAlwaysOnTop: vi.fn(() => Promise.resolve(false)),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    maximize: vi.fn(() => Promise.resolve()),
    unmaximize: vi.fn(() => Promise.resolve()),
    minimize: vi.fn(() => Promise.resolve()),
    setDecorations: vi.fn(() => Promise.resolve()),
    setTitle: vi.fn(() => Promise.resolve()),
    setSize: vi.fn(() => Promise.resolve()),
    setPosition: vi.fn(() => Promise.resolve()),
    setBackgroundColor: vi.fn(() => Promise.resolve()),
    scaleFactor: vi.fn(() => Promise.resolve(1)),
    innerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
    outerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
    innerSize: vi.fn(() => Promise.resolve({ width: 1280, height: 720 })),
    outerSize: vi.fn(() => Promise.resolve({ width: 1280, height: 720 })),
    label: "main",
  });

  class _Window {
    label = "main";
    show = vi.fn(() => Promise.resolve());
    center = vi.fn(() => Promise.resolve());
    setFocus = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());
    isAlwaysOnTop = vi.fn(() => Promise.resolve(false));
    onCloseRequested = vi.fn(() => Promise.resolve(() => {}));
  }

  return {
    getCurrentWindow: vi.fn(() => fns()),
    getAllWindows: vi.fn(() => Promise.resolve([])),
    Window: _Window,
    availableMonitors: vi.fn(() => Promise.resolve([])),
    currentMonitor: vi.fn(() => Promise.resolve(null)),
  };
});

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    label = "detached";
    constructor() {}
    once = vi.fn(() => Promise.resolve(() => {}));
    listen = vi.fn(() => Promise.resolve(() => {}));
    emit = vi.fn(() => Promise.resolve());
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/mock/app/data"),
  documentDir: vi.fn().mockResolvedValue("/mock/documents"),
  homeDir: vi.fn().mockResolvedValue("/mock/home"),
  join: vi.fn((...args: string[]) => args.join("/")),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class LogicalPosition {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  LogicalSize: class LogicalSize {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

vi.mock("../../src/hooks/window/useWindowManager", () => ({
  useWindowManager: () => ({
    registerWindow: vi.fn(),
    detachRef: { current: undefined },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      typeof fallback === "string" ? fallback : key,
    i18n: {
      language: "en",
      changeLanguage: vi.fn().mockResolvedValue(undefined),
      addResourceBundle: vi.fn(),
    },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: any) => <>{children}</>,
}));

vi.mock("../../src/components/rdp/rdpCanvas", () => ({
  drawSimulatedDesktop: vi.fn(),
  drawDesktopIcon: vi.fn(),
  drawWindow: vi.fn(),
  paintFrame: vi.fn(),
  decodeBase64Rgba: vi.fn(() => new Uint8ClampedArray(0)),
  clearCanvas: vi.fn(),
  FrameBuffer: class {
    offscreen = { width: 1920, height: 1080 };
    ctx = {};
    hasPainted = false;
    paintDirect() {
      this.hasPainted = true;
    }
    syncFromVisible() {}
    applyRegion() {
      this.hasPainted = true;
    }
    resize() {}
    blitTo() {}
    blitFull() {}
  },
}));

vi.mock("../../src/i18n", () => ({
  default: {
    language: "en",
    changeLanguage: vi.fn(),
    addResourceBundle: vi.fn(),
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options.defaultValue === "string"
        ? options.defaultValue
        : key,
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
  },
  loadLanguage: vi.fn(),
  resolveSupportedLanguage: vi.fn((language?: string) => language ?? "en-US"),
}));

// ── Listener spies must be installed before the app module registers anything ──

type ListenerRecord = {
  target: "window" | "document";
  type: string;
  options: unknown;
};
const listenerLog: ListenerRecord[] = [];
const isPassive = (options: unknown): boolean =>
  typeof options === "object" &&
  options !== null &&
  (options as AddEventListenerOptions).passive === true;

const origWindowAdd = window.addEventListener.bind(window);
const origDocumentAdd = document.addEventListener.bind(document);
window.addEventListener = ((type: string, listener: any, options?: any) => {
  listenerLog.push({ target: "window", type, options });
  return origWindowAdd(type, listener, options);
}) as typeof window.addEventListener;
document.addEventListener = ((type: string, listener: any, options?: any) => {
  listenerLog.push({ target: "document", type, options });
  return origDocumentAdd(type, listener, options);
}) as typeof document.addEventListener;

import App from "../../src/App";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { StatusChecker } from "../../src/utils/connection/statusChecker";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { ThemeManager } from "../../src/utils/settings/themeManager";
import { stopMemoryWatchdog } from "../../src/utils/debug/memoryWatchdog";

function resetSingletons() {
  stopMemoryWatchdog();
  SettingsManager.resetInstance?.();
  StatusChecker.resetInstance?.();
  DatabaseManager.resetInstance?.();
  ThemeManager.resetInstance?.();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mountApp() {
  const commits: string[] = [];
  const onRender = (
    _id: string,
    phase: "mount" | "update" | "nested-update",
  ) => {
    commits.push(phase);
  };
  const view = render(
    <Profiler id="app-root" onRender={onRender}>
      <App />
    </Profiler>,
  );
  await waitFor(() => {
    expect(view.container.querySelector(".app-shell")).toBeTruthy();
  });
  // Let startup effects (settings load, splash, lifecycle timers) settle.
  await act(async () => {
    await sleep(700);
  });
  return { view, commits };
}

describe("scroll performance guards", () => {
  beforeEach(() => {
    listenerLog.length = 0;
    resetSingletons();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers no non-passive wheel/touchmove listeners on window or document", async () => {
    await mountApp();

    const offenders = listenerLog.filter(
      (entry) =>
        (entry.type === "wheel" || entry.type === "touchmove") &&
        !isPassive(entry.options),
    );
    expect(offenders).toEqual([]);
  });

  it("does not re-render the app root when a nested scroller scrolls", async () => {
    const { view, commits } = await mountApp();

    const scrollers = Array.from(
      view.container.querySelectorAll<HTMLElement>(
        ".overflow-y-auto, .overflow-auto",
      ),
    );
    expect(scrollers.length).toBeGreaterThan(0);

    const before = commits.length;
    await act(async () => {
      for (const scroller of scrollers) {
        for (let i = 0; i < 5; i++) {
          scroller.scrollTop = (i + 1) * 40;
          scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
        }
      }
      await sleep(50);
    });
    expect(commits.length).toBe(before);
  });

  it("is quiescent once mounted: no settings broadcasts and no root re-render churn while idle", async () => {
    const { commits } = await mountApp();
    // Give late startup effects (lifecycle timers, async settings load) time
    // to finish before the idle window is measured.
    await act(async () => {
      await sleep(1000);
    });

    let broadcasts = 0;
    const onSettingsUpdated = () => {
      broadcasts++;
    };
    origWindowAdd("settings-updated", onSettingsUpdated);
    const before = commits.length;

    // Longer than several 300 ms sidebar-save debounce windows: the
    // save→broadcast→save loop fired ~3×/s, i.e. >= 4 root commits and
    // >= 4 broadcasts in this window. A single stray commit from a
    // one-shot startup timer is tolerated; churn is not.
    await act(async () => {
      await sleep(1500);
    });

    window.removeEventListener("settings-updated", onSettingsUpdated);
    expect(broadcasts).toBe(0);
    expect(commits.length - before).toBeLessThanOrEqual(1);
  });
});
