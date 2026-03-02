//! # ZeroTier Daemon Management
//!
//! Detect installation, start/stop zerotier-one, manage authtoken,
//! version detection, service management.

use serde::{Deserialize, Serialize};

/// Daemon installation info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtDaemonInfo {
    pub installed: bool,
    pub version: Option<String>,
    pub cli_path: Option<String>,
    pub daemon_path: Option<String>,
    pub home_dir: Option<String>,
    pub running: bool,
    pub pid: Option<u32>,
    pub api_port: u16,
    pub has_authtoken: bool,
}

/// Detect ZeroTier installation.
pub fn detect_installation() -> ZtDaemonInfo {
    let cli_paths = if cfg!(target_os = "windows") {
        vec![
            r"C:\Program Files (x86)\ZeroTier\One\zerotier-cli.bat",
            r"C:\Program Files\ZeroTier\One\zerotier-cli.bat",
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            "/usr/local/bin/zerotier-cli",
            "/Library/Application Support/ZeroTier/One/zerotier-cli",
        ]
    } else {
        vec!["/usr/sbin/zerotier-cli", "/usr/bin/zerotier-cli"]
    };

    let cli_path = cli_paths
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .map(|p| p.to_string());

    let home_dir = default_home_dir();
    let has_authtoken = home_dir
        .as_ref()
        .map(|dir| std::path::Path::new(&format!("{}/authtoken.secret", dir)).exists())
        .unwrap_or(false);

    ZtDaemonInfo {
        installed: cli_path.is_some(),
        version: None,
        cli_path,
        daemon_path: None,
        home_dir,
        running: false, // filled by status check
        pid: None,
        api_port: 9993,
        has_authtoken,
    }
}

/// Default ZeroTier home directory path.
pub fn default_home_dir() -> Option<String> {
    if cfg!(target_os = "windows") {
        Some(r"C:\ProgramData\ZeroTier\One".to_string())
    } else if cfg!(target_os = "macos") {
        Some("/Library/Application Support/ZeroTier/One".to_string())
    } else {
        Some("/var/lib/zerotier-one".to_string())
    }
}

/// Build version command.
pub fn version_command() -> Vec<String> {
    vec!["zerotier-cli".to_string(), "-v".to_string()]
}

/// Build info/status command.
pub fn info_command() -> Vec<String> {
    vec!["zerotier-cli".to_string(), "info".to_string(), "-j".to_string()]
}

/// Build command to join a network.
pub fn join_command(network_id: &str, allow_managed: bool, allow_global: bool, allow_default: bool, allow_dns: bool) -> Vec<String> {
    let mut cmd = vec!["zerotier-cli".to_string(), "join".to_string(), network_id.to_string()];
    if allow_managed {
        cmd.push("allowManaged=1".to_string());
    }
    if allow_global {
        cmd.push("allowGlobal=1".to_string());
    }
    if allow_default {
        cmd.push("allowDefault=1".to_string());
    }
    if allow_dns {
        cmd.push("allowDNS=1".to_string());
    }
    cmd
}

/// Build command to leave a network.
pub fn leave_command(network_id: &str) -> Vec<String> {
    vec![
        "zerotier-cli".to_string(),
        "leave".to_string(),
        network_id.to_string(),
    ]
}

/// Build command to list networks.
pub fn list_networks_command(json: bool) -> Vec<String> {
    let mut cmd = vec!["zerotier-cli".to_string(), "listnetworks".to_string()];
    if json {
        cmd.push("-j".to_string());
    }
    cmd
}

/// Build command to list peers.
pub fn list_peers_command(json: bool) -> Vec<String> {
    let mut cmd = vec!["zerotier-cli".to_string(), "listpeers".to_string()];
    if json {
        cmd.push("-j".to_string());
    }
    cmd
}

/// Build command to list moons.
pub fn list_moons_command() -> Vec<String> {
    vec!["zerotier-cli".to_string(), "listmoons".to_string()]
}

/// Build command to orbit a moon.
pub fn orbit_command(world_id: &str, seed_id: &str) -> Vec<String> {
    vec![
        "zerotier-cli".to_string(),
        "orbit".to_string(),
        world_id.to_string(),
        seed_id.to_string(),
    ]
}

/// Build command to deorbit a moon.
pub fn deorbit_command(world_id: &str) -> Vec<String> {
    vec![
        "zerotier-cli".to_string(),
        "deorbit".to_string(),
        world_id.to_string(),
    ]
}

