//! User and group management for pfSense/OPNsense.

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct UserManager;

impl UserManager {
    pub async fn list_users(client: &PfsenseClient) -> PfsenseResult<Vec<PfsenseUser>> {
        let resp = client.api_get("/system/user").await?;
        let users = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        users.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_user(client: &PfsenseClient, uid: &str) -> PfsenseResult<PfsenseUser> {
        let users = Self::list_users(client).await?;
        users.into_iter()
            .find(|u| u.uid == uid || u.name == uid)
            .ok_or_else(|| PfsenseError::api(format!("User not found: {uid}")))
    }

    pub async fn create_user(client: &PfsenseClient, req: &CreateUserRequest) -> PfsenseResult<PfsenseUser> {
        let body = serde_json::to_value(req)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/system/user", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn update_user(client: &PfsenseClient, uid: &str, req: &UpdateUserRequest) -> PfsenseResult<PfsenseUser> {
        let body = serde_json::to_value(req)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_put(&format!("/system/user/{uid}"), &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_user(client: &PfsenseClient, uid: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/system/user/{uid}")).await
    }

    pub async fn list_groups(client: &PfsenseClient) -> PfsenseResult<Vec<PfsenseGroup>> {
        let resp = client.api_get("/system/group").await?;
        let groups = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        groups.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_group(client: &PfsenseClient, name: &str) -> PfsenseResult<PfsenseGroup> {
        let groups = Self::list_groups(client).await?;
        groups.into_iter()
            .find(|g| g.name == name || g.gid == name)
            .ok_or_else(|| PfsenseError::api(format!("Group not found: {name}")))
    }

    pub async fn create_group(client: &PfsenseClient, group: &PfsenseGroup) -> PfsenseResult<PfsenseGroup> {
        let body = serde_json::to_value(group)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/system/group", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_group(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/system/group/{name}")).await
    }

    pub async fn add_user_to_group(client: &PfsenseClient, uid: &str, group_name: &str) -> PfsenseResult<()> {
        let body = serde_json::json!({ "member": uid });
        client.api_post(&format!("/system/group/{group_name}/member"), &body).await?;
        Ok(())
    }

    pub async fn remove_user_from_group(client: &PfsenseClient, uid: &str, group_name: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/system/group/{group_name}/member/{uid}")).await
    }

    pub async fn list_privileges(client: &PfsenseClient) -> PfsenseResult<Vec<UserPrivilege>> {
        let resp = client.api_get("/system/privilege").await?;
        let privs = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        privs.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }
}
