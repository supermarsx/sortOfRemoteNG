//! Tauri commands for the vault crate.

use crate::types::*;
use crate::{envelope, keychain, migration};
use std::path::PathBuf;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Vault status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Get the overall vault status.
#[tauri::command]
pub async fn vault_status() -> Result<VaultStatus, String> {
    keychain::status().await.map_err(|e| e.to_string())
}

/// Check if the OS vault backend is available.
#[tauri::command]
pub async fn vault_is_available() -> Result<bool, String> {
    Ok(keychain::is_available())
}

/// Get the vault backend name.
#[tauri::command]
pub async fn vault_backend_name() -> Result<String, String> {
    Ok(keychain::backend_name().to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Secret CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Store a secret in the OS vault.
#[tauri::command]
pub async fn vault_store_secret(
    service: String,
    account: String,
    secret: String,
) -> Result<(), String> {
    keychain::store(&service, &account, &secret)
        .await
        .map_err(|e| e.to_string())
}

/// Read a secret from the OS vault.
#[tauri::command]
pub async fn vault_read_secret(service: String, account: String) -> Result<String, String> {
    keychain::read(&service, &account)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a secret from the OS vault.
#[tauri::command]
pub async fn vault_delete_secret(service: String, account: String) -> Result<(), String> {
    keychain::delete(&service, &account)
        .await
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DEK management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Ensure a master DEK exists in the OS vault (generates one if missing).
#[tauri::command]
pub async fn vault_ensure_dek() -> Result<(), String> {
    keychain::ensure_dek()
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Envelope encryption (password-based)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Encrypt a string with a password using Argon2id + AES-256-GCM.
#[tauri::command]
pub async fn vault_envelope_encrypt(
    password: String,
    plaintext: String,
) -> Result<(String, String), String> {
    tokio::task::spawn_blocking(move || envelope::encrypt(&password, plaintext.as_bytes()))
        .await
        .map_err(|e| format!("spawn: {e}"))?
        .map_err(|e| e.to_string())
}

/// Decrypt a string with a password using the envelope metadata.
#[tauri::command]
pub async fn vault_envelope_decrypt(
    password: String,
    meta_json: String,
    ciphertext_b64: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let bytes = envelope::decrypt(&password, &meta_json, &ciphertext_b64)?;
        String::from_utf8(bytes).map_err(|e| VaultError::serde(format!("UTF-8: {e}")))
    })
    .await
    .map_err(|e| format!("spawn: {e}"))?
    .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Biometric-gated vault access
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Store a secret, requiring biometric verification first.
#[tauri::command]
pub async fn vault_biometric_store(
    service: String,
    account: String,
    secret: String,
    reason: String,
) -> Result<(), String> {
    // Verify biometric first
    sorng_biometrics::authenticate::verify(&reason)
        .await
        .map_err(|e| e.to_string())?;

    keychain::store(&service, &account, &secret)
        .await
        .map_err(|e| e.to_string())
}

/// Read a secret, requiring biometric verification first.
#[tauri::command]
pub async fn vault_biometric_read(
    service: String,
    account: String,
    reason: String,
) -> Result<String, String> {
    sorng_biometrics::authenticate::verify(&reason)
        .await
        .map_err(|e| e.to_string())?;

    keychain::read(&service, &account)
        .await
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Migration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Check if legacy storage needs migration.
#[tauri::command]
pub async fn vault_needs_migration(storage_path: String) -> Result<bool, String> {
    Ok(migration::needs_migration(&PathBuf::from(storage_path)))
}

/// Migrate legacy plain-JSON storage into vault-backed encrypted storage.
#[tauri::command]
pub async fn vault_migrate(
    storage_path: String,
    old_password: Option<String>,
) -> Result<migration::MigrationResult, String> {
    migration::migrate(&PathBuf::from(storage_path), old_password.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// Load storage data from vault-backed encrypted file.
#[tauri::command]
pub async fn vault_load_storage(storage_path: String) -> Result<String, String> {
    migration::load_vault_storage(&PathBuf::from(storage_path))
        .await
        .map_err(|e| e.to_string())
}

/// Save storage data to vault-backed encrypted file.
#[tauri::command]
pub async fn vault_save_storage(storage_path: String, json_data: String) -> Result<(), String> {
    migration::save_vault_storage(&PathBuf::from(storage_path), &json_data)
        .await
        .map_err(|e| e.to_string())
}
