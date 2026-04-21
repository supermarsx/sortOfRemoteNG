//! macOS biometric unlock of the secret store.
//!
//! Implements Phase 1 of `docs/plans/macos-biometrics-plan.md` at the
//! `sorng-auth` layer: a thin, feature-gated entry point that triggers a
//! Touch ID / passkey prompt through the native `LocalAuthentication`
//! framework.  On Windows and Linux this compiles to a stub that returns
//! [`BiometricUnlockError::NotSupported`], which keeps `cargo check` green
//! on all hosts.
//!
//! ## Feature gating
//!
//! The real native code-path is only compiled when both
//! `cfg(target_os = "macos")` **and** the `platform-macos-biometrics` cargo
//! feature are active.  The feature pulls in `security-framework` (the safe
//! wrapper around `SecKeychain`/`SecAccessControl`) and delegates the actual
//! `LAContext.evaluatePolicy()` call into the [`sorng_biometrics`] crate,
//! which already owns the `objc2` / `LocalAuthentication.framework` FFI
//! bridge.  Keeping the FFI in one place avoids duplicating Objective-C
//! runtime machinery across crates (see Phase 7 of the plan).
//!
//! ## Cross-platform contract
//!
//! | Target                                             | Behaviour                                    |
//! |----------------------------------------------------|----------------------------------------------|
//! | macOS + feature `platform-macos-biometrics`        | Native Touch ID / passkey prompt via LAContext |
//! | macOS without the feature                          | Stub → `NotSupported`                        |
//! | Windows / Linux (any feature set)                  | Stub → `NotSupported`                        |
//!
//! Callers in higher layers (vault unlock, master-password dialog) should
//! match on [`BiometricUnlockError::NotSupported`] and fall back to the
//! existing passkey / Windows Hello code-paths.

use std::fmt;

/// Errors surfaced by the biometric unlock entry point.
///
/// Intentionally small: callers only need to distinguish "platform doesn't
/// support this" from "the user cancelled or auth failed" to decide whether
/// to fall back to password entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BiometricUnlockError {
    /// Platform or build configuration does not support biometric unlock
    /// (non-macOS host, or macOS build without `platform-macos-biometrics`).
    NotSupported,
    /// The user cancelled the system prompt.
    UserCancelled,
    /// Biometric hardware is present but no identities are enrolled.
    NotEnrolled,
    /// Biometric verification failed (wrong finger, lockout, etc.) or any
    /// other platform-level error — the wrapped string is diagnostic only.
    Failed(String),
}

impl fmt::Display for BiometricUnlockError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotSupported => write!(
                f,
                "Biometric unlock is not supported on this platform/build"
            ),
            Self::UserCancelled => write!(f, "User cancelled the biometric prompt"),
            Self::NotEnrolled => write!(f, "No biometric identities enrolled"),
            Self::Failed(msg) => write!(f, "Biometric unlock failed: {msg}"),
        }
    }
}

impl std::error::Error for BiometricUnlockError {}

/// Convenience alias used throughout this module.
pub type Result<T> = std::result::Result<T, BiometricUnlockError>;

/// Prompt the user for biometric authentication to unlock the secret store.
///
/// * On macOS with `--features platform-macos-biometrics` this triggers a
///   native Touch ID (or paired passkey) prompt through
///   `LAContext.evaluatePolicy()`.  Returns `Ok(true)` only if the system
///   confirms a successful biometric verification.
/// * On every other target (Windows, Linux, or a macOS build *without* the
///   feature) this is a compile-time no-op that returns
///   [`BiometricUnlockError::NotSupported`] immediately.
///
/// The `reason` string is shown verbatim in the system dialog and should be
/// a user-facing sentence (e.g. `"Unlock your sortOfRemoteNG vault"`).
///
/// This function is `async` because the underlying `LAContext` evaluation
/// is bridged over a completion handler → `mpsc` channel inside
/// `sorng-biometrics`; awaiting it parks the tokio task while the user
/// interacts with the sheet.
pub async fn prompt_biometric_auth(reason: &str) -> Result<bool> {
    impl_::prompt_biometric_auth(reason).await
}

