//! # DNS Configuration
//!
//! Serde-friendly configuration presets, config builder, and profile
//! management (Privacy, Speed, Security, Custom).

use crate::providers;
use crate::types::{DnsProtocol, DnsResolverConfig, DnsServer};
use serde::{Deserialize, Serialize};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Configuration profiles
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Named configuration profiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DnsProfile {
    /// Use system DNS (no encryption).
    System,
    /// Maximum privacy: ODoH → DoH → DoT fallback, strict providers.
    Privacy,
    /// Lowest latency: Cloudflare + Google DoH, aggressive caching.
    Speed,
    /// Maximum security: Quad9 with DNSSEC + threat blocking.
    Security,
    /// Ad-blocking: Mullvad or AdGuard with filtering.
    AdBlocking,
    /// Corporate: system DNS + DNSSEC validation for internal domains.
    Corporate,
    /// Custom: user-defined configuration.
    Custom,
}

impl std::fmt::Display for DnsProfile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::System => write!(f, "System"),
            Self::Privacy => write!(f, "Privacy"),
            Self::Speed => write!(f, "Speed"),
            Self::Security => write!(f, "Security"),
            Self::AdBlocking => write!(f, "Ad-blocking"),
            Self::Corporate => write!(f, "Corporate"),
            Self::Custom => write!(f, "Custom"),
        }
    }
}

/// Get a resolver config for a named profile.
pub fn config_for_profile(profile: DnsProfile) -> DnsResolverConfig {
    match profile {
        DnsProfile::System => system_config(),
        DnsProfile::Privacy => privacy_config(),
        DnsProfile::Speed => speed_config(),
        DnsProfile::Security => security_config(),
        DnsProfile::AdBlocking => adblocking_config(),
        DnsProfile::Corporate => corporate_config(),
        DnsProfile::Custom => DnsResolverConfig::default(),
    }
}

/// System DNS (no encryption, no caching beyond OS).
fn system_config() -> DnsResolverConfig {
    DnsResolverConfig {
        protocol: DnsProtocol::System,
        servers: Vec::new(),
        cache_enabled: false,
        dnssec: false,
        ..Default::default()
    }
}

/// Maximum privacy profile.
fn privacy_config() -> DnsResolverConfig {
    let mullvad = providers::mullvad();
    let doh_servers: Vec<DnsServer> = mullvad
        .servers
        .into_iter()
        .filter(|s| {
            s.protocol
                .as_ref()
                .map_or(false, |p| *p == DnsProtocol::DoH)
        })
        .collect();

    DnsResolverConfig {
        protocol: DnsProtocol::DoH,
        servers: doh_servers,
        fallback_protocol: Some(DnsProtocol::DoT),
        cache_enabled: true,
        cache_max_entries: 2000,
        min_ttl: 300,
        max_ttl: 3600,
        dnssec: true,
        timeout_ms: 5000,
        retries: 2,
        ..Default::default()
    }
}

/// Speed-optimized profile.
fn speed_config() -> DnsResolverConfig {
    DnsResolverConfig {
        protocol: DnsProtocol::DoH,
        servers: vec![
            DnsServer::doh("https://cloudflare-dns.com/dns-query"),
            DnsServer::doh("https://dns.google/dns-query"),
        ],
        fallback_protocol: Some(DnsProtocol::System),
        cache_enabled: true,
        cache_max_entries: 5000,
        min_ttl: 600,
        max_ttl: 86400,
        dnssec: false,
        timeout_ms: 3000,
        retries: 1,
        ..Default::default()
    }
}

/// Security profile (DNSSEC + threat filtering).
fn security_config() -> DnsResolverConfig {
    DnsResolverConfig {
        protocol: DnsProtocol::DoH,
        servers: vec![
            DnsServer::doh("https://dns.quad9.net/dns-query"),
        ],
        fallback_protocol: Some(DnsProtocol::DoT),
        cache_enabled: true,
        cache_max_entries: 2000,
        max_ttl: 3600,
        dnssec: true,
        edns0: true,
        timeout_ms: 5000,
        retries: 2,
        ..Default::default()
    }
}

/// Ad-blocking profile.
fn adblocking_config() -> DnsResolverConfig {
    DnsResolverConfig {
        protocol: DnsProtocol::DoH,
        servers: vec![
            DnsServer::doh("https://adblock.dns.mullvad.net/dns-query"),
            DnsServer::doh("https://dns.adguard-dns.com/dns-query"),
        ],
        fallback_protocol: Some(DnsProtocol::DoT),
        cache_enabled: true,
        cache_max_entries: 3000,
        dnssec: true,
        timeout_ms: 5000,
        retries: 2,
        ..Default::default()
    }
}

