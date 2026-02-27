//! HTTP connection service for fetching web pages with authentication.
//!
//! Provides functionality to fetch web content with various authentication methods
//! including basic auth, bearer tokens, and custom headers.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use tauri::command;
use tokio::sync::Mutex;
use sha2::{Sha256, Digest};

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
}

fn default_method() -> String {
    "GET".to_string()
}

fn default_timeout() -> u64 {
    30
}

fn default_follow_redirects() -> bool {
    true
}

fn default_verify_ssl() -> bool {
    true
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

/// Fetch a URL with credentials and custom configuration
#[command]
pub async fn http_fetch(
    config: HttpConnectionConfig,
    service: tauri::State<'_, HttpServiceState>,
) -> Result<HttpResponse, String> {
    let service = service.lock().await;
    service.fetch(config).await
}

/// Simple GET request with optional basic auth
#[command]
pub async fn http_get(
    url: String,
    username: Option<String>,
    password: Option<String>,
    headers: Option<HashMap<String, String>>,
    service: tauri::State<'_, HttpServiceState>,
) -> Result<HttpResponse, String> {
    let config = HttpConnectionConfig {
        url,
        method: "GET".to_string(),
        auth_type: if username.is_some() { Some("basic".to_string()) } else { None },
        username,
        password,
        bearer_token: None,
        headers: headers.unwrap_or_default(),
        body: None,
        timeout: 30,
        follow_redirects: true,
        verify_ssl: true,
    };

    let service = service.lock().await;
    service.fetch(config).await
}

/// POST request with optional authentication
#[command]
pub async fn http_post(
    url: String,
    body: Option<String>,
    username: Option<String>,
    password: Option<String>,
    headers: Option<HashMap<String, String>>,
    service: tauri::State<'_, HttpServiceState>,
) -> Result<HttpResponse, String> {
    let config = HttpConnectionConfig {
        url,
        method: "POST".to_string(),
        auth_type: if username.is_some() { Some("basic".to_string()) } else { None },
        username,
        password,
        bearer_token: None,
        headers: headers.unwrap_or_default(),
        body,
        timeout: 30,
        follow_redirects: true,
        verify_ssl: true,
    };

    let service = service.lock().await;
    service.fetch(config).await
}

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
    /// Connection ID that owns this proxy session (for per-connection isolation)
    #[serde(default)]
    pub connection_id: String,
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
    pub(crate) sessions: HashMap<String, ProxySessionEntry>,
    /// Global request log (last N entries, ring buffer style).
    pub(crate) request_log: Vec<ProxyRequestLogEntry>,
}

pub(crate) struct ProxySessionEntry {
    pub target_url: String,
    pub username: String,
    pub password: String,
    pub target_origin: String,
    pub connection_id: String,
    pub created_at: String,
    pub local_port: u16,
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

fn active_web_recordings() -> &'static std::sync::Mutex<HashMap<String, WebRecordingState>> {
    static INSTANCE: OnceLock<std::sync::Mutex<HashMap<String, WebRecordingState>>> = OnceLock::new();
    INSTANCE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

// -----------------------------------------------------------------------
// Axum proxy handler — shared state passed to every request handler
// -----------------------------------------------------------------------

/// State shared between the axum server and the session manager.
#[derive(Clone)]
struct AxumProxyState {
    session_id: String,
    target_url: String,
    username: String,
    password: String,
    target_origin: String,
    client: reqwest::Client,
    request_count: Arc<AtomicU64>,
    error_count: Arc<AtomicU64>,
    last_error: Arc<std::sync::Mutex<Option<String>>>,
    global_sessions: ProxySessionManagerState,
}

/// Axum fallback handler — proxies every request to the target server.
///
/// Includes one automatic retry for transient connection errors (connection
/// reset, pool errors, timeouts on idle connections) that commonly occur when
/// the upstream server silently closes keep-alive connections.
async fn axum_proxy_handler(
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
                    fwd_headers.push((key.as_str().to_string(), format!("{}/", state.target_origin)));
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
                .unwrap();
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
        if !state.username.is_empty() || !state.password.is_empty() {
            upstream = upstream.basic_auth(&state.username, Some(&state.password));
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
    let result = match send_upstream(&state, &reqwest_method, &full_url, &fwd_headers, &body_bytes).await {
        Ok(resp) => Ok(resp),
        Err(e) if is_retryable(&e) => {
            // Brief pause before retry
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            send_upstream(&state, &reqwest_method, &full_url, &fwd_headers, &body_bytes).await
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
                        .unwrap();
                }
            };

            // ── Web recording capture ──
            if let Ok(mut recordings) = active_web_recordings().lock() {
                if let Some(rec_state) = recordings.get_mut(&state.session_id) {
                    let timestamp_ms = rec_state.start_time.elapsed().as_millis() as u64;
                    let req_headers = if rec_state.record_headers {
                        fwd_headers.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
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
                let body_str = String::from_utf8_lossy(&final_body);
                if body_str.contains("</body>") {
                    let injected =
                        body_str.replacen("</body>", &format!("{}</body>", nav_script), 1);
                    final_body = injected.into_bytes();
                } else {
                    final_body.extend_from_slice(nav_script.as_bytes());
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
                    .unwrap()
            })
        }
        Err(e) => {
            let err_msg = format!("Upstream request failed: {}", e);

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
                    status: 502,
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
                        request_headers: if rec_state.record_headers { fwd_headers.iter().map(|(k, v)| (k.clone(), v.clone())).collect() } else { HashMap::new() },
                        request_body_size: body_bytes.len() as u64,
                        status: 502,
                        response_headers: HashMap::new(),
                        response_body_size: 0,
                        content_type: None,
                        duration_ms: req_start.elapsed().as_millis() as u64,
                        error: Some(err_msg.clone()),
                    });
                }
            }

            Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .header("Content-Type", "text/plain")
                .body(Body::from(err_msg))
                .unwrap()
        }
    }
}

