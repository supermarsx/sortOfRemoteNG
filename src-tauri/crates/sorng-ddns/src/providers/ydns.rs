//! # YDNS Provider
//!
//! Updates via `https://ydns.io/api/v1/update/?host=...&ip=...`.

use crate::types::*;
use chrono::Utc;
use log::info;
use std::time::Instant;

/// Update a YDNS hostname.
pub async fn update(profile: &DdnsProfile, ip: &str) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
        profile.domain.clone()
    } else {
        format!("{}.{}", profile.hostname, profile.domain)
    };

    let (username, password) = match &profile.auth {
        DdnsAuthMethod::Basic { username, password } => (username.clone(), password.clone()),
        _ => {
            return Err("YDNS requires Basic auth (host as user, API key as password)".to_string())
        }
    };

    let url = format!("https://ydns.io/api/v1/update/?host={}&ip={}", fqdn, ip);

    let mut cmd = tokio::process::Command::new("curl");
    cmd.args([
        "-s",
        "-m",
        "30",
        "-u",
        &format!("{}:{}", username, password),
        &url,
    ]);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("curl failed: {}", e))?;
    let body = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let (status, error) = if body == "ok" {
        (UpdateStatus::Success, None)
    } else if body.starts_with("nochg") || body == "ok nochg" {
        (UpdateStatus::NoChange, None)
    } else if body.contains("badauth") || body.contains("401") {
        (
            UpdateStatus::AuthError,
            Some("Invalid credentials".to_string()),
        )
    } else {
        (
            UpdateStatus::UnexpectedResponse,
            Some(format!("Unexpected: {}", body)),
        )
    };

    if status == UpdateStatus::Success {
        info!("YDNS: Updated {} → {}", fqdn, ip);
    }

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::Ydns,
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
