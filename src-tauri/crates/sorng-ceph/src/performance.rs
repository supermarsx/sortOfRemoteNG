use chrono::TimeZone;
use serde_json::Value;

use crate::cluster::{api_get, api_post};
use crate::error::{CephError, CephErrorKind};
use crate::types::*;

// ---------------------------------------------------------------------------
// Cluster-wide Performance Metrics
// ---------------------------------------------------------------------------

/// Get cluster-wide IOPS (read and write operations per second).
pub async fn get_cluster_iops(session: &CephSession) -> Result<(u64, u64), CephError> {
    let data = api_get(session, "/health/full").await?;

    let pgmap = &data["pgmap"];
    let read_ops = pgmap["read_op_per_sec"]
        .as_u64()
        .or_else(|| pgmap["op_per_sec"].as_u64())
        .unwrap_or(0);
    let write_ops = pgmap["write_op_per_sec"].as_u64().unwrap_or(0);

    Ok((read_ops, write_ops))
}

/// Get cluster-wide throughput (read and write bytes per second).
pub async fn get_cluster_throughput(session: &CephSession) -> Result<(u64, u64), CephError> {
    let data = api_get(session, "/health/full").await?;

    let pgmap = &data["pgmap"];
    let read_bps = pgmap["read_bytes_sec"]
        .as_u64()
        .or_else(|| pgmap["read_bytes_per_sec"].as_u64())
        .unwrap_or(0);
    let write_bps = pgmap["write_bytes_sec"]
        .as_u64()
        .or_else(|| pgmap["write_bytes_per_sec"].as_u64())
        .unwrap_or(0);

    Ok((read_bps, write_bps))
}

/// Get cluster-wide latency (average commit and apply latency in ms).
pub async fn get_cluster_latency(session: &CephSession) -> Result<(f64, f64), CephError> {
    let perf = api_get(session, "/osd/perf").await?;

    let mut total_commit = 0.0f64;
    let mut total_apply = 0.0f64;
    let mut count = 0u32;

    if let Some(infos) = perf["osd_perf_infos"].as_array() {
        for info in infos {
            let ps = &info["perf_stats"];
            total_commit += ps["commit_latency_ms"].as_f64().unwrap_or(0.0);
            total_apply += ps["apply_latency_ms"].as_f64().unwrap_or(0.0);
            count += 1;
        }
    }

    let avg_commit = if count > 0 { total_commit / count as f64 } else { 0.0 };
    let avg_apply = if count > 0 { total_apply / count as f64 } else { 0.0 };

    Ok((avg_commit, avg_apply))
}

/// Get comprehensive performance metrics for the cluster.
pub async fn get_perf_metrics(session: &CephSession) -> Result<PerfMetrics, CephError> {
    let health = api_get(session, "/health/full").await?;
    let pgmap = &health["pgmap"];

    let read_ops = pgmap["read_op_per_sec"].as_u64().unwrap_or(0);
    let write_ops = pgmap["write_op_per_sec"].as_u64().unwrap_or(0);
    let read_bps = pgmap["read_bytes_sec"].as_u64().unwrap_or(0);
    let write_bps = pgmap["write_bytes_sec"].as_u64().unwrap_or(0);
    let recovery_bps = pgmap["recovering_bytes_per_sec"].as_u64().unwrap_or(0);
    let misplaced = pgmap["misplaced_objects"].as_u64().unwrap_or(0);
    let degraded = pgmap["degraded_objects"].as_u64().unwrap_or(0);

    let (avg_commit, avg_apply) = get_cluster_latency(session).await.unwrap_or((0.0, 0.0));

    Ok(PerfMetrics {
        iops_read: read_ops,
        iops_write: write_ops,
        throughput_read_bps: read_bps,
        throughput_write_bps: write_bps,
        latency_read_ms: avg_commit,
        latency_write_ms: avg_apply,
        recovery_rate_bps: recovery_bps,
        misplaced_objects: misplaced,
        degraded_objects: degraded,
        client_io: ClientIo {
            read_ops_per_sec: read_ops,
            write_ops_per_sec: write_ops,
            read_bytes_per_sec: read_bps,
            write_bytes_per_sec: write_bps,
        },
    })
}

