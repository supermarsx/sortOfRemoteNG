//! # GPG Agent Types
//!
//! All data structures for the GPG agent subsystem including key
//! representations, smart card info, trust models, audit entries,
//! and service state.

use serde::{Deserialize, Serialize};
use std::sync::Arc;

// ── Key Algorithm ───────────────────────────────────────────────────

/// GPG key algorithm variants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum GpgKeyAlgorithm {
    Rsa1024,
    Rsa2048,
    Rsa3072,
    Rsa4096,
    Dsa,
    Ed25519,
    Cv25519,
    EcdsaP256,
    EcdsaP384,
    EcdsaP521,
    ElGamal,
    Unknown(String),
}

impl GpgKeyAlgorithm {
    /// Parse from GPG algorithm ID string.
    pub fn from_gpg_id(id: &str) -> Self {
        match id {
            "1" | "RSA" => Self::Rsa2048, // default RSA
            "17" | "DSA" => Self::Dsa,
            "22" | "EdDSA" | "ed25519" => Self::Ed25519,
            "18" | "cv25519" => Self::Cv25519,
            "19" | "nistp256" | "ECDSA" => Self::EcdsaP256,
            "nistp384" => Self::EcdsaP384,
            "nistp521" => Self::EcdsaP521,
            "16" | "ELG" => Self::ElGamal,
            "rsa1024" => Self::Rsa1024,
            "rsa2048" => Self::Rsa2048,
            "rsa3072" => Self::Rsa3072,
            "rsa4096" => Self::Rsa4096,
            other => Self::Unknown(other.to_string()),
        }
    }

    /// Return the GPG algorithm name for key generation.
    pub fn to_gpg_algo(&self) -> &str {
        match self {
            Self::Rsa1024 => "rsa1024",
            Self::Rsa2048 => "rsa2048",
            Self::Rsa3072 => "rsa3072",
            Self::Rsa4096 => "rsa4096",
            Self::Dsa => "dsa",
            Self::Ed25519 => "ed25519",
            Self::Cv25519 => "cv25519",
            Self::EcdsaP256 => "nistp256",
            Self::EcdsaP384 => "nistp384",
            Self::EcdsaP521 => "nistp521",
            Self::ElGamal => "elg",
            Self::Unknown(s) => s.as_str(),
        }
    }

    /// Key size in bits (0 for curve-based).
    pub fn default_bits(&self) -> u32 {
        match self {
            Self::Rsa1024 => 1024,
            Self::Rsa2048 => 2048,
            Self::Rsa3072 => 3072,
            Self::Rsa4096 => 4096,
            Self::Dsa => 2048,
            Self::ElGamal => 2048,
            Self::Ed25519 | Self::Cv25519 => 256,
            Self::EcdsaP256 => 256,
            Self::EcdsaP384 => 384,
            Self::EcdsaP521 => 521,
            Self::Unknown(_) => 0,
        }
    }
}

impl std::fmt::Display for GpgKeyAlgorithm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_gpg_algo())
    }
}

// ── Key Capability ──────────────────────────────────────────────────

/// What a key or subkey can do.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum KeyCapability {
    Certify,
    Sign,
    Encrypt,
    Authenticate,
}

impl KeyCapability {
    /// Parse a capability flag character from GPG colon output.
    pub fn from_flag(c: char) -> Option<Self> {
        match c {
            'c' | 'C' => Some(Self::Certify),
            's' | 'S' => Some(Self::Sign),
            'e' | 'E' => Some(Self::Encrypt),
            'a' | 'A' => Some(Self::Authenticate),
            _ => None,
        }
    }

    /// Convert to single-character flag.
    pub fn flag_char(&self) -> char {
        match self {
            Self::Certify => 'C',
            Self::Sign => 'S',
            Self::Encrypt => 'E',
            Self::Authenticate => 'A',
        }
    }
}

impl std::fmt::Display for KeyCapability {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Certify => write!(f, "Certify"),
            Self::Sign => write!(f, "Sign"),
            Self::Encrypt => write!(f, "Encrypt"),
            Self::Authenticate => write!(f, "Authenticate"),
        }
    }
}

// ── Key Validity ────────────────────────────────────────────────────

