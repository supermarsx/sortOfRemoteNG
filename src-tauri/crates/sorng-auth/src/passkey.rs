//! Passkey (WebAuthn/Biometric) authentication service
//!
//! This module provides system-level passkey authentication using:
//! - Windows Hello (Windows)
//! - Touch ID / Keychain (macOS)
//! - Secret Service / libsecret (Linux)

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

pub type PasskeyServiceState = Arc<Mutex<PasskeyService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasskeyCredential {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub last_used: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasskeyChallenge {
    pub challenge: String,
    pub timeout: u64,
}

pub struct PasskeyService {
    registered_credentials: Vec<PasskeyCredential>,
    derived_key: Option<Vec<u8>>,
}

impl PasskeyService {
    pub fn new() -> PasskeyServiceState {
        Arc::new(Mutex::new(PasskeyService {
            registered_credentials: Vec::new(),
            derived_key: None,
        }))
    }

    /// Check if passkey/biometric authentication is available on this system.
    /// Delegates to `sorng-biometrics` for cross-platform availability detection.
    pub async fn is_available(&self) -> bool {
        sorng_biometrics::availability::is_available().await
    }

    /// Authenticate using system passkey (Windows Hello, Touch ID, etc.).
    /// Delegates to `sorng-biometrics` for cross-platform biometric verification
    /// and key derivation.
    pub async fn authenticate(&mut self, reason: &str) -> Result<Vec<u8>, String> {
        let result = sorng_biometrics::authenticate::verify_and_derive_key(reason)
            .await
            .map_err(|e| e.to_string())?;

        if result.success {
            let key_hex = result.derived_key_hex.unwrap_or_default();
            let key_bytes = (0..key_hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&key_hex[i..i + 2], 16).unwrap_or(0))
                .collect::<Vec<u8>>();
            self.derived_key = Some(key_bytes.clone());
            Ok(key_bytes)
        } else {
            Err(result.message)
        }
    }

    /// Register a new passkey credential
    pub async fn register_credential(&mut self, name: &str) -> Result<PasskeyCredential, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let credential = PasskeyCredential {
            id: id.clone(),
            name: name.to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            last_used: None,
        };

        self.registered_credentials.push(credential.clone());
        Ok(credential)
    }

    /// List registered passkey credentials
    pub async fn list_credentials(&self) -> Vec<PasskeyCredential> {
        self.registered_credentials.clone()
    }

    /// Remove a passkey credential
    pub async fn remove_credential(&mut self, id: &str) -> Result<(), String> {
        let initial_len = self.registered_credentials.len();
        self.registered_credentials.retain(|c| c.id != id);

        if self.registered_credentials.len() == initial_len {
            return Err("Credential not found".to_string());
        }

        Ok(())
    }

    /// Get the derived key from the last authentication
    pub fn get_derived_key(&self) -> Option<Vec<u8>> {
        self.derived_key.clone()
    }

    /// Derive an encryption key from passkey authentication
    pub async fn derive_encryption_key(&mut self, reason: &str) -> Result<String, String> {
        let key_bytes = self.authenticate(reason).await?;
        Ok(hex::encode(&key_bytes))
    }
}

// Tauri commands

