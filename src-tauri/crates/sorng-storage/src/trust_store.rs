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
use std::sync::{Arc, OnceLock, RwLock};
use tokio::sync::Mutex;

use crate::durable::durable_write;
use crate::envelope_io::{decrypt_with_subkey, encrypt_with_subkey, is_envelope_blob};
use crate::sdbf;
use sorng_encryption::{ArtifactKind, EncryptionState, SubKey};

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
pub struct TrustStoreData {
    pub policy: TrustPolicy,
    #[serde(default)]
    pub policy_config: TrustPolicyConfig,
    pub records: HashMap<String, TrustRecord>,
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

pub type TrustStoreServiceState = Arc<Mutex<TrustStoreService>>;

/// Where a service / sync façade reads and writes its records.
///
/// * `Legacy(path)` — the pre-t62 single plaintext JSON file. Kept for
///   tests and for reading the legacy sidecar during migration; no
///   production code path constructs it any more.
/// * `Shared` — the process-global [`TrustRuntime`]: the active database's
///   `databases/<id>.trust.json`, SDBF-laddered and P4-encrypted whenever
///   the database layer would encrypt. Fails closed when no database is
///   active.
#[derive(Clone)]
enum StoreBackend {
    Legacy(Arc<std::sync::Mutex<PathBuf>>),
    Shared,
}

impl StoreBackend {
    /// Serialised read-modify-write against the backend. The closure gets
    /// the freshly loaded data; when it returns `true` the data is
    /// persisted before the lock is released.
    fn with_data<R>(&self, f: impl FnOnce(&mut TrustStoreData) -> (R, bool)) -> Result<R, String> {
        match self {
            StoreBackend::Legacy(path) => {
                let path = path
                    .lock()
                    .map_err(|_| "trust store lock poisoned".to_string())?;
                let mut data = load_trust_store_data(&path)?;
                let (out, dirty) = f(&mut data);
                if dirty {
                    persist_trust_store_data(&path, &data)?;
                }
                Ok(out)
            }
            StoreBackend::Shared => {
                let rt = runtime()?;
                let _io = rt.io_guard()?;
                let mut data = rt.load_active()?;
                let (out, dirty) = f(&mut data);
                if dirty {
                    rt.persist_active(&data)?;
                }
                Ok(out)
            }
        }
    }

    fn load(&self) -> Result<TrustStoreData, String> {
        self.with_data(|data| (data.clone(), false))
    }

    fn store(&self, data: &TrustStoreData) -> Result<(), String> {
        self.with_data(|current| {
            *current = data.clone();
            ((), true)
        })
    }
}

pub struct TrustStoreService {
    data: TrustStoreData,
    backend: StoreBackend,
}

impl TrustStoreService {
    /// Legacy single-file mode over an explicit path. Only tests and the
    /// migration reader use this; production state is [`Self::shared`].
    pub fn new(store_path: String) -> TrustStoreServiceState {
        let path = PathBuf::from(&store_path);
        // Commands and synchronous verifiers reload before use. Construction
        // stays infallible for Tauri state registration, while corrupt state
        // still fails closed on first access.
        let data = load_trust_store_data(&path).unwrap_or_default();
        Arc::new(Mutex::new(TrustStoreService {
            data,
            backend: StoreBackend::Legacy(Arc::new(std::sync::Mutex::new(path))),
        }))
    }

    /// Service resolving the active database's trust file through the
    /// process-global [`TrustRuntime`]. Every operation reloads first, so
    /// construction never touches disk and never needs an active database.
    pub fn shared() -> TrustStoreServiceState {
        Arc::new(Mutex::new(TrustStoreService {
            data: TrustStoreData::default(),
            backend: StoreBackend::Shared,
        }))
    }

    fn persist(&self) -> Result<(), String> {
        self.backend.store(&self.data)
    }

