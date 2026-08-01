use reqwest::{
    header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    redirect::Policy,
    Client, RequestBuilder, Response, StatusCode,
};
use serde::{de::DeserializeOwned, Serialize};
use std::{future::Future, time::Duration};
use tokio::time::{timeout_at, Instant};
use url::{Host, Url};

use super::types::*;

pub(crate) const MAX_VAULTS: usize = 512;
pub(crate) const MAX_ITEMS_PER_VAULT: usize = 4_096;
pub(crate) const MAX_FILES_PER_ITEM: usize = 1_024;
pub(crate) const MAX_ACTIVITY_RECORDS: usize = 1_000;
pub(crate) const MAX_SCAN_VAULTS: usize = 64;
pub(crate) const MAX_SCAN_ITEMS: usize = 8_192;
pub(crate) const MAX_FIELD_VALUE_BYTES: usize = 1024 * 1024;
const MAX_ITEM_TITLE_BYTES: usize = 1_024;
const MAX_ITEM_URLS: usize = 64;
const MAX_ITEM_TAGS: usize = 128;
const MAX_ITEM_SECTIONS: usize = 128;
const MAX_ITEM_FIELDS: usize = 1_024;
const MAX_PATCH_NODES: usize = 4_096;
const MAX_PATCH_DEPTH: usize = 16;
const MAX_JSON_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_JSON_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILE_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
const MAX_TOKEN_BYTES: usize = 16 * 1024;
const MAX_FILTER_BYTES: usize = 4 * 1024;
const MULTI_REQUEST_DEADLINE: Duration = Duration::from_secs(120);

pub(crate) fn operation_deadline() -> Instant {
    Instant::now() + MULTI_REQUEST_DEADLINE
}

pub(crate) async fn within_operation_deadline<T, F>(
    deadline: Instant,
    operation: F,
) -> Result<T, OnePasswordError>
where
    F: Future<Output = Result<T, OnePasswordError>>,
{
    timeout_at(deadline, operation).await.map_err(|_| {
        OnePasswordError::timeout(
            "1Password multi-request operation exceeded its aggregate deadline",
        )
    })?
}

/// Low-level HTTP client for the 1Password Connect Server REST API (v1).
///
/// Endpoints follow the schema at
/// <https://developer.1password.com/docs/connect/connect-api-reference/>.
///
/// All requests are authenticated via `Authorization: Bearer <token>`.
pub struct OnePasswordApiClient {
    client: Client,
    base_url: String,
    auth_header: Vec<u8>,
    timeout: Duration,
    max_inline_bytes: usize,
}

impl OnePasswordApiClient {
    // ── Constructors ────────────────────────────────────────────────

    pub fn new(base_url: &str, token: &str, timeout_secs: u64) -> Result<Self, OnePasswordError> {
        Self::new_with_options(base_url, token.as_bytes().to_vec(), timeout_secs, true, 256)
    }

    fn new_with_options(
        base_url: &str,
        mut token: Vec<u8>,
        timeout_secs: u64,
        verify_tls: bool,
        max_inline_file_size_kb: u32,
    ) -> Result<Self, OnePasswordError> {
        let result = Self::build(
            base_url,
            &token,
            timeout_secs,
            verify_tls,
            max_inline_file_size_kb,
        );
        let (client, base_url, timeout, max_inline_bytes) = match result {
            Ok(value) => value,
            Err(error) => {
                token.fill(0);
                return Err(error);
            }
        };

        let mut auth_header = Vec::with_capacity(7 + token.len());
        auth_header.extend_from_slice(b"Bearer ");
        auth_header.extend_from_slice(&token);
        token.fill(0);

        Ok(Self {
            client,
            base_url,
            auth_header,
            timeout,
            max_inline_bytes,
        })
    }

