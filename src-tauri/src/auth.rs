use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use bcrypt::{hash, verify, DEFAULT_COST};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize, Clone)]
pub struct StoredUser {
    pub username: String,
    pub password_hash: String,
}

pub type AuthServiceState = Arc<Mutex<AuthService>>;

pub struct AuthService {
    users: HashMap<String, String>,
    store_path: String,
}

impl AuthService {
    pub fn new(store_path: String) -> AuthServiceState {
        let mut service = AuthService {
            users: HashMap::new(),
            store_path,
        };
        service.load().unwrap_or_else(|e| {
            eprintln!("Failed to load user store: {}", e);
        });
        Arc::new(Mutex::new(service))
    }

    fn load(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let path = Path::new(&self.store_path);
        if !path.exists() {
            self.users = HashMap::new();
            return Ok(());
        }

        let data = fs::read_to_string(path)?;
        let users: Vec<StoredUser> = serde_json::from_str(&data)?;
        self.users = users.into_iter()
            .map(|u| (u.username, u.password_hash))
            .collect();
        Ok(())
    }

    fn persist(&self) -> Result<(), Box<dyn std::error::Error>> {
        let users: Vec<StoredUser> = self.users.iter()
            .map(|(username, password_hash)| StoredUser {
                username: username.clone(),
                password_hash: password_hash.clone(),
            })
            .collect();
        let data = serde_json::to_string_pretty(&users)?;
        fs::write(&self.store_path, data)?;
        Ok(())
    }

    pub async fn add_user(&mut self, username: String, password: String) -> Result<(), String> {
        let hash = hash(password, DEFAULT_COST).map_err(|e| e.to_string())?;
        self.users.insert(username, hash);
        self.persist().map_err(|e| e.to_string())
    }

    pub async fn verify_user(&self, username: &str, password: &str) -> Result<bool, String> {
        if let Some(stored_hash) = self.users.get(username) {
            verify(password, stored_hash).map_err(|e| e.to_string())
        } else {
            Ok(false)
        }
    }

    pub async fn list_users(&self) -> Vec<String> {
        self.users.keys().cloned().collect()
    }

    pub async fn remove_user(&mut self, username: String) -> Result<bool, String> {
        if self.users.remove(&username).is_some() {
            self.persist().map_err(|e| e.to_string())?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub async fn update_password(&mut self, username: String, new_password: String) -> Result<bool, String> {
        if self.users.contains_key(&username) {
            let hash = hash(new_password, DEFAULT_COST).map_err(|e| e.to_string())?;
            self.users.insert(username, hash);
            self.persist().map_err(|e| e.to_string())?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use std::fs;

    fn create_temp_file() -> NamedTempFile {
        NamedTempFile::new().unwrap()
    }

    #[tokio::test]
    async fn test_new_auth_service() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();
        let service = AuthService::new(store_path.clone());

        // Service should be created successfully
        assert!(service.lock().await.users.is_empty());
    }

    #[tokio::test]
    async fn test_add_user() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();
        let service = AuthService::new(store_path.clone());

        // Add a user
        let result = service.lock().await.add_user("testuser".to_string(), "testpass".to_string()).await;
        assert!(result.is_ok());

        // Verify user was added
        let users = service.lock().await.list_users().await;
        assert_eq!(users.len(), 1);
        assert!(users.contains(&"testuser".to_string()));
    }

    #[tokio::test]
    async fn test_verify_user_valid() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();
        let service = AuthService::new(store_path.clone());

        // Add a user
        service.lock().await.add_user("testuser".to_string(), "testpass".to_string()).await.unwrap();

        // Verify correct password
        let result = service.lock().await.verify_user("testuser", "testpass").await;
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_verify_user_invalid_password() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();
        let service = AuthService::new(store_path.clone());

        // Add a user
        service.lock().await.add_user("testuser".to_string(), "testpass".to_string()).await.unwrap();

        // Verify incorrect password
        let result = service.lock().await.verify_user("testuser", "wrongpass").await;
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_verify_user_nonexistent() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();
        let service = AuthService::new(store_path.clone());

        // Try to verify non-existent user
        let result = service.lock().await.verify_user("nonexistent", "anypass").await;
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_list_users() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();
        let service = AuthService::new(store_path.clone());

        // Initially empty
        let users = service.lock().await.list_users().await;
        assert!(users.is_empty());

        // Add users
        service.lock().await.add_user("user1".to_string(), "pass1".to_string()).await.unwrap();
        service.lock().await.add_user("user2".to_string(), "pass2".to_string()).await.unwrap();

        // Check users are listed
        let users = service.lock().await.list_users().await;
        assert_eq!(users.len(), 2);
        assert!(users.contains(&"user1".to_string()));
        assert!(users.contains(&"user2".to_string()));
    }

    #[tokio::test]
    async fn test_remove_user_existing() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();
        let service = AuthService::new(store_path.clone());

        // Add a user
        service.lock().await.add_user("testuser".to_string(), "testpass".to_string()).await.unwrap();

        // Remove the user
        let result = service.lock().await.remove_user("testuser".to_string()).await;
        assert!(result.is_ok());
        assert!(result.unwrap());

        // Verify user was removed
        let users = service.lock().await.list_users().await;
        assert!(users.is_empty());
    }

