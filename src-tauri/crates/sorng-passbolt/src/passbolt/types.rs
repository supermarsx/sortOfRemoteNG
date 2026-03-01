//! Core types for the Passbolt integration.
//!
//! Defines all data models matching the Passbolt API v5.0.0 response shapes,
//! configuration structures, error types, and supporting enumerations.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

// ── Error types ─────────────────────────────────────────────────────

/// Passbolt-specific error kinds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PassboltErrorKind {
    /// Authentication failed (bad credentials, expired token, GPG error).
    AuthFailed,
    /// Session expired or not authenticated.
    SessionExpired,
    /// MFA verification required before proceeding.
    MfaRequired,
    /// The requested item was not found (404).
    NotFound,
    /// Permission denied (403).
    Forbidden,
    /// Bad request (validation error from server).
    BadRequest,
    /// A network or HTTP request error.
    NetworkError,
    /// The Passbolt REST API returned an error.
    ApiError,
    /// JSON parsing or serialization failure.
    ParseError,
    /// OpenPGP encryption, decryption, or signing failure.
    CryptoError,
    /// Invalid configuration or arguments.
    InvalidConfig,
    /// Rate limited by the server.
    RateLimited,
    /// Operation timed out.
    Timeout,
    /// Generic I/O error.
    IoError,
    /// Conflict — entity was updated by another user.
    Conflict,
    /// Server-side error (5xx).
    ServerError,
}

/// A Passbolt integration error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassboltError {
    pub kind: PassboltErrorKind,
    pub message: String,
}

impl fmt::Display for PassboltError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for PassboltError {}

impl From<PassboltError> for String {
    fn from(e: PassboltError) -> String {
        e.message
    }
}

impl PassboltError {
    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::AuthFailed,
            message: msg.into(),
        }
    }
    pub fn session_expired(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::SessionExpired,
            message: msg.into(),
        }
    }
    pub fn mfa_required(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::MfaRequired,
            message: msg.into(),
        }
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::NotFound,
            message: msg.into(),
        }
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::Forbidden,
            message: msg.into(),
        }
    }
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::BadRequest,
            message: msg.into(),
        }
    }
    pub fn network(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::NetworkError,
            message: msg.into(),
        }
    }
    pub fn api(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::ApiError,
            message: msg.into(),
        }
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::ParseError,
            message: msg.into(),
        }
    }
    pub fn crypto(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::CryptoError,
            message: msg.into(),
        }
    }
    pub fn invalid_config(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::InvalidConfig,
            message: msg.into(),
        }
    }
    pub fn rate_limited(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::RateLimited,
            message: msg.into(),
        }
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::Timeout,
            message: msg.into(),
        }
    }
    pub fn io(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::IoError,
            message: msg.into(),
        }
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::Conflict,
            message: msg.into(),
        }
    }
    pub fn server(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::ServerError,
            message: msg.into(),
        }
    }
    pub fn encryption(msg: impl Into<String>) -> Self {
        Self {
            kind: PassboltErrorKind::CryptoError,
            message: msg.into(),
        }
    }
}

// ── Configuration ───────────────────────────────────────────────────

/// Passbolt connection and behaviour configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassboltConfig {
    /// Passbolt server base URL (e.g. `https://passbolt.example.com`).
    pub server_url: String,
    /// Whether to verify TLS certificates.
    pub verify_tls: bool,
    /// User's private key (armored PGP).
    pub user_private_key: Option<String>,
    /// Passphrase for the user's private key.
    pub user_passphrase: Option<String>,
    /// User's public key fingerprint.
    pub user_fingerprint: String,
    /// Preferred auth method.
    pub auth_method: AuthMethod,
    /// Request timeout in seconds.
    pub request_timeout_secs: u64,
    /// Max retries for transient failures.
    pub max_retries: u32,
    /// Enable local resource cache.
    pub cache_enabled: bool,
    /// Cache TTL in seconds.
    pub cache_ttl_secs: u64,
}

