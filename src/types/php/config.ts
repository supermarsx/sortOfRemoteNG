// PHP-FPM integration — "config" category domain types (t42-php-c2).
//
// Mirror of the php.ini / modules-extensions-PECL / Composer / logs structs in
// `src-tauri/crates/sorng-php/src/types.rs`. This crate is snake_case: none of
// these request/response structs carry `#[serde(rename_all)]`, so serde
// serialises their fields with the raw Rust snake_case names. Every `request`
// object passed to `invoke` MUST therefore use snake_case keys verbatim
// (`file_path`, `module_name`, `project_path`, `no_dev`, `optimize_autoloader`,
// `with_dependencies`, `log_path`, `level_filter`, …). Only the top-level command
// ARGUMENT names follow Tauri's camelCase conversion (see `usePhpConfig`).
//
// The three enums (`PhpModuleType`, `PhpLogLevel`, and the runtime-owned
// `FpmProcessManager`) ARE `#[serde(rename_all = "snake_case")]`, so their wire
// values are the snake_case variant strings modelled below as string unions.
//
// Shared connection types live in `./index`; runtime domain types (versions /
// FPM pools / opcache / sessions) live in `./runtime` (category c1). This file is
// re-exported from `./index` by the per-crate integrator.

// ═══════════════════════════════════════════════════════════════════════════════
// php.ini / Configuration
// ═══════════════════════════════════════════════════════════════════════════════

/** A single resolved php.ini directive (`php_get_ini_directive` /
 *  `php_list_ini_directives`). */
export interface PhpIniDirective {
  key: string;
  local_value: string;
  master_value?: string;
  access?: string;
  source_file?: string;
}

/** A parsed php.ini file for one version+SAPI (`php_get_ini_file`). */
export interface PhpIniFile {
  path: string;
  sapi: string;
  version: string;
  directives: PhpIniDirective[];
  raw_content: string;
}

/** The additional-.ini scan directory + its files (`php_get_ini_scan_dir`). */
export interface PhpIniScanDir {
  path: string;
  version: string;
  sapi: string;
  files: string[];
}

/** Body of `php_set_ini_directive` (passed as the `request` arg). snake_case
 *  fields — `file_path` targets a specific .ini, else the backend auto-detects. */
export interface SetIniDirectiveRequest {
  version: string;
  sapi: string;
  key: string;
  value: string;
  file_path?: string;
}

/** Result of `php_backup_ini` — where the copy landed. */
export interface IniBackup {
  path: string;
  backup_path: string;
  timestamp: string;
  version: string;
  sapi: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Modules / Extensions / PECL
// ═══════════════════════════════════════════════════════════════════════════════

/** `PhpModuleType` — snake_case enum: builtin (compiled in), dynamic (.so/.ini),
 *  zend (Zend extension, e.g. opcache/xdebug). */
export type PhpModuleType = "builtin" | "dynamic" | "zend";

/** A PHP extension/module (`php_list_modules` / `php_get_module`). */
export interface PhpModule {
  name: string;
  version?: string;
  module_type: PhpModuleType;
  enabled: boolean;
  ini_file?: string;
  description?: string;
  php_version: string;
}

/** Body of `php_enable_module` (passed as the `request` arg). */
export interface EnableModuleRequest {
  version: string;
  module_name: string;
  sapi?: string;
}

/** Body of `php_disable_module` (passed as the `request` arg). */
export interface DisableModuleRequest {
  version: string;
  module_name: string;
  sapi?: string;
}

/** Body of `php_install_module` (passed as the `request` arg). `method` selects
 *  the installer (pecl / apt / yum / …); auto-detected when omitted. */
export interface InstallModuleRequest {
  version: string;
  module_name: string;
  method?: string;
}

/** A PECL package row (`php_list_pecl_packages`). */
export interface PeclPackage {
  name: string;
  version?: string;
  state?: string;
  description?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Composer
// ═══════════════════════════════════════════════════════════════════════════════

/** Composer runtime info (`php_get_composer_info`). */
export interface ComposerInfo {
  version: string;
  home_dir?: string;
  cache_dir?: string;
  global_dir?: string;
  php_version?: string;
}

/** A composer.json/lock package author. */
export interface ComposerAuthor {
  name?: string;
  email?: string;
  homepage?: string;
  role?: string;
}

/** A Composer package (project require, or `php_composer_outdated` row). */
export interface ComposerPackage {
  name: string;
  version: string;
  description?: string;
  package_type?: string;
  homepage?: string;
  license?: string[];
  authors?: ComposerAuthor[];
}

/** A parsed Composer project (`php_get_composer_project`). */
export interface ComposerProject {
  name?: string;
  description?: string;
  packages: ComposerPackage[];
  dev_packages: ComposerPackage[];
  php_requirement?: string;
  stability?: string;
  lock_hash?: string;
}

/** A globally-installed Composer package (`php_list_composer_global_packages`). */
export interface ComposerGlobalPackage {
  name: string;
  version: string;
  description?: string;
}

/** Raw result of any mutating Composer command (install/update/require/…). */
export interface ComposerRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
}

/** Body of `php_composer_require` (passed as the `request` arg). */
export interface RequirePackageRequest {
  project_path: string;
  package: string;
  version?: string;
  dev: boolean;
}

/** Body of `php_composer_remove` (passed as the `request` arg). */
export interface RemovePackageRequest {
  project_path: string;
  package: string;
  dev: boolean;
}

/** Body of `php_composer_install` (passed as the `request` arg). */
export interface ComposerInstallRequest {
  project_path: string;
  no_dev: boolean;
  optimize_autoloader: boolean;
  no_scripts: boolean;
}

/** Body of `php_composer_update` (passed as the `request` arg). `packages` limits
 *  the update to named packages; empty/omitted updates everything. */
export interface ComposerUpdateRequest {
  project_path: string;
  packages?: string[];
  no_dev: boolean;
  with_dependencies: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

/** `PhpLogLevel` — snake_case enum spanning syslog severities plus `unknown`. */
export type PhpLogLevel =
  | "emergency"
  | "alert"
  | "critical"
  | "error"
  | "warning"
  | "notice"
  | "info"
  | "debug"
  | "unknown";

/** A parsed PHP error-log entry (`php_read_log`). */
export interface PhpLogEntry {
  timestamp?: string;
  level: PhpLogLevel;
  message: string;
  file?: string;
  line_number?: number;
  stack_trace?: string;
}

/** PHP error-logging configuration (`php_get_log_config`). */
export interface PhpLogConfig {
  error_log?: string;
  log_errors: boolean;
  display_errors: boolean;
  error_reporting: string;
  log_errors_max_len?: number;
  syslog_facility?: string;
  syslog_ident?: string;
  syslog_filter?: string;
}

/** PHP-FPM logging configuration (`php_get_fpm_log_config`). */
export interface FpmLogConfig {
  error_log?: string;
  log_level?: string;
  syslog_facility?: string;
  syslog_ident?: string;
}

/** Body of `php_read_log` (passed as the `request` arg). All fields optional:
 *  `log_path` auto-detects, `lines` caps the tail, `level_filter`/`search` filter. */
export interface PhpLogReadRequest {
  log_path?: string;
  lines?: number;
  level_filter?: PhpLogLevel;
  search?: string;
}
