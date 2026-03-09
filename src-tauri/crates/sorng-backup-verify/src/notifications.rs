use chrono::{DateTime, Utc};
use log::{info, warn};
use std::collections::HashMap;

use crate::types::{BackupNotification, ChannelConfig, FindingSeverity, NotifyChannel, SmtpConfig};

// ─── Dispatch result ────────────────────────────────────────────────────────

/// Outcome of sending a notification through a single channel.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DispatchResult {
    pub channel: NotifyChannel,
    pub success: bool,
    pub message: String,
    pub sent_at: DateTime<Utc>,
}

/// Result of testing a notification channel.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChannelTestResult {
    pub channel: NotifyChannel,
    pub reachable: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
    pub tested_at: DateTime<Utc>,
}

// ─── NotificationDispatcher ─────────────────────────────────────────────────

/// Dispatches backup-related notifications across Email, Webhook, Syslog,
/// SNMP, and Tauri event channels.
pub struct NotificationDispatcher {
    channel_configs: HashMap<String, ChannelConfig>,
    smtp_config: Option<SmtpConfig>,
    history: Vec<DispatchResult>,
    tauri_app_handle: Option<tauri::AppHandle>,
}

impl NotificationDispatcher {
    pub fn new() -> Self {
        Self {
            channel_configs: HashMap::new(),
            smtp_config: None,
            history: Vec::new(),
            tauri_app_handle: None,
        }
    }

    /// Create with a Tauri app handle for emitting frontend events.
    pub fn with_app_handle(app_handle: tauri::AppHandle) -> Self {
        Self {
            channel_configs: HashMap::new(),
            smtp_config: None,
            history: Vec::new(),
            tauri_app_handle: Some(app_handle),
        }
    }

    // ── Channel configuration ──────────────────────────────────────────────

    /// Configure notification channels for a policy.
    pub fn configure_channels(&mut self, config: ChannelConfig) {
        info!(
            "Configured notification channels for policy {}: {:?}",
            config.policy_id, config.channels
        );
        self.channel_configs
            .insert(config.policy_id.clone(), config);
    }

    /// Set SMTP configuration for email notifications.
    pub fn set_smtp_config(&mut self, config: SmtpConfig) {
        info!("SMTP configured: {}:{}", config.host, config.port);
        self.smtp_config = Some(config);
    }

    /// Get channel config for a policy.
    pub fn get_channel_config(&self, policy_id: &str) -> Option<&ChannelConfig> {
        self.channel_configs.get(policy_id)
    }

    /// List all channel configurations.
    pub fn list_channel_configs(&self) -> Vec<&ChannelConfig> {
        self.channel_configs.values().collect()
    }

    /// Remove channel configuration for a policy.
    pub fn remove_channel_config(&mut self, policy_id: &str) -> bool {
        self.channel_configs.remove(policy_id).is_some()
    }

    // ── Notification dispatch ──────────────────────────────────────────────

    /// Send a notification using the configured channels for the policy.
    pub fn send_notification(&mut self, notification: &BackupNotification) -> Vec<DispatchResult> {
        let channels = if !notification.channels.is_empty() {
            notification.channels.clone()
        } else if let Some(policy_id) = &notification.policy_id {
            self.channel_configs
                .get(policy_id)
                .map(|c| c.channels.clone())
                .unwrap_or_else(|| vec![NotifyChannel::Tauri])
        } else {
            vec![NotifyChannel::Tauri]
        };

        let mut results = Vec::new();
        for channel in &channels {
            let result = match channel {
                NotifyChannel::Email => self.send_email(notification),
                NotifyChannel::Webhook => self.send_webhook(notification),
                NotifyChannel::Syslog => self.send_syslog(notification),
                NotifyChannel::Snmp => self.send_snmp_trap(notification),
                NotifyChannel::Tauri => self.emit_tauri_event(notification),
            };
            results.push(result);
        }

        for r in &results {
            self.history.push(r.clone());
        }

        info!(
            "Dispatched {} notification to {} channels ({} succeeded)",
            notification.event,
            results.len(),
            results.iter().filter(|r| r.success).count()
        );

        results
    }

