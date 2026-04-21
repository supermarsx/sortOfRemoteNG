//! # Hurricane Electric DDNS Provider
//!
//! Updates via `https://dyn.dns.he.net/nic/update` or TunnelBroker endpoint.

use crate::types::*;
use chrono::Utc;
use log::info;
use std::time::Instant;

/// Update a Hurricane Electric hostname.
pub async fn update(profile: &DdnsProfile, ip: &str) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
        profile.domain.clone()
    } else {
        format!("{}.{}", profile.hostname, profile.domain)
    };

    let (hostname, password) = match &profile.auth {
        DdnsAuthMethod::Basic { username, password } => (username.clone(), password.clone()),
        _ => return Err("Hurricane Electric requires Basic auth (hostname + key)".to_string()),
    };

    let tunnel_id = match &profile.provider_settings {
        ProviderSettings::HurricaneElectric(s) => s.tunnel_id.clone(),
        _ => None,
    };

    let url = if let Some(ref tid) = tunnel_id {
        // TunnelBroker endpoint
        format!(
            "https://ipv4.tunnelbroker.net/nic/update?hostname={}&myip={}",
            tid, ip
        )
    } else {
        // Standard DNS update
        format!(
            "https://dyn.dns.he.net/nic/update?hostname={}&password={}&myip={}",
            fqdn, password, ip
        )
    };

    let mut cmd = tokio::process::Command::new("curl");
    cmd.args(["-s", "-m", "30"]);

    if tunnel_id.is_some() {
        cmd.args(["-u", &format!("{}:{}", hostname, password)]);
    }

    cmd.arg(&url);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("curl failed: {}", e))?;
    let body = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let (status, error) = if body.starts_with("good") {
        (UpdateStatus::Success, None)
    } else if body.starts_with("nochg") {
        (UpdateStatus::NoChange, None)
    } else if body == "badauth" {
        (
            UpdateStatus::AuthError,
            Some("Invalid key/password".to_string()),
        )
    } else if body == "abuse" {
        (
            UpdateStatus::RateLimited,
            Some("Blocked for abuse".to_string()),
        )
    } else if body == "911" {
        (UpdateStatus::Failed, Some("Server error".to_string()))
    } else {
        (
            UpdateStatus::UnexpectedResponse,
            Some(format!("Unexpected: {}", body)),
        )
    };

    if status == UpdateStatus::Success {
        info!("Hurricane Electric: Updated {} → {}", fqdn, ip);
    }

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::HurricaneElectric,
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
