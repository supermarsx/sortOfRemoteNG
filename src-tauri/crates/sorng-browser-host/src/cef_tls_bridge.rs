//! Side ABI V2 for the patched, already-loaded CEF. No renderer-facing API.
//! Main must pump replies on CEF UI and call `after_cef_shutdown` after shutdown.
//! Export/build checks prove compatibility, not package provenance/containment.

use cef::{
    rc::ConvertReturnValue, ImplRequestContextHandler, RequestContext, RequestContextHandler,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::{c_char, c_void, CStr},
    marker::PhantomData,
    panic::{catch_unwind, AssertUnwindSafe},
    ptr,
    rc::Rc,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
    time::{Duration, Instant},
};

pub const CEF_REVISION: &str = "682c378d70d5780061e96644dca16ddd8fd157a9";
pub const CHROMIUM_VERSION: &str = "154.0.8037.58";
pub const PATCH_ID: &str = "sorng-tls-v2-682c378-1";
const ABI: u32 = 2;
const SOCKET: u64 = 1;
const REVOKE: u64 = 2;
const HTTP1: u64 = 4;
const EXCEPTIONS: u64 = 8;
const CUSTOM_CA: u64 = 16;
const PRIVATE: u64 = 32;
const REQUIRED: u64 = SOCKET | REVOKE | HTTP1 | PRIVATE;
const MAX_CHAIN: usize = 64;
const MAX_CERT: usize = 256 * 1024;
const MAX_CHAIN_BYTES: usize = 4 * 1024 * 1024;
const MAX_PENDING: usize = 64;
const TIMEOUT: Duration = Duration::from_secs(120);
static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);
static SHUT_DOWN: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum NativeTlsError {
    #[error("The loaded CEF does not provide the required native TLS bridge")]
    Unavailable,
    #[error("The loaded CEF TLS bridge does not match the required build or ABI")]
    Incompatible,
    #[error("Native TLS bridge work must run on the initialized CEF UI thread")]
    WrongThread,
    #[error("Native TLS bridge evidence or configuration is invalid")]
    Invalid,
    #[error("Native TLS bridge context failed or was revoked")]
    Revoked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum NativeTlsCaMode {
    System = 0,
    SystemPlusCustom = 1,
    CustomOnly = 2,
}

/// Native-owned configuration. No filesystem/profile paths; DER only.
pub struct NativeTlsConfig {
    pub ca_mode: NativeTlsCaMode,
    pub trust_anchors: Vec<Vec<u8>>,
    /// Set when saved app policy may require an exact certificate exception.
    pub require_scoped_exceptions: bool,
}
impl Default for NativeTlsConfig {
    fn default() -> Self {
        Self {
            ca_mode: NativeTlsCaMode::System,
            trust_anchors: vec![],
            require_scoped_exceptions: false,
        }
    }
}

/// Owned copies of native handshake evidence; deliberately no Debug/serde.
pub struct NativeTlsEvidence {
    pub context_token: u64,
    pub generation: u64,
    pub challenge: u64,
    pub hostname: String,
    pub port: u16,
    pub origin: String,
    pub native_error: i32,
    pub certificate_status: u32,
    pub fatal_error: bool,
    pub issued_by_known_root: bool,
    pub peer_chain: Vec<Vec<u8>>,
    pub verified_chain: Vec<Vec<u8>>,
    pub ca_mode: NativeTlsCaMode,
    pub allowed_exception_mask: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeTlsDecision {
    Deny,
    AdmitNative,
    AdmitException { mask: u32 },
}

/// Callback must only enqueue asynchronous authority work, never block CEF UI.
/// Main rechecks owner/trust/pin/chain/destination before consuming completion.
pub trait NativeTlsHooks: Send + Sync {
    fn on_evidence(&self, evidence: NativeTlsEvidence, completion: NativeTlsCompletion);
    /// Exact creation-time owner/attempt lease; must be quick and nonblocking.
    fn is_current(&self) -> bool;
    /// Synchronously revoke proxy/credential leases; enqueue native cleanup.
    fn on_failure(&self);
}

#[repr(C)]
struct Bytes {
    data: *const u8,
    length: usize,
}
#[repr(C)]
struct Evidence {
    size: u32,
    abi_version: u32,
    context_token: u64,
    generation: u64,
    challenge: u64,
    hostname: Bytes,
    port: u16,
    reserved: u16,
    native_error: i32,
    certificate_status: u32,
    fatal_error: u32,
    issued_by_known_root: u32,
    peer_chain: *const Bytes,
    peer_chain_count: usize,
    verified_chain: *const Bytes,
    verified_chain_count: usize,
    ca_mode: u32,
    allowed_exception_mask: u32,
}
#[repr(C)]
struct Context {
    size: u32,
    abi_version: u32,
    context_token: u64,
    generation: u64,
    user_data: *mut c_void,
    on_evidence: unsafe extern "C" fn(*mut c_void, *const Evidence),
    on_state: unsafe extern "C" fn(*mut c_void, u64, u64, u32),
    ca_mode: u32,
    reserved: u32,
    trust_anchors: *const Bytes,
    trust_anchor_count: usize,
}
#[repr(C)]
struct Api {
    size: u32,
    abi_version: u32,
    capabilities: u64,
    cef_revision: *const c_char,
    chromium_version: *const c_char,
    patch_id: *const c_char,
}
type GetApi = unsafe extern "C" fn() -> *const Api;
type Create = unsafe extern "C" fn(
    *const Context,
    *const cef::sys::_cef_request_context_settings_t,
    *mut cef::sys::_cef_request_context_handler_t,
) -> *mut cef::sys::_cef_request_context_t;
type Complete = unsafe extern "C" fn(u64, u64, u64, u32, u32) -> i32;
type Revoke = unsafe extern "C" fn(u64, u64) -> i32;
#[derive(Clone, Copy)]
struct Functions {
    create: Create,
    complete: Complete,
    revoke: Revoke,
    capabilities: u64,
}

fn on_ui() -> Result<(), NativeTlsError> {
    if SHUT_DOWN.load(Ordering::Acquire) {
        return Err(NativeTlsError::Revoked);
    }
    if cef::currently_on(cef::ThreadId::UI) == 0 {
        return Err(NativeTlsError::WrongThread);
    }
    Ok(())
}

/// Bounded native strings. ABI owns the readable allocation through NUL.
unsafe fn matches_pin(value: *const c_char, expected: &str) -> bool {
    if value.is_null() || expected.is_empty() || expected.len() > 128 {
        return false;
    }
    for (offset, byte) in expected.bytes().chain(std::iter::once(0)).enumerate() {
        if unsafe { *value.add(offset) as u8 } != byte {
            return false;
        }
    }
    true
}

/// Non-Send UI capability acquired from actual loaded CEF, never a path supplied
/// by the renderer. `patch_id` must come from the reviewed native package pin.
pub struct NativeTlsBridge {
    functions: Functions,
    _ui: PhantomData<Rc<()>>,
}
impl NativeTlsBridge {
    /// # Safety
    /// CEF must already be initialized and remain loaded through shutdown.
    /// Package provenance must be verified independently before loading CEF.
    pub unsafe fn from_loaded(patch_id: &str) -> Result<Self, NativeTlsError> {
        on_ui()?;
        // Unlike a CEF function address (a loader trampoline on macOS), this
        // static string is owned by the actual loaded libcef/framework image.
        let anchor = unsafe { cef::sys::cef_api_hash(cef::sys::CEF_API_VERSION_LAST, 2) };
        if !unsafe { matches_pin(anchor, CEF_REVISION) } {
            return Err(NativeTlsError::Incompatible);
        }
        let module = unsafe { loaded_module::Module::from_address(anchor.cast()) }?;
        let get: GetApi =
            unsafe { std::mem::transmute(module.symbol(c"cef_sorng_tls_get_api_v2")?) };
        let api = unsafe { get() };
        if api.is_null() || unsafe { (*api).size } != std::mem::size_of::<Api>() as u32 {
            return Err(NativeTlsError::Incompatible);
        }
        let api = unsafe { &*api };
        if api.abi_version != ABI
            || api.capabilities & REQUIRED != REQUIRED
            || !unsafe { matches_pin(api.cef_revision, CEF_REVISION) }
            || !unsafe { matches_pin(api.chromium_version, CHROMIUM_VERSION) }
            || !unsafe { matches_pin(api.patch_id, patch_id) }
        {
            return Err(NativeTlsError::Incompatible);
        }
        Ok(Self {
            functions: Functions {
                create: unsafe {
                    std::mem::transmute(module.symbol(c"cef_sorng_tls_create_context_v2")?)
                },
                complete: unsafe {
                    std::mem::transmute(module.symbol(c"cef_sorng_tls_complete_v2")?)
                },
                revoke: unsafe { std::mem::transmute(module.symbol(c"cef_sorng_tls_revoke_v2")?) },
                capabilities: api.capabilities,
            },
            _ui: PhantomData,
        })
    }

    pub fn supports_scoped_exceptions(&self) -> bool {
        self.functions.capabilities & EXCEPTIONS != 0
    }
    pub fn supports_custom_ca(&self) -> bool {
        self.functions.capabilities & CUSTOM_CA != 0
    }

    /// Creates only a distinct, nonpersistent native context. Callback userdata
    /// is registered before FFI and retained even if native creation fails.
    pub(crate) fn create_context(
        &self,
        config: &NativeTlsConfig,
        hooks: Arc<dyn NativeTlsHooks>,
        handler: &mut RequestContextHandler,
        cookies_enabled: bool,
    ) -> Result<(RequestContext, NativeTlsContext), NativeTlsError> {
        on_ui()?;
        validate_config(config, self.functions.capabilities)?;
        let token = NEXT_TOKEN
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_add(1))
            .map_err(|_| NativeTlsError::Revoked)?;
        let state = Arc::new(Shared {
            token,
            generation: token,
            ca_mode: config.ca_mode,
            functions: self.functions,
            hooks,
            data: Mutex::new(Data {
                status: NativeTlsStatus::Initializing,
                installed: false,
                revoke_sent: false,
                challenges: BTreeMap::new(),
                seen: BTreeSet::new(),
            }),
        });
        {
            let mut registry = retained().lock().map_err(|_| NativeTlsError::Revoked)?;
            if registry.len() >= 256 {
                return Err(NativeTlsError::Unavailable);
            }
            registry.insert(token, state.clone());
        }
        let anchors: Vec<_> = config
            .trust_anchors
            .iter()
            .map(|der| Bytes {
                data: der.as_ptr(),
                length: der.len(),
            })
            .collect();
        let descriptor = Context {
            size: std::mem::size_of::<Context>() as u32,
            abi_version: ABI,
            context_token: token,
            generation: token,
            user_data: Arc::as_ptr(&state).cast_mut().cast(),
            on_evidence: evidence_callback,
            on_state: state_callback,
            ca_mode: config.ca_mode as u32,
            reserved: 0,
            trust_anchors: anchors.as_ptr(),
            trust_anchor_count: anchors.len(),
        };
        // Empty cache/scheme paths remain private and in memory. Unlike a
        // COOKIES content setting, supported schemes do not also disable IDB
        // or localStorage. This uses existing CEF fields, not a bridge ABI change.
        let settings = cookie_context_settings(cookies_enabled).into();
        // V2 specifies a BORROWED handler. Do not transfer an extra Rust ref.
        let raw = unsafe { (self.functions.create)(&descriptor, &settings, handler.get_raw()) };
        let owner = NativeTlsContext {
            state,
            _ui: PhantomData,
        };
        if raw.is_null() {
            owner.state.fail();
            return Err(NativeTlsError::Unavailable);
        }
        Ok((raw.wrap_result(), owner))
    }
}

fn cookie_context_settings(cookies_enabled: bool) -> cef::RequestContextSettings {
    cef::RequestContextSettings {
        cookieable_schemes_exclude_defaults: i32::from(!cookies_enabled),
        ..Default::default()
    }
}

fn validate_config(config: &NativeTlsConfig, capabilities: u64) -> Result<(), NativeTlsError> {
    if config.require_scoped_exceptions && capabilities & EXCEPTIONS == 0 {
        return Err(NativeTlsError::Unavailable);
    }
    if config.ca_mode == NativeTlsCaMode::System {
        if !config.trust_anchors.is_empty() {
            return Err(NativeTlsError::Invalid);
        }
    } else if capabilities & CUSTOM_CA == 0 {
        return Err(NativeTlsError::Unavailable);
    } else if config.trust_anchors.is_empty() {
        return Err(NativeTlsError::Invalid);
    }
    if config.trust_anchors.len() > MAX_CHAIN
        || config
            .trust_anchors
            .iter()
            .any(|v| v.is_empty() || v.len() > MAX_CERT)
        || config.trust_anchors.iter().map(Vec::len).sum::<usize>() > MAX_CHAIN_BYTES
    {
        return Err(NativeTlsError::Invalid);
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeTlsStatus {
    Initializing,
    Installed,
    Revoking,
    Revoked,
    Failed,
}
struct Challenge {
    native_ok: bool,
    fatal: bool,
    mask: u32,
    since: Instant,
    decision: Option<NativeTlsDecision>,
}
struct Data {
    status: NativeTlsStatus,
    installed: bool,
    revoke_sent: bool,
    challenges: BTreeMap<u64, Challenge>,
    seen: BTreeSet<u64>,
}
struct Shared {
    token: u64,
    generation: u64,
    ca_mode: NativeTlsCaMode,
    functions: Functions,
    hooks: Arc<dyn NativeTlsHooks>,
    data: Mutex<Data>,
}
fn retained() -> &'static Mutex<BTreeMap<u64, Arc<Shared>>> {
    static RETAINED: OnceLock<Mutex<BTreeMap<u64, Arc<Shared>>>> = OnceLock::new();
    RETAINED.get_or_init(Mutex::default)
}
impl Shared {
    fn fail(&self) {
        {
            let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());
            if matches!(
                data.status,
                NativeTlsStatus::Failed | NativeTlsStatus::Revoked
            ) {
                return;
            }
            data.status = NativeTlsStatus::Failed;
            data.challenges.clear();
        }
        let _ = catch_unwind(AssertUnwindSafe(|| self.hooks.on_failure()));
    }
    fn revoke(&self) {
        let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        if !matches!(
            data.status,
            NativeTlsStatus::Failed | NativeTlsStatus::Revoked
        ) {
            data.status = NativeTlsStatus::Revoking;
        }
        data.challenges.clear();
    }
}

/// Sendable one-use response. Drop queues denial; no CEF call on worker threads.
pub struct NativeTlsCompletion {
    state: Weak<Shared>,
    challenge: u64,
    used: bool,
}
impl NativeTlsCompletion {
    /// For time-limited authority permits, recheck the permit on the CEF UI
    /// thread and call this followed immediately by `pump_tls`, without await.
    /// Queuing a decision never extends the authority permit's lifetime.
    pub fn complete(mut self, decision: NativeTlsDecision) {
        self.queue(decision);
    }
    fn queue(&mut self, decision: NativeTlsDecision) {
        if self.used {
            return;
        }
        self.used = true;
        let Some(state) = self.state.upgrade() else {
            return;
        };
        let mut data = match state.data.lock() {
            Ok(data) => data,
            Err(poisoned) => {
                drop(poisoned.into_inner());
                state.fail();
                return;
            }
        };
        if data.status != NativeTlsStatus::Installed {
            return;
        }
        if let Some(challenge) = data.challenges.get_mut(&self.challenge) {
            if challenge.decision.is_none() {
                challenge.decision = Some(validate_decision(
                    challenge,
                    decision,
                    state.functions.capabilities,
                ));
            }
        }
    }
}
impl Drop for NativeTlsCompletion {
    fn drop(&mut self) {
        self.queue(NativeTlsDecision::Deny);
    }
}
fn validate_decision(
    challenge: &Challenge,
    decision: NativeTlsDecision,
    capabilities: u64,
) -> NativeTlsDecision {
    if challenge.since.elapsed() >= TIMEOUT {
        return NativeTlsDecision::Deny;
    }
    match decision {
        NativeTlsDecision::AdmitNative if challenge.native_ok && !challenge.fatal => decision,
        NativeTlsDecision::AdmitException { mask }
            if capabilities & EXCEPTIONS != 0
                && !challenge.native_ok
                && !challenge.fatal
                && mask != 0
                && mask == challenge.mask
                && mask & !7 == 0 =>
        {
            decision
        }
        _ => NativeTlsDecision::Deny,
    }
}

pub struct NativeTlsContext {
    state: Arc<Shared>,
    _ui: PhantomData<Rc<()>>,
}
impl NativeTlsContext {
    pub fn status(&self) -> NativeTlsStatus {
        self.state
            .data
            .lock()
            .map(|d| d.status)
            .unwrap_or(NativeTlsStatus::Failed)
    }
    pub fn revoke(&self) {
        self.state.revoke();
    }
}
impl Drop for NativeTlsContext {
    fn drop(&mut self) {
        self.state.revoke();
    }
}

unsafe fn copy_bytes(value: &Bytes, max: usize) -> Result<Vec<u8>, NativeTlsError> {
    if value.data.is_null() || value.length == 0 || value.length > max {
        return Err(NativeTlsError::Invalid);
    }
    Ok(unsafe { std::slice::from_raw_parts(value.data, value.length) }.to_vec())
}
unsafe fn copy_chain(
    values: *const Bytes,
    count: usize,
    allow_empty: bool,
) -> Result<Vec<Vec<u8>>, NativeTlsError> {
    if count == 0 {
        return if allow_empty {
            Ok(vec![])
        } else {
            Err(NativeTlsError::Invalid)
        };
    }
    if values.is_null() || count > MAX_CHAIN {
        return Err(NativeTlsError::Invalid);
    }
    let mut total = 0;
    unsafe { std::slice::from_raw_parts(values, count) }
        .iter()
        .map(|value| {
            total += value.length.min(MAX_CHAIN_BYTES + 1);
            if total > MAX_CHAIN_BYTES {
                return Err(NativeTlsError::Invalid);
            }
            unsafe { copy_bytes(value, MAX_CERT) }
        })
        .collect()
}
unsafe fn owned_evidence(
    raw: *const Evidence,
    state: &Shared,
) -> Result<NativeTlsEvidence, NativeTlsError> {
    if raw.is_null() || unsafe { (*raw).size } != std::mem::size_of::<Evidence>() as u32 {
        return Err(NativeTlsError::Invalid);
    }
    let value = unsafe { &*raw };
    if value.abi_version != ABI
        || value.context_token != state.token
        || value.generation != state.generation
        || value.challenge == 0
        || value.port == 0
        || value.reserved != 0
        || value.fatal_error > 1
        || value.issued_by_known_root > 1
        || value.ca_mode != state.ca_mode as u32
        || value.allowed_exception_mask & !7 != 0
        || value.native_error > 0
        || (value.native_error == 0 && value.allowed_exception_mask != 0)
        || (value.fatal_error != 0 && value.allowed_exception_mask != 0)
    {
        return Err(NativeTlsError::Invalid);
    }
    let hostname = String::from_utf8(unsafe { copy_bytes(&value.hostname, 253) }?)
        .map_err(|_| NativeTlsError::Invalid)?;
    // A canonical hostname, never a URL, userinfo, port suffix or proxy endpoint.
    let authority_host = match hostname.parse::<std::net::Ipv6Addr>() {
        Ok(address) if address.to_string() == hostname => format!("[{hostname}]"),
        _ => {
            let host = url::Host::parse(&hostname).map_err(|_| NativeTlsError::Invalid)?;
            if host.to_string() != hostname || hostname.starts_with('[') {
                return Err(NativeTlsError::Invalid);
            }
            hostname.clone()
        }
    };
    if hostname.bytes().any(|b| b <= 32 || b == 127) {
        return Err(NativeTlsError::Invalid);
    }
    let origin = url::Url::parse(&format!("https://{authority_host}:{}", value.port))
        .map_err(|_| NativeTlsError::Invalid)?
        .origin()
        .ascii_serialization();
    Ok(NativeTlsEvidence {
        context_token: value.context_token,
        generation: value.generation,
        challenge: value.challenge,
        hostname,
        port: value.port,
        origin,
        native_error: value.native_error,
        certificate_status: value.certificate_status,
        fatal_error: value.fatal_error != 0,
        issued_by_known_root: value.issued_by_known_root != 0,
        peer_chain: unsafe { copy_chain(value.peer_chain, value.peer_chain_count, false) }?,
        verified_chain: unsafe {
            copy_chain(
                value.verified_chain,
                value.verified_chain_count,
                value.native_error != 0,
            )
        }?,
        ca_mode: state.ca_mode,
        allowed_exception_mask: value.allowed_exception_mask,
    })
}

// Registry owns userdata until ACK; clone first so ACK can safely remove it.
unsafe fn callback_state(data: *mut c_void) -> Option<Arc<Shared>> {
    if data.is_null() {
        return None;
    }
    let raw = data.cast::<Shared>();
    unsafe {
        Arc::increment_strong_count(raw);
        Some(Arc::from_raw(raw))
    }
}
unsafe extern "C" fn evidence_callback(user: *mut c_void, raw: *const Evidence) {
    let Some(state) = (unsafe { callback_state(user) }) else {
        return;
    };
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<(), NativeTlsError> {
        on_ui()?;
        if !state.hooks.is_current() {
            return Err(NativeTlsError::Revoked);
        }
        let evidence = unsafe { owned_evidence(raw, &state) }?;
        {
            let mut data = state.data.lock().map_err(|_| NativeTlsError::Revoked)?;
            if data.status != NativeTlsStatus::Installed
                || data.challenges.len() >= MAX_PENDING
                || data.seen.len() >= 65_536
                || !data.seen.insert(evidence.challenge)
            {
                return Err(NativeTlsError::Invalid);
            }
            data.challenges.insert(
                evidence.challenge,
                Challenge {
                    native_ok: evidence.native_error == 0,
                    fatal: evidence.fatal_error,
                    mask: evidence.allowed_exception_mask,
                    since: Instant::now(),
                    decision: None,
                },
            );
        }
        let completion = NativeTlsCompletion {
            state: Arc::downgrade(&state),
            challenge: evidence.challenge,
            used: false,
        };
        state.hooks.on_evidence(evidence, completion);
        Ok(())
    }));
    if !matches!(result, Ok(Ok(()))) {
        state.fail();
    }
}
unsafe extern "C" fn state_callback(user: *mut c_void, token: u64, generation: u64, status: u32) {
    let Some(state) = (unsafe { callback_state(user) }) else {
        return;
    };
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<(), NativeTlsError> {
        on_ui()?;
        accept_state(&state, token, generation, status)
    }));
    if !matches!(result, Ok(Ok(()))) {
        state.fail();
    }
}

