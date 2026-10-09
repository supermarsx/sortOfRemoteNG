//! Real handler callbacks on library-owned CEF vtables. No native window,
//! clipboard operation, profile or network traffic is created by these tests.
use super::super::tests::{fixture, focus_browser};
use super::*;
use cef::rc::{ConvertParam, ConvertReturnValue, RcImpl};
use cef::sys::*;

struct Sink;
impl BrowserEventSink for Sink {
    fn on_event(&self, _: BrowserEvent) {}
}

fn document() -> Document {
    Document {
        browser: 41,
        generation: 0,
        frame: "fixture-frame".into(),
        url: "https://fixture.invalid/".into(),
    }
}

#[test]
fn allowlist_uses_custom_ids_and_never_exposes_raw_network_commands() {
    let state = MenuState {
        editable: true,
        edit_flags: 127,
        ..Default::default()
    };
    let receipt = Receipt {
        document: document(),
        rows: state.rows(),
    };
    for action in Action::ALL {
        assert!(
            (MenuId::USER_FIRST.get_raw()..=MenuId::USER_LAST.get_raw()).contains(&(action as i32))
        );
    }
    for id in [-1, 0, 100, 110, 130, 131, 200, 26512, 28500, i32::MAX] {
        assert_eq!(receipt.resolve(&document(), state, id), None);
    }
    assert_eq!(Action::ALL.len(), 12);
}

#[test]
fn editable_readonly_selection_password_flags_and_loading_are_respected() {
    let readonly = MenuState {
        edit_flags: 127,
        ..Default::default()
    };
    for action in [
        Action::Undo,
        Action::Redo,
        Action::Cut,
        Action::Paste,
        Action::Delete,
    ] {
        assert!(!readonly.visible(action));
        assert!(!readonly.enabled(action));
    }
    assert!(readonly.enabled(Action::Copy));
    let password = MenuState {
        editable: true,
        edit_flags: 16,
        ..Default::default()
    };
    assert!(password.enabled(Action::Paste));
    assert!(!password.enabled(Action::Copy));
    assert!(!password.enabled(Action::Cut));
    assert!(!password.enabled(Action::Stop));
    assert!(MenuState {
        loading: true,
        ..password
    }
    .enabled(Action::Stop));
    assert!(password.enabled(Action::DevTools));
    assert!(!password.enabled(Action::Back));
    assert!(!password.enabled(Action::Forward));
}

#[test]
fn receipts_recheck_document_and_permissions_at_command_time() {
    let state = MenuState {
        editable: true,
        edit_flags: 127,
        ..Default::default()
    };
    let receipt = Receipt {
        document: document(),
        rows: state.rows(),
    };
    assert_eq!(
        receipt.resolve(&document(), state, Action::Paste as i32),
        Some(Action::Paste)
    );
    for changed in [
        Document {
            browser: 42,
            ..document()
        },
        Document {
            generation: 1,
            ..document()
        },
        Document {
            frame: "other-frame".into(),
            ..document()
        },
        Document {
            url: "https://fixture.invalid/other".into(),
            ..document()
        },
    ] {
        assert_eq!(receipt.resolve(&changed, state, Action::Paste as i32), None);
    }
    assert_eq!(
        receipt.resolve(&document(), MenuState::default(), Action::Paste as i32),
        None
    );
    assert_eq!(
        receipt.resolve(
            &document(),
            MenuState {
                back: true,
                ..state
            },
            Action::Back as i32
        ),
        None
    );
}

#[test]
fn edit_bit_mapping_matches_pinned_cef() {
    for (action, bit) in [
        (
            Action::Undo,
            cef_context_menu_edit_state_flags_t::CM_EDITFLAG_CAN_UNDO,
        ),
        (
            Action::Redo,
            cef_context_menu_edit_state_flags_t::CM_EDITFLAG_CAN_REDO,
        ),
        (
            Action::Cut,
            cef_context_menu_edit_state_flags_t::CM_EDITFLAG_CAN_CUT,
        ),
        (
            Action::Copy,
            cef_context_menu_edit_state_flags_t::CM_EDITFLAG_CAN_COPY,
        ),
        (
            Action::Paste,
            cef_context_menu_edit_state_flags_t::CM_EDITFLAG_CAN_PASTE,
        ),
        (
            Action::Delete,
            cef_context_menu_edit_state_flags_t::CM_EDITFLAG_CAN_DELETE,
        ),
        (
            Action::SelectAll,
            cef_context_menu_edit_state_flags_t::CM_EDITFLAG_CAN_SELECT_ALL,
        ),
    ] {
        assert_eq!(action.edit_bit(), bit.0 as u32);
    }
}

