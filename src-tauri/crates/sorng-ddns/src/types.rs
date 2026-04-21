//! # DDNS Types
//!
//! All data structures for the Dynamic DNS subsystem — providers,
//! profiles, IP detection, update results, health, audit, and
//! service state.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

// ── Provider Enum ───────────────────────────────────────────────────

/// Supported DDNS providers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum DdnsProvider {
    Cloudflare,
    NoIp,
    DuckDns,
    AfraidDns,
    Dynu,
    Namecheap,
    GoDaddy,
    GoogleDomains,
    HurricaneElectric,
    ChangeIp,
    Ydns,
    DnsPod,
    Ovh,
    Porkbun,
    Gandi,
    Custom,
}

impl DdnsProvider {
    /// Human-readable label.
    pub fn label(&self) -> &str {
        match self {
            Self::Cloudflare => "Cloudflare",
            Self::NoIp => "No-IP",
            Self::DuckDns => "DuckDNS",
            Self::AfraidDns => "Afraid DNS (FreeDNS)",
            Self::Dynu => "Dynu",
            Self::Namecheap => "Namecheap",
            Self::GoDaddy => "GoDaddy",
            Self::GoogleDomains => "Google Domains",
            Self::HurricaneElectric => "Hurricane Electric",
            Self::ChangeIp => "ChangeIP",
            Self::Ydns => "YDNS",
            Self::DnsPod => "DNSPod",
            Self::Ovh => "OVH",
            Self::Porkbun => "Porkbun",
            Self::Gandi => "Gandi",
            Self::Custom => "Custom",
        }
    }

    /// Parse from a string label.
    pub fn from_str_label(s: &str) -> Self {
        match s.to_lowercase().replace(['-', '_', ' '], "").as_str() {
            "cloudflare" | "cf" => Self::Cloudflare,
            "noip" => Self::NoIp,
            "duckdns" | "duck" => Self::DuckDns,
            "afraiddns" | "afraid" | "freedns" => Self::AfraidDns,
            "dynu" => Self::Dynu,
            "namecheap" => Self::Namecheap,
            "godaddy" => Self::GoDaddy,
            "googledomains" | "google" => Self::GoogleDomains,
            "hurricaneelectric" | "he" | "tunnelbroker" => Self::HurricaneElectric,
            "changeip" => Self::ChangeIp,
            "ydns" => Self::Ydns,
            "dnspod" | "tencent" => Self::DnsPod,
            "ovh" => Self::Ovh,
            "porkbun" => Self::Porkbun,
            "gandi" => Self::Gandi,
            _ => Self::Custom,
        }
    }

    /// All known providers.
    pub fn all() -> Vec<Self> {
        vec![
            Self::Cloudflare,
            Self::NoIp,
            Self::DuckDns,
            Self::AfraidDns,
            Self::Dynu,
            Self::Namecheap,
            Self::GoDaddy,
            Self::GoogleDomains,
            Self::HurricaneElectric,
            Self::ChangeIp,
            Self::Ydns,
            Self::DnsPod,
            Self::Ovh,
            Self::Porkbun,
            Self::Gandi,
            Self::Custom,
        ]
    }
}

impl std::fmt::Display for DdnsProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

// ── IP Version ──────────────────────────────────────────────────────

/// Which IP addresses to detect/update.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
pub enum IpVersion {
    /// IPv4 only (A record).
    V4Only,
    /// IPv6 only (AAAA record).
    V6Only,
    /// Dual-stack: update both A and AAAA records.
    DualStack,
    /// Auto-detect available IP versions.
    #[default]
    Auto,
}

// ── Record Type ─────────────────────────────────────────────────────

/// DNS record type for updates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum DnsRecordType {
    A,
    AAAA,
    CNAME,
    TXT,
    MX,
    SRV,
    NS,
}

impl std::fmt::Display for DnsRecordType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::A => write!(f, "A"),
            Self::AAAA => write!(f, "AAAA"),
            Self::CNAME => write!(f, "CNAME"),
            Self::TXT => write!(f, "TXT"),
            Self::MX => write!(f, "MX"),
            Self::SRV => write!(f, "SRV"),
            Self::NS => write!(f, "NS"),
        }
    }
}

// ── Authentication ──────────────────────────────────────────────────

