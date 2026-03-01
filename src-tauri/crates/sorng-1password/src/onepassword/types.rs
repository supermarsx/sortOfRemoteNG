use serde::{Deserialize, Serialize};
use std::fmt;

// ─── Error types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OnePasswordErrorKind {
    AuthFailed,
    TokenExpired,
    TokenInvalid,
    Forbidden,
    NotFound,
    BadRequest,
    Conflict,
    ServerError,
    ConnectionError,
    Timeout,
    RateLimited,
    VaultNotFound,
    ItemNotFound,
    FileNotFound,
    FileTooLarge,
    InvalidCategory,
    InvalidField,
    EncryptionError,
    ConfigError,
    ParseError,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnePasswordError {
    pub kind: OnePasswordErrorKind,
    pub message: String,
    pub status_code: Option<u16>,
    pub request_id: Option<String>,
}

impl OnePasswordError {
    pub fn new(kind: OnePasswordErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            status_code: None,
            request_id: None,
        }
    }

    pub fn with_status(mut self, code: u16) -> Self {
        self.status_code = Some(code);
        self
    }

    pub fn with_request_id(mut self, id: impl Into<String>) -> Self {
        self.request_id = Some(id.into());
        self
    }

    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(OnePasswordErrorKind::AuthFailed, msg)
    }

    pub fn token_expired() -> Self {
        Self::new(OnePasswordErrorKind::TokenExpired, "Bearer token has expired")
    }

    pub fn token_invalid() -> Self {
        Self::new(OnePasswordErrorKind::TokenInvalid, "Bearer token is invalid")
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(OnePasswordErrorKind::Forbidden, msg)
    }

    pub fn not_found(resource: &str, id: &str) -> Self {
        Self::new(
            OnePasswordErrorKind::NotFound,
            format!("{} '{}' not found", resource, id),
        )
    }

    pub fn vault_not_found(id: &str) -> Self {
        Self::new(
            OnePasswordErrorKind::VaultNotFound,
            format!("Vault '{}' not found", id),
        )
    }

    pub fn item_not_found(id: &str) -> Self {
        Self::new(
            OnePasswordErrorKind::ItemNotFound,
            format!("Item '{}' not found", id),
        )
    }

    pub fn file_not_found(id: &str) -> Self {
        Self::new(
            OnePasswordErrorKind::FileNotFound,
            format!("File '{}' not found", id),
        )
    }

    pub fn file_too_large(id: &str) -> Self {
        Self::new(
            OnePasswordErrorKind::FileTooLarge,
            format!("File '{}' is too large to inline", id),
        )
    }

    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::new(OnePasswordErrorKind::BadRequest, msg)
    }

    pub fn server_error(msg: impl Into<String>) -> Self {
        Self::new(OnePasswordErrorKind::ServerError, msg)
    }

    pub fn connection_error(msg: impl Into<String>) -> Self {
        Self::new(OnePasswordErrorKind::ConnectionError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(OnePasswordErrorKind::Timeout, msg)
    }

    pub fn rate_limited() -> Self {
        Self::new(OnePasswordErrorKind::RateLimited, "Rate limit exceeded")
    }

    pub fn config_error(msg: impl Into<String>) -> Self {
        Self::new(OnePasswordErrorKind::ConfigError, msg)
    }

    pub fn parse_error(msg: impl Into<String>) -> Self {
        Self::new(OnePasswordErrorKind::ParseError, msg)
    }
}

impl fmt::Display for OnePasswordError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[1Password {:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for OnePasswordError {}

impl From<OnePasswordError> for String {
    fn from(e: OnePasswordError) -> String {
        e.message
    }
}

impl From<reqwest::Error> for OnePasswordError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Self::timeout(format!("Request timed out: {}", e))
        } else if e.is_connect() {
            Self::connection_error(format!("Connection failed: {}", e))
        } else {
            Self::server_error(format!("HTTP error: {}", e))
        }
    }
}

// ─── Config ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnePasswordConfig {
    /// Base URL of the 1Password Connect server, e.g. http://localhost:8080
    pub connect_host: String,
    /// Service account or Connect token (Bearer JWT)
    pub connect_token: String,
    /// Optional timeout in seconds for API requests
    pub timeout_secs: u64,
    /// Whether to verify TLS certificates
    pub verify_tls: bool,
    /// Maximum inline file size in KB (files larger will not be inlined)
    pub max_inline_file_size_kb: u32,
}

