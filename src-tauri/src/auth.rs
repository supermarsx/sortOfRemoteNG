//! # Authentication Service
//!
//! This module provides user authentication and authorization functionality for the SortOfRemote NG application.
//! It handles user registration, login verification, password management, and secure credential storage.
//!
//! ## Features
//!
//! - Secure password hashing using bcrypt
//! - Persistent user storage in JSON format
//! - Thread-safe operations with async mutex protection
//! - User management (add, remove, update, list)
//!
//! ## Security
//!
//! Passwords are hashed using bcrypt with the default cost factor for strong security.
//! User credentials are stored in a JSON file with hashed passwords only.
//!
//! ## Example
//!
//! ```rust,no_run
//! 
//!
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! let auth_service = crate::auth::AuthService::new("users.json".to_string());
//!
//! // Add a new user
//! auth_service.lock().await.add_user("john".to_string(), "password123".to_string()).await?;
//!
//! // Verify credentials
//! let is_valid = auth_service.lock().await.verify_user("john", "password123").await?;
//! assert!(is_valid);
//! # Ok(())
//! # }
//! ```

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use bcrypt::{hash, verify, DEFAULT_COST};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

/// Represents a user stored in the authentication system.
///
/// This struct contains the username and the bcrypt-hashed password.
/// It's used for serialization/deserialization to/from the user store file.
#[derive(Serialize, Deserialize, Clone)]
pub struct StoredUser {
    /// The username of the stored user
    pub username: String,
    /// The bcrypt hash of the user's password
    pub password_hash: String,
}

/// Type alias for the authentication service state wrapped in an Arc<Mutex<>> for thread-safe access.
pub type AuthServiceState = Arc<Mutex<AuthService>>;

/// The main authentication service that manages user accounts and credentials.
///
/// This service provides all authentication-related operations including user registration,
/// login verification, and password management. It uses bcrypt for secure password hashing
/// and stores user data in a JSON file.
pub struct AuthService {
    /// In-memory cache of username -> password hash mappings
    users: HashMap<String, String>,
    /// File path where user data is persisted
    store_path: String,
}

impl AuthService {
    /// Creates a new authentication service instance.
    ///
    /// Initializes the service with the specified store path and attempts to load
    /// existing user data from the file. If the file doesn't exist, starts with an empty user store.
    ///
    /// # Arguments
    ///
    /// * `store_path` - The file path where user data should be stored (e.g., "users.json")
    ///
    /// # Returns
    ///
    /// A new `AuthServiceState` wrapped in an Arc<Mutex<>> for thread-safe access
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// 
    ///
    /// let auth_service = crate::auth::AuthService::new("users.json".to_string());
    /// ```
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

    /// Loads user data from the persistent store file.
    ///
    /// Reads the JSON file containing user credentials and populates the in-memory user cache.
    /// If the file doesn't exist, initializes an empty user store.
    ///
    /// # Returns
    ///
    /// `Ok(())` if loading succeeded, `Err` containing the error if loading failed
    ///
    /// # Errors
    ///
    /// This function can fail if:
    /// - The file cannot be read
    /// - The JSON content is malformed
    /// - File system permissions are insufficient
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

    /// Persists the current user data to the store file.
    ///
    /// Serializes all users to JSON format and writes them to the configured store path.
    /// This ensures that user data survives application restarts.
    ///
    /// # Returns
    ///
    /// `Ok(())` if persistence succeeded, `Err` containing the error if persistence failed
    ///
    /// # Errors
    ///
    /// This function can fail if:
    /// - The file cannot be written
    /// - JSON serialization fails
    /// - File system permissions are insufficient
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

