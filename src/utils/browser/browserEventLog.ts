/**
 * Bounded, redacting event stores for the built-in browser: a navigation/event
 * log, a proxy log and a per-connection browsing history.
 *
 * Nothing here stores credentials, tokens or query strings: every URL is
 * reduced to origin + path before it is retained, and free text is scrubbed.
 */

import { createFrameCoalescer } from "../perf/coalescer";
import { isHidden, subscribeVisibility } from "../perf/visibility";

export const BROWSER_LOG_CAPACITY = 500;
export const PROXY_LOG_CAPACITY = 500;
export const BROWSER_HISTORY_CAPACITY = 1000;
const MAX_TEXT = 300;

const REDACTED = "[redacted]";
const URL_IN_TEXT = /\b(?:https?|wss?|ftp):\/\/[^\s"'<>`]+/gi;
const SECRET_PAIR =
  /\b(authorization|proxy-authorization|cookie|set-cookie|password|passwd|pwd|secret|token|access_token|refresh_token|id_token|api[_-]?key|session(?:id)?|sid|otp|totp|code)\b(\s*[:=]\s*)(?:Bearer\s+|Basic\s+)?[^\s,;&"']+/gi;
const BEARER = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const TOKEN_SEGMENT = /^(?=.*\d)[A-Za-z0-9_-]{24,}$/;

/** Reduce a URL to origin + path. Userinfo, query and fragment are dropped. */
export function redactUrl(raw: string): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().slice(0, 2048);
  try {
    const url = new URL(trimmed);
    if (!/^(?:https?|wss?|ftp):$/.test(url.protocol)) {
      return url.protocol === "about:" ? trimmed.slice(0, 64) : url.protocol;
    }
    const path = url.pathname
      .split("/")
      .map((segment) => (TOKEN_SEGMENT.test(segment) ? REDACTED : segment))
      .join("/");
    return `${url.protocol}//${url.host}${path === "/" ? "" : path}`;
  } catch {
    return redactText(trimmed);
  }
}

/** Scrub free text: URLs lose their query/userinfo and secret pairs are masked. */
export function redactText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return (
    raw
      .replace(URL_IN_TEXT, (match) => redactUrl(match))
      .replace(JWT, REDACTED)
      .replace(BEARER, REDACTED)
      .replace(SECRET_PAIR, (_m, key: string, sep: string) => {
        return `${key}${sep}${REDACTED}`;
      })
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .slice(0, MAX_TEXT)
  );
}

/* ------------------------------------------------------------------ */
/*  Ring store                                                         */
/* ------------------------------------------------------------------ */

export interface RingStore<T> {
  push(entry: T): void;
  clear(): void;
  getSnapshot(): readonly T[];
  subscribe(listener: () => void): () => void;
  readonly capacity: number;
}

/**
 * `feed` (optional) names a BACKGROUND feed in the lane registry. When given,
 * subscriber notifications are frame-coalesced (one notify per ~16 ms burst,
 * paused while the window is hidden); entries and snapshots stay synchronous.
 * The snapshot array is rebuilt lazily, once per read after a burst, instead
 * of copying up to `capacity` entries on every push.
 */
