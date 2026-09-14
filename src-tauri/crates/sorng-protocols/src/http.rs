//! HTTP connection service for fetching web pages with authentication.
//!
//! Provides functionality to fetch web content with various authentication methods
//! including basic auth, bearer tokens, and custom headers.

use serde::{Deserialize, Serialize};
pub use sha2::{Digest, Sha256};
pub use std::collections::HashMap;
use std::collections::VecDeque;
pub use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
pub use std::sync::Arc;
use std::sync::OnceLock;
use tokio::sync::Mutex;

#[path = "http_tls_ca.rs"]
mod tls_ca;
pub use tls_ca::{
    build_ca_pinned_tls_config, consume_ca_inspection_proof, CaValidationStatus, TlsCaValidation,
};

#[path = "http_proxy_transport.rs"]
mod proxy_transport;
pub use proxy_transport::fetch_tls_certificate_info;

#[path = "http_log_diagnostics.rs"]
mod log_diagnostics;
#[path = "http_proxy_policy.rs"]
mod proxy_policy;
#[path = "http_response.rs"]
mod proxy_response;
#[cfg(test)]
#[path = "http_response_tests.rs"]
mod proxy_response_tests;
#[path = "http_quickconnect.rs"]
mod quickconnect;
#[path = "http_quickconnect_control.rs"]
mod quickconnect_control;
pub use log_diagnostics::ProxyLogDiagnostic;
#[path = "http_attempt.rs"]
#[doc(hidden)]
pub mod attempt;
#[cfg(test)]
#[path = "http_request_log_tests.rs"]
mod request_log_tests;
#[cfg(test)]
#[path = "http_tls_test_fixture.rs"]
mod tls_test_fixture;
#[path = "http_web_automation.rs"]
mod web_automation;
pub use proxy_policy::{validate_custom_headers, CacheMode, HttpProxyPolicy, PageScripts};
#[path = "http_font_assets.rs"]
mod font_assets;
#[path = "http_digest.rs"]
mod http_digest;
#[path = "http_network_client.rs"]
mod network;
#[path = "http_redirect.rs"]
mod redirect;
#[path = "http_synology_login.rs"]
mod synology_login;
#[path = "http_synology_redirect_defaults.rs"]
mod synology_redirect_defaults;
#[path = "http_upstream.rs"]
mod upstream;
#[path = "http_websocket.rs"]
mod websocket;
pub use crate::webview_origins;
pub use network::ProxyNetworkState;
pub use redirect::ProxyRedirectReview;
pub use synology_redirect_defaults::SynologyQuickConnectDefaults;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};

/// Configuration for an HTTP connection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpConnectionConfig {
    /// Target URL
    pub url: String,
    /// HTTP method (GET, POST, etc.)
    #[serde(default = "default_method")]
    pub method: String,
    /// Authentication type
    #[serde(default)]
    pub auth_type: Option<String>,
    /// Username for basic auth
    #[serde(default)]
    pub username: Option<String>,
    /// Password for basic auth
    #[serde(default)]
    pub password: Option<String>,
    /// Bearer token
    #[serde(default)]
    pub bearer_token: Option<String>,
    /// Custom headers
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// Request body (for POST, PUT, etc.)
    #[serde(default)]
    pub body: Option<String>,
    /// Request timeout in seconds
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    /// Whether to follow redirects
    #[serde(default = "default_follow_redirects")]
    pub follow_redirects: bool,
    /// Whether to verify SSL certificates
    #[serde(default = "default_verify_ssl")]
    pub verify_ssl: bool,
    /// Minimum TLS version to accept ("1.2", "1.3").
    /// Defaults to "1.2".
    /// Note: the unified rustls backend only supports TLS 1.2+.
    #[serde(default = "default_min_tls_version")]
    pub min_tls_version: String,
}

pub fn default_method() -> String {
    "GET".to_string()
}

pub fn default_timeout() -> u64 {
    30
}

pub fn default_follow_redirects() -> bool {
    true
}

pub fn default_verify_ssl() -> bool {
    true
}

pub fn default_min_tls_version() -> String {
    "1.2".to_string()
}

/// Resolve a version string to a `reqwest::tls::Version`.
///
/// Accepted values: `"1.2"` and `"1.3"`.
/// Anything else falls back to TLS 1.2 because the rustls backend
/// used by this workspace does not support TLS 1.0/1.1.
pub fn resolve_min_tls_version(v: &str) -> reqwest::tls::Version {
    match v.trim() {
        "1.3" => reqwest::tls::Version::TLS_1_3,
        // default / unknown → TLS 1.2 (safe default)
        _ => reqwest::tls::Version::TLS_1_2,
    }
}

#[derive(Debug)]
pub struct NoCertificateVerification;

impl ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::ED25519,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
        ]
    }
}

#[derive(Debug)]
pub struct PinnedCertificateVerification {
    fingerprint: String,
}

impl PinnedCertificateVerification {
    pub fn new(fingerprint: String) -> Self {
        Self {
            fingerprint: normalize_cert_fingerprint(&fingerprint),
        }
    }
}

impl ServerCertVerifier for PinnedCertificateVerification {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let mut hasher = Sha256::new();
        hasher.update(end_entity.as_ref());
        let presented = hex::encode(hasher.finalize());
        if presented.eq_ignore_ascii_case(&self.fingerprint) {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(format!(
                "TLS certificate fingerprint mismatch: expected {}, got {}",
                self.fingerprint, presented
            )))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &rustls::crypto::aws_lc_rs::default_provider().signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &rustls::crypto::aws_lc_rs::default_provider().signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::aws_lc_rs::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

pub fn normalize_cert_fingerprint(fingerprint: &str) -> String {
    fingerprint
        .trim()
        .strip_prefix("SHA256:")
        .unwrap_or_else(|| fingerprint.trim())
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn validate_cert_fingerprint(fingerprint: &str) -> Result<(), String> {
    let value = fingerprint.trim();
    let value = value.strip_prefix("SHA256:").unwrap_or(value);
    if fingerprint.len() > 256
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b':' || byte.is_ascii_whitespace())
        || normalize_cert_fingerprint(fingerprint).len() != 64
    {
        return Err("Accepted TLS certificate fingerprint must be a SHA-256 hex digest".into());
    }
    Ok(())
}

pub fn build_pinned_tls_config(fingerprint: String) -> Result<rustls::ClientConfig, String> {
    validate_cert_fingerprint(&fingerprint)?;
    rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinnedCertificateVerification::new(fingerprint)))
        .with_no_client_auth()
        .pipe(Ok)
}

pub fn native_root_store() -> Result<rustls::RootCertStore, String> {
    let mut roots = rustls::RootCertStore::empty();
    let cert_result = rustls_native_certs::load_native_certs();
    for cert in cert_result.certs {
        roots
            .add(cert)
            .map_err(|e| format!("Native cert parse failed: {e}"))?;
    }
    Ok(roots)
}

pub fn build_dangerous_tls_config() -> Result<rustls::ClientConfig, String> {
    rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoCertificateVerification))
        .with_no_client_auth()
        .pipe(Ok)
}

trait Pipe: Sized {
    fn pipe<T>(self, f: impl FnOnce(Self) -> T) -> T {
        f(self)
    }
}

impl<T> Pipe for T {}

pub fn build_tls_config(verify: bool) -> Result<Arc<rustls::ClientConfig>, String> {
    let config = if verify {
        rustls::ClientConfig::builder()
            .with_root_certificates(native_root_store()?)
            .with_no_client_auth()
    } else {
        build_dangerous_tls_config()?
    };

    Ok(Arc::new(config))
}

pub fn tls_server_name(host: &str) -> Result<ServerName<'static>, String> {
    ServerName::try_from(host.to_owned()).map_err(|_| format!("Invalid TLS server name: {host}"))
}

pub fn peer_certificate_der(
    tls: &tokio_rustls::client::TlsStream<tokio::net::TcpStream>,
) -> Result<Vec<u8>, String> {
    tls.get_ref()
        .1
        .peer_certificates()
        .and_then(|certs| certs.first())
        .map(|cert| cert.as_ref().to_vec())
        .ok_or_else(|| "Server did not present a certificate".to_string())
}

/// Return the full certificate chain (all DER-encoded certificates).
pub fn peer_certificate_chain_der(
    tls: &tokio_rustls::client::TlsStream<tokio::net::TcpStream>,
) -> Vec<Vec<u8>> {
    tls.get_ref()
        .1
        .peer_certificates()
        .map(|certs| certs.iter().map(|c| c.as_ref().to_vec()).collect())
        .unwrap_or_default()
}

/// Response from an HTTP request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpResponse {
    /// HTTP status code
    pub status: u16,
    /// Response headers
    pub headers: HashMap<String, String>,
    /// Response body
    pub body: String,
    /// Content type
    pub content_type: Option<String>,
    /// Final URL after redirects
    pub final_url: String,
    /// Response time in milliseconds
    pub response_time_ms: u64,
}

/// HTTP Service for managing HTTP connections
#[derive(Clone)]
pub struct HttpService {
    #[allow(dead_code)]
    client: reqwest::Client,
}

impl HttpService {
    pub fn new() -> Arc<Mutex<Self>> {
        Arc::new(Mutex::new(Self {
            client: reqwest::Client::new(),
        }))
    }

    /// Fetch a URL with the given configuration
    pub async fn fetch(&self, config: HttpConnectionConfig) -> Result<HttpResponse, String> {
        let start_time = std::time::Instant::now();

        // Build client with custom settings
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout))
            .redirect(if config.follow_redirects {
                reqwest::redirect::Policy::limited(10)
            } else {
                reqwest::redirect::Policy::none()
            })
            .danger_accept_invalid_certs(!config.verify_ssl)
            .min_tls_version(resolve_min_tls_version(&config.min_tls_version))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        // Build request
        let method = match config.method.to_uppercase().as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            "HEAD" => reqwest::Method::HEAD,
            "PATCH" => reqwest::Method::PATCH,
            "OPTIONS" => reqwest::Method::OPTIONS,
            _ => return Err(format!("Unsupported HTTP method: {}", config.method)),
        };

        let mut request = client.request(method, &config.url);

        // Add authentication
        match config.auth_type.as_deref() {
            Some("basic") => {
                if let (Some(username), Some(password)) = (&config.username, &config.password) {
                    request = request.basic_auth(username, Some(password));
                }
            }
            Some("bearer") => {
                if let Some(token) = &config.bearer_token {
                    request = request.bearer_auth(token);
                }
            }
            _ => {}
        }

        // Add custom headers
        for (key, value) in &config.headers {
            request = request.header(key.as_str(), value.as_str());
        }

        // Add body if present
        if let Some(body) = &config.body {
            request = request.body(body.clone());
        }

        // Send request
        let response = request
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        let status = response.status().as_u16();
        let final_url = response.url().to_string();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let mut headers = HashMap::new();
        for (key, value) in response.headers() {
            if let Ok(v) = value.to_str() {
                headers.insert(key.to_string(), v.to_string());
            }
        }

        let body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response body: {}", e))?;

        let response_time_ms = start_time.elapsed().as_millis() as u64;

        Ok(HttpResponse {
            status,
            headers,
            body,
            content_type,
            final_url,
            response_time_ms,
        })
    }
}

impl Default for HttpService {
    fn default() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }
}

pub type HttpServiceState = Arc<Mutex<HttpService>>;

