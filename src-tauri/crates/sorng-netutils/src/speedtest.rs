//! # speedtest — Internet speed test wrapper
//!
//! Wraps Ookla, Cloudflare, and LibreSpeed CLI tools for performing
//! internet speed tests and parsing results.

use crate::types::*;
use chrono::{DateTime, Utc};

/// Build `speedtest-cli --json` arguments (Ookla).
pub fn build_ookla_args(server_id: Option<u32>) -> Vec<String> {
    let mut args = vec![
        "--format=json".to_string(),
        "--accept-gdpr".to_string(),
        "--accept-license".to_string(),
    ];
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
pub fn parse_ookla_json(json: &str) -> Option<SpeedtestResult> {
    let root: serde_json::Value = serde_json::from_str(json).ok()?;

    let server = root.get("server")?;
    let server_name = server.get("name")?.as_str()?.to_string();
    let server_location = server
        .get("location")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let server_id = server.get("id").and_then(|v| v.as_u64().map(|n| n as u32));

    let ping = root.get("ping")?;
    let ping_ms = ping.get("latency").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let jitter_ms = ping.get("jitter").and_then(|v| v.as_f64());

    let download_bw = root
        .get("download")
        .and_then(|d| d.get("bandwidth"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let upload_bw = root
        .get("upload")
        .and_then(|u| u.get("bandwidth"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let download_mbps = download_bw / 125_000.0;
    let upload_mbps = upload_bw / 125_000.0;

    let isp = root.get("isp").and_then(|v| v.as_str()).map(String::from);

    let tested_at = root
        .get("timestamp")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<DateTime<Utc>>().ok())
        .unwrap_or_else(Utc::now);

    let packet_loss_pct = root.get("packetLoss").and_then(|v| v.as_f64());

    let external_ip = root
        .get("interface")
        .and_then(|i| i.get("externalIp"))
        .and_then(|v| v.as_str())
        .map(String::from);

    Some(SpeedtestResult {
        server_name,
        server_location,
        server_id,
        isp,
        download_mbps,
        upload_mbps,
        ping_ms,
        jitter_ms,
        packet_loss_pct,
        external_ip,
        tested_at,
        provider: SpeedtestProvider::Ookla,
    })
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
