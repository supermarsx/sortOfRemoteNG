//! Actual anonymous CONNECT + verified TLS tests, using ephemeral test-only CA
//! roots. No public DNS, OS certificate installation, or source client reuse.
use super::*;
use crate::http::{external_fonts, font_assets::ReviewedFontAssets};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

// Share the isolated CONNECT/TLS fixture, never a production account/server.
#[path = "http_external_resource_tests.rs"]
mod external_resource_tests;

const CDN: &str = "https://fonts.example.invalid";
const CSS: &str = "https://css.example.invalid";

fn policy() -> HttpProxyPolicy {
    HttpProxyPolicy {
        allow_external_fonts: true,
        external_font_origins: vec![CDN.into(), CSS.into()],
        query_parameters: vec![proxy_policy::QueryParameter {
            name: "source-query".into(),
            value: "secret".into(),
        }],
        ..Default::default()
    }
}

fn font() -> Vec<u8> {
    let mut bytes = vec![0; 52];
    bytes[..4].copy_from_slice(b"wOF2");
    bytes[4..8].copy_from_slice(&0x0001_0000u32.to_be_bytes());
    bytes[8..12].copy_from_slice(&52u32.to_be_bytes());
    bytes[12..14].copy_from_slice(&1u16.to_be_bytes());
    bytes[16..20].copy_from_slice(&64u32.to_be_bytes());
    bytes[20..24].copy_from_slice(&4u32.to_be_bytes());
    bytes
}

#[derive(Clone)]
struct Reply {
    status: u16,
    mime: &'static str,
    bytes: Vec<u8>,
    location: Option<String>,
    hold: bool,
}
impl Reply {
    fn font() -> Self {
        Self {
            status: 200,
            mime: "font/woff2",
            bytes: font(),
            location: None,
            hold: false,
        }
    }
    fn css(text: &str) -> Self {
        Self {
            mime: "text/css",
            bytes: text.as_bytes().to_vec(),
            ..Self::font()
        }
    }
    fn redirect(location: &str) -> Self {
        Self {
            status: 302,
            location: Some(location.into()),
            bytes: vec![],
            ..Self::font()
        }
    }
}

async fn head<R: AsyncRead + Unpin>(socket: &mut R) -> Option<String> {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        if bytes.len() > 16_384 {
            return None;
        }
        bytes.push(socket.read_u8().await.ok()?);
    }
    String::from_utf8(bytes).ok()
}

struct Server {
    proxy: String,
    client: reqwest::Client,
    seen: Arc<std::sync::Mutex<Vec<String>>>,
    closed: Arc<AtomicBool>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn server(routes: HashMap<String, Reply>) -> Server {
    let mut ca_params = rcgen::CertificateParams::default();
    ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    let ca = rcgen::Certificate::from_params(ca_params).unwrap();
    let leaf = rcgen::Certificate::from_params(rcgen::CertificateParams::new(vec![
        "fonts.example.invalid".into(),
        "css.example.invalid".into(),
    ]))
    .unwrap();
    let cert = leaf.serialize_der_with_signer(&ca).unwrap();
    let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![rustls::pki_types::CertificateDer::from(cert)],
        rustls::pki_types::PrivatePkcs8KeyDer::from(leaf.serialize_private_key_der()).into(),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy = format!("http://{}", listener.local_addr().unwrap());
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(
            reqwest::Proxy::all(&proxy)
                .unwrap()
                .basic_auth("proxy-user", "proxy-password"),
        )
        .add_root_certificate(reqwest::Certificate::from_der(&ca.serialize_der().unwrap()).unwrap())
        .cookie_store(false)
        .referer(false)
        .redirect(reqwest::redirect::Policy::none())
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = seen.clone();
    let closed = Arc::new(AtomicBool::new(false));
    let finished = closed.clone();
    let routes = Arc::new(routes);
    let task = tokio::spawn(async move {
        let mut clients = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                incoming = listener.accept() => {
                    let (mut socket, _) = incoming.unwrap();
                    let seen = captured.clone();
                    let acceptor = acceptor.clone();
                    let routes = routes.clone();
                    let closed = finished.clone();
                    clients.spawn(async move {
                        let Some(connect) = head(&mut socket).await else { return; };
                        seen.lock().unwrap().push(connect);
                        if socket.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.is_err() { return; }
                        let Ok(mut socket) = acceptor.accept(socket).await else { closed.store(true, Ordering::SeqCst); return; };
                        let Some(request) = head(&mut socket).await else { return; };
                        let path = request.split_whitespace().nth(1).unwrap_or("").to_string();
                        seen.lock().unwrap().push(request);
                        let reply = routes.get(&path).cloned().unwrap_or(Reply { status: 404, ..Reply::font() });
                        if reply.hold {
                            let mut byte = [0];
                            let _ = socket.read(&mut byte).await;
                            closed.store(true, Ordering::SeqCst);
                            return;
                        }
                        let location = reply.location.map(|v| format!("Location: {v}\r\n")).unwrap_or_default();
                        let response = format!("HTTP/1.1 {} Fixture\r\nContent-Type: {}\r\nContent-Length: {}\r\n{location}Set-Cookie: cdn-private=secret; Secure\r\nX-Private: secret\r\nConnection: close\r\n\r\n", reply.status, reply.mime, reply.bytes.len());
                        let _ = socket.write_all(response.as_bytes()).await;
                        let _ = socket.write_all(&reply.bytes).await;
                        let _ = socket.shutdown().await;
                    });
                },
                _ = clients.join_next(), if !clients.is_empty() => {}
            }
        }
    });
    Server {
        proxy,
        client,
        seen,
        closed,
        task,
    }
}