type Rows = Arc<Mutex<Vec<(i32, bool)>>>;
fn model(rows: Rows) -> MenuModel {
    extern "C" fn clear(this: *mut _cef_menu_model_t) -> i32 {
        RcImpl::<_cef_menu_model_t, Rows>::get(this)
            .interface
            .lock()
            .unwrap()
            .clear();
        1
    }
    extern "C" fn count(this: *mut _cef_menu_model_t) -> usize {
        RcImpl::<_cef_menu_model_t, Rows>::get(this)
            .interface
            .lock()
            .unwrap()
            .len()
    }
    extern "C" fn add(this: *mut _cef_menu_model_t, id: i32, _: *const cef_string_t) -> i32 {
        RcImpl::<_cef_menu_model_t, Rows>::get(this)
            .interface
            .lock()
            .unwrap()
            .push((id, true));
        1
    }
    extern "C" fn separator(_: *mut _cef_menu_model_t) -> i32 {
        1
    }
    extern "C" fn enabled(this: *mut _cef_menu_model_t, id: i32, enabled: i32) -> i32 {
        let mut rows = RcImpl::<_cef_menu_model_t, Rows>::get(this)
            .interface
            .lock()
            .unwrap();
        let Some(row) = rows.iter_mut().find(|row| row.0 == id) else {
            return 0;
        };
        row.1 = enabled == 1;
        1
    }
    let raw = _cef_menu_model_t {
        clear: Some(clear),
        get_count: Some(count),
        add_item: Some(add),
        add_separator: Some(separator),
        set_enabled: Some(enabled),
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_menu_model_t = RcImpl::new(raw, rows).cast();
    raw.wrap_result()
}

fn params(editable: i32, flags: i32) -> ContextMenuParams {
    extern "C" fn edit(this: *mut _cef_context_menu_params_t) -> i32 {
        RcImpl::<_cef_context_menu_params_t, (i32, i32)>::get(this)
            .interface
            .0
    }
    extern "C" fn get_flags(
        this: *mut _cef_context_menu_params_t,
    ) -> cef_context_menu_edit_state_flags_t {
        cef_context_menu_edit_state_flags_t(
            RcImpl::<_cef_context_menu_params_t, (i32, i32)>::get(this)
                .interface
                .1,
        )
    }
    let raw = _cef_context_menu_params_t {
        is_editable: Some(edit),
        get_edit_state_flags: Some(get_flags),
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_context_menu_params_t = RcImpl::new(raw, (editable, flags)).cast();
    raw.wrap_result()
}

fn string(value: &str) -> cef_string_userfree_t {
    let value: Vec<_> = value.encode_utf16().collect();
    // CEF owns and releases both the userfree structure and copied UTF-16 data.
    unsafe {
        let out = cef_string_userfree_utf16_alloc();
        assert!(!out.is_null());
        assert_eq!(cef_string_utf16_set(value.as_ptr(), value.len(), out, 1), 1);
        out
    }
}

struct FrameData {
    browser: Browser,
    focused: bool,
    calls: Arc<AtomicU64>,
}
fn frame(browser: Browser, calls: Arc<AtomicU64>, focused: bool) -> Frame {
    extern "C" fn valid(_: *mut _cef_frame_t) -> i32 {
        1
    }
    extern "C" fn get_focused(this: *mut _cef_frame_t) -> i32 {
        i32::from(
            RcImpl::<_cef_frame_t, FrameData>::get(this)
                .interface
                .focused,
        )
    }
    extern "C" fn get_browser(this: *mut _cef_frame_t) -> *mut _cef_browser_t {
        RcImpl::<_cef_frame_t, FrameData>::get(this)
            .interface
            .browser
            .clone()
            .into_raw()
    }
    extern "C" fn id(_: *mut _cef_frame_t) -> cef_string_userfree_t {
        string("fixture-frame")
    }
    extern "C" fn url(_: *mut _cef_frame_t) -> cef_string_userfree_t {
        string("https://fixture.invalid/")
    }
    extern "C" fn paste(this: *mut _cef_frame_t) {
        RcImpl::<_cef_frame_t, FrameData>::get(this)
            .interface
            .calls
            .fetch_add(1, Ordering::Relaxed);
    }
    let raw = _cef_frame_t {
        is_valid: Some(valid),
        is_focused: Some(get_focused),
        get_browser: Some(get_browser),
        get_identifier: Some(id),
        get_url: Some(url),
        paste: Some(paste),
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_frame_t = RcImpl::new(
        raw,
        FrameData {
            browser,
            calls,
            focused,
        },
    )
    .cast();
    raw.wrap_result()
}

fn callback(cancelled: Arc<AtomicU64>) -> RunContextMenuCallback {
    extern "C" fn cancel(this: *mut _cef_run_context_menu_callback_t) {
        RcImpl::<_cef_run_context_menu_callback_t, Arc<AtomicU64>>::get(this)
            .interface
            .fetch_add(1, Ordering::Relaxed);
    }
    let raw = _cef_run_context_menu_callback_t {
        cancel: Some(cancel),
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_run_context_menu_callback_t = RcImpl::new(raw, cancelled).cast();
    raw.wrap_result()
}

async fn owner() -> Arc<Shared> {
    let shared = Arc::new(fixture(Arc::new(Sink)).await);
    shared.state.lock().unwrap().browser_id = Some(41);
    shared
}

#[tokio::test]
async fn native_menu_replaces_defaults_displays_and_dispatches_edit_once_across_wrappers() {
    let shared = owner().await;
    let mut browser = focus_browser(1, 41);
    let slot = Arc::new(Mutex::new(Some(browser.clone())));
    let calls = Arc::new(AtomicU64::new(0));
    let mut frame = frame(browser.clone(), calls.clone(), true);
    let mut params = params(1, 127);
    let rows: Rows = Arc::new(Mutex::new(vec![(130, true)]));
    let mut model = model(rows.clone());
    let cancelled = Arc::new(AtomicU64::new(0));
    let mut callback = callback(cancelled.clone());
    handler(shared.clone(), slot.clone(), DownloadAttachment::default()).on_before_context_menu(
        Some(&mut browser),
        Some(&mut frame),
        Some(&mut params),
        Some(&mut model),
    );
    assert_eq!(rows.lock().unwrap().len(), 12);
    assert!(!rows.lock().unwrap().iter().any(|row| row.0 == 130));
    let menu = handler(shared.clone(), slot, DownloadAttachment::default());
    assert_eq!(
        menu.run_context_menu(
            Some(&mut browser),
            Some(&mut frame),
            Some(&mut params),
            Some(&mut model),
            Some(&mut callback)
        ),
        0
    );
    assert_eq!(cancelled.load(Ordering::Relaxed), 0);
    for _ in 0..2 {
        assert_eq!(
            menu.on_context_menu_command(
                Some(&mut browser),
                Some(&mut frame),
                Some(&mut params),
                Action::Paste as i32,
                EventFlags::default()
            ),
            1
        );
    }
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    assert!(shared.current());
    shared.revoke();
}

#[tokio::test]
async fn stale_hidden_blocked_revoked_foreign_dismissed_and_unknown_commands_are_consumed() {
    for reason in [
        "generation",
        "hidden",
        "blocked",
        "revoked",
        "foreign",
        "foreign-frame",
        "closing",
        "unfocused",
        "dismissed",
        "unknown",
        "flags",
    ] {
        let shared = owner().await;
        let mut browser = focus_browser(1, 41);
        let calls = Arc::new(AtomicU64::new(0));
        let mut frame = frame(browser.clone(), calls.clone(), true);
        let mut params = params(1, 127);
        let mut model = model(Rows::default());
        let menu = handler(
            shared.clone(),
            Arc::new(Mutex::new(Some(browser.clone()))),
            DownloadAttachment::default(),
        );
        menu.on_before_context_menu(
            Some(&mut browser),
            Some(&mut frame),
            Some(&mut params),
            Some(&mut model),
        );
        match reason {
            "generation" => shared.automation.lock().unwrap().generation += 1,
            "hidden" => shared
                .state
                .lock()
                .unwrap()
                .control
                .hide(&shared.identity)
                .unwrap(),
            "blocked" => shared.input_blocked.store(true, Ordering::Release),
            "revoked" => shared.revoke(),
            "foreign" => browser = focus_browser(1, 42),
            "foreign-frame" => frame = self::frame(focus_browser(1, 42), calls.clone(), true),
            "closing" => {
                shared
                    .state
                    .lock()
                    .unwrap()
                    .control
                    .begin_close(&shared.identity)
                    .unwrap();
            }
            "unfocused" => frame = self::frame(browser.clone(), calls.clone(), false),
            "dismissed" => menu.on_context_menu_dismissed(Some(&mut browser), Some(&mut frame)),
            "flags" => params = self::params(0, 0),
            _ => {}
        }
        let id = if reason == "unknown" {
            130
        } else {
            Action::Paste as i32
        };
        assert_eq!(
            menu.on_context_menu_command(
                Some(&mut browser),
                Some(&mut frame),
                Some(&mut params),
                id,
                EventFlags::default()
            ),
            1
        );
        assert_eq!(calls.load(Ordering::Relaxed), 0, "{reason}");
        shared.revoke();
    }
}

#[tokio::test]
async fn missing_or_protected_owner_cancels_native_display_without_default_actions() {
    let shared = owner().await;
    let mut browser = focus_browser(1, 41);
    let menu = handler(
        shared.clone(),
        Arc::new(Mutex::new(Some(browser.clone()))),
        DownloadAttachment::default(),
    );
    let mut model = model(Rows::default());
    let cancelled = Arc::new(AtomicU64::new(0));
    let mut callback = callback(cancelled.clone());
    for blocked in [false, true] {
        shared.input_blocked.store(blocked, Ordering::Release);
        assert_eq!(
            menu.run_context_menu(
                Some(&mut browser),
                None,
                None,
                Some(&mut model),
                Some(&mut callback)
            ),
            1
        );
    }
    assert_eq!(cancelled.load(Ordering::Relaxed), 2);
    shared.revoke();
}
