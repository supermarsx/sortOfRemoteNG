use crate::client::HetznerClient;
use crate::error::HetznerResult;
use crate::types::*;

pub struct ServerManager;

impl ServerManager {
    pub async fn list_servers(client: &HetznerClient) -> HetznerResult<Vec<HetznerServer>> {
        let resp: ServersResponse = client.get("/servers").await?;
        Ok(resp.servers)
    }

    pub async fn get_server(client: &HetznerClient, id: u64) -> HetznerResult<HetznerServer> {
        let resp: ServerResponse = client.get(&format!("/servers/{id}")).await?;
        Ok(resp.server)
    }

    pub async fn create_server(
        client: &HetznerClient,
        request: CreateServerRequest,
    ) -> HetznerResult<(HetznerServer, HetznerAction)> {
        let body = serde_json::to_value(&request)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        let resp: CreateServerResponse = client.post("/servers", &body).await?;
        Ok((resp.server, resp.action))
    }

    pub async fn delete_server(client: &HetznerClient, id: u64) -> HetznerResult<()> {
        client.delete_req(&format!("/servers/{id}")).await
    }

    pub async fn start_server(client: &HetznerClient, id: u64) -> HetznerResult<HetznerAction> {
        client
            .post_action_empty(&format!("/servers/{id}/actions/poweron"))
            .await
    }

    pub async fn stop_server(client: &HetznerClient, id: u64) -> HetznerResult<HetznerAction> {
        client
            .post_action_empty(&format!("/servers/{id}/actions/poweroff"))
            .await
    }

    pub async fn reboot_server(client: &HetznerClient, id: u64) -> HetznerResult<HetznerAction> {
        client
            .post_action_empty(&format!("/servers/{id}/actions/reboot"))
            .await
    }

    pub async fn rebuild_server(
        client: &HetznerClient,
        id: u64,
        image: String,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::json!({ "image": image });
        client
            .post_action(&format!("/servers/{id}/actions/rebuild"), &body)
            .await
    }

    pub async fn reset_server(client: &HetznerClient, id: u64) -> HetznerResult<HetznerAction> {
        client
            .post_action_empty(&format!("/servers/{id}/actions/reset"))
            .await
    }

    pub async fn change_type(
        client: &HetznerClient,
        id: u64,
        server_type: String,
        upgrade_disk: bool,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::json!({
            "server_type": server_type,
            "upgrade_disk": upgrade_disk,
        });
        client
            .post_action(&format!("/servers/{id}/actions/change_type"), &body)
            .await
    }

    pub async fn enable_rescue(
        client: &HetznerClient,
        id: u64,
        rescue_type: Option<String>,
        ssh_keys: Option<Vec<u64>>,
    ) -> HetznerResult<HetznerAction> {
        let mut body = serde_json::json!({});
        if let Some(t) = rescue_type {
            body["type"] = serde_json::Value::String(t);
        }
        if let Some(keys) = ssh_keys {
            body["ssh_keys"] =
                serde_json::to_value(keys).unwrap_or(serde_json::Value::Array(vec![]));
        }
        client
            .post_action(&format!("/servers/{id}/actions/enable_rescue"), &body)
            .await
    }

    pub async fn disable_rescue(client: &HetznerClient, id: u64) -> HetznerResult<HetznerAction> {
        client
            .post_action_empty(&format!("/servers/{id}/actions/disable_rescue"))
            .await
    }

    pub async fn attach_iso(
        client: &HetznerClient,
        id: u64,
        iso: String,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::json!({ "iso": iso });
        client
            .post_action(&format!("/servers/{id}/actions/attach_iso"), &body)
            .await
    }

    pub async fn detach_iso(client: &HetznerClient, id: u64) -> HetznerResult<HetznerAction> {
        client
            .post_action_empty(&format!("/servers/{id}/actions/detach_iso"))
            .await
    }

    pub async fn change_dns_ptr(
        client: &HetznerClient,
        id: u64,
        ip: String,
        dns_ptr: Option<String>,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::json!({ "ip": ip, "dns_ptr": dns_ptr });
        client
            .post_action(&format!("/servers/{id}/actions/change_dns_ptr"), &body)
            .await
    }

    pub async fn create_image(
        client: &HetznerClient,
        id: u64,
        description: Option<String>,
        image_type: Option<String>,
        labels: Option<serde_json::Value>,
    ) -> HetznerResult<HetznerAction> {
        let mut body = serde_json::json!({});
        if let Some(d) = description {
            body["description"] = serde_json::Value::String(d);
        }
        if let Some(t) = image_type {
            body["type"] = serde_json::Value::String(t);
        }
        if let Some(l) = labels {
            body["labels"] = l;
        }
        client
            .post_action(&format!("/servers/{id}/actions/create_image"), &body)
            .await
    }

    pub async fn enable_backup(client: &HetznerClient, id: u64) -> HetznerResult<HetznerAction> {
        client
            .post_action_empty(&format!("/servers/{id}/actions/enable_backup"))
            .await
    }

    pub async fn disable_backup(client: &HetznerClient, id: u64) -> HetznerResult<HetznerAction> {
        client
            .post_action_empty(&format!("/servers/{id}/actions/disable_backup"))
            .await
    }

    pub async fn get_metrics(
        client: &HetznerClient,
        id: u64,
        metric_type: String,
        start: String,
        end: String,
    ) -> HetznerResult<serde_json::Value> {
        let path = format!(
            "/servers/{id}/metrics?type={}&start={}&end={}",
            metric_type, start, end
        );
        client.get(&path).await
    }
}
