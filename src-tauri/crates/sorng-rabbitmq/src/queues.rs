use std::collections::HashMap;

use crate::client::RabbitApiClient;
use crate::error::RabbitError;
use crate::types::{BindingInfo, GetMessagesRequest, QueueCreateRequest, QueueInfo, QueueMessage};

/// List all queues, optionally filtered to a specific vhost.
pub async fn list_queues(
    client: &RabbitApiClient,
    vhost: Option<&str>,
) -> Result<Vec<QueueInfo>, RabbitError> {
    match vhost {
        Some(v) => {
            let encoded = RabbitApiClient::encode_path_segment(v);
            client.get(&format!("queues/{}", encoded)).await
        }
        None => client.get("queues").await,
    }
}

/// Get details of a single queue.
pub async fn get_queue(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<QueueInfo, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("queues/{}/{}", ev, en)).await
}

/// Declare (create) a queue.
pub async fn create_queue(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    durable: bool,
    auto_delete: bool,
    queue_type: Option<&str>,
    arguments: Option<HashMap<String, serde_json::Value>>,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);

    let mut args = arguments.unwrap_or_default();
    if let Some(qt) = queue_type {
        args.insert(
            "x-queue-type".to_string(),
            serde_json::Value::String(qt.to_string()),
        );
    }

    let body = QueueCreateRequest {
        durable,
        auto_delete,
        arguments: args,
    };
    client
        .put_no_content(&format!("queues/{}/{}", ev, en), &body)
        .await
}

/// Delete a queue.
pub async fn delete_queue(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    if_unused: bool,
    if_empty: bool,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);

    let mut params = Vec::new();
    if if_unused {
        params.push("if-unused=true");
    }
    if if_empty {
        params.push("if-empty=true");
    }
    let query = params.join("&");
    client
        .delete_with_query(&format!("queues/{}/{}", ev, en), &query)
        .await
}

/// Purge all messages from a queue.
pub async fn purge_queue(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .delete(&format!("queues/{}/{}/contents", ev, en))
        .await
}

/// Get messages from a queue without removing them (peek).
pub async fn get_messages(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    count: u32,
    ack_mode: &str,
    encoding: &str,
) -> Result<Vec<QueueMessage>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);

    let body = GetMessagesRequest {
        count,
        ack_mode: ack_mode.to_string(),
        encoding: encoding.to_string(),
        truncate: None,
    };

    client
        .post_json(
            &format!("queues/{}/{}/get", ev, en),
            &serde_json::to_value(&body).unwrap_or_default(),
        )
        .await
}

/// List bindings for a specific queue.
pub async fn get_queue_bindings(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<Vec<BindingInfo>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("queues/{}/{}/bindings", ev, en)).await
}

/// Pause a quorum queue (sets the queue into a paused state).
///
/// This works by setting a policy or using the actions endpoint depending
/// on the RabbitMQ version. The management API /queues/vhost/name/actions
/// endpoint is used.
pub async fn pause_queue(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let body = serde_json::json!({ "action": "pause" });
    client
        .post_no_content(&format!("queues/{}/{}/actions", ev, en), &body)
        .await
}

/// Resume a paused quorum queue.
pub async fn resume_queue(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let body = serde_json::json!({ "action": "resume" });
    client
        .post_no_content(&format!("queues/{}/{}/actions", ev, en), &body)
        .await
}

/// Update queue properties by setting optional arguments via a policy or
/// direct API manipulation. This is a convenience wrapper that sets queue
/// arguments via the management API.
#[allow(clippy::too_many_arguments)]
pub async fn set_queue_properties(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    max_length: Option<i64>,
    max_length_bytes: Option<i64>,
    message_ttl: Option<u64>,
    overflow: Option<&str>,
    dead_letter_exchange: Option<&str>,
    dead_letter_routing_key: Option<&str>,
) -> Result<(), RabbitError> {
    // Fetch existing queue to preserve its settings
    let queue = get_queue(client, vhost, name).await?;
    let mut args = queue.arguments;

    if let Some(ml) = max_length {
        args.insert("x-max-length".to_string(), serde_json::json!(ml));
    }
    if let Some(mlb) = max_length_bytes {
        args.insert("x-max-length-bytes".to_string(), serde_json::json!(mlb));
    }
    if let Some(ttl) = message_ttl {
        args.insert("x-message-ttl".to_string(), serde_json::json!(ttl));
    }
    if let Some(of) = overflow {
        args.insert("x-overflow".to_string(), serde_json::json!(of));
    }
    if let Some(dle) = dead_letter_exchange {
        args.insert("x-dead-letter-exchange".to_string(), serde_json::json!(dle));
    }
    if let Some(dlrk) = dead_letter_routing_key {
        args.insert(
            "x-dead-letter-routing-key".to_string(),
            serde_json::json!(dlrk),
        );
    }

    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let body = QueueCreateRequest {
        durable: queue.durable,
        auto_delete: queue.auto_delete,
        arguments: args,
    };
    client
        .put_no_content(&format!("queues/{}/{}", ev, en), &body)
        .await
}

/// Trigger mirror synchronisation for a classic mirrored queue.
pub async fn sync_queue(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let body = serde_json::json!({ "action": "sync" });
    client
        .post_no_content(&format!("queues/{}/{}/actions", ev, en), &body)
        .await
}

/// Cancel an in-progress mirror synchronisation.
pub async fn cancel_sync_queue(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let body = serde_json::json!({ "action": "cancel_sync" });
    client
        .post_no_content(&format!("queues/{}/{}/actions", ev, en), &body)
        .await
}

/// Get the effective policy definition applied to a queue.
pub async fn get_queue_effective_policy(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<Option<serde_json::Value>, RabbitError> {
    let queue = get_queue(client, vhost, name).await?;
    Ok(queue.effective_policy_definition)
}

/// Delete a queue member from a quorum queue (force leader election, etc.).
pub async fn delete_queue_member(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    node: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .delete(&format!(
            "queues/{}/{}/replicas/delete/{}",
            ev,
            en,
            RabbitApiClient::encode_path_segment(node)
        ))
        .await
}

/// Add a member node to a quorum queue.
pub async fn add_queue_member(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    node: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let body = serde_json::json!({ "node": node });
    client
        .post_no_content(&format!("queues/{}/{}/replicas/add", ev, en), &body)
        .await
}
