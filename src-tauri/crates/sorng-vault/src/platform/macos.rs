//! macOS Keychain Services back-end.
//!
//! Uses the `security-framework` crate which wraps the native
//! `Security.framework` C APIs for Keychain access.

use crate::types::*;
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

/// Store a secret in the macOS Keychain.
pub(crate) fn store_secret(service: &str, account: &str, secret: &[u8]) -> VaultResult<()> {
    set_generic_password(service, account, secret)
        .map_err(|e| VaultError::platform(format!("Keychain set_generic_password: {e}")))
}

/// Read a secret from the macOS Keychain.
pub(crate) fn read_secret(service: &str, account: &str) -> VaultResult<Vec<u8>> {
    get_generic_password(service, account)
        .map_err(|e| VaultError::not_found(format!("Keychain get_generic_password: {e}")))
}

/// Delete a secret from the macOS Keychain.
pub(crate) fn delete_secret(service: &str, account: &str) -> VaultResult<()> {
    delete_generic_password(service, account)
        .map_err(|e| VaultError::not_found(format!("Keychain delete_generic_password: {e}")))
}

pub(crate) fn is_available() -> bool {
    // Keychain Services are always available on macOS.
    true
}

pub(crate) fn backend_name() -> &'static str {
    "macOS Keychain Services"
}
