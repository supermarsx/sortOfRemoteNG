//! # DNS Resolver
//!
//! Unified resolver that dispatches queries through the configured transport
//! (System, DoH, DoT, ODoH) with caching, fallback, and DNSSEC support.

use crate::cache::DnsCache;
use crate::types::*;
use std::sync::{Arc, Mutex};

/// The main DNS resolver — owns config, cache, and dispatches queries.
#[derive(Debug)]
pub struct DnsResolver {
    pub config: DnsResolverConfig,
    pub cache: DnsCache,
    /// Round-robin index.
    server_index: usize,
    /// Query statistics.
    pub stats: ResolverStats,
}

pub type DnsResolverState = Arc<Mutex<DnsResolver>>;

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ResolverStats {
    pub queries_total: u64,
    pub queries_success: u64,
    pub queries_failed: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub doh_queries: u64,
    pub dot_queries: u64,
    pub system_queries: u64,
    pub dnssec_validated: u64,
    pub fallback_used: u64,
}

impl DnsResolver {
    pub fn new(config: DnsResolverConfig) -> Self {
        let cache = DnsCache::new(config.cache_max_entries, config.min_ttl, config.max_ttl);
        Self {
            config,
            cache,
            server_index: 0,
            stats: ResolverStats::default(),
        }
    }

    /// Create with default config (system resolver + cache).
    pub fn default_system() -> Self {
        Self::new(DnsResolverConfig::default())
    }

    /// Create with DoH config.
    pub fn with_doh(servers: Vec<DnsServer>) -> Self {
        let config = DnsResolverConfig {
            protocol: DnsProtocol::DoH,
            servers,
            ..Default::default()
        };
        Self::new(config)
    }

    /// Create with DoT config.
    pub fn with_dot(servers: Vec<DnsServer>) -> Self {
        let config = DnsResolverConfig {
            protocol: DnsProtocol::DoT,
            servers,
            ..Default::default()
        };
        Self::new(config)
    }

    /// Resolve a hostname to IP addresses (A + AAAA).
    pub async fn resolve(&mut self, hostname: &str) -> Result<DnsResponse, String> {
        // Check cache first
        let cache_key_a = format!("{}:A", hostname);
        let cache_key_aaaa = format!("{}:AAAA", hostname);

        if self.config.cache_enabled {
            if let Some(cached) = self.cache.get(&cache_key_a) {
                self.stats.cache_hits += 1;
                return Ok(cached);
            }
            self.stats.cache_misses += 1;
        }

        let mut query = DnsQuery::new(hostname, DnsRecordType::A);
        if self.config.dnssec {
            query = query.with_dnssec();
        }

        let result = self.execute_query(&query).await;

        // If successful, optionally also resolve AAAA
        match result {
            Ok(mut response) => {
                if !self.config.ipv4_only {
                    let aaaa_query = DnsQuery::new(hostname, DnsRecordType::AAAA);
                    if let Ok(aaaa_resp) = self.execute_query(&aaaa_query).await {
                        if self.config.cache_enabled {
                            self.cache.put(&cache_key_aaaa, &aaaa_resp);
                        }
                        response.answers.extend(aaaa_resp.answers);
                    }
                }

                if self.config.cache_enabled {
                    self.cache.put(&cache_key_a, &response);
                }

                self.stats.queries_success += 1;
                Ok(response)
            }
            Err(e) => {
                self.stats.queries_failed += 1;
                Err(e)
            }
        }
    }

    /// Resolve a specific record type.
    pub async fn resolve_record(
        &mut self,
        name: &str,
        record_type: DnsRecordType,
    ) -> Result<DnsResponse, String> {
        let cache_key = format!("{}:{}", name, record_type.as_str());

        if self.config.cache_enabled {
            if let Some(cached) = self.cache.get(&cache_key) {
                self.stats.cache_hits += 1;
                return Ok(cached);
            }
            self.stats.cache_misses += 1;
        }

        let mut query = DnsQuery::new(name, record_type);
        if self.config.dnssec {
            query = query.with_dnssec();
        }

        let result = self.execute_query(&query).await;

        match result {
            Ok(response) => {
                if self.config.cache_enabled {
                    self.cache.put(&cache_key, &response);
                }
                self.stats.queries_success += 1;
                Ok(response)
            }
            Err(e) => {
                self.stats.queries_failed += 1;
                Err(e)
            }
        }
    }

    /// Reverse DNS lookup (PTR).
    pub async fn reverse_lookup(&mut self, ip: &str) -> Result<DnsResponse, String> {
        let ptr_name = crate::wire::reverse_dns_name(ip)
            .ok_or_else(|| format!("Invalid IP address for reverse lookup: {}", ip))?;
        self.resolve_record(&ptr_name, DnsRecordType::PTR).await
    }

    /// Look up MX records for a domain.
    pub async fn lookup_mx(&mut self, domain: &str) -> Result<Vec<(u16, String)>, String> {
        let response = self.resolve_record(domain, DnsRecordType::MX).await?;
        Ok(response.mx_records())
    }

