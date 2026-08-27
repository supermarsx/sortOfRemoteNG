// ── sorng-budibase/src/client.rs ───────────────────────────────────────────────
//! Budibase REST API HTTP client.

use crate::error::{BudibaseError, BudibaseResult};
use crate::types::*;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use sorng_tls_trust::{build_tofu_client, skip_flag_to_override, TofuTlsContext};
use std::time::Duration;

/// Split the configured host into the `(host, port)` pair that keys its Trust
/// Center record (`tls:host:port`). Falls back to the HTTPS port for a bare
/// host, and tolerates IPv6 literals.
///
/// IPv6 brackets are stripped so both the URL and the bare-authority branch
/// produce the same record key — `sorng_tls_trust` canonicalises brackets away
/// when it compares the handshake name, but the key itself is the raw host.
fn canonical_host_port(raw: &str) -> (String, u16) {
    let trimmed = raw.trim().trim_end_matches('/');

    if let Ok(url) = url::Url::parse(trimmed) {
        if let Some(host) = url.host_str() {
            let default_port = if url.scheme() == "http" { 80 } else { 443 };
            return (unbracket(host), url.port().unwrap_or(default_port));
        }
    }

    let without_scheme = trimmed
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    let authority = without_scheme.split('/').next().unwrap_or(without_scheme);

    if let Some((host, port_str)) = authority.rsplit_once(':') {
        // Only a cleanly-parsing suffix is a port — `[::1]` must not be split.
        if let Ok(port) = port_str.parse::<u16>() {
            if !host.is_empty() {
                return (unbracket(host), port);
            }
        }
    }

    (unbracket(authority), 443)
}

/// Strip the `[...]` wrapper from an IPv6 literal host.
fn unbracket(host: &str) -> String {
    host.strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(host)
        .to_string()
}

/// Budibase API client wrapping reqwest.
pub struct BudibaseClient {
    pub http: reqwest::Client,
    pub base_url: String,
    pub api_key: String,
    pub app_id: Option<String>,
}

