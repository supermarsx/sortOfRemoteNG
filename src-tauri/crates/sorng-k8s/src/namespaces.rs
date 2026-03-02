// ── sorng-k8s/src/namespaces.rs ─────────────────────────────────────────────
//! Namespace lifecycle, resource quotas, and limit ranges.

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::info;

/// Namespace management operations.
pub struct NamespaceManager;

impl NamespaceManager {
    /// List all namespaces.
    pub async fn list(client: &K8sClient, opts: &ListOptions) -> K8sResult<Vec<NamespaceInfo>> {
        let url = format!("{}/api/v1/namespaces{}", client.base_url, K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp.get("items").and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in namespace list"))?;
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// Get a single namespace.
    pub async fn get(client: &K8sClient, name: &str) -> K8sResult<NamespaceInfo> {
        let url = format!("{}/api/v1/namespaces/{}", client.base_url, name);
        client.get(&url).await
    }

    /// Create a namespace.
    pub async fn create(client: &K8sClient, config: &CreateNamespaceConfig) -> K8sResult<NamespaceInfo> {
        let url = format!("{}/api/v1/namespaces", client.base_url);
        let body = serde_json::json!({
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {
                "name": config.name,
                "labels": config.labels,
                "annotations": config.annotations,
            }
        });
        info!("Creating namespace '{}'", config.name);
        client.post(&url, &body).await
    }

    /// Delete a namespace.
    pub async fn delete(client: &K8sClient, name: &str) -> K8sResult<serde_json::Value> {
        let url = format!("{}/api/v1/namespaces/{}", client.base_url, name);
        info!("Deleting namespace '{}'", name);
        client.delete(&url).await
    }

    /// Update namespace labels.
    pub async fn update_labels(
        client: &K8sClient,
        name: &str,
        labels: &std::collections::HashMap<String, String>,
    ) -> K8sResult<NamespaceInfo> {
        let url = format!("{}/api/v1/namespaces/{}", client.base_url, name);
        let patch = serde_json::json!({ "metadata": { "labels": labels } });
        client.patch(&url, &patch).await
    }

    /// List resource quotas in a namespace.
    pub async fn list_resource_quotas(client: &K8sClient, namespace: &str) -> K8sResult<Vec<ResourceQuotaInfo>> {
        let url = client.namespaced_url(namespace, "resourcequotas");
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp.get("items").and_then(|v| v.as_array()).unwrap_or(&vec![]);
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// Get a resource quota.
    pub async fn get_resource_quota(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<ResourceQuotaInfo> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "resourcequotas"), name);
        client.get(&url).await
    }

    /// Create a resource quota.
    pub async fn create_resource_quota(
        client: &K8sClient,
        namespace: &str,
        name: &str,
        hard: &std::collections::HashMap<String, String>,
    ) -> K8sResult<ResourceQuotaInfo> {
        let url = client.namespaced_url(namespace, "resourcequotas");
        let body = serde_json::json!({
            "apiVersion": "v1",
            "kind": "ResourceQuota",
            "metadata": { "name": name, "namespace": namespace },
            "spec": { "hard": hard }
        });
        info!("Creating ResourceQuota '{}/{}' ", namespace, name);
        client.post(&url, &body).await
    }

    /// Delete a resource quota.
    pub async fn delete_resource_quota(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<serde_json::Value> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "resourcequotas"), name);
        client.delete(&url).await
    }

    /// List limit ranges in a namespace.
    pub async fn list_limit_ranges(client: &K8sClient, namespace: &str) -> K8sResult<Vec<LimitRangeInfo>> {
        let url = client.namespaced_url(namespace, "limitranges");
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp.get("items").and_then(|v| v.as_array()).unwrap_or(&vec![]);
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }
}
