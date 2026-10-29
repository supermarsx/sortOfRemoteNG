//! t-mitmproxy M3: real-engine acceptance of the intercepting proxy.
//!
//! The published patched engine (no rebuild) loads pages through
//! `OriginBrowserSession::start_intercepting`. Each attempt gets a fresh
//! in-memory `InterceptAuthority`; its anchor is the only trust anchor of a
//! `CUSTOM_ONLY` private context, and the TLS hook admits natively only the
//! leaf that authority minted (the app's fast path). Upstream origins are
//! loopback fixtures: a "public" one whose leaf chains to a disposable root
//! known only to this fixture's `UpstreamTrust` policy, and a self-signed one
//! the policy reviews and denies. The proxy disk cache is shared by two
//! successive attempts of one synthetic connection (context restart).
//!
//! The platform verifier that decides `system_ca_valid` has no public seam
//! (its test constructor is `cfg(test)` inside sorng-protocols), so the
//! disposable root is injected into the fixture's trust POLICY instead: the
//! policy admits exactly the public leaf chained to that root. `system_ca_valid`
//! is recorded as observed (false on every runner: the root is not an OS root).
//!
//! No netlog is written: Chromium netlogs carry certificates, and this suite
//! asserts that no CA or leaf reaches the disk.
use cef::{CefString, ImplCommandLine};
use serde_json::{json, Value};
use sorng_browser_host::{
    bootstrap_platform::{BundlePaths, RuntimeBootstrap},
    cef_browser::{BrowserEvent, BrowserEventSink, CefBrowserHost, NativeDocumentHooks},
    cef_context::{PreparationStatus, PrivateRequestContext},
    cef_runtime::{self, CefRuntime},
    cef_tls_bridge::{
        self, NativeTlsBridge, NativeTlsCaMode, NativeTlsCompletion, NativeTlsConfig,
        NativeTlsDecision, NativeTlsEvidence, NativeTlsHooks,
    },
    control::{Lifecycle, ViewportBounds},
    domain_permissions::{WebsitePermissionDecision, WebsitePermissionEngine, WebsiteRequestClass},
    native_features::NativeLoginAdapter,
};
use sorng_protocols::{
    origin_browser::{
        BrowserIdentity, NativeHostReadiness, OriginBrowserPolicy, OriginBrowserSession,
    },
    private_forward_proxy::{
        intercept::{
            CacheMode, DiskCacheConfig, InterceptAuthority, InterceptConfig, UpstreamEvidence,
            UpstreamTrust, UpstreamTrustFuture, UpstreamVerdict,
        },
        Authority, BoxedStream, DialFuture, ProxyLimits, RouteDialer,
    },
};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime},
};
use tao::{
    event::Event,
    event_loop::{ControlFlow, EventLoop},
    platform::run_return::EventLoopExtRunReturn,
    window::{Window, WindowBuilder},
};
use upstream::{PUBLIC_HOST, SELF_SIGNED_HOST};
use zeroize::Zeroizing;

mod caps;
#[cfg(any(target_os = "linux", test))]
#[path = "../../native_acceptance/linux_parent_fixture.rs"]
mod linux_parent_fixture;
mod probe;
mod scan;
mod upstream;

pub(crate) type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

const ORIGIN: &str = "https://intercept.sorng.test";
const SELF_ORIGIN: &str = "https://selfsigned.sorng.test";
const ERROR_TITLE_PREFIX: &str = "Secure connection failed";
const CACHE_MAX_BYTES: u64 = 64 * 1024 * 1024;
/// Plan M3: the per-socket TLS fast path must stay under 5 ms at p95.
const TLS_P95_LIMIT_US: u64 = 5_000;
const TIMING_WARMUP: usize = 5;
const TIMING_SOCKETS: usize = 60;

/// Entry called by the reviewed Windows sandbox bootstrap.
///
/// # Safety
/// The caller must supply the pinned bootstrap's original instance, sandbox and
/// version pointers before starting services, threads or profile access. They
/// must remain valid for this call. This entry catches panics at the C boundary;
/// browser execution must release CEF owners and complete shutdown before return.
#[cfg(windows)]
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

// ---------------------------------------------------------------------------
// Upstream trust policy (the fixture's stand-in for the app adapter).

#[derive(Default)]
struct TrustLog {
    admitted: usize,
    self_signed_reviews: usize,
    other_denials: usize,
    system_ca_valid: usize,
    temporary_ok: usize,
}

struct FixtureTrust {
    public_leaf: Vec<u8>,
    public_root: Vec<u8>,
    log: Mutex<TrustLog>,
}

impl UpstreamTrust for FixtureTrust {
    fn evaluate(&self, e: UpstreamEvidence) -> UpstreamTrustFuture {
        let mut log = self.log.lock().unwrap();
        log.system_ca_valid += usize::from(e.system_ca_valid);
        log.temporary_ok += usize::from(e.temporary_ok);
        let verdict = if e.authority.host() == PUBLIC_HOST
            && e.authority.port() == 443
            && e.chain_der.first() == Some(&self.public_leaf)
            && e.chain_der.iter().any(|der| der == &self.public_root)
        {
            log.admitted += 1;
            UpstreamVerdict::Admit { persistent: true }
        } else if e.authority.host() == SELF_SIGNED_HOST {
            // A changed/unknown self-signed certificate takes the review
            // path in the app; the fixture's reviewer always declines.
            log.self_signed_reviews += 1;
            UpstreamVerdict::Deny
        } else {
            log.other_denials += 1;
            UpstreamVerdict::Deny
        };
        Box::pin(async move { verdict })
    }
}

impl FixtureTrust {
    fn report(&self) -> Value {
        let log = self.log.lock().unwrap();
        json!({"admitted":log.admitted,"selfSignedReviewsDenied":log.self_signed_reviews,
            "otherDenials":log.other_denials,"systemCaValid":log.system_ca_valid,
            "temporaryOk":log.temporary_ok})
    }
}

// ---------------------------------------------------------------------------
// CEF TLS hook: the app's intercepting fast path, instrumented.

#[derive(Default)]
struct TlsObservations {
    evidence: usize,
    admitted: usize,
    denied: usize,
    not_custom_only: usize,
    native_errors: usize,
    failures: usize,
    decision_us: Vec<u64>,
    awaiting: Vec<Instant>,
    delivered_us: Vec<u64>,
    leaves: Vec<Vec<u8>>,
}

