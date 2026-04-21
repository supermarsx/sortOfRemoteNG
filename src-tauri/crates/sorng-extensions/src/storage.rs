//! Per-extension key-value storage.
//!
//! Each extension gets an isolated namespace where it can persist
//! arbitrary JSON values, subject to configurable size limits.

use std::collections::HashMap;

use chrono::Utc;
use log::debug;

use crate::types::*;

// ─── ExtensionStorage ───────────────────────────────────────────────

/// Manages per-extension key-value storage.
#[derive(Debug, Clone)]
pub struct ExtensionStorage {
    /// extension_id → (key → StorageEntry).
    data: HashMap<String, HashMap<String, StorageEntry>>,
    /// Maximum storage size per extension in bytes.
    max_bytes_per_extension: usize,
    /// Maximum number of keys per extension.
    max_keys_per_extension: usize,
    /// Maximum total storage bytes across all extensions.
    max_total_bytes: usize,
}

impl ExtensionStorage {
    /// Create with default limits.
    pub fn new() -> Self {
        Self {
            data: HashMap::new(),
            max_bytes_per_extension: 10 * 1024 * 1024, // 10 MB
            max_keys_per_extension: 10_000,
            max_total_bytes: 100 * 1024 * 1024, // 100 MB
        }
    }

    /// Create with custom limits.
    pub fn with_limits(
        max_bytes_per_extension: usize,
        max_keys_per_extension: usize,
        max_total_bytes: usize,
    ) -> Self {
        Self {
            data: HashMap::new(),
            max_bytes_per_extension,
            max_keys_per_extension,
            max_total_bytes,
        }
    }

    // ── CRUD ────────────────────────────────────────────────────

    /// Get a value from extension storage.
    pub fn get(&self, extension_id: &str, key: &str) -> Option<&StorageEntry> {
        self.data.get(extension_id)?.get(key)
    }

    /// Get a value and deserialize it.
    pub fn get_value(&self, extension_id: &str, key: &str) -> Option<serde_json::Value> {
        self.get(extension_id, key).map(|e| e.value.clone())
    }

    /// Set a value in extension storage.
    pub fn set(
        &mut self,
        extension_id: &str,
        key: &str,
        value: serde_json::Value,
    ) -> ExtResult<()> {
        // Validate key.
        if key.is_empty() {
            return Err(ExtError::storage("Storage key cannot be empty"));
        }
        if key.len() > 256 {
            return Err(ExtError::storage("Storage key too long (max 256 chars)"));
        }

        let value_size = serde_json::to_string(&value).map(|s| s.len()).unwrap_or(0);

        // Compute sizes before acquiring mutable borrow on data.
        let current_ext_size = self.extension_size_bytes(extension_id);
        let total_size = self.total_size_bytes();
        let old_size = self
            .data
            .get(extension_id)
            .and_then(|d| d.get(key))
            .map(|e| {
                serde_json::to_string(&e.value)
                    .map(|s| s.len())
                    .unwrap_or(0)
            })
            .unwrap_or(0);
        let key_exists = self
            .data
            .get(extension_id)
            .is_some_and(|d| d.contains_key(key));
        let key_count = self.data.get(extension_id).map_or(0, |d| d.len());

        // Check per-extension size limit.
        let new_ext_size = current_ext_size - old_size + value_size;
        if new_ext_size > self.max_bytes_per_extension {
            return Err(ExtError::new(
                ExtErrorKind::StorageError,
                format!(
                    "Storage limit exceeded for extension '{}' ({}/{} bytes)",
                    extension_id, new_ext_size, self.max_bytes_per_extension
                ),
            ));
        }

        // Check per-extension key limit.
        if !key_exists && key_count >= self.max_keys_per_extension {
            return Err(ExtError::new(
                ExtErrorKind::StorageError,
                format!(
                    "Key limit exceeded for extension '{}' (max {})",
                    extension_id, self.max_keys_per_extension
                ),
            ));
        }

        // Check total storage limit.
        let new_total = total_size - old_size + value_size;
        if new_total > self.max_total_bytes {
            return Err(ExtError::new(
                ExtErrorKind::StorageError,
                "Total storage limit exceeded",
            ));
        }

        let ext_data = self.data.entry(extension_id.to_string()).or_default();

        let now = Utc::now();
        let entry = ext_data
            .entry(key.to_string())
            .or_insert_with(|| StorageEntry {
                key: key.to_string(),
                value: serde_json::Value::Null,
                created_at: now,
                updated_at: now,
            });

        entry.value = value;
        entry.updated_at = now;

        debug!(
            "Storage set: {}:{} ({} bytes)",
            extension_id, key, value_size
        );
        Ok(())
    }

