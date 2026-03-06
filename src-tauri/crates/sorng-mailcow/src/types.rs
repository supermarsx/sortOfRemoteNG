//! Shared data structures for Mailcow API interactions.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Connection
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration supplied when connecting to a Mailcow instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowConnectionConfig {
    /// Base URL of the Mailcow instance, e.g. `https://mail.example.com`
    pub base_url: String,
    /// Read-write or read-only API key
    pub api_key: String,
    /// HTTP request timeout in seconds (default 30)
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    /// Skip TLS certificate verification
    #[serde(default)]
    pub tls_skip_verify: bool,
}

fn default_timeout() -> u64 {
    30
}

/// Summary returned after a successful ping / connect.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub hostname: Option<String>,
    pub containers_count: usize,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Domains
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowDomain {
    pub domain_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub aliases: i64,
    #[serde(default)]
    pub mailboxes: i64,
    #[serde(default)]
    pub max_aliases: i64,
    #[serde(default)]
    pub max_mailboxes: i64,
    #[serde(default)]
    pub max_quota: i64,
    #[serde(default)]
    pub quota: i64,
    #[serde(default)]
    pub relay_all_recipients: bool,
    #[serde(default)]
    pub relay_host: String,
    #[serde(default)]
    pub backupmx: bool,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDomainRequest {
    pub domain: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_aliases")]
    pub aliases: i64,
    #[serde(default = "default_mailboxes")]
    pub mailboxes: i64,
    #[serde(default = "default_max_quota")]
    pub max_quota: i64,
    #[serde(default)]
    pub quota: i64,
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default)]
    pub restart_sogo: bool,
}

fn default_aliases() -> i64 { 400 }
fn default_mailboxes() -> i64 { 10 }
fn default_max_quota() -> i64 { 1073741824 }
fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateDomainRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aliases: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mailboxes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_quota: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relay_all_recipients: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relay_host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backupmx: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restart_sogo: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Mailboxes
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowMailbox {
    pub username: String,
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub local_part: String,
    #[serde(default)]
    pub quota: i64,
    #[serde(default)]
    pub percent_in_use: f64,
    #[serde(default)]
    pub messages: i64,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
    #[serde(default)]
    pub last_imap_login: Option<String>,
    #[serde(default)]
    pub last_smtp_login: Option<String>,
    #[serde(default)]
    pub last_pop3_login: Option<String>,
    #[serde(default)]
    pub spam_aliases: i64,
    #[serde(default)]
    pub tls_enforce_in: bool,
    #[serde(default)]
    pub tls_enforce_out: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMailboxRequest {
    pub local_part: String,
    pub domain: String,
    pub name: String,
    pub password: String,
    #[serde(default = "default_max_quota")]
    pub quota: i64,
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default)]
    pub force_pw_update: bool,
    #[serde(default)]
    pub tls_enforce_in: bool,
    #[serde(default)]
    pub tls_enforce_out: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateMailboxRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_pw_update: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls_enforce_in: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls_enforce_out: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Aliases
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowAlias {
    pub id: i64,
    pub address: String,
    pub goto: String,
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
    #[serde(default)]
    pub in_primary_domain: Option<String>,
    #[serde(default)]
    pub is_catch_all: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAliasRequest {
    pub address: String,
    pub goto: String,
    #[serde(default = "default_true")]
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateAliasRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goto: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. DKIM
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowDkimKey {
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub dkim_txt: String,
    #[serde(default)]
    pub dkim_selector: String,
    #[serde(default)]
    pub length: i64,
    #[serde(default)]
    pub privkey: String,
    #[serde(default)]
    pub pubkey: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateDkimRequest {
    pub domains: Vec<String>,
    #[serde(default = "default_dkim_selector")]
    pub dkim_selector: String,
    #[serde(default = "default_dkim_key_size")]
    pub key_size: i64,
}

fn default_dkim_selector() -> String { "dkim".to_string() }
fn default_dkim_key_size() -> i64 { 2048 }

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Domain Aliases
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowDomainAlias {
    #[serde(default)]
    pub alias_domain: String,
    #[serde(default)]
    pub target_domain: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDomainAliasRequest {
    pub alias_domain: String,
    pub target_domain: String,
    #[serde(default = "default_true")]
    pub active: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. SOGo
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SogoInfo {
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub active_sessions: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SogoSession {
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub created: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Transport Maps
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowTransportMap {
    pub id: i64,
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub next_hop: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTransportMapRequest {
    pub destination: String,
    pub next_hop: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default = "default_true")]
    pub active: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Fail2Ban / Rate Limits
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowFail2BanConfig {
    #[serde(default)]
    pub ban_time: i64,
    #[serde(default)]
    pub max_attempts: i64,
    #[serde(default)]
    pub retry_window: i64,
    #[serde(default)]
    pub whitelist: Vec<String>,
    #[serde(default)]
    pub blacklist: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowRateLimit {
    #[serde(default)]
    pub object: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub frame: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetRateLimitRequest {
    pub object: String,
    pub value: String,
    pub frame: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Queue
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowQueueItem {
    #[serde(default)]
    pub queue_name: String,
    #[serde(default)]
    pub queue_id: String,
    #[serde(default)]
    pub sender: String,
    #[serde(default)]
    pub recipients: String,
    #[serde(default)]
    pub arrival_time: String,
    #[serde(default)]
    pub message_size: i64,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowQueueSummary {
    #[serde(default)]
    pub active: i64,
    #[serde(default)]
    pub deferred: i64,
    #[serde(default)]
    pub hold: i64,
    #[serde(default)]
    pub incoming: i64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowLogEntry {
    #[serde(default)]
    pub time: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub program: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MailcowLogType {
    Dovecot,
    Postfix,
    Sogo,
    Rspamd,
    Autodiscover,
    Api,
    Acme,
    Netfilter,
    Watchdog,
}

impl MailcowLogType {
    pub fn as_api_str(&self) -> &str {
        match self {
            Self::Dovecot => "dovecot",
            Self::Postfix => "postfix",
            Self::Sogo => "sogo",
            Self::Rspamd => "rspamd",
            Self::Autodiscover => "autodiscover",
            Self::Api => "api",
            Self::Acme => "acme",
            Self::Netfilter => "netfilter",
            Self::Watchdog => "watchdog",
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Status
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowContainerStatus {
    #[serde(default)]
    pub container: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub started_at: String,
    #[serde(default)]
    pub health: String,
    #[serde(default)]
    pub image: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowSystemStatus {
    #[serde(default)]
    pub containers: Vec<MailcowContainerStatus>,
    #[serde(default)]
    pub disk_usage: Option<String>,
    #[serde(default)]
    pub solr_status: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Resources
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowResource {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub multiple_bookings: bool,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateResourceRequest {
    pub name: String,
    pub kind: String,
    pub domain: String,
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub multiple_bookings: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 14. App Passwords
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowAppPassword {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAppPasswordRequest {
    pub username: String,
    pub name: String,
    pub password: String,
    #[serde(default = "default_true")]
    pub active: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 15. Quarantine
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailcowQuarantineItem {
    pub id: i64,
    #[serde(default)]
    pub qid: String,
    #[serde(default)]
    pub sender: String,
    #[serde(default)]
    pub rcpt: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub score: f64,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub notified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuarantineAction {
    Release,
    Delete,
    Whitelist,
}
