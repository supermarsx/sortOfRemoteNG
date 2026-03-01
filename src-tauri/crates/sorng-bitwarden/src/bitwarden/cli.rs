//! CLI bridge for the Bitwarden `bw` command-line tool.
//!
//! Spawns subprocess invocations of the `bw` executable to handle
//! authentication, sync, vault operations, and status queries.

use crate::bitwarden::types::*;
use base64::Engine;
use log::debug;
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

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
            timeout: Duration::from_secs(config.timeout_secs),
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
        self.env_vars.insert("BW_CLIENTID".to_string(), client_id.to_string());
        self.env_vars.insert("BW_CLIENTSECRET".to_string(), client_secret.to_string());
    }

    /// Get the CLI binary path.
    fn bw_path(&self) -> &str {
        self.cli_path.as_deref().unwrap_or("bw")
    }

    /// Run a `bw` command and return raw stdout.
    async fn run_command(&self, args: &[&str]) -> Result<String, BitwardenError> {
        debug!("Running bw command: bw {}", args.join(" "));

        let mut cmd = Command::new(self.bw_path());
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("BITWARDENCLI_APPDATA_DIR", "")
            .env("BW_NOINTERACTION", "true");

        // Always set --response for JSON output
        if !args.contains(&"--response") && !args.contains(&"--raw") {
            // Some commands need --raw, others auto-JSON
        }

        if let Some(ref key) = self.session_key {
            cmd.env("BW_SESSION", key);
        }

        for (k, v) in &self.env_vars {
            cmd.env(k, v);
        }

        let result = tokio::time::timeout(self.timeout, cmd.output()).await;

        match result {
            Err(_) => Err(BitwardenError::timeout("CLI command timed out")),
            Ok(Err(e)) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    Err(BitwardenError::cli_not_found(format!(
                        "Bitwarden CLI not found at '{}'. Install from https://bitwarden.com/help/cli/",
                        self.bw_path()
                    )))
                } else {
                    Err(BitwardenError::io(format!("Failed to execute bw: {}", e)))
                }
            }
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();

                if !output.status.success() {
                    let code = output.status.code().unwrap_or(-1);
                    debug!("bw exited with code {}: stderr={}", code, stderr);

                    // Parse common error patterns
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

                    let msg = if !stderr.is_empty() { stderr } else { stdout };
                    Err(BitwardenError::api(format!("bw command failed (exit {}): {}", code, msg.trim())))
                } else {
                    Ok(stdout)
                }
            }
        }
    }

    /// Run a command and parse JSON output.
    async fn run_json<T: serde::de::DeserializeOwned>(&self, args: &[&str]) -> Result<T, BitwardenError> {
        let output = self.run_command(args).await?;
        serde_json::from_str(&output).map_err(|e| {
            BitwardenError::parse(format!("Failed to parse JSON: {} (output: {})", e, &output[..output.len().min(200)]))
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
        self.run_command(&["config", "server", url]).await?;
        Ok(())
    }

    /// Login with email and password.
    /// Returns a session key on success.
    pub async fn login_password(
        &self,
        email: &str,
        password: &str,
    ) -> Result<String, BitwardenError> {
        let output = self.run_command(&[
            "login", email, password, "--raw",
        ]).await?;
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
        let method_str = (method as u8).to_string();
        let output = self.run_command(&[
            "login", email, password,
            "--method", &method_str,
            "--code", code,
            "--raw",
        ]).await?;
        Ok(output.trim().to_string())
    }

    /// Login with API key (must set BW_CLIENTID and BW_CLIENTSECRET env vars first).
    pub async fn login_api_key(&self) -> Result<(), BitwardenError> {
        if !self.env_vars.contains_key("BW_CLIENTID") {
            return Err(BitwardenError::invalid_config("BW_CLIENTID not set"));
        }
        self.run_command(&["login", "--apikey"]).await?;
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
        let output = self.run_command(&["unlock", password, "--raw"]).await?;
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
    pub async fn list_items_by_folder(&self, folder_id: &str) -> Result<Vec<VaultItem>, BitwardenError> {
        self.run_json(&["list", "items", "--folderid", folder_id]).await
    }

    /// List items filtered by collection ID.
    pub async fn list_items_by_collection(&self, collection_id: &str) -> Result<Vec<VaultItem>, BitwardenError> {
        self.run_json(&["list", "items", "--collectionid", collection_id]).await
    }

    /// List items filtered by organization ID.
    pub async fn list_items_by_organization(&self, org_id: &str) -> Result<Vec<VaultItem>, BitwardenError> {
        self.run_json(&["list", "items", "--organizationid", org_id]).await
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
        self.run_json(&["list", "org-members", "--organizationid", org_id]).await
    }

    /// List org collections.
    pub async fn list_org_collections(&self, org_id: &str) -> Result<Vec<Collection>, BitwardenError> {
        self.run_json(&["list", "org-collections", "--organizationid", org_id]).await
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
        let json = serde_json::to_string(item)
            .map_err(|e| BitwardenError::parse(format!("Serialize error: {}", e)))?;

        let encoded = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        self.run_json(&["create", "item", &encoded]).await
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
        let json = serde_json::to_string(item)
            .map_err(|e| BitwardenError::parse(format!("Serialize error: {}", e)))?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        self.run_json(&["edit", "item", id, &encoded]).await
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
        self.run_command(&["delete", "item", id, "--permanent"]).await?;
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
        self.run_json(&[
            "create", "attachment",
            "--file", file_path,
            "--itemid", item_id,
        ]).await
    }

    /// Delete an attachment from an item.
    pub async fn delete_attachment(
        &self,
        attachment_id: &str,
        item_id: &str,
    ) -> Result<(), BitwardenError> {
        self.run_command(&[
            "delete", "attachment", attachment_id,
            "--itemid", item_id,
        ]).await?;
        Ok(())
    }

    /// Get (download) an attachment.
    pub async fn get_attachment(
        &self,
        attachment_id: &str,
        item_id: &str,
        output_path: &str,
    ) -> Result<(), BitwardenError> {
        self.run_command(&[
            "get", "attachment", attachment_id,
            "--itemid", item_id,
            "--output", output_path,
        ]).await?;
        Ok(())
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
        let mut args = vec!["export"];
        let fmt = format.as_str();
        args.push("--format");
        args.push(fmt);
        args.push("--output");
        args.push(output_path);

        if let Some(pw) = password {
            args.push("--password");
            args.push(pw);
        }

        self.run_command(&args).await?;
        Ok(())
    }

    /// Import vault data.
    pub async fn import(
        &self,
        format: ImportFormat,
        file_path: &str,
    ) -> Result<(), BitwardenError> {
        let fmt = format.as_str();
        self.run_command(&["import", fmt, file_path]).await?;
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
        let mut args: Vec<String> = vec![
            "send".to_string(),
            "create".to_string(),
            "--name".to_string(),
            name.to_string(),
        ];

        args.push(text.to_string());

        if hidden {
            args.push("--hidden".to_string());
        }

        if let Some(max) = max_access {
            args.push("--maxAccessCount".to_string());
            args.push(max.to_string());
        }

        if let Some(pw) = password {
            args.push("--password".to_string());
            args.push(pw.to_string());
        }

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        self.run_json(&args_ref).await
    }

    /// Delete a send.
    pub async fn delete_send(&self, id: &str) -> Result<(), BitwardenError> {
        self.run_command(&["send", "delete", id]).await?;
        Ok(())
    }

    /// Receive a send by URL.
    pub async fn receive_send(&self, url: &str, password: Option<&str>) -> Result<String, BitwardenError> {
        let mut args = vec!["send", "receive", url];
        if let Some(pw) = password {
            args.push("--password");
            args.push(pw);
        }
        self.run_command(&args).await
    }

    // ── Serve ───────────────────────────────────────────────────────

    /// Check if `bw serve` is reachable at the given port.
    pub async fn check_serve_running(hostname: &str, port: u16) -> bool {
        let url = format!("http://{}:{}/status", hostname, port);
        match reqwest::get(&url).await {
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
        let port_str = port.to_string();
        let mut cmd = Command::new(self.bw_path());
        cmd.args(["serve", "--hostname", hostname, "--port", &port_str])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(ref key) = self.session_key {
            cmd.env("BW_SESSION", key);
        }

        for (k, v) in &self.env_vars {
            cmd.env(k, v);
        }

        cmd.spawn()
            .map_err(|e| BitwardenError::io(format!("Failed to start bw serve: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Constructor tests ───────────────────────────────────────────

    #[test]
    fn cli_default() {
        let cli = BitwardenCli::new();
        assert_eq!(cli.bw_path(), "bw");
        assert!(cli.session_key.is_none());
    }

    #[test]
    fn cli_with_path() {
        let cli = BitwardenCli::new().with_cli_path("/usr/local/bin/bw");
        assert_eq!(cli.bw_path(), "/usr/local/bin/bw");
    }

    #[test]
    fn cli_from_config() {
        let config = BitwardenConfig {
            cli_path: Some("/opt/bw".into()),
            timeout_secs: 60,
            ..Default::default()
        };
        let cli = BitwardenCli::from_config(&config);
        assert_eq!(cli.bw_path(), "/opt/bw");
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
        assert_eq!(cli.env_vars.get("BW_CLIENTSECRET").unwrap(), "client_secret_value");
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
