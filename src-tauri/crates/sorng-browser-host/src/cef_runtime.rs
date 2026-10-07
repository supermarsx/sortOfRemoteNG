//! Main-thread CEF process lifecycle shared by Windows, Linux and macOS.
//! Platform bootstrap must precede this module (sandbox, framework loader,
//! NSApplication bridge or X11 selection). Initialization never grants Ready.

use crate::bootstrap_platform::{self, BootstrapError, RuntimeBootstrap};
use crate::message_pump::MessagePump;
use cef::*;
use std::cell::Cell;
use std::marker::PhantomData;
use std::path::Path;
use std::rc::Rc as ThreadBound;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, ThreadId};
use std::time::Instant;

#[path = "cef_containment.rs"]
mod containment;
const POLICY_PENDING: u8 = 0;
const POLICY_CONFIGURED: u8 = 1;
const POLICY_FAILED: u8 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum RuntimeError {
    #[error(transparent)]
    Bootstrap(#[from] BootstrapError),
    #[error("CEF runtime paths must be absolute, existing native package paths")]
    InvalidPackagePath,
    #[error("CEF has already been initialized or shut down in this process")]
    AlreadyStarted,
    #[error("CEF work must run on its initialization thread")]
    WrongThread,
    #[error("CEF scheduler is unavailable; close native browser sessions")]
    SchedulerUnavailable,
    #[error("CEF native network policy is unavailable or changed; close native browser sessions")]
    NetworkPolicyUnavailable,
}

static INITIALIZATION: OnceLock<()> = OnceLock::new();

/// Process-wide DNS restriction for the pinned Chromium 154.0.8037.58.
/// Website names must travel through the attempt's CONNECT relay, not through
/// Chromium's local DNS resolver. Only the actual IPv4 loopback relay address
/// is excluded; this is not a proxy bypass or a destination permission grant.
/// Fixtures must use this same value instead of overriding it with `~NOTFOUND`.
///
/// `net/dns/mapped_host_resolver.cc` and its pinned unit tests recognize
/// `^NOTFOUND` as an immediate failing request. `~NOTFOUND` is instead passed
/// to the underlying resolver and can trigger IPv6 reachability probing.
/// Source: https://github.com/chromium/chromium/blob/154.0.8037.58/net/dns/mapped_host_resolver.cc
///
/// Necessary hardening, NOT an all-traffic containment guarantee: the pinned
/// resolver also probes IPv6 reachability when resolving the excluded relay.
/// Raw socket users and global/system contexts still need independent coverage.
pub const NATIVE_HOST_RESOLVER_RULES: &str = "MAP * ^NOTFOUND, EXCLUDE 127.0.0.1";

/// Paths come from the native verified bundle, never from IPC. Hash/signature
/// verification belongs to package admission; existence alone is NOT trust.
pub fn native_settings(helper: &Path, resources: &Path) -> Result<Settings, RuntimeError> {
    fn text(path: &Path, file: bool) -> Result<String, RuntimeError> {
        if !path.is_absolute()
            || (if file {
                !path.is_file()
            } else {
                !path.is_dir()
            })
        {
            return Err(RuntimeError::InvalidPackagePath);
        }
        path.to_str()
            .filter(|value| !value.contains('\0'))
            .map(str::to_owned)
            .ok_or(RuntimeError::InvalidPackagePath)
    }
    Ok(Settings {
        // CEF's Windows sandbox bootstrap EXE must dispatch every process;
        // using a separate subprocess executable violates that ABI contract.
        browser_subprocess_path: {
            let helper = text(helper, true)?;
            if cfg!(target_os = "windows") {
                CefString::default()
            } else {
                CefString::from(helper.as_str())
            }
        },
        resources_dir_path: CefString::from(text(resources, false)?.as_str()),
        external_message_pump: 1,
        command_line_args_disabled: 1,
        // No persistent global cookie/cache directory or synthetic UA.
        // Each website gets a separate in-memory context before first load.
        no_sandbox: 0,
        multi_threaded_message_loop: 0,
        windowless_rendering_enabled: 0,
        remote_debugging_port: 0,
        persist_session_cookies: 0,
        background_color: 0xff18181b,
        ..Default::default()
    })
}

/// App-controlled installation/cache root. This does NOT enable a disk-backed
/// website profile: global and per-attempt cache_path remain empty, and retained
/// cookies are managed separately by the owning encrypted database.
pub fn native_settings_with_data_root(
    helper: &Path,
    resources: &Path,
    data_root: &Path,
) -> Result<Settings, RuntimeError> {
    if !data_root.is_absolute() || !data_root.is_dir() {
        return Err(RuntimeError::InvalidPackagePath);
    }
    let root = data_root.to_str().filter(|value| !value.contains('\0'))
        .ok_or(RuntimeError::InvalidPackagePath)?;
    let mut settings = native_settings(helper, resources)?;
    settings.root_cache_path = CefString::from(root);
    Ok(settings)
}

/// Post a coalesced native main-loop wake-up. On receipt the shell reads
/// `CefRuntime::deadline` and replaces its timer. Never carry an old deadline
/// across threads: out-of-order notifications must not cancel newer work.
/// This callback must not itself run CEF or block waiting on the UI thread.
/// Map a closed/failed native event-loop channel to `Err(WakeUnavailable)`.
pub type ScheduleWake = Arc<dyn Fn() -> Result<(), WakeUnavailable> + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("The native event loop could not be woken")]
pub struct WakeUnavailable;

