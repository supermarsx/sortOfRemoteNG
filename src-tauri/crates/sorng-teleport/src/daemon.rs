//! # Teleport Daemon / Binary Management
//!
//! Detection, version checking, and service management for the
//! `tsh` client and `teleport` server binaries.

use serde::{Deserialize, Serialize};

/// Information about the installed Teleport binaries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeleportInstallation {
    pub tsh_path: Option<String>,
    pub teleport_path: Option<String>,
    pub tctl_path: Option<String>,
    pub version: Option<String>,
    pub enterprise: bool,
    pub fips: bool,
}

/// Detect tsh installation on the system.
pub fn detect_tsh() -> Vec<String> {
    if cfg!(target_os = "windows") {
        vec!["where.exe".to_string(), "tsh".to_string()]
    } else {
        vec!["which".to_string(), "tsh".to_string()]
    }
}

/// Detect teleport server binary.
pub fn detect_teleport() -> Vec<String> {
    if cfg!(target_os = "windows") {
        vec!["where.exe".to_string(), "teleport".to_string()]
    } else {
        vec!["which".to_string(), "teleport".to_string()]
    }
}

/// Detect tctl admin tool.
pub fn detect_tctl() -> Vec<String> {
    if cfg!(target_os = "windows") {
        vec!["where.exe".to_string(), "tctl".to_string()]
    } else {
        vec!["which".to_string(), "tctl".to_string()]
    }
}

/// Build `tsh version` command.
pub fn tsh_version_command() -> Vec<String> {
    vec!["tsh".to_string(), "version".to_string()]
}

/// Build `teleport version` command.
pub fn teleport_version_command() -> Vec<String> {
    vec!["teleport".to_string(), "version".to_string()]
}

/// Build `tctl version` command.
pub fn tctl_version_command() -> Vec<String> {
    vec!["tctl".to_string(), "version".to_string()]
}

/// Parse version string like "Teleport v16.1.0 git:..." -> "16.1.0"
pub fn parse_version(output: &str) -> Option<String> {
    // Look for pattern vX.Y.Z
    for word in output.split_whitespace() {
        if let Some(stripped) = word.strip_prefix('v') {
            let parts: Vec<&str> = stripped.split('.').collect();
            if parts.len() >= 2 && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit())) {
                return Some(stripped.to_string());
            }
        }
    }
    None
}

/// Check if version output indicates Enterprise edition.
pub fn is_enterprise(output: &str) -> bool {
    output.contains("Enterprise") || output.contains("enterprise")
}

/// Check if version output indicates FIPS mode.
pub fn is_fips(output: &str) -> bool {
    output.contains("FIPS") || output.contains("fips")
}

/// Build `teleport start` command with config file.
pub fn start_teleport_command(config_path: Option<&str>) -> Vec<String> {
    let mut cmd = vec!["teleport".to_string(), "start".to_string()];
    if let Some(cfg) = config_path {
        cmd.push(format!("--config={}", cfg));
    }
    cmd
}

/// Build `teleport configure` to generate a config file.
pub fn configure_command(
    roles: &[&str],
    cluster_name: Option<&str>,
    output: Option<&str>,
) -> Vec<String> {
    let mut cmd = vec!["teleport".to_string(), "configure".to_string()];
    if !roles.is_empty() {
        cmd.push(format!("--roles={}", roles.join(",")));
    }
    if let Some(name) = cluster_name {
        cmd.push(format!("--cluster-name={}", name));
    }
    if let Some(out) = output {
        cmd.push(format!("--output={}", out));
    }
    cmd
}

/// System service management (systemd).
pub fn systemctl_command(action: &str) -> Vec<String> {
    vec![
        "systemctl".to_string(),
        action.to_string(),
        "teleport".to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_version() {
        assert_eq!(
            parse_version("Teleport v16.1.0 git:abc123"),
            Some("16.1.0".to_string())
        );
        assert_eq!(parse_version("no version here"), None);
    }

    #[test]
    fn test_is_enterprise() {
        assert!(is_enterprise("Teleport Enterprise v16.1.0"));
        assert!(!is_enterprise("Teleport v16.1.0"));
    }

    #[test]
    fn test_is_fips() {
        assert!(is_fips("Teleport Enterprise FIPS v16.1.0"));
        assert!(!is_fips("Teleport v16.1.0"));
    }

    #[test]
    fn test_configure_command() {
        let cmd = configure_command(&["proxy", "auth"], Some("my-cluster"), None);
        assert!(cmd.contains(&"--roles=proxy,auth".to_string()));
        assert!(cmd.contains(&"--cluster-name=my-cluster".to_string()));
    }

    #[test]
    fn test_detect_tsh() {
        let cmd = detect_tsh();
        assert!(cmd.len() == 2);
    }
}
