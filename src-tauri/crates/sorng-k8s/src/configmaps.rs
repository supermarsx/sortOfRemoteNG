// ── sorng-k8s/src/configmaps.rs ─────────────────────────────────────────────
//! ConfigMap CRUD with data and binaryData support.

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::info;

/// ConfigMap management operations.
pub struct ConfigMapManager;

impl ConfigMapManager {
    /// List ConfigMaps in a namespace.
    pub async fn list(
        client: &K8sClient,
        namespace: &str,
        opts: &ListOptions,
    ) -> K8sResult<Vec<ConfigMapInfo>> {
        let url = format!(
            "{}{}",
            client.namespaced_url(namespace, "configmaps"),
            K8sClient::list_query(opts)
        );
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp
            .get("items")
            .and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in configmap list response"))?;
        Ok(items
            .iter()
            .filter_map(|i| serde_json::from_value(i.clone()).ok())
            .collect())
    }

    /// Get a single ConfigMap.
    pub async fn get(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<ConfigMapInfo> {
        let url = format!(
            "{}/{}",
            client.namespaced_url(namespace, "configmaps"),
            name
        );
        client.get(&url).await
    }

    /// Create a ConfigMap.
    pub async fn create(
        client: &K8sClient,
        namespace: &str,
        config: &CreateConfigMapConfig,
    ) -> K8sResult<ConfigMapInfo> {
        let url = client.namespaced_url(namespace, "configmaps");
        let body = serde_json::json!({
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {
                "name": config.name,
                "namespace": namespace,
                "labels": config.labels,
                "annotations": config.annotations,
            },
            "data": config.data,
            "binaryData": config.binary_data,
            "immutable": config.immutable,
        });
        info!("Creating ConfigMap '{}/{}'", namespace, config.name);
        client.post(&url, &body).await
    }

    /// Update (replace) a ConfigMap.
    pub async fn update(
        client: &K8sClient,
        namespace: &str,
        name: &str,
        manifest: &serde_json::Value,
    ) -> K8sResult<ConfigMapInfo> {
        let url = format!(
            "{}/{}",
            client.namespaced_url(namespace, "configmaps"),
            name
        );
        client.put(&url, manifest).await
    }

    /// Patch a ConfigMap (merge new data keys).
    pub async fn patch(
        client: &K8sClient,
        namespace: &str,
        name: &str,
        patch: &serde_json::Value,
    ) -> K8sResult<ConfigMapInfo> {
        let url = format!(
            "{}/{}",
            client.namespaced_url(namespace, "configmaps"),
            name
        );
        client.patch(&url, patch).await
    }

    /// Delete a ConfigMap.
    pub async fn delete(
        client: &K8sClient,
        namespace: &str,
        name: &str,
    ) -> K8sResult<serde_json::Value> {
        let url = format!(
            "{}/{}",
            client.namespaced_url(namespace, "configmaps"),
            name
        );
        info!("Deleting ConfigMap '{}/{}'", namespace, name);
        client.delete(&url).await
    }
}
