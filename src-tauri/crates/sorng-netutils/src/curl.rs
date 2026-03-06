//! # curl — HTTP timing and diagnostics wrapper
//!
//! Wraps `curl` for HTTP/HTTPS timing measurements, header
//! inspection, TLS certificate info, and redirect following.

use crate::types::*;

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
        "-v".to_string(), "--head".to_string(),
        "-s".to_string(), "-o".to_string(), "/dev/null".to_string(),
        url.to_string(),
    ]
}

/// Parse curl timing JSON output into `HttpTiming`.
pub fn parse_timing_json(_json: &str) -> Option<HttpTiming> {
    // TODO: implement
    None
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
