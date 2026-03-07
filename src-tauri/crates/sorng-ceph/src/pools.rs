use serde_json::Value;

use crate::cluster::{api_delete, api_get, api_post, api_put};
use crate::error::{CephError, CephErrorKind};
use crate::types::*;

/// List all pools in the cluster.
pub async fn list_pools(session: &CephSession) -> Result<Vec<PoolInfo>, CephError> {
    let data = api_get(session, "/pool").await?;
    let mut pools = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            pools.push(parse_pool_info(item));
        }
    }
    Ok(pools)
}

/// Get detailed information about a specific pool.
pub async fn get_pool(session: &CephSession, pool_name: &str) -> Result<PoolInfo, CephError> {
    let data = api_get(session, &format!("/pool/{}", pool_name)).await?;
    Ok(parse_pool_info(&data))
}

fn parse_pool_info(item: &Value) -> PoolInfo {
    let pool_type_str = item["type"].as_str().unwrap_or("replicated");
    let pool_type = match pool_type_str {
        "erasure" => PoolType::ErasureCoded,
        _ => PoolType::Replicated,
    };

    let autoscale_str = item["pg_autoscale_mode"].as_str().unwrap_or("on");
    let pg_autoscale_mode = match autoscale_str {
        "off" => PgAutoscaleMode::Off,
        "warn" => PgAutoscaleMode::Warn,
        _ => PgAutoscaleMode::On,
    };

    let comp_str = item["options"]["compression_mode"].as_str().unwrap_or("none");
    let compression_mode = match comp_str {
        "passive" => CompressionMode::Passive,
        "aggressive" => CompressionMode::Aggressive,
        "force" => CompressionMode::Force,
        _ => CompressionMode::None,
    };

    PoolInfo {
        id: item["pool"].as_u64().unwrap_or(0) as u32,
        name: item["pool_name"].as_str().unwrap_or("").to_string(),
        pool_type,
        size: item["size"].as_u64().unwrap_or(3) as u32,
        min_size: item["min_size"].as_u64().unwrap_or(2) as u32,
        pg_num: item["pg_num"].as_u64().unwrap_or(32) as u32,
        pgp_num: item["pgp_num"].as_u64().unwrap_or(32) as u32,
        pg_autoscale_mode,
        crush_rule: item["crush_rule"].as_str()
            .or_else(|| item["crush_rule"].as_i64().map(|_| "default"))
            .unwrap_or("replicated_rule")
            .to_string(),
        application: item["application_metadata"]
            .as_object()
            .and_then(|m| m.keys().next().cloned()),
        quota_max_objects: item["quota_max_objects"].as_u64().unwrap_or(0),
        quota_max_bytes: item["quota_max_bytes"].as_u64().unwrap_or(0),
        used_bytes: item["stats"]["bytes_used"].as_u64().unwrap_or(0),
        used_objects: item["stats"]["objects"].as_u64().unwrap_or(0),
        stored_bytes: item["stats"]["stored"].as_u64().unwrap_or(0),
        compression_mode,
        compression_algorithm: item["options"]["compression_algorithm"]
            .as_str()
            .map(String::from),
        erasure_code_profile: item["erasure_code_profile"]
            .as_str()
            .map(String::from),
        pool_delete_allowed: item["flags_names"]
            .as_str()
            .map(|f| !f.contains("nodelete"))
            .unwrap_or(true),
    }
}

/// Create a new pool.
pub async fn create_pool(
    session: &CephSession,
    name: &str,
    pool_type: &PoolType,
    size: Option<u32>,
    pg_num: Option<u32>,
    application: Option<&str>,
    crush_rule: Option<&str>,
) -> Result<(), CephError> {
    if name.is_empty() {
        return Err(CephError::invalid_param("Pool name cannot be empty"));
    }

    let type_str = match pool_type {
        PoolType::Replicated => "replicated",
        PoolType::ErasureCoded => "erasure",
    };

    let mut body = serde_json::json!({
        "pool": name,
        "pool_type": type_str,
    });

    if let Some(s) = size {
        body["size"] = Value::Number(serde_json::Number::from(s));
    }
    if let Some(pg) = pg_num {
        body["pg_num"] = Value::Number(serde_json::Number::from(pg));
    }
    if let Some(app) = application {
        body["application"] = Value::String(app.to_string());
    }
    if let Some(rule) = crush_rule {
        body["rule_name"] = Value::String(rule.to_string());
    }

    api_post(session, "/pool", &body).await?;
    log::info!("Created pool '{}' (type: {})", name, type_str);
    Ok(())
}

