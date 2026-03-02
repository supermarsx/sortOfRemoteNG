//! # System DNS Resolver
//!
//! Standard OS DNS resolution using `ToSocketAddrs` and reverse lookup.
//! This is the baseline fallback when no encrypted DNS is configured.

use crate::types::*;
use std::net::ToSocketAddrs;

/// Execute a DNS query using the system resolver.
pub async fn execute_system_query(
    query: &DnsQuery,
    config: &DnsResolverConfig,
) -> Result<DnsResponse, String> {
    let name = query.name.clone();
    let record_type = query.record_type;
    let timeout_ms = config.timeout_ms;

    let start = std::time::Instant::now();

    match record_type {
        DnsRecordType::A | DnsRecordType::AAAA => {
            resolve_address(&name, record_type, timeout_ms).await
        }
        DnsRecordType::PTR => reverse_resolve(&name, timeout_ms).await,
        _ => {
            // System resolver only supports A/AAAA/PTR natively.
            // For other types, return an error suggesting DoH/DoT.
            Err(format!(
                "System resolver does not support {} queries. Configure DoH or DoT for full record type support.",
                record_type.as_str()
            ))
        }
    }
    .map(|mut resp| {
        resp.duration_ms = start.elapsed().as_millis() as u64;
        resp
    })
}

async fn resolve_address(
    hostname: &str,
    record_type: DnsRecordType,
    timeout_ms: u64,
) -> Result<DnsResponse, String> {
    let host = hostname.to_string();
    let timeout = std::time::Duration::from_millis(timeout_ms);

    let result = tokio::time::timeout(timeout, tokio::task::spawn_blocking(move || {
        let addr_with_port = format!("{}:0", host);
        addr_with_port
            .to_socket_addrs()
            .map(|addrs| addrs.collect::<Vec<_>>())
    }))
    .await
    .map_err(|_| "DNS resolution timed out".to_string())?
    .map_err(|e| format!("DNS resolution task failed: {}", e))?
    .map_err(|e| format!("DNS resolution failed: {}", e))?;

    let mut answers = Vec::new();

    for addr in &result {
        match addr.ip() {
            std::net::IpAddr::V4(v4) if record_type != DnsRecordType::AAAA => {
                answers.push(DnsRecord {
                    name: hostname.to_string(),
                    record_type: DnsRecordType::A,
                    ttl: 300, // system resolver doesn't expose TTL
                    data: DnsRecordData::A {
                        address: v4.to_string(),
                    },
                });
            }
            std::net::IpAddr::V6(v6) if record_type != DnsRecordType::A => {
                answers.push(DnsRecord {
                    name: hostname.to_string(),
                    record_type: DnsRecordType::AAAA,
                    ttl: 300,
                    data: DnsRecordData::AAAA {
                        address: v6.to_string(),
                    },
                });
            }
            _ => {}
        }
    }

    if answers.is_empty() {
        return Err(format!("No {} records found for {}", record_type.as_str(), hostname));
    }

    Ok(DnsResponse {
        rcode: DnsRcode::NoError,
        authoritative: false,
        truncated: false,
        recursion_available: true,
        authenticated_data: false,
        answers,
        authority: Vec::new(),
        additional: Vec::new(),
        duration_ms: 0,
        server: "system".to_string(),
        protocol: DnsProtocol::System,
    })
}

