// ── sorng-docker/src/client.rs ────────────────────────────────────────────────
//! Docker API HTTP client.

use crate::error::{DockerError, DockerErrorKind, DockerResult};
use crate::types::*;
use reqwest::header::CONTENT_TYPE;
use std::time::Duration;

fn identity_from_pem_parts(
    cert_pem: &[u8],
    key_pem: &[u8],
) -> Result<reqwest::Identity, reqwest::Error> {
    let mut combined = Vec::with_capacity(cert_pem.len() + key_pem.len() + 2);
    combined.extend_from_slice(cert_pem);
    if !combined.ends_with(b"\n") {
        combined.push(b'\n');
    }
    combined.extend_from_slice(key_pem);
    reqwest::Identity::from_pem(&combined)
}

/// Docker API client wrapping an HTTP client + base URL.
pub struct DockerClient {
    pub http: reqwest::Client,
    pub base_url: String,
    pub api_version: String,
}

impl DockerClient {
    /// Build a client from a connection config.
    pub async fn from_config(config: &DockerConnectionConfig) -> DockerResult<Self> {
        let (base_url, http) = match &config.endpoint {
            DockerEndpoint::Tcp { host, port } => {
                let scheme = if config.tls.is_some() {
                    "https"
                } else {
                    "http"
                };
                let url = format!("{}://{}:{}", scheme, host, port);
                let client = Self::build_http_client(config)?;
                (url, client)
            }
            DockerEndpoint::Unix { path } => {
                // On Unix we use reqwest with unix sockets via a custom connector.
                // For portability, we proxy through http://localhost with the path encoded.
                // In production you'd use hyper + hyperlocal, but we keep the reqwest
                // interface identical for command simplicity on Windows.
                let url = format!("http://localhost{}", path);
                let client = Self::build_http_client(config)?;
                (url, client)
            }
            DockerEndpoint::NamedPipe { path } => {
                // Windows named pipe — same approach.
                let url = format!("http://localhost{}", path.replace("//./pipe/", "/"));
                let client = Self::build_http_client(config)?;
                (url, client)
            }
            DockerEndpoint::Ssh { host, port, user } => {
                // SSH tunnelling is done externally; we connect to a local forwarded port.
                let _port = port.unwrap_or(22);
                let _user = user.as_deref().unwrap_or("root");
                let url = format!("http://{}:{}", host, 2375);
                let client = Self::build_http_client(config)?;
                (url, client)
            }
        };

        Ok(Self {
            http,
            base_url,
            api_version: "v1.45".to_string(),
        })
    }

