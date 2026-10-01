use super::*;
use crate::themed_autologin::AutoLoginQuery;
use axum::body::Body;
use axum::http::{header, Request};
use reqwest::{ResponseBuilderExt, Url};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use tokio::net::TcpListener;

const PRIMARY_PROXY: &str = "http://p11111111111111111111111111111111.localhost:43123";

// Representative engine identities are test inputs, never production defaults.
// Exercise the real Google sender against a loopback CONNECT/TLS peer: the
// accounts.google.com authority below is never resolved or contacted publicly.
async fn assert_native_accounts_identity(user_agent: &str, hints: &[(&str, &str)]) {
    use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

    async fn read_head(stream: &mut (impl AsyncRead + Unpin)) -> String {
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            assert!(
                bytes.len() < 16_384,
                "fixture request headers exceeded limit"
            );
            bytes.push(stream.read_u8().await.unwrap());
        }
        String::from_utf8(bytes).unwrap()
    }

    let cert = rcgen::generate_simple_self_signed(vec!["accounts.google.com".into()]).unwrap();
    let der = cert.serialize_der().unwrap();
    let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![rustls::pki_types::CertificateDer::from(der.clone())],
        rustls::pki_types::PrivatePkcs8KeyDer::from(cert.serialize_private_key_der()).into(),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://{}", listener.local_addr().unwrap())).unwrap())
        .add_root_certificate(reqwest::Certificate::from_der(&der).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();
    let peer = tokio::spawn(async move {
        let mut captured = Vec::new();
        for _ in 0..2 {
            let (mut tcp, _) = listener.accept().await.unwrap();
            let connect = read_head(&mut tcp).await;
            assert!(connect.starts_with("CONNECT accounts.google.com:443 HTTP/1.1\r\n"));
            tcp.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
            let mut socket = acceptor.accept(tcp).await.unwrap();
            let head = read_head(&mut socket).await;
            let length = head
                .lines()
                .filter_map(|line| line.split_once(':'))
                .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                .map_or(0, |(_, value)| value.trim().parse::<usize>().unwrap());
            assert!(length < 1024);
            let mut body = vec![0; length];
            socket.read_exact(&mut body).await.unwrap();
            captured.push((head, body));
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
                .await
                .unwrap();
        }
        captured
    });
    let session = google::GoogleSession::new(
        Some(ReviewedApplicationProfile::GoogleHosted),
        &Url::parse("https://analytics.google.com/").unwrap(),
        PRIMARY_PROXY,
        upstream.clone(),
        upstream,
    )
    .unwrap()
    .unwrap();
    let account = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://accounts.google.com")
        .unwrap();
    let mut base = state("https://analytics.google.com");
    Arc::get_mut(&mut base)
        .unwrap()
        .custom_headers
        .insert("User-Agent".into(), "stale-custom-override/1".into());
    let stages = [
        (reqwest::Method::GET, "/ServiceLogin", &b""[..]),
        (
            reqwest::Method::POST,
            "/v3/signin/challenge/pwd",
            &b"fixture=password-stage-no-credentials"[..],
        ),
    ];
    for (method, path, body) in &stages {
        let mut request = Request::builder()
            .method(method.as_str())
            .uri(*path)
            .header(
                header::HOST,
                account.proxy_origin.trim_start_matches("http://"),
            )
            .header(header::USER_AGENT, user_agent)
            .header(
                "sec-fetch-dest",
                if *method == reqwest::Method::GET {
                    "iframe"
                } else {
                    "empty"
                },
            )
            .header(
                "sec-fetch-mode",
                if *method == reqwest::Method::GET {
                    "navigate"
                } else {
                    "cors"
                },
            );
        if *method == reqwest::Method::POST {
            request = request
                .header(header::ORIGIN, &account.proxy_origin)
                .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded");
        }
        for &(name, value) in hints {
            request = request.header(name, value);
        }
        let request = request.body(Body::empty()).unwrap();
        let scoped = session.request_state(&base, &request).unwrap();
        assert!(
            scoped.custom_headers.is_empty(),
            "saved identity overrides must not reach Google"
        );
        let forwarded = session.request_headers(request.headers(), &scoped.target_origin);
        let url = Url::parse(&format!("{}{path}", scoped.target_origin)).unwrap();
        let response = session
            .send(method, &url, &forwarded, body, true)
            .await
            .unwrap_or_else(|_| panic!("local native-identity request failed"));
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert_eq!(response.text().await.unwrap(), "OK");
    }
    let captured = tokio::time::timeout(std::time::Duration::from_secs(5), peer)
        .await
        .unwrap()
        .unwrap();
    for ((head, body), (method, path, expected_body)) in captured.iter().zip(&stages) {
        assert!(head.starts_with(&format!("{method} {path} HTTP/1.1\r\n")));
        let fields: Vec<_> = head
            .lines()
            .filter_map(|line| line.split_once(':'))
            .collect();
        let agents: Vec<_> = fields
            .iter()
            .filter(|(name, _)| name.eq_ignore_ascii_case("user-agent"))
            .map(|(_, value)| value.trim())
            .collect();
        assert_eq!(
            agents,
            [user_agent],
            "native identity changed between login stages"
        );
        let actual_hints: BTreeMap<_, _> = fields
            .iter()
            .filter(|(name, _)| name.to_ascii_lowercase().starts_with("sec-ch-ua"))
            .map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_string()))
            .collect();
        let expected_hints: BTreeMap<_, _> = hints
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .collect();
        assert_eq!(
            actual_hints, expected_hints,
            "do not invent or alter engine client hints"
        );
        assert!(!head.contains("stale-custom-override"));
        assert!(!fields.iter().any(|(name, _)| matches!(
            name.to_ascii_lowercase().as_str(),
            "authorization" | "proxy-authorization" | "cookie"
        )));
        assert_eq!(body.as_slice(), *expected_body);
    }
}

#[tokio::test]
async fn accounts_native_identity_windows_webview2_navigation_and_password_post() {
    assert_native_accounts_identity(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0",
        &[
            ("sec-ch-ua", "\"Microsoft Edge\";v=\"146\", \"Chromium\";v=\"146\", \"Not_A Brand\";v=\"99\""),
            ("sec-ch-ua-mobile", "?0"),
            ("sec-ch-ua-platform", "\"Windows\""),
            ("sec-ch-ua-full-version-list", "\"Microsoft Edge\";v=\"146.0.3856.59\", \"Chromium\";v=\"146.0.7680.80\", \"Not_A Brand\";v=\"99.0.0.0\""),
        ],
    ).await;
}

#[tokio::test]
async fn accounts_native_identity_linux_webkitgtk_navigation_and_password_post() {
    assert_native_accounts_identity(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15",
        &[],
    ).await;
}

#[tokio::test]
async fn accounts_native_identity_macos_wkwebview_navigation_and_password_post() {
    assert_native_accounts_identity(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
        &[],
    )
    .await;
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap()
}

fn session(source: &str) -> google::GoogleSession {
    google::GoogleSession::new(
        Some(ReviewedApplicationProfile::GoogleHosted),
        &Url::parse(source).unwrap(),
        PRIMARY_PROXY,
        client(),
        client(),
    )
    .unwrap()
    .unwrap()
}

fn expected_routes(source: &str, extras: &[(&str, bool)]) -> BTreeMap<String, bool> {
    let mut expected = BTreeMap::from([
        (source.to_string(), true),
        ("https://accounts.google.com".into(), true),
        ("https://www.google.com".into(), true),
        ("https://www.gstatic.com".into(), false),
        ("https://ssl.gstatic.com".into(), false),
        ("https://fonts.gstatic.com".into(), false),
        ("https://fonts.googleapis.com".into(), false),
        ("https://apis.google.com".into(), false),
    ]);
    expected.extend(
        extras
            .iter()
            .map(|(origin, documents)| ((*origin).to_string(), *documents)),
    );
    expected
}

fn state(target_origin: &str) -> Arc<AxumProxyState> {
    let mut policy = HttpProxyPolicy::default();
    policy.query_parameters.push(proxy_policy::QueryParameter {
        name: "connection-secret".into(),
        value: "must-not-cross-origin".into(),
    });
    Arc::new(AxumProxyState {
        attempt: None,
        network: Arc::new(ProxyNetworkState::default()),
        website_dark_mode: Default::default(),
        session_id: "google-routing-test".into(),
        connection_id: "saved-connection".into(),
        target_url: format!("{target_origin}/"),
        username: Arc::new(std::sync::RwLock::new("saved-user".into())),
        password: Arc::new(std::sync::RwLock::new("saved-password".into())),
        upstream_auth_mode: UpstreamAuthMode::GoogleForm,
        proxy_policy: policy,
        redirect_profile: None,
        tactical_rmm_api: None,
        custom_headers: HashMap::from([(
            "x-connection-secret".into(),
            "must-not-cross-origin".into(),
        )]),
        pending_nonce: Default::default(),
        theme: Arc::new(std::sync::RwLock::new(
            crate::theme_tokens::ThemeTokens::dark_default(),
        )),
        target_origin: target_origin.into(),
        proxy_authority: PRIMARY_PROXY.trim_start_matches("http://").into(),
        proxy_origin: PRIMARY_PROXY.into(),
        auto_login_armed: Arc::new(AtomicBool::new(true)),
        auto_login_nonce: Default::default(),
        bitwarden_continuation: Default::default(),
        auto_login_selectors: None,
        http_form_automation: None,
        yealink_session: yealink_login::session_slot(),
        client: client(),
        document_sequence: Arc::new(AtomicU64::new(0)),
        request_count: Arc::new(AtomicU64::new(0)),
        error_count: Arc::new(AtomicU64::new(0)),
        last_error: Default::default(),
        global_sessions: ProxySessionManager::new(),
        credentials_applied: None,
    })
}

