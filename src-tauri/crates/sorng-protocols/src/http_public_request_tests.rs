//! Actual protected listener -> anonymous CONNECT/TLS -> fixture wire tests.
use super::*;
use crate::http::{public_requests, PageScripts};

fn opted() -> HttpProxyPolicy {
    HttpProxyPolicy {
        allow_all_requests: true,
        ..policy()
    }
}

async fn public_fixture(server: &Server, policy: HttpProxyPolicy) -> FixtureProxy {
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        policy,
    )
    .await;
    fixture.state.document_sequence.store(3, Ordering::SeqCst);
    fixture.state.network.document_issued(3, true);
    fixture
}

fn request(fixture: &FixtureProxy, url: &str, kind: &str) -> reqwest::RequestBuilder {
    client()
        .get(format!("{}{}", fixture.base, public_requests::PATH))
        .query(&[("destination", url), ("kind", kind), ("document", "3")])
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Site", "same-origin")
}

#[test]
fn public_requests_policy_is_explicit_and_restrictive_controls_win() {
    let mut wire = serde_json::to_value(HttpProxyPolicy::default()).unwrap();
    wire.as_object_mut().unwrap().remove("allowAllRequests");
    let mut policy: HttpProxyPolicy = serde_json::from_value(wire.clone()).unwrap();
    assert!(!policy.allow_all_requests);
    assert!(public_requests::manifest(&policy, "http://fixture.localhost").is_none());
    wire["allowAllRequests"] = "true".into();
    assert!(serde_json::from_value::<HttpProxyPolicy>(wire).is_err());
    policy.allow_all_requests = true;
    assert!(policy.allows_all_requests());
    assert!(policy.allows_all_scripts());
    policy.page_scripts = PageScripts::Block;
    assert!(!policy.allows_all_scripts());
    assert!(policy.allows_all_requests());
    policy.same_origin_only = true;
    assert!(!policy.allows_all_requests());
}

#[tokio::test]
async fn public_requests_post_and_cross_origin_redirect_are_anonymous_on_every_hop() {
    let server = server(HashMap::from([
        (
            "/collect?site=fixture".into(),
            Reply::redirect(&format!("{CSS}/result")),
        ),
        (
            "/result".into(),
            Reply {
                mime: "application/json",
                bytes: b"{\"ok\":true}".to_vec(),
                ..Reply::font()
            },
        ),
    ]))
    .await;
    let fixture = public_fixture(&server, opted()).await;
    let url = format!("{}{}", fixture.base, public_requests::PATH);
    let response = client()
        .post(url)
        .query(&[
            ("destination", format!("{CDN}/collect?site=fixture")),
            ("kind", "fetch".into()),
            ("document", "3".into()),
        ])
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
        .header("Cookie", "source-cookie=secret")
        .header("Authorization", "Bearer source-secret")
        .header("X-Source-Secret", "source-secret")
        .header("X-Api-Key", "browser-secret")
        .header(
            "Referer",
            format!("{}/private?token=secret", fixture.state.proxy_origin),
        )
        .header("Content-Type", "application/json")
        .header("User-Agent", "Fixture Browser")
        .body("{\"event\":\"fixture\"}")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    for forbidden in ["set-cookie", "x-private", "location", "www-authenticate"] {
        assert!(!response.headers().contains_key(forbidden));
    }
    assert_eq!(response.text().await.unwrap(), "{\"ok\":true}");
    let seen = server.seen.lock().unwrap();
    let requests: Vec<_> = seen.iter().filter(|v| !v.starts_with("CONNECT")).collect();
    assert_eq!(requests.len(), 2, "{seen:?}");
    assert!(requests[0].starts_with("POST /collect?site=fixture HTTP/1.1"));
    assert!(requests[0].ends_with("{\"event\":\"fixture\"}"));
    assert!(requests[1].starts_with("GET /result HTTP/1.1"));
    for request in requests {
        let lower = request.to_ascii_lowercase();
        for forbidden in [
            "source-secret",
            "source-cookie",
            "browser-secret",
            "source-query",
            "authorization:",
            "cookie:",
            "referer:",
            "origin:",
            ".localhost",
            "document=",
            "proxy-password",
        ] {
            assert!(
                !lower.contains(forbidden),
                "Unexpected {forbidden} in {lower}"
            );
        }
        assert!(lower.contains("user-agent: fixture browser"));
    }
}