    fn build(
        base_url: &str,
        token: &[u8],
        timeout_secs: u64,
        verify_tls: bool,
        max_inline_file_size_kb: u32,
    ) -> Result<(Client, String, Duration, usize), OnePasswordError> {
        Self::validate_token_bytes(token)?;
        if !(1..=120).contains(&timeout_secs) {
            return Err(OnePasswordError::config_error(
                "Request timeout must be between 1 and 120 seconds",
            ));
        }
        if !(1..=8_192).contains(&max_inline_file_size_kb) {
            return Err(OnePasswordError::config_error(
                "Maximum inline file size must be between 1 KB and 8192 KB",
            ));
        }

        let parsed = Url::parse(base_url.trim())
            .map_err(|_| OnePasswordError::config_error("Connect host URL is invalid"))?;
        if parsed.cannot_be_a_base()
            || parsed.host().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || !matches!(parsed.path(), "" | "/")
        {
            return Err(OnePasswordError::config_error(
                "Connect host must be an origin URL without credentials, path, query, or fragment",
            ));
        }
        let loopback = match parsed.host() {
            Some(Host::Ipv4(ip)) => ip.is_loopback(),
            Some(Host::Ipv6(ip)) => ip.is_loopback(),
            Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
            None => false,
        };
        if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
            return Err(OnePasswordError::config_error(
                "Remote 1Password Connect servers must use HTTPS",
            ));
        }
        if !verify_tls && !loopback {
            return Err(OnePasswordError::config_error(
                "TLS verification may only be disabled for a loopback Connect server",
            ));
        }

        let timeout = Duration::from_secs(timeout_secs);
        let client = Client::builder()
            .timeout(timeout)
            .connect_timeout(Duration::from_secs(timeout_secs.min(10)))
            .redirect(Policy::none())
            .referer(false)
            .danger_accept_invalid_certs(!verify_tls && loopback)
            .build()
            .map_err(|_| OnePasswordError::connection_error("Failed to create HTTP client"))?;

