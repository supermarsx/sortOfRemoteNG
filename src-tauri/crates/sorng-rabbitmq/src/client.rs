use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

use crate::error::{RabbitError, RabbitErrorKind};
use crate::types::RabbitConnectionConfig;

/// HTTP client for the RabbitMQ Management API.
///
/// Handles authentication, URL construction, percent-encoding of path segments
/// (vhost names, queue names, etc.), and maps HTTP error codes to `RabbitError`.
#[derive(Debug, Clone)]
pub struct RabbitApiClient {
    /// Base URL of the management API, e.g. `http://host:15672/api`.
    base_url: String,
    /// Pre-computed `Basic ...` authorization header value.
    auth_header: String,
    /// Reusable HTTP client.
    client: reqwest::Client,
}

impl RabbitApiClient {
    /// Create a new client from a connection configuration.
    pub fn new(config: &RabbitConnectionConfig) -> Result<Self, RabbitError> {
        let scheme = if config.use_tls { "https" } else { "http" };
        let base_url = format!(
            "{}://{}:{}/api",
            scheme, config.host, config.management_port
        );

        let credentials = format!("{}:{}", config.username, config.password);
        let auth_header = format!("Basic {}", BASE64.encode(credentials.as_bytes()));

        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(config.timeout))
            .danger_accept_invalid_certs(!config.verify_cert)
            .build()
            .map_err(|e| RabbitError::connection_failed(e.to_string()))?;

        Ok(Self {
            base_url,
            auth_header,
            client,
        })
    }

    /// Percent-encode a single path segment (e.g. vhost name `/` → `%2F`).
    pub fn encode_path_segment(segment: &str) -> String {
        url::form_urlencoded::byte_serialize(segment.as_bytes()).collect()
    }

    /// Build a full URL from a relative API path.
    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
    }

    /// Perform a GET request and deserialize the JSON response.
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, RabbitError> {
        let url = self.url(path);
        log::debug!("GET {}", url);

        let resp = self
            .client
            .get(&url)
            .header(AUTHORIZATION, &self.auth_header)
            .send()
            .await?;

        Self::handle_response(resp).await
    }

    /// Perform a GET that may return 404, mapping it to `Ok(None)`.
    pub async fn get_optional<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<Option<T>, RabbitError> {
        let url = self.url(path);
        log::debug!("GET (optional) {}", url);

        let resp = self
            .client
            .get(&url)
            .header(AUTHORIZATION, &self.auth_header)
            .send()
            .await?;

        if resp.status().as_u16() == 404 {
            return Ok(None);
        }
        Self::handle_response(resp).await.map(Some)
    }

    /// Perform a GET and return the raw response body as a string.
    pub async fn get_raw(&self, path: &str) -> Result<String, RabbitError> {
        let url = self.url(path);
        log::debug!("GET (raw) {}", url);

        let resp = self
            .client
            .get(&url)
            .header(AUTHORIZATION, &self.auth_header)
            .send()
            .await?;

        let status = resp.status().as_u16();
        let body = resp.text().await.map_err(RabbitError::from)?;
        if status >= 400 {
            return Err(RabbitError::from_http(status, &body));
        }
        Ok(body)
    }

    /// Perform a PUT request with a JSON body, returning the deserialized response.
    pub async fn put<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, RabbitError> {
        let url = self.url(path);
        log::debug!("PUT {}", url);

        let resp = self
            .client
            .put(&url)
            .header(AUTHORIZATION, &self.auth_header)
            .json(body)
            .send()
            .await?;

        Self::handle_response(resp).await
    }

    /// Perform a PUT that returns no meaningful body (expects 2xx).
    pub async fn put_no_content<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<(), RabbitError> {
        let url = self.url(path);
        log::debug!("PUT (no content) {}", url);

        let resp = self
            .client
            .put(&url)
            .header(AUTHORIZATION, &self.auth_header)
            .json(body)
            .send()
            .await?;

        let status = resp.status().as_u16();
        if status >= 400 {
            let body = resp.text().await.unwrap_or_default();
            return Err(RabbitError::from_http(status, &body));
        }
        Ok(())
    }

    /// Perform a POST request with a JSON body, returning the deserialized response.
    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, RabbitError> {
        let url = self.url(path);
        log::debug!("POST {}", url);

        let resp = self
            .client
            .post(&url)
            .header(AUTHORIZATION, &self.auth_header)
            .json(body)
            .send()
            .await?;

        Self::handle_response(resp).await
    }

    /// POST with no response body expected.
    pub async fn post_no_content<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<(), RabbitError> {
        let url = self.url(path);
        log::debug!("POST (no content) {}", url);

        let resp = self
            .client
            .post(&url)
            .header(AUTHORIZATION, &self.auth_header)
            .json(body)
            .send()
            .await?;

        let status = resp.status().as_u16();
        if status >= 400 {
            let body = resp.text().await.unwrap_or_default();
            return Err(RabbitError::from_http(status, &body));
        }
        Ok(())
    }

    /// POST with a raw JSON value body.
    pub async fn post_json<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<T, RabbitError> {
        let url = self.url(path);
        log::debug!("POST (json) {}", url);

        let resp = self
            .client
            .post(&url)
            .header(AUTHORIZATION, &self.auth_header)
            .json(body)
            .send()
            .await?;

        Self::handle_response(resp).await
    }

    /// Perform a DELETE request.
    pub async fn delete(&self, path: &str) -> Result<(), RabbitError> {
        let url = self.url(path);
        log::debug!("DELETE {}", url);

        let resp = self
            .client
            .delete(&url)
            .header(AUTHORIZATION, &self.auth_header)
            .send()
            .await?;

        let status = resp.status().as_u16();
        if status >= 400 {
            let body = resp.text().await.unwrap_or_default();
            return Err(RabbitError::from_http(status, &body));
        }
        Ok(())
    }

    /// DELETE with a query string appended.
    pub async fn delete_with_query(
        &self,
        path: &str,
        query: &str,
    ) -> Result<(), RabbitError> {
        let url = if query.is_empty() {
            self.url(path)
        } else {
            format!("{}?{}", self.url(path), query)
        };
        log::debug!("DELETE {}", url);

        let resp = self
            .client
            .delete(&url)
            .header(AUTHORIZATION, &self.auth_header)
            .send()
            .await?;

        let status = resp.status().as_u16();
        if status >= 400 {
            let body = resp.text().await.unwrap_or_default();
            return Err(RabbitError::from_http(status, &body));
        }
        Ok(())
    }

    /// Handle an HTTP response: check status code and deserialize the body.
    async fn handle_response<T: DeserializeOwned>(
        resp: reqwest::Response,
    ) -> Result<T, RabbitError> {
        let status = resp.status().as_u16();
        let body = resp.text().await.map_err(RabbitError::from)?;

        if status >= 400 {
            return Err(RabbitError::from_http(status, &body));
        }

        serde_json::from_str(&body).map_err(|e| {
            RabbitError::new(
                RabbitErrorKind::SerializationError,
                format!("Failed to deserialize response: {} — body: {}", e, &body[..body.len().min(500)]),
            )
        })
    }

    /// Test connectivity by fetching the /api/overview endpoint.
    pub async fn test_connection(&self) -> Result<(), RabbitError> {
        let _: serde_json::Value = self.get("overview").await?;
        Ok(())
    }
}
