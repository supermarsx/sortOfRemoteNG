//! Real protected proxy handlers against synthetic HTTPS peers reachable only
//! through a loopback CONNECT proxy. No external provider or OS trust changes.
use super::*;
use axum::http::HeaderMap;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const UA: &str = "Native-WebView-Fixture/1";
const HINTS: &[(&str, &str)] = &[
    (
        "sec-ch-ua",
        "\"Native WebView\";v=\"1\", \"Not;A=Brand\";v=\"99\"",
    ),
    ("sec-ch-ua-mobile", "?0"),
    ("sec-ch-ua-platform", "\"Windows\""),
    ("sec-ch-ua-arch", "\"x86\""),
    ("sec-ch-ua-bitness", "\"64\""),
    ("sec-ch-ua-form-factors", "\"Desktop\""),
    ("sec-ch-ua-full-version", "\"1.2.3.4\""),
    (
        "sec-ch-ua-full-version-list",
        "\"Native WebView\";v=\"1.2.3.4\"",
    ),
    ("sec-ch-ua-model", "\"\""),
    ("sec-ch-ua-platform-version", "\"19.0.0\""),
    ("sec-ch-ua-wow64", "?0"),
];

#[test]
fn collector_strips_all_connection_lines_before_origin_mapping() {
    let mut incoming = HeaderMap::new();
    incoming.append("connection", "X-Local, Origin".parse().unwrap());
    incoming.append("connection", "Referer, Sec-CH-UA-Arch".parse().unwrap());
    for (name, value) in [
        ("x-local", "private"),
        ("origin", "http://proxy.localhost:1234"),
        ("referer", "http://proxy.localhost:1234/path"),
        ("sec-ch-ua-arch", "\"x86\""),
        ("user-agent", UA),
        ("sec-fetch-site", "same-origin"),
        ("sec-fetch-mode", "cors"),
        ("keep-alive", "timeout=5"),
        ("proxy-connection", "keep-alive"),
        ("te", "trailers"),
        ("trailer", "x-checksum"),
        ("upgrade", "h2c"),
        ("proxy-authorization", "Basic secret"),
        ("proxy-authenticate", "Basic"),
    ] {
        incoming.insert(name, value.parse().unwrap());
    }
    let forwarded: HashMap<_, _> = collect_upstream_headers(
        &incoming,
        UpstreamAuthMode::None,
        "http://proxy.localhost:1234",
        "https://device.test",
    )
    .into_iter()
    .collect();
    assert_eq!(forwarded.len(), 4, "{forwarded:?}");
    assert_eq!(forwarded["user-agent"], UA);
    assert_eq!(forwarded["sec-fetch-site"], "same-origin");
    assert_eq!(forwarded["sec-fetch-mode"], "cors");
    assert_eq!(
        forwarded["accept-encoding"],
        proxy_response::ACCEPT_ENCODING
    );
}

#[test]
fn collector_preserves_browser_identity_and_required_mapping_without_invention() {
    let proxy = "http://proxy.localhost:1234";
    let mut incoming = HeaderMap::new();
    for &(name, value) in HINTS {
        incoming.insert(name, value.parse().unwrap());
    }
    incoming.insert("user-agent", UA.parse().unwrap());
    incoming.insert("origin", proxy.parse().unwrap());
    incoming.insert(
        "referer",
        format!("{proxy}/login?a=%2F&dup=1&dup=2&__sorng_navigation_v1=private")
            .parse()
            .unwrap(),
    );
    incoming.insert("cookie", "sid=browser".parse().unwrap());
    incoming.insert("authorization", "Bearer website".parse().unwrap());
    let original = incoming.clone();
    let forwarded: HashMap<_, _> = collect_upstream_headers(
        &incoming,
        UpstreamAuthMode::None,
        proxy,
        "https://device.test",
    )
    .into_iter()
    .collect();
    for &(name, value) in HINTS {
        assert_eq!(forwarded[name], value);
    }
    assert_eq!(forwarded["user-agent"], UA);
    assert_eq!(forwarded["origin"], "https://device.test");
    assert_eq!(
        forwarded["referer"],
        "https://device.test/login?a=%2F&dup=1&dup=2"
    );
    assert_eq!(forwarded["cookie"], "sid=browser");
    assert_eq!(forwarded["authorization"], "Bearer website");
    assert_eq!(incoming, original);
    let empty = collect_upstream_headers(
        &HeaderMap::new(),
        UpstreamAuthMode::None,
        proxy,
        "https://device.test",
    );
    assert_eq!(
        empty,
        [(
            "accept-encoding".into(),
            proxy_response::ACCEPT_ENCODING.into()
        )]
    );
}

