//! Opt-in engineering-only ABI negatives. Never creates a browser or URL request.
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
use super::registry_retirement_fixture::loaded_module;
struct Observation {
    token: u64,
    generation: u64,
    initialized: AtomicBool,
    states: Mutex<Vec<u32>>,
    evidence: AtomicUsize,
    foreign: AtomicUsize,
}
fn retained() -> &'static Mutex<Vec<Arc<Observation>>> {
    static RETAINED: OnceLock<Mutex<Vec<Arc<Observation>>>> = OnceLock::new();
    RETAINED.get_or_init(Mutex::default)
}
unsafe extern "C" fn evidence(user: *mut c_void, _: *const c_void) {
    if let Some(state) = unsafe { user.cast::<Observation>().as_ref() } {
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
    context: RequestContext,
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
fn wait(pump: &mut impl FnMut() -> Result, ready: impl Fn() -> bool) -> Result {
    let deadline = Instant::now() + Duration::from_secs(12);
    while !ready() {
        if Instant::now() >= deadline {
            return Err("native proxy boundary fixture timed out".into());
        }
        pump()?;
        std::thread::sleep(Duration::from_millis(2));
    }
    Ok(())
}
fn configure(context: &RequestContext, mode: &str, server: &str) -> Result {
    let mut dictionary = dictionary_value_create().ok_or("proxy dictionary unavailable")?;
    for (key, value) in [
        ("mode", mode),
        ("server", server),
        ("bypass_list", "<-loopback>"),
    ] {
        if dictionary.set_string(Some(&CefString::from(key)), Some(&CefString::from(value))) != 1 {
            return Err("proxy fixture value rejected".into());
        }
    }
    let mut value = value_create().ok_or("proxy value unavailable")?;
    if value.set_dictionary(Some(&mut dictionary)) != 1 {
        return Err("proxy fixture dictionary rejected".into());
    }
    let mut error = CefString::from("");
    if context.set_preference(
        Some(&CefString::from("proxy")),
        Some(&mut value),
        Some(&mut error),
    ) != 1
    {
        return Err("proxy fixture preference rejected".into());
    }
    Ok(())
}
/// The enclosing fixture already validates the exact loaded patch3 package.
/// Every callback allocation is retained until actual CEF shutdown, including
/// early errors. No loaded module or published package is replaced or modified.
pub fn run(pump: &mut impl FnMut() -> Result, port: u16) -> Result<serde_json::Value> {
    if port == 0 {
        return Err("owned port unavailable".into());
    }
    let anchor = unsafe { cef::sys::cef_api_hash(cef::sys::CEF_API_VERSION_LAST, 2) };
    let module = unsafe { loaded_module::Module::from_address(anchor.cast()) }
        .map_err(|_| "loaded CEF image unavailable")?;
    let resolve = |name: &std::ffi::CStr| -> Result<*mut c_void> {
        unsafe { module.symbol(name) }.map_err(|_| "proxy ACK export unavailable".into())
    };
    let create: Create =
        unsafe { std::mem::transmute(resolve(c"cef_sorng_tls_create_context_v2")?) };
    let apply: Operation =
        unsafe { std::mem::transmute(resolve(c"cef_sorng_tls_apply_proxy_v2")?) };
    let revoke: Revoke = unsafe { std::mem::transmute(resolve(c"cef_sorng_tls_revoke_v2")?) };
    let wrong = if port == u16::MAX { 1 } else { port + 1 };
    let cases = [
        (
            "wrong-port",
            "fixed_servers",
            format!("http://127.0.0.1:{wrong}"),
            false,
        ),
        ("direct", "direct", String::new(), false),
        (
            "fallback",
            "fixed_servers",
            format!("http://127.0.0.1:{port},direct://"),
            false,
        ),
        (
            "replace-during-ack",
            "fixed_servers",
            format!("http://127.0.0.1:{port}"),
            false,
        ),
        (
            "revoke-before-ack",
            "fixed_servers",
            format!("http://127.0.0.1:{port}"),
            true,
        ),
    ];
    let mut reports = Vec::new();
    for (index, (name, mode, server, cancel)) in cases.into_iter().enumerate() {
        let token = 1_000_000_000 + index as u64;
        let observed = Arc::new(Observation {
            token,
            generation: token + 100,
            initialized: AtomicBool::new(false),
            states: Mutex::new(Vec::new()),
            evidence: AtomicUsize::new(0),
            foreign: AtomicUsize::new(0),
        });
        retained().lock().unwrap().push(observed.clone());
        let descriptor = Descriptor {
            size: std::mem::size_of::<Descriptor>() as u32,
            abi: 2,
            token,
            generation: token + 100,
            user: Arc::as_ptr(&observed).cast_mut().cast(),
            evidence,
            state,
            ca_mode: 0,
            reserved: 0,
            anchors: std::ptr::null(),
            anchors_len: 0,
        };
        let settings = cef::RequestContextSettings::default().into();
        let handler = Handler::new(observed.clone());
        let raw = unsafe { create(&descriptor, &settings, handler.get_raw()) };
        if raw.is_null() {
            return Err("negative fixture context creation failed".into());
        }
        let owner = Owner {
            context: raw.wrap_result(),
            observed: observed.clone(),
            revoke,
            _ui: PhantomData,
        };
        wait(pump, || {
            observed.initialized.load(Ordering::Acquire) && has(&observed, 1)
        })?;
        configure(&owner.context, mode, &server)?;
        if unsafe { apply(token, token + 100, port) } != 1 {
            return Err("native proxy request was not admitted".into());
        }
        if name == "replace-during-ack" {
            configure(
                &owner.context,
                "fixed_servers",
                &format!("http://127.0.0.1:{wrong}"),
            )?;
        }
        if cancel {
            unsafe { revoke(token, token + 100) };
        }
        wait(pump, || has(&observed, if cancel { 2 } else { 5 }))?;
        unsafe { revoke(token, token + 100) };
        wait(pump, || has(&observed, 2))?;
        let states = observed.states.lock().unwrap().clone();
        let clean = !states.contains(&4)
            && !states.contains(&3)
            && observed.evidence.load(Ordering::Acquire) == 0
            && observed.foreign.load(Ordering::Acquire) == 0;
        reports.push(serde_json::json!({"case":name,"ok":clean,"states":states,"tlsEvidence":observed.evidence.load(Ordering::Acquire),"browserCreated":false}));
        if !clean {
            return Err("native proxy negative case failed closed-state checks".into());
        }
        drop(owner);
    }
    Ok(
        serde_json::json!({"ok":true,"cases":reports,"pacPreferenceTested":false,"networkProbe":false}),
    )
}
pub fn after_shutdown() {
    retained().lock().unwrap().clear();
}
