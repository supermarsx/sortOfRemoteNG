//! # YubiKey Types
//!
//! All data structures for the YubiKey subsystem including device info,
//! PIV slots and certificates, FIDO2 credentials, OATH accounts, OTP
//! configuration, audit entries, and service state.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

// ── Form Factor ─────────────────────────────────────────────────────

/// Physical form factor of a YubiKey device.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum FormFactor {
    Unknown,
    UsbAKeychain,
    UsbANano,
    UsbCKeychain,
    UsbCNano,
    UsbCLightning,
    UsbABio,
    UsbCBio,
}

impl FormFactor {
    /// Parse from ykman info output string.
    pub fn from_str_label(s: &str) -> Self {
        let lower = s.to_lowercase();
        // Helper: detect USB-C variants (ykman may say "USB-C", "usb c", or just "5c"/"5ci")
        let is_usb_c = lower.contains("usb-c")
            || lower.contains("usb c")
            || lower.contains("5c")
            || lower.contains("5ci");

        if lower.contains("bio") && is_usb_c {
            Self::UsbCBio
        } else if lower.contains("bio") {
            Self::UsbABio
        } else if lower.contains("lightning") {
            Self::UsbCLightning
        } else if lower.contains("nano") && is_usb_c {
            Self::UsbCNano
        } else if lower.contains("nano") {
            Self::UsbANano
        } else if is_usb_c {
            Self::UsbCKeychain
        } else if lower.contains("usb-a") || lower.contains("keychain") || lower.contains("usb a")
        {
            Self::UsbAKeychain
        } else {
            Self::Unknown
        }
    }
}

impl std::fmt::Display for FormFactor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unknown => write!(f, "Unknown"),
            Self::UsbAKeychain => write!(f, "USB-A Keychain"),
            Self::UsbANano => write!(f, "USB-A Nano"),
            Self::UsbCKeychain => write!(f, "USB-C Keychain"),
            Self::UsbCNano => write!(f, "USB-C Nano"),
            Self::UsbCLightning => write!(f, "USB-C/Lightning"),
            Self::UsbABio => write!(f, "USB-A Bio"),
            Self::UsbCBio => write!(f, "USB-C Bio"),
        }
    }
}

// ── YubiKey Interface ───────────────────────────────────────────────

/// Hardware interface / applet categories available on a YubiKey.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum YubiKeyInterface {
    /// OTP applet (Yubico OTP, challenge-response, static password, HOTP)
    Otp,
    /// FIDO2/U2F applet
    Fido,
    /// CCID (smart card) — PIV, OATH, OpenPGP
    Ccid,
}

impl YubiKeyInterface {
    /// Parse from a ykman label.
    pub fn from_str_label(s: &str) -> Option<Self> {
        match s.trim().to_uppercase().as_str() {
            "OTP" => Some(Self::Otp),
            "FIDO" | "FIDO2" | "U2F" => Some(Self::Fido),
            "CCID" | "PIV" | "SMART CARD" => Some(Self::Ccid),
            _ => None,
        }
    }

    /// Label for ykman commands.
    pub fn ykman_label(&self) -> &str {
        match self {
            Self::Otp => "OTP",
            Self::Fido => "FIDO2",
            Self::Ccid => "CCID",
        }
    }
}

impl std::fmt::Display for YubiKeyInterface {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.ykman_label())
    }
}

// ── YubiKey Device ──────────────────────────────────────────────────

/// Represents a connected YubiKey device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YubiKeyDevice {
    /// Device serial number.
    pub serial: u32,
    /// Firmware version string (e.g. "5.4.3").
    pub firmware_version: String,
    /// Physical form factor.
    pub form_factor: FormFactor,
    /// Whether the device has NFC capability.
    pub has_nfc: bool,
    /// USB interfaces currently enabled.
    pub usb_interfaces_enabled: Vec<YubiKeyInterface>,
    /// NFC interfaces currently enabled (empty when `has_nfc` is false).
    pub nfc_interfaces_enabled: Vec<YubiKeyInterface>,
    /// Whether serial number is visible on the device.
    pub serial_visible: bool,
    /// Human-readable device name (e.g. "YubiKey 5 NFC").
    pub device_name: String,
    /// Whether this is a FIPS-series key.
    pub is_fips: bool,
    /// Whether this is a Security Key (SKY) series.
    pub is_sky: bool,
    /// Whether PIN complexity policy is enabled.
    pub pin_complexity: bool,
    /// Auto-eject timeout in seconds (CCID only, 0 = disabled).
    pub auto_eject_timeout: u16,
    /// Challenge-response timeout in seconds.
    pub challenge_response_timeout: u8,
    /// Device configuration flags.
    pub device_flags: Vec<String>,
    /// Whether the device configuration is locked.
    pub config_locked: bool,
}

