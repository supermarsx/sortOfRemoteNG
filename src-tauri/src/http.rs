//! HTTP connection service for fetching web pages with authentication.
//!
//! Provides functionality to fetch web content with various authentication methods
//! including basic auth, bearer tokens, and custom headers.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::command;
use tokio::sync::Mutex;

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

    // Build the upstream request.
    let reqwest_method = match method_str.as_str() {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "PATCH" => reqwest::Method::PATCH,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let mut upstream = state.client.request(reqwest_method, &full_url);

    // Inject basic auth.
    if !state.username.is_empty() || !state.password.is_empty() {
        upstream = upstream.basic_auth(&state.username, Some(&state.password));
    }

    // Forward relevant request headers (skip hop-by-hop and auth headers).
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
                    let rewritten = format!("{}/", state.target_origin);
                    upstream = upstream.header(key.as_str(), rewritten);
                    continue;
                }
            }
        }
        if let Ok(v) = value.to_str() {
            upstream = upstream.header(key.as_str(), v);
        }
    }

    // Forward request body.
    let body_bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from(format!("Failed to read request body: {}", e)))
                .unwrap();
        }
    };
    if !body_bytes.is_empty() {
        upstream = upstream.body(body_bytes.to_vec());
    }

    // Execute the upstream request.
    match upstream.send().await {
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
                if mgr.request_log.len() >= 200 {
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
                if mgr.request_log.len() >= 200 {
                    mgr.request_log.remove(0);
                }
                mgr.request_log.push(ProxyRequestLogEntry {
                    session_id: state.session_id.clone(),
                    method: method_str,
                    url: full_url.clone(),
                    status: 502,
                    error: Some(err_msg.clone()),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                });
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

    // Build an async reqwest client for this session.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
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
