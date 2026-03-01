// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · types
// ──────────────────────────────────────────────────────────────────────────────
// Comprehensive type catalogue for the Nextcloud integration crate covering:
//  • Configuration & authentication
//  • WebDAV resource metadata
//  • OCS API response wrappers
//  • Sharing types
//  • User / capability types
//  • Activity feed types
//  • Sync / Backup / Watcher support types
//  • Statistics & activity logging
// ──────────────────────────────────────────────────────────────────────────────

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── Configuration ────────────────────────────────────────────────────────────

/// Account-level Nextcloud configuration persisted by the front-end.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NextcloudAccountConfig {
    /// Human-readable label for this account.
    pub name: String,
    /// Full base URL of the Nextcloud instance, e.g. `https://cloud.example.com`.
    pub server_url: String,
    /// Username used for authentication.
    pub username: String,
    /// App password (preferred) or regular password.
    pub app_password: String,
    /// Whether this account is enabled.
    pub enabled: bool,
}

impl Default for NextcloudAccountConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            server_url: String::new(),
            username: String::new(),
            app_password: String::new(),
            enabled: false,
        }
    }
}

// ── Authentication ──────────────────────────────────────────────────────────

/// State carried during the Nextcloud Login Flow v2.
/// See <https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html#login-flow-v2>
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginFlowV2State {
    /// URL to open in the user's browser.
    pub login_url: String,
    /// Endpoint the client polls until the user completes login.
    pub poll_endpoint: String,
    /// One-time token sent with each poll request.
    pub poll_token: String,
}

/// Response from the Login Flow v2 init endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginFlowV2Init {
    pub poll: LoginFlowV2Poll,
    pub login: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginFlowV2Poll {
    pub token: String,
    pub endpoint: String,
}

/// Credentials returned after the user completes Login Flow v2.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginFlowV2Credentials {
    pub server: String,
    pub login_name: String,
    pub app_password: String,
}

/// OAuth 2 token response (Nextcloud supports RFC 6749 when the `oauth2` app is enabled).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
    pub user_id: Option<String>,
}

/// Tracks current auth method.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AuthMethod {
    /// Basic auth with app password / regular password.
    AppPassword,
    /// OAuth 2 bearer token.
    OAuth2,
    /// Not yet configured – no credentials.
    None,
}

impl Default for AuthMethod {
    fn default() -> Self {
        Self::None
    }
}

// ── Generic OCS envelope ─────────────────────────────────────────────────────

/// Standard OCS response wrapper.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcsResponse<T> {
    pub ocs: OcsEnvelope<T>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcsEnvelope<T> {
    pub meta: OcsMeta,
    pub data: T,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcsMeta {
    pub status: String,
    pub statuscode: u32,
    pub message: Option<String>,
    #[serde(rename = "totalitems")]
    pub total_items: Option<String>,
    #[serde(rename = "itemsperpage")]
    pub items_per_page: Option<String>,
}

// ── WebDAV Resource Metadata ─────────────────────────────────────────────────

/// The type of a WebDAV resource.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DavResourceType {
    File,
    Folder,
}

/// A single WebDAV resource returned from a PROPFIND.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DavResource {
    /// Full href from the DAV response (URL-encoded path).
    pub href: String,
    /// Decoded display name.
    pub display_name: String,
    /// Resource type.
    pub resource_type: DavResourceType,
    /// Content type / MIME (files only).
    pub content_type: Option<String>,
    /// Size in bytes (files only).
    pub content_length: Option<u64>,
    /// ETag (entity tag) for cache validation.
    pub etag: Option<String>,
    /// Last modified timestamp.
    pub last_modified: Option<String>,
    /// Nextcloud file-id (oc:fileid).
    pub file_id: Option<u64>,
    /// Nextcloud owner id.
    pub owner_id: Option<String>,
    /// Nextcloud owner display name.
    pub owner_display_name: Option<String>,
    /// Nextcloud permissions string (e.g. "RGDNVCK").
    pub permissions: Option<String>,
    /// Content checksum from server (e.g. `SHA1:…`).
    pub checksum: Option<String>,
    /// Whether this file has a preview available.
    pub has_preview: Option<bool>,
    /// Nextcloud favorite flag.
    pub favorite: Option<bool>,
    /// Nextcloud comments-count (oc:comments-count).
    pub comments_count: Option<u64>,
    /// Nextcloud tags (oc:tags / nc:system-tags).
    pub tags: Vec<String>,
    /// Size of contained resources (for folders, from oc:size).
    pub size: Option<u64>,
}