    /// Reload validated persisted state before an operation from the external
    /// Tauri command adapter, keeping async commands coherent with sync writers.
    pub fn reload_from_disk(&mut self) -> Result<(), String> {
        self.data = self.backend.load()?;
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

/// A blocking handle over the persistent trust store, sharing the same file
/// as the async `TrustStoreService`. Cheap to clone (`Arc`-backed).
#[derive(Clone)]
pub struct SyncTrustStore {
    backend: StoreBackend,
}

impl SyncTrustStore {
    /// Legacy single-file mode over an explicit plaintext JSON path. Kept
    /// for tests; production verifiers use [`Self::shared`].
    pub fn new(store_path: impl Into<PathBuf>) -> Self {
        Self {
            backend: StoreBackend::Legacy(Arc::new(std::sync::Mutex::new(store_path.into()))),
        }
    }

    /// The sync façade over the active database's trust file, resolved
    /// through the process-global [`TrustRuntime`] on every call. When no
    /// database is active every verify/persist fails closed with an error
    /// and [`Self::global_policy`] reports `Strict`.
    pub fn shared() -> Self {
        Self {
            backend: StoreBackend::Shared,
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
        self.backend.with_data(|data| {
            (
                verify_identity_in_data(data, host, record_type, identity),
                true,
            )
        })
    }

    /// The current global trust policy (re-read from disk). The verifier uses
    /// this when no per-connection override is supplied. Defaults to TOFU when
    /// the store is empty/absent (matches `TrustPolicy::default()`); any
    /// failure (corrupt file, locked encryption, no active database) reports
    /// `Strict` so callers fail closed.
    pub fn global_policy(&self) -> TrustPolicy {
        self.backend
            .load()
            .map(|data| data.policy)
            .unwrap_or(TrustPolicy::Strict)
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
        self.backend.with_data(|data| {
            trust_identity_in_data(
                data,
                host,
                record_type,
                identity,
                user_approved,
                IdentityChangeReason::Initial,
                None,
                None,
            );
            ((), true)
        })
    }
}

// ---------------------------------------------------------------------------
// Per-database trust runtime (t62)
// ---------------------------------------------------------------------------
//
// One process-global `TrustRuntime` is installed at startup. It knows the
// `databases/` directory, the (optional) `EncryptionState`, and which user
// database is currently active. Every trust file lives beside its database:
//
//   databases/<id>.json            connections (existing)
//   databases/<id>.trust.json      trust records for that database
//   databases/<id>.trust.json.bak  previous generation (SDBF ladder)
//
// Encryption mirrors `database_files.rs`: when the master DEK is unlocked at
// activation time the `ArtifactKind::TrustStore` sub-key is derived ONCE
// (async) and cached, so the synchronous verifiers can encrypt/decrypt with
// no `block_on`. Not configured → plaintext SDBF; configured-but-locked →
// fail closed. No active database → every read/write fails closed.

/// Prefix the frontend uses for connection-scoped hosts
/// (`@sorng/connection/v1/<connectionId>/<host>`).
pub const CONNECTION_SCOPE_PREFIX: &str = "@sorng/connection/v1/";
const LEGACY_TRUST_FILE: &str = "trust_store.json";
const LEGACY_RDP_TRUST_FILE: &str = "rdp-cert-trust.json";
pub const TRUST_EXPORT_VERSION: u32 = 1;

struct ActiveDb {
    id: String,
    sub_key: Option<SubKey>,
}

/// Process-global per-database trust runtime. See the module comment above.
pub struct TrustRuntime {
    databases_dir: PathBuf,
    app_dir: PathBuf,
    enc_state: Option<Arc<EncryptionState>>,
    active: RwLock<Option<ActiveDb>>,
    /// Serialises every read-modify-write across the async service and the
    /// synchronous verifiers (they share the file, not the memory).
    io: std::sync::Mutex<()>,
}

static RUNTIME: OnceLock<RwLock<Option<Arc<TrustRuntime>>>> = OnceLock::new();

fn runtime_slot() -> &'static RwLock<Option<Arc<TrustRuntime>>> {
    RUNTIME.get_or_init(|| RwLock::new(None))
}

/// Install (or replace) the process-global runtime. Called once at startup
/// with `<app_data>/databases` and the app's `EncryptionState`; tests call
/// it with a temp dir (see [`test_support`]).
pub fn install_runtime(
    databases_dir: PathBuf,
    enc_state: Option<Arc<EncryptionState>>,
) -> Arc<TrustRuntime> {
    let app_dir = databases_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| databases_dir.clone());
    let rt = Arc::new(TrustRuntime {
        databases_dir,
        app_dir,
        enc_state,
        active: RwLock::new(None),
        io: std::sync::Mutex::new(()),
    });
    match runtime_slot().write() {
        Ok(mut slot) => *slot = Some(rt.clone()),
        Err(poisoned) => *poisoned.into_inner() = Some(rt.clone()),
    }
    rt
}

/// The installed runtime, or an error when startup has not installed one.
pub fn runtime() -> Result<Arc<TrustRuntime>, String> {
    runtime_slot()
        .read()
        .map_err(|_| "trust runtime lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "trust runtime is not installed".to_string())
}

/// Snapshot of the active trust database, returned by
/// `trust_set_active_database` / `trust_get_active_database`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTrustDatabase {
    /// `None` when no database is active (locked / closed).
    pub database_id: Option<String>,
    /// Whether the trust file is written as a P4 envelope.
    pub encrypted: bool,
    pub record_count: u64,
    /// Records copied from the legacy sidecars during this activation.
    pub seeded_records: u64,
}

/// Portable export of one database's trust store (D6). PEM/public data
/// only — trust records carry no secrets.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrustExportDocument {
    pub version: u32,
    pub records: Vec<TrustRecord>,
    #[serde(default)]
    pub policy: TrustPolicy,
    #[serde(default)]
    pub policy_config: TrustPolicyConfig,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TrustImportMode {
    /// Keep existing records on the same `type:host` unless the imported
    /// one was seen more recently; never let an unrevoked import overwrite
    /// a revoked record; policy untouched.
    Merge,
    /// Drop everything and take the document verbatim (records + policy).
    Replace,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrustImportOutcome {
    pub imported: u64,
    pub skipped: u64,
}

/// Result of `trust_legacy_status`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrustLegacyStatus {
    pub legacy_present: bool,
    pub legacy_records: u64,
    pub rdp_legacy_present: bool,
    pub rdp_legacy_records: u64,
    /// Every `databases/<id>.json` has a `<id>.trust.json` beside it, i.e.
    /// every database has been opened at least once since the migration
    /// shipped, so deleting the legacy sidecars cannot lose anything.
    pub all_databases_opened: bool,
}

/// Local mirror of `sorng-rdp`'s `CertTrustEntry` (camelCase JSON in
/// `rdp-cert-trust.json`). Defined here so the migration reader does not
/// depend on the RDP crate.
#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
struct RdpLegacyEntry {
    host: String,
    port: u16,
    fingerprint: String,
    subject: String,
    issuer: String,
    valid_from: String,
    valid_to: String,
    serial: String,
    signature_algorithm: String,
    san: Vec<String>,
    pem: String,
    first_seen: String,
    last_seen: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RdpLegacyDocument {
    entries: HashMap<String, RdpLegacyEntry>,
}

fn validate_database_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 256
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || id.contains('\0')
    {
        return Err(format!("invalid database id: {id:?}"));
    }
    Ok(())
}

fn identity_last_seen(identity: &Identity) -> &str {
    match identity {
        Identity::Tls(c) => &c.last_seen,
        Identity::Ssh(s) => &s.last_seen,
    }
}

fn refuse_symlink(path: &Path) -> Result<(), String> {
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "trust store {} must be a regular non-symlink file",
                path.display()
            ));
        }
    }
    Ok(())
}

