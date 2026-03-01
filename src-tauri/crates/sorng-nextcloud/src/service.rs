// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · service
// ──────────────────────────────────────────────────────────────────────────────
// Central service aggregating all Nextcloud sub-systems.
//
// `NextcloudService` owns the HTTP client config, auth state, and every manager
// (sync, backup, watcher). It is wrapped in `Arc<Mutex<_>>` and shared as
// Tauri managed state.
// ──────────────────────────────────────────────────────────────────────────────

use crate::backup::BackupManager;
use crate::sync::SyncManager;
use crate::types::*;
use crate::watcher::WatchManager;
use chrono::Utc;
use std::sync::{Arc, Mutex};

/// The Tauri managed state type.
pub type NextcloudServiceState = Arc<Mutex<NextcloudService>>;

/// Central Nextcloud integration service.
pub struct NextcloudService {
    // ── Connection settings ────────────────────────────────────
    pub server_url: Option<String>,
    pub username: Option<String>,
    pub app_password: Option<String>,
    pub bearer_token: Option<String>,
    pub auth_method: AuthMethod,
    pub connected: bool,

    // ── Login Flow v2 state ────────────────────────────────────
    pub login_flow: Option<LoginFlowV2State>,

    // ── OAuth2 settings ────────────────────────────────────────
    pub oauth2_client_id: Option<String>,
    pub oauth2_client_secret: Option<String>,
    pub oauth2_redirect_uri: String,
    pub oauth2_refresh_token: Option<String>,
    pub oauth2_token_expires_at: Option<chrono::DateTime<Utc>>,
    pub pending_code_verifier: Option<String>,

    // ── Account cache ──────────────────────────────────────────
    pub user_info: Option<UserInfo>,

    // ── Managers ───────────────────────────────────────────────
    pub sync_manager: SyncManager,
    pub backup_manager: BackupManager,
    pub watch_manager: WatchManager,

    // ── Activity log ───────────────────────────────────────────
    pub activity_log: Vec<ServiceLogEntry>,
    max_log: usize,

    // ── Stats ──────────────────────────────────────────────────
    pub stats: AccountStats,
}

impl NextcloudService {
    /// Create a fresh (disconnected) service wrapped in `Arc<Mutex<_>>`.
    pub fn new() -> NextcloudServiceState {
        Arc::new(Mutex::new(Self::default()))
    }

    // ━━━━━━━━━━━━━━  Configuration  ━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Configure server and app-password credentials.
    pub fn configure(
        &mut self,
        server_url: &str,
        username: &str,
        app_password: &str,
    ) {
        self.server_url = Some(server_url.trim_end_matches('/').to_string());
        self.username = Some(username.to_string());
        self.app_password = Some(app_password.to_string());
        self.auth_method = AuthMethod::AppPassword;
        self.connected = true;
        self.log("configure", "Server and credentials configured", true);
    }

    /// Set a bearer token directly (e.g. from OAuth2).
    pub fn set_bearer_token(&mut self, token: &str, refresh: Option<&str>, expires_in: Option<i64>) {
        self.bearer_token = Some(token.to_string());
        self.oauth2_refresh_token = refresh.map(|r| r.to_string());
        if let Some(secs) = expires_in {
            self.oauth2_token_expires_at =
                Some(Utc::now() + chrono::Duration::seconds(secs));
        }
        self.auth_method = AuthMethod::OAuth2;
        self.connected = true;
        self.log("set_bearer_token", "Bearer token set", true);
    }

    /// Configure OAuth2 client credentials.
    pub fn configure_oauth2(
        &mut self,
        client_id: &str,
        client_secret: Option<&str>,
        redirect_uri: Option<&str>,
    ) {
        self.oauth2_client_id = Some(client_id.to_string());
        self.oauth2_client_secret = client_secret.map(|s| s.to_string());
        if let Some(uri) = redirect_uri {
            self.oauth2_redirect_uri = uri.to_string();
        }
    }

