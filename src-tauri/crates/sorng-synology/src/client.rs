//! HTTP client with session management and API discovery for Synology DSM.
//!
//! `SynoClient` is the core HTTP abstraction.  It:
//! 1. Discovers available APIs via `SYNO.API.Info`
//! 2. Manages SID session tokens
//! 3. Routes every call through `api_call()` → JSON → `SynoResponse<T>`
//! 4. Handles SynoToken CSRF headers when required
//! 5. Signs non-File-Station requests with `X-SYNO-HASH` after DSM 7's secure
//!    login handshake (see `login_handshake`)

use crate::error::{SynologyError, SynologyResult};
use crate::login_handshake::{SessionIdentity, SessionRoute, SharedSigner, HASH_HEADER};
use crate::response_diagnostics::{Category, ResponseFacts, Stage, RESPONSE_LIMIT};
use crate::types::*;

use reqwest::Client;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::time::Duration;

/// Synology DSM HTTP client.
///
/// Clones share one session: the same cookie jar and, after a secure login,
/// the same request signer, so every copy draws nonces from one sequence.
#[derive(Clone)]
pub struct SynoClient {
    http: Client,
    pub base_url: String,
    pub sid: Option<String>,
    pub syno_token: Option<String>,
    pub device_token: Option<String>,
    pub api_info: HashMap<String, ApiInfoEntry>,
    pub dsm_version: Option<String>,
    pub model: Option<String>,
    pub config: SynologyConfig,
    /// Who signed in, how, and over which kind of route. Replaced per login.
    pub(crate) identity: SessionIdentity,
    /// Present only after a finished secure login handshake.
    pub(crate) request_signer: Option<SharedSigner>,
    pub(crate) route: crate::http_route::NativeHttpRoute,
}

impl std::fmt::Debug for SynoClient {
    // SIDs, tokens, credentials, hosts and handshake state are never printed.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SynoClient")
            .field("connected", &self.sid.is_some())
            .field("identity", &self.identity)
            .field("signed_requests", &self.request_signer.is_some())
            .field("apis", &self.api_info.len())
            .field("dsm_version", &self.dsm_version)
            .field("model", &self.model)
            .finish_non_exhaustive()
    }
}

/// File Station calls (and uploads/downloads) stay unsigned: DSM grants the
/// full session from the login's `ik_message`, and they need no ordering.
fn signs_requests_for(api: &str) -> bool {
    !api.starts_with("SYNO.FileStation.")
}

impl SynoClient {
    /// Create a new client from config.
    pub fn new(config: &SynologyConfig) -> SynologyResult<Self> {
        Self::new_with_route(config, crate::http_route::NativeHttpRoute::Direct {})
    }

    pub fn new_with_route(
        config: &SynologyConfig,
        route: crate::http_route::NativeHttpRoute,
    ) -> SynologyResult<Self> {
        if config.insecure {
            return Err(SynologyError::connection(
                "TLS certificate verification cannot be disabled: insecure=true requires an explicit runtime acknowledgement contract",
            ));
        }
        let scheme = if config.use_https { "https" } else { "http" };
        let host = config.host.trim();
        if host.is_empty()
            || host.chars().any(|c| c.is_control() || "/\\?#@".contains(c))
            || config.port == 0
        {
            return Err(SynologyError::connection(
                "Enter a NAS hostname or IP address without a URL, path, or credentials",
            ));
        }
        let host = host.trim_start_matches('[').trim_end_matches(']');
        let host = if host.contains(':') {
            let address: std::net::Ipv6Addr = host
                .parse()
                .map_err(|_| SynologyError::connection("Invalid NAS IPv6 address"))?;
            format!("[{address}]")
        } else {
            host.to_string()
        };
        let parsed = url::Url::parse(&format!("{scheme}://{host}:{}", config.port))?;
        let base_url = parsed.as_str().trim_end_matches('/').to_string();

        let http = route
            .builder(Duration::from_secs(config.timeout_secs.clamp(1, 300)), true)?
            .build()?;

        Ok(Self {
            http,
            base_url,
            sid: None,
            syno_token: None,
            device_token: config.device_token.clone(),
            api_info: HashMap::new(),
            dsm_version: None,
            model: None,
            config: config.clone(),
            identity: SessionIdentity::unauthenticated(SessionRoute::for_transport(&route)),
            request_signer: None,
            route,
        })
    }

    pub fn is_connected(&self) -> bool {
        self.sid.is_some()
    }