fn activate(state: &Arc<AxumProxyState>) {
    state.global_sessions.lock().unwrap().sessions.insert(
        state.session_id.clone(),
        ProxySessionEntry {
            runtime: Default::default(),
            attempt: state.attempt.clone(),
            network: state.network.clone(),
            website_dark_mode: state.website_dark_mode.clone(),
            target_url: state.target_url.clone(),
            username: "saved-user".into(),
            password: "saved-password".into(),
            upstream_auth_mode: UpstreamAuthMode::GoogleForm,
            proxy_policy: state.proxy_policy.clone(),
            redirect_profile: None,
            reviewed_application_profile: Some(ReviewedApplicationProfile::GoogleHosted),
            reviewed_application_api_origin: None,
            reviewed_application_mesh_origin: None,
            custom_headers: HashMap::new(),
            upstream_proxy_url: None,
            target_origin: state.target_origin.clone(),
            connection_id: state.connection_id.clone(),
            created_at: String::new(),
            local_port: 43123,
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
}

fn request_for(route: &google::GoogleProxyRoute, path: &str) -> Request<Body> {
    let local = Url::parse(&route.proxy_origin).unwrap();
    Request::builder()
        .uri(path)
        .header(
            header::HOST,
            format!("{}:{}", local.host_str().unwrap(), local.port().unwrap()),
        )
        .header(header::ORIGIN, PRIMARY_PROXY)
        .header("sec-fetch-dest", "document")
        .body(Body::empty())
        .unwrap()
}

fn adobe_session() -> google::GoogleSession {
    google::GoogleSession::new(
        Some(ReviewedApplicationProfile::AdobeAdminConsole),
        &Url::parse("https://adminconsole.adobe.com/").unwrap(),
        PRIMARY_PROXY,
        client(),
        client(),
    )
    .unwrap()
    .unwrap()
}

fn ai_chat_fixture(claude: bool) -> Arc<AxumProxyState> {
    let (origin, mode, profile) = if claude {
        (
            "https://claude.ai",
            UpstreamAuthMode::ClaudeForm,
            ReviewedApplicationProfile::Claude,
        )
    } else {
        (
            "https://chatgpt.com",
            UpstreamAuthMode::ChatgptForm,
            ReviewedApplicationProfile::Chatgpt,
        )
    };
    let hosted = google::GoogleSession::new(
        Some(profile),
        &Url::parse(origin).unwrap(),
        PRIMARY_PROXY,
        client(),
        client(),
    )
    .unwrap()
    .unwrap();
    let mut root = state(origin);
    let inner = Arc::get_mut(&mut root).unwrap();
    inner.upstream_auth_mode = mode;
    inner.network = Arc::new(ProxyNetworkState::default().with_google_routes(Some(hosted)));
    if claude {
        inner.password.write().unwrap().clear();
    }
    activate(&root);
    let mut sessions = root.global_sessions.lock().unwrap();
    let entry = sessions.sessions.get_mut(&root.session_id).unwrap();
    entry.upstream_auth_mode = mode;
    entry.reviewed_application_profile = Some(profile);
    if claude {
        entry.password.clear();
    }
    drop(sessions);
    root
}

fn ai_chat_scope(root: &Arc<AxumProxyState>, origin: &str) -> Arc<AxumProxyState> {
    let hosted = root.network.google.as_ref().unwrap();
    let route = hosted
        .routes
        .iter()
        .find(|route| route.upstream_origin == origin)
        .unwrap();
    let scoped = hosted
        .request_state(root, &request_for(route, AUTOLOGIN_PATH))
        .unwrap();
    // Regression: routed requests carry the origin root, not the sign-in URL.
    assert_eq!(scoped.target_url, format!("{origin}/"));
    scoped
}

fn ai_chat_nonce(state: &Arc<AxumProxyState>, sequence: u64, url: &str) -> String {
    state.document_sequence.store(sequence, Ordering::SeqCst);
    state.network.document_issued(sequence, sequence == 1);
    let script = crate::themed_autologin::build_autologin_injection(state, sequence, url).unwrap();
    assert!(!script.contains("saved-user"));
    assert!(!script.contains("saved-password"));
    script
        .split_once("var NONCE=\"")
        .unwrap()
        .1
        .split('"')
        .next()
        .unwrap()
        .into()
}

async fn ai_chat_body(response: axum::response::Response) -> serde_json::Value {
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn ai_chat_routed_endpoint_redeems_native_auth_document_and_spa_continuation_once() {
    let root = ai_chat_fixture(false);
    let auth = ai_chat_scope(&root, "https://auth.openai.com");
    let nonce = ai_chat_nonce(&auth, 1, "https://auth.openai.com/log-in");
    let email = ai_chat_body(adobe_redeem(&auth, &nonce, None).await).await;
    assert_eq!(email["username"], "saved-user");
    assert!(email.get("password").is_none());
    assert_eq!(adobe_redeem(&auth, &nonce, None).await.status(), 403);
    let token = email["continuation"].as_str().unwrap();
    let password = ai_chat_body(adobe_redeem(&auth, token, Some("password")).await).await;
    assert_eq!(
        password,
        serde_json::json!({
            "loginFlow":"chatgpt", "username":"saved-user", "password":"saved-password"
        })
    );
    assert_eq!(
        adobe_redeem(&auth, token, Some("password")).await.status(),
        403
    );
}

#[tokio::test]
async fn ai_chat_routed_source_requires_selected_auth_password_document_and_its_own_nonce() {
    let root = ai_chat_fixture(false);
    let source = ai_chat_scope(&root, "https://chatgpt.com");
    let auth = ai_chat_scope(&root, "https://auth.openai.com");
    let nonce = ai_chat_nonce(&source, 1, "https://chatgpt.com/auth/login");
    let email = ai_chat_body(adobe_redeem(&source, &nonce, None).await).await;
    let token = email["continuation"].as_str().unwrap();
    assert_eq!(
        adobe_redeem(&source, token, Some("password"))
            .await
            .status(),
        403
    );
    assert_eq!(
        adobe_redeem(&auth, token, Some("password")).await.status(),
        403
    );
    let next = ai_chat_nonce(&auth, 2, "https://auth.openai.com/log-in/password");
    assert_eq!(
        adobe_redeem(&auth, &next, Some("password")).await.status(),
        403
    );
    auth.network.activate_document(2).unwrap();
    assert_eq!(
        adobe_redeem(&auth, token, Some("password")).await.status(),
        403
    );
    assert_eq!(
        adobe_redeem(&source, &next, Some("password"))
            .await
            .status(),
        403
    );
    let password = ai_chat_body(adobe_redeem(&auth, &next, Some("password")).await).await;
    assert_eq!(password["username"], "saved-user");
    assert_eq!(password["password"], "saved-password");
}

#[tokio::test]
async fn ai_chat_routed_claude_is_email_only_without_password_or_continuation() {
    let root = ai_chat_fixture(true);
    let source = ai_chat_scope(&root, "https://claude.ai");
    let nonce = ai_chat_nonce(&source, 1, "https://claude.ai/login");
    assert_eq!(
        adobe_redeem(&source, &nonce, Some("password"))
            .await
            .status(),
        403
    );
    let email = ai_chat_body(adobe_redeem(&source, &nonce, None).await).await;
    assert_eq!(
        email,
        serde_json::json!({"loginFlow":"claude", "username":"saved-user"})
    );
    assert_eq!(adobe_redeem(&source, &nonce, None).await.status(), 403);
    assert_eq!(
        adobe_redeem(&source, &nonce, Some("password"))
            .await
            .status(),
        403
    );
    source.network.document_issued(2, false);
    assert!(crate::themed_autologin::build_autologin_injection(
        &source,
        2,
        "https://claude.ai/login"
    )
    .is_none());
}

#[tokio::test]
async fn ai_chat_routed_grants_reject_revoked_owner_document_and_provider() {
    for revoke in ["document", "network", "session", "provider"] {
        let root = ai_chat_fixture(false);
        let auth = ai_chat_scope(&root, "https://auth.openai.com");
        let nonce = ai_chat_nonce(&auth, 1, "https://auth.openai.com/log-in");
        let email = ai_chat_body(adobe_redeem(&auth, &nonce, None).await).await;
        match revoke {
            "document" => {
                auth.network.document_issued(2, false);
                auth.network.activate_document(2).unwrap();
            }
            "network" => auth.network.revoke(),
            "session" => auth.global_sessions.lock().unwrap().sessions.clear(),
            "provider" => {
                auth.global_sessions
                    .lock()
                    .unwrap()
                    .sessions
                    .get_mut(&auth.session_id)
                    .unwrap()
                    .reviewed_application_profile = Some(ReviewedApplicationProfile::Claude);
            }
            _ => unreachable!(),
        }
        assert_eq!(
            adobe_redeem(
                &auth,
                email["continuation"].as_str().unwrap(),
                Some("password")
            )
            .await
            .status(),
            403,
            "{revoke}"
        );
    }
}

#[test]
fn ai_hosted_routes_do_not_promote_challenges_or_other_providers_into_credential_origins() {
    for (profile, mode, source, credential_origins) in [
        (
            ReviewedApplicationProfile::Chatgpt,
            UpstreamAuthMode::ChatgptForm,
            "https://chatgpt.com",
            vec!["https://chatgpt.com", "https://auth.openai.com"],
        ),
        (
            ReviewedApplicationProfile::Claude,
            UpstreamAuthMode::ClaudeForm,
            "https://claude.ai",
            vec!["https://claude.ai"],
        ),
    ] {
        assert!(google::GoogleSession::supports(Some(profile)));
        assert!(mode.authorization_value("fixture", "never-basic").is_none());
        let session = google::GoogleSession::new(
            Some(profile),
            &Url::parse(source).unwrap(),
            PRIMARY_PROXY,
            client(),
            client(),
        )
        .unwrap()
        .unwrap();
        let mut base = state(source);
        Arc::get_mut(&mut base).unwrap().upstream_auth_mode = mode;
        for route in &session.routes {
            let allowed = credential_origins.contains(&route.upstream_origin.as_str());
            assert_eq!(
                session.allows_autologin(&route.upstream_origin, mode),
                allowed
            );
            let request = request_for(route, AUTOLOGIN_PATH);
            assert_eq!(session.request_state(&base, &request).is_ok(), allowed);
            assert!(!session.allows_autologin(&route.upstream_origin, UpstreamAuthMode::None));
            assert!(!session.allows_autologin(&route.upstream_origin, UpstreamAuthMode::GoogleForm));
        }
        let challenge = session
            .routes
            .iter()
            .find(|r| r.upstream_origin == "https://challenges.cloudflare.com")
            .unwrap();
        let scoped = session
            .request_state(&base, &request_for(challenge, "/turnstile/frame"))
            .unwrap();
        assert_eq!(scoped.upstream_auth_mode, UpstreamAuthMode::None);
        assert!(session
            .request_state(&base, &request_for(challenge, "/__sortofremoteng_autototp"))
            .is_err());
        for origin in [
            "https://accounts.google.com",
            "https://www.facebook.com",
            "https://auth.services.adobe.com",
            "https://login.microsoftonline.com",
        ] {
            assert!(session.map_url(&Url::parse(origin).unwrap()).is_none());
        }
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            header::SET_COOKIE,
            "session=fixture; Secure; HttpOnly; Path=/".parse().unwrap(),
        );
        session
            .observe_cookies(&headers, &Url::parse(source).unwrap())
            .unwrap();
        assert!(session
            .cookie_header(&Url::parse(source).unwrap())
            .is_some());
        assert!(session
            .cookie_header(&Url::parse("https://challenges.cloudflare.com").unwrap())
            .is_none());
        Arc::get_mut(&mut base).unwrap().upstream_auth_mode = UpstreamAuthMode::GoogleForm;
        for route in &session.routes {
            assert!(session
                .request_state(&base, &request_for(route, AUTOLOGIN_PATH))
                .is_err());
        }
        for wrong_source in [
            "https://auth.openai.com",
            "https://claude.ai.attacker.test",
            "http://chatgpt.com",
        ] {
            assert!(google::GoogleSession::new(
                Some(profile),
                &Url::parse(wrong_source).unwrap(),
                PRIMARY_PROXY,
                client(),
                client()
            )
            .is_err());
        }
    }
}

#[test]
fn chatgpt_redirect_uri_restores_only_source_alias_at_the_auth_origin() {
    let session = google::GoogleSession::new(
        Some(ReviewedApplicationProfile::Chatgpt),
        &Url::parse("https://chatgpt.com/").unwrap(),
        PRIMARY_PROXY,
        client(),
        client(),
    )
    .unwrap()
    .unwrap();
    let mut request =
        Url::parse("https://auth.openai.com/authorize?state=keep%2fExact+Value").unwrap();
    request.query_pairs_mut().append_pair(
        "redirect_uri",
        &format!("{PRIMARY_PROXY}/api/auth/callback/openai?__sorng_generation_v1=private&return=1"),
    );
    let restored = session.upstream_callback_url(&request);
    assert!(restored
        .query()
        .unwrap()
        .starts_with("state=keep%2fExact+Value&"));
    assert_eq!(
        restored
            .query_pairs()
            .find(|(k, _)| k == "redirect_uri")
            .unwrap()
            .1,
        "https://chatgpt.com/api/auth/callback/openai?return=1"
    );
    for route in session
        .routes
        .iter()
        .filter(|r| r.upstream_origin != "https://chatgpt.com")
    {
        let mut foreign = Url::parse("https://auth.openai.com/authorize").unwrap();
        foreign
            .query_pairs_mut()
            .append_pair("redirect_uri", &route.proxy_origin);
        assert_eq!(session.upstream_callback_url(&foreign), foreign);
    }
    let mut other = Url::parse("https://challenges.cloudflare.com/frame").unwrap();
    other
        .query_pairs_mut()
        .append_pair("redirect_uri", PRIMARY_PROXY);
    assert_eq!(session.upstream_callback_url(&other), other);
}

#[test]
fn hosted_form_routes_limit_credentials_to_source_and_keep_cdn_resource_only() {
    for (profile, source, asset) in [
        (
            ReviewedApplicationProfile::Instagram,
            "https://www.instagram.com",
            "https://static.cdninstagram.com",
        ),
        (
            ReviewedApplicationProfile::Canva,
            "https://www.canva.com",
            "https://static.canva.com",
        ),
    ] {
        let session = google::GoogleSession::new(
            Some(profile),
            &Url::parse(source).unwrap(),
            PRIMARY_PROXY,
            client(),
            client(),
        )
        .unwrap()
        .unwrap();
        assert_eq!(session.routes.len(), 2);
        let mut base = state(source);
        Arc::get_mut(&mut base).unwrap().upstream_auth_mode = UpstreamAuthMode::None;
        let source_route = session
            .routes
            .iter()
            .find(|r| r.upstream_origin == source)
            .unwrap();
        let cdn = session
            .routes
            .iter()
            .find(|r| r.upstream_origin == asset)
            .unwrap();
        assert!(session
            .request_state(&base, &request_for(source_route, AUTOLOGIN_PATH))
            .is_ok());
        assert!(session.allows_autologin(source, UpstreamAuthMode::None));
        assert!(!session.allows_autologin(asset, UpstreamAuthMode::None));
        assert!(session
            .request_state(&base, &request_for(cdn, AUTOLOGIN_PATH))
            .is_err());
        assert!(session
            .request_state(&base, &request_for(cdn, "/bundle.js"))
            .is_err());
        let mut script = request_for(cdn, "/bundle.js");
        script
            .headers_mut()
            .insert("sec-fetch-dest", header::HeaderValue::from_static("script"));
        assert_eq!(
            session.request_state(&base, &script).unwrap().target_origin,
            asset
        );
        assert!(session
            .map_url(&Url::parse("https://accounts.google.com/").unwrap())
            .is_none());
        assert!(session
            .map_url(&Url::parse("https://www.facebook.com/").unwrap())
            .is_none());
        let mut foreign = request_for(source_route, AUTOLOGIN_PATH);
        foreign.headers_mut().insert(
            header::ORIGIN,
            header::HeaderValue::from_static("https://foreign.test"),
        );
        assert!(session.request_state(&base, &foreign).is_err());
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            header::SET_COOKIE,
            "session=fixture; Secure; HttpOnly; Path=/".parse().unwrap(),
        );
        session
            .observe_cookies(&headers, &Url::parse(source).unwrap())
            .unwrap();
        assert!(session
            .cookie_header(&Url::parse(source).unwrap())
            .is_some());
        assert!(session.cookie_header(&Url::parse(asset).unwrap()).is_none());
    }
}

#[test]
fn adobe_hosted_routes_are_exact_and_do_not_grant_google_or_resource_credentials() {
    assert!(UpstreamAuthMode::AdobeForm
        .authorization_value("fixture", "fixture")
        .is_none());
    let session = adobe_session();
    let mut base = state("https://adminconsole.adobe.com");
    Arc::get_mut(&mut base).unwrap().upstream_auth_mode = UpstreamAuthMode::AdobeForm;
    for route in &session.routes {
        let credential = request_for(route, AUTOLOGIN_PATH);
        let result = session.request_state(&base, &credential);
        if route.upstream_origin == "https://auth.services.adobe.com" {
            assert_eq!(
                result.unwrap().upstream_auth_mode,
                UpstreamAuthMode::AdobeForm
            );
        } else {
            assert!(result.is_err(), "{}", route.upstream_origin);
        }
    }
    for target in [
        "https://accounts.google.com/",
        "https://auth.services.adobe.com.attacker.test/",
        "https://auth-stg1.services.adobe.com/",
        "http://auth.services.adobe.com/",
        "https://auth.services.adobe.com:444/",
    ] {
        assert!(session.map_url(&Url::parse(target).unwrap()).is_none());
    }
    let auth = session
        .routes
        .iter()
        .find(|r| r.upstream_origin == "https://auth.services.adobe.com")
        .unwrap();
    Arc::get_mut(&mut base).unwrap().upstream_auth_mode = UpstreamAuthMode::GoogleForm;
    assert!(session
        .request_state(&base, &request_for(auth, AUTOLOGIN_PATH))
        .is_err());
    for source in [
        "https://account.adobe.com/",
        "https://adminconsole.adobe.com.attacker.test/",
        "http://adminconsole.adobe.com/",
    ] {
        assert!(google::GoogleSession::new(
            Some(ReviewedApplicationProfile::AdobeAdminConsole),
            &Url::parse(source).unwrap(),
            PRIMARY_PROXY,
            client(),
            client()
        )
        .is_err());
    }
}

#[test]
fn adobe_ims_callbacks_restore_only_exact_native_document_aliases() {
    let session = adobe_session();
    let mut request = Url::parse("https://ims-na1.adobelogin.com/ims/authorize/v2?state=keep%2fExact+Value&client_id=ONESIE1").unwrap();
    request.query_pairs_mut().append_pair(
        "redirect_uri",
        &format!("{PRIMARY_PROXY}/?__sorng_navigation_v1=private&org=test#return"),
    );
    let mapped = session.upstream_callback_url(&request);
    assert!(mapped
        .query()
        .unwrap()
        .starts_with("state=keep%2fExact+Value&client_id=ONESIE1&"));
    assert_eq!(
        mapped
            .query_pairs()
            .find(|(k, _)| k == "redirect_uri")
            .unwrap()
            .1,
        "https://adminconsole.adobe.com/?org=test#return"
    );
    for callback in [
        "https://unreviewed.test/",
        "http://p11111111111111111111111111111111.localhost.attacker.test:43123/",
        "https://adminconsole.adobe.com/",
    ] {
        let mut request = Url::parse("https://ims-na1.adobelogin.com/ims/authorize/v2").unwrap();
        request
            .query_pairs_mut()
            .append_pair("redirect_uri", callback);
        assert_eq!(session.upstream_callback_url(&request), request);
    }
}

fn adobe_login_fixture() -> Arc<AxumProxyState> {
    let session = adobe_session();
    let route = session
        .routes
        .iter()
        .find(|r| r.upstream_origin == "https://auth.services.adobe.com")
        .unwrap()
        .clone();
    let mut root = state("https://adminconsole.adobe.com");
    {
        let state = Arc::get_mut(&mut root).unwrap();
        state.upstream_auth_mode = UpstreamAuthMode::AdobeForm;
        state.network = Arc::new(ProxyNetworkState::default().with_google_routes(Some(session)));
    }
    activate(&root);
    {
        let mut sessions = root.global_sessions.lock().unwrap();
        let entry = sessions.sessions.get_mut(&root.session_id).unwrap();
        entry.upstream_auth_mode = UpstreamAuthMode::AdobeForm;
        entry.reviewed_application_profile = Some(ReviewedApplicationProfile::AdobeAdminConsole);
    }
    let scoped = root
        .network
        .google
        .as_ref()
        .unwrap()
        .request_state(&root, &request_for(&route, "/en_US/index.html"))
        .unwrap();
    scoped.document_sequence.store(1, Ordering::SeqCst);
    scoped.network.document_issued(1, true);
    scoped
}

fn adobe_nonce(state: &Arc<AxumProxyState>) -> String {
    let script = crate::themed_autologin::build_autologin_injection(
        state,
        1,
        "https://auth.services.adobe.com/en_US/index.html",
    )
    .unwrap();
    assert!(script.contains("'adobe'"));
    assert!(!script.contains("saved-password"));
    assert!(!script.contains("saved-user"));
    script
        .split_once("var NONCE=\"")
        .unwrap()
        .1
        .split('"')
        .next()
        .unwrap()
        .to_string()
}

async fn adobe_redeem(
    state: &Arc<AxumProxyState>,
    nonce: &str,
    phase: Option<&str>,
) -> axum::response::Response {
    crate::themed_autologin::autologin_cred_handler(
        axum::extract::State(state.clone()),
        axum::extract::Query(AutoLoginQuery {
            nonce: nonce.into(),
            phase: phase.map(str::to_string),
        }),
    )
    .await
}

#[tokio::test]
async fn adobe_endpoint_stages_and_consumes_credentials_and_rejects_replays() {
    let state = adobe_login_fixture();
    let nonce = adobe_nonce(&state);
    assert_eq!(
        adobe_redeem(&state, &nonce, Some("password"))
            .await
            .status(),
        403
    );
    let reply = adobe_redeem(&state, &nonce, None).await;
    assert_eq!(reply.status(), 200);
    assert_eq!(reply.headers()["cache-control"], "no-store");
    let first: serde_json::Value =
        serde_json::from_slice(&axum::body::to_bytes(reply.into_body(), 4096).await.unwrap())
            .unwrap();
    assert_eq!(first["username"], "saved-user");
    assert!(first.get("password").is_none());
    let continuation = first["continuation"].as_str().unwrap();
    assert_ne!(nonce, continuation);
    assert_eq!(adobe_redeem(&state, &nonce, None).await.status(), 403);
    // A child frame can be issued while the auth SPA remains selected.
    // Only native primary selection, not the global issue counter, owns it.
    state.document_sequence.store(2, Ordering::SeqCst);
    state.network.document_issued(2, false);
    let reply = adobe_redeem(&state, continuation, Some("password")).await;
    assert_eq!(reply.status(), 200);
    let last: serde_json::Value =
        serde_json::from_slice(&axum::body::to_bytes(reply.into_body(), 4096).await.unwrap())
            .unwrap();
    assert_eq!(
        last,
        serde_json::json!({"loginFlow":"adobe", "password":"saved-password"})
    );
    assert_eq!(
        adobe_redeem(&state, continuation, Some("password"))
            .await
            .status(),
        403
    );
}

#[tokio::test]
async fn adobe_endpoint_rejects_retired_documents_sessions_and_provider_changes() {
    for revoke in ["document", "network", "session", "provider"] {
        let state = adobe_login_fixture();
        let nonce = adobe_nonce(&state);
        let reply = adobe_redeem(&state, &nonce, None).await;
        assert_eq!(reply.status(), 200);
        let first: serde_json::Value =
            serde_json::from_slice(&axum::body::to_bytes(reply.into_body(), 4096).await.unwrap())
                .unwrap();
        let token = first["continuation"].as_str().unwrap();
        match revoke {
            "document" => {
                state.document_sequence.store(2, Ordering::SeqCst);
                state.network.document_issued(2, true);
                state.network.activate_document(2).unwrap();
            }
            "network" => state.network.revoke(),
            "session" => {
                state.global_sessions.lock().unwrap().sessions.clear();
            }
            "provider" => {
                state
                    .global_sessions
                    .lock()
                    .unwrap()
                    .sessions
                    .get_mut(&state.session_id)
                    .unwrap()
                    .reviewed_application_profile = Some(ReviewedApplicationProfile::GoogleHosted);
            }
            _ => unreachable!(),
        }
        assert_eq!(
            adobe_redeem(&state, token, Some("password")).await.status(),
            403,
            "{revoke}"
        );
    }
}

#[test]
fn google_catalog_is_an_exact_profile_specific_allowlist_without_lookalikes() {
    for (source, extras) in [
        ("https://myaccount.google.com", vec![]),
        (
            "https://console.cloud.google.com",
            vec![("https://cloudconsole-pa.clients6.google.com", false)],
        ),
        (
            "https://analytics.google.com",
            vec![
                ("https://analyticsadmin.googleapis.com", false),
                ("https://analyticsdata.googleapis.com", false),
            ],
        ),
        ("https://business.google.com", vec![]),
        ("https://search.google.com", vec![]),
        ("https://ads.google.com", vec![]),
        (
            "https://www.youtube.com",
            vec![("https://accounts.youtube.com", true)],
        ),
        ("https://mail.google.com", vec![]),
        (
            "https://drive.google.com",
            vec![
                ("https://clients6.google.com", false),
                ("https://content.googleapis.com", false),
            ],
        ),
    ] {
        let session = session(source);
        let actual = session
            .routes
            .iter()
            .map(|route| (route.upstream_origin.clone(), route.documents))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(actual, expected_routes(source, &extras), "{source}");
        for lookalike in [
            format!("{source}.attacker.test/path"),
            "https://accounts.google.com.attacker.test/".into(),
            "https://evilgoogle.com/".into(),
            "https://accounts.google.com:444/".into(),
            "http://accounts.google.com/".into(),
        ] {
            assert!(
                session.map_url(&Url::parse(&lookalike).unwrap()).is_none(),
                "{lookalike}"
            );
        }
    }

    for source in [
        "https://accounts.google.com/",
        "https://analytics.google.com.attacker.test/",
        "http://analytics.google.com/",
        "https://analytics.google.com:444/",
        "https://user@analytics.google.com/",
    ] {
        assert!(
            google::GoogleSession::new(
                Some(ReviewedApplicationProfile::GoogleHosted),
                &Url::parse(source).unwrap(),
                PRIMARY_PROXY,
                client(),
                client(),
            )
            .is_err(),
            "{source}"
        );
    }
}

#[test]
fn every_upstream_origin_has_a_distinct_leased_local_origin() {
    let session = session("https://analytics.google.com/path/is-allowed");
    let local_origins = session
        .routes
        .iter()
        .map(|route| route.proxy_origin.as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(local_origins.len(), session.routes.len());
    assert_eq!(
        session
            .routes
            .iter()
            .find(|route| route.upstream_origin == "https://analytics.google.com")
            .unwrap()
            .proxy_origin,
        PRIMARY_PROXY
    );
    let aliases = session
        .routes
        .iter()
        .filter(|route| route.proxy_origin != PRIMARY_PROXY)
        .map(|route| route.proxy_origin.clone())
        .collect::<Vec<_>>();
    for alias in &aliases {
        let parsed = Url::parse(alias).unwrap();
        assert_eq!(parsed.scheme(), "http");
        assert_eq!(parsed.port(), Some(43123));
        let host = parsed.host_str().unwrap();
        assert!(host.starts_with('p') && host.ends_with(".localhost"));
        assert_eq!(
            host.trim_start_matches('p')
                .trim_end_matches(".localhost")
                .len(),
            32
        );
        assert!(webview_origins::allows_frame_url(alias));
    }
    session.revoke();
    for alias in aliases {
        assert!(!webview_origins::allows_frame_url(&alias));
    }
}

#[test]
fn redirects_map_to_the_destination_alias_and_increment_a_bounded_counter() {
    let session = session("https://analytics.google.com/");
    let account_proxy = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://accounts.google.com")
        .unwrap()
        .proxy_origin
        .clone();
    let upstream: reqwest::Response = axum::http::Response::builder()
        .status(302)
        .header(
            header::SET_COOKIE,
            "__Host-GAPS=projected; Path=/; Secure; HttpOnly",
        )
        .header(
            header::LOCATION,
            "https://accounts.google.com/v3/signin/identifier?continue=analytics#step",
        )
        .url(Url::parse("https://analytics.google.com/").unwrap())
        .body("")
        .unwrap()
        .into();
    let mapped = session.redirect_response(&upstream, 7, Some("navigation-token"), true, None);
    assert_eq!(mapped.status(), 302);
    let location = mapped.headers()[header::LOCATION].to_str().unwrap();
    assert!(location.starts_with(&format!(
        "{account_proxy}/v3/signin/identifier?continue=analytics&"
    )));
    assert!(location.contains("__sorng_google_hop_v1=8"));
    assert!(location.contains("__sorng_navigation_v1=navigation-token"));
    assert!(location.ends_with("#step"));
    assert!(!mapped.headers().contains_key(header::SET_COOKIE));

    let signed_query = "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fanalytics.google.com%2Fanalytics%2Fweb%2F%2523%2Freport&continue=second+value&empty=&flag#challenge";
    let opaque: reqwest::Response = axum::http::Response::builder()
        .status(302)
        .header(header::LOCATION, signed_query)
        .url(Url::parse("https://analytics.google.com/").unwrap())
        .body("")
        .unwrap()
        .into();
    let opaque = session.redirect_response(&opaque, 0, None, true, None);
    let opaque_location = opaque.headers()[header::LOCATION].to_str().unwrap();
    assert!(opaque_location.contains("continue=https%3A%2F%2Fanalytics.google.com%2Fanalytics%2Fweb%2F%2523%2Freport&continue=second+value&empty=&flag&__sorng_google_hop_v1=1#challenge"));

    assert_eq!(
        google::request_path("/v3/signin?continue=analytics&__sorng_google_hop_v1=8").unwrap(),
        ("/v3/signin?continue=analytics".into(), 8)
    );
    for invalid in [
        "/?__sorng_google_hop_v1=21",
        "/?__sorng_google_hop_v1=1&__sorng_google_hop_v1=2",
        "/?%5f_sorng_google_hop_v1=1",
        "/?__sorng_google_hop_v1=-1",
    ] {
        assert!(google::request_path(invalid).is_err(), "{invalid}");
    }

    let limited = session.redirect_response(&upstream, 20, None, true, None);
    assert_eq!(limited.status(), 508);
    let outside: reqwest::Response = axum::http::Response::builder()
        .status(302)
        .header(
            header::LOCATION,
            "https://accounts.google.com.attacker.test/",
        )
        .url(Url::parse("https://analytics.google.com/").unwrap())
        .body("")
        .unwrap()
        .into();
    assert_eq!(
        session
            .redirect_response(&outside, 0, None, true, None)
            .status(),
        403
    );
}

#[test]
fn alias_scope_preserves_the_native_webview_user_agent_but_not_connection_secrets() {
    let session = session("https://analytics.google.com/");
    let account = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://accounts.google.com")
        .unwrap();
    let base = state("https://analytics.google.com");
    let request = request_for(account, "/v3/signin/identifier");
    let scoped = session.request_state(&base, &request).unwrap();
    assert_eq!(scoped.target_origin, "https://accounts.google.com");
    assert_eq!(scoped.proxy_origin, account.proxy_origin);
    assert_eq!(scoped.upstream_auth_mode, UpstreamAuthMode::GoogleForm);
    assert!(scoped.custom_headers.is_empty());
    assert!(scoped.proxy_policy.query_parameters.is_empty());

    let native_user_agent = "Mozilla/5.0 Native-WebView2 Fixture/126.0";
    let mut incoming = axum::http::HeaderMap::new();
    incoming.insert(header::USER_AGENT, native_user_agent.parse().unwrap());
    incoming.insert(header::COOKIE, "browser-cookie=private".parse().unwrap());
    incoming.insert("sec-fetch-dest", "iframe".parse().unwrap());
    incoming.insert("sec-fetch-mode", "navigate".parse().unwrap());
    incoming.insert("sec-fetch-site", "same-site".parse().unwrap());
    incoming.insert("sec-fetch-user", "?1".parse().unwrap());
    incoming.insert(
        "sec-ch-ua",
        "\"WebView fixture\";v=\"126\"".parse().unwrap(),
    );
    incoming.insert("sec-ch-ua-platform", "\"Windows\"".parse().unwrap());
    incoming.insert(
        header::PROXY_AUTHORIZATION,
        "Basic private".parse().unwrap(),
    );
    let forwarded = session.request_headers(&incoming, &scoped.target_origin);
    assert_eq!(
        forwarded
            .iter()
            .find(|(name, _)| name == "user-agent")
            .map(|(_, value)| value.as_str()),
        Some(native_user_agent)
    );
    let captured = format!("{forwarded:?}");
    assert!(!captured.contains("saved-user"));
    assert!(!captured.contains("saved-password"));
    assert!(!captured.contains("must-not-cross-origin"));
    assert!(!forwarded.iter().any(|(name, _)| matches!(
        name.as_str(),
        "cookie"
            | "proxy-authorization"
            | "sec-fetch-dest"
            | "sec-fetch-mode"
            | "sec-fetch-site"
            | "sec-fetch-user"
    )));
    for name in ["sec-ch-ua", "sec-ch-ua-platform"] {
        assert_eq!(
            forwarded
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.as_str()),
            incoming.get(name).and_then(|value| value.to_str().ok()),
            "native browser metadata changed: {name}",
        );
    }

    let outbound = scoped
        .upstream_auth_mode
        .apply_credentials(
            scoped.client.get("https://accounts.google.com/"),
            &scoped.username.read().unwrap(),
            &scoped.password.read().unwrap(),
        )
        .build()
        .unwrap();
    assert!(!outbound.headers().contains_key(header::AUTHORIZATION));

    let mut background = axum::http::HeaderMap::new();
    background.insert("sec-fetch-dest", "empty".parse().unwrap());
    background.insert("sec-fetch-mode", "cors".parse().unwrap());
    background.insert("sec-fetch-site", "same-origin".parse().unwrap());
    let background = session.request_headers(&background, &scoped.target_origin);
    assert!(background
        .iter()
        .any(|(name, value)| name == "sec-fetch-site" && value == "same-origin"));

    let credentials = request_for(account, AUTOLOGIN_PATH);
    assert!(session.request_state(&base, &credentials).is_ok());
    let cookies = request_for(account, google::COOKIE_BRIDGE_PATH);
    assert!(session.request_state(&base, &cookies).is_ok());
    let resource = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://www.gstatic.com")
        .unwrap();
    let credentials = request_for(resource, AUTOLOGIN_PATH);
    assert!(session.request_state(&base, &credentials).is_err());
    let cookies = request_for(resource, google::COOKIE_BRIDGE_PATH);
    assert!(session.request_state(&base, &cookies).is_err());
}

#[test]
fn browser_compatibility_is_shared_by_approved_google_document_routes() {
    let session = session("https://analytics.google.com/");
    for hide_webdriver in [false, true] {
        let mut base = state("https://analytics.google.com");
        Arc::get_mut(&mut base).unwrap().network = Arc::new(
            ProxyNetworkState::default()
                .with_browser_compatibility(BrowserCompatibility { hide_webdriver }),
        );
        for route in session.routes.iter().filter(|route| route.documents) {
            let scoped = session
                .request_state(&base, &request_for(route, "/login"))
                .unwrap();
            assert!(Arc::ptr_eq(&base.network, &scoped.network));
            assert_eq!(
                scoped.network.browser_compatibility().hide_webdriver,
                hide_webdriver
            );
            assert!(scoped.custom_headers.is_empty());
            assert!(scoped.proxy_policy.query_parameters.is_empty());
        }
        let foreign = Request::builder()
            .uri("/login")
            .header(
                header::HOST,
                "pffffffffffffffffffffffffffffffff.localhost:43123",
            )
            .body(Body::empty())
            .unwrap();
        assert!(session.request_state(&base, &foreign).is_err());
    }
}

#[test]
fn accounts_navigation_sanitizes_partial_metadata_without_changing_native_identity_or_cookies() {
    let session = session("https://analytics.google.com/");
    let target = Url::parse("https://accounts.google.com/ServiceLogin").unwrap();
    let mut cookies = reqwest::header::HeaderMap::new();
    cookies.insert(
        header::SET_COOKIE,
        "__Host-GAPS=native-session; Path=/; Secure; HttpOnly"
            .parse()
            .unwrap(),
    );
    session.observe_cookies(&cookies, &target).unwrap();

    let cases: &[(&str, &[(&str, &str)])] = &[
        ("iframe without mode", &[("sec-fetch-dest", "iframe")]),
        ("document without mode", &[("sec-fetch-dest", "document")]),
        ("frame without mode", &[("sec-fetch-dest", "frame")]),
        (
            "mode without destination",
            &[("sec-fetch-mode", "navigate")],
        ),
        (
            "legacy frame navigation",
            &[("sec-fetch-dest", "frame"), ("sec-fetch-mode", "navigate")],
        ),
        (
            "older WebView HTML navigation",
            &[("upgrade-insecure-requests", "1"), ("accept", "text/html")],
        ),
    ];
    for (label, metadata) in cases {
        let mut incoming = axum::http::HeaderMap::new();
        for (name, value) in [
            ("user-agent", "Mozilla/5.0 Native-WebView2 Fixture/126.0"),
            ("sec-ch-ua", "\"WebView fixture\";v=\"126\""),
            ("sec-ch-ua-platform", "\"Windows\""),
            ("sec-ch-ua-mobile", "?0"),
            ("cookie", "__Host-GAPS=stale-localhost-mirror"),
            ("sec-fetch-site", "same-site"),
            ("sec-fetch-user", "?1"),
        ] {
            incoming.insert(name, value.parse().unwrap());
        }
        for &(name, value) in *metadata {
            incoming.insert(name, value.parse().unwrap());
        }
        let forwarded = session.request_headers(&incoming, "https://accounts.google.com");
        assert!(
            !forwarded
                .iter()
                .any(|(name, _)| name.starts_with("sec-fetch-")),
            "localhost navigation metadata escaped: {label}",
        );
        for name in [
            "user-agent",
            "sec-ch-ua",
            "sec-ch-ua-platform",
            "sec-ch-ua-mobile",
        ] {
            assert_eq!(
                forwarded
                    .iter()
                    .find(|(key, _)| key == name)
                    .map(|(_, value)| value.as_str()),
                incoming.get(name).and_then(|value| value.to_str().ok()),
                "native browser identity changed: {label}, {name}",
            );
        }
        assert!(!forwarded.iter().any(|(name, _)| name == "cookie"));
        assert_eq!(
            session.cookie_header(&target).unwrap(),
            "__Host-GAPS=native-session"
        );
    }
}

#[test]
fn accounts_metadata_sanitizing_does_not_relax_background_or_other_origin_requests() {
    let session = session("https://analytics.google.com/");
    for (target, metadata) in [
        (
            "https://accounts.google.com",
            vec![("sec-fetch-mode", "cors"), ("sec-fetch-dest", "empty")],
        ),
        (
            "https://accounts.google.com",
            vec![("sec-fetch-mode", "cors"), ("sec-fetch-dest", "iframe")],
        ),
        (
            "https://accounts.google.com",
            vec![
                ("x-requested-with", "XMLHttpRequest"),
                ("sec-fetch-mode", "navigate"),
            ],
        ),
        // Negotiating HTML alone does not make an XHR into a navigation.
        ("https://accounts.google.com", vec![]),
        (
            "https://analytics.google.com",
            vec![("sec-fetch-mode", "navigate"), ("sec-fetch-dest", "iframe")],
        ),
    ] {
        let mut incoming = axum::http::HeaderMap::new();
        incoming.insert("accept", "text/html".parse().unwrap());
        incoming.insert("sec-fetch-site", "same-origin".parse().unwrap());
        for (name, value) in metadata {
            incoming.insert(name, value.parse().unwrap());
        }
        let forwarded = session.request_headers(&incoming, target);
        for (name, value) in &incoming {
            assert!(forwarded.contains(&(name.to_string(), value.to_str().unwrap().into())));
        }
    }
}

// Anonymous GETs only. This exercises the real mediator and native cookie jar,
// not a signed-in browser or Google's post-identifier acceptance checks.
#[tokio::test]
#[ignore = "contacts public Google Accounts; opt-in anonymous navigation diagnostic"]
async fn live_accounts_navigation_distinguishes_malformed_metadata_from_native_identity_and_cookies(
) {
    // Previously captured WebView identity, also used by the QuickConnect
    // diagnostics. It is input to this test, never a production UA override.
    let native_user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0";
    let session = session("https://analytics.google.com/");
    let target = Url::parse("https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fanalytics.google.com%2Fanalytics%2Fweb%2F").unwrap();
    let mut incoming = axum::http::HeaderMap::new();
    for (name, value) in [
        ("user-agent", native_user_agent),
        (
            "sec-ch-ua",
            "\"Chromium\";v=\"146\", \"Microsoft Edge\";v=\"146\", \"Not_A Brand\";v=\"99\"",
        ),
        ("sec-ch-ua-platform", "\"Windows\""),
        ("sec-ch-ua-mobile", "?0"),
        ("accept", "text/html"),
        ("sec-fetch-dest", "iframe"),
        ("sec-fetch-site", "same-site"),
    ] {
        incoming.insert(name, value.parse().unwrap());
    }
    let raw = collect_upstream_headers(
        &incoming,
        UpstreamAuthMode::None,
        "",
        "https://accounts.google.com",
    );
    let malformed = session
        .send(&reqwest::Method::GET, &target, &raw, &[], true)
        .await
        .unwrap_or_else(|_| panic!("anonymous raw Google navigation failed"));
    assert_eq!(malformed.status(), reqwest::StatusCode::UNAUTHORIZED);
    let response_headers = malformed.headers().clone();
    let body = proxy_response::read_body(malformed, &response_headers, true)
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(&body).contains("malformed"));

    let forwarded = session.request_headers(&incoming, "https://accounts.google.com");
    let redirect = session
        .send(&reqwest::Method::GET, &target, &forwarded, &[], true)
        .await
        .unwrap_or_else(|_| panic!("anonymous normalized Google navigation failed"));
    assert_eq!(redirect.status(), reqwest::StatusCode::FOUND);
    assert!(session.cookie_header(&target).is_some());
    assert!(!redirect.headers().contains_key(header::SET_COOKIE));
    let next = target
        .join(
            redirect
                .headers()
                .get(header::LOCATION)
                .unwrap()
                .to_str()
                .unwrap(),
        )
        .unwrap();
    assert_eq!(next.origin(), target.origin());
    let page = session
        .send(&reqwest::Method::GET, &next, &forwarded, &[], true)
        .await
        .unwrap_or_else(|_| panic!("anonymous Google identifier navigation failed"));
    assert_eq!(page.status(), reqwest::StatusCode::OK);
    let response_headers = page.headers().clone();
    let body = proxy_response::read_body(page, &response_headers, true)
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(&body).contains("identifierId"));
}

