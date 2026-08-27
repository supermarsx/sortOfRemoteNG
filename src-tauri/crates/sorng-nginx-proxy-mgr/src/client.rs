// ── sorng-nginx-proxy-mgr – REST API client ─────────────────────────────────
//! HTTP client wrapping the Nginx Proxy Manager REST API (`{api_url}/api`).
//!
//! Auth modes:
//! * **Password** — `POST /api/tokens {identity,secret}` → `{token,expires}`.
//!   The `expires` timestamp is tracked; the token is refreshed pre-emptively
//!   via `GET /api/tokens` shortly before expiry and re-obtained by a single
//!   transparent re-login after a `401`.
//! * **Token** — a pre-supplied bearer token; refreshed the same way, but a
//!   `401` that survives one refresh surfaces as `TokenExpired`.
//!
//! TLS goes through the Trust Center TOFU verifier
//! ([`sorng_tls_trust::build_tofu_client`]) for `https://` endpoints. The
//! `skip_tls_verify` flag is honoured only together with an explicit
//! `acknowledge_invalid_cert_risk` and maps to a revocable `AlwaysTrust`
//! override — signature/chain crypto is never blindly disabled.

use crate::error::{NpmError, NpmErrorKind, NpmResult};
use crate::types::*;
use chrono::{DateTime, Utc};
use log::debug;
use reqwest::header::AUTHORIZATION;
use reqwest::{Method, StatusCode};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::RwLock;

/// Refresh the token when it has less than this many seconds left.
pub const TOKEN_REFRESH_MARGIN_SECS: i64 = 60;

/// Tauri bundle identifier — the `app_data_dir()` segment under which the
/// shared Trust Center store lives. Must match `src-tauri/tauri.conf.json`.
const APP_IDENTIFIER: &str = "com.sortofremote.ng";

/// Process-global slot holding the Trust Center store path (see the Hetzner
/// client for the rationale). When unset, [`resolve_trust_store_path`] falls
/// back to the canonical `app_data_dir()` layout — identical path — so the
/// client stays coherent even if startup wiring has not run yet.
static TRUST_STORE_PATH: OnceLock<std::path::PathBuf> = OnceLock::new();

/// Initialize the Trust Center store path used by the TOFU TLS verifier.
/// Call once at app startup with `app.path().app_data_dir()`. Idempotent —
/// only the first call wins.
pub fn init_trust_store_path(app_data_dir: std::path::PathBuf) {
    let _ = TRUST_STORE_PATH.set(app_data_dir.join("trust_store.json"));
}

fn resolve_trust_store_path() -> std::path::PathBuf {
    if let Some(path) = TRUST_STORE_PATH.get() {
        return path.clone();
    }
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_IDENTIFIER)
        .join("trust_store.json")
}

/// Normalise the configured API URL: trims whitespace, strips trailing
/// slashes, and requires an explicit `http://` / `https://` scheme.
pub fn normalize_api_url(raw: &str) -> NpmResult<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(NpmError::config(
            "api_url is required (e.g. http://host:81)",
        ));
    }
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(NpmError::config(format!(
            "api_url must start with http:// or https:// (got {trimmed:?})"
        )));
    }
    let url = reqwest::Url::parse(trimmed)
        .map_err(|e| NpmError::config(format!("invalid api_url {trimmed:?}: {e}")))?;
    if url.host_str().is_none() {
        return Err(NpmError::config(format!(
            "api_url has no host: {trimmed:?}"
        )));
    }
    Ok(trimmed.to_string())
}

/// Whether the (normalised) URL uses TLS.
pub fn is_https(api_url: &str) -> bool {
    api_url
        .get(..8)
        .is_some_and(|p| p.eq_ignore_ascii_case("https://"))
}

/// Derive the canonical `(host, port)` the connection dials, so the Trust
/// Center record is keyed `tls:host:port` consistently.
pub fn canonical_host_port(api_url: &str) -> NpmResult<(String, u16)> {
    let url = reqwest::Url::parse(api_url)
        .map_err(|e| NpmError::config(format!("invalid api_url {api_url:?}: {e}")))?;
    let host = url
        .host_str()
        .ok_or_else(|| NpmError::config(format!("api_url has no host: {api_url:?}")))?
        .trim_matches(|c| c == '[' || c == ']')
        .to_string();
    let port = url
        .port_or_known_default()
        .unwrap_or(if is_https(api_url) { 443 } else { 80 });
    Ok((host, port))
}

