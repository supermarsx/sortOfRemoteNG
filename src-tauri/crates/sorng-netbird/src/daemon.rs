//! # NetBird Daemon Management
//!
//! Detect installation, start/stop the `netbird` daemon, query version
//! and running status, manage the system service.

use serde::{Deserialize, Serialize};

/// Daemon installation information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonInfo {
    pub installed: bool,
    pub version: Option<String>,
    pub binary_path: Option<String>,
    pub config_path: Option<String>,
    pub running: bool,
    pub pid: Option<u32>,
    pub uptime_secs: Option<u64>,
    pub install_method: Option<InstallMethod>,
    pub management_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InstallMethod {
    PackageManager,
    SnapStore,
    Homebrew,
    Msi,
    Docker,
    Manual,
    Unknown,
}

/// Detect NetBird installation on the current system.
pub fn detect_installation() -> DaemonInfo {
    let paths = if cfg!(target_os = "windows") {
        vec![
            r"C:\Program Files\NetBird\netbird.exe",
            r"C:\ProgramData\NetBird\netbird.exe",
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            "/usr/local/bin/netbird",
            "/opt/homebrew/bin/netbird",
        ]
    } else {
        vec![
            "/usr/bin/netbird",
            "/usr/local/bin/netbird",
            "/snap/bin/netbird",
        ]
    };

    let binary_path = paths.iter().find(|p| std::path::Path::new(p).exists());

    let config_path = if cfg!(target_os = "windows") {
        Some(r"C:\ProgramData\NetBird\config.json".to_string())
    } else if cfg!(target_os = "macos") {
        Some("/var/lib/netbird/config.json".to_string())
    } else {
        Some("/etc/netbird/config.json".to_string())
    };

    DaemonInfo {
        installed: binary_path.is_some(),
        version: None,
        binary_path: binary_path.map(|p| p.to_string()),
        config_path,
        running: false,
        pid: None,
        uptime_secs: None,
        install_method: None,
        management_url: None,
    }
}

/// Build command to get NetBird version.
pub fn version_command() -> Vec<String> {
    vec!["netbird".to_string(), "version".to_string()]
}

/// Build command to start the NetBird service/daemon.
pub fn service_start_command() -> Vec<String> {
    if cfg!(target_os = "windows") {
        vec!["net".to_string(), "start".to_string(), "NetBird".to_string()]
    } else {
        vec!["systemctl".to_string(), "start".to_string(), "netbird".to_string()]
    }
}

/// Build command to stop the NetBird service/daemon.
pub fn service_stop_command() -> Vec<String> {
    if cfg!(target_os = "windows") {
        vec!["net".to_string(), "stop".to_string(), "NetBird".to_string()]
    } else {
        vec!["systemctl".to_string(), "stop".to_string(), "netbird".to_string()]
    }
}

/// Build command to install the NetBird service.
pub fn service_install_command() -> Vec<String> {
    vec!["netbird".to_string(), "service".to_string(), "install".to_string()]
}

/// Build command to uninstall the NetBird service.
pub fn service_uninstall_command() -> Vec<String> {
    vec!["netbird".to_string(), "service".to_string(), "uninstall".to_string()]
}

/// Build the `netbird up` command from config.
pub fn up_command(config: &super::types::NetBirdConfig) -> Vec<String> {
    let mut cmd = vec!["netbird".to_string(), "up".to_string()];

    if let Some(ref url) = config.management_url {
        cmd.push("--management-url".to_string());
        cmd.push(url.clone());
    }
    if let Some(ref key) = config.setup_key {
        cmd.push("--setup-key".to_string());
        cmd.push(key.clone());
    }
    if let Some(ref psk) = config.preshared_key {
        cmd.push("--preshared-key".to_string());
        cmd.push(psk.clone());
    }
    if let Some(port) = config.wireguard_port {
        cmd.push("--wireguard-port".to_string());
        cmd.push(port.to_string());
    }
    if let Some(ref iface) = config.interface_name {
        cmd.push("--interface-name".to_string());
        cmd.push(iface.clone());
    }
    if let Some(ref hostname) = config.hostname {
        cmd.push("--hostname".to_string());
        cmd.push(hostname.clone());
    }
    if let Some(ref level) = config.log_level {
        cmd.push("--log-level".to_string());
        cmd.push(level.clone());
    }
    if config.disable_auto_connect == Some(true) {
        cmd.push("--disable-auto-connect".to_string());
    }
    if config.disable_dns == Some(true) {
        cmd.push("--disable-dns".to_string());
    }
    if config.disable_firewall == Some(true) {
        cmd.push("--disable-firewall".to_string());
    }
    if config.rosenpass_enabled == Some(true) {
        cmd.push("--enable-rosenpass".to_string());
    }
    if config.rosenpass_permissive == Some(true) {
        cmd.push("--rosenpass-permissive".to_string());
    }

    cmd
}