/// Authentication method for a provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DdnsAuthMethod {
    /// Simple username + password (No-IP, YDNS, ChangeIP).
    Basic { username: String, password: String },
    /// API token (Cloudflare, DuckDNS, Porkbun, Gandi).
    ApiToken { token: String },
    /// API key + secret (Porkbun, GoDaddy).
    ApiKeySecret { api_key: String, api_secret: String },
    /// Cloudflare global API key + email.
    GlobalApiKey { email: String, api_key: String },
    /// Hash-based auth (Afraid DNS).
    HashAuth { update_hash: String },
    /// Direct URL update (some FreeDNS providers).
    DirectUrl { update_url: String },
    /// OVH consumer key auth.
    OvhAuth {
        application_key: String,
        application_secret: String,
        consumer_key: String,
    },
    /// DNSPod token.
    DnsPodAuth { token_id: String, token: String },
    /// Custom HTTP headers.
    CustomHeaders { headers: HashMap<String, String> },
}

// ── Proxy Mode ──────────────────────────────────────────────────────

/// Cloudflare proxy (orange cloud) toggle.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum CloudflareProxyMode {
    Proxied,
    DnsOnly,
    #[default]
    Unchanged,
}

// ── Provider-Specific Settings ──────────────────────────────────────

/// Provider-specific settings that vary by provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareSettings {
    /// Zone ID (or auto-detect from domain).
    pub zone_id: Option<String>,
    /// Record ID (or auto-detect from hostname).
    pub record_id: Option<String>,
    /// Proxy mode (orange cloud).
    pub proxied: CloudflareProxyMode,
    /// TTL in seconds (1 = auto, 60-86400).
    pub ttl: Option<u32>,
    /// Comment to attach to the record.
    pub comment: Option<String>,
}

/// No-IP specific settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoIpSettings {
    /// Hostname group.
    pub group: Option<String>,
    /// Use HTTPS endpoint.
    pub use_https: bool,
    /// Offline mode — set hostname offline.
    pub offline: bool,
}

/// DuckDNS specific settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuckDnsSettings {
    /// Whether to also clear the TXT record.
    pub clear_txt: bool,
    /// TXT record value (for ACME challenge).
    pub txt_value: Option<String>,
}

/// Afraid DNS specific settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AfraidDnsSettings {
    /// API version (1 or 2).
    pub api_version: u8,
    /// SHA-256 hash for v2 API.
    pub update_hash: Option<String>,
}

/// Namecheap specific settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamecheapSettings {
    /// SLD (second-level domain) e.g. "example" in example.com.
    pub sld: String,
    /// TLD (top-level domain) e.g. "com" in example.com.
    pub tld: String,
    /// Host names to update (@ for root, * for wildcard).
    pub hosts: Vec<String>,
}

/// GoDaddy specific settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoDaddySettings {
    /// TTL for the record (default 600s).
    pub ttl: Option<u32>,
}

/// Google Domains specific settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleDomainsSettings {
    /// Use the legacy dyndns2 protocol.
    pub use_dyndns2: bool,
}

/// Hurricane Electric specific settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HurricaneElectricSettings {
    /// Tunnel ID for TunnelBroker updates.
    pub tunnel_id: Option<String>,
}

/// DNSPod specific settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsPodSettings {
    /// Domain ID.
    pub domain_id: Option<String>,
    /// Record ID.
    pub record_id: Option<String>,
    /// Record line (defaults to "默认" / "default").
    pub record_line: Option<String>,
}

/// OVH specific settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OvhSettings {
    /// DynHost subdomain.
    pub subdomain: Option<String>,
    /// Use REST API instead of DynHost.
    pub use_rest_api: bool,
}

/// Porkbun specific settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PorkbunSettings {
    /// TTL (default 600s).
    pub ttl: Option<u32>,
}

/// Gandi specific settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GandiSettings {
    /// TTL (default 300s).
    pub ttl: Option<u32>,
}

