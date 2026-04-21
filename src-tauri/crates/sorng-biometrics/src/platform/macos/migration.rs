//! Migration from legacy shell-command-based biometric implementation.
//!
//! The old implementation stored a "canary" Keychain item at
//! `com.sortofremoteng.biometric` / `biometric-canary` and a passkey item at
//! `sortofremoteng-passkey` / `sortofremoteng`.  This module detects those
//! legacy items and cleans them up after the user re-authenticates.

use crate::types::*;

/// Legacy Keychain identifiers from the old shell-command implementation.
const LEGACY_CANARY_SERVICE: &str = "com.sortofremoteng.biometric";
const LEGACY_CANARY_ACCOUNT: &str = "biometric-canary";

/// Legacy passkey Keychain identifiers from sorng-auth/passkey.rs.
const LEGACY_PASSKEY_SERVICE: &str = "sortofremoteng-passkey";
const LEGACY_PASSKEY_ACCOUNT: &str = "sortofremoteng";

/// Check if the legacy canary Keychain item exists.
///
/// Returns `true` if the user has set up biometrics with the old implementation
/// and needs to be migrated to the new native LAContext-based system.
pub(crate) fn needs_migration() -> bool {
    has_legacy_canary() || has_legacy_passkey()
}

/// Check for the old canary item.
fn has_legacy_canary() -> bool {
    super::keychain::exists(&super::keychain::KeychainQuery {
        service: LEGACY_CANARY_SERVICE.into(),
        account: LEGACY_CANARY_ACCOUNT.into(),
    })
}

/// Check for the old passkey item.
fn has_legacy_passkey() -> bool {
    super::keychain::exists(&super::keychain::KeychainQuery {
        service: LEGACY_PASSKEY_SERVICE.into(),
        account: LEGACY_PASSKEY_ACCOUNT.into(),
    })
}

/// Remove all legacy Keychain items.
///
/// Call this after the user has successfully re-authenticated with the new
/// native biometric system and their vault has been re-encrypted.
pub(crate) fn cleanup_legacy_items() -> BiometricResult<()> {
    // Best-effort deletion — don't fail if items are already gone
    let _ = super::keychain::delete(&super::keychain::KeychainQuery {
        service: LEGACY_CANARY_SERVICE.into(),
        account: LEGACY_CANARY_ACCOUNT.into(),
    });
    let _ = super::keychain::delete(&super::keychain::KeychainQuery {
        service: LEGACY_PASSKEY_SERVICE.into(),
        account: LEGACY_PASSKEY_ACCOUNT.into(),
    });

    log::info!("Legacy biometric Keychain items cleaned up");
    Ok(())
}

/// Get a summary of what legacy items exist (for logging/debugging).
pub(crate) fn legacy_status() -> String {
    let canary = if has_legacy_canary() { "present" } else { "absent" };
    let passkey = if has_legacy_passkey() { "present" } else { "absent" };
    format!(
        "Legacy biometric items: canary={canary}, passkey={passkey}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_constants_are_stable() {
        // These must never change — they identify items in the user's Keychain
        assert_eq!(LEGACY_CANARY_SERVICE, "com.sortofremoteng.biometric");
        assert_eq!(LEGACY_CANARY_ACCOUNT, "biometric-canary");
        assert_eq!(LEGACY_PASSKEY_SERVICE, "sortofremoteng-passkey");
        assert_eq!(LEGACY_PASSKEY_ACCOUNT, "sortofremoteng");
    }
}
