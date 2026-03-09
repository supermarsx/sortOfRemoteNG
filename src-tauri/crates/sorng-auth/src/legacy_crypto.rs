//! # Legacy Cryptography Policy
//!
//! Centralised configuration for legacy / deprecated cipher suites,
//! key algorithms, and protocol options.  **Everything here is disabled
//! by default.**  Callers must explicitly opt-in by enabling the
//! relevant flags in [`LegacyCryptoPolicy`].
//!
//! ## Why?
//!
//! Some environments still run equipment that only supports outdated
//! ciphers (e.g. RSA-1024, 3DES-CBC, `diffie-hellman-group1-sha1`).
//! Rather than silently using broken algorithms, we expose them behind
//! a clearly-marked policy gate that can be audited and toggled by
//! administrators.
//!
//! ## Security Warning
//!
//! Enabling any of these options **weakens security**.  They exist
//! solely for backward-compatible interop with legacy infrastructure
//! and should be disabled as soon as the remote side is upgraded.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Policy — all fields default to `false` / empty
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Master policy governing which legacy algorithms are permitted.
///
/// Persisted as part of the application settings.  Every field defaults
/// to the *safe* value (disabled / empty).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCryptoPolicy {
    // ── Certificate / Key Generation ────────────────────────────────
    /// Allow generating RSA-1024 key pairs (NIST deprecated 2013).
    #[serde(default)]
    pub allow_rsa_1024: bool,

    /// Allow generating DSA / DSS key pairs (NIST deprecated 2023, FIPS 186-5
    /// removes DSA entirely).
    #[serde(default)]
    pub allow_dsa: bool,

    /// Allow SHA-1 signature hash for **self-signed / internal** certificates.
    /// Note: SHA-1 for X.509 signatures has been broken since SHAttered (2017).
    /// rcgen 0.12 does not expose SHA-1 algorithms, so this gate only affects
    /// informational tagging and future importers.
    #[serde(default)]
    pub allow_sha1_signatures: bool,

    // ── SSH Transport Ciphers ───────────────────────────────────────
    /// Allow CBC-mode ciphers (aes128-cbc, aes256-cbc, 3des-cbc).
    /// CBC is vulnerable to plaintext-recovery attacks (Bellare et al, 2004).
    #[serde(default)]
    pub allow_cbc_ciphers: bool,

    /// Allow arcfour / RC4 stream cipher.
    /// RC4 is fully broken — IETF RFC 7465 prohibits it in TLS.
    #[serde(default)]
    pub allow_arcfour: bool,

    /// Allow 3DES (168-bit effective key, ~112-bit security, sweet32 attack).
    #[serde(default)]
    pub allow_3des: bool,

    /// Allow Blowfish-CBC.
    #[serde(default)]
    pub allow_blowfish: bool,

    /// Allow CAST128-CBC.
    #[serde(default)]
    pub allow_cast128: bool,

    // ── SSH Key Exchange ────────────────────────────────────────────
    /// Allow `diffie-hellman-group1-sha1` (1024-bit DH, SHA-1).
    /// Both the group size and the hash are considered weak.
    #[serde(default)]
    pub allow_dh_group1_sha1: bool,

    /// Allow `diffie-hellman-group14-sha1` (2048-bit DH, SHA-1).
    /// The DH group is fine; the SHA-1 hash is the weak link.
    #[serde(default)]
    pub allow_dh_group14_sha1: bool,

    /// Allow `diffie-hellman-group-exchange-sha1`.
    #[serde(default)]
    pub allow_dh_gex_sha1: bool,

    // ── SSH MACs ────────────────────────────────────────────────────
    /// Allow `hmac-sha1` and `hmac-sha1-96` MACs.
    /// SHA-1 HMAC is not as critically broken as SHA-1 signatures, but
    /// it is deprecated in favour of SHA-2 / ETM variants.
    #[serde(default)]
    pub allow_hmac_sha1: bool,

    /// Allow `hmac-md5` and `hmac-md5-96` MACs.
    #[serde(default)]
    pub allow_hmac_md5: bool,

    // ── SSH Host Key Algorithms ─────────────────────────────────────
    /// Allow `ssh-dss` (DSA) host keys.
    #[serde(default)]
    pub allow_ssh_dss_host_key: bool,

    /// Allow `ssh-rsa` (RSA with SHA-1 signature) host key algorithm.
    /// Modern servers use `rsa-sha2-256` / `rsa-sha2-512` instead.
    #[serde(default)]
    pub allow_ssh_rsa_sha1_host_key: bool,

    // ── SSL / TLS (for HTTPS proxies, FTPS, etc.) ───────────────────
    /// Allow SSL 3.0 connections.  SSL 3.0 is fundamentally broken by the
    /// POODLE attack (CVE-2014-3566) and was formally deprecated by
    /// RFC 7568 (June 2015).  No modern software should use it, but some
    /// very old embedded devices (printers, industrial PLCs, legacy IPMI/
    /// iLO/DRAC consoles) may still require it.
    #[serde(default)]
    pub allow_ssl_3_0: bool,

    /// Allow TLS 1.0 connections (PCI-DSS prohibits since June 2018).
    #[serde(default)]
    pub allow_tls_1_0: bool,

    /// Allow TLS 1.1 connections (deprecated by RFC 8996, March 2021).
    #[serde(default)]
    pub allow_tls_1_1: bool,

    /// Allow TLS cipher suites using 3DES (TLS_RSA_WITH_3DES_EDE_CBC_SHA, etc.).
    #[serde(default)]
    pub allow_tls_3des: bool,

    /// Allow TLS cipher suites using RC4.
    #[serde(default)]
    pub allow_tls_rc4: bool,

    /// Allow TLS cipher suites without forward secrecy (RSA key exchange).
    #[serde(default)]
    pub allow_tls_static_rsa: bool,

    // ── Global guard ────────────────────────────────────────────────
    /// When `false` (default), *all* legacy options above are forcibly
    /// ignored regardless of their individual settings.  The operator
    /// must first set this to `true` to acknowledge the security impact.
    #[serde(default)]
    pub legacy_mode_acknowledged: bool,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Computed algorithm lists
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

