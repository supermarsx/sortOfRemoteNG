//! Real CEF/owned-proxy/QUIC fixture. Native-only tests remain independent.
use crate::{known_check, server::FixtureServer, valid_target, HOST, ORIGIN, OTHER};
use bytes::Bytes;
use cef::*;
use sorng_browser_host::{
    bootstrap_platform::{BundlePaths, RuntimeBootstrap},
    cef_browser::{BrowserEvent, BrowserEventSink, CefBrowserHost, NativeDocumentHooks},
    cef_context::{PreparationStatus, PrivateRequestContext},
    cef_runtime::{self, CefRuntime},
    cef_tls_bridge::{
        self, NativeTlsBridge, NativeTlsCaMode, NativeTlsCompletion, NativeTlsConfig,
        NativeTlsDecision, NativeTlsError, NativeTlsEvidence, NativeTlsFailure, NativeTlsHooks,
        HTTP3_PATCH_ID,
    },
    control::{Lifecycle, ViewportBounds},
    domain_permissions::{WebsitePermissionDecision, WebsitePermissionEngine, WebsiteRequestClass},
};
use sorng_protocols::{
    origin_browser::{
        BrowserIdentity, NativeHostReadiness, OriginBrowserPolicy, OriginBrowserSession,
    },
    private_datagram_proxy::{
        ConnectedUdpDatagram, DatagramFuture, DatagramOpenFuture, RouteDatagram,
        RouteDatagramDialer,
    },
    private_forward_proxy::{Authority, BoxedStream, DialFuture, ProxyLimits, RouteDialer},
};
use std::{
    ffi::{c_char, c_void, CStr},
    net::SocketAddr,
    path::PathBuf,
    ptr,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tao::{
    event::Event,
    event_loop::{ControlFlow, EventLoop},
    platform::run_return::EventLoopExtRunReturn,
    window::WindowBuilder,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt},
    task::{JoinHandle, JoinSet},
};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
#[cfg(windows)]
#[no_mangle]
/// # Safety
/// Called only by the pinned sandbox bootstrap with its live native instance,
/// sandbox interface and matching immutable BootstrapVersionInfo descriptor.
pub unsafe extern "C" fn RunWinMain(
    instance: cef::sys::HINSTANCE,
    _: *mut u16,
    _: i32,
    sandbox: *mut std::ffi::c_void,
    version: *const sorng_browser_host::platform::windows::BootstrapVersionInfo,
) -> i32 {
    std::panic::catch_unwind(|| unsafe {
        sorng_browser_host::bootstrap_platform::run_windows_entry(instance, sandbox, version, run)
    })
    .unwrap_or(2)
}
pub fn run(bootstrap: &mut dyn RuntimeBootstrap, paths: &BundlePaths) -> i32 {
    match execute(bootstrap, paths) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("isolated H3 fixture: {error}");
            1
        }
    }
}

