use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::io::DuplexStream;
use tokio::sync::mpsc;
use tokio::time::{timeout, Instant};

const DEADLINE: Duration = Duration::from_secs(5);
const DESTINATION: &str = "relay-fixture.invalid:443";

struct FaultListener {
    listener: TcpListener,
    faults: mpsc::UnboundedReceiver<io::Error>,
    failed: mpsc::UnboundedSender<Instant>,
}

impl AcceptListener for FaultListener {
    fn accept(&mut self) -> impl Future<Output = io::Result<(TcpStream, SocketAddr)>> + Send + '_ {
        async move {
            // Both branches are cancellation-safe. Only accept is substituted;
            // admission, authentication, grants, dial and relaying stay real.
            tokio::select! {
                biased;
                Some(error) = self.faults.recv() => {
                    self.failed.send(Instant::now()).unwrap();
                    Err(error)
                },
                result = self.listener.accept() => result,
            }
        }
    }
}

struct Fixture {
    proxy: PrivateForwardProxy,
    faults: mpsc::UnboundedSender<io::Error>,
    failed: mpsc::UnboundedReceiver<Instant>,
    upstream: mpsc::UnboundedReceiver<DuplexStream>,
    dials: Arc<AtomicUsize>,
}

impl Fixture {
    async fn new() -> Self {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let password = Zeroizing::new(format!("synthetic-fixture-{}", address.port()));
        let credential_hash = Sha256::digest(format!("{USERNAME}:{}", password.as_str())).into();
        let (stopped, stop) = watch::channel(false);
        let observations = Arc::new(Observations::default());
        let (faults, faults_rx) = mpsc::unbounded_channel();
        let (failed_tx, failed) = mpsc::unbounded_channel();
        let (upstream_tx, upstream) = mpsc::unbounded_channel();
        let dials = Arc::new(AtomicUsize::new(0));
        let calls = dials.clone();
        let dialer = Arc::new(move |authority: Authority| -> DialFuture {
            assert_eq!(authority.to_string(), DESTINATION);
            calls.fetch_add(1, Ordering::SeqCst);
            let (stream, peer) = tokio::io::duplex(4096);
            upstream_tx.send(peer).unwrap();
            Box::pin(async move { Ok(Box::new(stream) as BoxedStream) })
        });
        let task = tokio::spawn(serve(
            FaultListener {
                listener,
                faults: faults_rx,
                failed: failed_tx,
            },
            stop,
            dialer,
            exact_authority_grant(Authority::parse(DESTINATION).unwrap()),
            credential_hash,
            ProxyLimits::default(),
            observations.clone(),
        ));
        Self {
            proxy: PrivateForwardProxy {
                address,
                password,
                stopped,
                task: Some(task),
                observations,
            },
            faults,
            failed,
            upstream,
            dials,
        }
    }

    fn inject(&self, kind: io::ErrorKind, count: usize) {
        for _ in 0..count {
            self.faults
                .send(io::Error::new(kind, "synthetic secret error text"))
                .unwrap();
        }
    }

    async fn next_error(&mut self) -> Instant {
        timeout(DEADLINE, self.failed.recv())
            .await
            .unwrap()
            .unwrap()
    }

