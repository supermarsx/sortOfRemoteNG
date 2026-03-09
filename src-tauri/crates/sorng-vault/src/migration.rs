//! Migrate legacy plain-JSON storage into the vault-backed encrypted storage.
//!
//! ## Migration flow
//!
//! 1. Read existing `storage.json` (may be plaintext or password-encrypted)
//! 2. Generate a 256-bit DEK and store it in the OS vault
//! 3. Re-encrypt the storage data with the DEK
//! 4. Write the new encrypted storage file
//! 5. Rename the old file as `.bak`

use crate::types::*;
use crate::{envelope, keychain};
use base64::Engine as _;
use std::fs;
use std::path::{Path, PathBuf};

/// Result of a migration attempt.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub success: bool,
    pub message: String,
    /// Path to the backup of the old file (if created).
    pub backup_path: Option<String>,
    /// Was the old storage encrypted?
    pub was_encrypted: bool,
    /// Is the new storage vault-backed?
    pub vault_backed: bool,
}

/// Check if a legacy storage file exists and should be migrated.
pub fn needs_migration(storage_path: &Path) -> bool {
    if !storage_path.exists() {
        return false;
    }
    // Check if the file has a companion `.vault-meta` sidecar — if so, it's already migrated.
    let meta_path = vault_meta_path(storage_path);
    !meta_path.exists()
}

/// Perform the migration from legacy storage to vault-backed storage.
///
/// If `old_password` is `Some`, the legacy file is assumed to be
/// password-encrypted and will be decrypted first.
pub async fn migrate(
    storage_path: &Path,
    old_password: Option<&str>,
) -> VaultResult<MigrationResult> {
    if !storage_path.exists() {
        return Err(VaultError::io("Storage file does not exist"));
    }

    // 1. Read the raw file contents
    let raw = fs::read_to_string(storage_path)
        .map_err(|e| VaultError::io(format!("Read storage: {e}")))?;

    // 2. Determine if the old file is encrypted
    let (plaintext_json, was_encrypted) = if let Some(_pw) = old_password {
        // The frontend encryption format is: base64(salt ++ nonce ++ ciphertext)
        // We try to parse as JSON first — if it works, it's plaintext.
        match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(_) => (raw.clone(), false),
            Err(_) => {
                // Assume it's the frontend's PBKDF2+AES-GCM format.
                // We can't decrypt it here because we don't have the Web Crypto API.
                // Instead, mark that migration needs the frontend to first decrypt.
                return Err(VaultError::migration(
                    "Legacy file appears encrypted with frontend PBKDF2 — \
                     please unlock via the UI first, then retry migration",
                ));
            }
        }
    } else {
        // Assume plaintext JSON
        match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(_) => (raw.clone(), false),
            Err(_) => {
                return Err(VaultError::migration(
                    "Legacy file is not valid JSON and no password was provided",
                ));
            }
        }
    };

    // 3. Ensure a DEK exists in the OS vault
    let dek = keychain::ensure_dek().await?;

    // 4. Encrypt the plaintext JSON with the DEK
    let dek_array: [u8; 32] = dek
        .try_into()
        .map_err(|_| VaultError::internal("DEK is not 32 bytes"))?;
    let encrypted = envelope::encrypt_with_key(&dek_array, plaintext_json.as_bytes())?;

    // 5. Write the encrypted storage file
    let encrypted_b64 = base64::engine::general_purpose::STANDARD.encode(&encrypted);
    fs::write(storage_path, &encrypted_b64)
        .map_err(|e| VaultError::io(format!("Write encrypted storage: {e}")))?;

    // 6. Write the vault-meta sidecar (marks migration complete)
    let meta = serde_json::json!({
        "version": 1,
        "migrated_at": chrono::Utc::now().to_rfc3339(),
        "backend": keychain::backend_name(),
        "encryption": "aes-256-gcm",
        "kdf": "vault-dek",
    });
    let meta_path = vault_meta_path(storage_path);
    fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap())
        .map_err(|e| VaultError::io(format!("Write vault meta: {e}")))?;

    // 7. Backup the original (we already overwrote it, but log the action)
    let backup_path = storage_path.with_extension("json.pre-vault-bak");
    // We only keep the backup if we can write it.  The original data is `raw`.
    let backup_path_str = if fs::write(&backup_path, &raw).is_ok() {
        Some(backup_path.display().to_string())
    } else {
        None
    };

    Ok(MigrationResult {
        success: true,
        message: "Migration to vault-backed storage complete".into(),
        backup_path: backup_path_str,
        was_encrypted,
        vault_backed: true,
    })
}

/// Load vault-backed storage data (decrypt with DEK from OS vault).
pub async fn load_vault_storage(storage_path: &Path) -> VaultResult<String> {
    let encrypted_b64 = fs::read_to_string(storage_path)
        .map_err(|e| VaultError::io(format!("Read vault storage: {e}")))?;

    let encrypted = base64::engine::general_purpose::STANDARD
        .decode(encrypted_b64.trim())
        .map_err(|e| VaultError::crypto(format!("Base64 decode: {e}")))?;

    let dek = keychain::read_dek().await?;
    let dek_array: [u8; 32] = dek
        .try_into()
        .map_err(|_| VaultError::internal("DEK is not 32 bytes"))?;

    let plaintext = envelope::decrypt_with_key(&dek_array, &encrypted)?;

    String::from_utf8(plaintext)
        .map_err(|e| VaultError::serde(format!("Decrypted data is not UTF-8: {e}")))
}

/// Save data to vault-backed storage (encrypt with DEK from OS vault).
pub async fn save_vault_storage(storage_path: &Path, json_data: &str) -> VaultResult<()> {
    let dek = keychain::ensure_dek().await?;
    let dek_array: [u8; 32] = dek
        .try_into()
        .map_err(|_| VaultError::internal("DEK is not 32 bytes"))?;

    let encrypted = envelope::encrypt_with_key(&dek_array, json_data.as_bytes())?;
    let encrypted_b64 = base64::engine::general_purpose::STANDARD.encode(&encrypted);

    fs::write(storage_path, &encrypted_b64)
        .map_err(|e| VaultError::io(format!("Write vault storage: {e}")))?;

    Ok(())
}

// ── helpers ─────────────────────────────────────────────────────────

fn vault_meta_path(storage_path: &Path) -> PathBuf {
    storage_path.with_extension("vault-meta")
}
