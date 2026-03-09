//! # Tailscale Funnel
//!
//! Configure public HTTPS ingress via Tailscale Funnel. Manage ports,
//! backends, TLS certificates, and Funnel policies.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Funnel status for the local node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunnelStatus {
    pub enabled: bool,
    pub available: bool,
    pub reason_unavailable: Option<String>,
    pub services: Vec<FunnelService>,
    pub allowed_ports: Vec<u16>,
    pub tls_domains: Vec<String>,
}

/// A single Funnel service entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunnelService {
    pub port: u16,
    pub protocol: FunnelProtocol,
    pub backend: FunnelBackend,
    pub public_url: String,
    pub tls_termination: TlsTermination,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FunnelProtocol {
    Https,
    Tcp,
    Tls,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FunnelBackend {
    /// Proxy to a local port.
    Proxy { addr: String },
    /// Serve static files.
    FileServer { path: String },
    /// Serve a static text response.
    Text { content: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TlsTermination {
    /// Tailscale terminates TLS.
    Tailscale,
    /// Passthrough TLS to backend.
    Passthrough,
}

/// Build the funnel enable command.
pub fn funnel_command(port: u16, backend: &FunnelBackend, bg: bool) -> Vec<String> {
    let mut cmd = vec!["tailscale".to_string(), "funnel".to_string()];

    if bg {
        cmd.push("--bg".to_string());
    }

    match backend {
        FunnelBackend::Proxy { addr } => {
            cmd.push(format!("{}:{}", addr, port));
        }
        FunnelBackend::FileServer { path } => {
            cmd.push("--serve-path".to_string());
            cmd.push(path.clone());
            cmd.push(format!("{}", port));
        }
        FunnelBackend::Text { content } => {
            cmd.push("--serve-text".to_string());
            cmd.push(content.clone());
            cmd.push(format!("{}", port));
        }
    }

    cmd
}

/// Build funnel off command.
pub fn funnel_off_command(port: Option<u16>) -> Vec<String> {
    let mut cmd = vec![
        "tailscale".to_string(),
        "funnel".to_string(),
        "off".to_string(),
    ];
    if let Some(p) = port {
        cmd.push(format!("{}", p));
    }
    cmd
}

/// Build funnel status command.
pub fn funnel_status_command() -> Vec<String> {
    vec![
        "tailscale".to_string(),
        "funnel".to_string(),
        "status".to_string(),
        "--json".to_string(),
    ]
}

/// Parse funnel/serve configuration from `tailscale serve status --json`.
pub fn parse_serve_config(json: &str) -> Result<ServeStatusJson, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse serve config: {}", e))
}

/// Parsed serve/funnel status JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ServeStatusJson {
    #[serde(rename = "TCP")]
    pub tcp: Option<HashMap<String, TcpEntry>>,
    pub web: Option<HashMap<String, WebEntry>>,
    pub allow_funnel: Option<HashMap<String, bool>>,
    pub foreground_procs: Option<HashMap<String, ForegroundProc>>,
    pub errors: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct TcpEntry {
    #[serde(rename = "TCPForward")]
    pub tcp_forward: Option<String>,
    pub terminate_tls: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct WebEntry {
    pub handlers: Option<HashMap<String, WebHandler>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct WebHandler {
    pub proxy: Option<String>,
    pub path: Option<String>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForegroundProc {
    pub port: Option<u16>,
    pub addr: Option<String>,
    pub pid: Option<u32>,
}

/// Build the public URL for a funnel service.
pub fn funnel_public_url(dns_name: &str, port: u16) -> String {
    if port == 443 {
        format!("https://{}", dns_name)
    } else {
        format!("https://{}:{}", dns_name, port)
    }
}

/// Check if Funnel is available (requires HTTPS, cert domains, ACL permission).
pub fn check_funnel_availability(
    cert_domains: &[String],
    has_https_capability: bool,
    backend_state: &str,
) -> Result<(), String> {
    if backend_state != "Running" {
        return Err("Tailscale is not running".to_string());
    }
    if !has_https_capability {
        return Err("HTTPS capability not available; check node attributes".to_string());
    }
    if cert_domains.is_empty() {
        return Err("No certificate domains available; ensure MagicDNS is enabled".to_string());
    }
    Ok(())
}

/// Validate a Funnel backend configuration.
pub fn validate_funnel_backend(backend: &FunnelBackend) -> Result<(), String> {
    match backend {
        FunnelBackend::Proxy { addr } => {
            if addr.is_empty() {
                return Err("Proxy address cannot be empty".to_string());
            }
            // Check format: host:port or just port
            if !addr.contains(':') && addr.parse::<u16>().is_err() {
                return Err(format!("Invalid proxy address: {}", addr));
            }
            Ok(())
        }
        FunnelBackend::FileServer { path } => {
            if path.is_empty() {
                return Err("File server path cannot be empty".to_string());
            }
            Ok(())
        }
        FunnelBackend::Text { content } => {
            if content.is_empty() {
                return Err("Text content cannot be empty".to_string());
            }
            Ok(())
        }
    }
}
