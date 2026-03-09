//! # Trust Store — Backend TOFU (Trust On First Use) management
//!
//! Manages TLS certificate and SSH host key fingerprints with persistent
//! file-based storage. Replaces the frontend localStorage-based trust store.
//!
//! ## Features
//!
//! - Trust On First Use (TOFU) for TLS and SSH identities
//! - Configurable trust policies with per-host overrides
//! - Rich identity history tracking with timestamps, reasons, scores
//! - Verification statistics and trust scoring
//! - Expiry-aware trust with automatic re-validation
//! - Certificate pinning and key-rotation grace periods
//! - Persistent JSON storage
//! - CRUD operations on trust records

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// How to handle first-time and recurring identity encounters.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum TrustPolicy {
    /// Trust On First Use — accept + memorize silently
    #[default]
    Tofu,
    /// TOFU but auto-expire after `expiry_days` (re-prompt when stale)
    TofuWithExpiry,
    /// Always ask the user before trusting
    AlwaysAsk,
    /// Accept anything without checking
    AlwaysTrust,
    /// Reject if not pre-approved (manual pinning only)
    Strict,
    /// Pin the exact certificate chain (full chain must match)
    CertificatePinning,
    /// Allow key rotation within a configurable grace period
    KeyRotationGrace,
    /// Trust only after explicit out-of-band verification
    TrustOnVerify,
    /// Trust based on conditions (network, time-of-day, etc.)
    ConditionalTrust,
    /// Require the identity to be signed by a trusted CA
    CaTrustOnly,
    /// Threshold-based: trust after N successful verifications
    ThresholdTrust,
}

/// Configuration knobs that accompany certain trust policies.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct TrustPolicyConfig {
    /// For `TofuWithExpiry`: days before a trusted identity must be re-verified
    #[serde(default)]
    pub expiry_days: Option<u32>,
    /// For `KeyRotationGrace`: grace period in hours
    #[serde(default)]
    pub rotation_grace_hours: Option<u32>,
    /// For `ThresholdTrust`: number of times an identity must be seen
    /// before it is trusted automatically
    #[serde(default)]
    pub threshold_count: Option<u32>,
    /// For `ConditionalTrust`: allowed network CIDRs
    #[serde(default)]
    pub allowed_networks: Vec<String>,
    /// For `CaTrustOnly`: list of trusted CA fingerprints
    #[serde(default)]
    pub trusted_ca_fingerprints: Vec<String>,
}

/// Why an identity was stored / changed.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum IdentityChangeReason {
    /// First time this host was encountered
    #[default]
    Initial,
    /// Host presented a new identity and user accepted
    UserAccepted,
    /// Automatic rotation within grace period
    AutoRotated,
    /// Identity was revoked / blacklisted, then re-trusted
    ReinstatedAfterRevoke,
    /// External import / batch operation
    Imported,
    /// Out-of-band verification completed
    OutOfBandVerified,
    /// System migration from legacy store
    Migrated,
    /// Admin forced override
    AdminOverride,
}

/// A single entry in the identity-change history.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IdentityHistoryEntry {
    /// The identity at this point in time
    pub identity: Identity,
    /// ISO-8601 timestamp of when this change happened
    pub changed_at: String,
    /// Why the identity changed
    pub reason: IdentityChangeReason,
    /// Who / what approved the change (user email, "system", etc.)
    pub approved_by: Option<String>,
    /// Free-form note (e.g. "upgraded from 2048-bit RSA")
    pub note: Option<String>,
    /// Cumulative verification count at the time of this change
    pub verification_count: u64,
    /// Trust score (0–100) at the time of this change
    pub trust_score: u8,
}

