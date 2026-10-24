//! Revision-four registry lifecycle acceptance. No browser, URL, DNS or socket probe.
use super::Result;
use cef::{rc::ConvertReturnValue, *};
use std::{
    ffi::c_void,
    marker::PhantomData,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

#[repr(C)]
struct Bytes {
    data: *const u8,
    length: usize,
}
#[repr(C)]
struct Descriptor {
    size: u32,
    abi: u32,
    token: u64,
    generation: u64,
    user: *mut c_void,
    evidence: unsafe extern "C" fn(*mut c_void, *const c_void),
    state: unsafe extern "C" fn(*mut c_void, u64, u64, u32),
    ca_mode: u32,
    reserved: u32,
    anchors: *const Bytes,
    anchors_len: usize,
}
type Create = unsafe extern "C" fn(
    *const Descriptor,
    *const cef::sys::_cef_request_context_settings_t,
    *mut cef::sys::_cef_request_context_handler_t,
) -> *mut cef::sys::_cef_request_context_t;
type Operation = unsafe extern "C" fn(u64, u64, u16) -> i32;
type Revoke = unsafe extern "C" fn(u64, u64) -> i32;
// Resolve only the already loaded CEF image containing cef_api_hash. The
// same exact-image check applies to every fixture ABI symbol on all platforms.
#[path = "registry_retirement_fixture/loaded_module.rs"]
pub(crate) mod loaded_module;
struct Observation {
    token: u64,
    generation: u64,
    initialized: AtomicBool,
    states: Mutex<Vec<u32>>,
    evidence: AtomicUsize,
    foreign: AtomicUsize,
    terminal: AtomicBool,
    after_terminal: AtomicUsize,
}
fn retained() -> &'static Mutex<Vec<Arc<Observation>>> {
    static RETAINED: OnceLock<Mutex<Vec<Arc<Observation>>>> = OnceLock::new();
    RETAINED.get_or_init(Mutex::default)
}
unsafe extern "C" fn evidence(user: *mut c_void, _: *const c_void) {
    if let Some(state) = unsafe { user.cast::<Observation>().as_ref() } {
        if state.terminal.load(Ordering::Acquire) {
            state.after_terminal.fetch_add(1, Ordering::Relaxed);
        }
        state.evidence.fetch_add(1, Ordering::Relaxed);
    }
}
unsafe extern "C" fn state(user: *mut c_void, token: u64, generation: u64, value: u32) {
    let Some(state) = (unsafe { user.cast::<Observation>().as_ref() }) else {
        return;
    };
    if token != state.token || generation != state.generation {
        state.foreign.fetch_add(1, Ordering::Relaxed);
        return;
    }
    if state.terminal.swap(
        value == 2 || state.terminal.load(Ordering::Acquire),
        Ordering::AcqRel,
    ) {
        state.after_terminal.fetch_add(1, Ordering::Relaxed);
    }
    if let Ok(mut states) = state.states.lock() {
        if states.len() < 32 {
            states.push(value);
        }
    }
}
wrap_request_context_handler! {
    struct Handler { observed:Arc<Observation> }
    impl RequestContextHandler {
        fn on_request_context_initialized(&self, _context: Option<&mut RequestContext>) {
            self.observed.initialized.store(true,Ordering::Release);
        }
    }
}
struct Owner {
    _context: RequestContext,
    observed: Arc<Observation>,
    revoke: Revoke,
    _ui: PhantomData<std::rc::Rc<()>>,
}
impl Drop for Owner {
    fn drop(&mut self) {
        unsafe { (self.revoke)(self.observed.token, self.observed.generation) };
    }
}
fn has(state: &Observation, value: u32) -> bool {
    state.states.lock().unwrap().contains(&value)
}
enum WaitPhase {
    BaselineEmpty,
    ContextReady,
    TerminalAck,
    Retired,
}
fn timeout_diagnostic(
    phase: WaitPhase,
    cycle: Option<u64>,
    observed: Option<&Observation>,
    stats: Option<Stats>,
) -> String {
    let phase = match phase {
        WaitPhase::BaselineEmpty => "baseline-empty",
        WaitPhase::ContextReady => "context-ready",
        WaitPhase::TerminalAck => "terminal-ack",
        WaitPhase::Retired => "retired",
    };
    serde_json::json!({
        "failure":"registry-lifecycle-timeout",
        "phase":phase,
        "cycleIndex":cycle,
        "initialized":observed.map(|o| o.initialized.load(Ordering::Acquire)),
        "states":observed.and_then(|o| o.states.lock().ok().map(|s| s.clone())),
        "registrations":stats.map(|s| s.registrations),
        "retiring":stats.map(|s| s.retiring),
        "rootBytes":stats.map(|s| s.root_bytes),
        "tokenHighWater":stats.map(|s| s.token_high_water.to_string()),
    })
    .to_string()
}
fn wait(
    pump: &mut impl FnMut() -> Result,
    ready: impl Fn() -> bool,
    phase: WaitPhase,
    cycle: Option<u64>,
    observed: Option<&Observation>,
    api: &Api,
) -> Result {
    let deadline = Instant::now() + Duration::from_secs(12);
    while !ready() {
        if Instant::now() >= deadline {
            return Err(timeout_diagnostic(phase, cycle, observed, api.stats().ok()).into());
        }
        pump()?;
        std::thread::sleep(Duration::from_millis(2));
    }
    Ok(())
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
struct Stats {
    size: u32,
    abi: u32,
    registrations: u64,
    retiring: u64,
    root_bytes: u64,
    token_high_water: u64,
}
type GetStats = unsafe extern "C" fn(*mut Stats) -> i32;
type Complete = unsafe extern "C" fn(u64, u64, u64, u32, u32) -> i32;
struct Api {
    create: Create,
    apply: Operation,
    revoke: Revoke,
    complete: Complete,
    stats: GetStats,
}
impl Api {
    fn stats(&self) -> Result<Stats> {
        let mut result = Stats {
            size: std::mem::size_of::<Stats>() as u32,
            abi: 2,
            ..Default::default()
        };
        if unsafe { (self.stats)(&mut result) } != 1 {
            return Err("registry metrics unavailable".into());
        }
        Ok(result)
    }
    fn create(
        &self,
        token: u64,
        generation: u64,
        root: &[u8],
        reject: bool,
    ) -> (Option<Owner>, Arc<Observation>) {
        let observed = Arc::new(Observation {
            token,
            generation,
            initialized: AtomicBool::new(false),
            states: Mutex::new(Vec::new()),
            evidence: AtomicUsize::new(0),
            foreign: AtomicUsize::new(0),
            terminal: AtomicBool::new(false),
            after_terminal: AtomicUsize::new(0),
        });
        retained().lock().unwrap().push(observed.clone());
        let roots = [Bytes {
            data: root.as_ptr(),
            length: root.len(),
        }];
        let descriptor = Descriptor {
            size: std::mem::size_of::<Descriptor>() as u32,
            abi: 2,
            token,
            generation,
            user: Arc::as_ptr(&observed).cast_mut().cast(),
            evidence,
            state,
            ca_mode: 2,
            reserved: 0,
            anchors: roots.as_ptr(),
            anchors_len: 1,
        };
        let mut settings = cef::RequestContextSettings::default();
        // The scalar survives the generated Rust-to-C settings conversion and
        // is rejected before token reservation. No filesystem path is used.
        if reject {
            settings.persist_session_cookies = 1;
        }
        let settings = settings.into();
        let handler = Handler::new(observed.clone());
        let raw = unsafe { (self.create)(&descriptor, &settings, handler.get_raw()) };
        let owner = (!raw.is_null()).then(|| Owner {
            _context: raw.wrap_result(),
            observed: observed.clone(),
            revoke: self.revoke,
            _ui: PhantomData,
        });
        (owner, observed)
    }
}
fn clean(observed: &Observation) -> bool {
    observed.foreign.load(Ordering::Acquire) == 0
        && observed.evidence.load(Ordering::Acquire) == 0
        && observed.after_terminal.load(Ordering::Acquire) == 0
}
/// Drive the real host event queue as well as CEF. Calling only runtime.work
/// leaves scheduled Tao wake messages queued during the long registry stress.
pub fn pump(
    runtime: &sorng_browser_host::cef_runtime::CefRuntime,
    events: &mut tao::event_loop::EventLoop<()>,
) -> Result {
    use tao::{event::Event, event_loop::ControlFlow, platform::run_return::EventLoopExtRunReturn};
    let mut result = Ok(());
    events.run_return(|event, _, flow| {
        *flow = ControlFlow::Poll;
        if matches!(event, Event::MainEventsCleared) {
            result = (|| {
                runtime.work()?;
                sorng_browser_host::cef_tls_bridge::pump_tls()?;
                Ok(())
            })();
            *flow = ControlFlow::Exit;
        }
    });
    result
}

/// Runs LAST: raw identities intentionally advance beyond all ordinary host tokens.
/// Every borrowed callback allocation is retained until actual CEF shutdown.
pub fn run(pump: &mut impl FnMut() -> Result, root: &[u8]) -> Result<serde_json::Value> {
    let anchor = unsafe { cef::sys::cef_api_hash(cef::sys::CEF_API_VERSION_LAST, 2) };
    let module = unsafe { loaded_module::Module::from_address(anchor.cast()) }
        .map_err(|_| "loaded CEF image unavailable")?;
    let resolve = |name: &std::ffi::CStr| -> Result<*mut c_void> {
        unsafe { module.symbol(name) }.map_err(|_| "registry ABI export unavailable".into())
    };
    let api = Api {
        create: unsafe {
            std::mem::transmute::<*mut c_void, Create>(resolve(c"cef_sorng_tls_create_context_v2")?)
        },
        apply: unsafe {
            std::mem::transmute::<*mut c_void, Operation>(resolve(c"cef_sorng_tls_apply_proxy_v2")?)
        },
        revoke: unsafe {
            std::mem::transmute::<*mut c_void, Revoke>(resolve(c"cef_sorng_tls_revoke_v2")?)
        },
        complete: unsafe {
            std::mem::transmute::<*mut c_void, Complete>(resolve(c"cef_sorng_tls_complete_v2")?)
        },
        stats: unsafe {
            std::mem::transmute::<*mut c_void, GetStats>(resolve(
                c"cef_sorng_tls_registry_stats_v2",
            )?)
        },
    };
    wait(
        pump,
        || {
            api.stats()
                .is_ok_and(|s| s.registrations == 0 && s.root_bytes == 0)
        },
        WaitPhase::BaselineEmpty,
        None,
        None,
        &api,
    )?;
    let baseline = api.stats()?;
    let first = baseline
        .token_high_water
        .max(2_000_000_000)
        .checked_add(1)
        .ok_or("token range exhausted")?;
    let (rejected, rejected_observed) = api.create(first, first, root, true);
    let rejected_stats = api.stats()?;
    if rejected.is_some()
        || rejected_stats.registrations != 0
        || rejected_stats.token_high_water != baseline.token_high_water
    {
        return Err(format!("rejected factory invariant: returnedContext={}, registrations={}, highWater={}, expectedHighWater={}", rejected.is_some(), rejected_stats.registrations, rejected_stats.token_high_water, baseline.token_high_water).into());
    }
    let mut peak_registrations = 0;
    let mut peak_root_bytes = 0;
    for index in 0..1025u64 {
        let token = first + index;
        let (owner, observed) = api.create(token, token, root, false);
        let owner = owner.ok_or("sequential context creation rejected")?;
        wait(
            pump,
            || observed.initialized.load(Ordering::Acquire) && has(&observed, 1),
            WaitPhase::ContextReady,
            Some(index),
            Some(&observed),
            &api,
        )?;
        let live = api.stats()?;
        peak_registrations = peak_registrations.max(live.registrations);
        peak_root_bytes = peak_root_bytes.max(live.root_bytes);
        if live.registrations != 1
            || live.root_bytes != root.len() as u64
            || live.token_high_water != token
        {
            return Err("live registry/root metrics do not match exact owner".into());
        }
        if index % 2 == 0 {
            unsafe { (api.revoke)(token, token) };
            wait(
                pump,
                || has(&observed, 2),
                WaitPhase::TerminalAck,
                Some(index),
                Some(&observed),
                &api,
            )?;
            // A terminal ACK alone must NOT erase a still-attached registration.
            for _ in 0..3 {
                pump()?;
            }
            if api.stats()?.registrations != 1 {
                return Err("attached revoked registration was erased".into());
            }
        }
        // Odd iterations drop before pumping the revocation ACK; even iterations
        // release only after the ACK. Both orders must reach deferred retirement.
        drop(owner);
        wait(
            pump,
            || {
                has(&observed, 2)
                    && api
                        .stats()
                        .is_ok_and(|s| s.registrations == 0 && s.root_bytes == 0)
            },
            WaitPhase::Retired,
            Some(index),
            Some(&observed),
            &api,
        )?;
        if !clean(&observed) {
            return Err("foreign/evidence/after-terminal callback".into());
        }
        if unsafe { (api.revoke)(token, token) } != 0
            || unsafe { (api.apply)(token, token, 1) } != 0
            || unsafe { (api.complete)(token, token, 1, 0, 0) } != 0
        {
            return Err("retired identity accepted late operation".into());
        }
    }
    let high = api.stats()?.token_high_water;
    for (token, generation) in [(first, first), (first, high + 1), (high - 1, high + 2)] {
        let (owner, observed) = api.create(token, generation, root, false);
        if owner.is_some()
            || !observed.states.lock().unwrap().is_empty()
            || api.stats()?.token_high_water != high
        {
            return Err("replayed/out-of-order identity admitted".into());
        }
    }
    for _ in 0..32 {
        pump()?;
        std::thread::sleep(Duration::from_millis(2));
    }
    if !rejected_observed.states.lock().unwrap().is_empty()
        || !clean(&rejected_observed)
        || retained().lock().unwrap().iter().any(|o| !clean(o))
    {
        return Err("post-retirement or post-NULL callback observed".into());
    }
    let final_stats = api.stats()?;
    if final_stats.registrations != 0 || final_stats.root_bytes != 0 {
        return Err("registry/root storage retained".into());
    }
    let cases = [
        "sequential-1025",
        "attached-revoked-retained",
        "ack-before-detach",
        "detach-before-ack",
        "retired-operation-denial",
        "token-replay-denial",
        "out-of-order-denial",
        "rejected-create-quiescent",
        "root-storage-released",
        "no-late-callbacks",
    ];
    Ok(serde_json::json!({
        "ok":true, "sequentialContexts":1025, "peakRegistrations":peak_registrations,
        "peakRootBytes":peak_root_bytes, "finalRegistrations":final_stats.registrations,
        "finalRootBytes":final_stats.root_bytes, "tokenHighWater":final_stats.token_high_water.to_string(),
        "cases":cases.into_iter().map(|name| serde_json::json!({"case":name,"ok":true})).collect::<Vec<_>>(),
        "browserCreated":false,"networkProbe":false,
        "factoryAbandonFaultInjected":false,"partitionRecreationFaultInjected":false
    }))
}
pub fn after_shutdown() {
    retained().lock().unwrap().clear();
}

#[cfg(test)]
mod diagnostics_tests {
    use super::*;

    #[test]
    fn timeout_preserves_exact_phase_observation_and_lossless_high_water() {
        let observed = Observation {
            token: 123,
            generation: 456,
            initialized: AtomicBool::new(true),
            states: Mutex::new(vec![1, 2]),
            evidence: AtomicUsize::new(0),
            foreign: AtomicUsize::new(0),
            terminal: AtomicBool::new(true),
            after_terminal: AtomicUsize::new(0),
        };
        let report: serde_json::Value = serde_json::from_str(&timeout_diagnostic(
            WaitPhase::Retired,
            Some(1024),
            Some(&observed),
            Some(Stats {
                registrations: 1,
                retiring: 1,
                root_bytes: 379,
                token_high_water: u64::MAX,
                ..Default::default()
            }),
        ))
        .unwrap();
        assert_eq!(report["failure"], "registry-lifecycle-timeout");
        assert_eq!(report["phase"], "retired");
        assert_eq!(report["cycleIndex"], 1024);
        assert_eq!(report["initialized"], true);
        assert_eq!(report["states"], serde_json::json!([1, 2]));
        assert_eq!(report["registrations"], 1);
        assert_eq!(report["retiring"], 1);
        assert_eq!(report["rootBytes"], 379);
        assert_eq!(report["tokenHighWater"], u64::MAX.to_string());
        assert_eq!(report.as_object().unwrap().len(), 9);
        let unavailable: serde_json::Value = serde_json::from_str(&timeout_diagnostic(
            WaitPhase::BaselineEmpty,
            None,
            None,
            None,
        ))
        .unwrap();
        assert_eq!(unavailable["phase"], "baseline-empty");
        assert!(unavailable["states"].is_null());
        assert!(unavailable["registrations"].is_null());
    }
}
