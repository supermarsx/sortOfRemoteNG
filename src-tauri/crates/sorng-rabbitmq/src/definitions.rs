use crate::client::RabbitApiClient;
use crate::error::{RabbitError, RabbitErrorKind};
use crate::types::DefinitionsExport;

// ---------------------------------------------------------------------------
// Full broker definitions export / import
// ---------------------------------------------------------------------------

/// Export the complete broker definitions (all vhosts).
///
/// Returns users, vhosts, permissions, parameters, policies, queues,
/// exchanges, and bindings as a single JSON document.
pub async fn export_definitions(
    client: &RabbitApiClient,
) -> Result<DefinitionsExport, RabbitError> {
    client.get("definitions").await
}

/// Import a full set of broker definitions.
///
/// Existing objects that match by name will be updated (merged).
/// Objects present on the broker but absent from the import are **not** deleted.
pub async fn import_definitions(
    client: &RabbitApiClient,
    definitions: &DefinitionsExport,
) -> Result<(), RabbitError> {
    client
        .post_no_content("definitions", definitions)
        .await
}

/// Import definitions from a raw JSON value.
///
/// Useful when the caller has already-parsed JSON or wants to import
/// a subset of a definitions file.
pub async fn import_definitions_raw(
    client: &RabbitApiClient,
    json: &serde_json::Value,
) -> Result<(), RabbitError> {
    client.post_no_content("definitions", json).await
}

// ---------------------------------------------------------------------------
// Per-vhost definitions export / import
// ---------------------------------------------------------------------------

/// Export definitions for a single vhost.
///
/// Returns queues, exchanges, bindings, and policies scoped to that vhost.
pub async fn export_vhost_definitions(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<serde_json::Value, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    client.get(&format!("definitions/{}", ev)).await
}

/// Import definitions into a single vhost.
pub async fn import_vhost_definitions(
    client: &RabbitApiClient,
    vhost: &str,
    definitions: &serde_json::Value,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    client
        .post_no_content(&format!("definitions/{}", ev), definitions)
        .await
}

// ---------------------------------------------------------------------------
// Clone / replicate a vhost
// ---------------------------------------------------------------------------

/// Clone the definitions from one vhost to another.
///
/// Exports queues, exchanges, bindings, and policies from `source_vhost`
/// and imports them into `target_vhost`. The target vhost must already exist.
///
/// This does **not** copy messages — only the topology.
pub async fn clone_vhost(
    client: &RabbitApiClient,
    source_vhost: &str,
    target_vhost: &str,
) -> Result<(), RabbitError> {
    if source_vhost == target_vhost {
        return Err(RabbitError::new(
            RabbitErrorKind::DefinitionError,
            "Source and target vhosts must be different",
        ));
    }

    let defs = export_vhost_definitions(client, source_vhost).await?;
    import_vhost_definitions(client, target_vhost, &defs).await
}

// ---------------------------------------------------------------------------
// Helpers for selective export / import
// ---------------------------------------------------------------------------

/// Export definitions as a pretty-printed JSON string.
pub async fn export_definitions_json(
    client: &RabbitApiClient,
) -> Result<String, RabbitError> {
    let defs = export_definitions(client).await?;
    serde_json::to_string_pretty(&defs).map_err(|e| {
        RabbitError::new(RabbitErrorKind::SerializationError, e.to_string())
    })
}

