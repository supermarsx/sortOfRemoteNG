use crate::aws::AwsConnectionConfig;
use crate::cloudflare::CloudflareConnectionConfig;
use crate::vercel::VercelConnectionConfig;
use axum::{
    extract::{ConnectInfo, FromRef, Path, Query, Request, State},
    http::{header, HeaderMap, Method, StatusCode},
    middleware::{from_fn_with_state, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use secrecy::SecretString;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::Instant;
use subtle::ConstantTimeEq;
use tokio::sync::{oneshot, Mutex};
use tower_http::cors::{Any, CorsLayer};

use crate::api_capability::{capability_for_path, capability_id};
use crate::api_config::{ApiRuntimeConfig, SslMode, TlsConfig};
use crate::bearer_auth::{BearerAuthService, BearerAuthServiceState, Role};

use crate::{
    auth::AuthService,
    db::DbService,
    ftp::FtpService,
    network::NetworkService,
    qr::QrService,
    rustdesk::RustDeskService,
    security::SecurityService,
    ssh::{SshConnectionConfig, SshService},
    wol::WolService,
};

#[derive(Clone)]
pub struct ApiService {
    pub auth_service: Arc<Mutex<AuthService>>,
    pub ssh_service: Arc<Mutex<SshService>>,
    pub db_service: Arc<Mutex<DbService>>,
    pub ftp_service: Arc<Mutex<FtpService>>,
    pub network_service: Arc<Mutex<NetworkService>>,
    pub security_service: Arc<Mutex<SecurityService>>,
    pub wol_service: Arc<Mutex<WolService>>,
    pub qr_service: Arc<Mutex<QrService>>,
    pub rustdesk_service: Arc<Mutex<RustDeskService>>,
    pub wmi_service: Arc<Mutex<crate::wmi::WmiService>>,
    pub rpc_service: Arc<Mutex<crate::rpc::RpcService>>,
    pub meshcentral_service: Arc<Mutex<crate::meshcentral::MeshCentralService>>,
    pub agent_service: Arc<Mutex<crate::agent::AgentService>>,
    pub commander_service: Arc<Mutex<crate::commander::CommanderService>>,
    pub aws_service: Arc<Mutex<crate::aws::AwsService>>,
    pub vercel_service: Arc<Mutex<crate::vercel::VercelService>>,
    pub cloudflare_service: Arc<Mutex<crate::cloudflare::CloudflareService>>,
    /// Set of capability IDs currently disabled. Read on every incoming
    /// request by the `capability_gate` middleware. Written by the
    /// `set_api_disabled_capabilities` Tauri command whenever the user
    /// toggles a capability in Settings → API.
    ///
    /// Mandatory capabilities are silently filtered out by the setter
    /// so they can never end up in the set.
    pub disabled_capabilities: Arc<RwLock<HashSet<String>>>,
}

impl ApiService {
    // This is the application composition boundary: keeping one explicit
    // argument per managed service makes accidental service substitution
    // visible at every construction site.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        auth_service: Arc<Mutex<AuthService>>,
        ssh_service: Arc<Mutex<SshService>>,
        db_service: Arc<Mutex<DbService>>,
        ftp_service: Arc<Mutex<FtpService>>,
        network_service: Arc<Mutex<NetworkService>>,
        security_service: Arc<Mutex<SecurityService>>,
        wol_service: Arc<Mutex<WolService>>,
        qr_service: Arc<Mutex<QrService>>,
        rustdesk_service: Arc<Mutex<RustDeskService>>,
        wmi_service: Arc<Mutex<crate::wmi::WmiService>>,
        rpc_service: Arc<Mutex<crate::rpc::RpcService>>,
        meshcentral_service: Arc<Mutex<crate::meshcentral::MeshCentralService>>,
        agent_service: Arc<Mutex<crate::agent::AgentService>>,
        commander_service: Arc<Mutex<crate::commander::CommanderService>>,
        aws_service: Arc<Mutex<crate::aws::AwsService>>,
        vercel_service: Arc<Mutex<crate::vercel::VercelService>>,
        cloudflare_service: Arc<Mutex<crate::cloudflare::CloudflareService>>,
    ) -> Self {
        Self {
            auth_service,
            ssh_service,
            db_service,
            ftp_service,
            network_service,
            security_service,
            wol_service,
            qr_service,
            rustdesk_service,
            wmi_service,
            rpc_service,
            meshcentral_service,
            agent_service,
            commander_service,
            aws_service,
            vercel_service,
            cloudflare_service,
            disabled_capabilities: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    /// Replace the disabled-capability set wholesale. Called from the
    /// `set_api_disabled_capabilities` Tauri command whenever the user
    /// toggles a capability in Settings → API. Mandatory capabilities
    /// (`health`, `auth`) are silently filtered out so they can never
    /// be disabled — defense in depth in case the frontend or
    /// `settings.json` were tampered with.
    pub fn set_disabled_capabilities(&self, ids: impl IntoIterator<Item = String>) {
        use crate::api_capability::ALL_CAPABILITIES;
        let mandatory: HashSet<&'static str> = ALL_CAPABILITIES
            .iter()
            .filter(|c| c.mandatory)
            .map(|c| c.id)
            .collect();
        let cleaned: HashSet<String> = ids
            .into_iter()
            .filter(|id| !mandatory.contains(id.as_str()))
            .collect();
        if let Ok(mut guard) = self.disabled_capabilities.write() {
            *guard = cleaned;
        }
    }

}

/// Composite router state for the hardened REST API (t41).
///
/// Handlers written before t41 keep extracting `State<Arc<ApiService>>`
/// unchanged — the inner [`Arc<ApiService>`] is pulled out of this struct via
/// the [`FromRef`] impl below. The auth/rate-limit/audit middleware and the
/// `/auth/*` handlers extract the whole `ApiState` so they can reach the
/// resolved [`ApiRuntimeConfig`], the shared [`BearerAuthService`] (which owns
/// the JWT revoke list — login issues, logout revokes, the gate verifies, all
/// against the same instance), and the rate-limit buckets.
#[derive(Clone)]
pub struct ApiState {
    /// The backend service registry (SSH/DB/… handlers).
    pub services: Arc<ApiService>,
    /// Resolved runtime config (bind addr, api key, jwt secret, limits, TLS).
    pub config: Arc<ApiRuntimeConfig>,
    /// Shared bearer-token service (issue / verify / revoke session JWTs).
    pub bearer: BearerAuthServiceState,
    /// Fixed-window per-caller rate-limit buckets.
    pub rate_limiter: Arc<RateLimiter>,
}

impl FromRef<ApiState> for Arc<ApiService> {
    fn from_ref(state: &ApiState) -> Self {
        state.services.clone()
    }
}

/// Identified principal for a request, stashed into the response extensions by
/// [`api_key_gate`] so [`audit_mw`] can log *who* made the call without the
/// audit layer re-verifying. Never contains secret material — only a stable
/// label (`api-key`, `user:<name>`, `anonymous`, `unauthenticated`).
#[derive(Clone)]
struct Principal(String);

/// Hand-rolled fixed-window rate limiter (Decision D3 — no new crate).
///
/// One counter per `(client-ip, credential-fingerprint)` per one-minute window.
/// The fingerprint is a non-cryptographic hash of the presented credential
/// header, so two callers sharing an IP get independent budgets **without** the
/// limiter ever storing the raw key/token. `limit == 0` disables limiting.
pub struct RateLimiter {
    limit: u32,
    windows: std::sync::Mutex<HashMap<String, (u64, u32)>>,
}

impl RateLimiter {
    fn new(limit: u32) -> Self {
        RateLimiter {
            limit,
            windows: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// Record one hit for `key`; return `true` if it is within budget.
    fn check(&self, key: &str) -> bool {
        if self.limit == 0 {
            return true;
        }
        let now_min = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() / 60)
            .unwrap_or(0);
        let mut windows = match self.windows.lock() {
            Ok(g) => g,
            // A poisoned lock fails closed rather than panicking the request.
            Err(_) => return false,
        };
        // Bound memory: drop stale windows when the map grows large.
        if windows.len() > 4096 {
            windows.retain(|_, (min, _)| *min == now_min);
        }
        let entry = windows.entry(key.to_string()).or_insert((now_min, 0));
        if entry.0 != now_min {
            *entry = (now_min, 0);
        }
        entry.1 = entry.1.saturating_add(1);
        entry.1 <= self.limit
    }
}

/// Whether an HTTP method mutates server state. Readonly-role tokens are
/// rejected on any mutating method.
fn is_mutating(method: &Method) -> bool {
    !matches!(
        *method,
        Method::GET | Method::HEAD | Method::OPTIONS | Method::TRACE
    )
}

/// Constant-time byte-equality for the API key (`subtle`). Length is compared
/// first (an unavoidable, non-secret leak for a fixed-width key); the content
/// comparison itself is constant-time.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.ct_eq(b).into()
}

/// Outcome of the authentication decision made by [`api_key_gate`].
enum AuthDecision {
    /// Allowed; carries the principal label for the audit log.
    Allow(Principal),
    /// Missing/invalid credential where one is required.
    Unauthorized,
    /// Valid readonly token used against a mutating route.
    ForbiddenReadonly,
}

/// Pure authentication/authorization decision — no I/O beyond the in-memory
/// bearer verify, so it is unit-testable without constructing an [`ApiService`].
///
/// Order: `/health` and `/auth/login` are always exempt (login is itself an
/// authentication endpoint, guarded by `AuthService`'s per-user lockout). When
/// auth is not required, everything passes. Otherwise a constant-time
/// `X-API-Key` match grants full (admin-equivalent) access; failing that, a
/// valid `Authorization: Bearer <jwt>` is accepted, with readonly tokens
/// rejected on mutating methods.
fn decide_auth(
    config: &ApiRuntimeConfig,
    bearer: &BearerAuthService,
    path: &str,
    method: &Method,
    headers: &HeaderMap,
) -> AuthDecision {
    if path == "/health" || path == "/auth/login" {
        return AuthDecision::Allow(Principal("anonymous".to_string()));
    }
    if !config.auth_required {
        return AuthDecision::Allow(Principal("unauthenticated".to_string()));
    }

    // Static API key (external callers) — constant-time compare.
    if let Some(key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        if constant_time_eq(key.as_bytes(), config.api_key.as_bytes()) {
            return AuthDecision::Allow(Principal("api-key".to_string()));
        }
    }

    // Internal short-lived JWT (logged-in sessions).
    if let Some(token) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
    {
        if let Ok(claims) = bearer.verify_session_token(config.jwt_secret.as_bytes(), token) {
            if claims.role == Role::Readonly && is_mutating(method) {
                return AuthDecision::ForbiddenReadonly;
            }
            return AuthDecision::Allow(Principal(format!("user:{}", claims.sub)));
        }
    }

    AuthDecision::Unauthorized
}

/// Best-effort client IP for logging / rate-limit keys. Falls back to
/// `"unknown"` when connection info isn't present (e.g. unit tests calling the
/// router directly). Deliberately does NOT trust `X-Forwarded-For`: this server
/// terminates connections directly, so a spoofed header must not let a caller
/// escape their rate-limit bucket.
fn client_ip(req: &Request) -> String {
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Rate-limit bucket key: client IP plus a non-cryptographic fingerprint of the
/// presented credential header (so the raw key/token is never stored).
fn rate_limit_key(req: &Request) -> String {
    use std::hash::{Hash, Hasher};
    let cred = req
        .headers()
        .get("x-api-key")
        .or_else(|| req.headers().get(header::AUTHORIZATION))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    cred.hash(&mut hasher);
    format!("{}|{:x}", client_ip(req), hasher.finish())
}

fn unauthorized_response() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({
            "error": "unauthorized",
            "message": "Missing or invalid credentials. Provide a valid X-API-Key header or Authorization: Bearer <token>.",
        })),
    )
        .into_response()
}

fn forbidden_readonly_response() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({
            "error": "readonly",
            "message": "This token has the readonly role and cannot perform mutating requests.",
        })),
    )
        .into_response()
}

