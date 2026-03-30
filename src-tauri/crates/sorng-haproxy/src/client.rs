// ── sorng-haproxy – SSH + stats-socket + Data Plane API client ───────────────
//! Multi-transport client for HAProxy management.
//! Supports:  stats socket (Unix), stats HTTP endpoint, and the Data Plane API.

use crate::error::{HaproxyError, HaproxyErrorKind, HaproxyResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

pub struct HaproxyClient {
    pub config: HaproxyConnectionConfig,
    http: HttpClient,
}

impl HaproxyClient {
    pub fn new(config: HaproxyConnectionConfig) -> HaproxyResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .build()
            .map_err(|e| HaproxyError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── Stats socket helpers (stub – would go through SSH) ───────────

    pub fn stats_socket(&self) -> &str {
        self.config
            .stats_socket
            .as_deref()
            .unwrap_or("/var/run/haproxy/admin.sock")
    }

    /// Execute a command on the HAProxy stats socket via SSH.
    pub async fn socket_cmd(&self, cmd: &str) -> HaproxyResult<String> {
        debug!("HAPROXY socket [{}]: {}", self.config.host, cmd);
        let remote_cmd = format!(
            "echo '{}' | sudo socat stdio {}",
            cmd.replace('\'', "'\\''"),
            self.stats_socket()
        );
        let out = self.exec_ssh(&remote_cmd).await?;
        Ok(out.stdout)
    }

    pub async fn exec_ssh(&self, command: &str) -> HaproxyResult<SshOutput> {
        debug!("HAPROXY SSH [{}]: {}", self.config.host, command);

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
            .map_err(|e| HaproxyError::ssh(format!("Failed to execute ssh: {}", e)))?;

        Ok(SshOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }

    pub async fn read_remote_file(&self, path: &str) -> HaproxyResult<String> {
        let out = self
            .exec_ssh(&format!("cat '{}'", path.replace('\'', "'\\''")))
            .await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> HaproxyResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee '{}' > /dev/null",
            escaped,
            path.replace('\'', "'\\''")
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    // ── Stats HTTP endpoint ──────────────────────────────────────────

    pub async fn stats_http_csv(&self) -> HaproxyResult<String> {
        let url = self
            .config
            .stats_url
            .as_deref()
            .ok_or_else(|| HaproxyError::not_connected("No stats_url configured"))?;
        let csv_url = format!("{};csv", url.trim_end_matches(';'));
        debug!("HAPROXY stats CSV GET {csv_url}");
        let mut req = self.http.get(&csv_url);
        if let (Some(ref u), Some(ref p)) = (&self.config.stats_user, &self.config.stats_password) {
            req = req.basic_auth(u, Some(p));
        }
        let resp = req
            .send()
            .await
            .map_err(|e| HaproxyError::http(format!("stats: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(HaproxyError::http(format!("stats HTTP {status}")));
        }
        resp.text()
            .await
            .map_err(|e| HaproxyError::http(format!("stats body: {e}")))
    }

    // ── Data Plane API helpers ───────────────────────────────────────

    fn dp_url(&self, path: &str) -> HaproxyResult<String> {
        let base = self
            .config
            .dataplane_url
            .as_deref()
            .ok_or_else(|| HaproxyError::not_connected("No dataplane_url configured"))?;
        Ok(format!("{}/v2{}", base.trim_end_matches('/'), path))
    }

    fn apply_dp_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let (Some(ref u), Some(ref p)) =
            (&self.config.dataplane_user, &self.config.dataplane_password)
        {
            req.basic_auth(u, Some(p))
        } else {
            req
        }
    }

    pub async fn dp_get<T: DeserializeOwned>(&self, path: &str) -> HaproxyResult<T> {
        let url = self.dp_url(path)?;
        debug!("HAPROXY DP GET {url}");
        let resp = self
            .apply_dp_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| HaproxyError::http(format!("DP GET {url}: {e}")))?;
        self.handle_dp_response(resp).await
    }

    pub async fn dp_post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> HaproxyResult<T> {
        let url = self.dp_url(path)?;
        debug!("HAPROXY DP POST {url}");
        let resp = self
            .apply_dp_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| HaproxyError::http(format!("DP POST {url}: {e}")))?;
        self.handle_dp_response(resp).await
    }

    pub async fn dp_put<B: Serialize>(&self, path: &str, body: &B) -> HaproxyResult<()> {
        let url = self.dp_url(path)?;
        debug!("HAPROXY DP PUT {url}");
        let resp = self
            .apply_dp_auth(self.http.put(&url).json(body))
            .send()
            .await
            .map_err(|e| HaproxyError::http(format!("DP PUT {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_dp_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn dp_delete(&self, path: &str) -> HaproxyResult<()> {
        let url = self.dp_url(path)?;
        debug!("HAPROXY DP DELETE {url}");
        let resp = self
            .apply_dp_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| HaproxyError::http(format!("DP DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_dp_error(status.as_u16(), &body));
        }
        Ok(())
    }

    // ── Process management (via SSH) ─────────────────────────────────

    pub async fn reload(&self) -> HaproxyResult<()> {
        let out = self.exec_ssh("sudo systemctl reload haproxy").await?;
        if out.exit_code != 0 {
            return Err(HaproxyError::reload(format!(
                "reload failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn start(&self) -> HaproxyResult<()> {
        let out = self.exec_ssh("sudo systemctl start haproxy").await?;
        if out.exit_code != 0 {
            return Err(HaproxyError::socket(format!(
                "start failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn stop(&self) -> HaproxyResult<()> {
        let out = self.exec_ssh("sudo systemctl stop haproxy").await?;
        if out.exit_code != 0 {
            return Err(HaproxyError::socket(format!("stop failed: {}", out.stderr)));
        }
        Ok(())
    }

    pub async fn restart(&self) -> HaproxyResult<()> {
        let out = self.exec_ssh("sudo systemctl restart haproxy").await?;
        if out.exit_code != 0 {
            return Err(HaproxyError::socket(format!(
                "restart failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn version(&self) -> HaproxyResult<String> {
        let out = self.exec_ssh("haproxy -v 2>&1").await?;
        Ok(out.stdout.lines().next().unwrap_or("").trim().to_string())
    }

    pub async fn check_config(&self) -> HaproxyResult<ConfigValidationResult> {
        let path = self
            .config
            .config_path
            .as_deref()
            .unwrap_or("/etc/haproxy/haproxy.cfg");
        let out = self
            .exec_ssh(&format!("sudo haproxy -c -f {} 2>&1", path))
            .await;
        match out {
            Ok(o) => Ok(ConfigValidationResult {
                valid: o.exit_code == 0,
                output: o.stdout,
                warnings: vec![],
                errors: if o.exit_code != 0 {
                    vec![o.stderr]
                } else {
                    vec![]
                },
            }),
            Err(_) => Ok(ConfigValidationResult {
                valid: false,
                output: String::new(),
                warnings: vec![],
                errors: vec!["Failed to execute haproxy -c".into()],
            }),
        }
    }

    // ── Runtime commands via stats socket ─────────────────────────────

    pub async fn show_info(&self) -> HaproxyResult<String> {
        self.socket_cmd("show info").await
    }

    pub async fn show_stat(&self) -> HaproxyResult<String> {
        self.socket_cmd("show stat").await
    }

    pub async fn show_servers_state(&self) -> HaproxyResult<String> {
        self.socket_cmd("show servers state").await
    }

    pub async fn show_backend(&self) -> HaproxyResult<String> {
        self.socket_cmd("show backend").await
    }

    pub async fn set_server(
        &self,
        backend: &str,
        server: &str,
        action: &str,
    ) -> HaproxyResult<String> {
        self.socket_cmd(&format!("set server {}/{} {}", backend, server, action))
            .await
    }

    pub async fn show_sess(&self) -> HaproxyResult<String> {
        self.socket_cmd("show sess").await
    }

    pub async fn show_table(&self, table: &str) -> HaproxyResult<String> {
        self.socket_cmd(&format!("show table {}", table)).await
    }

    pub async fn show_acl(&self, acl_id: &str) -> HaproxyResult<String> {
        self.socket_cmd(&format!("show acl #{}", acl_id)).await
    }

    pub async fn show_map(&self, map_id: &str) -> HaproxyResult<String> {
        self.socket_cmd(&format!("show map #{}", map_id)).await
    }

    pub async fn add_map_entry(
        &self,
        map_id: &str,
        key: &str,
        value: &str,
    ) -> HaproxyResult<String> {
        self.socket_cmd(&format!("add map #{} {} {}", map_id, key, value))
            .await
    }

    pub async fn del_map_entry(&self, map_id: &str, key: &str) -> HaproxyResult<String> {
        self.socket_cmd(&format!("del map #{} {}", map_id, key))
            .await
    }

    // ── Ping ─────────────────────────────────────────────────────────

    pub async fn ping(&self) -> HaproxyResult<HaproxyConnectionSummary> {
        // Try Data Plane API first, fall back to stats socket
        let version = if self.config.dataplane_url.is_some() {
            let info: serde_json::Value = self.dp_get("/info").await?;
            info.get("haproxy")
                .and_then(|h| h.get("version"))
                .and_then(|v| v.as_str())
                .map(String::from)
        } else {
            None
        };
        Ok(HaproxyConnectionSummary {
            host: self.config.host.clone(),
            version,
            node_name: None,
            release_date: None,
            uptime_secs: None,
            process_num: None,
            pid: None,
        })
    }

    // ── Response handling ────────────────────────────────────────────

    async fn handle_dp_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> HaproxyResult<T> {
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| HaproxyError::http(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(self.map_dp_error(status.as_u16(), &body_text));
        }
        serde_json::from_str(&body_text)
            .map_err(|e| HaproxyError::http(format!("json: {e}\nBody: {body_text}")))
    }

    fn map_dp_error(&self, status: u16, body: &str) -> HaproxyError {
        let kind = match status {
            401 | 403 => HaproxyErrorKind::AuthenticationFailed,
            404 => HaproxyErrorKind::BackendNotFound,
            409 => HaproxyErrorKind::ReloadFailed,
            _ => HaproxyErrorKind::HttpError,
        };
        HaproxyError {
            kind,
            message: format!("HTTP {status}: {body}"),
        }
    }
}

pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}
