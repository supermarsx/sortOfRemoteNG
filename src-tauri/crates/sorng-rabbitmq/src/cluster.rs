use crate::client::RabbitApiClient;
use crate::error::{RabbitError, RabbitErrorKind};
use crate::types::{ClusterName, ClusterNode, NodeMemory};

// ---------------------------------------------------------------------------
// Cluster node management
// ---------------------------------------------------------------------------

/// List all nodes in the cluster.
pub async fn list_nodes(
    client: &RabbitApiClient,
) -> Result<Vec<ClusterNode>, RabbitError> {
    client.get("nodes").await
}

/// Get detailed information about a specific node.
pub async fn get_node(
    client: &RabbitApiClient,
    name: &str,
) -> Result<ClusterNode, RabbitError> {
    let en = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("nodes/{}", en)).await
}

/// Get a node with full memory breakdown included.
pub async fn get_node_with_memory(
    client: &RabbitApiClient,
    name: &str,
) -> Result<ClusterNode, RabbitError> {
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .get(&format!("nodes/{}?memory=true", en))
        .await
}

/// Get the memory breakdown for a node.
pub async fn get_node_memory(
    client: &RabbitApiClient,
    name: &str,
) -> Result<NodeMemory, RabbitError> {
    let en = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("nodes/{}/memory", en)).await
}

// ---------------------------------------------------------------------------
// Cluster name
// ---------------------------------------------------------------------------

/// Get the current cluster name.
pub async fn get_cluster_name(
    client: &RabbitApiClient,
) -> Result<ClusterName, RabbitError> {
    client.get("cluster-name").await
}

/// Set (rename) the cluster.
pub async fn set_cluster_name(
    client: &RabbitApiClient,
    name: &str,
) -> Result<(), RabbitError> {
    let body = ClusterName {
        name: name.to_string(),
    };
    client.put_no_content("cluster-name", &body).await
}

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------

/// List all active alarms on each node.
///
/// Each element is a JSON object with `node`, `resource`, and `source` keys.
/// An empty list means no alarms are active.
pub async fn list_alarms(
    client: &RabbitApiClient,
) -> Result<Vec<serde_json::Value>, RabbitError> {
    // The alarms are embedded in node details. We extract them from each node
    // by reading the health check endpoint which aggregates alarm info.
    let nodes = list_nodes(client).await?;
    let mut alarms = Vec::new();
    for node in &nodes {
        if node.mem_alarm == Some(true) {
            alarms.push(serde_json::json!({
                "node": node.name,
                "resource": "memory",
                "source": "memory_alarm",
            }));
        }
        if node.disk_free_alarm == Some(true) {
            alarms.push(serde_json::json!({
                "node": node.name,
                "resource": "disk",
                "source": "disk_free_alarm",
            }));
        }
    }
    Ok(alarms)
}

/// Check whether any alarms are currently active in the cluster.
///
/// Returns `Ok(true)` if there are **no** alarms (healthy), `Ok(false)`
/// if one or more alarms are active.
pub async fn check_alarms(
    client: &RabbitApiClient,
) -> Result<bool, RabbitError> {
    let alarms = list_alarms(client).await?;
    Ok(alarms.is_empty())
}

/// Get the health check result from the `/api/health/checks/alarms` endpoint.
///
/// Returns the raw JSON response from the health check. A 200 response means
/// the cluster has no alarms; a non-200 response means alarms are active.
pub async fn health_check_alarms(
    client: &RabbitApiClient,
) -> Result<serde_json::Value, RabbitError> {
    client.get("health/checks/alarms").await
}

// ---------------------------------------------------------------------------
// Partitions
// ---------------------------------------------------------------------------

