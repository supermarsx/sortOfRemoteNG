//! Data aggregation and summary computation.
//!
//! Pure functions that consume slices of [`ConnectionHealthEntry`]
//! references and produce aggregated summaries.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};

use crate::types::*;

/// Build a full [`HealthSummary`] from a set of entries.
pub fn aggregate_health_summary(entries: &[&ConnectionHealthEntry]) -> HealthSummary {
    let total_connections = entries.len();
    let mut online: usize = 0;
    let mut offline: usize = 0;
    let mut degraded: usize = 0;
    let mut unknown: usize = 0;

    for entry in entries {
        match entry.status {
            HealthStatus::Healthy => online += 1,
            HealthStatus::Down => offline += 1,
            HealthStatus::Degraded => degraded += 1,
            HealthStatus::Unknown | HealthStatus::Unchecked => unknown += 1,
        }
    }

    let health_pct = if total_connections > 0 {
        (online as f64 / total_connections as f64) * 100.0
    } else {
        100.0
    };

    let by_protocol = aggregate_protocol_summary(entries);

    // Derive group membership from entries that have a group set.
    let mut group_map: HashMap<String, Vec<String>> = HashMap::new();
    for entry in entries {
        if let Some(ref grp) = entry.group {
            group_map
                .entry(grp.clone())
                .or_default()
                .push(entry.connection_id.clone());
        }
    }
    let by_group = aggregate_group_summary(entries, &group_map);

    HealthSummary {
        total_connections,
        online,
        offline,
        degraded,
        unknown,
        health_pct,
        by_protocol,
        by_group,
    }
}

/// Aggregate per-protocol statistics.
pub fn aggregate_protocol_summary(
    entries: &[&ConnectionHealthEntry],
) -> HashMap<String, ProtocolSummary> {
    let mut map: HashMap<String, Vec<&ConnectionHealthEntry>> = HashMap::new();
    for entry in entries {
        map.entry(entry.protocol.clone()).or_default().push(entry);
    }

    let mut result = HashMap::new();
    for (proto, group) in &map {
        let total = group.len();
        let online = group
            .iter()
            .filter(|e| e.status == HealthStatus::Healthy)
            .count();
        let offline = group
            .iter()
            .filter(|e| e.status == HealthStatus::Down)
            .count();

        let latencies: Vec<f64> = group.iter().filter_map(|e| e.latency_ms).collect();
        let avg_latency_ms = if latencies.is_empty() {
            None
        } else {
            Some(latencies.iter().sum::<f64>() / latencies.len() as f64)
        };

        result.insert(
            proto.clone(),
            ProtocolSummary {
                total,
                online,
                offline,
                avg_latency_ms,
            },
        );
    }
    result
}

/// Aggregate per-group statistics.
///
/// `groups` maps group name → list of connection IDs in that group.
pub fn aggregate_group_summary(
    entries: &[&ConnectionHealthEntry],
    groups: &HashMap<String, Vec<String>>,
) -> HashMap<String, GroupSummary> {
    let entry_map: HashMap<&str, &&ConnectionHealthEntry> = entries
        .iter()
        .map(|e| (e.connection_id.as_str(), e))
        .collect();

    let mut result = HashMap::new();
    for (group_name, ids) in groups {
        let mut total = 0usize;
        let mut online = 0usize;
        let mut offline = 0usize;

        for id in ids {
            if let Some(entry) = entry_map.get(id.as_str()) {
                total += 1;
                match entry.status {
                    HealthStatus::Healthy => online += 1,
                    HealthStatus::Down => offline += 1,
                    _ => {}
                }
            }
        }

        result.insert(
            group_name.clone(),
            GroupSummary {
                group_name: group_name.clone(),
                total,
                online,
                offline,
            },
        );
    }
    result
}

/// Compute [`QuickStats`] from health entries and session metadata.
pub fn compute_quick_stats(
    entries: &[&ConnectionHealthEntry],
    sessions: usize,
    last_backup: Option<DateTime<Utc>>,
    last_sync: Option<DateTime<Utc>>,
) -> QuickStats {
    let total_connections = entries.len();

    let protocols_used: Vec<String> = {
        let set: HashSet<&str> = entries.iter().map(|e| e.protocol.as_str()).collect();
        let mut v: Vec<String> = set.into_iter().map(String::from).collect();
        v.sort();
        v
    };

    let latencies: Vec<f64> = entries.iter().filter_map(|e| e.latency_ms).collect();
    let avg_latency_ms = if latencies.is_empty() {
        0.0
    } else {
        latencies.iter().sum::<f64>() / latencies.len() as f64
    };

    let uptime_vals: Vec<f64> = entries.iter().filter_map(|e| e.uptime_pct).collect();
    let uptime_pct = if uptime_vals.is_empty() {
        100.0
    } else {
        uptime_vals.iter().sum::<f64>() / uptime_vals.len() as f64
    };

    let recent_errors = entries.iter().filter(|e| e.error_count > 0).count();

    QuickStats {
        total_connections,
        active_sessions: sessions,
        protocols_used,
        avg_latency_ms,
        uptime_pct,
        recent_errors,
        last_backup,
        last_sync,
    }
}