/// Custom / generic DDNS provider settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProviderSettings {
    /// Update URL template. Supports placeholders:
    /// `{ip}`, `{ipv6}`, `{hostname}`, `{domain}`, `{username}`, `{password}`
    pub url_template: String,
    /// HTTP method (GET, POST, PUT, PATCH).
    pub method: String,
    /// Optional request body template.
    pub body_template: Option<String>,
    /// Content-Type header for the request body.
    pub content_type: Option<String>,
    /// Expected success response substring.
    pub success_match: Option<String>,
    /// Additional HTTP headers.
    pub extra_headers: HashMap<String, String>,
}

/// Union of all provider-specific settings.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum ProviderSettings {
    Cloudflare(CloudflareSettings),
    NoIp(NoIpSettings),
    DuckDns(DuckDnsSettings),
    AfraidDns(AfraidDnsSettings),
    Namecheap(NamecheapSettings),
    GoDaddy(GoDaddySettings),
    GoogleDomains(GoogleDomainsSettings),
    HurricaneElectric(HurricaneElectricSettings),
    DnsPod(DnsPodSettings),
    Ovh(OvhSettings),
    Porkbun(PorkbunSettings),
    Gandi(GandiSettings),
    Custom(CustomProviderSettings),
    #[default]
    None,
}

// ── DDNS Profile ────────────────────────────────────────────────────

/// A DDNS update profile — ties a provider + domain + auth + schedule together.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DdnsProfile {
    /// Unique profile ID.
    pub id: String,
    /// Human-readable name for this profile.
    pub name: String,
    /// Whether this profile is active.
    pub enabled: bool,
    /// Provider for this profile.
    pub provider: DdnsProvider,
    /// Authentication credentials.
    pub auth: DdnsAuthMethod,
    /// Domain / zone name (e.g. "example.com").
    pub domain: String,
    /// Hostname / subdomain to update (e.g. "home" → home.example.com).
    pub hostname: String,
    /// Which IP versions to detect and update.
    pub ip_version: IpVersion,
    /// Update interval in seconds (0 = manual only).
    pub update_interval_secs: u64,
    /// Provider-specific settings.
    pub provider_settings: ProviderSettings,
    /// Tags for organization.
    pub tags: Vec<String>,
    /// Optional notes.
    pub notes: Option<String>,
    /// When the profile was created.
    pub created_at: String,
    /// When the profile was last modified.
    pub updated_at: String,
}

// ── IP Detection ────────────────────────────────────────────────────

/// Source service for public IP detection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum IpDetectService {
    Ipify,
    Icanhazip,
    IfconfigMe,
    IpinfoIo,
    CheckipAmazonaws,
    WhatismyipAkamai,
    MyExternalIp,
    Ipv6Test,
    Custom(String),
}

impl IpDetectService {
    /// URL for the service.
    pub fn url(&self, ipv6: bool) -> &str {
        match self {
            Self::Ipify => {
                if ipv6 {
                    "https://api6.ipify.org"
                } else {
                    "https://api.ipify.org"
                }
            }
            Self::Icanhazip => {
                if ipv6 {
                    "https://ipv6.icanhazip.com"
                } else {
                    "https://ipv4.icanhazip.com"
                }
            }
            Self::IfconfigMe => "https://ifconfig.me/ip",
            Self::IpinfoIo => "https://ipinfo.io/ip",
            Self::CheckipAmazonaws => "https://checkip.amazonaws.com",
            Self::WhatismyipAkamai => "http://whatismyip.akamai.com",
            Self::MyExternalIp => "https://myexternalip.com/raw",
            Self::Ipv6Test => "https://v6.ident.me",
            Self::Custom(url) => url,
        }
    }

    /// Label for display.
    pub fn label(&self) -> String {
        match self {
            Self::Ipify => "ipify.org".to_string(),
            Self::Icanhazip => "icanhazip.com".to_string(),
            Self::IfconfigMe => "ifconfig.me".to_string(),
            Self::IpinfoIo => "ipinfo.io".to_string(),
            Self::CheckipAmazonaws => "checkip.amazonaws.com".to_string(),
            Self::WhatismyipAkamai => "whatismyip.akamai.com".to_string(),
            Self::MyExternalIp => "myexternalip.com".to_string(),
            Self::Ipv6Test => "v6.ident.me".to_string(),
            Self::Custom(url) => format!("Custom ({})", url),
        }
    }

