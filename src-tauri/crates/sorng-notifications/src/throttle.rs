//! # Throttle Manager
//!
//! Rate-limiting and duplicate-suppression for notifications. Tracks send
//! timestamps per (rule, group-key) bucket and enforces configurable windows.

use crate::types::ThrottleConfig;
use std::collections::HashMap;

/// Tracks notification send timestamps per bucket for rate-limiting.
pub struct ThrottleManager {
    /// Map of `"rule_id::group_key"` → list of send timestamps (epoch seconds).
    buckets: HashMap<String, Vec<u64>>,
    /// Map of `"rule_id::group_key"` → set of content hashes for dedup.
    seen_hashes: HashMap<String, Vec<u64>>,
}

impl ThrottleManager {
    /// Create a new, empty throttle manager.
    pub fn new() -> Self {
        Self {
            buckets: HashMap::new(),
            seen_hashes: HashMap::new(),
        }
    }

    /// Check whether a notification for the given rule/group should be throttled.
    ///
    /// Returns `true` if the notification should be **suppressed**.
    pub fn should_throttle(
        &self,
        rule_id: &str,
        group_key: &str,
        config: &ThrottleConfig,
    ) -> bool {
        let key = Self::bucket_key(rule_id, group_key);
        let now = current_epoch_secs();
        let window_start = now.saturating_sub(config.window_seconds);

        if let Some(timestamps) = self.buckets.get(&key) {
            let count_in_window = timestamps.iter().filter(|&&ts| ts >= window_start).count();
            if count_in_window >= config.max_per_window as usize {
                return true;
            }
        }
        false
    }

    /// Check whether a specific content hash is a duplicate within the window.
    pub fn is_duplicate(
        &self,
        rule_id: &str,
        group_key: &str,
        content_hash: u64,
        config: &ThrottleConfig,
    ) -> bool {
        if !config.suppress_duplicates {
            return false;
        }
        let key = Self::bucket_key(rule_id, group_key);
        if let Some(hashes) = self.seen_hashes.get(&key) {
            return hashes.contains(&content_hash);
        }
        false
    }

    /// Record that a notification was sent for the given rule/group.
    pub fn record_send(&mut self, rule_id: &str, group_key: &str) {
        let key = Self::bucket_key(rule_id, group_key);
        let now = current_epoch_secs();
        self.buckets.entry(key).or_default().push(now);
    }

    /// Record a content hash for duplicate suppression.
    pub fn record_hash(&mut self, rule_id: &str, group_key: &str, content_hash: u64) {
        let key = Self::bucket_key(rule_id, group_key);
        self.seen_hashes.entry(key).or_default().push(content_hash);
    }

    /// Remove expired entries from all buckets to free memory.
    ///
    /// Pass the largest `window_seconds` value across all active throttle
    /// configs to ensure nothing is prematurely evicted.
    pub fn cleanup_expired_windows(&mut self) {
        let now = current_epoch_secs();
        // Use a generous default max window of 1 hour for cleanup.
        let max_window = 3600u64;
        let cutoff = now.saturating_sub(max_window);

        self.buckets.retain(|_, timestamps| {
            timestamps.retain(|&ts| ts >= cutoff);
            !timestamps.is_empty()
        });

        // Clear duplicate hashes older than the window as well.
        // Since we don't track individual hash timestamps, we clear buckets
        // that have no corresponding send timestamps.
        let active_keys: Vec<String> = self.buckets.keys().cloned().collect();
        self.seen_hashes
            .retain(|key, _| active_keys.contains(key));
    }

    /// Reset all throttle state for a specific rule.
    pub fn reset(&mut self, rule_id: &str) {
        let prefix = format!("{}::", rule_id);
        self.buckets.retain(|k, _| !k.starts_with(&prefix));
        self.seen_hashes.retain(|k, _| !k.starts_with(&prefix));
    }

    /// Construct a bucket key from rule_id and group_key.
    fn bucket_key(rule_id: &str, group_key: &str) -> String {
        format!("{}::{}", rule_id, group_key)
    }
}

/// Return the current time as seconds since UNIX epoch.
fn current_epoch_secs() -> u64 {
    chrono::Utc::now().timestamp() as u64
}

/// Compute a simple hash of a string for duplicate detection.
pub fn content_hash(title: &str, body: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    title.hash(&mut hasher);
    body.hash(&mut hasher);
    hasher.finish()
}

/// Derive a group key from event data and the configured `group_by` fields.
pub fn derive_group_key(
    data: &serde_json::Value,
    group_by: &Option<Vec<String>>,
) -> String {
    match group_by {
        Some(fields) if !fields.is_empty() => {
            let parts: Vec<String> = fields
                .iter()
                .map(|f| {
                    resolve_field(data, f)
                        .map(|v| match v {
                            serde_json::Value::String(s) => s.clone(),
                            other => other.to_string(),
                        })
                        .unwrap_or_default()
                })
                .collect();
            parts.join("::")
        }
        _ => "_default_".to_string(),
    }
}

/// Resolve a dot-separated field path in a JSON value.
fn resolve_field<'a>(data: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut current = data;
    for segment in path.split('.') {
        match current {
            serde_json::Value::Object(map) => {
                current = map.get(segment)?;
            }
            serde_json::Value::Array(arr) => {
                let idx: usize = segment.parse().ok()?;
                current = arr.get(idx)?;
            }
            _ => return None,
        }
    }
    Some(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_config(max: u32, window: u64) -> ThrottleConfig {
        ThrottleConfig {
            max_per_window: max,
            window_seconds: window,
            group_by: None,
            suppress_duplicates: false,
        }
    }

    #[test]
    fn throttle_under_limit() {
        let mut mgr = ThrottleManager::new();
        let config = make_config(5, 60);
        mgr.record_send("rule1", "default");
        mgr.record_send("rule1", "default");
        assert!(!mgr.should_throttle("rule1", "default", &config));
    }

    #[test]
    fn throttle_at_limit() {
        let mut mgr = ThrottleManager::new();
        let config = make_config(2, 60);
        mgr.record_send("rule1", "default");
        mgr.record_send("rule1", "default");
        assert!(mgr.should_throttle("rule1", "default", &config));
    }

    #[test]
    fn reset_clears_state() {
        let mut mgr = ThrottleManager::new();
        let config = make_config(1, 60);
        mgr.record_send("rule1", "default");
        assert!(mgr.should_throttle("rule1", "default", &config));
        mgr.reset("rule1");
        assert!(!mgr.should_throttle("rule1", "default", &config));
    }

    #[test]
    fn group_key_derivation() {
        let data = serde_json::json!({"host": "srv1", "region": "us-east"});
        let key = derive_group_key(
            &data,
            &Some(vec!["host".into(), "region".into()]),
        );
        assert_eq!(key, "srv1::us-east");
    }
}
