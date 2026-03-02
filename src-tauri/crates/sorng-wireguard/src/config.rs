//! # WireGuard Configuration
//!
//! Parse, generate, validate, and serialize WireGuard INI configs.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Parse a WireGuard INI config file content.
pub fn parse_config(content: &str) -> Result<WgConfig, String> {
    let mut interface = WgInterfaceConfig {
        private_key: String::new(),
        address: Vec::new(),
        listen_port: None,
        dns: Vec::new(),
        mtu: None,
        table: None,
        pre_up: None,
        post_up: None,
        pre_down: None,
        post_down: None,
        save_config: None,
        fwmark: None,
    };

    let mut peers: Vec<WgPeerConfig> = Vec::new();
    let mut current_section = Section::None;

    for line in content.lines() {
        let line = line.trim();

        // Skip comments and empty lines
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }

        // Section headers
        if line.eq_ignore_ascii_case("[Interface]") {
            current_section = Section::Interface;
            continue;
        }
        if line.eq_ignore_ascii_case("[Peer]") {
            current_section = Section::Peer;
            peers.push(WgPeerConfig {
                public_key: String::new(),
                preshared_key: None,
                endpoint: None,
                allowed_ips: Vec::new(),
                persistent_keepalive: None,
            });
            continue;
        }

        // Key = Value
        let (key, value) = match line.split_once('=') {
            Some((k, v)) => (k.trim(), v.trim()),
            None => continue,
        };

        match current_section {
            Section::Interface => match key.to_lowercase().as_str() {
                "privatekey" => interface.private_key = value.to_string(),
                "address" => {
                    interface.address.extend(
                        value.split(',').map(|s| s.trim().to_string()),
                    );
                }
                "listenport" => {
                    interface.listen_port = value.parse().ok();
                }
                "dns" => {
                    interface.dns.extend(
                        value.split(',').map(|s| s.trim().to_string()),
                    );
                }
                "mtu" => {
                    interface.mtu = value.parse().ok();
                }
                "table" => interface.table = Some(value.to_string()),
                "preup" => interface.pre_up = Some(value.to_string()),
                "postup" => interface.post_up = Some(value.to_string()),
                "predown" => interface.pre_down = Some(value.to_string()),
                "postdown" => interface.post_down = Some(value.to_string()),
                "saveconfig" => {
                    interface.save_config = Some(value.eq_ignore_ascii_case("true"));
                }
                "fwmark" => {
                    interface.fwmark = if value.starts_with("0x") {
                        u32::from_str_radix(&value[2..], 16).ok()
                    } else {
                        value.parse().ok()
                    };
                }
                _ => {}
            },
            Section::Peer => {
                if let Some(peer) = peers.last_mut() {
                    match key.to_lowercase().as_str() {
                        "publickey" => peer.public_key = value.to_string(),
                        "presharedkey" => {
                            peer.preshared_key = Some(value.to_string());
                        }
                        "endpoint" => peer.endpoint = Some(value.to_string()),
                        "allowedips" => {
                            peer.allowed_ips.extend(
                                value.split(',').map(|s| s.trim().to_string()),
                            );
                        }
                        "persistentkeepalive" => {
                            peer.persistent_keepalive = value.parse().ok();
                        }
                        _ => {}
                    }
                }
            }
            Section::None => {}
        }
    }

    if interface.private_key.is_empty() {
        return Err("Missing PrivateKey in [Interface] section".to_string());
    }

    Ok(WgConfig { interface, peers })
}

enum Section {
    None,
    Interface,
    Peer,
}