/// Validity level of a key or UID.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum KeyValidity {
    Unknown,
    Invalid,
    Disabled,
    Revoked,
    Expired,
    Undefined,
    NeverValid,
    Marginal,
    Full,
    Ultimate,
}

impl KeyValidity {
    /// Parse from GPG colon validity field.
    pub fn from_colon(c: &str) -> Self {
        match c {
            "o" => Self::Unknown,
            "i" => Self::Invalid,
            "d" => Self::Disabled,
            "r" => Self::Revoked,
            "e" => Self::Expired,
            "q" => Self::Undefined,
            "n" => Self::NeverValid,
            "m" => Self::Marginal,
            "f" => Self::Full,
            "u" => Self::Ultimate,
            _ => Self::Unknown,
        }
    }
}

impl std::fmt::Display for KeyValidity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let label = match self {
            Self::Unknown => "Unknown",
            Self::Invalid => "Invalid",
            Self::Disabled => "Disabled",
            Self::Revoked => "Revoked",
            Self::Expired => "Expired",
            Self::Undefined => "Undefined",
            Self::NeverValid => "Never Valid",
            Self::Marginal => "Marginal",
            Self::Full => "Full",
            Self::Ultimate => "Ultimate",
        };
        write!(f, "{}", label)
    }
}

// ── Owner Trust ─────────────────────────────────────────────────────

/// Owner trust level assigned to a key.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum KeyOwnerTrust {
    Unknown,
    Untrusted,
    Marginal,
    Full,
    Ultimate,
}

impl KeyOwnerTrust {
    /// Parse from GPG colon owner-trust field.
    pub fn from_colon(c: &str) -> Self {
        match c {
            "-" | "o" => Self::Unknown,
            "n" => Self::Untrusted,
            "m" => Self::Marginal,
            "f" => Self::Full,
            "u" => Self::Ultimate,
            _ => Self::Unknown,
        }
    }

    /// Convert to the GPG trust value (1-5).
    pub fn to_gpg_trust_value(&self) -> u8 {
        match self {
            Self::Unknown => 1,
            Self::Untrusted => 2,
            Self::Marginal => 3,
            Self::Full => 4,
            Self::Ultimate => 5,
        }
    }

    /// Parse from string representation.
    pub fn from_str_name(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "unknown" => Self::Unknown,
            "untrusted" | "never" => Self::Untrusted,
            "marginal" => Self::Marginal,
            "full" => Self::Full,
            "ultimate" => Self::Ultimate,
            _ => Self::Unknown,
        }
    }
}

impl std::fmt::Display for KeyOwnerTrust {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let label = match self {
            Self::Unknown => "Unknown",
            Self::Untrusted => "Untrusted",
            Self::Marginal => "Marginal",
            Self::Full => "Full",
            Self::Ultimate => "Ultimate",
        };
        write!(f, "{}", label)
    }
}

// ── GPG Key ─────────────────────────────────────────────────────────

/// A full GPG key with UIDs and subkeys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpgKey {
    pub key_id: String,
    pub fingerprint: String,
    pub algorithm: GpgKeyAlgorithm,
    pub bits: u32,
    pub creation_date: String,
    pub expiration_date: Option<String>,
    pub capabilities: Vec<KeyCapability>,
    pub owner_trust: KeyOwnerTrust,
    pub validity: KeyValidity,
    pub uid_list: Vec<GpgUid>,
    pub subkeys: Vec<GpgSubkey>,
    pub is_secret: bool,
    pub is_revoked: bool,
    pub is_expired: bool,
    pub is_disabled: bool,
    pub card_serial: Option<String>,
    pub keygrip: Option<String>,
    pub compliance: String,
}

impl Default for GpgKey {
    fn default() -> Self {
        Self {
            key_id: String::new(),
            fingerprint: String::new(),
            algorithm: GpgKeyAlgorithm::Rsa2048,
            bits: 0,
            creation_date: String::new(),
            expiration_date: None,
            capabilities: Vec::new(),
            owner_trust: KeyOwnerTrust::Unknown,
            validity: KeyValidity::Unknown,
            uid_list: Vec::new(),
            subkeys: Vec::new(),
            is_secret: false,
            is_revoked: false,
            is_expired: false,
            is_disabled: false,
            card_serial: None,
            keygrip: None,
            compliance: String::new(),
        }
    }
}

