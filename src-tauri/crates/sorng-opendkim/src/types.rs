//! Shared types for OpenDKIM management.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpendkimConnectionConfig {
    /// SSH host for the OpenDKIM server.
    pub host: String,
    /// SSH port (default: 22).
    pub port: Option<u16>,
    /// SSH user.
    pub ssh_user: Option<String>,
    /// SSH password (if not using key-based auth).
    pub ssh_password: Option<String>,
    /// Path to SSH private key.
    pub ssh_key: Option<String>,
    /// Path to opendkim binary (default: /usr/sbin/opendkim).
    pub opendkim_bin: Option<String>,
    /// Path to opendkim.conf (default: /etc/opendkim.conf).
    pub config_path: Option<String>,
    /// Directory containing DKIM keys (default: /etc/opendkim/keys).
    pub key_dir: Option<String>,
    /// SSH command timeout in seconds (default: 30).
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpendkimConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub mode: Option<String>,
    pub domain: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSH Output
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// DKIM Keys
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkimKey {
    pub selector: String,
    pub domain: String,
    /// Key type: "rsa" or "ed25519".
    pub key_type: String,
    /// RSA key size in bits (e.g. 1024, 2048, 4096). None for ed25519.
    pub bits: Option<u32>,
    pub private_key_path: String,
    pub public_key_path: Option<String>,
    /// The DNS TXT record value for this key.
    pub dns_record: Option<String>,
    pub created_at: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateKeyRequest {
    pub selector: String,
    pub domain: String,
    /// Key type: "rsa" (default) or "ed25519".
    pub key_type: Option<String>,
    /// RSA key bits (default: 2048). Ignored for ed25519.
    pub bits: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotateKeyRequest {
    pub selector: String,
    pub domain: String,
    /// New selector name for the rotated key.
    pub new_selector: String,
    /// Key type for the new key (default: same as existing).
    pub key_type: Option<String>,
    /// Bits for the new key (default: same as existing).
    pub bits: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Signing Table
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningTableEntry {
    /// Pattern to match (e.g. "*@example.com").
    pub pattern: String,
    /// Key name reference (e.g. "default._domainkey.example.com").
    pub key_name: String,
    /// Optional comment.
    pub comment: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Key Table
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyTableEntry {
    /// Key name (e.g. "default._domainkey.example.com").
    pub key_name: String,
    /// Domain (e.g. "example.com").
    pub domain: String,
    /// Selector (e.g. "default").
    pub selector: String,
    /// Path to the private key file.
    pub private_key_path: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Trusted / Internal Hosts
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustedHost {
    /// Hostname, IP, or CIDR.
    pub host: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InternalHost {
    /// Hostname, IP, or CIDR.
    pub host: String,
    pub comment: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// OpenDKIM Config Parameters
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpendkimConfig {
    /// Configuration key (e.g. "Mode", "Socket", "Domain").
    pub key: String,
    /// Configuration value.
    pub value: String,
    /// Optional inline comment.
    pub comment: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Statistics
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpendkimStats {
    pub messages_signed: u64,
    pub messages_verified: u64,
    pub signatures_good: u64,
    pub signatures_bad: u64,
    pub signatures_error: u64,
    pub dns_queries: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// DNS Records
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsRecord {
    pub selector: String,
    pub domain: String,
    /// DNS record type (usually "TXT").
    pub record_type: String,
    /// The full DNS TXT record value.
    pub value: String,
    /// Suggested TTL.
    pub ttl: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// OpenDKIM Info
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpendkimInfo {
    pub version: String,
    /// Operating mode: "sign", "verify", or "both" (sv).
    pub mode: Option<String>,
    /// Milter socket path or address.
    pub socket: Option<String>,
    /// PID file path.
    pub pid_file: Option<String>,
    /// Active configuration file path.
    pub config_path: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config Test Result
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigTestResult {
    pub success: bool,
    pub output: String,
    pub errors: Vec<String>,
}