    /// All built-in services.
    pub fn all_builtin() -> Vec<Self> {
        vec![
            Self::Ipify,
            Self::Icanhazip,
            Self::IfconfigMe,
            Self::IpinfoIo,
            Self::CheckipAmazonaws,
            Self::WhatismyipAkamai,
            Self::MyExternalIp,
            Self::Ipv6Test,
        ]
    }
}

/// Result of an IP detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpDetectResult {
    /// Detected IPv4 address.
    pub ipv4: Option<String>,
    /// Detected IPv6 address.
    pub ipv6: Option<String>,
    /// Which service provided the result.
    pub source: String,
    /// Timestamp of detection.
    pub detected_at: String,
    /// Detection latency in milliseconds.
    pub latency_ms: u64,
}

// ── Update Result ───────────────────────────────────────────────────

/// Outcome of a DDNS update attempt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum UpdateStatus {
    /// Successfully updated the record.
    Success,
    /// Record was already up-to-date (no change needed).
    NoChange,
    /// Update failed.
    Failed,
    /// Provider returned an unexpected response.
    UnexpectedResponse,
    /// Network error (timeout, DNS resolution, etc.).
    NetworkError,
    /// Authentication failed (bad credentials).
    AuthError,
    /// Rate-limited by the provider.
    RateLimited,
    /// Profile is disabled.
    Disabled,
}

/// Full result of a DDNS update operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DdnsUpdateResult {
    /// Profile ID that was updated.
    pub profile_id: String,
    /// Profile name.
    pub profile_name: String,
    /// Provider used.
    pub provider: DdnsProvider,
    /// Status of the update.
    pub status: UpdateStatus,
    /// The IP address that was sent.
    pub ip_sent: Option<String>,
    /// The previous IP address on record.
    pub ip_previous: Option<String>,
    /// Hostname that was updated.
    pub hostname: String,
    /// Full domain (hostname.domain).
    pub fqdn: String,
    /// Provider's raw response.
    pub provider_response: Option<String>,
    /// Error message if failed.
    pub error: Option<String>,
    /// Timestamp of the update.
    pub timestamp: String,
    /// Update latency in milliseconds.
    pub latency_ms: u64,
}

// ── Health / Status ─────────────────────────────────────────────────

/// Health status for a DDNS profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DdnsProfileHealth {
    /// Profile ID.
    pub profile_id: String,
    /// Profile name.
    pub profile_name: String,
    /// Whether the profile is enabled.
    pub enabled: bool,
    /// Provider.
    pub provider: DdnsProvider,
    /// FQDN being updated.
    pub fqdn: String,
    /// Current known IP (v4).
    pub current_ipv4: Option<String>,
    /// Current known IP (v6).
    pub current_ipv6: Option<String>,
    /// Last successful update timestamp.
    pub last_success: Option<String>,
    /// Last failed update timestamp.
    pub last_failure: Option<String>,
    /// Last error message.
    pub last_error: Option<String>,
    /// Total successful updates.
    pub success_count: u64,
    /// Total failed updates.
    pub failure_count: u64,
    /// Consecutive failures (reset on success).
    pub consecutive_failures: u32,
    /// Next scheduled update timestamp.
    pub next_update: Option<String>,
    /// Whether the profile is considered healthy.
    pub is_healthy: bool,
}

/// Global DDNS system status summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DdnsSystemStatus {
    /// Total number of profiles.
    pub total_profiles: usize,
    /// Number of enabled profiles.
    pub enabled_profiles: usize,
    /// Number of healthy profiles.
    pub healthy_profiles: usize,
    /// Number of profiles in error state.
    pub error_profiles: usize,
    /// Current detected IPv4.
    pub current_ipv4: Option<String>,
    /// Current detected IPv6.
    pub current_ipv6: Option<String>,
    /// Whether the scheduler is running.
    pub scheduler_running: bool,
    /// Last global IP check timestamp.
    pub last_ip_check: Option<String>,
    /// Uptime in seconds since service start.
    pub uptime_secs: u64,
}

// ── Provider Capabilities ───────────────────────────────────────────

