// ── sorng-terraform/src/client.rs ─────────────────────────────────────────────
//! Terraform CLI wrapper — binary detection, version parsing, and execution.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Instant;

use log::debug;
use tokio::process::Command;

use crate::error::{TerraformError, TerraformResult};
use crate::types::{ProviderVersion, TerraformConnectionConfig, TerraformInfo};

/// Wraps a single Terraform working directory connection.
#[derive(Debug, Clone)]
pub struct TerraformClient {
    /// Path to the `terraform` binary.
    pub terraform_bin: PathBuf,
    /// Working directory containing `.tf` files.
    pub working_dir: PathBuf,
    /// Backend configuration overrides.
    pub backend_configs: HashMap<String, String>,
    /// Extra environment variables injected into every call.
    pub env_vars: HashMap<String, String>,
    /// CLI config file override.
    pub cli_config_file: Option<PathBuf>,
    /// Data dir override.
    pub data_dir: Option<PathBuf>,
}

impl TerraformClient {
    // ── Construction ─────────────────────────────────────────────────

    /// Build a client from a connection config (validates binary & working dir).
    pub async fn from_config(cfg: &TerraformConnectionConfig) -> TerraformResult<Self> {
        let terraform_bin = if let Some(ref p) = cfg.terraform_path {
            let path = PathBuf::from(p);
            if !path.exists() {
                return Err(TerraformError::binary_not_found(format!(
                    "terraform binary not found at {}",
                    p
                )));
            }
            path
        } else {
            Self::resolve_bin("terraform").await?
        };

        let working_dir = PathBuf::from(&cfg.working_dir);
        if !working_dir.is_dir() {
            return Err(TerraformError::working_dir_not_found(format!(
                "working directory not found: {}",
                cfg.working_dir
            )));
        }

        Ok(Self {
            terraform_bin,
            working_dir,
            backend_configs: cfg.backend_configs.clone(),
            env_vars: cfg.env_vars.clone(),
            cli_config_file: cfg.cli_config_file.as_ref().map(PathBuf::from),
            data_dir: cfg.data_dir.as_ref().map(PathBuf::from),
        })
    }

    /// Resolve a binary by name from PATH.
    async fn resolve_bin(name: &str) -> TerraformResult<PathBuf> {
        // Try `where` on Windows, `which` on Unix
        let cmd = if cfg!(target_os = "windows") {
            "where"
        } else {
            "which"
        };
        let output = Command::new(cmd)
            .arg(name)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                TerraformError::binary_not_found(format!("{} lookup failed: {}", name, e))
            })?
            .wait_with_output()
            .await
            .map_err(|e| TerraformError::binary_not_found(e.to_string()))?;

        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or_default()
                .trim()
                .to_string();
            if path.is_empty() {
                return Err(TerraformError::binary_not_found(format!(
                    "{} not found in PATH",
                    name
                )));
            }
            Ok(PathBuf::from(path))
        } else {
            Err(TerraformError::binary_not_found(format!(
                "{} not found in PATH",
                name
            )))
        }
    }

    // ── Info ─────────────────────────────────────────────────────────

    /// Detect version & environment info.
    pub async fn detect_info(&self) -> TerraformResult<TerraformInfo> {
        let output = self.run_json(&["version", "-json"]).await?;
        let parsed: serde_json::Value = serde_json::from_str(&output.stdout).map_err(|e| {
            TerraformError::json_parse(format!("failed to parse version JSON: {}", e))
        })?;

        let version = parsed["terraform_version"]
            .as_str()
            .unwrap_or("unknown")
            .to_string();
        let platform = parsed["platform"].as_str().unwrap_or("unknown").to_string();

        let providers = if let Some(obj) = parsed["provider_selections"].as_object() {
            obj.iter()
                .map(|(k, v)| {
                    let parts: Vec<&str> = k.rsplitn(3, '/').collect();
                    ProviderVersion {
                        source: k.clone(),
                        name: parts.first().unwrap_or(&"").to_string(),
                        namespace: parts.get(1).unwrap_or(&"").to_string(),
                        version: v.as_str().unwrap_or("").to_string(),
                    }
                })
                .collect()
        } else {
            Vec::new()
        };

        // Detect current workspace
        let ws_output = self.run_raw(&["workspace", "show"]).await?;
        let workspace = ws_output.stdout.trim().to_string();

        // Detect backend type from .terraform/terraform.tfstate if available
        let backend_type = self.detect_backend_type().await;

        Ok(TerraformInfo {
            version,
            platform,
            providers,
            working_dir: self.working_dir.display().to_string(),
            backend_type,
            workspace,
        })
    }

    /// Try to read the backend type from the local state metadata.
    async fn detect_backend_type(&self) -> Option<String> {
        let state_path = self
            .working_dir
            .join(".terraform")
            .join("terraform.tfstate");
        if let Ok(content) = tokio::fs::read_to_string(&state_path).await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                return v["backend"]["type"].as_str().map(|s| s.to_string());
            }
        }
        None
    }

    // ── Execution helpers ────────────────────────────────────────────

    /// Execute terraform with the given args and return raw stdout/stderr/exit code.
    pub async fn run_raw(&self, args: &[&str]) -> TerraformResult<RawOutput> {
        self.execute(args, false).await
    }

    /// Execute terraform with `-json` output support.
    pub async fn run_json(&self, args: &[&str]) -> TerraformResult<RawOutput> {
        self.execute(args, false).await
    }

    /// Execute terraform with `-no-color` automatically appended.
    pub async fn run_no_color(&self, args: &[&str]) -> TerraformResult<RawOutput> {
        self.execute(args, true).await
    }

    /// Core execution method.
    async fn execute(&self, args: &[&str], no_color: bool) -> TerraformResult<RawOutput> {
        let mut cmd = Command::new(&self.terraform_bin);
        cmd.current_dir(&self.working_dir);
        cmd.args(args);

        if no_color {
            cmd.arg("-no-color");
        }

        // Inject TF_IN_AUTOMATION so prompts are suppressed.
        cmd.env("TF_IN_AUTOMATION", "1");

        // Custom environment variables.
        for (k, v) in &self.env_vars {
            cmd.env(k, v);
        }

        // CLI config file.
        if let Some(ref cli_cfg) = self.cli_config_file {
            cmd.env("TF_CLI_CONFIG_FILE", cli_cfg);
        }

        // Data directory.
        if let Some(ref data) = self.data_dir {
            cmd.env("TF_DATA_DIR", data);
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        debug!(
            "terraform {} (cwd: {})",
            args.join(" "),
            self.working_dir.display()
        );

        let start = Instant::now();
        let child = cmd.spawn().map_err(|e| {
            TerraformError::new(
                crate::error::TerraformErrorKind::ProcessExecution,
                format!("failed to spawn terraform: {}", e),
            )
        })?;

        let output = child.wait_with_output().await.map_err(|e| {
            TerraformError::new(
                crate::error::TerraformErrorKind::ProcessExecution,
                format!("failed to wait for terraform: {}", e),
            )
        })?;

        let elapsed = start.elapsed().as_millis() as u64;

        Ok(RawOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
            duration_ms: elapsed,
        })
    }

    /// Build the backend-config args for `terraform init`.
    pub fn backend_config_args(&self) -> Vec<String> {
        self.backend_configs
            .iter()
            .map(|(k, v)| format!("-backend-config={}={}", k, v))
            .collect()
    }
}

/// Raw output from a CLI invocation.
#[derive(Debug, Clone)]
pub struct RawOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u64,
}