/// Delete a pool.
pub async fn delete_pool(session: &CephSession, pool_name: &str) -> Result<(), CephError> {
    api_delete(session, &format!("/pool/{}", pool_name)).await?;
    log::info!("Deleted pool '{}'", pool_name);
    Ok(())
}

/// Set pool replication size and min_size.
pub async fn set_pool_size(
    session: &CephSession,
    pool_name: &str,
    size: u32,
    min_size: Option<u32>,
) -> Result<(), CephError> {
    if size == 0 {
        return Err(CephError::invalid_param("Size must be > 0"));
    }
    let mut body = serde_json::json!({"size": size});
    if let Some(ms) = min_size {
        body["min_size"] = Value::Number(serde_json::Number::from(ms));
    }
    api_put(session, &format!("/pool/{}", pool_name), &body).await?;
    log::info!("Set pool '{}' size={}, min_size={:?}", pool_name, size, min_size);
    Ok(())
}

/// Set the number of placement groups for a pool.
pub async fn set_pool_pg_num(
    session: &CephSession,
    pool_name: &str,
    pg_num: u32,
) -> Result<(), CephError> {
    let body = serde_json::json!({"pg_num": pg_num});
    api_put(session, &format!("/pool/{}", pool_name), &body).await?;
    log::info!("Set pool '{}' pg_num={}", pool_name, pg_num);
    Ok(())
}

/// Set pool quotas (max objects and/or max bytes).
pub async fn set_pool_quota(
    session: &CephSession,
    pool_name: &str,
    max_objects: Option<u64>,
    max_bytes: Option<u64>,
) -> Result<(), CephError> {
    let mut body = serde_json::json!({});
    if let Some(obj) = max_objects {
        body["quota_max_objects"] = Value::Number(serde_json::Number::from(obj));
    }
    if let Some(bytes) = max_bytes {
        body["quota_max_bytes"] = Value::Number(serde_json::Number::from(bytes));
    }
    api_put(session, &format!("/pool/{}/quota", pool_name), &body).await?;
    log::info!("Set pool '{}' quota: max_objects={:?}, max_bytes={:?}", pool_name, max_objects, max_bytes);
    Ok(())
}

/// Enable an application tag on a pool (rbd, cephfs, rgw, etc.).
pub async fn enable_pool_application(
    session: &CephSession,
    pool_name: &str,
    application: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({"application": application});
    api_post(session, &format!("/pool/{}/application", pool_name), &body).await?;
    log::info!("Enabled application '{}' on pool '{}'", application, pool_name);
    Ok(())
}

/// Set compression mode and algorithm for a pool.
pub async fn set_pool_compression(
    session: &CephSession,
    pool_name: &str,
    mode: &CompressionMode,
    algorithm: Option<&str>,
) -> Result<(), CephError> {
    let mode_str = match mode {
        CompressionMode::None => "none",
        CompressionMode::Passive => "passive",
        CompressionMode::Aggressive => "aggressive",
        CompressionMode::Force => "force",
    };

    let mut body = serde_json::json!({"compression_mode": mode_str});
    if let Some(algo) = algorithm {
        body["compression_algorithm"] = Value::String(algo.to_string());
    }
    api_put(session, &format!("/pool/{}/compression", pool_name), &body).await?;
    log::info!("Set pool '{}' compression: mode={}, algo={:?}", pool_name, mode_str, algorithm);
    Ok(())
}

