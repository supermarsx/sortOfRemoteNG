// ── sorng-portainer/src/client.rs ────────────────────────────────────────────
//! HTTP client for the Portainer REST API (`{base_url}/api`).
//!
//! Auth modes:
//! * **API key** — `X-API-Key: <token>` on every request, no expiry.
//! * **Password** — `POST /api/auth` → JWT; the `exp` claim is read (no
//!   signature verification — we only need the expiry) and the token is
//!   refreshed transparently shortly before it expires, or once after a 401.
//!
//! TLS goes through the Trust Center TOFU verifier
//! ([`sorng_tls_trust::build_tofu_client`]) whenever a trust store is
//! injected; `None` yields a plain `reqwest` client (unit tests / plain http)
//! which still honours an acknowledged `skip_tls_verify`.

use crate::error::{PortainerError, PortainerErrorKind, PortainerResult};
use crate::types::*;
use base64::Engine;
use log::debug;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Method, StatusCode};
use serde::de::DeserializeOwned;
use serde::Serialize;
use sorng_tls_trust::{
    build_tofu_client, skip_flag_to_override, BlockingTrustStore, TofuTlsContext,
};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

/// Re-login when the JWT has less than this many seconds left.
pub const TOKEN_REFRESH_MARGIN_SECS: i64 = 60;
const API_KEY_HEADER: &str = "X-API-Key";

#[derive(Debug, Clone)]
struct TokenState {
    token: String,
    /// Unix seconds from the JWT `exp` claim (None when absent/unparseable).
    expires_at: Option<i64>,
    /// Best-effort identity from JWT claims (used when `/api/users/me` is 404).
    claim_username: Option<String>,
    claim_role: Option<u8>,
}

/// Claims we care about inside Portainer's JWT payload.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize)]
pub struct JwtClaims {
    pub exp: Option<i64>,
    pub id: Option<u64>,
    pub username: Option<String>,
    pub role: Option<u8>,
}

/// Decode the payload segment of a JWT **without** verifying the signature.
pub fn decode_jwt_claims(jwt: &str) -> Option<JwtClaims> {
    let payload = jwt.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// True when a token with the given expiry should be refreshed before use.
/// Tokens without an `exp` claim are treated as non-expiring.
pub fn token_needs_refresh(expires_at: Option<i64>, now: i64) -> bool {
    match expires_at {
        Some(exp) => exp - now < TOKEN_REFRESH_MARGIN_SECS,
        None => false,
    }
}

/// Normalise a user-supplied base URL: trim, strip trailing slashes and a
/// trailing `/api` segment (users often paste the API root).
pub fn normalize_base_url(raw: &str) -> PortainerResult<String> {
    let mut url = raw.trim().trim_end_matches('/').to_string();
    if url.to_ascii_lowercase().ends_with("/api") {
        url.truncate(url.len() - 4);
        url = url.trim_end_matches('/').to_string();
    }
    if url.is_empty() {
        return Err(PortainerError::config("baseUrl must not be empty"));
    }
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(PortainerError::config(
            "baseUrl must start with http:// or https://",
        ));
    }
    reqwest::Url::parse(&url)
        .map_err(|e| PortainerError::config(format!("invalid baseUrl: {e}")))?;
    Ok(url)
}

/// Canonical `(host, port)` for Trust Center keying (`tls:host:port`).
pub fn canonical_host_port(base_url: &str) -> PortainerResult<(String, u16)> {
    let url = reqwest::Url::parse(base_url)
        .map_err(|e| PortainerError::config(format!("invalid baseUrl: {e}")))?;
    let host = url
        .host_str()
        .ok_or_else(|| PortainerError::config("baseUrl has no host"))?
        .trim_matches(['[', ']'])
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| PortainerError::config("baseUrl has no port"))?;
    Ok((host, port))
}

pub struct PortainerClient {
    pub config: PortainerConnectionConfig,
    http: reqwest::Client,
    base_url: String,
    https: bool,
    auth_mode: PortainerAuthMode,
    token: RwLock<Option<TokenState>>,
}

