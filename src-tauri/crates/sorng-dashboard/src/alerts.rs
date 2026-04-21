//! Dashboard alert management.
//!
//! Generates alerts from health entries and provides CRUD-style operations
//! on the alert list.

use chrono::{Duration, Utc};
use uuid::Uuid;

use crate::types::*;

/// Manages the lifecycle of dashboard alerts.
pub struct DashboardAlertManager {
    alerts: Vec<DashboardAlert>,
    max_retention_hours: i64,
}

impl DashboardAlertManager {
    /// Create a new alert manager with the specified retention period.
    pub fn new(max_retention_hours: u64) -> Self {
        Self {
            alerts: Vec::new(),
            max_retention_hours: max_retention_hours as i64,
        }
    }

    /// Auto-generate alerts from the current set of health entries.
    ///
    /// Produces alerts for down, degraded, and high-latency connections.
    pub fn generate_alerts_from_health(entries: &[&ConnectionHealthEntry]) -> Vec<DashboardAlert> {
        let mut alerts = Vec::new();
        let now = Utc::now();

        for entry in entries {
            match entry.status {
                HealthStatus::Down => {
                    alerts.push(DashboardAlert {
                        id: Uuid::new_v4().to_string(),
                        severity: AlertSeverity::Critical,
                        title: format!("{} is down", entry.name),
                        message: format!(
                            "Connection {} ({}) is not responding. Errors: {}",
                            entry.name, entry.hostname, entry.error_count,
                        ),
                        connection_id: Some(entry.connection_id.clone()),
                        timestamp: now,
                        acknowledged: false,
                        alert_type: DashboardAlertType::ConnectionDown,
                    });
                }
                HealthStatus::Degraded => {
                    alerts.push(DashboardAlert {
                        id: Uuid::new_v4().to_string(),
                        severity: AlertSeverity::Warning,
                        title: format!("{} is degraded", entry.name),
                        message: format!(
                            "Connection {} has high latency: {:.1}ms",
                            entry.name,
                            entry.latency_ms.unwrap_or(0.0),
                        ),
                        connection_id: Some(entry.connection_id.clone()),
                        timestamp: now,
                        acknowledged: false,
                        alert_type: DashboardAlertType::HighLatency,
                    });
                }
                HealthStatus::Healthy => {
                    // Flag connections with latency > 500ms even if marked healthy.
                    if let Some(ms) = entry.latency_ms {
                        if ms > 500.0 {
                            alerts.push(DashboardAlert {
                                id: Uuid::new_v4().to_string(),
                                severity: AlertSeverity::Warning,
                                title: format!("{} high latency", entry.name),
                                message: format!(
                                    "Connection {} latency is {:.1}ms which exceeds threshold",
                                    entry.name, ms,
                                ),
                                connection_id: Some(entry.connection_id.clone()),
                                timestamp: now,
                                acknowledged: false,
                                alert_type: DashboardAlertType::HighLatency,
                            });
                        }
                    }
                }
                _ => {}
            }
        }

        alerts
    }

    /// Add an alert to the manager.
    pub fn add_alert(&mut self, alert: DashboardAlert) {
        self.alerts.push(alert);
    }

    /// Add multiple alerts at once.
    pub fn add_alerts(&mut self, alerts: Vec<DashboardAlert>) {
        self.alerts.extend(alerts);
    }

    /// Acknowledge an alert by ID.
    pub fn acknowledge_alert(&mut self, alert_id: &str) -> bool {
        if let Some(alert) = self.alerts.iter_mut().find(|a| a.id == alert_id) {
            alert.acknowledged = true;
            true
        } else {
            false
        }
    }

    /// Get all active (unacknowledged) alerts.
    pub fn get_active_alerts(&self) -> Vec<&DashboardAlert> {
        self.alerts.iter().filter(|a| !a.acknowledged).collect()
    }

    /// Get all alerts (including acknowledged).
    pub fn get_all_alerts(&self) -> &[DashboardAlert] {
        &self.alerts
    }

    /// Get alerts filtered by severity.
    pub fn get_by_severity(&self, severity: &AlertSeverity) -> Vec<&DashboardAlert> {
        self.alerts
            .iter()
            .filter(|a| a.severity == *severity)
            .collect()
    }

