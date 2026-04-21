use crate::client::HetznerClient;
use crate::error::HetznerResult;
use crate::types::*;

pub struct SshKeyManager;

impl SshKeyManager {
    pub async fn list_ssh_keys(client: &HetznerClient) -> HetznerResult<Vec<HetznerSshKey>> {
        let resp: SshKeysResponse = client.get("/ssh_keys").await?;
        Ok(resp.ssh_keys)
    }

    pub async fn get_ssh_key(client: &HetznerClient, id: u64) -> HetznerResult<HetznerSshKey> {
        let resp: SshKeyResponse = client.get(&format!("/ssh_keys/{id}")).await?;
        Ok(resp.ssh_key)
    }

    pub async fn create_ssh_key(
        client: &HetznerClient,
        request: CreateSshKeyRequest,
    ) -> HetznerResult<HetznerSshKey> {
        let body = serde_json::to_value(&request)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        let resp: SshKeyResponse = client.post("/ssh_keys", &body).await?;
        Ok(resp.ssh_key)
    }

    pub async fn update_ssh_key(
        client: &HetznerClient,
        id: u64,
        name: Option<String>,
        labels: Option<serde_json::Value>,
    ) -> HetznerResult<HetznerSshKey> {
        let mut body = serde_json::json!({});
        if let Some(n) = name {
            body["name"] = serde_json::Value::String(n);
        }
        if let Some(l) = labels {
            body["labels"] = l;
        }
        let resp: SshKeyResponse = client.put(&format!("/ssh_keys/{id}"), &body).await?;
        Ok(resp.ssh_key)
    }

    pub async fn delete_ssh_key(client: &HetznerClient, id: u64) -> HetznerResult<()> {
        client.delete_req(&format!("/ssh_keys/{id}")).await
    }
}