/// Get slow requests (operations exceeding the threshold).
pub async fn get_slow_requests(session: &CephSession) -> Result<Vec<SlowRequest>, CephError> {
    let data = api_get(session, "/health/full").await?;
    let mut slow_reqs = Vec::new();

    // Check health checks for slow requests
    if let Some(checks) = data["checks"].as_object() {
        for (code, check_val) in checks {
            if code.contains("SLOW") || code.contains("REQUEST") {
                if let Some(details) = check_val["detail"].as_array() {
                    for detail in details {
                        let msg = detail["message"].as_str().unwrap_or("");
                        let osd = extract_osd_from_message(msg);
                        slow_reqs.push(SlowRequest {
                            ops_in_flight: 1,
                            duration_ms: extract_duration_from_message(msg),
                            description: msg.to_string(),
                            initiated_at: None,
                            osd,
                            type_name: code.clone(),
                        });
                    }
                }
            }
        }
    }

    // Also try the dedicated slow_request endpoint
    if let Ok(sr_data) = api_get(session, "/osd/slow_request").await {
        if let Some(arr) = sr_data.as_array() {
            for item in arr {
                slow_reqs.push(SlowRequest {
                    ops_in_flight: item["ops_in_flight"].as_u64().unwrap_or(1) as u32,
                    duration_ms: item["duration"].as_f64().unwrap_or(0.0) * 1000.0,
                    description: item["description"]
                        .as_str()
                        .or_else(|| item["message"].as_str())
                        .unwrap_or("")
                        .to_string(),
                    initiated_at: item["initiated_at"]
                        .as_str()
                        .and_then(|s| s.parse().ok()),
                    osd: item["osd"].as_str().map(String::from),
                    type_name: item["type"].as_str().unwrap_or("osd_op").to_string(),
                });
            }
        }
    }

    Ok(slow_reqs)
}

fn extract_osd_from_message(msg: &str) -> Option<String> {
    // Try to find "osd.N" pattern
    for word in msg.split_whitespace() {
        if word.starts_with("osd.") {
            return Some(word.trim_end_matches(|c: char| !c.is_ascii_digit() && c != '.').to_string());
        }
    }
    None
}

fn extract_duration_from_message(msg: &str) -> f64 {
    // Try extracting numeric duration from messages like "1 ops are blocked > 32.768s"
    for word in msg.split_whitespace() {
        let trimmed = word.trim_end_matches('s');
        if let Ok(val) = trimmed.parse::<f64>() {
            if val > 0.0 {
                return val * 1000.0;
            }
        }
    }
    0.0
}

/// Get per-OSD performance counters.
pub async fn get_osd_perf(session: &CephSession) -> Result<Vec<OsdPerfCounters>, CephError> {
    let data = api_get(session, "/osd/perf").await?;
    let mut counters = Vec::new();

    if let Some(infos) = data["osd_perf_infos"].as_array() {
        for info in infos {
            let osd_id = info["id"].as_u64().unwrap_or(0) as u32;
            let ps = &info["perf_stats"];

            counters.push(OsdPerfCounters {
                osd_id,
                commit_latency_ms: ps["commit_latency_ms"].as_f64().unwrap_or(0.0),
                apply_latency_ms: ps["apply_latency_ms"].as_f64().unwrap_or(0.0),
                op_r: 0,
                op_w: 0,
                op_rw: 0,
                op_r_out_bytes: 0,
                op_w_in_bytes: 0,
                subop: 0,
                subop_in_bytes: 0,
                subop_latency_ms: 0.0,
                recovery_ops: 0,
                loadavg: 0.0,
                buffer_bytes: 0,
            });
        }
    }

    // Enrich with per-daemon perf counters if available
    for counter in &mut counters {
        if let Ok(daemon_perf) = api_get(
            session,
            &format!("/daemon/osd.{}/perf_counters", counter.osd_id),
        )
        .await
        {
            let osd = &daemon_perf["osd"];
            counter.op_r = osd["op_r"].as_u64().unwrap_or(0);
            counter.op_w = osd["op_w"].as_u64().unwrap_or(0);
            counter.op_rw = osd["op_rw"].as_u64().unwrap_or(0);
            counter.op_r_out_bytes = osd["op_r_out_bytes"].as_u64().unwrap_or(0);
            counter.op_w_in_bytes = osd["op_w_in_bytes"].as_u64().unwrap_or(0);
            counter.subop = osd["subop"].as_u64().unwrap_or(0);
            counter.subop_in_bytes = osd["subop_in_bytes"].as_u64().unwrap_or(0);
            counter.subop_latency_ms = osd["subop_latency"]["avgtime"]
                .as_f64()
                .unwrap_or(0.0) * 1000.0;
            counter.recovery_ops = osd["recovery_ops"].as_u64().unwrap_or(0);
            counter.loadavg = osd["loadavg"].as_f64().unwrap_or(0.0);
            counter.buffer_bytes = osd["buffer_bytes"].as_u64().unwrap_or(0);
        }
    }

    Ok(counters)
}

