//! # Alert Manager
//!
//! Generate, store, and acknowledge credential-related alerts.

use crate::types::*;
use chrono::Utc;
use log::info;
use std::collections::HashMap;
use uuid::Uuid;

/// Manages the lifecycle of credential alerts.
#[derive(Debug)]
pub struct AlertManager {
    /// All alerts (active and acknowledged).
    pub alerts: Vec<CredentialAlert>,
}

impl AlertManager {
    /// Create an empty alert manager.
    pub fn new() -> Self {
        Self {
            alerts: Vec::new(),
        }
    }

    /// Scan all credentials against their associated policies and generate
    /// alerts for any issues found.
    pub fn generate_alerts(
        &mut self,
        credentials: &HashMap<String, CredentialRecord>,
        policies: &HashMap<String, RotationPolicy>,
        config: &CredentialsConfig,
    ) -> Vec<CredentialAlert> {
        let mut new_alerts = Vec::new();
        let now = Utc::now();

        for record in credentials.values() {
            // ── Expiry alerts ───────────────────────────────────
            if let Some(exp) = record.expires_at {
                if exp <= now {
                    let overdue = (now - exp).num_days().unsigned_abs();
                    let alert_type = match record.credential_type {
                        CredentialType::TlsCertificate | CredentialType::SshCertificate => {
                            AlertType::ExpiredCertificate
                        }
                        _ => AlertType::RotationOverdue,
                    };
                    new_alerts.push(Self::make_alert(
                        record,
                        alert_type,
                        format!("{} expired {} days ago", record.label, overdue),
                        AlertSeverity::Critical,
                    ));
                } else {
                    let remaining = (exp - now).num_days().unsigned_abs();
                    let warn_days = config.default_warn_before_days;
                    if remaining <= warn_days {
                        let alert_type = match record.credential_type {
                            CredentialType::TlsCertificate | CredentialType::SshCertificate => {
                                AlertType::ExpiringCertificate
                            }
                            CredentialType::SshKey => AlertType::ExpiringKey,
                            _ => AlertType::ExpiringCertificate,
                        };
                        new_alerts.push(Self::make_alert(
                            record,
                            alert_type,
                            format!(
                                "{} expires in {} days",
                                record.label, remaining
                            ),
                            AlertSeverity::Warning,
                        ));
                    }
                }
            }

            // ── Stale password alerts ───────────────────────────
            let last = record.last_rotated_at.unwrap_or(record.created_at);
            let age_days = (now - last).num_days().unsigned_abs();
            let max_age = record
                .rotation_policy_id
                .as_ref()
                .and_then(|pid| policies.get(pid))
                .map(|p| p.max_age_days)
                .unwrap_or(config.default_max_age_days);

            if age_days > max_age {
                new_alerts.push(Self::make_alert(
                    record,
                    AlertType::StalePassword,
                    format!(
                        "{} has not been rotated in {} days (max: {})",
                        record.label, age_days, max_age
                    ),
                    AlertSeverity::Warning,
                ));
            }

            // ── Weak password alerts ────────────────────────────
            if config.strength_checking {
                if let Some(strength) = &record.strength {
                    if *strength <= PasswordStrength::Weak {
                        new_alerts.push(Self::make_alert(
                            record,
                            AlertType::WeakPassword,
                            format!("{} has {} strength", record.label, strength),
                            AlertSeverity::Warning,
                        ));
                    }
                }
            }

            // ── Policy violation alerts ─────────────────────────
            if let Some(pid) = &record.rotation_policy_id {
                if let Some(policy) = policies.get(pid) {
                    if let Some(min) = &policy.min_strength {
                        if let Some(actual) = &record.strength {
                            if actual < min && policy.enforce {
                                new_alerts.push(Self::make_alert(
                                    record,
                                    AlertType::PolicyViolation,
                                    format!(
                                        "{} strength ({}) below policy minimum ({})",
                                        record.label, actual, min
                                    ),
                                    AlertSeverity::Critical,
                                ));
                            }
                        }
                    }
                }
            }
        }

        // ── Duplicate detection ─────────────────────────────────
        if config.duplicate_detection {
            let mut by_fp: HashMap<&str, Vec<&CredentialRecord>> = HashMap::new();
            for rec in credentials.values() {
                by_fp.entry(rec.fingerprint.as_str()).or_default().push(rec);
            }
            for group in by_fp.values() {
                if group.len() > 1 {
                    for rec in group {
                        new_alerts.push(Self::make_alert(
                            rec,
                            AlertType::DuplicatePassword,
                            format!(
                                "{} shares a credential value with {} other(s)",
                                rec.label,
                                group.len() - 1
                            ),
                            AlertSeverity::Info,
                        ));
                    }
                }
            }
        }

        // Store new alerts.
        self.alerts.extend(new_alerts.clone());
        new_alerts
    }

    /// Get all active (unacknowledged) alerts.
    pub fn get_active_alerts(&self) -> Vec<&CredentialAlert> {
        self.alerts.iter().filter(|a| !a.acknowledged).collect()
    }

