//! Shared types for the Microsoft OneDrive / SharePoint / Graph API integration.
//!
//! Models cover OAuth2 tokens, drives, drive items (files & folders),
//! permissions, sharing links, thumbnails, upload sessions, delta queries,
//! search, subscriptions (webhooks), special folders, hashes, quotas,
//! conflict behaviour, and analytics.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════
//  Configuration
// ═══════════════════════════════════════════════════════════════════════

/// Configuration for a OneDrive/Graph API connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneDriveConfig {
    /// Azure AD / Entra ID application (client) ID.
    pub client_id: String,
    /// Client secret (for confidential-client flows).
    pub client_secret: Option<String>,
    /// Azure AD tenant ID (`common`, `organizations`, `consumers`, or a GUID).
    pub tenant_id: String,
    /// OAuth2 redirect URI registered in the app registration.
    pub redirect_uri: String,
    /// Graph API base URL.  Default: `https://graph.microsoft.com/v1.0`.
    pub graph_base_url: String,
    /// Timeout in seconds for HTTP calls.  Default: 60.
    pub timeout_sec: u64,
    /// Maximum automatic retries for transient failures.  Default: 3.
    pub max_retries: u32,
}

impl Default for OneDriveConfig {
    fn default() -> Self {
        Self {
            client_id: String::new(),
            client_secret: None,
            tenant_id: "common".into(),
            redirect_uri: "http://localhost:8400/auth/callback".into(),
            graph_base_url: "https://graph.microsoft.com/v1.0".into(),
            timeout_sec: 60,
            max_retries: 3,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  OAuth2 / Authentication
// ═══════════════════════════════════════════════════════════════════════

/// OAuth2 token set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthTokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub expires_at: DateTime<Utc>,
    pub scope: String,
    pub id_token: Option<String>,
}

impl OAuthTokenSet {
    /// Whether the access token has expired (with 60-second grace).
    pub fn is_expired(&self) -> bool {
        Utc::now() >= self.expires_at - chrono::Duration::seconds(60)
    }
}

/// PKCE challenge pair.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PkceChallenge {
    pub code_verifier: String,
    pub code_challenge: String,
    pub method: String,
}

/// Device-code-flow polling state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeInfo {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

/// Minimal Microsoft user profile from /me.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphUserProfile {
    pub id: String,
    pub display_name: Option<String>,
    pub user_principal_name: Option<String>,
    pub mail: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Drive
// ═══════════════════════════════════════════════════════════════════════

/// A OneDrive drive.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub drive_type: Option<String>,
    pub owner: Option<IdentitySet>,
    pub quota: Option<DriveQuota>,
    pub web_url: Option<String>,
    pub created_date_time: Option<String>,
    pub last_modified_date_time: Option<String>,
}

/// Drive storage quota.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveQuota {
    pub deleted: Option<i64>,
    pub remaining: Option<i64>,
    pub state: Option<String>,
    pub total: Option<i64>,
    pub used: Option<i64>,
    pub storage_plan_information: Option<StoragePlanInfo>,
}

/// Storage plan info inside a DriveQuota.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePlanInfo {
    pub upgrade_available: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Drive Items  (files, folders, packages)
// ═══════════════════════════════════════════════════════════════════════