#[derive(Default)]
struct Observed {
    loaded: bool,
    title: String,
    errors: Vec<i32>,
}
struct Sink(Mutex<Observed>);
impl NativeDocumentHooks for Sink {
    fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}
    fn login_adapter(&self) -> sorng_browser_host::native_features::NativeLoginAdapter {
        sorng_browser_host::native_features::NativeLoginAdapter::Manual
    }
}
impl BrowserEventSink for Sink {
    fn on_event(&self, event: BrowserEvent) {
        let mut state = self.0.lock().unwrap();
        state.loaded = event.state.document_loaded
            && !event.state.loading
            && event.state.load_failure.is_none();
        state.title = event.display.title;
        if let Some(failure) = event.state.load_failure {
            state.errors.push(failure.code);
        }
    }
}
struct Owner {
    current: AtomicBool,
    pending: Mutex<Vec<(NativeTlsEvidence, NativeTlsCompletion, Instant)>>,
    admitted: AtomicUsize,
    denied: AtomicUsize,
    quic_admitted: AtomicUsize,
    quic_denied: AtomicUsize,
    quic_verified: AtomicUsize,
    alternate_quic_denied: AtomicUsize,
    alternate_quic_verified: AtomicUsize,
    deferred: AtomicUsize,
    before_admission: AtomicUsize,
    minimum_delay: Mutex<Option<u128>>,
    record_revoke: bool,
    bridge_key: Mutex<Option<(u64, u64)>>,
    key_mismatch: AtomicBool,
    engine_revoked: AtomicBool,
}
impl Owner {
    fn new(record_revoke: bool) -> Self {
        Self {
            record_revoke,
            bridge_key: Mutex::new(None),
            key_mismatch: AtomicBool::new(false),
            engine_revoked: AtomicBool::new(false),
            current: AtomicBool::new(true),
            pending: Mutex::new(Vec::new()),
            admitted: AtomicUsize::new(0),
            denied: AtomicUsize::new(0),
            quic_admitted: AtomicUsize::new(0),
            quic_denied: AtomicUsize::new(0),
            quic_verified: AtomicUsize::new(0),
            alternate_quic_denied: AtomicUsize::new(0),
            alternate_quic_verified: AtomicUsize::new(0),
            deferred: AtomicUsize::new(0),
            before_admission: AtomicUsize::new(0),
            minimum_delay: Mutex::new(None),
        }
    }
}
impl NativeTlsHooks for Owner {
    fn on_evidence(&self, evidence: NativeTlsEvidence, completion: NativeTlsCompletion) {
        if self.record_revoke {
            let mut key = self.bridge_key.lock().unwrap();
            let incoming = (evidence.context_token, evidence.generation);
            if key.is_some_and(|old| old != incoming) || incoming.0 == 0 || incoming.1 == 0 {
                self.key_mismatch.store(true, Ordering::Release);
                self.current.store(false, Ordering::Release);
            } else {
                *key = Some(incoming);
            }
        }
        self.pending
            .lock()
            .unwrap()
            .push((evidence, completion, Instant::now()));
    }
    fn is_current(&self) -> bool {
        self.current.load(Ordering::Acquire)
    }
    fn on_failure(&self) {
        self.current.store(false, Ordering::Release);
    }
    fn on_failure_reason(&self, reason: NativeTlsFailure) {
        if self.record_revoke && reason == NativeTlsFailure::EngineRevoked {
            self.engine_revoked.store(true, Ordering::Release);
        }
        self.on_failure();
    }
}
#[derive(Default)]
struct RouteCounters {
    tcp: AtomicUsize,
    udp: AtomicUsize,
    alternate_udp: AtomicUsize,
    sent: AtomicUsize,
    received: AtomicUsize,
    active: AtomicUsize,
}
struct TrackedDatagram {
    inner: ConnectedUdpDatagram,
    counters: Arc<RouteCounters>,
}
impl Drop for TrackedDatagram {
    fn drop(&mut self) {
        self.counters.active.fetch_sub(1, Ordering::SeqCst);
    }
}
impl RouteDatagram for TrackedDatagram {
    fn send<'a>(&'a self, bytes: &'a [u8]) -> DatagramFuture<'a, usize> {
        Box::pin(async move {
            let n = self.inner.send(bytes).await?;
            self.counters.sent.fetch_add(1, Ordering::SeqCst);
            Ok(n)
        })
    }
    fn recv<'a>(&'a self, bytes: &'a mut [u8]) -> DatagramFuture<'a, usize> {
        Box::pin(async move {
            let n = self.inner.recv(bytes).await?;
            self.counters.received.fetch_add(1, Ordering::SeqCst);
            Ok(n)
        })
    }
}
struct UdpRoute {
    address: SocketAddr,
    counters: Arc<RouteCounters>,
}
impl RouteDatagramDialer for UdpRoute {
    fn open(&self, target: Authority) -> DatagramOpenFuture {
        let address = self.address;
        let counters = self.counters.clone();
        Box::pin(async move {
            if !valid_target(target.host(), target.port()) {
                return Err(std::io::Error::other("fixture UDP route denied"));
            }
            let socket = tokio::net::UdpSocket::bind("127.0.0.1:0").await?;
            socket.connect(address).await?;
            let inner = ConnectedUdpDatagram::new(socket)?;
            counters.udp.fetch_add(1, Ordering::SeqCst);
            if target.host() == OTHER {
                counters.alternate_udp.fetch_add(1, Ordering::SeqCst);
            }
            counters.active.fetch_add(1, Ordering::SeqCst);
            Ok(Arc::new(TrackedDatagram { inner, counters }) as Arc<dyn RouteDatagram>)
        })
    }
}
struct Route {
    address: SocketAddr,
    udp: Option<Arc<UdpRoute>>,
    counters: Arc<RouteCounters>,
}
impl RouteDialer for Route {
    fn dial(&self, target: Authority) -> DialFuture {
        let address = self.address;
        let counters = self.counters.clone();
        Box::pin(async move {
            if !valid_target(target.host(), target.port()) {
                return Err(std::io::Error::other("fixture TCP route denied"));
            }
            counters.tcp.fetch_add(1, Ordering::SeqCst);
            let socket = tokio::net::TcpStream::connect(address).await?;
            socket.set_nodelay(true)?;
            Ok(Box::new(socket) as BoxedStream)
        })
    }
    fn datagrams(&self) -> Option<Arc<dyn RouteDatagramDialer>> {
        self.udp
            .as_ref()
            .map(|route| route.clone() as Arc<dyn RouteDatagramDialer>)
    }
}
fn body(path: &str, index: usize, check: &str) -> (String, &'static str) {
    if path.starts_with("/asset/") || path == "/warmup" {
        return (format!("owned-tcp:{path}"), "text/plain");
    }
    // Navigation remains H1/H2. Only the subsequent same-authority fetches can
    // satisfy the H3 proof; a successful fallback cannot turn the test green.
    let config = serde_json::json!({
        "index": index,
        "check": check,
        "alternateOrigin": format!("https://{OTHER}"),
        "probeNonce": if check=="revoke" {revoke_nonce(index).ok()}else{None},
    });
    let script = format!("({})({config});", include_str!("page.js"));
    (
        format!("<!doctype html><title>bootstrap-{index}</title><script>{script}</script>"),
        "text/html",
    )
}
async fn tcp_origin(
    listener: tokio::net::TcpListener,
    acceptor: tokio_rustls::TlsAcceptor,
    index: usize,
    check: String,
    rows: Arc<Mutex<Vec<serde_json::Value>>>,
    mut stop: tokio::sync::oneshot::Receiver<()>,
) -> std::io::Result<()> {
    let mut tasks = JoinSet::new();
    loop {
        tokio::select! {
            _ = &mut stop => break,
            accepted = listener.accept() => {
                let (socket, _) = accepted?; socket.set_nodelay(true)?;
                let acceptor = acceptor.clone(); let rows = rows.clone(); let check = check.clone();
                tasks.spawn(async move {
                    let stream = acceptor.accept(socket).await.map_err(std::io::Error::other)?;
                    let protocol = String::from_utf8_lossy(stream.get_ref().1.alpn_protocol().unwrap_or_default()).to_string();
                    if protocol == "h2" {
                        let mut connection = h2::server::handshake(stream).await.map_err(std::io::Error::other)?;
                        let mut streams = JoinSet::new();
                        while let Some(request) = connection.accept().await {
                            let (request, mut reply) = request.map_err(std::io::Error::other)?;
                            let path = request.uri().path().to_owned(); let rows = rows.clone(); let check = check.clone();
                            streams.spawn(async move {
                                let (body, content_type) = body(&path, index, &check);
                                rows.lock().unwrap().push(serde_json::json!({"path":path,"protocol":"h2"}));
                                let response = http::Response::builder().status(200).header("content-type",content_type).header("alt-svc","h3=\":443\"; ma=60").header("access-control-allow-origin","*").header("cache-control","no-store").body(()).map_err(std::io::Error::other)?;
                                let mut stream = reply.send_response(response, false).map_err(std::io::Error::other)?;
                                stream.send_data(Bytes::from(body), true).map_err(std::io::Error::other)
                            });
                        }
                        streams.abort_all(); while streams.join_next().await.is_some() {}
                        return Ok::<(), std::io::Error>(());
                    }
                    if protocol != "http/1.1" { return Err(std::io::Error::other("unexpected bootstrap ALPN")); }
                    let mut stream = tokio::io::BufReader::new(stream);
                    loop {
                        let mut header = Vec::new();
                        while !header.ends_with(b"\r\n\r\n") && header.len() < 16384 {
                            if stream.read_until(b'\n', &mut header).await? == 0 { return Ok(()); }
                        }
                        if header.len() > 16384 || !header.ends_with(b"\r\n\r\n") || !header.starts_with(b"GET ") { return Err(std::io::Error::other("bounded fixture GET required")); }
                        let text = String::from_utf8_lossy(&header);
                        let path = text.lines().next().and_then(|line| line.split_whitespace().nth(1)).ok_or_else(|| std::io::Error::other("fixture request line"))?;
                        let (body, content_type) = body(path, index, &check);
                        rows.lock().unwrap().push(serde_json::json!({"path":path,"protocol":"http/1.1"}));
                        stream.get_mut().write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAlt-Svc: h3=\":443\"; ma=60\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n{body}", body.len()).as_bytes()).await?;
                    }
                });
            }
        }
    }
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    Ok(())
}
fn revoke_nonce(index: usize) -> Result<String> {
    let run = std::env::var("SORNG_CEF_ACCEPTANCE_RUN_ID")?;
    if run.is_empty() || run.len() > 64 || !run.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
    {
        return Err("revoke nonce invalid".into());
    }
    Ok(format!("{run}-{index}"))
}
#[derive(Clone, Default)]
struct ProbeReply {
    done: bool,
    valid: bool,
    attempted: bool,
    blocked: bool,
    nonce_matched: bool,
}
fn parse_probe_reply(bytes: &[u8], nonce: &str) -> ProbeReply {
    let mut reply = ProbeReply {
        done: true,
        ..Default::default()
    };
    if bytes.len() > 2048 {
        return reply;
    }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return reply;
    };
    if value.get("exceptionDetails").is_some() {
        return reply;
    }
    let Some(value) = value.get("result").and_then(|v| v.get("value")) else {
        return reply;
    };
    reply.nonce_matched = value.get("tag").and_then(|v| v.as_str()) == Some(nonce);
    reply.attempted = value.get("attempted").and_then(|v| v.as_bool()) == Some(true);
    reply.blocked = value.get("blocked").and_then(|v| v.as_bool()) == Some(true);
    reply.valid = reply.nonce_matched && reply.attempted && reply.blocked;
    reply
}
wrap_dev_tools_message_observer! {
    struct RevokeObserver { expected_browser: i32, expected_frame: String, expected_url: String, message: i32, nonce: String, reply: Arc<Mutex<ProbeReply>> }
    impl DevToolsMessageObserver {
        fn on_dev_tools_method_result(&self, browser: Option<&mut Browser>, message_id: i32, success: i32, result: Option<&[u8]>) {
            if message_id != self.message { return; }
            let valid_frame = browser.filter(|b|b.identifier()==self.expected_browser && b.is_valid()==1).and_then(|b|b.main_frame())
                .is_some_and(|f|f.is_valid()==1 && CefString::from(&f.identifier()).to_string()==self.expected_frame && CefString::from(&f.url()).to_string()==self.expected_url);
            let value = if valid_frame && success==1 { result.map(|v|parse_probe_reply(v,&self.nonce)).unwrap_or(ProbeReply{done:true,..Default::default()}) }
                else { ProbeReply{done:true,..Default::default()} };
            if let Ok(mut reply)=self.reply.try_lock() { if !reply.done { *reply=value; } }
        }
    }
}
struct RevokeProbe {
    browser: Browser,
    frame: String,
    url: String,
    nonce: String,
    message: i32,
    reply: Arc<Mutex<ProbeReply>>,
    _registration: Registration,
}
impl RevokeProbe {
    fn bind(index: usize) -> Result<Self> {
        if currently_on(ThreadId::UI) != 1 {
            return Err("revoke probe wrong thread".into());
        }
        let url = format!("{ORIGIN}/bootstrap-{index}");
        let mut matches = Vec::new();
        // Registry belongs solely to this isolated fixture process. No other app is inspected.
        for id in 1..=256 {
            if let Some(browser) = browser_host_get_browser_by_identifier(id) {
                if browser.is_valid() == 1
                    && browser
                        .main_frame()
                        .is_some_and(|f| CefString::from(&f.url()).to_string() == url)
                {
                    matches.push(browser);
                }
            }
        }
        if matches.len() != 1 {
            return Err("revoke probe browser unavailable".into());
        }
        let browser = matches.pop().ok_or("revoke probe browser unavailable")?;
        let frame = browser
            .main_frame()
            .ok_or("revoke probe frame unavailable")?;
        let frame = CefString::from(&frame.identifier()).to_string();
        let nonce = revoke_nonce(index)?;
        let message = 900_000 + i32::try_from(index)?;
        let reply = Arc::new(Mutex::new(ProbeReply::default()));
        let mut observer = RevokeObserver::new(
            browser.identifier(),
            frame.clone(),
            url.clone(),
            message,
            nonce.clone(),
            reply.clone(),
        );
        let registration = browser
            .host()
            .ok_or("revoke probe host unavailable")?
            .add_dev_tools_message_observer(Some(&mut observer))
            .ok_or("revoke observer unavailable")?;
        Ok(Self {
            browser,
            frame,
            url,
            nonce,
            message,
            reply,
            _registration: registration,
        })
    }
    fn submit(&self) -> Result {
        if currently_on(ThreadId::UI) != 1
            || self.browser.is_valid() != 1
            || !self.browser.main_frame().is_some_and(|f| {
                f.is_valid() == 1
                    && CefString::from(&f.identifier()).to_string() == self.frame
                    && CefString::from(&f.url()).to_string() == self.url
            })
        {
            return Err("revoke probe document changed".into());
        }
        let mut params = dictionary_value_create().ok_or("revoke parameters unavailable")?;
        let expression = format!(
            "globalThis.__ownedH3RevokeProbe({})",
            serde_json::to_string(&self.nonce)?
        );
        if params.set_string(
            Some(&CefString::from("expression")),
            Some(&CefString::from(expression.as_str())),
        ) != 1
            || params.set_bool(Some(&CefString::from("awaitPromise")), 1) != 1
            || params.set_bool(Some(&CefString::from("returnByValue")), 1) != 1
            || params.set_bool(Some(&CefString::from("userGesture")), 0) != 1
            || params.set_bool(Some(&CefString::from("allowUnsafeEvalBlockedByCSP")), 0) != 1
        {
            return Err("revoke parameters rejected".into());
        }
        if self
            .browser
            .host()
            .ok_or("revoke host unavailable")?
            .execute_dev_tools_method(
                self.message,
                Some(&CefString::from("Runtime.evaluate")),
                Some(&mut params),
            )
            != self.message
        {
            return Err("revoke probe submission rejected".into());
        }
        Ok(())
    }
}
fn poll_proxy_stop(session: &Arc<Mutex<OriginBrowserSession>>) -> Result<bool> {
    // stop() retains its JoinHandle on cancellation. Drop future AND mutex guard
    // before the next CEF pump: no session lock spans a callback or an await.
    let mut session = match session.try_lock() {
        Ok(session) => session,
        Err(std::sync::TryLockError::WouldBlock) => return Ok(false),
        Err(std::sync::TryLockError::Poisoned(_)) => {
            return Err("revoke stop owner poisoned".into())
        }
    };
    let mut stop = Box::pin(session.stop());
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    let result = std::future::Future::poll(stop.as_mut(), &mut context);
    drop(stop);
    drop(session);
    match result {
        std::task::Poll::Ready(value) => {
            value?;
            Ok(true)
        }
        std::task::Poll::Pending => Ok(false),
    }
}
type RevokeNative = unsafe extern "C" fn(u64, u64) -> i32;
unsafe fn revoke_native_export() -> Result<RevokeNative> {
    if currently_on(ThreadId::UI) != 1 {
        return Err("native revoke wrong thread".into());
    }
    let anchor = unsafe { cef::sys::cef_api_hash(cef::sys::CEF_API_VERSION_LAST, 2) };
    let module = unsafe { fixture_loaded_module::Module::from_address(anchor.cast()) }?;
    let pointer = unsafe { module.symbol(c"cef_sorng_tls_revoke_v2") }?;
    Ok(unsafe { std::mem::transmute::<*mut c_void, RevokeNative>(pointer) })
}
#[derive(Default)]
struct RevokeTimes {
    ready: Option<u128>,
    owner: Option<u128>,
    bridge: Option<u128>,
    stopped: Option<u128>,
    submitted: Option<u128>,
    replied: Option<u128>,
}