/// Independent of the UI wake channel. Must synchronously revoke all owned
/// relay admissions on failure, then arrange native cleanup on the UI thread.
/// This callback runs on the failing thread: never call CEF here, block on the
/// UI thread, or rely on another scheduler poll. It must not panic.
pub type RuntimeFault = Arc<dyn Fn(RuntimeError) + Send + Sync>;

struct Scheduler {
    pump: Mutex<MessagePump>,
    wake: ScheduleWake,
    fault: RuntimeFault,
    failed: AtomicBool,
    network_policy: AtomicU8,
}

impl Scheduler {
    fn fail(&self) {
        if self.failed.swap(true, Ordering::AcqRel) {
            return;
        }
        self.pump
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .stop();
        // Notify after releasing the pump lock. Even a faulty host callback
        // must not unwind through CEF; the terminal failure remains latched.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            (self.fault)(self.failure_reason());
        }));
    }

    fn notify(&self) {
        if self.failed.load(Ordering::Acquire) {
            return;
        }
        // A host callback may fail, but Rust unwinding must not cross the C ABI.
        if !matches!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (self.wake)())),
            Ok(Ok(()))
        ) {
            self.fail();
        }
    }

    fn schedule(&self, delay_ms: i64) {
        let poisoned = match self.pump.lock() {
            Ok(mut pump) => {
                pump.schedule(Instant::now(), delay_ms);
                false
            }
            Err(error) => {
                error.into_inner().stop();
                true
            }
        };
        if poisoned {
            self.fail();
            return;
        }
        self.notify();
    }

    fn check(&self) -> Result<(), RuntimeError> {
        if self.failed.load(Ordering::Acquire) {
            Err(self.failure_reason())
        } else {
            Ok(())
        }
    }

    fn failure_reason(&self) -> RuntimeError {
        if self.network_policy.load(Ordering::Acquire) == POLICY_FAILED {
            RuntimeError::NetworkPolicyUnavailable
        } else {
            RuntimeError::SchedulerUnavailable
        }
    }

    fn policy_failed(&self) {
        self.network_policy.store(POLICY_FAILED, Ordering::Release);
        self.fail();
    }
}

wrap_browser_process_handler! {
    struct RuntimeProcessHandler { scheduler: Arc<Scheduler> }
    impl BrowserProcessHandler {
        fn on_context_initialized(&self) {
            if self.scheduler.network_policy.load(Ordering::Acquire) == POLICY_PENDING
                && self.scheduler.check().is_ok()
                && containment::install_global_policy().is_ok() {
                self.scheduler.network_policy.store(POLICY_CONFIGURED, Ordering::Release);
            } else {
                self.scheduler.policy_failed();
            }
        }
        fn on_schedule_message_pump_work(&self, delay_ms: i64) {
            self.scheduler.schedule(delay_ms);
        }
    }
}

#[path = "cef_startup_features.rs"]
mod startup_features;

wrap_app! {
    struct RuntimeApplication { scheduler: Arc<Scheduler> }
    impl App {
        fn render_process_handler(&self) -> Option<RenderProcessHandler> {
            Some(crate::cef_renderer::handler())
        }

        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(RuntimeProcessHandler::new(self.scheduler.clone()))
        }

        fn on_before_command_line_processing(
            &self, _process_type: Option<&CefString>, command_line: Option<&mut CommandLine>
        ) {
            if let Some(command_line) = command_line {
                // CEF 682c378 lazily seeds its metrics RNG with BoringSSL.
                // Lock timing can first-use it inside PartitionAlloc, causing
                // recursive allocation and a fatal check during startup.
                // Disable only optional lock telemetry, in browser AND helper
                // processes. Keep all sandbox/TLS/allocator checks enabled.
                let disabled = startup_features::disabled_features(
                    &CefString::from(
                        &command_line.switch_value(Some(&CefString::from("disable-features"))),
                    ).to_string(),
                );
                command_line.append_switch_with_value(
                    Some(&CefString::from("disable-features")),
                    Some(&CefString::from(disabled.as_str())),
                );
                // Necessary transport restrictions, not a containment proof.
                // No security-disable, remote-debugging, UA or WebDriver spoof.
                #[cfg(target_os = "linux")]
                command_line.append_switch_with_value(
                    Some(&CefString::from("ozone-platform")),
                    Some(&CefString::from("x11")),
                );
                command_line.append_switch(Some(&CefString::from("disable-quic")));
                command_line.append_switch_with_value(
                    Some(&CefString::from("host-resolver-rules")),
                    Some(&CefString::from(NATIVE_HOST_RESOLVER_RULES)),
                );
                // CEF 682c378 otherwise routes HTTP/proxy challenges to
                // Chrome's login UI instead of CefRequestHandler, even for an
                // Alloy child. Select our exact-endpoint native auth handler;
                // this neither disables authentication nor grants credentials.
                command_line.append_switch(Some(&CefString::from("disable-chrome-login-prompt")));
                // Blink transforms website paint, including authentication and
                // challenge documents, before rasterization. No response/CSS
                // rewriting or page-dependent suspension; runtime acceptance
                // still has to measure first paint on all three platforms.
                command_line.append_switch(Some(&CefString::from("force-dark-mode")));
                command_line.append_switch_with_value(
                    Some(&CefString::from("enable-features")),
                    Some(&CefString::from("WebContentsForceDark")),
                );
                command_line.append_switch_with_value(
                    Some(&CefString::from("force-webrtc-ip-handling-policy")),
                    Some(&CefString::from("disable_non_proxied_udp")),
                );
            }
        }
    }
}