/// Core resource representing a file, folder, or other item in a drive.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveItem {
    pub id: String,
    pub name: Option<String>,
    pub size: Option<i64>,
    pub web_url: Option<String>,
    pub description: Option<String>,
    pub created_date_time: Option<String>,
    pub last_modified_date_time: Option<String>,
    pub e_tag: Option<String>,
    pub c_tag: Option<String>,
    pub parent_reference: Option<ItemReference>,
    pub file: Option<FileInfo>,
    pub folder: Option<FolderInfo>,
    pub image: Option<ImageInfo>,
    pub video: Option<VideoInfo>,
    pub audio: Option<AudioInfo>,
    pub photo: Option<PhotoInfo>,
    pub remote_item: Option<Box<DriveItem>>,
    pub root: Option<serde_json::Value>,
    #[serde(rename = "package")]
    pub package_info: Option<PackageInfo>,
    pub shared: Option<SharedInfo>,
    pub sharepoint_ids: Option<SharePointIds>,
    pub special_folder: Option<SpecialFolderInfo>,
    pub deleted: Option<DeletedInfo>,
    pub malware: Option<MalwareInfo>,
    pub content_download_url: Option<String>,
    pub created_by: Option<IdentitySet>,
    pub last_modified_by: Option<IdentitySet>,
    pub thumbnails: Option<Vec<ThumbnailSet>>,
    #[serde(rename = "@microsoft.graph.downloadUrl")]
    pub download_url: Option<String>,
    #[serde(rename = "@odata.nextLink")]
    pub odata_next_link: Option<String>,
}

/// Reference to a parent item / location.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemReference {
    pub drive_id: Option<String>,
    pub drive_type: Option<String>,
    pub id: Option<String>,
    pub name: Option<String>,
    pub path: Option<String>,
    pub share_id: Option<String>,
    pub site_id: Option<String>,
}

/// File-specific metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub mime_type: Option<String>,
    pub hashes: Option<FileHashes>,
    pub processing_metadata: Option<bool>,
}

/// Hashes for a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHashes {
    pub crc32_hash: Option<String>,
    pub sha1_hash: Option<String>,
    pub sha256_hash: Option<String>,
    pub quick_xor_hash: Option<String>,
}

/// Folder-specific metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub child_count: Option<i32>,
    pub view: Option<FolderView>,
}

/// Folder view settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderView {
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub view_type: Option<String>,
}

/// Image metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageInfo {
    pub height: Option<i32>,
    pub width: Option<i32>,
}

/// Video metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub audio_bits_per_sample: Option<i32>,
    pub audio_channels: Option<i32>,
    pub audio_format: Option<String>,
    pub audio_samples_per_second: Option<i32>,
    pub bitrate: Option<i64>,
    pub duration: Option<i64>,
    pub four_cc: Option<String>,
    pub frame_rate: Option<f64>,
    pub height: Option<i32>,
    pub width: Option<i32>,
}

/// Audio metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub artist: Option<String>,
    pub bitrate: Option<i64>,
    pub composers: Option<String>,
    pub copyright: Option<String>,
    pub disc: Option<i32>,
    pub disc_count: Option<i32>,
    pub duration: Option<i64>,
    pub genre: Option<String>,
    pub has_drm: Option<bool>,
    pub is_variable_bitrate: Option<bool>,
    pub title: Option<String>,
    pub track: Option<i32>,
    pub track_count: Option<i32>,
    pub year: Option<i32>,
}

/// Photo metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoInfo {
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub exposure_denominator: Option<f64>,
    pub exposure_numerator: Option<f64>,
    pub f_number: Option<f64>,
    pub focal_length: Option<f64>,
    pub iso: Option<i32>,
    pub orientation: Option<i32>,
    pub taken_date_time: Option<String>,
}

/// Package info (OneNote notebook, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageInfo {
    #[serde(rename = "type")]
    pub package_type: Option<String>,
}

/// Shared information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedInfo {
    pub owner: Option<IdentitySet>,
    pub scope: Option<String>,
    pub shared_by: Option<IdentitySet>,
    pub shared_date_time: Option<String>,
}

/// SharePoint IDs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePointIds {
    pub list_id: Option<String>,
    pub list_item_id: Option<String>,
    pub list_item_unique_id: Option<String>,
    pub site_id: Option<String>,
    pub site_url: Option<String>,
    pub tenant_id: Option<String>,
    pub web_id: Option<String>,
}

/// Special folder info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecialFolderInfo {
    pub name: Option<String>,
}

/// Deleted facet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletedInfo {
    pub state: Option<String>,
}

/// Malware facet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MalwareInfo {
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Identity
// ═══════════════════════════════════════════════════════════════════════

