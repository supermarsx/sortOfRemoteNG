// ── sorng-netbox – NetBox REST API HTTP client ──────────────────────────────
//! HTTP client wrapping the NetBox REST API (`/api/...`).

use crate::error::{NetboxError, NetboxResult};
use crate::types::{NetboxConnectionConfig, NetboxListResponse};
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
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .danger_accept_invalid_certs(!config.tls_verify)
            .build()
            .map_err(|e| NetboxError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    pub fn api_url(&self, path: &str) -> String {
        format!(
            "{}://{}:{}/api{}",
            self.config.scheme, self.config.host, self.config.port, path
        )
    }

    fn auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        req.header("Authorization", format!("Token {}", self.config.api_token))
            .header("Accept", "application/json")
    }

    pub async fn api_get(&self, endpoint: &str) -> NetboxResult<String> {
        let url = self.api_url(endpoint);
        debug!("NETBOX GET {url}");
        let resp = self
            .auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| NetboxError::connection(format!("GET {url}: {e}")))?;
        self.handle_response(resp).await
    }

    /// Paginated list – fetches all pages and returns the full results vec.
    pub async fn api_get_list<T: DeserializeOwned>(
        &self,
        endpoint: &str,
    ) -> NetboxResult<Vec<T>> {
        let mut results: Vec<T> = Vec::new();
        let mut url = Some(self.api_url(endpoint));

        while let Some(u) = url {
            debug!("NETBOX GET (list) {u}");
            let resp = self
                .auth(self.http.get(&u))
                .send()
                .await
                .map_err(|e| NetboxError::connection(format!("GET {u}: {e}")))?;
            let body = self.handle_response(resp).await?;
            let page: NetboxListResponse<T> = serde_json::from_str(&body)
                .map_err(|e| NetboxError::parse(format!("list parse: {e}")))?;
            results.extend(page.results);
            url = page.next;
        }
        Ok(results)
    }

    pub async fn api_post(&self, endpoint: &str, body: &str) -> NetboxResult<String> {
        let url = self.api_url(endpoint);
        debug!("NETBOX POST {url}");
        let resp = self
            .auth(self.http.post(&url))
            .header("Content-Type", "application/json")
            .body(body.to_owned())
            .send()
            .await
            .map_err(|e| NetboxError::connection(format!("POST {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn api_put(&self, endpoint: &str, body: &str) -> NetboxResult<String> {
        let url = self.api_url(endpoint);
        debug!("NETBOX PUT {url}");
        let resp = self
            .auth(self.http.put(&url))
            .header("Content-Type", "application/json")
            .body(body.to_owned())
            .send()
            .await
            .map_err(|e| NetboxError::connection(format!("PUT {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn api_patch(&self, endpoint: &str, body: &str) -> NetboxResult<String> {
        let url = self.api_url(endpoint);
        debug!("NETBOX PATCH {url}");
        let resp = self
            .auth(self.http.patch(&url))
            .header("Content-Type", "application/json")
            .body(body.to_owned())
            .send()
            .await
            .map_err(|e| NetboxError::connection(format!("PATCH {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn api_delete(&self, endpoint: &str) -> NetboxResult<String> {
        let url = self.api_url(endpoint);
        debug!("NETBOX DELETE {url}");
        let resp = self
            .auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| NetboxError::connection(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if status.as_u16() == 204 {
            return Ok(String::new());
        }
        self.handle_response(resp).await
    }

    async fn handle_response(&self, resp: reqwest::Response) -> NetboxResult<String> {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if status.is_success() {
            Ok(body)
        } else {
            Err(self.map_status_error(status.as_u16(), &body))
        }
    }

    fn map_status_error(&self, status: u16, body: &str) -> NetboxError {
        match status {
            401 => NetboxError::auth(format!("Authentication failed: {body}")),
            403 => NetboxError::permission(format!("Permission denied: {body}")),
            404 => NetboxError::not_found(format!("Not found: {body}")),
            409 => NetboxError::conflict(format!("Conflict: {body}")),
            429 => NetboxError::rate_limited(format!("Rate limited: {body}")),
            400 => NetboxError::validation(format!("Validation error: {body}")),
            408 => NetboxError::timeout(format!("Request timeout: {body}")),
            _ => NetboxError::api(format!("HTTP {status}: {body}")),
        }
    }

    /// Convenience: ping the API status endpoint.
    pub async fn status(&self) -> NetboxResult<String> {
        self.api_get("/status/").await
    }
}
