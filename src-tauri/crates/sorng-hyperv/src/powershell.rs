//! PowerShell execution engine for Hyper-V cmdlets.
//!
//! Wraps `tokio::process::Command` to invoke PowerShell with the Hyper-V
//! module and parse JSON output. Supports both local and remote execution
//! via `Invoke-Command -ComputerName`.

use crate::error::{HyperVError, HyperVErrorKind, HyperVResult};
use crate::types::HyperVConfig;
use log::{debug, trace, warn};
use std::{net::IpAddr, path::Path, time::Duration};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

const MAX_SCRIPT_BYTES: usize = 1024 * 1024;
const MAX_STDOUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 512 * 1024;
const MAX_DIAGNOSTIC_CHARS: usize = 2_048;
const MAX_TIMEOUT_SECONDS: u64 = 300;
const MAX_PASSWORD_BYTES: usize = 16 * 1024;

struct SensitiveBytes(Vec<u8>);

impl AsRef<[u8]> for SensitiveBytes {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for SensitiveBytes {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

async fn read_bounded<R: AsyncRead + Unpin>(reader: R, limit: usize) -> std::io::Result<Vec<u8>> {
    let mut output = Vec::with_capacity(limit.min(64 * 1024));
    reader
        .take(limit.saturating_add(1) as u64)
        .read_to_end(&mut output)
        .await?;
    Ok(output)
}

/// Result of a PowerShell invocation.
#[derive(Debug, Clone)]
pub struct PsOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

impl PsOutput {
    /// Whether the command completed successfully (exit 0, no fatal stderr).
    pub fn success(&self) -> bool {
        self.exit_code == 0
    }

    /// Parse stdout as a JSON value.
    pub fn parse_json(&self) -> HyperVResult<serde_json::Value> {
        let trimmed = self.stdout.trim();
        if trimmed.is_empty() {
            return Ok(serde_json::Value::Null);
        }
        serde_json::from_str(trimmed).map_err(|e| {
            HyperVError::with_details(
                HyperVErrorKind::ParseError,
                format!("Failed to parse PowerShell JSON output: {}", e),
                "PowerShell output omitted from diagnostics",
            )
        })
    }

    /// Parse stdout as a typed object.
    pub fn parse_json_as<T: serde::de::DeserializeOwned>(&self) -> HyperVResult<T> {
        let trimmed = self.stdout.trim();
        if trimmed.is_empty() {
            return Err(HyperVError::parse("Empty PowerShell output"));
        }
        serde_json::from_str(trimmed).map_err(|e| {
            HyperVError::with_details(
                HyperVErrorKind::ParseError,
                format!("Failed to deserialize: {}", e),
                "PowerShell output omitted from diagnostics",
            )
        })
    }

    /// Parse stdout, but if it is empty or null return an empty Vec.
    pub fn parse_json_array<T: serde::de::DeserializeOwned>(&self) -> HyperVResult<Vec<T>> {
        let trimmed = self.stdout.trim();
        if trimmed.is_empty() || trimmed == "null" {
            return Ok(Vec::new());
        }
        // PowerShell ConvertTo-Json returns a bare object when N=1, array when N>1
        if trimmed.starts_with('[') {
            serde_json::from_str(trimmed).map_err(|e| {
                HyperVError::with_details(
                    HyperVErrorKind::ParseError,
                    format!("Failed to parse JSON array: {}", e),
                    "PowerShell output omitted from diagnostics",
                )
            })
        } else {
            // Single object → wrap in vec
            let item: T = serde_json::from_str(trimmed).map_err(|e| {
                HyperVError::with_details(
                    HyperVErrorKind::ParseError,
                    format!("Failed to parse JSON object: {}", e),
                    "PowerShell output omitted from diagnostics",
                )
            })?;
            Ok(vec![item])
        }
    }
}

// ─── Executor ────────────────────────────────────────────────────────

/// PowerShell executor for Hyper-V management.
pub struct PsExecutor {
    config: HyperVConfig,
}

impl PsExecutor {
    /// Create a new executor from configuration.
    pub fn new(config: &HyperVConfig) -> Self {
        Self {
            config: config.clone(),
        }
    }