/// Supported authentication methods.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthMethod {
    /// GPGAuth cookie-based authentication (legacy).
    GpgAuth,
    /// JWT-based authentication (preferred).
    Jwt,
}

impl Default for PassboltConfig {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            verify_tls: true,
            user_private_key: None,
            user_passphrase: None,
            user_fingerprint: String::new(),
            auth_method: AuthMethod::Jwt,
            request_timeout_secs: 30,
            max_retries: 3,
            cache_enabled: true,
            cache_ttl_secs: 300,
        }
    }
}

// ── Session state ───────────────────────────────────────────────────

/// Current session state with the Passbolt server.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionState {
    /// Whether the user is authenticated.
    pub authenticated: bool,
    /// The authenticated user's UUID.
    pub user_id: Option<String>,
    /// JWT access token (if using JWT auth).
    pub access_token: Option<String>,
    /// JWT refresh token (if using JWT auth).
    pub refresh_token: Option<String>,
    /// CSRF token for cookie-based auth.
    pub csrf_token: Option<String>,
    /// Server's public PGP key (armored).
    pub server_public_key: Option<String>,
    /// Server key fingerprint.
    pub server_fingerprint: Option<String>,
    /// When the current token/session expires.
    pub expires_at: Option<DateTime<Utc>>,
    /// Whether MFA has been verified this session.
    pub mfa_verified: bool,
    /// MFA provider used.
    pub mfa_provider: Option<MfaProvider>,
}

/// MFA provider types.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum MfaProvider {
    Totp,
    Yubikey,
}

impl fmt::Display for MfaProvider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MfaProvider::Totp => write!(f, "totp"),
            MfaProvider::Yubikey => write!(f, "yubikey"),
        }
    }
}

// ── API response envelope ───────────────────────────────────────────

/// Passbolt standard API response wrapper.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub header: ApiResponseHeader,
    pub body: T,
}

/// API response header.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponseHeader {
    pub id: String,
    pub status: String,
    pub servertime: i64,
    pub action: String,
    pub message: String,
    pub url: String,
    pub code: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pagination: Option<Pagination>,
}

/// Pagination metadata returned in list endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pagination {
    pub count: u64,
    pub page: u64,
    pub limit: Option<u64>,
}

// ── Resources ───────────────────────────────────────────────────────

/// A Passbolt resource (password entry).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Resource {
    #[serde(default)]
    pub id: String,
    /// Encrypted metadata (PGP message) in v5, or plaintext name in v4.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
    /// Metadata key UUID (v5 format).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key_id: Option<String>,
    /// Metadata key type: "user_key" or "shared_key".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key_type: Option<String>,
    /// v4 plaintext name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// v4 plaintext username.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// v4 plaintext URI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    /// v4 plaintext description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
    #[serde(default)]
    pub created_by: String,
    #[serde(default)]
    pub modified_by: String,
    #[serde(default)]
    pub resource_type_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expired: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personal: Option<bool>,
    // ── Containable relations ───
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator: Option<Box<User>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modifier: Option<Box<User>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorite: Option<Favorite>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission: Option<Permission>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<Permission>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secrets: Option<Vec<Secret>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<Tag>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_type: Option<ResourceType>,
}

/// Payload for creating a resource (supports both v4 and v5 formats).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateResourceRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_type_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_parent_id: Option<String>,
    #[serde(default)]
    pub secrets: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key_type: Option<String>,
}

/// Payload for updating a resource.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateResourceRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_type_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secrets: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key_type: Option<String>,
}

/// Decrypted resource metadata (the plaintext inside the PGP envelope).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceMetadata {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_type_id: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// ── Resource types ──────────────────────────────────────────────────

/// Describes the schema for a resource and its secrets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceType {
    pub id: String,
    pub slug: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<serde_json::Value>,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
}

// ── Secrets ─────────────────────────────────────────────────────────

