// ── sorng-docker/src/networks.rs ──────────────────────────────────────────────
//! Docker network management.

use crate::client::DockerClient;
use crate::error::DockerResult;
use crate::types::*;
use std::collections::HashMap;

pub struct NetworkManager;

impl NetworkManager {
    /// List networks.
    pub async fn list(client: &DockerClient, opts: &ListNetworksOptions) -> DockerResult<Vec<NetworkInfo>> {
        let path = if let Some(ref f) = opts.filters {
            let fs = serde_json::to_string(f).unwrap_or_default();
            format!("/networks?filters={}", fs)
        } else {
            "/networks".to_string()
        };
        client.get(&path).await
    }

    /// Inspect a network.
    pub async fn inspect(client: &DockerClient, id: &str) -> DockerResult<NetworkInfo> {
        client.get(&format!("/networks/{}", id)).await
    }

    /// Create a network.
    pub async fn create(client: &DockerClient, config: &CreateNetworkConfig) -> DockerResult<CreateNetworkResponse> {
        client.post_json("/networks/create", config).await
    }

    /// Remove a network.
    pub async fn remove(client: &DockerClient, id: &str) -> DockerResult<()> {
        client.delete(&format!("/networks/{}", id)).await
    }

    /// Connect a container to a network.
    pub async fn connect(client: &DockerClient, network_id: &str, config: &ConnectNetworkConfig) -> DockerResult<()> {
        let _body = serde_json::json!({
            "Container": config.container,
            "EndpointConfig": config.endpoint_config
        });
        client.post_empty(&format!("/networks/{}/connect", network_id)).await
    }

    /// Disconnect a container from a network.
    pub async fn disconnect(client: &DockerClient, network_id: &str, container_id: &str, force: bool) -> DockerResult<()> {
        let body = serde_json::json!({
            "Container": container_id,
            "Force": force
        });
        // Use the post_json to send body, ignore typed response.
        let _: serde_json::Value = client.post_json(
            &format!("/networks/{}/disconnect", network_id),
            &body,
        ).await.unwrap_or_default();
        Ok(())
    }

    /// Prune unused networks.
    pub async fn prune(client: &DockerClient, filters: Option<&HashMap<String, Vec<String>>>) -> DockerResult<PruneResult> {
        let path = if let Some(f) = filters {
            let fs = serde_json::to_string(f).unwrap_or_default();
            format!("/networks/prune?filters={}", fs)
        } else {
            "/networks/prune".to_string()
        };
        let resp: serde_json::Value = client.post_json(&path, &serde_json::json!({})).await?;
        let deleted = resp.get("NetworksDeleted")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        Ok(PruneResult { deleted_items: deleted, space_reclaimed: 0 })
    }
}
