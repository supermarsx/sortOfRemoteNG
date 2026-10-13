//! Real handler callbacks on library-owned CEF vtables. No native window,
//! clipboard operation, profile or network traffic is created by these tests.
use super::super::tests::{fixture, focus_browser};
use super::policy::copyable;
use super::*;
use cef::rc::{ConvertParam, ConvertReturnValue, RcImpl};
use cef::sys::*;

struct Sink;
impl BrowserEventSink for Sink {
    fn on_event(&self, _: BrowserEvent) {}
}

// Wire ids. The acceptance client records rows by these numbers, and the
// first twelve predate the link/media/print/inspect rows: never renumber.
const BACK: i32 = 26500;
const FORWARD: i32 = 26501;
const RELOAD: i32 = 26502;
const STOP: i32 = 26503;
const UNDO: i32 = 26504;
const REDO: i32 = 26505;
const CUT: i32 = 26506;
const COPY: i32 = 26507;
const PASTE: i32 = 26508;
const DELETE: i32 = 26509;
const SELECT_ALL: i32 = 26510;
const DEVTOOLS: i32 = 26511;
const OPEN_LINK: i32 = 26512;
const COPY_LINK: i32 = 26513;
const OPEN_IMAGE: i32 = 26514;
const COPY_IMAGE_ADDRESS: i32 = 26515;
const OPEN_VIDEO: i32 = 26516;
const COPY_VIDEO_ADDRESS: i32 = 26517;
const OPEN_AUDIO: i32 = 26518;
const COPY_AUDIO_ADDRESS: i32 = 26519;
const PASTE_PLAIN: i32 = 26520;
const PRINT: i32 = 26521;
const INSPECT: i32 = 26522;
/// How the mock model records `add_separator`. Never a command id.
const SEPARATOR: i32 = -1;

/// Windows and macOS have a clipboard text writer; Linux has none yet.
const WRITER: bool = cfg!(any(target_os = "windows", target_os = "macos"));

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
        target: Target::default(),
    };
    // MenuId::get_raw() is i32 on Windows and u32 on macOS and Linux.
    let user = i64::from(MenuId::USER_FIRST.get_raw())..=i64::from(MenuId::USER_LAST.get_raw());
    for action in Action::ALL {
        assert!(user.contains(&i64::from(action as i32)));
    }
    for id in [
        -1,
        0,
        100,
        110,
        130,
        131,
        200,
        26499,
        26523,
        28500,
        i32::MAX,
    ] {
        assert_eq!(
            receipt.resolve(&document(), state, &Target::default(), id),
            None
        );
    }
    assert_eq!(Action::ALL.len(), 23);
}

