// Endpoint doubles around production load/browse callbacks. This proves the
// native state transition, not a live CEF or Google login.
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};

type CefString = String;
#[derive(Clone, Copy, PartialEq)]
struct Errorcode(i32);
impl From<Errorcode> for i32 {
    fn from(code: Errorcode) -> Self { code.0 }
}
#[cfg(head_load_fault)]
impl Errorcode { const ABORTED: Self = Self(-3); }
#[cfg(head_load_fault)]
enum BrowserFault { Load }
#[allow(non_camel_case_types)]
mod cef_dll_sys { pub type cef_errorcode_t = i32; }
/* PRODUCTION_NAVIGATION */

#[derive(Clone)]
struct Frame { valid: i32, main: i32, id: String }
// The pre-fix callback does not query current-frame identity at load completion.
#[allow(dead_code)]
impl Frame {
    fn is_valid(&self) -> i32 { self.valid }
    fn is_main(&self) -> i32 { self.main }
    fn identifier(&self) -> String { self.id.clone() }
}
struct Browser { id: i32, main: Option<Frame> }
#[allow(dead_code)]
impl Browser {
    fn main_frame(&self) -> Option<Frame> { self.main.clone() }
}
struct Request;

#[derive(Default)]
struct AutomationState { generation: u64, invalidating: usize, navigating: bool }
impl AutomationState { /* PRODUCTION_AVAILABLE */ }
#[derive(Default)]
struct Page {
    loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
    #[cfg(not(head_load_fault))]
    load_failure: Option<native_navigation::LoadFailure>,
}
#[derive(Default)]
struct State { page: Page }
#[derive(Debug)]
enum NativeNavigationStatus {
    BeforeBrowse { allowed: bool, main_frame: bool },
    LoadError { code: i32, main_frame: bool },
}
struct Shared {
    live: AtomicBool,
    automation: Mutex<AutomationState>,
    state: Mutex<State>,
}
impl Shared {
    fn accepts(&self, browser: Option<&Browser>) -> bool { browser.is_some_and(|b| b.id == 1) }
    fn current(&self) -> bool { self.live.load(Ordering::Acquire) }
    fn update(&self, browser: Option<&Browser>, change: impl FnOnce(&mut Page)) {
        if self.accepts(browser) && self.current() { change(&mut self.state.lock().unwrap().page); }
    }
    fn clear_automation(&self) { self.automation.lock().unwrap().generation += 1; }
    #[cfg(head_load_fault)]
    fn fault(&self, browser: Option<&Browser>, _: BrowserFault) {
        assert!(self.accepts(browser));
        self.live.store(false, Ordering::Release);
        self.clear_automation();
    }
    fn deny_media_on_ui(&self, _: Option<()>) {}
    fn cancel_certificate(&self, _: Option<()>) {}
    fn navigation_status(&self, status: NativeNavigationStatus) {
        match status {
            NativeNavigationStatus::BeforeBrowse { allowed, main_frame } => { let _ = (allowed, main_frame); }
            NativeNavigationStatus::LoadError { code, main_frame } => { let _ = (code, main_frame); }
        }
    }
}
trait LoadHandler {
    fn on_loading_state_change(&self, browser: Option<&mut Browser>, loading: i32, back: i32, forward: i32);
    // CEF's default callback lets the pre-fix source compile and fail on behavior.
    fn on_load_end(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>, _status: i32) {}
    fn on_load_error(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>, code: Errorcode,
        text: Option<&CefString>, url: Option<&CefString>);
}
macro_rules! wrap_load_handler {
    (struct $name:ident { shared: Arc<Shared> } impl LoadHandler { $($body:tt)* }) => {
        struct $name { shared: Arc<Shared> }
        impl LoadHandler for $name { $($body)* }
    };
}
/* PRODUCTION_LOAD */
struct Inner { decision: i32 }
impl Inner {
    fn on_before_browse(&self, _: Option<&mut Browser>, _: Option<&mut Frame>, _: Option<&mut Request>, _: i32, _: i32) -> i32 {
        self.decision
    }
}
struct NativeRequests { shared: Arc<Shared>, inner: Inner }
impl NativeRequests { /* PRODUCTION_BEFORE_BROWSE */ }

