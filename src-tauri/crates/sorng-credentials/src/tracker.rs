//! # Credential Tracker
//!
//! Core credential store — CRUD operations, expiry analysis, strength
//! estimation, duplicate detection, and policy compliance checks.

use crate::error::CredentialError;
use crate::types::*;
use chrono::Utc;
use log::info;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// Central credential store and analysis engine.
#[derive(Debug)]
pub struct CredentialTracker {
    /// All tracked credentials keyed by ID.
    pub credentials: HashMap<String, CredentialRecord>,
    /// All rotation policies keyed by ID.
    pub policies: HashMap<String, RotationPolicy>,
}

impl CredentialTracker {
    /// Create an empty tracker.
    pub fn new() -> Self {
        Self {
            credentials: HashMap::new(),
            policies: HashMap::new(),
        }
    }

    // ── CRUD ────────────────────────────────────────────────────────

    /// Register a new credential. Returns an error if the ID already exists.
    pub fn add_credential(&mut self, record: CredentialRecord) -> Result<(), CredentialError> {
        if self.credentials.contains_key(&record.id) {
            return Err(CredentialError::AlreadyExists(record.id.clone()));
        }
        info!("Adding credential {}", record.id);
        self.credentials.insert(record.id.clone(), record);
        Ok(())
    }

    /// Remove a credential by ID, returning the removed record.
    pub fn remove_credential(&mut self, id: &str) -> Result<CredentialRecord, CredentialError> {
        self.credentials
            .remove(id)
            .ok_or_else(|| CredentialError::NotFound(id.to_string()))
    }

    /// Replace an existing credential record in-place.
    pub fn update_credential(&mut self, record: CredentialRecord) -> Result<(), CredentialError> {
        if !self.credentials.contains_key(&record.id) {
            return Err(CredentialError::NotFound(record.id.clone()));
        }
        self.credentials.insert(record.id.clone(), record);
        Ok(())
    }

    /// Get a credential by ID.
    pub fn get_credential(&self, id: &str) -> Result<&CredentialRecord, CredentialError> {
        self.credentials
            .get(id)
            .ok_or_else(|| CredentialError::NotFound(id.to_string()))
    }

    /// List all tracked credentials.
    pub fn list_credentials(&self) -> Vec<&CredentialRecord> {
        self.credentials.values().collect()
    }

    // ── Rotation ────────────────────────────────────────────────────

    /// Record a rotation event — sets `last_rotated_at` to now.
    pub fn record_rotation(&mut self, id: &str) -> Result<(), CredentialError> {
        let record = self
            .credentials
            .get_mut(id)
            .ok_or_else(|| CredentialError::NotFound(id.to_string()))?;
        record.last_rotated_at = Some(Utc::now());
        info!("Recorded rotation for credential {id}");
        Ok(())
    }

    // ── Expiry Analysis ─────────────────────────────────────────────

    /// Compute the expiry status of a single credential.
    pub fn check_expiry(&self, id: &str) -> Result<ExpiryStatus, CredentialError> {
        let record = self.get_credential(id)?;
        Ok(Self::compute_expiry_status(record))
    }

    /// Compute expiry status for every tracked credential.
    pub fn check_all_expiries(&self) -> Vec<(String, ExpiryStatus)> {
        self.credentials
            .iter()
            .map(|(id, rec)| (id.clone(), Self::compute_expiry_status(rec)))
            .collect()
    }

    /// Internal helper to derive `ExpiryStatus` from a record.
    fn compute_expiry_status(record: &CredentialRecord) -> ExpiryStatus {
        let Some(expires) = record.expires_at else {
            return ExpiryStatus::NeverExpires;
        };
        let now = Utc::now();
        if expires <= now {
            let overdue = (now - expires).num_days().unsigned_abs();
            ExpiryStatus::Expired {
                days_overdue: overdue,
            }
        } else {
            let remaining = (expires - now).num_days().unsigned_abs();
            if remaining <= 30 {
                ExpiryStatus::ExpiringSoon {
                    days_remaining: remaining,
                }
            } else {
                ExpiryStatus::Valid
            }
        }
    }

