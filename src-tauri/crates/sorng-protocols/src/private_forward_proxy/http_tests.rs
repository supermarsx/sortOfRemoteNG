use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::time::timeout;

const DEADLINE: Duration = Duration::from_secs(5);

#[tokio::test]
async fn expect_continue_upload_is_answered_and_streamed_without_forwarding_expect() {
    let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut proxy = proxy(peer.local_addr().unwrap(), Arc::new(AtomicUsize::new(0))).await;
    let task = tokio::spawn(async move {
        let (mut socket, _) = peer.accept().await.unwrap();
        let header = head(&mut socket).await.to_ascii_lowercase();
        assert!(!header.contains("expect:"));
        assert_eq!(socket.read_u8().await.unwrap(), b'x');
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .await
            .unwrap();
    });
    timeout(DEADLINE, async {
        let mut socket = TcpStream::connect(proxy.local_addr()).await.unwrap();
        socket
            .write_all(
                request(
                    &proxy,
                    "http://device.test/upload",
                    "Content-Length: 1\r\nExpect: 100-continue\r\n",
                    "",
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        assert!(head(&mut socket).await.starts_with("HTTP/1.1 100"));
        socket.write_all(b"x").await.unwrap();
        assert!(head(&mut socket).await.starts_with("HTTP/1.1 200"));
        task.await.unwrap();
    })
    .await
    .unwrap();
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn response_head_timeout_is_bounded_and_sanitized() {
    let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = peer.local_addr().unwrap();
    let mut proxy = PrivateForwardProxy::start(
        Arc::new(move |_: Authority| -> DialFuture {
            Box::pin(async move { Ok(Box::new(TcpStream::connect(addr).await?) as BoxedStream) })
        }),
        Arc::new(|_| true),
        ProxyLimits {
            http_response_timeout: Duration::from_millis(80),
            ..ProxyLimits::default()
        },
    )
    .await
    .unwrap();
    let task = tokio::spawn(async move {
        let (mut socket, _) = peer.accept().await.unwrap();
        head(&mut socket).await;
        let mut byte = [0u8; 1];
        assert_eq!(
            timeout(DEADLINE, socket.read(&mut byte))
                .await
                .unwrap()
                .unwrap(),
            0
        );
    });
    let response = exchange(
        &proxy,
        &request(&proxy, "http://device.test/", "Content-Length: 0\r\n", ""),
    )
    .await;
    assert!(response.starts_with("HTTP/1.1 504"));
    assert!(!response.contains("device.test"));
    timeout(DEADLINE, task).await.unwrap().unwrap();
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn partial_response_is_not_buffered_and_revocation_closes_both_streams() {
    let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut proxy = proxy(peer.local_addr().unwrap(), Arc::new(AtomicUsize::new(0))).await;
    let task = tokio::spawn(async move {
        let (mut socket, _) = peer.accept().await.unwrap();
        head(&mut socket).await;
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\n\r\npartial")
            .await
            .unwrap();
        let mut byte = [0u8; 1];
        assert_eq!(
            timeout(DEADLINE, socket.read(&mut byte))
                .await
                .unwrap()
                .unwrap(),
            0
        );
    });
    let mut socket = TcpStream::connect(proxy.local_addr()).await.unwrap();
    socket
        .write_all(
            request(
                &proxy,
                "http://device.test/stream",
                "Content-Length: 0\r\n",
                "",
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    assert!(head(&mut socket).await.starts_with("HTTP/1.1 200"));
    let mut bytes = [0u8; 7];
    timeout(DEADLINE, socket.read_exact(&mut bytes))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&bytes, b"partial");
    timeout(DEADLINE, proxy.stop()).await.unwrap().unwrap();
    assert_eq!(
        timeout(DEADLINE, socket.read(&mut [0u8; 1]))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    timeout(DEADLINE, task).await.unwrap().unwrap();
}

fn auth(proxy: &PrivateForwardProxy) -> String {
    proxy
        .with_credentials(|user, password| {
            format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"))
            )
        })
        .unwrap()
}

fn request(proxy: &PrivateForwardProxy, target: &str, extra: &str, body: &str) -> String {
    format!("POST {target} HTTP/1.1\r\nHost: device.test\r\nProxy-Authorization: {}\r\n{extra}\r\n{body}", auth(proxy))
}

async fn head(socket: &mut (impl AsyncRead + Unpin)) -> String {
    timeout(DEADLINE, async {
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            bytes.push(socket.read_u8().await.unwrap());
            assert!(bytes.len() <= 32768);
        }
        String::from_utf8(bytes).unwrap()
    })
    .await
    .unwrap()
}

async fn exchange(proxy: &PrivateForwardProxy, request: &str) -> String {
    timeout(DEADLINE, async {
        let mut socket = TcpStream::connect(proxy.local_addr()).await.unwrap();
        socket.write_all(request.as_bytes()).await.unwrap();
        let mut response = String::new();
        socket.read_to_string(&mut response).await.unwrap();
        response
    })
    .await
    .unwrap()
}

async fn proxy(peer: SocketAddr, calls: Arc<AtomicUsize>) -> PrivateForwardProxy {
    PrivateForwardProxy::start(
        Arc::new(move |destination: Authority| -> DialFuture {
            assert_eq!(destination.to_string(), "device.test:80");
            calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move { Ok(Box::new(TcpStream::connect(peer).await?) as BoxedStream) })
        }),
        exact_authority_grant(Authority::parse("device.test:80").unwrap()),
        ProxyLimits::default(),
    )
    .await
    .unwrap()
}

#[test]
fn validates_absolute_target_auth_host_framing_and_upgrade_before_dial() {
    let hash: [u8; 32] = Sha256::digest(b"user:password").into();
    let auth = base64::engine::general_purpose::STANDARD.encode(b"user:password");
    let header = |target: &str, host: &str, extra: &str| {
        format!(
        "GET {target} HTTP/1.1\r\nHost: {host}\r\nProxy-Authorization: Basic {auth}\r\n{extra}\r\n")
    };
    for (target, host, extra) in [
        ("/path", "device.test", ""),
        ("https://device.test/", "device.test", ""),
        ("http://user@device.test/", "device.test", ""),
        ("http://device.test/#x", "device.test", ""),
        ("http://device.test/", "foreign.test", ""),
        (
            "http://device.test/",
            "device.test",
            "Content-Length: 4\r\nTransfer-Encoding: chunked\r\n",
        ),
        (
            "http://device.test/",
            "device.test",
            "Content-Length: 0\r\nContent-Length: 0\r\n",
        ),
        (
            "http://device.test/",
            "device.test",
            "Content-Length: +4\r\n",
        ),
        (
            "http://device.test/",
            "device.test",
            "Transfer-Encoding: gzip, chunked\r\n",
        ),
        (
            "http://device.test/",
            "device.test",
            "Connection: Content-Length\r\n",
        ),
        (
            "http://device.test/",
            "device.test",
            "Upgrade: h2c\r\nConnection: upgrade\r\n",
        ),
        (
            "http://device.test/",
            "device.test",
            "Upgrade: websocket\r\n",
        ),
        (
            "http://device.test/",
            "device.test",
            "X: yes\r\n folded\r\n",
        ),
    ] {
        assert_eq!(
            validate(header(target, host, extra).as_bytes(), &hash).err(),
            Some(400)
        );
    }
    for (target, host, expected) in [
        ("http://device.test", "device.test:80", "/"),
        (
            "http://device.test/a%2Fb?x=%2B&x=2",
            "DEVICE.TEST",
            "/a%2Fb?x=%2B&x=2",
        ),
        ("http://[::1]:8080/path", "[::1]:8080", "/path"),
    ] {
        let valid = validate(header(target, host, "").as_bytes(), &hash).unwrap();
        assert_eq!(valid.path.to_string(), expected);
        assert!(!valid.headers.contains_key("proxy-authorization"));
    }
    assert_eq!(
        validate(
            b"GET http://device.test/ HTTP/1.1\r\nHost: device.test\r\n\r\n",
            &hash
        )
        .err(),
        Some(407)
    );
}

#[tokio::test]
async fn streams_form_and_preserves_origin_headers_cookies_and_redirect_without_following() {
    let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let mut proxy = proxy(peer.local_addr().unwrap(), calls.clone()).await;
    let task = tokio::spawn(async move {
        let (mut socket, _) = peer.accept().await.unwrap();
        let header = head(&mut socket).await;
        assert!(header.starts_with("POST /admin/login?x=%2B HTTP/1.1\r\n"));
        let lower = header.to_ascii_lowercase();
        for field in [
            "host: device.test",
            "cookie: session=fixture",
            "authorization: basic website",
            "origin: http://device.test",
            "referer: http://device.test/admin/",
            "content-length: 7",
            "user-agent: fixture-browser",
            "connection: close",
        ] {
            assert!(lower.contains(field), "missing {field}");
        }
        for field in ["proxy-", "x-hop:", "expect:"] {
            assert!(!lower.contains(field));
        }
        let mut body = [0u8; 7];
        socket.read_exact(&mut body).await.unwrap();
        assert_eq!(&body, b"p=a%2Bb");
        socket.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://device.test/admin/\r\nSet-Cookie: a=1; Path=/\r\nSet-Cookie: b=2; HttpOnly\r\nContent-Length: 0\r\nConnection: close, X-Hop\r\nX-Hop: removed\r\nProxy-Authenticate: fake\r\n\r\n").await.unwrap();
    });
    let req = request(&proxy, "http://device.test/admin/login?x=%2B",
        "Content-Length: 7\r\nCookie: session=fixture\r\nAuthorization: Basic website\r\nOrigin: http://device.test\r\nReferer: http://device.test/admin/\r\nUser-Agent: fixture-browser\r\nConnection: keep-alive, X-Hop\r\nX-Hop: removed\r\n", "p=a%2Bb");
    let response = exchange(&proxy, &req).await.to_ascii_lowercase();
    assert!(response.starts_with("http/1.1 302"));
    for field in [
        "location: http://device.test/admin/",
        "set-cookie: a=1; path=/",
        "set-cookie: b=2; httponly",
    ] {
        assert!(response.contains(field));
    }
    assert!(!response.contains("proxy-authenticate"));
    assert!(!response.contains("x-hop"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    timeout(DEADLINE, task).await.unwrap().unwrap();
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn chunked_upload_and_response_stream_without_forwarding_trailer_credentials() {
    let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut proxy = proxy(peer.local_addr().unwrap(), Arc::new(AtomicUsize::new(0))).await;
    let task = tokio::spawn(async move {
        let (mut socket, _) = peer.accept().await.unwrap();
        assert!(head(&mut socket)
            .await
            .to_ascii_lowercase()
            .contains("transfer-encoding: chunked"));
        let mut body = Vec::new();
        while !body.ends_with(b"0\r\n\r\n") {
            body.push(socket.read_u8().await.unwrap());
            assert!(body.len() < 1024);
        }
        assert!(String::from_utf8_lossy(&body).contains("data"));
        assert!(!String::from_utf8_lossy(&body).contains("secret"));
        socket.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nTrailer: Proxy-Authenticate\r\n\r\n4\r\ntest\r\n0\r\nProxy-Authenticate: secret\r\n\r\n").await.unwrap();
    });
    let response = exchange(
        &proxy,
        &request(
            &proxy,
            "http://device.test/upload",
            "Transfer-Encoding: chunked\r\nTrailer: Proxy-Authorization\r\n",
            "4\r\ndata\r\n0\r\nProxy-Authorization: secret\r\n\r\n",
        ),
    )
    .await;
    assert!(response.contains("test"));
    assert!(!response.contains("secret"));
    timeout(DEADLINE, task).await.unwrap().unwrap();
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn unauthorized_or_ungranted_http_never_dials() {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut proxy = proxy("127.0.0.1:1".parse().unwrap(), calls.clone()).await;
    for (req, status) in [
        ("GET http://device.test/ HTTP/1.1\r\nHost: device.test\r\n\r\n".into(), "407"),
        (format!("GET http://foreign.test/ HTTP/1.1\r\nHost: foreign.test\r\nProxy-Authorization: {}\r\n\r\n", auth(&proxy)), "403"),
    ] {
        assert!(exchange(&proxy, &req).await.starts_with(&format!("HTTP/1.1 {status}")));
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn pipelined_requests_cannot_inherit_authority_or_proxy_credentials() {
    let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let mut proxy = proxy(peer.local_addr().unwrap(), calls.clone()).await;
    let task = tokio::spawn(async move {
        let (mut socket, _) = peer.accept().await.unwrap();
        assert!(head(&mut socket).await.starts_with("POST /one HTTP/1.1"));
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
            .await
            .unwrap();
        let mut bytes = [0u8; 1];
        assert_eq!(
            timeout(DEADLINE, socket.read(&mut bytes))
                .await
                .unwrap()
                .unwrap(),
            0
        );
    });
    let mut req = request(
        &proxy,
        "http://device.test/one",
        "Content-Length: 0\r\n",
        "",
    );
    req.push_str("GET http://foreign.test/two HTTP/1.1\r\nHost: foreign.test\r\n\r\n");
    assert!(exchange(&proxy, &req).await.ends_with("ok"));
    timeout(DEADLINE, task).await.unwrap().unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn plain_websocket_upgrade_relays_early_bytes_and_half_closes() {
    let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut proxy = proxy(peer.local_addr().unwrap(), Arc::new(AtomicUsize::new(0))).await;
    let task = tokio::spawn(async move {
        let (mut socket, _) = peer.accept().await.unwrap();
        let header = head(&mut socket).await.to_ascii_lowercase();
        assert!(header.contains("upgrade: websocket"));
        assert!(!header.contains("proxy-authorization"));
        socket.write_all(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n").await.unwrap();
        let mut bytes = Vec::new();
        socket.read_to_end(&mut bytes).await.unwrap();
        assert_eq!(&bytes, &[0x81, 0x82, 1, 2, 3, 4, b'o' ^ 1, b'k' ^ 2]);
        socket.write_all(&[0x81, 2, b'o', b'k']).await.unwrap();
    });
    timeout(DEADLINE, async {
        let mut socket = TcpStream::connect(proxy.local_addr()).await.unwrap();
        let mut request = format!("GET http://device.test/ws HTTP/1.1\r\nHost: device.test\r\nProxy-Authorization: {}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n", auth(&proxy)).into_bytes();
        request.extend_from_slice(&[0x81, 0x82, 1, 2, 3, 4, b'o' ^ 1, b'k' ^ 2]);
        socket.write_all(&request).await.unwrap();
        assert!(head(&mut socket).await.starts_with("HTTP/1.1 101"));
        socket.shutdown().await.unwrap();
        let mut reply = Vec::new();
        socket.read_to_end(&mut reply).await.unwrap();
        assert_eq!(&reply, &[0x81, 2, b'o', b'k']);
        task.await.unwrap();
    }).await.unwrap();
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn chunked_get_body_keeps_explicit_outgoing_framing() {
    let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut proxy = proxy(peer.local_addr().unwrap(), Arc::new(AtomicUsize::new(0))).await;
    let task = tokio::spawn(async move {
        let (mut socket, _) = peer.accept().await.unwrap();
        let header = head(&mut socket).await.to_ascii_lowercase();
        assert!(header.starts_with("get /search http/1.1"));
        assert!(header.contains("transfer-encoding: chunked"));
        let mut body = String::new();
        while !body.ends_with("0\r\n\r\n") {
            body.push(socket.read_u8().await.unwrap() as char);
            assert!(body.len() < 1024);
        }
        assert!(body.contains("data"));
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .await
            .unwrap();
    });
    let req = request(
        &proxy,
        "http://device.test/search",
        "Transfer-Encoding: chunked\r\n",
        "4\r\ndata\r\n0\r\n\r\n",
    )
    .replacen("POST", "GET", 1);
    assert!(exchange(&proxy, &req).await.starts_with("HTTP/1.1 200"));
    timeout(DEADLINE, task).await.unwrap().unwrap();
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn ambiguous_and_unsupported_upstream_transfer_framing_is_rejected() {
    for framing in [
        "Transfer-Encoding: chunked\r\nContent-Length: 0\r\n",
        "Transfer-Encoding: gzip, chunked\r\n",
        "Content-Length: 4, 4\r\n",
    ] {
        let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut proxy = proxy(peer.local_addr().unwrap(), Arc::new(AtomicUsize::new(0))).await;
        let task = tokio::spawn(async move {
            let (mut socket, _) = peer.accept().await.unwrap();
            head(&mut socket).await;
            socket
                .write_all(
                    format!("HTTP/1.1 200 OK\r\n{framing}\r\n4\r\ndata\r\n0\r\n\r\n").as_bytes(),
                )
                .await
                .unwrap();
        });
        let response = exchange(
            &proxy,
            &request(&proxy, "http://device.test/", "Content-Length: 0\r\n", ""),
        )
        .await;
        assert!(response.starts_with("HTTP/1.1 502"), "{response}");
        assert!(!response.contains("data"));
        timeout(DEADLINE, task).await.unwrap().unwrap();
        proxy.stop().await.unwrap();
    }
}

#[tokio::test]
async fn stalled_response_body_expires_without_retaining_client_capacity() {
    let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = peer.local_addr().unwrap();
    let mut proxy = PrivateForwardProxy::start(
        Arc::new(move |_: Authority| -> DialFuture {
            Box::pin(async move { Ok(Box::new(TcpStream::connect(addr).await?) as BoxedStream) })
        }),
        Arc::new(|_| true),
        ProxyLimits {
            http_idle_timeout: Duration::from_millis(80),
            max_clients: 1,
            ..ProxyLimits::default()
        },
    )
    .await
    .unwrap();
    let task = tokio::spawn(async move {
        for _ in 0..2 {
            let (mut socket, _) = peer.accept().await.unwrap();
            head(&mut socket).await;
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n")
                .await
                .unwrap();
            let result = timeout(DEADLINE, socket.read(&mut [0u8; 1])).await.unwrap();
            assert!(matches!(result, Ok(0)) || result.is_err());
        }
    });
    for _ in 0..2 {
        let response = exchange(
            &proxy,
            &request(&proxy, "http://device.test/", "Content-Length: 0\r\n", ""),
        )
        .await;
        assert!(response.starts_with("HTTP/1.1 200"));
        // Completion of the supervisor task can lag TCP FIN by one scheduling turn.
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    timeout(DEADLINE, task).await.unwrap().unwrap();
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn quiet_upgraded_websocket_is_not_subject_to_http_idle_deadline() {
    let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = peer.local_addr().unwrap();
    let mut proxy = PrivateForwardProxy::start(
        Arc::new(move |_: Authority| -> DialFuture {
            Box::pin(async move { Ok(Box::new(TcpStream::connect(addr).await?) as BoxedStream) })
        }),
        Arc::new(|_| true),
        ProxyLimits {
            http_idle_timeout: Duration::from_millis(100),
            ..ProxyLimits::default()
        },
    )
    .await
    .unwrap();
    let task = tokio::spawn(async move {
        let (mut socket, _) = peer.accept().await.unwrap();
        head(&mut socket).await;
        socket.write_all(b"HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n").await.unwrap();
        let mut frame = [0u8; 8];
        socket.read_exact(&mut frame).await.unwrap();
        assert_eq!(frame, [0x81, 0x82, 1, 2, 3, 4, b'o' ^ 1, b'k' ^ 2]);
        socket.write_all(&[0x81, 2, b'o', b'k']).await.unwrap();
    });
    timeout(DEADLINE, async {
        let mut socket = TcpStream::connect(proxy.local_addr()).await.unwrap();
        socket.write_all(format!("GET http://device.test/ws HTTP/1.1\r\nHost: device.test\r\nProxy-Authorization: {}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n", auth(&proxy)).as_bytes()).await.unwrap();
        assert!(head(&mut socket).await.starts_with("HTTP/1.1 101"));
        tokio::time::sleep(Duration::from_millis(300)).await;
        socket.write_all(&[0x81, 0x82, 1, 2, 3, 4, b'o' ^ 1, b'k' ^ 2]).await.unwrap();
        let mut reply = [0u8; 4];
        socket.read_exact(&mut reply).await.unwrap();
        assert_eq!(reply, [0x81, 2, b'o', b'k']);
        task.await.unwrap();
    }).await.unwrap();
    proxy.stop().await.unwrap();
}

#[test]
fn http_deadlines_cannot_be_disabled_or_unbounded() {
    for value in [Duration::ZERO, Duration::from_secs(121)] {
        assert!(ProxyLimits {
            http_idle_timeout: value,
            ..ProxyLimits::default()
        }
        .validate()
        .is_err());
        assert!(ProxyLimits {
            http_response_timeout: value,
            ..ProxyLimits::default()
        }
        .validate()
        .is_err());
    }
}
