//! CLI bridge for the Bitwarden `bw` command-line tool.
//!
//! Spawns subprocess invocations of the `bw` executable to handle
//! authentication, sync, vault operations, and status queries.

use crate::bitwarden::types::*;
use base64::Engine;
use log::debug;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

const MAX_CLI_ARG_BYTES: usize = 64 * 1024;
const MAX_CLI_ARG_COUNT: usize = 128;
const MAX_CLI_STDOUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_CLI_STDERR_BYTES: usize = 256 * 1024;
const MAX_SECRET_BYTES: usize = 64 * 1024;
const MAX_ATTACHMENT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_IMPORT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_SERVER_URL_BYTES: usize = 2 * 1024;

async fn read_bounded<R>(
    mut reader: R,
    limit: usize,
    stream_name: &'static str,
) -> Result<Vec<u8>, BitwardenError>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::with_capacity(limit.min(16 * 1024));
    let mut chunk = [0_u8; 8192];
    loop {
        let read = reader.read(&mut chunk).await.map_err(|_| {
            BitwardenError::io(format!("Failed to read Bitwarden CLI {}", stream_name))
        })?;
        if read == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(read) > limit {
            return Err(BitwardenError::api(format!(
                "Bitwarden CLI {} exceeded the safety limit",
                stream_name
            )));
        }
        output.extend_from_slice(&chunk[..read]);
    }
}

fn validate_secret(value: &str, label: &'static str) -> Result<(), BitwardenError> {
    if value.is_empty() || value.len() > MAX_SECRET_BYTES || value.contains('\0') {
        return Err(BitwardenError::invalid_config(format!(
            "{} is empty or exceeds the safety limit",
            label
        )));
    }
    Ok(())
}

fn validate_existing_file(
    raw_path: &str,
    label: &'static str,
    max_bytes: u64,
) -> Result<String, BitwardenError> {
    if raw_path.is_empty() || raw_path.len() > 4096 || raw_path.contains('\0') {
        return Err(BitwardenError::invalid_config(format!(
            "Invalid {} path",
            label
        )));
    }
    let path = Path::new(raw_path);
    if !path.is_absolute() {
        return Err(BitwardenError::invalid_config(format!(
            "{} path must be absolute",
            label
        )));
    }
    let symlink_metadata = std::fs::symlink_metadata(path)
        .map_err(|_| BitwardenError::invalid_config(format!("{} file is unavailable", label)))?;
    if symlink_metadata.file_type().is_symlink() || !symlink_metadata.is_file() {
        return Err(BitwardenError::invalid_config(format!(
            "{} path must be a regular, non-symlink file",
            label
        )));
    }
    if symlink_metadata.len() > max_bytes {
        return Err(BitwardenError::invalid_config(format!(
            "{} file exceeds the safety limit",
            label
        )));
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| BitwardenError::invalid_config(format!("Invalid {} path", label)))?;
    canonical
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| BitwardenError::invalid_config(format!("Invalid {} path encoding", label)))
}

fn validate_server_url(raw_url: &str) -> Result<String, BitwardenError> {
    if raw_url.is_empty() || raw_url.len() > MAX_SERVER_URL_BYTES || raw_url.contains('\0') {
        return Err(BitwardenError::invalid_config(
            "Invalid Bitwarden server URL",
        ));
    }
    let parsed = url::Url::parse(raw_url)
        .map_err(|_| BitwardenError::invalid_config("Invalid Bitwarden server URL"))?;
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(BitwardenError::invalid_config(
            "Bitwarden server URL must not contain credentials, a query, or a fragment",
        ));
    }
    let is_loopback_http = parsed.scheme() == "http"
        && parsed
            .host_str()
            .is_some_and(|host| is_loopback_hostname(host));
    if parsed.scheme() != "https" && !is_loopback_http {
        return Err(BitwardenError::invalid_config(
            "Bitwarden server URL must use HTTPS unless it is loopback",
        ));
    }
    Ok(parsed.to_string())
}