impl Default for YubiKeyDevice {
    fn default() -> Self {
        Self {
            serial: 0,
            firmware_version: String::new(),
            form_factor: FormFactor::Unknown,
            has_nfc: false,
            usb_interfaces_enabled: Vec::new(),
            nfc_interfaces_enabled: Vec::new(),
            serial_visible: true,
            device_name: String::new(),
            is_fips: false,
            is_sky: false,
            pin_complexity: false,
            auto_eject_timeout: 0,
            challenge_response_timeout: 15,
            device_flags: Vec::new(),
            config_locked: false,
        }
    }
}

// ── PIV Slot ────────────────────────────────────────────────────────

/// PIV slot identifiers per NIST SP 800-73.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum PivSlot {
    /// 9a — PIV Authentication
    Authentication,
    /// 9c — Digital Signature
    Signature,
    /// 9d — Key Management
    KeyManagement,
    /// 9e — Card Authentication
    CardAuthentication,
    /// 82–95 — Retired Key Management slots 1–20
    Retired1,
    Retired2,
    Retired3,
    Retired4,
    Retired5,
    Retired6,
    Retired7,
    Retired8,
    Retired9,
    Retired10,
    Retired11,
    Retired12,
    Retired13,
    Retired14,
    Retired15,
    Retired16,
    Retired17,
    Retired18,
    Retired19,
    Retired20,
    /// f9 — Attestation
    Attestation,
}

impl PivSlot {
    /// Hex slot ID as used by ykman.
    pub fn hex_id(&self) -> &str {
        match self {
            Self::Authentication => "9a",
            Self::Signature => "9c",
            Self::KeyManagement => "9d",
            Self::CardAuthentication => "9e",
            Self::Retired1 => "82",
            Self::Retired2 => "83",
            Self::Retired3 => "84",
            Self::Retired4 => "85",
            Self::Retired5 => "86",
            Self::Retired6 => "87",
            Self::Retired7 => "88",
            Self::Retired8 => "89",
            Self::Retired9 => "8a",
            Self::Retired10 => "8b",
            Self::Retired11 => "8c",
            Self::Retired12 => "8d",
            Self::Retired13 => "8e",
            Self::Retired14 => "8f",
            Self::Retired15 => "90",
            Self::Retired16 => "91",
            Self::Retired17 => "92",
            Self::Retired18 => "93",
            Self::Retired19 => "94",
            Self::Retired20 => "95",
            Self::Attestation => "f9",
        }
    }

    /// Parse from hex string.
    pub fn from_hex(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "9a" => Some(Self::Authentication),
            "9c" => Some(Self::Signature),
            "9d" => Some(Self::KeyManagement),
            "9e" => Some(Self::CardAuthentication),
            "82" => Some(Self::Retired1),
            "83" => Some(Self::Retired2),
            "84" => Some(Self::Retired3),
            "85" => Some(Self::Retired4),
            "86" => Some(Self::Retired5),
            "87" => Some(Self::Retired6),
            "88" => Some(Self::Retired7),
            "89" => Some(Self::Retired8),
            "8a" => Some(Self::Retired9),
            "8b" => Some(Self::Retired10),
            "8c" => Some(Self::Retired11),
            "8d" => Some(Self::Retired12),
            "8e" => Some(Self::Retired13),
            "8f" => Some(Self::Retired14),
            "90" => Some(Self::Retired15),
            "91" => Some(Self::Retired16),
            "92" => Some(Self::Retired17),
            "93" => Some(Self::Retired18),
            "94" => Some(Self::Retired19),
            "95" => Some(Self::Retired20),
            "f9" => Some(Self::Attestation),
            _ => None,
        }
    }

    /// Human-readable label.
    pub fn label(&self) -> &str {
        match self {
            Self::Authentication => "Authentication (9a)",
            Self::Signature => "Digital Signature (9c)",
            Self::KeyManagement => "Key Management (9d)",
            Self::CardAuthentication => "Card Authentication (9e)",
            Self::Retired1 => "Retired 1 (82)",
            Self::Retired2 => "Retired 2 (83)",
            Self::Retired3 => "Retired 3 (84)",
            Self::Retired4 => "Retired 4 (85)",
            Self::Retired5 => "Retired 5 (86)",
            Self::Retired6 => "Retired 6 (87)",
            Self::Retired7 => "Retired 7 (88)",
            Self::Retired8 => "Retired 8 (89)",
            Self::Retired9 => "Retired 9 (8a)",
            Self::Retired10 => "Retired 10 (8b)",
            Self::Retired11 => "Retired 11 (8c)",
            Self::Retired12 => "Retired 12 (8d)",
            Self::Retired13 => "Retired 13 (8e)",
            Self::Retired14 => "Retired 14 (8f)",
            Self::Retired15 => "Retired 15 (90)",
            Self::Retired16 => "Retired 16 (91)",
            Self::Retired17 => "Retired 17 (92)",
            Self::Retired18 => "Retired 18 (93)",
            Self::Retired19 => "Retired 19 (94)",
            Self::Retired20 => "Retired 20 (95)",
            Self::Attestation => "Attestation (f9)",
        }
    }
}

