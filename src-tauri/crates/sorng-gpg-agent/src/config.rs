//! # GPG Configuration Management
//!
//! Detect GPG installation, read/write `gpg.conf` and `gpg-agent.conf`,
//! manage socket paths, and control GPG components via `gpgconf`.

use crate::types::*;
use log::{debug, info, warn};
use std::collections::HashMap;
use tokio::process::Command;

/// GPG configuration manager.
pub struct GpgConfigManager {
    /// Detected GPG binary path.
    pub gpg_binary: String,
    /// Detected gpg-agent binary path.
    pub gpg_agent_binary: String,
    /// Detected scdaemon binary path.
    pub scdaemon_binary: String,
    /// GPG home directory.
    pub home_dir: String,
}

impl GpgConfigManager {
    /// Create a new config manager with default detection.
    pub fn new() -> Self {
        Self {
            gpg_binary: "gpg".to_string(),
            gpg_agent_binary: "gpg-agent".to_string(),
            scdaemon_binary: "scdaemon".to_string(),
            home_dir: String::new(),
        }
    }

    /// Detect the GPG binary on the system.
    pub async fn detect_gpg(&mut self) -> Result<String, String> {
        // Try common binary names
        for name in &["gpg", "gpg2", "gpg.exe", "gpg2.exe"] {
            let output = Command::new(name)
                .args(["--version"])
                .output()
                .await;
            if let Ok(out) = output {
                if out.status.success() {
                    self.gpg_binary = name.to_string();
                    info!("Detected GPG binary: {}", name);
                    return Ok(name.to_string());
                }
            }
        }

        // Try gpgconf to find the path
        if let Ok(output) = Command::new("gpgconf")
            .args(["--list-components"])
            .output()
            .await
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.split(':').collect();
                    if parts.len() >= 3 && parts[0] == "gpg" {
                        self.gpg_binary = parts[2].to_string();
                        info!("Detected GPG binary via gpgconf: {}", self.gpg_binary);
                        return Ok(self.gpg_binary.clone());
                    }
                }
            }
        }

        Err("Could not detect GPG installation".to_string())
    }

    /// Detect the gpg-agent binary.
    pub async fn detect_gpg_agent(&mut self) -> Result<String, String> {
        if let Ok(output) = Command::new("gpgconf")
            .args(["--list-components"])
            .output()
            .await
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.split(':').collect();
                    if parts.len() >= 3 && parts[0] == "gpg-agent" {
                        self.gpg_agent_binary = parts[2].to_string();
                        info!(
                            "Detected gpg-agent binary: {}",
                            self.gpg_agent_binary
                        );
                        return Ok(self.gpg_agent_binary.clone());
                    }
                }
            }
        }

        // Try direct execution
        for name in &["gpg-agent", "gpg-agent.exe"] {
            let output = Command::new(name).arg("--version").output().await;
            if let Ok(out) = output {
                if out.status.success() {
                    self.gpg_agent_binary = name.to_string();
                    return Ok(name.to_string());
                }
            }
        }

        Err("Could not detect gpg-agent".to_string())
    }

    /// Get the GPG home directory.
    pub async fn get_gpg_home(&mut self) -> Result<String, String> {
        if !self.home_dir.is_empty() {
            return Ok(self.home_dir.clone());
        }

        let output = Command::new("gpgconf")
            .args(["--list-dirs", "homedir"])
            .output()
            .await
            .map_err(|e| format!("Failed to run gpgconf: {}", e))?;

        if output.status.success() {
            self.home_dir = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            Ok(self.home_dir.clone())
        } else {
            // Fallback to environment / default
            let home = std::env::var("GNUPGHOME").unwrap_or_else(|_| {
                let user_home = std::env::var("HOME")
                    .or_else(|_| std::env::var("USERPROFILE"))
                    .unwrap_or_default();
                format!("{}/.gnupg", user_home)
            });
            self.home_dir = home.clone();
            Ok(home)
        }
    }

    /// Read the current configuration.
    pub async fn read_config(&mut self) -> Result<GpgAgentConfig, String> {
        let home = self.get_gpg_home().await?;
        let mut config = GpgAgentConfig::default();
        config.home_dir = home.clone();
        config.gpg_binary = self.gpg_binary.clone();
        config.gpg_agent_binary = self.gpg_agent_binary.clone();
        config.scdaemon_binary = self.scdaemon_binary.clone();

        // Read gpg-agent.conf
        let agent_conf_path = format!("{}/gpg-agent.conf", home);
        if let Ok(contents) = tokio::fs::read_to_string(&agent_conf_path).await {
            for line in contents.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                let mut parts = line.splitn(2, ' ');
                let key = parts.next().unwrap_or("");
                let value = parts.next().unwrap_or("").to_string();

                match key {
                    "pinentry-program" => config.pinentry_program = value,
                    "max-cache-ttl" => {
                        config.max_cache_ttl = value.parse().unwrap_or(7200);
                    }
                    "default-cache-ttl" => {
                        config.default_cache_ttl = value.parse().unwrap_or(600);
                    }
                    "enable-ssh-support" => config.enable_ssh_support = true,
                    "extra-socket" => config.extra_socket = value,
                    "allow-loopback-pinentry" => config.allow_loopback_pinentry = true,
                    "auto-expand-secmem" => config.auto_expand_secmem = true,
                    _ => {}
                }
            }
        }

        // Get socket paths
        if let Ok(socket) = self.get_agent_socket_path().await {
            config.agent_socket = socket;
        }

        Ok(config)
    }

    /// Write gpg-agent.conf.
    pub async fn write_agent_conf(&self, config: &GpgAgentConfig) -> Result<bool, String> {
        let home = if config.home_dir.is_empty() {
            &self.home_dir
        } else {
            &config.home_dir
        };
        let path = format!("{}/gpg-agent.conf", home);

        let mut lines = Vec::new();
        lines.push("# Generated by SortOfRemote NG".to_string());

        if !config.pinentry_program.is_empty() {
            lines.push(format!("pinentry-program {}", config.pinentry_program));
        }
        lines.push(format!("max-cache-ttl {}", config.max_cache_ttl));
        lines.push(format!("default-cache-ttl {}", config.default_cache_ttl));
        if config.enable_ssh_support {
            lines.push("enable-ssh-support".to_string());
        }
        if !config.extra_socket.is_empty() {
            lines.push(format!("extra-socket {}", config.extra_socket));
        }
        if config.allow_loopback_pinentry {
            lines.push("allow-loopback-pinentry".to_string());
        }
        if config.auto_expand_secmem {
            lines.push("auto-expand-secmem".to_string());
        }
        for opt in &config.scdaemon_options {
            lines.push(format!("scdaemon-program {}", opt));
        }

        let content = lines.join("\n") + "\n";
        tokio::fs::write(&path, content)
            .await
            .map_err(|e| format!("Failed to write {}: {}", path, e))?;

        info!("Wrote gpg-agent.conf to {}", path);
        Ok(true)
    }

    /// Read gpg.conf as key-value pairs.
    pub async fn read_gpg_conf(&self) -> Result<HashMap<String, String>, String> {
        let path = format!("{}/gpg.conf", self.home_dir);
        let mut settings = HashMap::new();

        let contents = match tokio::fs::read_to_string(&path).await {
            Ok(c) => c,
            Err(_) => return Ok(settings),
        };

        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let mut parts = line.splitn(2, ' ');
            let key = parts.next().unwrap_or("").to_string();
            let value = parts.next().unwrap_or("").to_string();
            settings.insert(key, value);
        }

        Ok(settings)
    }

    /// Write gpg.conf settings.
    pub async fn write_gpg_conf(
        &self,
        settings: &HashMap<String, String>,
    ) -> Result<bool, String> {
        let path = format!("{}/gpg.conf", self.home_dir);

        let mut lines = vec!["# Generated by SortOfRemote NG".to_string()];
        for (key, value) in settings {
            if value.is_empty() {
                lines.push(key.clone());
            } else {
                lines.push(format!("{} {}", key, value));
            }
        }

        let content = lines.join("\n") + "\n";
        tokio::fs::write(&path, content)
            .await
            .map_err(|e| format!("Failed to write {}: {}", path, e))?;

        info!("Wrote gpg.conf to {}", path);
        Ok(true)
    }

    /// Get the gpg-agent socket path.
    pub async fn get_agent_socket_path(&self) -> Result<String, String> {
        let output = Command::new("gpgconf")
            .args(["--list-dirs", "agent-socket"])
            .output()
            .await
            .map_err(|e| format!("Failed to run gpgconf: {}", e))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string())
        } else {
            Ok(format!("{}/S.gpg-agent", self.home_dir))
        }
    }

    /// Get the SSH agent socket path.
    pub async fn get_agent_ssh_socket(&self) -> Result<String, String> {
        let output = Command::new("gpgconf")
            .args(["--list-dirs", "agent-ssh-socket"])
            .output()
            .await
            .map_err(|e| format!("Failed to run gpgconf: {}", e))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string())
        } else {
            Ok(format!("{}/S.gpg-agent.ssh", self.home_dir))
        }
    }

    /// Reload a GPG component via gpgconf.
    pub async fn gpgconf_reload(&self, component: &str) -> Result<bool, String> {
        let output = Command::new("gpgconf")
            .args(["--reload", component])
            .output()
            .await
            .map_err(|e| format!("Failed to run gpgconf: {}", e))?;

        if output.status.success() {
            info!("Reloaded GPG component: {}", component);
            Ok(true)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Failed to reload {}: {}", component, stderr))
        }
    }

    /// Kill a GPG component via gpgconf.
    pub async fn gpgconf_kill(&self, component: &str) -> Result<bool, String> {
        let output = Command::new("gpgconf")
            .args(["--kill", component])
            .output()
            .await
            .map_err(|e| format!("Failed to run gpgconf: {}", e))?;

        if output.status.success() {
            info!("Killed GPG component: {}", component);
            Ok(true)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Failed to kill {}: {}", component, stderr))
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_manager_new() {
        let mgr = GpgConfigManager::new();
        assert_eq!(mgr.gpg_binary, "gpg");
        assert_eq!(mgr.gpg_agent_binary, "gpg-agent");
    }

    #[test]
    fn test_gpg_agent_config_default() {
        let config = GpgAgentConfig::default();
        assert_eq!(config.gpg_binary, "gpg");
        assert_eq!(config.keyserver, "hkps://keys.openpgp.org");
        assert_eq!(config.max_cache_ttl, 7200);
        assert_eq!(config.default_cache_ttl, 600);
        assert!(!config.enable_ssh_support);
        assert!(!config.allow_loopback_pinentry);
        assert!(config.auto_start_agent);
    }

    #[test]
    fn test_pinentry_mode_values() {
        assert_eq!(PinentryMode::Loopback.as_gpg_value(), "loopback");
        assert_eq!(PinentryMode::Ask.as_gpg_value(), "ask");
        assert_eq!(PinentryMode::Cancel.as_gpg_value(), "cancel");
        assert_eq!(PinentryMode::Error.as_gpg_value(), "error");
        assert_eq!(PinentryMode::Default.as_gpg_value(), "default");
    }
}