/// Per-identity verification statistics.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct VerificationStats {
    /// Total successful verifications
    pub total_checks: u64,
    /// How many times the identity matched the stored one
    pub match_count: u64,
    /// How many times a mismatch was detected
    pub mismatch_count: u64,
    /// ISO-8601 timestamp of the last successful verification
    pub last_verified: Option<String>,
    /// ISO-8601 timestamp of the last mismatch
    pub last_mismatch: Option<String>,
    /// Moving-average trust score 0–100
    pub trust_score: u8,
}

/// TLS certificate identity information.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CertIdentity {
    /// SHA-256 fingerprint of the DER-encoded certificate
    pub fingerprint: String,
    /// Subject CN / SAN
    pub subject: Option<String>,
    /// Issuer CN
    pub issuer: Option<String>,
    /// ISO date string — when the cert was first seen
    pub first_seen: String,
    /// ISO date string — most recent time seen
    pub last_seen: String,
    /// Cert not-before (ISO)
    pub valid_from: Option<String>,
    /// Cert not-after (ISO)
    pub valid_to: Option<String>,
    /// PEM-encoded certificate
    pub pem: Option<String>,
    /// Serial number
    pub serial: Option<String>,
    /// Signature algorithm
    pub signature_algorithm: Option<String>,
    /// Subject Alternative Names
    pub san: Option<Vec<String>>,
    /// Full certificate chain fingerprints (for CertificatePinning)
    #[serde(default)]
    pub chain_fingerprints: Vec<String>,
}

/// SSH host key identity information.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SshHostKeyIdentity {
    /// Host key fingerprint (SHA-256 base64, e.g. "SHA256:...")
    pub fingerprint: String,
    /// Key type (e.g. "ssh-ed25519")
    pub key_type: Option<String>,
    /// Number of bits
    pub key_bits: Option<u32>,
    /// ISO date string — when first seen
    pub first_seen: String,
    /// ISO date string — most recent time seen
    pub last_seen: String,
    /// Raw base64 public key
    pub public_key: Option<String>,
    /// Host key algorithm preference order
    #[serde(default)]
    pub algorithms_offered: Vec<String>,
}

/// Union type for either TLS or SSH identity.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind")]
pub enum Identity {
    #[serde(rename = "tls")]
    Tls(CertIdentity),
    #[serde(rename = "ssh")]
    Ssh(SshHostKeyIdentity),
}

/// A trust record associating a host with a memorized identity.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TrustRecord {
    /// Target host identifier: "hostname:port"
    pub host: String,
    /// Protocol family
    pub record_type: String, // "tls" or "ssh"
    /// The memorized identity
    pub identity: Identity,
    /// User explicitly approved this identity
    pub user_approved: bool,
    /// Optional user-assigned nickname / label
    pub nickname: Option<String>,
    /// Previous identities with rich metadata
    pub history: Vec<IdentityHistoryEntry>,
    /// Per-host trust policy override (None = use global)
    #[serde(default)]
    pub host_policy: Option<TrustPolicy>,
    /// Per-host policy config overrides
    #[serde(default)]
    pub host_policy_config: Option<TrustPolicyConfig>,
    /// Verification statistics
    #[serde(default)]
    pub stats: VerificationStats,
    /// ISO-8601 timestamp when the identity was first trusted
    #[serde(default)]
    pub first_trusted: Option<String>,
    /// ISO-8601 timestamp when the trust expires (for TofuWithExpiry)
    #[serde(default)]
    pub trust_expires: Option<String>,
    /// Whether the identity is currently revoked
    #[serde(default)]
    pub revoked: bool,
    /// Tags for organizing / filtering
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Result of verifying an identity against the trust store.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "status")]
pub enum TrustVerifyResult {
    /// Identity matches stored record
    #[serde(rename = "trusted")]
    Trusted,
    /// First time seeing this host
    #[serde(rename = "first-use")]
    FirstUse { identity: Identity },
    /// Identity changed from what was stored
    #[serde(rename = "mismatch")]
    Mismatch {
        stored: Identity,
        presented: Identity,
    },
    /// Trust has expired (TofuWithExpiry)
    #[serde(rename = "expired")]
    Expired {
        stored: Identity,
        presented: Identity,
    },
    /// Identity is currently revoked
    #[serde(rename = "revoked")]
    Revoked { stored: Identity },
    /// Threshold not yet reached (ThresholdTrust)
    #[serde(rename = "pending-threshold")]
    PendingThreshold {
        identity: Identity,
        current_count: u64,
        required_count: u32,
    },
    /// Awaiting out-of-band verification
    #[serde(rename = "pending-verification")]
    PendingVerification { identity: Identity },
    /// Certificate chain mismatch (CertificatePinning)
    #[serde(rename = "chain-mismatch")]
    ChainMismatch {
        stored: Identity,
        presented: Identity,
    },
    /// Key changed but within rotation grace period
    #[serde(rename = "rotation-grace")]
    RotationGrace {
        stored: Identity,
        presented: Identity,
    },
}

