// ── Cyrus SASL saslauthd management ──────────────────────────────────────────

use crate::client::{shell_escape, CyrusSaslClient};
use crate::error::{CyrusSaslError, CyrusSaslResult};
use crate::types::*;

pub struct SaslauthdManager;

impl SaslauthdManager {
    /// Read the saslauthd configuration from /etc/default/saslauthd.
    pub async fn get_config(client: &CyrusSaslClient) -> CyrusSaslResult<SaslauthConfig> {
        let content = client
            .read_remote_file("/etc/default/saslauthd")
            .await
            .or_else(|_| {
                // FreeBSD-style path
                Err(CyrusSaslError::config_not_found("/etc/default/saslauthd"))
            })?;
        Ok(parse_saslauthd_config(&content))
    }

    /// Write updated saslauthd configuration.
    pub async fn set_config(
        client: &CyrusSaslClient,
        config: &SaslauthConfig,
    ) -> CyrusSaslResult<()> {
        let content = generate_saslauthd_config(config);
        client
            .write_remote_file("/etc/default/saslauthd", &content)
            .await?;
        Ok(())
    }

    /// Get saslauthd runtime status.
    pub async fn get_status(client: &CyrusSaslClient) -> CyrusSaslResult<SaslauthStatus> {
        client.saslauthd_status().await
    }

    /// Start saslauthd.
    pub async fn start(client: &CyrusSaslClient) -> CyrusSaslResult<()> {
        let out = client
            .exec_ssh("sudo systemctl start saslauthd 2>&1 || sudo service saslauthd start 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(CyrusSaslError::saslauthd_error(format!(
                "Failed to start saslauthd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Stop saslauthd.
    pub async fn stop(client: &CyrusSaslClient) -> CyrusSaslResult<()> {
        let out = client
            .exec_ssh("sudo systemctl stop saslauthd 2>&1 || sudo service saslauthd stop 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(CyrusSaslError::saslauthd_error(format!(
                "Failed to stop saslauthd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Restart saslauthd.
    pub async fn restart(client: &CyrusSaslClient) -> CyrusSaslResult<()> {
        let out = client
            .exec_ssh(
                "sudo systemctl restart saslauthd 2>&1 || sudo service saslauthd restart 2>&1",
            )
            .await?;
        if out.exit_code != 0 {
            return Err(CyrusSaslError::saslauthd_error(format!(
                "Failed to restart saslauthd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Set the saslauthd authentication mechanism.
    pub async fn set_mechanism(client: &CyrusSaslClient, mech: &str) -> CyrusSaslResult<()> {
        let valid_mechs = ["pam", "shadow", "ldap", "rimap", "kerberos5", "httpform"];
        if !valid_mechs.contains(&mech) {
            return Err(CyrusSaslError::new(
                crate::error::CyrusSaslErrorKind::InternalError,
                format!(
                    "Invalid mechanism '{}'. Valid: {}",
                    mech,
                    valid_mechs.join(", ")
                ),
            ));
        }

        let mut config = Self::get_config(client).await?;
        config.mech = mech.to_string();
        Self::set_config(client, &config).await
    }

    /// Set saslauthd flags.
    pub async fn set_flags(client: &CyrusSaslClient, flags: Vec<String>) -> CyrusSaslResult<()> {
        let mut config = Self::get_config(client).await?;
        config.flags = flags;
        Self::set_config(client, &config).await
    }

    /// Test authentication via saslauthd.
    pub async fn test_auth(
        client: &CyrusSaslClient,
        username: &str,
        password: &str,
        service: &str,
        realm: &str,
    ) -> CyrusSaslResult<SaslTestResult> {
        let mut cmd = format!(
            "testsaslauthd -u {} -p {} -s {}",
            shell_escape(username),
            shell_escape(password),
            shell_escape(service)
        );
        if !realm.is_empty() {
            cmd.push_str(&format!(" -r {}", shell_escape(realm)));
        }

        let out = client.exec_ssh(&cmd).await?;
        let success = out.exit_code == 0 && out.stdout.contains("OK");
        let message = if success {
            format!(
                "Authentication succeeded for {} via {}",
                username, service
            )
        } else {
            format!(
                "Authentication failed for {}: {}",
                username,
                out.stdout.trim()
            )
        };

        Ok(SaslTestResult {
            success,
            mechanism_used: Some("saslauthd".to_string()),
            message,
        })
    }
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

fn parse_saslauthd_config(content: &str) -> SaslauthConfig {
    let mut mech = "pam".to_string();
    let mut flags = Vec::new();
    let mut run_dir = None;
    let mut threads = None;
    let mut cache_timeout = None;
    let mut log_level = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }

        if let Some((key, value)) = trimmed.split_once('=') {
            let key = key.trim().trim_matches('"');
            let value = value.trim().trim_matches('"');

            match key {
                "MECHANISMS" | "MECH" => mech = value.to_string(),
                "FLAGS" => {
                    flags = value.split_whitespace().map(String::from).collect();
                }
                "RUN_DIR" | "SOCKETDIR" => run_dir = Some(value.to_string()),
                "THREADS" => threads = value.parse().ok(),
                "CACHE_TIMEOUT" => cache_timeout = value.parse().ok(),
                "LOG_LEVEL" => log_level = Some(value.to_string()),
                _ => {}
            }
        }
    }

    SaslauthConfig {
        mech,
        flags,
        run_dir,
        threads,
        cache_timeout,
        log_level,
    }
}

fn generate_saslauthd_config(config: &SaslauthConfig) -> String {
    let mut out = String::new();
    out.push_str("# saslauthd configuration\n");
    out.push_str("# Managed by sorng-cyrus-sasl\n\n");
    out.push_str("START=yes\n");
    out.push_str(&format!("MECHANISMS=\"{}\"\n", config.mech));

    if !config.flags.is_empty() {
        out.push_str(&format!("FLAGS=\"{}\"\n", config.flags.join(" ")));
    }

    if let Some(ref run_dir) = config.run_dir {
        out.push_str(&format!("RUN_DIR=\"{}\"\n", run_dir));
    }

    if let Some(threads) = config.threads {
        out.push_str(&format!("THREADS={}\n", threads));
    }

    if let Some(timeout) = config.cache_timeout {
        out.push_str(&format!("CACHE_TIMEOUT={}\n", timeout));
    }

    if let Some(ref level) = config.log_level {
        out.push_str(&format!("LOG_LEVEL=\"{}\"\n", level));
    }

    out
}