/// Closed set of credential formats the loopback mediator may inject upstream.
/// Omitted values remain HTTP Basic for backward compatibility with existing
/// web-browser sessions.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpstreamAuthMode {
    #[default]
    #[serde(rename = "basic")]
    Basic,
    #[serde(rename = "digest")]
    Digest,
    #[serde(rename = "header")]
    Header,
    /// Closed capability gate: old backends reject instead of generically filling.
    #[serde(rename = "bitwarden-form")]
    BitwardenForm,
    #[serde(rename = "synology-form")]
    SynologyForm,
    /// Form-only or manual application login: never inject proxy credentials
    /// into Authorization. Opted-in form fill may still consume them once.
    #[serde(rename = "none")]
    None,
    /// pfSense REST API v1 expects the non-standard exact header value
    /// `Authorization: <client-id> <client-secret>`.
    #[serde(rename = "pfSenseV1")]
    PfSenseV1,
}

impl UpstreamAuthMode {
    fn authorization_value(self, username: &str, password: &str) -> Option<String> {
        match self {
            Self::Basic
            | Self::Digest
            | Self::Header
            | Self::None
            | Self::BitwardenForm
            | Self::SynologyForm => None,
            Self::PfSenseV1 if !username.is_empty() && !password.is_empty() => {
                Some(format!("{username} {password}"))
            }
            Self::PfSenseV1 => None,
        }
    }

    /// The proxy manager historically displays Basic-auth usernames. API keys
    /// are credentials rather than user labels, so alternate auth modes must
    /// never expose the first credential field through status DTOs.
    pub fn manager_visible_username(self, username: &str) -> String {
        match self {
            Self::Basic | Self::Digest => username.to_string(),
            Self::PfSenseV1
            | Self::Header
            | Self::None
            | Self::BitwardenForm
            | Self::SynologyForm => String::new(),
        }
    }

    fn apply_credentials(
        self,
        request: reqwest::RequestBuilder,
        username: &str,
        password: &str,
    ) -> reqwest::RequestBuilder {
        match self {
            Self::Basic if !username.is_empty() || !password.is_empty() => {
                request.basic_auth(username, Some(password))
            }
            Self::PfSenseV1 => match self.authorization_value(username, password) {
                Some(value) => request.header(reqwest::header::AUTHORIZATION, value),
                None => request,
            },
            Self::Basic
            | Self::Digest
            | Self::Header
            | Self::None
            | Self::BitwardenForm
            | Self::SynologyForm => request,
        }
    }

    fn accepts_basic_challenge(self) -> bool {
        matches!(self, Self::Basic | Self::PfSenseV1)
    }
}

/// Runtime browser compatibility budget, never destination or TLS permission.
/// The renderer retains the original application's owner/identity provenance;
/// this closed value changes only the bounded same-origin redirect count.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrowserRedirectProfile {
    Synology,
}

pub fn same_origin_redirect_limit(profile: Option<BrowserRedirectProfile>) -> usize {
    match profile {
        Some(BrowserRedirectProfile::Synology) => 20,
        None => 10,
    }
}

/// Configuration for the authenticated loopback proxy mediator.
#[derive(Clone, Serialize, Deserialize)]
pub struct BasicAuthProxyConfig {
    /// The target URL to proxy requests to
    pub target_url: String,
    /// Username for basic authentication
    pub username: String,
    /// Password for basic authentication
    pub password: String,
    /// Credential format injected into upstream requests. Defaults to HTTP
    /// Basic when omitted. `none` disables automatic Authorization; pfSense
    /// REST API v1 uses `Authorization: <client-id> <client-secret>`.
    #[serde(default)]
    pub upstream_auth_mode: UpstreamAuthMode,
    #[serde(default)]
    pub proxy_policy: Option<HttpProxyPolicy>,
    /// Runtime-only original application profile; omitted legacy callers keep
    /// the ordinary ten-redirect same-origin limit.
    #[serde(default)]
    pub redirect_profile: Option<BrowserRedirectProfile>,
    /// One-use native continuation, never a persisted setting or log identity.
    #[serde(default)]
    pub continuation_id: Option<String>,
    #[serde(default)]
    pub custom_headers: HashMap<String, String>,
    /// Optional app-level HTTP(S) proxy used by the mediator for outbound
    /// requests. Credentials may be embedded in the URL; the value remains in
    /// private session state and is never exposed by proxy status DTOs.
    #[serde(default)]
    pub upstream_proxy_url: Option<String>,
    /// Local port to listen on (0 for auto-assign)
    #[serde(default)]
    pub local_port: u16,
    /// Whether to verify SSL certificates
    #[serde(default = "default_verify_ssl")]
    pub verify_ssl: bool,
    /// Optional SHA-256 certificate fingerprint accepted by the frontend trust prompt.
    /// When present, the proxy pins outbound TLS to this exact leaf certificate
    /// instead of disabling certificate verification for the whole session.
    #[serde(default)]
    pub accepted_cert_fingerprint: Option<String>,
    /// CA-auto admission keeps full native chain/name/time checks in addition
    /// to binding the real connection to the exact inspected leaf.
    #[serde(default)]
    pub require_ca_verification: bool,
    /// Minimum TLS version for outbound requests ("1.0", "1.1", "1.2", "1.3").
    /// Defaults to "1.2".  SSL 3.0 is NOT supported by the TLS backend.
    #[serde(default = "default_min_tls_version")]
    pub min_tls_version: String,
    /// Saved connection metadata. Each tab owns a separate returned session_id.
    #[serde(default)]
    pub connection_id: String,
    /// P7: snapshot of the frontend's live `:root --color-*` CSS
    /// variables. Forwarded into themed pages so they match the
    /// user's current theme. Optional: when absent, the proxy falls
    /// back to the dark-theme defaults in `theme_tokens::Default`.
    #[serde(default)]
    pub theme_tokens: Option<crate::theme_tokens::ThemeTokens>,
    /// t20: web auto-login arming for this proxy session. When `true`, the
    /// proxy auto-submits the session's saved `username`/`password` into the
    /// device's login form on connect (the mRemoteNG + cdp-auth behaviour).
    /// Defaults to `false` (disabled) — must be explicitly opted in per
    /// connection. No new plaintext credential is carried; auto-login reuses
    /// the existing `username`/`password` fields above, delivered only to this
    /// session's bound `target_origin`.
    #[serde(default)]
    pub http_auto_login: bool,
    /// t20: optional CSS-selector overrides for the auto-login form heuristic
    /// (the cdp-auth `field_id` / `field_name` analogue). When absent the
    /// backend falls back to its conservative auto-detection. Mirrors the
    /// frontend `HttpAutoLoginSelectors` field-for-field for serde
    /// compatibility.
    #[serde(default)]
    pub http_auto_login_selectors: Option<HttpAutoLoginSelectors>,
    #[serde(default)]
    pub http_form_automation: Option<crate::themed_autologin::HttpFormAutomation>,
}

impl std::fmt::Debug for BasicAuthProxyConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BasicAuthProxyConfig")
            .field("upstream_auth_mode", &self.upstream_auth_mode)
            .field("proxy_policy", &self.proxy_policy)
            .field("custom_header_count", &self.custom_headers.len())
            .field("http_auto_login", &self.http_auto_login)
            .finish_non_exhaustive()
    }
}

/// CSS-selector overrides for web auto-login form detection (t20).
///
/// Mirrors the frontend `HttpAutoLoginSelectors`
/// (`src/types/connection/connection.ts`) field-for-field. Every field is
/// optional; an omitted selector defers to the backend auto-detection
/// heuristic. Carries selectors only — never credential material.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HttpAutoLoginSelectors {
    /// CSS selector for the username/login input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username_selector: Option<String>,
    /// CSS selector for the password input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_selector: Option<String>,
    /// CSS selector for the submit control to click after filling.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submit_selector: Option<String>,
}

#[cfg(test)]
mod upstream_auth_mode_tests {
    use super::{
        collect_upstream_headers, permits_upstream_retry, proxy_request_headers_are_authorized,
        same_origin_redirect_limit, BasicAuthProxyConfig, BrowserRedirectProfile, UpstreamAuthMode,
    };

    #[test]
    fn incoming_application_authorization_survives_only_none_mode_pipeline() {
        let origin = "http://p0123456789abcdef0123456789abcdef.localhost:9000";
        let mut incoming = axum::http::HeaderMap::new();
        for (name, value) in [
            ("host", "p0123456789abcdef0123456789abcdef.localhost:9000"),
            ("origin", origin),
            ("authorization", "Bearer fixture-session"),
            ("proxy-authorization", "Basic never-forward"),
            ("cookie", "sid=fixture"),
        ] {
            incoming.insert(
                axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                value.parse().unwrap(),
            );
        }
        assert!(proxy_request_headers_are_authorized(
            &incoming,
            "p0123456789abcdef0123456789abcdef.localhost:9000",
            origin
        ));
        for (mode, expected) in [
            (UpstreamAuthMode::None, "Bearer fixture-session"),
            (UpstreamAuthMode::BitwardenForm, "Bearer fixture-session"),
            (UpstreamAuthMode::SynologyForm, "Bearer fixture-session"),
            (UpstreamAuthMode::Basic, "Basic YWRtaW46c2VjcmV0"),
            (UpstreamAuthMode::PfSenseV1, "admin secret"),
        ] {
            let headers = collect_upstream_headers(&incoming, mode, origin, "https://device.test");
            let mut request = mode.apply_credentials(
                reqwest::Client::new().get("https://device.test/api"),
                "admin",
                "secret",
            );
            for (name, value) in headers {
                request = request.header(&name, &value);
            }
            let request = request.build().unwrap();
            assert_eq!(request.headers()[reqwest::header::AUTHORIZATION], expected);
            assert_eq!(
                request.headers()[reqwest::header::ORIGIN],
                "https://device.test"
            );
            assert_eq!(request.headers()[reqwest::header::COOKIE], "sid=fixture");
            assert!(!request
                .headers()
                .contains_key(reqwest::header::PROXY_AUTHORIZATION));
            assert!(!request.headers().contains_key(reqwest::header::HOST));
        }
        incoming.insert(
            axum::http::header::ORIGIN,
            "https://untrusted.test".parse().unwrap(),
        );
        assert!(!proxy_request_headers_are_authorized(
            &incoming,
            "p0123456789abcdef0123456789abcdef.localhost:9000",
            origin
        ));
    }

    #[test]
    fn origin_is_serialized_without_a_path_while_referer_remains_a_url() {
        let proxy_origin = "http://p0123456789abcdef0123456789abcdef.localhost:9000";
        let authority = "p0123456789abcdef0123456789abcdef.localhost:9000";
        let mut incoming = axum::http::HeaderMap::new();
        incoming.insert(axum::http::header::HOST, authority.parse().unwrap());
        incoming.insert(axum::http::header::ORIGIN, proxy_origin.parse().unwrap());
        incoming.insert(
            axum::http::header::REFERER,
            format!("{proxy_origin}/login").parse().unwrap(),
        );
        for target_origin in [
            "http://device.test",
            "https://device.test",
            "https://device.test:8443",
            "http://[2001:db8::1]:8080",
        ] {
            assert!(proxy_request_headers_are_authorized(
                &incoming,
                authority,
                proxy_origin
            ));
            let forwarded: std::collections::HashMap<_, _> = collect_upstream_headers(
                &incoming,
                UpstreamAuthMode::None,
                proxy_origin,
                target_origin,
            )
            .into_iter()
            .collect();
            assert_eq!(forwarded["origin"], target_origin);
            assert_eq!(forwarded["referer"], format!("{target_origin}/"));
        }
        for invalid in [
            format!("{proxy_origin}/"),
            format!("{proxy_origin}.attacker.test"),
            "https://foreign.test".to_string(),
        ] {
            incoming.insert(axum::http::header::ORIGIN, invalid.parse().unwrap());
            assert!(!proxy_request_headers_are_authorized(
                &incoming,
                authority,
                proxy_origin
            ));
        }
    }

    #[test]
    fn upstream_retry_never_replays_login_posts_or_other_mutations() {
        for method in ["GET", "HEAD", "OPTIONS"] {
            assert!(permits_upstream_retry(&method.parse().unwrap()));
        }
        for method in [
            "POST", "PUT", "PATCH", "DELETE", "CONNECT", "TRACE", "CUSTOM",
        ] {
            assert!(!permits_upstream_retry(&method.parse().unwrap()));
        }
    }

