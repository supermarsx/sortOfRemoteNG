use crate::client::RabbitApiClient;
use crate::error::RabbitError;
use crate::types::{
    ClusterNode, MessageStats, ObjectTotals, OverviewInfo, QueueInfo, QueueTotals,
};

// ---------------------------------------------------------------------------
// Overview & health
// ---------------------------------------------------------------------------

/// Get the full broker overview from `/api/overview`.
///
/// This is the single most useful monitoring endpoint — it includes server
/// version info, object counts, message rates, listeners, and more.
pub async fn get_overview(
    client: &RabbitApiClient,
) -> Result<OverviewInfo, RabbitError> {
    client.get("overview").await
}

/// Get object totals (connections, channels, exchanges, queues, consumers).
pub async fn get_object_totals(
    client: &RabbitApiClient,
) -> Result<ObjectTotals, RabbitError> {
    let overview = get_overview(client).await?;
    Ok(overview.object_totals.unwrap_or_default())
}

/// Get aggregated queue totals (messages, ready, unacknowledged) with rates.
pub async fn get_queue_totals(
    client: &RabbitApiClient,
) -> Result<QueueTotals, RabbitError> {
    let overview = get_overview(client).await?;
    Ok(overview.queue_totals.unwrap_or_default())
}

/// Get the top-level message stats from the overview (publish, deliver, etc. rates).
pub async fn get_message_rates(
    client: &RabbitApiClient,
) -> Result<MessageStats, RabbitError> {
    let overview = get_overview(client).await?;
    Ok(overview.message_stats.unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Node-level metrics
// ---------------------------------------------------------------------------

/// Get metrics for all cluster nodes.
pub async fn get_node_metrics(
    client: &RabbitApiClient,
) -> Result<Vec<ClusterNode>, RabbitError> {
    client.get("nodes").await
}

/// Get metrics for a single node.
pub async fn get_single_node_metrics(
    client: &RabbitApiClient,
    name: &str,
) -> Result<ClusterNode, RabbitError> {
    let en = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("nodes/{}", en)).await
}

// ---------------------------------------------------------------------------
// Queue-level rates
// ---------------------------------------------------------------------------

/// Get message rates for each queue in a vhost.
///
/// Returns a list of JSON objects, one per queue, containing the queue name
/// plus its message_stats rate details.
pub async fn get_queue_rates(
    client: &RabbitApiClient,
    vhost: Option<&str>,
) -> Result<Vec<serde_json::Value>, RabbitError> {
    let queues: Vec<QueueInfo> = match vhost {
        Some(v) => {
            let ev = RabbitApiClient::encode_path_segment(v);
            client.get(&format!("queues/{}", ev)).await?
        }
        None => client.get("queues").await?,
    };

    let mut rates = Vec::with_capacity(queues.len());
    for q in &queues {
        let stats = q.message_stats.as_ref();
        rates.push(serde_json::json!({
            "vhost": q.vhost,
            "name": q.name,
            "messages": q.messages,
            "messages_ready": q.messages_ready,
            "messages_unacknowledged": q.messages_unacknowledged,
            "publish_rate": stats
                .and_then(|s| s.publish_details.as_ref())
                .map(|d| d.rate)
                .unwrap_or(0.0),
            "deliver_get_rate": stats
                .and_then(|s| s.deliver_get_details.as_ref())
                .map(|d| d.rate)
                .unwrap_or(0.0),
            "ack_rate": stats
                .and_then(|s| s.ack_details.as_ref())
                .map(|d| d.rate)
                .unwrap_or(0.0),
        }));
    }
    Ok(rates)
}

/// Get message rates for each exchange in a vhost.
pub async fn get_exchange_rates(
    client: &RabbitApiClient,
    vhost: Option<&str>,
) -> Result<Vec<serde_json::Value>, RabbitError> {
    let exchanges: Vec<crate::types::ExchangeInfo> = match vhost {
        Some(v) => {
            let ev = RabbitApiClient::encode_path_segment(v);
            client.get(&format!("exchanges/{}", ev)).await?
        }
        None => client.get("exchanges").await?,
    };

    let mut rates = Vec::with_capacity(exchanges.len());
    for ex in &exchanges {
        let stats = ex.message_stats.as_ref();
        rates.push(serde_json::json!({
            "vhost": ex.vhost,
            "name": ex.name,
            "type": ex.exchange_type.to_string(),
            "publish_in_rate": stats
                .and_then(|s| s.publish_in_details.as_ref())
                .map(|d| d.rate)
                .unwrap_or(0.0),
            "publish_out_rate": stats
                .and_then(|s| s.publish_out_details.as_ref())
                .map(|d| d.rate)
                .unwrap_or(0.0),
        }));
    }
    Ok(rates)
}

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------

/// Run the aliveness test for a vhost.
///
/// This publishes a test message to a special exchange, consumes it, and
/// confirms the vhost is operational. Uses `GET /api/aliveness-test/{vhost}`.
pub async fn aliveness_test(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<serde_json::Value, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    client.get(&format!("aliveness-test/{}", ev)).await
}

/// Check cluster-wide health via `/api/health/checks/alarms`.
///
/// Returns Ok with the JSON body on success (200 = healthy).
pub async fn health_check_alarms(
    client: &RabbitApiClient,
) -> Result<serde_json::Value, RabbitError> {
    client.get("health/checks/alarms").await
}

/// Check whether a specific vhost is running on all nodes via
/// `/api/health/checks/virtual-hosts`.
pub async fn health_check_vhosts(
    client: &RabbitApiClient,
) -> Result<serde_json::Value, RabbitError> {
    client.get("health/checks/virtual-hosts").await
}

/// Check that the management API port listener is active via
/// `/api/health/checks/port-listener/{port}`.
pub async fn health_check_port_listener(
    client: &RabbitApiClient,
    port: u16,
) -> Result<serde_json::Value, RabbitError> {
    client
        .get(&format!("health/checks/port-listener/{}", port))
        .await
}

/// Check that the broker can authenticate and operate via
/// `/api/health/checks/protocol-listener/{protocol}`.
pub async fn health_check_protocol(
    client: &RabbitApiClient,
    protocol: &str,
) -> Result<serde_json::Value, RabbitError> {
    let ep = RabbitApiClient::encode_path_segment(protocol);
    client
        .get(&format!("health/checks/protocol-listener/{}", ep))
        .await
}

/// Check that the local node's certificate is not expired or
/// about to expire via `/api/health/checks/certificate-expiration/{within}/{unit}`.
pub async fn health_check_certificate(
    client: &RabbitApiClient,
    within: u64,
    unit: &str,
) -> Result<serde_json::Value, RabbitError> {
    client
        .get(&format!(
            "health/checks/certificate-expiration/{}/{}",
            within, unit
        ))
        .await
}

/// Check all node health via `/api/health/checks/node-is-quorum-critical`.
pub async fn health_check_quorum_critical(
    client: &RabbitApiClient,
) -> Result<serde_json::Value, RabbitError> {
    client
        .get("health/checks/node-is-quorum-critical")
        .await
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/// Get a compact monitoring snapshot suitable for dashboards.
///
/// Combines the overview, node resource summaries, and queue totals into
/// a single JSON payload.
pub async fn monitoring_snapshot(
    client: &RabbitApiClient,
) -> Result<serde_json::Value, RabbitError> {
    let overview = get_overview(client).await?;
    let nodes = get_node_metrics(client).await?;

    let node_summaries: Vec<serde_json::Value> = nodes
        .iter()
        .map(|n| {
            serde_json::json!({
                "name": n.name,
                "running": n.running,
                "fd_used": n.fd_used,
                "fd_total": n.fd_total,
                "sockets_used": n.sockets_used,
                "sockets_total": n.sockets_total,
                "mem_used": n.mem_used,
                "mem_limit": n.mem_limit,
                "mem_alarm": n.mem_alarm,
                "disk_free": n.disk_free,
                "disk_free_limit": n.disk_free_limit,
                "disk_free_alarm": n.disk_free_alarm,
                "proc_used": n.proc_used,
                "proc_total": n.proc_total,
                "uptime": n.uptime,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "rabbitmq_version": overview.rabbitmq_version,
        "erlang_version": overview.erlang_version,
        "cluster_name": overview.cluster_name,
        "object_totals": overview.object_totals,
        "queue_totals": overview.queue_totals,
        "message_stats": overview.message_stats,
        "nodes": node_summaries,
    }))
}

/// Get queues that exceed a message threshold, useful for alerting.
pub async fn queues_above_threshold(
    client: &RabbitApiClient,
    threshold: u64,
    vhost: Option<&str>,
) -> Result<Vec<serde_json::Value>, RabbitError> {
    let queues: Vec<QueueInfo> = match vhost {
        Some(v) => {
            let ev = RabbitApiClient::encode_path_segment(v);
            client.get(&format!("queues/{}", ev)).await?
        }
        None => client.get("queues").await?,
    };

    let mut result = Vec::new();
    for q in &queues {
        let msg_count = q.messages.unwrap_or(0);
        if msg_count >= threshold {
            result.push(serde_json::json!({
                "vhost": q.vhost,
                "name": q.name,
                "messages": msg_count,
                "messages_ready": q.messages_ready,
                "messages_unacknowledged": q.messages_unacknowledged,
                "consumers": q.consumers,
            }));
        }
    }
    Ok(result)
}

/// Get queues with zero consumers (potentially stuck).
pub async fn queues_without_consumers(
    client: &RabbitApiClient,
    vhost: Option<&str>,
) -> Result<Vec<serde_json::Value>, RabbitError> {
    let queues: Vec<QueueInfo> = match vhost {
        Some(v) => {
            let ev = RabbitApiClient::encode_path_segment(v);
            client.get(&format!("queues/{}", ev)).await?
        }
        None => client.get("queues").await?,
    };

    let mut result = Vec::new();
    for q in &queues {
        if q.consumers.unwrap_or(0) == 0 && q.messages.unwrap_or(0) > 0 {
            result.push(serde_json::json!({
                "vhost": q.vhost,
                "name": q.name,
                "messages": q.messages,
                "state": q.state,
            }));
        }
    }
    Ok(result)
}
