use super::*;
use reqwest::{cookie::CookieStore, Url};
use std::sync::Mutex;
use tokio::net::TcpListener;

const ORIGINAL: &str = "https://example.fr3.quickconnect.to/";
const HTTP: &str = "http://example.quickconnect.to/";
const HTTPS: &str = "https://example.quickconnect.to/";

fn tls() -> SynologyProxyTls {
    SynologyProxyTls {
        verify_ssl: true,
        accepted_cert_fingerprint: None,
        require_ca_verification: false,
    }
}

struct Fixture {
    manager: ProxySessionManagerState,
    runtime: Arc<ProxySessionRuntime>,
    task: tokio::task::JoinHandle<()>,
    port: u16,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.state().network.revoke();
        self.task.abort();
    }
}
impl Fixture {
    fn state(&self) -> Arc<AxumProxyState> {
        self.runtime.0.read().unwrap().state.clone()
    }
    fn ticket(&self, destination: &str) -> String {
        let state = self.state();
        let sequence = state.document_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        assert!(redirect::record(
            &state,
            &Url::parse(destination).unwrap(),
            sequence,
            None
        ));
        let mut manager = self.manager.lock().unwrap();
        let peek = manager.review_redirect("same-session", None).unwrap();
        assert!(peek.continuation_id.is_none());
        manager
            .review_redirect("same-session", Some(&peek.receipt_id))
            .unwrap()
            .continuation_id
            .unwrap()
    }
    fn continue_to(&self, ticket: &str) -> Result<SynologyProxyContinuation, String> {
        self.manager.lock().unwrap().continue_synology_session(
            "same-session",
            ticket,
            tls(),
            |_, _, successor| {
                Ok(reqwest::Client::builder()
                    .no_proxy()
                    .cookie_provider(successor.cookie_store())
                    .build()
                    .unwrap())
            },
        )
    }
    async fn open(&self, result: &SynologyProxyContinuation) -> reqwest::Response {
        // Protected local endpoint; the synthetic upstream never uses DNS.
        let url = Url::parse(&result.navigation_url).unwrap();
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!(
                "http://127.0.0.1:{}{}?{}",
                self.port,
                url.path(),
                url.query().unwrap()
            ))
            .header("host", &self.state().proxy_authority)
            .send()
            .await
            .unwrap()
    }
}

async fn fixture() -> Fixture {
    let manager = ProxySessionManager::new();
    let mut config: BasicAuthProxyConfig = serde_json::from_value(serde_json::json!({
        "target_url": ORIGINAL, "username":"synthetic-user", "password":"synthetic-password",
        "connection_id":"saved-owner", "redirect_profile":"synology", "upstream_auth_mode":"synology-form",
        "http_auto_login":true,
        "proxy_policy":{"version":1,"pageScripts":"allow","httpsOnly":false,"sameOriginOnly":false,
            "cacheMode":"normal","queryParameters":[],"synologyQuickConnectDefaults":{
                "version":1,"originalOrigin":ORIGINAL.trim_end_matches('/') }}
    })).unwrap();
    let attempt = manager
        .lock()
        .unwrap()
        .attempts
        .start(&config, &Url::parse(ORIGINAL).unwrap(), "same-session")
        .unwrap()
        .unwrap();
    attempt.strip_deferred_login_config(&mut config);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let authority = format!("p{}.localhost:{port}", uuid::Uuid::new_v4().simple());
    let origin = format!("http://{authority}");
    let network = Arc::new(ProxyNetworkState::with_origin(&origin).unwrap());
    let state = Arc::new(AxumProxyState {
        attempt: Some(attempt.clone()),
        network: network.clone(),
        website_dark_mode: Default::default(),
        session_id: "same-session".into(),
        connection_id: "saved-owner".into(),
        target_url: ORIGINAL.into(),
        username: Default::default(),
        password: Default::default(),
        upstream_auth_mode: UpstreamAuthMode::None,
        proxy_policy: config.proxy_policy.clone().unwrap(),
        redirect_profile: config.redirect_profile,
        tactical_rmm_api: None,
        custom_headers: HashMap::new(),
        pending_nonce: Default::default(),
        theme: Arc::new(RwLock::new(crate::theme_tokens::ThemeTokens::dark_default())),
        target_origin: ORIGINAL.trim_end_matches('/').into(),
        proxy_authority: authority,
        proxy_origin: origin,
        auto_login_armed: Arc::new(AtomicBool::new(false)),
        auto_login_nonce: Default::default(),
        bitwarden_continuation: Default::default(),
        auto_login_selectors: None,
        http_form_automation: None,
        yealink_session: yealink_login::session_slot(),
        client: reqwest::Client::builder().no_proxy().build().unwrap(),
        document_sequence: Arc::new(AtomicU64::new(0)),
        request_count: Arc::new(AtomicU64::new(0)),
        error_count: Arc::new(AtomicU64::new(0)),
        last_error: Default::default(),
        global_sessions: manager.clone(),
        credentials_applied: None,
    });
    let runtime = ProxySessionRuntime::new(state.clone());
    manager.lock().unwrap().sessions.insert(
        "same-session".into(),
        ProxySessionEntry {
            runtime: Arc::downgrade(&runtime),
            attempt: Some(attempt),
            network,
            website_dark_mode: state.website_dark_mode.clone(),
            target_url: state.target_url.clone(),
            username: String::new(),
            password: String::new(),
            upstream_auth_mode: state.upstream_auth_mode,
            proxy_policy: state.proxy_policy.clone(),
            redirect_profile: state.redirect_profile,
            reviewed_application_profile: None,
            reviewed_application_api_origin: None,
            custom_headers: HashMap::new(),
            upstream_proxy_url: None,
            target_origin: state.target_origin.clone(),
            connection_id: state.connection_id.clone(),
            created_at: "unchanged-created".into(),
            local_port: port,
            min_tls_version: config.min_tls_version,
            verify_ssl: true,
            accepted_cert_fingerprint: None,
            require_ca_verification: false,
            request_count: state.request_count.clone(),
            error_count: state.error_count.clone(),
            last_error: state.last_error.clone(),
            shutdown_tx: None,
        },
    );
    let router = runtime.router();
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    Fixture {
        manager,
        runtime,
        task,
        port,
    }
}

