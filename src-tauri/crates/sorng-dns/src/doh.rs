//! # DNS-over-HTTPS (DoH)
//!
//! RFC 8484 wire-format and RFC 8427 JSON API implementation.
//! Sends DNS queries over HTTPS to prevent eavesdropping and tampering.

use crate::types::*;
use crate::wire;

/// Execute a DoH query using RFC 8484 wire format (POST with application/dns-message).
pub async fn execute_doh_query(
    query: &DnsQuery,
    server: &DnsServer,
    config: &DnsResolverConfig,
) -> Result<DnsResponse, String> {
    let start = std::time::Instant::now();

    let id: u16 = rand::random();
    let wire_query = wire::build_query(query, id, config.edns0, config.edns0_payload_size);

    let url = build_doh_url(server);
    let timeout = std::time::Duration::from_millis(config.timeout_ms);

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    if server.doh_wire_format {
        // RFC 8484 POST with binary wire format
        let response = client
            .post(&url)
            .header("Content-Type", "application/dns-message")
            .header("Accept", "application/dns-message")
            .body(wire_query)
            .send()
            .await
            .map_err(|e| format!("DoH request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("DoH server returned HTTP {}", response.status()));
        }

        let body = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read DoH response: {}", e))?;

        let duration_ms = start.elapsed().as_millis() as u64;

        wire::parse_response(&body, &server.address, DnsProtocol::DoH, duration_ms)
            .ok_or_else(|| "Failed to parse DoH wire-format response".to_string())
    } else {
        // JSON API (Google/Cloudflare style)
        execute_doh_json_query(query, server, &client, start).await
    }
}

/// DoH GET with wire format (RFC 8484 §4.1).
pub async fn execute_doh_get_query(
    query: &DnsQuery,
    server: &DnsServer,
    config: &DnsResolverConfig,
) -> Result<DnsResponse, String> {
    let start = std::time::Instant::now();

    let id: u16 = rand::random();
    let wire_query = wire::build_query(query, id, config.edns0, config.edns0_payload_size);

    // Base64url encode without padding (RFC 8484 §6)
    let encoded = base64_url_encode(&wire_query);

    let url = format!("{}?dns={}", build_doh_url(server), encoded);
    let timeout = std::time::Duration::from_millis(config.timeout_ms);

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .header("Accept", "application/dns-message")
        .send()
        .await
        .map_err(|e| format!("DoH GET request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("DoH server returned HTTP {}", response.status()));
    }

    let body = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read DoH response: {}", e))?;

    let duration_ms = start.elapsed().as_millis() as u64;

    wire::parse_response(&body, &server.address, DnsProtocol::DoH, duration_ms)
        .ok_or_else(|| "Failed to parse DoH wire-format response".to_string())
}

/// DoH JSON API query (Google DNS / Cloudflare style).
async fn execute_doh_json_query(
    query: &DnsQuery,
    server: &DnsServer,
    client: &reqwest::Client,
    start: std::time::Instant,
) -> Result<DnsResponse, String> {
    let url = format!(
        "{}?name={}&type={}&cd={}&do={}",
        build_doh_url(server),
        &query.name,
        query.record_type.as_str(),
        if query.cd { "1" } else { "0" },
        if query.dnssec { "1" } else { "0" }
    );

    let response = client
        .get(&url)
        .header("Accept", "application/dns-json")
        .send()
        .await
        .map_err(|e| format!("DoH JSON request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "DoH JSON server returned HTTP {}",
            response.status()
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read DoH JSON response: {}", e))?;

    let duration_ms = start.elapsed().as_millis() as u64;

    parse_doh_json_response(&body, &server.address, duration_ms)
}

/// Parse a DoH JSON API response (Google/Cloudflare format).
fn parse_doh_json_response(
    json: &str,
    server: &str,
    duration_ms: u64,
) -> Result<DnsResponse, String> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Invalid JSON: {}", e))?;

    let status = v["Status"].as_u64().unwrap_or(2) as u16;
    let rcode = DnsRcode::from_code(status);

    let answers = parse_json_records(v["Answer"].as_array());
    let authority = parse_json_records(v["Authority"].as_array());
    let additional = parse_json_records(v["Additional"].as_array());

    Ok(DnsResponse {
        rcode,
        authoritative: v["AA"].as_bool().unwrap_or(false),
        truncated: v["TC"].as_bool().unwrap_or(false),
        recursion_available: v["RA"].as_bool().unwrap_or(true),
        authenticated_data: v["AD"].as_bool().unwrap_or(false),
        answers,
        authority,
        additional,
        duration_ms,
        server: server.to_string(),
        protocol: DnsProtocol::DoH,
    })
}

fn parse_json_records(arr: Option<&Vec<serde_json::Value>>) -> Vec<DnsRecord> {
    let Some(records) = arr else {
        return Vec::new();
    };

    records
        .iter()
        .filter_map(|r| {
            let name = r["name"].as_str()?.to_string();
            let type_code = r["type"].as_u64()? as u16;
            let ttl = r["TTL"].as_u64().unwrap_or(300) as u32;
            let data_str = r["data"].as_str().unwrap_or("");
            let record_type = DnsRecordType::from_type_code(type_code)?;

            let data = parse_json_record_data(record_type, data_str);

            Some(DnsRecord {
                name,
                record_type,
                ttl,
                data,
            })
        })
        .collect()
}

fn parse_json_record_data(rtype: DnsRecordType, data: &str) -> DnsRecordData {
    match rtype {
        DnsRecordType::A => DnsRecordData::A {
            address: data.to_string(),
        },
        DnsRecordType::AAAA => DnsRecordData::AAAA {
            address: data.to_string(),
        },
        DnsRecordType::CNAME => DnsRecordData::CNAME {
            target: data.trim_end_matches('.').to_string(),
        },
        DnsRecordType::NS => DnsRecordData::NS {
            nameserver: data.trim_end_matches('.').to_string(),
        },
        DnsRecordType::PTR => DnsRecordData::PTR {
            domain: data.trim_end_matches('.').to_string(),
        },
        DnsRecordType::MX => {
            let parts: Vec<&str> = data.splitn(2, ' ').collect();
            if parts.len() == 2 {
                DnsRecordData::MX {
                    priority: parts[0].parse().unwrap_or(10),
                    exchange: parts[1].trim_end_matches('.').to_string(),
                }
            } else {
                DnsRecordData::MX {
                    priority: 10,
                    exchange: data.to_string(),
                }
            }
        }
        DnsRecordType::TXT => DnsRecordData::TXT {
            text: data.trim_matches('"').to_string(),
        },
        DnsRecordType::SRV => {
            let parts: Vec<&str> = data.splitn(4, ' ').collect();
            if parts.len() == 4 {
                DnsRecordData::SRV {
                    priority: parts[0].parse().unwrap_or(0),
                    weight: parts[1].parse().unwrap_or(0),
                    port: parts[2].parse().unwrap_or(0),
                    target: parts[3].trim_end_matches('.').to_string(),
                }
            } else {
                DnsRecordData::Raw {
                    data: data.as_bytes().to_vec(),
                }
            }
        }
        DnsRecordType::CAA => {
            let parts: Vec<&str> = data.splitn(3, ' ').collect();
            if parts.len() == 3 {
                DnsRecordData::CAA {
                    flags: parts[0].parse().unwrap_or(0),
                    tag: parts[1].to_string(),
                    value: parts[2].trim_matches('"').to_string(),
                }
            } else {
                DnsRecordData::Raw {
                    data: data.as_bytes().to_vec(),
                }
            }
        }
        DnsRecordType::SSHFP => {
            let parts: Vec<&str> = data.splitn(3, ' ').collect();
            if parts.len() == 3 {
                DnsRecordData::SSHFP {
                    algorithm: parts[0].parse().unwrap_or(0),
                    fingerprint_type: parts[1].parse().unwrap_or(0),
                    fingerprint: parts[2].to_string(),
                }
            } else {
                DnsRecordData::Raw {
                    data: data.as_bytes().to_vec(),
                }
            }
        }
        DnsRecordType::TLSA => {
            let parts: Vec<&str> = data.splitn(4, ' ').collect();
            if parts.len() == 4 {
                DnsRecordData::TLSA {
                    usage: parts[0].parse().unwrap_or(0),
                    selector: parts[1].parse().unwrap_or(0),
                    matching_type: parts[2].parse().unwrap_or(0),
                    certificate_data: parts[3].to_string(),
                }
            } else {
                DnsRecordData::Raw {
                    data: data.as_bytes().to_vec(),
                }
            }
        }
        _ => DnsRecordData::Raw {
            data: data.as_bytes().to_vec(),
        },
    }
}

fn build_doh_url(server: &DnsServer) -> String {
    let base = &server.address;

    // If it's already a full URL, use it
    if base.starts_with("https://") {
        if base.contains("/dns-query") || base.contains("/resolve") {
            return base.clone();
        }
        let path = server.doh_path.as_deref().unwrap_or("/dns-query");
        return format!("{}{}", base.trim_end_matches('/'), path);
    }

    // Otherwise build URL from IP/hostname
    let port = server.effective_port(DnsProtocol::DoH);
    let path = server.doh_path.as_deref().unwrap_or("/dns-query");

    if port == 443 {
        format!("https://{}{}", base, path)
    } else {
        format!("https://{}:{}{}", base, port, path)
    }
}

/// Base64url encode without padding (RFC 4648 §5, §3.2).
fn base64_url_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data)
}

/// Validate a DoH server URL.
pub fn validate_doh_url(url: &str) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("DoH URL must use HTTPS".to_string());
    }

    if url.len() < 12 {
        return Err("DoH URL too short".to_string());
    }

    // Check for common DoH path
    if !url.contains("/dns-query") && !url.contains("/resolve") && !url.contains("/dns") {
        log::warn!("DoH URL doesn't contain a standard path (/dns-query, /resolve)");
    }

    Ok(())
}
