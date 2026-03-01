use super::service::RustDeskService;
use super::types::*;
use chrono::Utc;

/// Diagnostics and health-check operations.
impl RustDeskService {
    /// Build a full diagnostics report.
    pub async fn build_diagnostics_report(&mut self) -> DiagnosticsReport {
        let mut issues = Vec::new();

        // 1. Check binary availability
        let binary = self.get_binary_info().clone();
        if !binary.installed {
            issues.push(DiagnosticsIssue {
                severity: IssueSeverity::Critical,
                component: "binary".to_string(),
                message: "RustDesk binary not found on the system".to_string(),
                suggestion: Some(
                    "Install RustDesk from https://rustdesk.com or add it to PATH".to_string(),
                ),
            });
        }

        // 2. Check version
        if binary.installed {
            if let Err(e) = self.detect_version().await {
                issues.push(DiagnosticsIssue {
                    severity: IssueSeverity::Warning,
                    component: "binary".to_string(),
                    message: format!("Failed to detect RustDesk version: {}", e),
                    suggestion: Some("Ensure RustDesk is properly installed".to_string()),
                });
            }
        }

        // 3. Check local ID
        let local_id = if binary.installed {
            match self.get_local_id().await {
                Ok(id) => Some(id),
                Err(e) => {
                    issues.push(DiagnosticsIssue {
                        severity: IssueSeverity::Warning,
                        component: "client".to_string(),
                        message: format!("Failed to get local RustDesk ID: {}", e),
                        suggestion: Some("RustDesk may not be running or configured".to_string()),
                    });
                    None
                }
            }
        } else {
            None
        };

        // 4. Check service running
        if binary.installed {
            let running = self.check_service_running().await;
            if !running {
                issues.push(DiagnosticsIssue {
                    severity: IssueSeverity::Warning,
                    component: "service".to_string(),
                    message: "RustDesk service is not running".to_string(),
                    suggestion: Some(
                        "Start the RustDesk service or run 'rustdesk --install-service'"
                            .to_string(),
                    ),
                });
            }
        }

        // 5. Check server configuration & connectivity
        let server_status = if self.server_config.is_some() {
            match self.check_server_health().await {
                Ok(true) => {
                    let latency = self.measure_server_latency().await.ok();
                    if let Some(ms) = latency {
                        if ms > 5000 {
                            issues.push(DiagnosticsIssue {
                                severity: IssueSeverity::Warning,
                                component: "server".to_string(),
                                message: format!("Server latency is very high: {} ms", ms),
                                suggestion: Some(
                                    "Check network connection and server load".to_string(),
                                ),
                            });
                        }
                    }
                    Some(RustDeskServerStatus {
                        reachable: true,
                        version: None,
                        api_accessible: true,
                        relay_ok: true,
                        latency_ms: latency,
                        error: None,
                    })
                }
                Ok(false) | Err(_) => {
                    issues.push(DiagnosticsIssue {
                        severity: IssueSeverity::Critical,
                        component: "server".to_string(),
                        message: "Cannot reach RustDesk server".to_string(),
                        suggestion: Some(
                            "Verify server URL, port 21114, and API token".to_string(),
                        ),
                    });
                    Some(RustDeskServerStatus {
                        reachable: false,
                        version: None,
                        api_accessible: false,
                        relay_ok: false,
                        latency_ms: None,
                        error: Some("Server health check failed".to_string()),
                    })
                }
            }
        } else {
            issues.push(DiagnosticsIssue {
                severity: IssueSeverity::Info,
                component: "server".to_string(),
                message: "No RustDesk Server Pro configured".to_string(),
                suggestion: Some(
                    "Configure a server with configure_server() to enable API features".to_string(),
                ),
            });
            None
        };

        // Re-fetch binary info after possible version detection
        let binary = self.get_binary_info().clone();

        // Detect NAT type (stub -- would need a STUN check)
        let nat_type = None;

        let config_valid = binary.installed
            && (self.server_config.is_none()
                || server_status
                    .as_ref()
                    .map(|s| s.reachable)
                    .unwrap_or(false));

        DiagnosticsReport {
            binary,
            server: server_status,
            local_id,
            nat_type,
            config_valid,
            issues,
            checked_at: Utc::now(),
        }
    }

    /// Quick health check: returns true if binary is available and service is running.
    pub async fn quick_health_check(&mut self) -> bool {
        if !self.is_available() {
            return false;
        }
        self.check_service_running().await
    }

    /// Check server API health.
    pub async fn check_server_health(&self) -> Result<bool, String> {
        let client = self.get_api_client()?;
        client.health_check().await
    }

    /// Measure server API latency in milliseconds.
    pub async fn measure_server_latency(&self) -> Result<u64, String> {
        let client = self.get_api_client()?;
        client.measure_latency().await
    }

    /// Get the current server configuration summary.
    pub fn server_config_summary(&self) -> Option<serde_json::Value> {
        self.server_config.as_ref().map(|config| {
            serde_json::json!({
                "api_url": config.api_url,
                "has_token": !config.api_token.is_empty(),
                "relay_server": config.relay_server,
                "is_pro": config.is_pro,
            })
        })
    }

    /// Get the current client configuration summary.
    pub fn client_config_summary(&self) -> Option<serde_json::Value> {
        self.client_config.as_ref().map(|config| {
            serde_json::json!({
                "id_server": config.id_server,
                "relay_server": config.relay_server,
                "api_server": config.api_server,
                "force_relay": config.force_relay,
                "allow_direct_ip": config.allow_direct_ip,
            })
        })
    }

    /// Get session summary for diagnostics.
    pub fn session_summary(&self) -> serde_json::Value {
        let sessions: Vec<serde_json::Value> = self
            .connections
            .values()
            .map(|c| {
                serde_json::json!({
                    "id": c.session.id,
                    "remote_id": c.session.remote_id,
                    "connection_type": format!("{:?}", c.session.connection_type),
                    "connected": c.session.connected,
                    "connected_at": c.session.connected_at,
                })
            })
            .collect();

        let tunnels: Vec<serde_json::Value> = self
            .tunnels
            .values()
            .map(|t| {
                serde_json::json!({
                    "id": t.id,
                    "local_port": t.local_port,
                    "remote_port": t.remote_port,
                    "remote_host": t.remote_host,
                    "active": t.active,
                })
            })
            .collect();

        let (total_t, active_t, completed_t, failed_t, cancelled_t) = self.file_transfer_stats();

        serde_json::json!({
            "sessions": sessions,
            "session_count": self.connections.len(),
            "tunnels": tunnels,
            "tunnel_count": self.tunnels.len(),
            "transfers": {
                "total": total_t,
                "active": active_t,
                "completed": completed_t,
                "failed": failed_t,
                "cancelled": cancelled_t,
            },
        })
    }
}
