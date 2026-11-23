import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import type { ConnectionSession } from "../../types/connection/connection";
import { SettingsManager } from "../settings/settingsManager";
import { normalizeWebBrowserSettings } from "../settings/webBrowserSettings";
import {
  originBrowserBounds,
  type OriginBrowserBounds,
  type OriginBrowserIdentity,
} from "../../types/protocols/originBrowser";

/**
 * Display-only reparent of a real-origin browser page.
 *
 * The page stays owned by the `main` window (native lease, sink, downloads,
 * certificate hooks). A detached window only *displays* the same live native
 * page in a slot: it reports slot bounds / overlay rectangles to `main`, and
 * relays toolbar actions to `main`. Nothing here moves authority; events from
 * the detached window are untrusted display hints that main validates.
 */

/** detached -> main: where the page should be drawn, in the detached window. */
export const NATIVE_DISPLAY_SLOT_EVENT = "sorng:native-display-slot";
/** detached -> main: toolbar actions applied by main's controller. */
export const NATIVE_DISPLAY_COMMAND_EVENT = "sorng:native-display-command";
/** main -> detached: page state for the detached toolbar. */
export const NATIVE_DISPLAY_STATE_EVENT = "sorng:native-display-state";
/** Native -> main window: the page left its display window or was closed. */
export const NATIVE_DISPLAY_RETURNED_EVENT = "origin-browser-reparent";

/** How long main waits for the detached window to report a usable slot. */
export const NATIVE_DISPLAY_SLOT_TIMEOUT_MS = 15_000;

export const NATIVE_DISPLAY_NEEDS_MAIN_MESSAGE =
  "The page needs a decision in the main window, so it was returned there.";
export const NATIVE_DISPLAY_FAILED_MESSAGE =
  "The page could not be shown in its own window, so it stays in the main window.";

export interface NativeDisplaySlot {
  /** Null while the slot is hidden or too small to display the page. */
  bounds: OriginBrowserBounds | null;
  rectangles: OriginBrowserBounds[];
  blocked: boolean;
}

export interface NativeDisplayState {
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  phase: string;
}

export type NativeDisplayAction =
  | { kind: "navigate"; url: string }
  | { kind: "back" }
  | { kind: "forward" }
  | { kind: "reload" }
  | { kind: "stop" }
  | { kind: "release" };

const MAX_RECTANGLES = 32;
const MAX_URL_LENGTH = 8192;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Only an exactly shaped report for this session is accepted. */
export function parseSlotReport(
  sessionId: string,
  payload: unknown,
): NativeDisplaySlot | null {
  if (!isRecord(payload) || payload.sessionId !== sessionId) return null;
  const rectangles: OriginBrowserBounds[] = [];
  if (!Array.isArray(payload.rectangles)) return null;
  if (payload.rectangles.length > MAX_RECTANGLES) return null;
  for (const raw of payload.rectangles) {
    const rect = isRecord(raw)
      ? originBrowserBounds(raw as unknown as OriginBrowserBounds)
      : null;
    if (!rect) return null;
    rectangles.push(rect);
  }
  const bounds = isRecord(payload.bounds)
    ? originBrowserBounds(payload.bounds as unknown as OriginBrowserBounds)
    : null;
  if (payload.bounds !== null && payload.bounds !== undefined && !bounds)
    return null;
  return { bounds, rectangles, blocked: payload.blocked === true };
}

export function parseDisplayAction(
  sessionId: string,
  payload: unknown,
): NativeDisplayAction | null {
  if (!isRecord(payload) || payload.sessionId !== sessionId) return null;
  const action = payload.action;
  if (!isRecord(action)) return null;
  switch (action.kind) {
    case "navigate":
      return typeof action.url === "string" &&
        action.url.length > 0 &&
        action.url.length <= MAX_URL_LENGTH
        ? { kind: "navigate", url: action.url }
        : null;
    case "back":
    case "forward":
    case "reload":
    case "stop":
    case "release":
      return { kind: action.kind };
    default:
      return null;
  }
}

export function parseDisplayState(
  sessionId: string,
  payload: unknown,
): NativeDisplayState | null {
  if (!isRecord(payload) || payload.sessionId !== sessionId) return null;
  const state = payload.state;
  if (!isRecord(state)) return null;
  const text = (value: unknown, max: number) =>
    typeof value === "string" ? value.slice(0, max) : "";
  return {
    title: text(state.title, 512),
    url: text(state.url, MAX_URL_LENGTH),
    loading: state.loading === true,
    canGoBack: state.canGoBack === true,
    canGoForward: state.canGoForward === true,
    phase: text(state.phase, 32),
  };
}