    /// Update the config in-place (e.g. after the user changes settings).
    pub fn set_config(&mut self, config: HyperVConfig) {
        self.config = config;
    }

    fn validate_config(&self) -> HyperVResult<()> {
        let executable = self.config.powershell_path.trim();
        let executable_name = Path::new(executable)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if executable.is_empty()
            || executable != self.config.powershell_path
            || executable.len() > 260
            || executable.chars().any(char::is_control)
            || !matches!(
                executable_name.as_str(),
                "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe"
            )
        {
            return Err(HyperVError::new(
                HyperVErrorKind::PowerShellError,
                "The configured PowerShell executable is not allowed",
            ));
        }

        let target = self.config.target_host.trim();
        if target != self.config.target_host
            || (!target.is_empty() && !Self::valid_remote_target(target))
        {
            return Err(HyperVError::new(
                HyperVErrorKind::ConnectionError,
                "The Hyper-V target host is invalid",
            ));
        }

        if let Some(credential) = &self.config.credential {
            if credential.username.is_empty()
                || credential.username.len() > 256
                || credential
                    .username
                    .chars()
                    .any(|c| matches!(c, '\0' | '\r' | '\n'))
            {
                return Err(HyperVError::new(
                    HyperVErrorKind::ConnectionError,
                    "The Hyper-V credential username is invalid",
                ));
            }
            if credential.password.len() > MAX_PASSWORD_BYTES
                || credential
                    .password
                    .chars()
                    .any(|c| matches!(c, '\0' | '\r' | '\n'))
            {
                return Err(HyperVError::new(
                    HyperVErrorKind::ConnectionError,
                    "The Hyper-V credential password is invalid",
                ));
            }
            if credential.domain.as_ref().is_some_and(|domain| {
                domain.len() > 255 || domain.chars().any(|c| matches!(c, '\0' | '\r' | '\n'))
            }) {
                return Err(HyperVError::new(
                    HyperVErrorKind::ConnectionError,
                    "The Hyper-V credential domain is invalid",
                ));
            }
        }

        Ok(())
    }

    fn valid_remote_target(target: &str) -> bool {
        if target.len() > 253
            || target.starts_with('-')
            || target.ends_with('-')
            || target.contains("..")
        {
            return false;
        }
        target.parse::<IpAddr>().is_ok()
            || target
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    }

    fn sanitize_diagnostic(&self, diagnostic: &str) -> String {
        let mut sanitized = diagnostic
            .lines()
            .map(|line| {
                if line.contains("ConvertTo-SecureString") {
                    "[redacted PowerShell credential input]"
                } else {
                    line
                }
            })
            .collect::<Vec<_>>()
            .join("\n");

        if let Some(credential) = &self.config.credential {
            if !credential.password.is_empty() {
                sanitized = sanitized.replace(&credential.password, "[REDACTED]");
                let escaped = credential.password.replace('\'', "''");
                if escaped != credential.password {
                    sanitized = sanitized.replace(&escaped, "[REDACTED]");
                }
            }
        }

        sanitized.chars().take(MAX_DIAGNOSTIC_CHARS).collect()
    }

    /// Build the prefix that targets a remote host if `target_host` is set.
    fn remote_prefix(&self) -> String {
        if self.config.target_host.is_empty() {
            return String::new();
        }
        let cred_block = if let Some(ref c) = self.config.credential {
            let user = if let Some(ref d) = c.domain {
                format!("{}\\{}", d, c.username)
            } else {
                c.username.clone()
            };
            format!(
                "$__cred = New-Object System.Management.Automation.PSCredential('{}', (ConvertTo-SecureString '{}' -AsPlainText -Force)); ",
                user.replace('\'', "''"),
                c.password.replace('\'', "''"),
            )
        } else {
            String::new()
        };

        format!(
            "{}Invoke-Command -ComputerName '{}' {} -ScriptBlock {{ ",
            cred_block,
            self.config.target_host.replace('\'', "''"),
            if self.config.credential.is_some() {
                "-Credential $__cred"
            } else {
                ""
            },
        )
    }