fn migrated_history_entry(record: &TrustRecord, note: &str) -> IdentityHistoryEntry {
    IdentityHistoryEntry {
        identity: record.identity.clone(),
        changed_at: Utc::now().to_rfc3339(),
        reason: IdentityChangeReason::Migrated,
        approved_by: Some("system".to_string()),
        note: Some(note.to_string()),
        verification_count: record.stats.total_checks,
        trust_score: record.stats.trust_score,
    }
}

impl TrustRuntime {
    pub fn databases_dir(&self) -> &Path {
        &self.databases_dir
    }

    /// `databases/<id>.trust.json` for a validated id.
    pub fn trust_file_path(&self, database_id: &str) -> Result<PathBuf, String> {
        validate_database_id(database_id)?;
        Ok(self.databases_dir.join(format!("{database_id}.trust.json")))
    }

    fn legacy_path(&self) -> PathBuf {
        self.app_dir.join(LEGACY_TRUST_FILE)
    }

    fn legacy_rdp_path(&self) -> PathBuf {
        self.app_dir.join(LEGACY_RDP_TRUST_FILE)
    }

    fn io_guard(&self) -> Result<std::sync::MutexGuard<'_, ()>, String> {
        self.io
            .lock()
            .map_err(|_| "trust runtime io lock poisoned".to_string())
    }

    /// Set (or clear, with `None`) the active database and its cached
    /// sub-key. Low-level; the command path uses [`Self::activate_database`]
    /// which also derives the sub-key and runs the legacy seed.
    pub fn set_active(
        &self,
        database_id: Option<String>,
        sub_key: Option<SubKey>,
    ) -> Result<(), String> {
        let next = match database_id {
            Some(id) => {
                validate_database_id(&id)?;
                Some(ActiveDb { id, sub_key })
            }
            None => None,
        };
        let mut guard = self
            .active
            .write()
            .map_err(|_| "trust runtime active lock poisoned".to_string())?;
        *guard = next;
        Ok(())
    }

    /// Id of the active database, if any.
    pub fn active_database_id(&self) -> Option<String> {
        self.active
            .read()
            .ok()
            .and_then(|guard| guard.as_ref().map(|db| db.id.clone()))
    }

    fn active_is_encrypted(&self) -> bool {
        self.active
            .read()
            .ok()
            .and_then(|guard| guard.as_ref().map(|db| db.sub_key.is_some()))
            .unwrap_or(false)
    }

    /// Derive the `TrustStore` sub-key from the runtime's encryption state
    /// (when installed and unlocked), make `database_id` active, seed it
    /// from the legacy sidecars on first activation (D5), and report the
    /// resulting state. `None` deactivates (lock / close) — verifiers then
    /// fail closed.
    pub async fn activate_database(
        &self,
        database_id: Option<String>,
        connection_ids: &[String],
    ) -> Result<ActiveTrustDatabase, String> {
        let Some(id) = database_id else {
            self.set_active(None, None)?;
            return Ok(ActiveTrustDatabase {
                database_id: None,
                encrypted: false,
                record_count: 0,
                seeded_records: 0,
            });
        };
        validate_database_id(&id)?;
        let sub_key = match &self.enc_state {
            Some(state) => state.sub_key(ArtifactKind::TrustStore).await,
            None => None,
        };
        self.set_active(Some(id.clone()), sub_key)?;
        let _io = self.io_guard()?;
        let seeded = self.seed_from_legacy(&id, connection_ids)?;
        let data = self.load_active()?;
        Ok(ActiveTrustDatabase {
            database_id: Some(id),
            encrypted: self.active_is_encrypted(),
            record_count: data.records.len() as u64,
            seeded_records: seeded,
        })
    }

    /// Re-derive the cached sub-key for the active database, e.g. after an
    /// unlock or a master-key rotation. No-op when nothing is active.
    pub async fn refresh_sub_key(&self) -> Result<(), String> {
        let Some(id) = self.active_database_id() else {
            return Ok(());
        };
        let sub_key = match &self.enc_state {
            Some(state) => state.sub_key(ArtifactKind::TrustStore).await,
            None => None,
        };
        self.set_active(Some(id), sub_key)
    }

    /// Current activation snapshot (never seeds, never errors on "no active
    /// database" — that is reported as `database_id: None`).
    pub fn active_info(&self) -> Result<ActiveTrustDatabase, String> {
        let Some(id) = self.active_database_id() else {
            return Ok(ActiveTrustDatabase {
                database_id: None,
                encrypted: false,
                record_count: 0,
                seeded_records: 0,
            });
        };
        let _io = self.io_guard()?;
        let data = self.load_active()?;
        Ok(ActiveTrustDatabase {
            database_id: Some(id),
            encrypted: self.active_is_encrypted(),
            record_count: data.records.len() as u64,
            seeded_records: 0,
        })
    }

    // -- file layer --------------------------------------------------------

    /// Is master encryption configured on disk even though no sub-key is
    /// cached? Mirrors the durable markers `database_files.rs` consults
    /// plus "any generation of this trust file is already an envelope".
    fn encryption_configured_for(&self, canonical: &Path) -> bool {
        for marker in ["dek.enc", "settings.enc"] {
            if self.app_dir.join(marker).exists() {
                return true;
            }
        }
        let candidates = [
            canonical.to_path_buf(),
            sdbf::sibling(canonical, "bak"),
            canonical.with_extension("json.v0.bak"),
        ];
        candidates.iter().any(|path| {
            std::fs::read(path)
                .ok()
                .and_then(|bytes| sdbf::parse_and_verify(&bytes).ok().map(is_envelope_blob))
                .unwrap_or(false)
        })
    }

    /// Read + validate one trust file under the SDBF ladder, decrypting
    /// with the cached sub-key when the payload is an envelope. A missing
    /// file is an empty store; a corrupt/oversized/symlinked one or an
    /// envelope without a key is an error (fail closed).
    fn read_file(&self, canonical: &Path) -> Result<TrustStoreData, String> {
        refuse_symlink(canonical)?;
        let Some((payload, _source)) = sdbf::safe_read_raw(canonical).map_err(|e| e.to_string())?
        else {
            return Ok(TrustStoreData::default());
        };
        let plain = if is_envelope_blob(&payload) {
            let guard = self
                .active
                .read()
                .map_err(|_| "trust runtime active lock poisoned".to_string())?;
            let key = guard
                .as_ref()
                .and_then(|db| db.sub_key.as_ref())
                .ok_or_else(|| {
                    "trust store is encrypted; unlock first via Settings → Security".to_string()
                })?;
            decrypt_with_subkey(key, &payload)?
        } else {
            payload
        };
        if plain.len() as u64 > MAX_TRUST_STORE_BYTES {
            return Err(format!(
                "trust store {} exceeds the {} byte limit",
                canonical.display(),
                MAX_TRUST_STORE_BYTES
            ));
        }
        let data: TrustStoreData = serde_json::from_slice(&plain)
            .map_err(|error| format!("parse trust store {}: {error}", canonical.display()))?;
        validate_trust_store_data(&data)?;
        Ok(data)
    }

    /// Validate + serialise + (encrypt) + `safe_write`. Without a cached
    /// sub-key the write is plaintext only when master encryption is not
    /// configured; otherwise it fails closed (no plaintext downgrade).
    fn write_file(&self, canonical: &Path, data: &TrustStoreData) -> Result<(), String> {
        refuse_symlink(canonical)?;
        validate_trust_store_data(data)?;
        let plain =
            serde_json::to_vec(data).map_err(|error| format!("serialize trust store: {error}"))?;
        if plain.len() as u64 > MAX_TRUST_STORE_BYTES {
            return Err("serialized trust store exceeds the size limit".to_string());
        }
        let payload = {
            let guard = self
                .active
                .read()
                .map_err(|_| "trust runtime active lock poisoned".to_string())?;
            match guard.as_ref().and_then(|db| db.sub_key.as_ref()) {
                Some(key) => encrypt_with_subkey(key, &plain)?,
                None => {
                    if self.encryption_configured_for(canonical) {
                        return Err(
                            "trust store is encrypted; unlock first via Settings → Security"
                                .to_string(),
                        );
                    }
                    plain
                }
            }
        };
        sdbf::safe_write(canonical, &payload).map_err(|e| e.to_string())
    }

    fn active_path(&self) -> Result<PathBuf, String> {
        let id = self.active_database_id().ok_or_else(|| {
            "no active trust database; open or unlock a database first".to_string()
        })?;
        self.trust_file_path(&id)
    }

    /// Load the active database's records. Callers hold the io guard.
    fn load_active(&self) -> Result<TrustStoreData, String> {
        let path = self.active_path()?;
        self.read_file(&path)
    }

    /// Persist the active database's records. Callers hold the io guard.
    fn persist_active(&self, data: &TrustStoreData) -> Result<(), String> {
        let path = self.active_path()?;
        self.write_file(&path, data)
    }

    fn resolve_db(&self, database_id: Option<&str>) -> Result<PathBuf, String> {
        match database_id {
            Some(id) => self.trust_file_path(id),
            None => self.active_path(),
        }
    }

    // -- portability ---------------------------------------------------------

    /// Export a database's trust store (`None` = active). Any database's
    /// file can be read because the sub-key is per artifact kind, not per
    /// database.
    pub fn export(&self, database_id: Option<&str>) -> Result<TrustExportDocument, String> {
        let path = self.resolve_db(database_id)?;
        let _io = self.io_guard()?;
        let data = self.read_file(&path)?;
        let mut records: Vec<TrustRecord> = data.records.into_values().collect();
        records.sort_by(|a, b| (&a.record_type, &a.host).cmp(&(&b.record_type, &b.host)));
        Ok(TrustExportDocument {
            version: TRUST_EXPORT_VERSION,
            records,
            policy: data.policy,
            policy_config: data.policy_config,
        })
    }

    /// Import a document into a database's trust store (`None` = active).
    pub fn import(
        &self,
        database_id: Option<&str>,
        document: TrustExportDocument,
        mode: TrustImportMode,
    ) -> Result<TrustImportOutcome, String> {
        if document.version != TRUST_EXPORT_VERSION {
            return Err(format!(
                "unsupported trust export version {}",
                document.version
            ));
        }
        let path = self.resolve_db(database_id)?;
        let _io = self.io_guard()?;
        let mut data = match mode {
            TrustImportMode::Replace => TrustStoreData {
                policy: document.policy.clone(),
                policy_config: document.policy_config.clone(),
                records: HashMap::new(),
            },
            TrustImportMode::Merge => self.read_file(&path)?,
        };
        let outcome = merge_records_into(&mut data, document.records, mode);
        self.write_file(&path, &data)?;
        Ok(outcome)
    }

    /// Remove `<id>.trust.json` and its ladder siblings. Called from
    /// `delete_database_data`. Deleting the active database's store leaves
    /// it active with an empty store.
    pub fn delete_store(&self, database_id: &str) -> Result<(), String> {
        let canonical = self.trust_file_path(database_id)?;
        let _io = self.io_guard()?;
        for path in [
            canonical.clone(),
            sdbf::sibling(&canonical, "bak"),
            sdbf::sibling(&canonical, "tmp"),
        ] {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("remove {}: {error}", path.display())),
            }
        }
        Ok(())
    }

    // -- legacy sidecars (D5) --------------------------------------------

    fn read_legacy_rdp(&self) -> Result<RdpLegacyDocument, String> {
        let path = self.legacy_rdp_path();
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(RdpLegacyDocument::default())
            }
            Err(e) => return Err(format!("read {}: {e}", path.display())),
        };
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() > MAX_TRUST_STORE_BYTES
        {
            return Err(format!(
                "legacy RDP trust file {} is not a bounded regular file",
                path.display()
            ));
        }
        let raw = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
        if raw.iter().all(u8::is_ascii_whitespace) {
            return Ok(RdpLegacyDocument::default());
        }
        serde_json::from_slice(&raw).map_err(|e| format!("parse {}: {e}", path.display()))
    }

    /// Seed `<id>.trust.json` from the legacy sidecars when it does not
    /// exist yet. Global records and per-connection records whose
    /// connection id is in `connection_ids` are copied with a `Migrated`
    /// history entry; RDP entries become `rdp` records unless the Trust
    /// Center already has one for that `host:port`. The legacy files are
    /// never modified. Returns the number of seeded records. Caller holds
    /// the io guard.
    fn seed_from_legacy(
        &self,
        database_id: &str,
        connection_ids: &[String],
    ) -> Result<u64, String> {
        let canonical = self.trust_file_path(database_id)?;
        if canonical.exists()
            || sdbf::sibling(&canonical, "bak").exists()
            || sdbf::safe_read_raw(&canonical)
                .map_err(|e| e.to_string())?
                .is_some()
        {
            return Ok(0);
        }
        let legacy_path = self.legacy_path();
        let legacy = if legacy_path.exists() {
            Some(load_trust_store_data(&legacy_path)?)
        } else {
            None
        };
        let rdp = self.read_legacy_rdp()?;
        if legacy.is_none() && rdp.entries.is_empty() {
            return Ok(0);
        }

        let mut data = TrustStoreData::default();
        if let Some(legacy) = legacy {
            data.policy = legacy.policy;
            data.policy_config = legacy.policy_config;
            for (key, mut record) in legacy.records {
                let scoped = record.host.strip_prefix(CONNECTION_SCOPE_PREFIX);
                let keep = match scoped {
                    None => true,
                    Some(rest) => rest
                        .split('/')
                        .next()
                        .is_some_and(|conn| connection_ids.iter().any(|id| id == conn)),
                };
                if !keep {
                    continue;
                }
                if record.history.len() < MAX_HISTORY_ENTRIES {
                    record.history.push(migrated_history_entry(
                        &record,
                        "migrated from legacy trust_store.json",
                    ));
                }
                data.records.insert(key, record);
            }
        }
        for (_key, entry) in rdp.entries {
            if entry.host.is_empty() || entry.fingerprint.is_empty() {
                continue;
            }
            let host = format!("{}:{}", entry.host, entry.port);
            let key = TrustStoreService::record_key("rdp", &host);
            if data.records.contains_key(&key) {
                continue;
            }
            let now = Utc::now().to_rfc3339();
            let non_empty = |s: String| if s.is_empty() { None } else { Some(s) };
            let identity = Identity::Tls(Box::new(CertIdentity {
                fingerprint: entry.fingerprint.trim().to_ascii_lowercase(),
                subject: non_empty(entry.subject),
                issuer: non_empty(entry.issuer),
                first_seen: if entry.first_seen.is_empty() {
                    now.clone()
                } else {
                    entry.first_seen
                },
                last_seen: if entry.last_seen.is_empty() {
                    now.clone()
                } else {
                    entry.last_seen
                },
                valid_from: non_empty(entry.valid_from),
                valid_to: non_empty(entry.valid_to),
                pem: non_empty(entry.pem),
                serial: non_empty(entry.serial),
                signature_algorithm: non_empty(entry.signature_algorithm),
                san: if entry.san.is_empty() {
                    None
                } else {
                    Some(entry.san)
                },
                chain_fingerprints: vec![],
                subject_cn: None,
                subject_org: None,
                subject_ou: None,
                subject_country: None,
                subject_state: None,
                subject_locality: None,
                subject_email: None,
                issuer_cn: None,
                issuer_org: None,
                issuer_country: None,
                key_algorithm: None,
                key_size: None,
                version: None,
                chain: None,
            }));
            let mut record = TrustRecord {
                host,
                record_type: "rdp".to_string(),
                identity,
                user_approved: true,
                nickname: None,
                history: vec![],
                host_policy: None,
                host_policy_config: None,
                stats: VerificationStats::default(),
                first_trusted: Some(now),
                trust_expires: None,
                revoked: false,
                tags: vec![],
            };
            record.history.push(migrated_history_entry(
                &record,
                "migrated from legacy rdp-cert-trust.json",
            ));
            data.records.insert(key, record);
        }
        let seeded = data.records.len() as u64;
        self.write_file(&canonical, &data)?;
        Ok(seeded)
    }

    /// Report the legacy sidecars and whether every database has a trust
    /// file (so the UI can offer "Delete legacy trust files").
    pub fn legacy_status(&self) -> Result<TrustLegacyStatus, String> {
        let legacy_path = self.legacy_path();
        let legacy_present = legacy_path.exists();
        let legacy_records = if legacy_present {
            load_trust_store_data(&legacy_path)
                .map(|d| d.records.len() as u64)
                .unwrap_or(0)
        } else {
            0
        };
        let rdp_present = self.legacy_rdp_path().exists();
        let rdp_records = if rdp_present {
            self.read_legacy_rdp()
                .map(|d| d.entries.len() as u64)
                .unwrap_or(0)
        } else {
            0
        };
        let mut all_opened = true;
        if let Ok(entries) = std::fs::read_dir(&self.databases_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name == "index.json" || !name.ends_with(".json") || name.ends_with(".trust.json")
                {
                    continue;
                }
                let id = &name[..name.len() - ".json".len()];
                if !self.databases_dir.join(format!("{id}.trust.json")).exists() {
                    all_opened = false;
                    break;
                }
            }
        }
        Ok(TrustLegacyStatus {
            legacy_present,
            legacy_records,
            rdp_legacy_present: rdp_present,
            rdp_legacy_records: rdp_records,
            all_databases_opened: all_opened,
        })
    }

    /// Delete both legacy sidecars (and any `.bak`). Returns how many files
    /// were removed. The caller (UI) gates this on `all_databases_opened`.
    pub fn delete_legacy_stores(&self) -> Result<u32, String> {
        let mut removed = 0u32;
        for base in [self.legacy_path(), self.legacy_rdp_path()] {
            for path in [base.clone(), sdbf::sibling(&base, "bak")] {
                match std::fs::remove_file(&path) {
                    Ok(()) => removed += 1,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(format!("remove {}: {e}", path.display())),
                }
            }
        }
        Ok(removed)
    }
}

