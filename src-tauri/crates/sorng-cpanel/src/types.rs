//! Shared types for cPanel/WHM management.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

/// Authentication mode for cPanel / WHM API access.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CpanelAuthMode {
    /// Username + password (session-token based).
    Password,
    /// WHM API token (root or reseller).
    ApiToken,
    /// cPanel user-level API token.
    UserApiToken,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpanelConnectionConfig {
    /// Hostname or IP of the cPanel/WHM server.
    pub host: String,
    /// WHM port (default 2087 for HTTPS).
    pub whm_port: Option<u16>,
    /// cPanel port (default 2083 for HTTPS).
    pub cpanel_port: Option<u16>,
    /// Use HTTPS (default true).
    pub use_tls: Option<bool>,
    /// Accept self-signed certificates.
    pub accept_invalid_certs: Option<bool>,
    /// Authentication mode.
    pub auth_mode: CpanelAuthMode,
    /// WHM / cPanel username.
    pub username: String,
    /// Password (when auth_mode = Password).
    pub password: Option<String>,
    /// API token (when auth_mode = ApiToken or UserApiToken).
    pub api_token: Option<String>,
    /// Connection timeout in seconds (default 30).
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpanelConnectionSummary {
    pub host: String,
    pub hostname: Option<String>,
    pub version: Option<String>,
    pub theme: Option<String>,
    pub server_type: Option<String>,
    pub license_id: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Server Info
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpanelServerInfo {
    pub hostname: String,
    pub version: String,
    pub build: Option<String>,
    pub theme: Option<String>,
    pub os: Option<String>,
    pub os_version: Option<String>,
    pub kernel: Option<String>,
    pub arch: Option<String>,
    pub apache_version: Option<String>,
    pub php_version: Option<String>,
    pub mysql_version: Option<String>,
    pub perl_version: Option<String>,
    pub license_id: Option<String>,
    pub license_package: Option<String>,
    pub max_accounts: Option<u32>,
    pub current_accounts: Option<u32>,
    pub uptime: Option<String>,
    pub load_average: Option<[f64; 3]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerLoadStatus {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
    pub cpu_count: Option<u32>,
    pub running_procs: Option<u32>,
    pub total_procs: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Accounts
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpanelAccount {
    pub user: String,
    pub domain: String,
    pub owner: Option<String>,
    pub email: Option<String>,
    pub package: Option<String>,
    pub theme: Option<String>,
    pub shell: Option<String>,
    pub ip: Option<String>,
    pub startdate: Option<String>,
    pub diskused: Option<String>,
    pub disklimit: Option<String>,
    pub plan: Option<String>,
    pub max_emails: Option<String>,
    pub max_sql: Option<String>,
    pub max_ftp: Option<String>,
    pub max_sub: Option<String>,
    pub max_parked: Option<String>,
    pub max_addons: Option<String>,
    pub max_pop: Option<String>,
    pub max_lst: Option<String>,
    pub suspended: Option<bool>,
    pub suspend_reason: Option<String>,
    pub suspend_time: Option<String>,
    pub partition: Option<String>,
    pub uid: Option<u32>,
    pub backup: Option<bool>,
    pub temporary: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAccountRequest {
    pub username: String,
    pub domain: String,
    pub password: String,
    pub plan: Option<String>,
    pub contactemail: Option<String>,
    pub quota: Option<u64>,
    pub bwlimit: Option<u64>,
    pub maxftp: Option<String>,
    pub maxsql: Option<String>,
    pub maxpop: Option<String>,
    pub maxlst: Option<String>,
    pub maxsub: Option<String>,
    pub maxpark: Option<String>,
    pub maxaddon: Option<String>,
    pub hasshell: Option<bool>,
    pub cgi: Option<bool>,
    pub ip: Option<String>,
    pub language: Option<String>,
    pub reseller: Option<bool>,
    pub useregns: Option<bool>,
    pub force: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModifyAccountRequest {
    pub user: String,
    pub domain: Option<String>,
    pub newuser: Option<String>,
    pub quota: Option<u64>,
    pub bwlimit: Option<u64>,
    pub plan: Option<String>,
    pub maxftp: Option<String>,
    pub maxsql: Option<String>,
    pub maxpop: Option<String>,
    pub maxlst: Option<String>,
    pub maxsub: Option<String>,
    pub maxpark: Option<String>,
    pub maxaddon: Option<String>,
    pub shell: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSummary {
    pub user: String,
    pub domain: String,
    pub suspended: bool,
    pub disk_used_mb: f64,
    pub disk_limit_mb: Option<f64>,
    pub bandwidth_used_mb: f64,
    pub bandwidth_limit_mb: Option<f64>,
    pub email_accounts: u32,
    pub databases: u32,
    pub addon_domains: u32,
    pub subdomains: u32,
    pub parked_domains: u32,
    pub ftp_accounts: u32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hosting Packages (Plans)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostingPackage {
    pub name: String,
    pub quota: Option<u64>,
    pub bandwidth: Option<u64>,
    pub max_ftp: Option<String>,
    pub max_sql: Option<String>,
    pub max_pop: Option<String>,
    pub max_lst: Option<String>,
    pub max_sub: Option<String>,
    pub max_park: Option<String>,
    pub max_addon: Option<String>,
    pub max_email_per_hour: Option<String>,
    pub has_cgi: Option<bool>,
    pub has_shell: Option<bool>,
    pub digest: Option<String>,
    pub ip: Option<String>,
    pub language: Option<String>,
    pub max_defer_fail_pct: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Domains
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DomainType {
    Main,
    Addon,
    Parked,
    Sub,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainInfo {
    pub domain: String,
    pub domain_type: DomainType,
    pub documentroot: Option<String>,
    pub user: Option<String>,
    pub ip: Option<String>,
    pub port: Option<u16>,
    pub ssl_port: Option<u16>,
    pub php_version: Option<String>,
    pub server_name: Option<String>,
    pub server_alias: Option<String>,
    pub redirect_url: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAddonDomainRequest {
    pub domain: String,
    pub subdomain: String,
    pub document_root: String,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSubdomainRequest {
    pub subdomain: String,
    pub root_domain: String,
    pub document_root: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParkDomainRequest {
    pub domain: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainRedirect {
    pub domain: String,
    pub redirect_url: String,
    pub redirect_type: Option<String>,
    pub redirect_wildcard: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Email
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailAccount {
    pub email: String,
    pub login: String,
    pub domain: String,
    pub diskused: Option<u64>,
    pub diskquota: Option<u64>,
    pub diskusedpercent: Option<f64>,
    pub humandiskused: Option<String>,
    pub humandiskquota: Option<String>,
    pub suspended_incoming: Option<bool>,
    pub suspended_login: Option<bool>,
    pub hold_outgoing: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEmailRequest {
    pub email: String,
    pub password: String,
    pub quota: Option<u64>,
    pub send_welcome: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailForwarder {
    pub dest: String,
    pub forward: String,
    pub uri: Option<String>,
    pub html: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailAutoresponder {
    pub email: String,
    pub domain: String,
    pub from: Option<String>,
    pub subject: Option<String>,
    pub body: String,
    pub start: Option<u64>,
    pub stop: Option<u64>,
    pub interval: Option<u32>,
    pub is_html: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailFilter {
    pub filtername: String,
    pub account: String,
    pub enabled: Option<bool>,
    pub rules: Vec<EmailFilterRule>,
    pub actions: Vec<EmailFilterAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailFilterRule {
    pub part: String,
    pub r#match: String,
    pub val: String,
    pub opt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailFilterAction {
    pub action: String,
    pub dest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailingList {
    pub list: String,
    pub accesstype: Option<String>,
    pub humandiskused: Option<String>,
    pub diskused: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamFilterSettings {
    pub enabled: bool,
    pub score: Option<f64>,
    pub auto_delete: Option<bool>,
    pub auto_delete_score: Option<f64>,
    pub rewrite_subject: Option<bool>,
    pub subject_tag: Option<String>,
    pub whitelist_from: Vec<String>,
    pub blacklist_from: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MxRecord {
    pub domain: String,
    pub exchanger: String,
    pub priority: u16,
    pub record_type: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Databases
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseEngine {
    Mysql,
    Postgresql,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpanelDatabase {
    pub db: String,
    pub engine: DatabaseEngine,
    pub users: Vec<String>,
    pub size: Option<u64>,
    pub disk_usage: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseUser {
    pub user: String,
    pub engine: DatabaseEngine,
    pub databases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabasePrivileges {
    pub user: String,
    pub db: String,
    pub privileges: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDatabaseRequest {
    pub name: String,
    pub engine: DatabaseEngine,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDatabaseUserRequest {
    pub name: String,
    pub password: String,
    pub engine: DatabaseEngine,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrantPrivilegesRequest {
    pub user: String,
    pub db: String,
    pub privileges: Vec<String>,
    pub engine: DatabaseEngine,
}

// ═══════════════════════════════════════════════════════════════════════════════
// DNS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsZone {
    pub domain: String,
    pub records: Vec<DnsRecord>,
    pub serial: Option<String>,
    pub ttl: Option<u32>,
    pub refresh: Option<u32>,
    pub retry: Option<u32>,
    pub expire: Option<u32>,
    pub minimum: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsRecord {
    pub line: Option<u32>,
    pub name: String,
    pub record_type: String,
    pub address: Option<String>,
    pub cname: Option<String>,
    pub exchange: Option<String>,
    pub preference: Option<u16>,
    pub txtdata: Option<String>,
    pub priority: Option<u16>,
    pub weight: Option<u16>,
    pub port: Option<u16>,
    pub target: Option<String>,
    pub ttl: Option<u32>,
    pub class: Option<String>,
    pub raw: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddDnsRecordRequest {
    pub domain: String,
    pub name: String,
    pub record_type: String,
    pub address: Option<String>,
    pub cname: Option<String>,
    pub exchange: Option<String>,
    pub preference: Option<u16>,
    pub txtdata: Option<String>,
    pub priority: Option<u16>,
    pub weight: Option<u16>,
    pub port: Option<u16>,
    pub target: Option<String>,
    pub ttl: Option<u32>,
    pub class: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditDnsRecordRequest {
    pub domain: String,
    pub line: u32,
    pub name: Option<String>,
    pub record_type: Option<String>,
    pub address: Option<String>,
    pub cname: Option<String>,
    pub exchange: Option<String>,
    pub preference: Option<u16>,
    pub txtdata: Option<String>,
    pub priority: Option<u16>,
    pub weight: Option<u16>,
    pub port: Option<u16>,
    pub target: Option<String>,
    pub ttl: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Files
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileItem {
    pub path: String,
    pub name: String,
    pub file_type: String,
    pub size: Option<u64>,
    pub humansize: Option<String>,
    pub permissions: Option<String>,
    pub owner: Option<String>,
    pub group: Option<String>,
    pub mtime: Option<u64>,
    pub ctime: Option<u64>,
    pub mimetype: Option<String>,
    pub is_symlink: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskUsageInfo {
    pub user: String,
    pub home_used: Option<u64>,
    pub home_limit: Option<u64>,
    pub mail_used: Option<u64>,
    pub mysql_used: Option<u64>,
    pub pgsql_used: Option<u64>,
    pub total_used: Option<u64>,
    pub total_limit: Option<u64>,
    pub percentage: Option<f64>,
    pub inodes_used: Option<u64>,
    pub inodes_limit: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSL / TLS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SslCertificate {
    pub id: Option<String>,
    pub domain: String,
    pub issuer: Option<String>,
    pub subject: Option<String>,
    pub not_before: Option<String>,
    pub not_after: Option<String>,
    pub is_self_signed: Option<bool>,
    pub key_size: Option<u32>,
    pub signature_algorithm: Option<String>,
    pub domains: Vec<String>,
    pub installed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SslStatus {
    pub domain: String,
    pub ssl_enabled: bool,
    pub certificate: Option<SslCertificate>,
    pub autossl_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallSslRequest {
    pub domain: String,
    pub cert: String,
    pub key: String,
    pub cabundle: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateCsrRequest {
    pub domain: String,
    pub country: Option<String>,
    pub state: Option<String>,
    pub city: Option<String>,
    pub company: Option<String>,
    pub company_division: Option<String>,
    pub email: Option<String>,
    pub key_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsrResult {
    pub csr: String,
    pub key: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Backups
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupType {
    Full,
    Incremental,
    HomeDir,
    Mysql,
    Email,
    Filters,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub backup_id: Option<String>,
    pub backup_type: BackupType,
    pub size: Option<u64>,
    pub path: Option<String>,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub completed_at: Option<String>,
    pub user: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    pub enabled: bool,
    pub backup_type: BackupType,
    pub schedule: Option<String>,
    pub retain_daily: Option<u32>,
    pub retain_weekly: Option<u32>,
    pub retain_monthly: Option<u32>,
    pub compress: Option<bool>,
    pub backup_accounts: Option<bool>,
    pub backup_system: Option<bool>,
    pub destination: Option<BackupDestination>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupDestinationType {
    Local,
    Ftp,
    Scp,
    Rsync,
    S3,
    GoogleDrive,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupDestination {
    pub dest_type: BackupDestinationType,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub path: Option<String>,
    pub bucket: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreRequest {
    pub user: String,
    pub backup_type: BackupType,
    pub path: Option<String>,
    pub backup_id: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// FTP
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FtpAccount {
    pub user: String,
    pub login: String,
    pub dir: String,
    pub homedir: Option<String>,
    pub quota: Option<u64>,
    pub diskused: Option<u64>,
    pub type_: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFtpRequest {
    pub user: String,
    pub password: String,
    pub quota: Option<u64>,
    pub homedir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FtpSession {
    pub user: String,
    pub logged_in_from: Option<String>,
    pub status: Option<String>,
    pub process_id: Option<u32>,
    pub login_time: Option<String>,
    pub file: Option<String>,
    pub cmdline: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FtpConfig {
    pub anonymous_ftp: Option<bool>,
    pub anonymous_upload: Option<bool>,
    pub max_clients: Option<u32>,
    pub max_per_ip: Option<u32>,
    pub port: Option<u16>,
    pub passive_ports: Option<String>,
    pub tls_required: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cron Jobs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronJob {
    pub linekey: Option<String>,
    pub line: Option<u32>,
    pub command: String,
    pub minute: String,
    pub hour: String,
    pub day: String,
    pub month: String,
    pub weekday: String,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCronRequest {
    pub command: String,
    pub minute: String,
    pub hour: String,
    pub day: String,
    pub month: String,
    pub weekday: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stats / Metrics
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandwidthUsage {
    pub domain: String,
    pub used_bytes: u64,
    pub limit_bytes: Option<u64>,
    pub http_bytes: Option<u64>,
    pub smtp_bytes: Option<u64>,
    pub pop3_bytes: Option<u64>,
    pub imap_bytes: Option<u64>,
    pub ftp_bytes: Option<u64>,
    pub period: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUsage {
    pub cpu_usage: Option<f64>,
    pub memory_mb: Option<f64>,
    pub memory_limit_mb: Option<f64>,
    pub processes: Option<u32>,
    pub process_limit: Option<u32>,
    pub io_usage: Option<f64>,
    pub io_limit: Option<f64>,
    pub iops_usage: Option<f64>,
    pub iops_limit: Option<f64>,
    pub entry_procs: Option<u32>,
    pub entry_proc_limit: Option<u32>,
    pub nproc: Option<u32>,
    pub nproc_limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisitorLog {
    pub ip: String,
    pub domain: String,
    pub url: String,
    pub method: Option<String>,
    pub status: Option<u16>,
    pub size: Option<u64>,
    pub referrer: Option<String>,
    pub user_agent: Option<String>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorLogEntry {
    pub message: String,
    pub timestamp: Option<String>,
    pub level: Option<String>,
    pub file: Option<String>,
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwestatsSummary {
    pub domain: String,
    pub month: Option<String>,
    pub unique_visitors: Option<u64>,
    pub visits: Option<u64>,
    pub pages: Option<u64>,
    pub hits: Option<u64>,
    pub bandwidth: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHP / Software
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpVersion {
    pub version: String,
    pub handler: Option<String>,
    pub is_default: bool,
    pub is_system_default: Option<bool>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpConfig {
    pub version: String,
    pub directives: Vec<PhpDirective>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpDirective {
    pub key: String,
    pub value: String,
    pub default_value: Option<String>,
    pub info: Option<String>,
    pub directive_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpExtension {
    pub name: String,
    pub enabled: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledSoftware {
    pub name: String,
    pub version: String,
    pub vendor: Option<String>,
    pub url: Option<String>,
    pub install_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerlModule {
    pub name: String,
    pub version: Option<String>,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RubyVersion {
    pub version: String,
    pub path: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodejsVersion {
    pub version: String,
    pub path: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythonVersion {
    pub version: String,
    pub path: Option<String>,
    pub is_default: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Security
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpBlockRule {
    pub ip: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotlinkProtection {
    pub enabled: bool,
    pub allowed_urls: Vec<String>,
    pub extensions: Vec<String>,
    pub redirect_url: Option<String>,
    pub allow_direct: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeechProtection {
    pub enabled: bool,
    pub url: Option<String>,
    pub max_logins: Option<u32>,
    pub time_period: Option<u32>,
    pub redirect_url: Option<String>,
    pub email_notify: Option<bool>,
    pub disable_compromised: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordProtectedDirectory {
    pub directory: String,
    pub name: String,
    pub users: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModSecurityRule {
    pub id: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityPolicy {
    pub modsecurity_enabled: bool,
    pub imunify360_enabled: Option<bool>,
    pub cphulk_enabled: Option<bool>,
    pub two_factor_enabled: Option<bool>,
    pub ssl_redirect: Option<bool>,
    pub csp_header: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TwoFactorAuth {
    pub enabled: bool,
    pub issuer: Option<String>,
    pub secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshAccess {
    pub enabled: bool,
    pub shell: Option<String>,
    pub keys: Vec<SshKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshKey {
    pub name: String,
    pub key_type: Option<String>,
    pub fingerprint: Option<String>,
    pub comment: Option<String>,
    pub authorized: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// WHM API wrappers
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhmApiResponse<T> {
    pub status: Option<u32>,
    pub statusmsg: Option<String>,
    pub data: Option<T>,
    pub metadata: Option<WhmMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhmMetadata {
    pub version: Option<u32>,
    pub reason: Option<String>,
    pub result: Option<u32>,
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UapiResponse<T> {
    pub result: Option<UapiResult>,
    pub status: Option<u32>,
    pub errors: Option<Vec<String>>,
    pub messages: Option<Vec<String>>,
    pub data: Option<T>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UapiResult {
    pub status: u32,
    pub errors: Option<Vec<String>>,
    pub messages: Option<Vec<String>>,
    pub data: Option<serde_json::Value>,
    pub metadata: Option<serde_json::Value>,
    pub warnings: Option<Vec<String>>,
}

/// Output from an SSH command executed on the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}
