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
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_VAULT_STORAGE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_VAULT_META_BYTES: u64 = 16 * 1024;

fn regular_file_size(path: &Path, label: &str) -> VaultResult<u64> {
    let metadata =
        fs::symlink_metadata(path).map_err(|e| VaultError::io(format!("{label} metadata: {e}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(VaultError::access_denied(format!(
            "{label} must be a regular non-symlink file"
        )));
    }
    Ok(metadata.len())
}

fn read_limited_utf8(path: &Path, label: &str, max_bytes: u64) -> VaultResult<String> {
    let size = regular_file_size(path, label)?;
    if size > max_bytes {
        return Err(VaultError::access_denied(format!(
            "{label} exceeds the {max_bytes} byte safety limit"
        )));
    }
    fs::read_to_string(path).map_err(|e| VaultError::io(format!("Read {label}: {e}")))
}

fn validate_vault_meta(storage_path: &Path) -> VaultResult<()> {
    let raw = read_limited_utf8(
        &vault_meta_path(storage_path),
        "vault metadata",
        MAX_VAULT_META_BYTES,
    )?;
    let meta: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| VaultError::serde(format!("Vault metadata JSON: {e}")))?;
    if meta.get("version").and_then(serde_json::Value::as_u64) != Some(1)
        || meta.get("encryption").and_then(serde_json::Value::as_str) != Some("aes-256-gcm")
        || meta.get("kdf").and_then(serde_json::Value::as_str) != Some("vault-dek")
    {
        return Err(VaultError::migration(
            "Unsupported or malformed vault metadata",
        ));
    }
    Ok(())
}

fn durable_write(path: &Path, bytes: &[u8], label: &str) -> VaultResult<()> {
    let parent = path
        .parent()
        .filter(|directory| !directory.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .map_err(|e| VaultError::io(format!("Create {label} directory: {e}")))?;

    let mut temporary = tempfile::Builder::new()
        .prefix(".sorng-vault-")
        .suffix(".tmp")
        .tempfile_in(parent)
        .map_err(|e| VaultError::io(format!("Create temporary {label}: {e}")))?;
    temporary
        .write_all(bytes)
        .map_err(|e| VaultError::io(format!("Write temporary {label}: {e}")))?;
    temporary
        .as_file_mut()
        .sync_all()
        .map_err(|e| VaultError::io(format!("Sync temporary {label}: {e}")))?;
    temporary
        .persist(path)
        .map_err(|e| VaultError::io(format!("Replace {label}: {}", e.error)))?;

    #[cfg(unix)]
    {
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|e| VaultError::io(format!("Sync {label} directory: {e}")))?;
    }

    Ok(())
}

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
    if regular_file_size(storage_path, "storage").is_err() {
        return false;
    }
    validate_vault_meta(storage_path).is_err()
}

/// Perform the migration from legacy storage to vault-backed storage.
///
/// If `old_password` is `Some`, the legacy file is assumed to be
/// password-encrypted and will be decrypted first.
pub async fn migrate(
    storage_path: &Path,
    old_password: Option<&str>,
) -> VaultResult<MigrationResult> {
    // 1. Read the raw file contents
    let raw = read_limited_utf8(storage_path, "storage", MAX_VAULT_STORAGE_BYTES)?;

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

    // 5. Create a durable, unique backup before replacing the original.
    let backup_path =
        storage_path.with_extension(format!("pre-vault-{}.bak", Uuid::new_v4().simple()));
    durable_write(&backup_path, raw.as_bytes(), "pre-vault backup")?;

    // 6. Prepare metadata and durably replace the storage file.
    let encrypted_b64 = base64::engine::general_purpose::STANDARD.encode(&encrypted);
    let meta = serde_json::json!({
        "version": 1,
        "migrated_at": chrono::Utc::now().to_rfc3339(),
        "backend": keychain::backend_name(),
        "encryption": "aes-256-gcm",
        "kdf": "vault-dek",
    });
    let meta_path = vault_meta_path(storage_path);
    let meta_bytes = serde_json::to_vec_pretty(&meta)
        .map_err(|e| VaultError::serde(format!("Vault metadata JSON: {e}")))?;

    durable_write(storage_path, encrypted_b64.as_bytes(), "encrypted storage")?;
    if let Err(meta_error) = durable_write(&meta_path, &meta_bytes, "vault metadata") {
        let rollback = durable_write(storage_path, raw.as_bytes(), "migration rollback");
        let _ = fs::remove_file(&meta_path);
        return match rollback {
            Ok(()) => Err(meta_error),
            Err(rollback_error) => Err(VaultError::migration(format!(
                "Metadata write failed ({meta_error}); rollback also failed ({rollback_error}); recover from {}",
                backup_path.display()
            ))),
        };
    }

    Ok(MigrationResult {
        success: true,
        message: "Migration to vault-backed storage complete".into(),
        backup_path: Some(backup_path.display().to_string()),
        was_encrypted,
        vault_backed: true,
    })
}

/// Load vault-backed storage data (decrypt with DEK from OS vault).
pub async fn load_vault_storage(storage_path: &Path) -> VaultResult<String> {
    validate_vault_meta(storage_path)?;
    let encrypted_b64 = read_limited_utf8(storage_path, "vault storage", MAX_VAULT_STORAGE_BYTES)?;

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
    validate_vault_meta(storage_path)?;
    if json_data.len() as u64 > MAX_VAULT_STORAGE_BYTES {
        return Err(VaultError::access_denied(format!(
            "Vault storage exceeds the {MAX_VAULT_STORAGE_BYTES} byte safety limit"
        )));
    }
    serde_json::from_str::<serde_json::Value>(json_data)
        .map_err(|e| VaultError::serde(format!("Vault storage JSON: {e}")))?;

    let dek = keychain::ensure_dek().await?;
    let dek_array: [u8; 32] = dek
        .try_into()
        .map_err(|_| VaultError::internal("DEK is not 32 bytes"))?;

    let encrypted = envelope::encrypt_with_key(&dek_array, json_data.as_bytes())?;
    let encrypted_b64 = base64::engine::general_purpose::STANDARD.encode(&encrypted);

    durable_write(storage_path, encrypted_b64.as_bytes(), "vault storage")?;

    Ok(())
}

// ── helpers ─────────────────────────────────────────────────────────

fn vault_meta_path(storage_path: &Path) -> PathBuf {
    storage_path.with_extension("vault-meta")
}
