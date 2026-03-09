use crate::client::RabbitApiClient;
use crate::error::RabbitError;
use crate::types::{ChannelInfo, ConnectionInfo};

// ---------------------------------------------------------------------------
// Connection listing & management
// ---------------------------------------------------------------------------

/// List all open connections to the broker.
pub async fn list_connections(
    client: &RabbitApiClient,
) -> Result<Vec<ConnectionInfo>, RabbitError> {
    client.get("connections").await
}

/// Get details of a single connection by name.
pub async fn get_connection(
    client: &RabbitApiClient,
    name: &str,
) -> Result<ConnectionInfo, RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("connections/{}", encoded)).await
}

/// Forcibly close a connection.
///
/// The optional `reason` parameter is sent as the `X-Reason` header and
/// appears in the broker logs and in the AMQP `connection.close` reason.
pub async fn close_connection(client: &RabbitApiClient, name: &str) -> Result<(), RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client.delete(&format!("connections/{}", encoded)).await
}

/// List all connections for a specific vhost.
pub async fn list_connections_for_vhost(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<Vec<ConnectionInfo>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    client.get(&format!("vhosts/{}/connections", ev)).await
}

/// List the channels belonging to a specific connection.
pub async fn get_connection_channels(
    client: &RabbitApiClient,
    name: &str,
) -> Result<Vec<ChannelInfo>, RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client
        .get(&format!("connections/{}/channels", encoded))
        .await
}

// ---------------------------------------------------------------------------
// Filtering helpers
// ---------------------------------------------------------------------------

/// List connections belonging to a specific user.
pub async fn list_connections_for_user(
    client: &RabbitApiClient,
    user: &str,
) -> Result<Vec<ConnectionInfo>, RabbitError> {
    let all = list_connections(client).await?;
    Ok(all
        .into_iter()
        .filter(|c| c.user.as_deref() == Some(user))
        .collect())
}

/// List connections originating from a specific peer address.
pub async fn list_connections_for_peer(
    client: &RabbitApiClient,
    peer_host: &str,
) -> Result<Vec<ConnectionInfo>, RabbitError> {
    let all = list_connections(client).await?;
    Ok(all
        .into_iter()
        .filter(|c| c.peer_host.as_deref() == Some(peer_host))
        .collect())
}

/// List connections on a specific node.
pub async fn list_connections_for_node(
    client: &RabbitApiClient,
    node: &str,
) -> Result<Vec<ConnectionInfo>, RabbitError> {
    let all = list_connections(client).await?;
    Ok(all
        .into_iter()
        .filter(|c| c.node.as_deref() == Some(node))
        .collect())
}

/// Close all connections for a specific user.
///
/// Returns the number of connections that were closed.
pub async fn close_connections_for_user(
    client: &RabbitApiClient,
    user: &str,
) -> Result<u32, RabbitError> {
    let conns = list_connections_for_user(client, user).await?;
    let mut closed = 0u32;
    for conn in &conns {
        close_connection(client, &conn.name).await?;
        closed += 1;
    }
    Ok(closed)
}

/// Close all connections for a specific vhost.
///
/// Returns the number of connections that were closed.
pub async fn close_connections_for_vhost(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<u32, RabbitError> {
    let conns = list_connections_for_vhost(client, vhost).await?;
    let mut closed = 0u32;
    for conn in &conns {
        close_connection(client, &conn.name).await?;
        closed += 1;
    }
    Ok(closed)
}

/// Get a summary of connection counts grouped by user.
pub async fn connection_count_by_user(
    client: &RabbitApiClient,
) -> Result<std::collections::HashMap<String, usize>, RabbitError> {
    let all = list_connections(client).await?;
    let mut counts = std::collections::HashMap::new();
    for conn in &all {
        let user = conn.user.as_deref().unwrap_or("unknown").to_string();
        *counts.entry(user).or_insert(0) += 1;
    }
    Ok(counts)
}

/// Get a summary of connection counts grouped by vhost.
pub async fn connection_count_by_vhost(
    client: &RabbitApiClient,
) -> Result<std::collections::HashMap<String, usize>, RabbitError> {
    let all = list_connections(client).await?;
    let mut counts = std::collections::HashMap::new();
    for conn in &all {
        let vhost = conn.vhost.as_deref().unwrap_or("unknown").to_string();
        *counts.entry(vhost).or_insert(0) += 1;
    }
    Ok(counts)
}

/// Get total send/receive byte counts across all connections.
pub async fn connection_traffic_totals(
    client: &RabbitApiClient,
) -> Result<serde_json::Value, RabbitError> {
    let all = list_connections(client).await?;
    let mut total_recv: u64 = 0;
    let mut total_send: u64 = 0;
    let count = all.len() as u64;
    for conn in &all {
        total_recv += conn.recv_oct.unwrap_or(0);
        total_send += conn.send_oct.unwrap_or(0);
    }
    Ok(serde_json::json!({
        "connection_count": count,
        "total_recv_bytes": total_recv,
        "total_send_bytes": total_send,
    }))
}