// -----------------------------------------------------------------------------
// Platform implementation selector.
//
// We deliberately keep the two bodies in sibling sub-modules with identical
// signatures so the compiler enforces that the stub and the real impl stay
// in lock-step.  `#[cfg]` at the module level (rather than inside the fn)
// also means the `security-framework` / `sorng_biometrics` names are never
// resolved on non-macOS builds.
// -----------------------------------------------------------------------------

#[cfg(all(target_os = "macos", feature = "platform-macos-biometrics"))]
mod impl_ {
    //! Real macOS back-end.
    //!
    //! We rely on `sorng_biometrics::authenticate::verify` for the actual
    //! `LAContext.evaluatePolicy` call — that crate already owns the
    //! `objc2-local-authentication` FFI bridge, so duplicating it here
    //! would be wasted code.  The `security-framework` dependency is
    //! pulled in via the `platform-macos-biometrics` feature to make the
    //! biometric-gated Keychain surface (Phase 3 of the plan) available
    //! to follow-up commits without another Cargo.toml change.
    use super::{BiometricUnlockError, Result};

    // Touch the `security_framework` crate so the `--features` gate is
    // observable and future Phase 3 work (biometric-ACL Keychain items)
    // has the dep already wired in.  The `as _` keeps the import cost at
    // zero while preventing `unused_crate_dependencies` warnings.
    use security_framework as _;

    pub(super) async fn prompt_biometric_auth(reason: &str) -> Result<bool> {
        use sorng_biometrics::types::BiometricErrorKind;

        match sorng_biometrics::authenticate::verify(reason).await {
            Ok(ok) => Ok(ok),
            Err(err) => Err(match err.kind {
                BiometricErrorKind::UserCancelled => BiometricUnlockError::UserCancelled,
                BiometricErrorKind::NotEnrolled => BiometricUnlockError::NotEnrolled,
                BiometricErrorKind::HardwareUnavailable => {
                    BiometricUnlockError::NotSupported
                }
                _ => BiometricUnlockError::Failed(err.message),
            }),
        }
    }
}

#[cfg(not(all(target_os = "macos", feature = "platform-macos-biometrics")))]
mod impl_ {
    //! No-op stub for Windows / Linux / macOS-without-feature builds.
    //!
    //! Every call returns [`BiometricUnlockError::NotSupported`] so that
    //! callers can uniformly fall back to the existing passkey / Windows
    //! Hello / password-entry flows.  `cargo check` on Linux hits this
    //! branch.
    use super::{BiometricUnlockError, Result};

    pub(super) async fn prompt_biometric_auth(_reason: &str) -> Result<bool> {
        Err(BiometricUnlockError::NotSupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stub_returns_not_supported_on_non_macos() {
        // On Linux/Windows CI this must be NotSupported.  On macOS hosts
        // built *without* the feature the same stub is selected, so the
        // assertion still holds.  When the feature IS enabled on macOS
        // this test is skipped via cfg to avoid popping a real Touch ID
        // sheet during `cargo test`.
        #[cfg(not(all(target_os = "macos", feature = "platform-macos-biometrics")))]
        {
            let err = prompt_biometric_auth("test reason").await.unwrap_err();
            assert_eq!(err, BiometricUnlockError::NotSupported);
        }
    }

    #[test]
    fn error_display_is_stable() {
        assert_eq!(
            BiometricUnlockError::NotSupported.to_string(),
            "Biometric unlock is not supported on this platform/build"
        );
        assert_eq!(
            BiometricUnlockError::UserCancelled.to_string(),
            "User cancelled the biometric prompt"
        );
        assert_eq!(
            BiometricUnlockError::NotEnrolled.to_string(),
            "No biometric identities enrolled"
        );
        assert_eq!(
            BiometricUnlockError::Failed("boom".into()).to_string(),
            "Biometric unlock failed: boom"
        );
    }
}
