// ── sorng-nginx – SSH/CLI client ─────────────────────────────────────────────
//! Executes nginx commands on a remote host via SSH.
//! Handles config file reading/writing, process management, and status queries.

use crate::error::{NginxError, NginxResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use std::time::Duration;

/// Nginx management client – connects via SSH to manage nginx remotely.
pub struct NginxClient {
    pub config: NginxConnectionConfig,
    http: HttpClient,
}

impl NginxClient {
    pub fn new(config: NginxConnectionConfig) -> NginxResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .build()
            .map_err(|e| NginxError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn nginx_bin(&self) -> &str {
        self.config.nginx_bin.as_deref().unwrap_or("nginx")
    }

    pub fn config_path(&self) -> &str {
        self.config.config_path.as_deref().unwrap_or("/etc/nginx/nginx.conf")
    }

    pub fn sites_available_dir(&self) -> &str {
        self.config.sites_available_dir.as_deref().unwrap_or("/etc/nginx/sites-available")
    }

    pub fn sites_enabled_dir(&self) -> &str {
        self.config.sites_enabled_dir.as_deref().unwrap_or("/etc/nginx/sites-enabled")
    }

    pub fn conf_d_dir(&self) -> &str {
        self.config.conf_d_dir.as_deref().unwrap_or("/etc/nginx/conf.d")
    }

    fn status_url(&self) -> Option<&str> {
        self.config.status_url.as_deref()
    }

    // ── SSH command execution stub ───────────────────────────────────
    //
    // In practice these would call through the app's SSH infrastructure.
    // We model them as async methods returning structured types.

    pub async fn exec_ssh(&self, command: &str) -> NginxResult<SshOutput> {
        debug!("NGX SSH [{}]: {}", self.config.host, command);
        // Stub: actual implementation would use the SSH subsystem
        Err(NginxError::ssh(format!(
            "SSH execution not connected to {}. Command: {}",
            self.config.host, command
        )))
    }

    pub async fn read_remote_file(&self, path: &str) -> NginxResult<String> {
        let out = self.exec_ssh(&format!("cat {}", shell_escape(path))).await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> NginxResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!("printf '%s' '{}' | sudo tee {} > /dev/null", escaped, shell_escape(path));
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> NginxResult<bool> {
        let out = self.exec_ssh(&format!("test -f {} && echo yes || echo no", shell_escape(path))).await?;
        Ok(out.stdout.trim() == "yes")
    }

    pub async fn list_remote_dir(&self, path: &str) -> NginxResult<Vec<String>> {
        let out = self.exec_ssh(&format!("ls -1 {}", shell_escape(path))).await?;
        Ok(out.stdout.lines().filter(|l| !l.is_empty()).map(String::from).collect())
    }

    pub async fn create_symlink(&self, src: &str, dst: &str) -> NginxResult<()> {
        self.exec_ssh(&format!("sudo ln -sf {} {}", shell_escape(src), shell_escape(dst))).await?;
        Ok(())
    }

    pub async fn remove_file(&self, path: &str) -> NginxResult<()> {
        self.exec_ssh(&format!("sudo rm -f {}", shell_escape(path))).await?;
        Ok(())
    }

    // ── Nginx process commands ───────────────────────────────────────

    pub async fn test_config(&self) -> NginxResult<ConfigTestResult> {
        let out = self.exec_ssh(&format!("sudo {} -t 2>&1", self.nginx_bin())).await;
        match out {
            Ok(o) => Ok(ConfigTestResult {
                success: o.exit_code == 0,
                output: o.stdout,
                errors: if o.exit_code != 0 { vec![o.stderr] } else { vec![] },
            }),
            Err(_) => Ok(ConfigTestResult {
                success: false,
                output: String::new(),
                errors: vec!["Failed to execute nginx -t".into()],
            }),
        }
    }

    pub async fn reload(&self) -> NginxResult<()> {
        let out = self.exec_ssh(&format!("sudo {} -s reload", self.nginx_bin())).await?;
        if out.exit_code != 0 {
            return Err(NginxError::reload(format!("reload failed: {}", out.stderr)));
        }
        Ok(())
    }

    pub async fn start(&self) -> NginxResult<()> {
        let out = self.exec_ssh("sudo systemctl start nginx").await?;
        if out.exit_code != 0 {
            return Err(NginxError::process(format!("start failed: {}", out.stderr)));
        }
        Ok(())
    }

    pub async fn stop(&self) -> NginxResult<()> {
        let out = self.exec_ssh("sudo systemctl stop nginx").await?;
        if out.exit_code != 0 {
            return Err(NginxError::process(format!("stop failed: {}", out.stderr)));
        }
        Ok(())
    }

    pub async fn restart(&self) -> NginxResult<()> {
        let out = self.exec_ssh("sudo systemctl restart nginx").await?;
        if out.exit_code != 0 {
            return Err(NginxError::process(format!("restart failed: {}", out.stderr)));
        }
        Ok(())
    }

    pub async fn version(&self) -> NginxResult<String> {
        let out = self.exec_ssh(&format!("{} -v 2>&1", self.nginx_bin())).await?;
        Ok(out.stdout.trim().to_string())
    }

    pub async fn info(&self) -> NginxResult<NginxInfo> {
        let version_out = self.exec_ssh(&format!("{} -V 2>&1", self.nginx_bin())).await?;
        let raw = version_out.stdout;
        let version = raw.lines().next().unwrap_or("").replace("nginx version: ", "").trim().to_string();
        let config_args = raw.lines()
            .find(|l| l.contains("configure arguments:"))
            .map(|l| l.replace("configure arguments:", "").trim().to_string());
        Ok(NginxInfo {
            version,
            config_path: self.config_path().to_string(),
            config_args,
            modules: vec![],
        })
    }

    pub async fn status(&self) -> NginxResult<NginxProcess> {
        let out = self.exec_ssh("systemctl is-active nginx 2>&1").await?;
        let active = out.stdout.trim() == "active";
        let pid_out = self.exec_ssh("cat /run/nginx.pid 2>/dev/null || echo 0").await;
        let pid = pid_out.ok().and_then(|o| o.stdout.trim().parse().ok()).unwrap_or(0);
        Ok(NginxProcess {
            running: active,
            pid,
            uptime: None,
            worker_count: None,
        })
    }

    // ── Stub status (HTTP) ───────────────────────────────────────────

    pub async fn stub_status(&self) -> NginxResult<NginxStubStatus> {
        let url = self.status_url()
            .ok_or_else(|| NginxError::not_connected("No status_url configured".into()))?;

        debug!("NGX stub_status GET {url}");
        let resp = self.http.get(url).send().await
            .map_err(|e| NginxError::http(format!("stub_status: {e}")))?;
        let body = resp.text().await
            .map_err(|e| NginxError::http(format!("stub_status body: {e}")))?;

        parse_stub_status(&body)
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn parse_stub_status(body: &str) -> NginxResult<NginxStubStatus> {
    // Active connections: 291
    // server accepts handled requests
    //  16630948 16630948 31070465
    // Reading: 6  Writing: 179  Waiting: 106
    let mut active = 0u64;
    let mut accepts = 0u64;
    let mut handled = 0u64;
    let mut requests = 0u64;
    let mut reading = 0u64;
    let mut writing = 0u64;
    let mut waiting = 0u64;

    for line in body.lines() {
        let line = line.trim();
        if line.starts_with("Active connections:") {
            active = line.split(':').nth(1).and_then(|s| s.trim().parse().ok()).unwrap_or(0);
        } else if line.starts_with("Reading:") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            reading = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            writing = parts.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);
            waiting = parts.get(5).and_then(|s| s.parse().ok()).unwrap_or(0);
        } else if let Some(first_char) = line.chars().next() {
            if first_char.is_ascii_digit() {
                let nums: Vec<&str> = line.split_whitespace().collect();
                if nums.len() >= 3 {
                    accepts = nums[0].parse().unwrap_or(0);
                    handled = nums[1].parse().unwrap_or(0);
                    requests = nums[2].parse().unwrap_or(0);
                }
            }
        }
    }

    Ok(NginxStubStatus {
        active_connections: active,
        accepts,
        handled,
        requests,
        reading,
        writing,
        waiting,
    })
}