#[tokio::test]
async fn document_cookie_bridge_is_synchronous_path_scoped_and_hides_httponly_state() {
    let session = session("https://analytics.google.com/");
    let origin = "https://accounts.google.com";
    let target = Url::parse("https://accounts.google.com/v3/signin/identifier").unwrap();
    let mut server = reqwest::header::HeaderMap::new();
    server.append(
        header::SET_COOKIE,
        "SID=server-secret; Domain=.google.com; Path=/; Secure; HttpOnly"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "visible=one; Domain=.google.com; Path=/; Secure"
            .parse()
            .unwrap(),
    );
    session.observe_cookies(&server, &target).unwrap();

    let request = Request::builder()
        .method("GET")
        .uri(google::COOKIE_BRIDGE_PATH)
        .header("x-sorng-google-cookie-path", "/v3/signin/identifier")
        .body(Body::empty())
        .unwrap();
    let response = session.document_cookie_response(origin, request).await;
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .unwrap();
    assert_eq!(body, "visible=one");

    let request = Request::builder()
        .method("POST")
        .uri(google::COOKIE_BRIDGE_PATH)
        .header("x-sorng-google-cookie-path", "/v3/signin/identifier")
        .body(Body::from(
            "probe=accepted; Domain=.google.com; Path=/v3; Secure",
        ))
        .unwrap();
    assert_eq!(
        session
            .document_cookie_response(origin, request)
            .await
            .status(),
        axum::http::StatusCode::NO_CONTENT
    );
    let native = session.cookie_header(&target).unwrap();
    let native = native.to_str().unwrap();
    assert!(native.contains("SID=server-secret"));
    assert!(native.contains("probe=accepted"));

    for value in [
        "SID=browser-overwrite; Domain=.google.com; Path=/; Secure",
        "SID=; Domain=.google.com; Path=/; Max-Age=0; Secure",
    ] {
        let request = Request::builder()
            .method("POST")
            .uri(google::COOKIE_BRIDGE_PATH)
            .header("x-sorng-google-cookie-path", "/v3/signin/identifier")
            .body(Body::from(value))
            .unwrap();
        assert_eq!(
            session
                .document_cookie_response(origin, request)
                .await
                .status(),
            axum::http::StatusCode::NO_CONTENT
        );
    }
    let native = session.cookie_header(&target).unwrap();
    let native = native.to_str().unwrap();
    assert!(native.contains("SID=server-secret"));
    assert!(!native.contains("SID=browser-overwrite"));

    let request = Request::builder()
        .method("POST")
        .uri(google::COOKIE_BRIDGE_PATH)
        .header("x-sorng-google-cookie-path", "/v3/signin/identifier")
        .body(Body::from("probe=ignored; Path=/; HttpOnly"))
        .unwrap();
    assert_eq!(
        session
            .document_cookie_response(origin, request)
            .await
            .status(),
        axum::http::StatusCode::NO_CONTENT
    );
    assert!(!session
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("probe=ignored"));

    let request = Request::builder()
        .method("POST")
        .uri(google::COOKIE_BRIDGE_PATH)
        .header("x-sorng-google-cookie-path", "/v3/signin/identifier")
        .body(Body::from(
            "probe=; Domain=.google.com; Path=/v3; Max-Age=0; Secure",
        ))
        .unwrap();
    assert_eq!(
        session
            .document_cookie_response(origin, request)
            .await
            .status(),
        axum::http::StatusCode::NO_CONTENT
    );
    assert!(!session
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("probe="));
}

