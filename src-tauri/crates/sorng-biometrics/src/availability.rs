//! Detect biometric hardware availability and enrolment status.

use crate::types::{BiometricResult, BiometricStatus};

/// Query the OS for biometric hardware + enrolment.
pub async fn check() -> BiometricResult<BiometricStatus> {
    #[cfg(target_os = "windows")]
    {
        crate::platform::windows::check_availability().await
    }
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::check_availability().await
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::check_availability().await
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        crate::platform::fallback::check_availability().await
    }
}

/// Quick boolean: is biometric auth usable right now?
pub async fn is_available() -> bool {
    check()
        .await
        .map(|s| s.hardware_available && s.enrolled)
        .unwrap_or(false)
}
