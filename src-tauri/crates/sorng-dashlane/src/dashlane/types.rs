use serde::{Deserialize, Serialize};
use std::fmt;

// ─── Error types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DashlaneError {
    NotConfigured,
    VaultLocked,
    NotFound(String),
    AuthFailed(String),
    InvalidCredentials,
    MfaRequired,
    SessionExpired,
    Forbidden(String),
    ServerError(String),
    ConnectionError(String),
    Timeout(String),
    RateLimited,
    DecryptionError(String),
    EncryptionError(String),
    ConfigError(String),
    InvalidConfig(String),
    ParseError(String),
    CliError(String),
    SyncError(String),
    ExportFailed(String),
    ImportFailed(String),
    BadRequest(String),
    Unknown(String),
}

impl DashlaneError {
    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::AuthFailed(msg.into())
    }
    pub fn invalid_credentials() -> Self {
        Self::InvalidCredentials
    }
    pub fn mfa_required() -> Self {
        Self::MfaRequired
    }
    pub fn session_expired() -> Self {
        Self::SessionExpired
    }
    pub fn vault_locked() -> Self {
        Self::VaultLocked
    }
    pub fn not_found(resource: &str, id: &str) -> Self {
        Self::NotFound(format!("{} '{}' not found", resource, id))
    }
    pub fn config_error(msg: impl Into<String>) -> Self {
        Self::ConfigError(msg.into())
    }
    pub fn parse_error(msg: impl Into<String>) -> Self {
        Self::ParseError(msg.into())
    }
    pub fn cli_error(msg: impl Into<String>) -> Self {
        Self::CliError(msg.into())
    }
    pub fn decryption_error(msg: impl Into<String>) -> Self {
        Self::DecryptionError(msg.into())
    }
    pub fn server_error(msg: impl Into<String>) -> Self {
        Self::ServerError(msg.into())
    }
    pub fn connection_error(msg: impl Into<String>) -> Self {
        Self::ConnectionError(msg.into())
    }
    pub fn sync_error(msg: impl Into<String>) -> Self {
        Self::SyncError(msg.into())
    }
    /// No-op compatibility shim (status code is embedded in message).
    pub fn with_status(self, _code: u16) -> Self {
        self
    }
}

impl fmt::Display for DashlaneError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotConfigured => write!(f, "Dashlane service not configured"),
            Self::VaultLocked => write!(f, "Vault is locked"),
            Self::NotFound(msg) => write!(f, "Not found: {}", msg),
            Self::AuthFailed(msg) => write!(f, "Authentication failed: {}", msg),
            Self::InvalidCredentials => write!(f, "Invalid email or master password"),
            Self::MfaRequired => write!(f, "Two-factor authentication required"),
            Self::SessionExpired => write!(f, "Session has expired"),
            Self::Forbidden(msg) => write!(f, "Forbidden: {}", msg),
            Self::ServerError(msg) => write!(f, "Server error: {}", msg),
            Self::ConnectionError(msg) => write!(f, "Connection error: {}", msg),
            Self::Timeout(msg) => write!(f, "Timeout: {}", msg),
            Self::RateLimited => write!(f, "Rate limited"),
            Self::DecryptionError(msg) => write!(f, "Decryption error: {}", msg),
            Self::EncryptionError(msg) => write!(f, "Encryption error: {}", msg),
            Self::ConfigError(msg) => write!(f, "Config error: {}", msg),
            Self::InvalidConfig(msg) => write!(f, "Invalid config: {}", msg),
            Self::ParseError(msg) => write!(f, "Parse error: {}", msg),
            Self::CliError(msg) => write!(f, "CLI error: {}", msg),
            Self::SyncError(msg) => write!(f, "Sync error: {}", msg),
            Self::ExportFailed(msg) => write!(f, "Export failed: {}", msg),
            Self::ImportFailed(msg) => write!(f, "Import failed: {}", msg),
            Self::BadRequest(msg) => write!(f, "Bad request: {}", msg),
            Self::Unknown(msg) => write!(f, "Unknown error: {}", msg),
        }
    }
}

impl std::error::Error for DashlaneError {}

impl From<DashlaneError> for String {
    fn from(e: DashlaneError) -> String {
        e.to_string()
    }
}

