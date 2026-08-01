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
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::durable::durable_write;

const MAX_TRUST_STORE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TRUST_RECORDS: usize = 10_000;
const MAX_HISTORY_ENTRIES: usize = 1_000;
const MAX_HOST_BYTES: usize = 4_096;
const MAX_FINGERPRINT_BYTES: usize = 8_192;
const MAX_PEM_BYTES: usize = 2 * 1024 * 1024;
const MAX_NICKNAME_BYTES: usize = 512;
const MAX_TAGS: usize = 100;

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
pub struct CertChainEntry {
    pub subject: String,
    pub issuer: String,
    pub fingerprint: String,
    pub valid_from: String,
    pub valid_to: String,
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
    #[serde(default)]
    pub subject_cn: Option<String>,
    #[serde(default)]
    pub subject_org: Option<String>,
    #[serde(default)]
    pub subject_ou: Option<String>,
    #[serde(default)]
    pub subject_country: Option<String>,
    #[serde(default)]
    pub subject_state: Option<String>,
    #[serde(default)]
    pub subject_locality: Option<String>,
    #[serde(default)]
    pub subject_email: Option<String>,
    #[serde(default)]
    pub issuer_cn: Option<String>,
    #[serde(default)]
    pub issuer_org: Option<String>,
    #[serde(default)]
    pub issuer_country: Option<String>,
    #[serde(default)]
    pub key_algorithm: Option<String>,
    #[serde(default)]
    pub key_size: Option<u32>,
    #[serde(default)]
    pub version: Option<u32>,
    #[serde(default)]
    pub chain: Option<Vec<CertChainEntry>>,
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
    Tls(Box<CertIdentity>),
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
        // Commands and synchronous verifiers reload before use. Construction
        // stays infallible for Tauri state registration, while corrupt state
        // still fails closed on first access.
        let data = load_trust_store_data(&path).unwrap_or_default();
        Arc::new(Mutex::new(TrustStoreService {
            data,
            store_path: path,
        }))
    }

    fn persist(&self) -> Result<(), String> {
        persist_trust_store_data(&self.store_path, &self.data)
    }

    /// Reload validated persisted state before an operation from the external
    /// Tauri command adapter, keeping async commands coherent with sync writers.
    pub fn reload_from_disk(&mut self) -> Result<(), String> {
        self.data = load_trust_store_data(&self.store_path)?;
        Ok(())
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
    ) -> Result<TrustVerifyResult, String> {
        let result = verify_identity_in_data(&mut self.data, host, record_type, identity);
        self.persist()?;
        Ok(result)
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
        trust_identity_in_data(
            &mut self.data,
            host,
            record_type,
            identity,
            user_approved,
            reason,
            approved_by,
            note,
        );
        self.persist()
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn migrate_legacy_identity(
        &mut self,
        host: String,
        record_type: String,
        identity: Identity,
        user_approved: bool,
        history: Vec<Identity>,
        nickname: Option<String>,
        approved_by: Option<String>,
        note: Option<String>,
    ) -> Result<(), String> {
        let key = Self::record_key(&record_type, &host);
        if self.data.records.contains_key(&key) {
            return Ok(());
        }
        let now = Utc::now().to_rfc3339();
        let history = history
            .into_iter()
            .map(|identity| IdentityHistoryEntry {
                identity,
                changed_at: now.clone(),
                reason: IdentityChangeReason::Migrated,
                approved_by: approved_by.clone(),
                note: note.clone(),
                verification_count: 0,
                trust_score: 0,
            })
            .collect();
        self.data.records.insert(
            key,
            TrustRecord {
                host,
                record_type,
                identity,
                user_approved,
                nickname,
                history,
                host_policy: None,
                host_policy_config: None,
                stats: VerificationStats::default(),
                first_trusted: Some(now),
                trust_expires: None,
                revoked: false,
                tags: vec![],
            },
        );
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
        let avg_score = records
            .iter()
            .map(|r| r.stats.trust_score as u64)
            .sum::<u64>()
            .checked_div(total)
            .unwrap_or(0) as u8;

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
// Shared data-level operations (used by both the async service and the
// synchronous façade below). These are pure operations over `TrustStoreData`
// and contain the canonical verify/trust decision logic; persistence is the
// caller's responsibility.
// ---------------------------------------------------------------------------

/// Apply the verify-identity policy logic against the in-memory data and
/// mutate per-record stats. Does NOT persist (the caller persists if needed).
fn verify_identity_in_data(
    data: &mut TrustStoreData,
    host: &str,
    record_type: &str,
    identity: Identity,
) -> TrustVerifyResult {
    let key = TrustStoreService::record_key(record_type, host);
    let now_str = Utc::now().to_rfc3339();

    if let Some(record) = data.records.get_mut(&key) {
        // --- revoked ---
        if record.revoked {
            return TrustVerifyResult::Revoked {
                stored: record.identity.clone(),
            };
        }

        let stored_fp = TrustStoreService::identity_fingerprint(&record.identity).to_owned();
        let presented_fp = TrustStoreService::identity_fingerprint(&identity).to_owned();

        // Update stats
        record.stats.total_checks += 1;

        if stored_fp == presented_fp {
            record.stats.match_count += 1;
            record.stats.last_verified = Some(now_str);
            record.stats.trust_score = TrustStoreService::compute_trust_score(&record.stats);

            let policy = record
                .host_policy
                .clone()
                .unwrap_or_else(|| data.policy.clone());

            // Policy-aware checks on a matching fingerprint
            match policy {
                TrustPolicy::TofuWithExpiry if TrustStoreService::is_trust_expired(record) => {
                    return TrustVerifyResult::Expired {
                        stored: record.identity.clone(),
                        presented: identity,
                    };
                }
                TrustPolicy::ThresholdTrust => {
                    let required = record
                        .host_policy_config
                        .as_ref()
                        .and_then(|c| c.threshold_count)
                        .or(data.policy_config.threshold_count)
                        .unwrap_or(3);
                    if record.stats.match_count < required as u64 {
                        return TrustVerifyResult::PendingThreshold {
                            identity,
                            current_count: record.stats.match_count,
                            required_count: required,
                        };
                    }
                }
                TrustPolicy::TrustOnVerify if !record.user_approved => {
                    return TrustVerifyResult::PendingVerification { identity };
                }
                _ => {}
            }

            TrustVerifyResult::Trusted
        } else {
            record.stats.mismatch_count += 1;
            record.stats.last_mismatch = Some(now_str);
            record.stats.trust_score = TrustStoreService::compute_trust_score(&record.stats);

            let policy = record
                .host_policy
                .clone()
                .unwrap_or_else(|| data.policy.clone());

            match policy {
                TrustPolicy::KeyRotationGrace => {
                    let _grace_hours = record
                        .host_policy_config
                        .as_ref()
                        .and_then(|c| c.rotation_grace_hours)
                        .or(data.policy_config.rotation_grace_hours)
                        .unwrap_or(24);
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

/// Memorize / update an identity in the in-memory data. Does NOT persist.
#[allow(clippy::too_many_arguments)]
fn trust_identity_in_data(
    data: &mut TrustStoreData,
    host: String,
    record_type: String,
    identity: Identity,
    user_approved: bool,
    reason: IdentityChangeReason,
    approved_by: Option<String>,
    note: Option<String>,
) {
    let key = TrustStoreService::record_key(&record_type, &host);
    let now_str = Utc::now().to_rfc3339();

    // Compute trust expiry if using TofuWithExpiry
    let trust_expires = if data.policy == TrustPolicy::TofuWithExpiry {
        let days = data.policy_config.expiry_days.unwrap_or(90);
        Some((Utc::now() + chrono::Duration::days(days as i64)).to_rfc3339())
    } else {
        None
    };

    if let Some(existing) = data.records.get_mut(&key) {
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
        data.records.insert(
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
}

fn validate_short_string(value: &str, field: &str, maximum: usize) -> Result<(), String> {
    if value.is_empty() || value.len() > maximum || value.contains('\0') {
        return Err(format!("invalid trust-store {field}"));
    }
    Ok(())
}

fn validate_identity(identity: &Identity, expected_type: &str) -> Result<(), String> {
    match identity {
        Identity::Tls(cert) => {
            if expected_type == "ssh" {
                return Err("SSH trust record contains a TLS identity".to_string());
            }
            validate_short_string(
                &cert.fingerprint,
                "certificate fingerprint",
                MAX_FINGERPRINT_BYTES,
            )?;
            if cert
                .pem
                .as_ref()
                .is_some_and(|pem| pem.len() > MAX_PEM_BYTES)
            {
                return Err("trust-store certificate PEM is too large".to_string());
            }
            if cert.chain.as_ref().is_some_and(|chain| chain.len() > 64)
                || cert.chain_fingerprints.len() > 64
            {
                return Err("trust-store certificate chain is too large".to_string());
            }
        }
        Identity::Ssh(key) => {
            if expected_type != "ssh" {
                return Err("certificate trust record contains an SSH identity".to_string());
            }
            validate_short_string(&key.fingerprint, "SSH fingerprint", MAX_FINGERPRINT_BYTES)?;
            if key
                .public_key
                .as_ref()
                .is_some_and(|public_key| public_key.len() > 1024 * 1024)
            {
                return Err("trust-store SSH public key is too large".to_string());
            }
            if key.algorithms_offered.len() > 128 {
                return Err("too many SSH algorithms in trust record".to_string());
            }
        }
    }
    Ok(())
}

fn validate_trust_store_data(data: &TrustStoreData) -> Result<(), String> {
    if data.records.len() > MAX_TRUST_RECORDS {
        return Err("trust store contains too many records".to_string());
    }
    if data.policy_config.allowed_networks.len() > 1_024
        || data.policy_config.trusted_ca_fingerprints.len() > 1_024
    {
        return Err("trust-store policy configuration is too large".to_string());
    }
    for (key, record) in &data.records {
        validate_short_string(&record.host, "host", MAX_HOST_BYTES)?;
        if !matches!(
            record.record_type.as_str(),
            "https" | "certificate" | "rdp" | "ssh" | "tls"
        ) {
            return Err("unknown trust-store record type".to_string());
        }
        if key != &TrustStoreService::record_key(&record.record_type, &record.host) {
            return Err("trust-store record key does not match its contents".to_string());
        }
        validate_identity(&record.identity, &record.record_type)?;
        if record.history.len() > MAX_HISTORY_ENTRIES {
            return Err("trust-store history is too large".to_string());
        }
        for entry in &record.history {
            validate_identity(&entry.identity, &record.record_type)?;
            if entry.trust_score > 100 {
                return Err("invalid trust score in trust-store history".to_string());
            }
            if entry.note.as_ref().is_some_and(|note| note.len() > 4_096) {
                return Err("trust-store history note is too large".to_string());
            }
        }
        if record
            .nickname
            .as_ref()
            .is_some_and(|nickname| nickname.len() > MAX_NICKNAME_BYTES)
        {
            return Err("trust-store nickname is too large".to_string());
        }
        if record.tags.len() > MAX_TAGS
            || record
                .tags
                .iter()
                .any(|tag| tag.len() > 256 || tag.contains('\0'))
        {
            return Err("invalid trust-store tags".to_string());
        }
        if record.stats.trust_score > 100 {
            return Err("invalid trust-store trust score".to_string());
        }
    }
    Ok(())
}

/// Load and validate a bounded, regular trust-store file. Existing malformed,
/// unreadable, oversized, or symlinked state is an error rather than an empty
/// TOFU store.
fn load_trust_store_data(path: &Path) -> Result<TrustStoreData, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(TrustStoreData::default())
        }
        Err(error) => {
            return Err(format!(
                "read trust-store metadata {}: {error}",
                path.display()
            ))
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "trust store {} must be a regular non-symlink file",
            path.display()
        ));
    }
    if metadata.len() > MAX_TRUST_STORE_BYTES {
        return Err(format!(
            "trust store {} exceeds the {} byte limit",
            path.display(),
            MAX_TRUST_STORE_BYTES
        ));
    }

    let file = std::fs::File::open(path)
        .map_err(|error| format!("open trust store {}: {error}", path.display()))?;
    let mut bytes = Vec::new();
    file.take(MAX_TRUST_STORE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("read trust store {}: {error}", path.display()))?;
    if bytes.len() as u64 > MAX_TRUST_STORE_BYTES {
        return Err(format!(
            "trust store {} exceeds the {} byte limit",
            path.display(),
            MAX_TRUST_STORE_BYTES
        ));
    }
    let data: TrustStoreData = serde_json::from_slice(&bytes)
        .map_err(|error| format!("parse trust store {}: {error}", path.display()))?;
    validate_trust_store_data(&data)?;
    Ok(data)
}

/// Persist validated trust state atomically and durably.
fn persist_trust_store_data(path: &Path, data: &TrustStoreData) -> Result<(), String> {
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "trust store {} must be a regular non-symlink file",
                path.display()
            ));
        }
    }
    validate_trust_store_data(data)?;
    let json = serde_json::to_vec_pretty(data)
        .map_err(|error| format!("serialize trust store: {error}"))?;
    if json.len() as u64 > MAX_TRUST_STORE_BYTES {
        return Err("serialized trust store exceeds the size limit".to_string());
    }
    durable_write(path, &json)
}

// ---------------------------------------------------------------------------
// Synchronous façade (t24 — TLS-trust plumbing)
// ---------------------------------------------------------------------------
//
// `TrustStoreService` is `Arc<tokio::Mutex<…>>` with async methods. The rustls
// `ServerCertVerifier` runs synchronously inside the TLS handshake on a reqwest
// worker thread that lives *inside* the tokio runtime — calling `block_on`
// there would panic ("Cannot block the current thread from within a runtime").
//
// `SyncTrustStore` is an additive, runtime-agnostic façade that operates on the
// same `trust_store.json` file using a `std::sync::Mutex`. The JSON file is the
// shared source of truth, so TOFU records pinned by the verifier are visible to
// the async service (and the Trust Center UI), and vice-versa. To stay coherent
// with concurrent writers it re-reads the file under the lock before each
// operation and persists immediately after any mutation.
//
// This never touches the tokio runtime, so it is safe to call from the
// synchronous rustls verifier without deadlocking or panicking.

/// A blocking handle over the persistent trust store, sharing the same JSON
/// file as the async `TrustStoreService`. Cheap to clone (`Arc`-backed).
#[derive(Clone)]
pub struct SyncTrustStore {
    inner: Arc<std::sync::Mutex<PathBuf>>,
}

impl SyncTrustStore {
    /// Open (or lazily create) the sync façade over the given store path.
    /// This is the same path passed to `TrustStoreService::new`
    /// (`app_dir/trust_store.json`).
    pub fn new(store_path: impl Into<PathBuf>) -> Self {
        Self {
            inner: Arc::new(std::sync::Mutex::new(store_path.into())),
        }
    }

    /// Blocking verify against the persistent store (re-reads the file under
    /// the lock; updates per-record stats and persists them). Mirrors
    /// `TrustStoreService::verify_identity`.
    pub fn verify_identity_blocking(
        &self,
        host: &str,
        record_type: &str,
        identity: Identity,
    ) -> Result<TrustVerifyResult, String> {
        let path = self
            .inner
            .lock()
            .map_err(|_| "trust store lock poisoned".to_string())?;
        let mut data = load_trust_store_data(&path)?;
        let result = verify_identity_in_data(&mut data, host, record_type, identity);
        persist_trust_store_data(&path, &data)?;
        Ok(result)
    }

    /// The current global trust policy (re-read from disk). The verifier uses
    /// this when no per-connection override is supplied. Defaults to TOFU when
    /// the store is empty/absent (matches `TrustPolicy::default()`).
    pub fn global_policy(&self) -> TrustPolicy {
        match self.inner.lock() {
            Ok(path) => load_trust_store_data(&path)
                .map(|data| data.policy)
                .unwrap_or(TrustPolicy::Strict),
            Err(_) => TrustPolicy::Strict,
        }
    }

    /// Blocking trust/memorize against the persistent store. Mirrors
    /// `TrustStoreService::trust_identity`.
    pub fn trust_identity_blocking(
        &self,
        host: String,
        record_type: String,
        identity: Identity,
        user_approved: bool,
    ) -> Result<(), String> {
        let path = self
            .inner
            .lock()
            .map_err(|_| "trust store lock poisoned".to_string())?;
        let mut data = load_trust_store_data(&path)?;
        trust_identity_in_data(
            &mut data,
            host,
            record_type,
            identity,
            user_approved,
            IdentityChangeReason::Initial,
            None,
            None,
        );
        persist_trust_store_data(&path, &data)
    }
}

#[cfg(test)]
mod safety_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn malformed_existing_store_fails_closed() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("trust_store.json");
        std::fs::write(&path, b"{not-json").unwrap();
        assert!(load_trust_store_data(&path).is_err());
        assert_eq!(
            SyncTrustStore::new(path).global_policy(),
            TrustPolicy::Strict
        );
    }

    #[test]
    fn oversized_existing_store_is_rejected_without_reading_it_all() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("trust_store.json");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_TRUST_STORE_BYTES + 1).unwrap();
        assert!(load_trust_store_data(&path).is_err());
    }

    #[test]
    fn durable_persistence_round_trips_valid_state() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("trust_store.json");
        persist_trust_store_data(&path, &TrustStoreData::default()).unwrap();
        assert_eq!(
            load_trust_store_data(&path).unwrap().policy,
            TrustPolicy::Tofu
        );
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------
