// PHP-FPM integration — shared/config types + barrel (t42 §4b, crate lead
// t42-php-L).
//
// Mirror of the connection types in `src-tauri/crates/sorng-php/src/types.rs`.
//
// IMPORTANT — this crate is snake_case. `PhpConnectionConfig` and
// `PhpConnectionSummary` carry NO `#[serde(rename_all)]`, so serde serialises
// their fields with the raw Rust snake_case names. The object passed to
// `php_connect` MUST use these snake_case keys verbatim (`ssh_user`,
// `ssh_password`, `ssh_key`, `php_bin`, `fpm_bin`, `composer_bin`, `config_dir`,
// `fpm_pool_dir`, `timeout_secs`). Only the top-level command ARGUMENT names
// (id/config) follow Tauri's camelCase conversion — struct fields do not. The
// same holds for every request struct in the per-category files; see
// `.orchestration/logs/t42-php-categories.md`.
//
// Domain types (versions/fpm-pools/process/opcache/sessions and ini/modules/
// composer/logs) live in the per-category files `./runtime.ts` and `./config.ts`,
// each owned by one category executor. Their re-exports are appended to the marked
// region at the end of this file by the per-crate integrator — keep this file's
// own declarations above that region.

/** `PhpConnectionConfig` — the connect form's payload. SSH connection to the PHP
 *  server. snake_case field names mirror the Rust struct exactly (no serde
 *  rename). Only `host` is required; the binary/path fields override the
 *  server-side defaults (`php`, `php-fpm`, `composer`, `/etc/php`). */
export interface PhpConnectionConfig {
  /** SSH host. */
  host: string;
  /** SSH port (default 22 server-side). */
  port?: number;
  ssh_user?: string;
  /** Secret — never persisted to the config blob; stored in the OS vault. */
  ssh_password?: string;
  /** Secret (private key material) — same vault handling as `ssh_password`. */
  ssh_key?: string;
  /** Path to default php binary (default: `php`). */
  php_bin?: string;
  /** Path to php-fpm binary (default: `php-fpm`). */
  fpm_bin?: string;
  /** Path to composer binary (default: `composer`). */
  composer_bin?: string;
  /** Base PHP config directory (default: `/etc/php`). */
  config_dir?: string;
  /** FPM pool.d directory override. */
  fpm_pool_dir?: string;
  /** Connection timeout in seconds. */
  timeout_secs?: number;
}

/** Result of `php_connect` — the server's PHP runtime summary. */
export interface PhpConnectionSummary {
  host: string;
  default_version?: string;
  installed_versions: string[];
  fpm_running: boolean;
  config_dir: string;
}

// ── category type re-exports (appended by the per-crate integrator) ──────────
// export * from "./runtime";
// export * from "./config";