#[test]
fn path_query_and_fragment_survive_navigation_without_forwarding_private_marker() {
    let destination = Url::parse("https://example.fr3.quickconnect.to/webman/index.cgi?launchApp=SYNO.SDS.FileStation&name=a%2Fb+z&flag#tab=files").unwrap();
    let token = "0123456789abcdef0123456789abcdef";
    let (navigation, entry) = navigation_url(
        &destination,
        "http://p0123456789abcdef0123456789abcdef.localhost:1234",
        token,
    );
    assert!(navigation.ends_with(&format!("&__sorng_navigation_v1={token}#tab=files")));
    let (upstream, marker) = proxy_response::navigation_request(&entry);
    assert_eq!(marker.as_deref(), Some(token));
    assert_eq!(
        upstream,
        "/webman/index.cgi?launchApp=SYNO.SDS.FileStation&name=a%2Fb+z&flag"
    );
    assert!(!entry.contains('#'));
    assert_eq!(destination.as_str(), "https://example.fr3.quickconnect.to/webman/index.cgi?launchApp=SYNO.SDS.FileStation&name=a%2Fb+z&flag#tab=files");
}

#[test]
fn private_generation_marker_is_removed_from_initial_cpanel_login_request() {
    let token = "0123456789abcdef0123456789abcdef";
    let routed = format!("/login/?login_only=1&__sorng_generation_v1={token}");
    assert_eq!(
        generation_query(routed.split_once('?').map(|(_, query)| query)),
        Ok(Some(token))
    );
    assert_eq!(without_generation(&routed), "/login/?login_only=1");
    assert_eq!(
        without_generation(&format!(
            "/login/?__sorng_generation_v1={token}&login_only=1"
        )),
        "/login/?login_only=1"
    );
}