fn fixture() -> (NativeLoad, NativeRequests, Browser, Frame, Frame) {
    let shared = Arc::new(Shared {
        live: AtomicBool::new(true),
        automation: Mutex::new(AutomationState::default()),
        state: Mutex::new(State::default()),
    });
    let main = Frame { valid: 1, main: 1, id: "main".into() };
    let child = Frame { valid: 1, main: 0, id: "child".into() };
    (NativeLoad { shared: shared.clone() }, NativeRequests { shared, inner: Inner { decision: 0 } },
        Browser { id: 1, main: Some(main.clone()) }, main, child)
}
fn available(load: &NativeLoad) -> bool { load.shared.automation.lock().unwrap().available() }
fn generation(load: &NativeLoad) -> u64 { load.shared.automation.lock().unwrap().generation }

#[test]
fn child_navigation_and_loading_do_not_cancel_active_main_document_typing() {
    let (load, requests, mut browser, _, mut child) = fixture();
    let grant_generation = generation(&load);
    assert!(available(&load));
    assert_eq!(requests.on_before_browse(Some(&mut browser), Some(&mut child), None, 0, 0), 0);
    load.on_loading_state_change(Some(&mut browser), 1, 1, 0);
    assert!(available(&load), "browser-wide child loading must not cancel the next native key");
    assert_eq!(generation(&load), grant_generation);
    assert!(load.shared.state.lock().unwrap().page.loading);
    assert!(load.shared.state.lock().unwrap().page.can_go_back);
    load.on_load_end(Some(&mut browser), Some(&mut child), 200);
    load.on_loading_state_change(Some(&mut browser), 0, 0, 1);
    assert!(available(&load));
    assert_eq!(generation(&load), grant_generation);
    assert!(load.shared.state.lock().unwrap().page.can_go_forward);
}

#[test]
fn main_navigation_invalidates_old_grant_and_finishes_without_waiting_for_children() {
    let (load, requests, mut browser, mut main, mut child) = fixture();
    let old = generation(&load);
    assert_eq!(requests.on_before_browse(Some(&mut browser), Some(&mut main), None, 0, 0), 0);
    assert!(!available(&load));
    assert_ne!(generation(&load), old);
    load.on_loading_state_change(Some(&mut browser), 1, 0, 0);
    load.on_load_end(Some(&mut browser), Some(&mut child), 200);
    assert!(!available(&load), "child completion cannot release a main navigation");
    load.on_load_end(Some(&mut browser), Some(&mut main), 200);
    assert!(available(&load), "main completion must not wait for child resources");
    assert!(load.shared.state.lock().unwrap().page.loading);
    load.on_loading_state_change(Some(&mut browser), 1, 0, 0);
    assert!(available(&load));
    assert_ne!(generation(&load), old, "completion never restores the old grant generation");
}

#[test]
fn main_load_failure_stays_fenced_after_end_and_aggregate_stop() {
    let (load, requests, mut browser, mut main, _) = fixture();
    requests.on_before_browse(Some(&mut browser), Some(&mut main), None, 0, 0);
    load.on_load_error(Some(&mut browser), Some(&mut main), Errorcode(-130), None, None);
    load.on_load_end(Some(&mut browser), Some(&mut main), 0);
    load.on_loading_state_change(Some(&mut browser), 0, 0, 0);
    assert!(!available(&load));
    #[cfg(head_load_fault)]
    assert!(!load.shared.current(), "HEAD's main-load fault must still revoke the owner");
    #[cfg(not(head_load_fault))]
    {
        assert_eq!(load.shared.state.lock().unwrap().page.load_failure.unwrap().code, -130);
        requests.on_before_browse(Some(&mut browser), Some(&mut main), None, 0, 0);
        assert!(!available(&load));
        load.on_load_end(Some(&mut browser), Some(&mut main), 200);
        assert!(available(&load));
    }
}

#[test]
fn precommit_abort_can_finish_but_never_restore_old_grant() {
    let (load, requests, mut browser, mut main, _) = fixture();
    let old = generation(&load);
    requests.on_before_browse(Some(&mut browser), Some(&mut main), None, 0, 0);
    load.on_load_error(Some(&mut browser), Some(&mut main), Errorcode(-3), None, None);
    assert!(!available(&load));
    load.on_loading_state_change(Some(&mut browser), 0, 0, 0);
    assert!(available(&load));
    assert_ne!(generation(&load), old);
}