impl From<reqwest::Error> for DashlaneError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Self::Timeout(format!("Request timed out: {}", e))
        } else if e.is_connect() {
            Self::ConnectionError(format!("Connection failed: {}", e))
        } else {
            Self::ServerError(format!("HTTP error: {}", e))
        }
    }
}

// ─── Config ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashlaneConfig {
    /// Dashlane API server URL
    pub server_url: String,
    /// User's email address
    pub email: String,
    /// Path to Dashlane CLI binary (optional, for CLI integration)
    pub cli_path: Option<String>,
    /// Request timeout in seconds
    pub timeout_secs: u64,
    /// Device name for registration
    pub device_name: String,
}

impl Default for DashlaneConfig {
    fn default() -> Self {
        Self {
            server_url: "https://api.dashlane.com".into(),
            email: String::new(),
            cli_path: None,
            timeout_secs: 30,
            device_name: "sortOfRemoteNG".into(),
        }
    }
}

// ─── Session ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashlaneSession {
    pub device_access_key: String,
    pub device_secret_key: String,
    pub login: String,
    pub server_key: Option<String>,
    pub encryption_key: Vec<u8>,
    pub logged_in_at: String,
}

// ─── Vault Item Categories ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ItemCategory {
    Credential,
    SecureNote,
    CreditCard,
    BankAccount,
    Identity,
    Address,
    Phone,
    Company,
    PersonalWebsite,
    Passport,
    IdCard,
    DriversLicense,
    SocialSecurity,
    TaxNumber,
    Email,
    SecretData,
}

// ─── Credential ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashlaneCredential {
    pub id: String,
    pub title: String,
    pub url: String,
    pub login: String,
    pub secondary_login: Option<String>,
    pub password: String,
    pub notes: Option<String>,
    pub category: Option<String>,
    pub auto_login: bool,
    pub auto_protect: bool,
    pub otp_secret: Option<String>,
    pub otp_url: Option<String>,
    pub linked_services: Vec<String>,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
    pub last_used_at: Option<String>,
    pub password_strength: Option<u32>,
    pub compromised: bool,
    pub reused: bool,
}

// ─── CRUD Requests ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCredentialRequest {
    pub title: String,
    pub url: Option<String>,
    pub login: String,
    pub secondary_login: Option<String>,
    pub password: String,
    pub notes: Option<String>,
    pub category: Option<String>,
    pub auto_login: Option<bool>,
    pub auto_protect: Option<bool>,
    pub otp_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCredentialRequest {
    pub id: String,
    pub title: Option<String>,
    pub url: Option<String>,
    pub login: Option<String>,
    pub password: Option<String>,
    pub notes: Option<String>,
    pub category: Option<String>,
    pub auto_login: Option<bool>,
    pub otp_secret: Option<String>,
}

// ─── Secure Note ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecureNote {
    pub id: String,
    pub title: String,
    pub content: String,
    pub category: Option<String>,
    pub secured: bool,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
    pub color: Option<NoteColor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum NoteColor {
    Blue,
    Green,
    Yellow,
    Orange,
    Red,
    Purple,
    Gray,
}

// ─── Identity ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashlaneIdentity {
    pub id: String,
    pub title: Option<String>,
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub date_of_birth: Option<String>,
    pub address: Option<DashlaneAddress>,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashlaneAddress {
    pub street: String,
    pub street2: Option<String>,
    pub city: String,
    pub state: Option<String>,
    pub zip_code: Option<String>,
    pub country: String,
}

// ─── Payment ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditCard {
    pub id: String,
    pub name: String,
    pub card_number: String,
    pub security_code: String,
    pub expiration_month: Option<String>,
    pub expiration_year: Option<String>,
    pub bank: Option<String>,
    pub color: Option<String>,
    pub issuing_bank: Option<String>,
    pub note: Option<String>,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BankAccount {
    pub id: String,
    pub bank_name: String,
    pub account_holder: String,
    pub iban: Option<String>,
    pub bic: Option<String>,
    pub account_number: Option<String>,
    pub routing_number: Option<String>,
    pub country: Option<String>,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
}

