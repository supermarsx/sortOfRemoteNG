//! # WireGuard DNS Leak Prevention
//!
//! Configure DNS servers to prevent leaks, verify DNS resolution
//! goes through the tunnel, platform-specific DNS override.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// DNS configuration strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DnsStrategy {
    /// Use DNS servers from the WireGuard config.
    ConfigDns,
    /// Override with specific DNS servers.
    Custom,
    /// Use system DNS (no override — potential leak).
    SystemDns,
    /// Block all DNS except through tunnel.
    StrictTunnel,
}

/// DNS leak prevention configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsLeakPreventionConfig {
    pub strategy: DnsStrategy,
    pub custom_servers: Vec<String>,
    pub block_plain_dns: bool,
    pub use_dns_over_https: bool,
    pub doh_server: Option<String>,
}

impl Default for DnsLeakPreventionConfig {
    fn default() -> Self {
        Self {
            strategy: DnsStrategy::ConfigDns,
            custom_servers: Vec::new(),
            block_plain_dns: true,
            use_dns_over_https: false,
            doh_server: None,
        }
    }
}

/// Build PostUp/PostDown scripts for DNS leak prevention.
pub fn dns_leak_prevention_scripts(
    dns_servers: &[String],
    interface: &str,
) -> DnsScripts {
    if cfg!(target_os = "linux") {
        linux_dns_scripts(dns_servers, interface)
    } else if cfg!(target_os = "macos") {
        macos_dns_scripts(dns_servers, interface)
    } else {
        windows_dns_scripts(dns_servers, interface)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsScripts {
    pub post_up: String,
    pub pre_down: String,
    pub description: String,
}

fn linux_dns_scripts(dns_servers: &[String], interface: &str) -> DnsScripts {
    let servers = dns_servers
        .iter()
        .map(|s| format!("DNS={}", s))
        .collect::<Vec<_>>()
        .join(" ");

    DnsScripts {
        post_up: format!(
            "resolvectl dns {} {} && resolvectl domain {} ~.",
            interface, servers, interface
        ),
        pre_down: format!("resolvectl revert {}", interface),
        description: "Uses systemd-resolved for DNS routing".to_string(),
    }
}

fn macos_dns_scripts(dns_servers: &[String], _interface: &str) -> DnsScripts {
    let servers = dns_servers.join(" ");
    DnsScripts {
        post_up: format!(
            "networksetup -setdnsservers Wi-Fi {} && dscacheutil -flushcache",
            servers
        ),
        pre_down: "networksetup -setdnsservers Wi-Fi Empty && dscacheutil -flushcache"
            .to_string(),
        description: "Sets DNS via networksetup — may need adaptation for ethernet".to_string(),
    }
}

fn windows_dns_scripts(dns_servers: &[String], interface: &str) -> DnsScripts {
    let set_dns: Vec<String> = dns_servers
        .iter()
        .enumerate()
        .map(|(i, s)| {
            if i == 0 {
                format!(
                    "netsh interface ipv4 set dnsservers name=\"{}\" static {} primary",
                    interface, s
                )
            } else {
                format!(
                    "netsh interface ipv4 add dnsservers name=\"{}\" addr={} index={}",
                    interface,
                    s,
                    i + 1
                )
            }
        })
        .collect();

    DnsScripts {
        post_up: set_dns.join(" && "),
        pre_down: format!(
            "netsh interface ipv4 set dnsservers name=\"{}\" dhcp",
            interface
        ),
        description: "Sets DNS via netsh on Windows".to_string(),
    }
}

/// Validate DNS configuration.
pub fn validate_dns_config(dns_servers: &[String]) -> Vec<String> {
    let mut issues = Vec::new();

    if dns_servers.is_empty() {
        issues.push("No DNS servers configured — DNS may leak through system resolver".to_string());
    }

    for server in dns_servers {
        if server.parse::<std::net::IpAddr>().is_err() {
            issues.push(format!("Invalid DNS server address: {}", server));
        }
    }

    // Check for well-known public DNS
    let public_dns = ["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4", "9.9.9.9"];
    let has_public = dns_servers.iter().any(|s| public_dns.contains(&s.as_str()));

    if !has_public && !dns_servers.is_empty() {
        issues.push("Using non-public DNS servers — ensure they are reachable through the tunnel".to_string());
    }

    issues
}

/// Check if the DNS config in the WireGuard config looks safe.
pub fn audit_dns_safety(config: &WgConfig) -> DnsAuditResult {
    let has_dns = !config.interface.dns.is_empty();
    let is_full_tunnel = super::config::is_full_tunnel(config);

    let risk_level = match (has_dns, is_full_tunnel) {
        (true, true) => DnsRiskLevel::Low,
        (true, false) => DnsRiskLevel::Medium,
        (false, true) => DnsRiskLevel::High,
        (false, false) => DnsRiskLevel::Medium,
    };

    let mut recommendations = Vec::new();

    if !has_dns {
        recommendations.push("Add DNS servers to the [Interface] section to prevent DNS leaks".to_string());
    }

    if is_full_tunnel && !has_dns {
        recommendations.push(
            "Full tunnel without DNS override — all DNS queries may leak to the default resolver"
                .to_string(),
        );
    }

    if has_dns && !is_full_tunnel {
        recommendations.push(
            "Consider adding PostUp/PostDown scripts for DNS leak prevention with split tunnel"
                .to_string(),
        );
    }

    DnsAuditResult {
        has_dns_configured: has_dns,
        is_full_tunnel,
        risk_level,
        recommendations,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsAuditResult {
    pub has_dns_configured: bool,
    pub is_full_tunnel: bool,
    pub risk_level: DnsRiskLevel,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DnsRiskLevel {
    Low,
    Medium,
    High,
}
