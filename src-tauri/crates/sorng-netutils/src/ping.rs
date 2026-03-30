//! # ping — ICMP echo wrapper
//!
//! Wraps the system `ping` / `ping6` command for ICMP echo requests.
//! Supports IPv4/IPv6, count, interval, payload size, TTL, and
//! adaptive/flood modes.

use crate::types::*;
use chrono::Utc;

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
pub fn parse_ping_output(output: &str, target: &str) -> Option<PingResult> {
    let started_at = Utc::now();
    let mut replies = Vec::new();
    let mut resolved_ip: Option<String> = None;
    let mut payload_size: u32 = 56;
    let mut ip_version = IpVersion::V4;

    for line in output.lines() {
        let trimmed = line.trim();

        // Parse the header: "PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data."
        if trimmed.starts_with("PING ") {
            if let Some(paren_start) = trimmed.find('(') {
                if let Some(paren_end) = trimmed.find(')') {
                    if paren_end > paren_start {
                        let ip = &trimmed[paren_start + 1..paren_end];
                        resolved_ip = Some(ip.to_string());
                        if ip.contains(':') {
                            ip_version = IpVersion::V6;
                        }
                    }
                }
            }
            // Parse payload size: "56(84) bytes"
            if let Some(bytes_pos) = trimmed.find("bytes of data") {
                let before = &trimmed[..bytes_pos].trim();
                // Find the last space-separated token before "bytes of data"
                if let Some(size_tok) = before.rsplit_once(' ') {
                    let size_str = size_tok.1;
                    // May be "56(84)", take before '('
                    let num_part = if let Some(p) = size_str.find('(') {
                        &size_str[..p]
                    } else {
                        size_str
                    };
                    if let Ok(s) = num_part.parse::<u32>() {
                        payload_size = s;
                    }
                }
            }
        }

        // Parse reply lines: "64 bytes from 8.8.8.8: icmp_seq=1 ttl=117 time=12.3 ms"
        if trimmed.contains("icmp_seq=") && trimmed.contains("time=") {
            let mut seq: u32 = 0;
            let mut ttl: u8 = 0;
            let mut time_ms: f64 = 0.0;
            let mut size: u32 = 0;
            let mut from = String::new();
            let dup = trimmed.contains("(DUP!)");

            // Parse size: "64 bytes from"
            if let Some(bytes_idx) = trimmed.find(" bytes from ") {
                if let Ok(s) = trimmed[..bytes_idx].trim().parse::<u32>() {
                    size = s;
                }
                let after_from = &trimmed[bytes_idx + " bytes from ".len()..];
                // from ends at ':' or ' '
                if let Some(colon) = after_from.find(':') {
                    from = after_from[..colon].to_string();
                }
            }

            for part in trimmed.split_whitespace() {
                if let Some(val) = part.strip_prefix("icmp_seq=") {
                    seq = val.parse().unwrap_or(0);
                } else if let Some(val) = part.strip_prefix("ttl=") {
                    ttl = val.parse().unwrap_or(0);
                } else if let Some(val) = part.strip_prefix("time=") {
                    time_ms = val.parse().unwrap_or(0.0);
                }
            }

            replies.push(PingReply {
                seq,
                ttl,
                time_ms,
                size,
                from,
                dup,
            });
        }
    }

    // Parse statistics
    let mut packets_sent: u32 = 0;
    let mut packets_received: u32 = 0;
    let mut packet_loss_pct: f64 = 0.0;
    let mut duration_ms: u64 = 0;
    let mut min_ms: f64 = 0.0;
    let mut avg_ms: f64 = 0.0;
    let mut max_ms: f64 = 0.0;
    let mut stddev_ms: f64 = 0.0;

    for line in output.lines() {
        let trimmed = line.trim();

        // "2 packets transmitted, 2 received, 0% packet loss, time 1001ms"
        if trimmed.contains("packets transmitted") {
            let parts: Vec<&str> = trimmed.split(',').collect();
            for part in &parts {
                let part = part.trim();
                if part.ends_with("packets transmitted") || part.ends_with("transmitted") {
                    if let Some(num_str) = part.split_whitespace().next() {
                        packets_sent = num_str.parse().unwrap_or(0);
                    }
                } else if part.contains("received") {
                    if let Some(num_str) = part.split_whitespace().next() {
                        packets_received = num_str.parse().unwrap_or(0);
                    }
                } else if part.contains("packet loss") {
                    if let Some(pct_str) = part.split('%').next() {
                        packet_loss_pct = pct_str.trim().parse().unwrap_or(0.0);
                    }
                } else if part.contains("time") {
                    // "time 1001ms"
                    let t = part
                        .replace("time", "")
                        .replace("ms", "")
                        .trim()
                        .to_string();
                    duration_ms = t.parse().unwrap_or(0);
                }
            }
        }

        // "rtt min/avg/max/mdev = 11.800/12.050/12.300/0.250 ms"
        if trimmed.starts_with("rtt ") || trimmed.starts_with("round-trip ") {
            if let Some(eq_pos) = trimmed.find('=') {
                let after_eq = trimmed[eq_pos + 1..].trim();
                // "11.800/12.050/12.300/0.250 ms"
                let nums_part = after_eq.split_whitespace().next().unwrap_or("");
                let vals: Vec<&str> = nums_part.split('/').collect();
                if vals.len() >= 4 {
                    min_ms = vals[0].trim().parse().unwrap_or(0.0);
                    avg_ms = vals[1].trim().parse().unwrap_or(0.0);
                    max_ms = vals[2].trim().parse().unwrap_or(0.0);
                    stddev_ms = vals[3].trim().parse().unwrap_or(0.0);
                }
            }
        }
    }

    let ttl = replies.first().map(|r| r.ttl);

    Some(PingResult {
        host: target.to_string(),
        resolved_ip,
        packets_sent,
        packets_received,
        packet_loss_pct,
        min_ms,
        avg_ms,
        max_ms,
        stddev_ms,
        replies,
        started_at,
        duration_ms,
        ttl,
        payload_size,
        ip_version,
    })
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
