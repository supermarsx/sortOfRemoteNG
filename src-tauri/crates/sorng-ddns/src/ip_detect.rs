//! # Public IP Detection
//!
//! Detects the public IPv4 and IPv6 addresses by querying multiple
//! upstream services with fallback, caching, and timeout handling.

use crate::types::*;
use chrono::Utc;
use log::{info, warn};
use std::net::IpAddr;
use std::time::{Duration, Instant};

const MAX_IP_RESPONSE_BYTES: usize = 4 * 1024;

/// Validate that a string looks like a valid IPv4 address.
fn is_valid_ipv4(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    parts.iter().all(|p| p.parse::<u8>().is_ok())
}

/// Validate that a string looks like a valid IPv6 address.
///
/// Rejects zone identifiers (`%scope`) — the DDNS surface treats them
/// as not-ideal because most DDNS providers strip them, and a record
/// that round-trips differently on the wire than what the user typed
/// is a footgun. Strings carrying `%` should be normalised to the
/// bare address before reaching this validator.
fn is_valid_ipv6(s: &str) -> bool {
    s.contains(':') && !s.contains(' ') && !s.contains('%') && s.len() >= 2 && s.len() <= 45
}

/// Detect the public IP address using a list of services (with fallback).
pub async fn detect_public_ip(
    services: &[IpDetectService],
    ipv6: bool,
    timeout_secs: u64,
) -> Result<IpDetectResult, String> {
    let mut last_error = String::from("No IP detection services configured");

    for service in services {
        let url = service.url(ipv6);
        let start = Instant::now();

        match fetch_ip_from_url(url, timeout_secs).await {
            Ok(ip) => {
                let ip = ip.trim().to_string();
                let latency = start.elapsed().as_millis() as u64;

                // Validate the response
                if ipv6 {
                    if !is_valid_ipv6(&ip)
                        || ip
                            .parse::<IpAddr>()
                            .map(|address| {
                                !matches!(address, IpAddr::V6(_)) || !is_public_ip(address)
                            })
                            .unwrap_or(true)
                    {
                        warn!("IP service {} returned invalid IPv6", service.label());
                        last_error = format!("Invalid IPv6 response from {}", service.label());
                        continue;
                    }
                    info!(
                        "Detected a public IPv6 address from {} in {}ms",
                        service.label(),
                        latency
                    );
                    return Ok(IpDetectResult {
                        ipv4: None,
                        ipv6: Some(ip),
                        source: service.label(),
                        detected_at: Utc::now().to_rfc3339(),
                        latency_ms: latency,
                    });
                } else {
                    if !is_valid_ipv4(&ip)
                        || ip
                            .parse::<IpAddr>()
                            .map(|address| {
                                !matches!(address, IpAddr::V4(_)) || !is_public_ip(address)
                            })
                            .unwrap_or(true)
                    {
                        warn!("IP service {} returned invalid IPv4", service.label());
                        last_error = format!("Invalid IPv4 response from {}", service.label());
                        continue;
                    }
                    info!(
                        "Detected a public IPv4 address from {} in {}ms",
                        service.label(),
                        latency
                    );
                    return Ok(IpDetectResult {
                        ipv4: Some(ip),
                        ipv6: None,
                        source: service.label(),
                        detected_at: Utc::now().to_rfc3339(),
                        latency_ms: latency,
                    });
                }
            }
            Err(e) => {
                warn!("IP detection from {} failed: {}", service.label(), e);
                last_error = format!("{}: {}", service.label(), e);
                continue;
            }
        }
    }

    Err(format!(
        "All IP detection services failed. Last error: {}",
        last_error
    ))
}

/// Detect both IPv4 and IPv6 addresses.
pub async fn detect_dual_stack(
    services: &[IpDetectService],
    timeout_secs: u64,
) -> (Option<IpDetectResult>, Option<IpDetectResult>) {
    let ipv4_result = detect_public_ip(services, false, timeout_secs).await.ok();
    let ipv6_result = detect_public_ip(services, true, timeout_secs).await.ok();
    (ipv4_result, ipv6_result)
}

/// Fetch a raw IP string from a URL.
async fn fetch_ip_from_url(url: &str, timeout_secs: u64) -> Result<String, String> {
    let endpoint = validate_ip_endpoint(url)?;
    let timeout = Duration::from_secs(timeout_secs.clamp(1, 120));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(timeout.as_secs().min(5)))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("SortOfRemoteNG-DDNS/1")
        .build()
        .map_err(|_| "Failed to initialize IP detection client".to_string())?;

    let mut response = client
        .get(endpoint)
        .header(reqwest::header::ACCEPT, "text/plain")
        .send()
        .await
        .map_err(|_| "IP detection request failed".to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "IP detection service returned HTTP {}",
            response.status()
        ));
    }

    if response
        .content_length()
        .is_some_and(|length| length > MAX_IP_RESPONSE_BYTES as u64)
    {
        return Err("IP detection response exceeded the 4 KiB limit".to_string());
    }

    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or(64)
            .min(MAX_IP_RESPONSE_BYTES as u64) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Failed to read IP detection response".to_string())?
    {
        if body.len().saturating_add(chunk.len()) > MAX_IP_RESPONSE_BYTES {
            return Err("IP detection response exceeded the 4 KiB limit".to_string());
        }
        body.extend_from_slice(&chunk);
    }

    let body = String::from_utf8(body)
        .map_err(|_| "IP detection response was not valid UTF-8".to_string())?
        .trim()
        .to_string();
    if body.is_empty() {
        return Err("Empty response".to_string());
    }

    Ok(body)
}