/// A set of identities (user, application, device).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentitySet {
    pub application: Option<Identity>,
    pub device: Option<Identity>,
    pub user: Option<Identity>,
}

/// A single identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: Option<String>,
    pub display_name: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Permissions & Sharing
// ═══════════════════════════════════════════════════════════════════════

/// A permission on a drive item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permission {
    pub id: String,
    pub roles: Vec<String>,
    pub granted_to: Option<IdentitySet>,
    pub granted_to_identities: Option<Vec<IdentitySet>>,
    pub invitation: Option<SharingInvitation>,
    pub inherited_from: Option<ItemReference>,
    pub link: Option<SharingLink>,
    pub share_id: Option<String>,
    pub expiration_date_time: Option<String>,
    pub has_password: Option<bool>,
}

/// Sharing link details.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharingLink {
    pub scope: Option<String>,
    #[serde(rename = "type")]
    pub link_type: Option<String>,
    pub web_url: Option<String>,
    pub web_html: Option<String>,
    pub application: Option<Identity>,
    pub prevents_download: Option<bool>,
}

/// Sharing invitation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharingInvitation {
    pub email: Option<String>,
    pub invited_by: Option<IdentitySet>,
    pub redeemed_by: Option<String>,
    pub sign_in_required: Option<bool>,
}

/// Request body for creating a sharing link.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLinkRequest {
    /// `view`, `edit`, or `embed`.
    #[serde(rename = "type")]
    pub link_type: String,
    /// `anonymous`, `organization`, or `users`.
    pub scope: Option<String>,
    /// Expiration as RFC 3339 timestamp.
    pub expiration_date_time: Option<String>,
    pub password: Option<String>,
    pub retain_inherited_permissions: Option<bool>,
}

/// Invite recipients request body.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteRequest {
    pub recipients: Vec<DriveRecipient>,
    pub roles: Vec<String>,
    pub require_sign_in: Option<bool>,
    pub send_invitation: Option<bool>,
    pub message: Option<String>,
    pub expiration_date_time: Option<String>,
    pub password: Option<String>,
    pub retain_inherited_permissions: Option<bool>,
}

/// A recipient for a sharing invite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveRecipient {
    pub email: Option<String>,
    pub alias: Option<String>,
    #[serde(rename = "objectId")]
    pub object_id: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Thumbnails
// ═══════════════════════════════════════════════════════════════════════

/// A set of thumbnails for a drive item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailSet {
    pub id: Option<String>,
    pub large: Option<Thumbnail>,
    pub medium: Option<Thumbnail>,
    pub small: Option<Thumbnail>,
    pub source: Option<Thumbnail>,
}

/// A single thumbnail image.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thumbnail {
    pub url: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    #[serde(rename = "sourceItemId")]
    pub source_item_id: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Upload Sessions (resumable uploads)
// ═══════════════════════════════════════════════════════════════════════

/// Server-created upload session for resumable large file uploads.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSession {
    pub upload_url: String,
    pub expiration_date_time: Option<String>,
    pub next_expected_ranges: Option<Vec<String>>,
}

/// Progress of a resumable upload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadProgress {
    pub session_url: String,
    pub file_name: String,
    pub file_size: u64,
    pub bytes_uploaded: u64,
    pub completed: bool,
    pub drive_item: Option<DriveItem>,
}

/// Options for creating an upload session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSessionCreateRequest {
    pub item: Option<DriveItemUploadProperties>,
    #[serde(rename = "@microsoft.graph.conflictBehavior")]
    pub conflict_behavior: Option<ConflictBehavior>,
}

/// Properties for an item being uploaded.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveItemUploadProperties {
    pub name: Option<String>,
    pub description: Option<String>,
    pub file_system_info: Option<FileSystemInfo>,
}

/// File-system timestamps that can be set on upload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSystemInfo {
    pub created_date_time: Option<String>,
    pub last_accessed_date_time: Option<String>,
    pub last_modified_date_time: Option<String>,
}