fn is_loopback_hostname(hostname: &str) -> bool {
    hostname.eq_ignore_ascii_case("localhost")
        || hostname
            .trim_matches(|character| character == '[' || character == ']')
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

/// Bitwarden CLI bridge for executing `bw` commands.
#[derive(Debug, Clone)]
pub struct BitwardenCli {
    /// Path to the `bw` binary (None = look in PATH).
    cli_path: Option<String>,
    /// BW_SESSION environment variable.
    session_key: Option<String>,
    /// Additional environment variables (BW_CLIENTID, BW_CLIENTSECRET, etc.).
    env_vars: HashMap<String, String>,
    /// Command timeout.
    timeout: Duration,
    /// Server URL (if non-default).
    #[allow(dead_code)]
    server_url: Option<String>,
}

impl Default for BitwardenCli {
    fn default() -> Self {
        Self {
            cli_path: None,
            session_key: None,
            env_vars: HashMap::new(),
            timeout: Duration::from_secs(30),
            server_url: None,
        }
    }
}

impl BitwardenCli {
    /// Create a new CLI bridge instance.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create from a BitwardenConfig.
    pub fn from_config(config: &BitwardenConfig) -> Self {
        Self {
            cli_path: config.cli_path.clone(),
            timeout: Duration::from_secs(config.timeout_secs.clamp(1, 300)),
            server_url: Some(config.server_url.clone()),
            ..Default::default()
        }
    }

    /// Set the CLI path.
    pub fn with_cli_path(mut self, path: &str) -> Self {
        self.cli_path = Some(path.to_string());
        self
    }

    /// Set the session key.
    pub fn set_session_key(&mut self, key: Option<String>) {
        self.session_key = key;
    }

    /// Set an environment variable.
    pub fn set_env(&mut self, key: &str, value: &str) {
        self.env_vars.insert(key.to_string(), value.to_string());
    }

    /// Set API key credentials.
    pub fn set_api_key(&mut self, client_id: &str, client_secret: &str) {
        self.env_vars
            .insert("BW_CLIENTID".to_string(), client_id.to_string());
        self.env_vars
            .insert("BW_CLIENTSECRET".to_string(), client_secret.to_string());
    }

    fn validated_bw_path(&self) -> Result<PathBuf, BitwardenError> {
        let Some(configured) = self.cli_path.as_deref() else {
            return Ok(PathBuf::from("bw"));
        };
        if configured.is_empty() || configured.len() > 4096 || configured.contains('\0') {
            return Err(BitwardenError::invalid_config(
                "Invalid Bitwarden CLI executable path",
            ));
        }
        let path = Path::new(configured);
        if !path.is_absolute() {
            return Err(BitwardenError::invalid_config(
                "Configured Bitwarden CLI path must be absolute",
            ));
        }
        let metadata = std::fs::metadata(path).map_err(|_| {
            BitwardenError::cli_not_found("Configured Bitwarden CLI executable is unavailable")
        })?;
        if !metadata.is_file() {
            return Err(BitwardenError::invalid_config(
                "Configured Bitwarden CLI path is not a file",
            ));
        }
        path.canonicalize()
            .map_err(|_| BitwardenError::invalid_config("Invalid Bitwarden CLI executable path"))
    }

    fn validate_args(args: &[&str]) -> Result<(), BitwardenError> {
        if args.is_empty() || args.len() > MAX_CLI_ARG_COUNT {
            return Err(BitwardenError::invalid_config(
                "Invalid Bitwarden CLI argument count",
            ));
        }
        let mut total = 0_usize;
        for arg in args {
            if arg.contains('\0') {
                return Err(BitwardenError::invalid_config(
                    "Invalid Bitwarden CLI argument",
                ));
            }
            total = total.saturating_add(arg.len());
            if total > MAX_CLI_ARG_BYTES {
                return Err(BitwardenError::invalid_config(
                    "Bitwarden CLI request exceeds the safety limit",
                ));
            }
        }
        Ok(())
    }

    /// Run a `bw` command and return raw stdout.
    async fn run_command(&self, args: &[&str]) -> Result<String, BitwardenError> {
        self.run_command_with_env(args, &[], true).await
    }

    async fn run_command_with_env(
        &self,
        args: &[&str],
        extra_env: &[(&str, &str)],
        include_session: bool,
    ) -> Result<String, BitwardenError> {
        Self::validate_args(args)?;
        for (name, value) in extra_env {
            if !matches!(
                *name,
                "BW_CLIENTID" | "BW_CLIENTSECRET" | "SORNG_BW_PASSWORD"
            ) {
                return Err(BitwardenError::invalid_config(
                    "Unsupported Bitwarden CLI environment channel",
                ));
            }
            validate_secret(value, "Bitwarden CLI secret")?;
        }

        debug!(
            "Running bw subcommand '{}' with {} argument(s)",
            args.first().copied().unwrap_or("<empty>"),
            args.len().saturating_sub(1)
        );

        let program = self.validated_bw_path()?;
        let mut cmd = Command::new(program);
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env("BW_NOINTERACTION", "true")
            .env_remove("BW_SESSION")
            .env_remove("BW_CLIENTID")
            .env_remove("BW_CLIENTSECRET")
            .env_remove("BW_PASSWORD")
            .env_remove("SORNG_BW_PASSWORD");

        if include_session {
            if let Some(ref key) = self.session_key {
                validate_secret(key, "Bitwarden session key")?;
                cmd.env("BW_SESSION", key);
            }
        }

        for (name, value) in extra_env {
            cmd.env(name, value);
        }

        let mut child = cmd.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BitwardenError::cli_not_found(
                    "Bitwarden CLI executable was not found; install or configure it",
                )
            } else {
                BitwardenError::io("Failed to start Bitwarden CLI")
            }
        })?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| BitwardenError::io("Bitwarden CLI stdout was unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| BitwardenError::io("Bitwarden CLI stderr was unavailable"))?;
        let stdout_task = tokio::spawn(read_bounded(stdout, MAX_CLI_STDOUT_BYTES, "stdout"));
        let stderr_task = tokio::spawn(read_bounded(stderr, MAX_CLI_STDERR_BYTES, "stderr"));

        let status = match tokio::time::timeout(self.timeout, child.wait()).await {
            Err(_) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                stdout_task.abort();
                stderr_task.abort();
                return Err(BitwardenError::timeout(
                    "Bitwarden CLI command timed out and was terminated",
                ));
            }
            Ok(Err(_)) => {
                let _ = child.kill().await;
                stdout_task.abort();
                stderr_task.abort();
                return Err(BitwardenError::io("Failed waiting for Bitwarden CLI"));
            }
            Ok(Ok(status)) => status,
        };

        let stdout = stdout_task
            .await
            .map_err(|_| BitwardenError::io("Bitwarden CLI stdout capture failed"))??;
        let stderr = stderr_task
            .await
            .map_err(|_| BitwardenError::io("Bitwarden CLI stderr capture failed"))??;
        let stdout = String::from_utf8_lossy(&stdout).to_string();
        let stderr = String::from_utf8_lossy(&stderr).to_string();

        if !status.success() {
            let code = status.code().unwrap_or(-1);
            debug!("bw subcommand failed with exit code {}", code);

            let combined = format!("{} {}", stdout, stderr);
            if combined.contains("You are not logged in") {
                return Err(BitwardenError::auth_failed("Not logged in"));
            }
            if combined.contains("Vault is locked") {
                return Err(BitwardenError::vault_locked("Vault is locked"));
            }
            if combined.contains("Invalid master password") {
                return Err(BitwardenError::auth_failed("Invalid master password"));
            }
            if combined.contains("Two-step login") || combined.contains("two-factor") {
                return Err(BitwardenError::two_factor_required(
                    "Two-factor authentication required",
                ));
            }
            if combined.contains("Rate limit") {
                return Err(BitwardenError {
                    kind: BitwardenErrorKind::RateLimited,
                    message: "Rate limited by server".into(),
                });
            }

            Err(BitwardenError::api(format!(
                "Bitwarden CLI command failed with exit code {}",
                code
            )))
        } else {
            Ok(stdout)
        }
    }

    /// Run a command and parse JSON output.
    async fn run_json<T: serde::de::DeserializeOwned>(
        &self,
        args: &[&str],
    ) -> Result<T, BitwardenError> {
        let output = self.run_command(args).await?;
        serde_json::from_str(&output).map_err(|e| {
            let _ = e;
            BitwardenError::parse("Bitwarden CLI returned invalid JSON")
        })
    }

    // ── Version & status ──────────────────────────────────────────

    /// Check if the `bw` CLI is available.
    pub async fn check_available(&self) -> Result<String, BitwardenError> {
        let output = self.run_command(&["--version"]).await?;
        Ok(output.trim().to_string())
    }

    /// Get vault status.
    pub async fn status(&self) -> Result<StatusInfo, BitwardenError> {
        self.run_json(&["status"]).await
    }

    // ── Authentication ──────────────────────────────────────────────

    /// Configure the server URL.
    pub async fn config_server(&self, url: &str) -> Result<(), BitwardenError> {
        let validated = validate_server_url(url)?;
        self.run_command(&["config", "server", &validated]).await?;
        Ok(())
    }

    /// Login with email and password.
    /// Returns a session key on success.
    pub async fn login_password(
        &self,
        email: &str,
        password: &str,
    ) -> Result<String, BitwardenError> {
        validate_secret(password, "Master password")?;
        let output = self
            .run_command_with_env(
                &[
                    "login",
                    email,
                    "--passwordenv",
                    "SORNG_BW_PASSWORD",
                    "--raw",
                ],
                &[("SORNG_BW_PASSWORD", password)],
                false,
            )
            .await?;
        Ok(output.trim().to_string())
    }

    /// Login with email, password, and two-factor code.
    pub async fn login_password_2fa(
        &self,
        email: &str,
        password: &str,
        code: &str,
        method: TwoFactorMethod,
    ) -> Result<String, BitwardenError> {
        let _ = (email, password, code, method);
        Err(BitwardenError::invalid_config(
            "Two-factor CLI login is disabled because the CLI exposes the one-time code in process arguments",
        ))
    }

    /// Login with API key (must set BW_CLIENTID and BW_CLIENTSECRET env vars first).
    pub async fn login_api_key(&mut self) -> Result<(), BitwardenError> {
        let client_id = self.env_vars.remove("BW_CLIENTID");
        let client_secret = self.env_vars.remove("BW_CLIENTSECRET");
        let (Some(client_id), Some(client_secret)) = (client_id, client_secret) else {
            return Err(BitwardenError::invalid_config(
                "Bitwarden API key credentials are incomplete",
            ));
        };
        validate_secret(&client_id, "Bitwarden client ID")?;
        validate_secret(&client_secret, "Bitwarden client secret")?;
        self.run_command_with_env(
            &["login", "--apikey"],
            &[
                ("BW_CLIENTID", client_id.as_str()),
                ("BW_CLIENTSECRET", client_secret.as_str()),
            ],
            false,
        )
        .await?;
        Ok(())
    }

    /// Login with SSO.
    pub async fn login_sso(&self) -> Result<String, BitwardenError> {
        let output = self.run_command(&["login", "--sso", "--raw"]).await?;
        Ok(output.trim().to_string())
    }

    /// Unlock the vault with a master password.
    /// Returns a session key.
    pub async fn unlock(&self, password: &str) -> Result<String, BitwardenError> {
        validate_secret(password, "Master password")?;
        let output = self
            .run_command_with_env(
                &["unlock", "--passwordenv", "SORNG_BW_PASSWORD", "--raw"],
                &[("SORNG_BW_PASSWORD", password)],
                false,
            )
            .await?;
        Ok(output.trim().to_string())
    }

    /// Lock the vault.
    pub async fn lock(&self) -> Result<(), BitwardenError> {
        self.run_command(&["lock"]).await?;
        Ok(())
    }

    /// Logout.
    pub async fn logout(&self) -> Result<(), BitwardenError> {
        self.run_command(&["logout"]).await?;
        Ok(())
    }

    // ── Sync ────────────────────────────────────────────────────────

    /// Sync the vault with the server.
    pub async fn sync(&self) -> Result<(), BitwardenError> {
        self.run_command(&["sync"]).await?;
        Ok(())
    }

    /// Force sync.
    pub async fn force_sync(&self) -> Result<(), BitwardenError> {
        self.run_command(&["sync", "--force"]).await?;
        Ok(())
    }

    /// Get last sync date.
    pub async fn last_sync(&self) -> Result<Option<String>, BitwardenError> {
        let output = self.run_command(&["sync", "--last"]).await?;
        let trimmed = output.trim();
        if trimmed.is_empty() || trimmed == "null" {
            Ok(None)
        } else {
            Ok(Some(trimmed.to_string()))
        }
    }

    // ── List operations ─────────────────────────────────────────────

    /// List all vault items.
    pub async fn list_items(&self) -> Result<Vec<VaultItem>, BitwardenError> {
        self.run_json(&["list", "items"]).await
    }

    /// List items matching a search term.
    pub async fn search_items(&self, search: &str) -> Result<Vec<VaultItem>, BitwardenError> {
        self.run_json(&["list", "items", "--search", search]).await
    }

    /// List items filtered by folder ID.
    pub async fn list_items_by_folder(
        &self,
        folder_id: &str,
    ) -> Result<Vec<VaultItem>, BitwardenError> {
        self.run_json(&["list", "items", "--folderid", folder_id])
            .await
    }

    /// List items filtered by collection ID.
    pub async fn list_items_by_collection(
        &self,
        collection_id: &str,
    ) -> Result<Vec<VaultItem>, BitwardenError> {
        self.run_json(&["list", "items", "--collectionid", collection_id])
            .await
    }

    /// List items filtered by organization ID.
    pub async fn list_items_by_organization(
        &self,
        org_id: &str,
    ) -> Result<Vec<VaultItem>, BitwardenError> {
        self.run_json(&["list", "items", "--organizationid", org_id])
            .await
    }

    /// List items matching a URL.
    pub async fn list_items_by_url(&self, url: &str) -> Result<Vec<VaultItem>, BitwardenError> {
        self.run_json(&["list", "items", "--url", url]).await
    }

    /// List trashed items.
    pub async fn list_trash(&self) -> Result<Vec<VaultItem>, BitwardenError> {
        self.run_json(&["list", "items", "--trash"]).await
    }

    /// List all folders.
    pub async fn list_folders(&self) -> Result<Vec<Folder>, BitwardenError> {
        self.run_json(&["list", "folders"]).await
    }

    /// List all collections.
    pub async fn list_collections(&self) -> Result<Vec<Collection>, BitwardenError> {
        self.run_json(&["list", "collections"]).await
    }

    /// List all organizations.
    pub async fn list_organizations(&self) -> Result<Vec<Organization>, BitwardenError> {
        self.run_json(&["list", "organizations"]).await
    }

    /// List org members (requires org_id).
    pub async fn list_org_members(&self, org_id: &str) -> Result<Vec<OrgMember>, BitwardenError> {
        self.run_json(&["list", "org-members", "--organizationid", org_id])
            .await
    }

    /// List org collections.
    pub async fn list_org_collections(
        &self,
        org_id: &str,
    ) -> Result<Vec<Collection>, BitwardenError> {
        self.run_json(&["list", "org-collections", "--organizationid", org_id])
            .await
    }

    // ── Get operations ──────────────────────────────────────────────

    /// Get a single item by ID.
    pub async fn get_item(&self, id: &str) -> Result<VaultItem, BitwardenError> {
        self.run_json(&["get", "item", id]).await
    }

    /// Get a folder by ID.
    pub async fn get_folder(&self, id: &str) -> Result<Folder, BitwardenError> {
        self.run_json(&["get", "folder", id]).await
    }

    /// Get a collection by ID.
    pub async fn get_collection(&self, id: &str) -> Result<Collection, BitwardenError> {
        self.run_json(&["get", "collection", id]).await
    }

    /// Get an organization by ID.
    pub async fn get_organization(&self, id: &str) -> Result<Organization, BitwardenError> {
        self.run_json(&["get", "organization", id]).await
    }

    /// Get a username from an item.
    pub async fn get_username(&self, id: &str) -> Result<String, BitwardenError> {
        let output = self.run_command(&["get", "username", id]).await?;
        Ok(output.trim().to_string())
    }

    /// Get a password from an item.
    pub async fn get_password(&self, id: &str) -> Result<String, BitwardenError> {
        let output = self.run_command(&["get", "password", id]).await?;
        Ok(output.trim().to_string())
    }

    /// Get a URI from an item.
    pub async fn get_uri(&self, id: &str) -> Result<String, BitwardenError> {
        let output = self.run_command(&["get", "uri", id]).await?;
        Ok(output.trim().to_string())
    }

    /// Get a TOTP code from an item.
    pub async fn get_totp(&self, id: &str) -> Result<String, BitwardenError> {
        let output = self.run_command(&["get", "totp", id]).await?;
        Ok(output.trim().to_string())
    }

    /// Get the notes from an item.
    pub async fn get_notes(&self, id: &str) -> Result<String, BitwardenError> {
        let output = self.run_command(&["get", "notes", id]).await?;
        Ok(output.trim().to_string())
    }

    /// Get an item template (for create operations).
    pub async fn get_template(&self, template_name: &str) -> Result<Value, BitwardenError> {
        self.run_json(&["get", "template", template_name]).await
    }

    // ── Create operations ───────────────────────────────────────────

    /// Create a new vault item from JSON.
    pub async fn create_item(&self, item: &VaultItem) -> Result<VaultItem, BitwardenError> {
        let _ = item;
        Err(BitwardenError::invalid_config(
            "CLI item creation is disabled because the Bitwarden CLI requires vault item data in process arguments",
        ))
    }

    /// Create a new folder.
    pub async fn create_folder(&self, folder: &Folder) -> Result<Folder, BitwardenError> {
        let json = serde_json::to_string(folder)
            .map_err(|e| BitwardenError::parse(format!("Serialize error: {}", e)))?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        self.run_json(&["create", "folder", &encoded]).await
    }

    // ── Edit operations ─────────────────────────────────────────────

    /// Edit a vault item.
    pub async fn edit_item(&self, id: &str, item: &VaultItem) -> Result<VaultItem, BitwardenError> {
        let _ = (id, item);
        Err(BitwardenError::invalid_config(
            "CLI item editing is disabled because the Bitwarden CLI requires vault item data in process arguments",
        ))
    }

    /// Edit a folder.
    pub async fn edit_folder(&self, id: &str, folder: &Folder) -> Result<Folder, BitwardenError> {
        let json = serde_json::to_string(folder)
            .map_err(|e| BitwardenError::parse(format!("Serialize error: {}", e)))?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        self.run_json(&["edit", "folder", id, &encoded]).await
    }

    // ── Delete operations ───────────────────────────────────────────

    /// Soft-delete (move to trash) a vault item.
    pub async fn delete_item(&self, id: &str) -> Result<(), BitwardenError> {
        self.run_command(&["delete", "item", id]).await?;
        Ok(())
    }

    /// Permanently delete a trashed item.
    pub async fn delete_item_permanent(&self, id: &str) -> Result<(), BitwardenError> {
        self.run_command(&["delete", "item", id, "--permanent"])
            .await?;
        Ok(())
    }

    /// Delete a folder.
    pub async fn delete_folder(&self, id: &str) -> Result<(), BitwardenError> {
        self.run_command(&["delete", "folder", id]).await?;
        Ok(())
    }

    /// Restore a soft-deleted item.
    pub async fn restore_item(&self, id: &str) -> Result<(), BitwardenError> {
        self.run_command(&["restore", "item", id]).await?;
        Ok(())
    }

    // ── Attachment operations ───────────────────────────────────────

    /// Create an attachment on an item.
    pub async fn create_attachment(
        &self,
        item_id: &str,
        file_path: &str,
    ) -> Result<VaultItem, BitwardenError> {
        let file_path = validate_existing_file(file_path, "attachment", MAX_ATTACHMENT_BYTES)?;
        self.run_json(&[
            "create",
            "attachment",
            "--file",
            &file_path,
            "--itemid",
            item_id,
        ])
        .await
    }

    /// Delete an attachment from an item.
    pub async fn delete_attachment(
        &self,
        attachment_id: &str,
        item_id: &str,
    ) -> Result<(), BitwardenError> {
        self.run_command(&["delete", "attachment", attachment_id, "--itemid", item_id])
            .await?;
        Ok(())
    }

    /// Get (download) an attachment.
    pub async fn get_attachment(
        &self,
        attachment_id: &str,
        item_id: &str,
        output_path: &str,
    ) -> Result<(), BitwardenError> {
        let _ = (attachment_id, item_id, output_path);
        Err(BitwardenError::invalid_config(
            "CLI attachment download is disabled because secure destination-file permissions cannot be guaranteed",
        ))
    }

    // ── Generate ────────────────────────────────────────────────────

    /// Generate a password with the given options.
    pub async fn generate(&self, opts: &PasswordGenerateOptions) -> Result<String, BitwardenError> {
        let mut args: Vec<String> = vec!["generate".to_string()];

        if opts.passphrase {
            args.push("--passphrase".to_string());
            if let Some(words) = opts.words {
                args.push("--words".to_string());
                args.push(words.to_string());
            }
            if let Some(ref sep) = opts.separator {
                args.push("--separator".to_string());
                args.push(sep.clone());
            }
            if opts.capitalize {
                args.push("--capitalize".to_string());
            }
            if opts.include_number {
                args.push("--includeNumber".to_string());
            }
        } else {
            args.push("--length".to_string());
            args.push(opts.length.to_string());
            if opts.uppercase {
                args.push("--uppercase".to_string());
            }
            if opts.lowercase {
                args.push("--lowercase".to_string());
            }
            if opts.numbers {
                args.push("--number".to_string());
            }
            if opts.special {
                args.push("--special".to_string());
            }
        }

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = self.run_command(&args_ref).await?;
        Ok(output.trim().to_string())
    }

    // ── Export / Import ─────────────────────────────────────────────

    /// Export the vault.
    pub async fn export(
        &self,
        format: ExportFormat,
        output_path: &str,
        password: Option<&str>,
    ) -> Result<(), BitwardenError> {
        let _ = (format, output_path, password);
        Err(BitwardenError::invalid_config(
            "CLI vault export is disabled because secret argv and secure output-file guarantees are unavailable",
        ))
    }

    /// Import vault data.
    pub async fn import(
        &self,
        format: ImportFormat,
        file_path: &str,
    ) -> Result<(), BitwardenError> {
        let fmt = format.as_str();
        let file_path = validate_existing_file(file_path, "import", MAX_IMPORT_BYTES)?;
        self.run_command(&["import", fmt, &file_path]).await?;
        Ok(())
    }

    // ── Send operations ─────────────────────────────────────────────

    /// List all sends.
    pub async fn list_sends(&self) -> Result<Vec<Send>, BitwardenError> {
        self.run_json(&["send", "list"]).await
    }

    /// Create a text send.
    pub async fn create_text_send(
        &self,
        name: &str,
        text: &str,
        max_access: Option<u32>,
        password: Option<&str>,
        hidden: bool,
    ) -> Result<Send, BitwardenError> {
        let _ = (name, text, max_access, password, hidden);
        Err(BitwardenError::invalid_config(
            "CLI Send creation is disabled because Send contents and passwords would be exposed in process arguments",
        ))
    }

    /// Delete a send.
    pub async fn delete_send(&self, id: &str) -> Result<(), BitwardenError> {
        self.run_command(&["send", "delete", id]).await?;
        Ok(())
    }

    /// Receive a send by URL.
    pub async fn receive_send(
        &self,
        url: &str,
        password: Option<&str>,
    ) -> Result<String, BitwardenError> {
        if password.is_some() {
            return Err(BitwardenError::invalid_config(
                "Password-protected Send receipt is disabled because the CLI requires the password in process arguments",
            ));
        }
        self.run_command(&["send", "receive", url]).await
    }

    // ── Serve ───────────────────────────────────────────────────────

    /// Check if `bw serve` is reachable at the given port.
    pub async fn check_serve_running(hostname: &str, port: u16) -> bool {
        if !is_loopback_hostname(hostname) {
            return false;
        }
        let host = if hostname.contains(':') && !hostname.starts_with('[') {
            format!("[{}]", hostname)
        } else {
            hostname.to_string()
        };
        let url = format!("http://{}:{}/status", host, port);
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
        {
            Ok(client) => client,
            Err(_) => return false,
        };
        match client.get(&url).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    /// Start `bw serve` as a background process.
    /// Returns a handle to the spawned process.
    pub fn start_serve(
        &self,
        hostname: &str,
        port: u16,
    ) -> Result<tokio::process::Child, BitwardenError> {
        if !is_loopback_hostname(hostname) {
            return Err(BitwardenError::invalid_config(
                "bw serve may only bind to a loopback hostname",
            ));
        }
        let port_str = port.to_string();
        let program = self.validated_bw_path()?;
        let mut cmd = Command::new(program);
        cmd.args(["serve", "--hostname", hostname, "--port", &port_str])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .env("BW_NOINTERACTION", "true")
            .env_remove("BW_SESSION")
            .env_remove("BW_CLIENTID")
            .env_remove("BW_CLIENTSECRET")
            .env_remove("BW_PASSWORD")
            .env_remove("SORNG_BW_PASSWORD");

        if let Some(ref key) = self.session_key {
            validate_secret(key, "Bitwarden session key")?;
            cmd.env("BW_SESSION", key);
        }

        cmd.spawn()
            .map_err(|_| BitwardenError::io("Failed to start bw serve"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Constructor tests ───────────────────────────────────────────

    #[test]
    fn cli_default() {
        let cli = BitwardenCli::new();
        assert_eq!(cli.cli_path.as_deref().unwrap_or("bw"), "bw");
        assert!(cli.session_key.is_none());
    }

    #[test]
    fn cli_with_path() {
        let cli = BitwardenCli::new().with_cli_path("/usr/local/bin/bw");
        assert_eq!(cli.cli_path.as_deref().unwrap_or("bw"), "/usr/local/bin/bw");
    }

    #[test]
    fn cli_from_config() {
        let config = BitwardenConfig {
            cli_path: Some("/opt/bw".into()),
            timeout_secs: 60,
            ..Default::default()
        };
        let cli = BitwardenCli::from_config(&config);
        assert_eq!(cli.cli_path.as_deref().unwrap_or("bw"), "/opt/bw");
        assert_eq!(cli.timeout.as_secs(), 60);
    }

    #[test]
    fn cli_set_session_key() {
        let mut cli = BitwardenCli::new();
        cli.set_session_key(Some("test_key".into()));
        assert_eq!(cli.session_key.as_deref(), Some("test_key"));
    }

    #[test]
    fn cli_set_api_key() {
        let mut cli = BitwardenCli::new();
        cli.set_api_key("client_id_value", "client_secret_value");
        assert_eq!(cli.env_vars.get("BW_CLIENTID").unwrap(), "client_id_value");
        assert_eq!(
            cli.env_vars.get("BW_CLIENTSECRET").unwrap(),
            "client_secret_value"
        );
    }

    #[test]
    fn cli_set_env() {
        let mut cli = BitwardenCli::new();
        cli.set_env("CUSTOM_VAR", "value");
        assert_eq!(cli.env_vars.get("CUSTOM_VAR").unwrap(), "value");
    }

    // ── Error classification tests (would need integration for full coverage) ──

    #[tokio::test]
    async fn check_available_not_found() {
        let cli = BitwardenCli::new().with_cli_path("nonexistent_bw_binary_path");
        let result = cli.check_available().await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.kind, BitwardenErrorKind::CliNotFound);
    }

    #[tokio::test]
    async fn status_with_missing_cli() {
        let cli = BitwardenCli::new().with_cli_path("nonexistent_bw_binary_path");
        let result = cli.status().await;
        assert!(result.is_err());
    }

    // ── Generate args construction ──────────────────────────────────

    #[test]
    fn password_generate_options_default_args() {
        let opts = PasswordGenerateOptions::default();
        assert!(!opts.passphrase);
        assert_eq!(opts.length, 20);
        assert!(opts.uppercase);
        assert!(opts.lowercase);
        assert!(opts.numbers);
        assert!(opts.special);
    }

    #[test]
    fn password_generate_passphrase_args() {
        let opts = PasswordGenerateOptions::passphrase(4);
        assert!(opts.passphrase);
        assert_eq!(opts.words, Some(4));
        assert_eq!(opts.separator.as_deref(), Some("-"));
    }
}
