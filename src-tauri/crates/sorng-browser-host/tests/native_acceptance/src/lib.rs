//! Opt-in, local-only measurement client. No production readiness grant.
use cef::{rc::Rc, *};
use sorng_browser_host::{
    bootstrap_platform::{BootstrapError, BundlePaths, RuntimeBootstrap},
    cef_browser::{BrowserEvent, BrowserEventSink, CefBrowserHost, NativeDocumentHooks},
    cef_context::{PreparationStatus, PrivateRequestContext},
    cef_runtime::{self, CefRuntime},
    control::{Lifecycle, ViewportBounds},
    domain_permissions::{WebsitePermissionDecision, WebsitePermissionEngine, WebsiteRequestClass},
    native_features::{
        NativeFeatureStatus, NativeLoginAdapter, NativeLoginCredentials, NativeLoginRequest,
    },
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
        atomic::{AtomicUsize, Ordering},
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
#[cfg(windows)]
mod exception_observer;
mod fixture;

#[cfg(windows)]
#[no_mangle]
pub unsafe extern "C" fn RunWinMain(
    instance: cef::sys::HINSTANCE,
    _command_line: *mut u16,
    _show: i32,
    sandbox: *mut std::ffi::c_void,
    version: *const sorng_browser_host::platform::windows::BootstrapVersionInfo,
) -> i32 {
    std::panic::catch_unwind(|| unsafe {
        sorng_browser_host::bootstrap_platform::run_windows_entry(instance, sandbox, version, run)
    })
    .unwrap_or(2)
}

// The only certificate exception is a newly generated local fixture key. The
// production App still supplies all renderer and process handlers/restrictions.
fn install_global_rejecting_proxy(endpoint: &str) -> std::result::Result<(), &'static str> {
    let Some(context) = request_context_get_global_context() else {
        return Err("global-context-missing");
    };
    let name = CefString::from("proxy");
    if context.is_global() != 1 {
        return Err("global-context-not-global");
    }
    if context.has_preference(Some(&name)) != 1 {
        return Err("global-proxy-preference-missing");
    }
    if context.can_set_preference(Some(&name)) != 1 {
        return Err("global-proxy-preference-not-writable");
    }
    let Some(mut dict) = dictionary_value_create() else {
        return Err("global-proxy-dictionary-unavailable");
    };
    for (key, value) in [
        ("mode", "fixed_servers"),
        ("server", endpoint),
        ("bypass_list", "<-loopback>"),
    ] {
        if dict.set_string(Some(&CefString::from(key)), Some(&CefString::from(value))) != 1 {
            return Err("global-proxy-dictionary-write-failed");
        }
    }
    let Some(mut value) = value_create() else {
        return Err("global-proxy-value-unavailable");
    };
    if value.set_dictionary(Some(&mut dict)) != 1 {
        return Err("global-proxy-value-write-failed");
    }
    // The pinned binding's Default is a NULL struct, not writable output.
    let mut error = CefString::from("");
    if context.set_preference(Some(&name), Some(&mut value), Some(&mut error)) != 1 {
        // Local-only diagnostic for a fixed synthetic proxy dictionary. Never
        // used with account, URL, vault or credential-derived preferences.
        if let Some(output) = std::env::var_os("SORNG_CEF_ACCEPTANCE_OUTPUT") {
            let _ = std::fs::write(
                PathBuf::from(output).join("global-proxy-native-error.txt"),
                error.to_string().chars().take(512).collect::<String>(),
            );
        }
        return Err("global-proxy-set-preference-failed");
    }
    if context
        .preference(Some(&name))
        .and_then(|v| v.dictionary())
        .is_some_and(|d| {
            [
                ("mode", "fixed_servers"),
                ("server", endpoint),
                ("bypass_list", "<-loopback>"),
            ]
            .iter()
            .all(|(key, value)| {
                CefString::from(&d.string(Some(&CefString::from(*key)))).to_string() == *value
            })
        })
    {
        Ok(())
    } else {
        Err("global-proxy-readback-mismatch")
    }
}
wrap_browser_process_handler! {
    struct FixtureProcessHandler { inner: BrowserProcessHandler, initialized: Arc<AtomicUsize>, deny_proxy: String }
    impl BrowserProcessHandler {
        fn on_context_initialized(&self) {
            let result = install_global_rejecting_proxy(&self.deny_proxy);
            if let Err(reason) = result {
                if let Some(output) = std::env::var_os("SORNG_CEF_ACCEPTANCE_OUTPUT") {
                    let _ = std::fs::write(PathBuf::from(output).join("global-proxy-failure.txt"), reason);
                }
            }
            self.initialized.store(if result.is_ok() { 2 } else { 3 }, Ordering::Release);
            self.inner.on_context_initialized();
        }
        fn on_schedule_message_pump_work(&self, delay_ms: i64) { self.inner.on_schedule_message_pump_work(delay_ms); }
    }
}
wrap_app! {
    struct FixtureApplication { inner: App, pin: String, netlog: String, initialized: Arc<AtomicUsize>, deny_proxy: String }
    impl App {
        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            self.inner.browser_process_handler().map(|inner| FixtureProcessHandler::new(inner, self.initialized.clone(), self.deny_proxy.clone()))
        }
        fn render_process_handler(&self) -> Option<RenderProcessHandler> { self.inner.render_process_handler() }
        fn on_before_command_line_processing(&self, kind: Option<&CefString>, command: Option<&mut CommandLine>) {
            if let Some(command) = command {
                self.inner.on_before_command_line_processing(kind, Some(command));
                for (key, value) in [("ignore-certificate-errors-spki-list", self.pin.as_str()), ("log-net-log", self.netlog.as_str()),
                    ("host-resolver-rules", cef_runtime::NATIVE_HOST_RESOLVER_RULES)] {
                    command.append_switch_with_value(Some(&CefString::from(key)), Some(&CefString::from(value)));
                }
            }
        }
    }
}
struct FixtureBootstrap<'a> {
    inner: &'a mut dyn RuntimeBootstrap,
    pin: String,
    netlog: String,
    initialized: Arc<AtomicUsize>,
    deny_proxy: String,
}
impl RuntimeBootstrap for FixtureBootstrap<'_> {
    unsafe fn initialize_native(
        &mut self,
        settings: &Settings,
        app: &mut App,
    ) -> Result<(), BootstrapError> {
        let mut wrapped = FixtureApplication::new(
            app.clone(),
            self.pin.clone(),
            self.netlog.clone(),
            self.initialized.clone(),
            self.deny_proxy.clone(),
        );
        unsafe { self.inner.initialize_native(settings, &mut wrapped) }
    }
    unsafe fn shutdown_native(&mut self) -> Result<(), BootstrapError> {
        unsafe { self.inner.shutdown_native() }
    }
}

