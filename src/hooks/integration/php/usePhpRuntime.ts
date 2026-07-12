// usePhpRuntime — real Tauri `invoke(...)` wrappers for the sorng-php "runtime"
// category (t42-php-c1): the live runtime & FPM daemon. Binds all 43 commands
// across five blocks:
//   Versions (8) · FPM Pools (9) · FPM Process/Service (13) · OPcache (7) · Sessions (6)
//
// Pairs 1:1 with the matching command blocks in
//   src-tauri/crates/sorng-php/src/commands.rs
// Every command's first arg is the live connection `id` (= the shell's
// `connectionId`); most also take a `version` string. Tauri camelCases the
// top-level fn params (`max_age_secs -> maxAgeSecs`), but request/config STRUCT
// fields stay snake_case (see `../../../types/php/runtime`). Request-bearing
// commands pass the struct as `request` (NOT `req`) in this crate.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  CachedScript,
  ConfigTestResult,
  CreateFpmPoolRequest,
  FpmWorkerProcess,
  OpcacheConfig,
  OpcacheStatus,
  PhpFpmMasterProcess,
  PhpFpmPool,
  PhpFpmPoolStatus,
  PhpFpmServiceStatus,
  PhpSapi,
  PhpSessionConfig,
  PhpVersion,
  PhpVersionDetail,
  SessionStats,
  UpdateFpmPoolRequest,
  UpdateSessionConfigRequest,
} from "../../../types/php/runtime";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const phpRuntimeApi = {
  // ── Versions (8) ────────────────────────────────────────────────────────---
  listVersions: (id: string) =>
    invoke<PhpVersion[]>("php_list_versions", { id }),
  getDefaultVersion: (id: string) =>
    invoke<PhpVersion>("php_get_default_version", { id }),
  getVersionDetail: (id: string, version: string) =>
    invoke<PhpVersionDetail>("php_get_version_detail", { id, version }),
  setDefaultVersion: (id: string, version: string) =>
    invoke<void>("php_set_default_version", { id, version }),
  listSapis: (id: string, version: string) =>
    invoke<PhpSapi[]>("php_list_sapis", { id, version }),
  getConfigPath: (id: string, version: string, sapi: string) =>
    invoke<string>("php_get_config_path", { id, version, sapi }),
  getExtensionDir: (id: string, version: string) =>
    invoke<string>("php_get_extension_dir", { id, version }),
  checkVersionInstalled: (id: string, version: string) =>
    invoke<boolean>("php_check_version_installed", { id, version }),

  // ── FPM Pools (9) ─────────────────────────────────────────────────────────
  listFpmPools: (id: string, version: string) =>
    invoke<PhpFpmPool[]>("php_list_fpm_pools", { id, version }),
  getFpmPool: (id: string, version: string, name: string) =>
    invoke<PhpFpmPool>("php_get_fpm_pool", { id, version, name }),
  createFpmPool: (id: string, request: CreateFpmPoolRequest) =>
    invoke<PhpFpmPool>("php_create_fpm_pool", { id, request }),
  updateFpmPool: (
    id: string,
    version: string,
    name: string,
    request: UpdateFpmPoolRequest,
  ) => invoke<PhpFpmPool>("php_update_fpm_pool", { id, version, name, request }),
  deleteFpmPool: (id: string, version: string, name: string) =>
    invoke<void>("php_delete_fpm_pool", { id, version, name }),
  enableFpmPool: (id: string, version: string, name: string) =>
    invoke<void>("php_enable_fpm_pool", { id, version, name }),
  disableFpmPool: (id: string, version: string, name: string) =>
    invoke<void>("php_disable_fpm_pool", { id, version, name }),
  getFpmPoolStatus: (id: string, version: string, name: string) =>
    invoke<PhpFpmPoolStatus>("php_get_fpm_pool_status", { id, version, name }),
  listFpmPoolProcesses: (id: string, version: string, name: string) =>
    invoke<FpmWorkerProcess[]>("php_list_fpm_pool_processes", {
      id,
      version,
      name,
    }),

  // ── FPM Process / Service (13) ────────────────────────────────────────────
  getFpmServiceStatus: (id: string, version: string) =>
    invoke<PhpFpmServiceStatus>("php_get_fpm_service_status", { id, version }),
  startFpm: (id: string, version: string) =>
    invoke<void>("php_start_fpm", { id, version }),
  stopFpm: (id: string, version: string) =>
    invoke<void>("php_stop_fpm", { id, version }),
  restartFpm: (id: string, version: string) =>
    invoke<void>("php_restart_fpm", { id, version }),
  reloadFpm: (id: string, version: string) =>
    invoke<void>("php_reload_fpm", { id, version }),
  enableFpm: (id: string, version: string) =>
    invoke<void>("php_enable_fpm", { id, version }),
  disableFpm: (id: string, version: string) =>
    invoke<void>("php_disable_fpm", { id, version }),
  testFpmConfig: (id: string, version: string) =>
    invoke<ConfigTestResult>("php_test_fpm_config", { id, version }),
  getFpmMasterProcess: (id: string, version: string) =>
    invoke<PhpFpmMasterProcess>("php_get_fpm_master_process", { id, version }),
  listFpmWorkerPids: (id: string, version: string) =>
    invoke<number[]>("php_list_fpm_worker_pids", { id, version }),
  gracefulRestartFpm: (id: string, version: string) =>
    invoke<void>("php_graceful_restart_fpm", { id, version }),
  reopenFpmLogs: (id: string, version: string) =>
    invoke<void>("php_reopen_fpm_logs", { id, version }),
  listAllFpmServices: (id: string) =>
    invoke<PhpFpmServiceStatus[]>("php_list_all_fpm_services", { id }),

  // ── OPcache (7) ───────────────────────────────────────────────────────────
  getOpcacheStatus: (id: string, version: string) =>
    invoke<OpcacheStatus>("php_get_opcache_status", { id, version }),
  getOpcacheConfig: (id: string, version: string) =>
    invoke<OpcacheConfig>("php_get_opcache_config", { id, version }),
  resetOpcache: (id: string, version: string) =>
    invoke<void>("php_reset_opcache", { id, version }),
  listCachedScripts: (id: string, version: string) =>
    invoke<CachedScript[]>("php_list_cached_scripts", { id, version }),
  invalidateCachedScript: (id: string, version: string, path: string) =>
    invoke<void>("php_invalidate_cached_script", { id, version, path }),
  isOpcacheEnabled: (id: string, version: string) =>
    invoke<boolean>("php_is_opcache_enabled", { id, version }),
  updateOpcacheConfig: (id: string, version: string, config: OpcacheConfig) =>
    invoke<void>("php_update_opcache_config", { id, version, config }),

  // ── Sessions (6) ──────────────────────────────────────────────────────────
  getSessionConfig: (id: string, version: string) =>
    invoke<PhpSessionConfig>("php_get_session_config", { id, version }),
  updateSessionConfig: (id: string, request: UpdateSessionConfigRequest) =>
    invoke<void>("php_update_session_config", { id, request }),
  getSessionStats: (id: string, version: string) =>
    invoke<SessionStats>("php_get_session_stats", { id, version }),
  cleanupSessions: (id: string, version: string, maxAgeSecs?: number) =>
    invoke<number>("php_cleanup_sessions", { id, version, maxAgeSecs }),
  listSessionFiles: (id: string, version: string) =>
    invoke<string[]>("php_list_session_files", { id, version }),
  getSessionSavePath: (id: string, version: string) =>
    invoke<string>("php_get_session_save_path", { id, version }),
};

export type PhpRuntimeApi = typeof phpRuntimeApi;

// ─── React hook ─────────────────────────────────────────────────────────────--

/**
 * Loading/error lifecycle for the PHP Runtime & FPM tab. `run` wraps any
 * `phpRuntimeApi` call, tracking `isLoading` and surfacing errors with the
 * shared error idiom (Tauri rejects with a plain string via the command's
 * `map_err`); it resolves to the value, or `undefined` on failure.
 */
export function usePhpRuntime() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(fn: (api: PhpRuntimeApi) => Promise<T>): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn(phpRuntimeApi);
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return { api: phpRuntimeApi, run, isLoading, error, clearError };
}

export type PhpRuntimeManager = ReturnType<typeof usePhpRuntime>;
