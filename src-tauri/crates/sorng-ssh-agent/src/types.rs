//! # SSH Agent Types
//!
//! Core data types for the SSH agent subsystem: key representations,
//! constraints, agent configuration, events, and status.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

// ── Key Algorithm Types ─────────────────────────────────────────────

/// SSH key algorithm families supported by the agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum KeyAlgorithm {
    /// RSA (ssh-rsa, rsa-sha2-256, rsa-sha2-512)
    Rsa,
    /// Ed25519 (ssh-ed25519)
    #[default]
    Ed25519,
    /// ECDSA NIST P-256 (ecdsa-sha2-nistp256)
    EcdsaP256,
    /// ECDSA NIST P-384 (ecdsa-sha2-nistp384)
    EcdsaP384,
    /// ECDSA NIST P-521 (ecdsa-sha2-nistp521)
    EcdsaP521,
    /// SK-Ed25519 (sk-ssh-ed25519@openssh.com) — FIDO2 security key
    SkEd25519,
    /// SK-ECDSA (sk-ecdsa-sha2-nistp256@openssh.com) — FIDO2 security key
    SkEcdsaP256,
    /// DSA (ssh-dss) — legacy, disabled by default
    Dsa,
}

impl KeyAlgorithm {
    /// Return the SSH algorithm name string.
    pub fn ssh_name(&self) -> &'static str {
        match self {
            Self::Rsa => "ssh-rsa",
            Self::Ed25519 => "ssh-ed25519",
            Self::EcdsaP256 => "ecdsa-sha2-nistp256",
            Self::EcdsaP384 => "ecdsa-sha2-nistp384",
            Self::EcdsaP521 => "ecdsa-sha2-nistp521",
            Self::SkEd25519 => "sk-ssh-ed25519@openssh.com",
            Self::SkEcdsaP256 => "sk-ecdsa-sha2-nistp256@openssh.com",
            Self::Dsa => "ssh-dss",
        }
    }

    /// Human-readable display name.
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Rsa => "RSA",
            Self::Ed25519 => "Ed25519",
            Self::EcdsaP256 => "ECDSA P-256",
            Self::EcdsaP384 => "ECDSA P-384",
            Self::EcdsaP521 => "ECDSA P-521",
            Self::SkEd25519 => "SK-Ed25519 (FIDO2)",
            Self::SkEcdsaP256 => "SK-ECDSA P-256 (FIDO2)",
            Self::Dsa => "DSA (legacy)",
        }
    }

    /// Key size in bits (0 for fixed-size algorithms).
    pub fn default_bits(&self) -> u32 {
        match self {
            Self::Rsa => 4096,
            Self::Ed25519 | Self::SkEd25519 => 256,
            Self::EcdsaP256 | Self::SkEcdsaP256 => 256,
            Self::EcdsaP384 => 384,
            Self::EcdsaP521 => 521,
            Self::Dsa => 1024,
        }
    }

    /// Parse from an SSH algorithm name string.
    pub fn from_ssh_name(name: &str) -> Self {
        match name {
            "ssh-rsa" | "rsa-sha2-256" | "rsa-sha2-512" => Self::Rsa,
            "ssh-ed25519" => Self::Ed25519,
            "ecdsa-sha2-nistp256" => Self::EcdsaP256,
            "ecdsa-sha2-nistp384" => Self::EcdsaP384,
            "ecdsa-sha2-nistp521" => Self::EcdsaP521,
            "sk-ssh-ed25519@openssh.com" => Self::SkEd25519,
            "sk-ecdsa-sha2-nistp256@openssh.com" => Self::SkEcdsaP256,
            "ssh-dss" => Self::Dsa,
            _ => Self::Ed25519,
        }
    }
}

// ── Signature Hash ──────────────────────────────────────────────────

/// Hash algorithm used for RSA signatures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum RsaHashAlgorithm {
    /// SHA-1 (legacy ssh-rsa, RFC 4253)
    Sha1,
    /// SHA-256 (rsa-sha2-256, RFC 8332)
    #[default]
    Sha256,
    /// SHA-512 (rsa-sha2-512, RFC 8332)
    Sha512,
}

