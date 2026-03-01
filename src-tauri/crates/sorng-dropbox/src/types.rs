//! Shared types for all Dropbox API v2 interactions.
//!
//! Models the Dropbox HTTP API responses and request payloads so that
//! higher-level modules can work with strongly-typed Rust values.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Configuration for a Dropbox account connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropboxAccountConfig {
    /// Unique user-chosen name for this account.
    pub name: String,
    /// OAuth 2.0 app key (client id).
    pub app_key: String,
    /// Optional app secret (confidential apps).
    #[serde(default)]
    pub app_secret: Option<String>,
    /// Current access token.
    #[serde(default)]
    pub access_token: Option<String>,
    /// Refresh token for long-lived access.
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// Token expiry timestamp.
    #[serde(default)]
    pub token_expires_at: Option<DateTime<Utc>>,
    /// Dropbox account ID returned after auth.
    #[serde(default)]
    pub account_id: Option<String>,
    /// Whether this account is enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Base path root (namespace) — for team accounts.
    #[serde(default)]
    pub path_root: Option<String>,
}

fn default_true() -> bool {
    true
}

impl Default for DropboxAccountConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            app_key: String::new(),
            app_secret: None,
            access_token: None,
            refresh_token: None,
            token_expires_at: None,
            account_id: None,
            enabled: true,
            path_root: None,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OAuth 2.0
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// State for an in-progress PKCE authorization flow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthPkceState {
    pub code_verifier: String,
    pub code_challenge: String,
    pub state: String,
    pub redirect_uri: String,
}

/// Token response from `/oauth2/token`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub token_type: Option<String>,
    #[serde(default)]
    pub expires_in: Option<i64>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub uid: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub team_id: Option<String>,
}

/// Summary of an account for listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSummary {
    pub name: String,
    pub enabled: bool,
    pub authenticated: bool,
    pub account_id: Option<String>,
    pub token_expires_at: Option<DateTime<Utc>>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Dropbox API Error
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Dropbox API v2 error envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropboxApiError {
    #[serde(default)]
    pub error_summary: Option<String>,
    #[serde(default)]
    pub error: Option<serde_json::Value>,
    #[serde(default)]
    pub user_message: Option<DropboxUserMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropboxUserMessage {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Metadata — Files & Folders
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Tag used to discriminate file vs folder vs deleted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MetadataTag {
    File,
    Folder,
    Deleted,
}

/// Unified metadata entry (Dropbox returns a union type).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metadata {
    #[serde(rename = ".tag")]
    pub tag: MetadataTag,
    pub name: String,
    #[serde(default)]
    pub path_lower: Option<String>,
    #[serde(default)]
    pub path_display: Option<String>,
    #[serde(default)]
    pub id: Option<String>,

    // File-specific fields
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub rev: Option<String>,
    #[serde(default)]
    pub content_hash: Option<String>,
    #[serde(default)]
    pub client_modified: Option<DateTime<Utc>>,
    #[serde(default)]
    pub server_modified: Option<DateTime<Utc>>,
    #[serde(default)]
    pub is_downloadable: Option<bool>,
    #[serde(default)]
    pub media_info: Option<serde_json::Value>,
    #[serde(default)]
    pub symlink_info: Option<serde_json::Value>,
    #[serde(default)]
    pub sharing_info: Option<serde_json::Value>,
    #[serde(default)]
    pub property_groups: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub has_explicit_shared_members: Option<bool>,
    #[serde(default)]
    pub file_lock_info: Option<FileLockInfo>,
}

/// File lock information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileLockInfo {
    #[serde(default)]
    pub is_lockholder: Option<bool>,
    #[serde(default)]
    pub lockholder_name: Option<String>,
    #[serde(default)]
    pub lockholder_account_id: Option<String>,
    #[serde(default)]
    pub created: Option<DateTime<Utc>>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  List Folder
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListFolderRequest {
    pub path: String,
    #[serde(default)]
    pub recursive: bool,
    #[serde(default)]
    pub include_media_info: bool,
    #[serde(default)]
    pub include_deleted: bool,
    #[serde(default)]
    pub include_has_explicit_shared_members: bool,
    #[serde(default)]
    pub include_mounted_folders: bool,
    #[serde(default)]
    pub include_non_downloadable_files: bool,
    #[serde(default)]
    pub limit: Option<u32>,
}

impl Default for ListFolderRequest {
    fn default() -> Self {
        Self {
            path: String::new(),
            recursive: false,
            include_media_info: false,
            include_deleted: false,
            include_has_explicit_shared_members: false,
            include_mounted_folders: true,
            include_non_downloadable_files: true,
            limit: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListFolderResult {
    pub entries: Vec<Metadata>,
    pub cursor: String,
    pub has_more: bool,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  File Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Write mode for uploads.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WriteMode {
    #[default]
    Add,
    Overwrite,
    /// Expects a specific rev; conflicts fail.
    Update(String),
}

/// Arguments for a simple upload (≤ 150 MB).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadArgs {
    pub path: String,
    #[serde(default)]
    pub mode: WriteMode,
    #[serde(default)]
    pub autorename: bool,
    #[serde(default)]
    pub mute: bool,
    #[serde(default)]
    pub strict_conflict: bool,
    #[serde(default)]
    pub client_modified: Option<DateTime<Utc>>,
    #[serde(default)]
    pub content_hash: Option<String>,
}

/// Result of starting an upload session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadSessionStartResult {
    pub session_id: String,
}

/// Cursor for an upload session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadSessionCursor {
    pub session_id: String,
    pub offset: u64,
}

/// Commit info for finishing an upload session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadSessionFinishArg {
    pub cursor: UploadSessionCursor,
    pub commit: UploadArgs,
}

/// Args for move/copy operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelocationArg {
    pub from_path: String,
    pub to_path: String,
    #[serde(default)]
    pub allow_shared_folder: bool,
    #[serde(default)]
    pub autorename: bool,
    #[serde(default)]
    pub allow_ownership_transfer: bool,
}

