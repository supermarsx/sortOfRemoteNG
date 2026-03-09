//! # ZeroTier DNS
//!
//! DNS configuration for ZeroTier networks including push DNS,
//! search domains, and integration with controller API.

use serde::{Deserialize, Serialize};

/// DNS configuration for a ZeroTier network.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ZtDnsConfiguration {
    pub enabled: bool,
    pub domain: String,
    pub servers: Vec<String>,
    pub search_domains: Vec<String>,
}

/// Build DNS config for the controller API.
pub fn build_dns_payload(config: &ZtDnsConfiguration) -> serde_json::Value {
    if !config.enabled {
        return serde_json::json!({
            "dns": serde_json::Value::Null,
        });
    }

    serde_json::json!({
        "dns": {
            "domain": config.domain,
            "servers": config.servers,
        }
    })
}

/// Validate DNS configuration.
pub fn validate_dns_config(config: &ZtDnsConfiguration) -> Vec<String> {
    let mut issues = Vec::new();

    if config.enabled {
        if config.domain.is_empty() {
            issues.push("DNS domain cannot be empty when DNS is enabled".to_string());
        }
        if config.servers.is_empty() {
            issues.push("At least one DNS server is required".to_string());
        }
        for server in &config.servers {
            if server.parse::<std::net::IpAddr>().is_err() {
                issues.push(format!("Invalid DNS server address: {}", server));
            }
        }
        for domain in &config.search_domains {
            if domain.is_empty() || domain.starts_with('.') {
                issues.push(format!("Invalid search domain: {}", domain));
            }
        }
    }

    issues
}

/// Generate a ZeroTier DNS name for a member.
pub fn member_dns_name(hostname: &str, domain: &str) -> String {
    let clean = hostname
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect::<String>();
    format!("{}.{}", clean, domain)
}

/// Suggest DNS configuration based on network.
pub fn suggest_dns_config(network_name: &str, server_ips: &[String]) -> ZtDnsConfiguration {
    let domain = format!(
        "{}.zt",
        network_name
            .to_lowercase()
            .replace(' ', "-")
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-')
            .collect::<String>()
    );

    ZtDnsConfiguration {
        enabled: true,
        domain,
        servers: server_ips.to_vec(),
        search_domains: Vec::new(),
    }
}
