//! Core types for the Google Drive integration.
//!
//! All types are serde-friendly with camelCase JSON field naming and are
//! designed to faithfully represent the Google Drive API v3 resource model.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Errors
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Error kind for Google Drive operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GDriveErrorKind {
    /// HTTP-level error with status code.
    HttpError(u16),
    /// OAuth2 authentication failure.
    AuthenticationFailed,
    /// Token has expired.
    TokenExpired,
    /// Insufficient scopes for operation.
    InsufficientScope,
    /// File not found.
    FileNotFound,
    /// Folder not found.
    FolderNotFound,
    /// Permission denied.
    PermissionDenied,
    /// Rate limit exceeded (HTTP 429).
    RateLimitExceeded,
    /// Storage quota exceeded.
    QuotaExceeded,
    /// Upload failed.
    UploadFailed,
    /// Download failed.
    DownloadFailed,
    /// Invalid request parameter.
    InvalidParameter,
    /// Network/connectivity error.
    NetworkError,
    /// Server error (5xx).
    ServerError,
    /// Generic / unmapped error.
    Other,
}

impl std::fmt::Display for GDriveErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::HttpError(code) => write!(f, "HTTP {}", code),
            Self::AuthenticationFailed => write!(f, "AuthenticationFailed"),
            Self::TokenExpired => write!(f, "TokenExpired"),
            Self::InsufficientScope => write!(f, "InsufficientScope"),
            Self::FileNotFound => write!(f, "FileNotFound"),
            Self::FolderNotFound => write!(f, "FolderNotFound"),
            Self::PermissionDenied => write!(f, "PermissionDenied"),
            Self::RateLimitExceeded => write!(f, "RateLimitExceeded"),
            Self::QuotaExceeded => write!(f, "QuotaExceeded"),
            Self::UploadFailed => write!(f, "UploadFailed"),
            Self::DownloadFailed => write!(f, "DownloadFailed"),
            Self::InvalidParameter => write!(f, "InvalidParameter"),
            Self::NetworkError => write!(f, "NetworkError"),
            Self::ServerError => write!(f, "ServerError"),
            Self::Other => write!(f, "Other"),
        }
    }
}

/// A Google Drive error.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GDriveError {
    pub kind: GDriveErrorKind,
    pub message: String,
}

impl std::fmt::Display for GDriveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.kind, self.message)
    }
}

impl std::error::Error for GDriveError {}

impl GDriveError {
    pub fn new(kind: GDriveErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// Create from an HTTP status code.
    pub fn from_status(status: u16, body: &str) -> Self {
        let kind = match status {
            401 => GDriveErrorKind::AuthenticationFailed,
            403 if body.contains("insufficientPermissions") => {
                GDriveErrorKind::InsufficientScope
            }
            403 if body.contains("storageQuotaExceeded") => GDriveErrorKind::QuotaExceeded,
            403 => GDriveErrorKind::PermissionDenied,
            404 => GDriveErrorKind::FileNotFound,
            429 => GDriveErrorKind::RateLimitExceeded,
            500..=599 => GDriveErrorKind::ServerError,
            _ => GDriveErrorKind::HttpError(status),
        };
        Self::new(kind, body.chars().take(500).collect::<String>())
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(GDriveErrorKind::AuthenticationFailed, msg)
    }

    pub fn invalid(msg: impl Into<String>) -> Self {
        Self::new(GDriveErrorKind::InvalidParameter, msg)
    }

    pub fn network(msg: impl Into<String>) -> Self {
        Self::new(GDriveErrorKind::NetworkError, msg)
    }
}

/// Convenience type alias.
pub type GDriveResult<T> = Result<T, GDriveError>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OAuth2
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Google OAuth2 scopes for Drive.
pub mod scopes {
    /// Full access to all files.
    pub const DRIVE: &str = "https://www.googleapis.com/auth/drive";
    /// Per-file access to files created or opened by the app.
    pub const DRIVE_FILE: &str = "https://www.googleapis.com/auth/drive.file";
    /// Read-only file access.
    pub const DRIVE_READONLY: &str = "https://www.googleapis.com/auth/drive.readonly";
    /// Read-only access to metadata.
    pub const DRIVE_METADATA_READONLY: &str =
        "https://www.googleapis.com/auth/drive.metadata.readonly";
    /// Full metadata access (read/write).
    pub const DRIVE_METADATA: &str = "https://www.googleapis.com/auth/drive.metadata";
    /// Access to app-specific data folder only.
    pub const DRIVE_APPDATA: &str = "https://www.googleapis.com/auth/drive.appdata";
    /// Access to view and manage Google Photos.
    pub const DRIVE_PHOTOS_READONLY: &str =
        "https://www.googleapis.com/auth/drive.photos.readonly";
}

/// OAuth2 client credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCredentials {
    /// OAuth2 client ID from Google Cloud Console.
    pub client_id: String,
    /// OAuth2 client secret.
    pub client_secret: String,
    /// Redirect URI for the OAuth flow.
    pub redirect_uri: String,
    /// Requested scopes.
    pub scopes: Vec<String>,
}

impl Default for OAuthCredentials {
    fn default() -> Self {
        Self {
            client_id: String::new(),
            client_secret: String::new(),
            redirect_uri: "urn:ietf:wg:oauth:2.0:oob".to_string(),
            scopes: vec![scopes::DRIVE.to_string()],
        }
    }
}

/// OAuth2 token pair.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthToken {
    /// Bearer access token.
    pub access_token: String,
    /// Refresh token (used to obtain new access tokens).
    pub refresh_token: Option<String>,
    /// Token type (usually "Bearer").
    pub token_type: String,
    /// Expiry time.
    pub expires_at: Option<DateTime<Utc>>,
    /// Granted scopes.
    pub scope: Option<String>,
}

