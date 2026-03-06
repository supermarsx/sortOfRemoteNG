//! # dig — DNS query tool wrapper
//!
//! Wraps `dig` for DNS record queries (A, AAAA, MX, TXT, SRV, PTR,
//! CNAME, NS, SOA, CAA, DNSKEY, DS, TLSA, NAPTR).

use crate::types::*;

/// Build `dig` command arguments.
pub fn build_dig_args(domain: &str, opts: &DigOptions) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(ref server) = opts.server {
        args.push(format!("@{}", server));
    }
    args.push(domain.to_string());
    if let Some(ref rt) = opts.record_type {
        args.push(rt.clone());
    }
    if opts.short {
        args.push("+short".to_string());
    }
    if opts.trace {
        args.push("+trace".to_string());
    }
    if opts.dnssec {
        args.push("+dnssec".to_string());
    }
    if opts.tcp {
        args.push("+tcp".to_string());
    }
    args
}

/// Parse `dig` output into `DigResult`.
pub fn parse_dig_output(_output: &str) -> Option<DigResult> {
    // TODO: implement
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_dig() {
        let opts = DigOptions {
            record_type: Some("A".to_string()),
            server: Some("8.8.8.8".to_string()),
            port: None,
            short: false,
            trace: false,
            tcp: false,
            dnssec: false,
            timeout_ms: None,
            retries: None,
        };
        let args = build_dig_args("example.com", &opts);
        assert!(args.contains(&"@8.8.8.8".to_string()));
        assert!(args.contains(&"example.com".to_string()));
        assert!(args.contains(&"A".to_string()));
    }

    #[test]
    fn dig_with_trace() {
        let opts = DigOptions {
            record_type: Some("NS".to_string()),
            server: None,
            port: None,
            short: false,
            trace: true,
            tcp: false,
            dnssec: true,
            timeout_ms: None,
            retries: None,
        };
        let args = build_dig_args("example.com", &opts);
        assert!(args.contains(&"+trace".to_string()));
        assert!(args.contains(&"+dnssec".to_string()));
    }
}