impl std::fmt::Display for PivSlot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.hex_id())
    }
}

// ── PIV Algorithm ───────────────────────────────────────────────────

/// Cryptographic algorithms supported by PIV.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum PivAlgorithm {
    Rsa1024,
    Rsa2048,
    Rsa3072,
    Rsa4096,
    EcP256,
    EcP384,
    Ed25519,
    X25519,
}

impl PivAlgorithm {
    /// Parse from ykman output string.
    pub fn from_str_label(s: &str) -> Self {
        let lower = s.to_lowercase();
        if lower.contains("rsa1024") || lower.contains("rsa 1024") {
            Self::Rsa1024
        } else if lower.contains("rsa2048") || lower.contains("rsa 2048") {
            Self::Rsa2048
        } else if lower.contains("rsa3072") || lower.contains("rsa 3072") {
            Self::Rsa3072
        } else if lower.contains("rsa4096") || lower.contains("rsa 4096") {
            Self::Rsa4096
        } else if lower.contains("p384") || lower.contains("secp384") || lower.contains("eccp384")
        {
            Self::EcP384
        } else if lower.contains("p256")
            || lower.contains("secp256")
            || lower.contains("eccp256")
            || lower.contains("prime256")
        {
            Self::EcP256
        } else if lower.contains("ed25519") {
            Self::Ed25519
        } else if lower.contains("x25519") {
            Self::X25519
        } else {
            Self::EcP256
        }
    }

    /// ykman algorithm argument.
    pub fn ykman_arg(&self) -> &str {
        match self {
            Self::Rsa1024 => "RSA1024",
            Self::Rsa2048 => "RSA2048",
            Self::Rsa3072 => "RSA3072",
            Self::Rsa4096 => "RSA4096",
            Self::EcP256 => "ECCP256",
            Self::EcP384 => "ECCP384",
            Self::Ed25519 => "Ed25519",
            Self::X25519 => "X25519",
        }
    }
}

impl std::fmt::Display for PivAlgorithm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.ykman_arg())
    }
}

// ── PIN / Touch / Key-origin Policies ───────────────────────────────

/// PIV PIN policy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum PinPolicy {
    Default,
    Never,
    Once,
    Always,
    MatchOnce,
    MatchAlways,
}

impl PinPolicy {
    pub fn from_str_label(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "never" => Self::Never,
            "once" => Self::Once,
            "always" => Self::Always,
            "matchonce" | "match-once" | "match once" => Self::MatchOnce,
            "matchalways" | "match-always" | "match always" => Self::MatchAlways,
            _ => Self::Default,
        }
    }

    pub fn ykman_arg(&self) -> &str {
        match self {
            Self::Default => "DEFAULT",
            Self::Never => "NEVER",
            Self::Once => "ONCE",
            Self::Always => "ALWAYS",
            Self::MatchOnce => "MATCH-ONCE",
            Self::MatchAlways => "MATCH-ALWAYS",
        }
    }
}

impl std::fmt::Display for PinPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.ykman_arg())
    }
}

/// PIV touch policy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum TouchPolicy {
    Default,
    Never,
    Always,
    Cached,
}

impl TouchPolicy {
    pub fn from_str_label(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "never" => Self::Never,
            "always" => Self::Always,
            "cached" => Self::Cached,
            _ => Self::Default,
        }
    }

    pub fn ykman_arg(&self) -> &str {
        match self {
            Self::Default => "DEFAULT",
            Self::Never => "NEVER",
            Self::Always => "ALWAYS",
            Self::Cached => "CACHED",
        }
    }
}

impl std::fmt::Display for TouchPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.ykman_arg())
    }
}

/// Where a key was generated.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum KeyOrigin {
    Generated,
    Imported,
    Unknown,
}

