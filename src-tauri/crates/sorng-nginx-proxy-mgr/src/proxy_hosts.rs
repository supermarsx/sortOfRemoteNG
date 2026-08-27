// ── NPM proxy host management ────────────────────────────────────────────────

use crate::client::NpmClient;
use crate::error::NpmResult;
use crate::types::*;

pub struct ProxyHostManager;

impl ProxyHostManager {
    pub async fn list(client: &NpmClient) -> NpmResult<Vec<NpmProxyHost>> {
        client
            .get("/nginx/proxy-hosts?expand=certificate,owner,access_list")
            .await
    }

    pub async fn get(client: &NpmClient, id: u64) -> NpmResult<NpmProxyHost> {
        client.get(&format!("/nginx/proxy-hosts/{}", id)).await
    }

    pub async fn create(
        client: &NpmClient,
        req: &CreateProxyHostRequest,
    ) -> NpmResult<NpmProxyHost> {
        client.post("/nginx/proxy-hosts", req).await
    }

    pub async fn update(
        client: &NpmClient,
        id: u64,
        req: &UpdateProxyHostRequest,
    ) -> NpmResult<NpmProxyHost> {
        client.put(&format!("/nginx/proxy-hosts/{}", id), req).await
    }

    pub async fn delete(client: &NpmClient, id: u64) -> NpmResult<()> {
        client.delete(&format!("/nginx/proxy-hosts/{}", id)).await
    }

    /// NPM answers `POST …/enable` with the bare JSON literal `true`, **not**
    /// the entity — discard the body and re-read the host so the caller still
    /// gets its fresh state.
    pub async fn enable(client: &NpmClient, id: u64) -> NpmResult<NpmProxyHost> {
        client
            .post::<_, serde_json::Value>(
                &format!("/nginx/proxy-hosts/{}/enable", id),
                &serde_json::json!({}),
            )
            .await?;
        Self::get(client, id).await
    }

    /// See [`ProxyHostManager::enable`] — `disable` returns `true` as well.
    pub async fn disable(client: &NpmClient, id: u64) -> NpmResult<NpmProxyHost> {
        client
            .post::<_, serde_json::Value>(
                &format!("/nginx/proxy-hosts/{}/disable", id),
                &serde_json::json!({}),
            )
            .await?;
        Self::get(client, id).await
    }
}
