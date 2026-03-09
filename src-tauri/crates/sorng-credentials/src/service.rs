//! # Credential Service
//!
//! Top-level orchestration service that ties together the tracker, policy
//! engine, group manager, audit log, and alert manager. Provides the
//! Tauri-compatible `Arc<Mutex<…>>` state handle.

use crate::alerts::AlertManager;
use crate::audit::AuditLog;
use crate::groups::GroupManager;
use crate::policies::PolicyEngine;
use crate::tracker::CredentialTracker;
use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Tauri-managed state handle for the credential service.
pub type CredentialServiceState = Arc<Mutex<CredentialService>>;

/// The top-level credential service coordinating all subsystems.
pub struct CredentialService {
    /// Core credential store and expiry analysis.
    pub tracker: CredentialTracker,
    /// Policy evaluation engine.
    pub policy_engine: PolicyEngine,
    /// Credential group manager.
    pub groups: GroupManager,
    /// Audit log.
    pub audit: AuditLog,
    /// Alert manager.
    pub alerts: AlertManager,
    /// Global configuration.
    pub config: CredentialsConfig,
}

impl CredentialService {
    /// Create a new credential service with default configuration.
    pub fn new() -> Self {
        Self {
            tracker: CredentialTracker::new(),
            policy_engine: PolicyEngine::new(),
            groups: GroupManager::new(),
            audit: AuditLog::new(10_000),
            alerts: AlertManager::new(),
            config: CredentialsConfig::default(),
        }
    }

    /// Create a new credential service with the given configuration.
    pub fn with_config(config: CredentialsConfig) -> Self {
        Self {
            tracker: CredentialTracker::new(),
            policy_engine: PolicyEngine::new(),
            groups: GroupManager::new(),
            audit: AuditLog::new(10_000),
            alerts: AlertManager::new(),
            config,
        }
    }

    /// Compute aggregate statistics across all tracked credentials.
    pub fn get_stats(&self) -> CredentialStats {
        let now = Utc::now();
        let credentials = &self.tracker.credentials;
        let total = credentials.len();

        // By type
        let mut by_type: HashMap<String, usize> = HashMap::new();
        for rec in credentials.values() {
            *by_type
                .entry(format!("{}", rec.credential_type))
                .or_default() += 1;
        }

        // Expired / expiring soon
        let mut expired_count = 0usize;
        let mut expiring_soon_count = 0usize;
        for rec in credentials.values() {
            if let Some(exp) = rec.expires_at {
                if exp <= now {
                    expired_count += 1;
                } else {
                    let remaining = (exp - now).num_days().unsigned_abs();
                    if remaining <= 30 {
                        expiring_soon_count += 1;
                    }
                }
            }
        }

        // Stale
        let stale_count = credentials
            .values()
            .filter(|rec| {
                let last = rec.last_rotated_at.unwrap_or(rec.created_at);
                let age = (now - last).num_days().unsigned_abs();
                let max = rec
                    .rotation_policy_id
                    .as_ref()
                    .and_then(|pid| self.tracker.policies.get(pid))
                    .map(|p| p.max_age_days)
                    .unwrap_or(self.config.default_max_age_days);
                age > max
            })
            .count();

        // Weak
        let weak_count = credentials
            .values()
            .filter(|rec| {
                rec.strength
                    .as_ref()
                    .is_some_and(|s| *s <= PasswordStrength::Weak)
            })
            .count();

        // Duplicates
        let dup_groups = self.tracker.detect_duplicates();
        let duplicate_count: usize = dup_groups.iter().map(|g| g.len()).sum();

        // Age stats
        let ages: Vec<u64> = credentials
            .values()
            .map(|rec| (now - rec.created_at).num_days().unsigned_abs())
            .collect();
        let avg_age_days = if ages.is_empty() {
            0.0
        } else {
            ages.iter().sum::<u64>() as f64 / ages.len() as f64
        };
        let oldest_credential_days = ages.iter().copied().max().unwrap_or(0);

        CredentialStats {
            total_credentials: total,
            by_type,
            expired_count,
            expiring_soon_count,
            stale_count,
            weak_count,
            duplicate_count,
            avg_age_days,
            oldest_credential_days,
        }
    }
}

impl Default for CredentialService {
    fn default() -> Self {
        Self::new()
    }
}
