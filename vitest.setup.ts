import "@testing-library/jest-dom";
// Provide a browser-like IndexedDB implementation for tests
import "fake-indexeddb/auto";

// jsdom does not implement scrollIntoView; stub it globally for custom Select tests
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

// Mock Tauri API
import { vi } from "vitest";

const createMemoryStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
};

const ensureStorageApi = (key: "localStorage" | "sessionStorage") => {
  const current = globalThis[key];
  const hasStorageApi =
    typeof current !== "undefined" &&
    typeof current.getItem === "function" &&
    typeof current.setItem === "function" &&
    typeof current.removeItem === "function" &&
    typeof current.clear === "function";

  if (hasStorageApi) return;

  const fallback = createMemoryStorage();
  try {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: fallback,
    });
  } catch {
    (globalThis as Record<string, unknown>)[key] = fallback;
  }
};

ensureStorageApi("localStorage");
ensureStorageApi("sessionStorage");

if (!("__TAURI_EVENT_PLUGIN_INTERNALS__" in window)) {
  Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
    configurable: true,
    writable: true,
    value: {
      registerListener: vi.fn(),
      unregisterListener: vi.fn(),
    },
  });
}

// Mock ResizeObserver (not available in jsdom)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    constructor(_cb: ResizeObserverCallback) {}
  } as unknown as typeof ResizeObserver;
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  transformCallback: vi.fn(),
  Channel: vi.fn().mockImplementation(() => ({
    id: 0,
    onmessage: vi.fn(),
    toJSON: vi.fn(() => "channel:0"),
  })),
}));

// Mock Tauri plugin-fs
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
}));

// Mock Tauri plugin-dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

// Mock Tauri path API
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/mock/app/data"),
  join: vi.fn((...args: string[]) => args.join("/")),
}));