/// The web-UI origin for "Open web UI": scheme + host + port of the API URL.
pub fn web_ui_url(api_url: &str) -> NpmResult<String> {
    let url = reqwest::Url::parse(api_url)
        .map_err(|e| NpmError::config(format!("invalid api_url {api_url:?}: {e}")))?;
    let origin = url.origin();
    if !origin.is_tuple() {
        return Err(NpmError::config(format!(
            "api_url has no origin: {api_url:?}"
        )));
    }
    Ok(origin.ascii_serialization())
}

/// Parse NPM's `expires` (ISO-8601 UTC, e.g. `2026-08-27T10:00:00.000Z`).
pub fn parse_expires(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw.trim())
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// True when a token expiring at `expires_at` should be refreshed at `now`.
/// Unknown expiry (`None`) never triggers a pre-emptive refresh.
pub fn needs_refresh(expires_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    match expires_at {
        Some(exp) => (exp - now).num_seconds() < TOKEN_REFRESH_MARGIN_SECS,
        None => false,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NpmAuthMode {
    Password,
    Token,
}

impl NpmAuthMode {
    pub fn as_str(self) -> &'static str {
        match self {
            NpmAuthMode::Password => "password",
            NpmAuthMode::Token => "token",
        }
    }
}

#[derive(Debug, Clone)]
struct TokenState {
    token: String,
    expires_at: Option<DateTime<Utc>>,
}

pub struct NpmClient {
    pub config: NpmConnectionConfig,
    http: reqwest::Client,
    base_url: String,
    https: bool,
    auth_mode: NpmAuthMode,
    token: RwLock<Option<TokenState>>,
}

impl std::fmt::Debug for NpmClient {
    /// Redacted: never prints the password, bearer token or proxy credentials.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NpmClient")
            .field("base_url", &self.base_url)
            .field("email", &self.config.email)
            .field("auth_mode", &self.auth_mode)
            .field("https", &self.https)
            .field(
                "password",
                &self.config.password.as_ref().map(|_| "<redacted>"),
            )
            .field("token", &self.config.token.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

impl NpmClient {
    /// Validate the configuration and build the HTTP client. No network I/O.
    pub fn new(config: NpmConnectionConfig) -> NpmResult<Self> {
        let base_url = normalize_api_url(&config.api_url)?;
        let https = is_https(&base_url);

        // Ack contract (Budibase/t64): the effective skip flag must be
        // matched by an explicit runtime acknowledgement.
        let effective_skip = config.skip_tls_verify.unwrap_or(false) && https;
        if effective_skip != config.acknowledge_invalid_cert_risk {
            return Err(NpmError::config(
                "TLS certificate verification bypass requires an explicit runtime acknowledgement for this connection attempt",
            ));
        }

        let has_password = matches!(
            (config.email.as_deref(), config.password.as_deref()),
            (Some(e), Some(_)) if !e.trim().is_empty()
        );
        let has_token = config
            .token
            .as_deref()
            .is_some_and(|t| !t.trim().is_empty());
        let auth_mode = if has_password {
            if has_token {
                debug!("NPM: both password and token supplied — password login wins");
            }
            NpmAuthMode::Password
        } else if has_token {
            NpmAuthMode::Token
        } else {
            return Err(NpmError::config(
                "Nginx Proxy Manager credentials required: provide email and password, or a bearer token",
            ));
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
                .map_err(|e| NpmError::config(format!("invalid proxy URL: {e}")))?;
            builder = builder.proxy(proxy);
        }

        let http = if https {
            if effective_skip {
                log::warn!("sorng-nginx-proxy-mgr: TLS trust override (AlwaysTrust) enabled for {base_url}");
            }
            let (host, port) = canonical_host_port(&base_url)?;
            let store: Arc<sorng_storage::trust_store::SyncTrustStore> = Arc::new(
                sorng_storage::trust_store::SyncTrustStore::new(resolve_trust_store_path()),
            );
            let ctx = sorng_tls_trust::TofuTlsContext {
                store,
                host,
                port,
                policy_override: sorng_tls_trust::skip_flag_to_override(effective_skip),
            };
            sorng_tls_trust::build_tofu_client(builder, ctx)
                .map_err(|e| NpmError::connection(format!("http client build: {e}")))?
        } else {
            builder
                .build()
                .map_err(|e| NpmError::connection(format!("http client build: {e}")))?
        };

        let initial = match auth_mode {
            NpmAuthMode::Token => config.token.as_deref().map(|t| TokenState {
                token: t.trim().to_string(),
                expires_at: None,
            }),
            NpmAuthMode::Password => None,
        };

        Ok(Self {
            config,
            http,
            base_url,
            https,
            auth_mode,
            token: RwLock::new(initial),
        })
    }

    pub fn auth_mode(&self) -> NpmAuthMode {
        self.auth_mode
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// The web-UI origin (`http://host:81`).
    pub fn web_ui_url(&self) -> NpmResult<String> {
        web_ui_url(&self.base_url)
    }

    fn api_url(&self, path: &str) -> String {
        format!("{}/api{}", self.base_url, path)
    }

    /// Current bearer token (if any).
    pub async fn current_token(&self) -> Option<String> {
        self.token.read().await.as_ref().map(|t| t.token.clone())
    }

    /// Current token expiry (if known).
    pub async fn token_expires_at(&self) -> Option<DateTime<Utc>> {
        self.token.read().await.as_ref().and_then(|t| t.expires_at)
    }

    // ── Auth ─────────────────────────────────────────────────────────

    async fn store_token(&self, resp: NpmTokenResponse) -> Option<DateTime<Utc>> {
        let expires_at = resp.expires.as_deref().and_then(parse_expires);
        if resp.expires.is_some() && expires_at.is_none() {
            debug!("NPM: unparsable token expiry {:?}", resp.expires);
        }
        *self.token.write().await = Some(TokenState {
            token: resp.token,
            expires_at,
        });
        expires_at
    }

    async fn send_raw(
        &self,
        req: reqwest::RequestBuilder,
        context: &str,
    ) -> NpmResult<(StatusCode, String)> {
        let resp = req
            .send()
            .await
            .map_err(|e| NpmError::from_reqwest(context, &e, self.https))?;
        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| NpmError::parse(format!("{context}: read body: {e}")))?;
        Ok((status, body))
    }

    /// `POST /api/tokens {identity, secret}` — password mode only.
    pub async fn login(&self) -> NpmResult<()> {
        let (email, password) = match (&self.config.email, &self.config.password) {
            (Some(e), Some(p)) if self.auth_mode == NpmAuthMode::Password => {
                (e.trim().to_string(), p.clone())
            }
            _ => {
                return Err(NpmError::config(
                    "login requires email and password (token mode cannot log in)",
                ))
            }
        };
        let url = self.api_url("/tokens");
        debug!("NPM POST /tokens (login)");
        let payload = NpmTokenPayload {
            identity: email,
            secret: password,
        };
        let (status, body) = self
            .send_raw(self.http.post(&url).json(&payload), "login")
            .await?;
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(NpmError::auth(format!(
                "login failed HTTP {}: invalid email or password",
                status.as_u16()
            )));
        }
        if !status.is_success() {
            return Err(NpmError::from_status(status.as_u16(), &body));
        }
        let token_resp: NpmTokenResponse = serde_json::from_str(&body)
            .map_err(|e| NpmError::parse(format!("token parse: {e}")))?;
        self.store_token(token_resp).await;
        Ok(())
    }

    /// `GET /api/tokens` with the current bearer — extends the token.
    pub async fn refresh_token(&self) -> NpmResult<()> {
        let current = self
            .current_token()
            .await
            .ok_or_else(|| NpmError::not_connected("no token to refresh"))?;
        let url = self.api_url("/tokens");
        debug!("NPM GET /tokens (refresh)");
        let (status, body) = self
            .send_raw(
                self.http
                    .get(&url)
                    .header(AUTHORIZATION, format!("Bearer {current}")),
                "refresh token",
            )
            .await?;
        if status == StatusCode::UNAUTHORIZED {
            return Err(NpmError::token_expired());
        }
        if !status.is_success() {
            return Err(NpmError::from_status(status.as_u16(), &body));
        }
        let token_resp: NpmTokenResponse = serde_json::from_str(&body)
            .map_err(|e| NpmError::parse(format!("token parse: {e}")))?;
        self.store_token(token_resp).await;
        Ok(())
    }

    /// Guarantee a usable token before an authenticated request: logs in if
    /// there is none, refreshes pre-emptively when close to expiry (falling
    /// back to a re-login when the refresh is rejected and a password exists).
    pub async fn ensure_token(&self) -> NpmResult<String> {
        let snapshot = self.token.read().await.clone();
        match snapshot {
            None => {
                self.login().await?;
            }
            Some(state) if needs_refresh(state.expires_at, Utc::now()) => {
                match self.refresh_token().await {
                    Ok(()) => {}
                    Err(e)
                        if e.kind == NpmErrorKind::TokenExpired
                            && self.auth_mode == NpmAuthMode::Password =>
                    {
                        debug!("NPM: refresh rejected, re-logging in");
                        self.login().await?;
                    }
                    Err(e) => return Err(e),
                }
            }
            Some(_) => {}
        }
        self.current_token()
            .await
            .ok_or_else(|| NpmError::not_connected("no token after login"))
    }

    /// Forget the token. NPM has no revocation endpoint.
    pub async fn logout(&self) {
        *self.token.write().await = None;
    }

    /// Recover from a `401`: password mode re-logs in, token mode tries one
    /// refresh. Returns the new token or `TokenExpired`.
    async fn recover_from_unauthorized(&self) -> NpmResult<String> {
        match self.auth_mode {
            NpmAuthMode::Password => {
                debug!("NPM: 401 — re-login and retry once");
                self.login().await.map_err(|e| {
                    if e.kind == NpmErrorKind::AuthenticationFailed {
                        e
                    } else {
                        NpmError::new(NpmErrorKind::TokenExpired, e.message)
                    }
                })?;
            }
            NpmAuthMode::Token => {
                debug!("NPM: 401 — refreshing token and retrying once");
                self.refresh_token().await?;
            }
        }
        self.current_token()
            .await
            .ok_or_else(NpmError::token_expired)
    }

    // ── Authenticated request core ───────────────────────────────────

    /// Build, authenticate and send a request, retrying exactly once after a
    /// `401`. `make` is called per attempt so multipart bodies can be rebuilt.
    async fn send_authed<F>(
        &self,
        method: Method,
        path: &str,
        make: F,
    ) -> NpmResult<(StatusCode, String)>
    where
        F: Fn(reqwest::RequestBuilder) -> reqwest::RequestBuilder,
    {
        let url = self.api_url(path);
        let context = format!("{method} {url}");
        let mut token = self.ensure_token().await?;
        for attempt in 0..2 {
            let req = make(self.http.request(method.clone(), &url))
                .header(AUTHORIZATION, format!("Bearer {token}"));
            debug!("NPM {context} (attempt {})", attempt + 1);
            let (status, body) = self.send_raw(req, &context).await?;
            if status == StatusCode::UNAUTHORIZED && attempt == 0 {
                token = self.recover_from_unauthorized().await?;
                continue;
            }
            return Ok((status, body));
        }
        Err(NpmError::token_expired())
    }

    fn finish<T: DeserializeOwned>(&self, status: StatusCode, body: String) -> NpmResult<T> {
        if status == StatusCode::UNAUTHORIZED {
            return Err(NpmError::token_expired());
        }
        if !status.is_success() {
            return Err(NpmError::from_status(status.as_u16(), &body));
        }
        let text = if body.trim().is_empty() {
            "null".to_string()
        } else {
            body
        };
        serde_json::from_str(&text).map_err(|e| {
            let excerpt: String = text.chars().take(512).collect();
            NpmError::parse(format!("json: {e}\nBody: {excerpt}"))
        })
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> NpmResult<T> {
        let (status, body) = self.send_authed(Method::GET, path, |r| r).await?;
        self.finish(status, body)
    }

    pub async fn get_vec<T: DeserializeOwned>(&self, path: &str) -> NpmResult<Vec<T>> {
        self.get(path).await
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> NpmResult<T> {
        let (status, text) = self
            .send_authed(Method::POST, path, |r| r.json(body))
            .await?;
        self.finish(status, text)
    }

    pub async fn put<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> NpmResult<T> {
        let (status, text) = self
            .send_authed(Method::PUT, path, |r| r.json(body))
            .await?;
        self.finish(status, text)
    }

    pub async fn delete(&self, path: &str) -> NpmResult<()> {
        let (status, body) = self.send_authed(Method::DELETE, path, |r| r).await?;
        if status == StatusCode::UNAUTHORIZED {
            return Err(NpmError::token_expired());
        }
        if !status.is_success() {
            return Err(NpmError::from_status(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn post_form_file(
        &self,
        path: &str,
        field: &str,
        filename: &str,
        data: Vec<u8>,
    ) -> NpmResult<serde_json::Value> {
        let (status, text) = self
            .send_authed(Method::POST, path, |r| {
                let part = reqwest::multipart::Part::bytes(data.clone())
                    .file_name(filename.to_string())
                    .mime_str("application/octet-stream")
                    .unwrap_or_else(|_| reqwest::multipart::Part::bytes(data.clone()));
                r.multipart(reqwest::multipart::Form::new().part(field.to_string(), part))
            })
            .await?;
        self.finish(status, text)
    }

    // ── Ping ─────────────────────────────────────────────────────────

    /// Unauthenticated `GET /api/` — liveness + version.
    pub async fn version(&self) -> NpmResult<Option<String>> {
        let url = self.api_url("/");
        let (status, body) = self.send_raw(self.http.get(&url), "GET /api/").await?;
        if !status.is_success() {
            return Err(NpmError::from_status(status.as_u16(), &body));
        }
        let parsed: NpmVersionResponse = serde_json::from_str(&body)
            .map_err(|e| NpmError::parse(format!("version parse: {e}")))?;
        Ok(parsed.version.map(|v| v.as_string()))
    }

    /// Version + identity summary; verifies the token really works.
    pub async fn ping(&self) -> NpmResult<NpmConnectionSummary> {
        let version = self.version().await?;
        let me: NpmUser = self.get("/users/me").await?;
        let token_expires_at = self.token_expires_at().await.map(|dt| dt.to_rfc3339());
        Ok(NpmConnectionSummary {
            api_url: self.base_url.clone(),
            user: Some(me.email),
            roles: me.roles.unwrap_or_default(),
            version,
            auth_mode: self.auth_mode.as_str().to_string(),
            token_expires_at,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration as ChronoDuration;

    fn cfg(api_url: &str) -> NpmConnectionConfig {
        NpmConnectionConfig {
            api_url: api_url.into(),
            email: Some("admin@example.com".into()),
            password: Some("changeme".into()),
            token: None,
            skip_tls_verify: None,
            acknowledge_invalid_cert_risk: false,
            timeout_secs: Some(2),
            proxy_url: None,
        }
    }

    #[test]
    fn url_normalisation() {
        assert_eq!(normalize_api_url(" http://h:81/ ").unwrap(), "http://h:81");
        assert_eq!(
            normalize_api_url("https://npm.example.com///").unwrap(),
            "https://npm.example.com"
        );
        assert_eq!(
            normalize_api_url("h:81").unwrap_err().kind,
            NpmErrorKind::ConfigError
        );
        assert_eq!(
            normalize_api_url("").unwrap_err().kind,
            NpmErrorKind::ConfigError
        );
    }

    #[test]
    fn host_port_and_web_ui() {
        assert_eq!(
            canonical_host_port("http://h:81").unwrap(),
            ("h".into(), 81)
        );
        assert_eq!(
            canonical_host_port("https://npm.example.com").unwrap(),
            ("npm.example.com".into(), 443)
        );
        assert_eq!(web_ui_url("http://h:81/api").unwrap(), "http://h:81");
        assert_eq!(
            web_ui_url("https://npm.example.com").unwrap(),
            "https://npm.example.com"
        );
    }

    #[test]
    fn expiry_parse_and_threshold() {
        let exp = parse_expires("2026-08-27T10:00:00.000Z").unwrap();
        assert_eq!(exp.to_rfc3339(), "2026-08-27T10:00:00+00:00");
        assert!(parse_expires("not a date").is_none());

        let now = Utc::now();
        assert!(!needs_refresh(None, now));
        assert!(!needs_refresh(Some(now + ChronoDuration::seconds(61)), now));
        assert!(needs_refresh(Some(now + ChronoDuration::seconds(59)), now));
        assert!(needs_refresh(Some(now - ChronoDuration::seconds(5)), now));
    }

    #[test]
    fn version_string_join() {
        let v = NpmVersion {
            major: 2,
            minor: 11,
            revision: 3,
        };
        assert_eq!(v.as_string(), "2.11.3");
    }

    #[test]
    fn no_credentials_is_config_error() {
        let mut c = cfg("http://h:81");
        c.email = None;
        c.password = None;
        let err = NpmClient::new(c).unwrap_err();
        assert_eq!(err.kind, NpmErrorKind::ConfigError);
    }

    #[test]
    fn token_mode_selected_without_password() {
        let mut c = cfg("http://h:81");
        c.email = None;
        c.password = None;
        c.token = Some("abc".into());
        let client = NpmClient::new(c).unwrap();
        assert_eq!(client.auth_mode(), NpmAuthMode::Token);
    }

    #[test]
    fn password_wins_over_token() {
        let mut c = cfg("http://h:81");
        c.token = Some("abc".into());
        assert_eq!(
            NpmClient::new(c).unwrap().auth_mode(),
            NpmAuthMode::Password
        );
    }

    #[test]
    fn skip_without_ack_is_config_error() {
        let mut c = cfg("https://npm.example.com");
        c.skip_tls_verify = Some(true);
        let err = NpmClient::new(c).unwrap_err();
        assert_eq!(err.kind, NpmErrorKind::ConfigError);
        assert!(err.message.contains("acknowledgement"));
    }

    #[test]
    fn ack_without_skip_is_config_error() {
        let mut c = cfg("https://npm.example.com");
        c.acknowledge_invalid_cert_risk = true;
        assert_eq!(
            NpmClient::new(c).unwrap_err().kind,
            NpmErrorKind::ConfigError
        );
    }

    #[test]
    fn skip_on_plain_http_is_ignored() {
        // skip only applies to https; ack must therefore be false.
        let mut c = cfg("http://h:81");
        c.skip_tls_verify = Some(true);
        assert!(NpmClient::new(c).is_ok());
    }

    #[test]
    fn skip_with_ack_builds_tofu_client() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let mut c = cfg("https://npm.example.com");
        c.skip_tls_verify = Some(true);
        c.acknowledge_invalid_cert_risk = true;
        assert!(NpmClient::new(c).is_ok());
    }

    #[test]
    fn invalid_proxy_is_config_error() {
        let mut c = cfg("http://h:81");
        c.proxy_url = Some("::not a url::".into());
        assert_eq!(
            NpmClient::new(c).unwrap_err().kind,
            NpmErrorKind::ConfigError
        );
    }

    #[test]
    fn debug_output_redacts_secrets() {
        let mut c = cfg("http://h:81");
        c.token = Some("super-secret-token".into());
        let client = NpmClient::new(c).unwrap();
        let dbg = format!("{client:?}");
        assert!(!dbg.contains("changeme"));
        assert!(!dbg.contains("super-secret-token"));
        assert!(dbg.contains("<redacted>"));
    }

    #[test]
    fn config_never_serializes_ack() {
        let mut c = cfg("http://h:81");
        c.acknowledge_invalid_cert_risk = true;
        let json = serde_json::to_string(&c).unwrap();
        assert!(!json.contains("acknowledge_invalid_cert_risk"));
        let back: NpmConnectionConfig = serde_json::from_str(&json).unwrap();
        assert!(!back.acknowledge_invalid_cert_risk);
    }
}
