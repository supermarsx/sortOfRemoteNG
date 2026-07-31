// ── sorng-nginx – SSH/CLI client ─────────────────────────────────────────────
//! Executes nginx commands on a remote host via SSH.
//! Handles config file reading/writing, process management, and status queries.

use crate::error::{NginxError, NginxResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
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

/// Nginx management client – connects via SSH to manage nginx remotely.
pub struct NginxClient {
    pub config: NginxConnectionConfig,
    http: HttpClient,
    ssh: Arc<dyn SshTransport>,
}

impl NginxClient {
    pub fn new(config: NginxConnectionConfig) -> NginxResult<Self> {
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
        config: NginxConnectionConfig,
        ssh: Arc<dyn SshTransport>,
    ) -> NginxResult<Self> {
        if let Some(binary) = config.nginx_bin.as_deref() {
            validate_executable(binary, "nginx_bin")?;
        }
        let mut builder =
            HttpClient::builder().timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)));
        if let Some(proxy_url) = config
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|e| NginxError::connection(format!("invalid proxy URL: {e}")))?;
            builder = builder.proxy(proxy);
        }
        let http = builder
            .build()
            .map_err(|e| NginxError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http, ssh })
    }

    #[cfg(test)]
    pub(crate) fn with_test_transport(
        config: NginxConnectionConfig,
        ssh: Arc<dyn SshTransport>,
    ) -> NginxResult<Self> {
        Self::with_transport(config, ssh)
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn nginx_bin(&self) -> &str {
        self.config.nginx_bin.as_deref().unwrap_or("nginx")
    }

    pub fn config_path(&self) -> &str {
        self.config
            .config_path
            .as_deref()
            .unwrap_or("/etc/nginx/nginx.conf")
    }

    pub fn sites_available_dir(&self) -> &str {
        self.config
            .sites_available_dir
            .as_deref()
            .unwrap_or("/etc/nginx/sites-available")
    }

    pub fn sites_enabled_dir(&self) -> &str {
        self.config
            .sites_enabled_dir
            .as_deref()
            .unwrap_or("/etc/nginx/sites-enabled")
    }

    pub fn conf_d_dir(&self) -> &str {
        self.config
            .conf_d_dir
            .as_deref()
            .unwrap_or("/etc/nginx/conf.d")
    }

    pub(crate) fn status_url(&self) -> Option<&str> {
        self.config.status_url.as_deref()
    }

    // ── SSH command execution stub ───────────────────────────────────
    //
    // In practice these would call through the app's SSH infrastructure.
    // We model them as async methods returning structured types.

    pub async fn exec_ssh(&self, command: &str) -> NginxResult<SshOutput> {
        debug!("Executing Nginx SSH command on {}", self.config.host);
        let stdout = self
            .ssh
            .execute(
                command,
                Some(self.config.timeout_secs.unwrap_or(30) * 1_000),
            )
            .await
            .map_err(NginxError::ssh)?;

        Ok(SshOutput {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    pub async fn disconnect(&self) -> NginxResult<()> {
        self.ssh.disconnect().await.map_err(NginxError::ssh)
    }

    pub async fn read_remote_file(&self, path: &str) -> NginxResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> NginxResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> NginxResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    pub async fn list_remote_dir(&self, path: &str) -> NginxResult<Vec<String>> {
        let out = self
            .exec_ssh(&format!("ls -1 {}", shell_escape(path)))
            .await?;
        Ok(out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect())
    }

    /// List a directory that is allowed to be absent, while preserving all
    /// transport, permission, and wrong-file-type errors.
    pub async fn list_remote_dir_if_exists(&self, path: &str) -> NginxResult<Option<Vec<String>>> {
        const MISSING: &str = "__SORNG_DIRECTORY_NOT_FOUND__";
        let escaped = shell_escape(path);
        let out = self
            .exec_ssh(&format!(
                "if [ -d {escaped} ]; then ls -1 -- {escaped}; elif [ ! -e {escaped} ]; then printf '%s' '{MISSING}'; else echo 'Path is not a directory: {escaped}' >&2; exit 1; fi"
            ))
            .await?;
        if out.stdout == MISSING {
            Ok(None)
        } else {
            Ok(Some(
                out.stdout
                    .lines()
                    .filter(|line| !line.is_empty())
                    .map(String::from)
                    .collect(),
            ))
        }
    }

    pub async fn create_symlink(&self, src: &str, dst: &str) -> NginxResult<()> {
        self.exec_ssh(&format!(
            "sudo ln -sf {} {}",
            shell_escape(src),
            shell_escape(dst)
        ))
        .await?;
        Ok(())
    }

    pub async fn remove_file(&self, path: &str) -> NginxResult<()> {
        self.exec_ssh(&format!("sudo rm -f {}", shell_escape(path)))
            .await?;
        Ok(())
    }

    // ── Nginx process commands ───────────────────────────────────────

    pub async fn test_config(&self) -> NginxResult<ConfigTestResult> {
        let out = self
            .exec_ssh(&format!("sudo {} -t 2>&1", self.nginx_bin()))
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
            Err(error) if is_remote_command_failure(&error) => Ok(ConfigTestResult {
                success: false,
                output: String::new(),
                errors: vec![error.message],
                warnings: vec![],
            }),
            Err(error) => Err(error),
        }
    }

    pub async fn reload(&self) -> NginxResult<()> {
        let out = self
            .exec_ssh(&format!("sudo {} -s reload", self.nginx_bin()))
            .await?;
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
            return Err(NginxError::process(format!(
                "restart failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn version(&self) -> NginxResult<String> {
        let out = self
            .exec_ssh(&format!("{} -v 2>&1", self.nginx_bin()))
            .await?;
        Ok(out.stdout.trim().to_string())
    }

    pub async fn info(&self) -> NginxResult<NginxInfo> {
        let version_out = self
            .exec_ssh(&format!("{} -V 2>&1", self.nginx_bin()))
            .await?;
        let raw = version_out.stdout;
        let version = raw
            .lines()
            .next()
            .unwrap_or("")
            .replace("nginx version: ", "")
            .trim()
            .to_string();
        let config_args = raw
            .lines()
            .find(|l| l.contains("configure arguments:"))
            .map(|l| l.replace("configure arguments:", "").trim().to_string());
        Ok(NginxInfo {
            version,
            compiler: None,
            configure_arguments: config_args.map(|a| vec![a]).unwrap_or_default(),
            modules: vec![],
            prefix: None,
            config_path: self.config_path().to_string(),
            pid_path: None,
            error_log: None,
        })
    }

    pub async fn status(&self) -> NginxResult<NginxProcess> {
        let out = self
            .exec_ssh("systemctl show nginx --property=ActiveState --value")
            .await?;
        let active = out.stdout.trim() == "active";
        let pid_out = self
            .exec_ssh(
                "if [ -f /run/nginx.pid ]; then cat /run/nginx.pid; elif [ ! -e /run/nginx.pid ]; then echo 0; else echo 'nginx PID path is not a regular file' >&2; exit 1; fi",
            )
            .await?;
        let pid = pid_out.stdout.trim().parse().map_err(|error| {
            NginxError::parse(format!(
                "Invalid nginx PID {:?}: {error}",
                pid_out.stdout.trim()
            ))
        })?;
        Ok(NginxProcess {
            pid,
            ppid: None,
            process_type: if active {
                "master".into()
            } else {
                "inactive".into()
            },
            cpu_percent: None,
            memory_rss: None,
            connections: None,
            uptime_secs: None,
        })
    }

    // ── Stub status (HTTP) ───────────────────────────────────────────

    pub async fn stub_status(&self) -> NginxResult<NginxStubStatus> {
        let url = self
            .status_url()
            .ok_or_else(|| NginxError::not_connected("No status_url configured"))?;

        debug!("NGX stub_status GET {url}");
        let resp = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|e| NginxError::http(format!("stub_status: {e}")))?;
        let body = resp
            .text()
            .await
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

fn validate_executable(value: &str, field: &str) -> NginxResult<()> {
    let is_absolute = value.starts_with('/');
    let is_identifier = !value.contains('/');
    let has_safe_characters = value.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'+' | b'/')
    });
    let starts_safely = value
        .as_bytes()
        .first()
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'/');

    if value.is_empty()
        || value.trim() != value
        || (!is_absolute && !is_identifier)
        || !has_safe_characters
        || !starts_safely
        || value.split('/').any(|segment| segment == "..")
    {
        return Err(NginxError::parse(format!(
            "{field} must be a command identifier or absolute path containing only safe characters"
        )));
    }
    Ok(())
}

fn is_remote_command_failure(error: &NginxError) -> bool {
    error.message.contains("Command failed with exit code")
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
            active = line
                .split(':')
                .nth(1)
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0);
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

#[cfg(test)]
pub(crate) mod test_support {
    use super::SshTransport;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    pub(crate) struct FakeSshTransport {
        outcomes: Mutex<VecDeque<Result<String, String>>>,
        commands: Mutex<Vec<String>>,
    }

    impl FakeSshTransport {
        pub(crate) fn new(outcomes: Vec<Result<String, String>>) -> Self {
            Self {
                outcomes: Mutex::new(outcomes.into()),
                commands: Mutex::new(Vec::new()),
            }
        }

        pub(crate) fn commands(&self) -> Vec<String> {
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
}

#[cfg(test)]
mod tests {
    use super::test_support::FakeSshTransport;
    use super::*;

    fn config() -> NginxConnectionConfig {
        NginxConnectionConfig {
            host: "nginx.example.test".into(),
            port: Some(22),
            ssh_user: Some("admin".into()),
            ssh_password: None,
            ssh_key: None,
            nginx_bin: None,
            config_path: None,
            sites_available_dir: None,
            sites_enabled_dir: None,
            conf_d_dir: None,
            status_url: None,
            timeout_secs: Some(5),
            proxy_url: None,
        }
    }

    #[tokio::test]
    async fn mandatory_remote_read_and_write_preserve_ssh_failures() {
        let fake = Arc::new(FakeSshTransport::new(vec![
            Err("Command failed with exit code 1: Permission denied".into()),
            Err("Command failed with exit code 1: disk full".into()),
        ]));
        let client = NginxClient::with_test_transport(config(), fake.clone()).unwrap();

        let read_error = client
            .read_remote_file("/etc/nginx/nginx.conf")
            .await
            .unwrap_err();
        assert!(read_error.message.contains("Permission denied"));

        let write_error = client
            .write_remote_file("/etc/nginx/nginx.conf", "events {}")
            .await
            .unwrap_err();
        assert!(write_error.message.contains("disk full"));
        assert_eq!(fake.commands().len(), 2);
    }

    #[tokio::test]
    async fn optional_directory_distinguishes_absence_from_remote_failure() {
        let fake = Arc::new(FakeSshTransport::new(vec![
            Ok("__SORNG_DIRECTORY_NOT_FOUND__".into()),
            Err("Command failed with exit code 2: Permission denied".into()),
        ]));
        let client = NginxClient::with_test_transport(config(), fake).unwrap();

        assert!(client
            .list_remote_dir_if_exists("/etc/nginx/sites-enabled")
            .await
            .unwrap()
            .is_none());
        let error = client
            .list_remote_dir_if_exists("/root/private")
            .await
            .unwrap_err();
        assert!(error.message.contains("Permission denied"));
    }

    #[tokio::test]
    async fn config_test_reports_application_error_but_propagates_transport_error() {
        let fake = Arc::new(FakeSshTransport::new(vec![
            Err("Command failed with exit code 1: nginx: invalid directive".into()),
            Err("connection reset by peer".into()),
        ]));
        let client = NginxClient::with_test_transport(config(), fake).unwrap();

        let invalid = client.test_config().await.unwrap();
        assert!(!invalid.success);
        assert!(invalid.errors[0].contains("invalid directive"));

        let transport_error = client.test_config().await.unwrap_err();
        assert!(transport_error.message.contains("connection reset"));
    }

    #[test]
    fn rejects_injectable_nginx_executable_before_any_ssh_command() {
        let fake = Arc::new(FakeSshTransport::new(vec![]));
        let mut config = config();
        config.nginx_bin = Some("nginx; touch /tmp/pwned".into());

        let error = match NginxClient::with_test_transport(config, fake.clone()) {
            Ok(_) => panic!("injectable nginx_bin must be rejected"),
            Err(error) => error,
        };

        assert!(error.message.contains("nginx_bin"));
        assert!(fake.commands().is_empty());
    }
}
