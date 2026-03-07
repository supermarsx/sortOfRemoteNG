use crate::client::HetznerClient;
use crate::error::HetznerResult;
use crate::types::*;

pub struct LoadBalancerManager;

impl LoadBalancerManager {
    pub async fn list_load_balancers(
        client: &HetznerClient,
    ) -> HetznerResult<Vec<HetznerLoadBalancer>> {
        let resp: LoadBalancersResponse = client.get("/load_balancers").await?;
        Ok(resp.load_balancers)
    }

    pub async fn get_load_balancer(
        client: &HetznerClient,
        id: u64,
    ) -> HetznerResult<HetznerLoadBalancer> {
        let resp: LoadBalancerResponse = client.get(&format!("/load_balancers/{id}")).await?;
        Ok(resp.load_balancer)
    }

    pub async fn create_load_balancer(
        client: &HetznerClient,
        request: serde_json::Value,
    ) -> HetznerResult<HetznerLoadBalancer> {
        let resp: LoadBalancerResponse = client.post("/load_balancers", &request).await?;
        Ok(resp.load_balancer)
    }

    pub async fn delete_load_balancer(client: &HetznerClient, id: u64) -> HetznerResult<()> {
        client.delete_req(&format!("/load_balancers/{id}")).await
    }

    pub async fn add_service(
        client: &HetznerClient,
        id: u64,
        service: HetznerLbService,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::to_value(&service)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        client
            .post_action(&format!("/load_balancers/{id}/actions/add_service"), &body)
            .await
    }

    pub async fn update_service(
        client: &HetznerClient,
        id: u64,
        service: HetznerLbService,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::to_value(&service)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        client
            .post_action(&format!("/load_balancers/{id}/actions/update_service"), &body)
            .await
    }

    pub async fn delete_service(
        client: &HetznerClient,
        id: u64,
        listen_port: u16,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::json!({ "listen_port": listen_port });
        client
            .post_action(&format!("/load_balancers/{id}/actions/delete_service"), &body)
            .await
    }

    pub async fn add_target(
        client: &HetznerClient,
        id: u64,
        target: HetznerLbTarget,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::to_value(&target)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        client
            .post_action(&format!("/load_balancers/{id}/actions/add_target"), &body)
            .await
    }

    pub async fn remove_target(
        client: &HetznerClient,
        id: u64,
        target: HetznerLbTarget,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::to_value(&target)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        client
            .post_action(&format!("/load_balancers/{id}/actions/remove_target"), &body)
            .await
    }

    pub async fn change_algorithm(
        client: &HetznerClient,
        id: u64,
        algorithm_type: String,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::json!({ "type": algorithm_type });
        client
            .post_action(
                &format!("/load_balancers/{id}/actions/change_algorithm"),
                &body,
            )
            .await
    }

    pub async fn change_type(
        client: &HetznerClient,
        id: u64,
        lb_type: String,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::json!({ "load_balancer_type": lb_type });
        client
            .post_action(&format!("/load_balancers/{id}/actions/change_type"), &body)
            .await
    }
}