// ── GPG UID ─────────────────────────────────────────────────────────

/// A User ID attached to a GPG key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpgUid {
    pub uid: String,
    pub name: String,
    pub email: String,
    pub comment: String,
    pub creation_date: String,
    pub validity: KeyValidity,
    pub is_primary: bool,
    pub is_revoked: bool,
    pub signatures: Vec<UidSignature>,
}

impl Default for GpgUid {
    fn default() -> Self {
        Self {
            uid: String::new(),
            name: String::new(),
            email: String::new(),
            comment: String::new(),
            creation_date: String::new(),
            validity: KeyValidity::Unknown,
            is_primary: false,
            is_revoked: false,
            signatures: Vec::new(),
        }
    }
}

/// Signature on a UID.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UidSignature {
    pub signer_key_id: String,
    pub signer_uid: String,
    pub creation_date: String,
    pub expiration_date: Option<String>,
    pub signature_class: String,
    pub is_exportable: bool,
    pub trust_level: u8,
    pub trust_amount: u8,
}

impl Default for UidSignature {
    fn default() -> Self {
        Self {
            signer_key_id: String::new(),
            signer_uid: String::new(),
            creation_date: String::new(),
            expiration_date: None,
            signature_class: String::new(),
            is_exportable: true,
            trust_level: 0,
            trust_amount: 0,
        }
    }
}

// ── Subkey ──────────────────────────────────────────────────────────

/// A subkey belonging to a primary GPG key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpgSubkey {
    pub key_id: String,
    pub fingerprint: String,
    pub algorithm: GpgKeyAlgorithm,
    pub bits: u32,
    pub creation_date: String,
    pub expiration_date: Option<String>,
    pub capabilities: Vec<KeyCapability>,
    pub is_revoked: bool,
    pub is_expired: bool,
    pub card_serial: Option<String>,
    pub keygrip: Option<String>,
}

impl Default for GpgSubkey {
    fn default() -> Self {
        Self {
            key_id: String::new(),
            fingerprint: String::new(),
            algorithm: GpgKeyAlgorithm::Rsa2048,
            bits: 0,
            creation_date: String::new(),
            expiration_date: None,
            capabilities: Vec::new(),
            is_revoked: false,
            is_expired: false,
            card_serial: None,
            keygrip: None,
        }
    }
}

// ── Smart Card ──────────────────────────────────────────────────────

/// Information about an OpenPGP smart card.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartCardInfo {
    pub reader: String,
    pub serial: String,
    pub manufacturer: String,
    pub application_version: String,
    pub pin_retry_count: (u32, u32, u32),
    pub signature_count: u32,
    pub signature_key_fingerprint: Option<String>,
    pub encryption_key_fingerprint: Option<String>,
    pub authentication_key_fingerprint: Option<String>,
    pub card_holder: String,
    pub language: String,
    pub sex: Option<char>,
    pub public_key_url: String,
    pub login_data: String,
    pub private_do1: String,
    pub private_do2: String,
    pub private_do3: String,
    pub private_do4: String,
    pub ca_fingerprints: Vec<String>,
    pub key_attributes: Vec<CardKeyAttribute>,
    pub extended_capabilities: Vec<String>,
}

impl Default for SmartCardInfo {
    fn default() -> Self {
        Self {
            reader: String::new(),
            serial: String::new(),
            manufacturer: String::new(),
            application_version: String::new(),
            pin_retry_count: (3, 0, 3),
            signature_count: 0,
            signature_key_fingerprint: None,
            encryption_key_fingerprint: None,
            authentication_key_fingerprint: None,
            card_holder: String::new(),
            language: String::new(),
            sex: None,
            public_key_url: String::new(),
            login_data: String::new(),
            private_do1: String::new(),
            private_do2: String::new(),
            private_do3: String::new(),
            private_do4: String::new(),
            ca_fingerprints: Vec::new(),
            key_attributes: Vec::new(),
            extended_capabilities: Vec::new(),
        }
    }
}

/// Key attribute for a smart card slot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardKeyAttribute {
    pub slot: CardSlot,
    pub algorithm: GpgKeyAlgorithm,
    pub bits: u32,
    pub curve: Option<String>,
}

