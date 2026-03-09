//! # Policy Engine
//!
//! Evaluate rotation policies against credential records and produce
//! structured violations.

use crate::types::*;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Violation types ─────────────────────────────────────────────────

/// The kind of policy violation detected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViolationType {
    /// The credential exceeds the policy's maximum age.
    TooOld,
    /// The credential's strength is below the policy minimum.
    TooWeak,
    /// The credential value is the same as the previous one.
    SameAsLast,
    /// The credential has expired.
    Expired,
    /// No rotation has ever been recorded.
    NoRotationRecorded,
}

impl std::fmt::Display for ViolationType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooOld => write!(f, "Too Old"),
            Self::TooWeak => write!(f, "Too Weak"),
            Self::SameAsLast => write!(f, "Same As Last"),
            Self::Expired => write!(f, "Expired"),
            Self::NoRotationRecorded => write!(f, "No Rotation Recorded"),
        }
    }
}

/// A single policy violation with full context.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyViolation {
    /// What kind of violation this is.
    pub violation_type: ViolationType,
    /// Human-readable description.
    pub message: String,
    /// Severity of the violation.
    pub severity: AlertSeverity,
}

// ── Policy Engine ───────────────────────────────────────────────────

/// Stateful policy engine that holds the full set of policies and can
/// evaluate any credential record against them.
#[derive(Debug)]
pub struct PolicyEngine {
    /// All known rotation policies keyed by ID.
    pub policies: HashMap<String, RotationPolicy>,
}

impl PolicyEngine {
    /// Create an empty policy engine.
    pub fn new() -> Self {
        Self {
            policies: HashMap::new(),
        }
    }

    /// Create from an existing set of policies.
    pub fn with_policies(policies: HashMap<String, RotationPolicy>) -> Self {
        Self { policies }
    }

    /// Evaluate a credential record against a specific rotation policy.
    ///
    /// Returns a (possibly empty) list of violations.
    pub fn evaluate_policy(
        &self,
        record: &CredentialRecord,
        policy: &RotationPolicy,
    ) -> Vec<PolicyViolation> {
        let mut violations = Vec::new();
        let now = Utc::now();

        // ── Age check ───────────────────────────────────────────
        let last = record.last_rotated_at.unwrap_or(record.created_at);
        let age_days = (now - last).num_days().unsigned_abs();

        if age_days > policy.max_age_days {
            let severity = if age_days > policy.max_age_days * 2 {
                AlertSeverity::Critical
            } else {
                AlertSeverity::Warning
            };
            violations.push(PolicyViolation {
                violation_type: ViolationType::TooOld,
                message: format!(
                    "Credential is {age_days} days old (max: {} days)",
                    policy.max_age_days
                ),
                severity,
            });
        }

        // ── Strength check ──────────────────────────────────────
        if let Some(min_strength) = &policy.min_strength {
            if let Some(actual) = &record.strength {
                if actual < min_strength {
                    violations.push(PolicyViolation {
                        violation_type: ViolationType::TooWeak,
                        message: format!(
                            "Credential strength is {} but policy requires at least {}",
                            actual, min_strength
                        ),
                        severity: AlertSeverity::Warning,
                    });
                }
            }
        }

        // ── Expiry check ────────────────────────────────────────
        if let Some(expires_at) = record.expires_at {
            if expires_at <= now {
                violations.push(PolicyViolation {
                    violation_type: ViolationType::Expired,
                    message: format!(
                        "Credential expired {} days ago",
                        (now - expires_at).num_days().unsigned_abs()
                    ),
                    severity: AlertSeverity::Critical,
                });
            }
        }

        // ── No rotation recorded ────────────────────────────────
        if record.last_rotated_at.is_none() && age_days > policy.max_age_days {
            violations.push(PolicyViolation {
                violation_type: ViolationType::NoRotationRecorded,
                message: "No rotation has ever been recorded for this credential".to_string(),
                severity: AlertSeverity::Warning,
            });
        }

        violations
    }

    /// Evaluate a credential against its assigned policy (looked up from the
    /// engine's store). Returns an empty vec if no policy is assigned.
    pub fn evaluate_record(&self, record: &CredentialRecord) -> Vec<PolicyViolation> {
        let Some(policy_id) = &record.rotation_policy_id else {
            return vec![];
        };
        let Some(policy) = self.policies.get(policy_id) else {
            return vec![];
        };
        self.evaluate_policy(record, policy)
    }
}

impl Default for PolicyEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use std::collections::HashMap;

    fn make_policy() -> RotationPolicy {
        RotationPolicy {
            id: "pol-1".to_string(),
            name: "Standard".to_string(),
            max_age_days: 90,
            warn_before_days: 14,
            require_different: true,
            min_strength: Some(PasswordStrength::Fair),
            applies_to: vec![CredentialType::Password],
            auto_notify: true,
            enforce: true,
        }
    }

    fn make_record(age_days: i64, strength: PasswordStrength) -> CredentialRecord {
        CredentialRecord {
            id: "cred-1".to_string(),
            connection_id: "conn-1".to_string(),
            credential_type: CredentialType::Password,
            label: "Test".to_string(),
            username: None,
            fingerprint: "abc".to_string(),
            created_at: Utc::now() - Duration::days(age_days),
            last_rotated_at: None,
            expires_at: None,
            rotation_policy_id: Some("pol-1".to_string()),
            group_id: None,
            strength: Some(strength),
            notes: String::new(),
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn no_violations_for_fresh_strong() {
        let engine = PolicyEngine::new();
        let policy = make_policy();
        let record = make_record(10, PasswordStrength::Strong);
        assert!(engine.evaluate_policy(&record, &policy).is_empty());
    }

    #[test]
    fn too_old_violation() {
        let engine = PolicyEngine::new();
        let policy = make_policy();
        let record = make_record(100, PasswordStrength::Strong);
        let violations = engine.evaluate_policy(&record, &policy);
        assert!(violations
            .iter()
            .any(|v| v.violation_type == ViolationType::TooOld));
    }

    #[test]
    fn too_weak_violation() {
        let engine = PolicyEngine::new();
        let policy = make_policy();
        let record = make_record(10, PasswordStrength::VeryWeak);
        let violations = engine.evaluate_policy(&record, &policy);
        assert!(violations
            .iter()
            .any(|v| v.violation_type == ViolationType::TooWeak));
    }

    #[test]
    fn expired_violation() {
        let engine = PolicyEngine::new();
        let policy = make_policy();
        let mut record = make_record(10, PasswordStrength::Strong);
        record.expires_at = Some(Utc::now() - Duration::days(3));
        let violations = engine.evaluate_policy(&record, &policy);
        assert!(violations
            .iter()
            .any(|v| v.violation_type == ViolationType::Expired));
    }
}