    /// Build the suffix that closes the remote block.
    fn remote_suffix(&self) -> String {
        if self.config.target_host.is_empty() {
            String::new()
        } else {
            " }".to_string()
        }
    }

    /// Wrap a script body so it targets the correct host.
    fn wrap_script(&self, body: &str) -> String {
        format!(
            "$ErrorActionPreference = 'Stop'; {}{}{}",
            self.remote_prefix(),
            body,
            self.remote_suffix()
        )
    }

    /// Execute a PowerShell script and return raw output.
    pub async fn run(&self, script: &str) -> HyperVResult<PsOutput> {
        self.validate_config()?;
        if script.len() > MAX_SCRIPT_BYTES {
            return Err(HyperVError::new(
                HyperVErrorKind::PowerShellError,
                "The PowerShell command exceeds the allowed size",
            ));
        }

        let full_script = self.wrap_script(script);
        if full_script.len() > MAX_SCRIPT_BYTES {
            return Err(HyperVError::new(
                HyperVErrorKind::PowerShellError,
                "The wrapped PowerShell command exceeds the allowed size",
            ));
        }
        debug!(
            "HyperV PowerShell exec ({} chars, remote={})",
            full_script.len(),
            !self.config.target_host.is_empty()
        );

        let timeout =
            Duration::from_secs(self.config.timeout_seconds.clamp(1, MAX_TIMEOUT_SECONDS));

        let mut child = Command::new(&self.config.powershell_path)
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                HyperVError::with_details(
                    HyperVErrorKind::PowerShellError,
                    "Failed to spawn PowerShell process",
                    e.to_string(),
                )
            })?;

        let mut stdin = child.stdin.take().ok_or_else(|| {
            HyperVError::new(
                HyperVErrorKind::PowerShellError,
                "Failed to open PowerShell standard input",
            )
        })?;
        let stdout_pipe = child.stdout.take().ok_or_else(|| {
            HyperVError::new(
                HyperVErrorKind::PowerShellError,
                "Failed to open PowerShell standard output",
            )
        })?;
        let stderr_pipe = child.stderr.take().ok_or_else(|| {
            HyperVError::new(
                HyperVErrorKind::PowerShellError,
                "Failed to open PowerShell error output",
            )
        })?;
        let script_bytes = SensitiveBytes(full_script.into_bytes());

        let execution = async {
            let write_input = async move {
                stdin.write_all(script_bytes.as_ref()).await?;
                stdin.shutdown().await
            };
            let read_stdout = read_bounded(stdout_pipe, MAX_STDOUT_BYTES);
            let read_stderr = read_bounded(stderr_pipe, MAX_STDERR_BYTES);
            let wait = child.wait();
            let ((), stdout, stderr, status) =
                tokio::try_join!(write_input, read_stdout, read_stderr, wait)?;
            Ok::<_, std::io::Error>((stdout, stderr, status))
        };

        let (stdout_bytes, stderr_bytes, status) = tokio::time::timeout(timeout, execution)
            .await
            .map_err(|_| HyperVError::timeout("PowerShell command"))?
            .map_err(|e| {
                HyperVError::with_details(
                    HyperVErrorKind::PowerShellError,
                    "PowerShell process failed",
                    e.to_string(),
                )
            })?;

        if stdout_bytes.len() > MAX_STDOUT_BYTES {
            return Err(HyperVError::new(
                HyperVErrorKind::PowerShellError,
                "PowerShell standard output exceeded the allowed size",
            ));
        }
        if stderr_bytes.len() > MAX_STDERR_BYTES {
            return Err(HyperVError::new(
                HyperVErrorKind::PowerShellError,
                "PowerShell error output exceeded the allowed size",
            ));
        }