#[test]
fn request_origins_translate_only_from_this_google_sessions_aliases() {
    let session = session("https://analytics.google.com/");
    let account = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://accounts.google.com")
        .unwrap();
    let mut incoming = axum::http::HeaderMap::new();
    incoming.insert(header::ORIGIN, PRIMARY_PROXY.parse().unwrap());
    incoming.insert(
        header::REFERER,
        format!("{PRIMARY_PROXY}/").parse().unwrap(),
    );
    let forwarded = session.request_headers(&incoming, &account.upstream_origin);
    assert!(forwarded.contains(&("origin".into(), "https://analytics.google.com".into())));
    assert!(forwarded.contains(&("referer".into(), "https://analytics.google.com/".into())));
    assert!(!format!("{forwarded:?}").contains("localhost"));

    for foreign in [
        "null",
        "https://accounts.google.com.attacker.test",
        "http://localhost:3001",
    ] {
        let mut request = request_for(account, "/v3/signin/identifier");
        request
            .headers_mut()
            .insert(header::ORIGIN, foreign.parse().unwrap());
        assert!(session
            .request_state(&state("https://analytics.google.com"), &request)
            .is_err());
    }
}

#[test]
fn google_referer_removes_private_markers_and_fragment_without_reencoding_application_query() {
    let session = session("https://analytics.google.com/");
    for source in session.routes.iter().filter(|route| route.documents) {
        for (suffix, expected) in [
            ("/v3/signin/identifier", "/v3/signin/identifier"),
            ("/v3/signin/identifier?", "/v3/signin/identifier?"),
            ("/v3/signin/identifier#private", "/v3/signin/identifier"),
            (
                "/v3/signin/identifier?__sorng_navigation_v1=nav&__sorng_generation_v1=gen&__sorng_google_hop_v1=2#private",
                "/v3/signin/identifier",
            ),
            (
                "/v3/signin/identifier?continue=https%3A%2F%2Fanalytics.google.com%2F%2523&__sorng_navigation_v1=one&a=%2f+%20&__sorng_generation_v1=two&a=%2F&__sorng_google_hop_v1=3&empty=&flag&&__sorng_navigation_v1=again#private",
                "/v3/signin/identifier?continue=https%3A%2F%2Fanalytics.google.com%2F%2523&a=%2f+%20&a=%2F&empty=&flag&",
            ),
            (
                "/v3/signin/identifier?%5f%5fsorng_navigation_v1=one&__sorng_%67eneration_v1=two&__sorng_google_hop_v%31=3&keep=%252F+%20#private",
                "/v3/signin/identifier?keep=%252F+%20",
            ),
            (
                "/v3/signin/identifier?application=__sorng_generation_v1&__sorng_google_hop_v1_extra=keep&__SORNG_GENERATION_V1=keep",
                "/v3/signin/identifier?application=__sorng_generation_v1&__sorng_google_hop_v1_extra=keep&__SORNG_GENERATION_V1=keep",
            ),
        ] {
            let mut incoming = axum::http::HeaderMap::new();
            incoming.insert(
                header::REFERER,
                format!("{}{suffix}", source.proxy_origin).parse().unwrap(),
            );
            let forwarded = session.request_headers(&incoming, "https://accounts.google.com");
            let referrers: Vec<_> = forwarded
                .iter()
                .filter(|(name, _)| name == "referer")
                .map(|(_, value)| value.as_str())
                .collect();
            assert_eq!(
                referrers,
                vec![format!("{}{expected}", source.upstream_origin)],
                "source {} suffix {suffix}",
                source.upstream_origin,
            );
        }
    }
}