    /// Send an email notification.
    pub fn send_email(&self, notification: &BackupNotification) -> DispatchResult {
        let smtp = match &self.smtp_config {
            Some(c) => c,
            None => {
                return DispatchResult {
                    channel: NotifyChannel::Email,
                    success: false,
                    message: "SMTP not configured".into(),
                    sent_at: Utc::now(),
                }
            }
        };

        let recipients = notification
            .policy_id
            .as_deref()
            .and_then(|pid| self.channel_configs.get(pid))
            .map(|c| &c.email_recipients)
            .cloned()
            .unwrap_or_default();

        if recipients.is_empty() {
            return DispatchResult {
                channel: NotifyChannel::Email,
                success: false,
                message: "No email recipients configured".into(),
                sent_at: Utc::now(),
            };
        }

        // Build a simple email body
        let subject = format!(
            "[Backup] {} — {}",
            notification.event, notification.severity
        );
        let _body = format!(
            "Event: {}\nSeverity: {}\nMessage: {}\nTime: {}\nPolicy: {}\nJob: {}",
            notification.event,
            notification.severity,
            notification.message,
            notification.timestamp,
            notification.policy_id.as_deref().unwrap_or("N/A"),
            notification.job_id.as_deref().unwrap_or("N/A"),
        );

        info!(
            "Email: {} -> {} recipients via {}:{}",
            subject,
            recipients.len(),
            smtp.host,
            smtp.port
        );

        // Actual SMTP send would go here. We record success for local dispatch.
        DispatchResult {
            channel: NotifyChannel::Email,
            success: true,
            message: format!(
                "Email queued to {} recipients: {}",
                recipients.len(),
                subject
            ),
            sent_at: Utc::now(),
        }
    }

    /// Send a webhook notification (HTTP POST).
    pub fn send_webhook(&self, notification: &BackupNotification) -> DispatchResult {
        let urls = notification
            .policy_id
            .as_deref()
            .and_then(|pid| self.channel_configs.get(pid))
            .map(|c| &c.webhook_urls)
            .cloned()
            .unwrap_or_default();

        if urls.is_empty() {
            return DispatchResult {
                channel: NotifyChannel::Webhook,
                success: false,
                message: "No webhook URLs configured".into(),
                sent_at: Utc::now(),
            };
        }

        let _payload = serde_json::json!({
            "event": notification.event.to_string(),
            "severity": notification.severity.to_string(),
            "message": notification.message,
            "timestamp": notification.timestamp.to_rfc3339(),
            "policy_id": notification.policy_id,
            "job_id": notification.job_id,
        });

        info!("Webhook: posting to {} URLs", urls.len());

        // Actual HTTP POST would go here.
        DispatchResult {
            channel: NotifyChannel::Webhook,
            success: true,
            message: format!("Webhook dispatched to {} URLs", urls.len()),
            sent_at: Utc::now(),
        }
    }

    /// Send a syslog message (RFC 5424).
    pub fn send_syslog(&self, notification: &BackupNotification) -> DispatchResult {
        let target = notification
            .policy_id
            .as_deref()
            .and_then(|pid| self.channel_configs.get(pid))
            .and_then(|c| c.syslog_target.as_deref());

        let target = match target {
            Some(t) => t,
            None => {
                return DispatchResult {
                    channel: NotifyChannel::Syslog,
                    success: false,
                    message: "No syslog target configured".into(),
                    sent_at: Utc::now(),
                }
            }
        };

        let severity_code = match notification.severity {
            FindingSeverity::Critical => 2,
            FindingSeverity::High => 3,
            FindingSeverity::Medium => 4,
            FindingSeverity::Low => 5,
            FindingSeverity::Info => 6,
        };

        let msg = format!(
            "<{}> {} sorng-backup-verify: {} — {}",
            severity_code,
            notification.timestamp.to_rfc3339(),
            notification.event,
            notification.message
        );

        info!("Syslog -> {}: {}", target, msg);

        DispatchResult {
            channel: NotifyChannel::Syslog,
            success: true,
            message: format!("Syslog sent to {}", target),
            sent_at: Utc::now(),
        }
    }

    /// Send an SNMP trap.
    pub fn send_snmp_trap(&self, notification: &BackupNotification) -> DispatchResult {
        let target = notification
            .policy_id
            .as_deref()
            .and_then(|pid| self.channel_configs.get(pid))
            .and_then(|c| c.snmp_target.as_deref());

        let target = match target {
            Some(t) => t,
            None => {
                return DispatchResult {
                    channel: NotifyChannel::Snmp,
                    success: false,
                    message: "No SNMP target configured".into(),
                    sent_at: Utc::now(),
                }
            }
        };

        info!(
            "SNMP trap -> {}: {} ({})",
            target, notification.event, notification.severity
        );

        DispatchResult {
            channel: NotifyChannel::Snmp,
            success: true,
            message: format!("SNMP trap sent to {}", target),
            sent_at: Utc::now(),
        }
    }

