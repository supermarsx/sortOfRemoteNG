//! Monitoring — scheduled health checks, threshold alerts, recovery notifications.

use crate::types::*;
use chrono::Utc;
use log::{debug, info, warn};
use std::collections::HashMap;

/// Manages monitoring checks and their state.
#[derive(Debug)]
pub struct MonitoringManager {
    checks: Vec<MonitoringCheck>,
    /// Recent check results keyed by check ID.
    last_results: HashMap<String, MonitoringCheckResult>,
    /// All check result history.
    history: Vec<MonitoringCheckResult>,
    max_history: usize,
}

impl MonitoringManager {
    pub fn new() -> Self {
        Self {
            checks: Vec::new(),
            last_results: HashMap::new(),
            history: Vec::new(),
            max_history: 5000,
        }
    }

    /// Add or update a monitoring check.
    pub fn upsert_check(&mut self, check: MonitoringCheck) {
        if let Some(existing) = self.checks.iter_mut().find(|c| c.id == check.id) {
            *existing = check;
        } else {
            self.checks.push(check);
        }
    }

    /// Remove a check by ID.
    pub fn remove_check(&mut self, check_id: &str) -> Result<(), String> {
        let initial = self.checks.len();
        self.checks.retain(|c| c.id != check_id);
        if self.checks.len() == initial {
            return Err(format!("Check '{}' not found", check_id));
        }
        self.last_results.remove(check_id);
        Ok(())
    }

    /// Get a check by ID.
    pub fn get_check(&self, check_id: &str) -> Option<&MonitoringCheck> {
        self.checks.iter().find(|c| c.id == check_id)
    }

    /// List all checks.
    pub fn list_checks(&self) -> &[MonitoringCheck] {
        &self.checks
    }

    /// Enable or disable a check.
    pub fn set_check_enabled(&mut self, check_id: &str, enabled: bool) -> Result<(), String> {
        let check = self
            .checks
            .iter_mut()
            .find(|c| c.id == check_id)
            .ok_or_else(|| format!("Check '{}' not found", check_id))?;
        check.enabled = enabled;
        Ok(())
    }

    /// Get checks that are due for execution.
    pub fn due_checks(&self) -> Vec<&MonitoringCheck> {
        let now = Utc::now();
        self.checks
            .iter()
            .filter(|check| {
                if !check.enabled {
                    return false;
                }
                match check.last_check {
                    None => true,
                    Some(last) => {
                        let elapsed = now.signed_duration_since(last);
                        elapsed.num_seconds() >= check.interval_seconds as i64
                    }
                }
            })
            .collect()
    }

    /// Record a check result and determine if an alert should be sent.
    ///
    /// Returns `Some((alert_type, message))` if an alert should fire,
    /// `None` if no alert is needed.
    pub fn record_result(
        &mut self,
        result: MonitoringCheckResult,
    ) -> Option<(MonitoringAlertType, String)> {
        let check_id = result.check_id.clone();
        let was_healthy = self
            .get_check(&check_id)
            .map(|c| c.status == MonitoringStatus::Healthy)
            .unwrap_or(false);

        let check = self
            .checks
            .iter_mut()
            .find(|c| c.id == check_id)?;

        check.last_check = Some(result.timestamp);

        let alert = if result.success {
            // Reset consecutive failures on success.
            let was_failing = check.consecutive_failures >= check.failure_threshold;
            check.consecutive_failures = 0;
            check.status = result.status.clone();

            if was_failing && check.notify_on_recovery && !was_healthy {
                let msg = format_recovery_message(check, &result);
                info!("Check '{}' recovered", check.name);
                Some((MonitoringAlertType::Recovery, msg))
            } else {
                None
            }
        } else {
            check.consecutive_failures += 1;
            check.status = result.status.clone();

            if check.consecutive_failures >= check.failure_threshold {
                // Only alert on the exact threshold crossing, not every subsequent failure.
                if check.consecutive_failures == check.failure_threshold {
                    let msg = format_alert_message(check, &result);
                    warn!(
                        "Check '{}' failed {} times (threshold: {})",
                        check.name, check.consecutive_failures, check.failure_threshold
                    );
                    check.last_alert = Some(result.timestamp);
                    Some((MonitoringAlertType::Failure, msg))
                } else {
                    debug!(
                        "Check '{}' still failing ({}/{}), already alerted",
                        check.name, check.consecutive_failures, check.failure_threshold
                    );
                    None
                }
            } else {
                debug!(
                    "Check '{}' failed ({}/{}), below threshold",
                    check.name, check.consecutive_failures, check.failure_threshold
                );
                None
            }
        };

        self.last_results.insert(check_id, result.clone());
        self.history.push(result);
        while self.history.len() > self.max_history {
            self.history.remove(0);
        }

        alert
    }

