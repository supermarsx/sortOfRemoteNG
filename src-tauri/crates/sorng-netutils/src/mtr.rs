//! # mtr — MTR (My Traceroute) wrapper
//!
//! Wraps `mtr` for continuous combined traceroute + ping with
//! loss, jitter, and latency statistics per hop.

use crate::types::*;
use chrono::Utc;

/// Build mtr command arguments.
pub fn build_mtr_args(target: &str, opts: &MtrOptions) -> Vec<String> {
    let mut args = vec!["--report".to_string(), "--json".to_string()];
    if let Some(c) = opts.cycles {
        args.push("-c".to_string());
        args.push(c.to_string());
    }
    if let Some(m) = opts.max_hops {
        args.push("-m".to_string());
        args.push(m.to_string());
    }
    match opts.protocol {
        Some(TracerouteProtocol::Tcp) => {
            args.push("--tcp".to_string());
        }
        Some(TracerouteProtocol::Udp) => {
            args.push("--udp".to_string());
        }
        _ => {}
    }
    if let Some(IpVersion::V6) = opts.ip_version {
        args.push("-6".to_string());
    }
    if !opts.resolve_hostnames {
        args.push("-n".to_string());
    }
    args.push(target.to_string());
    args
}

/// Parse `mtr --json --report` output into `MtrResult`.
pub fn parse_mtr_json(json: &str) -> Option<MtrResult> {
    let root: serde_json::Value = serde_json::from_str(json).ok()?;
    let report = root.get("report")?;

    let mtr_info = report.get("mtr")?;
    let dst = mtr_info.get("dst")?.as_str()?.to_string();
    let cycles = mtr_info
        .get("tests")
        .and_then(|v| {
            v.as_str()
                .and_then(|s| s.parse::<u32>().ok())
                .or_else(|| v.as_u64().map(|n| n as u32))
        })
        .unwrap_or(10);

    let hubs = report.get("hubs")?.as_array()?;
    let mut hops = Vec::with_capacity(hubs.len());

    for (i, hub) in hubs.iter().enumerate() {
        let host_str = hub.get("host").and_then(|v| v.as_str()).unwrap_or("???");
        let (hostname, ip) = if host_str == "???" {
            (None, None)
        } else {
            (Some(host_str.to_string()), Some(host_str.to_string()))
        };

        let parse_f64 = |key: &str| -> f64 {
            hub.get(key)
                .and_then(|v| {
                    v.as_f64()
                        .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
                })
                .unwrap_or(0.0)
        };
        let parse_u32 = |key: &str| -> u32 {
            hub.get(key)
                .and_then(|v| {
                    v.as_u64()
                        .map(|n| n as u32)
                        .or_else(|| v.as_str().and_then(|s| s.parse::<u32>().ok()))
                })
                .unwrap_or(0)
        };

        let loss_pct = parse_f64("Loss%");
        let sent = parse_u32("Snt");
        let recv = if loss_pct > 0.0 && sent > 0 {
            (sent as f64 * (1.0 - loss_pct / 100.0)).round() as u32
        } else {
            sent
        };

        hops.push(MtrHop {
            hop_num: (i + 1) as u8,
            ip,
            hostname,
            loss_pct,
            sent,
            recv,
            best_ms: parse_f64("Best"),
            avg_ms: parse_f64("Avg"),
            worst_ms: parse_f64("Wrst"),
            stddev_ms: parse_f64("StDev"),
            last_ms: parse_f64("Last"),
            jitter_ms: 0.0,
            asn: None,
        });
    }

    Some(MtrResult {
        host: dst,
        report: hops,
        cycles,
        started_at: Utc::now(),
        duration_ms: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_mtr() {
        let opts = MtrOptions {
            cycles: Some(10),
            max_hops: Some(30),
            interval_ms: None,
            protocol: None,
            port: None,
            ip_version: None,
            resolve_hostnames: true,
            asn_lookup: false,
        };
        let args = build_mtr_args("1.1.1.1", &opts);
        assert!(args.contains(&"--report".to_string()));
        assert!(args.contains(&"--json".to_string()));
        assert!(args.contains(&"-c".to_string()));
    }
}
