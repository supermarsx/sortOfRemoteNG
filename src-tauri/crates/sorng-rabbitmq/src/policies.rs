use crate::client::RabbitApiClient;
use crate::error::RabbitError;
use crate::types::{PolicyCreateRequest, PolicyInfo};

/// List all policies in a vhost.
pub async fn list_policies(
    client: &RabbitApiClient,
    vhost: Option<&str>,
) -> Result<Vec<PolicyInfo>, RabbitError> {
    match vhost {
        Some(v) => {
            let encoded = RabbitApiClient::encode_path_segment(v);
            client.get(&format!("policies/{}", encoded)).await
        }
        None => client.get("policies").await,
    }
}

/// Get a specific policy.
pub async fn get_policy(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<PolicyInfo, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("policies/{}/{}", ev, en)).await
}

/// Create or update a policy.
pub async fn create_policy(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    pattern: &str,
    definition: serde_json::Value,
    priority: i64,
    apply_to: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let body = PolicyCreateRequest {
        pattern: pattern.to_string(),
        definition,
        priority,
        apply_to: apply_to.to_string(),
    };
    client
        .put_no_content(&format!("policies/{}/{}", ev, en), &body)
        .await
}

/// Delete a policy.
pub async fn delete_policy(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client.delete(&format!("policies/{}/{}", ev, en)).await
}

/// List all operator policies in a vhost.
pub async fn list_operator_policies(
    client: &RabbitApiClient,
    vhost: Option<&str>,
) -> Result<Vec<PolicyInfo>, RabbitError> {
    match vhost {
        Some(v) => {
            let encoded = RabbitApiClient::encode_path_segment(v);
            client.get(&format!("operator-policies/{}", encoded)).await
        }
        None => client.get("operator-policies").await,
    }
}

/// Get a specific operator policy.
pub async fn get_operator_policy(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<PolicyInfo, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .get(&format!("operator-policies/{}/{}", ev, en))
        .await
}

/// Create or update an operator policy.
pub async fn create_operator_policy(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    pattern: &str,
    definition: serde_json::Value,
    priority: i64,
    apply_to: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let body = PolicyCreateRequest {
        pattern: pattern.to_string(),
        definition,
        priority,
        apply_to: apply_to.to_string(),
    };
    client
        .put_no_content(&format!("operator-policies/{}/{}", ev, en), &body)
        .await
}

/// Delete an operator policy.
pub async fn delete_operator_policy(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .delete(&format!("operator-policies/{}/{}", ev, en))
        .await
}

/// List all runtime parameters (global scope).
pub async fn list_global_parameters(
    client: &RabbitApiClient,
) -> Result<Vec<serde_json::Value>, RabbitError> {
    client.get("global-parameters").await
}

/// Get a specific global parameter.
pub async fn get_global_parameter(
    client: &RabbitApiClient,
    name: &str,
) -> Result<serde_json::Value, RabbitError> {
    let en = RabbitApiClient::encode_path_segment(name);
    client.get(&format!("global-parameters/{}", en)).await
}

/// Set a global parameter.
pub async fn set_global_parameter(
    client: &RabbitApiClient,
    name: &str,
    value: serde_json::Value,
) -> Result<(), RabbitError> {
    let en = RabbitApiClient::encode_path_segment(name);
    let body = serde_json::json!({
        "name": name,
        "value": value,
    });
    client
        .put_no_content(&format!("global-parameters/{}", en), &body)
        .await
}

/// Delete a global parameter.
pub async fn delete_global_parameter(
    client: &RabbitApiClient,
    name: &str,
) -> Result<(), RabbitError> {
    let en = RabbitApiClient::encode_path_segment(name);
    client.delete(&format!("global-parameters/{}", en)).await
}
