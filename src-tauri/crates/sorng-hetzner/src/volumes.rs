use crate::client::HetznerClient;
use crate::error::HetznerResult;
use crate::types::*;

pub struct VolumeManager;

impl VolumeManager {
    pub async fn list_volumes(client: &HetznerClient) -> HetznerResult<Vec<HetznerVolume>> {
        let resp: VolumesResponse = client.get("/volumes").await?;
        Ok(resp.volumes)
    }

    pub async fn get_volume(client: &HetznerClient, id: u64) -> HetznerResult<HetznerVolume> {
        let resp: VolumeResponse = client.get(&format!("/volumes/{id}")).await?;
        Ok(resp.volume)
    }

    pub async fn create_volume(
        client: &HetznerClient,
        request: CreateVolumeRequest,
    ) -> HetznerResult<(HetznerVolume, HetznerAction)> {
        let body = serde_json::to_value(&request)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        let resp: CreateVolumeResponse = client.post("/volumes", &body).await?;
        Ok((resp.volume, resp.action))
    }

    pub async fn delete_volume(client: &HetznerClient, id: u64) -> HetznerResult<()> {
        client.delete_req(&format!("/volumes/{id}")).await
    }

    pub async fn attach(
        client: &HetznerClient,
        id: u64,
        server: u64,
        automount: Option<bool>,
    ) -> HetznerResult<HetznerAction> {
        let mut body = serde_json::json!({ "server": server });
        if let Some(am) = automount {
            body["automount"] = serde_json::Value::Bool(am);
        }
        client
            .post_action(&format!("/volumes/{id}/actions/attach"), &body)
            .await
    }

    pub async fn detach(client: &HetznerClient, id: u64) -> HetznerResult<HetznerAction> {
        client
            .post_action_empty(&format!("/volumes/{id}/actions/detach"))
            .await
    }

    pub async fn resize(
        client: &HetznerClient,
        id: u64,
        size: u64,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::json!({ "size": size });
        client
            .post_action(&format!("/volumes/{id}/actions/resize"), &body)
            .await
    }
}
