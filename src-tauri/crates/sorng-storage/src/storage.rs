//! # Secure Storage Service
//!
//! This module provides secure data persistence functionality for the SortOfRemote NG application.
//! It handles storing and retrieving application data including connections, settings, and other
//! configuration data with optional encryption support.
//!
//! ## Features
//!
//! - JSON-based data storage with pretty formatting
//! - Optional password-based encryption (planned feature)
//! - Thread-safe operations with async mutex protection
//! - Data integrity verification
//! - Automatic data migration support
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
//! Currently implements basic JSON storage. Encryption support is planned for future releases
//! using AES-256-GCM with PBKDF2 key derivation from user passwords.
//!
//! ## Example
//!

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose, Engine as _};
use rand::RngCore;
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
#[derive(Serialize, Deserialize, Clone)]
pub struct StorageData {
    /// Array of connection configurations stored as JSON values
    pub connections: Vec<serde_json::Value>,
    /// Key-value pairs for application settings and preferences
    pub settings: std::collections::HashMap<String, serde_json::Value>,
    /// Unix timestamp indicating when the data was last modified
    pub timestamp: u64,
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
    /// Optional password for encryption (currently unused, planned for future)
    password: Option<String>,
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
        }))
    }

    /// Sets the password for storage encryption.
    ///
    /// Configures an optional password that will be used for encrypting stored data.
    /// Currently, this password is stored but encryption is not yet implemented.
    ///
    /// # Arguments
    ///
    /// * `password` - Optional password string for encryption, or None to disable encryption
    ///
    /// # Note
    ///
    /// Encryption functionality is planned for a future release.
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
    /// Currently always returns false as encryption is not yet implemented.
    ///
    /// # Returns
    ///
    /// `Ok(false)` indicating data is not encrypted (current implementation)
    ///
    /// # Note
    ///
    /// This will return true in future versions when encryption is implemented.
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

    /// Encrypt data with AES-256-GCM.
    fn encrypt_bytes(data: &[u8], password: &str) -> Result<Vec<u8>, String> {
        // Generate random salt (32 bytes) and nonce (12 bytes)
        let mut salt = [0u8; 32];
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut salt);
        rand::thread_rng().fill_bytes(&mut nonce_bytes);

        let key = Self::derive_encryption_key(password, &salt);
        let cipher = Aes256Gcm::new(&key.into());
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, data)
            .map_err(|e| format!("Encryption failed: {:?}", e))?;

        // Format: salt (32) || nonce (12) || ciphertext
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
    /// * `use_password` - Whether to use password encryption (currently ignored)
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

        let content = if use_password {
            if let Some(password) = &self.password {
                let encrypted = Self::encrypt_bytes(json.as_bytes(), password)?;
                let encoded = general_purpose::STANDARD.encode(&encrypted);
                format!("SORNG_ENC:{}", encoded)
            } else {
                json
            }
        } else {
            json
        };

        // Atomic write: write to a temp file first, then rename.
        // This prevents data loss if the process crashes mid-write.
        let tmp_path = format!("{}.tmp", &self.store_path);
        fs::write(&tmp_path, &content).map_err(|e| format!("Failed to write temp file: {}", e))?;
        fs::rename(&tmp_path, &self.store_path)
            .map_err(|e| format!("Failed to rename temp file: {}", e))
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
        let raw = fs::read_to_string(&self.store_path).map_err(|e| e.to_string())?;

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
}

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
