// ─── LXD / Incus – REST API client ──────────────────────────────────────────
//!
//! Thin HTTP client wrapping the LXD REST API.
//! Supports mutual-TLS (client cert + key), trust password, and OIDC token authentication.
//! All requests target `/1.0` endpoints. Project scoping is handled via `?project=` query param.

use crate::types::*;
use log::{debug, warn};
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

pub struct LxdClient {
    pub http: HttpClient,
    pub config: LxdConnectionConfig,
}

impl LxdClient {
    pub fn new(config: LxdConnectionConfig) -> LxdResult<Self> {
        let mut builder = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .danger_accept_invalid_certs(config.skip_tls_verify);

        // mTLS identity
        if let (Some(cert_pem), Some(key_pem)) =
            (&config.client_cert_pem, &config.client_key_pem)
        {
            let combined = format!("{}\n{}", cert_pem, key_pem);
            let ident = reqwest::Identity::from_pem(combined.as_bytes())
                .map_err(|e| LxdError::auth(format!("invalid client cert/key: {e}")))?;
            builder = builder.identity(ident);
        }

        let http = builder
            .build()
            .map_err(|e| LxdError::connection(format!("http client build error: {e}")))?;

        Ok(Self { http, config })
    }

    // ─── URL helpers ─────────────────────────────────────────────────────

    fn base_url(&self) -> &str {
        self.config.url.trim_end_matches('/')
    }

    fn api_url(&self, path: &str) -> String {
        format!("{}/1.0{}", self.base_url(), path)
    }

    fn project_param(&self) -> String {
        if self.config.project == "default" {
            String::new()
        } else {
            format!("?project={}", self.config.project)
        }
    }

    fn url_with_project(&self, path: &str) -> String {
        let base = self.api_url(path);
        let proj = self.project_param();
        if proj.is_empty() {
            base
        } else if base.contains('?') {
            format!("{}&project={}", base, self.config.project)
        } else {
            format!("{}{}", base, proj)
        }
    }

