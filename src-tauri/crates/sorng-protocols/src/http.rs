//! HTTP connection service for fetching web pages with authentication.
//!
//! Provides functionality to fetch web content with various authentication methods
//! including basic auth, bearer tokens, and custom headers.

use serde::{Deserialize, Serialize};
pub use sha2::{Digest, Sha256};
pub use std::collections::HashMap;
pub use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
pub use std::sync::Arc;
use std::sync::OnceLock;
use tokio::sync::Mutex;

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

pub fn build_pinned_tls_config(fingerprint: String) -> Result<rustls::ClientConfig, String> {
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

/// Build a `TlsCertificateChainEntry` from DER-encoded certificate bytes.
#[cfg(feature = "tls-cert-details")]
pub fn parse_chain_entry_from_der(der: &[u8]) -> Option<TlsCertificateChainEntry> {
    let (_rem, cert) = x509_parser::parse_x509_certificate(der).ok()?;

    let mut hasher = Sha256::new();
    hasher.update(der);
    let fp = hex::encode(hasher.finalize());

    Some(TlsCertificateChainEntry {
        subject: cert.subject().to_string(),
        issuer: cert.issuer().to_string(),
        fingerprint: fp,
        valid_from: cert.validity().not_before.to_rfc2822().unwrap_or_default(),
        valid_to: cert.validity().not_after.to_rfc2822().unwrap_or_default(),
    })
}

/// Fallback chain entry parser when tls-cert-details is disabled.
#[cfg(not(feature = "tls-cert-details"))]
pub fn parse_chain_entry_from_der(der: &[u8]) -> Option<TlsCertificateChainEntry> {
    let mut hasher = Sha256::new();
    hasher.update(der);
    let fp = hex::encode(hasher.finalize());

    Some(TlsCertificateChainEntry {
        subject: String::new(),
        issuer: String::new(),
        fingerprint: fp,
        valid_from: String::new(),
        valid_to: String::new(),
    })
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

/// Configuration for the basic auth proxy mediator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BasicAuthProxyConfig {
    /// The target URL to proxy requests to
    pub target_url: String,
    /// Username for basic authentication
    pub username: String,
    /// Password for basic authentication
    pub password: String,
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
    /// Minimum TLS version for outbound requests ("1.0", "1.1", "1.2", "1.3").
    /// Defaults to "1.2".  SSL 3.0 is NOT supported by the TLS backend.
    #[serde(default = "default_min_tls_version")]
    pub min_tls_version: String,
    /// Connection ID that owns this proxy session (for per-connection isolation)
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

/// Response from starting the proxy mediator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyMediatorResponse {
    /// The local port the proxy is listening on
    pub local_port: u16,
    /// Session ID for managing the proxy
    pub session_id: String,
    /// The proxied URL to use
    pub proxy_url: String,
}

/// Proxy session tracking using a local TCP server (axum on 127.0.0.1:0).
///
/// Each proxy session spawns a lightweight HTTP server on a random port.
/// The iframe loads from `http://127.0.0.1:{port}/` and every sub-resource
/// request (CSS, JS, images, fonts) is forwarded to the target URL with
/// authentication headers automatically injected. This approach works with
/// all WebView2 versions (unlike custom URI scheme handlers which require
/// ICoreWebView2_22 for iframe support).
/// Tracks active proxy mediator sessions so they can be stopped.
pub struct ProxySessionManager {
    pub sessions: HashMap<String, ProxySessionEntry>,
    /// Global request log (last N entries, ring buffer style).
    pub request_log: Vec<ProxyRequestLogEntry>,
}

pub struct ProxySessionEntry {
    pub target_url: String,
    pub username: String,
    pub password: String,
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
    pub request_count: Arc<AtomicU64>,
    pub error_count: Arc<AtomicU64>,
    pub last_error: Arc<std::sync::Mutex<Option<String>>>,
    /// Send `()` to shut down the axum server for this session.
    pub shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

/// A single entry in the proxy request log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyRequestLogEntry {
    pub session_id: String,
    pub method: String,
    pub url: String,
    pub status: u16,
    pub error: Option<String>,
    pub timestamp: String,
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
}

impl ProxySessionManager {
    pub fn new() -> Arc<std::sync::Mutex<Self>> {
        Arc::new(std::sync::Mutex::new(Self {
            sessions: HashMap::new(),
            request_log: Vec::new(),
        }))
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
/// `app` is the Tauri `AppHandle`, threaded in so the auth handler
/// can emit `proxy-credentials-applied` to the frontend (which the
/// React side listens for, then offers a "save these credentials?"
/// toast).
#[derive(Clone)]
pub struct AxumProxyState {
    pub session_id: String,
    pub connection_id: String,
    pub target_url: String,
    pub username: Arc<std::sync::RwLock<String>>,
    pub password: Arc<std::sync::RwLock<String>>,
    pub pending_nonce: Arc<std::sync::RwLock<Option<String>>>,
    /// P7: live snapshot of the frontend's `:root --color-*` tokens.
    /// `RwLock` so a new `update_proxy_theme(session_id, tokens)` IPC
    /// (planned follow-up) can push live updates when the user
    /// changes themes mid-session without restarting the proxy.
    pub theme: Arc<std::sync::RwLock<crate::theme_tokens::ThemeTokens>>,
    pub target_origin: String,
    /// t20 web auto-login: armed when `config.http_auto_login` is set for this
    /// session. Disarmed after the first credential hand-out (single-shot — a
    /// re-rendered login-error page cannot loop the proxy into re-dispensing).
    pub auto_login_armed: Arc<AtomicBool>,
    /// t20: per-page nonce for the auto-login credential endpoint. A SEPARATE
    /// slot from `pending_nonce` (different lifecycle: auto-login arms on an
    /// armed HTML page, themed-auth arms on a 401). Minted on each injected
    /// page; consumed on first read by `autologin_cred_handler`.
    pub auto_login_nonce: Arc<std::sync::RwLock<Option<String>>>,
    /// t20: optional CSS-selector overrides for the device login form
    /// (authoritative when set). Non-secret; passed through to the injected
    /// client so a set-but-unmatched selector means "do not fill".
    pub auto_login_selectors: Option<HttpAutoLoginSelectors>,
    pub client: reqwest::Client,
    pub request_count: Arc<AtomicU64>,
    pub error_count: Arc<AtomicU64>,
    pub last_error: Arc<std::sync::Mutex<Option<String>>>,
    pub global_sessions: ProxySessionManagerState,
    pub app: tauri::AppHandle,
}

/// Axum fallback handler — proxies every request to the target server.
///
/// Includes one automatic retry for transient connection errors (connection
/// reset, pool errors, timeouts on idle connections) that commonly occur when
/// the upstream server silently closes keep-alive connections.
pub async fn axum_proxy_handler(
    axum::extract::State(state): axum::extract::State<Arc<AxumProxyState>>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::body::Body;
    use axum::http::{Response, StatusCode};

    let method = req.method().clone();
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str().to_string())
        .unwrap_or_else(|| "/".to_string());

    let full_url = format!(
        "{}{}",
        state.target_url.trim_end_matches('/'),
        path_and_query
    );

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

    // Collect request headers for potential retry.
    let mut fwd_headers: Vec<(String, String)> = Vec::new();
    for (key, value) in req.headers() {
        let k = key.as_str().to_lowercase();
        if k == "authorization"
            || k == "host"
            || k == "connection"
            || k == "proxy-authorization"
            || k == "transfer-encoding"
        {
            continue;
        }
        // Rewrite Referer/Origin that point to the local proxy back to target.
        if k == "referer" || k == "origin" {
            if let Ok(v) = value.to_str() {
                if v.contains("127.0.0.1") {
                    fwd_headers.push((
                        key.as_str().to_string(),
                        format!("{}/", state.target_origin),
                    ));
                    continue;
                }
            }
        }
        if let Ok(v) = value.to_str() {
            fwd_headers.push((key.as_str().to_string(), v.to_string()));
        }
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

    /// Build and send one upstream request.
    async fn send_upstream(
        state: &AxumProxyState,
        method: &reqwest::Method,
        url: &str,
        headers: &[(String, String)],
        body: &[u8],
    ) -> Result<reqwest::Response, reqwest::Error> {
        let mut upstream = state.client.request(method.clone(), url);
        // P3: credentials live behind a RwLock so the themed-auth
        // POST handler can update them. Read briefly into owned
        // strings — the lock guard must not be held across the
        // .send().await below or we'd serialise all upstream
        // requests for this session through the lock.
        let (user, pass): (String, String) = {
            let u = state.username.read().map(|g| g.clone()).unwrap_or_default();
            let p = state.password.read().map(|g| g.clone()).unwrap_or_default();
            (u, p)
        };
        if !user.is_empty() || !pass.is_empty() {
            upstream = upstream.basic_auth(&user, Some(&pass));
        }
        for (k, v) in headers {
            upstream = upstream.header(k.as_str(), v.as_str());
        }
        if !body.is_empty() {
            upstream = upstream.body(body.to_vec());
        }
        upstream.send().await
    }

    // Try once, and retry on transient failures.
    let req_start = std::time::Instant::now();
    let result = match send_upstream(
        &state,
        &reqwest_method,
        &full_url,
        &fwd_headers,
        &body_bytes,
    )
    .await
    {
        Ok(resp) => Ok(resp),
        Err(e) if is_retryable(&e) => {
            // Brief pause before retry
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            send_upstream(
                &state,
                &reqwest_method,
                &full_url,
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
                if let Ok(mut le) = state.last_error.lock() {
                    *le = Some(format!("HTTP {} for {}", status_u16, full_url));
                }
            }

            // Log the request.
            if let Ok(mut mgr) = state.global_sessions.lock() {
                if mgr.request_log.len() >= 1000 {
                    mgr.request_log.remove(0);
                }
                mgr.request_log.push(ProxyRequestLogEntry {
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
                });
            }

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
            if matches!(
                crate::themed_auth::intercept_basic_auth_challenge(status_u16, &www_auth_values,),
                crate::themed_auth::ChallengeDecision::Challenge,
            ) {
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
                    // A saved username exists but the server still
                    // refused, so the saved password is probably
                    // wrong — surface that distinct case to the user.
                    Some("The saved password was rejected by the server. Try again.")
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

            let resp_hdrs = resp.headers().clone();
            let content_type = resp_hdrs
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            let raw_bytes = match resp.bytes().await {
                Ok(b) => b.to_vec(),
                Err(e) => {
                    return Response::builder()
                        .status(StatusCode::BAD_GATEWAY)
                        .body(Body::from(format!(
                            "Failed to read upstream response: {}",
                            e
                        )))
                        .expect("valid HTTP response");
                }
            };

            // ── P5: theme every other upstream 4xx/5xx ──
            //
            // P3 already short-circuited 401 + WWW-Authenticate: Basic
            // above; this branch handles everything else. We gate on
            // text/html (or missing Content-Type) because an API
            // consumer hitting /v1/something returning 404 with JSON
            // expects to see the JSON, not a themed page. The raw
            // upstream body lives in a `<details>` block on the
            // themed page so power users can still read it.
            if status_u16 >= 400 {
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
                            let mut response_headers: HashMap<String, String> = HashMap::new();
                            if rec_state.record_headers {
                                for (k, v) in resp_hdrs.iter() {
                                    if let Ok(s) = v.to_str() {
                                        response_headers
                                            .insert(k.as_str().to_string(), s.to_string());
                                    }
                                }
                            }
                            rec_state.entries.push(WebRecordingEntry {
                                timestamp_ms,
                                method: method_str.clone(),
                                url: full_url.clone(),
                                request_headers: if rec_state.record_headers {
                                    fwd_headers
                                        .iter()
                                        .map(|(k, v)| (k.clone(), v.clone()))
                                        .collect()
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
                        status_u16, &full_url, &raw_bytes, &theme,
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
                        fwd_headers
                            .iter()
                            .map(|(k, v)| (k.clone(), v.clone()))
                            .collect()
                    } else {
                        HashMap::new()
                    };
                    let resp_headers_map = if rec_state.record_headers {
                        let mut h = HashMap::new();
                        for (key, value) in resp_hdrs.iter() {
                            if let Ok(v) = value.to_str() {
                                h.insert(key.as_str().to_string(), v.to_string());
                            }
                        }
                        h
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

            // Rewrite absolute target URLs in text responses so that
            // sub-resources resolve through the local proxy.
            let is_rewritable = content_type
                .as_deref()
                .map(|ct| {
                    ct.contains("text/html")
                        || ct.contains("text/css")
                        || ct.contains("application/javascript")
                        || ct.contains("text/javascript")
                })
                .unwrap_or(false);

            let mut final_body = if is_rewritable && !state.target_origin.is_empty() {
                let text = String::from_utf8_lossy(&raw_bytes);
                text.replace(&state.target_origin, "").into_bytes()
            } else {
                raw_bytes
            };

            // Inject navigation reporter into HTML.
            let is_html = content_type
                .as_deref()
                .map(|ct| ct.contains("text/html"))
                .unwrap_or(false);
            if is_html {
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
                    crate::themed_autologin::build_autologin_injection(&state).unwrap_or_default();
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
                if body_str.contains("</body>") {
                    let injected =
                        body_str.replacen("</body>", &format!("{}</body>", injected_scripts), 1);
                    final_body = injected.into_bytes();
                } else {
                    final_body.extend_from_slice(injected_scripts.as_bytes());
                }
            }

            // Build response, stripping headers that block iframe display
            // or trigger browser auth prompts.
            let mut builder = Response::builder().status(status_u16);
            for (key, value) in resp_hdrs.iter() {
                let k = key.as_str().to_lowercase();
                if k == "transfer-encoding"
                    || k == "connection"
                    || k == "content-length"
                    || k == "www-authenticate"
                    || k == "proxy-authenticate"
                    || k == "x-frame-options"
                    || k == "content-security-policy"
                    || k == "content-security-policy-report-only"
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
            builder = builder.header("Content-Length", final_body.len().to_string());
            builder = builder.header("Access-Control-Allow-Origin", "*");

            builder.body(Body::from(final_body)).unwrap_or_else(|_| {
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::from("Internal error building response"))
                    .expect("valid HTTP response")
            })
        }
        Err(e) => {
            // P2: themed HTML error page in place of the plain-text
            // 502. Categorize the reqwest error, then render a page
            // whose layout, palette, and iconography match the app's
            // own error views (GenericErrorView / FeatureErrorBoundary).
            let kind = crate::themed_errors::categorize_reqwest_error(&e);
            let err_msg = format!("Upstream request failed: {}", e);
            let themed_status = kind.status().as_u16();

            state.request_count.fetch_add(1, Ordering::Relaxed);
            state.error_count.fetch_add(1, Ordering::Relaxed);
            if let Ok(mut le) = state.last_error.lock() {
                *le = Some(err_msg.clone());
            }

            if let Ok(mut mgr) = state.global_sessions.lock() {
                if mgr.request_log.len() >= 1000 {
                    mgr.request_log.remove(0);
                }
                mgr.request_log.push(ProxyRequestLogEntry {
                    session_id: state.session_id.clone(),
                    method: method_str.clone(),
                    url: full_url.clone(),
                    // Log the *themed* status so the manager UI matches
                    // what the iframe actually received. The kind is
                    // recoverable from this status (4xx vs 5xx) plus
                    // last_error for richer hints.
                    status: themed_status,
                    error: Some(err_msg.clone()),
                    timestamp: chrono::Utc::now().to_rfc3339(),
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
                            fwd_headers
                                .iter()
                                .map(|(k, v)| (k.clone(), v.clone()))
                                .collect()
                        } else {
                            HashMap::new()
                        },
                        request_body_size: body_bytes.len() as u64,
                        status: themed_status,
                        response_headers: HashMap::new(),
                        response_body_size: 0,
                        content_type: None,
                        duration_ms: req_start.elapsed().as_millis() as u64,
                        error: Some(err_msg.clone()),
                    });
                }
            }

            // P7: snapshot theme tokens for this render.
            let theme = state.theme.read().map(|g| g.clone()).unwrap_or_default();
            crate::themed_errors::themed_error_response(kind, &full_url, &err_msg, &theme)
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
    use tauri::Emitter;
    let _ = state.app.emit(
        "proxy-credentials-applied",
        serde_json::json!({
            "session_id": state.session_id,
            "connection_id": state.connection_id,
            "username": form.username,
        }),
    );

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

/// A single entry in the certificate chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsCertificateChainEntry {
    pub subject: String,
    pub issuer: String,
    pub fingerprint: String,
    pub valid_from: String,
    pub valid_to: String,
}

/// Certificate information returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsCertificateInfo {
    /// SHA-256 fingerprint (hex-encoded)
    pub fingerprint: String,
    /// Full subject DN string
    pub subject: Option<String>,
    /// Full issuer DN string
    pub issuer: Option<String>,
    /// PEM-encoded certificate
    pub pem: Option<String>,
    /// Not-before (ISO-8601)
    pub valid_from: Option<String>,
    /// Not-after (ISO-8601)
    pub valid_to: Option<String>,
    /// Serial number (hex)
    pub serial: Option<String>,
    /// Signature algorithm
    pub signature_algorithm: Option<String>,
    /// Subject Alternative Names
    pub san: Vec<String>,

    // ── Parsed subject DN components ──
    pub subject_cn: Option<String>,
    pub subject_org: Option<String>,
    pub subject_ou: Option<String>,
    pub subject_country: Option<String>,
    pub subject_state: Option<String>,
    pub subject_locality: Option<String>,
    pub subject_email: Option<String>,

    // ── Parsed issuer DN components ──
    pub issuer_cn: Option<String>,
    pub issuer_org: Option<String>,
    pub issuer_country: Option<String>,

    // ── Key and version info ──
    pub key_algorithm: Option<String>,
    pub key_size: Option<u32>,
    pub version: Option<u32>,

    // ── Certificate chain ──
    pub chain: Vec<TlsCertificateChainEntry>,
}

#[derive(Default)]
pub struct ParsedTlsCertificateDetails {
    pub subject: Option<String>,
    pub issuer: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub serial: Option<String>,
    pub signature_algorithm: Option<String>,
    pub san: Vec<String>,
    pub diagnostic_detail: Option<String>,

    // ── Parsed subject DN components ──
    pub subject_cn: Option<String>,
    pub subject_org: Option<String>,
    pub subject_ou: Option<String>,
    pub subject_country: Option<String>,
    pub subject_state: Option<String>,
    pub subject_locality: Option<String>,
    pub subject_email: Option<String>,

    // ── Parsed issuer DN components ──
    pub issuer_cn: Option<String>,
    pub issuer_org: Option<String>,
    pub issuer_country: Option<String>,

    // ── Key and version info ──
    pub key_algorithm: Option<String>,
    pub key_size: Option<u32>,
    pub version: Option<u32>,
}

#[cfg(feature = "tls-cert-details")]
fn extract_dn_attr(
    name: &x509_parser::x509::X509Name<'_>,
    oid: &x509_parser::oid_registry::Oid,
) -> Option<String> {
    name.iter()
        .flat_map(|rdn| rdn.iter())
        .find(|attr| attr.attr_type() == oid)
        .and_then(|attr| attr.as_str().ok())
        .map(|s| s.to_string())
}

#[cfg(feature = "tls-cert-details")]
fn resolve_key_algorithm_and_size(
    cert: &x509_parser::certificate::X509Certificate<'_>,
) -> (Option<String>, Option<u32>) {
    let spki = cert.public_key();
    let algo_oid = spki.algorithm.algorithm.to_id_string();

    // OIDs for public key algorithms
    let (algo_name, key_size) = match algo_oid.as_str() {
        // RSA
        "1.2.840.113549.1.1.1" => {
            let bit_len = spki.parsed().ok().and_then(|pk| {
                if let x509_parser::public_key::PublicKey::RSA(rsa) = pk {
                    Some(rsa.key_size() as u32)
                } else {
                    None
                }
            });
            ("RSA".to_string(), bit_len)
        }
        // EC public key (the curve determines the size)
        "1.2.840.10045.2.1" => {
            let curve_size = spki.algorithm.parameters.as_ref().and_then(|params| {
                // Try to read the curve OID from the algorithm parameters
                params.as_oid().ok().map(|curve_oid| {
                    let curve_str = curve_oid.to_id_string();
                    match curve_str.as_str() {
                        "1.2.840.10045.3.1.7" => ("ECDSA (P-256)".to_string(), 256u32), // secp256r1 / prime256v1
                        "1.3.132.0.34" => ("ECDSA (P-384)".to_string(), 384u32),        // secp384r1
                        "1.3.132.0.35" => ("ECDSA (P-521)".to_string(), 521u32),        // secp521r1
                        _ => (format!("ECDSA ({})", curve_str), 0u32),
                    }
                })
            });
            match curve_size {
                Some((name, size)) => (name, if size > 0 { Some(size) } else { None }),
                None => ("ECDSA".to_string(), None),
            }
        }
        // Ed25519
        "1.3.101.112" => ("Ed25519".to_string(), Some(256)),
        // Ed448
        "1.3.101.113" => ("Ed448".to_string(), Some(456)),
        // DSA
        "1.2.840.10040.4.1" => ("DSA".to_string(), None),
        other => (other.to_string(), None),
    };

    (Some(algo_name), key_size)
}

#[cfg(feature = "tls-cert-details")]
pub fn parse_tls_certificate_details(der: &[u8], fingerprint: &str) -> ParsedTlsCertificateDetails {
    use x509_parser::oid_registry::Oid;

    let mut details = ParsedTlsCertificateDetails::default();

    if let Ok((_rem, cert)) = x509_parser::parse_x509_certificate(der) {
        details.subject = Some(cert.subject().to_string());
        details.issuer = Some(cert.issuer().to_string());
        details.valid_from = Some(cert.validity().not_before.to_rfc2822().unwrap_or_default());
        details.valid_to = Some(cert.validity().not_after.to_rfc2822().unwrap_or_default());
        details.serial = Some(cert.raw_serial_as_string());
        details.signature_algorithm = Some(cert.signature_algorithm.algorithm.to_id_string());

        // ── Subject DN components ──
        // OIDs: CN=2.5.4.3, O=2.5.4.10, OU=2.5.4.11, C=2.5.4.6, ST=2.5.4.8, L=2.5.4.7, emailAddress=1.2.840.113549.1.9.1
        let oid_cn = Oid::from(&[2, 5, 4, 3]).expect("valid OID constant");
        let oid_o = Oid::from(&[2, 5, 4, 10]).expect("valid OID constant");
        let oid_ou = Oid::from(&[2, 5, 4, 11]).expect("valid OID constant");
        let oid_c = Oid::from(&[2, 5, 4, 6]).expect("valid OID constant");
        let oid_st = Oid::from(&[2, 5, 4, 8]).expect("valid OID constant");
        let oid_l = Oid::from(&[2, 5, 4, 7]).expect("valid OID constant");
        let oid_email = Oid::from(&[1, 2, 840, 113549, 1, 9, 1]).expect("valid OID constant");

        details.subject_cn = extract_dn_attr(&cert.subject(), &oid_cn);
        details.subject_org = extract_dn_attr(&cert.subject(), &oid_o);
        details.subject_ou = extract_dn_attr(&cert.subject(), &oid_ou);
        details.subject_country = extract_dn_attr(&cert.subject(), &oid_c);
        details.subject_state = extract_dn_attr(&cert.subject(), &oid_st);
        details.subject_locality = extract_dn_attr(&cert.subject(), &oid_l);
        details.subject_email = extract_dn_attr(&cert.subject(), &oid_email);

        // ── Issuer DN components ──
        details.issuer_cn = extract_dn_attr(&cert.issuer(), &oid_cn);
        details.issuer_org = extract_dn_attr(&cert.issuer(), &oid_o);
        details.issuer_country = extract_dn_attr(&cert.issuer(), &oid_c);

        // ── Key algorithm and size ──
        let (key_algo, key_sz) = resolve_key_algorithm_and_size(&cert);
        details.key_algorithm = key_algo;
        details.key_size = key_sz;

        // ── Certificate version (X.509 v1=0, v2=1, v3=2 internally; expose as 1/2/3) ──
        details.version = Some(cert.version.0 + 1);

        if let Ok(Some(san_ext)) = cert.subject_alternative_name() {
            details.san = san_ext
                .value
                .general_names
                .iter()
                .map(|name| format!("{name}"))
                .collect();
        }

        let san_text = if details.san.is_empty() {
            "none".to_string()
        } else {
            details.san.join(", ")
        };

        let mut diagnostic_detail = format!(
            "Fingerprint: SHA256:{fingerprint}\nSubject: {}\nIssuer: {}\nValid: {} -> {}\nSANs: {}",
            cert.subject(),
            cert.issuer(),
            cert.validity().not_before.to_rfc2822().unwrap_or_default(),
            cert.validity().not_after.to_rfc2822().unwrap_or_default(),
            san_text,
        );

        let now = chrono::Utc::now();
        if let Ok(not_after_str) = cert.validity().not_after.to_rfc2822() {
            if let Ok(not_after) = chrono::DateTime::parse_from_rfc2822(&not_after_str) {
                let days_left = (not_after.signed_duration_since(now)).num_days();
                if days_left < 0 {
                    diagnostic_detail.push_str(&format!("\nExpired {} days ago", -days_left));
                } else if days_left < 30 {
                    diagnostic_detail.push_str(&format!("\nExpires in {} days", days_left));
                }
            }
        }

        details.diagnostic_detail = Some(diagnostic_detail);
    }

    details
}

#[cfg(not(feature = "tls-cert-details"))]
pub fn parse_tls_certificate_details(
    _der: &[u8],
    fingerprint: &str,
) -> ParsedTlsCertificateDetails {
    ParsedTlsCertificateDetails {
        diagnostic_detail: Some(format!("Fingerprint: SHA256:{fingerprint}")),
        ..ParsedTlsCertificateDetails::default()
    }
}

// ─── Deep HTTP/HTTPS Connection Diagnostics ─────────────────────────────────

pub use sorng_core::diagnostics::{self as diagnostics, DiagnosticReport, DiagnosticStep};

// t20: re-export the web auto-login credential endpoint path + handler through
// the `http` module so they resolve via `crate::http::...` from BOTH crates that
// share `http_cmds.rs`. `http_cmds.rs` is `include!`-ed into `sorng-commands-core`
// (whose crate root has no `themed_autologin` module), so a direct
// `crate::themed_autologin::...` path fails there. Routing through `http` mirrors
// the existing `crate::http::themed_auth_post_handler` pattern: both crate roots
// expose a `http` module that re-exports from this file.
pub use crate::themed_autologin::{autologin_cred_handler, AUTOLOGIN_PATH};

// ─── Web Session Recording Commands ──────────────────────────────
