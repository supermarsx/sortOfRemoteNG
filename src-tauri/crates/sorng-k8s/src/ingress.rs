// ── sorng-k8s/src/ingress.rs ────────────────────────────────────────────────
//! Ingress and IngressClass CRUD, TLS termination, path rules.

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::info;

/// Ingress management operations.
pub struct IngressManager;

impl IngressManager {
    /// List Ingresses in a namespace.
    pub async fn list(client: &K8sClient, namespace: &str, opts: &ListOptions) -> K8sResult<Vec<IngressInfo>> {
        let url = format!("{}{}", client.networking_v1_url(namespace, "ingresses"), K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp.get("items").and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in ingress list"))?;
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// Get a single Ingress.
    pub async fn get(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<IngressInfo> {
        let url = format!("{}/{}", client.networking_v1_url(namespace, "ingresses"), name);
        client.get(&url).await
    }

    /// Create an Ingress.
    pub async fn create(client: &K8sClient, namespace: &str, config: &CreateIngressConfig) -> K8sResult<IngressInfo> {
        let url = client.networking_v1_url(namespace, "ingresses");
        let body = serde_json::json!({
            "apiVersion": "networking.k8s.io/v1",
            "kind": "Ingress",
            "metadata": {
                "name": config.name,
                "namespace": namespace,
                "labels": config.labels,
                "annotations": config.annotations,
            },
            "spec": {
                "ingressClassName": config.ingress_class_name,
                "defaultBackend": config.default_backend,
                "tls": config.tls,
                "rules": config.rules,
            }
        });
        info!("Creating Ingress '{}/{}'", namespace, config.name);
        client.post(&url, &body).await
    }

    /// Update an Ingress.
    pub async fn update(client: &K8sClient, namespace: &str, name: &str, manifest: &serde_json::Value) -> K8sResult<IngressInfo> {
        let url = format!("{}/{}", client.networking_v1_url(namespace, "ingresses"), name);
        client.put(&url, manifest).await
    }

    /// Delete an Ingress.
    pub async fn delete(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<serde_json::Value> {
        let url = format!("{}/{}", client.networking_v1_url(namespace, "ingresses"), name);
        info!("Deleting Ingress '{}/{}'", namespace, name);
        client.delete(&url).await
    }

    /// List IngressClasses (cluster-scoped).
    pub async fn list_ingress_classes(client: &K8sClient) -> K8sResult<Vec<IngressClassInfo>> {
        let url = format!("{}/apis/networking.k8s.io/v1/ingressclasses", client.base_url);
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp.get("items").and_then(|v| v.as_array()).unwrap_or(&vec![]);
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// List NetworkPolicies in a namespace.
    pub async fn list_network_policies(client: &K8sClient, namespace: &str, opts: &ListOptions) -> K8sResult<Vec<NetworkPolicyInfo>> {
        let url = format!("{}{}", client.networking_v1_url(namespace, "networkpolicies"), K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp.get("items").and_then(|v| v.as_array()).unwrap_or(&vec![]);
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// Get a NetworkPolicy.
    pub async fn get_network_policy(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<NetworkPolicyInfo> {
        let url = format!("{}/{}", client.networking_v1_url(namespace, "networkpolicies"), name);
        client.get(&url).await
    }

    /// Create a NetworkPolicy.
    pub async fn create_network_policy(client: &K8sClient, namespace: &str, manifest: &serde_json::Value) -> K8sResult<NetworkPolicyInfo> {
        let url = client.networking_v1_url(namespace, "networkpolicies");
        client.post(&url, manifest).await
    }

    /// Delete a NetworkPolicy.
    pub async fn delete_network_policy(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<serde_json::Value> {
        let url = format!("{}/{}", client.networking_v1_url(namespace, "networkpolicies"), name);
        client.delete(&url).await
    }
}
