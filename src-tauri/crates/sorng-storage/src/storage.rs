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
use sorng_encryption::settings_coordinator::{self, SettingsWriteGuard};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

const MAX_STORAGE_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_STORAGE_PLAINTEXT_BYTES: usize = (255 * 1024 * 1024) as usize;

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

/// Appdata IPC transaction. Acquire the coordinator BEFORE the service mutex,
/// matching artifact management and master-key rotation. Field order releases
/// the service before the coordinator. Guarded helpers never reacquire a lease;
/// mutable access prevents overlapping operations through the same transaction.
pub struct AppDataStorageGuard<'a> {
    storage: tokio::sync::MutexGuard<'a, SecureStorage>,
    coordinator: SettingsWriteGuard,
}

impl AppDataStorageGuard<'_> {
    pub async fn read_app_data(&mut self, key: &str) -> Result<Option<String>, String> {
        self.storage
            .read_app_data_with_guard(key, &self.coordinator)
            .await
    }

    pub async fn write_app_data(&mut self, key: &str, value: &str) -> Result<(), String> {
        self.storage
            .write_app_data_with_guard(key, value, &self.coordinator)
            .await
    }

    pub async fn compare_and_swap_app_data(
        &mut self,
        key: &str,
        expected: Option<&str>,
        replacement: &str,
    ) -> Result<bool, String> {
        self.storage
            .compare_and_swap_app_data_with_guard(key, expected, replacement, &self.coordinator)
            .await
    }
}