impl TlsObservations {
    /// Called right after `pump_tls`: every admission queued since the last
    /// tick has now been delivered to the engine.
    fn delivered(&mut self) {
        for since in std::mem::take(&mut self.awaiting) {
            self.delivered_us.push(since.elapsed().as_micros() as u64);
        }
    }
    fn report(&self) -> Value {
        json!({"evidence":self.evidence,"admitted":self.admitted,"denied":self.denied,
            "notCustomOnly":self.not_custom_only,"nativeErrors":self.native_errors,
            "failures":self.failures,"decisionP95Us":probe::p95(&self.decision_us),
            "deliveredP95Us":probe::p95(&self.delivered_us),"deliveredSamples":self.delivered_us.len(),
            "distinctLeaves":self.leaves.len()})
    }
}

struct Hooks {
    identity: BrowserIdentity,
    current: AtomicBool,
    authority: Arc<InterceptAuthority>,
    tls: Mutex<TlsObservations>,
    title: Mutex<String>,
    load_failures: AtomicUsize,
}

fn fast_path_admits(
    current: bool,
    evidence: &NativeTlsEvidence,
    authority: &InterceptAuthority,
) -> bool {
    current
        && evidence.native_error == 0
        && !evidence.fatal_error
        && evidence.allowed_exception_mask == 0
        && evidence.ca_mode == NativeTlsCaMode::CustomOnly
        && evidence
            .verified_chain
            .last()
            .is_some_and(|anchor| anchor.as_slice() == authority.anchor_der())
        && evidence
            .peer_chain
            .first()
            .is_some_and(|leaf| authority.admits_leaf(&evidence.hostname, evidence.port, leaf))
}

impl NativeTlsHooks for Hooks {
    fn on_evidence(&self, evidence: NativeTlsEvidence, completion: NativeTlsCompletion) {
        let started = Instant::now();
        let admitted = fast_path_admits(
            self.current.load(Ordering::Acquire),
            &evidence,
            &self.authority,
        );
        if admitted {
            completion.complete(NativeTlsDecision::AdmitNative);
        } else {
            drop(completion); // queues denial
        }
        let decided = started.elapsed().as_micros() as u64;
        let mut tls = self.tls.lock().unwrap();
        tls.evidence += 1;
        tls.decision_us.push(decided);
        tls.not_custom_only += usize::from(evidence.ca_mode != NativeTlsCaMode::CustomOnly);
        tls.native_errors += usize::from(evidence.native_error != 0 || evidence.fatal_error);
        if let Some(leaf) = evidence.peer_chain.first() {
            if !tls.leaves.contains(leaf) {
                tls.leaves.push(leaf.clone());
            }
        }
        if admitted {
            tls.admitted += 1;
            tls.awaiting.push(started);
        } else {
            tls.denied += 1;
        }
    }
    fn is_current(&self) -> bool {
        self.current.load(Ordering::Acquire)
    }
    fn on_failure(&self) {
        self.current.store(false, Ordering::Release);
        self.tls.lock().unwrap().failures += 1;
    }
}

impl BrowserEventSink for Hooks {
    fn on_event(&self, event: BrowserEvent) {
        if event.identity != self.identity {
            return;
        }
        if event.state.load_failure.is_some() {
            self.load_failures.fetch_add(1, Ordering::Relaxed);
        }
        *self.title.lock().unwrap() = event.display.title.clone();
    }
}

impl NativeDocumentHooks for Hooks {
    fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}
    fn login_adapter(&self) -> NativeLoginAdapter {
        NativeLoginAdapter::Manual
    }
}

// ---------------------------------------------------------------------------
// One browser attempt = one intercepting session + one CUSTOM_ONLY context.

struct Attempt {
    index: usize,
    identity: BrowserIdentity,
    session: Arc<Mutex<OriginBrowserSession>>,
    hooks: Arc<Hooks>,
    context: Option<PrivateRequestContext>,
    browser: Option<CefBrowserHost<'static>>,
    datagrams_offered: bool,
    datagrams_applied: Option<bool>,
    installed: bool,
    navigated: bool,
    closed: bool,
    stopped: bool,
}

struct Shared {
    dialer: Arc<dyn RouteDialer>,
    trust: Arc<FixtureTrust>,
    cache_directory: PathBuf,
    cache_key: [u8; 32],
    cache_binding: [u8; 32],
    permissions: Arc<WebsitePermissionEngine>,
}

impl Attempt {
    fn start(
        index: usize,
        shared: &Shared,
        asynchronous: &tokio::runtime::Runtime,
    ) -> Result<Self> {
        // Same database/connection for every attempt; each is a fresh attempt.
        let policy = OriginBrowserPolicy::new_with_allowed_origins(
            "intercept-fixture",
            "intercept-connection",
            "intercept-session",
            ORIGIN,
            &[SELF_ORIGIN],
        )?;
        let identity = policy.identity().clone();
        let authority = InterceptAuthority::generate()?;
        let config = InterceptConfig {
            authority: authority.clone(),
            trust: shared.trust.clone(),
            cache: CacheMode::Disk(DiskCacheConfig {
                directory: shared.cache_directory.clone(),
                max_bytes: CACHE_MAX_BYTES,
                key: Zeroizing::new(shared.cache_key),
                binding: shared.cache_binding,
            }),
            hooks: vec![],
        };
        let session = asynchronous.block_on(OriginBrowserSession::start_intercepting(
            policy,
            shared.dialer.clone(),
            ProxyLimits::default(),
            config,
        ))?;
        let same = session
            .intercept_authority()
            .is_some_and(|a| Arc::ptr_eq(&a, &authority));
        if !same {
            return Err("intercepting session does not expose its attempt CA".into());
        }
        let datagrams_offered = session.supports_datagrams();
        Ok(Self {
            index,
            identity: identity.clone(),
            session: Arc::new(Mutex::new(session)),
            hooks: Arc::new(Hooks {
                identity,
                current: AtomicBool::new(true),
                authority,
                tls: Mutex::new(TlsObservations::default()),
                title: Mutex::new(String::new()),
                load_failures: AtomicUsize::new(0),
            }),
            context: None,
            browser: None,
            datagrams_offered,
            datagrams_applied: None,
            installed: false,
            navigated: false,
            closed: false,
            stopped: false,
        })
    }

    fn anchor(&self) -> Vec<u8> {
        self.hooks.authority.anchor_der().to_vec()
    }

