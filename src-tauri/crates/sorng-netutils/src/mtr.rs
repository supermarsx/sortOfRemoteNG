//! # mtr — MTR (My Traceroute) wrapper
//!
//! Wraps `mtr` for continuous combined traceroute + ping with
//! loss, jitter, and latency statistics per hop.

use crate::types::*;

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
pub fn parse_mtr_json(_json: &str) -> Option<MtrResult> {
    // TODO: implement
    None
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
