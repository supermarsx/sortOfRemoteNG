use std::collections::HashMap;

use serde_json::Value;

use crate::cluster::{api_delete, api_get, api_post, api_put};
use crate::error::{CephError, CephErrorKind};
use crate::types::*;

/// List all OSDs in the cluster.
pub async fn list_osds(session: &CephSession) -> Result<Vec<OsdInfo>, CephError> {
    let data = api_get(session, "/osd").await?;
    let tree_data = api_get(session, "/osd/tree").await.unwrap_or(Value::Null);
    let perf_data = api_get(session, "/osd/perf").await.unwrap_or(Value::Null);

    let mut osds = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            let osd_id = item["osd"].as_u64().unwrap_or(0) as u32;
            let up = item["up"].as_i64().unwrap_or(0) == 1;
            let is_in = item["in"].as_i64().unwrap_or(0) == 1;

            let status = if !up && !is_in {
                OsdStatus::Out
            } else if !up {
                OsdStatus::Down
            } else if !is_in {
                OsdStatus::Out
            } else {
                OsdStatus::Up
            };

            let mut crush_location = HashMap::new();
            if let Some(loc) = item["crush_location"].as_object() {
                for (k, v) in loc {
                    if let Some(s) = v.as_str() {
                        crush_location.insert(k.clone(), s.to_string());
                    }
                }
            }

            let host = item["host"].as_str()
                .or_else(|| crush_location.get("host").map(|s| s.as_str()))
                .unwrap_or("")
                .to_string();

            let perf = perf_data["osd_perf_infos"]
                .as_array()
                .and_then(|arr| arr.iter().find(|p| p["id"].as_u64() == Some(osd_id as u64)))
                .cloned()
                .unwrap_or(Value::Null);

            let perf_stats = OsdPerfStats {
                commit_latency_ms: perf["perf_stats"]["commit_latency_ms"].as_f64().unwrap_or(0.0),
                apply_latency_ms: perf["perf_stats"]["apply_latency_ms"].as_f64().unwrap_or(0.0),
                read_ops: 0,
                write_ops: 0,
                read_bytes: 0,
                write_bytes: 0,
            };

            let total_kb = item["kb"].as_u64().unwrap_or(0);
            let used_kb = item["kb_used"].as_u64().unwrap_or(0);
            let total_bytes = total_kb * 1024;
            let used_bytes = used_kb * 1024;
            let util = if total_bytes > 0 {
                (used_bytes as f64 / total_bytes as f64) * 100.0
            } else {
                0.0
            };

            let state = OsdStateFlags {
                exists: true,
                up,
                is_in,
                destroyed: item["destroyed"].as_bool().unwrap_or(false),
                new: item["new"].as_bool().unwrap_or(false),
                nearfull: item["nearfull"].as_bool().unwrap_or(false),
                full: item["full"].as_bool().unwrap_or(false),
                backfillfull: item["backfillfull"].as_bool().unwrap_or(false),
                noout: false,
                noin: false,
                nodown: false,
                noup: false,
            };

            osds.push(OsdInfo {
                id: osd_id,
                uuid: item["uuid"].as_str().unwrap_or("").to_string(),
                name: format!("osd.{}", osd_id),
                host,
                device_class: item["device_class"].as_str().unwrap_or("hdd").to_string(),
                status,
                state,
                weight: item["weight"].as_f64().unwrap_or(1.0),
                reweight: item["reweight"].as_f64().unwrap_or(1.0),
                crush_location,
                up_from: item["up_from"].as_u64().unwrap_or(0),
                last_clean: item["last_clean_begin"].as_u64().unwrap_or(0),
                pg_count: item["num_pgs"].as_u64().unwrap_or(0) as u32,
                utilization_percent: util,
                total_bytes,
                used_bytes,
                data_bytes: item["kb_used_data"].as_u64().unwrap_or(0) * 1024,
                omap_bytes: item["kb_used_omap"].as_u64().unwrap_or(0) * 1024,
                perf_stats,
            });
        }
    }
    Ok(osds)
}

