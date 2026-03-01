//! Core types for the Bitwarden integration.
//!
//! Defines vault item models, configuration structures, error types,
//! and all enumerations matching the Bitwarden data format.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

// ── Error types ─────────────────────────────────────────────────────

/// Bitwarden-specific error kinds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum BitwardenErrorKind {
    /// CLI executable not found or not in PATH.
    CliNotFound,
    /// Authentication failed (bad credentials, expired token).
    AuthFailed,
    /// Vault is locked and a session key is required.
    VaultLocked,
    /// The requested item was not found.
    NotFound,
    /// A network or HTTP request error.
    NetworkError,
    /// The `bw serve` API returned an error.
    ApiError,
    /// JSON parsing or serialization failure.
    ParseError,
    /// Encryption or decryption failure.
    CryptoError,
    /// Sync failed.
    SyncFailed,
    /// Rate limited by the server.
    RateLimited,
    /// Invalid configuration or arguments.
    InvalidConfig,
    /// Two-factor authentication required.
    TwoFactorRequired,
    /// Operation timed out.
    Timeout,
    /// Generic I/O error.
    IoError,
    /// Organization-level error.
    OrganizationError,
}

/// A Bitwarden integration error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BitwardenError {
    pub kind: BitwardenErrorKind,
    pub message: String,
}

impl fmt::Display for BitwardenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for BitwardenError {}

impl From<BitwardenError> for String {
    fn from(e: BitwardenError) -> String {
        e.message
    }
}

impl BitwardenError {
    pub fn cli_not_found(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::CliNotFound, message: msg.into() }
    }
    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::AuthFailed, message: msg.into() }
    }
    pub fn vault_locked(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::VaultLocked, message: msg.into() }
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::NotFound, message: msg.into() }
    }
    pub fn network(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::NetworkError, message: msg.into() }
    }
    pub fn api(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::ApiError, message: msg.into() }
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::ParseError, message: msg.into() }
    }
    pub fn crypto(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::CryptoError, message: msg.into() }
    }
    pub fn sync_failed(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::SyncFailed, message: msg.into() }
    }
    pub fn invalid_config(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::InvalidConfig, message: msg.into() }
    }
    pub fn two_factor_required(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::TwoFactorRequired, message: msg.into() }
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::Timeout, message: msg.into() }
    }
    pub fn io(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::IoError, message: msg.into() }
    }
    pub fn organization(msg: impl Into<String>) -> Self {
        Self { kind: BitwardenErrorKind::OrganizationError, message: msg.into() }
    }
}

// ── Vault item types ────────────────────────────────────────────────

/// Bitwarden vault item type (matching CLI enums).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum ItemType {
    Login = 1,
    SecureNote = 2,
    Card = 3,
    Identity = 4,
    SshKey = 5,
}

impl ItemType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::Login),
            2 => Some(Self::SecureNote),
            3 => Some(Self::Card),
            4 => Some(Self::Identity),
            5 => Some(Self::SshKey),
            _ => None,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::Login => "Login",
            Self::SecureNote => "Secure Note",
            Self::Card => "Card",
            Self::Identity => "Identity",
            Self::SshKey => "SSH Key",
        }
    }
}

impl fmt::Display for ItemType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.name())
    }
}

/// Two-step login method.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum TwoFactorMethod {
    Authenticator = 0,
    Email = 1,
    YubiKey = 3,
}

impl TwoFactorMethod {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Authenticator),
            1 => Some(Self::Email),
            3 => Some(Self::YubiKey),
            _ => None,
        }
    }
}

/// URI match detection type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum UriMatchType {
    Domain = 0,
    Host = 1,
    StartsWith = 2,
    Exact = 3,
    RegularExpression = 4,
    Never = 5,
}

impl UriMatchType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Domain),
            1 => Some(Self::Host),
            2 => Some(Self::StartsWith),
            3 => Some(Self::Exact),
            4 => Some(Self::RegularExpression),
            5 => Some(Self::Never),
            _ => None,
        }
    }
}

/// Custom field type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum FieldType {
    Text = 0,
    Hidden = 1,
    Boolean = 2,
}

impl FieldType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Text),
            1 => Some(Self::Hidden),
            2 => Some(Self::Boolean),
            _ => None,
        }
    }
}

/// Organization user type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum OrgUserType {
    Owner = 0,
    Admin = 1,
    User = 2,
    Manager = 3,
    Custom = 4,
}

/// Organization user status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(i8)]
pub enum OrgUserStatus {
    Revoked = -1,
    Invited = 0,
    Accepted = 1,
    Confirmed = 2,
}

// ── Vault data models ───────────────────────────────────────────────

/// A login URI entry attached to a login item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginUri {
    pub uri: Option<String>,
    #[serde(rename = "match")]
    pub match_type: Option<u8>,
}

impl LoginUri {
    pub fn new(uri: &str) -> Self {
        Self { uri: Some(uri.to_string()), match_type: None }
    }

    pub fn with_match(uri: &str, match_type: UriMatchType) -> Self {
        Self { uri: Some(uri.to_string()), match_type: Some(match_type as u8) }
    }
}

/// Login item data.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoginData {
    pub uris: Option<Vec<LoginUri>>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub totp: Option<String>,
    #[serde(default)]
    pub password_revision_date: Option<String>,
}

/// Secure note data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureNoteData {
    #[serde(rename = "type")]
    pub note_type: u8,
}

impl Default for SecureNoteData {
    fn default() -> Self {
        Self { note_type: 0 }
    }
}

