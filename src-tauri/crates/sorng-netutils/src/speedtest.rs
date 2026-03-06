//! # speedtest — Internet speed test wrapper
//!
//! Wraps Ookla, Cloudflare, and LibreSpeed CLI tools for performing
//! internet speed tests and parsing results.

use crate::types::*;

/// Build `speedtest-cli --json` arguments (Ookla).
pub fn build_ookla_args(server_id: Option<u32>) -> Vec<String> {
    let mut args = vec!["--format=json".to_string(), "--accept-gdpr".to_string(), "--accept-license".to_string()];
    if let Some(id) = server_id {
        args.push(format!("--server-id={}", id));
    }
    args
}

/// Build `speed-cloudflare` arguments.
pub fn build_cloudflare_args() -> Vec<String> {
    vec!["--json".to_string()]
}

/// Parse Ookla JSON output into `SpeedtestResult`.
pub fn parse_ookla_json(_json: &str) -> Option<SpeedtestResult> {
    // TODO: implement
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ookla_default() {
        let args = build_ookla_args(None);
        assert!(args.contains(&"--format=json".to_string()));
    }

    #[test]
    fn ookla_with_server() {
        let args = build_ookla_args(Some(12345));
        assert!(args.contains(&"--server-id=12345".to_string()));
    }
}
