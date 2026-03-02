//! # Gateway Authentication
//!
//! Authentication for gateway access — API keys, token validation,
//! and key lifecycle management.

use crate::types::*;
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// Manages gateway authentication via API keys.
pub struct GatewayAuthService {
    /// API keys indexed by key ID
    keys: HashMap<String, GatewayApiKey>,
    /// Hash → key ID mapping for authentication lookup
    hash_index: HashMap<String, String>,
    /// Persistence directory
    data_dir: String,
}

impl GatewayAuthService {
    pub fn new(data_dir: &str) -> Self {
        let mut svc = Self {
            keys: HashMap::new(),
            hash_index: HashMap::new(),
            data_dir: data_dir.to_string(),
        };
        svc.load_from_disk();
        svc
    }

    /// Create a new API key. Returns (key_record, plaintext_key).
    /// The plaintext key is only returned once — it cannot be retrieved later.
    pub fn create_api_key(
        &mut self,
        name: &str,
        user_id: &str,
        permissions: Vec<GatewayPermission>,
    ) -> Result<(GatewayApiKey, String), String> {
        // Generate a random API key
        let plaintext_key = format!(
            "sgw_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let key_hash = Self::hash_key(&plaintext_key);

        let api_key = GatewayApiKey {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            key_hash: key_hash.clone(),
            user_id: user_id.to_string(),
            permissions,
            created_at: Utc::now(),
            expires_at: None,
            active: true,
            last_used: None,
        };

        self.hash_index
            .insert(key_hash, api_key.id.clone());
        self.keys.insert(api_key.id.clone(), api_key.clone());
        self.persist();

        Ok((api_key, plaintext_key))
    }

    /// Authenticate using a plaintext API key.
    pub fn authenticate(&mut self, plaintext_key: &str) -> Result<GatewayApiKey, String> {
        let key_hash = Self::hash_key(plaintext_key);
        let key_id = self
            .hash_index
            .get(&key_hash)
            .ok_or("Invalid API key")?
            .clone();

        let api_key = self.keys.get_mut(&key_id).ok_or("API key not found")?;

        if !api_key.active {
            return Err("API key has been revoked".to_string());
        }

        if let Some(expires) = api_key.expires_at {
            if Utc::now() > expires {
                return Err("API key has expired".to_string());
            }
        }

        api_key.last_used = Some(Utc::now());
        let result = api_key.clone();
        self.persist();
        Ok(result)
    }

    /// Revoke an API key.
    pub fn revoke_key(&mut self, key_id: &str) -> Result<(), String> {
        let key = self.keys.get_mut(key_id).ok_or("API key not found")?;
        key.active = false;
        self.persist();
        Ok(())
    }

    /// List all API keys for a user.
    pub fn list_keys_for_user(&self, user_id: &str) -> Vec<&GatewayApiKey> {
        self.keys
            .values()
            .filter(|k| k.user_id == user_id)
            .collect()
    }

    /// List all active API keys.
    pub fn list_active_keys(&self) -> Vec<&GatewayApiKey> {
        self.keys.values().filter(|k| k.active).collect()
    }

    /// Check if a key has a specific permission.
    pub fn has_permission(key: &GatewayApiKey, required: GatewayPermission) -> bool {
        key.permissions.contains(&GatewayPermission::Admin)
            || key.permissions.contains(&required)
    }

    /// Set expiration on a key.
    pub fn set_key_expiration(
        &mut self,
        key_id: &str,
        expires_at: chrono::DateTime<Utc>,
    ) -> Result<(), String> {
        let key = self.keys.get_mut(key_id).ok_or("API key not found")?;
        key.expires_at = Some(expires_at);
        self.persist();
        Ok(())
    }

    /// Hash a plaintext API key.
    fn hash_key(plaintext: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(plaintext.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    // ── Persistence ─────────────────────────────────────────────────

    fn persist(&self) {
        let path = std::path::Path::new(&self.data_dir).join("gateway_api_keys.json");
        if let Ok(json) = serde_json::to_string_pretty(&self.keys) {
            let _ = std::fs::create_dir_all(&self.data_dir);
            let _ = std::fs::write(path, json);
        }
    }

    fn load_from_disk(&mut self) {
        let path = std::path::Path::new(&self.data_dir).join("gateway_api_keys.json");
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(keys) = serde_json::from_str::<HashMap<String, GatewayApiKey>>(&data) {
                // Rebuild hash index
                for (id, key) in &keys {
                    self.hash_index.insert(key.key_hash.clone(), id.clone());
                }
                self.keys = keys;
            }
        }
    }
}
