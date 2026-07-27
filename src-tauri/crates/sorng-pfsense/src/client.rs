//! pfSense REST API client using reqwest.

use crate::error::{PfsenseError, PfsenseResult};
use crate::types::PfsenseConnectionConfig;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

pub struct PfsenseClient {
    pub config: PfsenseConnectionConfig,
    http: HttpClient,
}

impl PfsenseClient {
    pub fn new(config: PfsenseConnectionConfig) -> PfsenseResult<Self> {
        if config.host.trim().is_empty() {
            return Err(PfsenseError::invalid_request("host must not be empty"));
        }
        if config.timeout_secs == 0 {
            return Err(PfsenseError::invalid_request(
                "request timeout must be greater than zero",
            ));
        }
        if config.api_key.trim().is_empty() || config.api_secret.trim().is_empty() {
            return Err(PfsenseError::auth(
                "API key and API secret must both be provided",
            ));
        }

        let mut builder = HttpClient::builder()
            .danger_accept_invalid_certs(config.accept_invalid_certs)
            .timeout(Duration::from_secs(config.timeout_secs));
        if let Some(proxy_url) = config
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|e| PfsenseError::connection(format!("invalid proxy URL: {e}")))?;
            builder = builder.proxy(proxy);
        }
        let http = builder
            .build()
            .map_err(|e| PfsenseError::connection(format!("HTTP client build: {e}")))?;
        Ok(Self { config, http })
    }

    fn scheme(&self) -> &str {
        if self.config.use_tls {
            "https"
        } else {
            "http"
        }
    }

    fn base_url(&self) -> String {
        format!(
            "{}://{}:{}",
            self.scheme(),
            self.config.host,
            self.config.port
        )
    }

    fn api_url(&self, endpoint: &str) -> String {
        format!(
            "{}/api/v1/{}",
            self.base_url(),
            endpoint.trim_start_matches('/')
        )
    }

    // ── Auth ─────────────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if !self.config.api_key.is_empty() {
            req.header(
                "Authorization",
                format!("{} {}", self.config.api_key, self.config.api_secret),
            )
        } else {
            req
        }
    }

    fn map_status_error(&self, status: u16, body: &str) -> PfsenseError {
        match status {
            401 => PfsenseError::auth(format!("Authentication failed (HTTP 401): {body}")),
            403 => PfsenseError::auth(format!("Access denied (HTTP 403): {body}")),
            404 => PfsenseError::api(format!("Not found (HTTP 404): {body}")),
            _ => PfsenseError::http(format!("HTTP {status}: {body}")),
        }
    }

    // ── Generic request helpers ──────────────────────────────────

    pub async fn api_get<T: DeserializeOwned>(&self, endpoint: &str) -> PfsenseResult<T> {
        let url = self.api_url(endpoint);
        debug!("PFSENSE GET {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| Self::request_error(format!("GET {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| PfsenseError::parse(format!("GET {url} parse: {e}")))
    }

    pub async fn api_get_raw(&self, endpoint: &str) -> PfsenseResult<serde_json::Value> {
        self.api_get(endpoint).await
    }

    pub async fn api_post<B: Serialize, T: DeserializeOwned>(
        &self,
        endpoint: &str,
        body: &B,
    ) -> PfsenseResult<T> {
        let url = self.api_url(endpoint);
        debug!("PFSENSE POST {url}");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| Self::request_error(format!("POST {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| PfsenseError::parse(format!("POST {url} parse: {e}")))
    }

    pub async fn api_put<B: Serialize, T: DeserializeOwned>(
        &self,
        endpoint: &str,
        body: &B,
    ) -> PfsenseResult<T> {
        let url = self.api_url(endpoint);
        debug!("PFSENSE PUT {url}");
        let resp = self
            .apply_auth(self.http.put(&url).json(body))
            .send()
            .await
            .map_err(|e| Self::request_error(format!("PUT {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| PfsenseError::parse(format!("PUT {url} parse: {e}")))
    }

    pub async fn api_delete<T: DeserializeOwned>(&self, endpoint: &str) -> PfsenseResult<T> {
        let url = self.api_url(endpoint);
        debug!("PFSENSE DELETE {url}");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| Self::request_error(format!("DELETE {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| PfsenseError::parse(format!("DELETE {url} parse: {e}")))
    }

    pub async fn api_delete_void(&self, endpoint: &str) -> PfsenseResult<()> {
        let url = self.api_url(endpoint);
        debug!("PFSENSE DELETE {url}");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| Self::request_error(format!("DELETE {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn api_get_bytes(&self, endpoint: &str) -> PfsenseResult<Vec<u8>> {
        let url = self.api_url(endpoint);
        debug!("PFSENSE GET bytes {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| Self::request_error(format!("GET {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| PfsenseError::parse(format!("GET {url} bytes: {e}")))
    }

    /// Verify connectivity by fetching system info.
    pub async fn ping(&self) -> PfsenseResult<crate::types::PfsenseConnectionSummary> {
        #[derive(serde::Deserialize)]
        struct ProbeData {
            hostname: String,
            #[serde(alias = "system_version")]
            version: String,
            #[serde(default = "default_platform")]
            platform: String,
        }

        fn default_platform() -> String {
            "pfSense".to_string()
        }

        let response: crate::types::ApiResponse<ProbeData> = self.api_get("status/system").await?;
        if !(200..300).contains(&response.code) || response.return_code != 0 {
            return Err(PfsenseError::api(format!(
                "pfSense API probe failed (code {}, return {}): {}",
                response.code, response.return_code, response.message
            )));
        }
        let data = response.data;
        Ok(crate::types::PfsenseConnectionSummary {
            host: self.config.host.clone(),
            version: data.version,
            hostname: data.hostname,
            platform: data.platform,
        })
    }

    fn request_error(context: String, error: reqwest::Error) -> PfsenseError {
        let message = format!("{context}: {error}");
        if error.is_timeout() {
            PfsenseError::timeout(message)
        } else {
            PfsenseError::http(message)
        }
    }
}
