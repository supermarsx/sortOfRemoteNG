//! # ChangeIP DDNS Provider
//!
//! Updates via `https://nic.changeip.com/nic/update`.

use crate::types::*;
use chrono::Utc;
use log::info;
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

    let mut cmd = tokio::process::Command::new("curl");
    cmd.args([
        "-s",
        "-m",
        "30",
        "-u",
        &format!("{}:{}", username, password),
        "-A",
        "SortOfRemoteNG/1.0",
        &url,
    ]);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("curl failed: {}", e))?;
    let body = String::from_utf8_lossy(&output.stdout).trim().to_string();

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