/// Smart card key slot.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum CardSlot {
    Signature,
    Encryption,
    Authentication,
}

impl CardSlot {
    /// Parse from string.
    pub fn from_str_name(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "sig" | "signature" | "1" => Some(Self::Signature),
            "enc" | "encryption" | "2" => Some(Self::Encryption),
            "auth" | "authentication" | "3" => Some(Self::Authentication),
            _ => None,
        }
    }

    /// Slot index number (1-based).
    pub fn index(&self) -> u8 {
        match self {
            Self::Signature => 1,
            Self::Encryption => 2,
            Self::Authentication => 3,
        }
    }
}

impl std::fmt::Display for CardSlot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Signature => write!(f, "Signature"),
            Self::Encryption => write!(f, "Encryption"),
            Self::Authentication => write!(f, "Authentication"),
        }
    }
}

// ── Agent Status ────────────────────────────────────────────────────

/// Live status of the gpg-agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpgAgentStatus {
    pub running: bool,
    pub version: String,
    pub socket_path: String,
    pub extra_socket_path: String,
    pub ssh_socket_path: String,
    pub scdaemon_running: bool,
    pub scdaemon_socket: String,
    pub card_present: bool,
    pub card_serial: Option<String>,
    pub keys_cached: u32,
    pub pinentry_program: String,
    pub allow_loopback_pinentry: bool,
    pub max_cache_ttl: u32,
    pub default_cache_ttl: u32,
    pub enable_ssh_support: bool,
    pub total_operations: u64,
}

impl Default for GpgAgentStatus {
    fn default() -> Self {
        Self {
            running: false,
            version: String::new(),
            socket_path: String::new(),
            extra_socket_path: String::new(),
            ssh_socket_path: String::new(),
            scdaemon_running: false,
            scdaemon_socket: String::new(),
            card_present: false,
            card_serial: None,
            keys_cached: 0,
            pinentry_program: String::new(),
            allow_loopback_pinentry: false,
            max_cache_ttl: 7200,
            default_cache_ttl: 600,
            enable_ssh_support: false,
            total_operations: 0,
        }
    }
}

// ── Agent Configuration ─────────────────────────────────────────────

/// Pinentry interaction mode.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PinentryMode {
    Default,
    Ask,
    Cancel,
    Error,
    Loopback,
}

impl PinentryMode {
    /// Convert to gpg command-line value.
    pub fn as_gpg_value(&self) -> &str {
        match self {
            Self::Default => "default",
            Self::Ask => "ask",
            Self::Cancel => "cancel",
            Self::Error => "error",
            Self::Loopback => "loopback",
        }
    }
}

impl std::fmt::Display for PinentryMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_gpg_value())
    }
}

/// Full GPG agent + gpg configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpgAgentConfig {
    pub home_dir: String,
    pub gpg_binary: String,
    pub gpg_agent_binary: String,
    pub scdaemon_binary: String,
    pub default_key: Option<String>,
    pub auto_key_locate: Vec<String>,
    pub keyserver: String,
    pub keyserver_options: Vec<String>,
    pub pinentry_mode: PinentryMode,
    pub pinentry_program: String,
    pub max_cache_ttl: u32,
    pub default_cache_ttl: u32,
    pub enable_ssh_support: bool,
    pub extra_socket: String,
    pub allow_loopback_pinentry: bool,
    pub auto_expand_secmem: bool,
    pub s2k_digest_algo: String,
    pub s2k_cipher_algo: String,
    pub personal_cipher_preferences: Vec<String>,
    pub personal_digest_preferences: Vec<String>,
    pub personal_compress_preferences: Vec<String>,
    pub default_preference_list: String,
    pub agent_socket: String,
    pub scdaemon_options: Vec<String>,
    pub auto_start_agent: bool,
    pub auto_start_scdaemon: bool,
}

