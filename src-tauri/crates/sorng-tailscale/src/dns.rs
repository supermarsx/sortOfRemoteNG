//! # Tailscale MagicDNS Management
//!
//! Enable/disable MagicDNS, configure split DNS, search domains,
//! custom nameservers, DNS overrides.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// MagicDNS configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MagicDnsConfig {
    pub enabled: bool,
    pub dns_suffix: String,
    pub nameservers: Vec<String>,
    pub search_paths: Vec<String>,
    pub split_dns: HashMap<String, Vec<String>>,
    pub override_local_dns: bool,
    pub accept_routes_dns: bool,
}

impl Default for MagicDnsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            dns_suffix: String::new(),
            nameservers: vec!["100.100.100.100".to_string()],
            search_paths: Vec::new(),
            split_dns: HashMap::new(),
            override_local_dns: false,
            accept_routes_dns: true,
        }
    }
}

/// DNS resolution result for a query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsResolution {
    pub query: String,
    pub records: Vec<DnsRecord>,
    pub via_magic_dns: bool,
    pub response_time_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsRecord {
    pub record_type: DnsRecordType,
    pub name: String,
    pub value: String,
    pub ttl: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DnsRecordType {
    A,
    AAAA,
    CNAME,
    MX,
    TXT,
    SRV,
    PTR,
    NS,
}

/// Build command to set DNS nameservers.
pub fn set_nameservers_command(nameservers: &[String]) -> Vec<String> {
    let mut cmd = vec!["tailscale".to_string(), "set".to_string()];
    if nameservers.is_empty() {
        cmd.push("--accept-dns=false".to_string());
    } else {
        cmd.push("--accept-dns=true".to_string());
    }
    cmd
}

/// Build command to set search domains.
pub fn set_search_domains_args(domains: &[String]) -> Vec<(String, String)> {
    // Search domains are configured via admin console API, not CLI
    // This returns key-value pairs for API calls
    vec![("searchPaths".to_string(), domains.join(","))]
}

/// Build split DNS configuration for API.
pub fn build_split_dns_config(routes: &HashMap<String, Vec<String>>) -> SplitDnsPayload {
    SplitDnsPayload {
        routes: routes
            .iter()
            .map(|(domain, servers)| SplitDnsRoute {
                domain: domain.clone(),
                nameservers: servers.clone(),
            })
            .collect(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitDnsPayload {
    pub routes: Vec<SplitDnsRoute>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitDnsRoute {
    pub domain: String,
    pub nameservers: Vec<String>,
}

/// Resolve a hostname via tailscale.
pub fn resolve_command(hostname: &str) -> Vec<String> {
    // Use the system resolver which will use MagicDNS if configured
    if cfg!(target_os = "windows") {
        vec![
            "nslookup".to_string(),
            hostname.to_string(),
            "100.100.100.100".to_string(),
        ]
    } else {
        vec![
            "dig".to_string(),
            format!("@100.100.100.100"),
            hostname.to_string(),
            "+short".to_string(),
        ]
    }
}

/// Parse a hostname to check if it's a MagicDNS name.
pub fn is_magic_dns_name(hostname: &str, dns_suffix: &str) -> bool {
    if dns_suffix.is_empty() {
        return false;
    }
    hostname.ends_with(&format!(".{}", dns_suffix))
        || hostname.ends_with(".ts.net")
        || hostname.ends_with(".tailscale.net")
}

/// Generate MagicDNS name for a peer.
pub fn magic_dns_name(hostname: &str, dns_suffix: &str) -> String {
    let clean = hostname
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect::<String>();
    format!("{}.{}", clean, dns_suffix)
}

/// Validate a DNS configuration.
pub fn validate_dns_config(config: &MagicDnsConfig) -> Vec<String> {
    let mut issues = Vec::new();

    for ns in &config.nameservers {
        if ns.parse::<std::net::IpAddr>().is_err() && !ns.contains("://") {
            issues.push(format!("Invalid nameserver address: {}", ns));
        }
    }

    for domain in &config.search_paths {
        if domain.is_empty() || domain.starts_with('.') || domain.ends_with('.') {
            issues.push(format!("Invalid search domain: {}", domain));
        }
    }

    for (domain, servers) in &config.split_dns {
        if servers.is_empty() {
            issues.push(format!("Split DNS domain '{}' has no nameservers", domain));
        }
        for ns in servers {
            if ns.parse::<std::net::IpAddr>().is_err() {
                issues.push(format!(
                    "Invalid nameserver '{}' for split DNS domain '{}'",
                    ns, domain
                ));
            }
        }
    }

    issues
}
