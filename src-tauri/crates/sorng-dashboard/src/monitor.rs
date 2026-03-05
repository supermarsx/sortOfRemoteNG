//! Health monitoring and connection checking.
//!
//! [`HealthMonitor`] holds per-connection health entries, runs health
//! checks, records latency, and trims history to the configured maximum.

use std::collections::HashMap;
use std::time::Instant;

use chrono::Utc;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

use crate::error::DashboardError;
use crate::types::*;

/// Core health monitor that tracks connection health entries.
pub struct HealthMonitor {
    entries: HashMap<String, ConnectionHealthEntry>,
    config: DashboardConfig,
}

impl HealthMonitor {
    /// Create a new `HealthMonitor` with the given configuration.
    pub fn new(config: DashboardConfig) -> Self {
        Self {
            entries: HashMap::new(),
            config,
        }
    }

    /// Create with default configuration.
    pub fn with_defaults() -> Self {
        Self::new(DashboardConfig::default())
    }

    /// Return a reference to the current configuration.
    pub fn config(&self) -> &DashboardConfig {
        &self.config
    }

    /// Update the monitor configuration.
    pub fn set_config(&mut self, config: DashboardConfig) {
        self.config = config;
    }

    // ── Health checking ─────────────────────────────────────────

    /// Perform a health check for a single connection.
    ///
    /// Attempts a TCP connection to `hostname:port` and measures latency.
    /// Falls back to simulated results when the connection cannot be
    /// established (e.g. during unit tests or unreachable hosts).
    pub async fn check_connection_health(
        &mut self,
        id: &str,
        hostname: &str,
        port: u16,
        protocol: &str,
    ) -> ConnectionHealthEntry {
        let start = Instant::now();
        let addr = format!("{hostname}:{port}");
        let check_timeout = Duration::from_millis(self.config.health_check_timeout_ms);

        let (status, latency_ms, error_msg) =
            match timeout(check_timeout, TcpStream::connect(&addr)).await {
                Ok(Ok(_stream)) => {
                    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                    let status = if elapsed > 1000.0 {
                        HealthStatus::Degraded
                    } else {
                        HealthStatus::Healthy
                    };
                    (status, Some(elapsed), None)
                }
                Ok(Err(e)) => (HealthStatus::Down, None, Some(e.to_string())),
                Err(_) => (
                    HealthStatus::Down,
                    None,
                    Some("health check timed out".to_string()),
                ),
            };

        let now = Utc::now();

        // Build or update the entry.
        let entry = if let Some(existing) = self.entries.get(id) {
            let mut updated = existing.clone();
            updated.status = status;
            updated.latency_ms = latency_ms;
            updated.last_checked = Some(now);
            if let Some(ref err) = error_msg {
                updated.error_count += 1;
                updated.last_error = Some(err.clone());
            }
            // Record latency history.
            if let Some(ms) = latency_ms {
                updated.latency_history.push(LatencyPoint {
                    timestamp: now,
                    latency_ms: ms,
                });
                // Trim history.
                let max = self.config.max_latency_history;
                if updated.latency_history.len() > max {
                    let excess = updated.latency_history.len() - max;
                    updated.latency_history.drain(..excess);
                }
            }
            // Recompute uptime percentage.
            updated.uptime_pct = Some(Self::compute_uptime(&updated));
            updated
        } else {
            let mut history = Vec::new();
            if let Some(ms) = latency_ms {
                history.push(LatencyPoint {
                    timestamp: now,
                    latency_ms: ms,
                });
            }
            ConnectionHealthEntry {
                connection_id: id.to_string(),
                name: hostname.to_string(),
                hostname: hostname.to_string(),
                protocol: protocol.to_string(),
                status,
                latency_ms,
                latency_history: history,
                last_checked: Some(now),
                uptime_pct: if error_msg.is_some() {
                    Some(0.0)
                } else {
                    Some(100.0)
                },
                error_count: if error_msg.is_some() { 1 } else { 0 },
                last_error: error_msg,
                group: None,
            }
        };

        self.entries.insert(id.to_string(), entry.clone());
        entry
    }

    // ── Entry management ────────────────────────────────────────

    /// Insert or replace an entry directly.
    pub fn update_entry(&mut self, id: &str, entry: ConnectionHealthEntry) {
        self.entries.insert(id.to_string(), entry);
    }

    /// Get an entry by connection ID.
    pub fn get_entry(&self, id: &str) -> Option<&ConnectionHealthEntry> {
        self.entries.get(id)
    }

    /// Return references to all entries.
    pub fn get_all_entries(&self) -> Vec<&ConnectionHealthEntry> {
        self.entries.values().collect()
    }

    /// Return entries that are not healthy.
    pub fn get_unhealthy(&self) -> Vec<&ConnectionHealthEntry> {
        self.entries
            .values()
            .filter(|e| e.status != HealthStatus::Healthy)
            .collect()
    }

