use std::fs;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct StorageData {
    pub connections: Vec<serde_json::Value>, // Placeholder for Connection
    pub settings: std::collections::HashMap<String, serde_json::Value>,
    pub timestamp: u64,
}

pub type SecureStorageState = Arc<Mutex<SecureStorage>>;

pub struct SecureStorage {
    store_path: String,
    password: Option<String>,
}

impl SecureStorage {
    pub fn new(store_path: String) -> SecureStorageState {
        Arc::new(Mutex::new(SecureStorage { store_path, password: None }))
    }

    pub async fn set_password(&mut self, password: Option<String>) {
        self.password = password;
    }

    pub async fn has_stored_data(&self) -> Result<bool, String> {
        Ok(Path::new(&self.store_path).exists())
    }

    pub async fn is_storage_encrypted(&self) -> Result<bool, String> {
        // For now, assume not encrypted
        Ok(false)
    }

    pub async fn save_data(&self, data: StorageData, use_password: bool) -> Result<(), String> {
        let password = if use_password { self.password.clone() } else { None };
        // For now, just save without encryption
        let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
        fs::write(&self.store_path, json).map_err(|e| e.to_string())
    }

    pub async fn load_data(&self) -> Result<Option<StorageData>, String> {
        if !Path::new(&self.store_path).exists() {
            return Ok(None);
        }
        let data = fs::read_to_string(&self.store_path).map_err(|e| e.to_string())?;
        let storage_data: StorageData = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        Ok(Some(storage_data))
    }

    pub async fn clear_storage(&self) -> Result<(), String> {
        if Path::new(&self.store_path).exists() {
            fs::remove_file(&self.store_path).map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn has_stored_data(state: tauri::State<'_, SecureStorageState>) -> Result<bool, String> {
    let storage = state.lock().await;
    storage.has_stored_data().await
}

#[tauri::command]
pub async fn is_storage_encrypted(state: tauri::State<'_, SecureStorageState>) -> Result<bool, String> {
    let storage = state.lock().await;
    storage.is_storage_encrypted().await
}

#[tauri::command]
pub async fn save_data(state: tauri::State<'_, SecureStorageState>, data: StorageData, use_password: bool) -> Result<(), String> {
    let storage = state.lock().await;
    storage.save_data(data, use_password).await
}

#[tauri::command]
pub async fn load_data(state: tauri::State<'_, SecureStorageState>) -> Result<Option<StorageData>, String> {
    let storage = state.lock().await;
    storage.load_data().await
}

#[tauri::command]
pub async fn clear_storage(state: tauri::State<'_, SecureStorageState>) -> Result<(), String> {
    let storage = state.lock().await;
    storage.clear_storage().await
}

#[tauri::command]
pub async fn set_storage_password(state: tauri::State<'_, SecureStorageState>, password: Option<String>) -> Result<(), String> {
    let mut storage = state.lock().await;
    storage.set_password(password).await;
    Ok(())
}