/// An encrypted secret associated with a resource.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Secret {
    pub id: String,
    pub user_id: String,
    pub resource_id: String,
    /// PGP-encrypted secret data.
    pub data: String,
    pub created: String,
    pub modified: String,
}

/// Decrypted secret content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecryptedSecret {
    pub password: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totp: Option<TotpConfig>,
    #[serde(flatten)]
    #[serde(default)]
    pub extras: HashMap<String, serde_json::Value>,
}

/// TOTP configuration stored within a secret.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotpConfig {
    pub secret_key: String,
    #[serde(default = "default_totp_digits")]
    pub digits: u8,
    #[serde(default = "default_totp_period")]
    pub period: u32,
    #[serde(default = "default_totp_algorithm")]
    pub algorithm: String,
}

fn default_totp_digits() -> u8 {
    6
}
fn default_totp_period() -> u32 {
    30
}
fn default_totp_algorithm() -> String {
    "SHA1".to_string()
}

impl Default for TotpConfig {
    fn default() -> Self {
        Self {
            secret_key: String::new(),
            digits: default_totp_digits(),
            period: default_totp_period(),
            algorithm: default_totp_algorithm(),
        }
    }
}

// ── Folders ─────────────────────────────────────────────────────────

/// A folder in the Passbolt hierarchy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key_type: Option<String>,
    pub created: String,
    pub modified: String,
    pub created_by: String,
    pub modified_by: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personal: Option<bool>,
    // ── Containable ───
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children_resources: Option<Vec<Resource>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children_folders: Option<Vec<Folder>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator: Option<Box<User>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modifier: Option<Box<User>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission: Option<Permission>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<Permission>>,
}

/// Payload for creating a folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_parent_id: Option<String>,
}

/// Payload for updating a folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateFolderRequest {
    pub metadata: String,
    pub metadata_key_id: String,
    pub metadata_key_type: String,
}

// ── Users ───────────────────────────────────────────────────────────

/// A Passbolt user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    #[serde(default)]
    pub role_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_mfa_enabled: Option<bool>,
    // ── Containable ───
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<UserProfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpgkey: Option<GpgKey>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<Role>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups_users: Option<Vec<GroupUser>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_logged_in: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_metadata_key_ids: Option<Vec<String>>,
}

/// User profile information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,
    pub user_id: String,
    pub first_name: String,
    pub last_name: String,
    pub created: String,
    pub modified: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar: Option<Avatar>,
}

/// Avatar metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Avatar {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<AvatarUrl>,
    pub created: String,
    pub modified: String,
}

/// Avatar URL variants.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvatarUrl {
    pub medium: String,
    pub small: String,
}

/// Create user request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub profile: CreateUserProfile,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_id: Option<String>,
}

/// Profile for user creation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserProfile {
    pub first_name: String,
    pub last_name: String,
}

/// Update user request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<CreateUserProfile>,
}

// ── GPG keys ────────────────────────────────────────────────────────

/// A stored GPG public key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpgKey {
    pub id: String,
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub armored_key: Option<String>,
    #[serde(default)]
    pub bits: u32,
    #[serde(default)]
    pub uid: String,
    #[serde(default)]
    pub key_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(rename = "type")]
    #[serde(default)]
    pub key_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
    #[serde(default)]
    pub key_created: String,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
}

// ── Groups ──────────────────────────────────────────────────────────

/// A group that users belong to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
    #[serde(default)]
    pub created_by: String,
    #[serde(default)]
    pub modified_by: String,
    // ── Containable ───
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups_users: Option<Vec<GroupUser>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub my_group_user: Option<GroupUser>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modifier: Option<Box<User>>,
}

/// Membership record linking a user to a group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupUser {
    pub id: String,
    pub group_id: String,
    pub user_id: String,
    pub is_admin: bool,
    pub created: String,
    // ── Containable ───
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<Box<User>>,
}

/// Create group request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    pub groups_users: Vec<GroupUserEntry>,
}

