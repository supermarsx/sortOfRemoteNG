//! Windows Hello / UserConsentVerifier biometric back-end.
//!
//! Uses the WinRT `Windows.Security.Credentials.UI.UserConsentVerifier` API
//! which is the same surface that Windows Hello, PIN, and fingerprint readers
//! expose on Windows 10 1607+.

use crate::types::*;

/// Check whether the device supports Windows Hello biometric authentication.
pub(crate) async fn check_availability() -> BiometricResult<BiometricStatus> {
    check_availability_impl().await
}

/// Prompt the user with Windows Hello (fingerprint, face, or PIN fallback).
pub(crate) async fn prompt(reason: &str) -> BiometricResult<bool> {
    let reason = reason.to_owned();
    prompt_impl(&reason).await
}

// ── async implementations (WinRT operations are already `IntoFuture`) ───

async fn check_availability_impl() -> BiometricResult<BiometricStatus> {
    use windows::Security::Credentials::UI::{
        UserConsentVerifier, UserConsentVerifierAvailability,
    };

    let availability = UserConsentVerifier::CheckAvailabilityAsync()
        .map_err(|e| BiometricError::platform(format!("CheckAvailabilityAsync create: {e}")))?
        .await
        .map_err(|e| BiometricError::platform(format!("CheckAvailabilityAsync await: {e}")))?;

    match availability {
        UserConsentVerifierAvailability::Available => Ok(BiometricStatus {
            hardware_available: true,
            enrolled: true,
            kinds: detect_kinds(),
            platform_label: "Windows Hello".into(),
            unavailable_reason: None,
        }),
        UserConsentVerifierAvailability::DeviceNotPresent => Ok(BiometricStatus {
            hardware_available: false,
            enrolled: false,
            kinds: vec![],
            platform_label: "Windows Hello".into(),
            unavailable_reason: Some("No biometric device present".into()),
        }),
        UserConsentVerifierAvailability::NotConfiguredForUser => Ok(BiometricStatus {
            hardware_available: true,
            enrolled: false,
            kinds: detect_kinds(),
            platform_label: "Windows Hello".into(),
            unavailable_reason: Some("Windows Hello is not configured for current user".into()),
        }),
        UserConsentVerifierAvailability::DisabledByPolicy => Ok(BiometricStatus {
            hardware_available: true,
            enrolled: false,
            kinds: vec![],
            platform_label: "Windows Hello".into(),
            unavailable_reason: Some("Biometrics disabled by group policy".into()),
        }),
        _ => Ok(BiometricStatus {
            hardware_available: false,
            enrolled: false,
            kinds: vec![],
            platform_label: "Windows Hello".into(),
            unavailable_reason: Some("Unknown availability state".into()),
        }),
    }
}

async fn prompt_impl(reason: &str) -> BiometricResult<bool> {
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier,
    };
    use windows::core::HSTRING;

    let message = HSTRING::from(reason);
    let result = UserConsentVerifier::RequestVerificationAsync(&message)
        .map_err(|e| BiometricError::platform(format!("RequestVerificationAsync create: {e}")))?
        .await
        .map_err(|e| BiometricError::platform(format!("RequestVerificationAsync await: {e}")))?;

    match result {
        UserConsentVerificationResult::Verified => Ok(true),
        UserConsentVerificationResult::Canceled => Err(BiometricError::user_cancelled()),
        UserConsentVerificationResult::DeviceNotPresent => {
            Err(BiometricError::platform("Biometric device not present"))
        }
        UserConsentVerificationResult::NotConfiguredForUser => {
            Err(BiometricError::platform("Windows Hello not configured for user"))
        }
        UserConsentVerificationResult::DisabledByPolicy => {
            Err(BiometricError::platform("Biometrics disabled by policy"))
        }
        UserConsentVerificationResult::DeviceBusy => {
            Err(BiometricError::platform("Biometric device is busy"))
        }
        UserConsentVerificationResult::RetriesExhausted => Err(BiometricError::auth_failed()),
        _ => Err(BiometricError::platform("Unknown verification result")),
    }
}

/// Best-effort detection of which biometric kinds are enrolled via WBF.
fn detect_kinds() -> Vec<BiometricKind> {
    let mut kinds = Vec::new();

    if check_wbf_sensor("Fingerprint") {
        kinds.push(BiometricKind::Fingerprint);
    }
    if check_wbf_sensor("Facial Features") {
        kinds.push(BiometricKind::FaceRecognition);
    }
    if check_wbf_sensor("Iris") {
        kinds.push(BiometricKind::Iris);
    }

    // If nothing was detected but Hello is available, mark generic
    if kinds.is_empty() {
        kinds.push(BiometricKind::Other);
    }

    kinds
}

/// Check the WBF registry for a biometric sensor type.
fn check_wbf_sensor(sensor_type: &str) -> bool {
    use windows::Win32::System::Registry::{
        RegOpenKeyExW, RegCloseKey, HKEY_LOCAL_MACHINE, KEY_READ,
    };
    use windows::core::HSTRING;
    use windows::core::PCWSTR;

    let path = format!(
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WinBio\\Sensor Types\\{sensor_type}"
    );
    let key_path = HSTRING::from(path);

    unsafe {
        let mut hkey = windows::Win32::System::Registry::HKEY::default();
        let result = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(key_path.as_ptr()),
            Some(0),
            KEY_READ,
            &mut hkey,
        );
        if result.is_ok() {
            let _ = RegCloseKey(hkey);
            return true;
        }
    }
    false
}
