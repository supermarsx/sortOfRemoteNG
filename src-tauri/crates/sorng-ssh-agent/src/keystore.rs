//! # Key Store
//!
//! Thread-safe in-memory key store. Manages the lifecycle of keys held by the
//! SSH agent — add, remove, list, find by blob, enforce constraints, and
//! handle automatic key expiry.

use crate::types::*;
use log::{debug, info, warn};
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// In-memory key store with constraint tracking.
pub struct KeyStore {
    /// All loaded keys, keyed by their unique id.
    keys: HashMap<String, AgentKey>,
    /// Map from fingerprint (SHA-256) → key id for fast blob-based lookups.
    blob_index: HashMap<Vec<u8>, String>,
    /// Maximum number of keys allowed (0 = unlimited).
    max_keys: usize,
    /// Whether the store is locked (all operations disallowed until unlock).
    locked: bool,
    /// If locked, the hashed passphrase used to lock.
    lock_passphrase: Option<String>,
}

impl KeyStore {
    /// Create a new empty key store.
    pub fn new(max_keys: usize) -> Self {
        Self {
            keys: HashMap::new(),
            blob_index: HashMap::new(),
            max_keys,
            locked: false,
            lock_passphrase: None,
        }
    }

    /// Return current lock state.
    pub fn is_locked(&self) -> bool {
        self.locked
    }

    /// Lock the agent. All identity operations will be refused until unlock.
    pub fn lock(&mut self, passphrase: &str) -> Result<(), String> {
        if self.locked {
            return Err("Agent is already locked".to_string());
        }
        self.locked = true;
        self.lock_passphrase = Some(passphrase.to_string());
        info!("Key store locked");
        Ok(())
    }

    /// Unlock the agent.
    pub fn unlock(&mut self, passphrase: &str) -> Result<(), String> {
        if !self.locked {
            return Err("Agent is not locked".to_string());
        }
        if let Some(ref stored) = self.lock_passphrase {
            if stored != passphrase {
                return Err("Incorrect passphrase".to_string());
            }
        }
        self.locked = false;
        self.lock_passphrase = None;
        info!("Key store unlocked");
        Ok(())
    }

    /// Add a key to the store. Returns the assigned key ID.
    pub fn add_key(&mut self, key: AgentKey) -> Result<String, String> {
        if self.locked {
            return Err("Agent is locked".to_string());
        }
        if self.max_keys > 0 && self.keys.len() >= self.max_keys {
            return Err(format!(
                "Maximum key limit reached ({})",
                self.max_keys
            ));
        }

        // Check for duplicate by blob
        if self.blob_index.contains_key(&key.public_key_blob) {
            return Err("Key already loaded".to_string());
        }

        let id = key.id.clone();
        debug!("Adding key {} ({})", &id, key.comment);

        self.blob_index
            .insert(key.public_key_blob.clone(), id.clone());
        self.keys.insert(id.clone(), key);

        Ok(id)
    }

    /// Remove a key by its unique ID.
    pub fn remove_key(&mut self, id: &str) -> Result<AgentKey, String> {
        if self.locked {
            return Err("Agent is locked".to_string());
        }
        let key = self.keys.remove(id).ok_or_else(|| "Key not found".to_string())?;
        self.blob_index.remove(&key.public_key_blob);
        info!("Removed key {}", id);
        Ok(key)
    }

    /// Remove a key by its public key blob.
    pub fn remove_key_by_blob(&mut self, blob: &[u8]) -> Result<AgentKey, String> {
        if self.locked {
            return Err("Agent is locked".to_string());
        }
        let id = self
            .blob_index
            .get(blob)
            .cloned()
            .ok_or_else(|| "Key not found for blob".to_string())?;
        self.remove_key(&id)
    }

    /// Remove all keys.
    pub fn remove_all_keys(&mut self) -> usize {
        if self.locked {
            return 0;
        }
        let count = self.keys.len();
        self.keys.clear();
        self.blob_index.clear();
        info!("Removed all {} keys", count);
        count
    }

    /// Find a key by its public key blob.
    pub fn find_by_blob(&self, blob: &[u8]) -> Option<&AgentKey> {
        if self.locked {
            return None;
        }
        self.blob_index
            .get(blob)
            .and_then(|id| self.keys.get(id))
    }

