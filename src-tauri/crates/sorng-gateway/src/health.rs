//! # Health Monitor
//!
//! Self-diagnostics and health check system for the gateway.
//! Provides health check endpoints and component status reporting.

use crate::metrics::MetricsCollector;
use crate::session::SessionManager;
use crate::types::*;
use chrono::Utc;

/// Monitors gateway health and provides health check endpoints.
pub struct HealthMonitor {
    /// Custom health check functions (name → check_fn result)
    custom_checks: Vec<(String, HealthStatus, Option<String>)>,
}

impl HealthMonitor {
    pub fn new() -> Self {
        Self {
            custom_checks: Vec::new(),
        }
    }

    /// Perform a comprehensive health check.
    pub fn check(
        &self,
        info: &GatewayInfo,
        sessions: &SessionManager,
        metrics: &MetricsCollector,
    ) -> GatewayHealth {
        let now = Utc::now();
        let uptime = now
            .signed_duration_since(info.started_at)
            .num_seconds()
            .max(0) as u64;

        let active_sessions = sessions.active_count();
        let snapshot = metrics.snapshot();

        let mut checks = Vec::new();

        // Check 1: Session capacity
        let session_check = if active_sessions < 800 {
            HealthCheck {
                name: "session_capacity".to_string(),
                status: HealthStatus::Healthy,
                message: Some(format!("{} active sessions", active_sessions)),
                response_time_ms: None,
            }
        } else if active_sessions < 950 {
            HealthCheck {
                name: "session_capacity".to_string(),
                status: HealthStatus::Degraded,
                message: Some(format!(
                    "{} active sessions (approaching limit)",
                    active_sessions
                )),
                response_time_ms: None,
            }
        } else {
            HealthCheck {
                name: "session_capacity".to_string(),
                status: HealthStatus::Unhealthy,
                message: Some(format!(
                    "{} active sessions (at or near limit)",
                    active_sessions
                )),
                response_time_ms: None,
            }
        };
        checks.push(session_check);

        // Check 2: Error rate
        let error_rate = if snapshot.total_connections > 0 {
            snapshot.connection_errors as f64 / snapshot.total_connections as f64
        } else {
            0.0
        };
        let error_check = if error_rate < 0.01 {
            HealthCheck {
                name: "error_rate".to_string(),
                status: HealthStatus::Healthy,
                message: Some(format!("{:.2}% error rate", error_rate * 100.0)),
                response_time_ms: None,
            }
        } else if error_rate < 0.05 {
            HealthCheck {
                name: "error_rate".to_string(),
                status: HealthStatus::Degraded,
                message: Some(format!("{:.2}% error rate", error_rate * 100.0)),
                response_time_ms: None,
            }
        } else {
            HealthCheck {
                name: "error_rate".to_string(),
                status: HealthStatus::Unhealthy,
                message: Some(format!("{:.2}% error rate", error_rate * 100.0)),
                response_time_ms: None,
            }
        };
        checks.push(error_check);

        // Check 3: Uptime
        checks.push(HealthCheck {
            name: "uptime".to_string(),
            status: HealthStatus::Healthy,
            message: Some(format!("{}s uptime", uptime)),
            response_time_ms: None,
        });

        // Add custom checks
        for (name, status, message) in &self.custom_checks {
            checks.push(HealthCheck {
                name: name.clone(),
                status: *status,
                message: message.clone(),
                response_time_ms: None,
            });
        }

        // Overall status: worst of all checks
        let overall_status = checks
            .iter()
            .map(|c| c.status)
            .max_by_key(|s| match s {
                HealthStatus::Healthy => 0,
                HealthStatus::Degraded => 1,
                HealthStatus::Unhealthy => 2,
            })
            .unwrap_or(HealthStatus::Healthy);

        GatewayHealth {
            status: overall_status,
            uptime_secs: uptime,
            active_sessions,
            total_sessions: snapshot.total_connections,
            memory_usage: 0, // Would use system APIs in production
            cpu_usage: 0.0,
            checks,
            last_check: now,
        }
    }

    /// Register a custom health check.
    pub fn register_check(
        &mut self,
        name: String,
        status: HealthStatus,
        message: Option<String>,
    ) {
        self.custom_checks.push((name, status, message));
    }

    /// Update a custom health check.
    pub fn update_check(
        &mut self,
        name: &str,
        status: HealthStatus,
        message: Option<String>,
    ) {
        if let Some(check) = self.custom_checks.iter_mut().find(|(n, _, _)| n == name) {
            check.1 = status;
            check.2 = message;
        }
    }
}