impl Default for OAuthToken {
    fn default() -> Self {
        Self {
            access_token: String::new(),
            refresh_token: None,
            token_type: "Bearer".to_string(),
            expires_at: None,
            scope: None,
        }
    }
}

impl OAuthToken {
    pub fn is_expired(&self) -> bool {
        match self.expires_at {
            Some(exp) => Utc::now() >= exp,
            None => false,
        }
    }
}

/// Raw JSON response from Google's token endpoint.
#[derive(Debug, Deserialize)]
pub(crate) struct TokenResponse {
    pub access_token: String,
    pub token_type: Option<String>,
    pub expires_in: Option<i64>,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Drive Account Info (about)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Drive account / quota info from the About endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveAbout {
    /// User display name.
    pub user_display_name: String,
    /// User email address.
    pub user_email: String,
    /// User photo link.
    pub user_photo_link: Option<String>,
    /// Storage quota used (bytes).
    pub storage_used: i64,
    /// Storage quota limit (bytes, -1 if unlimited).
    pub storage_limit: i64,
    /// Storage used in trash (bytes).
    pub storage_used_in_trash: i64,
    /// Storage used in Drive (bytes).
    pub storage_used_in_drive: i64,
    /// Whether the user can create shared drives.
    pub can_create_drives: bool,
    /// Max upload size (bytes).
    pub max_upload_size: i64,
    /// Supported export formats.
    pub export_formats: Vec<ExportFormat>,
    /// Supported import formats.
    pub import_formats: Vec<ImportFormat>,
}

/// Export format mapping.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFormat {
    pub source: String,
    pub targets: Vec<String>,
}

/// Import format mapping.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFormat {
    pub source: String,
    pub targets: Vec<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Files
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Google Drive file metadata (v3 files resource).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFile {
    /// Unique opaque file ID.
    #[serde(default)]
    pub id: String,
    /// File name.
    #[serde(default)]
    pub name: String,
    /// MIME type.
    #[serde(default)]
    pub mime_type: String,
    /// Description / summary.
    #[serde(default)]
    pub description: Option<String>,
    /// Whether the file is a folder.
    #[serde(default)]
    pub is_folder: bool,
    /// File size in bytes (blobs only).
    #[serde(default)]
    pub size: Option<i64>,
    /// Parent folder IDs.
    #[serde(default)]
    pub parents: Vec<String>,
    /// Creation time.
    pub created_time: Option<DateTime<Utc>>,
    /// Last modification time.
    pub modified_time: Option<DateTime<Utc>>,
    /// Last viewed by requesting user.
    pub viewed_by_me_time: Option<DateTime<Utc>>,
    /// File extension.
    #[serde(default)]
    pub file_extension: Option<String>,
    /// MD5 checksum (binary files only).
    #[serde(default)]
    pub md5_checksum: Option<String>,
    /// Whether the file is starred by the user.
    #[serde(default)]
    pub starred: bool,
    /// Whether the file is trashed.
    #[serde(default)]
    pub trashed: bool,
    /// Whether the file is explicitly trashed (vs. parent was trashed).
    #[serde(default)]
    pub explicitly_trashed: bool,
    /// Whether the file's content or metadata cannot currently be modified.
    #[serde(default)]
    pub writers_can_share: bool,
    /// Whether viewers can copy the content.
    #[serde(default)]
    pub viewers_can_copy_content: bool,
    /// Web view link (opens in browser).
    #[serde(default)]
    pub web_view_link: Option<String>,
    /// Web content link (direct download for blobs).
    #[serde(default)]
    pub web_content_link: Option<String>,
    /// Icon link.
    #[serde(default)]
    pub icon_link: Option<String>,
    /// Thumbnail link.
    #[serde(default)]
    pub thumbnail_link: Option<String>,
    /// File owner names.
    #[serde(default)]
    pub owners: Vec<DriveUser>,
    /// Last modifying user.
    #[serde(default)]
    pub last_modifying_user: Option<DriveUser>,
    /// Shared with me date.
    pub shared_with_me_time: Option<DateTime<Utc>>,
    /// Sharing user.
    #[serde(default)]
    pub sharing_user: Option<DriveUser>,
    /// Permissions list.
    #[serde(default)]
    pub permissions: Vec<DrivePermission>,
    /// Version number.
    #[serde(default)]
    pub version: Option<String>,
    /// Original file name (before Drive renaming).
    #[serde(default)]
    pub original_filename: Option<String>,
    /// Full file extension including compound extensions (e.g. "tar.gz").
    #[serde(default)]
    pub full_file_extension: Option<String>,
    /// Head revision ID.
    #[serde(default)]
    pub head_revision_id: Option<String>,
    /// Capabilities the current user has on the file.
    #[serde(default)]
    pub capabilities: Option<FileCapabilities>,
}

impl Default for DriveFile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            mime_type: String::new(),
            description: None,
            is_folder: false,
            size: None,
            parents: Vec::new(),
            created_time: None,
            modified_time: None,
            viewed_by_me_time: None,
            file_extension: None,
            md5_checksum: None,
            starred: false,
            trashed: false,
            explicitly_trashed: false,
            writers_can_share: true,
            viewers_can_copy_content: true,
            web_view_link: None,
            web_content_link: None,
            icon_link: None,
            thumbnail_link: None,
            owners: Vec::new(),
            last_modifying_user: None,
            shared_with_me_time: None,
            sharing_user: None,
            permissions: Vec::new(),
            version: None,
            original_filename: None,
            full_file_extension: None,
            head_revision_id: None,
            capabilities: None,
        }
    }
}

