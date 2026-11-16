/**
 * Durable workspace snapshot: which tabs exist, in which order, which one is
 * active, the tiling mode, and the backend session id each tab was bound to.
 *
 * Security: the snapshot is built from an explicit allow-list of non-secret
 * fields (ids, titles, host, protocol, layout). Passwords, keys, tokens,
 * terminal output and unsent input are never read here, so they cannot leak
 * into storage even if a session object grows new fields.
 *
 * Storage: localStorage (synchronous, survives window/webview recreation,
 * which sessionStorage does not). A debounced writer plus a synchronous flush
 * for pagehide keeps the last state without write amplification.
 */

import type { ConnectionSession } from "../../types/connection/connection";

export const WORKSPACE_SNAPSHOT_VERSION = 1;
export const WORKSPACE_SNAPSHOT_STORAGE_KEY = "sorng-workspace-snapshot-v1";
export const MAX_SNAPSHOT_TABS = 128;
export const MAX_SNAPSHOT_CHARS = 524_288;
export const SNAPSHOT_WRITE_DEBOUNCE_MS = 750;
/** A durable snapshot older than this is not used to resurrect a window. */
export const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

const MAX_ID_CHARS = 256;
const MAX_TEXT_CHARS = 512;
const MAX_HOST_CHARS = 2_048;

/** Protocols whose backend sessions can be re-adopted after a reload today. */
export const ADOPTABLE_PROTOCOLS: ReadonlySet<string> = new Set(["ssh", "rdp"]);

export interface WorkspaceSnapshotTab {
  tabId: string;
  connectionId: string;
  protocol: string;
  name: string;
  hostname: string;
  order: number;
  group?: string;
  /** Only for adoptable protocols whose transport was connected at save time. */
  backendSessionId?: string;
  /** Vertical scroll offset of the viewer; cheap UI state. */
  scrollY?: number;
}

export interface WorkspaceSnapshotLayout {
  mode: string;
  customCols?: number;
  customRows?: number;
}

export interface WorkspaceSnapshot {
  version: typeof WORKSPACE_SNAPSHOT_VERSION;
  savedAt: number;
  tabs: WorkspaceSnapshotTab[];
  activeTabId?: string;
  layout?: WorkspaceSnapshotLayout;
}

export interface BuildSnapshotInput {
  sessions: readonly ConnectionSession[];
  activeSessionId?: string;
  layout?: WorkspaceSnapshotLayout;
  scrollBySession?: Readonly<Record<string, number>>;
  now: number;
  /** Tool tabs and similar stateless surfaces are filtered by the caller. */
  isRestorable?: (session: ConnectionSession) => boolean;
}

const boundedString = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : undefined;

export function buildWorkspaceSnapshot(
  input: BuildSnapshotInput,
): WorkspaceSnapshot {
  const tabs: WorkspaceSnapshotTab[] = [];
  const seen = new Set<string>();
  for (const session of input.sessions) {
    if (input.isRestorable && !input.isRestorable(session)) continue;
    const tabId = boundedString(session.id, MAX_ID_CHARS);
    const connectionId = boundedString(session.connectionId, MAX_ID_CHARS);
    if (!tabId || !connectionId || seen.has(tabId)) continue;
    seen.add(tabId);
    const adoptable =
      ADOPTABLE_PROTOCOLS.has(session.protocol) &&
      session.status === "connected";
    const backendSessionId = adoptable
      ? boundedString(session.backendSessionId, MAX_ID_CHARS)
      : undefined;
    const scroll = input.scrollBySession?.[tabId];
    tabs.push({
      tabId,
      connectionId,
      protocol: boundedString(session.protocol, 64) ?? "unknown",
      name: boundedString(session.name, MAX_TEXT_CHARS) ?? connectionId,
      hostname: boundedString(session.hostname, MAX_HOST_CHARS) ?? "",
      order: tabs.length,
      ...(boundedString(session.group, 256) ? { group: session.group } : {}),
      ...(backendSessionId ? { backendSessionId } : {}),
      ...(typeof scroll === "number" && Number.isFinite(scroll) && scroll >= 0
        ? { scrollY: Math.round(scroll) }
        : {}),
    });
    if (tabs.length >= MAX_SNAPSHOT_TABS) break;
  }
  const activeTabId =
    input.activeSessionId && seen.has(input.activeSessionId)
      ? input.activeSessionId
      : undefined;
  return {
    version: WORKSPACE_SNAPSHOT_VERSION,
    savedAt: input.now,
    tabs,
    ...(activeTabId ? { activeTabId } : {}),
    ...(input.layout ? { layout: input.layout } : {}),
  };
}

