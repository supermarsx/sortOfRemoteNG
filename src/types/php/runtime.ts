// PHP-FPM integration — "runtime" category types (t42-php-c1): the live runtime
// & FPM daemon surface (installed versions, FPM pools, FPM process/service
// lifecycle, OPcache runtime, session runtime).
//
// Mirror of the matching structs in `src-tauri/crates/sorng-php/src/types.rs`.
//
// IMPORTANT — this crate is snake_case for STRUCT FIELDS. None of these structs
// carry `#[serde(rename_all)]`, so serde serialises their fields with the raw
// Rust snake_case names; the request/config objects passed to `invoke` MUST use
// snake_case keys (`max_children`, `start_servers`, `save_handler`,
// `memory_consumption`, …). The three enums below ARE snake_case-renamed, so
// their wire values are lower-case. Only the top-level command ARGUMENT names
// (id/version/name/config/request/…) follow Tauri's camelCase conversion — see
// `../../hooks/integration/php/usePhpRuntime.ts` and
// `.orchestration/logs/t42-php-categories.md`.

// ═══════════════════════════════════════════════════════════════════════════════
// Versions
// ═══════════════════════════════════════════════════════════════════════════════

/** One installed PHP version (`php_list_versions` / `php_get_default_version`). */
export interface PhpVersion {
  /** e.g. `"8.3.12"`. */
  version: string;
  major: number;
  minor: number;
  patch: number;
  /** SAPIs present for this version, e.g. `cli`, `fpm`, `apache2handler`. */
  sapis: string[];
  binary_path: string;
  config_file?: string;
  extension_dir?: string;
  /** Whether this is the default system PHP. */
  is_default: boolean;
}

/** Deep version detail (`php_get_version_detail`). */
export interface PhpVersionDetail {
  version: string;
  compiler?: string;
  zend_version?: string;
  architecture?: string;
  thread_safety: boolean;
  debug_build: boolean;
  opcache_enabled: boolean;
  loaded_extensions: string[];
  ini_path?: string;
  scan_dir?: string;
  zend_extensions: string[];
  configure_options: string[];
}

