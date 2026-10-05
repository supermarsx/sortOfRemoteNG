//! Opt-in anonymous scripts use the actual bounded CONNECT/TLS fixture.
use super::*;

fn all_scripts() -> HttpProxyPolicy {
    HttpProxyPolicy {
        allow_all_scripts: true,
        allow_external_fonts: false,
        external_font_origins: vec![],
        external_resource_origins: vec![],
        ..Default::default()
    }
}

#[test]
fn allow_all_scripts_is_optional_strict_and_subordinate_to_restrictive_controls() {
    let mut old = serde_json::to_value(HttpProxyPolicy::default()).unwrap();
    old.as_object_mut().unwrap().remove("allowAllScripts");
    assert!(!serde_json::from_value::<HttpProxyPolicy>(old.clone())
        .unwrap()
        .allows_all_scripts());
    for bad in [
        serde_json::json!(null),
        serde_json::json!(1),
        serde_json::json!("true"),
    ] {
        old["allowAllScripts"] = bad;
        assert!(serde_json::from_value::<HttpProxyPolicy>(old.clone()).is_err());
    }
    let enabled = all_scripts();
    let manifest = external_resources::manifest(&enabled, "http://fixture.localhost").unwrap();
    assert_eq!(manifest["allowAllScripts"], true);
    assert_eq!(manifest["origins"], serde_json::json!([]));
    for restricted in [
        HttpProxyPolicy {
            same_origin_only: true,
            ..all_scripts()
        },
        HttpProxyPolicy {
            page_scripts: PageScripts::Block,
            ..all_scripts()
        },
        HttpProxyPolicy {
            page_scripts: PageScripts::InlineOnly,
            ..all_scripts()
        },
        HttpProxyPolicy {
            version: 2,
            ..all_scripts()
        },
    ] {
        assert!(!restricted.allows_all_scripts());
        assert!(external_resources::manifest(&restricted, "http://fixture.localhost").is_none());
        let csp = crate::http::network::content_security_policy(&restricted, "fixture.localhost");
        assert!(!csp
            .split("script-src ")
            .nth(1)
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .contains("data:"));
    }
}

#[test]
fn allow_all_scripts_rewrites_only_script_sinks_and_keeps_mandatory_egress_csp() {
    let html = r#"<script src="https://new.example/sdk.js" integrity="sha384-test"></script><link rel="modulepreload" href="https://future.example/module.js"><link rel="stylesheet" href="https://new.example/style.css"><img src="https://new.example/image.png"><script src="data:text/javascript,void(0)"></script>"#;
    let source = Url::parse("https://source.example/").unwrap();
    let rewritten = external_resources::rewrite(
        html,
        Some("text/html"),
        &source,
        "http://fixture.localhost",
        &all_scripts(),
    );
    assert_eq!(rewritten.matches(external_resources::PATH).count(), 2);
    assert!(rewritten.contains("integrity=\"sha384-test\""));
    assert!(rewritten.contains("href=\"https://new.example/style.css\""));
    assert!(rewritten.contains("src=\"https://new.example/image.png\""));
    assert!(rewritten.contains("data:text/javascript,void(0)"));
    let csp = crate::http::network::content_security_policy(&all_scripts(), "fixture.localhost");
    assert!(csp.contains("script-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'"));
    assert!(csp.contains("connect-src 'self' ws://fixture.localhost"));
    assert!(csp.contains("worker-src 'none'; object-src 'none'; base-uri 'self'"));
    assert!(!csp.contains("https:") && !csp.contains('*'));
}

