//! Exercise the production CEF callbacks without a browser window or renderer.
use super::*;
use cef::rc::{ConvertParam, ConvertReturnValue, RcImpl};
use cef::sys::{_cef_browser_t, _cef_frame_t, cef_string_userfree_t};

#[derive(Default)]
struct Events(Mutex<Vec<BrowserEvent>>);
impl BrowserEventSink for Events {
    fn on_event(&self, event: BrowserEvent) { self.0.lock().unwrap().push(event); }
}

fn string(value: &str) -> cef_string_userfree_t {
    let value: Vec<_> = value.encode_utf16().collect();
    unsafe {
        let out = cef::sys::cef_string_userfree_utf16_alloc();
        assert!(!out.is_null());
        assert_eq!(cef::sys::cef_string_utf16_set(value.as_ptr(), value.len(), out, 1), 1);
        out
    }
}

fn frame(main: bool, id: &'static str) -> Frame {
    frame_url(main, id, "https://fixture.invalid/ready")
}
fn frame_url(main: bool, id: &'static str, url: &'static str) -> Frame {
    extern "C" fn valid(_: *mut _cef_frame_t) -> i32 {
        1
    }
    extern "C" fn is_main(this: *mut _cef_frame_t) -> i32 {
        i32::from(
            RcImpl::<_cef_frame_t, (bool, &'static str, &'static str)>::get(this)
                .interface
                .0,
        )
    }
    extern "C" fn identifier(this: *mut _cef_frame_t) -> cef_string_userfree_t {
        string(
            RcImpl::<_cef_frame_t, (bool, &'static str, &'static str)>::get(this)
                .interface
                .1,
        )
    }
    extern "C" fn address(this: *mut _cef_frame_t) -> cef_string_userfree_t {
        string(
            RcImpl::<_cef_frame_t, (bool, &'static str, &'static str)>::get(this)
                .interface
                .2,
        )
    }
    let raw = _cef_frame_t {
        is_valid: Some(valid),
        is_main: Some(is_main),
        get_identifier: Some(identifier),
        get_url: Some(address),
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_frame_t = RcImpl::new(raw, (main, id, url)).cast();
    raw.wrap_result()
}

fn browser(main: Frame) -> Browser {
    extern "C" fn valid(_: *mut _cef_browser_t) -> i32 { 1 }
    extern "C" fn identifier(_: *mut _cef_browser_t) -> i32 { 41 }
    extern "C" fn main_frame(this: *mut _cef_browser_t) -> *mut _cef_frame_t {
        RcImpl::<_cef_browser_t, Frame>::get(this).interface.clone().into_raw()
    }
    let raw = _cef_browser_t {
        is_valid: Some(valid), get_identifier: Some(identifier), get_main_frame: Some(main_frame),
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_browser_t = RcImpl::new(raw, main).cast();
    raw.wrap_result()
}

async fn fixture() -> (Arc<Shared>, Arc<Events>, Browser, LoadHandler) {
    #[cfg(target_os = "macos")]
    crate::platform::test_runtime::ensure_loaded();
    let events = Arc::new(Events::default());
    let mut core = super::tests::fixture(events.clone()).await;
    core.permissions = Arc::new(
        WebsitePermissionEngine::new(
            None,
            None,
            &[(
                crate::domain_permissions::WebsiteRequestClass::Navigation,
                crate::domain_permissions::WebsitePermissionDecision::Allow,
            )]
            .into_iter()
            .collect(),
        )
        .unwrap(),
    );
    {
        let mut session = core.session.lock().unwrap();
        let ready = sorng_protocols::origin_browser::NativeHostReadiness::Ready {
            profile_key: session.policy().profile_key().into(),
            proxy_endpoint: session.proxy_endpoint(),
        };
        session.report_host(&core.identity, ready).unwrap();
    }
    let shared = Arc::new(core);
    shared.state.lock().unwrap().browser_id = Some(41);
    let browser = browser(frame(true, "committed-main"));
    let handler = NativeLoad::new(shared.clone());
    (shared, events, browser, handler)
}

#[tokio::test]
async fn provisional_tunnel_failure_survives_error_document_and_loading_stopped() {
    let (shared, events, mut browser, handler) = fixture().await;
    // A redirect may fail before commit, while browser.main_frame() still
    // references the previous document. Matching identifiers would lose -111.
    let mut provisional = frame(true, "provisional-redirect");
    handler.on_loading_state_change(Some(&mut browser), 1, 0, 0);
    handler.on_load_error(Some(&mut browser), Some(&mut provisional),
        Errorcode::TUNNEL_CONNECTION_FAILED, Some(&CefString::from("SECRET")),
        Some(&CefString::from("https://redirect.invalid/?token=SECRET")));
    assert!(shared.current());
    assert_eq!(shared.state.lock().unwrap().control.lifecycle(), Lifecycle::Hidden);
    let failure = shared.state.lock().unwrap().page.load_failure.unwrap();
    assert_eq!(failure.code, -111);
    assert_eq!(failure.category.as_str(), "proxy");
    assert!(!shared.automation.lock().unwrap().available());
    let mut committed = browser.main_frame().unwrap();
    handler.on_load_end(Some(&mut browser), Some(&mut committed), 200);
    handler.on_loading_state_change(Some(&mut browser), 0, 1, 0);
    assert_eq!(shared.state.lock().unwrap().page.load_failure, Some(failure));
    assert!(!shared.state.lock().unwrap().page.document_loaded);
    assert!(!shared.automation.lock().unwrap().available());
    assert!(events.0.lock().unwrap().last().unwrap().state.can_go_back);
    assert!(shared.current());
    assert!(shared.state.lock().unwrap().page.fault.is_none());
}

#[tokio::test]
async fn subframe_missing_frame_and_cancelled_loads_do_not_replace_the_main_document() {
    let (shared, _, mut browser, handler) = fixture().await;
    let mut child = frame(false, "child");
    handler.on_load_error(Some(&mut browser), Some(&mut child), Errorcode::TUNNEL_CONNECTION_FAILED, None, None);
    handler.on_load_error(Some(&mut browser), None, Errorcode::TUNNEL_CONNECTION_FAILED, None, None);
    let mut main = frame(true, "committed-main");
    handler.on_load_error(Some(&mut browser), Some(&mut main), Errorcode::ABORTED, None, None);
    handler.on_loading_state_change(Some(&mut browser), 0, 0, 0);
    assert!(shared.state.lock().unwrap().page.load_failure.is_none());
    assert!(shared.automation.lock().unwrap().available());
    assert!(shared.current());
}

#[tokio::test]
async fn http_error_content_remains_a_loaded_document() {
    let (shared, _, mut browser, handler) = fixture().await;
    let mut main = frame(true, "committed-main");
    for status in [200, 301, 401, 403, 404, 407, 500, 502, 503] {
        shared.automation.lock().unwrap().navigating = true;
        handler.on_load_end(Some(&mut browser), Some(&mut main), status);
        assert!(shared.state.lock().unwrap().page.load_failure.is_none());
        assert!(shared.state.lock().unwrap().page.document_loaded);
        assert!(shared.automation.lock().unwrap().available());
    }
}

#[tokio::test]
async fn only_current_admitted_main_load_end_proves_completion_even_without_loading_edge() {
    let (shared, events, mut owned, handler) = fixture().await;
    assert!(!shared.state.lock().unwrap().page.loading);
    assert!(!shared.state.lock().unwrap().page.document_loaded);
    handler.on_loading_state_change(Some(&mut owned), 0, 0, 0);
    assert!(!shared.state.lock().unwrap().page.document_loaded);
    let mut child = frame(false, "child");
    let mut foreign_main = frame(true, "foreign-main");
    let mut inert = frame_url(true, "committed-main", "about:blank");
    let mut denied = frame_url(true, "committed-main", "https://attacker.invalid/ready");
    let mut mismatch = frame_url(true, "committed-main", "https://fixture.invalid/other");
    for callback in [
        &mut child,
        &mut foreign_main,
        &mut inert,
        &mut denied,
        &mut mismatch,
    ] {
        handler.on_load_end(Some(&mut owned), Some(callback), 200);
        assert!(!shared.state.lock().unwrap().page.document_loaded);
    }
    let mut main = owned.main_frame().unwrap();
    let mut other = super::tests::focus_browser(1, 42);
    handler.on_load_end(Some(&mut other), Some(&mut main), 200);
    assert!(!shared.state.lock().unwrap().page.document_loaded);
    handler.on_load_end(Some(&mut owned), Some(&mut main), 200);
    assert!(
        events
            .0
            .lock()
            .unwrap()
            .last()
            .unwrap()
            .state
            .document_loaded
    );
    handler.on_load_error(
        Some(&mut owned),
        Some(&mut main),
        Errorcode::TUNNEL_CONNECTION_FAILED,
        None,
        None,
    );
    assert!(!shared.state.lock().unwrap().page.document_loaded);
    handler.on_load_end(Some(&mut owned), Some(&mut main), 200);
    assert!(!shared.state.lock().unwrap().page.document_loaded);
}

#[tokio::test]
async fn hidden_failure_is_published_but_foreign_and_retired_callbacks_are_ignored() {
    let (shared, events, mut browser, handler) = fixture().await;
    shared.state.lock().unwrap().control.hide(&shared.identity).unwrap();
    let mut main = frame(true, "committed-main");
    let mut other = super::tests::focus_browser(1, 42);
    handler.on_load_error(Some(&mut other), Some(&mut main), Errorcode::TUNNEL_CONNECTION_FAILED, None, None);
    assert!(events.0.lock().unwrap().is_empty());
    handler.on_load_error(Some(&mut browser), Some(&mut main), Errorcode::TUNNEL_CONNECTION_FAILED, None, None);
    assert_eq!(events.0.lock().unwrap().last().unwrap().state.load_failure.unwrap().code, -111);
    assert_eq!(shared.state.lock().unwrap().control.lifecycle(), Lifecycle::Hidden);
    let count = events.0.lock().unwrap().len();
    shared.state.lock().unwrap().control.begin_close(&shared.identity).unwrap();
    handler.on_load_error(Some(&mut browser), Some(&mut main), Errorcode::NAME_NOT_RESOLVED, None, None);
    assert_eq!(events.0.lock().unwrap().len(), count);
}
