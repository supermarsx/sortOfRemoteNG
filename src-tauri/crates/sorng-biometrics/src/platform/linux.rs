//! Linux biometric back-end.
//!
//! Uses **fprintd** (the D-Bus fingerprint daemon) for fingerprint auth,
//! and falls back to **polkit** (`pkexec --help` availability) for
//! password-based user verification.
//!
//! ## D-Bus interfaces used
//!
//! - `net.reactivated.Fprint.Manager` — enumerate fingerprint devices
//! - `net.reactivated.Fprint.Device`  — claim / verify / release
//! - `org.freedesktop.PolicyKit1`     — polkit fallback

use crate::types::*;
use std::process::Command;

/// Check whether fingerprint hardware (fprintd) or polkit are available.
pub(crate) async fn check_availability() -> BiometricResult<BiometricStatus> {
    tokio::task::spawn_blocking(check_availability_sync)
        .await
        .map_err(|e| BiometricError::internal(format!("spawn_blocking failed: {e}")))?
}

/// Prompt the user for biometric or polkit verification.
pub(crate) async fn prompt(reason: &str) -> BiometricResult<bool> {
    let reason = reason.to_owned();
    tokio::task::spawn_blocking(move || prompt_sync(&reason))
        .await
        .map_err(|e| BiometricError::internal(format!("spawn_blocking failed: {e}")))?
}

// ── synchronous implementations ─────────────────────────────────────

fn check_availability_sync() -> BiometricResult<BiometricStatus> {
    let fprintd_available = is_fprintd_available();
    let fprintd_enrolled = if fprintd_available {
        is_fprintd_enrolled()
    } else {
        false
    };
    let polkit_available = is_polkit_available();

    let hardware_available = fprintd_available || polkit_available;
    let enrolled = fprintd_enrolled || polkit_available; // polkit always "enrolled"

    let mut kinds = Vec::new();
    if fprintd_available {
        kinds.push(BiometricKind::Fingerprint);
    }

    let label = if fprintd_available {
        "fprintd (Fingerprint)"
    } else if polkit_available {
        "polkit (Password)"
    } else {
        "None"
    };

    Ok(BiometricStatus {
        hardware_available,
        enrolled,
        kinds,
        platform_label: label.into(),
        unavailable_reason: if !hardware_available {
            Some("Neither fprintd nor polkit found".into())
        } else if !enrolled {
            Some("No fingerprints enrolled in fprintd".into())
        } else {
            None
        },
    })
}

fn prompt_sync(reason: &str) -> BiometricResult<bool> {
    // Strategy 1: fprintd-verify (fingerprint)
    if is_fprintd_available() && is_fprintd_enrolled() {
        return prompt_fprintd(reason);
    }

    // Strategy 2: polkit agent via pkexec
    if is_polkit_available() {
        return prompt_polkit(reason);
    }

    Err(BiometricError::unsupported(
        "No biometric or polkit authentication available on this system",
    ))
}

// ── fprintd (fingerprint daemon) ────────────────────────────────────

fn is_fprintd_available() -> bool {
    // Check that fprintd-verify binary exists
    Command::new("which")
        .arg("fprintd-verify")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn is_fprintd_enrolled() -> bool {
    // fprintd-list <user> lists enrolled fingers.  If it returns a non-empty
    // list the user has at least one finger enrolled.
    let user = std::env::var("USER").unwrap_or_else(|_| "root".into());
    Command::new("fprintd-list")
        .arg(&user)
        .output()
        .map(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout);
            // Enrolled fingers appear as lines like " - left-index-finger"
            stdout.contains(" - ") && !stdout.contains("has no fingers enrolled")
        })
        .unwrap_or(false)
}

fn prompt_fprintd(_reason: &str) -> BiometricResult<bool> {
    // fprintd-verify triggers the fingerprint reader and blocks until
    // success, failure, or timeout.
    let output = Command::new("fprintd-verify")
        .output()
        .map_err(|e| BiometricError::platform(format!("fprintd-verify failed: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if output.status.success() && stdout.contains("verify-match") {
        Ok(true)
    } else if stdout.contains("verify-no-match") || stderr.contains("verify-no-match") {
        Err(BiometricError::auth_failed())
    } else {
        Err(BiometricError::platform(format!(
            "fprintd-verify exit code {}: {}",
            output.status.code().unwrap_or(-1),
            stderr
        )))
    }
}

// ── polkit fallback ─────────────────────────────────────────────────

fn is_polkit_available() -> bool {
    Command::new("which")
        .arg("pkexec")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn prompt_polkit(_reason: &str) -> BiometricResult<bool> {
    // pkexec runs a command as root after authenticating the user via
    // the polkit agent (which shows a password dialog).  We run a harmless
    // `true` command; success means the user authenticated.
    let output = Command::new("pkexec")
        .args(["--disable-internal-agent", "true"])
        .output()
        .map_err(|e| BiometricError::platform(format!("pkexec failed: {e}")))?;

    if output.status.success() {
        Ok(true)
    } else {
        let code = output.status.code().unwrap_or(-1);
        if code == 126 {
            // polkit: user dismissed the dialog
            Err(BiometricError::user_cancelled())
        } else if code == 127 {
            Err(BiometricError::platform(
                "pkexec: not found or not configured",
            ))
        } else {
            Err(BiometricError::auth_failed())
        }
    }
}