// ─── Device ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisteredDevice {
    pub id: String,
    pub name: String,
    pub platform: Option<String>,
    pub created_at: Option<String>,
    pub last_active: Option<String>,
    pub is_current: bool,
}

// ─── Sharing ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharingGroup {
    pub id: String,
    pub name: String,
    pub members: Vec<SharingMember>,
    pub item_ids: Vec<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharingMember {
    pub user_id: String,
    pub name: String,
    pub permission: SharingPermission,
    pub status: SharingStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SharingPermission {
    Admin,
    Limited,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SharingStatus {
    Accepted,
    Pending,
    Refused,
    Revoked,
}

// ─── Dark Web Monitoring ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DarkWebAlert {
    pub id: String,
    pub email: String,
    pub domain: Option<String>,
    pub breach_name: Option<String>,
    pub breach_date: Option<String>,
    pub exposed_data: Vec<String>,
    pub severity: AlertSeverity,
    pub status: AlertStatus,
    pub detected_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AlertSeverity {
    Critical,
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AlertStatus {
    Active,
    New,
    Viewed,
    Resolved,
    Dismissed,
}

// ─── Password Health ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordHealthScore {
    pub overall_score: u32,
    pub total_passwords: u32,
    pub strong_count: u32,
    pub medium_count: u32,
    pub weak_count: u32,
    pub reused_count: u32,
    pub compromised_count: u32,
    pub old_count: u32,
    pub details: Vec<PasswordHealthDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordHealthDetail {
    pub credential_id: String,
    pub credential_title: String,
    pub strength: u32,
    pub is_reused: bool,
    pub is_compromised: bool,
    pub is_old: bool,
    pub issues: Vec<String>,
}

// ─── Secrets (Environment Variables) ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashlaneSecret {
    pub id: String,
    pub title: String,
    pub content: String,
    pub category: Option<String>,
    pub secured: bool,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
}

// ─── Import/Export ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ImportSource {
    DashlaneCsv,
    DashlaneJson,
    LastPassCsv,
    OnePasswordCsv,
    ChromeCsv,
    BitwardenJson,
    KeePassXml,
    GenericCsv,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub source: ImportSource,
    pub imported_count: usize,
    pub skipped_count: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExportFormat {
    Csv,
    DashlaneCsv,
    DashlaneJson,
    GenericCsv,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub format: ExportFormat,
    pub data: String,
    pub item_count: usize,
}

// ─── Password Generation ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordGenConfig {
    pub length: Option<u32>,
    pub lowercase: Option<bool>,
    pub uppercase: Option<bool>,
    pub digits: Option<bool>,
    pub symbols: Option<bool>,
    pub avoid_ambiguous: Option<bool>,
    pub pronounceable: Option<bool>,
}

impl Default for PasswordGenConfig {
    fn default() -> Self {
        Self {
            length: Some(16),
            lowercase: Some(true),
            uppercase: Some(true),
            digits: Some(true),
            symbols: Some(true),
            avoid_ambiguous: Some(false),
            pronounceable: Some(false),
        }
    }
}

// ─── Filter ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CredentialFilter {
    pub query: Option<String>,
    pub category: Option<String>,
    pub compromised_only: Option<bool>,
    pub weak_only: Option<bool>,
    pub reused_only: Option<bool>,
    pub sort_by: Option<String>,
    pub limit: Option<usize>,
}

// ─── Vault Stats ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultStats {
    pub total_credentials: usize,
    pub total_notes: usize,
    pub total_identities: usize,
    pub total_credit_cards: usize,
    pub total_bank_accounts: usize,
    pub categories: Vec<(String, usize)>,
}

// ─── Cache ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry<T> {
    pub data: T,
    pub fetched_at: chrono::DateTime<chrono::Utc>,
    pub ttl_seconds: u64,
}

impl<T> CacheEntry<T> {
    pub fn new(data: T, ttl_seconds: u64) -> Self {
        Self {
            data,
            fetched_at: chrono::Utc::now(),
            ttl_seconds,
        }
    }

    pub fn is_expired(&self) -> bool {
        let elapsed = chrono::Utc::now()
            .signed_duration_since(self.fetched_at)
            .num_seconds() as u64;
        elapsed > self.ttl_seconds
    }
}