/** Validate untrusted stored data; returns null for anything unusable. */
export function parseWorkspaceSnapshot(raw: unknown): WorkspaceSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== WORKSPACE_SNAPSHOT_VERSION) return null;
  if (typeof record.savedAt !== "number" || !Number.isFinite(record.savedAt)) {
    return null;
  }
  if (!Array.isArray(record.tabs) || record.tabs.length > MAX_SNAPSHOT_TABS) {
    return null;
  }
  const tabs: WorkspaceSnapshotTab[] = [];
  for (const candidate of record.tabs) {
    if (!candidate || typeof candidate !== "object") return null;
    const tab = candidate as Record<string, unknown>;
    const tabId = boundedString(tab.tabId, MAX_ID_CHARS);
    const connectionId = boundedString(tab.connectionId, MAX_ID_CHARS);
    const protocol = boundedString(tab.protocol, 64);
    if (!tabId || !connectionId || !protocol) return null;
    const backendSessionId = boundedString(tab.backendSessionId, MAX_ID_CHARS);
    const group = boundedString(tab.group, 256);
    tabs.push({
      tabId,
      connectionId,
      protocol,
      name: boundedString(tab.name, MAX_TEXT_CHARS) ?? connectionId,
      hostname: boundedString(tab.hostname, MAX_HOST_CHARS) ?? "",
      order: typeof tab.order === "number" ? tab.order : tabs.length,
      ...(group ? { group } : {}),
      ...(backendSessionId ? { backendSessionId } : {}),
      ...(typeof tab.scrollY === "number" &&
      Number.isFinite(tab.scrollY) &&
      tab.scrollY >= 0
        ? { scrollY: tab.scrollY }
        : {}),
    });
  }
  const layoutRaw = record.layout as Record<string, unknown> | undefined;
  const layout: WorkspaceSnapshotLayout | undefined =
    layoutRaw &&
    typeof layoutRaw.mode === "string" &&
    layoutRaw.mode.length <= 32
      ? {
          mode: layoutRaw.mode,
          ...(typeof layoutRaw.customCols === "number"
            ? { customCols: layoutRaw.customCols }
            : {}),
          ...(typeof layoutRaw.customRows === "number"
            ? { customRows: layoutRaw.customRows }
            : {}),
        }
      : undefined;
  const activeTabId = boundedString(record.activeTabId, MAX_ID_CHARS);
  return {
    version: WORKSPACE_SNAPSHOT_VERSION,
    savedAt: record.savedAt,
    tabs,
    ...(activeTabId ? { activeTabId } : {}),
    ...(layout ? { layout } : {}),
  };
}

export interface SnapshotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultStorage = (): SnapshotStorage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export function loadWorkspaceSnapshot(
  storage: SnapshotStorage | null = defaultStorage(),
): WorkspaceSnapshot | null {
  if (!storage) return null;
  try {
    const text = storage.getItem(WORKSPACE_SNAPSHOT_STORAGE_KEY);
    if (!text || text.length > MAX_SNAPSHOT_CHARS) return null;
    return parseWorkspaceSnapshot(JSON.parse(text));
  } catch {
    return null;
  }
}

export function saveWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  storage: SnapshotStorage | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    const text = JSON.stringify(snapshot);
    if (text.length > MAX_SNAPSHOT_CHARS) return false;
    storage.setItem(WORKSPACE_SNAPSHOT_STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function clearWorkspaceSnapshot(
  storage: SnapshotStorage | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(WORKSPACE_SNAPSHOT_STORAGE_KEY);
  } catch {
    // best effort
  }
}

/** True when a stored snapshot is fresh enough to resurrect a lost window. */
export function isSnapshotFresh(
  snapshot: WorkspaceSnapshot,
  now: number,
): boolean {
  const age = now - snapshot.savedAt;
  return age >= 0 && age <= SNAPSHOT_MAX_AGE_MS;
}

/**
 * Debounced writer: collapses bursts of state changes into one write, and
 * `flush()` writes synchronously (pagehide / visibilitychange).
 */
export class WorkspaceSnapshotWriter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: WorkspaceSnapshot | null = null;

  constructor(
    private readonly storage: SnapshotStorage | null = defaultStorage(),
    private readonly debounceMs = SNAPSHOT_WRITE_DEBOUNCE_MS,
  ) {}

  schedule(snapshot: WorkspaceSnapshot): void {
    this.pending = snapshot;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const snapshot = this.pending;
    this.pending = null;
    if (!snapshot) return;
    if (snapshot.tabs.length === 0) {
      clearWorkspaceSnapshot(this.storage);
      return;
    }
    saveWorkspaceSnapshot(snapshot, this.storage);
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}
