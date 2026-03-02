// ── sorng-k8s/src/metrics.rs ─────────────────────────────────────────────────
//! Kubernetes Metrics API for nodes and pods.

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::types::*;

/// Metrics collection operations (requires metrics-server deployed in the cluster).
pub struct MetricsManager;

impl MetricsManager {
    // ── Node Metrics ──────────────────────────────────────────────

    /// List metrics for all nodes.
    pub async fn list_node_metrics(client: &K8sClient) -> K8sResult<Vec<NodeMetrics>> {
        let url = format!("{}/apis/metrics.k8s.io/v1beta1/nodes", client.base_url);
        let resp: serde_json::Value = client.get(&url).await.map_err(|e| {
            if let crate::error::K8sErrorKind::NotFound = e.kind {
                K8sError::metrics_unavailable("Metrics server not available: metrics.k8s.io API not found")
            } else {
                e
            }
        })?;
        let items = resp.get("items").and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in node metrics response"))?;
        Ok(items.iter().filter_map(|i| parse_node_metrics(i)).collect())
    }

    /// Get metrics for a specific node.
    pub async fn get_node_metrics(client: &K8sClient, name: &str) -> K8sResult<NodeMetrics> {
        let url = format!("{}/apis/metrics.k8s.io/v1beta1/nodes/{}", client.base_url, name);
        let resp: serde_json::Value = client.get(&url).await.map_err(|e| {
            if let crate::error::K8sErrorKind::NotFound = e.kind {
                K8sError::metrics_unavailable("Metrics server not available or node not found")
            } else {
                e
            }
        })?;
        parse_node_metrics(&resp).ok_or_else(|| K8sError::parse("Failed to parse node metrics"))
    }

    // ── Pod Metrics ──────────────────────────────────────────────

    /// List metrics for pods in a namespace.
    pub async fn list_pod_metrics(client: &K8sClient, namespace: &str) -> K8sResult<Vec<PodMetrics>> {
        let url = format!("{}/apis/metrics.k8s.io/v1beta1/namespaces/{}/pods", client.base_url, namespace);
        let resp: serde_json::Value = client.get(&url).await.map_err(|e| {
            if let crate::error::K8sErrorKind::NotFound = e.kind {
                K8sError::metrics_unavailable("Metrics server not available")
            } else {
                e
            }
        })?;
        let items = resp.get("items").and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in pod metrics response"))?;
        Ok(items.iter().filter_map(|i| parse_pod_metrics(i)).collect())
    }

    /// List metrics for pods across all namespaces.
    pub async fn list_all_pod_metrics(client: &K8sClient) -> K8sResult<Vec<PodMetrics>> {
        let url = format!("{}/apis/metrics.k8s.io/v1beta1/pods", client.base_url);
        let resp: serde_json::Value = client.get(&url).await.map_err(|e| {
            if let crate::error::K8sErrorKind::NotFound = e.kind {
                K8sError::metrics_unavailable("Metrics server not available")
            } else {
                e
            }
        })?;
        let items = resp.get("items").and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in pod metrics response"))?;
        Ok(items.iter().filter_map(|i| parse_pod_metrics(i)).collect())
    }

