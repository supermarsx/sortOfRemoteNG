/**
 * AppRuntime integration tests
 *
 * These tests verify that the full application can mount, render, and operate
 * at runtime.  They exercise the real provider tree (ToastProvider →
 * ConnectionProvider → ErrorBoundary → AppContent) to catch problems that
 * unit tests on individual components would miss.
 */
import React, { Profiler } from "react";
import {
  act,
  render,
  renderHook,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
(globalThis as any).__inv = [];
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Tauri mocks (hoisted) ────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, ..._a: unknown[]) => {
    ((globalThis as any).__inv ??= []).push(cmd);
    return Promise.resolve(undefined);
  }),
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

vi.mock(
  "../../src/components/recording/scriptTrust/ScriptTrustReconciler",
  async () => {
    const { useConnections } =
      await import("../../src/contexts/useConnections");
    return {
      ScriptTrustReconciler: () => {
        const c = useConnections();
        (globalThis as any).__ctx = c;
        return null;
      },
    };
  },
);

// ── react-i18next mock ──────────────────────────────────────────────────
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

// ── rdpCanvas mock ──────────────────────────────────────────────────────
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

// ── i18n loader mock ─────────────────────────────────────────────────────
vi.mock("../../src/i18n", () => ({
  default: {
    language: "en",
    changeLanguage: vi.fn(),
    addResourceBundle: vi.fn(),
    // Mirror i18next's real `i18n.t(key, { defaultValue, ...vars })` contract:
    // return the defaultValue when the key is unresolved and interpolate
    // `{{var}}` placeholders. The previous `key => key` stub returned raw keys,
    // so consumers that read the i18n instance directly (e.g. ErrorBoundary)
    // rendered "errorBoundary.title" instead of the translated text.
    t: (key: string, options?: Record<string, unknown>) => {
      const defaultValue =
        options && typeof options.defaultValue === "string"
          ? options.defaultValue
          : key;
      let result = defaultValue;
      if (options) {
        for (const [name, value] of Object.entries(options)) {
          if (name === "defaultValue") continue;
          result = result.replace(
            new RegExp(`{{\\s*${name}\\s*}}`, "g"),
            String(value),
          );
        }
      }
      return result;
    },
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
  },
  loadLanguage: vi.fn(),
  resolveSupportedLanguage: (l: string) => l,
}));

import App from "../../src/App";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { StatusChecker } from "../../src/utils/connection/statusChecker";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { ThemeManager } from "../../src/utils/settings/themeManager";
import { stopMemoryWatchdog } from "../../src/utils/debug/memoryWatchdog";

describe("startup quiescence", () => {
  it("measures invokes and commits over 6s", async () => {
    stopMemoryWatchdog();
    SettingsManager.resetInstance?.();
    StatusChecker.resetInstance?.();
    DatabaseManager.resetInstance?.();
    ThemeManager.resetInstance?.();
    (globalThis as any).__inv = [];
    let commits = 0;
    const { container } = render(
      <Profiler
        id="app"
        onRender={() => {
          commits++;
        }}
      >
        <App />
      </Profiler>,
    );
    await waitFor(
      () => expect(container.querySelector(".app-shell")).toBeTruthy(),
      { timeout: 20000 },
    );
    const snap = () => ({ commits, invokes: (globalThis as any).__inv.length });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    const N = Number(process.env.NSESS ?? 6);
    const mk = (i: number, proto: string) => ({
      id: "sess-" + i,
      connectionId: "conn-" + i,
      name: proto + i,
      status: "connected",
      startTime: new Date(),
      protocol: proto,
      hostname: "10.0.0." + i,
      backendSessionId: "be-" + i,
      reconnectAttempts: 0,
      maxReconnectAttempts: 3,
    });
    act(() => {
      for (let i = 0; i < N; i++)
        (globalThis as any).__ctx.dispatch({
          type: "ADD_SESSION",
          payload: mk(i, i % 3 === 0 ? "rdp" : i % 3 === 1 ? "ssh" : "telnet"),
        });
    });
    // Duplicate dispatches (racing restore/adopt) must not grow the list.
    act(() => {
      (globalThis as any).__ctx.dispatch({
        type: "ADD_SESSION",
        payload: mk(0, "rdp"),
      });
    });
    expect(
      (globalThis as any).__ctx.state.sessions.filter((s: { id: string }) =>
        s.id.startsWith("sess-"),
      ).length,
    ).toBe(N);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 4000));
    });
    const before = snap();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2000));
    });
    const after = snap();
    // Quiescence: with N live tabs and no input, 2 s must not re-render the tree
    // (render loop) or fan out invokes (heartbeat is 5 s, so at most one).
    expect(after.commits - before.commits).toBe(0);
    expect(after.invokes - before.invokes).toBeLessThanOrEqual(2);
  }, 60000);
});
