use super::*;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, Once, Weak};
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
    // Real connections that the test accepted itself; see `Probe::hand_over`.
    handed_over: Mutex<VecDeque<TcpStream>>,
    wake: Notify,
}

/// A listener that its relay released, still bound, until the source that
/// bound it binds that port again.
type Parked = Mutex<Option<TcpListener>>;

struct FaultListener {
    // `None` only once dropped.
    listener: Option<TcpListener>,
    parked: Weak<Parked>,
    script: Arc<Script>,
    failed: mpsc::UnboundedSender<Instant>,
}

impl AcceptListener for FaultListener {
    async fn accept(&mut self) -> io::Result<(TcpStream, SocketAddr)> {
        loop {
            // Only accept is substituted; admission, authentication, grants,
            // dial and relaying stay real. Both waits are cancellation-safe.
            let fault = self.script.accept_faults.lock().unwrap().pop_front();
            if let Some(error) = fault {
                let _ = self.failed.send(Instant::now());
                return Err(error);
            }
            // Never a wait: consecutive accepts return every handed-over
            // connection within one turn of the relay's accept loop.
            let handed_over = self.script.handed_over.lock().unwrap().pop_front();
            if let Some(client) = handed_over {
                let peer = client.peer_addr()?;
                return Ok((client, peer));
            }
            tokio::select! {
                biased;
                _ = self.script.wake.notified() => {},
                result = self.listener.as_ref().unwrap().accept() => return result,
            }
        }
    }
}

impl Drop for FaultListener {
    fn drop(&mut self) {
        // Released, not closed, for as long as its source keeps the reservation.
        // Otherwise the socket closes right here, as it does in production.
        if let (Some(listener), Some(parked)) = (self.listener.take(), self.parked.upgrade()) {
            *parked.lock().unwrap() = Some(listener);
        }
    }
}

type BindAttempt = (u16, Result<SocketAddr, io::ErrorKind>);

/// Scripted bind failures, a scripted clock and a port reservation around the
/// production loopback bind. Every requested wait is reported and none of them
/// takes real time: it either elapses at once or, when held, only once the test
/// releases it.
///
/// A loopback port that was really closed is the operating system's to give
/// away, and nothing promises that the relay can bind it again an instant
/// later. So a listener the relay releases stays bound, parked with its
/// source, and binding that port again takes it back: these tests cannot lose
/// their port. A port whose listener was never released is not parked; binding
/// it is the production bind and fails as the operating system says. The
/// reservation ends with the source, so a relay that has ended listens on
/// nothing.
struct FaultSource {
    script: Arc<Script>,
    held: Option<Arc<Semaphore>>,
    // `None`: a released listener closes and every bind is the production bind.
    parked: Option<Arc<Parked>>,
    failed: mpsc::UnboundedSender<Instant>,
    binds: mpsc::UnboundedSender<BindAttempt>,
    pauses: mpsc::UnboundedSender<Duration>,
}

impl FaultSource {
    /// Gives up the reservation: a released port is closed and rebound for
    /// real, and the operating system may refuse that rebind.
    fn closing_released_ports(mut self) -> Self {
        self.parked = None;
        self
    }

    fn take_parked(&self, port: u16) -> Option<(TcpListener, SocketAddr)> {
        let mut parked = self.parked.as_ref()?.lock().unwrap();
        let address = parked.as_ref()?.local_addr().ok()?;
        (address.port() == port).then(|| (parked.take().unwrap(), address))
    }
}

impl ListenerSource for FaultSource {
    type Listener = FaultListener;

