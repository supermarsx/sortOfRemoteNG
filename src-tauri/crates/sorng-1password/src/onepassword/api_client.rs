use reqwest::{Client, RequestBuilder, StatusCode};
use serde::de::DeserializeOwned;
use std::time::Duration;

use super::types::*;

/// Low-level HTTP client for the 1Password Connect Server REST API (v1).
///
/// Endpoints follow the schema at
/// <https://developer.1password.com/docs/connect/connect-api-reference/>.
///
/// All requests are authenticated via `Authorization: Bearer <token>`.
pub struct OnePasswordApiClient {
    client: Client,
    base_url: String,
    token: String,
    timeout: Duration,
}

impl OnePasswordApiClient {
    // ── Constructors ────────────────────────────────────────────────

    pub fn new(base_url: &str, token: &str, timeout_secs: u64) -> Result<Self, OnePasswordError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(timeout_secs))
            .build()
            .map_err(|e| OnePasswordError::connection_error(format!("Failed to create HTTP client: {}", e)))?;

        let base = base_url.trim_end_matches('/').to_string();

        Ok(Self {
            client,
            base_url: base,
            token: token.to_string(),
            timeout: Duration::from_secs(timeout_secs),
        })
    }

    pub fn from_config(config: &OnePasswordConfig) -> Result<Self, OnePasswordError> {
        if config.connect_host.is_empty() {
            return Err(OnePasswordError::config_error("Connect host URL is required"));
        }
        if config.connect_token.is_empty() {
            return Err(OnePasswordError::config_error("Connect token is required"));
        }
        Self::new(&config.connect_host, &config.connect_token, config.timeout_secs)
    }

    // ── URL builder ─────────────────────────────────────────────────

    fn url(&self, path: &str) -> String {
        format!("{}/v1{}", self.base_url, path)
    }

    // ── Auth header injection ───────────────────────────────────────

    fn auth(&self, builder: RequestBuilder) -> RequestBuilder {
        builder.bearer_auth(&self.token)
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
            let body = resp.text().await.map_err(OnePasswordError::from)?;
            serde_json::from_str::<T>(&body).map_err(|e| {
                OnePasswordError::parse_error(format!("Failed to parse response: {} — body: {}", e, &body[..body.len().min(500)]))
            })
        } else {
            let code = status.as_u16();
            let body = resp.text().await.unwrap_or_default();
            let api_err: Option<ApiErrorResponse> = serde_json::from_str(&body).ok();
            let msg = api_err
                .map(|e| e.message)
                .unwrap_or_else(|| format!("HTTP {} — {}", code, body));

            Err(match status {
                StatusCode::UNAUTHORIZED => OnePasswordError::token_invalid().with_status(code),
                StatusCode::FORBIDDEN => OnePasswordError::forbidden(msg).with_status(code),
                StatusCode::NOT_FOUND => OnePasswordError::new(OnePasswordErrorKind::NotFound, msg).with_status(code),
                StatusCode::BAD_REQUEST => OnePasswordError::bad_request(msg).with_status(code),
                StatusCode::CONFLICT => OnePasswordError::new(OnePasswordErrorKind::Conflict, msg).with_status(code),
                StatusCode::TOO_MANY_REQUESTS => OnePasswordError::rate_limited().with_status(code),
                StatusCode::REQUEST_ENTITY_TOO_LARGE => OnePasswordError::new(OnePasswordErrorKind::FileTooLarge, msg).with_status(code),
                _ => OnePasswordError::server_error(msg).with_status(code),
            })
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
            let code = status.as_u16();
            let body = resp.text().await.unwrap_or_default();
            let api_err: Option<ApiErrorResponse> = serde_json::from_str(&body).ok();
            let msg = api_err
                .map(|e| e.message)
                .unwrap_or_else(|| format!("HTTP {} — {}", code, body));

            Err(match status {
                StatusCode::UNAUTHORIZED => OnePasswordError::token_invalid().with_status(code),
                StatusCode::FORBIDDEN => OnePasswordError::forbidden(msg).with_status(code),
                StatusCode::NOT_FOUND => OnePasswordError::new(OnePasswordErrorKind::NotFound, msg).with_status(code),
                _ => OnePasswordError::server_error(msg).with_status(code),
            })
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
            resp.bytes()
                .await
                .map(|b| b.to_vec())
                .map_err(|e| OnePasswordError::parse_error(format!("Failed to read bytes: {}", e)))
        } else {
            let code = status.as_u16();
            let body = resp.text().await.unwrap_or_default();
            Err(OnePasswordError::server_error(format!("HTTP {} — {}", code, body)).with_status(code))
        }
    }

    // ── Vault endpoints ─────────────────────────────────────────────

    /// GET /v1/vaults — List all vaults
    pub async fn list_vaults(&self, filter: Option<&str>) -> Result<Vec<Vault>, OnePasswordError> {
        let mut req = self.auth(self.client.get(self.url("/vaults")));
        if let Some(f) = filter {
            req = req.query(&[("filter", f)]);
        }
        self.execute(req).await
    }

    /// GET /v1/vaults/{vaultUuid} — Get vault details
    pub async fn get_vault(&self, vault_id: &str) -> Result<Vault, OnePasswordError> {
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
        let mut req = self.auth(
            self.client.get(self.url(&format!("/vaults/{}/items", vault_id))),
        );
        if let Some(f) = filter {
            req = req.query(&[("filter", f)]);
        }
        self.execute(req).await
    }

    /// GET /v1/vaults/{vaultUuid}/items/{itemUuid} — Get item details
    pub async fn get_item(
        &self,
        vault_id: &str,
        item_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
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
        let req = self
            .auth(
                self.client
                    .post(self.url(&format!("/vaults/{}/items", vault_id))),
            )
            .json(item);
        self.execute(req).await
    }

    /// PUT /v1/vaults/{vaultUuid}/items/{itemUuid} — Replace an item
    pub async fn update_item(
        &self,
        vault_id: &str,
        item_id: &str,
        item: &FullItem,
    ) -> Result<FullItem, OnePasswordError> {
        let req = self
            .auth(
                self.client
                    .put(self.url(&format!("/vaults/{}/items/{}", vault_id, item_id))),
            )
            .json(item);
        self.execute(req).await
    }

    /// PATCH /v1/vaults/{vaultUuid}/items/{itemUuid} — Partial update
    pub async fn patch_item(
        &self,
        vault_id: &str,
        item_id: &str,
        ops: &[PatchOperation],
    ) -> Result<FullItem, OnePasswordError> {
        let req = self
            .auth(
                self.client
                    .patch(self.url(&format!("/vaults/{}/items/{}", vault_id, item_id))),
            )
            .json(ops);
        self.execute(req).await
    }

    /// DELETE /v1/vaults/{vaultUuid}/items/{itemUuid} — Delete an item
    pub async fn delete_item(
        &self,
        vault_id: &str,
        item_id: &str,
    ) -> Result<(), OnePasswordError> {
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
        let mut req = self.auth(
            self.client
                .get(self.url(&format!("/vaults/{}/items/{}/files", vault_id, item_id))),
        );
        if inline {
            req = req.query(&[("inline_files", "true")]);
        }
        self.execute(req).await
    }

    /// GET /v1/vaults/{vaultUuid}/items/{itemUuid}/files/{fileUuid}
    pub async fn get_file(
        &self,
        vault_id: &str,
        item_id: &str,
        file_id: &str,
        inline: bool,
    ) -> Result<FileAttachment, OnePasswordError> {
        let mut req = self.auth(self.client.get(self.url(&format!(
            "/vaults/{}/items/{}/files/{}",
            vault_id, item_id, file_id
        ))));
        if inline {
            req = req.query(&[("inline_files", "true")]);
        }
        self.execute(req).await
    }

    /// GET /v1/vaults/{vaultUuid}/items/{itemUuid}/files/{fileUuid}/content
    pub async fn download_file(
        &self,
        vault_id: &str,
        item_id: &str,
        file_id: &str,
    ) -> Result<Vec<u8>, OnePasswordError> {
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
        let mut req = self.auth(self.client.get(self.url("/activity")));
        if let Some(l) = limit {
            req = req.query(&[("limit", l.to_string())]);
        }
        if let Some(o) = offset {
            req = req.query(&[("offset", o.to_string())]);
        }
        self.execute(req).await
    }

    // ── Accessors ───────────────────────────────────────────────────

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn set_token(&mut self, token: &str) {
        self.token = token.to_string();
    }

    pub fn has_token(&self) -> bool {
        !self.token.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_builder() {
        let client = OnePasswordApiClient::new("http://localhost:8080", "test-token", 30).unwrap();
        assert_eq!(client.url("/vaults"), "http://localhost:8080/v1/vaults");
        assert_eq!(
            client.url("/vaults/abc123/items"),
            "http://localhost:8080/v1/vaults/abc123/items"
        );
    }

    #[test]
    fn test_trailing_slash_stripped() {
        let client = OnePasswordApiClient::new("http://localhost:8080/", "test-token", 30).unwrap();
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
            connect_token: "token".into(),
            ..Default::default()
        };
        assert!(OnePasswordApiClient::from_config(&config).is_err());
    }
}