    /// Look up TXT records for a domain.
    pub async fn lookup_txt(&mut self, domain: &str) -> Result<Vec<String>, String> {
        let response = self.resolve_record(domain, DnsRecordType::TXT).await?;
        Ok(response.txt_records())
    }

    /// Look up SRV records.
    pub async fn lookup_srv(&mut self, name: &str) -> Result<Vec<(u16, u16, u16, String)>, String> {
        let response = self.resolve_record(name, DnsRecordType::SRV).await?;
        Ok(response.srv_records())
    }

    /// Look up SSHFP records for SSH host key verification.
    pub async fn lookup_sshfp(&mut self, hostname: &str) -> Result<Vec<(u8, u8, String)>, String> {
        let response = self.resolve_record(hostname, DnsRecordType::SSHFP).await?;
        Ok(response.sshfp_records())
    }

    /// Look up TLSA records for DANE.
    pub async fn lookup_tlsa(
        &mut self,
        port: u16,
        protocol: &str,
        hostname: &str,
    ) -> Result<Vec<(u8, u8, u8, String)>, String> {
        let name = format!("_{}._{}.{}", port, protocol, hostname);
        let response = self.resolve_record(&name, DnsRecordType::TLSA).await?;
        Ok(response.tlsa_records())
    }

    /// Look up CAA records.
    pub async fn lookup_caa(&mut self, domain: &str) -> Result<DnsResponse, String> {
        self.resolve_record(domain, DnsRecordType::CAA).await
    }

    /// Execute a raw query through the configured transport.
    pub async fn execute_query(&mut self, query: &DnsQuery) -> Result<DnsResponse, String> {
        self.stats.queries_total += 1;

        let server = self.next_server();
        let protocol = server.protocol.unwrap_or(self.config.protocol);

        let result = match protocol {
            DnsProtocol::DoH => {
                self.stats.doh_queries += 1;
                crate::doh::execute_doh_query(query, &server, &self.config).await
            }
            DnsProtocol::DoT => {
                self.stats.dot_queries += 1;
                crate::dot::execute_dot_query(query, &server, &self.config).await
            }
            DnsProtocol::ODoH => {
                crate::odoh::execute_odoh_query(query, &server, &self.config).await
            }
            _ => {
                self.stats.system_queries += 1;
                crate::system::execute_system_query(query, &self.config).await
            }
        };

        // If primary fails and we have a fallback, try it
        if result.is_err() {
            if let Some(fallback) = self.config.fallback_protocol {
                self.stats.fallback_used += 1;
                log::info!(
                    "DNS primary protocol {:?} failed, falling back to {:?}",
                    protocol,
                    fallback
                );
                return match fallback {
                    DnsProtocol::DoH => {
                        crate::doh::execute_doh_query(query, &server, &self.config).await
                    }
                    DnsProtocol::DoT => {
                        crate::dot::execute_dot_query(query, &server, &self.config).await
                    }
                    _ => crate::system::execute_system_query(query, &self.config).await,
                };
            }
        }

        if let Ok(ref resp) = result {
            if resp.is_dnssec_validated() {
                self.stats.dnssec_validated += 1;
            }
        }

        result
    }

    /// Get the next server (round-robin if configured).
    fn next_server(&mut self) -> DnsServer {
        if self.config.servers.is_empty() {
            return DnsServer::plain("127.0.0.53");
        }

        let server = self.config.servers[self.server_index % self.config.servers.len()].clone();
        if self.config.rotate_servers {
            self.server_index = (self.server_index + 1) % self.config.servers.len();
        }
        server
    }

    /// Update the resolver config at runtime.
    pub fn update_config(&mut self, config: DnsResolverConfig) {
        self.cache = DnsCache::new(config.cache_max_entries, config.min_ttl, config.max_ttl);
        self.config = config;
        self.server_index = 0;
    }

    /// Flush the cache.
    pub fn flush_cache(&mut self) {
        self.cache.flush();
    }

    /// Get resolver statistics.
    pub fn statistics(&self) -> ResolverStats {
        self.stats.clone()
    }

    /// Reset statistics.
    pub fn reset_stats(&mut self) {
        self.stats = ResolverStats::default();
    }

    /// Get reference to the resolver config.
    pub fn config(&self) -> &DnsResolverConfig {
        &self.config
    }

    /// Get reference to statistics.
    pub fn stats(&self) -> &ResolverStats {
        &self.stats
    }

    /// Get the number of entries in the cache.
    pub fn cache_len(&self) -> usize {
        self.cache.len()
    }

    /// Get the cache hit rate (0.0 — 1.0).
    pub fn cache_hit_rate(&self) -> f64 {
        let total = self.stats.cache_hits + self.stats.cache_misses;
        if total == 0 {
            0.0
        } else {
            self.stats.cache_hits as f64 / total as f64
        }
    }
}
