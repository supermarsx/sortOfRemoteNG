// ── sorng-netbox/src/client.rs ───────────────────────────────────────────────
//! HTTP client for NetBox REST API.

use crate::error::{NetboxError, NetboxResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use std::time::Duration;

pub struct NetboxClient {
    pub config: NetboxConnectionConfig,
    http: HttpClient,
}

impl NetboxClient {
    pub fn new(config: NetboxConnectionConfig) -> NetboxResult<Self> {
        let accept_invalid = config.accept_invalid_certs.unwrap_or(false);
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(accept_invalid)
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

    fn map_status_error(&self, status: u16, body: &str) -> NetboxError {
        match status {
            401 => NetboxError::auth(format!("Authentication failed (HTTP 401): {body}")),
            403 => NetboxError::permission_denied(format!("Access denied (HTTP 403): {body}")),
            404 => NetboxError::api(format!("Not found (HTTP 404): {body}")),
            409 => NetboxError::conflict(format!("Conflict (HTTP 409): {body}")),
            400 => NetboxError::invalid_request(format!("Bad request (HTTP 400): {body}")),
            _ => NetboxError::http(format!("HTTP {status}: {body}")),
        }
    }

    // ── Generic request helpers ──────────────────────────────────────

    pub async fn api_get<T: DeserializeOwned>(&self, path: &str) -> NetboxResult<T> {
        let url = self.api_url(path);
        debug!("NETBOX GET {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| NetboxError::http(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| NetboxError::parse(format!("GET {url} parse: {e}")))
    }

    pub async fn api_get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> NetboxResult<T> {
        let url = self.api_url(path);
        debug!("NETBOX GET {url} params={params:?}");
        let resp = self
            .apply_auth(self.http.get(&url).query(params))
            .send()
            .await
            .map_err(|e| NetboxError::http(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| NetboxError::parse(format!("GET {url} parse: {e}")))
    }

    pub async fn api_get_paginated<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<T>> {
        self.api_get_with_params(path, params).await
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
            .map_err(|e| NetboxError::http(format!("POST {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| NetboxError::parse(format!("POST {url} parse: {e}")))
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
            .map_err(|e| NetboxError::http(format!("PUT {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| NetboxError::parse(format!("PUT {url} parse: {e}")))
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
            .map_err(|e| NetboxError::http(format!("PATCH {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| NetboxError::parse(format!("PATCH {url} parse: {e}")))
    }

    pub async fn api_delete(&self, path: &str) -> NetboxResult<()> {
        let url = self.api_url(path);
        debug!("NETBOX DELETE {url}");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| NetboxError::http(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
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
}
