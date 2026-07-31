//! # Cloudflare DDNS Provider
//!
//! Full DNS record management via Cloudflare API v4.
//! Supports A/AAAA records, proxy toggle, TTL, zone auto-detection.

use super::http;
use crate::types::*;
use chrono::Utc;
use log::{info, warn};
use reqwest::{header::CONTENT_TYPE, Method, RequestBuilder};
use std::time::Instant;

/// Build the Cloudflare API base URL.
fn api_base() -> &'static str {
    "https://api.cloudflare.com/client/v4"
}

/// Build authorization headers based on auth method.
fn with_auth(request: RequestBuilder, auth: &DdnsAuthMethod) -> Result<RequestBuilder, String> {
    match auth {
        DdnsAuthMethod::ApiToken { token } => Ok(request.bearer_auth(token)),
        DdnsAuthMethod::GlobalApiKey { email, api_key } => Ok(request
            .header("X-Auth-Email", email)
            .header("X-Auth-Key", api_key)),
        _ => Err("Cloudflare requires ApiToken or GlobalApiKey auth".to_string()),
    }
}

/// List all zones for the account.
pub async fn list_zones(auth: &DdnsAuthMethod) -> Result<Vec<CloudflareZone>, String> {
    let url = format!("{}/zones?per_page=50", api_base());
    let request = with_auth(http::request(Method::GET, &url, true)?, auth)?
        .header(CONTENT_TYPE, "application/json");
    let body = http::send(request).await?.body;
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {}", e))?;

    if json["success"].as_bool() != Some(true) {
        let errors = json["errors"].to_string();
        return Err(format!("Cloudflare API error: {}", errors));
    }

    let zones = json["result"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|z| CloudflareZone {
            id: z["id"].as_str().unwrap_or("").to_string(),
            name: z["name"].as_str().unwrap_or("").to_string(),
            status: z["status"].as_str().unwrap_or("unknown").to_string(),
            paused: z["paused"].as_bool().unwrap_or(false),
            nameservers: z["name_servers"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|ns| ns.as_str().map(|s| s.to_string()))
                .collect(),
            plan: z["plan"]["name"].as_str().map(|s| s.to_string()),
        })
        .collect();

    Ok(zones)
}

/// List DNS records for a zone.
pub async fn list_records(
    auth: &DdnsAuthMethod,
    zone_id: &str,
    record_type: Option<&str>,
    name: Option<&str>,
) -> Result<Vec<CloudflareDnsRecord>, String> {
    let mut url = http::parse_url(
        &format!("{}/zones/{}/dns_records", api_base(), zone_id),
        true,
    )?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("per_page", "100");
        if let Some(rt) = record_type {
            query.append_pair("type", rt);
        }
        if let Some(n) = name {
            query.append_pair("name", n);
        }
    }
    let request = with_auth(http::request(Method::GET, url.as_str(), true)?, auth)?
        .header(CONTENT_TYPE, "application/json");
    let body = http::send(request).await?.body;
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {}", e))?;

    if json["success"].as_bool() != Some(true) {
        return Err(format!("Cloudflare API error: {}", json["errors"]));
    }

    let records = json["result"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|r| {
            let rtype_str = r["type"].as_str().unwrap_or("A");
            let record_type = match rtype_str {
                "A" => DnsRecordType::A,
                "AAAA" => DnsRecordType::AAAA,
                "CNAME" => DnsRecordType::CNAME,
                "TXT" => DnsRecordType::TXT,
                "MX" => DnsRecordType::MX,
                "SRV" => DnsRecordType::SRV,
                "NS" => DnsRecordType::NS,
                _ => DnsRecordType::A,
            };
            CloudflareDnsRecord {
                id: r["id"].as_str().unwrap_or("").to_string(),
                record_type,
                name: r["name"].as_str().unwrap_or("").to_string(),
                content: r["content"].as_str().unwrap_or("").to_string(),
                ttl: r["ttl"].as_u64().unwrap_or(1) as u32,
                proxied: r["proxied"].as_bool().unwrap_or(false),
                modified_on: r["modified_on"].as_str().map(|s| s.to_string()),
                comment: r["comment"].as_str().map(|s| s.to_string()),
            }
        })
        .collect();

    Ok(records)
}

/// Create a DNS record.
#[allow(clippy::too_many_arguments)]
pub async fn create_record(
    auth: &DdnsAuthMethod,
    zone_id: &str,
    record_type: &str,
    name: &str,
    content: &str,
    ttl: u32,
    proxied: bool,
    comment: Option<&str>,
) -> Result<CloudflareDnsRecord, String> {
    let url = format!("{}/zones/{}/dns_records", api_base(), zone_id);

    let mut payload = serde_json::json!({
        "type": record_type,
        "name": name,
        "content": content,
        "ttl": ttl,
        "proxied": proxied,
    });
    if let Some(c) = comment {
        payload["comment"] = serde_json::Value::String(c.to_string());
    }

    let request = with_auth(http::request(Method::POST, &url, true)?, auth)?
        .header(CONTENT_TYPE, "application/json")
        .json(&payload);
    let body = http::send(request).await?.body;
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {}", e))?;

    if json["success"].as_bool() != Some(true) {
        return Err(format!("Create record failed: {}", json["errors"]));
    }

    let r = &json["result"];
    Ok(CloudflareDnsRecord {
        id: r["id"].as_str().unwrap_or("").to_string(),
        record_type: if record_type == "AAAA" {
            DnsRecordType::AAAA
        } else {
            DnsRecordType::A
        },
        name: r["name"].as_str().unwrap_or("").to_string(),
        content: r["content"].as_str().unwrap_or("").to_string(),
        ttl: r["ttl"].as_u64().unwrap_or(1) as u32,
        proxied: r["proxied"].as_bool().unwrap_or(false),
        modified_on: r["modified_on"].as_str().map(|s| s.to_string()),
        comment: r["comment"].as_str().map(|s| s.to_string()),
    })
}