fn too_many_requests_response() -> Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        Json(serde_json::json!({
            "error": "rate_limited",
            "message": "Request rate limit exceeded. Slow down and retry.",
        })),
    )
        .into_response()
}

/// Build the CORS layer. When `corsEnabled` is off we install a bare
/// [`CorsLayer`] that adds no `Access-Control-Allow-*` headers, so browsers
/// enforce same-origin. When on, permit any origin/method/header (v1 — a
/// tighter allow-list is a future refinement).
fn cors_layer(config: &ApiRuntimeConfig) -> CorsLayer {
    if config.cors_enabled {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        CorsLayer::new()
    }
}

/// Start the REST API server (t41 shared-interface entry point).
///
/// Binds `config.bind_addr()`, serves the hardened router with graceful
/// shutdown on `shutdown_rx`, and uses TLS (axum-server + rustls) when
/// `config.tls.enabled`, else plain HTTP. The [`BearerAuthService`] and
/// rate-limit buckets are created per server run and live for its lifetime.
pub async fn start_server(
    config: ApiRuntimeConfig,
    services: Arc<ApiService>,
    shutdown_rx: oneshot::Receiver<()>,
) -> anyhow::Result<()> {
    let rate_limiter = Arc::new(RateLimiter::new(config.rate_limit_per_minute));
    let bearer = BearerAuthService::new();
    let bind = config.bind_addr();
    let tls = config.tls.clone();

    let state = ApiState {
        services,
        config: Arc::new(config),
        bearer,
        rate_limiter,
    };
    let app = create_router(state);

    if tls.enabled {
        serve_tls(bind, tls, app, shutdown_rx).await
    } else {
        tracing::info!(target: "api", %bind, tls = false, "starting REST API server");
        let listener = tokio::net::TcpListener::bind(bind)
            .await
            .map_err(|e| anyhow::anyhow!("failed to bind {bind}: {e}"))?;
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        })
        .await
        .map_err(|e| anyhow::anyhow!("REST API server error: {e}"))?;
        Ok(())
    }
}

/// Serve the router over TLS via `axum-server`. Graceful shutdown is driven by
/// `shutdown_rx` through an `axum_server::Handle`.
async fn serve_tls(
    bind: SocketAddr,
    tls: TlsConfig,
    app: Router,
    shutdown_rx: oneshot::Receiver<()>,
) -> anyhow::Result<()> {
    let rustls_config = build_rustls_config(&tls).await?;
    let handle = axum_server::Handle::new();
    let shutdown_handle = handle.clone();
    tokio::spawn(async move {
        let _ = shutdown_rx.await;
        shutdown_handle.graceful_shutdown(Some(std::time::Duration::from_secs(5)));
    });
    tracing::info!(target: "api", %bind, tls = true, mode = ?tls.mode, "starting REST API server");
    axum_server::bind_rustls(bind, rustls_config)
        .handle(handle)
        .serve(app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .map_err(|e| anyhow::anyhow!("REST API TLS server error: {e}"))?;
    Ok(())
}

/// Resolve an `axum_server` rustls config from the resolved [`TlsConfig`].
/// Reuses the process-default crypto provider (ring, installed in `run()`), so
/// no provider is forced here. The private key is loaded straight into rustls
/// and is never logged.
async fn build_rustls_config(
    tls: &TlsConfig,
) -> anyhow::Result<axum_server::tls_rustls::RustlsConfig> {
    use axum_server::tls_rustls::RustlsConfig;
    match tls.mode {
        SslMode::Manual => {
            let cert = tls
                .cert_path
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("manual TLS requires an sslCertPath"))?;
            let key = tls
                .key_path
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("manual TLS requires an sslKeyPath"))?;
            RustlsConfig::from_pem_file(cert, key)
                .await
                .map_err(|e| anyhow::anyhow!("failed to load TLS cert/key: {e}"))
        }
        SslMode::SelfSigned => {
            use crate::cert_gen::{
                CertGenParams, CertGenService, CertProfile, KeyAlgorithm, SignatureHash,
            };
            let cn = tls
                .domain
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "localhost".to_string());
            let params = CertGenParams {
                common_name: cn.clone(),
                organization: Some("sortOfRemoteNG (self-signed API)".to_string()),
                organizational_unit: None,
                country: None,
                state: None,
                locality: None,
                san_dns: vec![cn],
                san_ips: vec![],
                san_emails: vec![],
                algorithm: KeyAlgorithm::EcdsaP256,
                signature_hash: SignatureHash::Sha256,
                profile: CertProfile::TlsServer,
                validity_days: 365,
                path_length: None,
            };
            let store_path = std::env::temp_dir()
                .join("sorng-api-selfsigned-certs.json")
                .to_string_lossy()
                .to_string();
            let svc = CertGenService::new(store_path);
            let mut guard = svc.lock().await;
            let generated = guard
                .generate_self_signed(params)
                .await
                .map_err(|e| anyhow::anyhow!("failed to generate self-signed cert: {e}"))?;
            RustlsConfig::from_pem(
                generated.cert_pem.into_bytes(),
                generated.key_pem.into_bytes(),
            )
            .await
            .map_err(|e| anyhow::anyhow!("failed to load self-signed cert: {e}"))
        }
        SslMode::LetsEncrypt => {
            // Live ACME issuance is host-gated (needs a public domain + port-80
            // reachability). Wiring `sorng-letsencrypt` into the serve path is
            // deferred; fail closed rather than silently downgrade to plain HTTP.
            anyhow::bail!(
                "Let's Encrypt TLS is not yet wired at runtime; use sslMode \"manual\" or \"self-signed\""
            )
        }
    }
}

