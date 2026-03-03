// ── sorng-warpgate/src/sessions.rs ──────────────────────────────────────────
//! Warpgate session management.

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct SessionManager;

impl SessionManager {
    /// GET /sessions?offset=&limit=&active_only=&logged_in_only=
    pub async fn list(
        client: &WarpgateClient,
        offset: Option<u64>,
        limit: Option<u64>,
        active_only: Option<bool>,
        logged_in_only: Option<bool>,
    ) -> WarpgateResult<SessionListResponse> {
        let mut params = Vec::new();
        if let Some(o) = offset { params.push(("offset".to_string(), o.to_string())); }
        if let Some(l) = limit { params.push(("limit".to_string(), l.to_string())); }
        if let Some(a) = active_only { params.push(("active_only".to_string(), a.to_string())); }
        if let Some(li) = logged_in_only { params.push(("logged_in_only".to_string(), li.to_string())); }

        let param_refs: Vec<(&str, &str)> = params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let resp = if param_refs.is_empty() {
            client.get("/sessions").await?
        } else {
            client.get_with_params("/sessions", &param_refs).await?
        };
        let session_resp: SessionListResponse = serde_json::from_value(resp)?;
        Ok(session_resp)
    }

    /// GET /sessions/:id
    pub async fn get(client: &WarpgateClient, session_id: &str) -> WarpgateResult<WarpgateSession> {
        let resp = client.get(&format!("/sessions/{}", session_id)).await?;
        let session: WarpgateSession = serde_json::from_value(resp)?;
        Ok(session)
    }

    /// POST /sessions/:id/close
    pub async fn close(client: &WarpgateClient, session_id: &str) -> WarpgateResult<()> {
        client.post_empty(&format!("/sessions/{}/close", session_id)).await?;
        Ok(())
    }

    /// DELETE /sessions (close all)
    pub async fn close_all(client: &WarpgateClient) -> WarpgateResult<()> {
        client.delete("/sessions").await?;
        Ok(())
    }

    /// GET /sessions/:id/recordings
    pub async fn get_recordings(client: &WarpgateClient, session_id: &str) -> WarpgateResult<Vec<WarpgateRecording>> {
        let resp = client.get(&format!("/sessions/{}/recordings", session_id)).await?;
        let recordings: Vec<WarpgateRecording> = serde_json::from_value(resp)?;
        Ok(recordings)
    }
}
