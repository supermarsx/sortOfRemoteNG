// useClamav — real Tauri `invoke(...)` wrappers for the sorng-clamav backend.
//
// Pairs 1:1 with src-tauri/crates/sorng-clamav/src/commands.rs (65 commands).
// Every stateful command is keyed by a connection `id` (the backend holds a map
// of live clients). Command arg names are camelCase — Tauri v2 maps them to the
// snake_case Rust `#[tauri::command]` params (e.g. `entryId` → `entry_id`,
// `scanId` → `scan_id`). The `config` object mirrors `ClamavConnectionConfig`'s
// serde wire shape, which has NO rename → snake_case (`ssh_user`, `clamd_conf`,
// `clamd_socket`, ...); pass it as-is.
//
// ClamAV is one self-contained sub-tab of the unified Mail Server panel; this
// hook owns its whole connection lifecycle (the mail shell provides none).

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ClamavConfigTestResult,
  ClamavConnectionConfig,
  ClamavConnectionSummary,
  ClamavDatabaseInfo,
  ClamavDatabaseUpdateResult,
  ClamavInfo,
  ClamavMilterConfig,
  ClamavOnAccessConfig,
  ClamavQuarantineEntry,
  ClamavQuarantineStats,
  ClamavScanRequest,
  ClamavScanResult,
  ClamavScanSummary,
  ClamavScheduledScan,
  ClamdConfigEntry,
  ClamdStats,
  FreshclamConfigEntry,
} from "../../../types/mail/clamav";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const clamavApi = {
  // Connection lifecycle (4)
  connect: (id: string, config: ClamavConnectionConfig) =>
    invoke<ClamavConnectionSummary>("clamav_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("clamav_disconnect", { id }),
  listConnections: () => invoke<string[]>("clamav_list_connections"),
  ping: (id: string) => invoke<boolean>("clamav_ping", { id }),

  // Scanning (6)
  scan: (id: string, request: ClamavScanRequest) =>
    invoke<ClamavScanSummary>("clamav_scan", { id, request }),
  quickScan: (id: string, path: string) =>
    invoke<ClamavScanResult>("clamav_quick_scan", { id, path }),
  scanStream: (id: string, data: string) =>
    invoke<ClamavScanResult>("clamav_scan_stream", { id, data }),
  multiscan: (id: string, path: string) =>
    invoke<ClamavScanSummary>("clamav_multiscan", { id, path }),
  contscan: (id: string, path: string) =>
    invoke<ClamavScanSummary>("clamav_contscan", { id, path }),
  allmatchscan: (id: string, path: string) =>
    invoke<ClamavScanSummary>("clamav_allmatchscan", { id, path }),

  // Database (8)
  listDatabases: (id: string) =>
    invoke<ClamavDatabaseInfo[]>("clamav_list_databases", { id }),
  updateDatabases: (id: string) =>
    invoke<ClamavDatabaseUpdateResult[]>("clamav_update_databases", { id }),
  updateDatabase: (id: string, name: string) =>
    invoke<ClamavDatabaseUpdateResult>("clamav_update_database", { id, name }),
  checkUpdate: (id: string) =>
    invoke<boolean>("clamav_check_update", { id }),
  getMirrors: (id: string) =>
    invoke<string[]>("clamav_get_mirrors", { id }),
  addMirror: (id: string, url: string) =>
    invoke<void>("clamav_add_mirror", { id, url }),
  removeMirror: (id: string, url: string) =>
    invoke<void>("clamav_remove_mirror", { id, url }),
  getDbVersion: (id: string) =>
    invoke<string>("clamav_get_db_version", { id }),

  // Quarantine (6)
  listQuarantine: (id: string) =>
    invoke<ClamavQuarantineEntry[]>("clamav_list_quarantine", { id }),
  getQuarantineEntry: (id: string, entryId: string) =>
    invoke<ClamavQuarantineEntry>("clamav_get_quarantine_entry", {
      id,
      entryId,
    }),
  restoreQuarantine: (id: string, entryId: string) =>
    invoke<void>("clamav_restore_quarantine", { id, entryId }),
  deleteQuarantine: (id: string, entryId: string) =>
    invoke<void>("clamav_delete_quarantine", { id, entryId }),
  deleteAllQuarantine: (id: string) =>
    invoke<void>("clamav_delete_all_quarantine", { id }),
  getQuarantineStats: (id: string) =>
    invoke<ClamavQuarantineStats>("clamav_get_quarantine_stats", { id }),

  // Clamd config (7)
  getClamdConfig: (id: string) =>
    invoke<ClamdConfigEntry[]>("clamav_get_clamd_config", { id }),
  getClamdParam: (id: string, key: string) =>
    invoke<ClamdConfigEntry>("clamav_get_clamd_param", { id, key }),
  setClamdParam: (id: string, key: string, value: string) =>
    invoke<void>("clamav_set_clamd_param", { id, key, value }),
  deleteClamdParam: (id: string, key: string) =>
    invoke<void>("clamav_delete_clamd_param", { id, key }),
  getSocket: (id: string) => invoke<string>("clamav_get_socket", { id }),
  setSocket: (id: string, socket: string) =>
    invoke<void>("clamav_set_socket", { id, socket }),
  testClamdConfig: (id: string) =>
    invoke<ClamavConfigTestResult>("clamav_test_clamd_config", { id }),

  // Freshclam config (6)
  getFreshclamConfig: (id: string) =>
    invoke<FreshclamConfigEntry[]>("clamav_get_freshclam_config", { id }),
  getFreshclamParam: (id: string, key: string) =>
    invoke<FreshclamConfigEntry>("clamav_get_freshclam_param", { id, key }),
  setFreshclamParam: (id: string, key: string, value: string) =>
    invoke<void>("clamav_set_freshclam_param", { id, key, value }),
  deleteFreshclamParam: (id: string, key: string) =>
    invoke<void>("clamav_delete_freshclam_param", { id, key }),
  getUpdateInterval: (id: string) =>
    invoke<number>("clamav_get_update_interval", { id }),
  setUpdateInterval: (id: string, hours: number) =>
    invoke<void>("clamav_set_update_interval", { id, hours }),

  // On-access (6)
  getOnAccessConfig: (id: string) =>
    invoke<ClamavOnAccessConfig>("clamav_get_on_access_config", { id }),
  setOnAccessConfig: (id: string, config: ClamavOnAccessConfig) =>
    invoke<void>("clamav_set_on_access_config", { id, config }),
  enableOnAccess: (id: string) =>
    invoke<void>("clamav_enable_on_access", { id }),
  disableOnAccess: (id: string) =>
    invoke<void>("clamav_disable_on_access", { id }),
  addOnAccessPath: (id: string, path: string) =>
    invoke<void>("clamav_add_on_access_path", { id, path }),
  removeOnAccessPath: (id: string, path: string) =>
    invoke<void>("clamav_remove_on_access_path", { id, path }),

  // Milter (4)
  getMilterConfig: (id: string) =>
    invoke<ClamavMilterConfig>("clamav_get_milter_config", { id }),
  setMilterConfig: (id: string, config: ClamavMilterConfig) =>
    invoke<void>("clamav_set_milter_config", { id, config }),
  enableMilter: (id: string) => invoke<void>("clamav_enable_milter", { id }),
  disableMilter: (id: string) => invoke<void>("clamav_disable_milter", { id }),

  // Scheduled scans (8)
  listScheduledScans: (id: string) =>
    invoke<ClamavScheduledScan[]>("clamav_list_scheduled_scans", { id }),
  getScheduledScan: (id: string, scanId: string) =>
    invoke<ClamavScheduledScan>("clamav_get_scheduled_scan", { id, scanId }),
  createScheduledScan: (id: string, scan: ClamavScheduledScan) =>
    invoke<ClamavScheduledScan>("clamav_create_scheduled_scan", { id, scan }),
  updateScheduledScan: (
    id: string,
    scanId: string,
    scan: ClamavScheduledScan,
  ) =>
    invoke<ClamavScheduledScan>("clamav_update_scheduled_scan", {
      id,
      scanId,
      scan,
    }),
  deleteScheduledScan: (id: string, scanId: string) =>
    invoke<void>("clamav_delete_scheduled_scan", { id, scanId }),
  enableScheduledScan: (id: string, scanId: string) =>
    invoke<void>("clamav_enable_scheduled_scan", { id, scanId }),
  disableScheduledScan: (id: string, scanId: string) =>
    invoke<void>("clamav_disable_scheduled_scan", { id, scanId }),
  runScheduledScan: (id: string, scanId: string) =>
    invoke<ClamavScanSummary>("clamav_run_scheduled_scan", { id, scanId }),

  // Process management (10)
  startClamd: (id: string) => invoke<void>("clamav_start_clamd", { id }),
  stopClamd: (id: string) => invoke<void>("clamav_stop_clamd", { id }),
  restartClamd: (id: string) => invoke<void>("clamav_restart_clamd", { id }),
  reloadClamd: (id: string) => invoke<void>("clamav_reload_clamd", { id }),
  clamdStatus: (id: string) =>
    invoke<ClamdStats>("clamav_clamd_status", { id }),
  startFreshclam: (id: string) =>
    invoke<void>("clamav_start_freshclam", { id }),
  stopFreshclam: (id: string) => invoke<void>("clamav_stop_freshclam", { id }),
  restartFreshclam: (id: string) =>
    invoke<void>("clamav_restart_freshclam", { id }),
  version: (id: string) => invoke<string>("clamav_version", { id }),
  info: (id: string) => invoke<ClamavInfo>("clamav_info", { id }),
};

export type ClamavApi = typeof clamavApi;

// ─── React hook ─────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful ClamAV session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, plus shared `isLoading`/`error`, and exposes the full
 * 65-command surface via `api` (each call takes the connection id). The `run`
 * wrapper funnels arbitrary ops through the same loading/error handling
 * (matching useHaproxy).
 */
export function useClamav() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ClamavConnectionSummary | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against overlapping in-flight ops flipping isLoading incorrectly.
  const inflight = useRef(0);

  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    inflight.current += 1;
    setIsLoading(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setIsLoading(false);
    }
  }, []);

  const connect = useCallback(
    async (id: string, config: ClamavConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await clamavApi.connect(id, config);
        setConnectionId(id);
        setSummary(s);
        return true;
      } catch (e) {
        setError(errMsg(e));
        return false;
      } finally {
        setIsConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      await clamavApi.disconnect(connectionId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, [connectionId]);

  /** Ping the live connection for a liveness check (returns backend `bool`). */
  const ping = useCallback(async (): Promise<boolean> => {
    if (!connectionId) return false;
    try {
      return await clamavApi.ping(connectionId);
    } catch (e) {
      setError(errMsg(e));
      return false;
    }
  }, [connectionId]);

  /** Refresh the header summary from `clamav_info` (ping only returns a bool). */
  const refreshSummary = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      const info = await clamavApi.info(connectionId);
      setSummary((prev) => ({
        host: prev?.host ?? "",
        version: info.version,
        database_version: info.database_version,
        signature_count: info.signature_count,
        last_update: prev?.last_update ?? null,
      }));
    } catch {
      // Non-fatal — the connection is live even if the info echo fails.
    }
  }, [connectionId]);

  const clearError = useCallback(() => setError(null), []);

  return {
    // state
    connectionId,
    summary,
    isConnected: connectionId !== null,
    isConnecting,
    isLoading,
    error,
    setError,
    clearError,
    // lifecycle
    connect,
    disconnect,
    ping,
    refreshSummary,
    // full command surface + shared runner
    api: clamavApi,
    run,
  };
}

export type ClamavManager = ReturnType<typeof useClamav>;