/// Well-known Google Drive MIME types.
pub mod mime_types {
    pub const FOLDER: &str = "application/vnd.google-apps.folder";
    pub const DOCUMENT: &str = "application/vnd.google-apps.document";
    pub const SPREADSHEET: &str = "application/vnd.google-apps.spreadsheet";
    pub const PRESENTATION: &str = "application/vnd.google-apps.presentation";
    pub const DRAWING: &str = "application/vnd.google-apps.drawing";
    pub const FORM: &str = "application/vnd.google-apps.form";
    pub const SCRIPT: &str = "application/vnd.google-apps.script";
    pub const SITE: &str = "application/vnd.google-apps.site";
    pub const SHORTCUT: &str = "application/vnd.google-apps.shortcut";
    pub const DRIVE_SDK: &str = "application/vnd.google-apps.drive-sdk";
    pub const MAP: &str = "application/vnd.google-apps.map";
    pub const AUDIO: &str = "application/vnd.google-apps.audio";
    pub const VIDEO: &str = "application/vnd.google-apps.video";
    pub const PHOTO: &str = "application/vnd.google-apps.photo";
    pub const JAM: &str = "application/vnd.google-apps.jam";

    /// Check if a MIME type is a Google Workspace native type.
    pub fn is_google_type(mime: &str) -> bool {
        mime.starts_with("application/vnd.google-apps.")
    }
}

/// User info embedded in file metadata.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveUser {
    /// Display name.
    #[serde(default)]
    pub display_name: String,
    /// Email address.
    #[serde(default)]
    pub email_address: Option<String>,
    /// Photo link.
    #[serde(default)]
    pub photo_link: Option<String>,
    /// Whether this is the authenticated user.
    #[serde(default)]
    pub me: bool,
    /// Permission ID (stable across resources).
    #[serde(default)]
    pub permission_id: Option<String>,
}

/// File capabilities (canEdit, canShare, etc.).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCapabilities {
    #[serde(default)]
    pub can_edit: bool,
    #[serde(default)]
    pub can_comment: bool,
    #[serde(default)]
    pub can_share: bool,
    #[serde(default)]
    pub can_copy: bool,
    #[serde(default)]
    pub can_delete: bool,
    #[serde(default)]
    pub can_download: bool,
    #[serde(default)]
    pub can_trash: bool,
    #[serde(default)]
    pub can_untrash: bool,
    #[serde(default)]
    pub can_rename: bool,
    #[serde(default)]
    pub can_move_item_within_drive: bool,
    #[serde(default)]
    pub can_move_item_out_of_drive: bool,
    #[serde(default)]
    pub can_add_children: bool,
    #[serde(default)]
    pub can_remove_children: bool,
    #[serde(default)]
    pub can_list_children: bool,
    #[serde(default)]
    pub can_read_revisions: bool,
    #[serde(default)]
    pub can_modify_content: bool,
}

/// Paginated file list response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileList {
    pub files: Vec<DriveFile>,
    #[serde(default)]
    pub next_page_token: Option<String>,
    /// Whether result set may be incomplete.
    #[serde(default)]
    pub incomplete_search: bool,
}

impl Default for FileList {
    fn default() -> Self {
        Self {
            files: Vec::new(),
            next_page_token: None,
            incomplete_search: false,
        }
    }
}

/// Request parameters for creating a file (metadata only).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFileRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub parents: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<bool>,
}

/// Request parameters for updating a file's metadata.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFileRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trashed: Option<bool>,
    /// New parent IDs (for moves).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub add_parents: Vec<String>,
    /// Parent IDs to remove (for moves).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub remove_parents: Vec<String>,
}

/// Request parameters for copying a file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyFileRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub parents: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Parameters for listing files.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFilesParams {
    /// Drive search query (e.g. "name contains 'report'").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    /// Page size (max 1000).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// Page token for pagination.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_token: Option<String>,
    /// Fields to include (partial response).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<String>,
    /// Ordering (e.g. "modifiedTime desc").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order_by: Option<String>,
    /// Corpora to search (user, domain, drive, allDrives).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corpora: Option<String>,
    /// Shared drive ID (when corpora=drive).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drive_id: Option<String>,
    /// Include items from all shared drives.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_items_from_all_drives: Option<bool>,
    /// Whether the caller supports both My Drives and shared drives.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_all_drives: Option<bool>,
    /// Spaces to search (drive, appDataFolder).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spaces: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Permissions (sharing)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Permission type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionType {
    User,
    Group,
    Domain,
    Anyone,
}

impl std::fmt::Display for PermissionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::User => write!(f, "user"),
            Self::Group => write!(f, "group"),
            Self::Domain => write!(f, "domain"),
            Self::Anyone => write!(f, "anyone"),
        }
    }
}

/// Permission role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionRole {
    Owner,
    Organizer,
    FileOrganizer,
    Writer,
    Commenter,
    Reader,
}

impl std::fmt::Display for PermissionRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Owner => write!(f, "owner"),
            Self::Organizer => write!(f, "organizer"),
            Self::FileOrganizer => write!(f, "fileOrganizer"),
            Self::Writer => write!(f, "writer"),
            Self::Commenter => write!(f, "commenter"),
            Self::Reader => write!(f, "reader"),
        }
    }
}

/// Drive permission resource.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrivePermission {
    /// Permission ID.
    #[serde(default)]
    pub id: String,
    /// Permission type.
    #[serde(rename = "type")]
    pub permission_type: PermissionType,
    /// Role granted.
    pub role: PermissionRole,
    /// Email address (user or group).
    #[serde(default)]
    pub email_address: Option<String>,
    /// Domain (when type=domain).
    #[serde(default)]
    pub domain: Option<String>,
    /// Display name.
    #[serde(default)]
    pub display_name: Option<String>,
    /// Photo link.
    #[serde(default)]
    pub photo_link: Option<String>,
    /// When the permission expires.
    pub expiration_time: Option<DateTime<Utc>>,
    /// Whether the permission was deleted.
    #[serde(default)]
    pub deleted: bool,
    /// Whether the requester can view the permission user's info.
    #[serde(default)]
    pub pending_owner: bool,
}

