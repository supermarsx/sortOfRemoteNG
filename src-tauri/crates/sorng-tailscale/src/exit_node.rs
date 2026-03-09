//! # Tailscale Exit Node Management
//!
//! Advertise as exit node, use exit nodes, list available exit nodes
//! (including Mullvad), allow LAN access configuration.

use serde::{Deserialize, Serialize};

/// Exit node configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExitNodeConfig {
    pub using_exit_node: Option<ExitNodeSelection>,
    pub advertise_as_exit_node: bool,
    pub allow_lan_access: bool,
    pub auto_exit_node: bool,
}

impl Default for ExitNodeConfig {
    fn default() -> Self {
        Self {
            using_exit_node: None,
            advertise_as_exit_node: false,
            allow_lan_access: true,
            auto_exit_node: false,
        }
    }
}

/// Exit node selection — either a specific peer or Mullvad.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExitNodeSelection {
    Peer {
        id: String,
        name: String,
        tailscale_ip: String,
    },
    Mullvad {
        country_code: String,
        city_code: Option<String>,
    },
    Auto,
}

/// Available exit node info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableExitNode {
    pub id: String,
    pub name: String,
    pub tailscale_ips: Vec<String>,
    pub os: Option<String>,
    pub online: bool,
    pub is_mullvad: bool,
    pub location: Option<ExitNodeLocation>,
    pub is_current: bool,
}

/// Geographic location for exit node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExitNodeLocation {
    pub country: String,
    pub country_code: String,
    pub city: Option<String>,
    pub city_code: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub priority: Option<i32>,
}

/// Build command to use an exit node.
pub fn use_exit_node_command(selection: &ExitNodeSelection) -> Vec<String> {
    let mut cmd = vec!["tailscale".to_string(), "set".to_string()];

    match selection {
        ExitNodeSelection::Peer { tailscale_ip, .. } => {
            cmd.push(format!("--exit-node={}", tailscale_ip));
        }
        ExitNodeSelection::Mullvad {
            country_code,
            city_code,
        } => {
            let node = if let Some(city) = city_code {
                format!("{}-{}", country_code, city)
            } else {
                country_code.clone()
            };
            cmd.push(format!("--exit-node={}", node));
        }
        ExitNodeSelection::Auto => {
            cmd.push("--exit-node=auto".to_string());
        }
    }

    cmd
}

/// Build command to stop using an exit node.
pub fn clear_exit_node_command() -> Vec<String> {
    vec![
        "tailscale".to_string(),
        "set".to_string(),
        "--exit-node=".to_string(),
    ]
}

/// Build command to advertise as an exit node.
pub fn advertise_exit_node_command(enable: bool) -> Vec<String> {
    vec![
        "tailscale".to_string(),
        "set".to_string(),
        format!(
            "--advertise-exit-node={}",
            if enable { "true" } else { "false" }
        ),
    ]
}

/// Build command to allow LAN access when using exit node.
pub fn allow_lan_access_command(allow: bool) -> Vec<String> {
    vec![
        "tailscale".to_string(),
        "set".to_string(),
        format!(
            "--exit-node-allow-lan-access={}",
            if allow { "true" } else { "false" }
        ),
    ]
}

/// Extract exit node options from status peers.
pub fn extract_exit_nodes(
    peers: &std::collections::HashMap<String, super::daemon::PeerJson>,
) -> Vec<AvailableExitNode> {
    peers
        .iter()
        .filter(|(_, p)| p.exit_node_option == Some(true))
        .map(|(key, p)| {
            let name = p.host_name.clone().unwrap_or_default();
            let is_mullvad = name.contains("mullvad")
                || p.tags
                    .as_ref()
                    .is_some_and(|t| t.iter().any(|tag| tag.contains("mullvad")));

            AvailableExitNode {
                id: key.clone(),
                name,
                tailscale_ips: p.tailscale_ips.clone().unwrap_or_default(),
                os: p.os.clone(),
                online: p.online.unwrap_or(false),
                is_mullvad,
                location: None, // populated from extended peer info
                is_current: p.exit_node == Some(true),
            }
        })
        .collect()
}

/// Sort exit nodes by relevance (online first, then by name).
pub fn sort_exit_nodes(nodes: &mut [AvailableExitNode]) {
    nodes.sort_by(|a, b| {
        // Current exit node first
        b.is_current
            .cmp(&a.is_current)
            // Then online before offline
            .then(b.online.cmp(&a.online))
            // Then own nodes before Mullvad
            .then(a.is_mullvad.cmp(&b.is_mullvad))
            // Then alphabetical
            .then(a.name.cmp(&b.name))
    });
}

/// Group Mullvad exit nodes by country.
pub fn group_mullvad_nodes(
    nodes: &[AvailableExitNode],
) -> std::collections::HashMap<String, Vec<&AvailableExitNode>> {
    let mut groups: std::collections::HashMap<String, Vec<&AvailableExitNode>> =
        std::collections::HashMap::new();

    for node in nodes.iter().filter(|n| n.is_mullvad) {
        let country = node
            .location
            .as_ref()
            .map(|l| l.country.clone())
            .unwrap_or_else(|| "Unknown".to_string());
        groups.entry(country).or_default().push(node);
    }

    groups
}

/// Validate exit node configuration.
pub fn validate_exit_node_config(config: &ExitNodeConfig) -> Vec<String> {
    let mut issues = Vec::new();

    if config.advertise_as_exit_node && config.using_exit_node.is_some() {
        issues.push("Cannot advertise as exit node while using another exit node".to_string());
    }

    if config.auto_exit_node && config.using_exit_node.is_some() {
        issues.push("Cannot use auto exit node when a specific exit node is selected".to_string());
    }

    issues
}