    /// Return all credentials whose age exceeds `policy_age_days`.
    pub fn get_stale_credentials(&self, policy_age_days: u64) -> Vec<&CredentialRecord> {
        let now = Utc::now();
        self.credentials
            .values()
            .filter(|rec| {
                let last = rec.last_rotated_at.unwrap_or(rec.created_at);
                let age = (now - last).num_days().unsigned_abs();
                age > policy_age_days
            })
            .collect()
    }

    /// Return all credentials expiring within `days` from now.
    pub fn get_expiring_soon(&self, days: u64) -> Vec<&CredentialRecord> {
        let now = Utc::now();
        self.credentials
            .values()
            .filter(|rec| {
                if let Some(exp) = rec.expires_at {
                    if exp > now {
                        let remaining = (exp - now).num_days().unsigned_abs();
                        return remaining <= days;
                    }
                }
                false
            })
            .collect()
    }

    /// Return all credentials that have already expired.
    pub fn get_expired(&self) -> Vec<&CredentialRecord> {
        let now = Utc::now();
        self.credentials
            .values()
            .filter(|rec| rec.expires_at.map_or(false, |exp| exp <= now))
            .collect()
    }

    // ── Policy CRUD ─────────────────────────────────────────────────

    /// Add a rotation policy. Returns an error if the ID already exists.
    pub fn add_policy(&mut self, policy: RotationPolicy) -> Result<(), CredentialError> {
        if self.policies.contains_key(&policy.id) {
            return Err(CredentialError::PolicyAlreadyExists(policy.id.clone()));
        }
        info!("Adding rotation policy {}", policy.id);
        self.policies.insert(policy.id.clone(), policy);
        Ok(())
    }

    /// Remove a rotation policy by ID, returning the removed policy.
    pub fn remove_policy(&mut self, id: &str) -> Result<RotationPolicy, CredentialError> {
        self.policies
            .remove(id)
            .ok_or_else(|| CredentialError::PolicyNotFound(id.to_string()))
    }

    /// Get a rotation policy by ID.
    pub fn get_policy(&self, id: &str) -> Result<&RotationPolicy, CredentialError> {
        self.policies
            .get(id)
            .ok_or_else(|| CredentialError::PolicyNotFound(id.to_string()))
    }

    /// List all policies.
    pub fn list_policies(&self) -> Vec<&RotationPolicy> {
        self.policies.values().collect()
    }

    // ── Policy Compliance ───────────────────────────────────────────

    /// Check a single credential against its assigned rotation policy.
    /// Returns a list of human-readable violation descriptions.
    pub fn check_policy_compliance(&self, credential_id: &str) -> Result<Vec<String>, CredentialError> {
        let record = self.get_credential(credential_id)?;
        let policy_id = match &record.rotation_policy_id {
            Some(pid) => pid.clone(),
            None => return Ok(vec![]),
        };
        let policy = self.get_policy(&policy_id)?;
        let mut violations = Vec::new();
        let now = Utc::now();

        // Check max age.
        let last = record.last_rotated_at.unwrap_or(record.created_at);
        let age_days = (now - last).num_days().unsigned_abs();
        if age_days > policy.max_age_days {
            violations.push(format!(
                "Credential is {} days old, exceeding max age of {} days",
                age_days, policy.max_age_days
            ));
        }

        // Check expiry.
        if let Some(exp) = record.expires_at {
            if exp <= now {
                violations.push("Credential has expired".to_string());
            } else {
                let remaining = (exp - now).num_days().unsigned_abs();
                if remaining <= policy.warn_before_days {
                    violations.push(format!(
                        "Credential expires in {} days (warn threshold: {} days)",
                        remaining, policy.warn_before_days
                    ));
                }
            }
        }

        // Check strength.
        if let (Some(min), Some(actual)) = (&policy.min_strength, &record.strength) {
            if actual < min {
                violations.push(format!(
                    "Credential strength is {} but policy requires at least {}",
                    actual, min
                ));
            }
        }

        // Check that credential type is covered by the policy
        if !policy.applies_to.is_empty() && !policy.applies_to.contains(&record.credential_type) {
            violations.push(format!(
                "Credential type {} is not in the policy's applies_to list",
                record.credential_type
            ));
        }

        // Check no-rotation-recorded
        if record.last_rotated_at.is_none() && age_days > policy.max_age_days {
            violations.push("No rotation has ever been recorded for this credential".to_string());
        }

        Ok(violations)
    }