/// Entry for adding a user to a group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupUserEntry {
    pub user_id: String,
    pub is_admin: bool,
}

/// Update group request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateGroupRequest {
    pub name: String,
    pub groups_users: Vec<GroupUserChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secrets: Option<Vec<ShareSecret>>,
}

/// A group user change (add/update/delete).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupUserChange {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub user_id: String,
    pub is_admin: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete: Option<bool>,
}

/// Dry-run result for group operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupDryRunResult {
    #[serde(rename = "dry-run")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_run: Option<serde_json::Value>,
}

// ── Permissions & sharing ───────────────────────────────────────────

/// A permission record (ACL entry).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Permission {
    pub id: String,
    pub aco: String,
    pub aco_foreign_key: String,
    pub aro: String,
    pub aro_foreign_key: String,
    #[serde(rename = "type")]
    pub permission_type: i32,
    pub created: String,
    pub modified: String,
    // ── Containable ───
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<Box<User>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<Box<Group>>,
}

/// Permission type constants matching Passbolt ACL levels.
pub mod permission_types {
    /// Read-only access (1).
    pub const READ: i32 = 1;
    /// Can update the resource/folder (7).
    pub const UPDATE: i32 = 7;
    /// Owner — full control (15).
    pub const OWNER: i32 = 15;
}

/// Share/update-permissions request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<PermissionChange>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secrets: Option<Vec<ShareSecret>>,
}

/// A permission change entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionChange {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub aro: String,
    pub aro_foreign_key: String,
    #[serde(rename = "type")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_type: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete: Option<bool>,
}

/// Encrypted secret for sharing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareSecret {
    pub user_id: String,
    pub data: String,
}

/// Simulate-share result body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareSimulateResult {
    pub changes: serde_json::Value,
}

/// An ARO (Access Request Object) — user or group returned from share search.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Aro {
    User(Box<User>),
    Group(Box<Group>),
}

// ── Favorites ───────────────────────────────────────────────────────

/// A favorite bookmark.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Favorite {
    pub id: String,
    pub user_id: String,
    pub foreign_key: String,
    pub foreign_model: String,
    pub created: String,
    pub modified: String,
}

// ── Comments ────────────────────────────────────────────────────────

/// A comment on a resource.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub foreign_key: String,
    pub foreign_model: String,
    pub content: String,
    pub created: String,
    pub modified: String,
    pub created_by: String,
    pub modified_by: String,
    pub user_id: String,
    // ── Containable ───
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator: Option<Box<User>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modifier: Option<Box<User>>,
}

/// Create/update comment payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentPayload {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreign_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreign_model: Option<String>,
}

// ── Tags ────────────────────────────────────────────────────────────

/// A tag (personal or shared).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    #[serde(default)]
    pub id: String,
    /// Plaintext slug (v4) or encrypted metadata (v5).
    #[serde(default)]
    pub slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key_type: Option<String>,
    #[serde(default)]
    pub is_shared: bool,
}

/// Update tag request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTagRequest {
    pub slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_shared: Option<bool>,
}

/// Add tags to a resource.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddTagsRequest {
    pub tags: Vec<TagEntry>,
}

/// A tag entry when assigning tags to a resource.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagEntry {
    pub slug: String,
    pub is_shared: bool,
}

// ── Roles ───────────────────────────────────────────────────────────

/// A user role definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created: String,
    pub modified: String,
}

// ── Metadata keys ───────────────────────────────────────────────────

/// A metadata encryption key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataKey {
    pub id: String,
    pub fingerprint: String,
    pub armored_key: String,
    pub created: String,
    pub modified: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expired: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_private_keys: Option<Vec<MetadataPrivateKey>>,
}

/// Create metadata key request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMetadataKeyRequest {
    pub fingerprint: String,
    pub armored_key: String,
    pub metadata_private_keys: Vec<MetadataPrivateKeyEntry>,
}