        let stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
        let stderr = self.sanitize_diagnostic(&String::from_utf8_lossy(&stderr_bytes));
        let exit_code = status.code().unwrap_or(-1);

        trace!("PowerShell stdout: {} bytes", stdout.len());
        if !stderr.is_empty() {
            warn!("PowerShell produced {} characters on stderr", stderr.len());
        }

        Ok(PsOutput {
            stdout,
            stderr,
            exit_code,
        })
    }

    /// Execute and assert success (exit 0), returning the output.
    pub async fn run_ok(&self, script: &str) -> HyperVResult<PsOutput> {
        let output = self.run(script).await?;
        if !output.success() {
            let msg = if output.stderr.is_empty() {
                format!("PowerShell exited with code {}", output.exit_code)
            } else {
                output.stderr.clone()
            };

            // Detect common error patterns
            if msg.contains("is not recognized")
                || msg.contains("The term 'Get-VM' is not recognized")
            {
                return Err(HyperVError::module_not_available());
            }
            if msg.contains("Access is denied") || msg.contains("AccessDenied") {
                return Err(HyperVError::access_denied(msg));
            }

            return Err(HyperVError::ps_error(msg));
        }
        Ok(output)
    }

    /// Execute and parse the JSON output.
    pub async fn run_json(&self, script: &str) -> HyperVResult<serde_json::Value> {
        let output = self.run_ok(script).await?;
        output.parse_json()
    }

    /// Execute and parse the JSON output as a typed array.
    pub async fn run_json_array<T: serde::de::DeserializeOwned>(
        &self,
        script: &str,
    ) -> HyperVResult<Vec<T>> {
        let output = self.run_ok(script).await?;
        output.parse_json_array()
    }

    /// Execute and parse the JSON output as a typed single object.
    pub async fn run_json_as<T: serde::de::DeserializeOwned>(
        &self,
        script: &str,
    ) -> HyperVResult<T> {
        let output = self.run_ok(script).await?;
        output.parse_json_as()
    }

    /// Run a script that produces no output; just assert success.
    pub async fn run_void(&self, script: &str) -> HyperVResult<()> {
        self.run_ok(script).await?;
        Ok(())
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /// Check whether the Hyper-V module is available.
    pub async fn check_module(&self) -> HyperVResult<bool> {
        let output = self.run_ok("Get-Module -ListAvailable -Name Hyper-V | Select-Object -First 1 Name | ConvertTo-Json").await?;
        if output.stdout.trim().is_empty() || output.stdout.trim() == "null" {
            Ok(false)
        } else {
            Ok(true)
        }
    }

    /// Ensure the module is available, returning an error if not.
    pub async fn ensure_module(&self) -> HyperVResult<()> {
        if !self.check_module().await? {
            return Err(HyperVError::module_not_available());
        }
        Ok(())
    }
}

// ─── Script Builders ─────────────────────────────────────────────────

/// Utility functions that build common PowerShell script fragments.
pub struct PsScripts;

impl PsScripts {
    /// Escape a string value for embedding inside single-quoted PS strings.
    pub fn escape(s: &str) -> String {
        s.replace('\'', "''")
    }

    /// Build a ConvertTo-Json suffix with appropriate depth.
    pub fn to_json(depth: u32) -> String {
        format!("| ConvertTo-Json -Depth {} -Compress", depth.clamp(1, 16))
    }

    /// Build a Select-Object clause from a slice of property names.
    pub fn select(props: &[&str]) -> String {
        if props.is_empty() {
            String::new()
        } else {
            format!("| Select-Object {}", props.join(", "))
        }
    }

    /// Wrap value in @() to ensure array output from PS.
    pub fn ensure_array(expr: &str) -> String {
        format!("@({})", expr)
    }
}
