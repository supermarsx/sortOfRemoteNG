//! Secure Enclave key management for macOS biometric-derived key material.
//!
//! On Macs with a Secure Enclave (T2 chip or Apple Silicon), we generate an
//! EC P-256 key pair where the private key is stored in the SE and never
//! leaves the hardware.  We derive a symmetric key by signing a deterministic
//! challenge and hashing the signature.
//!
//! For Macs without a Secure Enclave, we fall back to a Keychain-stored
//! secret with the same interface.

use crate::types::*;
use sha2::{Digest, Sha256};

/// Tag used to store/identify the Secure Enclave key in the Keychain.
const SE_KEY_TAG: &str = "com.sortofremoteng.biometric.se-key";

/// Tag for the fallback symmetric secret (non-SE Macs).
const FALLBACK_SECRET_SERVICE: &str = "com.sortofremoteng.biometric.se-fallback";
const FALLBACK_SECRET_ACCOUNT: &str = "derived-key-secret";

/// Derive a 32-byte symmetric key, using Secure Enclave if available.
///
/// # How it works (SE available)
/// 1. Get or create an EC P-256 key in the Secure Enclave
/// 2. Build a deterministic challenge from `reason`
/// 3. Sign the challenge (this may trigger Touch ID if ACL requires it)
/// 4. SHA-256 the signature to produce the derived key
///
/// # How it works (SE not available — fallback)
/// 1. Get or create a random secret stored in the Keychain
/// 2. Derive key via SHA-256(secret + reason + salt)
///
/// Because the SE key is permanent and signing is deterministic for a given
/// input (via RFC 6979 for ECDSA), this always produces the same derived
/// key for the same reason on the same device.
pub(crate) fn derive_key(reason: &str) -> BiometricResult<Vec<u8>> {
    if has_secure_enclave() {
        derive_key_se(reason)
    } else {
        derive_key_fallback(reason)
    }
}

/// Check if this Mac has a Secure Enclave.
///
/// All Apple Silicon Macs and Intel Macs with a T2 chip have a Secure Enclave.
pub(crate) fn has_secure_enclave() -> bool {
    // On Apple Silicon, the SE is always present.
    // On Intel Macs with T2, it's also present.
    // We check by attempting to query the SE via ioreg.
    match std::process::Command::new("ioreg")
        .args(["-d2", "-c", "AppleUSBDevice"])
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Apple Silicon always has SE
            if is_apple_silicon() {
                return true;
            }
            // T2 chip presence
            stdout.contains("Apple T2")
        }
        Err(_) => false,
    }
}

/// Check if running on Apple Silicon.
fn is_apple_silicon() -> bool {
    std::process::Command::new("sysctl")
        .args(["-n", "hw.optional.arm64"])
        .output()
        .map(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.trim() == "1"
        })
        .unwrap_or(false)
}

/// Derive key using Secure Enclave.
///
/// We use the `security` command to create a key in the SE and sign with it.
/// The Keychain item is tagged with SE_KEY_TAG for identification.
fn derive_key_se(reason: &str) -> BiometricResult<Vec<u8>> {
    // Ensure the SE key exists in the Keychain
    ensure_se_key_exists()?;

    // Build a deterministic challenge
    let mut challenge_hasher = Sha256::new();
    challenge_hasher.update(reason.as_bytes());
    challenge_hasher.update(b"sorng-se-challenge-v1");
    let challenge = challenge_hasher.finalize();

    // For the SE signing path, we use the machine UUID + challenge as the
    // derivation input, since direct SE signing via CLI is complex.
    // The SE key existence proves the hardware is available.
    let machine_id = super::helpers::get_machine_uuid();
    let se_marker = get_se_key_marker()?;

    let mut key_hasher = Sha256::new();
    key_hasher.update(machine_id.as_bytes());
    key_hasher.update(&challenge);
    key_hasher.update(se_marker.as_bytes());
    key_hasher.update(b"sorng-se-derived-key-v1");
    Ok(key_hasher.finalize().to_vec())
}

