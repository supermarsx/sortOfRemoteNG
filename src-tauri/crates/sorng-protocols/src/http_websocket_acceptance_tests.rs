//! Real loopback HTTP upgrades and wire bytes; no live service or user secrets.
use super::*;

fn frame(opcode_and_fin: u8, payload: &[u8], masked: bool) -> Vec<u8> {
    let mut bytes = vec![opcode_and_fin];
    let mask_bit = if masked { 0x80 } else { 0 };
    if payload.len() < 126 {
        bytes.push(mask_bit | payload.len() as u8);
    } else {
        bytes.push(mask_bit | 126);
        bytes.extend_from_slice(&u16::try_from(payload.len()).unwrap().to_be_bytes());
    }
    if masked {
        let mask = [1, 2, 3, 4];
        bytes.extend_from_slice(&mask);
        bytes.extend(
            payload
                .iter()
                .enumerate()
                .map(|(i, byte)| byte ^ mask[i % 4]),
        );
    } else {
        bytes.extend_from_slice(payload);
    }
    bytes
}

async fn expect_bytes(socket: &mut (impl AsyncRead + Unpin + ?Sized), expected: &[u8]) {
    let mut received = vec![0; expected.len()];
    tokio::time::timeout(Duration::from_secs(3), socket.read_exact(&mut received))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(received, expected);
}

async fn frame_roundtrip(tls_and_connect: bool) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    // Larger than the relay buffer, plus fragmentation and control messages.
    let payload: Vec<u8> = (0..16_385).map(|i| (i % 251) as u8).collect();
    let exchanges = vec![
        (frame(0x82, &payload, true), frame(0x82, &payload, false)),
        (frame(0x01, b"hel", true), frame(0x01, b"hel", false)),
        (frame(0x80, b"lo", true), frame(0x80, b"lo", false)),
        (frame(0x89, b"ping", true), frame(0x8a, b"ping", false)),
        (
            frame(0x88, b"\x03\xe8done", true),
            frame(0x88, b"\x03\xe8done", false),
        ),
    ];
    let server_exchanges = exchanges.clone();
    let acceptor = tls_fixture::test_acceptor();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        if tls_and_connect {
            let connect = head(&mut socket).await;
            assert!(connect.starts_with("CONNECT no-local-dns.invalid:443 HTTP/1.1"));
            assert!(!connect.contains("synthetic-cookie") && !connect.contains("synthetic-bearer"));
            socket
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
        }
        let mut socket: Box<dyn TestIo> = if tls_and_connect {
            Box::new(acceptor.accept(socket).await.unwrap())
        } else {
            Box::new(socket)
        };
        let request = head(&mut *socket).await;
        let headers = request.to_ascii_lowercase();
        assert!(request.starts_with("GET /socket?raw=%2F+ HTTP/1.1"));
        assert!(headers.contains("sec-websocket-protocol: chat, binary.v1\r\n"));
        assert!(headers.contains("cookie: sid=synthetic-cookie\r\n"));
        assert!(headers.contains("authorization: bearer synthetic-bearer\r\n"));
        assert!(!headers.contains("sec-websocket-extensions"));
        assert!(!headers.contains("__sorng_ws_document_v1"));
        assert!(!headers.contains(TOKEN));
        let reply = VALID.replace("\r\n\r\n", "\r\nSec-WebSocket-Protocol: binary.v1\r\n\r\n");
        socket.write_all(reply.as_bytes()).await.unwrap();
        // Exercise a server-originated ping and the browser's masked pong too.
        socket
            .write_all(&frame(0x89, b"server-ping", false))
            .await
            .unwrap();
        expect_bytes(&mut *socket, &frame(0x8a, b"server-ping", true)).await;
        for (sent, reply) in server_exchanges {
            expect_bytes(&mut *socket, &sent).await;
            socket.write_all(&reply).await.unwrap();
        }
        socket.shutdown().await.unwrap();
    });
    let server = WsUpstream {
        url: format!("http://{address}"),
        headers: Default::default(),
        closed: Default::default(),
        task: server,
    };
    let (target, transport) = if tls_and_connect {
        let cert = base64::engine::general_purpose::STANDARD
            .decode(tls_fixture::TEST_CERT)
            .unwrap();
        let transport = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(&server.url).unwrap())
            .use_preconfigured_tls(
                build_pinned_tls_config(hex::encode(Sha256::digest(&cert))).unwrap(),
            )
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        ("https://no-local-dns.invalid/".into(), transport)
    } else {
        (server.url.clone(), client())
    };
    let fixture = proxy(target, transport).await;
    let response = ws_request(&fixture)
        .header("Sec-WebSocket-Protocol", "chat, binary.v1")
        .header("Sec-WebSocket-Extensions", "permessage-deflate")
        .header("Cookie", "sid=synthetic-cookie")
        .header("Authorization", "Bearer synthetic-bearer")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 101);
    assert_eq!(response.headers()["sec-websocket-protocol"], "binary.v1");
    assert!(!response.headers().contains_key("sec-websocket-extensions"));
    let mut socket = response.upgrade().await.unwrap();
    expect_bytes(&mut socket, &frame(0x89, b"server-ping", false)).await;
    socket
        .write_all(&frame(0x8a, b"server-ping", true))
        .await
        .unwrap();
    for (sent, reply) in exchanges {
        socket.write_all(&sent).await.unwrap();
        expect_bytes(&mut socket, &reply).await;
    }
    let mut server = server;
    tokio::time::timeout(Duration::from_secs(3), &mut server.task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(fixture.state.request_count.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.state.error_count.load(Ordering::SeqCst), 0);
    let log = fixture
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].url, "WebSocket handshake");
    assert_eq!(log[0].status, 101);
    let serialized = serde_json::to_string(&log).unwrap();
    for secret in [
        "synthetic-cookie",
        "synthetic-bearer",
        "binary.v1",
        "raw=",
        TOKEN,
    ] {
        assert!(!serialized.contains(secret));
    }
}