/// Merge `incoming` into `data` under the D6 rules. Records are re-keyed
/// from their own `record_type`/`host` so a tampered key cannot alias
/// another host.
fn merge_records_into(
    data: &mut TrustStoreData,
    incoming: Vec<TrustRecord>,
    mode: TrustImportMode,
) -> TrustImportOutcome {
    let mut imported = 0u64;
    let mut skipped = 0u64;
    for record in incoming {
        let key = TrustStoreService::record_key(&record.record_type, &record.host);
        let take = match (mode, data.records.get(&key)) {
            (TrustImportMode::Replace, _) | (TrustImportMode::Merge, None) => true,
            (TrustImportMode::Merge, Some(existing)) => {
                if existing.revoked && !record.revoked {
                    false
                } else {
                    identity_last_seen(&record.identity) > identity_last_seen(&existing.identity)
                }
            }
        };
        if take {
            data.records.insert(key, record);
            imported += 1;
        } else {
            skipped += 1;
        }
    }
    TrustImportOutcome { imported, skipped }
}

/// Helpers for tests in this and downstream crates: install a runtime over
/// a caller-owned temp directory while holding a process-wide test mutex so
/// parallel tests never observe each other's runtime.
pub mod test_support {
    use super::*;

    static TEST_MUTEX: OnceLock<std::sync::Mutex<()>> = OnceLock::new();

