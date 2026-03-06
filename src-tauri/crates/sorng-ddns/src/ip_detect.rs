//! # Public IP Detection
//!
//! Detects the public IPv4 and IPv6 addresses by querying multiple
//! upstream services with fallback, caching, and timeout handling.

use crate::types::*;
use chrono::Utc;
use log::{info, warn};
use std::time::Instant;

/// Validate that a string looks like a valid IPv4 address.
fn is_valid_ipv4(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    parts.iter().all(|p| p.parse::<u8>().is_ok())
}

/// Validate that a string looks like a valid IPv6 address.
fn is_valid_ipv6(s: &str) -> bool {
    // Basic IPv6 validation: contains colons and no spaces
    s.contains(':') && !s.contains(' ') && s.len() >= 2 && s.len() <= 45
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
                    if !is_valid_ipv6(&ip) {
                        warn!(
                            "IP service {} returned invalid IPv6: {}",
                            service.label(),
                            ip
                        );
                        last_error = format!("Invalid IPv6 from {}: {}", service.label(), ip);
                        continue;
                    }
                    info!("Detected IPv6 {} from {} in {}ms", ip, service.label(), latency);
                    return Ok(IpDetectResult {
                        ipv4: None,
                        ipv6: Some(ip),
                        source: service.label(),
                        detected_at: Utc::now().to_rfc3339(),
                        latency_ms: latency,
                    });
                } else {
                    if !is_valid_ipv4(&ip) {
                        warn!(
                            "IP service {} returned invalid IPv4: {}",
                            service.label(),
                            ip
                        );
                        last_error = format!("Invalid IPv4 from {}: {}", service.label(), ip);
                        continue;
                    }
                    info!("Detected IPv4 {} from {} in {}ms", ip, service.label(), latency);
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
    // Simulate HTTP request (in production, use reqwest or hyper)
    // For now, use tokio::process::Command to call curl as a fallback
    let output = tokio::process::Command::new("curl")
        .args([
            "-s",
            "-m",
            &timeout_secs.to_string(),
            "--connect-timeout",
            "5",
            "-L",
            url,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to execute curl: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("HTTP request failed: {}", stderr.trim()));
    }

    let body = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if body.is_empty() {
        return Err("Empty response".to_string());
    }

    Ok(body)
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

    let (ipv4, ipv6) = if is_valid_ipv6(&ip) {
        (None, Some(ip))
    } else if is_valid_ipv4(&ip) {
        (Some(ip), None)
    } else {
        return Err(format!("Invalid IP address: {}", ip));
    };

    Ok(IpDetectResult {
        ipv4,
        ipv6,
        source: format!("Custom ({})", url),
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
