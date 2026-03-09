use crate::auth::AuthServiceState;

#[tauri::command]
pub async fn add_user(
    username: String,
    password: String,
    auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<(), String> {
    sorng_app_auth::commands::add_user(username, password, auth_service).await
}

#[tauri::command]
pub async fn verify_user(
    username: String,
    password: String,
    auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<bool, String> {
    sorng_app_auth::commands::verify_user(username, password, auth_service).await
}

#[tauri::command]
pub async fn list_users(
    auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<Vec<String>, String> {
    sorng_app_auth::commands::list_users(auth_service).await
}

#[tauri::command]
pub async fn remove_user(
    username: String,
    auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<bool, String> {
    sorng_app_auth::commands::remove_user(username, auth_service).await
}

#[tauri::command]
pub async fn update_password(
    username: String,
    new_password: String,
    auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<bool, String> {
    sorng_app_auth::commands::update_password(username, new_password, auth_service).await
}