/// Expire (update) metadata key request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateMetadataKeyRequest {
    pub fingerprint: String,
    pub armored_key: String,
    pub expired: String,
}

/// A metadata private key record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataPrivateKey {
    pub id: String,
    pub metadata_key_id: String,
    pub user_id: String,
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_by: Option<String>,
}

/// Entry for creating/sharing metadata private keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataPrivateKeyEntry {
    pub data: String,
    pub user_id: String,
    pub metadata_key_id: String,
}

/// Metadata key settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataKeySettings {
    pub allow_usage_of_personal_keys: bool,
    pub zero_knowledge_key_share: bool,
}

/// Update metadata key settings request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateMetadataKeySettingsRequest {
    pub allow_usage_of_personal_keys: bool,
    pub zero_knowledge_key_share: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_private_keys: Option<Vec<MetadataPrivateKeyEntry>>,
}

// ── Metadata types settings ─────────────────────────────────────────

/// Metadata types settings (v4/v5 format preferences).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataTypesSettings {
    pub default_resource_types: String,
    pub default_folder_type: String,
    pub default_tag_type: String,
    pub default_comment_type: String,
    pub allow_creation_of_v5_resources: bool,
    pub allow_creation_of_v5_folders: bool,
    pub allow_creation_of_v5_tags: bool,
    pub allow_creation_of_v5_comments: bool,
    pub allow_creation_of_v4_resources: bool,
    pub allow_creation_of_v4_folders: bool,
    pub allow_creation_of_v4_tags: bool,
    pub allow_creation_of_v4_comments: bool,
    pub allow_v5_v4_downgrade: bool,
    pub allow_v4_v5_upgrade: bool,
}

// ── Metadata session keys ───────────────────────────────────────────

/// A cached metadata session key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataSessionKey {
    pub id: String,
    pub user_id: String,
    pub data: String,
    pub created: String,
    pub modified: String,
}

/// Create session key request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSessionKeyRequest {
    pub data: String,
}

/// Update session key request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSessionKeyRequest {
    pub data: String,
    pub modified: String,
}

// ── Metadata rotation ───────────────────────────────────────────────

/// Entry for rotating expired metadata keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataRotateEntry {
    pub id: String,
    pub metadata: String,
    pub metadata_key_id: String,
    pub metadata_key_type: String,
    pub modified: String,
    pub modified_by: String,
}

/// Entry for rotating tag metadata keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataRotateTagEntry {
    pub id: String,
    pub metadata: String,
    pub metadata_key_id: String,
    pub metadata_key_type: String,
}

// ── Metadata upgrade ────────────────────────────────────────────────

/// Entry for upgrading a resource/folder to v5 metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataUpgradeEntry {
    pub id: String,
    pub metadata: String,
    pub metadata_key_id: String,
    pub metadata_key_type: String,
    pub modified: String,
    pub modified_by: String,
}

/// Entry for upgrading a tag to v5 metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataUpgradeTagEntry {
    pub id: String,
    pub metadata: String,
    pub metadata_key_id: String,
    pub metadata_key_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_shared: Option<bool>,
}

// ── Move ────────────────────────────────────────────────────────────

/// Move request payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveRequest {
    pub folder_parent_id: Option<String>,
}

/// Target model for move/share operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ForeignModel {
    #[serde(rename = "resource")]
    Resource,
    #[serde(rename = "folder")]
    Folder,
}

impl fmt::Display for ForeignModel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ForeignModel::Resource => write!(f, "resource"),
            ForeignModel::Folder => write!(f, "folder"),
        }
    }
}

// ── Healthcheck & settings ──────────────────────────────────────────

/// Server health check response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthcheckInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<serde_json::Value>,
    #[serde(rename = "configFile")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_file: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub core: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssl: Option<serde_json::Value>,
    #[serde(rename = "smtpSettings")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smtp_settings: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpg: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applications: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<serde_json::Value>,
}

