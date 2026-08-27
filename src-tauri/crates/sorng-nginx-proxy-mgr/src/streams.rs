// ── NPM stream (TCP/UDP) management ─────────────────────────────────────────

use crate::client::NpmClient;
use crate::error::NpmResult;
use crate::types::*;

pub struct StreamManager;

impl StreamManager {
    pub async fn list(client: &NpmClient) -> NpmResult<Vec<NpmStream>> {
        client.get("/nginx/streams?expand=owner").await
    }

    pub async fn get(client: &NpmClient, id: u64) -> NpmResult<NpmStream> {
        client.get(&format!("/nginx/streams/{}", id)).await
    }

    pub async fn create(client: &NpmClient, req: &CreateStreamRequest) -> NpmResult<NpmStream> {
        client.post("/nginx/streams", req).await
    }

    pub async fn update(
        client: &NpmClient,
        id: u64,
        req: &CreateStreamRequest,
    ) -> NpmResult<NpmStream> {
        client.put(&format!("/nginx/streams/{}", id), req).await
    }

    pub async fn delete(client: &NpmClient, id: u64) -> NpmResult<()> {
        client.delete(&format!("/nginx/streams/{}", id)).await
    }

    /// NPM answers `POST …/enable` with the bare JSON literal `true`, **not**
    /// the entity — discard the body and re-read the stream so the caller
    /// still gets its fresh state.
    pub async fn enable(client: &NpmClient, id: u64) -> NpmResult<NpmStream> {
        client
            .post::<_, serde_json::Value>(
                &format!("/nginx/streams/{}/enable", id),
                &serde_json::json!({}),
            )
            .await?;
        Self::get(client, id).await
    }

    /// See [`StreamManager::enable`] — `disable` returns `true` as well.
    pub async fn disable(client: &NpmClient, id: u64) -> NpmResult<NpmStream> {
        client
            .post::<_, serde_json::Value>(
                &format!("/nginx/streams/{}/disable", id),
                &serde_json::json!({}),
            )
            .await?;
        Self::get(client, id).await
    }
}