/// Card (credit/debit) item data.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CardData {
    pub cardholder_name: Option<String>,
    pub brand: Option<String>,
    pub number: Option<String>,
    pub exp_month: Option<String>,
    pub exp_year: Option<String>,
    pub code: Option<String>,
}

/// Identity item data.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IdentityData {
    pub title: Option<String>,
    pub first_name: Option<String>,
    pub middle_name: Option<String>,
    pub last_name: Option<String>,
    pub address1: Option<String>,
    pub address2: Option<String>,
    pub address3: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub company: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub ssn: Option<String>,
    pub username: Option<String>,
    pub passport_number: Option<String>,
    pub license_number: Option<String>,
}

/// A custom field on a vault item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomField {
    pub name: Option<String>,
    pub value: Option<String>,
    #[serde(rename = "type")]
    pub field_type: u8,
    #[serde(default)]
    pub linked_id: Option<u32>,
}

impl CustomField {
    pub fn text(name: &str, value: &str) -> Self {
        Self {
            name: Some(name.to_string()),
            value: Some(value.to_string()),
            field_type: FieldType::Text as u8,
            linked_id: None,
        }
    }

    pub fn hidden(name: &str, value: &str) -> Self {
        Self {
            name: Some(name.to_string()),
            value: Some(value.to_string()),
            field_type: FieldType::Hidden as u8,
            linked_id: None,
        }
    }

    pub fn boolean(name: &str, value: bool) -> Self {
        Self {
            name: Some(name.to_string()),
            value: Some(if value { "true" } else { "false" }.to_string()),
            field_type: FieldType::Boolean as u8,
            linked_id: None,
        }
    }
}

/// A Bitwarden vault item (cipher).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultItem {
    pub object: Option<String>,
    pub id: Option<String>,
    pub organization_id: Option<String>,
    pub folder_id: Option<String>,
    #[serde(rename = "type")]
    pub item_type: u8,
    pub reprompt: Option<u8>,
    pub name: String,
    pub notes: Option<String>,
    pub favorite: Option<bool>,
    pub login: Option<LoginData>,
    pub secure_note: Option<SecureNoteData>,
    pub card: Option<CardData>,
    pub identity: Option<IdentityData>,
    pub fields: Option<Vec<CustomField>>,
    pub collection_ids: Option<Vec<String>>,
    pub revision_date: Option<String>,
    pub creation_date: Option<String>,
    pub deleted_date: Option<String>,
}

impl VaultItem {
    /// Create a new login vault item.
    pub fn new_login(name: &str, username: &str, password: &str) -> Self {
        Self {
            object: Some("item".into()),
            id: None,
            organization_id: None,
            folder_id: None,
            item_type: ItemType::Login as u8,
            reprompt: Some(0),
            name: name.to_string(),
            notes: None,
            favorite: Some(false),
            login: Some(LoginData {
                uris: None,
                username: Some(username.to_string()),
                password: Some(password.to_string()),
                totp: None,
                password_revision_date: None,
            }),
            secure_note: None,
            card: None,
            identity: None,
            fields: None,
            collection_ids: None,
            revision_date: None,
            creation_date: None,
            deleted_date: None,
        }
    }

    /// Create a new login with a URI.
    pub fn new_login_with_uri(name: &str, username: &str, password: &str, uri: &str) -> Self {
        let mut item = Self::new_login(name, username, password);
        if let Some(ref mut login) = item.login {
            login.uris = Some(vec![LoginUri::new(uri)]);
        }
        item
    }

    /// Create a new secure note.
    pub fn new_secure_note(name: &str, notes: &str) -> Self {
        Self {
            object: Some("item".into()),
            id: None,
            organization_id: None,
            folder_id: None,
            item_type: ItemType::SecureNote as u8,
            reprompt: Some(0),
            name: name.to_string(),
            notes: Some(notes.to_string()),
            favorite: Some(false),
            login: None,
            secure_note: Some(SecureNoteData::default()),
            card: None,
            identity: None,
            fields: None,
            collection_ids: None,
            revision_date: None,
            creation_date: None,
            deleted_date: None,
        }
    }

    /// Create a new card item.
    pub fn new_card(name: &str, card: CardData) -> Self {
        Self {
            object: Some("item".into()),
            id: None,
            organization_id: None,
            folder_id: None,
            item_type: ItemType::Card as u8,
            reprompt: Some(0),
            name: name.to_string(),
            notes: None,
            favorite: Some(false),
            login: None,
            secure_note: None,
            card: Some(card),
            identity: None,
            fields: None,
            collection_ids: None,
            revision_date: None,
            creation_date: None,
            deleted_date: None,
        }
    }

    /// Create a new identity item.
    pub fn new_identity(name: &str, identity: IdentityData) -> Self {
        Self {
            object: Some("item".into()),
            id: None,
            organization_id: None,
            folder_id: None,
            item_type: ItemType::Identity as u8,
            reprompt: Some(0),
            name: name.to_string(),
            notes: None,
            favorite: Some(false),
            login: None,
            secure_note: None,
            card: None,
            identity: Some(identity),
            fields: None,
            collection_ids: None,
            revision_date: None,
            creation_date: None,
            deleted_date: None,
        }
    }

    /// Get the parsed item type.
    pub fn parsed_type(&self) -> Option<ItemType> {
        ItemType::from_u8(self.item_type)
    }

    /// Check if this is a login item.
    pub fn is_login(&self) -> bool {
        self.item_type == ItemType::Login as u8
    }