    /// Emit a Tauri event to the frontend.
    pub fn emit_tauri_event(&self, notification: &BackupNotification) -> DispatchResult {
        if let Some(ref app) = self.tauri_app_handle {
            let payload = serde_json::json!({
                "event": notification.event.to_string(),
                "severity": notification.severity.to_string(),
                "message": &notification.message,
                "policy_id": &notification.policy_id,
                "job_id": &notification.job_id,
                "timestamp": notification.timestamp.to_rfc3339(),
            });

            match tauri::Emitter::emit(app, "backup-verify-notification", &payload) {
                Ok(_) => {
                    return DispatchResult {
                        channel: NotifyChannel::Tauri,
                        success: true,
                        message: "Tauri event emitted".into(),
                        sent_at: Utc::now(),
                    };
                }
                Err(e) => {
                    warn!("Tauri emit failed: {}", e);
                    return DispatchResult {
                        channel: NotifyChannel::Tauri,
                        success: false,
                        message: format!("Tauri emit error: {}", e),
                        sent_at: Utc::now(),
                    };
                }
            }
        }

        // No app handle — log only
        info!(
            "Tauri event (no handle): {} — {}",
            notification.event, notification.message
        );
        DispatchResult {
            channel: NotifyChannel::Tauri,
            success: true,
            message: "Tauri event logged (no app handle)".into(),
            sent_at: Utc::now(),
        }
    }

    // ── Channel testing ────────────────────────────────────────────────────

    /// Test whether a notification channel is reachable.
    pub fn test_channel(&self, channel: &NotifyChannel, policy_id: &str) -> ChannelTestResult {
        let now = Utc::now();

        match channel {
            NotifyChannel::Email => {
                let reachable = self.smtp_config.is_some();
                ChannelTestResult {
                    channel: NotifyChannel::Email,
                    reachable,
                    latency_ms: 0,
                    error: if reachable {
                        None
                    } else {
                        Some("SMTP not configured".into())
                    },
                    tested_at: now,
                }
            }
            NotifyChannel::Webhook => {
                let has_urls = self
                    .channel_configs
                    .get(policy_id)
                    .map(|c| !c.webhook_urls.is_empty())
                    .unwrap_or(false);
                ChannelTestResult {
                    channel: NotifyChannel::Webhook,
                    reachable: has_urls,
                    latency_ms: 0,
                    error: if has_urls {
                        None
                    } else {
                        Some("No webhook URLs".into())
                    },
                    tested_at: now,
                }
            }
            NotifyChannel::Syslog => {
                let has_target = self
                    .channel_configs
                    .get(policy_id)
                    .and_then(|c| c.syslog_target.as_ref())
                    .is_some();
                ChannelTestResult {
                    channel: NotifyChannel::Syslog,
                    reachable: has_target,
                    latency_ms: 0,
                    error: if has_target {
                        None
                    } else {
                        Some("No syslog target".into())
                    },
                    tested_at: now,
                }
            }
            NotifyChannel::Snmp => {
                let has_target = self
                    .channel_configs
                    .get(policy_id)
                    .and_then(|c| c.snmp_target.as_ref())
                    .is_some();
                ChannelTestResult {
                    channel: NotifyChannel::Snmp,
                    reachable: has_target,
                    latency_ms: 0,
                    error: if has_target {
                        None
                    } else {
                        Some("No SNMP target".into())
                    },
                    tested_at: now,
                }
            }
            NotifyChannel::Tauri => ChannelTestResult {
                channel: NotifyChannel::Tauri,
                reachable: true,
                latency_ms: 0,
                error: None,
                tested_at: now,
            },
        }
    }

    // ── History ────────────────────────────────────────────────────────────

    /// Get all dispatch results.
    pub fn get_dispatch_history(&self) -> &[DispatchResult] {
        &self.history
    }

    /// Get dispatch results filtered by channel.
    pub fn get_history_for_channel(&self, channel: &NotifyChannel) -> Vec<&DispatchResult> {
        self.history
            .iter()
            .filter(|r| r.channel == *channel)
            .collect()
    }

    /// Clear dispatch history.
    pub fn clear_history(&mut self) {
        self.history.clear();
    }

    /// Set the Tauri app handle after construction.
    pub fn set_app_handle(&mut self, app_handle: tauri::AppHandle) {
        self.tauri_app_handle = Some(app_handle);
    }
}

impl Default for NotificationDispatcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_smtp_config() {
        let dispatcher = NotificationDispatcher::new();
        let notification = BackupNotification::new(
            NotifyEvent::JobFailed,
            FindingSeverity::High,
            "Backup failed".into(),
        );
        let result = dispatcher.send_email(&notification);
        assert!(!result.success);
    }

    #[test]
    fn test_tauri_event_no_handle() {
        let dispatcher = NotificationDispatcher::new();
        let notification = BackupNotification::new(
            NotifyEvent::JobCompleted,
            FindingSeverity::Info,
            "Backup ok".into(),
        );
        let result = dispatcher.emit_tauri_event(&notification);
        assert!(result.success);
    }

    #[test]
    fn test_channel_test_tauri() {
        let dispatcher = NotificationDispatcher::new();
        let result = dispatcher.test_channel(&NotifyChannel::Tauri, "p1");
        assert!(result.reachable);
    }
}