#[test]
fn wire_ids_and_labels_are_fixed() {
    let pinned = [
        (Action::Back, BACK, "Back"),
        (Action::Forward, FORWARD, "Forward"),
        (Action::Reload, RELOAD, "Reload"),
        (Action::Stop, STOP, "Stop loading"),
        (Action::Undo, UNDO, "Undo"),
        (Action::Redo, REDO, "Redo"),
        (Action::Cut, CUT, "Cut"),
        (Action::Copy, COPY, "Copy"),
        (Action::Paste, PASTE, "Paste"),
        (Action::Delete, DELETE, "Delete"),
        (Action::SelectAll, SELECT_ALL, "Select all"),
        (Action::DevTools, DEVTOOLS, "Developer tools"),
        (Action::OpenLink, OPEN_LINK, "Open link in new tab"),
        (Action::CopyLinkAddress, COPY_LINK, "Copy link address"),
        (Action::OpenImage, OPEN_IMAGE, "Open image in new tab"),
        (
            Action::CopyImageAddress,
            COPY_IMAGE_ADDRESS,
            "Copy image address",
        ),
        (Action::OpenVideo, OPEN_VIDEO, "Open video in new tab"),
        (
            Action::CopyVideoAddress,
            COPY_VIDEO_ADDRESS,
            "Copy video address",
        ),
        (Action::OpenAudio, OPEN_AUDIO, "Open audio in new tab"),
        (
            Action::CopyAudioAddress,
            COPY_AUDIO_ADDRESS,
            "Copy audio address",
        ),
        (Action::PasteAsPlainText, PASTE_PLAIN, "Paste as plain text"),
        (Action::Print, PRINT, "Print"),
        (Action::Inspect, INSPECT, "Inspect"),
    ];
    assert_eq!(pinned.len(), Action::ALL.len());
    for (index, (action, id, label)) in pinned.into_iter().enumerate() {
        assert_eq!(action as i32, id);
        assert_eq!(action.label(), label);
        assert_eq!(id, BACK + index as i32, "ids are contiguous");
        assert_eq!(
            Action::ALL
                .iter()
                .filter(|listed| **listed == action)
                .count(),
            1
        );
    }
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
        target: Target::default(),
    };
    let target = Target::default();
    assert_eq!(
        receipt.resolve(&document(), state, &target, Action::Paste as i32),
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
        assert_eq!(
            receipt.resolve(&changed, state, &target, Action::Paste as i32),
            None
        );
    }
    assert_eq!(
        receipt.resolve(
            &document(),
            MenuState::default(),
            &target,
            Action::Paste as i32
        ),
        None
    );
    assert_eq!(
        receipt.resolve(
            &document(),
            MenuState {
                back: true,
                ..state
            },
            &target,
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
            Action::PasteAsPlainText,
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
        // The newtype's field is c_int on Windows and c_uint on macOS and
        // Linux; i64 holds either without a cast.
        assert_eq!(i64::from(action.edit_bit()), i64::from(bit.0));
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
    extern "C" fn separator(this: *mut _cef_menu_model_t) -> i32 {
        RcImpl::<_cef_menu_model_t, Rows>::get(this)
            .interface
            .lock()
            .unwrap()
            .push((SEPARATOR, false));
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

/// Everything the model holds, separators included.
fn snapshot(rows: &Rows) -> Vec<(i32, bool)> {
    rows.lock().unwrap().clone()
}

/// The command rows the model holds, without separators.
fn items(rows: &Rows) -> Vec<(i32, bool)> {
    let rows = rows.lock().unwrap();
    rows.iter()
        .copied()
        .filter(|row| row.0 != SEPARATOR)
        .collect()
}

/// What a real engine was seen to report. Windows 11, CEF 154.3.0 (crate
/// cef 154.3.0+154.0.32), 2026-10-12, three launches of the acceptance
/// client with the context-menu probe. Edit-state flags: the engine sets
/// "select all" (64) and "translate" (128) on every target, so a plain
/// page is 192, not 0.
mod engine {
    /// Plain page, link, image, video, audio: select all, translate.
    pub const PLAIN: u16 = 192;
    /// Selected page text: adds copy.
    pub const SELECTED_TEXT: u16 = 200;
    /// Text input with a value and a caret: paste, select all, translate.
    pub const INPUT: u16 = 208;
    /// Text input, everything selected: adds cut, copy, delete.
    pub const INPUT_ALL_SELECTED: u16 = 252;
    /// A contenteditable with a caret: `INPUT` plus "edit richly" (256).
    pub const RICH_TEXT: u16 = 464;
    /// Password field, empty: paste, translate.
    pub const PASSWORD_EMPTY: u16 = 144;
    /// Password field, filled, caret: adds select all.
    pub const PASSWORD_FILLED: u16 = 208;
    /// Password field, everything selected: adds undo and delete. Never
    /// cut or copy.
    pub const PASSWORD_ALL_SELECTED: u16 = 241;
    /// A `javascript:void(0)` link: the validated address is this
    /// placeholder, the unfiltered one is the original.
    pub const BLOCKED_LINK: &str = "about:blank#blocked";
    pub const SCRIPT_LINK: &str = "javascript:void(0)";
}

/// What the engine reports for one right-click.
#[derive(Clone, Copy)]
struct Click {
    editable: i32,
    flags: u16,
    /// The link as the browser process validated it.
    link: &'static str,
    /// The unfiltered link. `None` repeats `link`: the engine reports the
    /// same resolved, escaped address for both, except for a link it blocks.
    unfiltered: Option<&'static str>,
    source: &'static str,
    media: cef_context_menu_media_type_t,
    point: (i32, i32),
}
impl Default for Click {
    fn default() -> Self {
        Self {
            editable: 0,
            flags: engine::PLAIN,
            link: "",
            unfiltered: None,
            source: "",
            media: cef_context_menu_media_type_t::CM_MEDIATYPE_NONE,
            point: (12, 34),
        }
    }
}

fn params(editable: i32, flags: u16) -> ContextMenuParams {
    click(Click {
        editable,
        flags,
        ..Default::default()
    })
}

fn click(click: Click) -> ContextMenuParams {
    type Data = RcImpl<_cef_context_menu_params_t, Click>;
    extern "C" fn edit(this: *mut _cef_context_menu_params_t) -> i32 {
        Data::get(this).interface.editable
    }
    extern "C" fn get_flags(
        this: *mut _cef_context_menu_params_t,
    ) -> cef_context_menu_edit_state_flags_t {
        // The newtype wraps c_int on Windows and c_uint on macOS and Linux;
        // u16 converts losslessly into either.
        cef_context_menu_edit_state_flags_t(Data::get(this).interface.flags.into())
    }
    extern "C" fn link(this: *mut _cef_context_menu_params_t) -> cef_string_userfree_t {
        address(Data::get(this).interface.link)
    }
    extern "C" fn unfiltered(this: *mut _cef_context_menu_params_t) -> cef_string_userfree_t {
        let click = &Data::get(this).interface;
        address(click.unfiltered.unwrap_or(click.link))
    }
    extern "C" fn source(this: *mut _cef_context_menu_params_t) -> cef_string_userfree_t {
        address(Data::get(this).interface.source)
    }
    extern "C" fn media(this: *mut _cef_context_menu_params_t) -> cef_context_menu_media_type_t {
        Data::get(this).interface.media
    }
    extern "C" fn x(this: *mut _cef_context_menu_params_t) -> i32 {
        Data::get(this).interface.point.0
    }
    extern "C" fn y(this: *mut _cef_context_menu_params_t) -> i32 {
        Data::get(this).interface.point.1
    }
    let raw = _cef_context_menu_params_t {
        is_editable: Some(edit),
        get_edit_state_flags: Some(get_flags),
        get_link_url: Some(link),
        get_unfiltered_link_url: Some(unfiltered),
        get_source_url: Some(source),
        get_media_type: Some(media),
        get_xcoord: Some(x),
        get_ycoord: Some(y),
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_context_menu_params_t = RcImpl::new(raw, click).cast();
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

/// CEF detaches an empty CefString as a null userfree pointer.
fn address(value: &str) -> cef_string_userfree_t {
    if value.is_empty() {
        std::ptr::null_mut()
    } else {
        string(value)
    }
}

type Ops = Arc<Mutex<Vec<&'static str>>>;
struct FrameData {
    browser: Browser,
    focused: bool,
    calls: Arc<AtomicU64>,
    ops: Ops,
}
fn frame(browser: Browser, calls: Arc<AtomicU64>, focused: bool) -> Frame {
    frame_with(browser, calls, Ops::default(), focused)
}
/// `ops` names every edit command the frame executed, in order; `calls`
/// counts Paste alone.
fn frame_with(browser: Browser, calls: Arc<AtomicU64>, ops: Ops, focused: bool) -> Frame {
    type Data = RcImpl<_cef_frame_t, FrameData>;
    fn op(this: *mut _cef_frame_t, name: &'static str) {
        Data::get(this).interface.ops.lock().unwrap().push(name);
    }
    extern "C" fn valid(_: *mut _cef_frame_t) -> i32 {
        1
    }
    extern "C" fn get_focused(this: *mut _cef_frame_t) -> i32 {
        i32::from(Data::get(this).interface.focused)
    }
    extern "C" fn get_browser(this: *mut _cef_frame_t) -> *mut _cef_browser_t {
        Data::get(this).interface.browser.clone().into_raw()
    }
    extern "C" fn id(_: *mut _cef_frame_t) -> cef_string_userfree_t {
        string("fixture-frame")
    }
    extern "C" fn url(_: *mut _cef_frame_t) -> cef_string_userfree_t {
        string("https://fixture.invalid/")
    }
    extern "C" fn undo(this: *mut _cef_frame_t) {
        op(this, "undo");
    }
    extern "C" fn redo(this: *mut _cef_frame_t) {
        op(this, "redo");
    }
    extern "C" fn cut(this: *mut _cef_frame_t) {
        op(this, "cut");
    }
    extern "C" fn copy(this: *mut _cef_frame_t) {
        op(this, "copy");
    }
    extern "C" fn paste(this: *mut _cef_frame_t) {
        Data::get(this)
            .interface
            .calls
            .fetch_add(1, Ordering::Relaxed);
        op(this, "paste");
    }
    extern "C" fn paste_plain(this: *mut _cef_frame_t) {
        op(this, "paste_and_match_style");
    }
    extern "C" fn del(this: *mut _cef_frame_t) {
        op(this, "del");
    }
    extern "C" fn select_all(this: *mut _cef_frame_t) {
        op(this, "select_all");
    }
    let raw = _cef_frame_t {
        is_valid: Some(valid),
        is_focused: Some(get_focused),
        get_browser: Some(get_browser),
        get_identifier: Some(id),
        get_url: Some(url),
        undo: Some(undo),
        redo: Some(redo),
        cut: Some(cut),
        copy: Some(copy),
        paste: Some(paste),
        paste_and_match_style: Some(paste_plain),
        del: Some(del),
        select_all: Some(select_all),
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_frame_t = RcImpl::new(
        raw,
        FrameData {
            browser,
            calls,
            ops,
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

/// An attempt that may navigate inside its own origin, as on a loaded page.
/// Pure admission fixture: nothing dials and nothing is evidence of readiness.
async fn navigable_owner() -> Arc<Shared> {
    use crate::domain_permissions::{WebsitePermissionDecision, WebsiteRequestClass};
    use sorng_protocols::origin_browser::NativeHostReadiness;
    let mut shared = fixture(Arc::new(Sink)).await;
    shared.permissions = Arc::new(
        WebsitePermissionEngine::new(
            None,
            None,
            &[(
                WebsiteRequestClass::Navigation,
                WebsitePermissionDecision::Allow,
            )]
            .into_iter()
            .collect(),
        )
        .unwrap(),
    );
    {
        let mut session = shared.session.lock().unwrap();
        let report = NativeHostReadiness::Ready {
            profile_key: session.policy().profile_key().to_owned(),
            proxy_endpoint: session.proxy_endpoint(),
        };
        session.report_host(&shared.identity, report).unwrap();
    }
    shared.state.lock().unwrap().browser_id = Some(41);
    Arc::new(shared)
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
    // The twelve original rows, plus Paste as plain text, Print and Inspect.
    let offered = items(&rows);
    assert_eq!(offered.len(), 15);
    for id in BACK..=DEVTOOLS {
        assert!(offered.iter().any(|row| row.0 == id), "{id}");
    }
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

const HERE: &str = "https://fixture.invalid/next?item=1#part";
const PICTURE: &str = "https://fixture.invalid/picture.png";
const ELSEWHERE: &str = "https://elsewhere.invalid/";

/// Join the non-empty groups with one separator between neighbours.
fn layout(groups: &[&[(i32, bool)]]) -> Vec<(i32, bool)> {
    let mut rows = Vec::new();
    for group in groups.iter().filter(|group| !group.is_empty()) {
        if !rows.is_empty() {
            rows.push((SEPARATOR, false));
        }
        rows.extend_from_slice(group);
    }
    rows
}

/// "Open ... in new tab" and "Copy ... address" for one clicked address.
fn address_rows(open: i32, copy: i32, openable: bool) -> Vec<(i32, bool)> {
    vec![(open, openable), (copy, true)]
}

/// The rows offered for one right-click on a loaded, idle view whose popup
/// policy allows tabs, where a clipboard writer exists. The mock browser has
/// no history. In the host Back is enabled even on a view's first page,
/// because the bootstrap document is behind it (observed with `engine`).
async fn offered(click: Click) -> Vec<(i32, bool)> {
    let mut scene = Scene::new(Recorder::default()).await;
    let rows = scene.open(click);
    scene.shared.revoke();
    rows
}

const NAVIGATION: [(i32, bool); 4] = [
    (BACK, false),
    (FORWARD, false),
    (RELOAD, true),
    (STOP, false),
];
const PAGE: [(i32, bool); 1] = [(PRINT, true)];
const TOOLS: [(i32, bool); 2] = [(INSPECT, true), (DEVTOOLS, true)];
/// The engine sets "select all" on every target, so the original rule
/// "Select all whenever the flags allow it" puts this row on every menu.
const SELECT: [(i32, bool); 1] = [(SELECT_ALL, true)];

/// The whole menu: link rows, media rows, navigation, edit rows, print, tools.
fn menu(link: &[(i32, bool)], media: &[(i32, bool)], edit: &[(i32, bool)]) -> Vec<(i32, bool)> {
    layout(&[link, media, &NAVIGATION, edit, &PAGE, &TOOLS])
}

/// The eight edit rows of an editable field, in order.
fn edit_rows(enabled: [bool; 8]) -> Vec<(i32, bool)> {
    [
        UNDO,
        REDO,
        CUT,
        COPY,
        PASTE,
        PASTE_PLAIN,
        DELETE,
        SELECT_ALL,
    ]
    .into_iter()
    .zip(enabled)
    .collect()
}

#[tokio::test]
async fn each_click_target_gets_the_rows_a_browser_offers_for_it() {
    let link = address_rows(OPEN_LINK, COPY_LINK, true);
    let picture = address_rows(OPEN_IMAGE, COPY_IMAGE_ADDRESS, true);

    // Plain page: the engine reports "select all" and "translate" (192).
    assert_eq!(offered(Click::default()).await, menu(&[], &[], &SELECT));
    // Selected page text.
    assert_eq!(
        offered(Click {
            flags: engine::SELECTED_TEXT,
            ..Default::default()
        })
        .await,
        menu(&[], &[], &[(COPY, true), (SELECT_ALL, true)])
    );
    // Link.
    assert_eq!(
        offered(Click {
            link: HERE,
            ..Default::default()
        })
        .await,
        menu(&link, &[], &SELECT)
    );
    // Image.
    assert_eq!(
        offered(Click {
            source: PICTURE,
            media: IMAGE,
            ..Default::default()
        })
        .await,
        menu(&[], &picture, &SELECT)
    );
    // Image inside a link: both groups, link first.
    assert_eq!(
        offered(Click {
            link: HERE,
            source: PICTURE,
            media: IMAGE,
            ..Default::default()
        })
        .await,
        menu(&link, &picture, &SELECT)
    );
    // Video and audio.
    for (media, open, copy) in [
        (VIDEO, OPEN_VIDEO, COPY_VIDEO_ADDRESS),
        (AUDIO, OPEN_AUDIO, COPY_AUDIO_ADDRESS),
    ] {
        assert_eq!(
            offered(Click {
                source: CLIP,
                media,
                ..Default::default()
            })
            .await,
            menu(&[], &address_rows(open, copy, true), &SELECT)
        );
    }
    // Editable fields, in the states the engine was seen to report. The
    // arrays are Undo, Redo, Cut, Copy, Paste, Paste as plain text, Delete,
    // Select all.
    for (flags, enabled) in [
        // Text input with a value and a caret; a contenteditable is the same.
        (
            engine::INPUT,
            [false, false, false, false, true, true, false, true],
        ),
        (
            engine::RICH_TEXT,
            [false, false, false, false, true, true, false, true],
        ),
        // Text input with everything selected.
        (
            engine::INPUT_ALL_SELECTED,
            [false, false, true, true, true, true, true, true],
        ),
        // Password field: Copy and Cut are never enabled, not even with
        // everything selected; both pastes always are.
        (
            engine::PASSWORD_EMPTY,
            [false, false, false, false, true, true, false, false],
        ),
        (
            engine::PASSWORD_FILLED,
            [false, false, false, false, true, true, false, true],
        ),
        (
            engine::PASSWORD_ALL_SELECTED,
            [true, false, false, false, true, true, true, true],
        ),
    ] {
        assert_eq!(
            offered(Click {
                editable: 1,
                flags,
                ..Default::default()
            })
            .await,
            menu(&[], &[], &edit_rows(enabled)),
            "{flags}"
        );
    }
}

#[tokio::test]
async fn addresses_the_attempt_may_not_open_are_offered_for_copy_only() {
    // Another origin and a downgrade: the navigation policy refuses them.
    // `mailto:` is not a destination a tab takes. Only the address is copied.
    for link in [
        ELSEWHERE,
        "http://fixture.invalid/",
        "mailto:someone@fixture.invalid",
    ] {
        assert_eq!(
            offered(Click {
                link,
                ..Default::default()
            })
            .await,
            menu(&address_rows(OPEN_LINK, COPY_LINK, false), &[], &SELECT),
            "{link}"
        );
    }
    // A `javascript:` link as the engine reports it: a blocked placeholder as
    // the validated link and the original as the unfiltered one. Nothing is
    // opened; the `javascript:` text can be copied, as in a desktop browser.
    assert_eq!(
        offered(Click {
            link: engine::BLOCKED_LINK,
            unfiltered: Some(engine::SCRIPT_LINK),
            ..Default::default()
        })
        .await,
        menu(&address_rows(OPEN_LINK, COPY_LINK, false), &[], &SELECT)
    );
    for source in [
        "data:image/png;base64,AAAA",
        "blob:https://fixture.invalid/1",
    ] {
        assert_eq!(
            offered(Click {
                source,
                media: IMAGE,
                ..Default::default()
            })
            .await,
            menu(
                &[],
                &address_rows(OPEN_IMAGE, COPY_IMAGE_ADDRESS, false),
                &SELECT
            ),
            "{source}"
        );
    }
    // Nothing is offered for an address that cannot even be copied, for a
    // source the engine does not call an image/video/audio, or for no address.
    let page = offered(Click::default()).await;
    let long: &'static str =
        Box::leak(format!("https://fixture.invalid/{}", "a".repeat(16_384)).into_boxed_str());
    assert_eq!(
        offered(Click {
            link: long,
            source: long,
            media: IMAGE,
            ..Default::default()
        })
        .await,
        page
    );
    for media in [
        cef_context_menu_media_type_t::CM_MEDIATYPE_NONE,
        cef_context_menu_media_type_t::CM_MEDIATYPE_CANVAS,
        cef_context_menu_media_type_t::CM_MEDIATYPE_FILE,
        cef_context_menu_media_type_t::CM_MEDIATYPE_PLUGIN,
    ] {
        assert_eq!(
            offered(Click {
                source: PICTURE,
                media,
                ..Default::default()
            })
            .await,
            page
        );
    }
    assert_eq!(
        offered(Click {
            media: IMAGE,
            ..Default::default()
        })
        .await,
        page
    );
}

#[tokio::test]
async fn open_rows_are_disabled_when_the_popup_policy_does_not_allow_tabs() {
    // Seen in the engine with popup policy Block (2026-10-12): the row was
    // offered enabled, and selecting it did nothing.
    for (click, open, copy, address) in [
        (
            Click {
                link: HERE,
                ..Default::default()
            },
            OPEN_LINK,
            COPY_LINK,
            HERE,
        ),
        (
            Click {
                source: PICTURE,
                media: IMAGE,
                ..Default::default()
            },
            OPEN_IMAGE,
            COPY_IMAGE_ADDRESS,
            PICTURE,
        ),
        (
            Click {
                source: CLIP,
                media: VIDEO,
                ..Default::default()
            },
            OPEN_VIDEO,
            COPY_VIDEO_ADDRESS,
            CLIP,
        ),
        (
            Click {
                source: CLIP,
                media: AUDIO,
                ..Default::default()
            },
            OPEN_AUDIO,
            COPY_AUDIO_ADDRESS,
            CLIP,
        ),
    ] {
        let mut allowed = Scene::new(Recorder::default()).await;
        let with_tabs = allowed.open(click);
        assert!(with_tabs.contains(&(open, true)), "{open}");

        let mut blocked = Scene::new(Recorder::default()).await;
        blocked.effects.no_tabs.store(true, Ordering::Release);
        let rows = blocked.open(click);
        // The row stays where it is, as for an address the attempt may not
        // open, but disabled. Nothing else on the menu changes.
        let expected: Vec<_> = with_tabs
            .iter()
            .map(|row| if row.0 == open { (open, false) } else { *row })
            .collect();
        assert_eq!(rows, expected, "{open}");
        // Selecting it runs nothing, and it consumed the menu.
        blocked.choose(click, open);
        blocked.choose(click, copy);
        assert_eq!(blocked.happened(), (vec![], vec![]), "{open}");
        // The address can still be copied.
        blocked.open(click);
        blocked.choose(click, copy);
        assert_eq!(
            blocked.happened(),
            (vec![Command::CopyText(address.into())], vec![]),
            "{open}"
        );
        // With tabs allowed the same row does open a tab.
        allowed.choose(click, open);
        assert_eq!(
            allowed.happened(),
            (vec![Command::OpenTab(address.into())], vec![]),
            "{open}"
        );
        allowed.shared.revoke();
        blocked.shared.revoke();
    }

    // An image inside a link: both Open rows are disabled together.
    let both = Click {
        link: HERE,
        source: PICTURE,
        media: IMAGE,
        ..Default::default()
    };
    let mut blocked = Scene::new(Recorder::default()).await;
    blocked.effects.no_tabs.store(true, Ordering::Release);
    assert_eq!(
        blocked.open(both),
        menu(
            &address_rows(OPEN_LINK, COPY_LINK, false),
            &address_rows(OPEN_IMAGE, COPY_IMAGE_ADDRESS, false),
            &SELECT
        )
    );
    blocked.shared.revoke();

    // The policy is read again with the command: a menu shown while tabs
    // were allowed opens none once they are not.
    let mut scene = Scene::new(Recorder::default()).await;
    assert!(scene.open(both).contains(&(OPEN_LINK, true)));
    scene.effects.no_tabs.store(true, Ordering::Release);
    scene.choose(both, OPEN_LINK);
    assert_eq!(scene.happened(), (vec![], vec![]));
    scene.shared.revoke();
}

#[tokio::test]
async fn the_production_handler_reads_the_popup_policy_and_the_platform_writer() {
    // The real effects. A view in a unit test has no popup group, which is
    // also what a view whose policy was never configured looks like: no tab
    // may be opened, so the Open rows are disabled. The Copy rows exist where
    // the platform has a clipboard writer.
    let shared = navigable_owner().await;
    let mut browser = focus_browser(1, 41);
    let mut frame = frame(browser.clone(), Arc::default(), true);
    let rows = Rows::default();
    handler(
        shared.clone(),
        Arc::new(Mutex::new(Some(browser.clone()))),
        DownloadAttachment::default(),
    )
    .on_before_context_menu(
        Some(&mut browser),
        Some(&mut frame),
        Some(&mut click(Click {
            link: HERE,
            source: PICTURE,
            media: IMAGE,
            ..Default::default()
        })),
        Some(&mut model(rows.clone())),
    );
    let pair = |open: i32, copy: i32| {
        let mut rows = vec![(open, false)];
        if WRITER {
            rows.push((copy, true));
        }
        rows
    };
    assert_eq!(
        snapshot(&rows),
        menu(
            &pair(OPEN_LINK, COPY_LINK),
            &pair(OPEN_IMAGE, COPY_IMAGE_ADDRESS),
            &SELECT
        )
    );
    shared.revoke();
}

#[tokio::test]
async fn paste_as_plain_text_runs_in_the_focused_frame_once() {
    let shared = owner().await;
    let mut browser = focus_browser(1, 41);
    let ops = Ops::default();
    let mut frame = frame_with(browser.clone(), Arc::default(), ops.clone(), true);
    // A password field: the secure clipboard's value still reaches it.
    let mut params = params(1, engine::PASSWORD_EMPTY);
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
    for _ in 0..2 {
        assert_eq!(
            menu.on_context_menu_command(
                Some(&mut browser),
                Some(&mut frame),
                Some(&mut params),
                PASTE_PLAIN,
                EventFlags::default()
            ),
            1
        );
    }
    assert_eq!(*ops.lock().unwrap(), ["paste_and_match_style"]);
    shared.revoke();
}

#[tokio::test]
async fn a_link_or_image_never_forces_a_menu_the_owner_may_not_show() {
    for reason in ["hidden", "blocked", "revoked", "closing"] {
        let shared = navigable_owner().await;
        let mut browser = focus_browser(1, 41);
        let mut frame = frame(browser.clone(), Arc::default(), true);
        let mut params = click(Click {
            editable: 1,
            flags: 127,
            link: HERE,
            source: PICTURE,
            media: cef_context_menu_media_type_t::CM_MEDIATYPE_IMAGE,
            ..Default::default()
        });
        match reason {
            "hidden" => shared
                .state
                .lock()
                .unwrap()
                .control
                .hide(&shared.identity)
                .unwrap(),
            "blocked" => shared.input_blocked.store(true, Ordering::Release),
            "revoked" => shared.revoke(),
            _ => {
                shared
                    .state
                    .lock()
                    .unwrap()
                    .control
                    .begin_close(&shared.identity)
                    .unwrap();
            }
        }
        // A stale default row must not survive either.
        let rows: Rows = Arc::new(Mutex::new(vec![(130, true)]));
        let mut model = model(rows.clone());
        let cancelled = Arc::new(AtomicU64::new(0));
        let mut callback = callback(cancelled.clone());
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
        assert!(rows.lock().unwrap().is_empty(), "{reason}");
        assert_eq!(
            menu.run_context_menu(
                Some(&mut browser),
                Some(&mut frame),
                Some(&mut params),
                Some(&mut model),
                Some(&mut callback)
            ),
            1,
            "{reason}"
        );
        assert_eq!(cancelled.load(Ordering::Relaxed), 1, "{reason}");
        shared.revoke();
    }
}

const IMAGE: cef_context_menu_media_type_t = cef_context_menu_media_type_t::CM_MEDIATYPE_IMAGE;
const VIDEO: cef_context_menu_media_type_t = cef_context_menu_media_type_t::CM_MEDIATYPE_VIDEO;
const AUDIO: cef_context_menu_media_type_t = cef_context_menu_media_type_t::CM_MEDIATYPE_AUDIO;
const CLIP: &str = "https://fixture.invalid/clip";
/// An address the attempt may open, and one it may only copy.
const OPENABLE: Address = Address {
    open: true,
    copy: true,
};
const COPY_ONLY: Address = Address {
    open: false,
    copy: true,
};

/// The rules of the twelve original rows, copied from the policy as it was
/// before link, media, print and inspect rows existed.
const ORIGINAL: [Action; 12] = [
    Action::Back,
    Action::Forward,
    Action::Reload,
    Action::Stop,
    Action::Undo,
    Action::Redo,
    Action::Cut,
    Action::Copy,
    Action::Paste,
    Action::Delete,
    Action::SelectAll,
    Action::DevTools,
];
fn original_enabled(state: MenuState, action: Action) -> bool {
    match action {
        Action::Back => state.back,
        Action::Forward => state.forward,
        Action::Stop => state.loading,
        Action::Reload | Action::DevTools => true,
        Action::Copy | Action::SelectAll => state.edit_flags & action.edit_bit() != 0,
        _ => state.editable && state.edit_flags & action.edit_bit() != 0,
    }
}
fn original_visible(state: MenuState, action: Action) -> bool {
    let edit = !matches!(
        action,
        Action::Back | Action::Forward | Action::Reload | Action::Stop | Action::DevTools
    );
    !edit
        || state.editable
        || matches!(action, Action::Copy | Action::SelectAll) && original_enabled(state, action)
}

#[test]
fn the_twelve_original_rows_keep_their_rules_and_order() {
    let clicked = MenuState {
        link: OPENABLE,
        media: Media::Image,
        source: COPY_ONLY,
        clipboard: true,
        inspect: true,
        ..Default::default()
    };
    for extra in [MenuState::default(), clicked] {
        for bits in 0..16_u32 {
            // Every edit flag the engine defines, including the two no row uses.
            for edit_flags in 0..512 {
                let state = MenuState {
                    back: bits & 1 != 0,
                    forward: bits & 2 != 0,
                    loading: bits & 4 != 0,
                    editable: bits & 8 != 0,
                    edit_flags,
                    ..extra
                };
                for action in ORIGINAL {
                    assert_eq!(state.visible(action), original_visible(state, action));
                    assert_eq!(state.enabled(action), original_enabled(state, action));
                }
                let rows: Vec<_> = state
                    .rows()
                    .into_iter()
                    .filter(|row| ORIGINAL.contains(&row.0))
                    .collect();
                let expected: Vec<_> = ORIGINAL
                    .into_iter()
                    .filter(|action| original_visible(state, *action))
                    .map(|action| (action, original_enabled(state, action)))
                    .collect();
                assert_eq!(rows, expected);
            }
        }
    }
}

#[test]
fn an_address_is_absent_copyable_or_openable() {
    const ABSENT: Address = Address {
        open: false,
        copy: false,
    };
    let admit = |_: &str| true;
    let refuse = |_: &str| false;
    let unasked =
        |address: &str| -> bool { panic!("the navigation policy was asked about {address}") };
    let longest = format!("https://fixture.invalid/{}", "a".repeat(16_384 - 24));
    let too_long = format!("{longest}a");
    assert_eq!((longest.len(), too_long.len()), (16_384, 16_385));
    assert_eq!(Address::default(), ABSENT);
    for address in [
        "",
        "https://fixture.invalid/\npath",
        "https://fixture.invalid/\0",
        "https://fixture.invalid/\u{7f}",
        too_long.as_str(),
    ] {
        assert_eq!(Address::of(address, address, unasked), ABSENT);
        assert!(!copyable(address));
    }
    for address in [
        "https://fixture.invalid/next?item=1#part",
        "http://fixture.invalid/",
        longest.as_str(),
    ] {
        assert_eq!(Address::of(address, address, admit), OPENABLE);
        assert_eq!(Address::of(address, address, refuse), COPY_ONLY);
    }
    // Not a destination open_tab() takes: copied as it is, and the
    // navigation policy is not consulted at all.
    for address in [
        "mailto:someone@fixture.invalid",
        "javascript:void(0)",
        "data:image/png;base64,AAAA",
        "blob:https://fixture.invalid/1",
        "file:///c:/private",
        "ftp://fixture.invalid/",
        "about:blank#blocked",
        "HTTPS://fixture.invalid/",
        "//fixture.invalid/next",
        "fixture.invalid",
        " https://fixture.invalid/",
    ] {
        assert_eq!(
            Address::of(address, address, unasked),
            COPY_ONLY,
            "{address}"
        );
    }
    // Opening is decided by the validated address and copying by the
    // unfiltered one; neither stands in for the other. The first case is
    // what the engine reports for a `javascript:` link.
    let blocked = engine::BLOCKED_LINK;
    assert_eq!(
        Address::of(blocked, engine::SCRIPT_LINK, unasked),
        COPY_ONLY
    );
    assert_eq!(Address::of(blocked, "", unasked), ABSENT);
    assert_eq!(
        Address::of("https://fixture.invalid/", "", admit),
        Address {
            open: true,
            copy: false
        }
    );
    assert_eq!(
        Address::of("", "https://fixture.invalid/", unasked),
        COPY_ONLY
    );
}

#[test]
fn rows_follow_the_clicked_element_the_writer_and_the_page_state() {
    for media in [Media::None, Media::Image, Media::Video, Media::Audio] {
        let state = MenuState {
            media,
            source: OPENABLE,
            clipboard: true,
            ..Default::default()
        };
        for (kind, open, copy) in [
            (Media::Image, Action::OpenImage, Action::CopyImageAddress),
            (Media::Video, Action::OpenVideo, Action::CopyVideoAddress),
            (Media::Audio, Action::OpenAudio, Action::CopyAudioAddress),
        ] {
            for action in [open, copy] {
                assert_eq!(state.visible(action), media == kind);
                assert_eq!(state.enabled(action), media == kind);
            }
        }
        // A media source is never mistaken for a link.
        assert!(!state.visible(Action::OpenLink) && !state.enabled(Action::OpenLink));
        assert!(!state.visible(Action::CopyLinkAddress));
    }
    let clicked = MenuState {
        link: OPENABLE,
        media: Media::Image,
        source: OPENABLE,
        clipboard: true,
        ..Default::default()
    };
    // No writer (Linux today): the copy rows are not offered at all.
    let no_writer = MenuState {
        clipboard: false,
        ..clicked
    };
    for copy in [
        Action::CopyLinkAddress,
        Action::CopyImageAddress,
        Action::CopyVideoAddress,
        Action::CopyAudioAddress,
    ] {
        assert!(!no_writer.visible(copy) && !no_writer.enabled(copy));
    }
    assert!(no_writer.enabled(Action::OpenLink) && no_writer.enabled(Action::OpenImage));
    // An address the attempt may not open is shown, but only copied.
    let copy_only = MenuState {
        link: COPY_ONLY,
        source: COPY_ONLY,
        ..clicked
    };
    for (open, copy) in [
        (Action::OpenLink, Action::CopyLinkAddress),
        (Action::OpenImage, Action::CopyImageAddress),
    ] {
        assert!(copy_only.visible(open) && !copy_only.enabled(open));
        assert!(copy_only.visible(copy) && copy_only.enabled(copy));
    }
    // Print is refused while loading; Inspect needs a usable click point.
    let idle = MenuState::default();
    let loading = MenuState {
        loading: true,
        ..idle
    };
    assert!(idle.visible(Action::Print) && idle.enabled(Action::Print));
    assert!(loading.visible(Action::Print) && !loading.enabled(Action::Print));
    assert!(idle.visible(Action::Inspect) && !idle.enabled(Action::Inspect));
    assert!(MenuState {
        inspect: true,
        ..idle
    }
    .enabled(Action::Inspect));
    // Paste as plain text is offered and enabled exactly when Paste is.
    for editable in [false, true] {
        for edit_flags in 0..512 {
            let state = MenuState {
                editable,
                edit_flags,
                ..Default::default()
            };
            assert_eq!(
                state.visible(Action::PasteAsPlainText),
                state.visible(Action::Paste)
            );
            assert_eq!(
                state.enabled(Action::PasteAsPlainText),
                state.enabled(Action::Paste)
            );
        }
    }
}

#[test]
fn a_receipt_is_bound_to_the_clicked_addresses_and_point() {
    let state = MenuState {
        editable: true,
        edit_flags: 127,
        link: OPENABLE,
        media: Media::Image,
        source: OPENABLE,
        clipboard: true,
        inspect: true,
        ..Default::default()
    };
    let target = Target {
        link: HERE.into(),
        unfiltered_link: HERE.into(),
        source: PICTURE.into(),
        point: (7, 9),
    };
    let receipt = Receipt {
        document: document(),
        rows: state.rows(),
        target: target.clone(),
    };
    let mut resolved = 0;
    for action in Action::ALL {
        let expected = (state.visible(action) && state.enabled(action)).then_some(action);
        assert_eq!(
            receipt.resolve(&document(), state, &target, action as i32),
            expected
        );
        resolved += usize::from(expected.is_some());
    }
    // Everything except Back, Forward, Stop and the video and audio rows.
    assert_eq!(resolved, 23 - 3 - 4);
    for changed in [
        Target {
            link: "https://fixture.invalid/other".into(),
            ..target.clone()
        },
        Target {
            unfiltered_link: "https://fixture.invalid/other".into(),
            ..target.clone()
        },
        Target {
            source: "https://fixture.invalid/other.png".into(),
            ..target.clone()
        },
        Target {
            point: (7, 10),
            ..target.clone()
        },
        Target {
            link: PICTURE.into(),
            source: HERE.into(),
            ..target.clone()
        },
        Target::default(),
    ] {
        for action in Action::ALL {
            assert_eq!(
                receipt.resolve(&document(), state, &changed, action as i32),
                None
            );
        }
    }
    // A row that was shown disabled stays refused if the address becomes
    // openable afterwards, and a row that is no longer allowed is refused.
    let copy_only = MenuState {
        link: COPY_ONLY,
        ..state
    };
    let shown_disabled = Receipt {
        document: document(),
        rows: copy_only.rows(),
        target: target.clone(),
    };
    assert_eq!(
        shown_disabled.resolve(&document(), state, &target, OPEN_LINK),
        None
    );
    assert_eq!(
        receipt.resolve(&document(), copy_only, &target, OPEN_LINK),
        None
    );
    assert_eq!(
        receipt.resolve(&document(), copy_only, &target, COPY_LINK),
        Some(Action::CopyLinkAddress)
    );
}

#[test]
fn each_row_asks_the_host_for_exactly_its_own_command() {
    // Three different addresses, so a row cannot pass with the wrong one.
    const WRITTEN: &str = "javascript:open('/next')";
    let target = Target {
        link: HERE.into(),
        unfiltered_link: WRITTEN.into(),
        source: PICTURE.into(),
        point: (7, 9),
    };
    let open = |address: &str| Some(Command::OpenTab(address.into()));
    let copy = |address: &str| Some(Command::CopyText(address.into()));
    for (action, expected) in [
        (Action::Back, Some(Command::Back)),
        (Action::Forward, Some(Command::Forward)),
        (Action::Reload, Some(Command::Reload)),
        (Action::Stop, Some(Command::Stop)),
        (Action::DevTools, Some(Command::DevTools)),
        (Action::Inspect, Some(Command::Inspect(7, 9))),
        (Action::Print, Some(Command::Print)),
        // A new tab opens the validated link; the clipboard gets the
        // unfiltered one.
        (Action::OpenLink, open(HERE)),
        (Action::CopyLinkAddress, copy(WRITTEN)),
        (Action::OpenImage, open(PICTURE)),
        (Action::CopyImageAddress, copy(PICTURE)),
        (Action::OpenVideo, open(PICTURE)),
        (Action::CopyVideoAddress, copy(PICTURE)),
        (Action::OpenAudio, open(PICTURE)),
        (Action::CopyAudioAddress, copy(PICTURE)),
        // Edit rows act on the clicked frame, never through the host.
        (Action::Undo, None),
        (Action::Redo, None),
        (Action::Cut, None),
        (Action::Copy, None),
        (Action::Paste, None),
        (Action::PasteAsPlainText, None),
        (Action::Delete, None),
        (Action::SelectAll, None),
    ] {
        assert_eq!(target.command(action), expected, "{action:?}");
    }
}

/// Stands in for the host and the OS clipboard, which unit tests cannot and
/// must not reach.
#[derive(Default)]
struct Recorder {
    manual: AtomicBool,
    /// The view's popup policy does not allow tabs.
    no_tabs: AtomicBool,
    no_writer: bool,
    fail: bool,
    seen: Mutex<Vec<Command>>,
}
impl Effects for Recorder {
    fn manual_input(&self, _: &Shared) -> bool {
        self.manual.load(Ordering::Acquire)
    }
    fn tabs(&self, _: &Shared) -> bool {
        !self.no_tabs.load(Ordering::Acquire)
    }
    fn clipboard(&self) -> bool {
        !self.no_writer
    }
    fn run(&self, _: &CefBrowserHost<'_>, command: &Command) -> Result<(), BrowserError> {
        self.seen.lock().unwrap().push(command.clone());
        if self.fail {
            Err(BrowserError::StateUnavailable)
        } else {
            Ok(())
        }
    }
}

/// One view, its handler and everything a command could touch.
struct Scene {
    shared: Arc<Shared>,
    browser: Browser,
    frame: Frame,
    ops: Ops,
    effects: Arc<Recorder>,
    menu: ContextMenuHandler,
}
impl Scene {
    async fn new(effects: Recorder) -> Self {
        let shared = navigable_owner().await;
        let browser = focus_browser(1, 41);
        let ops = Ops::default();
        let frame = frame_with(browser.clone(), Arc::default(), ops.clone(), true);
        let effects = Arc::new(effects);
        let menu = OwnedContextMenu::new(
            shared.clone(),
            Arc::new(Mutex::new(Some(browser.clone()))),
            DownloadAttachment::default(),
            effects.clone(),
        );
        Self {
            shared,
            browser,
            frame,
            ops,
            effects,
            menu,
        }
    }

    /// The engine asks for a menu at `click`. Returns what the model holds.
    fn open(&mut self, click: Click) -> Vec<(i32, bool)> {
        let rows = Rows::default();
        self.menu.on_before_context_menu(
            Some(&mut self.browser),
            Some(&mut self.frame),
            Some(&mut self::click(click)),
            Some(&mut model(rows.clone())),
        );
        snapshot(&rows)
    }

    /// The engine asks to display `rows`. Returns its answer and whether the
    /// native display was cancelled.
    fn show(&mut self, click: Click, rows: &[(i32, bool)]) -> (i32, bool) {
        let cancelled = Arc::new(AtomicU64::new(0));
        let answer = self.menu.run_context_menu(
            Some(&mut self.browser),
            Some(&mut self.frame),
            Some(&mut self::click(click)),
            Some(&mut model(Arc::new(Mutex::new(rows.to_vec())))),
            Some(&mut callback(cancelled.clone())),
        );
        (answer, cancelled.load(Ordering::Relaxed) == 1)
    }

    /// The user picks `id`; the engine repeats `click` with the command.
    fn choose(&mut self, click: Click, id: i32) {
        assert_eq!(
            self.menu.on_context_menu_command(
                Some(&mut self.browser),
                Some(&mut self.frame),
                Some(&mut self::click(click)),
                id,
                EventFlags::default()
            ),
            1,
            "a CEF default must never run"
        );
    }

    /// Everything that happened: host commands, then frame edit commands.
    fn happened(&self) -> (Vec<Command>, Vec<&'static str>) {
        (
            self.effects.seen.lock().unwrap().clone(),
            self.ops.lock().unwrap().clone(),
        )
    }
}

/// A link around an image, in an editable region with every edit flag a row
/// uses. Synthetic: no engine reports this combination; it exists so that
/// one click offers every kind of row, enabled.
const RICH: Click = Click {
    editable: 1,
    flags: 127,
    link: HERE,
    unfiltered: None,
    source: PICTURE,
    media: IMAGE,
    point: (7, 9),
};

#[tokio::test]
async fn link_media_print_and_inspect_rows_reach_the_host_exactly_once() {
    let video = Click {
        source: CLIP,
        media: VIDEO,
        ..RICH
    };
    let audio = Click {
        source: CLIP,
        media: AUDIO,
        ..RICH
    };
    // A `javascript:` link as the engine reports it: "Copy link address"
    // copies the original, never the blocked placeholder.
    let scripted = Click {
        link: engine::BLOCKED_LINK,
        unfiltered: Some(engine::SCRIPT_LINK),
        ..RICH
    };
    // The engine hands over the resolved, escaped address (`q=a b` in the
    // page arrives as `q=a%20b`), and that is what is opened and copied.
    const ESCAPED: &str = "https://fixture.invalid/next?item=7&q=a%20b";
    let spaced = Click {
        link: ESCAPED,
        ..RICH
    };
    let open = |address: &str| Command::OpenTab(address.into());
    let copy = |address: &str| Command::CopyText(address.into());
    for (click, id, expected) in [
        (RICH, OPEN_LINK, open(HERE)),
        (RICH, COPY_LINK, copy(HERE)),
        (scripted, COPY_LINK, copy(engine::SCRIPT_LINK)),
        (spaced, OPEN_LINK, open(ESCAPED)),
        (spaced, COPY_LINK, copy(ESCAPED)),
        (RICH, OPEN_IMAGE, open(PICTURE)),
        (RICH, COPY_IMAGE_ADDRESS, copy(PICTURE)),
        (video, OPEN_VIDEO, open(CLIP)),
        (video, COPY_VIDEO_ADDRESS, copy(CLIP)),
        (audio, OPEN_AUDIO, open(CLIP)),
        (audio, COPY_AUDIO_ADDRESS, copy(CLIP)),
        (RICH, PRINT, Command::Print),
        (RICH, INSPECT, Command::Inspect(7, 9)),
        (RICH, DEVTOOLS, Command::DevTools),
        (RICH, RELOAD, Command::Reload),
    ] {
        let mut scene = Scene::new(Recorder::default()).await;
        let rows = scene.open(click);
        assert!(rows.contains(&(id, true)), "{id}");
        assert_eq!(scene.show(click, &rows), (0, false), "{id}");
        for _ in 0..3 {
            scene.choose(click, id);
        }
        assert_eq!(scene.happened(), (vec![expected], vec![]), "{id}");
        scene.shared.revoke();
    }
}

#[tokio::test]
async fn each_edit_row_runs_its_own_frame_command_once_and_nothing_else() {
    for (id, name) in [
        (UNDO, "undo"),
        (REDO, "redo"),
        (CUT, "cut"),
        (COPY, "copy"),
        (PASTE, "paste"),
        (PASTE_PLAIN, "paste_and_match_style"),
        (DELETE, "del"),
        (SELECT_ALL, "select_all"),
    ] {
        let mut scene = Scene::new(Recorder::default()).await;
        scene.open(RICH);
        for _ in 0..3 {
            scene.choose(RICH, id);
        }
        assert_eq!(scene.happened(), (vec![], vec![name]), "{id}");
        scene.shared.revoke();
    }
    // An unfocused frame takes no edit command; host rows do not depend on it.
    for (id, expected) in [(PASTE_PLAIN, vec![]), (PRINT, vec![Command::Print])] {
        let mut scene = Scene::new(Recorder::default()).await;
        scene.open(RICH);
        scene.frame = frame_with(
            scene.browser.clone(),
            Arc::default(),
            scene.ops.clone(),
            false,
        );
        scene.choose(RICH, id);
        assert_eq!(scene.happened(), (expected, vec![]), "{id}");
        scene.shared.revoke();
    }
}

#[tokio::test]
async fn a_command_never_acts_on_an_address_or_point_the_menu_did_not_show() {
    const OTHER: &str = "https://fixture.invalid/other";
    for (id, repeated) in [
        (
            OPEN_LINK,
            Click {
                link: OTHER,
                ..RICH
            },
        ),
        (
            COPY_LINK,
            Click {
                link: OTHER,
                ..RICH
            },
        ),
        // Only the written link, or only the validated one, differs.
        (
            COPY_LINK,
            Click {
                unfiltered: Some(OTHER),
                ..RICH
            },
        ),
        (
            OPEN_LINK,
            Click {
                unfiltered: Some(OTHER),
                ..RICH
            },
        ),
        (
            COPY_LINK,
            Click {
                link: OTHER,
                unfiltered: Some(HERE),
                ..RICH
            },
        ),
        (
            OPEN_IMAGE,
            Click {
                source: OTHER,
                ..RICH
            },
        ),
        (
            COPY_IMAGE_ADDRESS,
            Click {
                source: OTHER,
                ..RICH
            },
        ),
        (
            INSPECT,
            Click {
                point: (8, 9),
                ..RICH
            },
        ),
        // The whole gesture is fenced, not only the chosen row's own address.
        (
            OPEN_LINK,
            Click {
                source: OTHER,
                ..RICH
            },
        ),
        (
            PRINT,
            Click {
                link: OTHER,
                ..RICH
            },
        ),
        (
            PASTE_PLAIN,
            Click {
                point: (7, 10),
                ..RICH
            },
        ),
        // Same source address, but the element is no longer an image.
        (
            OPEN_IMAGE,
            Click {
                media: VIDEO,
                ..RICH
            },
        ),
        (OPEN_LINK, Click { link: "", ..RICH }),
    ] {
        let mut scene = Scene::new(Recorder::default()).await;
        assert!(scene.open(RICH).contains(&(id, true)), "{id}");
        scene.choose(repeated, id);
        // The refused attempt consumed the receipt: the genuine click cannot
        // be replayed afterwards either.
        scene.choose(RICH, id);
        assert_eq!(scene.happened(), (vec![], vec![]), "{id}");
        scene.shared.revoke();
    }
}

#[tokio::test]
async fn no_menu_and_no_command_while_a_manual_input_slot_is_active() {
    let mut scene = Scene::new(Recorder::default()).await;
    scene.effects.manual.store(true, Ordering::Release);
    assert!(scene.open(RICH).is_empty());
    // Even rows left over in the engine's model are not displayed.
    assert_eq!(scene.show(RICH, &[(OPEN_LINK, true)]), (1, true));
    for id in BACK..=INSPECT {
        scene.open(RICH);
        scene.choose(RICH, id);
    }
    assert_eq!(scene.happened(), (vec![], vec![]));

    // A slot armed while the menu is already on screen wins as well.
    scene.effects.manual.store(false, Ordering::Release);
    let rows = scene.open(RICH);
    assert!(rows.contains(&(PASTE, true)) && rows.contains(&(OPEN_LINK, true)));
    scene.effects.manual.store(true, Ordering::Release);
    assert_eq!(scene.show(RICH, &rows), (1, true));
    scene.choose(RICH, PASTE);
    assert_eq!(scene.happened(), (vec![], vec![]));

    // Once the slot is gone a fresh menu works again.
    scene.effects.manual.store(false, Ordering::Release);
    scene.open(RICH);
    scene.choose(RICH, PASTE);
    assert_eq!(scene.happened(), (vec![], vec!["paste"]));
    scene.shared.revoke();
}

#[tokio::test]
async fn without_a_clipboard_writer_the_copy_rows_do_not_exist() {
    let mut scene = Scene::new(Recorder {
        no_writer: true,
        ..Default::default()
    })
    .await;
    let click = Click {
        editable: 0,
        flags: 0,
        ..RICH
    };
    assert_eq!(
        scene.open(click),
        layout(&[
            &[(OPEN_LINK, true)],
            &[(OPEN_IMAGE, true)],
            &[
                (BACK, false),
                (FORWARD, false),
                (RELOAD, true),
                (STOP, false)
            ],
            &[(PRINT, true)],
            &[(INSPECT, true), (DEVTOOLS, true)],
        ])
    );
    for id in [
        COPY_LINK,
        COPY_IMAGE_ADDRESS,
        COPY_VIDEO_ADDRESS,
        COPY_AUDIO_ADDRESS,
    ] {
        scene.open(click);
        scene.choose(click, id);
    }
    assert_eq!(scene.happened(), (vec![], vec![]));
    scene.shared.revoke();
}

#[tokio::test]
async fn only_an_offered_enabled_row_runs_and_no_other_id_ever_does() {
    let page = Click::default();
    let password = Click {
        editable: 1,
        flags: engine::PASSWORD_FILLED,
        ..Default::default()
    };
    let elsewhere = Click {
        link: ELSEWHERE,
        source: "data:image/png;base64,AAAA",
        media: IMAGE,
        ..Default::default()
    };
    // Every CEF default id, every id of ours, and their neighbours.
    let candidates: Vec<i32> = (-1..=260)
        .chain(26_490..=26_530)
        .chain([28_499, 28_500, 28_501, i32::MIN, i32::MAX])
        .collect();
    for click in [page, password, elsewhere, RICH] {
        let mut scene = Scene::new(Recorder::default()).await;
        let rows = scene.open(click);
        let mut expected = 0;
        for id in &candidates {
            scene.open(click);
            for _ in 0..2 {
                scene.choose(click, *id);
            }
            expected += usize::from(rows.contains(&(*id, true)));
            let (host, frame) = scene.happened();
            assert_eq!(host.len() + frame.len(), expected, "{id}");
        }
        assert_eq!(
            expected,
            rows.iter().filter(|row| row.1).count(),
            "every enabled row ran exactly once"
        );
        scene.shared.revoke();
    }
}

#[tokio::test]
async fn stale_owner_states_consume_the_new_rows_without_effect() {
    for reason in [
        "generation",
        "hidden",
        "blocked",
        "revoked",
        "foreign",
        "foreign-frame",
        "closing",
        "dismissed",
        "manual",
        "navigated",
    ] {
        for id in [
            OPEN_LINK,
            COPY_LINK,
            OPEN_IMAGE,
            COPY_IMAGE_ADDRESS,
            PASTE_PLAIN,
            PRINT,
            INSPECT,
        ] {
            let mut scene = Scene::new(Recorder::default()).await;
            assert!(scene.open(RICH).contains(&(id, true)));
            let mut repeated = RICH;
            match reason {
                "generation" => scene.shared.automation.lock().unwrap().generation += 1,
                "hidden" => scene
                    .shared
                    .state
                    .lock()
                    .unwrap()
                    .control
                    .hide(&scene.shared.identity)
                    .unwrap(),
                "blocked" => scene.shared.input_blocked.store(true, Ordering::Release),
                "revoked" => scene.shared.revoke(),
                "foreign" => scene.browser = focus_browser(1, 42),
                "foreign-frame" => {
                    scene.frame = frame_with(
                        focus_browser(1, 42),
                        Arc::default(),
                        scene.ops.clone(),
                        true,
                    );
                }
                "closing" => {
                    scene
                        .shared
                        .state
                        .lock()
                        .unwrap()
                        .control
                        .begin_close(&scene.shared.identity)
                        .unwrap();
                }
                "dismissed" => scene
                    .menu
                    .on_context_menu_dismissed(Some(&mut scene.browser), Some(&mut scene.frame)),
                "manual" => scene.effects.manual.store(true, Ordering::Release),
                // The element under the pointer is gone: nothing to act on.
                _ => repeated = Click::default(),
            }
            scene.choose(repeated, id);
            assert_eq!(scene.happened(), (vec![], vec![]), "{reason} {id}");
            scene.shared.revoke();
        }
    }
}

#[tokio::test]
async fn a_failed_host_command_is_still_consumed_once() {
    let mut scene = Scene::new(Recorder {
        fail: true,
        ..Default::default()
    })
    .await;
    scene.open(RICH);
    for _ in 0..2 {
        scene.choose(RICH, COPY_LINK);
    }
    assert_eq!(
        scene.happened(),
        (vec![Command::CopyText(HERE.into())], vec![])
    );
    scene.shared.revoke();
}

#[test]
fn the_only_log_line_is_built_from_the_action_alone() {
    let source = include_str!("cef_context_menu.rs");
    for sink in [
        "println!",
        "eprintln!",
        "print!(",
        "eprint!(",
        "dbg!",
        "log::",
        "tracing::",
        "format!",
    ] {
        assert!(!source.contains(sink), "{sink}");
    }
    assert_eq!(source.matches("writeln!").count(), 1);
    assert_eq!(source.matches("stderr").count(), 1);
    // The one writer takes an Action: no address, text or command reaches it.
    let report = &source[source.find("fn report(action: Action) {").unwrap()..];
    let report = &report[..report.find("\n}").unwrap()];
    assert!(report.contains("writeln!"));
    assert!(report.contains("action={action:?} failure=command-unavailable"));
    assert_eq!(source.matches("report(").count(), 2);
}

#[tokio::test]
async fn inspect_refuses_an_impossible_point_before_any_host_check() {
    let shared = owner().await;
    let host = facade(
        shared.clone(),
        Arc::new(Mutex::new(Some(focus_browser(1, 41)))),
        DownloadAttachment::default(),
    );
    for (x, y) in [(-1, 0), (0, -1), (40_000, 1), (1, 40_000)] {
        assert!(matches!(
            host.inspect_element(&shared.identity, x, y),
            Err(BrowserError::Control(ControlError::InvalidBounds))
        ));
    }
    // A possible point goes on to the host's own checks, which start with the
    // CEF UI thread. No engine runs in a unit test.
    assert!(matches!(
        host.inspect_element(&shared.identity, 1, 1),
        Err(BrowserError::WrongThread)
    ));
    shared.revoke();
}

/// The acceptance probe. Compiled and run only with
/// `--features cef-host,acceptance-probe`: the app's build has neither the
/// probe nor these tests.
#[cfg(feature = "acceptance-probe")]
mod probe_tests {
    use super::*;

    /// What the handler told the engine to do with a menu it was asked to
    /// display: select a row, or cancel.
    type Verdicts = Arc<Mutex<Vec<Option<i32>>>>;
    fn deciding_callback(verdicts: Verdicts) -> RunContextMenuCallback {
        type Data = RcImpl<_cef_run_context_menu_callback_t, Verdicts>;
        extern "C" fn cont(
            this: *mut _cef_run_context_menu_callback_t,
            id: i32,
            _: cef_event_flags_t,
        ) {
            Data::get(this).interface.lock().unwrap().push(Some(id));
        }
        extern "C" fn cancel(this: *mut _cef_run_context_menu_callback_t) {
            Data::get(this).interface.lock().unwrap().push(None);
        }
        let raw = _cef_run_context_menu_callback_t {
            cont: Some(cont),
            cancel: Some(cancel),
            ..unsafe { std::mem::zeroed() }
        };
        let raw: *mut _cef_run_context_menu_callback_t = RcImpl::new(raw, verdicts).cast();
        raw.wrap_result()
    }

    /// One view with the production handler and a probe installed on it.
    struct Probed {
        shared: Arc<Shared>,
        browser: Browser,
        frame: Frame,
        ops: Ops,
        menu: ContextMenuHandler,
        requests: Arc<AtomicU64>,
        /// Every row set the probe was asked to choose from.
        asked: Arc<Mutex<Vec<Vec<probe::Row>>>>,
        /// What the probe answers.
        pick: Arc<Mutex<Option<i32>>>,
        copied: Arc<Mutex<Vec<String>>>,
    }
    impl Probed {
        async fn new() -> Self {
            let shared = navigable_owner().await;
            let browser = focus_browser(1, 41);
            let ops = Ops::default();
            let frame = frame_with(browser.clone(), Arc::default(), ops.clone(), true);
            let menu = handler(
                shared.clone(),
                Arc::new(Mutex::new(Some(browser.clone()))),
                DownloadAttachment::default(),
            );
            let probed = Self {
                shared,
                browser,
                frame,
                ops,
                menu,
                requests: Arc::default(),
                asked: Arc::default(),
                pick: Arc::default(),
                copied: Arc::default(),
            };
            probed.install();
            probed
        }

        fn install(&self) {
            let (asked, pick, copied) =
                (self.asked.clone(), self.pick.clone(), self.copied.clone());
            probe::install(
                &self.shared,
                self.requests.clone(),
                Box::new(move |rows| {
                    asked.lock().unwrap().push(rows.to_vec());
                    *pick.lock().unwrap()
                }),
                Box::new(move |text| copied.lock().unwrap().push(text.to_owned())),
            );
        }

        /// The engine asks for a menu. Returns what the model holds.
        fn open(&mut self, click: Click) -> Vec<(i32, bool)> {
            let rows = Rows::default();
            self.menu.on_before_context_menu(
                Some(&mut self.browser),
                Some(&mut self.frame),
                Some(&mut super::click(click)),
                Some(&mut model(rows.clone())),
            );
            snapshot(&rows)
        }

        /// The engine asks to display `rows`. Returns its answer and what it
        /// was told through the display callback.
        fn show(&mut self, click: Click, rows: &[(i32, bool)]) -> (i32, Vec<Option<i32>>) {
            let verdicts = Verdicts::default();
            let answer = self.menu.run_context_menu(
                Some(&mut self.browser),
                Some(&mut self.frame),
                Some(&mut super::click(click)),
                Some(&mut model(Arc::new(Mutex::new(rows.to_vec())))),
                Some(&mut deciding_callback(verdicts.clone())),
            );
            let verdicts = verdicts.lock().unwrap().clone();
            (answer, verdicts)
        }

        /// The engine delivers a command, as it does after a selection.
        fn command(&mut self, click: Click, id: i32) {
            assert_eq!(
                self.menu.on_context_menu_command(
                    Some(&mut self.browser),
                    Some(&mut self.frame),
                    Some(&mut super::click(click)),
                    id,
                    EventFlags::default()
                ),
                1
            );
        }

        fn requests(&self) -> u64 {
            self.requests.load(Ordering::Relaxed)
        }

        fn asked(&self) -> Vec<Vec<probe::Row>> {
            self.asked.lock().unwrap().clone()
        }

        fn copied(&self) -> Vec<String> {
            self.copied.lock().unwrap().clone()
        }

        fn edits(&self) -> Vec<&'static str> {
            self.ops.lock().unwrap().clone()
        }
    }

    #[tokio::test]
    async fn the_probe_stands_in_for_the_popup_and_selects_an_enabled_offered_row() {
        let mut probed = Probed::new().await;
        let rows = probed.open(RICH);
        assert_eq!(probed.requests(), 1);
        assert!(
            probed.asked().is_empty(),
            "asked only when a menu is displayed"
        );
        *probed.pick.lock().unwrap() = Some(PASTE_PLAIN);
        assert_eq!(probed.show(RICH, &rows), (1, vec![Some(PASTE_PLAIN)]));
        // The probe was given exactly the model's rows, labelled, in order
        // and without separators.
        let asked = probed.asked();
        assert_eq!(asked.len(), 1);
        let offered: Vec<_> = asked[0].iter().map(|row| (row.0, row.2)).collect();
        let modelled: Vec<_> = rows
            .iter()
            .copied()
            .filter(|row| row.0 != SEPARATOR)
            .collect();
        assert_eq!(offered, modelled);
        // Disabled: a view in a unit test has no popup policy that allows tabs.
        assert!(asked[0].contains(&(OPEN_LINK, "Open link in new tab", false)));
        assert!(asked[0].contains(&(PASTE, "Paste", true)));
        assert!(asked[0].contains(&(BACK, "Back", false)));
        for row in &asked[0] {
            let action = Action::ALL
                .into_iter()
                .find(|action| *action as i32 == row.0);
            assert_eq!(action.map(Action::label), Some(row.1));
        }
        // The engine then delivers the selected command, as after a click.
        for _ in 0..2 {
            probed.command(RICH, PASTE_PLAIN);
        }
        assert_eq!(probed.edits(), ["paste_and_match_style"]);
        assert_eq!(probed.requests(), 1);
        probed.shared.revoke();
    }

    #[tokio::test]
    async fn a_copied_address_goes_to_the_probe_instead_of_the_os_clipboard() {
        let mut probed = Probed::new().await;
        let rows = probed.open(RICH);
        *probed.pick.lock().unwrap() = Some(COPY_LINK);
        if WRITER {
            assert_eq!(probed.show(RICH, &rows), (1, vec![Some(COPY_LINK)]));
            for _ in 0..2 {
                probed.command(RICH, COPY_LINK);
            }
            assert_eq!(probed.copied(), [HERE]);
        } else {
            // No writer on this platform, so the row does not exist and the
            // probe cannot select it either.
            assert!(!rows.iter().any(|row| row.0 == COPY_LINK));
            assert_eq!(probed.show(RICH, &rows), (1, vec![None]));
            probed.command(RICH, COPY_LINK);
            assert!(probed.copied().is_empty());
        }
        // The probe's sink applies the same validation as the OS writer.
        let sink = probe::sink(&probed.shared).unwrap();
        let before = probed.copied().len();
        assert_eq!(
            clipboard::write(&sink, "https://fixture.invalid/\npath"),
            Err(clipboard::Failure::Rejected)
        );
        assert_eq!(probed.copied().len(), before);
        assert_eq!(clipboard::write(&sink, CLIP), Ok(()));
        assert_eq!(probed.copied().last().map(String::as_str), Some(CLIP));
        probed.shared.revoke();
    }

    #[tokio::test]
    async fn the_probe_cannot_select_a_row_the_policy_did_not_offer_enabled() {
        for pick in [
            // Offered, but disabled: no history, nothing loading, and no
            // popup policy that allows a tab.
            Some(BACK),
            Some(FORWARD),
            Some(STOP),
            Some(OPEN_LINK),
            Some(OPEN_IMAGE),
            // Not offered: the clicked element is an image, not a video.
            Some(OPEN_VIDEO),
            // CEF's own MENU_ID_COPY and MENU_ID_VIEW_SOURCE, and ids nobody owns.
            Some(113),
            Some(132),
            Some(26_499),
            Some(26_523),
            Some(-1),
            Some(0),
            Some(i32::MAX),
            // The probe cancels.
            None,
        ] {
            let mut probed = Probed::new().await;
            let rows = probed.open(RICH);
            assert!(!rows.iter().any(|row| Some(row.0) == pick && row.1));
            *probed.pick.lock().unwrap() = pick;
            assert_eq!(probed.show(RICH, &rows), (1, vec![None]), "{pick:?}");
            assert_eq!(probed.asked().len(), 1, "{pick:?}");
            // Even if the engine delivered that id as a command, nothing
            // would run. The cancelled menu's receipt is gone as well.
            if let Some(id) = pick {
                probed.command(RICH, id);
            }
            probed.command(RICH, PASTE);
            assert!(probed.edits().is_empty(), "{pick:?}");
            assert!(probed.copied().is_empty(), "{pick:?}");
            probed.shared.revoke();
        }
    }

    #[tokio::test]
    async fn engine_requests_are_counted_even_when_no_menu_may_be_shown() {
        for reason in ["hidden", "blocked", "revoked", "closing"] {
            let mut probed = Probed::new().await;
            match reason {
                "hidden" => probed
                    .shared
                    .state
                    .lock()
                    .unwrap()
                    .control
                    .hide(&probed.shared.identity)
                    .unwrap(),
                "blocked" => probed.shared.input_blocked.store(true, Ordering::Release),
                "revoked" => probed.shared.revoke(),
                _ => {
                    probed
                        .shared
                        .state
                        .lock()
                        .unwrap()
                        .control
                        .begin_close(&probed.shared.identity)
                        .unwrap();
                }
            }
            assert!(probed.open(RICH).is_empty(), "{reason}");
            assert_eq!(probed.requests(), 1, "{reason}");
            // The probe is not consulted for a menu the owner may not show.
            assert_eq!(
                probed.show(RICH, &[(OPEN_LINK, true)]),
                (1, vec![None]),
                "{reason}"
            );
            assert!(probed.asked().is_empty(), "{reason}");
            probed.shared.revoke();
        }
        // One count per engine request; displaying a menu adds none.
        let mut probed = Probed::new().await;
        assert_eq!(probed.requests(), 0);
        for expected in 1..=3 {
            let rows = probed.open(Click::default());
            assert_eq!(probed.requests(), expected);
            assert_eq!(probed.show(Click::default(), &rows), (1, vec![None]));
            assert_eq!(probed.requests(), expected);
        }
        assert_eq!(probed.asked().len(), 3);
        probed.shared.revoke();
    }

    #[tokio::test]
    async fn ending_the_probe_restores_the_popup_and_the_real_writer() {
        let mut probed = Probed::new().await;
        let rows = probed.open(RICH);
        probe::remove(&probed.shared);
        // The OS popup again: the display callback is left to the engine.
        *probed.pick.lock().unwrap() = Some(PASTE);
        assert_eq!(probed.show(RICH, &rows), (0, vec![]));
        assert!(probed.asked().is_empty());
        assert!(probe::sink(&probed.shared).is_none());
        // A copy goes to the real writer, which a test build keeps inert, and
        // not to the probe.
        probed.command(RICH, COPY_LINK);
        assert!(probed.copied().is_empty());
        // Nothing is counted any more.
        probed.open(RICH);
        assert_eq!(probed.requests(), 1);
        // Installing again takes effect at once.
        probed.install();
        let rows = probed.open(RICH);
        assert_eq!(probed.requests(), 2);
        assert_eq!(probed.show(RICH, &rows), (1, vec![Some(PASTE)]));
        probed.shared.revoke();
    }

    #[tokio::test]
    async fn a_probe_belongs_to_one_view() {
        let mut probed = Probed::new().await;
        // Another view on the same thread, without a probe.
        let other = navigable_owner().await;
        let mut browser = focus_browser(1, 41);
        let mut frame = frame(browser.clone(), Arc::default(), true);
        let rows = Rows::default();
        let menu = handler(
            other.clone(),
            Arc::new(Mutex::new(Some(browser.clone()))),
            DownloadAttachment::default(),
        );
        menu.on_before_context_menu(
            Some(&mut browser),
            Some(&mut frame),
            Some(&mut click(RICH)),
            Some(&mut model(rows.clone())),
        );
        let verdicts = Verdicts::default();
        assert_eq!(
            menu.run_context_menu(
                Some(&mut browser),
                Some(&mut frame),
                Some(&mut click(RICH)),
                Some(&mut model(rows.clone())),
                Some(&mut deciding_callback(verdicts.clone()))
            ),
            0
        );
        assert!(verdicts.lock().unwrap().is_empty());
        assert!(probe::sink(&other).is_none());
        assert_eq!(probed.requests(), 0);
        assert!(probed.asked().is_empty());
        // And the probed view still answers for itself.
        let shown = probed.open(RICH);
        *probed.pick.lock().unwrap() = Some(PASTE);
        assert_eq!(probed.show(RICH, &shown), (1, vec![Some(PASTE)]));
        assert_eq!(probed.requests(), 1);
        other.revoke();
        probed.shared.revoke();
    }

    #[tokio::test]
    async fn a_probe_is_installed_only_through_the_live_host() {
        let shared = navigable_owner().await;
        let mut browser = focus_browser(1, 41);
        let slot = Arc::new(Mutex::new(Some(browser.clone())));
        let host = facade(shared.clone(), slot.clone(), DownloadAttachment::default());
        let asked = Arc::new(AtomicU64::new(0));
        let counter = asked.clone();
        let requests = Arc::new(AtomicU64::new(0));
        // The host's own check comes first. No engine runs in a unit test, so
        // it refuses, and nothing is installed.
        assert!(matches!(
            host.probe_context_menu(
                &shared.identity,
                requests.clone(),
                Box::new(move |_| {
                    counter.fetch_add(1, Ordering::Relaxed);
                    None
                }),
                Box::new(|_| {}),
            ),
            Err(BrowserError::WrongThread)
        ));
        assert!(matches!(
            host.end_context_menu_probe(&shared.identity),
            Err(BrowserError::WrongThread)
        ));
        let mut frame = frame(browser.clone(), Arc::default(), true);
        let rows = Rows::default();
        let menu = handler(shared.clone(), slot, DownloadAttachment::default());
        menu.on_before_context_menu(
            Some(&mut browser),
            Some(&mut frame),
            Some(&mut click(RICH)),
            Some(&mut model(rows.clone())),
        );
        let verdicts = Verdicts::default();
        assert_eq!(
            menu.run_context_menu(
                Some(&mut browser),
                Some(&mut frame),
                Some(&mut click(RICH)),
                Some(&mut model(rows.clone())),
                Some(&mut deciding_callback(verdicts.clone()))
            ),
            0
        );
        assert!(verdicts.lock().unwrap().is_empty());
        assert_eq!(asked.load(Ordering::Relaxed), 0);
        assert_eq!(requests.load(Ordering::Relaxed), 0);
        assert!(probe::sink(&shared).is_none());
        shared.revoke();
    }

    /// What the observer was told for one request, in its argument order.
    type Seen = (String, String, String, &'static str, u32, bool, (i32, i32));
    fn watch(shared: &Arc<Shared>) -> Arc<Mutex<Vec<Seen>>> {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        probe::watch(
            shared,
            Box::new(move |link, shown, source, media, flags, editable, point| {
                sink.lock().unwrap().push((
                    link.to_owned(),
                    shown.to_owned(),
                    source.to_owned(),
                    media,
                    flags,
                    editable,
                    point,
                ));
            }),
        );
        seen
    }
    fn seen(
        (link, shown, source): (&str, &str, &str),
        media: &'static str,
        flags: u32,
        editable: bool,
        point: (i32, i32),
    ) -> Seen {
        (
            link.to_owned(),
            shown.to_owned(),
            source.to_owned(),
            media,
            flags,
            editable,
            point,
        )
    }

    #[tokio::test]
    async fn the_observer_is_told_what_the_engine_reported_for_each_target() {
        const CANVAS: cef_context_menu_media_type_t =
            cef_context_menu_media_type_t::CM_MEDIATYPE_CANVAS;
        const ESCAPED: &str = "https://fixture.invalid/next?item=7&q=a%20b";
        let long: &'static str =
            Box::leak(format!("https://fixture.invalid/{}", "a".repeat(16_384)).into_boxed_str());
        let plain = u32::from(engine::PLAIN);
        let mut probed = Probed::new().await;
        let told = watch(&probed.shared);
        let at = (12, 34);
        let cases = [
            // Plain page.
            (
                Click::default(),
                seen(("", "", ""), "none", plain, false, at),
            ),
            // Link: the validated and the unfiltered address agree, and both
            // are the resolved, escaped address.
            (
                Click {
                    link: ESCAPED,
                    point: (3, 4),
                    ..Default::default()
                },
                seen((ESCAPED, ESCAPED, ""), "none", plain, false, (3, 4)),
            ),
            // A `javascript:` link: the two differ, each in its own position.
            (
                Click {
                    link: engine::BLOCKED_LINK,
                    unfiltered: Some(engine::SCRIPT_LINK),
                    ..Default::default()
                },
                seen(
                    (engine::BLOCKED_LINK, engine::SCRIPT_LINK, ""),
                    "none",
                    plain,
                    false,
                    at,
                ),
            ),
            // A link the attempt may not open is reported all the same.
            (
                Click {
                    link: ELSEWHERE,
                    ..Default::default()
                },
                seen((ELSEWHERE, ELSEWHERE, ""), "none", plain, false, at),
            ),
            // Image inside a link.
            (
                Click {
                    link: HERE,
                    source: PICTURE,
                    media: IMAGE,
                    point: (640, 480),
                    ..Default::default()
                },
                seen((HERE, HERE, PICTURE), "image", plain, false, (640, 480)),
            ),
            // Video and audio.
            (
                Click {
                    source: CLIP,
                    media: VIDEO,
                    ..Default::default()
                },
                seen(("", "", CLIP), "video", plain, false, at),
            ),
            (
                Click {
                    source: CLIP,
                    media: AUDIO,
                    ..Default::default()
                },
                seen(("", "", CLIP), "audio", plain, false, at),
            ),
            // A canvas has no address the menu acts on: kind "none", and its
            // source is not kept.
            (
                Click {
                    source: PICTURE,
                    media: CANVAS,
                    ..Default::default()
                },
                seen(("", "", ""), "none", plain, false, at),
            ),
            // Text input with everything selected, then the password states.
            (
                Click {
                    editable: 1,
                    flags: engine::INPUT_ALL_SELECTED,
                    ..Default::default()
                },
                seen(("", "", ""), "none", 252, true, at),
            ),
            (
                Click {
                    editable: 1,
                    flags: engine::PASSWORD_EMPTY,
                    ..Default::default()
                },
                seen(("", "", ""), "none", 144, true, at),
            ),
            (
                Click {
                    editable: 1,
                    flags: engine::PASSWORD_ALL_SELECTED,
                    ..Default::default()
                },
                seen(("", "", ""), "none", 241, true, at),
            ),
            // Flags are passed through raw, including bits no row uses
            // (128 = can translate, 256 = can edit richly).
            (
                Click {
                    editable: 1,
                    flags: engine::RICH_TEXT,
                    ..Default::default()
                },
                seen(("", "", ""), "none", 464, true, at),
            ),
            // Selected page text is not an editable target.
            (
                Click {
                    flags: engine::SELECTED_TEXT,
                    ..Default::default()
                },
                seen(("", "", ""), "none", 200, false, at),
            ),
            // An address too long to keep is reported as absent.
            (
                Click {
                    link: long,
                    source: long,
                    media: IMAGE,
                    ..Default::default()
                },
                seen(("", "", ""), "image", plain, false, at),
            ),
            // A point "Inspect" would refuse is still reported as it came.
            (
                Click {
                    point: (-1, 40_000),
                    ..Default::default()
                },
                seen(("", "", ""), "none", plain, false, (-1, 40_000)),
            ),
        ];
        let expected: Vec<Seen> = cases.iter().map(|case| case.1.clone()).collect();
        for (click, _) in cases {
            probed.open(click);
        }
        // One call per request, in order, each with that request's values.
        assert_eq!(*told.lock().unwrap(), expected);
        assert_eq!(probed.requests(), expected.len() as u64);
        probed.shared.revoke();
    }

    #[tokio::test]
    async fn the_observer_only_observes_and_ends_with_the_probe() {
        // The same clicks on a view without an observer.
        let mut plain = Probed::new().await;
        let unobserved = plain.open(RICH);
        *plain.pick.lock().unwrap() = Some(PASTE);
        let unobserved_verdict = plain.show(RICH, &unobserved);
        plain.shared.revoke();

        let mut probed = Probed::new().await;
        let told = watch(&probed.shared);
        let rows = probed.open(RICH);
        assert_eq!(rows, unobserved, "an observer changes no row");
        let expected = seen((HERE, HERE, PICTURE), "image", 127, true, (7, 9));
        assert_eq!(
            told.lock().unwrap().as_slice(),
            std::slice::from_ref(&expected)
        );
        // Displaying the menu and running a command tell it nothing more,
        // and both go exactly as without it.
        *probed.pick.lock().unwrap() = Some(PASTE);
        assert_eq!(probed.show(RICH, &rows), unobserved_verdict);
        for _ in 0..2 {
            probed.command(RICH, PASTE);
        }
        assert_eq!(probed.edits(), ["paste"]);
        assert_eq!(told.lock().unwrap().len(), 1);

        // A request the host refuses before the policy is counted, not observed.
        probed.shared.input_blocked.store(true, Ordering::Release);
        assert!(probed.open(RICH).is_empty());
        probed.shared.input_blocked.store(false, Ordering::Release);
        assert_eq!(probed.requests(), 2);
        assert_eq!(told.lock().unwrap().len(), 1);

        // Another view's requests are not this observer's.
        let mut other = Probed::new().await;
        other.open(RICH);
        assert_eq!(told.lock().unwrap().len(), 1);
        other.shared.revoke();

        // Installing the popup stand-in again keeps the observer.
        probed.install();
        probed.open(RICH);
        assert_eq!(*told.lock().unwrap(), vec![expected.clone(); 2]);

        // Ending the probe ends the observer too; the menu itself goes on.
        probe::remove(&probed.shared);
        let rows = probed.open(RICH);
        assert_eq!(rows, unobserved);
        assert_eq!(probed.show(RICH, &rows), (0, vec![]));
        assert_eq!(told.lock().unwrap().len(), 2);
        probed.shared.revoke();
    }

    #[tokio::test]
    async fn an_observer_works_without_the_popup_stand_in_and_only_through_the_live_host() {
        let shared = navigable_owner().await;
        let mut browser = focus_browser(1, 41);
        let slot = Arc::new(Mutex::new(Some(browser.clone())));
        let mut frame = frame(browser.clone(), Arc::default(), true);
        let menu = handler(shared.clone(), slot.clone(), DownloadAttachment::default());
        let mut ask = |click: Click| {
            let rows = Rows::default();
            menu.on_before_context_menu(
                Some(&mut browser),
                Some(&mut frame),
                Some(&mut super::click(click)),
                Some(&mut model(rows.clone())),
            );
            let verdicts = Verdicts::default();
            let answer = menu.run_context_menu(
                Some(&mut browser),
                Some(&mut frame),
                Some(&mut super::click(click)),
                Some(&mut model(rows.clone())),
                Some(&mut deciding_callback(verdicts.clone())),
            );
            let verdicts = verdicts.lock().unwrap().clone();
            (answer, verdicts)
        };

        // The host method checks the live host first. No engine runs in a
        // unit test, so it refuses and nothing is observed.
        let host = facade(shared.clone(), slot.clone(), DownloadAttachment::default());
        let refused = Arc::new(AtomicU64::new(0));
        let counter = refused.clone();
        assert!(matches!(
            host.observe_context_menu_targets(
                &shared.identity,
                Box::new(move |_, _, _, _, _, _, _| {
                    counter.fetch_add(1, Ordering::Relaxed);
                }),
            ),
            Err(BrowserError::WrongThread)
        ));
        assert_eq!(ask(RICH), (0, vec![]));
        assert_eq!(refused.load(Ordering::Relaxed), 0);

        // Installed on its own, it observes while the OS popup stays in use
        // and nothing is counted or redirected.
        let told = watch(&shared);
        assert_eq!(ask(RICH), (0, vec![]));
        assert_eq!(
            *told.lock().unwrap(),
            [seen((HERE, HERE, PICTURE), "image", 127, true, (7, 9))]
        );
        assert!(probe::sink(&shared).is_none());
        shared.revoke();
    }
}
