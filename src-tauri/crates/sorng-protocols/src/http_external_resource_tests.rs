use super::*;
use crate::http::{
    external_resources, ExternalResourceKind as Kind, ExternalResourceOrigin, PageScripts,
};
use reqwest::Url;

fn resource_policy() -> HttpProxyPolicy {
    HttpProxyPolicy {
        external_resource_origins: vec![
            ExternalResourceOrigin {
                origin: CDN.into(),
                kinds: vec![Kind::Script, Kind::Stylesheet],
            },
            ExternalResourceOrigin {
                origin: CSS.into(),
                kinds: vec![Kind::Stylesheet],
            },
        ],
        ..policy()
    }
}

fn script(bytes: &[u8]) -> Reply {
    Reply {
        mime: "application/javascript; charset=utf-8",
        bytes: bytes.into(),
        ..Reply::font()
    }
}

fn resource(fixture: &FixtureProxy, destination: &str, kind: &str) -> reqwest::RequestBuilder {
    client()
        .get(format!("{}{}", fixture.base, external_resources::PATH))
        .query(&[("destination", destination), ("kind", kind)])
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
        .header(
            "Sec-Fetch-Dest",
            if kind == "script" { "script" } else { "style" },
        )
}

#[test]
fn resource_defaults_roundtrip_strict_shape_and_explicit_optouts() {
    let old = serde_json::json!({"version":1,"pageScripts":"allow","httpsOnly":false,"sameOriginOnly":false,"cacheMode":"normal","queryParameters":[]});
    let policy: HttpProxyPolicy = serde_json::from_value(old.clone()).unwrap();
    assert!(policy.allow_external_fonts);
    assert_eq!(policy.external_font_origins.len(), 4);
    let catalog: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../src/utils/protocol/commonResourceOrigins.json"
    ))
    .unwrap();
    assert_eq!(
        serde_json::to_value(&policy.external_resource_origins).unwrap(),
        catalog
    );
    assert_eq!(policy.external_resource_origins.len(), 7);
    assert!(policy
        .validate(&Url::parse("https://source.invalid/").unwrap())
        .is_ok());
    let manifest = external_resources::manifest(&policy, "http://session.localhost").unwrap();
    assert_eq!(manifest["origins"], catalog);
    assert_eq!(
        manifest["proxyEndpoint"],
        format!("http://session.localhost{}", external_resources::PATH)
    );
    assert_eq!(manifest["version"], 1);
    let roundtrip: HttpProxyPolicy =
        serde_json::from_value(serde_json::to_value(&policy).unwrap()).unwrap();
    assert!(roundtrip.external_resource_origins == policy.external_resource_origins);
    let mut explicit = old.clone();
    explicit["allowExternalFonts"] = false.into();
    explicit["externalFontOrigins"] = serde_json::json!([]);
    explicit["externalResourceOrigins"] = serde_json::json!([]);
    let disabled: HttpProxyPolicy = serde_json::from_value(explicit).unwrap();
    assert!(external_fonts::manifest(&disabled, "http://session.localhost").is_none());
    assert!(external_resources::manifest(&disabled, "http://session.localhost").is_none());
    for bad in [
        serde_json::json!(null),
        serde_json::json!([{"origin":CDN,"kinds":["fetch"]}]),
        serde_json::json!([{"origin":CDN,"kinds":["script"],"wildcard":true}]),
    ] {
        let mut raw = old.clone();
        raw["externalResourceOrigins"] = bad;
        assert!(serde_json::from_value::<HttpProxyPolicy>(raw).is_err());
    }
    assert!(!format!("{policy:?}").contains("stripe"));
}

