use crate::auth::AuthServiceState;
use crate::password::{hash_password, verify_password};

/// Hash an arbitrary password with the project's current KDF (Argon2id,
/// OWASP parameters). Returns a PHC-format hash string.
///
/// This is a **primitive** command — it does not touch the user store. Use
/// `add_user` / `update_password` for user-account management.
#[tauri::command]
pub async fn auth_hash_password(password: String) -> Result<String, String> {
    hash_password(&password)
}

/// Verify a plaintext password against a stored hash. Transparently handles
/// both Argon2id (current) and bcrypt (legacy) hashes.
#[tauri::command]
pub async fn auth_verify_password(password: String, hash: String) -> Result<bool, String> {
    verify_password(&password, &hash)
}

#[tauri::command]
pub async fn add_user(
    username: String,
    password: String,
    auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<(), String> {
    let mut service = auth_service.lock().await;
    service.add_user(username, password).await
}

#[tauri::command]
pub async fn verify_user(
    username: String,
    password: String,
    auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<bool, String> {
    let mut service = auth_service.lock().await;
    service.verify_user(&username, &password).await
}

#[tauri::command]
pub async fn list_users(
    auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<Vec<String>, String> {
    let service = auth_service.lock().await;
    Ok(service.list_users().await)
}

#[tauri::command]
pub async fn remove_user(
    username: String,
    auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<bool, String> {
    let mut service = auth_service.lock().await;
    service.remove_user(username).await
}

#[tauri::command]
pub async fn update_password(
    username: String,
    new_password: String,
    auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<bool, String> {
    let mut service = auth_service.lock().await;
    service.update_password(username, new_password).await
}