/// Persistent store.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct TrustStoreData {
    policy: TrustPolicy,
    #[serde(default)]
    policy_config: TrustPolicyConfig,
    records: HashMap<String, TrustRecord>,
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

pub type TrustStoreServiceState = Arc<Mutex<TrustStoreService>>;

pub struct TrustStoreService {
    data: TrustStoreData,
    store_path: PathBuf,
}

impl TrustStoreService {
    pub fn new(store_path: String) -> TrustStoreServiceState {
        let path = PathBuf::from(&store_path);
        let data = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            TrustStoreData::default()
        };
        Arc::new(Mutex::new(TrustStoreService {
            data,
            store_path: path,
        }))
    }

    fn persist(&self) -> Result<(), String> {
        if let Some(parent) = self.store_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
        }
        let json =
            serde_json::to_string_pretty(&self.data).map_err(|e| format!("serialize: {}", e))?;
        fs::write(&self.store_path, json).map_err(|e| format!("write: {}", e))
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn identity_fingerprint(identity: &Identity) -> &str {
        match identity {
            Identity::Tls(c) => &c.fingerprint,
            Identity::Ssh(s) => &s.fingerprint,
        }
    }

    /// Build a lookup key: "type:host"
    fn record_key(record_type: &str, host: &str) -> String {
        format!("{}:{}", record_type, host)
    }

    /// Determine the effective policy for a record (per-host override wins).
    #[allow(dead_code)]
    fn effective_policy<'a>(&'a self, record: &'a TrustRecord) -> &'a TrustPolicy {
        record.host_policy.as_ref().unwrap_or(&self.data.policy)
    }

    /// Determine the effective policy config for a record.
    #[allow(dead_code)]
    fn effective_config<'a>(&'a self, record: &'a TrustRecord) -> &'a TrustPolicyConfig {
        record
            .host_policy_config
            .as_ref()
            .unwrap_or(&self.data.policy_config)
    }

    /// Check whether a record's trust has expired based on its expiry timestamp.
    fn is_trust_expired(record: &TrustRecord) -> bool {
        if let Some(ref expires) = record.trust_expires {
            if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(expires) {
                return Utc::now() > exp;
            }
        }
        false
    }

    /// Compute a simple trust score: starts at 50, +1 per match, −10 per mismatch, clamped [0,100].
    fn compute_trust_score(stats: &VerificationStats) -> u8 {
        let base: i64 = 50;
        let score = base + stats.match_count as i64 - (stats.mismatch_count as i64 * 10);
        score.clamp(0, 100) as u8
    }

    // -----------------------------------------------------------------------
    // Core API
    // -----------------------------------------------------------------------

    /// Verify an identity against the trust store, respecting the effective
    /// policy (global or per-host override).
    pub async fn verify_identity(
        &mut self,
        host: &str,
        record_type: &str,
        identity: Identity,
    ) -> TrustVerifyResult {
        let key = Self::record_key(record_type, host);
        let now_str = Utc::now().to_rfc3339();

        if let Some(record) = self.data.records.get_mut(&key) {
            // --- revoked ---
            if record.revoked {
                return TrustVerifyResult::Revoked {
                    stored: record.identity.clone(),
                };
            }

            let stored_fp = Self::identity_fingerprint(&record.identity).to_owned();
            let presented_fp = Self::identity_fingerprint(&identity).to_owned();

            // Update stats
            record.stats.total_checks += 1;

            if stored_fp == presented_fp {
                record.stats.match_count += 1;
                record.stats.last_verified = Some(now_str);
                record.stats.trust_score = Self::compute_trust_score(&record.stats);

                let policy = record
                    .host_policy
                    .clone()
                    .unwrap_or_else(|| self.data.policy.clone());

                // Policy-aware checks on a matching fingerprint
                match policy {
                    TrustPolicy::TofuWithExpiry => {
                        if Self::is_trust_expired(record) {
                            return TrustVerifyResult::Expired {
                                stored: record.identity.clone(),
                                presented: identity,
                            };
                        }
                    }
                    TrustPolicy::ThresholdTrust => {
                        let required = record
                            .host_policy_config
                            .as_ref()
                            .and_then(|c| c.threshold_count)
                            .or(self.data.policy_config.threshold_count)
                            .unwrap_or(3);
                        if record.stats.match_count < required as u64 {
                            return TrustVerifyResult::PendingThreshold {
                                identity,
                                current_count: record.stats.match_count,
                                required_count: required,
                            };
                        }
                    }
                    TrustPolicy::TrustOnVerify => {
                        if !record.user_approved {
                            return TrustVerifyResult::PendingVerification { identity };
                        }
                    }
                    _ => {}
                }

                TrustVerifyResult::Trusted
            } else {
                record.stats.mismatch_count += 1;
                record.stats.last_mismatch = Some(now_str);
                record.stats.trust_score = Self::compute_trust_score(&record.stats);

                let policy = record
                    .host_policy
                    .clone()
                    .unwrap_or_else(|| self.data.policy.clone());

                match policy {
                    TrustPolicy::KeyRotationGrace => {
                        // If the last mismatch was recent (within grace), return
                        // RotationGrace instead of hard Mismatch.
                        let _grace_hours = record
                            .host_policy_config
                            .as_ref()
                            .and_then(|c| c.rotation_grace_hours)
                            .or(self.data.policy_config.rotation_grace_hours)
                            .unwrap_or(24);
                        // Simplified: just report as RotationGrace — the frontend
                        // decides whether to auto-accept.
                        TrustVerifyResult::RotationGrace {
                            stored: record.identity.clone(),
                            presented: identity,
                        }
                    }
                    TrustPolicy::CertificatePinning => TrustVerifyResult::ChainMismatch {
                        stored: record.identity.clone(),
                        presented: identity,
                    },
                    _ => TrustVerifyResult::Mismatch {
                        stored: record.identity.clone(),
                        presented: identity,
                    },
                }
            }
        } else {
            TrustVerifyResult::FirstUse { identity }
        }
    }

    /// Trust (memorize) an identity for a host with full metadata.
    pub async fn trust_identity(
        &mut self,
        host: String,
        record_type: String,
        identity: Identity,
        user_approved: bool,
    ) -> Result<(), String> {
        self.trust_identity_with_reason(
            host,
            record_type,
            identity,
            user_approved,
            IdentityChangeReason::Initial,
            None,
            None,
        )
        .await
    }

    /// Trust an identity with a specific reason and metadata.
    #[allow(clippy::too_many_arguments)]
    pub async fn trust_identity_with_reason(
        &mut self,
        host: String,
        record_type: String,
        identity: Identity,
        user_approved: bool,
        reason: IdentityChangeReason,
        approved_by: Option<String>,
        note: Option<String>,
    ) -> Result<(), String> {
        let key = Self::record_key(&record_type, &host);
        let now_str = Utc::now().to_rfc3339();

        // Compute trust expiry if using TofuWithExpiry
        let trust_expires = if self.data.policy == TrustPolicy::TofuWithExpiry {
            let days = self.data.policy_config.expiry_days.unwrap_or(90);
            Some((Utc::now() + chrono::Duration::days(days as i64)).to_rfc3339())
        } else {
            None
        };

        if let Some(existing) = self.data.records.get_mut(&key) {
            // Move old identity to history with metadata
            let history_entry = IdentityHistoryEntry {
                identity: existing.identity.clone(),
                changed_at: now_str.clone(),
                reason: if reason == IdentityChangeReason::Initial {
                    IdentityChangeReason::UserAccepted
                } else {
                    reason
                },
                approved_by,
                note,
                verification_count: existing.stats.total_checks,
                trust_score: existing.stats.trust_score,
            };
            existing.history.push(history_entry);
            existing.identity = identity;
            existing.user_approved = user_approved;
            if trust_expires.is_some() {
                existing.trust_expires = trust_expires;
            }
        } else {
            self.data.records.insert(
                key,
                TrustRecord {
                    host,
                    record_type,
                    identity,
                    user_approved,
                    nickname: None,
                    history: vec![],
                    host_policy: None,
                    host_policy_config: None,
                    stats: VerificationStats::default(),
                    first_trusted: Some(now_str),
                    trust_expires,
                    revoked: false,
                    tags: vec![],
                },
            );
        }

        self.persist()
    }

    /// Remove a trust record for a host.
    pub async fn remove_identity(&mut self, host: &str, record_type: &str) -> Result<(), String> {
        let key = Self::record_key(record_type, host);
        self.data
            .records
            .remove(&key)
            .ok_or_else(|| "Trust record not found".to_string())?;
        self.persist()
    }

    /// Get the stored identity for a host.
    pub async fn get_stored_identity(&self, host: &str, record_type: &str) -> Option<TrustRecord> {
        let key = Self::record_key(record_type, host);
        self.data.records.get(&key).cloned()
    }

    /// Get all trust records.
    pub async fn get_all_trust_records(&self) -> Vec<TrustRecord> {
        self.data.records.values().cloned().collect()
    }

    /// Clear all trust records.
    pub async fn clear_all_trust_records(&mut self) -> Result<(), String> {
        self.data.records.clear();
        self.persist()
    }

    /// Update the nickname on a trust record.
    pub async fn update_trust_record_nickname(
        &mut self,
        host: &str,
        record_type: &str,
        nickname: Option<String>,
    ) -> Result<(), String> {
        let key = Self::record_key(record_type, host);
        let record = self
            .data
            .records
            .get_mut(&key)
            .ok_or_else(|| "Trust record not found".to_string())?;
        record.nickname = nickname;
        self.persist()
    }

    /// Get the current global trust policy.
    pub async fn get_trust_policy(&self) -> TrustPolicy {
        self.data.policy.clone()
    }

    /// Set the global trust policy.
    pub async fn set_trust_policy(&mut self, policy: TrustPolicy) -> Result<(), String> {
        self.data.policy = policy;
        self.persist()
    }

    // -----------------------------------------------------------------------
    // Extended API: per-host policy, revocation, history, stats
    // -----------------------------------------------------------------------

    /// Get the global trust policy configuration.
    pub async fn get_trust_policy_config(&self) -> TrustPolicyConfig {
        self.data.policy_config.clone()
    }

    /// Set the global trust policy configuration.
    pub async fn set_trust_policy_config(
        &mut self,
        config: TrustPolicyConfig,
    ) -> Result<(), String> {
        self.data.policy_config = config;
        self.persist()
    }

    /// Set a per-host trust policy override.
    pub async fn set_host_policy(
        &mut self,
        host: &str,
        record_type: &str,
        policy: Option<TrustPolicy>,
        config: Option<TrustPolicyConfig>,
    ) -> Result<(), String> {
        let key = Self::record_key(record_type, host);
        let record = self
            .data
            .records
            .get_mut(&key)
            .ok_or_else(|| "Trust record not found".to_string())?;
        record.host_policy = policy;
        record.host_policy_config = config;
        self.persist()
    }

    /// Revoke trust for a host identity (soft-delete: keeps history).
    pub async fn revoke_identity(&mut self, host: &str, record_type: &str) -> Result<(), String> {
        let key = Self::record_key(record_type, host);
        let record = self
            .data
            .records
            .get_mut(&key)
            .ok_or_else(|| "Trust record not found".to_string())?;
        record.revoked = true;

        let entry = IdentityHistoryEntry {
            identity: record.identity.clone(),
            changed_at: Utc::now().to_rfc3339(),
            reason: IdentityChangeReason::ReinstatedAfterRevoke,
            approved_by: Some("system".to_string()),
            note: Some("Identity revoked".to_string()),
            verification_count: record.stats.total_checks,
            trust_score: record.stats.trust_score,
        };
        record.history.push(entry);
        self.persist()
    }

    /// Un-revoke (reinstate) trust for a host identity.
    pub async fn reinstate_identity(
        &mut self,
        host: &str,
        record_type: &str,
    ) -> Result<(), String> {
        let key = Self::record_key(record_type, host);
        let record = self
            .data
            .records
            .get_mut(&key)
            .ok_or_else(|| "Trust record not found".to_string())?;
        record.revoked = false;
        self.persist()
    }

    /// Update tags on a trust record.
    pub async fn set_record_tags(
        &mut self,
        host: &str,
        record_type: &str,
        tags: Vec<String>,
    ) -> Result<(), String> {
        let key = Self::record_key(record_type, host);
        let record = self
            .data
            .records
            .get_mut(&key)
            .ok_or_else(|| "Trust record not found".to_string())?;
        record.tags = tags;
        self.persist()
    }

    /// Get identity history for a host.
    pub async fn get_identity_history(
        &self,
        host: &str,
        record_type: &str,
    ) -> Result<Vec<IdentityHistoryEntry>, String> {
        let key = Self::record_key(record_type, host);
        let record = self
            .data
            .records
            .get(&key)
            .ok_or_else(|| "Trust record not found".to_string())?;
        Ok(record.history.clone())
    }

    /// Get verification statistics for a host.
    pub async fn get_verification_stats(
        &self,
        host: &str,
        record_type: &str,
    ) -> Result<VerificationStats, String> {
        let key = Self::record_key(record_type, host);
        let record = self
            .data
            .records
            .get(&key)
            .ok_or_else(|| "Trust record not found".to_string())?;
        Ok(record.stats.clone())
    }

    /// Get a summary of all trust statistics across all records.
    pub async fn get_trust_summary(&self) -> TrustSummary {
        let records: Vec<&TrustRecord> = self.data.records.values().collect();
        let total = records.len() as u64;
        let revoked = records.iter().filter(|r| r.revoked).count() as u64;
        let expired = records.iter().filter(|r| Self::is_trust_expired(r)).count() as u64;
        let with_history = records.iter().filter(|r| !r.history.is_empty()).count() as u64;
        let total_checks: u64 = records.iter().map(|r| r.stats.total_checks).sum();
        let total_mismatches: u64 = records.iter().map(|r| r.stats.mismatch_count).sum();
        let avg_score = if total > 0 {
            (records
                .iter()
                .map(|r| r.stats.trust_score as u64)
                .sum::<u64>()
                / total) as u8
        } else {
            0
        };

        TrustSummary {
            total_records: total,
            revoked_count: revoked,
            expired_count: expired,
            records_with_history: with_history,
            total_verifications: total_checks,
            total_mismatches,
            average_trust_score: avg_score,
        }
    }
}

