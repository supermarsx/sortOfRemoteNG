// ── NPM dead host (404) management ──────────────────────────────────────────

use crate::client::NpmClient;
use crate::error::NpmResult;
use crate::types::*;

pub struct DeadHostManager;

impl DeadHostManager {
    pub async fn list(client: &NpmClient) -> NpmResult<Vec<NpmDeadHost>> {
        client
            .get("/nginx/dead-hosts?expand=certificate,owner")
            .await
    }

    pub async fn get(client: &NpmClient, id: u64) -> NpmResult<NpmDeadHost> {
        client.get(&format!("/nginx/dead-hosts/{}", id)).await
    }

    pub async fn create(client: &NpmClient, req: &CreateDeadHostRequest) -> NpmResult<NpmDeadHost> {
        client.post("/nginx/dead-hosts", req).await
    }

    pub async fn update(
        client: &NpmClient,
        id: u64,
        req: &CreateDeadHostRequest,
    ) -> NpmResult<NpmDeadHost> {
        client.put(&format!("/nginx/dead-hosts/{}", id), req).await
    }

    pub async fn delete(client: &NpmClient, id: u64) -> NpmResult<()> {
        client.delete(&format!("/nginx/dead-hosts/{}", id)).await
    }
}
