use chrono::{TimeZone, Utc};
use serde_json::Value;

use crate::cluster::{api_delete, api_get, api_post, api_put};
use crate::error::CephError;
use crate::types::*;

// ---------------------------------------------------------------------------
// RGW User Management
// ---------------------------------------------------------------------------

/// List all RGW (RADOS Gateway) users.
pub async fn list_users(session: &CephSession) -> Result<Vec<RgwUser>, CephError> {
    let data = api_get(session, "/rgw/user").await?;
    let mut users = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            // The list endpoint may return just user IDs, so fetch each
            if item.is_string() {
                let uid = item.as_str().unwrap_or("");
                if !uid.is_empty() {
                    if let Ok(user) = get_user(session, uid).await {
                        users.push(user);
                    }
                }
            } else {
                users.push(parse_rgw_user(item));
            }
        }
    }
    Ok(users)
}

/// Get detailed information about a specific RGW user.
pub async fn get_user(session: &CephSession, uid: &str) -> Result<RgwUser, CephError> {
    let data = api_get(session, &format!("/rgw/user/{}", uid)).await?;
    Ok(parse_rgw_user(&data))
}

fn parse_rgw_user(item: &Value) -> RgwUser {
    let keys: Vec<RgwKey> = item["keys"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|k| RgwKey {
                    access_key: k["access_key"].as_str().unwrap_or("").to_string(),
                    secret_key: k["secret_key"].as_str().unwrap_or("").to_string(),
                    user: k["user"].as_str().unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    let swift_keys: Vec<RgwSwiftKey> = item["swift_keys"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|k| RgwSwiftKey {
                    user: k["user"].as_str().unwrap_or("").to_string(),
                    secret_key: k["secret_key"].as_str().unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    let caps: Vec<RgwCap> = item["caps"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|c| RgwCap {
                    cap_type: c["type"].as_str().unwrap_or("").to_string(),
                    perm: c["perm"].as_str().unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    let bucket_quota = parse_quota(&item["bucket_quota"]);
    let user_quota = parse_quota(&item["user_quota"]);

    let stats = if item["stats"].is_object() {
        Some(RgwUserStats {
            size: item["stats"]["size"].as_u64().unwrap_or(0),
            size_actual: item["stats"]["size_actual"].as_u64().unwrap_or(0),
            num_objects: item["stats"]["num_objects"].as_u64().unwrap_or(0),
        })
    } else {
        None
    };

    RgwUser {
        user_id: item["user_id"]
            .as_str()
            .or_else(|| item["uid"].as_str())
            .unwrap_or("")
            .to_string(),
        display_name: item["display_name"].as_str().unwrap_or("").to_string(),
        email: item["email"]
            .as_str()
            .filter(|e| !e.is_empty())
            .map(String::from),
        max_buckets: item["max_buckets"].as_i64().unwrap_or(1000) as i32,
        suspended: item["suspended"].as_bool().unwrap_or(false),
        keys,
        swift_keys,
        caps,
        bucket_quota,
        user_quota,
        op_mask: item["op_mask"]
            .as_str()
            .unwrap_or("read, write, delete")
            .to_string(),
        stats,
    }
}

fn parse_quota(v: &Value) -> RgwQuota {
    RgwQuota {
        enabled: v["enabled"].as_bool().unwrap_or(false),
        max_size: v["max_size"].as_i64().unwrap_or(-1),
        max_size_kb: v["max_size_kb"].as_i64().unwrap_or(-1),
        max_objects: v["max_objects"].as_i64().unwrap_or(-1),
    }
}

/// Create a new RGW user.
pub async fn create_user(
    session: &CephSession,
    uid: &str,
    display_name: &str,
    email: Option<&str>,
    max_buckets: Option<i32>,
    generate_key: bool,
) -> Result<RgwUser, CephError> {
    if uid.is_empty() {
        return Err(CephError::invalid_param("User ID cannot be empty"));
    }
    if display_name.is_empty() {
        return Err(CephError::invalid_param("Display name cannot be empty"));
    }

    let mut body = serde_json::json!({
        "uid": uid,
        "display_name": display_name,
    });
    if let Some(e) = email {
        body["email"] = Value::String(e.to_string());
    }
    if let Some(mb) = max_buckets {
        body["max_buckets"] = serde_json::json!(mb);
    }
    if generate_key {
        body["generate_key"] = serde_json::json!(true);
    }

    let result = api_post(session, "/rgw/user", &body).await?;
    log::info!("Created RGW user: {}", uid);
    Ok(parse_rgw_user(&result))
}

/// Modify an existing RGW user.
pub async fn modify_user(
    session: &CephSession,
    uid: &str,
    display_name: Option<&str>,
    email: Option<&str>,
    max_buckets: Option<i32>,
    suspended: Option<bool>,
) -> Result<RgwUser, CephError> {
    let mut body = serde_json::json!({});
    if let Some(dn) = display_name {
        body["display_name"] = Value::String(dn.to_string());
    }
    if let Some(e) = email {
        body["email"] = Value::String(e.to_string());
    }
    if let Some(mb) = max_buckets {
        body["max_buckets"] = serde_json::json!(mb);
    }
    if let Some(s) = suspended {
        body["suspended"] = serde_json::json!(s);
    }

    let result = api_put(session, &format!("/rgw/user/{}", uid), &body).await?;
    log::info!("Modified RGW user: {}", uid);
    Ok(parse_rgw_user(&result))
}

/// Delete an RGW user.
pub async fn delete_user(
    session: &CephSession,
    uid: &str,
    purge_data: bool,
) -> Result<(), CephError> {
    let mut path = format!("/rgw/user/{}", uid);
    if purge_data {
        path = format!("{}?purge-data=true", path);
    }
    api_delete(session, &path).await?;
    log::info!("Deleted RGW user: {} (purge_data={})", uid, purge_data);
    Ok(())
}

// ---------------------------------------------------------------------------
// RGW Quotas
// ---------------------------------------------------------------------------

/// Get the user-level quota for an RGW user.
pub async fn get_user_quota(session: &CephSession, uid: &str) -> Result<RgwQuota, CephError> {
    let data = api_get(session, &format!("/rgw/user/{}/quota", uid)).await?;
    Ok(parse_quota(&data))
}

/// Set the user-level quota for an RGW user.
pub async fn set_user_quota(
    session: &CephSession,
    uid: &str,
    enabled: bool,
    max_size_kb: Option<i64>,
    max_objects: Option<i64>,
) -> Result<(), CephError> {
    let mut body = serde_json::json!({
        "enabled": enabled,
        "quota_type": "user",
    });
    if let Some(sz) = max_size_kb {
        body["max_size_kb"] = serde_json::json!(sz);
    }
    if let Some(obj) = max_objects {
        body["max_objects"] = serde_json::json!(obj);
    }

    api_put(session, &format!("/rgw/user/{}/quota", uid), &body).await?;
    log::info!("Set user quota for {}: enabled={}", uid, enabled);
    Ok(())
}

/// Get the bucket quota for an RGW user.
pub async fn get_bucket_quota(session: &CephSession, uid: &str) -> Result<RgwQuota, CephError> {
    let data = api_get(
        session,
        &format!("/rgw/user/{}/quota?quota_type=bucket", uid),
    )
    .await?;
    Ok(parse_quota(&data))
}

/// Set the bucket-level quota for an RGW user.
pub async fn set_bucket_quota(
    session: &CephSession,
    uid: &str,
    enabled: bool,
    max_size_kb: Option<i64>,
    max_objects: Option<i64>,
) -> Result<(), CephError> {
    let mut body = serde_json::json!({
        "enabled": enabled,
        "quota_type": "bucket",
    });
    if let Some(sz) = max_size_kb {
        body["max_size_kb"] = serde_json::json!(sz);
    }
    if let Some(obj) = max_objects {
        body["max_objects"] = serde_json::json!(obj);
    }

    api_put(session, &format!("/rgw/user/{}/quota", uid), &body).await?;
    log::info!("Set bucket quota for {}: enabled={}", uid, enabled);
    Ok(())
}

// ---------------------------------------------------------------------------
// RGW Buckets
// ---------------------------------------------------------------------------

/// List all RGW buckets.
pub async fn list_buckets(session: &CephSession) -> Result<Vec<RgwBucket>, CephError> {
    let data = api_get(session, "/rgw/bucket").await?;
    let mut buckets = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            if item.is_string() {
                let name = item.as_str().unwrap_or("");
                if !name.is_empty() {
                    if let Ok(bucket) = get_bucket(session, name).await {
                        buckets.push(bucket);
                    }
                }
            } else {
                buckets.push(parse_bucket(item));
            }
        }
    }
    Ok(buckets)
}

/// Get detailed information about a specific bucket.
pub async fn get_bucket(session: &CephSession, bucket_name: &str) -> Result<RgwBucket, CephError> {
    let data = api_get(session, &format!("/rgw/bucket/{}", bucket_name)).await?;
    Ok(parse_bucket(&data))
}

fn parse_bucket(item: &Value) -> RgwBucket {
    let created_at = item["creation_time"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .or_else(|| {
            item["creation_time"]
                .as_i64()
                .map(|t| Utc.timestamp_opt(t, 0).unwrap())
        });

    let size_bytes = item["usage"]["rgw.main"]["size"]
        .as_u64()
        .or_else(|| item["size"].as_u64())
        .unwrap_or(0);
    let num_objects = item["usage"]["rgw.main"]["num_objects"]
        .as_u64()
        .or_else(|| item["num_objects"].as_u64())
        .unwrap_or(0);

    RgwBucket {
        name: item["bucket"]
            .as_str()
            .or_else(|| item["name"].as_str())
            .unwrap_or("")
            .to_string(),
        owner: item["owner"].as_str().unwrap_or("").to_string(),
        created_at,
        size_bytes,
        num_objects,
        zonegroup: item["zonegroup"].as_str().map(String::from),
        placement_rule: item["placement_rule"].as_str().map(String::from),
        versioning: item["versioning"].as_str().map(String::from),
        mfa_delete: item["mfa_delete"].as_str().map(String::from),
        lifecycle: item["lifecycle_status"].as_str().map(String::from),
        id: item["id"].as_str().map(String::from),
        marker: item["marker"].as_str().map(String::from),
    }
}

/// Create a new RGW bucket.
pub async fn create_bucket(
    session: &CephSession,
    bucket_name: &str,
    owner: &str,
    placement_rule: Option<&str>,
) -> Result<RgwBucket, CephError> {
    if bucket_name.is_empty() {
        return Err(CephError::invalid_param("Bucket name cannot be empty"));
    }
    if owner.is_empty() {
        return Err(CephError::invalid_param("Bucket owner cannot be empty"));
    }

    let mut body = serde_json::json!({
        "bucket": bucket_name,
        "uid": owner,
    });
    if let Some(pr) = placement_rule {
        body["placement_rule"] = Value::String(pr.to_string());
    }

    api_post(session, "/rgw/bucket", &body).await?;
    log::info!("Created RGW bucket: {} (owner: {})", bucket_name, owner);

    get_bucket(session, bucket_name).await
}

/// Delete an RGW bucket.
pub async fn delete_bucket(
    session: &CephSession,
    bucket_name: &str,
    purge_objects: bool,
) -> Result<(), CephError> {
    let mut path = format!("/rgw/bucket/{}", bucket_name);
    if purge_objects {
        path = format!("{}?purge-objects=true", path);
    }
    api_delete(session, &path).await?;
    log::info!(
        "Deleted RGW bucket: {} (purge_objects={})",
        bucket_name,
        purge_objects
    );
    Ok(())
}

/// Get the bucket policy (ACL) for a bucket.
pub async fn get_bucket_policy(
    session: &CephSession,
    bucket_name: &str,
) -> Result<Value, CephError> {
    api_get(session, &format!("/rgw/bucket/{}/policy", bucket_name)).await
}

/// Set bucket-level quota for a specific bucket.
pub async fn set_bucket_level_quota(
    session: &CephSession,
    bucket_name: &str,
    owner: &str,
    enabled: bool,
    max_size_kb: Option<i64>,
    max_objects: Option<i64>,
) -> Result<(), CephError> {
    let mut body = serde_json::json!({
        "bucket": bucket_name,
        "uid": owner,
        "enabled": enabled,
    });
    if let Some(sz) = max_size_kb {
        body["max_size_kb"] = serde_json::json!(sz);
    }
    if let Some(obj) = max_objects {
        body["max_objects"] = serde_json::json!(obj);
    }

    api_put(
        session,
        &format!("/rgw/bucket/{}/quota", bucket_name),
        &body,
    )
    .await?;
    log::info!("Set quota for bucket {}: enabled={}", bucket_name, enabled);
    Ok(())
}

/// Link a bucket to a different user.
pub async fn link_bucket(
    session: &CephSession,
    bucket_name: &str,
    new_owner: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({
        "bucket": bucket_name,
        "uid": new_owner,
    });
    api_put(session, &format!("/rgw/bucket/{}/link", bucket_name), &body).await?;
    log::info!("Linked bucket {} to user {}", bucket_name, new_owner);
    Ok(())
}

// ---------------------------------------------------------------------------
// RGW Zones & Multi-site
// ---------------------------------------------------------------------------

/// List all RGW zones.
pub async fn list_zones(session: &CephSession) -> Result<Vec<RgwZoneInfo>, CephError> {
    let data = api_get(session, "/rgw/zone").await?;
    let mut zones = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            if item.is_string() {
                let name = item.as_str().unwrap_or("");
                if !name.is_empty() {
                    if let Ok(zone) = get_zone(session, name).await {
                        zones.push(zone);
                    }
                }
            } else {
                zones.push(parse_zone_info(item));
            }
        }
    }
    Ok(zones)
}

/// Get information about a specific zone.
pub async fn get_zone(session: &CephSession, zone_name: &str) -> Result<RgwZoneInfo, CephError> {
    let data = api_get(session, &format!("/rgw/zone/{}", zone_name)).await?;
    Ok(parse_zone_info(&data))
}

fn parse_zone_info(item: &Value) -> RgwZoneInfo {
    let placement_pools = item["placement_pools"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v["key"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    RgwZoneInfo {
        id: item["id"].as_str().unwrap_or("").to_string(),
        name: item["name"].as_str().unwrap_or("").to_string(),
        domain_root: item["domain_root"].as_str().map(String::from),
        control_pool: item["control_pool"].as_str().map(String::from),
        gc_pool: item["gc_pool"].as_str().map(String::from),
        log_pool: item["log_pool"].as_str().map(String::from),
        placement_pools,
    }
}

/// Get the zone group configuration.
pub async fn get_zone_group(
    session: &CephSession,
    zonegroup_name: Option<&str>,
) -> Result<RgwZoneGroup, CephError> {
    let path = match zonegroup_name {
        Some(name) => format!("/rgw/zonegroup/{}", name),
        None => "/rgw/zonegroup".to_string(),
    };
    let data = api_get(session, &path).await?;
    Ok(parse_zone_group(&data))
}

fn parse_zone_group(item: &Value) -> RgwZoneGroup {
    let zones: Vec<RgwZoneRef> = item["zones"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|z| RgwZoneRef {
                    id: z["id"].as_str().unwrap_or("").to_string(),
                    name: z["name"].as_str().unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    RgwZoneGroup {
        id: item["id"].as_str().unwrap_or("").to_string(),
        name: item["name"].as_str().unwrap_or("").to_string(),
        is_master: item["is_master"]
            .as_bool()
            .or_else(|| item["is_master"].as_str().map(|s| s == "true"))
            .unwrap_or(false),
        zones,
    }
}

/// List all RGW realms.
pub async fn list_realms(session: &CephSession) -> Result<Vec<RgwRealmInfo>, CephError> {
    let data = api_get(session, "/rgw/realm").await?;
    let mut realms = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            realms.push(RgwRealmInfo {
                id: item["id"].as_str().unwrap_or("").to_string(),
                name: item["name"].as_str().unwrap_or("").to_string(),
                current_period: item["current_period"].as_str().map(String::from),
            });
        }
    }
    Ok(realms)
}

/// Get user usage statistics.
pub async fn get_user_usage(
    session: &CephSession,
    uid: &str,
) -> Result<Vec<RgwUsageEntry>, CephError> {
    let data = api_get(session, &format!("/rgw/user/{}/usage", uid)).await?;
    let mut entries = Vec::new();
    if let Some(arr) = data["entries"].as_array() {
        for item in arr {
            let categories: Vec<RgwUsageCategory> = item["categories"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|c| RgwUsageCategory {
                            category: c["category"].as_str().unwrap_or("").to_string(),
                            bytes_sent: c["bytes_sent"].as_u64().unwrap_or(0),
                            bytes_received: c["bytes_received"].as_u64().unwrap_or(0),
                            ops: c["ops"].as_u64().unwrap_or(0),
                            successful_ops: c["successful_ops"].as_u64().unwrap_or(0),
                        })
                        .collect()
                })
                .unwrap_or_default();
            entries.push(RgwUsageEntry {
                user: item["user"].as_str().unwrap_or(uid).to_string(),
                categories,
            });
        }
    }
    Ok(entries)
}

/// Create a new RGW access key for a user.
pub async fn create_key(
    session: &CephSession,
    uid: &str,
    generate: bool,
    access_key: Option<&str>,
    secret_key: Option<&str>,
) -> Result<Vec<RgwKey>, CephError> {
    let mut body = serde_json::json!({ "uid": uid });
    if generate {
        body["generate_key"] = serde_json::json!(true);
    }
    if let Some(ak) = access_key {
        body["access_key"] = Value::String(ak.to_string());
    }
    if let Some(sk) = secret_key {
        body["secret_key"] = Value::String(sk.to_string());
    }

    let data = api_post(session, &format!("/rgw/user/{}/key", uid), &body).await?;
    let keys = data
        .as_array()
        .map(|a| {
            a.iter()
                .map(|k| RgwKey {
                    access_key: k["access_key"].as_str().unwrap_or("").to_string(),
                    secret_key: k["secret_key"].as_str().unwrap_or("").to_string(),
                    user: k["user"].as_str().unwrap_or(uid).to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    log::info!("Created key for RGW user: {}", uid);
    Ok(keys)
}

/// Remove an RGW access key.
pub async fn remove_key(
    session: &CephSession,
    uid: &str,
    access_key: &str,
) -> Result<(), CephError> {
    api_delete(
        session,
        &format!("/rgw/user/{}/key?access_key={}", uid, access_key),
    )
    .await?;
    log::info!("Removed key {} for RGW user: {}", access_key, uid);
    Ok(())
}
