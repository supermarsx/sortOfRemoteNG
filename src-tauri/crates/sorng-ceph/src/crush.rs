use serde_json::Value;

use crate::cluster::{api_delete, api_get, api_post, api_put};
use crate::error::{CephError, CephErrorKind};
use crate::types::*;

// ---------------------------------------------------------------------------
// CRUSH Map
// ---------------------------------------------------------------------------

/// Get the full CRUSH map including rules, buckets, types, and tunables.
pub async fn get_crush_map(session: &CephSession) -> Result<CrushMap, CephError> {
    let rules = list_crush_rules(session).await?;
    let buckets = list_crush_buckets(session).await?;
    let types = list_crush_types(session).await?;
    let tunables = get_tunables(session).await?;

    Ok(CrushMap {
        rules,
        buckets,
        types,
        tunables,
    })
}

/// List all CRUSH placement rules.
pub async fn list_crush_rules(session: &CephSession) -> Result<Vec<CrushRule>, CephError> {
    let data = api_get(session, "/crush_rule").await?;
    let mut rules = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            rules.push(parse_crush_rule(item));
        }
    }
    Ok(rules)
}

/// Get details of a specific CRUSH rule.
pub async fn get_crush_rule(
    session: &CephSession,
    rule_name: &str,
) -> Result<CrushRule, CephError> {
    let data = api_get(session, &format!("/crush_rule/{}", rule_name)).await?;
    Ok(parse_crush_rule(&data))
}

fn parse_crush_rule(item: &Value) -> CrushRule {
    let steps: Vec<CrushRuleStep> = item["steps"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|s| CrushRuleStep {
                    op: s["op"].as_str().unwrap_or("").to_string(),
                    item: s["item"].as_i64().map(|v| v as i32),
                    item_name: s["item_name"].as_str().map(String::from),
                    num: s["num"].as_u64().map(|v| v as u32),
                    step_type: s["type"].as_str().map(String::from),
                })
                .collect()
        })
        .unwrap_or_default();

    CrushRule {
        id: item["rule_id"]
            .as_u64()
            .or_else(|| item["id"].as_u64())
            .unwrap_or(0) as u32,
        name: item["rule_name"]
            .as_str()
            .or_else(|| item["name"].as_str())
            .unwrap_or("")
            .to_string(),
        type_name: item["type"]
            .as_str()
            .or_else(|| item["type"].as_i64().map(|_| "replicated"))
            .unwrap_or("replicated")
            .to_string(),
        steps,
    }
}

/// Create a new CRUSH rule for replicated placement.
pub async fn create_crush_rule(
    session: &CephSession,
    name: &str,
    root: &str,
    failure_domain: &str,
    device_class: Option<&str>,
) -> Result<CrushRule, CephError> {
    if name.is_empty() {
        return Err(CephError::invalid_param("Rule name cannot be empty"));
    }
    if root.is_empty() {
        return Err(CephError::invalid_param("Root bucket cannot be empty"));
    }
    if failure_domain.is_empty() {
        return Err(CephError::invalid_param("Failure domain cannot be empty"));
    }

    let mut body = serde_json::json!({
        "name": name,
        "root": root,
        "type": failure_domain,
    });
    if let Some(dc) = device_class {
        body["class"] = Value::String(dc.to_string());
    }

    api_post(session, "/crush_rule", &body).await?;
    log::info!("Created CRUSH rule: {} (root={}, domain={})", name, root, failure_domain);

    get_crush_rule(session, name).await
}

/// Create a CRUSH rule for erasure-coded placement.
pub async fn create_erasure_crush_rule(
    session: &CephSession,
    name: &str,
    profile: &str,
    root: &str,
    failure_domain: &str,
    device_class: Option<&str>,
) -> Result<CrushRule, CephError> {
    if name.is_empty() {
        return Err(CephError::invalid_param("Rule name cannot be empty"));
    }

    let mut body = serde_json::json!({
        "name": name,
        "profile": profile,
        "root": root,
        "type": failure_domain,
    });
    if let Some(dc) = device_class {
        body["class"] = Value::String(dc.to_string());
    }

    api_post(session, "/crush_rule/erasure", &body).await?;
    log::info!("Created erasure CRUSH rule: {}", name);

    get_crush_rule(session, name).await
}

/// Delete a CRUSH rule. The rule must not be in use by any pool.
pub async fn delete_crush_rule(
    session: &CephSession,
    rule_name: &str,
) -> Result<(), CephError> {
    api_delete(session, &format!("/crush_rule/{}", rule_name)).await?;
    log::info!("Deleted CRUSH rule: {}", rule_name);
    Ok(())
}

// ---------------------------------------------------------------------------
// CRUSH Buckets (topology nodes)
// ---------------------------------------------------------------------------