impl Default for GpgAgentConfig {
    fn default() -> Self {
        Self {
            home_dir: String::new(),
            gpg_binary: "gpg".to_string(),
            gpg_agent_binary: "gpg-agent".to_string(),
            scdaemon_binary: "scdaemon".to_string(),
            default_key: None,
            auto_key_locate: vec!["local".to_string(), "wkd".to_string()],
            keyserver: "hkps://keys.openpgp.org".to_string(),
            keyserver_options: Vec::new(),
            pinentry_mode: PinentryMode::Default,
            pinentry_program: String::new(),
            max_cache_ttl: 7200,
            default_cache_ttl: 600,
            enable_ssh_support: false,
            extra_socket: String::new(),
            allow_loopback_pinentry: false,
            auto_expand_secmem: false,
            s2k_digest_algo: "SHA256".to_string(),
            s2k_cipher_algo: "AES256".to_string(),
            personal_cipher_preferences: Vec::new(),
            personal_digest_preferences: Vec::new(),
            personal_compress_preferences: Vec::new(),
            default_preference_list: String::new(),
            agent_socket: String::new(),
            scdaemon_options: Vec::new(),
            auto_start_agent: true,
            auto_start_scdaemon: true,
        }
    }
}

// ── Key Generation Parameters ───────────────────────────────────────

/// Parameters for generating a new GPG key pair.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyGenParams {
    pub key_type: GpgKeyAlgorithm,
    pub key_length: u32,
    pub subkey_type: Option<GpgKeyAlgorithm>,
    pub subkey_length: Option<u32>,
    pub name: String,
    pub email: String,
    pub comment: String,
    pub expiration: Option<String>,
    pub passphrase: Option<String>,
    pub capabilities: Vec<KeyCapability>,
}

impl Default for KeyGenParams {
    fn default() -> Self {
        Self {
            key_type: GpgKeyAlgorithm::Ed25519,
            key_length: 0,
            subkey_type: Some(GpgKeyAlgorithm::Cv25519),
            subkey_length: None,
            name: String::new(),
            email: String::new(),
            comment: String::new(),
            expiration: Some("2y".to_string()),
            passphrase: None,
            capabilities: vec![KeyCapability::Certify, KeyCapability::Sign],
        }
    }
}

// ── Key Server Result ───────────────────────────────────────────────

/// A result from a key server search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyServerResult {
    pub key_id: String,
    pub uid: String,
    pub creation_date: String,
    pub algorithm: GpgKeyAlgorithm,
    pub bits: u32,
    pub flags: String,
}

// ── Signature Result ────────────────────────────────────────────────

/// Result of a signing operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignatureResult {
    pub success: bool,
    #[serde(with = "serde_bytes_base64")]
    pub signature_data: Vec<u8>,
    pub signature_armor: String,
    pub hash_algo: String,
    pub sig_class: String,
    pub signer_key_id: String,
    pub signer_fingerprint: String,
    pub created_at: String,
    pub expires_at: Option<String>,
}

impl Default for SignatureResult {
    fn default() -> Self {
        Self {
            success: false,
            signature_data: Vec::new(),
            signature_armor: String::new(),
            hash_algo: String::new(),
            sig_class: String::new(),
            signer_key_id: String::new(),
            signer_fingerprint: String::new(),
            created_at: String::new(),
            expires_at: None,
        }
    }
}

// ── Verification Result ─────────────────────────────────────────────

/// Signature status classification.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SigStatus {
    Good,
    Bad,
    ExpiredKey,
    ExpiredSig,
    RevokedKey,
    MissingSigner,
    Error,
}

impl std::fmt::Display for SigStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Good => write!(f, "Good"),
            Self::Bad => write!(f, "Bad"),
            Self::ExpiredKey => write!(f, "Expired Key"),
            Self::ExpiredSig => write!(f, "Expired Signature"),
            Self::RevokedKey => write!(f, "Revoked Key"),
            Self::MissingSigner => write!(f, "Missing Signer"),
            Self::Error => write!(f, "Error"),
        }
    }
}

/// A notation on a signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notation {
    pub name: String,
    pub value: String,
    pub is_human_readable: bool,
    pub is_critical: bool,
}

/// Result of verifying a signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResult {
    pub valid: bool,
    pub signature_status: SigStatus,
    pub signer_key_id: String,
    pub signer_fingerprint: String,
    pub signer_uid: String,
    pub creation_date: String,
    pub expiration_date: Option<String>,
    pub hash_algo: String,
    pub key_validity: KeyValidity,
    pub trust_level: String,
    pub notations: Vec<Notation>,
    pub policy_url: Option<String>,
}

