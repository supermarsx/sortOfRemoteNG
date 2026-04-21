//! # Teleport Authentication
//!
//! Login/logout, SSO, MFA challenge, certificate management, and
//! session credential handling.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Build `tsh login` command.
pub fn login_command(config: &TeleportConfig) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "login".to_string()];
    cmd.push(format!("--proxy={}", config.proxy));

    if let Some(ref user) = config.user {
        cmd.push(format!("--user={}", user));
    }
    if let Some(ref connector) = config.auth_connector {
        cmd.push(format!("--auth={}", connector));
    }
    if let Some(ref ttl) = config.ttl {
        cmd.push(format!("--ttl={}", ttl));
    }
    if !config.request_roles.is_empty() {
        cmd.push(format!(
            "--request-roles={}",
            config.request_roles.join(",")
        ));
    }
    if config.insecure {
        cmd.push("--insecure".to_string());
    }
    cmd
}

/// Build `tsh logout` command.
pub fn logout_command() -> Vec<String> {
    vec!["tsh".to_string(), "logout".to_string()]
}

/// Build `tsh status` command (shows current credentials).
pub fn status_command(json: bool) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "status".to_string()];
    if json {
        cmd.push("--format=json".to_string());
    }
    cmd
}

/// Parsed tsh status output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TshStatus {
    pub active: Option<TshProfile>,
    pub profiles: Vec<TshProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TshProfile {
    pub proxy_url: Option<String>,
    pub username: Option<String>,
    pub cluster: Option<String>,
    pub roles: Vec<String>,
    pub traits: std::collections::HashMap<String, Vec<String>>,
    pub logins: Vec<String>,
    pub kube_enabled: bool,
    pub valid_until: Option<String>,
    pub extensions: Vec<String>,
}

/// Parse `tsh status --format=json`.
pub fn parse_status_json(json: &str) -> Result<TshStatus, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse tsh status: {}", e))
}

/// Build `tsh request create` for just-in-time access.
pub fn request_access_command(roles: &[String], reason: Option<&str>) -> Vec<String> {
    let mut cmd = vec![
        "tsh".to_string(),
        "request".to_string(),
        "create".to_string(),
        format!("--roles={}", roles.join(",")),
    ];
    if let Some(r) = reason {
        cmd.push(format!("--reason={}", r));
    }
    cmd
}

/// Build `tsh request approve` command.
pub fn approve_request_command(request_id: &str) -> Vec<String> {
    vec![
        "tsh".to_string(),
        "request".to_string(),
        "approve".to_string(),
        request_id.to_string(),
    ]
}

/// Build `tsh request deny` command.
pub fn deny_request_command(request_id: &str) -> Vec<String> {
    vec![
        "tsh".to_string(),
        "request".to_string(),
        "deny".to_string(),
        request_id.to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_login_command_basic() {
        let config = TeleportConfig {
            proxy: "tp.example.com:443".into(),
            ..Default::default()
        };
        let cmd = login_command(&config);
        assert!(cmd.contains(&"tsh".to_string()));
        assert!(cmd.contains(&"login".to_string()));
        assert!(cmd.iter().any(|c| c.contains("--proxy=")));
    }

    #[test]
    fn test_login_command_with_options() {
        let config = TeleportConfig {
            proxy: "tp.example.com:443".into(),
            user: Some("admin".into()),
            auth_connector: Some("github".into()),
            ttl: Some("8h".into()),
            request_roles: vec!["dba".into()],
            insecure: true,
            ..Default::default()
        };
        let cmd = login_command(&config);
        assert!(cmd.iter().any(|c| c.contains("--user=admin")));
        assert!(cmd.iter().any(|c| c.contains("--auth=github")));
        assert!(cmd.iter().any(|c| c.contains("--ttl=8h")));
        assert!(cmd.iter().any(|c| c.contains("--request-roles=dba")));
        assert!(cmd.contains(&"--insecure".to_string()));
    }

    #[test]
    fn test_logout_command() {
        let cmd = logout_command();
        assert_eq!(cmd, vec!["tsh", "logout"]);
    }

    #[test]
    fn test_status_command_json() {
        let cmd = status_command(true);
        assert!(cmd.contains(&"--format=json".to_string()));
    }

    #[test]
    fn test_request_access_command() {
        let cmd = request_access_command(&["dba".into(), "dev".into()], Some("need db access"));
        assert!(cmd.iter().any(|c| c.contains("--roles=dba,dev")));
        assert!(cmd.iter().any(|c| c.contains("--reason=")));
    }
}
