use crate::client::RabbitApiClient;
use crate::error::RabbitError;
use crate::types::{PermissionInfo, VhostCreateRequest, VhostInfo, VhostLimits};

/// List all virtual hosts.
pub async fn list_vhosts(client: &RabbitApiClient) -> Result<Vec<VhostInfo>, RabbitError> {
    client.get("vhosts").await
}

/// Get details of a single virtual host.
pub async fn get_vhost(client: &RabbitApiClient, name: &str) -> Result<VhostInfo, RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("vhosts/{}", encoded)).await
}

/// Create or update a virtual host.
pub async fn create_vhost(
    client: &RabbitApiClient,
    name: &str,
    description: Option<&str>,
    tags: Option<&str>,
    default_queue_type: Option<&str>,
    tracing: Option<bool>,
) -> Result<(), RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    let body = VhostCreateRequest {
        description: description.map(String::from),
        tags: tags.map(String::from),
        default_queue_type: default_queue_type.map(String::from),
        tracing,
    };
    client
        .put_no_content(&format!("vhosts/{}", encoded), &body)
        .await
}

/// Delete a virtual host and all its resources.
pub async fn delete_vhost(client: &RabbitApiClient, name: &str) -> Result<(), RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client.delete(&format!("vhosts/{}", encoded)).await
}

/// List all permissions for a particular virtual host.
pub async fn get_vhost_permissions(
    client: &RabbitApiClient,
    name: &str,
) -> Result<Vec<PermissionInfo>, RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("vhosts/{}/permissions", encoded)).await
}

/// Set resource limits on a virtual host (max connections, max queues).
pub async fn set_vhost_limits(
    client: &RabbitApiClient,
    name: &str,
    max_connections: Option<i64>,
    max_queues: Option<i64>,
) -> Result<(), RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);

    if let Some(mc) = max_connections {
        let body = serde_json::json!({ "value": mc });
        client
            .put_no_content(&format!("vhost-limits/{}/max-connections", encoded), &body)
            .await?;
    }

    if let Some(mq) = max_queues {
        let body = serde_json::json!({ "value": mq });
        client
            .put_no_content(&format!("vhost-limits/{}/max-queues", encoded), &body)
            .await?;
    }

    Ok(())
}

/// Get the current resource limits for a virtual host.
pub async fn get_vhost_limits(
    client: &RabbitApiClient,
    name: &str,
) -> Result<Vec<VhostLimits>, RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("vhost-limits/{}", encoded)).await
}

/// Clear all limits from a virtual host.
pub async fn delete_vhost_limits(client: &RabbitApiClient, name: &str) -> Result<(), RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client.delete(&format!("vhost-limits/{}", encoded)).await
}

/// Start a vhost on a particular node.
pub async fn start_vhost_on_node(
    client: &RabbitApiClient,
    vhost: &str,
    node: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(node);
    client
        .post_no_content(
            &format!("vhosts/{}/start/{}", ev, en),
            &serde_json::Value::Object(serde_json::Map::new()),
        )
        .await
}

/// Get topic permissions for a vhost.
pub async fn get_vhost_topic_permissions(
    client: &RabbitApiClient,
    name: &str,
) -> Result<Vec<crate::types::TopicPermissionInfo>, RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client
        .get(&format!("vhosts/{}/topic-permissions", encoded))
        .await
}