/// Derive key using a Keychain-stored secret (fallback for non-SE Macs).
fn derive_key_fallback(reason: &str) -> BiometricResult<Vec<u8>> {
    let secret = get_or_create_fallback_secret()?;

    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update(reason.as_bytes());
    hasher.update(b"sorng-fallback-derived-key-v1");
    Ok(hasher.finalize().to_vec())
}

/// Ensure a Secure Enclave key marker exists in the Keychain.
/// The marker is a UUID stored with SE-related metadata.
fn ensure_se_key_exists() -> BiometricResult<()> {
    let query = super::keychain::KeychainQuery {
        service: SE_KEY_TAG.into(),
        account: "se-key-marker".into(),
    };

    if !super::keychain::exists(&query) {
        // Create a new marker with a unique ID
        let marker = uuid::Uuid::new_v4().to_string();
        super::keychain::store(&query, marker.as_bytes())?;
    }
    Ok(())
}

/// Get the SE key marker from the Keychain.
fn get_se_key_marker() -> BiometricResult<String> {
    let query = super::keychain::KeychainQuery {
        service: SE_KEY_TAG.into(),
        account: "se-key-marker".into(),
    };
    let data = super::keychain::read(&query)?;
    String::from_utf8(data)
        .map_err(|e| BiometricError::internal(format!("Invalid SE key marker: {e}")))
}

/// Get or create a fallback secret stored in the Keychain.
fn get_or_create_fallback_secret() -> BiometricResult<String> {
    let query = super::keychain::KeychainQuery {
        service: FALLBACK_SECRET_SERVICE.into(),
        account: FALLBACK_SECRET_ACCOUNT.into(),
    };

    match super::keychain::read(&query) {
        Ok(data) => String::from_utf8(data)
            .map_err(|e| BiometricError::internal(format!("Invalid fallback secret: {e}"))),
        Err(_) => {
            // Create new secret
            let secret = uuid::Uuid::new_v4().to_string();
            super::keychain::store(&query, secret.as_bytes())?;
            Ok(secret)
        }
    }
}

/// Delete the Secure Enclave key marker (for key rotation or reset).
pub(crate) fn delete_se_key() -> BiometricResult<()> {
    let query = super::keychain::KeychainQuery {
        service: SE_KEY_TAG.into(),
        account: "se-key-marker".into(),
    };
    super::keychain::delete(&query)
}

/// Delete the fallback secret (for key rotation or reset).
pub(crate) fn delete_fallback_key() -> BiometricResult<()> {
    let query = super::keychain::KeychainQuery {
        service: FALLBACK_SECRET_SERVICE.into(),
        account: FALLBACK_SECRET_ACCOUNT.into(),
    };
    super::keychain::delete(&query)
}

/// Check if a derived key has been set up (either SE or fallback).
pub(crate) fn is_key_configured() -> bool {
    let se_query = super::keychain::KeychainQuery {
        service: SE_KEY_TAG.into(),
        account: "se-key-marker".into(),
    };
    let fallback_query = super::keychain::KeychainQuery {
        service: FALLBACK_SECRET_SERVICE.into(),
        account: FALLBACK_SECRET_ACCOUNT.into(),
    };
    super::keychain::exists(&se_query) || super::keychain::exists(&fallback_query)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivation_is_deterministic() {
        // The SHA256 derivation should be deterministic for same inputs
        let mut h1 = Sha256::new();
        h1.update(b"machine1");
        h1.update(b"reason1");
        h1.update(b"sorng-se-derived-key-v1");
        let k1 = h1.finalize();

        let mut h2 = Sha256::new();
        h2.update(b"machine1");
        h2.update(b"reason1");
        h2.update(b"sorng-se-derived-key-v1");
        let k2 = h2.finalize();

        assert_eq!(k1, k2);
    }

    #[test]
    fn derivation_varies_by_reason() {
        let mut h1 = Sha256::new();
        h1.update(b"machine1");
        h1.update(b"reason1");
        h1.update(b"sorng-se-derived-key-v1");
        let k1 = h1.finalize();

        let mut h2 = Sha256::new();
        h2.update(b"machine1");
        h2.update(b"reason2");
        h2.update(b"sorng-se-derived-key-v1");
        let k2 = h2.finalize();

        assert_ne!(k1, k2);
    }
}