    /// Check if this is a secure note.
    pub fn is_secure_note(&self) -> bool {
        self.item_type == ItemType::SecureNote as u8
    }

    /// Check if this item is in the trash.
    pub fn is_deleted(&self) -> bool {
        self.deleted_date.is_some()
    }

    /// Get the username from a login item (if applicable).
    pub fn username(&self) -> Option<&str> {
        self.login.as_ref()?.username.as_deref()
    }

    /// Get the password from a login item (if applicable).
    pub fn password(&self) -> Option<&str> {
        self.login.as_ref()?.password.as_deref()
    }

    /// Get the first URI from a login item (if applicable).
    pub fn first_uri(&self) -> Option<&str> {
        self.login.as_ref()?.uris.as_ref()?.first()?.uri.as_deref()
    }

    /// Get the TOTP seed from a login item (if applicable).
    pub fn totp(&self) -> Option<&str> {
        self.login.as_ref()?.totp.as_deref()
    }

    /// Add a custom field by merging into existing fields.
    pub fn add_field(&mut self, field: CustomField) {
        self.fields.get_or_insert_with(Vec::new).push(field);
    }
}

/// A Bitwarden folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub object: Option<String>,
    pub id: Option<String>,
    pub name: String,
}

impl Folder {
    pub fn new(name: &str) -> Self {
        Self { object: Some("folder".into()), id: None, name: name.to_string() }
    }
}

/// A Bitwarden collection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub object: Option<String>,
    pub id: Option<String>,
    pub organization_id: Option<String>,
    pub name: String,
    pub external_id: Option<String>,
}

/// A Bitwarden organization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Organization {
    pub object: Option<String>,
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub status: Option<u8>,
    #[serde(rename = "type")]
    pub org_type: Option<u8>,
    pub enabled: Option<bool>,
}

/// An organization member.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgMember {
    pub object: Option<String>,
    pub id: Option<String>,
    pub user_id: Option<String>,
    pub name: Option<String>,
    pub email: Option<String>,
    #[serde(rename = "type")]
    pub member_type: Option<u8>,
    pub status: Option<i8>,
    pub two_factor_enabled: Option<bool>,
}

/// Bitwarden Send object.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Send {
    pub object: Option<String>,
    pub id: Option<String>,
    pub access_id: Option<String>,
    pub name: String,
    pub notes: Option<String>,
    #[serde(rename = "type")]
    pub send_type: u8,
    pub text: Option<SendText>,
    pub file: Option<SendFile>,
    pub max_access_count: Option<u32>,
    pub access_count: Option<u32>,
    pub password: Option<String>,
    pub disabled: Option<bool>,
    pub revision_date: Option<String>,
    pub expiration_date: Option<String>,
    pub deletion_date: Option<String>,
    pub hide_email: Option<bool>,
}

/// Send text content.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendText {
    pub text: Option<String>,
    pub hidden: Option<bool>,
}

/// Send file content.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendFile {
    pub id: Option<String>,
    pub file_name: Option<String>,
    pub size: Option<String>,
    pub size_name: Option<String>,
}

// ── Configuration ───────────────────────────────────────────────────

/// Configuration for connecting to Bitwarden.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitwardenConfig {
    /// Path to the `bw` CLI executable. If None, assume it's in PATH.
    #[serde(default)]
    pub cli_path: Option<String>,

    /// Server URL (cloud or self-hosted).
    #[serde(default = "default_server_url")]
    pub server_url: String,

    /// Identity endpoint URL.
    #[serde(default = "default_identity_url")]
    pub identity_url: String,

    /// API endpoint URL (for Public API / organization management).
    #[serde(default = "default_api_url")]
    pub api_url: String,

    /// Port for `bw serve` local API.
    #[serde(default = "default_serve_port")]
    pub serve_port: u16,

    /// Hostname for `bw serve` binding.
    #[serde(default = "default_serve_hostname")]
    pub serve_hostname: String,

    /// Use self-hosted server.
    #[serde(default)]
    pub self_hosted: bool,

    /// Timeout in seconds for CLI operations.
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,

    /// Auto-sync interval in seconds (0 = disabled).
    #[serde(default)]
    pub auto_sync_interval_secs: u64,

    /// Whether to auto-lock after idle.
    #[serde(default)]
    pub auto_lock: bool,

    /// Auto-lock timeout in seconds.
    #[serde(default = "default_auto_lock_timeout")]
    pub auto_lock_timeout_secs: u64,
}

fn default_server_url() -> String { "https://vault.bitwarden.com".into() }
fn default_identity_url() -> String { "https://identity.bitwarden.com".into() }
fn default_api_url() -> String { "https://api.bitwarden.com".into() }
fn default_serve_port() -> u16 { 8087 }
fn default_serve_hostname() -> String { "localhost".into() }
fn default_timeout() -> u64 { 30 }
fn default_auto_lock_timeout() -> u64 { 900 }

impl Default for BitwardenConfig {
    fn default() -> Self {
        Self {
            cli_path: None,
            server_url: default_server_url(),
            identity_url: default_identity_url(),
            api_url: default_api_url(),
            serve_port: default_serve_port(),
            serve_hostname: default_serve_hostname(),
            self_hosted: false,
            timeout_secs: default_timeout(),
            auto_sync_interval_secs: 0,
            auto_lock: false,
            auto_lock_timeout_secs: default_auto_lock_timeout(),
        }
    }
}