async fn fixture(assets: Option<ReviewedFontAssets>, policy: HttpProxyPolicy) -> FixtureProxy {
    let mut network = ProxyNetworkState::default();
    network.font_assets = assets;
    let fixture = proxy_with_policy_and_network(
        "https://source-only.invalid/".into(),
        reqwest::Client::builder()
            .no_proxy()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap(),
        UpstreamAuthMode::Basic,
        policy,
        HashMap::from([("X-Source-Secret".into(), "source-secret".into())]),
        Arc::new(network),
    )
    .await;
    *fixture.state.username.write().unwrap() = "source-user".into();
    *fixture.state.password.write().unwrap() = "source-password".into();
    fixture
}

fn route(fixture: &FixtureProxy, destination: &str, kind: &str) -> reqwest::RequestBuilder {
    client()
        .get(format!("{}{}", fixture.base, external_fonts::PATH))
        .query(&[("destination", destination), ("kind", kind)])
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
        .header(
            "Sec-Fetch-Dest",
            if kind == "stylesheet" {
                "style"
            } else {
                "font"
            },
        )
}

#[tokio::test]
async fn external_fonts_use_anonymous_connect_tls_and_preserve_only_browser_user_agent() {
    let server = server(HashMap::from([
        ("/font.woff2".into(), Reply::font()),
        (
            "/css?family=Inter&display=swap".into(),
            Reply::css(&format!("@font-face{{src:url('{CDN}/font.woff2')}}")),
        ),
    ]))
    .await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        policy(),
    )
    .await;
    for _ in 0..2 {
        let response = route(&fixture, &format!("{CDN}/font.woff2"), "font")
            .header("Cookie", "source-private=secret")
            .header("Authorization", "Bearer source-secret")
            .header("Referer", format!("{}/private", fixture.state.proxy_origin))
            .header("X-Custom-Secret", "source-secret")
            .header("User-Agent", "Mozilla/5.0 BrowserFixture/1")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "font/woff2");
        for name in [
            "set-cookie",
            "location",
            "x-private",
            "access-control-allow-origin",
        ] {
            assert!(!response.headers().contains_key(name));
        }
        assert!(response.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("font-src 'self' data: blob:"));
        assert_eq!(response.bytes().await.unwrap().as_ref(), font());
    }
    let response = route(
        &fixture,
        &format!("{CSS}/css?family=Inter&display=swap"),
        "stylesheet",
    )
    .header("User-Agent", "Mozilla/5.0 BrowserFixture/1")
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), 200);
    assert!(response.text().await.unwrap().contains("kind=font"));
    let seen = server.seen.lock().unwrap();
    assert_eq!(seen.len(), 6);
    for pair in seen.as_chunks::<2>().0 {
        assert!(pair[0].starts_with("CONNECT "));
        assert!(pair[0]
            .to_ascii_lowercase()
            .contains("proxy-authorization: basic "));
        let request = pair[1].to_ascii_lowercase();
        assert!(request.contains("user-agent: mozilla/5.0 browserfixture/1"));
        for forbidden in [
            "authorization:",
            "cookie:",
            "referer:",
            "origin:",
            "source-",
            "secret",
            "proxy-user",
            "sec-fetch",
            "localhost",
        ] {
            assert!(!request.contains(forbidden), "{request}");
        }
    }
    assert!(seen[4].starts_with("CONNECT css.example.invalid:443 "));
    assert!(seen[5].starts_with("GET /css?family=Inter&display=swap "));
}

