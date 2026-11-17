import { useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

/** Mirrors `safe_mode::Status` (src-tauri/src/safe_mode.rs). */
export interface SafeModeMarker {
  pid: number;
  startedAtMs: number;
  version: string;
  consecutiveUnclean: number;
}

export interface SafeModeStatus {
  active: boolean;
  reason: "unclean-exits" | "forced" | "next-start" | null;
  consecutiveUnclean: number;
  threshold: number;
  lastUncleanMs: number[];
  previousMarker: SafeModeMarker | null;
  startedAtMs: number;
  startNextTime: boolean;
  tracking: boolean;
  devExempt: boolean;
}

interface Snapshot {
  status: SafeModeStatus | null;
  /** One-shot: the user explicitly asked to restore the saved workspace. */
  restoreAllowed: boolean;
  /** The banner was dismissed ("Stay in safe mode"); safe mode stays active. */
  bannerDismissed: boolean;
}

let snapshot: Snapshot = {
  status: null,
  restoreAllowed: false,
  bannerDismissed: false,
};
const listeners = new Set<() => void>();

function set(next: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** True while this run is in safe mode (background work must stay off). */
export const isSafeModeActive = (): boolean => snapshot.status?.active === true;

/** True when saved sessions/workspace must not be restored automatically. */
export const isWorkspaceRestoreBlocked = (): boolean =>
  isSafeModeActive() && !snapshot.restoreAllowed;

export const getSafeModeSnapshot = (): Snapshot => snapshot;

export function useSafeMode(): Snapshot {
  return useSyncExternalStore(subscribe, getSafeModeSnapshot);
}

/** Subscribe to restore-block changes without React (used by tests). */
export const subscribeSafeMode = subscribe;

const STATUS_TIMEOUT_MS = 2000;

/** Loads the backend status. Fails open: an error or timeout means "not safe mode". */
export async function loadSafeModeStatus(): Promise<SafeModeStatus | null> {
  if (!isTauri()) return null;
  try {
    const status = await Promise.race([
      invoke<SafeModeStatus>("safe_mode_status"),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), STATUS_TIMEOUT_MS),
      ),
    ]);
    if (status) set({ status });
    return status;
  } catch {
    return null;
  }
}

export const refreshSafeModeStatus = loadSafeModeStatus;

/** Explicit one-shot restore of the saved workspace (user confirmed). */
export function allowWorkspaceRestoreOnce(): void {
  set({ restoreAllowed: true });
}

export function dismissSafeModeBanner(): void {
  set({ bannerDismissed: true });
}

export const restartNormally = (): Promise<void> =>
  invoke<void>("safe_mode_restart_normally");

export const updateSafeModeConfig = (config: {
  threshold?: number;
  startNextTime?: boolean;
}): Promise<SafeModeStatus> =>
  invoke<SafeModeStatus>("safe_mode_update_config", config);

export const simulateUncleanExits = (count?: number): Promise<SafeModeStatus> =>
  invoke<SafeModeStatus>("safe_mode_simulate_unclean_exits", { count });

/** Test hook: replace the store contents. */
export function __setSafeModeForTests(next: Partial<Snapshot>): void {
  set(next);
}
export function __resetSafeModeForTests(): void {
  snapshot = { status: null, restoreAllowed: false, bannerDismissed: false };
  listeners.forEach((listener) => listener());
}