impl Default for DavResource {
    fn default() -> Self {
        Self {
            href: String::new(),
            display_name: String::new(),
            resource_type: DavResourceType::File,
            content_type: None,
            content_length: None,
            etag: None,
            last_modified: None,
            file_id: None,
            owner_id: None,
            owner_display_name: None,
            permissions: None,
            checksum: None,
            has_preview: None,
            favorite: None,
            comments_count: None,
            tags: Vec::new(),
            size: None,
        }
    }
}

/// Result of a PROPFIND listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropfindResult {
    /// The folder resource itself (depth-0).
    pub folder: DavResource,
    /// Children of the folder.
    pub children: Vec<DavResource>,
}

/// Depth header value for PROPFIND requests.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum PropfindDepth {
    Zero,
    One,
    Infinity,
}

impl PropfindDepth {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Zero => "0",
            Self::One => "1",
            Self::Infinity => "infinity",
        }
    }
}

// ── File Operations ─────────────────────────────────────────────────────────

/// Upload parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadArgs {
    /// Remote path on the Nextcloud server (relative to user root).
    pub remote_path: String,
    /// Whether to overwrite an existing file.
    pub overwrite: bool,
    /// Optional content type override.
    pub content_type: Option<String>,
    /// Optional mtime to set on the uploaded file (Unix timestamp).
    pub mtime: Option<i64>,
}

/// Chunked upload session state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkedUploadSession {
    /// Unique session identifier.
    pub session_id: String,
    /// Target path on the server.
    pub remote_path: String,
    /// Total file size.
    pub total_size: u64,
    /// Bytes uploaded so far.
    pub bytes_uploaded: u64,
    /// Number of chunks uploaded.
    pub chunks_uploaded: u32,
    /// Whether the session is complete.
    pub complete: bool,
}

/// Move / Copy arguments.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveArgs {
    /// Source remote path.
    pub from_path: String,
    /// Destination remote path.
    pub to_path: String,
    /// Whether to overwrite at the destination.
    pub overwrite: bool,
}

/// Delete argument.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteArg {
    /// Remote path of the resource to delete.
    pub path: String,
}

/// File version entry (Nextcloud versions API).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileVersion {
    /// Version identifier (usually a timestamp).
    pub version_id: String,
    /// Size in bytes.
    pub size: u64,
    /// Content type.
    pub content_type: Option<String>,
    /// Last modified.
    pub last_modified: Option<String>,
    /// Etag for this version.
    pub etag: Option<String>,
}

/// Search query for Nextcloud unified search or WebDAV SEARCH.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    /// Search term.
    pub term: String,
    /// Provider id (e.g. "files", "deck", "talk").
    pub provider: Option<String>,
    /// Limit results.
    pub limit: Option<u32>,
    /// Cursor / offset for pagination.
    pub cursor: Option<String>,
    /// Restrict to this path prefix.
    pub path_prefix: Option<String>,
    /// Restrict to these MIME types.
    pub mime_types: Vec<String>,
    /// Minimum size filter (bytes).
    pub min_size: Option<u64>,
    /// Maximum size filter (bytes).
    pub max_size: Option<u64>,
    /// Modified after this time.
    pub modified_after: Option<DateTime<Utc>>,
    /// Modified before this time.
    pub modified_before: Option<DateTime<Utc>>,
    /// Favorite only.
    pub favorite_only: bool,
}

