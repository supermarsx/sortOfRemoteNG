//! # ChangeIP DDNS Provider
//!
//! Updates via `https://nic.changeip.com/nic/update`.

use super::http;
use crate::types::*;
use chrono::Utc;
use log::info;
use reqwest::Method;
use std::time::Instant;

/// Update a ChangeIP hostname.
pub async fn update(profile: &DdnsProfile, ip: &str) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
        profile.domain.clone()
    } else {
        format!("{}.{}", profile.hostname, profile.domain)
    };

    let (username, password) = match &profile.auth {
        DdnsAuthMethod::Basic { username, password } => (username.clone(), password.clone()),
        _ => return Err("ChangeIP requires Basic auth".to_string()),
    };

    let url = format!(
        "https://nic.changeip.com/nic/update?hostname={}&myip={}",
        fqdn, ip
    );

    let body =
        http::send(http::request(Method::GET, &url, true)?.basic_auth(username, Some(password)))
            .await?
            .body;

    let lower = body.to_lowercase();
    let (status, error) = if lower.contains("successful") || body.starts_with("good") {
        (UpdateStatus::Success, None)
    } else if body.starts_with("nochg") {
        (UpdateStatus::NoChange, None)
    } else if lower.contains("badauth") {
        (UpdateStatus::AuthError, Some("Bad credentials".to_string()))
    } else {
        (
            UpdateStatus::UnexpectedResponse,
            Some(format!("Unexpected: {}", body)),
        )
    };

    if status == UpdateStatus::Success {
        info!("ChangeIP: Updated {} → {}", fqdn, ip);
    }

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::ChangeIp,
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
