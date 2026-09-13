//! Closed public-font capability tests. Every network peer is synthetic
//! loopback; the TLS fixture is never installed in any system trust store.
use super::*;
use crate::http::font_assets::{self, ReviewedFontAssets, MAX_BYTES, PREFIX};
use axum::http::HeaderValue;
use base64::Engine;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

const NAME: &str = "inter-w400-1.woff2";
const FONT_URL: &str = "https://synostatic.synology.com/font/inter/inter-w400-1.woff2";

fn font_header_fixture() -> Vec<u8> {
    // The native route validates the bounded WOFF2 container header, not a
    // full font decoder. Actual browser decoding uses a separate real font.
    let mut bytes = vec![0u8; 52];
    bytes[..4].copy_from_slice(b"wOF2");
    bytes[4..8].copy_from_slice(&0x0001_0000u32.to_be_bytes());
    bytes[8..12].copy_from_slice(&52u32.to_be_bytes());
    bytes[12..14].copy_from_slice(&1u16.to_be_bytes());
    bytes[16..20].copy_from_slice(&64u32.to_be_bytes());
    bytes[20..24].copy_from_slice(&4u32.to_be_bytes());
    bytes
}

async fn request_head<R: AsyncRead + Unpin>(socket: &mut R) -> Option<String> {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        if bytes.len() > 16_384 {
            return None;
        }
        bytes.push(socket.read_u8().await.ok()?);
    }
    String::from_utf8(bytes).ok()
}

struct FontServer {
    proxy_url: String,
    fixture_client: reqwest::Client,
    seen: Arc<std::sync::Mutex<Vec<String>>>,
    tls_failed: Arc<AtomicU64>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for FontServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn font_server(
    response_head: String,
    bytes: Vec<u8>,
    hold: bool,
    https_proxy: bool,
) -> FontServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let proxy_url = format!(
        "{}://127.0.0.1:{port}",
        if https_proxy { "https" } else { "http" }
    );
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let requests = seen.clone();
    let tls_failed = Arc::new(AtomicU64::new(0));
    let failures = tls_failed.clone();
    let acceptor = tls_fixture::test_acceptor();
    let task = tokio::spawn(async move {
        let mut clients = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                incoming = listener.accept() => {
                    let (mut socket, _) = incoming.unwrap();
                    let acceptor = acceptor.clone();
                    let requests = requests.clone();
                    let failures = failures.clone();
                    let head = response_head.clone();
                    let bytes = bytes.clone();
                    clients.spawn(async move {
                        if https_proxy {
                            // Production must validate the HTTPS proxy too.
                            if acceptor.accept(socket).await.is_err() { failures.fetch_add(1, Ordering::SeqCst); }
                            return;
                        }
                        let Some(connect) = request_head(&mut socket).await else { return; };
                        requests.lock().unwrap().push(connect);
                        socket.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.unwrap();
                        let Ok(mut tls) = acceptor.accept(socket).await else {
                            failures.fetch_add(1, Ordering::SeqCst);
                            return;
                        };
                        let Some(request) = request_head(&mut tls).await else { return; };
                        requests.lock().unwrap().push(request);
                        if hold {
                            let mut byte = [0u8; 1];
                            let _ = tls.read(&mut byte).await;
                        } else {
                            let _ = tls.write_all(head.as_bytes()).await;
                            let _ = tls.write_all(&bytes).await;
                            let _ = tls.shutdown().await;
                        }
                    });
                },
                _ = clients.join_next(), if !clients.is_empty() => {}
            }
        }
    });
    let cert = base64::engine::general_purpose::STANDARD
        .decode(tls_fixture::TEST_CERT)
        .unwrap();
    let proxy = reqwest::Proxy::all(&proxy_url)
        .unwrap()
        .basic_auth("fixture-proxy-user", "fixture-proxy-password");
    let fixture_client = reqwest::Client::builder()
        .no_proxy()
        .proxy(proxy)
        // Only the positive loopback transport fixture accepts its own cert.
        // Separate tests below use the actual production OS-root constructor.
        .use_preconfigured_tls(build_pinned_tls_config(hex::encode(Sha256::digest(cert))).unwrap())
        .cookie_store(false)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(4))
        .build()
        .unwrap();
    FontServer {
        proxy_url,
        fixture_client,
        seen,
        tls_failed,
        task,
    }
}