#[tokio::test]
async fn same_listener_session_origin_and_form_intent_survive_http_https_hops() {
    let fixture = fixture().await;
    let first = fixture.state();
    *first.website_dark_mode.write().unwrap() = Some(WebsiteDarkModeBootstrap {
        background_color: "#111111".into(),
        text_color: "#eeeeee".into(),
    });
    let proxy_url = first.network.proxy_url().unwrap();
    for destination in [HTTP, HTTPS, ORIGINAL] {
        let previous = fixture.state();
        let ticket = fixture.ticket(destination);
        let result = fixture.continue_to(&ticket).unwrap();
        assert_eq!(result.session_id, "same-session");
        assert_eq!(result.local_port, fixture.port);
        assert_eq!(result.proxy_url, proxy_url);
        assert_eq!(result.target_url, destination);
        assert_eq!(
            result.deferred_login_status,
            Some(DeferredSynologyLoginStatus::AwaitingNas)
        );
        let next = fixture.state();
        assert!(!previous.network.is_active());
        assert!(!previous.attempt.as_ref().unwrap().is_current());
        assert!(next.attempt.as_ref().unwrap().is_current());
        assert!(Arc::ptr_eq(
            &first.website_dark_mode,
            &next.website_dark_mode
        ));
        assert_eq!(
            next.website_dark_mode
                .read()
                .unwrap()
                .as_ref()
                .unwrap()
                .background_color,
            "#111111"
        );
        assert!(Arc::ptr_eq(&first.request_count, &next.request_count));
        assert_eq!(next.proxy_authority, first.proxy_authority);
        assert_eq!(next.network.selected_document_sequence(), None);
        assert!(crate::webview_origins::allows_frame_url(
            &result.navigation_url
        ));
        previous.network.revoke(); // stale shutdown cannot unregister successor
        assert!(crate::webview_origins::allows_frame_url(
            &result.navigation_url
        ));
        let issued_before = next.document_sequence.load(Ordering::SeqCst);
        previous.document_sequence.fetch_add(100, Ordering::SeqCst);
        assert_eq!(next.document_sequence.load(Ordering::SeqCst), issued_before);
        *previous.last_error.lock().unwrap() = Some("late source failure".into());
        assert!(next.last_error.lock().unwrap().is_none());
        // The existing listener remains bound and handles a protected request.
        // Exercise a local endpoint instead of sending any public NAS traffic.
        let response = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!(
                "http://127.0.0.1:{}/__sortofremoteng_network_v1",
                fixture.port
            ))
            .header("host", &next.proxy_authority)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::GONE); // old-page gate
                                                                  // Simulate the marked primary navigation at this unit seam. The next
                                                                  // test exercises the real request through the same listener end-to-end.
        fixture.runtime.0.write().unwrap().entry = None;
        assert!(fixture.continue_to(&ticket).is_err());
    }
    let manager = fixture.manager.lock().unwrap();
    let entry = manager.sessions.get("same-session").unwrap();
    assert_eq!(entry.created_at, "unchanged-created");
    assert_eq!(entry.connection_id, "saved-owner");
    assert!(entry.username.is_empty() && entry.password.is_empty());
}

#[tokio::test]
async fn failed_setup_wrong_ticket_and_nondefault_destinations_do_not_retarget() {
    let fixture = fixture().await;
    let first = fixture.state();
    assert!(fixture.continue_to("invented").is_err());
    let ticket = fixture.ticket(HTTP);
    let failed = fixture.manager.lock().unwrap().continue_synology_session(
        "same-session",
        &ticket,
        tls(),
        |_, _, _| Err("TLS setup rejected".into()),
    );
    assert!(failed.is_err());
    assert!(Arc::ptr_eq(&fixture.state(), &first));
    assert!(first.network.is_active() && first.attempt.as_ref().unwrap().is_current());
    assert!(fixture
        .manager
        .lock()
        .unwrap()
        .continue_synology_session("other-session", &ticket, tls(), |_, _, _| unreachable!())
        .is_err());
    fixture
        .manager
        .lock()
        .unwrap()
        .sessions
        .get_mut("same-session")
        .unwrap()
        .redirect_profile = None;
    assert!(fixture.continue_to(&ticket).is_err());
    fixture
        .manager
        .lock()
        .unwrap()
        .sessions
        .get_mut("same-session")
        .unwrap()
        .redirect_profile = Some(BrowserRedirectProfile::Synology);
    assert!(fixture
        .manager
        .lock()
        .unwrap()
        .attempts
        .prepare_transfer(
            first.attempt.as_ref().unwrap(),
            &Url::parse("https://other.quickconnect.to/").unwrap(),
            "forged"
        )
        .is_err());
    assert!(Arc::ptr_eq(&fixture.state(), &first));
    assert!(fixture.continue_to(&ticket).is_ok()); // failed setup did not spend ticket
}