impl Default for SearchQuery {
    fn default() -> Self {
        Self {
            term: String::new(),
            provider: None,
            limit: None,
            cursor: None,
            path_prefix: None,
            mime_types: Vec::new(),
            min_size: None,
            max_size: None,
            modified_after: None,
            modified_before: None,
            favorite_only: false,
        }
    }
}

/// A single search result item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultEntry {
    pub title: String,
    pub sub_line: Option<String>,
    pub resource_url: String,
    pub icon_url: Option<String>,
    pub thumbnail_url: Option<String>,
    pub rounded: Option<bool>,
    pub attributes: serde_json::Value,
}

/// Overall search response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub name: String,
    pub is_paginated: bool,
    pub entries: Vec<SearchResultEntry>,
    pub cursor: Option<String>,
}

/// Trash item representation (from trashbin WebDAV).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashItem {
    /// File id in the trashbin.
    pub id: String,
    /// Original filename.
    pub original_name: String,
    /// Original location (path).
    pub original_location: String,
    /// Deletion timestamp.
    pub deletion_time: Option<String>,
    /// Size in bytes.
    pub size: Option<u64>,
    /// Resource type.
    pub resource_type: DavResourceType,
}

// ── Sharing (OCS Share API v1) ───────────────────────────────────────────────

/// Nextcloud share types.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum ShareType {
    User = 0,
    Group = 1,
    PublicLink = 3,
    Email = 4,
    FederatedCloudShare = 6,
    Circle = 7,
    TalkConversation = 10,
    Deck = 12,
    ScienceMesh = 15,
}

impl ShareType {
    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            0 => Some(Self::User),
            1 => Some(Self::Group),
            3 => Some(Self::PublicLink),
            4 => Some(Self::Email),
            6 => Some(Self::FederatedCloudShare),
            7 => Some(Self::Circle),
            10 => Some(Self::TalkConversation),
            12 => Some(Self::Deck),
            15 => Some(Self::ScienceMesh),
            _ => None,
        }
    }

    pub fn as_i32(&self) -> i32 {
        match self {
            Self::User => 0,
            Self::Group => 1,
            Self::PublicLink => 3,
            Self::Email => 4,
            Self::FederatedCloudShare => 6,
            Self::Circle => 7,
            Self::TalkConversation => 10,
            Self::Deck => 12,
            Self::ScienceMesh => 15,
        }
    }
}

/// OCS share permissions bitmap.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct SharePermissions(pub u32);

impl SharePermissions {
    pub const READ: u32 = 1;
    pub const UPDATE: u32 = 2;
    pub const CREATE: u32 = 4;
    pub const DELETE: u32 = 8;
    pub const SHARE: u32 = 16;
    pub const ALL: u32 = 31;

    pub fn can_read(&self) -> bool {
        self.0 & Self::READ != 0
    }
    pub fn can_update(&self) -> bool {
        self.0 & Self::UPDATE != 0
    }
    pub fn can_create(&self) -> bool {
        self.0 & Self::CREATE != 0
    }
    pub fn can_delete(&self) -> bool {
        self.0 & Self::DELETE != 0
    }
    pub fn can_share(&self) -> bool {
        self.0 & Self::SHARE != 0
    }
}

/// Arguments for creating a new share.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateShareArgs {
    /// Path to the file or folder to share.
    pub path: String,
    /// Share type.
    pub share_type: i32,
    /// Share-with value (username, group name, email, etc.).
    pub share_with: Option<String>,
    /// Public upload allowed (link shares with folders).
    pub public_upload: Option<bool>,
    /// Password protection (link shares).
    pub password: Option<String>,
    /// Expiration date (YYYY-MM-DD).
    pub expire_date: Option<String>,
    /// Permissions bitmap.
    pub permissions: Option<u32>,
    /// Custom label for the share link.
    pub label: Option<String>,
    /// Note to the share recipient.
    pub note: Option<String>,
    /// Whether to send password by Talk.
    pub send_password_by_talk: Option<bool>,
}