/** One SAPI of a version (`php_list_sapis`). */
export interface PhpSapi {
  name: string;
  version: string;
  binary_path?: string;
  config_file?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FPM Pools
// ═══════════════════════════════════════════════════════════════════════════════

/** FPM process-manager mode. serde snake_case → these exact wire values. */
export type FpmProcessManager = "static" | "dynamic" | "ondemand";

/** A configured PHP-FPM pool (`php_list_fpm_pools` / `php_get_fpm_pool`). */
export interface PhpFpmPool {
  name: string;
  version: string;
  user?: string;
  group?: string;
  /** Listen address: socket path or `host:port`. */
  listen: string;
  pm: FpmProcessManager;
  max_children?: number;
  start_servers?: number;
  min_spare_servers?: number;
  max_spare_servers?: number;
  max_requests?: number;
  process_idle_timeout?: number;
  status_path?: string;
  ping_path?: string;
  ping_response?: string;
  slowlog?: string;
  request_slowlog_timeout?: number;
  request_terminate_timeout?: number;
  config_file: string;
  enabled: boolean;
  php_admin_values: Record<string, string>;
  php_values: Record<string, string>;
  env_vars: Record<string, string>;
}

/** Live status of a pool from its status page (`php_get_fpm_pool_status`). */
export interface PhpFpmPoolStatus {
  pool: string;
  process_manager: string;
  start_time?: string;
  start_since?: number;
  accepted_conn: number;
  listen_queue: number;
  max_listen_queue: number;
  listen_queue_len: number;
  idle_processes: number;
  active_processes: number;
  total_processes: number;
  max_active_processes: number;
  max_children_reached: number;
  slow_requests: number;
}

/** One worker process of a pool (`php_list_fpm_pool_processes`). */
export interface FpmWorkerProcess {
  pid: number;
  state: string;
  start_time?: string;
  start_since?: number;
  requests: number;
  request_duration?: number;
  request_method?: string;
  request_uri?: string;
  content_length?: number;
  user?: string;
  script?: string;
  last_request_cpu?: number;
  last_request_memory?: number;
}

/** Body of `php_create_fpm_pool` (snake_case fields; carries its own version). */
export interface CreateFpmPoolRequest {
  name: string;
  version: string;
  user?: string;
  group?: string;
  listen?: string;
  pm?: FpmProcessManager;
  max_children?: number;
  start_servers?: number;
  min_spare_servers?: number;
  max_spare_servers?: number;
  max_requests?: number;
  process_idle_timeout?: number;
  status_path?: string;
  ping_path?: string;
  request_terminate_timeout?: number;
  request_slowlog_timeout?: number;
  php_admin_values?: Record<string, string>;
  php_values?: Record<string, string>;
  env_vars?: Record<string, string>;
}

/** Body of `php_update_fpm_pool` (target pool given by the `version` + `name`
 *  args; all fields optional patches). */
export interface UpdateFpmPoolRequest {
  user?: string;
  group?: string;
  listen?: string;
  pm?: FpmProcessManager;
  max_children?: number;
  start_servers?: number;
  min_spare_servers?: number;
  max_spare_servers?: number;
  max_requests?: number;
  process_idle_timeout?: number;
  status_path?: string;
  ping_path?: string;
  request_terminate_timeout?: number;
  request_slowlog_timeout?: number;
  php_admin_values?: Record<string, string>;
  php_values?: Record<string, string>;
  env_vars?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FPM Process / Service
// ═══════════════════════════════════════════════════════════════════════════════

/** systemd/service view of an FPM daemon (`php_get_fpm_service_status`,
 *  `php_list_all_fpm_services`). */
export interface PhpFpmServiceStatus {
  version: string;
  service_name: string;
  active: boolean;
  running: boolean;
  enabled: boolean;
  pid?: number;
  main_pid?: number;
  memory_bytes?: number;
  cpu_percent?: number;
  uptime_secs?: number;
  tasks?: number;
  active_state?: string;
  sub_state?: string;
}

/** The FPM master process (`php_get_fpm_master_process`). */
export interface PhpFpmMasterProcess {
  pid: number;
  version: string;
  config_file: string;
  uptime_secs?: number;
  memory_rss?: number;
  worker_count: number;
  pool_count: number;
}

/** Result of `php_test_fpm_config` (`php-fpm -t`). */
export interface ConfigTestResult {
  success: boolean;
  output: string;
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPcache
// ═══════════════════════════════════════════════════════════════════════════════

/** Live OPcache status (`php_get_opcache_status`). */
export interface OpcacheStatus {
  enabled: boolean;
  full: boolean;
  memory_usage: OpcacheMemory;
  statistics: OpcacheStatistics;
  interned_strings?: OpcacheInternedStrings;
}

export interface OpcacheMemory {
  used_memory: number;
  free_memory: number;
  wasted_memory: number;
  current_wasted_percentage: number;
}

export interface OpcacheStatistics {
  num_cached_scripts: number;
  num_cached_keys: number;
  max_cached_keys: number;
  hits: number;
  misses: number;
  hit_rate: number;
  oom_restarts: number;
  hash_restarts: number;
  manual_restarts: number;
  start_time?: string;
  last_restart_time?: string;
}

export interface OpcacheInternedStrings {
  buffer_size: number;
  used_memory: number;
  free_memory: number;
  number_of_strings: number;
}

/** OPcache directive set — read via `php_get_opcache_config`, written via
 *  `php_update_opcache_config` (snake_case fields; all optional patches). */
export interface OpcacheConfig {
  enable?: boolean;
  memory_consumption?: number;
  interned_strings_buffer?: number;
  max_accelerated_files?: number;
  validate_timestamps?: boolean;
  revalidate_freq?: number;
  save_comments?: boolean;
  enable_file_override?: boolean;
  max_file_size?: number;
  consistency_checks?: boolean;
  force_restart_timeout?: number;
  log_verbosity_level?: number;
  preferred_memory_model?: string;
  jit?: string;
  jit_buffer_size?: string;
}

/** One entry of the OPcache script cache (`php_list_cached_scripts`). */
export interface CachedScript {
  full_path: string;
  hits: number;
  memory_consumption: number;
  last_used?: string;
  last_used_timestamp?: number;
  timestamp?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sessions
// ═══════════════════════════════════════════════════════════════════════════════

/** Effective session runtime config (`php_get_session_config`). */
export interface PhpSessionConfig {
  save_handler: string;
  save_path: string;
  name: string;
  gc_maxlifetime: number;
  gc_probability: number;
  gc_divisor: number;
  cookie_lifetime: number;
  cookie_path: string;
  cookie_domain?: string;
  cookie_secure: boolean;
  cookie_httponly: boolean;
  cookie_samesite?: string;
  use_strict_mode: boolean;
  use_cookies: boolean;
  use_only_cookies: boolean;
  use_trans_sid: boolean;
  sid_length?: number;
  sid_bits_per_character?: number;
  lazy_write: boolean;
}

/** Session store statistics (`php_get_session_stats`). */
export interface SessionStats {
  save_path: string;
  handler: string;
  active_sessions: number;
  total_size_bytes: number;
  oldest_session?: string;
  newest_session?: string;
}

/** Body of `php_update_session_config` (target version in `version`; all other
 *  fields optional patches). */
export interface UpdateSessionConfigRequest {
  version: string;
  save_handler?: string;
  save_path?: string;
  gc_maxlifetime?: number;
  gc_probability?: number;
  gc_divisor?: number;
  cookie_lifetime?: number;
  cookie_secure?: boolean;
  cookie_httponly?: boolean;
  cookie_samesite?: string;
  use_strict_mode?: boolean;
  sid_length?: number;
}
