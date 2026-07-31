// ── sorng-consul – REST API client ───────────────────────────────────────────
//! HTTP client wrapping the Consul HTTP API (default: http://localhost:8500).

use crate::error::{ConsulError, ConsulErrorKind, ConsulResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;

const MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;

async fn read_bounded_response(mut response: reqwest::Response) -> ConsulResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
    {
        return Err(ConsulError::parse(
            "Consul response body exceeds the 8 MiB safety limit".to_string(),
        ));
    }

    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        ConsulError::parse("Failed to read Consul response body".to_string())
    })? {
        let remaining_probe = MAX_RESPONSE_BODY_BYTES + 1 - body.len();
        let take = chunk.len().min(remaining_probe);
        body.try_reserve(take).map_err(|_| {
            ConsulError::parse("Unable to buffer Consul response body".to_string())
        })?;
        body.extend_from_slice(&chunk[..take]);

        if body.len() > MAX_RESPONSE_BODY_BYTES {
            return Err(ConsulError::parse(
                "Consul response body exceeds the 8 MiB safety limit".to_string(),
            ));
        }
    }

    Ok(body)
}

async fn read_bounded_text(response: reqwest::Response) -> ConsulResult<String> {
    String::from_utf8(read_bounded_response(response).await?).map_err(|_| {
        ConsulError::parse("Consul response body is not valid UTF-8".to_string())
    })
}

pub struct ConsulClient {
    pub config: ConsulConnectionConfig,
    http: HttpClient,
}

impl ConsulClient {
    pub fn new(config: ConsulConnectionConfig) -> ConsulResult<Self> {
        if config.tls_skip_verify.unwrap_or(false) {
            return Err(ConsulError::connection(
                "TLS certificate verification cannot be disabled: tls_skip_verify=true requires an explicit runtime acknowledgement contract",
            ));
        }
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| ConsulError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── URL helpers ──────────────────────────────────────────────────

    fn base_url(&self) -> &str {
        self.config.address.trim_end_matches('/')
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url(), path)
    }

    fn url_with_params(&self, path: &str, params: &[(&str, &str)]) -> String {
        let base = self.url(path);
        let mut parts: Vec<String> = Vec::new();
        if let Some(ref dc) = self.config.datacenter {
            parts.push(format!("dc={}", urlencoding(dc)));
        }
        if let Some(ref ns) = self.config.namespace {
            parts.push(format!("ns={}", urlencoding(ns)));
        }
        if let Some(ref partition) = self.config.partition {
            parts.push(format!("partition={}", urlencoding(partition)));
        }
        for (k, v) in params {
            parts.push(format!("{}={}", k, urlencoding(v)));
        }
        if parts.is_empty() {
            base
        } else {
            format!("{}?{}", base, parts.join("&"))
        }
    }