    /// Delete a value from extension storage.
    pub fn delete(&mut self, extension_id: &str, key: &str) -> bool {
        if let Some(ext_data) = self.data.get_mut(extension_id) {
            ext_data.remove(key).is_some()
        } else {
            false
        }
    }

    /// List all keys for an extension.
    pub fn list_keys(&self, extension_id: &str) -> Vec<String> {
        self.data
            .get(extension_id)
            .map(|d| d.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Clear all storage for an extension.
    pub fn clear(&mut self, extension_id: &str) -> usize {
        if let Some(ext_data) = self.data.get_mut(extension_id) {
            let count = ext_data.len();
            ext_data.clear();
            debug!("Cleared {} storage entries for {}", count, extension_id);
            count
        } else {
            0
        }
    }

    /// Remove an extension's entire storage namespace.
    pub fn remove_extension(&mut self, extension_id: &str) -> bool {
        self.data.remove(extension_id).is_some()
    }

    // ── Bulk Operations ─────────────────────────────────────────

    /// Set multiple values at once.
    pub fn set_many(
        &mut self,
        extension_id: &str,
        entries: HashMap<String, serde_json::Value>,
    ) -> ExtResult<usize> {
        let mut count = 0;
        for (key, value) in entries {
            self.set(extension_id, &key, value)?;
            count += 1;
        }
        Ok(count)
    }

    /// Get multiple values at once.
    pub fn get_many(
        &self,
        extension_id: &str,
        keys: &[String],
    ) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        for key in keys {
            if let Some(val) = self.get_value(extension_id, key) {
                result.insert(key.clone(), val);
            }
        }
        result
    }

    // ── Query ───────────────────────────────────────────────────

    /// Check if a key exists.
    pub fn has_key(&self, extension_id: &str, key: &str) -> bool {
        self.data
            .get(extension_id)
            .is_some_and(|d| d.contains_key(key))
    }

    /// Count keys for an extension.
    pub fn key_count(&self, extension_id: &str) -> usize {
        self.data.get(extension_id).map_or(0, |d| d.len())
    }

    /// Calculate the total storage size for an extension in bytes.
    pub fn extension_size_bytes(&self, extension_id: &str) -> usize {
        self.data
            .get(extension_id)
            .map(|d| {
                d.values()
                    .map(|e| {
                        serde_json::to_string(&e.value)
                            .map(|s| s.len())
                            .unwrap_or(0)
                    })
                    .sum()
            })
            .unwrap_or(0)
    }

    /// Calculate the total storage size across all extensions.
    pub fn total_size_bytes(&self) -> usize {
        self.data
            .values()
            .flat_map(|d| d.values())
            .map(|e| {
                serde_json::to_string(&e.value)
                    .map(|s| s.len())
                    .unwrap_or(0)
            })
            .sum()
    }

    /// Get a summary of storage usage for an extension.
    pub fn extension_summary(&self, extension_id: &str) -> StorageSummary {
        let entries: Vec<&StorageEntry> = self
            .data
            .get(extension_id)
            .map(|d| d.values().collect())
            .unwrap_or_default();
        StorageSummary {
            entry_count: entries.len(),
            total_size_bytes: entries
                .iter()
                .map(|e| {
                    serde_json::to_string(&e.value)
                        .map(|s| s.len() as u64)
                        .unwrap_or(0)
                })
                .sum(),
            oldest_entry: entries.iter().map(|e| e.created_at).min(),
            newest_entry: entries.iter().map(|e| e.updated_at).max(),
        }
    }

    /// Get summaries for all extensions that have storage.
    pub fn all_summaries(&self) -> Vec<StorageSummary> {
        self.data
            .keys()
            .map(|id| self.extension_summary(id))
            .collect()
    }

    /// Get the list of extensions with storage.
    pub fn extensions_with_storage(&self) -> Vec<String> {
        self.data
            .iter()
            .filter(|(_, d)| !d.is_empty())
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Search keys by prefix.
    pub fn keys_with_prefix(&self, extension_id: &str, prefix: &str) -> Vec<String> {
        self.data
            .get(extension_id)
            .map(|d| {
                d.keys()
                    .filter(|k| k.starts_with(prefix))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Export all storage for an extension as JSON.
    pub fn export(&self, extension_id: &str) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        if let Some(ext_data) = self.data.get(extension_id) {
            for (key, entry) in ext_data {
                map.insert(key.clone(), entry.value.clone());
            }
        }
        serde_json::Value::Object(map)
    }

    /// Import values from a JSON object into extension storage.
    pub fn import(&mut self, extension_id: &str, data: serde_json::Value) -> ExtResult<usize> {
        let obj = data
            .as_object()
            .ok_or_else(|| ExtError::storage("Import data must be a JSON object"))?;

        let mut count = 0;
        for (key, value) in obj {
            self.set(extension_id, key, value.clone())?;
            count += 1;
        }
        Ok(count)
    }
}

impl Default for ExtensionStorage {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_get() {
        let mut store = ExtensionStorage::new();
        store
            .set("ext.a", "key1", serde_json::json!("value1"))
            .unwrap();

        let val = store.get_value("ext.a", "key1").unwrap();
        assert_eq!(val, serde_json::json!("value1"));
    }

    #[test]
    fn get_nonexistent() {
        let store = ExtensionStorage::new();
        assert!(store.get("ext.a", "key1").is_none());
        assert!(store.get_value("ext.a", "key1").is_none());
    }

    #[test]
    fn update_existing_key() {
        let mut store = ExtensionStorage::new();
        store.set("ext.a", "key1", serde_json::json!("v1")).unwrap();
        store.set("ext.a", "key1", serde_json::json!("v2")).unwrap();

        let val = store.get_value("ext.a", "key1").unwrap();
        assert_eq!(val, serde_json::json!("v2"));
    }

    #[test]
    fn delete_key() {
        let mut store = ExtensionStorage::new();
        store.set("ext.a", "key1", serde_json::json!("v")).unwrap();
        assert!(store.delete("ext.a", "key1"));
        assert!(!store.delete("ext.a", "key1"));
        assert!(store.get_value("ext.a", "key1").is_none());
    }

    #[test]
    fn list_keys() {
        let mut store = ExtensionStorage::new();
        store.set("ext.a", "a", serde_json::json!(1)).unwrap();
        store.set("ext.a", "b", serde_json::json!(2)).unwrap();
        store.set("ext.b", "c", serde_json::json!(3)).unwrap();

        let mut keys = store.list_keys("ext.a");
        keys.sort();
        assert_eq!(keys, vec!["a", "b"]);
    }

    #[test]
    fn clear_storage() {
        let mut store = ExtensionStorage::new();
        store.set("ext.a", "a", serde_json::json!(1)).unwrap();
        store.set("ext.a", "b", serde_json::json!(2)).unwrap();

        let cleared = store.clear("ext.a");
        assert_eq!(cleared, 2);
        assert_eq!(store.key_count("ext.a"), 0);
    }

    #[test]
    fn remove_extension_namespace() {
        let mut store = ExtensionStorage::new();
        store.set("ext.a", "x", serde_json::json!(1)).unwrap();
        assert!(store.remove_extension("ext.a"));
        assert!(!store.remove_extension("ext.a"));
    }

    #[test]
    fn empty_key_rejected() {
        let mut store = ExtensionStorage::new();
        let result = store.set("ext.a", "", serde_json::json!("v"));
        assert!(result.is_err());
    }

    #[test]
    fn long_key_rejected() {
        let mut store = ExtensionStorage::new();
        let long_key = "x".repeat(257);
        let result = store.set("ext.a", &long_key, serde_json::json!("v"));
        assert!(result.is_err());
    }

    #[test]
    fn per_extension_size_limit() {
        let mut store = ExtensionStorage::with_limits(100, 1000, 10_000_000);
        // Try to store a large value.
        let large_value = serde_json::json!("x".repeat(200));
        let result = store.set("ext.a", "big", large_value);
        assert!(result.is_err());
    }

    #[test]
    fn per_extension_key_limit() {
        let mut store = ExtensionStorage::with_limits(10_000_000, 2, 10_000_000);
        store.set("ext.a", "k1", serde_json::json!(1)).unwrap();
        store.set("ext.a", "k2", serde_json::json!(2)).unwrap();
        let result = store.set("ext.a", "k3", serde_json::json!(3));
        assert!(result.is_err());
    }

    #[test]
    fn total_storage_limit() {
        let mut store = ExtensionStorage::with_limits(10_000_000, 10_000, 50);
        store
            .set("ext.a", "k1", serde_json::json!("short"))
            .unwrap();
        let result = store.set("ext.a", "k2", serde_json::json!("x".repeat(100)));
        assert!(result.is_err());
    }

    #[test]
    fn has_key() {
        let mut store = ExtensionStorage::new();
        assert!(!store.has_key("ext.a", "k"));
        store.set("ext.a", "k", serde_json::json!(1)).unwrap();
        assert!(store.has_key("ext.a", "k"));
    }

    #[test]
    fn extension_size_bytes() {
        let mut store = ExtensionStorage::new();
        store
            .set("ext.a", "key", serde_json::json!("value"))
            .unwrap();
        assert!(store.extension_size_bytes("ext.a") > 0);
        assert_eq!(store.extension_size_bytes("ext.unknown"), 0);
    }

    #[test]
    fn extension_summary() {
        let mut store = ExtensionStorage::new();
        store.set("ext.a", "k1", serde_json::json!(1)).unwrap();
        store.set("ext.a", "k2", serde_json::json!(2)).unwrap();

        let summary = store.extension_summary("ext.a");
        assert_eq!(summary.entry_count, 2);
        assert!(summary.total_size_bytes > 0);
    }

    #[test]
    fn all_summaries() {
        let mut store = ExtensionStorage::new();
        store.set("ext.a", "k", serde_json::json!(1)).unwrap();
        store.set("ext.b", "k", serde_json::json!(2)).unwrap();

        let summaries = store.all_summaries();
        assert_eq!(summaries.len(), 2);
    }

    #[test]
    fn set_many_and_get_many() {
        let mut store = ExtensionStorage::new();
        let mut entries = HashMap::new();
        entries.insert("a".into(), serde_json::json!(1));
        entries.insert("b".into(), serde_json::json!(2));
        entries.insert("c".into(), serde_json::json!(3));

        store.set_many("ext.a", entries).unwrap();

        let values = store.get_many("ext.a", &["a".into(), "c".into(), "missing".into()]);
        assert_eq!(values.len(), 2);
        assert_eq!(values["a"], serde_json::json!(1));
        assert_eq!(values["c"], serde_json::json!(3));
    }

    #[test]
    fn keys_with_prefix() {
        let mut store = ExtensionStorage::new();
        store
            .set("ext.a", "config.host", serde_json::json!("localhost"))
            .unwrap();
        store
            .set("ext.a", "config.port", serde_json::json!(8080))
            .unwrap();
        store
            .set("ext.a", "data.items", serde_json::json!([]))
            .unwrap();

        let config_keys = store.keys_with_prefix("ext.a", "config.");
        assert_eq!(config_keys.len(), 2);
    }

    #[test]
    fn export_and_import() {
        let mut store = ExtensionStorage::new();
        store.set("ext.a", "x", serde_json::json!(1)).unwrap();
        store.set("ext.a", "y", serde_json::json!("two")).unwrap();

        let exported = store.export("ext.a");

        let mut store2 = ExtensionStorage::new();
        let count = store2.import("ext.b", exported).unwrap();
        assert_eq!(count, 2);
        assert_eq!(store2.get_value("ext.b", "x"), Some(serde_json::json!(1)));
    }

    #[test]
    fn import_non_object_fails() {
        let mut store = ExtensionStorage::new();
        let result = store.import("ext.a", serde_json::json!("not an object"));
        assert!(result.is_err());
    }

    #[test]
    fn extensions_with_storage() {
        let mut store = ExtensionStorage::new();
        store.set("ext.a", "k", serde_json::json!(1)).unwrap();
        store.set("ext.b", "k", serde_json::json!(2)).unwrap();
        store.clear("ext.b");

        let exts = store.extensions_with_storage();
        assert_eq!(exts.len(), 1);
    }

    #[test]
    fn total_size_bytes() {
        let mut store = ExtensionStorage::new();
        store
            .set("ext.a", "k1", serde_json::json!("hello"))
            .unwrap();
        store
            .set("ext.b", "k2", serde_json::json!("world"))
            .unwrap();

        assert!(store.total_size_bytes() > 0);
    }

    #[test]
    fn default_constructor() {
        let store = ExtensionStorage::default();
        assert_eq!(store.total_size_bytes(), 0);
    }
}