impl Default for DrivePermission {
    fn default() -> Self {
        Self {
            id: String::new(),
            permission_type: PermissionType::User,
            role: PermissionRole::Reader,
            email_address: None,
            domain: None,
            display_name: None,
            photo_link: None,
            expiration_time: None,
            deleted: false,
            pending_owner: false,
        }
    }
}

/// Request to create a permission.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePermissionRequest {
    /// Permission type: user, group, domain, anyone.
    #[serde(rename = "type")]
    pub permission_type: PermissionType,
    /// Role: owner, organizer, fileOrganizer, writer, commenter, reader.
    pub role: PermissionRole,
    /// Email address (required for user and group types).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_address: Option<String>,
    /// Domain name (required for domain type).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    /// Whether to send a notification email.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub send_notification_email: Option<bool>,
    /// Custom message for the notification email.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_message: Option<String>,
    /// Whether to transfer ownership.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfer_ownership: Option<bool>,
    /// Expiration time for temporary access.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiration_time: Option<DateTime<Utc>>,
}

/// Request to update a permission.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePermissionRequest {
    /// New role.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<PermissionRole>,
    /// New expiration time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiration_time: Option<DateTime<Utc>>,
}

/// Permission list response.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionList {
    pub permissions: Vec<DrivePermission>,
    #[serde(default)]
    pub next_page_token: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Revisions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// File revision metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveRevision {
    pub id: String,
    pub mime_type: Option<String>,
    pub modified_time: Option<DateTime<Utc>>,
    #[serde(default)]
    pub size: Option<i64>,
    #[serde(default)]
    pub keep_forever: bool,
    #[serde(default)]
    pub md5_checksum: Option<String>,
    #[serde(default)]
    pub original_filename: Option<String>,
    #[serde(default)]
    pub last_modifying_user: Option<DriveUser>,
    #[serde(default)]
    pub publish_auto: bool,
    #[serde(default)]
    pub published: bool,
    #[serde(default)]
    pub published_outside_domain: bool,
}

/// Revision list response.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionList {
    pub revisions: Vec<DriveRevision>,
    #[serde(default)]
    pub next_page_token: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Comments & replies
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Comment on a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveComment {
    pub id: String,
    /// HTML content of the comment.
    #[serde(default)]
    pub html_content: Option<String>,
    /// Plain text content.
    pub content: String,
    pub created_time: Option<DateTime<Utc>>,
    pub modified_time: Option<DateTime<Utc>>,
    pub author: Option<DriveUser>,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub resolved: bool,
    /// Anchor region in the document (opaque string).
    #[serde(default)]
    pub anchor: Option<String>,
    /// Replies to this comment.
    #[serde(default)]
    pub replies: Vec<DriveReply>,
}

/// Reply to a comment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveReply {
    pub id: String,
    pub content: String,
    #[serde(default)]
    pub html_content: Option<String>,
    pub created_time: Option<DateTime<Utc>>,
    pub modified_time: Option<DateTime<Utc>>,
    pub author: Option<DriveUser>,
    #[serde(default)]
    pub deleted: bool,
    /// Whether this reply resolves the parent comment.
    #[serde(default)]
    pub action: Option<String>,
}

/// Comment list response.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentList {
    pub comments: Vec<DriveComment>,
    #[serde(default)]
    pub next_page_token: Option<String>,
}

/// Reply list response.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyList {
    pub replies: Vec<DriveReply>,
    #[serde(default)]
    pub next_page_token: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Shared drives
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Shared drive metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedDrive {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color_rgb: Option<String>,
    pub created_time: Option<DateTime<Utc>>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub restrictions: Option<SharedDriveRestrictions>,
    #[serde(default)]
    pub capabilities: Option<SharedDriveCapabilities>,
}

/// Restrictions on a shared drive.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedDriveRestrictions {
    #[serde(default)]
    pub admin_managed_restrictions: bool,
    #[serde(default)]
    pub copy_requires_writer_permission: bool,
    #[serde(default)]
    pub domain_users_only: bool,
    #[serde(default)]
    pub drive_members_only: bool,
    #[serde(default)]
    pub sharing_folders_requires_organizer_permission: bool,
}

/// Capabilities on a shared drive.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedDriveCapabilities {
    #[serde(default)]
    pub can_add_children: bool,
    #[serde(default)]
    pub can_manage_members: bool,
    #[serde(default)]
    pub can_rename_drive: bool,
    #[serde(default)]
    pub can_delete_drive: bool,
    #[serde(default)]
    pub can_list_children: bool,
    #[serde(default)]
    pub can_change_drive_members_only_restriction: bool,
    #[serde(default)]
    pub can_change_copy_requires_writer_permission_restriction: bool,
    #[serde(default)]
    pub can_change_domain_users_only_restriction: bool,
    #[serde(default)]
    pub can_change_sharing_folders_requires_organizer_permission_restriction: bool,
    #[serde(default)]
    pub can_trash_children: bool,
}