    #[test]
    fn omitted_mode_remains_basic_and_unknown_modes_fail_closed() {
        let config: BasicAuthProxyConfig = serde_json::from_value(serde_json::json!({
            "target_url": "https://firewall.test/",
            "username": "client-id",
            "password": "client-secret"
        }))
        .expect("legacy proxy config should deserialize");
        assert_eq!(config.upstream_auth_mode, UpstreamAuthMode::Basic);
        assert!(!format!("{config:?}").contains("client-secret"));
        assert_eq!(
            config.upstream_auth_mode.manager_visible_username("admin"),
            "admin"
        );

        assert!(serde_json::from_str::<UpstreamAuthMode>(r#""bearer""#).is_err());
    }

    #[test]
    fn redirect_profile_is_closed_optional_runtime_budget_not_auth_or_destination_permission() {
        let legacy =
            serde_json::json!({"target_url":"https://device.test/", "username":"", "password":""});
        let decoded: BasicAuthProxyConfig = serde_json::from_value(legacy.clone()).unwrap();
        assert_eq!(decoded.redirect_profile, None);
        assert_eq!(same_origin_redirect_limit(decoded.redirect_profile), 10);
        for (value, expected) in [
            (serde_json::Value::Null, None),
            (
                serde_json::json!("synology"),
                Some(BrowserRedirectProfile::Synology),
            ),
        ] {
            let mut config = legacy.clone();
            config["redirect_profile"] = value;
            let decoded: BasicAuthProxyConfig = serde_json::from_value(config).unwrap();
            assert_eq!(decoded.redirect_profile, expected);
            assert_eq!(
                same_origin_redirect_limit(decoded.redirect_profile),
                if expected.is_some() { 20 } else { 10 }
            );
            assert_eq!(decoded.upstream_auth_mode, UpstreamAuthMode::Basic);
            assert!(decoded.verify_ssl);
            assert!(decoded.proxy_policy.is_none());
            assert!(!decoded.http_auto_login);
        }
        for value in [
            serde_json::json!("other"),
            serde_json::json!("Synology"),
            serde_json::json!(20),
            serde_json::json!(true),
            serde_json::json!({"synology":20}),
        ] {
            let mut config = legacy.clone();
            config["redirect_profile"] = value;
            assert!(serde_json::from_value::<BasicAuthProxyConfig>(config).is_err());
        }
    }

    #[test]
    fn pfsense_v1_mode_emits_the_exact_api_authorization_value() {
        let mode: UpstreamAuthMode = serde_json::from_str(r#""pfSenseV1""#)
            .expect("documented pfSense auth mode should deserialize");

        assert_eq!(mode, UpstreamAuthMode::PfSenseV1);
        assert_eq!(
            mode.authorization_value("client-id", "client-secret")
                .as_deref(),
            Some("client-id client-secret")
        );
        assert_eq!(serde_json::to_string(&mode).unwrap(), r#""pfSenseV1""#);
        assert_eq!(mode.manager_visible_username("api-key-secret"), "");
    }

    #[test]
    fn explicit_none_keeps_form_credentials_out_of_authorization_and_status() {
        let config: BasicAuthProxyConfig = serde_json::from_value(serde_json::json!({
            "target_url": "https://device.test/", "username": "form-user",
            "password": "form-secret", "upstream_auth_mode": "none", "http_auto_login": true
        }))
        .unwrap();
        assert_eq!(config.upstream_auth_mode, UpstreamAuthMode::None);
        assert_eq!(
            serde_json::to_string(&config.upstream_auth_mode).unwrap(),
            r#""none""#
        );
        assert!(config.http_auto_login);
        assert_eq!(config.password, "form-secret");
        let request = config
            .upstream_auth_mode
            .apply_credentials(
                reqwest::Client::new().get("https://device.test/login"),
                &config.username,
                &config.password,
            )
            .build()
            .unwrap();
        assert!(!request
            .headers()
            .contains_key(reqwest::header::AUTHORIZATION));
        assert_eq!(
            config
                .upstream_auth_mode
                .manager_visible_username(&config.username),
            ""
        );
        assert!(!config.upstream_auth_mode.accepts_basic_challenge());
    }

    #[test]
    fn credential_application_preserves_basic_and_pfsense_contracts() {
        let client = reqwest::Client::new();
        let basic = UpstreamAuthMode::Basic
            .apply_credentials(client.get("https://device.test/"), "admin", "secret")
            .build()
            .unwrap();
        assert_eq!(
            basic.headers()[reqwest::header::AUTHORIZATION],
            "Basic YWRtaW46c2VjcmV0"
        );
        let api = UpstreamAuthMode::PfSenseV1
            .apply_credentials(client.get("https://device.test/"), "id", "secret")
            .build()
            .unwrap();
        assert_eq!(api.headers()[reqwest::header::AUTHORIZATION], "id secret");
        assert!(UpstreamAuthMode::Basic.accepts_basic_challenge());
        assert!(UpstreamAuthMode::PfSenseV1.accepts_basic_challenge());
        // None suppresses proxy injection, not an application's own explicit
        // same-origin Authorization request (e.g. a web app's bearer token).
        let own = UpstreamAuthMode::None
            .apply_credentials(
                client
                    .get("https://device.test/")
                    .header(reqwest::header::AUTHORIZATION, "Bearer fixture"),
                "admin",
                "secret",
            )
            .build()
            .unwrap();
        assert_eq!(
            own.headers()[reqwest::header::AUTHORIZATION],
            "Bearer fixture"
        );
    }
}

/// Non-secret snapshot of an explicitly authorized, one-use native form flow.
/// CredentialsReleased reports handout, never successful website sign-in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeferredSynologyLoginStatus {
    AwaitingNas,
    WaitingForForm,
    WaitingForPassword,
    CredentialsReleased,
    Expired,
    Cancelled,
}

/// Response from starting the proxy mediator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyMediatorResponse {
    /// The local port the proxy is listening on
    pub local_port: u16,
    /// Session ID for managing the proxy
    pub session_id: String,
    /// The proxied URL to use
    pub proxy_url: String,
    /// Native intent only; the redirected connection remains anonymous.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deferred_login_status: Option<DeferredSynologyLoginStatus>,
}

/// Proxy session tracking using a local TCP server (axum on 127.0.0.1:0).
///
/// Each proxy session spawns a lightweight HTTP server on a random port.
/// The iframe loads through a per-session, unguessable
/// `http://p{token}.localhost:{port}/` authority. Every request must carry that
/// exact Host (and same-origin Origin when present) before any sub-resource
/// request is forwarded with authentication headers. This approach works with
/// all WebView2 versions (unlike custom URI scheme handlers which require
/// ICoreWebView2_22 for iframe support).
/// Tracks active proxy mediator sessions so they can be stopped.
pub struct ProxySessionManager {
    #[doc(hidden)]
    pub attempts: attempt::AttemptRegistry,
    pub sessions: HashMap<String, ProxySessionEntry>,
    /// Global request log (last N entries, ring buffer style).
    pub request_log: VecDeque<ProxyRequestLogEntry>,
    request_log_capacity: usize,
    next_request_log_id: u64,
    redirect_reviews: HashMap<String, redirect::PendingRedirect>,
}

pub struct ProxySessionEntry {
    #[doc(hidden)]
    pub attempt: Option<attempt::AttemptSession>,
    pub network: Arc<ProxyNetworkState>,
    pub target_url: String,
    pub username: String,
    pub password: String,
    pub upstream_auth_mode: UpstreamAuthMode,
    pub proxy_policy: HttpProxyPolicy,
    pub redirect_profile: Option<BrowserRedirectProfile>,
    pub custom_headers: HashMap<String, String>,
    pub upstream_proxy_url: Option<String>,
    pub target_origin: String,
    pub connection_id: String,
    pub created_at: String,
    pub local_port: u16,
    /// Minimum TLS version used when creating the reqwest client.
    pub min_tls_version: String,
    /// Whether SSL certificate verification is enabled.
    pub verify_ssl: bool,
    /// Optional SHA-256 leaf certificate fingerprint pinned for this session.
    pub accepted_cert_fingerprint: Option<String>,
    pub require_ca_verification: bool,
    pub request_count: Arc<AtomicU64>,
    pub error_count: Arc<AtomicU64>,
    pub last_error: Arc<std::sync::Mutex<Option<String>>>,
    /// Send `()` to shut down the axum server for this session.
    pub shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

/// A single entry in the proxy request log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyRequestLogEntry {
    /// Stable per-process identity, independent of timestamp collisions/order.
    #[serde(default)]
    pub id: String,
    pub session_id: String,
    pub method: String,
    pub url: String,
    pub status: u16,
    pub error: Option<String>,
    pub timestamp: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<ProxyLogDiagnostic>,
}

/// Detailed info about a single proxy session, returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxySessionDetail {
    pub session_id: String,
    pub target_url: String,
    pub username: String,
    pub connection_id: String,
    pub proxy_url: String,
    pub created_at: String,
    pub request_count: u64,
    pub error_count: u64,
    pub last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deferred_login_status: Option<DeferredSynologyLoginStatus>,
}

impl ProxySessionManager {
    pub fn new() -> Arc<std::sync::Mutex<Self>> {
        Arc::new(std::sync::Mutex::new(Self {
            attempts: Default::default(),
            sessions: HashMap::new(),
            request_log: VecDeque::new(),
            request_log_capacity: 10_000,
            next_request_log_id: 0,
            redirect_reviews: HashMap::new(),
        }))
    }

    pub fn set_request_log_capacity(&mut self, capacity: usize) -> Result<usize, String> {
        if capacity > 100_000 {
            return Err("Proxy request log capacity must be between 0 and 100000".into());
        }
        self.request_log_capacity = capacity;
        while self.request_log.len() > capacity {
            self.request_log.pop_front();
        }
        // Release an oversized prior allocation after explicit shrink/disable.
        self.request_log.shrink_to_fit();
        Ok(self.request_log.len())
    }

    pub fn record_request(&mut self, mut entry: ProxyRequestLogEntry) {
        if self.request_log_capacity == 0 {
            return;
        }
        self.next_request_log_id = self.next_request_log_id.wrapping_add(1);
        entry.id = self.next_request_log_id.to_string();
        if self.request_log.len() == self.request_log_capacity {
            self.request_log.pop_front();
        }
        self.request_log.push_back(entry);
    }

    pub fn request_log_newest_first(&self) -> Vec<ProxyRequestLogEntry> {
        self.request_log.iter().rev().cloned().collect()
    }
}

pub type ProxySessionManagerState = Arc<std::sync::Mutex<ProxySessionManager>>;

// ─── Web Session Recording ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebRecordingEntry {
    pub timestamp_ms: u64,
    pub method: String,
    pub url: String,
    pub request_headers: HashMap<String, String>,
    pub request_body_size: u64,
    pub status: u16,
    pub response_headers: HashMap<String, String>,
    pub response_body_size: u64,
    pub content_type: Option<String>,
    pub duration_ms: u64,
    pub error: Option<String>,
}

