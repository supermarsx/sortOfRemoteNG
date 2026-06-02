//! # Secure Storage Service
//!
//! This module provides secure data persistence functionality for the SortOfRemote NG application.
//! It handles storing and retrieving application data including connections, settings, and other
//! configuration data with optional encryption support.
//!
//! ## Features
//!
//! - JSON-based data storage with pretty formatting
//! - Password-based encryption using AES-256-GCM with PBKDF2-HMAC-SHA256 key derivation
//! - Thread-safe operations with async mutex protection
//! - Data integrity verification via AES-GCM authenticated encryption
//! - Automatic data migration support
//! - Atomic writes (temp file + rename) to prevent data loss
//!
//! ## Data Structure
//!
//! The storage system uses a structured format containing:
//! - **connections**: Array of connection configurations
//! - **settings**: Key-value pairs for application settings
//! - **timestamp**: Unix timestamp of last modification
//!
//! ## Security
//!
//! Encryption uses AES-256-GCM with:
//! - 600,000 PBKDF2-HMAC-SHA256 iterations for key derivation
//! - 32-byte random salt per encryption
//! - 12-byte random nonce per encryption
//! - Authenticated encryption preventing tampering
//! - Encrypted files are prefixed with `SORNG_ENC:` magic bytes + base64 content
//!
//! ## Example
//!

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Represents the structure of data stored by the secure storage system.
///
/// This struct contains all application data that needs to be persisted,
/// including connection configurations, user settings, and metadata.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StorageData {
    /// Array of connection configurations stored as JSON values
    pub connections: Vec<serde_json::Value>,
    /// Key-value pairs for application settings and preferences
    pub settings: std::collections::HashMap<String, serde_json::Value>,
    /// Unix timestamp indicating when the data was last modified
    pub timestamp: u64,
    /// Generic key-value store for arbitrary application data
    #[serde(default)]
    pub app_data: std::collections::HashMap<String, String>,
}

/// Outcome of `migrate_to_master_dek`. Modelled as an enum so the
/// caller can render the right toast / UI affordance without parsing
/// strings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MigrationOutcome {
    /// No `data.json` existed at the configured path. The migrator
    /// did nothing; subsequent saves will land in v2 automatically.
    NoSourceFile,
    /// The file was already in the v2 envelope. No-op.
    AlreadyV2,
    /// Migration ran. `backup_path` points to the archived legacy
    /// file (renamed, not deleted) so the user has a one-release
    /// rollback window.
    Migrated { backup_path: String },
}

/// Type alias for the secure storage service state wrapped in an Arc<Mutex<>> for thread-safe access.
pub type SecureStorageState = Arc<Mutex<SecureStorage>>;

/// The main secure storage service for persisting application data.
///
/// This service handles all data persistence operations including saving, loading,
/// and clearing stored data. It supports optional password-based encryption
/// and provides thread-safe access to storage operations.
pub struct SecureStorage {
    /// File path where data is stored
    store_path: String,
    /// Optional password for the legacy `SORNG_ENC:` envelope
    /// (PBKDF2/600k AES-256-GCM, database-password-derived). Kept on
    /// the struct so the v0 → v2 migrator can decrypt the existing
    /// file before re-encrypting under the master DEK.
    password: Option<String>,
    /// Phase 8 — encryption-at-rest handle. When `Some` and unlocked,
    /// writes go through the v2 envelope codec
    /// (`sorng-v1::connections` sub-key) and reads transparently
    /// dispatch between v0 (`SORNG_ENC:` text prefix) and v2 (binary
    /// `SORNG\0` magic). Installed via `set_encryption_state` after
    /// `app.manage(EncryptionState)`.
    encryption_state:
        Option<Arc<sorng_encryption::EncryptionState>>,
}

impl SecureStorage {
    /// Creates a new secure storage instance.
    ///
    /// Initializes the storage service with the specified file path for data persistence.
    ///
    /// # Arguments
    ///
    /// * `store_path` - The file path where data should be stored (e.g., "data.json")
    ///
    /// # Returns
    ///
    /// A new `SecureStorageState` wrapped in an Arc<Mutex<>> for thread-safe access
    ///
    /// # Example
    ///
    pub fn new(store_path: String) -> SecureStorageState {
        Arc::new(Mutex::new(SecureStorage {
            store_path,
            password: None,
            encryption_state: None,
        }))
    }

