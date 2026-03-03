// ── sorng-k8s/src/nodes.rs ──────────────────────────────────────────────────
//! Node info, taints, labels, cordon/uncordon, drain.

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::info;
use std::collections::HashMap;

/// Node management operations.
pub struct NodeManager;

impl NodeManager {
    /// List all nodes.
    pub async fn list(client: &K8sClient, opts: &ListOptions) -> K8sResult<Vec<NodeInfo>> {
        let url = format!("{}/api/v1/nodes{}", client.base_url, K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp.get("items").and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in node list"))?;
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// Get a single node.
    pub async fn get(client: &K8sClient, name: &str) -> K8sResult<NodeInfo> {
        let url = format!("{}/api/v1/nodes/{}", client.base_url, name);
        client.get(&url).await
    }

    /// Cordon a node (mark as unschedulable).
    pub async fn cordon(client: &K8sClient, name: &str) -> K8sResult<NodeInfo> {
        let url = format!("{}/api/v1/nodes/{}", client.base_url, name);
        let patch = serde_json::json!({ "spec": { "unschedulable": true } });
        info!("Cordoning node '{}'", name);
        client.patch(&url, &patch).await
    }

    /// Uncordon a node (mark as schedulable).
    pub async fn uncordon(client: &K8sClient, name: &str) -> K8sResult<NodeInfo> {
        let url = format!("{}/api/v1/nodes/{}", client.base_url, name);
        let patch = serde_json::json!({ "spec": { "unschedulable": false } });
        info!("Uncordoning node '{}'", name);
        client.patch(&url, &patch).await
    }

    /// Add a taint to a node.
    pub async fn add_taint(client: &K8sClient, name: &str, taint: &Taint) -> K8sResult<NodeInfo> {
        let node = Self::get(client, name).await?;
        let mut taints = node.spec.taints.clone();
        taints.retain(|t| t.key != taint.key || t.effect != taint.effect);
        taints.push(taint.clone());

        let url = format!("{}/api/v1/nodes/{}", client.base_url, name);
        let patch = serde_json::json!({ "spec": { "taints": taints } });
        info!("Adding taint '{}:{}={}' to node '{}'", taint.key, taint.effect, taint.value.as_deref().unwrap_or(""), name);
        client.patch(&url, &patch).await
    }

    /// Remove a taint from a node.
    pub async fn remove_taint(client: &K8sClient, name: &str, key: &str, effect: Option<&str>) -> K8sResult<NodeInfo> {
        let node = Self::get(client, name).await?;
        let taints: Vec<Taint> = node.spec.taints.into_iter()
            .filter(|t| {
                if let Some(eff) = effect {
                    !(t.key == key && t.effect == eff)
                } else {
                    t.key != key
                }
            })
            .collect();

        let url = format!("{}/api/v1/nodes/{}", client.base_url, name);
        let patch = serde_json::json!({ "spec": { "taints": taints } });
        info!("Removing taint '{}' from node '{}'", key, name);
        client.patch(&url, &patch).await
    }

    /// Update node labels.
    pub async fn update_labels(client: &K8sClient, name: &str, labels: &HashMap<String, String>) -> K8sResult<NodeInfo> {
        let url = format!("{}/api/v1/nodes/{}", client.base_url, name);
        let patch = serde_json::json!({ "metadata": { "labels": labels } });
        client.patch(&url, &patch).await
    }

    /// Remove a node label.
    pub async fn remove_label(client: &K8sClient, name: &str, label_key: &str) -> K8sResult<NodeInfo> {
        let url = format!("{}/api/v1/nodes/{}", client.base_url, name);
        // JSON merge patch: set to null to remove
        let patch = serde_json::json!({
            "metadata": {
                "labels": {
                    label_key: serde_json::Value::Null
                }
            }
        });
        client.patch(&url, &patch).await
    }

    /// Update node annotations.
    pub async fn update_annotations(client: &K8sClient, name: &str, annotations: &HashMap<String, String>) -> K8sResult<NodeInfo> {
        let url = format!("{}/api/v1/nodes/{}", client.base_url, name);
        let patch = serde_json::json!({ "metadata": { "annotations": annotations } });
        client.patch(&url, &patch).await
    }

    /// Drain a node (cordon + evict all pods).
    pub async fn drain(
        client: &K8sClient,
        name: &str,
        ignore_daemonsets: bool,
        _delete_emptydir_data: bool,
        _grace_period_seconds: Option<i64>,
    ) -> K8sResult<Vec<String>> {
        use crate::pods::PodManager;

        // 1. Cordon the node
        Self::cordon(client, name).await?;
        info!("Node '{}' cordoned, beginning drain", name);

        // 2. List all pods on the node
        let opts = ListOptions {
            field_selector: Some(format!("spec.nodeName={}", name)),
            ..Default::default()
        };
        let pods = PodManager::list_all_namespaces(client, &opts).await?;

        let mut evicted = Vec::new();
        for pod in &pods {
            let pod_name = &pod.metadata.name;
            let namespace = pod.metadata.namespace.as_deref().unwrap_or("default");

            // Skip DaemonSet pods if requested
            if ignore_daemonsets {
                let is_daemonset = pod.metadata.owner_references.iter()
                    .any(|or| or.kind == "DaemonSet");
                if is_daemonset {
                    continue;
                }
            }

            // Skip mirror pods (static pods)
            if pod.metadata.annotations.contains_key("kubernetes.io/config.mirror") {
                continue;
            }

            // Evict the pod
            match PodManager::evict(client, namespace, pod_name).await {
                Ok(_) => {
                    evicted.push(format!("{}/{}", namespace, pod_name));
                }
                Err(e) => {
                    log::warn!("Failed to evict pod '{}/{}': {}", namespace, pod_name, e);
                }
            }
        }

        info!("Drain completed for node '{}': {} pods evicted", name, evicted.len());
        Ok(evicted)
    }

    /// Get PersistentVolumes (cluster-scoped).
    pub async fn list_persistent_volumes(client: &K8sClient, opts: &ListOptions) -> K8sResult<Vec<PersistentVolumeInfo>> {
        let url = format!("{}/api/v1/persistentvolumes{}", client.base_url, K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// List PersistentVolumeClaims in a namespace.
    pub async fn list_pvcs(client: &K8sClient, namespace: &str, opts: &ListOptions) -> K8sResult<Vec<PersistentVolumeClaimInfo>> {
        let url = format!("{}{}", client.namespaced_url(namespace, "persistentvolumeclaims"), K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// List StorageClasses (cluster-scoped).
    pub async fn list_storage_classes(client: &K8sClient) -> K8sResult<Vec<StorageClassInfo>> {
        let url = client.storage_v1_url("storageclasses");
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }
}