impl Default for VerificationResult {
    fn default() -> Self {
        Self {
            valid: false,
            signature_status: SigStatus::Error,
            signer_key_id: String::new(),
            signer_fingerprint: String::new(),
            signer_uid: String::new(),
            creation_date: String::new(),
            expiration_date: None,
            hash_algo: String::new(),
            key_validity: KeyValidity::Unknown,
            trust_level: String::new(),
            notations: Vec::new(),
            policy_url: None,
        }
    }
}

// ── Encryption / Decryption ─────────────────────────────────────────

/// Result of an encryption operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionResult {
    pub success: bool,
    #[serde(with = "serde_bytes_base64")]
    pub ciphertext: Vec<u8>,
    pub armor: String,
    pub recipients: Vec<String>,
    pub session_key_algo: String,
    pub is_symmetric: bool,
}

impl Default for EncryptionResult {
    fn default() -> Self {
        Self {
            success: false,
            ciphertext: Vec::new(),
            armor: String::new(),
            recipients: Vec::new(),
            session_key_algo: String::new(),
            is_symmetric: false,
        }
    }
}

/// A recipient that a message was encrypted to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecryptionRecipient {
    pub key_id: String,
    pub fingerprint: String,
    pub algorithm: GpgKeyAlgorithm,
    pub status: String,
}

/// Result of a decryption operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecryptionResult {
    pub success: bool,
    #[serde(with = "serde_bytes_base64")]
    pub plaintext: Vec<u8>,
    pub session_key_algo: String,
    pub recipients: Vec<DecryptionRecipient>,
    pub signature_info: Option<VerificationResult>,
    pub filename: Option<String>,
}

impl Default for DecryptionResult {
    fn default() -> Self {
        Self {
            success: false,
            plaintext: Vec::new(),
            session_key_algo: String::new(),
            recipients: Vec::new(),
            signature_info: None,
            filename: None,
        }
    }
}

// ── Trust DB ────────────────────────────────────────────────────────

/// Statistics from the GPG trust database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustDbStats {
    pub total_keys: u32,
    pub trusted_keys: u32,
    pub marginal_trust: u32,
    pub full_trust: u32,
    pub ultimate_trust: u32,
    pub revoked_keys: u32,
    pub expired_keys: u32,
    pub unknown_trust: u32,
}

impl Default for TrustDbStats {
    fn default() -> Self {
        Self {
            total_keys: 0,
            trusted_keys: 0,
            marginal_trust: 0,
            full_trust: 0,
            ultimate_trust: 0,
            revoked_keys: 0,
            expired_keys: 0,
            unknown_trust: 0,
        }
    }
}

// ── Export / Import Options ─────────────────────────────────────────

/// Options for key export.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyExportOptions {
    pub armor: bool,
    pub include_secret: bool,
    pub include_attributes: bool,
    pub include_local_sigs: bool,
    pub minimal: bool,
    pub clean: bool,
}

impl Default for KeyExportOptions {
    fn default() -> Self {
        Self {
            armor: true,
            include_secret: false,
            include_attributes: true,
            include_local_sigs: false,
            minimal: false,
            clean: false,
        }
    }
}

/// Result from a key import operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyImportResult {
    pub total: u32,
    pub imported: u32,
    pub unchanged: u32,
    pub no_user_id: u32,
    pub new_keys: u32,
    pub new_subkeys: u32,
    pub new_signatures: u32,
    pub new_revocations: u32,
    pub secrets_read: u32,
    pub secrets_imported: u32,
    pub secrets_unchanged: u32,
    pub not_imported: u32,
}

impl Default for KeyImportResult {
    fn default() -> Self {
        Self {
            total: 0,
            imported: 0,
            unchanged: 0,
            no_user_id: 0,
            new_keys: 0,
            new_subkeys: 0,
            new_signatures: 0,
            new_revocations: 0,
            secrets_read: 0,
            secrets_imported: 0,
            secrets_unchanged: 0,
            not_imported: 0,
        }
    }
}

// ── Audit ───────────────────────────────────────────────────────────

