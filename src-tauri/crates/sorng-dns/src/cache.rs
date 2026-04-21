//! # DNS Response Cache
//!
//! LRU + TTL-aware DNS response cache. Caches results keyed by
//! `name:record_type` with automatic expiry based on record TTLs.

use crate::types::*;
use std::collections::HashMap;

/// A cached DNS response with expiry tracking.
#[derive(Debug, Clone)]
struct CacheEntry {
    response: DnsResponse,
    inserted_at: std::time::Instant,
    effective_ttl: u32,
}

/// TTL-aware LRU DNS cache.
#[derive(Debug)]
pub struct DnsCache {
    entries: HashMap<String, CacheEntry>,
    max_entries: usize,
    min_ttl: u32,
    max_ttl: u32,
    /// Access order for LRU eviction (most-recent at end).
    access_order: Vec<String>,
    pub stats: CacheStats,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub inserts: u64,
    pub evictions: u64,
    pub expirations: u64,
}

impl DnsCache {
    pub fn new(max_entries: usize, min_ttl: u32, max_ttl: u32) -> Self {
        Self {
            entries: HashMap::new(),
            max_entries: max_entries.max(1),
            min_ttl,
            max_ttl,
            access_order: Vec::new(),
            stats: CacheStats::default(),
        }
    }

    /// Look up a cached response. Returns `None` if missing or expired.
    pub fn get(&mut self, key: &str) -> Option<DnsResponse> {
        // First check existence and compute derived values without holding borrow
        let lookup = self.entries.get(key).map(|entry| {
            let age = entry.inserted_at.elapsed().as_secs() as u32;
            (age, entry.effective_ttl, entry.response.clone())
        });

        match lookup {
            Some((age, effective_ttl, response)) if age < effective_ttl => {
                self.touch(key);
                self.stats.hits += 1;

                let remaining = effective_ttl.saturating_sub(age);
                let mut response = response;
                for record in &mut response.answers {
                    record.ttl = remaining;
                }
                return Some(response);
            }
            Some(_) => {
                // Expired — remove it
                self.remove(key);
                self.stats.expirations += 1;
            }
            None => {}
        }

        self.stats.misses += 1;
        None
    }

    /// Insert a DNS response into the cache.
    pub fn put(&mut self, key: &str, response: &DnsResponse) {
        // Compute effective TTL (min of all answer TTLs, clamped)
        let record_ttl = response.min_ttl();
        let ttl = record_ttl.clamp(self.min_ttl, self.max_ttl);

        // Don't cache error responses (except NXDOMAIN which is useful)
        if !response.rcode.is_success() && !matches!(response.rcode, DnsRcode::NXDomain) {
            return;
        }

        // Evict if at capacity
        while self.entries.len() >= self.max_entries {
            self.evict_lru();
        }

        let entry = CacheEntry {
            response: response.clone(),
            inserted_at: std::time::Instant::now(),
            effective_ttl: ttl,
        };

        // Remove old entry if exists (to reset ordering)
        self.remove(key);

        self.entries.insert(key.to_string(), entry);
        self.access_order.push(key.to_string());
        self.stats.inserts += 1;
    }

    /// Remove a specific entry.
    pub fn remove(&mut self, key: &str) {
        self.entries.remove(key);
        self.access_order.retain(|k| k != key);
    }

    /// Flush all entries.
    pub fn flush(&mut self) {
        self.entries.clear();
        self.access_order.clear();
    }

    /// Number of entries currently in cache.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Purge all expired entries.
    pub fn purge_expired(&mut self) {
        let expired: Vec<String> = self
            .entries
            .iter()
            .filter(|(_, entry)| {
                entry.inserted_at.elapsed().as_secs() as u32 >= entry.effective_ttl
            })
            .map(|(key, _)| key.clone())
            .collect();

        for key in &expired {
            self.remove(key);
            self.stats.expirations += 1;
        }
    }

    /// Get cache statistics.
    pub fn statistics(&self) -> CacheStats {
        self.stats.clone()
    }

    fn touch(&mut self, key: &str) {
        self.access_order.retain(|k| k != key);
        self.access_order.push(key.to_string());
    }

    fn evict_lru(&mut self) {
        if let Some(oldest_key) = self.access_order.first().cloned() {
            self.entries.remove(&oldest_key);
            self.access_order.remove(0);
            self.stats.evictions += 1;
        }
    }
}

/// Pre-populate cache with static/pinned entries (e.g., for split-horizon DNS).
pub fn seed_cache(cache: &mut DnsCache, entries: &[(String, DnsRecordType, Vec<String>)]) {
    for (name, rtype, values) in entries {
        let records: Vec<DnsRecord> = values
            .iter()
            .map(|v| DnsRecord {
                name: name.clone(),
                record_type: *rtype,
                ttl: 86400, // 24h for pinned entries
                data: match rtype {
                    DnsRecordType::A => DnsRecordData::A { address: v.clone() },
                    DnsRecordType::AAAA => DnsRecordData::AAAA { address: v.clone() },
                    DnsRecordType::CNAME => DnsRecordData::CNAME { target: v.clone() },
                    _ => DnsRecordData::TXT { text: v.clone() },
                },
            })
            .collect();

        let response = DnsResponse {
            rcode: DnsRcode::NoError,
            authoritative: false,
            truncated: false,
            recursion_available: true,
            authenticated_data: false,
            answers: records,
            authority: Vec::new(),
            additional: Vec::new(),
            duration_ms: 0,
            server: "cache-seed".to_string(),
            protocol: DnsProtocol::System,
        };

        let key = format!("{}:{}", name, rtype.as_str());
        cache.put(&key, &response);
    }
}

/// Negative cache entry for NXDOMAIN results.
pub fn cache_negative(cache: &mut DnsCache, name: &str, rtype: DnsRecordType, ttl: u32) {
    let response = DnsResponse {
        rcode: DnsRcode::NXDomain,
        authoritative: false,
        truncated: false,
        recursion_available: true,
        authenticated_data: false,
        answers: Vec::new(),
        authority: Vec::new(),
        additional: Vec::new(),
        duration_ms: 0,
        server: "negative-cache".to_string(),
        protocol: DnsProtocol::System,
    };

    let key = format!("{}:{}", name, rtype.as_str());
    // Temporarily adjust max_ttl for negative caching
    let orig_max = cache.max_ttl;
    cache.max_ttl = ttl;
    cache.put(&key, &response);
    cache.max_ttl = orig_max;
}