/// Build the `netbird down` command.
pub fn down_command() -> Vec<String> {
    vec!["netbird".to_string(), "down".to_string()]
}

/// Build the `netbird status` command.
pub fn status_command(json: bool) -> Vec<String> {
    let mut cmd = vec!["netbird".to_string(), "status".to_string()];
    if json {
        cmd.push("--json".to_string());
    }
    cmd
}

/// Parsed status output from `netbird status --json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusJson {
    pub daemon_version: Option<String>,
    #[serde(rename = "managementStatus")]
    pub management_status: Option<ConnectionStatusJson>,
    #[serde(rename = "signalStatus")]
    pub signal_status: Option<ConnectionStatusJson>,
    #[serde(rename = "relayStatus")]
    pub relay_status: Option<ConnectionStatusJson>,
    pub ip: Option<String>,
    pub fqdn: Option<String>,
    #[serde(rename = "publicKey")]
    pub public_key: Option<String>,
    pub peers: Option<Vec<PeerStatusJson>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatusJson {
    pub url: Option<String>,
    pub connected: Option<bool>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerStatusJson {
    pub ip: Option<String>,
    #[serde(rename = "pubKey")]
    pub pub_key: Option<String>,
    pub fqdn: Option<String>,
    #[serde(rename = "connStatus")]
    pub conn_status: Option<String>,
    #[serde(rename = "connType")]
    pub conn_type: Option<String>,
    pub direct: Option<bool>,
    #[serde(rename = "lastWireguardHandshake")]
    pub last_wireguard_handshake: Option<String>,
    #[serde(rename = "transferReceived")]
    pub transfer_received: Option<u64>,
    #[serde(rename = "transferSent")]
    pub transfer_sent: Option<u64>,
    pub latency: Option<f64>,
    #[serde(rename = "rosenpassEnabled")]
    pub rosenpass_enabled: Option<bool>,
    pub routes: Option<Vec<String>>,
}

/// Parse `netbird status --json` output.
pub fn parse_status_json(json: &str) -> Result<StatusJson, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse NetBird status JSON: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_installation_returns_daemon_info() {
        let info = detect_installation();
        // Just verify it returns a valid struct; binary may or may not be installed
        assert!(info.config_path.is_some());
    }

    #[test]
    fn test_version_command() {
        let cmd = version_command();
        assert_eq!(cmd, vec!["netbird", "version"]);
    }

    #[test]
    fn test_up_command_defaults() {
        let config = super::super::types::NetBirdConfig::default();
        let cmd = up_command(&config);
        assert_eq!(cmd, vec!["netbird", "up"]);
    }

    #[test]
    fn test_up_command_with_options() {
        let config = super::super::types::NetBirdConfig {
            management_url: Some("https://mgmt.example.com".into()),
            setup_key: Some("AAAA-BBBB-CCCC".into()),
            wireguard_port: Some(51820),
            hostname: Some("myhost".into()),
            disable_dns: Some(true),
            rosenpass_enabled: Some(true),
            ..Default::default()
        };
        let cmd = up_command(&config);
        assert!(cmd.contains(&"--management-url".to_string()));
        assert!(cmd.contains(&"https://mgmt.example.com".to_string()));
        assert!(cmd.contains(&"--setup-key".to_string()));
        assert!(cmd.contains(&"--wireguard-port".to_string()));
        assert!(cmd.contains(&"51820".to_string()));
        assert!(cmd.contains(&"--hostname".to_string()));
        assert!(cmd.contains(&"--disable-dns".to_string()));
        assert!(cmd.contains(&"--enable-rosenpass".to_string()));
    }

    #[test]
    fn test_status_command_json_flag() {
        let cmd = status_command(true);
        assert!(cmd.contains(&"--json".to_string()));
        let cmd2 = status_command(false);
        assert!(!cmd2.contains(&"--json".to_string()));
    }

    #[test]
    fn test_parse_status_json_valid() {
        let json = r#"{
            "daemon_version": "0.28.0",
            "managementStatus": {"url": "https://api.netbird.io:443", "connected": true},
            "signalStatus": {"url": "wss://signal.netbird.io:443", "connected": true},
            "relayStatus": {"url": "rels://turn.netbird.io:443", "connected": true},
            "ip": "100.64.0.1/16",
            "fqdn": "myhost.netbird.cloud",
            "publicKey": "abc123==",
            "peers": []
        }"#;
        let status = parse_status_json(json).unwrap();
        assert_eq!(status.daemon_version.as_deref(), Some("0.28.0"));
        assert_eq!(status.ip.as_deref(), Some("100.64.0.1/16"));
    }

    #[test]
    fn test_parse_status_json_invalid() {
        let result = parse_status_json("not json");
        assert!(result.is_err());
    }
}
