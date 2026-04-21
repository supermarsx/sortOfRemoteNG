//! macOS Touch ID / LocalAuthentication biometric back-end.
//!
//! Uses the native `LocalAuthentication` framework via Objective-C FFI for
//! biometric prompts and availability detection, the `security-framework` crate
//! for Keychain operations, and Secure Enclave for hardware-bound key derivation.
//!
//! ## Sub-modules
//!
//! - [`la_context`]     — LAContext FFI wrapper (Touch ID prompt + availability)
//! - [`keychain`]       — Biometric-gated Keychain read/write
//! - [`secure_enclave`] — Secure Enclave key generation + derivation
//! - [`helpers`]        — Machine ID, biometry type mapping, labels
//! - [`migration`]      — Legacy canary-item detection and cleanup

pub(crate) mod la_context;
pub(crate) mod keychain;
pub(crate) mod secure_enclave;
pub(crate) mod helpers;
pub(crate) mod migration;

use crate::types::*;

/// Check whether Touch ID / biometric hardware is available and enrolled.
///
/// Uses `LAContext.canEvaluatePolicy()` for instant native detection —
/// no shell commands, no process spawning.
pub(crate) async fn check_availability() -> BiometricResult<BiometricStatus> {
    tokio::task::spawn_blocking(|| {
        let info = la_context::can_evaluate(la_context::Policy::BiometricOnly)
            .unwrap_or(BiometryInfo {
                available: false,
                biometry_type: BiometryType::None,
                enrolled: false,
            });

        let label = helpers::platform_label(info.biometry_type);
        let kinds = helpers::biometric_kinds(info.biometry_type);

        Ok(BiometricStatus {
            hardware_available: info.available,
            enrolled: info.enrolled,
            kinds,
            platform_label: label.into(),
            biometry_type: info.biometry_type,
            unavailable_reason: helpers::unavailable_reason(&info),
        })
    })
    .await
    .map_err(|e| BiometricError::internal(format!("spawn_blocking: {e}")))?
}

/// Prompt the user with Touch ID (or system password fallback).
///
/// Displays the native macOS Touch ID dialog with the given reason string.
/// Falls back to system password if Touch ID fails or is locked out.
pub(crate) async fn prompt(reason: &str) -> BiometricResult<bool> {
    let reason = reason.to_owned();
    tokio::task::spawn_blocking(move || {
        la_context::evaluate(&reason, la_context::Policy::BiometricOrPassword)
    })
    .await
    .map_err(|e| BiometricError::internal(format!("spawn_blocking: {e}")))?
}

/// Prompt with Touch ID or Apple Watch (macOS 10.15+).
///
/// If the user has an Apple Watch paired, it can be used for authentication
/// when Touch ID is unavailable (e.g., lid closed with external display).
#[allow(dead_code)]
pub(crate) async fn prompt_with_watch(reason: &str) -> BiometricResult<bool> {
    let reason = reason.to_owned();
    tokio::task::spawn_blocking(move || {
        la_context::evaluate(&reason, la_context::Policy::BiometricOrWatch)
    })
    .await
    .map_err(|e| BiometricError::internal(format!("spawn_blocking: {e}")))?
}

/// Derive a 32-byte key using Secure Enclave (or Keychain fallback).
///
/// This is the macOS-specific implementation of `verify_and_derive_key`.
/// It first verifies the user via Touch ID, then derives a hardware-bound key.
pub(crate) async fn verify_and_derive_key(reason: &str) -> BiometricResult<BiometricAuthResult> {
    // Step 1: Verify the user via Touch ID
    let reason_owned = reason.to_owned();
    let verified = tokio::task::spawn_blocking({
        let reason = reason_owned.clone();
        move || la_context::evaluate(&reason, la_context::Policy::BiometricOrPassword)
    })
    .await
    .map_err(|e| BiometricError::internal(format!("spawn_blocking: {e}")))?;

    match verified {
        Ok(true) => {}
        Ok(false) => {
            return Ok(BiometricAuthResult {
                success: false,
                derived_key_hex: None,
                message: "Touch ID verification returned false".into(),
            });
        }
        Err(e) => return Err(e),
    }

    // Step 2: Derive key from Secure Enclave (or fallback)
    let reason_for_key = reason_owned;
    let derived = tokio::task::spawn_blocking(move || {
        secure_enclave::derive_key(&reason_for_key)
    })
    .await
    .map_err(|e| BiometricError::internal(format!("spawn_blocking: {e}")))?;

    match derived {
        Ok(key_bytes) => Ok(BiometricAuthResult {
            success: true,
            derived_key_hex: Some(crate::authenticate::hex::encode(&key_bytes)),
            message: "Touch ID verification + key derivation succeeded".into(),
        }),
        Err(e) => Err(e),
    }
}

/// Check if the legacy shell-command-based biometric setup needs migration.
pub(crate) fn needs_migration() -> bool {
    migration::needs_migration()
}

/// Clean up legacy Keychain items after successful migration.
pub(crate) fn cleanup_legacy() -> BiometricResult<()> {
    migration::cleanup_legacy_items()
}

#[cfg(test)]
mod tests {
    #[test]
    fn module_structure_compiles() {
        // This test verifies that all sub-modules are properly linked.
        // Actual functionality tests are in each sub-module.
        assert!(true);
    }
}