fn scheduler(wake: ScheduleWake, fault: RuntimeFault) -> Arc<Scheduler> {
    Arc::new(Scheduler {
        pump: Mutex::new(MessagePump::default()),
        wake,
        fault,
        failed: AtomicBool::new(false),
        network_policy: AtomicU8::new(POLICY_PENDING),
    })
}

/// Native helper-process callbacks. Pass to the platform provider's
/// execute_process BEFORE Tauri, logging, storage or other application code.
/// No CEF/browser work runs in the wake callback for a helper process.
pub fn subprocess_application() -> App {
    RuntimeApplication::new(scheduler(Arc::new(|| Ok(())), Arc::new(|_| {})))
}

enum BootstrapOwner<'a> {
    Borrowed(&'a mut dyn RuntimeBootstrap),
    Owned(Box<dyn RuntimeBootstrap>),
}

impl BootstrapOwner<'_> {
    fn get_mut(&mut self) -> &mut dyn RuntimeBootstrap {
        match self {
            Self::Borrowed(bootstrap) => *bootstrap,
            Self::Owned(bootstrap) => bootstrap.as_mut(),
        }
    }
}

/// Not Send/Sync; retains the App callbacks through native shutdown. No Drop
/// shutdown: CEF must outlive all contexts, browser callbacks and child views.
pub struct CefRuntime<'bootstrap> {
    thread: ThreadId,
    scheduler: Arc<Scheduler>,
    _application: App,
    bootstrap: BootstrapOwner<'bootstrap>,
    pumping: Cell<bool>,
    _ui_thread: PhantomData<ThreadBound<()>>,
}

impl<'bootstrap> CefRuntime<'bootstrap> {
    /// UI-thread operational configuration prerequisite, NOT production or
    /// packet-containment attestation. False until OnContextInitialized installs
    /// both global policies. Rechecks native readback and latches failure/drift.
    /// Private contexts still require their own proxy/permission/owner gates.
    pub fn network_policy_configured(&self) -> Result<bool, RuntimeError> {
        if self.thread != thread::current().id() {
            return Err(RuntimeError::WrongThread);
        }
        self.scheduler.check()?;
        match self.scheduler.network_policy.load(Ordering::Acquire) {
            POLICY_PENDING => Ok(false),
            POLICY_CONFIGURED if containment::verify_global_policy().is_ok() => Ok(true),
            _ => {
                self.scheduler.policy_failed();
                Err(RuntimeError::NetworkPolicyUnavailable)
            }
        }
    }

    pub fn deadline(&self) -> Result<Option<Instant>, RuntimeError> {
        self.scheduler.check()?;
        self.scheduler
            .pump
            .lock()
            .map(|pump| pump.deadline())
            .map_err(|error| {
                drop(error.into_inner());
                self.scheduler.fail();
                RuntimeError::SchedulerUnavailable
            })
    }

    /// # Safety
    /// Call exactly once on the native main/UI thread after platform bootstrap
    /// and process dispatch. Package paths/signatures must be verified. The
    /// borrowed platform provider retains event bridge, sandbox and loader
    /// prerequisites through shutdown. A failed initialization requires process exit, not a
    /// fallback to another engine or a second initialization.
    pub unsafe fn initialize(
        bootstrap: &'bootstrap mut dyn RuntimeBootstrap,
        settings: &Settings,
        wake: ScheduleWake,
        fault: RuntimeFault,
    ) -> Result<Self, RuntimeError> {
        bootstrap_platform::validate_native_settings(settings)?;
        INITIALIZATION
            .set(())
            .map_err(|_| RuntimeError::AlreadyStarted)?;
        unsafe { Self::initialize_claimed(bootstrap, settings, wake, fault) }
    }

