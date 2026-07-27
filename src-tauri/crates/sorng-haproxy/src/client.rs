// ── sorng-haproxy – SSH + stats-socket + Data Plane API client ───────────────
//! Multi-transport client for HAProxy management.
//! Supports:  stats socket (Unix), stats HTTP endpoint, and the Data Plane API.

use crate::error::{HaproxyError, HaproxyErrorKind, HaproxyResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};
use std::sync::Arc;
use std::time::Duration;

#[async_trait::async_trait]
pub(crate) trait SshTransport: Send + Sync {
    async fn execute(&self, command: &str, timeout_ms: Option<u64>) -> Result<String, String>;
    async fn disconnect(&self) -> Result<(), String>;
}

#[async_trait::async_trait]
impl SshTransport for IntegrationSshSession {
    async fn execute(&self, command: &str, timeout_ms: Option<u64>) -> Result<String, String> {
        IntegrationSshSession::execute(self, command, timeout_ms).await
    }

    async fn disconnect(&self) -> Result<(), String> {
        IntegrationSshSession::disconnect(self).await
    }
}

pub struct HaproxyClient {
    pub config: HaproxyConnectionConfig,
    http: HttpClient,
    ssh: Arc<dyn SshTransport>,
}

impl HaproxyClient {
    pub fn new(config: HaproxyConnectionConfig) -> HaproxyResult<Self> {
        let ssh = Arc::new(IntegrationSshSession::new(ExternalSshConfig {
            host: &config.host,
            username: config.ssh_user.as_deref().unwrap_or("root"),
            port: config.port.unwrap_or(22),
            private_key: config.ssh_key.as_deref(),
            password: config.ssh_password.as_deref(),
            connect_timeout_secs: config.timeout_secs.unwrap_or(30),
        }));
        Self::with_transport(config, ssh)
    }