// ── Agent Key ───────────────────────────────────────────────────────

/// A key held by the agent (in memory, from file, or from a hardware token).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentKey {
    /// Unique key identifier.
    pub id: String,
    /// Human-readable label / comment.
    pub comment: String,
    /// Key algorithm.
    pub algorithm: KeyAlgorithm,
    /// Key size in bits.
    pub bits: u32,
    /// SHA-256 fingerprint (base64).
    pub fingerprint_sha256: String,
    /// MD5 fingerprint (hex, legacy compat).
    pub fingerprint_md5: String,
    /// The public key blob (OpenSSH wire format).
    pub public_key_blob: Vec<u8>,
    /// The public key in OpenSSH authorized_keys format.
    pub public_key_openssh: String,
    /// Where the key came from.
    pub source: KeySource,
    /// Active constraints on this key.
    pub constraints: Vec<KeyConstraint>,
    /// Certificate details (if this is an SSH certificate).
    pub certificate: Option<CertificateInfo>,
    /// When the key was added to the agent.
    pub added_at: DateTime<Utc>,
    /// Last time this key was used for signing.
    pub last_used_at: Option<DateTime<Utc>>,
    /// Total number of signing operations performed.
    pub sign_count: u64,
    /// Optional metadata.
    pub metadata: HashMap<String, String>,
}

/// Where a key came from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum KeySource {
    /// Loaded from a file on disk.
    File { path: String },
    /// Generated in memory (ephemeral).
    Generated,
    /// Loaded from the system's SSH agent.
    SystemAgent,
    /// Loaded from a PKCS#11 token / smart card.
    Pkcs11 { provider: String, slot: u32 },
    /// FIDO2 / Security Key hardware token.
    SecurityKey { device: String },
    /// Imported from another application.
    Imported,
    /// Received through agent forwarding.
    Forwarded { session_id: String },
}

// ── SSH Certificates ────────────────────────────────────────────────

/// SSH certificate details (OpenSSH format).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateInfo {
    /// Certificate serial number.
    pub serial: u64,
    /// Certificate type (user or host).
    pub cert_type: CertificateType,
    /// Key ID set by the CA.
    pub key_id: String,
    /// Valid principals (usernames or hostnames).
    pub valid_principals: Vec<String>,
    /// Validity start time.
    pub valid_after: DateTime<Utc>,
    /// Validity end time.
    pub valid_before: DateTime<Utc>,
    /// Critical options (force-command, source-address, etc.).
    pub critical_options: HashMap<String, String>,
    /// Extensions (permit-pty, permit-agent-forwarding, etc.).
    pub extensions: HashMap<String, String>,
    /// CA public key fingerprint.
    pub ca_fingerprint: String,
    /// Whether the certificate is currently valid.
    pub is_valid: bool,
}

/// SSH certificate type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CertificateType {
    /// User certificate (type 1).
    User,
    /// Host certificate (type 2).
    Host,
}

// ── Key Constraints ─────────────────────────────────────────────────

/// Constraint applied to a key in the agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum KeyConstraint {
    /// Key expires after a number of seconds.
    Lifetime(u64),
    /// User must confirm each use (touch / dialog).
    ConfirmBeforeUse,
    /// Maximum number of signing operations.
    MaxSignatures(u64),
    /// Restrict to specific destination hosts.
    HostRestriction(Vec<String>),
    /// Restrict to specific usernames.
    UserRestriction(Vec<String>),
    /// Restrict forwarding depth (0 = no forwarding).
    ForwardingDepth(u32),
    /// Extension constraint (implementation-defined).
    Extension { name: String, data: Vec<u8> },
}

impl KeyConstraint {
    /// Check if a lifetime constraint has expired.
    pub fn is_lifetime_expired(&self, added_at: DateTime<Utc>) -> bool {
        if let Self::Lifetime(seconds) = self {
            let expiry = added_at + chrono::Duration::seconds(*seconds as i64);
            Utc::now() > expiry
        } else {
            false
        }
    }