#[tokio::test]
async fn optout_same_origin_empty_and_invalid_grants_never_contact_upstream() {
    let server = server(HashMap::new()).await;
    let mut policies = vec![
        HttpProxyPolicy {
            allow_external_fonts: false,
            ..policy()
        },
        HttpProxyPolicy {
            same_origin_only: true,
            ..policy()
        },
        HttpProxyPolicy {
            external_font_origins: vec![],
            ..policy()
        },
    ];
    policies.push(HttpProxyPolicy {
        external_font_origins: vec![CDN.into(), format!("{CDN}/")],
        ..policy()
    });
    for policy in policies {
        let fixture = fixture(
            Some(ReviewedFontAssets::fixture(server.client.clone())),
            policy,
        )
        .await;
        assert_eq!(
            route(&fixture, &format!("{CDN}/font.woff2"), "font")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        assert!(
            external_fonts::manifest(&fixture.state.proxy_policy, &fixture.state.proxy_origin)
                .is_none()
        );
    }
    assert!(server.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invalid_routes_methods_bodies_userinfo_and_unapproved_origins_are_local_refusals() {
    let server = server(HashMap::new()).await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        policy(),
    )
    .await;
    for url in [
        "http://fonts.example.invalid/font",
        "https://fonts.example.invalid.evil/font",
        "https://user:secret@fonts.example.invalid/font",
        "https://@fonts.example.invalid/font",
        "https://fonts.example.invalid/font#",
        "https://fonts.example.invalid\\evil/font",
        "https://fonts.example.invalid/\nfont",
    ] {
        assert_eq!(
            route(&fixture, url, "font").send().await.unwrap().status(),
            400,
            "destination: {url:?}"
        );
        assert!(
            server.seen.lock().unwrap().is_empty(),
            "destination: {url:?}"
        );
    }
    let url = format!("{CDN}/font.woff2");
    for (case, request) in [
        ("invalid kind", route(&fixture, &url, "script")),
        ("body", route(&fixture, &url, "font").body("no")),
        (
            "upgrade",
            route(&fixture, &url, "font").header("Upgrade", "websocket"),
        ),
        (
            "duplicate kind",
            route(&fixture, &url, "font").query(&[("kind", "font")]),
        ),
        (
            "unknown query",
            route(&fixture, &url, "font").query(&[("other", "secret")]),
        ),
        (
            "conflicting destinations",
            route(&fixture, &url, "font").header("Sec-Fetch-Dest", "script"),
        ),
        (
            "duplicate destinations",
            route(&fixture, &url, "font").header("Sec-Fetch-Dest", "font"),
        ),
    ] {
        assert_eq!(request.send().await.unwrap().status(), 400, "{case}");
        assert!(server.seen.lock().unwrap().is_empty(), "{case}");
    }
    // RequestBuilder::header appends. Replace explicitly to exercise a single
    // invalid destination separately from the ambiguous duplicate cases above.
    let mut wrong_destination = route(&fixture, &url, "font").build().unwrap();
    wrong_destination
        .headers_mut()
        .insert("sec-fetch-dest", "script".parse().unwrap());
    assert_eq!(
        client().execute(wrong_destination).await.unwrap().status(),
        400
    );
    assert!(server.seen.lock().unwrap().is_empty());
    for second_site in ["same-origin", "cross-site"] {
        assert_eq!(
            route(&fixture, &url, "font")
                .header("Sec-Fetch-Site", "same-origin")
                .header("Sec-Fetch-Site", second_site)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        assert!(server.seen.lock().unwrap().is_empty());
    }
    let mut post = route(&fixture, &url, "font").build().unwrap();
    *post.method_mut() = reqwest::Method::POST;
    assert_eq!(client().execute(post).await.unwrap().status(), 400);
    assert_eq!(
        route(&fixture, &url, "font")
            .header("Origin", "https://foreign.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert!(server.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn css_redirects_resolve_against_final_url_and_every_hop_has_its_own_origin_check() {
    let css = "@import '../next.css'; @font-face{src:url('../files/font.woff2')} .x{background:url('https://denied.invalid/a.svg')}";
    let server = server(HashMap::from([
        (
            "/start".into(),
            Reply::redirect(&format!("{CDN}/nested/end.css")),
        ),
        ("/nested/end.css".into(), Reply::css(css)),
        (
            "/deny".into(),
            Reply::redirect("https://denied.invalid/font.woff2"),
        ),
        (
            "/downgrade".into(),
            Reply::redirect("http://fonts.example.invalid/font.woff2"),
        ),
        (
            "/credentials".into(),
            Reply::redirect("https://user:secret@fonts.example.invalid/font.woff2"),
        ),
        ("/loop".into(), Reply::redirect("/loop")),
    ]))
    .await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        policy(),
    )
    .await;
    let response = route(&fixture, &format!("{CSS}/start"), "stylesheet")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let css = response.text().await.unwrap();
    assert!(
        css.contains("destination=https%3A%2F%2Ffonts.example.invalid%2Fnext.css&kind=stylesheet")
    );
    assert!(css.contains(
        "destination=https%3A%2F%2Ffonts.example.invalid%2Ffiles%2Ffont.woff2&kind=font"
    ));
    assert!(css.contains("https://denied.invalid/a.svg"));
    assert!(server.seen.lock().unwrap()[2].starts_with("CONNECT fonts.example.invalid:443 "));
    for path in ["deny", "downgrade", "credentials", "loop"] {
        let before = server.seen.lock().unwrap().len();
        assert_eq!(
            route(&fixture, &format!("{CSS}/{path}"), "font")
                .send()
                .await
                .unwrap()
                .status(),
            502
        );
        assert_eq!(
            server.seen.lock().unwrap().len() - before,
            if path == "loop" { 8 } else { 2 }
        );
    }
}

#[tokio::test]
async fn nonfont_html_svg_mime_masquerades_oversize_and_escaped_css_are_rejected() {
    let server = server(HashMap::from([
        (
            "/html".into(),
            Reply {
                mime: "font/woff2",
                bytes: b"<!doctype html><html>not a font</html>".to_vec(),
                ..Reply::font()
            },
        ),
        (
            "/svg".into(),
            Reply {
                mime: "image/svg+xml",
                bytes: b"<svg/>".to_vec(),
                ..Reply::font()
            },
        ),
        (
            "/mime".into(),
            Reply {
                mime: "text/html",
                ..Reply::font()
            },
        ),
        (
            "/large".into(),
            Reply {
                bytes: vec![0; font_assets::MAX_BYTES + 1],
                ..Reply::font()
            },
        ),
        ("/csshtml".into(), Reply::css("<html>not CSS</html>")),
        (
            "/escape".into(),
            Reply::css(r"@import '\68ttps://fonts.example.invalid/a.css';"),
        ),
        ("/binary".into(), Reply::font()),
    ]))
    .await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        policy(),
    )
    .await;
    for (path, kind) in [
        ("html", "font"),
        ("svg", "font"),
        ("mime", "font"),
        ("large", "font"),
        ("csshtml", "stylesheet"),
        ("escape", "stylesheet"),
        ("binary", "stylesheet"),
    ] {
        let response = route(&fixture, &format!("{CDN}/{path}"), kind)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 502, "{path}");
        assert!(!response.headers().contains_key("location"));
    }
}

#[tokio::test]
async fn production_font_client_rejects_untrusted_certificate_despite_source_bypass() {
    let server = server(HashMap::from([("/font.woff2".into(), Reply::font())])).await;
    let assets =
        ReviewedFontAssets::new(Some(reqwest::Proxy::all(&server.proxy).unwrap()), "1.2").unwrap();
    let fixture = fixture(Some(assets), policy()).await;
    assert_eq!(
        route(&fixture, &format!("{CDN}/font.woff2"), "font")
            .send()
            .await
            .unwrap()
            .status(),
        502
    );
    let seen = server.seen.lock().unwrap();
    assert_eq!(seen.len(), 1); // CONNECT only: no HTTP request after failed TLS.
    assert!(seen[0].starts_with("CONNECT fonts.example.invalid:443 "));
}

#[tokio::test]
async fn revoke_aborts_inflight_fonts_and_unavailable_client_never_falls_back_to_source() {
    let server = server(HashMap::from([(
        "/hold".into(),
        Reply {
            hold: true,
            ..Reply::font()
        },
    )]))
    .await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        policy(),
    )
    .await;
    let request = route(&fixture, &format!("{CDN}/hold"), "font");
    let pending = tokio::spawn(async move { request.send().await.unwrap() });
    tokio::time::timeout(Duration::from_secs(3), async {
        while server.seen.lock().unwrap().len() < 2 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    fixture.state.network.revoke();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), pending)
            .await
            .unwrap()
            .unwrap()
            .status(),
        410
    );
    tokio::time::timeout(Duration::from_secs(2), async {
        while !server.closed.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let unavailable = fixture_with_no_client().await;
    assert_eq!(
        route(&unavailable, &format!("{CDN}/font.woff2"), "font")
            .send()
            .await
            .unwrap()
            .status(),
        503
    );
    assert_eq!(server.seen.lock().unwrap().len(), 2);
}

async fn fixture_with_no_client() -> FixtureProxy {
    fixture(None, policy()).await
}

#[tokio::test]
async fn production_dispatch_strips_valid_generation_and_rejects_duplicate_or_malformed_markers() {
    let server = server(HashMap::from([("/font.woff2".into(), Reply::font())])).await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        policy(),
    )
    .await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let runtime = ProxySessionRuntime::new(fixture.state.clone());
    let router = runtime.router();
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let request = || {
        client()
            .get(format!("{base}{}", external_fonts::PATH))
            .query(&[
                ("destination", format!("{CDN}/font.woff2")),
                ("kind", "font".into()),
            ])
            .header("Host", &fixture.state.proxy_authority)
            .header("Origin", &fixture.state.proxy_origin)
            .header("Sec-Fetch-Dest", "font")
    };
    assert_eq!(
        request()
            .query(&[("__sorng_generation_v1", TOKEN)])
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    for markers in [
        vec![("__sorng_generation_v1", "bad")],
        vec![
            ("__sorng_generation_v1", TOKEN),
            ("__sorng_generation_v1", TOKEN),
        ],
    ] {
        assert_eq!(
            request().query(&markers).send().await.unwrap().status(),
            410
        );
    }
    let seen = server.seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    assert!(!seen[1].contains("__sorng"));
    task.abort();
}

#[tokio::test]
async fn native_static_html_and_proxied_css_are_mapped_before_browser_parsing() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let router = axum::Router::new().fallback(|uri: axum::http::Uri| async move {
        if uri.path() == "/style.css" {
            Response::builder().header("Content-Type", "text/css").body(Body::from(format!(
                "@import '{CSS}/nested.css';@font-face{{src:url('{CDN}/font.woff2')}}"))).unwrap()
        } else {
            Response::builder().header("Content-Type", "text/html").body(Body::from(format!(
                "<!doctype html><html><head><link rel='stylesheet' href='{CSS}/css?family=Inter&amp;display=swap'><link rel='preload' as='font' href='{CDN}/font.woff2'><style>@font-face{{src:url('{CDN}/font.woff2')}}</style></head><body style=\"--font:url('{CDN}/font.woff2')\"><script>const inert=\"<link rel='stylesheet' href='{CSS}/untouched'>\";</script></body></html>"))).unwrap()
        }
    });
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let fixture = proxy_with_policy(
        origin,
        client(),
        UpstreamAuthMode::None,
        policy(),
        HashMap::new(),
    )
    .await;
    let html = fetch(&fixture, "/").await.text().await.unwrap();
    assert!(html.contains("%2Fcss%3Ffamily%3DInter%26display%3Dswap&amp;kind=stylesheet"));
    assert!(html.contains("%2Ffont.woff2&amp;kind=font"));
    assert!(html.contains("%2Ffont.woff2&kind=font")); // style raw text, no entity escaping.
    assert!(html.contains(&format!("href='{CSS}/untouched'"))); // script text is unchanged.
    assert!(html.contains("\"externalFonts\":{"));
    let css = client()
        .get(format!("{}/style.css", fixture.base))
        .header("Host", &fixture.state.proxy_authority)
        .header("Sec-Fetch-Dest", "style")
        .send()
        .await
        .unwrap();
    assert_eq!(css.status(), 200);
    let css = css.text().await.unwrap();
    assert!(css.contains("%2Fnested.css&kind=stylesheet"));
    assert!(css.contains("%2Ffont.woff2&kind=font"));
    task.abort();
}
