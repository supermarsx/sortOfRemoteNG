//! Server health check, settings, and directory sync for Passbolt.
//!
//! Endpoints:
//! - `GET /healthcheck.json`              — full health check
//! - `GET /healthcheck/status.json`       — quick status
//! - `GET /settings.json`                 — server settings
//! - `GET /directorysync/synchronize/dry-run.json`  — directory sync dry-run
//! - `POST /directorysync/synchronize.json`         — trigger directory sync

use crate::passbolt::api_client::PassboltApiClient;
use crate::passbolt::types::*;
use log::info;

/// Health check & settings API operations.
pub struct PassboltHealthcheck;

impl PassboltHealthcheck {
    /// Full server health check.
    pub async fn full(client: &PassboltApiClient) -> Result<HealthcheckInfo, PassboltError> {
        info!("Running full health check");
        let resp: ApiResponse<HealthcheckInfo> = client.get("/healthcheck.json").await?;
        Ok(resp.body)
    }

    /// Quick server status check (lightweight).
    pub async fn status(client: &PassboltApiClient) -> Result<serde_json::Value, PassboltError> {
        let resp: ApiResponse<serde_json::Value> = client.get("/healthcheck/status.json").await?;
        Ok(resp.body)
    }

    /// Quick server reachability check.
    pub async fn is_reachable(client: &PassboltApiClient) -> Result<bool, PassboltError> {
        match Self::status(client).await {
            Ok(_) => Ok(true),
            Err(e) => {
                if e.kind == PassboltErrorKind::NetworkError {
                    Ok(false)
                } else {
                    // Server responded (even with an error), so it's reachable.
                    Ok(true)
                }
            }
        }
    }

    /// Get server settings.
    pub async fn settings(client: &PassboltApiClient) -> Result<ServerSettings, PassboltError> {
        let resp: ApiResponse<ServerSettings> = client.get("/settings.json").await?;
        Ok(resp.body)
    }

    /// Get server public settings (unauthenticated).
    pub async fn public_settings(
        client: &PassboltApiClient,
    ) -> Result<serde_json::Value, PassboltError> {
        let resp: ApiResponse<serde_json::Value> =
            client.get_unauthenticated("/settings.json").await?;
        Ok(resp.body)
    }
}

/// Directory synchronization API operations (LDAP/AD sync).
pub struct PassboltDirectorySync;

impl PassboltDirectorySync {
    /// Dry-run a directory synchronization.
    pub async fn dry_run(client: &PassboltApiClient) -> Result<DirectorySyncResult, PassboltError> {
        info!("Running directory sync dry-run");
        let resp: ApiResponse<DirectorySyncResult> = client
            .get("/directorysync/synchronize/dry-run.json")
            .await?;
        Ok(resp.body)
    }

    /// Execute a directory synchronization.
    pub async fn synchronize(
        client: &PassboltApiClient,
    ) -> Result<DirectorySyncResult, PassboltError> {
        info!("Executing directory synchronization");
        let resp: ApiResponse<DirectorySyncResult> = client
            .post("/directorysync/synchronize.json", &serde_json::json!({}))
            .await?;
        Ok(resp.body)
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_healthcheck_info_deserialize() {
        let json = r#"{
            "ssl": true,
            "database": true,
            "application": true
        }"#;
        let h: HealthcheckInfo = serde_json::from_str(json).unwrap();
        assert_eq!(h.ssl.unwrap(), serde_json::Value::Bool(true));
        assert_eq!(h.database.unwrap(), serde_json::Value::Bool(true));
    }

    #[test]
    fn test_server_settings_deserialize() {
        let json = r#"{
            "app": {
                "version": "4.6.0",
                "url": "https://passbolt.example.com"
            }
        }"#;
        let s: ServerSettings = serde_json::from_str(json).unwrap();
        assert!(s.app.is_some());
    }

    #[test]
    fn test_directory_sync_result_deserialize() {
        let json = r#"{
            "users": [
                {"id": "u1", "action": "created"},
                {"id": "u2", "action": "deleted"}
            ],
            "groups": [
                {"id": "g1", "action": "created"}
            ]
        }"#;
        let r: DirectorySyncResult = serde_json::from_str(json).unwrap();
        assert!(r.users.is_some());
        assert!(r.groups.is_some());
    }
}