/// Serialize a WgConfig to INI format.
pub fn serialize_config(config: &WgConfig) -> String {
    let mut output = String::new();

    // [Interface]
    output.push_str("[Interface]\n");
    output.push_str(&format!("PrivateKey = {}\n", config.interface.private_key));

    if !config.interface.address.is_empty() {
        output.push_str(&format!("Address = {}\n", config.interface.address.join(", ")));
    }

    if let Some(port) = config.interface.listen_port {
        output.push_str(&format!("ListenPort = {}\n", port));
    }

    if !config.interface.dns.is_empty() {
        output.push_str(&format!("DNS = {}\n", config.interface.dns.join(", ")));
    }

    if let Some(mtu) = config.interface.mtu {
        output.push_str(&format!("MTU = {}\n", mtu));
    }

    if let Some(table) = &config.interface.table {
        output.push_str(&format!("Table = {}\n", table));
    }

    if let Some(pre_up) = &config.interface.pre_up {
        output.push_str(&format!("PreUp = {}\n", pre_up));
    }

    if let Some(post_up) = &config.interface.post_up {
        output.push_str(&format!("PostUp = {}\n", post_up));
    }

    if let Some(pre_down) = &config.interface.pre_down {
        output.push_str(&format!("PreDown = {}\n", pre_down));
    }

    if let Some(post_down) = &config.interface.post_down {
        output.push_str(&format!("PostDown = {}\n", post_down));
    }

    if let Some(save) = config.interface.save_config {
        output.push_str(&format!("SaveConfig = {}\n", save));
    }

    if let Some(fwmark) = config.interface.fwmark {
        output.push_str(&format!("FwMark = 0x{:x}\n", fwmark));
    }

    // [Peer] sections
    for peer in &config.peers {
        output.push('\n');
        output.push_str("[Peer]\n");
        output.push_str(&format!("PublicKey = {}\n", peer.public_key));

        if let Some(psk) = &peer.preshared_key {
            output.push_str(&format!("PresharedKey = {}\n", psk));
        }

        if let Some(endpoint) = &peer.endpoint {
            output.push_str(&format!("Endpoint = {}\n", endpoint));
        }

        if !peer.allowed_ips.is_empty() {
            output.push_str(&format!("AllowedIPs = {}\n", peer.allowed_ips.join(", ")));
        }

        if let Some(keepalive) = peer.persistent_keepalive {
            output.push_str(&format!("PersistentKeepalive = {}\n", keepalive));
        }
    }

    output
}

/// Validate a WireGuard configuration.
pub fn validate_config(config: &WgConfig) -> Vec<String> {
    let mut issues = Vec::new();

    // Validate private key
    if config.interface.private_key.is_empty() {
        issues.push("Interface private key is required".to_string());
    } else if !is_valid_wg_key(&config.interface.private_key) {
        issues.push("Interface private key is not a valid WireGuard key (must be 44 chars base64)".to_string());
    }

    // Validate addresses
    if config.interface.address.is_empty() {
        issues.push("At least one interface address is required".to_string());
    }
    for addr in &config.interface.address {
        if !addr.contains('/') {
            issues.push(format!("Address '{}' should include CIDR prefix (e.g., /32)", addr));
        }
    }

    // Validate MTU
    if let Some(mtu) = config.interface.mtu {
        if mtu < 1280 || mtu > 1500 {
            issues.push(format!("MTU {} is outside recommended range (1280-1500)", mtu));
        }
    }

    // Validate DNS
    for dns in &config.interface.dns {
        if dns.parse::<std::net::IpAddr>().is_err() {
            issues.push(format!("Invalid DNS server: {}", dns));
        }
    }

    // Validate peers
    if config.peers.is_empty() {
        issues.push("At least one peer is required".to_string());
    }

    for (i, peer) in config.peers.iter().enumerate() {
        if peer.public_key.is_empty() {
            issues.push(format!("Peer {} has no public key", i));
        } else if !is_valid_wg_key(&peer.public_key) {
            issues.push(format!("Peer {} has invalid public key format", i));
        }

        if let Some(psk) = &peer.preshared_key {
            if !is_valid_wg_key(psk) {
                issues.push(format!("Peer {} has invalid preshared key format", i));
            }
        }

        if peer.allowed_ips.is_empty() {
            issues.push(format!("Peer {} has no AllowedIPs", i));
        }

        if let Some(endpoint) = &peer.endpoint {
            if !endpoint.contains(':') {
                issues.push(format!("Peer {} endpoint '{}' must include port", i, endpoint));
            }
        } else if peer.allowed_ips.iter().any(|a| a.starts_with("0.0.0.0/0") || a.starts_with("::/0")) {
            issues.push(format!(
                "Peer {} routes all traffic but has no endpoint — this peer must have an endpoint",
                i
            ));
        }

        if let Some(keepalive) = peer.persistent_keepalive {
            if keepalive > 0 && keepalive < 10 {
                issues.push(format!(
                    "Peer {} keepalive interval {} is very low (recommended: 25)",
                    i, keepalive
                ));
            }
        }
    }

    issues
}

/// Check if a string looks like a valid WireGuard base64 key (44 chars).
fn is_valid_wg_key(key: &str) -> bool {
    key.len() == 44 && key.ends_with('=') && key.chars().all(|c| c.is_alphanumeric() || c == '+' || c == '/' || c == '=')
}

/// Check if the config routes all traffic (full tunnel).
pub fn is_full_tunnel(config: &WgConfig) -> bool {
    config.peers.iter().any(|p| {
        p.allowed_ips.iter().any(|a| a == "0.0.0.0/0" || a == "::/0")
    })
}

/// Get the effective allowed IPs across all peers.
pub fn all_allowed_ips(config: &WgConfig) -> Vec<String> {
    config
        .peers
        .iter()
        .flat_map(|p| p.allowed_ips.iter().cloned())
        .collect()
}