impl BitwardenConfig {
    /// Create config for EU cloud.
    pub fn eu_cloud() -> Self {
        Self {
            server_url: "https://vault.bitwarden.eu".into(),
            identity_url: "https://identity.bitwarden.eu".into(),
            api_url: "https://api.bitwarden.eu".into(),
            ..Default::default()
        }
    }

    /// Create config for a self-hosted instance.
    pub fn self_hosted(base_url: &str) -> Self {
        let base = base_url.trim_end_matches('/');
        Self {
            server_url: base.to_string(),
            identity_url: format!("{}/identity", base),
            api_url: format!("{}/api", base),
            self_hosted: true,
            ..Default::default()
        }
    }

    /// Get the `bw serve` base URL.
    pub fn serve_base_url(&self) -> String {
        format!("http://{}:{}", self.serve_hostname, self.serve_port)
    }
}

// ── Session / auth state ───────────────────────────────────────────

/// Authentication method.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthMethod {
    /// Email + master password.
    EmailPassword { email: String },
    /// Personal API key (client_id + client_secret).
    ApiKey { client_id: String },
    /// SSO.
    Sso,
}

/// Vault lock status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VaultStatus {
    Unauthenticated,
    Locked,
    Unlocked,
}

impl fmt::Display for VaultStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unauthenticated => write!(f, "unauthenticated"),
            Self::Locked => write!(f, "locked"),
            Self::Unlocked => write!(f, "unlocked"),
        }
    }
}

impl VaultStatus {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "unlocked" => Self::Unlocked,
            "locked" => Self::Locked,
            _ => Self::Unauthenticated,
        }
    }
}

/// Status response from `bw status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusInfo {
    pub server_url: Option<String>,
    pub last_sync: Option<String>,
    pub user_email: Option<String>,
    pub user_id: Option<String>,
    pub status: String,
}

impl StatusInfo {
    pub fn vault_status(&self) -> VaultStatus {
        VaultStatus::from_str(&self.status)
    }

    pub fn is_unlocked(&self) -> bool {
        self.vault_status() == VaultStatus::Unlocked
    }
}

/// A session key + metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    /// The BW_SESSION key (base64-encoded).
    pub session_key: Option<String>,
    /// Current vault status.
    pub status: VaultStatus,
    /// Authenticated user email.
    pub user_email: Option<String>,
    /// Authenticated user ID.
    pub user_id: Option<String>,
    /// Server URL this session is connected to.
    pub server_url: Option<String>,
    /// Timestamp of last sync.
    pub last_sync: Option<DateTime<Utc>>,
    /// Auth method used.
    pub auth_method: Option<AuthMethod>,
    /// When this session was created.
    pub created_at: DateTime<Utc>,
    /// When last activity occurred.
    pub last_activity: DateTime<Utc>,
}

impl Default for SessionState {
    fn default() -> Self {
        let now = Utc::now();
        Self {
            session_key: None,
            status: VaultStatus::Unauthenticated,
            user_email: None,
            user_id: None,
            server_url: None,
            last_sync: None,
            auth_method: None,
            created_at: now,
            last_activity: now,
        }
    }
}

impl SessionState {
    pub fn is_unlocked(&self) -> bool {
        self.status == VaultStatus::Unlocked && self.session_key.is_some()
    }

    pub fn is_authenticated(&self) -> bool {
        self.status != VaultStatus::Unauthenticated
    }

    pub fn touch(&mut self) {
        self.last_activity = Utc::now();
    }
}

// ── List response wrapper ──────────────────────────────────────────

/// Bitwarden list response from the API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse<T> {
    pub object: Option<String>,
    pub data: Vec<T>,
    pub continuation_token: Option<String>,
}

/// Generic API response with success/error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub message: Option<String>,
}

// ── Password generation options ────────────────────────────────────

/// Options for generating a password.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordGenerateOptions {
    pub length: u32,
    pub uppercase: bool,
    pub lowercase: bool,
    pub numbers: bool,
    pub special: bool,
    /// Generate a passphrase instead of a password.
    pub passphrase: bool,
    /// Number of words (for passphrases).
    pub words: Option<u32>,
    /// Separator character (for passphrases).
    pub separator: Option<String>,
    /// Capitalize words (for passphrases).
    pub capitalize: bool,
    /// Include a number in the passphrase.
    pub include_number: bool,
}

impl Default for PasswordGenerateOptions {
    fn default() -> Self {
        Self {
            length: 20,
            uppercase: true,
            lowercase: true,
            numbers: true,
            special: true,
            passphrase: false,
            words: None,
            separator: None,
            capitalize: false,
            include_number: false,
        }
    }
}

impl PasswordGenerateOptions {
    /// Simple strong password (20 chars, all char classes).
    pub fn strong() -> Self {
        Self { length: 24, ..Default::default() }
    }

    /// Passphrase with defaults.
    pub fn passphrase(words: u32) -> Self {
        Self {
            passphrase: true,
            words: Some(words),
            separator: Some("-".into()),
            capitalize: true,
            include_number: true,
            ..Default::default()
        }
    }
}

// ── Export / import formats ─────────────────────────────────────────

/// Supported export formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExportFormat {
    Csv,
    Json,
    EncryptedJson,
}

impl ExportFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Json => "json",
            Self::EncryptedJson => "encrypted_json",
        }
    }
}

/// Supported import format identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImportFormat {
    BitwardenCsv,
    BitwardenJson,
    LastPassCsv,
    KeePassXCsv,
    KeePassXml,
    ChromeCsv,
    FirefoxCsv,
    OnePasswordCsv,
    OnePassword1Pux,
    DashlaneCsv,
    EnpassCsv,
    SafeInCloudXml,
    PasswordSafeCsv,
}