    // ── Auth ─────────────────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(ref token) = self.config.token {
            req.header("X-Consul-Token", token.as_str())
        } else {
            req
        }
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> ConsulResult<T> {
        let url = self.url_with_params(path, &[]);
        debug!("Consul GET request");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        self.handle_response(resp).await
    }

    pub async fn get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> ConsulResult<T> {
        let url = self.url_with_params(path, params);
        debug!("Consul GET request");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        self.handle_response(resp).await
    }

    pub async fn get_optional<T: DeserializeOwned>(&self, path: &str) -> ConsulResult<Option<T>> {
        let url = self.url_with_params(path, &[]);
        debug!("Consul request");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        if resp.status().as_u16() == 404 {
            return Ok(None);
        }
        let val: T = self.handle_response(resp).await?;
        Ok(Some(val))
    }

    pub async fn get_raw(&self, path: &str) -> ConsulResult<String> {
        let url = self.url_with_params(path, &[]);
        debug!("Consul request");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        let status = resp.status();
        if !status.is_success() {
            let body = read_bounded_text(resp).await?;
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        read_bounded_text(resp).await
            .map_err(|e| ConsulError::parse(format!("body: {e}")))
    }

    pub async fn put_body<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> ConsulResult<T> {
        let url = self.url_with_params(path, &[]);
        debug!("Consul PUT request");
        let resp = self
            .apply_auth(self.http.put(&url).json(body))
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        self.handle_response(resp).await
    }

    pub async fn put_raw(&self, path: &str, body: &str) -> ConsulResult<bool> {
        let url = self.url_with_params(path, &[]);
        debug!("Consul request");
        let resp = self
            .apply_auth(
                self.http
                    .put(&url)
                    .header("Content-Type", "application/octet-stream")
                    .body(body.to_string()),
            )
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        let status = resp.status();
        if !status.is_success() {
            let body = read_bounded_text(resp).await?;
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        let text = read_bounded_text(resp).await?;
        Ok(text.trim() == "true")
    }

    pub async fn put_raw_with_params(
        &self,
        path: &str,
        body: &str,
        params: &[(&str, &str)],
    ) -> ConsulResult<bool> {
        let url = self.url_with_params(path, params);
        debug!("Consul request");
        let resp = self
            .apply_auth(
                self.http
                    .put(&url)
                    .header("Content-Type", "application/octet-stream")
                    .body(body.to_string()),
            )
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        let status = resp.status();
        if !status.is_success() {
            let body = read_bounded_text(resp).await?;
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        let text = read_bounded_text(resp).await?;
        Ok(text.trim() == "true")
    }

    pub async fn put_no_body(&self, path: &str) -> ConsulResult<()> {
        let url = self.url_with_params(path, &[]);
        debug!("Consul request");
        let resp = self
            .apply_auth(self.http.put(&url))
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        let status = resp.status();
        if !status.is_success() {
            let body = read_bounded_text(resp).await?;
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn put_json_no_response<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> ConsulResult<()> {
        let url = self.url_with_params(path, &[]);
        debug!("Consul request");
        let resp = self
            .apply_auth(self.http.put(&url).json(body))
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        let status = resp.status();
        if !status.is_success() {
            let body = read_bounded_text(resp).await?;
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> ConsulResult<T> {
        let url = self.url_with_params(path, &[]);
        debug!("Consul POST request");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        self.handle_response(resp).await
    }

    pub async fn post_no_body<T: DeserializeOwned>(&self, path: &str) -> ConsulResult<T> {
        let url = self.url_with_params(path, &[]);
        debug!("Consul request");
        let resp = self
            .apply_auth(self.http.post(&url))
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        self.handle_response(resp).await
    }

    pub async fn post_with_params<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
        params: &[(&str, &str)],
    ) -> ConsulResult<T> {
        let url = self.url_with_params(path, params);
        debug!("Consul POST request");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        self.handle_response(resp).await
    }

    pub async fn delete(&self, path: &str) -> ConsulResult<()> {
        let url = self.url_with_params(path, &[]);
        debug!("Consul DELETE request");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        let status = resp.status();
        if !status.is_success() {
            let body = read_bounded_text(resp).await?;
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn delete_bool(&self, path: &str) -> ConsulResult<bool> {
        let url = self.url_with_params(path, &[]);
        debug!("Consul DELETE request");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|_| ConsulError::connection("Consul request failed"))?;
        let status = resp.status();
        if !status.is_success() {
            let body = read_bounded_text(resp).await?;
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        let text = read_bounded_text(resp).await?;
        Ok(text.trim() == "true")
    }

    // ── Response handling ────────────────────────────────────────────

    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> ConsulResult<T> {
        let status = resp.status();
        if !status.is_success() {
            let body = read_bounded_text(resp).await?;
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        let text = read_bounded_text(resp).await
            .map_err(|e| ConsulError::parse(format!("reading body: {e}")))?;
        serde_json::from_str(&text).map_err(|e| {
            ConsulError::parse(format!("JSON parse: {e} — body: {}", truncate(&text, 200)))
        })
    }

    fn map_status_error(&self, status: u16, body: &str) -> ConsulError {
        match status {
            401 => ConsulError::auth(format!("Unauthorized (401): {}", truncate("", 0))),
            403 => ConsulError::forbidden(format!("Forbidden (403): {}", truncate("", 0))),
            404 => ConsulError::not_found(format!("Not found (404): {}", truncate("", 0))),
            409 => ConsulError::new(
                ConsulErrorKind::ApiError,
                format!("Conflict (409): {}", truncate("", 0)),
            ),
            500 => ConsulError::new(
                ConsulErrorKind::InternalError,
                format!("Server error (500): {}", truncate("", 0)),
            ),
            _ => ConsulError::api(format!("HTTP {status}: {}", truncate("", 0))),
        }
    }

    // ── Consul-specific endpoints ────────────────────────────────────

    /// GET /v1/agent/self — used to verify the connection.
    pub async fn ping(&self) -> ConsulResult<ConsulConnectionSummary> {
        let info: ConsulAgentInfo = self.get("/v1/agent/self").await?;
        let members: Vec<AgentMember> = self.get("/v1/agent/members").await?;
        let leader: String = self.get("/v1/status/leader").await?;

        let node_name = info
            .member
            .as_ref()
            .map(|m| m.name.clone())
            .unwrap_or_else(|| "unknown".into());
        let dc = info
            .config
            .as_ref()
            .and_then(|c| c.get("Datacenter"))
            .and_then(|v| v.as_str())
            .unwrap_or("dc1")
            .to_string();
        let version = info
            .config
            .as_ref()
            .and_then(|c| c.get("Version"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        Ok(ConsulConnectionSummary {
            address: self.config.address.clone(),
            datacenter: dc,
            node_name,
            version,
            leader,
            member_count: members.len(),
        })
    }

    /// GET /v1/catalog/services — list all services (name → tags).
    pub async fn catalog_services(&self) -> ConsulResult<HashMap<String, Vec<String>>> {
        self.get("/v1/catalog/services").await
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        &s[..max]
    }
}

fn urlencoding(s: &str) -> String {
    s.replace('%', "%25")
        .replace(' ', "%20")
        .replace('&', "%26")
        .replace('=', "%3D")
        .replace('+', "%2B")
        .replace('#', "%23")
}