fn validate_ip_endpoint(url: &str) -> Result<reqwest::Url, String> {
    let endpoint = reqwest::Url::parse(url).map_err(|_| "Invalid IP detection URL".to_string())?;
    if endpoint.scheme() != "https" {
        return Err("IP detection requires an HTTPS endpoint".to_string());
    }
    if !endpoint.username().is_empty() || endpoint.password().is_some() {
        return Err("IP detection URL must not contain credentials".to_string());
    }

    let host = endpoint
        .host_str()
        .ok_or_else(|| "IP detection URL has no host".to_string())?;
    if let Ok(address) = host.parse::<IpAddr>() {
        if !is_public_ip(address) {
            return Err("IP detection URL must use a public host".to_string());
        }
    } else {
        let domain = host.trim_end_matches('.').to_ascii_lowercase();
        if domain == "localhost" || domain.ends_with(".localhost") || domain.ends_with(".local") {
            return Err("IP detection URL must use a public host".to_string());
        }
    }

    Ok(endpoint)
}

fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            !address.is_private()
                && !address.is_loopback()
                && !address.is_link_local()
                && !address.is_broadcast()
                && !address.is_documentation()
                && !address.is_unspecified()
                && !address.is_multicast()
        }
        IpAddr::V6(address) => {
            !address.is_loopback()
                && !address.is_unique_local()
                && !address.is_unicast_link_local()
                && !address.is_unspecified()
                && !address.is_multicast()
        }
    }
}

/// Fetch public IP using a custom URL.
pub async fn detect_from_custom_url(
    url: &str,
    timeout_secs: u64,
) -> Result<IpDetectResult, String> {
    let start = Instant::now();
    let ip = fetch_ip_from_url(url, timeout_secs).await?;
    let ip = ip.trim().to_string();
    let latency = start.elapsed().as_millis() as u64;

    let parsed = ip
        .parse::<IpAddr>()
        .map_err(|_| "IP detection endpoint returned an invalid address".to_string())?;
    if !is_public_ip(parsed) {
        return Err("IP detection endpoint returned a non-public address".to_string());
    }

    let (ipv4, ipv6) = if is_valid_ipv6(&ip) && matches!(parsed, IpAddr::V6(_)) {
        (None, Some(ip))
    } else if is_valid_ipv4(&ip) && matches!(parsed, IpAddr::V4(_)) {
        (Some(ip), None)
    } else {
        return Err("IP detection endpoint returned an invalid address".to_string());
    };

    Ok(IpDetectResult {
        ipv4,
        ipv6,
        source: "Custom URL".to_string(),
        detected_at: Utc::now().to_rfc3339(),
        latency_ms: latency,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ipv4_validation() {
        assert!(is_valid_ipv4("1.2.3.4"));
        assert!(is_valid_ipv4("192.168.1.1"));
        assert!(is_valid_ipv4("255.255.255.255"));
        assert!(!is_valid_ipv4("256.1.1.1"));
        assert!(!is_valid_ipv4("abc"));
        assert!(!is_valid_ipv4("1.2.3"));
        assert!(!is_valid_ipv4(""));
    }

    #[test]
    fn test_ipv6_validation() {
        assert!(is_valid_ipv6("::1"));
        assert!(is_valid_ipv6("2001:db8::1"));
        assert!(is_valid_ipv6("fe80::1%eth0") == false); // '%' not ideal
        assert!(!is_valid_ipv6("192.168.1.1"));
        assert!(!is_valid_ipv6(""));
    }

    #[test]
    fn test_ip_detect_service_urls() {
        let svc = IpDetectService::Ipify;
        assert_eq!(svc.url(false), "https://api.ipify.org");
        assert_eq!(svc.url(true), "https://api6.ipify.org");

        let svc2 = IpDetectService::Icanhazip;
        assert_eq!(svc2.url(false), "https://ipv4.icanhazip.com");
        assert_eq!(svc2.url(true), "https://ipv6.icanhazip.com");
    }

    #[test]
    fn test_all_builtin_services() {
        let services = IpDetectService::all_builtin();
        assert!(services.len() >= 8);
    }
}