/// Redacting `Debug`: the config carries the password / API key, so the
/// derived impl is deliberately not used — nothing secret may reach a log line.
impl std::fmt::Debug for PortainerClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PortainerClient")
            .field("base_url", &self.base_url)
            .field("https", &self.https)
            .field("auth_mode", &self.auth_mode)
            .field("username", &self.config.username)
            .field("skip_tls_verify", &self.config.skip_tls_verify)
            .field("timeout_secs", &self.config.timeout_secs)
            .field(
                "has_token",
                &self.token.try_read().map(|t| t.is_some()).ok(),
            )
            .finish_non_exhaustive()
    }
}

impl PortainerClient {
    /// Build a client. `Some` store routes TLS through the Trust Center TOFU
    /// verifier with the `skip_tls_verify` flag mapped to a revocable
    /// `AlwaysTrust` override. `None` gives a plain `reqwest` client that still
    /// honours an **acknowledged** `skip_tls_verify` by disabling certificate
    /// verification, so the escape hatch behaves identically on both paths.
    pub fn new(
        config: PortainerConnectionConfig,
        trust_store: Option<Arc<dyn BlockingTrustStore>>,
    ) -> PortainerResult<Self> {
        let base_url = normalize_base_url(&config.base_url)?;
        let https = base_url.to_ascii_lowercase().starts_with("https://");

        // Ack contract (Budibase): skip only counts for https, and the runtime
        // acknowledgement must match the effective skip flag.
        let effective_skip = config.skip_tls_verify.unwrap_or(false) && https;
        if effective_skip != config.acknowledge_invalid_cert_risk {
            return Err(PortainerError::config(
                "TLS certificate verification bypass requires an explicit runtime acknowledgement for this connection attempt",
            ));
        }

        let auth_mode = match (
            config
                .api_key
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
            config
                .username
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
            config.password.as_deref(),
        ) {
            (Some(_), _, _) => PortainerAuthMode::ApiKey,
            (None, Some(_), Some(_)) => PortainerAuthMode::Password,
            _ => return Err(PortainerError::config(
                "Portainer credentials required: provide an API key, or a username and password",
            )),
        };

        let mut builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .redirect(reqwest::redirect::Policy::none());

        if let Some(proxy_url) = config
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|e| PortainerError::config(format!("invalid proxy URL: {e}")))?;
            builder = builder.proxy(proxy);
        }

        let http = match trust_store {
            Some(store) if https => {
                if effective_skip {
                    log::warn!(
                        "sorng-portainer: TLS trust override (AlwaysTrust) enabled for {base_url}"
                    );
                }
                let (host, port) = canonical_host_port(&base_url)?;
                let ctx = TofuTlsContext {
                    store,
                    host,
                    port,
                    policy_override: skip_flag_to_override(effective_skip),
                };
                build_tofu_client(builder, ctx)
                    .map_err(|e| PortainerError::connection(format!("http client build: {e}")))?
            }
            // No Trust-Center store injected (unit tests, the docker-e2e
            // harness, plain http). The acknowledged skip flag still has to
            // mean what the panel toggle and docs/integrations.md say it means
            // — otherwise "Accept self-signed certificate" silently does
            // nothing on this path and the connection fails with
            // `TlsUntrusted` while the UI shows the override as enabled.
            // `effective_skip` implies https *and* a matching runtime
            // acknowledgement; the guard above returns `ConfigError` otherwise,
            // so this can never disable verification unasked. Same shape as
            // sorng-draytek's `client.rs:106-115`.
            _ => {
                if effective_skip {
                    log::warn!(
                        "sorng-portainer: certificate verification disabled for {base_url} \
                         (explicitly acknowledged; no Trust-Center store injected)"
                    );
                    builder = builder.danger_accept_invalid_certs(true);
                }
                builder
                    .build()
                    .map_err(|e| PortainerError::connection(format!("http client build: {e}")))?
            }
        };

        Ok(Self {
            config,
            http,
            base_url,
            https,
            auth_mode,
            token: RwLock::new(None),
        })
    }

    // ── Accessors ────────────────────────────────────────────────────

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn auth_mode(&self) -> PortainerAuthMode {
        self.auth_mode
    }

    pub fn api_url(&self, path: &str) -> String {
        format!("{}/api{}", self.base_url, path)
    }

    /// Current bearer token (password mode only).
    pub async fn current_token(&self) -> Option<String> {
        self.token.read().await.as_ref().map(|t| t.token.clone())
    }

    // ── Auth lifecycle ───────────────────────────────────────────────

    /// `POST /api/auth` and store the JWT. No-op in API-key mode.
    pub async fn login(&self) -> PortainerResult<()> {
        if self.auth_mode == PortainerAuthMode::ApiKey {
            return Ok(());
        }
        let payload = PortainerAuthPayload {
            username: self
                .config
                .username
                .clone()
                .unwrap_or_default()
                .trim()
                .to_string(),
            password: self.config.password.clone().unwrap_or_default(),
        };
        let url = self.api_url("/auth");
        debug!("Portainer POST /api/auth (login)");
        let resp = self
            .http
            .post(&url)
            .header(CONTENT_TYPE, HeaderValue::from_static("application/json"))
            .json(&payload)
            .send()
            .await
            .map_err(|e| PortainerError::from_reqwest("login", &e, self.https))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::UNPROCESSABLE_ENTITY {
            return Err(PortainerError::auth(format!(
                "Portainer rejected the username/password (HTTP {status})"
            )));
        }
        if !status.is_success() {
            return Err(PortainerError::from_status(status.as_u16(), &body, false));
        }
        let auth: PortainerAuthResponse = serde_json::from_str(&body)
            .map_err(|e| PortainerError::parse(format!("auth response: {e}")))?;
        let claims = decode_jwt_claims(&auth.jwt).unwrap_or_default();
        *self.token.write().await = Some(TokenState {
            token: auth.jwt,
            expires_at: claims.exp,
            claim_username: claims.username,
            claim_role: claims.role,
        });
        Ok(())
    }

    /// Make sure a usable token exists (password mode): logs in when there is
    /// none or when it is about to expire.
    pub async fn ensure_token(&self) -> PortainerResult<()> {
        if self.auth_mode == PortainerAuthMode::ApiKey {
            return Ok(());
        }
        let needs_login = match self.token.read().await.as_ref() {
            None => true,
            Some(t) => token_needs_refresh(t.expires_at, chrono::Utc::now().timestamp()),
        };
        if needs_login {
            self.login().await?;
        }
        Ok(())
    }

    /// Drop the cached token. Portainer has no server-side JWT revocation.
    pub async fn logout(&self) {
        *self.token.write().await = None;
    }

    async fn auth_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        match self.auth_mode {
            PortainerAuthMode::ApiKey => {
                let key = self.config.api_key.as_deref().unwrap_or_default().trim();
                if let Ok(v) = HeaderValue::from_str(key) {
                    headers.insert(API_KEY_HEADER, v);
                }
            }
            PortainerAuthMode::Password => {
                if let Some(t) = self.token.read().await.as_ref() {
                    if let Ok(v) = HeaderValue::from_str(&format!("Bearer {}", t.token)) {
                        headers.insert(AUTHORIZATION, v);
                    }
                }
            }
        }
        headers
    }

    // ── Core request path ────────────────────────────────────────────

    /// Send an authenticated request and return `(status, body bytes)`.
    /// On 401 in password mode, re-logs-in exactly once and retries; a second
    /// 401 surfaces as `TokenExpired`. Non-2xx statuses are returned as-is so
    /// callers can treat e.g. 304 as success.
    pub async fn send_raw(
        &self,
        method: Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> PortainerResult<(u16, Vec<u8>)> {
        self.ensure_token().await?;
        let url = self.api_url(path);
        let mut retried = false;
        loop {
            debug!("Portainer {method} {url}");
            let mut req = self
                .http
                .request(method.clone(), &url)
                .headers(self.auth_headers().await);
            if let Some(ref b) = body {
                req = req.json(b);
            }
            let resp = req.send().await.map_err(|e| {
                PortainerError::from_reqwest(&format!("{method} {path}"), &e, self.https)
            })?;
            let status = resp.status().as_u16();
            let bytes = resp
                .bytes()
                .await
                .map_err(|e| PortainerError::connection(format!("{method} {path}: {e}")))?
                .to_vec();
            if status == 401 && self.auth_mode == PortainerAuthMode::Password && !retried {
                debug!("Portainer 401 on {path}; re-login once");
                retried = true;
                self.logout().await;
                self.login().await?;
                continue;
            }
            return Ok((status, bytes));
        }
    }

    /// Send, require 2xx, and deserialise JSON.
    pub async fn request_json<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> PortainerResult<T> {
        let (status, bytes) = self.send_raw(method, path, body).await?;
        if !(200..300).contains(&status) {
            let text = String::from_utf8_lossy(&bytes);
            return Err(self.status_error(status, &text));
        }
        serde_json::from_slice(&bytes).map_err(|e| PortainerError::parse(format!("{path}: {e}")))
    }

    /// Send and accept any of `ok_statuses` as success (body discarded).
    pub async fn request_status(
        &self,
        method: Method,
        path: &str,
        body: Option<serde_json::Value>,
        ok_statuses: &[u16],
    ) -> PortainerResult<()> {
        let (status, bytes) = self.send_raw(method, path, body).await?;
        if ok_statuses.contains(&status) || (200..300).contains(&status) {
            return Ok(());
        }
        let text = String::from_utf8_lossy(&bytes);
        Err(self.status_error(status, &text))
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> PortainerResult<T> {
        self.request_json(Method::GET, path, None).await
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> PortainerResult<T> {
        let value = serde_json::to_value(body)
            .map_err(|e| PortainerError::internal(format!("serialise body: {e}")))?;
        self.request_json(Method::POST, path, Some(value)).await
    }

    fn status_error(&self, status: u16, body: &str) -> PortainerError {
        let api_key = self.auth_mode == PortainerAuthMode::ApiKey;
        let err = PortainerError::from_status(status, body, api_key);
        if err.kind == PortainerErrorKind::TokenExpired {
            // Password mode already retried once inside send_raw.
            return PortainerError::token_expired();
        }
        err
    }

    // ── Liveness / identity ──────────────────────────────────────────

    /// Unauthenticated version probe: `GET /api/system/status`, falling back
    /// to the pre-2.19 `GET /api/status` on 404.
    pub async fn system_status(&self) -> PortainerResult<PortainerStatusResponse> {
        for (idx, path) in ["/system/status", "/status"].iter().enumerate() {
            let url = self.api_url(path);
            debug!("Portainer GET {url}");
            let resp = self.http.get(&url).send().await.map_err(|e| {
                PortainerError::from_reqwest(&format!("GET {path}"), &e, self.https)
            })?;
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            if status == StatusCode::NOT_FOUND && idx == 0 {
                continue;
            }
            if !status.is_success() {
                return Err(PortainerError::from_status(status.as_u16(), &body, true));
            }
            return serde_json::from_str(&body)
                .map_err(|e| PortainerError::parse(format!("status response: {e}")));
        }
        Err(PortainerError::not_found(
            "Portainer status endpoint not found",
        ))
    }

    /// Authenticated identity: `GET /api/users/me`, tolerating 404 (older
    /// servers) by falling back to JWT claims / configured username.
    pub async fn whoami(&self) -> PortainerResult<(Option<String>, Option<u8>)> {
        let (status, bytes) = self.send_raw(Method::GET, "/users/me", None).await?;
        if (200..300).contains(&status) {
            let user: PortainerUserResponse = serde_json::from_slice(&bytes)
                .map_err(|e| PortainerError::parse(format!("/users/me: {e}")))?;
            return Ok((user.username, user.role));
        }
        if status == 404 {
            let guard = self.token.read().await;
            let (name, role) = match guard.as_ref() {
                Some(t) => (t.claim_username.clone(), t.claim_role),
                None => (None, None),
            };
            let name = name.or_else(|| self.config.username.clone());
            return Ok((name, role));
        }
        let text = String::from_utf8_lossy(&bytes);
        Err(self.status_error(status, &text))
    }

    /// Version + identity summary; also validates credentials.
    pub async fn ping(&self) -> PortainerResult<PortainerConnectionSummary> {
        let status = self.system_status().await?;
        self.ensure_token().await?;
        let (user, role) = self.whoami().await?;
        Ok(PortainerConnectionSummary {
            version: status.version,
            instance_id: status.instance_id,
            user,
            role,
            auth_mode: self.auth_mode,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(base: &str) -> PortainerConnectionConfig {
        PortainerConnectionConfig {
            base_url: base.into(),
            username: Some("admin".into()),
            password: Some("pw".into()),
            api_key: None,
            skip_tls_verify: None,
            acknowledge_invalid_cert_risk: false,
            timeout_secs: Some(5),
            proxy_url: None,
        }
    }

    fn jwt_with(payload: &str) -> String {
        let p = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload);
        format!("eyJhbGciOiJIUzI1NiJ9.{p}.sig")
    }

    #[test]
    fn decodes_exp_and_identity_claims() {
        let jwt = jwt_with(r#"{"id":1,"username":"admin","role":1,"exp":1700000000}"#);
        let claims = decode_jwt_claims(&jwt).unwrap();
        assert_eq!(claims.exp, Some(1_700_000_000));
        assert_eq!(claims.username.as_deref(), Some("admin"));
        assert_eq!(claims.role, Some(1));
        assert_eq!(claims.id, Some(1));
    }

    #[test]
    fn jwt_decode_tolerates_garbage() {
        assert!(decode_jwt_claims("not-a-jwt").is_none());
        assert!(decode_jwt_claims("a.!!!.c").is_none());
        let jwt = jwt_with("{}");
        assert_eq!(decode_jwt_claims(&jwt).unwrap(), JwtClaims::default());
    }

    #[test]
    fn expiry_threshold_is_sixty_seconds() {
        let now = 1_000_000;
        assert!(token_needs_refresh(Some(now + 59), now));
        assert!(!token_needs_refresh(Some(now + 60), now));
        assert!(token_needs_refresh(Some(now - 10), now));
        assert!(!token_needs_refresh(None, now));
    }

    #[test]
    fn normalises_base_url() {
        assert_eq!(
            normalize_base_url("https://h:9443/").unwrap(),
            "https://h:9443"
        );
        assert_eq!(
            normalize_base_url("  https://h:9443/api/ ").unwrap(),
            "https://h:9443"
        );
        assert_eq!(normalize_base_url("http://h").unwrap(), "http://h");
        assert_eq!(
            normalize_base_url("ftp://h").unwrap_err().kind,
            PortainerErrorKind::ConfigError
        );
        assert_eq!(
            normalize_base_url("   ").unwrap_err().kind,
            PortainerErrorKind::ConfigError
        );
    }

    #[test]
    fn api_url_has_single_api_prefix() {
        let c = PortainerClient::new(cfg("https://h:9443/"), None).unwrap();
        assert_eq!(c.api_url("/endpoints"), "https://h:9443/api/endpoints");
    }

    #[test]
    fn canonical_host_port_defaults_scheme_port() {
        assert_eq!(
            canonical_host_port("https://portainer.local").unwrap(),
            ("portainer.local".into(), 443)
        );
        assert_eq!(
            canonical_host_port("http://10.0.0.1:9000").unwrap(),
            ("10.0.0.1".into(), 9000)
        );
    }

    #[test]
    fn ack_contract_only_applies_to_https() {
        let mut c = cfg("https://h:9443");
        c.skip_tls_verify = Some(true);
        assert_eq!(
            PortainerClient::new(c.clone(), None).unwrap_err().kind,
            PortainerErrorKind::ConfigError
        );
        c.acknowledge_invalid_cert_risk = true;
        assert!(PortainerClient::new(c.clone(), None).is_ok());

        // http + skip: skip is ignored, so an ack would be a mismatch
        c.base_url = "http://h:9000".into();
        assert!(PortainerClient::new(c.clone(), None).is_err());
        c.acknowledge_invalid_cert_risk = false;
        assert!(PortainerClient::new(c, None).is_ok());
    }

    #[test]
    fn credentials_pick_api_key_over_password_and_require_something() {
        let mut c = cfg("http://h");
        c.api_key = Some("ptr_abc".into());
        assert_eq!(
            PortainerClient::new(c.clone(), None).unwrap().auth_mode(),
            PortainerAuthMode::ApiKey
        );
        c.api_key = None;
        assert_eq!(
            PortainerClient::new(c.clone(), None).unwrap().auth_mode(),
            PortainerAuthMode::Password
        );
        c.password = None;
        assert_eq!(
            PortainerClient::new(c, None).unwrap_err().kind,
            PortainerErrorKind::ConfigError
        );
    }

    #[test]
    fn invalid_proxy_url_is_config_error() {
        let mut c = cfg("http://h");
        c.proxy_url = Some("::not a url::".into());
        assert_eq!(
            PortainerClient::new(c, None).unwrap_err().kind,
            PortainerErrorKind::ConfigError
        );
    }
}