#[test]
fn resource_grants_are_exact_https_bounded_and_kind_specific() {
    let target = Url::parse("https://source.invalid/").unwrap();
    for origin in [
        "http://cdn.invalid",
        "https://*.cdn.invalid",
        "https://@cdn.invalid",
        "https://u:p@cdn.invalid",
        "https://cdn.invalid/path",
        "https://cdn.invalid/..",
        "https://cdn.invalid?x=1",
        "https://cdn.invalid#x",
        "https://cdn.invalid\\evil",
    ] {
        let mut policy = resource_policy();
        policy.external_resource_origins[0].origin = origin.into();
        assert!(policy.validate(&target).is_err(), "{origin}");
        assert!(external_resources::manifest(&policy, "http://local").is_none());
    }
    for kinds in [vec![], vec![Kind::Script, Kind::Script]] {
        let mut policy = resource_policy();
        policy.external_resource_origins[0].kinds = kinds;
        assert!(policy.validate(&target).is_err());
    }
    let mut policy = resource_policy();
    policy.external_resource_origins = (0..17)
        .map(|i| ExternalResourceOrigin {
            origin: format!("https://cdn{i}.invalid"),
            kinds: vec![Kind::Script],
        })
        .collect();
    assert!(policy.validate(&target).is_err());
    policy.external_resource_origins.pop();
    assert!(policy.validate(&target).is_ok());
    policy.external_resource_origins[1].origin =
        format!("{}/", policy.external_resource_origins[0].origin);
    assert!(policy.validate(&target).is_err());
}

#[test]
fn static_resources_precede_font_capability_and_preserve_scripts_integrity_and_inert_text() {
    let source = Url::parse("https://site.invalid/page").unwrap();
    let proxy = "http://session.localhost";
    let html = r#"<link rel="stylesheet" href="https://cdn.jsdelivr.net/bootstrap.css"><link rel="preload" as="style" href="https://cdnjs.cloudflare.com/pre.css"><link rel="modulepreload" href="https://cdn.jsdelivr.net/module.js"><link rel="preload" as="script" href="https://js.stripe.com/v3/"><script src="https://js.stripe.com/v3/" integrity="sha384-untouched" crossorigin="anonymous"></script><script>const x="<script src='https://js.stripe.com/inert'>";</script><textarea><link rel="stylesheet" href="https://cdn.jsdelivr.net/inert"></textarea><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&amp;display=swap"><style>@font-face{src:url(https://fonts.gstatic.com/font.woff2)}</style>"#;
    let rewritten = external_resources::rewrite(
        html,
        Some("text/html"),
        &source,
        proxy,
        &HttpProxyPolicy::default(),
    );
    assert_eq!(rewritten.matches(external_resources::PATH).count(), 5);
    assert_eq!(rewritten.matches(external_fonts::PATH).count(), 2);
    assert!(rewritten.contains("integrity=\"sha384-untouched\" crossorigin=\"anonymous\""));
    assert!(rewritten.contains("src='https://js.stripe.com/inert'"));
    assert!(rewritten.contains("href=\"https://cdn.jsdelivr.net/inert\""));
    assert_eq!(
        external_resources::rewrite(
            &rewritten,
            Some("text/html"),
            &source,
            proxy,
            &HttpProxyPolicy::default()
        ),
        rewritten
    );
    for mode in [PageScripts::InlineOnly, PageScripts::Block] {
        let policy = HttpProxyPolicy {
            page_scripts: mode,
            ..Default::default()
        };
        let rewritten =
            external_resources::rewrite(html, Some("text/html"), &source, proxy, &policy);
        assert!(!rewritten.contains("kind=script"));
        assert!(rewritten.contains("kind=stylesheet"));
        let grants = external_resources::manifest(&policy, proxy).unwrap();
        assert!(!grants.to_string().contains("\"script\""));
    }
    let policy = HttpProxyPolicy {
        same_origin_only: true,
        ..Default::default()
    };
    assert_eq!(
        external_resources::rewrite(html, Some("text/html"), &source, proxy, &policy),
        html
    );
}

