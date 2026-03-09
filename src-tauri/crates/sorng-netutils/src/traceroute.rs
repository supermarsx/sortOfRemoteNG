//! # traceroute — Traceroute / tracepath wrapper
//!
//! Wraps `traceroute`, `tracepath`, and Windows `tracert` for
//! UDP/ICMP/TCP path tracing with ASN lookup support.

use crate::types::*;

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
pub fn parse_traceroute_output(_output: &str, _target: &str) -> Option<TracerouteResult> {
    // TODO: implement
    None
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
