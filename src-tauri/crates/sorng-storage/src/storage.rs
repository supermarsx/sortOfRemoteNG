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

#[cfg(test)]
use aes_gcm::aead::{Aead, KeyInit};
#[cfg(test)]
use aes_gcm::{Aes256Gcm, Nonce};
#[cfg(test)]
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
#[cfg(test)]
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
    /// Master encryption-at-rest handle. When `Some` and unlocked,
    /// writes go through the v2 envelope codec
    /// (`sorng-v1::connections` sub-key); when `None` or locked,
    /// writes land as plain JSON. Installed via
    /// `set_encryption_state` after `app.manage(EncryptionState)`.
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

    /// On-disk path of the connections file. Exposed so the master-
    /// key rotation orchestrator (in the `app` crate) can re-encrypt
    /// it under a freshly rotated DEK without needing to know how
    /// the storage path was resolved at startup.
    pub fn store_path(&self) -> &str {
        &self.store_path
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
    /// Returns `true` iff the storage file on disk is the v2
    /// envelope (binary `SORNG\0` magic). The legacy `SORNG_ENC:`
    /// text envelope was retired in commit Z.
    pub async fn is_storage_encrypted(&self) -> Result<bool, String> {
        if !Path::new(&self.store_path).exists() {
            return Ok(false);
        }
        let data = fs::read(&self.store_path).map_err(|e| e.to_string())?;
        Ok(data.len() >= 6 && &data[..6] == sorng_encryption::envelope::MAGIC)
    }

    #[cfg(test)]
    fn derive_encryption_key(password: &str, salt: &[u8]) -> [u8; 32] {
        let mut key = [0u8; 32];
        pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, 600_000, &mut key);
        key
    }

    /// Test-only SORNG_ENC: writer. Production write path was retired
    /// in commit Y; this helper exists so legacy on-disk fixtures can
    /// be planted to prove the load path rejects them cleanly after
    /// commit Z's removal of the legacy reader.
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
    /// Test-only inverse of [`Self::encrypt_bytes`]. Used by the
    /// legacy-rejection test that proves the load path no longer
    /// accepts SORNG_ENC: fixtures.
    #[cfg(test)]
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
    pub async fn save_data(&self, data: StorageData, _use_password: bool) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;

        // Encryption dispatch — master DEK only. The `use_password`
        // arg is retained on the Tauri-facing API for backward-compat
        // with the previous serde shape but no longer influences
        // anything; the master key is the single source of truth.
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
        let raw_bytes = fs::read(&self.store_path).map_err(|e| e.to_string())?;

        // v2 envelope binary blob.
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

        // Plain JSON. The legacy SORNG_ENC: text envelope is no longer
        // accepted — files in that format error out as "invalid JSON"
        // so the user is forced through a fresh master-DEK setup.
        let raw = String::from_utf8(raw_bytes).map_err(|e| format!("UTF-8 decode: {}", e))?;
        let storage_data: StorageData =
            serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        Ok(Some(storage_data))
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
        // `use_password` is a vestigial no-op after the legacy
        // SORNG_ENC: write path was retired.
        self.save_data(data, false).await
    }
}