impl BudibaseClient {
    /// Build a client from a connection config.
    pub fn from_config(config: &BudibaseConnectionConfig) -> BudibaseResult<Self> {
        let effective_tls_skip = config.skip_tls_verify
            && config
                .host
                .trim()
                .get(..8)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"));
        if effective_tls_skip != config.acknowledge_invalid_cert_risk {
            return Err(BudibaseError::connection(
                "TLS certificate verification bypass requires an explicit runtime acknowledgement for this connection attempt",
            ));
        }

        let mut builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_seconds.unwrap_or(30)));

        if effective_tls_skip {
            log::warn!(
                "TLS certificate verification for Budibase connection to {} is running under an \
                 explicit Trust Center AlwaysTrust override; revoke the record in the Trust \
                 Center to undo it",
                config.host
            );
        }

        if let Some(proxy_url) = config
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|e| BudibaseError::connection(&format!("invalid proxy URL: {e}")))?;
            builder = builder.proxy(proxy);
        }

        // Route the server-certificate decision through the Trust Center
        // (t62). Default is Trust-On-First-Use: the leaf is pinned on first
        // connect and a later mismatch is rejected as a possible MITM. The
        // legacy skip flag no longer disables verification — it maps to an
        // explicit, revocable `AlwaysTrust` policy override.
        let (host, port) = canonical_host_port(&config.host);
        let ctx = TofuTlsContext::shared(host, port, skip_flag_to_override(effective_tls_skip));
        let http = build_tofu_client(builder, ctx).map_err(|e| BudibaseError::connection(&e))?;

        // Normalise base URL (strip trailing slash)
        let base_url = config.host.trim_end_matches('/').to_string();

        Ok(Self {
            http,
            base_url,
            api_key: config.api_key.clone(),
            app_id: config.app_id.clone(),
        })
    }

    /// Build the default headers for Budibase API requests.
    fn default_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-budibase-api-key",
            HeaderValue::from_str(&self.api_key).unwrap_or_else(|_| HeaderValue::from_static("")),
        );
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(ref app_id) = self.app_id {
            headers.insert(
                "x-budibase-app-id",
                HeaderValue::from_str(app_id).unwrap_or_else(|_| HeaderValue::from_static("")),
            );
        }
        headers
    }

    /// Build a full URL for an API endpoint.
    pub fn url(&self, path: &str) -> String {
        format!("{}/api/public/v1{}", self.base_url, path)
    }

    /// Build a full URL for an internal API endpoint.
    pub fn internal_url(&self, path: &str) -> String {
        format!("{}/api{}", self.base_url, path)
    }

    // ── GET ──────────────────────────────────────────────────────────

    pub async fn get(&self, path: &str) -> BudibaseResult<serde_json::Value> {
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
    ) -> BudibaseResult<serde_json::Value> {
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

    // ── POST ─────────────────────────────────────────────────────────

    pub async fn post(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> BudibaseResult<serde_json::Value> {
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

    pub async fn post_empty(&self, path: &str) -> BudibaseResult<serde_json::Value> {
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
    ) -> BudibaseResult<serde_json::Value> {
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

    // ── DELETE ────────────────────────────────────────────────────────

    pub async fn delete(&self, path: &str) -> BudibaseResult<serde_json::Value> {
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

    async fn handle_response(&self, resp: reqwest::Response) -> BudibaseResult<serde_json::Value> {
        let status = resp.status().as_u16();
        if (200..300).contains(&status) {
            let text = resp.text().await.unwrap_or_default();
            if text.is_empty() {
                return Ok(serde_json::Value::Null);
            }
            serde_json::from_str(&text)
                .map_err(|e| BudibaseError::parse(&format!("Invalid JSON response: {e}")))
        } else {
            let body = resp.text().await.unwrap_or_default();
            match status {
                401 => Err(BudibaseError::auth(&format!(
                    "Authentication failed: {body}"
                ))),
                403 => Err(BudibaseError::forbidden(&format!("Forbidden: {body}"))),
                404 => Err(BudibaseError::not_found(&format!("Not found: {body}"))),
                409 => Err(BudibaseError::conflict(&format!("Conflict: {body}"))),
                429 => Err(BudibaseError::rate_limited(&format!(
                    "Rate limited: {body}"
                ))),
                _ => Err(BudibaseError::api(
                    status,
                    &format!("API error {status}: {body}"),
                )),
            }
        }
    }

    /// Quick connectivity check.
    pub async fn ping(&self) -> BudibaseResult<BudibaseConnectionStatus> {
        // Try to fetch apps as a health check
        let result = self.get("/applications?limit=1").await;
        match result {
            Ok(_) => Ok(BudibaseConnectionStatus {
                connected: true,
                host: self.base_url.clone(),
                version: None,
                tenant_id: None,
            }),
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tls_trust_tests {
    use super::*;

    // ── decision mapping ────────────────────────────────────────────────
    //
    // `skipTlsVerify` no longer disables verification: it selects the explicit
    // `AlwaysTrust` Trust Center override, and only for an https:// host.
    // Unset defers to the store's effective policy (`None` => TOFU by default).

    fn effective_skip(host: &str, skip: bool) -> bool {
        skip && host
            .trim()
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
    }

    #[test]
    fn skip_tls_verify_on_an_https_host_maps_to_an_always_trust_override() {
        assert!(skip_flag_to_override(effective_skip("https://bb.example.test", true)).is_some());
    }

    #[test]
    fn skip_tls_verify_on_a_plain_http_host_is_inert() {
        assert!(!effective_skip("http://bb.example.test", true));
        assert!(skip_flag_to_override(effective_skip("http://bb.example.test", true)).is_none());
    }

    #[test]
    fn an_unset_flag_defers_to_the_store_policy() {
        assert!(skip_flag_to_override(effective_skip("https://bb.example.test", false)).is_none());
    }

    // ── record key derivation ───────────────────────────────────────────

    #[test]
    fn an_explicit_port_is_part_of_the_record_key() {
        assert_eq!(
            canonical_host_port("https://bb.example.test:10000"),
            ("bb.example.test".to_string(), 10000)
        );
    }

    #[test]
    fn a_trailing_slash_and_path_are_stripped() {
        assert_eq!(
            canonical_host_port("https://bb.example.test/builder/"),
            ("bb.example.test".to_string(), 443)
        );
    }

    #[test]
    fn a_scheme_default_port_is_used_when_none_is_given() {
        assert_eq!(
            canonical_host_port("http://bb.example.test"),
            ("bb.example.test".to_string(), 80)
        );
    }

    #[test]
    fn a_bare_host_defaults_to_the_https_port() {
        assert_eq!(
            canonical_host_port("bb.example.test"),
            ("bb.example.test".to_string(), 443)
        );
    }

    #[test]
    fn an_ipv6_literal_is_not_split_on_its_own_colons() {
        assert_eq!(
            canonical_host_port("https://[::1]:10000"),
            ("::1".to_string(), 10000)
        );
    }
}