#[test]
fn google_referer_sanitizing_does_not_authorize_foreign_source_aliases() {
    let session = session("https://analytics.google.com/");
    let unrelated = self::session("https://analytics.google.com/");
    let foreign_account = unrelated
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://accounts.google.com")
        .unwrap();
    for origin in [
        foreign_account.proxy_origin.clone(),
        PRIMARY_PROXY.replace("http:", "https:"),
        PRIMARY_PROXY.replace(":43123", ":43124"),
        PRIMARY_PROXY.replace(".localhost", ".localhost.attacker.test"),
        "https://accounts.google.com".into(),
        "http://localhost:3001".into(),
    ] {
        let mut incoming = axum::http::HeaderMap::new();
        incoming.insert(
            header::REFERER,
            format!("{origin}/v3/signin/identifier?__sorng_generation_v1=private#fragment")
                .parse()
                .unwrap(),
        );
        let forwarded = session.request_headers(&incoming, "https://accounts.google.com");
        assert!(
            !forwarded.iter().any(|(name, _)| name == "referer"),
            "foreign source was projected: {origin}",
        );
    }
}

#[test]
fn google_manual_post_referer_sanitizing_preserves_origin_native_identity_and_cookie_selection() {
    let session = session("https://analytics.google.com/");
    let account = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://accounts.google.com")
        .unwrap();
    let target = Url::parse("https://accounts.google.com/v3/signin/identifier").unwrap();
    let mut response_headers = reqwest::header::HeaderMap::new();
    response_headers.insert(
        header::SET_COOKIE,
        "__Host-GAPS=native-session; Secure; HttpOnly; Path=/"
            .parse()
            .unwrap(),
    );
    session.observe_cookies(&response_headers, &target).unwrap();
    let cookie_before = session.cookie_header(&target).unwrap();
    let payload = b"f.req=%5B%22fixture%40example.test%22%5D&continue=%2F%2523&dup=1&dup=2";
    let request = Request::builder()
        .method("POST")
        .uri("/v3/signin/identifier")
        .header(header::ORIGIN, &account.proxy_origin)
        .header(
            header::REFERER,
            format!("{}/v3/signin/identifier?continue=%2F%2523&__sorng_navigation_v1=nav&__sorng_generation_v1=gen&__sorng_google_hop_v1=2#private", account.proxy_origin),
        )
        .header(header::USER_AGENT, "Native-WebView-Fixture/1")
        .header("sec-ch-ua", "\"Native-WebView-Fixture\";v=\"1\"")
        .header("sec-ch-ua-platform", "\"Windows\"")
        .header("sec-fetch-dest", "empty")
        .header("sec-fetch-mode", "cors")
        .header("sec-fetch-site", "same-origin")
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded;charset=UTF-8")
        .header(header::COOKIE, "localhost-cookie=must-not-forward")
        .body(payload.to_vec())
        .unwrap();
    let original_headers = request.headers().clone();
    let forwarded: HashMap<_, _> = session
        .request_headers(request.headers(), &account.upstream_origin)
        .into_iter()
        .collect();
    assert_eq!(forwarded["origin"], "https://accounts.google.com");
    assert_eq!(
        forwarded["referer"],
        "https://accounts.google.com/v3/signin/identifier?continue=%2F%2523",
    );
    for name in [
        "user-agent",
        "sec-ch-ua",
        "sec-ch-ua-platform",
        "sec-fetch-dest",
        "sec-fetch-mode",
        "sec-fetch-site",
        "content-type",
    ] {
        assert_eq!(forwarded[name], request.headers()[name].to_str().unwrap());
    }
    // This header-only transformation leaves the caller's POST and opaque body
    // untouched. GoogleSession::send, not a localhost Cookie header, owns the jar.
    assert_eq!(request.method(), "POST");
    assert_eq!(request.body().as_slice(), payload);
    assert_eq!(request.headers(), &original_headers);
    assert!(!forwarded.contains_key("cookie"));
    assert_eq!(session.cookie_header(&target).unwrap(), cookie_before);
    assert_eq!(
        cookie_before.to_str().unwrap(),
        "__Host-GAPS=native-session"
    );
    assert!(session.includes_credentials(request.headers()).unwrap());
    let mut omitted = request.headers().clone();
    omitted.insert("x-sorng-google-credentials", "omit".parse().unwrap());
    assert!(!session.includes_credentials(&omitted).unwrap());
    assert_eq!(
        session.cookie_header(&Url::parse("https://analytics.google.com/").unwrap()),
        None,
    );
}

