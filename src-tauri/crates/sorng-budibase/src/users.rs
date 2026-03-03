// ── sorng-budibase/src/users.rs ────────────────────────────────────────────────
//! Budibase user management.

use crate::client::BudibaseClient;
use crate::error::BudibaseResult;
use crate::types::*;

pub struct UserManager;

impl UserManager {
    pub async fn list(client: &BudibaseClient) -> BudibaseResult<Vec<BudibaseUser>> {
        let body = serde_json::json!({});
        let resp = client.post("/users/search", &body).await?;
        let users: Vec<BudibaseUser> = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(serde_json::Value::Array(vec![]))
        )?;
        Ok(users)
    }

    pub async fn search(client: &BudibaseClient, email: Option<&str>, bookmark: Option<&str>) -> BudibaseResult<UserSearchResponse> {
        let mut body = serde_json::json!({});
        if let Some(e) = email {
            body["email"] = serde_json::json!(e);
        }
        if let Some(b) = bookmark {
            body["bookmark"] = serde_json::json!(b);
        }
        let resp = client.post("/users/search", &body).await?;
        let result: UserSearchResponse = serde_json::from_value(resp)?;
        Ok(result)
    }

    pub async fn get(client: &BudibaseClient, user_id: &str) -> BudibaseResult<BudibaseUser> {
        let resp = client.get(&format!("/users/{}", user_id)).await?;
        let user: BudibaseUser = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(user)
    }

    pub async fn create(client: &BudibaseClient, req: &CreateUserRequest) -> BudibaseResult<BudibaseUser> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/users", &body).await?;
        let user: BudibaseUser = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(user)
    }

    pub async fn update(client: &BudibaseClient, user_id: &str, req: &UpdateUserRequest) -> BudibaseResult<BudibaseUser> {
        let body = serde_json::to_value(req)?;
        let resp = client.put(&format!("/users/{}", user_id), &body).await?;
        let user: BudibaseUser = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(user)
    }

    pub async fn delete(client: &BudibaseClient, user_id: &str) -> BudibaseResult<()> {
        client.delete(&format!("/users/{}", user_id)).await?;
        Ok(())
    }
}
