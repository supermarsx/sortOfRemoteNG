use app::*;
use tempfile::NamedTempFile;
use std::collections::HashMap;

fn create_temp_file() -> NamedTempFile {
    NamedTempFile::new().unwrap()
}

fn create_test_data() -> StorageData {
    let mut settings = HashMap::new();
    settings.insert("theme".to_string(), serde_json::json!("dark"));
    settings.insert("auto_save".to_string(), serde_json::json!(true));

    StorageData {
        connections: vec![
            serde_json::json!({"id": "conn1", "name": "Test Connection 1"}),
            serde_json::json!({"id": "conn2", "name": "Test Connection 2"}),
        ],
        settings,
        timestamp: 1234567890,
    }
}

#[tokio::test]
async fn test_new_secure_storage() {
    let temp_file = create_temp_file();
    let store_path = temp_file.path().to_string_lossy().to_string();
    let storage = SecureStorage::new(store_path.clone());

    // Storage should be created successfully - check by trying to load data
    let result = storage.lock().await.load_data().await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_none());
}

#[tokio::test]
async fn test_set_password() {
    let temp_file = create_temp_file();
    let store_path = temp_file.path().to_string_lossy().to_string();
    let storage = SecureStorage::new(store_path);

    // Initially no password - check by is_storage_encrypted
    let result = storage.lock().await.is_storage_encrypted().await;
    assert!(result.is_ok());
    assert!(!result.unwrap());

    // Set password
    storage.lock().await.set_password(Some("testpass".to_string())).await;

    // Check encryption status (though it may not change)
    let result = storage.lock().await.is_storage_encrypted().await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_has_stored_data_nonexistent() {
    let temp_file = create_temp_file();
    let store_path = temp_file.path().to_string_lossy().to_string();
    // Delete the temp file to ensure it doesn't exist
    std::fs::remove_file(&store_path).unwrap();

    let storage = SecureStorage::new(store_path);
    let result = storage.lock().await.has_stored_data().await;
    assert!(result.is_ok());
    assert!(!result.unwrap());
}

#[tokio::test]
async fn test_has_stored_data_existing() {
    let temp_file = create_temp_file();
    let store_path = temp_file.path().to_string_lossy().to_string();

    let storage = SecureStorage::new(store_path.clone());
    let test_data = create_test_data();
    storage.lock().await.save_data(test_data, false).await.unwrap();

    let result = storage.lock().await.has_stored_data().await;
    assert!(result.is_ok());
    assert!(result.unwrap());
}

#[tokio::test]
async fn test_is_storage_encrypted() {
    let temp_file = create_temp_file();
    let store_path = temp_file.path().to_string_lossy().to_string();
    let storage = SecureStorage::new(store_path);

    // Currently always returns false (not encrypted)
    let result = storage.lock().await.is_storage_encrypted().await;
    assert!(result.is_ok());
    assert!(!result.unwrap());
}

#[tokio::test]
async fn test_save_and_load_data() {
    let temp_file = create_temp_file();
    let store_path = temp_file.path().to_string_lossy().to_string();
    let storage = SecureStorage::new(store_path.clone());

    let test_data = create_test_data();

    // Save data
    let save_result = storage.lock().await.save_data(test_data.clone(), false).await;
    assert!(save_result.is_ok());

    // Load data
    let load_result = storage.lock().await.load_data().await;
    assert!(load_result.is_ok());

    let loaded_data = load_result.unwrap();
    assert!(loaded_data.is_some());

    let loaded_data = loaded_data.unwrap();
    assert_eq!(loaded_data.connections.len(), 2);
    assert_eq!(loaded_data.timestamp, 1234567890);
    assert_eq!(loaded_data.settings.get("theme"), Some(&serde_json::json!("dark")));
    assert_eq!(loaded_data.settings.get("auto_save"), Some(&serde_json::json!(true)));
}

#[tokio::test]
async fn test_load_data_nonexistent() {
    let temp_file = create_temp_file();
    let store_path = temp_file.path().to_string_lossy().to_string();
    // Ensure file doesn't exist
    std::fs::remove_file(&store_path).unwrap();

    let storage = SecureStorage::new(store_path);
    let result = storage.lock().await.load_data().await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_none());
}