/// Representation of an existing share returned by OCS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareInfo {
    pub id: String,
    pub share_type: i32,
    pub uid_owner: String,
    pub displayname_owner: String,
    pub permissions: u32,
    pub stime: Option<u64>,
    pub parent: Option<serde_json::Value>,
    pub expiration: Option<String>,
    pub token: Option<String>,
    pub uid_file_owner: String,
    pub displayname_file_owner: String,
    pub note: Option<String>,
    pub label: Option<String>,
    pub path: String,
    pub item_type: String,
    pub item_source: Option<u64>,
    pub file_source: Option<u64>,
    pub file_parent: Option<u64>,
    pub file_target: Option<String>,
    pub share_with: Option<String>,
    pub share_with_displayname: Option<String>,
    pub password: Option<String>,
    pub send_password_by_talk: Option<bool>,
    pub url: Option<String>,
    pub mail_send: Option<u32>,
    pub hide_download: Option<u32>,
    pub can_edit: Option<bool>,
    pub can_delete: Option<bool>,
    pub has_preview: Option<bool>,
    pub mimetype: Option<String>,
    pub storage_id: Option<String>,
    pub storage: Option<u64>,
}

/// Arguments for updating an existing share.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateShareArgs {
    /// Share ID.
    pub share_id: String,
    /// New permissions.
    pub permissions: Option<u32>,
    /// New password.
    pub password: Option<String>,
    /// New expiration date.
    pub expire_date: Option<String>,
    /// New note.
    pub note: Option<String>,
    /// New label.
    pub label: Option<String>,
    /// Public upload toggle.
    pub public_upload: Option<bool>,
    /// Hide download toggle.
    pub hide_download: Option<bool>,
}

// ── Users / Capabilities ─────────────────────────────────────────────────────

/// Current user information (from OCS provisioning API).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: String,
    #[serde(rename = "displayname")]
    pub display_name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    #[serde(rename = "website")]
    pub website: Option<String>,
    pub twitter: Option<String>,
    pub fediverse: Option<String>,
    pub groups: Vec<String>,
    pub language: Option<String>,
    pub locale: Option<String>,
    pub backend: Option<String>,
    pub last_login: Option<u64>,
    pub quota: Option<UserQuota>,
}

/// Quota information for a user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserQuota {
    pub free: Option<i64>,
    pub used: Option<i64>,
    pub total: Option<i64>,
    pub relative: Option<f64>,
    pub quota: Option<serde_json::Value>,
}

/// Server capabilities from `ocs/v1.php/cloud/capabilities`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerCapabilities {
    pub version: Option<ServerVersion>,
    pub capabilities: Option<CapabilitiesMap>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerVersion {
    pub major: Option<u32>,
    pub minor: Option<u32>,
    pub micro: Option<u32>,
    pub string: Option<String>,
    pub edition: Option<String>,
    #[serde(rename = "extendedSupport")]
    pub extended_support: Option<bool>,
}

/// Catch-all for the capabilities tree; consumers can drill in via serde_json::Value.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilitiesMap(pub serde_json::Value);

/// Server status (`/status.php`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStatus {
    pub installed: bool,
    pub maintenance: bool,
    #[serde(rename = "needsDbUpgrade")]
    pub needs_db_upgrade: bool,
    pub version: String,
    #[serde(rename = "versionstring")]
    pub version_string: String,
    pub edition: String,
    #[serde(rename = "productname")]
    pub product_name: String,
    #[serde(rename = "extendedSupport")]
    pub extended_support: Option<bool>,
}

// ── Activity Feed ────────────────────────────────────────────────────────────

