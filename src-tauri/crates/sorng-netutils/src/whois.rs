//! # whois — WHOIS / RDAP lookup wrapper
//!
//! Wraps the `whois` CLI command for domain/IP ownership lookups.
//! Supports RDAP (Registration Data Access Protocol) as a JSON
//! alternative to classic WHOIS.

use crate::types::*;

/// Build `whois` command arguments.
pub fn build_whois_args(target: &str, server: Option<&str>) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(s) = server {
        args.push("-h".to_string());
        args.push(s.to_string());
    }
    args.push(target.to_string());
    args
}

/// Parse whois text output into `WhoisResult`.
pub fn parse_whois_output(_output: &str, _target: &str) -> Option<WhoisResult> {
    // TODO: implement
    None
}

/// Build RDAP URL for a domain lookup.
pub fn rdap_url_for_domain(domain: &str) -> String {
    format!("https://rdap.org/domain/{}", domain)
}

/// Build RDAP URL for an IP lookup.
pub fn rdap_url_for_ip(ip: &str) -> String {
    format!("https://rdap.org/ip/{}", ip)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_whois() {
        let args = build_whois_args("example.com", None);
        assert_eq!(args, vec!["example.com"]);
    }

    #[test]
    fn whois_with_server() {
        let args = build_whois_args("example.com", Some("whois.verisign-grs.com"));
        assert!(args.contains(&"-h".to_string()));
        assert!(args.contains(&"whois.verisign-grs.com".to_string()));
    }

    #[test]
    fn rdap_urls() {
        assert!(rdap_url_for_domain("example.com").contains("domain/example.com"));
        assert!(rdap_url_for_ip("8.8.8.8").contains("ip/8.8.8.8"));
    }
}
