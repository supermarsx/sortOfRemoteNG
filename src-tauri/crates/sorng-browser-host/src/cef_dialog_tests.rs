//! Exercise the real CEF handler through library-owned vtables. No native
//! windows, renderer, browser profile or website navigation is started here.
use super::tests::{fixture, focus_browser};
use super::*;

struct Sink;
impl BrowserEventSink for Sink {
    fn on_event(&self, _: BrowserEvent) {}
}

type Answers = Arc<Mutex<Vec<(i32, bool)>>>;

fn completion(answers: Answers) -> JsdialogCallback {
    use cef::rc::{ConvertReturnValue, RcImpl};
    use cef::sys::{_cef_jsdialog_callback_t, cef_string_t};

    extern "C" fn cont(
        this: *mut _cef_jsdialog_callback_t,
        success: i32,
        input: *const cef_string_t,
    ) {
        RcImpl::<_cef_jsdialog_callback_t, Answers>::get(this)
            .interface
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push((success, input.is_null()));
    }
    let raw = _cef_jsdialog_callback_t {
        cont: Some(cont),
        // RcImpl installs reference counting before converting the vtable.
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_jsdialog_callback_t = RcImpl::new(raw, answers).cast();
    raw.wrap_result()
}

async fn owner() -> Arc<Shared> {
    let shared = Arc::new(fixture(Arc::new(Sink)).await);
    shared.state.lock().unwrap().browser_id = Some(41);
    shared
}

#[tokio::test]
async fn saved_opt_in_delegates_alert_confirm_and_prompt_without_answering() {
    let shared = owner().await;
    let mut browser = focus_browser(1, 41);
    let handler = NativeJsDialog::new(shared.clone());
    let answers = Answers::default();
    let mut callback = completion(answers.clone());
    assert!(!shared.allow_page_dialogs.load(Ordering::Acquire));

    for allowed in [false, true, false] {
        shared.allow_page_dialogs.store(allowed, Ordering::Release);
        for kind in [
            JsdialogType::ALERT,
            JsdialogType::CONFIRM,
            JsdialogType::PROMPT,
        ] {
            let mut suppress = 7;
            assert_eq!(
                handler.on_jsdialog(
                    Some(&mut browser),
                    None,
                    kind,
                    None,
                    None,
                    Some(&mut callback),
                    Some(&mut suppress),
                ),
                0
            );
            assert_eq!(suppress, i32::from(!allowed));
            // CEF owns the response, including cancellation and prompt text.
            assert!(answers.lock().unwrap().is_empty());
        }
    }
    shared.revoke();
}

#[tokio::test]
async fn protected_hidden_closing_closed_faulted_and_revoked_views_suppress_dialogs() {
    for reason in [
        "protected",
        "hidden",
        "closing",
        "closed",
        "faulted",
        "revoked",
        "poisoned",
    ] {
        let shared = owner().await;
        let mut browser = focus_browser(1, 41);
        shared.allow_page_dialogs.store(true, Ordering::Release);
        match reason {
            "protected" => shared.input_blocked.store(true, Ordering::Release),
            "hidden" => shared
                .state
                .lock()
                .unwrap()
                .control
                .hide(&shared.identity)
                .unwrap(),
            "closing" | "closed" => {
                shared
                    .state
                    .lock()
                    .unwrap()
                    .control
                    .begin_close(&shared.identity)
                    .unwrap();
                if reason == "closed" {
                    shared
                        .state
                        .lock()
                        .unwrap()
                        .control
                        .closed(&shared.identity)
                        .unwrap();
                }
            }
            "faulted" => {
                shared
                    .state
                    .lock()
                    .unwrap()
                    .control
                    .fault(&shared.identity)
                    .unwrap();
            }
            "revoked" => shared.revoke(),
            "poisoned" => {
                let _ = catch_unwind(AssertUnwindSafe(|| {
                    let _guard = shared.session.lock().unwrap();
                    panic!("poison dialog fixture");
                }));
            }
            _ => unreachable!(),
        }
        let handler = NativeJsDialog::new(shared.clone());
        let answers = Answers::default();
        let mut callback = completion(answers.clone());
        let mut suppress = 0;
        assert_eq!(
            handler.on_jsdialog(
                Some(&mut browser),
                None,
                JsdialogType::CONFIRM,
                None,
                None,
                Some(&mut callback),
                Some(&mut suppress),
            ),
            0,
            "{reason}"
        );
        assert_eq!(suppress, 1, "{reason}");
        assert!(answers.lock().unwrap().is_empty(), "{reason}");
        assert_eq!(
            handler.on_before_unload_dialog(Some(&mut browser), None, 0, Some(&mut callback),),
            1,
            "{reason}"
        );
        assert_eq!(*answers.lock().unwrap(), [(1, true)], "{reason}");
        shared.revoke();
    }
}

#[tokio::test]
async fn missing_invalid_and_foreign_browsers_cannot_present_dialogs() {
    let shared = owner().await;
    shared.allow_page_dialogs.store(true, Ordering::Release);
    let handler = NativeJsDialog::new(shared.clone());
    let mut invalid = focus_browser(0, 41);
    let mut foreign = focus_browser(1, 42);
    for browser in [None, Some(&mut invalid), Some(&mut foreign)] {
        let mut suppress = 0;
        assert_eq!(
            handler.on_jsdialog(
                browser,
                None,
                JsdialogType::PROMPT,
                None,
                None,
                None,
                Some(&mut suppress),
            ),
            0
        );
        assert_eq!(suppress, 1);
    }
    shared.revoke();
}

#[tokio::test]
async fn before_unload_waits_for_user_only_on_an_allowed_live_view() {
    let shared = owner().await;
    let mut browser = focus_browser(1, 41);
    let handler = NativeJsDialog::new(shared.clone());
    let answers = Answers::default();
    let mut callback = completion(answers.clone());
    for allowed in [false, true] {
        shared.allow_page_dialogs.store(allowed, Ordering::Release);
        for reload in [0, 1] {
            answers.lock().unwrap().clear();
            assert_eq!(
                handler.on_before_unload_dialog(
                    Some(&mut browser),
                    None,
                    reload,
                    Some(&mut callback),
                ),
                i32::from(!allowed)
            );
            let expected = if allowed { vec![] } else { vec![(1, true)] };
            assert_eq!(*answers.lock().unwrap(), expected);
        }
    }
    // The real close path revokes before issuing CloseBrowser(true).
    shared.revoke();
    answers.lock().unwrap().clear();
    assert_eq!(
        handler.on_before_unload_dialog(Some(&mut browser), None, 0, Some(&mut callback),),
        1
    );
    assert_eq!(*answers.lock().unwrap(), [(1, true)]);
    assert_eq!(handler.on_before_unload_dialog(None, None, 0, None), 1);
}

#[tokio::test]
async fn absent_suppression_output_cancels_without_accepting_confirm_or_prompt() {
    let shared = owner().await;
    let mut browser = focus_browser(1, 41);
    let handler = NativeJsDialog::new(shared.clone());
    let answers = Answers::default();
    let mut callback = completion(answers.clone());
    for kind in [JsdialogType::CONFIRM, JsdialogType::PROMPT] {
        answers.lock().unwrap().clear();
        assert_eq!(
            handler.on_jsdialog(
                Some(&mut browser),
                None,
                kind,
                None,
                None,
                Some(&mut callback),
                None,
            ),
            1
        );
        assert_eq!(*answers.lock().unwrap(), [(0, true)]);
    }
    assert_eq!(
        handler.on_jsdialog(None, None, JsdialogType::ALERT, None, None, None, None),
        1
    );
    shared.revoke();
}