pub struct WebRecordingState {
    pub start_time: std::time::Instant,
    pub start_utc: chrono::DateTime<chrono::Utc>,
    pub session_id: String,
    pub target_url: String,
    pub connection_id: String,
    pub host: String,
    pub entries: Vec<WebRecordingEntry>,
    pub record_headers: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebRecordingMetadata {
    pub session_id: String,
    pub start_time: String,
    pub end_time: Option<String>,
    pub host: String,
    pub target_url: String,
    pub duration_ms: u64,
    pub entry_count: usize,
    pub total_bytes_transferred: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebRecording {
    pub metadata: WebRecordingMetadata,
    pub entries: Vec<WebRecordingEntry>,
}

pub fn active_web_recordings() -> &'static std::sync::Mutex<HashMap<String, WebRecordingState>> {
    static INSTANCE: OnceLock<std::sync::Mutex<HashMap<String, WebRecordingState>>> =
        OnceLock::new();
    INSTANCE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

pub(crate) fn is_sensitive_recording_header(header_name: &str) -> bool {
    let normalized = header_name.trim().to_ascii_lowercase();
    if matches!(
        normalized.as_str(),
        "authorization" | "cookie" | "proxy-authorization" | "set-cookie" | "x-api-key"
    ) {
        return true;
    }

    let compact: String = normalized
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect();
    normalized.contains("token")
        || normalized.contains("secret")
        || compact.contains("apikey")
        || normalized
            .split(|character: char| !character.is_ascii_alphanumeric())
            .any(|segment| segment == "key")
        || compact.ends_with("key")
}

pub(crate) fn redact_recording_headers<I>(headers: I) -> HashMap<String, String>
where
    I: IntoIterator<Item = (String, String)>,
{
    headers
        .into_iter()
        .filter(|(name, _)| !is_sensitive_recording_header(name))
        .collect()
}

fn recorded_request_headers(
    state: &AxumProxyState,
    headers: &[(String, String)],
) -> HashMap<String, String> {
    redact_recording_headers(
        headers
            .iter()
            .filter(|(name, _)| {
                !state
                    .custom_headers
                    .keys()
                    .any(|configured| configured.eq_ignore_ascii_case(name))
            })
            .cloned(),
    )
}

#[cfg(test)]
mod recording_header_redaction_tests {
    use super::*;

    #[test]
    fn redaction_is_case_insensitive_and_preserves_diagnostics() {
        let headers = HashMap::from([
            ("COOKIE".to_string(), "session=secret".to_string()),
            ("Set-Cookie".to_string(), "session=secret".to_string()),
            ("Authorization".to_string(), "Bearer secret".to_string()),
            (
                "pRoXy-AuThOrIzAtIoN".to_string(),
                "Basic secret".to_string(),
            ),
            ("X-API-Key".to_string(), "api-secret".to_string()),
            ("X-Auth-Token".to_string(), "token-secret".to_string()),
            ("X-Client-Secret".to_string(), "client-secret".to_string()),
            ("X-Signing-Key".to_string(), "signing-secret".to_string()),
            ("Content-Type".to_string(), "application/json".to_string()),
            ("X-Request-ID".to_string(), "request-123".to_string()),
            ("Server-Timing".to_string(), "db;dur=4".to_string()),
        ]);

        let redacted = redact_recording_headers(headers);

        assert_eq!(redacted.len(), 3);
        assert_eq!(
            redacted.get("Content-Type").map(String::as_str),
            Some("application/json")
        );
        assert_eq!(
            redacted.get("X-Request-ID").map(String::as_str),
            Some("request-123")
        );
        assert_eq!(
            redacted.get("Server-Timing").map(String::as_str),
            Some("db;dur=4")
        );
    }
}

// -----------------------------------------------------------------------
// Axum proxy handler — shared state passed to every request handler
// -----------------------------------------------------------------------

/// State shared between the axum server and the session manager.
///
/// P3: `username` and `password` are now wrapped in `Arc<RwLock<...>>`
/// so the themed-auth POST handler can update them at runtime when
/// the user submits credentials via the inline login form. The
/// per-challenge `pending_nonce` lives in the same lock so the POST
/// can verify the submission matches a challenge we actually served.
///
/// `credentials_applied` is the desktop event sink, so the auth handler
/// can report `proxy-credentials-applied` to the frontend (which the
/// React side listens for, then offers a "save these credentials?"
/// toast).
#[derive(Clone)]
pub struct AxumProxyState {
    #[doc(hidden)]
    pub attempt: Option<attempt::AttemptSession>,
    pub network: Arc<ProxyNetworkState>,
    pub session_id: String,
    pub connection_id: String,
    pub target_url: String,
    pub username: Arc<std::sync::RwLock<String>>,
    pub password: Arc<std::sync::RwLock<String>>,
    pub upstream_auth_mode: UpstreamAuthMode,
    pub proxy_policy: HttpProxyPolicy,
    pub redirect_profile: Option<BrowserRedirectProfile>,
    pub custom_headers: HashMap<String, String>,
    pub pending_nonce: Arc<std::sync::RwLock<Option<String>>>,
    /// P7: live snapshot of the frontend's `:root --color-*` tokens.
    /// `RwLock` so a new `update_proxy_theme(session_id, tokens)` IPC
    /// (planned follow-up) can push live updates when the user
    /// changes themes mid-session without restarting the proxy.
    pub theme: Arc<std::sync::RwLock<crate::theme_tokens::ThemeTokens>>,
    pub target_origin: String,
    /// Credential-bearing loopback authority. Its random host label is never
    /// stored in manager/status DTOs or forwarded upstream.
    pub proxy_authority: String,
    pub proxy_origin: String,
    /// t20 web auto-login: armed when `config.http_auto_login` is set for this
    /// session. Disarmed after the first credential hand-out (single-shot — a
    /// re-rendered login-error page cannot loop the proxy into re-dispensing).
    pub auto_login_armed: Arc<AtomicBool>,
    /// t20: per-page nonce for the auto-login credential endpoint. A SEPARATE
    /// slot from `pending_nonce` (different lifecycle: auto-login arms on an
    /// armed HTML page, themed-auth arms on a 401). Minted on each injected
    /// page; consumed on first read by `autologin_cred_handler`.
    pub auto_login_nonce: Arc<std::sync::RwLock<Option<String>>>,
    pub bitwarden_continuation:
        Arc<std::sync::Mutex<Option<crate::themed_autologin::BitwardenContinuation>>>,
    /// t20: optional CSS-selector overrides for the device login form
    /// (authoritative when set). Non-secret; passed through to the injected
    /// client so a set-but-unmatched selector means "do not fill".
    pub auto_login_selectors: Option<HttpAutoLoginSelectors>,
    pub http_form_automation: Option<crate::themed_autologin::HttpFormAutomation>,
    pub client: reqwest::Client,
    /// Request-start ordering for document lifecycle reports (never credentials).
    pub document_sequence: Arc<AtomicU64>,
    pub request_count: Arc<AtomicU64>,
    pub error_count: Arc<AtomicU64>,
    pub last_error: Arc<std::sync::Mutex<Option<String>>>,
    pub global_sessions: ProxySessionManagerState,
    /// Desktop boundary supplied by real constructors. No runtime is needed by
    /// the transport itself or isolated protected-route tests.
    pub credentials_applied: Option<Arc<dyn Fn(serde_json::Value) + Send + Sync>>,
}

fn proxy_request_headers_are_authorized(
    headers: &axum::http::HeaderMap,
    expected_authority: &str,
    expected_origin: &str,
) -> bool {
    let host_matches = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(|value| value == expected_authority)
        .unwrap_or(false);
    if !host_matches {
        return false;
    }

    headers
        .get(axum::http::header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(|value| value == expected_origin)
        .unwrap_or(true)
}

/// Retain a web application's own bearer/session Authorization only when the
/// proxy is explicitly not supplying credentials. Proxy credentials and the
/// private loopback authority must never be forwarded as request headers.
fn collect_upstream_headers(
    incoming: &axum::http::HeaderMap,
    mode: UpstreamAuthMode,
    proxy_origin: &str,
    target_origin: &str,
) -> Vec<(String, String)> {
    let mut forwarded = Vec::new();
    let document_request = incoming
        .get("sec-fetch-dest")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|dest| matches!(dest, "document" | "iframe" | "script" | "style"));
    for (key, value) in incoming {
        let name = key.as_str();
        if (document_request
            && matches!(
                name,
                "if-none-match" | "if-modified-since" | "if-range" | "range"
            ))
            || (name == "authorization"
                && !matches!(
                    mode,
                    UpstreamAuthMode::None
                        | UpstreamAuthMode::BitwardenForm
                        | UpstreamAuthMode::SynologyForm
                ))
            || matches!(
                name,
                "host"
                    | "connection"
                    | "proxy-authorization"
                    | "transfer-encoding"
                    | "content-length"
                    | "accept-encoding"
            )
        {
            continue;
        }
        if let Ok(value) = value.to_str() {
            // RFC 6454 Origin is a serialized origin, not a URL with a path.
            if name == "origin" && value == proxy_origin {
                forwarded.push((name.to_string(), target_origin.to_string()));
            } else if name == "referer"
                && (value == proxy_origin || value.starts_with(&format!("{proxy_origin}/")))
            {
                forwarded.push((name.to_string(), format!("{target_origin}/")));
            } else {
                forwarded.push((name.to_string(), value.to_string()));
            }
        }
    }
    // Never forward browser codecs that this proxy cannot decode before editing
    // HTML/CSS/JS. Opaque responses retain their encoding and bytes unchanged.
    forwarded.push((
        "accept-encoding".into(),
        proxy_response::ACCEPT_ENCODING.into(),
    ));
    forwarded
}

fn permits_upstream_retry(method: &axum::http::Method) -> bool {
    matches!(
        *method,
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    )
}

/// Reject requests that do not know this session's random loopback host before
/// auth routes, auto-login routes, or the upstream fallback can run.
pub async fn enforce_proxy_access(
    axum::extract::State(state): axum::extract::State<Arc<AxumProxyState>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    if !proxy_request_headers_are_authorized(
        request.headers(),
        &state.proxy_authority,
        &state.proxy_origin,
    ) {
        return axum::http::Response::builder()
            .status(axum::http::StatusCode::FORBIDDEN)
            .header("Cache-Control", "no-store")
            .header("X-DNS-Prefetch-Control", "off")
            .header(
                "Content-Security-Policy",
                "default-src 'none'; frame-ancestors 'none'",
            )
            .body(axum::body::Body::from("Forbidden"))
            .expect("static forbidden proxy response is valid");
    }
    let mut response = if state.network.is_active()
        && state
            .attempt
            .as_ref()
            .is_none_or(|attempt| attempt.is_current())
    {
        next.run(request).await
    } else {
        axum::http::Response::builder()
            .status(axum::http::StatusCode::GONE)
            .body(axum::body::Body::from("This proxy session has ended."))
            .expect("static expired proxy response")
    };
    // Enforce on every response, including errors, redirects, JS/CSS and
    // worker candidates. Never depend on successful HTML injection.
    let policy = network::content_security_policy(&state.proxy_policy, &state.proxy_authority);
    response.headers_mut().insert(
        "x-dns-prefetch-control",
        axum::http::HeaderValue::from_static("off"),
    );
    response.headers_mut().insert(
        axum::http::header::CONTENT_SECURITY_POLICY,
        policy
            .parse()
            .expect("native proxy authority is header-safe"),
    );
    response
}

#[cfg(test)]
mod proxy_access_guard_tests {
    use super::proxy_request_headers_are_authorized;
    use axum::http::header::{HOST, ORIGIN};
    use axum::http::{HeaderMap, HeaderValue};

    const AUTHORITY: &str = "p0123456789abcdef0123456789abcdef.localhost:43123";
    const ORIGIN_VALUE: &str = "http://p0123456789abcdef0123456789abcdef.localhost:43123";

    fn headers(host: Option<&'static str>, origin: Option<&'static str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(host) = host {
            headers.insert(HOST, HeaderValue::from_static(host));
        }
        if let Some(origin) = origin {
            headers.insert(ORIGIN, HeaderValue::from_static(origin));
        }
        headers
    }

    #[test]
    fn accepts_exact_host_with_absent_or_same_proxy_origin() {
        assert!(proxy_request_headers_are_authorized(
            &headers(Some(AUTHORITY), None),
            AUTHORITY,
            ORIGIN_VALUE,
        ));
        assert!(proxy_request_headers_are_authorized(
            &headers(Some(AUTHORITY), Some(ORIGIN_VALUE)),
            AUTHORITY,
            ORIGIN_VALUE,
        ));
    }

    #[test]
    fn rejects_missing_or_wrong_host_and_hostile_origins() {
        for headers in [
            headers(None, None),
            headers(Some("127.0.0.1:43123"), None),
            headers(
                Some("pffffffffffffffffffffffffffffffff.localhost:43123"),
                None,
            ),
            headers(Some(AUTHORITY), Some("https://attacker.test")),
            headers(Some(AUTHORITY), Some("null")),
        ] {
            assert!(!proxy_request_headers_are_authorized(
                &headers,
                AUTHORITY,
                ORIGIN_VALUE,
            ));
        }
    }
}

/// Closed local routes expose only their fixed category, never caller paths,
/// destination queries, bodies, headers, or upstream response/error text.
#[derive(Clone, Copy)]
enum ObservedLocalRoute {
    Font,
    QuickConnectDiscovery,
    QuickConnectDiscovered,
    QuickConnectRedirect,
}

fn update_response_log(
    state: &AxumProxyState,
    entry_id: Option<&str>,
    status: u16,
    error: Option<String>,
    diagnostic: ProxyLogDiagnostic,
) {
    let Some(entry_id) = entry_id else { return };
    if let Ok(mut manager) = state.global_sessions.lock() {
        // Cleared/evicted entries stay gone; completion must not recreate them.
        if let Some(entry) = manager
            .request_log
            .iter_mut()
            .rev()
            .find(|entry| entry.id == entry_id)
        {
            entry.status = status;
            entry.error = error;
            entry.diagnostic = Some(session_diagnostic(state, diagnostic));
        }
    }
}

fn session_diagnostic(
    state: &AxumProxyState,
    mut diagnostic: ProxyLogDiagnostic,
) -> ProxyLogDiagnostic {
    if let Some((attempt_id, hop)) = state
        .attempt
        .as_ref()
        .and_then(|attempt| attempt.diagnostic())
    {
        diagnostic.attempt_id = Some(attempt_id);
        diagnostic.hop = Some(hop);
    }
    diagnostic
}

fn http_cycle_edge(
    state: &AxumProxyState,
    redirect: &upstream::CrossOriginRedirect,
    headers: &[(String, String)],
    sequence: u64,
) -> Option<attempt::HttpRedirectEdge> {
    if !redirect::cycle_context_is_anonymous(state)
        || !state.network.document_is_current(sequence)
        || !matches!(
            redirect.method,
            reqwest::Method::GET | reqwest::Method::HEAD
        )
        || redirect.same_origin_redirects != 0
        || !quickconnect::default_handoff(state, &redirect.destination)
        || headers
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("authorization"))
    {
        return None;
    }
    let attempt = state.attempt.as_ref()?;
    let mut edge = attempt.http_redirect_edge(&redirect.response_url, &redirect.destination)?;
    if let attempt::HttpRedirectEdge::RegionalExit(_, fingerprint) = &mut edge {
        // Opaque, volatile change detection only. Consent/routing cookies do
        // not disable the guard; changed login/session state starts a new count.
        // Neither cookie values nor this digest are serialized or logged.
        let browser: Vec<_> = headers
            .iter()
            .filter(|(name, _)| name.eq_ignore_ascii_case("cookie"))
            .map(|(_, value)| value.as_str())
            .collect();
        *fingerprint = attempt.cookie_state_fingerprint(&redirect.response_url, &browser)?;
    }
    Some(edge)
}

fn observe_local_response(
    state: &AxumProxyState,
    method: &axum::http::Method,
    route: ObservedLocalRoute,
    response: axum::response::Response,
    started: std::time::Instant,
) -> axum::response::Response {
    let path = match route {
        ObservedLocalRoute::Font => font_assets::PREFIX,
        ObservedLocalRoute::QuickConnectDiscovery => quickconnect_control::PATH,
        ObservedLocalRoute::QuickConnectDiscovered => quickconnect_control::DISCOVERED_PATH,
        ObservedLocalRoute::QuickConnectRedirect => quickconnect::PATH,
    };
    let url = response
        .extensions()
        .get::<quickconnect_control::ObservedDestination>()
        .map(|observed| observed.description.clone())
        .unwrap_or_else(|| format!("{}{path}", state.proxy_origin));
    let status = response.status().as_u16();
    let review_pending = response
        .extensions()
        .get::<quickconnect::ReviewPending>()
        .is_some();
    let error = (status >= 400 && !review_pending).then(|| {
        if let Some(diagnostic) = response
            .extensions()
            .get::<quickconnect_control::Diagnostic>()
        {
            format!("HTTP {status} [{}]", diagnostic.code())
        } else {
            format!("HTTP {status}")
        }
    });
    let phase = match route {
        ObservedLocalRoute::Font => "font",
        ObservedLocalRoute::QuickConnectRedirect => "quickconnect_redirect",
        _ => "quickconnect_request",
    };
    let code = response
        .extensions()
        .get::<quickconnect_control::Diagnostic>()
        .map(|value| value.code())
        .unwrap_or(if matches!(route, ObservedLocalRoute::Font) {
            "font_response"
        } else if review_pending && status >= 400 {
            "http_redirect_review"
        } else if review_pending {
            "quickconnect_redirect_pending"
        } else if status >= 400 {
            "http_policy_refused"
        } else {
            "http_response"
        });
    let mut diagnostic = ProxyLogDiagnostic::new(
        phase,
        if review_pending {
            "handoff"
        } else {
            "complete"
        },
        code,
        if review_pending && status >= 400 {
            "review_required"
        } else if review_pending {
            "continuing"
        } else if status >= 400 {
            "failed"
        } else {
            "succeeded"
        },
        started,
    );
    if let Some(observation) = response
        .extensions()
        .get::<quickconnect_control::ExchangeObservation>()
    {
        diagnostic.phase = observation.phase.as_str().into();
        diagnostic.stage = observation.stage.as_str().into();
        diagnostic.outcome = observation.outcome.as_str().into();
        diagnostic.duration_ms = observation.duration_ms;
        diagnostic.lane = observation.lane.map(|lane| lane.as_str().into());
        diagnostic.queue_ms = observation.queue_ms;
        diagnostic.active_ms = observation.active_ms;
        diagnostic.upstream_status = observation.upstream_status;
    }
    state.request_count.fetch_add(1, Ordering::Relaxed);
    if error.is_some() {
        state.error_count.fetch_add(1, Ordering::Relaxed);
    }
    // A review pause neither creates nor clears an unrelated request failure.
    if !review_pending {
        if let Ok(mut last_error) = state.last_error.lock() {
            *last_error = error.as_ref().map(|error| format!("{error} for {url}"));
        }
    }
    if let Ok(mut manager) = state.global_sessions.lock() {
        manager.record_request(ProxyRequestLogEntry {
            id: String::new(),
            session_id: state.session_id.clone(),
            method: match method.as_str() {
                "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "CONNECT"
                | "TRACE" => method.to_string(),
                _ => "OTHER".into(),
            },
            url,
            status,
            error,
            timestamp: chrono::Utc::now().to_rfc3339(),
            diagnostic: Some(session_diagnostic(state, diagnostic)),
        });
    }
    response
}

/// Axum fallback handler — proxies every request to the target server.
///
/// Safe read methods allow one automatic retry for transient connection errors
/// (connection reset, pool errors, timeouts on idle connections). Login POSTs
/// and other mutations are never automatically replayed.
pub async fn axum_proxy_handler(
    axum::extract::State(state): axum::extract::State<Arc<AxumProxyState>>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::body::Body;
    use axum::http::{Response, StatusCode};

    let req_start = std::time::Instant::now();
    let method = req.method().clone();
    if proxy_request_headers_are_authorized(
        req.headers(),
        &state.proxy_authority,
        &state.proxy_origin,
    ) {
        if let Some(attempt) = &state.attempt {
            attempt.capture_route_cookies(req.headers());
        }
    }
    if req
        .uri()
        .path()
        .starts_with(quickconnect_control::DISCOVERED_PATH)
    {
        let response = quickconnect_control::handle(state.clone(), req).await;
        return observe_local_response(
            &state,
            &method,
            ObservedLocalRoute::QuickConnectDiscovered,
            response,
            req_start,
        );
    }
    if req.uri().path().starts_with(quickconnect_control::PATH) {
        let response = quickconnect_control::handle(state.clone(), req).await;
        return observe_local_response(
            &state,
            &method,
            ObservedLocalRoute::QuickConnectDiscovery,
            response,
            req_start,
        );
    }
    if req.uri().path().starts_with("/__sortofremoteng_assets_v1/") {
        // Closed public binary capability: never send this reserved path,
        // browser credentials or source query policies to the NAS.
        let response = font_assets::handle(state.clone(), req).await;
        return observe_local_response(
            &state,
            &method,
            ObservedLocalRoute::Font,
            response,
            req_start,
        );
    }
    if websocket::is_upgrade_candidate(req.headers()) {
        return websocket::handle(state, req).await;
    }
    if req.uri().path() == web_automation::DARKREADER_PATH {
        // The router's protected-host/origin middleware has already run. Never
        // forward this bundled asset path or count it as an upstream request.
        return web_automation::asset(&method);
    }
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str().to_string())
        .unwrap_or_else(|| "/".to_string());
    let (path_and_query, navigation_token) = proxy_response::navigation_request(&path_and_query);
    let document_request =
        proxy_response::is_document_request(req.headers(), navigation_token.as_deref());
    if state.proxy_policy.page_scripts != PageScripts::Allow
        && req
            .headers()
            .get("sec-fetch-dest")
            .and_then(|value| value.to_str().ok())
            == Some("script")
    {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header("Cache-Control", "no-store")
            .body(Body::from(
                "External scripts are disabled by this connection's proxy policy.",
            ))
            .expect("static policy response");
    }
    // Reserve navigation START order, so a slow prior page never acquires a
    // newer identity merely by finishing last. XHR does not consume a sequence.
    let document_sequence = if document_request {
        // Serialize a reviewed vault password handout with document invalidation.
        // A queued old-page redemption cannot observe a pre-navigation sequence.
        // Direct Synology grants bind to the frontend-selected document instead
        // (serialized with selection), so child frame issuance never revokes them.
        if state.upstream_auth_mode == UpstreamAuthMode::BitwardenForm {
            let mut continuation = state.bitwarden_continuation.lock().ok();
            let next = state.document_sequence.fetch_add(1, Ordering::SeqCst) + 1;
            if let Some(slot) = continuation.as_mut() {
                **slot = None;
            }
            next
        } else {
            state.document_sequence.fetch_add(1, Ordering::Relaxed) + 1
        }
    } else {
        0
    };
    if document_request {
        state
            .network
            .document_issued(document_sequence, navigation_token.is_some());
    }