    /// Caller has exclusively claimed process initialization. Separated so a
    /// fake bootstrap can test initialization-time callback failure without
    /// launching CEF or consuming the production process-global claim.
    unsafe fn initialize_claimed(
        bootstrap: &'bootstrap mut dyn RuntimeBootstrap,
        settings: &Settings,
        wake: ScheduleWake,
        fault: RuntimeFault,
    ) -> Result<Self, RuntimeError> {
        unsafe {
            Self::initialize_owner_claimed(
                BootstrapOwner::Borrowed(bootstrap),
                settings,
                wake,
                fault,
            )
        }
    }

    unsafe fn initialize_owner_claimed(
        mut bootstrap: BootstrapOwner<'bootstrap>,
        settings: &Settings,
        wake: ScheduleWake,
        fault: RuntimeFault,
    ) -> Result<Self, RuntimeError> {
        let scheduler = scheduler(wake, fault);
        let mut application = RuntimeApplication::new(scheduler.clone());
        unsafe {
            bootstrap
                .get_mut()
                .initialize_native(settings, &mut application)?;
        }
        // Seed the external loop even when initialization supplied no schedule
        // callback. Subsequent idle work rearms CEF's bounded fallback timer.
        scheduler.schedule(0);
        if let Err(error) = scheduler.check() {
            // Our startup App creates no browser/context before this function
            // returns. Native init succeeded, so release App then shut down on
            // this same thread; never return a healthy runtime after wake loss.
            drop(application);
            unsafe {
                bootstrap.get_mut().shutdown_native()?;
            }
            return Err(error);
        }
        Ok(Self {
            thread: thread::current().id(),
            scheduler,
            _application: application,
            bootstrap,
            pumping: Cell::new(false),
            _ui_thread: PhantomData,
        })
    }

    /// Stale/early native timer callbacks do no work. Never hold a scheduler
    /// mutex across CEF, whose callbacks can schedule the next iteration.
    pub fn work(&self) -> Result<(), RuntimeError> {
        if self.thread != thread::current().id() {
            return Err(RuntimeError::WrongThread);
        }
        self.scheduler.check()?;
        self.network_policy_configured()?;
        let should_work = self
            .scheduler
            .pump
            .lock()
            .map_err(|error| {
                drop(error.into_inner());
                self.scheduler.fail();
                RuntimeError::SchedulerUnavailable
            })?
            .begin_work(Instant::now());
        if should_work {
            self.pump_once_with(cef::do_message_loop_work);
            self.scheduler
                .pump
                .lock()
                .map_err(|error| {
                    drop(error.into_inner());
                    self.scheduler.fail();
                    RuntimeError::SchedulerUnavailable
                })?
                .finish_work(Instant::now());
            self.scheduler.notify();
        }
        self.scheduler.check()
    }

    /// Drain native callbacks after the owner has terminally revoked admission
    /// and closed/revoked every browser's request guards and relay. Unlike
    /// `work`, this remains usable after a policy, wake or scheduler failure.
    /// The caller must keep supplying UI-thread housekeeping ticks until all
    /// OnBeforeClose callbacks finish; no scheduling or admission is restored.
    ///
    /// This permanently fails/stops the normal scheduler, preserving an existing
    /// failure reason. CEF does not provide a cleanup-only task queue: other
    /// queued callbacks may run, so owner/request revocation is a prerequisite.
    /// The initialized runtime, App and bootstrap remain owned until explicit
    /// `shutdown`. Success means a pump opportunity, not that cleanup finished.
    pub fn cleanup_only_work(&self) -> Result<(), RuntimeError> {
        self.cleanup_only_work_with(cef::do_message_loop_work)
    }

    fn cleanup_only_work_with(&self, work: impl FnOnce()) -> Result<(), RuntimeError> {
        if self.thread != thread::current().id() {
            return Err(RuntimeError::WrongThread);
        }
        self.scheduler.fail();
        // Neither a stopped/poisoned MessagePump nor failed policy readback may
        // prevent queued native closes. Never hold its mutex across callbacks.
        self.pump_once_with(work);
        Ok(())
    }

    fn pump_once_with(&self, work: impl FnOnce()) {
        if self.pumping.replace(true) {
            return;
        }
        struct PumpGuard<'a>(&'a Cell<bool>);
        impl Drop for PumpGuard<'_> {
            fn drop(&mut self) {
                self.0.set(false);
            }
        }
        let _guard = PumpGuard(&self.pumping);
        work();
    }

    /// # Safety
    /// All browser OnBeforeClose callbacks must have completed, all request
    /// contexts/other CEF references released, and every private relay revoked.
    /// No engine work may run afterwards. Release the caller's Settings and
    /// remaining CEF-backed value wrappers before explicit platform unloading;
    /// shutdown_native must leave their native free functions available.
    pub unsafe fn shutdown(mut self) -> Result<(), RuntimeError> {
        if self.thread != thread::current().id() {
            return Err(RuntimeError::WrongThread);
        }
        self.scheduler
            .pump
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .stop();
        self.scheduler.notify();
        // Release our native App reference while CEF is still alive. CEF's
        // internal references and callbacks are drained by shutdown itself.
        drop(self._application);
        unsafe {
            self.bootstrap.get_mut().shutdown_native()?;
        }
        Ok(())
    }
}