struct Hooks {
    identity: BrowserIdentity,
    origin: String,
    google: bool,
    observations: Arc<Mutex<fixture::Observations>>,
}

fn proxy_policy_readback(preferences: &impl ImplPreferenceManager) -> serde_json::Value {
    let dictionary = preferences
        .preference(Some(&CefString::from("proxy")))
        .and_then(|value| value.dictionary());
    let matches = |key: &str, expected: &str| {
        dictionary.as_ref().is_some_and(|dict| {
            let key = CefString::from(key);
            dict.get_type(Some(&key)) == ValueType::STRING
                && CefString::from(&dict.string(Some(&key))).to_string() == expected
        })
    };
    // Compare values, never emit unexpected native preference strings.
    serde_json::json!({
        "dictionaryPresent":dictionary.is_some(),
        "exactlyThreeFields":dictionary.as_ref().is_some_and(|dict| dict.size()==3),
        "fixedServers":matches("mode","fixed_servers"),
        "productionRejectingEndpoint":matches("server","http://sorng-unowned-context.invalid:9"),
        "loopbackBypassDisabled":matches("bypass_list","<-loopback>")
    })
}

fn observe_network_policy(
    runtime: &CefRuntime<'_>,
    fixture: &fixture::Fixture,
    phase: &'static str,
) -> std::result::Result<bool, cef_runtime::RuntimeError> {
    let configured = runtime.network_policy_configured();
    let evidence = serde_json::json!({
        "phase":phase,"reader":"production-runtime",
        "configured":configured.as_ref().is_ok_and(|value| *value),
        "readbackFailed":configured.is_err(),
        "system":preference_manager_get_global().map(|preferences| proxy_policy_readback(&preferences)),
        "global":request_context_get_global_context().map(|context| proxy_policy_readback(&context))
    });
    let mut state = fixture.observations.lock().unwrap();
    state.record("native-network-policy", evidence.clone());
    state.network_policy_readback = Some(evidence);
    configured
}
impl BrowserEventSink for Hooks {
    fn on_event(&self, event: BrowserEvent) {
        self.observations.lock().unwrap().record(
            "browser-event",
            serde_json::json!({
                "sequence":event.sequence,"lifecycle":format!("{:?}",event.state.lifecycle),
                "loading":event.state.loading,"fault":format!("{:?}",event.state.fault)
            }),
        );
        self.observations.lock().unwrap().events.push(format!(
            "{}:{:?}:{:?}",
            event.sequence, event.state.lifecycle, event.state.fault
        ));
    }
}
impl NativeDocumentHooks for Hooks {
    fn on_navigation_status(
        &self,
        _: &BrowserIdentity,
        status: sorng_browser_host::cef_browser::NativeNavigationStatus,
    ) {
        self.observations.lock().unwrap().record(
            "native-navigation",
            serde_json::json!({"status":format!("{status:?}")}),
        );
    }
    fn on_main_document(&self, _: &BrowserIdentity, sequence: u64) {
        self.observations
            .lock()
            .unwrap()
            .record("main-document", serde_json::json!({"sequence":sequence}));
    }
    fn login_adapter(&self) -> NativeLoginAdapter {
        if self.google {
            NativeLoginAdapter::Google
        } else {
            NativeLoginAdapter::Generic
        }
    }
    fn on_feature_status(&self, _: &BrowserIdentity, origin: &str, status: NativeFeatureStatus) {
        self.observations.lock().unwrap().record(
            "renderer-feature",
            serde_json::json!({"status":format!("{status:?}"),"bootstrap":origin=="about:blank"}),
        );
        self.observations
            .lock()
            .unwrap()
            .features
            .push(format!("{origin}:{status:?}"));
    }
    fn with_auto_login(
        &self,
        request: &NativeLoginRequest<'_>,
        deliver: &mut dyn FnMut(NativeLoginCredentials<'_>),
    ) {
        if request.identity != &self.identity || request.origin != self.origin {
            return;
        }
        self.observations.lock().unwrap().record(
            "synthetic-login-grant",
            serde_json::json!({"stage":format!("{:?}",request.stage)}),
        );
        self.observations
            .lock()
            .unwrap()
            .grants
            .push(format!("{:?}", request.stage));
        deliver(NativeLoginCredentials {
            identity: &self.identity,
            origin: &self.origin,
            valid_until: Instant::now() + Duration::from_secs(2),
            username: "synthetic@example.test",
            password: "synthetic-local-only",
            auto_submit: true,
        });
    }
}

pub fn run(bootstrap: &mut dyn RuntimeBootstrap, paths: &BundlePaths) -> i32 {
    match execute(bootstrap, paths) {
        Ok(()) => 0,
        Err(error) => {
            if let Some(output) = std::env::var_os("SORNG_CEF_ACCEPTANCE_OUTPUT") {
                let _ = std::fs::write(PathBuf::from(output).join("error.txt"), error.to_string());
            }
            eprintln!("CEF acceptance: {error}");
            1
        }
    }
}
type Result<T, E = Box<dyn std::error::Error>> = std::result::Result<T, E>;
fn execute(bootstrap: &mut dyn RuntimeBootstrap, paths: &BundlePaths) -> Result<()> {
    let output = PathBuf::from(
        std::env::var_os("SORNG_CEF_ACCEPTANCE_OUTPUT")
            .ok_or("explicit disposable output required")?,
    );
    if !output.is_absolute() || !output.is_dir() {
        return Err("absolute existing disposable output required".into());
    }
    if std::fs::read_dir(&output)?.next().is_some() {
        return Err(
            "acceptance requires a fresh empty directory, never an existing profile".into(),
        );
    }
    #[cfg(windows)]
    exception_observer::install_if_enabled(&output)?;
    let async_runtime = tokio::runtime::Runtime::new()?;
    let _entered = async_runtime.enter();
    let fixture = async_runtime.block_on(fixture::Fixture::start(&output))?;
    let initialized = Arc::new(AtomicUsize::new(0));
    let mut provider = FixtureBootstrap {
        inner: bootstrap,
        pin: fixture.pin.clone(),
        netlog: output.join("netlog.json").to_string_lossy().into(),
        initialized: initialized.clone(),
        deny_proxy: format!("http://{}", fixture.deny_proxy),
    };
    let mut events = EventLoop::new();
    let parent = Arc::new(
        WindowBuilder::new()
            .with_title("Local CEF acceptance — synthetic fixtures only")
            .with_inner_size(tao::dpi::LogicalSize::new(800., 600.))
            .build(&events)?,
    );
    let mut settings = cef_runtime::native_settings(&paths.helper, &paths.resources)?;
    settings.root_cache_path =
        CefString::from(output.join("profile").to_str().ok_or("profile path")?);
    settings.log_file = CefString::from(output.join("cef.log").to_str().ok_or("log path")?);
    let wakes = Arc::new(AtomicUsize::new(0));
    let wake_count = wakes.clone();
    let event_proxy = events.create_proxy();
    fixture
        .observations
        .lock()
        .unwrap()
        .record("runtime-initialize-enter", serde_json::json!({}));
    let runtime = unsafe {
        CefRuntime::initialize(
            &mut provider,
            &settings,
            Arc::new(move || {
                wake_count.fetch_add(1, Ordering::Relaxed);
                event_proxy
                    .send_event(())
                    .map_err(|_| cef_runtime::WakeUnavailable)
            }),
            Arc::new(|_| {}),
        )?
    };
    fixture
        .observations
        .lock()
        .unwrap()
        .record("runtime-initialize-return", serde_json::json!({}));
    // Three attempts: generic login and isolation observer at the same origin,
    // then Google-shaped stages served exclusively by our local route dialer.
    let mut failures = Vec::new();
    let native_login_prompt_disabled = command_line_get_global().is_some_and(|command| {
        command.has_switch(Some(&CefString::from("disable-chrome-login-prompt"))) == 1
    });
    fixture.observations.lock().unwrap().record(
        "native-command-line",
        serde_json::json!({
            "disableChromeLoginPrompt":native_login_prompt_disabled
        }),
    );
    if !native_login_prompt_disabled {
        failures.push("native command line missing disable-chrome-login-prompt".into());
    }
    for (name, origin, path, google) in [
        ("generic", "https://fixture.test", "/", false),
        ("isolation", "https://fixture.test", "/isolation", false),
        (
            "google",
            "https://accounts.google.com",
            "/v3/signin/identifier",
            true,
        ),
    ] {
        fixture
            .observations
            .lock()
            .unwrap()
            .record("attempt-enter", serde_json::json!({"attempt":name}));
        let observations = fixture.observations.clone();
        let address = fixture.address;
        let dialer: Arc<dyn RouteDialer> = Arc::new(move |authority: Authority| -> DialFuture {
            let observations = observations.clone();
            Box::pin(async move {
                let allowed = authority.port() == 443
                    && ["fixture.test", "frame.test", "accounts.google.com"]
                        .contains(&authority.host());
                observations.lock().unwrap().dials.push(format!(
                    "{}:{}",
                    authority.host(),
                    authority.port()
                ));
                if !allowed {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "fixture-only route",
                    ));
                }
                observations.lock().unwrap().record(
                    "route-dial",
                    serde_json::json!({"attempt":name,"phase":"begin"}),
                );
                let stream = tokio::net::TcpStream::connect(address).await;
                observations.lock().unwrap().record(
                    "route-dial",
                    serde_json::json!({"attempt":name,"phase":"end","connected":stream.is_ok()}),
                );
                Ok(Box::new(stream?) as BoxedStream)
            })
        });
        let policy = OriginBrowserPolicy::new_with_allowed_origins(
            "acceptance",
            name,
            name,
            origin,
            &["https://frame.test"],
        )?;
        let identity = policy.identity().clone();
        let session = Arc::new(Mutex::new(async_runtime.block_on(
            OriginBrowserSession::start(policy, dialer, ProxyLimits::default()),
        )?));
        fixture.observations.lock().unwrap().attempts.push(serde_json::json!({"attempt":name,"proxyEndpoint":session.lock().unwrap().proxy_endpoint().to_string()}));
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
        .filter_map(|s| {
            WebsiteRequestClass::parse(s).map(|c| (c, WebsitePermissionDecision::Allow))
        })
        .collect();
        let permissions = Arc::new(WebsitePermissionEngine::new(None, None, &defaults)?);
        let mut context: Option<PrivateRequestContext> = None;
        let hooks = Arc::new(Hooks {
            identity: identity.clone(),
            origin: origin.into(),
            google,
            observations: fixture.observations.clone(),
        });
        let mut browser: Option<CefBrowserHost<'static>> = None;
        let started = Instant::now();
        let mut navigated = false;
        let mut closing = None;
        let mut revoked_count = 0;
        let mut closed = false;
        let mut ticks = 0usize;
        let mut due_ticks = 0usize;
        let mut last_preparation = String::new();
        let mut last_snapshot = Instant::now();
        events.run_return(|event, _, flow| {
            *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(5));
            if !matches!(event, Event::MainEventsCleared) {
                return;
            }
            let step = (|| -> Result<()> {
                ticks += 1;
                if runtime.deadline()?.is_some_and(|due| due <= Instant::now()) {
                    due_ticks += 1;
                }
                runtime.work()?;
                if initialized.load(Ordering::Acquire) == 3 {
                    return Err("global test rejecting proxy installation failed".into());
                }
                if context.is_none()
                    && browser.is_none()
                    && initialized.load(Ordering::Acquire) == 2
                {
                    // Production installs its policy after the fixture's
                    // temporary guard; read back the production policy itself.
                    let configured = observe_network_policy(&runtime, &fixture, "before-private-context")?;
                    if !configured {
                        return Err("production network policy not configured".into());
                    }
                    fixture
                        .observations
                        .lock()
                        .unwrap()
                        .record("context-create-enter", serde_json::json!({"attempt":name}));
                    context = Some(unsafe {
                        PrivateRequestContext::create_with_permissions(
                            session.clone(),
                            identity.clone(),
                            permissions.clone(),
                        )?
                    });
                    fixture
                        .observations
                        .lock()
                        .unwrap()
                        .record("context-create-return", serde_json::json!({"attempt":name}));
                }
                if let Some(context) = &context {
                    let status = context.status();
                    let description = format!("{status:?}");
                    if last_preparation != description {
                        fixture.observations.lock().unwrap().record(
                            "private-context",
                            serde_json::json!({"attempt":name,"status":description}),
                        );
                        fixture
                            .observations
                            .lock()
                            .unwrap()
                            .events
                            .push(format!("preparation:{description}"));
                        last_preparation = description;
                    }
                    if matches!(
                        status,
                        PreparationStatus::Failed(_) | PreparationStatus::Revoked
                    ) {
                        return Err(format!("context preparation failed: {status:?}").into());
                    }
                }
                if browser.is_none()
                    && context
                        .as_ref()
                        .is_some_and(|c| c.status() == PreparationStatus::ProxyConfigured)
                {
                    fixture
                        .observations
                        .lock()
                        .unwrap()
                        .record("browser-create-enter", serde_json::json!({"attempt":name}));
                    browser = Some(unsafe {
                        CefBrowserHost::create_owned_engineering_probe(
                            parent.clone(),
                            context.take().unwrap(),
                            session.clone(),
                            identity.clone(),
                            ViewportBounds::new(0., 0., 800., 600.)?,
                            parent.scale_factor(),
                            hooks.clone(),
                            Some(hooks.clone()),
                        )?
                    });
                    fixture
                        .observations
                        .lock()
                        .unwrap()
                        .record("browser-create-return", serde_json::json!({"attempt":name}));
                }
                if let Some(browser) = &browser {
                    if !navigated && closing.is_none() && browser.features_ready(&identity)? {
                        let mut session = session.lock().unwrap();
                        let ready = NativeHostReadiness::Ready {
                            profile_key: session.policy().profile_key().into(),
                            proxy_endpoint: session.proxy_endpoint(),
                        };
                        // Engineering fixture only. Does not change production readiness.
                        session.report_host(&identity, ready)?;
                        drop(session);
                        fixture
                            .observations
                            .lock()
                            .unwrap()
                            .record("navigate-enter", serde_json::json!({"attempt":name}));
                        browser.navigate(&identity, &format!("{origin}{path}"))?;
                        fixture
                            .observations
                            .lock()
                            .unwrap()
                            .record("navigate-return", serde_json::json!({"attempt":name}));
                        browser.show(&identity)?;
                        fixture.observations.lock().unwrap().record(
                            "initial-navigation",
                            serde_json::json!({"attempt":name,"accepted":true}),
                        );
                        navigated = true;
                    }
                    let done = fixture
                        .observations
                        .lock()
                        .unwrap()
                        .completed
                        .contains(&name.to_string());
                    if closing.is_none() && (done || started.elapsed() > Duration::from_secs(20)) {
                        if !done {
                            failures.push(format!("{name}: fixture completion timeout"));
                        }
                        if name == "isolation" && done {
                            // Native admission/dispatch only: no match-count or
                            // zoom readback hook exists. Keep login attempts intact.
                            let zoom = browser.zoom(&identity, 125.0).is_ok();
                            let reset_zoom = browser.zoom(&identity, 100.0).is_ok();
                            let find = browser.find(&identity, "Independent", true, false, false).is_ok();
                            let stop_find = browser.stop_find(&identity, true).is_ok();
                            fixture.observations.lock().unwrap().record("native-controls", serde_json::json!({
                                "attempt":name,"phase":"before-revoke","zoomAccepted":zoom,
                                "zoomResetAccepted":reset_zoom,"findAccepted":find,"stopFindAccepted":stop_find,
                                "visualEffectVerified":false
                            }));
                            if !(zoom && reset_zoom && find && stop_find) {
                                failures.push("isolation: native control dispatch rejected".into());
                            }
                        }
                        session.lock().unwrap().revoke(&identity)?;
                        fixture
                            .observations
                            .lock()
                            .unwrap()
                            .record("revoked", serde_json::json!({"attempt":name}));
                        if name == "isolation" && done {
                            let zoom = browser.zoom(&identity, 125.0).is_err();
                            let find = browser.find(&identity, "Independent", true, false, false).is_err();
                            let stop_find = browser.stop_find(&identity, true).is_err();
                            fixture.observations.lock().unwrap().record("native-controls", serde_json::json!({
                                "attempt":name,"phase":"after-revoke","zoomRejected":zoom,
                                "findRejected":find,"stopFindRejected":stop_find
                            }));
                            if !(zoom && find && stop_find) {
                                failures.push("isolation: revoked native control admitted".into());
                            }
                        }
                        revoked_count = fixture.observations.lock().unwrap().requests;
                        closing = Some(Instant::now());
                        // Observe an active renderer retrying after revocation before close.
                    }
                    if closing.is_some_and(|at| at.elapsed() > Duration::from_millis(500)) {
                        browser.close(&identity)?;
                        if browser.lifecycle() == Lifecycle::Closed {
                            closed = true;
                            *flow = ControlFlow::Exit;
                        }
                    }
                }
                if started.elapsed() > Duration::from_secs(25) {
                    return Err("native lifecycle deadline".into());
                }
                if last_snapshot.elapsed() >= Duration::from_secs(1) {
                    fixture.write_progress(&output, &failures)?;
                    last_snapshot = Instant::now();
                }
                Ok(())
            })();
            if let Err(error) = step {
                failures.push(format!("{name}: {error}"));
                *flow = ControlFlow::Exit;
            }
        });
        fixture.observations.lock().unwrap().events.push(format!(
            "pump:ticks={ticks};due={due_ticks};wakes={};mainContextInitialized={};deadline={:?}",
            wakes.load(Ordering::Relaxed),
            initialized.load(Ordering::Acquire),
            runtime.deadline()
        ));
        let count = fixture.observations.lock().unwrap().requests;
        fixture.observations.lock().unwrap().lifecycle.push(serde_json::json!({"attempt":name,"closed":closed,"postRevokeRequests":count.saturating_sub(revoked_count)}));
        fixture.observations.lock().unwrap().record(
            "attempt-return",
            serde_json::json!({"attempt":name,"closed":closed}),
        );
        fixture.write_progress(&output, &failures)?;
        if !closed {
            if browser.is_none() {
                // A failed context with no browser has no OnBeforeClose to
                // await. Release it and shut down normally so netlog flushes.
                drop(context);
                drop(hooks);
                async_runtime.block_on(session.lock().unwrap().stop())?;
                drop(session);
                let _ = observe_network_policy(&runtime, &fixture, "before-shutdown");
                unsafe {
                    runtime.shutdown()?;
                }
                fixture.write_report(&output, &failures)?;
                return Err(failures.join("; ").into());
            }
            // Never call CEF shutdown with live references; terminate the process
            // at this failed boundary. Runner records failure and owns cleanup.
            fixture.write_report(&output, &failures)?;
            std::process::exit(3);
        }
        drop(browser);
        drop(context);
        drop(hooks);
        async_runtime.block_on(session.lock().unwrap().stop())?;
    }
    let _ = observe_network_policy(&runtime, &fixture, "before-shutdown");
    unsafe {
        runtime.shutdown()?;
    }
    fixture.write_report(&output, &failures)?;
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; ").into())
    }
}

#[cfg(test)]
mod tests {
    use cef::CefString;

    #[test]
    fn preference_error_output_requires_allocated_native_string() {
        // Exercises the actual pinned binding; no browser or network is started.
        let mut null = CefString::default();
        let default_pointer: *mut cef::sys::_cef_string_utf16_t = (&mut null).into();
        assert!(default_pointer.is_null());
        let mut allocated = CefString::from("");
        let output_pointer: *mut cef::sys::_cef_string_utf16_t = (&mut allocated).into();
        assert!(!output_pointer.is_null());
    }
}