async fn read_head(socket: &mut (impl AsyncRead + Unpin)) -> String {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        assert!(bytes.len() < 32_768);
        bytes.push(socket.read_u8().await.unwrap());
    }
    String::from_utf8(bytes).unwrap()
}

fn field<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.split("\r\n")
        .skip(1)
        .filter_map(|line| line.split_once(':'))
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.trim())
}

struct Fixture {
    base: String,
    state: Arc<AxumProxyState>,
    seen: Arc<std::sync::Mutex<Vec<(String, String)>>>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.state.network.revoke();
        for task in &self.tasks {
            task.abort();
        }
    }
}

async fn fixture(
    source: &str,
    profile: Option<ReviewedApplicationProfile>,
    custom: HashMap<String, String>,
) -> Fixture {
    let cert = rcgen::generate_simple_self_signed(vec![
        "device.test".into(),
        "analytics.google.com".into(),
        "accounts.google.com".into(),
        "dash.cloudflare.com".into(),
        "challenges.cloudflare.com".into(),
    ])
    .unwrap();
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
    let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://{}", peer.local_addr().unwrap())).unwrap())
        .add_root_certificate(reqwest::Certificate::from_der(&der).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = seen.clone();
    let peer_task = tokio::spawn(async move {
        let mut children = tokio::task::JoinSet::new();
        loop {
            let (mut tcp, _) = peer.accept().await.unwrap();
            let (acceptor, captured) = (acceptor.clone(), captured.clone());
            children.spawn(async move {
                let connect = read_head(&mut tcp).await;
                let destination = connect.lines().next().unwrap().to_owned();
                tcp.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.unwrap();
                let mut socket = acceptor.accept(tcp).await.unwrap();
                let mut request = read_head(&mut socket).await;
                let length = field(&request, "content-length").map_or(0, |v| v.parse::<usize>().unwrap());
                assert!(length < 4096);
                let mut body = vec![0; length];
                socket.read_exact(&mut body).await.unwrap();
                request.push_str(std::str::from_utf8(&body).unwrap());
                // The production proxy strips its private navigation query
                // before forwarding. Recognize the resulting bare path too.
                let html = request.starts_with("GET /login ") || request.starts_with("GET /login?");
                captured.lock().unwrap().push((destination, request));
                let (kind, body) = if html {
                    ("text/html", "<!doctype html><html><head></head><body><iframe src=\"https://challenges.cloudflare.com/frame\"></iframe></body></html>")
                } else { ("application/json", "{}") };
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nSet-Cookie: native_session=fixture; Secure; HttpOnly; Path=/\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            });
        }
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let authority = format!("p{}.localhost:{port}", uuid::Uuid::new_v4().simple());
    let origin = format!("http://{authority}");
    let source_url = reqwest::Url::parse(source).unwrap();
    let google = google::GoogleSession::new(
        profile,
        &source_url,
        &origin,
        upstream.clone(),
        upstream.clone(),
    )
    .unwrap();
    let challenge = cloudflare_challenge::CloudflareChallenge::new(
        profile,
        &source_url,
        &origin,
        upstream.clone(),
    )
    .unwrap();
    let network = ProxyNetworkState::default()
        .with_google_routes(google)
        .with_cloudflare_challenge(challenge)
        .with_reviewed_application_profile(profile);
    let state = Arc::new(AxumProxyState {
        attempt: None,
        network: Arc::new(network),
        website_dark_mode: Default::default(),
        session_id: uuid::Uuid::new_v4().to_string(),
        connection_id: "header-fixture".into(),
        target_url: format!("{source}/"),
        target_origin: source.into(),
        username: Arc::new(std::sync::RwLock::new(String::new())),
        password: Arc::new(std::sync::RwLock::new(String::new())),
        upstream_auth_mode: UpstreamAuthMode::None,
        proxy_policy: HttpProxyPolicy::default(),
        redirect_profile: None,
        tactical_rmm_api: None,
        custom_headers: custom,
        pending_nonce: Default::default(),
        theme: Arc::new(std::sync::RwLock::new(
            crate::theme_tokens::ThemeTokens::dark_default(),
        )),
        proxy_origin: origin,
        proxy_authority: authority,
        auto_login_armed: Arc::new(AtomicBool::new(false)),
        auto_login_nonce: Default::default(),
        bitwarden_continuation: Default::default(),
        auto_login_selectors: None,
        http_form_automation: None,
        yealink_session: yealink_login::session_slot(),
        client: upstream,
        document_sequence: Arc::new(AtomicU64::new(0)),
        request_count: Arc::new(AtomicU64::new(0)),
        error_count: Arc::new(AtomicU64::new(0)),
        last_error: Default::default(),
        global_sessions: ProxySessionManager::new(),
        credentials_applied: None,
    });
    let router = ProxySessionRuntime::new(state.clone()).router();
    let proxy_task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    Fixture {
        base: format!("http://127.0.0.1:{port}"),
        state,
        seen,
        tasks: vec![peer_task, proxy_task],
    }
}

fn request(fixture: &Fixture, origin: &str, path: &str) -> reqwest::RequestBuilder {
    let browser = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    browser
        .get(format!("{}{path}", fixture.base))
        .header("host", origin.trim_start_matches("http://"))
}

fn identity(mut request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    request = request.header("user-agent", UA);
    for &(name, value) in HINTS {
        request = request.header(name, value);
    }
    request
}

async fn ok(request: reqwest::RequestBuilder) {
    let response = request.send().await.unwrap();
    let status = response.status();
    let body = response.text().await.unwrap();
    assert_eq!(status, 200, "{body}");
}

fn assert_identity(head: &str, ua: &str) {
    assert_eq!(field(head, "user-agent"), Some(ua));
    for &(name, value) in HINTS {
        assert_eq!(field(head, name), Some(value), "{name}");
    }
}

#[tokio::test]
async fn generic_handler_keeps_native_identity_and_explicit_custom_ua_over_connect() {
    for custom in [None, Some("Explicit-User-Choice/7")] {
        let fixture = fixture(
            "https://device.test",
            None,
            custom
                .map(|ua| HashMap::from([("User-Agent".into(), ua.into())]))
                .unwrap_or_default(),
        )
        .await;
        let origin = &fixture.state.proxy_origin;
        ok(
            identity(request(&fixture, origin, "/echo?a=%2F&dup=1&dup=2"))
                .header("origin", origin)
                .header("referer", format!("{origin}/app?a=%2f"))
                .header("connection", "X-Local, keep-alive")
                .header("connection", "X-Second")
                .header("x-local", "private")
                .header("x-second", "private")
                .header("keep-alive", "timeout=9")
                .header("proxy-connection", "keep-alive")
                .header("sec-fetch-mode", "cors")
                .header("sec-fetch-site", "same-origin")
                .header("sec-fetch-dest", "empty")
                .header("cookie", "browser_session=one")
                .header("authorization", "Bearer website"),
        )
        .await;
        let seen = fixture.seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].0, "CONNECT device.test:443 HTTP/1.1");
        let head = &seen[0].1;
        assert!(head.starts_with("GET /echo?a=%2F&dup=1&dup=2 HTTP/1.1\r\n"));
        assert_identity(head, custom.unwrap_or(UA));
        for name in [
            "x-local",
            "x-second",
            "keep-alive",
            "proxy-connection",
            "proxy-authorization",
        ] {
            assert_eq!(field(head, name), None, "{name}");
        }
        assert_eq!(field(head, "origin"), Some("https://device.test"));
        assert_eq!(
            field(head, "referer"),
            Some("https://device.test/app?a=%2f")
        );
        assert_eq!(field(head, "sec-fetch-site"), Some("same-origin"));
        assert_eq!(field(head, "sec-fetch-mode"), Some("cors"));
        assert_eq!(field(head, "sec-fetch-dest"), Some("empty"));
        assert_eq!(field(head, "cookie"), Some("browser_session=one"));
        assert_eq!(field(head, "authorization"), Some("Bearer website"));
    }
}

#[tokio::test]
async fn google_handler_preserves_omit_until_consumed_and_never_restores_hop_headers() {
    let fixture = fixture(
        "https://analytics.google.com",
        Some(ReviewedApplicationProfile::GoogleHosted),
        HashMap::new(),
    )
    .await;
    let google = fixture.state.network.google.as_ref().unwrap();
    let origin = &google
        .routes
        .iter()
        .find(|r| r.upstream_origin == "https://accounts.google.com")
        .unwrap()
        .proxy_origin;
    // Seed the authoritative upstream jar through the real response path.
    ok(request(&fixture, origin, "/seed")).await;
    for mode in ["omit", "include"] {
        ok(identity(request(&fixture, origin, "/echo"))
            .header("origin", origin)
            .header("referer", format!("{origin}/app"))
            .header("connection", "x-sorng-google-credentials, Origin, X-Local")
            .header("connection", "Referer")
            .header("x-local", "private")
            .header("x-sorng-google-credentials", mode)
            .header("cookie", "localhost_secret=never")
            .header("sec-fetch-site", "same-origin")
            .header("sec-fetch-mode", "cors")
            .header("sec-fetch-dest", "empty"))
        .await;
        let seen = fixture.seen.lock().unwrap();
        let (connect, head) = seen.last().unwrap();
        assert_eq!(connect, "CONNECT accounts.google.com:443 HTTP/1.1");
        assert_identity(head, UA);
        for name in ["x-sorng-google-credentials", "origin", "referer", "x-local"] {
            assert_eq!(field(head, name), None, "{name}");
        }
        assert_eq!(field(head, "sec-fetch-mode"), Some("cors"));
        assert_eq!(field(head, "sec-fetch-site"), Some("same-origin"));
        assert_eq!(
            field(head, "cookie"),
            if mode == "include" {
                Some("native_session=fixture")
            } else {
                None
            }
        );
    }
    ok(request(&fixture, origin, "/mapped")
        .header("origin", origin)
        .header(
            "referer",
            format!("{origin}/app?dup=1&dup=2&__sorng_google_hop_v1=3"),
        ))
    .await;
    let seen = fixture.seen.lock().unwrap();
    assert_eq!(
        field(&seen.last().unwrap().1, "origin"),
        Some("https://accounts.google.com")
    );
    assert_eq!(
        field(&seen.last().unwrap().1, "referer"),
        Some("https://accounts.google.com/app?dup=1&dup=2")
    );
}

#[tokio::test]
async fn cloudflare_handler_preserves_hints_cookie_isolation_mapping_and_exact_grants() {
    let fixture = fixture(
        "https://dash.cloudflare.com",
        Some(ReviewedApplicationProfile::Cloudflare),
        HashMap::from([("X-Dashboard-Secret".into(), "saved".into())]),
    )
    .await;
    let source = &fixture.state.proxy_origin;
    let response = request(
        &fixture,
        source,
        "/login?__sorng_navigation_v1=0123456789abcdef0123456789abcdef",
    )
    .header("sec-fetch-dest", "iframe")
    .header("sec-fetch-mode", "navigate")
    .send()
    .await
    .unwrap();
    let status = response.status();
    let html = response.text().await.unwrap();
    assert_eq!(status, 200, "{html}");
    let manifest: serde_json::Value = serde_json::from_str(
        html.split_once("var sorngNetworkClient=installWebNetworkClient(")
            .unwrap()
            .1
            .split_once(",function(detail)")
            .unwrap()
            .0,
    )
    .unwrap();
    let alias = manifest["cloudflareChallenge"]["proxyOrigin"]
        .as_str()
        .unwrap();
    for nominated in [false, true] {
        let mut req = identity(request(&fixture, alias, "/echo"))
            .header("origin", source)
            .header("referer", format!("{source}/private"))
            .header("cookie", "dashboard_secret=never")
            .header("authorization", "Bearer never")
            .header("x-dashboard-secret", "never")
            .header("x-local", "never")
            .header("proxy-authorization", "Basic never");
        if nominated {
            req = req.header("connection", "Origin, Referer, Sec-CH-UA-Arch, X-Local");
        }
        ok(req).await;
        let seen = fixture.seen.lock().unwrap();
        let (connect, head) = seen.last().unwrap();
        assert_eq!(connect, "CONNECT challenges.cloudflare.com:443 HTTP/1.1");
        assert_eq!(field(head, "user-agent"), Some(UA));
        for &(name, value) in HINTS {
            assert_eq!(
                field(head, name),
                if nominated && name == "sec-ch-ua-arch" {
                    None
                } else {
                    Some(value)
                },
                "{name}"
            );
        }
        for name in [
            "authorization",
            "proxy-authorization",
            "x-dashboard-secret",
            "x-local",
        ] {
            assert_eq!(field(head, name), None, "{name}");
        }
        assert_eq!(
            field(head, "origin"),
            if nominated {
                None
            } else {
                Some("https://dash.cloudflare.com")
            }
        );
        assert_eq!(
            field(head, "referer"),
            if nominated {
                None
            } else {
                Some("https://dash.cloudflare.com/")
            }
        );
        assert_eq!(
            field(head, "cookie"),
            if nominated {
                Some("native_session=fixture")
            } else {
                None
            }
        );
    }
    // Mapping from the challenge alias itself remains separate from dashboard mapping.
    ok(request(&fixture, alias, "/mapped")
        .header("origin", alias)
        .header("referer", format!("{alias}/frame")))
    .await;
    {
        let seen = fixture.seen.lock().unwrap();
        assert_eq!(
            field(&seen.last().unwrap().1, "origin"),
            Some("https://challenges.cloudflare.com")
        );
        assert_eq!(
            field(&seen.last().unwrap().1, "referer"),
            Some("https://challenges.cloudflare.com/frame")
        );
        assert_eq!(field(&seen.last().unwrap().1, "user-agent"), None);
        for &(name, _) in HINTS {
            assert_eq!(field(&seen.last().unwrap().1, name), None);
        }
    }
    let count = fixture.seen.lock().unwrap().len();
    let refused = request(&fixture, "http://unknown.localhost:1234", "/echo")
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), 403);
    let refused = request(&fixture, alias, "/echo")
        .header("origin", "https://foreign.test")
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), 403);
    assert_eq!(fixture.seen.lock().unwrap().len(), count);
}
