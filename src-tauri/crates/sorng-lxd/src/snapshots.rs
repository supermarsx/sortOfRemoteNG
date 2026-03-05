// ─── LXD – Snapshot management ──────────────────────────────────────────────
use crate::client::LxdClient;
use crate::types::*;

/// GET /1.0/instances/<name>/snapshots?recursion=1
pub async fn list_snapshots(
    client: &LxdClient,
    instance: &str,
) -> LxdResult<Vec<InstanceSnapshot>> {
    client
        .list_recursion(&format!("/instances/{instance}/snapshots"))
        .await
}

/// GET /1.0/instances/<name>/snapshots/<snapshot>
pub async fn get_snapshot(
    client: &LxdClient,
    instance: &str,
    snapshot: &str,
) -> LxdResult<InstanceSnapshot> {
    client
        .get(&format!("/instances/{instance}/snapshots/{snapshot}"))
        .await
}

/// POST /1.0/instances/<name>/snapshots — create a snapshot
pub async fn create_snapshot(
    client: &LxdClient,
    req: &CreateSnapshotRequest,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
        stateful: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        expires_at: &'a Option<chrono::DateTime<chrono::Utc>>,
    }
    client
        .post_async(
            &format!("/instances/{}/snapshots", req.instance),
            &Body {
                name: &req.name,
                stateful: req.stateful,
                expires_at: &req.expires_at,
            },
        )
        .await
}

/// DELETE /1.0/instances/<name>/snapshots/<snapshot>
pub async fn delete_snapshot(
    client: &LxdClient,
    instance: &str,
    snapshot: &str,
) -> LxdResult<LxdOperation> {
    client
        .delete_async(&format!("/instances/{instance}/snapshots/{snapshot}"))
        .await
}

/// POST /1.0/instances/<name>/snapshots/<snapshot> — rename a snapshot
pub async fn rename_snapshot(
    client: &LxdClient,
    instance: &str,
    old_name: &str,
    new_name: &str,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
    }
    client
        .post_async(
            &format!("/instances/{instance}/snapshots/{old_name}"),
            &Body { name: new_name },
        )
        .await
}

/// PUT /1.0/instances/<name> with restore field — restore a snapshot
pub async fn restore_snapshot(
    client: &LxdClient,
    req: &RestoreSnapshotRequest,
) -> LxdResult<()> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        restore: &'a str,
        stateful: bool,
    }
    client
        .put(
            &format!("/instances/{}", req.instance),
            &Body {
                restore: &req.snapshot,
                stateful: req.stateful,
            },
        )
        .await
}
