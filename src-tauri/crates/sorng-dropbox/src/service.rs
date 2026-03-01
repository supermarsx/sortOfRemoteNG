//! Central service aggregating all Dropbox sub-systems.
//!
//! `DropboxService` owns the HTTP client, auth state, and every manager
//! (sync, backup, watcher). It is wrapped in `Arc<Mutex<_>>` and shared
//! as Tauri managed state.

use crate::auth;
use crate::backup::BackupManager;
use crate::sync::SyncManager;
use crate::types::*;
use crate::watcher::WatchManager;
use chrono::Utc;
use std::sync::{Arc, Mutex};

/// The Tauri managed state type.
pub type DropboxServiceState = Arc<Mutex<DropboxService>>;

/// Central Dropbox integration service.
pub struct DropboxService {
    // ── Auth state ──────────────────────────────────────────────
    pub app_key: Option<String>,
    pub app_secret: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<chrono::DateTime<Utc>>,
    pub pending_pkce: Option<OAuthPkceState>,
    pub redirect_uri: String,
    pub connected: bool,

    // ── Account cache ──────────────────────────────────────────
    pub account: Option<FullAccount>,
    pub space_usage: Option<SpaceUsage>,

    // ── Managers ───────────────────────────────────────────────
    pub sync_manager: SyncManager,
    pub backup_manager: BackupManager,
    pub watch_manager: WatchManager,

    // ── Activity log ───────────────────────────────────────────
    pub activity_log: Vec<ActivityLogEntry>,
    max_log: usize,

    // ── Stats ──────────────────────────────────────────────────
    pub stats: DropboxStats,
}

impl DropboxService {
    /// Create a fresh (disconnected) service.
    pub fn new() -> DropboxServiceState {
        Arc::new(Mutex::new(Self {
            app_key: None,
            app_secret: None,
            access_token: None,
            refresh_token: None,
            token_expires_at: None,
            pending_pkce: None,
            redirect_uri: "http://localhost:17170".to_string(),
            connected: false,
            account: None,
            space_usage: None,
            sync_manager: SyncManager::new(),
            backup_manager: BackupManager::new(),
            watch_manager: WatchManager::new(),
            activity_log: Vec::new(),
            max_log: 500,
            stats: DropboxStats {
                configured_accounts: 0,
                enabled_accounts: 0,
                total_uploads: 0,
                total_downloads: 0,
                total_api_calls: 0,
                total_bytes_uploaded: 0,
                total_bytes_downloaded: 0,
                sync_configs: 0,
                backup_configs: 0,
                watch_configs: 0,
                total_sync_runs: 0,
                total_backup_runs: 0,
                total_changes_detected: 0,
            },
        }))
    }

    // ━━━━━━━━━━━━━━  Configuration  ━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Configure app credentials.
    pub fn configure(&mut self, app_key: &str, app_secret: Option<&str>, redirect_uri: Option<&str>) {
        self.app_key = Some(app_key.to_string());
        self.app_secret = app_secret.map(|s| s.to_string());
        if let Some(uri) = redirect_uri {
            self.redirect_uri = uri.to_string();
        }
    }

    /// Set an existing access token directly.
    pub fn set_token(&mut self, token: &str, refresh: Option<&str>, expires_in: Option<i64>) {
        self.access_token = Some(token.to_string());
        self.refresh_token = refresh.map(|r| r.to_string());
        self.token_expires_at = expires_in.map(auth::expires_at_from_now);
        self.connected = true;
        self.log(ActivityType::AccountAction, "Access token set", true, None);
    }

    /// Disconnect — clear tokens and connected state.
    pub fn disconnect(&mut self) {
        self.access_token = None;
        self.refresh_token = None;
        self.token_expires_at = None;
        self.pending_pkce = None;
        self.connected = false;
        self.account = None;
        self.space_usage = None;
        self.log(ActivityType::AccountAction, "Disconnected", true, None);
    }

    // ━━━━━━━━━━━━━━  OAuth helpers (sync wrappers)  ━━━━━━━━━

    /// Start the OAuth 2.0 PKCE flow — returns the URL the user should open.
    pub fn start_auth(&mut self, scopes: Option<Vec<String>>) -> Result<String, String> {
        let app_key = self
            .app_key
            .as_deref()
            .ok_or("App key not configured")?;

        let scope_refs: Vec<&str> = scopes
            .as_ref()
            .map(|s| s.iter().map(|x| x.as_str()).collect())
            .unwrap_or_default();
        let scopes_opt = if scope_refs.is_empty() {
            None
        } else {
            Some(scope_refs.as_slice())
        };

        let (url, pkce) = auth::build_auth_url(app_key, &self.redirect_uri, scopes_opt);
        self.pending_pkce = Some(pkce);
        self.log(ActivityType::AccountAction, "OAuth flow started", true, None);
        Ok(url)
    }