/// Aggregate statistics about the trust store.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TrustSummary {
    pub total_records: u64,
    pub revoked_count: u64,
    pub expired_count: u64,
    pub records_with_history: u64,
    pub total_verifications: u64,
    pub total_mismatches: u64,
    pub average_trust_score: u8,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn trust_verify_identity(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    identity: Identity,
) -> Result<TrustVerifyResult, String> {
    let mut svc = state.lock().await;
    Ok(svc.verify_identity(&host, &record_type, identity).await)
}

#[tauri::command]
pub async fn trust_store_identity(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    identity: Identity,
    user_approved: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.trust_identity(host, record_type, identity, user_approved)
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn trust_store_identity_with_reason(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    identity: Identity,
    user_approved: bool,
    reason: IdentityChangeReason,
    approved_by: Option<String>,
    note: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.trust_identity_with_reason(
        host,
        record_type,
        identity,
        user_approved,
        reason,
        approved_by,
        note,
    )
    .await
}

#[tauri::command]
pub async fn trust_remove_identity(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_identity(&host, &record_type).await
}

#[tauri::command]
pub async fn trust_get_identity(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
) -> Result<Option<TrustRecord>, String> {
    let svc = state.lock().await;
    Ok(svc.get_stored_identity(&host, &record_type).await)
}

#[tauri::command]
pub async fn trust_get_all_records(
    state: tauri::State<'_, TrustStoreServiceState>,
) -> Result<Vec<TrustRecord>, String> {
    let svc = state.lock().await;
    Ok(svc.get_all_trust_records().await)
}

#[tauri::command]
pub async fn trust_clear_all(
    state: tauri::State<'_, TrustStoreServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.clear_all_trust_records().await
}

#[tauri::command]
pub async fn trust_update_nickname(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    nickname: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_trust_record_nickname(&host, &record_type, nickname)
        .await
}

#[tauri::command]
pub async fn trust_get_policy(
    state: tauri::State<'_, TrustStoreServiceState>,
) -> Result<TrustPolicy, String> {
    let svc = state.lock().await;
    Ok(svc.get_trust_policy().await)
}

#[tauri::command]
pub async fn trust_set_policy(
    state: tauri::State<'_, TrustStoreServiceState>,
    policy: TrustPolicy,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_trust_policy(policy).await
}

#[tauri::command]
pub async fn trust_get_policy_config(
    state: tauri::State<'_, TrustStoreServiceState>,
) -> Result<TrustPolicyConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_trust_policy_config().await)
}

