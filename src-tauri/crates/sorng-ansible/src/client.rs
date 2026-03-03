// ── sorng-ansible/src/client.rs ──────────────────────────────────────────────
//! Ansible CLI wrapper — binary detection, version parsing, and process execution.
//!
//! This is the foundation layer: every other module ultimately delegates to
//! `AnsibleClient::run_command` to invoke an ansible CLI tool and capture its
//! output.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;

use log::debug;
use regex::Regex;
use tokio::process::Command;

use crate::error::{AnsibleError, AnsibleResult};
use crate::types::{AnsibleConnectionConfig, AnsibleInfo};

/// Low-level wrapper around Ansible CLI binaries.
#[derive(Debug, Clone)]
pub struct AnsibleClient {
    /// Resolved path to `ansible`.
    pub ansible_bin: String,
    /// Resolved path to `ansible-playbook`.
    pub playbook_bin: String,
    /// Resolved path to `ansible-vault`.
    pub vault_bin: String,
    /// Resolved path to `ansible-galaxy`.
    pub galaxy_bin: String,
    /// Resolved path to `ansible-config`.
    pub config_bin: String,
    /// Resolved path to `ansible-inventory`.
    pub inventory_bin: String,
    /// Resolved path to `ansible-doc`.
    pub doc_bin: String,
    /// Working directory.
    pub working_dir: Option<String>,
    /// Extra environment variables.
    pub env_vars: HashMap<String, String>,
    /// Default verbosity (0–4).
    pub verbosity: u8,
    /// Default inventory source.
    pub default_inventory: Option<String>,
    /// Vault password file.
    pub vault_password_file: Option<String>,
    /// Default remote user.
    pub remote_user: Option<String>,
    /// Default private-key path.
    pub private_key: Option<String>,
    /// SSH common args.
    pub ssh_common_args: Option<String>,
}

/// Result of running any CLI command.
#[derive(Debug, Clone)]
pub struct CliOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

impl AnsibleClient {
    // ── Construction ─────────────────────────────────────────────────

    /// Build a client from the connection config.
    pub async fn from_config(config: &AnsibleConnectionConfig) -> AnsibleResult<Self> {
        let ansible_bin = Self::resolve_bin(
            config.ansible_bin_path.as_deref(),
            "ansible",
        ).await?;

        let playbook_bin = Self::resolve_bin(
            config.ansible_playbook_bin_path.as_deref(),
            "ansible-playbook",
        ).await?;

        let vault_bin = Self::resolve_bin(
            config.ansible_vault_bin_path.as_deref(),
            "ansible-vault",
        ).await?;

        let galaxy_bin = Self::resolve_bin(
            config.ansible_galaxy_bin_path.as_deref(),
            "ansible-galaxy",
        ).await?;

        // These are standard companions – resolve best-effort.
        let config_bin = Self::resolve_bin(None, "ansible-config")
            .await
            .unwrap_or_else(|_| "ansible-config".to_string());

        let inventory_bin = Self::resolve_bin(None, "ansible-inventory")
            .await
            .unwrap_or_else(|_| "ansible-inventory".to_string());

        let doc_bin = Self::resolve_bin(None, "ansible-doc")
            .await
            .unwrap_or_else(|_| "ansible-doc".to_string());

        Ok(Self {
            ansible_bin,
            playbook_bin,
            vault_bin,
            galaxy_bin,
            config_bin,
            inventory_bin,
            doc_bin,
            working_dir: config.working_directory.clone(),
            env_vars: config.env_vars.clone(),
            verbosity: config.verbosity,
            default_inventory: config.default_inventory.clone(),
            vault_password_file: config.vault_password_file.clone(),
            remote_user: config.remote_user.clone(),
            private_key: config.private_key_path.clone(),
            ssh_common_args: config.ssh_common_args.clone(),
        })
    }

