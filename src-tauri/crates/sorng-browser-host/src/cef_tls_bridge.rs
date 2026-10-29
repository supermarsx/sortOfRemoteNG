//! Side ABI V2 for the patched, already-loaded CEF. No renderer-facing API.
//! Main must pump replies on CEF UI and call `after_cef_shutdown` after shutdown.
//! Export/build checks prove compatibility, not package provenance/containment.

use crate::cef_http_cache::{
    HttpCacheMemoryReason, HttpCacheReleaseSignal, HttpCacheUse, HttpDiskCacheSpec, RawHttpCache,
};
use cef::{
    rc::ConvertReturnValue, ImplRequestContextHandler, RequestContext, RequestContextHandler,
};
#[cfg(any(target_os = "windows", test))]
use std::ptr;
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::{c_char, c_void, CStr},
    marker::PhantomData,
    panic::{catch_unwind, AssertUnwindSafe},
    rc::Rc,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
    time::{Duration, Instant},
};

pub const CEF_REVISION: &str = "682c378d70d5780061e96644dca16ddd8fd157a9";
pub const CHROMIUM_VERSION: &str = "154.0.8037.58";
pub const LEGACY_PATCH_ID: &str = "sorng-tls-v2-682c378-1";
pub const HTTP2_PATCH_ID: &str = "sorng-tls-v2-682c378-2";
pub const PROXY_APPLIED_PATCH_ID: &str = "sorng-tls-v2-682c378-3";
pub const PATCH_ID: &str = "sorng-tls-v2-682c378-4";
pub const HTTP3_PATCH_ID: &str = "sorng-tls-v2-682c378-5";
/// Revision 6: revision 5 plus a per-context HTTP disk cache (C-H1).
pub const HTTP_CACHE_PATCH_ID: &str = "sorng-tls-v2-682c378-6";
const ABI: u32 = 2;
const SOCKET: u64 = 1;
const REVOKE: u64 = 2;
const HTTP1: u64 = 4;
const EXCEPTIONS: u64 = 8;
const CUSTOM_CA: u64 = 16;
const PRIVATE: u64 = 32;
const SAME_AUTHORITY_HTTP2: u64 = 64;
const OWNED_HTTP3: u64 = 1 << 7;
const PROXY_APPLIED: u64 = 1 << 8;
const BOUNDED_RETIREMENT: u64 = 1 << 9;
const HTTP_DISK_CACHE: u64 = 1 << 10;
/// Every revision-6 bit: the full revision-5 transport contract plus the cache.
const HTTP_CACHE_REVISION: u64 =
    SAME_AUTHORITY_HTTP2 | OWNED_HTTP3 | PROXY_APPLIED | BOUNDED_RETIREMENT | HTTP_DISK_CACHE;
const PROXY_TIMEOUT: Duration = Duration::from_secs(10);
const REQUIRED: u64 = SOCKET | REVOKE | PRIVATE;
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

/// First locally observed bridge failure, not an inferred engine/network cause.
/// Fixed native metadata only: no hosts, origins, chains, tokens or native text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeTlsFailure {
    ProxyConfiguration,
    ContextCreation,
    InvalidEvidence,
    InvalidState,
    OwnerUnavailable,
    Callback,
    CompleteRejected,
    RevokeRejected,
    EngineRevoked,
    EngineFailure,
    PoisonedState,
    WrongThread,
}

/// Callback must only enqueue asynchronous authority work, never block CEF UI.
/// Main rechecks owner/trust/pin/chain/destination before consuming completion.
pub trait NativeTlsHooks: Send + Sync {
    fn on_evidence(&self, evidence: NativeTlsEvidence, completion: NativeTlsCompletion);
    /// Exact creation-time owner/attempt lease; must be quick and nonblocking.
    fn is_current(&self) -> bool;
    /// Synchronously revoke proxy/credential leases; enqueue native cleanup.
    fn on_failure(&self);
    /// Backwards-compatible typed observation. Adapters must forward this
    /// method explicitly when their wrapped owner needs the fixed reason.
    fn on_failure_reason(&self, _reason: NativeTlsFailure) {
        self.on_failure();
    }
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
type CreateWithCache = unsafe extern "C" fn(
    *const Context,
    *const cef::sys::_cef_request_context_settings_t,
    *mut cef::sys::_cef_request_context_handler_t,
    *const RawHttpCache,
) -> *mut cef::sys::_cef_request_context_t;
type Complete = unsafe extern "C" fn(u64, u64, u64, u32, u32) -> i32;
type Revoke = unsafe extern "C" fn(u64, u64) -> i32;
type ApplyProxy = unsafe extern "C" fn(u64, u64, u16) -> i32;
type ConfigureDatagrams = unsafe extern "C" fn(u64, u64, u16, *const u8, usize) -> i32;
#[derive(Clone, Copy)]
struct Functions {
    create: Create,
    create_with_cache: Option<CreateWithCache>,
    complete: Complete,
    revoke: Revoke,
    apply_proxy: Option<ApplyProxy>,
    configure_datagrams: Option<ConfigureDatagrams>,
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

/// Only known revision/protocol pairs are compatible. Accept the reviewed H1
/// engine while the H2 upgrade is built; never turn a capability bit into an
/// assertion that an unknown engine implements the corresponding admission.
unsafe fn matches_bridge_revision(
    actual: *const c_char,
    requested: &str,
    capabilities: u64,
) -> bool {
    if capabilities
        & !(REQUIRED
            | HTTP1
            | SAME_AUTHORITY_HTTP2
            | OWNED_HTTP3
            | EXCEPTIONS
            | CUSTOM_CA
            | PROXY_APPLIED
            | BOUNDED_RETIREMENT
            | HTTP_DISK_CACHE)
        != 0
    {
        return false;
    }
    let protocol = capabilities & (HTTP1 | SAME_AUTHORITY_HTTP2);
    // Revision 6 must carry every revision-5 bit; the cache bit never appears
    // on (or is implied for) any other revision.
    if capabilities & HTTP_DISK_CACHE != 0 {
        return requested == HTTP_CACHE_PATCH_ID
            && capabilities & (HTTP1 | HTTP_CACHE_REVISION) == HTTP_CACHE_REVISION
            && unsafe { matches_pin(actual, HTTP_CACHE_PATCH_ID) };
    }
    if capabilities & OWNED_HTTP3 != 0 {
        return requested == HTTP3_PATCH_ID
            && protocol == SAME_AUTHORITY_HTTP2
            && capabilities & (PROXY_APPLIED | BOUNDED_RETIREMENT)
                == (PROXY_APPLIED | BOUNDED_RETIREMENT)
            && unsafe { matches_pin(actual, HTTP3_PATCH_ID) };
    }
    let legacy = protocol == HTTP1
        && capabilities & (PROXY_APPLIED | BOUNDED_RETIREMENT) == 0
        && unsafe { matches_pin(actual, LEGACY_PATCH_ID) };
    let http2 = protocol == SAME_AUTHORITY_HTTP2
        && capabilities & (PROXY_APPLIED | BOUNDED_RETIREMENT) == 0
        && unsafe { matches_pin(actual, HTTP2_PATCH_ID) };
    let proxy_applied = protocol == SAME_AUTHORITY_HTTP2
        && capabilities & PROXY_APPLIED != 0
        && capabilities & BOUNDED_RETIREMENT == 0
        && unsafe { matches_pin(actual, PROXY_APPLIED_PATCH_ID) };
    let current = protocol == SAME_AUTHORITY_HTTP2
        && capabilities & (PROXY_APPLIED | BOUNDED_RETIREMENT)
            == (PROXY_APPLIED | BOUNDED_RETIREMENT)
        && unsafe { matches_pin(actual, PATCH_ID) };
    match requested {
        PATCH_ID => current,
        PROXY_APPLIED_PATCH_ID => proxy_applied,
        HTTP2_PATCH_ID => http2,
        LEGACY_PATCH_ID => legacy,
        _ => false,
    }
}

/// Non-Send UI capability acquired from actual loaded CEF, never a path supplied
/// by the renderer. `patch_id` must come from the reviewed native package pin.
pub struct NativeTlsBridge {
    functions: Functions,
    _ui: PhantomData<Rc<()>>,
}
impl NativeTlsBridge {
    /// Explicit application transition policy. This accepts either reviewed
    /// revision; package-specific acceptance must use `from_loaded` instead.
    /// # Safety
    /// Same initialization and independent provenance requirements as `from_loaded`.
    pub unsafe fn from_loaded_supported() -> Result<Self, NativeTlsError> {
        unsafe { Self::from_loaded(HTTP_CACHE_PATCH_ID) }
            .or_else(|_| unsafe { Self::from_loaded(HTTP3_PATCH_ID) })
            .or_else(|_| unsafe { Self::from_loaded(PATCH_ID) })
            .or_else(|_| unsafe { Self::from_loaded(PROXY_APPLIED_PATCH_ID) })
            .or_else(|_| unsafe { Self::from_loaded(HTTP2_PATCH_ID) })
            .or_else(|_| unsafe { Self::from_loaded(LEGACY_PATCH_ID) })
    }

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
            || !unsafe { matches_bridge_revision(api.patch_id, patch_id, api.capabilities) }
        {
            return Err(NativeTlsError::Incompatible);
        }
        if api.capabilities & BOUNDED_RETIREMENT != 0 {
            module.symbol(c"cef_sorng_tls_registry_stats_v2")?;
        }
        Ok(Self {
            functions: Functions {
                create: unsafe {
                    std::mem::transmute::<*mut c_void, Create>(
                        module.symbol(c"cef_sorng_tls_create_context_v2")?,
                    )
                },
                complete: unsafe {
                    std::mem::transmute::<*mut c_void, Complete>(
                        module.symbol(c"cef_sorng_tls_complete_v2")?,
                    )
                },
                revoke: unsafe {
                    std::mem::transmute::<*mut c_void, Revoke>(
                        module.symbol(c"cef_sorng_tls_revoke_v2")?,
                    )
                },
                apply_proxy: if api.capabilities & PROXY_APPLIED != 0 {
                    Some(unsafe {
                        std::mem::transmute::<*mut c_void, ApplyProxy>(
                            module.symbol(c"cef_sorng_tls_apply_proxy_v2")?,
                        )
                    })
                } else {
                    None
                },
                configure_datagrams: if api.capabilities & OWNED_HTTP3 != 0 {
                    Some(unsafe {
                        std::mem::transmute::<*mut c_void, ConfigureDatagrams>(
                            module.symbol(c"cef_sorng_tls_configure_datagrams_v2")?,
                        )
                    })
                } else {
                    None
                },
                create_with_cache: if api.capabilities & HTTP_DISK_CACHE != 0 {
                    Some(unsafe {
                        std::mem::transmute::<*mut c_void, CreateWithCache>(
                            module.symbol(c"cef_sorng_tls_create_context_with_cache_v2")?,
                        )
                    })
                } else {
                    None
                },
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
    pub fn supports_same_authority_http2(&self) -> bool {
        self.functions.capabilities & SAME_AUTHORITY_HTTP2 != 0
    }
    /// True only for the validated revision-6 engine with its cache export.
    pub fn supports_http_disk_cache(&self) -> bool {
        self.functions.capabilities & HTTP_DISK_CACHE != 0
            && self.functions.create_with_cache.is_some()
    }
    /// The actual loaded, validated revision, not a requested package label.
    pub fn patch_id(&self) -> &'static str {
        if self.functions.capabilities & HTTP_DISK_CACHE != 0 {
            HTTP_CACHE_PATCH_ID
        } else if self.functions.capabilities & OWNED_HTTP3 != 0 {
            HTTP3_PATCH_ID
        } else if self.functions.capabilities & BOUNDED_RETIREMENT != 0 {
            PATCH_ID
        } else if self.functions.capabilities & PROXY_APPLIED != 0 {
            PROXY_APPLIED_PATCH_ID
        } else if self.supports_same_authority_http2() {
            HTTP2_PATCH_ID
        } else {
            LEGACY_PATCH_ID
        }
    }

    /// Creates only a distinct, nonpersistent native context. Callback userdata
    /// is registered before FFI. Legacy failures retain it conservatively;
    /// revision4 guarantees NULL has no future application callbacks.
    ///
    /// `http_cache` asks a revision-6 engine to put only this context's HTTP
    /// cache on disk. The request settings stay private (empty `cache_path`,
    /// no persistent session cookies). An engine without the capability, or an
    /// invalid spec, silently yields today's in-memory context; a NULL from the
    /// cache variant is retried exactly once without the cache. The outcome is
    /// [`NativeTlsContext::http_cache_use`].
    pub(crate) fn create_context(
        &self,
        config: &NativeTlsConfig,
        hooks: Arc<dyn NativeTlsHooks>,
        handler: &mut RequestContextHandler,
        cookies_enabled: bool,
        http_cache: Option<&HttpDiskCacheSpec>,
    ) -> Result<(RequestContext, NativeTlsContext), NativeTlsError> {
        on_ui()?;
        // V2 specifies a BORROWED handler. Do not transfer an extra Rust ref.
        self.create_context_inner(
            config,
            hooks,
            handler.get_raw(),
            cookies_enabled,
            http_cache,
        )
    }

    fn create_context_inner(
        &self,
        config: &NativeTlsConfig,
        hooks: Arc<dyn NativeTlsHooks>,
        handler: *mut cef::sys::_cef_request_context_handler_t,
        cookies_enabled: bool,
        http_cache: Option<&HttpDiskCacheSpec>,
    ) -> Result<(RequestContext, NativeTlsContext), NativeTlsError> {
        validate_config(config, self.functions.capabilities)?;
        let reason = match self.requested_cache(http_cache) {
            Ok(spec) => {
                match self.create_once(config, hooks.clone(), handler, cookies_enabled, Some(spec))
                {
                    Ok(created) => return Ok(created),
                    Err(CreateFailure::CacheRefused) => HttpCacheMemoryReason::EngineRejected,
                    Err(CreateFailure::Error(error)) => return Err(error),
                }
            }
            Err(reason) => reason,
        };
        match self.create_once(config, hooks, handler, cookies_enabled, None) {
            Ok((context, mut owner)) => {
                owner.cache_use = HttpCacheUse::Memory(reason);
                Ok((context, owner))
            }
            Err(CreateFailure::Error(error)) => Err(error),
            Err(CreateFailure::CacheRefused) => Err(NativeTlsError::Unavailable),
        }
    }

    /// Capability fallback, not an error: anything but a valid spec on a
    /// revision-6 engine means a plain in-memory context, with its reason.
    fn requested_cache<'a>(
        &self,
        http_cache: Option<&'a HttpDiskCacheSpec>,
    ) -> Result<&'a HttpDiskCacheSpec, HttpCacheMemoryReason> {
        match http_cache {
            None => Err(HttpCacheMemoryReason::NotRequested),
            Some(_) if !self.supports_http_disk_cache() => {
                Err(HttpCacheMemoryReason::EngineUnsupported)
            }
            Some(spec) => spec
                .validate()
                .map(|()| spec)
                .map_err(|_| HttpCacheMemoryReason::InvalidSpec),
        }
    }

