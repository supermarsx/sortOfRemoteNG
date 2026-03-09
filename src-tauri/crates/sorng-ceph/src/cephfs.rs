use chrono::{TimeZone, Utc};
use serde_json::Value;

use crate::cluster::{api_delete, api_get, api_post, api_put};
use crate::error::CephError;
use crate::types::*;

// ---------------------------------------------------------------------------
// CephFS Filesystem Management
// ---------------------------------------------------------------------------

/// List all CephFS filesystems in the cluster.
pub async fn list_filesystems(session: &CephSession) -> Result<Vec<CephFsInfo>, CephError> {
    let data = api_get(session, "/cephfs").await?;
    let mut filesystems = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            filesystems.push(parse_cephfs_info(item));
        }
    }
    Ok(filesystems)
}

/// Get detailed information about a specific CephFS filesystem.
pub async fn get_filesystem(session: &CephSession, fs_name: &str) -> Result<CephFsInfo, CephError> {
    let data = api_get(session, &format!("/cephfs/{}", fs_name)).await?;
    Ok(parse_cephfs_info(&data))
}

fn parse_cephfs_info(item: &Value) -> CephFsInfo {
    let mds_map_val = &item["mdsmap"];
    let in_mds: Vec<String> = mds_map_val["in"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let up_mds: Vec<String> = mds_map_val["up"]
        .as_object()
        .map(|m| {
            m.values()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let flags: Vec<String> = mds_map_val["flags"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .or_else(|| {
            mds_map_val["flags"]
                .as_str()
                .map(|s| s.split(',').map(|f| f.trim().to_string()).collect())
        })
        .unwrap_or_default();

    let mds_map = MdsMapSummary {
        epoch: mds_map_val["epoch"].as_u64().unwrap_or(0),
        flags,
        max_mds: mds_map_val["max_mds"].as_u64().unwrap_or(1) as u32,
        in_mds,
        up_mds,
    };

    let data_pools: Vec<String> = item["data_pools"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    v.as_str()
                        .map(String::from)
                        .or_else(|| v.as_i64().map(|n| n.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();

    let standby_count = item["standbys"]
        .as_array()
        .map(|a| a.len() as u32)
        .unwrap_or(0);

    CephFsInfo {
        id: item["id"].as_u64().unwrap_or(0) as u32,
        name: item["name"].as_str().unwrap_or("").to_string(),
        mds_map,
        data_pools,
        metadata_pool: item["metadata_pool"].as_str().unwrap_or("").to_string(),
        max_mds: item["mdsmap"]["max_mds"].as_u64().unwrap_or(1) as u32,
        in_count: item["mdsmap"]["in"]
            .as_array()
            .map(|a| a.len() as u32)
            .unwrap_or(0),
        up_count: item["mdsmap"]["up"]
            .as_object()
            .map(|m| m.len() as u32)
            .unwrap_or(0),
        standby_count,
    }
}

/// Create a new CephFS filesystem.
pub async fn create_filesystem(
    session: &CephSession,
    name: &str,
    metadata_pool: &str,
    data_pool: &str,
) -> Result<CephFsInfo, CephError> {
    if name.is_empty() {
        return Err(CephError::invalid_param("Filesystem name cannot be empty"));
    }
    if metadata_pool.is_empty() {
        return Err(CephError::invalid_param("Metadata pool cannot be empty"));
    }
    if data_pool.is_empty() {
        return Err(CephError::invalid_param("Data pool cannot be empty"));
    }

    let body = serde_json::json!({
        "name": name,
        "metadata_pool": metadata_pool,
        "data_pool": data_pool,
    });
    api_post(session, "/cephfs", &body).await?;
    log::info!("Created CephFS filesystem: {}", name);

    get_filesystem(session, name).await
}

/// Remove a CephFS filesystem.
pub async fn remove_filesystem(
    session: &CephSession,
    fs_name: &str,
    confirm: bool,
) -> Result<(), CephError> {
    if !confirm {
        return Err(CephError::invalid_param(
            "Filesystem removal requires explicit confirmation",
        ));
    }
    // Must set the cluster flag to allow pool/fs deletion
    let flag_body = serde_json::json!({"name": "mon_allow_pool_delete", "value": "true"});
    api_put(session, "/config/mon/mon_allow_pool_delete", &flag_body)
        .await
        .ok();

    api_delete(session, &format!("/cephfs/{}", fs_name)).await?;
    log::info!("Removed CephFS filesystem: {}", fs_name);
    Ok(())
}

// ---------------------------------------------------------------------------
// Subvolumes
// ---------------------------------------------------------------------------

/// List subvolumes for a CephFS filesystem, optionally filtered by group.
pub async fn list_subvolumes(
    session: &CephSession,
    fs_name: &str,
    group: Option<&str>,
) -> Result<Vec<CephFsSubvolume>, CephError> {
    let path = match group {
        Some(g) => format!("/cephfs/{}/subvolume?group={}", fs_name, g),
        None => format!("/cephfs/{}/subvolume", fs_name),
    };
    let data = api_get(session, &path).await?;
    let mut subvolumes = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            subvolumes.push(parse_subvolume(item));
        }
    }
    Ok(subvolumes)
}

fn parse_subvolume(item: &Value) -> CephFsSubvolume {
    let created_at = item["created_at"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .or_else(|| {
            item["created_at"]
                .as_i64()
                .map(|t| Utc.timestamp_opt(t, 0).unwrap())
        });

    CephFsSubvolume {
        name: item["name"].as_str().unwrap_or("").to_string(),
        group: item["group"].as_str().unwrap_or("_nogroup").to_string(),
        path: item["path"].as_str().unwrap_or("").to_string(),
        state: item["state"].as_str().unwrap_or("complete").to_string(),
        size_bytes: item["bytes_used"].as_u64().or(item["size"].as_u64()),
        quota_bytes: item["bytes_quota"].as_u64().or(item["quota"].as_u64()),
        created_at,
    }
}

/// Create a new subvolume in a CephFS filesystem.
pub async fn create_subvolume(
    session: &CephSession,
    fs_name: &str,
    subvol_name: &str,
    group: Option<&str>,
    size_bytes: Option<u64>,
    mode: Option<&str>,
) -> Result<CephFsSubvolume, CephError> {
    if subvol_name.is_empty() {
        return Err(CephError::invalid_param("Subvolume name cannot be empty"));
    }

    let mut body = serde_json::json!({
        "name": subvol_name,
    });
    if let Some(g) = group {
        body["group"] = serde_json::Value::String(g.to_string());
    }
    if let Some(sz) = size_bytes {
        body["size"] = serde_json::json!(sz);
    }
    if let Some(m) = mode {
        body["mode"] = serde_json::Value::String(m.to_string());
    }

    api_post(session, &format!("/cephfs/{}/subvolume", fs_name), &body).await?;
    log::info!("Created subvolume {} in fs {}", subvol_name, fs_name);

    // Fetch the created subvolume to return full info
    let data = api_get(
        session,
        &format!("/cephfs/{}/subvolume/{}", fs_name, subvol_name),
    )
    .await?;
    Ok(parse_subvolume(&data))
}

/// Remove a subvolume from a CephFS filesystem.
pub async fn remove_subvolume(
    session: &CephSession,
    fs_name: &str,
    subvol_name: &str,
    group: Option<&str>,
    force: bool,
) -> Result<(), CephError> {
    let mut path = format!("/cephfs/{}/subvolume/{}", fs_name, subvol_name);
    let mut params = Vec::new();
    if let Some(g) = group {
        params.push(format!("group={}", g));
    }
    if force {
        params.push("force=true".to_string());
    }
    if !params.is_empty() {
        path = format!("{}?{}", path, params.join("&"));
    }

    api_delete(session, &path).await?;
    log::info!("Removed subvolume {} from fs {}", subvol_name, fs_name);
    Ok(())
}

/// Resize a subvolume quota.
pub async fn resize_subvolume(
    session: &CephSession,
    fs_name: &str,
    subvol_name: &str,
    group: Option<&str>,
    new_size_bytes: u64,
    no_shrink: bool,
) -> Result<(), CephError> {
    let mut body = serde_json::json!({
        "size": new_size_bytes,
    });
    if no_shrink {
        body["no_shrink"] = serde_json::json!(true);
    }
    if let Some(g) = group {
        body["group"] = serde_json::Value::String(g.to_string());
    }

    api_put(
        session,
        &format!("/cephfs/{}/subvolume/{}/resize", fs_name, subvol_name),
        &body,
    )
    .await?;
    log::info!(
        "Resized subvolume {} in fs {} to {} bytes",
        subvol_name,
        fs_name,
        new_size_bytes
    );
    Ok(())
}

/// Create a snapshot of a subvolume.
pub async fn snapshot_subvolume(
    session: &CephSession,
    fs_name: &str,
    subvol_name: &str,
    snap_name: &str,
    group: Option<&str>,
) -> Result<(), CephError> {
    if snap_name.is_empty() {
        return Err(CephError::invalid_param("Snapshot name cannot be empty"));
    }

    let mut body = serde_json::json!({
        "snap_name": snap_name,
    });
    if let Some(g) = group {
        body["group"] = serde_json::Value::String(g.to_string());
    }

    api_post(
        session,
        &format!("/cephfs/{}/subvolume/{}/snapshot", fs_name, subvol_name),
        &body,
    )
    .await?;
    log::info!(
        "Created snapshot {} for subvolume {} in fs {}",
        snap_name,
        subvol_name,
        fs_name
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// MDS for CephFS
// ---------------------------------------------------------------------------

/// List MDS daemons associated with a specific filesystem.
pub async fn list_mds_for_fs(
    session: &CephSession,
    fs_name: &str,
) -> Result<Vec<MdsInfo>, CephError> {
    let fs = get_filesystem(session, fs_name).await?;
    let all_mds = api_get(session, "/mds").await?;
    let mut result = Vec::new();

    if let Some(arr) = all_mds.as_array() {
        for item in arr {
            let mds_name = item["name"].as_str().unwrap_or("");
            // Include MDS daemons that are in this filesystem's mds map
            let belongs = fs.mds_map.in_mds.iter().any(|m| m == mds_name)
                || fs.mds_map.up_mds.iter().any(|m| m == mds_name)
                || item["filesystem"].as_str() == Some(fs_name);

            if belongs {
                result.push(parse_mds_info(item));
            }
        }
    }

    // If the filter was too restrictive, include all MDS for the fs id
    if result.is_empty() {
        if let Some(arr) = all_mds.as_array() {
            for item in arr {
                if item["mds_map"]["fs_name"].as_str() == Some(fs_name)
                    || item["filesystem_id"].as_u64() == Some(fs.id as u64)
                {
                    result.push(parse_mds_info(item));
                }
            }
        }
    }

    Ok(result)
}

fn parse_mds_info(item: &Value) -> MdsInfo {
    let state_str = item["state"].as_str().unwrap_or("unknown");
    let state = match state_str {
        s if s.contains("active") => MdsState::Active,
        s if s.contains("standby-replay") => MdsState::StandbyReplay,
        s if s.contains("standby") => MdsState::Standby,
        s if s.contains("stopping") => MdsState::Stopping,
        s if s.contains("damaged") => MdsState::Damaged,
        s if s.contains("rejoin") => MdsState::Rejoin,
        s if s.contains("creating") => MdsState::Creating,
        s if s.contains("starting") => MdsState::Starting,
        _ => MdsState::Unknown,
    };

    MdsInfo {
        name: item["name"].as_str().unwrap_or("").to_string(),
        gid: item["gid"].as_u64().unwrap_or(0),
        rank: item["rank"].as_i64().unwrap_or(-1) as i32,
        state,
        addr: item["addr"].as_str().unwrap_or("").to_string(),
        standby_for_name: item["standby_for_name"].as_str().map(String::from),
        standby_replay: item["standby_replay"].as_bool().unwrap_or(false),
    }
}

// ---------------------------------------------------------------------------
// Client eviction
// ---------------------------------------------------------------------------

/// Evict a CephFS client session.
pub async fn evict_client(
    session: &CephSession,
    fs_name: &str,
    client_id: u64,
) -> Result<(), CephError> {
    let body = serde_json::json!({
        "client_id": client_id,
    });
    api_post(session, &format!("/cephfs/{}/client/evict", fs_name), &body).await?;
    log::info!("Evicted client {} from fs {}", client_id, fs_name);
    Ok(())
}

/// List connected CephFS clients for a filesystem.
pub async fn list_clients(
    session: &CephSession,
    fs_name: &str,
) -> Result<Vec<CephFsClient>, CephError> {
    let data = api_get(session, &format!("/cephfs/{}/clients", fs_name)).await?;
    let mut clients = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            clients.push(CephFsClient {
                id: item["id"].as_u64().unwrap_or(0),
                entity: item["entity"].as_str().unwrap_or("").to_string(),
                ip_addr: item["ip"]
                    .as_str()
                    .or_else(|| item["inst"].as_str())
                    .unwrap_or("")
                    .to_string(),
                mount_point: item["mount_point"]
                    .as_str()
                    .or_else(|| item["root"].as_str())
                    .map(String::from),
                hostname: item["hostname"].as_str().map(String::from),
                version: item["version"]
                    .as_str()
                    .or_else(|| item["client_metadata"]["ceph_version"].as_str())
                    .map(String::from),
            });
        }
    }
    Ok(clients)
}

/// Get directory statistics for a path in a CephFS filesystem.
pub async fn get_directory_stats(
    session: &CephSession,
    fs_name: &str,
    path: &str,
) -> Result<DirectoryStats, CephError> {
    let encoded_path = url::form_urlencoded::byte_serialize(path.as_bytes()).collect::<String>();
    let data = api_get(
        session,
        &format!("/cephfs/{}/ls_dir?path={}", fs_name, encoded_path),
    )
    .await?;

    Ok(DirectoryStats {
        path: path.to_string(),
        files: data["files"].as_u64().unwrap_or(0),
        subdirs: data["subdirs"].as_u64().unwrap_or(0),
        bytes: data["bytes"].as_u64().unwrap_or(0),
        quota_max_bytes: data["quota_max_bytes"].as_u64(),
        quota_max_files: data["quota_max_files"].as_u64(),
    })
}

/// Set the maximum number of active MDS daemons for a filesystem.
pub async fn set_max_mds(
    session: &CephSession,
    fs_name: &str,
    max_mds: u32,
) -> Result<(), CephError> {
    if max_mds == 0 {
        return Err(CephError::invalid_param("max_mds must be at least 1"));
    }
    let body = serde_json::json!({ "max_mds": max_mds });
    api_put(session, &format!("/cephfs/{}", fs_name), &body).await?;
    log::info!("Set max_mds to {} for fs {}", max_mds, fs_name);
    Ok(())
}

/// Add a data pool to a CephFS filesystem.
pub async fn add_data_pool(
    session: &CephSession,
    fs_name: &str,
    pool_name: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({ "pool": pool_name });
    api_post(session, &format!("/cephfs/{}/data_pool", fs_name), &body).await?;
    log::info!("Added data pool {} to fs {}", pool_name, fs_name);
    Ok(())
}

/// Remove a data pool from a CephFS filesystem.
pub async fn remove_data_pool(
    session: &CephSession,
    fs_name: &str,
    pool_name: &str,
) -> Result<(), CephError> {
    api_delete(
        session,
        &format!("/cephfs/{}/data_pool/{}", fs_name, pool_name),
    )
    .await?;
    log::info!("Removed data pool {} from fs {}", pool_name, fs_name);
    Ok(())
}

/// List subvolume snapshots.
pub async fn list_subvolume_snapshots(
    session: &CephSession,
    fs_name: &str,
    subvol_name: &str,
    group: Option<&str>,
) -> Result<Vec<Value>, CephError> {
    let mut path = format!("/cephfs/{}/subvolume/{}/snapshot", fs_name, subvol_name);
    if let Some(g) = group {
        path = format!("{}?group={}", path, g);
    }
    let data = api_get(session, &path).await?;
    let snapshots = data.as_array().cloned().unwrap_or_default();
    Ok(snapshots)
}

/// Delete a subvolume snapshot.
pub async fn delete_subvolume_snapshot(
    session: &CephSession,
    fs_name: &str,
    subvol_name: &str,
    snap_name: &str,
    group: Option<&str>,
) -> Result<(), CephError> {
    let mut path = format!(
        "/cephfs/{}/subvolume/{}/snapshot/{}",
        fs_name, subvol_name, snap_name
    );
    if let Some(g) = group {
        path = format!("{}?group={}", path, g);
    }
    api_delete(session, &path).await?;
    log::info!(
        "Deleted snapshot {} of subvolume {} in fs {}",
        snap_name,
        subvol_name,
        fs_name
    );
    Ok(())
}

/// List subvolume groups for a CephFS filesystem.
pub async fn list_subvolume_groups(
    session: &CephSession,
    fs_name: &str,
) -> Result<Vec<Value>, CephError> {
    let data = api_get(session, &format!("/cephfs/{}/subvolume/group", fs_name)).await?;
    Ok(data.as_array().cloned().unwrap_or_default())
}
