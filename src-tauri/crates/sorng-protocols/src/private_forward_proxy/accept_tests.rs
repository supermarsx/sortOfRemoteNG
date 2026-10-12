use super::*;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, Once};
use tokio::io::DuplexStream;
use tokio::sync::{mpsc, Notify, Semaphore};
use tokio::time::{timeout, Instant};

const DEADLINE: Duration = Duration::from_secs(5);
const DESTINATION: &str = "relay-fixture.invalid:443";
// Carried by every scripted fault. It must never reach a log or a caller.
const FAULT_TEXT: &str = "synthetic secret error text";

/// This module's log lines, per thread. `#[tokio::test]` drives the relay on
/// the test's own thread, so a test reads back only what its own relays logged.
mod captured {
    use super::*;

    thread_local! {
        static RECORDS: RefCell<Vec<(log::Level, String)>> = const { RefCell::new(Vec::new()) };
    }

    struct Capture;

    impl log::Log for Capture {
        fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
            metadata
                .target()
                .starts_with("sorng_protocols::private_forward_proxy")
        }

        fn log(&self, record: &log::Record<'_>) {
            if self.enabled(record.metadata()) {
                RECORDS.with(|records| {
                    records
                        .borrow_mut()
                        .push((record.level(), record.args().to_string()))
                });
            }
        }

        fn flush(&self) {}
    }

    pub fn start() {
        static INSTALL: Once = Once::new();
        INSTALL.call_once(|| {
            log::set_logger(&Capture).expect("another logger already owns this test binary");
            log::set_max_level(log::LevelFilter::Info);
        });
        RECORDS.with(|records| records.borrow_mut().clear());
    }

    pub fn records() -> Vec<(log::Level, String)> {
        RECORDS.with(|records| records.borrow().clone())
    }

    pub fn count(level: log::Level, needle: &str) -> usize {
        records()
            .iter()
            .filter(|(logged, text)| *logged == level && text.contains(needle))
            .count()
    }
}

/// Faults shared by a probe, its source and every listener that source binds,
/// so a script outlives the listener it was written for.
#[derive(Default)]
struct Script {
    accept_faults: Mutex<VecDeque<io::Error>>,
    bind_faults: Mutex<VecDeque<io::Error>>,
    wake: Notify,
}

struct FaultListener {
    listener: TcpListener,
    script: Arc<Script>,
    failed: mpsc::UnboundedSender<Instant>,
}

impl AcceptListener for FaultListener {
    fn accept(&mut self) -> impl Future<Output = io::Result<(TcpStream, SocketAddr)>> + Send + '_ {
        async move {
            loop {
                // Only accept is substituted; admission, authentication, grants,
                // dial and relaying stay real. Both waits are cancellation-safe.
                let fault = self.script.accept_faults.lock().unwrap().pop_front();
                if let Some(error) = fault {
                    let _ = self.failed.send(Instant::now());
                    return Err(error);
                }
                tokio::select! {
                    biased;
                    _ = self.script.wake.notified() => {},
                    result = self.listener.accept() => return result,
                }
            }
        }
    }
}

type BindAttempt = (u16, Result<SocketAddr, io::ErrorKind>);

/// Scripted bind failures and a scripted clock around the production loopback
/// bind. Every requested wait is reported and none of them takes real time: it
/// either elapses at once or, when held, only once the test releases it.
struct FaultSource {
    script: Arc<Script>,
    held: Option<Arc<Semaphore>>,
    failed: mpsc::UnboundedSender<Instant>,
    binds: mpsc::UnboundedSender<BindAttempt>,
    pauses: mpsc::UnboundedSender<Duration>,
}

impl ListenerSource for FaultSource {
    type Listener = FaultListener;

    async fn bind(&mut self, port: u16) -> io::Result<(FaultListener, SocketAddr)> {
        let fault = self.script.bind_faults.lock().unwrap().pop_front();
        let bound = match fault {
            Some(error) => Err(error),
            None => LoopbackSource.bind(port).await,
        };
        let attempt = bound
            .as_ref()
            .map(|(_, address)| *address)
            .map_err(io::Error::kind);
        let _ = self.binds.send((port, attempt));
        let (listener, address) = bound?;
        let listener = FaultListener {
            listener,
            script: self.script.clone(),
            failed: self.failed.clone(),
        };
        Ok((listener, address))
    }

