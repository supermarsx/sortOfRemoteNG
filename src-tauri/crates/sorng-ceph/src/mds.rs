use serde_json::Value;

use crate::cluster::{api_get, api_post, api_put};
use crate::error::CephError;
use crate::types::*;

// ---------------------------------------------------------------------------
// MDS (Metadata Server) Management
// ---------------------------------------------------------------------------

/// List all MDS daemons in the cluster.
pub async fn list_mds_servers(session: &CephSession) -> Result<Vec<MdsInfo>, CephError> {
    let data = api_get(session, "/mds").await?;
    let mut servers = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            servers.push(parse_mds_info(item));
        }
    }
    Ok(servers)
}

/// Get detailed status of a specific MDS daemon.
pub async fn get_mds_status(session: &CephSession, mds_name: &str) -> Result<MdsInfo, CephError> {
    let data = api_get(session, &format!("/mds/{}", mds_name)).await?;
    Ok(parse_mds_info(&data))
}

fn parse_mds_info(item: &Value) -> MdsInfo {
    let state_str = item["state"]
        .as_str()
        .or_else(|| item["status"].as_str())
        .unwrap_or("unknown");

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
        name: item["name"]
            .as_str()
            .or_else(|| item["daemon_name"].as_str())
            .unwrap_or("")
            .to_string(),
        gid: item["gid"].as_u64().unwrap_or(0),
        rank: item["rank"].as_i64().unwrap_or(-1) as i32,
        state,
        addr: item["addr"]
            .as_str()
            .or_else(|| item["addrs"]["addrvec"][0]["addr"].as_str())
            .unwrap_or("")
            .to_string(),
        standby_for_name: item["standby_for_name"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(String::from),
        standby_replay: item["standby_replay"].as_bool().unwrap_or(false),
    }
}

/// Get performance counters for a specific MDS daemon.
pub async fn get_mds_perf(
    session: &CephSession,
    mds_name: &str,
) -> Result<MdsPerfStats, CephError> {
    let data = api_get(session, &format!("/daemon/mds.{}/perf_counters", mds_name)).await?;

    let mds_data = &data["mds"];
    let mds_server = &data["mds_server"];

    Ok(MdsPerfStats {
        name: mds_name.to_string(),
        handle_client_request_latency_ms: mds_server["handle_client_request_latency"]["avgtime"]
            .as_f64()
            .or_else(|| mds_server["handle_client_request_latency"].as_f64())
            .unwrap_or(0.0)
            * 1000.0,
        handle_slave_request_latency_ms: mds_server["handle_slave_request_latency"]["avgtime"]
            .as_f64()
            .or_else(|| mds_server["handle_slave_request_latency"].as_f64())
            .unwrap_or(0.0)
            * 1000.0,
        inodes: mds_data["inodes"]
            .as_u64()
            .or_else(|| mds_data["inodes"]["count"].as_u64())
            .unwrap_or(0),
        caps: mds_data["caps"]
            .as_u64()
            .or_else(|| mds_data["caps"]["count"].as_u64())
            .unwrap_or(0),
        subtrees: mds_data["subtrees"]
            .as_u64()
            .or_else(|| mds_data["subtrees"]["count"].as_u64())
            .unwrap_or(0),
        request_rate: mds_server["req"].as_f64().unwrap_or(0.0),
    })
}

/// Get performance counters for all active MDS daemons.
pub async fn get_all_mds_perf(session: &CephSession) -> Result<Vec<MdsPerfStats>, CephError> {
    let servers = list_mds_servers(session).await?;
    let mut results = Vec::new();
    for mds in &servers {
        if mds.state == MdsState::Active {
            match get_mds_perf(session, &mds.name).await {
                Ok(perf) => results.push(perf),
                Err(e) => {
                    log::warn!("Failed to get perf for MDS {}: {}", mds.name, e);
                }
            }
        }
    }
    Ok(results)
}

/// Deactivate an MDS daemon (set it to standby).
pub async fn deactivate_mds(session: &CephSession, mds_name: &str) -> Result<(), CephError> {
    let body = serde_json::json!({
        "prefix": "mds deactivate",
        "who": mds_name,
    });
    api_post(session, &format!("/mds/{}/deactivate", mds_name), &body).await?;
    log::info!("Deactivated MDS: {}", mds_name);
    Ok(())
}

/// Failover an MDS daemon, forcing a standby to take over.
pub async fn failover_mds(session: &CephSession, mds_name: &str) -> Result<(), CephError> {
    let body = serde_json::json!({
        "prefix": "mds fail",
        "who": mds_name,
    });
    api_post(session, &format!("/mds/{}/fail", mds_name), &body).await?;
    log::info!("Failed over MDS: {}", mds_name);
    Ok(())
}

/// Repurpose an MDS — mark it as standby for a different filesystem.
pub async fn set_mds_standby_for(
    session: &CephSession,
    mds_name: &str,
    standby_for: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({
        "standby_for_name": standby_for,
    });
    api_put(session, &format!("/mds/{}", mds_name), &body).await?;
    log::info!("Set MDS {} as standby for {}", mds_name, standby_for);
    Ok(())
}

/// Get the MDS map (status of all MDS daemons).
pub async fn get_mds_map(session: &CephSession) -> Result<Value, CephError> {
    api_get(session, "/mds/map").await
}

/// Get the metadata (version, host, OS info) for a specific MDS.
pub async fn get_mds_metadata(session: &CephSession, mds_name: &str) -> Result<Value, CephError> {
    api_get(session, &format!("/mds/{}/metadata", mds_name)).await
}

/// Get cache usage statistics for an active MDS.
pub async fn get_mds_cache_stats(
    session: &CephSession,
    mds_name: &str,
) -> Result<Value, CephError> {
    let perf = api_get(session, &format!("/daemon/mds.{}/perf_counters", mds_name)).await?;

    let mds = &perf["mds"];
    Ok(serde_json::json!({
        "inodes": mds["inodes"],
        "inodes_pinned": mds["inodes_pinned"],
        "caps": mds["caps"],
        "subtrees": mds["subtrees"],
        "reply_latency_ms": mds["reply_latency"],
        "forward_count": mds["forward"],
        "dir_fetch": mds["dir_fetch"],
        "dir_commit": mds["dir_commit"],
    }))
}

/// List active MDS sessions (connected clients).
pub async fn list_mds_sessions(session: &CephSession, mds_name: &str) -> Result<Value, CephError> {
    api_get(session, &format!("/mds/{}/sessions", mds_name)).await
}

/// Evict a specific client from an MDS.
pub async fn evict_mds_client(
    session: &CephSession,
    mds_name: &str,
    client_id: u64,
) -> Result<(), CephError> {
    let body = serde_json::json!({
        "client_id": client_id,
    });
    api_post(session, &format!("/mds/{}/client/evict", mds_name), &body).await?;
    log::info!("Evicted client {} from MDS {}", client_id, mds_name);
    Ok(())
}
