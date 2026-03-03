// ── sorng-warpgate/src/recordings.rs ────────────────────────────────────────
//! Warpgate session recording retrieval.

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct RecordingManager;

impl RecordingManager {
    /// GET /recordings/:id
    pub async fn get(client: &WarpgateClient, recording_id: &str) -> WarpgateResult<WarpgateRecording> {
        let resp = client.get(&format!("/recordings/{}", recording_id)).await?;
        let recording: WarpgateRecording = serde_json::from_value(resp)?;
        Ok(recording)
    }

    /// GET /recordings/:id/cast  (asciicast terminal recording)
    pub async fn get_cast(client: &WarpgateClient, recording_id: &str) -> WarpgateResult<String> {
        client.get_text(&format!("/recordings/{}/cast", recording_id)).await
    }

    /// GET /recordings/:id/tcpdump (traffic recording as bytes)
    pub async fn get_tcpdump(client: &WarpgateClient, recording_id: &str) -> WarpgateResult<Vec<u8>> {
        client.get_bytes(&format!("/recordings/{}/tcpdump", recording_id)).await
    }

    /// GET /recordings/:id/kubernetes
    pub async fn get_kubernetes(client: &WarpgateClient, recording_id: &str) -> WarpgateResult<serde_json::Value> {
        client.get(&format!("/recordings/{}/kubernetes", recording_id)).await
    }
}
