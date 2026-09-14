//! Actual protected Axum proxy route regressions; all endpoints and credentials
//! are synthetic. No Tauri profile or desktop runtime is initialized.
#[path = "http_attempt_response_tests.rs"]
mod attempt_response_tests;
#[path = "http_font_asset_tests.rs"]
mod font_asset_tests;
#[path = "http_local_observation_tests.rs"]
mod local_observation_tests;
#[path = "http_network_tests.rs"]
mod network_tests;
#[path = "http_quickconnect_control_tests.rs"]
mod quickconnect_control_tests;
#[path = "http_quickconnect_tests.rs"]
mod quickconnect_tests;
#[path = "http_redirect_tests.rs"]
mod redirect_tests;
#[path = "http_upstream_cookie_tests.rs"]
mod upstream_cookie_tests;

use super::*;
use axum::body::Body;
use axum::http::{HeaderMap, Response, StatusCode};
use std::io::Write;
use tokio::net::TcpListener;

use super::tls_test_fixture as tls_fixture;

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

struct FixtureProxy {
    base: String,
    state: Arc<AxumProxyState>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for FixtureProxy {
    fn drop(&mut self) {
        self.state.network.revoke();
        self.task.abort();
    }
}

async fn proxy(target: String, client: reqwest::Client) -> FixtureProxy {
    proxy_with_mode(target, client, UpstreamAuthMode::None).await
}

async fn proxy_with_mode(
    target: String,
    client: reqwest::Client,
    auth_mode: UpstreamAuthMode,
) -> FixtureProxy {
    proxy_with_policy(
        target,
        client,
        auth_mode,
        HttpProxyPolicy::default(),
        HashMap::new(),
    )
    .await
}

async fn proxy_with_policy(
    target: String,
    client: reqwest::Client,
    auth_mode: UpstreamAuthMode,
    policy: HttpProxyPolicy,
    custom_headers: HashMap<String, String>,
) -> FixtureProxy {
    proxy_with_policy_and_network(
        target,
        client,
        auth_mode,
        policy,
        custom_headers,
        Arc::new(ProxyNetworkState::default()),
    )
    .await
}

async fn proxy_with_policy_and_network(
    target: String,
    client: reqwest::Client,
    auth_mode: UpstreamAuthMode,
    policy: HttpProxyPolicy,
    custom_headers: HashMap<String, String>,
    network: Arc<ProxyNetworkState>,
) -> FixtureProxy {
    proxy_with_redirect_profile(
        target,
        client,
        auth_mode,
        policy,
        custom_headers,
        network,
        None,
    )
    .await
}

async fn proxy_with_redirect_profile(
    target: String,
    client: reqwest::Client,
    auth_mode: UpstreamAuthMode,
    policy: HttpProxyPolicy,
    custom_headers: HashMap<String, String>,
    network: Arc<ProxyNetworkState>,
    redirect_profile: Option<BrowserRedirectProfile>,
) -> FixtureProxy {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let authority = format!("p{TOKEN}.localhost:{port}");
    let state = Arc::new(AxumProxyState {
        attempt: None,
        network,
        session_id: "synthetic-proxy-session".into(),
        connection_id: "fixture".into(),
        target_origin: reqwest::Url::parse(&target)
            .unwrap()
            .origin()
            .ascii_serialization(),
        target_url: target,
        username: Arc::new(std::sync::RwLock::new(String::new())),
        password: Arc::new(std::sync::RwLock::new(String::new())),
        upstream_auth_mode: auth_mode,
        proxy_policy: policy,
        redirect_profile,
        custom_headers,
        pending_nonce: Arc::new(std::sync::RwLock::new(None)),
        theme: Arc::new(std::sync::RwLock::new(
            crate::theme_tokens::ThemeTokens::dark_default(),
        )),
        proxy_origin: format!("http://{authority}"),
        proxy_authority: authority,
        auto_login_armed: Arc::new(AtomicBool::new(false)),
        auto_login_nonce: Arc::new(std::sync::RwLock::new(None)),
        bitwarden_continuation: Default::default(),
        auto_login_selectors: None,
        http_form_automation: None,
        client,
        request_count: Arc::new(AtomicU64::new(0)),
        document_sequence: Arc::new(AtomicU64::new(0)),
        error_count: Arc::new(AtomicU64::new(0)),
        last_error: Arc::new(std::sync::Mutex::new(None)),
        global_sessions: ProxySessionManager::new(),
        credentials_applied: None,
    });
    let router = axum::Router::new()
        .route(AUTOLOGIN_PATH, axum::routing::get(autologin_cred_handler))
        .fallback(axum_proxy_handler)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            enforce_proxy_access,
        ))
        .with_state(state.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    FixtureProxy {
        base: format!("http://127.0.0.1:{port}"),
        state,
        task,
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap()
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut writer = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    writer.write_all(bytes).unwrap();
    writer.finish().unwrap()
}

fn lifecycle_payload(html: &str) -> serde_json::Value {
    let json = html
        .split_once("var p=")
        .unwrap()
        .1
        .split_once(";\nvar u=")
        .unwrap()
        .0;
    serde_json::from_str(json).unwrap()
}

async fn fetch(proxy: &FixtureProxy, path: &str) -> reqwest::Response {
    client()
        .get(format!("{}{path}", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Accept-Encoding", "gzip, deflate, br")
        .header("Sec-Fetch-Dest", "document")
        .header("If-None-Match", "old-server-validator")
        .header("If-Modified-Since", "Wed, 09 Sep 2026 01:00:00 GMT")
        .send()
        .await
        .unwrap()
}

async fn reviewed_vault_proxy() -> FixtureProxy {
    reviewed_login_proxy(UpstreamAuthMode::BitwardenForm).await
}

async fn reviewed_login_proxy(mode: UpstreamAuthMode) -> FixtureProxy {
    let proxy = proxy_with_mode("https://synthetic.invalid/".into(), client(), mode).await;
    let state = &proxy.state;
    *state.username.write().unwrap() = "synthetic-user".into();
    *state.password.write().unwrap() = "synthetic-master-password".into();
    state.auto_login_armed.store(true, Ordering::SeqCst);
    state.document_sequence.store(1, Ordering::SeqCst);
    state.global_sessions.lock().unwrap().sessions.insert(
        state.session_id.clone(),
        ProxySessionEntry {
            attempt: state.attempt.clone(),
            network: state.network.clone(),
            target_url: state.target_url.clone(),
            username: "synthetic-user".into(),
            password: "synthetic-master-password".into(),
            upstream_auth_mode: mode,
            proxy_policy: Default::default(),
            redirect_profile: state.redirect_profile,
            custom_headers: HashMap::new(),
            upstream_proxy_url: None,
            target_origin: state.target_origin.clone(),
            connection_id: state.connection_id.clone(),
            created_at: String::new(),
            local_port: 1,
            min_tls_version: "1.2".into(),
            verify_ssl: true,
            accepted_cert_fingerprint: None,
            require_ca_verification: false,
            request_count: state.request_count.clone(),
            error_count: state.error_count.clone(),
            last_error: state.last_error.clone(),
            shutdown_tx: None,
        },
    );
    let html = crate::themed_autologin::build_autologin_injection(state, 1).unwrap();
    assert!(!html.contains("synthetic-user") && !html.contains("synthetic-master-password"));
    assert_eq!(
        html.contains("fetchCredsAndRun(NONCE,SEL, 'synology')"),
        mode == UpstreamAuthMode::SynologyForm
    );
    proxy
}

#[tokio::test]
async fn reviewed_vault_staged_grants_are_one_use_and_keep_password_out_of_email_response() {
    for mode in [
        UpstreamAuthMode::BitwardenForm,
        UpstreamAuthMode::SynologyForm,
    ] {
        assert_reviewed_staged_grants(mode).await;
    }
}

async fn assert_reviewed_staged_grants(mode: UpstreamAuthMode) {
    let proxy = reviewed_login_proxy(mode).await;
    let nonce = proxy
        .state
        .auto_login_nonce
        .read()
        .unwrap()
        .clone()
        .unwrap();
    let first = fetch(&proxy, &format!("{AUTOLOGIN_PATH}?nonce={nonce}")).await;
    assert_eq!(first.status(), StatusCode::OK);
    assert_eq!(first.headers()["cache-control"], "no-store");
    let body = first.text().await.unwrap();
    assert!(!body.contains("password"));
    let data: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        data["loginFlow"],
        if mode == UpstreamAuthMode::SynologyForm {
            "synology"
        } else {
            "bitwarden"
        }
    );
    assert_eq!(data["username"], "synthetic-user");
    assert_eq!(
        fetch(&proxy, &format!("{AUTOLOGIN_PATH}?nonce={nonce}"))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let token = data["continuation"].as_str().unwrap();
    assert_eq!(
        fetch(
            &proxy,
            &format!("{AUTOLOGIN_PATH}?phase=password&nonce=wrong")
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    let password = fetch(
        &proxy,
        &format!("{AUTOLOGIN_PATH}?phase=password&nonce={token}"),
    )
    .await;
    assert_eq!(password.status(), StatusCode::OK);
    assert!(password
        .text()
        .await
        .unwrap()
        .contains("synthetic-master-password"));
    assert_eq!(
        fetch(
            &proxy,
            &format!("{AUTOLOGIN_PATH}?phase=password&nonce={token}")
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    assert!(proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log
        .is_empty());
    assert!(crate::themed_autologin::build_autologin_injection(&proxy.state, 1).is_none());
}

#[tokio::test]
async fn reviewed_vault_document_navigation_and_session_stop_revoke_pending_passwords() {
    for mode in [
        UpstreamAuthMode::BitwardenForm,
        UpstreamAuthMode::SynologyForm,
    ] {
        assert_reviewed_revocation(mode).await;
    }
}

async fn assert_reviewed_revocation(mode: UpstreamAuthMode) {
    for stop in [false, true] {
        let proxy = reviewed_login_proxy(mode).await;
        let nonce = proxy
            .state
            .auto_login_nonce
            .read()
            .unwrap()
            .clone()
            .unwrap();
        let data: serde_json::Value = fetch(&proxy, &format!("{AUTOLOGIN_PATH}?nonce={nonce}"))
            .await
            .json()
            .await
            .unwrap();
        if stop {
            proxy
                .state
                .global_sessions
                .lock()
                .unwrap()
                .sessions
                .remove(&proxy.state.session_id);
        } else {
            proxy.state.document_sequence.fetch_add(1, Ordering::SeqCst);
        }
        let token = data["continuation"].as_str().unwrap();
        let reply = fetch(
            &proxy,
            &format!("{AUTOLOGIN_PATH}?phase=password&nonce={token}"),
        )
        .await;
        assert_eq!(reply.status(), StatusCode::FORBIDDEN);
        assert!(!reply
            .text()
            .await
            .unwrap()
            .contains("synthetic-master-password"));
    }
}

#[tokio::test]
async fn reviewed_vault_old_document_nonce_cannot_begin_after_new_navigation() {
    let proxy = reviewed_vault_proxy().await;
    let nonce = proxy
        .state
        .auto_login_nonce
        .read()
        .unwrap()
        .clone()
        .unwrap();
    proxy.state.document_sequence.fetch_add(1, Ordering::SeqCst);
    assert_eq!(
        fetch(&proxy, &format!("{AUTOLOGIN_PATH}?nonce={nonce}"))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert!(crate::themed_autologin::build_autologin_injection(&proxy.state, 1).is_none());
}

#[tokio::test]
async fn real_digest_negotiation_is_bounded_and_never_sends_basic_or_plaintext() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let log = captured.clone();
    let router = axum::Router::new().fallback(move |request: axum::extract::Request| {
        let log = log.clone();
        async move {
            let path = request.uri().path().to_string();
            let authorization = request.headers().get("authorization").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
            let mut log = log.lock().unwrap();
            log.push((path.clone(), request.method().to_string(), authorization.clone()));
            let count = log.iter().filter(|(p, _, _)| p == &path).count();
            if authorization.is_empty() || path == "/stale" || path == "/unsupported" {
                Response::builder().status(401)
                    .header("WWW-Authenticate", if path == "/unsupported" {
                        "Digest realm=\"fixture\", nonce=\"one\", algorithm=SHA-512, qop=\"auth-int\"".into()
                    } else { format!("Digest realm=\"fixture\", nonce=\"nonce-{count}\", algorithm=SHA-256, qop=\"auth\", stale={}", count > 1) })
                    .body(Body::empty()).unwrap()
            } else {
                assert!(authorization.starts_with("Digest "));
                assert!(authorization.contains("algorithm=SHA-256"));
                assert!(authorization.contains(&format!("uri=\"{}\"", request.uri())));
                assert!(!authorization.contains("synthetic-password"));
                Response::builder().status(200).body(Body::from("authenticated")).unwrap()
            }
        }
    });
    let upstream = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let proxy = proxy_with_mode(
        format!("http://{address}/"),
        client(),
        UpstreamAuthMode::Digest,
    )
    .await;
    *proxy.state.username.write().unwrap() = "synthetic-user".into();
    *proxy.state.password.write().unwrap() = "synthetic-password".into();
    let response = client()
        .post(format!("{}/login?view=1", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .body("field=synthetic")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    for path in ["/stale", "/unsupported"] {
        let response = fetch(&proxy, path).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let text = response.text().await.unwrap();
        assert!(!text.contains("synthetic-password"));
        assert!(text.contains("Digest"));
    }
    let log = captured.lock().unwrap();
    assert_eq!(log.iter().filter(|(p, _, _)| p == "/login").count(), 2);
    assert_eq!(log.iter().filter(|(p, _, _)| p == "/stale").count(), 3);
    assert_eq!(
        log.iter().filter(|(p, _, _)| p == "/unsupported").count(),
        1
    );
    assert!(log.iter().all(|(_, _, auth)| !auth.starts_with("Basic ")));
    upstream.abort();
}

#[tokio::test]
async fn redirect_origin_is_mandatory_even_without_optional_policies() {
    let foreign_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let foreign_address = foreign_listener.local_addr().unwrap();
    let foreign_calls = Arc::new(AtomicU64::new(0));
    let calls = foreign_calls.clone();
    let foreign = tokio::spawn(async move {
        axum::serve(
            foreign_listener,
            axum::Router::new().fallback(move || {
                let calls = calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::Relaxed);
                    "foreign"
                }
            }),
        )
        .await
        .unwrap();
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().fallback(move |request: axum::extract::Request| async move {
                if request.uri().path() == "/same" {
                    Response::builder()
                        .status(302)
                        .header("Location", "/ok")
                        .body(Body::empty())
                        .unwrap()
                } else if request.uri().path() == "/foreign" {
                    Response::builder()
                        .status(307)
                        .header("Location", format!("http://{foreign_address}/"))
                        .body(Body::empty())
                        .unwrap()
                } else {
                    Response::builder().body(Body::from("local")).unwrap()
                }
            }),
        )
        .await
        .unwrap();
    });
    let proxy = proxy_with_mode(
        format!("http://{address}/"),
        client(),
        UpstreamAuthMode::Basic,
    )
    .await;
    *proxy.state.username.write().unwrap() = "synthetic-user".into();
    *proxy.state.password.write().unwrap() = "synthetic-secret".into();
    assert_eq!(fetch(&proxy, "/same").await.status(), StatusCode::OK);
    for method in [reqwest::Method::GET, reqwest::Method::POST] {
        let response = client()
            .request(method, format!("{}/foreign", proxy.base))
            .header("Host", &proxy.state.proxy_authority)
            .body("secret-form-body")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(response
            .text()
            .await
            .unwrap()
            .contains("cross_origin_redirect"));
    }
    assert_eq!(foreign_calls.load(Ordering::Relaxed), 0);
    foreign.abort();
    upstream.abort();
}

#[tokio::test]
async fn actual_policy_blocks_bootstrap_and_external_scripts_and_applies_private_request_options() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let log = captured.clone();
    let upstream = tokio::spawn(async move {
        axum::serve(listener, axum::Router::new().fallback(move |request: axum::extract::Request| {
        let log = log.clone(); async move {
            log.lock().unwrap().push((request.uri().to_string(), request.headers().clone()));
            Response::builder().header("Content-Type", "text/html")
                .header("Cache-Control", "public, max-age=3600").header("ETag", "upstream-validator")
                .body(Body::from("<!doctype html><html><head><script src='/app.js'></script><script>window.app=true;</script></head><body>fixture</body></html>")).unwrap()
        }
    })).await.unwrap();
    });
    let policy = HttpProxyPolicy {
        page_scripts: PageScripts::Block,
        cache_mode: CacheMode::Bypass,
        same_origin_only: true,
        query_parameters: vec![proxy_policy::QueryParameter {
            name: "tenant".into(),
            value: "synthetic-secret-query".into(),
        }],
        ..HttpProxyPolicy::default()
    };
    let proxy = proxy_with_policy(
        format!("http://{address}/"),
        client(),
        UpstreamAuthMode::Header,
        policy,
        HashMap::from([
            (
                "Authorization".into(),
                "Bearer synthetic-secret-header".into(),
            ),
            ("X-Custom".into(), "private-custom".into()),
        ]),
    )
    .await;
    // Even a stale armed slot must not mint a new page nonce or ship code.
    proxy.state.auto_login_armed.store(true, Ordering::Relaxed);
    let response = fetch(&proxy, "/page").await;
    assert_eq!(response.headers()["Cache-Control"], "no-store");
    assert!(!response.headers().contains_key("ETag"));
    let csp = response.headers()["Content-Security-Policy"]
        .to_str()
        .unwrap();
    assert!(csp.contains("script-src 'none'"));
    assert!(csp.contains("form-action 'self'"));
    let text = response.text().await.unwrap();
    assert!(!text.contains("proxy_document_start"));
    assert!(!text.contains("__sortofremoteng_autologin"));
    assert!(!text.contains("synthetic-secret"));
    assert!(proxy.state.auto_login_nonce.read().unwrap().is_none());
    let blocked = client()
        .get(format!("{}/app.js", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Sec-Fetch-Dest", "script")
        .send()
        .await
        .unwrap();
    assert_eq!(blocked.status(), StatusCode::FORBIDDEN);
    let requests = captured.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].0.contains("tenant=synthetic-secret-query"));
    assert_eq!(
        requests[0].1["Authorization"],
        "Bearer synthetic-secret-header"
    );
    assert_eq!(requests[0].1["Cache-Control"], "no-cache, no-store");
    assert!(!requests[0].1.contains_key("If-None-Match"));
    let logs = proxy.state.global_sessions.lock().unwrap();
    assert!(logs
        .request_log
        .iter()
        .all(|entry| !entry.url.contains("synthetic-secret")));
    let recorded = recorded_request_headers(
        &proxy.state,
        &[
            ("X-Custom".into(), "private-custom".into()),
            ("Accept".into(), "text/html".into()),
        ],
    );
    assert!(!recorded.contains_key("X-Custom"));
    assert!(recorded.contains_key("Accept"));
    upstream.abort();
}

#[tokio::test]
async fn dashboard_ajax_html_stats_remain_exact_and_do_not_rotate_document_or_login_state() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let stats =
        format!("0|1|2|3|4|5|6|7|8|9|<span data-url='http://{address}/dashboard'>42%</span>|11");
    let served = stats.clone();
    let router = axum::Router::new().fallback(move |request: axum::extract::Request| {
        let body = served.clone();
        async move {
            let compressed = request.uri().path() == "/compressed";
            let mut response = Response::builder()
                .status(if request.uri().path() == "/unauthorized" {
                    401
                } else {
                    200
                })
                .header("Content-Type", "text/html; charset=UTF-8")
                .header("WWW-Authenticate", "Basic realm=fixture")
                .header("ETag", "stats-validator");
            if compressed {
                response = response.header("Content-Encoding", "gzip");
            }
            response
                .body(Body::from(if compressed {
                    gzip(body.as_bytes())
                } else {
                    body.into_bytes()
                }))
                .unwrap()
        }
    });
    let upstream = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let proxy = proxy_with_mode(
        format!("http://{address}/"),
        client(),
        UpstreamAuthMode::Basic,
    )
    .await;
    proxy.state.auto_login_armed.store(true, Ordering::Relaxed);
    *proxy.state.auto_login_nonce.write().unwrap() = Some("already-issued-page-nonce".into());
    for path in [
        "/getstats.php".to_string(),
        format!("/getstats.php?__sorng_navigation_v1={TOKEN}"),
        "/unauthorized".into(),
        "/compressed".into(),
    ] {
        let response = client()
            .get(format!("{}{path}", proxy.base))
            .header("Host", &proxy.state.proxy_authority)
            .header("Sec-Fetch-Dest", "empty")
            .header("Sec-Fetch-Mode", "same-origin")
            .header("X-Requested-With", "XMLHttpRequest")
            .header("Accept", "text/html, */*; q=0.01")
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status().as_u16(),
            if path == "/unauthorized" { 401 } else { 200 }
        );
        assert_eq!(response.headers()["ETag"], "stats-validator");
        if path == "/compressed" {
            assert_eq!(response.headers()["Content-Encoding"], "gzip");
        }
        let bytes = response.bytes().await.unwrap();
        if path == "/compressed" {
            assert_eq!(bytes.as_ref(), gzip(stats.as_bytes()));
        } else {
            assert_eq!(bytes.as_ref(), stats.as_bytes());
            assert_eq!(bytes.split(|byte| *byte == b'|').count(), 12);
        }
        assert_eq!(proxy.state.document_sequence.load(Ordering::Relaxed), 0);
        assert_eq!(
            proxy.state.auto_login_nonce.read().unwrap().as_deref(),
            Some("already-issued-page-nonce")
        );
        assert!(proxy.state.pending_nonce.read().unwrap().is_none());
    }
    upstream.abort();
}

#[tokio::test]
async fn document_only_injection_supports_safe_legacy_navigation_and_retains_csrf() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let html = "<!doctype html><html><head><script type=\"text/javascript\">if (top != self) {top.location.href = self.location.href;}</script><script>window.application=true;</script></head><body><form><input name='__csrf_magic' value='fixture-token'></form></body></html>";
    let router = axum::Router::new().fallback(move || async move {
        Response::builder()
            .header("Content-Type", "text/html")
            .body(Body::from(html))
            .unwrap()
    });
    let upstream = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let proxy = proxy(format!("http://{address}/"), client()).await;
    // Missing navigation evidence is not guessed from an HTML Content-Type.
    let unknown = client()
        .get(format!("{}/fragment", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Accept", "text/html")
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(unknown, html);
    assert_eq!(proxy.state.document_sequence.load(Ordering::Relaxed), 0);
    for marker in [false, true] {
        let path = if marker {
            format!("/?__sorng_navigation_v1={TOKEN}")
        } else {
            "/".into()
        };
        let mut request = client()
            .get(format!("{}{path}", proxy.base))
            .header("Host", &proxy.state.proxy_authority);
        if !marker {
            request = request
                .header("Accept", "text/html,application/xhtml+xml")
                .header("Upgrade-Insecure-Requests", "1");
        }
        let document = request.send().await.unwrap().text().await.unwrap();
        assert!(document.contains("proxy_dom_ready"));
        assert!(
            document.find("proxy_document_start").unwrap()
                < document.find("window.application=true").unwrap()
        );
        assert!(!document.contains("top.location.href = self.location.href"));
        assert!(document.contains("name='__csrf_magic' value='fixture-token'"));
    }
    assert_eq!(proxy.state.document_sequence.load(Ordering::Relaxed), 2);
    upstream.abort();
}

#[tokio::test]
async fn request_health_recovers_after_401_and_500_without_resetting_history() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = axum::Router::new().fallback(|request: axum::extract::Request| async move {
        let status = match request.uri().path() {
            "/unauthorized" => 401,
            "/failed" => 500,
            _ => 200,
        };
        Response::builder()
            .status(status)
            .header("Content-Type", "text/plain")
            .body(Body::from("synthetic response"))
            .unwrap()
    });
    let upstream = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let proxy = proxy(format!("http://{address}/"), client()).await;
    for (path, status, error_total) in [
        ("/unauthorized", 401, 1),
        ("/ok", 200, 1),
        ("/failed", 500, 2),
        ("/ok", 200, 2),
    ] {
        assert_eq!(fetch(&proxy, path).await.status().as_u16(), status);
        assert_eq!(proxy.state.error_count.load(Ordering::Relaxed), error_total);
        let error = proxy.state.last_error.lock().unwrap().clone();
        if status < 400 {
            assert!(error.is_none());
        } else {
            assert!(error.unwrap().contains(&format!("HTTP {status}")));
        }
    }
    assert_eq!(proxy.state.request_count.load(Ordering::Relaxed), 4);
    let history = proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    assert_eq!(
        history.iter().map(|entry| entry.status).collect::<Vec<_>>(),
        [200, 500, 200, 401]
    );
    upstream.abort();
}

#[tokio::test]
async fn website_automation_asset_is_local_and_keeps_proxy_access_guards() {
    // A closed upstream proves the asset never forwards to a website.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://{}/", listener.local_addr().unwrap());
    drop(listener);
    let proxy = proxy(target, client()).await;
    let path = super::web_automation::DARKREADER_PATH;
    let allowed = fetch(&proxy, path).await;
    assert_eq!(allowed.status(), StatusCode::OK);
    assert_eq!(allowed.headers()["X-Content-Type-Options"], "nosniff");
    assert!(allowed.text().await.unwrap().contains("DarkReader"));
    let rejected = client()
        .get(format!("{}{path}", proxy.base))
        .send()
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::FORBIDDEN);
    let write = client()
        .post(format!("{}{path}", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Origin", &proxy.state.proxy_origin)
        .send()
        .await
        .unwrap();
    assert_eq!(write.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(proxy.state.request_count.load(Ordering::Relaxed), 0);
    assert_eq!(proxy.state.error_count.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn actual_proxy_decodes_gzip_documents_assets_and_preserves_raw_query_and_port() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let seen = Arc::new(std::sync::Mutex::new(Vec::<(String, HeaderMap)>::new()));
    let captured = seen.clone();
    let target_origin = format!("http://{address}");
    let upstream_origin = target_origin.clone();
    let router = axum::Router::new().fallback(move |request: axum::extract::Request| {
        let captured = captured.clone(); let origin = upstream_origin.clone();
        async move {
            captured.lock().unwrap().push((request.uri().to_string(), request.headers().clone()));
            let (content_type, body) = match request.uri().path() {
                "/app.js" => ("application/javascript", format!("const endpoint=new URL('{origin}/api');const base=new URL('{origin}');const foreign='{origin}.attacker.invalid/api';")),
                "/app.css" => ("text/css", format!("body{{background:url({origin}/logo.png)}}")),
                _ => ("text/html; charset=utf-8", format!("<!doctype html><html><head><script src='{origin}/app.js'></script></head><body><form><input name='usernamefld'><input type='password' name='passwordfld'><button>Sign in</button></form></body></html>")),
            };
            Response::builder().status(200).header("Content-Type", content_type)
                .header("Content-Encoding", "gzip").header("ETag", "original")
                .header("Digest", "sha-256=original").header("Accept-Ranges", "bytes")
                .header("Last-Modified", "Wed, 09 Sep 2026 01:00:00 GMT")
                .body(Body::from(gzip(body.as_bytes()))).unwrap()
        }
    });
    let upstream = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let proxy = proxy(format!("{target_origin}/"), client()).await;
    let original = "a=%20&b=+&c=%7E&dup=1&dup=2";
    for path in [
        format!("/?{original}&__sorng_navigation_v1={TOKEN}"),
        "/app.js".into(),
        "/app.css".into(),
    ] {
        let response = fetch(&proxy, &path).await;
        assert_eq!(response.status(), StatusCode::OK);
        for name in [
            "content-encoding",
            "etag",
            "digest",
            "accept-ranges",
            "last-modified",
        ] {
            assert!(!response.headers().contains_key(name), "stale {name}");
        }
        assert_eq!(response.headers()["cache-control"], "no-store");
        let length = response.content_length().unwrap();
        let body = response.text().await.unwrap();
        assert_eq!(length, body.len() as u64);
        if path.starts_with("/?") {
            // Only the immutable routing DTO retains the upstream origin;
            // every executable/document resource URL must still be rewritten.
            let routing_source = format!(
                "\"sourceOrigin\":{}",
                serde_json::to_string(&target_origin).unwrap()
            );
            assert_eq!(body.matches(&routing_source).count(), 1);
            assert!(!body
                .replacen(
                    &routing_source,
                    "\"sourceOrigin\":\"[routing identity]\"",
                    1
                )
                .contains(&target_origin));
            assert!(body.contains("<form>"));
            assert!(body.contains("proxy_dom_ready"));
            assert!(body.contains("synthetic-proxy-session"));
            assert!(
                body.find("proxy_dom_ready").unwrap()
                    < body
                        .find(&format!("src='{}/app.js'", proxy.state.proxy_origin))
                        .unwrap()
            );
            assert!(!body.contains("__sorng_autologin.fetchCredsAndRun"));
        } else {
            assert!(!body.contains("proxy_dom_ready"));
            if path == "/app.js" {
                assert!(body.contains(&format!("new URL('{}/api')", proxy.state.proxy_origin)));
                assert!(body.contains(&format!("new URL('{}')", proxy.state.proxy_origin)));
                assert!(body.contains(&format!("'{target_origin}.attacker.invalid/api'")));
            } else {
                assert!(body.contains(&format!("url({}/logo.png)", proxy.state.proxy_origin)));
            }
        }
    }
    let seen = seen.lock().unwrap();
    assert_eq!(seen[0].0, format!("/?{original}"));
    for (_, headers) in seen.iter() {
        assert_eq!(headers["host"], address.to_string());
        assert_eq!(headers["accept-encoding"], "gzip, deflate");
        assert!(!headers.contains_key("authorization"));
        assert!(!headers.contains_key("if-none-match"));
        assert!(!headers.contains_key("if-modified-since"));
    }
    let records = proxy.state.global_sessions.lock().unwrap();
    assert!(records
        .request_log
        .iter()
        .all(|entry| !entry.url.contains("__sorng_navigation")));
    upstream.abort();
}

#[tokio::test]
async fn actual_proxy_rejects_bad_text_encoding_but_preserves_opaque_bodies() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = axum::Router::new().fallback(|request: axum::extract::Request| async move {
        let (status, ty, encoding, bytes) = match request.uri().path() {
            "/binary" => (200, "application/octet-stream", "br", vec![0, 255, 1, 128]),
            "/json" => (200, "application/json", "gzip", gzip(b"{\"ok\":true}")),
            "/status" => (
                500,
                "text/html",
                "gzip",
                gzip(b"<html><body>synthetic failure</body></html>"),
            ),
            "/unsupported" => (200, "text/html", "br", vec![1, 2, 3]),
            "/partial" => (206, "text/css", "gzip", gzip(b"body{}")),
            "/cached" => (304, "text/html", "gzip", Vec::new()),
            "/empty" => (204, "text/html", "gzip", Vec::new()),
            _ => (200, "text/html", "gzip", vec![1, 2, 3]),
        };
        Response::builder()
            .status(status)
            .header("Content-Type", ty)
            .header("Content-Encoding", encoding)
            .body(Body::from(bytes))
            .unwrap()
    });
    let upstream = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let proxy = proxy(format!("http://{address}/"), client()).await;
    for path in ["/malformed", "/unsupported", "/partial", "/cached"] {
        let response = fetch(&proxy, path).await;
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert!(!response.headers().contains_key("content-encoding"));
        let body = response.text().await.unwrap();
        assert!(body.contains("sorng_proxy_failure"));
        assert!(!body.contains("proxy_dom_ready"));
    }
    let empty = fetch(&proxy, "/empty").await;
    assert_eq!(empty.status(), StatusCode::NO_CONTENT);
    assert!(empty.bytes().await.unwrap().is_empty());
    let head = client()
        .head(format!("{}/", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .send()
        .await
        .unwrap();
    assert_eq!(head.status(), StatusCode::OK);
    assert!(head.bytes().await.unwrap().is_empty());
    let binary = fetch(&proxy, "/binary").await;
    assert_eq!(binary.headers()["content-encoding"], "br");
    assert_eq!(binary.bytes().await.unwrap().as_ref(), [0, 255, 1, 128]);
    let json = fetch(&proxy, "/json").await;
    assert_eq!(json.headers()["content-encoding"], "gzip");
    assert_eq!(json.bytes().await.unwrap().as_ref(), gzip(b"{\"ok\":true}"));
    let error = fetch(&proxy, "/status").await;
    assert_eq!(error.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert!(!error.headers().contains_key("content-encoding"));
    assert!(error.text().await.unwrap().contains("synthetic failure"));
    // Real middleware still refuses an unknown host before reaching upstream.
    assert_eq!(
        client().get(&proxy.base).send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    upstream.abort();
}

#[tokio::test]
async fn actual_proxy_handles_gzip_https_form_with_exact_pin_and_refuses_wrong_pin() {
    use base64::Engine;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let acceptor = tls_fixture::test_acceptor();
    let upstream = tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                let Ok(mut stream) = acceptor.accept(tcp).await else {
                    return;
                };
                let mut req = Vec::new();
                while !req.ends_with(b"\r\n\r\n") && req.len() < 8192 {
                    let Ok(byte) = stream.read_u8().await else {
                        return;
                    };
                    req.push(byte);
                }
                let body = gzip(b"<html><head></head><body><form><input name='usernamefld'><input type='password' name='passwordfld'><button name='login'>Sign in</button></form></body></html>");
                let header = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Encoding: gzip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(header.as_bytes()).await;
                let _ = stream.write_all(&body).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    let der = base64::engine::general_purpose::STANDARD
        .decode(tls_fixture::TEST_CERT)
        .unwrap();
    let pin = hex::encode(Sha256::digest(der));
    for (fingerprint, expected) in [
        (pin, StatusCode::OK),
        ("0".repeat(64), StatusCode::BAD_GATEWAY),
    ] {
        let tls = build_pinned_tls_config(fingerprint).unwrap();
        let transport = reqwest::Client::builder()
            .no_proxy()
            .use_preconfigured_tls(tls)
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        let proxy = proxy(format!("https://{address}/"), transport).await;
        let response = fetch(&proxy, &format!("/?__sorng_navigation_v1={TOKEN}")).await;
        assert_eq!(response.status(), expected);
        let body = response.text().await.unwrap();
        if expected == StatusCode::OK {
            assert!(body.contains("usernamefld"));
            assert!(body.contains("proxy_dom_ready"));
        } else {
            assert!(body.contains("sorng_proxy_failure"));
            assert!(!body.contains("proxy_dom_ready"));
        }
    }
    upstream.abort();
}

#[tokio::test]
async fn actual_proxy_document_sequence_tracks_request_start_not_response_completion() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let notify = entered.clone();
    let unblock = release.clone();
    let router = axum::Router::new().fallback(move |req: axum::extract::Request| {
        let notify = notify.clone();
        let unblock = unblock.clone();
        async move {
            if req.uri().path() == "/slow" {
                notify.notify_one();
                unblock.notified().await;
            }
            Response::builder()
                .header("Content-Type", "text/html")
                .body(Body::from(
                    "<!doctype html><html><head></head><body>ready</body></html>",
                ))
                .unwrap()
        }
    });
    let upstream = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let proxy = proxy(format!("http://{address}/"), client()).await;
    let slow_url = format!("{}/slow?__sorng_navigation_v1={TOKEN}", proxy.base);
    let authority = proxy.state.proxy_authority.clone();
    let slow = tokio::spawn(async move {
        client()
            .get(slow_url)
            .header("Host", authority)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap()
    });
    tokio::time::timeout(std::time::Duration::from_secs(3), entered.notified())
        .await
        .unwrap();
    let fast = fetch(&proxy, "/internal").await.text().await.unwrap();
    release.notify_one();
    let old = slow.await.unwrap();
    let old_payload = lifecycle_payload(&old);
    let new_payload = lifecycle_payload(&fast);
    assert_eq!(old_payload["documentSequence"], 1);
    assert_eq!(new_payload["documentSequence"], 2);
    assert_eq!(old_payload["navigationToken"], TOKEN);
    assert!(new_payload["navigationToken"].is_null());
    assert_ne!(old_payload["documentToken"], new_payload["documentToken"]);
    for value in [&old_payload, &new_payload] {
        let token = value["documentToken"].as_str().unwrap();
        assert_eq!(token.len(), 32);
        assert!(token
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)));
    }
    for body in [old, fast] {
        assert!(body.contains("proxy_document_start"));
        assert!(body.contains("proxy_navigation_start"));
        assert!(body.contains("proxy_dom_ready"));
    }
    upstream.abort();
}

#[test]
fn navigation_marker_preserves_other_raw_query_and_never_accepts_ambiguous_tokens() {
    let original = "/login?a=%20&b=+&c=%7E&dup=1&dup=2";
    assert_eq!(
        proxy_response::navigation_request(&format!("{original}&__sorng_navigation_v1={TOKEN}")),
        (original.into(), Some(TOKEN.into()))
    );
    for marker in [
        "bad".to_string(),
        format!("{TOKEN}&__sorng_navigation_v1={TOKEN}"),
    ] {
        assert_eq!(
            proxy_response::navigation_request(&format!(
                "/login?__sorng_navigation_v1={marker}&x=1"
            )),
            ("/login?x=1".into(), None)
        );
    }
    assert_eq!(
        proxy_response::navigation_request("/legacy"),
        ("/legacy".into(), None)
    );
}

#[test]
fn connector_restart_requires_executable_regional_provider_script() {
    let defaults = SynologyQuickConnectDefaults {
        version: 1,
        original_origin: "https://fixture.quickconnect.to".into(),
    };
    let target = "https://fixture.fr3.quickconnect.to";
    let script = "<script src='/connect_lib.da3fae9c5d057ef58d3a.bundle.js'></script>";
    for html in [script.to_string(), format!("<html><head>{script}</head></html>"),
        "<SCRIPT defer type='text/javascript' SRC='https://quickconnect.to/connect_lib.da3fae9c5d057ef58d3a.bundle.js'></SCRIPT>".into()] {
        assert!(proxy_response::quickconnect_connector_document(&html, target, Some(&defaults)));
    }
    for html in [
        format!("<!-- {script} -->"),
        format!("<textarea>{script}</textarea>"),
        format!("<template>{script}</template>"),
        format!("<script>var example = {script:?};</script>"),
        "<script data-example=\" src='/connect_lib.da3fae9c5d057ef58d3a.bundle.js'\"></script>"
            .into(),
        script.replace("<script ", "<script type='application/json' "),
        script.replace("<script ", "<script nomodule "),
        script.replace("<script ", "<script src='/ordinary.js' "),
        script.replace(".bundle.js", ".bundle.js?example=1"),
        script.replace("src='/", "src='https://unapproved.invalid/"),
        "<html><form id='login'><input name='username'></form></html>".into(),
    ] {
        assert!(
            !proxy_response::quickconnect_connector_document(&html, target, Some(&defaults)),
            "{html}"
        );
    }
    for target in [
        "https://fixture.quickconnect.to",
        "https://www.quickconnect.to",
        "https://other.fr3.quickconnect.to",
        "http://fixture.fr3.quickconnect.to",
        "https://fixture.fr3.quickconnect.to:5001",
        "https://fixture.fr3.quickconnect.to.attacker.invalid",
    ] {
        assert!(!proxy_response::quickconnect_connector_document(
            script,
            target,
            Some(&defaults)
        ));
    }
    assert!(!proxy_response::quickconnect_connector_document(
        script, target, None
    ));
}

/// Explicitly opt-in, anonymous GET only. Never reads a connection/profile or
/// sends credentials; default test runs do not access any external endpoint.
#[tokio::test]
#[ignore = "requires explicit SORNG_PROXY_PUBLIC_SMOKE_URL authorization"]
async fn actual_proxy_opt_in_public_document_smoke() {
    let target = std::env::var("SORNG_PROXY_PUBLIC_SMOKE_URL").expect("explicit target required");
    let parsed = reqwest::Url::parse(&target).unwrap();
    assert!(matches!(parsed.scheme(), "http" | "https"));
    assert!(parsed.username().is_empty() && parsed.password().is_none());
    assert!(parsed.query().is_none() && parsed.fragment().is_none() && parsed.path() == "/");
    let proxy = proxy(target, client()).await;
    let response = fetch(&proxy, &format!("/?__sorng_navigation_v1={TOKEN}")).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(!response.headers().contains_key("content-encoding"));
    let bytes = response.bytes().await.unwrap();
    let text = std::str::from_utf8(&bytes).unwrap();
    assert!(text.contains("proxy_dom_ready"));
    assert!(!text.contains("sorng_proxy_failure"));
    eprintln!(
        "Anonymous proxy smoke: HTTP 200, decoded HTML {} bytes, readiness injected",
        bytes.len()
    );
}
