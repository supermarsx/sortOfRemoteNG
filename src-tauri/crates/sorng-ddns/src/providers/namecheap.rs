//! # Namecheap DDNS Provider
//!
//! Updates via Namecheap Dynamic DNS HTTP API.
//! `https://dynamicdns.park-your-domain.com/update?host=...&domain=...&password=...&ip=...`

use crate::types::*;
use chrono::Utc;
use log::info;
use std::time::Instant;

/// Update a Namecheap hostname.
pub async fn update(profile: &DdnsProfile, ip: &str) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();

    let password = match &profile.auth {
        DdnsAuthMethod::Basic { password, .. } => password.clone(),
        DdnsAuthMethod::ApiToken { token } => token.clone(),
        _ => return Err("Namecheap requires a DDNS password".to_string()),
    };

    let (sld, tld, hosts) = match &profile.provider_settings {
        ProviderSettings::Namecheap(s) => (s.sld.clone(), s.tld.clone(), s.hosts.clone()),
        _ => {
            // Auto-split domain
            let parts: Vec<&str> = profile.domain.rsplitn(2, '.').collect();
            if parts.len() < 2 {
                return Err("Cannot parse SLD/TLD from domain".to_string());
            }
            let tld = parts[0].to_string();
            let sld = parts[1].to_string();
            let host = if profile.hostname.is_empty() {
                "@".to_string()
            } else {
                profile.hostname.clone()
            };
            (sld, tld, vec![host])
        }
    };

    let mut results = Vec::new();
    for host in &hosts {
        let url = format!(
            "https://dynamicdns.park-your-domain.com/update?host={}&domain={}.{}&password={}&ip={}",
            host, sld, tld, password, ip
        );

        let mut cmd = tokio::process::Command::new("curl");
        cmd.args(["-s", "-m", "30", &url]);

        let output = cmd
            .output()
            .await
            .map_err(|e| format!("curl failed: {}", e))?;
        let body = String::from_utf8_lossy(&output.stdout).trim().to_string();

        // Namecheap returns XML; check for <ErrCount>0</ErrCount>
        let success = body.contains("<ErrCount>0</ErrCount>");
        results.push((host.clone(), success, body));
    }

    let all_ok = results.iter().all(|(_, ok, _)| *ok);
    let fqdn = format!(
        "{}.{}",
        hosts.first().unwrap_or(&"@".to_string()),
        profile.domain
    );

    let (status, error) = if all_ok {
        info!("Namecheap: Updated {}.{} → {}", sld, tld, ip);
        (UpdateStatus::Success, None)
    } else {
        let errs: Vec<String> = results
            .iter()
            .filter(|(_, ok, _)| !*ok)
            .map(|(h, _, body)| format!("Host {}: {}", h, body))
            .collect();
        (UpdateStatus::Failed, Some(errs.join("; ")))
    };

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::Namecheap,
        status,
        ip_sent: Some(ip.to_string()),
        ip_previous: None,
        hostname: profile.hostname.clone(),
        fqdn,
        provider_response: Some(
            results
                .iter()
                .map(|(h, _, b)| format!("{}: {}", h, b))
                .collect::<Vec<_>>()
                .join("\n"),
        ),
        error,
        timestamp: Utc::now().to_rfc3339(),
        latency_ms: start.elapsed().as_millis() as u64,
    })
}