/** A real-origin page is one native browser instance parented to the window
 * that created it. A second window cannot adopt it, only start a new page. */
export function isNativeOriginBrowserSession(
  session: ConnectionSession,
): boolean {
  if (session.protocol !== "http" && session.protocol !== "https") return false;
  try {
    return (
      normalizeWebBrowserSettings(
        SettingsManager.getInstance().getSettings().webBrowser,
      ).engine !== "legacy"
    );
  } catch {
    // Unreadable settings never select the legacy engine for a page.
    return true;
  }
}

/* ── Native transport (owner window only) ────────────────────────────── */

export interface NativeDisplayTransport {
  capability(): Promise<boolean>;
  move(identity: OriginBrowserIdentity, target: string): Promise<void>;
  claim(identity: OriginBrowserIdentity, target: string): Promise<void>;
  release(identity: OriginBrowserIdentity): Promise<void>;
}

const defaultTransport: NativeDisplayTransport = {
  capability: async () =>
    (await invoke<boolean>("origin_browser_reparent_capability")) === true,
  move: (identity, target) =>
    invoke("origin_browser_reparent", {
      request: { identity, action: { kind: "move", target } },
    }),
  claim: (identity, target) =>
    invoke("origin_browser_reparent", {
      request: { identity, action: { kind: "claim", target } },
    }),
  release: (identity) =>
    invoke("origin_browser_reparent", {
      request: { identity, action: { kind: "release" } },
    }),
};

let transport: NativeDisplayTransport = defaultTransport;
export function setNativeDisplayTransportForTests(
  next: NativeDisplayTransport | null,
): void {
  transport = next ?? defaultTransport;
  probe = null;
}
export const nativeDisplayTransport = (): NativeDisplayTransport => transport;

let probe: Promise<boolean> | null = null;
/** Whether this build/platform can show the live page in a second window.
 * Any error means "no": the refusal stays in place. */
export function probeNativeDisplaySupport(): Promise<boolean> {
  probe ??= transport
    .capability()
    .catch(() => false)
    .then((supported) => {
      // Only a positive answer is final; a refusal is asked again next time.
      if (!supported) probe = null;
      return supported;
    });
  return probe;
}

/* ── Main-window store ───────────────────────────────────────────────── */

export type NativeDisplayPhase =
  "requested" | "moving" | "waiting" | "claimed" | "returning";

export interface NativeDisplayEntry {
  readonly phase: NativeDisplayPhase;
  readonly target: string;
  /** Latest slot reported by the target window. */
  readonly slot: NativeDisplaySlot | null;
}

let entries: ReadonlyMap<string, NativeDisplayEntry> = new Map();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

function write(next: Map<string, NativeDisplayEntry>) {
  entries = next;
  emit();
}

export const nativeDisplayStore = {
  get: (sessionId: string): NativeDisplayEntry | undefined =>
    entries.get(sessionId),
  request(sessionId: string, target: string): boolean {
    if (entries.has(sessionId)) return false;
    write(
      new Map(entries).set(sessionId, {
        phase: "requested",
        target,
        slot: null,
      }),
    );
    return true;
  },
  update(sessionId: string, patch: Partial<NativeDisplayEntry>): void {
    const current = entries.get(sessionId);
    if (!current) return;
    write(new Map(entries).set(sessionId, { ...current, ...patch }));
  },
  clear(sessionId: string): void {
    if (!entries.has(sessionId)) return;
    const next = new Map(entries);
    next.delete(sessionId);
    write(next);
  },
  reset(): void {
    write(new Map());
  },
};

export function useNativeDisplayEntry(
  sessionId: string,
): NativeDisplayEntry | undefined {
  return useSyncExternalStore(
    subscribe,
    () => entries.get(sessionId),
    () => undefined,
  );
}

let idsCache: { source: typeof entries; ids: ReadonlySet<string> } | null =
  null;
const currentIds = (): ReadonlySet<string> => {
  if (!idsCache || idsCache.source !== entries)
    idsCache = { source: entries, ids: new Set(entries.keys()) };
  return idsCache.ids;
};
const noIds: ReadonlySet<string> = new Set();
/** Sessions whose live page is displayed outside the main window. */
export function useNativeDisplayedSessionIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, currentIds, () => noIds);
}