    // ── Strength Estimation ─────────────────────────────────────────

    /// Estimate the strength of a password / passphrase.
    ///
    /// Checks length, character-class diversity, and common patterns.
    pub fn calculate_password_strength(password: &str) -> PasswordStrength {
        let len = password.len();
        let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
        let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
        let has_digit = password.chars().any(|c| c.is_ascii_digit());
        let has_special = password.chars().any(|c| !c.is_alphanumeric());

        let mut score: u8 = 0;

        // Length scoring
        if len >= 8 {
            score += 1;
        }
        if len >= 12 {
            score += 1;
        }
        if len >= 16 {
            score += 1;
        }

        // Character-class diversity
        let classes = [has_upper, has_lower, has_digit, has_special]
            .iter()
            .filter(|&&b| b)
            .count();
        if classes >= 3 {
            score += 1;
        }
        if classes == 4 {
            score += 1;
        }

        // Penalize common patterns
        let lower = password.to_ascii_lowercase();
        let common = [
            "password", "123456", "qwerty", "letmein", "admin", "welcome",
            "monkey", "abc123", "111111", "iloveyou", "sunshine", "master",
            "trustno1", "passw0rd",
        ];
        for c in &common {
            if lower.contains(c) {
                score = score.saturating_sub(2);
            }
        }

        // Penalize if entirely one character class
        if classes <= 1 {
            score = score.saturating_sub(1);
        }

        // Penalize short passwords
        if len < 6 {
            score = 0;
        }

        // Map score to enum (max effective 6, clamp to 4)
        PasswordStrength::from_score(score.min(4))
    }

    // ── Duplicate Detection ─────────────────────────────────────────

    /// Group credential IDs that share the same fingerprint.
    ///
    /// Returns a list of groups (each group is a `Vec` of credential IDs).
    /// Groups with only one member are excluded.
    pub fn detect_duplicates(&self) -> Vec<Vec<String>> {
        let mut by_fingerprint: HashMap<&str, Vec<String>> = HashMap::new();
        for (id, rec) in &self.credentials {
            by_fingerprint
                .entry(rec.fingerprint.as_str())
                .or_default()
                .push(id.clone());
        }
        by_fingerprint
            .into_values()
            .filter(|ids| ids.len() > 1)
            .collect()
    }

    // ── Fingerprinting ──────────────────────────────────────────────

    /// Compute a SHA-256 hex-encoded fingerprint of a credential value.
    pub fn compute_fingerprint(value: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(value.as_bytes());
        let result = hasher.finalize();
        hex_encode(&result)
    }
}

impl Default for CredentialTracker {
    fn default() -> Self {
        Self::new()
    }
}

