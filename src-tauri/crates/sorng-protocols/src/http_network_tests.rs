//! Synthetic loopback-only acceptance for the mandatory network policy and
//! WebSocket relay. No user profile, certificate store or remote site is used.
use super::*;
use base64::Engine;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
#[path = "http_network_extra_tests.rs"]
mod extra_tests;

const KEY: &str = "dGhlIHNhbXBsZSBub25jZQ==";
const ACCEPT: &str = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
const VALID: &str = "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n";

trait TestIo: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> TestIo for T {}

async fn head<S: AsyncRead + Unpin + ?Sized>(socket: &mut S) -> String {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        assert!(bytes.len() < 16_384);
        bytes.push(socket.read_u8().await.unwrap());
    }
    String::from_utf8(bytes).unwrap()
}

struct WsUpstream {
    url: String,
    headers: Arc<std::sync::Mutex<Vec<String>>>,
    closed: Arc<AtomicBool>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for WsUpstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn upstream_ws(reply: String, tls: bool, connect: bool) -> WsUpstream {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let headers = Arc::new(std::sync::Mutex::new(Vec::new()));
    let closed = Arc::new(AtomicBool::new(false));
    let seen = headers.clone();
    let finished = closed.clone();
    let acceptor = tls_fixture::test_acceptor();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        if connect {
            let request = head(&mut socket).await;
            seen.lock().unwrap().push(request);
            socket
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
        }
        let mut socket: Box<dyn TestIo> = if tls {
            match acceptor.accept(socket).await {
                Ok(socket) => Box::new(socket),
                Err(_) => {
                    finished.store(true, Ordering::SeqCst);
                    return;
                }
            }
        } else {
            Box::new(socket)
        };
        let request = head(&mut *socket).await;
        seen.lock().unwrap().push(request);
        socket.write_all(reply.as_bytes()).await.unwrap();
        let mut frame = [0u8; 8];
        if socket.read_exact(&mut frame).await.is_ok() {
            assert_eq!(frame, [0x81, 0x82, 1, 2, 3, 4, b'h' ^ 1, b'i' ^ 2]);
            // A server response is unmasked, as required by RFC6455.
            socket.write_all(&[0x81, 2, b'h', b'i']).await.unwrap();
            let mut byte = [0u8; 1];
            while socket.read(&mut byte).await.is_ok_and(|n| n > 0) {}
        }
        finished.store(true, Ordering::SeqCst);
    });
    WsUpstream {
        url: format!(
            "{}://127.0.0.1:{port}/",
            if tls && !connect { "https" } else { "http" }
        ),
        headers,
        closed,
        task,
    }
}

fn ws_request(fixture: &FixtureProxy) -> reqwest::RequestBuilder {
    fixture.state.document_sequence.store(1, Ordering::SeqCst);
    fixture.state.network.document_issued(1, true);
    client()
        .get(format!(
            "{}/socket?raw=%2F+&__sorng_ws_document_v1=1",
            fixture.base
        ))
        .version(reqwest::Version::HTTP_11)
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", KEY)
}

async fn echo(response: reqwest::Response) -> reqwest::Upgraded {
    assert_eq!(response.status(), StatusCode::SWITCHING_PROTOCOLS);
    assert_eq!(response.headers()["sec-websocket-accept"], ACCEPT);
    assert!(!response.headers().contains_key("sec-websocket-extensions"));
    let mut socket = response.upgrade().await.unwrap();
    // One masked browser text frame. This tunnel forwards frames unchanged,
    // rather than parsing/decompressing attacker-controlled messages in-app.
    let frame = [0x81, 0x82, 1, 2, 3, 4, b'h' ^ 1, b'i' ^ 2];
    socket.write_all(&frame).await.unwrap();
    let mut received = [0u8; 4];
    tokio::time::timeout(Duration::from_secs(2), socket.read_exact(&mut received))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(received, [0x81, 2, b'h', b'i']);
    socket
}

