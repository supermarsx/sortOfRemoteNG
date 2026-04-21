//! # OVH DDNS Provider
//!
//! Updates via OVH DynHost or REST API.

use crate::types::*;
use chrono::Utc;
use log::info;
use std::time::Instant;

/// Update an OVH DynHost record.
pub async fn update(profile: &DdnsProfile, ip: &str) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
        profile.domain.clone()
    } else {
        format!("{}.{}", profile.hostname, profile.domain)
    };

    let use_rest = match &profile.provider_settings {
        ProviderSettings::Ovh(s) => s.use_rest_api,
        _ => false,
    };

    if use_rest {
        return update_rest(profile, ip, &fqdn, start).await;
    }

    // DynHost mode
    let (username, password) = match &profile.auth {
        DdnsAuthMethod::Basic { username, password } => (username.clone(), password.clone()),
        _ => return Err("OVH DynHost requires Basic auth".to_string()),
    };

    let url = format!(
        "https://www.ovh.com/nic/update?system=dyndns&hostname={}&myip={}",
        fqdn, ip
    );

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
    } else {
        (
            UpdateStatus::UnexpectedResponse,
            Some(format!("Unexpected: {}", body)),
        )
    };

    if status == UpdateStatus::Success {
        info!("OVH DynHost: Updated {} → {}", fqdn, ip);
    }

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::Ovh,
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

/// Update via OVH REST API (requires consumer key auth).
async fn update_rest(
    profile: &DdnsProfile,
    ip: &str,
    fqdn: &str,
    start: Instant,
) -> Result<DdnsUpdateResult, String> {
    let (_app_key, _app_secret, _consumer_key) = match &profile.auth {
        DdnsAuthMethod::OvhAuth {
            application_key,
            application_secret,
            consumer_key,
        } => (
            application_key.clone(),
            application_secret.clone(),
            consumer_key.clone(),
        ),
        _ => return Err("OVH REST API requires OvhAuth credentials".to_string()),
    };

    // OVH REST API requires complex signature — simplified placeholder
    // In production, compute $1$<sha1(AS+CK+METHOD+QUERY+BODY+TIMESTAMP)>
    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::Ovh,
        status: UpdateStatus::Failed,
        ip_sent: Some(ip.to_string()),
        ip_previous: None,
        hostname: profile.hostname.clone(),
        fqdn: fqdn.to_string(),
        provider_response: None,
        error: Some(
            "OVH REST API requires signature computation (use DynHost mode instead)".to_string(),
        ),
        timestamp: Utc::now().to_rfc3339(),
        latency_ms: start.elapsed().as_millis() as u64,
    })
}