    /// Complete the OAuth flow with the code received from the redirect.
    pub async fn finish_auth(&mut self, code: &str) -> Result<(), String> {
        let app_key = self
            .app_key
            .clone()
            .ok_or("App key not configured")?;
        let pkce = self
            .pending_pkce
            .clone()
            .ok_or("No pending PKCE state")?;

        let token_resp = auth::exchange_code(
            &app_key,
            self.app_secret.as_deref(),
            code,
            &pkce,
        )
        .await?;

        self.access_token = Some(token_resp.access_token.clone());
        self.refresh_token = token_resp.refresh_token.clone();
        if let Some(exp) = token_resp.expires_in {
            self.token_expires_at = Some(auth::expires_at_from_now(exp));
        }
        self.pending_pkce = None;
        self.connected = true;
        self.log(ActivityType::AccountAction, "OAuth flow completed", true, None);
        Ok(())
    }

    /// Refresh the access token if it's about to expire.
    pub async fn ensure_token(&mut self) -> Result<String, String> {
        if let Some(ref tok) = self.access_token {
            if !auth::is_token_expiring(self.token_expires_at.as_ref(), 300) {
                return Ok(tok.clone());
            }
        }
        // Need refresh
        let app_key = self
            .app_key
            .clone()
            .ok_or("App key not configured")?;
        let refresh = self
            .refresh_token
            .clone()
            .ok_or("No refresh token available")?;

        let resp = auth::refresh_token(&app_key, self.app_secret.as_deref(), &refresh).await?;
        self.access_token = Some(resp.access_token.clone());
        if let Some(exp) = resp.expires_in {
            self.token_expires_at = Some(auth::expires_at_from_now(exp));
        }
        self.log(ActivityType::AccountAction, "Token refreshed", true, None);
        Ok(resp.access_token)
    }

    // ━━━━━━━━━━━━━━  Query helpers  ━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Check whether the service is connected and has a valid (or refreshable) token.
    pub fn is_connected(&self) -> bool {
        self.connected && self.access_token.is_some()
    }

    /// Get the current access token (without refreshing).
    pub fn token(&self) -> Option<&str> {
        self.access_token.as_deref()
    }

    /// Get a masked version of the access token for logging.
    pub fn masked_token(&self) -> String {
        match &self.access_token {
            Some(t) if t.len() > 8 => format!("{}…{}", &t[..4], &t[t.len() - 4..]),
            Some(t) => format!("{}…", &t[..t.len().min(4)]),
            None => "(none)".to_string(),
        }
    }

    // ━━━━━━━━━━━━━━  Activity log  ━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Append an entry to the activity log.
    pub fn log(&mut self, activity_type: ActivityType, description: &str, success: bool, error: Option<&str>) {
        let entry = ActivityLogEntry {
            timestamp: Utc::now(),
            activity_type,
            account_name: String::new(),
            description: description.to_string(),
            success,
            error: error.map(|s| s.to_string()),
            path: None,
            bytes: None,
        };
        self.activity_log.push(entry);
        if self.activity_log.len() > self.max_log {
            let excess = self.activity_log.len() - self.max_log;
            self.activity_log.drain(..excess);
        }
    }

    /// Get the full activity log.
    pub fn get_activity_log(&self) -> &[ActivityLogEntry] {
        &self.activity_log
    }

    /// Clear the activity log.
    pub fn clear_activity_log(&mut self) {
        self.activity_log.clear();
    }

    // ━━━━━━━━━━━━━━  Stats  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Record an upload in stats.
    pub fn record_upload(&mut self, bytes: u64) {
        self.stats.total_bytes_uploaded += bytes;
        self.stats.total_uploads += 1;
    }

    /// Record a download in stats.
    pub fn record_download(&mut self, bytes: u64) {
        self.stats.total_bytes_downloaded += bytes;
        self.stats.total_downloads += 1;
    }

    /// Record an API call.
    pub fn record_api_call(&mut self) {
        self.stats.total_api_calls += 1;
    }

    /// Reset crate stats.
    pub fn reset_stats(&mut self) {
        self.stats = DropboxStats {
            configured_accounts: 0,
            enabled_accounts: 0,
            total_uploads: 0,
            total_downloads: 0,
            total_api_calls: 0,
            total_bytes_uploaded: 0,
            total_bytes_downloaded: 0,
            sync_configs: 0,
            backup_configs: 0,
            watch_configs: 0,
            total_sync_runs: 0,
            total_backup_runs: 0,
            total_changes_detected: 0,
        };
    }
}

fn default_stats() -> DropboxStats {
    DropboxStats {
        configured_accounts: 0,
        enabled_accounts: 0,
        total_uploads: 0,
        total_downloads: 0,
        total_api_calls: 0,
        total_bytes_uploaded: 0,
        total_bytes_downloaded: 0,
        sync_configs: 0,
        backup_configs: 0,
        watch_configs: 0,
        total_sync_runs: 0,
        total_backup_runs: 0,
        total_changes_detected: 0,
    }
}