/// Get detailed information about a specific OSD.
pub async fn get_osd(session: &CephSession, osd_id: u32) -> Result<OsdInfo, CephError> {
    let data = api_get(session, &format!("/osd/{}", osd_id)).await?;

    let up = data["up"].as_i64().unwrap_or(0) == 1;
    let is_in = data["in"].as_i64().unwrap_or(0) == 1;
    let status = if !up && !is_in {
        OsdStatus::Out
    } else if !up {
        OsdStatus::Down
    } else if !is_in {
        OsdStatus::Out
    } else {
        OsdStatus::Up
    };

    let mut crush_location = HashMap::new();
    if let Some(loc) = data["crush_location"].as_object() {
        for (k, v) in loc {
            if let Some(s) = v.as_str() {
                crush_location.insert(k.clone(), s.to_string());
            }
        }
    }

    let host = data["host"].as_str()
        .or_else(|| crush_location.get("host").map(|s| s.as_str()))
        .unwrap_or("")
        .to_string();

    let total_kb = data["kb"].as_u64().unwrap_or(0);
    let used_kb = data["kb_used"].as_u64().unwrap_or(0);
    let total_bytes = total_kb * 1024;
    let used_bytes = used_kb * 1024;
    let util = if total_bytes > 0 {
        (used_bytes as f64 / total_bytes as f64) * 100.0
    } else {
        0.0
    };

    let state = OsdStateFlags {
        exists: true,
        up,
        is_in,
        destroyed: data["destroyed"].as_bool().unwrap_or(false),
        new: data["new"].as_bool().unwrap_or(false),
        nearfull: data["nearfull"].as_bool().unwrap_or(false),
        full: data["full"].as_bool().unwrap_or(false),
        backfillfull: data["backfillfull"].as_bool().unwrap_or(false),
        noout: false,
        noin: false,
        nodown: false,
        noup: false,
    };

    Ok(OsdInfo {
        id: osd_id,
        uuid: data["uuid"].as_str().unwrap_or("").to_string(),
        name: format!("osd.{}", osd_id),
        host,
        device_class: data["device_class"].as_str().unwrap_or("hdd").to_string(),
        status,
        state,
        weight: data["weight"].as_f64().unwrap_or(1.0),
        reweight: data["reweight"].as_f64().unwrap_or(1.0),
        crush_location,
        up_from: data["up_from"].as_u64().unwrap_or(0),
        last_clean: data["last_clean_begin"].as_u64().unwrap_or(0),
        pg_count: data["num_pgs"].as_u64().unwrap_or(0) as u32,
        utilization_percent: util,
        total_bytes,
        used_bytes,
        data_bytes: data["kb_used_data"].as_u64().unwrap_or(0) * 1024,
        omap_bytes: data["kb_used_omap"].as_u64().unwrap_or(0) * 1024,
        perf_stats: OsdPerfStats::default(),
    })
}

/// Create a new OSD on the given host and device.
pub async fn create_osd(
    session: &CephSession,
    host: &str,
    device: &str,
    device_class: Option<&str>,
) -> Result<u32, CephError> {
    let mut body = serde_json::json!({
        "method": "drive_group",
        "data": [{
            "service_type": "osd",
            "hostname": host,
            "data_devices": {
                "paths": [device]
            }
        }]
    });

    if let Some(dc) = device_class {
        body["data"][0]["device_class"] = Value::String(dc.to_string());
    }

    let result = api_post(session, "/osd", &body).await?;
    let osd_id = result["osd_id"].as_u64().unwrap_or(0) as u32;
    log::info!("Created OSD {} on {}:{}", osd_id, host, device);
    Ok(osd_id)
}

/// Destroy an OSD (marks it destroyed; no further data migration).
pub async fn destroy_osd(session: &CephSession, osd_id: u32, force: bool) -> Result<(), CephError> {
    let body = serde_json::json!({
        "force": force
    });
    api_post(session, &format!("/osd/{}/destroy", osd_id), &body).await?;
    log::info!("Destroyed OSD {}", osd_id);
    Ok(())
}

/// Purge an OSD completely from the cluster.
pub async fn purge_osd(session: &CephSession, osd_id: u32) -> Result<(), CephError> {
    let body = serde_json::json!({});
    api_post(session, &format!("/osd/{}/purge", osd_id), &body).await?;
    log::info!("Purged OSD {}", osd_id);
    Ok(())
}

/// Mark an OSD as out (begin data migration away from it).
pub async fn mark_osd_out(session: &CephSession, osd_id: u32) -> Result<(), CephError> {
    let body = serde_json::json!({"mark": "out"});
    api_put(session, &format!("/osd/{}", osd_id), &body).await?;
    log::info!("Marked OSD {} out", osd_id);
    Ok(())
}

/// Mark an OSD as in (allow data placement on it).
pub async fn mark_osd_in(session: &CephSession, osd_id: u32) -> Result<(), CephError> {
    let body = serde_json::json!({"mark": "in"});
    api_put(session, &format!("/osd/{}", osd_id), &body).await?;
    log::info!("Marked OSD {} in", osd_id);
    Ok(())
}

/// Mark an OSD as down (signal the cluster that it is offline).
pub async fn mark_osd_down(session: &CephSession, osd_id: u32) -> Result<(), CephError> {
    let body = serde_json::json!({"mark": "down"});
    api_put(session, &format!("/osd/{}", osd_id), &body).await?;
    log::info!("Marked OSD {} down", osd_id);
    Ok(())
}

