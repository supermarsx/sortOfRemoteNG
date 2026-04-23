//! # traceroute — Traceroute / tracepath wrapper
//!
//! Wraps `traceroute`, `tracepath`, and Windows `tracert` for
//! UDP/ICMP/TCP path tracing with ASN lookup support.

use crate::types::*;
use chrono::Utc;

/// Build traceroute command arguments.
pub fn build_traceroute_args(target: &str, opts: &TracerouteOptions) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(m) = opts.max_hops {
        args.push("-m".to_string());
        args.push(m.to_string());
    }
    if let Some(q) = opts.queries_per_hop {
        args.push("-q".to_string());
        args.push(q.to_string());
    }
    match opts.protocol {
        Some(TracerouteProtocol::Icmp) => {
            args.push("-I".to_string());
        }
        Some(TracerouteProtocol::Tcp) => {
            args.push("-T".to_string());
        }
        _ => {}
    }
    if let Some(IpVersion::V6) = opts.ip_version {
        args.push("-6".to_string());
    }
    if opts.resolve_hostnames {
        // default behavior, no flag needed
    } else {
        args.push("-n".to_string());
    }
    args.push(target.to_string());
    args
}

/// Parse traceroute output into `TracerouteResult`.
pub fn parse_traceroute_output(output: &str, target: &str) -> Option<TracerouteResult> {
    let mut lines = output.lines();

    // Parse header: "traceroute to <host> (<ip>), <max_hops> hops max, ..."
    let header = lines.next()?.trim();
    let resolved_ip = header.find('(').and_then(|start| {
        header
            .find(')')
            .map(|end| header[start + 1..end].to_string())
    });
    let max_hops = header
        .split_whitespace()
        .zip(header.split_whitespace().skip(1))
        .find(|(_, b)| *b == "hops")
        .and_then(|(a, _)| a.strip_suffix(',').unwrap_or(a).parse::<u8>().ok())
        .unwrap_or(30);

    let mut hops = Vec::new();

    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let mut parts = line.split_whitespace();
        let hop_num: u8 = match parts.next().and_then(|s| s.parse().ok()) {
            Some(n) => n,
            None => continue,
        };

        let mut probes = Vec::new();
        let remaining: Vec<&str> = parts.collect();
        let mut i = 0;
        let mut current_ip: Option<String> = None;
        let mut current_hostname: Option<String> = None;

        while i < remaining.len() {
            let token = remaining[i];
            if token == "*" {
                probes.push(TracerouteProbe {
                    ip: None,
                    hostname: None,
                    rtt_ms: None,
                    timeout: true,
                    icmp_type: None,
                });
                i += 1;
            } else if i + 1 < remaining.len()
                && remaining[i + 1].starts_with('(')
                && remaining[i + 1].ends_with(')')
            {
                // hostname (ip) — next tokens are rtt values
                current_hostname = Some(token.to_string());
                let ip_token = &remaining[i + 1];
                current_ip = Some(ip_token[1..ip_token.len() - 1].to_string());
                i += 2;
            } else if token.ends_with("ms") || (i + 1 < remaining.len() && remaining[i + 1] == "ms")
            {
                let rtt_str = if let Some(stripped) = token.strip_suffix("ms") {
                    stripped
                } else {
                    token
                };
                let rtt = rtt_str.parse::<f64>().ok();
                probes.push(TracerouteProbe {
                    ip: current_ip.clone(),
                    hostname: current_hostname.clone(),
                    rtt_ms: rtt,
                    timeout: false,
                    icmp_type: None,
                });
                if token.ends_with("ms") {
                    i += 1;
                } else {
                    i += 2; // skip "ms"
                }
            } else if let Ok(_rtt) = token.parse::<f64>() {
                // rtt value without "ms" following yet — peek ahead
                if i + 1 < remaining.len() && remaining[i + 1] == "ms" {
                    probes.push(TracerouteProbe {
                        ip: current_ip.clone(),
                        hostname: current_hostname.clone(),
                        rtt_ms: Some(_rtt),
                        timeout: false,
                        icmp_type: None,
                    });
                    i += 2;
                } else {
                    i += 1;
                }
            } else {
                i += 1;
            }
        }

        hops.push(TracerouteHop {
            hop_num,
            probes,
            asn: None,
            as_name: None,
        });
    }

    let completed = hops
        .last()
        .map(|h| {
            h.probes
                .iter()
                .any(|p| p.ip.as_deref() == resolved_ip.as_deref() && !p.timeout)
        })
        .unwrap_or(false);

    Some(TracerouteResult {
        host: target.to_string(),
        resolved_ip,
        hops,
        completed,
        protocol: TracerouteProtocol::Udp,
        max_hops,
        started_at: Utc::now(),
        duration_ms: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_args() {
        let opts = TracerouteOptions {
            max_hops: Some(30),
            queries_per_hop: Some(3),
            timeout_ms: None,
            protocol: None,
            port: None,
            source_addr: None,
            ip_version: None,
            resolve_hostnames: true,
            asn_lookup: false,
        };
        let args = build_traceroute_args("example.com", &opts);
        assert!(args.contains(&"-m".to_string()));
        assert!(args.contains(&"example.com".to_string()));
    }

    #[test]
    fn tcp_traceroute() {
        let opts = TracerouteOptions {
            max_hops: None,
            queries_per_hop: None,
            timeout_ms: None,
            protocol: Some(TracerouteProtocol::Tcp),
            port: None,
            source_addr: None,
            ip_version: None,
            resolve_hostnames: false,
            asn_lookup: false,
        };
        let args = build_traceroute_args("10.0.0.1", &opts);
        assert!(args.contains(&"-T".to_string()));
        assert!(args.contains(&"-n".to_string()));
    }
}
