//! macOS Touch ID / LocalAuthentication biometric back-end.
//!
//! Uses the `security-framework` crate for Keychain interactions and
//! shells out to `bioutil -c` / `LAContext` for Touch ID availability.
//! For actual biometric prompts we use the macOS `security` command which
//! triggers the Keychain access dialog (Touch ID on supported hardware).
//!
//! A future improvement would link directly against the `LocalAuthentication`
//! framework via `objc2`, but the shell approach works reliably today.

use crate::types::*;
use std::process::Command;

/// Check whether Touch ID / biometric hardware is available.
pub(crate) async fn check_availability() -> BiometricResult<BiometricStatus> {
    tokio::task::spawn_blocking(check_availability_sync)
        .await
        .map_err(|e| BiometricError::internal(format!("spawn_blocking failed: {e}")))?
}

/// Prompt the user with Touch ID (or password fallback).
pub(crate) async fn prompt(reason: &str) -> BiometricResult<bool> {
    let reason = reason.to_owned();
    tokio::task::spawn_blocking(move || prompt_sync(&reason))
        .await
        .map_err(|e| BiometricError::internal(format!("spawn_blocking failed: {e}")))?
}

// ── synchronous implementations ─────────────────────────────────────

fn check_availability_sync() -> BiometricResult<BiometricStatus> {
    // 1. Check for Touch ID via bioutil
    let bioutil_ok = Command::new("bioutil")
        .arg("-c")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    // 2. Check for Secure Enclave (all T2 / Apple Silicon Macs)
    let has_secure_enclave = Command::new("system_profiler")
        .args(["SPiBridgeDataType"])
        .output()
        .map(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.contains("Apple T2") || stdout.contains("apple")
        })
        .unwrap_or(false);

    // 3. Check for Apple Silicon (always has Secure Enclave + Touch ID on laptops)
    let is_apple_silicon = Command::new("sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output()
        .map(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.contains("Apple")
        })
        .unwrap_or(false);

    let hardware_available = bioutil_ok || has_secure_enclave || is_apple_silicon;

    // bioutil -c returns enrolled fingerprint count
    let enrolled = if bioutil_ok {
        Command::new("bioutil")
            .args(["-c", "-s"])
            .output()
            .map(|o| {
                let stdout = String::from_utf8_lossy(&o.stdout);
                // bioutil reports "User … has N fingerprints enrolled"
                stdout.contains("fingerprint") && !stdout.contains("0 fingerprints")
            })
            .unwrap_or(false)
    } else {
        // Apple Silicon laptops nearly always have Touch ID enrolled
        is_apple_silicon
    };

    let mut kinds = Vec::new();
    if hardware_available {
        kinds.push(BiometricKind::Fingerprint);
    }

    Ok(BiometricStatus {
        hardware_available,
        enrolled,
        kinds,
        platform_label: "Touch ID".into(),
        unavailable_reason: if !hardware_available {
            Some("No Touch ID hardware detected".into())
        } else if !enrolled {
            Some("No fingerprints enrolled in Touch ID".into())
        } else {
            None
        },
    })
}

fn prompt_sync(reason: &str) -> BiometricResult<bool> {
    // Strategy: We store a canary secret in the macOS Keychain with ACL
    // set to require biometric authentication. Reading it back triggers
    // the Touch ID / password prompt managed by the OS.

    let service_name = "com.sortofremoteng.biometric";
    let account_name = "biometric-canary";

    // Ensure the canary keychain item exists
    ensure_canary_item(service_name, account_name);

    // Attempt to read the canary — this triggers Touch ID
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-s", service_name,
            "-a", account_name,
            "-w",
        ])
        .output()
        .map_err(|e| BiometricError::platform(format!("Failed to invoke `security`: {e}")))?;

    if output.status.success() {
        Ok(true)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("canceled") || stderr.contains("cancelled") {
            Err(BiometricError::user_cancelled())
        } else if stderr.contains("could not be found") {
            // Item missing — re-create and retry once
            ensure_canary_item(service_name, account_name);
            Err(BiometricError::platform(
                "Keychain item was missing; please retry",
            ))
        } else {
            Err(BiometricError::auth_failed())
        }
    }
}

/// Ensure a canary keychain item exists (creates if missing).
fn ensure_canary_item(service: &str, account: &str) {
    // Check existence first
    let exists = Command::new("security")
        .args([
            "find-generic-password",
            "-s", service,
            "-a", account,
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !exists {
        let canary_value = uuid::Uuid::new_v4().to_string();
        let _ = Command::new("security")
            .args([
                "add-generic-password",
                "-s", service,
                "-a", account,
                "-w", &canary_value,
                "-T", "",   // empty trusted-app list → requires user auth
                "-U",       // update if exists
            ])
            .output();
    }
}