    async fn wait_ended(&self) {
        timeout(DEADLINE, async {
            while !self.proxy.task.as_ref().unwrap().is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    async fn connect(&mut self) -> (TcpStream, DuplexStream) {
        let auth = self
            .proxy
            .with_credentials(|user, password| {
                base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"))
            })
            .unwrap();
        let mut client = TcpStream::connect(self.proxy.local_addr()).await.unwrap();
        client.write_all(format!("CONNECT {DESTINATION} HTTP/1.1\r\nHost: {DESTINATION}\r\nProxy-Authorization: Basic {auth}\r\n\r\n").as_bytes()).await.unwrap();
        assert!(head(&mut client).await.starts_with("HTTP/1.1 200 "));
        let peer = timeout(DEADLINE, self.upstream.recv())
            .await
            .unwrap()
            .unwrap();
        (client, peer)
    }
}

async fn head(stream: &mut TcpStream) -> String {
    timeout(DEADLINE, async {
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            assert!(bytes.len() < 4096);
            bytes.push(stream.read_u8().await.unwrap());
        }
        String::from_utf8(bytes).unwrap()
    })
    .await
    .unwrap()
}

async fn roundtrip(client: &mut TcpStream, upstream: &mut DuplexStream) {
    timeout(DEADLINE, async {
        client.write_all(b"ping").await.unwrap();
        let mut bytes = [0u8; 4];
        upstream.read_exact(&mut bytes).await.unwrap();
        assert_eq!(&bytes, b"ping");
        upstream.write_all(b"pong").await.unwrap();
        client.read_exact(&mut bytes).await.unwrap();
        assert_eq!(&bytes, b"pong");
    })
    .await
    .unwrap();
}

async fn closed(stream: &mut (impl AsyncRead + Unpin)) {
    let result = timeout(DEADLINE, stream.read(&mut [0u8; 1])).await.unwrap();
    assert!(matches!(result, Ok(0)) || result.is_err());
}

#[tokio::test]
async fn each_transient_accept_error_recovers_to_a_real_authenticated_request() {
    let mut fixture = Fixture::new().await;
    let endpoint = fixture.proxy.local_addr();
    for kind in [
        io::ErrorKind::Interrupted,
        io::ErrorKind::WouldBlock,
        io::ErrorKind::ConnectionAborted,
        io::ErrorKind::ConnectionReset,
    ] {
        fixture.inject(kind, 1);
        fixture.next_error().await;
        let (mut client, mut peer) = fixture.connect().await;
        roundtrip(&mut client, &mut peer).await;
        assert_eq!(fixture.proxy.local_addr(), endpoint);
        assert_eq!(
            fixture.proxy.diagnostics().state,
            PrivateProxyState::Listening
        );
    }
    assert_eq!(fixture.dials.load(Ordering::SeqCst), 4);
    assert_eq!(fixture.proxy.diagnostics().authenticated_requests, 4);
    fixture.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn recovered_listener_still_enforces_authentication_and_destination_grants() {
    let mut fixture = Fixture::new().await;
    fixture.inject(io::ErrorKind::ConnectionAborted, 1);
    fixture.next_error().await;
    let mut unauthenticated = TcpStream::connect(fixture.proxy.local_addr())
        .await
        .unwrap();
    unauthenticated
        .write_all(
            format!("CONNECT {DESTINATION} HTTP/1.1\r\nHost: {DESTINATION}\r\n\r\n").as_bytes(),
        )
        .await
        .unwrap();
    assert!(head(&mut unauthenticated)
        .await
        .starts_with("HTTP/1.1 407 "));
    let auth = fixture
        .proxy
        .with_credentials(|user, password| {
            base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"))
        })
        .unwrap();
    let mut denied = TcpStream::connect(fixture.proxy.local_addr())
        .await
        .unwrap();
    denied.write_all(format!("CONNECT forbidden.invalid:443 HTTP/1.1\r\nHost: forbidden.invalid:443\r\nProxy-Authorization: Basic {auth}\r\n\r\n").as_bytes()).await.unwrap();
    assert!(head(&mut denied).await.starts_with("HTTP/1.1 403 "));
    assert_eq!(fixture.dials.load(Ordering::SeqCst), 0);
    let (mut client, mut peer) = fixture.connect().await;
    roundtrip(&mut client, &mut peer).await;
    assert_eq!(fixture.dials.load(Ordering::SeqCst), 1);
    fixture.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn exhausting_accept_retries_is_terminal_and_has_only_fixed_diagnostics() {
    let mut fixture = Fixture::new().await;
    fixture.inject(io::ErrorKind::WouldBlock, 7);
    let mut previous = fixture.next_error().await;
    for minimum_ms in [25, 50, 100, 200, 400] {
        let next = fixture.next_error().await;
        // Tokio timers are millisecond-granularity; tolerate rounding, not a spin.
        assert!(next.duration_since(previous) >= Duration::from_millis(minimum_ms - 2));
        previous = next;
    }
    fixture.wait_ended().await;
    assert!(fixture.failed.try_recv().is_err()); // Seventh fault was never accepted.
    assert!(!fixture.proxy.is_running());
    assert!(fixture.proxy.with_credentials(|_, _| ()).is_none());
    assert_eq!(
        fixture.proxy.diagnostics().state,
        PrivateProxyState::ListenerFailed
    );
    assert_eq!(fixture.dials.load(Ordering::SeqCst), 0);
    assert_eq!(
        fixture.proxy.stop().await.unwrap_err().to_string(),
        "Private proxy listener failed"
    );
    assert_eq!(
        fixture.proxy.diagnostics().state,
        PrivateProxyState::ListenerFailed
    );
    assert!(
        timeout(DEADLINE, TcpStream::connect(fixture.proxy.local_addr()))
            .await
            .unwrap()
            .is_err()
    );
}

#[tokio::test]
async fn successful_accept_resets_the_consecutive_retry_budget() {
    let mut fixture = Fixture::new().await;
    for _ in 0..2 {
        fixture.inject(io::ErrorKind::Interrupted, 5);
        for _ in 0..5 {
            fixture.next_error().await;
        }
        let (mut client, mut peer) = fixture.connect().await;
        roundtrip(&mut client, &mut peer).await;
    }
    assert_eq!(fixture.dials.load(Ordering::SeqCst), 2);
    assert_eq!(
        fixture.proxy.diagnostics().state,
        PrivateProxyState::Listening
    );
    fixture.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn active_tunnel_and_independent_proxy_survive_accept_backoff() {
    let mut fixture = Fixture::new().await;
    let mut independent = Fixture::new().await;
    let (mut client, mut peer) = fixture.connect().await;
    fixture.inject(io::ErrorKind::ConnectionReset, 5);
    for _ in 0..5 {
        fixture.next_error().await;
    }
    // These streams keep relaying while their listener waits before accepting.
    roundtrip(&mut client, &mut peer).await;
    let (mut other_client, mut other_peer) = independent.connect().await;
    roundtrip(&mut other_client, &mut other_peer).await;
    let (mut next_client, mut next_peer) = fixture.connect().await;
    roundtrip(&mut next_client, &mut next_peer).await;
    roundtrip(&mut client, &mut peer).await;
    assert_eq!(
        fixture.proxy.diagnostics().state,
        PrivateProxyState::Listening
    );
    assert_eq!(
        independent.proxy.diagnostics().state,
        PrivateProxyState::Listening
    );
    fixture.proxy.stop().await.unwrap();
    independent.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn fatal_accept_failure_immediately_closes_active_clients_without_retry() {
    let mut fixture = Fixture::new().await;
    let mut independent = Fixture::new().await;
    let (mut client, mut peer) = fixture.connect().await;
    fixture.inject(io::ErrorKind::PermissionDenied, 1);
    fixture.next_error().await;
    fixture.wait_ended().await;
    closed(&mut client).await;
    closed(&mut peer).await;
    assert!(fixture.failed.try_recv().is_err());
    assert!(!fixture.proxy.is_running());
    assert!(fixture.proxy.with_credentials(|_, _| ()).is_none());
    assert_eq!(
        fixture.proxy.diagnostics().state,
        PrivateProxyState::ListenerFailed
    );
    assert_eq!(
        fixture.proxy.stop().await.unwrap_err().to_string(),
        "Private proxy listener failed"
    );
    let (mut other_client, mut other_peer) = independent.connect().await;
    roundtrip(&mut other_client, &mut other_peer).await;
    independent.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn revocation_interrupts_backoff_and_never_consumes_a_pending_retry() {
    let mut fixture = Fixture::new().await;
    let (mut client, mut peer) = fixture.connect().await;
    fixture.inject(io::ErrorKind::ConnectionAborted, 6);
    for _ in 0..5 {
        fixture.next_error().await;
    }
    // The next scheduled accept is 400 ms away. Cancellation must not wait for it.
    fixture.proxy.revoke();
    assert!(fixture.proxy.with_credentials(|_, _| ()).is_none());
    timeout(Duration::from_millis(250), fixture.proxy.stop())
        .await
        .unwrap()
        .unwrap();
    assert!(fixture.failed.try_recv().is_err());
    assert_eq!(
        fixture.proxy.diagnostics().state,
        PrivateProxyState::Stopped
    );
    assert_eq!(fixture.dials.load(Ordering::SeqCst), 1);
    closed(&mut client).await;
    closed(&mut peer).await;
    assert!(
        timeout(DEADLINE, TcpStream::connect(fixture.proxy.local_addr()))
            .await
            .unwrap()
            .is_err()
    );
}