    /// Inject the global `EncryptionState`. After this call, every
    /// `save_data` that finds the state unlocked writes through the
    /// v2 envelope, and `load_data` magic-byte sniffs between v0 / v2
    /// / plaintext. Safe to call multiple times — the latest handle
    /// replaces the previous one.
    pub fn set_encryption_state(
        &mut self,
        state: Arc<sorng_encryption::EncryptionState>,
    ) {
        self.encryption_state = Some(state);
    }

    /// Sets the password for storage encryption.
    ///
    /// Configures the password used for encrypting/decrypting stored data
    /// using AES-256-GCM with PBKDF2 key derivation.
    ///
    /// # Arguments
    ///
    /// * `password` - Optional password string for encryption, or None to disable encryption
    ///
    /// # Note
    ///
    /// Uses AES-256-GCM encryption with PBKDF2-HMAC-SHA256 key derivation.
    pub async fn set_password(&mut self, password: Option<String>) {
        self.password = password;
    }

    /// Checks if there is any stored data available.
    ///
    /// Determines whether a storage file exists at the configured path.
    ///
    /// # Returns
    ///
    /// `Ok(true)` if data exists, `Ok(false)` if no data is stored, `Err(String)` on error
    ///
    /// # Errors
    ///
    /// Returns an error if there are file system permission issues.
    pub async fn has_stored_data(&self) -> Result<bool, String> {
        Ok(Path::new(&self.store_path).exists())
    }

    /// Checks if the stored data is encrypted.
    ///
    /// Detects the `SORNG_ENC:` magic prefix that indicates encrypted content.
    ///
    /// # Returns
    ///
    /// `Ok(true)` if the file is encrypted, `Ok(false)` if plain JSON or missing
    ///
    /// # Note
    ///
    /// Returns true when the file starts with the `SORNG_ENC:` prefix.
    pub async fn is_storage_encrypted(&self) -> Result<bool, String> {
        if !Path::new(&self.store_path).exists() {
            return Ok(false);
        }
        let data = fs::read_to_string(&self.store_path).map_err(|e| e.to_string())?;
        // Encrypted files start with "SORNG_ENC:" magic prefix
        Ok(data.starts_with("SORNG_ENC:"))
    }