    /// Record a latency sample for an existing entry.
    pub fn record_latency(
        &mut self,
        id: &str,
        latency_ms: f64,
    ) -> Result<(), DashboardError> {
        let max = self.config.max_latency_history;
        let entry = self
            .entries
            .get_mut(id)
            .ok_or_else(|| DashboardError::ConnectionNotFound(id.to_string()))?;

        entry.latency_ms = Some(latency_ms);
        entry.latency_history.push(LatencyPoint {
            timestamp: Utc::now(),
            latency_ms,
        });
        if entry.latency_history.len() > max {
            let excess = entry.latency_history.len() - max;
            entry.latency_history.drain(..excess);
        }
        Ok(())
    }

    /// Derive a [`HealthStatus`] from an entry's recent metrics.
    pub fn get_health_status_for(entry: &ConnectionHealthEntry) -> HealthStatus {
        match entry.latency_ms {
            None => {
                if entry.error_count > 0 {
                    HealthStatus::Down
                } else {
                    HealthStatus::Unknown
                }
            }
            Some(ms) if ms > 2000.0 => HealthStatus::Down,
            Some(ms) if ms > 500.0 => HealthStatus::Degraded,
            Some(_) => HealthStatus::Healthy,
        }
    }

    // ── Internal helpers ────────────────────────────────────────

    /// Simple uptime approximation based on error count vs total checks.
    fn compute_uptime(entry: &ConnectionHealthEntry) -> f64 {
        let total_checks = entry.latency_history.len() as f64 + entry.error_count as f64;
        if total_checks == 0.0 {
            return 100.0;
        }
        let successful = entry.latency_history.len() as f64;
        (successful / total_checks) * 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_status_for_healthy() {
        let entry = ConnectionHealthEntry {
            connection_id: "c1".into(),
            name: "Test".into(),
            hostname: "host".into(),
            protocol: "SSH".into(),
            status: HealthStatus::Healthy,
            latency_ms: Some(42.0),
            latency_history: vec![],
            last_checked: None,
            uptime_pct: None,
            error_count: 0,
            last_error: None,
            group: None,
        };
        assert_eq!(
            HealthMonitor::get_health_status_for(&entry),
            HealthStatus::Healthy
        );
    }

    #[test]
    fn test_health_status_for_degraded() {
        let entry = ConnectionHealthEntry {
            connection_id: "c2".into(),
            name: "Slow".into(),
            hostname: "host".into(),
            protocol: "SSH".into(),
            status: HealthStatus::Healthy,
            latency_ms: Some(800.0),
            latency_history: vec![],
            last_checked: None,
            uptime_pct: None,
            error_count: 0,
            last_error: None,
            group: None,
        };
        assert_eq!(
            HealthMonitor::get_health_status_for(&entry),
            HealthStatus::Degraded
        );
    }

    #[test]
    fn test_health_status_for_down() {
        let entry = ConnectionHealthEntry {
            connection_id: "c3".into(),
            name: "Down".into(),
            hostname: "host".into(),
            protocol: "RDP".into(),
            status: HealthStatus::Healthy,
            latency_ms: None,
            latency_history: vec![],
            last_checked: None,
            uptime_pct: None,
            error_count: 3,
            last_error: Some("connection refused".into()),
            group: None,
        };
        assert_eq!(
            HealthMonitor::get_health_status_for(&entry),
            HealthStatus::Down
        );
    }

    #[test]
    fn test_record_latency_trims_history() {
        let mut config = DashboardConfig::default();
        config.max_latency_history = 5;
        let mut monitor = HealthMonitor::new(config);

        let entry = ConnectionHealthEntry {
            connection_id: "c1".into(),
            name: "Test".into(),
            hostname: "host".into(),
            protocol: "SSH".into(),
            status: HealthStatus::Healthy,
            latency_ms: None,
            latency_history: vec![],
            last_checked: None,
            uptime_pct: None,
            error_count: 0,
            last_error: None,
            group: None,
        };
        monitor.update_entry("c1", entry);

        for i in 0..10 {
            monitor.record_latency("c1", i as f64 * 10.0).unwrap();
        }

        let e = monitor.get_entry("c1").unwrap();
        assert_eq!(e.latency_history.len(), 5);
        // Should have kept the last 5 entries.
        assert!((e.latency_history[0].latency_ms - 50.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_get_unhealthy() {
        let mut monitor = HealthMonitor::with_defaults();

        let healthy = ConnectionHealthEntry {
            connection_id: "h1".into(),
            name: "OK".into(),
            hostname: "h".into(),
            protocol: "SSH".into(),
            status: HealthStatus::Healthy,
            latency_ms: Some(10.0),
            latency_history: vec![],
            last_checked: None,
            uptime_pct: None,
            error_count: 0,
            last_error: None,
            group: None,
        };
        let down = ConnectionHealthEntry {
            connection_id: "d1".into(),
            name: "Down".into(),
            hostname: "h".into(),
            protocol: "RDP".into(),
            status: HealthStatus::Down,
            latency_ms: None,
            latency_history: vec![],
            last_checked: None,
            uptime_pct: None,
            error_count: 1,
            last_error: None,
            group: None,
        };

        monitor.update_entry("h1", healthy);
        monitor.update_entry("d1", down);

        let unhealthy = monitor.get_unhealthy();
        assert_eq!(unhealthy.len(), 1);
        assert_eq!(unhealthy[0].connection_id, "d1");
    }
}
