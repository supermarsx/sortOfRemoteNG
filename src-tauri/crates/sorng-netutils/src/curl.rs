//! # curl — HTTP timing and diagnostics wrapper
//!
//! Wraps `curl` for HTTP/HTTPS timing measurements, header
//! inspection, TLS certificate info, and redirect following.

use crate::types::*;
use std::collections::HashMap;

/// Build curl arguments for HTTP timing.
pub fn build_timing_args(url: &str, follow_redirects: bool, insecure: bool) -> Vec<String> {
    let mut args = vec![
        "-w".to_string(),
        r#"{"dns_lookup_ms":%{time_namelookup},"tcp_connect_ms":%{time_connect},"tls_handshake_ms":%{time_appconnect},"ttfb_ms":%{time_starttransfer},"total_ms":%{time_total},"http_code":%{http_code},"size_download":%{size_download},"speed_download":%{speed_download}}"#.to_string(),
        "-o".to_string(), "/dev/null".to_string(),
        "-s".to_string(),
    ];
    if follow_redirects {
        args.push("-L".to_string());
    }
    if insecure {
        args.push("-k".to_string());
    }
    args.push(url.to_string());
    args
}

/// Build curl arguments for fetching headers only.
pub fn build_head_args(url: &str) -> Vec<String> {
    vec!["-I".to_string(), "-s".to_string(), url.to_string()]
}

/// Build curl arguments for verbose TLS info.
pub fn build_tls_info_args(url: &str) -> Vec<String> {
    vec![
        "-v".to_string(),
        "--head".to_string(),
        "-s".to_string(),
        "-o".to_string(),
        "/dev/null".to_string(),
        url.to_string(),
    ]
}

/// Parse curl timing JSON output into `HttpTiming`.
pub fn parse_timing_json(json: &str) -> Option<HttpTiming> {
    let root: serde_json::Value = serde_json::from_str(json).ok()?;

    // curl outputs times in seconds; multiply by 1000 for ms
    let dns_lookup_ms = root.get("dns_lookup_ms")?.as_f64()? * 1000.0;
    let tcp_connect_ms = root.get("tcp_connect_ms")?.as_f64()? * 1000.0;
    let tls_handshake_ms = root.get("tls_handshake_ms")?.as_f64()? * 1000.0;
    let ttfb_ms = root.get("ttfb_ms")?.as_f64()? * 1000.0;
    let total_ms = root.get("total_ms")?.as_f64()? * 1000.0;
    let http_code = root.get("http_code")?.as_u64()? as u16;
    let size_download = root.get("size_download")?.as_u64()?;
    let speed_download = root.get("speed_download")?.as_f64()?;

    Some(HttpTiming {
        url: String::new(),
        http_code,
        dns_lookup_ms,
        tcp_connect_ms,
        tls_handshake_ms,
        time_to_first_byte_ms: ttfb_ms,
        total_time_ms: total_ms,
        redirect_time_ms: 0.0,
        redirect_count: 0,
        download_size_bytes: size_download,
        upload_size_bytes: 0,
        speed_download_bps: speed_download,
        speed_upload_bps: 0.0,
        ssl_verify_result: None,
        effective_url: String::new(),
        content_type: None,
        ip_address: None,
        port: None,
        tls_version: None,
        headers: HashMap::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timing_args() {
        let args = build_timing_args("https://example.com", true, false);
        assert!(args.contains(&"-w".to_string()));
        assert!(args.contains(&"-L".to_string()));
        assert!(!args.contains(&"-k".to_string()));
    }

    #[test]
    fn head_args() {
        let args = build_head_args("https://example.com");
        assert!(args.contains(&"-I".to_string()));
    }
}
