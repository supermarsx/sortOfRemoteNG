//! # Google Domains DDNS Provider
//!
//! Updates via `https://domains.google.com/nic/update` (dyndns2 protocol).

use crate::types::*;
use chrono::Utc;
use log::info;
use std::time::Instant;

/// Update a Google Domains hostname.
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
            return Err("Google Domains requires Basic auth (generated credentials)".to_string())
        }
    };

    let url = format!(
        "https://domains.google.com/nic/update?hostname={}&myip={}",
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

    let output = cmd.output().await.map_err(|e| format!("curl failed: {}", e))?;
    let body = String::from_utf8_lossy(&output.stdout).trim().to_string();

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
        (
            UpdateStatus::Failed,
            Some("Hostname not configured for DDNS".to_string()),
        )
    } else if body == "notfqdn" {
        (
            UpdateStatus::Failed,
            Some("Not a valid FQDN".to_string()),
        )
    } else if body == "abuse" {
        (
            UpdateStatus::RateLimited,
            Some("Too many update attempts".to_string()),
        )
    } else if body == "911" {
        (
            UpdateStatus::Failed,
            Some("Google server error — retry later".to_string()),
        )
    } else if body == "conflict" {
        (
            UpdateStatus::Failed,
            Some("A/AAAA record conflict".to_string()),
        )
    } else {
        (
            UpdateStatus::UnexpectedResponse,
            Some(format!("Unexpected: {}", body)),
        )
    };

    if status == UpdateStatus::Success {
        info!("Google Domains: Updated {} → {}", fqdn, ip);
    }

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::GoogleDomains,
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