    /// Closed facts about the current login (no host, SID, token or key).
    pub fn session_identity(&self) -> &SessionIdentity {
        &self.identity
    }

    pub(crate) fn reset_anonymous_http(&mut self, referrer: Option<&str>) -> SynologyResult<()> {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(referrer) = referrer {
            headers.insert(
                reqwest::header::REFERER,
                reqwest::header::HeaderValue::from_str(referrer)
                    .map_err(|_| SynologyError::connection("Invalid QuickConnect source origin"))?,
            );
            headers.insert(
                reqwest::header::USER_AGENT,
                reqwest::header::HeaderValue::from_static("SortOfRemoteNG-SynologyAPI/1"),
            );
        }
        self.http = self
            .route
            .builder(
                Duration::from_secs(self.config.timeout_secs.clamp(1, 300)),
                true,
            )?
            .default_headers(headers)
            .build()?;
        self.api_info.clear();
        Ok(())
    }

    /// Produce a safe (no secrets) version of the current config.
    pub fn get_config_safe(&self) -> SynologyConfigSafe {
        SynologyConfigSafe {
            host: self.config.host.clone(),
            port: self.config.port,
            username: self.config.username.clone(),
            use_https: self.config.use_https,
            dsm_version: self.dsm_version.clone(),
            model: self.model.clone(),
        }
    }

    // ── API Discovery ───────────────────────────────────────────────

    /// Query `SYNO.API.Info` to discover all available APIs.
    pub async fn discover_apis(&mut self) -> SynologyResult<()> {
        self.discover_apis_cancellable(&std::sync::atomic::AtomicBool::new(true))
            .await
    }

    pub(crate) async fn discover_apis_cancellable(
        &mut self,
        active: &std::sync::atomic::AtomicBool,
    ) -> SynologyResult<()> {
        if !active.load(std::sync::atomic::Ordering::Acquire) {
            return Err(SynologyError::session_expired(
                "Synology connection attempt was cancelled",
            ));
        }
        match self.discover_at("entry.cgi").await {
            Err(error)
                if error
                    .diagnostic
                    .is_some_and(|facts| facts.discovery_fallback()) =>
            {
                if !active.load(std::sync::atomic::Ordering::Acquire) {
                    return Err(SynologyError::session_expired(
                        "Synology connection attempt was cancelled",
                    ));
                }
                self.discover_at("query.cgi").await
            }
            result => result,
        }
    }

    pub(crate) async fn discover_at(&mut self, gateway: &str) -> SynologyResult<()> {
        let url = format!("{}/webapi/{gateway}", self.base_url);
        let params = [
            ("api", "SYNO.API.Info"),
            ("version", "1"),
            ("method", "query"),
            ("query", "all"),
        ];
        let request = if gateway == "query.cgi" {
            self.http.get(&url).query(&params)
        } else {
            self.http.post(&url).form(&params)
        };
        let (resp, facts): (SynoResponse<HashMap<String, ApiInfoEntry>>, _) =
            Self::read_json_at(request.send().await?, Stage::ApiDiscovery).await?;

        if !resp.success {
            let code = resp.error.map(|e| e.code).unwrap_or(100);
            return Err(facts.annotate(
                SynologyError::from_dsm_code(code, "API discovery"),
                Category::DsmApi,
                Some(code),
            ));
        }

        self.api_info = resp.data.unwrap_or_default();
        log::info!("Discovered {} Synology APIs", self.api_info.len());
        Ok(())
    }

    /// Resolve the full URL for an API call.
    pub fn resolve_url(&self, api: &str, version: u32, method: &str) -> SynologyResult<String> {
        let info = self
            .api_info
            .get(api)
            .ok_or_else(|| SynologyError::api_not_found(format!("API not found: {api}")))?;

        if version < info.min_version || version > info.max_version {
            return Err(SynologyError::version_not_supported(format!(
                "{api} v{version} not in range [{},{}]",
                info.min_version, info.max_version
            )));
        }

        if info.path.is_empty()
            || info.path.len() > 256
            || info.path.contains("..")
            || !info
                .path
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-./".contains(&c))
            || info.path.starts_with('/')
        {
            return Err(SynologyError::parse("NAS supplied an invalid API endpoint"));
        }
        let url = format!(
            "{}/webapi/{}?api={}&version={}&method={}",
            self.base_url, info.path, api, version, method
        );

        Ok(url)
    }

