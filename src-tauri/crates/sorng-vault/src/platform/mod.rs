//! Platform-specific vault/keychain back-ends.

#[cfg(any(target_os = "linux", test))]
fn recover_try_send_value<T>(error: std::sync::mpsc::TrySendError<T>) -> T {
    match error {
        std::sync::mpsc::TrySendError::Full(value)
        | std::sync::mpsc::TrySendError::Disconnected(value) => value,
    }
}

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

#[cfg(test)]
mod tests {
    use super::recover_try_send_value;
    use std::sync::mpsc::TrySendError;

    #[test]
    fn recovers_values_from_all_try_send_failures() {
        assert_eq!(recover_try_send_value(TrySendError::Full("full")), "full");
        assert_eq!(
            recover_try_send_value(TrySendError::Disconnected("disconnected")),
            "disconnected"
        );
    }
}
