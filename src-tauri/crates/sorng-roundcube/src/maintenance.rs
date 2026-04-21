// ── Roundcube maintenance operations ─────────────────────────────────────────

use crate::client::RoundcubeClient;
use crate::error::RoundcubeResult;
use crate::types::*;
use log::debug;

pub struct MaintenanceManager;

impl MaintenanceManager {
    /// POST /maintenance/vacuum — vacuum the database.
    pub async fn vacuum_db(client: &RoundcubeClient) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE vacuum_db");
        client.post_no_body("/maintenance/vacuum").await
    }

    /// POST /maintenance/optimize — optimize the database.
    pub async fn optimize_db(client: &RoundcubeClient) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE optimize_db");
        client.post_no_body("/maintenance/optimize").await
    }

    /// POST /maintenance/clear-temp — clear temporary files.
    pub async fn clear_temp_files(client: &RoundcubeClient) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE clear_temp_files");
        client.post_no_body("/maintenance/clear-temp").await
    }

    /// POST /maintenance/clear-sessions — clear expired sessions.
    pub async fn clear_expired_sessions(client: &RoundcubeClient) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE clear_expired_sessions");
        client.post_no_body("/maintenance/clear-sessions").await
    }

    /// GET /maintenance/db-stats — get database statistics.
    pub async fn get_db_stats(client: &RoundcubeClient) -> RoundcubeResult<RoundcubeDbStats> {
        debug!("ROUNDCUBE get_db_stats");
        client.get("/maintenance/db-stats").await
    }

    /// POST /maintenance/test-smtp — test SMTP connectivity.
    pub async fn test_smtp(client: &RoundcubeClient, to: &str) -> RoundcubeResult<bool> {
        debug!("ROUNDCUBE test_smtp to={to}");
        let body = serde_json::json!({ "to": to });
        let result: serde_json::Value = client.post("/maintenance/test-smtp", &body).await?;
        Ok(result
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(false))
    }

    /// POST /maintenance/test-imap — test IMAP connectivity.
    pub async fn test_imap(
        client: &RoundcubeClient,
        host: &str,
        user: &str,
        pass: &str,
    ) -> RoundcubeResult<bool> {
        debug!("ROUNDCUBE test_imap host={host} user={user}");
        let body = serde_json::json!({
            "host": host,
            "user": user,
            "password": pass,
        });
        let result: serde_json::Value = client.post("/maintenance/test-imap", &body).await?;
        Ok(result
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(false))
    }
}
