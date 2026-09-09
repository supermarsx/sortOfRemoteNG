// Tauri commands for the vault crate.

use super::types::*;
use super::{envelope, keychain, migration};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const RESERVED_INTERNAL_SERVICE_PREFIX: &str = "sortofremoteng.internal.";

fn reject_reserved_target(service: &str, account: &str) -> Result<(), String> {
    if service
        .trim()
        .to_ascii_lowercase()
        .starts_with(RESERVED_INTERNAL_SERVICE_PREFIX)
        || (service.trim().eq_ignore_ascii_case(SERVICE_NAME)
            && account.trim().eq_ignore_ascii_case(MASTER_DEK_ACCOUNT))
    {
        return Err(
            "reserved application secrets are not accessible through generic vault IPC".to_string(),
        );
    }
    Ok(())
}

fn managed_storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("storage.json"))
        .map_err(|_| "Failed to resolve the application data directory".to_string())
}

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
    reject_reserved_target(&service, &account)?;
    keychain::store(&service, &account, &secret)
        .await
        .map_err(|e| e.to_string())
}

/// Read a secret from the OS vault.
#[tauri::command]
pub async fn vault_read_secret(service: String, account: String) -> Result<String, String> {
    reject_reserved_target(&service, &account)?;
    keychain::read(&service, &account)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a secret from the OS vault.
#[tauri::command]
pub async fn vault_delete_secret(service: String, account: String) -> Result<(), String> {
    reject_reserved_target(&service, &account)?;
    keychain::delete(&service, &account)
        .await
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DEK management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Compatibility-only entry point. Master-key creation requires the profile
/// evidence checks owned by the encryption setup/recovery commands.
#[tauri::command]
pub async fn vault_ensure_dek() -> Result<(), String> {
    Err("Direct master-key creation is disabled; use application encryption setup or verified master-key recovery.".to_string())
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
    reject_reserved_target(&service, &account)?;
    let verified = super::biometrics::verify(&reason)
        .await
        .map_err(|e| e.to_string())?;
    if !verified {
        return Err("Biometric verification did not succeed".to_string());
    }

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
    reject_reserved_target(&service, &account)?;
    let verified = super::biometrics::verify(&reason)
        .await
        .map_err(|e| e.to_string())?;
    if !verified {
        return Err("Biometric verification did not succeed".to_string());
    }

    keychain::read(&service, &account)
        .await
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Migration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Check if legacy storage needs migration.
#[tauri::command]
pub async fn vault_needs_migration(app: AppHandle) -> Result<bool, String> {
    Ok(migration::needs_migration(&managed_storage_path(&app)?))
}

/// Migrate legacy plain-JSON storage into vault-backed encrypted storage.
#[tauri::command]
pub async fn vault_migrate(
    app: AppHandle,
    old_password: Option<String>,
) -> Result<migration::MigrationResult, String> {
    migration::migrate(&managed_storage_path(&app)?, old_password.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// Load storage data from vault-backed encrypted file.
#[tauri::command]
pub async fn vault_load_storage(app: AppHandle) -> Result<String, String> {
    migration::load_vault_storage(&managed_storage_path(&app)?)
        .await
        .map_err(|e| e.to_string())
}

/// Save storage data to vault-backed encrypted file.
#[tauri::command]
pub async fn vault_save_storage(app: AppHandle, json_data: String) -> Result<(), String> {
    migration::save_vault_storage(&managed_storage_path(&app)?, &json_data)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod reserved_target_tests {
    use super::*;

    #[test]
    fn master_receipt_and_internal_slots_are_reserved_without_backend_access() {
        for (service, account) in [
            (SERVICE_NAME.to_string(), MASTER_DEK_ACCOUNT.to_string()),
            (
                format!(" {} ", SERVICE_NAME.to_uppercase()),
                format!(" {} ", MASTER_DEK_ACCOUNT.to_uppercase()),
            ),
            (
                "sortofremoteng.internal.database-key".to_string(),
                "slot".to_string(),
            ),
        ] {
            assert!(reject_reserved_target(&service, &account).is_err());
        }
        assert!(reject_reserved_target("com.integration.example", "api-token").is_ok());
        assert!(reject_reserved_target(SERVICE_NAME, "integration-account").is_ok());
        assert!(reject_reserved_target("other-service", MASTER_DEK_ACCOUNT).is_ok());
    }

    #[tokio::test]
    async fn ensure_compatibility_command_never_creates_a_key() {
        // This command is now pure refusal and must not consult an OS vault.
        assert!(vault_ensure_dek()
            .await
            .unwrap_err()
            .contains("verified master-key recovery"));
    }

    #[test]
    fn all_generic_crud_and_biometric_entrypoints_guard_before_backend_or_prompt() {
        // Source contract complements the pure guard fixture without invoking
        // real credentials or OS biometric prompts, even if a guard regresses.
        let source = include_str!("commands.rs");
        for name in [
            "vault_store_secret",
            "vault_read_secret",
            "vault_delete_secret",
            "vault_biometric_store",
            "vault_biometric_read",
        ] {
            let body = source
                .split(&format!("pub async fn {name}("))
                .nth(1)
                .unwrap()
                .split("\n}")
                .next()
                .unwrap();
            let guard = body
                .find("reject_reserved_target(&service, &account)?")
                .unwrap();
            let backend = body.find("keychain::").unwrap();
            assert!(guard < backend, "{name}");
            if let Some(prompt) = body.find("biometrics::verify") {
                assert!(guard < prompt, "{name}");
            }
        }
    }
}
