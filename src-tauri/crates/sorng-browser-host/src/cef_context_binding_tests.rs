//! Synthetic native vtables exercise the real cef-rs Browser -> Host -> Context
//! calls. No engine initialization, profile, renderer, or destination is used.
use super::*;
use cef::rc::{ConvertReturnValue, RcImpl};
use cef::sys::{
    _cef_browser_host_t, _cef_browser_t, _cef_preference_manager_t, _cef_request_context_t,
    _cef_value_t, cef_string_t, cef_string_userfree_t,
};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};

const ENDPOINT: &str = "127.0.0.1:18080";

fn select_api() {
    #[cfg(target_os = "macos")]
    crate::platform::test_runtime::ensure_loaded();
    crate::bootstrap_platform::select_pinned_api().unwrap();
}

fn proxy(mode: &str, server: &str, bypass: &str) -> Value {
    let mut dict = dictionary_value_create().unwrap();
    for (key, value) in [("mode", mode), ("server", server), ("bypass_list", bypass)] {
        assert_eq!(
            dict.set_string(Some(&CefString::from(key)), Some(&CefString::from(value))),
            1
        );
    }
    let value = value_create().unwrap();
    assert_eq!(value.set_dictionary(Some(&mut dict)), 1);
    value
}

fn expected_proxy(endpoint: SocketAddr) -> Value {
    proxy(
        "fixed_servers",
        &format!("http://{endpoint}"),
        "<-loopback>",
    )
}

struct ContextState {
    identity: usize,
    global: bool,
    cache: &'static str,
    preference: Option<Value>,
    drops: Arc<AtomicUsize>,
}

impl Drop for ContextState {
    fn drop(&mut self) {
        self.drops.fetch_add(1, Ordering::Relaxed);
    }
}

