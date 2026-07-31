//! # Namecheap DDNS Provider
//!
//! Updates via Namecheap Dynamic DNS HTTP API.
//! `https://dynamicdns.park-your-domain.com/update?host=...&domain=...&password=...&ip=...`

use super::http;
use crate::types::*;
use chrono::Utc;
use log::info;
use reqwest::Method;
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
        let mut url = http::parse_url("https://dynamicdns.park-your-domain.com/update", true)?;
        url.query_pairs_mut()
            .append_pair("host", host)
            .append_pair("domain", &format!("{}.{}", sld, tld))
            .append_pair("password", &password)
            .append_pair("ip", ip);
        let body = http::send(http::request(Method::GET, url.as_str(), true)?)
            .await?
            .body;

        // Namecheap returns XML; check for <ErrCount>0</ErrCount>
        let success = body.contains("<ErrCount>0</ErrCount>");
        results.push((host.clone(), success));
    }

    let all_ok = results.iter().all(|(_, ok)| *ok);
    let first_host = hosts.first().map(String::as_str).unwrap_or("@");
    let fqdn = format!("{}.{}", first_host, profile.domain);

    let (status, error) = if all_ok {
        info!("Namecheap: Updated {}.{} → {}", sld, tld, ip);
        (UpdateStatus::Success, None)
    } else {
        let errs: Vec<String> = results
            .iter()
            .filter(|(_, ok)| !*ok)
            .map(|(h, _)| format!("Host {}: provider rejected the update", h))
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
                .map(|(h, ok)| {
                    format!("{}: {}", h, if *ok { "updated" } else { "update rejected" })
                })
                .collect::<Vec<_>>()
                .join("\n"),
        ),
        error,
        timestamp: Utc::now().to_rfc3339(),
        latency_ms: start.elapsed().as_millis() as u64,
    })
}