#[tokio::test]
async fn resource_endpoint_preserves_script_bytes_and_strips_all_source_credentials() {
    let bytes = b"\xef\xbb\xbf/* SRI bytes including CRLF */\r\nwindow.sdk = 'https://fonts.example.invalid/unchanged';\r\n";
    let server = server(HashMap::from([("/sdk.js?public=1".into(), script(bytes))])).await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        resource_policy(),
    )
    .await;
    for _ in 0..2 {
        let response = resource(&fixture, &format!("{CDN}/sdk.js?public=1"), "script")
            .header("Cookie", "source-private=secret")
            .header("Authorization", "Bearer source-secret")
            .header("Referer", "https://source-only.invalid/private")
            .header("X-Custom-Secret", "secret")
            .header("User-Agent", "ResourceFixture/1")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "text/javascript");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        for name in [
            "set-cookie",
            "x-private",
            "location",
            "access-control-allow-origin",
        ] {
            assert!(!response.headers().contains_key(name));
        }
        let csp = response.headers()["content-security-policy"]
            .to_str()
            .unwrap();
        assert!(csp.contains("script-src 'self'"));
        assert!(!csp.contains(CDN));
        assert_eq!(response.bytes().await.unwrap().as_ref(), bytes);
    }
    let seen = server.seen.lock().unwrap();
    assert_eq!(seen.len(), 4);
    for pair in seen.as_chunks::<2>().0 {
        assert!(pair[0]
            .to_ascii_lowercase()
            .contains("proxy-authorization: basic "));
        assert!(pair[1].starts_with("GET /sdk.js?public=1 "));
        let request = pair[1].to_ascii_lowercase();
        assert!(request.contains("user-agent: resourcefixture/1"));
        for forbidden in [
            "authorization:",
            "cookie:",
            "referer:",
            "origin:",
            "secret",
            "source-",
            "proxy-user",
            "sec-fetch",
            "localhost",
        ] {
            assert!(!request.contains(forbidden), "{request}");
        }
    }
    let sessions = fixture.state.global_sessions.lock().unwrap();
    for entry in &sessions.request_log {
        assert!(!entry.url.contains("destination=") && !entry.url.contains("public=1"));
    }
}

#[tokio::test]
async fn resource_redirects_revalidate_kind_origin_https_and_have_finite_hops() {
    let server = server(HashMap::from([
        ("/ok".into(), Reply::redirect("/sdk.js")),
        ("/sdk.js".into(), script(b"window.ok=true;")),
        (
            "/wrong-kind".into(),
            Reply::redirect(&format!("{CSS}/sdk.js")),
        ),
        (
            "/foreign".into(),
            Reply::redirect("https://foreign.invalid/sdk.js"),
        ),
        (
            "/http".into(),
            Reply::redirect("http://fonts.example.invalid/sdk.js"),
        ),
        (
            "/userinfo".into(),
            Reply::redirect("https://@fonts.example.invalid/sdk.js"),
        ),
        ("/loop".into(), Reply::redirect("/loop")),
    ]))
    .await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        resource_policy(),
    )
    .await;
    assert_eq!(
        resource(&fixture, &format!("{CDN}/ok"), "script")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    for path in ["wrong-kind", "foreign", "http", "userinfo", "loop"] {
        assert_eq!(
            resource(&fixture, &format!("{CDN}/{path}"), "script")
                .send()
                .await
                .unwrap()
                .status(),
            502
        );
    }
    let seen = server.seen.lock().unwrap();
    assert_eq!(seen.len(), 20); // 2 success + 4 refused redirects + 4 loop requests, each CONNECT + GET.
    assert!(seen
        .iter()
        .filter(|s| s.starts_with("CONNECT"))
        .all(|s| s.starts_with("CONNECT fonts.example.invalid:443 ")));
}