impl Default for OnePasswordConfig {
    fn default() -> Self {
        Self {
            connect_host: "http://localhost:8080".into(),
            connect_token: String::new(),
            timeout_secs: 30,
            verify_tls: true,
            max_inline_file_size_kb: 256,
        }
    }
}

// ─── API Response Envelope ───────────────────────────────────────────

/// 1Password Connect API error response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiErrorResponse {
    pub status: u16,
    pub message: String,
}

// ─── Vault ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VaultType {
    #[serde(rename = "USER_CREATED")]
    UserCreated,
    #[serde(rename = "PERSONAL")]
    Personal,
    #[serde(rename = "EVERYONE")]
    Everyone,
    #[serde(rename = "TRANSFER")]
    Transfer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vault {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub attribute_version: Option<i64>,
    pub content_version: Option<i64>,
    pub items: Option<i64>,
    #[serde(rename = "type")]
    pub vault_type: Option<VaultType>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

// ─── Item Categories ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ItemCategory {
    LOGIN,
    PASSWORD,
    API_CREDENTIAL,
    SERVER,
    DATABASE,
    CREDIT_CARD,
    MEMBERSHIP,
    PASSPORT,
    SOFTWARE_LICENSE,
    OUTDOOR_LICENSE,
    SECURE_NOTE,
    WIRELESS_ROUTER,
    BANK_ACCOUNT,
    DRIVER_LICENSE,
    IDENTITY,
    REWARD_PROGRAM,
    DOCUMENT,
    EMAIL_ACCOUNT,
    SOCIAL_SECURITY_NUMBER,
    MEDICAL_RECORD,
    SSH_KEY,
    CUSTOM,
}

impl fmt::Display for ItemCategory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

// ─── Item URL ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemUrl {
    pub label: Option<String>,
    pub primary: Option<bool>,
    pub href: String,
}

// ─── Field ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FieldType {
    STRING,
    EMAIL,
    CONCEALED,
    URL,
    TOTP,
    DATE,
    MONTH_YEAR,
    MENU,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FieldPurpose {
    #[serde(rename = "")]
    None,
    USERNAME,
    PASSWORD,
    NOTES,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldSection {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratorRecipe {
    pub length: Option<u32>,
    #[serde(rename = "characterSets")]
    pub character_sets: Option<Vec<String>>,
    #[serde(rename = "excludeCharacters")]
    pub exclude_characters: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Field {
    pub id: String,
    pub section: Option<FieldSection>,
    #[serde(rename = "type")]
    pub field_type: FieldType,
    pub purpose: Option<FieldPurpose>,
    pub label: Option<String>,
    pub value: Option<String>,
    pub generate: Option<bool>,
    pub recipe: Option<GeneratorRecipe>,
    pub entropy: Option<f64>,
}

// ─── Section ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub id: String,
    pub label: Option<String>,
}

// ─── File ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAttachment {
    pub id: String,
    pub name: String,
    pub size: Option<i64>,
    pub content_path: Option<String>,
    pub section: Option<FieldSection>,
    pub content: Option<String>,
}

// ─── Item (summary) ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: Option<String>,
    pub title: Option<String>,
    pub vault: ItemVaultRef,
    pub category: ItemCategory,
    pub urls: Option<Vec<ItemUrl>>,
    pub favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub version: Option<i64>,
    pub state: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub last_edited_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemVaultRef {
    pub id: String,
}

// ─── FullItem (with fields, sections, files) ─────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullItem {
    pub id: Option<String>,
    pub title: Option<String>,
    pub vault: ItemVaultRef,
    pub category: ItemCategory,
    pub urls: Option<Vec<ItemUrl>>,
    pub favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub version: Option<i64>,
    pub state: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub last_edited_by: Option<String>,
    pub sections: Option<Vec<Section>>,
    pub fields: Option<Vec<Field>>,
    pub files: Option<Vec<FileAttachment>>,
}

// ─── Create / Update request types ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateItemRequest {
    pub title: String,
    pub vault: ItemVaultRef,
    pub category: ItemCategory,
    pub urls: Option<Vec<ItemUrl>>,
    pub favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub sections: Option<Vec<Section>>,
    pub fields: Option<Vec<Field>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateItemRequest {
    pub id: String,
    pub title: Option<String>,
    pub vault: ItemVaultRef,
    pub category: ItemCategory,
    pub urls: Option<Vec<ItemUrl>>,
    pub favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub sections: Option<Vec<Section>>,
    pub fields: Option<Vec<Field>>,
}