/// Get per-pool performance statistics.
pub async fn get_pool_perf(session: &CephSession) -> Result<Vec<PoolStats>, CephError> {
    let data = api_get(session, "/pool/stats").await?;
    let mut stats = Vec::new();

    if let Some(arr) = data.as_array() {
        for item in arr {
            let client_io = PoolIoRate {
                read_ops_per_sec: item["client_io_rate"]["read_op_per_sec"]
                    .as_u64()
                    .unwrap_or(0),
                write_ops_per_sec: item["client_io_rate"]["write_op_per_sec"]
                    .as_u64()
                    .unwrap_or(0),
                read_bytes_per_sec: item["client_io_rate"]["read_bytes_sec"]
                    .as_u64()
                    .unwrap_or(0),
                write_bytes_per_sec: item["client_io_rate"]["write_bytes_sec"]
                    .as_u64()
                    .unwrap_or(0),
            };
            let recovery_rate = PoolRecoveryRate {
                recovering_objects_per_sec: item["recovery_rate"]["recovering_objects_per_sec"]
                    .as_u64()
                    .unwrap_or(0),
                recovering_bytes_per_sec: item["recovery_rate"]["recovering_bytes_per_sec"]
                    .as_u64()
                    .unwrap_or(0),
                recovering_keys_per_sec: item["recovery_rate"]["recovering_keys_per_sec"]
                    .as_u64()
                    .unwrap_or(0),
            };
            stats.push(PoolStats {
                pool_name: item["pool_name"].as_str().unwrap_or("").to_string(),
                pool_id: item["pool_id"].as_u64().unwrap_or(0) as u32,
                client_io_rate: client_io,
                recovery_rate,
            });
        }
    }
    Ok(stats)
}

/// Get a comprehensive overview of all performance metrics.
pub async fn get_performance_counters(session: &CephSession) -> Result<Value, CephError> {
    let perf = get_perf_metrics(session).await?;
    let slow = get_slow_requests(session).await.unwrap_or_default();

    Ok(serde_json::json!({
        "cluster": {
            "iops_read": perf.iops_read,
            "iops_write": perf.iops_write,
            "throughput_read_bps": perf.throughput_read_bps,
            "throughput_write_bps": perf.throughput_write_bps,
            "latency_read_ms": perf.latency_read_ms,
            "latency_write_ms": perf.latency_write_ms,
            "recovery_rate_bps": perf.recovery_rate_bps,
            "misplaced_objects": perf.misplaced_objects,
            "degraded_objects": perf.degraded_objects,
        },
        "client_io": {
            "read_ops_per_sec": perf.client_io.read_ops_per_sec,
            "write_ops_per_sec": perf.client_io.write_ops_per_sec,
            "read_bytes_per_sec": perf.client_io.read_bytes_per_sec,
            "write_bytes_per_sec": perf.client_io.write_bytes_per_sec,
        },
        "slow_requests_count": slow.len(),
        "slow_requests": slow.iter().take(50).map(|s| serde_json::json!({
            "duration_ms": s.duration_ms,
            "description": s.description,
            "osd": s.osd,
            "type": s.type_name,
        })).collect::<Vec<_>>(),
    }))
}

/// Get recovery progress for the cluster.
pub async fn get_recovery_progress(session: &CephSession) -> Result<RecoveryProgress, CephError> {
    let health = api_get(session, "/health/full").await?;
    let pgmap = &health["pgmap"];

    Ok(RecoveryProgress {
        objects_recovered: pgmap["recovering_objects"].as_u64().unwrap_or(0),
        objects_total: pgmap["misplaced_total"]
            .as_u64()
            .or_else(|| pgmap["degraded_total"].as_u64())
            .unwrap_or(0),
        bytes_recovered: pgmap["recovering_bytes"].as_u64().unwrap_or(0),
        bytes_total: pgmap["misplaced_bytes_total"].as_u64().unwrap_or(0),
        recovery_rate_bps: pgmap["recovering_bytes_per_sec"].as_u64().unwrap_or(0),
        estimated_time_remaining_secs: None,
        active_pgs_recovering: pgmap["num_pgs_recovering"].as_u64().unwrap_or(0) as u32,
    })
}

/// Get historical performance time-series data for a metric.
pub async fn get_perf_history(
    session: &CephSession,
    metric: &str,
    duration_secs: Option<u64>,
) -> Result<Vec<PerfDataPoint>, CephError> {
    let dur = duration_secs.unwrap_or(3600);
    let data = api_get(
        session,
        &format!("/perf_counters?metric={}&duration={}", metric, dur),
    )
    .await?;

    let mut points = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            if let (Some(ts), Some(val)) = (
                item["timestamp"].as_i64().or_else(|| {
                    item["timestamp"]
                        .as_str()
                        .and_then(|s| s.parse::<i64>().ok())
                }),
                item["value"].as_f64(),
            ) {
                points.push(PerfDataPoint {
                    timestamp: chrono::Utc.timestamp_opt(ts, 0)
                        .single()
                        .unwrap_or_else(chrono::Utc::now),
                    value: val,
                });
            }
        }
    }
    Ok(points)
}
