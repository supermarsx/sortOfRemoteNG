//! # whois — WHOIS / RDAP lookup wrapper
//!
//! Wraps the `whois` CLI command for domain/IP ownership lookups.
//! Supports RDAP (Registration Data Access Protocol) as a JSON
//! alternative to classic WHOIS.

use crate::types::*;
use chrono::Utc;

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
pub fn parse_whois_output(output: &str, target: &str) -> Option<WhoisResult> {
    if output.trim().is_empty() {
        return None;
    }

    let mut registrar: Option<String> = None;
    let mut registrant: Option<String> = None;
    let mut creation_date: Option<String> = None;
    let mut expiration_date: Option<String> = None;
    let mut updated_date: Option<String> = None;
    let mut name_servers: Vec<String> = Vec::new();
    let mut status: Vec<String> = Vec::new();
    let mut dnssec: Option<String> = None;
    let mut abuse_contact: Option<String> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('%') || trimmed.starts_with('#') {
            continue;
        }

        // Split on first ':'
        let (key, value) = match trimmed.find(':') {
            Some(pos) => (
                trimmed[..pos].trim().to_lowercase(),
                trimmed[pos + 1..].trim().to_string(),
            ),
            None => continue,
        };

        if value.is_empty() {
            continue;
        }

        match key.as_str() {
            "registrar" => {
                if registrar.is_none() {
                    registrar = Some(value);
                }
            }
            "registrant organization" | "org-name" | "registrant" => {
                if registrant.is_none() {
                    registrant = Some(value);
                }
            }
            "creation date" | "created" => {
                if creation_date.is_none() {
                    creation_date = Some(value);
                }
            }
            "expiration date" | "registry expiry date" | "expires" => {
                if expiration_date.is_none() {
                    expiration_date = Some(value);
                }
            }
            "updated date" | "last-modified" => {
                if updated_date.is_none() {
                    updated_date = Some(value);
                }
            }
            "name server" => {
                let ns = value.to_lowercase();
                if !name_servers.contains(&ns) {
                    name_servers.push(ns);
                }
            }
            "status" | "domain status" => {
                // May contain URL after space, take entire value
                if !status.contains(&value) {
                    status.push(value);
                }
            }
            "dnssec" => {
                if dnssec.is_none() {
                    dnssec = Some(value);
                }
            }
            "registrar abuse contact email" | "abuse-mailbox" => {
                if abuse_contact.is_none() {
                    abuse_contact = Some(value);
                }
            }
            _ => {}
        }
    }

    Some(WhoisResult {
        query: target.to_string(),
        registrar,
        registrant,
        creation_date,
        expiration_date,
        updated_date,
        name_servers,
        status,
        dnssec,
        abuse_contact,
        raw: output.to_string(),
        queried_at: Utc::now(),
        rdap: None,
    })
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
