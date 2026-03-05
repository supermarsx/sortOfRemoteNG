// ─── Exchange Integration – shared types ────────────────────────────────────
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

// ═══════════════════════════════════════════════════════════════════════════════
// Error types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExchangeErrorKind {
    /// Authentication / authorisation failure
    Auth,
    /// Server / endpoint not reachable
    Connection,
    /// Request timed out
    Timeout,
    /// Item not found (mailbox, group, rule, …)
    NotFound,
    /// Conflict – duplicate, already exists
    Conflict,
    /// Invalid input / parameter
    Validation,
    /// PowerShell execution error
    PowerShell,
    /// Graph API error
    Graph,
    /// EWS / SOAP error
    Ews,
    /// Rate-limit / throttling
    Throttled,
    /// Quota exceeded
    QuotaExceeded,
    /// Service unavailable
    ServiceUnavailable,
    /// Generic / unexpected error
    Unknown,
}

impl fmt::Display for ExchangeErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Auth => write!(f, "auth"),
            Self::Connection => write!(f, "connection"),
            Self::Timeout => write!(f, "timeout"),
            Self::NotFound => write!(f, "not_found"),
            Self::Conflict => write!(f, "conflict"),
            Self::Validation => write!(f, "validation"),
            Self::PowerShell => write!(f, "powershell"),
            Self::Graph => write!(f, "graph"),
            Self::Ews => write!(f, "ews"),
            Self::Throttled => write!(f, "throttled"),
            Self::QuotaExceeded => write!(f, "quota_exceeded"),
            Self::ServiceUnavailable => write!(f, "service_unavailable"),
            Self::Unknown => write!(f, "unknown"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeError {
    pub kind: ExchangeErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl fmt::Display for ExchangeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[exchange:{}] {}", self.kind, self.message)
    }
}

impl std::error::Error for ExchangeError {}

impl From<ExchangeError> for String {
    fn from(e: ExchangeError) -> Self {
        e.to_string()
    }
}

impl ExchangeError {
    pub fn new(kind: ExchangeErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            status_code: None,
            code: None,
        }
    }

    pub fn auth(message: impl Into<String>) -> Self {
        Self::new(ExchangeErrorKind::Auth, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ExchangeErrorKind::NotFound, message)
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ExchangeErrorKind::Validation, message)
    }

    pub fn powershell(message: impl Into<String>) -> Self {
        Self::new(ExchangeErrorKind::PowerShell, message)
    }

    pub fn graph(message: impl Into<String>) -> Self {
        Self::new(ExchangeErrorKind::Graph, message)
    }

    pub fn connection(message: impl Into<String>) -> Self {
        Self::new(ExchangeErrorKind::Connection, message)
    }

    pub fn unknown(message: impl Into<String>) -> Self {
        Self::new(ExchangeErrorKind::Unknown, message)
    }
}

pub type ExchangeResult<T> = Result<T, ExchangeError>;

// ═══════════════════════════════════════════════════════════════════════════════
// Environment & connection
// ═══════════════════════════════════════════════════════════════════════════════

/// Distinguishes between on-prem Exchange Server and Exchange Online.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ExchangeEnvironment {
    /// On-premises Exchange Server (2016, 2019, etc.)
    OnPremises,
    /// Exchange Online (Microsoft 365)
    #[default]
    Online,
    /// Hybrid deployment – both surfaces available
    Hybrid,
}

/// OAuth2 credentials for Exchange Online / Graph API.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeOnlineCredentials {
    /// Azure AD tenant ID (GUID or domain)
    pub tenant_id: String,
    /// Application (client) ID
    pub client_id: String,
    /// Client secret (service principal) – optional when using delegated auth
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    /// Delegated user UPN for app+user flows
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// Password for ROPC flow (not recommended, here for completeness)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// Organization domain (e.g. contoso.onmicrosoft.com)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
}

