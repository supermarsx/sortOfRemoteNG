use std::collections::HashMap;

use chrono::{TimeZone, Utc};
use serde_json::Value;

use crate::cluster::{api_get, api_post};
use crate::error::CephError;
use crate::types::*;

// ---------------------------------------------------------------------------
// Placement Group Operations
// ---------------------------------------------------------------------------

/// List all placement groups in the cluster.
pub async fn list_pgs(session: &CephSession) -> Result<Vec<PgInfo>, CephError> {
    let data = api_get(session, "/pg").await?;
    let mut pgs = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            pgs.push(parse_pg_info(item));
        }
    }
    Ok(pgs)
}

/// List PGs for a specific pool.
pub async fn list_pgs_for_pool(
    session: &CephSession,
    pool_id: u32,
) -> Result<Vec<PgInfo>, CephError> {
    let data = api_get(session, &format!("/pg?pool={}", pool_id)).await?;
    let mut pgs = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            pgs.push(parse_pg_info(item));
        }
    }
    Ok(pgs)
}

/// Get detailed status of a specific placement group.
pub async fn get_pg_status(session: &CephSession, pgid: &str) -> Result<PgInfo, CephError> {
    let data = api_get(session, &format!("/pg/{}", pgid)).await?;
    Ok(parse_pg_info(&data))
}

fn parse_pg_info(item: &Value) -> PgInfo {
    let up: Vec<u32> = item["up"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_u64().map(|n| n as u32))
                .collect()
        })
        .unwrap_or_default();

    let acting: Vec<u32> = item["acting"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_u64().map(|n| n as u32))
                .collect()
        })
        .unwrap_or_default();

    let last_scrub = item["last_scrub_stamp"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .or_else(|| {
            item["last_scrub_stamp"]
                .as_i64()
                .map(|t| Utc.timestamp_opt(t, 0).unwrap())
        });

    let last_deep_scrub = item["last_deep_scrub_stamp"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .or_else(|| {
            item["last_deep_scrub_stamp"]
                .as_i64()
                .map(|t| Utc.timestamp_opt(t, 0).unwrap())
        });

    let stat_sum = &item["stat_sum"];

    PgInfo {
        pgid: item["pgid"]
            .as_str()
            .or_else(|| item["pg_id"].as_str())
            .unwrap_or("")
            .to_string(),
        state: item["state"].as_str().unwrap_or("unknown").to_string(),
        up: up.clone(),
        acting: acting.clone(),
        last_scrub,
        last_deep_scrub,
        objects: stat_sum["num_objects"].as_u64().unwrap_or(0),
        bytes: stat_sum["num_bytes"].as_u64().unwrap_or(0),
        read_ops: stat_sum["num_read"].as_u64().unwrap_or(0),
        write_ops: stat_sum["num_write"].as_u64().unwrap_or(0),
        read_bytes: stat_sum["num_read_kb"].as_u64().unwrap_or(0) * 1024,
        write_bytes: stat_sum["num_write_kb"].as_u64().unwrap_or(0) * 1024,
        up_primary: item["up_primary"]
            .as_u64()
            .unwrap_or_else(|| up.first().copied().unwrap_or(0) as u64) as u32,
        acting_primary: item["acting_primary"]
            .as_u64()
            .unwrap_or_else(|| acting.first().copied().unwrap_or(0) as u64)
            as u32,
    }
}

/// Get a summary of PG states across the cluster.
pub async fn get_pg_summary(session: &CephSession) -> Result<PgSummary, CephError> {
    let data = api_get(session, "/pg/summary").await?;

    let mut states = HashMap::new();
    if let Some(by_state) = data["by_state"].as_array() {
        for entry in by_state {
            let name = entry["name"]
                .as_str()
                .or_else(|| entry["state"].as_str())
                .unwrap_or("unknown")
                .to_string();
            let count = entry["count"]
                .as_u64()
                .or_else(|| entry["num"].as_u64())
                .unwrap_or(0) as u32;
            states.insert(name, count);
        }
    }

    // Also try direct state counts
    if states.is_empty() {
        if let Some(obj) = data["pgs_by_state"].as_array() {
            for entry in obj {
                let name = entry["state_name"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string();
                let count = entry["count"].as_u64().unwrap_or(0) as u32;
                states.insert(name, count);
            }
        }
    }

    Ok(PgSummary {
        num_pgs: data["num_pgs"].as_u64().unwrap_or(0) as u32,
        states,
        num_objects: data["num_objects"].as_u64().unwrap_or(0),
        data_bytes: data["data_bytes"].as_u64().unwrap_or(0),
        num_bytes: data["num_bytes"]
            .as_u64()
            .or_else(|| data["bytes_total"].as_u64())
            .unwrap_or(0),
    })
}

/// Get the full PG map (all PGs with their states and stats).
pub async fn get_pg_map(session: &CephSession) -> Result<Value, CephError> {
    api_get(session, "/pg/dump").await
}

/// Initiate repair on a specific placement group.
pub async fn repair_pg(session: &CephSession, pgid: &str) -> Result<(), CephError> {
    if pgid.is_empty() {
        return Err(CephError::invalid_param("PG ID cannot be empty"));
    }
    let body = serde_json::json!({
        "pgid": pgid,
    });
    api_post(session, &format!("/pg/{}/repair", pgid), &body).await?;
    log::info!("Initiated repair for PG {}", pgid);
    Ok(())
}

/// Initiate a scrub on a specific placement group.
pub async fn scrub_pg(session: &CephSession, pgid: &str) -> Result<(), CephError> {
    if pgid.is_empty() {
        return Err(CephError::invalid_param("PG ID cannot be empty"));
    }
    let body = serde_json::json!({
        "pgid": pgid,
    });
    api_post(session, &format!("/pg/{}/scrub", pgid), &body).await?;
    log::info!("Initiated scrub for PG {}", pgid);
    Ok(())
}

/// Initiate a deep scrub on a specific placement group.
pub async fn deep_scrub_pg(session: &CephSession, pgid: &str) -> Result<(), CephError> {
    if pgid.is_empty() {
        return Err(CephError::invalid_param("PG ID cannot be empty"));
    }
    let body = serde_json::json!({
        "pgid": pgid,
    });
    api_post(session, &format!("/pg/{}/deep-scrub", pgid), &body).await?;
    log::info!("Initiated deep scrub for PG {}", pgid);
    Ok(())
}

/// List PGs that are stuck in a problematic state.
pub async fn list_stuck_pgs(
    session: &CephSession,
    stuck_type: Option<&str>,
    threshold_secs: Option<u64>,
) -> Result<Vec<PgInfo>, CephError> {
    let stype = stuck_type.unwrap_or("unclean");
    let valid_types = ["unclean", "inactive", "stale", "undersized", "degraded"];
    if !valid_types.contains(&stype) {
        return Err(CephError::invalid_param(format!(
            "Invalid stuck type: {}. Valid: {}",
            stype,
            valid_types.join(", ")
        )));
    }

    let mut path = format!("/pg/stuck?type={}", stype);
    if let Some(threshold) = threshold_secs {
        path = format!("{}&threshold={}", path, threshold);
    }

    let data = api_get(session, &path).await?;
    let mut pgs = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            pgs.push(parse_pg_info(item));
        }
    }
    Ok(pgs)
}

