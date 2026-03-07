use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct RoutingManager;

impl RoutingManager {
    pub async fn list_routes(client: &PfsenseClient) -> PfsenseResult<Vec<StaticRoute>> {
        let resp: ApiListResponse<StaticRoute> = client.api_get("routing/static_route").await?;
        Ok(resp.data)
    }

    pub async fn get_route(client: &PfsenseClient, id: &str) -> PfsenseResult<StaticRoute> {
        let resp: ApiResponse<StaticRoute> = client.api_get(&format!("routing/static_route/{id}")).await?;
        Ok(resp.data)
    }

    pub async fn create_route(client: &PfsenseClient, route: &StaticRoute) -> PfsenseResult<StaticRoute> {
        let resp: ApiResponse<StaticRoute> = client.api_post("routing/static_route", route).await?;
        Ok(resp.data)
    }

    pub async fn update_route(client: &PfsenseClient, id: &str, route: &StaticRoute) -> PfsenseResult<StaticRoute> {
        let resp: ApiResponse<StaticRoute> = client.api_put(&format!("routing/static_route/{id}"), route).await?;
        Ok(resp.data)
    }

    pub async fn delete_route(client: &PfsenseClient, id: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("routing/static_route/{id}")).await
    }

    pub async fn apply_routes(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client.api_post("routing/apply", &serde_json::json!({})).await
    }

    pub async fn list_gateways(client: &PfsenseClient) -> PfsenseResult<Vec<Gateway>> {
        let resp: ApiListResponse<Gateway> = client.api_get("routing/gateway").await?;
        Ok(resp.data)
    }

    pub async fn get_gateway(client: &PfsenseClient, name: &str) -> PfsenseResult<Gateway> {
        let resp: ApiResponse<Gateway> = client.api_get(&format!("routing/gateway/{name}")).await?;
        Ok(resp.data)
    }

    pub async fn create_gateway(client: &PfsenseClient, gw: &Gateway) -> PfsenseResult<Gateway> {
        let resp: ApiResponse<Gateway> = client.api_post("routing/gateway", gw).await?;
        Ok(resp.data)
    }

    pub async fn update_gateway(client: &PfsenseClient, name: &str, gw: &Gateway) -> PfsenseResult<Gateway> {
        let resp: ApiResponse<Gateway> = client.api_put(&format!("routing/gateway/{name}"), gw).await?;
        Ok(resp.data)
    }

    pub async fn delete_gateway(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("routing/gateway/{name}")).await
    }

    pub async fn list_gateway_groups(client: &PfsenseClient) -> PfsenseResult<Vec<GatewayGroup>> {
        let resp: ApiListResponse<GatewayGroup> = client.api_get("routing/gateway/group").await?;
        Ok(resp.data)
    }

    pub async fn get_gateway_group(client: &PfsenseClient, name: &str) -> PfsenseResult<GatewayGroup> {
        let resp: ApiResponse<GatewayGroup> = client.api_get(&format!("routing/gateway/group/{name}")).await?;
        Ok(resp.data)
    }

    pub async fn create_gateway_group(client: &PfsenseClient, group: &GatewayGroup) -> PfsenseResult<GatewayGroup> {
        let resp: ApiResponse<GatewayGroup> = client.api_post("routing/gateway/group", group).await?;
        Ok(resp.data)
    }

    pub async fn update_gateway_group(client: &PfsenseClient, name: &str, group: &GatewayGroup) -> PfsenseResult<GatewayGroup> {
        let resp: ApiResponse<GatewayGroup> = client.api_put(&format!("routing/gateway/group/{name}"), group).await?;
        Ok(resp.data)
    }

    pub async fn delete_gateway_group(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("routing/gateway/group/{name}")).await
    }

    pub async fn get_gateway_status(client: &PfsenseClient) -> PfsenseResult<Vec<GatewayStatus>> {
        let resp: ApiListResponse<GatewayStatus> = client.api_get("status/gateway").await?;
        Ok(resp.data)
    }

    pub async fn get_routing_table(client: &PfsenseClient) -> PfsenseResult<Vec<RoutingTableEntry>> {
        let resp: ApiListResponse<RoutingTableEntry> = client.api_get("diagnostics/routing_table").await?;
        Ok(resp.data)
    }
}