    /// Pick the highest supported version for an API (clamped to our max).
    pub fn best_version(&self, api: &str, our_max: u32) -> Option<u32> {
        self.api_info
            .get(api)
            .map(|info| info.max_version.min(our_max))
    }

    /// Check if a particular API is available.
    pub fn has_api(&self, api: &str) -> bool {
        self.api_info.contains_key(api)
    }

    // ── Generic API calls ───────────────────────────────────────────

    /// Execute an API call using a POST body, never a secret-bearing URL.
    pub async fn api_call<T: DeserializeOwned>(
        &self,
        api: &str,
        version: u32,
        method: &str,
        params: &[(&str, &str)],
    ) -> SynologyResult<T> {
        self.api_post(api, version, method, params).await
    }

    /// Execute a POST-based API call.
    pub async fn api_post<T: DeserializeOwned>(
        &self,
        api: &str,
        version: u32,
        method: &str,
        form: &[(&str, &str)],
    ) -> SynologyResult<T> {
        let (value, facts) = self.post_value_observed(api, version, method, form).await?;
        facts.decode_value(value)
    }

    /// A void POST call (returns `SynoResponse<serde_json::Value>` and ignores data).
    pub async fn api_post_void(
        &self,
        api: &str,
        version: u32,
        method: &str,
        form: &[(&str, &str)],
    ) -> SynologyResult<()> {
        self.post_value(api, version, method, form).await?;
        Ok(())
    }

    /// A void GET call.
    pub async fn api_call_void(
        &self,
        api: &str,
        version: u32,
        method: &str,
        params: &[(&str, &str)],
    ) -> SynologyResult<()> {
        self.api_post_void(api, version, method, params).await
    }

    pub(crate) fn form_request(
        &self,
        api: &str,
        version: u32,
        method: &str,
        form: &[(&str, &str)],
    ) -> SynologyResult<reqwest::RequestBuilder> {
        let url = self.resolve_url(api, version, method)?;
        let mut params = form.to_vec();
        if let Some(sid) = &self.sid {
            params.push(("_sid", sid));
        }
        if let Some(token) = &self.syno_token {
            params.push(("SynoToken", token));
        }
        let mut request = self.http.post(url).form(&params);
        // DSM's entry.cgi authentication middleware can validate CSRF before
        // reading a POST body (notably behind reverse proxies). Keep the
        // documented header as well as the API parameter, never in the URL.
        if let Some(token) = &self.syno_token {
            request = request.header("X-SYNO-TOKEN", token);
        }
        Ok(request)
    }

    /// Sends one API request. After a finished secure login every
    /// non-File-Station request carries `X-SYNO-HASH`. Making the header and
    /// waiting for the response headers happen under one per-session lock, so
    /// DSM receives the nonces in order.
    pub(crate) async fn send_api(
        &self,
        api: &str,
        request: reqwest::RequestBuilder,
    ) -> SynologyResult<reqwest::Response> {
        let Some(signer) = self
            .request_signer
            .as_ref()
            .filter(|_| signs_requests_for(api))
        else {
            return Ok(request.send().await?);
        };
        let mut signer = signer.lock().await;
        let request = match signer.next_header() {
            Some(value) => request.header(HASH_HEADER, value),
            None => request,
        };
        let response = request.send().await;
        drop(signer);
        Ok(response?)
    }

    pub(crate) async fn read_json<T: DeserializeOwned>(
        response: reqwest::Response,
    ) -> SynologyResult<T> {
        Self::read_json_at(response, Stage::ApiResponse)
            .await
            .map(|(value, _)| value)
    }

    async fn read_json_at<T: DeserializeOwned>(
        mut response: reqwest::Response,
        stage: Stage,
    ) -> SynologyResult<(T, ResponseFacts)> {
        let mut facts = ResponseFacts::new(&response, stage);
        if !response.status().is_success() {
            return Err(facts.annotate(
                SynologyError::connection(format!(
                    "NAS HTTP request failed (status {})",
                    response.status().as_u16()
                )),
                Category::HttpStatus,
                None,
            ));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len().saturating_add(chunk.len()) > RESPONSE_LIMIT {
                return Err(facts.annotate(
                    SynologyError::parse("NAS API response exceeds the 8 MiB limit"),
                    Category::ResponseTooLarge,
                    None,
                ));
            }
            bytes.extend_from_slice(&chunk);
            facts.bytes_read = bytes.len();
        }
        facts.decode(&bytes).map(|value| (value, facts))
    }

