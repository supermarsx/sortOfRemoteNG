// ── sorng-netbox/src/client.rs ───────────────────────────────────────────────
//! HTTP client for NetBox REST API.

use crate::error::{NetboxError, NetboxResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use std::time::Duration;

const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_METADATA_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_PAGE_ITEMS: usize = 10_000;

pub struct NetboxClient {
    pub config: NetboxConnectionConfig,
    http: HttpClient,
}

impl NetboxClient {
    pub fn new(mut config: NetboxConnectionConfig) -> NetboxResult<Self> {
        if config.host.trim().is_empty() {
            return Err(NetboxError::invalid_request("host must not be empty"));
        }
        if config.api_token.trim().is_empty() {
            return Err(NetboxError::auth("API token must not be empty"));
        }
        if config.timeout_secs == Some(0) {
            return Err(NetboxError::invalid_request(
                "request timeout must be greater than zero",
            ));
        }

        let acknowledged = std::mem::take(&mut config.acknowledge_invalid_cert_risk);
        let effective_tls_skip =
            config.use_tls.unwrap_or(true) && config.accept_invalid_certs.unwrap_or(false);
        if effective_tls_skip != acknowledged {
            return Err(NetboxError::invalid_request(
                "TLS certificate verification bypass requires an explicit runtime acknowledgement for this connection attempt",
            ));
        }
        let mut builder = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(effective_tls_skip);
        if let Some(proxy_url) = config
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|e| NetboxError::connection(format!("invalid proxy URL: {e}")))?;
            builder = builder.proxy(proxy);
        }
        let http = builder
            .build()
            .map_err(|e| NetboxError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── URL builders ─────────────────────────────────────────────────

    fn scheme(&self) -> &str {
        if self.config.use_tls.unwrap_or(true) {
            "https"
        } else {
            "http"
        }
    }

    fn base_url(&self) -> String {
        let port = self
            .config
            .port
            .unwrap_or(if self.config.use_tls.unwrap_or(true) {
                443
            } else {
                80
            });
        let host = &self.config.host;
        if (self.config.use_tls.unwrap_or(true) && port == 443)
            || (!self.config.use_tls.unwrap_or(true) && port == 80)
        {
            format!("{}://{}", self.scheme(), host)
        } else {
            format!("{}://{}:{}", self.scheme(), host, port)
        }
    }

    fn api_url(&self, path: &str) -> String {
        let base = self.base_url();
        let trimmed = path.trim_start_matches('/');
        if trimmed.ends_with('/') {
            format!("{}/api/{}", base, trimmed)
        } else {
            format!("{}/api/{}/", base, trimmed)
        }
    }

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        req.header("Authorization", format!("Token {}", self.config.api_token))
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
    }

    // ── Status mapping ───────────────────────────────────────────────

    fn map_status_error(&self, status: u16) -> NetboxError {
        match status {
            401 => NetboxError::auth("Authentication failed (HTTP 401)"),
            403 => NetboxError::permission_denied("Access denied (HTTP 403)"),
            404 => NetboxError::api("Not found (HTTP 404)"),
            409 => NetboxError::conflict("Conflict (HTTP 409)"),
            400 => NetboxError::invalid_request("Bad request (HTTP 400)"),
            _ => NetboxError::http(format!("HTTP {status}")),
        }
    }

    fn response_limit(path: &str) -> usize {
        if path.trim_matches('/') == "status" {
            MAX_METADATA_RESPONSE_BYTES
        } else {
            MAX_RESPONSE_BYTES
        }
    }

    async fn read_json_limited<T: DeserializeOwned>(
        mut resp: reqwest::Response,
        limit: usize,
        context: &str,
    ) -> NetboxResult<T> {
        let declared = resp.content_length();
        if declared.is_some_and(|size| size > limit as u64) {
            return Err(NetboxError::parse(format!(
                "{context} rejected: declared response exceeds {limit} bytes"
            )));
        }
        let mut body = Vec::with_capacity(declared.unwrap_or(0).min(limit as u64) as usize);
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| NetboxError::parse(format!("{context}: failed to read response: {e}")))?
        {
            let next_len = body.len().checked_add(chunk.len()).ok_or_else(|| {
                NetboxError::parse(format!("{context} rejected: response size overflow"))
            })?;
            if next_len > limit {
                return Err(NetboxError::parse(format!(
                    "{context} rejected: streamed response exceeds {limit} bytes"
                )));
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&body)
            .map_err(|e| NetboxError::parse(format!("{context}: invalid JSON: {e}")))
    }

    // ── Generic request helpers ──────────────────────────────────────

    pub async fn api_get<T: DeserializeOwned>(&self, path: &str) -> NetboxResult<T> {
        let url = self.api_url(path);
        debug!("NETBOX GET {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| Self::request_error(format!("GET {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Self::read_json_limited(resp, Self::response_limit(path), "NetBox GET response").await
    }

    pub async fn api_get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> NetboxResult<T> {
        let url = self.api_url(path);
        debug!("NETBOX GET {url} with {} query parameters", params.len());
        let resp = self
            .apply_auth(self.http.get(&url).query(params))
            .send()
            .await
            .map_err(|e| Self::request_error(format!("GET {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Self::read_json_limited(resp, Self::response_limit(path), "NetBox GET response").await
    }

    pub async fn api_get_paginated<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<T>> {
        let page: PaginatedResponse<T> = self.api_get_with_params(path, params).await?;
        if page.results.len() > MAX_PAGE_ITEMS {
            return Err(NetboxError::parse(format!(
                "NetBox page rejected: more than {MAX_PAGE_ITEMS} results"
            )));
        }
        Ok(page)
    }

    pub async fn api_post<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> NetboxResult<T> {
        let url = self.api_url(path);
        debug!("NETBOX POST {url}");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| Self::request_error(format!("POST {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Self::read_json_limited(resp, MAX_RESPONSE_BYTES, "NetBox POST response").await
    }

    pub async fn api_put<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> NetboxResult<T> {
        let url = self.api_url(path);
        debug!("NETBOX PUT {url}");
        let resp = self
            .apply_auth(self.http.put(&url).json(body))
            .send()
            .await
            .map_err(|e| Self::request_error(format!("PUT {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Self::read_json_limited(resp, MAX_RESPONSE_BYTES, "NetBox PUT response").await
    }

    pub async fn api_patch<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> NetboxResult<T> {
        let url = self.api_url(path);
        debug!("NETBOX PATCH {url}");
        let resp = self
            .apply_auth(self.http.patch(&url).json(body))
            .send()
            .await
            .map_err(|e| Self::request_error(format!("PATCH {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Self::read_json_limited(resp, MAX_RESPONSE_BYTES, "NetBox PATCH response").await
    }

    pub async fn api_delete(&self, path: &str) -> NetboxResult<()> {
        let url = self.api_url(path);
        debug!("NETBOX DELETE {url}");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| Self::request_error(format!("DELETE {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Ok(())
    }

    // ── Connection verification ──────────────────────────────────────

    pub async fn ping(&self) -> NetboxResult<NetboxConnectionSummary> {
        let status: serde_json::Value = self.api_get("status").await?;
        let version = status
            .get("netbox-version")
            .and_then(|v| v.as_str())
            .map(String::from);

        let sites: PaginatedResponse<serde_json::Value> = self
            .api_get_paginated("dcim/sites", &[("limit", "1")])
            .await?;
        let devices: PaginatedResponse<serde_json::Value> = self
            .api_get_paginated("dcim/devices", &[("limit", "1")])
            .await?;
        let prefixes: PaginatedResponse<serde_json::Value> = self
            .api_get_paginated("ipam/prefixes", &[("limit", "1")])
            .await?;

        Ok(NetboxConnectionSummary {
            host: self.config.host.clone(),
            version,
            site_count: Some(sites.count),
            device_count: Some(devices.count),
            prefix_count: Some(prefixes.count),
        })
    }

    fn request_error(context: String, error: reqwest::Error) -> NetboxError {
        let message = format!("{context}: {error}");
        if error.is_timeout() {
            NetboxError::timeout(message)
        } else {
            NetboxError::http(message)
        }
    }
}
