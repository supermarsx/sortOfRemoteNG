use serde::{Deserialize, Serialize};
use std::fmt;

// ─── Error types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LastPassErrorKind {
    AuthFailed,
    InvalidCredentials,
    MfaRequired,
    MfaFailed,
    AccountLocked,
    SessionExpired,
    Forbidden,
    NotFound,
    BadRequest,
    ServerError,
    ConnectionError,
    Timeout,
    RateLimited,
    DecryptionError,
    EncryptionError,
    VaultParseError,
    ConfigError,
    ParseError,
    OutOfBandRequired,
    GoogleAuthRequired,
    YubikeyRequired,
    DuoRequired,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastPassError {
    pub kind: LastPassErrorKind,
    pub message: String,
    pub status_code: Option<u16>,
    pub cause: Option<String>,
}

impl LastPassError {
    pub fn new(kind: LastPassErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            status_code: None,
            cause: None,
        }
    }

    pub fn with_status(mut self, code: u16) -> Self {
        self.status_code = Some(code);
        self
    }

    pub fn with_cause(mut self, cause: impl Into<String>) -> Self {
        self.cause = Some(cause.into());
        self
    }

    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(LastPassErrorKind::AuthFailed, msg)
    }

    pub fn invalid_credentials() -> Self {
        Self::new(LastPassErrorKind::InvalidCredentials, "Invalid username or master password")
    }

    pub fn mfa_required(method: &str) -> Self {
        Self::new(LastPassErrorKind::MfaRequired, format!("MFA required: {}", method))
    }

    pub fn session_expired() -> Self {
        Self::new(LastPassErrorKind::SessionExpired, "Session has expired")
    }

    pub fn account_locked() -> Self {
        Self::new(LastPassErrorKind::AccountLocked, "Account is locked due to too many failed attempts")
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(LastPassErrorKind::Forbidden, msg)
    }

    pub fn not_found(resource: &str, id: &str) -> Self {
        Self::new(LastPassErrorKind::NotFound, format!("{} '{}' not found", resource, id))
    }

    pub fn decryption_error(msg: impl Into<String>) -> Self {
        Self::new(LastPassErrorKind::DecryptionError, msg)
    }

    pub fn encryption_error(msg: impl Into<String>) -> Self {
        Self::new(LastPassErrorKind::EncryptionError, msg)
    }

    pub fn vault_parse_error(msg: impl Into<String>) -> Self {
        Self::new(LastPassErrorKind::VaultParseError, msg)
    }

    pub fn server_error(msg: impl Into<String>) -> Self {
        Self::new(LastPassErrorKind::ServerError, msg)
    }

    pub fn connection_error(msg: impl Into<String>) -> Self {
        Self::new(LastPassErrorKind::ConnectionError, msg)
    }

    pub fn config_error(msg: impl Into<String>) -> Self {
        Self::new(LastPassErrorKind::ConfigError, msg)
    }

    pub fn parse_error(msg: impl Into<String>) -> Self {
        Self::new(LastPassErrorKind::ParseError, msg)
    }
}

impl fmt::Display for LastPassError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[LastPass {:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for LastPassError {}

impl From<LastPassError> for String {
    fn from(e: LastPassError) -> String {
        e.message
    }
}

impl From<reqwest::Error> for LastPassError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Self::new(LastPassErrorKind::Timeout, format!("Request timed out: {}", e))
        } else if e.is_connect() {
            Self::connection_error(format!("Connection failed: {}", e))
        } else {
            Self::server_error(format!("HTTP error: {}", e))
        }
    }
}

// ─── Config ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastPassConfig {
    /// LastPass server base URL (usually https://lastpass.com)
    pub server_url: String,
    /// User's email address
    pub username: String,
    /// Number of PBKDF2 iterations (default 100100, server may override)
    pub iterations: u32,
    /// Request timeout in seconds
    pub timeout_secs: u64,
    /// Whether to verify TLS certificates
    pub verify_tls: bool,
    /// Trusted device ID (for skipping MFA on trusted devices)
    pub trusted_device_id: Option<String>,
}

impl Default for LastPassConfig {
    fn default() -> Self {
        Self {
            server_url: "https://lastpass.com".into(),
            username: String::new(),
            iterations: 100100,
            timeout_secs: 30,
            verify_tls: true,
            trusted_device_id: None,
        }
    }
}

// ─── Session ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastPassSession {
    pub session_id: String,
    pub token: String,
    pub uid: String,
    pub private_key: Option<String>,
    pub encryption_key: Vec<u8>,
    pub iterations: u32,
    pub logged_in_at: String,
}

// ─── Vault Account (Item) ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub url: String,
    pub username: String,
    pub password: String,
    pub notes: String,
    pub group: String,
    pub folder_id: Option<String>,
    pub favorite: bool,
    pub auto_login: bool,
    pub never_autofill: bool,
    pub realm: Option<String>,
    pub totp_secret: Option<String>,
    pub last_modified: Option<String>,
    pub last_touched: Option<String>,
    pub pwprotect: bool,
    pub custom_fields: Vec<CustomField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomField {
    pub name: String,
    pub value: String,
    pub field_type: CustomFieldType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CustomFieldType {
    Text,
    Password,
    Email,
    Tel,
    Textarea,
    Select,
    Checkbox,
    Radio,
}

// ─── Create / Update ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAccountRequest {
    pub name: String,
    pub url: String,
    pub username: String,
    pub password: String,
    pub notes: Option<String>,
    pub group: Option<String>,
    pub favorite: Option<bool>,
    pub auto_login: Option<bool>,
    pub totp_secret: Option<String>,
    pub custom_fields: Option<Vec<CustomField>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAccountRequest {
    pub id: String,
    pub name: Option<String>,
    pub url: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub notes: Option<String>,
    pub group: Option<String>,
    pub favorite: Option<bool>,
    pub auto_login: Option<bool>,
    pub totp_secret: Option<String>,
    pub custom_fields: Option<Vec<CustomField>>,
}

// ─── Folder ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub is_shared: bool,
    pub item_count: u64,
}

