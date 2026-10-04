use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tokio::sync::Notify;
use tokio::time::timeout;

const TEST_DEADLINE: Duration = Duration::from_secs(5);

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

fn request(authority: &str, authorization: &str) -> Vec<u8> {
    format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\nProxy-Authorization: {authorization}\r\n\r\n").into_bytes()
}

async fn head(stream: &mut (impl AsyncRead + Unpin)) -> String {
    timeout(TEST_DEADLINE, async {
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            bytes.push(stream.read_u8().await.unwrap());
            assert!(bytes.len() <= 16 * 1024);
        }
        String::from_utf8(bytes).unwrap()
    })
    .await
    .unwrap()
}

async fn exchange(proxy: &PrivateForwardProxy, bytes: &[u8]) -> String {
    let mut stream = TcpStream::connect(proxy.local_addr()).await.unwrap();
    stream.write_all(bytes).await.unwrap();
    head(&mut stream).await
}

fn forbidden_dialer(calls: Arc<AtomicUsize>) -> Arc<dyn RouteDialer> {
    Arc::new(move |_: Authority| -> DialFuture {
        calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            Err(io::Error::other(
                "synthetic secret that must not reach the client",
            ))
        })
    })
}

fn tcp_dialer(address: SocketAddr, calls: Arc<AtomicUsize>) -> Arc<dyn RouteDialer> {
    Arc::new(move |_: Authority| -> DialFuture {
        calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move { Ok(Box::new(TcpStream::connect(address).await?) as BoxedStream) })
    })
}

async fn closed(stream: &mut TcpStream) {
    let result = timeout(TEST_DEADLINE, stream.read(&mut [0u8; 1]))
        .await
        .unwrap();
    assert!(matches!(result, Ok(0)) || result.is_err());
}

#[test]
fn authorities_are_unambiguous_and_include_ipv6() {
    for (input, expected) in [
        ("Example.TEST:443", "example.test:443"),
        ("127.0.0.1:80", "127.0.0.1:80"),
        ("[2001:0DB8::1]:443", "[2001:db8::1]:443"),
        ("[::1]:65535", "[::1]:65535"),
        ("xn--bcher-kva.example:443", "xn--bcher-kva.example:443"),
    ] {
        let authority = Authority::parse(input).unwrap();
        assert_eq!(authority.to_string(), expected);
        assert_eq!(Authority::parse(expected).unwrap(), authority);
    }
    for input in [
        "",
        "example.test",
        "https://example.test:443",
        "user@example.test:443",
        "example.test:443/path",
        "example.test:443?q=1",
        "example.test:443#fragment",
        "example.test:0",
        "example.test:0443",
        "example.test:+443",
        "example.test:65536",
        "example.test:443:80",
        "example.test:443\r\nX: y",
        "example.test :443",
        "example%2etest:443",
        "example.test.:443",
        "a..test:443",
        "-bad.test:443",
        "bad-.test:443",
        "b_ad.test:443",
        "bücher.test:443",
        "127.1:443",
        "2130706433:443",
        "0x7f000001:443",
        "0177.0.0.1:443",
        "256.0.0.1:443",
        "::1:443",
        "[::1]",
        "[::1%lo]:443",
        "[::1]:443/x",
        "[127.0.0.1]:443",
    ] {
        assert!(Authority::parse(input).is_err(), "accepted {input:?}");
    }
}

