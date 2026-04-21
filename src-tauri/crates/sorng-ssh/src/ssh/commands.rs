use super::types::*;
use super::TERMINAL_BUFFERS;

// ===============================
// Core SSH Tauri Commands
// ===============================

// ===============================
// Mixed-chain / jump-host Tauri Commands
// ===============================

// ===============================
// FIDO2 / Security Key Tauri Commands
// ===============================

/// Information about an SSH key file.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshKeyFileInfo {
    /// File path.
    pub path: String,
    /// Whether the file is a valid private key.
    pub is_valid: bool,
    /// Whether the key is an SK (security-key) type.
    pub is_sk: bool,
    /// SK algorithm if applicable (e.g. "sk-ssh-ed25519@openssh.com").
    pub sk_algorithm: Option<String>,
    /// Whether the key is encrypted with a passphrase.
    pub is_encrypted: bool,
    /// Whether the key requires FIDO2 user interaction (touch/PIN).
    pub needs_touch: bool,
}

// ===============================
// SSH Compression Tauri Commands
// ===============================