impl LegacyCryptoPolicy {
    /// Is legacy mode actually active?  Requires the global guard **and**
    /// at least one individual flag to be set.
    pub fn is_active(&self) -> bool {
        self.legacy_mode_acknowledged && self.has_any_legacy_enabled()
    }

    /// Returns `true` if any individual legacy flag is turned on.
    fn has_any_legacy_enabled(&self) -> bool {
        self.allow_rsa_1024
            || self.allow_dsa
            || self.allow_sha1_signatures
            || self.allow_cbc_ciphers
            || self.allow_arcfour
            || self.allow_3des
            || self.allow_blowfish
            || self.allow_cast128
            || self.allow_dh_group1_sha1
            || self.allow_dh_group14_sha1
            || self.allow_dh_gex_sha1
            || self.allow_hmac_sha1
            || self.allow_hmac_md5
            || self.allow_ssh_dss_host_key
            || self.allow_ssh_rsa_sha1_host_key
            || self.allow_ssl_3_0
            || self.allow_tls_1_0
            || self.allow_tls_1_1
            || self.allow_tls_3des
            || self.allow_tls_rc4
            || self.allow_tls_static_rsa
    }

    // ── SSH cipher list builders ────────────────────────────────────

    /// Build the list of allowed SSH encryption ciphers.
    ///
    /// Always includes the modern defaults.  Legacy ciphers are appended
    /// only when legacy mode is acknowledged **and** the individual gate
    /// is enabled.
    pub fn ssh_ciphers(&self) -> Vec<&'static str> {
        let mut ciphers = vec![
            // Modern (always enabled)
            "chacha20-poly1305@openssh.com",
            "aes128-gcm@openssh.com",
            "aes256-gcm@openssh.com",
            "aes128-ctr",
            "aes192-ctr",
            "aes256-ctr",
        ];

        if self.legacy_mode_acknowledged {
            if self.allow_cbc_ciphers {
                ciphers.push("aes128-cbc");
                ciphers.push("aes192-cbc");
                ciphers.push("aes256-cbc");
            }
            if self.allow_3des {
                ciphers.push("3des-cbc");
            }
            if self.allow_blowfish {
                ciphers.push("blowfish-cbc");
            }
            if self.allow_cast128 {
                ciphers.push("cast128-cbc");
            }
            if self.allow_arcfour {
                ciphers.push("arcfour");
                ciphers.push("arcfour128");
                ciphers.push("arcfour256");
            }
        }

