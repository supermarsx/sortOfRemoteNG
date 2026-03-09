use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct DhcpManager;

impl DhcpManager {
    pub async fn get_config(client: &PfsenseClient, interface: &str) -> PfsenseResult<DhcpConfig> {
        let resp: ApiResponse<DhcpConfig> = client
            .api_get(&format!("services/dhcpd/{interface}"))
            .await?;
        Ok(resp.data)
    }

    pub async fn update_config(
        client: &PfsenseClient,
        interface: &str,
        config: &DhcpConfig,
    ) -> PfsenseResult<DhcpConfig> {
        let resp: ApiResponse<DhcpConfig> = client
            .api_put(&format!("services/dhcpd/{interface}"), config)
            .await?;
        Ok(resp.data)
    }

    pub async fn list_leases(client: &PfsenseClient) -> PfsenseResult<Vec<DhcpLease>> {
        let resp: ApiListResponse<DhcpLease> = client.api_get("services/dhcpd/lease").await?;
        Ok(resp.data)
    }

    pub async fn list_leases_by_interface(
        client: &PfsenseClient,
        interface: &str,
    ) -> PfsenseResult<Vec<DhcpLease>> {
        let resp: ApiListResponse<DhcpLease> = client
            .api_get(&format!("services/dhcpd/lease/{interface}"))
            .await?;
        Ok(resp.data)
    }

    pub async fn list_static_mappings(
        client: &PfsenseClient,
        interface: &str,
    ) -> PfsenseResult<Vec<DhcpStaticMapping>> {
        let resp: ApiListResponse<DhcpStaticMapping> = client
            .api_get(&format!("services/dhcpd/static_mapping/{interface}"))
            .await?;
        Ok(resp.data)
    }

    pub async fn get_static_mapping(
        client: &PfsenseClient,
        interface: &str,
        id: &str,
    ) -> PfsenseResult<DhcpStaticMapping> {
        let resp: ApiResponse<DhcpStaticMapping> = client
            .api_get(&format!("services/dhcpd/static_mapping/{interface}/{id}"))
            .await?;
        Ok(resp.data)
    }

    pub async fn create_static_mapping(
        client: &PfsenseClient,
        interface: &str,
        mapping: &DhcpStaticMapping,
    ) -> PfsenseResult<DhcpStaticMapping> {
        let resp: ApiResponse<DhcpStaticMapping> = client
            .api_post(
                &format!("services/dhcpd/static_mapping/{interface}"),
                mapping,
            )
            .await?;
        Ok(resp.data)
    }

    pub async fn update_static_mapping(
        client: &PfsenseClient,
        interface: &str,
        id: &str,
        mapping: &DhcpStaticMapping,
    ) -> PfsenseResult<DhcpStaticMapping> {
        let resp: ApiResponse<DhcpStaticMapping> = client
            .api_put(
                &format!("services/dhcpd/static_mapping/{interface}/{id}"),
                mapping,
            )
            .await?;
        Ok(resp.data)
    }

    pub async fn delete_static_mapping(
        client: &PfsenseClient,
        interface: &str,
        id: &str,
    ) -> PfsenseResult<()> {
        client
            .api_delete_void(&format!("services/dhcpd/static_mapping/{interface}/{id}"))
            .await
    }

    pub async fn get_relay(client: &PfsenseClient) -> PfsenseResult<DhcpRelay> {
        let resp: ApiResponse<DhcpRelay> = client.api_get("services/dhcrelay").await?;
        Ok(resp.data)
    }

    pub async fn update_relay(
        client: &PfsenseClient,
        relay: &DhcpRelay,
    ) -> PfsenseResult<DhcpRelay> {
        let resp: ApiResponse<DhcpRelay> = client.api_put("services/dhcrelay", relay).await?;
        Ok(resp.data)
    }

    pub async fn apply(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client
            .api_post("services/dhcpd/apply", &serde_json::json!({}))
            .await
    }
}