/// Batch relocation entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelocationBatchArg {
    pub entries: Vec<RelocationArg>,
    #[serde(default)]
    pub autorename: bool,
    #[serde(default)]
    pub allow_ownership_transfer: bool,
}

/// Delete arg.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteArg {
    pub path: String,
    #[serde(default)]
    pub parent_rev: Option<String>,
}

/// Batch delete.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteBatchArg {
    pub entries: Vec<DeleteArg>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Search
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchV2Arg {
    pub query: String,
    #[serde(default)]
    pub options: Option<SearchOptions>,
    #[serde(default)]
    pub match_field_options: Option<SearchMatchFieldOptions>,
    #[serde(default)]
    pub include_highlights: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchOptions {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub max_results: Option<u64>,
    #[serde(default)]
    pub order_by: Option<SearchOrderBy>,
    #[serde(default)]
    pub file_status: Option<FileStatus>,
    #[serde(default)]
    pub filename_only: Option<bool>,
    #[serde(default)]
    pub file_extensions: Option<Vec<String>>,
    #[serde(default)]
    pub file_categories: Option<Vec<FileCategory>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchOrderBy {
    Relevance,
    LastModifiedTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileStatus {
    Active,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileCategory {
    Image,
    Document,
    Pdf,
    Spreadsheet,
    Presentation,
    Audio,
    Video,
    Folder,
    Paper,
    Others,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatchFieldOptions {
    #[serde(default)]
    pub include_highlights: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchV2Result {
    pub matches: Vec<SearchMatch>,
    #[serde(default)]
    pub more: Option<bool>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub has_more: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    #[serde(default)]
    pub match_type: Option<SearchMatchType>,
    pub metadata: SearchMatchMetadata,
    #[serde(default)]
    pub highlight_spans: Option<Vec<HighlightSpan>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatchType {
    #[serde(rename = ".tag")]
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatchMetadata {
    pub metadata: Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HighlightSpan {
    pub highlight_str: String,
    pub is_highlighted: bool,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  File Revisions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListRevisionsResult {
    pub is_deleted: bool,
    pub entries: Vec<Metadata>,
    #[serde(default)]
    pub server_deleted: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreArg {
    pub path: String,
    pub rev: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Sharing — Links
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Requested visibility for a shared link.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RequestedVisibility {
    Public,
    TeamOnly,
    Password,
}

/// Audience for a shared link.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LinkAudience {
    Public,
    Team,
    NoOne,
    Password,
    Members,
}

/// Settings for creating a shared link.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedLinkSettings {
    #[serde(default)]
    pub requested_visibility: Option<RequestedVisibility>,
    #[serde(default)]
    pub link_password: Option<String>,
    #[serde(default)]
    pub expires: Option<DateTime<Utc>>,
    #[serde(default)]
    pub audience: Option<LinkAudience>,
    #[serde(default)]
    pub access: Option<RequestedLinkAccessLevel>,
    #[serde(default)]
    pub allow_download: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RequestedLinkAccessLevel {
    Viewer,
    Editor,
    Max,
}

/// Result of creating/getting a shared link.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedLinkMetadata {
    pub url: String,
    pub name: String,
    #[serde(default)]
    pub path_lower: Option<String>,
    #[serde(rename = ".tag")]
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub link_permissions: Option<serde_json::Value>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub expires: Option<DateTime<Utc>>,
    #[serde(default)]
    pub team_member_info: Option<serde_json::Value>,
    #[serde(default)]
    pub content_owner_team_info: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListSharedLinksResult {
    pub links: Vec<SharedLinkMetadata>,
    pub has_more: bool,
    #[serde(default)]
    pub cursor: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Sharing — Folders & Members
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccessLevel {
    Owner,
    Editor,
    Viewer,
    ViewerNoComment,
    Traverse,
    NoAccess,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemberSelector {
    DropboxId(String),
    Email(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddFolderMemberArg {
    pub shared_folder_id: String,
    pub members: Vec<AddMember>,
    #[serde(default)]
    pub quiet: bool,
    #[serde(default)]
    pub custom_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddMember {
    pub member: MemberSelector,
    pub access_level: AccessLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedFolderMetadata {
    pub name: String,
    pub shared_folder_id: String,
    pub access_type: AccessLevel,
    #[serde(default)]
    pub is_inside_team_folder: Option<bool>,
    #[serde(default)]
    pub is_team_folder: Option<bool>,
    #[serde(default)]
    pub path_lower: Option<String>,
    #[serde(default)]
    pub policy: Option<serde_json::Value>,
    #[serde(default)]
    pub preview_url: Option<String>,
    #[serde(default)]
    pub time_invited: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListFolderMembersResult {
    pub users: Vec<UserMembershipInfo>,
    pub groups: Vec<serde_json::Value>,
    pub invitees: Vec<serde_json::Value>,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMembershipInfo {
    pub access_type: AccessLevel,
    pub user: UserInfo,
    #[serde(default)]
    pub is_inherited: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub account_id: String,
    #[serde(default)]
    pub email: Option<String>,
    pub display_name: String,
    #[serde(default)]
    pub same_team: Option<bool>,
    #[serde(default)]
    pub team_member_id: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Account & Space
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullAccount {
    pub account_id: String,
    pub name: AccountName,
    pub email: String,
    #[serde(default)]
    pub email_verified: Option<bool>,
    #[serde(default)]
    pub profile_photo_url: Option<String>,
    #[serde(default)]
    pub disabled: Option<bool>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub referral_link: Option<String>,
    #[serde(default)]
    pub is_paired: Option<bool>,
    #[serde(default)]
    pub account_type: Option<AccountType>,
    #[serde(default)]
    pub root_info: Option<serde_json::Value>,
    #[serde(default)]
    pub team: Option<serde_json::Value>,
    #[serde(default)]
    pub team_member_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountName {
    pub given_name: String,
    pub surname: String,
    pub familiar_name: String,
    pub display_name: String,
    #[serde(default)]
    pub abbreviated_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountType {
    #[serde(rename = ".tag")]
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaceUsage {
    pub used: u64,
    pub allocation: SpaceAllocation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaceAllocation {
    #[serde(rename = ".tag")]
    pub tag: String,
    #[serde(default)]
    pub allocated: Option<u64>,
    #[serde(default)]
    pub used: Option<u64>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Team
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamInfo {
    pub name: String,
    pub team_id: String,
    #[serde(default)]
    pub num_licensed_users: Option<u64>,
    #[serde(default)]
    pub num_provisioned_users: Option<u64>,
    #[serde(default)]
    pub policies: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub profile: TeamMemberProfile,
    #[serde(default)]
    pub role: Option<TeamMemberRole>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMemberProfile {
    pub team_member_id: String,
    pub account_id: String,
    pub email: String,
    #[serde(default)]
    pub name: Option<AccountName>,
    #[serde(default)]
    pub status: Option<TeamMemberStatus>,
    #[serde(default)]
    pub membership_type: Option<serde_json::Value>,
    #[serde(default)]
    pub joined_on: Option<DateTime<Utc>>,
    #[serde(default)]
    pub invited_on: Option<DateTime<Utc>>,
    #[serde(default)]
    pub persistent_id: Option<String>,
    #[serde(default)]
    pub secondary_emails: Option<Vec<SecondaryEmail>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMemberRole {
    #[serde(rename = ".tag")]
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMemberStatus {
    #[serde(rename = ".tag")]
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecondaryEmail {
    pub email: String,
    pub is_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMembersListResult {
    pub members: Vec<TeamMember>,
    pub cursor: String,
    pub has_more: bool,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Paper
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PaperDocExportFormat {
    Html,
    Markdown,
    PlainText,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperDocCreateResult {
    pub doc_id: String,
    pub url: String,
    pub revision: i64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperDocUpdateResult {
    pub doc_id: String,
    pub revision: i64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PaperDocUpdatePolicy {
    Append,
    Prepend,
    Overwrite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperFolder {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperFoldersListResult {
    pub folders: Vec<PaperFolder>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub has_more: Option<bool>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Sync
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Direction of a sync operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncDirection {
    Upload,
    Download,
    Bidirectional,
}

/// Configuration for a sync pair (local folder ↔ Dropbox folder).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    pub id: String,
    pub name: String,
    pub account_name: String,
    pub local_path: String,
    pub dropbox_path: String,
    pub direction: SyncDirection,
    /// Interval in seconds between sync runs.
    #[serde(default = "default_sync_interval")]
    pub interval_seconds: u64,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub exclude_patterns: Vec<String>,
    #[serde(default)]
    pub delete_on_remote: bool,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub last_sync: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_error: Option<String>,
}

fn default_sync_interval() -> u64 {
    300
}

/// Status of a single file in a sync operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncFileStatus {
    pub relative_path: String,
    pub action: SyncAction,
    pub success: bool,
    #[serde(default)]
    pub error: Option<String>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncAction {
    Uploaded,
    Downloaded,
    Deleted,
    Skipped,
    Conflict,
}

/// Summary of a sync run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRunResult {
    pub sync_id: String,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    pub files_uploaded: u64,
    pub files_downloaded: u64,
    pub files_deleted: u64,
    pub files_skipped: u64,
    pub conflicts: u64,
    pub errors: Vec<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Backup
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Configuration for automatic backups to Dropbox.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    pub id: String,
    pub name: String,
    pub account_name: String,
    /// Dropbox folder path to store backups in.
    pub dropbox_path: String,
    /// Interval in seconds between backup runs.
    #[serde(default = "default_backup_interval")]
    pub interval_seconds: u64,
    #[serde(default)]
    pub enabled: bool,
    /// Maximum number of backup revisions to keep.
    #[serde(default = "default_max_revisions")]
    pub max_revisions: u32,
    /// What to include in the backup.
    #[serde(default)]
    pub includes: BackupIncludes,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub last_backup: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_error: Option<String>,
}

fn default_backup_interval() -> u64 {
    3600
}

fn default_max_revisions() -> u32 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupIncludes {
    #[serde(default = "default_true")]
    pub connections: bool,
    #[serde(default = "default_true")]
    pub credentials: bool,
    #[serde(default = "default_true")]
    pub settings: bool,
    #[serde(default)]
    pub scripts: bool,
    #[serde(default)]
    pub templates: bool,
}

impl Default for BackupIncludes {
    fn default() -> Self {
        Self {
            connections: true,
            credentials: true,
            settings: true,
            scripts: false,
            templates: false,
        }
    }
}

/// Result of a backup run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub backup_id: String,
    pub config_id: String,
    pub success: bool,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
    pub timestamp: DateTime<Utc>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub rev: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Watcher (file-change notifications)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Configuration for watching a Dropbox folder for changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchConfig {
    pub id: String,
    pub name: String,
    pub account_name: String,
    pub dropbox_path: String,
    #[serde(default)]
    pub recursive: bool,
    /// Poll interval in seconds.
    #[serde(default = "default_watch_interval")]
    pub interval_seconds: u64,
    #[serde(default)]
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub last_poll: Option<DateTime<Utc>>,
}

fn default_watch_interval() -> u64 {
    60
}

/// A detected change in a watched folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub watch_id: String,
    pub metadata: Metadata,
    pub change_type: ChangeType,
    pub detected_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChangeType {
    Added,
    Modified,
    Deleted,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Batch Job
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Status of an asynchronous batch job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsyncJobStatus {
    #[serde(rename = ".tag")]
    pub tag: String,
    #[serde(default)]
    pub entries: Option<Vec<BatchResultEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchResultEntry {
    #[serde(rename = ".tag")]
    pub tag: String,
    #[serde(default)]
    pub metadata: Option<Metadata>,
    #[serde(default)]
    pub failure: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsyncJobId {
    pub async_job_id: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Thumbnails
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ThumbnailFormat {
    Jpeg,
    Png,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ThumbnailSize {
    #[serde(rename = "w32h32")]
    W32H32,
    #[serde(rename = "w64h64")]
    W64H64,
    #[serde(rename = "w128h128")]
    W128H128,
    #[serde(rename = "w256h256")]
    W256H256,
    #[serde(rename = "w480h320")]
    W480H320,
    #[serde(rename = "w640h480")]
    W640H480,
    #[serde(rename = "w960h640")]
    W960H640,
    #[serde(rename = "w1024h768")]
    W1024H768,
    #[serde(rename = "w2048h1536")]
    W2048H1536,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ThumbnailMode {
    Strict,
    Bestfit,
    FitoneBestfit,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Content Hash
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Dropbox content hash: SHA-256 of 4 MB block hashes concatenated.
pub const CONTENT_HASH_BLOCK_SIZE: usize = 4 * 1024 * 1024;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Stats
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Aggregate statistics for the Dropbox service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropboxStats {
    pub configured_accounts: u64,
    pub enabled_accounts: u64,
    pub total_uploads: u64,
    pub total_downloads: u64,
    pub total_api_calls: u64,
    pub total_bytes_uploaded: u64,
    pub total_bytes_downloaded: u64,
    pub sync_configs: u64,
    pub backup_configs: u64,
    pub watch_configs: u64,
    pub total_sync_runs: u64,
    pub total_backup_runs: u64,
    pub total_changes_detected: u64,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Activity Log
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActivityType {
    Upload,
    Download,
    Delete,
    Move,
    Copy,
    Share,
    Sync,
    Backup,
    Search,
    AccountAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityLogEntry {
    pub account_name: String,
    pub activity_type: ActivityType,
    pub description: String,
    pub success: bool,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub bytes: Option<u64>,
    pub timestamp: DateTime<Utc>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Helper: format bytes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;
    const TB: u64 = 1024 * GB;

    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_account_config() {
        let cfg = DropboxAccountConfig::default();
        assert!(cfg.enabled);
        assert!(cfg.access_token.is_none());
    }

    #[test]
    fn metadata_tag_serde() {
        let json = r#"{"tag":"file"}"#;
        // Direct deserialization of the tag enum
        let tag: MetadataTag = serde_json::from_str(r#""file""#).unwrap();
        assert_eq!(tag, MetadataTag::File);
        let tag: MetadataTag = serde_json::from_str(r#""folder""#).unwrap();
        assert_eq!(tag, MetadataTag::Folder);
        let _ = json; // suppress unused
    }

    #[test]
    fn write_mode_default() {
        let wm = WriteMode::default();
        assert_eq!(wm, WriteMode::Add);
    }

    #[test]
    fn format_bytes_units() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(1024), "1.00 KB");
        assert_eq!(format_bytes(1_048_576), "1.00 MB");
        assert_eq!(format_bytes(1_073_741_824), "1.00 GB");
        assert_eq!(format_bytes(1_099_511_627_776), "1.00 TB");
    }

    #[test]
    fn list_folder_request_default() {
        let req = ListFolderRequest::default();
        assert!(!req.recursive);
        assert!(req.include_mounted_folders);
        assert!(req.limit.is_none());
    }

    #[test]
    fn sync_direction_serde() {
        let dir: SyncDirection = serde_json::from_str(r#""upload""#).unwrap();
        assert_eq!(dir, SyncDirection::Upload);
    }

    #[test]
    fn backup_includes_default() {
        let inc = BackupIncludes::default();
        assert!(inc.connections);
        assert!(inc.credentials);
        assert!(inc.settings);
        assert!(!inc.scripts);
    }

    #[test]
    fn activity_type_serde() {
        let at: ActivityType = serde_json::from_str(r#""upload""#).unwrap();
        assert_eq!(at, ActivityType::Upload);
    }

    #[test]
    fn deserialization_metadata_file() {
        let json = r#"{
            ".tag": "file",
            "name": "test.txt",
            "path_lower": "/test.txt",
            "path_display": "/test.txt",
            "id": "id:123",
            "size": 1024,
            "rev": "0123456789abcdef",
            "content_hash": "abc123"
        }"#;
        let m: Metadata = serde_json::from_str(json).unwrap();
        assert_eq!(m.tag, MetadataTag::File);
        assert_eq!(m.size, Some(1024));
        assert_eq!(m.name, "test.txt");
    }

    #[test]
    fn deserialization_metadata_folder() {
        let json = r#"{
            ".tag": "folder",
            "name": "Documents",
            "path_lower": "/documents",
            "id": "id:456"
        }"#;
        let m: Metadata = serde_json::from_str(json).unwrap();
        assert_eq!(m.tag, MetadataTag::Folder);
        assert!(m.size.is_none());
    }

    #[test]
    fn deserialization_list_folder_result() {
        let json = r#"{
            "entries": [
                {".tag":"folder","name":"docs","path_lower":"/docs"},
                {".tag":"file","name":"a.txt","path_lower":"/a.txt","size":10}
            ],
            "cursor": "AAFPDM",
            "has_more": false
        }"#;
        let r: ListFolderResult = serde_json::from_str(json).unwrap();
        assert_eq!(r.entries.len(), 2);
        assert!(!r.has_more);
    }

    #[test]
    fn deserialization_search_result() {
        let json = r#"{
            "matches": [
                {
                    "metadata": {
                        "metadata": {".tag":"file","name":"report.pdf","path_lower":"/report.pdf","size":2048}
                    }
                }
            ],
            "has_more": false
        }"#;
        let r: SearchV2Result = serde_json::from_str(json).unwrap();
        assert_eq!(r.matches.len(), 1);
        assert_eq!(r.matches[0].metadata.metadata.name, "report.pdf");
    }

    #[test]
    fn deserialization_space_usage() {
        let json = r#"{
            "used": 314159265,
            "allocation": {".tag": "individual", "allocated": 10737418240}
        }"#;
        let su: SpaceUsage = serde_json::from_str(json).unwrap();
        assert_eq!(su.used, 314159265);
        assert_eq!(su.allocation.tag, "individual");
    }

    #[test]
    fn content_hash_block_size() {
        assert_eq!(CONTENT_HASH_BLOCK_SIZE, 4_194_304);
    }

    #[test]
    fn thumbnail_size_serde() {
        let json = serde_json::to_string(&ThumbnailSize::W256H256).unwrap();
        assert_eq!(json, r#""w256h256""#);
    }

    #[test]
    fn shared_link_settings_roundtrip() {
        let s = SharedLinkSettings {
            requested_visibility: Some(RequestedVisibility::Public),
            link_password: None,
            expires: None,
            audience: Some(LinkAudience::Public),
            access: None,
            allow_download: Some(true),
        };
        let json = serde_json::to_string(&s).unwrap();
        let s2: SharedLinkSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(s2.requested_visibility, Some(RequestedVisibility::Public));
        assert_eq!(s2.allow_download, Some(true));
    }

    #[test]
    fn change_type_serde() {
        let ct: ChangeType = serde_json::from_str(r#""added""#).unwrap();
        assert_eq!(ct, ChangeType::Added);
    }

    #[test]
    fn oauth_token_response_partial() {
        let json = r#"{"access_token":"sl.abc123","token_type":"bearer","expires_in":14400}"#;
        let t: OAuthTokenResponse = serde_json::from_str(json).unwrap();
        assert_eq!(t.access_token, "sl.abc123");
        assert_eq!(t.expires_in, Some(14400));
        assert!(t.refresh_token.is_none());
    }
}