// ── PIV Certificate ─────────────────────────────────────────────────

/// X.509 certificate stored in a PIV slot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PivCertificate {
    /// Subject DN.
    pub subject: String,
    /// Issuer DN.
    pub issuer: String,
    /// Certificate serial number (hex).
    pub serial: String,
    /// Validity start (RFC 3339).
    pub not_before: String,
    /// Validity end (RFC 3339).
    pub not_after: String,
    /// SHA-256 fingerprint (hex, colon-separated).
    pub fingerprint_sha256: String,
    /// Key algorithm.
    pub algorithm: String,
    /// Whether the cert is self-signed.
    pub is_self_signed: bool,
    /// Key usage extensions.
    pub key_usage: Vec<String>,
    /// Extended key usage OIDs or names.
    pub extended_key_usage: Vec<String>,
    /// Subject alternative names.
    pub san: Vec<String>,
    /// PEM-encoded certificate.
    pub pem: String,
    /// DER-encoded certificate (base64).
    pub der_base64: String,
}

// ── PIV Slot Info ───────────────────────────────────────────────────

/// Information about a PIV slot (key + certificate state).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PivSlotInfo {
    /// Which slot.
    pub slot: PivSlot,
    /// Algorithm of the key stored in this slot.
    pub algorithm: PivAlgorithm,
    /// Whether a private key is present.
    pub has_key: bool,
    /// Whether a certificate is present.
    pub has_certificate: bool,
    /// Certificate details (if present).
    pub certificate: Option<PivCertificate>,
    /// PIN policy for this slot.
    pub pin_policy: PinPolicy,
    /// Touch policy for this slot.
    pub touch_policy: TouchPolicy,
    /// Key origin (generated on device vs imported).
    pub origin: KeyOrigin,
}

impl Default for PivSlotInfo {
    fn default() -> Self {
        Self {
            slot: PivSlot::Authentication,
            algorithm: PivAlgorithm::EcP256,
            has_key: false,
            has_certificate: false,
            certificate: None,
            pin_policy: PinPolicy::Default,
            touch_policy: TouchPolicy::Default,
            origin: KeyOrigin::Unknown,
        }
    }
}

// ── Management Key Type ─────────────────────────────────────────────

/// Management key algorithm for PIV.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ManagementKeyType {
    TripleDes,
    Aes128,
    Aes192,
    Aes256,
}

impl ManagementKeyType {
    pub fn from_str_label(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "aes128" | "aes-128" => Self::Aes128,
            "aes192" | "aes-192" => Self::Aes192,
            "aes256" | "aes-256" => Self::Aes256,
            _ => Self::TripleDes,
        }
    }

    pub fn ykman_arg(&self) -> &str {
        match self {
            Self::TripleDes => "TDES",
            Self::Aes128 => "AES128",
            Self::Aes192 => "AES192",
            Self::Aes256 => "AES256",
        }
    }
}

// ── PIV PIN Status ──────────────────────────────────────────────────

/// PIN/PUK/management-key status for the PIV applet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PivPinStatus {
    /// PIN attempts remaining before lockout.
    pub pin_attempts_remaining: u32,
    /// PUK attempts remaining before permanent lockout.
    pub puk_attempts_remaining: u32,
    /// Whether the default PIN is still in use.
    pub pin_is_default: bool,
    /// Whether the default PUK is still in use.
    pub puk_is_default: bool,
    /// Whether the default management key is still in use.
    pub management_key_is_default: bool,
    /// Management key algorithm type.
    pub management_key_type: ManagementKeyType,
}

impl Default for PivPinStatus {
    fn default() -> Self {
        Self {
            pin_attempts_remaining: 3,
            puk_attempts_remaining: 3,
            pin_is_default: true,
            puk_is_default: true,
            management_key_is_default: true,
            management_key_type: ManagementKeyType::TripleDes,
        }
    }
}

// ── FIDO2 Credential Protect Level ─────────────────────────────────

/// FIDO2 credential protection level.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum CredProtect {
    None,
    Optional,
    OptionalWithList,
    Required,
}

// ── FIDO2 Credential ───────────────────────────────────────────────

/// A FIDO2 discoverable (resident) credential stored on the YubiKey.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fido2Credential {
    /// Credential ID (hex or base64url).
    pub credential_id: String,
    /// Relying party ID.
    pub rp_id: String,
    /// Relying party display name.
    pub rp_name: String,
    /// User name (handle).
    pub user_name: String,
    /// User display name.
    pub user_display_name: String,
    /// User ID (base64-encoded).
    pub user_id_base64: String,
    /// When the credential was created (RFC 3339 if available).
    pub creation_time: Option<String>,
    /// Whether large-blob key is associated.
    pub large_blob_key: bool,
    /// Whether hmac-secret extension is enabled.
    pub hmac_secret: bool,
    /// Credential protection level.
    pub cred_protect: CredProtect,
    /// Whether this credential is discoverable.
    pub discoverable: bool,
}

