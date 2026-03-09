// ── sorng-warpgate/src/logs.rs ──────────────────────────────────────────────
//! Warpgate log querying.

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct LogManager;

impl LogManager {
    /// POST /logs
    pub async fn query(
        client: &WarpgateClient,
        req: &GetLogsRequest,
    ) -> WarpgateResult<Vec<WarpgateLogEntry>> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/logs", &body).await?;
        let logs: Vec<WarpgateLogEntry> = serde_json::from_value(resp)?;
        Ok(logs)
    }
}