/// Export vhost definitions as a pretty-printed JSON string.
pub async fn export_vhost_definitions_json(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<String, RabbitError> {
    let defs = export_vhost_definitions(client, vhost).await?;
    serde_json::to_string_pretty(&defs).map_err(|e| {
        RabbitError::new(RabbitErrorKind::SerializationError, e.to_string())
    })
}

/// Parse a JSON string into a `DefinitionsExport`.
pub fn parse_definitions(json: &str) -> Result<DefinitionsExport, RabbitError> {
    serde_json::from_str(json).map_err(|e| {
        RabbitError::new(RabbitErrorKind::SerializationError, e.to_string())
    })
}

/// Import definitions from a JSON string.
pub async fn import_definitions_from_json(
    client: &RabbitApiClient,
    json: &str,
) -> Result<(), RabbitError> {
    let defs = parse_definitions(json)?;
    import_definitions(client, &defs).await
}

/// Validate a definitions document without importing it.
///
/// Checks that the JSON can be parsed into a `DefinitionsExport` and
/// reports what objects it contains.
pub fn validate_definitions(json: &str) -> Result<serde_json::Value, RabbitError> {
    let defs = parse_definitions(json)?;
    Ok(serde_json::json!({
        "valid": true,
        "rabbitmq_version": defs.rabbitmq_version,
        "users_count": defs.users.len(),
        "vhosts_count": defs.vhosts.len(),
        "permissions_count": defs.permissions.len(),
        "parameters_count": defs.parameters.len(),
        "policies_count": defs.policies.len(),
        "queues_count": defs.queues.len(),
        "exchanges_count": defs.exchanges.len(),
        "bindings_count": defs.bindings.len(),
    }))
}

/// Get a summary of the current broker definitions without the full data.
///
/// Returns counts of each object type.
pub async fn definitions_summary(
    client: &RabbitApiClient,
) -> Result<serde_json::Value, RabbitError> {
    let defs = export_definitions(client).await?;
    Ok(serde_json::json!({
        "rabbitmq_version": defs.rabbitmq_version,
        "users": defs.users.len(),
        "vhosts": defs.vhosts.len(),
        "permissions": defs.permissions.len(),
        "topic_permissions": defs.topic_permissions.len(),
        "parameters": defs.parameters.len(),
        "global_parameters": defs.global_parameters.len(),
        "policies": defs.policies.len(),
        "queues": defs.queues.len(),
        "exchanges": defs.exchanges.len(),
        "bindings": defs.bindings.len(),
    }))
}

/// Diff two definitions exports and return which objects differ.
///
/// Compares object counts and identifies categories that have changed.
pub fn diff_definitions(
    a: &DefinitionsExport,
    b: &DefinitionsExport,
) -> serde_json::Value {
    let mut diffs = Vec::new();

    if a.users.len() != b.users.len() {
        diffs.push(serde_json::json!({
            "category": "users",
            "a_count": a.users.len(),
            "b_count": b.users.len(),
        }));
    }
    if a.vhosts.len() != b.vhosts.len() {
        diffs.push(serde_json::json!({
            "category": "vhosts",
            "a_count": a.vhosts.len(),
            "b_count": b.vhosts.len(),
        }));
    }
    if a.permissions.len() != b.permissions.len() {
        diffs.push(serde_json::json!({
            "category": "permissions",
            "a_count": a.permissions.len(),
            "b_count": b.permissions.len(),
        }));
    }
    if a.parameters.len() != b.parameters.len() {
        diffs.push(serde_json::json!({
            "category": "parameters",
            "a_count": a.parameters.len(),
            "b_count": b.parameters.len(),
        }));
    }
    if a.policies.len() != b.policies.len() {
        diffs.push(serde_json::json!({
            "category": "policies",
            "a_count": a.policies.len(),
            "b_count": b.policies.len(),
        }));
    }
    if a.queues.len() != b.queues.len() {
        diffs.push(serde_json::json!({
            "category": "queues",
            "a_count": a.queues.len(),
            "b_count": b.queues.len(),
        }));
    }
    if a.exchanges.len() != b.exchanges.len() {
        diffs.push(serde_json::json!({
            "category": "exchanges",
            "a_count": a.exchanges.len(),
            "b_count": b.exchanges.len(),
        }));
    }
    if a.bindings.len() != b.bindings.len() {
        diffs.push(serde_json::json!({
            "category": "bindings",
            "a_count": a.bindings.len(),
            "b_count": b.bindings.len(),
        }));
    }

    serde_json::json!({
        "has_differences": !diffs.is_empty(),
        "differences": diffs,
    })
}
