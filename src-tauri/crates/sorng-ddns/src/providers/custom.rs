//! # Custom DDNS Provider
//!
//! Supports arbitrary URL templates with placeholder substitution.

use super::http;
use crate::types::*;
use chrono::Utc;
use log::info;
use std::time::Instant;

/// Update using a custom URL template.
pub async fn update(
    profile: &DdnsProfile,
    ip: &str,
    ipv6: Option<&str>,
) -> Result<DdnsUpdateResult, String> {
    let start = Instant::now();
    let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
        profile.domain.clone()
    } else {
        format!("{}.{}", profile.hostname, profile.domain)
    };

    let settings = match &profile.provider_settings {
        ProviderSettings::Custom(s) => s.clone(),
        _ => {
            return Err("Custom provider requires CustomProviderSettings".to_string());
        }
    };

    // Extract username/password if available
    let (username, password) = match &profile.auth {
        DdnsAuthMethod::Basic { username, password } => (username.clone(), password.clone()),
        _ => (String::new(), String::new()),
    };

    // Substitute placeholders in URL
    let url = settings
        .url_template
        .replace("{ip}", ip)
        .replace("{ipv4}", ip)
        .replace("{ipv6}", ipv6.unwrap_or(""))
        .replace("{hostname}", &profile.hostname)
        .replace("{domain}", &profile.domain)
        .replace("{fqdn}", &fqdn)
        .replace("{username}", &username)
        .replace("{password}", &password);

    let method = http::method(&settings.method)?;
    let mut request = http::request(method, &url, true)?;

    // Auth headers
    match &profile.auth {
        DdnsAuthMethod::Basic { username, password } => {
            request = request.basic_auth(username, Some(password));
        }
        DdnsAuthMethod::ApiToken { token } => {
            request = request.bearer_auth(token);
        }
        DdnsAuthMethod::CustomHeaders { headers } => {
            for (k, v) in headers {
                request = http::header(request, k, v)?;
            }
        }
        _ => {}
    }

    // Extra headers
    for (k, v) in &settings.extra_headers {
        request = http::header(request, k, v)?;
    }

    // Content-Type
    if let Some(ref ct) = settings.content_type {
        request = http::header(request, "Content-Type", ct)?;
    }

    // Body
    if let Some(ref body_template) = settings.body_template {
        let body = body_template
            .replace("{ip}", ip)
            .replace("{ipv4}", ip)
            .replace("{ipv6}", ipv6.unwrap_or(""))
            .replace("{hostname}", &profile.hostname)
            .replace("{domain}", &profile.domain)
            .replace("{fqdn}", &fqdn);
        request = request.body(body);
    }

    let response = http::send_allow_error(request).await?;
    let http_status = response.status;
    let body = response.body;

    let (status, error) = if http_status.is_success() {
        if let Some(ref match_str) = settings.success_match {
            if body.contains(match_str) {
                info!("Custom DDNS: Updated {} → {}", fqdn, ip);
                (UpdateStatus::Success, None)
            } else {
                (
                    UpdateStatus::Failed,
                    Some(format!(
                        "Response did not contain expected '{}': {}",
                        match_str, body
                    )),
                )
            }
        } else {
            info!("Custom DDNS: Updated {} → {} (HTTP success)", fqdn, ip);
            (UpdateStatus::Success, None)
        }
    } else {
        (
            UpdateStatus::Failed,
            Some(format!("HTTP {}: {}", http_status.as_u16(), body)),
        )
    };

    Ok(DdnsUpdateResult {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: DdnsProvider::Custom,
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
