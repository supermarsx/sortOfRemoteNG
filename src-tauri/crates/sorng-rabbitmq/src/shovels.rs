use crate::client::RabbitApiClient;
use crate::error::{RabbitError, RabbitErrorKind};
use crate::types::{ShovelDefinition, ShovelInfo, ShovelParameterValue};

// ---------------------------------------------------------------------------
// Shovel CRUD & status
// ---------------------------------------------------------------------------

/// List all shovels across all vhosts, or filtered to a specific vhost.
pub async fn list_shovels(
    client: &RabbitApiClient,
    vhost: Option<&str>,
) -> Result<Vec<ShovelInfo>, RabbitError> {
    match vhost {
        Some(v) => {
            let encoded = RabbitApiClient::encode_path_segment(v);
            client.get(&format!("shovels/{}", encoded)).await
        }
        None => client.get("shovels").await,
    }
}

/// Get details of a specific shovel.
pub async fn get_shovel(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<ShovelInfo, RabbitError> {
    let shovels = list_shovels(client, Some(vhost)).await?;
    shovels
        .into_iter()
        .find(|s| s.name == name)
        .ok_or_else(|| {
            RabbitError::new(
                RabbitErrorKind::ShovelError,
                format!("Shovel not found: {}/{}", vhost, name),
            )
        })
}

/// Create a dynamic shovel by setting a runtime parameter.
///
/// The shovel is created via `PUT /api/parameters/shovel/{vhost}/{name}`.
pub async fn create_shovel(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    definition: ShovelDefinition,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let body = ShovelParameterValue { value: definition };
    client
        .put_no_content(&format!("parameters/shovel/{}/{}", ev, en), &body)
        .await
}

/// Update an existing shovel definition.
///
/// This is identical to `create_shovel` — the management API uses PUT
/// semantics (create-or-update) for parameters.
pub async fn update_shovel(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    definition: ShovelDefinition,
) -> Result<(), RabbitError> {
    create_shovel(client, vhost, name, definition).await
}

/// Delete a dynamic shovel.
pub async fn delete_shovel(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .delete(&format!("parameters/shovel/{}/{}", ev, en))
        .await
}

/// Restart a shovel by deleting and re-creating it with the same definition.
///
/// The management API does not expose a direct restart endpoint, so we read
/// the current definition, delete, and re-create.
pub async fn restart_shovel(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);

    // Fetch the current parameter
    let param: serde_json::Value = client
        .get(&format!("parameters/shovel/{}/{}", ev, en))
        .await?;

    // Delete the shovel
    client
        .delete(&format!("parameters/shovel/{}/{}", ev, en))
        .await?;

    // Re-create with the same parameter body
    client
        .put_no_content(&format!("parameters/shovel/{}/{}", ev, en), &param)
        .await
}

/// Get the runtime status of all shovels in a vhost.
///
/// Returns the same data as `list_shovels` but is specifically intended
/// for monitoring — the `status` field on each `ShovelInfo` indicates
/// whether the shovel is `running`, `starting`, `terminated`, etc.
pub async fn get_shovel_status(
    client: &RabbitApiClient,
    vhost: Option<&str>,
) -> Result<Vec<ShovelInfo>, RabbitError> {
    // The /api/shovels endpoint already includes status information.
    list_shovels(client, vhost).await
}

/// Get the runtime status of a single named shovel.
pub async fn get_single_shovel_status(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<ShovelInfo, RabbitError> {
    get_shovel(client, vhost, name).await
}

/// List all shovel parameters (raw JSON) for a vhost.
///
/// This returns the parameter objects from `/api/parameters/shovel/{vhost}`
/// which include the full definition, as opposed to the status view from
/// `/api/shovels`.
pub async fn list_shovel_parameters(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<Vec<serde_json::Value>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    client.get(&format!("parameters/shovel/{}", ev)).await
}

/// Get a single shovel parameter (raw JSON).
pub async fn get_shovel_parameter(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<serde_json::Value, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .get(&format!("parameters/shovel/{}/{}", ev, en))
        .await
}

/// Create a shovel from raw JSON (for advanced / custom configurations).
pub async fn create_shovel_raw(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    parameter: &serde_json::Value,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .put_no_content(&format!("parameters/shovel/{}/{}", ev, en), parameter)
        .await
}

/// Check whether all shovels in a vhost are in a healthy ("running") state.
pub async fn all_shovels_healthy(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<bool, RabbitError> {
    let shovels = list_shovels(client, Some(vhost)).await?;
    Ok(shovels
        .iter()
        .all(|s| s.status.as_deref() == Some("running")))
}

/// Count shovels grouped by status for a vhost.
pub async fn shovel_status_summary(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<std::collections::HashMap<String, usize>, RabbitError> {
    let shovels = list_shovels(client, Some(vhost)).await?;
    let mut counts = std::collections::HashMap::new();
    for s in &shovels {
        let status = s
            .status
            .as_deref()
            .unwrap_or("unknown")
            .to_string();
        *counts.entry(status).or_insert(0) += 1;
    }
    Ok(counts)
}
