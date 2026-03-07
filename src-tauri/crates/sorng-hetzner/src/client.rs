use crate::error::{HetznerError, HetznerResult};
use crate::types::HetznerConnectionConfig;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::de::DeserializeOwned;

const DEFAULT_BASE_URL: &str = "https://api.hetzner.cloud/v1";

/// Hetzner Cloud API client with bearer token authentication.
pub struct HetznerClient {
    pub config: HetznerConnectionConfig,
    http: reqwest::Client,
    base_url: String,
}

impl HetznerClient {
    /// Create a new Hetzner API client from connection configuration.
    pub fn new(config: HetznerConnectionConfig) -> HetznerResult<Self> {
        let mut builder = reqwest::Client::builder();

        if let Some(timeout) = config.timeout_secs {
            builder = builder.timeout(std::time::Duration::from_secs(timeout));
        }

        if config.tls_skip_verify == Some(true) {
            builder = builder.danger_accept_invalid_certs(true);
        }

        let http = builder
            .build()
            .map_err(|e| HetznerError::connection_failed(format!("Failed to create HTTP client: {e}")))?;

        let base_url = config
            .base_url
            .clone()
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());

        Ok(Self { config, http, base_url })
    }

    /// Build the full URL for an API endpoint path.
    pub fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// Build default headers with bearer token auth.
    fn default_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        let bearer = format!("Bearer {}", self.config.api_token);
        if let Ok(val) = HeaderValue::from_str(&bearer) {
            headers.insert(AUTHORIZATION, val);
        }
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers
    }

    /// Handle the API response, mapping HTTP errors appropriately.
    async fn handle_response<T: DeserializeOwned>(
        &self,
        response: reqwest::Response,
    ) -> HetznerResult<T> {
        let status = response.status().as_u16();
        if status >= 200 && status < 300 {
            let body = response
                .text()
                .await
                .map_err(|e| HetznerError::http(format!("Failed to read response body: {e}")))?;
            serde_json::from_str(&body)
                .map_err(|e| HetznerError::parse(format!("Failed to parse response: {e}")))
        } else {
            let body = response.text().await.unwrap_or_default();
            match status {
                401 => Err(HetznerError::auth_failed(format!("Authentication failed: {body}"))),
                403 => Err(HetznerError::auth_failed(format!("Forbidden: {body}"))),
                404 => Err(HetznerError::not_found(format!("Resource not found: {body}"))),
                409 => Err(HetznerError::conflict(format!("Conflict: {body}"))),
                429 => Err(HetznerError::rate_limited(format!("Rate limited: {body}"))),
                500..=599 => Err(HetznerError::server_error(format!("Server error ({status}): {body}"))),
                _ => Err(HetznerError::http(format!("HTTP {status}: {body}"))),
            }
        }
    }

    /// Perform a GET request.
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> HetznerResult<T> {
        let url = self.url(path);
        log::debug!("GET {}", url);
        let response = self
            .http
            .get(&url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| HetznerError::connection_failed(format!("Request failed: {e}")))?;
        self.handle_response(response).await
    }

    /// Perform a POST request with a JSON body.
    pub async fn post<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> HetznerResult<T> {
        let url = self.url(path);
        log::debug!("POST {}", url);
        let response = self
            .http
            .post(&url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await
            .map_err(|e| HetznerError::connection_failed(format!("Request failed: {e}")))?;
        self.handle_response(response).await
    }

    /// Perform a POST request with no body (action endpoints).
    pub async fn post_empty<T: DeserializeOwned>(&self, path: &str) -> HetznerResult<T> {
        let url = self.url(path);
        log::debug!("POST {}", url);
        let response = self
            .http
            .post(&url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| HetznerError::connection_failed(format!("Request failed: {e}")))?;
        self.handle_response(response).await
    }

    /// Perform a PUT request with a JSON body.
    pub async fn put<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> HetznerResult<T> {
        let url = self.url(path);
        log::debug!("PUT {}", url);
        let response = self
            .http
            .put(&url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await
            .map_err(|e| HetznerError::connection_failed(format!("Request failed: {e}")))?;
        self.handle_response(response).await
    }

    /// Perform a DELETE request.
    pub async fn delete_req(&self, path: &str) -> HetznerResult<()> {
        let url = self.url(path);
        log::debug!("DELETE {}", url);
        let response = self
            .http
            .delete(&url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| HetznerError::connection_failed(format!("Request failed: {e}")))?;
        let status = response.status().as_u16();
        if status >= 200 && status < 300 {
            Ok(())
        } else {
            let body = response.text().await.unwrap_or_default();
            match status {
                401 => Err(HetznerError::auth_failed(format!("Authentication failed: {body}"))),
                404 => Err(HetznerError::not_found(format!("Resource not found: {body}"))),
                409 => Err(HetznerError::conflict(format!("Conflict: {body}"))),
                429 => Err(HetznerError::rate_limited(format!("Rate limited: {body}"))),
                _ => Err(HetznerError::http(format!("HTTP {status}: {body}"))),
            }
        }
    }

    /// Perform a DELETE request that returns a JSON response (e.g., action).
    pub async fn delete_with_response<T: DeserializeOwned>(&self, path: &str) -> HetznerResult<T> {
        let url = self.url(path);
        log::debug!("DELETE {}", url);
        let response = self
            .http
            .delete(&url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| HetznerError::connection_failed(format!("Request failed: {e}")))?;
        self.handle_response(response).await
    }

    /// Perform a POST request with a JSON body, expecting an action response.
    pub async fn post_action(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> HetznerResult<crate::types::HetznerAction> {
        let resp: crate::types::ActionResponse = self.post(path, body).await?;
        Ok(resp.action)
    }

    /// Perform a POST action with no body.
    pub async fn post_action_empty(
        &self,
        path: &str,
    ) -> HetznerResult<crate::types::HetznerAction> {
        let resp: crate::types::ActionResponse = self.post_empty(path).await?;
        Ok(resp.action)
    }

    /// Ping the API to verify the token works.
    pub async fn ping(&self) -> HetznerResult<()> {
        let _: crate::types::ServersResponse = self.get("/servers?per_page=1").await?;
        Ok(())
    }
}