    /// Holds the test mutex and the installed runtime; dropping it
    /// deactivates the database.
    pub struct RuntimeTestGuard {
        pub runtime: Arc<TrustRuntime>,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl Drop for RuntimeTestGuard {
        fn drop(&mut self) {
            let _ = self.runtime.set_active(None, None);
        }
    }

    /// Install a runtime whose `databases/` dir is `databases_dir`
    /// (created if missing). Pass an unlocked `EncryptionState` to get
    /// envelope encryption, `None` for plaintext mode.
    pub fn install_runtime_for_tests(
        databases_dir: PathBuf,
        enc_state: Option<Arc<EncryptionState>>,
    ) -> RuntimeTestGuard {
        let lock = TEST_MUTEX
            .get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = std::fs::create_dir_all(&databases_dir);
        let runtime = install_runtime(databases_dir, enc_state);
        RuntimeTestGuard {
            runtime,
            _lock: lock,
        }
    }

    /// Install a plaintext runtime and activate `database_id` with no
    /// connection ids. The common one-liner for verifier tests.
    pub fn install_active_runtime_for_tests(
        databases_dir: PathBuf,
        database_id: &str,
    ) -> RuntimeTestGuard {
        let guard = install_runtime_for_tests(databases_dir, None);
        guard
            .runtime
            .set_active(Some(database_id.to_string()), None)
            .expect("activate test database");
        guard
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

#[cfg(test)]
mod runtime_tests {
    use super::test_support::*;
    use super::*;
    use sorng_encryption::MasterDek;
    use tempfile::tempdir;

    fn tls_identity(fp: &str) -> Identity {
        let now = Utc::now().to_rfc3339();
        Identity::Tls(Box::new(CertIdentity {
            fingerprint: fp.to_string(),
            subject: None,
            issuer: None,
            first_seen: now.clone(),
            last_seen: now,
            valid_from: None,
            valid_to: None,
            pem: None,
            serial: None,
            signature_algorithm: None,
            san: None,
            chain_fingerprints: vec![],
            subject_cn: None,
            subject_org: None,
            subject_ou: None,
            subject_country: None,
            subject_state: None,
            subject_locality: None,
            subject_email: None,
            issuer_cn: None,
            issuer_org: None,
            issuer_country: None,
            key_algorithm: None,
            key_size: None,
            version: None,
            chain: None,
        }))
    }

    async fn unlocked_state() -> Arc<EncryptionState> {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        Arc::new(state)
    }

    #[test]
    fn per_database_isolation_and_bak_recovery() {
        let dir = tempdir().unwrap();
        let guard = install_active_runtime_for_tests(dir.path().join("databases"), "db-a");
        let store = SyncTrustStore::shared();
        store
            .trust_identity_blocking("h:443".into(), "tls".into(), tls_identity("aa"), false)
            .unwrap();
        let path = dir.path().join("databases").join("db-a.trust.json");
        assert!(path.exists());
        assert!(matches!(
            store.verify_identity_blocking("h:443", "tls", tls_identity("aa")),
            Ok(TrustVerifyResult::Trusted)
        ));

        // Switch to db-b: record invisible.
        guard.runtime.set_active(Some("db-b".into()), None).unwrap();
        assert!(matches!(
            store.verify_identity_blocking("h:443", "tls", tls_identity("aa")),
            Ok(TrustVerifyResult::FirstUse { .. })
        ));

        // Back to db-a with a corrupted canonical: ladder recovers from .bak.
        guard.runtime.set_active(Some("db-a".into()), None).unwrap();
        assert!(sdbf::sibling(&path, "bak").exists());
        std::fs::write(&path, b"garbage").unwrap();
        assert!(matches!(
            store.verify_identity_blocking("h:443", "tls", tls_identity("aa")),
            Ok(TrustVerifyResult::Trusted)
        ));
    }

    #[tokio::test]
    async fn encrypted_round_trip_and_locked_fails_closed() {
        let dir = tempdir().unwrap();
        let state = unlocked_state().await;
        let guard = install_runtime_for_tests(dir.path().join("databases"), Some(state.clone()));
        let info = guard
            .runtime
            .activate_database(Some("enc".into()), &[])
            .await
            .unwrap();
        assert!(info.encrypted);
        let store = SyncTrustStore::shared();
        store
            .trust_identity_blocking("h:1".into(), "tls".into(), tls_identity("aa"), true)
            .unwrap();
        let path = dir.path().join("databases").join("enc.trust.json");
        let bytes = std::fs::read(&path).unwrap();
        let payload = sdbf::parse_and_verify(&bytes).unwrap();
        assert!(is_envelope_blob(payload), "trust file must be an envelope");

        // Async service sees the sync write, and vice versa.
        let svc = TrustStoreService::shared();
        {
            let mut svc = svc.lock().await;
            svc.reload_from_disk().unwrap();
            assert_eq!(svc.get_all_trust_records().await.len(), 1);
            svc.set_trust_policy(TrustPolicy::Strict).await.unwrap();
        }
        assert_eq!(store.global_policy(), TrustPolicy::Strict);

        // Lock, refresh the cached key: reads and writes fail closed.
        state.lock().await;
        guard.runtime.refresh_sub_key().await.unwrap();
        let err = store
            .verify_identity_blocking("h:1", "tls", tls_identity("aa"))
            .unwrap_err();
        assert!(err.contains("encrypted"), "{err}");
        assert!(store
            .trust_identity_blocking("x:2".into(), "tls".into(), tls_identity("bb"), true)
            .is_err());
        assert_eq!(store.global_policy(), TrustPolicy::Strict);
        assert!(guard.runtime.active_info().is_err());
    }

    #[tokio::test]
    async fn plaintext_mode_when_encryption_not_configured() {
        let dir = tempdir().unwrap();
        let locked = Arc::new(EncryptionState::new());
        let guard = install_runtime_for_tests(dir.path().join("databases"), Some(locked));
        let info = guard
            .runtime
            .activate_database(Some("plain".into()), &[])
            .await
            .unwrap();
        assert!(!info.encrypted);
        SyncTrustStore::shared()
            .trust_identity_blocking("h:1".into(), "tls".into(), tls_identity("aa"), true)
            .unwrap();
        let bytes = std::fs::read(dir.path().join("databases").join("plain.trust.json")).unwrap();
        assert!(sdbf::parse_and_verify(&bytes).unwrap().starts_with(b"{"));
        assert_eq!(guard.runtime.active_info().unwrap().record_count, 1);
    }

    #[test]
    fn no_active_database_fails_closed() {
        let dir = tempdir().unwrap();
        let _guard = install_runtime_for_tests(dir.path().join("databases"), None);
        let store = SyncTrustStore::shared();
        let err = store
            .verify_identity_blocking("h:1", "tls", tls_identity("aa"))
            .unwrap_err();
        assert!(err.contains("no active"), "{err}");
        assert!(store
            .trust_identity_blocking("h:1".into(), "tls".into(), tls_identity("aa"), true)
            .is_err());
        assert_eq!(store.global_policy(), TrustPolicy::Strict);
        let rt = runtime().unwrap();
        assert!(rt.export(None).is_err());
        assert_eq!(rt.active_info().unwrap().database_id, None);
    }

    #[tokio::test]
    async fn legacy_seed_migrates_global_and_matching_scoped_records_only() {
        let dir = tempdir().unwrap();
        let app_dir = dir.path();
        let mut legacy = TrustStoreData {
            policy: TrustPolicy::TofuWithExpiry,
            ..Default::default()
        };
        for host in [
            "global.example:443",
            "@sorng/connection/v1/conn-yes/h:443",
            "@sorng/connection/v1/conn-no/h:443",
        ] {
            trust_identity_in_data(
                &mut legacy,
                host.to_string(),
                "https".to_string(),
                tls_identity("aa"),
                true,
                IdentityChangeReason::Initial,
                None,
                None,
            );
        }
        let legacy_path = app_dir.join("trust_store.json");
        persist_trust_store_data(&legacy_path, &legacy).unwrap();
        let legacy_bytes = std::fs::read(&legacy_path).unwrap();
        let rdp_path = app_dir.join("rdp-cert-trust.json");
        let rdp_doc = serde_json::json!({"entries": {"rdp.example:3389": {
            "host": "rdp.example", "port": 3389, "fingerprint": "AB:CD",
            "subject": "CN=rdp", "issuer": "CN=ca", "validFrom": "", "validTo": "",
            "serial": "1", "signatureAlgorithm": "sha256", "san": ["rdp.example"],
            "pem": "-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----",
            "firstSeen": "2026-01-01T00:00:00Z", "lastSeen": "2026-01-02T00:00:00Z",
            "lastApprovedAt": "2026-01-02T00:00:00Z"}}});
        std::fs::write(&rdp_path, rdp_doc.to_string()).unwrap();
        let rdp_bytes = std::fs::read(&rdp_path).unwrap();

        let guard = install_runtime_for_tests(app_dir.join("databases"), None);
        let rt = guard.runtime.clone();
        let status = rt.legacy_status().unwrap();
        assert!(status.legacy_present && status.rdp_legacy_present);
        assert_eq!((status.legacy_records, status.rdp_legacy_records), (3, 1));

        let info = rt
            .activate_database(Some("db1".into()), &["conn-yes".to_string()])
            .await
            .unwrap();
        assert_eq!(info.seeded_records, 3);
        assert_eq!(info.record_count, 3);
        let doc = rt.export(None).unwrap();
        let hosts: Vec<&str> = doc.records.iter().map(|r| r.host.as_str()).collect();
        assert!(hosts.contains(&"global.example:443"));
        assert!(hosts.contains(&"@sorng/connection/v1/conn-yes/h:443"));
        assert!(!hosts.contains(&"@sorng/connection/v1/conn-no/h:443"));
        assert!(hosts.contains(&"rdp.example:3389"));
        assert_eq!(doc.policy, TrustPolicy::TofuWithExpiry);
        for record in &doc.records {
            assert_eq!(
                record.history.last().unwrap().reason,
                IdentityChangeReason::Migrated
            );
        }
        let rdp = doc.records.iter().find(|r| r.record_type == "rdp").unwrap();
        assert!(rdp.user_approved);
        match &rdp.identity {
            Identity::Tls(c) => assert_eq!(c.fingerprint, "ab:cd"),
            _ => panic!("rdp record must carry a TLS identity"),
        }

        // Legacy untouched; seeding is idempotent.
        assert_eq!(std::fs::read(&legacy_path).unwrap(), legacy_bytes);
        assert_eq!(std::fs::read(&rdp_path).unwrap(), rdp_bytes);
        let again = rt.activate_database(Some("db1".into()), &[]).await.unwrap();
        assert_eq!(again.seeded_records, 0);
        assert_eq!(again.record_count, 3);

        // all_databases_opened tracks <id>.json vs <id>.trust.json.
        std::fs::write(app_dir.join("databases").join("db2.json"), b"x").unwrap();
        assert!(!rt.legacy_status().unwrap().all_databases_opened);
        rt.activate_database(Some("db2".into()), &[]).await.unwrap();
        assert!(rt.legacy_status().unwrap().all_databases_opened);
        assert_eq!(rt.delete_legacy_stores().unwrap(), 2);
        assert!(!legacy_path.exists() && !rdp_path.exists());
    }

    #[tokio::test]
    async fn export_import_merge_replace_and_delete() {
        let dir = tempdir().unwrap();
        let guard = install_active_runtime_for_tests(dir.path().join("databases"), "src");
        let rt = guard.runtime.clone();
        let store = SyncTrustStore::shared();
        store
            .trust_identity_blocking("a:1".into(), "tls".into(), tls_identity("aa"), true)
            .unwrap();
        store
            .trust_identity_blocking("b:1".into(), "tls".into(), tls_identity("bb"), true)
            .unwrap();
        let doc = rt.export(Some("src")).unwrap();
        assert_eq!(doc.version, TRUST_EXPORT_VERSION);
        assert_eq!(doc.records.len(), 2);
        let json = serde_json::to_value(&doc).unwrap();
        assert!(json.get("policyConfig").is_some());

        let out = rt
            .import(Some("dst"), doc.clone(), TrustImportMode::Merge)
            .unwrap();
        assert_eq!(
            out,
            TrustImportOutcome {
                imported: 2,
                skipped: 0
            }
        );

        // Revoke b in dst; re-importing the same document skips both
        // (b: revoked wins; a: not newer).
        rt.set_active(Some("dst".into()), None).unwrap();
        {
            let svc = TrustStoreService::shared();
            let mut svc = svc.lock().await;
            svc.reload_from_disk().unwrap();
            svc.revoke_identity("b:1", "tls").await.unwrap();
        }
        let out = rt
            .import(None, doc.clone(), TrustImportMode::Merge)
            .unwrap();
        assert_eq!(
            out,
            TrustImportOutcome {
                imported: 0,
                skipped: 2
            }
        );
        assert!(rt.export(None).unwrap().records.iter().any(|r| r.revoked));

        let out = rt.import(None, doc, TrustImportMode::Replace).unwrap();
        assert_eq!(out.imported, 2);
        assert!(!rt.export(None).unwrap().records.iter().any(|r| r.revoked));

        let path = dir.path().join("databases").join("dst.trust.json");
        assert!(path.exists() && sdbf::sibling(&path, "bak").exists());
        rt.delete_store("dst").unwrap();
        assert!(!path.exists() && !sdbf::sibling(&path, "bak").exists());
        assert!(rt.delete_store("../evil").is_err());
    }
}
