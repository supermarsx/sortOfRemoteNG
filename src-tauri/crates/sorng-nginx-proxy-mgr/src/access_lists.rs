// ── NPM access list management ───────────────────────────────────────────────

use crate::client::NpmClient;
use crate::error::NpmResult;
use crate::types::*;

pub struct AccessListManager;

impl AccessListManager {
    pub async fn list(client: &NpmClient) -> NpmResult<Vec<NpmAccessList>> {
        client.get("/nginx/access-lists?expand=owner,items,clients,proxy_host_count").await
    }

    pub async fn get(client: &NpmClient, id: u64) -> NpmResult<NpmAccessList> {
        client.get(&format!("/nginx/access-lists/{}", id)).await
    }

    pub async fn create(client: &NpmClient, req: &CreateAccessListRequest) -> NpmResult<NpmAccessList> {
        client.post("/nginx/access-lists", req).await
    }

    pub async fn update(client: &NpmClient, id: u64, req: &CreateAccessListRequest) -> NpmResult<NpmAccessList> {
        client.put(&format!("/nginx/access-lists/{}", id), req).await
    }

    pub async fn delete(client: &NpmClient, id: u64) -> NpmResult<()> {
        client.delete(&format!("/nginx/access-lists/{}", id)).await
    }
}