/// Actions tracked by the audit log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum GpgAuditAction {
    Sign,
    Verify,
    Encrypt,
    Decrypt,
    KeyGenerate,
    KeyImport,
    KeyExport,
    KeyDelete,
    KeySign,
    KeyTrust,
    KeyRevoke,
    CardOperation,
    AgentStart,
    AgentStop,
    KeyserverFetch,
    KeyserverSend,
    PinChange,
    PinReset,
}

impl std::fmt::Display for GpgAuditAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let label = match self {
            Self::Sign => "Sign",
            Self::Verify => "Verify",
            Self::Encrypt => "Encrypt",
            Self::Decrypt => "Decrypt",
            Self::KeyGenerate => "Key Generate",
            Self::KeyImport => "Key Import",
            Self::KeyExport => "Key Export",
            Self::KeyDelete => "Key Delete",
            Self::KeySign => "Key Sign",
            Self::KeyTrust => "Key Trust",
            Self::KeyRevoke => "Key Revoke",
            Self::CardOperation => "Card Operation",
            Self::AgentStart => "Agent Start",
            Self::AgentStop => "Agent Stop",
            Self::KeyserverFetch => "Keyserver Fetch",
            Self::KeyserverSend => "Keyserver Send",
            Self::PinChange => "PIN Change",
            Self::PinReset => "PIN Reset",
        };
        write!(f, "{}", label)
    }
}

/// A single audit log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpgAuditEntry {
    pub id: String,
    pub timestamp: String,
    pub action: GpgAuditAction,
    pub key_id: Option<String>,
    pub uid: Option<String>,
    pub details: String,
    pub success: bool,
    pub error: Option<String>,
}

// ── State Alias ─────────────────────────────────────────────────────

/// Tauri managed-state type for the GPG agent service.
pub type GpgServiceState = Arc<tokio::sync::Mutex<crate::service::GpgAgentService>>;

// ── Serde helpers ───────────────────────────────────────────────────

/// Custom serde module for Vec<u8> as base64 strings.
mod serde_bytes_base64 {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde::{self, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &Vec<u8>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let encoded = STANDARD.encode(bytes);
        serializer.serialize_str(&encoded)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        STANDARD.decode(&s).map_err(serde::de::Error::custom)
    }
}

// ── Helper Functions ────────────────────────────────────────────────

/// Parse capability flags from a GPG colon-delimited field.
pub fn parse_capabilities(flags: &str) -> Vec<KeyCapability> {
    flags.chars().filter_map(KeyCapability::from_flag).collect()
}