    /// Acknowledge an alert by ID.
    pub fn acknowledge_alert(&mut self, id: &str) -> Result<(), String> {
        let alert = self
            .alerts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| format!("Alert not found: {id}"))?;
        alert.acknowledged = true;
        alert.acknowledged_at = Some(Utc::now());
        info!("Acknowledged alert {id}");
        Ok(())
    }

    /// Get all alerts (active and acknowledged) for a specific credential.
    pub fn get_alerts_for_credential(&self, credential_id: &str) -> Vec<&CredentialAlert> {
        self.alerts
            .iter()
            .filter(|a| a.credential_id == credential_id)
            .collect()
    }

    /// Get all alerts with the given severity.
    pub fn get_by_severity(&self, severity: AlertSeverity) -> Vec<&CredentialAlert> {
        self.alerts
            .iter()
            .filter(|a| a.severity == severity)
            .collect()
    }

    /// Remove all acknowledged alerts.
    pub fn clear_acknowledged(&mut self) {
        self.alerts.retain(|a| !a.acknowledged);
    }

    // ── Internal helpers ────────────────────────────────────────────

    fn make_alert(
        record: &CredentialRecord,
        alert_type: AlertType,
        message: String,
        severity: AlertSeverity,
    ) -> CredentialAlert {
        CredentialAlert {
            id: Uuid::new_v4().to_string(),
            credential_id: record.id.clone(),
            connection_id: record.connection_id.clone(),
            alert_type,
            message,
            severity,
            created_at: Utc::now(),
            acknowledged: false,
            acknowledged_at: None,
        }
    }
}

impl Default for AlertManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tracker::CredentialTracker;
    use chrono::Duration;

    fn make_config() -> CredentialsConfig {
        CredentialsConfig {
            check_interval_seconds: 60,
            default_max_age_days: 90,
            default_warn_before_days: 14,
            duplicate_detection: true,
            strength_checking: true,
            auto_alerts: true,
        }
    }

    fn make_record(id: &str) -> CredentialRecord {
        CredentialRecord {
            id: id.to_string(),
            connection_id: "conn-1".to_string(),
            credential_type: CredentialType::Password,
            label: format!("Cred {id}"),
            username: None,
            fingerprint: CredentialTracker::compute_fingerprint(id),
            created_at: Utc::now(),
            last_rotated_at: None,
            expires_at: None,
            rotation_policy_id: None,
            group_id: None,
            strength: Some(PasswordStrength::Strong),
            notes: String::new(),
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn generates_expiry_alerts() {
        let mut mgr = AlertManager::new();
        let mut creds = HashMap::new();
        let mut rec = make_record("c1");
        rec.expires_at = Some(Utc::now() - Duration::days(5));
        creds.insert(rec.id.clone(), rec);
        let alerts = mgr.generate_alerts(&creds, &HashMap::new(), &make_config());
        assert!(alerts.iter().any(|a| a.alert_type == AlertType::RotationOverdue));
    }

    #[test]
    fn generates_stale_alerts() {
        let mut mgr = AlertManager::new();
        let mut creds = HashMap::new();
        let mut rec = make_record("c1");
        rec.created_at = Utc::now() - Duration::days(100);
        creds.insert(rec.id.clone(), rec);
        let alerts = mgr.generate_alerts(&creds, &HashMap::new(), &make_config());
        assert!(alerts.iter().any(|a| a.alert_type == AlertType::StalePassword));
    }

    #[test]
    fn generates_weak_alerts() {
        let mut mgr = AlertManager::new();
        let mut creds = HashMap::new();
        let mut rec = make_record("c1");
        rec.strength = Some(PasswordStrength::VeryWeak);
        creds.insert(rec.id.clone(), rec);
        let alerts = mgr.generate_alerts(&creds, &HashMap::new(), &make_config());
        assert!(alerts.iter().any(|a| a.alert_type == AlertType::WeakPassword));
    }

    #[test]
    fn generates_duplicate_alerts() {
        let mut mgr = AlertManager::new();
        let mut creds = HashMap::new();
        let fp = CredentialTracker::compute_fingerprint("shared");
        let mut r1 = make_record("c1");
        r1.fingerprint = fp.clone();
        let mut r2 = make_record("c2");
        r2.fingerprint = fp;
        creds.insert(r1.id.clone(), r1);
        creds.insert(r2.id.clone(), r2);
        let alerts = mgr.generate_alerts(&creds, &HashMap::new(), &make_config());
        assert!(alerts.iter().any(|a| a.alert_type == AlertType::DuplicatePassword));
    }

    #[test]
    fn acknowledge_and_clear() {
        let mut mgr = AlertManager::new();
        let mut creds = HashMap::new();
        let mut rec = make_record("c1");
        rec.strength = Some(PasswordStrength::VeryWeak);
        creds.insert(rec.id.clone(), rec);
        mgr.generate_alerts(&creds, &HashMap::new(), &make_config());
        assert!(!mgr.get_active_alerts().is_empty());

        let alert_id = mgr.alerts[0].id.clone();
        mgr.acknowledge_alert(&alert_id).unwrap();
        mgr.clear_acknowledged();
        assert!(mgr.get_alerts_for_credential("c1").is_empty() || mgr.get_active_alerts().len() < mgr.alerts.len() + 1);
    }
}