    #[tokio::test]
    async fn test_remove_user_nonexistent() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();
        let service = AuthService::new(store_path.clone());

        // Try to remove non-existent user
        let result = service.lock().await.remove_user("nonexistent".to_string()).await;
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_update_password_existing_user() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();
        let service = AuthService::new(store_path.clone());

        // Add a user
        service.lock().await.add_user("testuser".to_string(), "oldpass".to_string()).await.unwrap();

        // Update password
        let result = service.lock().await.update_password("testuser".to_string(), "newpass".to_string()).await;
        assert!(result.is_ok());
        assert!(result.unwrap());

        // Verify old password doesn't work
        let old_result = service.lock().await.verify_user("testuser", "oldpass").await;
        assert!(old_result.is_ok());
        assert!(!old_result.unwrap());

        // Verify new password works
        let new_result = service.lock().await.verify_user("testuser", "newpass").await;
        assert!(new_result.is_ok());
        assert!(new_result.unwrap());
    }

    #[tokio::test]
    async fn test_update_password_nonexistent_user() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();
        let service = AuthService::new(store_path.clone());

        // Try to update password for non-existent user
        let result = service.lock().await.update_password("nonexistent".to_string(), "newpass".to_string()).await;
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_persistence() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();

        // Create service and add user
        {
            let service = AuthService::new(store_path.clone());
            service.lock().await.add_user("testuser".to_string(), "testpass".to_string()).await.unwrap();
        }

        // Create new service instance - should load persisted data
        let service = AuthService::new(store_path.clone());
        let users = service.lock().await.list_users().await;
        assert_eq!(users.len(), 1);
        assert!(users.contains(&"testuser".to_string()));

        // Verify password still works
        let result = service.lock().await.verify_user("testuser", "testpass").await;
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_persistence_empty_file() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();

        // Write empty array to file
        fs::write(&store_path, "[]").unwrap();

        // Create service - should load empty data
        let service = AuthService::new(store_path.clone());
        let users = service.lock().await.list_users().await;
        assert!(users.is_empty());
    }

    #[tokio::test]
    async fn test_concurrent_access() {
        let temp_file = create_temp_file();
        let store_path = temp_file.path().to_string_lossy().to_string();
        let service = AuthService::new(store_path.clone());

        // Spawn multiple tasks to add users concurrently
        let mut handles = vec![];
        for i in 0..10 {
            let service_clone = service.clone();
            let handle = tokio::spawn(async move {
                let username = format!("user{}", i);
                let password = format!("pass{}", i);
                service_clone.lock().await.add_user(username.clone(), password.clone()).await.unwrap();
                service_clone.lock().await.verify_user(&username, &password).await.unwrap()
            });
            handles.push(handle);
        }

        // Wait for all tasks to complete
        for handle in handles {
            let result = handle.await.unwrap();
            assert!(result);
        }

        // Verify all users were added
        let users = service.lock().await.list_users().await;
        assert_eq!(users.len(), 10);
    }
}