    /// Try to resolve a binary path — either explicit or via `which`.
    async fn resolve_bin(explicit: Option<&str>, name: &str) -> AnsibleResult<String> {
        if let Some(path) = explicit {
            let p = PathBuf::from(path);
            if p.exists() {
                return Ok(path.to_string());
            }
            return Err(AnsibleError::not_installed(format!(
                "Specified binary not found: {}", path
            )));
        }

        // Try `which` / `where` depending on platform.
        let which_cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
        let output = Command::new(which_cmd)
            .arg(name)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| AnsibleError::not_installed(format!(
                "Failed to locate '{}': {}", name, e
            )))?;

        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path.is_empty() {
                return Ok(path);
            }
        }

        Err(AnsibleError::not_installed(format!(
            "'{}' not found on PATH. Please install Ansible or specify the binary path.", name
        )))
    }

    // ── Info ─────────────────────────────────────────────────────────

    /// Detect Ansible version and environment info.
    pub async fn detect_info(&self) -> AnsibleResult<AnsibleInfo> {
        let output = self.run_raw(&self.ansible_bin, &["--version"]).await?;

        let version = Self::parse_version(&output.stdout)?;
        let python_version = Self::parse_python_version(&output.stdout);
        let config_file = Self::parse_config_file(&output.stdout);
        let module_path = Self::parse_module_path(&output.stdout);

        Ok(AnsibleInfo {
            version,
            python_version,
            config_file,
            default_module_path: module_path,
            executable: self.ansible_bin.clone(),
            available_modules: Vec::new(),
            available_plugins: Vec::new(),
        })
    }

    /// Check that the ansible binary is reachable.
    pub async fn is_available(&self) -> bool {
        self.run_raw(&self.ansible_bin, &["--version"]).await.is_ok()
    }

    // ── Command execution ────────────────────────────────────────────

    /// Run an arbitrary ansible-related binary with args.
    pub async fn run_raw(&self, bin: &str, args: &[&str]) -> AnsibleResult<CliOutput> {
        debug!("Running: {} {}", bin, args.join(" "));

        let mut cmd = Command::new(bin);
        cmd.args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(ref dir) = self.working_dir {
            cmd.current_dir(dir);
        }

        for (k, v) in &self.env_vars {
            cmd.env(k, v);
        }

        let child = cmd.spawn().map_err(|e| {
            AnsibleError::process(format!("Failed to spawn '{}': {}", bin, e))
        })?;

        let output = child.wait_with_output().await.map_err(|e| {
            AnsibleError::process(format!("Failed to wait on '{}': {}", bin, e))
        })?;

        let exit_code = output.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !stderr.is_empty() && exit_code != 0 {
            debug!("stderr: {}", stderr);
        }

        Ok(CliOutput { stdout, stderr, exit_code })
    }

    /// Run `ansible` with dynamic args, applying client defaults.
    pub async fn run_ansible(&self, args: &[String]) -> AnsibleResult<CliOutput> {
        let mut full_args: Vec<String> = Vec::new();

        // Inventory
        if let Some(ref inv) = self.default_inventory {
            full_args.push("-i".to_string());
            full_args.push(inv.clone());
        }

        // Verbosity
        if self.verbosity > 0 {
            let v_flag = format!("-{}", "v".repeat(self.verbosity as usize));
            full_args.push(v_flag);
        }

        // Vault
        if let Some(ref vp) = self.vault_password_file {
            full_args.push("--vault-password-file".to_string());
            full_args.push(vp.clone());
        }

        // Remote user
        if let Some(ref user) = self.remote_user {
            full_args.push("--user".to_string());
            full_args.push(user.clone());
        }

        // Private key
        if let Some(ref key) = self.private_key {
            full_args.push("--private-key".to_string());
            full_args.push(key.clone());
        }

        // SSH args
        if let Some(ref ssh_args) = self.ssh_common_args {
            full_args.push("--ssh-common-args".to_string());
            full_args.push(ssh_args.clone());
        }

        full_args.extend_from_slice(args);

        let str_args: Vec<&str> = full_args.iter().map(|s| s.as_str()).collect();
        self.run_raw(&self.ansible_bin, &str_args).await
    }

    /// Run `ansible-playbook` with dynamic args, applying client defaults.
    pub async fn run_playbook(&self, args: &[String]) -> AnsibleResult<CliOutput> {
        let mut full_args: Vec<String> = Vec::new();

        if let Some(ref inv) = self.default_inventory {
            full_args.push("-i".to_string());
            full_args.push(inv.clone());
        }
        if self.verbosity > 0 {
            full_args.push(format!("-{}", "v".repeat(self.verbosity as usize)));
        }
        if let Some(ref vp) = self.vault_password_file {
            full_args.push("--vault-password-file".to_string());
            full_args.push(vp.clone());
        }
        if let Some(ref user) = self.remote_user {
            full_args.push("--user".to_string());
            full_args.push(user.clone());
        }
        if let Some(ref key) = self.private_key {
            full_args.push("--private-key".to_string());
            full_args.push(key.clone());
        }
        if let Some(ref ssh_args) = self.ssh_common_args {
            full_args.push("--ssh-common-args".to_string());
            full_args.push(ssh_args.clone());
        }

        full_args.extend_from_slice(args);
        let str_args: Vec<&str> = full_args.iter().map(|s| s.as_str()).collect();
        self.run_raw(&self.playbook_bin, &str_args).await
    }

    // ── Parsing helpers ──────────────────────────────────────────────

    fn parse_version(output: &str) -> AnsibleResult<String> {
        // First line: "ansible [core 2.16.3]" or "ansible 2.9.27"
        let re = Regex::new(r"ansible\s+\[?(?:core\s+)?(\d+\.\d+[\.\d]*)").unwrap();
        if let Some(caps) = re.captures(output) {
            return Ok(caps[1].to_string());
        }
        // Fallback: first line as-is
        if let Some(line) = output.lines().next() {
            if !line.trim().is_empty() {
                return Ok(line.trim().to_string());
            }
        }
        Err(AnsibleError::parse("Could not parse Ansible version"))
    }

    fn parse_python_version(output: &str) -> String {
        let re = Regex::new(r"python\s+version\s*=\s*(\S+)").unwrap();
        re.captures(output)
            .map(|c| c[1].to_string())
            .unwrap_or_else(|| "unknown".to_string())
    }

    fn parse_config_file(output: &str) -> Option<String> {
        let re = Regex::new(r"config\s+file\s*=\s*(.+)").unwrap();
        re.captures(output).map(|c| c[1].trim().to_string())
    }

    fn parse_module_path(output: &str) -> Option<String> {
        let re = Regex::new(r"configured\s+module\s+search\s+path\s*=\s*(.+)").unwrap();
        re.captures(output).map(|c| c[1].trim().to_string())
    }
}
