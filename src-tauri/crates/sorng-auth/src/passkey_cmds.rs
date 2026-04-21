use super::passkey::*;

#[tauri::command]
pub async fn passkey_is_available(
    state: tauri::State<'_, PasskeyServiceState>,
) -> Result<bool, String> {
    let service = state.lock().await;
    Ok(service.is_available().await)
}

#[tauri::command]
pub async fn passkey_authenticate(
    state: tauri::State<'_, PasskeyServiceState>,
    reason: String,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.derive_encryption_key(&reason).await
}

#[tauri::command]
pub async fn passkey_register(
    state: tauri::State<'_, PasskeyServiceState>,
    name: String,
) -> Result<PasskeyCredential, String> {
    let mut service = state.lock().await;
    service.register_credential(&name).await
}

#[tauri::command]
pub async fn passkey_list_credentials(
    state: tauri::State<'_, PasskeyServiceState>,
) -> Result<Vec<PasskeyCredential>, String> {
    let service = state.lock().await;
    Ok(service.list_credentials().await)
}

#[tauri::command]
pub async fn passkey_remove_credential(
    state: tauri::State<'_, PasskeyServiceState>,
    id: String,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.remove_credential(&id).await
}

