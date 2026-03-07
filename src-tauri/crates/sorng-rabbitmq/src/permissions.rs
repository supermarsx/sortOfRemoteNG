use crate::client::RabbitApiClient;
use crate::error::RabbitError;
use crate::types::{PermissionInfo, TopicPermissionInfo};

/// List all permissions for all users across all vhosts.
pub async fn list_permissions(
    client: &RabbitApiClient,
) -> Result<Vec<PermissionInfo>, RabbitError> {
    client.get("permissions").await
}

/// Get the permissions for a specific user on a specific vhost.
pub async fn get_permission(
    client: &RabbitApiClient,
    vhost: &str,
    user: &str,
) -> Result<PermissionInfo, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let eu = RabbitApiClient::encode_path_segment(user);
    client
        .get(&format!("permissions/{}/{}", ev, eu))
        .await
}

/// Set permissions for a user on a vhost.
///
/// The `configure`, `write`, and `read` parameters are regex patterns
/// that match resource names (queues, exchanges, etc.).
pub async fn set_permission(
    client: &RabbitApiClient,
    vhost: &str,
    user: &str,
    configure: &str,
    write: &str,
    read: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let eu = RabbitApiClient::encode_path_segment(user);
    let body = serde_json::json!({
        "configure": configure,
        "write": write,
        "read": read,
    });
    client
        .put_no_content(&format!("permissions/{}/{}", ev, eu), &body)
        .await
}

/// Delete permissions for a user on a vhost.
pub async fn delete_permission(
    client: &RabbitApiClient,
    vhost: &str,
    user: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let eu = RabbitApiClient::encode_path_segment(user);
    client
        .delete(&format!("permissions/{}/{}", ev, eu))
        .await
}

/// List all topic permissions for all users.
pub async fn list_topic_permissions(
    client: &RabbitApiClient,
) -> Result<Vec<TopicPermissionInfo>, RabbitError> {
    client.get("topic-permissions").await
}

/// List topic permissions for a specific vhost.
pub async fn list_vhost_topic_permissions(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<Vec<TopicPermissionInfo>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    client
        .get(&format!("vhosts/{}/topic-permissions", ev))
        .await
}

/// Set topic permissions for a user on a vhost for a specific exchange.
///
/// The `write` and `read` parameters are regex patterns matching routing keys.
pub async fn set_topic_permission(
    client: &RabbitApiClient,
    vhost: &str,
    user: &str,
    exchange: &str,
    write: &str,
    read: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let eu = RabbitApiClient::encode_path_segment(user);
    let body = serde_json::json!({
        "exchange": exchange,
        "write": write,
        "read": read,
    });
    client
        .put_no_content(&format!("topic-permissions/{}/{}", ev, eu), &body)
        .await
}

/// Delete topic permissions for a user on a vhost.
pub async fn delete_topic_permission(
    client: &RabbitApiClient,
    vhost: &str,
    user: &str,
    exchange: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let eu = RabbitApiClient::encode_path_segment(user);
    let ee = RabbitApiClient::encode_path_segment(exchange);
    client
        .delete(&format!("topic-permissions/{}/{}/{}", ev, eu, ee))
        .await
}

/// Get all topic permissions for a specific user.
pub async fn get_user_topic_permissions(
    client: &RabbitApiClient,
    user: &str,
) -> Result<Vec<TopicPermissionInfo>, RabbitError> {
    let eu = RabbitApiClient::encode_path_segment(user);
    client
        .get(&format!("users/{}/topic-permissions", eu))
        .await
}
