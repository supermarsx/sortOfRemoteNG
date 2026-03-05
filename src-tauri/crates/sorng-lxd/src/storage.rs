// ─── LXD – Storage management ───────────────────────────────────────────────
use crate::client::LxdClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Storage Pools
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/storage-pools?recursion=1
pub async fn list_storage_pools(client: &LxdClient) -> LxdResult<Vec<StoragePool>> {
    client.list_recursion("/storage-pools").await
}

/// GET /1.0/storage-pools/<name>
pub async fn get_storage_pool(client: &LxdClient, name: &str) -> LxdResult<StoragePool> {
    client.get(&format!("/storage-pools/{name}")).await
}

/// POST /1.0/storage-pools — create pool (PUT)
pub async fn create_storage_pool(
    client: &LxdClient,
    req: &CreateStoragePoolRequest,
) -> LxdResult<()> {
    client.put("/storage-pools", req).await
}

/// PATCH /1.0/storage-pools/<name> — update pool config
pub async fn update_storage_pool(
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
        .patch(
            &format!("/storage-pools/{name}"),
            &Body { config, description },
        )
        .await
}

/// DELETE /1.0/storage-pools/<name>
pub async fn delete_storage_pool(client: &LxdClient, name: &str) -> LxdResult<()> {
    client.delete(&format!("/storage-pools/{name}")).await
}

/// GET /1.0/storage-pools/<name>/resources — pool disk usage
pub async fn get_storage_pool_resources(
    client: &LxdClient,
    name: &str,
) -> LxdResult<StoragePoolResources> {
    client
        .get(&format!("/storage-pools/{name}/resources"))
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Storage Volumes
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/storage-pools/<pool>/volumes?recursion=1
pub async fn list_storage_volumes(
    client: &LxdClient,
    pool: &str,
) -> LxdResult<Vec<StorageVolume>> {
    client
        .list_recursion(&format!("/storage-pools/{pool}/volumes"))
        .await
}

/// GET /1.0/storage-pools/<pool>/volumes/custom?recursion=1 — custom volumes only
pub async fn list_custom_volumes(
    client: &LxdClient,
    pool: &str,
) -> LxdResult<Vec<StorageVolume>> {
    client
        .list_recursion(&format!("/storage-pools/{pool}/volumes/custom"))
        .await
}

/// GET /1.0/storage-pools/<pool>/volumes/<type>/<name>
pub async fn get_storage_volume(
    client: &LxdClient,
    pool: &str,
    vol_type: &str,
    name: &str,
) -> LxdResult<StorageVolume> {
    client
        .get(&format!("/storage-pools/{pool}/volumes/{vol_type}/{name}"))
        .await
}

/// POST /1.0/storage-pools/<pool>/volumes/<type> — create volume
pub async fn create_storage_volume(
    client: &LxdClient,
    req: &CreateStorageVolumeRequest,
) -> LxdResult<()> {
    let vol_type = req.volume_type.as_deref().unwrap_or("custom");
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        content_type: &'a Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: &'a Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        config: &'a Option<std::collections::HashMap<String, String>>,
    }
    client
        .put(
            &format!("/storage-pools/{}/volumes/{vol_type}", req.pool),
            &Body {
                name: &req.name,
                content_type: &req.content_type,
                description: &req.description,
                config: &req.config,
            },
        )
        .await
}

/// PATCH /1.0/storage-pools/<pool>/volumes/custom/<name>
pub async fn update_storage_volume(
    client: &LxdClient,
    pool: &str,
    name: &str,
    patch: &serde_json::Value,
) -> LxdResult<()> {
    client
        .patch(
            &format!("/storage-pools/{pool}/volumes/custom/{name}"),
            patch,
        )
        .await
}

/// DELETE /1.0/storage-pools/<pool>/volumes/custom/<name>
pub async fn delete_storage_volume(
    client: &LxdClient,
    pool: &str,
    name: &str,
) -> LxdResult<()> {
    client
        .delete(&format!("/storage-pools/{pool}/volumes/custom/{name}"))
        .await
}

/// POST /1.0/storage-pools/<pool>/volumes/custom/<name> — rename / migrate volume
pub async fn rename_storage_volume(
    client: &LxdClient,
    pool: &str,
    name: &str,
    new_name: &str,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
    }
    client
        .post_async(
            &format!("/storage-pools/{pool}/volumes/custom/{name}"),
            &Body { name: new_name },
        )
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Storage Volume Snapshots
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/storage-pools/<pool>/volumes/custom/<volume>/snapshots?recursion=1
pub async fn list_volume_snapshots(
    client: &LxdClient,
    pool: &str,
    volume: &str,
) -> LxdResult<Vec<StorageVolumeSnapshot>> {
    client
        .list_recursion(&format!(
            "/storage-pools/{pool}/volumes/custom/{volume}/snapshots"
        ))
        .await
}

/// POST — create volume snapshot
pub async fn create_volume_snapshot(
    client: &LxdClient,
    pool: &str,
    volume: &str,
    snapshot_name: &str,
    expires_at: Option<&chrono::DateTime<chrono::Utc>>,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        expires_at: Option<&'a chrono::DateTime<chrono::Utc>>,
    }
    client
        .post_async(
            &format!("/storage-pools/{pool}/volumes/custom/{volume}/snapshots"),
            &Body {
                name: snapshot_name,
                expires_at,
            },
        )
        .await
}

/// DELETE — delete volume snapshot
pub async fn delete_volume_snapshot(
    client: &LxdClient,
    pool: &str,
    volume: &str,
    snapshot: &str,
) -> LxdResult<LxdOperation> {
    client
        .delete_async(&format!(
            "/storage-pools/{pool}/volumes/custom/{volume}/snapshots/{snapshot}"
        ))
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Storage Buckets (S3-compatible object storage)
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/storage-pools/<pool>/buckets?recursion=1
pub async fn list_storage_buckets(
    client: &LxdClient,
    pool: &str,
) -> LxdResult<Vec<StorageBucket>> {
    client
        .list_recursion(&format!("/storage-pools/{pool}/buckets"))
        .await
}

/// GET /1.0/storage-pools/<pool>/buckets/<name>
pub async fn get_storage_bucket(
    client: &LxdClient,
    pool: &str,
    name: &str,
) -> LxdResult<StorageBucket> {
    client
        .get(&format!("/storage-pools/{pool}/buckets/{name}"))
        .await
}

/// POST — create bucket
pub async fn create_storage_bucket(
    client: &LxdClient,
    req: &CreateStorageBucketRequest,
) -> LxdResult<()> {
    client
        .put(&format!("/storage-pools/{}/buckets", req.pool), req)
        .await
}

/// DELETE /1.0/storage-pools/<pool>/buckets/<name>
pub async fn delete_storage_bucket(
    client: &LxdClient,
    pool: &str,
    name: &str,
) -> LxdResult<()> {
    client
        .delete(&format!("/storage-pools/{pool}/buckets/{name}"))
        .await
}

/// GET /1.0/storage-pools/<pool>/buckets/<name>/keys?recursion=1
pub async fn list_bucket_keys(
    client: &LxdClient,
    pool: &str,
    bucket: &str,
) -> LxdResult<Vec<StorageBucketKey>> {
    client
        .list_recursion(&format!(
            "/storage-pools/{pool}/buckets/{bucket}/keys"
        ))
        .await
}