    /// Check if max-signature constraint is reached.
    pub fn is_max_signatures_reached(&self, current_count: u64) -> bool {
        if let Self::MaxSignatures(max) = self {
            current_count >= *max
        } else {
            false
        }
    }
}

// ── Agent Configuration ─────────────────────────────────────────────

/// Configuration for the SSH agent service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    /// Whether the built-in agent is enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Agent instance name (for multi-agent support).
    #[serde(default = "default_agent_name")]
    pub name: String,

    // ── Socket settings ──
    /// Socket path for Unix (SSH_AUTH_SOCK) or named pipe name for Windows.
    #[serde(default)]
    pub socket_path: Option<String>,
    /// Whether to also listen on a localhost TCP port (for IDE integration).
    #[serde(default)]
    pub tcp_listen: bool,
    /// TCP port to listen on (if `tcp_listen` is true).
    #[serde(default = "default_tcp_port")]
    pub tcp_port: u16,

    // ── System agent ──
    /// Whether to bridge to the system's native SSH agent.
    #[serde(default = "default_true")]
    pub system_agent_enabled: bool,
    /// Custom system agent socket path (None = auto-detect).
    #[serde(default)]
    pub system_agent_socket: Option<String>,
    /// Whether to merge system agent keys with built-in keys.
    #[serde(default = "default_true")]
    pub merge_system_keys: bool,

    // ── Key management ──
    /// Auto-load keys from ~/.ssh on startup.
    #[serde(default = "default_true")]
    pub auto_load_default_keys: bool,
    /// Paths to auto-load on startup.
    #[serde(default)]
    pub auto_load_paths: Vec<String>,
    /// Default key lifetime in seconds (0 = no expiry).
    #[serde(default)]
    pub default_lifetime_secs: u32,
    /// Default confirm-before-use for added keys.
    #[serde(default)]
    pub default_confirm: bool,
    /// Maximum number of keys the agent can hold.
    #[serde(default = "default_max_keys")]
    pub max_keys: usize,

    // ── Security ──
    /// Whether the agent is initially locked (requires passphrase to use).
    #[serde(default)]
    pub start_locked: bool,
    /// Allowed key algorithms (empty = all).
    #[serde(default)]
    pub allowed_algorithms: Vec<KeyAlgorithm>,
    /// Whether to allow DSA keys (disabled by default since OpenSSH 7.0).
    #[serde(default)]
    pub allow_dsa: bool,
    /// Minimum RSA key size in bits.
    #[serde(default = "default_min_rsa_bits")]
    pub min_rsa_bits: u32,
    /// Allow agent forwarding (global toggle).
    #[serde(default = "default_true")]
    pub allow_forwarding: bool,
    /// Maximum forwarding chain depth.
    #[serde(default = "default_max_forward_depth")]
    pub max_forwarding_depth: u32,

    // ── Persistence ──
    /// Directory for persisted keys and config.
    #[serde(default)]
    pub storage_dir: String,
    /// Whether to encrypt persisted keys at rest.
    #[serde(default = "default_true")]
    pub encrypt_at_rest: bool,

    // ── Audit ──
    /// Whether to log all agent operations.
    #[serde(default = "default_true")]
    pub audit_enabled: bool,
    /// Maximum audit events to keep in memory.
    #[serde(default = "default_max_audit_events")]
    pub max_audit_events: usize,

    // ── PKCS#11 ──
    /// PKCS#11 provider library paths to load.
    #[serde(default)]
    pub pkcs11_providers: Vec<String>,

    // ── Built-in agent ──
    /// Maximum concurrent keys in the built-in agent (0 = unlimited).
    #[serde(default = "default_max_keys")]
    pub max_loaded_keys: usize,
    /// Automatically connect to system SSH agent on start.
    #[serde(default = "default_true")]
    pub auto_connect_system_agent: bool,
    /// System agent identity cache TTL in seconds.
    #[serde(default = "default_cache_ttl")]
    pub system_agent_cache_ttl: u64,
    /// Maximum audit entries to keep in memory.
    #[serde(default = "default_max_audit_events")]
    pub audit_max_entries: usize,
    /// Path to the persistent audit log file (empty = none).
    #[serde(default)]
    pub audit_file: String,
}

