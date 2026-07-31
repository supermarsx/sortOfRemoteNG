//! REST API client for Bitwarden integration.
//!
//! Provides two API clients:
//! 1. **VaultApiClient** – talks to the local `bw serve` HTTP API for vault CRUD
//! 2. **PublicApiClient** – talks to the Bitwarden Public API (organization management)

use crate::bitwarden::types::*;
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use std::net::IpAddr;
use std::time::Duration;

const MAX_API_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_TOKEN_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_API_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES: usize = 128 * 1024 * 1024;
const MAX_SECRET_BYTES: usize = 64 * 1024;
const MAX_IDENTIFIER_BYTES: usize = 512;

fn validate_loopback_hostname(hostname: &str) -> Result<String, BitwardenError> {
    if hostname.is_empty() || hostname.len() > 255 || hostname.contains('\0') {
        return Err(BitwardenError::invalid_config(
            "Invalid local Bitwarden API hostname",
        ));
    }
    let bare = hostname.trim_matches(|character| character == '[' || character == ']');
    let loopback = bare.eq_ignore_ascii_case("localhost")
        || bare.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback());
    if !loopback {
        return Err(BitwardenError::invalid_config(
            "The local Bitwarden API must use a loopback hostname",
        ));
    }
    if bare.contains(':') {
        Ok(format!("[{}]", bare))
    } else {
        Ok(bare.to_string())
    }
}

fn validate_https_url(raw: &str, label: &'static str) -> Result<String, BitwardenError> {
    if raw.is_empty() || raw.len() > 2048 || raw.contains('\0') {
        return Err(BitwardenError::invalid_config(format!("Invalid {}", label)));
    }
    let parsed = url::Url::parse(raw)
        .map_err(|_| BitwardenError::invalid_config(format!("Invalid {}", label)))?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(BitwardenError::invalid_config(format!(
            "{} must be an HTTPS URL without credentials, a query, or a fragment",
            label
        )));
    }
    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

fn validate_identifier(value: &str, label: &'static str) -> Result<(), BitwardenError> {
    if value.is_empty()
        || value.len() > MAX_IDENTIFIER_BYTES
        || value.contains('\0')
        || value.contains('/')
        || value.contains('\\')
        || value.contains('?')
        || value.contains('#')
    {
        return Err(BitwardenError::invalid_config(format!("Invalid {}", label)));
    }
    Ok(())
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

fn validate_json_request<T: Serialize>(value: &T, limit: usize) -> Result<(), BitwardenError> {
    let encoded = serde_json::to_vec(value)
        .map_err(|_| BitwardenError::parse("Failed to serialize Bitwarden API request"))?;
    if encoded.len() > limit {
        return Err(BitwardenError::invalid_config(
            "Bitwarden API request exceeds the safety limit",
        ));
    }
    Ok(())
}

async fn read_json_response<T: serde::de::DeserializeOwned>(
    mut response: reqwest::Response,
    limit: usize,
    context: &'static str,
) -> Result<T, BitwardenError> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(BitwardenError::api(format!(
            "{} response exceeds the safety limit",
            context
        )));
    }
    let mut bytes = Vec::with_capacity(limit.min(16 * 1024));
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| BitwardenError::network(format!("{} response read failed", context)))?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(BitwardenError::api(format!(
                "{} response exceeds the safety limit",
                context
            )));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| BitwardenError::parse(format!("{} response was invalid JSON", context)))
}

// ── Vault Management API (bw serve) ────────────────────────────────

/// Client for the `bw serve` local REST API (Vault Management API).
///
/// Requires a running `bw serve` instance (default: localhost:8087).
#[derive(Debug, Clone)]
pub struct VaultApiClient {
    client: Client,
    base_url: String,
}

impl VaultApiClient {
    /// Create a new Vault API client.
    pub fn new(hostname: &str, port: u16) -> Result<Self, BitwardenError> {
        let hostname = validate_loopback_hostname(hostname)?;
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| BitwardenError::network("Failed to create local Bitwarden API client"))?;