/// Mark an OSD as up.
pub async fn mark_osd_up(session: &CephSession, osd_id: u32) -> Result<(), CephError> {
    let body = serde_json::json!({"mark": "up"});
    api_put(session, &format!("/osd/{}", osd_id), &body).await?;
    log::info!("Marked OSD {} up", osd_id);
    Ok(())
}

/// Reweight an OSD (value between 0.0 and 1.0).
pub async fn reweight_osd(session: &CephSession, osd_id: u32, weight: f64) -> Result<(), CephError> {
    if !(0.0..=1.0).contains(&weight) {
        return Err(CephError::invalid_param("Reweight must be between 0.0 and 1.0"));
    }
    let body = serde_json::json!({"reweight": weight});
    api_put(session, &format!("/osd/{}/reweight", osd_id), &body).await?;
    log::info!("Reweighted OSD {} to {}", osd_id, weight);
    Ok(())
}

/// Set or change the device class for an OSD (hdd, ssd, nvme).
pub async fn set_osd_device_class(
    session: &CephSession,
    osd_id: u32,
    class: &str,
) -> Result<(), CephError> {
    // First remove existing class, then set new one
    let body = serde_json::json!({"class": class});
    api_put(session, &format!("/osd/{}/device_class", osd_id), &body).await?;
    log::info!("Set OSD {} device class to {}", osd_id, class);
    Ok(())
}

/// Get per-OSD performance data.
pub async fn get_osd_perf(session: &CephSession) -> Result<Vec<OsdPerfStats>, CephError> {
    let data = api_get(session, "/osd/perf").await?;
    let mut perfs = Vec::new();
    if let Some(infos) = data["osd_perf_infos"].as_array() {
        for info in infos {
            perfs.push(OsdPerfStats {
                commit_latency_ms: info["perf_stats"]["commit_latency_ms"].as_f64().unwrap_or(0.0),
                apply_latency_ms: info["perf_stats"]["apply_latency_ms"].as_f64().unwrap_or(0.0),
                read_ops: info["perf_stats"]["op_r"].as_u64().unwrap_or(0),
                write_ops: info["perf_stats"]["op_w"].as_u64().unwrap_or(0),
                read_bytes: info["perf_stats"]["op_r_out_bytes"].as_u64().unwrap_or(0),
                write_bytes: info["perf_stats"]["op_w_in_bytes"].as_u64().unwrap_or(0),
            });
        }
    }
    Ok(perfs)
}

/// Get OSD utilization data for all OSDs.
pub async fn get_osd_utilization(session: &CephSession) -> Result<Value, CephError> {
    api_get(session, "/osd/utilization").await
}

/// Get the OSD/CRUSH tree layout.
pub async fn get_osd_tree(session: &CephSession) -> Result<Vec<OsdTreeNode>, CephError> {
    let data = api_get(session, "/osd/tree").await?;
    let mut nodes = Vec::new();
    if let Some(arr) = data["nodes"].as_array() {
        for node in arr {
            let children = node["children"]
                .as_array()
                .map(|c| c.iter().filter_map(|v| v.as_i64().map(|i| i as i32)).collect())
                .unwrap_or_default();

            nodes.push(OsdTreeNode {
                id: node["id"].as_i64().unwrap_or(0) as i32,
                name: node["name"].as_str().unwrap_or("").to_string(),
                type_name: node["type"].as_str().unwrap_or("").to_string(),
                type_id: node["type_id"].as_i64().unwrap_or(0) as i32,
                weight: node["crush_weight"].as_f64().unwrap_or(0.0),
                children,
                status: node["status"].as_str().map(String::from),
                reweight: node["reweight"].as_f64(),
                device_class: node["device_class"].as_str().map(String::from),
            });
        }
    }
    Ok(nodes)
}

/// Request a repair operation on a specific OSD.
pub async fn repair_osd(session: &CephSession, osd_id: u32) -> Result<(), CephError> {
    let body = serde_json::json!({"command": "repair"});
    api_post(session, &format!("/osd/{}/repair", osd_id), &body).await?;
    log::info!("Initiated repair on OSD {}", osd_id);
    Ok(())
}

/// Request a scrub of a specific OSD.
pub async fn scrub_osd(session: &CephSession, osd_id: u32) -> Result<(), CephError> {
    let body = serde_json::json!({"command": "scrub"});
    api_post(session, &format!("/osd/{}/scrub", osd_id), &body).await?;
    log::info!("Initiated scrub on OSD {}", osd_id);
    Ok(())
}

/// Request a deep scrub of a specific OSD.
pub async fn deep_scrub_osd(session: &CephSession, osd_id: u32) -> Result<(), CephError> {
    let body = serde_json::json!({"command": "deep-scrub"});
    api_post(session, &format!("/osd/{}/deep_scrub", osd_id), &body).await?;
    log::info!("Initiated deep scrub on OSD {}", osd_id);
    Ok(())
}
