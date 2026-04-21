// ── sorng-apache – SSH/CLI client ────────────────────────────────────────────
//! Executes Apache httpd commands on a remote host via SSH.
//! Handles config file management, module control, process management, and status queries.

use crate::error::{ApacheError, ApacheResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use std::time::Duration;

pub struct ApacheClient {
    pub config: ApacheConnectionConfig,
    http: HttpClient,
}

impl ApacheClient {
    pub fn new(config: ApacheConnectionConfig) -> ApacheResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .build()
            .map_err(|e| ApacheError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn apache_bin(&self) -> &str {
        self.config.apache_bin.as_deref().unwrap_or("apachectl")
    }

    pub fn config_path(&self) -> &str {
        self.config
            .config_path
            .as_deref()
            .unwrap_or("/etc/apache2/apache2.conf")
    }

    pub fn sites_available_dir(&self) -> &str {
        self.config
            .sites_available_dir
            .as_deref()
            .unwrap_or("/etc/apache2/sites-available")
    }

    pub fn sites_enabled_dir(&self) -> &str {
        self.config
            .sites_enabled_dir
            .as_deref()
            .unwrap_or("/etc/apache2/sites-enabled")
    }

    pub fn mods_available_dir(&self) -> &str {
        self.config
            .mods_available_dir
            .as_deref()
            .unwrap_or("/etc/apache2/mods-available")
    }

    pub fn mods_enabled_dir(&self) -> &str {
        self.config
            .mods_enabled_dir
            .as_deref()
            .unwrap_or("/etc/apache2/mods-enabled")
    }

    pub fn conf_available_dir(&self) -> &str {
        self.config
            .conf_available_dir
            .as_deref()
            .unwrap_or("/etc/apache2/conf-available")
    }

    pub fn conf_enabled_dir(&self) -> &str {
        self.config
            .conf_enabled_dir
            .as_deref()
            .unwrap_or("/etc/apache2/conf-enabled")
    }

    // ── SSH command execution stub ───────────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> ApacheResult<SshOutput> {
        debug!("APACHE SSH [{}]: {}", self.config.host, command);

        let ssh_user = self.config.ssh_user.as_deref().unwrap_or("root");
        let port = self.config.port.unwrap_or(22);
        let timeout = self.config.timeout_secs.unwrap_or(30);

        let mut ssh_args = vec![
            "-o".to_string(),
            "StrictHostKeyChecking=accept-new".to_string(),
            "-o".to_string(),
            format!("ConnectTimeout={}", timeout),
            "-p".to_string(),
            port.to_string(),
        ];

        if let Some(ref key) = self.config.ssh_key {
            ssh_args.push("-i".to_string());
            ssh_args.push(key.clone());
        }

        if self.config.ssh_key.is_none() && self.config.ssh_password.is_none() {
            ssh_args.push("-o".to_string());
            ssh_args.push("BatchMode=yes".to_string());
        }

        let target = format!("{}@{}", ssh_user, self.config.host);
        ssh_args.push(target);
        ssh_args.push(command.to_string());

        let use_sshpass = self.config.ssh_password.is_some() && self.config.ssh_key.is_none();

        let mut cmd = if use_sshpass {
            let mut c = tokio::process::Command::new("sshpass");
            c.arg("-e").arg("ssh");
            c.args(&ssh_args);
            if let Some(ref pw) = self.config.ssh_password {
                c.env("SSHPASS", pw);
            }
            c
        } else {
            let mut c = tokio::process::Command::new("ssh");
            c.args(&ssh_args);
            c
        };

        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let output = cmd
            .output()
            .await
            .map_err(|e| ApacheError::ssh(format!("Failed to execute ssh: {}", e)))?;

        Ok(SshOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }

    pub async fn read_remote_file(&self, path: &str) -> ApacheResult<String> {
        let out = self
            .exec_ssh(&format!("cat '{}'", path.replace('\'', "'\\''")))
            .await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> ApacheResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee '{}' > /dev/null",
            escaped,
            path.replace('\'', "'\\''")
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> ApacheResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f '{}' && echo yes || echo no",
                path.replace('\'', "'\\''")
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    pub async fn list_remote_dir(&self, path: &str) -> ApacheResult<Vec<String>> {
        let out = self
            .exec_ssh(&format!("ls -1 '{}'", path.replace('\'', "'\\''")))
            .await?;
        Ok(out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect())
    }

    pub async fn create_symlink(&self, src: &str, dst: &str) -> ApacheResult<()> {
        self.exec_ssh(&format!(
            "sudo ln -sf '{}' '{}'",
            src.replace('\'', "'\\''"),
            dst.replace('\'', "'\\''")
        ))
        .await?;
        Ok(())
    }

    pub async fn remove_file(&self, path: &str) -> ApacheResult<()> {
        self.exec_ssh(&format!("sudo rm -f '{}'", path.replace('\'', "'\\''")))
            .await?;
        Ok(())
    }

    // ── Apache process commands ──────────────────────────────────────

    pub async fn test_config(&self) -> ApacheResult<ConfigTestResult> {
        let out = self
            .exec_ssh(&format!("sudo {} configtest 2>&1", self.apache_bin()))
            .await;
        match out {
            Ok(o) => Ok(ConfigTestResult {
                success: o.exit_code == 0,
                output: o.stdout,
                errors: if o.exit_code != 0 {
                    vec![o.stderr]
                } else {
                    vec![]
                },
                warnings: vec![],
            }),
            Err(_) => Ok(ConfigTestResult {
                success: false,
                output: String::new(),
                errors: vec!["Failed to execute configtest".into()],
                warnings: vec![],
            }),
        }
    }

    pub async fn reload(&self) -> ApacheResult<()> {
        let out = self
            .exec_ssh(&format!("sudo {} graceful", self.apache_bin()))
            .await?;
        if out.exit_code != 0 {
            return Err(ApacheError::reload(format!(
                "reload failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn start(&self) -> ApacheResult<()> {
        let out = self.exec_ssh("sudo systemctl start apache2").await?;
        if out.exit_code != 0 {
            return Err(ApacheError::process(format!(
                "start failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn stop(&self) -> ApacheResult<()> {
        let out = self.exec_ssh("sudo systemctl stop apache2").await?;
        if out.exit_code != 0 {
            return Err(ApacheError::process(format!("stop failed: {}", out.stderr)));
        }
        Ok(())
    }

    pub async fn restart(&self) -> ApacheResult<()> {
        let out = self.exec_ssh("sudo systemctl restart apache2").await?;
        if out.exit_code != 0 {
            return Err(ApacheError::process(format!(
                "restart failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn version(&self) -> ApacheResult<String> {
        let out = self
            .exec_ssh(&format!("{} -v 2>&1", self.apache_bin()))
            .await?;
        Ok(out.stdout.lines().next().unwrap_or("").trim().to_string())
    }

    pub async fn info(&self) -> ApacheResult<ApacheInfo> {
        let v_out = self
            .exec_ssh(&format!("{} -V 2>&1", self.apache_bin()))
            .await?;
        let raw = v_out.stdout;
        let version = raw
            .lines()
            .next()
            .unwrap_or("")
            .replace("Server version: ", "")
            .trim()
            .to_string();
        let mpm = raw
            .lines()
            .find(|l| l.contains("Server MPM:"))
            .map(|l| l.replace("Server MPM:", "").trim().to_string());
        Ok(ApacheInfo {
            version,
            mpm,
            built: None,
            server_root: self.config_path().to_string(),
            config_file: self.config_path().to_string(),
            compiled_modules: vec![],
            loaded_modules: vec![],
            architecture: None,
        })
    }

    pub async fn status(&self) -> ApacheResult<ApacheProcess> {
        let out = self.exec_ssh("systemctl is-active apache2 2>&1").await?;
        let active = out.stdout.trim() == "active";
        let pid_out = self
            .exec_ssh("cat /run/apache2/apache2.pid 2>/dev/null || echo 0")
            .await;
        let pid = pid_out
            .ok()
            .and_then(|o| o.stdout.trim().parse().ok())
            .unwrap_or(0);
        Ok(ApacheProcess {
            pid,
            ppid: None,
            process_type: if active {
                "active".into()
            } else {
                "inactive".into()
            },
            cpu_percent: None,
            memory_rss: None,
            uptime_secs: None,
        })
    }

    // ── Module management (Debian-style) ─────────────────────────────

    pub async fn enable_module(&self, module: &str) -> ApacheResult<()> {
        let out = self
            .exec_ssh(&format!("sudo a2enmod {} 2>&1", module))
            .await?;
        if out.exit_code != 0 {
            return Err(ApacheError::process(format!(
                "a2enmod {} failed: {}",
                module, out.stderr
            )));
        }
        Ok(())
    }

    pub async fn disable_module(&self, module: &str) -> ApacheResult<()> {
        let out = self
            .exec_ssh(&format!("sudo a2dismod {} 2>&1", module))
            .await?;
        if out.exit_code != 0 {
            return Err(ApacheError::process(format!(
                "a2dismod {} failed: {}",
                module, out.stderr
            )));
        }
        Ok(())
    }

    pub async fn enable_site(&self, site: &str) -> ApacheResult<()> {
        let out = self
            .exec_ssh(&format!("sudo a2ensite {} 2>&1", site))
            .await?;
        if out.exit_code != 0 {
            return Err(ApacheError::process(format!(
                "a2ensite {} failed: {}",
                site, out.stderr
            )));
        }
        Ok(())
    }

    pub async fn disable_site(&self, site: &str) -> ApacheResult<()> {
        let out = self
            .exec_ssh(&format!("sudo a2dissite {} 2>&1", site))
            .await?;
        if out.exit_code != 0 {
            return Err(ApacheError::process(format!(
                "a2dissite {} failed: {}",
                site, out.stderr
            )));
        }
        Ok(())
    }

    pub async fn enable_conf(&self, conf: &str) -> ApacheResult<()> {
        let out = self
            .exec_ssh(&format!("sudo a2enconf {} 2>&1", conf))
            .await?;
        if out.exit_code != 0 {
            return Err(ApacheError::process(format!(
                "a2enconf {} failed: {}",
                conf, out.stderr
            )));
        }
        Ok(())
    }

    pub async fn disable_conf(&self, conf: &str) -> ApacheResult<()> {
        let out = self
            .exec_ssh(&format!("sudo a2disconf {} 2>&1", conf))
            .await?;
        if out.exit_code != 0 {
            return Err(ApacheError::process(format!(
                "a2disconf {} failed: {}",
                conf, out.stderr
            )));
        }
        Ok(())
    }

    // ── mod_status (HTTP) ────────────────────────────────────────────

    pub async fn server_status(&self) -> ApacheResult<String> {
        let url = self
            .config
            .status_url
            .as_deref()
            .ok_or_else(|| ApacheError::not_connected("No status_url configured"))?;
        let auto_url = format!("{}?auto", url.trim_end_matches('?'));
        debug!("APACHE server-status GET {auto_url}");
        let resp = self
            .http
            .get(&auto_url)
            .send()
            .await
            .map_err(|e| ApacheError::http(format!("server-status: {e}")))?;
        resp.text()
            .await
            .map_err(|e| ApacheError::http(format!("body: {e}")))
    }

    // ── Ping ─────────────────────────────────────────────────────────

    pub async fn ping(&self) -> ApacheResult<ApacheConnectionSummary> {
        let version = self.version().await.ok();
        Ok(ApacheConnectionSummary {
            host: self.config.host.clone(),
            version,
            mpm: None,
            config_path: self.config_path().to_string(),
            server_root: None,
        })
    }
}

pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}
