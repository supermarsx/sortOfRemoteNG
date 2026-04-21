use crate::client::RabbitApiClient;
use crate::error::RabbitError;
use crate::types::ConsumerInfo;

// ---------------------------------------------------------------------------
// Consumer listing
// ---------------------------------------------------------------------------

/// List all consumers across the entire broker.
pub async fn list_consumers(client: &RabbitApiClient) -> Result<Vec<ConsumerInfo>, RabbitError> {
    client.get("consumers").await
}

/// List consumers for a specific vhost.
pub async fn list_consumers_for_vhost(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<Vec<ConsumerInfo>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    client.get(&format!("consumers/{}", ev)).await
}

/// List consumers for a specific queue within a vhost.
///
/// The management API does not have a direct queue-consumer endpoint,
/// so we filter the vhost consumer list by queue name.
pub async fn list_consumers_for_queue(
    client: &RabbitApiClient,
    vhost: &str,
    queue: &str,
) -> Result<Vec<ConsumerInfo>, RabbitError> {
    let all = list_consumers_for_vhost(client, vhost).await?;
    Ok(all
        .into_iter()
        .filter(|c| {
            c.queue
                .as_ref()
                .and_then(|q| q.get("name"))
                .and_then(|n| n.as_str())
                == Some(queue)
        })
        .collect())
}

/// Get details of a specific consumer by its consumer tag.
///
/// Searches within the given vhost for a consumer with the matching tag.
pub async fn get_consumer_details(
    client: &RabbitApiClient,
    vhost: &str,
    consumer_tag: &str,
) -> Result<Option<ConsumerInfo>, RabbitError> {
    let all = list_consumers_for_vhost(client, vhost).await?;
    Ok(all
        .into_iter()
        .find(|c| c.consumer_tag.as_deref() == Some(consumer_tag)))
}

/// Cancel a consumer by closing its parent channel's connection.
///
/// The RabbitMQ management API does not support direct consumer cancellation.
/// This is a best-effort approach: it closes the connection that owns the
/// consumer's channel, which will cancel all consumers on that connection.
///
/// Returns `true` if a connection was found and closed, `false` if the
/// consumer was not found.
pub async fn cancel_consumer(
    client: &RabbitApiClient,
    vhost: &str,
    consumer_tag: &str,
) -> Result<bool, RabbitError> {
    let consumer = get_consumer_details(client, vhost, consumer_tag).await?;

    let consumer = match consumer {
        Some(c) => c,
        None => return Ok(false),
    };

    // Extract the connection name from channel_details
    let conn_name = consumer
        .channel_details
        .as_ref()
        .and_then(|d| d.get("connection_name"))
        .and_then(|n| n.as_str());

    if let Some(name) = conn_name {
        let encoded = RabbitApiClient::encode_path_segment(name);
        client.delete(&format!("connections/{}", encoded)).await?;
        Ok(true)
    } else {
        Ok(false)
    }
}

// ---------------------------------------------------------------------------
// Filtering & aggregation helpers
// ---------------------------------------------------------------------------

/// List active consumers only (activity_status == "up" or active == true).
pub async fn list_active_consumers(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<Vec<ConsumerInfo>, RabbitError> {
    let all = list_consumers_for_vhost(client, vhost).await?;
    Ok(all
        .into_iter()
        .filter(|c| c.active == Some(true) || c.activity_status.as_deref() == Some("up"))
        .collect())
}

/// List consumers where `ack_required` is false (auto-ack consumers).
pub async fn list_autoack_consumers(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<Vec<ConsumerInfo>, RabbitError> {
    let all = list_consumers_for_vhost(client, vhost).await?;
    Ok(all
        .into_iter()
        .filter(|c| c.ack_required == Some(false))
        .collect())
}

/// List exclusive consumers.
pub async fn list_exclusive_consumers(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<Vec<ConsumerInfo>, RabbitError> {
    let all = list_consumers_for_vhost(client, vhost).await?;
    Ok(all
        .into_iter()
        .filter(|c| c.exclusive == Some(true))
        .collect())
}

/// Count consumers grouped by queue name.
pub async fn consumer_count_by_queue(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<std::collections::HashMap<String, usize>, RabbitError> {
    let all = list_consumers_for_vhost(client, vhost).await?;
    let mut counts = std::collections::HashMap::new();
    for c in &all {
        let queue_name = c
            .queue
            .as_ref()
            .and_then(|q| q.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("unknown")
            .to_string();
        *counts.entry(queue_name).or_insert(0) += 1;
    }
    Ok(counts)
}

/// Get a summary of consumer statistics for a vhost.
pub async fn consumer_summary(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<serde_json::Value, RabbitError> {
    let all = list_consumers_for_vhost(client, vhost).await?;
    let total = all.len() as u64;
    let active = all.iter().filter(|c| c.active == Some(true)).count() as u64;
    let exclusive = all.iter().filter(|c| c.exclusive == Some(true)).count() as u64;
    let auto_ack = all.iter().filter(|c| c.ack_required == Some(false)).count() as u64;

    Ok(serde_json::json!({
        "total": total,
        "active": active,
        "exclusive": exclusive,
        "auto_ack": auto_ack,
    }))
}

/// Count consumers grouped by activity status.
pub async fn consumer_status_counts(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<std::collections::HashMap<String, usize>, RabbitError> {
    let all = list_consumers_for_vhost(client, vhost).await?;
    let mut counts = std::collections::HashMap::new();
    for c in &all {
        let status = c
            .activity_status
            .as_deref()
            .unwrap_or("unknown")
            .to_string();
        *counts.entry(status).or_insert(0) += 1;
    }
    Ok(counts)
}