    fn with_transport(
        config: HaproxyConnectionConfig,
        ssh: Arc<dyn SshTransport>,
    ) -> HaproxyResult<Self> {
        let mut builder =
            HttpClient::builder().timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)));
        if let Some(proxy_url) = config
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|e| HaproxyError::connection(format!("invalid proxy URL: {e}")))?;
            builder = builder.proxy(proxy);
        }
        let http = builder
            .build()
            .map_err(|e| HaproxyError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http, ssh })
    }

    #[cfg(test)]
    pub(crate) fn with_test_transport(
        config: HaproxyConnectionConfig,
        ssh: Arc<dyn SshTransport>,
    ) -> HaproxyResult<Self> {
        Self::with_transport(config, ssh)
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
        if cmd
            .bytes()
            .any(|byte| matches!(byte, b'\r' | b'\n' | b'\0'))
        {
            return Err(HaproxyError::socket(
                "HAProxy runtime commands must not contain CR, LF, or NUL",
            ));
        }
        debug!("HAPROXY socket [{}]: {}", self.config.host, cmd);
        let remote_cmd = format!(
            "echo '{}' | sudo socat stdio {}",
            cmd.replace('\'', "'\\''"),
            shell_escape(self.stats_socket())
        );
        let out = self.exec_ssh(&remote_cmd).await?;
        validate_runtime_response(cmd, &out.stdout)?;
        Ok(out.stdout)
    }

    pub async fn exec_ssh(&self, command: &str) -> HaproxyResult<SshOutput> {
        debug!("HAPROXY SSH [{}]: {}", self.config.host, command);
        let stdout = self
            .ssh
            .execute(
                command,
                Some(self.config.timeout_secs.unwrap_or(30) * 1_000),
            )
            .await
            .map_err(HaproxyError::ssh)?;

        Ok(SshOutput {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    pub async fn disconnect(&self) -> HaproxyResult<()> {
        self.ssh.disconnect().await.map_err(HaproxyError::ssh)
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
            let body = resp
                .text()
                .await
                .map_err(|error| HaproxyError::http(format!("DP PUT error body: {error}")))?;
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
            let body = resp
                .text()
                .await
                .map_err(|error| HaproxyError::http(format!("DP DELETE error body: {error}")))?;
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
        let version = out.stdout.lines().next().unwrap_or("").trim();
        if version.is_empty() {
            return Err(HaproxyError::parse(
                "HAProxy version command returned empty output",
            ));
        }
        Ok(version.to_string())
    }

    pub async fn check_config(&self) -> HaproxyResult<ConfigValidationResult> {
        let path = self
            .config
            .config_path
            .as_deref()
            .unwrap_or("/etc/haproxy/haproxy.cfg");
        let out = self
            .exec_ssh(&format!("sudo haproxy -c -f {} 2>&1", shell_escape(path)))
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
            Err(error) if is_remote_command_failure(&error) => Ok(ConfigValidationResult {
                valid: false,
                output: String::new(),
                warnings: vec![],
                errors: vec![error.message],
            }),
            Err(error) => Err(error),
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

fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn is_remote_command_failure(error: &HaproxyError) -> bool {
    error.message.contains("Command failed with exit code")
}

fn validate_runtime_response(command: &str, response: &str) -> HaproxyResult<()> {
    let response = response.trim();
    let lower = response.to_ascii_lowercase();
    let failed = [
        "unknown command",
        "can't find",
        "cannot ",
        "error:",
        "failure:",
        "permission denied",
        "no such ",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix));
    if failed {
        return Err(HaproxyError::socket(format!(
            "HAProxy runtime command `{command}` failed: {response}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    struct FakeSshTransport {
        outcomes: Mutex<VecDeque<Result<String, String>>>,
        commands: Mutex<Vec<String>>,
    }

    impl FakeSshTransport {
        fn new(outcomes: Vec<Result<String, String>>) -> Self {
            Self {
                outcomes: Mutex::new(outcomes.into()),
                commands: Mutex::new(Vec::new()),
            }
        }

        fn commands(&self) -> Vec<String> {
            self.commands.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl SshTransport for FakeSshTransport {
        async fn execute(&self, command: &str, _: Option<u64>) -> Result<String, String> {
            self.commands.lock().unwrap().push(command.to_string());
            self.outcomes
                .lock()
                .unwrap()
                .pop_front()
                .expect("fake SSH outcome exhausted")
        }

        async fn disconnect(&self) -> Result<(), String> {
            Ok(())
        }
    }

    fn config() -> HaproxyConnectionConfig {
        HaproxyConnectionConfig {
            host: "haproxy.example.test".into(),
            port: Some(22),
            ssh_user: Some("admin".into()),
            ssh_password: None,
            ssh_key: None,
            stats_socket: Some("/run/haproxy/admin.sock".into()),
            stats_url: None,
            stats_user: None,
            stats_password: None,
            dataplane_url: None,
            dataplane_user: None,
            dataplane_password: None,
            config_path: None,
            timeout_secs: Some(5),
            proxy_url: None,
        }
    }

    #[tokio::test]
    async fn mandatory_file_write_preserves_nonzero_remote_failure() {
        let fake = Arc::new(FakeSshTransport::new(vec![Err(
            "Command failed with exit code 1: Permission denied".into(),
        )]));
        let client = HaproxyClient::with_test_transport(config(), fake).unwrap();

        let error = client
            .write_remote_file("/etc/haproxy/haproxy.cfg", "global")
            .await
            .unwrap_err();
        assert!(error.message.contains("Permission denied"));
    }

    #[tokio::test]
    async fn runtime_protocol_error_is_not_reported_as_success() {
        let fake = Arc::new(FakeSshTransport::new(vec![Ok(
            "Can't find map referenced by id #42".into(),
        )]));
        let client = HaproxyClient::with_test_transport(config(), fake).unwrap();

        let error = client.socket_cmd("clear map #42").await.unwrap_err();
        assert!(error.message.contains("clear map #42"));
        assert!(error.message.contains("Can't find map"));
    }

    #[tokio::test]
    async fn runtime_command_rejects_line_delimiters_before_ssh() {
        for command in [
            "show info\nshutdown sessions",
            "show info\r\nshow stat",
            "show\0info",
        ] {
            let fake = Arc::new(FakeSshTransport::new(vec![]));
            let client = HaproxyClient::with_test_transport(config(), fake.clone()).unwrap();

            let error = client.socket_cmd(command).await.unwrap_err();

            assert!(error.message.contains("CR, LF, or NUL"));
            assert!(fake.commands().is_empty());
        }
    }

    #[tokio::test]
    async fn config_check_shell_escapes_configured_path() {
        let fake = Arc::new(FakeSshTransport::new(vec![Ok(
            "Configuration file is valid".into(),
        )]));
        let mut config = config();
        config.config_path = Some("/etc/haproxy/haproxy.cfg; touch /tmp/pwned".into());
        let client = HaproxyClient::with_test_transport(config, fake.clone()).unwrap();

        assert!(client.check_config().await.unwrap().valid);
        assert_eq!(
            fake.commands(),
            vec![
                "sudo haproxy -c -f '/etc/haproxy/haproxy.cfg; touch /tmp/pwned' 2>&1".to_string()
            ]
        );
    }

    #[tokio::test]
    async fn empty_version_output_is_not_fabricated_success() {
        let fake = Arc::new(FakeSshTransport::new(vec![Ok(" \r\n".into())]));
        let client = HaproxyClient::with_test_transport(config(), fake).unwrap();

        let error = client.version().await.unwrap_err();

        assert!(error.message.contains("empty output"));
    }

    #[tokio::test]
    async fn config_check_keeps_application_detail_and_propagates_transport_failure() {
        let fake = Arc::new(FakeSshTransport::new(vec![
            Err("Command failed with exit code 1: parsing [/etc/haproxy.cfg:7]".into()),
            Err("broken pipe".into()),
        ]));
        let client = HaproxyClient::with_test_transport(config(), fake).unwrap();

        let invalid = client.check_config().await.unwrap();
        assert!(!invalid.valid);
        assert!(invalid.errors[0].contains("haproxy.cfg:7"));

        let transport_error = client.check_config().await.unwrap_err();
        assert!(transport_error.message.contains("broken pipe"));
    }
}