        Ok(Self {
            client,
            base_url: format!("http://{}:{}", hostname, port),
        })
    }

    /// Create from config.
    pub fn from_config(config: &BitwardenConfig) -> Result<Self, BitwardenError> {
        Self::new(&config.serve_hostname, config.serve_port)
    }

    /// Check if the API server is reachable.
    pub async fn health_check(&self) -> Result<bool, BitwardenError> {
        let url = format!("{}/status", self.base_url);
        match self.client.get(&url).send().await {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    // ── Status ──────────────────────────────────────────────────────

    /// Get the vault status.
    pub async fn status(&self) -> Result<StatusInfo, BitwardenError> {
        let url = format!("{}/status", self.base_url);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Status request failed"))?;

        let body: Value = read_json_response(resp, MAX_API_RESPONSE_BYTES, "Status").await?;

        // The response has { success, data: { template: { ... } } }
        let data = body
            .get("data")
            .and_then(|d| d.get("template"))
            .unwrap_or(&body);

        serde_json::from_value(data.clone())
            .map_err(|e| BitwardenError::parse(format!("Status parse error: {}", e)))
    }

    // ── Lock / Unlock ───────────────────────────────────────────────

    /// Unlock the vault via the API.
    pub async fn unlock(&self, password: &str) -> Result<String, BitwardenError> {
        validate_secret(password, "Master password")?;
        let url = format!("{}/unlock", self.base_url);
        let body = serde_json::json!({ "password": password });
        validate_json_request(&body, MAX_API_REQUEST_BYTES)?;

        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Unlock request failed"))?;

        let result: Value = read_json_response(resp, MAX_TOKEN_RESPONSE_BYTES, "Unlock").await?;

        if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
            let title = result
                .get("data")
                .and_then(|d| d.get("title"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            // The session key is returned in data.raw
            let raw = result
                .get("data")
                .and_then(|d| d.get("raw"))
                .and_then(|r| r.as_str())
                .unwrap_or(title);
            Ok(raw.to_string())
        } else {
            Err(BitwardenError::auth_failed("Unlock failed"))
        }
    }

    /// Lock the vault via the API.
    pub async fn lock(&self) -> Result<(), BitwardenError> {
        let url = format!("{}/lock", self.base_url);
        let resp = self
            .client
            .post(&url)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Lock request failed"))?;

        let result: Value = read_json_response(resp, MAX_TOKEN_RESPONSE_BYTES, "Lock").await?;

        if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
            Ok(())
        } else {
            Err(BitwardenError::api("Lock failed"))
        }
    }

    // ── Sync ────────────────────────────────────────────────────────

    /// Trigger a vault sync.
    pub async fn sync(&self) -> Result<(), BitwardenError> {
        let url = format!("{}/sync", self.base_url);
        let resp = self
            .client
            .post(&url)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Sync request failed"))?;

        let result: Value = read_json_response(resp, MAX_TOKEN_RESPONSE_BYTES, "Sync").await?;

        if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
            Ok(())
        } else {
            Err(BitwardenError::sync_failed("Sync failed"))
        }
    }

    // ── Item CRUD ───────────────────────────────────────────────────

    /// List all items.
    pub async fn list_items(&self) -> Result<Vec<VaultItem>, BitwardenError> {
        let url = format!("{}/list/object/items", self.base_url);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|_| BitwardenError::network("List items failed"))?;

        let body: Value = read_json_response(resp, MAX_API_RESPONSE_BYTES, "List items").await?;

        let data = body
            .get("data")
            .and_then(|d| d.get("data"))
            .cloned()
            .unwrap_or_else(|| Value::Array(vec![]));

        serde_json::from_value(data)
            .map_err(|e| BitwardenError::parse(format!("Item parse error: {}", e)))
    }

    /// Search items.
    pub async fn search_items(&self, search: &str) -> Result<Vec<VaultItem>, BitwardenError> {
        if search.len() > MAX_IDENTIFIER_BYTES || search.contains('\0') {
            return Err(BitwardenError::invalid_config("Invalid item search"));
        }
        let url = format!(
            "{}/list/object/items?search={}",
            self.base_url,
            urlencoding::encode(search)
        );
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Search failed"))?;

        let body: Value = read_json_response(resp, MAX_API_RESPONSE_BYTES, "Search").await?;

        let data = body
            .get("data")
            .and_then(|d| d.get("data"))
            .cloned()
            .unwrap_or_else(|| Value::Array(vec![]));

        serde_json::from_value(data)
            .map_err(|e| BitwardenError::parse(format!("Item parse error: {}", e)))
    }

    /// Get an item by ID.
    pub async fn get_item(&self, id: &str) -> Result<VaultItem, BitwardenError> {
        validate_identifier(id, "item ID")?;
        let url = format!("{}/object/item/{}", self.base_url, id);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Get item failed"))?;

        let body: Value = read_json_response(resp, MAX_API_RESPONSE_BYTES, "Get item").await?;

        if body.get("success").and_then(|v| v.as_bool()) != Some(true) {
            return Err(BitwardenError::not_found("Item not found"));
        }

        let data = body
            .get("data")
            .ok_or_else(|| BitwardenError::parse("No data in response"))?;
        serde_json::from_value(data.clone())
            .map_err(|e| BitwardenError::parse(format!("Item parse error: {}", e)))
    }

    /// Create a new item.
    pub async fn create_item(&self, item: &VaultItem) -> Result<VaultItem, BitwardenError> {
        validate_json_request(item, MAX_API_REQUEST_BYTES)?;
        let url = format!("{}/object/item", self.base_url);
        let resp = self
            .client
            .post(&url)
            .json(item)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Create item failed"))?;

        let body: Value = read_json_response(resp, MAX_API_RESPONSE_BYTES, "Create item").await?;

        if body.get("success").and_then(|v| v.as_bool()) != Some(true) {
            return Err(BitwardenError::api("Create item failed"));
        }

        let data = body
            .get("data")
            .ok_or_else(|| BitwardenError::parse("No data in response"))?;
        serde_json::from_value(data.clone())
            .map_err(|e| BitwardenError::parse(format!("Parse error: {}", e)))
    }

    /// Update an existing item.
    pub async fn update_item(
        &self,
        id: &str,
        item: &VaultItem,
    ) -> Result<VaultItem, BitwardenError> {
        validate_identifier(id, "item ID")?;
        validate_json_request(item, MAX_API_REQUEST_BYTES)?;
        let url = format!("{}/object/item/{}", self.base_url, id);
        let resp = self
            .client
            .put(&url)
            .json(item)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Update item failed"))?;

        let body: Value = read_json_response(resp, MAX_API_RESPONSE_BYTES, "Update item").await?;

        if body.get("success").and_then(|v| v.as_bool()) != Some(true) {
            return Err(BitwardenError::api("Update item failed"));
        }

        let data = body
            .get("data")
            .ok_or_else(|| BitwardenError::parse("No data in response"))?;
        serde_json::from_value(data.clone())
            .map_err(|e| BitwardenError::parse(format!("Parse error: {}", e)))
    }

    /// Delete an item.
    pub async fn delete_item(&self, id: &str) -> Result<(), BitwardenError> {
        validate_identifier(id, "item ID")?;
        let url = format!("{}/object/item/{}", self.base_url, id);
        let resp = self
            .client
            .delete(&url)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Delete item failed"))?;

        let body: Value = read_json_response(resp, MAX_TOKEN_RESPONSE_BYTES, "Delete item").await?;

        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
            Ok(())
        } else {
            let msg = body
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Delete failed");
            Err(BitwardenError::api(msg))
        }
    }

    // ── Folder CRUD ─────────────────────────────────────────────────

    /// List all folders.
    pub async fn list_folders(&self) -> Result<Vec<Folder>, BitwardenError> {
        let url = format!("{}/list/object/folders", self.base_url);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|_| BitwardenError::network("List folders failed"))?;

        let body: Value = read_json_response(resp, MAX_API_RESPONSE_BYTES, "List folders").await?;

        let data = body
            .get("data")
            .and_then(|d| d.get("data"))
            .cloned()
            .unwrap_or_else(|| Value::Array(vec![]));

        serde_json::from_value(data)
            .map_err(|e| BitwardenError::parse(format!("Folder parse error: {}", e)))
    }

    /// Create a folder.
    pub async fn create_folder(&self, folder: &Folder) -> Result<Folder, BitwardenError> {
        validate_json_request(folder, MAX_API_REQUEST_BYTES)?;
        let url = format!("{}/object/folder", self.base_url);
        let resp = self
            .client
            .post(&url)
            .json(folder)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Create folder failed"))?;

        let body: Value = read_json_response(resp, MAX_API_RESPONSE_BYTES, "Create folder").await?;

        let data = body
            .get("data")
            .ok_or_else(|| BitwardenError::parse("No data"))?;
        serde_json::from_value(data.clone())
            .map_err(|e| BitwardenError::parse(format!("Parse error: {}", e)))
    }

    /// Update a folder.
    pub async fn update_folder(&self, id: &str, folder: &Folder) -> Result<Folder, BitwardenError> {
        validate_identifier(id, "folder ID")?;
        validate_json_request(folder, MAX_API_REQUEST_BYTES)?;
        let url = format!("{}/object/folder/{}", self.base_url, id);
        let resp = self
            .client
            .put(&url)
            .json(folder)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Update folder failed"))?;

        let body: Value = read_json_response(resp, MAX_API_RESPONSE_BYTES, "Update folder").await?;

        let data = body
            .get("data")
            .ok_or_else(|| BitwardenError::parse("No data"))?;
        serde_json::from_value(data.clone())
            .map_err(|e| BitwardenError::parse(format!("Parse error: {}", e)))
    }

    /// Delete a folder.
    pub async fn delete_folder(&self, id: &str) -> Result<(), BitwardenError> {
        validate_identifier(id, "folder ID")?;
        let url = format!("{}/object/folder/{}", self.base_url, id);
        let resp = self
            .client
            .delete(&url)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Delete folder failed"))?;

        let body: Value =
            read_json_response(resp, MAX_TOKEN_RESPONSE_BYTES, "Delete folder").await?;

        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
            Ok(())
        } else {
            Err(BitwardenError::api("Delete folder failed"))
        }
    }

    // ── Send CRUD ───────────────────────────────────────────────────

    /// List all sends.
    pub async fn list_sends(&self) -> Result<Vec<Send>, BitwardenError> {
        let url = format!("{}/list/object/send", self.base_url);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|_| BitwardenError::network("List sends failed"))?;

        let body: Value = read_json_response(resp, MAX_API_RESPONSE_BYTES, "List sends").await?;

        let data = body
            .get("data")
            .and_then(|d| d.get("data"))
            .cloned()
            .unwrap_or_else(|| Value::Array(vec![]));

        serde_json::from_value(data)
            .map_err(|e| BitwardenError::parse(format!("Send parse error: {}", e)))
    }

    /// Create a send.
    pub async fn create_send(&self, send: &Send) -> Result<Send, BitwardenError> {
        validate_json_request(send, MAX_API_REQUEST_BYTES)?;
        let url = format!("{}/object/send", self.base_url);
        let resp = self
            .client
            .post(&url)
            .json(send)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Create send failed"))?;

        let body: Value = read_json_response(resp, MAX_API_RESPONSE_BYTES, "Create send").await?;

        let data = body
            .get("data")
            .ok_or_else(|| BitwardenError::parse("No data"))?;
        serde_json::from_value(data.clone())
            .map_err(|e| BitwardenError::parse(format!("Parse error: {}", e)))
    }

    /// Delete a send.
    pub async fn delete_send(&self, id: &str) -> Result<(), BitwardenError> {
        validate_identifier(id, "Send ID")?;
        let url = format!("{}/object/send/{}", self.base_url, id);
        let resp = self
            .client
            .delete(&url)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Delete send failed"))?;

        let body: Value = read_json_response(resp, MAX_TOKEN_RESPONSE_BYTES, "Delete send").await?;

        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
            Ok(())
        } else {
            Err(BitwardenError::api("Delete send failed"))
        }
    }

    // ── Generate ────────────────────────────────────────────────────

    /// Generate a password via the API.
    pub async fn generate_password(
        &self,
        opts: &PasswordGenerateOptions,
    ) -> Result<String, BitwardenError> {
        let mut params = Vec::new();
        if opts.passphrase {
            params.push("type=passphrase".to_string());
            if let Some(words) = opts.words {
                params.push(format!("words={}", words));
            }
            if let Some(ref sep) = opts.separator {
                params.push(format!("separator={}", urlencoding::encode(sep)));
            }
            if opts.capitalize {
                params.push("capitalize=true".to_string());
            }
            if opts.include_number {
                params.push("includeNumber=true".to_string());
            }
        } else {
            params.push(format!("length={}", opts.length));
            if opts.uppercase {
                params.push("uppercase=true".to_string());
            }
            if opts.lowercase {
                params.push("lowercase=true".to_string());
            }
            if opts.numbers {
                params.push("number=true".to_string());
            }
            if opts.special {
                params.push("special=true".to_string());
            }
        }

        let query = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };
        let url = format!("{}/generate{}", self.base_url, query);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Generate request failed"))?;

        let body: Value = read_json_response(resp, MAX_TOKEN_RESPONSE_BYTES, "Generate").await?;

        body.get("data")
            .and_then(|d| d.get("data"))
            .and_then(|d| d.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| BitwardenError::parse("No generated password in response"))
    }

    // ── Attachment ──────────────────────────────────────────────────

    /// Create an attachment on an item.
    pub async fn create_attachment(
        &self,
        item_id: &str,
        _file_path: &str,
        file_data: Vec<u8>,
        filename: &str,
    ) -> Result<VaultItem, BitwardenError> {
        validate_identifier(item_id, "item ID")?;
        if file_data.len() > MAX_ATTACHMENT_BYTES {
            return Err(BitwardenError::invalid_config(
                "Attachment exceeds the safety limit",
            ));
        }
        if filename.is_empty()
            || filename.len() > MAX_IDENTIFIER_BYTES
            || filename
                .chars()
                .any(|character| matches!(character, '\0' | '/' | '\\'))
        {
            return Err(BitwardenError::invalid_config(
                "Invalid attachment filename",
            ));
        }
        let url = format!("{}/attachment?itemid={}", self.base_url, item_id);

        let part = reqwest::multipart::Part::bytes(file_data).file_name(filename.to_string());
        let form = reqwest::multipart::Form::new().part("file", part);

        let resp = self
            .client
            .post(&url)
            .multipart(form)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Upload attachment failed"))?;

        let body: Value =
            read_json_response(resp, MAX_API_RESPONSE_BYTES, "Upload attachment").await?;

        let data = body
            .get("data")
            .ok_or_else(|| BitwardenError::parse("No data"))?;
        serde_json::from_value(data.clone())
            .map_err(|e| BitwardenError::parse(format!("Parse error: {}", e)))
    }
}