    /// Remove all acknowledged alerts.
    pub fn clear_acknowledged(&mut self) -> usize {
        let before = self.alerts.len();
        self.alerts.retain(|a| !a.acknowledged);
        before - self.alerts.len()
    }

    /// Remove alerts older than the retention period.
    pub fn cleanup_old(&mut self) -> usize {
        let cutoff = Utc::now() - Duration::hours(self.max_retention_hours);
        let before = self.alerts.len();
        self.alerts.retain(|a| a.timestamp > cutoff);
        before - self.alerts.len()
    }

    /// Return total alert count.
    pub fn len(&self) -> usize {
        self.alerts.len()
    }

    /// Check if the alert manager has no alerts.
    pub fn is_empty(&self) -> bool {
        self.alerts.is_empty()
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
            error_count: if status == HealthStatus::Down { 3 } else { 0 },
            last_error: None,
            group: None,
        }
    }

    #[test]
    fn test_generate_alerts_for_down() {
        let e = make_entry("c1", HealthStatus::Down, None);
        let entries: Vec<&ConnectionHealthEntry> = vec![&e];
        let alerts = DashboardAlertManager::generate_alerts_from_health(&entries);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].severity, AlertSeverity::Critical);
        assert_eq!(alerts[0].alert_type, DashboardAlertType::ConnectionDown);
    }

    #[test]
    fn test_generate_alerts_for_degraded() {
        let e = make_entry("c2", HealthStatus::Degraded, Some(800.0));
        let entries: Vec<&ConnectionHealthEntry> = vec![&e];
        let alerts = DashboardAlertManager::generate_alerts_from_health(&entries);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].severity, AlertSeverity::Warning);
    }

    #[test]
    fn test_acknowledge_alert() {
        let mut mgr = DashboardAlertManager::new(72);
        let alert = DashboardAlert {
            id: "a1".into(),
            severity: AlertSeverity::Warning,
            title: "test".into(),
            message: "msg".into(),
            connection_id: None,
            timestamp: Utc::now(),
            acknowledged: false,
            alert_type: DashboardAlertType::HighLatency,
        };
        mgr.add_alert(alert);
        assert_eq!(mgr.get_active_alerts().len(), 1);
        assert!(mgr.acknowledge_alert("a1"));
        assert_eq!(mgr.get_active_alerts().len(), 0);
    }

    #[test]
    fn test_clear_acknowledged() {
        let mut mgr = DashboardAlertManager::new(72);
        mgr.add_alert(DashboardAlert {
            id: "a1".into(),
            severity: AlertSeverity::Info,
            title: "t".into(),
            message: "m".into(),
            connection_id: None,
            timestamp: Utc::now(),
            acknowledged: true,
            alert_type: DashboardAlertType::HighLatency,
        });
        mgr.add_alert(DashboardAlert {
            id: "a2".into(),
            severity: AlertSeverity::Info,
            title: "t".into(),
            message: "m".into(),
            connection_id: None,
            timestamp: Utc::now(),
            acknowledged: false,
            alert_type: DashboardAlertType::HighLatency,
        });
        let removed = mgr.clear_acknowledged();
        assert_eq!(removed, 1);
        assert_eq!(mgr.len(), 1);
    }

    #[test]
    fn test_get_by_severity() {
        let mut mgr = DashboardAlertManager::new(72);
        mgr.add_alert(DashboardAlert {
            id: "a1".into(),
            severity: AlertSeverity::Critical,
            title: "t".into(),
            message: "m".into(),
            connection_id: None,
            timestamp: Utc::now(),
            acknowledged: false,
            alert_type: DashboardAlertType::ConnectionDown,
        });
        mgr.add_alert(DashboardAlert {
            id: "a2".into(),
            severity: AlertSeverity::Info,
            title: "t".into(),
            message: "m".into(),
            connection_id: None,
            timestamp: Utc::now(),
            acknowledged: false,
            alert_type: DashboardAlertType::HighLatency,
        });
        let critical = mgr.get_by_severity(&AlertSeverity::Critical);
        assert_eq!(critical.len(), 1);
        assert_eq!(critical[0].id, "a1");
    }
}