#[tokio::test]
async fn document_cookie_bridge_enforces_upstream_domain_and_secure_prefix_rules() {
    let session = session("https://analytics.google.com/");
    let origin = "https://accounts.google.com";
    let target = Url::parse("https://accounts.google.com/v3/signin/identifier").unwrap();
    for value in [
        "__Secure-invalid=no; Path=/",
        "__Host-domain=no; Domain=.google.com; Path=/; Secure",
        "__Host-path=no; Path=/v3; Secure",
        "__Http-script=no; Path=/; Secure",
        "__Host-Http-script=no; Path=/; Secure",
        "public-suffix=no; Domain=com; Path=/; Secure",
        "foreign=no; Domain=attacker.test; Path=/; Secure",
        "__Secure-valid=yes; Domain=.google.com; Path=/; Secure",
        "__Host-valid=yes; Path=/; Secure",
    ] {
        let request = Request::builder()
            .method("POST")
            .uri(google::COOKIE_BRIDGE_PATH)
            .header("x-sorng-google-cookie-path", "/v3/signin/identifier")
            .body(Body::from(value))
            .unwrap();
        assert_eq!(
            session
                .document_cookie_response(origin, request)
                .await
                .status(),
            axum::http::StatusCode::NO_CONTENT,
        );
    }
    let native = session.cookie_header(&target).unwrap();
    let native = native.to_str().unwrap();
    assert!(native.contains("__Secure-valid=yes"));
    assert!(native.contains("__Host-valid=yes"));
    assert_eq!(native.split("; ").count(), 2);
    let service = session
        .cookie_header(&Url::parse("https://analytics.google.com/").unwrap())
        .unwrap();
    assert_eq!(service.to_str().unwrap(), "__Secure-valid=yes");
}

