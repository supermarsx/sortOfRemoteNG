// ─── LXD – Server & Cluster management ──────────────────────────────────────
use crate::client::LxdClient;
use crate::types::*;

/// GET /1.0 — server information and configuration
pub async fn get_server(client: &LxdClient) -> LxdResult<LxdServer> {
    client.get("").await
}

/// GET /1.0/resources — host resource usage
pub async fn get_server_resources(client: &LxdClient) -> LxdResult<ServerResources> {
    client.get("/resources").await
}

/// PATCH /1.0 — update server configuration
pub async fn update_server_config(
    client: &LxdClient,
    config: &std::collections::HashMap<String, String>,
) -> LxdResult<()> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        config: &'a std::collections::HashMap<String, String>,
    }
    client.patch("", &Body { config }).await
}

// ─── Cluster ─────────────────────────────────────────────────────────────

/// GET /1.0/cluster — cluster information
pub async fn get_cluster(client: &LxdClient) -> LxdResult<LxdCluster> {
    client.get("/cluster").await
}

/// GET /1.0/cluster/members — list cluster members (recursion=1)
pub async fn list_cluster_members(client: &LxdClient) -> LxdResult<Vec<LxdClusterMember>> {
    client.list_recursion("/cluster/members").await
}

/// GET /1.0/cluster/members/<name> — get cluster member
pub async fn get_cluster_member(
    client: &LxdClient,
    name: &str,
) -> LxdResult<LxdClusterMember> {
    client.get(&format!("/cluster/members/{name}")).await
}

/// POST /1.0/cluster/members/<name>/state — evacuate a cluster member
pub async fn evacuate_cluster_member(
    client: &LxdClient,
    name: &str,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body {
        action: &'static str,
    }
    client
        .post_async(
            &format!("/cluster/members/{name}/state"),
            &Body { action: "evacuate" },
        )
        .await
}

/// POST /1.0/cluster/members/<name>/state — restore an evacuated member
pub async fn restore_cluster_member(
    client: &LxdClient,
    name: &str,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body {
        action: &'static str,
    }
    client
        .post_async(
            &format!("/cluster/members/{name}/state"),
            &Body { action: "restore" },
        )
        .await
}

/// DELETE /1.0/cluster/members/<name> — remove cluster member
pub async fn remove_cluster_member(
    client: &LxdClient,
    name: &str,
    force: bool,
) -> LxdResult<()> {
    let path = if force {
        format!("/cluster/members/{name}?force=true")
    } else {
        format!("/cluster/members/{name}")
    };
    client.delete(&path).await
}
