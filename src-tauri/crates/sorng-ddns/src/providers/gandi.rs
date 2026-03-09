//! # Gandi LiveDNS Provider
//!
//! Updates via Gandi LiveDNS REST API.

use crate::types::*;
use chrono::Utc;
use log::info;
use std::time::Instant;

/// Update a Gandi LiveDNS record.
pub async fn update(profile: &DdnsProfile, ip: &str) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
        profile.domain.clone()
    } else {
        format!("{}.{}", profile.hostname, profile.domain)
    };

    let token = match &profile.auth {
        DdnsAuthMethod::ApiToken { token } => token.clone(),
        _ => return Err("Gandi requires a Personal Access Token".to_string()),
    };

    let ttl = match &profile.provider_settings {
        ProviderSettings::Gandi(s) => s.ttl.unwrap_or(300),
        _ => 300,
    };

    let record_name = if profile.hostname.is_empty() || profile.hostname == "@" {
        "@"
    } else {
        &profile.hostname
    };

    let record_type = if ip.contains(':') { "AAAA" } else { "A" };

    let url = format!(
        "https://api.gandi.net/v5/livedns/domains/{}/records/{}/{}",
        profile.domain, record_name, record_type
    );

    let payload = serde_json::json!({
        "rrset_values": [ip],
        "rrset_ttl": ttl
    });

    let mut cmd = tokio::process::Command::new("curl");
    cmd.args([
        "-s",
        "-m",
        "30",
        "-X",
        "PUT",
        "-H",
        &format!("Authorization: Bearer {}", token),
        "-H",
        "Content-Type: application/json",
        "-d",
        &payload.to_string(),
        &url,
    ]);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("curl failed: {}", e))?;
    let body = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let http_code = output.status.code().unwrap_or(0);

    let (status, error) = if output.status.success() || body.contains("\"message\"") {
        let json: serde_json::Value =
            serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
        let msg = json["message"].as_str().unwrap_or("");

        if msg.contains("DNS Record Created") || msg.contains("updated") || body.is_empty() {
            info!("Gandi: Updated {} → {}", fqdn, ip);
            (UpdateStatus::Success, None)
        } else if msg.contains("401") || msg.contains("Unauthorized") {
            (UpdateStatus::AuthError, Some("Invalid token".to_string()))
        } else if msg.contains("404") {
            (
                UpdateStatus::Failed,
                Some("Domain or record not found".to_string()),
            )
        } else {
            (UpdateStatus::Success, None) // Gandi returns 201 on create
        }
    } else {
        (
            UpdateStatus::Failed,
            Some(format!("HTTP {}: {}", http_code, body)),
        )
    };

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::Gandi,
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