/// Get network partition information for all nodes.
///
/// Returns a mapping from node name to its list of partitioned peer nodes.
/// An empty list for a node means it sees no partitions.
pub async fn get_partitions(
    client: &RabbitApiClient,
) -> Result<std::collections::HashMap<String, Vec<String>>, RabbitError> {
    let nodes = list_nodes(client).await?;
    let mut result = std::collections::HashMap::new();
    for node in nodes {
        let partitions = node.partitions.unwrap_or_default();
        result.insert(node.name, partitions);
    }
    Ok(result)
}

/// Check whether any network partitions exist in the cluster.
pub async fn has_partitions(
    client: &RabbitApiClient,
) -> Result<bool, RabbitError> {
    let partitions = get_partitions(client).await?;
    Ok(partitions.values().any(|v| !v.is_empty()))
}

// ---------------------------------------------------------------------------
// Force sync / maintenance
// ---------------------------------------------------------------------------

/// Force all classic mirrored queues on a node to synchronise their mirrors.
///
/// This iterates all queues on the given node and triggers a sync action
/// for each one that has unsynchronised mirrors.
pub async fn force_sync(
    client: &RabbitApiClient,
    node: &str,
) -> Result<u32, RabbitError> {
    let queues: Vec<crate::types::QueueInfo> = client.get("queues").await?;
    let mut synced = 0u32;

    for queue in &queues {
        if queue.node.as_deref() != Some(node) {
            continue;
        }

        // Only attempt sync if the queue has unsynchronised slaves
        let has_unsynced = match (&queue.slave_nodes, &queue.synchronised_slave_nodes) {
            (Some(slaves), Some(synced_slaves)) => slaves.len() != synced_slaves.len(),
            _ => false,
        };

        if has_unsynced {
            let ev = RabbitApiClient::encode_path_segment(&queue.vhost);
            let en = RabbitApiClient::encode_path_segment(&queue.name);
            let body = serde_json::json!({ "action": "sync" });
            client
                .post_no_content(&format!("queues/{}/{}/actions", ev, en), &body)
                .await?;
            synced += 1;
        }
    }

    Ok(synced)
}

/// List all enabled plugins on a node.
pub async fn list_node_plugins(
    client: &RabbitApiClient,
    node: &str,
) -> Result<Vec<String>, RabbitError> {
    let info = get_node(client, node).await?;
    Ok(info.enabled_plugins.unwrap_or_default())
}

/// Check if a specific node is running and reachable.
pub async fn is_node_running(
    client: &RabbitApiClient,
    name: &str,
) -> Result<bool, RabbitError> {
    let node = get_node(client, name).await?;
    Ok(node.running == Some(true))
}

/// Get a summary of resource usage across all cluster nodes.
pub async fn cluster_resource_summary(
    client: &RabbitApiClient,
) -> Result<Vec<serde_json::Value>, RabbitError> {
    let nodes = list_nodes(client).await?;
    let mut summaries = Vec::new();
    for node in &nodes {
        summaries.push(serde_json::json!({
            "name": node.name,
            "running": node.running,
            "fd_used": node.fd_used,
            "fd_total": node.fd_total,
            "sockets_used": node.sockets_used,
            "sockets_total": node.sockets_total,
            "mem_used": node.mem_used,
            "mem_limit": node.mem_limit,
            "mem_alarm": node.mem_alarm,
            "disk_free": node.disk_free,
            "disk_free_limit": node.disk_free_limit,
            "disk_free_alarm": node.disk_free_alarm,
            "proc_used": node.proc_used,
            "proc_total": node.proc_total,
            "uptime": node.uptime,
        }));
    }
    Ok(summaries)
}

/// Get the Erlang distribution (cluster link) data for all nodes.
pub async fn get_cluster_links(
    client: &RabbitApiClient,
) -> Result<Vec<serde_json::Value>, RabbitError> {
    let nodes = list_nodes(client).await?;
    let mut links = Vec::new();
    for node in nodes {
        if let Some(cl) = node.cluster_links {
            for link in cl {
                links.push(serde_json::json!({
                    "node": node.name,
                    "link": link,
                }));
            }
        }
    }
    Ok(links)
}