/// Parse ZeroTier info JSON.
pub fn parse_info_json(json: &str) -> Result<super::types::ZtServiceStatus, String> {
    // ZeroTier info output format: { "address": "...", "publicIdentity": "...", ... }
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Failed to parse info: {}", e))?;

    Ok(super::types::ZtServiceStatus {
        address: v["address"].as_str().unwrap_or("").to_string(),
        public_identity: v["publicIdentity"].as_str().unwrap_or("").to_string(),
        online: v["online"].as_bool().unwrap_or(false),
        version: v["version"].as_str().unwrap_or("").to_string(),
        primary_port: v["config"]["settings"]["primaryPort"]
            .as_u64()
            .unwrap_or(9993) as u16,
        secondary_port: v["config"]["settings"]["secondaryPort"].as_u64().map(|p| p as u16),
        tertiary_port: v["config"]["settings"]["tertiaryPort"].as_u64().map(|p| p as u16),
        tcp_fallback_active: v["tcpFallbackActive"].as_bool().unwrap_or(false),
        relay_policy: v["config"]["settings"]["relayPolicy"]
            .as_str()
            .unwrap_or("default")
            .to_string(),
        surface_addresses: v["config"]["settings"]["surfaceAddresses"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        cluster: v["cluster"].as_str().map(|s| s.to_string()),
        clock: v["clock"].as_u64().unwrap_or(0),
        planet_world_id: v["planetWorldId"].as_u64().unwrap_or(0),
        planet_world_timestamp: v["planetWorldTimestamp"].as_u64().unwrap_or(0),
    })
}

/// Parse network list JSON.
pub fn parse_networks_json(json: &str) -> Result<Vec<super::types::ZtNetworkDetail>, String> {
    let arr: Vec<serde_json::Value> =
        serde_json::from_str(json).map_err(|e| format!("Failed to parse networks: {}", e))?;

    Ok(arr
        .iter()
        .filter_map(|v| {
            let id = v["id"].as_str()?.to_string();
            Some(super::types::ZtNetworkDetail {
                id,
                name: v["name"].as_str().unwrap_or("").to_string(),
                status: match v["status"].as_str().unwrap_or("") {
                    "OK" => super::types::ZtNetworkStatus::Ok,
                    "REQUESTING_CONFIGURATION" => super::types::ZtNetworkStatus::Requesting,
                    "ACCESS_DENIED" => super::types::ZtNetworkStatus::AccessDenied,
                    "NOT_FOUND" => super::types::ZtNetworkStatus::NotFound,
                    "PORT_ERROR" => super::types::ZtNetworkStatus::PortError,
                    _ => super::types::ZtNetworkStatus::Requesting,
                },
                network_type: if v["type"].as_str() == Some("PUBLIC") {
                    super::types::ZtNetworkType::Public
                } else {
                    super::types::ZtNetworkType::Private
                },
                mac: v["mac"].as_str().unwrap_or("").to_string(),
                mtu: v["mtu"].as_u64().unwrap_or(2800) as u32,
                dhcp: v["dhcp"].as_bool().unwrap_or(false),
                bridge: v["bridge"].as_bool().unwrap_or(false),
                broadcast_enabled: v["broadcastEnabled"].as_bool().unwrap_or(true),
                port_error: v["portError"].as_i64().unwrap_or(0) as i32,
                netconf_revision: v["netconfRevision"].as_u64().unwrap_or(0),
                assigned_addresses: v["assignedAddresses"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default(),
                routes: v["routes"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|r| {
                                Some(super::types::ZtRoute {
                                    target: r["target"].as_str()?.to_string(),
                                    via: r["via"].as_str().map(|s| s.to_string()),
                                    flags: r["flags"].as_u64().unwrap_or(0) as u16,
                                    metric: r["metric"].as_u64().unwrap_or(0) as u16,
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                port_device_name: v["portDeviceName"].as_str().map(|s| s.to_string()),
                allow_managed: v["allowManaged"].as_bool().unwrap_or(true),
                allow_global: v["allowGlobal"].as_bool().unwrap_or(false),
                allow_default: v["allowDefault"].as_bool().unwrap_or(false),
                allow_dns: v["allowDNS"].as_bool().unwrap_or(true),
                dns: v["dns"]["domain"].as_str().map(|domain| super::types::ZtDnsConfig {
                    domain: domain.to_string(),
                    servers: v["dns"]["servers"]
                        .as_array()
                        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                        .unwrap_or_default(),
                }),
            })
        })
        .collect())
}

/// Parse peers list JSON.
pub fn parse_peers_json(json: &str) -> Result<Vec<super::types::ZtPeer>, String> {
    let arr: Vec<serde_json::Value> =
        serde_json::from_str(json).map_err(|e| format!("Failed to parse peers: {}", e))?;

    Ok(arr
        .iter()
        .filter_map(|v| {
            let address = v["address"].as_str()?.to_string();
            Some(super::types::ZtPeer {
                address,
                version_major: v["versionMajor"].as_i64().map(|v| v as i32),
                version_minor: v["versionMinor"].as_i64().map(|v| v as i32),
                version_rev: v["versionRev"].as_i64().map(|v| v as i32),
                latency: v["latency"].as_i64().unwrap_or(-1) as i32,
                role: match v["role"].as_str().unwrap_or("") {
                    "LEAF" => super::types::ZtPeerRole::Leaf,
                    "MOON" => super::types::ZtPeerRole::Moon,
                    "PLANET" => super::types::ZtPeerRole::Planet,
                    _ => super::types::ZtPeerRole::Leaf,
                },
                paths: v["paths"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|p| {
                                Some(super::types::ZtPeerPath {
                                    address: p["address"].as_str()?.to_string(),
                                    last_send: p["lastSend"].as_u64().unwrap_or(0),
                                    last_receive: p["lastReceive"].as_u64().unwrap_or(0),
                                    active: p["active"].as_bool().unwrap_or(false),
                                    expired: p["expired"].as_bool().unwrap_or(false),
                                    preferred: p["preferred"].as_bool().unwrap_or(false),
                                    trusted_path_id: p["trustedPathId"].as_u64(),
                                    link_quality: p["linkQuality"].as_f64(),
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                is_bonded: v["isBonded"].as_bool().unwrap_or(false),
                tunnel_suitable: v["tunnelSuitable"].as_bool().unwrap_or(false),
            })
        })
        .collect())
}

/// Read authtoken from default location.
pub fn read_authtoken(home: Option<&str>) -> Result<String, String> {
    let home_dir = home
        .map(|s| s.to_string())
        .or_else(|| default_home_dir())
        .ok_or_else(|| "Cannot determine ZeroTier home directory".to_string())?;

    let token_path = format!("{}/authtoken.secret", home_dir);
    std::fs::read_to_string(&token_path)
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("Failed to read authtoken from {}: {}", token_path, e))
}
