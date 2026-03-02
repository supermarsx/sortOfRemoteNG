use std::collections::HashMap;
use std::time::{Duration, Instant};
use sha2::{Sha256, Digest};
use serde::{Serialize, Deserialize};

use crate::types::{ChatCompletionRequest, ChatCompletionResponse};
use crate::error::LlmResult;
use crate::config::CacheConfig;

/// Cached response entry
struct CacheEntry {
    response: ChatCompletionResponse,
    created_at: Instant,
    ttl: Duration,
    size_bytes: usize,
    access_count: u64,
    last_accessed: Instant,
}

impl CacheEntry {
    fn is_expired(&self) -> bool {
        self.created_at.elapsed() > self.ttl
    }
}

/// In-memory response cache with LRU eviction and TTL
pub struct ResponseCache {
    entries: HashMap<String, CacheEntry>,
    config: CacheConfig,
    total_size: usize,
    hits: u64,
    misses: u64,
}

impl ResponseCache {
    pub fn new(config: CacheConfig) -> Self {
        Self {
            entries: HashMap::new(),
            config,
            total_size: 0,
            hits: 0,
            misses: 0,
        }
    }

    /// Generate a cache key from a request
    pub fn cache_key(request: &ChatCompletionRequest) -> String {
        let mut hasher = Sha256::new();
        hasher.update(&request.model);

        // Hash messages content
        for msg in &request.messages {
            hasher.update(format!("{:?}", msg.role));
            hasher.update(msg.text_content());
        }

        // Hash parameters that affect output
        if let Some(t) = request.temperature {
            hasher.update(t.to_string());
        }
        if let Some(tp) = request.top_p {
            hasher.update(tp.to_string());
        }
        if let Some(mt) = request.max_tokens {
            hasher.update(mt.to_string());
        }
        if let Some(s) = request.seed {
            hasher.update(s.to_string());
        }

        // Hash tools if present (don't cache tool calls by default)
        if let Some(ref tools) = request.tools {
            for tool in tools {
                hasher.update(&tool.function.name);
            }
        }

        format!("{:x}", hasher.finalize())
    }

    /// Look up a cached response
    pub fn get(&mut self, request: &ChatCompletionRequest) -> Option<ChatCompletionResponse> {
        if !self.config.enabled {
            return None;
        }

        // Don't cache streaming or tool-call requests by default
        if request.stream {
            return None;
        }
        if !self.config.cache_tool_calls && request.tools.is_some() {
            return None;
        }

        let key = Self::cache_key(request);
        if let Some(entry) = self.entries.get_mut(&key) {
            if entry.is_expired() {
                let size = entry.size_bytes;
                self.entries.remove(&key);
                self.total_size = self.total_size.saturating_sub(size);
                self.misses += 1;
                return None;
            }
            entry.access_count += 1;
            entry.last_accessed = Instant::now();
            self.hits += 1;
            let mut response = entry.response.clone();
            response.cached = true;
            Some(response)
        } else {
            self.misses += 1;
            None
        }
    }

    /// Store a response in cache
    pub fn put(&mut self, request: &ChatCompletionRequest, response: &ChatCompletionResponse) {
        if !self.config.enabled || request.stream {
            return;
        }
        if !self.config.cache_tool_calls && request.tools.is_some() {
            return;
        }

        let key = Self::cache_key(request);
        let serialized = serde_json::to_string(response).unwrap_or_default();
        let size_bytes = serialized.len();

        // Evict if needed
        let max_bytes = (self.config.max_memory_mb as usize) * 1024 * 1024;
        while self.total_size + size_bytes > max_bytes || self.entries.len() >= self.config.max_entries {
            if !self.evict_one() {
                break;
            }
        }

        let entry = CacheEntry {
            response: response.clone(),
            created_at: Instant::now(),
            ttl: Duration::from_secs(self.config.ttl_seconds),
            size_bytes,
            access_count: 0,
            last_accessed: Instant::now(),
        };
        self.total_size += size_bytes;
        self.entries.insert(key, entry);
    }

    /// Evict the least-recently-used entry
    fn evict_one(&mut self) -> bool {
        // First evict expired entries
        let expired: Vec<String> = self
            .entries
            .iter()
            .filter(|(_, e)| e.is_expired())
            .map(|(k, _)| k.clone())
            .collect();
        for k in &expired {
            if let Some(e) = self.entries.remove(k) {
                self.total_size = self.total_size.saturating_sub(e.size_bytes);
            }
        }
        if !expired.is_empty() {
            return true;
        }

        // Otherwise evict least recently accessed
        if let Some(lru_key) = self
            .entries
            .iter()
            .min_by_key(|(_, e)| e.last_accessed)
            .map(|(k, _)| k.clone())
        {
            if let Some(e) = self.entries.remove(&lru_key) {
                self.total_size = self.total_size.saturating_sub(e.size_bytes);
            }
            return true;
        }
        false
    }

    /// Clear all cache entries
    pub fn clear(&mut self) {
        self.entries.clear();
        self.total_size = 0;
    }

    /// Get cache statistics
    pub fn stats(&self) -> CacheStats {
        CacheStats {
            entries: self.entries.len() as u64,
            size_bytes: self.total_size as u64,
            hits: self.hits,
            misses: self.misses,
            hit_rate: if self.hits + self.misses > 0 {
                self.hits as f64 / (self.hits + self.misses) as f64
            } else {
                0.0
            },
        }
    }

    /// Remove expired entries
    pub fn cleanup(&mut self) {
        let expired: Vec<String> = self
            .entries
            .iter()
            .filter(|(_, e)| e.is_expired())
            .map(|(k, _)| k.clone())
            .collect();
        for k in expired {
            if let Some(e) = self.entries.remove(&k) {
                self.total_size = self.total_size.saturating_sub(e.size_bytes);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    pub entries: u64,
    pub size_bytes: u64,
    pub hits: u64,
    pub misses: u64,
    pub hit_rate: f64,
}