    // ─── Auth header ─────────────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(ref token) = self.config.oidc_token {
            req.header("Authorization", format!("Bearer {token}"))
        } else {
            req
        }
    }

    // ─── Typed REST helpers ──────────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> LxdResult<T> {
        let url = self.url_with_project(path);
        debug!("LXD GET {url}");

        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| LxdError::connection(format!("GET {url}: {e}")))?;

        self.handle_sync_response(resp).await
    }

    pub async fn get_raw(&self, path: &str) -> LxdResult<String> {
        let url = self.url_with_project(path);
        debug!("LXD GET (raw) {url}");

        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| LxdError::connection(format!("GET {url}: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.text()
            .await
            .map_err(|e| LxdError::api(format!("read body: {e}")))
    }

    pub async fn list_names(&self, path: &str) -> LxdResult<Vec<String>> {
        let url = self.url_with_project(path);
        debug!("LXD LIST names {url}");

        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| LxdError::connection(format!("LIST {url}: {e}")))?;

        let sync: LxdSyncResponse<Vec<String>> = self.parse_response(resp).await?;
        // LXD returns full URL paths; extract the name (last segment)
        Ok(sync
            .metadata
            .into_iter()
            .map(|u| {
                u.rsplit('/')
                    .next()
                    .unwrap_or(&u)
                    .to_string()
            })
            .collect())
    }

    pub async fn list_recursion<T: DeserializeOwned>(&self, path: &str) -> LxdResult<Vec<T>> {
        let url = {
            let base = self.url_with_project(path);
            if base.contains('?') {
                format!("{base}&recursion=1")
            } else {
                format!("{base}?recursion=1")
            }
        };
        debug!("LXD LIST recursion=1 {url}");

        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| LxdError::connection(format!("LIST {url}: {e}")))?;

        let sync: LxdSyncResponse<Vec<T>> = self.parse_response(resp).await?;
        Ok(sync.metadata)
    }

    pub async fn post_sync<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> LxdResult<T> {
        let url = self.url_with_project(path);
        debug!("LXD POST (sync) {url}");

        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| LxdError::connection(format!("POST {url}: {e}")))?;

        self.handle_sync_response(resp).await
    }

    pub async fn post_async<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> LxdResult<LxdOperation> {
        let url = self.url_with_project(path);
        debug!("LXD POST (async) {url}");

        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| LxdError::connection(format!("POST {url}: {e}")))?;

        self.handle_async_response(resp).await
    }

    pub async fn put<B: Serialize>(&self, path: &str, body: &B) -> LxdResult<()> {
        let url = self.url_with_project(path);
        debug!("LXD PUT {url}");

        let resp = self
            .apply_auth(self.http.put(&url).json(body))
            .send()
            .await
            .map_err(|e| LxdError::connection(format!("PUT {url}: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn patch<B: Serialize>(&self, path: &str, body: &B) -> LxdResult<()> {
        let url = self.url_with_project(path);
        debug!("LXD PATCH {url}");

        let resp = self
            .apply_auth(self.http.patch(&url).json(body))
            .send()
            .await
            .map_err(|e| LxdError::connection(format!("PATCH {url}: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn delete(&self, path: &str) -> LxdResult<()> {
        let url = self.url_with_project(path);
        debug!("LXD DELETE {url}");

        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| LxdError::connection(format!("DELETE {url}: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn delete_async(&self, path: &str) -> LxdResult<LxdOperation> {
        let url = self.url_with_project(path);
        debug!("LXD DELETE (async) {url}");

        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| LxdError::connection(format!("DELETE {url}: {e}")))?;

        self.handle_async_response(resp).await
    }

    // ─── Wait for operation ──────────────────────────────────────────────

    pub async fn wait_operation(
        &self,
        operation_id: &str,
        timeout: Option<u64>,
    ) -> LxdResult<LxdOperation> {
        let t = timeout.unwrap_or(60);
        let url = format!(
            "{}/1.0/operations/{}?timeout={}",
            self.base_url(),
            operation_id.trim_start_matches('/'),
            t
        );
        debug!("LXD wait operation {url}");

        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| LxdError::connection(format!("wait op: {e}")))?;

        self.handle_sync_response(resp).await
    }

    // ─── Response handling ───────────────────────────────────────────────

    async fn parse_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> LxdResult<T> {
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json()
            .await
            .map_err(|e| LxdError::api(format!("json parse error: {e}")))
    }

    async fn handle_sync_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> LxdResult<T> {
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| LxdError::api(format!("read body: {e}")))?;

        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }

        // Try parsing as sync response
        if let Ok(sync) = serde_json::from_str::<LxdSyncResponse<T>>(&body_text) {
            return Ok(sync.metadata);
        }
        // Fallback: direct parse
        serde_json::from_str(&body_text)
            .map_err(|e| LxdError::api(format!("parse sync response: {e}\nBody: {body_text}")))
    }

    async fn handle_async_response(
        &self,
        resp: reqwest::Response,
    ) -> LxdResult<LxdOperation> {
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| LxdError::api(format!("read body: {e}")))?;

        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }

        let async_resp: LxdAsyncResponse = serde_json::from_str(&body_text)
            .map_err(|e| LxdError::api(format!("parse async response: {e}")))?;

        if let Some(op) = async_resp.metadata {
            Ok(op)
        } else {
            // Build a minimal operation from the response
            Ok(LxdOperation {
                id: Some(async_resp.operation),
                status: Some(async_resp.status),
                status_code: Some(async_resp.status_code as i32),
                ..Default::default()
            })
        }
    }

    fn map_status_error(&self, status: u16, body: &str) -> LxdError {
        // Try parsing the LXD error response
        let msg = serde_json::from_str::<LxdErrorResponse>(body)
            .map(|e| e.error)
            .unwrap_or_else(|_| body.to_string());

        let kind = match status {
            401 | 403 => LxdErrorKind::Auth,
            404 => LxdErrorKind::NotFound,
            409 => LxdErrorKind::Conflict,
            429 => LxdErrorKind::Throttled,
            503 => LxdErrorKind::ServiceUnavailable,
            _ => LxdErrorKind::Api,
        };

        LxdError {
            kind,
            message: msg,
            status_code: Some(status),
            code: None,
        }
    }
}
