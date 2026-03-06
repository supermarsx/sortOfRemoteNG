//! Shared types for Postfix MTA management.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixConnectionConfig {
    /// SSH hostname or IP
    pub host: String,
    /// SSH port (default: 22)
    pub port: Option<u16>,
    /// SSH username
    pub ssh_user: Option<String>,
    /// SSH password (if not using key-based auth)
    pub ssh_password: Option<String>,
    /// Path to SSH private key
    pub ssh_key: Option<String>,
    /// Path to postfix binary (default: /usr/sbin/postfix)
    pub postfix_bin: Option<String>,
    /// Postfix config directory (default: /etc/postfix)
    pub config_dir: Option<String>,
    /// Postfix queue directory (default: /var/spool/postfix)
    pub queue_dir: Option<String>,
    /// SSH connection timeout in seconds
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub mail_name: Option<String>,
    pub mydomain: Option<String>,
    pub myorigin: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSH Output
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Postfix Info
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixInfo {
    pub version: String,
    pub mail_name: Option<String>,
    pub config_directory: String,
    pub queue_directory: String,
    pub daemon_directory: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixMainCfParam {
    pub name: String,
    pub value: String,
    pub default_value: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixMasterCfEntry {
    pub service_name: String,
    pub service_type: String,
    pub private_flag: Option<String>,
    pub unpriv: Option<String>,
    pub chroot: Option<String>,
    pub wakeup: Option<String>,
    pub maxproc: Option<String>,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigTestResult {
    pub success: bool,
    pub output: String,
    pub errors: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Domains
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DomainType {
    Virtual,
    Relay,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixDomain {
    pub domain: String,
    pub domain_type: DomainType,
    pub transport: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDomainRequest {
    pub domain: String,
    pub domain_type: DomainType,
    pub transport: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateDomainRequest {
    pub domain_type: Option<DomainType>,
    pub transport: Option<String>,
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Aliases
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AliasType {
    Virtual,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixAlias {
    pub address: String,
    pub recipients: Vec<String>,
    pub alias_type: AliasType,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAliasRequest {
    pub address: String,
    pub recipients: Vec<String>,
    pub alias_type: AliasType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAliasRequest {
    pub recipients: Option<Vec<String>>,
    pub alias_type: Option<AliasType>,
    pub enabled: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Transports
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixTransport {
    pub domain: String,
    pub transport: String,
    pub nexthop: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTransportRequest {
    pub domain: String,
    pub transport: String,
    pub nexthop: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTransportRequest {
    pub transport: Option<String>,
    pub nexthop: Option<String>,
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Queues
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueName {
    Active,
    Deferred,
    Hold,
    Corrupt,
    Incoming,
}

impl std::fmt::Display for QueueName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QueueName::Active => write!(f, "active"),
            QueueName::Deferred => write!(f, "deferred"),
            QueueName::Hold => write!(f, "hold"),
            QueueName::Corrupt => write!(f, "corrupt"),
            QueueName::Incoming => write!(f, "incoming"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixQueue {
    pub queue_name: QueueName,
    pub count: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixQueueEntry {
    pub queue_id: String,
    pub sender: String,
    pub recipients: Vec<String>,
    pub arrival_time: Option<String>,
    pub size: u64,
    pub status: String,
    pub reason: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixMailLog {
    pub timestamp: Option<String>,
    pub hostname: Option<String>,
    pub process: Option<String>,
    pub pid: Option<u32>,
    pub queue_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailStatistics {
    pub sent: u64,
    pub bounced: u64,
    pub deferred: u64,
    pub rejected: u64,
    pub held: u64,
    pub total: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// TLS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TlsPolicy {
    None,
    May,
    Encrypt,
    Dane,
    Verify,
    Secure,
}

impl std::fmt::Display for TlsPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TlsPolicy::None => write!(f, "none"),
            TlsPolicy::May => write!(f, "may"),
            TlsPolicy::Encrypt => write!(f, "encrypt"),
            TlsPolicy::Dane => write!(f, "dane"),
            TlsPolicy::Verify => write!(f, "verify"),
            TlsPolicy::Secure => write!(f, "secure"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixTlsPolicy {
    pub domain: String,
    pub policy: TlsPolicy,
    pub match_type: Option<String>,
    pub params: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateInfo {
    pub subject: String,
    pub issuer: String,
    pub not_before: String,
    pub not_after: String,
    pub fingerprint: String,
    pub serial: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Restrictions
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RestrictionStage {
    SmtpdRelay,
    SmtpdRecipient,
    SmtpdSender,
    SmtpdClient,
}

impl RestrictionStage {
    pub fn param_name(&self) -> &str {
        match self {
            RestrictionStage::SmtpdRelay => "smtpd_relay_restrictions",
            RestrictionStage::SmtpdRecipient => "smtpd_recipient_restrictions",
            RestrictionStage::SmtpdSender => "smtpd_sender_restrictions",
            RestrictionStage::SmtpdClient => "smtpd_client_restrictions",
        }
    }
}

impl std::fmt::Display for RestrictionStage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.param_name())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixRestriction {
    pub name: String,
    pub stage: RestrictionStage,
    pub position: u32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Maps
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MapType {
    Hash,
    Btree,
    Regexp,
    Pcre,
    Lmdb,
}

impl std::fmt::Display for MapType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MapType::Hash => write!(f, "hash"),
            MapType::Btree => write!(f, "btree"),
            MapType::Regexp => write!(f, "regexp"),
            MapType::Pcre => write!(f, "pcre"),
            MapType::Lmdb => write!(f, "lmdb"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixMap {
    pub name: String,
    pub map_type: MapType,
    pub path: String,
    pub entries_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixMapEntry {
    pub key: String,
    pub value: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SASL Authentication
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixSaslAuth {
    pub mechanisms: Vec<String>,
    pub smtpd_sasl_auth_enable: bool,
    pub smtpd_sasl_security_options: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Milters
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostfixMilter {
    pub name: String,
    pub socket: String,
    pub flags: Option<String>,
    pub protocol: Option<String>,
}
