//! Shared types for PHP server management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpConnectionConfig {
    /// SSH host
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    /// Path to default php binary (default: php)
    pub php_bin: Option<String>,
    /// Path to php-fpm binary (default: php-fpm)
    pub fpm_bin: Option<String>,
    /// Path to composer binary (default: composer)
    pub composer_bin: Option<String>,
    /// Base PHP config directory (default: /etc/php)
    pub config_dir: Option<String>,
    /// FPM pool.d directory override
    pub fpm_pool_dir: Option<String>,
    /// Connection timeout in seconds
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpConnectionSummary {
    pub host: String,
    pub default_version: Option<String>,
    pub installed_versions: Vec<String>,
    pub fpm_running: bool,
    pub config_dir: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSH output
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHP Versions
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpVersion {
    /// e.g. "8.3.12"
    pub version: String,
    /// Major version number
    pub major: u32,
    /// Minor version number
    pub minor: u32,
    /// Patch version number
    pub patch: u32,
    /// e.g. cli, fpm, apache2handler, cgi
    pub sapis: Vec<String>,
    /// Path to CLI binary
    pub binary_path: String,
    /// Path to php.ini
    pub config_file: Option<String>,
    /// Extension directory
    pub extension_dir: Option<String>,
    /// Whether this is the default system PHP
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpVersionDetail {
    pub version: String,
    pub compiler: Option<String>,
    pub zend_version: Option<String>,
    pub architecture: Option<String>,
    pub thread_safety: bool,
    pub debug_build: bool,
    pub opcache_enabled: bool,
    pub loaded_extensions: Vec<String>,
    pub ini_path: Option<String>,
    pub scan_dir: Option<String>,
    pub zend_extensions: Vec<String>,
    pub configure_options: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpSapi {
    pub name: String,
    pub version: String,
    pub binary_path: Option<String>,
    pub config_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetDefaultVersionRequest {
    pub version: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHP-FPM Pools
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FpmProcessManager {
    Static,
    Dynamic,
    Ondemand,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpFpmPool {
    pub name: String,
    pub version: String,
    pub user: Option<String>,
    pub group: Option<String>,
    /// Listen address: socket path or host:port
    pub listen: String,
    pub pm: FpmProcessManager,
    pub max_children: Option<u32>,
    pub start_servers: Option<u32>,
    pub min_spare_servers: Option<u32>,
    pub max_spare_servers: Option<u32>,
    pub max_requests: Option<u32>,
    pub process_idle_timeout: Option<u32>,
    pub status_path: Option<String>,
    pub ping_path: Option<String>,
    pub ping_response: Option<String>,
    pub slowlog: Option<String>,
    pub request_slowlog_timeout: Option<u32>,
    pub request_terminate_timeout: Option<u32>,
    pub config_file: String,
    pub enabled: bool,
    /// Additional php_admin_value directives
    pub php_admin_values: HashMap<String, String>,
    /// Additional php_value directives
    pub php_values: HashMap<String, String>,
    /// Additional environment variables
    pub env_vars: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpFpmPoolStatus {
    pub pool: String,
    pub process_manager: String,
    pub start_time: Option<String>,
    pub start_since: Option<u64>,
    pub accepted_conn: u64,
    pub listen_queue: u32,
    pub max_listen_queue: u32,
    pub listen_queue_len: u32,
    pub idle_processes: u32,
    pub active_processes: u32,
    pub total_processes: u32,
    pub max_active_processes: u32,
    pub max_children_reached: u32,
    pub slow_requests: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FpmWorkerProcess {
    pub pid: u32,
    pub state: String,
    pub start_time: Option<String>,
    pub start_since: Option<u64>,
    pub requests: u64,
    pub request_duration: Option<u64>,
    pub request_method: Option<String>,
    pub request_uri: Option<String>,
    pub content_length: Option<u64>,
    pub user: Option<String>,
    pub script: Option<String>,
    pub last_request_cpu: Option<f64>,
    pub last_request_memory: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFpmPoolRequest {
    pub name: String,
    pub version: String,
    pub user: Option<String>,
    pub group: Option<String>,
    pub listen: Option<String>,
    pub pm: Option<FpmProcessManager>,
    pub max_children: Option<u32>,
    pub start_servers: Option<u32>,
    pub min_spare_servers: Option<u32>,
    pub max_spare_servers: Option<u32>,
    pub max_requests: Option<u32>,
    pub process_idle_timeout: Option<u32>,
    pub status_path: Option<String>,
    pub ping_path: Option<String>,
    pub request_terminate_timeout: Option<u32>,
    pub request_slowlog_timeout: Option<u32>,
    pub php_admin_values: Option<HashMap<String, String>>,
    pub php_values: Option<HashMap<String, String>>,
    pub env_vars: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateFpmPoolRequest {
    pub user: Option<String>,
    pub group: Option<String>,
    pub listen: Option<String>,
    pub pm: Option<FpmProcessManager>,
    pub max_children: Option<u32>,
    pub start_servers: Option<u32>,
    pub min_spare_servers: Option<u32>,
    pub max_spare_servers: Option<u32>,
    pub max_requests: Option<u32>,
    pub process_idle_timeout: Option<u32>,
    pub status_path: Option<String>,
    pub ping_path: Option<String>,
    pub request_terminate_timeout: Option<u32>,
    pub request_slowlog_timeout: Option<u32>,
    pub php_admin_values: Option<HashMap<String, String>>,
    pub php_values: Option<HashMap<String, String>>,
    pub env_vars: Option<HashMap<String, String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// php.ini / Configuration
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpIniDirective {
    pub key: String,
    pub local_value: String,
    pub master_value: Option<String>,
    pub access: Option<String>,
    pub source_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpIniFile {
    pub path: String,
    pub sapi: String,
    pub version: String,
    pub directives: Vec<PhpIniDirective>,
    pub raw_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpIniScanDir {
    pub path: String,
    pub version: String,
    pub sapi: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetIniDirectiveRequest {
    pub version: String,
    pub sapi: String,
    pub key: String,
    pub value: String,
    /// Specific file to write to, or auto-detect
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IniBackup {
    pub path: String,
    pub backup_path: String,
    pub timestamp: String,
    pub version: String,
    pub sapi: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Modules / Extensions
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhpModuleType {
    /// Compiled into PHP
    Builtin,
    /// Loaded via .so / .ini
    Dynamic,
    /// Zend extension (e.g. opcache, xdebug)
    Zend,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpModule {
    pub name: String,
    pub version: Option<String>,
    pub module_type: PhpModuleType,
    pub enabled: bool,
    pub ini_file: Option<String>,
    pub description: Option<String>,
    pub php_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnableModuleRequest {
    pub version: String,
    pub module_name: String,
    pub sapi: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisableModuleRequest {
    pub version: String,
    pub module_name: String,
    pub sapi: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallModuleRequest {
    pub version: String,
    pub module_name: String,
    /// Install via pecl, apt, yum, etc.
    pub method: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeclPackage {
    pub name: String,
    pub version: Option<String>,
    pub state: Option<String>,
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPcache
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpcacheStatus {
    pub enabled: bool,
    pub full: bool,
    pub memory_usage: OpcacheMemory,
    pub statistics: OpcacheStatistics,
    pub interned_strings: Option<OpcacheInternedStrings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpcacheMemory {
    pub used_memory: u64,
    pub free_memory: u64,
    pub wasted_memory: u64,
    pub current_wasted_percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpcacheStatistics {
    pub num_cached_scripts: u32,
    pub num_cached_keys: u32,
    pub max_cached_keys: u32,
    pub hits: u64,
    pub misses: u64,
    pub hit_rate: f64,
    pub oom_restarts: u32,
    pub hash_restarts: u32,
    pub manual_restarts: u32,
    pub start_time: Option<String>,
    pub last_restart_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpcacheInternedStrings {
    pub buffer_size: u64,
    pub used_memory: u64,
    pub free_memory: u64,
    pub number_of_strings: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpcacheConfig {
    pub enable: Option<bool>,
    pub memory_consumption: Option<u32>,
    pub interned_strings_buffer: Option<u32>,
    pub max_accelerated_files: Option<u32>,
    pub validate_timestamps: Option<bool>,
    pub revalidate_freq: Option<u32>,
    pub save_comments: Option<bool>,
    pub enable_file_override: Option<bool>,
    pub max_file_size: Option<u64>,
    pub consistency_checks: Option<bool>,
    pub force_restart_timeout: Option<u32>,
    pub log_verbosity_level: Option<u32>,
    pub preferred_memory_model: Option<String>,
    pub jit: Option<String>,
    pub jit_buffer_size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedScript {
    pub full_path: String,
    pub hits: u64,
    pub memory_consumption: u64,
    pub last_used: Option<String>,
    pub last_used_timestamp: Option<u64>,
    pub timestamp: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sessions
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpSessionConfig {
    pub save_handler: String,
    pub save_path: String,
    pub name: String,
    pub gc_maxlifetime: u32,
    pub gc_probability: u32,
    pub gc_divisor: u32,
    pub cookie_lifetime: u32,
    pub cookie_path: String,
    pub cookie_domain: Option<String>,
    pub cookie_secure: bool,
    pub cookie_httponly: bool,
    pub cookie_samesite: Option<String>,
    pub use_strict_mode: bool,
    pub use_cookies: bool,
    pub use_only_cookies: bool,
    pub use_trans_sid: bool,
    pub sid_length: Option<u32>,
    pub sid_bits_per_character: Option<u32>,
    pub lazy_write: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStats {
    pub save_path: String,
    pub handler: String,
    pub active_sessions: u64,
    pub total_size_bytes: u64,
    pub oldest_session: Option<String>,
    pub newest_session: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSessionConfigRequest {
    pub version: String,
    pub save_handler: Option<String>,
    pub save_path: Option<String>,
    pub gc_maxlifetime: Option<u32>,
    pub gc_probability: Option<u32>,
    pub gc_divisor: Option<u32>,
    pub cookie_lifetime: Option<u32>,
    pub cookie_secure: Option<bool>,
    pub cookie_httponly: Option<bool>,
    pub cookie_samesite: Option<String>,
    pub use_strict_mode: Option<bool>,
    pub sid_length: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Composer
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposerInfo {
    pub version: String,
    pub home_dir: Option<String>,
    pub cache_dir: Option<String>,
    pub global_dir: Option<String>,
    pub php_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposerPackage {
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub package_type: Option<String>,
    pub homepage: Option<String>,
    pub license: Option<Vec<String>>,
    pub authors: Option<Vec<ComposerAuthor>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposerAuthor {
    pub name: Option<String>,
    pub email: Option<String>,
    pub homepage: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposerProject {
    pub name: Option<String>,
    pub description: Option<String>,
    pub packages: Vec<ComposerPackage>,
    pub dev_packages: Vec<ComposerPackage>,
    pub php_requirement: Option<String>,
    pub stability: Option<String>,
    pub lock_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposerGlobalPackage {
    pub name: String,
    pub version: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequirePackageRequest {
    pub project_path: String,
    pub package: String,
    pub version: Option<String>,
    pub dev: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemovePackageRequest {
    pub project_path: String,
    pub package: String,
    pub dev: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposerRunResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposerInstallRequest {
    pub project_path: String,
    pub no_dev: bool,
    pub optimize_autoloader: bool,
    pub no_scripts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposerUpdateRequest {
    pub project_path: String,
    pub packages: Option<Vec<String>>,
    pub no_dev: bool,
    pub with_dependencies: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhpLogLevel {
    Emergency,
    Alert,
    Critical,
    Error,
    Warning,
    Notice,
    Info,
    Debug,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpLogEntry {
    pub timestamp: Option<String>,
    pub level: PhpLogLevel,
    pub message: String,
    pub file: Option<String>,
    pub line_number: Option<u32>,
    pub stack_trace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpLogConfig {
    pub error_log: Option<String>,
    pub log_errors: bool,
    pub display_errors: bool,
    pub error_reporting: String,
    pub log_errors_max_len: Option<u32>,
    pub syslog_facility: Option<String>,
    pub syslog_ident: Option<String>,
    pub syslog_filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FpmLogConfig {
    pub error_log: Option<String>,
    pub log_level: Option<String>,
    pub syslog_facility: Option<String>,
    pub syslog_ident: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpLogReadRequest {
    pub log_path: Option<String>,
    pub lines: Option<u32>,
    pub level_filter: Option<PhpLogLevel>,
    pub search: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Process / Service Management
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpFpmServiceStatus {
    pub version: String,
    pub service_name: String,
    pub active: bool,
    pub running: bool,
    pub enabled: bool,
    pub pid: Option<u32>,
    pub main_pid: Option<u32>,
    pub memory_bytes: Option<u64>,
    pub cpu_percent: Option<f64>,
    pub uptime_secs: Option<u64>,
    pub tasks: Option<u32>,
    pub active_state: Option<String>,
    pub sub_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpFpmMasterProcess {
    pub pid: u32,
    pub version: String,
    pub config_file: String,
    pub uptime_secs: Option<u64>,
    pub memory_rss: Option<u64>,
    pub worker_count: u32,
    pub pool_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigTestResult {
    pub success: bool,
    pub output: String,
    pub errors: Vec<String>,
}
