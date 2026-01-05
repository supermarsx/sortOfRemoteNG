//! HTTP connection service for fetching web pages with authentication.
//!
//! Provides functionality to fetch web content with various authentication methods
//! including basic auth, bearer tokens, and custom headers.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
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

/// Active proxy mediator sessions
use std::sync::atomic::{AtomicU16, Ordering};
use tokio::net::TcpListener;

static NEXT_PROXY_PORT: AtomicU16 = AtomicU16::new(18080);

/// Get the next available proxy port
fn get_next_proxy_port() -> u16 {
    NEXT_PROXY_PORT.fetch_add(1, Ordering::SeqCst)
}

/// Start a basic auth proxy mediator
/// 
/// This creates a local HTTP server that forwards requests to the target URL
/// with basic authentication headers automatically added, allowing webviews
/// and iframes to access protected resources without triggering auth prompts.
#[command]
pub async fn start_basic_auth_proxy(
    config: BasicAuthProxyConfig,
    service: tauri::State<'_, HttpServiceState>,
) -> Result<ProxyMediatorResponse, String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    
    // Find an available port
    let port = if config.local_port > 0 {
        config.local_port
    } else {
        get_next_proxy_port()
    };
    
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
        .await
        .map_err(|e| format!("Failed to bind proxy port {}: {}", port, e))?;
    
    let actual_port = listener.local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?
        .port();
    
    let session_id = uuid::Uuid::new_v4().to_string();
    let target_url = config.target_url.clone();
    let username = config.username.clone();
    let password = config.password.clone();
    let verify_ssl = config.verify_ssl;
    
    // Clone service for the spawned task
    let service_clone = service.inner().clone();
    
    // Spawn the proxy server
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((mut stream, _)) => {
                    let target = target_url.clone();
                    let user = username.clone();
                    let pass = password.clone();
                    let service = service_clone.clone();
                    
                    tokio::spawn(async move {
                        let (reader, mut writer) = stream.split();
                        let mut buf_reader = BufReader::new(reader);
                        let mut request_line = String::new();
                        
                        // Read the request line
                        if buf_reader.read_line(&mut request_line).await.is_err() {
                            return;
                        }
                        
                        // Parse the request path
                        let parts: Vec<&str> = request_line.split_whitespace().collect();
                        if parts.len() < 2 {
                            return;
                        }
                        
                        let method = parts[0];
                        let path = parts[1];
                        
                        // Build the full URL
                        let full_url = if path.starts_with("http") {
                            path.to_string()
                        } else {
                            format!("{}{}", target.trim_end_matches('/'), path)
                        };
                        
                        // Read and skip headers until empty line
                        let mut headers_map = HashMap::new();
                        loop {
                            let mut header_line = String::new();
                            if buf_reader.read_line(&mut header_line).await.is_err() {
                                break;
                            }
                            let trimmed = header_line.trim();
                            if trimmed.is_empty() {
                                break;
                            }
                            if let Some((key, value)) = trimmed.split_once(':') {
                                headers_map.insert(key.trim().to_string(), value.trim().to_string());
                            }
                        }
                        
                        // Create HTTP config with basic auth
                        let http_config = HttpConnectionConfig {
                            url: full_url,
                            method: method.to_string(),
                            auth_type: Some("basic".to_string()),
                            username: Some(user),
                            password: Some(pass),
                            bearer_token: None,
                            headers: headers_map,
                            body: None,
                            timeout: 60,
                            follow_redirects: true,
                            verify_ssl,
                        };
                        
                        // Fetch through the HTTP service
                        let service_guard = service.lock().await;
                        match service_guard.fetch(http_config).await {
                            Ok(response) => {
                                // Build HTTP response
                                let status_line = format!("HTTP/1.1 {} OK\r\n", response.status);
                                let mut response_headers = String::new();
                                
                                if let Some(ct) = &response.content_type {
                                    response_headers.push_str(&format!("Content-Type: {}\r\n", ct));
                                }
                                response_headers.push_str(&format!("Content-Length: {}\r\n", response.body.len()));
                                response_headers.push_str("Access-Control-Allow-Origin: *\r\n");
                                response_headers.push_str("Connection: close\r\n");
                                response_headers.push_str("\r\n");
                                
                                let full_response = format!("{}{}{}", status_line, response_headers, response.body);
                                let _ = writer.write_all(full_response.as_bytes()).await;
                            }
                            Err(e) => {
                                let error_response = format!(
                                    "HTTP/1.1 502 Bad Gateway\r\n\
                                     Content-Type: text/plain\r\n\
                                     Content-Length: {}\r\n\
                                     Connection: close\r\n\r\n{}",
                                    e.len(),
                                    e
                                );
                                let _ = writer.write_all(error_response.as_bytes()).await;
                            }
                        }
                    });
                }
                Err(_) => break,
            }
        }
    });
    
    Ok(ProxyMediatorResponse {
        local_port: actual_port,
        session_id,
        proxy_url: format!("http://127.0.0.1:{}", actual_port),
    })
}