fn context(state: ContextState) -> RequestContext {
    extern "C" fn same(
        this: *mut _cef_request_context_t,
        other: *mut _cef_request_context_t,
    ) -> i32 {
        if other.is_null() {
            return 0;
        }
        let matches = RcImpl::<_cef_request_context_t, ContextState>::get(this)
            .interface
            .identity
            == RcImpl::<_cef_request_context_t, ContextState>::get(other)
                .interface
                .identity;
        // cef-rs adds a transferred argument reference for IsSame. Consume it,
        // just like the generated CEF callback bridge, rather than leaking it.
        let received: RequestContext = other.wrap_result();
        drop(received);
        i32::from(matches)
    }
    extern "C" fn global(this: *mut _cef_request_context_t) -> i32 {
        i32::from(
            RcImpl::<_cef_request_context_t, ContextState>::get(this)
                .interface
                .global,
        )
    }
    extern "C" fn cache(this: *mut _cef_request_context_t) -> cef_string_userfree_t {
        let text: Vec<u16> = RcImpl::<_cef_request_context_t, ContextState>::get(this)
            .interface
            .cache
            .encode_utf16()
            .collect();
        // SAFETY: Pair CEF's userfree allocation with the wrapper's destructor;
        // the copied string never borrows the test state's UTF-16 buffer.
        unsafe {
            let output = cef::sys::cef_string_userfree_utf16_alloc();
            if !output.is_null()
                && cef::sys::cef_string_utf16_set(text.as_ptr(), text.len(), output, 1) == 0
            {
                cef::sys::cef_string_userfree_utf16_free(output);
                return std::ptr::null_mut();
            }
            output
        }
    }
    extern "C" fn preference(
        this: *mut _cef_preference_manager_t,
        _: *const cef_string_t,
    ) -> *mut _cef_value_t {
        RcImpl::<_cef_request_context_t, ContextState>::get(this.cast())
            .interface
            .preference
            .clone()
            .map(Into::into)
            .unwrap_or_default()
    }
    let raw = _cef_request_context_t {
        base: _cef_preference_manager_t {
            get_preference: Some(preference),
            // SAFETY: Unused CEF vtable entries are nullable. RcImpl installs
            // the common base reference-counting callbacks before wrapping.
            ..unsafe { std::mem::zeroed() }
        },
        is_same: Some(same),
        is_global: Some(global),
        get_cache_path: Some(cache),
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_request_context_t = RcImpl::new(raw, state).cast();
    raw.wrap_result()
}

fn private_context(identity: usize, preference: Option<Value>) -> RequestContext {
    context(ContextState {
        identity,
        global: false,
        cache: "",
        preference,
        drops: Arc::default(),
    })
}

fn host(context: Option<RequestContext>) -> BrowserHost {
    extern "C" fn request_context(this: *mut _cef_browser_host_t) -> *mut _cef_request_context_t {
        RcImpl::<_cef_browser_host_t, Option<RequestContext>>::get(this)
            .interface
            .clone()
            .map(Into::into)
            .unwrap_or_default()
    }
    let raw = _cef_browser_host_t {
        get_request_context: Some(request_context),
        // SAFETY: Only this getter is called; RcImpl owns the base callbacks.
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_browser_host_t = RcImpl::new(raw, context).cast();
    raw.wrap_result()
}

fn browser(host: Option<BrowserHost>) -> Browser {
    extern "C" fn get_host(this: *mut _cef_browser_t) -> *mut _cef_browser_host_t {
        RcImpl::<_cef_browser_t, Option<BrowserHost>>::get(this)
            .interface
            .clone()
            .map(Into::into)
            .unwrap_or_default()
    }
    let raw = _cef_browser_t {
        get_host: Some(get_host),
        // SAFETY: Only this getter is called; RcImpl owns the base callbacks.
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_browser_t = RcImpl::new(raw, host).cast();
    raw.wrap_result()
}

#[test]
fn browser_binding_accepts_exact_returned_context_and_balances_native_refs() {
    select_api();
    let endpoint = ENDPOINT.parse().unwrap();
    let drops = Arc::new(AtomicUsize::new(0));
    {
        let mut retained = context(ContextState {
            identity: 1,
            global: false,
            cache: "",
            preference: Some(expected_proxy(endpoint)),
            drops: drops.clone(),
        });
        let browser = browser(Some(host(Some(retained.clone()))));
        for _ in 0..3 {
            assert_eq!(
                verify_native_browser_binding(&browser, &mut retained, endpoint),
                Ok(())
            );
        }
        assert_eq!(drops.load(Ordering::Relaxed), 0);
    }
    assert_eq!(
        drops.load(Ordering::Relaxed),
        1,
        "transferred context refs must be balanced"
    );
}

#[test]
fn browser_binding_rejects_foreign_global_and_persistent_contexts() {
    select_api();
    let endpoint = ENDPOINT.parse().unwrap();
    let mut retained = private_context(1, Some(expected_proxy(endpoint)));
    for (identity, global, cache) in [(2, false, ""), (1, true, ""), (1, false, "synthetic-cache")]
    {
        let actual = context(ContextState {
            identity,
            global,
            cache,
            preference: Some(expected_proxy(endpoint)),
            drops: Arc::default(),
        });
        let browser = browser(Some(host(Some(actual))));
        assert_eq!(
            verify_native_browser_binding(&browser, &mut retained, endpoint),
            Err(ContextError::SharedContext)
        );
    }
}

#[test]
fn browser_binding_reads_returned_context_proxy_not_the_factory_argument() {
    select_api();
    let endpoint = ENDPOINT.parse().unwrap();
    let mut retained = private_context(1, Some(expected_proxy(endpoint)));
    for preference in [
        None,
        Some(proxy("direct", "http://127.0.0.1:18080", "<-loopback>")),
        Some(proxy(
            "fixed_servers",
            "http://127.0.0.1:18081",
            "<-loopback>",
        )),
        Some(proxy("fixed_servers", "http://127.0.0.1:18080", "")),
    ] {
        // Same native identity, different callback wrapper: readback must come
        // from BrowserHost's returned context, not the original argument.
        let actual = private_context(1, preference);
        let browser = browser(Some(host(Some(actual))));
        assert_eq!(
            verify_native_browser_binding(&browser, &mut retained, endpoint),
            Err(ContextError::ProxyMismatch)
        );
    }
}

#[test]
fn browser_binding_rejects_missing_host_or_context() {
    select_api();
    let endpoint = ENDPOINT.parse().unwrap();
    let mut retained = private_context(1, Some(expected_proxy(endpoint)));
    for browser in [browser(None), browser(Some(host(None)))] {
        assert_eq!(
            verify_native_browser_binding(&browser, &mut retained, endpoint),
            Err(ContextError::SharedContext)
        );
    }
}

#[tokio::test]
async fn browser_binding_failure_revokes_only_the_owned_relay_and_retains_reason() {
    use sorng_protocols::origin_browser::OriginBrowserPolicy;
    use sorng_protocols::private_forward_proxy::{Authority, DialFuture, ProxyLimits};
    select_api();
    async fn session() -> OriginBrowserSession {
        OriginBrowserSession::start(
            OriginBrowserPolicy::new("fixture", "connection", "tab", "https://fixture.invalid")
                .unwrap(),
            Arc::new(|_: Authority| -> DialFuture { panic!("binding fixture must never dial") }),
            ProxyLimits::default(),
        )
        .await
        .unwrap()
    }
    let owned = session().await;
    let successor = session().await;
    let endpoint = owned.proxy_endpoint();
    let preparation = Preparation {
        identity: owned.policy().identity().clone(),
        session: Arc::new(Mutex::new(owned)),
        permissions: crate::cef_requests::deny_permissions(),
        status: Mutex::new(PreparationStatus::ProxyConfigured),
    };
    let mut retained = private_context(1, Some(expected_proxy(endpoint)));
    let actual = private_context(1, Some(expected_proxy(successor.proxy_endpoint())));
    let browser = browser(Some(host(Some(actual))));
    assert_eq!(
        preparation.verify_browser_binding(&browser, &mut retained),
        Err(ContextError::ProxyMismatch)
    );
    assert_eq!(
        preparation.current_status(),
        PreparationStatus::Failed(ContextError::ProxyMismatch)
    );
    assert!(preparation
        .session
        .lock()
        .unwrap()
        .with_proxy_credentials(|_, _| ())
        .is_none());
    assert!(successor.with_proxy_credentials(|_, _| ()).is_some());
    assert_eq!(
        preparation.verify_browser_binding(&browser, &mut retained),
        Err(ContextError::SessionUnavailable)
    );
}