    /// Get metrics for a specific pod.
    pub async fn get_pod_metrics(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<PodMetrics> {
        let url = format!("{}/apis/metrics.k8s.io/v1beta1/namespaces/{}/pods/{}", client.base_url, namespace, name);
        let resp: serde_json::Value = client.get(&url).await.map_err(|e| {
            if let crate::error::K8sErrorKind::NotFound = e.kind {
                K8sError::metrics_unavailable("Metrics server not available or pod not found")
            } else {
                e
            }
        })?;
        parse_pod_metrics(&resp).ok_or_else(|| K8sError::parse("Failed to parse pod metrics"))
    }

    // ── Cluster Resource Summary ──────────────────────────────────

    /// Build a cluster resource summary from node and pod metrics.
    pub async fn cluster_summary(client: &K8sClient) -> K8sResult<ClusterResourceSummary> {
        let node_metrics = Self::list_node_metrics(client).await?;
        let pod_metrics = Self::list_all_pod_metrics(client).await?;

        let total_cpu_millicores: i64 = node_metrics.iter().map(|n| n.cpu_usage_millicores).sum();
        let total_memory_bytes: i64 = node_metrics.iter().map(|n| n.memory_usage_bytes).sum();

        let mut total_cpu_capacity: i64 = 0;
        let mut total_memory_capacity: i64 = 0;

        // Try to fetch node list for capacity info
        if let Ok(nodes_resp) = client.get::<serde_json::Value>(
            &format!("{}/api/v1/nodes", client.base_url)
        ).await {
            if let Some(items) = nodes_resp.get("items").and_then(|v| v.as_array()) {
                for item in items {
                    if let Some(status) = item.get("status") {
                        if let Some(capacity) = status.get("capacity") {
                            if let Some(cpu) = capacity.get("cpu").and_then(|v| v.as_str()) {
                                total_cpu_capacity += parse_cpu_to_millicores(cpu);
                            }
                            if let Some(mem) = capacity.get("memory").and_then(|v| v.as_str()) {
                                total_memory_capacity += parse_memory_to_bytes(mem);
                            }
                        }
                    }
                }
            }
        }

        Ok(ClusterResourceSummary {
            total_nodes: node_metrics.len() as i32,
            total_pods: pod_metrics.len() as i32,
            total_cpu_usage_millicores: total_cpu_millicores,
            total_memory_usage_bytes: total_memory_bytes,
            total_cpu_capacity_millicores: total_cpu_capacity,
            total_memory_capacity_bytes: total_memory_capacity,
            cpu_utilization_percent: if total_cpu_capacity > 0 {
                (total_cpu_millicores as f64 / total_cpu_capacity as f64) * 100.0
            } else {
                0.0
            },
            memory_utilization_percent: if total_memory_capacity > 0 {
                (total_memory_bytes as f64 / total_memory_capacity as f64) * 100.0
            } else {
                0.0
            },
        })
    }

    /// Check if the metrics API is available.
    pub async fn is_available(client: &K8sClient) -> bool {
        client.get::<serde_json::Value>(
            &format!("{}/apis/metrics.k8s.io/v1beta1", client.base_url)
        ).await.is_ok()
    }
}

// ── Parsing Helpers ──────────────────────────────────────────────────

fn parse_node_metrics(val: &serde_json::Value) -> Option<NodeMetrics> {
    let name = val.pointer("/metadata/name")?.as_str()?.to_string();
    let usage = val.get("usage")?;
    let cpu_str = usage.get("cpu")?.as_str()?;
    let mem_str = usage.get("memory")?.as_str()?;
    let timestamp = val.get("timestamp")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let window = val.get("window")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    Some(NodeMetrics {
        name,
        cpu_usage_millicores: parse_cpu_to_millicores(cpu_str),
        memory_usage_bytes: parse_memory_to_bytes(mem_str),
        timestamp,
        window,
    })
}

fn parse_pod_metrics(val: &serde_json::Value) -> Option<PodMetrics> {
    let name = val.pointer("/metadata/name")?.as_str()?.to_string();
    let namespace = val.pointer("/metadata/namespace")?.as_str()?.to_string();
    let timestamp = val.get("timestamp")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let window = val.get("window")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let containers = val.get("containers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter().filter_map(|c| {
                let cname = c.get("name")?.as_str()?.to_string();
                let usage = c.get("usage")?;
                let cpu = usage.get("cpu").and_then(|v| v.as_str()).unwrap_or("0");
                let mem = usage.get("memory").and_then(|v| v.as_str()).unwrap_or("0");
                Some(ContainerMetrics {
                    name: cname,
                    cpu_usage_millicores: parse_cpu_to_millicores(cpu),
                    memory_usage_bytes: parse_memory_to_bytes(mem),
                })
            }).collect()
        })
        .unwrap_or_default();

    Some(PodMetrics {
        name,
        namespace,
        containers,
        timestamp,
        window,
    })
}

