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
    pub fn new(mut config: PfsenseConnectionConfig) -> PfsenseResult<Self> {
        if config.host.trim().is_empty() {
            return Err(PfsenseError::invalid_request("host must not be empty"));
        }
        if config.timeout_secs == 0 {
            return Err(PfsenseError::invalid_request(
                "request timeout must be greater than zero",
            ));
        }
        let acknowledged = std::mem::take(&mut config.acknowledge_invalid_cert_risk);
        let effective_tls_skip = config.use_tls && config.accept_invalid_certs;
        if effective_tls_skip != acknowledged {
            return Err(PfsenseError::invalid_request(
                "TLS certificate verification bypass requires an explicit runtime acknowledgement for this connection attempt",
            ));
        }

        validate_internal_proxy_url(&config.internal_proxy_url)?;

        // TLS verification and any configured external/global proxy are owned
        // by the internal mediator's upstream client. This client talks only to
        // its protected loopback HTTP endpoint; proxying this hop again could
        // leak the local capability URL to an external proxy.
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(|e| PfsenseError::connection(format!("HTTP client build: {e}")))?;
        Ok(Self { config, http })
    }

    fn base_url(&self) -> String {
        self.config
            .internal_proxy_url
            .trim_end_matches('/')
            .to_string()
    }

    fn api_url(&self, endpoint: &str) -> String {
        format!(
            "{}/api/v1/{}",
            self.base_url(),
            endpoint.trim_start_matches('/')
        )
    }

    // ── Auth ─────────────────────────────────────────────────────

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
            .http
            .get(&url)
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
            .http
            .post(&url)
            .json(body)
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
            .http
            .put(&url)
            .json(body)
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
            .http
            .delete(&url)
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
            .http
            .delete(&url)
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
            .http
            .get(&url)
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

fn validate_internal_proxy_url(raw: &str) -> PfsenseResult<()> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| {
        PfsenseError::invalid_request("pfSense API requires a valid protected internal proxy URL")
    })?;
    let host = url.host_str().unwrap_or_default();
    let token = host
        .strip_prefix('p')
        .and_then(|value| value.strip_suffix(".localhost"));
    let protected_host = token.is_some_and(|value| {
        value.len() == 32
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    });
    if url.scheme() != "http"
        || !protected_host
        || url.port().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(PfsenseError::invalid_request(
            "pfSense API requests must use the capability-protected internal proxy",
        ));
    }
    Ok(())
}
