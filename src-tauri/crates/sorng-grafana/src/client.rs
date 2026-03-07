// ── sorng-grafana – HTTP API client ──────────────────────────────────────────
//! Connects to a Grafana instance via its HTTP REST API.

use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use std::time::Duration;

/// Grafana HTTP API client.
pub struct GrafanaClient {
    pub config: GrafanaConnectionConfig,
    http: HttpClient,
}

impl GrafanaClient {
    pub fn new(config: GrafanaConnectionConfig) -> GrafanaResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(true)
            .build()
            .map_err(|e| GrafanaError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── URL helpers ──────────────────────────────────────────────────

    pub fn api_url(&self, path: &str) -> String {
        if let Some(ref base) = self.config.api_url {
            let base = base.trim_end_matches('/');
            let path = path.trim_start_matches('/');
            format!("{base}/{path}")
        } else {
            let scheme = if self.config.use_tls.unwrap_or(false) { "https" } else { "http" };
            let port = self.config.port.unwrap_or(3000);
            let path = path.trim_start_matches('/');
            format!("{scheme}://{}:{port}/{path}", self.config.host)
        }
    }

    fn auth_header(&self) -> Option<String> {
        if let Some(ref key) = self.config.api_key {
            Some(format!("Bearer {key}"))
        } else if let (Some(ref user), Some(ref pass)) = (&self.config.username, &self.config.password) {
            use reqwest::header::HeaderValue;
            let encoded = base64_encode(&format!("{user}:{pass}"));
            Some(format!("Basic {encoded}"))
        } else {
            None
        }
    }

    fn build_request(&self, method: reqwest::Method, url: &str) -> reqwest::RequestBuilder {
        let mut req = self.http.request(method, url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json");
        if let Some(auth) = self.auth_header() {
            req = req.header("Authorization", auth);
        }
        if let Some(org_id) = self.config.org_id {
            req = req.header("X-Grafana-Org-Id", org_id.to_string());
        }
        req
    }

    // ── HTTP verbs ───────────────────────────────────────────────────

    pub async fn api_get(&self, endpoint: &str) -> GrafanaResult<String> {
        let url = self.api_url(endpoint);
        debug!("GRAFANA GET {url}");
        let resp = self.build_request(reqwest::Method::GET, &url)
            .send().await
            .map_err(|e| GrafanaError::http(format!("GET {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn api_post(&self, endpoint: &str, body: &str) -> GrafanaResult<String> {
        let url = self.api_url(endpoint);
        debug!("GRAFANA POST {url}");
        let resp = self.build_request(reqwest::Method::POST, &url)
            .body(body.to_string())
            .send().await
            .map_err(|e| GrafanaError::http(format!("POST {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn api_put(&self, endpoint: &str, body: &str) -> GrafanaResult<String> {
        let url = self.api_url(endpoint);
        debug!("GRAFANA PUT {url}");
        let resp = self.build_request(reqwest::Method::PUT, &url)
            .body(body.to_string())
            .send().await
            .map_err(|e| GrafanaError::http(format!("PUT {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn api_delete(&self, endpoint: &str) -> GrafanaResult<String> {
        let url = self.api_url(endpoint);
        debug!("GRAFANA DELETE {url}");
        let resp = self.build_request(reqwest::Method::DELETE, &url)
            .send().await
            .map_err(|e| GrafanaError::http(format!("DELETE {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn api_patch(&self, endpoint: &str, body: &str) -> GrafanaResult<String> {
        let url = self.api_url(endpoint);
        debug!("GRAFANA PATCH {url}");
        let resp = self.build_request(reqwest::Method::PATCH, &url)
            .body(body.to_string())
            .send().await
            .map_err(|e| GrafanaError::http(format!("PATCH {url}: {e}")))?;
        self.handle_response(resp).await
    }

    // ── Response handling ────────────────────────────────────────────

    async fn handle_response(&self, resp: reqwest::Response) -> GrafanaResult<String> {
        let status = resp.status();
        let body = resp.text().await
            .map_err(|e| GrafanaError::http(format!("reading body: {e}")))?;

        if status.is_success() {
            return Ok(body);
        }

        match status.as_u16() {
            401 => Err(GrafanaError::auth(format!("Unauthorized: {body}"))),
            403 => Err(GrafanaError::forbidden(format!("Forbidden: {body}"))),
            404 => Err(GrafanaError::api(format!("Not found: {body}"))),
            408 => Err(GrafanaError::timeout(format!("Request timeout: {body}"))),
            _ => Err(GrafanaError::api(format!("HTTP {status}: {body}"))),
        }
    }

    // ── SSH (optional) ───────────────────────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> GrafanaResult<SshOutput> {
        let ssh_host = self.config.ssh_host.as_deref()
            .or(Some(&self.config.host))
            .unwrap();
        debug!("GRAFANA SSH [{}]: {}", ssh_host, command);
        Err(GrafanaError::ssh(format!(
            "SSH execution not connected to {ssh_host}. Command: {command}"
        )))
    }
}

fn base64_encode(input: &str) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = input.as_bytes();
    let mut result = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}