/// Return the most recently checked connections, sorted by `last_checked`
/// descending.
pub fn get_recent_connections<'a>(
    entries: &[&'a ConnectionHealthEntry],
    count: usize,
) -> Vec<&'a ConnectionHealthEntry> {
    let mut sorted: Vec<&ConnectionHealthEntry> = entries.to_vec();
    sorted.sort_by(|a, b| {
        let ta = a.last_checked.unwrap_or_default();
        let tb = b.last_checked.unwrap_or_default();
        tb.cmp(&ta)
    });
    sorted.truncate(count);
    sorted
}

/// Return the connections with the highest latency, sorted descending.
pub fn get_top_latency<'a>(
    entries: &[&'a ConnectionHealthEntry],
    count: usize,
) -> Vec<&'a ConnectionHealthEntry> {
    let mut with_latency: Vec<&ConnectionHealthEntry> = entries
        .iter()
        .filter(|e| e.latency_ms.is_some())
        .copied()
        .collect();
    with_latency.sort_by(|a, b| {
        let la = a.latency_ms.unwrap_or(0.0);
        let lb = b.latency_ms.unwrap_or(0.0);
        lb.partial_cmp(&la).unwrap_or(std::cmp::Ordering::Equal)
    });
    with_latency.truncate(count);
    with_latency
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn make_entry(
        id: &str,
        protocol: &str,
        status: HealthStatus,
        latency: Option<f64>,
    ) -> ConnectionHealthEntry {
        ConnectionHealthEntry {
            connection_id: id.into(),
            name: id.into(),
            hostname: "host".into(),
            protocol: protocol.into(),
            status,
            latency_ms: latency,
            latency_history: vec![],
            last_checked: Some(Utc::now()),
            uptime_pct: Some(99.0),
            error_count: if status == HealthStatus::Down { 1 } else { 0 },
            last_error: None,
            group: None,
        }
    }

    #[test]
    fn test_aggregate_health_summary() {
        let e1 = make_entry("c1", "SSH", HealthStatus::Healthy, Some(20.0));
        let e2 = make_entry("c2", "RDP", HealthStatus::Down, None);
        let e3 = make_entry("c3", "SSH", HealthStatus::Healthy, Some(50.0));
        let entries: Vec<&ConnectionHealthEntry> = vec![&e1, &e2, &e3];

        let summary = aggregate_health_summary(&entries);
        assert_eq!(summary.total_connections, 3);
        assert_eq!(summary.online, 2);
        assert_eq!(summary.offline, 1);
        assert!((summary.health_pct - 66.666).abs() < 1.0);
    }

    #[test]
    fn test_protocol_summary() {
        let e1 = make_entry("c1", "SSH", HealthStatus::Healthy, Some(20.0));
        let e2 = make_entry("c2", "SSH", HealthStatus::Down, None);
        let e3 = make_entry("c3", "RDP", HealthStatus::Healthy, Some(50.0));
        let entries: Vec<&ConnectionHealthEntry> = vec![&e1, &e2, &e3];

        let protos = aggregate_protocol_summary(&entries);
        assert_eq!(protos["SSH"].total, 2);
        assert_eq!(protos["SSH"].online, 1);
        assert_eq!(protos["RDP"].total, 1);
    }

    #[test]
    fn test_quick_stats() {
        let e1 = make_entry("c1", "SSH", HealthStatus::Healthy, Some(20.0));
        let e2 = make_entry("c2", "RDP", HealthStatus::Healthy, Some(40.0));
        let entries: Vec<&ConnectionHealthEntry> = vec![&e1, &e2];

        let stats = compute_quick_stats(&entries, 5, None, None);
        assert_eq!(stats.total_connections, 2);
        assert_eq!(stats.active_sessions, 5);
        assert!((stats.avg_latency_ms - 30.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_top_latency() {
        let e1 = make_entry("c1", "SSH", HealthStatus::Healthy, Some(10.0));
        let e2 = make_entry("c2", "SSH", HealthStatus::Healthy, Some(100.0));
        let e3 = make_entry("c3", "SSH", HealthStatus::Healthy, Some(50.0));
        let entries: Vec<&ConnectionHealthEntry> = vec![&e1, &e2, &e3];

        let top = get_top_latency(&entries, 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].connection_id, "c2");
        assert_eq!(top[1].connection_id, "c3");
    }

    #[test]
    fn test_recent_connections() {
        let mut e1 = make_entry("c1", "SSH", HealthStatus::Healthy, Some(10.0));
        e1.last_checked = Some(Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap());
        let mut e2 = make_entry("c2", "SSH", HealthStatus::Healthy, Some(10.0));
        e2.last_checked = Some(Utc.with_ymd_and_hms(2025, 6, 1, 0, 0, 0).unwrap());
        let entries: Vec<&ConnectionHealthEntry> = vec![&e1, &e2];

        let recent = get_recent_connections(&entries, 1);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].connection_id, "c2");
    }
}