#[tokio::test]
async fn selected_old_document_nonce_and_cookie_writes_cannot_act_on_successor() {
    let fixture = fixture().await;
    let first = fixture.state();
    first.document_sequence.store(7, Ordering::SeqCst);
    first.network.document_issued(7, true);
    let original = first.attempt.as_ref().unwrap();
    original.bind_deferred_login_document(&Url::parse(ORIGINAL).unwrap(), 7);
    let old_nonce = original.deferred_login_nonce(7).unwrap();
    *first.auto_login_nonce.write().unwrap() = Some("old-auto-nonce".into());
    *first.pending_nonce.write().unwrap() = Some("old-auth-nonce".into());
    original.cookie_store().set_cookies(
        &mut [&"sid=source; Path=/; Secure".parse().unwrap()].into_iter(),
        &Url::parse(ORIGINAL).unwrap(),
    );
    let ticket = fixture.ticket(HTTP);
    fixture.continue_to(&ticket).unwrap();
    let next = fixture.state();
    assert!(first.network.activate_document(7).is_err());
    assert!(next.network.activate_document(7).is_err());
    assert!(first.auto_login_nonce.read().unwrap().is_none());
    assert!(first.pending_nonce.read().unwrap().is_none());
    assert!(original
        .dispense_deferred_login(&first.network, &old_nonce, None)
        .is_err());
    assert_eq!(
        next.attempt.as_ref().unwrap().deferred_login_status(),
        Some(DeferredSynologyLoginStatus::AwaitingNas)
    );
    original.cookie_store().set_cookies(
        &mut [&"sid=stale; Path=/; Secure".parse().unwrap()].into_iter(),
        &Url::parse(ORIGINAL).unwrap(),
    );
    assert!(next
        .attempt
        .as_ref()
        .unwrap()
        .merged_request_cookies(&Url::parse(HTTP).unwrap(), &["sid=source"])
        .is_none());
    fixture.runtime.0.write().unwrap().entry = None;
    let ticket = fixture.ticket(ORIGINAL);
    fixture.continue_to(&ticket).unwrap();
    let returned = fixture.state();
    assert_eq!(
        returned
            .attempt
            .as_ref()
            .unwrap()
            .cookie_store()
            .cookies(&Url::parse(ORIGINAL).unwrap())
            .unwrap(),
        "sid=source"
    );
    assert_eq!(
        returned
            .attempt
            .as_ref()
            .unwrap()
            .merged_request_cookies(&Url::parse(ORIGINAL).unwrap(), &["sid=stale"])
            .unwrap(),
        "sid=source"
    );
    returned.network.document_issued(50, true);
    let resumed = returned.attempt.as_ref().unwrap();
    resumed.bind_deferred_login_document(&Url::parse(ORIGINAL).unwrap(), 50);
    assert!(resumed
        .dispense_deferred_login(&returned.network, &old_nonce, None)
        .is_err());
    let nonce = resumed.deferred_login_nonce(50).unwrap();
    let account = resumed
        .dispense_deferred_login(&returned.network, &nonce, None)
        .unwrap();
    assert_eq!(account["username"], "synthetic-user");
    let password = resumed
        .dispense_deferred_login(
            &returned.network,
            account["continuation"].as_str().unwrap(),
            Some("password"),
        )
        .unwrap();
    assert_eq!(password["password"], "synthetic-password");
}

#[tokio::test]
async fn retired_auth_request_cannot_overwrite_same_session_manager_credentials() {
    let fixture = fixture().await;
    let original = fixture.state();
    let ticket = fixture.ticket(HTTP);
    fixture.continue_to(&ticket).unwrap();
    // Model a previously admitted source request finishing its nonce check
    // after retarget. It may update its private snapshot, never the new entry.
    let mut retired = (*original).clone();
    retired.upstream_auth_mode = UpstreamAuthMode::Basic;
    *retired.pending_nonce.write().unwrap() = Some("previously-issued".into());
    let response = themed_auth_post_handler(
        State(Arc::new(retired)),
        axum::extract::Form(ThemedAuthForm {
            username: "stale-user".into(),
            password: "stale-password".into(),
            nonce: "previously-issued".into(),
            return_to: "/".into(),
        }),
    )
    .await;
    assert_eq!(response.status(), axum::http::StatusCode::GONE);
    let manager = fixture.manager.lock().unwrap();
    let entry = manager.sessions.get("same-session").unwrap();
    assert!(entry.username.is_empty() && entry.password.is_empty());
    assert!(fixture.state().username.read().unwrap().is_empty());
}