/// Queue routine appdata IPC without holding a service mutex while waiting for
/// the global coordinator. Direct service callers retain nonblocking admission.
/// Call this before acquiring any service mutex or coordinator lease.
pub async fn lock_app_data(state: &SecureStorageState) -> AppDataStorageGuard<'_> {
    let coordinator = settings_coordinator::lock_settings_write().await;
    let storage = state.lock().await;
    AppDataStorageGuard {
        storage,
        coordinator,
    }
}

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
    /// (`sorng-v1::connections` sub-key). A missing state is reserved
    /// for tests and writes plain JSON; an installed-but-locked state
    /// refuses writes rather than silently downgrading secrets.
    encryption_state: Option<Arc<sorng_encryption::EncryptionState>>,
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
    pub fn set_encryption_state(&mut self, state: Arc<sorng_encryption::EncryptionState>) {
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
        Ok(Self::checked_storage_metadata(Path::new(&self.store_path))?.is_some())
    }

    /// Checks if the stored data is encrypted.
    ///
    /// Returns `true` iff the storage file on disk is the v2
    /// envelope (binary `SORNG\0` magic). The legacy `SORNG_ENC:`
    /// text envelope was retired in commit Z.
    pub async fn is_storage_encrypted(&self) -> Result<bool, String> {
        let path = Path::new(&self.store_path);
        let Some(metadata) = Self::checked_storage_metadata(path)? else {
            return Ok(false);
        };
        let mut prefix = [0_u8; 6];
        if metadata.len() < prefix.len() as u64 {
            return Ok(false);
        }
        let mut file =
            fs::File::open(path).map_err(|_| "Failed to open connections storage".to_string())?;
        file.read_exact(&mut prefix)
            .map_err(|_| "Failed to read connections storage".to_string())?;
        Ok(prefix == *sorng_encryption::envelope::MAGIC)
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

    /// Saves data to persistent storage.
    ///
    /// Serializes the provided data to JSON format and writes it to the storage file.
    /// An installed master encryption state controls the encoding. If a legacy
    /// caller explicitly requests protection and no state is installed, the
    /// write fails rather than silently downgrading to plaintext.
    ///
    /// # Arguments
    ///
    /// * `data` - The `StorageData` to save
    /// * `use_password` - Legacy downgrade guard; `true` requires initialized encryption
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
        let coordinator =
            settings_coordinator::try_lock_settings_write().map_err(str::to_string)?;
        self.save_data_with_guard(data, use_password, &coordinator)
            .await
    }

    async fn save_data_with_guard(
        &self,
        data: StorageData,
        use_password: bool,
        coordinator: &SettingsWriteGuard,
    ) -> Result<(), String> {
        coordinator
            .require_serialized_write()
            .map_err(str::to_string)?;
        let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
        if json.len() > MAX_STORAGE_PLAINTEXT_BYTES {
            return Err("Connections storage exceeds the 255 MiB limit".to_string());
        }

        // Encryption dispatch — master DEK only. The `use_password`
        // arg is retained on the Tauri-facing API for backward
        // compatibility and acts as a downgrade guard when the global
        // encryption state was not installed.
        let state = self.encryption_state.as_ref();
        let used_v2 = match state {
            Some(state) => {
                state.resolve_write_policy(sorng_encryption::ArtifactKind::Connections, true)?
            }
            None if use_password => {
                return Err(
                    "Protected storage was requested but encryption is not initialized".to_string(),
                );
            }
            None => false,
        };

        if used_v2 {
            let state = state.unwrap();
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
    ///
    /// Routes through [`crate::durable::durable_write`], which fsyncs the
    /// temp file before the rename and the parent dir after it (crash
    /// durability), and folds in the t21 resilience — bounded retry plus a
    /// per-attempt `create_dir_all` self-heal — that previously protected
    /// only the settings writer. The connections store is crown-jewel user
    /// data (every host, tunnel, and credential) and now gets the same
    /// guarantees.
    fn atomic_write_bytes(path: &str, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() as u64 > MAX_STORAGE_FILE_BYTES {
            return Err("Connections storage exceeds the 256 MiB limit".to_string());
        }
        let path = Path::new(path);
        let _ = Self::checked_storage_metadata(path)?;
        crate::durable::durable_write(path, bytes)
    }

    fn checked_storage_metadata(path: &Path) -> Result<Option<fs::Metadata>, String> {
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("Failed to inspect connections storage".to_string()),
        };
        if metadata.file_type().is_symlink() {
            return Err("Connections storage must not be a symbolic link".to_string());
        }
        if !metadata.is_file() {
            return Err("Connections storage must be a regular file".to_string());
        }
        if metadata.len() > MAX_STORAGE_FILE_BYTES {
            return Err("Connections storage exceeds the 256 MiB limit".to_string());
        }
        Ok(Some(metadata))
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
        let coordinator =
            settings_coordinator::try_lock_settings_write().map_err(str::to_string)?;
        self.load_data_with_guard(&coordinator).await
    }

    async fn load_data_with_guard(
        &self,
        coordinator: &SettingsWriteGuard,
    ) -> Result<Option<StorageData>, String> {
        coordinator
            .require_serialized_write()
            .map_err(str::to_string)?;
        if let Some(state) = &self.encryption_state {
            // A plaintext override never bypasses the global locked/recovery gate.
            state.resolve_write_policy(sorng_encryption::ArtifactKind::Connections, false)?;
        }
        let path = Path::new(&self.store_path);
        if Self::checked_storage_metadata(path)?.is_none() {
            return Ok(None);
        }
        let raw_bytes =
            fs::read(path).map_err(|_| "Failed to read connections storage".to_string())?;
        if raw_bytes.len() as u64 > MAX_STORAGE_FILE_BYTES {
            return Err("Connections storage exceeds the 256 MiB limit".to_string());
        }
        if let Some(state) = &self.encryption_state {
            if state.resolve_write_policy(sorng_encryption::ArtifactKind::Connections, false)?
                && !Self::is_v2_connections_blob(&raw_bytes)
            {
                return Err(
                    "plaintext connections conflict with the authenticated encryption policy"
                        .into(),
                );
            }
        }

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
        let storage_data: StorageData = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        Ok(Some(storage_data))
    }

    /// Validate and commit a restored backup as one durable storage
    /// replacement. Omitted backup sections retain their live values,
    /// and app-local data is always preserved because backup payloads
    /// do not own that namespace. All shape validation and the live
    /// read complete before `save_data` reaches the atomic writer.
    pub async fn apply_restored_backup_transactionally(
        &self,
        restored: &serde_json::Value,
    ) -> Result<StorageData, String> {
        let object = restored
            .as_object()
            .ok_or_else(|| "Restore payload must be a JSON object".to_string())?;

        let restored_connections = match object.get("connections") {
            None => None,
            Some(serde_json::Value::Array(connections)) => {
                if connections.iter().any(|connection| !connection.is_object()) {
                    return Err("Restore payload connections must contain only objects".to_string());
                }
                Some(connections.clone())
            }
            Some(_) => {
                return Err("Restore payload connections must be an array".to_string());
            }
        };
        let restored_settings = match object.get("settings") {
            None => None,
            Some(serde_json::Value::Object(settings)) => Some(
                settings
                    .iter()
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect::<std::collections::HashMap<_, _>>(),
            ),
            Some(_) => {
                return Err("Restore payload settings must be an object".to_string());
            }
        };
        let restored_timestamp = match object.get("timestamp") {
            None => None,
            Some(timestamp) => Some(timestamp.as_u64().ok_or_else(|| {
                "Restore payload timestamp must be an unsigned integer".to_string()
            })?),
        };
        if restored_connections.is_none() && restored_settings.is_none() {
            return Err(
                "Restore payload contains no supported connections or settings data".to_string(),
            );
        }

        let mut candidate = self.load_data().await?.unwrap_or_else(|| StorageData {
            connections: Vec::new(),
            settings: std::collections::HashMap::new(),
            timestamp: 0,
            app_data: std::collections::HashMap::new(),
        });
        if let Some(connections) = restored_connections {
            candidate.connections = connections;
        }
        if let Some(settings) = restored_settings {
            candidate.settings = settings;
        }
        candidate.timestamp = restored_timestamp.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_secs())
                .unwrap_or(0)
        });

        self.save_data(candidate.clone(), false).await?;
        Ok(candidate)
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
        let _coordinator = sorng_encryption::settings_coordinator::try_lock_settings_write()
            .map_err(str::to_string)?;
        if let Some(state) = &self.encryption_state {
            state.resolve_write_policy(sorng_encryption::ArtifactKind::Connections, false)?;
        }
        let path = Path::new(&self.store_path);
        if Self::checked_storage_metadata(path)?.is_some() {
            fs::remove_file(path).map_err(|_| "Failed to clear connections storage".to_string())
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
        let coordinator =
            settings_coordinator::try_lock_settings_write().map_err(str::to_string)?;
        self.read_app_data_with_guard(key, &coordinator).await
    }

    async fn read_app_data_with_guard(
        &self,
        key: &str,
        coordinator: &SettingsWriteGuard,
    ) -> Result<Option<String>, String> {
        let data = self.load_data_with_guard(coordinator).await?;
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
        let coordinator =
            settings_coordinator::try_lock_settings_write().map_err(str::to_string)?;
        self.write_app_data_with_guard(key, value, &coordinator)
            .await
    }

    async fn write_app_data_with_guard(
        &self,
        key: &str,
        value: &str,
        coordinator: &SettingsWriteGuard,
    ) -> Result<(), String> {
        let mut data = self
            .load_data_with_guard(coordinator)
            .await?
            .unwrap_or_else(|| StorageData {
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
        // The global master-key state determines whether the write is
        // encrypted; no per-record password is retained here.
        self.save_data_with_guard(data, false, coordinator).await
    }

    /// Atomically replace one app-data value when it still matches the caller's
    /// expected snapshot. One serialized lease covers the entire operation.
    /// IPC also holds the service mutex via `lock_app_data`; direct callers
    /// retain nonblocking admission even when they already hold that mutex.
    pub async fn compare_and_swap_app_data(
        &self,
        key: &str,
        expected: Option<&str>,
        replacement: &str,
    ) -> Result<bool, String> {
        let coordinator =
            settings_coordinator::try_lock_settings_write().map_err(str::to_string)?;
        self.compare_and_swap_app_data_with_guard(key, expected, replacement, &coordinator)
            .await
    }

    async fn compare_and_swap_app_data_with_guard(
        &self,
        key: &str,
        expected: Option<&str>,
        replacement: &str,
        coordinator: &SettingsWriteGuard,
    ) -> Result<bool, String> {
        let mut data = self
            .load_data_with_guard(coordinator)
            .await?
            .unwrap_or_else(|| StorageData {
                connections: Vec::new(),
                settings: std::collections::HashMap::new(),
                timestamp: 0,
                app_data: std::collections::HashMap::new(),
            });
        if data.app_data.get(key).map(String::as_str) != expected {
            return Ok(false);
        }
        data.app_data
            .insert(key.to_string(), replacement.to_string());
        data.timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        self.save_data_with_guard(data, false, coordinator).await?;
        Ok(true)
    }
}

#[cfg(test)]
mod queued_app_data_tests {
    use super::*;
    use sorng_encryption::{
        artifact_policy::{self, PolicyDocument, ProtectionMode},
        ArtifactKind, EncryptionState, MasterDek,
    };
    use std::{future::Future, pin::Pin, task::Poll, time::Duration};

    async fn pending_once<F: Future>(mut future: Pin<&mut F>) {
        std::future::poll_fn(|cx| {
            assert!(future.as_mut().poll(cx).is_pending(), "must queue");
            Poll::Ready(())
        })
        .await;
    }

    async fn finish<F: Future>(future: F) -> F::Output {
        tokio::time::timeout(Duration::from_secs(2), future)
            .await
            .expect("appdata operation deadlocked")
    }

    fn sample() -> StorageData {
        StorageData {
            connections: vec![serde_json::json!({"id": "keep-connection"})],
            settings: [("keep-setting".into(), serde_json::json!(true))].into(),
            timestamp: 1,
            app_data: [
                ("scripts".into(), "old".into()),
                ("keep".into(), "local".into()),
            ]
            .into(),
        }
    }

    async fn set_policy(root: &Path, state: &EncryptionState, mode: ProtectionMode) {
        let policy = PolicyDocument::default()
            .with_mode(ArtifactKind::Connections, mode)
            .unwrap();
        fs::write(
            root.join(artifact_policy::POLICY_FILENAME),
            artifact_policy::encode(state, &policy).await.unwrap(),
        )
        .unwrap();
        artifact_policy::initialize(state, root).await;
        assert!(state.artifact_policy_error().is_none());
    }

    #[tokio::test]
    async fn routine_contention_queues_read_write_and_cas_with_fresh_snapshots() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let dir = tempfile::tempdir().unwrap();
        let state = SecureStorage::new(dir.path().join("data.json").to_string_lossy().into());
        state.lock().await.save_data(sample(), false).await.unwrap();
        let busy = settings_coordinator::lock_settings_write().await;
        let mut write = std::pin::pin!(async {
            lock_app_data(&state)
                .await
                .write_app_data("scripts", "new")
                .await
        });
        let mut read =
            std::pin::pin!(async { lock_app_data(&state).await.read_app_data("scripts").await });
        let mut cas = std::pin::pin!(async {
            lock_app_data(&state)
                .await
                .compare_and_swap_app_data("scripts", Some("new"), "winner")
                .await
        });
        let mut stale = std::pin::pin!(async {
            lock_app_data(&state)
                .await
                .compare_and_swap_app_data("scripts", Some("new"), "loser")
                .await
        });
        pending_once(write.as_mut()).await;
        pending_once(read.as_mut()).await;
        pending_once(cas.as_mut()).await;
        pending_once(stale.as_mut()).await;
        assert!(
            state.try_lock().is_ok(),
            "queued IPC must not own the service"
        );
        assert!(settings_coordinator::try_lock_trust().is_ok());
        drop(busy);
        let (write, read, cas, stale) =
            finish(async { tokio::join!(write, read, cas, stale) }).await;
        write.unwrap();
        assert_eq!(read.unwrap().as_deref(), Some("new"));
        assert!(cas.unwrap());
        assert!(!stale.unwrap());
        let data = state.lock().await.load_data().await.unwrap().unwrap();
        assert_eq!(data.app_data["scripts"], "winner");
        assert_eq!(data.app_data["keep"], "local");
        assert_eq!(data.connections, sample().connections);
        assert_eq!(data.settings, sample().settings);
        assert!(settings_coordinator::try_lock().is_ok());
    }

    #[tokio::test]
    async fn queued_ipc_leaves_service_available_to_transition_and_reads_its_commit() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let dir = tempfile::tempdir().unwrap();
        let state = SecureStorage::new(dir.path().join("data.json").to_string_lossy().into());
        let transition = settings_coordinator::lock().await;
        let mut read =
            std::pin::pin!(async { lock_app_data(&state).await.read_app_data("scripts").await });
        pending_once(read.as_mut()).await;
        // Same lock order as rotation/artifact roots: transition -> service.
        let service = finish(state.lock()).await;
        service
            .save_data_with_guard(sample(), false, &transition)
            .await
            .unwrap();
        drop(service);
        drop(transition);
        assert_eq!(finish(read).await.unwrap().as_deref(), Some("old"));
    }

    #[tokio::test]
    async fn admitted_cas_finishes_with_one_lease_while_transition_is_queued() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        let state = SecureStorage::new(path.to_string_lossy().into());
        let mut transaction = lock_app_data(&state).await;
        transaction.write_app_data("scripts", "old").await.unwrap();
        let mut transition = std::pin::pin!(settings_coordinator::lock());
        pending_once(transition.as_mut()).await;
        assert!(settings_coordinator::try_lock_settings_write().is_err());
        // Reacquiring either coordinator lease during the read or the write
        // would fail or deadlock behind the queued exclusive waiter.
        assert!(
            finish(transaction.compare_and_swap_app_data("scripts", Some("old"), "new"))
                .await
                .unwrap()
        );
        let committed = fs::read(&path).unwrap();
        assert!(
            !finish(transaction.compare_and_swap_app_data("scripts", Some("old"), "stale"))
                .await
                .unwrap()
        );
        assert_eq!(fs::read(&path).unwrap(), committed);
        assert_eq!(
            finish(transaction.read_app_data("scripts"))
                .await
                .unwrap()
                .as_deref(),
            Some("new")
        );
        pending_once(transition.as_mut()).await;
        drop(transaction);
        let transition = finish(transition).await;
        assert!(state.try_lock().is_ok());
        drop(transition);
    }

    #[tokio::test]
    async fn queued_operations_recheck_locked_recovery_and_authenticated_policy_fences() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        for fence in ["locked", "recovery", "policy-error", "encrypted-policy"] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("data.json");
            let state = SecureStorage::new(path.to_string_lossy().into());
            let encryption = Arc::new(EncryptionState::new());
            encryption
                .install(MasterDek::from_bytes(&[7; 32]).unwrap())
                .await;
            set_policy(dir.path(), &encryption, ProtectionMode::Plaintext).await;
            state.lock().await.set_encryption_state(encryption.clone());
            state.lock().await.save_data(sample(), false).await.unwrap();
            let before = fs::read(&path).unwrap();
            let transition = settings_coordinator::lock().await;
            let mut read = std::pin::pin!(async {
                lock_app_data(&state).await.read_app_data("scripts").await
            });
            let mut write = std::pin::pin!(async {
                lock_app_data(&state)
                    .await
                    .write_app_data("scripts", "unsafe")
                    .await
            });
            let mut cas = std::pin::pin!(async {
                lock_app_data(&state)
                    .await
                    .compare_and_swap_app_data("scripts", Some("old"), "unsafe")
                    .await
            });
            pending_once(read.as_mut()).await;
            pending_once(write.as_mut()).await;
            pending_once(cas.as_mut()).await;
            let expected_error = match fence {
                "locked" => {
                    encryption.lock().await;
                    "master encryption is locked"
                }
                "recovery" => {
                    encryption.set_artifact_recovery_required(true);
                    "requires recovery"
                }
                "policy-error" => {
                    fs::write(
                        dir.path().join(artifact_policy::POLICY_FILENAME),
                        b"corrupt",
                    )
                    .unwrap();
                    artifact_policy::refresh(&encryption).await;
                    "artifact policy authentication failed"
                }
                "encrypted-policy" => {
                    set_policy(dir.path(), &encryption, ProtectionMode::Encrypted).await;
                    "plaintext connections conflict"
                }
                _ => unreachable!(),
            };
            drop(transition);
            let (read, write, cas) = finish(async { tokio::join!(read, write, cas) }).await;
            for error in [read.unwrap_err(), write.unwrap_err(), cas.unwrap_err()] {
                assert!(error.contains(expected_error), "{fence}: {error}");
            }
            assert_eq!(fs::read(&path).unwrap(), before, "{fence} changed storage");
            assert!(settings_coordinator::try_lock().is_ok());
        }
    }

    #[tokio::test]
    async fn queued_write_uses_policy_installed_before_admission() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        let state = SecureStorage::new(path.to_string_lossy().into());
        let encryption = Arc::new(EncryptionState::new());
        encryption
            .install(MasterDek::from_bytes(&[8; 32]).unwrap())
            .await;
        set_policy(dir.path(), &encryption, ProtectionMode::Plaintext).await;
        state.lock().await.set_encryption_state(encryption.clone());
        let transition = settings_coordinator::lock().await;
        let mut write = std::pin::pin!(async {
            lock_app_data(&state)
                .await
                .write_app_data("scripts", "protected")
                .await
        });
        pending_once(write.as_mut()).await;
        set_policy(dir.path(), &encryption, ProtectionMode::Encrypted).await;
        drop(transition);
        finish(write).await.unwrap();
        assert!(fs::read(path)
            .unwrap()
            .starts_with(sorng_encryption::envelope::MAGIC));
        assert_eq!(
            finish(async { lock_app_data(&state).await.read_app_data("scripts").await })
                .await
                .unwrap()
                .as_deref(),
            Some("protected")
        );
    }

    #[tokio::test]
    async fn queued_ipc_rechecks_lock_after_waiting_for_service_mutex() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing.json");
        let state = SecureStorage::new(path.to_string_lossy().into());
        let encryption = Arc::new(EncryptionState::new());
        encryption
            .install(MasterDek::from_bytes(&[9; 32]).unwrap())
            .await;
        let mut service = state.lock().await;
        service.set_encryption_state(encryption.clone());
        let mut write = std::pin::pin!(async {
            lock_app_data(&state)
                .await
                .write_app_data("scripts", "unsafe")
                .await
        });
        pending_once(write.as_mut()).await;
        assert!(settings_coordinator::try_lock_settings_write().is_err());
        // Existing direct callers must fail promptly even with a queued IPC
        // owning the coordinator and waiting for this service mutex.
        let error = finish(service.write_app_data("scripts", "direct"))
            .await
            .unwrap_err();
        assert!(error.contains("storage write in progress"));
        encryption.lock().await;
        drop(service);
        assert!(finish(write)
            .await
            .unwrap_err()
            .contains("master encryption is locked"));
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn cancelling_either_queue_stage_releases_all_leases() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let dir = tempfile::tempdir().unwrap();
        let state = SecureStorage::new(dir.path().join("data.json").to_string_lossy().into());
        let busy = settings_coordinator::lock_settings_write().await;
        let mut waiting = Box::pin(lock_app_data(&state));
        pending_once(waiting.as_mut()).await;
        drop(waiting);
        drop(busy);
        assert!(settings_coordinator::try_lock().is_ok());
        let service = state.lock().await;
        let mut waiting = Box::pin(lock_app_data(&state));
        pending_once(waiting.as_mut()).await;
        assert!(settings_coordinator::try_lock().is_err());
        drop(waiting);
        assert!(settings_coordinator::try_lock().is_ok());
        drop(service);
        finish(async {
            lock_app_data(&state)
                .await
                .write_app_data("scripts", "ok")
                .await
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn guarded_helpers_reject_bare_read_capability_before_io() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        let state = SecureStorage::new(path.to_string_lossy().into());
        let read = settings_coordinator::try_lock_trust().unwrap();
        let storage = state.lock().await;
        for error in [
            storage.load_data_with_guard(&read).await.unwrap_err(),
            storage
                .save_data_with_guard(sample(), false, &read)
                .await
                .unwrap_err(),
            storage
                .write_app_data_with_guard("scripts", "unsafe", &read)
                .await
                .unwrap_err(),
            storage
                .compare_and_swap_app_data_with_guard("scripts", None, "unsafe", &read)
                .await
                .unwrap_err(),
        ] {
            assert_eq!(error, "serialized storage write lease required");
        }
        assert!(!path.exists());
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

    #[tokio::test]
    async fn ordinary_storage_operations_allow_a_shared_trust_lease() {
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
        let dir = tempdir().unwrap();
        let storage = build_storage(dir.path().join("trust.json").to_string_lossy().into());
        let trust = sorng_encryption::settings_coordinator::try_lock_trust().unwrap();
        storage.save_data(sample_data(), false).await.unwrap();
        assert_eq!(
            storage.load_data().await.unwrap().unwrap().connections,
            sample_data().connections
        );
        storage.write_app_data("keep", "local").await.unwrap();
        let restored = storage
            .apply_restored_backup_transactionally(&serde_json::json!({
                "connections": [{"id":"restored"}], "settings":{"theme":"dark"}
            }))
            .await
            .unwrap();
        assert_eq!(restored.connections[0]["id"], "restored");
        assert_eq!(
            restored.app_data.get("keep").map(String::as_str),
            Some("local")
        );
        storage.clear_storage().await.unwrap();
        assert!(storage.load_data().await.unwrap().is_none());
        drop(trust);
    }

    #[tokio::test]
    async fn app_data_compare_and_swap_rejects_stale_writers() {
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
        let dir = tempdir().unwrap();
        let storage = build_storage(dir.path().join("cas.json").to_string_lossy().into());

        assert!(storage
            .compare_and_swap_app_data("instances", None, "[1]")
            .await
            .unwrap());
        assert!(!storage
            .compare_and_swap_app_data("instances", None, "[2]")
            .await
            .unwrap());
        assert!(!storage
            .compare_and_swap_app_data("instances", Some("[0]"), "[2]")
            .await
            .unwrap());
        assert!(storage
            .compare_and_swap_app_data("instances", Some("[1]"), "[2]")
            .await
            .unwrap());
        assert_eq!(
            storage.read_app_data("instances").await.unwrap().as_deref(),
            Some("[2]")
        );
    }

    fn plant_sorng_enc_fixture(path: &str, payload: &StorageData, password: &str) {
        let json = serde_json::to_string_pretty(payload).unwrap();
        let encrypted = SecureStorage::encrypt_bytes(json.as_bytes(), password).unwrap();
        let encoded = general_purpose::STANDARD.encode(&encrypted);
        std::fs::write(path, format!("SORNG_ENC:{}", encoded)).unwrap();
    }

    #[tokio::test]
    async fn v2_envelope_used_when_state_unlocked() {
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
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
    async fn requested_protection_without_state_refuses_plaintext_downgrade() {
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let svc = build_storage(path.clone());

        let error = svc.save_data(sample_data(), true).await.unwrap_err();
        assert!(error.contains("encryption is not initialized"));
        assert!(
            !Path::new(&path).exists(),
            "requested protection must not write plaintext storage"
        );
    }

    #[tokio::test]
    async fn plaintext_path_when_no_state_installed() {
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let svc = build_storage(path.clone());

        svc.save_data(sample_data(), false).await.unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("c1"));
        // No legacy envelope, no v2 envelope — just JSON.
        assert!(!raw.starts_with("SORNG_ENC:"));
        let bytes = std::fs::read(&path).unwrap();
        assert_ne!(
            &bytes[..6.min(bytes.len())],
            sorng_encryption::envelope::MAGIC
        );
        let loaded = svc.load_data().await.unwrap().unwrap();
        assert_eq!(loaded.connections[0]["id"], "c1");
    }

    #[tokio::test]
    async fn locked_read_of_v2_surfaces_error() {
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
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
    async fn locked_state_refuses_plaintext_downgrade() {
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        let mut svc = build_storage(path.clone());
        let locked = Arc::new(EncryptionState::new());
        svc.set_encryption_state(locked);

        let err = svc.save_data(sample_data(), false).await.unwrap_err();
        assert!(
            err.contains("unlock the master key"),
            "expected locked-state downgrade refusal, got: {err}"
        );
        assert!(
            !Path::new(&path).exists(),
            "locked state must not write plaintext storage"
        );
    }

    #[tokio::test]
    async fn legacy_sorng_enc_fixture_is_rejected_on_load() {
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
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
            err.to_lowercase().contains("expected") || err.to_lowercase().contains("invalid"),
            "legacy SORNG_ENC: file must surface as a parse error, got: {err}"
        );
    }

    // ────────────────────────────────────────────────────────────────
    // Layer B — filesystem error paths, atomic-write recovery, and
    //          vault eviction simulations.
    // ────────────────────────────────────────────────────────────────

    async fn unlocked_state_with_bytes(bytes: [u8; 32]) -> Arc<EncryptionState> {
        let s = EncryptionState::new();
        s.install(MasterDek::from_bytes(&bytes).unwrap()).await;
        Arc::new(s)
    }

    #[tokio::test]
    async fn missing_parent_dir_self_heals_via_create_dir_all() {
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
        // The connections writer now routes through the durable writer,
        // which self-heals a missing parent (t21 resilience, previously
        // settings-only). Pointing at a non-existent multi-level parent
        // must create the tree and land the write rather than erroring —
        // this closes the "app-data dir relocated mid-session → write
        // lost" class for the crown-jewel connections store.
        let tmp = tempdir().unwrap();
        let nested = tmp.path().join("nonexistent/deep/path/data.json");
        let path = nested.to_string_lossy().to_string();
        let svc = build_storage(path.clone());
        svc.save_data(sample_data(), false).await.unwrap();
        assert!(
            nested.exists(),
            "durable writer must create the parent tree"
        );
        let loaded = svc.load_data().await.unwrap().unwrap();
        assert_eq!(loaded.connections[0]["id"], "c1");
    }

    #[tokio::test]
    async fn garbage_canonical_file_surfaces_parse_error_on_load() {
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
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
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
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
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
        // Pre-plant the durable writer's temp sibling (`.data.json.tmp`, a
        // hidden sibling in the same directory). A normal write must succeed
        // AND the leftover must no longer be present (it gets overwritten
        // then renamed away). The canonical file holds the new content.
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("data.json").to_string_lossy().to_string();
        // Mirror `durable::temp_sibling`: `<dir>/.<name>.tmp`.
        let p = std::path::Path::new(&path);
        let tmp_path = p
            .parent()
            .unwrap()
            .join(format!(".{}.tmp", p.file_name().unwrap().to_string_lossy()))
            .to_string_lossy()
            .to_string();
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
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
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
        let _storage_fixture = crate::STORAGE_FIXTURE.lock().await;
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