    /// Derive a 256-bit encryption key from a password using PBKDF2-HMAC-SHA256.
    fn derive_encryption_key(password: &str, salt: &[u8]) -> [u8; 32] {
        let mut key = [0u8; 32];
        pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, 600_000, &mut key);
        key
    }

    /// Legacy SORNG_ENC: envelope writer. No production caller remains
    /// after commit Y removed the legacy write branch from
    /// `save_data` — kept only so the migrator tests can plant the
    /// fixtures the old write path used to produce. Full purge along
    /// with the migrator happens in commit Z.
    #[cfg(test)]
    fn encrypt_bytes(data: &[u8], password: &str) -> Result<Vec<u8>, String> {
        use rand::rngs::OsRng;
        use rand::RngCore;
        let mut salt = [0u8; 32];
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut salt);
        OsRng.fill_bytes(&mut nonce_bytes);
        let key = Self::derive_encryption_key(password, &salt);
        let cipher = Aes256Gcm::new(&key.into());
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, data)
            .map_err(|e| format!("Encryption failed: {:?}", e))?;
        let mut combined = Vec::with_capacity(32 + 12 + ciphertext.len());
        combined.extend_from_slice(&salt);
        combined.extend_from_slice(&nonce_bytes);
        combined.extend(ciphertext);
        Ok(combined)
    }

    /// Decrypt data with AES-256-GCM.
    fn decrypt_bytes(combined: &[u8], password: &str) -> Result<Vec<u8>, String> {
        if combined.len() < 44 {
            return Err("Encrypted data too short".to_string());
        }
        let salt = &combined[..32];
        let nonce_bytes = &combined[32..44];
        let ciphertext = &combined[44..];

        let key = Self::derive_encryption_key(password, salt);
        let cipher = Aes256Gcm::new(&key.into());
        let nonce = Nonce::from_slice(nonce_bytes);

        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed (wrong password?): {:?}", e))
    }

    /// Saves data to persistent storage.
    ///
    /// Serializes the provided data to JSON format and writes it to the storage file.
    /// Currently saves data without encryption regardless of the `use_password` parameter.
    ///
    /// # Arguments
    ///
    /// * `data` - The `StorageData` to save
    /// * `use_password` - Whether to encrypt using the configured password
    ///
    /// # Returns
    ///
    /// `Ok(())` if saving succeeded, `Err(String)` containing the error message if it failed
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - JSON serialization fails
    /// - File write operations fail
    /// - File system permissions are insufficient
    ///
    /// # Example
    ///
    pub async fn save_data(&self, data: StorageData, use_password: bool) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;

        // Encryption dispatch (legacy SORNG_ENC: write path removed):
        //   1. v2 envelope — when the master-key state is installed
        //      and unlocked. Master DEK drives sub-key derivation; no
        //      database password needed. Produced as binary.
        //   2. Plain JSON — otherwise. The legacy SORNG_ENC: text
        //      envelope is no longer written; the read + migrator
        //      paths below remain until the next commit purges them.
        //
        // `use_password` is retained on the API for backward-compat
        // but no longer influences write dispatch. The master key is
        // the single source of truth.
        let _ = use_password;
        let used_v2 = self.encryption_state.is_some()
            && self
                .encryption_state
                .as_ref()
                .unwrap()
                .is_unlocked()
                .await;

        if used_v2 {
            let state = self.encryption_state.as_ref().unwrap();
            let value: serde_json::Value =
                serde_json::from_str(&json).map_err(|e| e.to_string())?;
            let mode = sorng_encryption::envelope::MasterKeyStorage::Vault;
            let blob = sorng_encryption::artifacts::connections::write(
                state,
                &value,
                mode,
                sorng_encryption::password_wrap::Argon2Params::OWASP,
                [0u8; sorng_encryption::envelope::SALT_LEN],
            )
            .await
            .map_err(|e| format!("v2 connections encrypt: {e}"))?;
            return Self::atomic_write_bytes(&self.store_path, &blob);
        }

        let content = json;

        // Atomic write: write to a temp file first, then rename.
        // This prevents data loss if the process crashes mid-write.
        Self::atomic_write_bytes(&self.store_path, content.as_bytes())
    }

    /// Atomic-write helper shared by every encoding path.
    fn atomic_write_bytes(path: &str, bytes: &[u8]) -> Result<(), String> {
        let tmp_path = format!("{}.tmp", path);
        fs::write(&tmp_path, bytes).map_err(|e| format!("Failed to write temp file: {}", e))?;
        fs::rename(&tmp_path, path)
            .map_err(|e| format!("Failed to rename temp file: {}", e))
    }

    /// Detect the v2 connections envelope by its binary magic prefix.
    /// `SORNG_ENC:` text-prefixed files start with `S` too but the
    /// second byte is `O` (0x4F) followed by `R`, then the literal
    /// underscore — `SORNG_ENC:` is 10 ASCII bytes. The v2 envelope is
    /// `SORNG\0` (6 bytes), so the discriminator is the 6th byte:
    /// `\0` for v2 vs `_` for legacy.
    fn is_v2_connections_blob(bytes: &[u8]) -> bool {
        bytes.len() >= 6 && &bytes[..6] == sorng_encryption::envelope::MAGIC
    }

    /// Loads data from persistent storage.
    ///
    /// Reads and deserializes data from the storage file if it exists.
    ///
    /// # Returns
    ///
    /// `Ok(Some(StorageData))` if data exists and was loaded successfully,
    /// `Ok(None)` if no data file exists, `Err(String)` if loading failed
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The file cannot be read
    /// - JSON deserialization fails
    /// - File system permissions are insufficient
    ///
    /// # Example
    ///
    pub async fn load_data(&self) -> Result<Option<StorageData>, String> {
        if !Path::new(&self.store_path).exists() {
            return Ok(None);
        }
        // Read as bytes so the v2 binary envelope sniff works without
        // a UTF-8 decode error. v0 (`SORNG_ENC:` text) and plain JSON
        // are still valid UTF-8 and reconstruct losslessly via
        // `String::from_utf8`.
        let raw_bytes = fs::read(&self.store_path).map_err(|e| e.to_string())?;

        // ── v2 envelope (Phase 8) ──────────────────────────────────
        if Self::is_v2_connections_blob(&raw_bytes) {
            let state = self.encryption_state.as_ref().ok_or_else(|| {
                "data.enc requires master encryption state to be installed".to_string()
            })?;
            if !state.is_unlocked().await {
                return Err(
                    "Connections database is encrypted; unlock first via Settings → Security"
                        .into(),
                );
            }
            let value = sorng_encryption::artifacts::connections::read(state, &raw_bytes)
                .await
                .map_err(|e| format!("v2 connections decrypt: {e}"))?
                .unwrap_or_else(|| serde_json::json!({}));
            let storage_data: StorageData =
                serde_json::from_value(value).map_err(|e| e.to_string())?;
            return Ok(Some(storage_data));
        }

        // ── v0 (`SORNG_ENC:` text) or plain JSON ───────────────────
        let raw = String::from_utf8(raw_bytes).map_err(|e| format!("UTF-8 decode: {}", e))?;
        if let Some(encoded) = raw.strip_prefix("SORNG_ENC:") {
            // Encrypted data
            let password = self
                .password
                .as_ref()
                .ok_or_else(|| "Storage is encrypted but no password is set".to_string())?;
            let combined = general_purpose::STANDARD
                .decode(encoded.as_bytes())
                .map_err(|e| format!("Base64 decode: {}", e))?;
            let json_bytes = Self::decrypt_bytes(&combined, password)?;
            let json_str =
                String::from_utf8(json_bytes).map_err(|e| format!("UTF-8 decode: {}", e))?;
            let storage_data: StorageData =
                serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
            Ok(Some(storage_data))
        } else {
            // Plain JSON
            let storage_data: StorageData =
                serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            Ok(Some(storage_data))
        }
    }

    /// One-shot migration of `data.json` from the legacy `SORNG_ENC:`
    /// or plaintext format to the v2 envelope under the master DEK.
    ///
    /// Behaviour:
    /// - When the file is already v2 → returns `Ok(MigrationOutcome::AlreadyV2)`.
    /// - When the file is v0 (`SORNG_ENC:`) → caller must pass the
    ///   database password used to write it. The migrator decrypts
    ///   with PBKDF2, archives the original to `<path>.v0.bak`, then
    ///   re-encrypts under the master DEK.
    /// - When the file is plain JSON → archives to `<path>.v0.bak`
    ///   and re-encrypts under the master DEK. No password needed.
    ///
    /// Requires the encryption state to be installed and unlocked.
    /// The legacy database password is consumed once and then no
    /// longer needed for subsequent reads — the master key drives
    /// everything.
    pub async fn migrate_to_master_dek(
        &mut self,
        legacy_password: Option<&str>,
    ) -> Result<MigrationOutcome, String> {
        // Pre-flight checks before touching disk.
        let state = self
            .encryption_state
            .clone()
            .ok_or_else(|| "encryption state not installed; cannot migrate".to_string())?;
        if !state.is_unlocked().await {
            return Err("master key is locked; unlock before migrating".into());
        }
        if !Path::new(&self.store_path).exists() {
            return Ok(MigrationOutcome::NoSourceFile);
        }
        let raw_bytes = fs::read(&self.store_path).map_err(|e| e.to_string())?;
        if Self::is_v2_connections_blob(&raw_bytes) {
            return Ok(MigrationOutcome::AlreadyV2);
        }
        // Decrypt or parse depending on the legacy format.
        let plaintext_json: String = if raw_bytes.starts_with(b"SORNG_ENC:") {
            let password = legacy_password
                .ok_or_else(|| {
                    "legacy database password required to decrypt the existing data.json".to_string()
                })?;
            let raw = String::from_utf8(raw_bytes).map_err(|e| format!("UTF-8: {}", e))?;
            let encoded = raw.strip_prefix("SORNG_ENC:").unwrap();
            let combined = general_purpose::STANDARD
                .decode(encoded.as_bytes())
                .map_err(|e| format!("Base64 decode: {}", e))?;
            let json_bytes = Self::decrypt_bytes(&combined, password)?;
            String::from_utf8(json_bytes).map_err(|e| format!("UTF-8 decode: {}", e))?
        } else {
            // Plain JSON case — already plaintext.
            String::from_utf8(raw_bytes).map_err(|e| format!("UTF-8 decode: {}", e))?
        };

        // Sanity-parse the recovered JSON to bail out with a clean
        // error before we archive anything. The migrator must never
        // delete the legacy file if it can't actually parse its
        // contents — that would be silent data loss.
        let value: serde_json::Value =
            serde_json::from_str(&plaintext_json).map_err(|e| e.to_string())?;

        // Encode the v2 envelope first, in memory. Only after the
        // encrypt-and-encode succeeds do we touch the file system.
        let mode = sorng_encryption::envelope::MasterKeyStorage::Vault;
        let blob = sorng_encryption::artifacts::connections::write(
            &state,
            &value,
            mode,
            sorng_encryption::password_wrap::Argon2Params::OWASP,
            [0u8; sorng_encryption::envelope::SALT_LEN],
        )
        .await
        .map_err(|e| format!("v2 connections encrypt: {e}"))?;

        // Atomic flip: archive the legacy file (rename, not copy, so
        // the source path is free to be overwritten in the same
        // transaction), then write the v2 blob to the canonical path.
        let backup_path = format!("{}.v0.bak", &self.store_path);
        fs::rename(&self.store_path, &backup_path)
            .map_err(|e| format!("archive legacy data.json: {e}"))?;
        if let Err(e) = Self::atomic_write_bytes(&self.store_path, &blob) {
            // Best-effort rollback: restore the backup so the user
            // doesn't end up with nothing on disk.
            let _ = fs::rename(&backup_path, &self.store_path);
            return Err(e);
        }
        // The legacy database password is no longer load-bearing.
        // Clear it so an attacker who later reads service memory
        // doesn't recover both wrapping keys.
        self.password = None;
        Ok(MigrationOutcome::Migrated { backup_path })
    }

    /// Clears all stored data by deleting the storage file.
    ///
    /// Permanently removes the storage file and all its contents.
    /// This action cannot be undone.
    ///
    /// # Returns
    ///
    /// `Ok(())` if clearing succeeded or file didn't exist, `Err(String)` if deletion failed
    ///
    /// # Errors
    ///
    /// Returns an error if the file exists but cannot be deleted due to permissions.
    ///
    /// # Example
    ///
    pub async fn clear_storage(&self) -> Result<(), String> {
        if Path::new(&self.store_path).exists() {
            fs::remove_file(&self.store_path).map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }

    /// Read a value by key from app data storage.
    ///
    /// Loads the current storage data and returns the value associated with the
    /// given key from the `app_data` map, if it exists.
    ///
    /// # Arguments
    ///
    /// * `key` - The key to look up in the app data store
    ///
    /// # Returns
    ///
    /// `Ok(Some(String))` if the key exists, `Ok(None)` if the key is not found
    /// or no storage data exists, `Err(String)` on read errors
    pub async fn read_app_data(&self, key: &str) -> Result<Option<String>, String> {
        let data = self.load_data().await?;
        Ok(data.and_then(|d| d.app_data.get(key).cloned()))
    }

    /// Write a value by key to app data storage.
    ///
    /// Loads the current storage data (or creates a new default), inserts or updates
    /// the key-value pair in the `app_data` map, and persists the result to disk.
    ///
    /// # Arguments
    ///
    /// * `key` - The key to store the value under
    /// * `value` - The string value to store
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, `Err(String)` on read or write errors
    pub async fn write_app_data(&self, key: &str, value: &str) -> Result<(), String> {
        let mut data = self.load_data().await?.unwrap_or_else(|| StorageData {
            connections: Vec::new(),
            settings: std::collections::HashMap::new(),
            timestamp: 0,
            app_data: std::collections::HashMap::new(),
        });
        data.app_data.insert(key.to_string(), value.to_string());
        data.timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let use_password = self.password.is_some();
        self.save_data(data, use_password).await
    }
}

