use crate::client::RabbitApiClient;
use crate::error::RabbitError;
use crate::types::{
    ChannelInfo, ConnectionInfo, PermissionInfo, TopicPermissionInfo, UserCreateRequest,
    UserInfo, UserLimits,
};

/// List all users.
pub async fn list_users(client: &RabbitApiClient) -> Result<Vec<UserInfo>, RabbitError> {
    client.get("users").await
}

/// Get details of a single user.
pub async fn get_user(
    client: &RabbitApiClient,
    name: &str,
) -> Result<UserInfo, RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("users/{}", encoded)).await
}

/// Create a new user.
pub async fn create_user(
    client: &RabbitApiClient,
    name: &str,
    password: &str,
    tags: &str,
) -> Result<(), RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    let body = UserCreateRequest {
        password: password.to_string(),
        tags: tags.to_string(),
    };
    client
        .put_no_content(&format!("users/{}", encoded), &body)
        .await
}

/// Update an existing user's password and/or tags.
pub async fn update_user(
    client: &RabbitApiClient,
    name: &str,
    password: Option<&str>,
    tags: &str,
) -> Result<(), RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);

    let body = if let Some(pwd) = password {
        serde_json::json!({
            "password": pwd,
            "tags": tags,
        })
    } else {
        serde_json::json!({
            "tags": tags,
        })
    };

    client
        .put_no_content(&format!("users/{}", encoded), &body)
        .await
}

/// Delete a user.
pub async fn delete_user(
    client: &RabbitApiClient,
    name: &str,
) -> Result<(), RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client.delete(&format!("users/{}", encoded)).await
}

/// List all permissions granted to a user across all vhosts.
pub async fn list_user_permissions(
    client: &RabbitApiClient,
    name: &str,
) -> Result<Vec<PermissionInfo>, RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client
        .get(&format!("users/{}/permissions", encoded))
        .await
}

/// List all topic permissions granted to a user.
pub async fn list_user_topic_permissions(
    client: &RabbitApiClient,
    name: &str,
) -> Result<Vec<TopicPermissionInfo>, RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client
        .get(&format!("users/{}/topic-permissions", encoded))
        .await
}

/// List all connections belonging to a user.
pub async fn get_user_connections(
    client: &RabbitApiClient,
    name: &str,
) -> Result<Vec<ConnectionInfo>, RabbitError> {
    // The management API doesn't have a direct /users/{name}/connections endpoint.
    // We filter connections by user.
    let all_conns: Vec<ConnectionInfo> = client.get("connections").await?;
    Ok(all_conns
        .into_iter()
        .filter(|c| c.user.as_deref() == Some(name))
        .collect())
}

/// List all channels belonging to a user.
pub async fn get_user_channels(
    client: &RabbitApiClient,
    name: &str,
) -> Result<Vec<ChannelInfo>, RabbitError> {
    let all_channels: Vec<ChannelInfo> = client.get("channels").await?;
    Ok(all_channels
        .into_iter()
        .filter(|c| c.user.as_deref() == Some(name))
        .collect())
}

/// Get the currently authenticated user's information.
pub async fn who_am_i(client: &RabbitApiClient) -> Result<UserInfo, RabbitError> {
    client.get("whoami").await
}

/// Bulk-delete multiple users.
pub async fn bulk_delete_users(
    client: &RabbitApiClient,
    names: &[String],
) -> Result<(), RabbitError> {
    let body = serde_json::json!({ "users": names });
    client.post_no_content("users/bulk-delete", &body).await
}

/// Set per-user resource limits.
pub async fn set_user_limits(
    client: &RabbitApiClient,
    name: &str,
    max_connections: Option<i64>,
    max_channels: Option<i64>,
) -> Result<(), RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);

    if let Some(mc) = max_connections {
        let body = serde_json::json!({ "value": mc });
        client
            .put_no_content(
                &format!("user-limits/{}/max-connections", encoded),
                &body,
            )
            .await?;
    }

    if let Some(mch) = max_channels {
        let body = serde_json::json!({ "value": mch });
        client
            .put_no_content(
                &format!("user-limits/{}/max-channels", encoded),
                &body,
            )
            .await?;
    }

    Ok(())
}

/// Get current limits for a user.
pub async fn get_user_limits(
    client: &RabbitApiClient,
    name: &str,
) -> Result<Vec<UserLimits>, RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client
        .get(&format!("user-limits/{}", encoded))
        .await
}

/// Delete all limits for a user.
pub async fn delete_user_limits(
    client: &RabbitApiClient,
    name: &str,
) -> Result<(), RabbitError> {
    let encoded = RabbitApiClient::encode_path_segment(name);
    client
        .delete(&format!("user-limits/{}", encoded))
        .await
}