/// Encode bytes as lowercase hex.
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn sample_record(id: &str) -> CredentialRecord {
        CredentialRecord {
            id: id.to_string(),
            connection_id: "conn-1".to_string(),
            credential_type: CredentialType::Password,
            label: "Test".to_string(),
            username: Some("admin".to_string()),
            fingerprint: CredentialTracker::compute_fingerprint("s3cr3t"),
            created_at: Utc::now(),
            last_rotated_at: None,
            expires_at: None,
            rotation_policy_id: None,
            group_id: None,
            strength: Some(PasswordStrength::Fair),
            notes: String::new(),
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn add_and_get_credential() {
        let mut tracker = CredentialTracker::new();
        let rec = sample_record("cred-1");
        tracker.add_credential(rec).unwrap();
        assert!(tracker.get_credential("cred-1").is_ok());
    }

    #[test]
    fn duplicate_add_fails() {
        let mut tracker = CredentialTracker::new();
        tracker.add_credential(sample_record("cred-1")).unwrap();
        assert!(tracker.add_credential(sample_record("cred-1")).is_err());
    }

    #[test]
    fn remove_credential_returns_record() {
        let mut tracker = CredentialTracker::new();
        tracker.add_credential(sample_record("cred-1")).unwrap();
        let removed = tracker.remove_credential("cred-1").unwrap();
        assert_eq!(removed.id, "cred-1");
        assert!(tracker.get_credential("cred-1").is_err());
    }

    #[test]
    fn expiry_never() {
        let tracker = {
            let mut t = CredentialTracker::new();
            t.add_credential(sample_record("cred-1")).unwrap();
            t
        };
        assert_eq!(tracker.check_expiry("cred-1").unwrap(), ExpiryStatus::NeverExpires);
    }

    #[test]
    fn expiry_expired() {
        let mut tracker = CredentialTracker::new();
        let mut rec = sample_record("cred-1");
        rec.expires_at = Some(Utc::now() - Duration::days(5));
        tracker.add_credential(rec).unwrap();
        match tracker.check_expiry("cred-1").unwrap() {
            ExpiryStatus::Expired { days_overdue } => assert!(days_overdue >= 4),
            other => panic!("Expected Expired, got {:?}", other),
        }
    }

    #[test]
    fn expiry_soon() {
        let mut tracker = CredentialTracker::new();
        let mut rec = sample_record("cred-1");
        rec.expires_at = Some(Utc::now() + Duration::days(10));
        tracker.add_credential(rec).unwrap();
        match tracker.check_expiry("cred-1").unwrap() {
            ExpiryStatus::ExpiringSoon { days_remaining } => assert!(days_remaining <= 10),
            other => panic!("Expected ExpiringSoon, got {:?}", other),
        }
    }

    #[test]
    fn strength_estimation() {
        assert_eq!(CredentialTracker::calculate_password_strength("ab"), PasswordStrength::VeryWeak);
        assert!(CredentialTracker::calculate_password_strength("Str0ng!Pass#2024").score() >= 3);
    }

    #[test]
    fn fingerprint_deterministic() {
        let a = CredentialTracker::compute_fingerprint("hello");
        let b = CredentialTracker::compute_fingerprint("hello");
        assert_eq!(a, b);
        assert_ne!(a, CredentialTracker::compute_fingerprint("world"));
    }

    #[test]
    fn detect_duplicates_groups() {
        let mut tracker = CredentialTracker::new();
        let fp = CredentialTracker::compute_fingerprint("shared-secret");
        let mut r1 = sample_record("cred-1");
        r1.fingerprint = fp.clone();
        let mut r2 = sample_record("cred-2");
        r2.fingerprint = fp;
        tracker.add_credential(r1).unwrap();
        tracker.add_credential(r2).unwrap();
        let dups = tracker.detect_duplicates();
        assert_eq!(dups.len(), 1);
        assert_eq!(dups[0].len(), 2);
    }

    #[test]
    fn record_rotation_updates_timestamp() {
        let mut tracker = CredentialTracker::new();
        tracker.add_credential(sample_record("cred-1")).unwrap();
        assert!(tracker.get_credential("cred-1").unwrap().last_rotated_at.is_none());
        tracker.record_rotation("cred-1").unwrap();
        assert!(tracker.get_credential("cred-1").unwrap().last_rotated_at.is_some());
    }

    #[test]
    fn stale_credentials() {
        let mut tracker = CredentialTracker::new();
        let mut rec = sample_record("old");
        rec.created_at = Utc::now() - Duration::days(100);
        tracker.add_credential(rec).unwrap();
        let stale = tracker.get_stale_credentials(90);
        assert_eq!(stale.len(), 1);
    }

    #[test]
    fn policy_crud() {
        let mut tracker = CredentialTracker::new();
        let policy = RotationPolicy {
            id: "pol-1".to_string(),
            name: "Default".to_string(),
            max_age_days: 90,
            warn_before_days: 14,
            require_different: true,
            min_strength: Some(PasswordStrength::Fair),
            applies_to: vec![CredentialType::Password],
            auto_notify: true,
            enforce: true,
        };
        tracker.add_policy(policy).unwrap();
        assert!(tracker.get_policy("pol-1").is_ok());
        assert_eq!(tracker.list_policies().len(), 1);
        tracker.remove_policy("pol-1").unwrap();
        assert!(tracker.get_policy("pol-1").is_err());
    }
}
