use crate::client::HetznerClient;
use crate::error::HetznerResult;
use crate::types::*;

pub struct FloatingIpManager;

impl FloatingIpManager {
    pub async fn list_floating_ips(
        client: &HetznerClient,
    ) -> HetznerResult<Vec<HetznerFloatingIp>> {
        let resp: FloatingIpsResponse = client.get("/floating_ips").await?;
        Ok(resp.floating_ips)
    }

    pub async fn get_floating_ip(
        client: &HetznerClient,
        id: u64,
    ) -> HetznerResult<HetznerFloatingIp> {
        let resp: FloatingIpResponse = client.get(&format!("/floating_ips/{id}")).await?;
        Ok(resp.floating_ip)
    }

    pub async fn create_floating_ip(
        client: &HetznerClient,
        request: CreateFloatingIpRequest,
    ) -> HetznerResult<HetznerFloatingIp> {
        let body = serde_json::to_value(&request)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        let resp: FloatingIpResponse = client.post("/floating_ips", &body).await?;
        Ok(resp.floating_ip)
    }

    pub async fn delete_floating_ip(client: &HetznerClient, id: u64) -> HetznerResult<()> {
        client.delete_req(&format!("/floating_ips/{id}")).await
    }

    pub async fn assign(
        client: &HetznerClient,
        id: u64,
        server: u64,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::json!({ "server": server });
        client
            .post_action(&format!("/floating_ips/{id}/actions/assign"), &body)
            .await
    }

    pub async fn unassign(client: &HetznerClient, id: u64) -> HetznerResult<HetznerAction> {
        client
            .post_action_empty(&format!("/floating_ips/{id}/actions/unassign"))
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
            .post_action(&format!("/floating_ips/{id}/actions/change_dns_ptr"), &body)
            .await
    }
}