/// Conflict behaviour on upload / copy / move.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictBehavior {
    Fail,
    Replace,
    Rename,
}

// ═══════════════════════════════════════════════════════════════════════
//  Delta / Sync
// ═══════════════════════════════════════════════════════════════════════

/// A page of delta results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaResponse {
    pub value: Vec<DriveItem>,
    #[serde(rename = "@odata.nextLink")]
    pub next_link: Option<String>,
    #[serde(rename = "@odata.deltaLink")]
    pub delta_link: Option<String>,
}

/// Local delta sync state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaSyncState {
    pub drive_id: String,
    pub delta_link: Option<String>,
    pub last_sync: Option<DateTime<Utc>>,
    pub synced_items: u64,
}

// ═══════════════════════════════════════════════════════════════════════
//  Search
// ═══════════════════════════════════════════════════════════════════════

/// Search result page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultPage {
    pub value: Vec<DriveItem>,
    #[serde(rename = "@odata.nextLink")]
    pub next_link: Option<String>,
    /// Total estimated matches (Graph may return this as `@odata.count`).
    pub total_count: Option<i64>,
}

/// Options for a search query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchOptions {
    /// Free-text query (KQL-compatible on SharePoint).
    pub query: String,
    /// Maximum results per page.  Default: 200.
    pub top: Option<i32>,
    /// Which drive to search (`me`, a drive ID, or `sites/{id}`).
    pub scope: Option<String>,
    /// Optional OData $select fields.
    pub select: Option<Vec<String>>,
    /// Optional OData $filter.
    pub filter: Option<String>,
    /// Optional OData $orderby.
    pub order_by: Option<String>,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            query: String::new(),
            top: Some(200),
            scope: None,
            select: None,
            filter: None,
            order_by: None,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Webhooks / Subscriptions
// ═══════════════════════════════════════════════════════════════════════

/// A Microsoft Graph subscription (webhook).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub id: Option<String>,
    pub resource: String,
    pub change_type: String,
    pub notification_url: String,
    pub expiration_date_time: String,
    pub client_state: Option<String>,
    pub application_id: Option<String>,
    pub creator_id: Option<String>,
    pub latest_supported_tls_version: Option<String>,
    pub lifecycle_notification_url: Option<String>,
}

/// Create / update subscription request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionRequest {
    pub resource: String,
    pub change_type: String,
    pub notification_url: String,
    pub expiration_date_time: String,
    pub client_state: Option<String>,
    pub lifecycle_notification_url: Option<String>,
}

/// Incoming webhook notification envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookNotificationEnvelope {
    pub value: Vec<WebhookNotification>,
    #[serde(rename = "validationTokens")]
    pub validation_tokens: Option<Vec<String>>,
}

/// A single notification entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookNotification {
    pub subscription_id: Option<String>,
    pub subscription_expiration_date_time: Option<String>,
    pub change_type: Option<String>,
    pub resource: Option<String>,
    pub resource_data: Option<serde_json::Value>,
    pub client_state: Option<String>,
    pub tenant_id: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Special Folders
// ═══════════════════════════════════════════════════════════════════════

/// Well-known special folder names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpecialFolder {
    Documents,
    Photos,
    CameraRoll,
    AppRoot,
    Music,
}

impl SpecialFolder {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Documents => "documents",
            Self::Photos => "photos",
            Self::CameraRoll => "cameraroll",
            Self::AppRoot => "approot",
            Self::Music => "music",
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Copy / Move helpers
// ═══════════════════════════════════════════════════════════════════════

/// Request body for copy operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyRequest {
    pub parent_reference: ItemReference,
    pub name: Option<String>,
}

/// Request body for move / rename operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveRequest {
    pub parent_reference: Option<ItemReference>,
    pub name: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Pagination (Graph OData)
// ═══════════════════════════════════════════════════════════════════════