/// Shared drive list response.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedDriveList {
    pub drives: Vec<SharedDrive>,
    #[serde(default)]
    pub next_page_token: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Changes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A change to a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveChange {
    /// Change type: "file" or "drive".
    #[serde(default)]
    pub change_type: String,
    /// Time of the change.
    pub time: Option<DateTime<Utc>>,
    /// Whether the file or shared drive has been removed.
    #[serde(default)]
    pub removed: bool,
    /// File ID.
    #[serde(default)]
    pub file_id: String,
    /// The updated file metadata (absent if removed).
    pub file: Option<DriveFile>,
    /// Shared drive ID (for drive changes).
    #[serde(default)]
    pub drive_id: Option<String>,
    /// The updated shared drive (for drive changes).
    pub drive: Option<SharedDrive>,
}

/// Change list response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeList {
    pub changes: Vec<DriveChange>,
    #[serde(default)]
    pub next_page_token: Option<String>,
    /// Token to store for future change polling.
    #[serde(default)]
    pub new_start_page_token: Option<String>,
}

impl Default for ChangeList {
    fn default() -> Self {
        Self {
            changes: Vec::new(),
            next_page_token: None,
            new_start_page_token: None,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Uploads
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Upload strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UploadType {
    /// Upload <= 5 MB with no metadata.
    Simple,
    /// Upload <= 5 MB with metadata in a single multipart request.
    Multipart,
    /// Resumable upload for large files or unreliable networks.
    Resumable,
}

impl Default for UploadType {
    fn default() -> Self {
        Self::Multipart
    }
}

/// Parameters for file upload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    /// Local file path to upload.
    pub file_path: String,
    /// Display name in Drive.
    pub name: String,
    /// Parent folder IDs.
    #[serde(default)]
    pub parents: Vec<String>,
    /// Optional MIME type override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// Optional description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Upload strategy.
    #[serde(default)]
    pub upload_type: UploadType,
    /// Whether to convert to a Google Workspace format.
    #[serde(default)]
    pub convert_to_google_format: bool,
}

/// Upload progress report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgress {
    pub file_name: String,
    pub bytes_sent: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub status: UploadStatus,
    /// Resumable upload session URI (if applicable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_uri: Option<String>,
}

/// Upload status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UploadStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Paused,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Downloads
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Download request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    /// File ID to download.
    pub file_id: String,
    /// Local destination path.
    pub destination_path: String,
    /// For Google Workspace files: MIME type to export as.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub export_mime_type: Option<String>,
}

/// Common export MIME types for Google Workspace documents.
pub mod export_formats {
    pub const PDF: &str = "application/pdf";
    pub const DOCX: &str =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    pub const XLSX: &str =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    pub const PPTX: &str =
        "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    pub const CSV: &str = "text/csv";
    pub const TSV: &str = "text/tab-separated-values";
    pub const PLAIN_TEXT: &str = "text/plain";
    pub const HTML: &str = "text/html";
    pub const RTF: &str = "application/rtf";
    pub const ODT: &str = "application/vnd.oasis.opendocument.text";
    pub const ODS: &str = "application/vnd.oasis.opendocument.spreadsheet";
    pub const ODP: &str = "application/vnd.oasis.opendocument.presentation";
    pub const JPEG: &str = "image/jpeg";
    pub const PNG: &str = "image/png";
    pub const SVG: &str = "image/svg+xml";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Search
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Operator for search queries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchOperator {
    Contains,
    Equals,
    NotEquals,
    LessThan,
    GreaterThan,
    LessThanOrEqual,
    GreaterThanOrEqual,
    In,
    Has,
}

impl SearchOperator {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Contains => "contains",
            Self::Equals => "=",
            Self::NotEquals => "!=",
            Self::LessThan => "<",
            Self::GreaterThan => ">",
            Self::LessThanOrEqual => "<=",
            Self::GreaterThanOrEqual => ">=",
            Self::In => "in",
            Self::Has => "has",
        }
    }
}

/// Drive service configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GDriveConfig {
    /// Display name for this connection.
    pub name: String,
    /// OAuth2 credentials.
    pub credentials: OAuthCredentials,
    /// Request timeout (seconds).
    pub timeout_seconds: u64,
    /// Maximum retries for transient failures.
    pub max_retries: u32,
    /// Rate-limit delay between requests (ms).
    pub rate_limit_ms: u64,
    /// Default page size for list operations.
    pub default_page_size: u32,
    /// Default fields to include in file responses.
    pub default_file_fields: String,
}

impl Default for GDriveConfig {
    fn default() -> Self {
        Self {
            name: "default".to_string(),
            credentials: OAuthCredentials::default(),
            timeout_seconds: 30,
            max_retries: 3,
            rate_limit_ms: 100,
            default_page_size: 100,
            default_file_fields: "id,name,mimeType,size,parents,createdTime,modifiedTime,trashed,starred,webViewLink,webContentLink,owners,permissions,capabilities".to_string(),
        }
    }
}

/// Connection summary (non-sensitive subset of config + state).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GDriveConnectionSummary {
    pub name: String,
    pub authenticated: bool,
    pub user_email: Option<String>,
    pub user_display_name: Option<String>,
    pub storage_used: Option<i64>,
    pub storage_limit: Option<i64>,
    pub connected_at: Option<DateTime<Utc>>,
}

/// Batch operation result.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult {
    pub succeeded: u32,
    pub failed: u32,
    pub errors: Vec<String>,
}

