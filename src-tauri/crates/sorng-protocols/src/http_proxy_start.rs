//! Shared production startup for the desktop command and native WebView hosts.
//! Command-only support is public because the desktop includes its command shim
//! from another crate; normal callers should use `http::start_proxy_session`.
use super::*;

// Keep the transport policy inputs explicit at each call site. Grouping them
// would hide security-sensitive TLS, CA, proxy, and cookie choices behind a
// partially initialized options object.
#[allow(clippy::too_many_arguments)]
pub fn proxy_client_builder_with_cookies(
    transport_settings: &ProxyTransportSettings,
    verify_ssl: bool,
    accepted_cert_fingerprint: Option<&str>,
    min_tls: &str,
    upstream_proxy_url: Option<&str>,
    require_ca_verification: bool,
    ca_target_host: Option<&str>,
    cookies: Option<Arc<crate::http::attempt::AttemptCookieStore>>,
    retain_cookies: bool,
) -> Result<reqwest::Client, String> {
    let mut builder = transport_settings
        .apply_to_client_builder(reqwest::Client::builder())?
        // Route ownership is explicit. Ambient process proxy variables must
        // not disagree with certificate inspection's selected direct route.
        .no_proxy()
        // Response editing owns bounded decoding. Keep opaque byte/header
        // behavior stable even if another crate enables reqwest codecs.
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        // The request mediator validates every redirect BEFORE resending.
        .redirect(reqwest::redirect::Policy::none())
        .min_tls_version(resolve_min_tls_version(min_tls));

    if let Some(cookies) = cookies {
        builder = builder.cookie_provider(cookies);
    } else if retain_cookies {
        builder = builder.cookie_store(true);
    }

    if let Some(proxy_url) = upstream_proxy_url {
        builder = builder.proxy(validate_upstream_proxy(proxy_url)?);
    }

    if require_ca_verification {
        let fingerprint = accepted_cert_fingerprint
            .ok_or("CA-verified HTTPS admission requires the inspected certificate fingerprint")?;
        builder = builder.use_preconfigured_tls(build_ca_pinned_tls_config(
            fingerprint.into(),
            min_tls,
            ca_target_host
                .ok_or("CA-verified admission requires the inspected target authority")?,
            upstream_proxy_url,
        )?);
    } else if let Some(fingerprint) = accepted_cert_fingerprint {
        // Some(pin) is an explicit identity requirement, never an invitation
        // to fall back to unverified TLS when the supplied pin is malformed.
        builder = builder.use_preconfigured_tls(build_pinned_tls_config_with_min_version(
            fingerprint.into(),
            min_tls,
        )?);
    } else {
        builder = builder.danger_accept_invalid_certs(!verify_ssl);
    }

    builder
        .build()
        .map_err(|_| "Failed to create proxy HTTP client".to_string())
}

pub fn validate_upstream_proxy(proxy_url: &str) -> Result<reqwest::Proxy, String> {
    if proxy_url.is_empty() || proxy_url.trim() != proxy_url {
        return Err("Upstream proxy URL cannot be empty or padded with whitespace".into());
    }
    let parsed = reqwest::Url::parse(proxy_url)
        .map_err(|_| "Upstream proxy URL is not a valid URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Upstream proxy URL must use http or https".into());
    }
    if parsed.host_str().is_none()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Upstream proxy URL must contain only a proxy authority".into());
    }
    if parsed.port() == Some(0) {
        return Err("Upstream proxy URL contains an invalid port".into());
    }
    reqwest::Proxy::all(parsed.as_str())
        .map_err(|_| "Upstream proxy URL could not be configured".to_string())
}

pub fn validate_proxy_target_url(target_url: &str) -> Result<reqwest::Url, String> {
    if target_url.is_empty()
        || target_url.trim() != target_url
        || target_url
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Proxy target URL cannot contain whitespace or control characters".into());
    }
    if target_url.contains('%') || target_url.contains('\\') {
        return Err("Proxy target URL contains an ambiguous encoded authority".into());
    }

    let parsed =
        reqwest::Url::parse(target_url).map_err(|_| "Proxy target URL is invalid".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Proxy target URL must use http or https".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Proxy target URL cannot contain user information".into());
    }
    if parsed.host_str().is_none() {
        return Err("Proxy target URL must contain a hostname".into());
    }
    if parsed.path() != "/" || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Proxy target URL must contain only a canonical authority".into());
    }
    if parsed.port() == Some(0) {
        return Err("Proxy target URL contains an invalid port".into());
    }

    let canonical = format!("{}/", parsed.origin().ascii_serialization());
    reqwest::Url::parse(&canonical)
        .map_err(|_| "Proxy target URL could not be canonicalized".to_string())
}

