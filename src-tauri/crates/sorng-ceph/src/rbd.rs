use chrono::{TimeZone, Utc};
use serde_json::Value;

use crate::cluster::{api_delete, api_get, api_post, api_put};
use crate::error::{CephError, CephErrorKind};
use crate::types::*;

/// List all RBD images in a pool.
pub async fn list_images(session: &CephSession, pool: &str) -> Result<Vec<RbdImage>, CephError> {
    let data = api_get(session, &format!("/block/image?pool={}", pool)).await?;
    let mut images = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            images.push(parse_rbd_image(item, pool));
        }
    }
    Ok(images)
}

/// Get detailed information about a specific RBD image.
pub async fn get_image(
    session: &CephSession,
    pool: &str,
    image_name: &str,
) -> Result<RbdImage, CephError> {
    let data = api_get(session, &format!("/block/image/{}%2F{}", pool, image_name)).await?;
    Ok(parse_rbd_image(&data, pool))
}

fn parse_rbd_image(item: &Value, pool: &str) -> RbdImage {
    let features = item["features_name"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .or_else(|| {
            item["features"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        })
        .unwrap_or_default();

    let flags = item["flags"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let create_ts = item["create_timestamp"]
        .as_str()
        .and_then(|s| s.parse::<DateTime<Utc>>().ok())
        .or_else(|| item["create_timestamp"].as_i64().map(|t| Utc.timestamp_opt(t, 0).unwrap()));

    let access_ts = item["access_timestamp"]
        .as_str()
        .and_then(|s| s.parse::<DateTime<Utc>>().ok());

    let modify_ts = item["modify_timestamp"]
        .as_str()
        .and_then(|s| s.parse::<DateTime<Utc>>().ok());

    RbdImage {
        name: item["name"].as_str().unwrap_or("").to_string(),
        pool: item["pool_name"].as_str().unwrap_or(pool).to_string(),
        namespace: item["namespace"].as_str().map(String::from),
        size_bytes: item["size"].as_u64().unwrap_or(0),
        num_objects: item["num_objs"].as_u64().unwrap_or(0),
        block_name_prefix: item["block_name_prefix"].as_str().unwrap_or("").to_string(),
        features,
        flags,
        create_timestamp: create_ts,
        access_timestamp: access_ts,
        modify_timestamp: modify_ts,
        parent_pool: item["parent"]["pool_name"].as_str().map(String::from),
        parent_image: item["parent"]["image_name"].as_str().map(String::from),
        parent_snap: item["parent"]["snap_name"].as_str().map(String::from),
        stripe_unit: item["stripe_unit"].as_u64().unwrap_or(0),
        stripe_count: item["stripe_count"].as_u64().unwrap_or(1),
        order: item["order"].as_u64().unwrap_or(22) as u32,
        data_pool: item["data_pool"].as_str().map(String::from),
    }
}

/// Create a new RBD image.
pub async fn create_image(
    session: &CephSession,
    params: &CreateRbdImageParams,
) -> Result<(), CephError> {
    if params.name.is_empty() {
        return Err(CephError::invalid_param("Image name cannot be empty"));
    }
    if params.size_bytes == 0 {
        return Err(CephError::invalid_param("Image size must be > 0"));
    }

    let mut body = serde_json::json!({
        "pool_name": params.pool,
        "name": params.name,
        "size": params.size_bytes,
    });

    if let Some(ref features) = params.features {
        body["features"] = serde_json::to_value(features).unwrap_or(Value::Null);
    }
    if let Some(su) = params.stripe_unit {
        body["stripe_unit"] = Value::Number(serde_json::Number::from(su));
    }
    if let Some(sc) = params.stripe_count {
        body["stripe_count"] = Value::Number(serde_json::Number::from(sc));
    }
    if let Some(ref dp) = params.data_pool {
        body["data_pool"] = Value::String(dp.clone());
    }
    if let Some(obj_size) = params.object_size {
        body["obj_size"] = Value::Number(serde_json::Number::from(obj_size));
    }

    api_post(session, "/block/image", &body).await?;
    log::info!("Created RBD image '{}/{}' ({} bytes)", params.pool, params.name, params.size_bytes);
    Ok(())
}

/// Delete an RBD image.
pub async fn delete_image(
    session: &CephSession,
    pool: &str,
    name: &str,
) -> Result<(), CephError> {
    api_delete(session, &format!("/block/image/{}%2F{}", pool, name)).await?;
    log::info!("Deleted RBD image '{}/{}'", pool, name);
    Ok(())
}

/// Resize an RBD image.
pub async fn resize_image(
    session: &CephSession,
    pool: &str,
    name: &str,
    new_size: u64,
) -> Result<(), CephError> {
    if new_size == 0 {
        return Err(CephError::invalid_param("New size must be > 0"));
    }
    let body = serde_json::json!({"size": new_size});
    api_put(session, &format!("/block/image/{}%2F{}", pool, name), &body).await?;
    log::info!("Resized RBD image '{}/{}' to {} bytes", pool, name, new_size);
    Ok(())
}

/// Rename an RBD image.
pub async fn rename_image(
    session: &CephSession,
    pool: &str,
    old_name: &str,
    new_name: &str,
) -> Result<(), CephError> {
    if new_name.is_empty() {
        return Err(CephError::invalid_param("New image name cannot be empty"));
    }
    let body = serde_json::json!({"new_name": new_name});
    api_put(session, &format!("/block/image/{}%2F{}/rename", pool, old_name), &body).await?;
    log::info!("Renamed RBD image '{}/{}' to '{}/{}'", pool, old_name, pool, new_name);
    Ok(())
}

/// Copy an RBD image to a new pool/name.
pub async fn copy_image(
    session: &CephSession,
    src_pool: &str,
    src_name: &str,
    dst_pool: &str,
    dst_name: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({
        "dest_pool_name": dst_pool,
        "dest_image_name": dst_name,
    });
    api_post(session, &format!("/block/image/{}%2F{}/copy", src_pool, src_name), &body).await?;
    log::info!("Copied RBD image '{}/{}' to '{}/{}'", src_pool, src_name, dst_pool, dst_name);
    Ok(())
}

/// Flatten an RBD clone (remove dependency on parent snapshot).
pub async fn flatten_image(
    session: &CephSession,
    pool: &str,
    name: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({});
    api_post(session, &format!("/block/image/{}%2F{}/flatten", pool, name), &body).await?;
    log::info!("Flattened RBD image '{}/{}'", pool, name);
    Ok(())
}

/// List snapshots for an RBD image.
pub async fn list_snapshots(
    session: &CephSession,
    pool: &str,
    image: &str,
) -> Result<Vec<RbdSnapshot>, CephError> {
    let data = api_get(session, &format!("/block/image/{}%2F{}/snap", pool, image)).await?;
    let mut snaps = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            snaps.push(RbdSnapshot {
                id: item["id"].as_u64().unwrap_or(0),
                name: item["name"].as_str().unwrap_or("").to_string(),
                size_bytes: item["size"].as_u64().unwrap_or(0),
                protected: item["is_protected"].as_bool()
                    .or_else(|| item["protected"].as_bool())
                    .unwrap_or(false),
                timestamp: item["timestamp"]
                    .as_str()
                    .and_then(|s| s.parse::<DateTime<Utc>>().ok()),
            });
        }
    }
    Ok(snaps)
}

/// Create a snapshot of an RBD image.
pub async fn create_snapshot(
    session: &CephSession,
    pool: &str,
    image: &str,
    snap_name: &str,
) -> Result<(), CephError> {
    if snap_name.is_empty() {
        return Err(CephError::invalid_param("Snapshot name cannot be empty"));
    }
    let body = serde_json::json!({"snapshot_name": snap_name});
    api_post(session, &format!("/block/image/{}%2F{}/snap", pool, image), &body).await?;
    log::info!("Created snapshot '{}' on '{}/{}'", snap_name, pool, image);
    Ok(())
}

/// Delete a snapshot from an RBD image.
pub async fn delete_snapshot(
    session: &CephSession,
    pool: &str,
    image: &str,
    snap_name: &str,
) -> Result<(), CephError> {
    api_delete(session, &format!("/block/image/{}%2F{}@{}", pool, image, snap_name)).await?;
    log::info!("Deleted snapshot '{}' from '{}/{}'", snap_name, pool, image);
    Ok(())
}

/// Protect a snapshot (required before cloning from it).
pub async fn protect_snapshot(
    session: &CephSession,
    pool: &str,
    image: &str,
    snap_name: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({"is_protected": true});
    api_put(
        session,
        &format!("/block/image/{}%2F{}@{}", pool, image, snap_name),
        &body,
    )
    .await?;
    log::info!("Protected snapshot '{}/{}@{}'", pool, image, snap_name);
    Ok(())
}

/// Unprotect a snapshot.
pub async fn unprotect_snapshot(
    session: &CephSession,
    pool: &str,
    image: &str,
    snap_name: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({"is_protected": false});
    api_put(
        session,
        &format!("/block/image/{}%2F{}@{}", pool, image, snap_name),
        &body,
    )
    .await?;
    log::info!("Unprotected snapshot '{}/{}@{}'", pool, image, snap_name);
    Ok(())
}

/// Rollback an RBD image to a snapshot.
pub async fn rollback_snapshot(
    session: &CephSession,
    pool: &str,
    image: &str,
    snap_name: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({});
    api_post(
        session,
        &format!("/block/image/{}%2F{}@{}/rollback", pool, image, snap_name),
        &body,
    )
    .await?;
    log::info!("Rolled back '{}/{}' to snapshot '{}'", pool, image, snap_name);
    Ok(())
}

/// Clone an RBD image from a protected snapshot.
pub async fn clone_image(
    session: &CephSession,
    parent_pool: &str,
    parent_image: &str,
    parent_snap: &str,
    child_pool: &str,
    child_name: &str,
) -> Result<(), CephError> {
    if child_name.is_empty() {
        return Err(CephError::invalid_param("Child image name cannot be empty"));
    }
    let body = serde_json::json!({
        "child_pool_name": child_pool,
        "child_image_name": child_name,
    });
    api_post(
        session,
        &format!("/block/image/{}%2F{}@{}/clone", parent_pool, parent_image, parent_snap),
        &body,
    )
    .await?;
    log::info!(
        "Cloned '{}/{}@{}' to '{}/{}'",
        parent_pool, parent_image, parent_snap, child_pool, child_name
    );
    Ok(())
}

/// Enable RBD mirroring for an image.
pub async fn enable_mirroring(
    session: &CephSession,
    pool: &str,
    image: &str,
    mode: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({"mirror_mode": mode});
    api_post(
        session,
        &format!("/block/image/{}%2F{}/mirror/enable", pool, image),
        &body,
    )
    .await?;
    log::info!("Enabled mirroring on '{}/{}' (mode: {})", pool, image, mode);
    Ok(())
}

/// Disable RBD mirroring for an image.
pub async fn disable_mirroring(
    session: &CephSession,
    pool: &str,
    image: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({});
    api_post(
        session,
        &format!("/block/image/{}%2F{}/mirror/disable", pool, image),
        &body,
    )
    .await?;
    log::info!("Disabled mirroring on '{}/{}'", pool, image);
    Ok(())
}

/// Get the mirroring status of an RBD image.
pub async fn get_mirroring_status(
    session: &CephSession,
    pool: &str,
    image: &str,
) -> Result<RbdMirroringStatus, CephError> {
    let data = api_get(session, &format!("/block/image/{}%2F{}/mirror", pool, image)).await?;

    let mode = match data["mirror_mode"].as_str().unwrap_or("disabled") {
        "image" => RbdMirrorMode::Image,
        "pool" => RbdMirrorMode::Pool,
        _ => RbdMirrorMode::Disabled,
    };

    let mut peer_sites = Vec::new();
    if let Some(peers) = data["peer_sites"].as_array() {
        for peer in peers {
            peer_sites.push(RbdMirrorPeer {
                uuid: peer["uuid"].as_str().unwrap_or("").to_string(),
                site_name: peer["site_name"].as_str().unwrap_or("").to_string(),
                mirror_uuid: peer["mirror_uuid"].as_str().unwrap_or("").to_string(),
                state: peer["state"].as_str().unwrap_or("unknown").to_string(),
                last_update: peer["last_update"]
                    .as_str()
                    .and_then(|s| s.parse::<DateTime<Utc>>().ok()),
                description: peer["description"].as_str().map(String::from),
            });
        }
    }

    Ok(RbdMirroringStatus {
        mode,
        state: data["state"].as_str().unwrap_or("unknown").to_string(),
        is_primary: data["is_primary"].as_bool().unwrap_or(false),
        peer_sites,
        last_update: data["last_update"]
            .as_str()
            .and_then(|s| s.parse::<DateTime<Utc>>().ok()),
        description: data["description"].as_str().map(String::from),
    })
}

/// List trashed RBD images in a pool.
pub async fn list_trash(session: &CephSession, pool: &str) -> Result<Vec<RbdTrashEntry>, CephError> {
    let data = api_get(session, &format!("/block/image/trash?pool={}", pool)).await?;
    let mut entries = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            entries.push(RbdTrashEntry {
                id: item["id"].as_str().unwrap_or("").to_string(),
                name: item["name"].as_str().unwrap_or("").to_string(),
                source: item["source"].as_str().unwrap_or("user").to_string(),
                deletion_time: item["deletion_time"]
                    .as_str()
                    .and_then(|s| s.parse::<DateTime<Utc>>().ok()),
                deferment_end_time: item["deferment_end_time"]
                    .as_str()
                    .and_then(|s| s.parse::<DateTime<Utc>>().ok()),
            });
        }
    }
    Ok(entries)
}

