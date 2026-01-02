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