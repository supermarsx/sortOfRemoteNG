// ── sorng-netbox – Users module ──────────────────────────────────────────────
//! NetBox users, groups, tokens, permissions, object changes.

use crate::client::NetboxClient;
use crate::error::{NetboxError, NetboxResult};
use crate::types::*;

pub struct UserManager;

impl UserManager {
    // ── Users ────────────────────────────────────────────────────────

    pub async fn list_users(client: &NetboxClient) -> NetboxResult<Vec<NetboxUser>> {
        client.api_get_list("/users/users/").await
    }

    pub async fn get_user(client: &NetboxClient, id: i64) -> NetboxResult<NetboxUser> {
        let body = client.api_get(&format!("/users/users/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_user: {e}")))
    }

    // ── Groups ───────────────────────────────────────────────────────

    pub async fn list_groups(client: &NetboxClient) -> NetboxResult<Vec<NetboxGroup>> {
        client.api_get_list("/users/groups/").await
    }

    // ── Tokens ───────────────────────────────────────────────────────

    pub async fn list_tokens(client: &NetboxClient) -> NetboxResult<Vec<NetboxToken>> {
        client.api_get_list("/users/tokens/").await
    }

    pub async fn create_token(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<NetboxToken> {
        let body = client.api_post("/users/tokens/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_token: {e}")))
    }

    pub async fn delete_token(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/users/tokens/{id}/")).await?;
        Ok(())
    }

    // ── Permissions ──────────────────────────────────────────────────

    pub async fn list_permissions(client: &NetboxClient) -> NetboxResult<Vec<ObjectPermission>> {
        client.api_get_list("/users/permissions/").await
    }

    // ── Object changes ───────────────────────────────────────────────

    pub async fn list_object_changes(client: &NetboxClient) -> NetboxResult<Vec<ObjectChange>> {
        client.api_get_list("/extras/object-changes/").await
    }
}