#[cfg(test)]
mod connections_dispatch_tests {
    //! Connections-database dispatch tests. The migrator + legacy
    //! reader were retired in commit Z; what remains is the v2-only
    //! write/read path, plus a guard that proves a stale on-disk
    //! `SORNG_ENC:` file is rejected rather than silently truncated.
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
            encryption_state: None,
        }
    }

    fn plant_sorng_enc_fixture(path: &str, payload: &StorageData, password: &str) {
        let json = serde_json::to_string_pretty(payload).unwrap();
        let encrypted = SecureStorage::encrypt_bytes(json.as_bytes(), password).unwrap();
        let encoded = general_purpose::STANDARD.encode(&encrypted);
        std::fs::write(path, format!("SORNG_ENC:{}", encoded)).unwrap();
    }

    #[tokio::test]
    async fn v2_envelope_used_when_state_unlocked() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut svc = build_storage(path.clone());
        svc.set_encryption_state(unlocked_state().await);

        svc.save_data(sample_data(), false).await.unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..6], sorng_encryption::envelope::MAGIC);

        let loaded = svc.load_data().await.unwrap().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0]["host"], "h.example");
    }

    #[tokio::test]
    async fn plaintext_path_when_no_state_installed() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let svc = build_storage(path.clone());

        svc.save_data(sample_data(), false).await.unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("c1"));
        // No legacy envelope, no v2 envelope — just JSON.
        assert!(!raw.starts_with("SORNG_ENC:"));
        let bytes = std::fs::read(&path).unwrap();
        assert_ne!(&bytes[..6.min(bytes.len())], sorng_encryption::envelope::MAGIC);
        let loaded = svc.load_data().await.unwrap().unwrap();
        assert_eq!(loaded.connections[0]["id"], "c1");
    }

    #[tokio::test]
    async fn locked_read_of_v2_surfaces_error() {
        // Defence in depth: a v2 file with a locked state must error
        // rather than silently fall through to plaintext.
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut svc = build_storage(path);
        svc.set_encryption_state(unlocked_state().await);
        svc.save_data(sample_data(), false).await.unwrap();

        let locked = Arc::new(EncryptionState::new());
        svc.set_encryption_state(locked);
        let err = svc.load_data().await.unwrap_err();
        assert!(err.contains("encrypted") || err.contains("unlock"));
    }

    #[tokio::test]
    async fn legacy_sorng_enc_fixture_is_rejected_on_load() {
        // Commit Z removed the legacy reader. A stray `SORNG_ENC:`
        // file on disk (from a pre-purge install that never ran the
        // migrator) must surface as a JSON parse error instead of
        // silently truncating to an empty connections list.
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        plant_sorng_enc_fixture(&path, &sample_data(), "hunter2");
        let svc = build_storage(path);
        let err = svc.load_data().await.unwrap_err();
        assert!(
            err.to_lowercase().contains("expected")
                || err.to_lowercase().contains("invalid"),
            "legacy SORNG_ENC: file must surface as a parse error, got: {err}"
        );
    }

    // ────────────────────────────────────────────────────────────────
    // Layer B — filesystem error paths, atomic-write recovery, and
    //          vault eviction simulations.
    // ────────────────────────────────────────────────────────────────

    fn unlocked_state_with_bytes(bytes: [u8; 32]) -> impl std::future::Future<Output = Arc<EncryptionState>> {
        async move {
            let s = EncryptionState::new();
            s.install(MasterDek::from_bytes(&bytes).unwrap()).await;
            Arc::new(s)
        }
    }

    #[tokio::test]
    async fn missing_parent_dir_creates_or_errors_cleanly() {
        // `atomic_write_bytes` does NOT auto-mkdir (see storage.rs:273).
        // Pointing at a non-existent multi-level parent surfaces a clean
        // OS-level error instead of a panic. Document: this layer does
        // NOT pre-create the parent.
        let tmp = tempdir().unwrap();
        let nested = tmp.path().join("nonexistent/deep/path/data.json");
        let path = nested.to_string_lossy().to_string();
        let svc = build_storage(path.clone());
        let result = svc.save_data(sample_data(), false).await;
        assert!(result.is_err(), "missing parent must error, not auto-mkdir");
        let err = result.unwrap_err();
        // Should mention the temp file write failure (no panic).
        assert!(
            err.to_lowercase().contains("failed to write")
                || err.to_lowercase().contains("temp")
                || err.to_lowercase().contains("system cannot")
                || err.to_lowercase().contains("no such"),
            "expected a clean fs error, got: {err}"
        );
        // The parent was NOT created — confirming non-mkdir behaviour.
        assert!(!nested.parent().unwrap().exists());
    }

    #[tokio::test]
    async fn garbage_canonical_file_surfaces_parse_error_on_load() {
        // 500 random bytes at the canonical path. After commit Z this
        // is dispatched as plaintext (vanishingly unlikely to start
        // with `SORNG\0`) and must produce a clean Err — either a
        // UTF-8 decode failure or a JSON parse failure.
        use rand::rngs::OsRng;
        use rand::RngCore;
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut garbage = vec![0u8; 500];
        OsRng.fill_bytes(&mut garbage);
        std::fs::write(&path, &garbage).unwrap();

        let svc = build_storage(path);
        let err = svc.load_data().await.unwrap_err();
        let lower = err.to_lowercase();
        assert!(
            lower.contains("utf")
                || lower.contains("expected")
                || lower.contains("invalid")
                || lower.contains("decrypt"),
            "expected a clean parse/decrypt error, got: {err}"
        );
    }

    #[tokio::test]
    async fn load_against_missing_file_returns_none() {
        // No file at the path → load_data must return Ok(None), per
        // the documented contract.
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let svc = build_storage(path);
        let loaded = svc.load_data().await.unwrap();
        assert!(loaded.is_none(), "missing file must yield Ok(None)");
    }

    #[tokio::test]
    async fn leftover_tmp_file_does_not_block_next_write() {
        // Pre-plant `data.json.tmp` (the atomic write's temp slot). A
        // normal write must succeed AND the leftover must no longer be
        // present (it gets overwritten then renamed away). The canonical
        // file holds the new content.
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let tmp_path = format!("{}.tmp", path);
        // Pre-plant: simulate a previously-killed writer.
        std::fs::write(&tmp_path, b"leftover garbage from prior crash").unwrap();

        let svc = build_storage(path.clone());
        svc.save_data(sample_data(), false).await.unwrap();

        // The leftover is gone (atomic write renamed the temp away).
        assert!(
            !std::path::Path::new(&tmp_path).exists(),
            "leftover .tmp must not survive a successful write"
        );
        // The canonical file holds the new content.
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("c1"), "canonical file must hold the new write");
    }

    #[tokio::test]
    async fn wrong_master_dek_after_eviction_fails_cleanly() {
        // Simulate: data written under state_a's DEK, vault evicts,
        // user imports the WRONG portable .dek into state_b. The load
        // must error clean (GCM auth tag mismatch), not panic and not
        // silently return empty.
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut svc = build_storage(path.clone());
        let state_a = unlocked_state_with_bytes([1u8; 32]).await;
        svc.set_encryption_state(state_a);
        svc.save_data(sample_data(), false).await.unwrap();

        // Drop state_a (out of scope on next assignment), install
        // state_b with DIFFERENT key bytes.
        let state_b = unlocked_state_with_bytes([2u8; 32]).await;
        svc.set_encryption_state(state_b);

        let err = svc.load_data().await.unwrap_err();
        let lower = err.to_lowercase();
        assert!(
            lower.contains("decrypt")
                || lower.contains("auth")
                || lower.contains("unlock")
                || lower.contains("invalid"),
            "wrong-key load must surface a clean error, got: {err}"
        );
    }

    #[tokio::test]
    async fn right_master_dek_after_eviction_decodes_cleanly() {
        // Same as above but the imported portable .dek matches —
        // load succeeds and the data round-trips.
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut svc = build_storage(path.clone());
        let state_a = unlocked_state_with_bytes([3u8; 32]).await;
        svc.set_encryption_state(state_a);
        svc.save_data(sample_data(), false).await.unwrap();

        // Install a state_b with the SAME bytes (correct import).
        let state_b = unlocked_state_with_bytes([3u8; 32]).await;
        svc.set_encryption_state(state_b);

        let loaded = svc.load_data().await.unwrap().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0]["host"], "h.example");
    }
}