// ── Public API Client (Organization Management) ────────────────────

/// Client for the Bitwarden Public API (organization-level management).
///
/// Uses OAuth2 client_credentials grant with scope `api.organization`.
#[derive(Debug, Clone)]
pub struct PublicApiClient {
    client: Client,
    api_url: String,
    identity_url: String,
    access_token: Option<String>,
    client_id: String,
    client_secret: String,
}

impl PublicApiClient {
    /// Create a new Public API client.
    pub fn new(
        api_url: &str,
        identity_url: &str,
        client_id: &str,
        client_secret: &str,
    ) -> Result<Self, BitwardenError> {
        let api_url = validate_https_url(api_url, "Bitwarden API URL")?;
        let identity_url = validate_https_url(identity_url, "Bitwarden identity URL")?;
        validate_secret(client_id, "Bitwarden client ID")?;
        validate_secret(client_secret, "Bitwarden client secret")?;
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| BitwardenError::network("Failed to create Bitwarden API client"))?;

        Ok(Self {
            client,
            api_url,
            identity_url,
            access_token: None,
            client_id: client_id.to_string(),
            client_secret: client_secret.to_string(),
        })
    }

    /// Create from config with API key credentials.
    pub fn from_config(
        config: &BitwardenConfig,
        client_id: &str,
        client_secret: &str,
    ) -> Result<Self, BitwardenError> {
        Self::new(
            &config.api_url,
            &config.identity_url,
            client_id,
            client_secret,
        )
    }

    /// Authenticate with OAuth2 client_credentials grant.
    pub async fn authenticate(&mut self) -> Result<BearerToken, BitwardenError> {
        validate_secret(&self.client_id, "Bitwarden client ID")?;
        validate_secret(&self.client_secret, "Bitwarden client secret")?;
        let url = format!("{}/connect/token", self.identity_url);

        let params = [
            ("grant_type", "client_credentials"),
            ("scope", "api.organization"),
            ("client_id", &self.client_id),
            ("client_secret", &self.client_secret),
        ];

        let resp = self
            .client
            .post(&url)
            .form(&params)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Authentication request failed"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            return Err(BitwardenError::auth_failed(format!(
                "OAuth2 authentication failed ({})",
                status
            )));
        }

        let token: BearerToken =
            read_json_response(resp, MAX_TOKEN_RESPONSE_BYTES, "OAuth token").await?;

        self.access_token = Some(token.access_token.clone());
        Ok(token)
    }

    /// Set the access token directly (e.g., from a cached token).
    pub fn set_access_token(&mut self, token: &str) {
        self.access_token = Some(token.to_string());
    }

    /// Make an authenticated API request.
    async fn api_get(&self, path: &str) -> Result<Value, BitwardenError> {
        let token = self
            .access_token
            .as_ref()
            .ok_or_else(|| BitwardenError::auth_failed("Not authenticated"))?;
        validate_secret(token, "Bitwarden access token")?;

        let url = format!("{}{}", self.api_url, path);
        let resp = self
            .client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Bitwarden API GET failed"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            return Err(BitwardenError::api(format!(
                "Bitwarden API error ({})",
                status
            )));
        }

        read_json_response(resp, MAX_API_RESPONSE_BYTES, "Bitwarden API").await
    }

    /// Make an authenticated POST request.
    async fn api_post(&self, path: &str, body: &Value) -> Result<Value, BitwardenError> {
        let token = self
            .access_token
            .as_ref()
            .ok_or_else(|| BitwardenError::auth_failed("Not authenticated"))?;
        validate_secret(token, "Bitwarden access token")?;
        validate_json_request(body, MAX_API_REQUEST_BYTES)?;

        let url = format!("{}{}", self.api_url, path);
        let resp = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(body)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Bitwarden API POST failed"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            return Err(BitwardenError::api(format!(
                "Bitwarden API error ({})",
                status
            )));
        }

        read_json_response(resp, MAX_API_RESPONSE_BYTES, "Bitwarden API").await
    }

    /// Make an authenticated DELETE request.
    async fn api_delete(&self, path: &str) -> Result<(), BitwardenError> {
        let token = self
            .access_token
            .as_ref()
            .ok_or_else(|| BitwardenError::auth_failed("Not authenticated"))?;
        validate_secret(token, "Bitwarden access token")?;

        let url = format!("{}{}", self.api_url, path);
        let resp = self
            .client
            .delete(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| BitwardenError::network("Bitwarden API DELETE failed"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            return Err(BitwardenError::api(format!(
                "Bitwarden API error ({})",
                status
            )));
        }

        Ok(())
    }

    // ── Members ─────────────────────────────────────────────────────

    /// List organization members.
    pub async fn list_members(&self) -> Result<Vec<OrgMember>, BitwardenError> {
        let result = self.api_get("/public/members").await?;
        let data = result
            .get("data")
            .cloned()
            .unwrap_or_else(|| Value::Array(vec![]));
        serde_json::from_value(data)
            .map_err(|e| BitwardenError::parse(format!("Members parse error: {}", e)))
    }

    /// Get a member by ID.
    pub async fn get_member(&self, id: &str) -> Result<OrgMember, BitwardenError> {
        validate_identifier(id, "member ID")?;
        let result = self.api_get(&format!("/public/members/{}", id)).await?;
        serde_json::from_value(result)
            .map_err(|e| BitwardenError::parse(format!("Member parse error: {}", e)))
    }

    /// Invite a new member.
    pub async fn invite_member(
        &self,
        email: &str,
        member_type: OrgUserType,
        collections: &[Value],
    ) -> Result<OrgMember, BitwardenError> {
        let body = serde_json::json!({
            "type": member_type as u8,
            "email": email,
            "collections": collections,
        });

        let result = self.api_post("/public/members", &body).await?;
        serde_json::from_value(result)
            .map_err(|e| BitwardenError::parse(format!("Invite parse error: {}", e)))
    }

    /// Reinvite a member.
    pub async fn reinvite_member(&self, id: &str) -> Result<(), BitwardenError> {
        validate_identifier(id, "member ID")?;
        self.api_post(
            &format!("/public/members/{}/reinvite", id),
            &serde_json::json!({}),
        )
        .await?;
        Ok(())
    }

    /// Remove a member.
    pub async fn remove_member(&self, id: &str) -> Result<(), BitwardenError> {
        validate_identifier(id, "member ID")?;
        self.api_delete(&format!("/public/members/{}", id)).await
    }

    // ── Collections ─────────────────────────────────────────────────

    /// List organization collections.
    pub async fn list_collections(&self) -> Result<Vec<Collection>, BitwardenError> {
        let result = self.api_get("/public/collections").await?;
        let data = result
            .get("data")
            .cloned()
            .unwrap_or_else(|| Value::Array(vec![]));
        serde_json::from_value(data)
            .map_err(|e| BitwardenError::parse(format!("Collections parse error: {}", e)))
    }

    /// Get a collection by ID.
    pub async fn get_collection(&self, id: &str) -> Result<Collection, BitwardenError> {
        validate_identifier(id, "collection ID")?;
        let result = self.api_get(&format!("/public/collections/{}", id)).await?;
        serde_json::from_value(result)
            .map_err(|e| BitwardenError::parse(format!("Collection parse error: {}", e)))
    }

    /// Delete a collection.
    pub async fn delete_collection(&self, id: &str) -> Result<(), BitwardenError> {
        validate_identifier(id, "collection ID")?;
        self.api_delete(&format!("/public/collections/{}", id))
            .await
    }

    // ── Groups ──────────────────────────────────────────────────────

    /// List organization groups.
    pub async fn list_groups(&self) -> Result<Vec<Value>, BitwardenError> {
        let result = self.api_get("/public/groups").await?;
        let data = result
            .get("data")
            .cloned()
            .unwrap_or_else(|| Value::Array(vec![]));
        serde_json::from_value(data)
            .map_err(|e| BitwardenError::parse(format!("Groups parse error: {}", e)))
    }

    // ── Events ──────────────────────────────────────────────────────

    /// List organization events.
    pub async fn list_events(
        &self,
        start: Option<&str>,
        end: Option<&str>,
    ) -> Result<Vec<EventLogEntry>, BitwardenError> {
        let mut params = Vec::new();
        if let Some(s) = start {
            params.push(format!("start={}", s));
        }
        if let Some(e) = end {
            params.push(format!("end={}", e));
        }
        let query = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };
        let result = self.api_get(&format!("/public/events{}", query)).await?;
        let data = result
            .get("data")
            .cloned()
            .unwrap_or_else(|| Value::Array(vec![]));
        serde_json::from_value(data)
            .map_err(|e| BitwardenError::parse(format!("Events parse error: {}", e)))
    }

    // ── Policies ────────────────────────────────────────────────────

    /// List organization policies.
    pub async fn list_policies(&self) -> Result<Vec<Value>, BitwardenError> {
        let result = self.api_get("/public/policies").await?;
        let data = result
            .get("data")
            .cloned()
            .unwrap_or_else(|| Value::Array(vec![]));
        serde_json::from_value(data)
            .map_err(|e| BitwardenError::parse(format!("Policies parse error: {}", e)))
    }
}