pub fn validate_proxy_start_target(
    target_url: &str,
    continuing: bool,
) -> Result<reqwest::Url, String> {
    if !continuing {
        return validate_proxy_target_url(target_url);
    }
    let error = || "The QuickConnect continuation entry URL is invalid".to_string();
    if target_url.len() > 4096 {
        return Err(error());
    }
    let parsed = reqwest::Url::parse(target_url).map_err(|_| error())?;
    if parsed.as_str() != target_url || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(error());
    }
    let authority = target_url
        .split_once("://")
        .ok_or_else(error)?
        .1
        .split('/')
        .next()
        .ok_or_else(error)?;
    let root = validate_proxy_target_url(&format!("{}://{authority}/", parsed.scheme()))?;
    if root.origin() != parsed.origin() {
        return Err(error());
    }
    // The full path is matched against the native one-use receipt before
    // allocation. The forwarding base is independently the origin root.
    Ok(parsed)
}

pub struct ProtectedProxyEndpoint {
    pub authority: String,
    pub origin: String,
    pub url: String,
}

pub fn protected_proxy_endpoint(local_port: u16) -> ProtectedProxyEndpoint {
    // UUID v4 is sourced from the OS CSPRNG. Its 122 random bits form a valid,
    // unguessable DNS label required in Host on every proxy request.
    let token = uuid::Uuid::new_v4().simple().to_string();
    let authority = format!("p{}.localhost:{}", token, local_port);
    let origin = format!("http://{}", authority);
    ProtectedProxyEndpoint {
        url: format!("{}/", origin),
        authority,
        origin,
    }
}

pub fn cancel_owned_continuation(manager: &mut ProxySessionManager, id: &str) {
    if let Some(source_id) = manager.attempts.cancel(id) {
        manager.discard_redirect_review(&source_id);
        if let Some(mut entry) = manager.sessions.remove(&source_id) {
            entry.network.revoke();
            if let Some(shutdown) = entry.shutdown_tx.take() {
                let _ = shutdown.send(());
            }
        }
    }
}

pub struct AttemptStartGuard(pub Option<crate::http::attempt::AttemptSession>);
impl Drop for AttemptStartGuard {
    fn drop(&mut self) {
        if let Some(attempt) = &self.0 {
            attempt.revoke();
        }
    }
}

struct PendingContinuationGuard {
    sessions: ProxySessionManagerState,
    id: Option<String>,
}
impl Drop for PendingContinuationGuard {
    fn drop(&mut self) {
        if let Some(id) = &self.id {
            if let Ok(mut manager) = self.sessions.lock() {
                cancel_owned_continuation(&mut manager, id);
            }
        }
    }
}