impl CefRuntime<'static> {
    /// Own the platform provider on the UI thread, suitable for a thread-local
    /// registry. Ownership does not make the runtime Send/Sync. Normal shutdown
    /// releases App callbacks, shuts down CEF, then drops the provider.
    ///
    /// # Safety
    /// Same startup and explicit-shutdown requirements as `initialize`. The
    /// provider must keep native free functions loaded when dropped after an
    /// initialization failure or shutdown (Settings may still own CefStrings).
    /// The built-in providers use explicit framework unloading, not Drop.
    pub unsafe fn initialize_owned(
        bootstrap: Box<dyn RuntimeBootstrap>,
        settings: &Settings,
        wake: ScheduleWake,
        fault: RuntimeFault,
    ) -> Result<Self, RuntimeError> {
        bootstrap_platform::validate_native_settings(settings)?;
        INITIALIZATION
            .set(())
            .map_err(|_| RuntimeError::AlreadyStarted)?;
        unsafe {
            Self::initialize_owner_claimed(BootstrapOwner::Owned(bootstrap), settings, wake, fault)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct CleanupBootstrap(Arc<Mutex<Vec<&'static str>>>);

    impl Drop for CleanupBootstrap {
        fn drop(&mut self) {
            self.0.lock().unwrap().push("drop");
        }
    }

    impl RuntimeBootstrap for CleanupBootstrap {
        unsafe fn initialize_native(
            &mut self,
            _: &Settings,
            _: &mut App,
        ) -> Result<(), BootstrapError> {
            self.0.lock().unwrap().push("initialize");
            Ok(())
        }

        unsafe fn shutdown_native(&mut self) -> Result<(), BootstrapError> {
            self.0.lock().unwrap().push("shutdown");
            Ok(())
        }
    }

    #[test]
    fn policy_revocation_still_drains_cleanup_without_rearming_or_dropping_bootstrap() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        bootstrap_platform::select_pinned_api().unwrap();
        for poison in [false, true] {
            let events = Arc::new(Mutex::new(Vec::new()));
            let faults = Arc::new(Mutex::new(Vec::new()));
            let observed_faults = faults.clone();
            let wakes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let observed_wakes = wakes.clone();
            let runtime = unsafe {
                CefRuntime::initialize_owner_claimed(
                    BootstrapOwner::Owned(Box::new(CleanupBootstrap(events.clone()))),
                    &Settings::default(),
                    Arc::new(move || {
                        observed_wakes.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    }),
                    Arc::new(move |reason| observed_faults.lock().unwrap().push(reason)),
                )
                .unwrap()
            };
            if poison {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let _guard = runtime.scheduler.pump.lock().unwrap();
                    panic!("test poisoned scheduler");
                }));
            }
            runtime.scheduler.policy_failed();
            assert_eq!(runtime.work(), Err(RuntimeError::NetworkPolicyUnavailable));
            assert_eq!(
                *faults.lock().unwrap(),
                [RuntimeError::NetworkPolicyUnavailable]
            );
            let wake_count = wakes.load(Ordering::SeqCst);
            // Replace only the actual CEF pump call: simulate a queued close
            // and its later OnBeforeClose on separate housekeeping iterations.
            for event in ["close", "before-close"] {
                runtime
                    .cleanup_only_work_with(|| {
                        assert_eq!(
                            *faults.lock().unwrap(),
                            [RuntimeError::NetworkPolicyUnavailable]
                        );
                        assert!(!events.lock().unwrap().contains(&"drop"));
                        runtime.scheduler.schedule(0);
                        runtime
                            .cleanup_only_work_with(|| panic!("recursive pump"))
                            .unwrap();
                        runtime.pump_once_with(|| panic!("recursive ordinary pump"));
                        events.lock().unwrap().push(event);
                    })
                    .unwrap();
            }
            assert_eq!(wakes.load(Ordering::SeqCst), wake_count);
            assert_eq!(
                runtime.deadline(),
                Err(RuntimeError::NetworkPolicyUnavailable)
            );
            assert_eq!(
                runtime.network_policy_configured(),
                Err(RuntimeError::NetworkPolicyUnavailable)
            );
            assert_eq!(
                runtime.scheduler.network_policy.load(Ordering::Acquire),
                POLICY_FAILED
            );
            assert_eq!(
                runtime
                    .scheduler
                    .pump
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .deadline(),
                None
            );
            assert_eq!(
                *faults.lock().unwrap(),
                [RuntimeError::NetworkPolicyUnavailable]
            );
            assert_eq!(
                *events.lock().unwrap(),
                ["initialize", "close", "before-close"]
            );
            unsafe {
                runtime.shutdown().unwrap();
            }
            assert_eq!(
                *events.lock().unwrap(),
                ["initialize", "close", "before-close", "shutdown", "drop"]
            );
        }
    }

    #[test]
    fn cleanup_checks_thread_and_terminally_stops_a_previously_healthy_scheduler() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        bootstrap_platform::select_pinned_api().unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let faults = Arc::new(Mutex::new(Vec::new()));
        let observed = faults.clone();
        let mut runtime = unsafe {
            CefRuntime::initialize_owner_claimed(
                BootstrapOwner::Owned(Box::new(CleanupBootstrap(events))),
                &Settings::default(),
                Arc::new(|| Ok(())),
                Arc::new(move |reason| observed.lock().unwrap().push(reason)),
            )
            .unwrap()
        };
        // Change only the recorded thread ID; never send a native runtime to
        // another thread or invoke CEF from this fake-bootstrap unit test.
        runtime.thread = thread::spawn(|| thread::current().id()).join().unwrap();
        assert_eq!(
            runtime.cleanup_only_work_with(|| panic!("wrong-thread pump")),
            Err(RuntimeError::WrongThread)
        );
        assert!(faults.lock().unwrap().is_empty());
        assert!(runtime.scheduler.check().is_ok());
        runtime.thread = thread::current().id();
        runtime
            .cleanup_only_work_with(|| {
                assert_eq!(
                    *faults.lock().unwrap(),
                    [RuntimeError::SchedulerUnavailable]
                );
                runtime.scheduler.schedule(0);
            })
            .unwrap();
        assert_eq!(runtime.work(), Err(RuntimeError::SchedulerUnavailable));
        assert_eq!(runtime.scheduler.pump.lock().unwrap().deadline(), None);
        assert_eq!(
            runtime.network_policy_configured(),
            Err(RuntimeError::SchedulerUnavailable)
        );
        unsafe {
            runtime.shutdown().unwrap();
        }
    }

    #[test]
    fn network_policy_failure_is_terminal_and_revokes_without_another_pump() {
        let faults = Arc::new(Mutex::new(Vec::new()));
        let observed = faults.clone();
        let scheduler = scheduler(
            Arc::new(|| Ok(())),
            Arc::new(move |reason| observed.lock().unwrap().push(reason)),
        );
        assert_eq!(
            scheduler.network_policy.load(Ordering::Acquire),
            POLICY_PENDING
        );
        scheduler.schedule(0);
        scheduler.policy_failed();
        scheduler.policy_failed();
        scheduler.schedule(0);
        assert_eq!(
            scheduler.network_policy.load(Ordering::Acquire),
            POLICY_FAILED
        );
        assert_eq!(
            *faults.lock().unwrap(),
            vec![RuntimeError::NetworkPolicyUnavailable]
        );
        assert_eq!(
            scheduler.check(),
            Err(RuntimeError::NetworkPolicyUnavailable)
        );
        assert_eq!(scheduler.pump.lock().unwrap().deadline(), None);
    }

    #[test]
    fn every_process_uses_pinned_dns_denial_without_proxy_or_security_overrides() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        bootstrap_platform::select_pinned_api().unwrap();
        let app = subprocess_application();
        for process in ["", "renderer", "utility", "gpu-process"] {
            let mut command_line = command_line_create().expect("native command-line object");
            // An inherited rule must not weaken the production restriction.
            command_line.append_switch_with_value(
                Some(&CefString::from("host-resolver-rules")),
                Some(&CefString::from("MAP * 192.0.2.1")),
            );
            app.on_before_command_line_processing(
                Some(&CefString::from(process)),
                Some(&mut command_line),
            );
            assert_eq!(
                CefString::from(
                    &command_line.switch_value(Some(&CefString::from("host-resolver-rules")))
                )
                .to_string(),
                "MAP * ^NOTFOUND, EXCLUDE 127.0.0.1"
            );
            // A process-global proxy switch overrides private-context proxy
            // preferences. Do not accidentally make those unwritable, disable
            // protection, or pretend a feature override eliminates UDP probes.
            for absent in [
                "proxy-server",
                "no-proxy-server",
                "proxy-bypass-list",
                "no-sandbox",
                "disable-web-security",
                "ignore-certificate-errors",
                "disable-ipv6",
            ] {
                assert_eq!(command_line.has_switch(Some(&CefString::from(absent))), 0);
            }
        }
    }

    #[test]
    fn browser_auth_uses_native_handler_without_weakening_engine_security() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        bootstrap_platform::select_pinned_api().unwrap();
        let app = RuntimeApplication::new(scheduler(Arc::new(|| Ok(())), Arc::new(|_| {})));
        let mut command_line = command_line_create().expect("native command-line object");
        app.on_before_command_line_processing(None, Some(&mut command_line));
        assert_eq!(
            command_line.has_switch(Some(&CefString::from("disable-chrome-login-prompt"))),
            1
        );
        for forbidden in [
            "no-sandbox",
            "disable-web-security",
            "ignore-certificate-errors",
            "user-agent",
            "remote-debugging-port",
        ] {
            assert_eq!(
                command_line.has_switch(Some(&CefString::from(forbidden))),
                0
            );
        }
    }

    #[test]
    fn owned_provider_outlives_app_and_is_dropped_after_explicit_shutdown() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        bootstrap_platform::select_pinned_api().unwrap();
        struct FakeOwned {
            events: Arc<Mutex<Vec<&'static str>>>,
            fail_wake: bool,
        }
        impl Drop for FakeOwned {
            fn drop(&mut self) {
                self.events.lock().unwrap().push("drop");
            }
        }
        impl RuntimeBootstrap for FakeOwned {
            unsafe fn initialize_native(
                &mut self,
                _: &Settings,
                app: &mut App,
            ) -> Result<(), BootstrapError> {
                self.events.lock().unwrap().push("initialize");
                if self.fail_wake {
                    app.browser_process_handler()
                        .unwrap()
                        .on_schedule_message_pump_work(0);
                }
                Ok(())
            }
            unsafe fn shutdown_native(&mut self) -> Result<(), BootstrapError> {
                self.events.lock().unwrap().push("shutdown");
                Ok(())
            }
        }
        for fail_wake in [false, true] {
            let events = Arc::new(Mutex::new(Vec::new()));
            let provider = Box::new(FakeOwned {
                events: events.clone(),
                fail_wake,
            });
            let result: Result<CefRuntime<'static>, _> = unsafe {
                CefRuntime::initialize_owner_claimed(
                    BootstrapOwner::Owned(provider),
                    &Settings::default(),
                    Arc::new(move || {
                        if fail_wake {
                            Err(WakeUnavailable)
                        } else {
                            Ok(())
                        }
                    }),
                    Arc::new(|_| {}),
                )
            };
            if fail_wake {
                assert_eq!(result.err(), Some(RuntimeError::SchedulerUnavailable));
            } else {
                assert_eq!(*events.lock().unwrap(), ["initialize"]);
                unsafe {
                    result.unwrap().shutdown().unwrap();
                }
            }
            assert_eq!(*events.lock().unwrap(), ["initialize", "shutdown", "drop"]);
        }
    }

    #[test]
    fn a_failing_wake_cannot_look_like_an_idle_healthy_runtime() {
        let faults = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = faults.clone();
        let scheduler = scheduler(
            Arc::new(|| Err(WakeUnavailable)),
            Arc::new(move |error| {
                assert_eq!(error, RuntimeError::SchedulerUnavailable);
                count.fetch_add(1, Ordering::SeqCst);
            }),
        );
        scheduler.schedule(0);
        // The independent owner callback ran before another UI poll/check.
        assert_eq!(faults.load(Ordering::SeqCst), 1);
        scheduler.schedule(1);
        assert_eq!(faults.load(Ordering::SeqCst), 1);
        assert_eq!(scheduler.check(), Err(RuntimeError::SchedulerUnavailable));
        assert_eq!(scheduler.pump.lock().unwrap().deadline(), None);
    }

    #[test]
    fn poisoned_scheduler_remains_terminal_without_unwinding_through_cef() {
        let scheduler = scheduler(Arc::new(|| Ok(())), Arc::new(|_| {}));
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = scheduler.pump.lock().unwrap();
            panic!("test poison");
        }));
        scheduler.schedule(0);
        assert_eq!(scheduler.check(), Err(RuntimeError::SchedulerUnavailable));
        assert!(scheduler.pump.is_poisoned());
    }

    #[test]
    fn initialization_wake_failure_notifies_owner_and_shuts_down_before_returning() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        bootstrap_platform::select_pinned_api().expect("pinned CEF API");
        #[derive(Default)]
        struct FakeBootstrap {
            initialized: usize,
            stopped: usize,
        }
        impl RuntimeBootstrap for FakeBootstrap {
            unsafe fn initialize_native(
                &mut self,
                _: &Settings,
                app: &mut App,
            ) -> Result<(), BootstrapError> {
                self.initialized += 1;
                app.browser_process_handler()
                    .unwrap()
                    .on_schedule_message_pump_work(0);
                Ok(())
            }
            unsafe fn shutdown_native(&mut self) -> Result<(), BootstrapError> {
                self.stopped += 1;
                Ok(())
            }
        }
        let faults = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = faults.clone();
        let mut bootstrap = FakeBootstrap::default();
        let settings = Settings::default();
        let result = unsafe {
            CefRuntime::initialize_claimed(
                &mut bootstrap,
                &settings,
                Arc::new(|| Err(WakeUnavailable)),
                Arc::new(move |_| {
                    count.fetch_add(1, Ordering::SeqCst);
                }),
            )
        };
        assert_eq!(result.err(), Some(RuntimeError::SchedulerUnavailable));
        assert_eq!(faults.load(Ordering::SeqCst), 1);
        assert_eq!(bootstrap.initialized, 1);
        assert_eq!(bootstrap.stopped, 1);
    }

    #[test]
    fn owner_fault_callback_cannot_unwind_back_into_cef() {
        let scheduler = scheduler(
            Arc::new(|| panic!("test wake failure")),
            Arc::new(|_| panic!("test owner fault failure")),
        );
        scheduler.schedule(0);
        assert_eq!(scheduler.check(), Err(RuntimeError::SchedulerUnavailable));
        assert_eq!(scheduler.pump.lock().unwrap().deadline(), None);
    }

    #[test]
    fn native_command_line_keeps_security_and_platform_constraints() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        bootstrap_platform::select_pinned_api().expect("pinned CEF API");
        let mut command_line = cef::command_line_create().expect("CEF command line");
        let application = subprocess_application();
        assert!(application.render_process_handler().is_some());
        application.on_before_command_line_processing(None, Some(&mut command_line));
        assert!(crate::cef_renderer::forced_dark_configured(&command_line));
        assert_eq!(
            command_line.has_switch(Some(&CefString::from("force-dark-mode"))),
            1
        );
        assert_eq!(
            CefString::from(&command_line.switch_value(Some(&CefString::from("enable-features"))))
                .to_string(),
            "WebContentsForceDark"
        );
        assert_eq!(
            command_line.has_switch(Some(&CefString::from("disable-quic"))),
            1
        );
        assert_eq!(
            CefString::from(
                &command_line
                    .switch_value(Some(&CefString::from("force-webrtc-ip-handling-policy")))
            )
            .to_string(),
            "disable_non_proxied_udp"
        );
        #[cfg(target_os = "linux")]
        assert_eq!(
            CefString::from(&command_line.switch_value(Some(&CefString::from("ozone-platform"))))
                .to_string(),
            "x11"
        );
        for forbidden in [
            "no-sandbox",
            "disable-web-security",
            "ignore-certificate-errors",
            "user-agent",
            "remote-debugging-port",
            "disable-blink-features",
        ] {
            assert_eq!(
                command_line.has_switch(Some(&CefString::from(forbidden))),
                0
            );
        }
    }

    #[test]
    fn settings_never_disable_sandbox_or_spoof_browser_identity() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        let executable = std::env::current_exe().unwrap();
        let settings = native_settings(&executable, executable.parent().unwrap()).unwrap();
        bootstrap_platform::validate_native_settings(&settings).unwrap();
        assert_eq!(settings.remote_debugging_port, 0);
        assert!(settings.user_agent.to_string().is_empty());
        assert!(settings.user_agent_product.to_string().is_empty());
        assert_eq!(settings.persist_session_cookies, 0);
        assert!(settings.cache_path.to_string().is_empty());
        assert!(settings.root_cache_path.to_string().is_empty());
        assert_eq!(settings.background_color, 0xff18181b);
        if cfg!(target_os = "windows") {
            assert!(settings.browser_subprocess_path.to_string().is_empty());
        } else {
            assert_eq!(
                settings.browser_subprocess_path.to_string(),
                executable.to_str().unwrap()
            );
        }
    }

    #[test]
    fn engine_owned_ua_rejects_app_tokens_and_invented_chrome_versions() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        let executable = std::env::current_exe().unwrap();
        for custom in [
            "Electron/99.0",
            "CEF/154.3.0",
            "sortOfRemoteNG/26.50",
            "Chrome/999.0.0.0",
        ] {
            let mut settings = native_settings(&executable, executable.parent().unwrap()).unwrap();
            settings.user_agent = CefString::from(custom);
            assert!(bootstrap_platform::validate_native_settings(&settings).is_err());
            settings.user_agent = CefString::default();
            settings.user_agent_product = CefString::from(custom);
            assert!(bootstrap_platform::validate_native_settings(&settings).is_err());
        }
    }

    #[test]
    fn configurable_data_root_does_not_enable_plaintext_cookie_persistence() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        let executable = std::env::current_exe().unwrap();
        let directory = executable.parent().unwrap();
        let settings = native_settings_with_data_root(&executable, directory, directory).unwrap();
        bootstrap_platform::validate_native_settings(&settings).unwrap();
        assert_eq!(settings.root_cache_path.to_string(), directory.to_str().unwrap());
        assert!(settings.cache_path.to_string().is_empty());
        assert_eq!(settings.persist_session_cookies, 0);
        assert!(native_settings_with_data_root(&executable, directory, Path::new("relative")).is_err());
        assert!(native_settings_with_data_root(&executable, directory, &executable).is_err());
    }

    #[test]
    fn relative_and_wrong_kind_paths_fail_before_native_startup() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        let executable = std::env::current_exe().unwrap();
        assert!(matches!(
            native_settings(Path::new("helper"), executable.parent().unwrap()),
            Err(RuntimeError::InvalidPackagePath)
        ));
        assert!(matches!(
            native_settings(executable.parent().unwrap(), &executable),
            Err(RuntimeError::InvalidPackagePath)
        ));
    }
}