impl BatchResult {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn record_success(&mut self) {
        self.succeeded += 1;
    }
    pub fn record_failure(&mut self, err: String) {
        self.failed += 1;
        self.errors.push(err);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    // ── Error tests ──────────────────────────────────────────────

    #[test]
    fn error_kind_display_all_variants() {
        assert_eq!(GDriveErrorKind::HttpError(500).to_string(), "HTTP 500");
        assert_eq!(GDriveErrorKind::AuthenticationFailed.to_string(), "AuthenticationFailed");
        assert_eq!(GDriveErrorKind::TokenExpired.to_string(), "TokenExpired");
        assert_eq!(GDriveErrorKind::FileNotFound.to_string(), "FileNotFound");
        assert_eq!(GDriveErrorKind::PermissionDenied.to_string(), "PermissionDenied");
        assert_eq!(GDriveErrorKind::RateLimitExceeded.to_string(), "RateLimitExceeded");
        assert_eq!(GDriveErrorKind::QuotaExceeded.to_string(), "QuotaExceeded");
        assert_eq!(GDriveErrorKind::UploadFailed.to_string(), "UploadFailed");
        assert_eq!(GDriveErrorKind::DownloadFailed.to_string(), "DownloadFailed");
        assert_eq!(GDriveErrorKind::NetworkError.to_string(), "NetworkError");
        assert_eq!(GDriveErrorKind::ServerError.to_string(), "ServerError");
        assert_eq!(GDriveErrorKind::Other.to_string(), "Other");
    }

    #[test]
    fn error_display() {
        let e = GDriveError::new(GDriveErrorKind::FileNotFound, "file xyz");
        assert_eq!(e.to_string(), "[FileNotFound] file xyz");
    }

    #[test]
    fn error_from_status_codes() {
        let e401 = GDriveError::from_status(401, "unauthorized");
        assert_eq!(e401.kind, GDriveErrorKind::AuthenticationFailed);

        let e403_scope = GDriveError::from_status(403, "insufficientPermissions");
        assert_eq!(e403_scope.kind, GDriveErrorKind::InsufficientScope);

        let e403_quota = GDriveError::from_status(403, "storageQuotaExceeded");
        assert_eq!(e403_quota.kind, GDriveErrorKind::QuotaExceeded);

        let e403 = GDriveError::from_status(403, "forbidden");
        assert_eq!(e403.kind, GDriveErrorKind::PermissionDenied);

        let e404 = GDriveError::from_status(404, "not found");
        assert_eq!(e404.kind, GDriveErrorKind::FileNotFound);

        let e429 = GDriveError::from_status(429, "rate limited");
        assert_eq!(e429.kind, GDriveErrorKind::RateLimitExceeded);

        let e500 = GDriveError::from_status(500, "server error");
        assert_eq!(e500.kind, GDriveErrorKind::ServerError);

        let e418 = GDriveError::from_status(418, "teapot");
        assert_eq!(e418.kind, GDriveErrorKind::HttpError(418));
    }

    #[test]
    fn error_serde_roundtrip() {
        let e = GDriveError::new(GDriveErrorKind::HttpError(429), "slow down");
        let json = serde_json::to_string(&e).unwrap();
        let back: GDriveError = serde_json::from_str(&json).unwrap();
        assert_eq!(back.kind, e.kind);
        assert_eq!(back.message, e.message);
    }

    #[test]
    fn error_std_error_trait() {
        let e = GDriveError::new(GDriveErrorKind::Other, "oops");
        let _: &dyn std::error::Error = &e;
    }

    // ── OAuth tests ──────────────────────────────────────────────

    #[test]
    fn oauth_credentials_default() {
        let c = OAuthCredentials::default();
        assert!(c.client_id.is_empty());
        assert_eq!(c.redirect_uri, "urn:ietf:wg:oauth:2.0:oob");
        assert_eq!(c.scopes.len(), 1);
        assert!(c.scopes[0].contains("drive"));
    }

    #[test]
    fn oauth_token_default_not_expired() {
        let t = OAuthToken::default();
        assert!(!t.is_expired());
        assert_eq!(t.token_type, "Bearer");
    }

    #[test]
    fn oauth_token_expired() {
        let mut t = OAuthToken::default();
        t.expires_at = Some(Utc::now() - chrono::Duration::hours(1));
        assert!(t.is_expired());
    }

    #[test]
    fn oauth_token_not_expired_future() {
        let mut t = OAuthToken::default();
        t.expires_at = Some(Utc::now() + chrono::Duration::hours(1));
        assert!(!t.is_expired());
    }

    #[test]
    fn oauth_token_serde_roundtrip() {
        let t = OAuthToken {
            access_token: "ya29.abcdef".into(),
            refresh_token: Some("1//refresh".into()),
            token_type: "Bearer".into(),
            expires_at: Some(Utc::now()),
            scope: Some(scopes::DRIVE.into()),
        };
        let json = serde_json::to_string(&t).unwrap();
        let back: OAuthToken = serde_json::from_str(&json).unwrap();
        assert_eq!(back.access_token, "ya29.abcdef");
        assert!(back.refresh_token.is_some());
    }

    // ── Scope constants ──────────────────────────────────────────

    #[test]
    fn scopes_defined() {
        assert!(scopes::DRIVE.contains("auth/drive"));
        assert!(scopes::DRIVE_FILE.contains("drive.file"));
        assert!(scopes::DRIVE_READONLY.contains("drive.readonly"));
        assert!(scopes::DRIVE_METADATA_READONLY.contains("drive.metadata.readonly"));
        assert!(scopes::DRIVE_METADATA.contains("drive.metadata"));
        assert!(scopes::DRIVE_APPDATA.contains("drive.appdata"));
    }

    // ── File types ───────────────────────────────────────────────

    #[test]
    fn drive_file_default() {
        let f = DriveFile::default();
        assert!(f.id.is_empty());
        assert!(!f.is_folder);
        assert!(!f.trashed);
        assert!(f.writers_can_share);
        assert!(f.viewers_can_copy_content);
    }

    #[test]
    fn drive_file_serde_roundtrip() {
        let f = DriveFile {
            id: "abc123".into(),
            name: "report.pdf".into(),
            mime_type: "application/pdf".into(),
            size: Some(1024),
            starred: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&f).unwrap();
        let back: DriveFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "abc123");
        assert_eq!(back.name, "report.pdf");
        assert_eq!(back.size, Some(1024));
        assert!(back.starred);
    }

