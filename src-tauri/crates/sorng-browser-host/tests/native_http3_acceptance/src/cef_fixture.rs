//! Real CEF/owned-proxy/QUIC fixture. Native-only tests remain independent.
use crate::{known_check, server::FixtureServer, valid_target, HOST, ORIGIN, OTHER};
use bytes::Bytes;
use cef::{CefString, ImplCommandLine};
use sorng_browser_host::{
    bootstrap_platform::{BundlePaths, RuntimeBootstrap},
    cef_browser::{BrowserEvent, BrowserEventSink, CefBrowserHost, NativeDocumentHooks},
    cef_context::{PreparationStatus, PrivateRequestContext},
    cef_runtime::{self, CefRuntime},
    cef_tls_bridge::{
        self, NativeTlsBridge, NativeTlsCaMode, NativeTlsCompletion, NativeTlsConfig,
        NativeTlsDecision, NativeTlsEvidence, NativeTlsHooks, HTTP3_PATCH_ID,
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
    net::SocketAddr,
    path::PathBuf,
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
}
impl Owner {
    fn new() -> Self {
        Self {
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
        owner: Arc::new(Owner::new()),
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
    let began = Instant::now();
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
                    if matches!(check.as_str(), "revoke" | "isolation")
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
    let rows:Vec<_>=slots.iter().map(|slot| { let state=slot.sink.0.lock().unwrap(); serde_json::json!({"sessionId":slot.identity.session_id(),"proxyApplied":slot.proxy_verified,"datagramsApplied":slot.datagram_verified,"tcpRequests":*slot.tcp_rows.lock().unwrap(),"h3Requests":slot.origin.observed.requests.load(Ordering::SeqCst),"h3Completed":slot.origin.observed.completed.load(Ordering::SeqCst),"h3AssetRequests":slot.origin.observed.asset_requests.load(Ordering::SeqCst),"h3AssetCompleted":slot.origin.observed.asset_completed.load(Ordering::SeqCst),"h3Connections":slot.origin.observed.h3_connections.load(Ordering::SeqCst),"h3Peak":slot.origin.observed.peak.load(Ordering::SeqCst),"h3Paths":*slot.origin.observed.paths.lock().unwrap(),"udpFlowsOpened":slot.route.udp.load(Ordering::SeqCst),"udpSent":slot.route.sent.load(Ordering::SeqCst),"udpReceived":slot.route.received.load(Ordering::SeqCst),"beforeAdmissionHttp3Requests":slot.owner.before_admission.load(Ordering::SeqCst),"admitted":slot.owner.admitted.load(Ordering::SeqCst),"quicAdmitted":slot.owner.quic_admitted.load(Ordering::SeqCst),"quicDenied":slot.owner.quic_denied.load(Ordering::SeqCst),"quicVerified":slot.owner.quic_verified.load(Ordering::SeqCst),"alternateQuicVerified":slot.owner.alternate_quic_verified.load(Ordering::SeqCst),"alternateQuicDenied":slot.owner.alternate_quic_denied.load(Ordering::SeqCst),"alternateUdpFlowsOpened":slot.route.alternate_udp.load(Ordering::SeqCst),"denied":slot.owner.denied.load(Ordering::SeqCst),"deferred":slot.owner.deferred.load(Ordering::SeqCst),"minimumAdmissionDelayMs":*slot.owner.minimum_delay.lock().unwrap(),"revoked":slot.revoked,"revokeBaseline":slot.revoke_baseline,"revokedNavigationRejected":slot.revoked_navigation_rejected,"title":state.title,"errors":state.errors,"diagnostics":slot.session.lock().unwrap().proxy_diagnostics()}) }).collect();
    let mut report = serde_json::json!({"probeKind":"native-owned-http3","runId":run_id,"patchId":bridge.patch_id(),"loadedBridgeVerified":true,"check":check,"ok":false,"clean":clean,"closed":closed,"productionTlsFactory":true,"globalQuicOverride":false,"serverEarlyDataDisabled":true,"serverSessionTicketsDisabled":true,"slots":rows,"failures":failures,"productionReady":false,"shutdownComplete":false});
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