fn response_head(mime: &str, length: usize) -> String {
    format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {length}\r\nSet-Cookie: cdn-cookie=do-not-store; Secure\r\nX-Private-Upstream: not-forwarded\r\nConnection: close\r\n\r\n")
}

async fn font_proxy(assets: Option<ReviewedFontAssets>) -> FixtureProxy {
    let mut network = ProxyNetworkState::default();
    network.font_assets = assets;
    let policy = HttpProxyPolicy {
        query_parameters: vec![super::super::proxy_policy::QueryParameter {
            name: "private-query".into(),
            value: "source-query-secret".into(),
        }],
        ..Default::default()
    };
    let proxy = proxy_with_policy_and_network(
        "https://source-only.invalid/".into(),
        reqwest::Client::builder()
            .no_proxy()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap(),
        UpstreamAuthMode::Basic,
        policy,
        HashMap::from([("X-Source-Secret".into(), "source-header-secret".into())]),
        Arc::new(network),
    )
    .await;
    *proxy.state.username.write().unwrap() = "source-user".into();
    *proxy.state.password.write().unwrap() = "source-password".into();
    proxy
}

fn font_request(proxy: &FixtureProxy, name: &str) -> reqwest::RequestBuilder {
    client()
        .get(format!("{}{PREFIX}{name}", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Origin", &proxy.state.proxy_origin)
        .header("Sec-Fetch-Dest", "font")
}

#[tokio::test]
async fn public_fonts_are_anonymous_fixed_binary_gets_through_configured_proxy() {
    for mime in [
        "font/woff2",
        "application/font-woff2",
        "application/octet-stream",
        "binary/octet-stream",
    ] {
        let bytes = font_header_fixture();
        let server = font_server(
            response_head(mime, bytes.len()),
            bytes.clone(),
            false,
            false,
        )
        .await;
        let proxy = font_proxy(Some(ReviewedFontAssets::fixture(
            server.fixture_client.clone(),
        )))
        .await;
        for destination in ["font", "empty"] {
            let mut request = font_request(&proxy, NAME).build().unwrap();
            request
                .headers_mut()
                .insert("sec-fetch-dest", destination.parse().unwrap());
            request.headers_mut().insert(
                "authorization",
                "Bearer source-browser-token".parse().unwrap(),
            );
            request
                .headers_mut()
                .insert("cookie", "source-cookie=secret".parse().unwrap());
            request.headers_mut().insert(
                "referer",
                format!("{}/private?token=secret", proxy.state.proxy_origin)
                    .parse()
                    .unwrap(),
            );
            let response = client().execute(request).await.unwrap();
            assert_eq!(response.status(), 200);
            assert_eq!(response.headers()["content-type"], "font/woff2");
            assert_eq!(response.headers()["x-content-type-options"], "nosniff");
            assert_eq!(response.headers()["cache-control"], "no-store");
            assert!(response.headers()["content-security-policy"]
                .to_str()
                .unwrap()
                .contains("font-src 'self' data: blob:"));
            for header in [
                "set-cookie",
                "location",
                "x-private-upstream",
                "access-control-allow-origin",
            ] {
                assert!(!response.headers().contains_key(header));
            }
            assert_eq!(response.bytes().await.unwrap().as_ref(), bytes);
        }
        let requests = server.seen.lock().unwrap();
        assert_eq!(requests.len(), 4);
        for pair in requests.chunks_exact(2) {
            assert!(pair[0].starts_with("CONNECT synostatic.synology.com:443 HTTP/1.1"));
            assert!(pair[0]
                .to_ascii_lowercase()
                .contains("proxy-authorization: basic "));
            assert!(pair[1].starts_with("GET /font/inter/inter-w400-1.woff2 HTTP/1.1"));
            for forbidden in [
                "authorization:",
                "cookie:",
                "referer:",
                "source-",
                "private-query",
                ".localhost",
                "__sortofremoteng",
            ] {
                assert!(!pair[1].to_ascii_lowercase().contains(forbidden));
            }
        }
        assert_eq!(proxy.state.request_count.load(Ordering::SeqCst), 2);
        assert_eq!(proxy.state.error_count.load(Ordering::SeqCst), 0);
        let manager = proxy.state.global_sessions.lock().unwrap();
        assert_eq!(manager.request_log.len(), 2);
        for entry in &manager.request_log {
            assert_eq!(entry.method, "GET");
            assert_eq!(entry.url, format!("{}{PREFIX}", proxy.state.proxy_origin));
            assert_eq!(entry.status, 200);
            assert!(entry.error.is_none());
        }
    }
}

#[tokio::test]
async fn unreviewed_methods_paths_origins_and_destinations_never_contact_font_upstream() {
    let bytes = font_header_fixture();
    let server = font_server(
        response_head("font/woff2", bytes.len()),
        bytes,
        false,
        false,
    )
    .await;
    let proxy = font_proxy(Some(ReviewedFontAssets::fixture(
        server.fixture_client.clone(),
    )))
    .await;
    for name in [
        "inter-w900-1.woff2",
        "inter-w400-8.woff2",
        "inter-w400-1.woff2?query=secret",
        "%69nter-w400-1.woff2",
        "inter-w400-1.woff2/extra",
    ] {
        assert!(!font_request(&proxy, name)
            .send()
            .await
            .unwrap()
            .status()
            .is_success());
    }
    for method in [
        reqwest::Method::POST,
        reqwest::Method::HEAD,
        reqwest::Method::PUT,
    ] {
        let mut request = font_request(&proxy, NAME).build().unwrap();
        *request.method_mut() = method;
        assert!(!client()
            .execute(request)
            .await
            .unwrap()
            .status()
            .is_success());
    }
    for destination in [
        "document",
        "iframe",
        "script",
        "style",
        "image",
        "websocket",
    ] {
        let mut request = font_request(&proxy, NAME).build().unwrap();
        request
            .headers_mut()
            .insert("sec-fetch-dest", destination.parse().unwrap());
        assert_eq!(client().execute(request).await.unwrap().status(), 400);
    }
    assert_eq!(
        font_request(&proxy, NAME)
            .header("Upgrade", "websocket")
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    for origin in [
        HeaderValue::from_static("https://foreign.invalid"),
        HeaderValue::from_bytes(&[0xff]).unwrap(),
    ] {
        let mut request = font_request(&proxy, NAME).build().unwrap();
        request.headers_mut().insert("origin", origin);
        assert_eq!(client().execute(request).await.unwrap().status(), 403);
    }
    let mut wrong_host = font_request(&proxy, NAME).build().unwrap();
    wrong_host
        .headers_mut()
        .insert("host", "127.0.0.1:1234".parse().unwrap());
    assert_eq!(client().execute(wrong_host).await.unwrap().status(), 403);
    assert!(server.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn font_type_signature_size_and_redirect_failures_do_not_publish_binary_or_retry() {
    let mut invalid_header = font_header_fixture();
    invalid_header[8..12].copy_from_slice(&999u32.to_be_bytes());
    for (head, bytes) in [
        (response_head("text/html", 52), font_header_fixture()),
        (response_head("font/woff2", 13), b"<html></html>".to_vec()),
        (response_head("font/woff2", 52), invalid_header),
        (response_head("font/woff2", MAX_BYTES + 1), vec![0; MAX_BYTES + 1]),
        ("HTTP/1.1 302 Found\r\nLocation: https://foreign.invalid/private?token=secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(), vec![]),
        ("HTTP/1.1 200 OK\r\nContent-Type: font/woff2\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".into(), format!("{:x}\r\n{}\r\n0\r\n\r\n", MAX_BYTES + 1, "x".repeat(MAX_BYTES + 1)).into_bytes()),
    ] {
        let server = font_server(head, bytes, false, false).await;
        let proxy = font_proxy(Some(ReviewedFontAssets::fixture(server.fixture_client.clone()))).await;
        let response = font_request(&proxy, NAME).send().await.unwrap();
        assert_eq!(response.status(), 502);
        assert!(!response.headers().contains_key("location"));
        assert!(!response.text().await.unwrap().contains("token=secret"));
        assert_eq!(server.seen.lock().unwrap().len(), 2);
    }
}

#[tokio::test]
async fn production_font_tls_rejects_untrusted_cdn_and_https_proxy_despite_source_unverified_tls() {
    for https_proxy in [false, true] {
        let server = font_server(String::new(), vec![], false, https_proxy).await;
        let fonts =
            ReviewedFontAssets::new(Some(reqwest::Proxy::all(&server.proxy_url).unwrap()), "1.2")
                .unwrap();
        let proxy = font_proxy(Some(fonts)).await;
        let response = font_request(&proxy, NAME).send().await.unwrap();
        assert_eq!(response.status(), 502);
        assert!(!response.text().await.unwrap().contains("source-"));
        tokio::time::timeout(Duration::from_secs(2), async {
            while server.tls_failed.load(Ordering::SeqCst) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let requests = server.seen.lock().unwrap();
        assert_eq!(requests.len(), if https_proxy { 0 } else { 1 });
        assert!(requests
            .iter()
            .all(|request| request.starts_with("CONNECT ")));
    }
}

#[tokio::test]
async fn font_download_is_cancelled_on_session_revoke_and_unavailable_route_never_hits_source() {
    let server = font_server(String::new(), vec![], true, false).await;
    let proxy = font_proxy(Some(ReviewedFontAssets::fixture(
        server.fixture_client.clone(),
    )))
    .await;
    let request = font_request(&proxy, NAME).build().unwrap();
    let pending = tokio::spawn(async move { client().execute(request).await.unwrap() });
    tokio::time::timeout(Duration::from_secs(2), async {
        while server.seen.lock().unwrap().len() < 2 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    proxy.state.network.revoke();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), pending)
            .await
            .unwrap()
            .unwrap()
            .status(),
        410
    );
    let unavailable = font_proxy(None).await;
    assert_eq!(
        font_request(&unavailable, NAME)
            .send()
            .await
            .unwrap()
            .status(),
        503
    );
    assert_eq!(unavailable.state.request_count.load(Ordering::SeqCst), 1);
    assert_eq!(unavailable.state.error_count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn native_rewriting_routes_parsed_styles_inline_styles_and_closed_manifest_only() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let css = format!("@font-face{{font-family:Inter;src:url('{FONT_URL}') format('woff2');}}");
    let stylesheet = css.clone();
    let server = tokio::spawn(async move {
        let router = axum::Router::new().fallback(move |uri: axum::http::Uri| {
            let css = stylesheet.clone();
            async move {
                if uri.path() == "/style.css" {
                    Response::builder().header("Content-Type", "text/css").body(Body::from(css)).unwrap()
                } else if uri.path() == "/font.js" {
                    Response::builder().header("Content-Type", "application/javascript").body(Body::from(format!("const font = new FontFace('Inter', \"url('{FONT_URL}')\");"))).unwrap()
                } else {
                    Response::builder().header("Content-Type", "text/html").body(Body::from(format!("<!doctype html><html><head><style>{css}</style><link rel='stylesheet' href='/style.css'></head><body>fonts</body></html>"))).unwrap()
                }
            }
        });
        axum::serve(listener, router).await.unwrap();
    });
    let proxy = proxy(format!("http://127.0.0.1:{port}/"), client()).await;
    assert!(proxy.state.network.font_assets.is_none());
    let local = format!("{}{PREFIX}{NAME}", proxy.state.proxy_origin);
    let css_response = client()
        .get(format!("{}/style.css", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Sec-Fetch-Dest", "style")
        .send()
        .await
        .unwrap();
    assert_eq!(css_response.status(), 200);
    assert_eq!(
        css_response.text().await.unwrap(),
        css.replace(FONT_URL, &local)
    );
    let script_response = client()
        .get(format!("{}/font.js", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Sec-Fetch-Dest", "script")
        .send()
        .await
        .unwrap();
    assert_eq!(script_response.status(), 200);
    assert_eq!(
        script_response.text().await.unwrap(),
        format!("const font = new FontFace('Inter', \"url('{local}')\");")
    );
    let html = fetch(&proxy, "/").await.text().await.unwrap();
    assert!(html.contains(&format!("<style>{}</style>", css.replace(FONT_URL, &local))));
    assert!(html.contains("\"fontAssets\":["));
    let manifest = font_assets::manifest(&proxy.state.proxy_origin);
    assert_eq!(manifest.len(), 28);
    assert_eq!(manifest[0]["upstreamUrl"], FONT_URL);
    assert_eq!(manifest[0]["proxyUrl"], local);
    for invalid in [
        format!("{FONT_URL}?token=x"),
        format!("{FONT_URL}#fragment"),
        format!("{FONT_URL}.js"),
        FONT_URL.replace("https:", "http:"),
        FONT_URL.replace(
            "synostatic.synology.com",
            "synostatic.synology.com.attacker.invalid",
        ),
    ] {
        let css = format!("url('{invalid}')");
        assert_eq!(font_assets::rewrite(&css, &proxy.state.proxy_origin), css);
    }
    server.abort();
}