impl ImportFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::BitwardenCsv => "bitwardencsv",
            Self::BitwardenJson => "bitwardenjson",
            Self::LastPassCsv => "lastpasscsv",
            Self::KeePassXCsv => "keepassxcsv",
            Self::KeePassXml => "keepassxml",
            Self::ChromeCsv => "chromecsv",
            Self::FirefoxCsv => "firefoxcsv",
            Self::OnePasswordCsv => "1passwordcsv",
            Self::OnePassword1Pux => "1password1pux",
            Self::DashlaneCsv => "dashlanecsv",
            Self::EnpassCsv => "enpasscsv",
            Self::SafeInCloudXml => "safeincloudxml",
            Self::PasswordSafeCsv => "passwordsafecsv",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::BitwardenCsv => "Bitwarden (CSV)",
            Self::BitwardenJson => "Bitwarden (JSON)",
            Self::LastPassCsv => "LastPass (CSV)",
            Self::KeePassXCsv => "KeePassX (CSV)",
            Self::KeePassXml => "KeePass (XML)",
            Self::ChromeCsv => "Chrome/Chromium (CSV)",
            Self::FirefoxCsv => "Firefox (CSV)",
            Self::OnePasswordCsv => "1Password (CSV)",
            Self::OnePassword1Pux => "1Password (1PUX)",
            Self::DashlaneCsv => "Dashlane (CSV)",
            Self::EnpassCsv => "Enpass (CSV)",
            Self::SafeInCloudXml => "SafeInCloud (XML)",
            Self::PasswordSafeCsv => "PasswordSafe (CSV)",
        }
    }
}

/// Credential match result for autofill lookups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialMatch {
    pub item_id: String,
    pub item_name: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub totp: Option<String>,
    pub uri: Option<String>,
    pub score: f64,
}

/// Statistics about the vault.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VaultStats {
    pub total_items: usize,
    pub login_count: usize,
    pub note_count: usize,
    pub card_count: usize,
    pub identity_count: usize,
    pub folder_count: usize,
    pub collection_count: usize,
    pub organization_count: usize,
    pub trashed_count: usize,
    pub favorite_count: usize,
    pub items_with_totp: usize,
    pub items_with_attachments: usize,
    pub weak_passwords: usize,
    pub reused_passwords: usize,
    pub exposed_passwords: usize,
}

/// Bearer token response from Bitwarden identity server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BearerToken {
    pub access_token: String,
    pub expires_in: u64,
    pub token_type: String,
    #[serde(default)]
    pub scope: Option<String>,
}

impl BearerToken {
    /// Check if the token is still valid given its creation time.
    pub fn is_expired(&self, created_at: DateTime<Utc>) -> bool {
        let elapsed = (Utc::now() - created_at).num_seconds() as u64;
        elapsed >= self.expires_in
    }
}

/// Password health / breach report for a single item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordHealthReport {
    pub item_id: String,
    pub item_name: String,
    pub exposed_count: Option<u64>,
    pub is_weak: bool,
    pub is_reused: bool,
    pub password_age_days: Option<u64>,
}

/// Event log entry from the Public API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventLogEntry {
    pub object: Option<String>,
    #[serde(rename = "type")]
    pub event_type: u32,
    pub item_id: Option<String>,
    pub collection_id: Option<String>,
    pub group_id: Option<String>,
    pub policy_id: Option<String>,
    pub member_id: Option<String>,
    pub acting_user_id: Option<String>,
    pub date: Option<String>,
    pub device: Option<u32>,
    pub ip_address: Option<String>,
}

// ── Attachment ──────────────────────────────────────────────────────

/// A vault item attachment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: Option<String>,
    pub file_name: Option<String>,
    pub size: Option<String>,
    pub size_name: Option<String>,
    pub url: Option<String>,
}

// ── Cache structures ────────────────────────────────────────────────

/// Local cache of vault data for fast lookups.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VaultCache {
    pub items: Vec<VaultItem>,
    pub folders: Vec<Folder>,
    pub collections: Vec<Collection>,
    pub organizations: Vec<Organization>,
    pub last_sync: Option<DateTime<Utc>>,
    /// URI → item ID index for fast credential lookups.
    #[serde(skip)]
    pub uri_index: HashMap<String, Vec<String>>,
}