#[tokio::test]
async fn websocket_relay_retains_auth_and_raw_query_and_revokes_on_document_navigation() {
    let upstream = upstream_ws(VALID.into(), false, false).await;
    let fixture = proxy_with_mode(upstream.url.clone(), client(), UpstreamAuthMode::Basic).await;
    *fixture.state.username.write().unwrap() = "synthetic-user".into();
    *fixture.state.password.write().unwrap() = "synthetic-password".into();
    let response = ws_request(&fixture)
        .header("Sec-WebSocket-Extensions", "permessage-deflate")
        .send()
        .await
        .unwrap();
    let mut socket = echo(response).await;
    let headers = upstream.headers.lock().unwrap().join("\n");
    assert!(headers.starts_with("GET /socket?raw=%2F+ HTTP/1.1"));
    assert!(headers.to_lowercase().contains("authorization: basic "));
    assert!(!headers.contains("__sorng") && !headers.contains(&fixture.state.proxy_authority));
    assert!(!headers.to_lowercase().contains("sec-websocket-extensions"));
    fixture.state.network.document_issued(2, false);
    fixture.state.network.activate_document(2).unwrap();
    let mut byte = [0u8; 1];
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), socket.read(&mut byte)).await,
        Ok(Ok(0)) | Ok(Err(_))
    ));
    tokio::time::timeout(Duration::from_secs(2), async {
        while !upstream.closed.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn websocket_relay_uses_https_pin_and_http_connect_without_target_dns_or_direct_fallback() {
    let upstream = upstream_ws(VALID.into(), true, true).await;
    let cert = base64::engine::general_purpose::STANDARD
        .decode(tls_fixture::TEST_CERT)
        .unwrap();
    let pin = hex::encode(Sha256::digest(&cert));
    let transport = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(&upstream.url).unwrap())
        .use_preconfigured_tls(build_pinned_tls_config(pin).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let fixture = proxy("https://no-local-dns.invalid/".into(), transport).await;
    let mut socket = echo(ws_request(&fixture).send().await.unwrap()).await;
    assert!(upstream.headers.lock().unwrap()[0]
        .starts_with("CONNECT no-local-dns.invalid:443 HTTP/1.1"));
    fixture.state.network.revoke();
    let mut byte = [0u8; 1];
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), socket.read(&mut byte)).await,
        Ok(Ok(0)) | Ok(Err(_))
    ));
}

#[tokio::test]
async fn websocket_wrong_pin_never_receives_http_or_source_credentials() {
    let upstream = upstream_ws(VALID.into(), true, true).await;
    let transport = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(&upstream.url).unwrap())
        .use_preconfigured_tls(build_pinned_tls_config("00".repeat(32)).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let fixture = proxy_with_mode(
        "https://no-local-dns.invalid/".into(),
        transport,
        UpstreamAuthMode::Basic,
    )
    .await;
    *fixture.state.username.write().unwrap() = "secret-user".into();
    let response = ws_request(&fixture).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let requests = upstream.headers.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(!requests[0].contains("secret-user"));
}