    async fn bind(&mut self, port: u16) -> io::Result<(FaultListener, SocketAddr)> {
        let fault = self.script.bind_faults.lock().unwrap().pop_front();
        let bound = match fault {
            Some(error) => Err(error),
            None => match self.take_parked(port) {
                Some(parked) => Ok(parked),
                None => LoopbackSource.bind(port).await,
            },
        };
        let attempt = bound
            .as_ref()
            .map(|(_, address)| *address)
            .map_err(io::Error::kind);
        let _ = self.binds.send((port, attempt));
        let (listener, address) = bound?;
        let listener = FaultListener {
            listener: Some(listener),
            parked: self.parked.as_ref().map(Arc::downgrade).unwrap_or_default(),
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
    parked: Weak<Parked>,
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
    let parked = Arc::<Parked>::default();
    let probe = Probe {
        script: script.clone(),
        gate: gate.clone(),
        parked: Arc::downgrade(&parked),
        failed,
        binds,
        pauses,
    };
    let source = FaultSource {
        script,
        held: hold_clock.then_some(gate),
        parked: Some(parked),
        failed: failed_tx,
        binds: binds_tx,
        pauses: pauses_tx,
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

    /// Gives the relay connections as though its listener had accepted them,
    /// and all of them before its accept loop can wait even once.
    fn hand_over(&self, clients: impl IntoIterator<Item = TcpStream>) {
        self.script.handed_over.lock().unwrap().extend(clients);
        self.script.wake.notify_one();
    }

    /// Whether the relay has released a listener that its source has not yet
    /// bound again.
    fn holds_released_listener(&self) -> bool {
        self.parked
            .upgrade()
            .is_some_and(|parked| parked.lock().unwrap().is_some())
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
async fn start(source: FaultSource, limits: ProxyLimits) -> io::Result<Relay> {
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
        limits,
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
        Self::started(rig(false), ProxyLimits::default()).await
    }

    async fn with_held_clock() -> Self {
        Self::started(rig(true), ProxyLimits::default()).await
    }

    async fn started((source, probe): (FaultSource, Probe), limits: ProxyLimits) -> Self {
        let Ok(relay) = start(source, limits).await else {
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

/// Real loopback connections accepted by the test and not by a relay: the
/// peers' ends and the accepted ends, in the same order.
async fn accepted(count: usize) -> (Vec<TcpStream>, Vec<TcpStream>) {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let mut peers = Vec::new();
    let mut clients = Vec::new();
    timeout(DEADLINE, async {
        for _ in 0..count {
            peers.push(TcpStream::connect(address).await.unwrap());
            clients.push(listener.accept().await.unwrap().0);
        }
    })
    .await
    .unwrap();
    (peers, clients)
}

/// Everything a peer was sent before its connection ended.
async fn sent(peer: &mut TcpStream) -> Vec<u8> {
    let mut bytes = Vec::new();
    let _ = timeout(DEADLINE, peer.read_to_end(&mut bytes))
        .await
        .unwrap();
    bytes
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
    // The sixth consecutive transient error replaces the listener; here the
    // port cannot be bound again.
    fixture.probe.fail_binds([io::ErrorKind::AddrInUse]);
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
    let Ok(relay) = start(source, ProxyLimits::default()).await else {
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
    let Err(error) = start(source, ProxyLimits::default()).await else {
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
    let mut starting = Box::pin(start(source, ProxyLimits::default()));
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
        // Each accepted connection since the last failure refilled the budget,
        // so the listener is replaced at once.
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
    // Neither replacement waited for anything.
    assert!(fixture.probe.settled());
    assert_eq!(captured::count(log::Level::Warn, "PermissionDenied"), 1);
    assert_eq!(captured::count(log::Level::Error, ""), 0);
    assert_logs_only_kinds(&[fixture.secret(), credentials, endpoint.port().to_string()]);
    fixture.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn the_first_replacement_does_not_wait_for_the_clock() {
    // This clock is held and never released: a wait before the first
    // replacement would never end.
    let mut fixture = Fixture::with_held_clock().await;
    let endpoint = fixture.proxy.local_addr();
    assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
    fixture.inject(io::ErrorKind::PermissionDenied, 1);
    fixture.next_error().await;
    assert_eq!(
        fixture.probe.next_bind().await,
        (endpoint.port(), Ok(endpoint))
    );
    assert!(fixture.probe.settled());
    let (mut client, mut peer) = fixture.connect().await;
    roundtrip(&mut client, &mut peer).await;
    fixture.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn a_listener_released_to_its_source_stays_bound_until_that_port_is_bound_again() {
    // What keeps the replacement tests independent of every other socket and
    // of how readily the operating system gives a closed port back.
    let (mut source, probe) = rig(false);
    let (listener, address) = source.bind(0).await.unwrap();
    assert!(!probe.holds_released_listener());
    drop(listener);
    assert!(probe.holds_released_listener());
    assert!(TcpListener::bind(address).await.is_err());
    let (_listener, again) = source.bind(address.port()).await.unwrap();
    assert_eq!(again, address);
    assert!(!probe.holds_released_listener());
}

#[tokio::test]
async fn a_failed_listener_keeps_its_port_while_the_relay_waits_to_replace_it() {
    let mut fixture = Fixture::with_held_clock().await;
    let endpoint = fixture.proxy.local_addr();
    assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
    // The first replacement is immediate, and its listener fails before it
    // accepts anything, so the next replacement has to wait.
    fixture.inject(io::ErrorKind::PermissionDenied, 1);
    fixture.next_error().await;
    assert_eq!(
        fixture.probe.next_bind().await,
        (endpoint.port(), Ok(endpoint))
    );
    fixture.inject(io::ErrorKind::PermissionDenied, 1);
    fixture.next_error().await;
    assert_eq!(fixture.probe.next_pause().await, Duration::from_millis(300));
    // The relay is waiting and still reports itself as running. It has not
    // released the listener that failed: the port is its own for the whole
    // wait and nobody else can bind it.
    assert!(fixture.proxy.is_running());
    assert!(!fixture.probe.holds_released_listener());
    assert!(TcpListener::bind(endpoint).await.is_err());
    fixture.probe.release_clock();
    assert_eq!(
        fixture.probe.next_bind().await,
        (endpoint.port(), Ok(endpoint))
    );
    let (mut client, mut peer) = fixture.connect().await;
    roundtrip(&mut client, &mut peer).await;
    fixture.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn a_really_closed_port_is_rebound_by_the_production_bind_under_a_live_tunnel() {
    // Every other test keeps its released port reserved. Here the operating
    // system decides: the listener is really closed while a tunnel it accepted
    // stays open, and the production bind must then get the same port back.
    // When ephemeral ports are scarce the OS refuses that with AddrInUse. The
    // relay then ends, as it must, and the scenario starts over on a fresh one.
    for _ in 0..5 {
        let (source, probe) = rig(false);
        let source = source.closing_released_ports();
        let mut fixture = Fixture::started((source, probe), ProxyLimits::default()).await;
        let endpoint = fixture.proxy.local_addr();
        assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
        let (mut client, mut peer) = fixture.connect().await;
        fixture.inject(io::ErrorKind::PermissionDenied, 1);
        fixture.next_error().await;
        match fixture.probe.next_bind().await {
            (port, Ok(address)) => {
                assert_eq!((port, address), (endpoint.port(), endpoint));
                assert!(fixture.proxy.is_running());
                roundtrip(&mut client, &mut peer).await;
                // A real peer reaches the rebound listener at the same endpoint.
                let (mut next_client, mut next_peer) = fixture.connect().await;
                roundtrip(&mut next_client, &mut next_peer).await;
                assert_eq!(fixture.dials.load(Ordering::SeqCst), 2);
                assert!(fixture.probe.settled());
                fixture.proxy.stop().await.unwrap();
                return;
            }
            (port, Err(kind)) => {
                assert_eq!((port, kind), (endpoint.port(), io::ErrorKind::AddrInUse));
                fixture.wait_ended().await;
                assert_eq!(
                    fixture.proxy.diagnostics().state,
                    PrivateProxyState::ListenerFailed
                );
            }
        }
    }
    panic!("the operating system refused the rebind of every really closed port");
}

#[tokio::test]
async fn rebind_budget_is_not_refilled_by_a_listener_that_never_accepts() {
    let mut fixture = Fixture::new().await;
    let endpoint = fixture.proxy.local_addr();
    assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
    // Every replacement succeeds, but each fresh listener fails before it
    // accepts. The first replacement is immediate, the next two wait.
    for delay in [0, 300, 900].map(Duration::from_millis) {
        fixture.inject(io::ErrorKind::PermissionDenied, 1);
        fixture.next_error().await;
        if !delay.is_zero() {
            assert_eq!(fixture.probe.next_pause().await, delay);
        }
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
async fn a_port_held_by_another_socket_ends_the_relay_at_once_and_logs_only_the_kind() {
    captured::start();
    // The clock is held and never released: any wait for another attempt
    // would keep this relay from ever ending.
    let mut fixture = Fixture::with_held_clock().await;
    let mut independent = Fixture::new().await;
    let endpoint = fixture.proxy.local_addr();
    assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
    let forbidden = [
        fixture.secret(),
        fixture.credentials(),
        endpoint.port().to_string(),
    ];
    let (mut client, mut peer) = fixture.connect().await;
    fixture.probe.fail_binds([io::ErrorKind::AddrInUse]);
    fixture.inject(io::ErrorKind::PermissionDenied, 1);
    fixture.next_error().await;
    assert_eq!(
        fixture.probe.next_bind().await,
        (endpoint.port(), Err(io::ErrorKind::AddrInUse))
    );
    fixture.wait_ended().await;
    // One attempt, no wait before it and nothing after it.
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
    // The accept failure and the end of the relay, each with its kind only.
    assert_eq!(captured::count(log::Level::Warn, "PermissionDenied"), 1);
    assert_eq!(captured::count(log::Level::Warn, "AddrInUse"), 0);
    assert_eq!(captured::count(log::Level::Error, "AddrInUse"), 1);
    assert_eq!(captured::count(log::Level::Error, ""), 1);
    assert_logs_only_kinds(&forbidden);
    let (mut other_client, mut other_peer) = independent.connect().await;
    roundtrip(&mut other_client, &mut other_peer).await;
    independent.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn a_port_lost_on_a_later_replacement_ends_the_relay_without_another_attempt() {
    let mut fixture = Fixture::with_held_clock().await;
    let endpoint = fixture.proxy.local_addr();
    assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
    fixture.inject(io::ErrorKind::PermissionDenied, 1);
    fixture.next_error().await;
    assert_eq!(
        fixture.probe.next_bind().await,
        (endpoint.port(), Ok(endpoint))
    );
    fixture.probe.fail_binds([io::ErrorKind::AddrInUse]);
    fixture.inject(io::ErrorKind::PermissionDenied, 1);
    fixture.next_error().await;
    assert_eq!(fixture.probe.next_pause().await, Duration::from_millis(300));
    fixture.probe.release_clock();
    assert_eq!(
        fixture.probe.next_bind().await,
        (endpoint.port(), Err(io::ErrorKind::AddrInUse))
    );
    fixture.wait_ended().await;
    // No 900 ms wait and no third attempt.
    assert!(fixture.probe.settled());
    assert!(!fixture.proxy.is_running());
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
async fn a_replacement_that_cannot_bind_for_any_reason_ends_the_relay() {
    // Once the failed listener is gone and its replacement could not be bound,
    // the relay holds no socket. Whatever the reason, it ends instead of
    // waiting with its port in nobody's hands.
    for kind in [
        io::ErrorKind::PermissionDenied,
        io::ErrorKind::AddrNotAvailable,
        io::ErrorKind::OutOfMemory,
        io::ErrorKind::Other,
    ] {
        captured::start();
        let mut fixture = Fixture::with_held_clock().await;
        let endpoint = fixture.proxy.local_addr();
        assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
        fixture.probe.fail_binds([kind]);
        fixture.inject(io::ErrorKind::BrokenPipe, 1);
        fixture.next_error().await;
        assert_eq!(
            fixture.probe.next_bind().await,
            (endpoint.port(), Err(kind))
        );
        fixture.wait_ended().await;
        assert!(fixture.probe.settled());
        assert!(!fixture.proxy.is_running());
        assert_eq!(
            fixture.proxy.diagnostics().state,
            PrivateProxyState::ListenerFailed
        );
        assert_eq!(captured::count(log::Level::Warn, "BrokenPipe"), 1);
        assert_eq!(captured::count(log::Level::Error, &format!("{kind:?}")), 1);
        assert_eq!(captured::count(log::Level::Error, ""), 1);
        assert_logs_only_kinds(&[endpoint.port().to_string()]);
        assert_eq!(
            fixture.proxy.stop().await.unwrap_err().to_string(),
            "Private proxy listener failed"
        );
    }
}

#[tokio::test]
async fn revocation_interrupts_every_wait_before_a_replacement() {
    let delays = [300, 900].map(Duration::from_millis);
    for held in 0..delays.len() {
        let mut fixture = Fixture::with_held_clock().await;
        let endpoint = fixture.proxy.local_addr();
        assert_eq!(fixture.probe.next_bind().await, (0, Ok(endpoint)));
        let (mut client, mut peer) = fixture.connect().await;
        // The first replacement is immediate. Every later one waits first,
        // because no listener in between accepts anything.
        fixture.inject(io::ErrorKind::PermissionDenied, 1);
        fixture.next_error().await;
        assert_eq!(
            fixture.probe.next_bind().await,
            (endpoint.port(), Ok(endpoint))
        );
        for delay in &delays[..held] {
            fixture.inject(io::ErrorKind::PermissionDenied, 1);
            fixture.next_error().await;
            assert_eq!(fixture.probe.next_pause().await, *delay);
            fixture.probe.release_clock();
            assert_eq!(
                fixture.probe.next_bind().await,
                (endpoint.port(), Ok(endpoint))
            );
        }
        fixture.inject(io::ErrorKind::PermissionDenied, 1);
        fixture.next_error().await;
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
        // No bind followed the revocation.
        assert!(fixture.probe.settled());
        assert_eq!(
            fixture.proxy.diagnostics().state,
            PrivateProxyState::Stopped
        );
        closed(&mut client).await;
        closed(&mut peer).await;
    }
}

#[tokio::test]
async fn at_most_32_over_capacity_refusals_are_pending_and_the_rest_are_dropped() {
    const FLOOD: usize = 40;
    let limits = ProxyLimits {
        max_clients: 1,
        // The silent holder below has to outlast this test, not time out in it.
        header_timeout: Duration::from_secs(120),
        ..ProxyLimits::default()
    };
    let mut fixture = Fixture::started(rig(false), limits).await;
    // A silent peer takes the only client slot and forty more follow it, all
    // accepted within one turn of the accept loop. No refusal can finish, or
    // even start, before the last of them is accepted, so how many are
    // answered does not depend on time.
    let (mut peers, clients) = accepted(1 + FLOOD).await;
    fixture.probe.hand_over(clients);
    let _holder = peers.remove(0);
    let mut replies = Vec::new();
    for peer in &mut peers {
        replies.push(sent(peer).await);
    }
    // Exactly the first 32 are answered; the others are closed without a byte.
    for (index, reply) in replies.iter().enumerate() {
        if index < 32 {
            assert!(reply.starts_with(b"HTTP/1.1 503 "), "peer {index}");
        } else {
            assert!(reply.is_empty(), "peer {index}");
        }
    }
    let diagnostics = fixture.proxy.diagnostics();
    assert_eq!(diagnostics.accepted_connections, 1 + FLOOD as u32);
    assert_eq!(diagnostics.capacity_refusals, FLOOD as u32);
    assert_eq!(fixture.dials.load(Ordering::SeqCst), 0);
    // The bound is on refusals pending at once, not on refusals ever made:
    // once those peers are gone, an over-capacity socket is answered again.
    drop(peers);
    timeout(DEADLINE, async {
        loop {
            let (mut late, client) = accepted(1).await;
            fixture.probe.hand_over(client);
            if sent(&mut late[0]).await.starts_with(b"HTTP/1.1 503 ") {
                break;
            }
        }
    })
    .await
    .expect("finished refusals never made room for another");
    fixture.proxy.stop().await.unwrap();
}

#[tokio::test]
async fn default_limits_admit_the_52_connections_a_real_page_was_measured_to_hold() {
    // Measured with the real engine: one page held 40 WebSockets and 12
    // ordinary requests through its relay at once. With a cap of 32 the relay
    // refused 20 of them and the page saw 20 failed WebSockets.
    const HELD: usize = 52;
    let mut fixture = Fixture::new().await;
    let auth = fixture.credentials();
    let request = format!(
        "CONNECT {DESTINATION} HTTP/1.1\r\nHost: {DESTINATION}\r\nProxy-Authorization: Basic {auth}\r\n\r\n"
    );
    let mut tunnels = Vec::new();
    let mut refused = 0;
    for _ in 0..HELD {
        let mut client = TcpStream::connect(fixture.proxy.local_addr())
            .await
            .unwrap();
        client.write_all(request.as_bytes()).await.unwrap();
        if head(&mut client).await.starts_with("HTTP/1.1 200 ") {
            tunnels.push(client);
        } else {
            refused += 1;
        }
    }
    assert_eq!((tunnels.len(), refused), (HELD, 0));
    assert_eq!(fixture.proxy.diagnostics().capacity_refusals, 0);
    assert_eq!(fixture.dials.load(Ordering::SeqCst), HELD);
    fixture.proxy.stop().await.unwrap();
}
