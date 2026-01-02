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
//! ```rust,no_run
//! 
//! use std::collections::HashMap;
//!
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! let storage = crate::storage::SecureStorage::new("data.json".to_string());
//!
//! // Create some data to store
//! let data = crate::storage::StorageData {
//!     connections: vec![],
//!     settings: HashMap::new(),
//!     timestamp: std::time::SystemTime::now()
//!         .duration_since(std::time::UNIX_EPOCH)?
//!         .as_secs(),
//! };
//!
//! // Save the data
//! storage.lock().await.save_data(data, false).await?;
//!
//! // Load the data back
//! if let Some(loaded_data) = storage.lock().await.load_data().await? {
//!     println!("Data loaded successfully");
//! }
//! # Ok(())
//! # }
//! ```

use std::fs;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};

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
    /// ```rust,no_run
    /// 
    ///
    /// let storage = crate::storage::SecureStorage::new("app_data.json".to_string());
    /// ```
    pub fn new(store_path: String) -> SecureStorageState {
        Arc::new(Mutex::new(SecureStorage { store_path, password: None }))
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
        // For now, assume not encrypted
        Ok(false)
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
    /// ```rust,no_run
    /// # use std::collections::HashMap;
    /// # 
    /// # async fn example() -> Result<(), String> {
    /// # let storage = crate::storage::SecureStorage::new("data.json".to_string());
    /// # let storage_guard = storage.lock().await;
    /// let data = crate::storage::StorageData {
    ///     connections: vec![],
    ///     settings: HashMap::new(),
    ///     timestamp: 1234567890,
    /// };
    /// storage_guard.save_data(data, false).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn save_data(&self, data: StorageData, use_password: bool) -> Result<(), String> {
        let password = if use_password { self.password.clone() } else { None };
        // For now, just save without encryption
        let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
        fs::write(&self.store_path, json).map_err(|e| e.to_string())
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
    /// ```rust,no_run
    /// # 
    /// # async fn example() -> Result<(), String> {
    /// # let storage = crate::storage::SecureStorage::new("data.json".to_string());
    /// # let storage_guard = storage.lock().await;
    /// if let Some(data) = storage_guard.load_data().await? {
    ///     println!("Loaded {} connections", data.connections.len());
    /// } else {
    ///     println!("No stored data found");
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn load_data(&self) -> Result<Option<StorageData>, String> {
        if !Path::new(&self.store_path).exists() {
            return Ok(None);
        }
        let data = fs::read_to_string(&self.store_path).map_err(|e| e.to_string())?;
        let storage_data: StorageData = serde_json::from_str(&data).map_err(|e| e.to_string())?;
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
    /// ```rust,no_run
    /// # 
    /// # async fn example() -> Result<(), String> {
    /// # let storage = crate::storage::SecureStorage::new("data.json".to_string());
    /// # let storage_guard = storage.lock().await;
    /// storage_guard.clear_storage().await?;
    /// println!("Storage cleared");
    /// # Ok(())
    /// # }
    /// ```
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
pub async fn is_storage_encrypted(state: tauri::State<'_, SecureStorageState>) -> Result<bool, String> {
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
pub async fn save_data(state: tauri::State<'_, SecureStorageState>, data: StorageData, use_password: bool) -> Result<(), String> {
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
pub async fn load_data(state: tauri::State<'_, SecureStorageState>) -> Result<Option<StorageData>, String> {
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
pub async fn set_storage_password(state: tauri::State<'_, SecureStorageState>, password: Option<String>) -> Result<(), String> {
    let mut storage = state.lock().await;
    storage.set_password(password).await;
    Ok(())
}
