//! Minimal Arista eAPI (JSON-RPC over HTTP(S)) client for the cooling command.

use crate::parse::parse_cooling_json;
use crate::types::{AristaConfig, AristaCoolingReport};
use serde_json::{json, Value};
use std::time::Duration;

pub const PRIMARY_COMMAND: &str = "show system environment cooling";
pub const LEGACY_COMMAND: &str = "show environment cooling";

enum EapiError {
    /// The CLI rejected the command (eAPI error code 1002 or "invalid command").
    InvalidCommand,
    Other(String),
}

fn base_url(cfg: &AristaConfig) -> Result<String, String> {
    let host = cfg.host.trim();
    if host.is_empty() || host.contains(['/', '?', '#', '@', ' ']) {
        return Err("Invalid host".into());
    }
    let scheme = if cfg.use_https { "https" } else { "http" };
    let port = cfg.port.unwrap_or(if cfg.use_https { 443 } else { 80 });
    // Bracket bare IPv6 literals.
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    Ok(format!("{scheme}://{host}:{port}/command-api"))
}

fn build_client(cfg: &AristaConfig) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(cfg.timeout_secs.unwrap_or(15).clamp(1, 120)))
        .danger_accept_invalid_certs(cfg.insecure_tls)
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

async fn run_cmd(
    client: &reqwest::Client,
    url: &str,
    cfg: &AristaConfig,
    command: &str,
) -> Result<Value, EapiError> {
    let body = json!({
        "jsonrpc": "2.0",
        "method": "runCmds",
        "params": {"version": 1, "cmds": [command], "format": "json"},
        "id": "sorng-arista",
    });
    let resp = client
        .post(url)
        .basic_auth(&cfg.username, Some(&cfg.password))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                EapiError::Other("Request timed out".into())
            } else if e.is_connect() {
                EapiError::Other(format!(
                    "Cannot connect to eAPI (is `management api http-commands` enabled?): {e}"
                ))
            } else {
                EapiError::Other(format!("Request failed: {e}"))
            }
        })?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(EapiError::Other("Authentication failed (HTTP 401/403)".into()));
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(EapiError::Other("eAPI endpoint not found (HTTP 404)".into()));
    }
    let value: Value = resp
        .json()
        .await
        .map_err(|e| EapiError::Other(format!("Invalid eAPI response (HTTP {status}): {e}")))?;
    if let Some(err) = value.get("error") {
        let code = err.get("code").and_then(Value::as_i64);
        let msg = err.get("message").and_then(Value::as_str).unwrap_or("unknown error");
        if code == Some(1002) || msg.to_ascii_lowercase().contains("invalid command") {
            return Err(EapiError::InvalidCommand);
        }
        return Err(EapiError::Other(format!("eAPI error: {msg}")));
    }
    value
        .get("result")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .cloned()
        .ok_or_else(|| EapiError::Other("eAPI response has no result".into()))
}

/// Fetch fan data over eAPI, falling back to the pre-4.x command alias when
/// the switch rejects the primary command.
pub async fn fetch_cooling(cfg: &AristaConfig) -> Result<AristaCoolingReport, String> {
    let url = base_url(cfg)?;
    let client = build_client(cfg)?;
    match run_cmd(&client, &url, cfg, PRIMARY_COMMAND).await {
        Ok(v) => Ok(parse_cooling_json(&v, PRIMARY_COMMAND)),
        Err(EapiError::InvalidCommand) => match run_cmd(&client, &url, cfg, LEGACY_COMMAND).await {
            Ok(v) => Ok(parse_cooling_json(&v, LEGACY_COMMAND)),
            Err(EapiError::InvalidCommand) => {
                Err("The switch does not support a cooling/fan status command".into())
            }
            Err(EapiError::Other(m)) => Err(m),
        },
        Err(EapiError::Other(m)) => Err(m),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> AristaConfig {
        AristaConfig {
            host: "sw1.example".into(),
            port: None,
            username: "admin".into(),
            password: "".into(),
            use_https: true,
            insecure_tls: false,
            timeout_secs: None,
        }
    }

    #[test]
    fn url_building() {
        assert_eq!(base_url(&cfg()).unwrap(), "https://sw1.example:443/command-api");
        let mut c = cfg();
        c.use_https = false;
        c.port = Some(8080);
        assert_eq!(base_url(&c).unwrap(), "http://sw1.example:8080/command-api");
        c.host = "fe80::1".into();
        assert_eq!(base_url(&c).unwrap(), "http://[fe80::1]:8080/command-api");
        c.host = "a/b".into();
        assert!(base_url(&c).is_err());
        c.host = " ".into();
        assert!(base_url(&c).is_err());
    }
}
