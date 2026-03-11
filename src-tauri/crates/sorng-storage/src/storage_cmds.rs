use super::storage::*;

/// Tauri command to check if stored data exists.
///
/// # Arguments
///
/// * `state` - The secure storage service state
///
/// # Returns
///
/// `Ok(true)` if data exists, `Ok(false)` if no data, `Err(String)` on error
#[tauri::command]
pub async fn has_stored_data(state: tauri::State<'_, SecureStorageState>) -> Result<bool, String> {
    let storage = state.lock().await;
    storage.has_stored_data().await
}

/// Tauri command to check if storage is encrypted.
///
/// # Arguments
///
/// * `state` - The secure storage service state
///
/// # Returns
///
/// `Ok(false)` (encryption not yet implemented)
#[tauri::command]
pub async fn is_storage_encrypted(
    state: tauri::State<'_, SecureStorageState>,
) -> Result<bool, String> {
    let storage = state.lock().await;
    storage.is_storage_encrypted().await
}

/// Tauri command to save data to storage.
///
/// # Arguments
///
/// * `state` - The secure storage service state
/// * `data` - The data to save
/// * `use_password` - Whether to use encryption (currently ignored)
///
/// # Returns
///
/// `Ok(())` on success, `Err(String)` on error
#[tauri::command]
pub async fn save_data(
    state: tauri::State<'_, SecureStorageState>,
    data: StorageData,
    use_password: bool,
) -> Result<(), String> {
    let storage = state.lock().await;
    storage.save_data(data, use_password).await
}

/// Tauri command to load data from storage.
///
/// # Arguments
///
/// * `state` - The secure storage service state
///
/// # Returns
///
/// `Ok(Some(StorageData))` if data exists, `Ok(None)` if no data, `Err(String)` on error
#[tauri::command]
pub async fn load_data(
    state: tauri::State<'_, SecureStorageState>,
) -> Result<Option<StorageData>, String> {
    let storage = state.lock().await;
    storage.load_data().await
}

/// Tauri command to clear all stored data.
///
/// # Arguments
///
/// * `state` - The secure storage service state
///
/// # Returns
///
/// `Ok(())` on success, `Err(String)` on error
#[tauri::command]
pub async fn clear_storage(state: tauri::State<'_, SecureStorageState>) -> Result<(), String> {
    let storage = state.lock().await;
    storage.clear_storage().await
}

/// Tauri command to set the storage password.
///
/// # Arguments
///
/// * `state` - The secure storage service state
/// * `password` - Optional password for encryption
///
/// # Returns
///
/// `Ok(())` always (password stored for future encryption)
#[tauri::command]
pub async fn set_storage_password(
    state: tauri::State<'_, SecureStorageState>,
    password: Option<String>,
) -> Result<(), String> {
    let mut storage = state.lock().await;
    storage.set_password(password).await;
    Ok(())
}