/// Server settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passbolt: Option<serde_json::Value>,
}

// ── MFA ─────────────────────────────────────────────────────────────

/// MFA verify/attempt request for TOTP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MfaTotpRequest {
    pub totp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remember: Option<u8>,
}

/// MFA verify/attempt request for Yubikey.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MfaYubikeyRequest {
    pub hotp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remember: Option<u8>,
}

// ── Directory sync ──────────────────────────────────────────────────

/// Directory sync result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectorySyncResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub users: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups: Option<Vec<serde_json::Value>>,
}

// ── Query helpers ───────────────────────────────────────────────────

/// Query parameters for listing resources.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResourceListParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_id: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_favorite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_shared_with_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_owned_by_me: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_creator: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_favorite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_modifier: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_secret: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_resource_type: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_permission: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_permissions: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_tags: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
}

/// Query parameters for listing folders.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FolderListParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_children_resources: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_children_folders: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_creator: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_modifier: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_permission: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_permissions: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
}

/// Query parameters for listing users.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UserListParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_groups: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_admin: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_last_logged_in: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_groups_users: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_gpgkey: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_profile: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_role: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
}

/// Query parameters for listing groups.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GroupListParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_users: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_manager: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_users: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_modifier: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_my_group_user: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contain_groups_users: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
}

// ── Local cache ─────────────────────────────────────────────────────

