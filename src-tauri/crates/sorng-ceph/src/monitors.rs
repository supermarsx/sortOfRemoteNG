use chrono::{TimeZone, Utc};
use serde_json::Value;

use crate::cluster::{api_get, api_post};
use crate::error::CephError;
use crate::types::*;

// ---------------------------------------------------------------------------
// Monitor Management
// ---------------------------------------------------------------------------

/// List all monitor daemons in the cluster.
pub async fn list_monitors(session: &CephSession) -> Result<Vec<MonitorInfo>, CephError> {
    let data = api_get(session, "/mon").await?;
    let mon_status = api_get(session, "/mon/status").await.unwrap_or(Value::Null);
    let quorum: Vec<u32> = mon_status["quorum"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_u64().map(|n| n as u32))
                .collect()
        })
        .unwrap_or_default();

    let mut monitors = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            monitors.push(parse_monitor_info(item, &quorum));
        }
    }
    Ok(monitors)
}

/// Get detailed status for a specific monitor.
pub async fn get_monitor_status(
    session: &CephSession,
    mon_name: &str,
) -> Result<MonitorInfo, CephError> {
    let data = api_get(session, &format!("/mon/{}", mon_name)).await?;
    let mon_status = api_get(session, "/mon/status").await.unwrap_or(Value::Null);
    let quorum: Vec<u32> = mon_status["quorum"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_u64().map(|n| n as u32))
                .collect()
        })
        .unwrap_or_default();

    Ok(parse_monitor_info(&data, &quorum))
}