    /// Get the last result for a check.
    pub fn last_result(&self, check_id: &str) -> Option<&MonitoringCheckResult> {
        self.last_results.get(check_id)
    }

    /// Get all history.
    pub fn history(&self) -> &[MonitoringCheckResult] {
        &self.history
    }

    /// Get summary of all checks.
    pub fn summary(&self) -> MonitoringSummary {
        let total = self.checks.len();
        let enabled = self.checks.iter().filter(|c| c.enabled).count();
        let healthy = self
            .checks
            .iter()
            .filter(|c| c.status == MonitoringStatus::Healthy)
            .count();
        let warning = self
            .checks
            .iter()
            .filter(|c| c.status == MonitoringStatus::Warning)
            .count();
        let critical = self
            .checks
            .iter()
            .filter(|c| c.status == MonitoringStatus::Critical)
            .count();
        let down = self
            .checks
            .iter()
            .filter(|c| c.status == MonitoringStatus::Down)
            .count();

        MonitoringSummary {
            total,
            enabled,
            healthy,
            warning,
            critical,
            down,
        }
    }

    /// Clear history.
    pub fn clear_history(&mut self) {
        self.history.clear();
        self.last_results.clear();
    }

    /// Active check count.
    pub fn active_count(&self) -> usize {
        self.checks.iter().filter(|c| c.enabled).count()
    }
}

impl Default for MonitoringManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Alert type for monitoring.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MonitoringAlertType {
    Failure,
    Recovery,
}

/// Summary of monitoring state.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringSummary {
    pub total: usize,
    pub enabled: usize,
    pub healthy: usize,
    pub warning: usize,
    pub critical: usize,
    pub down: usize,
}

fn format_alert_message(check: &MonitoringCheck, result: &MonitoringCheckResult) -> String {
    if let Some(ref tmpl) = check.alert_template {
        render_check_template(tmpl, check, result)
    } else {
        format!(
            "🚨 *Monitor Alert*\n\
             Check: `{}`\n\
             Status: *{:?}*\n\
             Failures: {}/{}\n\
             {}\n\
             _{}_ ",
            check.name,
            result.status,
            check.consecutive_failures,
            check.failure_threshold,
            result.message.as_deref().unwrap_or("No details"),
            result.timestamp.to_rfc3339(),
        )
    }
}

fn format_recovery_message(check: &MonitoringCheck, result: &MonitoringCheckResult) -> String {
    if let Some(ref tmpl) = check.recovery_template {
        render_check_template(tmpl, check, result)
    } else {
        format!(
            "✅ *Monitor Recovery*\n\
             Check: `{}`\n\
             Status: *{:?}*\n\
             Latency: {}ms\n\
             _{}_ ",
            check.name,
            result.status,
            result.latency_ms.unwrap_or(0),
            result.timestamp.to_rfc3339(),
        )
    }
}