    /// Find a key by its unique ID.
    pub fn find_by_id(&self, id: &str) -> Option<&AgentKey> {
        if self.locked {
            return None;
        }
        self.keys.get(id)
    }

    /// Get a mutable reference to a key by its unique ID.
    pub fn find_by_id_mut(&mut self, id: &str) -> Option<&mut AgentKey> {
        if self.locked {
            return None;
        }
        self.keys.get_mut(id)
    }

    /// Get a mutable reference to a key by blob.
    pub fn find_by_blob_mut(&mut self, blob: &[u8]) -> Option<&mut AgentKey> {
        if self.locked {
            return None;
        }
        let id = self.blob_index.get(blob)?.clone();
        self.keys.get_mut(&id)
    }

    /// List all identities (public key blob + comment) for the protocol response.
    pub fn list_identities(&self) -> Vec<(Vec<u8>, String)> {
        if self.locked {
            return Vec::new();
        }
        self.keys
            .values()
            .map(|k| (k.public_key_blob.clone(), k.comment.clone()))
            .collect()
    }

    /// Get all keys.
    pub fn all_keys(&self) -> Vec<&AgentKey> {
        self.keys.values().collect()
    }

    /// Number of loaded keys.
    pub fn key_count(&self) -> usize {
        self.keys.len()
    }

