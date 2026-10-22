//! Opt-in local HTTP/2 acceptance using the production TLS admission factory.
use cef::{CefString, ImplCommandLine};
use sorng_browser_host::{
    bootstrap_platform::{BundlePaths, RuntimeBootstrap},
    cef_browser::{BrowserEvent, BrowserEventSink, CefBrowserHost, NativeDocumentHooks},
    cef_context::{PreparationStatus, PrivateRequestContext},
    cef_runtime::{self, CefRuntime},
    cef_tls_bridge::{
        self, NativeTlsBridge, NativeTlsCaMode, NativeTlsCompletion, NativeTlsConfig,
        NativeTlsDecision, NativeTlsEvidence, NativeTlsHooks, HTTP2_PATCH_ID, LEGACY_PATCH_ID, PATCH_ID,
    },
    control::{Lifecycle, ViewportBounds},
    domain_permissions::{WebsitePermissionDecision, WebsitePermissionEngine, WebsiteRequestClass},
};
use sorng_protocols::{
    origin_browser::{
        BrowserIdentity, NativeHostReadiness, OriginBrowserPolicy, OriginBrowserSession,
    },
    private_forward_proxy::{Authority, BoxedStream, DialFuture, ProxyLimits, RouteDialer},
};
use std::{
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
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
const ORIGIN: &str = "https://proxy-first.fixture.test";
const OTHER_ORIGIN: &str = "https://alternate.fixture.test";
fn cross_authority() -> bool {
    std::env::var("SORNG_CEF_HTTP2_CHECK").as_deref() == Ok("cross-authority")
}
fn websocket_check() -> bool {
    matches!(std::env::var("SORNG_CEF_HTTP2_CHECK").as_deref(), Ok("wss" | "permission-churn"))
}
fn revoke_check() -> bool {
    std::env::var("SORNG_CEF_HTTP2_CHECK").as_deref() == Ok("revoke")
}
fn h1_only() -> bool {
    std::env::var("SORNG_CEF_HTTP2_EXPECT").as_deref() == Ok("h1")
}
#[derive(Clone, Copy)]
struct Case {
    resources: usize,
    response_ms: u64,
    dial_ms: u64,
}
const CASES: [Case; 7] = [
    Case {
        resources: 0,
        response_ms: 0,
        dial_ms: 0,
    },
    Case {
        resources: 8,
        response_ms: 0,
        dial_ms: 0,
    },
    Case {
        resources: 32,
        response_ms: 0,
        dial_ms: 0,
    },
    Case {
        resources: 0,
        response_ms: 80,
        dial_ms: 0,
    },
    Case {
        resources: 8,
        response_ms: 80,
        dial_ms: 0,
    },
    Case {
        resources: 32,
        response_ms: 80,
        dial_ms: 0,
    },
    Case {
        resources: 32,
        response_ms: 80,
        dial_ms: 80,
    },
];
#[derive(Default)]
struct Counters {
    active: AtomicUsize,
    peak: AtomicUsize,
    dial_active: AtomicUsize,
    dial_peak: AtomicUsize,
}
fn enter(active: &AtomicUsize, peak: &AtomicUsize) {
    let value = active.fetch_add(1, Ordering::Relaxed) + 1;
    peak.fetch_max(value, Ordering::Relaxed);
}
fn case_index(path: &str) -> Option<usize> {
    path.strip_prefix("/case-")?
        .split('/')
        .next()?
        .parse::<usize>()
        .ok()
        .filter(|i| *i < CASES.len())
}
const KIND: &str = "native-same-authority-http2";
mod http2_fixture;
mod proxy_ack_fixture;
#[path = "../../native_tls_acceptance/src/registry_retirement_fixture.rs"]
mod registry_retirement_fixture;
mod permission_churn_fixture;
mod websocket_fixture;
#[no_mangle]
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
fn run(bootstrap: &mut dyn RuntimeBootstrap, paths: &BundlePaths) -> i32 {
    match execute(bootstrap, paths) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("isolated fixture: {e}");
            1
        }
    }
}
#[derive(Default)]
struct Observed {
    loaded: bool,
    title: String,
    errors: Vec<i32>,
    completed_ms: Option<f64>,
    native_states: Vec<String>,
    feature_states: Vec<String>,
}
struct Sink(Mutex<Observed>, Instant);
impl NativeDocumentHooks for Sink {
    fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}
    fn on_feature_status(
        &self,
        _: &BrowserIdentity,
        _: &str,
        status: sorng_browser_host::native_features::NativeFeatureStatus,
    ) {
        self.0
            .lock()
            .unwrap()
            .feature_states
            .push(format!("{status:?}"));
    }
    fn login_adapter(&self) -> sorng_browser_host::native_features::NativeLoginAdapter {
        sorng_browser_host::native_features::NativeLoginAdapter::Manual
    }
}
impl BrowserEventSink for Sink {
    fn on_event(&self, event: BrowserEvent) {
        let mut s = self.0.lock().unwrap();
        let label = format!("{:?}:{:?}", event.state.lifecycle, event.state.fault);
        if s.native_states.last() != Some(&label) {
            s.native_states.push(label);
        }
        let previously_loaded = s.loaded;
        s.loaded = event.state.document_loaded
            && !event.state.loading
            && event.state.load_failure.is_none();
        if s.loaded && !previously_loaded {
            s.completed_ms = Some(self.1.elapsed().as_secs_f64() * 1000.0);
        }
        s.title = event.display.title;
        if let Some(e) = event.state.load_failure {
            if s.errors.last() != Some(&e.code) {
                s.errors.push(e.code)
            }
        }
    }
}
struct TlsOwner {
    current: AtomicBool,
    denied: AtomicUsize,
    admitted: AtomicBool,
    before_admission_bytes: AtomicUsize,
    closed_connections: AtomicUsize,
    pending: Mutex<Vec<(NativeTlsEvidence, NativeTlsCompletion, Instant)>>,
}
impl NativeTlsHooks for TlsOwner {
    fn on_evidence(&self, e: NativeTlsEvidence, c: NativeTlsCompletion) {
        self.pending.lock().unwrap().push((e, c, Instant::now()));
    }
    fn is_current(&self) -> bool {
        self.current.load(Ordering::Acquire)
    }
    fn on_failure(&self) {
        self.current.store(false, Ordering::Release);
    }
}
fn certificates() -> Result<(Vec<u8>, Vec<u8>, tokio_rustls::TlsAcceptor)> {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let mut params = rcgen::CertificateParams::new(vec![]);
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    let ca = rcgen::Certificate::from_params(params)?;
    let root = ca.serialize_der()?;
    let leaf = rcgen::generate_simple_self_signed(vec![
        "proxy-first.fixture.test".into(),
        "alternate.fixture.test".into(),
    ])?;
    let der = leaf.serialize_der_with_signer(&ca)?;
    let mut config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![der.clone().into(), root.clone().into()],
            rustls::pki_types::PrivatePkcs8KeyDer::from(leaf.serialize_private_key_der()).into(),
        )?;
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    if h1_only() {
        config.alpn_protocols = vec![b"http/1.1".to_vec()];
    }
    config.session_storage = Arc::new(rustls::server::NoServerSessionStorage {});
    config.send_tls13_tickets = 0;
    Ok((root, der, tokio_rustls::TlsAcceptor::from(Arc::new(config))))
}
struct Slot {
    proxy_application_verified: bool,
    proxy_before_host: serde_json::Value,
    identity: BrowserIdentity,
    session: Arc<Mutex<OriginBrowserSession>>,
    context: Option<PrivateRequestContext>,
    host: Option<CefBrowserHost<'static>>,
    sink: Arc<Sink>,
    dials: Arc<AtomicUsize>,
    requests: Arc<Mutex<Vec<serde_json::Value>>>,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    server: Option<tokio::task::JoinHandle<std::io::Result<()>>>,
    navigated: bool,
    navigation_ms: f64,
    counters: Arc<Vec<Counters>>,
    current_case: Arc<AtomicUsize>,
    reports: Vec<serde_json::Value>,
    close_sent: bool,
    alpn_observed: Arc<Mutex<Vec<String>>>,
    tls_owner: Arc<TlsOwner>,
}
fn create_slot(
    index: usize,
    source_session: &str,
    asynchronous: &tokio::runtime::Runtime,
    clock: Instant,
    tls_acceptor: &tokio_rustls::TlsAcceptor,
    connection_ids: &Arc<AtomicUsize>,
    fixture_nodelay: bool,
) -> Result<Slot> {
    let tls_owner = Arc::new(TlsOwner {
        current: AtomicBool::new(true),
        denied: AtomicUsize::new(0),
        admitted: AtomicBool::new(false),
        before_admission_bytes: AtomicUsize::new(0),
        closed_connections: AtomicUsize::new(0),
        pending: Mutex::new(Vec::new()),
    });
    let server_owner = tls_owner.clone();
    let listener = asynchronous.block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))?;
    let address = listener.local_addr()?;
    let requests = Arc::new(Mutex::new(Vec::new()));
    let req = requests.clone();
    let counters = Arc::new(
        (0..CASES.len())
            .map(|_| Counters::default())
            .collect::<Vec<_>>(),
    );
    let server_counters = counters.clone();
    let current_case = Arc::new(AtomicUsize::new(0));
    let (stop, mut stopped) = tokio::sync::oneshot::channel();
    let alpn_observed = Arc::new(Mutex::new(Vec::new()));
    let server_alpn = alpn_observed.clone();
    let acceptor = tls_acceptor.clone();
    let connection_ids = connection_ids.clone();
    let server=asynchronous.spawn(async move {
        let mut tasks=tokio::task::JoinSet::new();
        loop {tokio::select! {
            _=&mut stopped=>break,
            accepted=listener.accept()=>{
                let (stream,_)=accepted?;
                if fixture_nodelay {stream.set_nodelay(true)?;}
                let acceptor=acceptor.clone();
                let alpn_observed=server_alpn.clone();
                let connection_id=connection_ids.fetch_add(1,Ordering::Relaxed);
                let req=req.clone(); let counters=server_counters.clone();
                let owner=server_owner.clone();
                tasks.spawn(async move {
                    let stream=acceptor.accept(stream).await?;
                    let alpn=String::from_utf8_lossy(stream.get_ref().1.alpn_protocol().unwrap_or_default()).to_string();
                    alpn_observed.lock().unwrap().push(alpn.clone());
                    let stream=http2_fixture::ObservedIo {inner:stream,owner};
                    if alpn=="h2" {
                        return http2_fixture::serve(stream,index,connection_id,clock,req,counters).await;
                    }
                    if alpn!="http/1.1" {return Err(std::io::Error::other("fixture negotiated unsupported protocol"));}
                    let mut stream=tokio::io::BufReader::new(stream);
                    loop {
                    let mut header=Vec::new();
                    while !header.ends_with(b"\r\n\r\n") && header.len()<16384 {
                        if stream.read_until(b'\n',&mut header).await?==0 {return Ok::<_,std::io::Error>(())}
                    }
                    if header.len()>16384 || !header.ends_with(b"\r\n\r\n") || !header.starts_with(b"GET ") {return Err(std::io::Error::other("bounded GET fixture required"));}
                    let request=String::from_utf8_lossy(&header);
                    let path=request.lines().next().and_then(|s|s.split_whitespace().nth(1)).unwrap_or("").to_owned();
                    if path=="/socket" {
                        websocket_fixture::echo(&mut stream,&request).await?;
                        req.lock().unwrap().push(serde_json::json!({"alpn":alpn,"connectionId":connection_id,"path":path,"websocket":true,"written":true}));
                        return Ok(());
                    }
                    let case=case_index(&path);
                    let began_ms=clock.elapsed().as_secs_f64()*1000.0;
                    if let Some(i)=case { enter(&counters[i].active,&counters[i].peak); tokio::time::sleep(Duration::from_millis(CASES[i].response_ms)).await; }
                    let asset=path.contains("/asset-");
                    let body=if asset { "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"><rect width=\"1\" height=\"1\"/></svg>".to_owned() }
                        else { let i=case.unwrap_or(0); let images=(0..CASES[i].resources).map(|n|format!("<img src=\"/case-{i}/asset-{n}.svg\">" )).collect::<String>(); format!("<!doctype html><title>marker-{index}-{path}</title><body>{images}</body>") };
                    let content_type=if asset {"image/svg+xml"}else{"text/html"};
                    let response=format!("HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n{body}",body.len());
                    let result=stream.write_all(response.as_bytes()).await;
                    let end_ms=clock.elapsed().as_secs_f64()*1000.0;
                    if let Some(i)=case {counters[i].active.fetch_sub(1,Ordering::Relaxed);}
                    req.lock().unwrap().push(serde_json::json!({"alpn":alpn,"connectionId":connection_id,"path":path,"case":case,"asset":asset,"startMs":began_ms,"endMs":end_ms,"written":result.is_ok()}));
                    result?;
                    }
                });
            }
        }}
        tasks.abort_all();while tasks.join_next().await.is_some(){} Ok(())
    });
    let dials = Arc::new(AtomicUsize::new(0));
    let count = dials.clone();
    let dial_counters = counters.clone();
    let dial_case = current_case.clone();
    let dialer: Arc<dyn RouteDialer> = Arc::new(move |target: Authority| -> DialFuture {
        let count = count.clone();
        let counters = dial_counters.clone();
        let i = dial_case.load(Ordering::Relaxed);
        Box::pin(async move {
            if !["proxy-first.fixture.test", "alternate.fixture.test"].contains(&target.host())
                || target.port() != 443
            {
                return Err(std::io::Error::other("fixture route denied"));
            }
            count.fetch_add(1, Ordering::Relaxed);
            enter(&counters[i].dial_active, &counters[i].dial_peak);
            tokio::time::sleep(Duration::from_millis(CASES[i].dial_ms)).await;
            let stream = tokio::net::TcpStream::connect(address).await;
            counters[i].dial_active.fetch_sub(1, Ordering::Relaxed);
            let stream = stream?;
            if fixture_nodelay {
                stream.set_nodelay(true)?;
            }
            Ok(Box::new(stream) as BoxedStream)
        })
    });
    let policy = OriginBrowserPolicy::new_with_allowed_origins(
        "isolated-proxy-fixture",
        "same-connection",
        source_session,
        ORIGIN,
        &[OTHER_ORIGIN],
    )?;
    let identity = policy.identity().clone();
    let session = Arc::new(Mutex::new(asynchronous.block_on(
        OriginBrowserSession::start(policy, dialer, ProxyLimits::default()),
    )?));
    Ok(Slot {
        proxy_application_verified: false,
        proxy_before_host: serde_json::Value::Null,
        identity,
        session,
        context: None,
        host: None,
        sink: Arc::new(Sink(Mutex::new(Observed::default()), clock)),
        dials,
        requests,
        stop: Some(stop),
        server: Some(server),
        navigated: false,
        navigation_ms: 0.0,
        counters,
        current_case,
        reports: Vec::new(),
        close_sent: false,
        alpn_observed,
        tls_owner,
    })
}
fn execute(bootstrap: &mut dyn RuntimeBootstrap, paths: &BundlePaths) -> Result {
    if std::env::var("SORNG_CEF_HTTP2_CHECK").as_deref() == Ok("permission-churn") {
        return permission_churn_fixture::execute(bootstrap, paths);
    }
    let legacy = std::env::var("SORNG_CEF_HTTP2_EXPECT").as_deref() == Ok("legacy");
    let http2_revision = std::env::var("SORNG_CEF_HTTP2_EXPECT").as_deref() == Ok("h2");
    if std::env::var("SORNG_CEF_HTTP2_EXPECT").is_ok_and(|mode| !["legacy", "h2", "proxy-ack"].contains(&mode.as_str())) {
        return Err("unknown native fixture revision".into());
    }
    let visible = std::env::var_os("SORNG_PROBE_VISIBLE").is_some();
    let fixture_nodelay = std::env::var_os("SORNG_PROBE_FIXTURE_NODELAY").is_some();
    let clock = Instant::now();
    let output = PathBuf::from(std::env::var_os("SORNG_CEF_ACCEPTANCE_OUTPUT").ok_or("output")?);
    if !output.is_absolute() || !output.is_dir() || std::fs::read_dir(&output)?.next().is_some() {
        return Err("fresh output required".into());
    }
    let run_id = std::env::var("SORNG_CEF_ACCEPTANCE_RUN_ID")?;
    let asynchronous = tokio::runtime::Runtime::new()?;
    let _entered = asynchronous.enter();
    let (root_der, leaf_der, tls_acceptor) = certificates()?;
    let connection_ids = Arc::new(AtomicUsize::new(0));
    let mut slots = Vec::new();
    for index in 0..2 {
        slots.push(create_slot(index, &format!("tab-{index}"), &asynchronous, clock,
            &tls_acceptor, &connection_ids, fixture_nodelay)?);
    }
    let mut raw_before = Vec::new();
    for slot in &slots {
        let endpoint = slot.session.lock().unwrap().proxy_endpoint();
        raw_before.push(
            asynchronous
                .block_on(async {
                    let mut stream = tokio::net::TcpStream::connect(endpoint).await?;
                    stream.shutdown().await
                })
                .is_ok(),
        );
    }
    asynchronous.block_on(async { tokio::time::sleep(Duration::from_millis(20)).await });
    let baseline = serde_json::json!(slots
        .iter()
        .map(|s| s.session.lock().unwrap().proxy_diagnostics())
        .collect::<Vec<_>>());
    let defaults = [
        WebsiteRequestClass::Navigation,
        WebsiteRequestClass::ImageMedia,
        WebsiteRequestClass::Websocket,
    ]
    .into_iter()
    .map(|c| (c, WebsitePermissionDecision::Allow))
    .collect();
    let permissions = Arc::new(WebsitePermissionEngine::new(None, None, &defaults)?);
    let mut events = EventLoop::new();
    let parent = Arc::new(
        WindowBuilder::new()
            .with_title("Isolated proxy readiness fixture")
            .with_visible(visible)
            .build(&events)?,
    );
    let mut settings = cef_runtime::native_settings(&paths.helper, &paths.resources)?;
    settings.root_cache_path = CefString::from(output.join("profile").to_str().ok_or("profile")?);
    settings.log_file = CefString::from(output.join("cef.log").to_str().ok_or("log")?);
    let wake = events.create_proxy();
    let initialize_started_ms = clock.elapsed().as_secs_f64() * 1000.0;
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
    let initialize_finished_ms = clock.elapsed().as_secs_f64() * 1000.0;
    let bridge =
        unsafe { NativeTlsBridge::from_loaded(if legacy { LEGACY_PATCH_ID } else if http2_revision { HTTP2_PATCH_ID } else { PATCH_ID })? };
    if bridge.supports_same_authority_http2() == legacy {
        return Err("HTTP/2-capable engine required".into());
    }
    let clean = cef::command_line_get_global().is_some_and(|c| {
        [
            "no-sandbox",
            "disable-web-security",
            "ignore-certificate-errors",
            "ignore-certificate-errors-spki-list",
            "allow-insecure-localhost",
            "proxy-server",
        ]
        .into_iter()
        .all(|s| c.has_switch(Some(&CefString::from(s))) == 0)
    });
    let began = Instant::now();
    let mut previous_pump = None;
    let mut pump_intervals = Vec::<f64>::new();
    let mut stage = 0;
    let mut revoked_at = None::<Instant>;
    let mut revoke_baseline = Vec::<usize>::new();
    let mut revoked_navigation_rejected = Vec::<bool>::new();
    let mut sockets_closed_before_browser_close = Vec::<bool>::new();
    let mut failures = Vec::new();
    let mut phase = "pump";
    let mut raw_after_failure = Vec::new();
    let mut before = serde_json::Value::Null;

    events.run_return(|event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(1));
        if !matches!(event, Event::MainEventsCleared) {
            return;
        }
        let step = (|| -> Result {
            let now=clock.elapsed().as_secs_f64()*1000.0;
            if let Some(previous)=previous_pump {pump_intervals.push(now-previous);}
            previous_pump=Some(now);
            phase="runtime-work";runtime.work()?;
            phase="tls-pump";cef_tls_bridge::pump_tls()?;
            for slot in &slots {
                let pending={let mut q=slot.tls_owner.pending.lock().unwrap(); std::mem::take(&mut *q)};
                for (e,c,queued) in pending {
                    if std::env::var("SORNG_CEF_HTTP2_CHECK").as_deref()==Ok("delay") && queued.elapsed()<Duration::from_millis(300) {
                        slot.tls_owner.pending.lock().unwrap().push((e,c,queued)); continue;
                    }
                    let current=slot.tls_owner.current.load(Ordering::Acquire) && slot.session.lock().unwrap().status()!=sorng_protocols::origin_browser::BrowserSessionStatus::Revoked;
                    let exact=std::env::var("SORNG_CEF_HTTP2_CHECK").as_deref()!=Ok("deny") && current && e.hostname=="proxy-first.fixture.test" && e.port==443 && e.origin==ORIGIN && e.ca_mode==NativeTlsCaMode::CustomOnly && e.native_error==0 && e.certificate_status==0 && !e.fatal_error && e.peer_chain.first()==Some(&leaf_der);
                    if !exact {slot.tls_owner.denied.fetch_add(1,Ordering::Relaxed);}
                    if exact {slot.tls_owner.admitted.store(true,Ordering::Release);}
                    c.complete(if exact {NativeTlsDecision::AdmitNative}else{NativeTlsDecision::Deny});
                }
            }
            for slot in &mut slots {
                if slot.context.is_none()
                    && slot.host.is_none()
                    && runtime.network_policy_configured()?
                {
                    phase="context-create";slot.context = Some(unsafe {
                        PrivateRequestContext::create_with_tls_capabilities(
                            slot.session.clone(),slot.identity.clone(),permissions.clone(),&bridge,
                            &NativeTlsConfig{ca_mode:NativeTlsCaMode::CustomOnly,trust_anchors:vec![root_der.clone()],require_scoped_exceptions:false},
                            slot.tls_owner.clone(),sorng_browser_host::native_capabilities::NativeBrowserCapabilities::default(),
                        )?
                    })
                }
                if let Some(c) = &slot.context {
                    if matches!(
                        c.status(),
                        PreparationStatus::Failed(_) | PreparationStatus::Revoked
                    ) {
                        return Err("private context failed".into());
                    }
                    if c.status() == PreparationStatus::ProxyConfigured {
                        slot.proxy_application_verified = c.proxy_application_verified();
                        slot.proxy_before_host = serde_json::json!(slot.session.lock().unwrap().proxy_diagnostics());
                        slot.proxy_before_host["upstreamDials"] = serde_json::json!(slot.dials.load(Ordering::Relaxed));
                        if !legacy && !http2_revision && !slot.proxy_application_verified {
                            return Err("proxy application proof missing before host creation".into());
                        }
                        if !c.tls_hooks_installed() {return Err("TLS installation unacknowledged".into());}
                        phase="host-create";slot.host = Some(unsafe {
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
                    phase="features-ready";if !slot.navigated && host.features_ready(&slot.identity)? {
                        let mut owner = slot.session.lock().unwrap();
                        let ready = NativeHostReadiness::Ready {
                            profile_key: owner.policy().profile_key().into(),
                            proxy_endpoint: owner.proxy_endpoint(),
                        };
                        owner.report_host(&slot.identity, ready)?;
                        drop(owner);
                        slot.navigation_ms=clock.elapsed().as_secs_f64()*1000.0;
                        phase="initial-navigate";host.navigate(&slot.identity, &format!("{ORIGIN}/case-0"))?;
                        if visible {host.show(&slot.identity)?;}
                        slot.navigated = true;
                    }
                }
            }
            if revoke_check() && revoked_at.is_none() && slots.iter().all(|s|s.requests.lock().unwrap().iter().any(|r|r["path"].as_str().is_some_and(|p|p.starts_with("/pulse")))) {
                for s in &slots {
                    revoke_baseline.push(s.requests.lock().unwrap().len());
                    s.tls_owner.current.store(false,Ordering::Release);
                    s.session.lock().unwrap().revoke(&s.identity)?;
                    revoked_navigation_rejected.push(s.host.as_ref().unwrap().navigate(&s.identity,&format!("{ORIGIN}/pulse")).is_err());
                }
                phase="tls-pump";cef_tls_bridge::pump_tls()?;
                revoked_at=Some(Instant::now());
            }
            if revoked_at.is_some_and(|t|t.elapsed()>Duration::from_millis(750)) {sockets_closed_before_browser_close=slots.iter().map(|s|s.tls_owner.closed_connections.load(Ordering::Relaxed)>0).collect();stage=CASES.len();}
            if websocket_check() && slots.iter().all(|s|s.requests.lock().unwrap().iter().any(|r|r["path"]=="/wss-ok")) {stage=CASES.len();}
            if !revoke_check() && !websocket_check() && stage<CASES.len() && slots.iter().enumerate().all(|(i,s)|{let o=s.sink.0.lock().unwrap();o.loaded&&o.title==format!("marker-{i}-/case-{stage}")}) {
                for slot in &mut slots {
                    let o=slot.sink.0.lock().unwrap();
                    let request_rows=slot.requests.lock().unwrap().iter().filter(|r| r["case"].as_u64()==Some(stage as u64)).cloned().collect::<Vec<_>>();
                    slot.reports.push(serde_json::json!({"case":stage,"resources":CASES[stage].resources,"responseDelayMs":CASES[stage].response_ms,"dialDelayMs":CASES[stage].dial_ms,"navigationMs":slot.navigation_ms,"completedMs":o.completed_ms,"loadMs":o.completed_ms.map(|m|m-slot.navigation_ms),"requestPeak":slot.counters[stage].peak.load(Ordering::Relaxed),"dialPeak":slot.counters[stage].dial_peak.load(Ordering::Relaxed),"requests":request_rows,"diagnostics":slot.session.lock().unwrap().proxy_diagnostics()}));
                }
                if stage==0 {before=serde_json::json!(slots.iter().map(|s|s.session.lock().unwrap().proxy_diagnostics()).collect::<Vec<_>>());}
                stage+=1;
                if stage<CASES.len() {for slot in &mut slots {
                    slot.current_case.store(stage,Ordering::Relaxed);
                    {let mut o=slot.sink.0.lock().unwrap();o.loaded=false;o.completed_ms=None;}
                    slot.navigation_ms=clock.elapsed().as_secs_f64()*1000.0;
                    slot.host.as_ref().unwrap().navigate(&slot.identity,&format!("{ORIGIN}/case-{stage}"))?;
                }}
            }
            if std::env::var("SORNG_CEF_HTTP2_CHECK").as_deref()==Ok("deny") && began.elapsed()>Duration::from_millis(500) && slots.iter().all(|s|s.tls_owner.denied.load(Ordering::Relaxed)>0) {
                stage=CASES.len();
            }
            if began.elapsed() > Duration::from_secs(35) && stage < CASES.len() {
                for slot in &slots {
                    let endpoint = slot.session.lock().unwrap().proxy_endpoint();
                    raw_after_failure.push(
                        asynchronous
                            .block_on(async {
                                tokio::time::timeout(
                                    Duration::from_secs(1),
                                    tokio::net::TcpStream::connect(endpoint),
                                )
                                .await
                            })
                            .is_ok_and(|result| result.is_ok()),
                    );
                }
                failures.push("first-navigation or survivor deadline".into());
                stage = CASES.len();
            }
            if stage == CASES.len() {
                for s in &mut slots {
                    if !s.close_sent {
                        if let Some(host) = &s.host {
                            s.tls_owner.current.store(false,Ordering::Release);
                            s.session.lock().unwrap().revoke(&s.identity)?;
                            host.close(&s.identity)?;
                            s.close_sent = true;
                        }
                    }
                }
                if slots.iter().all(|s| {
                    s.host
                        .as_ref()
                        .is_some_and(|h| h.lifecycle() == Lifecycle::Closed)
                }) {
                    *flow = ControlFlow::Exit;
                }
            }
            if began.elapsed() > Duration::from_secs(45) {
                return Err("close deadline".into());
            }
            Ok(())
        })();
        if let Err(e) = step {
            failures.push(format!("{phase}: {e}"));
            *flow = ControlFlow::Exit;
        }
    });
    let closed = slots.iter().all(|s| {
        s.host
            .as_ref()
            .is_some_and(|h| h.lifecycle() == Lifecycle::Closed)
    });
    let rows:Vec<_>=slots.iter().map(|s|{let o=s.sink.0.lock().unwrap();serde_json::json!({"proxyApplicationVerified":s.proxy_application_verified,"proxyBeforeHost":s.proxy_before_host,"sessionStatus":format!("{:?}",s.session.lock().unwrap().status()),"sessionFailure":format!("{:?}",s.session.lock().unwrap().failure_reason()),"tlsCurrent":s.tls_owner.current.load(Ordering::Relaxed),"alpnObserved":*s.alpn_observed.lock().unwrap(),"beforeAdmissionBytes":s.tls_owner.before_admission_bytes.load(Ordering::Relaxed),"denied":s.tls_owner.denied.load(Ordering::Relaxed),"dials":s.dials.load(Ordering::Relaxed),"requests":*s.requests.lock().unwrap(),"cases":s.reports,"title":o.title,"nativeStates":o.native_states,"featureStates":o.feature_states,"errors":o.errors,"diagnostics":s.session.lock().unwrap().proxy_diagnostics()})}).collect();
    let endpoints: Vec<_> = slots
        .iter()
        .map(|s| s.session.lock().unwrap().proxy_endpoint().to_string())
        .collect();
    pump_intervals.sort_by(f64::total_cmp);
    let pump_summary = serde_json::json!({"samples":pump_intervals.len(),"medianMs":pump_intervals.get(pump_intervals.len()/2),"p95Ms":pump_intervals.get(pump_intervals.len()*95/100),"maxMs":pump_intervals.last()});
    let mut report = serde_json::json!({"probeKind":KIND,"runId":run_id,"ok":false,"clean":clean,"closed":closed,"rawTcpBefore":raw_before,"rawTcpAfterFailure":raw_after_failure,"ownedLoopbackEndpoints":endpoints,"baselineBeforeCef":baseline,"first":before,"initializeStartedMs":initialize_started_ms,"initializeFinishedMs":initialize_finished_ms,"matrixCases":CASES.len(),"productionTlsFactory":true,"fixtureTcpNoDelay":fixture_nodelay,"parentVisible":visible,"childShowRequested":visible,"advertisedAlpn":["h2","http/1.1"],"pumpIntervals":pump_summary,"slots":rows,"failures":failures,"productionReady":false});
    if !closed {
        std::fs::write(
            output.join("native-report.json"),
            serde_json::to_vec_pretty(&report)?,
        )?;
        std::process::exit(3)
    }
    for s in &mut slots {
        drop(s.host.take());
        drop(s.context.take());
        asynchronous.block_on(s.session.lock().unwrap().stop())?;
        if let Some(stop) = s.stop.take() {
            let _ = stop.send(());
        }
        if let Some(server) = s.server.take() {
            asynchronous.block_on(server)??;
        }
    }
    let proxy_boundary_port = slots[0].session.lock().unwrap().proxy_endpoint().port();
    let proxy_boundary = if !legacy && !http2_revision {
        match proxy_ack_fixture::run(&mut || {
            registry_retirement_fixture::pump(&runtime, &mut events)
        }, proxy_boundary_port) {
            Ok(value) => value,
            Err(error) => {
                failures.push(format!("proxy-boundary: {error}"));
                serde_json::json!({"ok":false})
            }
        }
    } else {
        serde_json::json!({"required":false,"reason":"legacy-runtime-no-proxy-ack"})
    };
    let retirement = if bridge.patch_id() == PATCH_ID {
        match registry_retirement_fixture::run(&mut || registry_retirement_fixture::pump(&runtime, &mut events), &root_der) {
            Ok(value) => value,
            Err(error) => { failures.push(format!("registry-retirement: {error}")); serde_json::json!({"ok":false}) }
        }
    } else { serde_json::json!({"required":false}) };
    report["registrationRetirementCases"] = retirement;
    report["proxyBoundaryCases"] = proxy_boundary;
    report["failures"] = serde_json::json!(failures);
    // Preserve completed assertions if an engine shutdown invariant aborts.
    // The final receipt still requires shutdownComplete and a clean process exit.
    std::fs::write(output.join("native-report.json"), serde_json::to_vec_pretty(&report)?)?;
    drop(bridge);
    unsafe {
        runtime.shutdown()?;
        sorng_browser_host::cef_tls_bridge::after_cef_shutdown();
        proxy_ack_fixture::after_shutdown();
        registry_retirement_fixture::after_shutdown();
    }
    let counts = report["first"].as_array().is_some_and(|rows| {
        rows.len() == 2
            && rows.iter().all(|r| {
                r["acceptedConnections"].as_u64().unwrap_or(0) > 0
                    && r["authenticatedRequests"].as_u64().unwrap_or(0) > 0
                    && r["upstreamFailures"] == 0
            })
    });
    let proxy_ack_clean = legacy || http2_revision || slots.iter().enumerate().all(|(index, slot)| {
        // Chromium may start background jobs before a browser exists. They
        // must stop at unauthenticated 407s, never reach the route dialer.
        let delta = |field: &str| slot.proxy_before_host[field].as_u64()
            .zip(baseline[index][field].as_u64())
            .and_then(|(current, before)| current.checked_sub(before));
        slot.proxy_application_verified
            && delta("acceptedConnections").is_some()
            && delta("acceptedConnections") == delta("authenticationChallenges")
            && slot.proxy_before_host["authenticatedRequests"] == baseline[index]["authenticatedRequests"]
            && slot.proxy_before_host["upstreamDials"] == 0
            && slot.proxy_before_host["upstreamFailures"] == 0
            && delta("requestRejections") == Some(0)
            && delta("capacityRefusals") == Some(0)
    });
    report["proxyProofRequired"] = (!legacy && !http2_revision).into();
    report["proxyAckNoApplicationNetwork"] = proxy_ack_clean.into();
    report["preHostUnauthenticatedConnections"] = serde_json::json!(slots.iter().enumerate().map(|(index, slot)| {
        slot.proxy_before_host["acceptedConnections"].as_u64()
            .zip(baseline[index]["acceptedConnections"].as_u64())
            .and_then(|(current, before)| current.checked_sub(before))
    }).collect::<Vec<_>>());
    report["ok"] = (proxy_ack_clean && failures.is_empty()
        && clean
        && closed
        && stage == CASES.len()
        && counts
        && slots
            .iter()
            .all(|s| s.tls_owner.before_admission_bytes.load(Ordering::Relaxed) == 0)
        && slots.iter().all(|s| {
            s.alpn_observed.lock().unwrap().iter().all(|v| {
                v == if legacy || h1_only() {
                    "http/1.1"
                } else {
                    "h2"
                }
            }) && s.reports.iter().any(|r| {
                r["resources"] == 32
                    && r["responseDelayMs"] == 80
                    && if legacy || h1_only() {
                        r["requestPeak"].as_u64().unwrap_or(0) <= 6
                    } else {
                        r["requestPeak"].as_u64().unwrap_or(0) > 6
                    }
            })
        })
        && (!cross_authority()
            || slots.iter().all(|s| {
                s.tls_owner.denied.load(Ordering::Relaxed) > 0
                    && s.requests
                        .lock()
                        .unwrap()
                        .iter()
                        .all(|r| r["authority"] != "alternate.fixture.test")
            }))
        && slots.iter().all(|s| s.reports.len() == CASES.len())
        && slots
            .iter()
            .all(|s| s.sink.0.lock().unwrap().errors.is_empty()))
    .into();
    if std::env::var("SORNG_CEF_HTTP2_CHECK").as_deref() == Ok("deny") {
        report["ok"] = (failures.is_empty()
            && clean
            && closed
            && slots.iter().all(|s| {
                s.tls_owner.denied.load(Ordering::Relaxed) > 0
                    && s.tls_owner.before_admission_bytes.load(Ordering::Relaxed) == 0
                    && s.requests.lock().unwrap().is_empty()
            }))
        .into();
    }
    if revoke_check() {
        report["ok"] = (failures.is_empty()
            && clean
            && closed
            && revoke_baseline.len() == 2
            && sockets_closed_before_browser_close.len() == 2
            && sockets_closed_before_browser_close.iter().all(|v| *v)
            && revoked_navigation_rejected.iter().all(|v| *v)
            && slots.iter().enumerate().all(|(i, s)| {
                s.requests.lock().unwrap().len() == revoke_baseline[i]
                    && s.tls_owner.before_admission_bytes.load(Ordering::Relaxed) == 0
            }))
        .into();
        report["socketsClosedBeforeBrowserClose"] =
            serde_json::json!(sockets_closed_before_browser_close);
        report["revokeBaselineRequests"] = serde_json::json!(revoke_baseline);
        report["revokedNavigationRejected"] = serde_json::json!(revoked_navigation_rejected);
    }
    if websocket_check() {
        report["ok"] = (failures.is_empty()
            && clean
            && closed
            && slots.iter().all(|s| {
                let rows = s.requests.lock().unwrap();
                s.tls_owner.before_admission_bytes.load(Ordering::Relaxed) == 0
                    && rows
                        .iter()
                        .any(|r| r["websocket"] == true && r["alpn"] == "http/1.1")
                    && rows
                        .iter()
                        .any(|r| r["path"] == "/wss-ok" && r["alpn"] == "h2")
            }))
        .into();
    }
    report["advertisedAlpn"] = serde_json::json!(if h1_only() {
        vec!["http/1.1"]
    } else {
        vec!["h2", "http/1.1"]
    });
    report["check"] = serde_json::json!(
        std::env::var("SORNG_CEF_HTTP2_CHECK").unwrap_or_else(|_| "multiplex".into())
    );
    report["expectedProtocol"] = serde_json::json!(if legacy || h1_only() {
        "http/1.1"
    } else {
        "h2"
    });
    report["shutdownComplete"] = true.into();
    std::fs::write(
        output.join("native-report.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    if report["ok"] == true {
        Ok(())
    } else {
        Err("proxy readiness fixture failed".into())
    }
}