    fn create_once(
        &self,
        config: &NativeTlsConfig,
        hooks: Arc<dyn NativeTlsHooks>,
        handler: *mut cef::sys::_cef_request_context_handler_t,
        cookies_enabled: bool,
        http_cache: Option<&HttpDiskCacheSpec>,
    ) -> Result<(RequestContext, NativeTlsContext), CreateFailure> {
        // Resolve the cache export and its borrowed UTF-8 path before any
        // registration exists, so nothing has to be unwound on these errors.
        let cache = match http_cache {
            None => None,
            Some(spec) => {
                let create = self
                    .functions
                    .create_with_cache
                    .ok_or(CreateFailure::Error(NativeTlsError::Unavailable))?;
                let path = std::ffi::CString::new(
                    spec.directory
                        .to_str()
                        .ok_or(CreateFailure::Error(NativeTlsError::Invalid))?,
                )
                .map_err(|_| CreateFailure::Error(NativeTlsError::Invalid))?;
                Some((create, path, spec.max_bytes))
            }
        };
        let token = NEXT_TOKEN
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_add(1))
            .map_err(|_| CreateFailure::Error(NativeTlsError::Revoked))?;
        let state = Arc::new(Shared {
            token,
            generation: token,
            ca_mode: config.ca_mode,
            functions: self.functions,
            hooks,
            http_cache: cache.as_ref().map(|_| HttpCacheReleaseSignal::default()),
            data: Mutex::new(Data {
                status: NativeTlsStatus::Initializing,
                installed: false,
                revoke_sent: false,
                proxy_requested: None,
                proxy_applied: false,
                proxy_port: None,
                datagrams_requested: None,
                datagrams_applied: false,
                failure: None,
                challenges: BTreeMap::new(),
                seen: BTreeSet::new(),
            }),
        });
        {
            let mut registry = retained()
                .lock()
                .map_err(|_| CreateFailure::Error(NativeTlsError::Revoked))?;
            if registry.len() >= 256 {
                return Err(CreateFailure::Error(NativeTlsError::Unavailable));
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
        // or localStorage. The disk HTTP cache is a separate bridge argument;
        // it never sets `cache_path` (which would load a persistent profile).
        let settings = cookie_context_settings(cookies_enabled).into();
        let raw = match &cache {
            None => unsafe { (self.functions.create)(&descriptor, &settings, handler) },
            Some((create, path, max_bytes)) => {
                let raw_cache = RawHttpCache {
                    size: std::mem::size_of::<RawHttpCache>() as u32,
                    reserved: 0,
                    directory_utf8: path.as_ptr(),
                    directory_length: path.as_bytes().len(),
                    max_bytes: *max_bytes,
                };
                unsafe { create(&descriptor, &settings, handler, &raw_cache) }
            }
        };
        let owner = NativeTlsContext {
            state,
            cache_use: if cache.is_some() {
                HttpCacheUse::Disk
            } else {
                HttpCacheUse::Memory(HttpCacheMemoryReason::NotRequested)
            },
            _ui: PhantomData,
        };
        if raw.is_null() && cache.is_some() {
            return Err(finish_refused_cache_context(owner));
        }
        finish_context_creation(raw, owner).map_err(CreateFailure::Error)
    }
}

enum CreateFailure {
    /// The revision-6 cache variant returned NULL; retry once without it.
    CacheRefused,
    Error(NativeTlsError),
}

/// Revision 6 always carries BOUNDED_RETIREMENT, so a NULL is callback
/// quiescent and leaves no native registration. The owner hooks are NOT
/// notified: the attempt itself is still alive and immediately retries a
/// plain context. A poisoned registry is a real error.
fn finish_refused_cache_context(owner: NativeTlsContext) -> CreateFailure {
    debug_assert!(owner.state.functions.capabilities & BOUNDED_RETIREMENT != 0);
    {
        let mut data = owner.state.data.lock().unwrap_or_else(|e| e.into_inner());
        data.status = NativeTlsStatus::Failed;
        data.failure = Some(NativeTlsFailure::ContextCreation);
        data.challenges.clear();
    }
    if let Some(signal) = &owner.state.http_cache {
        signal.release();
    }
    match retained().lock() {
        Ok(mut registry) => {
            registry.remove(&owner.state.token);
            CreateFailure::CacheRefused
        }
        Err(_) => CreateFailure::Error(NativeTlsError::Revoked),
    }
}

fn finish_context_creation(
    raw: *mut cef::sys::_cef_request_context_t,
    owner: NativeTlsContext,
) -> Result<(RequestContext, NativeTlsContext), NativeTlsError> {
    if raw.is_null() {
        owner.state.fail(NativeTlsFailure::ContextCreation);
        // Only the exact known cap9 revision promises post-NULL quiescence.
        // Earlier engines may still issue state/evidence callbacks after NULL.
        if owner.state.functions.capabilities & BOUNDED_RETIREMENT != 0 {
            retained()
                .lock()
                .map_err(|_| NativeTlsError::Revoked)?
                .remove(&owner.state.token);
        }
        return Err(NativeTlsError::Unavailable);
    }
    Ok((raw.wrap_result(), owner))
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
    proxy_requested: Option<Instant>,
    proxy_applied: bool,
    proxy_port: Option<u16>,
    datagrams_requested: Option<Instant>,
    datagrams_applied: bool,
    failure: Option<NativeTlsFailure>,
    challenges: BTreeMap<u64, Challenge>,
    seen: BTreeSet<u64>,
}
struct Shared {
    token: u64,
    generation: u64,
    ca_mode: NativeTlsCaMode,
    functions: Functions,
    hooks: Arc<dyn NativeTlsHooks>,
    /// Some only for a registration created with a revision-6 disk cache.
    /// Userdata then stays registered until both state 2 and state 7.
    http_cache: Option<HttpCacheReleaseSignal>,
    data: Mutex<Data>,
}
fn retained() -> &'static Mutex<BTreeMap<u64, Arc<Shared>>> {
    static RETAINED: OnceLock<Mutex<BTreeMap<u64, Arc<Shared>>>> = OnceLock::new();
    RETAINED.get_or_init(Mutex::default)
}
impl Shared {
    fn fail(&self, reason: NativeTlsFailure) {
        {
            let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());
            if matches!(
                data.status,
                NativeTlsStatus::Failed | NativeTlsStatus::Revoked
            ) {
                return;
            }
            data.status = NativeTlsStatus::Failed;
            data.failure = Some(reason);
            data.challenges.clear();
        }
        let _ = catch_unwind(AssertUnwindSafe(|| self.hooks.on_failure_reason(reason)));
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
                state.fail(NativeTlsFailure::PoisonedState);
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
    cache_use: HttpCacheUse,
    _ui: PhantomData<Rc<()>>,
}
impl NativeTlsContext {
    /// Which HTTP cache the engine was asked to use for this context.
    pub fn http_cache_use(&self) -> HttpCacheUse {
        self.cache_use
    }
    /// True when this context does not (or no longer) hold a disk cache
    /// directory: it never had one, the engine reported state 7, or CEF shut
    /// down. Revocation (state 2) alone does not release the directory.
    pub fn http_cache_released(&self) -> bool {
        self.state
            .http_cache
            .as_ref()
            .is_none_or(HttpCacheReleaseSignal::is_released)
    }
    /// Sendable state-7 observer that outlives this owner; None without a
    /// disk cache. An app cache lease must outlive the context until this fires.
    pub fn http_cache_release_signal(&self) -> Option<HttpCacheReleaseSignal> {
        self.state.http_cache.clone()
    }
    /// New engines ACK their exact fixed proxy independently from TLS Ready.
    /// Legacy engines retain their old configuration-only readiness contract.
    pub fn proxy_applied(&self) -> bool {
        self.state.functions.capabilities & PROXY_APPLIED != 0
            && self.state.hooks.is_current()
            && self
                .state
                .data
                .lock()
                .is_ok_and(|data| data.proxy_applied && data.status == NativeTlsStatus::Installed)
    }
    pub(crate) fn prepare_proxy(&self, port: u16) -> Result<bool, NativeTlsError> {
        let Some(apply) = self.state.functions.apply_proxy else {
            return Ok(true);
        };
        on_ui()?;
        self.prepare_proxy_inner(port, apply)
    }
    fn prepare_proxy_inner(&self, port: u16, apply: ApplyProxy) -> Result<bool, NativeTlsError> {
        if !self.state.hooks.is_current() {
            self.state.fail(NativeTlsFailure::OwnerUnavailable);
            return Err(NativeTlsError::Revoked);
        }
        let send = {
            let mut data = self
                .state
                .data
                .lock()
                .map_err(|_| NativeTlsError::Revoked)?;
            if data.status != NativeTlsStatus::Installed {
                return Err(NativeTlsError::Revoked);
            }
            if data.proxy_port.is_some_and(|expected| expected != port) {
                drop(data);
                self.state.fail(NativeTlsFailure::ProxyConfiguration);
                return Err(NativeTlsError::Invalid);
            }
            if data.proxy_applied {
                return Ok(true);
            }
            if data
                .proxy_requested
                .is_some_and(|since| since.elapsed() >= PROXY_TIMEOUT)
            {
                drop(data);
                self.state.fail(NativeTlsFailure::ProxyConfiguration);
                return Err(NativeTlsError::Revoked);
            }
            if data.proxy_requested.is_none() {
                data.proxy_requested = Some(Instant::now());
                data.proxy_port = Some(port);
                true
            } else {
                false
            }
        };
        if send
            && (port == 0 || unsafe { apply(self.state.token, self.state.generation, port) } != 1)
        {
            self.state.fail(NativeTlsFailure::ProxyConfiguration);
            return Err(NativeTlsError::Revoked);
        }
        Ok(self.proxy_applied())
    }
    pub fn supports_owned_http3(&self) -> bool {
        self.state.functions.capabilities & OWNED_HTTP3 != 0
            && self.state.functions.configure_datagrams.is_some()
    }
    pub fn datagrams_applied(&self) -> bool {
        self.supports_owned_http3()
            && self.state.hooks.is_current()
            && self.state.data.lock().is_ok_and(|data| {
                data.status == NativeTlsStatus::Installed
                    && data.proxy_applied
                    && data.datagrams_applied
            })
    }
    /// Native-only borrowed relay secret; the engine copies it before return.
    /// A true return requires the separate exact-owner network acknowledgement.
    pub fn prepare_datagrams(&self, port: u16, password: &str) -> Result<bool, NativeTlsError> {
        on_ui()?;
        let configure = self
            .state
            .functions
            .configure_datagrams
            .ok_or(NativeTlsError::Unavailable)?;
        self.prepare_datagrams_inner(port, password, configure)
    }
    fn prepare_datagrams_inner(
        &self,
        port: u16,
        password: &str,
        configure: ConfigureDatagrams,
    ) -> Result<bool, NativeTlsError> {
        if !self.state.hooks.is_current() {
            self.state.fail(NativeTlsFailure::OwnerUnavailable);
            return Err(NativeTlsError::Revoked);
        }
        if port == 0 || password.len() != 64 || !password.bytes().all(|b| b.is_ascii_hexdigit()) {
            self.state.fail(NativeTlsFailure::ProxyConfiguration);
            return Err(NativeTlsError::Invalid);
        }
        let send = {
            let mut data = self
                .state
                .data
                .lock()
                .map_err(|_| NativeTlsError::Revoked)?;
            if data.status != NativeTlsStatus::Installed
                || !data.proxy_applied
                || data.proxy_port != Some(port)
            {
                return Err(NativeTlsError::Invalid);
            }
            if data.datagrams_applied {
                return Ok(true);
            }
            if data
                .datagrams_requested
                .is_some_and(|since| since.elapsed() >= PROXY_TIMEOUT)
            {
                drop(data);
                self.state.fail(NativeTlsFailure::ProxyConfiguration);
                return Err(NativeTlsError::Revoked);
            }
            if data.datagrams_requested.is_none() {
                data.datagrams_requested = Some(Instant::now());
                true
            } else {
                false
            }
        };
        if send
            && unsafe {
                configure(
                    self.state.token,
                    self.state.generation,
                    port,
                    password.as_ptr(),
                    password.len(),
                )
            } != 1
        {
            self.state.fail(NativeTlsFailure::ProxyConfiguration);
            return Err(NativeTlsError::Revoked);
        }
        Ok(self.datagrams_applied())
    }
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
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<(), NativeTlsFailure> {
        on_ui().map_err(callback_thread_failure)?;
        if !state.hooks.is_current() {
            return Err(NativeTlsFailure::OwnerUnavailable);
        }
        let evidence = unsafe { owned_evidence(raw, &state) }
            .map_err(|_| NativeTlsFailure::InvalidEvidence)?;
        {
            let mut data = state
                .data
                .lock()
                .map_err(|_| NativeTlsFailure::PoisonedState)?;
            if data.status != NativeTlsStatus::Installed {
                return Err(NativeTlsFailure::InvalidState);
            }
            if data.challenges.len() >= MAX_PENDING
                || data.seen.len() >= 65_536
                || !data.seen.insert(evidence.challenge)
            {
                return Err(NativeTlsFailure::InvalidEvidence);
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
    finish_callback(&state, result);
}
unsafe extern "C" fn state_callback(user: *mut c_void, token: u64, generation: u64, status: u32) {
    let Some(state) = (unsafe { callback_state(user) }) else {
        return;
    };
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<(), NativeTlsFailure> {
        on_ui().map_err(callback_thread_failure)?;
        accept_state(&state, token, generation, status)
    }));
    finish_callback(&state, result);
}

fn callback_thread_failure(error: NativeTlsError) -> NativeTlsFailure {
    match error {
        NativeTlsError::WrongThread => NativeTlsFailure::WrongThread,
        _ => NativeTlsFailure::InvalidState,
    }
}

fn finish_callback(state: &Shared, result: std::thread::Result<Result<(), NativeTlsFailure>>) {
    match result {
        Ok(Ok(())) => {}
        Ok(Err(reason)) => state.fail(reason),
        Err(_) => state.fail(NativeTlsFailure::Callback),
    }
}

fn accept_state(
    state: &Arc<Shared>,
    token: u64,
    generation: u64,
    status: u32,
) -> Result<(), NativeTlsFailure> {
    if state.token != token || state.generation != generation {
        return Err(NativeTlsFailure::InvalidState);
    }
    if matches!(status, 4..=6) && !state.hooks.is_current() {
        return Err(NativeTlsFailure::OwnerUnavailable);
    }
    let mut data = state
        .data
        .lock()
        .map_err(|_| NativeTlsFailure::PoisonedState)?;
    match status {
        6 if state.functions.capabilities & OWNED_HTTP3 != 0
            && data.status == NativeTlsStatus::Installed
            && data.proxy_applied
            && data.datagrams_requested.is_some()
            && !data.datagrams_applied =>
        {
            if data
                .datagrams_requested
                .is_some_and(|since| since.elapsed() >= PROXY_TIMEOUT)
            {
                return Err(NativeTlsFailure::ProxyConfiguration);
            }
            data.datagrams_applied = true;
        }
        5 if state.functions.capabilities & PROXY_APPLIED != 0
            && data.status == NativeTlsStatus::Installed
            && data.proxy_requested.is_some() =>
        {
            return Err(NativeTlsFailure::ProxyConfiguration);
        }
        4 if state.functions.capabilities & PROXY_APPLIED != 0
            && data.status == NativeTlsStatus::Installed
            && data.proxy_requested.is_some()
            && !data.proxy_applied =>
        {
            if data
                .proxy_requested
                .is_some_and(|since| since.elapsed() >= PROXY_TIMEOUT)
            {
                return Err(NativeTlsFailure::ProxyConfiguration);
            }
            data.proxy_applied = true;
        }
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
            let native_initiated = !data.revoke_sent
                && !matches!(
                    data.status,
                    NativeTlsStatus::Revoking | NativeTlsStatus::Failed
                );
            if native_initiated {
                data.failure = Some(NativeTlsFailure::EngineRevoked);
            }
            data.status = NativeTlsStatus::Revoked;
            data.challenges.clear();
            drop(data);
            // A disk-cache registration's userdata lives until state 7 too.
            if state
                .http_cache
                .as_ref()
                .is_none_or(HttpCacheReleaseSignal::is_released)
            {
                retained()
                    .lock()
                    .map_err(|_| NativeTlsFailure::PoisonedState)?
                    .remove(&token);
            }
            if native_initiated {
                // Revoke app proxy/credential leases too, without holding a
                // registry or challenge lock across application callbacks.
                let _ = catch_unwind(AssertUnwindSafe(|| {
                    state
                        .hooks
                        .on_failure_reason(NativeTlsFailure::EngineRevoked);
                }));
            }
        }
        3 => return Err(NativeTlsFailure::EngineFailure),
        // HTTP disk cache released: the NetworkContext owning the directory is
        // gone. Exactly once, only for a cache registration, before or after
        // state 2. It needs no current owner; the lease outlives the attempt.
        7 => {
            let Some(signal) = state.http_cache.as_ref() else {
                return Err(NativeTlsFailure::InvalidState);
            };
            if !signal.release() {
                return Err(NativeTlsFailure::InvalidState);
            }
            let revoked = data.status == NativeTlsStatus::Revoked;
            drop(data);
            if revoked {
                retained()
                    .lock()
                    .map_err(|_| NativeTlsFailure::PoisonedState)?
                    .remove(&token);
            }
        }
        _ => return Err(NativeTlsFailure::InvalidState),
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
            state.fail(NativeTlsFailure::RevokeRejected);
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
            match catch_unwind(AssertUnwindSafe(|| state.hooks.is_current())) {
                Ok(true) => {}
                Ok(false) => {
                    state.fail(NativeTlsFailure::OwnerUnavailable);
                    break;
                }
                Err(_) => {
                    state.fail(NativeTlsFailure::Callback);
                    break;
                }
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
                state.fail(NativeTlsFailure::CompleteRejected);
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
    fn bridge_revision_pins_protocol_and_preserves_known_legacy_runtime() {
        let legacy = std::ffi::CString::new(LEGACY_PATCH_ID).unwrap();
        let http2 = std::ffi::CString::new(HTTP2_PATCH_ID).unwrap();
        let current = std::ffi::CString::new(PATCH_ID).unwrap();
        let proxy_applied = std::ffi::CString::new(PROXY_APPLIED_PATCH_ID).unwrap();
        let unknown = c"sorng-tls-v2-unreviewed";
        for (actual, requested, protocol, accepted) in [
            (legacy.as_c_str(), PATCH_ID, HTTP1, false),
            (
                current.as_c_str(),
                PATCH_ID,
                SAME_AUTHORITY_HTTP2 | PROXY_APPLIED | BOUNDED_RETIREMENT,
                true,
            ),
            (
                proxy_applied.as_c_str(),
                PROXY_APPLIED_PATCH_ID,
                SAME_AUTHORITY_HTTP2 | PROXY_APPLIED,
                true,
            ),
            (
                proxy_applied.as_c_str(),
                PATCH_ID,
                SAME_AUTHORITY_HTTP2 | PROXY_APPLIED,
                false,
            ),
            (
                current.as_c_str(),
                PROXY_APPLIED_PATCH_ID,
                SAME_AUTHORITY_HTTP2 | PROXY_APPLIED | BOUNDED_RETIREMENT,
                false,
            ),
            (
                current.as_c_str(),
                PATCH_ID,
                SAME_AUTHORITY_HTTP2 | PROXY_APPLIED,
                false,
            ),
            (
                proxy_applied.as_c_str(),
                PROXY_APPLIED_PATCH_ID,
                SAME_AUTHORITY_HTTP2 | PROXY_APPLIED | BOUNDED_RETIREMENT,
                false,
            ),
            (current.as_c_str(), PATCH_ID, SAME_AUTHORITY_HTTP2, false),
            (http2.as_c_str(), HTTP2_PATCH_ID, SAME_AUTHORITY_HTTP2, true),
            (
                http2.as_c_str(),
                HTTP2_PATCH_ID,
                SAME_AUTHORITY_HTTP2 | PROXY_APPLIED,
                false,
            ),
            (legacy.as_c_str(), LEGACY_PATCH_ID, HTTP1, true),
            (
                current.as_c_str(),
                LEGACY_PATCH_ID,
                SAME_AUTHORITY_HTTP2,
                false,
            ),
            (legacy.as_c_str(), PATCH_ID, SAME_AUTHORITY_HTTP2, false),
            (current.as_c_str(), PATCH_ID, HTTP1, false),
            (
                current.as_c_str(),
                PATCH_ID,
                HTTP1 | SAME_AUTHORITY_HTTP2,
                false,
            ),
            (current.as_c_str(), PATCH_ID, 0, false),
            (
                current.as_c_str(),
                PATCH_ID,
                SAME_AUTHORITY_HTTP2 | (1 << 7),
                false,
            ),
            (unknown, PATCH_ID, SAME_AUTHORITY_HTTP2, false),
            (
                current.as_c_str(),
                "unreviewed",
                SAME_AUTHORITY_HTTP2,
                false,
            ),
        ] {
            assert_eq!(
                unsafe { matches_bridge_revision(actual.as_ptr(), requested, REQUIRED | protocol) },
                accepted
            );
        }
    }

    #[test]
    fn failed_factory_releases_only_revision_four_callback_quiescent_state() {
        let _lock = TEST_LOCK.lock().unwrap();
        for offset in 0..1025 {
            let (mut state, hooks) = fixture();
            let shared = Arc::get_mut(&mut state).unwrap();
            shared.token = 100_000 + offset;
            shared.functions.capabilities |= BOUNDED_RETIREMENT;
            let token = shared.token;
            retained().lock().unwrap().insert(token, state.clone());
            let owner = NativeTlsContext {
                state: state.clone(),
                cache_use: HttpCacheUse::Memory(HttpCacheMemoryReason::NotRequested),
                _ui: PhantomData,
            };
            assert!(matches!(
                finish_context_creation(ptr::null_mut(), owner),
                Err(NativeTlsError::Unavailable)
            ));
            assert!(!retained().lock().unwrap().contains_key(&token));
            assert_eq!(hooks.failures.load(Ordering::Acquire), 1);
            assert_eq!(Arc::strong_count(&state), 1);
        }
        // Existing runtimes do not promise callback quiescence after NULL.
        // Their userdata remains pinned until the existing terminal ACK.
        let (mut state, _) = fixture();
        let shared = Arc::get_mut(&mut state).unwrap();
        shared.token = 200_000;
        shared.functions.capabilities |= SAME_AUTHORITY_HTTP2 | PROXY_APPLIED;
        let token = shared.token;
        retained().lock().unwrap().insert(token, state.clone());
        let owner = NativeTlsContext {
            state: state.clone(),
            cache_use: HttpCacheUse::Memory(HttpCacheMemoryReason::NotRequested),
            _ui: PhantomData,
        };
        assert!(matches!(
            finish_context_creation(ptr::null_mut(), owner),
            Err(NativeTlsError::Unavailable)
        ));
        assert!(retained().lock().unwrap().contains_key(&token));
        accept_state(&state, token, state.generation, 2).unwrap();
        assert!(!retained().lock().unwrap().contains_key(&token));
    }

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
    type RecordedReply = (u64, u64, u64, u32, u32);
    static REPLIES: Mutex<Vec<RecordedReply>> = Mutex::new(Vec::new());
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
                create_with_cache: None,
                complete,
                revoke,
                apply_proxy: None,
                configure_datagrams: None,
                capabilities: REQUIRED | EXCEPTIONS | CUSTOM_CA,
            },
            hooks: hooks.clone(),
            http_cache: None,
            data: Mutex::new(Data {
                status: NativeTlsStatus::Installed,
                installed: true,
                revoke_sent: false,
                proxy_requested: None,
                proxy_applied: false,
                proxy_port: None,
                datagrams_requested: None,
                datagrams_applied: false,
                failure: None,
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

    static PROXY_CALLS: Mutex<Vec<(u64, u64, u16)>> = Mutex::new(Vec::new());
    unsafe extern "C" fn apply_proxy(t: u64, g: u64, p: u16) -> i32 {
        PROXY_CALLS.lock().unwrap().push((t, g, p));
        1
    }
    fn proxy_fixture(token: u64) -> NativeTlsContext {
        let (mut state, _) = fixture();
        let shared = Arc::get_mut(&mut state).unwrap();
        shared.token = token;
        shared.generation = token + 100;
        shared.functions.capabilities |= PROXY_APPLIED;
        shared.functions.apply_proxy = Some(apply_proxy);
        NativeTlsContext {
            state,
            cache_use: HttpCacheUse::Memory(HttpCacheMemoryReason::NotRequested),
            _ui: PhantomData,
        }
    }
    static DATAGRAM_CALLS: Mutex<Vec<(u64, u64, u16, usize)>> = Mutex::new(Vec::new());
    unsafe extern "C" fn configure_datagrams(
        t: u64,
        g: u64,
        p: u16,
        _: *const u8,
        length: usize,
    ) -> i32 {
        // Deliberately never retain or log the borrowed relay password.
        DATAGRAM_CALLS.lock().unwrap().push((t, g, p, length));
        1
    }
    fn datagram_fixture(token: u64, port: u16) -> NativeTlsContext {
        let mut context = proxy_fixture(token);
        let state = Arc::get_mut(&mut context.state).unwrap();
        state.functions.capabilities |= OWNED_HTTP3 | BOUNDED_RETIREMENT;
        state.functions.configure_datagrams = Some(configure_datagrams);
        assert!(!context.prepare_proxy_inner(port, apply_proxy).unwrap());
        accept_state(&context.state, token, token + 100, 4).unwrap();
        context
    }
    #[test]
    fn owned_datagrams_require_matching_proxy_and_separate_exact_owner_ack() {
        let _lock = TEST_LOCK.lock().unwrap();
        DATAGRAM_CALLS.lock().unwrap().clear();
        let first = datagram_fixture(2101, 42001);
        let second = datagram_fixture(2102, 42002);
        let secret = "a".repeat(64);
        assert!(!first.datagrams_applied());
        assert!(!first
            .prepare_datagrams_inner(42001, &secret, configure_datagrams)
            .unwrap());
        assert!(!second
            .prepare_datagrams_inner(42002, &secret, configure_datagrams)
            .unwrap());
        assert!(!first
            .prepare_datagrams_inner(42001, &secret, configure_datagrams)
            .unwrap());
        assert_eq!(
            DATAGRAM_CALLS.lock().unwrap().as_slice(),
            &[(2101, 2201, 42001, 64), (2102, 2202, 42002, 64)]
        );
        assert!(accept_state(&first.state, 2102, 2202, 6).is_err());
        accept_state(&second.state, 2102, 2202, 6).unwrap();
        assert!(second.datagrams_applied());
        assert!(!first.datagrams_applied());
        accept_state(&first.state, 2101, 2201, 6).unwrap();
        assert!(first.datagrams_applied());
        first.revoke();
        assert!(!first.datagrams_applied());
        assert!(second.datagrams_applied());
    }
    #[test]
    fn datagram_ack_rejects_unsolicited_legacy_expired_and_revoked_configuration() {
        let _lock = TEST_LOCK.lock().unwrap();
        let (legacy, _) = fixture();
        assert!(accept_state(&legacy, 71, 72, 6).is_err());
        let context = datagram_fixture(2201, 42101);
        assert!(accept_state(&context.state, 2201, 2301, 6).is_err());
        assert!(context
            .prepare_datagrams_inner(42102, &"a".repeat(64), configure_datagrams)
            .is_err());
        assert!(!context
            .prepare_datagrams_inner(42101, &"a".repeat(64), configure_datagrams)
            .unwrap());
        context.state.data.lock().unwrap().datagrams_requested =
            Some(Instant::now() - PROXY_TIMEOUT);
        assert!(accept_state(&context.state, 2201, 2301, 6).is_err());
        assert!(context
            .prepare_datagrams_inner(42101, &"a".repeat(64), configure_datagrams)
            .is_err());
        let revoked = datagram_fixture(2202, 42102);
        assert!(!revoked
            .prepare_datagrams_inner(42102, &"b".repeat(64), configure_datagrams)
            .unwrap());
        revoked.revoke();
        assert!(accept_state(&revoked.state, 2202, 2302, 6).is_err());
        assert!(!revoked.datagrams_applied());
    }
    #[test]
    fn invalid_datagram_credentials_never_reach_ffi_and_proxy_port_cannot_change() {
        let _lock = TEST_LOCK.lock().unwrap();
        for (index, invalid) in ["", "not a credential", &"z".repeat(64), &"a".repeat(65)]
            .iter()
            .enumerate()
        {
            let context = datagram_fixture(2300 + index as u64, 42201);
            DATAGRAM_CALLS.lock().unwrap().clear();
            assert!(context
                .prepare_datagrams_inner(42201, invalid, configure_datagrams)
                .is_err());
            assert!(DATAGRAM_CALLS.lock().unwrap().is_empty());
            assert!(!context.datagrams_applied());
        }
        let context = datagram_fixture(2310, 42202);
        assert!(context.prepare_proxy_inner(42203, apply_proxy).is_err());
        assert!(!context.proxy_applied());
    }
    #[test]
    fn http3_revision_requires_complete_owned_transport_contract() {
        let actual = std::ffi::CString::new(HTTP3_PATCH_ID).unwrap();
        let capabilities =
            REQUIRED | SAME_AUTHORITY_HTTP2 | OWNED_HTTP3 | PROXY_APPLIED | BOUNDED_RETIREMENT;
        assert!(unsafe { matches_bridge_revision(actual.as_ptr(), HTTP3_PATCH_ID, capabilities) });
        for bit in [
            OWNED_HTTP3,
            PROXY_APPLIED,
            BOUNDED_RETIREMENT,
            SAME_AUTHORITY_HTTP2,
        ] {
            assert!(!unsafe {
                matches_bridge_revision(actual.as_ptr(), HTTP3_PATCH_ID, capabilities & !bit)
            });
        }
        assert!(!unsafe { matches_bridge_revision(actual.as_ptr(), PATCH_ID, capabilities) });
        assert!(!unsafe {
            matches_bridge_revision(actual.as_ptr(), HTTP3_PATCH_ID, capabilities | HTTP1)
        });
    }
    #[test]
    fn proxy_ack_is_separate_from_tls_and_reversed_context_acks_do_not_cross() {
        let _lock = TEST_LOCK.lock().unwrap();
        PROXY_CALLS.lock().unwrap().clear();
        let first = proxy_fixture(1001);
        let second = proxy_fixture(1002);
        assert!(!first.proxy_applied()); // TLS Ready alone is insufficient.
        assert!(!first.prepare_proxy_inner(41001, apply_proxy).unwrap());
        assert!(!second.prepare_proxy_inner(41002, apply_proxy).unwrap());
        assert!(!first.prepare_proxy_inner(41001, apply_proxy).unwrap());
        assert_eq!(
            PROXY_CALLS.lock().unwrap().as_slice(),
            &[(1001, 1101, 41001), (1002, 1102, 41002)]
        );
        accept_state(&second.state, 1002, 1102, 4).unwrap();
        assert!(second.proxy_applied());
        assert!(!first.proxy_applied());
        assert!(accept_state(&first.state, 1002, 1102, 4).is_err());
        accept_state(&first.state, 1001, 1101, 4).unwrap();
        assert!(first.proxy_applied());
    }
    #[test]
    fn proxy_ack_rejects_unsolicited_legacy_late_revoked_and_expired_completion() {
        let _lock = TEST_LOCK.lock().unwrap();
        let (legacy, _) = fixture();
        assert!(accept_state(&legacy, 71, 72, 4).is_err());
        let pending = proxy_fixture(1101);
        assert!(accept_state(&pending.state, 1101, 1201, 4).is_err());
        assert!(!pending.prepare_proxy_inner(41101, apply_proxy).unwrap());
        pending.state.data.lock().unwrap().proxy_requested = Some(Instant::now() - PROXY_TIMEOUT);
        assert!(matches!(
            accept_state(&pending.state, 1101, 1201, 4),
            Err(NativeTlsFailure::ProxyConfiguration)
        ));
        assert!(pending.prepare_proxy_inner(41101, apply_proxy).is_err());
        assert!(!pending.proxy_applied());
        let revoked = proxy_fixture(1102);
        assert!(!revoked.prepare_proxy_inner(41102, apply_proxy).unwrap());
        revoked.revoke();
        assert!(accept_state(&revoked.state, 1102, 1202, 4).is_err());
        assert!(!revoked.proxy_applied());
    }
    #[test]
    fn proxy_failure_state_is_explicit_and_does_not_reclassify_generic_tls_faults() {
        let _lock = TEST_LOCK.lock().unwrap();
        let (legacy, _) = fixture();
        assert!(matches!(
            accept_state(&legacy, 71, 72, 5),
            Err(NativeTlsFailure::InvalidState)
        ));
        let context = proxy_fixture(1201);
        assert!(matches!(
            accept_state(&context.state, 1201, 1301, 5),
            Err(NativeTlsFailure::InvalidState)
        ));
        assert!(!context.prepare_proxy_inner(41201, apply_proxy).unwrap());
        assert!(matches!(
            accept_state(&context.state, 1201, 1301, 3),
            Err(NativeTlsFailure::EngineFailure)
        ));
        assert!(matches!(
            accept_state(&context.state, 1201, 1301, 5),
            Err(NativeTlsFailure::ProxyConfiguration)
        ));
    }
    #[test]
    fn owner_loss_precedes_late_proxy_success_or_failure_without_rearming() {
        let _lock = TEST_LOCK.lock().unwrap();
        let (mut state, hooks) = fixture();
        let shared = Arc::get_mut(&mut state).unwrap();
        shared.functions.capabilities |= PROXY_APPLIED;
        shared.data.lock().unwrap().proxy_requested = Some(Instant::now());
        hooks.current.store(false, Ordering::Release);
        for status in [4, 5] {
            assert!(matches!(
                accept_state(&state, 71, 72, status),
                Err(NativeTlsFailure::OwnerUnavailable)
            ));
            assert!(!state.data.lock().unwrap().proxy_applied);
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
    fn requested_teardown_ack_before_pump_does_not_report_failure_or_release_late_decisions() {
        let _guard = TEST_LOCK.lock().unwrap();
        REPLIES.lock().unwrap().clear();
        REVOKES.store(0, Ordering::Release);
        let (state, hooks) = fixture();
        retained()
            .lock()
            .unwrap()
            .insert(state.token, state.clone());
        let late = pending(&state, 9);
        state.revoke();
        assert!(!state.data.lock().unwrap().revoke_sent);
        assert!(accept_state(&state, 71, 99, 2).is_err());
        assert!(retained().lock().unwrap().contains_key(&71));
        accept_state(&state, 71, 72, 2).unwrap();
        assert_eq!(state.data.lock().unwrap().status, NativeTlsStatus::Revoked);
        assert!(state.data.lock().unwrap().failure.is_none());
        assert!(!retained().lock().unwrap().contains_key(&71));
        late.complete(NativeTlsDecision::AdmitNative);
        finish_callback(&state, Ok(accept_state(&state, 71, 72, 1)));
        finish_callback(&state, Ok(accept_state(&state, 71, 72, 2)));
        pump_inner().unwrap();
        assert!(REPLIES.lock().unwrap().is_empty());
        assert_eq!(REVOKES.load(Ordering::Acquire), 0);
        assert_eq!(hooks.failures.load(Ordering::Acquire), 0);
    }

    #[test]
    fn failure_then_native_ack_before_pump_notifies_legacy_hook_only_once() {
        let _guard = TEST_LOCK.lock().unwrap();
        let (state, hooks) = fixture();
        retained()
            .lock()
            .unwrap()
            .insert(state.token, state.clone());
        let late = pending(&state, 9);
        state.fail(NativeTlsFailure::InvalidEvidence);
        assert_eq!(hooks.failures.load(Ordering::Acquire), 1);
        accept_state(&state, 71, 72, 2).unwrap();
        late.complete(NativeTlsDecision::AdmitNative);
        state.fail(NativeTlsFailure::CompleteRejected);
        assert_eq!(
            state.data.lock().unwrap().failure,
            Some(NativeTlsFailure::InvalidEvidence)
        );
        assert_eq!(state.data.lock().unwrap().status, NativeTlsStatus::Revoked);
        assert!(state.data.lock().unwrap().challenges.is_empty());
        assert!(!retained().lock().unwrap().contains_key(&71));
        assert_eq!(hooks.failures.load(Ordering::Acquire), 1);
    }

    #[test]
    fn unsolicited_ack_from_initializing_or_installed_still_reports_failure_once() {
        let _guard = TEST_LOCK.lock().unwrap();
        for status in [NativeTlsStatus::Initializing, NativeTlsStatus::Installed] {
            let (state, hooks) = fixture();
            {
                let mut data = state.data.lock().unwrap();
                data.status = status;
                data.installed = status == NativeTlsStatus::Installed;
            }
            retained()
                .lock()
                .unwrap()
                .insert(state.token, state.clone());
            accept_state(&state, 71, 72, 2).unwrap();
            assert_eq!(hooks.failures.load(Ordering::Acquire), 1);
            assert_eq!(
                state.data.lock().unwrap().failure,
                Some(NativeTlsFailure::EngineRevoked)
            );
            assert!(state.data.lock().unwrap().challenges.is_empty());
            assert!(!retained().lock().unwrap().contains_key(&71));
            finish_callback(&state, Ok(accept_state(&state, 71, 72, 2)));
            assert_eq!(hooks.failures.load(Ordering::Acquire), 1);
        }
    }

    #[derive(Default)]
    struct TypedHooks {
        reasons: Mutex<Vec<NativeTlsFailure>>,
        state: Mutex<Weak<Shared>>,
        callback_completed: AtomicU64,
    }
    impl NativeTlsHooks for TypedHooks {
        fn is_current(&self) -> bool {
            true
        }
        fn on_evidence(&self, _: NativeTlsEvidence, _: NativeTlsCompletion) {}
        fn on_failure(&self) {
            panic!("typed hook must receive the fixed cause");
        }
        fn on_failure_reason(&self, reason: NativeTlsFailure) {
            self.reasons.lock().unwrap().push(reason);
            let state = self.state.lock().unwrap().upgrade().unwrap();
            // Delivery is outside native-state locks and safe against reentry.
            assert!(state.data.try_lock().is_ok());
            assert_eq!(state.data.lock().unwrap().failure, Some(reason));
            state.fail(NativeTlsFailure::Callback);
            self.callback_completed.fetch_add(1, Ordering::Release);
        }
    }
    fn typed_fixture(complete_fn: Complete, revoke_fn: Revoke) -> (Arc<Shared>, Arc<TypedHooks>) {
        let (mut state, _) = fixture();
        let hooks = Arc::new(TypedHooks::default());
        let owned = Arc::get_mut(&mut state).unwrap();
        owned.functions.complete = complete_fn;
        owned.functions.revoke = revoke_fn;
        owned.hooks = hooks.clone();
        *hooks.state.lock().unwrap() = Arc::downgrade(&state);
        (state, hooks)
    }
    unsafe extern "C" fn reject_complete(t: u64, g: u64, c: u64, d: u32, m: u32) -> i32 {
        REPLIES.lock().unwrap().push((t, g, c, d, m));
        0
    }
    unsafe extern "C" fn reject_revoke(_: u64, _: u64) -> i32 {
        0
    }

    #[test]
    fn typed_failures_retain_first_cause_before_reentrant_delivery() {
        for reason in [
            NativeTlsFailure::ContextCreation,
            NativeTlsFailure::InvalidEvidence,
            NativeTlsFailure::InvalidState,
            NativeTlsFailure::OwnerUnavailable,
            NativeTlsFailure::Callback,
            NativeTlsFailure::CompleteRejected,
            NativeTlsFailure::RevokeRejected,
            NativeTlsFailure::EngineRevoked,
            NativeTlsFailure::EngineFailure,
            NativeTlsFailure::PoisonedState,
            NativeTlsFailure::WrongThread,
        ] {
            let (state, hooks) = typed_fixture(complete, revoke);
            state.fail(reason);
            state.fail(NativeTlsFailure::Callback);
            state.revoke();
            assert_eq!(*hooks.reasons.lock().unwrap(), vec![reason]);
            assert_eq!(hooks.callback_completed.load(Ordering::Acquire), 1);
            assert_eq!(state.data.lock().unwrap().failure, Some(reason));
            assert_eq!(state.data.lock().unwrap().status, NativeTlsStatus::Failed);
        }
    }

    #[test]
    fn complete_zero_is_context_local_failure_for_allow_and_expired_denial() {
        let _guard = TEST_LOCK.lock().unwrap();
        for expired in [false, true] {
            REPLIES.lock().unwrap().clear();
            let (state, hooks) = typed_fixture(reject_complete, revoke);
            let (mut independent, _) = fixture();
            Arc::get_mut(&mut independent).unwrap().token = 81;
            retained().lock().unwrap().insert(71, state.clone());
            retained().lock().unwrap().insert(81, independent.clone());
            let reply = pending(&state, 9);
            if expired {
                state
                    .data
                    .lock()
                    .unwrap()
                    .challenges
                    .get_mut(&9)
                    .unwrap()
                    .since = Instant::now() - TIMEOUT;
            }
            reply.complete(NativeTlsDecision::AdmitNative);
            pending(&independent, 10).complete(NativeTlsDecision::AdmitNative);
            assert!(pump_inner().is_ok()); // Never escalates to process-wide runtime failure.
            assert_eq!(
                *hooks.reasons.lock().unwrap(),
                vec![NativeTlsFailure::CompleteRejected]
            );
            assert_eq!(hooks.callback_completed.load(Ordering::Acquire), 1);
            assert_eq!(state.data.lock().unwrap().status, NativeTlsStatus::Failed);
            assert_eq!(
                independent.data.lock().unwrap().status,
                NativeTlsStatus::Installed
            );
            assert_eq!(
                *REPLIES.lock().unwrap(),
                vec![
                    (71, 72, 9, if expired { 0 } else { 1 }, 0),
                    (81, 72, 10, 1, 0)
                ]
            );
            pump_inner().unwrap();
            assert_eq!(REPLIES.lock().unwrap().len(), 2);
            accept_state(&state, 71, 72, 2).unwrap();
            assert_eq!(hooks.reasons.lock().unwrap().len(), 1);
            retained().lock().unwrap().remove(&81);
        }
    }

    #[test]
    fn expired_challenge_is_denied_without_context_failure_or_second_completion() {
        let _guard = TEST_LOCK.lock().unwrap();
        REPLIES.lock().unwrap().clear();
        let (state, hooks) = typed_fixture(complete, revoke);
        retained().lock().unwrap().insert(71, state.clone());
        let late = pending(&state, 9);
        state
            .data
            .lock()
            .unwrap()
            .challenges
            .get_mut(&9)
            .unwrap()
            .since = Instant::now() - TIMEOUT;
        pump_inner().unwrap();
        late.complete(NativeTlsDecision::AdmitNative);
        pump_inner().unwrap();
        assert_eq!(*REPLIES.lock().unwrap(), vec![(71, 72, 9, 0, 0)]);
        assert_eq!(
            state.data.lock().unwrap().status,
            NativeTlsStatus::Installed
        );
        assert!(hooks.reasons.lock().unwrap().is_empty());
        assert_eq!(hooks.callback_completed.load(Ordering::Acquire), 0);
        retained().lock().unwrap().remove(&71);
    }

    #[test]
    fn engine_state_failure_and_callback_panic_keep_distinct_first_reasons() {
        let (state, hooks) = typed_fixture(complete, revoke);
        assert_eq!(
            accept_state(&state, 71, 99, 3),
            Err(NativeTlsFailure::InvalidState)
        );
        finish_callback(&state, Ok(accept_state(&state, 71, 72, 3)));
        assert_eq!(
            *hooks.reasons.lock().unwrap(),
            vec![NativeTlsFailure::EngineFailure]
        );
        assert_eq!(hooks.callback_completed.load(Ordering::Acquire), 1);
        let (state, hooks) = typed_fixture(complete, revoke);
        finish_callback(&state, Err(Box::new("synthetic callback panic")));
        assert_eq!(
            *hooks.reasons.lock().unwrap(),
            vec![NativeTlsFailure::Callback]
        );
        assert_eq!(hooks.callback_completed.load(Ordering::Acquire), 1);
    }

    #[test]
    fn rejected_revoke_is_typed_without_global_pump_error() {
        let _guard = TEST_LOCK.lock().unwrap();
        let (state, hooks) = typed_fixture(complete, reject_revoke);
        retained().lock().unwrap().insert(71, state.clone());
        state.revoke();
        assert!(pump_inner().is_ok());
        assert_eq!(
            *hooks.reasons.lock().unwrap(),
            vec![NativeTlsFailure::RevokeRejected]
        );
        assert_eq!(hooks.callback_completed.load(Ordering::Acquire), 1);
        accept_state(&state, 71, 72, 2).unwrap();
        assert_eq!(hooks.reasons.lock().unwrap().len(), 1);
    }
    #[test]
    fn borrowed_chains_are_owned_and_destination_port_is_preserved() {
        let (state, _) = fixture();
        let mut der = [0x30, 1, 0];
        let chain = [Bytes {
            data: der.as_ptr(),
            length: der.len(),
        }];
        let mut raw = raw_evidence(b"fixture.invalid", &chain);
        raw.port = 8443;
        let owned = unsafe { owned_evidence(&raw, &state) }.unwrap();
        der[0] = 0;
        assert_eq!(der[0], 0);
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

    // ---- Revision 6: per-context HTTP disk cache (C-H1/C-H2) ----

    const REVISION6: u64 = REQUIRED | HTTP_CACHE_REVISION;

    #[test]
    fn http_cache_revision_is_accepted_only_with_its_exact_pin_and_every_revision5_bit() {
        let actual = std::ffi::CString::new(HTTP_CACHE_PATCH_ID).unwrap();
        let revision5 = std::ffi::CString::new(HTTP3_PATCH_ID).unwrap();
        let check = |pin: &std::ffi::CString, requested: &str, capabilities: u64| unsafe {
            matches_bridge_revision(pin.as_ptr(), requested, capabilities)
        };
        assert!(check(&actual, HTTP_CACHE_PATCH_ID, REVISION6));
        assert!(check(
            &actual,
            HTTP_CACHE_PATCH_ID,
            REVISION6 | EXCEPTIONS | CUSTOM_CA
        ));
        // Missing any revision-5 bit, or the cache bit itself, is rejected.
        for bit in [
            SAME_AUTHORITY_HTTP2,
            OWNED_HTTP3,
            PROXY_APPLIED,
            BOUNDED_RETIREMENT,
            HTTP_DISK_CACHE,
        ] {
            assert!(!check(&actual, HTTP_CACHE_PATCH_ID, REVISION6 & !bit));
        }
        // Contradictory and unknown bits.
        assert!(!check(&actual, HTTP_CACHE_PATCH_ID, REVISION6 | HTTP1));
        assert!(!check(&actual, HTTP_CACHE_PATCH_ID, REVISION6 | (1 << 11)));
        assert!(!check(&actual, HTTP_CACHE_PATCH_ID, REVISION6 | (1 << 63)));
        // The bit never upgrades or relabels another revision.
        assert!(!check(&revision5, HTTP_CACHE_PATCH_ID, REVISION6));
        assert!(!check(&revision5, HTTP3_PATCH_ID, REVISION6));
        assert!(!check(&actual, HTTP3_PATCH_ID, REVISION6));
        assert!(!check(&actual, PATCH_ID, REVISION6));
        assert!(!check(
            &actual,
            HTTP_CACHE_PATCH_ID,
            REVISION6 & !HTTP_DISK_CACHE
        ));
        let current = std::ffi::CString::new(PATCH_ID).unwrap();
        assert!(!check(
            &current,
            PATCH_ID,
            REQUIRED | SAME_AUTHORITY_HTTP2 | PROXY_APPLIED | BOUNDED_RETIREMENT | HTTP_DISK_CACHE
        ));
        // Revision 5 itself is unchanged.
        assert!(check(
            &revision5,
            HTTP3_PATCH_ID,
            REVISION6 & !HTTP_DISK_CACHE
        ));
    }

    #[derive(Debug, PartialEq, Eq)]
    enum FfiCall {
        Plain {
            private_settings: bool,
        },
        Cache {
            private_settings: bool,
            directory: String,
            max_bytes: u64,
            size: u32,
            reserved: u32,
        },
    }
    static FFI_CALLS: Mutex<Vec<FfiCall>> = Mutex::new(Vec::new());
    static FFI_TOKENS: Mutex<Vec<u64>> = Mutex::new(Vec::new());

    unsafe fn private_settings(
        context: *const Context,
        settings: *const cef::sys::_cef_request_context_settings_t,
    ) -> bool {
        FFI_TOKENS
            .lock()
            .unwrap()
            .push(unsafe { (*context).context_token });
        // The invariant at the FFI boundary: still an in-memory profile.
        let settings = unsafe { &*settings };
        settings.cache_path.length == 0 && settings.persist_session_cookies == 0
    }
    unsafe extern "C" fn fake_plain_create(
        context: *const Context,
        settings: *const cef::sys::_cef_request_context_settings_t,
        _: *mut cef::sys::_cef_request_context_handler_t,
    ) -> *mut cef::sys::_cef_request_context_t {
        let private_settings = unsafe { private_settings(context, settings) };
        FFI_CALLS
            .lock()
            .unwrap()
            .push(FfiCall::Plain { private_settings });
        ptr::null_mut()
    }
    unsafe extern "C" fn fake_cache_create(
        context: *const Context,
        settings: *const cef::sys::_cef_request_context_settings_t,
        _: *mut cef::sys::_cef_request_context_handler_t,
        cache: *const RawHttpCache,
    ) -> *mut cef::sys::_cef_request_context_t {
        let private_settings = unsafe { private_settings(context, settings) };
        let cache = unsafe { &*cache };
        let bytes = unsafe {
            std::slice::from_raw_parts(cache.directory_utf8.cast::<u8>(), cache.directory_length)
        };
        FFI_CALLS.lock().unwrap().push(FfiCall::Cache {
            private_settings,
            directory: String::from_utf8(bytes.to_vec()).unwrap(),
            max_bytes: cache.max_bytes,
            size: cache.size,
            reserved: cache.reserved,
        });
        ptr::null_mut()
    }
    fn fake_bridge(capabilities: u64) -> NativeTlsBridge {
        NativeTlsBridge {
            functions: Functions {
                create: fake_plain_create,
                create_with_cache: (capabilities & HTTP_DISK_CACHE != 0)
                    .then_some(fake_cache_create as CreateWithCache),
                complete,
                revoke,
                apply_proxy: None,
                configure_datagrams: None,
                capabilities,
            },
            _ui: PhantomData,
        }
    }
    fn cache_spec() -> HttpDiskCacheSpec {
        let root = if cfg!(windows) {
            std::path::PathBuf::from(r"C:\fixture\browser")
        } else {
            std::path::PathBuf::from("/fixture/browser")
        };
        HttpDiskCacheSpec::new(root.join("http-cache").join("db").join("conn"), 128 << 20).unwrap()
    }
    fn create_with_fakes(
        capabilities: u64,
        spec: Option<&HttpDiskCacheSpec>,
    ) -> (Vec<FfiCall>, Arc<Hooks>, NativeTlsError) {
        FFI_CALLS.lock().unwrap().clear();
        FFI_TOKENS.lock().unwrap().clear();
        let hooks = Arc::new(Hooks {
            current: AtomicBool::new(true),
            failures: AtomicUsize::new(0),
        });
        let bridge = fake_bridge(capabilities);
        let error = match bridge.create_context_inner(
            &NativeTlsConfig::default(),
            hooks.clone(),
            ptr::null_mut(),
            true,
            spec,
        ) {
            Ok(_) => panic!("fake factories never create a context"),
            Err(error) => error,
        };
        // Every attempt is callback quiescent (bounded retirement): none of
        // their userdata may remain registered after NULL.
        let registry = retained().lock().unwrap();
        for token in FFI_TOKENS.lock().unwrap().iter() {
            assert!(!registry.contains_key(token));
        }
        drop(registry);
        (
            std::mem::take(&mut *FFI_CALLS.lock().unwrap()),
            hooks,
            error,
        )
    }

    #[test]
    fn cache_requested_on_engine_without_the_bit_creates_exactly_the_plain_context() {
        let _guard = TEST_LOCK.lock().unwrap();
        let spec = cache_spec();
        let revision5 = REQUIRED | (HTTP_CACHE_REVISION & !HTTP_DISK_CACHE);
        let (calls, hooks, error) = create_with_fakes(revision5, Some(&spec));
        assert_eq!(
            calls,
            vec![FfiCall::Plain {
                private_settings: true
            }]
        );
        assert_eq!(error, NativeTlsError::Unavailable);
        assert_eq!(hooks.failures.load(Ordering::Acquire), 1);
        assert!(!fake_bridge(revision5).supports_http_disk_cache());
        assert_eq!(
            fake_bridge(revision5).requested_cache(Some(&spec)).err(),
            Some(HttpCacheMemoryReason::EngineUnsupported)
        );
        // A bit without its export (never produced by from_loaded) is not support.
        let mut orphan = fake_bridge(REVISION6);
        orphan.functions.create_with_cache = None;
        assert!(!orphan.supports_http_disk_cache());
    }

    #[test]
    fn null_from_the_cache_variant_retries_plain_exactly_once_without_notifying_the_owner() {
        let _guard = TEST_LOCK.lock().unwrap();
        let spec = cache_spec();
        let (calls, hooks, error) = create_with_fakes(REVISION6, Some(&spec));
        assert_eq!(
            calls,
            vec![
                FfiCall::Cache {
                    private_settings: true,
                    directory: spec.directory.to_str().unwrap().to_owned(),
                    max_bytes: 128 << 20,
                    size: 32,
                    reserved: 0,
                },
                FfiCall::Plain {
                    private_settings: true
                },
            ]
        );
        // Only the plain retry's NULL is an owner-visible creation failure.
        assert_eq!(error, NativeTlsError::Unavailable);
        assert_eq!(hooks.failures.load(Ordering::Acquire), 1);
        let tokens = FFI_TOKENS.lock().unwrap().clone();
        assert_eq!(tokens.len(), 2);
        assert!(tokens[1] > tokens[0], "retry needs a fresh registration");
    }

    #[test]
    fn plain_requests_and_invalid_specs_never_reach_the_cache_export() {
        let _guard = TEST_LOCK.lock().unwrap();
        let (calls, _, _) = create_with_fakes(REVISION6, None);
        assert_eq!(
            calls,
            vec![FfiCall::Plain {
                private_settings: true
            }]
        );
        let mut invalid = cache_spec();
        invalid.max_bytes = 0;
        let (calls, hooks, _) = create_with_fakes(REVISION6, Some(&invalid));
        assert_eq!(
            calls,
            vec![FfiCall::Plain {
                private_settings: true
            }]
        );
        assert_eq!(hooks.failures.load(Ordering::Acquire), 1);
        let bridge = fake_bridge(REVISION6);
        assert!(bridge.supports_http_disk_cache());
        assert_eq!(bridge.patch_id(), HTTP_CACHE_PATCH_ID);
        assert_eq!(
            bridge.requested_cache(None).err(),
            Some(HttpCacheMemoryReason::NotRequested)
        );
        assert_eq!(
            bridge.requested_cache(Some(&invalid)).err(),
            Some(HttpCacheMemoryReason::InvalidSpec)
        );
        assert!(bridge.requested_cache(Some(&cache_spec())).is_ok());
    }

    fn cache_fixture(token: u64) -> (NativeTlsContext, Arc<Hooks>) {
        let (mut state, hooks) = fixture();
        let shared = Arc::get_mut(&mut state).unwrap();
        shared.token = token;
        shared.generation = token + 1;
        shared.functions.capabilities = REVISION6;
        shared.http_cache = Some(HttpCacheReleaseSignal::default());
        retained().lock().unwrap().insert(token, state.clone());
        (
            NativeTlsContext {
                state,
                cache_use: HttpCacheUse::Disk,
                _ui: PhantomData,
            },
            hooks,
        )
    }

    #[test]
    fn cache_userdata_lives_until_both_revocation_and_release_in_either_order() {
        let _guard = TEST_LOCK.lock().unwrap();
        // State 7 before state 2: still registered until revocation.
        let (context, hooks) = cache_fixture(3001);
        let signal = context.http_cache_release_signal().unwrap();
        assert_eq!(context.http_cache_use(), HttpCacheUse::Disk);
        assert!(!context.http_cache_released());
        // A stale owner does not block the engine's release report.
        hooks.current.store(false, Ordering::Release);
        accept_state(&context.state, 3001, 3002, 7).unwrap();
        assert!(context.http_cache_released() && signal.is_released());
        assert!(retained().lock().unwrap().contains_key(&3001));
        assert_eq!(context.status(), NativeTlsStatus::Installed);
        context.revoke();
        accept_state(&context.state, 3001, 3002, 2).unwrap();
        assert!(!retained().lock().unwrap().contains_key(&3001));
        assert_eq!(hooks.failures.load(Ordering::Acquire), 0);

        // State 2 before state 7: revoked, but userdata and lease are held.
        let (context, hooks) = cache_fixture(3011);
        let signal = context.http_cache_release_signal().unwrap();
        context.revoke();
        accept_state(&context.state, 3011, 3012, 2).unwrap();
        assert_eq!(context.status(), NativeTlsStatus::Revoked);
        assert!(retained().lock().unwrap().contains_key(&3011));
        assert!(!context.http_cache_released());
        drop(context); // The lease observer outlives the context owner.
        assert!(!signal.is_released());
        let state = retained().lock().unwrap()[&3011].clone();
        accept_state(&state, 3011, 3012, 7).unwrap();
        assert!(signal.is_released());
        assert!(!retained().lock().unwrap().contains_key(&3011));
        assert_eq!(hooks.failures.load(Ordering::Acquire), 0);
    }

    #[test]
    fn duplicate_foreign_or_uncached_release_is_invalid_state() {
        let _guard = TEST_LOCK.lock().unwrap();
        // Duplicate 7 while live: protocol violation fails the context.
        let (context, hooks) = cache_fixture(3101);
        assert_eq!(
            accept_state(&context.state, 3101, 9999, 7),
            Err(NativeTlsFailure::InvalidState)
        );
        assert_eq!(
            accept_state(&context.state, 9999, 3102, 7),
            Err(NativeTlsFailure::InvalidState)
        );
        assert!(!context.http_cache_released());
        accept_state(&context.state, 3101, 3102, 7).unwrap();
        assert_eq!(
            accept_state(&context.state, 3101, 3102, 7),
            Err(NativeTlsFailure::InvalidState)
        );
        finish_callback(
            &context.state,
            Ok(accept_state(&context.state, 3101, 3102, 7)),
        );
        assert_eq!(context.status(), NativeTlsStatus::Failed);
        assert_eq!(hooks.failures.load(Ordering::Acquire), 1);
        accept_state(&context.state, 3101, 3102, 2).unwrap();
        assert!(!retained().lock().unwrap().contains_key(&3101));

        // Duplicate 7 after both 2 and 7: rejected, nothing resurrected.
        let (context, hooks) = cache_fixture(3111);
        context.revoke();
        accept_state(&context.state, 3111, 3112, 7).unwrap();
        accept_state(&context.state, 3111, 3112, 2).unwrap();
        assert!(!retained().lock().unwrap().contains_key(&3111));
        assert_eq!(
            accept_state(&context.state, 3111, 3112, 7),
            Err(NativeTlsFailure::InvalidState)
        );
        assert!(!retained().lock().unwrap().contains_key(&3111));
        assert_eq!(hooks.failures.load(Ordering::Acquire), 0);

        // 7 on a context created without a disk cache, on any revision.
        for capabilities in [REQUIRED | EXCEPTIONS | CUSTOM_CA, REVISION6] {
            let (mut state, _) = fixture();
            Arc::get_mut(&mut state).unwrap().functions.capabilities = capabilities;
            assert_eq!(
                accept_state(&state, 71, 72, 7),
                Err(NativeTlsFailure::InvalidState)
            );
            let plain = NativeTlsContext {
                state,
                cache_use: HttpCacheUse::Memory(HttpCacheMemoryReason::NotRequested),
                _ui: PhantomData,
            };
            assert!(plain.http_cache_released());
            assert!(plain.http_cache_release_signal().is_none());
        }
    }

    #[test]
    fn refused_cache_registration_is_removed_silently_and_released() {
        let _guard = TEST_LOCK.lock().unwrap();
        let (context, hooks) = cache_fixture(3201);
        let signal = context.http_cache_release_signal().unwrap();
        let state = context.state.clone();
        assert!(matches!(
            finish_refused_cache_context(context),
            CreateFailure::CacheRefused
        ));
        assert!(!retained().lock().unwrap().contains_key(&3201));
        assert!(signal.is_released());
        assert_eq!(hooks.failures.load(Ordering::Acquire), 0);
        assert_eq!(
            state.data.lock().unwrap().failure,
            Some(NativeTlsFailure::ContextCreation)
        );
        // No registry or engine reference to the refused userdata remains.
        assert_eq!(Arc::strong_count(&state), 1);
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
        // Shutdown destroyed every NetworkContext: no directory is held.
        if let Some(signal) = &state.http_cache {
            signal.release();
        }
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