// -----------------------------------------------------------------------
// Tauri commands
// -----------------------------------------------------------------------

/// Start a basic auth proxy mediator.
///
/// Spawns a local TCP server on `127.0.0.1:0` (OS auto-assigns a free port)
/// that proxies all requests to the target URL with basic authentication
/// headers injected. The returned `proxy_url` should be loaded in the iframe.
#[command]
pub async fn start_basic_auth_proxy(
    config: BasicAuthProxyConfig,
    _service: tauri::State<'_, HttpServiceState>,
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<ProxyMediatorResponse, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let target_url = config.target_url.clone();
    let verify_ssl = config.verify_ssl;
    let connection_id = config.connection_id.clone();

    // ---- Per-connection isolation ----
    // If a proxy already exists for this connection_id, shut it down first so
    // we never have duplicate proxies for the same connection.
    if !connection_id.is_empty() {
        let mut mgr = sessions
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let stale_ids: Vec<String> = mgr
            .sessions
            .iter()
            .filter(|(_, entry)| entry.connection_id == connection_id)
            .map(|(id, _)| id.clone())
            .collect();
        for stale in stale_ids {
            if let Some(mut entry) = mgr.sessions.remove(&stale) {
                if let Some(tx) = entry.shutdown_tx.take() {
                    let _ = tx.send(());
                }
            }
        }
    }

    // Extract origin (scheme://host:port) for URL rewriting in responses.
    let target_origin = {
        if let Some(scheme_end) = target_url.find("://") {
            let after_scheme = &target_url[scheme_end + 3..];
            match after_scheme.find('/') {
                Some(i) => target_url[..scheme_end + 3 + i].to_string(),
                None => target_url.clone(),
            }
        } else {
            target_url.clone()
        }
    };

    // Build an async reqwest client for this session with connection keep-alive
    // and reasonable timeouts to avoid stale-connection errors.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(15))
        .pool_idle_timeout(std::time::Duration::from_secs(20))
        .pool_max_idle_per_host(4)
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .danger_accept_invalid_certs(!verify_ssl)
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to create proxy HTTP client: {}", e))?;

    // Bind to a random free port.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind proxy listener: {}", e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?
        .port();

    let request_count = Arc::new(AtomicU64::new(0));
    let error_count = Arc::new(AtomicU64::new(0));
    let last_error: Arc<std::sync::Mutex<Option<String>>> =
        Arc::new(std::sync::Mutex::new(None));

    // Shared state for the axum handler.
    let proxy_state = Arc::new(AxumProxyState {
        session_id: session_id.clone(),
        target_url: target_url.clone(),
        username: config.username.clone(),
        password: config.password.clone(),
        target_origin: target_origin.clone(),
        client,
        request_count: request_count.clone(),
        error_count: error_count.clone(),
        last_error: last_error.clone(),
        global_sessions: (*sessions).clone(),
    });

    let app = axum::Router::new()
        .fallback(axum_proxy_handler)
        .with_state(proxy_state);

    // Shutdown channel.
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // Spawn the server.
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service())
            .with_graceful_shutdown(async {
                shutdown_rx.await.ok();
            })
            .await
            .ok();
    });

    // Store the session.
    {
        let mut mgr = sessions
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        mgr.sessions.insert(
            session_id.clone(),
            ProxySessionEntry {
                target_url: target_url.clone(),
                username: config.username.clone(),
                password: config.password.clone(),
                target_origin,
                connection_id,
                created_at: chrono::Utc::now().to_rfc3339(),
                local_port,
                request_count,
                error_count,
                last_error,
                shutdown_tx: Some(shutdown_tx),
            },
        );
    }

    Ok(ProxyMediatorResponse {
        local_port,
        session_id: session_id.clone(),
        proxy_url: format!("http://127.0.0.1:{}/", local_port),
    })
}

