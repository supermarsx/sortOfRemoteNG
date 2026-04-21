//! Platform-specific biometric back-ends (private to this crate).
//!
//! Each sub-module exposes two functions that match the crate-level trait surface:
//!
//! ```ignore
//! pub(crate) async fn check_availability() -> BiometricResult<BiometricStatus>
//! pub(crate) async fn prompt(reason: &str) -> BiometricResult<bool>
//! ```

#[cfg(target_os = "windows")]
pub(crate) mod windows;

#[cfg(target_os = "macos")]
pub(crate) mod macos;

#[cfg(target_os = "linux")]
pub(crate) mod linux;

// ── Fallback for unsupported platforms ──────────────────────────────

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub(crate) mod fallback {
    use crate::types::*;

    pub(crate) async fn check_availability() -> BiometricResult<BiometricStatus> {
        Ok(BiometricStatus {
            hardware_available: false,
            enrolled: false,
            kinds: vec![],
            platform_label: "Unsupported OS".into(),
            unavailable_reason: Some("Biometrics are not supported on this platform".into()),
        })
    }

    pub(crate) async fn prompt(_reason: &str) -> BiometricResult<bool> {
        Err(BiometricError::unsupported(
            "Biometric authentication not available on this OS",
        ))
    }
}