#[tokio::test]
async fn expired_ticket_or_source_navigation_after_review_leaves_source_unchanged() {
    for expired in [true, false] {
        let fixture = fixture().await;
        let source = fixture.state();
        let ticket = fixture.ticket(HTTP);
        if expired {
            fixture
                .manager
                .lock()
                .unwrap()
                .attempts
                .expire_ticket_for_test(&ticket);
        } else {
            source.document_sequence.fetch_add(1, Ordering::SeqCst);
        }
        assert!(fixture.continue_to(&ticket).is_err());
        assert!(Arc::ptr_eq(&source, &fixture.state()));
        assert!(source.network.is_active());
        assert!(source.attempt.as_ref().unwrap().is_current());
    }
}

#[tokio::test]
async fn tls_identity_change_isolates_origin_cookies_and_preserves_provider_jar() {
    let fixture = fixture().await;
    let source = fixture.state();
    let attempt = source.attempt.as_ref().unwrap();
    let provider = Url::parse("https://global.quickconnect.to/Serv.php").unwrap();
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "set-cookie",
        "control=provider; Domain=quickconnect.to; Path=/; Secure"
            .parse()
            .unwrap(),
    );
    attempt
        .store_provider_control_cookies("example", &provider, &headers)
        .unwrap();
    attempt.cookie_store().set_cookies(
        &mut [&"sid=original-identity; Path=/; Secure".parse().unwrap()].into_iter(),
        &Url::parse(ORIGINAL).unwrap(),
    );
    let ticket = fixture.ticket(HTTP);
    fixture.continue_to(&ticket).unwrap();
    fixture.runtime.0.write().unwrap().entry = None;
    let ticket = fixture.ticket(ORIGINAL);
    let identity = SynologyProxyTls {
        verify_ssl: false,
        accepted_cert_fingerprint: Some("ab".repeat(32)),
        require_ca_verification: false,
    };
    fixture
        .manager
        .lock()
        .unwrap()
        .continue_synology_session("same-session", &ticket, identity, |_, _, successor| {
            Ok(reqwest::Client::builder()
                .no_proxy()
                .cookie_provider(successor.cookie_store())
                .build()
                .unwrap())
        })
        .unwrap();
    let current = fixture.state();
    let successor = current.attempt.as_ref().unwrap();
    assert!(successor
        .cookie_store()
        .cookies(&Url::parse(ORIGINAL).unwrap())
        .is_none());
    assert_eq!(
        successor
            .provider_control_cookie_header("example", &provider)
            .unwrap()
            .unwrap(),
        "control=provider"
    );
    assert!(attempt
        .store_provider_control_cookies("example", &provider, &headers)
        .is_err());
    assert!(successor
        .merged_request_cookies(&Url::parse(ORIGINAL).unwrap(), &["sid=original-identity"])
        .is_none());
}

#[tokio::test]
async fn marked_primary_navigation_uses_existing_listener_and_cancels_old_inflight_work() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let fixture = fixture().await;
    let source = fixture.state();
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let route = format!("http://{}", upstream.local_addr().unwrap());
    let upstream_task = tokio::spawn(async move {
        let (mut socket, _) = upstream.accept().await.unwrap();
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            head.push(socket.read_u8().await.unwrap());
        }
        let head = String::from_utf8(head).unwrap();
        assert!(head.starts_with("GET http://example.quickconnect.to/webman/index.cgi HTTP/1.1"));
        assert!(!head.contains("__sorng_navigation_v1"));
        assert!(!head.to_ascii_lowercase().contains("cookie:"));
        let body = "<!doctype html><html><body>destination page</body></html>";
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
    });
    let ticket =
        fixture.ticket("http://example.quickconnect.to/webman/index.cgi?removed=private#removed");
    let watcher = source.network.clone();
    let pending =
        tokio::spawn(async move { watcher.while_active(std::future::pending::<()>()).await });
    tokio::task::yield_now().await;
    let result = fixture
        .manager
        .lock()
        .unwrap()
        .continue_synology_session("same-session", &ticket, tls(), |_, _, successor| {
            Ok(reqwest::Client::builder()
                .no_proxy()
                .proxy(reqwest::Proxy::all(&route).unwrap())
                .cookie_provider(successor.cookie_store())
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap())
        })
        .unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(1), pending)
            .await
            .unwrap()
            .unwrap()
            .is_err()
    );
    assert_eq!(
        result.target_url,
        "http://example.quickconnect.to/webman/index.cgi"
    );
    let response = fixture.open(&result).await;
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert!(response.text().await.unwrap().contains("destination page"));
    upstream_task.await.unwrap();
    assert!(fixture
        .state()
        .network
        .selected_document_sequence()
        .is_some());
    assert_eq!(fixture.port, result.local_port);
}

