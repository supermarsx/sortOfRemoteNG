//! # Dynu DDNS Provider
//!
//! Updates via Dynu IP Update Protocol (dyndns2-compatible).

use super::http;
use crate::types::*;
use chrono::Utc;
use log::info;
use reqwest::Method;
use std::time::Instant;

/// Update a Dynu hostname.
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

    let (username, password) = match &profile.auth {
        DdnsAuthMethod::Basic { username, password } => (username.clone(), password.clone()),
        DdnsAuthMethod::ApiToken { token } => (String::new(), token.clone()),
        _ => return Err("Dynu requires Basic auth or API token".to_string()),
    };

    let mut url = format!(
        "https://api.dynu.com/nic/update?hostname={}&myip={}",
        fqdn, ip
    );
    if let Some(v6) = ipv6 {
        url.push_str(&format!("&myipv6={}", v6));
    }

    let body =
        http::send(http::request(Method::GET, &url, true)?.basic_auth(username, Some(password)))
            .await?
            .body;

    let (status, error) = if body.starts_with("good") {
        (UpdateStatus::Success, None)
    } else if body.starts_with("nochg") {
        (UpdateStatus::NoChange, None)
    } else if body == "badauth" {
        (
            UpdateStatus::AuthError,
            Some("Invalid credentials".to_string()),
        )
    } else if body == "nohost" {
        (UpdateStatus::Failed, Some("Hostname not found".to_string()))
    } else if body == "abuse" {
        (UpdateStatus::RateLimited, Some("Rate limited".to_string()))
    } else {
        (
            UpdateStatus::UnexpectedResponse,
            Some(format!("Unexpected: {}", body)),
        )
    };

    if status == UpdateStatus::Success {
        info!("Dynu: Updated {} → {}", fqdn, ip);
    }

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::Dynu,
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
