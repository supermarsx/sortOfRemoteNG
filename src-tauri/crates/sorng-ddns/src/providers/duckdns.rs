//! # DuckDNS Provider
//!
//! Token-based subdomain updates via `https://www.duckdns.org/update`.

use super::http;
use crate::types::*;
use chrono::Utc;
use log::info;
use reqwest::Method;
use std::time::Instant;

/// Update a DuckDNS subdomain.
pub async fn update(
    profile: &DdnsProfile,
    ip: &str,
    ipv6: Option<&str>,
) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let subdomain = &profile.hostname;

    let token = match &profile.auth {
        DdnsAuthMethod::ApiToken { token } => token.clone(),
        _ => return Err("DuckDNS requires an API token".to_string()),
    };

    let (clear_txt, txt_value) = match &profile.provider_settings {
        ProviderSettings::DuckDns(s) => (s.clear_txt, s.txt_value.clone()),
        _ => (false, None),
    };

    let mut url = http::parse_url("https://www.duckdns.org/update", true)?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("domains", subdomain)
            .append_pair("token", &token)
            .append_pair("ip", ip);
        if let Some(v6) = ipv6 {
            query.append_pair("ipv6", v6);
        }
        if let Some(ref txt) = txt_value {
            query.append_pair("txt", txt);
        }
        if clear_txt {
            query.append_pair("clear", "true");
        }
    }

    let body = http::send(http::request(Method::GET, url.as_str(), true)?)
        .await?
        .body;

    let (status, error) = if body == "OK" {
        (UpdateStatus::Success, None)
    } else if body == "KO" {
        (
            UpdateStatus::Failed,
            Some("DuckDNS returned KO — check token and subdomain".to_string()),
        )
    } else {
        (
            UpdateStatus::UnexpectedResponse,
            Some(format!("Unexpected response: {}", body)),
        )
    };

    let fqdn = format!("{}.duckdns.org", subdomain);

    if status == UpdateStatus::Success {
        info!("DuckDNS: Updated {} → {}", fqdn, ip);
    }

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::DuckDns,
        status,
        ip_sent: Some(ip.to_string()),
        ip_previous: None,
        hostname: profile.hostname.clone(),
        fqdn,
        provider_response: Some(body),
        error,
        timestamp: Utc::now().to_rfc3339(),
        latency_ms: start.elapsed().as_millis() as u64,
    })
}