    /// Context, browser, readiness, then the first navigation.
    fn advance(
        &mut self,
        runtime: &CefRuntime<'_>,
        bridge: &NativeTlsBridge,
        parent: &Arc<Window>,
        shared: &Shared,
    ) -> Result<bool> {
        if self.context.is_none() && self.browser.is_none() {
            if !runtime.network_policy_configured()? {
                return Ok(false);
            }
            let config = NativeTlsConfig {
                ca_mode: NativeTlsCaMode::CustomOnly,
                trust_anchors: vec![self.anchor()],
                require_scoped_exceptions: bridge.supports_scoped_exceptions(),
            };
            self.context = Some(unsafe {
                PrivateRequestContext::create_with_tls(
                    self.session.clone(),
                    self.identity.clone(),
                    shared.permissions.clone(),
                    bridge,
                    &config,
                    self.hooks.clone(),
                )?
            });
        }
        if let Some(context) = &self.context {
            match context.status() {
                PreparationStatus::Failed(_) | PreparationStatus::Revoked => {
                    return Err("intercepting CUSTOM_ONLY context preparation failed".into())
                }
                PreparationStatus::ProxyConfigured => {
                    self.installed = context.tls_hooks_installed();
                    if !self.installed {
                        return Err("native TLS installation unacknowledged".into());
                    }
                    self.datagrams_applied = Some(context.datagram_application_verified());
                    self.browser = Some(unsafe {
                        CefBrowserHost::create_owned_engineering_probe(
                            parent.clone(),
                            self.context.take().unwrap(),
                            self.session.clone(),
                            self.identity.clone(),
                            ViewportBounds::new(0., 0., 800., 600.)?,
                            parent.scale_factor(),
                            self.hooks.clone(),
                            Some(self.hooks.clone()),
                        )?
                    });
                }
                _ => {}
            }
        }
        if let Some(browser) = &self.browser {
            if !self.navigated && browser.features_ready(&self.identity)? {
                {
                    let mut session = self.session.lock().unwrap();
                    let ready = NativeHostReadiness::Ready {
                        profile_key: session.policy().profile_key().into(),
                        proxy_endpoint: session.proxy_endpoint(),
                    };
                    session.report_host(&self.identity, ready)?;
                }
                browser.zoom(&self.identity, 100.0)?;
                browser.navigate(&self.identity, &format!("{ORIGIN}/?attempt={}", self.index))?;
                self.navigated = true;
            }
        }
        Ok(self.navigated)
    }

    fn report(&self) -> Value {
        json!({"index":self.index,"datagramsOffered":self.datagrams_offered,
            "datagramsApplied":self.datagrams_applied,"tlsInstalled":self.installed,
            "navigated":self.navigated,"closed":self.closed,"relayStopped":self.stopped,
            "loadFailures":self.hooks.load_failures.load(Ordering::Relaxed),
            "tls":self.hooks.tls.lock().unwrap().report()})
    }
}

/// Runs the CEF loop until `step` returns true, an error, or `limit`.
fn pump(
    events: &mut EventLoop<()>,
    runtime: &CefRuntime<'_>,
    hooks: &[Arc<Hooks>],
    limit: Duration,
    what: &str,
    mut step: impl FnMut() -> Result<bool>,
) -> Result {
    let started = Instant::now();
    let mut result = Ok(());
    events.run_return(|event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(2));
        if !matches!(event, Event::MainEventsCleared) {
            return;
        }
        let tick = (|| -> Result<bool> {
            runtime.work()?;
            cef_tls_bridge::pump_tls()?;
            for hook in hooks {
                hook.tls.lock().unwrap().delivered();
            }
            if started.elapsed() > limit {
                return Err(format!("{what}: deadline").into());
            }
            step()
        })();
        match tick {
            Ok(true) => *flow = ControlFlow::Exit,
            Ok(false) => {}
            Err(error) => {
                result = Err(error);
                *flow = ControlFlow::Exit;
            }
        }
    });
    result
}

/// Revoke while the renderer exists, wait for OnBeforeClose, drop native
/// owners, stop the relay. Never returns with a live browser on success.
fn close(
    attempt: &mut Attempt,
    events: &mut EventLoop<()>,
    runtime: &CefRuntime<'_>,
    asynchronous: &tokio::runtime::Runtime,
) -> Result {
    if attempt.stopped {
        return Ok(());
    }
    {
        let mut session = attempt.session.lock().unwrap();
        let _ = session.revoke(&attempt.identity);
    }
    attempt.hooks.current.store(false, Ordering::Release);
    let mut close_sent = false;
    let hooks = [attempt.hooks.clone()];
    let browser = attempt.browser.as_ref();
    pump(
        events,
        runtime,
        &hooks,
        Duration::from_secs(15),
        "close",
        || {
            let Some(browser) = browser else {
                return Ok(true);
            };
            if !close_sent {
                if browser.lifecycle() != Lifecycle::Closed {
                    browser.close(&attempt.identity)?;
                }
                close_sent = true;
            }
            Ok(browser.lifecycle() == Lifecycle::Closed)
        },
    )?;
    attempt.closed = true;
    drop(attempt.browser.take());
    drop(attempt.context.take());
    cef_tls_bridge::pump_tls()?;
    asynchronous.block_on(attempt.session.lock().unwrap().stop())?;
    attempt.stopped = true;
    Ok(())
}

/// Maps exactly the two fixture authorities to their loopback listeners.
fn fixture_dialer(
    public: std::net::SocketAddr,
    self_signed: std::net::SocketAddr,
    unexpected: Arc<AtomicUsize>,
    dials: Arc<AtomicUsize>,
) -> Arc<dyn RouteDialer> {
    Arc::new(move |authority: Authority| -> DialFuture {
        let target = match (authority.host(), authority.port()) {
            (PUBLIC_HOST, 443) => Some(public),
            (SELF_SIGNED_HOST, 443) => Some(self_signed),
            _ => None,
        };
        dials.fetch_add(1, Ordering::Relaxed);
        if target.is_none() {
            unexpected.fetch_add(1, Ordering::Relaxed);
        }
        Box::pin(async move {
            let target = target.ok_or_else(|| std::io::Error::other("fixture-only route"))?;
            Ok(Box::new(tokio::net::TcpStream::connect(target).await?) as BoxedStream)
        })
    })
}

fn count_files(directory: &Path) -> usize {
    std::fs::read_dir(directory)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| match entry.file_type() {
                    Ok(kind) if kind.is_dir() => count_files(&entry.path()),
                    Ok(kind) if kind.is_file() => 1,
                    _ => 0,
                })
                .sum()
        })
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------

pub fn run(bootstrap: &mut dyn RuntimeBootstrap, paths: &BundlePaths) -> i32 {
    match execute(bootstrap, paths) {
        Ok(()) => 0,
        Err(error) => {
            if let Some(dir) = std::env::var_os("SORNG_CEF_ACCEPTANCE_OUTPUT") {
                let _ = std::fs::write(PathBuf::from(dir).join("error.txt"), error.to_string());
            }
            eprintln!("native intercept fixture: {error}");
            1
        }
    }
}