#[cfg(test)]
mod phase_8_migration_tests {
    //! Phase 8 — `data.json` → v2 envelope migration test plan.
    //!
    //! Exercises every branch the migrator can hit, with an emphasis
    //! on the credential-recovery cases the advisor flagged as load-
    //! bearing: locked-state guard, wrong-password rejection without
    //! data loss, partial-write rollback. These are the discriminating
    //! tests, not the `cargo test` count.
    use super::*;
    use sorng_encryption::{EncryptionState, MasterDek};
    use tempfile::tempdir;

    async fn unlocked_state() -> Arc<EncryptionState> {
        let s = EncryptionState::new();
        s.install(MasterDek::from_bytes(&[7u8; 32]).unwrap()).await;
        Arc::new(s)
    }

    fn sample_data() -> StorageData {
        StorageData {
            connections: vec![serde_json::json!({ "id": "c1", "host": "h.example" })],
            settings: std::collections::HashMap::new(),
            timestamp: 1_700_000_000,
            app_data: std::collections::HashMap::new(),
        }
    }

    fn build_storage(path: String) -> SecureStorage {
        SecureStorage {
            store_path: path,
            password: None,
            encryption_state: None,
        }
    }

    #[tokio::test]
    async fn v2_envelope_used_when_state_unlocked() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut svc = build_storage(path.clone());
        svc.set_encryption_state(unlocked_state().await);

