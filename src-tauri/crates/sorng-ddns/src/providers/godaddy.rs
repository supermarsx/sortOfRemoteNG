//! # GoDaddy DDNS Provider
//!
//! Updates DNS records via GoDaddy API v1.

use super::http;
use crate::types::*;
use chrono::Utc;
use log::info;
use reqwest::Method;
use std::time::Instant;

/// Update a GoDaddy A record.
pub async fn update(profile: &DdnsProfile, ip: &str) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
        profile.domain.clone()
    } else {
        format!("{}.{}", profile.hostname, profile.domain)
    };

    let (api_key, api_secret) = match &profile.auth {
        DdnsAuthMethod::ApiKeySecret {
            api_key,
            api_secret,
        } => (api_key.clone(), api_secret.clone()),
        _ => return Err("GoDaddy requires API Key + Secret".to_string()),
    };

    let ttl = match &profile.provider_settings {
        ProviderSettings::GoDaddy(s) => s.ttl.unwrap_or(600),
        _ => 600,
    };

    let record_name = if profile.hostname.is_empty() {
        "@"
    } else {
        &profile.hostname
    };

    let url = format!(
        "https://api.godaddy.com/v1/domains/{}/records/A/{}",
        profile.domain, record_name
    );

    let payload = serde_json::json!([{
        "data": ip,
        "ttl": ttl
    }]);

    let response = http::send_allow_error(
        http::request(Method::PUT, &url, true)?
            .header(
                reqwest::header::AUTHORIZATION,
                format!("sso-key {}:{}", api_key, api_secret),
            )
            .json(&payload),
    )
    .await?;
    let status_code = response.status.as_u16();
    let http_success = response.status.is_success();
    let body = response.body;

    // GoDaddy returns 200 with empty body on success
    let (status, error) = if http_success && (body.is_empty() || body == "{}") {
        info!("GoDaddy: Updated {} → {}", fqdn, ip);
        (UpdateStatus::Success, None)
    } else if matches!(status_code, 401 | 403) || body.contains("UNABLE_TO_AUTHENTICATE") {
        (
            UpdateStatus::AuthError,
            Some("Authentication failed".to_string()),
        )
    } else if status_code == 429 || body.contains("TOO_MANY_REQUESTS") {
        (
            UpdateStatus::RateLimited,
            Some("Rate limited by GoDaddy".to_string()),
        )
    } else {
        (
            UpdateStatus::Failed,
            Some(format!("GoDaddy returned HTTP {}", status_code)),
        )
    };

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::GoDaddy,
        status,
        ip_sent: Some(ip.to_string()),
        ip_previous: None,
        hostname: profile.hostname.clone(),
        fqdn,
        provider_response: Some(if body.is_empty() {
            "OK".to_string()
        } else {
            format!("GoDaddy returned HTTP {}", status_code)
        }),
        error,
        timestamp: Utc::now().to_rfc3339(),
        latency_ms: start.elapsed().as_millis() as u64,
    })
}
