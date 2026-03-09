//! # Teleport Application Access
//!
//! List applications, establish app proxies, generate JWT tokens,
//! and manage application sessions through Teleport.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Build `tsh apps ls` command.
pub fn list_apps_command(cluster: Option<&str>, format_json: bool) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "apps".to_string(), "ls".to_string()];
    if let Some(c) = cluster {
        cmd.push(format!("--cluster={}", c));
    }
    if format_json {
        cmd.push("--format=json".to_string());
    }
    cmd
}

/// Build `tsh apps login` command.
pub fn app_login_command(app_name: &str, aws_role: Option<&str>) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "apps".to_string(), "login".to_string()];
    if let Some(role) = aws_role {
        cmd.push(format!("--aws-role={}", role));
    }
    cmd.push(app_name.to_string());
    cmd
}

/// Build `tsh apps logout` command.
pub fn app_logout_command(app_name: &str) -> Vec<String> {
    vec![
        "tsh".to_string(),
        "apps".to_string(),
        "logout".to_string(),
        app_name.to_string(),
    ]
}

/// Build `tsh proxy app` for local proxy.
pub fn app_proxy_command(app_name: &str, port: u16) -> Vec<String> {
    vec![
        "tsh".to_string(),
        "proxy".to_string(),
        "app".to_string(),
        format!("--port={}", port),
        app_name.to_string(),
    ]
}

/// Build `tsh apps config` to get proxy config (cert, key, CA).
pub fn app_config_command(app_name: &str, format_json: bool) -> Vec<String> {
    let mut cmd = vec![
        "tsh".to_string(),
        "apps".to_string(),
        "config".to_string(),
        app_name.to_string(),
    ];
    if format_json {
        cmd.push("--format=json".to_string());
    }
    cmd
}

/// Application summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSummary {
    pub total: u32,
    pub http: u32,
    pub tcp: u32,
    pub aws_console: u32,
    pub online: u32,
    pub offline: u32,
}

pub fn summarize_apps(apps: &[&TeleportApp]) -> AppSummary {
    AppSummary {
        total: apps.len() as u32,
        http: apps.iter().filter(|a| a.app_type == AppType::Http).count() as u32,
        tcp: apps.iter().filter(|a| a.app_type == AppType::Tcp).count() as u32,
        aws_console: apps.iter().filter(|a| a.aws_console).count() as u32,
        online: apps
            .iter()
            .filter(|a| a.status == ResourceStatus::Online)
            .count() as u32,
        offline: apps
            .iter()
            .filter(|a| a.status == ResourceStatus::Offline)
            .count() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_login_command() {
        let cmd = app_login_command("grafana", None);
        assert_eq!(cmd, vec!["tsh", "apps", "login", "grafana"]);
    }

    #[test]
    fn test_app_login_with_aws_role() {
        let cmd = app_login_command("aws-console", Some("arn:aws:iam::role/Admin"));
        assert!(cmd.iter().any(|c| c.contains("--aws-role=")));
    }

    #[test]
    fn test_app_proxy_command() {
        let cmd = app_proxy_command("my-app", 8888);
        assert!(cmd.iter().any(|c| c.contains("--port=8888")));
        assert!(cmd.contains(&"my-app".to_string()));
    }
}