// ── FIDO2 Algorithm ─────────────────────────────────────────────────

/// FIDO2 COSE algorithm descriptor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fido2Algorithm {
    /// Algorithm type (e.g. "public-key").
    pub alg_type: String,
    /// COSE algorithm identifier (e.g. -7 for ES256, -8 for EdDSA).
    pub alg_id: i32,
}

// ── FIDO2 Device Info ───────────────────────────────────────────────

/// Information about the FIDO2 applet on a YubiKey.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fido2DeviceInfo {
    /// Supported CTAP versions.
    pub versions: Vec<String>,
    /// Supported extensions.
    pub extensions: Vec<String>,
    /// Authenticator AAGUID.
    pub aaguid: String,
    /// Authenticator options (e.g. "rk" → true).
    pub options: HashMap<String, bool>,
    /// Maximum message size.
    pub max_msg_size: u32,
    /// PIN/UV auth protocol versions supported.
    pub pin_uv_auth_protocols: Vec<u8>,
    /// Max credentials in a single getAssertion list.
    pub max_credential_count_in_list: u32,
    /// Max credential ID length in bytes.
    pub max_credential_id_length: u32,
    /// Firmware version reported via FIDO2.
    pub firmware_version: String,
    /// Remaining discoverable credential slots.
    pub remaining_discoverable_credentials: u32,
    /// Whether the authenticator is forcing a PIN change.
    pub force_pin_change: bool,
    /// Minimum PIN length requirement.
    pub min_pin_length: u32,
    /// FIDO Alliance certifications.
    pub certifications: Vec<String>,
    /// Supported public-key algorithms.
    pub algorithms: Vec<Fido2Algorithm>,
}

impl Default for Fido2DeviceInfo {
    fn default() -> Self {
        Self {
            versions: Vec::new(),
            extensions: Vec::new(),
            aaguid: String::new(),
            options: HashMap::new(),
            max_msg_size: 1200,
            pin_uv_auth_protocols: Vec::new(),
            max_credential_count_in_list: 8,
            max_credential_id_length: 128,
            firmware_version: String::new(),
            remaining_discoverable_credentials: 0,
            force_pin_change: false,
            min_pin_length: 4,
            certifications: Vec::new(),
            algorithms: Vec::new(),
        }
    }
}

// ── FIDO2 PIN Status ────────────────────────────────────────────────

/// FIDO2 PIN/UV status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fido2PinStatus {
    /// Whether a PIN has been set.
    pub pin_set: bool,
    /// PIN retry attempts remaining.
    pub pin_retries: u32,
    /// UV (biometric) retry attempts remaining (None if UV not available).
    pub uv_retries: Option<u32>,
    /// Whether a PIN change is forced on next use.
    pub force_change: bool,
    /// Minimum PIN length.
    pub min_length: u32,
}

impl Default for Fido2PinStatus {
    fn default() -> Self {
        Self {
            pin_set: false,
            pin_retries: 8,
            uv_retries: None,
            force_change: false,
            min_length: 4,
        }
    }
}

// ── OATH Types ──────────────────────────────────────────────────────

/// OATH account type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum OathType {
    Totp,
    Hotp,
}

impl OathType {
    pub fn from_str_label(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "hotp" => Self::Hotp,
            _ => Self::Totp,
        }
    }

    pub fn ykman_arg(&self) -> &str {
        match self {
            Self::Totp => "TOTP",
            Self::Hotp => "HOTP",
        }
    }
}

impl std::fmt::Display for OathType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.ykman_arg())
    }
}

/// OATH HMAC algorithm.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum OathAlgorithm {
    Sha1,
    Sha256,
    Sha512,
}

impl OathAlgorithm {
    pub fn from_str_label(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "sha256" | "sha-256" => Self::Sha256,
            "sha512" | "sha-512" => Self::Sha512,
            _ => Self::Sha1,
        }
    }

    pub fn ykman_arg(&self) -> &str {
        match self {
            Self::Sha1 => "SHA1",
            Self::Sha256 => "SHA256",
            Self::Sha512 => "SHA512",
        }
    }
}

impl std::fmt::Display for OathAlgorithm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.ykman_arg())
    }
}

