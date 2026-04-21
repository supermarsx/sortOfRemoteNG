//! # DNS Service
//!
//! Top-level orchestrator that wraps `DnsResolver` for Tauri state
//! integration. Provides the primary API surface that other crates
//! consume via `DnsServiceState`.

use crate::config::{self, DnsProfile, DnsSettings};
use crate::resolver::DnsResolver;
use crate::types::*;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Tauri-compatible state type.
pub type DnsServiceState = Arc<Mutex<DnsService>>;

/// Top-level DNS service that manages the resolver, settings, and query log.
pub struct DnsService {
    /// The active resolver.
    resolver: DnsResolver,
    /// Persistent settings.
    settings: DnsSettings,
    /// Query log (if enabled).
    query_log: Vec<DnsQueryLogEntry>,
}

impl DnsService {
    /// Create a new service with default settings (Security profile).
    pub fn new() -> Self {
        let settings = DnsSettings::default();
        let config = config::effective_config(&settings);
        let resolver = DnsResolver::new(config);

        Self {
            resolver,
            settings,
            query_log: Vec::new(),
        }
    }

    /// Create a service with a specific profile.
    pub fn with_profile(profile: DnsProfile) -> Self {
        let settings = DnsSettings {
            profile,
            ..Default::default()
        };
        let config = config::effective_config(&settings);
        let resolver = DnsResolver::new(config);

        Self {
            resolver,
            settings,
            query_log: Vec::new(),
        }
    }

    /// Create a service with custom settings.
    pub fn with_settings(settings: DnsSettings) -> Self {
        let config = config::effective_config(&settings);
        let resolver = DnsResolver::new(config);

        Self {
            resolver,
            settings,
            query_log: Vec::new(),
        }
    }

    // ━━━━━━━━━━━━━━━ Resolution API ━━━━━━━━━━━━━━━

    /// Resolve a hostname to IP addresses.
    pub async fn resolve(&mut self, hostname: &str) -> Result<Vec<String>, String> {
        let result = self.resolve_with_logging(hostname, DnsRecordType::A).await;
        result.map(|r| r.ip_addresses())
    }

    /// Resolve a specific record type.
    pub async fn resolve_record(
        &mut self,
        name: &str,
        record_type: DnsRecordType,
    ) -> Result<DnsResponse, String> {
        self.resolve_with_logging(name, record_type).await
    }

    /// Reverse DNS lookup.
    pub async fn reverse_lookup(&mut self, ip: &str) -> Result<Vec<String>, String> {
        let response = self.resolver.reverse_lookup(ip).await?;
        self.log_query(ip, DnsRecordType::PTR, true);
        let names: Vec<String> = response
            .answers
            .iter()
            .filter_map(|r| match &r.data {
                DnsRecordData::PTR { domain } => Some(domain.clone()),
                _ => None,
            })
            .collect();
        Ok(names)
    }

    /// MX record lookup.
    pub async fn lookup_mx(&mut self, domain: &str) -> Result<Vec<(u16, String)>, String> {
        let result = self.resolver.lookup_mx(domain).await?;
        self.log_query(domain, DnsRecordType::MX, true);
        Ok(result)
    }

    /// TXT record lookup.
    pub async fn lookup_txt(&mut self, domain: &str) -> Result<Vec<String>, String> {
        let result = self.resolver.lookup_txt(domain).await?;
        self.log_query(domain, DnsRecordType::TXT, true);
        Ok(result)
    }

    /// SRV record lookup.
    pub async fn lookup_srv(&mut self, name: &str) -> Result<Vec<(u16, u16, u16, String)>, String> {
        let result = self.resolver.lookup_srv(name).await?;
        self.log_query(name, DnsRecordType::SRV, true);
        Ok(result)
    }

    /// SSHFP record lookup.
    pub async fn lookup_sshfp(&mut self, hostname: &str) -> Result<Vec<(u8, u8, String)>, String> {
        let result = self.resolver.lookup_sshfp(hostname).await?;
        self.log_query(hostname, DnsRecordType::SSHFP, true);
        Ok(result)
    }

    /// TLSA/DANE record lookup.
    pub async fn lookup_tlsa(
        &mut self,
        port: u16,
        protocol: &str,
        hostname: &str,
    ) -> Result<Vec<(u8, u8, u8, String)>, String> {
        let result = self.resolver.lookup_tlsa(port, protocol, hostname).await?;
        self.log_query(hostname, DnsRecordType::TLSA, true);
        Ok(result)
    }