#[tokio::test]
async fn allow_all_scripts_unknown_origin_and_redirect_remain_anonymous_and_session_local() {
    let server = server(HashMap::from([
        (
            "/first.js".into(),
            Reply::redirect(&format!("{CSS}/final.js")),
        ),
        ("/final.js".into(), script(b"window.futureScript=true;")),
    ]))
    .await;
    let enabled = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        all_scripts(),
    )
    .await;
    let response = resource(&enabled, &format!("{CDN}/first.js"), "script")
        .header("Cookie", "PHPSESSID=private")
        .header("Authorization", "Bearer private")
        .header("Referer", "https://source.example/private")
        .header("X-Private", "private")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert!(!response.headers().contains_key("set-cookie"));
    assert_eq!(response.text().await.unwrap(), "window.futureScript=true;");
    {
        let seen = server.seen.lock().unwrap();
        assert_eq!(seen.len(), 4);
        for pair in seen.as_chunks::<2>().0 {
            assert!(pair[0].starts_with("CONNECT "));
            let request = pair[1].to_ascii_lowercase();
            for secret in [
                "cookie:",
                "authorization:",
                "referer:",
                "origin:",
                "private",
                "source.example",
            ] {
                assert!(!request.contains(secret), "{request}");
            }
        }
    }
    // A second protected proxy with no opt-in cannot use the grant or transport.
    let disabled = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        HttpProxyPolicy {
            allow_all_scripts: false,
            ..all_scripts()
        },
    )
    .await;
    assert_eq!(
        resource(&disabled, &format!("{CDN}/first.js"), "script")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        resource(&enabled, &format!("{CDN}/first.js"), "stylesheet")
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(server.seen.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn allow_all_scripts_rejects_unsafe_urls_methods_and_redirects_before_egress() {
    let server = server(HashMap::from([
        (
            "/http.js".into(),
            Reply::redirect("http://insecure.invalid/script.js"),
        ),
        (
            "/credentials.js".into(),
            Reply::redirect(&format!(
                "https://user:private@{}/script.js",
                Url::parse(CSS).unwrap().host_str().unwrap()
            )),
        ),
        ("/loop.js".into(), Reply::redirect("/loop.js")),
    ]))
    .await;
    let fixture = fixture(
        Some(ReviewedFontAssets::fixture(server.client.clone())),
        all_scripts(),
    )
    .await;
    for url in [
        "http://insecure.invalid/script.js",
        "https://user:private@fonts.example.invalid/script.js",
        "file:///secret",
        "data:text/javascript,void(0)",
        "https://fonts.example.invalid/script.js#fragment",
    ] {
        assert_eq!(
            resource(&fixture, url, "script")
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    assert!(server.seen.lock().unwrap().is_empty());
    let response = client()
        .post(format!("{}{}", fixture.base, external_resources::PATH))
        .query(&[
            ("destination", format!("{CDN}/first.js")),
            ("kind", "script".into()),
        ])
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
        .body("private")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 405);
    assert!(server.seen.lock().unwrap().is_empty());
    for path in ["/http.js", "/credentials.js", "/loop.js"] {
        assert_eq!(
            resource(&fixture, &format!("{CDN}{path}"), "script")
                .send()
                .await
                .unwrap()
                .status(),
            502
        );
    }
    // Two rejected redirect targets never receive a CONNECT; the loop is bounded.
    assert_eq!(server.seen.lock().unwrap().len(), 12);
}

#[tokio::test]
async fn allow_all_scripts_restrictive_controls_and_missing_transport_never_fall_back() {
    let server = server(HashMap::new()).await;
    for policy in [
        HttpProxyPolicy {
            same_origin_only: true,
            ..all_scripts()
        },
        HttpProxyPolicy {
            page_scripts: PageScripts::Block,
            ..all_scripts()
        },
        HttpProxyPolicy {
            page_scripts: PageScripts::InlineOnly,
            ..all_scripts()
        },
    ] {
        let fixture = fixture(
            Some(ReviewedFontAssets::fixture(server.client.clone())),
            policy,
        )
        .await;
        assert_eq!(
            resource(&fixture, &format!("{CDN}/script.js"), "script")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    let unavailable = fixture(None, all_scripts()).await;
    assert_eq!(
        resource(&unavailable, &format!("{CDN}/script.js"), "script")
            .send()
            .await
            .unwrap()
            .status(),
        503
    );
    assert!(server.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn allow_all_scripts_revoke_cancels_download_and_rejects_retained_capability() {
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
        all_scripts(),
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
    assert_eq!(
        resource(&fixture, &format!("{CDN}/hold"), "script")
            .send()
            .await
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
    assert_eq!(server.seen.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn allow_all_scripts_real_response_overrides_script_csp_only() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let router = axum::Router::new().fallback(|| async {
        Response::builder()
            .header("Content-Type", "text/html")
            .header("Content-Security-Policy", "default-src 'none'; script-src 'nonce-private'; frame-ancestors 'none'; img-src https://upstream-only.example")
            .header("Content-Security-Policy", "frame-ancestors 'self'; connect-src 'none'")
            .header("Content-Security-Policy-Report-Only", "script-src 'none'; frame-ancestors 'none'")
            .body(Body::from(r#"<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-private'; script-src-elem 'none'; style-src 'self'; require-trusted-types-for 'script'"><script src="https://future.example/sdk.js"></script></head><body onclick="window.fixture=1"></body></html>"#)).unwrap()
    });
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let fixture = proxy_with_policy(
        origin,
        client(),
        UpstreamAuthMode::None,
        all_scripts(),
        HashMap::new(),
    )
    .await;
    let response = fetch(&fixture, "/").await;
    assert_eq!(response.status(), 200);
    let policies: Vec<_> = response
        .headers()
        .get_all("content-security-policy")
        .iter()
        .map(|h| h.to_str().unwrap().to_owned())
        .collect();
    assert_eq!(policies.len(), 1);
    assert!(!policies[0].contains("frame-ancestors"));
    assert!(!policies[0].contains("upstream-only.example"));
    assert!(!response
        .headers()
        .contains_key("content-security-policy-report-only"));
    assert!(policies.iter().any(|p| p.contains("connect-src 'self'")
        && p.contains("worker-src 'none'")
        && !p.contains('*')));
    let html = response.text().await.unwrap();
    assert!(html.contains("\"allowAllScripts\":true"));
    assert!(html.contains("future.example%2Fsdk.js&amp;kind=script"));
    assert!(!html.contains("script-src-elem &#39;none&#39;"));
    assert!(html.contains("style-src &#39;self&#39;"));
    assert!(html.contains(
        "script-src &#39;self&#39; * data: blob: &#39;unsafe-inline&#39; &#39;unsafe-eval&#39;"
    ));
    task.abort();
}
