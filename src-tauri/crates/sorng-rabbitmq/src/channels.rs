use crate::client::RabbitApiClient;
use crate::error::RabbitError;
use crate::types::{ChannelInfo, ConsumerInfo};

// ---------------------------------------------------------------------------
// Channel listing & details
// ---------------------------------------------------------------------------

/// List all open channels across the broker.
pub async fn list_channels(client: &RabbitApiClient) -> Result<Vec<ChannelInfo>, RabbitError> {
    client.get("channels").await
}

/// Get detailed information about a single channel by name.
///
/// Channel names are typically of the form
/// `{connection_ip}:{port} -> {node_ip}:{port} (N)`.
pub async fn get_channel(client: &RabbitApiClient, name: &str) -> Result<ChannelInfo, RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("channels/{}", encoded)).await
}

/// List all channels belonging to a specific connection.
pub async fn list_channels_for_connection(
    client: &RabbitApiClient,
    connection_name: &str,
) -> Result<Vec<ChannelInfo>, RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(connection_name);
    client
        .get(&format!("connections/{}/channels", encoded))
        .await
}

/// List the consumers on a specific channel.
///
/// The management API does not have a direct channel-to-consumer endpoint,
/// so we filter the global consumer list by channel name.
pub async fn get_channel_consumers(
    client: &RabbitApiClient,
    channel_name: &str,
) -> Result<Vec<ConsumerInfo>, RabbitError> {
    let all: Vec<ConsumerInfo> = client.get("consumers").await?;
    Ok(all
        .into_iter()
        .filter(|c| {
            c.channel_details
                .as_ref()
                .and_then(|d| d.get("name"))
                .and_then(|n| n.as_str())
                == Some(channel_name)
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Filtering helpers
// ---------------------------------------------------------------------------

/// List channels belonging to a specific vhost.
pub async fn list_channels_for_vhost(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<Vec<ChannelInfo>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    client.get(&format!("vhosts/{}/channels", ev)).await
}

/// List channels belonging to a specific user.
pub async fn list_channels_for_user(
    client: &RabbitApiClient,
    user: &str,
) -> Result<Vec<ChannelInfo>, RabbitError> {
    let all = list_channels(client).await?;
    Ok(all
        .into_iter()
        .filter(|c| c.user.as_deref() == Some(user))
        .collect())
}

/// List channels on a specific node.
pub async fn list_channels_for_node(
    client: &RabbitApiClient,
    node: &str,
) -> Result<Vec<ChannelInfo>, RabbitError> {
    let all = list_channels(client).await?;
    Ok(all
        .into_iter()
        .filter(|c| c.node.as_deref() == Some(node))
        .collect())
}

/// Get a count of channels grouped by vhost.
pub async fn channel_count_by_vhost(
    client: &RabbitApiClient,
) -> Result<std::collections::HashMap<String, usize>, RabbitError> {
    let all = list_channels(client).await?;
    let mut counts = std::collections::HashMap::new();
    for ch in &all {
        let vhost = ch.vhost.as_deref().unwrap_or("unknown").to_string();
        *counts.entry(vhost).or_insert(0) += 1;
    }
    Ok(counts)
}

/// Get a count of channels grouped by user.
pub async fn channel_count_by_user(
    client: &RabbitApiClient,
) -> Result<std::collections::HashMap<String, usize>, RabbitError> {
    let all = list_channels(client).await?;
    let mut counts = std::collections::HashMap::new();
    for ch in &all {
        let user = ch.user.as_deref().unwrap_or("unknown").to_string();
        *counts.entry(user).or_insert(0) += 1;
    }
    Ok(counts)
}

/// Get channels that have unacknowledged messages above a threshold.
pub async fn channels_with_unacked(
    client: &RabbitApiClient,
    min_unacked: u64,
) -> Result<Vec<ChannelInfo>, RabbitError> {
    let all = list_channels(client).await?;
    Ok(all
        .into_iter()
        .filter(|c| c.messages_unacknowledged.unwrap_or(0) >= min_unacked)
        .collect())
}

/// Get channels that are in confirm mode.
pub async fn channels_in_confirm_mode(
    client: &RabbitApiClient,
) -> Result<Vec<ChannelInfo>, RabbitError> {
    let all = list_channels(client).await?;
    Ok(all
        .into_iter()
        .filter(|c| c.confirm == Some(true))
        .collect())
}

/// Get channels that are transactional.
pub async fn channels_transactional(
    client: &RabbitApiClient,
) -> Result<Vec<ChannelInfo>, RabbitError> {
    let all = list_channels(client).await?;
    Ok(all
        .into_iter()
        .filter(|c| c.transactional == Some(true))
        .collect())
}

/// Get aggregate message stats across all channels.
pub async fn channel_stats_summary(
    client: &RabbitApiClient,
) -> Result<serde_json::Value, RabbitError> {
    let all = list_channels(client).await?;
    let count = all.len() as u64;
    let mut total_unacked: u64 = 0;
    let mut total_unconfirmed: u64 = 0;
    let mut total_consumers: u64 = 0;
    for ch in &all {
        total_unacked += ch.messages_unacknowledged.unwrap_or(0);
        total_unconfirmed += ch.messages_unconfirmed.unwrap_or(0);
        total_consumers += ch.consumer_count.unwrap_or(0);
    }
    Ok(serde_json::json!({
        "channel_count": count,
        "total_unacknowledged": total_unacked,
        "total_unconfirmed": total_unconfirmed,
        "total_consumers": total_consumers,
    }))
}