#[tokio::test]
async fn websocket_plaintext_subprotocol_binary_fragment_control_and_close_frames_roundtrip() {
    tokio::time::timeout(Duration::from_secs(10), frame_roundtrip(false))
        .await
        .unwrap();
}

#[tokio::test]
async fn websocket_tls_connect_subprotocol_binary_fragment_control_and_close_frames_roundtrip() {
    tokio::time::timeout(Duration::from_secs(10), frame_roundtrip(true))
        .await
        .unwrap();
}

#[tokio::test]
async fn websocket_non_ascii_upstream_protocol_is_invalid_not_absent() {
    let reply = VALID.replace(
        "\r\n\r\n",
        "\r\nSec-WebSocket-Protocol: invalid-\u{e9}\r\n\r\n",
    );
    let upstream = upstream_ws(reply, false, false).await;
    let fixture = proxy(upstream.url.clone(), client()).await;
    let response = ws_request(&fixture).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert!(!response.headers().contains_key("sec-websocket-protocol"));
    assert_eq!(upstream.headers.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn websocket_upstream_rejection_preserves_status_without_challenge_body_or_cookie() {
    for status in [401, 403, 404, 429, 500, 503, 200] {
        let upstream = upstream_ws(format!(
            "HTTP/1.1 {status} Synthetic\r\nContent-Length: 12\r\nWWW-Authenticate: Basic realm=private-realm\r\nSet-Cookie: sid=private-cookie\r\nLocation: https://private-host.invalid/?token=private-query\r\nConnection: close\r\n\r\nprivate-body"
        ), false, false).await;
        let fixture = proxy(upstream.url.clone(), client()).await;
        let response = ws_request(&fixture).send().await.unwrap();
        let expected = if status == 200 { 502 } else { status };
        assert_eq!(response.status().as_u16(), expected);
        for header in ["www-authenticate", "set-cookie", "location"] {
            assert!(!response.headers().contains_key(header));
        }
        assert!(!response.text().await.unwrap().contains("private-"));
        assert_eq!(fixture.state.error_count.load(Ordering::SeqCst), 1);
        let manager = fixture.state.global_sessions.lock().unwrap();
        let log = manager.request_log_newest_first();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].status, expected);
        assert_eq!(
            log[0].error,
            Some(format!("HTTP {expected} [websocket_handshake]"))
        );
        assert!(!serde_json::to_string(&log).unwrap().contains("private-"));
    }
}

#[tokio::test]
async fn websocket_local_refusal_observation_is_bounded_and_never_logs_credentials() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let fixture = proxy(
        format!("http://{}/", listener.local_addr().unwrap()),
        client(),
    )
    .await;
    fixture
        .state
        .global_sessions
        .lock()
        .unwrap()
        .set_request_log_capacity(2)
        .unwrap();
    for _ in 0..3 {
        let mut request = ws_request(&fixture)
            .header("Authorization", "Bearer private-header")
            .header("Cookie", "sid=private-cookie")
            .build()
            .unwrap();
        request.url_mut().set_path("/private-path");
        request
            .url_mut()
            .set_query(Some("token=private-query&__sorng_ws_document_v1=0"));
        assert_eq!(client().execute(request).await.unwrap().status(), 400);
    }
    assert_eq!(fixture.state.request_count.load(Ordering::SeqCst), 3);
    assert_eq!(fixture.state.error_count.load(Ordering::SeqCst), 3);
    let log = fixture
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    assert_eq!(log.len(), 2);
    assert!(log.iter().all(|entry| entry.url == "WebSocket handshake"));
    assert!(!serde_json::to_string(&log).unwrap().contains("private-"));
    assert!(
        tokio::time::timeout(Duration::from_millis(50), listener.accept())
            .await
            .is_err()
    );
}