#[derive(Debug)]
struct UpstreamRequest {
    method: axum::http::Method,
    uri: String,
    headers: axum::http::HeaderMap,
    body: Vec<u8>,
}

struct RecordingUpstream {
    route: String,
    requests: Arc<Mutex<Vec<UpstreamRequest>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for RecordingUpstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl RecordingUpstream {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let route = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let records = requests.clone();
        let router = axum::Router::new().fallback(move |request: Request| {
            let records = records.clone();
            async move {
                let (parts, body) = request.into_parts();
                let body = axum::body::to_bytes(body, 65536).await.unwrap();
                let (content_type, body_text) = match parts.uri.path() {
                    "/site.css" => ("text/css", "body{background:url('/image.png')}"),
                    "/image.png" => ("image/png", "synthetic image"),
                    "/app.js" => ("application/javascript", "window.successor=true;"),
                    "/api" => ("application/json", "{\"success\":true}"),
                    _ => ("text/html", "<!doctype html><html><head><link rel=stylesheet href='/site.css'></head><body>successor<script src='/app.js'></script></body></html>"),
                };
                records.lock().unwrap().push(UpstreamRequest {
                    method: parts.method, uri: parts.uri.to_string(), headers: parts.headers, body: body.to_vec(),
                });
                axum::http::Response::builder().header("content-type", content_type)
                    .body(axum::body::Body::from(body_text)).unwrap()
            }
        });
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self {
            route,
            requests,
            task,
        }
    }

    fn continue_to(&self, fixture: &Fixture, destination: &str) -> SynologyProxyContinuation {
        let ticket = fixture.ticket(destination);
        fixture
            .manager
            .lock()
            .unwrap()
            .continue_synology_session("same-session", &ticket, tls(), |_, _, successor| {
                Ok(reqwest::Client::builder()
                    .no_proxy()
                    .proxy(reqwest::Proxy::all(&self.route).unwrap())
                    .cookie_provider(successor.cookie_store())
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .unwrap())
            })
            .unwrap()
    }
}

fn local_request(
    fixture: &Fixture,
    method: reqwest::Method,
    path: &str,
) -> reqwest::RequestBuilder {
    let origin = fixture.state().proxy_origin.clone();
    let path = path.strip_prefix(&origin).unwrap_or(path);
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
        .request(method, format!("http://127.0.0.1:{}{path}", fixture.port))
        .header("host", &fixture.state().proxy_authority)
        .header("origin", &fixture.state().proxy_origin)
}

#[tokio::test]
async fn delayed_source_posts_and_authorization_never_reach_successor_after_entry_opens() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let fixture = fixture().await;
    let upstream = RecordingUpstream::start().await;
    let source_referrer = format!("{}/webman/index.cgi", fixture.state().proxy_origin);
    // Queue a source request and establish its connection before the swap, but
    // deliver the POST/body only after the successor document has been served.
    let delayed = local_request(&fixture, reqwest::Method::POST, "/api")
        .header("referer", &source_referrer)
        .header("authorization", "Bearer retired-source-secret")
        .header("cookie", "sid=retired-source")
        .body("retired-source-password=secret");
    let mut source_socket = tokio::net::TcpStream::connect(("127.0.0.1", fixture.port))
        .await
        .unwrap();
    let result = upstream.continue_to(&fixture, HTTP);
    assert_eq!(
        local_request(&fixture, reqwest::Method::GET, &result.navigation_url)
            .body("not-a-navigation-body")
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::GONE
    );
    assert!(fixture.runtime.0.read().unwrap().entry.is_some());
    assert_eq!(
        local_request(&fixture, reqwest::Method::GET, &result.navigation_url)
            .header("authorization", "Basic c291cmNlOmNhY2hlZA==")
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::OK
    );
    assert!(fixture.runtime.0.read().unwrap().entry.is_none());
    assert_eq!(
        delayed.send().await.unwrap().status(),
        reqwest::StatusCode::GONE
    );

    let body = "password=delayed-keepalive-secret";
    let wire = format!("POST /api HTTP/1.1\r\nHost: {}\r\nOrigin: {}\r\nReferer: {source_referrer}\r\nAuthorization: Basic c3RhbGU6c2VjcmV0\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", fixture.state().proxy_authority, fixture.state().proxy_origin, body.len());
    source_socket.write_all(wire.as_bytes()).await.unwrap();
    let mut response = [0u8; 1024];
    let count = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        source_socket.read(&mut response),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(String::from_utf8_lossy(&response[..count]).starts_with("HTTP/1.1 410"));

    let mut incomplete = tokio::net::TcpStream::connect(("127.0.0.1", fixture.port))
        .await
        .unwrap();
    let head = format!("POST /api HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer stale\r\nContent-Length: 8192\r\nConnection: close\r\n\r\n", fixture.state().proxy_authority);
    incomplete.write_all(head.as_bytes()).await.unwrap();
    let count = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        incomplete.read(&mut response),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        String::from_utf8_lossy(&response[..count]).starts_with("HTTP/1.1 410"),
        "must reject without waiting for the stale body"
    );

    for method in [
        reqwest::Method::GET,
        reqwest::Method::POST,
        reqwest::Method::PUT,
    ] {
        for referrer in [
            None,
            Some(source_referrer.as_str()),
            Some(fixture.state().proxy_origin.as_str()),
        ] {
            let mut request = local_request(&fixture, method.clone(), "/api")
                .header("authorization", "Bearer retired-source-secret");
            if let Some(value) = referrer {
                request = request.header("referer", value);
            }
            assert_eq!(
                request.send().await.unwrap().status(),
                reqwest::StatusCode::GONE
            );
        }
    }
    let records = upstream.requests.lock().unwrap();
    assert_eq!(
        records.len(),
        1,
        "only the reviewed primary GET may reach upstream: {records:?}"
    );
    assert!(records[0].body.is_empty());
    assert!(records[0].headers.get("authorization").is_none());
}