/// Move an RBD image to the trash.
pub async fn move_to_trash(
    session: &CephSession,
    pool: &str,
    image: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({});
    api_post(
        session,
        &format!("/block/image/{}%2F{}/move_trash", pool, image),
        &body,
    )
    .await?;
    log::info!("Moved RBD image '{}/{}' to trash", pool, image);
    Ok(())
}

/// Restore an RBD image from the trash.
pub async fn restore_from_trash(
    session: &CephSession,
    pool: &str,
    trash_id: &str,
    name: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({"new_name": name});
    api_post(
        session,
        &format!("/block/image/trash/{}%2F{}/restore", pool, trash_id),
        &body,
    )
    .await?;
    log::info!("Restored RBD image from trash '{}' as '{}/{}'", trash_id, pool, name);
    Ok(())
}

/// Export an RBD image (stub — actual export requires direct RADOS access or rbd CLI).
pub async fn export_image(
    session: &CephSession,
    pool: &str,
    image: &str,
    path: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({
        "destination": path,
    });
    api_post(
        session,
        &format!("/block/image/{}%2F{}/export", pool, image),
        &body,
    )
    .await
    .map_err(|e| {
        CephError::new(
            CephErrorKind::RbdError,
            format!("Export not supported via REST API, use rbd CLI: {}", e),
        )
    })?;
    log::info!("Exported RBD image '{}/{}' to '{}'", pool, image, path);
    Ok(())
}

/// Import an RBD image (stub — actual import requires direct RADOS access or rbd CLI).
pub async fn import_image(
    session: &CephSession,
    pool: &str,
    name: &str,
    path: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({
        "source": path,
        "image_name": name,
        "pool_name": pool,
    });
    api_post(session, "/block/image/import", &body).await.map_err(|e| {
        CephError::new(
            CephErrorKind::RbdError,
            format!("Import not supported via REST API, use rbd CLI: {}", e),
        )
    })?;
    log::info!("Imported RBD image '{}' into '{}/{}'", path, pool, name);
    Ok(())
}

use chrono::DateTime;