// ─── Shared Folder ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedFolder {
    pub id: String,
    pub name: String,
    pub read_only: bool,
    pub give_permission: bool,
    pub shared_by: Option<String>,
    pub members: Vec<SharedFolderMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedFolderMember {
    pub uid: String,
    pub username: String,
    pub read_only: bool,
    pub admin: bool,
    pub hide_passwords: bool,
}

// ─── Secure Note ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecureNote {
    pub id: String,
    pub name: String,
    pub content: String,
    pub folder: Option<String>,
    pub note_type: SecureNoteType,
    pub favorite: bool,
    pub last_modified: Option<String>,
    pub custom_fields: Vec<CustomField>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SecureNoteType {
    Generic,
    ServerCredentials,
    Database,
    SoftwareLicense,
    SshKey,
    WifiPassword,
    CreditCard,
    BankAccount,
    DriversLicense,
    Passport,
    Insurance,
    HealthInsurance,
    Membership,
    EmailAccount,
    InstantMessenger,
    Address,
    Custom,
}

// ─── Identity (Form Fill) ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    pub id: String,
    pub title: Option<String>,
    pub first_name: Option<String>,
    pub middle_name: Option<String>,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub mobile_phone: Option<String>,
    pub address1: Option<String>,
    pub address2: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub country: Option<String>,
    pub company: Option<String>,
    pub username: Option<String>,
    pub birthday: Option<String>,
    pub gender: Option<String>,
    pub ssn: Option<String>,
    pub timezone: Option<String>,
    pub notes: Option<String>,
}

// ─── Emergency Access ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmergencyContact {
    pub id: String,
    pub email: String,
    pub status: EmergencyContactStatus,
    pub wait_time_days: u32,
    pub access_level: EmergencyAccessLevel,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EmergencyContactStatus {
    Invited,
    Accepted,
    Pending,
    Approved,
    Expired,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EmergencyAccessLevel {
    ViewOnly,
    TakeOver,
}

// ─── MFA Methods ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MfaMethod {
    GoogleAuthenticator,
    LastPassAuthenticator,
    Totp,
    Duo,
    YubiKey,
    GridCard,
    Sesame,
    SalesforceAuthenticator,
    MicrosoftAuthenticator,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MfaStatus {
    pub enabled: bool,
    pub methods: Vec<MfaMethod>,
    pub trusted_devices: Vec<TrustedDevice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustedDevice {
    pub id: String,
    pub label: String,
    pub last_used: Option<String>,
    pub created_at: Option<String>,
}

// ─── Security Challenge ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityScore {
    pub total_score: f64,
    pub total_items: u64,
    pub weak_passwords: u64,
    pub reused_passwords: u64,
    pub old_passwords: u64,
    pub blank_passwords: u64,
    pub duplicate_count: u64,
    pub average_password_length: f64,
    pub compromised_emails: u64,
    pub accounts_without_mfa: u64,
    pub details: Vec<SecurityScoreDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityScoreDetail {
    pub account_id: String,
    pub account_name: String,
    pub score: f64,
    pub issues: Vec<SecurityIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SecurityIssue {
    WeakPassword,
    ReusedPassword,
    OldPassword,
    BlankPassword,
    ShortPassword,
    NoUppercase,
    NoLowercase,
    NoDigits,
    NoSymbols,
    CompromisedSite,
    HttpUrl,
}

// ─── Import/Export ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExportFormat {
    Csv,
    EncryptedCsv,
    Json,
    Xml,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ImportFormat {
    LastPassCsv,
    OnePasswordCsv,
    DashlaneCsv,
    BitwardenJson,
    KeePassXml,
    ChromeCsv,
    FirefoxCsv,
    GenericCsv,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub total_records: u64,
    pub imported: u64,
    pub skipped: u64,
    pub duplicates: u64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub format: ExportFormat,
    pub total_items: u64,
    pub data: String,
}

// ─── Password Generation ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordGenConfig {
    pub length: u32,
    pub uppercase: bool,
    pub lowercase: bool,
    pub digits: bool,
    pub symbols: bool,
    pub avoid_ambiguous: bool,
    pub min_digits: Option<u32>,
    pub min_symbols: Option<u32>,
    pub exclude_chars: Option<String>,
}

impl Default for PasswordGenConfig {
    fn default() -> Self {
        Self {
            length: 20,
            uppercase: true,
            lowercase: true,
            digits: true,
            symbols: true,
            avoid_ambiguous: false,
            min_digits: None,
            min_symbols: None,
            exclude_chars: None,
        }
    }
}

// ─── Vault Blob (raw encrypted data) ────────────────────────────────

#[derive(Debug, Clone)]
pub struct VaultBlob {
    pub data: Vec<u8>,
    pub version: u32,
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

// ─── Vault Listing Params ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AccountListParams {
    pub folder: Option<String>,
    pub search: Option<String>,
    pub favorites_only: bool,
}