/// Generic paginated response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResponse<T> {
    pub value: Vec<T>,
    #[serde(rename = "@odata.nextLink")]
    pub next_link: Option<String>,
    #[serde(rename = "@odata.count")]
    pub count: Option<i64>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Activity / Analytics
// ═══════════════════════════════════════════════════════════════════════

/// Item activity stat.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemActivityStat {
    pub start_date_time: Option<String>,
    pub end_date_time: Option<String>,
    pub access: Option<ItemActionStat>,
    pub create: Option<ItemActionStat>,
    pub delete: Option<ItemActionStat>,
    pub edit: Option<ItemActionStat>,
    pub move_action: Option<ItemActionStat>,
    pub is_trending: Option<bool>,
}

/// Aggregate action stat.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemActionStat {
    pub action_count: Option<i64>,
    pub actor_count: Option<i64>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Session / Service State
// ═══════════════════════════════════════════════════════════════════════

/// Runtime state for a OneDrive connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneDriveSession {
    pub id: String,
    pub user_profile: Option<GraphUserProfile>,
    pub token: OAuthTokenSet,
    pub config: OneDriveConfig,
    pub default_drive_id: Option<String>,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
}

/// Summary for UI display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneDriveSessionSummary {
    pub session_id: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub drive_type: Option<String>,
    pub quota_used: Option<i64>,
    pub quota_total: Option<i64>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Trash / Recycle Bin
// ═══════════════════════════════════════════════════════════════════════

/// Options for listing items in the recycle bin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashListOptions {
    pub top: Option<i32>,
    pub order_by: Option<String>,
    pub select: Option<Vec<String>>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Versions
// ═══════════════════════════════════════════════════════════════════════

/// File version.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveItemVersion {
    pub id: String,
    pub last_modified_date_time: Option<String>,
    pub last_modified_by: Option<IdentitySet>,
    pub size: Option<i64>,
    pub content_download_url: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Preview
// ═══════════════════════════════════════════════════════════════════════

