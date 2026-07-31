use super::security::*;

#[tauri::command]
pub async fn generate_totp_secret(
    state: tauri::State<'_, SecurityServiceState>,
) -> Result<String, String> {
    let mut security = state.lock().await;
    security.generate_totp_secret().await
}

#[tauri::command]
pub async fn verify_totp(
    state: tauri::State<'_, SecurityServiceState>,
    code: String,
) -> Result<bool, String> {
    let security = state.lock().await;
    security.verify_totp(code).await
}