/// Credentials for on-premises Exchange Management Shell.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeOnPremCredentials {
    /// Exchange server FQDN (e.g. mail01.contoso.local)
    pub server: String,
    /// Port – defaults to 443 (PowerShell remoting over HTTPS)
    #[serde(default = "default_ps_port")]
    pub port: u16,
    /// Domain\User or UPN
    pub username: String,
    /// Password
    pub password: String,
    /// Use SSL for PowerShell remoting
    #[serde(default = "default_true")]
    pub use_ssl: bool,
    /// Auth mechanism: Kerberos, Basic, Negotiate
    #[serde(default)]
    pub auth_method: OnPremAuthMethod,
    /// Skip certificate validation (lab/dev environments)
    #[serde(default)]
    pub skip_cert_check: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum OnPremAuthMethod {
    #[default]
    Kerberos,
    Negotiate,
    Basic,
    Ntlm,
}

fn default_ps_port() -> u16 {
    443
}

fn default_true() -> bool {
    true
}

/// Unified Exchange connection configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeConnectionConfig {
    pub environment: ExchangeEnvironment,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub online: Option<ExchangeOnlineCredentials>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_prem: Option<ExchangeOnPremCredentials>,
    /// Request timeout in seconds
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_timeout() -> u64 {
    120
}

/// Lightweight summary of current Exchange connection.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeConnectionSummary {
    pub connected: bool,
    pub environment: ExchangeEnvironment,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected_as: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exchange_version: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Token types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeToken {
    pub access_token: String,
    #[serde(default)]
    pub token_type: String,
    pub expires_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scopes: Vec<String>,
}

