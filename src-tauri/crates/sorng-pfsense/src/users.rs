use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct UserManager;

impl UserManager {
    pub async fn list(client: &PfsenseClient) -> PfsenseResult<Vec<PfsenseUser>> {
        let resp: ApiListResponse<PfsenseUser> = client.api_get("user").await?;
        Ok(resp.data)
    }

    pub async fn get(client: &PfsenseClient, name: &str) -> PfsenseResult<PfsenseUser> {
        let resp: ApiResponse<PfsenseUser> = client.api_get(&format!("user/{name}")).await?;
        Ok(resp.data)
    }

    pub async fn create(client: &PfsenseClient, user: &PfsenseUser) -> PfsenseResult<PfsenseUser> {
        let resp: ApiResponse<PfsenseUser> = client.api_post("user", user).await?;
        Ok(resp.data)
    }

    pub async fn update(
        client: &PfsenseClient,
        name: &str,
        user: &PfsenseUser,
    ) -> PfsenseResult<PfsenseUser> {
        let resp: ApiResponse<PfsenseUser> = client.api_put(&format!("user/{name}"), user).await?;
        Ok(resp.data)
    }

    pub async fn delete(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("user/{name}")).await
    }

    pub async fn list_groups(client: &PfsenseClient) -> PfsenseResult<Vec<PfsenseGroup>> {
        let resp: ApiListResponse<PfsenseGroup> = client.api_get("user/group").await?;
        Ok(resp.data)
    }

    pub async fn get_group(client: &PfsenseClient, name: &str) -> PfsenseResult<PfsenseGroup> {
        let resp: ApiResponse<PfsenseGroup> = client.api_get(&format!("user/group/{name}")).await?;
        Ok(resp.data)
    }

    pub async fn create_group(
        client: &PfsenseClient,
        group: &PfsenseGroup,
    ) -> PfsenseResult<PfsenseGroup> {
        let resp: ApiResponse<PfsenseGroup> = client.api_post("user/group", group).await?;
        Ok(resp.data)
    }

    pub async fn update_group(
        client: &PfsenseClient,
        name: &str,
        group: &PfsenseGroup,
    ) -> PfsenseResult<PfsenseGroup> {
        let resp: ApiResponse<PfsenseGroup> =
            client.api_put(&format!("user/group/{name}"), group).await?;
        Ok(resp.data)
    }

    pub async fn delete_group(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("user/group/{name}")).await
    }

    pub async fn list_privileges(client: &PfsenseClient) -> PfsenseResult<Vec<UserPrivilege>> {
        let resp: ApiListResponse<UserPrivilege> = client.api_get("user/privilege").await?;
        Ok(resp.data)
    }

    pub async fn add_privilege(
        client: &PfsenseClient,
        user: &str,
        priv_id: &str,
    ) -> PfsenseResult<serde_json::Value> {
        let body = serde_json::json!({"priv": priv_id});
        client
            .api_post(&format!("user/{user}/privilege"), &body)
            .await
    }

    pub async fn remove_privilege(
        client: &PfsenseClient,
        user: &str,
        priv_id: &str,
    ) -> PfsenseResult<()> {
        client
            .api_delete_void(&format!("user/{user}/privilege/{priv_id}"))
            .await
    }
}