#[tokio::test]
async fn successor_parser_assets_nested_css_and_authenticated_posts_remain_in_generation() {
    let fixture = fixture().await;
    let upstream = RecordingUpstream::start().await;
    let result = upstream.continue_to(&fixture, HTTP);
    let response = fixture.open(&result).await;
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["referrer-policy"], "same-origin");
    let html = response.text().await.unwrap();
    assert!(
        html.find("history.replaceState(history.state,'',stamp(location.href))")
            .unwrap()
            < html.find("var p={").unwrap(),
        "generation bootstrap must precede readiness and vendor scripts"
    );

    let token = &result.navigation_token;
    // Parser loads before the bootstrap executes use the exact marked entry
    // referrer. Their local redirect stamps the CSS URL for its nested images.
    let css = local_request(&fixture, reqwest::Method::GET, "/site.css")
        .header("referer", &result.navigation_url)
        .header("sec-fetch-dest", "style")
        .send()
        .await
        .unwrap();
    assert_eq!(css.status(), reqwest::StatusCode::TEMPORARY_REDIRECT);
    let css_path = css.headers()["location"].to_str().unwrap();
    assert_eq!(
        css_path,
        format!(
            "{}/site.css?{GENERATION_MARKER}={token}",
            fixture.state().proxy_origin
        )
    );
    assert_eq!(
        upstream.requests.lock().unwrap().len(),
        1,
        "stamping redirect is local"
    );
    let response = local_request(&fixture, reqwest::Method::GET, css_path)
        .header("referer", &result.navigation_url)
        .header("sec-fetch-dest", "style")
        .send()
        .await
        .unwrap();
    assert!(response.text().await.unwrap().contains("/image.png"));

    let image = local_request(&fixture, reqwest::Method::GET, "/image.png")
        .header("referer", css_path)
        .header("sec-fetch-dest", "image")
        .send()
        .await
        .unwrap();
    assert_eq!(image.status(), reqwest::StatusCode::TEMPORARY_REDIRECT);
    let image = local_request(
        &fixture,
        reqwest::Method::GET,
        image.headers()["location"].to_str().unwrap(),
    )
    .header("referer", css_path)
    .header("sec-fetch-dest", "image")
    .send()
    .await
    .unwrap();
    assert_eq!(image.text().await.unwrap(), "synthetic image");
    // Native-served routing adds the immutable generation to JS fetch/XHR and
    // socket URLs, including a request that explicitly suppresses its referrer.
    let response = local_request(
        &fixture,
        reqwest::Method::GET,
        &format!("/app.js?{GENERATION_MARKER}={token}"),
    )
    .header("sec-fetch-dest", "script")
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let response = local_request(
        &fixture,
        reqwest::Method::POST,
        &format!("/api?name=a%2Fb+z&{GENERATION_MARKER}={token}"),
    )
    .header("authorization", "Bearer successor-secret")
    .body("successor-body")
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    // Browser-native form POSTs can prove their generation via their referrer.
    let response = local_request(&fixture, reqwest::Method::POST, "/api")
        .header(
            "referer",
            format!(
                "{}/?{GENERATION_MARKER}={token}",
                fixture.state().proxy_origin
            ),
        )
        .body("successor-form")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let records = upstream.requests.lock().unwrap();
    assert_eq!(records.len(), 6, "{records:?}");
    assert_eq!(records[4].method, reqwest::Method::POST);
    assert_eq!(
        records[4].uri,
        "http://example.quickconnect.to/api?name=a%2Fb+z"
    );
    assert_eq!(
        records[4].headers["authorization"],
        "Bearer successor-secret"
    );
    assert_eq!(records[4].body, b"successor-body");
    assert_eq!(records[5].body, b"successor-form");
    for request in records.iter() {
        assert!(!request.uri.contains("__sorng_"));
        assert!(!format!("{:?}", request.headers).contains(token));
    }
}

