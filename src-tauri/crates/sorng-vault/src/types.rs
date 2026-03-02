//! Shared types for the vault crate.

use serde::{Deserialize, Serialize};
use std::fmt;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Secret entry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A named secret stored in the OS vault.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    /// Logical service/application name  (e.g. `"sortofremoteng"`).
    pub service: String,
    /// Account / key name inside the service  (e.g. `"master-key"`).
    pub account: String,
    /// The secret value (plaintext).
    pub secret: String,
    /// Optional human label.
    pub label: Option<String>,
    /// When this entry was created (RFC-3339).
    pub created_at: Option<String>,
    /// When this entry was last updated (RFC-3339).
    pub updated_at: Option<String>,
}

/// Summary returned when listing vault entries (no secret exposed).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntrySummary {
    pub service: String,
    pub account: String,
    pub label: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Vault status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// High-level vault status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    /// Is the OS vault backend available?
    pub available: bool,
    /// Backend name.
    pub backend: String,
    /// Number of sortofremoteng entries currently stored.
    pub entry_count: usize,
    /// Is biometric gating enabled?
    pub biometric_enabled: bool,
    /// Human message.
    pub message: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Envelope metadata
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Metadata stored alongside an envelope-encrypted blob.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeMeta {
    /// Version of the envelope format.
    pub version: u32,
    /// KDF algorithm (e.g. `"argon2id"`).
    pub kdf: String,
    /// Argon2 memory cost in KiB.
    pub kdf_memory_kib: u32,
    /// Argon2 time cost (iterations).
    pub kdf_time_cost: u32,
    /// Argon2 parallelism.
    pub kdf_parallelism: u32,
    /// Base64-encoded salt (16 bytes).
    pub salt_b64: String,
    /// Base64-encoded nonce (12 bytes for AES-256-GCM).
    pub nonce_b64: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Error
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultErrorKind {
    /// The underlying OS keychain / credential manager is not available.
    BackendUnavailable,
    /// Entry not found.
    NotFound,
    /// Access denied (e.g. biometric fail, wrong password).
    AccessDenied,
    /// Encryption or decryption failure.
    CryptoError,
    /// KDF / key-derivation failure.
    KdfError,
    /// Serialization / deserialization error.
    SerdeError,
    /// I/O error.
    IoError,
    /// Migration error.
    MigrationError,
    /// Platform API error.
    PlatformError,
    /// Internal / unexpected error.
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultError {
    pub kind: VaultErrorKind,
    pub message: String,
    pub detail: Option<String>,
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)?;
        if let Some(d) = &self.detail {
            write!(f, " — {d}")?;
        }
        Ok(())
    }
}

impl std::error::Error for VaultError {}

impl VaultError {
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self { kind: VaultErrorKind::NotFound, message: msg.into(), detail: None }
    }
    pub fn platform(msg: impl Into<String>) -> Self {
        Self { kind: VaultErrorKind::PlatformError, message: msg.into(), detail: None }
    }
    pub fn crypto(msg: impl Into<String>) -> Self {
        Self { kind: VaultErrorKind::CryptoError, message: msg.into(), detail: None }
    }
    pub fn kdf(msg: impl Into<String>) -> Self {
        Self { kind: VaultErrorKind::KdfError, message: msg.into(), detail: None }
    }
    pub fn io(msg: impl Into<String>) -> Self {
        Self { kind: VaultErrorKind::IoError, message: msg.into(), detail: None }
    }
    pub fn serde(msg: impl Into<String>) -> Self {
        Self { kind: VaultErrorKind::SerdeError, message: msg.into(), detail: None }
    }
    pub fn migration(msg: impl Into<String>) -> Self {
        Self { kind: VaultErrorKind::MigrationError, message: msg.into(), detail: None }
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self { kind: VaultErrorKind::Internal, message: msg.into(), detail: None }
    }
    pub fn access_denied(msg: impl Into<String>) -> Self {
        Self { kind: VaultErrorKind::AccessDenied, message: msg.into(), detail: None }
    }
    pub fn backend_unavailable(msg: impl Into<String>) -> Self {
        Self { kind: VaultErrorKind::BackendUnavailable, message: msg.into(), detail: None }
    }
}

pub type VaultResult<T> = Result<T, VaultError>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Default service name used for all sortofremoteng vault entries.
pub const SERVICE_NAME: &str = "com.sortofremoteng.vault";

/// Account name for the master data-encryption-key (DEK).
pub const MASTER_DEK_ACCOUNT: &str = "master-dek";

/// Account name for the storage encryption key.
pub const STORAGE_KEY_ACCOUNT: &str = "storage-encryption-key";
