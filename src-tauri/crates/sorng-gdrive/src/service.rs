//! Central service façade for Google Drive operations.
//!
//! Aggregates the HTTP client, auth state, and all domain modules behind a
//! single `GDriveService` struct that can be managed as Tauri state.

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::auth;
use crate::changes;
use crate::client::GDriveClient;
use crate::comments;
use crate::downloads;
use crate::drives;
use crate::files;
use crate::folders;
use crate::revisions;
use crate::search::SearchQueryBuilder;
use crate::sharing;
use crate::types::*;
use crate::uploads;

/// Thread-safe service state for Tauri.
pub type GDriveServiceState = Arc<Mutex<GDriveService>>;

/// The core Google Drive service combining client + state.
pub struct GDriveService {
    /// HTTP client with auth.
    client: GDriveClient,
    /// OAuth2 credentials.
    credentials: OAuthCredentials,
    /// Cached user info.
    cached_about: Option<DriveAbout>,
    /// Stored page token for change polling.
    change_page_token: Option<String>,
}

impl GDriveService {
    /// Create a new service wrapped in `Arc<Mutex<_>>` for Tauri state management.
    pub fn new() -> GDriveServiceState {
        let service = Self {
            client: GDriveClient::default_client().unwrap_or_else(|_| {
                GDriveClient::new(GDriveConfig::default()).expect("default client")
            }),
            credentials: OAuthCredentials::default(),
            cached_about: None,
            change_page_token: None,
        };
        Arc::new(Mutex::new(service))
    }

    /// Create with specific config.
    pub fn with_config(config: GDriveConfig) -> GDriveServiceState {
        let credentials = config.credentials.clone();
        let service = Self {
            client: GDriveClient::new(config).unwrap_or_else(|_| {
                GDriveClient::new(GDriveConfig::default()).expect("default client")
            }),
            credentials,
            cached_about: None,
            change_page_token: None,
        };
        Arc::new(Mutex::new(service))
    }

    // ── Configuration ────────────────────────────────────────────

    /// Update OAuth credentials.
    pub fn set_credentials(&mut self, credentials: OAuthCredentials) {
        self.credentials = credentials;
    }

    /// Get current credentials (without secret).
    pub fn credentials_summary(&self) -> OAuthCredentials {
        OAuthCredentials {
            client_id: self.credentials.client_id.clone(),
            client_secret: "***".into(),
            redirect_uri: self.credentials.redirect_uri.clone(),
            scopes: self.credentials.scopes.clone(),
        }
    }

    /// Check if authenticated.
    pub fn is_authenticated(&self) -> bool {
        self.client.is_authenticated()
    }

    /// Get connection summary.
    pub fn connection_summary(&self) -> GDriveConnectionSummary {
        GDriveConnectionSummary {
            name: self.client.config().name.clone(),
            authenticated: self.is_authenticated(),
            user_email: self.cached_about.as_ref().map(|a| a.user_email.clone()),
            user_display_name: self
                .cached_about
                .as_ref()
                .map(|a| a.user_display_name.clone()),
            storage_used: self.cached_about.as_ref().map(|a| a.storage_used),
            storage_limit: self.cached_about.as_ref().map(|a| a.storage_limit),
            connected_at: None,
        }
    }

    // ── Auth ─────────────────────────────────────────────────────

    /// Build authorization URL.
    pub fn build_auth_url(&self) -> GDriveResult<String> {
        auth::build_auth_url(&self.credentials)
    }

    /// Exchange authorization code for tokens.
    pub async fn exchange_code(&mut self, code: &str) -> GDriveResult<()> {
        let token = auth::exchange_code(&self.client, &self.credentials, code).await?;
        self.client.set_token(token);
        Ok(())
    }

