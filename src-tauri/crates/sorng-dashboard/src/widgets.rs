//! Widget data generation for the dashboard UI.
//!
//! Each `build_*` function produces a `serde_json::Value` payload
//! suitable for rendering by the frontend widget component.

use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::aggregator;
use crate::types::*;

/// Build the status heatmap widget data.
///
/// Returns an array of `{ id, name, status, latency }`.
pub fn build_status_heatmap(entries: &[&ConnectionHealthEntry]) -> Value {
    let items: Vec<Value> = entries
        .iter()
        .map(|e| {
            json!({
                "id": e.connection_id,
                "name": e.name,
                "status": format!("{:?}", e.status),
                "latency": e.latency_ms,
                "protocol": e.protocol,
            })
        })
        .collect();
    json!({ "connections": items })
}

/// Build recent-connections widget data, sorted by last_checked descending.
pub fn build_recent_connections(entries: &[&ConnectionHealthEntry], count: usize) -> Value {
    let recent = aggregator::get_recent_connections(entries, count);
    let items: Vec<Value> = recent
        .iter()
        .map(|e| {
            json!({
                "id": e.connection_id,
                "name": e.name,
                "hostname": e.hostname,
                "protocol": e.protocol,
                "status": format!("{:?}", e.status),
                "latency_ms": e.latency_ms,
                "last_checked": e.last_checked,
            })
        })
        .collect();
    json!({ "recent": items })
}

/// Build latency sparkline data for the top-N connections by latency.
pub fn build_latency_sparklines(entries: &[&ConnectionHealthEntry], count: usize) -> Value {
    let mut with_history: Vec<&&ConnectionHealthEntry> = entries
        .iter()
        .filter(|e| !e.latency_history.is_empty())
        .collect();
    with_history.sort_by(|a, b| {
        let la = a.latency_ms.unwrap_or(0.0);
        let lb = b.latency_ms.unwrap_or(0.0);
        lb.partial_cmp(&la).unwrap_or(std::cmp::Ordering::Equal)
    });
    with_history.truncate(count);

    let items: Vec<Value> = with_history
        .iter()
        .map(|e| {
            let points: Vec<f64> = e.latency_history.iter().map(|p| p.latency_ms).collect();
            json!({
                "id": e.connection_id,
                "name": e.name,
                "current_latency": e.latency_ms,
                "points": points,
            })
        })
        .collect();
    json!({ "sparklines": items })
}

/// Build the alert feed widget data.
pub fn build_alert_feed(alerts: &[DashboardAlert], count: usize) -> Value {
    let mut sorted = alerts.to_vec();
    sorted.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    sorted.truncate(count);

    let items: Vec<Value> = sorted
        .iter()
        .map(|a| {
            json!({
                "id": a.id,
                "severity": format!("{:?}", a.severity),
                "title": a.title,
                "message": a.message,
                "connection_id": a.connection_id,
                "timestamp": a.timestamp,
                "acknowledged": a.acknowledged,
                "alert_type": format!("{:?}", a.alert_type),
            })
        })
        .collect();
    json!({ "alerts": items })
}

/// Build protocol breakdown widget data.
pub fn build_protocol_breakdown(summary: &HealthSummary) -> Value {
    let items: Vec<Value> = summary
        .by_protocol
        .iter()
        .map(|(proto, ps)| {
            json!({
                "protocol": proto,
                "total": ps.total,
                "online": ps.online,
                "offline": ps.offline,
                "avg_latency_ms": ps.avg_latency_ms,
            })
        })
        .collect();
    json!({ "protocols": items, "total_connections": summary.total_connections })
}

/// Build uptime chart widget data.
pub fn build_uptime_chart(entries: &[&ConnectionHealthEntry]) -> Value {
    let items: Vec<Value> = entries
        .iter()
        .filter(|e| e.uptime_pct.is_some())
        .map(|e| {
            json!({
                "id": e.connection_id,
                "name": e.name,
                "uptime_pct": e.uptime_pct,
                "error_count": e.error_count,
            })
        })
        .collect();
    json!({ "uptime_data": items })
}

/// Build certificate expiry widget data.
///
/// `certs` is a list of `(connection_id_or_name, expiry_time)` pairs.
pub fn build_cert_expiry_widget(certs: &[(String, DateTime<Utc>)]) -> Value {
    let now = Utc::now();
    let items: Vec<Value> = certs
        .iter()
        .map(|(name, expiry)| {
            let days_remaining = (*expiry - now).num_days();
            let severity = if days_remaining < 0 {
                "expired"
            } else if days_remaining < 7 {
                "critical"
            } else if days_remaining < 30 {
                "warning"
            } else {
                "ok"
            };
            json!({
                "name": name,
                "expiry": expiry,
                "days_remaining": days_remaining,
                "severity": severity,
            })
        })
        .collect();
    json!({ "certificates": items })
}

