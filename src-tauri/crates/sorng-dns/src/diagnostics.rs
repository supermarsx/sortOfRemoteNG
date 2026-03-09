//! # DNS Diagnostics
//!
//! Diagnostic probes, latency benchmarks, server health checks,
//! and resolution comparison across protocols.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::time::Instant;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Benchmark
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Benchmark a DNS resolver by querying a set of well-known domains.
pub async fn benchmark_resolver(
    resolver: &mut crate::resolver::DnsResolver,
    iterations: usize,
) -> DnsBenchmarkReport {
    let domains = [
        "google.com",
        "cloudflare.com",
        "github.com",
        "microsoft.com",
        "amazon.com",
        "wikipedia.org",
        "mozilla.org",
        "rust-lang.org",
    ];

    let mut results = Vec::new();
    let protocol = resolver.config().protocol;

    for domain in &domains {
        let mut latencies = Vec::new();
        let mut failures = 0u32;

        for _ in 0..iterations {
            let start = Instant::now();
            match resolver.resolve(domain).await {
                Ok(_) => {
                    latencies.push(start.elapsed().as_secs_f64() * 1000.0);
                }
                Err(_) => {
                    failures += 1;
                }
            }
        }

        let total = latencies.len() as u32 + failures;
        let avg = if latencies.is_empty() {
            0.0
        } else {
            latencies.iter().sum::<f64>() / latencies.len() as f64
        };
        let min = latencies.iter().copied().fold(f64::MAX, f64::min);
        let max = latencies.iter().copied().fold(0.0f64, f64::max);
        let success_rate = if total == 0 {
            0.0
        } else {
            latencies.len() as f64 / total as f64
        };

        // Use the first server as the representative server for this result
        let server = resolver
            .config()
            .servers
            .first()
            .cloned()
            .unwrap_or_else(|| DnsServer::plain("system"));

        results.push(DnsBenchmarkResult {
            server,
            protocol,
            avg_latency_ms: avg,
            min_latency_ms: if min == f64::MAX { 0.0 } else { min },
            max_latency_ms: max,
            success_rate,
            queries_sent: total,
            queries_failed: failures,
            dnssec_supported: resolver.config().dnssec,
        });
    }

    let overall_avg = if results.is_empty() {
        0.0
    } else {
        results.iter().map(|r| r.avg_latency_ms).sum::<f64>() / results.len() as f64
    };

    let overall_failures: u32 = results.iter().map(|r| r.queries_failed).sum();

    DnsBenchmarkReport {
        results,
        overall_avg_ms: overall_avg,
        overall_failures,
        protocol,
        timestamp: chrono::Utc::now().to_rfc3339(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsBenchmarkReport {
    pub results: Vec<DnsBenchmarkResult>,
    pub overall_avg_ms: f64,
    pub overall_failures: u32,
    pub protocol: DnsProtocol,
    pub timestamp: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Server health check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Health check result for a DNS server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsHealthCheck {
    pub server: DnsServer,
    pub reachable: bool,
    pub latency_ms: Option<f64>,
    pub supports_edns0: bool,
    pub supports_dnssec: bool,
    pub error: Option<String>,
    pub checked_at: String,
}

/// Check health of a DNS server.
pub async fn check_server_health(
    server: &DnsServer,
    resolver: &mut crate::resolver::DnsResolver,
) -> DnsHealthCheck {
    let start = Instant::now();

    // Try resolving a well-known domain
    let result = resolver.resolve("cloudflare.com").await;

    match result {
        Ok(response) => {
            let latency = start.elapsed().as_secs_f64() * 1000.0;

            DnsHealthCheck {
                server: server.clone(),
                reachable: true,
                latency_ms: Some(latency),
                supports_edns0: true,
                supports_dnssec: response.authenticated_data,
                error: None,
                checked_at: chrono::Utc::now().to_rfc3339(),
            }
        }
        Err(e) => DnsHealthCheck {
            server: server.clone(),
            reachable: false,
            latency_ms: None,
            supports_edns0: false,
            supports_dnssec: false,
            error: Some(e),
            checked_at: chrono::Utc::now().to_rfc3339(),
        },
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Protocol comparison
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Compare DNS resolution across multiple protocols.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolComparison {
    pub domain: String,
    pub results: Vec<ProtocolResult>,
    pub fastest_protocol: String,
    pub all_consistent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolResult {
    pub protocol: String,
    pub latency_ms: f64,
    pub success: bool,
    pub addresses: Vec<String>,
    pub error: Option<String>,
}

/// Compare resolution of a single domain across system, DoH, and DoT.
pub async fn compare_protocols(domain: &str) -> ProtocolComparison {
    let mut results = Vec::new();

    // System DNS
    let start = Instant::now();
    match crate::system::resolve_all_ips(domain, 5000).await {
        Ok(ips) => {
            results.push(ProtocolResult {
                protocol: "System".to_string(),
                latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                success: true,
                addresses: ips,
                error: None,
            });
        }
        Err(e) => {
            results.push(ProtocolResult {
                protocol: "System".to_string(),
                latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                success: false,
                addresses: Vec::new(),
                error: Some(e),
            });
        }
    }

    // DoH (Cloudflare)
    let doh_server = DnsServer::doh("https://cloudflare-dns.com/dns-query");
    let doh_config = DnsResolverConfig {
        protocol: DnsProtocol::DoH,
        servers: vec![doh_server.clone()],
        ..Default::default()
    };
    let query = DnsQuery::new(domain, DnsRecordType::A);

    let start = Instant::now();
    match crate::doh::execute_doh_query(&query, &doh_server, &doh_config).await {
        Ok(response) => {
            results.push(ProtocolResult {
                protocol: "DoH (Cloudflare)".to_string(),
                latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                success: true,
                addresses: response.ip_addresses(),
                error: None,
            });
        }
        Err(e) => {
            results.push(ProtocolResult {
                protocol: "DoH (Cloudflare)".to_string(),
                latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                success: false,
                addresses: Vec::new(),
                error: Some(e),
            });
        }
    }

    // DoT (Cloudflare)
    let dot_server = DnsServer::dot("1.1.1.1", "cloudflare-dns.com");
    let dot_config = DnsResolverConfig {
        protocol: DnsProtocol::DoT,
        servers: vec![dot_server.clone()],
        ..Default::default()
    };
    let start = Instant::now();
    match crate::dot::execute_dot_query(&query, &dot_server, &dot_config).await {
        Ok(response) => {
            results.push(ProtocolResult {
                protocol: "DoT (Cloudflare)".to_string(),
                latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                success: true,
                addresses: response.ip_addresses(),
                error: None,
            });
        }
        Err(e) => {
            results.push(ProtocolResult {
                protocol: "DoT (Cloudflare)".to_string(),
                latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                success: false,
                addresses: Vec::new(),
                error: Some(e),
            });
        }
    }

    // Find fastest
    let fastest = results
        .iter()
        .filter(|r| r.success)
        .min_by(|a, b| {
            a.latency_ms
                .partial_cmp(&b.latency_ms)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|r| r.protocol.clone())
        .unwrap_or_else(|| "None".to_string());

    // Check consistency
    let successful_addrs: Vec<&Vec<String>> = results
        .iter()
        .filter(|r| r.success && !r.addresses.is_empty())
        .map(|r| &r.addresses)
        .collect();

    let all_consistent = if successful_addrs.len() <= 1 {
        true
    } else {
        let first = &successful_addrs[0];
        successful_addrs.iter().all(|addrs| {
            let mut a = (*addrs).clone();
            let mut b = first.to_vec();
            a.sort();
            b.sort();
            a == b
        })
    };

    ProtocolComparison {
        domain: domain.to_string(),
        results,
        fastest_protocol: fastest,
        all_consistent,
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Resolver diagnostics
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Full diagnostic report for the DNS subsystem.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsDiagnosticReport {
    pub resolver_config: DnsResolverConfig,
    pub cache_entries: usize,
    pub cache_hit_rate: f64,
    pub stats: crate::resolver::ResolverStats,
    pub server_health: Vec<DnsHealthCheck>,
    pub protocol_comparison: Option<ProtocolComparison>,
    pub generated_at: String,
}

/// Generate a full diagnostic report.
pub async fn generate_diagnostic_report(
    resolver: &mut crate::resolver::DnsResolver,
) -> DnsDiagnosticReport {
    let config = resolver.config().clone();
    let cache_entries = resolver.cache_len();
    let cache_hit_rate = resolver.cache_hit_rate();
    let stats = resolver.stats().clone();

    // Health-check configured servers
    let mut server_health = Vec::new();
    for server in &config.servers {
        let health = check_server_health(server, resolver).await;
        server_health.push(health);
    }

    // Protocol comparison
    let comparison = compare_protocols("cloudflare.com").await;

    DnsDiagnosticReport {
        resolver_config: config,
        cache_entries,
        cache_hit_rate,
        stats,
        server_health,
        protocol_comparison: Some(comparison),
        generated_at: chrono::Utc::now().to_rfc3339(),
    }
}
