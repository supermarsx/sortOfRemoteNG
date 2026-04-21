// Tauri commands for biometric authentication.

use super::types::*;

/// Platform-specific biometric information for the frontend.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricPlatformInfo {
    pub os: String,
    pub platform_label: String,
    pub icon_hint: String,
}

/// Check biometric hardware availability and enrolment.
#[tauri::command]
pub async fn biometric_check_availability() -> Result<BiometricStatus, String> {
    super::availability::check()
        .await
        .map_err(|e| e.to_string())
}

/// Quick boolean: is biometric auth usable right now?
#[tauri::command]
pub async fn biometric_is_available() -> Result<bool, String> {
    Ok(super::availability::is_available().await)
}

/// Prompt the user for biometric verification (Touch ID / Windows Hello / fprintd).
#[tauri::command]
pub async fn biometric_verify(reason: String) -> Result<bool, String> {
    super::authenticate::verify(&reason)
        .await
        .map_err(|e| e.to_string())
}

/// Prompt the user and derive a 32-byte key from the biometric context.
#[tauri::command]
pub async fn biometric_verify_and_derive_key(
    reason: String,
) -> Result<BiometricAuthResult, String> {
    super::authenticate::verify_and_derive_key(&reason)
        .await
        .map_err(|e| e.to_string())
}

/// Check if legacy biometric setup needs migration to native APIs (macOS only).
#[tauri::command]
pub async fn biometric_needs_migration() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(super::platform::macos::needs_migration())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}

/// Clean up legacy biometric Keychain items after migration (macOS only).
#[tauri::command]
pub async fn biometric_cleanup_legacy() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        super::platform::macos::cleanup_legacy()
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

/// Get platform-specific biometric info for the frontend.
#[tauri::command]
pub async fn biometric_platform_info() -> Result<BiometricPlatformInfo, String> {
    let status = super::availability::check()
        .await
        .unwrap_or_default();

    let icon_hint = if status.kinds.contains(&super::types::BiometricKind::Fingerprint) {
        "fingerprint"
    } else if status.kinds.contains(&super::types::BiometricKind::FaceRecognition) {
        "face"
    } else {
        "shield"
    };

    Ok(BiometricPlatformInfo {
        os: std::env::consts::OS.into(),
        platform_label: status.platform_label,
        icon_hint: icon_hint.into(),
    })
}
