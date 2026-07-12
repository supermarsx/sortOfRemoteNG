// usePhpConfig — real Tauri `invoke(...)` wrappers for the sorng-php "config"
// category (t42-php-c2): Configuration, Extensions & Composer. Binds all 45
// commands across four blocks:
//   php.ini (10) · Modules/Extensions/PECL (11) · Composer (15) · Logs (9)
//
// Pairs 1:1 with the matching command blocks in
//   src-tauri/crates/sorng-php/src/commands.rs
// Every command's first arg is the live connection `id` (= the shell's
// `connectionId`); most also take a `version` string. Tauri camelCases the
// top-level fn params, so two-word Rust params map as `backup_path -> backupPath`,
// `module_name -> moduleName`, `project_path -> projectPath`, `log_path ->
// logPath`; request-bearing commands pass the struct as `request`. Request STRUCT
// fields stay snake_case (see `../../../types/php/config`).

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  ComposerGlobalPackage,
  ComposerInfo,
  ComposerInstallRequest,
  ComposerPackage,
  ComposerProject,
  ComposerRunResult,
  ComposerUpdateRequest,
  DisableModuleRequest,
  EnableModuleRequest,
  FpmLogConfig,
  IniBackup,
  InstallModuleRequest,
  PeclPackage,
  PhpIniDirective,
  PhpIniFile,
  PhpIniScanDir,
  PhpLogConfig,
  PhpLogEntry,
  PhpLogReadRequest,
  PhpModule,
  RemovePackageRequest,
  RequirePackageRequest,
  SetIniDirectiveRequest,
} from "../../../types/php/config";

/** Minimal shape of a `php_list_versions` row — this "config" tab reads it
 *  read-only to populate its version picker (the full `PhpVersion` type is owned
 *  by the runtime category). Only the fields the picker needs are modelled. */