/// Get PGs in a specific state (e.g., "degraded", "recovering", "inconsistent").
pub async fn list_pgs_by_state(
    session: &CephSession,
    state: &str,
) -> Result<Vec<PgInfo>, CephError> {
    let all_pgs = list_pgs(session).await?;
    let filtered = all_pgs
        .into_iter()
        .filter(|pg| pg.state.contains(state))
        .collect();
    Ok(filtered)
}

/// Get PGs associated with a specific OSD.
pub async fn list_pgs_for_osd(
    session: &CephSession,
    osd_id: u32,
) -> Result<Vec<PgInfo>, CephError> {
    let data = api_get(session, &format!("/pg?osd={}", osd_id)).await?;
    let mut pgs = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            pgs.push(parse_pg_info(item));
        }
    }
    Ok(pgs)
}

/// Parse a PG state string into structured flags.
pub fn parse_pg_state(state: &str) -> PgStateFlags {
    PgStateFlags::from_state_string(state)
}

/// Get a count of PGs in each state.
pub async fn get_pg_state_counts(session: &CephSession) -> Result<HashMap<String, u32>, CephError> {
    let summary = get_pg_summary(session).await?;
    Ok(summary.states)
}

/// Initiate repair on all PGs in an inconsistent state.
pub async fn repair_all_inconsistent(session: &CephSession) -> Result<Vec<String>, CephError> {
    let inconsistent = list_pgs_by_state(session, "inconsistent").await?;
    let mut repaired = Vec::new();
    for pg in &inconsistent {
        match repair_pg(session, &pg.pgid).await {
            Ok(()) => repaired.push(pg.pgid.clone()),
            Err(e) => {
                log::warn!("Failed to repair PG {}: {}", pg.pgid, e);
            }
        }
    }
    log::info!("Initiated repair on {} inconsistent PGs", repaired.len());
    Ok(repaired)
}

/// Get the autoscaler status for each pool's PGs.
pub async fn get_pg_autoscale_status(session: &CephSession) -> Result<Value, CephError> {
    api_get(session, "/pg/autoscale_status").await
}

/// Get PG query result for a specific PG (detailed internal state).
pub async fn query_pg(session: &CephSession, pgid: &str) -> Result<Value, CephError> {
    api_get(session, &format!("/pg/{}/query", pgid)).await
}

/// Get historical PG events / log for a specific PG.
pub async fn get_pg_log(session: &CephSession, pgid: &str) -> Result<Value, CephError> {
    api_get(session, &format!("/pg/{}/log", pgid)).await
}

/// Force creation of a specific PG if it is stuck in creating state.
pub async fn force_create_pg(session: &CephSession, pgid: &str) -> Result<(), CephError> {
    let body = serde_json::json!({
        "pgid": pgid,
        "yes_i_really_mean_it": true,
    });
    api_post(session, &format!("/pg/{}/force_create", pgid), &body).await?;
    log::info!("Forced creation of PG {}", pgid);
    Ok(())
}

/// Force recovery of PGs for a specific pool or OSD.
pub async fn force_recovery(session: &CephSession, pgids: &[String]) -> Result<(), CephError> {
    if pgids.is_empty() {
        return Err(CephError::invalid_param("No PG IDs provided"));
    }
    for pgid in pgids {
        let body = serde_json::json!({ "pgid": pgid });
        api_post(session, &format!("/pg/{}/force_recovery", pgid), &body).await?;
    }
    log::info!("Forced recovery on {} PGs", pgids.len());
    Ok(())
}

/// Cancel forced recovery of PGs.
pub async fn cancel_force_recovery(
    session: &CephSession,
    pgids: &[String],
) -> Result<(), CephError> {
    if pgids.is_empty() {
        return Err(CephError::invalid_param("No PG IDs provided"));
    }
    for pgid in pgids {
        let body = serde_json::json!({ "pgid": pgid });
        api_post(
            session,
            &format!("/pg/{}/cancel_force_recovery", pgid),
            &body,
        )
        .await?;
    }
    log::info!("Cancelled forced recovery on {} PGs", pgids.len());
    Ok(())
}
