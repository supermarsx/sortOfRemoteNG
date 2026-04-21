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
pub fn parse_dig_output(output: &str) -> Option<DigResult> {
    if output.trim().is_empty() {
        return None;
    }

    let mut status = DnsStatus::Other;
    let mut opcode = String::new();
    let mut rcode = String::new();
    let mut flags: Vec<String> = Vec::new();
    let mut query_name = String::new();
    let mut query_type = String::new();
    let mut server = String::new();
    let mut query_time_ms: u32 = 0;
    let mut msg_size: u32 = 0;
    let mut answers: Vec<DnsRecord> = Vec::new();
    let mut authority: Vec<DnsRecord> = Vec::new();
    let mut additional: Vec<DnsRecord> = Vec::new();

    #[derive(PartialEq)]
    enum Section {
        None,
        Question,
        Answer,
        Authority,
        Additional,
    }
    let mut current_section = Section::None;

    for line in output.lines() {
        let trimmed = line.trim();

        // Header line: ";; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 12345"
        if trimmed.contains("->>HEADER<<-") {
            for part in trimmed.split(',') {
                let part = part.trim();
                if part.contains("opcode:") {
                    if let Some(val) = part.split("opcode:").nth(1) {
                        opcode = val.trim().to_string();
                    }
                } else if part.contains("status:") {
                    if let Some(val) = part.split("status:").nth(1) {
                        rcode = val.trim().to_string();
                        status = match rcode.to_uppercase().as_str() {
                            "NOERROR" => DnsStatus::NoError,
                            "FORMERR" => DnsStatus::FormErr,
                            "SERVFAIL" => DnsStatus::ServFail,
                            "NXDOMAIN" => DnsStatus::NxDomain,
                            "NOTIMP" | "NOTIMPL" => DnsStatus::NotImp,
                            "REFUSED" => DnsStatus::Refused,
                            _ => DnsStatus::Other,
                        };
                    }
                }
            }
            continue;
        }

        // Flags line: ";; flags: qr rd ra; QUERY: 1, ANSWER: 1, ..."
        if trimmed.starts_with(";; flags:") {
            if let Some(flags_part) = trimmed.strip_prefix(";; flags:") {
                // Flags are before the first ';'
                let flags_str = if let Some(semi) = flags_part.find(';') {
                    &flags_part[..semi]
                } else {
                    flags_part
                };
                flags = flags_str
                    .split_whitespace()
                    .map(|s| s.to_string())
                    .collect();
            }
            continue;
        }

        // Section markers
        if trimmed.starts_with(";; QUESTION SECTION:") {
            current_section = Section::Question;
            continue;
        } else if trimmed.starts_with(";; ANSWER SECTION:") {
            current_section = Section::Answer;
            continue;
        } else if trimmed.starts_with(";; AUTHORITY SECTION:") {
            current_section = Section::Authority;
            continue;
        } else if trimmed.starts_with(";; ADDITIONAL SECTION:") {
            current_section = Section::Additional;
            continue;
        } else if trimmed.starts_with(";;") {
            // Other ;; lines — parse footer info
            if trimmed.starts_with(";; Query time:") {
                // ";; Query time: 12 msec"
                let after = &trimmed[";; Query time:".len()..].trim();
                if let Some(num_str) = after.split_whitespace().next() {
                    query_time_ms = num_str.parse().unwrap_or(0);
                }
            } else if trimmed.starts_with(";; SERVER:") {
                // ";; SERVER: 8.8.8.8#53(8.8.8.8)"
                let after = &trimmed[";; SERVER:".len()..].trim();
                // Take address before '#'
                let srv = if let Some(hash) = after.find('#') {
                    &after[..hash]
                } else {
                    after.split_whitespace().next().unwrap_or("")
                };
                server = srv.trim().to_string();
            } else if trimmed.starts_with(";; MSG SIZE") {
                // ";; MSG SIZE  rcvd: 56"
                if let Some(rcvd_pos) = trimmed.find("rcvd:") {
                    let after = &trimmed[rcvd_pos + 5..].trim();
                    msg_size = after.parse().unwrap_or(0);
                }
            }
            current_section = Section::None;
            continue;
        }

        // Skip comment lines and empty lines
        if trimmed.starts_with(';') || trimmed.is_empty() {
            continue;
        }

        // Parse question section for query name/type
        if current_section == Section::Question {
            // ";example.com.			IN	A" — but leading ; already stripped above
            // Actually question lines start with ;
            continue;
        }

        // Parse record lines in answer/authority/additional sections
        // Format: "example.com.   300   IN   A   93.184.216.34"
        if current_section == Section::Answer
            || current_section == Section::Authority
            || current_section == Section::Additional
        {
            if let Some(record) = parse_dns_record(trimmed) {
                if current_section == Section::Answer {
                    // Capture query info from first answer
                    if query_name.is_empty() {
                        query_name = record.name.clone();
                        query_type = record.record_type.clone();
                    }
                    answers.push(record);
                } else if current_section == Section::Authority {
                    authority.push(record);
                } else {
                    additional.push(record);
                }
            }
        }
    }

    // If query_name is still empty, try to find it from the QUESTION section comment lines
    if query_name.is_empty() {
        for line in output.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with(';') && !trimmed.starts_with(";;") {
                let parts: Vec<&str> = trimmed[1..].split_whitespace().collect();
                if parts.len() >= 3 {
                    query_name = parts[0].to_string();
                    query_type = parts[parts.len() - 1].to_string();
                    break;
                }
            }
        }
    }

    Some(DigResult {
        query_name,
        query_type,
        server,
        query_time_ms,
        status,
        answers,
        authority,
        additional,
        flags,
        opcode,
        rcode,
        msg_size,
    })
}

/// Parse a single DNS record line like "example.com. 300 IN A 93.184.216.34"
fn parse_dns_record(line: &str) -> Option<DnsRecord> {
    let fields: Vec<&str> = line.split_whitespace().collect();
    if fields.len() < 5 {
        return None;
    }

    let name = fields[0].to_string();
    let ttl: u32 = fields[1].parse().ok()?;
    let class = fields[2].to_string();
    let record_type = fields[3].to_string();
    let data = fields[4..].join(" ");

    // Parse MX priority, SRV weight/port
    let mut priority: Option<u16> = None;
    let mut weight: Option<u16> = None;
    let mut port: Option<u16> = None;

    match record_type.as_str() {
        "MX" => {
            // data = "10 mail.example.com."
            if let Some(first) = fields.get(4) {
                priority = first.parse().ok();
            }
        }
        "SRV" => {
            // data = "10 5 443 server.example.com."
            priority = fields.get(4).and_then(|s| s.parse().ok());
            weight = fields.get(5).and_then(|s| s.parse().ok());
            port = fields.get(6).and_then(|s| s.parse().ok());
        }
        _ => {}
    }

    Some(DnsRecord {
        name,
        record_type,
        ttl,
        class,
        data,
        priority,
        weight,
        port,
    })
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