#[test]
fn foreign_invalid_missing_or_retired_main_callbacks_cannot_release_fence() {
    for case in 0..6 {
        let (load, requests, mut browser, mut main, _) = fixture();
        requests.on_before_browse(Some(&mut browser), Some(&mut main), None, 0, 0);
        match case {
            0 => main.valid = 0,
            1 => main.id = "retired-main".into(),
            2 => browser.id = 2,
            3 => { load.shared.live.store(false, Ordering::Release); }
            4 => browser.main = None,
            _ => {},
        }
        let frame = if case == 5 { None } else { Some(&mut main) };
        load.on_load_end(Some(&mut browser), frame, 200);
        assert!(!available(&load), "case {case}");
    }
}

#[test]
fn child_errors_do_not_fence_main_and_completion_cannot_clear_other_invalidations() {
    let (load, _, mut browser, mut main, mut child) = fixture();
    load.on_load_error(Some(&mut browser), Some(&mut child), Errorcode(-130), None, None);
    assert!(available(&load));
    load.shared.automation.lock().unwrap().invalidating = 1;
    load.on_load_end(Some(&mut browser), Some(&mut main), 200);
    load.on_loading_state_change(Some(&mut browser), 0, 0, 0);
    assert!(!available(&load));
    load.shared.automation.lock().unwrap().invalidating = 0;
    load.shared.automation.lock().unwrap().generation = u64::MAX;
    load.on_load_end(Some(&mut browser), Some(&mut main), 200);
    assert!(!available(&load));
}

#[cfg(not(head_load_fault))]
#[test]
fn recoverable_error_keeps_history_and_only_allowed_main_navigation_clears_evidence() {
    let (load, mut requests, mut browser, mut main, mut child) = fixture();
    let old = generation(&load);
    load.on_loading_state_change(Some(&mut browser), 1, 1, 1);
    load.on_load_error(Some(&mut browser), Some(&mut main), Errorcode(-130), None, None);
    assert!(load.shared.current(), "a document request failure is not owner revocation");
    assert!(!available(&load));
    assert_ne!(generation(&load), old);
    {
        let state = load.shared.state.lock().unwrap();
        assert!(!state.page.loading);
        assert!(state.page.can_go_back && state.page.can_go_forward);
        assert_eq!(state.page.load_failure.unwrap().code, -130);
    }
    requests.on_before_browse(Some(&mut browser), Some(&mut child), None, 0, 0);
    load.on_load_error(Some(&mut browser), Some(&mut child), Errorcode(-105), None, None);
    load.on_load_error(Some(&mut browser), Some(&mut main), Errorcode(-3), None, None);
    load.on_load_end(Some(&mut browser), Some(&mut child), 200);
    assert_eq!(load.shared.state.lock().unwrap().page.load_failure.unwrap().code, -130);
    assert!(!available(&load));
    requests.inner.decision = 1;
    assert_eq!(requests.on_before_browse(Some(&mut browser), Some(&mut main), None, 0, 0), 1);
    assert_eq!(load.shared.state.lock().unwrap().page.load_failure.unwrap().code, -130);
    requests.inner.decision = 0;
    assert_eq!(requests.on_before_browse(Some(&mut browser), Some(&mut main), None, 0, 0), 0);
    assert!(load.shared.state.lock().unwrap().page.load_failure.is_none());
    assert!(!available(&load), "a new request is not yet a completed document");
    load.on_load_end(Some(&mut browser), Some(&mut main), 200);
    assert!(available(&load));
    assert!(load.shared.current());
    assert_ne!(generation(&load), old);
}

#[cfg(not(head_load_fault))]
#[test]
fn foreign_or_revoked_load_errors_cannot_replace_evidence_or_invalidate_typing_again() {
    for revoked in [false, true] {
        let (load, _, mut browser, mut main, _) = fixture();
        load.on_load_error(Some(&mut browser), Some(&mut main), Errorcode(-105), None, None);
        let previous = generation(&load);
        if revoked {
            load.shared.live.store(false, Ordering::Release);
        } else {
            browser.id = 2;
        }
        load.on_load_error(Some(&mut browser), Some(&mut main), Errorcode(-130), None, None);
        assert_eq!(load.shared.state.lock().unwrap().page.load_failure.unwrap().code, -105);
        assert_eq!(generation(&load), previous);
    }
}
