// ── sorng-warpgate/src/client.rs ────────────────────────────────────────────
//! Warpgate admin REST API HTTP client.

use crate::error::{WarpgateError, WarpgateResult};
use crate::types::*;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, COOKIE};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use sorng_storage::trust_store::SyncTrustStore;
use sorng_tls_trust::{build_tofu_client, skip_flag_to_override, TofuTlsContext};

/// Tauri application identifier (`tauri.conf.json` `identifier`). Used to locate
/// the shared `<app_data_dir>/trust_store.json` the Trust Center uses, so the
/// records this client pins are coherent with the Trust Center UI.
const APP_IDENTIFIER: &str = "com.sortofremote.ng";

/// Resolve the path to the shared Trust Center store (`trust_store.json`).
///
/// Mirrors how `TrustStoreService` is registered in the app
/// (`<app_data_dir>/trust_store.json`). The Warpgate client builds its reqwest
/// client deep inside the crate with no access to Tauri app state, so — per the
/// t24 integration recipe — it constructs a `SyncTrustStore` pointed at the same
/// file the async `TrustStoreService` uses. An explicit `SORNG_TRUST_STORE_PATH`
/// env override wins (used by the state/command layer or tests to pin the path).
fn resolve_trust_store_path() -> PathBuf {
    if let Some(p) = std::env::var_os("SORNG_TRUST_STORE_PATH") {
        return PathBuf::from(p);
    }
    // Tauri's `app_data_dir()` on every platform resolves to
    // `<data_dir>/<identifier>` (Windows: RoamingAppData; macOS: Application
    // Support; Linux: XDG data home), matching `dirs::data_dir()`.
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join(APP_IDENTIFIER).join("trust_store.json")
}

/// Canonical `(host, port)` the connection actually dials, so the Trust Center
/// record is keyed `tls:host:port` and not duplicated. Strips any scheme prefix
/// and trailing path, and defaults the port (443 for HTTPS, 80 otherwise).
fn canonical_host_port(raw_host: &str) -> (String, u16) {
    let trimmed = raw_host.trim().trim_end_matches('/');

    // Try a full URL parse first (handles scheme + explicit port + path).
    if let Ok(url) = url::Url::parse(trimmed) {
        if let Some(host) = url.host_str() {
            let default_port = if url.scheme() == "http" { 80 } else { 443 };
            let port = url.port().unwrap_or(default_port);
            return (host.to_string(), port);
        }
    }

    // No scheme: strip any leading scheme-like prefix defensively, then split a
    // trailing `:port`.
    let without_scheme = trimmed
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    // Drop any path component.
    let authority = without_scheme.split('/').next().unwrap_or(without_scheme);

    if let Some((host, port_str)) = authority.rsplit_once(':') {
        // Guard against IPv6 literals like `[::1]` where the last `:` is part of
        // the address; only treat it as a port if it parses cleanly.
        if let Ok(port) = port_str.parse::<u16>() {
            if !host.is_empty() {
                return (host.to_string(), port);
            }
        }
    }

    // Bare host — default to the HTTPS port (Warpgate admin is HTTPS).
    (authority.to_string(), 443)
}

/// Warpgate API client wrapping reqwest.
pub struct WarpgateClient {
    pub http: reqwest::Client,
    pub base_url: String,
    pub username: String,
    pub password: String,
    /// Session cookie obtained after login.
    pub session_cookie: Option<String>,
}