impl ExchangeToken {
    pub fn is_expired(&self) -> bool {
        Utc::now() >= self.expires_at - chrono::Duration::seconds(60)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub token_type: String,
    #[serde(default)]
    pub expires_in: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Graph API paging
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphList<T> {
    #[serde(default)]
    pub value: Vec<T>,
    #[serde(rename = "@odata.nextLink", default, skip_serializing_if = "Option::is_none")]
    pub next_link: Option<String>,
    #[serde(rename = "@odata.count", default, skip_serializing_if = "Option::is_none")]
    pub count: Option<i64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mailbox types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MailboxType {
    #[default]
    UserMailbox,
    SharedMailbox,
    RoomMailbox,
    EquipmentMailbox,
    LinkedMailbox,
    DiscoveryMailbox,
    SchedulingMailbox,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Mailbox {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub primary_smtp_address: String,
    #[serde(default)]
    pub alias: String,
    #[serde(default)]
    pub mailbox_type: MailboxType,
    #[serde(default)]
    pub is_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organizational_unit: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub email_addresses: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when_created: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when_changed: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub litigation_hold_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retention_policy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_principal_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailboxQuota {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prohibit_send_quota: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prohibit_send_receive_quota: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue_warning_quota: Option<String>,
    #[serde(default)]
    pub use_database_quota_defaults: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailboxStatistics {
    #[serde(default)]
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_item_size: Option<String>,
    #[serde(default)]
    pub item_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_logon_time: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_logoff_time: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database_name: Option<String>,
    #[serde(default)]
    pub deleted_item_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_deleted_item_size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailboxPermission {
    pub identity: String,
    pub user: String,
    #[serde(default)]
    pub access_rights: Vec<String>,
    #[serde(default)]
    pub is_inherited: bool,
    #[serde(default)]
    pub deny: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailboxForwarding {
    pub identity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forwarding_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forwarding_smtp_address: Option<String>,
    #[serde(default)]
    pub deliver_to_mailbox_and_forward: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OutOfOfficeSettings {
    pub identity: String,
    #[serde(default)]
    pub auto_reply_state: AutoReplyState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub internal_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_time: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_time: Option<DateTime<Utc>>,
    #[serde(default)]
    pub external_audience: ExternalAudience,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AutoReplyState {
    #[default]
    Disabled,
    Enabled,
    Scheduled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ExternalAudience {
    None,
    #[default]
    Known,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateMailboxRequest {
    pub display_name: String,
    pub alias: String,
    pub primary_smtp_address: String,
    #[serde(default)]
    pub mailbox_type: MailboxType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organizational_unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMailboxRequest {
    pub identity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_smtp_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota: Option<MailboxQuota>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forwarding: Option<MailboxForwarding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_send_size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_receive_size: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Distribution / M365 Group types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum GroupType {
    #[default]
    Distribution,
    Security,
    MailEnabledSecurity,
    DynamicDistribution,
    Microsoft365,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DistributionGroup {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub primary_smtp_address: String,
    #[serde(default)]
    pub alias: String,
    #[serde(default)]
    pub group_type: GroupType,
    #[serde(default)]
    pub member_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub managed_by: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub require_sender_authentication_enabled: bool,
    #[serde(default)]
    pub hide_from_address_lists: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub email_addresses: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GroupMember {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub primary_smtp_address: String,
    #[serde(default)]
    pub recipient_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupRequest {
    pub display_name: String,
    pub alias: String,
    pub primary_smtp_address: String,
    #[serde(default)]
    pub group_type: GroupType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub managed_by: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGroupRequest {
    pub identity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_smtp_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub managed_by: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub require_sender_authentication_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hide_from_address_lists: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Transport Rule types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RuleState {
    #[default]
    Enabled,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransportRule {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub state: RuleState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    // Conditions – most popular subset
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_addresses: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent_to_addresses: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_contains_words: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_or_body_contains_words: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_contains_words: Option<HashMap<String, Vec<String>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_attachment: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_scope: Option<String>,
    // Actions – most popular subset
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prepend_subject: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub add_disclaimer_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirect_message_to: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reject_message_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set_scl: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copy_to: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bcc_to: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransportRuleRequest {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_addresses: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent_to_addresses: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_contains_words: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_attachment: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prepend_subject: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirect_message_to: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reject_message_reason: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connector types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ConnectorDirection {
    #[default]
    Send,
    Receive,
    Inbound,
    Outbound,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Connector {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub direction: ConnectorDirection,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smart_hosts: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address_spaces: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_transport_servers: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_ip_ranges: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls_settings: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when_created: Option<DateTime<Utc>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mail flow / message trace types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DeliveryStatus {
    #[default]
    Delivered,
    Failed,
    Pending,
    Expanded,
    Quarantined,
    FilteredAsSpam,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessageTraceResult {
    #[serde(default)]
    pub message_id: String,
    #[serde(default)]
    pub sender_address: String,
    #[serde(default)]
    pub recipient_address: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub status: DeliveryStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub received: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_trace_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessageTraceRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sender_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipient_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<DeliveryStatus>,
    #[serde(default = "default_page_size")]
    pub page_size: i32,
    #[serde(default)]
    pub page: i32,
}

fn default_page_size() -> i32 {
    100
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailQueue {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub delivery_type: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub message_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_hop_domain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_retry_time: Option<DateTime<Utc>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Calendar & resource types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum CalendarPermissionLevel {
    #[default]
    None,
    FreeBusyTimeOnly,
    FreeBusyTimeAndSubjectAndLocation,
    LimitedDetails,
    Reviewer,
    Author,
    Editor,
    PublishingAuthor,
    PublishingEditor,
    Owner,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CalendarPermission {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub access_rights: CalendarPermissionLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResourceBookingConfig {
    pub identity: String,
    #[serde(default)]
    pub auto_accept: bool,
    #[serde(default)]
    pub allow_conflicts: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub booking_window_in_days: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_duration_in_minutes: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_delegates: Option<Vec<String>>,
    #[serde(default)]
    pub allow_recurring_meetings: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public Folder types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PublicFolder {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub parent_path: String,
    #[serde(default)]
    pub folder_class: String,
    #[serde(default)]
    pub mail_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_smtp_address: Option<String>,
    #[serde(default)]
    pub has_sub_folders: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_mailbox: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PublicFolderStatistics {
    pub identity: String,
    #[serde(default)]
    pub item_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_item_size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_modification_time: Option<DateTime<Utc>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Address policy types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmailAddressPolicy {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enabled_email_address_templates: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipient_filter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipient_filter_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedDomain {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub domain_name: String,
    #[serde(default)]
    pub domain_type: AcceptedDomainType,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AcceptedDomainType {
    #[default]
    Authoritative,
    InternalRelay,
    ExternalRelay,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddressList {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipient_filter: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Migration types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MigrationBatchStatus {
    #[default]
    Created,
    Syncing,
    Synced,
    Completing,
    Completed,
    CompletedWithErrors,
    Failed,
    Stopped,
    Removing,
    Corrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MigrationType {
    #[default]
    LocalMove,
    CrossForestMove,
    RemoteMove,
    Imap,
    CutoverExchange,
    StagedExchange,
    PublicFolderToUnifiedGroup,
    GoogleWorkspace,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MigrationBatch {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub status: MigrationBatchStatus,
    #[serde(default)]
    pub migration_type: MigrationType,
    #[serde(default)]
    pub total_count: i64,
    #[serde(default)]
    pub synced_count: i64,
    #[serde(default)]
    pub failed_count: i64,
    #[serde(default)]
    pub finalized_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_date: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finalized_date: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MoveRequest {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub percent_complete: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub batch_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_mailbox_size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MigrationUser {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub batch_id: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_summary: Option<String>,
    #[serde(default)]
    pub items_synced: i64,
    #[serde(default)]
    pub items_skipped: i64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Compliance & retention types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RetentionActionType {
    #[default]
    DeleteAndAllowRecovery,
    PermanentlyDelete,
    MoveToArchive,
    MarkAsPastRetentionLimit,
    MoveToDeletedItems,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RetentionTagType {
    #[default]
    Default,
    Personal,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RetentionPolicy {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub retention_policy_tag_links: Vec<String>,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RetentionTag {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub tag_type: RetentionTagType,
    #[serde(default)]
    pub age_limit_in_days: i32,
    #[serde(default)]
    pub retention_action: RetentionActionType,
    #[serde(default)]
    pub retention_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_class: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum HoldType {
    #[default]
    None,
    LitigationHold,
    InPlaceHold,
    ComplianceTagHold,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailboxHold {
    pub identity: String,
    #[serde(default)]
    pub hold_type: HoldType,
    #[serde(default)]
    pub litigation_hold_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub litigation_hold_date: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub litigation_hold_owner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub litigation_hold_duration: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_place_holds: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DlpPolicy {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub state: RuleState,
    #[serde(default)]
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sensitive_info_types: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Health / monitoring types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ServerRole {
    #[default]
    Mailbox,
    ClientAccess,
    EdgeTransport,
    UnifiedMessaging,
    HubTransport,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeServer {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub fqdn: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub roles: Vec<ServerRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub admin_display_version: Option<String>,
    #[serde(default)]
    pub is_member_of_dag: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseMountStatus {
    #[default]
    Mounted,
    Dismounted,
    Mounting,
    Dismounting,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailboxDatabase {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub server: String,
    #[serde(default)]
    pub mount_status: DatabaseMountStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database_size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_space: Option<String>,
    #[serde(default)]
    pub mailbox_count: i64,
    #[serde(default)]
    pub recovery: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edb_file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_folder_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_full_backup: Option<DateTime<Utc>>,
    #[serde(default)]
    pub circular_logging_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DagCopyStatus {
    #[default]
    Healthy,
    Mounted,
    Suspended,
    Failed,
    Seeding,
    Initializing,
    Resynchronizing,
    DisconnectedAndHealthy,
    FailedAndSuspended,
    ServiceDown,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DagReplicationStatus {
    #[serde(default)]
    pub database_name: String,
    #[serde(default)]
    pub server: String,
    #[serde(default)]
    pub status: DagCopyStatus,
    #[serde(default)]
    pub copy_queue_length: i64,
    #[serde(default)]
    pub replay_queue_length: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_index_state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_inspected_log_time: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_available_log_time: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAvailabilityGroup {
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub servers: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub witness_server: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub witness_directory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operational_servers: Option<Vec<String>>,
}

/// Exchange Online service health (M365 Service Communications API).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServiceHealthStatus {
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub feature_status: Vec<FeatureStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FeatureStatus {
    #[serde(default)]
    pub feature_name: String,
    #[serde(default)]
    pub feature_service_status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature_service_status_display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerComponentState {
    #[serde(default)]
    pub server: String,
    #[serde(default)]
    pub component: String,
    #[serde(default)]
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requester: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mail Contact & Mail User types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailContact {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub alias: String,
    #[serde(default)]
    pub external_email_address: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_smtp_address: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub email_addresses: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organizational_unit: Option<String>,
    #[serde(default)]
    pub hide_from_address_lists: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateMailContactRequest {
    pub display_name: String,
    pub alias: String,
    pub external_email_address: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organizational_unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailUser {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub alias: String,
    #[serde(default)]
    pub external_email_address: String,
    #[serde(default)]
    pub user_principal_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_smtp_address: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub email_addresses: Vec<String>,
    #[serde(default)]
    pub is_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateMailUserRequest {
    pub display_name: String,
    pub alias: String,
    pub external_email_address: String,
    pub user_principal_name: String,
    pub password: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared Mailbox types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConvertMailboxRequest {
    pub identity: String,
    pub target_type: MailboxType,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Archive Mailbox types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveMailboxInfo {
    pub identity: String,
    #[serde(default)]
    pub archive_state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive_database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive_guid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive_quota: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive_warning_quota: Option<String>,
    #[serde(default)]
    pub auto_expanding_archive_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveStatistics {
    pub identity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_item_size: Option<String>,
    #[serde(default)]
    pub item_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_deleted_item_size: Option<String>,
    #[serde(default)]
    pub deleted_item_count: i64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile Device types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MobileDeviceAccessState {
    #[default]
    Allowed,
    Blocked,
    Quarantined,
    DeviceDiscovery,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MobileDevice {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub device_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_friendly_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_os: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_user_agent: Option<String>,
    #[serde(default)]
    pub device_access_state: MobileDeviceAccessState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_sync_time: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_attempt_time: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_successful_sync: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MobileDeviceStatistics {
    pub identity: String,
    #[serde(default)]
    pub device_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_attempt_time: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_successful_sync: Option<DateTime<Utc>>,
    #[serde(default)]
    pub number_of_folders_synced: i32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inbox Rule types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InboxRule {
    #[serde(default)]
    pub rule_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    // Conditions
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_contains_words: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_contains_words: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_or_body_contains_words: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_address_contains_words: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_attachment: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flagged_for_action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_type_matches: Option<String>,
    // Actions
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub move_to_folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copy_to_folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delete_message: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forward_to: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirect_to: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mark_as_read: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mark_importance: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_processing_rules: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateInboxRuleRequest {
    pub mailbox: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_contains_words: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_attachment: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub move_to_folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delete_message: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forward_to: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mark_as_read: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_processing_rules: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// OWA & Mailbox Policy types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OwaMailboxPolicy {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub direct_file_access_on_public_computers: bool,
    #[serde(default)]
    pub direct_file_access_on_private_computers: bool,
    #[serde(default)]
    pub wac_viewing_on_public_computers: bool,
    #[serde(default)]
    pub wac_viewing_on_private_computers: bool,
    #[serde(default)]
    pub force_wac_viewing_first_on_public_computers: bool,
    #[serde(default)]
    pub force_wac_viewing_first_on_private_computers: bool,
    #[serde(default)]
    pub action_for_unknown_file_and_mime_types: String,
    #[serde(default)]
    pub instant_messaging_enabled: bool,
    #[serde(default)]
    pub text_messaging_enabled: bool,
    #[serde(default)]
    pub active_sync_integration_enabled: bool,
    #[serde(default)]
    pub all_address_lists_enabled: bool,
    #[serde(default)]
    pub calendar_enabled: bool,
    #[serde(default)]
    pub contacts_enabled: bool,
    #[serde(default)]
    pub tasks_enabled: bool,
    #[serde(default)]
    pub journal_enabled: bool,
    #[serde(default)]
    pub notes_enabled: bool,
    #[serde(default)]
    pub reminders_and_notifications_enabled: bool,
    #[serde(default)]
    pub search_folders_enabled: bool,
    #[serde(default)]
    pub signatures_enabled: bool,
    #[serde(default)]
    pub spell_checker_enabled: bool,
    #[serde(default)]
    pub theme_selection_enabled: bool,
    #[serde(default)]
    pub change_password_enabled: bool,
    #[serde(default)]
    pub rules_enabled: bool,
    #[serde(default)]
    pub public_folders_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MobileDeviceMailboxPolicy {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub allow_bluetooth: bool,
    #[serde(default)]
    pub allow_browser: bool,
    #[serde(default)]
    pub allow_camera: bool,
    #[serde(default)]
    pub allow_consumer_email: bool,
    #[serde(default)]
    pub allow_html_email: bool,
    #[serde(default)]
    pub allow_internet_sharing: bool,
    #[serde(default)]
    pub allow_ir_da: bool,
    #[serde(default)]
    pub allow_simple_password: bool,
    #[serde(default)]
    pub allow_text_messaging: bool,
    #[serde(default)]
    pub allow_unsigned_applications: bool,
    #[serde(default)]
    pub allow_wi_fi: bool,
    #[serde(default)]
    pub alpha_numeric_password_required: bool,
    #[serde(default)]
    pub device_encryption_enabled: bool,
    #[serde(default)]
    pub device_password_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_inactivity_time_device_lock: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_password_failed_attempts: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_password_length: Option<i32>,
    #[serde(default)]
    pub password_recovery_enabled: bool,
    #[serde(default)]
    pub require_device_encryption: bool,
    #[serde(default)]
    pub require_storage_card_encryption: bool,
    #[serde(default)]
    pub attachments_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThrottlingPolicy {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ews_max_concurrency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ews_max_subscriptions: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oas_max_concurrency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owa_max_concurrency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub power_shell_max_concurrency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipient_rate_limit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_rate_limit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forwarding_smtp_rate_limit: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Journal Rule types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum JournalRuleScope {
    #[default]
    Global,
    Internal,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JournalRule {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub journal_email_address: String,
    #[serde(default)]
    pub scope: JournalRuleScope,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipient: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateJournalRuleRequest {
    pub name: String,
    pub journal_email_address: String,
    #[serde(default)]
    pub scope: JournalRuleScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipient: Option<String>,
    #[serde(default)]
    pub enabled: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// RBAC & Audit types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoleGroup {
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub roles: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub managed_by: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManagementRole {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub role_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(default)]
    pub is_root_role: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManagementRoleAssignment {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub role_assignee: String,
    #[serde(default)]
    pub role_assignee_type: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_recipient_write_scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipient_read_scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AdminAuditLogEntry {
    #[serde(default)]
    pub cmdlet_name: String,
    #[serde(default)]
    pub object_modified: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caller: Option<String>,
    #[serde(default)]
    pub succeeded: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_date: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub cmdlet_parameters: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AdminAuditLogSearchRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cmdlets: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(default = "default_page_size")]
    pub result_size: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailboxAuditLogEntry {
    #[serde(default)]
    pub operation: String,
    #[serde(default)]
    pub mailbox_owner: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logged_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_on_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_subject: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_path_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_accessed: Option<DateTime<Utc>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Remote Domain types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDomain {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub domain_name: String,
    #[serde(default)]
    pub is_internal: bool,
    #[serde(default)]
    pub auto_reply_enabled: bool,
    #[serde(default)]
    pub auto_forward_enabled: bool,
    #[serde(default)]
    pub delivery_report_enabled: bool,
    #[serde(default)]
    pub ndr_enabled: bool,
    #[serde(default)]
    pub tnef_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_oof_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub character_set: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateRemoteDomainRequest {
    pub name: String,
    pub domain_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_reply_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_forward_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_report_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ndr_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_oof_type: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Certificate types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeCertificate {
    #[serde(default)]
    pub thumbprint: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub issuer: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub services: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub certificate_domains: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_before: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_after: Option<DateTime<Utc>>,
    #[serde(default)]
    pub self_signed: bool,
    #[serde(default)]
    pub is_valid: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_ca_type: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Virtual Directory types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum VirtualDirectoryType {
    #[default]
    Owa,
    Ecp,
    ActiveSync,
    Ews,
    PowerShell,
    Mapi,
    OutlookAnywhere,
    AutoDiscover,
    Oab,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VirtualDirectory {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub server: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub vdir_type: VirtualDirectoryType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub internal_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub internal_authentication_methods: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub external_authentication_methods: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssl_offloading: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Organization Config types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationConfig {
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guid: Option<String>,
    #[serde(default)]
    pub is_dehydrated: bool,
    #[serde(default)]
    pub default_public_folder_age_limit: String,
    #[serde(default)]
    pub default_public_folder_deleted_item_retention: String,
    #[serde(default)]
    pub default_public_folder_issue_warning_quota: String,
    #[serde(default)]
    pub default_public_folder_prohibit_post_quota: String,
    #[serde(default)]
    pub default_public_folder_max_item_size: String,
    #[serde(default)]
    pub mailtips_enabled: bool,
    #[serde(default)]
    pub mailtips_all_tips_enabled: bool,
    #[serde(default)]
    pub mailtips_group_metrics_enabled: bool,
    #[serde(default)]
    pub mailtips_large_audience_threshold: i32,
    #[serde(default)]
    pub mailtips_external_recipient_tips_enabled: bool,
    #[serde(default)]
    pub read_tracking_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distribution_group_default_ou: Option<String>,
    #[serde(default)]
    pub lean_popout_enabled: bool,
    #[serde(default)]
    pub public_folders_enabled: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_send_size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_receive_size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransportConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_send_size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_receive_size: Option<String>,
    #[serde(default)]
    pub external_postmaster_address: String,
    #[serde(default)]
    pub internal_smtp_servers: Vec<String>,
    #[serde(default)]
    pub tls_receive_domain_secure_list: Vec<String>,
    #[serde(default)]
    pub tls_send_domain_secure_list: Vec<String>,
    #[serde(default)]
    pub generate_copy_of_dsr_for: Vec<String>,
    #[serde(default)]
    pub journal_archiving_enabled: bool,
    #[serde(default)]
    pub shadow_redundancy_enabled: bool,
    #[serde(default)]
    pub safety_net_hold_time: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mailbox Import / Export request types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ImportExportDirection {
    #[default]
    Import,
    Export,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailboxImportExportRequest {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub mailbox: String,
    #[serde(default)]
    pub direction: ImportExportDirection,
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub percent_complete: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_folders: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude_folders: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_root_folder: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Anti-spam / Hygiene types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContentFilterConfig {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub scl_delete_threshold: i32,
    #[serde(default)]
    pub scl_reject_threshold: i32,
    #[serde(default)]
    pub scl_quarantine_threshold: i32,
    #[serde(default)]
    pub scl_junk_threshold: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quarantine_mailbox: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bypass_sender_domains: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bypass_senders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFilterConfig {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ip_allow_list: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ip_block_list: Vec<String>,
    #[serde(default)]
    pub enable_safe_list: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SenderFilterConfig {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocked_senders: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocked_domains: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocked_domains_and_subdomains: Vec<String>,
    #[serde(default)]
    pub blank_sender_blocking_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineMessage {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub sender: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recipients: Vec<String>,
    #[serde(default)]
    pub quarantine_reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub received_time: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub released_to: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<DateTime<Utc>>,
    #[serde(default)]
    pub direction: String,
    #[serde(default)]
    pub message_size: i64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Graph API constants
// ═══════════════════════════════════════════════════════════════════════════════

pub mod api {
    /// Microsoft Graph v1.0 base URL
    pub const GRAPH_BASE: &str = "https://graph.microsoft.com/v1.0";
    /// Graph beta base URL
    pub const GRAPH_BETA: &str = "https://graph.microsoft.com/beta";
    /// Exchange Online PowerShell v3 REST endpoint
    pub const EXO_REST_BASE: &str = "https://outlook.office365.com/adminapi/beta";
    /// Token endpoint template
    pub const TOKEN_URL_TEMPLATE: &str =
        "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token";
    /// EWS endpoint template (on-prem)
    pub const EWS_URL_TEMPLATE: &str = "https://{server}/EWS/Exchange.asmx";
    /// PowerShell remoting URI template (on-prem)
    pub const PS_REMOTING_TEMPLATE: &str =
        "https://{server}/PowerShell/";

    /// Graph API scopes used by this crate
    pub mod scopes {
        pub const MAIL_READ_WRITE: &str = "https://graph.microsoft.com/.default";
        pub const EXCHANGE_MANAGE: &str = "https://outlook.office365.com/.default";
    }
}