    /// Record a signing event for the given key blob. Increments sign_count
    /// and updates last_used_at. Returns whether the signing is allowed
    /// (i.e., max-signatures constraint not exceeded).
    pub fn record_sign(&mut self, blob: &[u8]) -> Result<bool, String> {
        if self.locked {
            return Err("Agent is locked".to_string());
        }
        let key = self
            .find_by_blob_mut(blob)
            .ok_or_else(|| "Key not found for sign".to_string())?;
        key.sign_count += 1;
        key.last_used_at = Some(chrono::Utc::now());

        // Check max-signatures constraint
        for c in &key.constraints {
            if c.is_max_signatures_reached(key.sign_count) {
                warn!(
                    "Key {} reached max signatures ({})",
                    key.id, key.sign_count
                );
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// Expire keys whose lifetime constraints have elapsed.
    /// Returns the IDs of removed keys.
    pub fn expire_keys(&mut self) -> Vec<String> {
        if self.locked {
            return Vec::new();
        }

        let expired_ids: Vec<String> = self
            .keys
            .iter()
            .filter_map(|(id, key)| {
                for c in &key.constraints {
                    if c.is_lifetime_expired(key.added_at) {
                        return Some(id.clone());
                    }
                }
                None
            })
            .collect();

        for id in &expired_ids {
            if let Some(key) = self.keys.remove(id) {
                self.blob_index.remove(&key.public_key_blob);
                info!("Expired key {} ({})", id, key.comment);
            }
        }

        expired_ids
    }

    /// Check whether any constraint on the key requires confirmation before
    /// signing.
    pub fn needs_confirmation(&self, blob: &[u8]) -> bool {
        if let Some(key) = self.find_by_blob(blob) {
            for c in &key.constraints {
                if matches!(c, KeyConstraint::ConfirmBeforeUse) {
                    return true;
                }
            }
        }
        false
    }

    /// Check host restriction constraints for a signing request.
    pub fn is_host_allowed(&self, blob: &[u8], host: &str) -> bool {
        if let Some(key) = self.find_by_blob(blob) {
            for c in &key.constraints {
                if let KeyConstraint::HostRestriction(hosts) = c {
                    return hosts.iter().any(|h| {
                        h == host || (h.starts_with("*.") && host.ends_with(&h[1..]))
                    });
                }
            }
            // No host restriction → allowed by default
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_key(id: &str, blob: &[u8]) -> AgentKey {
        AgentKey {
            id: id.to_string(),
            comment: format!("test-key-{}", id),
            algorithm: KeyAlgorithm::Ed25519,
            bits: 256,
            fingerprint_sha256: format!("SHA256:{}", id),
            fingerprint_md5: String::new(),
            public_key_blob: blob.to_vec(),
            public_key_openssh: String::new(),
            source: KeySource::Generated,
            constraints: Vec::new(),
            certificate: None,
            added_at: Utc::now(),
            last_used_at: None,
            sign_count: 0,
            metadata: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn test_add_and_find() {
        let mut store = KeyStore::new(0);
        let key = make_key("k1", &[1, 2, 3]);
        store.add_key(key).unwrap();

        assert!(store.find_by_blob(&[1, 2, 3]).is_some());
        assert!(store.find_by_id("k1").is_some());
        assert_eq!(store.key_count(), 1);
    }

    #[test]
    fn test_duplicate_rejected() {
        let mut store = KeyStore::new(0);
        let k1 = make_key("k1", &[1, 2]);
        let k2 = make_key("k2", &[1, 2]);
        store.add_key(k1).unwrap();
        assert!(store.add_key(k2).is_err());
    }

    #[test]
    fn test_remove() {
        let mut store = KeyStore::new(0);
        let key = make_key("k1", &[5, 6]);
        store.add_key(key).unwrap();
        store.remove_key("k1").unwrap();
        assert_eq!(store.key_count(), 0);
    }

    #[test]
    fn test_remove_by_blob() {
        let mut store = KeyStore::new(0);
        let key = make_key("k1", &[7, 8]);
        store.add_key(key).unwrap();
        store.remove_key_by_blob(&[7, 8]).unwrap();
        assert_eq!(store.key_count(), 0);
    }

    #[test]
    fn test_remove_all() {
        let mut store = KeyStore::new(0);
        store.add_key(make_key("k1", &[1])).unwrap();
        store.add_key(make_key("k2", &[2])).unwrap();
        assert_eq!(store.remove_all_keys(), 2);
        assert_eq!(store.key_count(), 0);
    }

    #[test]
    fn test_max_keys() {
        let mut store = KeyStore::new(2);
        store.add_key(make_key("k1", &[1])).unwrap();
        store.add_key(make_key("k2", &[2])).unwrap();
        assert!(store.add_key(make_key("k3", &[3])).is_err());
    }

    #[test]
    fn test_lock_unlock() {
        let mut store = KeyStore::new(0);
        store.add_key(make_key("k1", &[1])).unwrap();
        store.lock("pw").unwrap();
        assert!(store.is_locked());
        assert!(store.find_by_id("k1").is_none());
        assert!(store.add_key(make_key("k2", &[2])).is_err());

        assert!(store.unlock("wrong").is_err());
        store.unlock("pw").unwrap();
        assert!(!store.is_locked());
        assert!(store.find_by_id("k1").is_some());
    }

    #[test]
    fn test_expire_keys() {
        let mut store = KeyStore::new(0);
        let mut key = make_key("k1", &[1]);
        key.added_at = Utc::now() - chrono::Duration::seconds(120);
        key.constraints.push(KeyConstraint::Lifetime(60));
        store.add_key(key).unwrap();

        let expired = store.expire_keys();
        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0], "k1");
        assert_eq!(store.key_count(), 0);
    }

    #[test]
    fn test_record_sign() {
        let mut store = KeyStore::new(0);
        store.add_key(make_key("k1", &[1])).unwrap();
        let allowed = store.record_sign(&[1]).unwrap();
        assert!(allowed);

        let key = store.find_by_id("k1").unwrap();
        assert_eq!(key.sign_count, 1);
        assert!(key.last_used_at.is_some());
    }

    #[test]
    fn test_host_restriction() {
        let mut store = KeyStore::new(0);
        let mut key = make_key("k1", &[1]);
        key.constraints.push(KeyConstraint::HostRestriction(vec![
            "*.example.com".to_string(),
            "specific.host".to_string(),
        ]));
        store.add_key(key).unwrap();

        assert!(store.is_host_allowed(&[1], "foo.example.com"));
        assert!(store.is_host_allowed(&[1], "specific.host"));
        assert!(!store.is_host_allowed(&[1], "evil.com"));
    }

    #[test]
    fn test_needs_confirmation() {
        let mut store = KeyStore::new(0);
        let mut key = make_key("k1", &[1]);
        key.constraints.push(KeyConstraint::ConfirmBeforeUse);
        store.add_key(key).unwrap();

        assert!(store.needs_confirmation(&[1]));
    }

    #[test]
    fn test_list_identities() {
        let mut store = KeyStore::new(0);
        store.add_key(make_key("k1", &[1])).unwrap();
        store.add_key(make_key("k2", &[2])).unwrap();
        let ids = store.list_identities();
        assert_eq!(ids.len(), 2);
    }
}