    if req.uri().path() == quickconnect::PATH {
        // A versioned vendor-script handoff is a local review request, never
        // an upstream fetch. Observe only its fixed path, not its session URL.
        let response = quickconnect::handle(
            &state,
            &method,
            req.headers(),
            path_and_query.split_once('?').map(|(_, query)| query),
            document_sequence,
            navigation_token,
        );
        return observe_local_response(
            &state,
            &method,
            ObservedLocalRoute::QuickConnectRedirect,
            response,
            req_start,
        );
    }

    let full_url = format!(
        "{}{}",
        state.target_url.trim_end_matches('/'),
        path_and_query
    );
    let request_url = full_url.clone();
    let full_url = state.proxy_policy.redacted_url(&full_url);

    let method_str = method.to_string();

    let reqwest_method = match method_str.as_str() {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "PATCH" => reqwest::Method::PATCH,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let mut fwd_headers = collect_upstream_headers(
        req.headers(),
        state.upstream_auth_mode,
        &state.proxy_origin,
        &state.target_origin,
    );
    if document_request
        && navigation_token.is_some()
        && matches!(method, axum::http::Method::GET | axum::http::Method::HEAD)
        && state.proxy_policy.synology_quick_connect_defaults.is_some()
    {
        if let Some(referrer) = state
            .network
            .with_current_document(document_sequence, || {
                state
                    .attempt
                    .as_ref()
                    .and_then(|attempt| attempt.take_handoff_referrer())
            })
            .ok()
            .flatten()
        {
            fwd_headers.retain(|(name, _)| !name.eq_ignore_ascii_case("referer"));
            if let Some(origin) = referrer {
                fwd_headers.push(("referer".into(), origin));
            }
        }
    }
    if navigation_token.is_some() || state.proxy_policy.cache_mode == CacheMode::Bypass {
        fwd_headers.retain(|(name, _)| {
            !matches!(
                name.as_str(),
                "if-none-match" | "if-modified-since" | "if-range" | "range"
            )
        });
    }
    for (name, value) in &state.custom_headers {
        fwd_headers.retain(|(existing, _)| !existing.eq_ignore_ascii_case(name));
        fwd_headers.push((name.clone(), value.clone()));
    }
    if state.proxy_policy.cache_mode == CacheMode::Bypass {
        fwd_headers.retain(|(name, _)| {
            !matches!(
                name.to_ascii_lowercase().as_str(),
                "cache-control"
                    | "pragma"
                    | "if-none-match"
                    | "if-modified-since"
                    | "if-range"
                    | "range"
            )
        });
        fwd_headers.push(("cache-control".into(), "no-cache, no-store".into()));
        fwd_headers.push(("pragma".into(), "no-cache".into()));
    }

    // Forward request body.
    let body_bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b.to_vec(),
        Err(e) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from(format!("Failed to read request body: {}", e)))
                .expect("valid HTTP response");
        }
    };

    /// Helper: returns true for transient errors worth retrying (connection
    /// reset, broken pipe, pool timeouts).
    fn is_retryable(e: &reqwest::Error) -> bool {
        if e.is_connect() || e.is_timeout() {
            return true;
        }
        let msg = e.to_string().to_lowercase();
        msg.contains("connection reset")
            || msg.contains("broken pipe")
            || msg.contains("connection was idle")
            || msg.contains("connection closed before")
            || msg.contains("pool")
    }

    // Only safe reads may retry. A timed-out login POST may already have been
    // processed upstream; repeating it could submit credentials twice.
    let result = match upstream::send(
        &state,
        &reqwest_method,
        &request_url,
        &fwd_headers,
        &body_bytes,
    )
    .await
    {
        Ok(resp) => Ok(resp),
        Err(upstream::UpstreamError::Transport(e))
            if permits_upstream_retry(&method) && is_retryable(&e) =>
        {
            // Brief pause before retry
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            upstream::send(
                &state,
                &reqwest_method,
                &request_url,
                &fwd_headers,
                &body_bytes,
            )
            .await
        }
        Err(e) => Err(e),
    };

    // Execute the upstream request.
    match result {
        Ok(resp) => {
            let status_code = resp.status();
            let status_u16 = status_code.as_u16();

            // Track request/error counts.
            state.request_count.fetch_add(1, Ordering::Relaxed);
            if status_u16 >= 400 {
                state.error_count.fetch_add(1, Ordering::Relaxed);
            }
            // Current request health is separate from lifetime error counters.
            // A login-check 401 must not survive a later successful response.
            // This describes the last completed request, not website auth state.
            if let Ok(mut le) = state.last_error.lock() {
                *le = if status_u16 >= 400 {
                    Some(format!("HTTP {} for {}", status_u16, full_url))
                } else {
                    None
                };
            }

            // First record headers, then advance this same entry once the body
            // is validated. A decoding failure must not remain a successful 200.
            let response_log_id = if let Ok(mut mgr) = state.global_sessions.lock() {
                let mut diagnostic = ProxyLogDiagnostic::new(
                    "http",
                    "response_headers",
                    "http_response",
                    if status_u16 >= 400 {
                        "http_error"
                    } else {
                        "succeeded"
                    },
                    req_start,
                );
                diagnostic.upstream_status = Some(status_u16);
                mgr.record_request(ProxyRequestLogEntry {
                    id: String::new(),
                    session_id: state.session_id.clone(),
                    method: method_str.clone(),
                    url: full_url.clone(),
                    status: status_u16,
                    error: if status_u16 >= 400 {
                        Some(format!("HTTP {}", status_u16))
                    } else {
                        None
                    },
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    diagnostic: Some(session_diagnostic(&state, diagnostic)),
                });
                Some(mgr.next_request_log_id.to_string())
            } else {
                None
            };

            // P3: intercept a Basic-Auth 401 challenge from the
            // upstream and swap it for a themed inline login form.
            // The browser-native auth popup only fires when the
            // iframe receives a 401 *with* the WWW-Authenticate
            // header; by returning our own page without that header
            // we suppress the popup entirely. Verbosely collect the
            // WWW-Authenticate values so the discriminator works on
            // both single and multi-scheme servers.
            let www_auth_values: Vec<String> = resp
                .headers()
                .get_all("www-authenticate")
                .iter()
                .filter_map(|v| v.to_str().ok().map(|s| s.to_string()))
                .collect();
            if document_request
                && state.upstream_auth_mode.accepts_basic_challenge()
                && matches!(
                    crate::themed_auth::intercept_basic_auth_challenge(
                        status_u16,
                        &www_auth_values,
                    ),
                    crate::themed_auth::ChallengeDecision::Challenge,
                )
            {
                let nonce = crate::themed_auth::fresh_nonce();
                // Stash the nonce so the POST handler can verify
                // that the submission came from a challenge we
                // actually served.
                if let Ok(mut n) = state.pending_nonce.write() {
                    *n = Some(nonce.clone());
                }
                let existing_user = state.username.read().map(|g| g.clone()).unwrap_or_default();
                // `path_and_query` is the path the user was trying
                // to reach on the proxy; the POST handler will
                // 303-redirect back to it after the credentials
                // land in the session.
                let error_hint = if !existing_user.is_empty() {
                    // A 401 cannot identify whether the username, password,
                    // account policy, or authentication method was rejected.
                    Some("The server still requires authentication. Check the saved username/password and the server's supported authentication method.")
                } else {
                    None
                };
                // P7: pull live theme tokens out of the RwLock so the
                // served form matches whatever theme the user has
                // active right now.
                let theme = state.theme.read().map(|g| g.clone()).unwrap_or_default();
                return crate::themed_auth::themed_challenge_response(
                    &full_url,
                    &path_and_query,
                    &nonce,
                    &existing_user,
                    error_hint,
                    &theme,
                );
            }

            let response_url = resp.url().clone();
            let resp_hdrs = resp.headers().clone();
            let content_type = resp_hdrs
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            // Decode before status-page theming AND successful document edits.
            // Malformed/oversized representations produce a clear bounded error,
            // never a partly rewritten compressed stream.
            let has_body = method != axum::http::Method::HEAD
                && status_code != StatusCode::NO_CONTENT
                && status_code != StatusCode::RESET_CONTENT;
            let is_rewritable = has_body
                && ((proxy_response::is_editable(content_type.as_deref())
                    && (document_request || !proxy_response::is_html(content_type.as_deref())))
                    || (document_request
                        && status_u16 >= 400
                        && content_type
                            .as_deref()
                            .is_none_or(|ct| ct.trim().is_empty())));
            let raw_bytes = match proxy_response::read_body(resp, &resp_hdrs, is_rewritable).await {
                Ok(b) => b,
                Err(detail) => {
                    state.error_count.fetch_add(1, Ordering::Relaxed);
                    if let Ok(mut error) = state.last_error.lock() {
                        *error = Some(detail.to_string());
                    }
                    update_response_log(
                        &state,
                        response_log_id.as_deref(),
                        502,
                        Some("HTTP 502 [http_response_invalid]".into()),
                        ProxyLogDiagnostic::new(
                            "http",
                            "response_body",
                            "http_response_invalid",
                            "failed",
                            req_start,
                        ),
                    );
                    let theme = state.theme.read().map(|g| g.clone()).unwrap_or_default();
                    return crate::themed_errors::themed_error_response(
                        crate::themed_errors::ProxyErrorKind::Other,
                        &full_url,
                        detail,
                        &theme,
                        &state.session_id,
                    );
                }
            };
            let mut completed_diagnostic = ProxyLogDiagnostic::new(
                "http",
                "complete",
                "http_response",
                if status_u16 >= 400 {
                    "http_error"
                } else {
                    "succeeded"
                },
                req_start,
            );
            completed_diagnostic.upstream_status = Some(status_u16);
            update_response_log(
                &state,
                response_log_id.as_deref(),
                status_u16,
                (status_u16 >= 400).then(|| format!("HTTP {status_u16}")),
                completed_diagnostic,
            );

            if state.proxy_policy.synology_quick_connect_defaults.is_some()
                && document_request
                && status_code.is_success()
                && proxy_response::is_html(content_type.as_deref())
            {
                state.network.record_document_referrer(
                    document_sequence,
                    &resp_hdrs,
                    &String::from_utf8_lossy(&raw_bytes),
                );
                if let Some(attempt) = &state.attempt {
                    attempt.bind_referrer_document(&state.network);
                }
            }

            // Login is bound to the selected primary, not the global issuance
            // counter: an unrelated child response cannot replace this grant.
            // Only an app-marked, already selected primary can begin readiness.
            // Until a credential is released, any other eligible DSM document
            // (a markerless reload the frontend selects later, or a child) is
            // recorded as a candidate; redemption still requires selection.
            if state
                .attempt
                .as_ref()
                .is_some_and(|attempt| attempt.uses_deferred_synology_login())
                && document_request
                && status_code.is_success()
                && proxy_response::is_html(content_type.as_deref())
                && !proxy_response::quickconnect_connector_asset(
                    &String::from_utf8_lossy(&raw_bytes),
                    &response_url,
                )
            {
                if let Some(attempt) = &state.attempt {
                    let selected_primary = navigation_token.is_some()
                        && state
                            .network
                            .with_current_document(document_sequence, || {
                                attempt
                                    .bind_deferred_login_document(&response_url, document_sequence);
                            })
                            .is_ok();
                    if !selected_primary {
                        attempt.record_deferred_login_successor(
                            &response_url,
                            document_sequence,
                            state.network.with_selected_document(|selected| selected),
                        );
                    }
                }
            }

            // Only an explicitly marked primary navigation may advance the
            // logical attempt's connector guard. Nested frames, XHR and late
            // responses cannot consume this budget or reset a successor.
            if document_request
                && navigation_token.is_some()
                && status_code.is_success()
                && proxy_response::is_html(content_type.as_deref())
                && state.document_sequence.load(Ordering::SeqCst) == document_sequence
                && state.network.document_is_current(document_sequence)
            {
                if let Some(attempt) = &state.attempt {
                    attempt.document_landed(&response_url, document_sequence);
                    if proxy_response::quickconnect_connector_document(
                        &String::from_utf8_lossy(&raw_bytes),
                        &state.target_origin,
                        state.proxy_policy.synology_quick_connect_defaults.as_ref(),
                    ) {
                        if let Err(detail) = attempt.record_connector(&state.target_origin) {
                            state.error_count.fetch_add(1, Ordering::Relaxed);
                            if let Ok(mut error) = state.last_error.lock() {
                                *error = Some(detail.into());
                            }
                            update_response_log(
                                &state,
                                response_log_id.as_deref(),
                                508,
                                Some("HTTP 508 [quickconnect_connector_restart]".into()),
                                ProxyLogDiagnostic::new(
                                    "quickconnect_redirect",
                                    "handoff",
                                    "quickconnect_connector_restart",
                                    "failed",
                                    req_start,
                                ),
                            );
                            let theme = state.theme.read().map(|g| g.clone()).unwrap_or_default();
                            return crate::themed_errors::themed_error_response(
                                crate::themed_errors::ProxyErrorKind::RedirectLoop,
                                &full_url,
                                detail,
                                &theme,
                                &state.session_id,
                            );
                        }
                    } else if path_and_query
                        .split('?')
                        .next()
                        .is_some_and(|path| path.starts_with("/webman/"))
                    {
                        // A canonical/global bootstrap is not a DSM landing.
                        // Reset only after actual DSM application HTML.
                        attempt.connector_ready(&state.target_origin);
                    }
                }
            }

            // ── P5: theme every other upstream 4xx/5xx ──
            //
            // P3 already short-circuited 401 + WWW-Authenticate: Basic
            // above; this branch handles everything else. We gate on
            // text/html (or missing Content-Type) because an API
            // consumer hitting /v1/something returning 404 with JSON
            // expects to see the JSON, not a themed page. The raw
            // upstream body lives in a `<details>` block on the
            // themed page so power users can still read it.
            if document_request && status_u16 >= 400 {
                let is_html_or_empty = content_type
                    .as_deref()
                    .map(|ct| {
                        let lc = ct.to_ascii_lowercase();
                        lc.contains("text/html") || lc.is_empty()
                    })
                    .unwrap_or(true); // missing Content-Type → assume HTML
                if is_html_or_empty {
                    // Mirror P2's web-recording capture so a themed
                    // error still shows up in any active HAR. (This
                    // is the only side effect the normal Ok-arm has
                    // before the body is sent; everything else
                    // downstream is response-shaping that we skip
                    // by returning early.)
                    if let Ok(mut recordings) = active_web_recordings().lock() {
                        if let Some(rec_state) = recordings.get_mut(&state.session_id) {
                            let timestamp_ms = rec_state.start_time.elapsed().as_millis() as u64;
                            let response_headers = if rec_state.record_headers {
                                redact_recording_headers(resp_hdrs.iter().filter_map(|(k, v)| {
                                    v.to_str()
                                        .ok()
                                        .map(|s| (k.as_str().to_string(), s.to_string()))
                                }))
                            } else {
                                HashMap::new()
                            };
                            rec_state.entries.push(WebRecordingEntry {
                                timestamp_ms,
                                method: method_str.clone(),
                                url: full_url.clone(),
                                request_headers: if rec_state.record_headers {
                                    recorded_request_headers(&state, &fwd_headers)
                                } else {
                                    HashMap::new()
                                },
                                request_body_size: body_bytes.len() as u64,
                                status: status_u16,
                                response_headers,
                                response_body_size: raw_bytes.len() as u64,
                                content_type: content_type.clone(),
                                duration_ms: req_start.elapsed().as_millis() as u64,
                                error: Some(format!("HTTP {}", status_u16)),
                            });
                        }
                    }
                    // P7: snapshot theme tokens for this render.
                    let theme = state.theme.read().map(|g| g.clone()).unwrap_or_default();
                    return crate::themed_status::themed_status_response(
                        status_u16,
                        &full_url,
                        &raw_bytes,
                        &theme,
                        &state.session_id,
                    );
                }
                // Non-HTML 4xx/5xx — pass through as-is so JSON/XML
                // API consumers see the real response.
            }

            // ── Web recording capture ──
            if let Ok(mut recordings) = active_web_recordings().lock() {
                if let Some(rec_state) = recordings.get_mut(&state.session_id) {
                    let timestamp_ms = rec_state.start_time.elapsed().as_millis() as u64;
                    let req_headers = if rec_state.record_headers {
                        recorded_request_headers(&state, &fwd_headers)
                    } else {
                        HashMap::new()
                    };
                    let resp_headers_map = if rec_state.record_headers {
                        redact_recording_headers(resp_hdrs.iter().filter_map(|(key, value)| {
                            value
                                .to_str()
                                .ok()
                                .map(|v| (key.as_str().to_string(), v.to_string()))
                        }))
                    } else {
                        HashMap::new()
                    };
                    rec_state.entries.push(WebRecordingEntry {
                        timestamp_ms,
                        method: method_str.clone(),
                        url: full_url.clone(),
                        request_headers: req_headers,
                        request_body_size: body_bytes.len() as u64,
                        status: status_u16,
                        response_headers: resp_headers_map,
                        response_body_size: raw_bytes.len() as u64,
                        content_type: content_type.clone(),
                        duration_ms: req_start.elapsed().as_millis() as u64,
                        error: None,
                    });
                }
            }

            // Preserve absolute URL semantics while routing matching-origin
            // resources through the protected proxy. Vendor fixes are strictly
            // versioned, not a global URL/Location override.
            let mut final_body = if is_rewritable && !state.target_origin.is_empty() {
                let text = String::from_utf8_lossy(&raw_bytes);
                let text = proxy_response::rewrite_target_origin(
                    &text,
                    &state.target_origin,
                    &state.proxy_origin,
                );
                let text = font_assets::rewrite(&text, &state.proxy_origin);
                // Apply the versioned adapter last: its deliberately bound
                // upstream discovery origin must not be rewritten to loopback.
                proxy_response::repair_quickconnect_redirect(
                    &text,
                    &request_url,
                    content_type.as_deref(),
                )
                .into_bytes()
            } else {
                raw_bytes
            };

            // Inject navigation reporter into HTML.
            let is_html =
                document_request && has_body && proxy_response::is_html(content_type.as_deref());
            if is_html && state.proxy_policy.page_scripts != PageScripts::Block {
                // Subresource requests must never replace the page identity or
                // consume/mint the page's automatic-login nonce.
                final_body = proxy_response::remove_known_framebreaker(&String::from_utf8_lossy(
                    &final_body,
                ))
                .into_bytes();
                let nav_script = "<script>try{window.parent.postMessage(\
                    {type:'proxy_navigate',url:location.href},'*')\
                    }catch(e){}</script>";
                // t20: when auto-login is armed for this session, also inject
                // the bootstrap that fetches the saved credential over the
                // nonce-guarded same-origin endpoint and fills + submits the
                // device login form. Returns None (and injects nothing extra)
                // when not armed. The injected HTML carries ONLY a per-page
                // nonce + non-secret selectors — never the credential.
                let autologin_script =
                    crate::themed_autologin::build_autologin_injection(&state, document_sequence)
                        .unwrap_or_default();
                // e5 hardened client asset defines
                // `window.__sorng_autologin.fetchCredsAndRun`, which the e3
                // bootstrap checks for and defers to. It MUST appear BEFORE the
                // bootstrap so the global exists when the bootstrap runs. Gate
                // it on the bootstrap being non-empty (i.e. auto-login armed) so
                // the asset is never shipped on non-armed pages.
                let autologin_asset = if autologin_script.is_empty() {
                    String::new()
                } else {
                    crate::autologin_asset::autologin_client_asset_script()
                };
                let injected_scripts =
                    format!("{}{}{}", nav_script, autologin_asset, autologin_script);
                let body_str = String::from_utf8_lossy(&final_body);
                final_body =
                    proxy_response::inject_page_scripts(&body_str, &injected_scripts).into_bytes();
                // Install before application scripts, independently of optional
                // auto-login. Readiness means DOM available, never authenticated.
                final_body = proxy_response::inject_readiness(
                    &String::from_utf8_lossy(&final_body),
                    &state.session_id,
                    navigation_token.as_deref(),
                    document_sequence,
                    &state.target_origin,
                    &state.proxy_origin,
                    &state.proxy_policy,
                )
                .into_bytes();
            }

            // Build response, stripping headers that block iframe display
            // or trigger browser auth prompts.
            let mut builder = Response::builder().status(status_u16);
            if is_html {
                if let Some(attempt) = &state.attempt {
                    // Seed only the four provider route hints onto a new
                    // loopback origin. A fresh upstream value/deletion wins.
                    for cookie in attempt.route_cookie_headers() {
                        let name = cookie
                            .to_str()
                            .ok()
                            .and_then(|v| v.split_once('='))
                            .map(|(n, _)| n);
                        let overridden = resp_hdrs.get_all("set-cookie").iter().any(|value| {
                            value
                                .to_str()
                                .ok()
                                .and_then(|v| v.split_once('='))
                                .map(|(n, _)| n.trim())
                                == name
                        });
                        if !overridden {
                            builder = builder.header("Set-Cookie", cookie);
                        }
                    }
                }
            }
            for (key, value) in resp_hdrs.iter() {
                let k = key.as_str().to_lowercase();
                if (is_rewritable && proxy_response::invalidated_header(&k))
                    || (state.proxy_policy.cache_mode == CacheMode::Bypass
                        && matches!(
                            k.as_str(),
                            "cache-control" | "expires" | "etag" | "last-modified" | "pragma"
                        ))
                    || k == "transfer-encoding"
                    || k == "connection"
                    || k == "content-length"
                    || k == "www-authenticate"
                    || k == "proxy-authenticate"
                    || k == "x-frame-options"
                    || k == "content-security-policy"
                    || k == "content-security-policy-report-only"
                    || k == "access-control-allow-origin"
                    || k == "access-control-allow-credentials"
                {
                    continue;
                }
                if let Ok(v) = value.to_str() {
                    builder = builder.header(key.as_str(), v);
                }
            }
            if let Some(ct) = &content_type {
                builder = builder.header("Content-Type", ct.as_str());
            }
            if is_rewritable || state.proxy_policy.cache_mode == CacheMode::Bypass {
                builder = builder.header("Cache-Control", "no-store");
            }
            if is_html {
                if let Some(policy) = state.proxy_policy.content_security_policy() {
                    builder = builder.header("Content-Security-Policy", policy);
                }
            }
            builder = builder.header("Content-Length", final_body.len().to_string());
            builder = builder.header("Access-Control-Allow-Origin", state.proxy_origin.as_str());
            builder = builder.header("Access-Control-Allow-Credentials", "true");

            builder.body(Body::from(final_body)).unwrap_or_else(|_| {
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::from("Internal error building response"))
                    .expect("valid HTTP response")
            })
        }
        Err(e) => {
            // P2: themed HTML error page in place of the plain-text
            let cycle_edge = match &e {
                upstream::UpstreamError::CrossOriginRedirect(redirect)
                    if document_request
                        && navigation_token.is_some()
                        && matches!(method_str.as_str(), "GET" | "HEAD")
                        && body_bytes.is_empty() =>
                {
                    http_cycle_edge(&state, redirect, &fwd_headers, document_sequence)
                }
                _ => None,
            };
            let cycle_blocked = state
                .attempt
                .as_ref()
                .is_some_and(|attempt| attempt.http_redirect_cycle_blocked(cycle_edge.as_ref()));
            let redirect_review_available =
                if let upstream::UpstreamError::CrossOriginRedirect(redirect) = &e {
                    !cycle_blocked
                        && document_request
                        && matches!(method_str.as_str(), "GET" | "HEAD")
                        && body_bytes.is_empty()
                        && redirect::record_with_edge_and_referrer(
                            &state,
                            &redirect.destination,
                            document_sequence,
                            navigation_token.clone(),
                            cycle_edge,
                            redirect.suppress_referrer,
                        )
                } else {
                    false
                };
            let default_handoff = redirect_review_available
                && matches!(&e, upstream::UpstreamError::CrossOriginRedirect(redirect)
                    if quickconnect::default_handoff(&state, &redirect.destination));
            // 502. Categorize the reqwest error, then render a page
            // whose layout, palette, and iconography match the app's
            // own error views (GenericErrorView / FeatureErrorBoundary).
            let kind = if cycle_blocked {
                crate::themed_errors::ProxyErrorKind::RedirectLoop
            } else {
                match &e {
                    upstream::UpstreamError::Transport(error) => {
                        crate::themed_errors::categorize_reqwest_error(error)
                    }
                    upstream::UpstreamError::Policy(_) => {
                        crate::themed_errors::ProxyErrorKind::BadRequest
                    }
                    upstream::UpstreamError::RedirectLoop => {
                        crate::themed_errors::ProxyErrorKind::RedirectLoop
                    }
                    upstream::UpstreamError::CrossOriginRedirect(redirect) => {
                        if redirect_review_available {
                            crate::themed_errors::ProxyErrorKind::RedirectReview
                        } else if state.target_url.starts_with("https:")
                            && redirect.destination.scheme() == "http"
                        {
                            crate::themed_errors::ProxyErrorKind::InsecureRedirect
                        } else {
                            crate::themed_errors::ProxyErrorKind::CrossOriginRedirect
                        }
                    }
                    upstream::UpstreamError::Deadline => {
                        crate::themed_errors::ProxyErrorKind::Timeout
                    }
                }
            };
            // Never surface the raw reqwest error here. When an app-level
            // upstream proxy is configured its connector error may contain the
            // proxy authority or embedded credentials. The category and stable
            // hint retain actionable context without copying transport URLs or
            // secrets into themed pages, manager state, recordings, or logs.
            let (diagnostic_stage, diagnostic_code, diagnostic_outcome) = if cycle_blocked {
                ("handoff", "quickconnect_redirect_loop", "failed")
            } else {
                match &e {
                    upstream::UpstreamError::Transport(error) if error.is_timeout() => {
                        ("connect_tls", "http_timeout", "timed_out")
                    }
                    upstream::UpstreamError::Transport(_) => {
                        ("connect_tls", "http_transport_failed", "failed")
                    }
                    upstream::UpstreamError::Policy(_) => {
                        ("validation", "http_policy_refused", "refused")
                    }
                    upstream::UpstreamError::RedirectLoop => {
                        ("handoff", "http_redirect_loop", "failed")
                    }
                    upstream::UpstreamError::CrossOriginRedirect(_)
                        if redirect_review_available =>
                    {
                        (
                            "handoff",
                            "http_redirect_review",
                            if default_handoff {
                                "continuing"
                            } else {
                                "review_required"
                            },
                        )
                    }
                    upstream::UpstreamError::CrossOriginRedirect(_) => {
                        ("handoff", "http_policy_refused", "refused")
                    }
                    upstream::UpstreamError::Deadline => {
                        ("connect_tls", "http_timeout", "timed_out")
                    }
                }
            };
            let mut diagnostic = ProxyLogDiagnostic::new(
                if cycle_blocked {
                    "quickconnect_redirect"
                } else {
                    "http"
                },
                diagnostic_stage,
                diagnostic_code,
                diagnostic_outcome,
                req_start,
            );
            if let upstream::UpstreamError::CrossOriginRedirect(redirect) = &e {
                diagnostic = diagnostic.with_redirect(redirect);
            }
            let err_msg = if cycle_blocked {
                "QuickConnect repeated the same regional-to-alias HTTP redirect circuit after one retry. No further destination was opened; the relay routing cause remains unresolved.".to_string()
            } else {
                match e {
                upstream::UpstreamError::Policy(message) => message.to_string(),
                upstream::UpstreamError::CrossOriginRedirect(_) => kind.hint().to_string(),
                upstream::UpstreamError::RedirectLoop => format!("The upstream exceeded {} redirects in one navigation. Review the destination and reverse-proxy configuration; no further request was sent.", same_origin_redirect_limit(state.redirect_profile)),
                upstream::UpstreamError::Deadline => "The complete upstream request timed out while negotiating authentication or redirects.".to_string(),
                upstream::UpstreamError::Transport(_) => {
                    format!("Upstream request failed ({}): {}", kind.code(), kind.hint())
                }
            }
            };
            let themed_status = if default_handoff {
                202
            } else {
                kind.status().as_u16()
            };
            let recorded_error = (!redirect_review_available).then(|| err_msg.clone());

            state.request_count.fetch_add(1, Ordering::Relaxed);
            if !redirect_review_available {
                state.error_count.fetch_add(1, Ordering::Relaxed);
                if let Ok(mut le) = state.last_error.lock() {
                    *le = Some(err_msg.clone());
                }
            }

            if let Ok(mut mgr) = state.global_sessions.lock() {
                mgr.record_request(ProxyRequestLogEntry {
                    id: String::new(),
                    session_id: state.session_id.clone(),
                    method: method_str.clone(),
                    url: full_url.clone(),
                    // Log the *themed* status so the manager UI matches
                    // what the iframe actually received. The kind is
                    // recoverable from this status (4xx vs 5xx) plus
                    // last_error for richer hints.
                    status: themed_status,
                    error: recorded_error.clone(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    diagnostic: Some(session_diagnostic(&state, diagnostic)),
                });
            }

            // ── Web recording capture (error) ──
            if let Ok(mut recordings) = active_web_recordings().lock() {
                if let Some(rec_state) = recordings.get_mut(&state.session_id) {
                    let timestamp_ms = rec_state.start_time.elapsed().as_millis() as u64;
                    rec_state.entries.push(WebRecordingEntry {
                        timestamp_ms,
                        method: method_str.clone(),
                        url: full_url.clone(),
                        request_headers: if rec_state.record_headers {
                            recorded_request_headers(&state, &fwd_headers)
                        } else {
                            HashMap::new()
                        },
                        request_body_size: body_bytes.len() as u64,
                        status: themed_status,
                        response_headers: HashMap::new(),
                        response_body_size: 0,
                        content_type: None,
                        duration_ms: req_start.elapsed().as_millis() as u64,
                        error: recorded_error,
                    });
                }
            }

            // P7: snapshot theme tokens for this render.
            if default_handoff {
                return quickconnect::pending_response(&state, &full_url);
            }
            let theme = state.theme.read().map(|g| g.clone()).unwrap_or_default();
            crate::themed_errors::themed_error_response(
                kind,
                &full_url,
                &err_msg,
                &theme,
                &state.session_id,
            )
        }
    }
}

