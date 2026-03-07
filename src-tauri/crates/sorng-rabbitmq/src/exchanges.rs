use std::collections::HashMap;

use crate::client::RabbitApiClient;
use crate::error::RabbitError;
use crate::types::{BindingInfo, ExchangeCreateRequest, ExchangeInfo, PublishMessage, PublishProperties};

/// List all exchanges, optionally filtered to a specific vhost.
pub async fn list_exchanges(
    client: &RabbitApiClient,
    vhost: Option<&str>,
) -> Result<Vec<ExchangeInfo>, RabbitError> {
    match vhost {
        Some(v) => {
            let encoded = RabbitApiClient::encode_path_segment(v);
            client.get(&format!("exchanges/{}", encoded)).await
        }
        None => client.get("exchanges").await,
    }
}

/// Get details of a single exchange.
pub async fn get_exchange(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<ExchangeInfo, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("exchanges/{}/{}", ev, en)).await
}

/// Declare (create) an exchange.
pub async fn create_exchange(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    exchange_type: &str,
    durable: bool,
    auto_delete: bool,
    internal: bool,
    arguments: Option<HashMap<String, serde_json::Value>>,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let body = ExchangeCreateRequest {
        exchange_type: exchange_type.to_string(),
        durable,
        auto_delete,
        internal,
        arguments: arguments.unwrap_or_default(),
    };
    client
        .put_no_content(&format!("exchanges/{}/{}", ev, en), &body)
        .await
}

/// Delete an exchange.
pub async fn delete_exchange(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    if_unused: bool,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let query = if if_unused { "if-unused=true" } else { "" };
    client
        .delete_with_query(&format!("exchanges/{}/{}", ev, en), query)
        .await
}

/// Publish a message to an exchange via the management API.
///
/// Note: this is intended for management / testing purposes, not high-throughput
/// publishing. Use an AMQP client library for production publishing.
pub async fn publish_message(
    client: &RabbitApiClient,
    vhost: &str,
    exchange: &str,
    routing_key: &str,
    payload: &str,
    properties: Option<PublishProperties>,
) -> Result<serde_json::Value, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(exchange);

    let props = properties.unwrap_or(PublishProperties {
        content_type: Some("text/plain".to_string()),
        content_encoding: None,
        delivery_mode: Some(2),
        priority: None,
        correlation_id: None,
        reply_to: None,
        expiration: None,
        message_id: None,
        timestamp: None,
        headers: None,
    });

    let msg = PublishMessage {
        routing_key: routing_key.to_string(),
        payload: payload.to_string(),
        payload_encoding: "string".to_string(),
        properties: props,
    };

    client
        .post_json(
            &format!("exchanges/{}/{}/publish", ev, en),
            &serde_json::to_value(&msg).unwrap_or_default(),
        )
        .await
}

/// List bindings where this exchange is the source.
pub async fn get_exchange_bindings_source(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<Vec<BindingInfo>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .get(&format!("exchanges/{}/{}/bindings/source", ev, en))
        .await
}

/// List bindings where this exchange is the destination.
pub async fn get_exchange_bindings_destination(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<Vec<BindingInfo>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .get(&format!("exchanges/{}/{}/bindings/destination", ev, en))
        .await
}

/// List all exchange types available on the broker.
pub async fn list_exchange_types(
    client: &RabbitApiClient,
) -> Result<Vec<serde_json::Value>, RabbitError> {
    // Included in overview, but can also be fetched from the node
    let overview: serde_json::Value = client.get("overview").await?;
    Ok(overview
        .get("exchange_types")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default())
}