/// List all CRUSH buckets (topology nodes like hosts, racks, DCs).
pub async fn list_crush_buckets(session: &CephSession) -> Result<Vec<CrushBucket>, CephError> {
    let data = api_get(session, "/osd/tree").await?;
    let mut buckets = Vec::new();

    if let Some(nodes) = data["nodes"].as_array() {
        for node in nodes {
            let type_id = node["type_id"].as_i64().unwrap_or(0) as i32;
            // Buckets have type_id > 0 (OSDs are type 0)
            if type_id > 0 {
                buckets.push(parse_crush_bucket(node));
            }
        }
    }
    Ok(buckets)
}

/// Get a specific CRUSH bucket by name.
pub async fn get_crush_bucket(
    session: &CephSession,
    bucket_name: &str,
) -> Result<CrushBucket, CephError> {
    let data = api_get(session, "/osd/tree").await?;
    if let Some(nodes) = data["nodes"].as_array() {
        for node in nodes {
            if node["name"].as_str() == Some(bucket_name) {
                return Ok(parse_crush_bucket(node));
            }
        }
    }
    Err(CephError::not_found(format!("CRUSH bucket: {}", bucket_name)))
}

fn parse_crush_bucket(node: &Value) -> CrushBucket {
    let items: Vec<CrushBucketItem> = node["children"]
        .as_array()
        .map(|a| {
            a.iter()
                .enumerate()
                .filter_map(|(pos, v)| {
                    v.as_i64().map(|id| CrushBucketItem {
                        id: id as i32,
                        weight: 0.0, // individual weight not in tree response
                        pos: pos as u32,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    CrushBucket {
        id: node["id"].as_i64().unwrap_or(0) as i32,
        name: node["name"].as_str().unwrap_or("").to_string(),
        type_name: node["type"].as_str().unwrap_or("").to_string(),
        type_id: node["type_id"].as_i64().unwrap_or(0) as i32,
        weight: node["crush_weight"]
            .as_f64()
            .or_else(|| node["weight"].as_f64())
            .unwrap_or(0.0),
        items,
    }
}

/// Create a new CRUSH bucket (topology node).
pub async fn create_crush_bucket(
    session: &CephSession,
    name: &str,
    type_name: &str,
) -> Result<(), CephError> {
    if name.is_empty() {
        return Err(CephError::invalid_param("Bucket name cannot be empty"));
    }
    let body = serde_json::json!({
        "name": name,
        "type": type_name,
    });
    api_post(session, "/osd/crush/bucket", &body).await?;
    log::info!("Created CRUSH bucket: {} (type: {})", name, type_name);
    Ok(())
}

/// Move an OSD to a specific CRUSH bucket in the hierarchy.
pub async fn move_osd_to_bucket(
    session: &CephSession,
    osd_id: u32,
    bucket_name: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({
        "osd": osd_id,
        "bucket": bucket_name,
    });
    api_post(session, "/osd/crush/move", &body).await?;
    log::info!("Moved osd.{} to CRUSH bucket {}", osd_id, bucket_name);
    Ok(())
}

/// Move a CRUSH bucket to a new parent in the hierarchy.
pub async fn move_bucket(
    session: &CephSession,
    bucket_name: &str,
    parent_name: &str,
    parent_type: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({
        "name": bucket_name,
        parent_type: parent_name,
    });
    api_post(session, "/osd/crush/move", &body).await?;
    log::info!("Moved CRUSH bucket {} under {}", bucket_name, parent_name);
    Ok(())
}

/// Remove an empty CRUSH bucket.
pub async fn remove_crush_bucket(
    session: &CephSession,
    bucket_name: &str,
) -> Result<(), CephError> {
    api_delete(session, &format!("/osd/crush/bucket/{}", bucket_name)).await?;
    log::info!("Removed CRUSH bucket: {}", bucket_name);
    Ok(())
}

// ---------------------------------------------------------------------------
// CRUSH Types
// ---------------------------------------------------------------------------

/// List all CRUSH type definitions.
pub async fn list_crush_types(session: &CephSession) -> Result<Vec<CrushType>, CephError> {
    let data = api_get(session, "/osd/tree").await?;
    let mut types_map = std::collections::HashMap::new();

    if let Some(nodes) = data["nodes"].as_array() {
        for node in nodes {
            let type_id = node["type_id"].as_u64().unwrap_or(0) as u32;
            let type_name = node["type"].as_str().unwrap_or("unknown").to_string();
            types_map.entry(type_id).or_insert(type_name);
        }
    }

    let mut types: Vec<CrushType> = types_map
        .into_iter()
        .map(|(type_id, name)| CrushType { type_id, name })
        .collect();
    types.sort_by_key(|t| t.type_id);
    Ok(types)
}

// ---------------------------------------------------------------------------
// CRUSH Tunables
// ---------------------------------------------------------------------------

/// Get the current CRUSH tunables.
pub async fn get_tunables(session: &CephSession) -> Result<CrushTunables, CephError> {
    let data = api_get(session, "/crush_rule/tunables").await
        .or_else(|_| -> Result<Value, CephError> {
            Ok(Value::Null)
        })?;

    // If the dedicated endpoint is not available, try the OSD map
    let tunables_data = if data.is_null() {
        let osd_map = api_get(session, "/osd/map").await?;
        osd_map["crush_map"]["tunables"].clone()
    } else {
        data
    };

    Ok(CrushTunables {
        choose_local_tries: tunables_data["choose_local_tries"]
            .as_u64()
            .unwrap_or(0) as u32,
        choose_local_fallback_tries: tunables_data["choose_local_fallback_tries"]
            .as_u64()
            .unwrap_or(0) as u32,
        choose_total_tries: tunables_data["choose_total_tries"]
            .as_u64()
            .unwrap_or(50) as u32,
        chooseleaf_descend_once: tunables_data["chooseleaf_descend_once"]
            .as_u64()
            .unwrap_or(1) as u32,
        chooseleaf_vary_r: tunables_data["chooseleaf_vary_r"]
            .as_u64()
            .unwrap_or(1) as u32,
        chooseleaf_stable: tunables_data["chooseleaf_stable"]
            .as_u64()
            .unwrap_or(1) as u32,
        straw_calc_version: tunables_data["straw_calc_version"]
            .as_u64()
            .unwrap_or(1) as u32,
        profile: tunables_data["profile"].as_str().map(String::from),
        optimal_tunables: tunables_data["optimal_tunables"]
            .as_bool()
            .unwrap_or(true),
    })
}

/// Set CRUSH tunables to a named profile.
pub async fn set_tunables(
    session: &CephSession,
    profile: &str,
) -> Result<CrushTunables, CephError> {
    let valid_profiles = ["legacy", "argonaut", "bobtail", "firefly", "hammer", "jewel", "optimal", "default"];
    if !valid_profiles.contains(&profile) {
        return Err(CephError::invalid_param(format!(
            "Invalid tunables profile: {}. Valid: {}",
            profile,
            valid_profiles.join(", ")
        )));
    }

    let body = serde_json::json!({ "profile": profile });
    api_put(session, "/crush_rule/tunables", &body).await?;
    log::info!("Set CRUSH tunables profile: {}", profile);

    get_tunables(session).await
}

/// Set individual CRUSH tunable values.
pub async fn set_tunable_value(
    session: &CephSession,
    tunable_name: &str,
    value: u32,
) -> Result<(), CephError> {
    let valid_tunables = [
        "choose_local_tries",
        "choose_local_fallback_tries",
        "choose_total_tries",
        "chooseleaf_descend_once",
        "chooseleaf_vary_r",
        "chooseleaf_stable",
        "straw_calc_version",
    ];
    if !valid_tunables.contains(&tunable_name) {
        return Err(CephError::invalid_param(format!(
            "Invalid tunable: {}",
            tunable_name
        )));
    }

    let body = serde_json::json!({ tunable_name: value });
    api_put(session, "/crush_rule/tunables", &body).await?;
    log::info!("Set CRUSH tunable {} = {}", tunable_name, value);
    Ok(())
}

/// Get the CRUSH weight for a specific OSD.
pub async fn get_osd_crush_weight(
    session: &CephSession,
    osd_id: u32,
) -> Result<f64, CephError> {
    let data = api_get(session, "/osd/tree").await?;
    if let Some(nodes) = data["nodes"].as_array() {
        for node in nodes {
            if node["id"].as_i64() == Some(osd_id as i64) {
                return Ok(node["crush_weight"]
                    .as_f64()
                    .or_else(|| node["weight"].as_f64())
                    .unwrap_or(0.0));
            }
        }
    }
    Err(CephError::not_found(format!("OSD {} in CRUSH tree", osd_id)))
}

/// Set the device class for an OSD.
pub async fn set_osd_device_class(
    session: &CephSession,
    osd_id: u32,
    device_class: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({
        "osd": osd_id,
        "class": device_class,
    });
    api_post(session, "/osd/crush/set-device-class", &body).await?;
    log::info!("Set device class for osd.{} to {}", osd_id, device_class);
    Ok(())
}

/// Remove the device class from an OSD.
pub async fn remove_osd_device_class(
    session: &CephSession,
    osd_id: u32,
) -> Result<(), CephError> {
    let body = serde_json::json!({ "osd": osd_id });
    api_post(session, "/osd/crush/rm-device-class", &body).await?;
    log::info!("Removed device class from osd.{}", osd_id);
    Ok(())
}