#[tokio::test]
async fn old_generation_and_ambiguous_proofs_are_rejected_after_a_second_swap() {
    let fixture = fixture().await;
    let upstream = RecordingUpstream::start().await;
    let first = upstream.continue_to(&fixture, HTTP);
    assert_eq!(fixture.open(&first).await.status(), reqwest::StatusCode::OK);
    // The second hop is HTTPS. Its exact marked entry exercises a bundled
    // local resource, so this admission test needs no TLS bypass/public DNS.
    let second = upstream.continue_to(
        &fixture,
        &format!(
            "https://example.quickconnect.to{}",
            web_automation::DARKREADER_PATH
        ),
    );
    assert_eq!(
        fixture.open(&second).await.status(),
        reqwest::StatusCode::OK
    );
    let old = &first.navigation_token;
    let current = &second.navigation_token;
    assert_ne!(old, current);
    for query in [
        format!("{GENERATION_MARKER}={old}"),
        format!("{GENERATION_MARKER}={current}&{GENERATION_MARKER}={old}"),
        format!("{GENERATION_MARKER}={current}&{GENERATION_MARKER}={current}"),
        format!("__sorng_%67eneration_v1={current}"),
        format!("{GENERATION_MARKER}=invalid"),
    ] {
        let response = local_request(&fixture, reqwest::Method::POST, &format!("/api?{query}"))
            .header("referer", &second.navigation_url)
            .header("authorization", "Bearer stale-secret")
            .body("stale-body")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::GONE, "{query}");
    }
    for referrer in [
        first.navigation_url,
        format!(
            "{}/?{GENERATION_MARKER}={old}",
            fixture.state().proxy_origin
        ),
        format!("https://foreign.example/?{GENERATION_MARKER}={current}"),
        format!(
            "{}/?{GENERATION_MARKER}={current}&{GENERATION_MARKER}={current}",
            fixture.state().proxy_origin
        ),
    ] {
        let response = local_request(
            &fixture,
            reqwest::Method::POST,
            &format!("/api?{GENERATION_MARKER}={current}"),
        )
        .header("referer", referrer)
        .header("authorization", "Bearer stale-secret")
        .body("stale-body")
        .send()
        .await
        .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::GONE);
    }
    assert_eq!(upstream.requests.lock().unwrap().len(), 1);
    assert_eq!(
        local_request(
            &fixture,
            reqwest::Method::GET,
            &format!(
                "{}?{GENERATION_MARKER}={current}",
                web_automation::DARKREADER_PATH
            )
        )
        .send()
        .await
        .unwrap()
        .status(),
        reqwest::StatusCode::OK
    );
    assert_eq!(upstream.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn resource_generation_redirect_never_becomes_a_foreign_scheme_relative_url() {
    let fixture = fixture().await;
    let upstream = RecordingUpstream::start().await;
    let result = upstream.continue_to(&fixture, HTTP);
    assert_eq!(
        fixture.open(&result).await.status(),
        reqwest::StatusCode::OK
    );
    let response = local_request(
        &fixture,
        reqwest::Method::GET,
        "//foreign.example/asset.css",
    )
    .header("referer", &result.navigation_url)
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::TEMPORARY_REDIRECT);
    let destination = Url::parse(response.headers()["location"].to_str().unwrap()).unwrap();
    assert_eq!(
        destination.origin().ascii_serialization(),
        fixture.state().proxy_origin
    );
    assert_eq!(destination.path(), "//foreign.example/asset.css");
    assert_eq!(upstream.requests.lock().unwrap().len(), 1);
}