fn accept_state(
    state: &Arc<Shared>,
    token: u64,
    generation: u64,
    status: u32,
) -> Result<(), NativeTlsError> {
    if state.token != token || state.generation != generation {
        return Err(NativeTlsError::Invalid);
    }
    let mut data = state.data.lock().map_err(|_| NativeTlsError::Revoked)?;
    match status {
        1 if !data.installed && data.status == NativeTlsStatus::Initializing => {
            data.installed = true;
            data.status = NativeTlsStatus::Installed;
        }
        // V2 repeats installation acknowledgments for additional storage
        // partitions. This is idempotent only while the context is active:
        // a late acknowledgment must never revive a revoked/failed context.
        1 if data.installed && data.status == NativeTlsStatus::Installed => {}
        2 if data.status != NativeTlsStatus::Revoked => {
            // Native detach/fault can finish revocation before the app sends
            // its own revoke. State 2 still terminates all userdata callbacks.
            let native_initiated = !data.revoke_sent;
            data.status = NativeTlsStatus::Revoked;
            data.challenges.clear();
            drop(data);
            retained()
                .lock()
                .map_err(|_| NativeTlsError::Revoked)?
                .remove(&token);
            if native_initiated {
                // Revoke app proxy/credential leases too, without holding a
                // registry or challenge lock across application callbacks.
                let _ = catch_unwind(AssertUnwindSafe(|| state.hooks.on_failure()));
            }
        }
        _ => return Err(NativeTlsError::Revoked),
    }
    Ok(())
}

