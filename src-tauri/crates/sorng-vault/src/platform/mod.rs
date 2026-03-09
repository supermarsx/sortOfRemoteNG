//! Platform-specific vault/keychain back-ends.

#[cfg(target_os = "windows")]
pub(crate) mod windows;

#[cfg(target_os = "macos")]
pub(crate) mod macos;

#[cfg(target_os = "linux")]
pub(crate) mod linux;

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub(crate) mod fallback {
    use crate::types::*;

    pub(crate) fn store_secret(_service: &str, _account: &str, _secret: &[u8]) -> VaultResult<()> {
        Err(VaultError::backend_unavailable(
            "No vault backend on this OS",
        ))
    }
    pub(crate) fn read_secret(_service: &str, _account: &str) -> VaultResult<Vec<u8>> {
        Err(VaultError::backend_unavailable(
            "No vault backend on this OS",
        ))
    }
    pub(crate) fn delete_secret(_service: &str, _account: &str) -> VaultResult<()> {
        Err(VaultError::backend_unavailable(
            "No vault backend on this OS",
        ))
    }
    pub(crate) fn is_available() -> bool {
        false
    }
    pub(crate) fn backend_name() -> &'static str {
        "none"
    }
}