/// Parse Kubernetes CPU quantity to millicores.
/// Examples: "100m" -> 100, "1" -> 1000, "2500n" -> 2 (2.5 rounded down for nanos)
fn parse_cpu_to_millicores(cpu: &str) -> i64 {
    let cpu = cpu.trim();
    if cpu.ends_with('n') {
        // Nanocores to millicores
        let nanos: i64 = cpu.trim_end_matches('n').parse().unwrap_or(0);
        nanos / 1_000_000
    } else if cpu.ends_with('u') {
        // Microcores to millicores
        let micros: i64 = cpu.trim_end_matches('u').parse().unwrap_or(0);
        micros / 1_000
    } else if cpu.ends_with('m') {
        cpu.trim_end_matches('m').parse().unwrap_or(0)
    } else {
        // Whole cores
        let cores: f64 = cpu.parse().unwrap_or(0.0);
        (cores * 1000.0) as i64
    }
}

/// Parse Kubernetes memory quantity to bytes.
/// Examples: "128974848" -> 128974848, "129e6" -> 129000000, "129M" -> 129000000,
///           "128974848" -> 128974848, "123Mi" -> 128974848
fn parse_memory_to_bytes(mem: &str) -> i64 {
    let mem = mem.trim();
    if mem.ends_with("Ki") {
        let val: f64 = mem.trim_end_matches("Ki").parse().unwrap_or(0.0);
        (val * 1024.0) as i64
    } else if mem.ends_with("Mi") {
        let val: f64 = mem.trim_end_matches("Mi").parse().unwrap_or(0.0);
        (val * 1024.0 * 1024.0) as i64
    } else if mem.ends_with("Gi") {
        let val: f64 = mem.trim_end_matches("Gi").parse().unwrap_or(0.0);
        (val * 1024.0 * 1024.0 * 1024.0) as i64
    } else if mem.ends_with("Ti") {
        let val: f64 = mem.trim_end_matches("Ti").parse().unwrap_or(0.0);
        (val * 1024.0 * 1024.0 * 1024.0 * 1024.0) as i64
    } else if mem.ends_with("Pi") {
        let val: f64 = mem.trim_end_matches("Pi").parse().unwrap_or(0.0);
        (val * 1024.0 * 1024.0 * 1024.0 * 1024.0 * 1024.0) as i64
    } else if mem.ends_with("Ei") {
        let val: f64 = mem.trim_end_matches("Ei").parse().unwrap_or(0.0);
        (val * 1024.0 * 1024.0 * 1024.0 * 1024.0 * 1024.0 * 1024.0) as i64
    } else if mem.ends_with('K') || mem.ends_with('k') {
        let val: f64 = mem[..mem.len()-1].parse().unwrap_or(0.0);
        (val * 1000.0) as i64
    } else if mem.ends_with('M') {
        let val: f64 = mem.trim_end_matches('M').parse().unwrap_or(0.0);
        (val * 1_000_000.0) as i64
    } else if mem.ends_with('G') {
        let val: f64 = mem.trim_end_matches('G').parse().unwrap_or(0.0);
        (val * 1_000_000_000.0) as i64
    } else if mem.ends_with('T') {
        let val: f64 = mem.trim_end_matches('T').parse().unwrap_or(0.0);
        (val * 1_000_000_000_000.0) as i64
    } else if mem.ends_with('P') {
        let val: f64 = mem.trim_end_matches('P').parse().unwrap_or(0.0);
        (val * 1_000_000_000_000_000.0) as i64
    } else if mem.ends_with('E') {
        let val: f64 = mem.trim_end_matches('E').parse().unwrap_or(0.0);
        (val * 1_000_000_000_000_000_000.0) as i64
    } else {
        // Plain bytes or scientific notation
        let val: f64 = mem.parse().unwrap_or(0.0);
        val as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cpu_millicores() {
        assert_eq!(parse_cpu_to_millicores("100m"), 100);
        assert_eq!(parse_cpu_to_millicores("1"), 1000);
        assert_eq!(parse_cpu_to_millicores("0.5"), 500);
        assert_eq!(parse_cpu_to_millicores("250000000n"), 250);
        assert_eq!(parse_cpu_to_millicores("100000u"), 100);
    }

    #[test]
    fn test_parse_memory_bytes() {
        assert_eq!(parse_memory_to_bytes("128974848"), 128974848);
        assert_eq!(parse_memory_to_bytes("128Mi"), 134217728);
        assert_eq!(parse_memory_to_bytes("1Gi"), 1073741824);
        assert_eq!(parse_memory_to_bytes("129M"), 129000000);
        assert_eq!(parse_memory_to_bytes("100Ki"), 102400);
    }
}