#[tokio::test]
async fn public_requests_css_rewrites_imports_images_and_fonts_without_source_fallback() {
    let server = server(HashMap::from([("/site.css".into(), Reply::css("@import './next.css'; .hero{background:url('./image.png')} @font-face{src:url('./font.woff2')}"))])).await;
    let fixture = public_fixture(&server, opted()).await;
    let response = request(&fixture, &format!("{CDN}/site.css"), "stylesheet")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let css = response.text().await.unwrap();
    assert_eq!(css.matches(public_requests::PATH).count(), 3);
    assert!(css.contains("kind=stylesheet"));
    assert_eq!(css.matches("kind=resource").count(), 2);
    assert_eq!(css.matches("document=3").count(), 3);
    assert!(!css.contains("url('./"));
}

#[tokio::test]
async fn public_requests_passive_resources_do_not_wait_for_readiness_and_still_expire() {
    let server = server(HashMap::from([(
        "/site.css".into(),
        Reply::css("body{color:green}"),
    )]))
    .await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        HttpProxyPolicy {
            page_scripts: PageScripts::Block,
            ..opted()
        },
    )
    .await;
    fixture.state.network.document_issued(3, false);
    assert!(fixture.state.network.selected_document_sequence().is_none());
    let response = tokio::time::timeout(
        Duration::from_secs(2),
        request(&fixture, &format!("{CDN}/site.css"), "stylesheet").send(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        request(&fixture, &format!("{CDN}/site.css"), "script")
            .send()
            .await
            .unwrap()
            .status(),
        405
    );
    fixture.state.network.document_issued(4, false);
    fixture.state.network.activate_document(4).unwrap();
    assert_eq!(
        request(&fixture, &format!("{CDN}/site.css"), "stylesheet")
            .send()
            .await
            .unwrap()
            .status(),
        410
    );
    assert_eq!(
        server
            .seen
            .lock()
            .unwrap()
            .iter()
            .filter(|v| !v.starts_with("CONNECT"))
            .count(),
        1
    );
}

#[tokio::test]
async fn public_requests_css_url_kind_accepts_binary_assets_not_only_stylesheets() {
    let server = server(HashMap::from([(
        "/image.png".into(),
        Reply {
            mime: "image/png",
            bytes: b"fixture-image".to_vec(),
            ..Reply::font()
        },
    )]))
    .await;
    let fixture = public_fixture(&server, opted()).await;
    let response = request(&fixture, &format!("{CDN}/image.png"), "css")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers().get("content-type").unwrap(), "image/png");
    assert_eq!(response.text().await.unwrap(), "fixture-image");
}

#[tokio::test]
async fn public_requests_actual_html_meta_override_preserves_script_block_and_mandatory_egress() {
    let server = server(HashMap::from([("/".into(), Reply {
        mime: "text/html",
        bytes: format!("<!doctype html><html><head><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'nonce-private'; font-src 'none'; img-src 'none'\"><link rel=stylesheet href='{CSS}/style.css'></head><body><img src='{CSS}/image.png'></body></html>").into_bytes(),
        ..Reply::font()
    })])).await;
    let fixture = proxy_with_policy(
        format!("{CDN}/"),
        server.client.clone(),
        UpstreamAuthMode::None,
        HttpProxyPolicy {
            page_scripts: PageScripts::Block,
            query_parameters: vec![],
            ..opted()
        },
        HashMap::new(),
    )
    .await;
    let response = client()
        .get(format!("{}/?__sorng_navigation_v1={TOKEN}", fixture.base))
        .header("Host", &fixture.state.proxy_authority)
        .header("Accept", "text/html")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let csp = response
        .headers()
        .get("content-security-policy")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(csp.contains("script-src 'none'") && !csp.contains('*') && !csp.contains("https:"));
    let html = response.text().await.unwrap();
    assert!(!html.contains("nonce-private") && !html.contains("connect-src &#39;none&#39;"));
    assert!(html.contains(public_requests::PATH));
    assert!(html.contains("script-src &#39;none&#39;"));
}