/// Form payload submitted by the themed inline auth challenge (P3).
/// Field names mirror the `<input name="...">` tags in
/// `themed_auth::render_challenge_page`.
#[derive(Debug, Deserialize)]
pub struct ThemedAuthForm {
    pub username: String,
    pub password: String,
    pub nonce: String,
    /// Path on the proxy the user was trying to reach when the
    /// challenge fired. We 303-redirect here after the credentials
    /// land so the iframe re-fetches the real content.
    pub return_to: String,
}

/// `POST /__sortofremoteng_auth` handler — receives credentials from
/// the themed challenge form, validates the per-challenge nonce,
/// updates the live session credentials, emits a frontend event so
/// the React side can offer to persist them, and 303-redirects the
/// iframe back to the originally requested path.
///
/// A failed nonce check returns 400 so a hostile sibling tab on
/// 127.0.0.1 can't spoof credential updates. The nonce is consumed
/// after a successful update — re-submissions must re-fetch a fresh
/// challenge page first.
pub async fn themed_auth_post_handler(
    axum::extract::State(state): axum::extract::State<Arc<AxumProxyState>>,
    axum::extract::Form(form): axum::extract::Form<ThemedAuthForm>,
) -> axum::response::Response {
    use axum::body::Body;
    use axum::http::{Response, StatusCode};

    // Manual/form-only sessions cannot honor a Basic login.
    // Refuse before consuming a nonce or changing any session credentials.
    if !state.upstream_auth_mode.accepts_basic_challenge() {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Body::from(
                "HTTP Basic authentication is disabled for this session",
            ))
            .expect("valid HTTP response");
    }

    // Nonce check. Consume on success so the same nonce can't fire
    // twice — a fresh challenge is needed each time.
    let nonce_matches = {
        let mut slot = match state.pending_nonce.write() {
            Ok(g) => g,
            Err(_) => {
                return Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::from("pending_nonce lock poisoned"))
                    .expect("valid HTTP response");
            }
        };
        match slot.as_ref() {
            Some(stored) if stored == &form.nonce => {
                *slot = None; // consume
                true
            }
            _ => false,
        }
    };
    if !nonce_matches {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(Body::from("Invalid or expired auth challenge nonce."))
            .expect("valid HTTP response");
    }

    // Defensive: refuse a `return_to` that isn't a same-origin path.
    // Anything starting with a scheme or `//` could be an open
    // redirect; force it to start with a single `/`.
    let safe_return = if form.return_to.starts_with('/') && !form.return_to.starts_with("//") {
        form.return_to.clone()
    } else {
        "/".to_string()
    };

    // Apply credentials to the live axum state.
    if let Ok(mut g) = state.username.write() {
        *g = form.username.clone();
    }
    if let Ok(mut g) = state.password.write() {
        *g = form.password.clone();
    }

    // Mirror into the persistent ProxySessionEntry so a later
    // `restart_proxy_session` carries them forward — and so the
    // manager UI sees the updated username (passwords aren't
    // surfaced there).
    if let Ok(mut mgr) = state.global_sessions.lock() {
        if let Some(entry) = mgr.sessions.get_mut(&state.session_id) {
            entry.username = form.username.clone();
            entry.password = form.password.clone();
        }
    }

    // Emit a Tauri event so React can offer to save the creds into
    // the underlying connection record. Payload deliberately omits
    // the password — passwords belong in the backend session, not
    // JS strings. Frontend matches on session_id / connection_id
    // and surfaces a toast bound to the connection.
    if let Some(notify) = &state.credentials_applied {
        notify(serde_json::json!({
            "session_id": state.session_id,
            "connection_id": state.connection_id,
            "username": form.username,
        }));
    }
    // 303 See Other forces the browser to GET the redirect target
    // — even though this was a POST — which is what we want so the
    // iframe re-fetches the original content through the now-
    // authenticated proxy.
    Response::builder()
        .status(StatusCode::SEE_OTHER)
        .header("Location", safe_return)
        .header("Cache-Control", "no-store")
        .body(Body::empty())
        .expect("valid HTTP response")
}

