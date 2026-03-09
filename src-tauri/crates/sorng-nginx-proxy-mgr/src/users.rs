// ── NPM user management ─────────────────────────────────────────────────────

use crate::client::NpmClient;
use crate::error::NpmResult;
use crate::types::*;

pub struct UserManager;

impl UserManager {
    pub async fn list(client: &NpmClient) -> NpmResult<Vec<NpmUser>> {
        client.get("/users").await
    }

    pub async fn get(client: &NpmClient, id: u64) -> NpmResult<NpmUser> {
        client.get(&format!("/users/{}", id)).await
    }

    pub async fn create(client: &NpmClient, req: &CreateUserRequest) -> NpmResult<NpmUser> {
        client.post("/users", req).await
    }

    pub async fn update(
        client: &NpmClient,
        id: u64,
        req: &UpdateUserRequest,
    ) -> NpmResult<NpmUser> {
        client.put(&format!("/users/{}", id), req).await
    }

    pub async fn delete(client: &NpmClient, id: u64) -> NpmResult<()> {
        client.delete(&format!("/users/{}", id)).await
    }

    pub async fn change_password(
        client: &NpmClient,
        id: u64,
        req: &ChangePasswordRequest,
    ) -> NpmResult<()> {
        let _: serde_json::Value = client.put(&format!("/users/{}/auth", id), req).await?;
        Ok(())
    }

    pub async fn get_me(client: &NpmClient) -> NpmResult<NpmUser> {
        client.get("/users/me").await
    }
}