struct Slot {
    identity: BrowserIdentity,
    session: Arc<Mutex<OriginBrowserSession>>,
    context: Option<PrivateRequestContext>,
    host: Option<CefBrowserHost<'static>>,
    sink: Arc<Sink>,
    owner: Arc<Owner>,
    route: Arc<RouteCounters>,
    origin: FixtureServer,
    leaf: Vec<u8>,
    quic_leaf: Vec<u8>,
    root: Vec<u8>,
    tcp_rows: Arc<Mutex<Vec<serde_json::Value>>>,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    tcp: Option<JoinHandle<std::io::Result<()>>>,
    navigated: bool,
    close_sent: bool,
    proxy_verified: bool,
    datagram_verified: bool,
    revoked: bool,
    revoke_baseline: usize,
    revoke_at: Option<Instant>,
    revoked_navigation_rejected: bool,
    revoke_probe: Option<RevokeProbe>,
    revoke_reply: ProbeReply,
    revoke_stop_complete: bool,
    revoke_times: RevokeTimes,
}
fn create_slot(index: usize, check: &str, runtime: &tokio::runtime::Runtime) -> Result<Slot> {
    let mut params = rcgen::CertificateParams::new(vec![]);
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    let ca = rcgen::Certificate::from_params(params)?;
    let root = ca.serialize_der()?;
    let cert = rcgen::generate_simple_self_signed(vec![HOST.into(), OTHER.into()])?;
    let leaf = cert.serialize_der_with_signer(&ca)?;
    let key = cert.serialize_private_key_der();
    let chain = vec![leaf.clone().into(), root.clone().into()];
    // Distinct, valid same-CA/SAN leaves distinguish TCP bootstrap from actual
    // QUIC certificate evidence without adding a privileged testing override.
    let quic_cert = rcgen::generate_simple_self_signed(vec![HOST.into(), OTHER.into()])?;
    let quic_leaf = quic_cert.serialize_der_with_signer(&ca)?;
    let origin = runtime
        .block_on(FixtureServer::start_with_chain(
            vec![quic_leaf.clone().into(), root.clone().into()],
            rustls::pki_types::PrivatePkcs8KeyDer::from(quic_cert.serialize_private_key_der()),
            Some(Duration::from_millis(
                if check == "revoke" || check == "isolation" {
                    500
                } else {
                    80
                },
            )),
        ))
        .map_err(|error| -> Box<dyn std::error::Error> { error })?;
    let mut tls = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()?
    .with_no_client_auth()
    .with_single_cert(
        chain,
        rustls::pki_types::PrivatePkcs8KeyDer::from(key).into(),
    )?;
    tls.alpn_protocols = if check == "h1-fallback" {
        vec![b"http/1.1".to_vec()]
    } else {
        vec![b"h2".to_vec(), b"http/1.1".to_vec()]
    };
    tls.send_tls13_tickets = 0;
    tls.session_storage = Arc::new(rustls::server::NoServerSessionStorage {});
    let listener = runtime.block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))?;
    let address = listener.local_addr()?;
    let counters = Arc::new(RouteCounters::default());
    let fallback = matches!(check, "h2-fallback" | "h1-fallback");
    let dialer = Arc::new(Route {
        address,
        udp: (!fallback).then(|| {
            Arc::new(UdpRoute {
                address: origin.address,
                counters: counters.clone(),
            })
        }),
        counters: counters.clone(),
    });
    let tcp_rows = Arc::new(Mutex::new(Vec::new()));
    let (stop, stopped) = tokio::sync::oneshot::channel();
    let tcp = runtime.spawn(tcp_origin(
        listener,
        tokio_rustls::TlsAcceptor::from(Arc::new(tls)),
        index,
        check.into(),
        tcp_rows.clone(),
        stopped,
    ));
    let policy = OriginBrowserPolicy::new_with_allowed_origins(
        "isolated-http3-fixture",
        "same-connection",
        &format!("http3-tab-{index}"),
        ORIGIN,
        &["https://alternate-http3.fixture.test"],
    )?;
    let identity = policy.identity().clone();
    let session = Arc::new(Mutex::new(runtime.block_on(
        OriginBrowserSession::start(policy, dialer, ProxyLimits::default()),
    )?));
    Ok(Slot {
        identity,
        session,
        context: None,
        host: None,
        sink: Arc::new(Sink(Mutex::new(Observed::default()))),
        owner: Arc::new(Owner::new(check == "revoke")),
        route: counters,
        origin,
        leaf,
        quic_leaf,
        root,
        tcp_rows,
        stop: Some(stop),
        tcp: Some(tcp),
        navigated: false,
        close_sent: false,
        proxy_verified: false,
        datagram_verified: false,
        revoked: false,
        revoke_baseline: 0,
        revoke_at: None,
        revoked_navigation_rejected: false,
        revoke_probe: None,
        revoke_reply: ProbeReply::default(),
        revoke_stop_complete: false,
        revoke_times: RevokeTimes::default(),
    })
}
fn execute(bootstrap: &mut dyn RuntimeBootstrap, paths: &BundlePaths) -> Result {
    let check = std::env::var("SORNG_CEF_HTTP3_CHECK")?;
    if !known_check(&check) {
        return Err("unknown HTTP3 check".into());
    }
    let output = PathBuf::from(std::env::var_os("SORNG_CEF_ACCEPTANCE_OUTPUT").ok_or("output")?);
    if !output.is_absolute() || !output.is_dir() || std::fs::read_dir(&output)?.next().is_some() {
        return Err("fresh output required".into());
    }
    let run_id = std::env::var("SORNG_CEF_ACCEPTANCE_RUN_ID")?;
    let asynchronous = tokio::runtime::Runtime::new()?;
    let _entered = asynchronous.enter();
    let mut slots = (0..2)
        .map(|index| create_slot(index, &check, &asynchronous))
        .collect::<Result<Vec<_>>>()?;
    let defaults = [
        WebsiteRequestClass::Navigation,
        WebsiteRequestClass::Script,
        WebsiteRequestClass::FetchXhr,
        WebsiteRequestClass::ImageMedia,
    ]
    .into_iter()
    .map(|class| (class, WebsitePermissionDecision::Allow))
    .collect();
    let permissions = Arc::new(WebsitePermissionEngine::new(None, None, &defaults)?);
    let mut events = EventLoop::new();
    let parent = Arc::new(
        WindowBuilder::new()
            .with_title("Isolated owned HTTP3 fixture")
            .with_visible(false)
            .build(&events)?,
    );
    let mut settings = cef_runtime::native_settings(&paths.helper, &paths.resources)?;
    settings.root_cache_path = CefString::from(output.join("profile").to_str().ok_or("profile")?);
    settings.log_file = CefString::from(output.join("cef.log").to_str().ok_or("log")?);
    let wake = events.create_proxy();
    let runtime = unsafe {
        CefRuntime::initialize(
            bootstrap,
            &settings,
            Arc::new(move || {
                wake.send_event(())
                    .map_err(|_| cef_runtime::WakeUnavailable)
            }),
            Arc::new(|_| {}),
        )?
    };
    let bridge = unsafe { NativeTlsBridge::from_loaded(HTTP3_PATCH_ID)? };
    let clean = cef::command_line_get_global().is_some_and(|line| {
        [
            "no-sandbox",
            "disable-web-security",
            "ignore-certificate-errors",
            "ignore-certificate-errors-spki-list",
            "allow-insecure-localhost",
            "proxy-server",
            "origin-to-force-quic-on",
        ]
        .into_iter()
        .all(|name| line.has_switch(Some(&CefString::from(name))) == 0)
    });
    let clock_before = Instant::now();
    let clock_unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_millis();
    let began = Instant::now();
    let clock_anchor_span_us = began.duration_since(clock_before).as_micros();
    let mut failures = Vec::<String>::new();
    let mut finishing = false;
    let mut phase = "start";
    let mut late_old_cleanup = false;
    let mut survivor_baseline = None;
    events.run_return(|event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(1));
        if !matches!(event, Event::MainEventsCleared) {
            return;
        }
        let step = (|| -> Result {
            phase = "pump";
            runtime.work()?;
            cef_tls_bridge::pump_tls()?;
            for (index, slot) in slots.iter_mut().enumerate() {
                let pending = std::mem::take(&mut *slot.owner.pending.lock().unwrap());
                for (evidence, completion, queued) in pending {
                    let quic_phase = evidence.peer_chain.first() == Some(&slot.quic_leaf);
                    if check == "delay"
                        && quic_phase
                        && queued.elapsed() < Duration::from_millis(300)
                    {
                        slot.owner.deferred.fetch_add(1, Ordering::SeqCst);
                        slot.owner.before_admission.fetch_max(
                            slot.origin.observed.requests.load(Ordering::SeqCst),
                            Ordering::SeqCst,
                        );
                        slot.owner
                            .pending
                            .lock()
                            .unwrap()
                            .push((evidence, completion, queued));
                        continue;
                    }
                    let exact_authority = (evidence.hostname == HOST && evidence.origin == ORIGIN)
                        || (check == "cross-authority"
                            && !quic_phase
                            && evidence.hostname == OTHER
                            && evidence.origin == "https://alternate-http3.fixture.test");
                    let native_valid = evidence.port == 443
                        && evidence.ca_mode == NativeTlsCaMode::CustomOnly
                        && evidence.native_error == 0
                        && evidence.certificate_status == 0
                        && !evidence.fatal_error
                        && (quic_phase || evidence.peer_chain.first() == Some(&slot.leaf));
                    if quic_phase
                        && native_valid
                        && ((evidence.hostname == HOST && evidence.origin == ORIGIN)
                            || (evidence.hostname == OTHER
                                && evidence.origin == "https://alternate-http3.fixture.test"))
                    {
                        slot.owner.quic_verified.fetch_add(1, Ordering::SeqCst);
                        if evidence.hostname == OTHER {
                            slot.owner
                                .alternate_quic_verified
                                .fetch_add(1, Ordering::SeqCst);
                        }
                    }
                    let exact = slot.owner.current.load(Ordering::Acquire)
                        && exact_authority
                        && native_valid
                        && !(check == "deny" && quic_phase);
                    if quic_phase && slot.owner.admitted.load(Ordering::SeqCst) <= 1 {
                        slot.owner.before_admission.fetch_max(
                            slot.origin.observed.requests.load(Ordering::SeqCst),
                            Ordering::SeqCst,
                        );
                    }
                    if exact {
                        slot.owner.admitted.fetch_add(1, Ordering::SeqCst);
                        if quic_phase {
                            slot.owner.quic_admitted.fetch_add(1, Ordering::SeqCst);
                        }
                        if check == "delay" && quic_phase {
                            let mut minimum = slot.owner.minimum_delay.lock().unwrap();
                            *minimum = Some(minimum.map_or(queued.elapsed().as_millis(), |old| {
                                old.min(queued.elapsed().as_millis())
                            }));
                        }
                    } else {
                        slot.owner.denied.fetch_add(1, Ordering::SeqCst);
                        if quic_phase {
                            slot.owner.quic_denied.fetch_add(1, Ordering::SeqCst);
                            if evidence.hostname == OTHER {
                                slot.owner
                                    .alternate_quic_denied
                                    .fetch_add(1, Ordering::SeqCst);
                            }
                        }
                    }
                    completion.complete(if exact {
                        NativeTlsDecision::AdmitNative
                    } else {
                        NativeTlsDecision::Deny
                    });
                }
                if !finishing && slot.host.is_none() {
                    if slot.context.is_none() {
                        phase = "context";
                        slot.context = Some(unsafe {
                            PrivateRequestContext::create_with_tls_capabilities(
                                slot.session.clone(),
                                slot.identity.clone(),
                                permissions.clone(),
                                &bridge,
                                &NativeTlsConfig {
                                    ca_mode: NativeTlsCaMode::CustomOnly,
                                    trust_anchors: vec![slot.root.clone()],
                                    require_scoped_exceptions: false,
                                },
                                slot.owner.clone(),
                                Default::default(),
                            )?
                        });
                    }
                    let context = slot.context.as_ref().unwrap();
                    if matches!(
                        context.status(),
                        PreparationStatus::Failed(_) | PreparationStatus::Revoked
                    ) {
                        return Err("private context failed".into());
                    }
                    if context.status() == PreparationStatus::ProxyConfigured {
                        slot.proxy_verified = context.proxy_application_verified();
                        slot.datagram_verified = context.datagram_application_verified();
                        if !context.tls_hooks_installed()
                            || !slot.proxy_verified
                            || (!matches!(check.as_str(), "h2-fallback" | "h1-fallback")
                                && !slot.datagram_verified)
                        {
                            return Err("context TLS/proxy/datagram proof missing".into());
                        }
                        phase = "host";
                        slot.host = Some(unsafe {
                            CefBrowserHost::create_owned_engineering_probe(
                                parent.clone(),
                                slot.context.take().unwrap(),
                                slot.session.clone(),
                                slot.identity.clone(),
                                ViewportBounds::new(0., 0., 640., 480.)?,
                                parent.scale_factor(),
                                slot.sink.clone(),
                                Some(slot.sink.clone()),
                            )?
                        });
                    }
                }
                if let Some(host) = &slot.host {
                    if !finishing && !slot.navigated && host.features_ready(&slot.identity)? {
                        let mut owner = slot.session.lock().unwrap();
                        let proof = NativeHostReadiness::Ready {
                            profile_key: owner.policy().profile_key().into(),
                            proxy_endpoint: owner.proxy_endpoint(),
                        };
                        owner.report_host(&slot.identity, proof)?;
                        drop(owner);
                        phase = "navigate";
                        host.navigate(&slot.identity, &format!("{ORIGIN}/bootstrap-{index}"))?;
                        slot.navigated = true;
                    }
                    if check == "revoke" && !finishing {
                        let ready = slot.sink.0.lock().unwrap().title
                            == format!("h3-revoke-ready-{index}")
                            && slot.origin.observed.requests.load(Ordering::SeqCst) == 1
                            && slot.origin.observed.completed.load(Ordering::SeqCst) == 1
                            && slot.origin.observed.active.load(Ordering::SeqCst) == 0
                            && slot.owner.quic_admitted.load(Ordering::SeqCst) > 0;
                        if !slot.revoked && ready {
                            if slot.origin.observed.requests.load(Ordering::SeqCst) != 1
                                || slot.origin.observed.completed.load(Ordering::SeqCst) != 1
                                || slot.origin.observed.active.load(Ordering::SeqCst) != 0
                                || slot.owner.quic_admitted.load(Ordering::SeqCst) == 0
                            {
                                return Err("revoke initial owned H3 quiet barrier missing".into());
                            }
                            let key = *slot.owner.bridge_key.lock().unwrap();
                            if slot.owner.key_mismatch.load(Ordering::Acquire) {
                                return Err("revoke context binding changed".into());
                            }
                            let (token, generation) =
                                key.ok_or("revoke context binding unavailable")?;
                            slot.revoke_probe = Some(RevokeProbe::bind(index)?);
                            slot.revoke_times.ready = Some(began.elapsed().as_millis());
                            slot.revoke_baseline =
                                slot.origin.observed.requests.load(Ordering::SeqCst);
                            slot.revoked = true;
                            slot.revoke_at = Some(Instant::now());
                            slot.owner.current.store(false, Ordering::Release);
                            slot.revoke_times.owner = Some(began.elapsed().as_millis());
                            slot.session.lock().unwrap().revoke(&slot.identity)?;
                            // No session/state guard survives this synchronous native callback.
                            let revoke = unsafe { revoke_native_export()? };
                            if unsafe { revoke(token, generation) } != 1 {
                                return Err("native revoke rejected".into());
                            }
                            slot.revoke_times.bridge = Some(began.elapsed().as_millis());
                        }
                        if slot.revoked
                            && !slot.revoke_stop_complete
                            && slot.owner.engine_revoked.load(Ordering::Acquire)
                        {
                            let entered = asynchronous.enter();
                            let stopped = poll_proxy_stop(&slot.session)?;
                            drop(entered);
                            if stopped && slot.route.active.load(Ordering::SeqCst) == 0 {
                                slot.revoke_stop_complete = true;
                                slot.revoke_times.stopped = Some(began.elapsed().as_millis());
                            }
                        }
                        if slot.revoke_stop_complete && slot.revoke_times.submitted.is_none() {
                            slot.revoke_times.submitted = Some(began.elapsed().as_millis());
                            slot.revoke_probe
                                .as_ref()
                                .ok_or("revoke probe unavailable")?
                                .submit()?;
                        }
                        if slot.revoke_times.submitted.is_some() && !slot.revoke_reply.done {
                            let reply = slot
                                .revoke_probe
                                .as_ref()
                                .and_then(|probe| probe.reply.try_lock().ok().map(|r| r.clone()));
                            if let Some(reply) = reply.filter(|reply| reply.done) {
                                if !reply.valid {
                                    return Err("revoke actual JS probe proof rejected".into());
                                }
                                slot.revoke_reply = reply;
                                slot.revoke_times.replied = Some(began.elapsed().as_millis());
                                slot.revoke_probe.take(); // Release observer/browser before normal close.
                                slot.revoked_navigation_rejected = host
                                    .navigate(&slot.identity, &format!("{ORIGIN}/after-revoke"))
                                    .is_err();
                                if !slot.revoked_navigation_rejected {
                                    return Err("revoked native navigation admitted".into());
                                }
                            }
                        }
                    }
                    if check == "isolation"
                        && !slot.revoked
                        && (check == "revoke" || index == 0)
                        && slot.origin.observed.requests.load(Ordering::SeqCst) > 0
                    {
                        slot.revoke_baseline = slot.origin.observed.requests.load(Ordering::SeqCst);
                        slot.revoked = true;
                        slot.revoke_at = Some(Instant::now());
                        slot.owner.current.store(false, Ordering::Release);
                        slot.session.lock().unwrap().revoke(&slot.identity)?;
                        slot.revoked_navigation_rejected = host
                            .navigate(&slot.identity, &format!("{ORIGIN}/after-revoke"))
                            .is_err();
                    }
                }
            }
            if check == "isolation"
                && slots.len() == 2
                && slots[0]
                    .revoke_at
                    .is_some_and(|at| at.elapsed() > Duration::from_millis(750))
                && slots[0].route.active.load(Ordering::SeqCst) == 0
            {
                let old = &mut slots[0];
                if !old.close_sent {
                    old.host.as_ref().ok_or("old host")?.close(&old.identity)?;
                    old.close_sent = true;
                }
                if old
                    .host
                    .as_ref()
                    .is_some_and(|host| host.lifecycle() == Lifecycle::Closed)
                {
                    slots.push(create_slot(2, &check, &asynchronous)?);
                    slots.push(create_slot(3, &check, &asynchronous)?);
                }
            }
            if check == "isolation"
                && slots.len() == 4
                && !late_old_cleanup
                && slots[2..]
                    .iter()
                    .all(|slot| slot.origin.observed.requests.load(Ordering::SeqCst) > 0)
            {
                survivor_baseline = Some(slots[1].origin.observed.requests.load(Ordering::SeqCst));
                asynchronous.block_on(slots[0].session.lock().unwrap().stop())?;
                late_old_cleanup = true;
            }
            let done = slots.iter().enumerate().all(|(index, slot)| {
                let state = slot.sink.0.lock().unwrap();
                if slot.revoked {
                    if check == "revoke"
                        && (!slot.revoke_reply.valid
                            || !slot.revoke_stop_complete
                            || slot.origin.observed.requests.load(Ordering::SeqCst)
                                != slot.revoke_baseline
                            || slot
                                .origin
                                .observed
                                .paths
                                .lock()
                                .unwrap()
                                .iter()
                                .any(|path| path.contains("/__post-revoke/")))
                    {
                        return false;
                    }
                    return slot
                        .revoke_at
                        .is_some_and(|at| at.elapsed() > Duration::from_millis(750))
                        && slot.route.active.load(Ordering::SeqCst) == 0;
                }
                if check == "deny" {
                    return slot.owner.denied.load(Ordering::SeqCst) > 0
                        && began.elapsed() > Duration::from_secs(3);
                }
                let title = if matches!(check.as_str(), "h2-fallback" | "h1-fallback") {
                    format!("fallback-done-{index}")
                } else {
                    format!("h3-done-{index}")
                };
                state.title == title
                    && (check != "cross-authority"
                        || slot.owner.alternate_quic_denied.load(Ordering::SeqCst) > 0)
            });
            let isolation_done = check != "isolation"
                || (slots.len() == 4
                    && late_old_cleanup
                    && survivor_baseline.is_some_and(|baseline| {
                        slots[1].origin.observed.requests.load(Ordering::SeqCst) > baseline
                    }));
            if done && isolation_done {
                finishing = true;
            }
            if began.elapsed() > Duration::from_secs(35) && !finishing {
                failures.push("HTTP3 observation deadline".into());
                finishing = true;
            }
            if finishing {
                for slot in &mut slots {
                    slot.revoke_probe.take();
                    if !slot.close_sent {
                        slot.owner.current.store(false, Ordering::Release);
                        slot.session.lock().unwrap().revoke(&slot.identity)?;
                        if let Some(host) = &slot.host {
                            host.close(&slot.identity)?;
                        }
                        slot.close_sent = true;
                    }
                }
                if slots.iter().all(|slot| {
                    slot.host
                        .as_ref()
                        .is_some_and(|host| host.lifecycle() == Lifecycle::Closed)
                }) {
                    *flow = ControlFlow::Exit;
                }
            }
            if began.elapsed() > Duration::from_secs(45) {
                return Err("native close deadline".into());
            }
            Ok(())
        })();
        if let Err(error) = step {
            failures.push(format!("{phase}: {error}"));
            *flow = ControlFlow::Exit;
        }
    });
    let closed = slots.iter().all(|slot| {
        slot.host
            .as_ref()
            .is_some_and(|host| host.lifecycle() == Lifecycle::Closed)
    });
    let survivor_after_cleanup = survivor_baseline.map(|baseline| {
        slots[1]
            .origin
            .observed
            .requests
            .load(Ordering::SeqCst)
            .saturating_sub(baseline)
    });
    if check == "revoke" {
        for slot in &slots {
            if !slot.revoke_reply.valid
                || !slot.revoke_reply.attempted
                || !slot.revoke_reply.blocked
                || !slot.revoke_reply.nonce_matched
                || !slot.revoke_stop_complete
                || !slot.owner.engine_revoked.load(Ordering::Acquire)
                || slot.origin.observed.requests.load(Ordering::SeqCst) != slot.revoke_baseline
                || slot
                    .origin
                    .observed
                    .paths
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|p| p.contains("/__post-revoke/"))
            {
                failures.push(
                    "Revoke requires actual blocked post-revoke JS probe and unchanged H3 baseline"
                        .into(),
                );
            }
        }
    }
    let rows:Vec<_>=slots.iter().map(|slot| { let state=slot.sink.0.lock().unwrap(); let paths=slot.origin.observed.paths.lock().unwrap().clone(); let probe_matches=paths.iter().filter(|p|p.contains("/__post-revoke/")).count(); let mut row = serde_json::json!({"sessionId":slot.identity.session_id(),"proxyApplied":slot.proxy_verified,"datagramsApplied":slot.datagram_verified,"tcpRequests":*slot.tcp_rows.lock().unwrap(),"h3Requests":slot.origin.observed.requests.load(Ordering::SeqCst),"h3Completed":slot.origin.observed.completed.load(Ordering::SeqCst),"h3AssetRequests":slot.origin.observed.asset_requests.load(Ordering::SeqCst),"h3AssetCompleted":slot.origin.observed.asset_completed.load(Ordering::SeqCst),"h3Connections":slot.origin.observed.h3_connections.load(Ordering::SeqCst),"h3Peak":slot.origin.observed.peak.load(Ordering::SeqCst),"h3Paths":paths,"udpFlowsOpened":slot.route.udp.load(Ordering::SeqCst),"udpSent":slot.route.sent.load(Ordering::SeqCst),"udpReceived":slot.route.received.load(Ordering::SeqCst),"beforeAdmissionHttp3Requests":slot.owner.before_admission.load(Ordering::SeqCst),"admitted":slot.owner.admitted.load(Ordering::SeqCst),"quicAdmitted":slot.owner.quic_admitted.load(Ordering::SeqCst),"quicDenied":slot.owner.quic_denied.load(Ordering::SeqCst),"quicVerified":slot.owner.quic_verified.load(Ordering::SeqCst),"alternateQuicVerified":slot.owner.alternate_quic_verified.load(Ordering::SeqCst),"alternateQuicDenied":slot.owner.alternate_quic_denied.load(Ordering::SeqCst),"alternateUdpFlowsOpened":slot.route.alternate_udp.load(Ordering::SeqCst),"denied":slot.owner.denied.load(Ordering::SeqCst),"deferred":slot.owner.deferred.load(Ordering::SeqCst),"minimumAdmissionDelayMs":*slot.owner.minimum_delay.lock().unwrap(),"revoked":slot.revoked,"revokeBaseline":slot.revoke_baseline,"revokedNavigationRejected":slot.revoked_navigation_rejected,"title":state.title,"errors":state.errors,"diagnostics":slot.session.lock().unwrap().proxy_diagnostics()});
let extra = serde_json::json!({"revokeInitialH3Ready":slot.revoke_times.ready.is_some(),"revokeNativeTerminalObserved":slot.owner.engine_revoked.load(Ordering::Acquire),"revokeProxyStopComplete":slot.revoke_stop_complete,"revokeProbeAttempted":slot.revoke_reply.attempted,"revokeProbeBlocked":slot.revoke_reply.blocked,"revokeProbeNonceMatched":slot.revoke_reply.nonce_matched,"revokeProbeReplyValid":slot.revoke_reply.valid,"revokeProbeServerMatches":probe_matches,"revokeTimelineMs":{"initialBodyComplete":slot.revoke_times.ready,"ownerRevoked":slot.revoke_times.owner,"nativeRevokeReturned":slot.revoke_times.bridge,"proxyStopCompleted":slot.revoke_times.stopped,"probeSubmitted":slot.revoke_times.submitted,"probeReplyObserved":slot.revoke_times.replied}});
row.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
row }).collect();
    let mut report = serde_json::json!({"probeKind":"native-owned-http3","runId":run_id,"patchId":bridge.patch_id(),"loadedBridgeVerified":true,"check":check,"ok":false,"clean":clean,"closed":closed,"productionTlsFactory":true,"globalQuicOverride":false,"serverEarlyDataDisabled":true,"serverSessionTicketsDisabled":true,"slots":rows,"failures":failures,"productionReady":false,"shutdownComplete":false});
    if check == "revoke" {
        report["revokeClockAnchor"] = serde_json::json!({"nativeBeginUnixMs":clock_unix_ms,"samplingSpanMicros":clock_anchor_span_us,"limitation":"Wall/monotonic sample pair; ordering is native monotonic, not exact cross-clock simultaneity"});
    }
    report["lateOldCleanup"] = late_old_cleanup.into();
    report["survivorAfterLateOldCleanup"] = serde_json::json!(survivor_after_cleanup);
    if !closed {
        std::fs::write(
            output.join("native-report.json"),
            serde_json::to_vec_pretty(&report)?,
        )?;
        std::process::exit(3);
    }
    for slot in &mut slots {
        slot.revoke_probe.take();
        drop(slot.host.take());
        drop(slot.context.take());
        asynchronous.block_on(slot.session.lock().unwrap().stop())?;
        if let Some(stop) = slot.stop.take() {
            let _ = stop.send(());
        }
        if let Some(tcp) = slot.tcp.take() {
            asynchronous.block_on(tcp)??;
        }
        asynchronous
            .block_on(slot.origin.shutdown())
            .map_err(|error| -> Box<dyn std::error::Error> { error })?;
    }
    report["flowsAfterStop"] = serde_json::json!(slots
        .iter()
        .map(|slot| slot.route.active.load(Ordering::SeqCst))
        .collect::<Vec<_>>());
    // SAFETY: still on the initializing CEF UI thread. Every host reported
    // Closed and was dropped with its context; owned proxies/origins stopped.
    // Slot hook allocations remain alive through shutdown, and bridge callback
    // retention is released only after CefShutdown has returned successfully.
    unsafe {
        runtime.shutdown()?;
        cef_tls_bridge::after_cef_shutdown();
    }
    report["shutdownComplete"] = true.into();
    report["ok"] = (clean && failures.is_empty() && closed).into();
    std::fs::write(
        output.join("native-report.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    if failures.is_empty() && clean {
        Ok(())
    } else {
        Err("native HTTP3 observations failed".into())
    }
}