impl Default for DropboxService {
    fn default() -> Self {
        Self {
            app_key: None,
            app_secret: None,
            access_token: None,
            refresh_token: None,
            token_expires_at: None,
            pending_pkce: None,
            redirect_uri: "http://localhost:17170".to_string(),
            connected: false,
            account: None,
            space_usage: None,
            sync_manager: SyncManager::new(),
            backup_manager: BackupManager::new(),
            watch_manager: WatchManager::new(),
            activity_log: Vec::new(),
            max_log: 500,
            stats: default_stats(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> DropboxService {
        DropboxService::default()
    }

    #[test]
    fn new_returns_state() {
        let state = DropboxService::new();
        let svc = state.lock().unwrap();
        assert!(!svc.is_connected());
    }

    #[test]
    fn configure_app() {
        let mut svc = service();
        svc.configure("my_key", Some("my_secret"), None);
        assert_eq!(svc.app_key.as_deref(), Some("my_key"));
        assert_eq!(svc.app_secret.as_deref(), Some("my_secret"));
    }

    #[test]
    fn configure_redirect_uri() {
        let mut svc = service();
        svc.configure("key", None, Some("http://localhost:9999"));
        assert_eq!(svc.redirect_uri, "http://localhost:9999");
    }

    #[test]
    fn set_token_connects() {
        let mut svc = service();
        svc.set_token("tok_abc123", Some("ref_xyz"), Some(3600));
        assert!(svc.is_connected());
        assert_eq!(svc.token(), Some("tok_abc123"));
    }

    #[test]
    fn disconnect_clears() {
        let mut svc = service();
        svc.set_token("tok_abc", None, None);
        assert!(svc.is_connected());
        svc.disconnect();
        assert!(!svc.is_connected());
        assert!(svc.token().is_none());
    }

    #[test]
    fn start_auth_no_key() {
        let mut svc = service();
        assert!(svc.start_auth(None).is_err());
    }

    #[test]
    fn start_auth_success() {
        let mut svc = service();
        svc.configure("test_key", None, None);
        let url = svc.start_auth(None).unwrap();
        assert!(url.contains("test_key"));
        assert!(svc.pending_pkce.is_some());
    }

    #[test]
    fn start_auth_with_scopes() {
        let mut svc = service();
        svc.configure("key", None, None);
        let url = svc
            .start_auth(Some(vec!["files.metadata.read".into()]))
            .unwrap();
        assert!(url.contains("scope="));
    }

    #[test]
    fn masked_token_long() {
        let mut svc = service();
        svc.set_token("sl.ABCDEFGHIJKLMNOP", None, None);
        let masked = svc.masked_token();
        assert!(masked.contains("sl.A"));
        assert!(masked.contains("MNOP"));
        assert!(masked.contains('…'));
    }

    #[test]
    fn masked_token_none() {
        let svc = service();
        assert_eq!(svc.masked_token(), "(none)");
    }

    #[test]
    fn activity_log_append_and_clear() {
        let mut svc = service();
        svc.log(ActivityType::Upload, "Uploaded file.txt", true, None);
        svc.log(ActivityType::Download, "Downloaded doc.pdf", true, None);
        assert_eq!(svc.get_activity_log().len(), 2);
        svc.clear_activity_log();
        assert!(svc.get_activity_log().is_empty());
    }

    #[test]
    fn activity_log_trim() {
        let mut svc = service();
        svc.max_log = 5;
        for i in 0..20 {
            svc.log(ActivityType::AccountAction, &format!("Entry {i}"), true, None);
        }
        assert_eq!(svc.get_activity_log().len(), 5);
    }

    #[test]
    fn record_upload_stats() {
        let mut svc = service();
        svc.record_upload(1024);
        svc.record_upload(2048);
        assert_eq!(svc.stats.total_uploads, 2);
        assert_eq!(svc.stats.total_bytes_uploaded, 3072);
    }

    #[test]
    fn record_download_stats() {
        let mut svc = service();
        svc.record_download(4096);
        assert_eq!(svc.stats.total_downloads, 1);
        assert_eq!(svc.stats.total_bytes_downloaded, 4096);
    }

    #[test]
    fn record_api_call_stats() {
        let mut svc = service();
        svc.record_api_call();
        svc.record_api_call();
        assert_eq!(svc.stats.total_api_calls, 2);
    }

    #[test]
    fn reset_stats() {
        let mut svc = service();
        svc.record_upload(1000);
        svc.record_download(2000);
        svc.reset_stats();
        assert_eq!(svc.stats.total_bytes_uploaded, 0);
        assert_eq!(svc.stats.total_bytes_downloaded, 0);
    }

    #[test]
    fn default_impl() {
        let svc = service();
        assert_eq!(svc.redirect_uri, "http://localhost:17170");
        assert!(!svc.is_connected());
    }
}
