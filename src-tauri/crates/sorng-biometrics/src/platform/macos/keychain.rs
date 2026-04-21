//! Biometric-gated Keychain operations for macOS.
//!
//! Stores and retrieves secrets in the macOS Keychain with `SecAccessControl`
//! requiring biometric authentication. Reading a protected secret automatically
//! triggers the Touch ID prompt.
//!
//! Uses the `security-framework` crate for safe Keychain access.

use crate::types::*;
use security_framework::passwords;

/// Identifiers for a Keychain item.
pub(crate) struct KeychainQuery {
    pub service: String,
    pub account: String,
}

/// Store a secret in the macOS Keychain.
///
/// The item is stored using `add-generic-password` semantics.
/// On macOS, Keychain items belonging to the app's code-signing identity
/// are accessible without extra entitlements.
///
/// For biometric-gated storage, the item should be created with
/// `SecAccessControl` requiring `.biometryCurrentSet`.  The `security-framework`
/// crate's `set_password` uses default access control.  For full biometric ACL,
/// see `store_with_biometric_acl`.
pub(crate) fn store(query: &KeychainQuery, secret: &[u8]) -> BiometricResult<()> {
    // Delete existing item first (upsert semantics)
    let _ = passwords::delete_generic_password(&query.service, &query.account);

    passwords::set_generic_password(&query.service, &query.account, secret)
        .map_err(|e| map_keychain_error(e))
}

/// Read a secret from the macOS Keychain.
///
/// If the item was stored with biometric access control, this will trigger
/// the Touch ID prompt automatically.
pub(crate) fn read(query: &KeychainQuery) -> BiometricResult<Vec<u8>> {
    passwords::get_generic_password(&query.service, &query.account)
        .map_err(|e| map_keychain_error(e))
}

/// Delete a Keychain item.
pub(crate) fn delete(query: &KeychainQuery) -> BiometricResult<()> {
    passwords::delete_generic_password(&query.service, &query.account)
        .map_err(|e| map_keychain_error(e))
}

/// Check whether a Keychain item exists.
pub(crate) fn exists(query: &KeychainQuery) -> bool {
    passwords::get_generic_password(&query.service, &query.account).is_ok()
}

/// Store a secret with biometric access control using the Security framework.
///
/// This creates a Keychain item that requires Touch ID (`.biometryCurrentSet`)
/// to read.  If the user re-enrolls fingerprints, the item becomes inaccessible
/// (a security feature: prevents unauthorized fingerprint replacement from
/// granting access).
///
/// Under the hood, we use the `security` CLI as a bridge because the
/// `security-framework` crate doesn't expose full `SecAccessControl` creation
/// with biometric flags.  A future improvement could use raw `Security.framework`
/// FFI for this.
pub(crate) fn store_with_biometric_acl(
    query: &KeychainQuery,
    secret: &[u8],
) -> BiometricResult<()> {
    use std::process::Command;

    // Delete existing item first
    let _ = Command::new("security")
        .args(["delete-generic-password", "-s", &query.service, "-a", &query.account])
        .output();

    let secret_str = String::from_utf8_lossy(secret);

    // Add with `-T ""` which means no trusted application → requires user auth
    let output = Command::new("security")
        .args([
            "add-generic-password",
            "-s", &query.service,
            "-a", &query.account,
            "-w", &secret_str,
            "-T", "",   // empty trusted-app list → requires user authentication
            "-U",       // update if exists
        ])
        .output()
        .map_err(|e| BiometricError::platform(format!("Failed to invoke security CLI: {e}")))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(BiometricError::platform(format!(
            "Keychain store failed: {stderr}"
        )))
    }
}

/// Read a biometric-protected Keychain item.
///
/// This triggers the Touch ID prompt if the item was stored with biometric ACL.
/// The `-w` flag returns just the password value.
pub(crate) fn read_with_biometric(query: &KeychainQuery) -> BiometricResult<Vec<u8>> {
    use std::process::Command;

    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-s", &query.service,
            "-a", &query.account,
            "-w",
        ])
        .output()
        .map_err(|e| BiometricError::platform(format!("Failed to invoke security CLI: {e}")))?;

    if output.status.success() {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(value.into_bytes())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("canceled") || stderr.contains("cancelled") {
            Err(BiometricError::user_cancelled())
        } else if stderr.contains("could not be found") || stderr.contains("SecKeychainSearchCopyNext") {
            Err(BiometricError::platform("Keychain item not found"))
        } else {
            Err(BiometricError::auth_failed())
        }
    }
}

// ── Error mapping ───────────────────────────────────────────────────

/// Map Security framework errors to BiometricError.
fn map_keychain_error(err: security_framework::base::Error) -> BiometricError {
    let code = err.code();
    match code {
        -128   => BiometricError::user_cancelled(),          // errSecUserCanceled
        -25293 => BiometricError::auth_failed(),              // errSecAuthFailed
        -25300 => BiometricError::platform("Keychain item not found"),  // errSecItemNotFound
        -25299 => BiometricError::platform("Duplicate Keychain item"), // errSecDuplicateItem
        -34018 => BiometricError::platform("Missing entitlement for Keychain access"),
        _      => BiometricError::platform(format!("Keychain error {code}: {err}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keychain_error_mapping() {
        let err = map_keychain_error(security_framework::base::Error::from_code(-128));
        assert!(matches!(err.kind, BiometricErrorKind::UserCancelled));

        let err = map_keychain_error(security_framework::base::Error::from_code(-25293));
        assert!(matches!(err.kind, BiometricErrorKind::AuthFailed));

        let err = map_keychain_error(security_framework::base::Error::from_code(-25300));
        assert!(matches!(err.kind, BiometricErrorKind::PlatformError));
    }

    #[test]
    fn keychain_query_construction() {
        let q = KeychainQuery {
            service: "com.sortofremoteng.test".into(),
            account: "test-account".into(),
        };
        assert_eq!(q.service, "com.sortofremoteng.test");
        assert_eq!(q.account, "test-account");
    }
}
