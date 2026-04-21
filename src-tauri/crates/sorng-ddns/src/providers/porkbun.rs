//! # Porkbun DDNS Provider
//!
//! Updates via Porkbun API v3 (`https://porkbun.com/api/json/v3/`).

use crate::types::*;
use chrono::Utc;
use log::info;
use std::time::Instant;

/// Update a Porkbun A/AAAA record.
pub async fn update(profile: &DdnsProfile, ip: &str) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
        profile.domain.clone()
    } else {
        format!("{}.{}", profile.hostname, profile.domain)
    };

    let (api_key, secret_key) = match &profile.auth {
        DdnsAuthMethod::ApiKeySecret {
            api_key,
            api_secret,
        } => (api_key.clone(), api_secret.clone()),
        _ => return Err("Porkbun requires API Key + Secret Key".to_string()),
    };

    let ttl = match &profile.provider_settings {
        ProviderSettings::Porkbun(s) => s.ttl.unwrap_or(600),
        _ => 600,
    };

    let record_name = if profile.hostname.is_empty() || profile.hostname == "@" {
        ""
    } else {
        &profile.hostname
    };

    // Determine record type based on IP format
    let record_type = if ip.contains(':') { "AAAA" } else { "A" };

    let url = format!(
        "https://porkbun.com/api/json/v3/dns/editByNameType/{}/{}/{}",
        profile.domain, record_type, record_name
    );

    let payload = serde_json::json!({
        "secretapikey": secret_key,
        "apikey": api_key,
        "content": ip,
        "ttl": ttl.to_string()
    });

    let mut cmd = tokio::process::Command::new("curl");
    cmd.args([
        "-s",
        "-m",
        "30",
        "-X",
        "POST",
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

    let json: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);

    let api_status = json["status"].as_str().unwrap_or("ERROR");

    let (status, error) = if api_status == "SUCCESS" {
        info!("Porkbun: Updated {} → {}", fqdn, ip);
        (UpdateStatus::Success, None)
    } else {
        let msg = json["message"].as_str().unwrap_or("Unknown error");
        if msg.to_lowercase().contains("authentication") {
            (UpdateStatus::AuthError, Some(msg.to_string()))
        } else {
            (UpdateStatus::Failed, Some(msg.to_string()))
        }
    };

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::Porkbun,
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