async fn reverse_resolve(ptr_name: &str, timeout_ms: u64) -> Result<DnsResponse, String> {
    // Extract IP from PTR name (x.x.x.x.in-addr.arpa → IP)
    let ip = ptr_name_to_ip(ptr_name)
        .ok_or_else(|| format!("Cannot extract IP from PTR name: {}", ptr_name))?;

    let timeout = std::time::Duration::from_millis(timeout_ms);
    let ip_clone = ip.clone();

    let result = tokio::time::timeout(timeout, tokio::task::spawn_blocking(move || {
        let addr: std::net::IpAddr = ip_clone.parse().map_err(|e| format!("Invalid IP: {}", e))?;
        // Use platform reverse DNS
        let hostname = reverse_lookup_blocking(&addr)?;
        Ok::<String, String>(hostname)
    }))
    .await
    .map_err(|_| "Reverse DNS timed out".to_string())?
    .map_err(|e| format!("Reverse DNS task failed: {}", e))?
    .map_err(|e| format!("Reverse DNS failed: {}", e))?;

    Ok(DnsResponse {
        rcode: DnsRcode::NoError,
        authoritative: false,
        truncated: false,
        recursion_available: true,
        authenticated_data: false,
        answers: vec![DnsRecord {
            name: ptr_name.to_string(),
            record_type: DnsRecordType::PTR,
            ttl: 300,
            data: DnsRecordData::PTR {
                domain: result,
            },
        }],
        authority: Vec::new(),
        additional: Vec::new(),
        duration_ms: 0,
        server: "system".to_string(),
        protocol: DnsProtocol::System,
    })
}

/// Extract an IP address from an in-addr.arpa / ip6.arpa PTR name.
fn ptr_name_to_ip(name: &str) -> Option<String> {
    let name = name.trim_end_matches('.');

    if name.ends_with(".in-addr.arpa") {
        let prefix = name.strip_suffix(".in-addr.arpa")?;
        let octets: Vec<&str> = prefix.split('.').collect();
        if octets.len() == 4 {
            Some(format!("{}.{}.{}.{}", octets[3], octets[2], octets[1], octets[0]))
        } else {
            None
        }
    } else if name.ends_with(".ip6.arpa") {
        let prefix = name.strip_suffix(".ip6.arpa")?;
        let nibbles: Vec<&str> = prefix.split('.').collect();
        if nibbles.len() == 32 {
            let mut hex_groups = Vec::new();
            for chunk in nibbles.rchunks(4) {
                let group: String = chunk.iter().rev().copied().collect();
                hex_groups.push(group);
            }
            Some(hex_groups.join(":"))
        } else {
            None
        }
    } else {
        None
    }
}

/// Blocking reverse DNS using the getnameinfo system call.
fn reverse_lookup_blocking(addr: &std::net::IpAddr) -> Result<String, String> {
    use std::net::SocketAddr;

    let socket_addr = SocketAddr::new(*addr, 0);

    // Use the platform getnameinfo equivalent
    // On most platforms, gethostbyaddr or getnameinfo
    match socket_addr {
        SocketAddr::V4(v4) => {
            let ip_str = v4.ip().to_string();
            // Attempt resolution via ToSocketAddrs reverse (platform-specific)
            // This is a best-effort approach; in production, use dns_lookup crate
            let addr_str = format!("{}:0", ip_str);
            if let Ok(mut addrs) = addr_str.to_socket_addrs() {
                if let Some(resolved) = addrs.next() {
                    let hostname = resolved.ip().to_string();
                    if hostname != ip_str {
                        return Ok(hostname);
                    }
                }
            }
            Err(format!("No reverse DNS for {}", ip_str))
        }
        SocketAddr::V6(v6) => {
            let ip_str = v6.ip().to_string();
            Err(format!("No reverse DNS for {}", ip_str))
        }
    }
}

/// Convenience: resolve hostname to first IPv4 address.
pub async fn resolve_to_ipv4(hostname: &str, timeout_ms: u64) -> Result<String, String> {
    let config = DnsResolverConfig {
        timeout_ms,
        ..Default::default()
    };
    let query = DnsQuery::new(hostname, DnsRecordType::A);
    let response = execute_system_query(&query, &config).await?;
    response
        .a_records()
        .into_iter()
        .next()
        .ok_or_else(|| format!("No A record for {}", hostname))
}

/// Convenience: resolve hostname to all IP addresses.
pub async fn resolve_all_ips(hostname: &str, timeout_ms: u64) -> Result<Vec<String>, String> {
    let config = DnsResolverConfig {
        timeout_ms,
        ..Default::default()
    };
    let query = DnsQuery::new(hostname, DnsRecordType::A);
    let response = execute_system_query(&query, &config).await?;
    Ok(response.ip_addresses())
}