#[test]
fn cors_is_translated_only_when_google_approved_the_exact_upstream_origin() {
    let session = session("https://analytics.google.com/");
    let account = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://accounts.google.com")
        .unwrap();
    let analytics = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://analytics.google.com")
        .unwrap();
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "access-control-allow-origin",
        "https://analytics.google.com".parse().unwrap(),
    );
    assert_eq!(
        session.translated_cors_origin(Some(&analytics.proxy_origin), &headers),
        Some(analytics.proxy_origin.clone())
    );
    assert_eq!(
        session.translated_cors_origin(Some(&account.proxy_origin), &headers),
        None
    );
    headers.insert("access-control-allow-origin", "*".parse().unwrap());
    assert_eq!(
        session.translated_cors_origin(Some(&account.proxy_origin), &headers),
        Some("*".into())
    );
    assert_eq!(
        session.translated_cors_origin(
            Some("http://pffffffffffffffffffffffffffffffff.localhost:43123"),
            &headers,
        ),
        None
    );
}

#[test]
fn native_cookie_jar_keeps_httponly_values_and_upstream_scope() {
    let session = session("https://analytics.google.com/");
    let target = Url::parse("https://accounts.google.com/v3/signin/identifier").unwrap();
    let mut server = reqwest::header::HeaderMap::new();
    server.append(
        header::SET_COOKIE,
        "SID=server-secret; Domain=.google.com; Path=/; Secure; HttpOnly; SameSite=None"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "__Host-GAPS=google-session; Path=/; Secure; HttpOnly; SameSite=None"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "account-only=private; Path=/; Secure".parse().unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "visible=one; Domain=.google.com; Path=/; Secure; SameSite=Lax"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "dupe=wide; Domain=.google.com; Path=/; Secure; SameSite=Strict"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "dupe=narrow; Domain=.google.com; Path=/v3; Secure; SameSite=Lax"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "implicit=one; Domain=.google.com; Secure; SameSite=Strict"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "scope=shared; Domain=.google.com; Path=/v3/signin; Secure"
            .parse()
            .unwrap(),
    );
    server.append(header::SET_COOKIE, "scope=host; Secure".parse().unwrap());
    session.observe_cookies(&server, &target).unwrap();

    let native = session
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(native.contains("SID=server-secret"));
    assert!(native.contains("__Host-GAPS=google-session"));
    assert!(native.contains("visible=one"));
    assert!(native.contains("implicit=one"));
    assert!(native.contains("dupe=narrow"));
    assert!(native.contains("dupe=wide"));
    assert!(native.contains("scope=host"));
    assert!(native.contains("scope=shared"));

    let mut bridge = axum::http::HeaderMap::new();
    bridge.insert(
        "x-sorng-google-cookie-path",
        "/v3/signin/identifier".parse().unwrap(),
    );
    let visible = session
        .document_cookie_string("https://accounts.google.com", &bridge)
        .unwrap();
    assert!(!visible.contains("SID="));
    assert!(!visible.contains("__Host-GAPS="));
    assert!(visible.contains("visible=one"));
    assert!(visible.contains("dupe=narrow"));
    assert!(visible.contains("dupe=wide"));

    let analytics = Url::parse("https://analytics.google.com/analytics/web/").unwrap();
    let cross_origin = session
        .cookie_header(&analytics)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(cross_origin.contains("SID=server-secret"));
    assert!(!cross_origin.contains("__Host-GAPS=google-session"));
    assert!(cross_origin.contains("visible=one"));
    assert!(cross_origin.contains("dupe=wide"));
    assert!(!cross_origin.contains("dupe=narrow"));
    assert!(!cross_origin.contains("implicit=one"));
    assert!(!cross_origin.contains("scope=shared"));
    assert!(!cross_origin.contains("scope=host"));
    assert!(!cross_origin.contains("account-only=private"));

    let sibling_scope = Url::parse("https://analytics.google.com/v3/signin/check").unwrap();
    let sibling_scope = session
        .cookie_header(&sibling_scope)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(sibling_scope.contains("scope=shared"));
    assert!(!sibling_scope.contains("scope=host"));

    let mut deletion = reqwest::header::HeaderMap::new();
    deletion.append(
        header::SET_COOKIE,
        "visible=; Domain=.google.com; Path=/; Max-Age=0; Secure"
            .parse()
            .unwrap(),
    );
    session.observe_cookies(&deletion, &target).unwrap();
    assert!(!session
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("visible="));
}