/// An OATH account stored on the YubiKey.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OathAccount {
    /// Issuer (e.g. "GitHub").
    pub issuer: String,
    /// Account name (e.g. "user@example.com").
    pub name: String,
    /// TOTP or HOTP.
    pub oath_type: OathType,
    /// HMAC algorithm.
    pub algorithm: OathAlgorithm,
    /// Number of digits (6 or 8).
    pub digits: u8,
    /// Period in seconds (TOTP only).
    pub period: u32,
    /// Whether touch is required to calculate.
    pub touch_required: bool,
    /// Unique credential identifier on device.
    pub credential_id: String,
}

/// A calculated OATH code.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OathCode {
    /// The OTP code string.
    pub code: String,
    /// Unix timestamp from which this code is valid.
    pub valid_from: u64,
    /// Unix timestamp until which this code is valid.
    pub valid_to: u64,
    /// Whether touch was required.
    pub touch_required: bool,
}

// ── OTP Types ───────────────────────────────────────────────────────

/// OTP slot (the physical touch zones).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum OtpSlot {
    /// Short press (slot 1).
    Short,
    /// Long press (slot 2).
    Long,
}

impl OtpSlot {
    pub fn from_str_label(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "2" | "long" => Self::Long,
            _ => Self::Short,
        }
    }

    pub fn ykman_arg(&self) -> &str {
        match self {
            Self::Short => "1",
            Self::Long => "2",
        }
    }
}

impl std::fmt::Display for OtpSlot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Short => write!(f, "Slot 1 (Short)"),
            Self::Long => write!(f, "Slot 2 (Long)"),
        }
    }
}

/// What is programmed into an OTP slot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum OtpSlotType {
    YubicoOtp,
    ChallengeResponse,
    StaticPassword,
    HotpOath,
}

impl OtpSlotType {
    pub fn from_str_label(s: &str) -> Option<Self> {
        let lower = s.to_lowercase();
        if lower.contains("yubico otp") || lower.contains("yubicootp") {
            Some(Self::YubicoOtp)
        } else if lower.contains("challenge") || lower.contains("hmac-sha1") {
            Some(Self::ChallengeResponse)
        } else if lower.contains("static") {
            Some(Self::StaticPassword)
        } else if lower.contains("hotp") {
            Some(Self::HotpOath)
        } else {
            None
        }
    }
}

/// Configuration of a single OTP slot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OtpSlotConfig {
    /// Which slot.
    pub slot: OtpSlot,
    /// Whether the slot is programmed.
    pub configured: bool,
    /// What type of credential is stored (None if empty).
    pub slot_type: Option<OtpSlotType>,
    /// Whether touch is required to activate.
    pub require_touch: bool,
}

impl Default for OtpSlotConfig {
    fn default() -> Self {
        Self {
            slot: OtpSlot::Short,
            configured: false,
            slot_type: None,
            require_touch: false,
        }
    }
}

// ── Audit ───────────────────────────────────────────────────────────

/// Actions that can be audited for YubiKey operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum YubiKeyAuditAction {
    DeviceDetected,
    DeviceRemoved,
    PivGenerate,
    PivImport,
    PivSign,
    PivDecrypt,
    PivChangePIN,
    PivChangePUK,
    PivResetPIV,
    FidoRegister,
    FidoAuthenticate,
    FidoDeleteCredential,
    FidoSetPIN,
    FidoResetFIDO,
    OathAdd,
    OathDelete,
    OathCalculate,
    OathSetPassword,
    OathResetOATH,
    OtpConfigure,
    OtpSwap,
    OtpDelete,
    ConfigUpdate,
    FactoryReset,
}

/// A single audit log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YubiKeyAuditEntry {
    /// Unique entry ID.
    pub id: String,
    /// ISO-8601 timestamp.
    pub timestamp: String,
    /// What action was performed.
    pub action: YubiKeyAuditAction,
    /// Serial number of the device involved (if known).
    pub serial: Option<u32>,
    /// Human-readable details.
    pub details: String,
    /// Whether the operation succeeded.
    pub success: bool,
    /// Error message (if the operation failed).
    pub error: Option<String>,
}

// ── App-level Config ────────────────────────────────────────────────

