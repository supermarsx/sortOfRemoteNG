//! # DNSPod Provider
//!
//! Updates via DNSPod (Tencent Cloud) API.

use super::http;
use crate::types::*;
use chrono::Utc;
use log::info;
use reqwest::Method;
use std::time::Instant;

/// Update a DNSPod record.
pub async fn update(profile: &DdnsProfile, ip: &str) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
        profile.domain.clone()
    } else {
        format!("{}.{}", profile.hostname, profile.domain)
    };

    let (token_id, token) = match &profile.auth {
        DdnsAuthMethod::DnsPodAuth { token_id, token } => (token_id.clone(), token.clone()),
        _ => return Err("DNSPod requires token_id + token auth".to_string()),
    };

    let (_domain_id, record_id, record_line) = match &profile.provider_settings {
        ProviderSettings::DnsPod(s) => (
            s.domain_id.clone(),
            s.record_id.clone(),
            s.record_line.clone().unwrap_or_else(|| "默认".to_string()),
        ),
        _ => (None, None, "默认".to_string()),
    };

    let sub_domain = if profile.hostname.is_empty() {
        "@"
    } else {
        &profile.hostname
    };

    // Use ddns endpoint for simplicity
    let url = "https://dnsapi.cn/Record.Ddns";

    let mut form_data = vec![
        ("login_token", format!("{},{}", token_id, token)),
        ("format", "json".to_string()),
        ("domain", profile.domain.clone()),
        ("sub_domain", sub_domain.to_string()),
        ("record_line", record_line),
        ("value", ip.to_string()),
    ];
    if let Some(ref rid) = record_id {
        form_data.push(("record_id", rid.clone()));
    }

    let body = http::send(http::request(Method::POST, url, true)?.form(&form_data))
        .await?
        .body;

    let json: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);

    let status_code = json["status"]["code"].as_str().unwrap_or("-1");

    let (status, error) = match status_code {
        "1" => (UpdateStatus::Success, None),
        "-1" => (
            UpdateStatus::AuthError,
            Some("Authentication failed".to_string()),
        ),
        "-15" => (UpdateStatus::Failed, Some("Domain not found".to_string())),
        "104" => (UpdateStatus::RateLimited, Some("Rate limited".to_string())),
        _ => {
            let msg = json["status"]["message"]
                .as_str()
                .unwrap_or("Unknown error");
            (
                UpdateStatus::Failed,
                Some(format!("DNSPod error {}: {}", status_code, msg)),
            )
        }
    };

    if status == UpdateStatus::Success {
        info!("DNSPod: Updated {} → {}", fqdn, ip);
    }

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::DnsPod,
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