#[cfg(target_os = "windows")]
mod fixture_loaded_module {
    use super::*;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetModuleHandleExW(flags: u32, address: *const u16, module: *mut *mut c_void) -> i32;
        fn GetProcAddress(module: *mut c_void, name: *const c_char) -> *mut c_void;
    }
    pub struct Module(*mut c_void);
    impl Module {
        pub unsafe fn from_address(
            address: *const c_void,
        ) -> std::result::Result<Self, NativeTlsError> {
            let mut module = ptr::null_mut();
            // FROM_ADDRESS | PIN: already loaded code remains mapped through all
            // callback/completion lifetimes, including failed shutdown cleanup.
            if address.is_null()
                || unsafe { GetModuleHandleExW(4 | 1, address.cast(), &mut module) } == 0
            {
                return Err(NativeTlsError::Unavailable);
            }
            Ok(Self(module))
        }
        pub unsafe fn symbol(
            &self,
            name: &CStr,
        ) -> std::result::Result<*mut c_void, NativeTlsError> {
            let symbol = unsafe { GetProcAddress(self.0, name.as_ptr()) };
            if symbol.is_null() || unsafe { Self::from_address(symbol) }?.0 != self.0 {
                return Err(NativeTlsError::Unavailable);
            }
            Ok(symbol)
        }
    }
}
#[cfg(any(target_os = "linux", target_os = "macos"))]
mod fixture_loaded_module {
    use super::*;
    #[repr(C)]
    struct DlInfo {
        name: *const c_char,
        base: *mut c_void,
        symbol: *const c_char,
        address: *mut c_void,
    }
    #[cfg_attr(target_os = "linux", link(name = "dl"))]
    unsafe extern "C" {
        fn dladdr(address: *const c_void, info: *mut DlInfo) -> i32;
        fn dlopen(name: *const c_char, flags: i32) -> *mut c_void;
        fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    }
    pub struct Module {
        handle: *mut c_void,
        base: *mut c_void,
    }
    impl Module {
        pub unsafe fn from_address(
            address: *const c_void,
        ) -> std::result::Result<Self, NativeTlsError> {
            let mut info: DlInfo = unsafe { std::mem::zeroed() };
            if address.is_null()
                || unsafe { dladdr(address, &mut info) } == 0
                || info.name.is_null()
            {
                return Err(NativeTlsError::Unavailable);
            }
            #[cfg(target_os = "linux")]
            const NOLOAD: i32 = 4;
            #[cfg(target_os = "macos")]
            const NOLOAD: i32 = 0x10;
            // No search path/fallback load. Retain this already-loaded image for
            // process lifetime; never unload code still reachable by callbacks.
            let handle = unsafe { dlopen(info.name, NOLOAD | 2) };
            if handle.is_null() {
                return Err(NativeTlsError::Unavailable);
            }
            Ok(Self {
                handle,
                base: info.base,
            })
        }
        pub unsafe fn symbol(
            &self,
            name: &CStr,
        ) -> std::result::Result<*mut c_void, NativeTlsError> {
            let symbol = unsafe { dlsym(self.handle, name.as_ptr()) };
            let mut info: DlInfo = unsafe { std::mem::zeroed() };
            if symbol.is_null()
                || unsafe { dladdr(symbol, &mut info) } == 0
                || info.base != self.base
            {
                return Err(NativeTlsError::Unavailable);
            }
            Ok(symbol)
        }
    }
}
#[cfg(test)]
mod revoke_probe_tests {
    use super::*;
    use cef::rc::{ConvertReturnValue, RcImpl};
    use cef::sys::{_cef_browser_t, _cef_frame_t, cef_string_userfree_t};
    fn reply(tag: &str, attempted: bool, blocked: bool) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"result":{"type":"object","value":{"tag":tag,"attempted":attempted,"blocked":blocked}}})).unwrap()
    }
    #[test]
    fn parser_requires_nonce_actual_attempt_and_rejection_not_missing_or_timeout() {
        assert!(parse_probe_reply(&reply("owned", true, true), "owned").valid);
        for bytes in [
            reply("wrong", true, true),
            reply("owned", false, true),
            reply("owned", true, false),
            b"{}".to_vec(),
            b"not json".to_vec(),
            vec![b'x'; 2049],
        ] {
            assert!(!parse_probe_reply(&bytes, "owned").valid);
        }
        assert!(!ProbeReply::default().done);
        assert!(!ProbeReply::default().valid);
        assert!(!parse_probe_reply(br#"{"result":{"value":{"tag":"owned","attempted":true,"blocked":true}},"exceptionDetails":{}}"#,"owned").valid);
    }
    fn string(value: &str) -> cef_string_userfree_t {
        let units: Vec<_> = value.encode_utf16().collect();
        // Only CEF-owned string allocations cross the generated C ABI.
        unsafe {
            let value = cef::sys::cef_string_userfree_utf16_alloc();
            assert!(!value.is_null());
            assert_eq!(
                cef::sys::cef_string_utf16_set(units.as_ptr(), units.len(), value, 1),
                1
            );
            value
        }
    }
    struct FrameData {
        id: &'static str,
        url: &'static str,
    }
    fn frame(frame_id: &'static str, frame_url: &'static str) -> Frame {
        extern "C" fn valid(_this: *mut _cef_frame_t) -> i32 {
            1
        }
        extern "C" fn id(this: *mut _cef_frame_t) -> cef_string_userfree_t {
            string(RcImpl::<_cef_frame_t, FrameData>::get(this).interface.id)
        }
        extern "C" fn url(this: *mut _cef_frame_t) -> cef_string_userfree_t {
            string(RcImpl::<_cef_frame_t, FrameData>::get(this).interface.url)
        }
        // Only the slots used by the real observer are installed; RcImpl owns references.
        let api = _cef_frame_t {
            is_valid: Some(valid),
            get_identifier: Some(id),
            get_url: Some(url),
            ..unsafe { std::mem::zeroed() }
        };
        let raw: *mut _cef_frame_t = RcImpl::new(
            api,
            FrameData {
                id: frame_id,
                url: frame_url,
            },
        )
        .cast();
        raw.wrap_result()
    }
    struct BrowserData {
        id: i32,
        frame: Frame,
    }
    fn browser(browser_id: i32, frame: Frame) -> Browser {
        extern "C" fn valid(_this: *mut _cef_browser_t) -> i32 {
            1
        }
        extern "C" fn id(this: *mut _cef_browser_t) -> i32 {
            RcImpl::<_cef_browser_t, BrowserData>::get(this)
                .interface
                .id
        }
        extern "C" fn main(this: *mut _cef_browser_t) -> *mut _cef_frame_t {
            RcImpl::<_cef_browser_t, BrowserData>::get(this)
                .interface
                .frame
                .clone()
                .into()
        }
        let api = _cef_browser_t {
            is_valid: Some(valid),
            get_identifier: Some(id),
            get_main_frame: Some(main),
            ..unsafe { std::mem::zeroed() }
        };
        let raw: *mut _cef_browser_t = RcImpl::new(
            api,
            BrowserData {
                id: browser_id,
                frame,
            },
        )
        .cast();
        raw.wrap_result()
    }
    fn observer(state: Arc<Mutex<ProbeReply>>) -> DevToolsMessageObserver {
        RevokeObserver::new(
            7,
            "owned-frame".into(),
            "https://http3.fixture.test/bootstrap-0".into(),
            900_000,
            "owned".into(),
            state,
        )
    }
    #[test]
    fn actual_cef_observer_vtable_accepts_only_owned_frame_message_and_probe_result() {
        let state = Arc::new(Mutex::new(ProbeReply::default()));
        let o = observer(state.clone());
        let mut b = browser(
            7,
            frame("owned-frame", "https://http3.fixture.test/bootstrap-0"),
        );
        o.on_dev_tools_method_result(Some(&mut b), 900_001, 1, Some(&reply("owned", true, true)));
        assert!(!state.lock().unwrap().done);
        o.on_dev_tools_method_result(Some(&mut b), 900_000, 1, Some(&reply("owned", true, true)));
        assert!(state.lock().unwrap().valid);
    }
    #[test]
    fn actual_cef_observer_vtable_rejects_foreign_browser_frame_url_and_errors() {
        for (id, name, url, success, tag) in [
            (
                8,
                "owned-frame",
                "https://http3.fixture.test/bootstrap-0",
                1,
                "owned",
            ),
            (
                7,
                "other-frame",
                "https://http3.fixture.test/bootstrap-0",
                1,
                "owned",
            ),
            (
                7,
                "owned-frame",
                "https://http3.fixture.test/bootstrap-1",
                1,
                "owned",
            ),
            (
                7,
                "owned-frame",
                "https://http3.fixture.test/bootstrap-0",
                0,
                "owned",
            ),
            (
                7,
                "owned-frame",
                "https://http3.fixture.test/bootstrap-0",
                1,
                "wrong",
            ),
        ] {
            let state = Arc::new(Mutex::new(ProbeReply::default()));
            let o = observer(state.clone());
            let mut b = browser(id, frame(name, url));
            o.on_dev_tools_method_result(
                Some(&mut b),
                900_000,
                success,
                Some(&reply(tag, true, true)),
            );
            assert!(state.lock().unwrap().done);
            assert!(!state.lock().unwrap().valid);
        }
    }
    #[test]
    fn actual_cef_observer_never_blocks_held_diagnostic_mutex_or_manufactures_reply() {
        let state = Arc::new(Mutex::new(ProbeReply::default()));
        let o = observer(state.clone());
        let guard = state.lock().unwrap();
        o.on_dev_tools_method_result(None, 900_000, 0, None);
        assert!(!guard.done);
        drop(guard);
        assert!(!state.lock().unwrap().valid);
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn real_proxy_stop_poll_releases_busy_guard_and_remains_cancellation_safe() {
        let policy = OriginBrowserPolicy::new("fixture", "stop", "stop-poll", ORIGIN).unwrap();
        let route = Arc::new(Route {
            address: "127.0.0.1:9".parse().unwrap(),
            udp: None,
            counters: Arc::new(RouteCounters::default()),
        });
        // Listener only: no connection or upstream dial is made by this test.
        let session = Arc::new(Mutex::new(
            OriginBrowserSession::start(policy, route, ProxyLimits::default())
                .await
                .unwrap(),
        ));
        let guard = session.lock().unwrap();
        assert!(!poll_proxy_stop(&session).unwrap());
        drop(guard);
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let done = poll_proxy_stop(&session).unwrap();
                assert!(session.try_lock().is_ok(), "no guard may survive a poll");
                if done {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
}