struct Evidence {
    attempts: Vec<Attempt>,
    anchors: Vec<Vec<u8>>,
    probe_leaves: Vec<Vec<u8>>,
    timing: Option<probe::Timing>,
    denied: Option<probe::Fetched>,
    self_signed_title: Option<String>,
    cache_files_after_first: usize,
}

#[allow(clippy::too_many_arguments)]
fn cases(
    runtime: &CefRuntime<'_>,
    bridge: &NativeTlsBridge,
    shared: &Shared,
    ledger: &upstream::SharedLedger,
    asynchronous: &tokio::runtime::Runtime,
    events: &mut EventLoop<()>,
    parent: &Arc<Window>,
    evidence: &mut Evidence,
) -> Result {
    for index in 1..=2usize {
        evidence
            .attempts
            .push(Attempt::start(index, shared, asynchronous)?);
        let attempt = evidence.attempts.last_mut().unwrap();
        evidence.anchors.push(attempt.anchor());
        if index == 1 {
            // Proxy-side timing and the denied upstream, outside CEF.
            let (endpoint, credentials) = {
                let session = attempt.session.lock().unwrap();
                let credentials = session
                    .with_proxy_credentials(probe::Credentials::new)
                    .ok_or("proxy credentials unavailable")?;
                (session.proxy_endpoint(), credentials)
            };
            let timing = asynchronous.block_on(probe::timing(
                endpoint,
                &credentials,
                PUBLIC_HOST,
                &attempt.hooks.authority,
                TIMING_WARMUP,
                TIMING_SOCKETS,
            ))?;
            evidence.probe_leaves.extend(timing.leaves.iter().cloned());
            evidence.timing = Some(timing);
            let denied = asynchronous.block_on(probe::denied(
                endpoint,
                &credentials,
                SELF_SIGNED_HOST,
                &attempt.anchor(),
            ))?;
            evidence.probe_leaves.push(denied.leaf.clone());
            evidence.denied = Some(denied);
        }
        let hooks = [attempt.hooks.clone()];
        pump(
            events,
            runtime,
            &hooks,
            Duration::from_secs(30),
            "attempt start",
            || attempt.advance(runtime, bridge, parent, shared),
        )?;
        pump(
            events,
            runtime,
            &hooks,
            Duration::from_secs(45),
            "page proof",
            || Ok(ledger.lock().unwrap().proofs.len() >= index),
        )?;
        if index == 1 {
            // Responses are stored as their bodies complete: wait for the
            // three cacheable entries before the context restart.
            let entries = shared.cache_directory.join("e");
            pump(
                events,
                runtime,
                &hooks,
                Duration::from_secs(15),
                "proxy cache store",
                || Ok(count_files(&entries) >= 3),
            )?;
            evidence.cache_files_after_first = count_files(&shared.cache_directory);
            // The page's own self-signed origin: review, deny, synthetic 502.
            attempt.hooks.title.lock().unwrap().clear();
            let browser = attempt.browser.as_ref().ok_or("browser missing")?;
            browser.navigate(&attempt.identity, &format!("{SELF_ORIGIN}/"))?;
            let title = &attempt.hooks.title;
            pump(
                events,
                runtime,
                &hooks,
                Duration::from_secs(30),
                "self-signed denial page",
                || Ok(title.lock().unwrap().starts_with(ERROR_TITLE_PREFIX)),
            )?;
            evidence.self_signed_title = Some(title.lock().unwrap().clone());
        }
        close(attempt, events, runtime, asynchronous)?;
    }
    Ok(())
}

fn check(failures: &mut Vec<String>, ok: bool, what: &str) {
    if !ok {
        failures.push(what.to_owned());
    }
}

fn proof_checks(failures: &mut Vec<String>, proofs: &[Value]) {
    for (index, proof) in proofs.iter().enumerate() {
        let n = index + 1;
        let field = |name: &str, key: &str| proof[name][key].as_str().unwrap_or("").to_owned();
        check(
            failures,
            proof["attempt"]
                .as_str()
                .and_then(|a| a.parse::<usize>().ok())
                == Some(n),
            &format!("attempt {n}: proof order"),
        );
        check(
            failures,
            proof["origin"] == ORIGIN,
            &format!("attempt {n}: page origin"),
        );
        check(
            failures,
            proof["protocol"] == "h2",
            &format!("attempt {n}: main document not h2 inside the tunnel"),
        );
        check(
            failures,
            field("maxAge", "protocol") == "h2",
            &format!("attempt {n}: subresource not h2 inside the tunnel"),
        );
        for (name, body) in [
            ("maxAge", "max-age-body"),
            ("noStore", "no-store-body"),
            ("revalidate", "revalidate-body"),
            ("varyA", "vary-a"),
        ] {
            check(
                failures,
                proof[name]["status"] == 200 && field(name, "body") == body,
                &format!("attempt {n}: {name} body"),
            );
        }
        if n == 2 {
            check(
                failures,
                proof["varyB"]["status"] == 200 && field("varyB", "body") == "vary-b",
                "attempt 2: varyB body",
            );
        }
        check(
            failures,
            proof["ws"] == "sorng-intercept-echo",
            &format!("attempt {n}: WebSocket echo"),
        );
        let quic = [
            proof["protocol"].as_str(),
            proof["maxAge"]["protocol"].as_str(),
        ]
        .into_iter()
        .any(|p| p.is_some_and(|p| p.starts_with("h3")));
        check(failures, !quic, &format!("attempt {n}: QUIC used"));
    }
}