/// Get stats for a specific pool.
pub async fn get_pool_stats(session: &CephSession, pool_name: &str) -> Result<PoolStats, CephError> {
    let data = api_get(session, &format!("/pool/{}/stats", pool_name)).await?;
    Ok(PoolStats {
        pool_name: pool_name.to_string(),
        pool_id: data["pool_id"].as_u64().unwrap_or(0) as u32,
        client_io_rate: PoolIoRate {
            read_ops_per_sec: data["client_io_rate"]["read_op_per_sec"].as_u64().unwrap_or(0),
            write_ops_per_sec: data["client_io_rate"]["write_op_per_sec"].as_u64().unwrap_or(0),
            read_bytes_per_sec: data["client_io_rate"]["read_bytes_sec"].as_u64().unwrap_or(0),
            write_bytes_per_sec: data["client_io_rate"]["write_bytes_sec"].as_u64().unwrap_or(0),
        },
        recovery_rate: PoolRecoveryRate {
            recovering_objects_per_sec: data["recovery_rate"]["recovering_objects_per_sec"]
                .as_u64()
                .unwrap_or(0),
            recovering_bytes_per_sec: data["recovery_rate"]["recovering_bytes_per_sec"]
                .as_u64()
                .unwrap_or(0),
            recovering_keys_per_sec: data["recovery_rate"]["recovering_keys_per_sec"]
                .as_u64()
                .unwrap_or(0),
        },
    })
}

/// Rename a pool.
pub async fn rename_pool(
    session: &CephSession,
    old_name: &str,
    new_name: &str,
) -> Result<(), CephError> {
    if new_name.is_empty() {
        return Err(CephError::invalid_param("New pool name cannot be empty"));
    }
    let body = serde_json::json!({"new_name": new_name});
    api_put(session, &format!("/pool/{}/rename", old_name), &body).await?;
    log::info!("Renamed pool '{}' to '{}'", old_name, new_name);
    Ok(())
}

/// Create an erasure code profile.
pub async fn create_erasure_code_profile(
    session: &CephSession,
    params: &CreateErasureCodeProfileParams,
) -> Result<(), CephError> {
    let mut body = serde_json::json!({
        "name": params.name,
        "k": params.k,
        "m": params.m,
    });

    if let Some(ref plugin) = params.plugin {
        body["plugin"] = Value::String(plugin.clone());
    }
    if let Some(ref technique) = params.technique {
        body["technique"] = Value::String(technique.clone());
    }
    if let Some(ref domain) = params.crush_failure_domain {
        body["crush-failure-domain"] = Value::String(domain.clone());
    }
    if let Some(ref device_class) = params.crush_device_class {
        body["crush-device-class"] = Value::String(device_class.clone());
    }

    api_post(session, "/erasure_code_profile", &body).await?;
    log::info!("Created erasure code profile '{}'", params.name);
    Ok(())
}

/// List all erasure code profiles.
pub async fn list_erasure_code_profiles(
    session: &CephSession,
) -> Result<Vec<ErasureCodeProfile>, CephError> {
    let data = api_get(session, "/erasure_code_profile").await?;
    let mut profiles = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            profiles.push(ErasureCodeProfile {
                name: item["name"].as_str().unwrap_or("").to_string(),
                plugin: item["plugin"].as_str().unwrap_or("jerasure").to_string(),
                k: item["k"].as_u64().unwrap_or(2) as u32,
                m: item["m"].as_u64().unwrap_or(1) as u32,
                technique: item["technique"].as_str().map(String::from),
                crush_failure_domain: item["crush-failure-domain"]
                    .as_str()
                    .unwrap_or("host")
                    .to_string(),
                crush_device_class: item["crush-device-class"].as_str().map(String::from),
            });
        }
    }
    Ok(profiles)
}

/// Create a snapshot of a pool.
pub async fn snapshot_pool(
    session: &CephSession,
    pool_name: &str,
    snap_name: &str,
) -> Result<(), CephError> {
    if snap_name.is_empty() {
        return Err(CephError::invalid_param("Snapshot name cannot be empty"));
    }
    let body = serde_json::json!({"snapshot_name": snap_name});
    api_post(session, &format!("/pool/{}/snapshot", pool_name), &body).await?;
    log::info!("Created snapshot '{}' on pool '{}'", snap_name, pool_name);
    Ok(())
}
