//! # Tailscale Daemon Management
//!
//! Start/stop the tailscaled daemon, check version, detect installation,
//! manage the system service.

use serde::{Deserialize, Serialize};

/// Daemon installation info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonInfo {
    pub installed: bool,
    pub version: Option<String>,
    pub binary_path: Option<String>,
    pub daemon_path: Option<String>,
    pub running: bool,
    pub pid: Option<u32>,
    pub uptime_secs: Option<u64>,
    pub install_method: Option<InstallMethod>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InstallMethod {
    PackageManager,
    Standalone,
    AppStore,
    Msi,
    Unknown,
}

/// Detect Tailscale installation on the system.
pub fn detect_installation() -> DaemonInfo {
    // Check common paths
    let paths = if cfg!(target_os = "windows") {
        vec![
            r"C:\Program Files\Tailscale\tailscale.exe",
            r"C:\Program Files (x86)\Tailscale\tailscale.exe",
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            "/usr/local/bin/tailscale",
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        ]
    } else {
        vec![
            "/usr/bin/tailscale",
            "/usr/sbin/tailscale",
            "/usr/local/bin/tailscale",
        ]
    };

    let binary_path = paths.iter().find(|p| std::path::Path::new(p).exists());

    DaemonInfo {
        installed: binary_path.is_some(),
        version: None, // filled by get_version()
        binary_path: binary_path.map(|p| p.to_string()),
        daemon_path: None, // filled by detect_daemon_binary()
        running: false,    // filled by is_running()
        pid: None,
        uptime_secs: None,
        install_method: None, // detected from path/registry
    }
}

/// Get the tailscale CLI version string.
pub fn get_version_command() -> Vec<String> {
    vec!["tailscale".to_string(), "version".to_string()]
}

/// Build command to start tailscaled.
pub fn start_daemon_command(state_dir: Option<&str>, socket: Option<&str>) -> Vec<String> {
    let mut cmd = vec!["tailscaled".to_string()];
    if let Some(dir) = state_dir {
        cmd.push("--state".to_string());
        cmd.push(dir.to_string());
    }
    if let Some(sock) = socket {
        cmd.push("--socket".to_string());
        cmd.push(sock.to_string());
    }
    cmd
}

/// Build command to stop tailscaled.
pub fn stop_daemon_command() -> Vec<String> {
    if cfg!(target_os = "windows") {
        vec![
            "net".to_string(),
            "stop".to_string(),
            "Tailscale".to_string(),
        ]
    } else {
        vec![
            "systemctl".to_string(),
            "stop".to_string(),
            "tailscaled".to_string(),
        ]
    }
}

/// Build command to check daemon status.
pub fn status_command(json: bool) -> Vec<String> {
    let mut cmd = vec!["tailscale".to_string(), "status".to_string()];
    if json {
        cmd.push("--json".to_string());
    }
    cmd
}

/// Parse `tailscale status --json` output.
pub fn parse_status_json(json: &str) -> Result<TailscaleStatusJson, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse status JSON: {}", e))
}

/// Parsed tailscale status JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct TailscaleStatusJson {
    pub backend_state: Option<String>,
    pub auth_url: Option<String>,
    pub tailscale_ips: Option<Vec<String>>,
    pub self_info: Option<SelfInfo>,
    pub peer: Option<std::collections::HashMap<String, PeerJson>>,
    pub current_tailnet: Option<CurrentTailnet>,
    pub health: Option<Vec<String>>,
    pub magic_dns_suffix: Option<String>,
    pub cert_domains: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct SelfInfo {
    pub id: Option<String>,
    pub public_key: Option<String>,
    pub host_name: Option<String>,
    #[serde(rename = "DNSName")]
    pub dns_name: Option<String>,
    pub os: Option<String>,
    pub tailscale_ips: Option<Vec<String>>,
    pub online: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct PeerJson {
    pub id: Option<String>,
    pub public_key: Option<String>,
    pub host_name: Option<String>,
    #[serde(rename = "DNSName")]
    pub dns_name: Option<String>,
    pub os: Option<String>,
    pub tailscale_ips: Option<Vec<String>>,
    pub allowed_ips: Option<Vec<String>>,
    pub addrs: Option<Vec<String>>,
    pub cur_addr: Option<String>,
    pub relay: Option<String>,
    pub rx_bytes: Option<u64>,
    pub tx_bytes: Option<u64>,
    pub online: Option<bool>,
    pub exit_node: Option<bool>,
    pub exit_node_option: Option<bool>,
    pub active: Option<bool>,
    pub tags: Option<Vec<String>>,
    #[serde(rename = "SSHHostKeys")]
    pub ssh_host_keys: Option<Vec<String>>,
    pub in_network_map: Option<bool>,
    pub in_magic_sock: Option<bool>,
    pub in_engine: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct CurrentTailnet {
    pub name: Option<String>,
    pub magic_dns_suffix: Option<String>,
    pub magic_dns_enabled: Option<bool>,
}