/// A single activity from the OCS activity API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityItem {
    pub activity_id: u64,
    pub app: String,
    #[serde(rename = "type")]
    pub activity_type: String,
    pub affecteduser: String,
    pub user: String,
    pub timestamp: u64,
    pub subject: String,
    pub subject_rich: Option<Vec<serde_json::Value>>,
    pub message: Option<String>,
    pub message_rich: Option<Vec<serde_json::Value>>,
    pub object_type: Option<String>,
    pub object_id: Option<u64>,
    pub object_name: Option<String>,
    pub link: Option<String>,
    pub icon: Option<String>,
    pub previews: Option<Vec<ActivityPreview>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityPreview {
    pub link: String,
    pub source: String,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    pub file_id: Option<u64>,
    pub view: Option<String>,
    #[serde(rename = "isMimeTypeIcon")]
    pub is_mime_type_icon: Option<bool>,
}

/// Parameters for querying the activity feed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityQuery {
    /// Filter by type ("all", "self", "by", "filter").
    pub filter: Option<String>,
    /// Since this activity id.
    pub since: Option<u64>,
    /// Limit results.
    pub limit: Option<u32>,
    /// Object type filter.
    pub object_type: Option<String>,
    /// Object id filter.
    pub object_id: Option<u64>,
    /// Sort order ("asc" or "desc").
    pub sort: Option<String>,
}

impl Default for ActivityQuery {
    fn default() -> Self {
        Self {
            filter: None,
            since: None,
            limit: None,
            object_type: None,
            object_id: None,
            sort: None,
        }
    }
}

// ── Notifications ────────────────────────────────────────────────────────────

/// A Nextcloud notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub notification_id: u64,
    pub app: String,
    pub user: String,
    pub datetime: String,
    pub object_type: String,
    pub object_id: String,
    pub subject: String,
    pub subject_rich: Option<serde_json::Value>,
    pub message: Option<String>,
    pub message_rich: Option<serde_json::Value>,
    pub link: Option<String>,
    pub icon: Option<String>,
    pub actions: Vec<NotificationAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationAction {
    pub label: String,
    pub link: String,
    #[serde(rename = "type")]
    pub action_type: String,
    pub primary: bool,
}

// ── External Storages ────────────────────────────────────────────────────────

/// Representation of an external storage mount.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalStorage {
    pub id: u64,
    pub mount_point: String,
    pub backend: String,
    pub auth_mechanism: String,
    pub configuration: serde_json::Value,
    pub options: serde_json::Value,
    pub applicable_users: Vec<String>,
    pub applicable_groups: Vec<String>,
    pub status: Option<i32>,
    pub status_message: Option<String>,
    #[serde(rename = "type")]
    pub storage_type: Option<String>,
}

// ── Sync ─────────────────────────────────────────────────────────────────────

/// Sync direction.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SyncDirection {
    Upload,
    Download,
    Bidirectional,
}

/// Configuration for a single sync job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    /// Unique identifier for this sync config.
    pub id: String,
    /// Local directory path.
    pub local_path: String,
    /// Remote directory path on Nextcloud.
    pub remote_path: String,
    /// Direction of sync.
    pub direction: SyncDirection,
    /// Glob patterns to exclude.
    pub exclude_patterns: Vec<String>,
    /// Whether this sync config is enabled.
    pub enabled: bool,
    /// Auto-sync interval in seconds (0 = manual only).
    pub interval_secs: u64,
    /// Delete remote files when local files are deleted.
    pub propagate_deletes: bool,
    /// Conflict resolution strategy.
    pub conflict_strategy: ConflictStrategy,
    /// Maximum file size to sync (bytes, 0 = unlimited).
    pub max_file_size: u64,
    /// Whether to preserve modification times.
    pub preserve_mtime: bool,
}

/// How to resolve a file conflict during sync.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConflictStrategy {
    /// Keep the newest version.
    NewestWins,
    /// Keep the local version.
    LocalWins,
    /// Keep the remote version.
    RemoteWins,
    /// Rename the conflicting file and keep both.
    KeepBoth,
    /// Ask the caller / UI.
    Ask,
}