        ciphers
    }

    /// Build the list of allowed SSH key exchange algorithms.
    pub fn ssh_kex(&self) -> Vec<&'static str> {
        let mut kex = vec![
            // Modern (always enabled)
            "curve25519-sha256",
            "curve25519-sha256@libssh.org",
            "ecdh-sha2-nistp256",
            "ecdh-sha2-nistp384",
            "ecdh-sha2-nistp521",
            "diffie-hellman-group16-sha512",
            "diffie-hellman-group18-sha512",
            "diffie-hellman-group14-sha256",
            "diffie-hellman-group-exchange-sha256",
        ];

        if self.legacy_mode_acknowledged {
            if self.allow_dh_group14_sha1 {
                kex.push("diffie-hellman-group14-sha1");
            }
            if self.allow_dh_group1_sha1 {
                kex.push("diffie-hellman-group1-sha1");
            }
            if self.allow_dh_gex_sha1 {
                kex.push("diffie-hellman-group-exchange-sha1");
            }
        }

        kex
    }

    /// Build the list of allowed SSH MAC algorithms.
    pub fn ssh_macs(&self) -> Vec<&'static str> {
        let mut macs = vec![
            // Modern (always enabled) — ETM variants preferred
            "hmac-sha2-256-etm@openssh.com",
            "hmac-sha2-512-etm@openssh.com",
            "umac-128-etm@openssh.com",
            "hmac-sha2-256",
            "hmac-sha2-512",
            "umac-128@openssh.com",
        ];

        if self.legacy_mode_acknowledged {
            if self.allow_hmac_sha1 {
                macs.push("hmac-sha1");
                macs.push("hmac-sha1-96");
                macs.push("hmac-sha1-etm@openssh.com");
            }
            if self.allow_hmac_md5 {
                macs.push("hmac-md5");
                macs.push("hmac-md5-96");
            }
        }

        macs
    }

    /// Build the list of allowed SSH host key algorithms.
    pub fn ssh_host_key_algorithms(&self) -> Vec<&'static str> {
        let mut algos = vec![
            // Modern (always enabled)
            "ssh-ed25519",
            "ecdsa-sha2-nistp256",
            "ecdsa-sha2-nistp384",
            "ecdsa-sha2-nistp521",
            "rsa-sha2-512",
            "rsa-sha2-256",
        ];

        if self.legacy_mode_acknowledged {
            if self.allow_ssh_rsa_sha1_host_key {
                algos.push("ssh-rsa");
            }
            if self.allow_ssh_dss_host_key {
                algos.push("ssh-dss");
            }
        }

        algos
    }

    /// Build the list of allowed SSH key types for key generation.
    pub fn ssh_keygen_types(&self) -> Vec<&'static str> {
        let mut types = vec!["ed25519", "ecdsa", "rsa"];

        if self.legacy_mode_acknowledged && self.allow_dsa {
            types.push("dsa");
        }

        types
    }

    /// Build the list of allowed certificate key algorithms.
    pub fn cert_key_algorithms(&self) -> Vec<&'static str> {
        let mut algos = vec![
            "rsa2048",
            "rsa3072",
            "rsa4096",
            "rsa8192",
            "ecdsa-p256",
            "ecdsa-p384",
            "ed25519",
        ];

        if self.legacy_mode_acknowledged && self.allow_rsa_1024 {
            algos.push("rsa1024");
        }

        algos
    }

    /// Return a human-readable summary of all currently enabled legacy options.
    /// Empty list ⟹ no legacy crypto active.
    pub fn active_legacy_warnings(&self) -> Vec<LegacyWarning> {
        let mut warnings = Vec::new();

        if !self.legacy_mode_acknowledged {
            return warnings;
        }

        macro_rules! warn {
            ($flag:expr, $id:expr, $sev:expr, $msg:expr) => {
                if $flag {
                    warnings.push(LegacyWarning {
                        id: $id.into(),
                        severity: $sev,
                        message: $msg.into(),
                    });
                }
            };
        }

        warn!(
            self.allow_rsa_1024,
            "rsa1024",
            WarningSeverity::Critical,
            "RSA-1024 keys can be factored — NIST deprecated since 2013"
        );
        warn!(
            self.allow_dsa,
            "dsa",
            WarningSeverity::Critical,
            "DSA removed from FIPS 186-5 — use Ed25519 or ECDSA instead"
        );
        warn!(
            self.allow_sha1_signatures,
            "sha1-sig",
            WarningSeverity::High,
            "SHA-1 signatures are collision-vulnerable (SHAttered, 2017)"
        );
        warn!(
            self.allow_cbc_ciphers,
            "cbc",
            WarningSeverity::Medium,
            "CBC ciphers are vulnerable to plaintext-recovery attacks"
        );
        warn!(
            self.allow_arcfour,
            "arcfour",
            WarningSeverity::Critical,
            "RC4/arcfour is fully broken — prohibited by RFC 7465"
        );
        warn!(
            self.allow_3des,
            "3des",
            WarningSeverity::High,
            "3DES has only ~112-bit security and is vulnerable to Sweet32"
        );
        warn!(
            self.allow_blowfish,
            "blowfish",
            WarningSeverity::Medium,
            "Blowfish has a 64-bit block size — vulnerable to birthday attacks"
        );
        warn!(
            self.allow_cast128,
            "cast128",
            WarningSeverity::Medium,
            "CAST-128 has a 64-bit block size — vulnerable to birthday attacks"
        );
        warn!(
            self.allow_dh_group1_sha1,
            "dh-group1",
            WarningSeverity::Critical,
            "DH group1 uses 1024-bit prime + SHA-1 — both are weak"
        );
        warn!(
            self.allow_dh_group14_sha1,
            "dh-group14-sha1",
            WarningSeverity::Medium,
            "DH group14-sha1 uses SHA-1 hash — prefer group14-sha256"
        );
        warn!(
            self.allow_dh_gex_sha1,
            "dh-gex-sha1",
            WarningSeverity::Medium,
            "DH group-exchange with SHA-1 — prefer SHA-256 variant"
        );
        warn!(
            self.allow_hmac_sha1,
            "hmac-sha1",
            WarningSeverity::Low,
            "HMAC-SHA1 is not critically broken but deprecated for SHA-2"
        );
        warn!(
            self.allow_hmac_md5,
            "hmac-md5",
            WarningSeverity::High,
            "MD5 is fundamentally broken — known collision attacks since 2004"
        );
        warn!(
            self.allow_ssh_dss_host_key,
            "ssh-dss",
            WarningSeverity::Critical,
            "DSA host keys use 1024-bit keys only — trivially weak"
        );
        warn!(
            self.allow_ssh_rsa_sha1_host_key,
            "ssh-rsa-sha1",
            WarningSeverity::Medium,
            "ssh-rsa uses SHA-1 signatures — prefer rsa-sha2-256/512"
        );
        warn!(
            self.allow_ssl_3_0,
            "ssl30",
            WarningSeverity::Critical,
            "SSL 3.0 is broken beyond repair — POODLE (CVE-2014-3566), deprecated by RFC 7568"
        );
        warn!(
            self.allow_tls_1_0,
            "tls10",
            WarningSeverity::High,
            "TLS 1.0 prohibited by PCI-DSS — POODLE/BEAST attacks"
        );
        warn!(
            self.allow_tls_1_1,
            "tls11",
            WarningSeverity::High,
            "TLS 1.1 deprecated by RFC 8996"
        );
        warn!(
            self.allow_tls_3des,
            "tls-3des",
            WarningSeverity::High,
            "TLS 3DES suites vulnerable to Sweet32"
        );
        warn!(
            self.allow_tls_rc4,
            "tls-rc4",
            WarningSeverity::Critical,
            "TLS RC4 prohibited by RFC 7465"
        );
        warn!(
            self.allow_tls_static_rsa,
            "tls-static-rsa",
            WarningSeverity::Medium,
            "Static RSA key exchange lacks forward secrecy"
        );

        warnings
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Warning types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WarningSeverity {
    /// Informational only.
    Low,
    /// Should be fixed, but low immediate risk.
    Medium,
    /// Significant security weakness.
    High,
    /// Actively exploitable / fully broken.
    Critical,
}

/// A single legacy-crypto warning.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LegacyWarning {
    /// Short machine-readable identifier.
    pub id: String,
    /// Severity level.
    pub severity: WarningSeverity,
    /// Human-readable description of the risk.
    pub message: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Service state (Tauri-managed)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

pub type LegacyCryptoPolicyState = Arc<Mutex<LegacyCryptoPolicy>>;

/// Create a new default (everything-disabled) policy state.
pub fn new_policy_state() -> LegacyCryptoPolicyState {
    Arc::new(Mutex::new(LegacyCryptoPolicy::default()))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tauri commands
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Get the current legacy crypto policy.
#[tauri::command]
pub async fn get_legacy_crypto_policy(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
) -> Result<LegacyCryptoPolicy, String> {
    Ok(state.lock().await.clone())
}

/// Update the legacy crypto policy.
#[tauri::command]
pub async fn set_legacy_crypto_policy(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
    policy: LegacyCryptoPolicy,
) -> Result<(), String> {
    let mut current = state.lock().await;
    *current = policy;
    Ok(())
}

/// Get warnings for currently enabled legacy options.
#[tauri::command]
pub async fn get_legacy_crypto_warnings(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
) -> Result<Vec<LegacyWarning>, String> {
    Ok(state.lock().await.active_legacy_warnings())
}

/// Get the SSH cipher list derived from the current policy.
#[tauri::command]
pub async fn get_legacy_ssh_ciphers(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
) -> Result<Vec<String>, String> {
    Ok(state
        .lock()
        .await
        .ssh_ciphers()
        .into_iter()
        .map(String::from)
        .collect())
}

/// Get the SSH KEX list derived from the current policy.
#[tauri::command]
pub async fn get_legacy_ssh_kex(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
) -> Result<Vec<String>, String> {
    Ok(state
        .lock()
        .await
        .ssh_kex()
        .into_iter()
        .map(String::from)
        .collect())
}

/// Get the SSH MAC list derived from the current policy.
#[tauri::command]
pub async fn get_legacy_ssh_macs(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
) -> Result<Vec<String>, String> {
    Ok(state
        .lock()
        .await
        .ssh_macs()
        .into_iter()
        .map(String::from)
        .collect())
}

/// Get the SSH host-key algorithm list derived from the current policy.
#[tauri::command]
pub async fn get_legacy_ssh_host_key_algorithms(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
) -> Result<Vec<String>, String> {
    Ok(state
        .lock()
        .await
        .ssh_host_key_algorithms()
        .into_iter()
        .map(String::from)
        .collect())
}

/// Check whether a specific key algorithm is currently allowed.
#[tauri::command]
pub async fn is_legacy_algorithm_allowed(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
    algorithm: String,
) -> Result<bool, String> {
    let policy = state.lock().await;
    let allowed = match algorithm.to_lowercase().as_str() {
        "rsa1024" | "rsa-1024" => policy.legacy_mode_acknowledged && policy.allow_rsa_1024,
        "dsa" | "dss" | "ssh-dss" => policy.legacy_mode_acknowledged && policy.allow_dsa,
        "sha1" | "sha-1" => policy.legacy_mode_acknowledged && policy.allow_sha1_signatures,
        "3des" | "3des-cbc" => policy.legacy_mode_acknowledged && policy.allow_3des,
        "arcfour" | "rc4" => policy.legacy_mode_acknowledged && policy.allow_arcfour,
        "blowfish" | "blowfish-cbc" => policy.legacy_mode_acknowledged && policy.allow_blowfish,
        "cast128" | "cast128-cbc" => policy.legacy_mode_acknowledged && policy.allow_cast128,
        "cbc" => policy.legacy_mode_acknowledged && policy.allow_cbc_ciphers,
        "dh-group1-sha1" => policy.legacy_mode_acknowledged && policy.allow_dh_group1_sha1,
        "dh-group14-sha1" => policy.legacy_mode_acknowledged && policy.allow_dh_group14_sha1,
        "hmac-sha1" => policy.legacy_mode_acknowledged && policy.allow_hmac_sha1,
        "hmac-md5" => policy.legacy_mode_acknowledged && policy.allow_hmac_md5,
        "ssl3" | "ssl3.0" | "ssl30" | "sslv3" => {
            policy.legacy_mode_acknowledged && policy.allow_ssl_3_0
        }
        "tls1.0" | "tls10" => policy.legacy_mode_acknowledged && policy.allow_tls_1_0,
        "tls1.1" | "tls11" => policy.legacy_mode_acknowledged && policy.allow_tls_1_1,
        _ => false,
    };
    Ok(allowed)
}