// ─── Patch (RFC 6902 subset) ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PatchOp {
    Add,
    Remove,
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchOperation {
    pub op: PatchOp,
    pub path: String,
    pub value: Option<serde_json::Value>,
}

// ─── API Activity ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ApiAction {
    READ,
    CREATE,
    UPDATE,
    DELETE,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ApiResult {
    SUCCESS,
    DENY,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiRequestActor {
    pub id: Option<String>,
    pub account: Option<String>,
    pub jti: Option<String>,
    #[serde(rename = "userAgent")]
    pub user_agent: Option<String>,
    #[serde(rename = "requestIp")]
    pub request_ip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiRequestResource {
    #[serde(rename = "type")]
    pub resource_type: Option<String>,
    pub vault: Option<ApiRequestResourceRef>,
    pub item: Option<ApiRequestResourceRef>,
    #[serde(rename = "itemVersion")]
    pub item_version: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiRequestResourceRef {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequest {
    pub request_id: Option<String>,
    pub timestamp: Option<String>,
    pub action: Option<ApiAction>,
    pub result: Option<ApiResult>,
    pub actor: Option<ApiRequestActor>,
    pub resource: Option<ApiRequestResource>,
}

// ─── Health / Heartbeat ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceDependency {
    pub service: String,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerHealth {
    pub name: String,
    pub version: String,
    pub dependencies: Option<Vec<ServiceDependency>>,
}

// ─── Password Generation Config ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordGenConfig {
    pub length: u32,
    pub include_letters: bool,
    pub include_digits: bool,
    pub include_symbols: bool,
    pub exclude_characters: Option<String>,
}

impl Default for PasswordGenConfig {
    fn default() -> Self {
        Self {
            length: 32,
            include_letters: true,
            include_digits: true,
            include_symbols: true,
            exclude_characters: None,
        }
    }
}

// ─── Watchtower / Breach Monitoring ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchtowerAlert {
    pub item_id: String,
    pub vault_id: String,
    pub title: String,
    pub alert_type: WatchtowerAlertType,
    pub severity: WatchtowerSeverity,
    pub description: String,
    pub detected_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WatchtowerAlertType {
    WeakPassword,
    ReusedPassword,
    CompromisedPassword,
    VulnerableWebsite,
    ExpiringSoon,
    UnsecuredWebsite,
    TwoFactorAvailable,
    InactiveTwoFactor,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WatchtowerSeverity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchtowerSummary {
    pub total_items: u64,
    pub weak_passwords: u64,
    pub reused_passwords: u64,
    pub compromised_passwords: u64,
    pub vulnerable_sites: u64,
    pub unsecured_sites: u64,
    pub two_factor_available: u64,
    pub inactive_two_factor: u64,
    pub alerts: Vec<WatchtowerAlert>,
}

// ─── TOTP ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotpCode {
    pub code: String,
    pub expires_in_seconds: u64,
    pub period: u64,
}

// ─── Sharing ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultAccess {
    pub vault_id: String,
    pub permissions: Vec<VaultPermission>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum VaultPermission {
    ReadItems,
    CreateItems,
    EditItems,
    DeleteItems,
    ManageVault,
    ArchiveItems,
    ExportItems,
}

// ─── Import / Export ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExportFormat {
    OnePasswordUnencrypted,
    Csv,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ImportFormat {
    OnePassword1Pux,
    OnePasswordCsv,
    LastPassCsv,
    DashlaneCsv,
    BitwardenJson,
    KeePassXml,
    ChromeCsv,
    GenericCsv,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub total_records: u64,
    pub imported: u64,
    pub skipped: u64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub format: ExportFormat,
    pub total_items: u64,
    pub data: String,
}

// ─── Filtering / Query params ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ItemListParams {
    pub filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VaultListParams {
    pub filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ActivityListParams {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

// ─── Favorites ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteItem {
    pub item_id: String,
    pub vault_id: String,
    pub title: String,
    pub category: ItemCategory,
    pub favorited_at: Option<String>,
}

// ─── Cache Metadata ──────────────────────────────────────────────────

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