impl VaultCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Rebuild the URI index from current items.
    pub fn rebuild_uri_index(&mut self) {
        self.uri_index.clear();
        for item in &self.items {
            if let Some(ref id) = item.id {
                if let Some(ref login) = item.login {
                    if let Some(ref uris) = login.uris {
                        for login_uri in uris {
                            if let Some(ref uri) = login_uri.uri {
                                let normalized = normalize_uri(uri);
                                self.uri_index
                                    .entry(normalized)
                                    .or_default()
                                    .push(id.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    /// Find items matching a URI.
    pub fn find_by_uri(&self, uri: &str) -> Vec<&VaultItem> {
        let normalized = normalize_uri(uri);
        let ids = self.uri_index.get(&normalized);
        match ids {
            Some(ids) => self.items.iter()
                .filter(|item| item.id.as_ref().map_or(false, |id| ids.contains(id)))
                .collect(),
            None => Vec::new(),
        }
    }

    /// Find items by name (case-insensitive substring).
    pub fn find_by_name(&self, query: &str) -> Vec<&VaultItem> {
        let q = query.to_lowercase();
        self.items.iter()
            .filter(|item| item.name.to_lowercase().contains(&q))
            .collect()
    }

    /// Get an item by its ID.
    pub fn get_by_id(&self, id: &str) -> Option<&VaultItem> {
        self.items.iter().find(|item| item.id.as_deref() == Some(id))
    }

    /// Get items by folder ID.
    pub fn get_by_folder(&self, folder_id: &str) -> Vec<&VaultItem> {
        self.items.iter()
            .filter(|item| item.folder_id.as_deref() == Some(folder_id))
            .collect()
    }

    /// Get items by collection ID.
    pub fn get_by_collection(&self, collection_id: &str) -> Vec<&VaultItem> {
        self.items.iter()
            .filter(|item| {
                item.collection_ids.as_ref()
                    .map_or(false, |ids| ids.contains(&collection_id.to_string()))
            })
            .collect()
    }

    /// Compute vault statistics.
    pub fn stats(&self) -> VaultStats {
        let mut stats = VaultStats {
            total_items: self.items.len(),
            folder_count: self.folders.len(),
            collection_count: self.collections.len(),
            organization_count: self.organizations.len(),
            ..Default::default()
        };

        let mut passwords: HashMap<String, usize> = HashMap::new();

        for item in &self.items {
            if item.is_deleted() {
                stats.trashed_count += 1;
                continue;
            }
            if item.favorite == Some(true) {
                stats.favorite_count += 1;
            }
            match ItemType::from_u8(item.item_type) {
                Some(ItemType::Login) => {
                    stats.login_count += 1;
                    if item.totp().is_some() {
                        stats.items_with_totp += 1;
                    }
                    if let Some(pw) = item.password() {
                        *passwords.entry(pw.to_string()).or_insert(0) += 1;
                        if pw.len() < 8 {
                            stats.weak_passwords += 1;
                        }
                    }
                }
                Some(ItemType::SecureNote) => stats.note_count += 1,
                Some(ItemType::Card) => stats.card_count += 1,
                Some(ItemType::Identity) => stats.identity_count += 1,
                _ => {}
            }
        }

        stats.reused_passwords = passwords.values().filter(|&&count| count > 1).count();
        stats
    }
}

/// Normalize a URI for matching (strip protocol, trailing slash, www.).
fn normalize_uri(uri: &str) -> String {
    let s = uri.to_lowercase();
    let s = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(&s);
    let s = s.strip_prefix("www.").unwrap_or(s);
    s.trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── ItemType ────────────────────────────────────────────────────

    #[test]
    fn item_type_from_u8_valid() {
        assert_eq!(ItemType::from_u8(1), Some(ItemType::Login));
        assert_eq!(ItemType::from_u8(2), Some(ItemType::SecureNote));
        assert_eq!(ItemType::from_u8(3), Some(ItemType::Card));
        assert_eq!(ItemType::from_u8(4), Some(ItemType::Identity));
        assert_eq!(ItemType::from_u8(5), Some(ItemType::SshKey));
    }

    #[test]
    fn item_type_from_u8_invalid() {
        assert_eq!(ItemType::from_u8(0), None);
        assert_eq!(ItemType::from_u8(6), None);
        assert_eq!(ItemType::from_u8(255), None);
    }

    #[test]
    fn item_type_display() {
        assert_eq!(ItemType::Login.name(), "Login");
        assert_eq!(ItemType::SecureNote.name(), "Secure Note");
    }

    // ── VaultItem constructors ──────────────────────────────────────

    #[test]
    fn new_login_item() {
        let item = VaultItem::new_login("GitHub", "user", "pass123");
        assert_eq!(item.name, "GitHub");
        assert_eq!(item.item_type, 1);
        assert!(item.is_login());
        assert!(!item.is_secure_note());
        assert_eq!(item.username(), Some("user"));
        assert_eq!(item.password(), Some("pass123"));
        assert_eq!(item.first_uri(), None);
    }

    #[test]
    fn new_login_with_uri() {
        let item = VaultItem::new_login_with_uri("GH", "u", "p", "https://github.com");
        assert_eq!(item.first_uri(), Some("https://github.com"));
    }

    #[test]
    fn new_secure_note() {
        let item = VaultItem::new_secure_note("Secret", "my secret data");
        assert!(item.is_secure_note());
        assert_eq!(item.notes, Some("my secret data".into()));
    }

    #[test]
    fn new_card_item() {
        let card = CardData {
            cardholder_name: Some("John Doe".into()),
            brand: Some("Visa".into()),
            number: Some("4111111111111111".into()),
            exp_month: Some("12".into()),
            exp_year: Some("2028".into()),
            code: Some("123".into()),
        };
        let item = VaultItem::new_card("My Visa", card);
        assert_eq!(item.item_type, ItemType::Card as u8);
        assert!(item.card.is_some());
    }

    #[test]
    fn new_identity_item() {
        let identity = IdentityData {
            first_name: Some("John".into()),
            last_name: Some("Doe".into()),
            email: Some("john@example.com".into()),
            ..Default::default()
        };
        let item = VaultItem::new_identity("My ID", identity);
        assert_eq!(item.item_type, ItemType::Identity as u8);
    }

    #[test]
    fn add_custom_fields() {
        let mut item = VaultItem::new_login("Test", "u", "p");
        item.add_field(CustomField::text("env", "production"));
        item.add_field(CustomField::hidden("api_key", "secret123"));
        item.add_field(CustomField::boolean("is_admin", true));
        assert_eq!(item.fields.as_ref().unwrap().len(), 3);
    }

    #[test]
    fn vault_item_is_deleted() {
        let mut item = VaultItem::new_login("Test", "u", "p");
        assert!(!item.is_deleted());
        item.deleted_date = Some("2024-01-01T00:00:00Z".into());
        assert!(item.is_deleted());
    }

    // ── LoginUri ────────────────────────────────────────────────────

    #[test]
    fn login_uri_new() {
        let uri = LoginUri::new("https://example.com");
        assert_eq!(uri.uri, Some("https://example.com".into()));
        assert_eq!(uri.match_type, None);
    }

    #[test]
    fn login_uri_with_match() {
        let uri = LoginUri::with_match("https://example.com", UriMatchType::Exact);
        assert_eq!(uri.match_type, Some(3));
    }

    // ── Folder / Collection ─────────────────────────────────────────

    #[test]
    fn folder_new() {
        let f = Folder::new("Test Folder");
        assert_eq!(f.name, "Test Folder");
        assert_eq!(f.object, Some("folder".into()));
    }

    // ── BitwardenConfig ─────────────────────────────────────────────

    #[test]
    fn config_default() {
        let c = BitwardenConfig::default();
        assert_eq!(c.server_url, "https://vault.bitwarden.com");
        assert_eq!(c.serve_port, 8087);
        assert!(!c.self_hosted);
    }

    #[test]
    fn config_eu_cloud() {
        let c = BitwardenConfig::eu_cloud();
        assert!(c.server_url.contains("bitwarden.eu"));
        assert!(c.identity_url.contains("bitwarden.eu"));
    }

    #[test]
    fn config_self_hosted() {
        let c = BitwardenConfig::self_hosted("https://bw.example.com");
        assert_eq!(c.server_url, "https://bw.example.com");
        assert_eq!(c.identity_url, "https://bw.example.com/identity");
        assert_eq!(c.api_url, "https://bw.example.com/api");
        assert!(c.self_hosted);
    }

    #[test]
    fn config_serve_base_url() {
        let c = BitwardenConfig::default();
        assert_eq!(c.serve_base_url(), "http://localhost:8087");
    }

    // ── VaultStatus ─────────────────────────────────────────────────

    #[test]
    fn vault_status_from_str() {
        assert_eq!(VaultStatus::from_str("unlocked"), VaultStatus::Unlocked);
        assert_eq!(VaultStatus::from_str("locked"), VaultStatus::Locked);
        assert_eq!(VaultStatus::from_str("unauthenticated"), VaultStatus::Unauthenticated);
        assert_eq!(VaultStatus::from_str("UNLOCKED"), VaultStatus::Unlocked);
        assert_eq!(VaultStatus::from_str("something_else"), VaultStatus::Unauthenticated);
    }

    // ── SessionState ────────────────────────────────────────────────

    #[test]
    fn session_state_default() {
        let s = SessionState::default();
        assert_eq!(s.status, VaultStatus::Unauthenticated);
        assert!(!s.is_unlocked());
        assert!(!s.is_authenticated());
    }

    #[test]
    fn session_state_unlocked() {
        let mut s = SessionState::default();
        s.status = VaultStatus::Unlocked;
        s.session_key = Some("test_key".into());
        assert!(s.is_unlocked());
        assert!(s.is_authenticated());
    }

    // ── PasswordGenerateOptions ────────────────────────────────────

    #[test]
    fn password_options_default() {
        let opts = PasswordGenerateOptions::default();
        assert_eq!(opts.length, 20);
        assert!(opts.uppercase);
        assert!(!opts.passphrase);
    }

    #[test]
    fn password_options_strong() {
        let opts = PasswordGenerateOptions::strong();
        assert_eq!(opts.length, 24);
    }

    #[test]
    fn password_options_passphrase() {
        let opts = PasswordGenerateOptions::passphrase(5);
        assert!(opts.passphrase);
        assert_eq!(opts.words, Some(5));
        assert!(opts.capitalize);
    }

    // ── ExportFormat / ImportFormat ──────────────────────────────────

    #[test]
    fn export_format_as_str() {
        assert_eq!(ExportFormat::Csv.as_str(), "csv");
        assert_eq!(ExportFormat::Json.as_str(), "json");
        assert_eq!(ExportFormat::EncryptedJson.as_str(), "encrypted_json");
    }

    #[test]
    fn import_format_as_str() {
        assert_eq!(ImportFormat::LastPassCsv.as_str(), "lastpasscsv");
        assert_eq!(ImportFormat::ChromeCsv.as_str(), "chromecsv");
        assert_eq!(ImportFormat::OnePassword1Pux.as_str(), "1password1pux");
    }

    // ── normalize_uri ───────────────────────────────────────────────

    #[test]
    fn normalize_uri_strips_protocol() {
        assert_eq!(normalize_uri("https://github.com"), "github.com");
        assert_eq!(normalize_uri("http://github.com"), "github.com");
    }

    #[test]
    fn normalize_uri_strips_www() {
        assert_eq!(normalize_uri("https://www.github.com"), "github.com");
    }

    #[test]
    fn normalize_uri_strips_trailing_slash() {
        assert_eq!(normalize_uri("https://github.com/"), "github.com");
    }

    #[test]
    fn normalize_uri_lowercases() {
        assert_eq!(normalize_uri("https://GitHub.Com"), "github.com");
    }

    // ── VaultCache ──────────────────────────────────────────────────

    #[test]
    fn vault_cache_empty() {
        let cache = VaultCache::new();
        assert_eq!(cache.items.len(), 0);
        assert_eq!(cache.folders.len(), 0);
    }

    #[test]
    fn vault_cache_find_by_name() {
        let mut cache = VaultCache::new();
        let mut item = VaultItem::new_login("GitHub", "user", "pass");
        item.id = Some("id1".into());
        cache.items.push(item);
        cache.items.push(VaultItem::new_login("GitLab", "u", "p"));

        let results = cache.find_by_name("github");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "GitHub");
    }

    #[test]
    fn vault_cache_find_by_uri() {
        let mut cache = VaultCache::new();
        let mut item = VaultItem::new_login_with_uri("GH", "u", "p", "https://github.com");
        item.id = Some("id1".into());
        cache.items.push(item);
        cache.rebuild_uri_index();

        let results = cache.find_by_uri("https://github.com");
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn vault_cache_get_by_id() {
        let mut cache = VaultCache::new();
        let mut item = VaultItem::new_login("Test", "u", "p");
        item.id = Some("abc".into());
        cache.items.push(item);
        assert!(cache.get_by_id("abc").is_some());
        assert!(cache.get_by_id("xyz").is_none());
    }

    #[test]
    fn vault_cache_stats() {
        let mut cache = VaultCache::new();
        cache.items.push(VaultItem::new_login("L1", "u1", "pass1"));
        cache.items.push(VaultItem::new_login("L2", "u2", "pass1")); // reused pw
        cache.items.push(VaultItem::new_secure_note("N1", "notes"));
        cache.folders.push(Folder::new("F1"));

        let stats = cache.stats();
        assert_eq!(stats.total_items, 3);
        assert_eq!(stats.login_count, 2);
        assert_eq!(stats.note_count, 1);
        assert_eq!(stats.folder_count, 1);
        assert_eq!(stats.reused_passwords, 1);
    }

    // ── CustomField ─────────────────────────────────────────────────

    #[test]
    fn custom_field_text() {
        let f = CustomField::text("key", "value");
        assert_eq!(f.field_type, 0);
        assert_eq!(f.name, Some("key".into()));
    }

    #[test]
    fn custom_field_hidden() {
        let f = CustomField::hidden("secret", "val");
        assert_eq!(f.field_type, 1);
    }

    #[test]
    fn custom_field_boolean() {
        let f = CustomField::boolean("flag", true);
        assert_eq!(f.field_type, 2);
        assert_eq!(f.value, Some("true".into()));
    }

    // ── Serialization roundtrip ─────────────────────────────────────

    #[test]
    fn vault_item_serialize_deserialize() {
        let item = VaultItem::new_login_with_uri("GitHub", "user", "pass", "https://github.com");
        let json = serde_json::to_string(&item).unwrap();
        let parsed: VaultItem = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "GitHub");
        assert_eq!(parsed.username(), Some("user"));
        assert_eq!(parsed.password(), Some("pass"));
    }

    #[test]
    fn folder_serialize_deserialize() {
        let folder = Folder::new("Test");
        let json = serde_json::to_string(&folder).unwrap();
        let parsed: Folder = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "Test");
    }

    #[test]
    fn config_serialize_deserialize() {
        let config = BitwardenConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: BitwardenConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.serve_port, 8087);
    }

    // ── UriMatchType / FieldType ────────────────────────────────────

    #[test]
    fn uri_match_type_values() {
        assert_eq!(UriMatchType::from_u8(0), Some(UriMatchType::Domain));
        assert_eq!(UriMatchType::from_u8(5), Some(UriMatchType::Never));
        assert_eq!(UriMatchType::from_u8(6), None);
    }

    #[test]
    fn field_type_values() {
        assert_eq!(FieldType::from_u8(0), Some(FieldType::Text));
        assert_eq!(FieldType::from_u8(1), Some(FieldType::Hidden));
        assert_eq!(FieldType::from_u8(2), Some(FieldType::Boolean));
        assert_eq!(FieldType::from_u8(3), None);
    }

    // ── TwoFactorMethod ─────────────────────────────────────────────

    #[test]
    fn two_factor_method_values() {
        assert_eq!(TwoFactorMethod::from_u8(0), Some(TwoFactorMethod::Authenticator));
        assert_eq!(TwoFactorMethod::from_u8(1), Some(TwoFactorMethod::Email));
        assert_eq!(TwoFactorMethod::from_u8(3), Some(TwoFactorMethod::YubiKey));
        assert_eq!(TwoFactorMethod::from_u8(2), None); // No Duo/FIDO2 in CLI
    }

    // ── BearerToken ─────────────────────────────────────────────────

    #[test]
    fn bearer_token_expiry() {
        let token = BearerToken {
            access_token: "test".into(),
            expires_in: 3600,
            token_type: "Bearer".into(),
            scope: None,
        };
        assert!(!token.is_expired(Utc::now()));
        // Token created 2 hours ago
        let old = Utc::now() - chrono::Duration::hours(2);
        assert!(token.is_expired(old));
    }

    // ── PasswordHealthReport ────────────────────────────────────────

    #[test]
    fn password_health_report_serde() {
        let report = PasswordHealthReport {
            item_id: "id1".into(),
            item_name: "Test".into(),
            exposed_count: Some(5),
            is_weak: true,
            is_reused: false,
            password_age_days: Some(365),
        };
        let json = serde_json::to_string(&report).unwrap();
        let parsed: PasswordHealthReport = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.exposed_count, Some(5));
        assert!(parsed.is_weak);
    }
}