/// Application-level YubiKey configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YubiKeyConfig {
    /// Automatically detect YubiKeys on startup.
    pub auto_detect: bool,
    /// Polling interval for device changes (ms).
    pub poll_interval_ms: u64,
    /// Explicit path to `ykman` binary (None = search PATH).
    pub ykman_path: Option<String>,
    /// Default algorithm for PIV key generation.
    pub piv_default_algorithm: PivAlgorithm,
    /// Default PIN policy for PIV key generation.
    pub piv_default_pin_policy: PinPolicy,
    /// Default touch policy for PIV key generation.
    pub piv_default_touch_policy: TouchPolicy,
    /// Default OATH algorithm.
    pub oath_default_algorithm: OathAlgorithm,
    /// Default OATH digit count.
    pub oath_default_digits: u8,
    /// Default OATH period (seconds).
    pub oath_default_period: u32,
    /// Whether to prefer user-verification for FIDO2.
    pub fido2_uv_preferred: bool,
    /// Automatically generate attestation after key generation.
    pub auto_generate_attestation: bool,
    /// Require touch for all cryptographic operations.
    pub require_touch_for_crypto: bool,
}

impl Default for YubiKeyConfig {
    fn default() -> Self {
        Self {
            auto_detect: true,
            poll_interval_ms: 5000,
            ykman_path: None,
            piv_default_algorithm: PivAlgorithm::EcP256,
            piv_default_pin_policy: PinPolicy::Default,
            piv_default_touch_policy: TouchPolicy::Default,
            oath_default_algorithm: OathAlgorithm::Sha256,
            oath_default_digits: 6,
            oath_default_period: 30,
            fido2_uv_preferred: true,
            auto_generate_attestation: false,
            require_touch_for_crypto: false,
        }
    }
}

// ── Attestation ─────────────────────────────────────────────────────

/// Result of a PIV attestation operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestationResult {
    /// The slot that was attested.
    pub slot: PivSlot,
    /// Device certificate PEM (from the attestation intermediate).
    pub device_certificate_pem: String,
    /// Attestation certificate PEM (chain link).
    pub attestation_certificate_pem: String,
    /// Device serial number.
    pub serial: u32,
    /// Firmware version.
    pub firmware_version: String,
    /// PIN policy in effect.
    pub pin_policy: PinPolicy,
    /// Touch policy in effect.
    pub touch_policy: TouchPolicy,
    /// Form factor of the attesting device.
    pub form_factor: FormFactor,
    /// Whether the device is FIPS.
    pub is_fips: bool,
    /// Whether the key was generated on the device.
    pub generated_on_device: bool,
}

// ── CSR Parameters ──────────────────────────────────────────────────

/// Parameters for generating a Certificate Signing Request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsrParams {
    pub common_name: String,
    pub organization: Option<String>,
    pub organizational_unit: Option<String>,
    pub locality: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
    pub email: Option<String>,
    pub san: Vec<String>,
}

// ── Service State ───────────────────────────────────────────────────