fn execute(bootstrap: &mut dyn RuntimeBootstrap, paths: &BundlePaths) -> Result {
    let started_wall = SystemTime::now() - Duration::from_secs(2);
    let output = PathBuf::from(
        std::env::var_os("SORNG_CEF_ACCEPTANCE_OUTPUT").ok_or("disposable output required")?,
    );
    let run_id = std::env::var("SORNG_CEF_ACCEPTANCE_RUN_ID")?;
    if !output.is_absolute()
        || !output.is_dir()
        || std::fs::read_dir(&output)?.next().is_some()
        || run_id.is_empty()
    {
        return Err("fresh absolute output and run ID required".into());
    }
    let asynchronous = tokio::runtime::Runtime::new()?;
    let _entered = asynchronous.enter();
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    // Loopback upstream origins.
    let pki = upstream::Pki::generate()?;
    let ledger: upstream::SharedLedger = Arc::default();
    let public = asynchronous.block_on(upstream::start_public(&pki, ledger.clone()))?;
    let self_signed = asynchronous.block_on(upstream::start_self_signed(&pki, ledger.clone()))?;
    let unexpected_routes = Arc::new(AtomicUsize::new(0));
    let route_dials = Arc::new(AtomicUsize::new(0));
    let dialer = fixture_dialer(
        public.address,
        self_signed.address,
        unexpected_routes.clone(),
        route_dials.clone(),
    );
    let cache_directory = output.join("proxy-cache").join("proxy-v1");
    std::fs::create_dir_all(&cache_directory)?;
    let mut cache_key = [0u8; 32];
    let mut cache_binding = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut cache_key);
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut cache_binding);
    let defaults = [
        "navigation",
        "frame",
        "script",
        "stylesheet",
        "image-media",
        "font",
        "fetch-xhr",
        "websocket",
    ]
    .into_iter()
    .filter_map(|s| WebsiteRequestClass::parse(s).map(|c| (c, WebsitePermissionDecision::Allow)))
    .collect();
    // Interpretation baseline only: the same client, TLS straight to upstream.
    let direct_baseline = asynchronous.block_on(probe::direct_baseline(
        public.address,
        &pki.public_root,
        PUBLIC_HOST,
        TIMING_SOCKETS,
    ))?;
    let shared = Shared {
        dialer,
        trust: Arc::new(FixtureTrust {
            public_leaf: pki.public_leaf.clone(),
            public_root: pki.public_root.clone(),
            log: Mutex::default(),
        }),
        cache_directory: cache_directory.clone(),
        cache_key,
        cache_binding,
        permissions: Arc::new(WebsitePermissionEngine::new(None, None, &defaults)?),
    };

    let mut events = EventLoop::new();
    let parent = Arc::new(
        WindowBuilder::new()
            .with_title("Local intercepting-proxy CEF fixture")
            .with_visible(false)
            .with_inner_size(tao::dpi::LogicalSize::new(800., 600.))
            .build(&events)?,
    );
    #[cfg(target_os = "linux")]
    let linux_parent_readiness = Some(linux_parent_fixture::prepare(parent.as_ref())?);
    #[cfg(not(target_os = "linux"))]
    let linux_parent_readiness: Option<Value> = None;
    let mut settings = cef_runtime::native_settings(&paths.helper, &paths.resources)?;
    settings.root_cache_path =
        CefString::from(output.join("profile").to_str().ok_or("profile path")?);
    settings.log_file = CefString::from(output.join("cef.log").to_str().ok_or("log path")?);
    let proxy = events.create_proxy();
    let runtime = unsafe {
        CefRuntime::initialize(
            bootstrap,
            &settings,
            Arc::new(move || {
                proxy
                    .send_event(())
                    .map_err(|_| cef_runtime::WakeUnavailable)
            }),
            Arc::new(|_| {}),
        )?
    };
    let mut report = json!({"schema":1,"suite":"intercept","engine":"cef","bindingPin":"154.3.0",
        "evidenceKind":"native-cef-local-fixture","runId":run_id,"platform":std::env::consts::OS,
        "arch":std::env::consts::ARCH,"patchId":null,"capabilities":null,"customCa":false,
        "loadedBridgeVerified":false,"securitySwitchesClean":false,"shutdownComplete":false,
        "productionReady":false,"publicProviderAcceptance":false,
        "upstreamVerifierInjection":"policy-only: UpstreamVerifierConfig has no public seam; the disposable root is known to the fixture UpstreamTrust",
        "timingScope":"hook = CEF evidence to pump_tls delivery of the fast-path admission; proxy = TCP accept to admits_leaf on a raw CONNECT+TLS socket",
        "failures":[]});
    if let Some(evidence) = linux_parent_readiness {
        report["linuxParentReadiness"] = evidence;
    }
    let mut failures: Vec<String> = vec![];
    let bridge = match unsafe { NativeTlsBridge::from_loaded_supported() } {
        Ok(bridge) => bridge,
        Err(error) => {
            failures.push(format!(
                "loaded engine lacks the native TLS bridge: {error}"
            ));
            unsafe {
                runtime.shutdown()?;
                cef_tls_bridge::after_cef_shutdown();
            }
            report["shutdownComplete"] = true.into();
            report["failures"] = json!(failures);
            std::fs::write(
                output.join("native-report.json"),
                serde_json::to_vec_pretty(&report)?,
            )?;
            return Err("loaded engine lacks the native TLS bridge".into());
        }
    };
    report["loadedBridgeVerified"] = true.into();
    report["patchId"] = bridge.patch_id().into();
    let bits = unsafe { caps::loaded_capabilities() };
    let custom_ca = bridge.supports_custom_ca() && bits.is_some_and(|b| b & caps::CUSTOM_CA != 0);
    report["customCa"] = custom_ca.into();
    report["capabilities"] = json!({"bits":bits.map(|b| format!("0x{b:x}")),"names":bits.map(caps::names),
        "supportsCustomCa":bridge.supports_custom_ca(),"supportsScopedExceptions":bridge.supports_scoped_exceptions(),
        "supportsSameAuthorityHttp2":bridge.supports_same_authority_http2(),"supportsHttpDiskCache":bridge.supports_http_disk_cache()});
    println!(
        "intercept-acceptance engine: os={} arch={} patch={} capabilities={} [{}] CUSTOM_CA={}",
        std::env::consts::OS,
        std::env::consts::ARCH,
        bridge.patch_id(),
        bits.map_or("unreadable".into(), |b| format!("0x{b:x}")),
        bits.map(caps::names).unwrap_or_default().join("|"),
        custom_ca
    );
    let security = cef::command_line_get_global().is_some_and(|command| {
        [
            "no-sandbox",
            "disable-web-security",
            "ignore-certificate-errors",
            "ignore-certificate-errors-spki-list",
            "allow-insecure-localhost",
            "disable-site-isolation-trials",
            "user-agent",
        ]
        .iter()
        .all(|s| command.has_switch(Some(&CefString::from(*s))) == 0)
    });
    report["securitySwitchesClean"] = security.into();
    check(
        &mut failures,
        security,
        "forbidden native command-line override",
    );
    check(
        &mut failures,
        custom_ca,
        "loaded engine does not report CUSTOM_CA",
    );

    let mut evidence = Evidence {
        attempts: vec![],
        anchors: vec![],
        probe_leaves: vec![],
        timing: None,
        denied: None,
        self_signed_title: None,
        cache_files_after_first: 0,
    };
    if failures.is_empty() {
        if let Err(error) = cases(
            &runtime,
            &bridge,
            &shared,
            &ledger,
            &asynchronous,
            &mut events,
            &parent,
            &mut evidence,
        ) {
            failures.push(error.to_string());
        }
        // Ordered cleanup of anything a failure left behind.
        for index in 0..evidence.attempts.len() {
            let attempt = &mut evidence.attempts[index];
            if let Err(error) = close(attempt, &mut events, &runtime, &asynchronous) {
                failures.push(format!("ordered cleanup failed: {error}"));
                report["attempts"] = json!(evidence
                    .attempts
                    .iter()
                    .map(Attempt::report)
                    .collect::<Vec<_>>());
                report["failures"] = json!(failures);
                let _ = std::fs::write(
                    output.join("native-report.json"),
                    serde_json::to_vec_pretty(&report)?,
                );
                // No shutdown or unwinding with live native browser refs.
                std::process::exit(3);
            }
        }
    }
    unsafe {
        runtime.shutdown()?;
        cef_tls_bridge::after_cef_shutdown();
    }
    report["shutdownComplete"] = true.into();
    asynchronous.block_on(public.stop())?;
    asynchronous.block_on(self_signed.stop())?;

    // ---- Assertions --------------------------------------------------------
    let ran = evidence.attempts.len() == 2 && evidence.attempts.iter().all(|a| a.stopped);
    let ledger = ledger.lock().unwrap();
    if ran {
        proof_checks(&mut failures, &ledger.proofs);
        check(
            &mut failures,
            ledger.proofs.len() == 2,
            "exactly one page proof per attempt",
        );
        check(
            &mut failures,
            ledger.page == 2,
            "no-store page fetched once per attempt",
        );
        check(
            &mut failures,
            ledger.max_age == 1,
            "max-age not served from the proxy disk cache after the context restart",
        );
        check(
            &mut failures,
            ledger.no_store == 2,
            "no-store response was stored",
        );
        check(
            &mut failures,
            ledger.revalidate_full == 1
                && ledger.revalidate_conditional == 1
                && ledger.revalidate_not_modified == 1,
            "no-cache entry was not revalidated with a 304",
        );
        check(
            &mut failures,
            ledger.vary_a == 1 && ledger.vary_b == 1 && ledger.vary_other == 0,
            "Vary not respected",
        );
        check(
            &mut failures,
            ledger.ws_echoes >= 2,
            "WebSocket echo through the tunnel",
        );
        check(
            &mut failures,
            !ledger.proxy_authorization_leaked,
            "Proxy-Authorization reached upstream",
        );
        check(
            &mut failures,
            ledger.self_signed_handshakes >= 1,
            "self-signed upstream never contacted",
        );
        check(
            &mut failures,
            ledger.self_signed_bytes == 0,
            "denied upstream received request bytes",
        );
        check(
            &mut failures,
            evidence.cache_files_after_first >= 4,
            "proxy disk cache wrote no entries",
        );
        let trust = shared.trust.log.lock().unwrap();
        check(
            &mut failures,
            trust.admitted >= 2,
            "public upstream not admitted by the trust policy",
        );
        check(
            &mut failures,
            trust.self_signed_reviews >= 2,
            "self-signed upstream did not reach the review path from both the probe and CEF",
        );
        check(
            &mut failures,
            trust.other_denials == 0,
            "unexpected upstream evaluated",
        );
        drop(trust);
        check(
            &mut failures,
            unexpected_routes.load(Ordering::Relaxed) == 0,
            "unexpected route dial",
        );
        check(
            &mut failures,
            evidence
                .self_signed_title
                .as_deref()
                .is_some_and(|t| t.starts_with(ERROR_TITLE_PREFIX)),
            "self-signed navigation did not render the synthetic certificate error",
        );
        match &evidence.denied {
            Some(denied) => {
                check(
                    &mut failures,
                    denied.status == 502,
                    "denied upstream: synthetic status is not 502",
                );
                check(
                    &mut failures,
                    denied.upstream_tag.as_deref() == Some("certificate-denied"),
                    "denied upstream: x-sorng-upstream is not certificate-denied",
                );
                check(
                    &mut failures,
                    denied.cache_control.as_deref() == Some("no-store"),
                    "denied upstream: synthetic response is cacheable",
                );
            }
            None => failures.push("denied upstream probe did not run".into()),
        }
        for attempt in &evidence.attempts {
            let n = attempt.index;
            let tls = attempt.hooks.tls.lock().unwrap();
            check(
                &mut failures,
                !attempt.datagrams_offered,
                &format!("attempt {n}: intercepting relay offers datagrams"),
            );
            check(
                &mut failures,
                attempt.datagrams_applied == Some(false),
                &format!("attempt {n}: owned QUIC datagrams configured"),
            );
            check(
                &mut failures,
                tls.evidence >= 1 && tls.admitted == tls.evidence,
                &format!("attempt {n}: CEF TLS evidence not all admitted by the fast path"),
            );
            check(
                &mut failures,
                tls.native_errors == 0 && tls.not_custom_only == 0,
                &format!("attempt {n}: native_error/CA mode"),
            );
            check(
                &mut failures,
                tls.failures == 0,
                &format!("attempt {n}: TLS bridge failure"),
            );
        }
        let mut hook_delivered = vec![];
        let mut hook_decision = vec![];
        for attempt in &evidence.attempts {
            let tls = attempt.hooks.tls.lock().unwrap();
            hook_delivered.extend_from_slice(&tls.delivered_us);
            hook_decision.extend_from_slice(&tls.decision_us);
        }
        let hook_p95 = probe::p95(&hook_delivered);
        check(
            &mut failures,
            hook_p95.is_some_and(|p| p < TLS_P95_LIMIT_US),
            "CEF fast-path admission p95 >= 5 ms",
        );
        let proxy_p95 = evidence
            .timing
            .as_ref()
            .and_then(|t| probe::p95(&t.samples_us));
        check(
            &mut failures,
            proxy_p95.is_some_and(|p| p < TLS_P95_LIMIT_US),
            "proxy accept-to-admit p95 >= 5 ms",
        );
        check(
            &mut failures,
            evidence
                .timing
                .as_ref()
                .is_some_and(|t| t.admitted == TIMING_SOCKETS),
            "raw tunnel leaf not admitted by admits_leaf",
        );
        report["timing"] = json!({"limitUs":TLS_P95_LIMIT_US,
            "hookDeliveredP95Us":hook_p95,"hookDeliveredSamples":hook_delivered.len(),
            "hookDecisionP95Us":probe::p95(&hook_decision),
            "proxyAcceptToAdmitP95Us":proxy_p95,
            "proxySamples":evidence.timing.as_ref().map(|t| t.samples_us.len()),
            "proxyH2":evidence.timing.as_ref().map(|t| t.h2),
            "directTlsBaselineP95Us":probe::p95(&direct_baseline),
            "directTlsBaselineSamples":direct_baseline.len(),
            "cryptoProfile":"aws-lc/ring/rustls opt-level 3 in an otherwise debug build"});
        println!(
            "intercept-acceptance timing: hook p95={:?}us (n={}) proxy accept-to-admit p95={:?}us (n={}) direct TLS baseline p95={:?}us",
            hook_p95,
            hook_delivered.len(),
            proxy_p95,
            evidence.timing.as_ref().map_or(0, |t| t.samples_us.len()),
            probe::p95(&direct_baseline)
        );
    } else if failures.is_empty() {
        failures.push("cases did not complete".into());
    }

    // ---- No CA or leaf on disk ---------------------------------------------
    let mut certificates: Vec<Vec<u8>> = evidence.anchors.clone();
    certificates.extend(evidence.probe_leaves.iter().cloned());
    for attempt in &evidence.attempts {
        certificates.extend(attempt.hooks.tls.lock().unwrap().leaves.iter().cloned());
    }
    let needles = scan::Needles::new(certificates.iter().map(Vec::as_slice));
    let mut on_disk = scan::Scan::default();
    scan::scan(&output, &needles, None, &mut on_disk);
    let mut bundle = scan::Scan::default();
    scan::scan(&paths.root, &needles, Some(started_wall), &mut bundle);
    let mut temp = scan::Scan::default();
    scan::scan(
        &std::env::temp_dir(),
        &needles,
        Some(started_wall),
        &mut temp,
    );
    report["diskScan"] = json!({"certificates":certificates.len(),"needles":needles.len(),
        "output":{"files":on_disk.files,"bytes":on_disk.bytes,"skipped":on_disk.skipped,"hits":on_disk.hits},
        "bundleModified":{"files":bundle.files,"hits":bundle.hits},
        "tempModified":{"files":temp.files,"truncated":temp.truncated,"hits":temp.hits}});
    check(
        &mut failures,
        certificates.len() >= 3,
        "too few minted certificates observed to scan for",
    );
    check(
        &mut failures,
        on_disk.hits.is_empty() && bundle.hits.is_empty() && temp.hits.is_empty(),
        "an attempt CA or minted leaf was found on disk",
    );

    report["upstream"] = ledger.report();
    report["trust"] = shared.trust.report();
    report["routeDials"] = route_dials.load(Ordering::Relaxed).into();
    report["attempts"] = json!(evidence
        .attempts
        .iter()
        .map(Attempt::report)
        .collect::<Vec<_>>());
    report["denied"] = evidence.denied.as_ref().map_or(
        Value::Null,
        |d| json!({"status":d.status,"upstreamTag":d.upstream_tag,"cacheControl":d.cache_control}),
    );
    report["selfSignedErrorPage"] = evidence
        .self_signed_title
        .as_deref()
        .is_some_and(|t| t.starts_with(ERROR_TITLE_PREFIX))
        .into();
    report["cacheFilesAfterFirstAttempt"] = evidence.cache_files_after_first.into();
    report["failures"] = json!(failures);
    report["ok"] = failures.is_empty().into();
    std::fs::write(
        output.join("native-report.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!(
        "intercept-acceptance result: ok={} failures={}",
        failures.is_empty(),
        failures.len()
    );
    for failure in &failures {
        println!("intercept-acceptance failure: {failure}");
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err("intercept acceptance failed; inspect native-report.json".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence(peer: Vec<Vec<u8>>, verified: Vec<Vec<u8>>) -> NativeTlsEvidence {
        NativeTlsEvidence {
            context_token: 1,
            generation: 1,
            challenge: 1,
            hostname: PUBLIC_HOST.into(),
            port: 443,
            origin: ORIGIN.into(),
            native_error: 0,
            certificate_status: 0,
            fatal_error: false,
            issued_by_known_root: false,
            peer_chain: peer,
            verified_chain: verified,
            ca_mode: NativeTlsCaMode::CustomOnly,
            allowed_exception_mask: 0,
        }
    }

    #[test]
    fn fast_path_admits_only_a_minted_leaf_under_the_attempt_anchor() {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let authority = InterceptAuthority::generate().unwrap();
        let foreign = InterceptAuthority::generate().unwrap();
        let anchor = authority.anchor_der().to_vec();
        // Nothing minted yet: no leaf can be admitted.
        let unminted = evidence(vec![vec![1, 2, 3]], vec![vec![1, 2, 3], anchor.clone()]);
        assert!(!fast_path_admits(true, &unminted, &authority));
        let mut foreign_anchor =
            evidence(vec![vec![1]], vec![vec![1], foreign.anchor_der().to_vec()]);
        assert!(!fast_path_admits(true, &foreign_anchor, &authority));
        foreign_anchor.verified_chain.clear();
        assert!(!fast_path_admits(true, &foreign_anchor, &authority));
        let mut errored = evidence(vec![vec![1]], vec![vec![1], anchor.clone()]);
        errored.native_error = -202;
        assert!(!fast_path_admits(true, &errored, &authority));
        let mut system = evidence(vec![vec![1]], vec![vec![1], anchor]);
        system.ca_mode = NativeTlsCaMode::System;
        assert!(!fast_path_admits(true, &system, &authority));
    }

    #[test]
    fn trust_policy_admits_only_the_public_leaf_and_reviews_self_signed() {
        let trust = FixtureTrust {
            public_leaf: vec![1],
            public_root: vec![2],
            log: Mutex::default(),
        };
        let verdict = |host: &str, chain: Vec<Vec<u8>>| {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .build()
                .unwrap();
            runtime.block_on(trust.evaluate(UpstreamEvidence {
                authority: Authority::parse(&format!("{host}:443")).unwrap(),
                chain_der: chain,
                system_ca_valid: false,
                temporary_ok: false,
            }))
        };
        assert_eq!(
            verdict(PUBLIC_HOST, vec![vec![1], vec![2]]),
            UpstreamVerdict::Admit { persistent: true }
        );
        assert_eq!(verdict(PUBLIC_HOST, vec![vec![1]]), UpstreamVerdict::Deny);
        assert_eq!(
            verdict(PUBLIC_HOST, vec![vec![3], vec![2]]),
            UpstreamVerdict::Deny
        );
        assert_eq!(
            verdict(SELF_SIGNED_HOST, vec![vec![1], vec![2]]),
            UpstreamVerdict::Deny
        );
        let log = trust.log.lock().unwrap();
        assert_eq!(
            (log.admitted, log.self_signed_reviews, log.other_denials),
            (1, 1, 2)
        );
    }

    /// The non-CEF half of the suite against the real intercepting proxy:
    /// raw tunnels exercise trust, denial, the disk cache across a session
    /// restart, revalidation and Vary. No engine is loaded.
    #[test]
    fn intercepting_proxy_pipeline_without_cef() {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let root =
            std::env::temp_dir().join(format!("sorng-intercept-pipeline-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let cache_directory = root.join("proxy-v1");
        std::fs::create_dir_all(&cache_directory).unwrap();
        let certificates = runtime.block_on(async {
            let mut certificates: Vec<Vec<u8>> = vec![];
            let pki = upstream::Pki::generate().unwrap();
            let ledger: upstream::SharedLedger = Arc::default();
            let public = upstream::start_public(&pki, ledger.clone()).await.unwrap();
            let self_signed = upstream::start_self_signed(&pki, ledger.clone())
                .await
                .unwrap();
            let unexpected = Arc::new(AtomicUsize::new(0));
            let dialer = fixture_dialer(
                public.address,
                self_signed.address,
                unexpected.clone(),
                Arc::default(),
            );
            let trust = Arc::new(FixtureTrust {
                public_leaf: pki.public_leaf.clone(),
                public_root: pki.public_root.clone(),
                log: Mutex::default(),
            });
            let (key, binding) = ([7u8; 32], [9u8; 32]);
            for attempt in 1..=2 {
                let policy = OriginBrowserPolicy::new_with_allowed_origins(
                    "intercept-fixture",
                    "intercept-connection",
                    "intercept-session",
                    ORIGIN,
                    &[SELF_ORIGIN],
                )
                .unwrap();
                let authority = InterceptAuthority::generate().unwrap();
                let mut session = OriginBrowserSession::start_intercepting(
                    policy,
                    dialer.clone(),
                    ProxyLimits::default(),
                    InterceptConfig {
                        authority: authority.clone(),
                        trust: trust.clone(),
                        cache: CacheMode::Disk(DiskCacheConfig {
                            directory: cache_directory.clone(),
                            max_bytes: CACHE_MAX_BYTES,
                            key: Zeroizing::new(key),
                            binding,
                        }),
                        hooks: vec![],
                    },
                )
                .await
                .unwrap();
                assert!(!session.supports_datagrams());
                let credentials = session
                    .with_proxy_credentials(probe::Credentials::new)
                    .unwrap();
                let endpoint = session.proxy_endpoint();
                let anchor = authority.anchor_der().to_vec();
                certificates.push(anchor.clone());
                if attempt == 1 {
                    let timing =
                        probe::timing(endpoint, &credentials, PUBLIC_HOST, &authority, 1, 5)
                            .await
                            .unwrap();
                    assert_eq!((timing.admitted, timing.samples_us.len()), (5, 5));
                    assert_eq!(timing.h2, 5);
                    eprintln!(
                        "proxy accept-to-admit p95: {:?} us",
                        probe::p95(&timing.samples_us)
                    );
                    let denied = probe::denied(endpoint, &credentials, SELF_SIGNED_HOST, &anchor)
                        .await
                        .unwrap();
                    assert_eq!(denied.status, 502);
                    assert_eq!(denied.upstream_tag.as_deref(), Some("certificate-denied"));
                    assert_eq!(denied.cache_control.as_deref(), Some("no-store"));
                    assert!(authority.admits_leaf(SELF_SIGNED_HOST, 443, &denied.leaf));
                    certificates.push(denied.leaf);
                    certificates.extend(timing.leaves);
                }
                let get = |path: &'static str, extra: &'static str| {
                    probe::get(endpoint, &credentials, PUBLIC_HOST, &anchor, path, extra)
                };
                for path in ["/max-age.txt", "/no-store.txt", "/revalidate.txt"] {
                    assert_eq!(get(path, "").await.unwrap().status, 200, "{path}");
                }
                assert_eq!(
                    get("/vary.txt", "x-sorng-variant: a\r\n")
                        .await
                        .unwrap()
                        .status,
                    200
                );
                if attempt == 2 {
                    assert_eq!(
                        get("/vary.txt", "x-sorng-variant: b\r\n")
                            .await
                            .unwrap()
                            .status,
                        200
                    );
                }
                let entries = cache_directory.join("e");
                for _ in 0..100 {
                    if count_files(&entries) >= 3 {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                assert!(count_files(&entries) >= 3);
                session.stop().await.unwrap();
            }
            public.stop().await.unwrap();
            self_signed.stop().await.unwrap();
            let l = ledger.lock().unwrap();
            assert_eq!(l.max_age, 1, "max-age served from disk after the restart");
            assert_eq!(l.no_store, 2);
            assert_eq!(
                (
                    l.revalidate_full,
                    l.revalidate_conditional,
                    l.revalidate_not_modified
                ),
                (1, 1, 1)
            );
            assert_eq!((l.vary_a, l.vary_b, l.vary_other), (1, 1, 0));
            assert!(l.self_signed_handshakes >= 1);
            assert_eq!(l.self_signed_bytes, 0);
            assert!(!l.proxy_authorization_leaked);
            assert_eq!(unexpected.load(Ordering::Relaxed), 0);
            let log = trust.log.lock().unwrap();
            assert!(log.admitted >= 2 && log.self_signed_reviews >= 1 && log.other_denials == 0);
            drop(log);
            certificates
        });
        // The attempt CAs and minted leaves never reach the cache directory.
        let needles = scan::Needles::new(certificates.iter().map(Vec::as_slice));
        let mut found = scan::Scan::default();
        scan::scan(&root, &needles, None, &mut found);
        assert!(
            certificates.len() >= 4 && found.files >= 4,
            "{} files",
            found.files
        );
        assert!(found.hits.is_empty(), "{:?}", found.hits);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn proof_checks_require_h2_cache_bodies_and_echo() {
        let good = |attempt: &str| {
            let item = |body: &str| json!({"status":200,"body":body,"protocol":"h2"});
            json!({"attempt":attempt,"origin":ORIGIN,"protocol":"h2","maxAge":item("max-age-body"),
                "noStore":item("no-store-body"),"revalidate":item("revalidate-body"),"varyA":item("vary-a"),
                "varyB":item("vary-b"),"ws":"sorng-intercept-echo"})
        };
        let mut failures = vec![];
        proof_checks(&mut failures, &[good("1"), good("2")]);
        assert!(failures.is_empty(), "{failures:?}");
        let mut bad = good("2");
        bad["protocol"] = "http/1.1".into();
        bad["ws"] = "timeout".into();
        proof_checks(&mut failures, &[good("1"), bad]);
        assert_eq!(failures.len(), 2);
    }
}