/// Main's CEF UI housekeeping tick, including cleanup-only ticks. No registry
/// or challenge lock is held across an FFI call (callbacks may be synchronous).
pub fn pump_tls() -> Result<(), NativeTlsError> {
    on_ui()?;
    pump_inner()
}

fn pump_inner() -> Result<(), NativeTlsError> {
    let states: Vec<_> = retained()
        .lock()
        .map_err(|_| NativeTlsError::Revoked)?
        .values()
        .cloned()
        .collect();
    for state in states {
        let (revoke, replies) = {
            let mut data = state.data.lock().unwrap_or_else(|e| e.into_inner());
            if matches!(
                data.status,
                NativeTlsStatus::Revoking | NativeTlsStatus::Failed
            ) {
                let send = !data.revoke_sent;
                data.revoke_sent = true;
                (send, vec![])
            } else if data.status == NativeTlsStatus::Installed {
                let ids: Vec<_> = data
                    .challenges
                    .iter()
                    .filter(|(_, c)| c.decision.is_some() || c.since.elapsed() >= TIMEOUT)
                    .map(|(id, _)| *id)
                    .collect();
                let replies = ids
                    .into_iter()
                    .map(|id| {
                        let c = data.challenges.remove(&id).expect("collected challenge");
                        (
                            id,
                            validate_decision(
                                &c,
                                c.decision.unwrap_or(NativeTlsDecision::Deny),
                                state.functions.capabilities,
                            ),
                        )
                    })
                    .collect();
                (false, replies)
            } else {
                (false, vec![])
            }
        };
        if revoke && unsafe { (state.functions.revoke)(state.token, state.generation) } != 1 {
            state.fail();
        }
        for (challenge, decision) in replies {
            // A synchronous previous reply may revoke this very context.
            if state
                .data
                .lock()
                .map(|d| d.status != NativeTlsStatus::Installed)
                .unwrap_or(true)
            {
                break;
            }
            if !matches!(
                catch_unwind(AssertUnwindSafe(|| state.hooks.is_current())),
                Ok(true)
            ) {
                state.fail();
                break;
            }
            let (decision, mask) = match decision {
                NativeTlsDecision::Deny => (0, 0),
                NativeTlsDecision::AdmitNative => (1, 0),
                NativeTlsDecision::AdmitException { mask } => (2, mask),
            };
            if unsafe {
                (state.functions.complete)(state.token, state.generation, challenge, decision, mask)
            } != 1
            {
                state.fail();
                break;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn cookie_switch_excludes_all_schemes_without_enabling_disk_or_shared_storage() {
        for enabled in [true, false] {
            let settings = cookie_context_settings(enabled);
            assert_eq!(
                settings.cookieable_schemes_exclude_defaults,
                i32::from(!enabled)
            );
            assert!(settings.cookieable_schemes_list.to_string().is_empty());
            assert!(settings.cache_path.to_string().is_empty());
            assert_eq!(settings.persist_session_cookies, 0);
        }
    }

    static TEST_LOCK: Mutex<()> = Mutex::new(());
    static REPLIES: Mutex<Vec<(u64, u64, u64, u32, u32)>> = Mutex::new(Vec::new());
    static REVOKES: AtomicUsize = AtomicUsize::new(0);
    struct Hooks {
        current: AtomicBool,
        failures: AtomicUsize,
    }
    impl NativeTlsHooks for Hooks {
        fn on_evidence(&self, _: NativeTlsEvidence, _: NativeTlsCompletion) {}
        fn is_current(&self) -> bool {
            self.current.load(Ordering::Acquire)
        }
        fn on_failure(&self) {
            self.failures.fetch_add(1, Ordering::AcqRel);
        }
    }
    unsafe extern "C" fn create(
        _: *const Context,
        _: *const cef::sys::_cef_request_context_settings_t,
        _: *mut cef::sys::_cef_request_context_handler_t,
    ) -> *mut cef::sys::_cef_request_context_t {
        ptr::null_mut()
    }
    unsafe extern "C" fn complete(t: u64, g: u64, c: u64, d: u32, m: u32) -> i32 {
        REPLIES.lock().unwrap().push((t, g, c, d, m));
        1
    }
    unsafe extern "C" fn revoke(_: u64, _: u64) -> i32 {
        REVOKES.fetch_add(1, Ordering::AcqRel);
        1
    }
    fn fixture() -> (Arc<Shared>, Arc<Hooks>) {
        let hooks = Arc::new(Hooks {
            current: AtomicBool::new(true),
            failures: AtomicUsize::new(0),
        });
        let state = Arc::new(Shared {
            token: 71,
            generation: 72,
            ca_mode: NativeTlsCaMode::System,
            functions: Functions {
                create,
                complete,
                revoke,
                capabilities: REQUIRED | EXCEPTIONS | CUSTOM_CA,
            },
            hooks: hooks.clone(),
            data: Mutex::new(Data {
                status: NativeTlsStatus::Installed,
                installed: true,
                revoke_sent: false,
                challenges: BTreeMap::new(),
                seen: BTreeSet::new(),
            }),
        });
        (state, hooks)
    }
    fn pending(state: &Arc<Shared>, challenge: u64) -> NativeTlsCompletion {
        state.data.lock().unwrap().challenges.insert(
            challenge,
            Challenge {
                native_ok: true,
                fatal: false,
                mask: 0,
                since: Instant::now(),
                decision: None,
            },
        );
        NativeTlsCompletion {
            state: Arc::downgrade(state),
            challenge,
            used: false,
        }
    }
    fn raw_evidence(host: &[u8], chain: &[Bytes]) -> Evidence {
        Evidence {
            size: std::mem::size_of::<Evidence>() as u32,
            abi_version: ABI,
            context_token: 71,
            generation: 72,
            challenge: 9,
            hostname: Bytes {
                data: host.as_ptr(),
                length: host.len(),
            },
            port: 443,
            reserved: 0,
            native_error: 0,
            certificate_status: 0,
            fatal_error: 0,
            issued_by_known_root: 1,
            peer_chain: chain.as_ptr(),
            peer_chain_count: chain.len(),
            verified_chain: chain.as_ptr(),
            verified_chain_count: chain.len(),
            ca_mode: 0,
            allowed_exception_mask: 0,
        }
    }

    #[test]
    #[cfg(target_pointer_width = "64")]
    fn v2_layout_matches_header_on_64_bit_targets() {
        assert_eq!(std::mem::size_of::<Bytes>(), 16);
        assert_eq!(std::mem::size_of::<Evidence>(), 112);
        assert_eq!(std::mem::offset_of!(Evidence, hostname), 32);
        assert_eq!(std::mem::offset_of!(Evidence, peer_chain), 72);
        assert_eq!(std::mem::offset_of!(Evidence, allowed_exception_mask), 108);
        assert_eq!(std::mem::size_of::<Context>(), 72);
        assert_eq!(std::mem::offset_of!(Context, trust_anchors), 56);
        assert_eq!(std::mem::size_of::<Api>(), 40);
    }
    #[test]
    fn bounded_build_pins_require_exact_equality() {
        unsafe {
            assert!(matches_pin(c"exact-pin".as_ptr(), "exact-pin"));
            assert!(!matches_pin(c"exact-pin-extra".as_ptr(), "exact-pin"));
            assert!(!matches_pin(c"exact".as_ptr(), "exact-pin"));
            assert!(!matches_pin(ptr::null(), "exact-pin"));
        }
    }
    #[test]
    #[cfg(target_os = "windows")]
    fn loaded_cef_module_symbol_probe_never_searches_a_fallback_library() {
        // API hash is available before CefInitialize. This probes the module
        // already imported by the test EXE; it opens no profile or browser.
        unsafe {
            let anchor = cef::sys::cef_api_hash(cef::sys::CEF_API_VERSION_LAST, 2);
            assert!(matches_pin(anchor, CEF_REVISION));
            let module = loaded_module::Module::from_address(anchor.cast()).unwrap();
            assert!(module.symbol(c"cef_api_hash").is_ok());
            assert!(module
                .symbol(c"cef_sorng_tls_deliberately_absent_export")
                .is_err());
        }
    }
    #[test]
    fn partition_install_acks_are_idempotent_but_cannot_revive_revocation() {
        let _guard = TEST_LOCK.lock().unwrap();
        let (state, _) = fixture();
        {
            let mut data = state.data.lock().unwrap();
            data.status = NativeTlsStatus::Initializing;
            data.installed = false;
        }
        retained()
            .lock()
            .unwrap()
            .insert(state.token, state.clone());
        assert!(accept_state(&state, 71, 99, 1).is_err());
        assert_eq!(
            state.data.lock().unwrap().status,
            NativeTlsStatus::Initializing
        );
        accept_state(&state, 71, 72, 1).unwrap();
        accept_state(&state, 71, 72, 1).unwrap();
        assert!(retained().lock().unwrap().contains_key(&71));
        state.revoke();
        assert!(accept_state(&state, 71, 72, 1).is_err());
        pump_inner().unwrap();
        assert!(accept_state(&state, 71, 99, 2).is_err());
        assert!(retained().lock().unwrap().contains_key(&71));
        accept_state(&state, 71, 72, 2).unwrap();
        assert!(!retained().lock().unwrap().contains_key(&71));
        assert_eq!(state.data.lock().unwrap().status, NativeTlsStatus::Revoked);
        assert!(accept_state(&state, 71, 72, 1).is_err());
    }
    #[test]
    fn native_initiated_revocation_releases_userdata_and_revokes_app_leases() {
        let _guard = TEST_LOCK.lock().unwrap();
        let (state, hooks) = fixture();
        retained()
            .lock()
            .unwrap()
            .insert(state.token, state.clone());
        let completion = pending(&state, 9);
        assert!(accept_state(&state, 71, 99, 2).is_err());
        assert!(retained().lock().unwrap().contains_key(&71));
        accept_state(&state, 71, 72, 2).unwrap();
        assert_eq!(state.data.lock().unwrap().status, NativeTlsStatus::Revoked);
        assert_eq!(hooks.failures.load(Ordering::Acquire), 1);
        assert!(!retained().lock().unwrap().contains_key(&71));
        completion.complete(NativeTlsDecision::AdmitNative);
        assert!(state.data.lock().unwrap().challenges.is_empty());
        assert!(accept_state(&state, 71, 72, 1).is_err());
        assert!(accept_state(&state, 71, 72, 2).is_err());
        assert_eq!(hooks.failures.load(Ordering::Acquire), 1);
    }
    #[test]
    fn borrowed_chains_are_owned_and_destination_port_is_preserved() {
        let (state, _) = fixture();
        let mut der = vec![0x30, 1, 0];
        let chain = [Bytes {
            data: der.as_ptr(),
            length: der.len(),
        }];
        let mut raw = raw_evidence(b"fixture.invalid", &chain);
        raw.port = 8443;
        let owned = unsafe { owned_evidence(&raw, &state) }.unwrap();
        der[0] = 0;
        assert_eq!(owned.peer_chain[0][0], 0x30);
        assert_eq!(owned.verified_chain[0][0], 0x30);
        assert_eq!(owned.origin, "https://fixture.invalid:8443");
        assert_eq!(owned.challenge, 9);
        let raw = raw_evidence(b"::1", &chain);
        assert_eq!(
            unsafe { owned_evidence(&raw, &state) }.unwrap().origin,
            "https://[::1]"
        );
    }
    #[test]
    fn evidence_rejects_foreign_generation_invalid_origin_masks_and_bounded_buffers() {
        let (state, _) = fixture();
        let der = [0x30, 1, 0];
        let chain = [Bytes {
            data: der.as_ptr(),
            length: der.len(),
        }];
        for host in [
            "https://fixture.invalid/path",
            "USER@fixture.invalid",
            "Fixture.invalid",
            "fixture.invalid:443",
            "fixture.invalid\n",
        ] {
            assert!(
                unsafe { owned_evidence(&raw_evidence(host.as_bytes(), &chain), &state) }.is_err()
            );
        }
        let mut raw = raw_evidence(b"fixture.invalid", &chain);
        raw.generation += 1;
        assert!(unsafe { owned_evidence(&raw, &state) }.is_err());
        raw.generation = 72;
        raw.allowed_exception_mask = 1;
        assert!(unsafe { owned_evidence(&raw, &state) }.is_err());
        raw.allowed_exception_mask = 0;
        raw.peer_chain_count = 65;
        assert!(unsafe { owned_evidence(&raw, &state) }.is_err());
        raw.peer_chain_count = 1;
        raw.hostname.length = 254;
        assert!(unsafe { owned_evidence(&raw, &state) }.is_err());
    }
    #[test]
    fn custom_ca_and_exception_configuration_never_silently_downgrades() {
        assert!(validate_config(&NativeTlsConfig::default(), REQUIRED).is_ok());
        let mut config = NativeTlsConfig {
            ca_mode: NativeTlsCaMode::CustomOnly,
            trust_anchors: vec![vec![0x30, 1, 0]],
            require_scoped_exceptions: false,
        };
        assert_eq!(
            validate_config(&config, REQUIRED),
            Err(NativeTlsError::Unavailable)
        );
        assert!(validate_config(&config, REQUIRED | CUSTOM_CA).is_ok());
        config.require_scoped_exceptions = true;
        assert_eq!(
            validate_config(&config, REQUIRED | CUSTOM_CA),
            Err(NativeTlsError::Unavailable)
        );
        config.ca_mode = NativeTlsCaMode::System;
        assert_eq!(
            validate_config(&config, REQUIRED | CUSTOM_CA | EXCEPTIONS),
            Err(NativeTlsError::Invalid)
        );
    }
    #[test]
    fn decisions_enforce_exact_exception_mask_native_result_fatal_and_timeout() {
        let mut c = Challenge {
            native_ok: false,
            fatal: false,
            mask: 5,
            since: Instant::now(),
            decision: None,
        };
        assert_eq!(
            validate_decision(&c, NativeTlsDecision::AdmitNative, REQUIRED),
            NativeTlsDecision::Deny
        );
        for mask in [0, 1, 4, 7, 8] {
            assert_eq!(
                validate_decision(
                    &c,
                    NativeTlsDecision::AdmitException { mask },
                    REQUIRED | EXCEPTIONS
                ),
                NativeTlsDecision::Deny
            );
        }
        let allow = NativeTlsDecision::AdmitException { mask: 5 };
        assert_eq!(
            validate_decision(&c, allow, REQUIRED),
            NativeTlsDecision::Deny
        );
        assert_eq!(validate_decision(&c, allow, REQUIRED | EXCEPTIONS), allow);
        c.fatal = true;
        assert_eq!(
            validate_decision(&c, allow, REQUIRED | EXCEPTIONS),
            NativeTlsDecision::Deny
        );
        c.fatal = false;
        c.since = Instant::now() - TIMEOUT;
        assert_eq!(
            validate_decision(&c, allow, REQUIRED | EXCEPTIONS),
            NativeTlsDecision::Deny
        );
    }
    #[test]
    fn completions_are_sendable_one_shot_and_drop_denies_exact_challenge() {
        fn is_send<T: Send>() {}
        is_send::<NativeTlsCompletion>();
        let (state, _) = fixture();
        let response = pending(&state, 4);
        std::thread::spawn(move || response.complete(NativeTlsDecision::AdmitNative))
            .join()
            .unwrap();
        drop(pending(&state, 5));
        assert_eq!(
            state.data.lock().unwrap().challenges[&4].decision,
            Some(NativeTlsDecision::AdmitNative)
        );
        assert_eq!(
            state.data.lock().unwrap().challenges[&5].decision,
            Some(NativeTlsDecision::Deny)
        );
        let response = pending(&state, 6);
        state.revoke();
        response.complete(NativeTlsDecision::AdmitNative);
        assert!(state.data.lock().unwrap().challenges.is_empty());
    }
    #[test]
    fn ui_pump_rechecks_owner_and_retains_userdata_after_revoke_return() {
        let _guard = TEST_LOCK.lock().unwrap();
        REPLIES.lock().unwrap().clear();
        REVOKES.store(0, Ordering::Release);
        let (state, hooks) = fixture();
        retained()
            .lock()
            .unwrap()
            .insert(state.token, state.clone());
        pending(&state, 9).complete(NativeTlsDecision::AdmitNative);
        hooks.current.store(false, Ordering::Release);
        pump_inner().unwrap();
        assert!(REPLIES.lock().unwrap().is_empty());
        assert_eq!(hooks.failures.load(Ordering::Acquire), 1);
        pump_inner().unwrap();
        pump_inner().unwrap();
        assert_eq!(REVOKES.load(Ordering::Acquire), 1);
        assert!(retained().lock().unwrap().contains_key(&state.token));
        retained().lock().unwrap().remove(&state.token);
    }
    #[test]
    fn pump_consumes_reply_once_and_never_substitutes_another_challenge() {
        let _guard = TEST_LOCK.lock().unwrap();
        REPLIES.lock().unwrap().clear();
        let (state, _) = fixture();
        retained()
            .lock()
            .unwrap()
            .insert(state.token, state.clone());
        pending(&state, 9).complete(NativeTlsDecision::AdmitNative);
        drop(pending(&state, 10));
        pump_inner().unwrap();
        pump_inner().unwrap();
        assert_eq!(
            *REPLIES.lock().unwrap(),
            [(71, 72, 9, 1, 0), (71, 72, 10, 0, 0)]
        );
        retained().lock().unwrap().remove(&state.token);
    }
}

/// # Safety
/// Call only AFTER CefShutdown returns and no future callback/CEF work is
/// possible. Do not release retained userdata merely because revoke returned.
pub unsafe fn after_cef_shutdown() {
    SHUT_DOWN.store(true, Ordering::Release);
    let states = std::mem::take(&mut *retained().lock().unwrap_or_else(|e| e.into_inner()));
    for state in states.into_values() {
        state.revoke();
    }
}

#[cfg(target_os = "windows")]
mod loaded_module {
    use super::*;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetModuleHandleExW(flags: u32, address: *const u16, module: *mut *mut c_void) -> i32;
        fn GetProcAddress(module: *mut c_void, name: *const c_char) -> *mut c_void;
    }
    pub struct Module(*mut c_void);
    impl Module {
        pub unsafe fn from_address(address: *const c_void) -> Result<Self, NativeTlsError> {
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
        pub unsafe fn symbol(&self, name: &CStr) -> Result<*mut c_void, NativeTlsError> {
            let symbol = unsafe { GetProcAddress(self.0, name.as_ptr()) };
            if symbol.is_null() || unsafe { Self::from_address(symbol) }?.0 != self.0 {
                return Err(NativeTlsError::Unavailable);
            }
            Ok(symbol)
        }
    }
}
#[cfg(any(target_os = "linux", target_os = "macos"))]
mod loaded_module {
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
        pub unsafe fn from_address(address: *const c_void) -> Result<Self, NativeTlsError> {
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
        pub unsafe fn symbol(&self, name: &CStr) -> Result<*mut c_void, NativeTlsError> {
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