    #[test]
    fn drive_file_camel_case_fields() {
        let f = DriveFile::default();
        let json = serde_json::to_string(&f).unwrap();
        assert!(json.contains("mimeType"));
        assert!(json.contains("isFolder"));
        assert!(json.contains("createdTime"));
        assert!(json.contains("webViewLink"));
        assert!(!json.contains("mime_type"));
    }

    // ── MIME type helpers ────────────────────────────────────────

    #[test]
    fn mime_types_constants() {
        assert_eq!(mime_types::FOLDER, "application/vnd.google-apps.folder");
        assert_eq!(mime_types::DOCUMENT, "application/vnd.google-apps.document");
        assert_eq!(mime_types::SPREADSHEET, "application/vnd.google-apps.spreadsheet");
    }

    #[test]
    fn mime_types_is_google_type() {
        assert!(mime_types::is_google_type(mime_types::FOLDER));
        assert!(mime_types::is_google_type(mime_types::DOCUMENT));
        assert!(!mime_types::is_google_type("application/pdf"));
        assert!(!mime_types::is_google_type("image/png"));
    }

    // ── File list ────────────────────────────────────────────────

    #[test]
    fn file_list_default() {
        let fl = FileList::default();
        assert!(fl.files.is_empty());
        assert!(fl.next_page_token.is_none());
        assert!(!fl.incomplete_search);
    }

    #[test]
    fn list_files_params_default() {
        let p = ListFilesParams::default();
        assert!(p.query.is_none());
        assert!(p.page_size.is_none());
    }

    // ── Permission types ─────────────────────────────────────────

    #[test]
    fn permission_type_display() {
        assert_eq!(PermissionType::User.to_string(), "user");
        assert_eq!(PermissionType::Group.to_string(), "group");
        assert_eq!(PermissionType::Domain.to_string(), "domain");
        assert_eq!(PermissionType::Anyone.to_string(), "anyone");
    }

    #[test]
    fn permission_role_display() {
        assert_eq!(PermissionRole::Owner.to_string(), "owner");
        assert_eq!(PermissionRole::Writer.to_string(), "writer");
        assert_eq!(PermissionRole::Commenter.to_string(), "commenter");
        assert_eq!(PermissionRole::Reader.to_string(), "reader");
        assert_eq!(PermissionRole::Organizer.to_string(), "organizer");
        assert_eq!(PermissionRole::FileOrganizer.to_string(), "fileOrganizer");
    }

    #[test]
    fn permission_serde_roundtrip() {
        let p = DrivePermission {
            id: "perm123".into(),
            permission_type: PermissionType::User,
            role: PermissionRole::Writer,
            email_address: Some("user@example.com".into()),
            ..Default::default()
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: DrivePermission = serde_json::from_str(&json).unwrap();
        assert_eq!(back.role, PermissionRole::Writer);
        assert_eq!(back.email_address.as_deref(), Some("user@example.com"));
    }

    #[test]
    fn permission_default() {
        let p = DrivePermission::default();
        assert_eq!(p.permission_type, PermissionType::User);
        assert_eq!(p.role, PermissionRole::Reader);
        assert!(!p.deleted);
    }

    // ── Revision ─────────────────────────────────────────────────

    #[test]
    fn revision_serde() {
        let r = DriveRevision {
            id: "rev1".into(),
            mime_type: Some("application/pdf".into()),
            modified_time: Some(Utc::now()),
            size: Some(2048),
            keep_forever: true,
            md5_checksum: Some("abc".into()),
            original_filename: None,
            last_modifying_user: None,
            publish_auto: false,
            published: false,
            published_outside_domain: false,
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: DriveRevision = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "rev1");
        assert!(back.keep_forever);
    }

    // ── Comment / Reply ──────────────────────────────────────────

    #[test]
    fn comment_serde() {
        let c = DriveComment {
            id: "c1".into(),
            html_content: None,
            content: "Looks good!".into(),
            created_time: Some(Utc::now()),
            modified_time: None,
            author: Some(DriveUser {
                display_name: "Alice".into(),
                me: true,
                ..Default::default()
            }),
            deleted: false,
            resolved: false,
            anchor: None,
            replies: vec![],
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("Looks good!"));
        let back: DriveComment = serde_json::from_str(&json).unwrap();
        assert_eq!(back.content, "Looks good!");
    }

    // ── Shared drive ─────────────────────────────────────────────

    #[test]
    fn shared_drive_serde() {
        let sd = SharedDrive {
            id: "sd1".into(),
            name: "Team Drive".into(),
            color_rgb: Some("#ff0000".into()),
            created_time: Some(Utc::now()),
            hidden: false,
            restrictions: Some(SharedDriveRestrictions::default()),
            capabilities: None,
        };
        let json = serde_json::to_string(&sd).unwrap();
        let back: SharedDrive = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "Team Drive");
    }

    // ── Change ───────────────────────────────────────────────────

    #[test]
    fn change_list_default() {
        let cl = ChangeList::default();
        assert!(cl.changes.is_empty());
        assert!(cl.next_page_token.is_none());
        assert!(cl.new_start_page_token.is_none());
    }

    // ── Upload types ─────────────────────────────────────────────

    #[test]
    fn upload_type_default() {
        assert_eq!(UploadType::default(), UploadType::Multipart);
    }

    #[test]
    fn upload_status_serde() {
        let statuses = vec![
            UploadStatus::Pending,
            UploadStatus::InProgress,
            UploadStatus::Completed,
            UploadStatus::Failed,
            UploadStatus::Paused,
        ];
        for s in statuses {
            let json = serde_json::to_string(&s).unwrap();
            let back: UploadStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(back, s);
        }
    }