    /// Disconnect — clear all credentials and connected state.
    pub fn disconnect(&mut self) {
        self.server_url = None;
        self.username = None;
        self.app_password = None;
        self.bearer_token = None;
        self.oauth2_refresh_token = None;
        self.oauth2_token_expires_at = None;
        self.pending_code_verifier = None;
        self.login_flow = None;
        self.auth_method = AuthMethod::None;
        self.connected = false;
        self.user_info = None;
        self.log("disconnect", "Disconnected", true);
    }

    // ━━━━━━━━━━━━━━  Login Flow v2  ━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Store Login Flow v2 state (after `start_login_flow_v2`).
    pub fn set_login_flow(&mut self, state: LoginFlowV2State) {
        self.login_flow = Some(state);
        self.log("login_flow", "Login Flow v2 initiated", true);
    }

    /// Complete Login Flow v2 with credentials from polling result.
    pub fn complete_login_flow(&mut self, creds: &LoginFlowV2Credentials) {
        self.server_url = Some(creds.server.trim_end_matches('/').to_string());
        self.username = Some(creds.login_name.clone());
        self.app_password = Some(creds.app_password.clone());
        self.auth_method = AuthMethod::AppPassword;
        self.login_flow = None;
        self.connected = true;
        self.log("login_flow", "Login Flow v2 completed", true);
    }

    // ━━━━━━━━━━━━━━  OAuth2 helpers  ━━━━━━━━━━━━━━━━━━━━━━━━

    /// Start the OAuth 2.0 authorization flow — returns the URL the user should open.
    pub fn start_oauth2(&mut self, _scopes: Option<&str>) -> Result<String, String> {
        let server = self
            .server_url
            .as_deref()
            .ok_or("Server URL not configured")?;
        let client_id = self
            .oauth2_client_id
            .as_deref()
            .ok_or("OAuth2 client_id not configured")?;

        let verifier = crate::auth::generate_code_verifier();
        let challenge = crate::auth::generate_code_challenge(&verifier);
        let state_param = uuid::Uuid::new_v4().to_string();
        let url = crate::auth::build_oauth2_authorize_url(
            server,
            client_id,
            &self.oauth2_redirect_uri,
            &state_param,
            &challenge,
        );
        self.pending_code_verifier = Some(verifier);
        self.log("oauth2", "OAuth2 flow started", true);
        Ok(url)
    }

    // ━━━━━━━━━━━━━━  Query helpers  ━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Check whether the service is connected.
    pub fn is_connected(&self) -> bool {
        self.connected
            && (self.app_password.is_some() || self.bearer_token.is_some())
    }

    /// Get the server URL.
    pub fn server_url(&self) -> Option<&str> {
        self.server_url.as_deref()
    }

    /// Get the username.
    pub fn username(&self) -> Option<&str> {
        self.username.as_deref()
    }

    /// Get a masked version of the password/token for logging.
    pub fn masked_credential(&self) -> String {
        let cred = self
            .app_password
            .as_deref()
            .or(self.bearer_token.as_deref());
        match cred {
            Some(t) if t.len() > 8 => format!("{}…{}", &t[..4], &t[t.len() - 4..]),
            Some(t) => format!("{}…", &t[..t.len().min(4)]),
            None => "(none)".to_string(),
        }
    }

    // ━━━━━━━━━━━━━━  Activity log  ━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Append an entry to the activity log.
    pub fn log(&mut self, action: &str, detail: &str, success: bool) {
        let entry = ServiceLogEntry {
            timestamp: Utc::now(),
            action: action.to_string(),
            detail: detail.to_string(),
            success,
        };
        self.activity_log.push(entry);
        if self.activity_log.len() > self.max_log {
            let excess = self.activity_log.len() - self.max_log;
            self.activity_log.drain(..excess);
        }
    }

    /// Get the full activity log.
    pub fn get_activity_log(&self) -> &[ServiceLogEntry] {
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
        self.stats.total_api_calls += 1;
        self.stats.last_activity = Some(Utc::now());
    }

    /// Record a download in stats.
    pub fn record_download(&mut self, bytes: u64) {
        self.stats.total_bytes_downloaded += bytes;
        self.stats.total_api_calls += 1;
        self.stats.last_activity = Some(Utc::now());
    }