    pub(crate) async fn post_value(
        &self,
        api: &str,
        version: u32,
        method: &str,
        form: &[(&str, &str)],
    ) -> SynologyResult<serde_json::Value> {
        self.post_value_observed(api, version, method, form)
            .await
            .map(|(value, _)| value)
    }

    async fn post_value_observed(
        &self,
        api: &str,
        version: u32,
        method: &str,
        form: &[(&str, &str)],
    ) -> SynologyResult<(serde_json::Value, ResponseFacts)> {
        let (resp, facts): (SynoResponse<serde_json::Value>, _) = Self::read_json_at(
            self.send_api(api, self.form_request(api, version, method, form)?)
                .await?,
            Stage::operation(api, method),
        )
        .await?;
        if resp.success {
            Ok((resp.data.unwrap_or(serde_json::Value::Null), facts))
        } else {
            let code = resp.error.map(|e| e.code).unwrap_or(100);
            Err(facts.annotate(
                SynologyError::from_dsm_code(code, api),
                Category::DsmApi,
                Some(code),
            ))
        }
    }

    /// File Station declares JSON-encoded parameter VALUES (not a JSON HTTP body).
    pub(crate) async fn file_call(
        &self,
        api: &str,
        maximum: u32,
        method: &str,
        params: &[(&str, serde_json::Value)],
    ) -> SynologyResult<serde_json::Value> {
        self.file_call_typed(api, maximum, method, params).await
    }

    pub(crate) async fn file_call_typed<T: DeserializeOwned>(
        &self,
        api: &str,
        maximum: u32,
        method: &str,
        params: &[(&str, serde_json::Value)],
    ) -> SynologyResult<T> {
        let version = self
            .best_version(api, maximum)
            .ok_or_else(|| SynologyError::api_not_found(format!("NAS does not provide {api}")))?;
        let json_format = self
            .api_info
            .get(api)
            .and_then(|i| i.request_format.as_deref())
            == Some("JSON");
        let values: Vec<_> = params
            .iter()
            .map(|(key, value)| {
                (
                    *key,
                    if !json_format && value.is_string() {
                        value.as_str().unwrap_or_default().to_string()
                    } else {
                        value.to_string()
                    },
                )
            })
            .collect();
        let form: Vec<_> = values
            .iter()
            .map(|(key, value)| (*key, value.as_str()))
            .collect();
        let (response, facts): (SynoResponse<serde_json::Value>, _) = Self::read_json_at(
            self.send_api(api, self.form_request(api, version, method, &form)?)
                .await?,
            Stage::operation(api, method),
        )
        .await?;
        if response.success {
            facts.decode_value(response.data.unwrap_or(serde_json::Value::Null))
        } else {
            let code = response.error.map(|e| e.code).unwrap_or(100);
            // Do not forward NAS-provided nested errors, paths, URLs, or credentials.
            Err(facts.annotate(
                SynologyError::file_station(code),
                Category::DsmApi,
                Some(code),
            ))
        }
    }

    /// Download raw bytes (for FileStation.Download, thumbnails, etc.)
    pub async fn raw_download(
        &self,
        api: &str,
        version: u32,
        method: &str,
        params: &[(&str, &str)],
    ) -> SynologyResult<Vec<u8>> {
        self.raw_download_bounded(api, version, method, params, 32 * 1024 * 1024)
            .await
    }
    pub(crate) async fn raw_download_bounded(
        &self,
        api: &str,
        version: u32,
        method: &str,
        params: &[(&str, &str)],
        limit: usize,
    ) -> SynologyResult<Vec<u8>> {
        let mut resp = self
            .form_request(api, version, method, params)?
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(SynologyError::connection("NAS download request failed"));
        }
        let ct = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let attachment = resp
            .headers()
            .get("content-disposition")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.to_ascii_lowercase().starts_with("attachment"));
        if ct.contains("application/json") && !attachment {
            // DSM returned an error as JSON instead of file bytes
            let err_resp: SynoResponse<()> = Self::read_json(resp).await?;
            let code = err_resp.error.map(|e| e.code).unwrap_or(100);
            return Err(SynologyError::from_dsm_code(code, api));
        }

        let mut bytes = Vec::new();
        while let Some(chunk) = resp.chunk().await? {
            if bytes.len().saturating_add(chunk.len()) > limit {
                return Err(SynologyError::parse(
                    "NAS response exceeds this action's size limit; use File Station's streaming Download for large files",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    /// Get the reqwest client reference (for multipart uploads).
    pub fn http_client(&self) -> &Client {
        &self.http
    }
}
