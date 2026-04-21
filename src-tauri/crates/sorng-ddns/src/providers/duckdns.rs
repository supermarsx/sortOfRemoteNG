//! # DuckDNS Provider
//!
//! Token-based subdomain updates via `https://www.duckdns.org/update`.

use crate::types::*;
use chrono::Utc;
use log::info;
use std::time::Instant;

/// Update a DuckDNS subdomain.
pub async fn update(
    profile: &DdnsProfile,
    ip: &str,
    ipv6: Option<&str>,
) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let subdomain = &profile.hostname;

    let token = match &profile.auth {
        DdnsAuthMethod::ApiToken { token } => token.clone(),
        _ => return Err("DuckDNS requires an API token".to_string()),
    };

    let (clear_txt, txt_value) = match &profile.provider_settings {
        ProviderSettings::DuckDns(s) => (s.clear_txt, s.txt_value.clone()),
        _ => (false, None),
    };

    let mut url = format!(
        "https://www.duckdns.org/update?domains={}&token={}&ip={}",
        subdomain, token, ip
    );

    if let Some(v6) = ipv6 {
        url.push_str(&format!("&ipv6={}", v6));
    }

    if let Some(ref txt) = txt_value {
        url.push_str(&format!("&txt={}", txt));
    }

    if clear_txt {
        url.push_str("&clear=true");
    }

    let mut cmd = tokio::process::Command::new("curl");
    cmd.args(["-s", "-m", "30", &url]);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("curl failed: {}", e))?;
    let body = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let (status, error) = if body == "OK" {
        (UpdateStatus::Success, None)
    } else if body == "KO" {
        (
            UpdateStatus::Failed,
            Some("DuckDNS returned KO — check token and subdomain".to_string()),
        )
    } else {
        (
            UpdateStatus::UnexpectedResponse,
            Some(format!("Unexpected response: {}", body)),
        )
    };

    let fqdn = format!("{}.duckdns.org", subdomain);

    if status == UpdateStatus::Success {
        info!("DuckDNS: Updated {} → {}", fqdn, ip);
    }

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::DuckDns,
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