fn parse_monitor_info(item: &Value, quorum: &[u32]) -> MonitorInfo {
    let rank = item["rank"].as_u64().unwrap_or(0) as u32;
    let in_quorum = quorum.contains(&rank);

    let state_str = item["state"].as_str().unwrap_or("");
    let state = if state_str.contains("leader") {
        MonitorState::Leader
    } else if state_str.contains("peon") || in_quorum {
        MonitorState::Peon
    } else if state_str.contains("probing") {
        MonitorState::Probing
    } else if state_str.contains("synchronizing") {
        MonitorState::Synchronizing
    } else if state_str.contains("electing") {
        MonitorState::Electing
    } else if in_quorum {
        MonitorState::Peon
    } else {
        MonitorState::Probing
    };

    let health = if in_quorum {
        HealthStatus::Ok
    } else {
        HealthStatus::Warning
    };

    let last_updated = item["store_stats"]["last_updated"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .or_else(|| {
            item["store_stats"]["last_updated"]
                .as_i64()
                .and_then(|t| Utc.timestamp_opt(t, 0).single())
        });

    let store_stats = MonStoreStats {
        bytes_total: item["store_stats"]["bytes_total"].as_u64().unwrap_or(0),
        bytes_sst: item["store_stats"]["bytes_sst"].as_u64().unwrap_or(0),
        bytes_log: item["store_stats"]["bytes_log"].as_u64().unwrap_or(0),
        bytes_misc: item["store_stats"]["bytes_misc"].as_u64().unwrap_or(0),
        last_updated,
    };

    MonitorInfo {
        name: item["name"].as_str().unwrap_or("").to_string(),
        rank,
        addr: item["addr"]
            .as_str()
            .or_else(|| item["public_addr"].as_str())
            .unwrap_or("")
            .to_string(),
        state,
        health,
        kb_total: item["kb_total"].as_u64().unwrap_or(0),
        kb_used: item["kb_used"].as_u64().unwrap_or(0),
        kb_avail: item["kb_avail"].as_u64().unwrap_or(0),
        store_stats,
    }
}

/// Get the current quorum status across all monitors.
pub async fn get_quorum_status(session: &CephSession) -> Result<MonStatus, CephError> {
    let data = api_get(session, "/mon/status").await?;

    let quorum: Vec<u32> = data["quorum"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_u64().map(|n| n as u32))
                .collect()
        })
        .unwrap_or_default();

    let quorum_names: Vec<String> = data["quorum_names"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let outside_quorum: Vec<String> = data["outside_quorum"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let state_str = data["state"].as_str().unwrap_or("peon");
    let state = match state_str {
        "leader" => MonitorState::Leader,
        "peon" => MonitorState::Peon,
        "probing" => MonitorState::Probing,
        "synchronizing" => MonitorState::Synchronizing,
        "electing" => MonitorState::Electing,
        _ => MonitorState::Peon,
    };

    Ok(MonStatus {
        name: data["name"].as_str().unwrap_or("").to_string(),
        rank: data["rank"].as_u64().unwrap_or(0) as u32,
        state,
        election_epoch: data["election_epoch"].as_u64().unwrap_or(0),
        quorum,
        quorum_names,
        leader: data["quorum_leader_name"]
            .as_str()
            .or_else(|| data["leader"].as_str())
            .unwrap_or("")
            .to_string(),
        outside_quorum,
    })
}

/// Get the full monitor map.
pub async fn get_monitor_map(session: &CephSession) -> Result<MonMap, CephError> {
    let data = match api_get(session, "/mon/map").await {
        Ok(v) => v,
        Err(_) => api_get(session, "/mon/dump").await?,
    };

    let mons: Vec<MonMapEntry> = data["mons"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|m| MonMapEntry {
                    rank: m["rank"].as_u64().unwrap_or(0) as u32,
                    name: m["name"].as_str().unwrap_or("").to_string(),
                    addr: m["addr"].as_str().unwrap_or("").to_string(),
                    public_addr: m["public_addr"]
                        .as_str()
                        .or_else(|| m["addr"].as_str())
                        .unwrap_or("")
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    let modified = data["modified"].as_str().and_then(|s| s.parse().ok());
    let created = data["created"].as_str().and_then(|s| s.parse().ok());

    Ok(MonMap {
        epoch: data["epoch"].as_u64().unwrap_or(0),
        fsid: data["fsid"].as_str().unwrap_or("").to_string(),
        modified,
        created,
        mons,
    })
}

/// Request compaction of a monitor's RocksDB store.
pub async fn compact_monitor_store(session: &CephSession, mon_name: &str) -> Result<(), CephError> {
    let body = serde_json::json!({
        "prefix": "mon compact",
        "who": mon_name,
    });
    api_post(session, &format!("/mon/{}/compact", mon_name), &body).await?;
    log::info!("Requested store compaction for monitor {}", mon_name);
    Ok(())
}

/// Compact all monitor stores.
pub async fn compact_all_monitor_stores(session: &CephSession) -> Result<(), CephError> {
    let monitors = list_monitors(session).await?;
    for mon in &monitors {
        compact_monitor_store(session, &mon.name).await?;
    }
    log::info!(
        "Requested store compaction for all {} monitors",
        monitors.len()
    );
    Ok(())
}

/// Get performance counters for a monitor daemon.
pub async fn get_monitor_perf(session: &CephSession, mon_name: &str) -> Result<Value, CephError> {
    let data = api_get(session, &format!("/daemon/mon.{}/perf_counters", mon_name)).await?;
    Ok(data)
}

/// Get performance counters for all monitors.
pub async fn get_all_monitor_perf(
    session: &CephSession,
) -> Result<Vec<(String, Value)>, CephError> {
    let monitors = list_monitors(session).await?;
    let mut results = Vec::new();
    for mon in &monitors {
        match get_monitor_perf(session, &mon.name).await {
            Ok(perf) => results.push((mon.name.clone(), perf)),
            Err(e) => {
                log::warn!("Failed to get perf counters for mon {}: {}", mon.name, e);
                results.push((mon.name.clone(), Value::Null));
            }
        }
    }
    Ok(results)
}

/// Get the election status of the monitor cluster.
pub async fn get_election_status(session: &CephSession) -> Result<Value, CephError> {
    api_get(session, "/mon/election").await
}

/// Get monitor session statistics (connection counts, etc.).
pub async fn get_monitor_sessions(
    session: &CephSession,
    mon_name: &str,
) -> Result<Value, CephError> {
    api_get(session, &format!("/mon/{}/sessions", mon_name)).await
}

/// Get the monitor dump (detailed status of all monitors).
pub async fn get_monitor_dump(session: &CephSession) -> Result<Value, CephError> {
    api_get(session, "/mon/dump").await
}

/// Get the monitor metadata (version, features).
pub async fn get_monitor_metadata(
    session: &CephSession,
    mon_name: &str,
) -> Result<Value, CephError> {
    api_get(session, &format!("/mon/{}/metadata", mon_name)).await
}

/// Check if the monitor cluster has a healthy quorum.
pub async fn is_quorum_healthy(session: &CephSession) -> Result<bool, CephError> {
    let status = get_quorum_status(session).await?;
    let monitors = list_monitors(session).await?;
    let total = monitors.len() as u32;
    let in_quorum = status.quorum.len() as u32;
    // Healthy if majority are in quorum
    Ok(in_quorum > total / 2)
}

/// Get the auth list for monitors (mgr and client keys).
pub async fn get_monitor_auth_list(session: &CephSession) -> Result<Value, CephError> {
    api_get(session, "/auth").await
}

/// Get the service map describing all daemon versions.
pub async fn get_service_versions(session: &CephSession) -> Result<Value, CephError> {
    api_get(session, "/mon/versions").await
}