/// Corporate profile (system DNS with DNSSEC for internal use).
fn corporate_config() -> DnsResolverConfig {
    DnsResolverConfig {
        protocol: DnsProtocol::System,
        servers: Vec::new(),
        cache_enabled: true,
        cache_max_entries: 1000,
        dnssec: true,
        timeout_ms: 3000,
        retries: 1,
        ..Default::default()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Config builder
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Builder for constructing `DnsResolverConfig` step by step.
pub struct DnsConfigBuilder {
    config: DnsResolverConfig,
}

impl DnsConfigBuilder {
    pub fn new() -> Self {
        Self {
            config: DnsResolverConfig::default(),
        }
    }

    /// Start from a named profile.
    pub fn from_profile(profile: DnsProfile) -> Self {
        Self {
            config: config_for_profile(profile),
        }
    }

    /// Start from a provider preset.
    pub fn from_provider(provider_id: &str) -> Self {
        let config = providers::provider_by_id(provider_id)
            .map(|p| providers::resolver_config_from_provider(&p))
            .unwrap_or_default();
        Self { config }
    }

    pub fn protocol(mut self, protocol: DnsProtocol) -> Self {
        self.config.protocol = protocol;
        self
    }

    pub fn add_server(mut self, server: DnsServer) -> Self {
        self.config.servers.push(server);
        self
    }

    pub fn servers(mut self, servers: Vec<DnsServer>) -> Self {
        self.config.servers = servers;
        self
    }

    pub fn fallback(mut self, protocol: DnsProtocol) -> Self {
        self.config.fallback_protocol = Some(protocol);
        self
    }

    pub fn cache(mut self, enabled: bool, max_entries: usize) -> Self {
        self.config.cache_enabled = enabled;
        self.config.cache_max_entries = max_entries;
        self
    }

    pub fn dnssec(mut self, enabled: bool) -> Self {
        self.config.dnssec = enabled;
        self
    }

    pub fn edns0(mut self, enabled: bool) -> Self {
        self.config.edns0 = enabled;
        self
    }

    pub fn timeout(mut self, ms: u64) -> Self {
        self.config.timeout_ms = ms;
        self
    }

    pub fn retries(mut self, retries: u32) -> Self {
        self.config.retries = retries;
        self
    }

    pub fn ttl_overrides(mut self, min: u32, max: u32) -> Self {
        self.config.min_ttl = min;
        self.config.max_ttl = max;
        self
    }

    pub fn search_domains(mut self, domains: Vec<String>) -> Self {
        self.config.search_domains = domains;
        self
    }

    pub fn ndots(mut self, ndots: u8) -> Self {
        self.config.ndots = ndots;
        self
    }

    pub fn build(self) -> DnsResolverConfig {
        self.config
    }
}

impl Default for DnsConfigBuilder {
    fn default() -> Self {
        Self::new()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Serialization for persistent config
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Persistent DNS settings (saved to app config).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsSettings {
    /// Active profile name.
    pub profile: DnsProfile,
    /// Custom config (only used when profile == Custom).
    pub custom_config: Option<DnsResolverConfig>,
    /// Override config for specific domains (split-horizon).
    pub domain_overrides: Vec<DomainOverride>,
    /// Whether to enable DNS leak detection.
    pub enable_leak_detection: bool,
    /// Whether to log DNS queries.
    pub enable_query_logging: bool,
    /// Maximum log entries to keep.
    pub max_log_entries: usize,
}

impl Default for DnsSettings {
    fn default() -> Self {
        Self {
            profile: DnsProfile::Security,
            custom_config: None,
            domain_overrides: Vec::new(),
            enable_leak_detection: true,
            enable_query_logging: false,
            max_log_entries: 10000,
        }
    }
}

/// Domain-specific DNS override (split-horizon DNS).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainOverride {
    /// Domain suffix to match (e.g. "internal.corp.com").
    pub domain: String,
    /// DNS servers to use for this domain.
    pub servers: Vec<DnsServer>,
    /// Protocol for this domain.
    pub protocol: DnsProtocol,
    /// Whether to enable DNSSEC for this domain.
    pub dnssec: bool,
}

/// Get the effective resolver config from settings.
pub fn effective_config(settings: &DnsSettings) -> DnsResolverConfig {
    match settings.profile {
        DnsProfile::Custom => settings
            .custom_config
            .clone()
            .unwrap_or_default(),
        profile => config_for_profile(profile),
    }
}

/// Check if a domain matches a domain override.
pub fn find_domain_override<'a>(
    domain: &str,
    overrides: &'a [DomainOverride],
) -> Option<&'a DomainOverride> {
    overrides
        .iter()
        .filter(|o| domain.ends_with(&o.domain) || domain == o.domain)
        .max_by_key(|o| o.domain.len())
}

/// Validate a DNS configuration for common issues.
pub fn validate_config(config: &DnsResolverConfig) -> Vec<String> {
    let mut issues = Vec::new();

    if config.protocol != DnsProtocol::System && config.servers.is_empty() {
        issues.push("No DNS servers configured for non-system protocol".to_string());
    }

    if config.timeout_ms < 500 {
        issues.push("Timeout is very low (<500ms) — may cause frequent failures".to_string());
    }

    if config.timeout_ms > 30000 {
        issues.push("Timeout is very high (>30s) — may cause poor UX".to_string());
    }

    if config.cache_max_entries > 50000 {
        issues.push("Cache size is very large (>50000) — high memory usage".to_string());
    }

    if config.retries > 5 {
        issues.push("Retry count is very high (>5) — may cause slow resolution".to_string());
    }

    if !config.protocol.is_encrypted() && config.dnssec {
        issues.push("DNSSEC enabled but protocol is not encrypted — responses can be tampered with in transit".to_string());
    }

    issues
}