#[test]
fn upstream_domain_expiry_does_not_delete_a_distinct_host_only_cookie() {
    let session = session("https://analytics.google.com/");
    let target = Url::parse("https://accounts.google.com/").unwrap();
    let mut server = reqwest::header::HeaderMap::new();
    server.append(
        header::SET_COOKIE,
        "shared=host-only; Path=/; Secure".parse().unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "shared=domain; Domain=.google.com; Path=/; Secure"
            .parse()
            .unwrap(),
    );
    session.observe_cookies(&server, &target).unwrap();

    let mut expiry = reqwest::header::HeaderMap::new();
    expiry.append(
        header::SET_COOKIE,
        "shared=; Domain=.google.com; Path=/; Max-Age=0; Secure"
            .parse()
            .unwrap(),
    );
    session.observe_cookies(&expiry, &target).unwrap();

    let native = session.cookie_header(&target).unwrap();
    let native = native.to_str().unwrap();
    assert!(native.contains("shared=host-only"));
    assert!(!native.contains("shared=domain"));
}

#[test]
fn google_cookie_state_survives_replacement_and_late_source_response() {
    let original = Arc::new(
        ProxyNetworkState::default()
            .with_google_routes(Some(session("https://analytics.google.com/"))),
    );
    let original_google = original.google.as_ref().unwrap();
    let target = Url::parse("https://accounts.google.com/v3/signin/identifier").unwrap();
    let mut server = reqwest::header::HeaderMap::new();
    server.append(
        header::SET_COOKIE,
        "__Host-GAPS=restart-session; Path=/; Secure; HttpOnly; SameSite=None"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "shared=restart-domain; Domain=.google.com; Path=/; Secure"
            .parse()
            .unwrap(),
    );
    original_google.observe_cookies(&server, &target).unwrap();

    let state = original.take_google_cookie_state_for_replacement().unwrap();
    original.begin_replacement();

    let mut replacement = google::GoogleSession::new(
        Some(ReviewedApplicationProfile::GoogleHosted),
        &Url::parse("https://analytics.google.com/").unwrap(),
        "http://p22222222222222222222222222222222.localhost:53123",
        client(),
        client(),
    )
    .unwrap()
    .unwrap();
    replacement.restore_cookie_state(state);

    let mut late = reqwest::header::HeaderMap::new();
    late.append(
        header::SET_COOKIE,
        "__Host-GAPS=rotated-after-handoff; Path=/; Secure; HttpOnly; SameSite=None"
            .parse()
            .unwrap(),
    );
    original_google.observe_cookies(&late, &target).unwrap();

    // The old listener/runtime drops after graceful shutdown. Its final
    // network revoke must not clear cookie state now owned by the successor.
    drop(original.server_guard());

    let native = replacement
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(native.contains("__Host-GAPS=rotated-after-handoff"));
    assert!(native.contains("shared=restart-domain"));
    let mut bridge = axum::http::HeaderMap::new();
    bridge.insert(
        "x-sorng-google-cookie-path",
        "/v3/signin/identifier".parse().unwrap(),
    );
    assert!(!replacement
        .document_cookie_string("https://accounts.google.com", &bridge)
        .unwrap()
        .contains("__Host-GAPS="));
}

#[test]
fn dead_listener_retains_google_cookies_for_manager_recovery() {
    let original = Arc::new(
        ProxyNetworkState::default()
            .with_google_routes(Some(session("https://analytics.google.com/"))),
    );
    let target = Url::parse("https://accounts.google.com/v3/signin/identifier").unwrap();
    let mut server = reqwest::header::HeaderMap::new();
    server.append(
        header::SET_COOKIE,
        "__Host-GAPS=listener-died; Path=/; Secure; HttpOnly"
            .parse()
            .unwrap(),
    );
    original
        .google
        .as_ref()
        .unwrap()
        .observe_cookies(&server, &target)
        .unwrap();

    // Natural listener/runtime teardown happens before the health monitor asks
    // the manager to recover the session.
    drop(original.server_guard());
    assert!(!original.is_active());

    let state = original.take_google_cookie_state_for_replacement().unwrap();
    let mut replacement = session("https://analytics.google.com/");
    replacement.restore_cookie_state(state);
    assert!(replacement
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("__Host-GAPS=listener-died"));
}

#[tokio::test]
async fn clearing_pending_recoveries_cancels_work_and_prevents_publication() {
    let manager = ProxySessionManager::new();
    let token = manager
        .lock()
        .unwrap()
        .begin_proxy_recovery("source-session")
        .unwrap();
    let cancellation = {
        let token = token.clone();
        tokio::spawn(async move { token.cancelled().await })
    };
    manager.lock().unwrap().cancel_all_proxy_recoveries();
    tokio::time::timeout(std::time::Duration::from_secs(1), cancellation)
        .await
        .expect("clear cancels pending work promptly")
        .unwrap();
    let replacement_token = manager
        .lock()
        .unwrap()
        .begin_proxy_recovery("source-session")
        .unwrap();
    assert!(!manager
        .lock()
        .unwrap()
        .finish_proxy_recovery("source-session", &token));
    assert!(manager
        .lock()
        .unwrap()
        .finish_proxy_recovery("source-session", &replacement_token));
}

#[tokio::test]
async fn replacement_closes_admission_then_drains_an_admitted_request() {
    let network = Arc::new(ProxyNetworkState::default());
    let request = network.begin_request().expect("request is admitted");
    network.begin_replacement();
    assert!(network.begin_request().is_none());

    let retiring = network.clone();
    let retirement = tokio::spawn(async move {
        retiring.retire_for_replacement().await;
    });
    tokio::task::yield_now().await;
    assert!(!retirement.is_finished());

    drop(request);
    tokio::time::timeout(std::time::Duration::from_secs(1), retirement)
        .await
        .expect("retirement drains promptly")
        .unwrap();
    assert!(!network.is_active());
}

#[test]
fn fetch_credential_mode_is_closed_and_never_forwarded_upstream() {
    let session = session("https://analytics.google.com/");
    let mut incoming = axum::http::HeaderMap::new();
    incoming.insert("x-sorng-google-credentials", "omit".parse().unwrap());
    assert!(!session.includes_credentials(&incoming).unwrap());
    incoming.insert("x-sorng-google-credentials", "include".parse().unwrap());
    assert!(session.includes_credentials(&incoming).unwrap());
    let forwarded = session.request_headers(&incoming, "https://analytics.google.com");
    assert!(forwarded
        .iter()
        .any(|(name, value)| name == "x-sorng-google-credentials" && value == "include"));
    incoming.insert("x-sorng-google-credentials", "invalid".parse().unwrap());
    assert!(session.includes_credentials(&incoming).is_err());
}

#[tokio::test]
async fn google_identifier_and_password_grants_are_document_bound_single_use_stages() {
    let state = state("https://accounts.google.com");
    activate(&state);
    state.document_sequence.store(1, Ordering::SeqCst);
    let identifier_script = crate::themed_autologin::build_autologin_injection(
        &state,
        1,
        "https://accounts.google.com/v3/signin/identifier",
    )
    .unwrap();
    assert!(identifier_script.contains("fetchCredsAndRun(NONCE,SEL, 'google')"));
    let identifier_nonce = identifier_script
        .split_once("var NONCE=\"")
        .unwrap()
        .1
        .split('"')
        .next()
        .unwrap()
        .to_owned();
    let identifier = crate::themed_autologin::autologin_cred_handler(
        axum::extract::State(state.clone()),
        axum::extract::Query(AutoLoginQuery {
            nonce: identifier_nonce.clone(),
            phase: None,
        }),
    )
    .await;
    assert_eq!(identifier.status(), axum::http::StatusCode::OK);
    let identifier_body = axum::body::to_bytes(identifier.into_body(), 4096)
        .await
        .unwrap();
    let identifier_json: serde_json::Value = serde_json::from_slice(&identifier_body).unwrap();
    assert_eq!(identifier_json["username"], "saved-user");
    assert!(identifier_json.get("password").is_none());
    let continuation = identifier_json["continuation"].as_str().unwrap().to_owned();

    let replay = crate::themed_autologin::autologin_cred_handler(
        axum::extract::State(state.clone()),
        axum::extract::Query(AutoLoginQuery {
            nonce: identifier_nonce,
            phase: None,
        }),
    )
    .await;
    assert_eq!(replay.status(), axum::http::StatusCode::FORBIDDEN);

    state.document_sequence.store(2, Ordering::SeqCst);
    let password_script = crate::themed_autologin::build_autologin_injection(
        &state,
        2,
        "https://accounts.google.com/v3/signin/challenge/pwd",
    )
    .unwrap();
    assert!(password_script.contains("fetchCredsAndRun(NONCE,SEL, 'google-password')"));
    let password_nonce = password_script
        .split_once("var NONCE=\"")
        .unwrap()
        .1
        .split('"')
        .next()
        .unwrap()
        .to_owned();
    assert_eq!(password_nonce, continuation);
    let password = crate::themed_autologin::autologin_cred_handler(
        axum::extract::State(state.clone()),
        axum::extract::Query(AutoLoginQuery {
            nonce: password_nonce.clone(),
            phase: Some("password".into()),
        }),
    )
    .await;
    assert_eq!(password.status(), axum::http::StatusCode::OK);
    let password_body = axum::body::to_bytes(password.into_body(), 4096)
        .await
        .unwrap();
    let password_json: serde_json::Value = serde_json::from_slice(&password_body).unwrap();
    assert_eq!(password_json["password"], "saved-password");
    assert!(password_json.get("username").is_none());

    let replay = crate::themed_autologin::autologin_cred_handler(
        axum::extract::State(state),
        axum::extract::Query(AutoLoginQuery {
            nonce: password_nonce,
            phase: Some("password".into()),
        }),
    )
    .await;
    assert_eq!(replay.status(), axum::http::StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn off_catalog_requests_fail_before_any_direct_network_fallback() {
    let session = session("https://analytics.google.com/");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let destination = Url::parse(&format!(
        "http://{}/private",
        listener.local_addr().unwrap()
    ))
    .unwrap();
    match session
        .send(&reqwest::Method::GET, &destination, &[], &[], true)
        .await
    {
        Err(upstream::UpstreamError::Policy(detail)) => {
            assert_eq!(detail, "Google destination is not approved.")
        }
        _ => panic!("off-catalog destination did not fail closed"),
    }
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), listener.accept())
            .await
            .is_err()
    );
}