fn render_check_template(
    template: &str,
    check: &MonitoringCheck,
    result: &MonitoringCheckResult,
) -> String {
    let mut out = template.to_string();
    out = out.replace("{{check_name}}", &check.name);
    out = out.replace("{{check_id}}", &check.id);
    out = out.replace("{{status}}", &format!("{:?}", result.status));
    out = out.replace(
        "{{latency_ms}}",
        &result.latency_ms.unwrap_or(0).to_string(),
    );
    out = out.replace(
        "{{message}}",
        result.message.as_deref().unwrap_or(""),
    );
    out = out.replace(
        "{{failures}}",
        &check.consecutive_failures.to_string(),
    );
    out = out.replace(
        "{{threshold}}",
        &check.failure_threshold.to_string(),
    );
    out = out.replace("{{timestamp}}", &result.timestamp.to_rfc3339());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_check(id: &str) -> MonitoringCheck {
        MonitoringCheck {
            id: id.to_string(),
            name: format!("Check {}", id),
            enabled: true,
            bot_name: "testbot".to_string(),
            chat_id: ChatId::Numeric(12345),
            check_type: MonitoringCheckType::Ping,
            interval_seconds: 60,
            thresholds: None,
            failure_threshold: 3,
            notify_on_recovery: true,
            parse_mode: None,
            alert_template: None,
            recovery_template: None,
            created_at: Utc::now(),
            status: MonitoringStatus::Unknown,
            consecutive_failures: 0,
            last_check: None,
            last_alert: None,
        }
    }

    fn success_result(check_id: &str) -> MonitoringCheckResult {
        MonitoringCheckResult {
            check_id: check_id.to_string(),
            check_name: format!("Check {}", check_id),
            status: MonitoringStatus::Healthy,
            latency_ms: Some(25),
            success: true,
            message: Some("OK".to_string()),
            details: None,
            timestamp: Utc::now(),
        }
    }

    fn failure_result(check_id: &str) -> MonitoringCheckResult {
        MonitoringCheckResult {
            check_id: check_id.to_string(),
            check_name: format!("Check {}", check_id),
            status: MonitoringStatus::Down,
            latency_ms: None,
            success: false,
            message: Some("Connection refused".to_string()),
            details: None,
            timestamp: Utc::now(),
        }
    }

    #[test]
    fn add_and_list_checks() {
        let mut mgr = MonitoringManager::new();
        mgr.upsert_check(test_check("c1"));
        mgr.upsert_check(test_check("c2"));
        assert_eq!(mgr.list_checks().len(), 2);
    }

    #[test]
    fn update_existing_check() {
        let mut mgr = MonitoringManager::new();
        mgr.upsert_check(test_check("c1"));
        let mut updated = test_check("c1");
        updated.name = "Updated".to_string();
        mgr.upsert_check(updated);
        assert_eq!(mgr.list_checks().len(), 1);
        assert_eq!(mgr.get_check("c1").unwrap().name, "Updated");
    }

    #[test]
    fn remove_check_test() {
        let mut mgr = MonitoringManager::new();
        mgr.upsert_check(test_check("c1"));
        mgr.remove_check("c1").unwrap();
        assert_eq!(mgr.list_checks().len(), 0);
        assert!(mgr.remove_check("c1").is_err());
    }

    #[test]
    fn enable_disable_check() {
        let mut mgr = MonitoringManager::new();
        mgr.upsert_check(test_check("c1"));
        mgr.set_check_enabled("c1", false).unwrap();
        assert!(!mgr.get_check("c1").unwrap().enabled);
        assert_eq!(mgr.active_count(), 0);
    }

    #[test]
    fn due_checks_none_checked() {
        let mut mgr = MonitoringManager::new();
        mgr.upsert_check(test_check("c1"));
        // No last_check → always due.
        assert_eq!(mgr.due_checks().len(), 1);
    }

    #[test]
    fn record_success_no_alert() {
        let mut mgr = MonitoringManager::new();
        mgr.upsert_check(test_check("c1"));
        let alert = mgr.record_result(success_result("c1"));
        assert!(alert.is_none());
        assert_eq!(
            mgr.get_check("c1").unwrap().status,
            MonitoringStatus::Healthy
        );
    }

    #[test]
    fn record_failure_threshold_alert() {
        let mut mgr = MonitoringManager::new();
        mgr.upsert_check(test_check("c1")); // threshold = 3

        // Failures 1 and 2 should not alert.
        assert!(mgr.record_result(failure_result("c1")).is_none());
        assert!(mgr.record_result(failure_result("c1")).is_none());

        // Failure 3 should trigger alert.
        let alert = mgr.record_result(failure_result("c1"));
        assert!(alert.is_some());
        let (alert_type, msg) = alert.unwrap();
        assert_eq!(alert_type, MonitoringAlertType::Failure);
        assert!(msg.contains("Monitor Alert"));

        // Failure 4 should not re-alert (already crossed threshold).
        assert!(mgr.record_result(failure_result("c1")).is_none());
    }

    #[test]
    fn recovery_notification() {
        let mut mgr = MonitoringManager::new();
        mgr.upsert_check(test_check("c1"));

        // Fail 3 times to trigger the threshold.
        mgr.record_result(failure_result("c1"));
        mgr.record_result(failure_result("c1"));
        mgr.record_result(failure_result("c1")); // alert fires

        // Now succeed → should get recovery.
        let alert = mgr.record_result(success_result("c1"));
        assert!(alert.is_some());
        let (alert_type, msg) = alert.unwrap();
        assert_eq!(alert_type, MonitoringAlertType::Recovery);
        assert!(msg.contains("Recovery"));
    }

    #[test]
    fn no_recovery_when_notify_disabled() {
        let mut mgr = MonitoringManager::new();
        let mut check = test_check("c1");
        check.notify_on_recovery = false;
        mgr.upsert_check(check);

        mgr.record_result(failure_result("c1"));
        mgr.record_result(failure_result("c1"));
        mgr.record_result(failure_result("c1"));

        let alert = mgr.record_result(success_result("c1"));
        assert!(alert.is_none());
    }

    #[test]
    fn summary_test() {
        let mut mgr = MonitoringManager::new();
        let mut c1 = test_check("c1");
        c1.status = MonitoringStatus::Healthy;
        let mut c2 = test_check("c2");
        c2.status = MonitoringStatus::Down;
        let mut c3 = test_check("c3");
        c3.enabled = false;

        mgr.upsert_check(c1);
        mgr.upsert_check(c2);
        mgr.upsert_check(c3);

        let s = mgr.summary();
        assert_eq!(s.total, 3);
        assert_eq!(s.enabled, 2);
        assert_eq!(s.healthy, 1);
        assert_eq!(s.down, 1);
    }

    #[test]
    fn history_recording() {
        let mut mgr = MonitoringManager::new();
        mgr.upsert_check(test_check("c1"));
        mgr.record_result(success_result("c1"));
        mgr.record_result(failure_result("c1"));
        assert_eq!(mgr.history().len(), 2);
        assert!(mgr.last_result("c1").is_some());
        mgr.clear_history();
        assert_eq!(mgr.history().len(), 0);
    }

    #[test]
    fn custom_alert_template() {
        let mut mgr = MonitoringManager::new();
        let mut check = test_check("c1");
        check.alert_template = Some("ALERT: {{check_name}} is {{status}}".to_string());
        check.failure_threshold = 1;
        mgr.upsert_check(check);

        let alert = mgr.record_result(failure_result("c1"));
        assert!(alert.is_some());
        let (_, msg) = alert.unwrap();
        assert_eq!(msg, "ALERT: Check c1 is Down");
    }

    #[test]
    fn default_monitoring_manager() {
        let mgr = MonitoringManager::default();
        assert_eq!(mgr.list_checks().len(), 0);
    }
}
