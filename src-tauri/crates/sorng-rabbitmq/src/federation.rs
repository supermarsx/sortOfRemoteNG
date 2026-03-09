use crate::client::RabbitApiClient;
use crate::error::{RabbitError, RabbitErrorKind};
use crate::types::{FederationLink, FederationUpstream, FederationUpstreamDef};

// ---------------------------------------------------------------------------
// Federation upstream management
// ---------------------------------------------------------------------------

/// List all federation upstreams across all vhosts.
pub async fn list_upstreams(
    client: &RabbitApiClient,
) -> Result<Vec<FederationUpstream>, RabbitError> {
    client.get("parameters/federation-upstream").await
}

/// List federation upstreams for a specific vhost.
pub async fn list_upstreams_for_vhost(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<Vec<FederationUpstream>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    client
        .get(&format!("parameters/federation-upstream/{}", ev))
        .await
}

/// Get a single federation upstream by name.
pub async fn get_upstream(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<FederationUpstream, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .get(&format!("parameters/federation-upstream/{}/{}", ev, en))
        .await
}

/// Create or update a federation upstream.
///
/// Uses `PUT /api/parameters/federation-upstream/{vhost}/{name}`.
pub async fn create_upstream(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    definition: FederationUpstreamDef,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let body = serde_json::json!({ "value": definition });
    client
        .put_no_content(
            &format!("parameters/federation-upstream/{}/{}", ev, en),
            &body,
        )
        .await
}

/// Update an existing federation upstream (same semantics as create —
/// the management API uses PUT for create-or-update).
pub async fn update_upstream(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    definition: FederationUpstreamDef,
) -> Result<(), RabbitError> {
    create_upstream(client, vhost, name, definition).await
}

/// Delete a federation upstream.
pub async fn delete_upstream(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .delete(&format!("parameters/federation-upstream/{}/{}", ev, en))
        .await
}

// ---------------------------------------------------------------------------
// Federation upstream sets
// ---------------------------------------------------------------------------

/// List all federation upstream sets for a vhost.
pub async fn list_upstream_sets(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<Vec<serde_json::Value>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    client
        .get(&format!("parameters/federation-upstream-set/{}", ev))
        .await
}

/// Get a specific federation upstream set.
pub async fn get_upstream_set(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<serde_json::Value, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .get(&format!("parameters/federation-upstream-set/{}/{}", ev, en))
        .await
}

/// Create or update a federation upstream set.
pub async fn create_upstream_set(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
    entries: Vec<serde_json::Value>,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    let body = serde_json::json!({ "value": entries });
    client
        .put_no_content(
            &format!("parameters/federation-upstream-set/{}/{}", ev, en),
            &body,
        )
        .await
}

/// Delete a federation upstream set.
pub async fn delete_upstream_set(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<(), RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    let en = RabbitApiClient::encode_path_segment(name);
    client
        .delete(&format!("parameters/federation-upstream-set/{}/{}", ev, en))
        .await
}

// ---------------------------------------------------------------------------
// Federation links (runtime status)
// ---------------------------------------------------------------------------

/// List all active federation links across all vhosts.
pub async fn list_links(client: &RabbitApiClient) -> Result<Vec<FederationLink>, RabbitError> {
    client.get("federation-links").await
}

/// List federation links for a specific vhost.
pub async fn list_links_for_vhost(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<Vec<FederationLink>, RabbitError> {
    let ev = RabbitApiClient::encode_path_segment(vhost);
    client.get(&format!("federation-links/{}", ev)).await
}

/// Get the status of a specific federation link by its name and vhost.
///
/// The management API does not have a single-link endpoint, so we filter
/// from the full list.
pub async fn get_link_status(
    client: &RabbitApiClient,
    vhost: &str,
    name: &str,
) -> Result<FederationLink, RabbitError> {
    let links = list_links_for_vhost(client, vhost).await?;
    links.into_iter().find(|l| l.name == name).ok_or_else(|| {
        RabbitError::new(
            RabbitErrorKind::FederationError,
            format!("Federation link not found: {}/{}", vhost, name),
        )
    })
}

/// Check whether all federation links in a vhost are running.
pub async fn all_links_healthy(client: &RabbitApiClient, vhost: &str) -> Result<bool, RabbitError> {
    let links = list_links_for_vhost(client, vhost).await?;
    Ok(links.iter().all(|l| l.status.as_deref() == Some("running")))
}

/// Count federation links grouped by status.
pub async fn link_status_summary(
    client: &RabbitApiClient,
    vhost: &str,
) -> Result<std::collections::HashMap<String, usize>, RabbitError> {
    let links = list_links_for_vhost(client, vhost).await?;
    let mut counts = std::collections::HashMap::new();
    for l in &links {
        let status = l.status.as_deref().unwrap_or("unknown").to_string();
        *counts.entry(status).or_insert(0) += 1;
    }
    Ok(counts)
}