export function createRingStore<T>(
  capacity: number,
  feed?: string,
): RingStore<T> {
  const buffer: T[] = [];
  let snapshot: readonly T[] | null = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const notifier = feed
    ? createFrameCoalescer<true>({
        name: feed,
        lane: "background",
        paused: isHidden,
        onFlush: emit,
      })
    : null;
  if (notifier)
    subscribeVisibility(() => {
      if (!isHidden()) notifier.resume();
    });
  return {
    capacity,
    push(entry) {
      if (buffer.length >= capacity)
        buffer.splice(0, buffer.length - capacity + 1);
      buffer.push(entry);
      snapshot = null;
      if (notifier) notifier.push(true);
      else emit();
    },
    clear() {
      if (!buffer.length) return;
      buffer.length = 0;
      snapshot = [];
      notifier?.clear();
      emit();
    },
    getSnapshot: () => (snapshot ??= buffer.slice()),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Browser event log                                                  */
/* ------------------------------------------------------------------ */

export type BrowserLogLevel = "info" | "warn" | "error";
export type BrowserLogType =
  | "navigation"
  | "load"
  | "load-failure"
  | "certificate"
  | "network"
  | "proxy"
  | "auth"
  | "console"
  | "lifecycle"
  | "error";

export const BROWSER_LOG_TYPES: readonly BrowserLogType[] = [
  "navigation",
  "load",
  "load-failure",
  "certificate",
  "network",
  "proxy",
  "auth",
  "console",
  "lifecycle",
  "error",
];

export interface BrowserLogEntry {
  id: number;
  at: number;
  level: BrowserLogLevel;
  type: BrowserLogType;
  message: string;
  connectionId?: string;
  sessionId?: string;
  /** Redacted origin + path only. */
  url?: string;
}

export type BrowserLogInput = Omit<BrowserLogEntry, "id" | "at"> & {
  at?: number;
};

let nextEntryId = 1;

export const browserLogStore = createRingStore<BrowserLogEntry>(
  BROWSER_LOG_CAPACITY,
  "browser-log-entries",
);

export function logBrowserEvent(input: BrowserLogInput): void {
  browserLogStore.push({
    id: nextEntryId++,
    at: input.at ?? Date.now(),
    level: input.level,
    type: input.type,
    message: redactText(input.message),
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.url ? { url: redactUrl(input.url) } : {}),
  });
}

/* ------------------------------------------------------------------ */
/*  Proxy log                                                          */
/* ------------------------------------------------------------------ */

export type ProxyLogSource = "cef" | "legacy";
export type ProxyLogKind =
  | "connection"
  | "auth"
  | "upstream"
  | "tls"
  | "request"
  | "denied"
  | "capacity"
  | "state";

export const PROXY_LOG_KINDS: readonly ProxyLogKind[] = [
  "connection",
  "auth",
  "upstream",
  "tls",
  "request",
  "denied",
  "capacity",
  "state",
];

export interface ProxyLogEntry {
  id: number;
  at: number;
  source: ProxyLogSource;
  level: BrowserLogLevel;
  kind: ProxyLogKind;
  message: string;
  sessionId?: string;
  method?: string;
  status?: number;
  url?: string;
  bytes?: number;
  latencyMs?: number;
  /** Number of events this entry stands for (counter deltas). */
  count?: number;
}

export type ProxyLogInput = Omit<ProxyLogEntry, "id" | "at"> & { at?: number };

export const proxyLogStore = createRingStore<ProxyLogEntry>(
  PROXY_LOG_CAPACITY,
  "proxy-log-entries",
);

export function logProxyEvent(input: ProxyLogInput): void {
  proxyLogStore.push({
    ...input,
    id: nextEntryId++,
    at: input.at ?? Date.now(),
    message: redactText(input.message),
    ...(input.url ? { url: redactUrl(input.url) } : {}),
    ...(input.method ? { method: redactText(input.method).slice(0, 16) } : {}),
  });
}

/* ------------------------------------------------------------------ */
/*  Filtering and export                                               */
/* ------------------------------------------------------------------ */

export function formatLogTimestamp(at: number): string {
  return new Date(at).toISOString();
}

export function browserLogToText(entries: readonly BrowserLogEntry[]): string {
  return entries
    .map(
      (e) =>
        `${formatLogTimestamp(e.at)} ${e.level.toUpperCase()} [${e.type}] ${e.message}${e.url ? ` (${e.url})` : ""}${e.sessionId ? ` session=${e.sessionId}` : ""}`,
    )
    .join("\n");
}

export function proxyLogToText(entries: readonly ProxyLogEntry[]): string {
  return entries
    .map((e) => {
      const parts = [
        formatLogTimestamp(e.at),
        e.level.toUpperCase(),
        `[${e.source}/${e.kind}]`,
        e.message,
      ];
      if (e.method) parts.push(e.method);
      if (e.url) parts.push(`(${e.url})`);
      if (e.status !== undefined) parts.push(`status=${e.status}`);
      if (e.bytes !== undefined) parts.push(`bytes=${e.bytes}`);
      if (e.latencyMs !== undefined) parts.push(`latencyMs=${e.latencyMs}`);
      return parts.join(" ");
    })
    .join("\n");
}

/* ------------------------------------------------------------------ */
/*  History                                                            */
/* ------------------------------------------------------------------ */

export interface BrowserHistoryEntry {
  id: number;
  at: number;
  connectionId: string;
  sessionId: string;
  connectionName?: string;
  /** Origin + path only. */
  url: string;
  title: string;
}

export interface BrowserHistorySettings {
  enabled: boolean;
  /** 0 keeps entries until they are removed; otherwise days to retain. */
  retentionDays: number;
}

export const DEFAULT_BROWSER_HISTORY_SETTINGS: BrowserHistorySettings = {
  enabled: true,
  retentionDays: 30,
};

const SETTINGS_KEY = "sor.browserHistory.settings.v1";
const HISTORY_KEY = "sor.browserHistory.entries.v1";
const DAY_MS = 86_400_000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function normalizeHistorySettings(
  value: unknown,
): BrowserHistorySettings {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const days = Number(raw.retentionDays);
  return {
    enabled: raw.enabled === false ? false : true,
    retentionDays: Number.isFinite(days)
      ? Math.min(3650, Math.max(0, Math.trunc(days)))
      : DEFAULT_BROWSER_HISTORY_SETTINGS.retentionDays,
  };
}

let historySettings: BrowserHistorySettings = (() => {
  try {
    const raw = storage()?.getItem(SETTINGS_KEY);
    return normalizeHistorySettings(raw ? JSON.parse(raw) : undefined);
  } catch {
    return DEFAULT_BROWSER_HISTORY_SETTINGS;
  }
})();
let historyEntries: readonly BrowserHistoryEntry[] = (() => {
  try {
    const raw = storage()?.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is BrowserHistoryEntry =>
          !!e &&
          typeof e.url === "string" &&
          typeof e.at === "number" &&
          typeof e.connectionId === "string",
      )
      .map((e, i) => ({
        id: i + 1,
        at: e.at,
        connectionId: e.connectionId,
        sessionId: String(e.sessionId ?? ""),
        ...(e.connectionName
          ? { connectionName: String(e.connectionName) }
          : {}),
        url: redactUrl(e.url),
        title: redactText(String(e.title ?? "")),
      }))
      .slice(-BROWSER_HISTORY_CAPACITY);
  } catch {
    return [];
  }
})();
nextEntryId = Math.max(nextEntryId, historyEntries.length + 1);
const historyListeners = new Set<() => void>();