        svc.save_data(sample_data(), false).await.unwrap();
        // The on-disk magic must be the binary v2 envelope, not the
        // legacy `SORNG_ENC:` ASCII prefix.
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(
            &bytes[..6],
            sorng_encryption::envelope::MAGIC,
            "v2 envelope must win when state is unlocked"
        );

        let loaded = svc.load_data().await.unwrap().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0]["host"], "h.example");
    }

    /// Plant a `SORNG_ENC:`-format fixture at the configured path
    /// using the test-only `encrypt_bytes` helper. Required after
    /// commit Y removed the legacy write path from `save_data`.
    fn plant_sorng_enc_fixture(path: &str, payload: &StorageData, password: &str) {
        let json = serde_json::to_string_pretty(payload).unwrap();
        let encrypted = SecureStorage::encrypt_bytes(json.as_bytes(), password).unwrap();
        let encoded = general_purpose::STANDARD.encode(&encrypted);
        std::fs::write(path, format!("SORNG_ENC:{}", encoded)).unwrap();
    }

    #[tokio::test]
    async fn plaintext_path_when_no_state_installed() {
        // Commit Y removed the legacy SORNG_ENC: write path from
        // `save_data`. With no encryption state installed, even with a
        // legacy database password configured, new writes are plain
        // JSON. The migrator path still handles existing SORNG_ENC:
        // files on disk (covered by `migrate_legacy_to_v2_round_trips`).
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut svc = build_storage(path.clone());
        svc.set_password(Some("hunter2".to_string())).await;

        svc.save_data(sample_data(), true).await.unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(
            !raw.starts_with("SORNG_ENC:"),
            "legacy SORNG_ENC: write path was removed in commit Y"
        );
        let loaded = svc.load_data().await.unwrap().unwrap();
        assert_eq!(loaded.connections.len(), 1);
    }

    #[tokio::test]
    async fn legacy_sorng_enc_files_still_readable_via_migrator() {
        // The legacy *read* + decrypt path is retained for the
        // migrator. A SORNG_ENC: file planted by the test helper must
        // still load cleanly when the legacy database password is
        // configured.
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        plant_sorng_enc_fixture(&path, &sample_data(), "hunter2");

        let mut svc = build_storage(path.clone());
        svc.set_password(Some("hunter2".to_string())).await;
        let loaded = svc.load_data().await.unwrap().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0]["id"], "c1");
    }

    #[tokio::test]
    async fn migrate_legacy_to_v2_round_trips() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();

        // Phase A: plant a legacy SORNG_ENC: fixture directly (the
        // production write path no longer produces them after commit Y).
        plant_sorng_enc_fixture(&path, &sample_data(), "hunter2");
        let mut svc = build_storage(path.clone());
        svc.set_password(Some("hunter2".to_string())).await;

        // Phase B: install the master DEK and migrate. The legacy
        // password must round-trip the decrypt-then-re-encrypt without
        // dropping any field.
        svc.set_encryption_state(unlocked_state().await);
        let outcome = svc.migrate_to_master_dek(Some("hunter2")).await.unwrap();
        let backup_path = match outcome {
            MigrationOutcome::Migrated { backup_path } => backup_path,
            other => panic!("expected Migrated, got {other:?}"),
        };
        assert!(std::path::Path::new(&backup_path).exists());
        // The file at the canonical path is now a v2 envelope.
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..6], sorng_encryption::envelope::MAGIC);
        // Loading still recovers the same data.
        let loaded = svc.load_data().await.unwrap().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0]["id"], "c1");
        assert_eq!(loaded.timestamp, 1_700_000_000);
    }

    #[tokio::test]
    async fn migrate_plain_json_to_v2() {
        // A user who never set a database password: file is plain
        // JSON. Migration must accept `None` for the legacy password.
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();

        let mut svc = build_storage(path.clone());
        svc.save_data(sample_data(), false).await.unwrap();
        // Confirm we started as plain JSON.
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("c1"));
        assert!(!raw.starts_with("SORNG_ENC:"));

        svc.set_encryption_state(unlocked_state().await);
        let outcome = svc.migrate_to_master_dek(None).await.unwrap();
        assert!(matches!(outcome, MigrationOutcome::Migrated { .. }));
        let loaded = svc.load_data().await.unwrap().unwrap();
        assert_eq!(loaded.connections[0]["id"], "c1");
    }

    #[tokio::test]
    async fn migrate_wrong_password_does_not_destroy_legacy_file() {
        // The safety-critical case the advisor highlighted: a wrong
        // legacy password must not delete or rename the source file.
        // The user must keep their data intact and be able to retry.
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();

        plant_sorng_enc_fixture(&path, &sample_data(), "correct");
        let mut svc = build_storage(path.clone());
        svc.set_password(Some("correct".to_string())).await;
        let legacy_before = std::fs::read(&path).unwrap();

        svc.set_encryption_state(unlocked_state().await);
        let err = svc
            .migrate_to_master_dek(Some("WRONG"))
            .await
            .unwrap_err();
        assert!(err.contains("Decryption failed") || err.contains("wrong password"));
        // File still on disk, byte-identical.
        let legacy_after = std::fs::read(&path).unwrap();
        assert_eq!(legacy_before, legacy_after);
        // Backup not created.
        assert!(!std::path::Path::new(&format!("{}.v0.bak", path)).exists());
    }

    #[tokio::test]
    async fn migrate_already_v2_is_noop() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut svc = build_storage(path.clone());
        svc.set_encryption_state(unlocked_state().await);
        svc.save_data(sample_data(), false).await.unwrap();
        let before = std::fs::read(&path).unwrap();
        let outcome = svc.migrate_to_master_dek(None).await.unwrap();
        assert!(matches!(outcome, MigrationOutcome::AlreadyV2));
        // File untouched.
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[tokio::test]
    async fn migrate_missing_source_returns_no_source_file() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut svc = build_storage(path);
        svc.set_encryption_state(unlocked_state().await);
        let outcome = svc.migrate_to_master_dek(None).await.unwrap();
        assert!(matches!(outcome, MigrationOutcome::NoSourceFile));
    }

    #[tokio::test]
    async fn migrate_requires_unlocked_state() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut svc = build_storage(path.clone());
        svc.save_data(sample_data(), false).await.unwrap();
        // Install but don't unlock.
        let locked = Arc::new(EncryptionState::new());
        svc.set_encryption_state(locked);
        let err = svc.migrate_to_master_dek(None).await.unwrap_err();
        assert!(err.contains("locked"));
        // Source untouched.
        assert!(std::fs::read_to_string(&path).unwrap().contains("c1"));
    }

    #[tokio::test]
    async fn locked_read_of_v2_surfaces_error() {
        // A v2 file on disk + a locked state must NOT silently fall
        // through to plaintext — that's the silent-downgrade attack
        // vector the settings dispatch already defends against.
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut svc = build_storage(path.clone());
        svc.set_encryption_state(unlocked_state().await);
        svc.save_data(sample_data(), false).await.unwrap();

        let locked = Arc::new(EncryptionState::new());
        svc.set_encryption_state(locked);
        let err = svc.load_data().await.unwrap_err();
        assert!(err.contains("encrypted") || err.contains("unlock"));
    }

    #[tokio::test]
    async fn migrate_clears_legacy_password_on_success() {
        // Defence in depth: once the master DEK is doing all the
        // wrapping, the database password is no longer needed and
        // shouldn't linger in service memory.
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut svc = build_storage(path);
        svc.set_password(Some("hunter2".to_string())).await;
        svc.save_data(sample_data(), true).await.unwrap();
        svc.set_encryption_state(unlocked_state().await);
        svc.migrate_to_master_dek(Some("hunter2")).await.unwrap();
        assert!(svc.password.is_none());
    }
}
