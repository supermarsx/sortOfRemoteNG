use std::collections::HashMap;

use crate::client::RabbitApiClient;
use crate::error::RabbitError;
use crate::types::{BindingCreateRequest, BindingInfo};

/// List all bindings in a vhost.
pub async fn list_bindings(
    client: &RabbitApiClient,
    vhost: Option<&str>,
) -> Result<Vec<BindingInfo>, RabbitError> {
    match vhost {
        Some(v) => {
            let encoded = RabbitApiClient::encode_path_segment(v);
            client.get(&format!("bindings/{}", encoded)).await
        }
        None => client.get("bindings").await,
    }
}

/// List all bindings for a specific queue.
pub async fn list_queue_bindings(
    client: &RabbitApiClient,
    vhost: &str,
    queue: &str,
) -> Result<Vec<BindingInfo>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let eq = RabbitApiClient::encode_path_segment(queue);
    client
        .get(&format!("queues/{}/{}/bindings", ev, eq))
        .await
}

/// Create a binding from a source exchange to a destination (queue or exchange).
///
/// `dest_type` should be `"q"` for queue or `"e"` for exchange.
pub async fn create_binding(
    client: &RabbitApiClient,
    vhost: &str,
    source: &str,
    destination: &str,
    dest_type: &str,
    routing_key: &str,
    arguments: Option<HashMap<String, serde_json::Value>>,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let es = RabbitApiClient::encode_path_segment(source);
    let ed = RabbitApiClient::encode_path_segment(destination);

    let body = BindingCreateRequest {
        routing_key: routing_key.to_string(),
        arguments: arguments.unwrap_or_default(),
    };

    // POST /api/bindings/vhost/e/source/[eq]/destination
    let dt = match dest_type {
        "e" | "exchange" => "e",
        _ => "q",
    };

    client
        .post_no_content(
            &format!("bindings/{}/e/{}/{}/{}", ev, es, dt, ed),
            &body,
        )
        .await
}

/// Delete a specific binding identified by its properties_key.
///
/// The `properties_key` uniquely identifies a binding between a source and
/// destination with specific routing key and arguments. It is returned in
/// the binding info from the API.
pub async fn delete_binding(
    client: &RabbitApiClient,
    vhost: &str,
    source: &str,
    destination: &str,
    dest_type: &str,
    properties_key: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let es = RabbitApiClient::encode_path_segment(source);
    let ed = RabbitApiClient::encode_path_segment(destination);
    let ep = RabbitApiClient::encode_path_segment(properties_key);

    let dt = match dest_type {
        "e" | "exchange" => "e",
        _ => "q",
    };

    client
        .delete(&format!(
            "bindings/{}/e/{}/{}/{}/{}",
            ev, es, dt, ed, ep
        ))
        .await
}

/// List bindings where a specific exchange is the source.
pub async fn list_exchange_bindings_source(
    client: &RabbitApiClient,
    vhost: &str,
    exchange: &str,
) -> Result<Vec<BindingInfo>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let ee = RabbitApiClient::encode_path_segment(exchange);
    client
        .get(&format!("exchanges/{}/{}/bindings/source", ev, ee))
        .await
}

/// List bindings where a specific exchange is the destination.
pub async fn list_exchange_bindings_destination(
    client: &RabbitApiClient,
    vhost: &str,
    exchange: &str,
) -> Result<Vec<BindingInfo>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let ee = RabbitApiClient::encode_path_segment(exchange);
    client
        .get(&format!("exchanges/{}/{}/bindings/destination", ev, ee))
        .await
}

/// List all bindings between a specific source exchange and destination exchange.
pub async fn list_exchange_to_exchange_bindings(
    client: &RabbitApiClient,
    vhost: &str,
    source: &str,
    destination: &str,
) -> Result<Vec<BindingInfo>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let es = RabbitApiClient::encode_path_segment(source);
    let ed = RabbitApiClient::encode_path_segment(destination);
    client
        .get(&format!("bindings/{}/e/{}/e/{}", ev, es, ed))
        .await
}

/// List all bindings between a specific source exchange and destination queue.
pub async fn list_exchange_to_queue_bindings(
    client: &RabbitApiClient,
    vhost: &str,
    source: &str,
    queue: &str,
) -> Result<Vec<BindingInfo>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let es = RabbitApiClient::encode_path_segment(source);
    let eq = RabbitApiClient::encode_path_segment(queue);
    client
        .get(&format!("bindings/{}/e/{}/q/{}", ev, es, eq))
        .await
}