    // ── Export formats ───────────────────────────────────────────

    #[test]
    fn export_format_constants() {
        assert_eq!(export_formats::PDF, "application/pdf");
        assert!(export_formats::DOCX.contains("wordprocessingml"));
        assert!(export_formats::XLSX.contains("spreadsheetml"));
        assert!(export_formats::PPTX.contains("presentationml"));
        assert_eq!(export_formats::CSV, "text/csv");
    }

    // ── Search operator ──────────────────────────────────────────

    #[test]
    fn search_operator_as_str() {
        assert_eq!(SearchOperator::Contains.as_str(), "contains");
        assert_eq!(SearchOperator::Equals.as_str(), "=");
        assert_eq!(SearchOperator::NotEquals.as_str(), "!=");
        assert_eq!(SearchOperator::In.as_str(), "in");
        assert_eq!(SearchOperator::Has.as_str(), "has");
    }

    // ── Config ───────────────────────────────────────────────────

    #[test]
    fn gdrive_config_default() {
        let c = GDriveConfig::default();
        assert_eq!(c.name, "default");
        assert_eq!(c.timeout_seconds, 30);
        assert_eq!(c.max_retries, 3);
        assert_eq!(c.default_page_size, 100);
        assert!(c.default_file_fields.contains("id,name"));
    }

    #[test]
    fn gdrive_config_serde_roundtrip() {
        let c = GDriveConfig::default();
        let json = serde_json::to_string(&c).unwrap();
        let back: GDriveConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.timeout_seconds, 30);
    }

    // ── Connection summary ───────────────────────────────────────

    #[test]
    fn connection_summary_serde() {
        let s = GDriveConnectionSummary {
            name: "work".into(),
            authenticated: true,
            user_email: Some("user@example.com".into()),
            user_display_name: Some("User".into()),
            storage_used: Some(1_000_000),
            storage_limit: Some(15_000_000_000),
            connected_at: Some(Utc::now()),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: GDriveConnectionSummary = serde_json::from_str(&json).unwrap();
        assert!(back.authenticated);
        assert_eq!(back.user_email.as_deref(), Some("user@example.com"));
    }

    // ── Batch result ─────────────────────────────────────────────

    #[test]
    fn batch_result_tracking() {
        let mut b = BatchResult::new();
        b.record_success();
        b.record_success();
        b.record_failure("file1: not found".into());
        assert_eq!(b.succeeded, 2);
        assert_eq!(b.failed, 1);
        assert_eq!(b.errors.len(), 1);
    }

    // ── DriveUser ────────────────────────────────────────────────

    #[test]
    fn drive_user_default() {
        let u = DriveUser::default();
        assert!(u.display_name.is_empty());
        assert!(!u.me);
    }

    // ── FileCapabilities ─────────────────────────────────────────

    #[test]
    fn file_capabilities_default() {
        let c = FileCapabilities::default();
        assert!(!c.can_edit);
        assert!(!c.can_share);
        assert!(!c.can_delete);
    }

    // ── CreateFileRequest / UpdateFileRequest / CopyFileRequest

    #[test]
    fn create_file_request_serde() {
        let r = CreateFileRequest {
            name: "doc.txt".into(),
            mime_type: Some("text/plain".into()),
            parents: vec!["root".into()],
            ..Default::default()
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("doc.txt"));
    }

    #[test]
    fn update_file_request_default() {
        let r = UpdateFileRequest::default();
        assert!(r.name.is_none());
        assert!(r.add_parents.is_empty());
    }

    #[test]
    fn copy_file_request_serde() {
        let r = CopyFileRequest {
            name: Some("copy.txt".into()),
            ..Default::default()
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("copy.txt"));
    }

    // ── SharedDriveRestrictions ──────────────────────────────────

    #[test]
    fn shared_drive_restrictions_default() {
        let r = SharedDriveRestrictions::default();
        assert!(!r.admin_managed_restrictions);
        assert!(!r.domain_users_only);
    }

    // ── DriveAbout ───────────────────────────────────────────────

    #[test]
    fn drive_about_serde() {
        let a = DriveAbout {
            user_display_name: "Test User".into(),
            user_email: "test@example.com".into(),
            user_photo_link: None,
            storage_used: 500_000,
            storage_limit: 15_000_000_000,
            storage_used_in_trash: 1000,
            storage_used_in_drive: 499_000,
            can_create_drives: true,
            max_upload_size: 5_120_000_000,
            export_formats: vec![],
            import_formats: vec![],
        };
        let json = serde_json::to_string(&a).unwrap();
        let back: DriveAbout = serde_json::from_str(&json).unwrap();
        assert_eq!(back.user_email, "test@example.com");
        assert!(back.can_create_drives);
    }

    // ── UploadRequest ────────────────────────────────────────────

    #[test]
    fn upload_request_serde() {
        let r = UploadRequest {
            file_path: "/tmp/photo.jpg".into(),
            name: "photo.jpg".into(),
            parents: vec!["folder1".into()],
            mime_type: Some("image/jpeg".into()),
            description: None,
            upload_type: UploadType::Resumable,
            convert_to_google_format: false,
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: UploadRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.upload_type, UploadType::Resumable);
    }

    // ── DownloadRequest ──────────────────────────────────────────

    #[test]
    fn download_request_serde() {
        let r = DownloadRequest {
            file_id: "abc123".into(),
            destination_path: "/tmp/file.pdf".into(),
            export_mime_type: Some(export_formats::PDF.into()),
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: DownloadRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.file_id, "abc123");
    }
}
