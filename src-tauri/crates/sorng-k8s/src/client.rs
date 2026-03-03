// ── sorng-k8s/src/client.rs ─────────────────────────────────────────────────
//! HTTP client for the Kubernetes API with authentication, TLS, and token
//! refresh support.

use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::{debug, info};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Kubernetes API HTTP client.
#[derive(Clone)]
pub struct K8sClient {
    pub(crate) http: reqwest::Client,
    pub(crate) base_url: String,
    pub(crate) _default_namespace: String,
    pub(crate) auth: Arc<RwLock<K8sAuth>>,
}

/// Authentication state.
pub struct K8sAuth {
    pub token: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub exec_config: Option<ExecCredentialConfig>,
    pub token_expiry: Option<chrono::DateTime<chrono::Utc>>,
}

impl K8sClient {
    /// Create a new client from a connection config.
    pub async fn from_config(config: &K8sConnectionConfig) -> K8sResult<Self> {
        let (base_url, auth, tls_config) = if let Some(ref kc_path) = config.kubeconfig_path {
            Self::from_kubeconfig_path(kc_path, config.context_name.as_deref())?
        } else if let Some(ref kc_inline) = config.kubeconfig_inline {
            Self::from_kubeconfig_inline(kc_inline, config.context_name.as_deref())?
        } else if let Some(ref url) = config.api_server_url {
            let auth = Self::resolve_auth_method(&config.auth_method)?;
            (url.clone(), auth, config.tls_config.clone())
        } else {
            return Err(K8sError::connection("No API server URL or kubeconfig provided"));
        };

        let http = Self::build_http_client(&tls_config, config.request_timeout_secs, config.proxy_url.as_deref())?;
        let namespace = config.namespace.clone().unwrap_or_else(|| "default".to_string());

        info!("K8s client created for {}", base_url);

        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            _default_namespace: namespace,
            auth: Arc::new(RwLock::new(auth)),
        })
    }

    fn from_kubeconfig_path(
        path: &str,
        context_name: Option<&str>,
    ) -> K8sResult<(String, K8sAuth, Option<K8sTlsConfig>)> {
        use crate::kubeconfig::KubeconfigManager;
        let kc = KubeconfigManager::load(path)?;
        let ctx_name = context_name.unwrap_or(&kc.current_context).to_string();
        let (endpoint, creds) = KubeconfigManager::resolve_context(&kc, &ctx_name)?;
        Self::resolve_kubeconfig_auth(endpoint, creds)
    }

    fn from_kubeconfig_inline(
        yaml: &str,
        context_name: Option<&str>,
    ) -> K8sResult<(String, K8sAuth, Option<K8sTlsConfig>)> {
        use crate::kubeconfig::KubeconfigManager;
        let kc = KubeconfigManager::parse(yaml)?;
        let ctx_name = context_name.unwrap_or(&kc.current_context).to_string();
        let (endpoint, creds) = KubeconfigManager::resolve_context(&kc, &ctx_name)?;
        Self::resolve_kubeconfig_auth(endpoint, creds)
    }

    fn resolve_kubeconfig_auth(
        endpoint: ClusterEndpoint,
        creds: UserCredentials,
    ) -> K8sResult<(String, K8sAuth, Option<K8sTlsConfig>)> {
        let tls = Some(K8sTlsConfig {
            ca_cert_data: endpoint.certificate_authority_data.clone(),
            ca_cert_path: endpoint.certificate_authority.clone(),
            client_cert_data: creds.client_certificate_data.clone(),
            client_cert_path: creds.client_certificate.clone(),
            client_key_data: creds.client_key_data.clone(),
            client_key_path: creds.client_key.clone(),
            insecure_skip_verify: endpoint.insecure_skip_tls_verify.unwrap_or(false),
            server_name: endpoint.tls_server_name.clone(),
        });

        let auth = K8sAuth {
            token: creds.token.clone(),
            username: creds.username.clone(),
            password: creds.password.clone(),
            exec_config: creds.exec.clone(),
            token_expiry: None,
        };

        Ok((endpoint.server.clone(), auth, tls))
    }

    fn resolve_auth_method(method: &K8sAuthMethod) -> K8sResult<K8sAuth> {
        match method {
            K8sAuthMethod::Token(token) => Ok(K8sAuth {
                token: Some(token.clone()),
                username: None,
                password: None,
                exec_config: None,
                token_expiry: None,
            }),
            K8sAuthMethod::BasicAuth { username, password } => Ok(K8sAuth {
                token: None,
                username: Some(username.clone()),
                password: Some(password.clone()),
                exec_config: None,
                token_expiry: None,
            }),
            K8sAuthMethod::ExecCredential(exec) => Ok(K8sAuth {
                token: None,
                username: None,
                password: None,
                exec_config: Some(exec.clone()),
                token_expiry: None,
            }),
            K8sAuthMethod::ServiceAccount { token_path, .. } => {
                let token = std::fs::read_to_string(token_path)
                    .map_err(|e| K8sError::auth(format!("Failed to read SA token: {}", e)))?;
                Ok(K8sAuth {
                    token: Some(token.trim().to_string()),
                    username: None,
                    password: None,
                    exec_config: None,
                    token_expiry: None,
                })
            }
            _ => Ok(K8sAuth {
                token: None,
                username: None,
                password: None,
                exec_config: None,
                token_expiry: None,
            }),
        }
    }

    fn build_http_client(
        tls_config: &Option<K8sTlsConfig>,
        timeout_secs: Option<u64>,
        proxy_url: Option<&str>,
    ) -> K8sResult<reqwest::Client> {
        let mut builder = reqwest::Client::builder();

        if let Some(timeout) = timeout_secs {
            builder = builder.timeout(std::time::Duration::from_secs(timeout));
        }

        if let Some(proxy) = proxy_url {
            let p = reqwest::Proxy::all(proxy)
                .map_err(|e| K8sError::connection(format!("Invalid proxy URL: {}", e)))?;
            builder = builder.proxy(p);
        }

        if let Some(ref tls) = tls_config {
            if tls.insecure_skip_verify {
                builder = builder.danger_accept_invalid_certs(true);
            }

            // Load CA certificate
            if let Some(ref ca_data) = tls.ca_cert_data {
                if let Ok(decoded) = base64::Engine::decode(
                    &base64::engine::general_purpose::STANDARD,
                    ca_data,
                ) {
                    if let Ok(cert) = reqwest::Certificate::from_pem(&decoded) {
                        builder = builder.add_root_certificate(cert);
                    } else if let Ok(cert) = reqwest::Certificate::from_der(&decoded) {
                        builder = builder.add_root_certificate(cert);
                    }
                }
            } else if let Some(ref ca_path) = tls.ca_cert_path {
                if let Ok(ca_bytes) = std::fs::read(ca_path) {
                    if let Ok(cert) = reqwest::Certificate::from_pem(&ca_bytes) {
                        builder = builder.add_root_certificate(cert);
                    }
                }
            }

            // Load client certificate + key for mTLS
            if let (Some(ref cert_data), Some(ref key_data)) = (&tls.client_cert_data, &tls.client_key_data) {
                if let (Ok(cert_bytes), Ok(key_bytes)) = (
                    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, cert_data),
                    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, key_data),
                ) {
                    if let Ok(identity) = reqwest::Identity::from_pkcs8_pem(&cert_bytes, &key_bytes) {
                        builder = builder.identity(identity);
                    }
                }
            }
        }

        builder.build().map_err(|e| K8sError::connection(format!("Failed to build HTTP client: {}", e)))
    }

    /// Build authorization headers for the current auth state.
    async fn auth_headers(&self) -> K8sResult<HeaderMap> {
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));

        let auth = self.auth.read().await;

        if let Some(ref token) = auth.token {
            let val = format!("Bearer {}", token);
            headers.insert(AUTHORIZATION, HeaderValue::from_str(&val)
                .map_err(|e| K8sError::auth(format!("Invalid token header: {}", e)))?);
        } else if let (Some(ref user), Some(ref pass)) = (&auth.username, &auth.password) {
            let encoded = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                format!("{}:{}", user, pass),
            );
            let val = format!("Basic {}", encoded);
            headers.insert(AUTHORIZATION, HeaderValue::from_str(&val)
                .map_err(|e| K8sError::auth(format!("Invalid basic auth header: {}", e)))?);
        }

        Ok(headers)
    }

    /// Build the full URL for a namespaced API path.
    pub fn namespaced_url(&self, namespace: &str, resource: &str) -> String {
        format!("{}/api/v1/namespaces/{}/{}", self.base_url, namespace, resource)
    }

    /// Build the full URL for a cluster-scoped API path.
    pub fn cluster_url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// Build a URL for apps/v1 namespaced resources.
    pub fn apps_v1_url(&self, namespace: &str, resource: &str) -> String {
        format!("{}/apis/apps/v1/namespaces/{}/{}", self.base_url, namespace, resource)
    }

    /// Build a URL for batch/v1 namespaced resources.
    pub fn batch_v1_url(&self, namespace: &str, resource: &str) -> String {
        format!("{}/apis/batch/v1/namespaces/{}/{}", self.base_url, namespace, resource)
    }

    /// Build a URL for networking.k8s.io/v1 namespaced resources.
    pub fn networking_v1_url(&self, namespace: &str, resource: &str) -> String {
        format!("{}/apis/networking.k8s.io/v1/namespaces/{}/{}", self.base_url, namespace, resource)
    }

    /// Build a URL for rbac.authorization.k8s.io/v1.
    pub fn rbac_v1_url(&self, resource: &str) -> String {
        format!("{}/apis/rbac.authorization.k8s.io/v1/{}", self.base_url, resource)
    }

    /// Build a URL for rbac.authorization.k8s.io/v1 namespaced.
    pub fn rbac_v1_namespaced_url(&self, namespace: &str, resource: &str) -> String {
        format!("{}/apis/rbac.authorization.k8s.io/v1/namespaces/{}/{}", self.base_url, namespace, resource)
    }

    /// Build a URL for autoscaling/v2.
    pub fn autoscaling_v2_url(&self, namespace: &str, resource: &str) -> String {
        format!("{}/apis/autoscaling/v2/namespaces/{}/{}", self.base_url, namespace, resource)
    }

    /// Build a URL for apiextensions.k8s.io/v1.
    pub fn apiextensions_v1_url(&self, resource: &str) -> String {
        format!("{}/apis/apiextensions.k8s.io/v1/{}", self.base_url, resource)
    }

    /// Build a URL for metrics.k8s.io/v1beta1.
    pub fn metrics_url(&self, resource: &str) -> String {
        format!("{}/apis/metrics.k8s.io/v1beta1/{}", self.base_url, resource)
    }

    /// Build a URL for storage.k8s.io/v1.
    pub fn storage_v1_url(&self, resource: &str) -> String {
        format!("{}/apis/storage.k8s.io/v1/{}", self.base_url, resource)
    }

    /// GET request returning parsed JSON.
    pub async fn get<T: serde::de::DeserializeOwned>(&self, url: &str) -> K8sResult<T> {
        let headers = self.auth_headers().await?;
        debug!("GET {}", url);
        let resp = self.http.get(url).headers(headers).send().await?;
        Self::handle_response(resp).await
    }

    /// GET request returning raw string (e.g. logs).
    pub async fn get_text(&self, url: &str) -> K8sResult<String> {
        let headers = self.auth_headers().await?;
        debug!("GET (text) {}", url);
        let resp = self.http.get(url).headers(headers).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(K8sError::api(status.as_u16(), body));
        }
        resp.text().await.map_err(K8sError::from)
    }

    /// POST request with JSON body.
    pub async fn post<T: serde::de::DeserializeOwned>(&self, url: &str, body: &serde_json::Value) -> K8sResult<T> {
        let mut headers = self.auth_headers().await?;
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        debug!("POST {}", url);
        let resp = self.http.post(url).headers(headers).json(body).send().await?;
        Self::handle_response(resp).await
    }

    /// PUT request with JSON body.
    pub async fn put<T: serde::de::DeserializeOwned>(&self, url: &str, body: &serde_json::Value) -> K8sResult<T> {
        let mut headers = self.auth_headers().await?;
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        debug!("PUT {}", url);
        let resp = self.http.put(url).headers(headers).json(body).send().await?;
        Self::handle_response(resp).await
    }

    /// PATCH request (strategic merge).
    pub async fn patch<T: serde::de::DeserializeOwned>(&self, url: &str, body: &serde_json::Value) -> K8sResult<T> {
        let mut headers = self.auth_headers().await?;
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/strategic-merge-patch+json"));
        debug!("PATCH {}", url);
        let resp = self.http.patch(url).headers(headers).json(body).send().await?;
        Self::handle_response(resp).await
    }

    /// PATCH request with server-side apply.
    pub async fn apply<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        body: &serde_json::Value,
        field_manager: &str,
        force: bool,
    ) -> K8sResult<T> {
        let mut headers = self.auth_headers().await?;
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/apply-patch+yaml"));
        let mut full_url = format!("{}?fieldManager={}", url, field_manager);
        if force {
            full_url.push_str("&force=true");
        }
        debug!("APPLY {}", full_url);
        let resp = self.http.patch(&full_url).headers(headers).json(body).send().await?;
        Self::handle_response(resp).await
    }

    /// DELETE request.
    pub async fn delete(&self, url: &str) -> K8sResult<serde_json::Value> {
        let headers = self.auth_headers().await?;
        debug!("DELETE {}", url);
        let resp = self.http.delete(url).headers(headers).send().await?;
        Self::handle_response(resp).await
    }

    /// DELETE with body (delete options).
    pub async fn delete_with_body(&self, url: &str, body: &serde_json::Value) -> K8sResult<serde_json::Value> {
        let mut headers = self.auth_headers().await?;
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        debug!("DELETE (with body) {}", url);
        let resp = self.http.delete(url).headers(headers).json(body).send().await?;
        Self::handle_response(resp).await
    }

    /// Handle HTTP response: check status, parse JSON.
    async fn handle_response<T: serde::de::DeserializeOwned>(resp: reqwest::Response) -> K8sResult<T> {
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            let code = status.as_u16();
            return match code {
                401 => Err(K8sError::auth(body)),
                403 => Err(K8sError::forbidden(body)),
                404 => Err(K8sError::not_found(body)),
                409 => Err(K8sError::conflict(body)),
                _ => Err(K8sError::api(code, body)),
            };
        }
        let body = resp.text().await.map_err(K8sError::from)?;
        serde_json::from_str(&body).map_err(|e| K8sError::parse(format!("{}: {}", e, &body[..body.len().min(200)])))
    }

    /// Build query string from ListOptions.
    pub fn list_query(opts: &ListOptions) -> String {
        let mut params = Vec::new();
        if let Some(ref ls) = opts.label_selector {
            params.push(format!("labelSelector={}", ls));
        }
        if let Some(ref fs) = opts.field_selector {
            params.push(format!("fieldSelector={}", fs));
        }
        if let Some(limit) = opts.limit {
            params.push(format!("limit={}", limit));
        }
        if let Some(ref ct) = opts.continue_token {
            params.push(format!("continue={}", ct));
        }
        if let Some(ref rv) = opts.resource_version {
            params.push(format!("resourceVersion={}", rv));
        }
        if let Some(timeout) = opts.timeout_seconds {
            params.push(format!("timeoutSeconds={}", timeout));
        }
        if opts.watch {
            params.push("watch=true".to_string());
        }
        if opts.allow_watch_bookmarks {
            params.push("allowWatchBookmarks=true".to_string());
        }
        if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        }
    }

    /// Get server version info.
    pub async fn server_version(&self) -> K8sResult<K8sVersion> {
        let url = format!("{}/version", self.base_url);
        self.get(&url).await
    }

    /// Check connectivity to the API server.
    pub async fn health_check(&self) -> K8sResult<bool> {
        let url = format!("{}/healthz", self.base_url);
        match self.get_text(&url).await {
            Ok(body) => Ok(body.trim() == "ok"),
            Err(_) => Ok(false),
        }
    }

    /// List available API resources.
    pub async fn api_resources(&self) -> K8sResult<Vec<ApiResource>> {
        let url = format!("{}/api/v1", self.base_url);
        let resp: serde_json::Value = self.get(&url).await?;
        let resources = resp.get("resources")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter().filter_map(|r| {
                    Some(ApiResource {
                        name: r.get("name")?.as_str()?.to_string(),
                        singular_name: r.get("singularName").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        namespaced: r.get("namespaced").and_then(|v| v.as_bool()).unwrap_or(false),
                        kind: r.get("kind")?.as_str()?.to_string(),
                        group: String::new(),
                        version: "v1".to_string(),
                        verbs: r.get("verbs").and_then(|v| v.as_array()).map(|a| {
                            a.iter().filter_map(|s| s.as_str().map(String::from)).collect()
                        }).unwrap_or_default(),
                        short_names: r.get("shortNames").and_then(|v| v.as_array()).map(|a| {
                            a.iter().filter_map(|s| s.as_str().map(String::from)).collect()
                        }).unwrap_or_default(),
                    })
                }).collect()
            })
            .unwrap_or_default();
        Ok(resources)
    }
}
