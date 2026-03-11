// Tauri commands for biometric authentication.

use super::types::*;

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