#[tokio::test]
async fn missing_wrong_or_other_sessions_auth_gets_407_without_grant_or_dial() {
    let calls = Arc::new(AtomicUsize::new(0));
    let grants = Arc::new(AtomicUsize::new(0));
    let seen = grants.clone();
    let mut proxy = PrivateForwardProxy::start(
        forbidden_dialer(calls.clone()),
        Arc::new(move |_| {
            seen.fetch_add(1, Ordering::SeqCst);
            true
        }),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    let mut other = PrivateForwardProxy::start(
        forbidden_dialer(calls.clone()),
        Arc::new(|_| true),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    assert_ne!(auth(&proxy), auth(&other));
    assert_eq!(proxy.local_addr().ip(), Ipv4Addr::LOCALHOST);
    assert_ne!(proxy.local_addr().port(), 0);
    for bytes in [
        b"CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n".to_vec(),
        request("example.test:443", "Basic d3Jvbmc6d3Jvbmc="),
        request("example.test:443", "Bearer ignored"),
        request("example.test:443", "Basic not!base64"),
        request("example.test:443", &auth(&other)),
    ] {
        let reply = exchange(&proxy, &bytes).await;
        assert!(reply.starts_with("HTTP/1.1 407 "));
        assert!(reply.contains("Proxy-Authenticate: Basic realm=\"private-forward-proxy\""));
        assert!(!reply.contains(&auth(&proxy)));
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(grants.load(Ordering::SeqCst), 0);
    proxy.stop().await.unwrap();
    other.stop().await.unwrap();
}

#[tokio::test]
async fn malformed_and_ambiguous_admission_never_dials() {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut proxy = PrivateForwardProxy::start(
        forbidden_dialer(calls.clone()),
        Arc::new(|_| true),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    let authorization = auth(&proxy);
    for (line, fields) in [
        (
            "GET example.test:443 HTTP/1.1",
            "Host: example.test:443\r\n",
        ),
        (
            "CONNECT example.test:443 HTTP/1.0",
            "Host: example.test:443\r\n",
        ),
        (
            "CONNECT  example.test:443 HTTP/1.1",
            "Host: example.test:443\r\n",
        ),
        (
            "CONNECT https://example.test:443 HTTP/1.1",
            "Host: example.test:443\r\n",
        ),
        ("CONNECT example.test:443 HTTP/1.1", ""),
        (
            "CONNECT example.test:443 HTTP/1.1",
            "Host: other.test:443\r\n",
        ),
        (
            "CONNECT example.test:443 HTTP/1.1",
            "Host: example.test:443\r\nhOsT: example.test:443\r\n",
        ),
        (
            "CONNECT example.test:443 HTTP/1.1",
            "Host : example.test:443\r\n",
        ),
        (
            "CONNECT example.test:443 HTTP/1.1",
            "Host: example.test:443\r\n continuation\r\n",
        ),
        (
            "CONNECT example.test:443 HTTP/1.1",
            "Host: example.test:443\r\nX-Test: a\nb\r\n",
        ),
        (
            "CONNECT example.test:443 HTTP/1.1",
            "Host: example.test:443\r\nContent-Length: 0\r\n",
        ),
        (
            "CONNECT example.test:443 HTTP/1.1",
            "Host: example.test:443\r\nTransfer-Encoding: chunked\r\n",
        ),
        (
            "CONNECT example.test:443 HTTP/1.1",
            "Host: example.test:443\r\nConnection: proxy-authorization\r\n",
        ),
        (
            "CONNECT example.test:443 HTTP/1.1",
            "Host: example.test:443\r\nAuthorization: Basic application-secret\r\n",
        ),
        (
            "CONNECT example.test:443 HTTP/1.1",
            "Host: example.test:443\r\nProxy-Authorization: Basic duplicate\r\n",
        ),
    ] {
        let reply = exchange(
            &proxy,
            format!("{line}\r\n{fields}Proxy-Authorization: {authorization}\r\n\r\n").as_bytes(),
        )
        .await;
        assert!(
            reply.starts_with("HTTP/1.1 400 "),
            "{line}, {fields}: {reply}"
        );
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn destination_grant_is_exact_and_revocable_before_dial() {
    let calls = Arc::new(AtomicUsize::new(0));
    let grant = exact_authority_grant(Authority::parse("allowed.test:443").unwrap());
    assert!(!grant(&Authority::parse("allowed.test:444").unwrap()));
    assert!(grant(&Authority::parse("ALLOWED.test:443").unwrap()));
    let permitted = Arc::new(AtomicBool::new(true));
    let current = permitted.clone();
    let mut proxy = PrivateForwardProxy::start(
        forbidden_dialer(calls.clone()),
        Arc::new(move |authority| current.load(Ordering::SeqCst) && grant(authority)),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    assert!(exchange(&proxy, &request("denied.test:443", &auth(&proxy)))
        .await
        .starts_with("HTTP/1.1 403 "));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(
        exchange(&proxy, &request("allowed.test:443", &auth(&proxy)))
            .await
            .starts_with("HTTP/1.1 502 ")
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    permitted.store(false, Ordering::SeqCst);
    assert!(
        exchange(&proxy, &request("allowed.test:443", &auth(&proxy)))
            .await
            .starts_with("HTTP/1.1 403 ")
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn failed_configured_route_never_falls_back_to_reachable_target() {
    let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let authority = target.local_addr().unwrap().to_string();
    let calls = Arc::new(AtomicUsize::new(0));
    let mut proxy = PrivateForwardProxy::start(
        forbidden_dialer(calls.clone()),
        exact_authority_grant(Authority::parse(&authority).unwrap()),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    let reply = exchange(&proxy, &request(&authority, &auth(&proxy))).await;
    assert!(reply.starts_with("HTTP/1.1 502 "));
    assert!(!reply.contains("synthetic secret"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(timeout(Duration::from_millis(100), target.accept())
        .await
        .is_err());
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn early_binary_bytes_and_client_half_close_are_lossless() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    // No destination DNS: native dialer maps this deliberately unresolvable name.
    let grant = Authority::parse("no-local-dns.invalid:443").unwrap();
    let dialer = tcp_dialer(
        listener.local_addr().unwrap(),
        Arc::new(AtomicUsize::new(0)),
    );
    let mut proxy =
        PrivateForwardProxy::start(dialer, exact_authority_grant(grant), ProxyLimits::default())
            .await
            .unwrap();
    let payload: Vec<u8> = (0..128 * 1024).map(|n| (n % 256) as u8).collect();
    let expected = payload.clone();
    let peer = tokio::spawn(async move {
        let (mut upstream, _) = listener.accept().await.unwrap();
        let mut received = Vec::new();
        upstream.read_to_end(&mut received).await.unwrap();
        assert_eq!(received, expected); // no CONNECT/auth headers in the tunnel
        upstream
            .write_all(b"response only after client EOF\0\xff")
            .await
            .unwrap();
        upstream.shutdown().await.unwrap();
    });
    let mut client = TcpStream::connect(proxy.local_addr()).await.unwrap();
    let mut bytes = request("no-local-dns.invalid:443", &auth(&proxy));
    bytes.extend_from_slice(&payload);
    client.write_all(&bytes).await.unwrap();
    client.shutdown().await.unwrap();
    assert!(head(&mut client).await.starts_with("HTTP/1.1 200 "));
    let mut reply = Vec::new();
    timeout(TEST_DEADLINE, client.read_to_end(&mut reply))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reply, b"response only after client EOF\0\xff");
    timeout(TEST_DEADLINE, peer).await.unwrap().unwrap();
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn upstream_half_close_still_allows_client_to_send() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut proxy = PrivateForwardProxy::start(
        tcp_dialer(
            listener.local_addr().unwrap(),
            Arc::new(AtomicUsize::new(0)),
        ),
        Arc::new(|_| true),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    let peer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        stream.write_all(b"greeting").await.unwrap();
        stream.shutdown().await.unwrap();
        let mut received = Vec::new();
        stream.read_to_end(&mut received).await.unwrap();
        assert_eq!(received, b"sent after server EOF");
    });
    let mut client = TcpStream::connect(proxy.local_addr()).await.unwrap();
    client
        .write_all(&request("example.test:443", &auth(&proxy)))
        .await
        .unwrap();
    assert!(head(&mut client).await.starts_with("HTTP/1.1 200 "));
    let mut greeting = Vec::new();
    timeout(TEST_DEADLINE, client.read_to_end(&mut greeting))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(greeting, b"greeting");
    client.write_all(b"sent after server EOF").await.unwrap();
    client.shutdown().await.unwrap();
    timeout(TEST_DEADLINE, peer).await.unwrap().unwrap();
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn fragmented_header_boundary_preserves_immediate_upstream_bytes() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut proxy = PrivateForwardProxy::start(
        tcp_dialer(
            listener.local_addr().unwrap(),
            Arc::new(AtomicUsize::new(0)),
        ),
        Arc::new(|_| true),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    let peer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        stream.write_all(b"early server bytes").await.unwrap();
        let mut data = [0; 3];
        stream.read_exact(&mut data).await.unwrap();
        assert_eq!(data, [0, 255, 17]);
        stream.shutdown().await.unwrap();
    });
    let mut client = TcpStream::connect(proxy.local_addr()).await.unwrap();
    let bytes = request("[::1]:443", &auth(&proxy));
    for byte in &bytes[..bytes.len() - 1] {
        client.write_all(&[*byte]).await.unwrap();
        tokio::task::yield_now().await;
    }
    client.write_all(&[b'\n', 0, 255, 17]).await.unwrap();
    assert!(head(&mut client).await.starts_with("HTTP/1.1 200 "));
    let mut response = Vec::new();
    timeout(TEST_DEADLINE, client.read_to_end(&mut response))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response, b"early server bytes");
    timeout(TEST_DEADLINE, peer).await.unwrap().unwrap();
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn header_size_count_and_absolute_deadline_are_bounded() {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut proxy = PrivateForwardProxy::start(
        forbidden_dialer(calls.clone()),
        Arc::new(|_| true),
        ProxyLimits {
            max_header_bytes: 512,
            header_timeout: Duration::from_millis(150),
            ..ProxyLimits::default()
        },
    )
    .await
    .unwrap();
    let mut oversized = b"CONNECT example.test:443 HTTP/1.1\r\nX: ".to_vec();
    oversized.resize(512, b'x');
    assert!(exchange(&proxy, &oversized)
        .await
        .starts_with("HTTP/1.1 431 "));
    let mut slow = TcpStream::connect(proxy.local_addr()).await.unwrap();
    slow.write_all(b"CON").await.unwrap();
    assert!(head(&mut slow).await.starts_with("HTTP/1.1 408 "));
    proxy.stop().await.unwrap();
    let mut proxy = PrivateForwardProxy::start(
        forbidden_dialer(calls.clone()),
        Arc::new(|_| true),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    let fields: String = (0..65).map(|n| format!("X-{n}: v\r\n")).collect();
    let bytes = format!("CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\nProxy-Authorization: {}\r\n{fields}\r\n", auth(&proxy));
    assert!(exchange(&proxy, bytes.as_bytes())
        .await
        .starts_with("HTTP/1.1 400 "));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    proxy.stop().await.unwrap();
}

struct DropNotice(Arc<AtomicBool>);
impl Drop for DropNotice {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

fn pending_dialer(entered: Arc<Notify>, dropped: Arc<AtomicBool>) -> Arc<dyn RouteDialer> {
    Arc::new(move |_: Authority| -> DialFuture {
        let guard = DropNotice(dropped.clone());
        let entered = entered.clone();
        Box::pin(async move {
            let _guard = guard;
            entered.notify_one();
            std::future::pending().await
        })
    })
}

#[tokio::test]
async fn dial_deadline_cancels_establishment_and_returns_only_fixed_error() {
    let dropped = Arc::new(AtomicBool::new(false));
    let mut proxy = PrivateForwardProxy::start(
        pending_dialer(Arc::new(Notify::new()), dropped.clone()),
        Arc::new(|_| true),
        ProxyLimits {
            dial_timeout: Duration::from_millis(100),
            ..ProxyLimits::default()
        },
    )
    .await
    .unwrap();
    assert!(
        exchange(&proxy, &request("example.test:443", &auth(&proxy)))
            .await
            .starts_with("HTTP/1.1 504 ")
    );
    assert!(dropped.load(Ordering::SeqCst));
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn client_cap_includes_pending_dials_and_stop_cancels_them() {
    let entered = Arc::new(Notify::new());
    let dropped = Arc::new(AtomicBool::new(false));
    let mut proxy = PrivateForwardProxy::start(
        pending_dialer(entered.clone(), dropped.clone()),
        Arc::new(|_| true),
        ProxyLimits {
            max_clients: 1,
            ..ProxyLimits::default()
        },
    )
    .await
    .unwrap();
    assert!(proxy.is_running());
    let mut client = TcpStream::connect(proxy.local_addr()).await.unwrap();
    client
        .write_all(&request("example.test:443", &auth(&proxy)))
        .await
        .unwrap();
    timeout(TEST_DEADLINE, entered.notified()).await.unwrap();
    assert!(
        exchange(&proxy, &request("example.test:443", &auth(&proxy)))
            .await
            .starts_with("HTTP/1.1 503 ")
    );
    timeout(TEST_DEADLINE, proxy.stop()).await.unwrap().unwrap();
    assert!(dropped.load(Ordering::SeqCst));
    closed(&mut client).await;
    assert!(TcpStream::connect(proxy.local_addr()).await.is_err());
    assert!(proxy.with_credentials(|_, _| ()).is_none());
    assert!(!proxy.is_running());
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn unexpected_supervisor_cancellation_revokes_readiness_and_credentials() {
    let mut proxy = PrivateForwardProxy::start(
        forbidden_dialer(Arc::new(AtomicUsize::new(0))),
        Arc::new(|_| true),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    assert!(proxy.is_running());
    proxy.task.as_ref().unwrap().abort();
    timeout(TEST_DEADLINE, async {
        while !proxy.task.as_ref().unwrap().is_finished() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(!*proxy.stopped.borrow()); // failure, not explicit revocation
    assert!(!proxy.is_running());
    assert!(proxy
        .with_credentials(|_, _| panic!("credentials exposed after failure"))
        .is_none());
    assert!(TcpStream::connect(proxy.local_addr()).await.is_err());
    assert!(timeout(TEST_DEADLINE, proxy.stop()).await.unwrap().is_err());
    assert!(!proxy.is_running());
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn completed_supervisor_results_and_explicit_revocation_are_not_running() {
    for fail in [false, true] {
        // Deterministically inject either supervisor return value. Forcing a
        // real OS accept failure is platform-dependent; its observable handle
        // state is this same completed JoinHandle with an unchanged watch flag.
        let (stopped, _receiver) = watch::channel(false);
        let (finish, finished) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            finished.await.unwrap();
            if fail {
                Err(io::Error::other("synthetic accept failure"))
            } else {
                Ok(())
            }
        });
        let mut proxy = PrivateForwardProxy {
            address: "127.0.0.1:1".parse().unwrap(),
            password: Zeroizing::new("synthetic-not-a-live-credential".into()),
            stopped,
            task: Some(task),
        };
        assert!(proxy.is_running());
        finish.send(()).unwrap();
        timeout(TEST_DEADLINE, async {
            while !proxy.task.as_ref().unwrap().is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(!*proxy.stopped.borrow());
        assert!(!proxy.is_running());
        assert!(proxy
            .with_credentials(|_, _| panic!("credentials exposed after exit"))
            .is_none());
        assert_eq!(
            timeout(TEST_DEADLINE, proxy.stop()).await.unwrap().is_err(),
            fail
        );
        assert!(!proxy.is_running());
        proxy.stop().await.unwrap();
    }
    let mut proxy = PrivateForwardProxy::start(
        forbidden_dialer(Arc::new(AtomicUsize::new(0))),
        Arc::new(|_| true),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    proxy.revoke();
    assert!(!proxy.is_running()); // immediate, even before task cleanup runs
    assert!(proxy
        .with_credentials(|_, _| panic!("credentials exposed after revoke"))
        .is_none());
    timeout(TEST_DEADLINE, proxy.stop()).await.unwrap().unwrap();
}

#[tokio::test]
async fn stop_closes_active_and_unauthenticated_streams_and_drop_also_revokes() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut proxy = PrivateForwardProxy::start(
        tcp_dialer(
            listener.local_addr().unwrap(),
            Arc::new(AtomicUsize::new(0)),
        ),
        Arc::new(|_| true),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    let mut client = TcpStream::connect(proxy.local_addr()).await.unwrap();
    client
        .write_all(&request("example.test:443", &auth(&proxy)))
        .await
        .unwrap();
    let (mut peer, _) = timeout(TEST_DEADLINE, listener.accept())
        .await
        .unwrap()
        .unwrap();
    assert!(head(&mut client).await.starts_with("HTTP/1.1 200 "));
    let mut slow = TcpStream::connect(proxy.local_addr()).await.unwrap();
    slow.write_all(b"CON").await.unwrap();
    timeout(TEST_DEADLINE, proxy.stop()).await.unwrap().unwrap();
    closed(&mut client).await;
    closed(&mut peer).await;
    closed(&mut slow).await;

    let proxy = PrivateForwardProxy::start(
        forbidden_dialer(Arc::new(AtomicUsize::new(0))),
        Arc::new(|_| true),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    let mut slow = TcpStream::connect(proxy.local_addr()).await.unwrap();
    slow.write_all(b"CON").await.unwrap();
    drop(proxy);
    closed(&mut slow).await;
}

#[tokio::test]
async fn cancelling_stop_does_not_detach_cleanup_and_capacity_is_reclaimed() {
    let entered = Arc::new(Notify::new());
    let dropped = Arc::new(AtomicBool::new(false));
    let mut proxy = PrivateForwardProxy::start(
        pending_dialer(entered.clone(), dropped.clone()),
        Arc::new(|_| true),
        ProxyLimits {
            max_clients: 1,
            ..ProxyLimits::default()
        },
    )
    .await
    .unwrap();
    // Completed unauthenticated requests release the same cap used by dials.
    for _ in 0..4 {
        let reply = exchange(&proxy, &request("example.test:443", "Basic d3Jvbmc=")).await;
        assert!(reply.starts_with("HTTP/1.1 407 "));
    }
    let mut client = TcpStream::connect(proxy.local_addr()).await.unwrap();
    client
        .write_all(&request("example.test:443", &auth(&proxy)))
        .await
        .unwrap();
    timeout(TEST_DEADLINE, entered.notified()).await.unwrap();
    let mut stopping = Box::pin(proxy.stop());
    assert!(futures_util::poll!(stopping.as_mut()).is_pending());
    drop(stopping);
    timeout(TEST_DEADLINE, proxy.stop()).await.unwrap().unwrap();
    assert!(dropped.load(Ordering::SeqCst));
    closed(&mut client).await;
}

#[tokio::test]
async fn concurrent_tunnels_do_not_mix_payloads_or_authentication() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let mut proxy = PrivateForwardProxy::start(
        tcp_dialer(listener.local_addr().unwrap(), calls.clone()),
        Arc::new(|_| true),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    let peer = tokio::spawn(async move {
        let mut peers = JoinSet::new();
        for _ in 0..8 {
            let (mut stream, _) = listener.accept().await.unwrap();
            peers.spawn(async move {
                let mut bytes = Vec::new();
                stream.read_to_end(&mut bytes).await.unwrap();
                assert_eq!(bytes.len(), 96 * 1024);
                stream.write_all(&bytes).await.unwrap();
                stream.shutdown().await.unwrap();
            });
        }
        while let Some(result) = peers.join_next().await {
            result.unwrap();
        }
    });
    let mut clients = JoinSet::new();
    for id in 0..8u8 {
        let address = proxy.local_addr();
        let request = request("example.test:443", &auth(&proxy));
        clients.spawn(async move {
            let mut stream = TcpStream::connect(address).await.unwrap();
            stream.write_all(&request).await.unwrap();
            assert!(head(&mut stream).await.starts_with("HTTP/1.1 200 "));
            let payload = vec![id; 96 * 1024];
            stream.write_all(&payload).await.unwrap();
            stream.shutdown().await.unwrap();
            let mut received = Vec::new();
            stream.read_to_end(&mut received).await.unwrap();
            assert_eq!(received, payload);
        });
    }
    timeout(TEST_DEADLINE, async {
        while let Some(result) = clients.join_next().await {
            result.unwrap();
        }
        peer.await.unwrap();
    })
    .await
    .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 8);
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn invalid_limits_fail_before_listener_start() {
    for limits in [
        ProxyLimits {
            max_clients: 0,
            ..ProxyLimits::default()
        },
        ProxyLimits {
            max_clients: 257,
            ..ProxyLimits::default()
        },
        ProxyLimits {
            max_header_bytes: 255,
            ..ProxyLimits::default()
        },
        ProxyLimits {
            max_header_bytes: 16385,
            ..ProxyLimits::default()
        },
        ProxyLimits {
            header_timeout: Duration::ZERO,
            ..ProxyLimits::default()
        },
        ProxyLimits {
            dial_timeout: Duration::from_secs(121),
            ..ProxyLimits::default()
        },
    ] {
        let result = PrivateForwardProxy::start(
            forbidden_dialer(Arc::new(AtomicUsize::new(0))),
            Arc::new(|_| true),
            limits,
        )
        .await;
        match result {
            Err(error) => assert_eq!(error.kind(), io::ErrorKind::InvalidInput),
            Ok(_) => panic!("invalid limits accepted"),
        }
    }
}

#[tokio::test]
async fn real_tls_and_websocket_upgrade_remain_end_to_end_and_opaque() {
    use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer, ServerName};
    let cert = rcgen::generate_simple_self_signed(vec!["synthetic.test".into()]).unwrap();
    let der = CertificateDer::from(cert.serialize_der().unwrap());
    let key = PrivatePkcs8KeyDer::from(cert.serialize_private_key_der());
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let server = rustls::ServerConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![der.clone()], key.into())
        .unwrap();
    let mut roots = rustls::RootCertStore::empty();
    roots.add(der).unwrap();
    let client_config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut proxy = PrivateForwardProxy::start(
        tcp_dialer(
            listener.local_addr().unwrap(),
            Arc::new(AtomicUsize::new(0)),
        ),
        exact_authority_grant(Authority::parse("synthetic.test:443").unwrap()),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    let peer = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let mut tls = tokio_rustls::TlsAcceptor::from(Arc::new(server))
            .accept(tcp)
            .await
            .unwrap();
        let request = head(&mut tls).await;
        assert_eq!(request, "GET /socket?signed=%2F+ HTTP/1.1\r\nHost: synthetic.test\r\nOrigin: https://synthetic.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n");
        assert!(!request.contains("Proxy-Authorization"));
        tls.write_all(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n").await.unwrap();
        let mut frame = [0; 8];
        tls.read_exact(&mut frame).await.unwrap();
        assert_eq!(frame, [0x81, 0x82, 1, 2, 3, 4, b'h' ^ 1, b'i' ^ 2]);
        tls.write_all(&[0x81, 2, b'h', b'i']).await.unwrap();
        tls.shutdown().await.unwrap();
    });
    let mut client = TcpStream::connect(proxy.local_addr()).await.unwrap();
    client
        .write_all(&request("synthetic.test:443", &auth(&proxy)))
        .await
        .unwrap();
    assert!(head(&mut client).await.starts_with("HTTP/1.1 200 "));
    let mut tls = timeout(
        TEST_DEADLINE,
        tokio_rustls::TlsConnector::from(Arc::new(client_config))
            .connect(ServerName::try_from("synthetic.test").unwrap(), client),
    )
    .await
    .unwrap()
    .unwrap();
    tls.write_all(b"GET /socket?signed=%2F+ HTTP/1.1\r\nHost: synthetic.test\r\nOrigin: https://synthetic.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n").await.unwrap();
    assert!(head(&mut tls).await.starts_with("HTTP/1.1 101 "));
    tls.write_all(&[0x81, 0x82, 1, 2, 3, 4, b'h' ^ 1, b'i' ^ 2])
        .await
        .unwrap();
    let mut frame = [0; 4];
    timeout(TEST_DEADLINE, tls.read_exact(&mut frame))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(frame, [0x81, 2, b'h', b'i']);
    timeout(TEST_DEADLINE, peer).await.unwrap().unwrap();
    proxy.stop().await.unwrap();
}