#[tokio::test]
async fn public_requests_disabled_stale_retired_and_wrong_authority_never_reach_upstream() {
    let server = server(HashMap::new()).await;
    for policy in [
        HttpProxyPolicy::default(),
        HttpProxyPolicy {
            same_origin_only: true,
            ..opted()
        },
    ] {
        let fixture = public_fixture(&server, policy).await;
        assert_eq!(
            request(&fixture, &format!("{CDN}/x"), "fetch")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    let fixture = public_fixture(&server, opted()).await;
    assert_eq!(
        request(&fixture, &format!("{CDN}/x"), "fetch")
            .header("Origin", "https://foreign.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    // A DNS alias reaching the listener cannot manufacture its random Host.
    assert_eq!(
        request(&fixture, &format!("{CDN}/x"), "fetch")
            .header("Host", "127.0.0.1.nip.io")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    fixture.state.network.document_issued(4, false);
    fixture.state.network.activate_document(4).unwrap();
    assert_eq!(
        request(&fixture, &format!("{CDN}/x"), "fetch")
            .send()
            .await
            .unwrap()
            .status(),
        410
    );
    fixture.state.network.revoke();
    assert_eq!(
        request(&fixture, &format!("{CDN}/x"), "fetch")
            .send()
            .await
            .unwrap()
            .status(),
        410
    );
    assert!(server.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn public_requests_unsupported_context_and_unsafe_redirects_fail_closed() {
    let server = server(HashMap::from([
        (
            "/downgrade".into(),
            Reply::redirect("http://elsewhere.invalid/"),
        ),
        (
            "/credentials".into(),
            Reply::redirect("https://user:secret@css.example.invalid/"),
        ),
        ("/control".into(), Reply::redirect("http://127.0.0.1/")),
        (
            "/stream".into(),
            Reply {
                mime: "text/event-stream",
                ..Reply::font()
            },
        ),
    ]))
    .await;
    let fixture = public_fixture(&server, opted()).await;
    for path in ["downgrade", "credentials", "control", "stream"] {
        assert_eq!(
            request(&fixture, &format!("{CDN}/{path}"), "fetch")
                .send()
                .await
                .unwrap()
                .status(),
            502
        );
    }
    for kind in ["form", "document", "eventsource", "websocket", "worker"] {
        assert_eq!(
            request(&fixture, &format!("{CDN}/x"), kind)
                .send()
                .await
                .unwrap()
                .status(),
            405
        );
    }
    // The outer document guard refuses this before the resource handler.
    assert_eq!(
        request(&fixture, &format!("{CDN}/x"), "fetch")
            .header("Sec-Fetch-Dest", "iframe")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        request(&fixture, &format!("{CDN}/x"), "fetch")
            .header("Accept", "text/event-stream")
            .send()
            .await
            .unwrap()
            .status(),
        405
    );
    for url in [
        "http://elsewhere.invalid/",
        "https://u:p@fonts.example.invalid/",
        "https://localhost/x",
        "https://127.1/x",
    ] {
        assert!(!request(&fixture, url, "fetch")
            .send()
            .await
            .unwrap()
            .status()
            .is_success());
    }
    assert_eq!(
        server
            .seen
            .lock()
            .unwrap()
            .iter()
            .filter(|v| !v.starts_with("CONNECT"))
            .count(),
        4
    );
}

#[tokio::test]
async fn public_requests_navigation_is_only_a_current_consumable_receipt() {
    let server = server(HashMap::new()).await;
    let fixture = public_fixture(&server, opted()).await;
    super::super::redirect_tests::register(&fixture);
    fixture.state.auto_login_armed.store(true, Ordering::SeqCst);
    let response = client()
        .get(format!("{}{}", fixture.base, public_requests::NAVIGATION))
        .query(&[
            (
                "destination",
                "https://stock.adobe.com/browse?secret=private#fragment",
            ),
            ("document", "3"),
        ])
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "same-origin")
        .send()
        .await
        .unwrap();
    let text = response.text().await.unwrap();
    assert!(text.contains("redirect_review"));
    assert!(!text.contains("secret=private"));
    let mut manager = fixture.state.global_sessions.lock().unwrap();
    let receipt = manager
        .review_redirect(&fixture.state.session_id, None)
        .unwrap();
    assert_eq!(receipt.destination_url, "https://stock.adobe.com/browse");
    assert!(receipt.removed_query);
    assert!(manager
        .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
        .is_some());
    assert!(manager
        .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
        .is_none());
    assert!(!fixture.state.auto_login_armed.load(Ordering::SeqCst));
    assert!(server.seen.lock().unwrap().is_empty());
}

#[test]
fn public_requests_static_rewrite_and_csp_keep_network_and_document_boundaries() {
    let policy = opted();
    let base = reqwest::Url::parse("https://source.invalid/page").unwrap();
    let proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
    let html = format!("<link rel=stylesheet href='{CDN}/s.css'><script src='{CDN}/s.js'></script><img src='{CDN}/i.png'><iframe src='{CDN}/document'></iframe>");
    let rewritten = public_requests::rewrite(&html, Some("text/html"), &base, proxy, &policy, 3);
    assert_eq!(rewritten.matches(public_requests::PATH).count(), 3);
    assert!(rewritten.contains(&format!("<iframe src='{CDN}/document'>")));
    let csp = public_requests::override_resource_csp("default-src 'none'; style-src 'nonce-x'; style-src-elem 'none'; connect-src 'none'; sandbox allow-scripts; frame-src 'none'; worker-src 'none'");
    assert!(!csp.contains("nonce-x"));
    for directive in [
        "sandbox allow-scripts",
        "frame-src 'none'",
        "worker-src 'none'",
    ] {
        assert!(csp.contains(directive));
    }
    let mandatory = network::content_security_policy(&policy, "fixture.localhost:43123");
    assert!(!mandatory.contains("https:") && !mandatory.contains('*'));
    assert!(mandatory.contains("connect-src 'self'"));
}

#[tokio::test]
async fn public_requests_actual_runtime_strips_generation_and_hosted_receipt_survives_response() {
    let server = server(HashMap::from([("/event".into(), Reply::font())])).await;
    let mut fixture = public_fixture(&server, opted()).await;
    let mut state = (*fixture.state).clone();
    state.target_origin = "https://adminconsole.adobe.com".into();
    state.target_url = format!("{}/", state.target_origin);
    let google = google::GoogleSession::new(
        Some(ReviewedApplicationProfile::AdobeAdminConsole),
        &reqwest::Url::parse(&state.target_origin).unwrap(),
        &state.proxy_origin,
        server.client.clone(),
        server.client.clone(),
    )
    .unwrap();
    let mut network = ProxyNetworkState::default().with_google_routes(google);
    network.font_assets = Some(ReviewedFontAssets::fixture(server.client.clone()));
    state.network = Arc::new(network);
    state.network.document_issued(3, true);
    fixture.state = Arc::new(state);
    super::super::redirect_tests::register(&fixture);
    let runtime = ProxySessionRuntime::new(fixture.state.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let router = runtime.router();
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let response = client()
        .post(format!("{base}{}", public_requests::PATH))
        .query(&[
            ("destination", format!("{CDN}/event")),
            ("kind", "fetch".into()),
            ("document", "3".into()),
            ("__sorng_generation_v1", TOKEN.into()),
        ])
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
        .body("generated-post=fixture")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    for (extra, expected) in [
        (
            "&__sorng_generation_v1=0123456789abcdef0123456789abcdef",
            410,
        ),
        ("&document=3", 400),
    ] {
        let mut url = reqwest::Url::parse(&format!("{base}{}", public_requests::PATH)).unwrap();
        url.query_pairs_mut().extend_pairs([
            ("destination", format!("{CDN}/event")),
            ("kind", "fetch".into()),
            ("document", "3".into()),
            ("__sorng_generation_v1", TOKEN.into()),
        ]);
        let response = client()
            .get(format!("{url}{extra}"))
            .header("Host", &fixture.state.proxy_authority)
            .header("Origin", &fixture.state.proxy_origin)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
    let stale = client()
        .get(format!("{base}{}", public_requests::PATH))
        .query(&[
            ("destination", format!("{CDN}/event")),
            ("kind", "fetch".into()),
            ("document", "2".into()),
            ("__sorng_generation_v1", TOKEN.into()),
        ])
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
        .send()
        .await
        .unwrap();
    assert_eq!(stale.status(), 410);
    {
        let seen = server.seen.lock().unwrap();
        let wire = seen.iter().find(|v| v.starts_with("POST")).unwrap();
        assert!(wire.ends_with("generated-post=fixture"));
        assert!(!wire.contains("__sorng_generation") && !wire.contains("document="));
    }
    let response = client()
        .get(format!("{base}{}", public_requests::NAVIGATION))
        .query(&[
            ("destination", "https://stock.adobe.com/"),
            ("document", "3"),
        ])
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "same-origin")
        .send()
        .await
        .unwrap();
    assert!(response.text().await.unwrap().contains("redirect_review"));
    let mut manager = fixture.state.global_sessions.lock().unwrap();
    let receipt = manager
        .review_redirect(&fixture.state.session_id, None)
        .unwrap();
    assert!(manager
        .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
        .is_some());
    assert_eq!(
        server
            .seen
            .lock()
            .unwrap()
            .iter()
            .filter(|v| !v.starts_with("CONNECT"))
            .count(),
        1
    );
    task.abort();
}