        Ok((
            client,
            parsed.as_str().trim_end_matches('/').to_string(),
            timeout,
            max_inline_file_size_kb as usize * 1024,
        ))
    }

    pub fn from_config(config: &OnePasswordConfig) -> Result<Self, OnePasswordError> {
        if config.connect_host.is_empty() {
            return Err(OnePasswordError::config_error(
                "Connect host URL is required",
            ));
        }
        if config.connect_token.is_empty() {
            return Err(OnePasswordError::config_error("Connect token is required"));
        }
        Self::new_with_options(
            &config.connect_host,
            config.connect_token.as_bytes().to_vec(),
            config.timeout_secs,
            config.verify_tls,
            config.max_inline_file_size_kb,
        )
    }

    pub(crate) fn from_config_with_token(
        config: &OnePasswordConfig,
        token: Vec<u8>,
    ) -> Result<Self, OnePasswordError> {
        if token.is_empty() {
            return Err(OnePasswordError::config_error("Connect token is required"));
        }
        Self::new_with_options(
            &config.connect_host,
            token,
            config.timeout_secs,
            config.verify_tls,
            config.max_inline_file_size_kb,
        )
    }

    pub(crate) fn validate_config(config: &OnePasswordConfig) -> Result<(), OnePasswordError> {
        let mut token = config.connect_token.as_bytes().to_vec();
        let result = Self::build(
            &config.connect_host,
            &token,
            config.timeout_secs,
            config.verify_tls,
            config.max_inline_file_size_kb,
        )
        .map(|_| ());
        token.fill(0);
        result
    }

    // ── URL builder ─────────────────────────────────────────────────

    fn url(&self, path: &str) -> String {
        format!("{}/v1{}", self.base_url, path)
    }

    // ── Auth header injection ───────────────────────────────────────

    fn auth(&self, builder: RequestBuilder) -> RequestBuilder {
        match HeaderValue::from_bytes(&self.auth_header) {
            Ok(mut value) => {
                value.set_sensitive(true);
                builder.header(AUTHORIZATION, value)
            }
            Err(_) => builder.header(AUTHORIZATION, HeaderValue::from_static("invalid")),
        }
    }

    // ── Generic execute ─────────────────────────────────────────────

    async fn execute<T: DeserializeOwned>(
        &self,
        builder: RequestBuilder,
    ) -> Result<T, OnePasswordError> {
        let resp = builder
            .timeout(self.timeout)
            .send()
            .await
            .map_err(OnePasswordError::from)?;

        let status = resp.status();
        if status.is_success() {
            let body = Self::read_limited(resp, MAX_JSON_RESPONSE_BYTES).await?;
            serde_json::from_slice::<T>(&body)
                .map_err(|_| OnePasswordError::parse_error("Connect server returned invalid JSON"))
        } else {
            Err(Self::status_error(status))
        }
    }

    async fn execute_no_body(&self, builder: RequestBuilder) -> Result<(), OnePasswordError> {
        let resp = builder
            .timeout(self.timeout)
            .send()
            .await
            .map_err(OnePasswordError::from)?;

        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else {
            Err(Self::status_error(status))
        }
    }

    async fn execute_bytes(&self, builder: RequestBuilder) -> Result<Vec<u8>, OnePasswordError> {
        let resp = builder
            .timeout(self.timeout)
            .send()
            .await
            .map_err(OnePasswordError::from)?;

        let status = resp.status();
        if status.is_success() {
            Self::read_limited(resp, MAX_FILE_RESPONSE_BYTES).await
        } else {
            Err(Self::status_error(status))
        }
    }

    async fn read_limited(
        mut response: Response,
        limit: usize,
    ) -> Result<Vec<u8>, OnePasswordError> {
        if response
            .content_length()
            .is_some_and(|length| length > limit as u64)
        {
            return Err(OnePasswordError::new(
                OnePasswordErrorKind::FileTooLarge,
                "Connect server response exceeded the configured safety limit",
            ));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| OnePasswordError::connection_error("Failed to read Connect response"))?
        {
            if body.len().saturating_add(chunk.len()) > limit {
                return Err(OnePasswordError::new(
                    OnePasswordErrorKind::FileTooLarge,
                    "Connect server response exceeded the configured safety limit",
                ));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }

    fn status_error(status: StatusCode) -> OnePasswordError {
        let code = status.as_u16();
        match status {
            StatusCode::UNAUTHORIZED => OnePasswordError::token_invalid().with_status(code),
            StatusCode::FORBIDDEN => {
                OnePasswordError::forbidden("Connect server denied the request").with_status(code)
            }
            StatusCode::NOT_FOUND => OnePasswordError::new(
                OnePasswordErrorKind::NotFound,
                "Requested Connect resource was not found",
            )
            .with_status(code),
            StatusCode::BAD_REQUEST => {
                OnePasswordError::bad_request("Connect server rejected the request")
                    .with_status(code)
            }
            StatusCode::CONFLICT => OnePasswordError::new(
                OnePasswordErrorKind::Conflict,
                "Connect server reported a resource conflict",
            )
            .with_status(code),
            StatusCode::TOO_MANY_REQUESTS => OnePasswordError::rate_limited().with_status(code),
            StatusCode::PAYLOAD_TOO_LARGE => OnePasswordError::new(
                OnePasswordErrorKind::FileTooLarge,
                "Connect server rejected an oversized payload",
            )
            .with_status(code),
            _ => OnePasswordError::server_error("Connect server request failed").with_status(code),
        }
    }

    fn json_body<T: Serialize + ?Sized>(
        &self,
        builder: RequestBuilder,
        value: &T,
    ) -> Result<RequestBuilder, OnePasswordError> {
        let body = serde_json::to_vec(value)
            .map_err(|_| OnePasswordError::parse_error("Failed to serialize Connect request"))?;
        if body.len() > MAX_JSON_REQUEST_BYTES {
            return Err(OnePasswordError::bad_request(
                "Connect request exceeded the configured safety limit",
            ));
        }
        Ok(builder.header(CONTENT_TYPE, "application/json").body(body))
    }

    pub(crate) fn validate_identifier(value: &str, label: &str) -> Result<(), OnePasswordError> {
        if value.is_empty()
            || value.len() > 128
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(OnePasswordError::bad_request(format!(
                "{} is invalid",
                label
            )));
        }
        Ok(())
    }

    fn validate_filter(filter: &str) -> Result<(), OnePasswordError> {
        if filter.len() > MAX_FILTER_BYTES || filter.chars().any(char::is_control) {
            return Err(OnePasswordError::bad_request(
                "Connect filter is invalid or too large",
            ));
        }
        Ok(())
    }

    fn validate_full_item(&self, item: &FullItem) -> Result<(), OnePasswordError> {
        Self::validate_identifier(&item.vault.id, "Item vault identifier")?;
        if item.title.as_ref().is_some_and(|title| {
            title.is_empty()
                || title.len() > MAX_ITEM_TITLE_BYTES
                || title.chars().any(char::is_control)
        }) || item.urls.as_ref().is_some_and(|urls| {
            urls.len() > MAX_ITEM_URLS
                || urls.iter().any(|url| {
                    url.href.is_empty()
                        || url.href.len() > 8_192
                        || url.href.chars().any(char::is_control)
                })
        }) || item.tags.as_ref().is_some_and(|tags| {
            tags.len() > MAX_ITEM_TAGS
                || tags.iter().any(|tag| {
                    tag.is_empty() || tag.len() > 256 || tag.chars().any(char::is_control)
                })
        }) || item
            .sections
            .as_ref()
            .is_some_and(|sections| sections.len() > MAX_ITEM_SECTIONS)
            || item.fields.as_ref().is_some_and(|fields| {
                fields.len() > MAX_ITEM_FIELDS
                    || fields.iter().any(|field| {
                        field.id.is_empty()
                            || field.id.len() > 128
                            || field.label.as_ref().is_some_and(|label| {
                                label.len() > 512 || label.chars().any(char::is_control)
                            })
                            || field
                                .value
                                .as_ref()
                                .is_some_and(|value| value.len() > MAX_FIELD_VALUE_BYTES)
                    })
            })
            || item
                .files
                .as_ref()
                .is_some_and(|files| files.len() > MAX_FILES_PER_ITEM)
        {
            return Err(OnePasswordError::bad_request(
                "Item structure exceeds the configured safety limits",
            ));
        }
        Ok(())
    }

    fn validate_json_value(
        value: &serde_json::Value,
        depth: usize,
        nodes: &mut usize,
    ) -> Result<(), OnePasswordError> {
        *nodes = nodes.saturating_add(1);
        if depth > MAX_PATCH_DEPTH || *nodes > MAX_PATCH_NODES {
            return Err(OnePasswordError::bad_request(
                "Patch value exceeds the configured structural limit",
            ));
        }
        match value {
            serde_json::Value::String(value) if value.len() > MAX_FIELD_VALUE_BYTES => Err(
                OnePasswordError::bad_request("Patch string exceeds the configured safety limit"),
            ),
            serde_json::Value::Array(values) => {
                if values.len() > MAX_ITEM_FIELDS {
                    return Err(OnePasswordError::bad_request(
                        "Patch array exceeds the configured safety limit",
                    ));
                }
                for value in values {
                    Self::validate_json_value(value, depth + 1, nodes)?;
                }
                Ok(())
            }
            serde_json::Value::Object(values) => {
                if values.len() > MAX_ITEM_FIELDS || values.keys().any(|key| key.len() > 256) {
                    return Err(OnePasswordError::bad_request(
                        "Patch object exceeds the configured safety limit",
                    ));
                }
                for value in values.values() {
                    Self::validate_json_value(value, depth + 1, nodes)?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn validate_token_bytes(token: &[u8]) -> Result<(), OnePasswordError> {
        if token.len() < 16
            || token.len() > MAX_TOKEN_BYTES
            || !token
                .iter()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(*byte, b'.' | b'-' | b'_'))
        {
            return Err(OnePasswordError::token_invalid());
        }
        Ok(())
    }

    fn ensure_collection_limit(
        length: usize,
        limit: usize,
        kind: &str,
    ) -> Result<(), OnePasswordError> {
        if length > limit {
            return Err(OnePasswordError::server_error(format!(
                "Connect server returned too many {}",
                kind
            )));
        }
        Ok(())
    }

    // ── Vault endpoints ─────────────────────────────────────────────

    /// GET /v1/vaults — List all vaults
    pub async fn list_vaults(&self, filter: Option<&str>) -> Result<Vec<Vault>, OnePasswordError> {
        let mut req = self.auth(self.client.get(self.url("/vaults")));
        if let Some(f) = filter {
            Self::validate_filter(f)?;
            req = req.query(&[("filter", f)]);
        }
        let vaults: Vec<Vault> = self.execute(req).await?;
        Self::ensure_collection_limit(vaults.len(), MAX_VAULTS, "vaults")?;
        Ok(vaults)
    }

    /// GET /v1/vaults/{vaultUuid} — Get vault details
    pub async fn get_vault(&self, vault_id: &str) -> Result<Vault, OnePasswordError> {
        Self::validate_identifier(vault_id, "Vault identifier")?;
        let req = self.auth(self.client.get(self.url(&format!("/vaults/{}", vault_id))));
        self.execute(req).await
    }

    // ── Item endpoints ──────────────────────────────────────────────

    /// GET /v1/vaults/{vaultUuid}/items — List items in a vault
    pub async fn list_items(
        &self,
        vault_id: &str,
        filter: Option<&str>,
    ) -> Result<Vec<Item>, OnePasswordError> {
        Self::validate_identifier(vault_id, "Vault identifier")?;
        let mut req = self.auth(
            self.client
                .get(self.url(&format!("/vaults/{}/items", vault_id))),
        );
        if let Some(f) = filter {
            Self::validate_filter(f)?;
            req = req.query(&[("filter", f)]);
        }
        let items: Vec<Item> = self.execute(req).await?;
        Self::ensure_collection_limit(items.len(), MAX_ITEMS_PER_VAULT, "items")?;
        Ok(items)
    }

    /// GET /v1/vaults/{vaultUuid}/items/{itemUuid} — Get item details
    pub async fn get_item(
        &self,
        vault_id: &str,
        item_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
        Self::validate_identifier(vault_id, "Vault identifier")?;
        Self::validate_identifier(item_id, "Item identifier")?;
        let req = self.auth(
            self.client
                .get(self.url(&format!("/vaults/{}/items/{}", vault_id, item_id))),
        );
        self.execute(req).await
    }

    /// POST /v1/vaults/{vaultUuid}/items — Create a new item
    pub async fn create_item(
        &self,
        vault_id: &str,
        item: &FullItem,
    ) -> Result<FullItem, OnePasswordError> {
        Self::validate_identifier(vault_id, "Vault identifier")?;
        self.validate_full_item(item)?;
        let req = self.auth(
            self.client
                .post(self.url(&format!("/vaults/{}/items", vault_id))),
        );
        let req = self.json_body(req, item)?;
        self.execute(req).await
    }

    /// PUT /v1/vaults/{vaultUuid}/items/{itemUuid} — Replace an item
    pub async fn update_item(
        &self,
        vault_id: &str,
        item_id: &str,
        item: &FullItem,
    ) -> Result<FullItem, OnePasswordError> {
        Self::validate_identifier(vault_id, "Vault identifier")?;
        Self::validate_identifier(item_id, "Item identifier")?;
        self.validate_full_item(item)?;
        let req = self.auth(
            self.client
                .put(self.url(&format!("/vaults/{}/items/{}", vault_id, item_id))),
        );
        let req = self.json_body(req, item)?;
        self.execute(req).await
    }

    /// PATCH /v1/vaults/{vaultUuid}/items/{itemUuid} — Partial update
    pub async fn patch_item(
        &self,
        vault_id: &str,
        item_id: &str,
        ops: &[PatchOperation],
    ) -> Result<FullItem, OnePasswordError> {
        Self::validate_identifier(vault_id, "Vault identifier")?;
        Self::validate_identifier(item_id, "Item identifier")?;
        if ops.is_empty()
            || ops.len() > 128
            || ops.iter().any(|op| {
                op.path.is_empty()
                    || op.path.len() > 256
                    || !op.path.starts_with('/')
                    || op.path.chars().any(char::is_control)
            })
        {
            return Err(OnePasswordError::bad_request(
                "Item patch operations are invalid or too large",
            ));
        }
        let mut nodes = 0usize;
        for value in ops.iter().filter_map(|op| op.value.as_ref()) {
            Self::validate_json_value(value, 0, &mut nodes)?;
        }
        let req = self.auth(
            self.client
                .patch(self.url(&format!("/vaults/{}/items/{}", vault_id, item_id))),
        );
        let req = self.json_body(req, ops)?;
        self.execute(req).await
    }

    /// DELETE /v1/vaults/{vaultUuid}/items/{itemUuid} — Delete an item
    pub async fn delete_item(&self, vault_id: &str, item_id: &str) -> Result<(), OnePasswordError> {
        Self::validate_identifier(vault_id, "Vault identifier")?;
        Self::validate_identifier(item_id, "Item identifier")?;
        let req = self.auth(
            self.client
                .delete(self.url(&format!("/vaults/{}/items/{}", vault_id, item_id))),
        );
        self.execute_no_body(req).await
    }

    // ── File endpoints ──────────────────────────────────────────────

    /// GET /v1/vaults/{vaultUuid}/items/{itemUuid}/files
    pub async fn list_files(
        &self,
        vault_id: &str,
        item_id: &str,
        inline: bool,
    ) -> Result<Vec<FileAttachment>, OnePasswordError> {
        Self::validate_identifier(vault_id, "Vault identifier")?;
        Self::validate_identifier(item_id, "Item identifier")?;
        let mut req = self.auth(
            self.client
                .get(self.url(&format!("/vaults/{}/items/{}/files", vault_id, item_id))),
        );
        if inline {
            req = req.query(&[("inline_files", "true")]);
        }
        let files: Vec<FileAttachment> = self.execute(req).await?;
        Self::ensure_collection_limit(files.len(), MAX_FILES_PER_ITEM, "files")?;
        Ok(files)
    }

    /// GET /v1/vaults/{vaultUuid}/items/{itemUuid}/files/{fileUuid}
    pub async fn get_file(
        &self,
        vault_id: &str,
        item_id: &str,
        file_id: &str,
        inline: bool,
    ) -> Result<FileAttachment, OnePasswordError> {
        Self::validate_identifier(vault_id, "Vault identifier")?;
        Self::validate_identifier(item_id, "Item identifier")?;
        Self::validate_identifier(file_id, "File identifier")?;
        let mut req = self.auth(self.client.get(self.url(&format!(
            "/vaults/{}/items/{}/files/{}",
            vault_id, item_id, file_id
        ))));
        if inline {
            req = req.query(&[("inline_files", "true")]);
        }
        let file: FileAttachment = self.execute(req).await?;
        if inline
            && file
                .content
                .as_ref()
                .is_some_and(|content| content.len() > self.max_inline_bytes.saturating_mul(2))
        {
            return Err(OnePasswordError::file_too_large(file_id));
        }
        Ok(file)
    }

    /// GET /v1/vaults/{vaultUuid}/items/{itemUuid}/files/{fileUuid}/content
    pub async fn download_file(
        &self,
        vault_id: &str,
        item_id: &str,
        file_id: &str,
    ) -> Result<Vec<u8>, OnePasswordError> {
        Self::validate_identifier(vault_id, "Vault identifier")?;
        Self::validate_identifier(item_id, "Item identifier")?;
        Self::validate_identifier(file_id, "File identifier")?;
        let req = self.auth(self.client.get(self.url(&format!(
            "/vaults/{}/items/{}/files/{}/content",
            vault_id, item_id, file_id
        ))));
        self.execute_bytes(req).await
    }

    // ── Health endpoints ────────────────────────────────────────────

    /// GET /heartbeat — Ping for liveness
    pub async fn heartbeat(&self) -> Result<bool, OnePasswordError> {
        let url = format!("{}/heartbeat", self.base_url);
        let req = self.client.get(url);
        let resp = req
            .timeout(self.timeout)
            .send()
            .await
            .map_err(OnePasswordError::from)?;
        Ok(resp.status().is_success())
    }

    /// GET /health — Get server health and dependencies
    pub async fn health(&self) -> Result<ServerHealth, OnePasswordError> {
        let url = format!("{}/health", self.base_url);
        let req = self.client.get(url);
        self.execute(req).await
    }

    // ── Activity endpoint ───────────────────────────────────────────

    /// GET /v1/activity — List recent API requests
    pub async fn get_activity(
        &self,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<ApiRequest>, OnePasswordError> {
        if limit.is_some_and(|value| value as usize > MAX_ACTIVITY_RECORDS)
            || offset.is_some_and(|value| value > 1_000_000)
        {
            return Err(OnePasswordError::bad_request(
                "Activity pagination is outside the supported range",
            ));
        }
        let mut req = self.auth(self.client.get(self.url("/activity")));
        if let Some(l) = limit {
            req = req.query(&[("limit", l.to_string())]);
        }
        if let Some(o) = offset {
            req = req.query(&[("offset", o.to_string())]);
        }
        let activity: Vec<ApiRequest> = self.execute(req).await?;
        Self::ensure_collection_limit(activity.len(), MAX_ACTIVITY_RECORDS, "activity records")?;
        Ok(activity)
    }

    // ── Accessors ───────────────────────────────────────────────────

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn set_token(&mut self, token: &str) -> Result<(), OnePasswordError> {
        Self::validate_token_bytes(token.as_bytes())?;
        let mut replacement = Vec::with_capacity(7 + token.len());
        replacement.extend_from_slice(b"Bearer ");
        replacement.extend_from_slice(token.as_bytes());
        self.auth_header.fill(0);
        self.auth_header = replacement;
        Ok(())
    }

    pub fn has_token(&self) -> bool {
        self.auth_header.len() > 7
    }
}

impl Drop for OnePasswordApiClient {
    fn drop(&mut self) {
        self.auth_header.fill(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_builder() {
        let client =
            OnePasswordApiClient::new("http://localhost:8080", "test-token-123456", 30).unwrap();
        assert_eq!(client.url("/vaults"), "http://localhost:8080/v1/vaults");
        assert_eq!(
            client.url("/vaults/abc123/items"),
            "http://localhost:8080/v1/vaults/abc123/items"
        );
    }

    #[test]
    fn test_trailing_slash_stripped() {
        let client =
            OnePasswordApiClient::new("http://localhost:8080/", "test-token-123456", 30).unwrap();
        assert_eq!(client.url("/vaults"), "http://localhost:8080/v1/vaults");
    }

    #[test]
    fn test_missing_token_error() {
        let config = OnePasswordConfig {
            connect_host: "http://localhost:8080".into(),
            connect_token: "".into(),
            ..Default::default()
        };
        assert!(OnePasswordApiClient::from_config(&config).is_err());
    }

    #[test]
    fn test_missing_host_error() {
        let config = OnePasswordConfig {
            connect_host: "".into(),
            connect_token: "test-token-123456".into(),
            ..Default::default()
        };
        assert!(OnePasswordApiClient::from_config(&config).is_err());
    }
}