/// Describes what a provider supports.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    /// Provider identifier.
    pub provider: DdnsProvider,
    /// Human-readable label.
    pub label: String,
    /// Whether IPv4 (A record) is supported.
    pub supports_ipv4: bool,
    /// Whether IPv6 (AAAA record) is supported.
    pub supports_ipv6: bool,
    /// Whether TTL can be controlled.
    pub supports_ttl: bool,
    /// Whether proxy/CDN mode is available.
    pub supports_proxy: bool,
    /// Whether TXT records can be set (ACME challenge).
    pub supports_txt: bool,
    /// Whether multiple hosts per domain are supported.
    pub supports_multi_host: bool,
    /// Authentication methods supported.
    pub auth_methods: Vec<String>,
    /// Whether a free tier is available.
    pub has_free_tier: bool,
    /// Website URL.
    pub website: String,
    /// API documentation URL.
    pub api_docs: Option<String>,
    /// Maximum update interval recommendation (seconds).
    pub min_update_interval_secs: u64,
}

// ── Cloudflare Zone / Record ────────────────────────────────────────

/// Cloudflare DNS zone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareZone {
    /// Zone ID.
    pub id: String,
    /// Domain name.
    pub name: String,
    /// Zone status (active, pending, moved, etc.).
    pub status: String,
    /// Whether the zone is paused.
    pub paused: bool,
    /// Nameservers assigned to this zone.
    pub nameservers: Vec<String>,
    /// Plan name.
    pub plan: Option<String>,
}

/// Cloudflare DNS record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareDnsRecord {
    /// Record ID.
    pub id: String,
    /// Record type (A, AAAA, CNAME, TXT, etc.).
    pub record_type: DnsRecordType,
    /// Record name (full FQDN).
    pub name: String,
    /// Record content (IP address, etc.).
    pub content: String,
    /// TTL (1 = auto).
    pub ttl: u32,
    /// Whether proxied (orange cloud).
    pub proxied: bool,
    /// When the record was last modified.
    pub modified_on: Option<String>,
    /// Comment attached to the record.
    pub comment: Option<String>,
}

// ── Scheduler Types ─────────────────────────────────────────────────

/// Scheduler entry for a profile's next scheduled update.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerEntry {
    /// Profile ID.
    pub profile_id: String,
    /// Next update timestamp (ISO 8601).
    pub next_run: String,
    /// Update interval in seconds.
    pub interval_secs: u64,
    /// Whether the entry is paused.
    pub paused: bool,
    /// Number of times this schedule has fired.
    pub run_count: u64,
    /// Number of consecutive failures before back-off.
    pub back_off_count: u32,
}

/// Scheduler status summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerStatus {
    /// Whether the scheduler is running.
    pub running: bool,
    /// Scheduled entries.
    pub entries: Vec<SchedulerEntry>,
    /// Global tick interval in seconds.
    pub tick_interval_secs: u64,
    /// Total updates performed.
    pub total_updates: u64,
    /// Next scheduled profile update.
    pub next_update: Option<String>,
}

// ── Configuration ───────────────────────────────────────────────────

/// Application-level DDNS configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DdnsConfig {
    /// Preferred IP detection services (ordered by priority).
    pub ip_detect_services: Vec<IpDetectService>,
    /// How often to check for IP changes (seconds).
    pub ip_check_interval_secs: u64,
    /// Maximum retry attempts before back-off.
    pub max_retries: u32,
    /// Initial retry delay in seconds (doubled each attempt).
    pub retry_delay_secs: u64,
    /// Maximum retry delay after exponential back-off.
    pub max_retry_delay_secs: u64,
    /// Whether to jitter update intervals to avoid thundering herd.
    pub jitter_enabled: bool,
    /// Maximum jitter in seconds.
    pub jitter_max_secs: u64,
    /// Global timeout for HTTP requests in seconds.
    pub http_timeout_secs: u64,
    /// Maximum number of audit entries to keep.
    pub max_audit_entries: usize,
    /// Whether to notify on update failure.
    pub notify_on_failure: bool,
    /// Whether to notify on IP change.
    pub notify_on_ip_change: bool,
    /// Custom IP detection URL (overrides service list).
    pub custom_ip_url: Option<String>,
    /// HTTP proxy for update requests (e.g. socks5://...).
    pub http_proxy: Option<String>,
    /// Whether to verify TLS certificates.
    pub verify_tls: bool,
    /// Auto-start scheduler on app launch.
    pub auto_start_scheduler: bool,
}