/// Status of a single file within a sync run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SyncFileStatus {
    Pending,
    Uploading,
    Downloading,
    Skipped,
    Conflict,
    Done,
    Error,
}

/// Action taken for a file during sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAction {
    pub path: String,
    pub status: SyncFileStatus,
    pub direction: SyncDirection,
    pub bytes: u64,
    pub error: Option<String>,
}

/// Overall result of a sync run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRunResult {
    pub config_id: String,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub files_uploaded: u32,
    pub files_downloaded: u32,
    pub files_deleted: u32,
    pub files_skipped: u32,
    pub conflicts: u32,
    pub errors: Vec<String>,
    pub actions: Vec<SyncAction>,
}

// ── Backup ───────────────────────────────────────────────────────────────────

/// Configuration for a backup job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    /// Unique identifier.
    pub id: String,
    /// Human-readable label.
    pub label: String,
    /// Paths to include.
    pub includes: BackupIncludes,
    /// Remote directory for storing backups.
    pub remote_dir: String,
    /// Number of backups to retain (0 = unlimited).
    pub retention_count: u32,
    /// Whether this backup config is enabled.
    pub enabled: bool,
    /// Automatic backup interval in seconds (0 = manual only).
    pub interval_secs: u64,
    /// Whether to compress the backup.
    pub compress: bool,
    /// Whether to encrypt the backup.
    pub encrypt: bool,
    /// Encryption passphrase (if encrypt is true).
    pub passphrase: Option<String>,
}

/// What to include in a backup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupIncludes {
    /// Connection database file.
    pub connections: bool,
    /// Credentials / secure storage.
    pub credentials: bool,
    /// Application settings.
    pub settings: bool,
    /// User scripts.
    pub scripts: bool,
    /// Additional arbitrary file paths.
    pub extra_paths: Vec<String>,
}

/// Result of a backup run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub config_id: String,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub remote_path: String,
    pub size_bytes: u64,
    pub success: bool,
    pub error: Option<String>,
}

// ── Watcher ──────────────────────────────────────────────────────────────────

/// Configuration for watching a remote directory for changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchConfig {
    /// Unique id.
    pub id: String,
    /// Remote path to watch.
    pub remote_path: String,
    /// Whether to watch recursively.
    pub recursive: bool,
    /// Polling interval in seconds.
    pub poll_interval_secs: u64,
    /// Whether this watch is active.
    pub enabled: bool,
    /// Glob patterns to ignore.
    pub ignore_patterns: Vec<String>,
}

/// Type of change detected.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChangeType {
    Created,
    Modified,
    Deleted,
    Moved,
}

/// A single detected file change.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub change_type: ChangeType,
    pub resource_type: DavResourceType,
    pub etag: Option<String>,
    pub size: Option<u64>,
    pub detected_at: DateTime<Utc>,
}

// ── Statistics ────────────────────────────────────────────────────────────────

/// Cumulative account usage statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountStats {
    pub total_api_calls: u64,
    pub total_bytes_uploaded: u64,
    pub total_bytes_downloaded: u64,
    pub total_files_listed: u64,
    pub total_shares_created: u64,
    pub total_sync_runs: u64,
    pub total_backup_runs: u64,
    pub last_activity: Option<DateTime<Utc>>,
}

impl Default for AccountStats {
    fn default() -> Self {
        Self {
            total_api_calls: 0,
            total_bytes_uploaded: 0,
            total_bytes_downloaded: 0,
            total_files_listed: 0,
            total_shares_created: 0,
            total_sync_runs: 0,
            total_backup_runs: 0,
            last_activity: None,
        }
    }
}

// ── Activity Log ─────────────────────────────────────────────────────────────

