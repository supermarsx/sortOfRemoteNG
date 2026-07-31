// ── sorng-prometheus/src/client.rs ───────────────────────────────────────────
//! HTTP client for Prometheus API v1.

use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use std::time::Duration;

pub(crate) const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_METADATA_RESPONSE_BYTES: usize = 1024 * 1024;

pub struct PrometheusClient {
    pub config: PrometheusConnectionConfig,
    http: HttpClient,
}

impl PrometheusClient {
    pub fn new(config: PrometheusConnectionConfig) -> PrometheusResult<Self> {
        let accept_invalid =
            config.use_tls.unwrap_or(true) && config.accept_invalid_certs.unwrap_or(false);
        if accept_invalid != config.acknowledge_invalid_cert_risk.unwrap_or(false) {
            return Err(PrometheusError::config_error(
                "disabling TLS certificate validation requires a runtime acknowledgement for this connection attempt",
            ));
        }
        let mut builder = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(accept_invalid);
        if let Some(proxy_url) = config
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|e| PrometheusError::connection(format!("invalid proxy URL: {e}")))?;
            builder = builder.proxy(proxy);
        }
        let http = builder
            .build()
            .map_err(|e| PrometheusError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── URL builders ─────────────────────────────────────────────────

    fn scheme(&self) -> &str {
        if self.config.use_tls.unwrap_or(false) {
            "https"
        } else {
            "http"
        }
    }

    fn base_url(&self) -> String {
        let port = self.config.port.unwrap_or(9090);
        format!("{}://{}:{}", self.scheme(), self.config.host, port)
    }

    fn api_url(&self, path: &str) -> String {
        format!("{}/api/v1/{}", self.base_url(), path)
    }

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(ref token) = self.config.bearer_token {
            return req.bearer_auth(token);
        }
        if let (Some(ref user), Some(ref pass)) = (&self.config.username, &self.config.password) {
            return req.basic_auth(user, Some(pass));
        }
        req
    }

    // ── Generic helpers ──────────────────────────────────────────────

    fn map_status_error(&self, status: u16) -> PrometheusError {
        match status {
            401 => PrometheusError::auth("Authentication failed (HTTP 401)"),
            403 => PrometheusError::auth("Access denied (HTTP 403)"),
            404 => PrometheusError::api("Not found (HTTP 404)"),
            422 => PrometheusError::invalid_query("Unprocessable entity (HTTP 422)"),
            503 => PrometheusError::api("Service unavailable (HTTP 503)"),
            _ => PrometheusError::http(format!("HTTP {status}")),
        }
    }

    fn response_limit(path: &str) -> usize {
        if path.starts_with("status/") {
            MAX_METADATA_RESPONSE_BYTES
        } else {
            MAX_RESPONSE_BYTES
        }
    }

    /// GET request to API v1, parsing the `data` field from the standard
    /// `{ "status":"success", "data": ... }` envelope.
    pub async fn api_get<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> PrometheusResult<T> {
        let url = self.api_url(path);
        debug!("PROMETHEUS GET {url}");
        let resp = self
            .apply_auth(self.http.get(&url).query(params))
            .send()
            .await
            .map_err(|e| PrometheusError::http(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        let envelope: serde_json::Value =
            read_response_json_limited(resp, Self::response_limit(path), "Prometheus GET").await?;
        let data = envelope.get("data").cloned().unwrap_or(envelope);
        serde_json::from_value(data)
            .map_err(|e| PrometheusError::parse(format!("GET {url} parse data: {e}")))
    }

    /// GET that returns the full raw JSON envelope.
    pub async fn api_get_raw(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> PrometheusResult<serde_json::Value> {
        let url = self.api_url(path);
        debug!("PROMETHEUS GET RAW {url}");
        let resp = self
            .apply_auth(self.http.get(&url).query(params))
            .send()
            .await
            .map_err(|e| PrometheusError::http(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        read_response_json_limited(resp, Self::response_limit(path), "Prometheus raw GET").await
    }

    /// GET that returns the response body as raw text.
    pub async fn api_get_text(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> PrometheusResult<String> {
        let url = self.api_url(path);
        debug!("PROMETHEUS GET TEXT {url}");
        let resp = self
            .apply_auth(self.http.get(&url).query(params))
            .send()
            .await
            .map_err(|e| PrometheusError::http(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        read_response_text_limited(resp, Self::response_limit(path), "Prometheus text GET").await
    }

    /// POST with form-encoded body, parsing the `data` field from the envelope.
    pub async fn api_post<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> PrometheusResult<T> {
        let url = self.api_url(path);
        debug!("PROMETHEUS POST {url}");
        let resp = self
            .apply_auth(self.http.post(&url).form(params))
            .send()
            .await
            .map_err(|e| PrometheusError::http(format!("POST {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        let envelope: serde_json::Value =
            read_response_json_limited(resp, MAX_RESPONSE_BYTES, "Prometheus POST").await?;
        let data = envelope.get("data").cloned().unwrap_or(envelope);
        serde_json::from_value(data)
            .map_err(|e| PrometheusError::parse(format!("POST {url} parse data: {e}")))
    }

    /// POST with JSON body, returning parsed data from envelope.
    pub async fn api_post_json<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> PrometheusResult<T> {
        let url = self.api_url(path);
        debug!("PROMETHEUS POST JSON {url}");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| PrometheusError::http(format!("POST JSON {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        let envelope: serde_json::Value =
            read_response_json_limited(resp, MAX_RESPONSE_BYTES, "Prometheus JSON POST").await?;
        let data = envelope.get("data").cloned().unwrap_or(envelope);
        serde_json::from_value(data)
            .map_err(|e| PrometheusError::parse(format!("POST JSON {url} parse: {e}")))
    }

    /// POST that returns nothing on success.
    pub async fn api_post_empty(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> PrometheusResult<()> {
        let url = self.api_url(path);
        debug!("PROMETHEUS POST EMPTY {url}");
        let resp = self
            .apply_auth(self.http.post(&url).form(params))
            .send()
            .await
            .map_err(|e| PrometheusError::http(format!("POST {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Ok(())
    }

    /// DELETE request.
    pub async fn api_delete(&self, path: &str) -> PrometheusResult<()> {
        let url = self.api_url(path);
        debug!("PROMETHEUS DELETE {url}");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| PrometheusError::http(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Ok(())
    }

    // ── Full-URL helpers (for Alertmanager endpoints) ────────────

    /// GET a full URL (not prefixed with /api/v1/).
    pub async fn get_url_json<T: DeserializeOwned>(&self, url: &str) -> PrometheusResult<T> {
        debug!("PROMETHEUS GET {url}");
        let resp = self
            .apply_auth(self.http.get(url))
            .send()
            .await
            .map_err(|e| PrometheusError::http(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        read_response_json_limited(resp, MAX_RESPONSE_BYTES, "Prometheus full-URL GET").await
    }

    /// POST JSON to a full URL.
    pub async fn post_url_json<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        url: &str,
        body: &B,
    ) -> PrometheusResult<T> {
        debug!("PROMETHEUS POST {url}");
        let resp = self
            .apply_auth(self.http.post(url).json(body))
            .send()
            .await
            .map_err(|e| PrometheusError::http(format!("POST {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        read_response_json_limited(resp, MAX_RESPONSE_BYTES, "Prometheus full-URL POST").await
    }

    /// DELETE on a full URL.
    pub async fn delete_url(&self, url: &str) -> PrometheusResult<()> {
        debug!("PROMETHEUS DELETE {url}");
        let resp = self
            .apply_auth(self.http.delete(url))
            .send()
            .await
            .map_err(|e| PrometheusError::http(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Ok(())
    }

    // ── Connection verification ──────────────────────────────────────

    /// Verify the connection by hitting /api/v1/status/buildinfo.
    pub async fn ping(&self) -> PrometheusResult<PrometheusConnectionSummary> {
        let build: serde_json::Value = self.api_get("status/buildinfo", &[]).await?;
        let version = build
            .get("version")
            .and_then(|v| v.as_str())
            .map(String::from);

        let runtime: serde_json::Value = self.api_get("status/runtimeinfo", &[]).await?;
        let uptime = runtime
            .get("storageRetention")
            .and_then(|v| v.as_str())
            .map(String::from);

        let tsdb: serde_json::Value = self.api_get("status/tsdb", &[]).await?;
        let series_count = tsdb
            .get("headStats")
            .and_then(|h| h.get("numSeries"))
            .and_then(|v| v.as_u64());

        Ok(PrometheusConnectionSummary {
            host: self.config.host.clone(),
            version,
            uptime,
            series_count,
            samples_ingested: None,
        })
    }

    /// Return the base URL for Alertmanager API (derived from same host, port 9093).
    pub fn alertmanager_url(&self, path: &str) -> String {
        let port = 9093;
        format!(
            "{}://{}:{}/api/v2/{}",
            self.scheme(),
            self.config.host,
            port,
            path
        )
    }

    /// Return the base URL for federation endpoint.
    pub fn federate_url(&self) -> String {
        format!("{}/federate", self.base_url())
    }
}

pub(crate) async fn read_response_bytes_limited(
    mut resp: reqwest::Response,
    limit: usize,
    context: &str,
) -> PrometheusResult<Vec<u8>> {
    let declared = resp.content_length();
    if declared.is_some_and(|size| size > limit as u64) {
        return Err(PrometheusError::parse(format!(
            "{context} rejected: declared response exceeds {limit} bytes"
        )));
    }
    let mut body = Vec::with_capacity(declared.unwrap_or(0).min(limit as u64) as usize);
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| PrometheusError::parse(format!("{context}: failed to read response: {e}")))?
    {
        let next_len = body.len().checked_add(chunk.len()).ok_or_else(|| {
            PrometheusError::parse(format!("{context} rejected: response size overflow"))
        })?;
        if next_len > limit {
            return Err(PrometheusError::parse(format!(
                "{context} rejected: streamed response exceeds {limit} bytes"
            )));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub(crate) async fn read_response_text_limited(
    resp: reqwest::Response,
    limit: usize,
    context: &str,
) -> PrometheusResult<String> {
    let body = read_response_bytes_limited(resp, limit, context).await?;
    String::from_utf8(body)
        .map_err(|e| PrometheusError::parse(format!("{context}: response is not valid UTF-8: {e}")))
}

async fn read_response_json_limited<T: DeserializeOwned>(
    resp: reqwest::Response,
    limit: usize,
    context: &str,
) -> PrometheusResult<T> {
    let body = read_response_bytes_limited(resp, limit, context).await?;
    serde_json::from_slice(&body)
        .map_err(|e| PrometheusError::parse(format!("{context}: invalid JSON: {e}")))
}