    /// CAA record lookup.
    pub async fn lookup_caa(&mut self, domain: &str) -> Result<DnsResponse, String> {
        let result = self.resolver.lookup_caa(domain).await?;
        self.log_query(domain, DnsRecordType::CAA, true);
        Ok(result)
    }

    // ━━━━━━━━━━━━━━━ Domain-override-aware resolution ━━━━━━━━━━━━━━━

    /// Resolve with domain-specific overrides (split-horizon DNS).
    pub async fn resolve_with_overrides(&mut self, hostname: &str) -> Result<Vec<String>, String> {
        if let Some(override_config) =
            config::find_domain_override(hostname, &self.settings.domain_overrides)
        {
            // Use override-specific servers
            let mut override_resolver = DnsResolver::new(DnsResolverConfig {
                protocol: override_config.protocol,
                servers: override_config.servers.clone(),
                dnssec: override_config.dnssec,
                ..self.resolver.config().clone()
            });

            let response = override_resolver.resolve(hostname).await?;
            self.log_query(hostname, DnsRecordType::A, true);
            Ok(response.ip_addresses())
        } else {
            self.resolve(hostname).await
        }
    }

    // ━━━━━━━━━━━━━━━ Configuration ━━━━━━━━━━━━━━━

    /// Get current settings.
    pub fn settings(&self) -> &DnsSettings {
        &self.settings
    }

    /// Update settings and reconfigure the resolver.
    pub fn update_settings(&mut self, settings: DnsSettings) {
        let config = config::effective_config(&settings);
        self.resolver = DnsResolver::new(config);
        self.settings = settings;
        log::info!(
            "DNS service reconfigured with profile: {}",
            self.settings.profile
        );
    }

    /// Switch to a different profile.
    pub fn set_profile(&mut self, profile: DnsProfile) {
        self.settings.profile = profile;
        self.settings.custom_config = None;
        let config = config::effective_config(&self.settings);
        self.resolver = DnsResolver::new(config);
        log::info!("DNS profile changed to: {}", profile);
    }

    /// Get the current profile.
    pub fn profile(&self) -> DnsProfile {
        self.settings.profile
    }

    /// Get the resolver configuration.
    pub fn resolver_config(&self) -> &DnsResolverConfig {
        self.resolver.config()
    }

    /// Validate current configuration.
    pub fn validate_config(&self) -> Vec<String> {
        config::validate_config(self.resolver.config())
    }

    // ━━━━━━━━━━━━━━━ Cache management ━━━━━━━━━━━━━━━

    /// Flush the DNS cache.
    pub fn flush_cache(&mut self) {
        self.resolver.flush_cache();
        log::info!("DNS cache flushed");
    }

    /// Get cache statistics.
    pub fn cache_stats(&self) -> CacheStatsInfo {
        CacheStatsInfo {
            entries: self.resolver.cache_len(),
            max_entries: self.resolver.config().cache_max_entries,
            hit_rate: self.resolver.cache_hit_rate(),
        }
    }

    // ━━━━━━━━━━━━━━━ Statistics ━━━━━━━━━━━━━━━

    /// Get resolver statistics.
    pub fn stats(&self) -> &crate::resolver::ResolverStats {
        self.resolver.stats()
    }

    /// Reset statistics.
    pub fn reset_stats(&mut self) {
        self.resolver.reset_stats();
    }

    // ━━━━━━━━━━━━━━━ Query logging ━━━━━━━━━━━━━━━

    /// Get the query log.
    pub fn query_log(&self) -> &[DnsQueryLogEntry] {
        &self.query_log
    }

    /// Clear the query log.
    pub fn clear_query_log(&mut self) {
        self.query_log.clear();
    }

    /// Get the number of logged queries.
    pub fn query_log_count(&self) -> usize {
        self.query_log.len()
    }

    // ━━━━━━━━━━━━━━━ Diagnostics ━━━━━━━━━━━━━━━

    /// Run DNS diagnostics.
    pub async fn run_diagnostics(&mut self) -> crate::diagnostics::DnsDiagnosticReport {
        crate::diagnostics::generate_diagnostic_report(&mut self.resolver).await
    }