/// Internal activity log entry for the service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceLogEntry {
    pub timestamp: DateTime<Utc>,
    pub action: String,
    pub detail: String,
    pub success: bool,
}

// ── WebDAV XML helpers ──────────────────────────────────────────────────────

/// Represents a `<d:response>` in a WebDAV multistatus response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DavMultistatus {
    pub responses: Vec<DavResponseXml>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DavResponseXml {
    pub href: String,
    pub propstat: Vec<DavPropstat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DavPropstat {
    pub status: String,
    pub prop: DavPropXml,
}

/// Raw property values extracted from XML; converted into `DavResource` by the parser.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DavPropXml {
    pub displayname: Option<String>,
    pub getcontenttype: Option<String>,
    pub getcontentlength: Option<String>,
    pub getetag: Option<String>,
    pub getlastmodified: Option<String>,
    pub resourcetype: Option<String>,
    pub fileid: Option<String>,
    pub owner_id: Option<String>,
    pub owner_display_name: Option<String>,
    pub permissions: Option<String>,
    pub checksum: Option<String>,
    pub has_preview: Option<String>,
    pub favorite: Option<String>,
    pub comments_count: Option<String>,
    pub size: Option<String>,
    pub tags: Vec<String>,
}

// ── Batch & Async Job ────────────────────────────────────────────────────────

/// Status of a batch / async operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BatchJobStatus {
    Queued,
    InProgress,
    Complete,
    Failed,
}

/// Tracks progress of a batch operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchJob {
    pub id: String,
    pub status: BatchJobStatus,
    pub total: u32,
    pub completed: u32,
    pub failed: u32,
    pub errors: Vec<String>,
}

// ── Thumbnail / Preview ──────────────────────────────────────────────────────

/// Arguments for requesting a file preview.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewArgs {
    /// Remote path of the file.
    pub path: String,
    /// Desired width in pixels.
    pub width: u32,
    /// Desired height in pixels.
    pub height: u32,
    /// Crop mode ("fill" or "fit").
    pub mode: Option<String>,
    /// Force icon placeholder if no preview available.
    pub force_icon: Option<bool>,
}

// ── Talk / Spreed types (lightweight) ────────────────────────────────────────

/// A Nextcloud Talk conversation (minimal for share integration).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TalkConversation {
    pub id: u64,
    pub token: String,
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "type")]
    pub conversation_type: u32,
    #[serde(rename = "readOnly")]
    pub read_only: Option<u32>,
}

// ── Deck types (lightweight) ─────────────────────────────────────────────────

/// A Nextcloud Deck board (minimal for share integration).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeckBoard {
    pub id: u64,
    pub title: String,
    pub owner: DeckUser,
    pub color: Option<String>,
    pub archived: bool,
    pub shared: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeckUser {
    #[serde(rename = "primaryKey")]
    pub primary_key: String,
    pub uid: String,
    #[serde(rename = "displayname")]
    pub display_name: String,
}

// ── Error ────────────────────────────────────────────────────────────────────

/// Structured error returned from the Nextcloud client / service layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NextcloudError {
    pub code: Option<u32>,
    pub message: String,
    pub category: ErrorCategory,
}

/// High-level error classification.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ErrorCategory {
    /// Network or connection failure.
    Network,
    /// 401 / 403 – credentials invalid or expired.
    Auth,
    /// 404 – resource not found.
    NotFound,
    /// 409 – conflict (e.g. already exists).
    Conflict,
    /// 507 – insufficient storage.
    InsufficientStorage,
    /// Server maintenance mode.
    Maintenance,
    /// Rate-limited (429).
    RateLimited,
    /// WebDAV XML parse error.
    Parse,
    /// Catch-all.
    Other,
}

impl std::fmt::Display for NextcloudError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(c) = self.code {
            write!(f, "[{}] {}", c, self.message)
        } else {
            write!(f, "{}", self.message)
        }
    }
}