/// Start a basic auth proxy mediator.
///
/// Spawns a local TCP server on `127.0.0.1:0` (OS auto-assigns a free port)
/// that proxies all requests to the target URL with basic authentication
/// headers injected according to the selected mode. Load the returned `proxy_url`
/// in the guarded WebView. The native navigation guard must already be installed.
///
/// The callback replaces the desktop event emitter for native hosts without a
/// Tauri AppHandle. Its payload may contain credentials; never log or persist it
/// without the user's explicit credential-save action.
pub async fn start_proxy_session(
    mut config: BasicAuthProxyConfig,
    sessions: ProxySessionManagerState,
    credentials_applied: Option<Arc<dyn Fn(serde_json::Value) + Send + Sync>>,
) -> Result<ProxyMediatorResponse, String> {
    // Reject malformed budgets before even creating cleanup guards: their
    // Drop implementations can consume continuation state.
    config.transport_settings.validate()?;
    let _pending_continuation = PendingContinuationGuard {
        sessions: sessions.clone(),
        id: config.continuation_id.clone(),
    };
    crate::http::webview_origins::require_frame_guard_ready()?;
    let validated_target =
        validate_proxy_start_target(&config.target_url, config.continuation_id.is_some())?;
    if config.require_ca_verification && validated_target.scheme() != "https" {
        return Err("CA verification admission is only supported for HTTPS targets".into());
    }
    let proxy_policy = config.proxy_policy.clone().unwrap_or_default();
    if let Some(palette) = &config.website_dark_mode {
        palette.validate()?;
    }
    validate_reviewed_login_config(&config)?;
    proxy_policy.validate(&validated_target)?;
    if let Some(options) = &config.http_form_automation {
        options.validate()?;
    }
    validate_custom_headers(
        &config.custom_headers,
        config.upstream_auth_mode == UpstreamAuthMode::Header,
    )?;
    if config.upstream_auth_mode == crate::http::UpstreamAuthMode::PfSenseV1
        && (config.username.is_empty() || config.password.is_empty())
    {
        return Err("pfSense v1 proxy authentication requires both key and secret".into());
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    let target_origin = validated_target.origin().ascii_serialization();
    // The receipt claims the complete cleaned entry URL; the mediator's base
    // remains the origin root because the iframe supplies the entry path.
    let target_url = if config.continuation_id.is_some() {
        format!("{target_origin}/")
    } else {
        validated_target.as_str().to_string()
    };
    let verify_ssl = config.verify_ssl;
    let accepted_cert_fingerprint = config.accepted_cert_fingerprint.clone();
    let min_tls = config.min_tls_version.clone();
    let connection_id = config.connection_id.clone();
    let upstream_proxy_url = config.upstream_proxy_url.clone();
    let attempt = sessions
        .lock()
        .map_err(|_| "Proxy continuation is unavailable")?
        .attempts
        .start(&config, &validated_target, &session_id)?;
    let mut attempt_guard = AttemptStartGuard(attempt.clone());
    if let Some(attempt) = &attempt {
        attempt.strip_deferred_login_config(&mut config);
    }
    // Native continuation ownership retains the original transport snapshot,
    // including legacy handoffs which omit settings in their IPC config.
    let transport_settings = attempt
        .as_ref()
        .map_or(config.transport_settings, |attempt| {
            *attempt.transport_settings()
        });

    // Each browser tab owns its unique returned session_id. connection_id is
    // metadata, not an eviction key: opening another tab for a saved connection
    // must not kill the first tab's listener and trigger competing restarts.

    // Build an async reqwest client for this session with connection keep-alive
    // and reasonable timeouts to avoid stale-connection errors.
    let client = proxy_client_builder_with_cookies(
        &transport_settings,
        verify_ssl,
        accepted_cert_fingerprint.as_deref(),
        &min_tls,
        upstream_proxy_url.as_deref(),
        config.require_ca_verification,
        validated_target.host_str(),
        attempt.as_ref().map(|attempt| attempt.cookie_store()),
        true,
    )?;
    let tactical_rmm_api = if matches!(
        config.reviewed_application_profile,
        Some(ReviewedApplicationProfile::TacticalRmm | ReviewedApplicationProfile::Ptisp)
    ) {
        // The provider API is a separate, stateless TLS security domain. It
        // inherits only the network proxy and minimum TLS floor, never the
        // dashboard's certificate bypass/pin or either origin's cookies.
        let api_client = proxy_client_builder_with_cookies(
            &transport_settings,
            true,
            None,
            &min_tls,
            upstream_proxy_url.as_deref(),
            false,
            None,
            None,
            false,
        )?;
        crate::http::tactical_rmm::TacticalRmmApiRoute::new(
            config.reviewed_application_profile,
            &validated_target,
            config.reviewed_application_api_origin.as_deref(),
            api_client,
        )
    } else {
        None
    };

    // t96 Route A: sign in to a Yealink phone natively, before the frame loads
    // a single byte, and hold its web session for this arm. Exactly one
    // handshake per session arm — the phone permits one web session and locks
    // an account out after repeated failed sign-ins, so a rejected or locked
    // sign-in is terminal and refuses the connection rather than retrying.
    let yealink_session = crate::http::yealink_login::session_slot();
    match config.upstream_auth_mode {
        UpstreamAuthMode::YealinkServlet => {
            crate::http::yealink_login::pre_authenticate(
                &client,
                &validated_target,
                &config.username,
                &config.password,
                &yealink_session,
            )
            .await?;
        }
        UpstreamAuthMode::Unknown => {
            // A mode this build cannot place. The session still opens, with no
            // Authorization header of any kind — never the default Basic.
            log::warn!(
                "proxy session {session_id} requested an upstream auth mode this build does not \
                 support; continuing without any injected credentials"
            );
        }
        _ => {}
    }

    // Bind to a random free port.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind proxy listener: {}", e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?
        .port();
    let protected_endpoint = protected_proxy_endpoint(local_port);
    let cloudflare_challenge = if matches!(
        config.reviewed_application_profile,
        Some(ReviewedApplicationProfile::Cloudflare | ReviewedApplicationProfile::Porkbun)
    ) {
        crate::http::cloudflare_challenge::CloudflareChallenge::new(
            config.reviewed_application_profile,
            &validated_target,
            &protected_endpoint.origin,
            proxy_client_builder_with_cookies(
                &transport_settings,
                true,
                None,
                &min_tls,
                upstream_proxy_url.as_deref(),
                false,
                None,
                None,
                false,
            )?,
        )?
    } else {
        None
    };
    let tactical_mesh = if config.reviewed_application_mesh_origin.is_some() {
        crate::http::tactical_mesh::TacticalMeshRoute::new(
            config.reviewed_application_profile,
            &validated_target,
            config.reviewed_application_mesh_origin.as_deref(),
            &protected_endpoint.origin,
            proxy_client_builder_with_cookies(
                &transport_settings,
                true,
                None,
                &min_tls,
                upstream_proxy_url.as_deref(),
                false,
                None,
                None,
                false,
            )?,
        )?
    } else {
        None
    };
    let google =
        if crate::http::google::GoogleSession::supports(config.reviewed_application_profile) {
            crate::http::google::GoogleSession::new(
                config.reviewed_application_profile,
                &validated_target,
                &protected_endpoint.origin,
                proxy_client_builder_with_cookies(
                    &transport_settings,
                    verify_ssl,
                    accepted_cert_fingerprint.as_deref(),
                    &min_tls,
                    upstream_proxy_url.as_deref(),
                    config.require_ca_verification,
                    validated_target.host_str(),
                    None,
                    false,
                )?,
                proxy_client_builder_with_cookies(
                    &transport_settings,
                    true,
                    None,
                    &min_tls,
                    upstream_proxy_url.as_deref(),
                    false,
                    None,
                    None,
                    false,
                )?,
            )?
        } else {
            None
        };
    let network = Arc::new(
        ProxyNetworkState::with_origin(&protected_endpoint.origin)?
            .with_browser_compatibility(config.browser_compatibility)
            .with_transport_settings(transport_settings)?
            .with_reviewed_public_routes(
                upstream_proxy_url
                    .as_deref()
                    .map(validate_upstream_proxy)
                    .transpose()?,
                &min_tls,
                &proxy_policy,
            )
            .with_google_routes(google)
            .with_tactical_mesh(tactical_mesh)
            .with_cloudflare_challenge(cloudflare_challenge)
            .with_reviewed_application_profile(config.reviewed_application_profile)
            .with_exchange_cookies(&target_origin)?
            .with_freepbx_cookies(&target_origin)?,
    );
    let google_routes = network.google_routes();

    let request_count = Arc::new(AtomicU64::new(0));
    let error_count = Arc::new(AtomicU64::new(0));
    let last_error: Arc<std::sync::Mutex<Option<String>>> = Arc::new(std::sync::Mutex::new(None));

    // Shared state for the axum handler. P3 wraps credentials in
    // RwLock so the themed-auth POST handler can update them at
    // runtime; the optional callback notifies the host when credentials change.
    // P7: theme tokens are RwLocked too so a follow-up
    // `update_proxy_theme` IPC can refresh them mid-session when
    // the user changes themes.
    let theme_tokens = config
        .theme_tokens
        .as_ref()
        .map(crate::theme_tokens::ThemeTokens::sanitized)
        .unwrap_or_else(crate::theme_tokens::ThemeTokens::dark_default);
    let website_dark_mode = Arc::new(std::sync::RwLock::new(config.website_dark_mode.clone()));
    let proxy_state = Arc::new(AxumProxyState {
        attempt: attempt.clone(),
        network: network.clone(),
        website_dark_mode: website_dark_mode.clone(),
        session_id: session_id.clone(),
        connection_id: connection_id.clone(),
        target_url: target_url.clone(),
        username: Arc::new(std::sync::RwLock::new(config.username.clone())),
        password: Arc::new(std::sync::RwLock::new(config.password.clone())),
        upstream_auth_mode: config.upstream_auth_mode,
        proxy_policy: proxy_policy.clone(),
        redirect_profile: config.redirect_profile,
        tactical_rmm_api,
        custom_headers: config.custom_headers.clone(),
        pending_nonce: Arc::new(std::sync::RwLock::new(None)),
        theme: Arc::new(std::sync::RwLock::new(theme_tokens)),
        target_origin: target_origin.clone(),
        proxy_authority: protected_endpoint.authority.clone(),
        proxy_origin: protected_endpoint.origin.clone(),
        // t20: arm web auto-login for this session per the connection's opt-in
        // flag. Separate nonce slot from themed-auth's `pending_nonce`.
        auto_login_armed: Arc::new(AtomicBool::new(
            config.http_auto_login && proxy_policy.page_scripts != PageScripts::Block,
        )),
        auto_login_nonce: Arc::new(std::sync::RwLock::new(None)),
        bitwarden_continuation: Default::default(),
        auto_login_selectors: config.http_auto_login_selectors.clone(),
        http_form_automation: config.http_form_automation.clone(),
        yealink_session,
        client,
        request_count: request_count.clone(),
        document_sequence: Arc::new(AtomicU64::new(0)),
        error_count: error_count.clone(),
        last_error: last_error.clone(),
        global_sessions: sessions.clone(),
        credentials_applied,
    });

    // P3: register the auth POST endpoint before the fallback so it
    // takes precedence. Form submissions from the themed challenge
    // hit `/__sortofremoteng_auth`; everything else falls through to
    // the upstream proxy handler.
    let runtime = ProxySessionRuntime::new(proxy_state);
    let router = runtime.router();

    // Shutdown channel.
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // Spawn the server.
    let server_guard = runtime.clone();
    tokio::spawn(async move {
        let _server_guard = server_guard;
        axum::serve(listener, router.into_make_service())
            .with_graceful_shutdown(async {
                shutdown_rx.await.ok();
            })
            .await
            .ok();
    });

    // Store the session.
    {
        let mut mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        mgr.sessions.insert(
            session_id.clone(),
            ProxySessionEntry {
                runtime: Arc::downgrade(&runtime),
                attempt,
                network,
                website_dark_mode,
                target_url: target_url.clone(),
                username: config.username.clone(),
                password: config.password.clone(),
                upstream_auth_mode: config.upstream_auth_mode,
                proxy_policy,
                redirect_profile: config.redirect_profile,
                reviewed_application_profile: config.reviewed_application_profile,
                reviewed_application_api_origin: config.reviewed_application_api_origin.clone(),
                reviewed_application_mesh_origin: config.reviewed_application_mesh_origin.clone(),
                custom_headers: config.custom_headers.clone(),
                upstream_proxy_url,
                target_origin,
                connection_id,
                created_at: chrono::Utc::now().to_rfc3339(),
                local_port,
                min_tls_version: min_tls,
                verify_ssl,
                accepted_cert_fingerprint: config.accepted_cert_fingerprint.clone(),
                require_ca_verification: config.require_ca_verification,
                request_count,
                error_count,
                last_error,
                shutdown_tx: Some(shutdown_tx),
            },
        );
    }

    let deferred_login_status = attempt_guard
        .0
        .as_ref()
        .and_then(|attempt| attempt.deferred_login_status());
    attempt_guard.0 = None;
    Ok(ProxyMediatorResponse {
        local_port,
        session_id: session_id.clone(),
        proxy_url: protected_endpoint.url,
        google_routes,
        deferred_login_status,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anonymous_config() -> BasicAuthProxyConfig {
        serde_json::from_value(serde_json::json!({
            "target_url": "https://analytics.google.com/",
            "username": "",
            "password": "",
            "upstream_auth_mode": "none",
            "reviewed_application_profile": "google-hosted"
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn startup_rejects_invalid_budget_before_guard_or_session_allocation() {
        let sessions = ProxySessionManager::new();
        let mut config = anonymous_config();
        config.transport_settings.connect_timeout_seconds = 0;
        let callback_called = Arc::new(AtomicBool::new(false));
        let called = callback_called.clone();
        let result = start_proxy_session(
            config,
            sessions.clone(),
            Some(Arc::new(move |_| {
                called.store(true, Ordering::SeqCst);
            })),
        )
        .await;
        assert!(result.unwrap_err().contains("connectTimeoutSeconds"));
        assert!(sessions.lock().unwrap().sessions.is_empty());
        assert!(!callback_called.load(Ordering::SeqCst));
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn startup_without_app_handle_still_requires_native_guard() {
        // This unit-test process never installs a native WebView guard. Do not
        // mark it ready just to exercise startup: hosts must install real hooks.
        let sessions = ProxySessionManager::new();
        let result = start_proxy_session(anonymous_config(), sessions.clone(), None).await;
        assert!(result
            .unwrap_err()
            .contains("navigation guard is unavailable"));
        assert!(sessions.lock().unwrap().sessions.is_empty());
    }
}