/// Stop a running basic auth proxy session.
#[command]
pub fn stop_basic_auth_proxy(
    session_id: String,
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<(), String> {
    let mut mgr = sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    if let Some(mut entry) = mgr.sessions.remove(&session_id) {
        // Signal the axum server to shut down.
        if let Some(tx) = entry.shutdown_tx.take() {
            let _ = tx.send(());
        }
        Ok(())
    } else {
        Err(format!("Proxy session {} not found", session_id))
    }
}

/// List all active proxy sessions.
#[command]
pub fn list_proxy_sessions(
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<Vec<ProxyMediatorResponse>, String> {
    let mgr = sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    Ok(mgr
        .sessions
        .iter()
        .map(|(id, entry)| ProxyMediatorResponse {
            local_port: entry.local_port,
            session_id: id.clone(),
            proxy_url: format!("http://127.0.0.1:{}/", entry.local_port),
        })
        .collect())
}

/// Get detailed information about all proxy sessions.
#[command]
pub fn get_proxy_session_details(
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<Vec<ProxySessionDetail>, String> {
    let mgr = sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    Ok(mgr
        .sessions
        .iter()
        .map(|(id, entry)| ProxySessionDetail {
            session_id: id.clone(),
            target_url: entry.target_url.clone(),
            username: entry.username.clone(),
            connection_id: entry.connection_id.clone(),
            proxy_url: format!("http://127.0.0.1:{}/", entry.local_port),
            created_at: entry.created_at.clone(),
            request_count: entry.request_count.load(Ordering::Relaxed),
            error_count: entry.error_count.load(Ordering::Relaxed),
            last_error: entry
                .last_error
                .lock()
                .ok()
                .and_then(|g| g.clone()),
        })
        .collect())
}

/// Get the request log from the proxy manager.
#[command]
pub fn get_proxy_request_log(
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<Vec<ProxyRequestLogEntry>, String> {
    let mgr = sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    Ok(mgr.request_log.clone())
}

/// Clear the proxy request log.
#[command]
pub fn clear_proxy_request_log(
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<(), String> {
    let mut mgr = sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    mgr.request_log.clear();
    Ok(())
}

/// Stop all active proxy sessions.
#[command]
pub fn stop_all_proxy_sessions(
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<u32, String> {
    let mut mgr = sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let count = mgr.sessions.len() as u32;
    for (_id, mut entry) in mgr.sessions.drain() {
        if let Some(tx) = entry.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
    Ok(count)
}

/// Health-check result for a proxy session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyHealthResult {
    pub session_id: String,
    pub alive: bool,
    pub port: u16,
    pub error: Option<String>,
}

/// Check whether a proxy session's local TCP port is still accepting
/// connections.  Returns a health status for each requested session ID.
#[command]
pub async fn check_proxy_health(
    session_ids: Vec<String>,
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<Vec<ProxyHealthResult>, String> {
    // Collect info while holding the lock briefly.
    let entries: Vec<(String, u16)> = {
        let mgr = sessions
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        session_ids
            .iter()
            .filter_map(|id| {
                mgr.sessions.get(id).map(|e| (id.clone(), e.local_port))
            })
            .collect()
    };

    let mut results: Vec<ProxyHealthResult> = Vec::new();

    // For sessions that are no longer in the manager at all, report dead.
    for id in &session_ids {
        if !entries.iter().any(|(eid, _)| eid == id) {
            results.push(ProxyHealthResult {
                session_id: id.clone(),
                alive: false,
                port: 0,
                error: Some("Session not found in manager".into()),
            });
        }
    }

    // Probe each known port with a quick TCP connect.
    for (id, port) in entries {
        let addr = format!("127.0.0.1:{}", port);
        let alive = tokio::time::timeout(
            std::time::Duration::from_millis(1500),
            tokio::net::TcpStream::connect(&addr),
        )
        .await;
        match alive {
            Ok(Ok(_stream)) => {
                results.push(ProxyHealthResult {
                    session_id: id,
                    alive: true,
                    port,
                    error: None,
                });
            }
            Ok(Err(e)) => {
                results.push(ProxyHealthResult {
                    session_id: id,
                    alive: false,
                    port,
                    error: Some(format!("Connect failed: {}", e)),
                });
            }
            Err(_) => {
                results.push(ProxyHealthResult {
                    session_id: id,
                    alive: false,
                    port,
                    error: Some("Health check timed out".into()),
                });
            }
        }
    }

    Ok(results)
}

/// Restart a dead proxy session.  Uses the stored credentials and target_url
/// from the original session to spin up a fresh axum server (potentially on a
/// different local port).  Returns the new proxy URL.
#[command]
pub async fn restart_proxy_session(
    session_id: String,
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<ProxyMediatorResponse, String> {
    // Extract the config from the existing (dead) session entry.
    let (target_url, username, password, target_origin, connection_id, verify_ssl) = {
        let mgr = sessions
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let entry = mgr
            .sessions
            .get(&session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        (
            entry.target_url.clone(),
            entry.username.clone(),
            entry.password.clone(),
            entry.target_origin.clone(),
            entry.connection_id.clone(),
            // We don't persist verify_ssl in the entry, but the client will
            // pass verify_ssl when it creates the proxy.  For restart we
            // default to true (the safe option) — the client overrides this
            // if needed.
            true,
        )
    };

    // Shut down the old axum server (may already be dead).
    {
        let mut mgr = sessions
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if let Some(mut entry) = mgr.sessions.remove(&session_id) {
            if let Some(tx) = entry.shutdown_tx.take() {
                let _ = tx.send(());
            }
        }
    }

    // Build a fresh reqwest client.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(15))
        .pool_idle_timeout(std::time::Duration::from_secs(20))
        .pool_max_idle_per_host(4)
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .danger_accept_invalid_certs(!verify_ssl)
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to create proxy HTTP client: {}", e))?;

    // Bind to a new random free port.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind proxy listener: {}", e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?
        .port();

    let new_session_id = uuid::Uuid::new_v4().to_string();
    let request_count = Arc::new(AtomicU64::new(0));
    let error_count = Arc::new(AtomicU64::new(0));
    let last_error: Arc<std::sync::Mutex<Option<String>>> =
        Arc::new(std::sync::Mutex::new(None));

    let proxy_state = Arc::new(AxumProxyState {
        session_id: new_session_id.clone(),
        target_url: target_url.clone(),
        username: username.clone(),
        password: password.clone(),
        target_origin: target_origin.clone(),
        client,
        request_count: request_count.clone(),
        error_count: error_count.clone(),
        last_error: last_error.clone(),
        global_sessions: (*sessions).clone(),
    });

    let app = axum::Router::new()
        .fallback(axum_proxy_handler)
        .with_state(proxy_state);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service())
            .with_graceful_shutdown(async {
                shutdown_rx.await.ok();
            })
            .await
            .ok();
    });

    // Store the new session.
    {
        let mut mgr = sessions
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        mgr.sessions.insert(
            new_session_id.clone(),
            ProxySessionEntry {
                target_url,
                username,
                password,
                target_origin,
                connection_id,
                created_at: chrono::Utc::now().to_rfc3339(),
                local_port,
                request_count,
                error_count,
                last_error,
                shutdown_tx: Some(shutdown_tx),
            },
        );
    }

    Ok(ProxyMediatorResponse {
        local_port,
        session_id: new_session_id,
        proxy_url: format!("http://127.0.0.1:{}/", local_port),
    })
}

// ---------------------------------------------------------------------------
// TLS Certificate Info
// ---------------------------------------------------------------------------

/// Certificate information returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsCertificateInfo {
    /// SHA-256 fingerprint (hex-encoded)
    pub fingerprint: String,
    /// Subject (from native-tls peer certificate)
    pub subject: Option<String>,
    /// Issuer
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
}

/// Fetch the TLS certificate presented by a remote server.
/// Connects using native-tls with verification disabled so we can inspect
/// self-signed / untrusted certificates as well.
#[command]
pub async fn get_tls_certificate_info(
    host: String,
    port: u16,
) -> Result<TlsCertificateInfo, String> {
    use tokio::net::TcpStream;

    let addr = format!("{}:{}", host, port);

    // Build a TLS connector that does NOT verify — we want the cert regardless
    let tls_connector = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| format!("TLS connector error: {}", e))?;

    let connector = tokio_native_tls::TlsConnector::from(tls_connector);

    let tcp = TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("TCP connect failed: {}", e))?;

    let tls = connector
        .connect(&host, tcp)
        .await
        .map_err(|e| format!("TLS handshake failed: {}", e))?;

    // Get peer certificate
    let peer_cert = tls
        .get_ref()
        .peer_certificate()
        .map_err(|e| format!("Failed to get peer certificate: {}", e))?
        .ok_or("Server did not present a certificate")?;

    let der = peer_cert.to_der().map_err(|e| format!("DER encode failed: {}", e))?;

    // SHA-256 fingerprint
    let mut hasher = Sha256::new();
    hasher.update(&der);
    let fingerprint = hex::encode(hasher.finalize());

    // Parse with x509-parser for rich details
    let mut subject = None;
    let mut issuer = None;
    let mut valid_from = None;
    let mut valid_to = None;
    let mut serial = None;
    let mut signature_algorithm = None;
    let mut san: Vec<String> = Vec::new();

    if let Ok((_rem, cert)) = x509_parser::parse_x509_certificate(&der) {
        subject = Some(cert.subject().to_string());
        issuer = Some(cert.issuer().to_string());
        valid_from = Some(cert.validity().not_before.to_rfc2822().unwrap_or_default());
        valid_to = Some(cert.validity().not_after.to_rfc2822().unwrap_or_default());
        serial = Some(cert.raw_serial_as_string());
        signature_algorithm = Some(
            cert.signature_algorithm.algorithm.to_id_string(),
        );

        // Extract SANs
        if let Ok(Some(san_ext)) = cert.subject_alternative_name() {
            for name in &san_ext.value.general_names {
                san.push(format!("{}", name));
            }
        }
    }

    // Build PEM
    let pem = {
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &der);
        let mut pem_str = String::from("-----BEGIN CERTIFICATE-----\n");
        for chunk in b64.as_bytes().chunks(64) {
            pem_str.push_str(std::str::from_utf8(chunk).unwrap_or_default());
            pem_str.push('\n');
        }
        pem_str.push_str("-----END CERTIFICATE-----\n");
        Some(pem_str)
    };

    Ok(TlsCertificateInfo {
        fingerprint,
        subject,
        issuer,
        pem,
        valid_from,
        valid_to,
        serial,
        signature_algorithm,
        san,
    })
}

// ─── Deep HTTP/HTTPS Connection Diagnostics ─────────────────────────────────

use crate::diagnostics::{self, DiagnosticReport, DiagnosticStep};

/// Run a deep diagnostic probe against an HTTP/HTTPS endpoint.
///
/// Steps:
///   1. DNS Resolution (multi-address)
///   2. TCP Connect
///   3. TLS Handshake + Certificate (HTTPS only)
///   4. HTTP Request (GET/HEAD with status code, headers, timing)
///   5. Redirect Chain (if any)
///   6. Response Body Probe (first bytes, content-type, size)
#[command]
pub async fn diagnose_http_connection(
    host: String,
    port: u16,
    use_tls: bool,
    path: Option<String>,
    method: Option<String>,
    expected_status: Option<u16>,
    connect_timeout_secs: Option<u64>,
    verify_ssl: Option<bool>,
) -> Result<DiagnosticReport, String> {
    let run_start = std::time::Instant::now();
    let mut steps: Vec<DiagnosticStep> = Vec::new();
    let mut resolved_ip: Option<String> = None;
    let timeout_secs = connect_timeout_secs.unwrap_or(15);
    let timeout = std::time::Duration::from_secs(timeout_secs);
    let protocol = if use_tls { "https" } else { "http" };
    let req_path = path.unwrap_or_else(|| "/".to_string());
    let req_method = method.unwrap_or_else(|| "GET".to_string());
    let verify = verify_ssl.unwrap_or(true);

    // ── Step 1: DNS Resolution ──────────────────────────────────────────

    let (socket_addr, ip_str, _all_ips) = diagnostics::probe_dns(&host, port, &mut steps);
    let socket_addr = match socket_addr {
        Some(a) => {
            resolved_ip = ip_str;
            a
        }
        None => {
            return Ok(diagnostics::finish_report(&host, port, protocol, resolved_ip, steps, run_start));
        }
    };

    // ── Step 2: TCP Connect ─────────────────────────────────────────────
    // We use the shared probe for consistency
    let tcp_ok = diagnostics::probe_tcp(socket_addr, timeout, true, &mut steps).is_some();
    if !tcp_ok {
        return Ok(diagnostics::finish_report(&host, port, protocol, resolved_ip, steps, run_start));
    }

    // ── Step 3: TLS Handshake + Certificate (HTTPS only) ────────────────

    if use_tls {
        let h = host.clone();
        let t = std::time::Instant::now();

        // Use native-tls with configurable verification
        let tls_builder = if verify {
            native_tls::TlsConnector::builder().build()
        } else {
            native_tls::TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true)
                .build()
        };

        match tls_builder {
            Ok(connector) => {
                let tls_connector = tokio_native_tls::TlsConnector::from(connector);
                let tcp = match tokio::net::TcpStream::connect(&socket_addr).await {
                    Ok(s) => s,
                    Err(e) => {
                        steps.push(DiagnosticStep {
                            name: "TLS Handshake".into(),
                            status: "fail".into(),
                            message: format!("TCP reconnect for TLS failed: {e}"),
                            duration_ms: t.elapsed().as_millis() as u64,
                            detail: None,
                        });
                        return Ok(diagnostics::finish_report(&host, port, protocol, resolved_ip, steps, run_start));
                    }
                };

                match tls_connector.connect(&h, tcp).await {
                    Ok(tls_stream) => {
                        let elapsed = t.elapsed().as_millis() as u64;

                        // Extract certificate info
                        let cert_detail = tls_stream
                            .get_ref()
                            .peer_certificate()
                            .ok()
                            .flatten()
                            .and_then(|cert| {
                                let der = cert.to_der().ok()?;
                                let mut hasher = Sha256::new();
                                hasher.update(&der);
                                let fp = hex::encode(hasher.finalize());

                                let mut detail = format!("Fingerprint: SHA256:{}", fp);

                                if let Ok((_rem, x509)) = x509_parser::parse_x509_certificate(&der) {
                                    detail.push_str(&format!(
                                        "\nSubject: {}\nIssuer: {}\nValid: {} → {}\nSANs: {}",
                                        x509.subject(),
                                        x509.issuer(),
                                        x509.validity().not_before.to_rfc2822().unwrap_or_default(),
                                        x509.validity().not_after.to_rfc2822().unwrap_or_default(),
                                        x509.subject_alternative_name()
                                            .ok()
                                            .flatten()
                                            .map(|san| san
                                                .value
                                                .general_names
                                                .iter()
                                                .map(|n| format!("{n}"))
                                                .collect::<Vec<_>>()
                                                .join(", "))
                                            .unwrap_or_else(|| "none".into()),
                                    ));

                                    // Check expiry
                                    let now = chrono::Utc::now();
                                    if let Ok(not_after_str) = x509.validity().not_after.to_rfc2822() {
                                        if let Ok(not_after) = chrono::DateTime::parse_from_rfc2822(&not_after_str) {
                                            let days_left = (not_after.signed_duration_since(now)).num_days();
                                            if days_left < 0 {
                                                detail.push_str(&format!("\n⚠ EXPIRED {} days ago!", -days_left));
                                            } else if days_left < 30 {
                                                detail.push_str(&format!("\n⚠ Expires in {} days", days_left));
                                            }
                                        }
                                    }
                                }
                                Some(detail)
                            });

                        steps.push(DiagnosticStep {
                            name: "TLS Handshake".into(),
                            status: "pass".into(),
                            message: "TLS handshake completed, certificate obtained".into(),
                            duration_ms: elapsed,
                            detail: cert_detail,
                        });
                    }
                    Err(e) => {
                        let msg = format!("{e}");
                        let hint = if msg.contains("certificate") {
                            Some("Certificate verification failed. The server may use a self-signed, expired, or mismatched certificate.".into())
                        } else if msg.contains("handshake") || msg.contains("alert") {
                            Some("TLS protocol negotiation failed. Check the server supports modern TLS versions (1.2+).".into())
                        } else {
                            None
                        };
                        steps.push(DiagnosticStep {
                            name: "TLS Handshake".into(),
                            status: "fail".into(),
                            message: format!("TLS handshake failed: {}", msg),
                            duration_ms: t.elapsed().as_millis() as u64,
                            detail: hint,
                        });
                        // Don't return yet — we can still try HTTP (useful for diagnostic info)
                    }
                }
            }
            Err(e) => {
                steps.push(DiagnosticStep {
                    name: "TLS Handshake".into(),
                    status: "fail".into(),
                    message: format!("Failed to create TLS connector: {e}"),
                    duration_ms: t.elapsed().as_millis() as u64,
                    detail: None,
                });
            }
        }
    }

    // ── Step 4: HTTP Request ────────────────────────────────────────────

    let t = std::time::Instant::now();
    let url = format!("{}://{}:{}{}", protocol, host, port, req_path);

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .danger_accept_invalid_certs(!verify)
        .redirect(reqwest::redirect::Policy::none()) // we'll handle redirects manually
        .build();

    let client = match client {
        Ok(c) => c,
        Err(e) => {
            steps.push(DiagnosticStep {
                name: "HTTP Request".into(),
                status: "fail".into(),
                message: format!("Failed to create HTTP client: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            });
            return Ok(diagnostics::finish_report(&host, port, protocol, resolved_ip, steps, run_start));
        }
    };

    let request = match req_method.to_uppercase().as_str() {
        "HEAD" => client.head(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            let status_code = status.as_u16();
            let headers = response.headers().clone();
            let elapsed = t.elapsed().as_millis() as u64;

            // Gather header info
            let server = headers
                .get("server")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("(not reported)")
                .to_string();
            let content_type = headers
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("(not reported)")
                .to_string();
            let content_length = headers
                .get("content-length")
                .and_then(|v| v.to_str().ok())
                .map(|v| v.to_string());

            // Check expected status
            let status_ok = expected_status
                .map(|exp| exp == status_code)
                .unwrap_or(status.is_success() || status.is_redirection());

            steps.push(DiagnosticStep {
                name: "HTTP Response".into(),
                status: if status_ok { "pass" } else { "warn" }.into(),
                message: format!(
                    "{} {} → {} {} ({}ms)",
                    req_method, req_path, status_code,
                    status.canonical_reason().unwrap_or(""),
                    elapsed
                ),
                duration_ms: elapsed,
                detail: Some(format!(
                    "Server: {}\nContent-Type: {}\nContent-Length: {}\nHeaders: {}",
                    server,
                    content_type,
                    content_length.unwrap_or_else(|| "(not reported)".into()),
                    headers.len()
                )),
            });

            // ── Step 5: Redirect check ──────────────────────────────────
            if status.is_redirection() {
                let location = headers
                    .get("location")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("(missing)");

                steps.push(DiagnosticStep {
                    name: "Redirect".into(),
                    status: "info".into(),
                    message: format!("Redirects to: {}", location),
                    duration_ms: 0,
                    detail: Some(format!(
                        "Status {} indicates a redirect. Follow the Location header to reach the final resource.",
                        status_code
                    )),
                });
            }

            // ── Step 6: Response Body Probe ─────────────────────────────
            let t2 = std::time::Instant::now();
            match response.bytes().await {
                Ok(body) => {
                    let body_len = body.len();
                    let preview: String = String::from_utf8_lossy(
                        &body[..std::cmp::min(body_len, 200)],
                    )
                    .chars()
                    .filter(|c| !c.is_control() || *c == '\n')
                    .collect();

                    steps.push(DiagnosticStep {
                        name: "Response Body".into(),
                        status: "info".into(),
                        message: format!("Received {} bytes", body_len),
                        duration_ms: t2.elapsed().as_millis() as u64,
                        detail: if !preview.trim().is_empty() {
                            Some(format!("Preview: {}", preview.trim()))
                        } else {
                            None
                        },
                    });
                }
                Err(e) => {
                    steps.push(DiagnosticStep {
                        name: "Response Body".into(),
                        status: "warn".into(),
                        message: format!("Could not read response body: {e}"),
                        duration_ms: t2.elapsed().as_millis() as u64,
                        detail: None,
                    });
                }
            }
        }
        Err(e) => {
            let msg = format!("{e}");
            let hint = if msg.contains("timeout") || msg.contains("timed out") {
                Some(format!(
                    "The server did not respond within {}s. It may be overloaded, \
                     behind a firewall, or the URL may be incorrect.",
                    timeout_secs
                ))
            } else if msg.contains("connection refused") {
                Some(format!(
                    "Connection refused on {}:{}. Verify the web server is running \
                     and listening on this port.",
                    host, port
                ))
            } else if msg.contains("certificate") || msg.contains("ssl") || msg.contains("tls") {
                Some("TLS/SSL error during the HTTP request. Try with verify_ssl=false for diagnostics.".into())
            } else {
                None
            };

            steps.push(DiagnosticStep {
                name: "HTTP Request".into(),
                status: "fail".into(),
                message: format!("Request failed: {}", msg),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: hint,
            });
        }
    }

    Ok(diagnostics::finish_report(&host, port, protocol, resolved_ip, steps, run_start))
}

// ─── Web Session Recording Commands ──────────────────────────────

#[command]
pub fn start_web_recording(
    session_id: String,
    record_headers: Option<bool>,
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<(), String> {
    // Verify the proxy session exists
    let mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entry = mgr.sessions.get(&session_id)
        .ok_or_else(|| format!("Proxy session {} not found", session_id))?;

    let host = {
        // Extract host from target_url
        if let Some(scheme_end) = entry.target_url.find("://") {
            let after = &entry.target_url[scheme_end + 3..];
            after.split('/').next().unwrap_or("unknown").to_string()
        } else {
            entry.target_url.clone()
        }
    };

    let target_url = entry.target_url.clone();
    let connection_id = entry.connection_id.clone();
    drop(mgr);

    let mut recordings = active_web_recordings().lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    if recordings.contains_key(&session_id) {
        return Err("Web recording already active for this session".into());
    }

    recordings.insert(session_id.clone(), WebRecordingState {
        start_time: std::time::Instant::now(),
        start_utc: chrono::Utc::now(),
        session_id: session_id.clone(),
        target_url,
        connection_id,
        host,
        entries: Vec::new(),
        record_headers: record_headers.unwrap_or(true),
    });

    Ok(())
}

#[command]
pub fn stop_web_recording(
    session_id: String,
) -> Result<WebRecording, String> {
    let mut recordings = active_web_recordings().lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    let state = recordings.remove(&session_id)
        .ok_or_else(|| format!("No active web recording for session {}", session_id))?;

    let total_bytes: u64 = state.entries.iter()
        .map(|e| e.request_body_size + e.response_body_size)
        .sum();

    Ok(WebRecording {
        metadata: WebRecordingMetadata {
            session_id: state.session_id,
            start_time: state.start_utc.to_rfc3339(),
            end_time: Some(chrono::Utc::now().to_rfc3339()),
            host: state.host,
            target_url: state.target_url,
            duration_ms: state.start_time.elapsed().as_millis() as u64,
            entry_count: state.entries.len(),
            total_bytes_transferred: total_bytes,
        },
        entries: state.entries,
    })
}

#[command]
pub fn is_web_recording(session_id: String) -> Result<bool, String> {
    let recordings = active_web_recordings().lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    Ok(recordings.contains_key(&session_id))
}

#[command]
pub fn get_web_recording_status(session_id: String) -> Result<Option<WebRecordingMetadata>, String> {
    let recordings = active_web_recordings().lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    Ok(recordings.get(&session_id).map(|state| {
        let total_bytes: u64 = state.entries.iter()
            .map(|e| e.request_body_size + e.response_body_size)
            .sum();
        WebRecordingMetadata {
            session_id: state.session_id.clone(),
            start_time: state.start_utc.to_rfc3339(),
            end_time: None,
            host: state.host.clone(),
            target_url: state.target_url.clone(),
            duration_ms: state.start_time.elapsed().as_millis() as u64,
            entry_count: state.entries.len(),
            total_bytes_transferred: total_bytes,
        }
    }))
}

#[command]
pub fn export_web_recording_har(recording: WebRecording) -> Result<String, String> {
    // HAR 1.2 format
    let entries: Vec<serde_json::Value> = recording.entries.iter().map(|e| {
        serde_json::json!({
            "startedDateTime": recording.metadata.start_time,
            "time": e.duration_ms,
            "request": {
                "method": e.method,
                "url": e.url,
                "httpVersion": "HTTP/1.1",
                "headers": e.request_headers.iter().map(|(k, v)| {
                    serde_json::json!({"name": k, "value": v})
                }).collect::<Vec<_>>(),
                "queryString": [],
                "headersSize": -1,
                "bodySize": e.request_body_size as i64,
            },
            "response": {
                "status": e.status,
                "statusText": "",
                "httpVersion": "HTTP/1.1",
                "headers": e.response_headers.iter().map(|(k, v)| {
                    serde_json::json!({"name": k, "value": v})
                }).collect::<Vec<_>>(),
                "content": {
                    "size": e.response_body_size as i64,
                    "mimeType": e.content_type.as_deref().unwrap_or(""),
                },
                "redirectURL": "",
                "headersSize": -1,
                "bodySize": e.response_body_size as i64,
            },
            "cache": {},
            "timings": {
                "send": 0,
                "wait": e.duration_ms,
                "receive": 0,
            },
        })
    }).collect();

    let har = serde_json::json!({
        "log": {
            "version": "1.2",
            "creator": {
                "name": "sortOfRemoteNG",
                "version": "1.0",
            },
            "pages": [],
            "entries": entries,
        }
    });

    serde_json::to_string_pretty(&har).map_err(|e| format!("JSON serialization failed: {}", e))
}
