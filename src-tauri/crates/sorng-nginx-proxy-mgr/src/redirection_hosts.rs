// ── NPM redirection host management ─────────────────────────────────────────

use crate::client::NpmClient;
use crate::error::NpmResult;
use crate::types::*;

pub struct RedirectionHostManager;

impl RedirectionHostManager {
    pub async fn list(client: &NpmClient) -> NpmResult<Vec<NpmRedirectionHost>> {
        client
            .get("/nginx/redirection-hosts?expand=certificate,owner")
            .await
    }

    pub async fn get(client: &NpmClient, id: u64) -> NpmResult<NpmRedirectionHost> {
        client
            .get(&format!("/nginx/redirection-hosts/{}", id))
            .await
    }

    pub async fn create(
        client: &NpmClient,
        req: &CreateRedirectionHostRequest,
    ) -> NpmResult<NpmRedirectionHost> {
        client.post("/nginx/redirection-hosts", req).await
    }

    pub async fn update(
        client: &NpmClient,
        id: u64,
        req: &CreateRedirectionHostRequest,
    ) -> NpmResult<NpmRedirectionHost> {
        client
            .put(&format!("/nginx/redirection-hosts/{}", id), req)
            .await
    }

    pub async fn delete(client: &NpmClient, id: u64) -> NpmResult<()> {
        client
            .delete(&format!("/nginx/redirection-hosts/{}", id))
            .await
    }

    /// NPM answers `POST …/enable` with the bare JSON literal `true`, **not**
    /// the entity — discard the body and re-read the host so the caller still
    /// gets its fresh state.
    pub async fn enable(client: &NpmClient, id: u64) -> NpmResult<NpmRedirectionHost> {
        client
            .post::<_, serde_json::Value>(
                &format!("/nginx/redirection-hosts/{}/enable", id),
                &serde_json::json!({}),
            )
            .await?;
        Self::get(client, id).await
    }

    /// See [`RedirectionHostManager::enable`] — `disable` returns `true` as well.
    pub async fn disable(client: &NpmClient, id: u64) -> NpmResult<NpmRedirectionHost> {
        client
            .post::<_, serde_json::Value>(
                &format!("/nginx/redirection-hosts/{}/disable", id),
                &serde_json::json!({}),
            )
            .await?;
        Self::get(client, id).await
    }
}