impl std::error::Error for NextcloudError {}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_account_config() {
        let c = NextcloudAccountConfig::default();
        assert!(!c.enabled);
        assert!(c.server_url.is_empty());
    }

    #[test]
    fn auth_method_default_is_none() {
        assert_eq!(AuthMethod::default(), AuthMethod::None);
    }

    #[test]
    fn propfind_depth_as_str() {
        assert_eq!(PropfindDepth::Zero.as_str(), "0");
        assert_eq!(PropfindDepth::One.as_str(), "1");
        assert_eq!(PropfindDepth::Infinity.as_str(), "infinity");
    }

    #[test]
    fn share_type_round_trip() {
        for v in [0, 1, 3, 4, 6, 7, 10, 12, 15] {
            let st = ShareType::from_i32(v).unwrap();
            assert_eq!(st.as_i32(), v);
        }
        assert!(ShareType::from_i32(99).is_none());
    }

    #[test]
    fn share_permissions_flags() {
        let p = SharePermissions(SharePermissions::READ | SharePermissions::CREATE);
        assert!(p.can_read());
        assert!(p.can_create());
        assert!(!p.can_update());
        assert!(!p.can_delete());
        assert!(!p.can_share());
    }

    #[test]
    fn share_permissions_all() {
        let p = SharePermissions(SharePermissions::ALL);
        assert!(p.can_read());
        assert!(p.can_update());
        assert!(p.can_create());
        assert!(p.can_delete());
        assert!(p.can_share());
    }

    #[test]
    fn default_search_query() {
        let q = SearchQuery::default();
        assert!(q.term.is_empty());
        assert_eq!(q.limit, None);
        assert!(!q.favorite_only);
    }

    #[test]
    fn dav_resource_default() {
        let r = DavResource::default();
        assert_eq!(r.resource_type, DavResourceType::File);
        assert!(r.tags.is_empty());
    }

    #[test]
    fn account_stats_default() {
        let s = AccountStats::default();
        assert_eq!(s.total_api_calls, 0);
        assert_eq!(s.total_bytes_uploaded, 0);
    }

    #[test]
    fn nextcloud_error_display_with_code() {
        let e = NextcloudError {
            code: Some(404),
            message: "Not Found".into(),
            category: ErrorCategory::NotFound,
        };
        assert_eq!(format!("{}", e), "[404] Not Found");
    }

    #[test]
    fn nextcloud_error_display_without_code() {
        let e = NextcloudError {
            code: None,
            message: "parse failure".into(),
            category: ErrorCategory::Parse,
        };
        assert_eq!(format!("{}", e), "parse failure");
    }

    #[test]
    fn conflict_strategy_variants() {
        let s = ConflictStrategy::NewestWins;
        assert_eq!(s, ConflictStrategy::NewestWins);
    }

    #[test]
    fn sync_direction_variants() {
        assert_ne!(SyncDirection::Upload, SyncDirection::Download);
        assert_ne!(SyncDirection::Upload, SyncDirection::Bidirectional);
    }

    #[test]
    fn batch_job_status_variants() {
        assert_ne!(BatchJobStatus::Queued, BatchJobStatus::InProgress);
        assert_ne!(BatchJobStatus::Complete, BatchJobStatus::Failed);
    }

    #[test]
    fn change_type_variants() {
        assert_ne!(ChangeType::Created, ChangeType::Deleted);
        assert_ne!(ChangeType::Modified, ChangeType::Moved);
    }

    #[test]
    fn ocs_meta_serialization() {
        let meta = OcsMeta {
            status: "ok".into(),
            statuscode: 100,
            message: Some("OK".into()),
            total_items: None,
            items_per_page: None,
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("\"statuscode\":100"));
    }

    #[test]
    fn error_category_equality() {
        assert_eq!(ErrorCategory::Network, ErrorCategory::Network);
        assert_ne!(ErrorCategory::Auth, ErrorCategory::NotFound);
    }
}
