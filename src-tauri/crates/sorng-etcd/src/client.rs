// ── sorng-etcd/src/client.rs ─────────────────────────────────────────────────
//! HTTP client wrapping the etcd v3 gRPC-gateway REST API.

use crate::error::{EtcdError, EtcdResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

/// HTTP client for a single etcd cluster connection.
pub struct EtcdClient {
    pub config: EtcdConnectionConfig,
    base_url: String,
    http: HttpClient,
    auth_token: Option<String>,
}

impl EtcdClient {
    /// Build a new client from config and optionally authenticate.
    pub async fn new(config: EtcdConnectionConfig) -> EtcdResult<Self> {
        let scheme = if config.tls { "https" } else { "http" };
        let base_url = format!("{}://{}:{}", scheme, config.host, config.port);

        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(config.tls_skip_verify.unwrap_or(false))
            .build()
            .map_err(|e| EtcdError::connection(format!("http client build: {e}")))?;

        let mut client = Self {
            auth_token: config.auth_token.clone(),
            config,
            base_url,
            http,
        };

        // If username/password provided but no token, authenticate.
        if client.auth_token.is_none() {
            if let (Some(ref user), Some(ref pass)) = (&client.config.username, &client.config.password) {
                let token = client.authenticate(user, pass).await?;
                client.auth_token = Some(token);
            }
        }

        Ok(client)
    }

    // ── URL helpers ──────────────────────────────────────────────────

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    // ── Auth ─────────────────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(ref token) = self.auth_token {
            req.header("Authorization", token.as_str())
        } else {
            req
        }
    }

    async fn authenticate(&self, name: &str, password: &str) -> EtcdResult<String> {
        let body = serde_json::json!({
            "name": name,
            "password": password,
        });
        let url = self.url("/v3/auth/authenticate");
        let resp = self.http.post(&url).json(&body).send().await?;
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(EtcdError::auth(format!("Authentication failed: {text}")));
        }
        let val: serde_json::Value = resp.json().await?;
        val["token"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| EtcdError::auth("No token in auth response"))
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn post_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> EtcdResult<T> {
        let url = self.url(path);
        debug!("ETCD POST {url}");
        let resp = self
            .apply_auth(self.http.post(&url))
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn post_empty<T: DeserializeOwned>(&self, path: &str) -> EtcdResult<T> {
        let url = self.url(path);
        debug!("ETCD POST {url}");
        let resp = self
            .apply_auth(self.http.post(&url))
            .json(&serde_json::json!({}))
            .send()
            .await?;
        self.handle_response(resp).await
    }

    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> EtcdResult<T> {
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(self.map_http_error(status.as_u16(), &text));
        }
        let body = resp.text().await?;
        serde_json::from_str(&body).map_err(|e| {
            EtcdError::internal(format!("Failed to parse response: {e}"))
        })
    }

    fn map_http_error(&self, status: u16, body: &str) -> EtcdError {
        match status {
            401 => EtcdError::auth(format!("Unauthorized: {body}")),
            403 => EtcdError::permission_denied(format!("Forbidden: {body}")),
            408 => EtcdError::timeout(format!("Request timeout: {body}")),
            413 => EtcdError::new(
                crate::error::EtcdErrorKind::RequestTooLarge,
                format!("Request too large: {body}"),
            ),
            429 => EtcdError::new(
                crate::error::EtcdErrorKind::TooManyRequests,
                format!("Rate limited: {body}"),
            ),
            503 => EtcdError::cluster_unavailable(format!("Cluster unavailable: {body}")),
            _ => EtcdError::internal(format!("HTTP {status}: {body}")),
        }
    }

    // ── Status / ping ────────────────────────────────────────────────

    pub async fn get_status(&self) -> EtcdResult<EtcdStatusResponse> {
        self.post_empty("/v3/maintenance/status").await
    }

    pub async fn get_connection_summary(&self, id: &str) -> EtcdResult<EtcdConnectionSummary> {
        let status: EtcdStatusResponse = self.get_status().await?;
        Ok(EtcdConnectionSummary {
            id: id.to_string(),
            endpoints: self
                .config
                .endpoints
                .clone()
                .unwrap_or_else(|| vec![format!("{}:{}", self.config.host, self.config.port)]),
            version: status.version,
            leader_id: status.leader,
            cluster_id: 0,
            connected_at: chrono::Utc::now().to_rfc3339(),
        })
    }
}