    async fn pause(&mut self, delay: Duration) {
        let _ = self.pauses.send(delay);
        if let Some(gate) = &self.held {
            gate.acquire().await.unwrap().forget();
        }
    }
}

/// The test's side of a `FaultSource`: scripts faults and observes attempts.
struct Probe {
    script: Arc<Script>,
    gate: Arc<Semaphore>,
    failed: mpsc::UnboundedReceiver<Instant>,
    binds: mpsc::UnboundedReceiver<BindAttempt>,
    pauses: mpsc::UnboundedReceiver<Duration>,
}

fn rig(hold_clock: bool) -> (FaultSource, Probe) {
    let script = Arc::new(Script::default());
    let gate = Arc::new(Semaphore::new(0));
    let (failed_tx, failed) = mpsc::unbounded_channel();
    let (binds_tx, binds) = mpsc::unbounded_channel();
    let (pauses_tx, pauses) = mpsc::unbounded_channel();
    let source = FaultSource {
        script: script.clone(),
        held: hold_clock.then(|| gate.clone()),
        failed: failed_tx,
        binds: binds_tx,
        pauses: pauses_tx,
    };
    let probe = Probe {
        script,
        gate,
        failed,
        binds,
        pauses,
    };
    (source, probe)
}

impl Probe {
    fn inject(&self, kind: io::ErrorKind, count: usize) {
        let mut faults = self.script.accept_faults.lock().unwrap();
        faults.extend((0..count).map(|_| io::Error::new(kind, FAULT_TEXT)));
        drop(faults);
        self.script.wake.notify_one();
    }

    fn fail_binds(&self, kinds: impl IntoIterator<Item = io::ErrorKind>) {
        let faults = kinds
            .into_iter()
            .map(|kind| io::Error::new(kind, FAULT_TEXT));
        self.script.bind_faults.lock().unwrap().extend(faults);
    }

    /// Lets exactly one held wait elapse.
    fn release_clock(&self) {
        self.gate.add_permits(1);
    }

    async fn next_error(&mut self) -> Instant {
        timeout(DEADLINE, self.failed.recv())
            .await
            .unwrap()
            .unwrap()
    }

    async fn next_bind(&mut self) -> BindAttempt {
        timeout(DEADLINE, self.binds.recv()).await.unwrap().unwrap()
    }

    async fn next_pause(&mut self) -> Duration {
        timeout(DEADLINE, self.pauses.recv())
            .await
            .unwrap()
            .unwrap()
    }

    /// No bind attempt and no wait beyond those the test has already read.
    fn settled(&mut self) -> bool {
        self.binds.try_recv().is_err() && self.pauses.try_recv().is_err()
    }
}

struct Relay {
    proxy: PrivateForwardProxy,
    upstream: mpsc::UnboundedReceiver<DuplexStream>,
    dials: Arc<AtomicUsize>,
}

/// The production start path, with only the listener source substituted.
async fn start(source: FaultSource) -> io::Result<Relay> {
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
    let proxy = PrivateForwardProxy::start_with(
        source,
        dialer,
        exact_authority_grant(Authority::parse(DESTINATION).unwrap()),
        ProxyLimits::default(),
    )
    .await?;
    Ok(Relay {
        proxy,
        upstream,
        dials,
    })
}

struct Fixture {
    proxy: PrivateForwardProxy,
    probe: Probe,
    upstream: mpsc::UnboundedReceiver<DuplexStream>,
    dials: Arc<AtomicUsize>,
}

impl Fixture {
    async fn new() -> Self {
        Self::with_clock(false).await
    }

    async fn with_held_clock() -> Self {
        Self::with_clock(true).await
    }

    async fn with_clock(hold_clock: bool) -> Self {
        let (source, probe) = rig(hold_clock);
        let Ok(relay) = start(source).await else {
            panic!("an unscripted loopback bind failed");
        };
        Self::assemble(relay, probe)
    }

    fn assemble(relay: Relay, probe: Probe) -> Self {
        Self {
            proxy: relay.proxy,
            probe,
            upstream: relay.upstream,
            dials: relay.dials,
        }
    }