export interface PhpVersionOption {
  version: string;
  is_default: boolean;
}

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const phpConfigApi = {
  // ── Version picker (read-only; owned by the runtime category) ───────────────
  listVersions: (id: string) =>
    invoke<PhpVersionOption[]>("php_list_versions", { id }),

  // ── php.ini (10) ────────────────────────────────────────────────────────────
  getIniFile: (id: string, version: string, sapi: string) =>
    invoke<PhpIniFile>("php_get_ini_file", { id, version, sapi }),
  listIniDirectives: (id: string, version: string, sapi: string) =>
    invoke<PhpIniDirective[]>("php_list_ini_directives", { id, version, sapi }),
  getIniDirective: (id: string, version: string, sapi: string, key: string) =>
    invoke<PhpIniDirective>("php_get_ini_directive", { id, version, sapi, key }),
  setIniDirective: (id: string, request: SetIniDirectiveRequest) =>
    invoke<void>("php_set_ini_directive", { id, request }),
  removeIniDirective: (
    id: string,
    version: string,
    sapi: string,
    key: string,
  ) => invoke<void>("php_remove_ini_directive", { id, version, sapi, key }),
  getIniScanDir: (id: string, version: string, sapi: string) =>
    invoke<PhpIniScanDir>("php_get_ini_scan_dir", { id, version, sapi }),
  listLoadedIniFiles: (id: string, version: string) =>
    invoke<string[]>("php_list_loaded_ini_files", { id, version }),
  backupIni: (id: string, version: string, sapi: string) =>
    invoke<IniBackup>("php_backup_ini", { id, version, sapi }),
  restoreIni: (id: string, backupPath: string, targetPath: string) =>
    invoke<void>("php_restore_ini", { id, backupPath, targetPath }),
  validateIni: (id: string, version: string) =>
    invoke<boolean>("php_validate_ini", { id, version }),

  // ── Modules / Extensions / PECL (11) ────────────────────────────────────────
  listModules: (id: string, version: string) =>
    invoke<PhpModule[]>("php_list_modules", { id, version }),
  getModule: (id: string, version: string, name: string) =>
    invoke<PhpModule>("php_get_module", { id, version, name }),
  enableModule: (id: string, request: EnableModuleRequest) =>
    invoke<void>("php_enable_module", { id, request }),
  disableModule: (id: string, request: DisableModuleRequest) =>
    invoke<void>("php_disable_module", { id, request }),
  installModule: (id: string, request: InstallModuleRequest) =>
    invoke<void>("php_install_module", { id, request }),
  uninstallModule: (id: string, version: string, moduleName: string) =>
    invoke<void>("php_uninstall_module", { id, version, moduleName }),
  isModuleLoaded: (id: string, version: string, name: string) =>
    invoke<boolean>("php_is_module_loaded", { id, version, name }),
  listAvailableModules: (id: string, version: string) =>
    invoke<string[]>("php_list_available_modules", { id, version }),
  listPeclPackages: (id: string) =>
    invoke<PeclPackage[]>("php_list_pecl_packages", { id }),
  installPeclPackage: (id: string, name: string, version?: string) =>
    invoke<void>("php_install_pecl_package", { id, name, version }),
  uninstallPeclPackage: (id: string, name: string) =>
    invoke<void>("php_uninstall_pecl_package", { id, name }),

  // ── Composer (15) ───────────────────────────────────────────────────────────
  getComposerInfo: (id: string) =>
    invoke<ComposerInfo>("php_get_composer_info", { id }),
  isComposerInstalled: (id: string) =>
    invoke<boolean>("php_is_composer_installed", { id }),
  listComposerGlobalPackages: (id: string) =>
    invoke<ComposerGlobalPackage[]>("php_list_composer_global_packages", { id }),
  installComposerGlobalPackage: (
    id: string,
    packageName: string,
    version?: string,
  ) =>
    invoke<ComposerRunResult>("php_install_composer_global_package", {
      id,
      package: packageName,
      version,
    }),
  removeComposerGlobalPackage: (id: string, packageName: string) =>
    invoke<ComposerRunResult>("php_remove_composer_global_package", {
      id,
      package: packageName,
    }),
  getComposerProject: (id: string, projectPath: string) =>
    invoke<ComposerProject>("php_get_composer_project", { id, projectPath }),
  composerInstall: (id: string, request: ComposerInstallRequest) =>
    invoke<ComposerRunResult>("php_composer_install", { id, request }),
  composerUpdate: (id: string, request: ComposerUpdateRequest) =>
    invoke<ComposerRunResult>("php_composer_update", { id, request }),
  composerRequire: (id: string, request: RequirePackageRequest) =>
    invoke<ComposerRunResult>("php_composer_require", { id, request }),
  composerRemove: (id: string, request: RemovePackageRequest) =>
    invoke<ComposerRunResult>("php_composer_remove", { id, request }),
  composerDumpAutoload: (id: string, projectPath: string, optimize: boolean) =>
    invoke<ComposerRunResult>("php_composer_dump_autoload", {
      id,
      projectPath,
      optimize,
    }),
  composerValidate: (id: string, projectPath: string) =>
    invoke<ComposerRunResult>("php_composer_validate", { id, projectPath }),
  composerOutdated: (id: string, projectPath: string) =>
    invoke<ComposerPackage[]>("php_composer_outdated", { id, projectPath }),
  composerClearCache: (id: string) =>
    invoke<void>("php_composer_clear_cache", { id }),
  composerSelfUpdate: (id: string) =>
    invoke<ComposerRunResult>("php_composer_self_update", { id }),

  // ── Logs (9) ──────────────────────────────────────────────────────────────--
  readLog: (id: string, request: PhpLogReadRequest) =>
    invoke<PhpLogEntry[]>("php_read_log", { id, request }),
  getLogConfig: (id: string, version: string) =>
    invoke<PhpLogConfig>("php_get_log_config", { id, version }),
  getFpmLogConfig: (id: string, version: string) =>
    invoke<FpmLogConfig>("php_get_fpm_log_config", { id, version }),
  getLogPath: (id: string, version: string) =>
    invoke<string>("php_get_log_path", { id, version }),
  getFpmLogPath: (id: string, version: string) =>
    invoke<string>("php_get_fpm_log_path", { id, version }),
  clearLog: (id: string, logPath: string) =>
    invoke<void>("php_clear_log", { id, logPath }),
  tailLog: (id: string, logPath: string, lines: number) =>
    invoke<string>("php_tail_log", { id, logPath, lines }),
  getLogSize: (id: string, logPath: string) =>
    invoke<number>("php_get_log_size", { id, logPath }),
  rotateLog: (id: string, logPath: string) =>
    invoke<void>("php_rotate_log", { id, logPath }),
};

export type PhpConfigApi = typeof phpConfigApi;

// ─── React hook ─────────────────────────────────────────────────────────────--

/**
 * Loading/error lifecycle for the PHP "config" tab. `run` wraps any
 * `phpConfigApi` call, tracking `isLoading` and surfacing errors with the shared
 * idiom (Tauri rejects with a plain string via each command's `map_err`); it
 * resolves to the value, or `undefined` on failure.
 */
export function usePhpConfig() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(fn: (api: PhpConfigApi) => Promise<T>): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn(phpConfigApi);
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

  return { api: phpConfigApi, run, isLoading, error, clearError };
}

export type PhpConfigManager = ReturnType<typeof usePhpConfig>;
