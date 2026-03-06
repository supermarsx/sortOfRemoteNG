//! # Afraid DNS (FreeDNS) Provider
//!
//! Updates via hash-based URL or direct URL update.

use crate::types::*;
use chrono::Utc;
use log::info;
use std::time::Instant;

/// Update an Afraid DNS hostname.
pub async fn update(profile: &DdnsProfile, ip: &str) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
        profile.domain.clone()
    } else {
        format!("{}.{}", profile.hostname, profile.domain)
    };

    let url = match &profile.auth {
        DdnsAuthMethod::HashAuth { update_hash } => {
            let api_version = match &profile.provider_settings {
                ProviderSettings::AfraidDns(s) => s.api_version,
                _ => 2,
            };
            if api_version == 1 {
                format!(
                    "https://freedns.afraid.org/dynamic/update.php?{}&address={}",
                    update_hash, ip
                )
            } else {
                format!(
                    "https://sync.afraid.org/u/{}/?address={}",
                    update_hash, ip
                )
            }
        }
        DdnsAuthMethod::DirectUrl { update_url } => {
            if update_url.contains("address=") || update_url.contains("ip=") {
                update_url.clone()
            } else if update_url.contains('?') {
                format!("{}&address={}", update_url, ip)
            } else {
                format!("{}?address={}", update_url, ip)
            }
        }
        _ => {
            return Err("Afraid DNS requires HashAuth or DirectUrl auth".to_string());
        }
    };

    let mut cmd = tokio::process::Command::new("curl");
    cmd.args(["-s", "-m", "30", &url]);

    let output = cmd.output().await.map_err(|e| format!("curl failed: {}", e))?;
    let body = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let lower = body.to_lowercase();
    let (status, error) = if lower.contains("updated") || lower.contains("has not changed") {
        if lower.contains("has not changed") {
            (UpdateStatus::NoChange, None)
        } else {
            (UpdateStatus::Success, None)
        }
    } else if lower.contains("error") {
        (
            UpdateStatus::Failed,
            Some(format!("FreeDNS error: {}", body)),
        )
    } else {
        // Many FreeDNS responses just return the IP on success
        (UpdateStatus::Success, None)
    };

    if status == UpdateStatus::Success {
        info!("Afraid DNS: Updated {} → {}", fqdn, ip);
    }

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::AfraidDns,
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