    fn build_http_client(config: &DockerConnectionConfig) -> DockerResult<reqwest::Client> {
        let mut builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_seconds.unwrap_or(30)));

        if let Some(ref tls) = config.tls {
            if let Some(ref ca_pem) = tls.ca_cert_pem {
                let cert = reqwest::Certificate::from_pem(ca_pem.as_bytes())
                    .map_err(|e| DockerError::connection(&format!("Invalid CA cert: {}", e)))?;
                builder = builder.add_root_certificate(cert);
            } else if let Some(ref ca_path) = tls.ca_cert_path {
                let pem = std::fs::read(ca_path)
                    .map_err(|e| DockerError::connection(&format!("Cannot read CA cert: {}", e)))?;
                let cert = reqwest::Certificate::from_pem(&pem)
                    .map_err(|e| DockerError::connection(&format!("Invalid CA cert: {}", e)))?;
                builder = builder.add_root_certificate(cert);
            }

            if let Some(ref cert_pem) = tls.client_cert_pem {
                let key_pem = tls.client_key_pem.as_deref().unwrap_or("");
                let identity = identity_from_pem_parts(cert_pem.as_bytes(), key_pem.as_bytes())
                    .map_err(|e| DockerError::connection(&format!("Invalid client cert: {}", e)))?;
                builder = builder.identity(identity);
            } else if let Some(ref cert_path) = tls.client_cert_path {
                let key_path = tls.client_key_path.as_deref().unwrap_or(cert_path);
                let cert_pem = std::fs::read(cert_path).map_err(|e| {
                    DockerError::connection(&format!("Cannot read client cert: {}", e))
                })?;
                let key_pem = std::fs::read(key_path).map_err(|e| {
                    DockerError::connection(&format!("Cannot read client key: {}", e))
                })?;
                let identity = identity_from_pem_parts(&cert_pem, &key_pem)
                    .map_err(|e| DockerError::connection(&format!("Invalid client cert: {}", e)))?;
                builder = builder.identity(identity);
            }

            if !tls.verify {
                builder = builder.danger_accept_invalid_certs(true);
            }
        }

        builder
            .build()
            .map_err(|e| DockerError::connection(&e.to_string()))
    }

    // ── URL helpers ───────────────────────────────────────────────

    fn url(&self, path: &str) -> String {
        format!("{}/{}{}", self.base_url, self.api_version, path)
    }

    // ── HTTP verbs ────────────────────────────────────────────────

    pub async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> DockerResult<T> {
        let resp = self.http.get(self.url(path)).send().await?;
        self.handle_response(resp).await
    }

    pub async fn get_text(&self, path: &str) -> DockerResult<String> {
        let resp = self.http.get(self.url(path)).send().await?;
        self.handle_text_response(resp).await
    }

    pub async fn post_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &impl serde::Serialize,
    ) -> DockerResult<T> {
        let resp = self
            .http
            .post(self.url(path))
            .header(CONTENT_TYPE, "application/json")
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn post_empty(&self, path: &str) -> DockerResult<()> {
        let resp = self.http.post(self.url(path)).send().await?;
        self.check_status(resp).await
    }

    pub async fn post_text(&self, path: &str) -> DockerResult<String> {
        let resp = self.http.post(self.url(path)).send().await?;
        self.handle_text_response(resp).await
    }

    pub async fn put_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &impl serde::Serialize,
    ) -> DockerResult<T> {
        let resp = self
            .http
            .put(self.url(path))
            .header(CONTENT_TYPE, "application/json")
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn delete(&self, path: &str) -> DockerResult<()> {
        let resp = self.http.delete(self.url(path)).send().await?;
        self.check_status(resp).await
    }

    pub async fn delete_with_query(&self, path: &str, query: &[(&str, &str)]) -> DockerResult<()> {
        let resp = self.http.delete(self.url(path)).query(query).send().await?;
        self.check_status(resp).await
    }

    // ── Response handlers ─────────────────────────────────────────

    async fn handle_response<T: serde::de::DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> DockerResult<T> {
        let status = resp.status().as_u16();
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status, &body));
        }
        let text = resp.text().await?;
        serde_json::from_str(&text).map_err(|e| {
            DockerError::with_details(DockerErrorKind::ParseError, e.to_string(), text)
        })
    }

    async fn handle_text_response(&self, resp: reqwest::Response) -> DockerResult<String> {
        let status = resp.status().as_u16();
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status, &body));
        }
        Ok(resp.text().await?)
    }

    async fn check_status(&self, resp: reqwest::Response) -> DockerResult<()> {
        let status = resp.status().as_u16();
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status, &body));
        }
        Ok(())
    }

    fn map_status_error(&self, status: u16, body: &str) -> DockerError {
        // Try to extract message from {"message":"..."} JSON
        let msg = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or_else(|| body.to_string());

        match status {
            304 => DockerError::other(&format!("Not modified: {}", msg)),
            400 => DockerError::validation(&msg),
            401 => DockerError::auth(&msg),
            403 => DockerError::forbidden(&msg),
            404 => DockerError::not_found(&msg),
            409 => DockerError::conflict(&msg),
            500 => DockerError::api(500, &msg),
            503 => DockerError::connection(&format!("Service unavailable: {}", msg)),
            _ => DockerError::api(status, &msg),
        }
    }

    // ── Convenience ───────────────────────────────────────────────

    /// Ping the Docker daemon.
    pub async fn ping(&self) -> DockerResult<bool> {
        let resp = self
            .http
            .get(format!("{}/_ping", self.base_url))
            .send()
            .await?;
        Ok(resp.status().is_success())
    }

    /// Get Docker version.
    pub async fn version(&self) -> DockerResult<DockerVersionInfo> {
        self.get("/version").await
    }

    /// Get Docker system info.
    pub async fn info(&self) -> DockerResult<DockerSystemInfo> {
        self.get("/info").await
    }
}