    /// Adds a new user to the authentication system.
    ///
    /// Creates a new user account with the specified username and password.
    /// The password is hashed using bcrypt before storage.
    ///
    /// # Arguments
    ///
    /// * `username` - The desired username for the new account
    /// * `password` - The plaintext password (will be hashed before storage)
    ///
    /// # Returns
    ///
    /// `Ok(())` if the user was successfully added, `Err(String)` containing the error message if it failed
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Password hashing fails
    /// - File persistence fails
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use std::sync::Arc;
    /// # use tokio::sync::Mutex;
    /// # 
    /// # async fn example() -> Result<(), String> {
    /// # let auth_service = crate::auth::AuthService::new("users.json".to_string());
    /// # let mut service = auth_service.lock().await;
    /// service.add_user("john".to_string(), "secure_password".to_string()).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn add_user(&mut self, username: String, password: String) -> Result<(), String> {
        let hash = hash(password, DEFAULT_COST).map_err(|e| e.to_string())?;
        self.users.insert(username, hash);
        self.persist().map_err(|e| e.to_string())
    }

    /// Verifies user credentials against stored data.
    ///
    /// Checks if the provided username exists and if the password matches the stored hash.
    ///
    /// # Arguments
    ///
    /// * `username` - The username to verify
    /// * `password` - The plaintext password to check
    ///
    /// # Returns
    ///
    /// `Ok(true)` if credentials are valid, `Ok(false)` if username doesn't exist or password is wrong,
    /// `Err(String)` if verification process fails
    ///
    /// # Errors
    ///
    /// Returns an error if bcrypt verification fails due to corrupted hash data.
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use std::sync::Arc;
    /// # use tokio::sync::Mutex;
    /// # 
    /// # async fn example() -> Result<(), String> {
    /// # let auth_service = crate::auth::AuthService::new("users.json".to_string());
    /// # let service = auth_service.lock().await;
    /// let is_valid = service.verify_user("john", "secure_password").await?;
    /// assert!(is_valid);
    /// # Ok(())
    /// # }
    /// ```
    pub async fn verify_user(&self, username: &str, password: &str) -> Result<bool, String> {
        if let Some(stored_hash) = self.users.get(username) {
            verify(password, stored_hash).map_err(|e| e.to_string())
        } else {
            Ok(false)
        }
    }

    /// Returns a list of all registered usernames.
    ///
    /// Provides a vector containing all usernames currently registered in the system.
    /// This is useful for administrative purposes or user management interfaces.
    ///
    /// # Returns
    ///
    /// A vector of strings containing all usernames
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use std::sync::Arc;
    /// # use tokio::sync::Mutex;
    /// # 
    /// # async fn example() {
    /// # let auth_service = crate::auth::AuthService::new("users.json".to_string());
    /// # let service = auth_service.lock().await;
    /// let users = service.list_users().await;
    /// println!("Registered users: {:?}", users);
    /// # }
    /// ```
    pub async fn list_users(&self) -> Vec<String> {
        self.users.keys().cloned().collect()
    }

    /// Removes a user from the authentication system.
    ///
    /// Permanently deletes the user account with the specified username.
    /// This action cannot be undone and immediately takes effect.
    ///
    /// # Arguments
    ///
    /// * `username` - The username of the account to remove
    ///
    /// # Returns
    ///
    /// `Ok(true)` if the user was successfully removed, `Ok(false)` if the user didn't exist,
    /// `Err(String)` containing the error message if removal failed
    ///
    /// # Errors
    ///
    /// Returns an error if file persistence fails after removing the user.
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use std::sync::Arc;
    /// # use tokio::sync::Mutex;
    /// # 
    /// # async fn example() -> Result<(), String> {
    /// # let auth_service = crate::auth::AuthService::new("users.json".to_string());
    /// # let mut service = auth_service.lock().await;
    /// let removed = service.remove_user("old_user".to_string()).await?;
    /// if removed {
    ///     println!("User removed successfully");
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn remove_user(&mut self, username: String) -> Result<bool, String> {
        if self.users.remove(&username).is_some() {
            self.persist().map_err(|e| e.to_string())?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Updates the password for an existing user.
    ///
    /// Changes the password for the specified user account. The new password is hashed
    /// using bcrypt before storage. This operation doesn't require the old password.
    ///
    /// # Arguments
    ///
    /// * `username` - The username whose password should be updated
    /// * `new_password` - The new plaintext password
    ///
    /// # Returns
    ///
    /// `Ok(true)` if the password was successfully updated, `Ok(false)` if the user doesn't exist,
    /// `Err(String)` containing the error message if update failed
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Password hashing fails
    /// - File persistence fails
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use std::sync::Arc;
    /// # use tokio::sync::Mutex;
    /// # 
    /// # async fn example() -> Result<(), String> {
    /// # let auth_service = crate::auth::AuthService::new("users.json".to_string());
    /// # let mut service = auth_service.lock().await;
    /// let updated = service.update_password("john".to_string(), "new_password".to_string()).await?;
    /// if updated {
    ///     println!("Password updated successfully");
    /// }
    /// # Ok(())
    /// # }
    /// ```
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
