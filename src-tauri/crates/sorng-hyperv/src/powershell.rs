//! PowerShell execution engine for Hyper-V cmdlets.
//!
//! Wraps `tokio::process::Command` to invoke PowerShell with the Hyper-V
//! module and parse JSON output. Supports both local and remote execution
//! via `Invoke-Command -ComputerName`.

use crate::error::{HyperVError, HyperVErrorKind, HyperVResult};
use crate::types::HyperVConfig;
use log::{debug, trace, warn};
use std::time::Duration;
use tokio::process::Command;

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
                self.stdout.chars().take(500).collect::<String>(),
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
                self.stdout.chars().take(500).collect::<String>(),
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
                    trimmed.chars().take(500).collect::<String>(),
                )
            })
        } else {
            // Single object → wrap in vec
            let item: T = serde_json::from_str(trimmed).map_err(|e| {
                HyperVError::with_details(
                    HyperVErrorKind::ParseError,
                    format!("Failed to parse JSON object: {}", e),
                    trimmed.chars().take(500).collect::<String>(),
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
        let full_script = self.wrap_script(script);
        debug!(
            "HyperV PS exec ({} chars): {}…",
            full_script.len(),
            &full_script[..full_script.len().min(200)]
        );

        let timeout = Duration::from_secs(self.config.timeout_seconds.max(10));

        let child = Command::new(&self.config.powershell_path)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &full_script,
            ])
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

        let output = tokio::time::timeout(timeout, child.wait_with_output())
            .await
            .map_err(|_| HyperVError::timeout("PowerShell command"))?
            .map_err(|e| {
                HyperVError::with_details(
                    HyperVErrorKind::PowerShellError,
                    "PowerShell process failed",
                    e.to_string(),
                )
            })?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let exit_code = output.status.code().unwrap_or(-1);

        trace!("PS stdout ({} bytes): {}", stdout.len(), &stdout[..stdout.len().min(300)]);
        if !stderr.is_empty() {
            warn!("PS stderr: {}", &stderr[..stderr.len().min(500)]);
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
        let output = self.run("Get-Module -ListAvailable -Name Hyper-V | Select-Object -First 1 Name | ConvertTo-Json").await?;
        if output.stdout.trim().is_empty() || output.stdout.contains("null") {
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
        format!("| ConvertTo-Json -Depth {} -Compress", depth)
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
