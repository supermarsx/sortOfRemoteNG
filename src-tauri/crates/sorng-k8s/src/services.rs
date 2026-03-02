// ── sorng-k8s/src/services.rs ───────────────────────────────────────────────
//! Kubernetes Service CRUD, endpoint resolution, type management.

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::info;

/// Service management operations.
pub struct ServiceManager;

impl ServiceManager {
    /// List services in a namespace.
    pub async fn list(client: &K8sClient, namespace: &str, opts: &ListOptions) -> K8sResult<Vec<ServiceInfo>> {
        let url = format!("{}{}", client.namespaced_url(namespace, "services"), K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        Self::parse_list(&resp)
    }

    /// Get a single service.
    pub async fn get(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<ServiceInfo> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "services"), name);
        client.get(&url).await
    }

    /// Create a service.
    pub async fn create(client: &K8sClient, namespace: &str, config: &CreateServiceConfig) -> K8sResult<ServiceInfo> {
        let url = client.namespaced_url(namespace, "services");

        let service_type = match config.service_type {
            ServiceType::ClusterIP => "ClusterIP",
            ServiceType::NodePort => "NodePort",
            ServiceType::LoadBalancer => "LoadBalancer",
            ServiceType::ExternalName => "ExternalName",
        };

        let body = serde_json::json!({
            "apiVersion": "v1",
            "kind": "Service",
            "metadata": {
                "name": config.name,
                "namespace": namespace,
                "labels": config.labels,
                "annotations": config.annotations,
            },
            "spec": {
                "type": service_type,
                "ports": config.ports,
                "selector": config.selector,
                "externalIPs": config.external_ips,
                "loadBalancerIP": config.load_balancer_ip,
                "sessionAffinity": config.session_affinity,
            }
        });

        info!("Creating service '{}/{}' (type: {})", namespace, config.name, service_type);
        client.post(&url, &body).await
    }

    /// Update a service.
    pub async fn update(client: &K8sClient, namespace: &str, name: &str, manifest: &serde_json::Value) -> K8sResult<ServiceInfo> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "services"), name);
        client.put(&url, manifest).await
    }

    /// Patch a service.
    pub async fn patch(client: &K8sClient, namespace: &str, name: &str, patch: &serde_json::Value) -> K8sResult<ServiceInfo> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "services"), name);
        client.patch(&url, patch).await
    }

    /// Delete a service.
    pub async fn delete(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<serde_json::Value> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "services"), name);
        info!("Deleting service '{}/{}'", namespace, name);
        client.delete(&url).await
    }

    /// Get endpoints for a service.
    pub async fn get_endpoints(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<EndpointInfo> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "endpoints"), name);
        client.get(&url).await
    }

    /// List all services across all namespaces.
    pub async fn list_all_namespaces(client: &K8sClient, opts: &ListOptions) -> K8sResult<Vec<ServiceInfo>> {
        let url = format!("{}/api/v1/services{}", client.base_url, K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        Self::parse_list(&resp)
    }

    fn parse_list(resp: &serde_json::Value) -> K8sResult<Vec<ServiceInfo>> {
        let items = resp.get("items")
            .and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in service list response"))?;
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }
}