/// Delete a DNS record.
pub async fn delete_record(
    auth: &DdnsAuthMethod,
    zone_id: &str,
    record_id: &str,
) -> Result<(), String> {
    let url = format!("{}/zones/{}/dns_records/{}", api_base(), zone_id, record_id);
    let request = with_auth(http::request(Method::DELETE, &url, true)?, auth)?
        .header(CONTENT_TYPE, "application/json");
    let body = http::send(request).await?.body;
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {}", e))?;

    if json["success"].as_bool() != Some(true) {
        return Err(format!("Delete record failed: {}", json["errors"]));
    }

    Ok(())
}

/// Update a Cloudflare DNS record with the current public IP.
pub async fn update(
    profile: &DdnsProfile,
    ip: &str,
    ipv6: Option<&str>,
) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
        profile.domain.clone()
    } else {
        format!("{}.{}", profile.hostname, profile.domain)
    };

    // Resolve zone_id and record_id
    let (zone_id, proxied, ttl, comment) = match &profile.provider_settings {
        ProviderSettings::Cloudflare(cf) => {
            (cf.zone_id.clone(), &cf.proxied, cf.ttl, cf.comment.clone())
        }
        _ => (None, &CloudflareProxyMode::Unchanged, None, None),
    };

    // Auto-detect zone_id if not provided
    let zone_id = match zone_id {
        Some(id) if !id.is_empty() => id,
        _ => {
            let zones = list_zones(&profile.auth).await?;
            zones
                .iter()
                .find(|z| profile.domain.ends_with(&z.name))
                .map(|z| z.id.clone())
                .ok_or_else(|| format!("No Cloudflare zone found for domain: {}", profile.domain))?
        }
    };

    // Find the existing A/AAAA record
    let record_type_str = if ipv6.is_some() { "AAAA" } else { "A" };
    let target_ip = ipv6.unwrap_or(ip);

    let records = list_records(&profile.auth, &zone_id, Some(record_type_str), Some(&fqdn)).await?;

    if let Some(existing) = records.first() {
        if existing.content == target_ip {
            info!("Cloudflare: {} already points to {}", fqdn, target_ip);
            return Ok(DdnsUpdateResult {
                profile_id: profile.id.clone(),
                profile_name: profile.name.clone(),
                provider: DdnsProvider::Cloudflare,
                status: UpdateStatus::NoChange,
                ip_sent: Some(target_ip.to_string()),
                ip_previous: Some(existing.content.clone()),
                hostname: profile.hostname.clone(),
                fqdn,
                provider_response: Some("No change needed".to_string()),
                error: None,
                timestamp: Utc::now().to_rfc3339(),
                latency_ms: start.elapsed().as_millis() as u64,
            });
        }

        // Update existing record
        let mut payload = serde_json::json!({
            "type": record_type_str,
            "name": &fqdn,
            "content": target_ip,
        });
        if let Some(t) = ttl {
            payload["ttl"] = serde_json::Value::Number(t.into());
        }
        match proxied {
            CloudflareProxyMode::Proxied => {
                payload["proxied"] = serde_json::Value::Bool(true);
            }
            CloudflareProxyMode::DnsOnly => {
                payload["proxied"] = serde_json::Value::Bool(false);
            }
            CloudflareProxyMode::Unchanged => {
                payload["proxied"] = serde_json::Value::Bool(existing.proxied);
            }
        }
        if let Some(ref c) = comment {
            payload["comment"] = serde_json::Value::String(c.clone());
        }

        let url = format!(
            "{}/zones/{}/dns_records/{}",
            api_base(),
            zone_id,
            existing.id
        );
        let request = with_auth(http::request(Method::PATCH, &url, true)?, &profile.auth)?
            .header(CONTENT_TYPE, "application/json")
            .json(&payload);
        let body = http::send(request).await?.body;
        let json: serde_json::Value = serde_json::from_str(&body)
            .map_err(|_| "Cloudflare returned an invalid response".to_string())?;

        if json["success"].as_bool() != Some(true) {
            return Ok(DdnsUpdateResult {
                profile_id: profile.id.clone(),
                profile_name: profile.name.clone(),
                provider: DdnsProvider::Cloudflare,
                status: UpdateStatus::Failed,
                ip_sent: Some(target_ip.to_string()),
                ip_previous: Some(existing.content.clone()),
                hostname: profile.hostname.clone(),
                fqdn,
                provider_response: Some("Cloudflare rejected the update".to_string()),
                error: Some("Cloudflare API rejected the update".to_string()),
                timestamp: Utc::now().to_rfc3339(),
                latency_ms: start.elapsed().as_millis() as u64,
            });
        }

        info!(
            "Cloudflare: Updated {} → {} (was {})",
            fqdn, target_ip, existing.content
        );
        Ok(DdnsUpdateResult {
            profile_id: profile.id.clone(),
            profile_name: profile.name.clone(),
            provider: DdnsProvider::Cloudflare,
            status: UpdateStatus::Success,
            ip_sent: Some(target_ip.to_string()),
            ip_previous: Some(existing.content.clone()),
            hostname: profile.hostname.clone(),
            fqdn,
            provider_response: Some(body),
            error: None,
            timestamp: Utc::now().to_rfc3339(),
            latency_ms: start.elapsed().as_millis() as u64,
        })
    } else {
        warn!(
            "Cloudflare: No existing {} record for {}",
            record_type_str, fqdn
        );
        Err(format!(
            "No existing {} record found for {}. Create it first.",
            record_type_str, fqdn
        ))
    }
}