/// Local in-memory resource cache.
#[derive(Debug, Clone, Default)]
pub struct ResourceCache {
    pub resources: Vec<Resource>,
    pub folders: Vec<Folder>,
    pub last_updated: Option<String>,
    pub ttl_seconds: u64,
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = PassboltError::auth_failed("bad creds");
        assert_eq!(format!("{}", err), "AuthFailed: bad creds");
    }

    #[test]
    fn test_error_into_string() {
        let err = PassboltError::not_found("missing");
        let s: String = err.into();
        assert_eq!(s, "missing");
    }

    #[test]
    fn test_default_config() {
        let cfg = PassboltConfig::default();
        assert_eq!(cfg.auth_method, AuthMethod::Jwt);
        assert!(cfg.verify_tls);
        assert_eq!(cfg.request_timeout_secs, 30);
    }

    #[test]
    fn test_session_default() {
        let session = SessionState::default();
        assert!(!session.authenticated);
        assert!(session.user_id.is_none());
    }

    #[test]
    fn test_mfa_provider_display() {
        assert_eq!(MfaProvider::Totp.to_string(), "totp");
        assert_eq!(MfaProvider::Yubikey.to_string(), "yubikey");
    }

    #[test]
    fn test_foreign_model_display() {
        assert_eq!(ForeignModel::Resource.to_string(), "resource");
        assert_eq!(ForeignModel::Folder.to_string(), "folder");
    }

    #[test]
    fn test_permission_type_constants() {
        assert_eq!(permission_types::READ, 1);
        assert_eq!(permission_types::UPDATE, 7);
        assert_eq!(permission_types::OWNER, 15);
    }

    #[test]
    fn test_default_totp_config() {
        let totp: TotpConfig =
            serde_json::from_str(r#"{"secret_key":"JBSWY3DPEHPK3PXP"}"#).unwrap();
        assert_eq!(totp.digits, 6);
        assert_eq!(totp.period, 30);
        assert_eq!(totp.algorithm, "SHA1");
    }

    #[test]
    fn test_resource_serialize_skip_none() {
        let mut r = Resource::default();
        r.id = "abc".into();
        r.name = Some("test".into());
        r.created = "2024-01-01T00:00:00Z".into();
        r.modified = "2024-01-01T00:00:00Z".into();
        r.created_by = "user1".into();
        r.modified_by = "user1".into();
        r.resource_type_id = "rt1".into();
        let json = serde_json::to_string(&r).unwrap();
        assert!(!json.contains("metadata_key_id"));
        assert!(json.contains("\"name\":\"test\""));
    }

    #[test]
    fn test_api_response_deserialize() {
        let json = r#"{
            "header": {
                "id": "abc",
                "status": "success",
                "servertime": 1721727753,
                "action": "def",
                "message": "OK",
                "url": "/test",
                "code": 200
            },
            "body": "hello"
        }"#;
        let resp: ApiResponse<String> = serde_json::from_str(json).unwrap();
        assert_eq!(resp.header.status, "success");
        assert_eq!(resp.header.code, 200);
        assert_eq!(resp.body, "hello");
    }

    #[test]
    fn test_create_resource_request_serialize() {
        let req = CreateResourceRequest {
            name: "Test Resource".into(),
            username: Some("admin".into()),
            uri: Some("https://example.com".into()),
            description: None,
            resource_type_id: Some("rt-uuid".into()),
            secrets: vec!["-----BEGIN PGP MESSAGE-----".into()],
            metadata: None,
            metadata_key_id: None,
            metadata_key_type: None,
            folder_parent_id: None,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["name"], "Test Resource");
        assert_eq!(json["secrets"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_share_request_serialize() {
        let req = ShareRequest {
            permissions: Some(vec![PermissionChange {
                id: None,
                aro: "User".into(),
                aro_foreign_key: "user-uuid".into(),
                permission_type: Some(permission_types::READ),
                delete: None,
            }]),
            secrets: Some(vec![ShareSecret {
                user_id: "user-uuid".into(),
                data: "encrypted-data".into(),
            }]),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert!(json["permissions"].is_array());
        assert!(json["secrets"].is_array());
    }

    #[test]
    fn test_resource_list_params_default_empty() {
        let params = ResourceListParams::default();
        let json = serde_json::to_value(&params).unwrap();
        // All skipped — should be empty object
        assert!(json.as_object().unwrap().is_empty());
    }

    #[test]
    fn test_metadata_types_settings_roundtrip() {
        let settings = MetadataTypesSettings {
            default_resource_types: "v5".into(),
            default_folder_type: "v4".into(),
            default_tag_type: "v4".into(),
            default_comment_type: "v4".into(),
            allow_creation_of_v5_resources: true,
            allow_creation_of_v5_folders: false,
            allow_creation_of_v5_tags: false,
            allow_creation_of_v5_comments: false,
            allow_creation_of_v4_resources: true,
            allow_creation_of_v4_folders: true,
            allow_creation_of_v4_tags: true,
            allow_creation_of_v4_comments: true,
            allow_v5_v4_downgrade: false,
            allow_v4_v5_upgrade: true,
        };
        let json = serde_json::to_string(&settings).unwrap();
        let back: MetadataTypesSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.default_resource_types, "v5");
        assert!(back.allow_v4_v5_upgrade);
    }

    #[test]
    fn test_group_user_entry() {
        let entry = GroupUserEntry {
            user_id: "uid".into(),
            is_admin: true,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["is_admin"], true);
    }

    #[test]
    fn test_metadata_key_settings() {
        let s = MetadataKeySettings {
            allow_usage_of_personal_keys: true,
            zero_knowledge_key_share: false,
        };
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["allow_usage_of_personal_keys"], true);
        assert_eq!(json["zero_knowledge_key_share"], false);
    }

    #[test]
    fn test_comment_payload() {
        let p = CommentPayload {
            content: "hello".into(),
            parent_id: Some("parent-uuid".into()),
            foreign_key: None,
            foreign_model: None,
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["content"], "hello");
        assert_eq!(json["parent_id"], "parent-uuid");
    }

    #[test]
    fn test_move_request() {
        let m = MoveRequest {
            folder_parent_id: Some("folder-uuid".into()),
        };
        let json = serde_json::to_value(&m).unwrap();
        assert_eq!(json["folder_parent_id"], "folder-uuid");
    }

    #[test]
    fn test_auth_method_variants() {
        assert_ne!(AuthMethod::GpgAuth, AuthMethod::Jwt);
    }
}