/// Build the hardened REST API router.
///
/// Middleware order (outer → inner): audit-log → CORS → rate-limit →
/// `api_key_gate` (auth) → `capability_gate` → route. `/health` short-circuits
/// auth/capability/rate-limit; `/auth/login` is exempt from the key gate (it is
/// the credential-exchange endpoint, guarded by `AuthService` lockout).
pub fn create_router(state: ApiState) -> Router {
    Router::new()
            .route("/health", get(health_check))
            // Authentication / session tokens
            .route("/auth/login", post(login))
            .route("/auth/logout", post(logout))
            .route("/auth/whoami", get(whoami))
            .route("/auth/users", get(list_users))
            // SSH
            .route("/ssh/connect", post(connect_ssh))
            .route("/ssh/execute", post(execute_command))
            .route("/ssh/sessions", get(list_ssh_sessions))
            // Database
            .route("/db/connect", post(connect_mysql))
            .route("/db/query", post(execute_query))
            // FTP
            .route("/ftp/connect", post(connect_ftp))
            .route("/ftp/files/:session_id", get(list_ftp_files))
            // Network
            .route("/network/ping", post(ping_host))
            .route("/network/scan", post(scan_network))
            .route(
                "/network/scan/comprehensive",
                post(scan_network_comprehensive),
            )
            // Security
            .route("/security/totp/generate", get(generate_totp_secret))
            .route("/security/totp/verify", post(verify_totp))
            // WOL
            .route("/wol/wake", post(wake_on_lan))
            // QR Code
            .route("/qr/generate", post(generate_qr_code))
            .route("/qr/generate/png", post(generate_qr_code_png))
            // RustDesk
            .route("/rustdesk/connect", post(connect_rustdesk_api))
            .route(
                "/rustdesk/disconnect/:session_id",
                post(disconnect_rustdesk_api),
            )
            .route("/rustdesk/sessions", get(list_rustdesk_sessions_api))
            .route(
                "/rustdesk/session/:session_id",
                get(get_rustdesk_session_api),
            )
            .route(
                "/rustdesk/settings/:session_id",
                post(update_rustdesk_settings_api),
            )
            .route("/rustdesk/input/:session_id", post(send_rustdesk_input_api))
            .route(
                "/rustdesk/screenshot/:session_id",
                get(get_rustdesk_screenshot_api),
            )
            .route("/rustdesk/status", get(rustdesk_status_api))
            // WMI
            .route("/wmi/connect", post(connect_wmi_api))
            .route("/wmi/disconnect/:session_id", post(disconnect_wmi_api))
            .route("/wmi/sessions", get(list_wmi_sessions_api))
            .route("/wmi/session/:session_id", get(get_wmi_session_api))
            .route("/wmi/query/:session_id", post(execute_wmi_query_api))
            .route("/wmi/classes/:session_id", get(get_wmi_classes_api))
            .route("/wmi/namespaces/:session_id", get(get_wmi_namespaces_api))
            // RPC
            .route("/rpc/connect", post(connect_rpc_api))
            .route("/rpc/disconnect/:session_id", post(disconnect_rpc_api))
            .route("/rpc/sessions", get(list_rpc_sessions_api))
            .route("/rpc/session/:session_id", get(get_rpc_session_api))
            .route("/rpc/call/:session_id", post(call_rpc_method_api))
            .route("/rpc/methods/:session_id", get(discover_rpc_methods_api))
            .route("/rpc/batch/:session_id", post(batch_rpc_calls_api))
            // MeshCentral
            .route("/meshcentral/connect", post(connect_meshcentral_api))
            .route(
                "/meshcentral/disconnect/:session_id",
                post(disconnect_meshcentral_api),
            )
            .route("/meshcentral/sessions", get(list_meshcentral_sessions_api))
            .route(
                "/meshcentral/session/:session_id",
                get(get_meshcentral_session_api),
            )
            .route(
                "/meshcentral/devices/:session_id",
                get(get_meshcentral_devices_api),
            )
            .route(
                "/meshcentral/groups/:session_id",
                get(get_meshcentral_groups_api),
            )
            .route(
                "/meshcentral/command/:session_id",
                post(execute_meshcentral_command_api),
            )
            .route(
                "/meshcentral/command/:session_id/:command_id",
                get(get_meshcentral_command_result_api),
            )
            .route(
                "/meshcentral/server/:session_id",
                get(get_meshcentral_server_info_api),
            )
            // Agent
            .route("/agent/connect", post(connect_agent_api))
            .route("/agent/disconnect/:session_id", post(disconnect_agent_api))
            .route("/agent/sessions", get(list_agent_sessions_api))
            .route("/agent/session/:session_id", get(get_agent_session_api))
            .route("/agent/metrics/:session_id", get(get_agent_metrics_api))
            .route("/agent/logs/:session_id", get(get_agent_logs_api))
            .route(
                "/agent/command/:session_id",
                post(execute_agent_command_api),
            )
            .route(
                "/agent/command/:session_id/:command_id",
                get(get_agent_command_result_api),
            )
            .route("/agent/status/:session_id", post(update_agent_status_api))
            .route("/agent/info/:session_id", get(get_agent_info_api))
            // Commander
            .route("/commander/connect", post(connect_commander_api))
            .route(
                "/commander/disconnect/:session_id",
                post(disconnect_commander_api),
            )
            .route("/commander/sessions", get(list_commander_sessions_api))
            .route(
                "/commander/session/:session_id",
                get(get_commander_session_api),
            )
            .route(
                "/commander/command/:session_id",
                post(execute_commander_command_api),
            )
            .route(
                "/commander/command/:session_id/:command_id",
                get(get_commander_command_result_api),
            )
            .route(
                "/commander/upload/:session_id",
                post(upload_commander_file_api),
            )
            .route(
                "/commander/download/:session_id",
                post(download_commander_file_api),
            )
            .route(
                "/commander/transfer/:session_id/:transfer_id",
                get(get_commander_file_transfer_api),
            )
            .route(
                "/commander/list/:session_id",
                get(list_commander_directory_api),
            )
            .route(
                "/commander/status/:session_id",
                post(update_commander_status_api),
            )
            .route(
                "/commander/system/:session_id",
                get(get_commander_system_info_api),
            )
            // AWS
            .route("/aws/connect", post(connect_aws_api))
            .route("/aws/disconnect/:session_id", post(disconnect_aws_api))
            .route("/aws/sessions", get(list_aws_sessions_api))
            .route("/aws/session/:session_id", get(get_aws_session_api))
            .route(
                "/aws/ec2/instances/:session_id",
                get(list_ec2_instances_api),
            )
            .route(
                "/aws/ec2/instance/:session_id/:instance_id",
                get(get_ec2_instance_api),
            )
            .route(
                "/aws/ec2/action/:session_id/:instance_id",
                post(execute_ec2_action_api),
            )
            .route("/aws/s3/buckets/:session_id", get(list_s3_buckets_api))
            .route(
                "/aws/s3/bucket/:session_id/:bucket_name",
                get(get_s3_bucket_api),
            )
            .route(
                "/aws/s3/objects/:session_id/:bucket_name",
                get(list_s3_objects_api),
            )
            .route(
                "/aws/s3/object/:session_id/:bucket_name/*key",
                get(get_s3_object_api),
            )
            .route(
                "/aws/rds/instances/:session_id",
                get(list_rds_instances_api),
            )
            .route(
                "/aws/rds/instance/:session_id/:instance_id",
                get(get_rds_instance_api),
            )
            .route(
                "/aws/lambda/functions/:session_id",
                get(list_lambda_functions_api),
            )
            .route(
                "/aws/lambda/function/:session_id/:function_name",
                get(get_lambda_function_api),
            )
            .route(
                "/aws/cloudwatch/metrics/:session_id",
                get(get_cloudwatch_metrics_api),
            )
            // Vercel
            .route("/vercel/connect", post(connect_vercel_api))
            .route(
                "/vercel/disconnect/:session_id",
                post(disconnect_vercel_api),
            )
            .route("/vercel/sessions", get(list_vercel_sessions_api))
            .route("/vercel/session/:session_id", get(get_vercel_session_api))
            .route(
                "/vercel/projects/:session_id",
                get(list_vercel_projects_api),
            )
            .route(
                "/vercel/project/:session_id/:project_id",
                get(get_vercel_project_api),
            )
            .route(
                "/vercel/deployments/:session_id/:project_id",
                get(list_vercel_deployments_api),
            )
            .route(
                "/vercel/deployment/:session_id/:deployment_id",
                get(get_vercel_deployment_api),
            )
            .route("/vercel/domains/:session_id", get(list_vercel_domains_api))
            .route(
                "/vercel/domain/:session_id/:domain_name",
                get(get_vercel_domain_api),
            )
            .route("/vercel/teams/:session_id", get(list_vercel_teams_api))
            .route(
                "/vercel/team/:session_id/:team_id",
                get(get_vercel_team_api),
            )
            // Cloudflare
            .route("/cloudflare/connect", post(connect_cloudflare_api))
            .route(
                "/cloudflare/disconnect/:session_id",
                post(disconnect_cloudflare_api),
            )
            .route("/cloudflare/sessions", get(list_cloudflare_sessions_api))
            .route(
                "/cloudflare/session/:session_id",
                get(get_cloudflare_session_api),
            )
            .route(
                "/cloudflare/zones/:session_id",
                get(list_cloudflare_zones_api),
            )
            .route(
                "/cloudflare/zone/:session_id/:zone_id",
                get(get_cloudflare_zone_api),
            )
            .route(
                "/cloudflare/dns/:session_id/:zone_id",
                get(list_cloudflare_dns_records_api),
            )
            .route(
                "/cloudflare/dns/:session_id/:zone_id/:record_id",
                get(get_cloudflare_dns_record_api),
            )
            .route(
                "/cloudflare/workers/:session_id",
                get(list_cloudflare_workers_api),
            )
            .route(
                "/cloudflare/worker/:session_id/:worker_id",
                get(get_cloudflare_worker_api),
            )
            .route(
                "/cloudflare/pagerules/:session_id/:zone_id",
                get(list_cloudflare_page_rules_api),
            )
            .route(
                "/cloudflare/pagerule/:session_id/:zone_id/:rule_id",
                get(get_cloudflare_page_rule_api),
            )
            .route(
                "/cloudflare/analytics/:session_id/:zone_id",
                get(get_cloudflare_analytics_api),
            )
            // Middleware stack, applied outer → inner as:
            //   audit-log → CORS → rate-limit → api_key_gate → capability_gate.
            // (`.layer` wraps bottom-up, so the LAST `.layer` call is the
            // outermost. capability_gate — the existing 403-on-disabled gate —
            // stays innermost so it wraps every route above.)
            .layer(from_fn_with_state(state.clone(), capability_gate))
            .layer(from_fn_with_state(state.clone(), api_key_gate))
            .layer(from_fn_with_state(state.clone(), rate_limit_mw))
            .layer(cors_layer(&state.config))
            .layer(from_fn_with_state(state.clone(), audit_mw))
            .with_state(state)
}