#[tokio::test]
async fn test_clear_storage_existing() {
    let temp_file = create_temp_file();
    let store_path = temp_file.path().to_string_lossy().to_string();
    let storage = SecureStorage::new(store_path.clone());

    // Save some data first
    let test_data = create_test_data();
    storage.lock().await.save_data(test_data, false).await.unwrap();

    // Verify file exists
    assert!(std::path::Path::new(&store_path).exists());

    // Clear storage
    let result = storage.lock().await.clear_storage().await;
    assert!(result.is_ok());

    // Verify file is gone
    assert!(!std::path::Path::new(&store_path).exists());
}

#[tokio::test]
async fn test_clear_storage_nonexistent() {
    let temp_file = create_temp_file();
    let store_path = temp_file.path().to_string_lossy().to_string();
    // Ensure file doesn't exist
    std::fs::remove_file(&store_path).unwrap();

    let storage = SecureStorage::new(store_path);
    let result = storage.lock().await.clear_storage().await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_save_data_with_password() {
    let temp_file = create_temp_file();
    let store_path = temp_file.path().to_string_lossy().to_string();
    let storage = SecureStorage::new(store_path.clone());

    // Set password
    storage.lock().await.set_password(Some("testpass".to_string())).await;

    let test_data = create_test_data();

    // Save with password (currently not encrypted, but should work)
    let result = storage.lock().await.save_data(test_data, true).await;
    assert!(result.is_ok());

    // Load data
    let load_result = storage.lock().await.load_data().await;
    assert!(load_result.is_ok());
    assert!(load_result.unwrap().is_some());
}

#[tokio::test]
async fn test_concurrent_access() {
    let temp_file = create_temp_file();
    let store_path = temp_file.path().to_string_lossy().to_string();
    let storage = SecureStorage::new(store_path.clone());

    // Spawn multiple tasks to save/load data concurrently
    let mut handles = vec![];
    for i in 0..5 {
        let storage_clone = storage.clone();
        let handle = tokio::spawn(async move {
            let mut test_data = create_test_data();
            test_data.timestamp = i as u64;

            // Save data
            storage_clone.lock().await.save_data(test_data, false).await.unwrap();

            // Load data
            let loaded = storage_clone.lock().await.load_data().await.unwrap();
            loaded.is_some()
        });
        handles.push(handle);
    }

    // Wait for all tasks to complete
    for handle in handles {
        let result = handle.await.unwrap();
        assert!(result);
    }
}

#[tokio::test]
async fn test_data_integrity() {
    let temp_file = create_temp_file();
    let store_path = temp_file.path().to_string_lossy().to_string();
    let storage = SecureStorage::new(store_path.clone());

    // Create complex test data
    let mut settings = HashMap::new();
    settings.insert("nested".to_string(), serde_json::json!({"key": "value", "array": [1, 2, 3]}));
    settings.insert("null_value".to_string(), serde_json::json!(null));
    settings.insert("number".to_string(), serde_json::json!(42.5));

    let complex_data = StorageData {
        connections: vec![
            serde_json::json!({"id": "complex", "config": {"host": "example.com", "port": 8080}}),
        ],
        settings,
        timestamp: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
    };

    // Save and load
    storage.lock().await.save_data(complex_data.clone(), false).await.unwrap();
    let loaded = storage.lock().await.load_data().await.unwrap().unwrap();

    // Verify all data is preserved
    assert_eq!(loaded.connections, complex_data.connections);
    assert_eq!(loaded.settings, complex_data.settings);
    assert_eq!(loaded.timestamp, complex_data.timestamp);
}