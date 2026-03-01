//! High-level OneDrive service – the single facade consumed by the
//! Tauri command layer.
//!
//! Manages multiple authenticated sessions (personal, work, site drives),
//! automatic token refresh, and exposes every sub-module via short-lived
//! borrows.

use crate::onedrive::api_client::GraphApiClient;
use crate::onedrive::auth;
use crate::onedrive::drives::OneDriveDrives;
use crate::onedrive::error::{OneDriveError, OneDriveResult};
use crate::onedrive::files::OneDriveFiles;
use crate::onedrive::permissions::OneDrivePermissions;
use crate::onedrive::search::OneDriveSearch;
use crate::onedrive::sharing::OneDriveSharing;
use crate::onedrive::special_folders::OneDriveSpecialFolders;
use crate::onedrive::sync_engine::OneDriveSyncEngine;
use crate::onedrive::thumbnails::OneDriveThumbnails;
use crate::onedrive::types::*;
use crate::onedrive::webhooks::OneDriveWebhooks;
use chrono::Utc;
use log::info;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Thread-safe handle for the Tauri state.
pub type OneDriveServiceState = Arc<RwLock<OneDriveService>>;

/// Top-level service managing one or more OneDrive sessions.
pub struct OneDriveService {
    sessions: HashMap<String, OneDriveSession>,
}

impl OneDriveService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    // ─── Session lifecycle ───────────────────────────────────────────

    /// Register a new session after a successful OAuth flow.
    pub async fn add_session(
        &mut self,
        config: OneDriveConfig,
        token: OAuthTokenSet,
    ) -> OneDriveResult<String> {
        // Fetch user profile & default drive.
        let profile = auth::get_user_profile(&token.access_token).await?;

        let client = GraphApiClient::new(&config, &token.access_token)?;
        let drives = OneDriveDrives::new(&client);
        let my_drive = drives.get_my_drive().await?;

        let session_id = uuid::Uuid::new_v4().to_string();
        let session = OneDriveSession {
            id: session_id.clone(),
            user_profile: Some(profile),
            token,
            config,
            default_drive_id: Some(my_drive.id),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
        };

        info!("Added OneDrive session {}", session_id);
        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    /// Remove a session.
    pub fn remove_session(&mut self, session_id: &str) -> OneDriveResult<()> {
        self.sessions
            .remove(session_id)
            .map(|_| ())
            .ok_or_else(|| OneDriveError::session_not_found(session_id))
    }

    /// List active sessions.
    pub fn list_sessions(&self) -> Vec<OneDriveSessionSummary> {
        self.sessions
            .values()
            .map(|s| OneDriveSessionSummary {
                session_id: s.id.clone(),
                display_name: s
                    .user_profile
                    .as_ref()
                    .and_then(|p| p.display_name.clone()),
                email: s
                    .user_profile
                    .as_ref()
                    .and_then(|p| p.mail.clone()),
                drive_type: None,
                quota_used: None,
                quota_total: None,
            })
            .collect()
    }

    /// Get a session reference.
    pub fn get_session(&self, session_id: &str) -> OneDriveResult<&OneDriveSession> {
        self.sessions
            .get(session_id)
            .ok_or_else(|| OneDriveError::session_not_found(session_id))
    }

    /// Get a mutable session reference.
    pub fn get_session_mut(
        &mut self,
        session_id: &str,
    ) -> OneDriveResult<&mut OneDriveSession> {
        self.sessions
            .get_mut(session_id)
            .ok_or_else(|| OneDriveError::session_not_found(session_id))
    }

    // ─── Token management ────────────────────────────────────────────

    /// Refresh the token for a session if it's expired.
    pub async fn ensure_token(&mut self, session_id: &str) -> OneDriveResult<String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| OneDriveError::session_not_found(session_id))?;

        if !session.token.is_expired() {
            return Ok(session.token.access_token.clone());
        }

        let refresh = session
            .token
            .refresh_token
            .as_deref()
            .ok_or_else(|| OneDriveError::auth("No refresh token available"))?
            .to_string();
        let config = session.config.clone();

        let new_token = auth::refresh_token(&config, &refresh).await?;
        let access = new_token.access_token.clone();

        let session = self.sessions.get_mut(session_id).unwrap();
        session.token = new_token;
        session.last_activity = Utc::now();

        info!("Refreshed token for session {}", session_id);
        Ok(access)
    }

    /// Build a `GraphApiClient` for a session, auto-refreshing if needed.
    pub async fn client_for(
        &mut self,
        session_id: &str,
    ) -> OneDriveResult<(GraphApiClient, String)> {
        let access_token = self.ensure_token(session_id).await?;
        let session = self.sessions.get(session_id).unwrap();
        let client = GraphApiClient::new(&session.config, &access_token)?;
        let drive_id = session
            .default_drive_id
            .clone()
            .unwrap_or_else(|| "me".into());
        Ok((client, drive_id))
    }

    // ─── Convenience accessors for sub-modules ───────────────────────

    /// Get a `OneDriveFiles` helper.
    pub fn files<'a>(
        &self,
        client: &'a GraphApiClient,
        drive_id: &str,
    ) -> OneDriveFiles<'a> {
        OneDriveFiles::new(client, drive_id)
    }

    /// Get a `OneDriveSharing` helper.
    pub fn sharing<'a>(
        &self,
        client: &'a GraphApiClient,
        drive_id: &str,
    ) -> OneDriveSharing<'a> {
        OneDriveSharing::new(client, drive_id)
    }

    /// Get a `OneDriveSearch` helper.
    pub fn search<'a>(
        &self,
        client: &'a GraphApiClient,
        drive_id: &str,
    ) -> OneDriveSearch<'a> {
        OneDriveSearch::new(client, drive_id)
    }

    /// Get a `OneDriveSyncEngine` helper.
    pub fn sync_engine<'a>(
        &self,
        client: &'a GraphApiClient,
        drive_id: &str,
    ) -> OneDriveSyncEngine<'a> {
        OneDriveSyncEngine::new(client, drive_id)
    }

    /// Get a `OneDriveDrives` helper.
    pub fn drives<'a>(&self, client: &'a GraphApiClient) -> OneDriveDrives<'a> {
        OneDriveDrives::new(client)
    }

    /// Get a `OneDrivePermissions` helper.
    pub fn permissions<'a>(
        &self,
        client: &'a GraphApiClient,
        drive_id: &str,
    ) -> OneDrivePermissions<'a> {
        OneDrivePermissions::new(client, drive_id)
    }

    /// Get a `OneDriveThumbnails` helper.
    pub fn thumbnails<'a>(
        &self,
        client: &'a GraphApiClient,
        drive_id: &str,
    ) -> OneDriveThumbnails<'a> {
        OneDriveThumbnails::new(client, drive_id)
    }

    /// Get a `OneDriveSpecialFolders` helper.
    pub fn special_folders<'a>(
        &self,
        client: &'a GraphApiClient,
    ) -> OneDriveSpecialFolders<'a> {
        OneDriveSpecialFolders::new(client)
    }

    /// Get a `OneDriveWebhooks` helper.
    pub fn webhooks<'a>(&self, client: &'a GraphApiClient) -> OneDriveWebhooks<'a> {
        OneDriveWebhooks::new(client)
    }
}

impl Default for OneDriveService {
    fn default() -> Self {
        Self::new()
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_service() {
        let svc = OneDriveService::new();
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn test_session_not_found() {
        let svc = OneDriveService::new();
        let result = svc.get_session("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_session_missing() {
        let mut svc = OneDriveService::new();
        let result = svc.remove_session("nope");
        assert!(result.is_err());
    }
}