/// Outermost middleware: structured audit log of every request (method, path,
/// client IP, status, latency, principal). Redacts by construction — it never
/// touches request/response *bodies* or credential headers, and the principal
/// label carries no secret. `/health` is skipped to avoid probe spam.
async fn audit_mw(State(_state): State<ApiState>, req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    if path == "/health" {
        return next.run(req).await;
    }
    let method = req.method().clone();
    let ip = client_ip(&req);
    let started = Instant::now();
    let response = next.run(req).await;
    let status = response.status().as_u16();
    let principal = response
        .extensions()
        .get::<Principal>()
        .map(|p| p.0.clone())
        .unwrap_or_else(|| "-".to_string());
    tracing::info!(
        target: "api::audit",
        method = %method,
        path = %path,
        ip = %ip,
        status,
        principal = %principal,
        latency_ms = started.elapsed().as_millis() as u64,
        "api request",
    );
    response
}

/// Rate-limit middleware (D3). Skips `/health` and is a no-op when the limit is
/// 0. Keyed by client IP + credential fingerprint so one caller can't exhaust
/// another's budget.
async fn rate_limit_mw(State(state): State<ApiState>, req: Request, next: Next) -> Response {
    if state.config.rate_limit_per_minute == 0 || req.uri().path() == "/health" {
        return next.run(req).await;
    }
    let key = rate_limit_key(&req);
    if state.rate_limiter.check(&key) {
        next.run(req).await
    } else {
        too_many_requests_response()
    }
}

/// Authentication gate. Enforces [`decide_auth`] and, on success, records the
/// resolved principal into the response extensions for [`audit_mw`]. Never logs
/// the key or token.
async fn api_key_gate(State(state): State<ApiState>, req: Request, next: Next) -> Response {
    let decision = {
        let bearer = state.bearer.lock().await;
        decide_auth(
            &state.config,
            &bearer,
            req.uri().path(),
            req.method(),
            req.headers(),
        )
    };
    match decision {
        AuthDecision::Allow(principal) => {
            let mut response = next.run(req).await;
            response.extensions_mut().insert(principal);
            response
        }
        AuthDecision::Unauthorized => unauthorized_response(),
        AuthDecision::ForbiddenReadonly => forbidden_readonly_response(),
    }
}

/// Axum middleware: look up the capability for the requested path and
/// short-circuit with `403 Forbidden` + a structured JSON body if it
/// is in the disabled set.
///
/// Paths that don't map to any capability (i.e. unknown routes) fall
/// through — they'll hit axum's normal 404 handler.
async fn capability_gate(
    State(svc): State<Arc<ApiService>>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path();
    if let Some(cap) = capability_for_path(path) {
        let id = capability_id(cap);
        let disabled = svc
            .disabled_capabilities
            .read()
            .map(|g| g.contains(id))
            .unwrap_or(false);
        if disabled {
            let body = Json(serde_json::json!({
                "error": "capability_disabled",
                "capability": id,
                "message": format!(
                    "The {id} capability is currently disabled. \
                     Re-enable it in Settings → API → Capabilities.",
                ),
            }));
            return (StatusCode::FORBIDDEN, body).into_response();
        }
    }
    next.run(req).await
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "sortOfRemoteNG API",
        "version": "1.0.0"
    }))
}

// Authentication handlers
#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

/// TTL for issued session tokens (1 hour — the policy ceiling enforced in
/// `sorng-auth`, so anything longer is clamped there anyway).
const SESSION_TTL_SECS: i64 = 3600;

/// `POST /auth/login` — verify user/pass against the file-backed store and, on
/// success, mint a short-lived HS256 session token. Returns `{ token,
/// expires_at, role }`. Never logs the password or the issued token.
async fn login(
    State(state): State<ApiState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // AuthService applies argon2/bcrypt verification plus per-user lockout.
    let verified = {
        let mut auth = state.services.auth_service.lock().await;
        match auth.verify_user(&req.username, &req.password).await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(target: "api", "login verification error: {e}");
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    };
    if !verified {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // v1 role model: authenticated users receive the Admin role. A dedicated
    // role store (readonly principals) is a future refinement — the middleware
    // already enforces readonly restrictions, so only the claim source changes.
    let issued = {
        let bearer = state.bearer.lock().await;
        bearer
            .issue_session_token(
                state.config.jwt_secret.as_bytes(),
                &req.username,
                Role::Admin,
                SESSION_TTL_SECS,
            )
            .map_err(|e| {
                tracing::error!(target: "api", "failed to issue session token: {e}");
                StatusCode::INTERNAL_SERVER_ERROR
            })?
    };

    // `SessionToken` serializes to exactly `{ token, expires_at, role }`.
    serde_json::to_value(&issued)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// Extract a `Bearer <jwt>` token from the Authorization header, if present.
fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t.trim().to_string())
}

/// `POST /auth/logout` — revoke the caller's current session token. Idempotent:
/// revoking an unknown/expired token still succeeds so clients can always log
/// out.
async fn logout(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    match bearer_token(&headers) {
        Some(token) => {
            state.bearer.lock().await.revoke_session_token(&token);
            (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response()
        }
        None => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "no_token",
                "message": "No Authorization: Bearer token to revoke.",
            })),
        )
            .into_response(),
    }
}

/// `GET /auth/whoami` — echo the authenticated principal + role (diagnostics).
/// Reached only after `api_key_gate`, so the caller is already authenticated; a
/// valid Bearer yields its subject/role, otherwise the caller used the static
/// API key.
async fn whoami(State(state): State<ApiState>, headers: HeaderMap) -> Json<serde_json::Value> {
    if let Some(token) = bearer_token(&headers) {
        let bearer = state.bearer.lock().await;
        if let Ok(claims) = bearer.verify_session_token(state.config.jwt_secret.as_bytes(), &token) {
            return Json(serde_json::json!({
                "principal": claims.sub,
                "role": claims.role,
                "auth": "bearer",
            }));
        }
    }
    Json(serde_json::json!({
        "principal": "api-key",
        "role": Role::Admin,
        "auth": "api-key",
    }))
}

async fn list_users(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let auth = services.auth_service.lock().await;
    let users = auth.list_users().await;
    Ok(Json(serde_json::json!({
        "users": users
    })))
}

// SSH handlers
#[derive(Deserialize)]
struct SshConnectRequest {
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    key_path: Option<String>,
}

