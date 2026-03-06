//! # ping — ICMP echo wrapper
//!
//! Wraps the system `ping` / `ping6` command for ICMP echo requests.
//! Supports IPv4/IPv6, count, interval, payload size, TTL, and
//! adaptive/flood modes.

use crate::types::*;

/// Build ping command arguments.
pub fn build_ping_args(target: &str, opts: &PingOptions) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(c) = opts.count {
        args.push("-c".to_string());
        args.push(c.to_string());
    }
    if let Some(interval) = opts.interval_ms {
        // Convert ms to seconds (fractional) for ping -i
        let secs = interval as f64 / 1000.0;
        args.push("-i".to_string());
        args.push(format!("{:.3}", secs));
    }
    if let Some(size) = opts.payload_size {
        args.push("-s".to_string());
        args.push(size.to_string());
    }
    if let Some(ttl) = opts.ttl {
        args.push("-t".to_string());
        args.push(ttl.to_string());
    }
    if let Some(ref iface) = opts.interface {
        args.push("-I".to_string());
        args.push(iface.clone());
    }
    if opts.dont_fragment {
        args.push("-M".to_string());
        args.push("do".to_string());
    }
    if let Some(IpVersion::V6) = opts.ip_version {
        args.push("-6".to_string());
    }
    args.push(target.to_string());
    args
}

/// Parse a ping summary line into a `PingResult`.
pub fn parse_ping_output(_output: &str, _target: &str) -> Option<PingResult> {
    // TODO: implement parsing of ping statistics summary
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_ping_args() {
        let opts = PingOptions {
            count: Some(4),
            interval_ms: None,
            timeout_ms: None,
            payload_size: None,
            ttl: None,
            interface: None,
            ip_version: None,
            flood: false,
            adaptive: false,
            dont_fragment: false,
        };
        let args = build_ping_args("8.8.8.8", &opts);
        assert!(args.contains(&"-c".to_string()));
        assert!(args.contains(&"4".to_string()));
        assert!(args.contains(&"8.8.8.8".to_string()));
    }

    #[test]
    fn ipv6_flag() {
        let opts = PingOptions {
            count: Some(1),
            interval_ms: None,
            timeout_ms: None,
            payload_size: None,
            ttl: None,
            interface: None,
            ip_version: Some(IpVersion::V6),
            flood: false,
            adaptive: false,
            dont_fragment: false,
        };
        let args = build_ping_args("::1", &opts);
        assert!(args.contains(&"-6".to_string()));
    }
}
