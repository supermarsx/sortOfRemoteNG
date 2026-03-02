// ── sorng-k8s/src/pods.rs ───────────────────────────────────────────────────
//! Pod lifecycle, logs, exec, port-forward, and ephemeral containers.

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::{debug, info};
use std::collections::HashMap;

/// Pod management operations.
pub struct PodManager;

impl PodManager {
    /// List pods in a namespace.
    pub async fn list(client: &K8sClient, namespace: &str, opts: &ListOptions) -> K8sResult<Vec<PodInfo>> {
        let url = format!("{}{}",
            client.namespaced_url(namespace, "pods"),
            K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        Self::parse_pod_list(&resp)
    }

    /// Get a single pod by name.
    pub async fn get(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<PodInfo> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "pods"), name);
        client.get(&url).await
    }

    /// Create a pod from a spec.
    pub async fn create(client: &K8sClient, namespace: &str, manifest: &serde_json::Value) -> K8sResult<PodInfo> {
        let url = client.namespaced_url(namespace, "pods");
        info!("Creating pod in namespace '{}'", namespace);
        client.post(&url, manifest).await
    }

    /// Delete a pod.
    pub async fn delete(client: &K8sClient, namespace: &str, name: &str, opts: Option<&DeleteOptions>) -> K8sResult<serde_json::Value> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "pods"), name);
        info!("Deleting pod '{}/{}' ", namespace, name);
        if let Some(delete_opts) = opts {
            let body = serde_json::to_value(delete_opts).unwrap_or_default();
            client.delete_with_body(&url, &body).await
        } else {
            client.delete(&url).await
        }
    }

    /// Get pod logs.
    pub async fn logs(client: &K8sClient, namespace: &str, name: &str, opts: &PodLogOptions) -> K8sResult<String> {
        let mut params = Vec::new();
        if let Some(ref container) = opts.container {
            params.push(format!("container={}", container));
        }
        if opts.follow {
            params.push("follow=true".to_string());
        }
        if let Some(lines) = opts.tail_lines {
            params.push(format!("tailLines={}", lines));
        }
        if let Some(since) = opts.since_seconds {
            params.push(format!("sinceSeconds={}", since));
        }
        if opts.timestamps {
            params.push("timestamps=true".to_string());
        }
        if opts.previous {
            params.push("previous=true".to_string());
        }
        if let Some(limit) = opts.limit_bytes {
            params.push(format!("limitBytes={}", limit));
        }

        let query = if params.is_empty() { String::new() } else { format!("?{}", params.join("&")) };
        let url = format!("{}/{}/log{}", client.namespaced_url(namespace, "pods"), name, query);
        debug!("Fetching logs for pod '{}/{}'", namespace, name);
        client.get_text(&url).await
    }

    /// Evict a pod (for drain operations).
    pub async fn evict(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<serde_json::Value> {
        let url = format!("{}/{}/eviction", client.namespaced_url(namespace, "pods"), name);
        let body = serde_json::json!({
            "apiVersion": "policy/v1",
            "kind": "Eviction",
            "metadata": {
                "name": name,
                "namespace": namespace
            }
        });
        info!("Evicting pod '{}/{}'", namespace, name);
        client.post(&url, &body).await
    }

    /// Update pod labels.
    pub async fn update_labels(
        client: &K8sClient,
        namespace: &str,
        name: &str,
        labels: &HashMap<String, String>,
    ) -> K8sResult<PodInfo> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "pods"), name);
        let body = serde_json::json!({
            "metadata": {
                "labels": labels
            }
        });
        client.patch(&url, &body).await
    }

    /// Update pod annotations.
    pub async fn update_annotations(
        client: &K8sClient,
        namespace: &str,
        name: &str,
        annotations: &HashMap<String, String>,
    ) -> K8sResult<PodInfo> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "pods"), name);
        let body = serde_json::json!({
            "metadata": {
                "annotations": annotations
            }
        });
        client.patch(&url, &body).await
    }

    /// Add an ephemeral debug container to a running pod.
    pub async fn add_ephemeral_container(
        client: &K8sClient,
        namespace: &str,
        name: &str,
        container: &EphemeralContainerSpec,
    ) -> K8sResult<PodInfo> {
        let url = format!("{}/{}/ephemeralcontainers", client.namespaced_url(namespace, "pods"), name);
        let body = serde_json::to_value(container)
            .map_err(|e| K8sError::validation(format!("Invalid ephemeral container spec: {}", e)))?;

        let patch = serde_json::json!({
            "spec": {
                "ephemeralContainers": [body]
            }
        });
        info!("Adding ephemeral container to pod '{}/{}'", namespace, name);
        client.patch(&url, &patch).await
    }

    /// List pods across all namespaces.
    pub async fn list_all_namespaces(client: &K8sClient, opts: &ListOptions) -> K8sResult<Vec<PodInfo>> {
        let url = format!("{}/api/v1/pods{}", client.base_url, K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        Self::parse_pod_list(&resp)
    }

    fn parse_pod_list(resp: &serde_json::Value) -> K8sResult<Vec<PodInfo>> {
        let items = resp.get("items")
            .and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in pod list response"))?;
        let pods: Vec<PodInfo> = items.iter()
            .filter_map(|item| serde_json::from_value(item.clone()).ok())
            .collect();
        Ok(pods)
    }
}