async fn connect_ssh(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<SshConnectRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let config = SshConnectionConfig {
        host: req.host,
        port: req.port,
        username: req.username,
        password: req.password.map(SecretString::new),
        private_key_path: req.key_path,
        private_key_passphrase: None,
        jump_hosts: Vec::new(),
        proxy_config: None,
        proxy_chain: None,
        mixed_chain: None,
        openvpn_config: None,
        connect_timeout: None,
        keep_alive_interval: None,
        strict_host_key_checking: true,
        known_hosts_path: None,
        totp_secret: None,
        keyboard_interactive_responses: vec![],
        agent_forwarding: false,
        tcp_no_delay: true,
        tcp_keepalive: true,
        keepalive_probes: 3,
        ip_protocol: "auto".to_string(),
        compression: false,
        compression_level: 6,
        ssh_version: "auto".to_string(),
        preferred_ciphers: vec![],
        preferred_macs: vec![],
        preferred_kex: vec![],
        preferred_host_key_algorithms: vec![],
        x11_forwarding: None,
        proxy_command: None,
        pty_type: None,
        environment: std::collections::HashMap::new(),
        compression_config: Default::default(),
        sk_auth: false,
        sk_device_path: None,
        sk_pin: None,
        sk_application: None,
    };

    let mut ssh = services.ssh_service.lock().await;
    match ssh.connect_ssh(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "success": true,
            "session_id": session_id
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

#[derive(Deserialize)]
struct ExecuteCommandRequest {
    session_id: String,
    command: String,
}

async fn execute_command(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<ExecuteCommandRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut ssh = services.ssh_service.lock().await;
    match ssh
        .execute_command(&req.session_id, req.command, None)
        .await
    {
        Ok(output) => Ok(Json(serde_json::json!({
            "success": true,
            "output": output
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

async fn list_ssh_sessions(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let ssh = services.ssh_service.lock().await;
    let sessions = ssh.list_sessions().await;
    Ok(Json(serde_json::json!({
        "sessions": sessions
    })))
}

// Database handlers
#[derive(Deserialize)]
struct DbConnectRequest {
    host: String,
    port: u16,
    username: String,
    password: String,
    database: Option<String>,
}

async fn connect_mysql(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<DbConnectRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut db = services.db_service.lock().await;
    match db
        .connect_mysql(
            req.host,
            req.port,
            req.username,
            req.password,
            req.database.unwrap_or_default(),
            None,
            None,
            None,
        )
        .await
    {
        Ok(connection_id) => Ok(Json(serde_json::json!({
            "success": true,
            "connection_id": connection_id
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct QueryRequest {
    connection_id: String,
    query: String,
}

async fn execute_query(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<QueryRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let db = services.db_service.lock().await;
    match db.execute_query(req.query).await {
        Ok(results) => Ok(Json(serde_json::json!({
            "success": true,
            "results": results
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

// FTP handlers
#[derive(Deserialize)]
struct FtpConnectRequest {
    host: String,
    port: u16,
    username: String,
    password: String,
}

async fn connect_ftp(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<FtpConnectRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut ftp = services.ftp_service.lock().await;
    let config = crate::ftp::FtpConnectionConfig {
        host: req.host,
        port: req.port,
        username: req.username,
        password: req.password,
        ..Default::default()
    };
    match ftp.connect(config).await {
        Ok(info) => Ok(Json(serde_json::json!({
            "success": true,
            "session_id": info.id
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

async fn list_ftp_files(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut ftp = services.ftp_service.lock().await;
    let path = params.get("path").unwrap_or(&"/".to_string()).clone();

    match ftp.list_directory(&session_id, Some(&path), None).await {
        Ok(files) => Ok(Json(serde_json::json!({
            "files": files
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

// Network handlers
#[derive(Deserialize)]
struct PingRequest {
    host: String,
}

async fn ping_host(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<PingRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let network = services.network_service.lock().await;
    match network.ping_host(req.host).await {
        Ok(result) => Ok(Json(serde_json::json!({
            "result": result
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

#[derive(Deserialize)]
struct ScanRequest {
    network: String,
}

async fn scan_network(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<ScanRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let network = services.network_service.lock().await;
    match network.scan_network(req.network).await {
        Ok(hosts) => Ok(Json(serde_json::json!({
            "hosts": hosts
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

async fn scan_network_comprehensive(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<ScanRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let network = services.network_service.lock().await;
    match network.scan_network_comprehensive(req.network, true).await {
        Ok(results) => Ok(Json(serde_json::json!({
            "results": results
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

// Security handlers
async fn generate_totp_secret(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut security = services.security_service.lock().await;
    match security.generate_totp_secret().await {
        Ok(secret) => Ok(Json(serde_json::json!({
            "secret": secret
        }))),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

#[derive(Deserialize)]
struct VerifyTotpRequest {
    code: String,
}

async fn verify_totp(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<VerifyTotpRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let security = services.security_service.lock().await;
    match security.verify_totp(req.code).await {
        Ok(valid) => Ok(Json(serde_json::json!({
            "valid": valid
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

// WOL handlers
#[derive(Deserialize)]
#[allow(dead_code)]
struct WolRequest {
    #[serde(alias = "macAddress")]
    mac_address: String,
    #[serde(default, alias = "broadcastAddress", alias = "broadcast_address")]
    broadcast_addr: Option<String>,
    #[serde(default, alias = "targetAddress", alias = "target_address")]
    target_addr: Option<String>,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    password: Option<String>,
}

async fn wake_on_lan(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<WolRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let wol = services.wol_service.lock().await;
    match wol
        .wake_on_lan(
            req.mac_address,
            req.broadcast_addr,
            req.port,
            req.password,
            req.target_addr,
        )
        .await
    {
        Ok(outcome) => Ok(Json(serde_json::json!({
            "success": true,
            "message": if outcome.warnings.is_empty() {
                "Wake-on-LAN packet sent"
            } else {
                "Wake-on-LAN packet sent with warnings"
            },
            "outcome": outcome
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

// QR Code handlers
#[derive(Deserialize)]
struct QrRequest {
    data: String,
    size: Option<u32>,
}

async fn generate_qr_code(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<QrRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let qr = services.qr_service.lock().await;
    match qr.generate_qr_code(req.data, req.size).await {
        Ok(qr_code) => Ok(Json(serde_json::json!({
            "qr_code": qr_code
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

async fn generate_qr_code_png(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<QrRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let qr = services.qr_service.lock().await;
    match qr.generate_qr_code_png(req.data, req.size).await {
        Ok(qr_code) => Ok(Json(serde_json::json!({
            "qr_code": qr_code
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

// RustDesk API handlers
async fn connect_rustdesk_api(
    State(services): State<Arc<ApiService>>,
    Json(config): Json<crate::rustdesk::RustDeskConnectRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut rustdesk = services.rustdesk_service.lock().await;
    match rustdesk.connect(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id,
            "status": "connected"
        }))),
        Err(e) => {
            eprintln!("Failed to connect RustDesk: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_rustdesk_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut rustdesk = services.rustdesk_service.lock().await;
    match rustdesk.disconnect(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect RustDesk: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_rustdesk_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rustdesk = services.rustdesk_service.lock().await;
    let sessions = rustdesk.list_sessions();
    Ok(Json(serde_json::json!({
        "sessions": sessions
    })))
}

async fn get_rustdesk_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rustdesk = services.rustdesk_service.lock().await;
    match rustdesk.get_session(&session_id) {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[derive(Deserialize)]
struct UpdateSettingsRequest {
    quality: Option<crate::rustdesk::RustDeskQuality>,
    codec: Option<crate::rustdesk::RustDeskCodec>,
    view_only: Option<bool>,
    enable_audio: Option<bool>,
    enable_clipboard: Option<bool>,
    enable_file_transfer: Option<bool>,
}

async fn update_rustdesk_settings_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(settings): Json<UpdateSettingsRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut rustdesk = services.rustdesk_service.lock().await;
    let update = crate::rustdesk::RustDeskSessionUpdate {
        quality: settings.quality,
        codec: settings.codec,
        view_only: settings.view_only,
        enable_audio: settings.enable_audio,
        enable_clipboard: settings.enable_clipboard,
        enable_file_transfer: settings.enable_file_transfer,
    };
    match rustdesk.update_session_settings(&session_id, update) {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "updated"
        }))),
        Err(e) => {
            eprintln!("Failed to update RustDesk settings: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Deserialize)]
struct SendInputRequest {
    input_type: crate::rustdesk::RustDeskInputType,
    data: serde_json::Value,
}

async fn send_rustdesk_input_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(input): Json<SendInputRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rustdesk = services.rustdesk_service.lock().await;
    let event = crate::rustdesk::RustDeskInputEvent {
        input_type: input.input_type,
        data: input.data,
    };
    match rustdesk.send_input(&session_id, event).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "sent"
        }))),
        Err(e) => {
            eprintln!("Failed to send RustDesk input: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_rustdesk_screenshot_api(
    State(_services): State<Arc<ApiService>>,
    Path(_session_id): Path<String>,
) -> Result<Vec<u8>, StatusCode> {
    // Screenshot capture requires native protocol integration (not available via CLI)
    Err(StatusCode::NOT_IMPLEMENTED)
}

async fn rustdesk_status_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut rustdesk = services.rustdesk_service.lock().await;
    let available = rustdesk.is_available();
    let version = if available {
        rustdesk.detect_version().await.ok()
    } else {
        None
    };

    Ok(Json(serde_json::json!({
        "available": available,
        "version": version
    })))
}

// WMI API handlers
async fn connect_wmi_api(
    State(services): State<Arc<ApiService>>,
    Json(config): Json<crate::wmi::WmiConnectionConfig>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut wmi = services.wmi_service.lock().await;
    match wmi.connect_wmi(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id,
            "status": "connected"
        }))),
        Err(e) => {
            eprintln!("Failed to connect WMI: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_wmi_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut wmi = services.wmi_service.lock().await;
    match wmi.disconnect_wmi(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect WMI: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_wmi_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let wmi = services.wmi_service.lock().await;
    Ok(Json(serde_json::json!({
        "sessions": wmi.list_wmi_sessions().await
    })))
}

async fn get_wmi_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let wmi = services.wmi_service.lock().await;
    match wmi.get_wmi_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[derive(Deserialize)]
struct WmiQueryRequest {
    query: String,
}

async fn execute_wmi_query_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(req): Json<WmiQueryRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let wmi = services.wmi_service.lock().await;
    match wmi.execute_wmi_query(&session_id, req.query).await {
        Ok(result) => Ok(Json(serde_json::json!(result))),
        Err(e) => {
            eprintln!("Failed to execute WMI query: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_wmi_classes_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let wmi = services.wmi_service.lock().await;
    let namespace = params.get("namespace");
    match wmi.get_wmi_classes(&session_id, namespace.cloned()).await {
        Ok(classes) => Ok(Json(serde_json::json!({
            "classes": classes
        }))),
        Err(e) => {
            eprintln!("Failed to get WMI classes: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_wmi_namespaces_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let wmi = services.wmi_service.lock().await;
    match wmi.get_wmi_namespaces(&session_id).await {
        Ok(namespaces) => Ok(Json(serde_json::json!({
            "namespaces": namespaces
        }))),
        Err(e) => {
            eprintln!("Failed to get WMI namespaces: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// RPC API handlers
async fn connect_rpc_api(
    State(services): State<Arc<ApiService>>,
    Json(config): Json<crate::rpc::RpcConnectionConfig>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut rpc = services.rpc_service.lock().await;
    match rpc.connect_rpc(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id,
            "status": "connected"
        }))),
        Err(e) => {
            eprintln!("Failed to connect RPC: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_rpc_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut rpc = services.rpc_service.lock().await;
    match rpc.disconnect_rpc(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect RPC: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_rpc_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rpc = services.rpc_service.lock().await;
    Ok(Json(serde_json::json!({
        "sessions": rpc.list_rpc_sessions().await
    })))
}

async fn get_rpc_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rpc = services.rpc_service.lock().await;
    match rpc.get_rpc_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn call_rpc_method_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(request): Json<crate::rpc::RpcRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rpc = services.rpc_service.lock().await;
    match rpc.call_rpc_method(&session_id, request).await {
        Ok(response) => Ok(Json(serde_json::json!(response))),
        Err(e) => {
            eprintln!("Failed to call RPC method: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn discover_rpc_methods_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rpc = services.rpc_service.lock().await;
    match rpc.discover_rpc_methods(&session_id).await {
        Ok(methods) => Ok(Json(serde_json::json!({
            "methods": methods
        }))),
        Err(e) => {
            eprintln!("Failed to discover RPC methods: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn batch_rpc_calls_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(requests): Json<Vec<crate::rpc::RpcRequest>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rpc = services.rpc_service.lock().await;
    match rpc.batch_rpc_calls(&session_id, requests).await {
        Ok(responses) => Ok(Json(serde_json::json!({
            "responses": responses
        }))),
        Err(e) => {
            eprintln!("Failed to batch RPC calls: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// MeshCentral API handlers
async fn connect_meshcentral_api(
    State(services): State<Arc<ApiService>>,
    Json(config): Json<crate::meshcentral::MeshCentralConnectionConfig>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.connect_meshcentral(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id,
            "status": "connected"
        }))),
        Err(e) => {
            eprintln!("Failed to connect MeshCentral: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_meshcentral_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.disconnect_meshcentral(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect MeshCentral: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_meshcentral_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    Ok(Json(serde_json::json!({
        "sessions": meshcentral.list_meshcentral_sessions().await
    })))
}

async fn get_meshcentral_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.get_meshcentral_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn get_meshcentral_devices_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.get_meshcentral_devices(&session_id).await {
        Ok(devices) => Ok(Json(serde_json::json!({
            "devices": devices
        }))),
        Err(e) => {
            eprintln!("Failed to get MeshCentral devices: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_meshcentral_groups_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.get_meshcentral_groups(&session_id).await {
        Ok(groups) => Ok(Json(serde_json::json!({
            "groups": groups
        }))),
        Err(e) => {
            eprintln!("Failed to get MeshCentral groups: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn execute_meshcentral_command_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(command): Json<crate::meshcentral::MeshCentralCommand>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    match meshcentral
        .execute_meshcentral_command(&session_id, command)
        .await
    {
        Ok(command_id) => Ok(Json(serde_json::json!({
            "command_id": command_id
        }))),
        Err(e) => {
            eprintln!("Failed to execute MeshCentral command: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_meshcentral_command_result_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, command_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    match meshcentral
        .get_meshcentral_command_result(&session_id, &command_id)
        .await
    {
        Ok(result) => Ok(Json(serde_json::json!(result))),
        Err(e) => {
            eprintln!("Failed to get MeshCentral command result: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_meshcentral_server_info_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.get_meshcentral_server_info(&session_id).await {
        Ok(info) => Ok(Json(serde_json::json!(info))),
        Err(e) => {
            eprintln!("Failed to get MeshCentral server info: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Agent API handlers
async fn connect_agent_api(
    State(services): State<Arc<ApiService>>,
    Json(config): Json<crate::agent::AgentConnectionConfig>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut agent = services.agent_service.lock().await;
    match agent.connect_agent(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id,
            "status": "connected"
        }))),
        Err(e) => {
            eprintln!("Failed to connect agent: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_agent_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut agent = services.agent_service.lock().await;
    match agent.disconnect_agent(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect agent: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_agent_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    Ok(Json(serde_json::json!({
        "sessions": agent.list_agent_sessions().await
    })))
}

async fn get_agent_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    match agent.get_agent_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn get_agent_metrics_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    match agent.get_agent_metrics(&session_id).await {
        Ok(metrics) => Ok(Json(serde_json::json!(metrics))),
        Err(e) => {
            eprintln!("Failed to get agent metrics: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_agent_logs_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    let limit = params
        .get("limit")
        .and_then(|s| s.parse().ok())
        .unwrap_or(100);
    match agent.get_agent_logs(&session_id, Some(limit)).await {
        Ok(logs) => Ok(Json(serde_json::json!({
            "logs": logs
        }))),
        Err(e) => {
            eprintln!("Failed to get agent logs: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn execute_agent_command_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(command): Json<crate::agent::AgentCommand>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    match agent.execute_agent_command(&session_id, command).await {
        Ok(command_id) => Ok(Json(serde_json::json!({
            "command_id": command_id
        }))),
        Err(e) => {
            eprintln!("Failed to execute agent command: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_agent_command_result_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, command_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    match agent
        .get_agent_command_result(&session_id, &command_id)
        .await
    {
        Ok(result) => Ok(Json(serde_json::json!(result))),
        Err(e) => {
            eprintln!("Failed to get agent command result: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn update_agent_status_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(status): Json<crate::agent::AgentStatus>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut agent = services.agent_service.lock().await;
    match agent.update_agent_status(&session_id, status).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "updated"
        }))),
        Err(e) => {
            eprintln!("Failed to update agent status: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_agent_info_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    match agent.get_agent_info(&session_id).await {
        Ok(info) => Ok(Json(info)),
        Err(e) => {
            eprintln!("Failed to get agent info: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Commander API handlers
async fn connect_commander_api(
    State(services): State<Arc<ApiService>>,
    Json(config): Json<crate::commander::CommanderConnectionConfig>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut commander = services.commander_service.lock().await;
    match commander.connect_commander(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id,
            "status": "connected"
        }))),
        Err(e) => {
            eprintln!("Failed to connect commander: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_commander_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut commander = services.commander_service.lock().await;
    match commander.disconnect_commander(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect commander: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_commander_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    Ok(Json(serde_json::json!({
        "sessions": commander.list_commander_sessions().await
    })))
}

async fn get_commander_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    match commander.get_commander_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn execute_commander_command_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(command): Json<crate::commander::CommanderCommand>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    match commander
        .execute_commander_command(&session_id, command)
        .await
    {
        Ok(command_id) => Ok(Json(serde_json::json!({
            "command_id": command_id
        }))),
        Err(e) => {
            eprintln!("Failed to execute commander command: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_commander_command_result_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, command_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    match commander
        .get_commander_command_result(&session_id, &command_id)
        .await
    {
        Ok(result) => Ok(Json(serde_json::json!(result))),
        Err(e) => {
            eprintln!("Failed to get commander command result: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn upload_commander_file_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    let local_path = params
        .get("local_path")
        .and_then(|v| v.as_str())
        .ok_or(StatusCode::BAD_REQUEST)?;
    let remote_path = params
        .get("remote_path")
        .and_then(|v| v.as_str())
        .ok_or(StatusCode::BAD_REQUEST)?;

    match commander
        .upload_commander_file(&session_id, local_path.to_string(), remote_path.to_string())
        .await
    {
        Ok(transfer_id) => Ok(Json(serde_json::json!({
            "transfer_id": transfer_id
        }))),
        Err(e) => {
            eprintln!("Failed to upload commander file: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn download_commander_file_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    let remote_path = params
        .get("remote_path")
        .and_then(|v| v.as_str())
        .ok_or(StatusCode::BAD_REQUEST)?;
    let local_path = params
        .get("local_path")
        .and_then(|v| v.as_str())
        .ok_or(StatusCode::BAD_REQUEST)?;

    match commander
        .download_commander_file(&session_id, remote_path.to_string(), local_path.to_string())
        .await
    {
        Ok(transfer_id) => Ok(Json(serde_json::json!({
            "transfer_id": transfer_id
        }))),
        Err(e) => {
            eprintln!("Failed to download commander file: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_commander_file_transfer_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, transfer_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    match commander
        .get_commander_file_transfer(&session_id, &transfer_id)
        .await
    {
        Ok(transfer) => Ok(Json(serde_json::json!(transfer))),
        Err(e) => {
            eprintln!("Failed to get commander file transfer: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_commander_directory_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    let path = params.get("path").unwrap_or(&".".to_string()).clone();
    match commander.list_commander_directory(&session_id, path).await {
        Ok(files) => Ok(Json(serde_json::json!({
            "files": files
        }))),
        Err(e) => {
            eprintln!("Failed to list commander directory: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn update_commander_status_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(status): Json<crate::commander::CommanderStatus>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut commander = services.commander_service.lock().await;
    match commander.update_commander_status(&session_id, status).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "updated"
        }))),
        Err(e) => {
            eprintln!("Failed to update commander status: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_commander_system_info_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    match commander.get_commander_system_info(&session_id).await {
        Ok(info) => Ok(Json(info)),
        Err(e) => {
            eprintln!("Failed to get commander system info: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// AWS API handlers
async fn connect_aws_api(
    State(services): State<Arc<ApiService>>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut aws = services.aws_service.lock().await;
    // Parse the JSON params into AwsConnectionConfig
    let config: AwsConnectionConfig = match serde_json::from_value(params) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to parse AWS connection config: {}", e);
            return Err(StatusCode::BAD_REQUEST);
        }
    };
    match aws.connect_aws(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id
        }))),
        Err(e) => {
            eprintln!("Failed to connect to AWS: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_aws_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut aws = services.aws_service.lock().await;
    match aws.disconnect_aws(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect from AWS: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_aws_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    let sessions = aws.list_aws_sessions().await;
    Ok(Json(serde_json::json!(sessions)))
}

async fn get_aws_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.get_aws_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn list_ec2_instances_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_ec2_instances(&session_id).await {
        Ok(instances) => Ok(Json(serde_json::json!(instances))),
        Err(e) => {
            eprintln!("Failed to list EC2 instances: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_ec2_instance_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, instance_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_ec2_instances(&session_id).await {
        Ok(instances) => match instances.into_iter().find(|i| i.instance_id == instance_id) {
            Some(instance) => Ok(Json(serde_json::json!(instance))),
            None => Err(StatusCode::NOT_FOUND),
        },
        Err(e) => {
            eprintln!("Failed to get EC2 instance: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn execute_ec2_action_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, instance_id)): Path<(String, String)>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    let action = params
        .get("action")
        .and_then(|a| a.as_str())
        .unwrap_or("start");
    match aws
        .execute_ec2_action(&session_id, &instance_id, action)
        .await
    {
        Ok(result) => Ok(Json(serde_json::json!(result))),
        Err(e) => {
            eprintln!("Failed to execute EC2 action: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_s3_buckets_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_s3_buckets(&session_id).await {
        Ok(buckets) => Ok(Json(serde_json::json!(buckets))),
        Err(e) => {
            eprintln!("Failed to list S3 buckets: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_s3_bucket_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, bucket_name)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_s3_buckets(&session_id).await {
        Ok(buckets) => match buckets.into_iter().find(|b| b.name == bucket_name) {
            Some(bucket) => Ok(Json(serde_json::json!(bucket))),
            None => Err(StatusCode::NOT_FOUND),
        },
        Err(e) => {
            eprintln!("Failed to get S3 bucket: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_s3_objects_api(
    State(_services): State<Arc<ApiService>>,
    Path((_session_id, _bucket_name)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // This method doesn't exist, return empty array for now
    Ok(Json(serde_json::json!([])))
}

async fn get_s3_object_api(
    State(_services): State<Arc<ApiService>>,
    Path((_session_id, _bucket_name, _key)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // This method doesn't exist, return not found
    Err(StatusCode::NOT_FOUND)
}

async fn list_rds_instances_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_rds_instances(&session_id).await {
        Ok(instances) => Ok(Json(serde_json::json!(instances))),
        Err(e) => {
            eprintln!("Failed to list RDS instances: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_rds_instance_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, instance_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_rds_instances(&session_id).await {
        Ok(instances) => {
            match instances
                .into_iter()
                .find(|i| i.db_instance_identifier == instance_id)
            {
                Some(instance) => Ok(Json(serde_json::json!(instance))),
                None => Err(StatusCode::NOT_FOUND),
            }
        }
        Err(e) => {
            eprintln!("Failed to get RDS instance: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_lambda_functions_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_lambda_functions(&session_id).await {
        Ok(functions) => Ok(Json(serde_json::json!(functions))),
        Err(e) => {
            eprintln!("Failed to list Lambda functions: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_lambda_function_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, function_name)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_lambda_functions(&session_id).await {
        Ok(functions) => {
            match functions
                .into_iter()
                .find(|f| f.function_name == function_name)
            {
                Some(function) => Ok(Json(serde_json::json!(function))),
                None => Err(StatusCode::NOT_FOUND),
            }
        }
        Err(e) => {
            eprintln!("Failed to get Lambda function: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_cloudwatch_metrics_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    let namespace = params
        .get("namespace")
        .unwrap_or(&"AWS/EC2".to_string())
        .clone();
    let metric_name = params
        .get("metric_name")
        .unwrap_or(&"CPUUtilization".to_string())
        .clone();
    match aws
        .get_cloudwatch_metrics(&session_id, &namespace, &metric_name)
        .await
    {
        Ok(metrics) => Ok(Json(serde_json::json!(metrics))),
        Err(e) => {
            eprintln!("Failed to get CloudWatch metrics: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Vercel API handlers
async fn connect_vercel_api(
    State(services): State<Arc<ApiService>>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut vercel = services.vercel_service.lock().await;
    let config: VercelConnectionConfig = match serde_json::from_value(params) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to parse Vercel connection config: {}", e);
            return Err(StatusCode::BAD_REQUEST);
        }
    };
    match vercel.connect_vercel(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id
        }))),
        Err(e) => {
            eprintln!("Failed to connect to Vercel: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_vercel_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut vercel = services.vercel_service.lock().await;
    match vercel.disconnect_vercel(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect from Vercel: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_vercel_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    let sessions = vercel.list_vercel_sessions().await;
    Ok(Json(serde_json::json!(sessions)))
}

async fn get_vercel_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.get_vercel_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn list_vercel_projects_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_projects(&session_id).await {
        Ok(projects) => Ok(Json(serde_json::json!(projects))),
        Err(e) => {
            eprintln!("Failed to list Vercel projects: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_vercel_project_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, project_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_projects(&session_id).await {
        Ok(projects) => match projects.into_iter().find(|p| p.id == project_id) {
            Some(project) => Ok(Json(serde_json::json!(project))),
            None => Err(StatusCode::NOT_FOUND),
        },
        Err(e) => {
            eprintln!("Failed to get Vercel project: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_vercel_deployments_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, project_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel
        .list_vercel_deployments(&session_id, Some(project_id))
        .await
    {
        Ok(deployments) => Ok(Json(serde_json::json!(deployments))),
        Err(e) => {
            eprintln!("Failed to list Vercel deployments: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_vercel_deployment_api(
    State(_services): State<Arc<ApiService>>,
    Path((_session_id, _deployment_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // This method doesn't exist, return not found
    Err(StatusCode::NOT_FOUND)
}

async fn list_vercel_domains_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_domains(&session_id).await {
        Ok(domains) => Ok(Json(serde_json::json!(domains))),
        Err(e) => {
            eprintln!("Failed to list Vercel domains: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_vercel_domain_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, domain_name)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_domains(&session_id).await {
        Ok(domains) => match domains.into_iter().find(|d| d.name == domain_name) {
            Some(domain) => Ok(Json(serde_json::json!(domain))),
            None => Err(StatusCode::NOT_FOUND),
        },
        Err(e) => {
            eprintln!("Failed to get Vercel domain: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_vercel_teams_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_teams(&session_id).await {
        Ok(teams) => Ok(Json(serde_json::json!(teams))),
        Err(e) => {
            eprintln!("Failed to list Vercel teams: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_vercel_team_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, team_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_teams(&session_id).await {
        Ok(teams) => match teams.into_iter().find(|t| t.id == team_id) {
            Some(team) => Ok(Json(serde_json::json!(team))),
            None => Err(StatusCode::NOT_FOUND),
        },
        Err(e) => {
            eprintln!("Failed to get Vercel team: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Cloudflare API handlers
async fn connect_cloudflare_api(
    State(services): State<Arc<ApiService>>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut cloudflare = services.cloudflare_service.lock().await;
    let config: CloudflareConnectionConfig = match serde_json::from_value(params) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to parse Cloudflare connection config: {}", e);
            return Err(StatusCode::BAD_REQUEST);
        }
    };
    match cloudflare.connect_cloudflare(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id
        }))),
        Err(e) => {
            eprintln!("Failed to connect to Cloudflare: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_cloudflare_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut cloudflare = services.cloudflare_service.lock().await;
    match cloudflare.disconnect_cloudflare(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect from Cloudflare: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_cloudflare_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    let sessions = cloudflare.list_cloudflare_sessions().await;
    Ok(Json(serde_json::json!(sessions)))
}

async fn get_cloudflare_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare.get_cloudflare_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn list_cloudflare_zones_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare.list_cloudflare_zones(&session_id).await {
        Ok(zones) => Ok(Json(serde_json::json!(zones))),
        Err(e) => {
            eprintln!("Failed to list Cloudflare zones: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_cloudflare_zone_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, zone_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare.list_cloudflare_zones(&session_id).await {
        Ok(zones) => match zones.into_iter().find(|z| z.id == zone_id) {
            Some(zone) => Ok(Json(serde_json::json!(zone))),
            None => Err(StatusCode::NOT_FOUND),
        },
        Err(e) => {
            eprintln!("Failed to get Cloudflare zone: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_cloudflare_dns_records_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, zone_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare
        .list_cloudflare_dns_records(&session_id, &zone_id)
        .await
    {
        Ok(records) => Ok(Json(serde_json::json!(records))),
        Err(e) => {
            eprintln!("Failed to list Cloudflare DNS records: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_cloudflare_dns_record_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, zone_id, record_id)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare
        .list_cloudflare_dns_records(&session_id, &zone_id)
        .await
    {
        Ok(records) => match records.into_iter().find(|r| r.id == record_id) {
            Some(record) => Ok(Json(serde_json::json!(record))),
            None => Err(StatusCode::NOT_FOUND),
        },
        Err(e) => {
            eprintln!("Failed to get Cloudflare DNS record: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_cloudflare_workers_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    let account_id = params
        .get("account_id")
        .unwrap_or(&"default".to_string())
        .clone();
    match cloudflare
        .list_cloudflare_workers(&session_id, &account_id)
        .await
    {
        Ok(workers) => Ok(Json(serde_json::json!(workers))),
        Err(e) => {
            eprintln!("Failed to list Cloudflare workers: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_cloudflare_worker_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, worker_id)): Path<(String, String)>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    let account_id = params
        .get("account_id")
        .unwrap_or(&"default".to_string())
        .clone();
    match cloudflare
        .list_cloudflare_workers(&session_id, &account_id)
        .await
    {
        Ok(workers) => match workers.into_iter().find(|w| w.id == worker_id) {
            Some(worker) => Ok(Json(serde_json::json!(worker))),
            None => Err(StatusCode::NOT_FOUND),
        },
        Err(e) => {
            eprintln!("Failed to get Cloudflare worker: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_cloudflare_page_rules_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, zone_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare
        .list_cloudflare_page_rules(&session_id, &zone_id)
        .await
    {
        Ok(rules) => Ok(Json(serde_json::json!(rules))),
        Err(e) => {
            eprintln!("Failed to list Cloudflare page rules: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_cloudflare_page_rule_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, zone_id, rule_id)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare
        .list_cloudflare_page_rules(&session_id, &zone_id)
        .await
    {
        Ok(rules) => match rules.into_iter().find(|r| r.id == rule_id) {
            Some(rule) => Ok(Json(serde_json::json!(rule))),
            None => Err(StatusCode::NOT_FOUND),
        },
        Err(e) => {
            eprintln!("Failed to get Cloudflare page rule: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_cloudflare_analytics_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, zone_id)): Path<(String, String)>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    let since = params.get("since").cloned();
    let until = params.get("until").cloned();
    match cloudflare
        .get_cloudflare_analytics(&session_id, &zone_id, since, until)
        .await
    {
        Ok(analytics) => Ok(Json(serde_json::json!(analytics))),
        Err(e) => {
            eprintln!("Failed to get Cloudflare analytics: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[cfg(test)]
mod middleware_tests {
    //! Unit tests for the security-critical decision logic that lives in
    //! `api.rs`: the auth gate (`decide_auth`), the hand-rolled rate limiter,
    //! constant-time key compare, and the mutating-method classifier. These
    //! deliberately avoid constructing an `ApiService` (which needs every
    //! backend service) — full HTTP end-to-end coverage is the integration
    //! suite's job (t41-e8).

    use super::*;
    use serde_json::json;
    use std::path::Path;

    // 32-byte (256-bit) secret — the HS256 minimum enforced by sorng-auth.
    const SECRET: &str = "0123456789abcdef0123456789abcdef";
    const KEY: &str = "test-api-key-abcdef0123456789";

    /// Resolve a config with known api key + jwt secret (env empty).
    fn cfg(auth_required: bool, rate: u32) -> ApiRuntimeConfig {
        let settings = json!({
            "restApi": {
                "authentication": auth_required,
                "apiKey": KEY,
                "jwtSecret": SECRET,
                "rateLimiting": rate > 0,
                "maxRequestsPerMinute": rate,
            }
        });
        ApiRuntimeConfig::resolve_with_env(&settings, Path::new("/tmp"), |_| None)
    }

    fn header_map(name: &'static str, value: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(name, value.parse().unwrap());
        h
    }

    #[test]
    fn is_mutating_classifies_methods() {
        assert!(!is_mutating(&Method::GET));
        assert!(!is_mutating(&Method::HEAD));
        assert!(!is_mutating(&Method::OPTIONS));
        assert!(is_mutating(&Method::POST));
        assert!(is_mutating(&Method::PUT));
        assert!(is_mutating(&Method::DELETE));
        assert!(is_mutating(&Method::PATCH));
    }

    #[test]
    fn constant_time_eq_matches_only_equal_bytes() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"", b"x"));
    }

    #[tokio::test]
    async fn missing_credential_is_unauthorized() {
        let c = cfg(true, 0);
        let bs = BearerAuthService::new();
        let bearer = bs.lock().await;
        let h = HeaderMap::new();
        assert!(matches!(
            decide_auth(&c, &bearer, "/ssh/connect", &Method::POST, &h),
            AuthDecision::Unauthorized
        ));
    }

    #[tokio::test]
    async fn wrong_api_key_is_unauthorized() {
        let c = cfg(true, 0);
        let bs = BearerAuthService::new();
        let bearer = bs.lock().await;
        let h = header_map("x-api-key", "not-the-key");
        assert!(matches!(
            decide_auth(&c, &bearer, "/ssh/sessions", &Method::GET, &h),
            AuthDecision::Unauthorized
        ));
    }

    #[tokio::test]
    async fn valid_api_key_allows() {
        let c = cfg(true, 0);
        let bs = BearerAuthService::new();
        let bearer = bs.lock().await;
        let h = header_map("x-api-key", KEY);
        assert!(matches!(
            decide_auth(&c, &bearer, "/ssh/connect", &Method::POST, &h),
            AuthDecision::Allow(_)
        ));
    }

    #[tokio::test]
    async fn health_and_login_are_exempt() {
        let c = cfg(true, 0);
        let bs = BearerAuthService::new();
        let bearer = bs.lock().await;
        let h = HeaderMap::new();
        assert!(matches!(
            decide_auth(&c, &bearer, "/health", &Method::GET, &h),
            AuthDecision::Allow(_)
        ));
        assert!(matches!(
            decide_auth(&c, &bearer, "/auth/login", &Method::POST, &h),
            AuthDecision::Allow(_)
        ));
    }

    #[tokio::test]
    async fn no_auth_required_passes_everything() {
        let c = cfg(false, 0);
        let bs = BearerAuthService::new();
        let bearer = bs.lock().await;
        let h = HeaderMap::new();
        assert!(matches!(
            decide_auth(&c, &bearer, "/ssh/connect", &Method::POST, &h),
            AuthDecision::Allow(_)
        ));
    }

    #[tokio::test]
    async fn bearer_admin_token_accepted() {
        let c = cfg(true, 0);
        let bs = BearerAuthService::new();
        let bearer = bs.lock().await;
        let issued = bearer
            .issue_session_token(SECRET.as_bytes(), "root", Role::Admin, 600)
            .unwrap();
        let h = header_map("authorization", &format!("Bearer {}", issued.token));
        assert!(matches!(
            decide_auth(&c, &bearer, "/ssh/connect", &Method::POST, &h),
            AuthDecision::Allow(_)
        ));
    }

    #[tokio::test]
    async fn readonly_token_rejected_on_mutation_allowed_on_read() {
        let c = cfg(true, 0);
        let bs = BearerAuthService::new();
        let bearer = bs.lock().await;
        let issued = bearer
            .issue_session_token(SECRET.as_bytes(), "guest", Role::Readonly, 600)
            .unwrap();
        let h = header_map("authorization", &format!("Bearer {}", issued.token));
        // Mutating method → 403 readonly.
        assert!(matches!(
            decide_auth(&c, &bearer, "/ssh/connect", &Method::POST, &h),
            AuthDecision::ForbiddenReadonly
        ));
        // Safe method → allowed.
        assert!(matches!(
            decide_auth(&c, &bearer, "/ssh/sessions", &Method::GET, &h),
            AuthDecision::Allow(_)
        ));
    }

    #[tokio::test]
    async fn revoked_token_rejected_by_gate() {
        // Exercises the /auth/logout revoke path through the same shared
        // BearerAuthService the gate verifies against.
        let c = cfg(true, 0);
        let bs = BearerAuthService::new();
        let issued = {
            let bearer = bs.lock().await;
            bearer
                .issue_session_token(SECRET.as_bytes(), "u", Role::Admin, 600)
                .unwrap()
        };
        {
            let mut bearer = bs.lock().await;
            bearer.revoke_session_token(&issued.token);
        }
        let bearer = bs.lock().await;
        let h = header_map("authorization", &format!("Bearer {}", issued.token));
        assert!(matches!(
            decide_auth(&c, &bearer, "/ssh/sessions", &Method::GET, &h),
            AuthDecision::Unauthorized
        ));
    }

    #[test]
    fn rate_limiter_enforces_within_window() {
        let rl = RateLimiter::new(2);
        assert!(rl.check("caller-a"));
        assert!(rl.check("caller-a"));
        assert!(!rl.check("caller-a"), "third request in-window must be denied");
        // A different key has an independent budget.
        assert!(rl.check("caller-b"));
    }

    #[test]
    fn rate_limiter_zero_is_unlimited() {
        let rl = RateLimiter::new(0);
        for _ in 0..1000 {
            assert!(rl.check("caller"));
        }
    }
}
