// ─── LXD – Backup management ────────────────────────────────────────────────
use crate::client::LxdClient;
use crate::types::*;

/// GET /1.0/instances/<name>/backups?recursion=1
pub async fn list_backups(
    client: &LxdClient,
    instance: &str,
) -> LxdResult<Vec<InstanceBackup>> {
    client
        .list_recursion(&format!("/instances/{instance}/backups"))
        .await
}

/// GET /1.0/instances/<name>/backups/<backup>
pub async fn get_backup(
    client: &LxdClient,
    instance: &str,
    backup: &str,
) -> LxdResult<InstanceBackup> {
    client
        .get(&format!("/instances/{instance}/backups/{backup}"))
        .await
}

/// POST /1.0/instances/<name>/backups — create a backup
pub async fn create_backup(
    client: &LxdClient,
    req: &CreateBackupRequest,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
        instance_only: bool,
        optimized_storage: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        compression_algorithm: &'a Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        expires_at: &'a Option<chrono::DateTime<chrono::Utc>>,
    }
    client
        .post_async(
            &format!("/instances/{}/backups", req.instance),
            &Body {
                name: &req.name,
                instance_only: req.instance_only,
                optimized_storage: req.optimized_storage,
                compression_algorithm: &req.compression_algorithm,
                expires_at: &req.expires_at,
            },
        )
        .await
}

/// DELETE /1.0/instances/<name>/backups/<backup>
pub async fn delete_backup(
    client: &LxdClient,
    instance: &str,
    backup: &str,
) -> LxdResult<LxdOperation> {
    client
        .delete_async(&format!("/instances/{instance}/backups/{backup}"))
        .await
}

/// POST /1.0/instances/<name>/backups/<backup> — rename a backup
pub async fn rename_backup(
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
            &format!("/instances/{instance}/backups/{old_name}"),
            &Body { name: new_name },
        )
        .await
}
