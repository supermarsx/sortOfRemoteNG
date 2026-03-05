// ─── LXD – Network management ───────────────────────────────────────────────
use crate::client::LxdClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Networks
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/networks?recursion=1
pub async fn list_networks(client: &LxdClient) -> LxdResult<Vec<LxdNetwork>> {
    client.list_recursion("/networks").await
}

/// GET /1.0/networks/<name>
pub async fn get_network(client: &LxdClient, name: &str) -> LxdResult<LxdNetwork> {
    client.get(&format!("/networks/{name}")).await
}

/// POST /1.0/networks — create a managed network
pub async fn create_network(
    client: &LxdClient,
    req: &CreateNetworkRequest,
) -> LxdResult<()> {
    client.put("/networks", req).await
}

/// PUT /1.0/networks/<name> — replace network config
pub async fn update_network(
    client: &LxdClient,
    name: &str,
    config: &std::collections::HashMap<String, String>,
    description: Option<&str>,
) -> LxdResult<()> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        config: &'a std::collections::HashMap<String, String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<&'a str>,
    }
    client
        .put(&format!("/networks/{name}"), &Body { config, description })
        .await
}

/// PATCH /1.0/networks/<name> — partial update
pub async fn patch_network(
    client: &LxdClient,
    name: &str,
    patch: &serde_json::Value,
) -> LxdResult<()> {
    client.patch(&format!("/networks/{name}"), patch).await
}

/// DELETE /1.0/networks/<name>
pub async fn delete_network(client: &LxdClient, name: &str) -> LxdResult<()> {
    client.delete(&format!("/networks/{name}")).await
}

/// POST /1.0/networks/<name> — rename
pub async fn rename_network(
    client: &LxdClient,
    name: &str,
    new_name: &str,
) -> LxdResult<()> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
    }
    let _: serde_json::Value = client
        .post_sync(&format!("/networks/{name}"), &Body { name: new_name })
        .await?;
    Ok(())
}

/// GET /1.0/networks/<name>/state — network runtime state
pub async fn get_network_state(
    client: &LxdClient,
    name: &str,
) -> LxdResult<LxdNetworkState> {
    client.get(&format!("/networks/{name}/state")).await
}

/// GET /1.0/networks/<name>/leases — DHCP leases for a managed network
pub async fn list_network_leases(
    client: &LxdClient,
    name: &str,
) -> LxdResult<Vec<serde_json::Value>> {
    client.get(&format!("/networks/{name}/leases")).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Network ACLs
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/network-acls?recursion=1
pub async fn list_network_acls(client: &LxdClient) -> LxdResult<Vec<LxdNetworkAcl>> {
    client.list_recursion("/network-acls").await
}

/// GET /1.0/network-acls/<name>
pub async fn get_network_acl(client: &LxdClient, name: &str) -> LxdResult<LxdNetworkAcl> {
    client.get(&format!("/network-acls/{name}")).await
}

/// POST /1.0/network-acls (actually PUT to create)
pub async fn create_network_acl(
    client: &LxdClient,
    req: &CreateNetworkAclRequest,
) -> LxdResult<()> {
    client.put("/network-acls", req).await
}

/// PUT /1.0/network-acls/<name>
pub async fn update_network_acl(
    client: &LxdClient,
    name: &str,
    req: &serde_json::Value,
) -> LxdResult<()> {
    client.put(&format!("/network-acls/{name}"), req).await
}

/// DELETE /1.0/network-acls/<name>
pub async fn delete_network_acl(client: &LxdClient, name: &str) -> LxdResult<()> {
    client.delete(&format!("/network-acls/{name}")).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Network Forwards (port forwarding)
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/networks/<network>/forwards?recursion=1
pub async fn list_network_forwards(
    client: &LxdClient,
    network: &str,
) -> LxdResult<Vec<LxdNetworkForward>> {
    client
        .list_recursion(&format!("/networks/{network}/forwards"))
        .await
}

/// GET /1.0/networks/<network>/forwards/<listen_address>
pub async fn get_network_forward(
    client: &LxdClient,
    network: &str,
    listen_address: &str,
) -> LxdResult<LxdNetworkForward> {
    client
        .get(&format!("/networks/{network}/forwards/{listen_address}"))
        .await
}

/// POST /1.0/networks/<network>/forwards (PUT to create)
pub async fn create_network_forward(
    client: &LxdClient,
    req: &CreateNetworkForwardRequest,
) -> LxdResult<()> {
    client
        .put(&format!("/networks/{}/forwards", req.network), req)
        .await
}

/// DELETE /1.0/networks/<network>/forwards/<listen_address>
pub async fn delete_network_forward(
    client: &LxdClient,
    network: &str,
    listen_address: &str,
) -> LxdResult<()> {
    client
        .delete(&format!("/networks/{network}/forwards/{listen_address}"))
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Network Zones (DNS)
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/network-zones?recursion=1
pub async fn list_network_zones(client: &LxdClient) -> LxdResult<Vec<LxdNetworkZone>> {
    client.list_recursion("/network-zones").await
}

/// GET /1.0/network-zones/<name>
pub async fn get_network_zone(
    client: &LxdClient,
    name: &str,
) -> LxdResult<LxdNetworkZone> {
    client.get(&format!("/network-zones/{name}")).await
}

/// DELETE /1.0/network-zones/<name>
pub async fn delete_network_zone(client: &LxdClient, name: &str) -> LxdResult<()> {
    client.delete(&format!("/network-zones/{name}")).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Network Load Balancers
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/networks/<network>/load-balancers?recursion=1
pub async fn list_network_load_balancers(
    client: &LxdClient,
    network: &str,
) -> LxdResult<Vec<LxdNetworkLoadBalancer>> {
    client
        .list_recursion(&format!("/networks/{network}/load-balancers"))
        .await
}

/// GET /1.0/networks/<network>/load-balancers/<listen_address>
pub async fn get_network_load_balancer(
    client: &LxdClient,
    network: &str,
    listen_address: &str,
) -> LxdResult<LxdNetworkLoadBalancer> {
    client
        .get(&format!(
            "/networks/{network}/load-balancers/{listen_address}"
        ))
        .await
}

/// DELETE /1.0/networks/<network>/load-balancers/<listen_address>
pub async fn delete_network_load_balancer(
    client: &LxdClient,
    network: &str,
    listen_address: &str,
) -> LxdResult<()> {
    client
        .delete(&format!(
            "/networks/{network}/load-balancers/{listen_address}"
        ))
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Network Peers
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/networks/<network>/peers?recursion=1
pub async fn list_network_peers(
    client: &LxdClient,
    network: &str,
) -> LxdResult<Vec<LxdNetworkPeer>> {
    client
        .list_recursion(&format!("/networks/{network}/peers"))
        .await
}
