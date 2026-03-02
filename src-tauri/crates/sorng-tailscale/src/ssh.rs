//! # Tailscale SSH
//!
//! Enable/disable Tailscale SSH, manage host keys, configure session
//! recording, integrate with SSH ACLs.

use serde::{Deserialize, Serialize};

/// Tailscale SSH configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscaleSshConfig {
    pub enabled: bool,
    pub accept_routes: bool,
    pub host_keys: Vec<SshHostKey>,
    pub session_recording: SessionRecordingConfig,
    pub allowed_users: Vec<String>,
    pub env_vars: std::collections::HashMap<String, String>,
}

impl Default for TailscaleSshConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            accept_routes: true,
            host_keys: Vec::new(),
            session_recording: SessionRecordingConfig::default(),
            allowed_users: Vec::new(),
            env_vars: std::collections::HashMap::new(),
        }
    }
}

/// SSH host key info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshHostKey {
    pub key_type: SshKeyType,
    pub fingerprint: String,
    pub public_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SshKeyType {
    Ed25519,
    Rsa,
    Ecdsa,
}

/// Session recording configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecordingConfig {
    pub enabled: bool,
    pub mode: RecordingMode,
    pub storage: RecordingStorage,
}

impl Default for SessionRecordingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: RecordingMode::Off,
            storage: RecordingStorage::Local {
                path: String::new(),
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RecordingMode {
    Off,
    Input,
    Output,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RecordingStorage {
    Local { path: String },
    Tsnet { recorder_addr: String },
}

/// SSH session info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshSession {
    pub session_id: String,
    pub peer_id: String,
    pub peer_name: String,
    pub local_user: String,
    pub remote_user: String,
    pub started_at: String,
    pub source_ip: String,
    pub active: bool,
    pub recording: bool,
}

/// Build command to enable Tailscale SSH.
pub fn enable_ssh_command() -> Vec<String> {
    vec![
        "tailscale".to_string(),
        "set".to_string(),
        "--ssh".to_string(),
    ]
}

/// Build command to disable Tailscale SSH.
pub fn disable_ssh_command() -> Vec<String> {
    vec![
        "tailscale".to_string(),
        "set".to_string(),
        "--ssh=false".to_string(),
    ]
}

/// Build an SSH connection command via Tailscale.
pub fn ssh_connect_command(
    target: &str,
    user: Option<&str>,
    port: Option<u16>,
) -> Vec<String> {
    let mut cmd = vec!["tailscale".to_string(), "ssh".to_string()];
    if let Some(u) = user {
        cmd.push(format!("{}@{}", u, target));
    } else {
        cmd.push(target.to_string());
    }
    if let Some(p) = port {
        cmd.push("--port".to_string());
        cmd.push(format!("{}", p));
    }
    cmd
}

/// Check if SSH is available for a specific peer.
pub fn check_ssh_availability(
    peer: &super::daemon::PeerJson,
) -> SshAvailability {
    let has_ssh_keys = peer
        .ssh_host_keys
        .as_ref()
        .map(|k| !k.is_empty())
        .unwrap_or(false);

    let is_online = peer.online.unwrap_or(false);

    SshAvailability {
        available: has_ssh_keys && is_online,
        has_host_keys: has_ssh_keys,
        is_online,
        key_types: peer
            .ssh_host_keys
            .as_ref()
            .map(|keys| {
                keys.iter()
                    .filter_map(|k| {
                        if k.contains("ssh-ed25519") {
                            Some(SshKeyType::Ed25519)
                        } else if k.contains("ssh-rsa") {
                            Some(SshKeyType::Rsa)
                        } else if k.contains("ecdsa") {
                            Some(SshKeyType::Ecdsa)
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshAvailability {
    pub available: bool,
    pub has_host_keys: bool,
    pub is_online: bool,
    pub key_types: Vec<SshKeyType>,
}

/// Parse SSH host key fingerprints from peer status.
pub fn parse_host_keys(keys: &[String]) -> Vec<SshHostKey> {
    keys.iter()
        .filter_map(|key| {
            let parts: Vec<&str> = key.splitn(3, ' ').collect();
            if parts.len() < 2 {
                return None;
            }
            let key_type = match parts[0] {
                "ssh-ed25519" => SshKeyType::Ed25519,
                "ssh-rsa" => SshKeyType::Rsa,
                k if k.starts_with("ecdsa-") => SshKeyType::Ecdsa,
                _ => return None,
            };
            Some(SshHostKey {
                key_type,
                fingerprint: String::new(), // computed separately
                public_key: key.clone(),
            })
        })
        .collect()
}

/// Generate SSH config block for Tailscale SSH.
pub fn generate_ssh_config(dns_suffix: &str) -> String {
    format!(
        r#"# Tailscale SSH configuration
Host *.{}
    ProxyCommand tailscale ssh --accept-risks=lose-ssh %h
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
"#,
        dns_suffix
    )
}

/// Validate SSH ACL rules.
pub fn validate_ssh_acl(rules: &[super::acl::SshAclEntry]) -> Vec<String> {
    let mut issues = Vec::new();

    for (i, rule) in rules.iter().enumerate() {
        if rule.src.is_empty() {
            issues.push(format!("SSH rule {} has empty src list", i));
        }
        if rule.dst.is_empty() {
            issues.push(format!("SSH rule {} has empty dst list", i));
        }
        if rule.users.is_empty() {
            issues.push(format!("SSH rule {} has empty users list", i));
        }
        if let Some(period) = &rule.check_period {
            if !period.ends_with('h') && !period.ends_with('m') && !period.ends_with('d') {
                issues.push(format!(
                    "SSH rule {} has invalid check_period format: {}",
                    i, period
                ));
            }
        }
    }

    issues
}
