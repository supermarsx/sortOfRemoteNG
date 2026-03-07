use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct NatManager;

impl NatManager {
    pub async fn list_port_forwards(client: &PfsenseClient) -> PfsenseResult<Vec<NatPortForward>> {
        let resp: ApiListResponse<NatPortForward> = client.api_get("firewall/nat/port_forward").await?;
        Ok(resp.data)
    }

    pub async fn get_port_forward(client: &PfsenseClient, id: &str) -> PfsenseResult<NatPortForward> {
        let resp: ApiResponse<NatPortForward> = client.api_get(&format!("firewall/nat/port_forward/{id}")).await?;
        Ok(resp.data)
    }

    pub async fn create_port_forward(client: &PfsenseClient, rule: &NatPortForward) -> PfsenseResult<NatPortForward> {
        let resp: ApiResponse<NatPortForward> = client.api_post("firewall/nat/port_forward", rule).await?;
        Ok(resp.data)
    }

    pub async fn update_port_forward(client: &PfsenseClient, id: &str, rule: &NatPortForward) -> PfsenseResult<NatPortForward> {
        let resp: ApiResponse<NatPortForward> = client.api_put(&format!("firewall/nat/port_forward/{id}"), rule).await?;
        Ok(resp.data)
    }

    pub async fn delete_port_forward(client: &PfsenseClient, id: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("firewall/nat/port_forward/{id}")).await
    }

    pub async fn list_outbound(client: &PfsenseClient) -> PfsenseResult<Vec<NatOutbound>> {
        let resp: ApiListResponse<NatOutbound> = client.api_get("firewall/nat/outbound").await?;
        Ok(resp.data)
    }

    pub async fn get_outbound(client: &PfsenseClient, id: &str) -> PfsenseResult<NatOutbound> {
        let resp: ApiResponse<NatOutbound> = client.api_get(&format!("firewall/nat/outbound/{id}")).await?;
        Ok(resp.data)
    }

    pub async fn create_outbound(client: &PfsenseClient, rule: &NatOutbound) -> PfsenseResult<NatOutbound> {
        let resp: ApiResponse<NatOutbound> = client.api_post("firewall/nat/outbound", rule).await?;
        Ok(resp.data)
    }

    pub async fn update_outbound(client: &PfsenseClient, id: &str, rule: &NatOutbound) -> PfsenseResult<NatOutbound> {
        let resp: ApiResponse<NatOutbound> = client.api_put(&format!("firewall/nat/outbound/{id}"), rule).await?;
        Ok(resp.data)
    }

    pub async fn delete_outbound(client: &PfsenseClient, id: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("firewall/nat/outbound/{id}")).await
    }

    pub async fn list_1to1(client: &PfsenseClient) -> PfsenseResult<Vec<Nat1to1>> {
        let resp: ApiListResponse<Nat1to1> = client.api_get("firewall/nat/one_to_one").await?;
        Ok(resp.data)
    }

    pub async fn get_1to1(client: &PfsenseClient, id: &str) -> PfsenseResult<Nat1to1> {
        let resp: ApiResponse<Nat1to1> = client.api_get(&format!("firewall/nat/one_to_one/{id}")).await?;
        Ok(resp.data)
    }

    pub async fn create_1to1(client: &PfsenseClient, rule: &Nat1to1) -> PfsenseResult<Nat1to1> {
        let resp: ApiResponse<Nat1to1> = client.api_post("firewall/nat/one_to_one", rule).await?;
        Ok(resp.data)
    }

    pub async fn update_1to1(client: &PfsenseClient, id: &str, rule: &Nat1to1) -> PfsenseResult<Nat1to1> {
        let resp: ApiResponse<Nat1to1> = client.api_put(&format!("firewall/nat/one_to_one/{id}"), rule).await?;
        Ok(resp.data)
    }

    pub async fn delete_1to1(client: &PfsenseClient, id: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("firewall/nat/one_to_one/{id}")).await
    }

    pub async fn apply(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client.api_post("firewall/nat/apply", &serde_json::json!({})).await
    }
}