/// URL encoding helper (brought inline to avoid extra dependencies).
mod urlencoding {
    pub fn encode(input: &str) -> String {
        let mut result = String::with_capacity(input.len() * 3);
        for byte in input.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    result.push(byte as char);
                }
                _ => {
                    result.push_str(&format!("%{:02X}", byte));
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── VaultApiClient construction ─────────────────────────────────

    #[test]
    fn vault_api_client_new() {
        let client = VaultApiClient::new("localhost", 8087).unwrap();
        assert_eq!(client.base_url, "http://localhost:8087");
    }

    #[test]
    fn vault_api_client_from_config() {
        let config = BitwardenConfig::default();
        let client = VaultApiClient::from_config(&config).unwrap();
        assert_eq!(client.base_url, "http://localhost:8087");
    }

    #[test]
    fn vault_api_custom_port() {
        let client = VaultApiClient::new("127.0.0.1", 9999).unwrap();
        assert_eq!(client.base_url, "http://127.0.0.1:9999");
    }

    // ── PublicApiClient construction ────────────────────────────────

    #[test]
    fn public_api_client_new() {
        let client = PublicApiClient::new(
            "https://api.bitwarden.com",
            "https://identity.bitwarden.com",
            "client_id",
            "client_secret",
        )
        .unwrap();
        assert_eq!(client.api_url, "https://api.bitwarden.com");
        assert_eq!(client.identity_url, "https://identity.bitwarden.com");
    }

    #[test]
    fn public_api_client_from_config() {
        let config = BitwardenConfig::default();
        let client = PublicApiClient::from_config(&config, "cid", "csecret").unwrap();
        assert_eq!(client.api_url, "https://api.bitwarden.com");
    }

    #[test]
    fn public_api_strips_trailing_slash() {
        let client = PublicApiClient::new(
            "https://api.bitwarden.com/",
            "https://identity.bitwarden.com/",
            "cid",
            "csec",
        )
        .unwrap();
        assert_eq!(client.api_url, "https://api.bitwarden.com");
        assert_eq!(client.identity_url, "https://identity.bitwarden.com");
    }

    #[test]
    fn public_api_set_access_token() {
        let mut client = PublicApiClient::new(
            "https://api.bitwarden.com",
            "https://identity.bitwarden.com",
            "cid",
            "csec",
        )
        .unwrap();
        assert!(client.access_token.is_none());
        client.set_access_token("test_token");
        assert_eq!(client.access_token.as_deref(), Some("test_token"));
    }

    // ── URL encoding ────────────────────────────────────────────────

    #[test]
    fn urlencoding_basic() {
        assert_eq!(urlencoding::encode("hello"), "hello");
        assert_eq!(urlencoding::encode("hello world"), "hello%20world");
        assert_eq!(urlencoding::encode("a+b"), "a%2Bb");
        assert_eq!(urlencoding::encode("a&b=c"), "a%26b%3Dc");
    }

    #[test]
    fn urlencoding_special_chars() {
        assert_eq!(
            urlencoding::encode("test@example.com"),
            "test%40example.com"
        );
        assert_eq!(urlencoding::encode("100%"), "100%25");
    }

    // ── Async health check (fails gracefully) ──────────────────────

    #[tokio::test]
    async fn vault_api_health_check_unreachable() {
        // We use a port unlikely to be in use
        let client = VaultApiClient::new("127.0.0.1", 19999).unwrap();
        let result = client.health_check().await;
        // Should return Ok(false) since the server isn't running
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn public_api_requires_auth() {
        let client = PublicApiClient::new(
            "https://api.bitwarden.com",
            "https://identity.bitwarden.com",
            "cid",
            "csec",
        )
        .unwrap();
        // Should fail because we're not authenticated
        let result = client.list_members().await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind, BitwardenErrorKind::AuthFailed);
    }
}
