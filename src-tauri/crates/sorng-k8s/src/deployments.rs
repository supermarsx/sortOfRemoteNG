// ── sorng-k8s/src/deployments.rs ────────────────────────────────────────────
//! Deployment CRUD, scaling, rollouts, and rollback.

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::info;
use std::collections::HashMap;

/// Deployment management operations.
pub struct DeploymentManager;

impl DeploymentManager {
    /// List deployments in a namespace.
    pub async fn list(client: &K8sClient, namespace: &str, opts: &ListOptions) -> K8sResult<Vec<DeploymentInfo>> {
        let url = format!("{}{}",
            client.apps_v1_url(namespace, "deployments"),
            K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        Self::parse_list(&resp)
    }

    /// Get a single deployment.
    pub async fn get(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<DeploymentInfo> {
        let url = format!("{}/{}", client.apps_v1_url(namespace, "deployments"), name);
        client.get(&url).await
    }

    /// Create a deployment.
    pub async fn create(client: &K8sClient, namespace: &str, config: &CreateDeploymentConfig) -> K8sResult<DeploymentInfo> {
        let url = client.apps_v1_url(namespace, "deployments");
        let container_name = config.container_name.clone().unwrap_or_else(|| config.name.clone());
        let mut container = serde_json::json!({
            "name": container_name,
            "image": config.image,
        });
        if let Some(port) = config.container_port {
            container["ports"] = serde_json::json!([{"containerPort": port}]);
        }
        if !config.command.is_empty() {
            container["command"] = serde_json::json!(config.command);
        }
        if !config.args.is_empty() {
            container["args"] = serde_json::json!(config.args);
        }
        if !config.env.is_empty() {
            container["env"] = serde_json::to_value(&config.env).unwrap_or_default();
        }
        if let Some(ref resources) = config.resources {
            container["resources"] = serde_json::to_value(resources).unwrap_or_default();
        }

        let mut labels = config.labels.clone();
        labels.entry("app".to_string()).or_insert_with(|| config.name.clone());

        let mut body = serde_json::json!({
            "apiVersion": "apps/v1",
            "kind": "Deployment",
            "metadata": {
                "name": config.name,
                "namespace": namespace,
                "labels": labels,
                "annotations": config.annotations,
            },
            "spec": {
                "replicas": config.replicas,
                "selector": {
                    "matchLabels": labels,
                },
                "template": {
                    "metadata": { "labels": labels },
                    "spec": {
                        "containers": [container]
                    }
                }
            }
        });

        if let Some(ref strategy) = config.strategy {
            body["spec"]["strategy"] = serde_json::to_value(strategy).unwrap_or_default();
        }

        info!("Creating deployment '{}/{}' with {} replica(s)", namespace, config.name, config.replicas);
        client.post(&url, &body).await
    }

    /// Update (replace) a deployment.
    pub async fn update(client: &K8sClient, namespace: &str, name: &str, manifest: &serde_json::Value) -> K8sResult<DeploymentInfo> {
        let url = format!("{}/{}", client.apps_v1_url(namespace, "deployments"), name);
        client.put(&url, manifest).await
    }

    /// Patch a deployment.
    pub async fn patch(client: &K8sClient, namespace: &str, name: &str, patch: &serde_json::Value) -> K8sResult<DeploymentInfo> {
        let url = format!("{}/{}", client.apps_v1_url(namespace, "deployments"), name);
        client.patch(&url, patch).await
    }

    /// Delete a deployment.
    pub async fn delete(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<serde_json::Value> {
        let url = format!("{}/{}", client.apps_v1_url(namespace, "deployments"), name);
        info!("Deleting deployment '{}/{}'", namespace, name);
        client.delete(&url).await
    }

    /// Scale a deployment.
    pub async fn scale(client: &K8sClient, namespace: &str, name: &str, replicas: i32) -> K8sResult<DeploymentInfo> {
        let url = format!("{}/{}/scale", client.apps_v1_url(namespace, "deployments"), name);
        let body = serde_json::json!({
            "apiVersion": "autoscaling/v1",
            "kind": "Scale",
            "metadata": { "name": name, "namespace": namespace },
            "spec": { "replicas": replicas }
        });
        info!("Scaling deployment '{}/{}' to {} replicas", namespace, name, replicas);
        let _: serde_json::Value = client.put(&url, &body).await?;
        // Return the updated deployment
        Self::get(client, namespace, name).await
    }

    /// Restart a deployment (patch pod template annotation to trigger rollout).
    pub async fn restart(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<DeploymentInfo> {
        let now = chrono::Utc::now().to_rfc3339();
        let patch = serde_json::json!({
            "spec": {
                "template": {
                    "metadata": {
                        "annotations": {
                            "kubectl.kubernetes.io/restartedAt": now
                        }
                    }
                }
            }
        });
        info!("Restarting deployment '{}/{}'", namespace, name);
        Self::patch(client, namespace, name, &patch).await
    }

    /// Pause a deployment rollout.
    pub async fn pause(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<DeploymentInfo> {
        let patch = serde_json::json!({ "spec": { "paused": true } });
        info!("Pausing deployment '{}/{}'", namespace, name);
        Self::patch(client, namespace, name, &patch).await
    }

    /// Resume a paused deployment rollout.
    pub async fn resume(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<DeploymentInfo> {
        let patch = serde_json::json!({ "spec": { "paused": false } });
        info!("Resuming deployment '{}/{}'", namespace, name);
        Self::patch(client, namespace, name, &patch).await
    }

    /// Update the container image for a deployment.
    pub async fn set_image(
        client: &K8sClient,
        namespace: &str,
        name: &str,
        container_name: &str,
        image: &str,
    ) -> K8sResult<DeploymentInfo> {
        let deployment = Self::get(client, namespace, name).await?;
        let mut containers: Vec<serde_json::Value> = deployment.spec.template.spec.containers.iter()
            .map(|c| {
                let mut obj = serde_json::to_value(c).unwrap_or_default();
                if c.name == container_name {
                    obj["image"] = serde_json::Value::String(image.to_string());
                }
                obj
            })
            .collect();

        let patch = serde_json::json!({
            "spec": {
                "template": {
                    "spec": {
                        "containers": containers
                    }
                }
            }
        });
        info!("Updating image for container '{}' in deployment '{}/{}' to '{}'",
            container_name, namespace, name, image);
        Self::patch(client, namespace, name, &patch).await
    }

    /// Get rollout status / info for a deployment.
    pub async fn rollout_status(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<RolloutInfo> {
        let dep = Self::get(client, namespace, name).await?;
        Ok(RolloutInfo {
            revision: dep.metadata.generation.unwrap_or(0),
            status: if dep.status.available_replicas == dep.status.replicas {
                "Complete".to_string()
            } else {
                "Progressing".to_string()
            },
            desired_replicas: dep.spec.replicas.unwrap_or(1),
            current_replicas: dep.status.replicas.unwrap_or(0),
            ready_replicas: dep.status.ready_replicas.unwrap_or(0),
            updated_replicas: dep.status.updated_replicas.unwrap_or(0),
            conditions: dep.status.conditions,
        })
    }

    /// Rollback to a specific revision via ReplicaSet history.
    pub async fn rollback(client: &K8sClient, namespace: &str, name: &str, revision: Option<i64>) -> K8sResult<DeploymentInfo> {
        // K8s 1.x: use apps/v1 rollback subresource is deprecated.
        // Modern approach: find the ReplicaSet with the target revision annotation
        // and patch the deployment's pod template to match.
        let rs_url = format!("{}{}", client.apps_v1_url(namespace, "replicasets"),
            format!("?labelSelector=app={}", name));
        let rs_resp: serde_json::Value = client.get(&rs_url).await?;
        let items = rs_resp.get("items")
            .and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::not_found("No ReplicaSets found for deployment"))?;

        let target_revision = revision.unwrap_or_else(|| {
            // Default to previous revision
            let current = items.iter()
                .filter_map(|rs| {
                    rs.get("metadata")?.get("annotations")?
                        .get("deployment.kubernetes.io/revision")?
                        .as_str()?.parse::<i64>().ok()
                })
                .max()
                .unwrap_or(1);
            current.saturating_sub(1).max(1)
        });

        let target_rs = items.iter().find(|rs| {
            rs.get("metadata")
                .and_then(|m| m.get("annotations"))
                .and_then(|a| a.get("deployment.kubernetes.io/revision"))
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<i64>().ok())
                == Some(target_revision)
        }).ok_or_else(|| K8sError::not_found(
            format!("ReplicaSet with revision {} not found", target_revision),
        ))?;

        let template = target_rs.get("spec")
            .and_then(|s| s.get("template"))
            .ok_or_else(|| K8sError::parse("ReplicaSet missing spec.template"))?;

        let patch = serde_json::json!({
            "spec": { "template": template }
        });
        info!("Rolling back deployment '{}/{}' to revision {}", namespace, name, target_revision);
        Self::patch(client, namespace, name, &patch).await
    }

    /// List deployments across all namespaces.
    pub async fn list_all_namespaces(client: &K8sClient, opts: &ListOptions) -> K8sResult<Vec<DeploymentInfo>> {
        let url = format!("{}/apis/apps/v1/deployments{}", client.base_url, K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        Self::parse_list(&resp)
    }

    fn parse_list(resp: &serde_json::Value) -> K8sResult<Vec<DeploymentInfo>> {
        let items = resp.get("items")
            .and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in deployment list response"))?;
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    // ── StatefulSet helpers ────────────────────────────────────────────

    /// List StatefulSets.
    pub async fn list_statefulsets(client: &K8sClient, namespace: &str, opts: &ListOptions) -> K8sResult<Vec<StatefulSetInfo>> {
        let url = format!("{}{}", client.apps_v1_url(namespace, "statefulsets"), K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// List DaemonSets.
    pub async fn list_daemonsets(client: &K8sClient, namespace: &str, opts: &ListOptions) -> K8sResult<Vec<DaemonSetInfo>> {
        let url = format!("{}{}", client.apps_v1_url(namespace, "daemonsets"), K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// List ReplicaSets.
    pub async fn list_replicasets(client: &K8sClient, namespace: &str, opts: &ListOptions) -> K8sResult<Vec<ReplicaSetInfo>> {
        let url = format!("{}{}", client.apps_v1_url(namespace, "replicasets"), K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }
}