fn default_true() -> bool {
    true
}
fn default_agent_name() -> String {
    "default".to_string()
}
fn default_tcp_port() -> u16 {
    0
}
fn default_max_keys() -> usize {
    256
}
fn default_min_rsa_bits() -> u32 {
    2048
}
fn default_max_forward_depth() -> u32 {
    5
}
fn default_max_audit_events() -> usize {
    1000
}
fn default_cache_ttl() -> u64 {
    300
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            name: "default".to_string(),
            socket_path: None,
            tcp_listen: false,
            tcp_port: 0,
            system_agent_enabled: true,
            system_agent_socket: None,
            merge_system_keys: true,
            auto_load_default_keys: true,
            auto_load_paths: Vec::new(),
            default_lifetime_secs: 0,
            default_confirm: false,
            max_keys: 256,
            start_locked: false,
            allowed_algorithms: Vec::new(),
            allow_dsa: false,
            min_rsa_bits: 2048,
            allow_forwarding: true,
            max_forwarding_depth: 5,
            storage_dir: String::new(),
            encrypt_at_rest: true,
            audit_enabled: true,
            max_audit_events: 1000,
            pkcs11_providers: Vec::new(),
            max_loaded_keys: 256,
            auto_connect_system_agent: true,
            system_agent_cache_ttl: 300,
            audit_max_entries: 1000,
            audit_file: String::new(),
        }
    }
}

// ── Agent Status ────────────────────────────────────────────────────

/// Current state of the SSH agent service.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentStatus {
    /// Whether the agent is running.
    pub running: bool,
    /// Whether the agent is locked.
    pub locked: bool,
    /// Socket path being listened on.
    pub socket_path: Option<String>,
    /// System agent connection status.
    pub system_agent_connected: bool,
    /// Number of keys currently loaded.
    pub loaded_keys: u32,
    /// Number of active forwarding sessions.
    pub forwarding_sessions: u32,
    /// When the agent was started.
    pub started_at: Option<DateTime<Utc>>,
}

// ── Agent Events ────────────────────────────────────────────────────

/// Events emitted by the agent for audit and UI updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// Agent started.
    Started,
    /// Agent stopped.
    Stopped,
    /// Agent locked by passphrase.
    Locked,
    /// Agent unlocked.
    Unlocked,
    /// Key added to agent.
    KeyAdded { key_id: String, fingerprint: String },
    /// Key removed from agent.
    KeyRemoved { key_id: String, fingerprint: String },
    /// All keys removed.
    AllKeysRemoved,
    /// Signing request.
    SignRequest {
        key_fingerprint: String,
        data_hash: String,
    },
    /// Signing completed.
    SignCompleted {
        key_fingerprint: String,
        success: bool,
    },
    /// Forwarding session started.
    ForwardingStarted {
        session_id: String,
        remote_host: String,
    },
    /// Forwarding session ended.
    ForwardingStopped { session_id: String },
    /// Key constraint triggered (lifetime expired, max sign, etc.).
    ConstraintTriggered { key_id: String, constraint: String },
    /// Confirmation requested for key use.
    ConfirmationRequested(PendingSignRequest),
    /// Confirmation response.
    ConfirmationResponse { request_id: String, approved: bool },
    /// System agent bridge event.
    SystemAgentEvent { event: String },
    /// PKCS#11 provider event.
    Pkcs11Event { provider: String, event: String },
    /// Error event.
    Error { message: String },
}