// -----------------------------------------------------------------------
// Tauri commands
// -----------------------------------------------------------------------

/// Health-check result for a proxy session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyHealthResult {
    pub session_id: String,
    pub alive: bool,
    pub port: u16,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// TLS Certificate Info
// ---------------------------------------------------------------------------

#[path = "http_certificate.rs"]
mod certificate;
pub use certificate::{
    capture_peer_certificate_chain, parse_chain_entry_from_der, parse_tls_certificate_details,
    ParsedTlsCertificateDetails, TlsCertificateChainEntry, TlsCertificateInfo,
};

// ─── Deep HTTP/HTTPS Connection Diagnostics ─────────────────────────────────

pub use sorng_core::diagnostics::{self as diagnostics, DiagnosticReport, DiagnosticStep};
// http_cmds.rs is also included by commands-core, whose root does not expose
// themed_auth; keep the shared scheme-only parser accessible via http.
pub use crate::themed_auth::authentication_challenge_schemes;

// t20: re-export the web auto-login credential endpoint path + handler through
// the `http` module so they resolve via `crate::http::...` from BOTH crates that
// share `http_cmds.rs`. `http_cmds.rs` is `include!`-ed into `sorng-commands-core`
// (whose crate root has no `themed_autologin` module), so a direct
// `crate::themed_autologin::...` path fails there. Routing through `http` mirrors
// the existing `crate::http::themed_auth_post_handler` pattern: both crate roots
// expose a `http` module that re-exports from this file.
pub use crate::themed_autologin::{
    autologin_cred_handler, validate_reviewed_login_config, AUTOLOGIN_PATH,
};

// ─── Web Session Recording Commands ──────────────────────────────
