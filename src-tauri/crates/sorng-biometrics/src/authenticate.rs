//! Core biometric authentication + key derivation.

use crate::types::*;
use sha2::{Digest, Sha256};

/// Prompt the user for biometric verification.
///
/// Returns `Ok(true)` if verification succeeded, or an error if the user
/// cancelled / the hardware is unavailable / the biometric didn't match.
pub async fn verify(reason: &str) -> BiometricResult<bool> {
    #[cfg(target_os = "windows")]
    {
        crate::platform::windows::prompt(reason).await
    }
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::prompt(reason).await
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::prompt(reason).await
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        crate::platform::fallback::prompt(reason).await
    }
}

/// Prompt the user, then derive a 32-byte key from the biometric context.
///
/// The derived key is deterministic per (machine-id, reason) pair, so the
/// same user on the same machine always gets the same key for a given
/// purpose string.  This is suitable for envelope-key encryption where the
/// biometric unlocks access to the real data-encryption key stored in the OS vault.
pub async fn verify_and_derive_key(reason: &str) -> BiometricResult<BiometricAuthResult> {
    // macOS: Use native Secure Enclave key derivation (Touch ID + hardware-bound key)
    #[cfg(target_os = "macos")]
    {
        return crate::platform::macos::verify_and_derive_key(reason).await;
    }

    // Windows + Linux + other: Software key derivation after biometric verify
    #[cfg(not(target_os = "macos"))]
    {
        let success = verify(reason).await?;

        if !success {
            return Ok(BiometricAuthResult {
                success: false,
                derived_key_hex: None,
                message: "Biometric verification returned false".into(),
            });
        }

        // Derive a 32-byte key from machine identity + reason
        let machine_id = get_machine_id();
        let mut hasher = Sha256::new();
        hasher.update(machine_id.as_bytes());
        hasher.update(reason.as_bytes());
        hasher.update(b"sorng-biometrics-key-v1");
        let hash = hasher.finalize();

        Ok(BiometricAuthResult {
            success: true,
            derived_key_hex: Some(hex::encode(hash)),
            message: "Biometric verification succeeded".into(),
        })
    }
}

// ── Machine-ID helpers ──────────────────────────────────────────────

fn get_machine_id() -> String {
    #[cfg(target_os = "windows")]
    {
        get_windows_machine_id()
    }
    #[cfg(target_os = "macos")]
    {
        get_macos_machine_id()
    }
    #[cfg(target_os = "linux")]
    {
        get_linux_machine_id()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "fallback-machine-id".into())
    }
}

#[cfg(target_os = "windows")]
fn get_windows_machine_id() -> String {
    crate::windows_registry::machine_guid().unwrap_or_else(fallback_hostname)
}

#[cfg(target_os = "macos")]
fn get_macos_machine_id() -> String {
    std::process::Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()
        .and_then(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout
                .lines()
                .find(|l| l.contains("IOPlatformUUID"))
                .and_then(|l| l.split('"').nth(3))
                .map(|s| s.to_string())
        })
        .unwrap_or_else(fallback_hostname)
}

#[cfg(target_os = "linux")]
fn get_linux_machine_id() -> String {
    std::fs::read_to_string("/etc/machine-id")
        .or_else(|_| std::fs::read_to_string("/var/lib/dbus/machine-id"))
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| fallback_hostname())
}

fn fallback_hostname() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown-machine".into())
}

// hex encoding helper (avoids pulling in a dependency for just this)
pub(crate) mod hex {
    pub fn encode(data: impl AsRef<[u8]>) -> String {
        data.as_ref().iter().map(|b| format!("{b:02x}")).collect()
    }
}
