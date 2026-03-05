use std::collections::HashMap;
use std::time::Instant;

use crate::types::{FilterResult, FiltersConfig};

/// A cached evaluation result with expiry tracking.
#[derive(Debug, Clone)]
pub struct CachedResult {
    pub result: FilterResult,
    pub cached_at: Instant,
    pub ttl_seconds: u64,
}

impl CachedResult {
    /// Check whether this cached entry has expired.
    pub fn is_expired(&self) -> bool {
        self.cached_at.elapsed().as_secs() >= self.ttl_seconds
    }
}

/// In-memory cache for filter evaluation results.
pub struct FilterCache {
    entries: HashMap<String, CachedResult>,
    config: FiltersConfig,
    hits: u64,
    misses: u64,
}

impl FilterCache {
    pub fn new(config: FiltersConfig) -> Self {
        Self {
            entries: HashMap::new(),
            config,
            hits: 0,
            misses: 0,
        }
    }

    /// Try to retrieve a non-expired cached result for the given filter ID.
    pub fn get(&mut self, filter_id: &str) -> Option<&FilterResult> {
        if !self.config.cache_results {
            self.misses += 1;
            return None;
        }

        // Check and possibly evict expired entry
        let expired = self
            .entries
            .get(filter_id)
            .map_or(false, |c| c.is_expired());
        if expired {
            self.entries.remove(filter_id);
            self.misses += 1;
            return None;
        }

        match self.entries.get(filter_id) {
            Some(cached) => {
                self.hits += 1;
                Some(&cached.result)
            }
            None => {
                self.misses += 1;
                None
            }
        }
    }

    /// Store an evaluation result in the cache.
    pub fn set(&mut self, filter_id: &str, result: FilterResult) {
        if !self.config.cache_results {
            return;
        }
        self.entries.insert(
            filter_id.to_string(),
            CachedResult {
                result,
                cached_at: Instant::now(),
                ttl_seconds: self.config.cache_ttl_seconds,
            },
        );
    }

    /// Invalidate (remove) the cached result for one filter.
    pub fn invalidate(&mut self, filter_id: &str) {
        self.entries.remove(filter_id);
    }

    /// Invalidate all cached results.
    pub fn invalidate_all(&mut self) {
        self.entries.clear();
        log::info!("Filter cache cleared");
    }

    /// Remove all expired entries.
    pub fn cleanup_expired(&mut self) {
        let before = self.entries.len();
        self.entries.retain(|_, v| !v.is_expired());
        let removed = before - self.entries.len();
        if removed > 0 {
            log::debug!("Cache cleanup: removed {removed} expired entries");
        }
    }

    /// Return the cache hit rate as a value between 0.0 and 1.0.
    pub fn hit_rate(&self) -> f64 {
        let total = self.hits + self.misses;
        if total == 0 {
            0.0
        } else {
            self.hits as f64 / total as f64
        }
    }

    /// Return the number of entries currently in the cache.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Update the cache configuration.
    pub fn update_config(&mut self, config: FiltersConfig) {
        self.config = config;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_config(cache: bool, ttl: u64) -> FiltersConfig {
        FiltersConfig {
            cache_results: cache,
            cache_ttl_seconds: ttl,
            ..Default::default()
        }
    }

    fn make_result() -> FilterResult {
        FilterResult {
            matching_ids: vec!["a".into(), "b".into()],
            total_evaluated: 10,
            match_count: 2,
            duration_ms: 1.5,
        }
    }

    #[test]
    fn test_set_and_get() {
        let mut cache = FilterCache::new(make_config(true, 60));
        cache.set("f1", make_result());
        assert!(cache.get("f1").is_some());
        assert_eq!(cache.get("f1").unwrap().match_count, 2);
    }

    #[test]
    fn test_cache_disabled() {
        let mut cache = FilterCache::new(make_config(false, 60));
        cache.set("f1", make_result());
        assert!(cache.get("f1").is_none());
    }

    #[test]
    fn test_invalidate() {
        let mut cache = FilterCache::new(make_config(true, 60));
        cache.set("f1", make_result());
        cache.invalidate("f1");
        assert!(cache.get("f1").is_none());
    }

    #[test]
    fn test_invalidate_all() {
        let mut cache = FilterCache::new(make_config(true, 60));
        cache.set("f1", make_result());
        cache.set("f2", make_result());
        cache.invalidate_all();
        assert!(cache.is_empty());
    }

    #[test]
    fn test_hit_rate() {
        let mut cache = FilterCache::new(make_config(true, 60));
        cache.set("f1", make_result());
        let _ = cache.get("f1"); // hit
        let _ = cache.get("f2"); // miss
        assert!((cache.hit_rate() - 0.5).abs() < 0.01);
    }
}
