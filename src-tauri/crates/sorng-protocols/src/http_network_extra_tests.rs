use super::*;

#[tokio::test]
async fn websocket_proxy_407_has_zero_direct_destination_connections_and_no_retry() {
    let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = destination.local_addr().unwrap().port();
    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_port = proxy_listener.local_addr().unwrap().port();
    let count = Arc::new(AtomicU64::new(0));
    let requests = count.clone();
    let proxy_task = tokio::spawn(async move {
        loop {
            let (mut socket, _) = proxy_listener.accept().await.unwrap();
            requests.fetch_add(1, Ordering::SeqCst);
            let request = head(&mut socket).await;
            assert!(request.starts_with("CONNECT "));
            assert!(!request.contains("private-username") && !request.contains("private-password"));
            socket.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
        }
    });
    let transport = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{proxy_port}")).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let fixture = proxy_with_mode(
        format!("https://127.0.0.1:{port}/"),
        transport,
        UpstreamAuthMode::Basic,
    )
    .await;
    *fixture.state.username.write().unwrap() = "private-username".into();
    *fixture.state.password.write().unwrap() = "private-password".into();
    let response = ws_request(&fixture).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert!(!response.text().await.unwrap().contains("private-"));
    assert!(
        tokio::time::timeout(Duration::from_millis(100), destination.accept())
            .await
            .is_err()
    );
    assert_eq!(count.load(Ordering::SeqCst), 1);
    proxy_task.abort();
}

#[tokio::test]
async fn websocket_limit_and_stale_document_refuse_before_any_upstream() {
    let upstream = upstream_ws(VALID.into(), false, false).await;
    let fixture = proxy(upstream.url.clone(), client()).await;
    let permit = fixture
        .state
        .network
        .sockets
        .clone()
        .acquire_many_owned(16)
        .await
        .unwrap();
    assert_eq!(
        ws_request(&fixture).send().await.unwrap().status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    drop(permit);
    let request = ws_request(&fixture).build().unwrap();
    fixture.state.network.document_issued(2, false);
    fixture.state.network.activate_document(2).unwrap();
    assert_eq!(
        client().execute(request).await.unwrap().status(),
        StatusCode::GONE
    );
    assert!(upstream.headers.lock().unwrap().is_empty());
}

#[tokio::test]
async fn main_websocket_survives_real_child_document_request_then_primary_selection_revokes() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().fallback(|mut request: axum::extract::Request| async move {
                if request.headers().contains_key("sec-websocket-key") {
                    let upgrade = hyper::upgrade::on(&mut request);
                    tokio::spawn(async move {
                        let mut socket = hyper_util::rt::TokioIo::new(upgrade.await.unwrap());
                        let mut frame = [0u8; 8];
                        while socket.read_exact(&mut frame).await.is_ok() {
                            assert_eq!(frame, [0x81, 0x82, 1, 2, 3, 4, b'h' ^ 1, b'i' ^ 2]);
                            if socket.write_all(&[0x81, 2, b'h', b'i']).await.is_err() {
                                break;
                            }
                        }
                    });
                    Response::builder()
                        .status(101)
                        .header("Connection", "Upgrade")
                        .header("Upgrade", "websocket")
                        .header("Sec-WebSocket-Accept", ACCEPT)
                        .body(Body::empty())
                        .unwrap()
                } else {
                    Response::builder()
                        .header("Content-Type", "text/html")
                        .body(Body::from(
                            "<!doctype html><html><head></head><body>child</body></html>",
                        ))
                        .unwrap()
                }
            }),
        )
        .await
        .unwrap();
    });
    let fixture = proxy(format!("http://127.0.0.1:{port}/"), client()).await;
    let mut socket = echo(ws_request(&fixture).send().await.unwrap()).await;
    let child = client()
        .get(format!("{}/child", fixture.base))
        .header("Host", &fixture.state.proxy_authority)
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .send()
        .await
        .unwrap();
    assert_eq!(child.status(), 200);
    assert_eq!(fixture.state.document_sequence.load(Ordering::SeqCst), 2);
    assert!(fixture.state.network.document_is_current(1));
    socket
        .write_all(&[0x81, 0x82, 1, 2, 3, 4, b'h' ^ 1, b'i' ^ 2])
        .await
        .unwrap();
    let mut frame = [0u8; 4];
    tokio::time::timeout(Duration::from_secs(2), socket.read_exact(&mut frame))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(frame, [0x81, 2, b'h', b'i']);
    // Parent accepts a later primary document, not the intervening child.
    let primary = fetch(&fixture, "/primary").await;
    assert_eq!(primary.status(), 200);
    let selected = fixture.state.document_sequence.load(Ordering::SeqCst);
    fixture.state.network.activate_document(selected).unwrap();
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), socket.read(&mut frame)).await,
        Ok(Ok(0)) | Ok(Err(_))
    ));
    server.abort();
}

#[tokio::test]
async fn websocket_early_request_waits_for_parent_selection_before_network() {
    let upstream = upstream_ws(VALID.into(), false, false).await;
    let fixture = proxy(upstream.url.clone(), client()).await;
    let mut request = ws_request(&fixture).build().unwrap();
    request
        .url_mut()
        .set_query(Some("__sorng_ws_document_v1=2"));
    fixture.state.network.document_issued(2, false);
    let request_task = tokio::spawn(async move { client().execute(request).await.unwrap() });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(upstream.headers.lock().unwrap().is_empty());
    assert!(!request_task.is_finished());
    fixture.state.network.activate_document(2).unwrap();
    let response = tokio::time::timeout(Duration::from_secs(2), request_task)
        .await
        .unwrap()
        .unwrap();
    drop(echo(response).await);
}

#[test]
fn primary_selection_is_bounded_monotonic_and_preserves_active_main_amid_many_children() {
    let state = ProxyNetworkState::default();
    assert!(state.activate_document(1).is_err());
    state.document_issued(1, true);
    assert!(!state.activate_document(1).unwrap());
    for sequence in 2..=100 {
        state.document_issued(sequence, false);
    }
    assert!(state.document_is_current(1));
    assert!(!state.activate_document(1).unwrap());
    assert!(state.activate_document(2).is_err());
    assert!(state.activate_document(100).unwrap());
    assert!(state.activate_document(1).is_err());
    state.revoke();
    assert!(state.activate_document(100).is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_document_selection_and_revocation_never_deadlock_or_reactivate() {
    tokio::time::timeout(Duration::from_secs(5), async {
        for _ in 0..64 {
            let state = Arc::new(ProxyNetworkState::default());
            state.document_issued(1, true);
            state.document_issued(2, false);
            let waiter_state = state.clone();
            let waiter = tokio::spawn(async move { waiter_state.await_document(2).await });
            let selector_state = state.clone();
            let selector = tokio::spawn(async move { selector_state.activate_document(2) });
            let revoker_state = state.clone();
            let revoker = tokio::spawn(async move { revoker_state.revoke() });
            // Either selection wins briefly or revocation refuses it. Both
            // outcomes must terminate, and neither can revive a stopped proxy.
            let _ = waiter.await.unwrap();
            let _ = selector.await.unwrap();
            revoker.await.unwrap();
            assert!(!state.is_active());
            assert!(!state.document_is_current(2));
            assert!(state.activate_document(2).is_err());
        }
    })
    .await
    .expect("document selection and revocation must not retain inverted locks");
}
