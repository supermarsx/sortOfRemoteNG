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