#[tokio::test]
async fn websocket_authority_origin_and_duplicate_headers_reject_before_upstream() {
    let upstream = upstream_ws(VALID.into(), false, false).await;
    let fixture = proxy(upstream.url.clone(), client()).await;
    for (header, value, status) in [
        ("Origin", "https://foreign.invalid", StatusCode::FORBIDDEN),
        ("Host", "localhost:42", StatusCode::FORBIDDEN),
        ("Sec-WebSocket-Key", KEY, StatusCode::BAD_REQUEST),
        ("Sec-WebSocket-Version", "13", StatusCode::BAD_REQUEST),
    ] {
        let mut request = ws_request(&fixture).build().unwrap();
        let name = reqwest::header::HeaderName::from_bytes(header.as_bytes()).unwrap();
        if matches!(header, "Origin" | "Host") {
            request.headers_mut().insert(name, value.parse().unwrap());
        } else {
            request.headers_mut().append(name, value.parse().unwrap());
        }
        let response = client().execute(request).await.unwrap();
        assert_eq!(response.status(), status);
    }
    let mut request = ws_request(&fixture).build().unwrap();
    request.headers_mut().remove("origin");
    assert_eq!(
        client().execute(request).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    assert!(upstream.headers.lock().unwrap().is_empty());
}

#[tokio::test]
async fn websocket_invalid_accept_protocol_duplicates_and_redirects_never_publish_101() {
    for reply in [
        VALID.replace(ACCEPT, "invalid"),
        VALID.replace("\r\n\r\n", &format!("\r\nSec-WebSocket-Accept: {ACCEPT}\r\n\r\n")),
        VALID.replace("\r\n\r\n", "\r\nSec-WebSocket-Protocol: other\r\n\r\n"),
        VALID.replace("\r\n\r\n", "\r\nSec-WebSocket-Protocol: chat\r\nSec-WebSocket-Protocol: chat\r\n\r\n"),
        "HTTP/1.1 302 Found\r\nLocation: https://foreign.invalid/private\r\nContent-Length: 0\r\n\r\n".into(),
    ] {
        let upstream = upstream_ws(reply, false, false).await;
        let fixture = proxy(upstream.url.clone(), client()).await;
        let response = ws_request(&fixture).header("Sec-WebSocket-Protocol", "chat").send().await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(upstream.headers.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn mandatory_network_csp_covers_success_error_css_script_and_revoked_session_responses() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().fallback(|uri: axum::http::Uri| async move {
                let (status, mime, body) = match uri.path() {
                    "/index" => (
                        200,
                        "text/html",
                        "<!doctype html><html><head></head><body>page</body></html>",
                    ),
                    "/error" => (503, "text/html", "<html><body>unavailable</body></html>"),
                    "/app.js" => (200, "application/javascript", "/* fixture */"),
                    "/style.css" => (200, "text/css", "body { color: black; }"),
                    _ => (200, "application/json", "{}"),
                };
                Response::builder()
                    .status(status)
                    .header("Content-Type", mime)
                    .header("Content-Security-Policy", "default-src *")
                    .body(Body::from(body))
                    .unwrap()
            }),
        )
        .await
        .unwrap();
    });
    let fixture = proxy(format!("http://127.0.0.1:{port}/"), client()).await;
    for (path, destination, status) in [
        ("/index", "document", 200),
        ("/error", "document", 503),
        ("/app.js", "script", 200),
        ("/style.css", "style", 200),
        ("/app.js", "worker", 200),
        ("/api", "empty", 200),
    ] {
        let response = client()
            .get(format!("{}{path}", fixture.base))
            .header("Host", &fixture.state.proxy_authority)
            .header("Sec-Fetch-Dest", destination)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), status);
        let csp = response.headers()["content-security-policy"]
            .to_str()
            .unwrap();
        assert_eq!(response.headers()["x-dns-prefetch-control"], "off");
        assert!(
            csp.contains("worker-src 'none'")
                && csp.contains("form-action 'self'")
                && csp.contains("connect-src 'self' ws://")
                && csp.contains("font-src 'self' data: blob:")
        );
        assert!(!csp.contains("https:") && !csp.contains("default-src *"));
    }
    fixture.state.network.revoke();
    let response = fetch(&fixture, "/").await;
    assert_eq!(response.status(), StatusCode::GONE);
    assert!(response.headers().contains_key("content-security-policy"));
    task.abort();
}

#[tokio::test]
async fn network_lease_reports_only_actual_live_origin_and_revokes_on_server_drop() {
    let origin = "http://paaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.localhost:41234";
    let network = Arc::new(ProxyNetworkState::with_origin(origin).unwrap());
    assert_eq!(
        network.proxy_url().as_deref(),
        Some(format!("{origin}/").as_str())
    );
    assert!(crate::webview_origins::allows_frame_url(origin));
    let server = network.server_guard();
    drop(server);
    assert!(!network.is_active());
    assert!(network.proxy_url().is_none());
    assert!(!crate::webview_origins::allows_frame_url(origin));
}