function persistHistory() {
  try {
    storage()?.setItem(HISTORY_KEY, JSON.stringify(historyEntries));
  } catch {
    /* History is best effort. */
  }
}
function emitHistory() {
  persistHistory();
  historyListeners.forEach((listener) => listener());
}
function pruneByAge(
  entries: readonly BrowserHistoryEntry[],
  now: number,
): readonly BrowserHistoryEntry[] {
  if (historySettings.retentionDays <= 0) return entries;
  const cutoff = now - historySettings.retentionDays * DAY_MS;
  return entries.some((e) => e.at < cutoff)
    ? entries.filter((e) => e.at >= cutoff)
    : entries;
}

export const browserHistoryStore = {
  getSnapshot: (): readonly BrowserHistoryEntry[] => historyEntries,
  subscribe(listener: () => void) {
    historyListeners.add(listener);
    return () => historyListeners.delete(listener);
  },
  getSettings: (): BrowserHistorySettings => historySettings,
  setSettings(next: Partial<BrowserHistorySettings>) {
    historySettings = normalizeHistorySettings({ ...historySettings, ...next });
    try {
      storage()?.setItem(SETTINGS_KEY, JSON.stringify(historySettings));
    } catch {
      /* Best effort. */
    }
    if (!historySettings.enabled) historyEntries = [];
    else historyEntries = pruneByAge(historyEntries, Date.now());
    emitHistory();
  },
  /** Disabled history and `private` tabs record nothing. */
  record(input: {
    connectionId: string;
    sessionId: string;
    connectionName?: string;
    url: string;
    title: string;
    private?: boolean;
    at?: number;
  }): boolean {
    if (input.private || !historySettings.enabled) return false;
    if (!/^https?:\/\//i.test(input.url)) return false;
    const at = input.at ?? Date.now();
    const url = redactUrl(input.url);
    const title = redactText(input.title);
    const last = historyEntries[historyEntries.length - 1];
    if (last && last.sessionId === input.sessionId && last.url === url) {
      // Same page: only refresh a title that arrived late.
      if (title && title !== last.title) {
        historyEntries = [...historyEntries.slice(0, -1), { ...last, title }];
        emitHistory();
      }
      return false;
    }
    const entry: BrowserHistoryEntry = {
      id: nextEntryId++,
      at,
      connectionId: input.connectionId,
      sessionId: input.sessionId,
      ...(input.connectionName
        ? { connectionName: redactText(input.connectionName) }
        : {}),
      url,
      title,
    };
    historyEntries = pruneByAge(
      [...historyEntries, entry].slice(-BROWSER_HISTORY_CAPACITY),
      at,
    );
    emitHistory();
    return true;
  },
  remove(id: number) {
    historyEntries = historyEntries.filter((e) => e.id !== id);
    emitHistory();
  },
  clear() {
    historyEntries = [];
    emitHistory();
  },
};

/** Test helper: restore pristine module state. */
export function resetBrowserEventLogsForTests(): void {
  browserLogStore.clear();
  proxyLogStore.clear();
  historySettings = DEFAULT_BROWSER_HISTORY_SETTINGS;
  historyEntries = [];
  emitHistory();
}

/** Window event asking a live browser tab to open a history entry's page. */
export const BROWSER_HISTORY_OPEN_EVENT = "sor:browser-history-open";
export interface BrowserHistoryOpenDetail {
  sessionId: string;
  url: string;
}