/// Embeddable preview URLs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPreview {
    pub get_url: Option<String>,
    pub post_url: Option<String>,
    pub post_parameters: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let cfg = OneDriveConfig::default();
        assert_eq!(cfg.tenant_id, "common");
        assert_eq!(cfg.graph_base_url, "https://graph.microsoft.com/v1.0");
        assert_eq!(cfg.timeout_sec, 60);
        assert_eq!(cfg.max_retries, 3);
    }

    #[test]
    fn test_token_expired() {
        let token = OAuthTokenSet {
            access_token: "abc".into(),
            refresh_token: None,
            token_type: "Bearer".into(),
            expires_at: Utc::now() - chrono::Duration::seconds(120),
            scope: "Files.ReadWrite.All".into(),
            id_token: None,
        };
        assert!(token.is_expired());
    }

    #[test]
    fn test_token_not_expired() {
        let token = OAuthTokenSet {
            access_token: "abc".into(),
            refresh_token: None,
            token_type: "Bearer".into(),
            expires_at: Utc::now() + chrono::Duration::hours(1),
            scope: "Files.ReadWrite.All".into(),
            id_token: None,
        };
        assert!(!token.is_expired());
    }

    #[test]
    fn test_special_folder_as_str() {
        assert_eq!(SpecialFolder::Documents.as_str(), "documents");
        assert_eq!(SpecialFolder::CameraRoll.as_str(), "cameraroll");
        assert_eq!(SpecialFolder::AppRoot.as_str(), "approot");
    }

    #[test]
    fn test_drive_item_json_round_trip() {
        let item = DriveItem {
            id: "abc123".into(),
            name: Some("test.txt".into()),
            size: Some(1024),
            web_url: None,
            description: None,
            created_date_time: None,
            last_modified_date_time: None,
            e_tag: None,
            c_tag: None,
            parent_reference: None,
            file: Some(FileInfo {
                mime_type: Some("text/plain".into()),
                hashes: None,
                processing_metadata: None,
            }),
            folder: None,
            image: None,
            video: None,
            audio: None,
            photo: None,
            remote_item: None,
            root: None,
            package_info: None,
            shared: None,
            sharepoint_ids: None,
            special_folder: None,
            deleted: None,
            malware: None,
            content_download_url: None,
            created_by: None,
            last_modified_by: None,
            thumbnails: None,
            download_url: None,
            odata_next_link: None,
        };
        let json_str = serde_json::to_string(&item).unwrap();
        let parsed: DriveItem = serde_json::from_str(&json_str).unwrap();
        assert_eq!(parsed.id, "abc123");
        assert_eq!(parsed.name.as_deref(), Some("test.txt"));
        assert_eq!(parsed.size, Some(1024));
    }

    #[test]
    fn test_conflict_behavior_serde() {
        let json = serde_json::to_string(&ConflictBehavior::Rename).unwrap();
        assert_eq!(json, "\"rename\"");
        let parsed: ConflictBehavior = serde_json::from_str("\"replace\"").unwrap();
        assert!(matches!(parsed, ConflictBehavior::Replace));
    }

    #[test]
    fn test_paginated_response_deserialize() {
        let json_str = r#"{
            "value": [{"id": "d1", "name": "My Drive"}],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/next?page=2",
            "@odata.count": 42
        }"#;
        let resp: PaginatedResponse<Drive> = serde_json::from_str(json_str).unwrap();
        assert_eq!(resp.value.len(), 1);
        assert_eq!(resp.value[0].id, "d1");
        assert!(resp.next_link.is_some());
        assert_eq!(resp.count, Some(42));
    }

    #[test]
    fn test_permission_serde() {
        let perm = Permission {
            id: "perm1".into(),
            roles: vec!["read".into()],
            granted_to: Some(IdentitySet {
                application: None,
                device: None,
                user: Some(Identity {
                    id: Some("user1".into()),
                    display_name: Some("Alice".into()),
                }),
            }),
            granted_to_identities: None,
            invitation: None,
            inherited_from: None,
            link: None,
            share_id: None,
            expiration_date_time: None,
            has_password: None,
        };
        let json_str = serde_json::to_string(&perm).unwrap();
        let parsed: Permission = serde_json::from_str(&json_str).unwrap();
        assert_eq!(parsed.id, "perm1");
        assert_eq!(parsed.roles, vec!["read"]);
    }

    #[test]
    fn test_upload_session_deserialize() {
        let json_str = r#"{
            "uploadUrl": "https://graph.microsoft.com/upload/abc",
            "expirationDateTime": "2026-01-01T00:00:00Z",
            "nextExpectedRanges": ["0-"]
        }"#;
        let sess: UploadSession = serde_json::from_str(json_str).unwrap();
        assert_eq!(sess.upload_url, "https://graph.microsoft.com/upload/abc");
        assert!(sess.next_expected_ranges.is_some());
    }

    #[test]
    fn test_delta_response_deserialize() {
        let json_str = r#"{
            "value": [],
            "@odata.deltaLink": "https://graph.microsoft.com/delta?token=abc"
        }"#;
        let resp: DeltaResponse = serde_json::from_str(json_str).unwrap();
        assert!(resp.value.is_empty());
        assert!(resp.delta_link.is_some());
        assert!(resp.next_link.is_none());
    }

    #[test]
    fn test_subscription_serde() {
        let sub = Subscription {
            id: Some("sub1".into()),
            resource: "/me/drive/root".into(),
            change_type: "updated".into(),
            notification_url: "https://example.com/hook".into(),
            expiration_date_time: "2026-12-31T00:00:00Z".into(),
            client_state: Some("my_state".into()),
            application_id: None,
            creator_id: None,
            latest_supported_tls_version: None,
            lifecycle_notification_url: None,
        };
        let json_str = serde_json::to_string(&sub).unwrap();
        let parsed: Subscription = serde_json::from_str(&json_str).unwrap();
        assert_eq!(parsed.resource, "/me/drive/root");
    }
}
