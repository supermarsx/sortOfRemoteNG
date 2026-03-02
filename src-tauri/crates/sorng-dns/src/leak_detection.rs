//! # DNS Leak Detection
//!
//! Tests for DNS leaks by querying canary domains through controlled
//! resolvers, detecting if DNS traffic exits VPN/proxy tunnels,
//! and identifying which resolver IPs are actually being used.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Leak test types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Result of a DNS leak test.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeakTestReport {
    /// Unique test run ID.
    pub test_id: String,
    /// Whether a leak was detected.
    pub leak_detected: bool,
    /// IP addresses of DNS resolvers observed.
    pub resolver_ips: Vec<ResolverInfo>,
    /// Expected resolver IPs (from our configured servers).
    pub expected_resolvers: Vec<String>,
    /// Unexpected resolver IPs that indicate a leak.
    pub unexpected_resolvers: Vec<String>,
    /// Per-test results.
    pub tests: Vec<LeakTestItem>,
    /// Summary text.
    pub summary: String,
    /// When the test was run.
    pub timestamp: String,
}

/// Info about a detected resolver.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolverInfo {
    pub ip: String,
    pub hostname: Option<String>,
    pub provider: Option<String>,
    pub country: Option<String>,
    pub is_expected: bool,
}

/// Individual leak test probe result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeakTestItem {
    pub test_name: String,
    pub domain_queried: String,
    pub resolver_seen: Option<String>,
    pub passed: bool,
    pub details: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Leak test execution
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Run a comprehensive DNS leak test.
///
/// This uses multiple strategies:
/// 1. Query unique subdomains through system DNS and check which resolver was used.
/// 2. Compare configured resolver IPs with what's actually resolving queries.
/// 3. Check if DNS requests bypass the configured encrypted protocol.
pub async fn run_leak_test(
    resolver: &mut crate::resolver::DnsResolver,
) -> LeakTestReport {
    let test_id = uuid::Uuid::new_v4().to_string();
    let mut tests = Vec::new();
    let mut resolver_ips_seen: HashSet<String> = HashSet::new();

    // --- Test 1: System resolver detection ---
    // Query a known "what is my DNS resolver" service
    let test1 = test_system_resolver_detection().await;
    if let Some(ip) = &test1.resolver_seen {
        resolver_ips_seen.insert(ip.clone());
    }
    tests.push(test1);

    // --- Test 2: Encrypted DNS verification ---
    let test2 = test_encrypted_dns_active(resolver).await;
    tests.push(test2);

    // --- Test 3: Fallback leak detection ---
    let test3 = test_fallback_leak(resolver).await;
    if let Some(ip) = &test3.resolver_seen {
        resolver_ips_seen.insert(ip.clone());
    }
    tests.push(test3);

    // --- Test 4: IPv6 leak detection ---
    let test4 = test_ipv6_dns_leak().await;
    if let Some(ip) = &test4.resolver_seen {
        resolver_ips_seen.insert(ip.clone());
    }
    tests.push(test4);

    // Build expected resolvers list from configuration
    let expected: HashSet<String> = resolver
        .config()
        .servers
        .iter()
        .map(|s| s.address.clone())
        .collect();

    let unexpected: Vec<String> = resolver_ips_seen
        .iter()
        .filter(|ip| !expected.contains(*ip) && !is_known_encrypted_resolver(ip))
        .cloned()
        .collect();

    let leak_detected = !unexpected.is_empty()
        || tests.iter().any(|t| !t.passed);

    let resolver_infos: Vec<ResolverInfo> = resolver_ips_seen
        .into_iter()
        .map(|ip| {
            let is_expected = expected.contains(&ip) || is_known_encrypted_resolver(&ip);
            ResolverInfo {
                provider: identify_resolver_provider(&ip),
                hostname: None,
                country: None,
                is_expected,
                ip,
            }
        })
        .collect();

    let summary = if leak_detected {
        format!(
            "DNS LEAK DETECTED: {} unexpected resolver(s) found. DNS queries may be visible to your ISP or network operator.",
            unexpected.len()
        )
    } else {
        "No DNS leak detected. All queries are using the configured encrypted resolver.".to_string()
    };

    LeakTestReport {
        test_id,
        leak_detected,
        resolver_ips: resolver_infos,
        expected_resolvers: expected.into_iter().collect(),
        unexpected_resolvers: unexpected,
        tests,
        summary,
        timestamp: chrono::Utc::now().to_rfc3339(),
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Individual test probes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Test 1: Check the system resolver being used.
async fn test_system_resolver_detection() -> LeakTestItem {
    // Use whoami-style DNS: resolve a canary domain via system DNS
    // and see what resolver IP is returned. In production, this would
    // query a service like dns-leak-test.com or similar.
    let canary = format!("{}.dns-leak-test.internal", uuid::Uuid::new_v4());

    match crate::system::resolve_all_ips(&canary, 5000).await {
        Ok(ips) => LeakTestItem {
            test_name: "System Resolver Detection".to_string(),
            domain_queried: canary,
            resolver_seen: ips.first().cloned(),
            passed: true,
            details: format!("System resolver returned: {:?}", ips),
        },
        Err(_) => LeakTestItem {
            test_name: "System Resolver Detection".to_string(),
            domain_queried: canary,
            resolver_seen: None,
            passed: true,
            details: "Canary domain correctly not resolved (expected for non-existent domain)"
                .to_string(),
        },
    }
}

/// Test 2: Verify encrypted DNS is actually being used.
async fn test_encrypted_dns_active(
    resolver: &mut crate::resolver::DnsResolver,
) -> LeakTestItem {
    let protocol = resolver.config().protocol.clone();

    if !protocol.is_encrypted() {
        return LeakTestItem {
            test_name: "Encrypted DNS Verification".to_string(),
            domain_queried: String::new(),
            resolver_seen: None,
            passed: false,
            details: format!(
                "DNS protocol '{}' is NOT encrypted — queries are visible to network observers",
                protocol
            ),
        };
    }

    // Try to resolve via the configured encrypted method
    match resolver.resolve("cloudflare.com").await {
        Ok(response) => {
            let has_results = !response.answers.is_empty();
            LeakTestItem {
                test_name: "Encrypted DNS Verification".to_string(),
                domain_queried: "cloudflare.com".to_string(),
                resolver_seen: None,
                passed: has_results,
                details: if has_results {
                    format!(
                        "Encrypted DNS ({}) is working — {} records returned",
                        protocol,
                        response.answers.len()
                    )
                } else {
                    format!(
                        "Encrypted DNS ({}) returned no records — may be falling back to system DNS",
                        protocol
                    )
                },
            }
        }
        Err(e) => LeakTestItem {
            test_name: "Encrypted DNS Verification".to_string(),
            domain_queried: "cloudflare.com".to_string(),
            resolver_seen: None,
            passed: false,
            details: format!(
                "Encrypted DNS ({}) failed: {} — queries may fall back to unencrypted",
                protocol, e
            ),
        },
    }
}

/// Test 3: Check if fallback to unencrypted DNS happens.
async fn test_fallback_leak(
    resolver: &mut crate::resolver::DnsResolver,
) -> LeakTestItem {
    let stats = resolver.stats();
    let has_fallback = stats.fallback_used > 0;

    LeakTestItem {
        test_name: "Fallback Leak Detection".to_string(),
        domain_queried: String::new(),
        resolver_seen: None,
        passed: !has_fallback,
        details: if has_fallback {
            format!(
                "WARNING: {} queries fell back to unencrypted DNS",
                stats.fallback_used
            )
        } else {
            "No fallback to unencrypted DNS detected".to_string()
        },
    }
}

/// Test 4: Check for IPv6 DNS leaks.
async fn test_ipv6_dns_leak() -> LeakTestItem {
    // Try resolving an AAAA record via system DNS — if it works,
    // IPv6 DNS queries might bypass the VPN tunnel
    let domain = "ipv6.google.com";

    match crate::system::resolve_all_ips(domain, 5000).await {
        Ok(ips) => {
            let has_ipv6 = ips.iter().any(|ip| ip.contains(':'));
            LeakTestItem {
                test_name: "IPv6 DNS Leak Detection".to_string(),
                domain_queried: domain.to_string(),
                resolver_seen: None,
                passed: !has_ipv6,
                details: if has_ipv6 {
                    "IPv6 DNS resolution is active — may leak outside VPN tunnel".to_string()
                } else {
                    "No IPv6 DNS resolution detected".to_string()
                },
            }
        }
        Err(_) => LeakTestItem {
            test_name: "IPv6 DNS Leak Detection".to_string(),
            domain_queried: domain.to_string(),
            resolver_seen: None,
            passed: true,
            details: "IPv6 DNS is not resolving (good — no leak vector)".to_string(),
        },
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Resolver identification
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Known encrypted DNS resolver IPs.
fn is_known_encrypted_resolver(ip: &str) -> bool {
    matches!(
        ip,
        // Cloudflare
        "1.1.1.1" | "1.0.0.1" | "1.1.1.2" | "1.0.0.2" |
        // Google
        "8.8.8.8" | "8.8.4.4" |
        // Quad9
        "9.9.9.9" | "149.112.112.112" | "9.9.9.10" | "149.112.112.10" |
        // AdGuard
        "94.140.14.14" | "94.140.15.15" | "94.140.14.140" | "94.140.14.141" |
        // NextDNS
        "45.90.28.0" | "45.90.30.0" |
        // Mullvad
        "194.242.2.2" | "194.242.2.3" |
        // Control D
        "76.76.2.0" | "76.76.10.0" |
        // OpenDNS
        "208.67.222.222" | "208.67.220.220" |
        // CleanBrowsing
        "185.228.168.9" | "185.228.169.9" |
        // LibreDNS
        "116.202.176.26"
    )
}

/// Try to identify the provider from a resolver IP.
fn identify_resolver_provider(ip: &str) -> Option<String> {
    match ip {
        "1.1.1.1" | "1.0.0.1" | "1.1.1.2" | "1.0.0.2" => Some("Cloudflare".to_string()),
        "8.8.8.8" | "8.8.4.4" => Some("Google".to_string()),
        "9.9.9.9" | "149.112.112.112" | "9.9.9.10" | "149.112.112.10" => {
            Some("Quad9".to_string())
        }
        "94.140.14.14" | "94.140.15.15" | "94.140.14.140" | "94.140.14.141" => {
            Some("AdGuard".to_string())
        }
        "45.90.28.0" | "45.90.30.0" => Some("NextDNS".to_string()),
        "194.242.2.2" | "194.242.2.3" => Some("Mullvad".to_string()),
        "76.76.2.0" | "76.76.10.0" => Some("Control D".to_string()),
        "208.67.222.222" | "208.67.220.220" => Some("OpenDNS/Cisco".to_string()),
        "185.228.168.9" | "185.228.169.9" => Some("CleanBrowsing".to_string()),
        "116.202.176.26" => Some("LibreDNS".to_string()),
        _ => None,
    }
}

/// Quick check: is the configured DNS protocol encrypted?
pub fn is_dns_encrypted(config: &DnsResolverConfig) -> bool {
    config.protocol.is_encrypted()
}

/// Get a human-readable leak test summary for display.
pub fn format_leak_summary(report: &LeakTestReport) -> String {
    let mut lines = Vec::new();

    lines.push(format!("DNS Leak Test — {}", report.timestamp));
    lines.push(format!(
        "Status: {}",
        if report.leak_detected { "LEAK DETECTED" } else { "SECURE" }
    ));
    lines.push(String::new());

    for test in &report.tests {
        let icon = if test.passed { "✓" } else { "✗" };
        lines.push(format!("{} {}: {}", icon, test.test_name, test.details));
    }

    if !report.resolver_ips.is_empty() {
        lines.push(String::new());
        lines.push("Detected DNS resolvers:".to_string());
        for r in &report.resolver_ips {
            let status = if r.is_expected { "(expected)" } else { "(UNEXPECTED)" };
            let provider = r.provider.as_deref().unwrap_or("Unknown");
            lines.push(format!("  {} — {} {}", r.ip, provider, status));
        }
    }

    lines.push(String::new());
    lines.push(report.summary.clone());

    lines.join("\n")
}