#[tokio::test]
async fn resource_css_import_and_fonts_rebase_anonymously_with_safe_glyph_escapes() {
    // Realistic Font Awesome glyph + Bootstrap toggler + escaped utility
    // selectors. No external public endpoints or live SDK execution.
    let css = r#"@import './nested.css';@font-face{font-family:"Font Awesome 6 Free";src:url('../font.woff2') format('woff2')} .fa-user:before{content:"\f007"}.sm\:block,.\31 0{display:block}.navbar-toggler-icon{background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 30 30'><path stroke='rgba(0,0,0,.55)' d='M4 7h22M4 15h22M4 23h22'/></svg>")}.image{background:url('/private.png')}"#;
    let server = server(HashMap::from([("/css/main.css".into(), Reply::css(css))])).await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        resource_policy(),
    )
    .await;
    let response = resource(&fixture, &format!("{CDN}/css/main.css"), "stylesheet")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let css = response.text().await.unwrap();
    assert!(css.contains(external_resources::PATH));
    assert!(css.contains("%2Fcss%2Fnested.css&kind=stylesheet"));
    assert!(css.contains("%2Ffont.woff2&kind=font"));
    assert!(css.contains(r#"content:"\f007""#));
    assert!(css.contains(r#".sm\:block,.\31 0"#));
    assert!(css.contains("data:image/svg+xml,%3Csvg"));
    assert!(!css.contains("<svg"));
    // Generic url() only has the font capability, never website auth; binary
    // font validation refuses an image even on an approved font origin.
    assert!(!css.contains("url('/private.png')"));
}

#[test]
fn resource_static_primary_origin_is_never_replaced_by_anonymous_capability() {
    let base = Url::parse("https://cdn.jsdelivr.net/app/index.html").unwrap();
    let html = r#"<script src="/primary.js"></script><script src="https://cdn.jsdelivr.net/primary.js"></script><link rel="stylesheet" href="https://cdn.jsdelivr.net/primary.css"><style>@font-face{src:url(https://cdn.jsdelivr.net/font.woff2)}</style>"#;
    assert_eq!(
        external_resources::rewrite(
            html,
            Some("text/html"),
            &base,
            "http://local",
            &HttpProxyPolicy::default()
        ),
        html
    );
    let css = "@import './primary.css';@font-face{src:url(https://cdn.jsdelivr.net/font.woff2)}";
    assert_eq!(
        external_resources::rewrite(
            css,
            Some("text/css"),
            &base,
            "http://local",
            &HttpProxyPolicy::default()
        ),
        css
    );
}

#[tokio::test]
async fn resource_request_guards_reject_before_any_external_io() {
    let server = server(HashMap::new()).await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        resource_policy(),
    )
    .await;
    for destination in [
        format!("{CSS}/wrong-kind.js"),
        "http://fonts.example.invalid/a".into(),
        "https://@fonts.example.invalid/a".into(),
        "https://sub.fonts.example.invalid/a".into(),
        format!("{CDN}/a#fragment"),
        format!("{CDN}/{}", "x".repeat(8192)),
    ] {
        assert_eq!(
            resource(&fixture, &destination, "script")
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    for query in [
        ("kind", "script"),
        ("destination", CDN),
        ("extra", "secret"),
    ] {
        assert_eq!(
            resource(&fixture, &format!("{CDN}/sdk.js"), "script")
                .query(&[query])
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    for kind in ["fetch", "font", "frame", "SCRIPT"] {
        assert_eq!(
            resource(&fixture, &format!("{CDN}/sdk.js"), kind)
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    for (name, value, status) in [
        ("Origin", "https://foreign.invalid", 403),
        ("Sec-Fetch-Site", "cross-site", 403),
        ("Sec-Fetch-Dest", "document", 405),
        ("Upgrade", "websocket", 405),
        ("Sec-WebSocket-Key", "invalid", 405),
    ] {
        let mut request = resource(&fixture, &format!("{CDN}/sdk.js"), "script")
            .build()
            .unwrap();
        request.headers_mut().insert(
            reqwest::header::HeaderName::from_bytes(name.as_bytes()).unwrap(),
            value.parse().unwrap(),
        );
        assert_eq!(client().execute(request).await.unwrap().status(), status);
    }
    let mut post = resource(&fixture, &format!("{CDN}/sdk.js"), "script")
        .build()
        .unwrap();
    *post.method_mut() = reqwest::Method::POST;
    assert_eq!(client().execute(post).await.unwrap().status(), 405);
    assert_eq!(
        resource(&fixture, &format!("{CDN}/sdk.js"), "script")
            .body("x")
            .send()
            .await
            .unwrap()
            .status(),
        405
    );
    let requests = fixture
        .state
        .network
        .font_assets
        .as_ref()
        .unwrap()
        .requests
        .acquire_many(32)
        .await
        .unwrap();
    assert_eq!(
        resource(&fixture, &format!("{CDN}/sdk.js"), "script")
            .send()
            .await
            .unwrap()
            .status(),
        429
    );
    drop(requests);
    assert!(server.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn resource_policy_script_restrictions_and_disabled_routes_do_not_fetch() {
    let server = server(HashMap::new()).await;
    for policy in [
        HttpProxyPolicy {
            external_resource_origins: vec![],
            ..resource_policy()
        },
        HttpProxyPolicy {
            same_origin_only: true,
            ..resource_policy()
        },
        HttpProxyPolicy {
            page_scripts: PageScripts::Block,
            ..resource_policy()
        },
        HttpProxyPolicy {
            page_scripts: PageScripts::InlineOnly,
            ..resource_policy()
        },
    ] {
        let expected = if policy.same_origin_only || policy.external_resource_origins.is_empty() {
            403
        } else {
            400
        };
        let fixture = fixture(
            Some(ReviewedFontAssets::fixture(server.client.clone())),
            policy,
        )
        .await;
        assert_eq!(
            resource(&fixture, &format!("{CDN}/sdk.js"), "script")
                .send()
                .await
                .unwrap()
                .status(),
            expected
        );
    }
    assert!(server.seen.lock().unwrap().is_empty());
    let unavailable = fixture(None, resource_policy()).await;
    assert_eq!(
        resource(&unavailable, &format!("{CDN}/sdk.js"), "script")
            .send()
            .await
            .unwrap()
            .status(),
        503
    );
}

#[tokio::test]
async fn resource_revoke_cancels_inflight_download_and_closes_the_socket() {
    let server = server(HashMap::from([(
        "/hold".into(),
        Reply {
            hold: true,
            ..script(b"")
        },
    )]))
    .await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        resource_policy(),
    )
    .await;
    let request = resource(&fixture, &format!("{CDN}/hold"), "script");
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
}

#[tokio::test]
async fn resource_production_dispatch_checks_host_and_generation_without_forwarding_markers() {
    let server = server(HashMap::from([(
        "/sdk.js".into(),
        script(b"window.fixture=true;"),
    )]))
    .await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        resource_policy(),
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
            .get(format!("{base}{}", external_resources::PATH))
            .query(&[
                ("destination", format!("{CDN}/sdk.js")),
                ("kind", "script".into()),
            ])
            .header("Host", &fixture.state.proxy_authority)
            .header("Origin", &fixture.state.proxy_origin)
            .header("Sec-Fetch-Dest", "script")
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
    let mut foreign = request().build().unwrap();
    foreign
        .headers_mut()
        .insert("host", "foreign.localhost".parse().unwrap());
    assert_eq!(client().execute(foreign).await.unwrap().status(), 403);
    let seen = server.seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    assert!(!seen[1].contains("__sorng"));
    task.abort();
}

#[tokio::test]
async fn resource_body_and_download_deadline_are_bounded_and_release_permits() {
    let server = server(HashMap::from([(
        "/hold".into(),
        Reply {
            hold: true,
            ..script(b"")
        },
    )]))
    .await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        resource_policy(),
    )
    .await;
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("destination", &format!("{CDN}/hold"))
        .append_pair("kind", "script")
        .finish();
    let request = |body| {
        axum::http::Request::builder()
            .uri(format!("{}?{query}", external_resources::PATH))
            .header("Host", &fixture.state.proxy_authority)
            .header("Origin", &fixture.state.proxy_origin)
            .header("Sec-Fetch-Dest", "script")
            .body(body)
            .unwrap()
    };
    let stalled = Body::from_stream(futures_util::stream::pending::<
        Result<axum::body::Bytes, std::io::Error>,
    >());
    let response = tokio::time::timeout(
        Duration::from_secs(2),
        external_resources::handle_with_timeout(
            fixture.state.clone(),
            request(stalled),
            Duration::from_millis(25),
        ),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), 504);
    assert!(server.seen.lock().unwrap().is_empty());
    let response = tokio::time::timeout(
        Duration::from_secs(2),
        external_resources::handle_with_timeout(
            fixture.state.clone(),
            request(Body::empty()),
            Duration::from_millis(250),
        ),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), 504);
    let assets = fixture.state.network.font_assets.as_ref().unwrap();
    assert_eq!(assets.requests.available_permits(), 32);
    assert_eq!(assets.downloads.available_permits(), 4);
}

#[tokio::test]
async fn resource_tls_does_not_inherit_unverified_source_client() {
    let server = server(HashMap::from([(
        "/sdk.js".into(),
        script(b"window.fixture=true;"),
    )]))
    .await;
    let strict = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(&server.proxy).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    // fixture() deliberately allows invalid certs on the source-site client;
    // this distinct external client must still reject the synthetic CA.
    let fixture = fixture(Some(ReviewedFontAssets::fixture(strict)), resource_policy()).await;
    assert_eq!(
        resource(&fixture, &format!("{CDN}/sdk.js"), "script")
            .send()
            .await
            .unwrap()
            .status(),
        502
    );
    assert_eq!(server.seen.lock().unwrap().len(), 1); // CONNECT, no HTTP after TLS failure.
}

#[tokio::test]
async fn resource_static_default_google_fonts_and_resource_manifest_in_real_proxy_response() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let router = axum::Router::new().fallback(|| async {
        Response::builder().header("Content-Type", "text/html").body(Body::from(r#"<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&amp;display=swap"><link rel="stylesheet" href="https://cdn.jsdelivr.net/bootstrap.css"><script src="https://js.stripe.com/v3/" integrity="sha384-unchanged"></script><style>@font-face{src:url(https://fonts.gstatic.com/font.woff2)}</style></head><body></body></html>"#)).unwrap()
    });
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let fixture = proxy_with_policy(
        origin,
        client(),
        UpstreamAuthMode::None,
        HttpProxyPolicy::default(),
        HashMap::new(),
    )
    .await;
    let response = fetch(&fixture, "/").await;
    assert_eq!(response.status(), 200);
    let csp = response.headers()["content-security-policy"]
        .to_str()
        .unwrap();
    assert!(csp.contains("script-src 'self'") && csp.contains("style-src 'self'"));
    assert!(!csp.contains("stripe") && !csp.contains("googleapis"));
    let html = response.text().await.unwrap();
    assert!(html.contains("%2Fcss2%3Ffamily%3DInter%26display%3Dswap&amp;kind=stylesheet"));
    assert!(html.contains("%2Ffont.woff2&kind=font"));
    assert!(html.contains("%2Fbootstrap.css&amp;kind=stylesheet"));
    assert!(html.contains("%2Fv3%2F&amp;kind=script"));
    assert!(html.contains("integrity=\"sha384-unchanged\""));
    assert!(html.contains("\"externalResources\":{") && html.contains("\"externalFonts\":{"));
    task.abort();
}

#[tokio::test]
async fn resource_endpoint_rejects_mime_html_size_and_unsafe_css() {
    let server = server(HashMap::from([
        (
            "/html".into(),
            Reply {
                mime: "text/html",
                ..script(b"<html>private</html>")
            },
        ),
        (
            "/lying".into(),
            script(b" <!DOCTYPE html><html>private</html>"),
        ),
        ("/large".into(), script(&vec![b' '; 4 * 1024 * 1024 + 1])),
        ("/css-large".into(), Reply::css(&" ".repeat(256 * 1024 + 1))),
        (
            "/json".into(),
            Reply {
                mime: "application/json",
                ..script(b"{}")
            },
        ),
        (
            "/escaped.css".into(),
            Reply::css(r#".x{background:u\72l('/private')}"#),
        ),
        (
            "/image-set.css".into(),
            Reply::css(".x{background:image-set('/private' 1x)}"),
        ),
    ]))
    .await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        resource_policy(),
    )
    .await;
    for (path, kind) in [
        ("html", "script"),
        ("lying", "script"),
        ("large", "script"),
        ("json", "script"),
        ("css-large", "stylesheet"),
        ("escaped.css", "stylesheet"),
        ("image-set.css", "stylesheet"),
    ] {
        let response = resource(&fixture, &format!("{CDN}/{path}"), kind)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 502, "{path}");
        assert!(!response.text().await.unwrap().contains("private"));
    }
}
