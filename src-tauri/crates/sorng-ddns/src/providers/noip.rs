//! # No-IP DDNS Provider
//!
//! Updates hostnames via the No-IP HTTP update API.
//! Protocol: `https://dynupdate.no-ip.com/nic/update?hostname=...&myip=...`

use crate::types::*;
use chrono::Utc;
use log::info;
use std::time::Instant;

/// No-IP update endpoint.
fn update_url(https: bool) -> &'static str {
    if https {
        "https://dynupdate.no-ip.com/nic/update"
    } else {
        "http://dynupdate.no-ip.com/nic/update"
    }
}

/// Parse a No-IP response code.
fn parse_response(body: &str) -> (UpdateStatus, Option<String>) {
    let trimmed = body.trim();
    if trimmed.starts_with("good") {
        (UpdateStatus::Success, None)
    } else if trimmed.starts_with("nochg") {
        (UpdateStatus::NoChange, None)
    } else if trimmed == "nohost" {
        (
            UpdateStatus::Failed,
            Some("Hostname does not exist".to_string()),
        )
    } else if trimmed == "badauth" {
        (
            UpdateStatus::AuthError,
            Some("Invalid username or password".to_string()),
        )
    } else if trimmed == "badagent" {
        (
            UpdateStatus::Failed,
            Some("Client has been blocked (bad agent)".to_string()),
        )
    } else if trimmed == "!donator" {
        (
            UpdateStatus::Failed,
            Some("Feature not available for this account type".to_string()),
        )
    } else if trimmed == "abuse" {
        (
            UpdateStatus::RateLimited,
            Some("Hostname is blocked for abuse".to_string()),
        )
    } else if trimmed == "911" {
        (
            UpdateStatus::Failed,
            Some("Server error — retry later".to_string()),
        )
    } else {
        (
            UpdateStatus::UnexpectedResponse,
            Some(format!("Unexpected: {}", trimmed)),
        )
    }
}

/// Update a No-IP hostname.
pub async fn update(profile: &DdnsProfile, ip: &str) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
        profile.domain.clone()
    } else {
        format!("{}.{}", profile.hostname, profile.domain)
    };

    let (username, password) = match &profile.auth {
        DdnsAuthMethod::Basic { username, password } => (username.clone(), password.clone()),
        _ => return Err("No-IP requires Basic auth (username/password)".to_string()),
    };

    let use_https = match &profile.provider_settings {
        ProviderSettings::NoIp(s) => s.use_https,
        _ => true,
    };

    let offline = match &profile.provider_settings {
        ProviderSettings::NoIp(s) => s.offline,
        _ => false,
    };

    let base = update_url(use_https);
    let mut url = format!("{}?hostname={}&myip={}", base, fqdn, ip);
    if offline {
        url.push_str("&offline=YES");
    }

    let mut cmd = tokio::process::Command::new("curl");
    cmd.args([
        "-s",
        "-u",
        &format!("{}:{}", username, password),
        "-A",
        "SortOfRemoteNG/1.0 mars@sortofremoteng.com",
        &url,
    ]);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("curl failed: {}", e))?;
    let body = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let (status, error) = parse_response(&body);

    if status == UpdateStatus::Success {
        info!("No-IP: Updated {} → {}", fqdn, ip);
    }

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::NoIp,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_good() {
        let (status, err) = parse_response("good 1.2.3.4");
        assert_eq!(status, UpdateStatus::Success);
        assert!(err.is_none());
    }

    #[test]
    fn test_parse_nochg() {
        let (status, _) = parse_response("nochg 1.2.3.4");
        assert_eq!(status, UpdateStatus::NoChange);
    }

    #[test]
    fn test_parse_badauth() {
        let (status, err) = parse_response("badauth");
        assert_eq!(status, UpdateStatus::AuthError);
        assert!(err.is_some());
    }

    #[test]
    fn test_parse_abuse() {
        let (status, _) = parse_response("abuse");
        assert_eq!(status, UpdateStatus::RateLimited);
    }
}