/// Parse a UID string into name, email, comment parts.
/// Format: "Name (Comment) <email@example.com>"
pub fn parse_uid_string(uid: &str) -> (String, String, String) {
    let uid = uid.trim();
    let mut name = uid.to_string();
    let mut email = String::new();
    let mut comment = String::new();

    // Extract email
    if let Some(start) = uid.rfind('<') {
        if let Some(end) = uid.rfind('>') {
            if end > start {
                email = uid[start + 1..end].to_string();
                name = uid[..start].trim().to_string();
            }
        }
    }

    // Extract comment
    if let Some(start) = name.find('(') {
        if let Some(end) = name.find(')') {
            if end > start {
                comment = name[start + 1..end].to_string();
                let before = name[..start].trim().to_string();
                let after = name[end + 1..].trim().to_string();
                name = format!("{}{}", before, if after.is_empty() { String::new() } else { format!(" {}", after) });
                name = name.trim().to_string();
            }
        }
    }

    (name, email, comment)
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_algorithm_from_gpg_id() {
        assert_eq!(GpgKeyAlgorithm::from_gpg_id("22"), GpgKeyAlgorithm::Ed25519);
        assert_eq!(GpgKeyAlgorithm::from_gpg_id("rsa4096"), GpgKeyAlgorithm::Rsa4096);
        assert_eq!(GpgKeyAlgorithm::from_gpg_id("1"), GpgKeyAlgorithm::Rsa2048);
        assert!(matches!(GpgKeyAlgorithm::from_gpg_id("xyz"), GpgKeyAlgorithm::Unknown(_)));
    }

    #[test]
    fn test_algorithm_bits() {
        assert_eq!(GpgKeyAlgorithm::Rsa4096.default_bits(), 4096);
        assert_eq!(GpgKeyAlgorithm::Ed25519.default_bits(), 256);
        assert_eq!(GpgKeyAlgorithm::EcdsaP384.default_bits(), 384);
    }

    #[test]
    fn test_capability_from_flag() {
        assert_eq!(KeyCapability::from_flag('S'), Some(KeyCapability::Sign));
        assert_eq!(KeyCapability::from_flag('e'), Some(KeyCapability::Encrypt));
        assert_eq!(KeyCapability::from_flag('x'), None);
    }

    #[test]
    fn test_parse_capabilities() {
        let caps = parse_capabilities("eSCA");
        assert_eq!(caps.len(), 4);
        assert!(caps.contains(&KeyCapability::Encrypt));
        assert!(caps.contains(&KeyCapability::Sign));
        assert!(caps.contains(&KeyCapability::Certify));
        assert!(caps.contains(&KeyCapability::Authenticate));
    }

    #[test]
    fn test_validity_from_colon() {
        assert_eq!(KeyValidity::from_colon("u"), KeyValidity::Ultimate);
        assert_eq!(KeyValidity::from_colon("f"), KeyValidity::Full);
        assert_eq!(KeyValidity::from_colon("r"), KeyValidity::Revoked);
        assert_eq!(KeyValidity::from_colon("?"), KeyValidity::Unknown);
    }

    #[test]
    fn test_owner_trust_round_trip() {
        let trust = KeyOwnerTrust::Full;
        assert_eq!(trust.to_gpg_trust_value(), 4);
        assert_eq!(KeyOwnerTrust::from_str_name("full"), KeyOwnerTrust::Full);
    }

    #[test]
    fn test_pinentry_mode_display() {
        assert_eq!(PinentryMode::Loopback.as_gpg_value(), "loopback");
        assert_eq!(PinentryMode::Ask.as_gpg_value(), "ask");
    }

    #[test]
    fn test_card_slot_from_str() {
        assert_eq!(CardSlot::from_str_name("sig"), Some(CardSlot::Signature));
        assert_eq!(CardSlot::from_str_name("enc"), Some(CardSlot::Encryption));
        assert_eq!(CardSlot::from_str_name("auth"), Some(CardSlot::Authentication));
        assert_eq!(CardSlot::from_str_name("unknown"), None);
    }

    #[test]
    fn test_parse_uid_string() {
        let (name, email, comment) = parse_uid_string("Alice Smith (work) <alice@example.com>");
        assert_eq!(name, "Alice Smith");
        assert_eq!(email, "alice@example.com");
        assert_eq!(comment, "work");

        let (name, email, comment) = parse_uid_string("Bob <bob@example.com>");
        assert_eq!(name, "Bob");
        assert_eq!(email, "bob@example.com");
        assert_eq!(comment, "");

        let (name, email, comment) = parse_uid_string("Charlie");
        assert_eq!(name, "Charlie");
        assert_eq!(email, "");
        assert_eq!(comment, "");
    }

    #[test]
    fn test_gpg_key_default() {
        let key = GpgKey::default();
        assert!(key.key_id.is_empty());
        assert!(!key.is_secret);
        assert!(!key.is_revoked);
    }

    #[test]
    fn test_sig_status_display() {
        assert_eq!(SigStatus::Good.to_string(), "Good");
        assert_eq!(SigStatus::MissingSigner.to_string(), "Missing Signer");
    }

    #[test]
    fn test_audit_action_display() {
        assert_eq!(GpgAuditAction::KeyGenerate.to_string(), "Key Generate");
        assert_eq!(GpgAuditAction::Encrypt.to_string(), "Encrypt");
    }

    #[test]
    fn test_export_options_default() {
        let opts = KeyExportOptions::default();
        assert!(opts.armor);
        assert!(!opts.include_secret);
    }

    #[test]
    fn test_import_result_default() {
        let result = KeyImportResult::default();
        assert_eq!(result.total, 0);
        assert_eq!(result.imported, 0);
    }

    #[test]
    fn test_owner_trust_from_colon() {
        assert_eq!(KeyOwnerTrust::from_colon("u"), KeyOwnerTrust::Ultimate);
        assert_eq!(KeyOwnerTrust::from_colon("n"), KeyOwnerTrust::Untrusted);
        assert_eq!(KeyOwnerTrust::from_colon("-"), KeyOwnerTrust::Unknown);
    }
}