    /// Record a file listing call.
    pub fn record_listing(&mut self, count: u64) {
        self.stats.total_files_listed += count;
        self.stats.total_api_calls += 1;
        self.stats.last_activity = Some(Utc::now());
    }

    /// Record a share creation.
    pub fn record_share(&mut self) {
        self.stats.total_shares_created += 1;
        self.stats.total_api_calls += 1;
        self.stats.last_activity = Some(Utc::now());
    }

    /// Record a generic API call.
    pub fn record_api_call(&mut self) {
        self.stats.total_api_calls += 1;
        self.stats.last_activity = Some(Utc::now());
    }

    /// Reset stats.
    pub fn reset_stats(&mut self) {
        self.stats = AccountStats::default();
    }
}

impl Default for NextcloudService {
    fn default() -> Self {
        Self {
            server_url: None,
            username: None,
            app_password: None,
            bearer_token: None,
            auth_method: AuthMethod::None,
            connected: false,
            login_flow: None,
            oauth2_client_id: None,
            oauth2_client_secret: None,
            oauth2_redirect_uri: "http://localhost:17170".to_string(),
            oauth2_refresh_token: None,
            oauth2_token_expires_at: None,
            pending_code_verifier: None,
            user_info: None,
            sync_manager: SyncManager::new(),
            backup_manager: BackupManager::new(),
            watch_manager: WatchManager::new(),
            activity_log: Vec::new(),
            max_log: 500,
            stats: AccountStats::default(),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> NextcloudService {
        NextcloudService::default()
    }

    #[test]
    fn new_returns_state() {
        let state = NextcloudService::new();
        let svc = state.lock().unwrap();
        assert!(!svc.is_connected());
    }

    #[test]
    fn configure_connects() {
        let mut svc = service();
        svc.configure("https://cloud.example.com", "admin", "pass-1234");
        assert!(svc.is_connected());
        assert_eq!(svc.server_url(), Some("https://cloud.example.com"));
        assert_eq!(svc.username(), Some("admin"));
        assert_eq!(svc.auth_method, AuthMethod::AppPassword);
    }

    #[test]
    fn configure_strips_trailing_slash() {
        let mut svc = service();
        svc.configure("https://cloud.example.com/", "admin", "pass");
        assert_eq!(svc.server_url(), Some("https://cloud.example.com"));
    }

    #[test]
    fn set_bearer_token_connects() {
        let mut svc = service();
        svc.set_bearer_token("tok_abc123", Some("ref_xyz"), Some(3600));
        assert!(svc.is_connected());
        assert_eq!(svc.auth_method, AuthMethod::OAuth2);
        assert!(svc.oauth2_refresh_token.is_some());
        assert!(svc.oauth2_token_expires_at.is_some());
    }

    #[test]
    fn disconnect_clears() {
        let mut svc = service();
        svc.configure("https://cloud.example.com", "admin", "pass");
        assert!(svc.is_connected());
        svc.disconnect();
        assert!(!svc.is_connected());
        assert!(svc.server_url().is_none());
        assert!(svc.username().is_none());
        assert_eq!(svc.auth_method, AuthMethod::None);
    }

    #[test]
    fn login_flow_lifecycle() {
        let mut svc = service();
        let flow = LoginFlowV2State {
            login_url: "https://cloud.example.com/login/v2".into(),
            poll_endpoint: "https://cloud.example.com/login/v2/poll".into(),
            poll_token: "abc123".into(),
        };
        svc.set_login_flow(flow);
        assert!(svc.login_flow.is_some());

        let creds = LoginFlowV2Credentials {
            server: "https://cloud.example.com/".into(),
            login_name: "admin".into(),
            app_password: "generated-password".into(),
        };
        svc.complete_login_flow(&creds);
        assert!(svc.is_connected());
        assert!(svc.login_flow.is_none());
        assert_eq!(svc.server_url(), Some("https://cloud.example.com"));
    }

    #[test]
    fn configure_oauth2_settings() {
        let mut svc = service();
        svc.configure_oauth2("my_client_id", Some("my_secret"), Some("http://localhost:9999"));
        assert_eq!(svc.oauth2_client_id.as_deref(), Some("my_client_id"));
        assert_eq!(svc.oauth2_client_secret.as_deref(), Some("my_secret"));
        assert_eq!(svc.oauth2_redirect_uri, "http://localhost:9999");
    }

    #[test]
    fn start_oauth2_no_server() {
        let mut svc = service();
        svc.oauth2_client_id = Some("cid".into());
        assert!(svc.start_oauth2(None).is_err());
    }

    #[test]
    fn start_oauth2_no_client_id() {
        let mut svc = service();
        svc.server_url = Some("https://cloud.example.com".into());
        assert!(svc.start_oauth2(None).is_err());
    }

    #[test]
    fn start_oauth2_success() {
        let mut svc = service();
        svc.server_url = Some("https://cloud.example.com".into());
        svc.oauth2_client_id = Some("test_id".into());
        let url = svc.start_oauth2(None).unwrap();
        assert!(url.contains("cloud.example.com"));
        assert!(url.contains("test_id"));
        assert!(svc.pending_code_verifier.is_some());
    }

    #[test]
    fn masked_credential_long() {
        let mut svc = service();
        svc.configure("https://ex.com", "user", "ABCDEFGHIJKLMNOP");
        let masked = svc.masked_credential();
        assert!(masked.contains("ABCD"));
        assert!(masked.contains("MNOP"));
        assert!(masked.contains('…'));
    }

    #[test]
    fn masked_credential_none() {
        let svc = service();
        assert_eq!(svc.masked_credential(), "(none)");
    }

    #[test]
    fn activity_log_append_and_clear() {
        let mut svc = service();
        svc.log("upload", "Uploaded file.txt", true);
        svc.log("download", "Downloaded doc.pdf", true);
        assert_eq!(svc.get_activity_log().len(), 2);
        svc.clear_activity_log();
        assert!(svc.get_activity_log().is_empty());
    }

    #[test]
    fn activity_log_trim() {
        let mut svc = service();
        svc.max_log = 5;
        for i in 0..20 {
            svc.log("test", &format!("Entry {i}"), true);
        }
        assert_eq!(svc.get_activity_log().len(), 5);
    }

    #[test]
    fn record_upload_stats() {
        let mut svc = service();
        svc.record_upload(1024);
        svc.record_upload(2048);
        assert_eq!(svc.stats.total_api_calls, 2);
        assert_eq!(svc.stats.total_bytes_uploaded, 3072);
        assert!(svc.stats.last_activity.is_some());
    }

    #[test]
    fn record_download_stats() {
        let mut svc = service();
        svc.record_download(4096);
        assert_eq!(svc.stats.total_api_calls, 1);
        assert_eq!(svc.stats.total_bytes_downloaded, 4096);
    }

    #[test]
    fn record_listing_stats() {
        let mut svc = service();
        svc.record_listing(50);
        assert_eq!(svc.stats.total_files_listed, 50);
        assert_eq!(svc.stats.total_api_calls, 1);
    }

    #[test]
    fn record_share_stats() {
        let mut svc = service();
        svc.record_share();
        svc.record_share();
        assert_eq!(svc.stats.total_shares_created, 2);
    }

    #[test]
    fn reset_stats() {
        let mut svc = service();
        svc.record_upload(1000);
        svc.record_download(2000);
        svc.reset_stats();
        assert_eq!(svc.stats.total_bytes_uploaded, 0);
        assert_eq!(svc.stats.total_bytes_downloaded, 0);
        assert_eq!(svc.stats.total_api_calls, 0);
        assert!(svc.stats.last_activity.is_none());
    }

    #[test]
    fn default_impl() {
        let svc = service();
        assert_eq!(svc.oauth2_redirect_uri, "http://localhost:17170");
        assert!(!svc.is_connected());
        assert_eq!(svc.auth_method, AuthMethod::None);
    }
}