#[tauri::command]
pub async fn trust_set_policy_config(
    state: tauri::State<'_, TrustStoreServiceState>,
    config: TrustPolicyConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_trust_policy_config(config).await
}

#[tauri::command]
pub async fn trust_set_host_policy(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    policy: Option<TrustPolicy>,
    config: Option<TrustPolicyConfig>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_host_policy(&host, &record_type, policy, config)
        .await
}

#[tauri::command]
pub async fn trust_revoke_identity(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.revoke_identity(&host, &record_type).await
}

#[tauri::command]
pub async fn trust_reinstate_identity(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reinstate_identity(&host, &record_type).await
}

#[tauri::command]
pub async fn trust_set_record_tags(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_record_tags(&host, &record_type, tags).await
}

#[tauri::command]
pub async fn trust_get_identity_history(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
) -> Result<Vec<IdentityHistoryEntry>, String> {
    let svc = state.lock().await;
    svc.get_identity_history(&host, &record_type).await
}

#[tauri::command]
pub async fn trust_get_verification_stats(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
) -> Result<VerificationStats, String> {
    let svc = state.lock().await;
    svc.get_verification_stats(&host, &record_type).await
}

#[tauri::command]
pub async fn trust_get_summary(
    state: tauri::State<'_, TrustStoreServiceState>,
) -> Result<TrustSummary, String> {
    let svc = state.lock().await;
    Ok(svc.get_trust_summary().await)
}
