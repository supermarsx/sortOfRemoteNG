//! First-paint theming through the real protected response handler.
use super::*;

fn palette() -> WebsiteDarkModeBootstrap {
    WebsiteDarkModeBootstrap {
        background_color: "#181a1b".into(),
        text_color: "#e8e6e3".into(),
    }
}

#[tokio::test]
async fn dark_bootstrap_survives_redirects_gzip_and_child_documents_without_changing_policy() {
    const HTML: &str = "<!doctype html><html><head><meta charset='utf-8'><meta http-equiv='Content-Security-Policy' content=\"img-src 'self'\"><style>body{background:white}</style><script>window.upstream=true</script></head><body>Grüße 日本語</body></html>";
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().fallback(|request: axum::extract::Request| async move {
                if request.uri().path() == "/redirect" {
                    return Response::builder()
                        .status(302)
                        .header("Location", "/final")
                        .body(Body::empty())
                        .unwrap();
                }
                Response::builder()
                    .header("Content-Type", "text/html; charset=utf-8")
                    .header("Content-Encoding", "gzip")
                    .header("ETag", "upstream")
                    .body(Body::from(gzip(HTML.as_bytes())))
                    .unwrap()
            }),
        )
        .await
        .unwrap();
    });
    for scripts in [
        PageScripts::Allow,
        PageScripts::InlineOnly,
        PageScripts::Block,
    ] {
        let policy = HttpProxyPolicy {
            same_origin_only: true,
            page_scripts: scripts,
            ..Default::default()
        };
        let proxy = proxy_with_policy(
            format!("http://{address}/"),
            client(),
            UpstreamAuthMode::None,
            policy,
            HashMap::new(),
        )
        .await;
        let disabled = fetch(&proxy, "/final").await;
        let csp = disabled.headers()["Content-Security-Policy"].clone();
        let disabled = disabled.text().await.unwrap();
        assert!(!disabled.contains("<style id=\"__sorng_dark_bootstrap_v1\""));
        *proxy.state.website_dark_mode.write().unwrap() = Some(palette());
        for destination in ["document", "iframe"] {
            let response = client()
                .get(format!("{}/redirect", proxy.base))
                .header("Host", &proxy.state.proxy_authority)
                .header("Sec-Fetch-Dest", destination)
                .header("Sec-Fetch-Mode", "navigate")
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["Content-Security-Policy"], csp);
            assert_eq!(
                response.headers()["Content-Type"],
                "text/html; charset=utf-8"
            );
            assert!(!response.headers().contains_key("Content-Encoding"));
            assert!(!response.headers().contains_key("ETag"));
            assert_eq!(response.headers()["Cache-Control"], "no-store");
            let length = response.content_length().unwrap();
            let body = response.text().await.unwrap();
            assert_eq!(length, body.len() as u64);
            assert!(body.starts_with("<!doctype html><html><head><meta charset='utf-8'>"));
            assert!(body.contains("Grüße 日本語"));
            let start = body
                .find("<style id=\"__sorng_dark_bootstrap_v1\"")
                .unwrap();
            let end = start + body[start..].find("</style>").unwrap();
            let bootstrap = &body[start..end];
            assert!(start < body.find("content=\"img-src 'self'\"").unwrap());
            assert!(start < body.find("<style>body{background:white}").unwrap());
            assert!(body[start..].starts_with(&palette().style().unwrap()));
            assert!(bootstrap.contains("data-background-color=\"#181a1b\""));
            assert!(bootstrap.contains("@layer sorng-force-dark;"));
            assert!(!bootstrap.contains("sorng-dark-loading"));
            assert!(body[start..].contains("[href*='/frontend/jupiter/']"));
            assert!(body[start..].contains(".panel-body"));
            if scripts == PageScripts::Block {
                assert!(!body.contains("proxy_document_start"));
            } else {
                assert!(start < body.find("<script>(function()").unwrap());
            }
        }
        // Native appearance updates affect future documents without replacing
        // the listener, navigation identity, credentials, or network policy.
        *proxy.state.website_dark_mode.write().unwrap() = None;
        assert!(!fetch(&proxy, "/final")
            .await
            .text()
            .await
            .unwrap()
            .contains("<style id=\"__sorng_dark_bootstrap_v1\""));
        *proxy.state.website_dark_mode.write().unwrap() = Some(palette());
        let opaque = client()
            .get(format!("{}/final", proxy.base))
            .header("Host", &proxy.state.proxy_authority)
            .header("Sec-Fetch-Dest", "empty")
            .header("Sec-Fetch-Mode", "cors")
            .send()
            .await
            .unwrap();
        assert_eq!(opaque.headers()["Content-Encoding"], "gzip");
        assert_eq!(
            opaque.bytes().await.unwrap().as_ref(),
            gzip(HTML.as_bytes())
        );
        assert_eq!(
            client()
                .get(format!("{}/final", proxy.base))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    upstream.abort();
}

#[test]
fn dark_bootstrap_is_an_explicit_nullable_start_option() {
    let mut value =
        serde_json::json!({"target_url":"https://device.test", "username":"", "password":""});
    assert!(
        serde_json::from_value::<BasicAuthProxyConfig>(value.clone())
            .unwrap()
            .website_dark_mode
            .is_none()
    );
    value["website_dark_mode"] = serde_json::to_value(palette()).unwrap();
    assert_eq!(
        serde_json::from_value::<BasicAuthProxyConfig>(value.clone())
            .unwrap()
            .website_dark_mode,
        Some(palette())
    );
    value["website_dark_mode"] = serde_json::Value::Null;
    assert!(serde_json::from_value::<BasicAuthProxyConfig>(value)
        .unwrap()
        .website_dark_mode
        .is_none());
}