impl AgentEvent {
    /// Get a timestamp for this event.
    pub fn timestamp(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// Timestamped audit entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Unique entry ID.
    pub id: String,
    /// When the event occurred.
    pub timestamp: DateTime<Utc>,
    /// The action performed.
    pub action: String,
    /// Key fingerprint (if applicable).
    pub key_fingerprint: Option<String>,
    /// Client info (source address, process, etc.).
    pub client_info: Option<ClientInfo>,
    /// Whether the operation succeeded.
    pub success: bool,
    /// Additional details.
    pub details: String,
}

/// Information about the client making a request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    /// Client process name (if available).
    pub process_name: Option<String>,
    /// Client PID.
    pub pid: Option<u32>,
    /// Source address (for TCP clients).
    pub address: Option<String>,
}

// ── Sign Request / Response ─────────────────────────────────────────

/// A pending sign request that may need user confirmation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingSignRequest {
    /// Request ID.
    pub id: String,
    /// Key fingerprint.
    pub key_fingerprint: String,
    /// Hash of the data to be signed.
    pub data_hash: String,
    /// Client info.
    pub client_info: Option<ClientInfo>,
    /// When the request was received.
    pub requested_at: DateTime<Utc>,
    /// When the request expires.
    pub expires_at: DateTime<Utc>,
}

// ── Forwarding Session ──────────────────────────────────────────────

/// Active agent forwarding session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForwardingSession {
    /// Session ID.
    pub id: String,
    /// Remote host being forwarded through.
    pub remote_host: String,
    /// Remote user.
    pub remote_user: String,
    /// When the session started.
    pub started_at: DateTime<Utc>,
    /// Current forwarding depth.
    pub depth: u32,
    /// Whether the session is currently active.
    pub active: bool,
    /// JSON-serialised key filter (empty = allow all).
    pub key_filter: String,
    /// Number of sign requests served.
    pub sign_count: u64,
}

// ── PKCS#11 ─────────────────────────────────────────────────────────

/// PKCS#11 provider status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pkcs11ProviderStatus {
    /// Library path.
    pub library_path: String,
    /// Whether the provider is loaded.
    pub loaded: bool,
    /// Number of keys available.
    pub key_count: usize,
    /// Slot information.
    pub slots: Vec<Pkcs11SlotInfo>,
    /// Error message (if loading failed).
    pub error: Option<String>,
}

/// PKCS#11 slot information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pkcs11SlotInfo {
    /// Slot ID.
    pub slot_id: u32,
    /// Token label.
    pub token_label: String,
    /// Manufacturer.
    pub manufacturer: String,
    /// Whether a token is present.
    pub token_present: bool,
    /// Number of keys in this slot.
    pub key_count: usize,
}

// ── State alias ─────────────────────────────────────────────────────

/// Tauri managed-state type for the agent service.
pub type SshAgentServiceState = Arc<Mutex<crate::service::SshAgentService>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_algorithm_ssh_names() {
        assert_eq!(KeyAlgorithm::Rsa.ssh_name(), "ssh-rsa");
        assert_eq!(KeyAlgorithm::Ed25519.ssh_name(), "ssh-ed25519");
        assert_eq!(
            KeyAlgorithm::SkEd25519.ssh_name(),
            "sk-ssh-ed25519@openssh.com"
        );
        assert_eq!(KeyAlgorithm::EcdsaP256.ssh_name(), "ecdsa-sha2-nistp256");
    }

    #[test]
    fn test_key_constraint_lifetime() {
        let c = KeyConstraint::Lifetime(0);
        let past = Utc::now() - chrono::Duration::seconds(10);
        assert!(c.is_lifetime_expired(past));
    }

    #[test]
    fn test_key_constraint_max_signatures() {
        let c = KeyConstraint::MaxSignatures(5);
        assert!(!c.is_max_signatures_reached(4));
        assert!(c.is_max_signatures_reached(5));
        assert!(c.is_max_signatures_reached(6));
    }

    #[test]
    fn test_default_config() {
        let cfg = AgentConfig::default();
        assert!(cfg.enabled);
        assert!(cfg.system_agent_enabled);
        assert!(cfg.auto_load_default_keys);
        assert_eq!(cfg.max_keys, 256);
        assert_eq!(cfg.min_rsa_bits, 2048);
        assert!(!cfg.allow_dsa);
    }
}