    /// Refresh the access token.
    pub async fn refresh_token(&mut self) -> GDriveResult<()> {
        let refresh = self
            .client
            .token()
            .and_then(|t| t.refresh_token.clone())
            .ok_or_else(|| GDriveError::auth("No refresh token available"))?;

        let token =
            auth::refresh_token(&self.client, &self.credentials, &refresh).await?;
        self.client.set_token(token);
        Ok(())
    }

    /// Set token directly (e.g. restored from storage).
    pub fn set_token(&mut self, token: OAuthToken) {
        self.client.set_token(token);
    }

    /// Get the current token (for persistence).
    pub fn get_token(&self) -> Option<OAuthToken> {
        self.client.token().cloned()
    }

    /// Revoke the current token and clear auth state.
    pub async fn revoke(&mut self) -> GDriveResult<()> {
        if let Some(token) = self.client.token() {
            let t = token.access_token.clone();
            auth::revoke_token(&self.client, &t).await?;
        }
        self.client.set_token(OAuthToken::default());
        self.cached_about = None;
        Ok(())
    }

    /// Auto-refresh if token is expired (call before operations).
    async fn ensure_auth(&mut self) -> GDriveResult<()> {
        if !self.is_authenticated() {
            if self
                .client
                .token()
                .map(|t| t.refresh_token.is_some())
                .unwrap_or(false)
            {
                self.refresh_token().await?;
            } else {
                return Err(GDriveError::auth("Not authenticated"));
            }
        }
        Ok(())
    }

    // ── About ────────────────────────────────────────────────────

    /// Fetch and cache account info.
    pub async fn get_about(&mut self) -> GDriveResult<DriveAbout> {
        self.ensure_auth().await?;
        let url = GDriveClient::api_url("about");
        let query = [("fields", "user,storageQuota,maxUploadSize,canCreateDrives,exportFormats,importFormats")];

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RawAbout {
            user: Option<RawUser>,
            storage_quota: Option<RawQuota>,
            max_upload_size: Option<String>,
            can_create_drives: Option<bool>,
            export_formats: Option<std::collections::HashMap<String, Vec<String>>>,
            import_formats: Option<std::collections::HashMap<String, Vec<String>>>,
        }

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RawUser {
            display_name: Option<String>,
            email_address: Option<String>,
            photo_link: Option<String>,
        }

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RawQuota {
            limit: Option<String>,
            usage: Option<String>,
            usage_in_drive: Option<String>,
            usage_in_drive_trash: Option<String>,
        }

        let raw: RawAbout = self.client.get_json_with_query(&url, &query).await?;

        let user = raw.user.unwrap_or(RawUser {
            display_name: None,
            email_address: None,
            photo_link: None,
        });
        let quota = raw.storage_quota.unwrap_or(RawQuota {
            limit: None,
            usage: None,
            usage_in_drive: None,
            usage_in_drive_trash: None,
        });

        let parse_i64 = |s: &Option<String>| -> i64 {
            s.as_deref()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0)
        };

        let export_fmts = raw
            .export_formats
            .unwrap_or_default()
            .into_iter()
            .map(|(k, v)| ExportFormat {
                source: k,
                targets: v,
            })
            .collect();

        let import_fmts = raw
            .import_formats
            .unwrap_or_default()
            .into_iter()
            .map(|(k, v)| ImportFormat {
                source: k,
                targets: v,
            })
            .collect();

        let about = DriveAbout {
            user_display_name: user.display_name.unwrap_or_default(),
            user_email: user.email_address.unwrap_or_default(),
            user_photo_link: user.photo_link,
            storage_used: parse_i64(&quota.usage),
            storage_limit: parse_i64(&quota.limit),
            storage_used_in_trash: parse_i64(&quota.usage_in_drive_trash),
            storage_used_in_drive: parse_i64(&quota.usage_in_drive),
            can_create_drives: raw.can_create_drives.unwrap_or(false),
            max_upload_size: raw
                .max_upload_size
                .and_then(|s| s.parse().ok())
                .unwrap_or(5_120_000_000),
            export_formats: export_fmts,
            import_formats: import_fmts,
        };

