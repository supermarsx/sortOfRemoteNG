//! # Credential Service
//!
//! Top-level orchestration service that ties together the tracker, policy
//! engine, group manager, audit log, and alert manager. Provides the
//! Tauri-compatible `Arc<Mutex<…>>` state handle.

use crate::alerts::AlertManager;
use crate::audit::AuditLog;
use crate::error::CredentialError;
use crate::groups::GroupManager;
use crate::persistence::{self, PersistedCredentialState};
use crate::policies::PolicyEngine;
use crate::tracker::CredentialTracker;
use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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
    /// Canonical app-managed persistence path. `None` is reserved for pure
    /// library/tests created with `new` or `with_config`.
    storage_path: Option<PathBuf>,
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
            storage_path: None,
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
            storage_path: None,
        }
    }

    /// Hydrate the native service from the canonical app data directory.
    /// Missing state is initialized and durably written; corrupt or unsafe
    /// state is returned as an error so startup can fail closed.
    pub fn persistent_state(
        app_data_dir: &Path,
    ) -> Result<CredentialServiceState, CredentialError> {
        let storage_path = app_data_dir
            .join(persistence::STATE_DIRECTORY)
            .join(persistence::STATE_FILENAME);
        let persisted = persistence::load(&storage_path)?;
        let mut service = match persisted {
            Some(snapshot) => Self::from_snapshot(snapshot, storage_path),
            None => {
                let mut service = Self::new();
                service.storage_path = Some(storage_path);
                service.persist_current()?;
                service
            }
        };
        service.synchronize_policy_engine();
        Ok(Arc::new(Mutex::new(service)))
    }

    /// Run a state mutation as a transaction. Both domain failures and durable
    /// write failures restore the complete previous snapshot before returning.
    pub fn mutate_and_persist<T>(
        &mut self,
        mutation: impl FnOnce(&mut Self) -> Result<T, CredentialError>,
    ) -> Result<T, CredentialError> {
        let previous = self.snapshot();
        let value = match mutation(self) {
            Ok(value) => value,
            Err(error) => {
                self.restore_snapshot(previous);
                return Err(error);
            }
        };
        if let Err(error) = self.persist_current() {
            self.restore_snapshot(previous);
            return Err(error);
        }
        Ok(value)
    }

    fn from_snapshot(snapshot: PersistedCredentialState, storage_path: PathBuf) -> Self {
        let mut audit = AuditLog::new(persistence::AUDIT_CAPACITY);
        audit.entries = snapshot.audit_entries;
        let policies = snapshot.policies;
        Self {
            tracker: CredentialTracker {
                credentials: snapshot.credentials,
                policies: policies.clone(),
            },
            policy_engine: PolicyEngine::with_policies(policies),
            groups: GroupManager {
                groups: snapshot.groups,
            },
            audit,
            alerts: AlertManager {
                alerts: snapshot.alerts,
            },
            config: snapshot.config,
            storage_path: Some(storage_path),
        }
    }

    fn snapshot(&self) -> PersistedCredentialState {
        PersistedCredentialState::new(
            self.tracker.credentials.clone(),
            self.tracker.policies.clone(),
            self.groups.groups.clone(),
            self.alerts.alerts.clone(),
            self.audit.entries.clone(),
            self.config.clone(),
        )
    }

    fn restore_snapshot(&mut self, snapshot: PersistedCredentialState) {
        let storage_path = self.storage_path.clone();
        *self = Self::from_snapshot(
            snapshot,
            storage_path
                .clone()
                .unwrap_or_else(|| PathBuf::from(persistence::STATE_FILENAME)),
        );
        self.storage_path = storage_path;
    }

    fn persist_current(&self) -> Result<(), CredentialError> {
        let Some(storage_path) = &self.storage_path else {
            return Ok(());
        };
        persistence::store(storage_path, &self.snapshot())
    }

    fn synchronize_policy_engine(&mut self) {
        self.policy_engine = PolicyEngine::with_policies(self.tracker.policies.clone());
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