    /// Run benchmarks.
    pub async fn run_benchmark(
        &mut self,
        iterations: usize,
    ) -> crate::diagnostics::DnsBenchmarkReport {
        crate::diagnostics::benchmark_resolver(&mut self.resolver, iterations).await
    }

    /// Compare protocol performance.
    pub async fn compare_protocols(&self, domain: &str) -> crate::diagnostics::ProtocolComparison {
        crate::diagnostics::compare_protocols(domain).await
    }

    // ━━━━━━━━━━━━━━━ Leak detection ━━━━━━━━━━━━━━━

    /// Run DNS leak test.
    pub async fn run_leak_test(&mut self) -> crate::leak_detection::LeakTestReport {
        crate::leak_detection::run_leak_test(&mut self.resolver).await
    }

    /// Check if DNS is encrypted.
    pub fn is_encrypted(&self) -> bool {
        crate::leak_detection::is_dns_encrypted(self.resolver.config())
    }

    // ━━━━━━━━━━━━━━━ Internal helpers ━━━━━━━━━━━━━━━

    /// Resolve and log the query.
    async fn resolve_with_logging(
        &mut self,
        name: &str,
        record_type: DnsRecordType,
    ) -> Result<DnsResponse, String> {
        let result = self.resolver.resolve_record(name, record_type).await;
        self.log_query(name, record_type, result.is_ok());
        result
    }

    /// Add an entry to the query log.
    fn log_query(&mut self, name: &str, record_type: DnsRecordType, success: bool) {
        if !self.settings.enable_query_logging {
            return;
        }

        let entry = DnsQueryLogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            name: name.to_string(),
            record_type: record_type.as_str().to_string(),
            protocol: format!("{}", self.resolver.config().protocol),
            success,
            cached: false, // Would need cache-hit info from resolver
        };

        self.query_log.push(entry);

        // Trim log if needed
        if self.query_log.len() > self.settings.max_log_entries {
            let excess = self.query_log.len() - self.settings.max_log_entries;
            self.query_log.drain(..excess);
        }
    }

    /// Get a mutable reference to the inner resolver (for advanced usage).
    pub fn resolver_mut(&mut self) -> &mut DnsResolver {
        &mut self.resolver
    }

    /// Get a reference to the inner resolver.
    pub fn resolver(&self) -> &DnsResolver {
        &self.resolver
    }
}

impl Default for DnsService {
    fn default() -> Self {
        Self::new()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Serializable types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A logged DNS query entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsQueryLogEntry {
    pub timestamp: String,
    pub name: String,
    pub record_type: String,
    pub protocol: String,
    pub success: bool,
    pub cached: bool,
}

/// Cache statistics for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStatsInfo {
    pub entries: usize,
    pub max_entries: usize,
    pub hit_rate: f64,
}

/// Service status for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsServiceStatus {
    pub profile: String,
    pub protocol: String,
    pub encrypted: bool,
    pub dnssec_enabled: bool,
    pub cache_enabled: bool,
    pub cache_entries: usize,
    pub total_queries: u64,
    pub success_rate: f64,
    pub server_count: usize,
}

impl DnsService {
    /// Get a frontend-friendly status summary.
    pub fn status(&self) -> DnsServiceStatus {
        let stats = self.stats();
        let success_rate = if stats.queries_total > 0 {
            stats.queries_success as f64 / stats.queries_total as f64
        } else {
            1.0
        };

        DnsServiceStatus {
            profile: format!("{}", self.settings.profile),
            protocol: format!("{}", self.resolver.config().protocol),
            encrypted: self.is_encrypted(),
            dnssec_enabled: self.resolver.config().dnssec,
            cache_enabled: self.resolver.config().cache_enabled,
            cache_entries: self.resolver.cache_len(),
            total_queries: stats.queries_total,
            success_rate,
            server_count: self.resolver.config().servers.len(),
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Factory helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Create a `DnsServiceState` for Tauri managed state.
pub fn create_dns_service_state() -> DnsServiceState {
    Arc::new(Mutex::new(DnsService::new()))
}

/// Create a state with a specific profile.
pub fn create_dns_service_state_with_profile(profile: DnsProfile) -> DnsServiceState {
    Arc::new(Mutex::new(DnsService::with_profile(profile)))
}

/// Create a state from saved settings.
pub fn create_dns_service_from_settings(settings: DnsSettings) -> DnsServiceState {
    Arc::new(Mutex::new(DnsService::with_settings(settings)))
}
