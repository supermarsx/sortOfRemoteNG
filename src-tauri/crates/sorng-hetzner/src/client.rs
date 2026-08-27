use crate::error::{HetznerError, HetznerResult};
use crate::types::HetznerConnectionConfig;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::de::DeserializeOwned;

const DEFAULT_BASE_URL: &str = "https://api.hetzner.cloud/v1";

/// Derive the canonical `(host, port)` the connection actually dials, so the
/// Trust Center record is keyed `tls:host:port` consistently. Strips the scheme
/// and defaults the port (443 for https, 80 for http).
fn canonical_host_port(base_url: &str) -> (String, u16) {
    match reqwest::Url::parse(base_url) {
        Ok(url) => {
            let host = url.host_str().unwrap_or("api.hetzner.cloud").to_string();
            let port = url.port_or_known_default().unwrap_or(443);
            (host, port)
        }
        Err(_) => ("api.hetzner.cloud".to_string(), 443),
    }
}

/// Hetzner Cloud API client with bearer token authentication.
pub struct HetznerClient {
    pub config: HetznerConnectionConfig,
    http: reqwest::Client,
    base_url: String,
}

impl HetznerClient {
    /// Create a new Hetzner API client from connection configuration.
    ///
    /// TLS certificate trust routes through the backend Trust Center with
    /// **TOFU as the default** ([`sorng_tls_trust::build_tofu_client`]). The
    /// legacy `tls_skip_verify` flag is preserved as an explicit, revocable
    /// escape hatch: when set, it maps to an `AlwaysTrust` per-connection
    /// override (the visible replacement for the old blind
    /// `danger_accept_invalid_certs(true)`); when unset, the store's effective
    /// policy (default TOFU) governs. Signature/chain crypto is never disabled
    /// — TOFU pins identity only.
    pub fn new(config: HetznerConnectionConfig) -> HetznerResult<Self> {
        let mut builder = reqwest::Client::builder();

        if let Some(timeout) = config.timeout_secs {
            builder = builder.timeout(std::time::Duration::from_secs(timeout));
        }

        let base_url = config
            .base_url
            .clone()
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());

        // Route TLS trust through the Trust Center (TOFU default). The legacy
        // `tls_skip_verify` flag maps to an explicit `AlwaysTrust` override.
        // The store is the active user database's trust file
        // (`databases/<id>.trust.json`), resolved through the process-global
        // trust runtime; with no database open the handshake fails closed.
        let (host, port) = canonical_host_port(&base_url);
        let ctx = sorng_tls_trust::TofuTlsContext::shared(
            host,
            port,
            sorng_tls_trust::skip_flag_to_override(config.tls_skip_verify == Some(true)),
        );
        let http = sorng_tls_trust::build_tofu_client(builder, ctx).map_err(|e| {
            HetznerError::connection_failed(format!("Failed to create HTTP client: {e}"))
        })?;

        Ok(Self {
            config,
            http,
            base_url,
        })
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
        if (200..300).contains(&status) {
            let body = response
                .text()
                .await
                .map_err(|e| HetznerError::http(format!("Failed to read response body: {e}")))?;
            serde_json::from_str(&body)
                .map_err(|e| HetznerError::parse(format!("Failed to parse response: {e}")))
        } else {
            let body = response.text().await.unwrap_or_default();
            match status {
                401 => Err(HetznerError::auth_failed(format!(
                    "Authentication failed: {body}"
                ))),
                403 => Err(HetznerError::auth_failed(format!("Forbidden: {body}"))),
                404 => Err(HetznerError::not_found(format!(
                    "Resource not found: {body}"
                ))),
                409 => Err(HetznerError::conflict(format!("Conflict: {body}"))),
                429 => Err(HetznerError::rate_limited(format!("Rate limited: {body}"))),
                500..=599 => Err(HetznerError::server_error(format!(
                    "Server error ({status}): {body}"
                ))),
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
        if (200..300).contains(&status) {
            Ok(())
        } else {
            let body = response.text().await.unwrap_or_default();
            match status {
                401 => Err(HetznerError::auth_failed(format!(
                    "Authentication failed: {body}"
                ))),
                404 => Err(HetznerError::not_found(format!(
                    "Resource not found: {body}"
                ))),
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

#[cfg(test)]
mod trust_runtime_tests {
    use super::*;
    use sorng_storage::trust_store::test_support::{
        install_active_runtime_for_tests, install_runtime_for_tests,
    };
    use sorng_storage::trust_store::{CertIdentity, Identity};
    use sorng_tls_trust::TofuTlsContext;

    fn tls_identity(fingerprint: &str) -> Identity {
        Identity::Tls(Box::new(CertIdentity {
            fingerprint: fingerprint.to_string(),
            subject: Some("CN=api.hetzner.cloud".into()),
            issuer: Some("CN=api.hetzner.cloud".into()),
            first_seen: "2026-01-01T00:00:00Z".into(),
            last_seen: "2026-01-01T00:00:00Z".into(),
            valid_from: None,
            valid_to: None,
            pem: None,
            serial: None,
            signature_algorithm: None,
            san: None,
            chain_fingerprints: Vec::new(),
            subject_cn: None,
            subject_org: None,
            subject_ou: None,
            subject_country: None,
            subject_state: None,
            subject_locality: None,
            subject_email: None,
            issuer_cn: None,
            issuer_org: None,
            issuer_country: None,
            key_algorithm: None,
            key_size: None,
            version: None,
            chain: None,
        }))
    }

    /// The context the client builds pins into the *active database's* trust
    /// file, not a global sidecar.
    #[test]
    fn pins_into_the_active_database_trust_file() {
        let dir = tempfile::tempdir().unwrap();
        let databases = dir.path().join("databases");
        let _guard = install_active_runtime_for_tests(databases.clone(), "hetzner-db");

        let (host, port) = canonical_host_port(DEFAULT_BASE_URL);
        assert_eq!((host.as_str(), port), ("api.hetzner.cloud", 443));
        let ctx = TofuTlsContext::shared(host, port, None);

        ctx.store
            .trust(
                "api.hetzner.cloud:443".into(),
                "tls".into(),
                tls_identity("bb22"),
                false,
            )
            .expect("pin into the active database");

        assert!(
            databases.join("hetzner-db.trust.json").exists(),
            "the pin must land in databases/<id>.trust.json"
        );
    }

    #[test]
    fn fails_closed_without_an_active_database() {
        let dir = tempfile::tempdir().unwrap();
        let _guard = install_runtime_for_tests(dir.path().join("databases"), None);

        let ctx = TofuTlsContext::shared("api.hetzner.cloud", 443, None);
        assert!(ctx
            .store
            .verify("api.hetzner.cloud:443", "tls", tls_identity("bb22"))
            .is_err());
    }
}