impl WarpgateClient {
    /// Build a client from a connection config.
    pub fn from_config(config: &WarpgateConnectionConfig) -> WarpgateResult<Self> {
        let builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_seconds.unwrap_or(30)))
            .cookie_store(true);

        // Route TLS verification through the Trust Center with TOFU as the
        // default (was: unconditional `danger_accept_invalid_certs(true)` gated
        // by `skip_tls_verify`). The legacy `skip_tls_verify` flag now maps to
        // an explicit, revocable `AlwaysTrust` per-connection override; when it
        // is unset, the store's effective/global policy (default TOFU) governs.
        let (host, port) = canonical_host_port(&config.host);
        let store: Arc<SyncTrustStore> = Arc::new(SyncTrustStore::new(resolve_trust_store_path()));
        let ctx = TofuTlsContext {
            store,
            host,
            port,
            policy_override: skip_flag_to_override(config.skip_tls_verify),
        };
        let http = build_tofu_client(builder, ctx).map_err(|e| WarpgateError::connection(&e))?;
        let base_url = config.host.trim_end_matches('/').to_string();

        Ok(Self {
            http,
            base_url,
            username: config.username.clone(),
            password: config.password.clone(),
            session_cookie: None,
        })
    }

    /// Authenticate with the Warpgate admin API.
    pub async fn login(&mut self) -> WarpgateResult<()> {
        let url = format!("{}/@warpgate/api/auth/login", self.base_url);
        let body = serde_json::json!({
            "username": self.username,
            "password": self.password,
        });
        let resp = self
            .http
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await?;

        let status = resp.status().as_u16();
        if status == 401 {
            return Err(WarpgateError::auth("Invalid credentials"));
        }
        if status >= 300 {
            let body_text = resp.text().await.unwrap_or_default();
            return Err(WarpgateError::api(
                status,
                &format!("Login failed: {body_text}"),
            ));
        }

        // Extract session cookie from response
        if let Some(cookie_val) = resp.headers().get("set-cookie") {
            self.session_cookie = cookie_val.to_str().ok().map(|s| s.to_string());
        }

        Ok(())
    }

    /// Build the default headers for Warpgate admin API requests.
    fn default_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(ref cookie) = self.session_cookie {
            if let Ok(val) = HeaderValue::from_str(cookie) {
                headers.insert(COOKIE, val);
            }
        }
        headers
    }

    /// Build a full URL for a Warpgate admin API endpoint.
    pub fn url(&self, path: &str) -> String {
        format!("{}/@warpgate/admin/api{}", self.base_url, path)
    }

    // ── GET ──────────────────────────────────────────────────────────

    pub async fn get(&self, path: &str) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .get(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn get_with_params(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .get(&url)
            .headers(self.default_headers())
            .query(params)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn get_text(&self, path: &str) -> WarpgateResult<String> {
        let url = self.url(path);
        let resp = self
            .http
            .get(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        let status = resp.status().as_u16();
        if (200..300).contains(&status) {
            Ok(resp.text().await.unwrap_or_default())
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(self.map_error(status, &body))
        }
    }

    pub async fn get_bytes(&self, path: &str) -> WarpgateResult<Vec<u8>> {
        let url = self.url(path);
        let resp = self
            .http
            .get(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        let status = resp.status().as_u16();
        if (200..300).contains(&status) {
            Ok(resp.bytes().await.map(|b| b.to_vec()).unwrap_or_default())
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(self.map_error(status, &body))
        }
    }

    // ── POST ─────────────────────────────────────────────────────────

    pub async fn post(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .post(&url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn post_empty(&self, path: &str) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .post(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── PUT ──────────────────────────────────────────────────────────

    pub async fn put(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .put(&url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── PATCH ────────────────────────────────────────────────────────

    pub async fn patch(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .patch(&url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── DELETE ────────────────────────────────────────────────────────

    pub async fn delete(&self, path: &str) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .delete(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── Response handler ─────────────────────────────────────────────

    async fn handle_response(&self, resp: reqwest::Response) -> WarpgateResult<serde_json::Value> {
        let status = resp.status().as_u16();
        if (200..300).contains(&status) {
            let text = resp.text().await.unwrap_or_default();
            if text.is_empty() {
                return Ok(serde_json::Value::Null);
            }
            serde_json::from_str(&text)
                .map_err(|e| WarpgateError::parse(&format!("Invalid JSON response: {e}")))
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(self.map_error(status, &body))
        }
    }

    fn map_error(&self, status: u16, body: &str) -> WarpgateError {
        match status {
            401 => WarpgateError::auth(&format!("Authentication failed: {body}")),
            403 => WarpgateError::forbidden(&format!("Forbidden: {body}")),
            404 => WarpgateError::not_found(&format!("Not found: {body}")),
            409 => WarpgateError::conflict(&format!("Conflict: {body}")),
            429 => WarpgateError::rate_limited(&format!("Rate limited: {body}")),
            _ => WarpgateError::api(status, &format!("API error {status}: {body}")),
        }
    }

    /// Quick connectivity check – try to fetch parameters.
    pub async fn ping(&self) -> WarpgateResult<WarpgateConnectionStatus> {
        let result = self.get("/parameters").await;
        match result {
            Ok(_) => Ok(WarpgateConnectionStatus {
                connected: true,
                host: self.base_url.clone(),
                version: None,
            }),
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::canonical_host_port;

    #[test]
    fn https_url_with_explicit_port() {
        assert_eq!(
            canonical_host_port("https://warpgate.example.com:8888"),
            ("warpgate.example.com".to_string(), 8888)
        );
    }

    #[test]
    fn https_url_defaults_to_443() {
        assert_eq!(
            canonical_host_port("https://warpgate.example.com"),
            ("warpgate.example.com".to_string(), 443)
        );
    }

    #[test]
    fn http_url_defaults_to_80() {
        assert_eq!(
            canonical_host_port("http://warpgate.example.com"),
            ("warpgate.example.com".to_string(), 80)
        );
    }

    #[test]
    fn bare_host_defaults_to_443() {
        assert_eq!(
            canonical_host_port("warpgate.example.com"),
            ("warpgate.example.com".to_string(), 443)
        );
    }

    #[test]
    fn bare_host_with_port() {
        assert_eq!(
            canonical_host_port("warpgate.example.com:8888"),
            ("warpgate.example.com".to_string(), 8888)
        );
    }

    #[test]
    fn trailing_slash_and_path_stripped() {
        assert_eq!(
            canonical_host_port("https://warpgate.example.com:8888/admin/"),
            ("warpgate.example.com".to_string(), 8888)
        );
    }
}