impl Default for DdnsConfig {
    fn default() -> Self {
        Self {
            ip_detect_services: vec![
                IpDetectService::Ipify,
                IpDetectService::Icanhazip,
                IpDetectService::IfconfigMe,
                IpDetectService::IpinfoIo,
                IpDetectService::CheckipAmazonaws,
            ],
            ip_check_interval_secs: 300,
            max_retries: 3,
            retry_delay_secs: 30,
            max_retry_delay_secs: 3600,
            jitter_enabled: true,
            jitter_max_secs: 15,
            http_timeout_secs: 30,
            max_audit_entries: 5000,
            notify_on_failure: true,
            notify_on_ip_change: true,
            custom_ip_url: None,
            http_proxy: None,
            verify_tls: true,
            auto_start_scheduler: false,
        }
    }
}

// ── Audit ───────────────────────────────────────────────────────────

/// Audit actions for DDNS operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DdnsAuditAction {
    ProfileCreated,
    ProfileUpdated,
    ProfileDeleted,
    ProfileEnabled,
    ProfileDisabled,
    UpdateSuccess,
    UpdateNoChange,
    UpdateFailed,
    UpdateAuthError,
    UpdateRateLimited,
    IpChanged,
    IpCheckFailed,
    SchedulerStarted,
    SchedulerStopped,
    ConfigUpdated,
    BulkImport,
    BulkExport,
    ZoneListed,
    RecordCreated,
    RecordDeleted,
    RecordUpdated,
}

impl DdnsAuditAction {
    /// Human-readable label.
    pub fn label(&self) -> &str {
        match self {
            Self::ProfileCreated => "Profile Created",
            Self::ProfileUpdated => "Profile Updated",
            Self::ProfileDeleted => "Profile Deleted",
            Self::ProfileEnabled => "Profile Enabled",
            Self::ProfileDisabled => "Profile Disabled",
            Self::UpdateSuccess => "Update Success",
            Self::UpdateNoChange => "Update (No Change)",
            Self::UpdateFailed => "Update Failed",
            Self::UpdateAuthError => "Auth Error",
            Self::UpdateRateLimited => "Rate Limited",
            Self::IpChanged => "IP Changed",
            Self::IpCheckFailed => "IP Check Failed",
            Self::SchedulerStarted => "Scheduler Started",
            Self::SchedulerStopped => "Scheduler Stopped",
            Self::ConfigUpdated => "Config Updated",
            Self::BulkImport => "Bulk Import",
            Self::BulkExport => "Bulk Export",
            Self::ZoneListed => "Zone Listed",
            Self::RecordCreated => "Record Created",
            Self::RecordDeleted => "Record Deleted",
            Self::RecordUpdated => "Record Updated",
        }
    }
}

/// A single DDNS audit log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DdnsAuditEntry {
    /// Unique entry ID.
    pub id: String,
    /// Timestamp (ISO 8601).
    pub timestamp: String,
    /// Action performed.
    pub action: DdnsAuditAction,
    /// Profile ID (if applicable).
    pub profile_id: Option<String>,
    /// Profile name (if applicable).
    pub profile_name: Option<String>,
    /// Provider (if applicable).
    pub provider: Option<DdnsProvider>,
    /// Human-readable details.
    pub details: String,
    /// Whether the action succeeded.
    pub success: bool,
    /// Error message if failed.
    pub error: Option<String>,
}

// ── Import / Export ─────────────────────────────────────────────────

/// Exported DDNS data for backup/restore.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DdnsExportData {
    /// Format version.
    pub version: u32,
    /// Export timestamp.
    pub exported_at: String,
    /// Profiles to export.
    pub profiles: Vec<DdnsProfile>,
    /// Configuration.
    pub config: DdnsConfig,
}

/// Result of a bulk import operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DdnsImportResult {
    /// Number of profiles imported.
    pub imported_count: usize,
    /// Number of profiles skipped (duplicates, errors).
    pub skipped_count: usize,
    /// Errors encountered.
    pub errors: Vec<String>,
}

// ── Service State ───────────────────────────────────────────────────

/// Shared DDNS service state for Tauri commands.
pub type DdnsServiceState = Arc<tokio::sync::Mutex<crate::service::DdnsService>>;
