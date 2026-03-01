use serde::{Deserialize, Serialize};
use std::fmt;

// ─── Error types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum GooglePasswordsErrorKind {
    AuthFailed,
    TokenExpired,
    InvalidCredentials,
    Forbidden,
    NotFound,
    BadRequest,
    ServerError,
    ConnectionError,
    Timeout,
    RateLimited,
    ConfigError,
    ParseError,
    OAuthError,
    SyncError,
    ImportError,
    ExportError,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GooglePasswordsError {
    pub kind: GooglePasswordsErrorKind,
    pub message: String,
    pub status_code: Option<u16>,
}

impl GooglePasswordsError {
    pub fn new(kind: GooglePasswordsErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            status_code: None,
        }
    }

    pub fn with_status(mut self, code: u16) -> Self {
        self.status_code = Some(code);
        self
    }

    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(GooglePasswordsErrorKind::AuthFailed, msg)
    }

    pub fn token_expired() -> Self {
        Self::new(GooglePasswordsErrorKind::TokenExpired, "OAuth token has expired")
    }

    pub fn not_found(resource: &str, id: &str) -> Self {
        Self::new(GooglePasswordsErrorKind::NotFound, format!("{} '{}' not found", resource, id))
    }

    pub fn config_error(msg: impl Into<String>) -> Self {
        Self::new(GooglePasswordsErrorKind::ConfigError, msg)
    }

    pub fn parse_error(msg: impl Into<String>) -> Self {
        Self::new(GooglePasswordsErrorKind::ParseError, msg)
    }

    pub fn import_error(msg: impl Into<String>) -> Self {
        Self::new(GooglePasswordsErrorKind::ImportError, msg)
    }

    pub fn export_error(msg: impl Into<String>) -> Self {
        Self::new(GooglePasswordsErrorKind::ExportError, msg)
    }

    pub fn sync_error(msg: impl Into<String>) -> Self {
        Self::new(GooglePasswordsErrorKind::SyncError, msg)
    }

    pub fn server_error(msg: impl Into<String>) -> Self {
        Self::new(GooglePasswordsErrorKind::ServerError, msg)
    }

    pub fn connection_error(msg: impl Into<String>) -> Self {
        Self::new(GooglePasswordsErrorKind::ConnectionError, msg)
    }
}

impl fmt::Display for GooglePasswordsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[GooglePasswords {:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for GooglePasswordsError {}

impl From<GooglePasswordsError> for String {
    fn from(e: GooglePasswordsError) -> String {
        e.message
    }
}

impl From<reqwest::Error> for GooglePasswordsError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Self::new(GooglePasswordsErrorKind::Timeout, format!("Request timed out: {}", e))
        } else if e.is_connect() {
            Self::connection_error(format!("Connection failed: {}", e))
        } else {
            Self::server_error(format!("HTTP error: {}", e))
        }
    }
}

// ─── Config ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GooglePasswordsConfig {
    /// OAuth 2.0 client ID
    pub client_id: String,
    /// OAuth 2.0 client secret
    pub client_secret: String,
    /// OAuth redirect URI
    pub redirect_uri: String,
    /// Google API scopes
    pub scopes: Vec<String>,
    /// Request timeout in seconds
    pub timeout_secs: u64,
}

impl Default for GooglePasswordsConfig {
    fn default() -> Self {
        Self {
            client_id: String::new(),
            client_secret: String::new(),
            redirect_uri: "http://localhost:8080/callback".into(),
            scopes: vec![
                "https://www.googleapis.com/auth/chrome.management.reports.readonly".into(),
            ],
            timeout_secs: 30,
        }
    }
}

// ─── OAuth Token ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub scope: Option<String>,
}

impl OAuthToken {
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            chrono::Utc::now() >= expires_at
        } else {
            false
        }
    }
}

// ─── Credential (Password Entry) ────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credential {
    pub id: String,
    pub name: String,
    pub url: String,
    pub username: String,
    pub password: String,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
    pub last_used_at: Option<String>,
    pub compromised: bool,
    pub weak: bool,
    pub reused: bool,
    pub password_strength: Option<PasswordStrength>,
    pub android_app: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PasswordStrength {
    VeryWeak,
    Weak,
    Fair,
    Strong,
    VeryStrong,
}

// ─── CRUD Requests ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCredentialRequest {
    pub name: String,
    pub url: String,
    pub username: String,
    pub password: String,
    pub notes: Option<String>,
    pub folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCredentialRequest {
    pub id: String,
    pub name: Option<String>,
    pub url: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
}

// ─── Password Checkup ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordCheckupResult {
    pub total_passwords: u64,
    pub compromised: u64,
    pub reused: u64,
    pub weak: u64,
    pub compromised_credentials: Vec<Credential>,
    pub reused_credentials: Vec<Vec<Credential>>,
    pub weak_credentials: Vec<Credential>,
}

// ─── Import/Export ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ImportSource {
    GoogleCsv,
    ChromeCsv,
    LastPassCsv,
    OnePasswordCsv,
    DashlaneCsv,
    BitwardenJson,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExportFormat {
    GoogleCsv,
    GenericCsv,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub format: ExportFormat,
    pub total_items: u64,
    pub data: String,
}

// ─── Sync Status ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SyncStatus {
    Synced,
    Syncing,
    Error,
    NotConfigured,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncInfo {
    pub status: SyncStatus,
    pub last_synced: Option<String>,
    pub total_synced: u64,
    pub pending_changes: u64,
    pub error_message: Option<String>,
}

// ─── Password Generation ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordGenConfig {
    pub length: u32,
    pub include_uppercase: bool,
    pub include_lowercase: bool,
    pub include_numbers: bool,
    pub include_symbols: bool,
    pub exclude_ambiguous: bool,
}

impl Default for PasswordGenConfig {
    fn default() -> Self {
        Self {
            length: 16,
            include_uppercase: true,
            include_lowercase: true,
            include_numbers: true,
            include_symbols: true,
            exclude_ambiguous: false,
        }
    }
}

// ─── Search / Filter ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CredentialFilter {
    pub search: Option<String>,
    pub folder: Option<String>,
    pub compromised_only: bool,
    pub weak_only: bool,
    pub reused_only: bool,
}

// ─── Vault Stats ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultStats {
    pub total_credentials: u64,
    pub total_folders: u64,
    pub compromised_count: u64,
    pub weak_count: u64,
    pub reused_count: u64,
    pub average_password_length: f64,
    pub oldest_password_days: u64,
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
