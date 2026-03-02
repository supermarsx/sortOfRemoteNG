//! # WireGuard Interface Management
//!
//! Create, tear down, configure WireGuard network interfaces.
//! Platform-specific commands for Linux, macOS, and Windows.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Interface operation to build commands for.
#[derive(Debug, Clone, Copy)]
pub enum InterfaceOp {
    Create,
    Up,
    Down,
    Delete,
    Show,
    ShowAll,
}

/// Build WireGuard quick command (wg-quick).
pub fn wg_quick_command(op: &str, interface_or_config: &str) -> Vec<String> {
    if cfg!(target_os = "windows") {
        // Windows uses wireguard.exe /installtunnelservice, etc.
        match op {
            "up" => vec![
                "wireguard.exe".to_string(),
                "/installtunnelservice".to_string(),
                interface_or_config.to_string(),
            ],
            "down" => vec![
                "wireguard.exe".to_string(),
                "/uninstalltunnelservice".to_string(),
                interface_or_config.to_string(),
            ],
            _ => vec![
                "wg-quick".to_string(),
                op.to_string(),
                interface_or_config.to_string(),
            ],
        }
    } else {
        vec![
            "wg-quick".to_string(),
            op.to_string(),
            interface_or_config.to_string(),
        ]
    }
}

/// Build `wg show` command.
pub fn wg_show_command(interface: Option<&str>) -> Vec<String> {
    let mut cmd = vec!["wg".to_string(), "show".to_string()];
    if let Some(iface) = interface {
        cmd.push(iface.to_string());
    }
    cmd
}

/// Build `wg show <interface> dump` for machine-readable output.
pub fn wg_show_dump_command(interface: &str) -> Vec<String> {
    vec![
        "wg".to_string(),
        "show".to_string(),
        interface.to_string(),
        "dump".to_string(),
    ]
}

/// Build `wg set` command for modifying live interface.
pub fn wg_set_command(interface: &str, args: &[String]) -> Vec<String> {
    let mut cmd = vec![
        "wg".to_string(),
        "set".to_string(),
        interface.to_string(),
    ];
    cmd.extend_from_slice(args);
    cmd
}

/// Build `wg set` args to add a peer.
pub fn add_peer_args(peer: &WgPeerConfig) -> Vec<String> {
    let mut args = vec!["peer".to_string(), peer.public_key.clone()];

    if let Some(psk) = &peer.preshared_key {
        args.push("preshared-key".to_string());
        args.push(psk.clone());
    }

    if let Some(endpoint) = &peer.endpoint {
        args.push("endpoint".to_string());
        args.push(endpoint.clone());
    }

    if !peer.allowed_ips.is_empty() {
        args.push("allowed-ips".to_string());
        args.push(peer.allowed_ips.join(","));
    }

    if let Some(keepalive) = peer.persistent_keepalive {
        args.push("persistent-keepalive".to_string());
        args.push(format!("{}", keepalive));
    }

    args
}

/// Build `wg set` args to remove a peer.
pub fn remove_peer_args(public_key: &str) -> Vec<String> {
    vec![
        "peer".to_string(),
        public_key.to_string(),
        "remove".to_string(),
    ]
}

/// Parse `wg show <interface> dump` output.
pub fn parse_wg_dump(dump: &str) -> Result<WgInterfaceStats, String> {
    let lines: Vec<&str> = dump.lines().collect();
    if lines.is_empty() {
        return Err("Empty dump output".to_string());
    }

    // First line: private_key\tpublic_key\tlistening_port\tfwmark
    let iface_parts: Vec<&str> = lines[0].split('\t').collect();
    if iface_parts.len() < 3 {
        return Err("Invalid interface line format".to_string());
    }

    let public_key = iface_parts[1].to_string();
    let listening_port = iface_parts[2].parse::<u16>().unwrap_or(0);
    let fwmark = if iface_parts.len() > 3 && iface_parts[3] != "off" {
        iface_parts[3].parse::<u32>().ok()
    } else {
        None
    };

    // Remaining lines: peer entries
    // public_key\tpreshared_key\tendpoint\tallowed_ips\tlatest_handshake\ttransfer_rx\ttransfer_tx\tpersistent_keepalive
    let mut peers = Vec::new();
    for line in &lines[1..] {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 8 {
            continue;
        }

        let peer_psk = if parts[1] == "(none)" {
            None
        } else {
            Some(parts[1].to_string())
        };

        let endpoint = if parts[2] == "(none)" {
            None
        } else {
            Some(parts[2].to_string())
        };

        let allowed_ips: Vec<String> = if parts[3] == "(none)" {
            Vec::new()
        } else {
            parts[3].split(',').map(|s| s.trim().to_string()).collect()
        };

        let latest_handshake = parts[4].parse::<u64>().ok().filter(|&v| v > 0);
        let transfer_rx = parts[5].parse::<u64>().unwrap_or(0);
        let transfer_tx = parts[6].parse::<u64>().unwrap_or(0);
        let persistent_keepalive = if parts[7] == "off" {
            None
        } else {
            parts[7].parse::<u16>().ok()
        };

        peers.push(WgPeerStats {
            public_key: parts[0].to_string(),
            endpoint,
            allowed_ips,
            latest_handshake,
            transfer_rx,
            transfer_tx,
            persistent_keepalive,
            preshared_key: peer_psk,
        });
    }

    Ok(WgInterfaceStats {
        interface_name: String::new(), // filled by caller
        public_key,
        listening_port,
        fwmark,
        peers,
    })
}

/// Determine handshake status from timestamp.
pub fn check_handshake(latest_handshake: Option<u64>, now: u64) -> HandshakeStatus {
    match latest_handshake {
        None | Some(0) => HandshakeStatus::None,
        Some(ts) => {
            let age = now.saturating_sub(ts);
            if age < 180 {
                HandshakeStatus::Active
            } else {
                HandshakeStatus::Stale
            }
        }
    }
}

/// Generate a suitable interface name.
pub fn generate_interface_name(base: &str, existing: &[String]) -> String {
    if !existing.contains(&base.to_string()) {
        return base.to_string();
    }

    for i in 0..100 {
        let name = format!("{}{}", base, i);
        if !existing.contains(&name) {
            return name;
        }
    }

    format!("{}-{}", base, uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("0"))
}

/// List existing WireGuard interfaces command.
pub fn list_interfaces_command() -> Vec<String> {
    if cfg!(target_os = "windows") {
        vec!["wg".to_string(), "show".to_string(), "interfaces".to_string()]
    } else {
        vec!["wg".to_string(), "show".to_string(), "interfaces".to_string()]
    }
}

/// Parse interface list output.
pub fn parse_interface_list(output: &str) -> Vec<String> {
    output
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}