/// Build a complete [`WidgetData`] for the specified widget type.
pub fn build_widget_data(
    widget_type: &WidgetType,
    entries: &[&ConnectionHealthEntry],
    alerts: &[DashboardAlert],
    summary: &HealthSummary,
) -> WidgetData {
    let (title, data) = match widget_type {
        WidgetType::StatusHeatMap => ("Status Heat Map".into(), build_status_heatmap(entries)),
        WidgetType::RecentConnections => (
            "Recent Connections".into(),
            build_recent_connections(entries, 10),
        ),
        WidgetType::LatencySparklines => (
            "Latency Sparklines".into(),
            build_latency_sparklines(entries, 10),
        ),
        WidgetType::AlertFeed => ("Alert Feed".into(), build_alert_feed(alerts, 20)),
        WidgetType::QuickStats => {
            let qs = aggregator::compute_quick_stats(entries, 0, None, None);
            (
                "Quick Stats".into(),
                serde_json::to_value(&qs).unwrap_or_default(),
            )
        }
        WidgetType::ProtocolBreakdown => (
            "Protocol Breakdown".into(),
            build_protocol_breakdown(summary),
        ),
        WidgetType::ConnectionList => {
            let items: Vec<Value> = entries
                .iter()
                .map(|e| {
                    serde_json::json!({
                        "id": e.connection_id,
                        "name": e.name,
                        "hostname": e.hostname,
                        "protocol": e.protocol,
                        "status": format!("{:?}", e.status),
                        "latency_ms": e.latency_ms,
                    })
                })
                .collect();
            ("Connection List".into(), json!({ "connections": items }))
        }
        WidgetType::UptimeChart => ("Uptime Chart".into(), build_uptime_chart(entries)),
        WidgetType::CertificateExpiry => {
            // No cert data available at widget-build time; return empty.
            ("Certificate Expiry".into(), build_cert_expiry_widget(&[]))
        }
        WidgetType::TopLatency => {
            let top = aggregator::get_top_latency(entries, 10);
            let items: Vec<Value> = top
                .iter()
                .map(|e| {
                    json!({
                        "id": e.connection_id,
                        "name": e.name,
                        "latency_ms": e.latency_ms,
                        "protocol": e.protocol,
                    })
                })
                .collect();
            ("Top Latency".into(), json!({ "connections": items }))
        }
        WidgetType::GroupOverview => {
            let groups: Vec<Value> = summary
                .by_group
                .values()
                .map(|g| {
                    json!({
                        "group_name": g.group_name,
                        "total": g.total,
                        "online": g.online,
                        "offline": g.offline,
                    })
                })
                .collect();
            ("Group Overview".into(), json!({ "groups": groups }))
        }
        WidgetType::Custom(name) => (format!("Custom: {name}"), json!({ "custom": name })),
    };

    WidgetData {
        id: Uuid::new_v4().to_string(),
        widget_type: widget_type.clone(),
        title,
        position: WidgetPosition { row: 0, col: 0 },
        size: WidgetSize {
            width: 4,
            height: 2,
        },
        data,
        last_updated: Utc::now(),
        refresh_interval_seconds: 60,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_entry(id: &str, status: HealthStatus, latency: Option<f64>) -> ConnectionHealthEntry {
        ConnectionHealthEntry {
            connection_id: id.into(),
            name: id.into(),
            hostname: "host".into(),
            protocol: "SSH".into(),
            status,
            latency_ms: latency,
            latency_history: vec![],
            last_checked: Some(Utc::now()),
            uptime_pct: Some(99.0),
            error_count: 0,
            last_error: None,
            group: None,
        }
    }

    #[test]
    fn test_build_status_heatmap() {
        let e1 = make_entry("c1", HealthStatus::Healthy, Some(10.0));
        let e2 = make_entry("c2", HealthStatus::Down, None);
        let entries: Vec<&ConnectionHealthEntry> = vec![&e1, &e2];

        let val = build_status_heatmap(&entries);
        let conns = val["connections"].as_array().unwrap();
        assert_eq!(conns.len(), 2);
    }

    #[test]
    fn test_build_widget_data() {
        let e1 = make_entry("c1", HealthStatus::Healthy, Some(10.0));
        let entries: Vec<&ConnectionHealthEntry> = vec![&e1];
        let summary = crate::aggregator::aggregate_health_summary(&entries);

        let widget = build_widget_data(&WidgetType::StatusHeatMap, &entries, &[], &summary);
        assert_eq!(widget.title, "Status Heat Map");
        assert!(widget.data["connections"].is_array());
    }
}