/// Shared YubiKey service state for Tauri commands.
pub type YubiKeyServiceState = Arc<tokio::sync::Mutex<crate::service::YubiKeyService>>;

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_form_factor_parsing() {
        assert_eq!(
            FormFactor::from_str_label("YubiKey 5 NFC USB-A Keychain"),
            FormFactor::UsbAKeychain
        );
        assert_eq!(
            FormFactor::from_str_label("YubiKey 5C Nano"),
            FormFactor::UsbCNano
        );
        assert_eq!(
            FormFactor::from_str_label("YubiKey 5Ci Lightning USB-C"),
            FormFactor::UsbCLightning
        );
        assert_eq!(
            FormFactor::from_str_label("YubiKey Bio USB-C"),
            FormFactor::UsbCBio
        );
        assert_eq!(
            FormFactor::from_str_label("something unknown"),
            FormFactor::Unknown
        );
    }

    #[test]
    fn test_piv_slot_hex_roundtrip() {
        let slots = vec![
            PivSlot::Authentication,
            PivSlot::Signature,
            PivSlot::KeyManagement,
            PivSlot::CardAuthentication,
            PivSlot::Retired1,
            PivSlot::Retired20,
            PivSlot::Attestation,
        ];
        for slot in slots {
            let hex = slot.hex_id();
            let parsed = PivSlot::from_hex(hex).unwrap();
            assert_eq!(parsed, slot);
        }
    }

    #[test]
    fn test_piv_algorithm_parsing() {
        assert_eq!(PivAlgorithm::from_str_label("RSA2048"), PivAlgorithm::Rsa2048);
        assert_eq!(PivAlgorithm::from_str_label("ECCP256"), PivAlgorithm::EcP256);
        assert_eq!(PivAlgorithm::from_str_label("ECCP384"), PivAlgorithm::EcP384);
        assert_eq!(PivAlgorithm::from_str_label("Ed25519"), PivAlgorithm::Ed25519);
    }

    #[test]
    fn test_pin_policy_roundtrip() {
        let policies = vec![
            PinPolicy::Default,
            PinPolicy::Never,
            PinPolicy::Once,
            PinPolicy::Always,
        ];
        for p in policies {
            let arg = p.ykman_arg();
            let parsed = PinPolicy::from_str_label(arg);
            assert_eq!(parsed, p);
        }
    }

    #[test]
    fn test_touch_policy_roundtrip() {
        let policies = vec![
            TouchPolicy::Default,
            TouchPolicy::Never,
            TouchPolicy::Always,
            TouchPolicy::Cached,
        ];
        for p in policies {
            let arg = p.ykman_arg();
            let parsed = TouchPolicy::from_str_label(arg);
            assert_eq!(parsed, p);
        }
    }

    #[test]
    fn test_interface_parsing() {
        assert_eq!(
            YubiKeyInterface::from_str_label("OTP"),
            Some(YubiKeyInterface::Otp)
        );
        assert_eq!(
            YubiKeyInterface::from_str_label("FIDO2"),
            Some(YubiKeyInterface::Fido)
        );
        assert_eq!(
            YubiKeyInterface::from_str_label("CCID"),
            Some(YubiKeyInterface::Ccid)
        );
        assert_eq!(YubiKeyInterface::from_str_label("BLAH"), None);
    }

    #[test]
    fn test_oath_type_parsing() {
        assert_eq!(OathType::from_str_label("TOTP"), OathType::Totp);
        assert_eq!(OathType::from_str_label("hotp"), OathType::Hotp);
    }

    #[test]
    fn test_oath_algorithm_parsing() {
        assert_eq!(OathAlgorithm::from_str_label("SHA1"), OathAlgorithm::Sha1);
        assert_eq!(OathAlgorithm::from_str_label("SHA256"), OathAlgorithm::Sha256);
        assert_eq!(OathAlgorithm::from_str_label("sha512"), OathAlgorithm::Sha512);
    }

    #[test]
    fn test_otp_slot_parsing() {
        assert_eq!(OtpSlot::from_str_label("1"), OtpSlot::Short);
        assert_eq!(OtpSlot::from_str_label("2"), OtpSlot::Long);
        assert_eq!(OtpSlot::from_str_label("long"), OtpSlot::Long);
    }

    #[test]
    fn test_otp_slot_type_parsing() {
        assert_eq!(
            OtpSlotType::from_str_label("Yubico OTP"),
            Some(OtpSlotType::YubicoOtp)
        );
        assert_eq!(
            OtpSlotType::from_str_label("Challenge-Response (HMAC-SHA1)"),
            Some(OtpSlotType::ChallengeResponse)
        );
        assert_eq!(
            OtpSlotType::from_str_label("Static Password"),
            Some(OtpSlotType::StaticPassword)
        );
        assert_eq!(
            OtpSlotType::from_str_label("HOTP"),
            Some(OtpSlotType::HotpOath)
        );
        assert_eq!(OtpSlotType::from_str_label("?"), None);
    }

    #[test]
    fn test_management_key_type_parsing() {
        assert_eq!(
            ManagementKeyType::from_str_label("AES256"),
            ManagementKeyType::Aes256
        );
        assert_eq!(
            ManagementKeyType::from_str_label("3des"),
            ManagementKeyType::TripleDes
        );
    }

    #[test]
    fn test_yubikey_config_defaults() {
        let cfg = YubiKeyConfig::default();
        assert!(cfg.auto_detect);
        assert_eq!(cfg.poll_interval_ms, 5000);
        assert_eq!(cfg.oath_default_digits, 6);
        assert_eq!(cfg.oath_default_period, 30);
        assert!(cfg.fido2_uv_preferred);
    }

    #[test]
    fn test_piv_pin_status_defaults() {
        let status = PivPinStatus::default();
        assert_eq!(status.pin_attempts_remaining, 3);
        assert!(status.pin_is_default);
        assert_eq!(status.management_key_type, ManagementKeyType::TripleDes);
    }

    #[test]
    fn test_fido2_pin_status_defaults() {
        let status = Fido2PinStatus::default();
        assert!(!status.pin_set);
        assert_eq!(status.pin_retries, 8);
        assert_eq!(status.min_length, 4);
    }

    #[test]
    fn test_device_default() {
        let device = YubiKeyDevice::default();
        assert_eq!(device.serial, 0);
        assert_eq!(device.form_factor, FormFactor::Unknown);
        assert!(!device.has_nfc);
        assert!(!device.is_fips);
    }
}