        self.cached_about = Some(about.clone());
        Ok(about)
    }

    // ── Files ────────────────────────────────────────────────────

    pub async fn get_file(&mut self, file_id: &str) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        files::get_file(&self.client, file_id).await
    }

    pub async fn list_files(&mut self, params: &ListFilesParams) -> GDriveResult<FileList> {
        self.ensure_auth().await?;
        files::list_files(&self.client, params).await
    }

    pub async fn list_all_files(
        &mut self,
        params: &ListFilesParams,
    ) -> GDriveResult<Vec<DriveFile>> {
        self.ensure_auth().await?;
        files::list_all_files(&self.client, params).await
    }

    pub async fn create_file(&mut self, request: &CreateFileRequest) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        files::create_file(&self.client, request).await
    }

    pub async fn update_file(
        &mut self,
        file_id: &str,
        request: &UpdateFileRequest,
    ) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        files::update_file(&self.client, file_id, request).await
    }

    pub async fn copy_file(
        &mut self,
        file_id: &str,
        request: &CopyFileRequest,
    ) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        files::copy_file(&self.client, file_id, request).await
    }

    pub async fn delete_file(&mut self, file_id: &str) -> GDriveResult<()> {
        self.ensure_auth().await?;
        files::delete_file(&self.client, file_id).await
    }

    pub async fn trash_file(&mut self, file_id: &str) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        files::trash_file(&self.client, file_id).await
    }

    pub async fn untrash_file(&mut self, file_id: &str) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        files::untrash_file(&self.client, file_id).await
    }

    pub async fn empty_trash(&mut self) -> GDriveResult<()> {
        self.ensure_auth().await?;
        files::empty_trash(&self.client).await
    }

    pub async fn star_file(&mut self, file_id: &str) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        files::star_file(&self.client, file_id).await
    }

    pub async fn unstar_file(&mut self, file_id: &str) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        files::unstar_file(&self.client, file_id).await
    }

    pub async fn rename_file(
        &mut self,
        file_id: &str,
        new_name: &str,
    ) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        files::rename_file(&self.client, file_id, new_name).await
    }

    pub async fn move_file(
        &mut self,
        file_id: &str,
        new_parent: &str,
        old_parent: &str,
    ) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        files::move_file(&self.client, file_id, new_parent, old_parent).await
    }

    pub async fn export_file(
        &mut self,
        file_id: &str,
        mime: &str,
    ) -> GDriveResult<Vec<u8>> {
        self.ensure_auth().await?;
        files::export_file(&self.client, file_id, mime).await
    }

    pub async fn generate_ids(&mut self, count: u32) -> GDriveResult<Vec<String>> {
        self.ensure_auth().await?;
        files::generate_ids(&self.client, count).await
    }

    // ── Folders ──────────────────────────────────────────────────

    pub async fn create_folder(
        &mut self,
        name: &str,
        parent_id: Option<&str>,
    ) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        folders::create_folder(&self.client, name, parent_id).await
    }

    pub async fn create_folder_path(
        &mut self,
        path: &[&str],
        root_parent: Option<&str>,
    ) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        folders::create_folder_path(&self.client, path, root_parent).await
    }

    pub async fn list_children(
        &mut self,
        folder_id: &str,
        page_size: Option<u32>,
        page_token: Option<&str>,
    ) -> GDriveResult<FileList> {
        self.ensure_auth().await?;
        folders::list_children(&self.client, folder_id, page_size, page_token).await
    }

    pub async fn list_all_children(
        &mut self,
        folder_id: &str,
    ) -> GDriveResult<Vec<DriveFile>> {
        self.ensure_auth().await?;
        folders::list_all_children(&self.client, folder_id).await
    }

    pub async fn list_subfolders(
        &mut self,
        folder_id: &str,
    ) -> GDriveResult<Vec<DriveFile>> {
        self.ensure_auth().await?;
        folders::list_subfolders(&self.client, folder_id).await
    }

    pub async fn find_folder(
        &mut self,
        name: &str,
        parent_id: Option<&str>,
    ) -> GDriveResult<Option<DriveFile>> {
        self.ensure_auth().await?;
        folders::find_folder(&self.client, name, parent_id).await
    }

    pub async fn get_or_create_folder(
        &mut self,
        name: &str,
        parent_id: Option<&str>,
    ) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        folders::get_or_create_folder(&self.client, name, parent_id).await
    }

    // ── Uploads ──────────────────────────────────────────────────

    pub async fn upload_file(&mut self, request: &UploadRequest) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        uploads::upload_file(&self.client, request).await
    }

    pub async fn upload_bytes(
        &mut self,
        name: &str,
        bytes: &[u8],
        mime_type: &str,
        parents: &[String],
    ) -> GDriveResult<DriveFile> {
        self.ensure_auth().await?;
        uploads::upload_bytes(&self.client, name, bytes, mime_type, parents).await
    }

    // ── Downloads ────────────────────────────────────────────────

    pub async fn download_file(
        &mut self,
        file_id: &str,
        destination: &str,
    ) -> GDriveResult<u64> {
        self.ensure_auth().await?;
        downloads::download_file(&self.client, file_id, destination).await
    }

    pub async fn download_bytes(&mut self, file_id: &str) -> GDriveResult<Vec<u8>> {
        self.ensure_auth().await?;
        downloads::download_bytes(&self.client, file_id).await
    }

    pub async fn export_and_download(
        &mut self,
        file_id: &str,
        export_mime: &str,
        destination: &str,
    ) -> GDriveResult<u64> {
        self.ensure_auth().await?;
        downloads::export_file(&self.client, file_id, export_mime, destination).await
    }

    // ── Sharing ──────────────────────────────────────────────────

    pub async fn create_permission(
        &mut self,
        file_id: &str,
        request: &CreatePermissionRequest,
    ) -> GDriveResult<DrivePermission> {
        self.ensure_auth().await?;
        sharing::create_permission(&self.client, file_id, request).await
    }

    pub async fn list_permissions(
        &mut self,
        file_id: &str,
    ) -> GDriveResult<Vec<DrivePermission>> {
        self.ensure_auth().await?;
        sharing::list_all_permissions(&self.client, file_id).await
    }

    pub async fn update_permission(
        &mut self,
        file_id: &str,
        permission_id: &str,
        request: &UpdatePermissionRequest,
    ) -> GDriveResult<DrivePermission> {
        self.ensure_auth().await?;
        sharing::update_permission(&self.client, file_id, permission_id, request).await
    }

    pub async fn delete_permission(
        &mut self,
        file_id: &str,
        permission_id: &str,
    ) -> GDriveResult<()> {
        self.ensure_auth().await?;
        sharing::delete_permission(&self.client, file_id, permission_id).await
    }

    pub async fn share_with_user(
        &mut self,
        file_id: &str,
        email: &str,
        role: PermissionRole,
        notify: bool,
    ) -> GDriveResult<DrivePermission> {
        self.ensure_auth().await?;
        sharing::share_with_user(&self.client, file_id, email, role, notify).await
    }

    pub async fn share_with_anyone(
        &mut self,
        file_id: &str,
        role: PermissionRole,
    ) -> GDriveResult<DrivePermission> {
        self.ensure_auth().await?;
        sharing::share_with_anyone(&self.client, file_id, role).await
    }

    pub async fn unshare_all(&mut self, file_id: &str) -> GDriveResult<BatchResult> {
        self.ensure_auth().await?;
        sharing::unshare_all(&self.client, file_id).await
    }

    // ── Revisions ────────────────────────────────────────────────

    pub async fn list_revisions(
        &mut self,
        file_id: &str,
    ) -> GDriveResult<Vec<DriveRevision>> {
        self.ensure_auth().await?;
        revisions::list_all_revisions(&self.client, file_id).await
    }

    pub async fn get_revision(
        &mut self,
        file_id: &str,
        revision_id: &str,
    ) -> GDriveResult<DriveRevision> {
        self.ensure_auth().await?;
        revisions::get_revision(&self.client, file_id, revision_id).await
    }

    pub async fn pin_revision(
        &mut self,
        file_id: &str,
        revision_id: &str,
    ) -> GDriveResult<DriveRevision> {
        self.ensure_auth().await?;
        revisions::pin_revision(&self.client, file_id, revision_id).await
    }

    pub async fn delete_revision(
        &mut self,
        file_id: &str,
        revision_id: &str,
    ) -> GDriveResult<()> {
        self.ensure_auth().await?;
        revisions::delete_revision(&self.client, file_id, revision_id).await
    }

    // ── Comments ─────────────────────────────────────────────────

    pub async fn list_comments(
        &mut self,
        file_id: &str,
        include_deleted: bool,
    ) -> GDriveResult<Vec<DriveComment>> {
        self.ensure_auth().await?;
        comments::list_all_comments(&self.client, file_id, include_deleted).await
    }

    pub async fn create_comment(
        &mut self,
        file_id: &str,
        content: &str,
    ) -> GDriveResult<DriveComment> {
        self.ensure_auth().await?;
        comments::create_comment(&self.client, file_id, content, None).await
    }

    pub async fn resolve_comment(
        &mut self,
        file_id: &str,
        comment_id: &str,
    ) -> GDriveResult<DriveReply> {
        self.ensure_auth().await?;
        comments::resolve_comment(&self.client, file_id, comment_id).await
    }

    pub async fn create_reply(
        &mut self,
        file_id: &str,
        comment_id: &str,
        content: &str,
    ) -> GDriveResult<DriveReply> {
        self.ensure_auth().await?;
        comments::create_reply(&self.client, file_id, comment_id, content).await
    }

    // ── Shared drives ────────────────────────────────────────────

    pub async fn list_drives(&mut self) -> GDriveResult<Vec<SharedDrive>> {
        self.ensure_auth().await?;
        drives::list_all_drives(&self.client).await
    }

    pub async fn create_drive(
        &mut self,
        name: &str,
        request_id: &str,
    ) -> GDriveResult<SharedDrive> {
        self.ensure_auth().await?;
        drives::create_drive(&self.client, name, request_id).await
    }

    pub async fn delete_drive(&mut self, drive_id: &str) -> GDriveResult<()> {
        self.ensure_auth().await?;
        drives::delete_drive(&self.client, drive_id).await
    }

    pub async fn hide_drive(&mut self, drive_id: &str) -> GDriveResult<SharedDrive> {
        self.ensure_auth().await?;
        drives::hide_drive(&self.client, drive_id).await
    }

    pub async fn unhide_drive(&mut self, drive_id: &str) -> GDriveResult<SharedDrive> {
        self.ensure_auth().await?;
        drives::unhide_drive(&self.client, drive_id).await
    }

    // ── Changes ──────────────────────────────────────────────────

    pub async fn get_start_page_token(&mut self) -> GDriveResult<String> {
        self.ensure_auth().await?;
        let token = changes::get_start_page_token(&self.client).await?;
        self.change_page_token = Some(token.clone());
        Ok(token)
    }

    pub async fn poll_changes(&mut self) -> GDriveResult<Vec<DriveChange>> {
        self.ensure_auth().await?;
        let token = self
            .change_page_token
            .clone()
            .ok_or_else(|| {
                GDriveError::invalid("No change page token — call get_start_page_token first")
            })?;

        let (changes, new_token) = changes::poll_changes(&self.client, &token).await?;
        self.change_page_token = Some(new_token);
        Ok(changes)
    }

    // ── Search ───────────────────────────────────────────────────

    pub async fn search(
        &mut self,
        query: &str,
        page_size: Option<u32>,
        order_by: Option<&str>,
    ) -> GDriveResult<FileList> {
        self.ensure_auth().await?;
        let params = ListFilesParams {
            query: Some(query.to_string()),
            page_size,
            order_by: order_by.map(|s| s.to_string()),
            ..Default::default()
        };
        files::list_files(&self.client, &params).await
    }

    pub fn query_builder(&self) -> SearchQueryBuilder {
        SearchQueryBuilder::new()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_service_state() {
        let state = GDriveService::new();
        let guard = state.try_lock();
        assert!(guard.is_ok());
    }

    #[test]
    fn service_not_authenticated_initially() {
        let state = GDriveService::new();
        let guard = state.try_lock().unwrap();
        assert!(!guard.is_authenticated());
    }

    #[test]
    fn set_and_get_credentials() {
        let state = GDriveService::new();
        let mut guard = state.try_lock().unwrap();
        guard.set_credentials(OAuthCredentials {
            client_id: "test-id".into(),
            client_secret: "test-secret".into(),
            redirect_uri: "http://localhost".into(),
            scopes: vec![scopes::DRIVE_FILE.into()],
        });
        let summary = guard.credentials_summary();
        assert_eq!(summary.client_id, "test-id");
        assert_eq!(summary.client_secret, "***");
    }

    #[test]
    fn connection_summary_unauthenticated() {
        let state = GDriveService::new();
        let guard = state.try_lock().unwrap();
        let summary = guard.connection_summary();
        assert!(!summary.authenticated);
        assert!(summary.user_email.is_none());
    }

    #[test]
    fn build_auth_url_from_service() {
        let state = GDriveService::new();
        let mut guard = state.try_lock().unwrap();
        guard.set_credentials(OAuthCredentials {
            client_id: "my-client-id".into(),
            client_secret: "secret".into(),
            redirect_uri: "http://localhost:8080".into(),
            scopes: vec![scopes::DRIVE.into()],
        });
        let url = guard.build_auth_url().unwrap();
        assert!(url.contains("my-client-id"));
        assert!(url.contains("accounts.google.com"));
    }

    #[test]
    fn set_token_authenticates() {
        let state = GDriveService::new();
        let mut guard = state.try_lock().unwrap();
        guard.set_token(OAuthToken {
            access_token: "ya29.valid".into(),
            expires_at: Some(chrono::Utc::now() + chrono::Duration::hours(1)),
            ..Default::default()
        });
        assert!(guard.is_authenticated());
    }

    #[test]
    fn get_token_roundtrip() {
        let state = GDriveService::new();
        let mut guard = state.try_lock().unwrap();
        assert!(guard.get_token().is_none());

        let token = OAuthToken {
            access_token: "ya29.test".into(),
            ..Default::default()
        };
        guard.set_token(token);
        let got = guard.get_token().unwrap();
        assert_eq!(got.access_token, "ya29.test");
    }

    #[test]
    fn query_builder_from_service() {
        let state = GDriveService::new();
        let guard = state.try_lock().unwrap();
        let q = guard
            .query_builder()
            .name_contains("test")
            .not_trashed()
            .build();
        assert!(q.contains("name contains 'test'"));
        assert!(q.contains("trashed = false"));
    }

    #[test]
    fn with_config() {
        let config = GDriveConfig {
            name: "custom".into(),
            timeout_seconds: 60,
            ..Default::default()
        };
        let state = GDriveService::with_config(config);
        let guard = state.try_lock().unwrap();
        let summary = guard.connection_summary();
        assert_eq!(summary.name, "custom");
    }

    #[tokio::test]
    async fn ensure_auth_fails_when_no_token() {
        let state = GDriveService::new();
        let mut guard = state.lock().await;
        let err = guard.ensure_auth().await.unwrap_err();
        assert_eq!(err.kind, GDriveErrorKind::AuthenticationFailed);
    }
}