    fn inject(&self, kind: io::ErrorKind, count: usize) {
        self.probe.inject(kind, count);
    }

    async fn next_error(&mut self) -> Instant {
        self.probe.next_error().await
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

    fn secret(&self) -> String {
        self.proxy
            .with_credentials(|_, password| password.to_owned())
            .unwrap()
    }

    fn credentials(&self) -> String {
        self.proxy
            .with_credentials(|user, password| {
                base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"))
            })
            .unwrap()
    }

    async fn reply(&self, credentials: Option<&str>, destination: &str) -> String {
        let authorization = credentials
            .map(|value| format!("Proxy-Authorization: Basic {value}\r\n"))
            .unwrap_or_default();
        let mut client = TcpStream::connect(self.proxy.local_addr()).await.unwrap();
        client
            .write_all(
                format!(
                    "CONNECT {destination} HTTP/1.1\r\nHost: {destination}\r\n{authorization}\r\n"
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        head(&mut client).await
    }

    async fn connect(&mut self) -> (TcpStream, DuplexStream) {
        let auth = self.credentials();
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

/// Nothing a relay logged may carry native error text, a credential or a port.
fn assert_logs_only_kinds(forbidden: &[String]) {
    for (_, text) in captured::records() {
        assert!(!text.contains(FAULT_TEXT), "{text}");
        for value in forbidden {
            assert!(!text.contains(value.as_str()), "{text}");
        }
    }
}

#[tokio::test]
async fn each_transient_accept_error_recovers_to_a_real_authenticated_request() {
    let mut fixture = Fixture::new().await;
    let endpoint = fixture.proxy.local_addr();
    assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
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
    // A transient error is retried on the listener it happened on.
    assert!(fixture.probe.settled());
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
    // The sixth consecutive transient error goes to a rebind; here none succeeds.
    fixture.probe.fail_binds([io::ErrorKind::AddrInUse; 3]);
    fixture.inject(io::ErrorKind::WouldBlock, 7);
    let mut previous = fixture.next_error().await;
    for minimum_ms in [25, 50, 100, 200, 400] {
        let next = fixture.next_error().await;
        // Tokio timers are millisecond-granularity; tolerate rounding, not a spin.
        assert!(next.duration_since(previous) >= Duration::from_millis(minimum_ms - 2));
        previous = next;
    }
    fixture.wait_ended().await;
    assert!(fixture.probe.failed.try_recv().is_err()); // Seventh fault was never accepted.
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
    assert!(fixture.probe.failed.try_recv().is_err());
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

#[tokio::test]
async fn initial_bind_failing_twice_then_succeeding_starts_a_working_relay() {
    captured::start();
    let (source, probe) = rig(false);
    probe.fail_binds([io::ErrorKind::AddrInUse; 2]);
    let Ok(relay) = start(source).await else {
        panic!("the third bind attempt must start the relay");
    };
    let mut fixture = Fixture::assemble(relay, probe);
    let endpoint = fixture.proxy.local_addr();
    assert_eq!(endpoint.ip(), Ipv4Addr::LOCALHOST);
    let failed = (0, Err(io::ErrorKind::AddrInUse));
    assert_eq!(fixture.probe.next_bind().await, failed);
    assert_eq!(fixture.probe.next_pause().await, Duration::from_millis(50));
    assert_eq!(fixture.probe.next_bind().await, failed);
    assert_eq!(fixture.probe.next_pause().await, Duration::from_millis(200));
    assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
    assert!(fixture.probe.settled());
    let (mut client, mut peer) = fixture.connect().await;
    roundtrip(&mut client, &mut peer).await;
    assert_eq!(captured::count(log::Level::Warn, "AddrInUse"), 2);
    assert_eq!(captured::count(log::Level::Error, ""), 0);
    assert_logs_only_kinds(&[fixture.secret(), endpoint.port().to_string()]);
    fixture.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn initial_bind_exhaustion_returns_and_logs_only_the_last_kind() {
    captured::start();
    let (source, mut probe) = rig(false);
    probe.fail_binds([
        io::ErrorKind::AddrInUse,
        io::ErrorKind::AddrInUse,
        io::ErrorKind::PermissionDenied,
    ]);
    let Err(error) = start(source).await else {
        panic!("three failed binds must not start a relay");
    };
    assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    assert_eq!(error.to_string(), "Private proxy listener bind failed");
    assert_eq!(probe.next_bind().await, (0, Err(io::ErrorKind::AddrInUse)));
    assert_eq!(probe.next_pause().await, Duration::from_millis(50));
    assert_eq!(probe.next_bind().await, (0, Err(io::ErrorKind::AddrInUse)));
    assert_eq!(probe.next_pause().await, Duration::from_millis(200));
    assert_eq!(
        probe.next_bind().await,
        (0, Err(io::ErrorKind::PermissionDenied))
    );
    assert!(probe.settled());
    assert_eq!(captured::count(log::Level::Warn, "AddrInUse"), 2);
    assert_eq!(captured::count(log::Level::Error, "PermissionDenied"), 1);
    assert_logs_only_kinds(&[]);
}

#[tokio::test]
async fn dropping_a_start_cancels_its_bind_backoff() {
    let (source, mut probe) = rig(true);
    probe.fail_binds([io::ErrorKind::AddrInUse]);
    let mut starting = Box::pin(start(source));
    assert!(futures_util::poll!(starting.as_mut()).is_pending());
    assert_eq!(probe.next_bind().await, (0, Err(io::ErrorKind::AddrInUse)));
    assert_eq!(probe.next_pause().await, Duration::from_millis(50));
    drop(starting);
    // The wait was cancelled with its caller; releasing the clock binds nothing.
    probe.release_clock();
    tokio::task::yield_now().await;
    assert!(probe.settled());
}

#[tokio::test]
async fn terminal_accept_failure_rebinds_the_same_port_and_keeps_serving() {
    captured::start();
    let mut fixture = Fixture::new().await;
    let endpoint = fixture.proxy.local_addr();
    assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
    let credentials = fixture.credentials();
    let (mut client, mut peer) = fixture.connect().await;
    // A kind that is never transient, then the sixth consecutive transient one.
    for (kind, count) in [
        (io::ErrorKind::PermissionDenied, 1),
        (io::ErrorKind::WouldBlock, 6),
    ] {
        fixture.inject(kind, count);
        for _ in 0..count {
            fixture.next_error().await;
        }
        // Each accepted connection since the last failure refilled the budget.
        assert_eq!(fixture.probe.next_pause().await, Duration::from_millis(100));
        assert_eq!(
            fixture.probe.next_bind().await,
            (endpoint.port(), Ok(endpoint))
        );
        assert_eq!(fixture.proxy.local_addr(), endpoint);
        assert_eq!(fixture.credentials(), credentials);
        assert!(fixture.proxy.is_running());
        // The tunnel opened before the failure was never interrupted.
        roundtrip(&mut client, &mut peer).await;
        // The rebound listener enforces the same credentials and grants.
        assert!(fixture
            .reply(None, DESTINATION)
            .await
            .starts_with("HTTP/1.1 407 "));
        assert!(fixture
            .reply(Some(&credentials), "forbidden.invalid:443")
            .await
            .starts_with("HTTP/1.1 403 "));
        let (mut next_client, mut next_peer) = fixture.connect().await;
        roundtrip(&mut next_client, &mut next_peer).await;
        assert_eq!(
            fixture.proxy.diagnostics().state,
            PrivateProxyState::Listening
        );
    }
    assert_eq!(fixture.dials.load(Ordering::SeqCst), 3);
    assert!(fixture.probe.settled());
    assert_eq!(captured::count(log::Level::Warn, "PermissionDenied"), 1);
    assert_eq!(captured::count(log::Level::Error, ""), 0);
    assert_logs_only_kinds(&[fixture.secret(), credentials, endpoint.port().to_string()]);
    fixture.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn rebind_budget_is_not_refilled_by_a_listener_that_never_accepts() {
    let mut fixture = Fixture::new().await;
    let endpoint = fixture.proxy.local_addr();
    assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
    // Every rebind succeeds, but each fresh listener fails before it accepts.
    for delay in [100, 300, 900].map(Duration::from_millis) {
        fixture.inject(io::ErrorKind::PermissionDenied, 1);
        fixture.next_error().await;
        assert_eq!(fixture.probe.next_pause().await, delay);
        assert_eq!(
            fixture.probe.next_bind().await,
            (endpoint.port(), Ok(endpoint))
        );
        assert!(fixture.proxy.is_running());
    }
    fixture.inject(io::ErrorKind::PermissionDenied, 1);
    fixture.next_error().await;
    fixture.wait_ended().await;
    assert!(fixture.probe.settled());
    assert_eq!(
        fixture.proxy.diagnostics().state,
        PrivateProxyState::ListenerFailed
    );
    assert_eq!(
        fixture.proxy.stop().await.unwrap_err().to_string(),
        "Private proxy listener failed"
    );
}

#[tokio::test]
async fn rebind_exhaustion_ends_the_relay_as_before_and_logs_only_the_kind() {
    captured::start();
    let mut fixture = Fixture::new().await;
    let mut independent = Fixture::new().await;
    let endpoint = fixture.proxy.local_addr();
    assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
    let forbidden = [
        fixture.secret(),
        fixture.credentials(),
        endpoint.port().to_string(),
    ];
    let (mut client, mut peer) = fixture.connect().await;
    let rebinds = [
        (100, io::ErrorKind::AddrInUse),
        (300, io::ErrorKind::AddrInUse),
        (900, io::ErrorKind::AddrNotAvailable),
    ];
    fixture.probe.fail_binds(rebinds.map(|(_, kind)| kind));
    fixture.inject(io::ErrorKind::PermissionDenied, 1);
    fixture.next_error().await;
    for (delay, kind) in rebinds {
        assert_eq!(
            fixture.probe.next_pause().await,
            Duration::from_millis(delay)
        );
        assert_eq!(
            fixture.probe.next_bind().await,
            (endpoint.port(), Err(kind))
        );
    }
    fixture.wait_ended().await;
    assert!(fixture.probe.settled());
    closed(&mut client).await;
    closed(&mut peer).await;
    assert!(fixture.probe.failed.try_recv().is_err());
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
    assert!(timeout(DEADLINE, TcpStream::connect(endpoint))
        .await
        .unwrap()
        .is_err());
    // The accept failure, each failed rebind and the end of the relay.
    assert_eq!(captured::count(log::Level::Warn, "PermissionDenied"), 1);
    assert_eq!(captured::count(log::Level::Warn, "AddrInUse"), 2);
    assert_eq!(captured::count(log::Level::Warn, "AddrNotAvailable"), 1);
    assert_eq!(captured::count(log::Level::Error, "AddrNotAvailable"), 1);
    assert_logs_only_kinds(&forbidden);
    let (mut other_client, mut other_peer) = independent.connect().await;
    roundtrip(&mut other_client, &mut other_peer).await;
    independent.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn revocation_interrupts_every_rebind_backoff() {
    let delays = [100, 300, 900].map(Duration::from_millis);
    for held in 0..delays.len() {
        let mut fixture = Fixture::with_held_clock().await;
        let endpoint = fixture.proxy.local_addr();
        assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
        let (mut client, mut peer) = fixture.connect().await;
        fixture
            .probe
            .fail_binds(vec![io::ErrorKind::AddrInUse; held]);
        fixture.inject(io::ErrorKind::PermissionDenied, 1);
        fixture.next_error().await;
        for delay in &delays[..held] {
            assert_eq!(fixture.probe.next_pause().await, *delay);
            fixture.probe.release_clock();
            assert_eq!(
                fixture.probe.next_bind().await,
                (endpoint.port(), Err(io::ErrorKind::AddrInUse))
            );
        }
        assert_eq!(fixture.probe.next_pause().await, delays[held]);
        // The scripted clock never lets this wait elapse, so only revocation
        // can end it. Established tunnels keep relaying in the meantime.
        roundtrip(&mut client, &mut peer).await;
        fixture.proxy.revoke();
        assert!(fixture.proxy.with_credentials(|_, _| ()).is_none());
        timeout(DEADLINE, fixture.proxy.stop())
            .await
            .unwrap()
            .unwrap();
        // The failed listener was released before the wait began, and no bind
        // followed the revocation: nothing listens on the endpoint any more.
        assert!(fixture.probe.settled());
        assert_eq!(
            fixture.proxy.diagnostics().state,
            PrivateProxyState::Stopped
        );
        closed(&mut client).await;
        closed(&mut peer).await;
    }
}
