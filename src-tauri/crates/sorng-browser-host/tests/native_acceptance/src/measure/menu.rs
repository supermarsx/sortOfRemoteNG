//! Opt-in real-engine evidence for the native context menu: which rows the
//! production handler builds for each kind of click target, what its commands
//! do, and that a page which handles `contextmenu` itself gets no native menu.
//! Observations only. Nothing here grants acceptance or production readiness,
//! and no expectation lives in this file: the runner compares.
//!
//! Right-clicks are delivered with CEF's own in-process input methods on the
//! scenario's own browser. No OS-level input is synthesised and no other window
//! is addressed. The host's acceptance probe stands in for the OS popup and
//! for the clipboard writer, so no menu is ever shown and the OS clipboard is
//! never written. Rows that would open an OS dialog or a top-level window, or
//! read or write the clipboard, are observed and never selected: a paste would
//! move whatever the desktop's clipboard holds into the page.
use super::{
    fixture, label_safe, shell, Adapter, Flip, Held, Presentation, Result, Run, Served, Slot,
    SlotPlan, Stage, TlsStream, MODE_VARIABLE, ORIGIN,
};
use cef::{
    browser_host_get_browser_by_identifier, Browser, CefString, ImplBrowser, ImplBrowserHost,
    ImplFrame, KeyEvent, KeyEventType, MouseButtonType, MouseEvent,
};
use sorng_browser_host::{
    control::Lifecycle, ipc::OriginBrowserBounds, native_manual_input::ManualInputAction,
    native_popups::NativePopupPolicy,
};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    rc::Rc,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tao::{
    event::Event, event_loop::ControlFlow, platform::run_return::EventLoopExtRunReturn,
    window::Window,
};
use tokio::io::AsyncWriteExt;

const MODE: &str = "menu";
/// Print opens an OS dialog and both inspector rows open a top-level window in
/// front of whatever the desktop is doing; Copy and Cut write the OS clipboard,
/// and both pastes read it into the page.
pub(crate) const NEVER_SELECTED: &[&str] = &["Print", "Inspect", "Developer tools", "Copy", "Cut", "Paste", "Paste as plain text"];
/// How long the page gets to report what it saw of one right-click.
const PAGE_WAIT: Duration = Duration::from_millis(2500);
/// After the engine asked for a menu: time for the probe and the command.
const SETTLE: Duration = Duration::from_millis(350);
/// After the page reported a right-click the engine has not asked about: how
/// long the absence of a request is watched before it is recorded.
const ABSENCE: Duration = Duration::from_millis(900);
/// A missing layout report (page or frame) is waited for this long, once.
const LOCATE: Duration = Duration::from_secs(8);
const STEP_LIMIT: Duration = Duration::from_secs(30);
const SCENARIO_LIMIT: Duration = Duration::from_secs(300);
/// View coordinates of the pointer moves the page answers for calibration:
/// over no link or field of the fixture page at any zoom the run uses. Each
/// calibration uses the next one: the engine reports no move for a pointer
/// that is sent to where it already is.
const CALIBRATION: [(i32, i32); 3] = [(500, 285), (520, 279), (540, 273)];
/// CSS position of the wheel event: an empty part of the page, scrolled or not.
const WHEEL: (f64, f64) = (400.0, 520.0);
// cef_event_flags_t bits, which have one value on every platform.
const LEFT_BUTTON_DOWN: u32 = 1 << 4;
const RIGHT_BUTTON_DOWN: u32 = 1 << 6;
// Windows virtual-key codes, as CEF key events carry them on every platform.
const KEY_CONTEXT_MENU: i32 = 0x5D;
const KEY_END: i32 = 0x23;
const KEY_HOME: i32 = 0x24;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Popups {
    Tabs,
    Block,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Op {
    /// A pointer move the page reports back, to learn view units per CSS pixel.
    Calibrate,
    /// A right-click on a named target. `pick` is the row the probe is
    /// answered with; without one the menu is cancelled.
    Menu {
        target: &'static str,
        pick: Option<&'static str>,
    },
    /// The context-menu key, for whatever element has focus.
    MenuKey,
    Left {
        target: &'static str,
        clicks: i32,
    },
    Wheel {
        down: bool,
    },
    Zoom {
        percent: u16,
    },
    Block {
        blocked: bool,
    },
    Show {
        shown: bool,
    },
    ManualCapture,
    ManualCancel,
    Load {
        doc: &'static str,
        hold: bool,
        global: bool,
    },
    CloseTabs,
    /// Waits until the host reports that the document has finished loading.
    Idle,
    Revoke,
}

pub(crate) struct StepPlan {
    pub id: &'static str,
    pub op: Op,
}

const fn menu(id: &'static str, target: &'static str) -> StepPlan {
    StepPlan {
        id,
        op: Op::Menu { target, pick: None },
    }
}

const fn pick(id: &'static str, target: &'static str, row: &'static str) -> StepPlan {
    StepPlan {
        id,
        op: Op::Menu {
            target,
            pick: Some(row),
        },
    }
}

const fn step(id: &'static str, op: Op) -> StepPlan {
    StepPlan { id, op }
}

const fn view(id: &'static str) -> SlotPlan {
    SlotPlan {
        id,
        presentation: Presentation::Visible,
        width: 800.0,
        height: 600.0,
        adapter: Adapter::Manual,
        flip: Flip::None,
        relay_clients: None,
    }
}

pub(crate) struct Plan {
    pub view: SlotPlan,
    pub popups: Popups,
    pub steps: &'static [StepPlan],
}

// Run order. MENU_EVIDENCE_PLAN in scripts/cef-browser-acceptance.mjs mirrors
// the scenario and step ids, targets and picks, and holds what K10 and the
// handler's unit tests expect of each; a tooling test compares the two tables.
pub(crate) static PLANS: [Plan; 2] = [
    Plan {
        view: view("menu-main"),
        popups: Popups::Tabs,
        steps: &[
            step("calibrate", Op::Calibrate),
            // The context-menu key before any click: nothing has focus yet.
            step("key-first", Op::MenuKey),
            // Rows per click target; every menu is cancelled.
            menu("rows-plain", "plain"),
            menu("rows-link", "link"),
            menu("rows-link-raw", "link-raw"),
            menu("rows-link-js", "link-js"),
            menu("rows-link-other", "link-other"),
            menu("rows-link-http", "link-http"),
            menu("rows-link-frame-origin", "link-frame"),
            menu("rows-image", "image"),
            menu("rows-image-link", "image-link"),
            menu("rows-image-data", "image-data"),
            menu("rows-video", "video"),
            menu("rows-video-broken", "video-broken"),
            menu("rows-audio", "audio"),
            menu("rows-text", "text"),
            menu("rows-editable", "editable"),
            menu("rows-password-empty", "password-empty"),
            menu("rows-password-filled", "password-filled"),
            step("select-word", Op::Left { target: "prose", clicks: 2 }),
            menu("rows-selection", "prose"),
            // The page's own handling, between two ordinary right-clicks.
            menu("own-before", "plain"),
            menu("own-prevent", "own-prevent"),
            menu("own-menu", "own-menu"),
            menu("own-inline", "own-inline"),
            menu("own-document", "own-document"),
            menu("own-passive", "own-passive"),
            menu("own-stop", "own-stop"),
            menu("own-mouse", "own-mouse"),
            menu("own-after", "plain"),
            menu("frame-plain", "frame-plain"),
            menu("frame-own", "frame-own"),
            menu("frame-link", "frame-link"),
            menu("frame-text", "frame-text"),
            menu("frame-after", "frame-plain"),
            menu("xframe-plain", "xframe-plain"),
            menu("xframe-own", "xframe-own"),
            menu("xframe-link", "xframe-link"),
            menu("xframe-after", "xframe-plain"),
            step("focus-key-plain", Op::Left { target: "key-plain", clicks: 1 }),
            step("key-plain", Op::MenuKey),
            step("focus-key-own", Op::Left { target: "own-key", clicks: 1 }),
            step("key-own", Op::MenuKey),
            // Commands, each selected through the probe.
            pick("copy-link", "link", "Copy link address"),
            pick("copy-link-raw", "link-raw", "Copy link address"),
            pick("copy-link-js", "link-js", "Copy link address"),
            pick("copy-link-other", "link-other", "Copy link address"),
            pick("copy-image", "image", "Copy image address"),
            pick("copy-image-in-link", "image-link", "Copy image address"),
            pick("copy-link-of-image", "image-link", "Copy link address"),
            pick("copy-image-data", "image-data", "Copy image address"),
            pick("copy-video", "video", "Copy video address"),
            pick("copy-video-broken", "video-broken", "Copy video address"),
            pick("copy-audio", "audio", "Copy audio address"),
            pick("copy-frame-link", "frame-link", "Copy link address"),
            pick("copy-xframe-link", "xframe-link", "Copy link address"),
            pick("open-link-other", "link-other", "Open link in new tab"),
            pick("open-link-js", "link-js", "Open link in new tab"),
            pick("open-link", "link", "Open link in new tab"),
            pick("open-image", "image", "Open image in new tab"),
            pick("open-video", "video", "Open video in new tab"),
            pick("open-audio", "audio", "Open audio in new tab"),
            pick("open-link-frame-origin", "link-frame", "Open link in new tab"),
            step("close-tabs", Op::CloseTabs),
            pick("select-all", "text", "Select all"),
            menu("rows-text-selected", "text"),
            pick("delete", "text", "Delete"),
            pick("undo", "text", "Undo"),
            pick("redo", "text", "Redo"),
            pick("select-all-password", "password-filled", "Select all"),
            menu("rows-password-selected", "password-filled"),
            // The same commands on a scrolled page and in a zoomed view.
            step("scroll-down", Op::Wheel { down: true }),
            pick("scrolled-link", "link-low", "Copy link address"),
            step("scroll-up", Op::Wheel { down: false }),
            step("zoom-in", Op::Zoom { percent: 125 }),
            step("calibrate-zoomed", Op::Calibrate),
            pick("zoomed-link", "link", "Copy link address"),
            pick("zoomed-frame-link", "frame-link", "Copy link address"),
            step("zoom-reset", Op::Zoom { percent: 100 }),
            step("calibrate-reset", Op::Calibrate),
            // States in which the host must not show a menu.
            step("block", Op::Block { blocked: true }),
            menu("blocked", "link"),
            step("unblock", Op::Block { blocked: false }),
            menu("unblocked", "link"),
            step("hide", Op::Show { shown: false }),
            menu("hidden", "link"),
            step("show", Op::Show { shown: true }),
            menu("shown", "link"),
            step("focus-manual", Op::Left { target: "manual-target", clicks: 1 }),
            step("manual-capture", Op::ManualCapture),
            menu("manual-active", "link"),
            step("manual-cancel", Op::ManualCancel),
            menu("manual-ended", "link"),
            // History and loading rows on a second document that keeps loading.
            step("load-second", Op::Load { doc: "b", hold: true, global: false }),
            menu("rows-loading", "plain"),
            pick("stop", "plain", "Stop loading"),
            menu("rows-stopped", "plain"),
            pick("back", "plain", "Back"),
            menu("rows-back-loading", "plain"),
            step("idle-after-back", Op::Idle),
            menu("rows-after-back", "plain"),
            pick("forward", "plain", "Forward"),
            pick("stop-forward", "plain", "Stop loading"),
            pick("reload", "plain", "Reload"),
            pick("stop-reload", "plain", "Stop loading"),
            step("revoke", Op::Revoke),
            menu("revoked", "plain"),
        ],
    },
    Plan {
        view: view("menu-global"),
        popups: Popups::Block,
        steps: &[
            step("calibrate", Op::Calibrate),
            menu("plain-before", "plain"),
            // The first page of a view, once it has finished loading.
            step("idle-first", Op::Idle),
            menu("rows-first-idle", "plain"),
            pick("back-first-page", "plain", "Back"),
            step("load-again", Op::Load { doc: "a", hold: false, global: false }),
            // Popups are blocked for this view: each of the four rows that
            // would open a tab is asked for, and none may run.
            pick("open-link-popups-blocked", "link", "Open link in new tab"),
            pick("open-image-popups-blocked", "image", "Open image in new tab"),
            pick("open-video-popups-blocked", "video", "Open video in new tab"),
            pick("open-audio-popups-blocked", "audio", "Open audio in new tab"),
            // A document that prevents every contextmenu event at `document`.
            step("load-global", Op::Load { doc: "g", hold: false, global: true }),
            menu("global-plain", "plain"),
            menu("global-link", "link"),
            menu("global-image", "image"),
            menu("global-video", "video"),
            menu("global-text", "text"),
            menu("global-frame-plain", "frame-plain"),
            step("focus-key-global", Op::Left { target: "key-plain", clicks: 1 }),
            step("key-global", Op::MenuKey),
            step("load-plain", Op::Load { doc: "a", hold: false, global: false }),
            menu("plain-after", "plain"),
        ],
    },
];

/// `true` when this run collects context-menu evidence instead of measurements.
pub(crate) fn requested() -> bool {
    std::env::var(MODE_VARIABLE).is_ok_and(|mode| mode == MODE)
}

fn plan_document() -> serde_json::Value {
    PLANS
        .iter()
        .map(|plan| {
            serde_json::json!({
                "id":plan.view.id,
                "popups":match plan.popups { Popups::Tabs => "tabs", Popups::Block => "block" },
                "steps":plan.steps.iter().map(|step| match step.op {
                    Op::Menu { target, pick } => serde_json::json!({"id":step.id,"target":target,"pick":pick}),
                    _ => serde_json::json!({"id":step.id}),
                }).collect::<Vec<_>>()
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Fixture routes. A report carries what the fixture page chose to say about
// its own elements; nothing typed or pasted, no header text and no URL the
// fixture did not write itself.
// ---------------------------------------------------------------------------

// 64x48, five frames, VP8, no audio. Made once with:
// ffmpeg -f lavfi -i color=c=0x336699:s=64x48:r=5:d=1 -an -c:v libvpx -b:v 20k -g 5
//   -map_metadata -1 -fflags +bitexact -flags:v +bitexact menu-clip.webm
const CLIP_WEBM: &str = include_str!("../../fixtures/menu-clip.webm.b64");
// 16x16, one colour.
const IMAGE_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAABAAAAAQBPJcTWAAAAI0lEQVR4nGOckWLEQApgIUk1w6gG4gALkergYFQDMYDkUAIA/RcBbJ2qzKcAAAAASUVORK5CYII=";
const REPORT_KINDS: &[&str] = &["layout", "trace", "mouse-only", "left", "input", "move"];

pub(crate) struct Seen {
    pub received: Instant,
    pub body: serde_json::Value,
}

#[derive(Default)]
pub(crate) struct Server {
    pub reports: Vec<Seen>,
    pub rejected_reports: usize,
    /// Requests per fixture resource, named by this file only.
    pub served: BTreeMap<String, usize>,
    /// The report's `menu` object; present only in this mode.
    pub document: Option<serde_json::Value>,
}

impl Server {
    fn accept_report(&mut self, body: &[u8]) {
        let report = serde_json::from_slice::<serde_json::Value>(body).ok().filter(|report| {
            report["slot"].as_str().is_some_and(label_safe)
                && report["kind"].as_str().is_some_and(|kind| REPORT_KINDS.contains(&kind))
                && report["doc"].as_str().is_some_and(|doc| matches!(doc, "a" | "b" | "g"))
                && report["frame"].as_str().is_some_and(|frame| matches!(frame, "" | "same" | "cross"))
        });
        match report {
            Some(body) if self.reports.len() < 768 => self.reports.push(Seen {
                received: Instant::now(),
                body,
            }),
            _ => self.rejected_reports += 1,
        }
    }
}

pub(crate) fn serves(route: &str) -> bool {
    matches!(
        route,
        "/menu-page"
            | "/menu-frame"
            | "/menu-target"
            | "/menu-image.png"
            | "/menu-clip.webm"
            | "/menu-tone.wav"
            | "/menu-missing.webm"
            | "/menu-hold"
            | "/menu-report"
    )
}

fn parameter<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == name).then_some(value)
    })
}

/// A counter name built from this file's own words and at most one digit or
/// document letter of the query, never from other request text.
fn resource(route: &str, query: &str) -> String {
    let digit = |name| {
        parameter(query, name)
            .filter(|value| value.len() == 1 && value.bytes().all(|b| b.is_ascii_digit()))
            .unwrap_or("x")
    };
    match route {
        "/menu-page" => format!(
            "page-{}",
            parameter(query, "doc")
                .filter(|doc| matches!(*doc, "a" | "b" | "g"))
                .unwrap_or("x")
        ),
        "/menu-frame" => format!(
            "frame-{}",
            parameter(query, "frame")
                .filter(|frame| matches!(*frame, "same" | "cross"))
                .unwrap_or("x")
        ),
        "/menu-target" => format!("target-{}", digit("item")),
        "/menu-image.png" => format!("image-{}", digit("i")),
        "/menu-clip.webm" => "clip".into(),
        "/menu-tone.wav" => "tone".into(),
        "/menu-missing.webm" => "missing".into(),
        "/menu-hold" => "hold".into(),
        _ => "report".into(),
    }
}

fn decoded(text: &str) -> Vec<u8> {
    use base64::Engine;
    let text: String = text.split_whitespace().collect();
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap_or_default()
}

/// A quarter of a second of silence: 8 kHz, mono, 8-bit PCM.
fn tone() -> Vec<u8> {
    let samples = 2000u32;
    let mut wav = Vec::with_capacity(44 + samples as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + samples).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&8000u32.to_le_bytes());
    wav.extend_from_slice(&8000u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&8u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&samples.to_le_bytes());
    wav.resize(44 + samples as usize, 128);
    wav
}

pub(crate) async fn serve(
    mut tls: TlsStream,
    state: &Mutex<fixture::Observations>,
    route: &str,
    header: &str,
    body: &[u8],
) -> std::io::Result<Served> {
    let path = header
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("");
    let query = path.split_once('?').map_or("", |(_, query)| query);
    {
        let mut state = state.lock().unwrap();
        *state.measure.menu.served.entry(resource(route, query)).or_default() += 1;
    }
    let (status, kind, content): (&str, &str, Vec<u8>) = match route {
        "/menu-page" => (
            "200 OK",
            "text/html; charset=utf-8",
            include_bytes!("../../fixtures/menu-page.html").to_vec(),
        ),
        "/menu-frame" => (
            "200 OK",
            "text/html; charset=utf-8",
            include_bytes!("../../fixtures/menu-frame.html").to_vec(),
        ),
        "/menu-target" => (
            "200 OK",
            "text/html; charset=utf-8",
            include_bytes!("../../fixtures/menu-target.html").to_vec(),
        ),
        "/menu-image.png" => ("200 OK", "image/png", decoded(IMAGE_PNG)),
        "/menu-clip.webm" => ("200 OK", "video/webm", decoded(CLIP_WEBM)),
        "/menu-tone.wav" => ("200 OK", "audio/wav", tone()),
        "/menu-missing.webm" => ("404 Not Found", "text/plain", Vec::new()),
        // Never answered: the document that asked stays loading.
        "/menu-hold" => return Ok(Served::Held(Held { tls })),
        _ => {
            state.lock().unwrap().measure.menu.accept_report(body);
            ("200 OK", "application/json", b"{}".to_vec())
        }
    };
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        content.len()
    )
    .into_bytes();
    response.extend_from_slice(&content);
    tls.write_all(&response).await?;
    tls.shutdown().await?;
    Ok(Served::Measure)
}

// ---------------------------------------------------------------------------
// The probe's side: what the handler offered, and what it was answered.
// ---------------------------------------------------------------------------

type Row = (i32, &'static str, bool);

struct Answer {
    asked: Option<&'static str>,
    offered: bool,
    enabled: bool,
    /// The row id handed back to the probe; `None` cancels the menu.
    handed: Option<i32>,
    at: Instant,
}

impl Answer {
    fn selected(&self) -> Option<&'static str> {
        self.asked.filter(|_| self.handed.is_some() && self.enabled)
    }

    fn document(&self) -> serde_json::Value {
        serde_json::json!({
            "asked":self.asked,"offered":self.offered,"enabled":self.enabled,
            "handedBack":self.handed.is_some(),"withheld":self.asked.is_some_and(|row| NEVER_SELECTED.contains(&row))
        })
    }
}

/// What the probe is answered with. A row is handed back by its label, as the
/// handler offered it, even when it is disabled: the probe itself must refuse
/// that. A row this client must never select is not handed back at all.
fn answer(rows: &[Row], asked: Option<&'static str>) -> Answer {
    let row = asked.and_then(|label| rows.iter().find(|row| row.1 == label));
    let withheld = asked.is_some_and(|label| NEVER_SELECTED.contains(&label));
    Answer {
        asked,
        offered: row.is_some(),
        enabled: row.is_some_and(|row| row.2),
        handed: row.filter(|_| !withheld).map(|row| row.0),
        at: Instant::now(),
    }
}

struct Copied {
    text: String,
    clipboard: Option<u32>,
}

/// What the engine reported for one right-click, as the policy saw it. The
/// addresses are the fixture page's own.
struct Reported {
    link: String,
    shown_link: String,
    source: String,
    media: &'static str,
    edit_flags: u32,
    editable: bool,
    point: (i32, i32),
}

#[derive(Default)]
struct Probe {
    menus: Vec<Vec<Row>>,
    answers: Vec<Answer>,
    pick: Option<&'static str>,
    copied: Vec<Copied>,
    reported: Vec<Reported>,
}

// ---------------------------------------------------------------------------
// Where a target is. The page reports rectangles in CSS pixels of its own
// viewport; a framed document reports its own and the page reports the frame.
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Layout {
    rects: BTreeMap<String, [f64; 4]>,
    inner: [f64; 2],
    scroll: [f64; 2],
    received: Option<Instant>,
}

fn pair(value: &serde_json::Value) -> [f64; 2] {
    [value[0].as_f64().unwrap_or(0.0), value[1].as_f64().unwrap_or(0.0)]
}

impl Layout {
    fn read(report: &Seen) -> Self {
        let rects = report.body["rects"]
            .as_object()
            .map(|rects| {
                rects
                    .iter()
                    .filter(|(id, _)| label_safe(id))
                    .map(|(id, rect)| {
                        let side = |index: usize| rect[index].as_f64().unwrap_or(0.0);
                        (id.clone(), [side(0), side(1), side(2), side(3)])
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self {
            rects,
            inner: pair(&report.body["inner"]),
            scroll: pair(&report.body["scroll"]),
            received: Some(report.received),
        }
    }
}

#[derive(Debug, PartialEq)]
enum Located {
    /// Centre in the page's viewport, and in the target's own document.
    At((f64, f64), (f64, f64)),
    /// A layout report this target needs has not arrived.
    Missing(&'static str),
    Unusable(&'static str),
}

/// The document a target lives in ("" is the page) and the element that
/// frames it.
fn home(target: &str) -> (&'static str, Option<&'static str>) {
    if target.starts_with("xframe-") {
        ("cross", Some("frame-cross"))
    } else if target.starts_with("frame-") && !matches!(target, "frame-same" | "frame-cross") {
        ("same", Some("frame-same"))
    } else {
        ("", None)
    }
}

fn locate(layouts: &BTreeMap<&'static str, Layout>, target: &str) -> Located {
    let (frame, holder) = home(target);
    let Some(page) = layouts.get("") else {
        return Located::Missing("page");
    };
    let Some(own) = layouts.get(frame) else {
        return Located::Missing(frame);
    };
    let Some(rect) = own.rects.get(target) else {
        return Located::Unusable("target not in the reported layout");
    };
    let local = (rect[0] + rect[2] / 2.0, rect[1] + rect[3] / 2.0);
    let mut point = local;
    if let Some(holder) = holder {
        let Some(frame) = page.rects.get(holder) else {
            return Located::Unusable("frame not in the reported layout");
        };
        point = (point.0 + frame[0], point.1 + frame[1]);
    }
    let inside = |value: f64, limit: f64| value >= 1.0 && value <= limit - 1.0;
    if rect[2] < 4.0 || rect[3] < 4.0 || !inside(point.0, page.inner[0]) || !inside(point.1, page.inner[1])
    {
        return Located::Unusable("target outside the viewport");
    }
    Located::At(point, local)
}

/// View units per CSS pixel from one reported pointer move, or `None` when the
/// report cannot be the answer to the move that was sent.
fn calibration(sent: (i32, i32), seen: (f64, f64)) -> Option<f64> {
    if seen.0 <= 0.0 || seen.1 <= 0.0 {
        return None;
    }
    let (x, y) = (f64::from(sent.0) / seen.0, f64::from(sent.1) / seen.1);
    ((x - y).abs() <= 0.02 * x.max(y) && (0.2..=5.0).contains(&x)).then_some((x + y) / 2.0)
}

// ---------------------------------------------------------------------------
// Engine input, for one browser. CEF's own in-process methods only.
// ---------------------------------------------------------------------------

fn live_browsers() -> Vec<i32> {
    (1..=96)
        .filter(|id| browser_host_get_browser_by_identifier(*id).is_some())
        .collect()
}

fn press(engine: &Browser, at: (i32, i32), button: MouseButtonType, clicks: i32) -> bool {
    let Some(host) = engine.host().filter(|_| engine.is_valid() == 1) else {
        return false;
    };
    let held = if button == MouseButtonType::RIGHT {
        RIGHT_BUTTON_DOWN
    } else {
        LEFT_BUTTON_DOWN
    };
    for click in 1..=clicks {
        let down = MouseEvent {
            x: at.0,
            y: at.1,
            modifiers: held,
        };
        let up = MouseEvent {
            x: at.0,
            y: at.1,
            modifiers: 0,
        };
        host.send_mouse_click_event(Some(&down), button, 0, click);
        host.send_mouse_click_event(Some(&up), button, 1, click);
    }
    true
}

fn hover(engine: &Browser, at: (i32, i32)) -> bool {
    let Some(host) = engine.host().filter(|_| engine.is_valid() == 1) else {
        return false;
    };
    let pointer = MouseEvent {
        x: at.0,
        y: at.1,
        modifiers: 0,
    };
    host.send_mouse_move_event(Some(&pointer), 0);
    true
}

fn wheel(engine: &Browser, at: (i32, i32), delta: i32) -> bool {
    let Some(host) = engine.host().filter(|_| engine.is_valid() == 1) else {
        return false;
    };
    let pointer = MouseEvent {
        x: at.0,
        y: at.1,
        modifiers: 0,
    };
    host.send_mouse_wheel_event(Some(&pointer), 0, delta);
    true
}

fn key(engine: &Browser, code: i32) -> bool {
    let Some(host) = engine.host().filter(|_| engine.is_valid() == 1) else {
        return false;
    };
    for kind in [KeyEventType::RAWKEYDOWN, KeyEventType::KEYUP] {
        host.send_key_event(Some(&KeyEvent {
            type_: kind,
            windows_key_code: code,
            native_key_code: code,
            ..Default::default()
        }));
    }
    true
}

/// Which document the view shows, named and never quoted.
fn landed(engine: &Browser) -> &'static str {
    let url = engine
        .main_frame()
        .map(|frame| CefString::from(&frame.url()).to_string())
        .unwrap_or_default();
    if url.starts_with("https://fixture.test/menu-page?") {
        "fixture-page"
    } else if url.starts_with("about:blank") {
        "about:blank"
    } else if url.is_empty() {
        "none"
    } else {
        "other"
    }
}

// ---------------------------------------------------------------------------
// Scenario driver
// ---------------------------------------------------------------------------

/// What a selected row is then waited for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Effect {
    None,
    Tab,
    Document,
    Stopped,
    Edited,
    Selected,
}

fn effect(row: &str) -> Effect {
    match row {
        "Open link in new tab" | "Open image in new tab" | "Open video in new tab"
        | "Open audio in new tab" => Effect::Tab,
        "Back" | "Forward" | "Reload" => Effect::Document,
        "Stop loading" => Effect::Stopped,
        "Undo" | "Redo" | "Delete" => Effect::Edited,
        "Select all" => Effect::Selected,
        _ => Effect::None,
    }
}

#[derive(Default)]
struct Counters {
    requests: u64,
    menus: usize,
    copied: usize,
    reported: usize,
    tabs: Option<usize>,
    served: BTreeMap<String, usize>,
    clipboard: Option<u32>,
    loading: Option<bool>,
    documents: usize,
    lifecycle: String,
    layouts: usize,
    main_frame: &'static str,
}

struct Active {
    index: usize,
    started: Instant,
    mark: Instant,
    stage: u8,
    before: Counters,
    record: serde_json::Map<String, serde_json::Value>,
    /// Where the page should say the click landed, in the target's document.
    local: Option<(f64, f64)>,
    sent_at: Option<Instant>,
    requested_at: Option<Instant>,
    seen: bool,
    effect: Effect,
}

impl Active {
    fn set(&mut self, key: &str, value: impl Into<serde_json::Value>) {
        self.record.insert(key.into(), value.into());
    }

    fn note(&mut self, note: &'static str) {
        let notes = self
            .record
            .entry("notes")
            .or_insert_with(|| serde_json::json!([]));
        if let Some(notes) = notes.as_array_mut() {
            notes.push(note.into());
        }
    }

    fn next(&mut self, stage: u8) {
        self.stage = stage;
        self.mark = Instant::now();
    }
}

struct Turn<'a> {
    fixture: &'a fixture::Fixture,
    parent: &'a Arc<Window>,
    scale: f64,
}

struct Driver {
    plan: &'static Plan,
    slot: Slot,
    engine: Option<Browser>,
    probe: Rc<RefCell<Probe>>,
    requests: Arc<AtomicU64>,
    manual: Arc<Mutex<Vec<(String, String)>>>,
    capture: Option<String>,
    cursor: usize,
    inbox: Vec<serde_json::Value>,
    layouts: BTreeMap<&'static str, Layout>,
    layout_reports: usize,
    /// Layout reports received before this moment describe an older document.
    fresh_after: Option<Instant>,
    waited_for: Vec<&'static str>,
    /// View units per CSS pixel.
    scale: f64,
    calibrations: usize,
    navigated_at: Option<Instant>,
    next: usize,
    active: Option<Active>,
    steps: Vec<serde_json::Value>,
    record: serde_json::Map<String, serde_json::Value>,
    revoked: bool,
    /// Right-clicks in a row that neither the page nor the engine answered.
    unanswered: u8,
    finished_at: Option<Instant>,
}

impl Driver {
    fn start(run: &Run<'_, '_>, plan: &'static Plan) -> Result<Self> {
        let mut record = serde_json::Map::new();
        record.insert("id".into(), plan.view.id.into());
        record.insert(
            "popups".into(),
            match plan.popups {
                Popups::Tabs => "tabs",
                Popups::Block => "block",
            }
            .into(),
        );
        Ok(Self {
            plan,
            slot: Slot::start(run, &plan.view)?,
            engine: None,
            probe: Rc::new(RefCell::new(Probe::default())),
            requests: Arc::new(AtomicU64::new(0)),
            manual: Arc::new(Mutex::new(Vec::new())),
            capture: None,
            cursor: 0,
            inbox: Vec::new(),
            layouts: BTreeMap::new(),
            layout_reports: 0,
            fresh_after: None,
            waited_for: Vec::new(),
            scale: 1.0,
            calibrations: 0,
            navigated_at: None,
            next: 0,
            active: None,
            steps: Vec::new(),
            record,
            revoked: false,
            unanswered: 0,
            finished_at: None,
        })
    }

    fn url(&self, doc: &str, hold: bool, global: bool) -> String {
        format!(
            "{ORIGIN}/menu-page?slot={}&doc={doc}{}{}",
            self.plan.view.id,
            if hold { "&hold=1" } else { "" },
            if global { "&own=global" } else { "" }
        )
    }

    /// Context, browser, probe, popup policy and the first navigation.
    fn prepare(&mut self, turn: &Turn<'_>) -> Result<()> {
        let before = if self.slot.browser.is_none() {
            live_browsers()
        } else {
            Vec::new()
        };
        self.slot.advance(turn.parent, turn.scale)?;
        if self.engine.is_none() && self.slot.browser.is_some() {
            // The one browser that exists now and did not before this turn.
            let created: Vec<i32> = live_browsers()
                .into_iter()
                .filter(|id| !before.contains(id))
                .collect();
            let [id] = created[..] else {
                return Err("the scenario's own browser could not be identified".into());
            };
            let engine = browser_host_get_browser_by_identifier(id)
                .ok_or("the scenario's own browser disappeared")?;
            let matched = os::same_window(&engine, self.slot.child);
            if matched == Some(false) {
                return Err("the identified browser is not the scenario's child window".into());
            }
            self.record.insert("engineBrowserId".into(), id.into());
            self.record.insert("childWindowMatched".into(), matched.into());
            self.engine = Some(engine);
        }
        if self.slot.stage != Stage::Armed {
            return Ok(());
        }
        let Some(browser) = &self.slot.browser else {
            return Ok(());
        };
        // No right-click is sent to a view without the probe: with the
        // feature compiled in, such a view would show the OS popup.
        let (menus, sink) = (self.probe.clone(), self.probe.clone());
        browser.probe_context_menu(
            &self.slot.identity,
            self.requests.clone(),
            Box::new(move |rows: &[Row]| {
                let mut probe = menus.try_borrow_mut().ok()?;
                let answer = answer(rows, probe.pick.take());
                let handed = answer.handed;
                if probe.menus.len() < 512 {
                    probe.menus.push(rows.to_vec());
                    probe.answers.push(answer);
                }
                handed
            }),
            Box::new(move |text: &str| {
                if let Ok(mut probe) = sink.try_borrow_mut() {
                    if probe.copied.len() < 128 {
                        probe.copied.push(Copied {
                            text: text.chars().take(2048).collect(),
                            clipboard: os::clipboard_sequence(),
                        });
                    }
                }
            }),
        )?;
        self.record.insert("probeInstalled".into(), true.into());
        let reported = self.probe.clone();
        browser.observe_context_menu_targets(
            &self.slot.identity,
            Box::new(
                move |link: &str,
                      shown_link: &str,
                      source: &str,
                      media: &'static str,
                      edit_flags: u32,
                      editable: bool,
                      point: (i32, i32)| {
                    let Ok(mut probe) = reported.try_borrow_mut() else {
                        return;
                    };
                    if probe.reported.len() < 512 {
                        let kept = |text: &str| text.chars().take(2048).collect::<String>();
                        probe.reported.push(Reported {
                            link: kept(link),
                            shown_link: kept(shown_link),
                            source: kept(source),
                            media,
                            edit_flags,
                            editable,
                            point,
                        });
                    }
                },
            ),
        )?;
        browser.configure_popup_policy(match self.plan.popups {
            Popups::Tabs => NativePopupPolicy::Tabs,
            Popups::Block => NativePopupPolicy::Block,
        })?;
        let url = self.url("a", false, false);
        self.fresh_after = Some(Instant::now());
        self.slot.navigate(&url, turn.scale)?;
        self.navigated_at = Some(Instant::now());
        Ok(())
    }

    /// Reads the fixture's new reports: layouts are kept, the rest waits for
    /// the step that asked for it.
    fn absorb(&mut self, turn: &Turn<'_>) {
        // A selected Back, Forward or Reload replaces the document: only a
        // layout received after the probe was answered describes the new one.
        let replaced = self.active.as_ref().and_then(|active| {
            let probe = self.probe.try_borrow().ok()?;
            probe.answers[active.before.menus.min(probe.answers.len())..]
                .iter()
                .find(|answer| answer.selected().is_some_and(|row| effect(row) == Effect::Document))
                .map(|answer| answer.at)
        });
        if let Some(at) = replaced.filter(|at| self.fresh_after.is_none_or(|known| known < *at)) {
            self.replace_document(at);
        }
        let state = turn.fixture.observations.lock().unwrap();
        let reports = &state.measure.menu.reports;
        for report in &reports[self.cursor.min(reports.len())..] {
            if report.body["slot"] != self.plan.view.id {
                continue;
            }
            if report.body["kind"] != "layout" {
                if self.inbox.len() < 64 {
                    self.inbox.push(report.body.clone());
                }
                continue;
            }
            let frame = match report.body["frame"].as_str() {
                Some("same") => "same",
                Some("cross") => "cross",
                _ => "",
            };
            let loaded = matches!(report.body["reason"].as_str(), Some("ready" | "restored"));
            let stale = self.fresh_after.is_some_and(|after| report.received <= after);
            // Until the new page has reported itself, only a document that
            // has just loaded is believed.
            if stale || (!self.layouts.contains_key("") && !loaded) {
                continue;
            }
            if frame.is_empty() && loaded {
                for key in ["dpr", "inner", "focus", "visibility", "media", "global"] {
                    self.record
                        .entry("page")
                        .or_insert_with(|| serde_json::json!({}))[key] = report.body[key].clone();
                }
            }
            self.layouts.insert(frame, Layout::read(report));
            self.layout_reports += 1;
        }
        self.cursor = reports.len();
    }

    fn replace_document(&mut self, at: Instant) {
        self.fresh_after = Some(at);
        self.layouts
            .retain(|_, layout| layout.received.is_some_and(|received| received > at));
        self.waited_for.clear();
    }

    fn take(&mut self, kinds: &[&str]) -> Option<serde_json::Value> {
        let index = self
            .inbox
            .iter()
            .position(|report| report["kind"].as_str().is_some_and(|kind| kinds.contains(&kind)))?;
        Some(self.inbox.remove(index))
    }

    fn tabs(&self) -> Option<Vec<serde_json::Value>> {
        let inventory = self
            .slot
            .browser
            .as_ref()?
            .popup_inventory(&self.slot.identity)
            .ok()?;
        Some(
            inventory
                .views
                .iter()
                .map(|view| {
                    serde_json::json!({
                        "phase":format!("{:?}", view.phase),
                        "disposition":format!("{:?}", view.disposition),
                        "lifecycle":view.state.as_ref().map(|state| format!("{:?}", state.lifecycle)),
                        "loading":view.state.as_ref().map(|state| state.loading)
                    })
                })
                .collect(),
        )
    }

    fn counters(&self, turn: &Turn<'_>) -> Counters {
        let (menus, copied, reported) = self
            .probe
            .try_borrow()
            .map(|probe| (probe.menus.len(), probe.copied.len(), probe.reported.len()))
            .unwrap_or_default();
        let log = self.slot.log.lock().unwrap();
        Counters {
            requests: self.requests.load(Ordering::Relaxed),
            menus,
            copied,
            reported,
            tabs: self.tabs().map(|tabs| tabs.len()),
            served: turn
                .fixture
                .observations
                .lock()
                .unwrap()
                .measure
                .menu
                .served
                .clone(),
            clipboard: os::clipboard_sequence(),
            loading: log.last_loading,
            documents: log.main_documents,
            lifecycle: self
                .slot
                .browser
                .as_ref()
                .map(|browser| format!("{:?}", browser.lifecycle()))
                .unwrap_or_default(),
            layouts: self.layout_reports,
            main_frame: self.engine.as_ref().map_or("none", landed),
        }
    }

    fn point(&self, css: (f64, f64)) -> (i32, i32) {
        ((css.0 * self.scale).round() as i32, (css.1 * self.scale).round() as i32)
    }

    /// One turn of the loop. `Ok(true)` once every step has run.
    fn turn(&mut self, turn: &Turn<'_>) -> Result<bool> {
        if self.navigated_at.is_none() {
            self.prepare(turn)?;
            return Ok(false);
        }
        self.absorb(turn);
        if let Some(mut active) = self.active.take() {
            let over = active.started.elapsed() > STEP_LIMIT;
            if over {
                active.note("step deadline");
            }
            if over || self.poll(&mut active, turn)? {
                self.complete(active, turn);
                self.next += 1;
            } else {
                self.active = Some(active);
            }
            return Ok(false);
        }
        if self.next >= self.plan.steps.len() {
            return Ok(true);
        }
        // Input that reaches neither the page nor the engine is the result;
        // the remaining steps would only repeat it and are listed as not run.
        if self.unanswered >= 5 {
            self.record.insert("inputNotDelivered".into(), true.into());
            self.next = self.plan.steps.len();
            return Ok(true);
        }
        // Steps start when the page has reported its layout. A page that
        // never does is the result; its steps are then recorded as not run.
        if !self.layouts.contains_key("") && !self.revoked && self.steps.is_empty() {
            if self.navigated_at.is_some_and(|at| at.elapsed() < Duration::from_secs(20)) {
                return Ok(false);
            }
            self.record.insert("pageReady".into(), false.into());
            self.next = self.plan.steps.len();
            return Ok(true);
        }
        self.record.entry("pageReady").or_insert(true.into());
        let mut record = serde_json::Map::new();
        record.insert("id".into(), self.plan.steps[self.next].id.into());
        self.active = Some(Active {
            index: self.next,
            started: Instant::now(),
            mark: Instant::now(),
            stage: 0,
            before: self.counters(turn),
            record,
            local: None,
            sent_at: None,
            requested_at: None,
            seen: false,
            effect: Effect::None,
        });
        Ok(false)
    }

    fn poll(&mut self, active: &mut Active, turn: &Turn<'_>) -> Result<bool> {
        match self.plan.steps[active.index].op {
            Op::Calibrate => Ok(self.calibrate(active)),
            Op::Menu { target, pick } => Ok(self.menu(active, Some(target), pick, turn)),
            Op::MenuKey => Ok(self.menu(active, None, None, turn)),
            Op::Left { target, clicks } => Ok(self.left(active, target, clicks)),
            Op::Wheel { down } => Ok(self.scroll(active, down)),
            Op::Zoom { percent } => self.zoom(active, percent),
            Op::Block { blocked } => self.block(active, blocked, turn),
            Op::Show { shown } => self.show(active, shown),
            Op::ManualCapture => self.manual_capture(active),
            Op::ManualCancel => self.manual_cancel(active),
            Op::Load { doc, hold, global } => self.load(active, doc, hold, global),
            Op::CloseTabs => Ok(self.close_tabs(active)),
            Op::Idle => Ok(self.idle(active)),
            Op::Revoke => self.revoke(active),
        }
    }

    fn calibrate(&mut self, active: &mut Active) -> bool {
        if active.stage == 0 {
            self.calibrations += 1;
        }
        let point = CALIBRATION[(self.calibrations - 1) % CALIBRATION.len()];
        if active.stage == 0 {
            let sent = self.engine.as_ref().is_some_and(|engine| hover(engine, point));
            active.set("sent", serde_json::json!([point.0, point.1]));
            active.set("delivered", sent);
            active.next(1);
            return false;
        }
        while let Some(report) = self.take(&["move"]) {
            let seen = (
                report["x"].as_f64().unwrap_or(0.0),
                report["y"].as_f64().unwrap_or(0.0),
            );
            if let Some(scale) = calibration(point, seen) {
                self.scale = scale;
                active.set("seen", serde_json::json!([seen.0, seen.1]));
                active.set("viewUnitsPerCssPixel", scale);
                return true;
            }
        }
        if active.mark.elapsed() < Duration::from_secs(2) {
            return false;
        }
        active.note("the page reported no matching pointer move; scale unchanged");
        active.set("viewUnitsPerCssPixel", self.scale);
        true
    }

    /// The target's centre, waiting once for a layout report that is missing.
    fn find(&mut self, active: &mut Active, target: &'static str) -> Option<Option<((f64, f64), (f64, f64))>> {
        match locate(&self.layouts, target) {
            Located::At(point, local) => Some(Some((point, local))),
            Located::Missing(frame) if !self.waited_for.contains(&frame) => {
                if active.mark.elapsed() < LOCATE {
                    return None;
                }
                self.waited_for.push(frame);
                active.set("notSent", "no layout report for the target's document");
                Some(None)
            }
            Located::Missing(_) => {
                active.set("notSent", "no layout report for the target's document");
                Some(None)
            }
            Located::Unusable(reason) => {
                active.set("notSent", reason);
                Some(None)
            }
        }
    }

    fn watch(&mut self, active: &mut Active) {
        if active.requested_at.is_none() && self.requests.load(Ordering::Relaxed) > active.before.requests {
            active.requested_at = Some(Instant::now());
            if let Some(sent) = active.sent_at {
                active.set("requestWithinMs", sent.elapsed().as_millis() as u64);
            }
        }
    }

    fn menu(
        &mut self,
        active: &mut Active,
        target: Option<&'static str>,
        row: Option<&'static str>,
        turn: &Turn<'_>,
    ) -> bool {
        match active.stage {
            0 => {
                let place = match target {
                    Some(target) => match self.find(active, target) {
                        None => return false,
                        Some(None) => return true,
                        Some(place) => place,
                    },
                    None => None,
                };
                let Some(engine) = self.engine.clone() else {
                    active.set("notSent", "no browser");
                    return true;
                };
                if let Ok(mut probe) = self.probe.try_borrow_mut() {
                    probe.pick = row;
                }
                active.before = self.counters(turn);
                let delivered = match place {
                    Some((css, local)) => {
                        let at = self.point(css);
                        active.local = Some(local);
                        active.set("css", serde_json::json!([css.0, css.1]));
                        active.set("sent", serde_json::json!([at.0, at.1]));
                        press(&engine, at, MouseButtonType::RIGHT, 1)
                    }
                    None => key(&engine, KEY_CONTEXT_MENU),
                };
                active.set("delivered", delivered);
                active.sent_at = Some(Instant::now());
                active.next(1);
                false
            }
            // The page's own account of this click.
            1 => {
                self.watch(active);
                while let Some(report) = self.take(&["trace", "mouse-only"]) {
                    let here = active.local.is_none_or(|local| {
                        let off = |seen: &serde_json::Value, sent: f64| {
                            (seen.as_f64().unwrap_or(f64::MAX) - sent).abs() > 3.0
                        };
                        !off(&report["x"], local.0) && !off(&report["y"], local.1)
                    });
                    if !here {
                        active.note("a page report for another position was set aside");
                        continue;
                    }
                    let traced = report["kind"] == "trace";
                    active.set(if traced { "trace" } else { "mouseOnly" }, report);
                    active.seen = true;
                    break;
                }
                // A revoked attempt has no route left for the page's report.
                let limit = if self.revoked { ABSENCE } else { PAGE_WAIT };
                if active.seen || active.mark.elapsed() >= limit {
                    active.next(2);
                }
                false
            }
            2 => {
                self.watch(active);
                let quiet = match active.requested_at {
                    Some(at) => at.elapsed() >= SETTLE,
                    None => active.mark.elapsed() >= ABSENCE,
                };
                if !quiet {
                    return false;
                }
                active.effect = self
                    .probe
                    .try_borrow()
                    .ok()
                    .and_then(|probe| {
                        probe.answers[active.before.menus.min(probe.answers.len())..]
                            .iter()
                            .find_map(Answer::selected)
                    })
                    .map_or(Effect::None, effect);
                active.next(3);
                false
            }
            3 => match active.effect {
                Effect::None => true,
                Effect::Selected => active.mark.elapsed() >= SETTLE,
                Effect::Tab => {
                    let opened = self.tabs().map(|tabs| tabs.len()) != active.before.tabs;
                    if opened || active.mark.elapsed() >= Duration::from_secs(4) {
                        // Then long enough to see a second tab, were there one.
                        active.next(4);
                    }
                    false
                }
                Effect::Document => {
                    self.layouts.contains_key("") || active.mark.elapsed() >= Duration::from_secs(10)
                }
                Effect::Stopped => {
                    self.slot.log.lock().unwrap().last_loading == Some(false)
                        || active.mark.elapsed() >= Duration::from_secs(3)
                }
                Effect::Edited => {
                    self.inbox.iter().any(|report| report["kind"] == "input")
                        || active.mark.elapsed() >= Duration::from_millis(1200)
                }
            },
            _ => active.mark.elapsed() >= Duration::from_millis(1500),
        }
    }

    fn left(&mut self, active: &mut Active, target: &'static str, clicks: i32) -> bool {
        if active.stage == 0 {
            let Some(place) = self.find(active, target) else {
                return false;
            };
            let (Some((css, _)), Some(engine)) = (place, self.engine.clone()) else {
                return true;
            };
            let at = self.point(css);
            active.set("sent", serde_json::json!([at.0, at.1]));
            active.set("delivered", press(&engine, at, MouseButtonType::LEFT, clicks));
            active.next(1);
            return false;
        }
        while let Some(report) = self.take(&["left"]) {
            if report["detail"] == clicks {
                active.set("left", report);
                active.seen = true;
            }
        }
        (active.seen && active.mark.elapsed() >= Duration::from_millis(250))
            || active.mark.elapsed() >= Duration::from_millis(1500)
    }

    fn scroll(&mut self, active: &mut Active, down: bool) -> bool {
        let Some(engine) = self.engine.clone() else {
            return true;
        };
        let offset = |driver: &Self| driver.layouts.get("").map_or(0.0, |layout| layout.scroll[1]);
        let at = self.point(WHEEL);
        match active.stage {
            0 => {
                active.set("scrollBefore", offset(self));
                active.set("delivered", wheel(&engine, at, if down { -3000 } else { 3000 }));
                active.set("by", "wheel");
                active.next(1);
                false
            }
            1 | 3 => {
                if self.layout_reports > active.before.layouts && (offset(self) > 0.0) == down {
                    active.set("scrollAfter", offset(self));
                    return true;
                }
                if active.mark.elapsed() < Duration::from_millis(2500) {
                    return false;
                }
                if active.stage == 3 {
                    active.note("the page did not scroll");
                    active.set("scrollAfter", offset(self));
                    return true;
                }
                // The wheel did nothing: take focus out of any field with a
                // click on the empty page, then the End or Home key.
                press(&engine, at, MouseButtonType::LEFT, 1);
                active.next(2);
                false
            }
            _ => {
                if active.mark.elapsed() < Duration::from_millis(300) {
                    return false;
                }
                key(&engine, if down { KEY_END } else { KEY_HOME });
                active.set("by", "key");
                active.next(3);
                false
            }
        }
    }

    fn zoom(&mut self, active: &mut Active, percent: u16) -> Result<bool> {
        let inner = |driver: &Self| driver.layouts.get("").map_or([0.0; 2], |layout| layout.inner);
        if active.stage == 0 {
            let Some(browser) = &self.slot.browser else {
                return Ok(true);
            };
            active.set("innerBefore", serde_json::json!(inner(self)));
            let accepted = browser.zoom(&self.slot.identity, f64::from(percent)).is_ok();
            active.set("accepted", accepted);
            active.next(1);
            return Ok(!accepted);
        }
        let reported = self.layout_reports > active.before.layouts;
        if !reported && active.mark.elapsed() < Duration::from_millis(2500) {
            return Ok(false);
        }
        if !reported {
            active.note("the page reported no new layout");
        }
        active.set("innerAfter", serde_json::json!(inner(self)));
        Ok(true)
    }

    fn block(&mut self, active: &mut Active, blocked: bool, turn: &Turn<'_>) -> Result<bool> {
        if active.stage == 0 {
            let Some(browser) = &self.slot.browser else {
                return Ok(true);
            };
            let bounds = OriginBrowserBounds {
                x: 0.,
                y: 0.,
                width: self.plan.view.width,
                height: self.plan.view.height,
            };
            let accepted = browser
                .occlude(&self.slot.identity, bounds, &[], turn.scale, blocked)
                .is_ok();
            active.set("accepted", accepted);
            active.set("childWindow", shell::child_state(self.slot.child));
            active.next(1);
        }
        Ok(active.mark.elapsed() >= Duration::from_millis(200))
    }

    fn show(&mut self, active: &mut Active, shown: bool) -> Result<bool> {
        if active.stage == 0 {
            let Some(browser) = &self.slot.browser else {
                return Ok(true);
            };
            let accepted = if shown {
                browser.show(&self.slot.identity)
            } else {
                browser.hide(&self.slot.identity)
            }
            .is_ok();
            active.set("accepted", accepted);
            active.set("lifecycle", format!("{:?}", browser.lifecycle()));
            active.set("childWindow", shell::child_state(self.slot.child));
            active.next(1);
        }
        Ok(active.mark.elapsed() >= Duration::from_millis(200))
    }

    fn manual(&self, action: ManualInputAction) -> bool {
        let Some(browser) = &self.slot.browser else {
            return false;
        };
        let results = self.manual.clone();
        browser
            .manual_input(
                &self.slot.identity,
                &action,
                Arc::new(|| true),
                Box::new(move |result| {
                    let seen = match result {
                        Ok(response) => (response.status.to_owned(), response.capture_id),
                        // The host's two fixed refusals, named rather than quoted.
                        Err(reason) if reason.starts_with("Manual typing requires") => {
                            ("refused-field".into(), String::new())
                        }
                        Err(_) => ("refused-stale".into(), String::new()),
                    };
                    results.lock().unwrap().push(seen);
                }),
            )
            .is_ok()
    }

    /// Captures the focused empty field. A capture that has to wait for a
    /// field is repeated once after asking the host to focus the view.
    fn manual_capture(&mut self, active: &mut Active) -> Result<bool> {
        match active.stage {
            0 | 2 => {
                self.manual.lock().unwrap().clear();
                let accepted = self.manual(ManualInputAction::Capture {});
                active.set(if active.stage == 0 { "accepted" } else { "acceptedAgain" }, accepted);
                active.next(active.stage + 1);
                Ok(!accepted)
            }
            _ => {
                let result = self.manual.lock().unwrap().first().cloned();
                let Some((status, capture)) = result else {
                    if active.mark.elapsed() < Duration::from_secs(3) {
                        return Ok(false);
                    }
                    active.note("the capture was not answered");
                    return Ok(true);
                };
                let first = active.stage == 1;
                active.set(if first { "status" } else { "statusAgain" }, status.clone());
                if status == "captured" {
                    self.capture = Some(capture);
                    active.set("slotActive", true);
                    return Ok(true);
                }
                if !first {
                    return Ok(true);
                }
                let focused = self
                    .slot
                    .browser
                    .as_ref()
                    .is_some_and(|browser| browser.focus(&self.slot.identity).is_ok());
                active.set("focusAccepted", focused);
                active.next(2);
                Ok(false)
            }
        }
    }

    fn manual_cancel(&mut self, active: &mut Active) -> Result<bool> {
        if active.stage == 0 {
            let Some(capture) = self.capture.take() else {
                active.note("no capture to cancel");
                return Ok(true);
            };
            self.manual.lock().unwrap().clear();
            let accepted = self.manual(ManualInputAction::Cancel { capture_id: capture });
            active.set("accepted", accepted);
            active.next(1);
            return Ok(!accepted);
        }
        let results = self.manual.lock().unwrap().clone();
        if results.is_empty() && active.mark.elapsed() < Duration::from_secs(2) {
            return Ok(false);
        }
        active.set(
            "statuses",
            results.into_iter().map(|(status, _)| status).collect::<Vec<_>>(),
        );
        Ok(true)
    }

    fn load(&mut self, active: &mut Active, doc: &'static str, hold: bool, global: bool) -> Result<bool> {
        if active.stage == 0 {
            let Some(browser) = &self.slot.browser else {
                return Ok(true);
            };
            let url = self.url(doc, hold, global);
            let accepted = browser.navigate(&self.slot.identity, &url).is_ok();
            active.set("accepted", accepted);
            self.replace_document(Instant::now());
            active.next(1);
            return Ok(!accepted);
        }
        if self.layouts.contains_key("") {
            return Ok(true);
        }
        if active.mark.elapsed() < Duration::from_secs(12) {
            return Ok(false);
        }
        active.note("the document did not report itself");
        Ok(true)
    }

    fn close_tabs(&mut self, active: &mut Active) -> bool {
        let Some(browser) = &self.slot.browser else {
            return true;
        };
        if active.stage == 0 {
            let views: Vec<String> = browser
                .popup_inventory(&self.slot.identity)
                .map(|inventory| inventory.views.into_iter().map(|view| view.view_id).collect())
                .unwrap_or_default();
            let closed = views
                .iter()
                .filter(|view| browser.close_popup(&self.slot.identity, view).is_ok())
                .count();
            active.set("asked", views.len());
            active.set("accepted", closed);
            active.next(1);
            return false;
        }
        self.tabs().is_none_or(|tabs| tabs.is_empty()) || active.mark.elapsed() >= Duration::from_secs(5)
    }

    fn idle(&mut self, active: &mut Active) -> bool {
        let loading = self.slot.log.lock().unwrap().last_loading;
        if loading != Some(false) && active.mark.elapsed() < Duration::from_secs(15) {
            return false;
        }
        active.set("loading", loading);
        active.set("waitedMs", active.started.elapsed().as_millis() as u64);
        true
    }

    fn revoke(&mut self, active: &mut Active) -> Result<bool> {
        if active.stage == 0 {
            self.slot.finish()?;
            self.revoked = true;
            active.next(1);
        }
        Ok(active.mark.elapsed() >= Duration::from_millis(100))
    }

    fn complete(&mut self, mut active: Active, turn: &Turn<'_>) {
        let after = self.counters(turn);
        let before = &active.before;
        if matches!(self.plan.steps[active.index].op, Op::Menu { .. }) && active.sent_at.is_some() {
            let answered = active.seen || after.requests > before.requests;
            self.unanswered = if answered { 0 } else { self.unanswered + 1 };
        }
        let mut record = std::mem::take(&mut active.record);
        // A row asked for on a click that produced no menu must not be
        // handed to the next step's menu.
        if let Ok(mut probe) = self.probe.try_borrow_mut() {
            probe.pick = None;
        }
        if let Ok(probe) = self.probe.try_borrow() {
            let rows = |menu: &Vec<Row>| -> serde_json::Value {
                menu.iter()
                    .map(|row| serde_json::json!([row.0, row.1, row.2]))
                    .collect()
            };
            let (menus, copied, reported) = (
                before.menus.min(probe.menus.len()),
                before.copied.min(probe.copied.len()),
                before.reported.min(probe.reported.len()),
            );
            record.insert(
                "reported".into(),
                probe.reported[reported..]
                    .iter()
                    .map(|seen| {
                        serde_json::json!({
                            "link":seen.link,"shownLink":seen.shown_link,"source":seen.source,
                            "media":seen.media,"editFlags":seen.edit_flags,"editable":seen.editable,
                            "point":[seen.point.0, seen.point.1]
                        })
                    })
                    .collect(),
            );
            record.insert("menus".into(), probe.menus[menus..].iter().map(rows).collect());
            record.insert(
                "answers".into(),
                probe.answers[menus..].iter().map(Answer::document).collect(),
            );
            record.insert(
                "copied".into(),
                probe.copied[copied..]
                    .iter()
                    .map(|copied| {
                        serde_json::json!({"text":copied.text,"clipboardSequence":copied.clipboard})
                    })
                    .collect(),
            );
        }
        let served: serde_json::Map<String, serde_json::Value> = after
            .served
            .iter()
            .filter_map(|(name, count)| {
                let more = count - before.served.get(name).copied().unwrap_or(0).min(*count);
                (more > 0).then(|| (name.clone(), more.into()))
            })
            .collect();
        let others: Vec<serde_json::Value> = self.inbox.drain(..).collect();
        record.insert(
            "requests".into(),
            serde_json::json!({"before":before.requests,"after":after.requests}),
        );
        record.insert(
            "clipboardSequence".into(),
            serde_json::json!({"before":before.clipboard,"after":after.clipboard}),
        );
        record.insert(
            "tabs".into(),
            serde_json::json!({"before":before.tabs,"after":after.tabs,"views":self.tabs()}),
        );
        record.insert("served".into(), served.into());
        record.insert(
            "host".into(),
            serde_json::json!({
                "lifecycle":[before.lifecycle, after.lifecycle],
                "loading":[before.loading, after.loading],
                "mainDocuments":[before.documents, after.documents],
                "mainFrame":[before.main_frame, after.main_frame]
            }),
        );
        // What else the page said during this step: input and click reports.
        record.insert("pageReports".into(), others.into());
        record.insert(
            "elapsedMs".into(),
            (active.started.elapsed().as_millis() as u64).into(),
        );
        self.steps.push(record.into());
    }

    fn document(&mut self) -> serde_json::Value {
        let mut record = std::mem::take(&mut self.record);
        let run: Vec<&str> = self.steps.iter().filter_map(|step| step["id"].as_str()).collect();
        let not_run: Vec<&str> = self
            .plan
            .steps
            .iter()
            .map(|step| step.id)
            .filter(|id| !run.contains(id))
            .collect();
        record.insert("notRun".into(), not_run.into());
        record.insert("steps".into(), std::mem::take(&mut self.steps).into());
        record.insert("viewUnitsPerCssPixel".into(), self.scale.into());
        record.into()
    }
}

fn publish(fixture: &fixture::Fixture, scenarios: &[serde_json::Value], partial: Option<serde_json::Value>) {
    let mut state = fixture.observations.lock().unwrap();
    let (reports, rejected) = (state.measure.menu.reports.len(), state.measure.menu.rejected_reports);
    let served = state.measure.menu.served.clone();
    state.measure.menu.document = Some(serde_json::json!({
        "schema":1,"plan":plan_document(),"neverSelected":NEVER_SELECTED,
        "scenarios":scenarios,"inProgress":partial,
        "fixture":{"served":served,"reports":reports,"rejectedReports":rejected}
    }));
}

/// Runs every scenario in order. `Err` means the run stopped early at a point
/// where native shutdown is still safe. Failures collected here are failures
/// of the tool, never a statement about the menu.
pub(crate) fn run(run: &mut Run<'_, '_>, failures: &mut Vec<String>) -> Result<()> {
    let mut scenarios = Vec::new();
    publish(run.fixture, &scenarios, None);
    // Shows the runner that this process's stderr reaches it, which is where
    // the handler reports a command it could not run.
    eprintln!("CEF acceptance: context-menu evidence mode");
    // Shown without activation, disabled, and below every other window: the
    // run takes neither the keyboard nor the foreground, and covers nothing.
    os::lower(&run.parent);
    shell::present_inert(&run.parent);
    os::lower(&run.parent);
    for plan in &PLANS {
        run.fixture.observations.lock().unwrap().record(
            "menu-scenario-enter",
            serde_json::json!({"scenario":plan.view.id}),
        );
        let outcome = scenario(run, plan, &scenarios, failures);
        let stop = match outcome {
            Ok(record) => {
                scenarios.push(record);
                None
            }
            Err(error) => Some(error),
        };
        run.fixture.observations.lock().unwrap().record(
            "menu-scenario-return",
            serde_json::json!({"scenario":plan.view.id,"stopped":stop.is_some()}),
        );
        publish(run.fixture, &scenarios, None);
        run.fixture.write_progress(run.output, failures)?;
        if let Some(error) = stop {
            failures.push(format!("{}: {error}", plan.view.id));
            return Err("context-menu evidence run stopped early".into());
        }
    }
    Ok(())
}

fn scenario(
    run: &mut Run<'_, '_>,
    plan: &'static Plan,
    done: &[serde_json::Value],
    failures: &mut Vec<String>,
) -> Result<serde_json::Value> {
    let mut driver = Driver::start(run, plan)?;
    let (runtime, fixture, output, initialized) =
        (run.runtime, run.fixture, run.output, run.initialized);
    let parent = run.parent.clone();
    let scale = parent.scale_factor();
    let started = Instant::now();
    let window_at_start = shell::state(&parent, None);
    let clipboard_at_start = os::clipboard_sequence();
    let mut policy_read = false;
    let mut closed = false;
    let mut ever_foreground = false;
    // Every shown top-level window of this process other than the fixture
    // window, whenever that set changes: a dialog, inspector or popup the
    // run must not have opened would be listed here.
    let mut own_windows: Vec<serde_json::Value> = Vec::new();
    let mut own_seen = String::new();
    let mut own_checked = Instant::now();
    // Every change of which window of this process, if any, is the desktop's
    // foreground window. The fixture window is disabled and shown without
    // activation, but it is not the only window this process owns.
    let mut own_foreground: Vec<serde_json::Value> = Vec::new();
    let mut own_foreground_now: Option<String> = None;
    // Every change of the active and of the focused window of this thread,
    // the engine's UI thread. A desktop that receives no input has no
    // foreground window, but a thread still activates and focuses windows
    // there, so this shows what creating a view or a tab activates.
    let mut ui_windows: Vec<serde_json::Value> = Vec::new();
    let mut ui_windows_now = String::new();
    let mut last_snapshot = Instant::now();
    let mut published = 0;
    let mut stopped: Option<String> = None;
    run.events.run_return(|event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(5));
        if !matches!(event, Event::MainEventsCleared) {
            return;
        }
        let step = (|| -> Result<()> {
            runtime.work()?;
            match initialized.load(std::sync::atomic::Ordering::Acquire) {
                2 => {}
                3 => return Err("global test rejecting proxy installation failed".into()),
                _ => return Ok(()),
            }
            if !policy_read {
                if !super::super::observe_network_policy(runtime, fixture, "before-private-context")? {
                    return Err("production network policy not configured".into());
                }
                policy_read = true;
            }
            ever_foreground |= shell::foreground(&parent);
            let owner = shell::foreground_own(&parent);
            if owner != own_foreground_now && own_foreground.len() < 64 {
                own_foreground.push(serde_json::json!({
                    "duringStep":driver.active.as_ref().map(|active| plan.steps[active.index].id),
                    "atMs":started.elapsed().as_millis() as u64,"window":owner
                }));
                own_foreground_now = owner;
            }
            let held = os::ui_thread_windows(&parent);
            let names = held.to_string();
            if names != ui_windows_now && ui_windows.len() < 64 {
                ui_windows.push(serde_json::json!({
                    "duringStep":driver.active.as_ref().map(|active| plan.steps[active.index].id),
                    "atMs":started.elapsed().as_millis() as u64,"windows":held
                }));
                ui_windows_now = names;
            }
            if own_checked.elapsed() >= Duration::from_millis(40) {
                own_checked = Instant::now();
                let shown = os::other_shown_windows(&parent);
                let names = shown.to_string();
                if names != own_seen && own_windows.len() < 32 {
                    own_windows.push(serde_json::json!({
                        "duringStep":driver.active.as_ref().map(|active| plan.steps[active.index].id),
                        "atMs":started.elapsed().as_millis() as u64,"windows":shown
                    }));
                    own_seen = names;
                }
            }
            let turn = Turn {
                fixture,
                parent: &parent,
                scale,
            };
            if driver.finished_at.is_none() && driver.turn(&turn)? {
                if !driver.revoked {
                    driver.slot.finish()?;
                }
                driver.finished_at = Some(Instant::now());
            }
            if driver.steps.len() != published {
                // Kept current so a run that dies mid-way still leaves its steps.
                published = driver.steps.len();
                publish(
                    fixture,
                    done,
                    Some(serde_json::json!({"id":plan.view.id,"steps":driver.steps})),
                );
            }
            if driver.finished_at.is_some_and(|at| at.elapsed() > Duration::from_millis(500)) {
                if let Some(browser) = &driver.slot.browser {
                    browser.close(&driver.slot.identity)?;
                    if browser.lifecycle() == Lifecycle::Closed {
                        closed = true;
                        *flow = ControlFlow::Exit;
                    }
                }
            }
            if started.elapsed() > SCENARIO_LIMIT {
                return Err("native lifecycle deadline".into());
            }
            if last_snapshot.elapsed() >= Duration::from_secs(1) {
                fixture.write_progress(output, failures)?;
                last_snapshot = Instant::now();
            }
            Ok(())
        })();
        if let Err(error) = step {
            stopped = Some(error.to_string());
            *flow = ControlFlow::Exit;
        }
    });
    let mut record = driver.document();
    record["navigated"] = driver.navigated_at.is_some().into();
    record["closed"] = closed.into();
    record["elapsedMs"] = (started.elapsed().as_millis() as u64).into();
    record["window"] = serde_json::json!({
        "atStart":window_at_start,"atEnd":shell::state(&parent, None),
        "everForeground":ever_foreground,
        "foregroundOwnedByClient":own_foreground,
        "uiThreadWindows":ui_windows,
        "otherShownTopLevelWindows":own_windows
    });
    record["clipboard"] = serde_json::json!({
        "sequenceAtStart":clipboard_at_start,"sequenceAtEnd":os::clipboard_sequence()
    });
    if !closed && driver.slot.browser.is_some() {
        // Never call CEF shutdown with live references; terminate the process
        // at this failed boundary. The runner records the failure.
        failures.push(format!(
            "{}: {}",
            plan.view.id,
            stopped.as_deref().unwrap_or("browser did not close")
        ));
        let mut all = done.to_vec();
        all.push(record);
        publish(fixture, &all, None);
        fixture.write_report(output, failures)?;
        std::process::exit(3);
    }
    let (slot, session) = driver.slot.document();
    record["slot"] = slot;
    run.async_runtime.block_on(session.lock().unwrap().stop())?;
    match stopped {
        Some(error) => Err(error.into()),
        None => Ok(record),
    }
}

// ---------------------------------------------------------------------------
// Read-only views of the desktop, and the fixture window's place in the Z
// order. Nothing here opens the clipboard, sends input or activates a window.
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod os {
    use cef::{Browser, ImplBrowser, ImplBrowserHost};
    use std::ffi::c_void;
    use tao::window::Window;

    type Hwnd = *mut c_void;

    #[repr(C)]
    #[derive(Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct GuiThread {
        size: u32,
        flags: u32,
        active: Hwnd,
        focus: Hwnd,
        capture: Hwnd,
        menu_owner: Hwnd,
        move_size: Hwnd,
        caret: Hwnd,
        caret_rect: Rect,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThreadId() -> u32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetGUIThreadInfo(thread: u32, info: *mut GuiThread) -> i32;
        fn GetAncestor(window: Hwnd, flags: u32) -> Hwnd;
        fn GetClipboardSequenceNumber() -> u32;
        fn GetTopWindow(window: Hwnd) -> Hwnd;
        fn GetWindow(window: Hwnd, command: u32) -> Hwnd;
        fn IsWindowVisible(window: Hwnd) -> i32;
        fn GetWindowThreadProcessId(window: Hwnd, process: *mut u32) -> u32;
        fn GetClassNameW(window: Hwnd, name: *mut u16, capacity: i32) -> i32;
        fn GetWindowRect(window: Hwnd, rect: *mut Rect) -> i32;
        fn GetWindowLongPtrW(window: Hwnd, index: i32) -> isize;
        fn SetWindowPos(
            window: Hwnd,
            after: Hwnd,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
    }

    const GW_HWNDNEXT: u32 = 2;
    const GA_ROOT: u32 = 2;
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOPMOST: isize = 0x8;
    const WS_EX_NOACTIVATE: isize = 0x0800_0000;
    const HWND_BOTTOM: isize = 1;
    // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
    const KEEP_PLACE_AND_FOCUS: u32 = 0x1 | 0x2 | 0x10;

    /// Changes whenever any process writes the clipboard. Reading it does not
    /// open the clipboard, and it is the only thing asked of the clipboard.
    pub(super) fn clipboard_sequence() -> Option<u32> {
        Some(unsafe { GetClipboardSequenceNumber() })
    }

    fn handle(window: &Window) -> Option<Hwnd> {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        match window.window_handle().ok()?.as_raw() {
            RawWindowHandle::Win32(handle) => Some(handle.hwnd.get() as Hwnd),
            _ => None,
        }
    }

    /// Below every other top-level window, without activating anything.
    pub(super) fn lower(window: &Window) {
        let Some(window) = handle(window) else {
            return;
        };
        unsafe {
            SetWindowPos(
                window,
                HWND_BOTTOM as Hwnd,
                0,
                0,
                0,
                0,
                KEEP_PLACE_AND_FOCUS,
            );
        }
    }

    /// Shown top-level windows of this process other than the fixture
    /// window, by window class and size: any dialog, inspector or popup. A
    /// window title can carry page text and is never read.
    pub(super) fn other_shown_windows(fixture: &Window) -> serde_json::Value {
        let fixture = handle(fixture);
        let (mut shown, mut seen) = (Vec::new(), 0);
        let mut window = unsafe { GetTopWindow(std::ptr::null_mut()) };
        while !window.is_null() && seen < 8192 && shown.len() < 16 {
            let mut process = 0u32;
            unsafe { GetWindowThreadProcessId(window, &mut process) };
            if process == std::process::id()
                && Some(window) != fixture
                && unsafe { IsWindowVisible(window) } != 0
            {
                let mut name = [0u16; 64];
                let length = unsafe { GetClassNameW(window, name.as_mut_ptr(), 64) }.clamp(0, 64);
                let mut rect = Rect::default();
                unsafe { GetWindowRect(window, &mut rect) };
                let extended = unsafe { GetWindowLongPtrW(window, GWL_EXSTYLE) };
                shown.push(serde_json::json!({
                    "class":String::from_utf16_lossy(&name[..length as usize]),
                    "width":rect.right - rect.left,"height":rect.bottom - rect.top,
                    "topmost":extended & WS_EX_TOPMOST != 0,
                    "noActivate":extended & WS_EX_NOACTIVATE != 0
                }));
            }
            seen += 1;
            window = unsafe { GetWindow(window, GW_HWNDNEXT) };
        }
        shown.into()
    }

    pub(super) fn same_window(engine: &Browser, child: Option<isize>) -> Option<bool> {
        let child = child?;
        Some(engine.host()?.window_handle().0 as isize == child)
    }

    fn class(window: Hwnd) -> String {
        let mut name = [0u16; 64];
        let length = unsafe { GetClassNameW(window, name.as_mut_ptr(), 64) }.clamp(0, 64);
        String::from_utf16_lossy(&name[..length as usize])
    }

    /// The active and the focused window of the calling thread, by window
    /// class: which top-level window this thread has activated, and where its
    /// keyboard focus is. Read only; a window title is never read.
    pub(super) fn ui_thread_windows(fixture: &Window) -> serde_json::Value {
        let fixture = handle(fixture);
        let mut info = GuiThread {
            size: std::mem::size_of::<GuiThread>() as u32,
            flags: 0,
            active: std::ptr::null_mut(),
            focus: std::ptr::null_mut(),
            capture: std::ptr::null_mut(),
            menu_owner: std::ptr::null_mut(),
            move_size: std::ptr::null_mut(),
            caret: std::ptr::null_mut(),
            caret_rect: Rect::default(),
        };
        if unsafe { GetGUIThreadInfo(GetCurrentThreadId(), &mut info) } == 0 {
            return serde_json::Value::Null;
        }
        let named = |window: Hwnd| {
            if window.is_null() {
                serde_json::Value::Null
            } else if Some(window) == fixture {
                "fixture-window".into()
            } else {
                class(window).into()
            }
        };
        let under_fixture = !info.focus.is_null()
            && Some(unsafe { GetAncestor(info.focus, GA_ROOT) }) == fixture;
        serde_json::json!({
            "active":named(info.active),
            "activeShown":!info.active.is_null() && unsafe { IsWindowVisible(info.active) } != 0,
            "focus":named(info.focus),"focusInsideFixtureWindow":under_fixture
        })
    }
}

#[cfg(not(windows))]
mod os {
    use cef::Browser;
    use tao::window::Window;

    pub(super) fn clipboard_sequence() -> Option<u32> {
        None
    }

    pub(super) fn lower(_: &Window) {}

    pub(super) fn other_shown_windows(_: &Window) -> serde_json::Value {
        serde_json::Value::Null
    }

    pub(super) fn same_window(_: &Browser, _: Option<isize>) -> Option<bool> {
        None
    }

    pub(super) fn ui_thread_windows(_: &Window) -> serde_json::Value {
        serde_json::Value::Null
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The 23 fixed labels of the handler's policy (cef_context_menu_policy.rs).
    const LABELS: [&str; 23] = [
        "Open link in new tab",
        "Copy link address",
        "Open image in new tab",
        "Copy image address",
        "Open video in new tab",
        "Copy video address",
        "Open audio in new tab",
        "Copy audio address",
        "Back",
        "Forward",
        "Reload",
        "Stop loading",
        "Undo",
        "Redo",
        "Cut",
        "Copy",
        "Paste",
        "Paste as plain text",
        "Delete",
        "Select all",
        "Print",
        "Inspect",
        "Developer tools",
    ];

    #[test]
    fn plans_have_unique_safe_ids_and_select_only_rows_that_are_safe_to_run() {
        let mut views = Vec::new();
        for plan in &PLANS {
            assert!(label_safe(plan.view.id) && !views.contains(&plan.view.id));
            views.push(plan.view.id);
            assert_eq!(plan.view.adapter, Adapter::Manual);
            assert_eq!(plan.view.presentation, Presentation::Visible);
            let mut ids = Vec::new();
            for step in plan.steps {
                assert!(label_safe(step.id), "{}", step.id);
                assert!(!ids.contains(&step.id), "{}", step.id);
                ids.push(step.id);
                if let Op::Menu { target, pick } = step.op {
                    assert!(label_safe(target), "{target}");
                    if let Some(row) = pick {
                        assert!(LABELS.contains(&row), "{row}");
                        assert!(!NEVER_SELECTED.contains(&row), "{row}");
                    }
                }
            }
            // The pointer scale is learned before the first click.
            assert_eq!(plan.steps[0].op, Op::Calibrate);
        }
        for row in NEVER_SELECTED {
            assert!(LABELS.contains(row), "{row}");
        }
        // No OS dialog, no inspector window, and the clipboard is neither
        // written nor read into the page.
        let mut withheld = NEVER_SELECTED.to_vec();
        withheld.sort_unstable();
        assert_eq!(
            withheld,
            [
                "Copy",
                "Cut",
                "Developer tools",
                "Inspect",
                "Paste",
                "Paste as plain text",
                "Print"
            ]
        );
        // The page's own handling is bracketed by ordinary right-clicks on
        // the same document, and every refusal is followed by a recovery.
        let main: Vec<&str> = PLANS[0].steps.iter().map(|step| step.id).collect();
        let at = |id: &str| main.iter().position(|step| *step == id).unwrap();
        assert!(at("own-before") < at("own-prevent") && at("own-document") < at("own-after"));
        assert!(at("frame-plain") < at("frame-own") && at("frame-own") < at("frame-after"));
        for (refused, recovered) in [
            ("blocked", "unblocked"),
            ("hidden", "shown"),
            ("manual-active", "manual-ended"),
        ] {
            assert!(at(refused) < at(recovered));
        }
        assert_eq!(*main.last().unwrap(), "revoked");
    }

    #[test]
    fn the_probe_is_never_handed_a_row_that_opens_a_window_or_writes_the_clipboard() {
        let rows: Vec<Row> = LABELS
            .iter()
            .enumerate()
            .map(|(index, label)| (26_500 + index as i32, *label, *label != "Forward"))
            .collect();
        for label in LABELS {
            let answer = answer(&rows, Some(label));
            assert!(answer.offered);
            assert_eq!(answer.handed.is_none(), NEVER_SELECTED.contains(&label), "{label}");
            assert_eq!(answer.document()["withheld"], NEVER_SELECTED.contains(&label));
        }
        // A disabled row is handed back for the probe itself to refuse, and
        // is never counted as selected.
        let forward = answer(&rows, Some("Forward"));
        assert!(forward.handed.is_some() && !forward.enabled && forward.selected().is_none());
        assert_eq!(answer(&rows, Some("Reload")).selected(), Some("Reload"));
        // No request, or a row that was not offered, cancels the menu.
        assert!(answer(&rows, None).handed.is_none());
        let missing = answer(&rows[..4], Some("Reload"));
        assert!(!missing.offered && missing.handed.is_none() && missing.selected().is_none());
        assert_eq!(effect("Open image in new tab"), Effect::Tab);
        assert_eq!(effect("Copy link address"), Effect::None);
    }

    fn layout(rects: &[(&str, [f64; 4])]) -> Layout {
        Layout {
            rects: rects.iter().map(|(id, rect)| ((*id).to_owned(), *rect)).collect(),
            inner: [783.0, 600.0],
            scroll: [0.0, 0.0],
            received: Some(Instant::now()),
        }
    }

    #[test]
    fn a_target_is_located_through_its_frame_and_only_inside_the_viewport() {
        let mut layouts = BTreeMap::new();
        assert_eq!(locate(&layouts, "plain"), Located::Missing("page"));
        layouts.insert(
            "",
            layout(&[
                ("plain", [10.0, 10.0, 120.0, 44.0]),
                ("frame-same", [10.0, 310.0, 380.0, 140.0]),
                ("frame-cross", [400.0, 310.0, 380.0, 140.0]),
                ("link-low", [10.0, 920.0, 120.0, 44.0]),
                ("gone", [10.0, 60.0, 0.0, 0.0]),
            ]),
        );
        assert_eq!(locate(&layouts, "plain"), Located::At((70.0, 32.0), (70.0, 32.0)));
        assert_eq!(locate(&layouts, "frame-same"), Located::At((200.0, 380.0), (200.0, 380.0)));
        assert_eq!(locate(&layouts, "frame-link"), Located::Missing("same"));
        assert_eq!(locate(&layouts, "xframe-link"), Located::Missing("cross"));
        for target in ["link-low", "gone"] {
            assert_eq!(
                locate(&layouts, target),
                Located::Unusable("target outside the viewport"),
                "{target}"
            );
        }
        assert_eq!(
            locate(&layouts, "unknown"),
            Located::Unusable("target not in the reported layout")
        );
        layouts.insert("same", layout(&[("frame-link", [98.0, 10.0, 85.0, 44.0])]));
        layouts.insert("cross", layout(&[("xframe-link", [98.0, 10.0, 85.0, 44.0])]));
        // Frame-local centre plus the frame's place in the page.
        assert_eq!(
            locate(&layouts, "frame-link"),
            Located::At((150.5, 342.0), (140.5, 32.0))
        );
        assert_eq!(
            locate(&layouts, "xframe-link"),
            Located::At((540.5, 342.0), (140.5, 32.0))
        );
    }

    #[test]
    fn calibration_accepts_only_a_report_that_can_answer_the_move_that_was_sent() {
        assert_eq!(calibration((500, 285), (500.0, 285.0)), Some(1.0));
        // A view zoomed to 125 %: the page sees fewer CSS pixels.
        let zoomed = calibration((500, 285), (400.0, 228.0)).unwrap();
        assert!((zoomed - 1.25).abs() < 0.001);
        // A move from somewhere else, an impossible scale, and no position.
        for seen in [(70.0, 32.0), (5000.0, 2850.0), (0.0, 0.0)] {
            assert_eq!(calibration((500, 285), seen), None, "{seen:?}");
        }
    }

    #[test]
    fn page_reports_are_labelled_bounded_and_counted_without_request_text() {
        let mut server = Server::default();
        for body in [
            &br#"{"slot":"menu-main","doc":"a","frame":"","kind":"trace","target":"plain"}"#[..],
            br#"{"slot":"menu-main","doc":"a","frame":"cross","kind":"layout","rects":{}}"#,
            br#"{"slot":"Menu Main","doc":"a","frame":"","kind":"trace"}"#,
            br#"{"slot":"menu-main","doc":"z","frame":"","kind":"trace"}"#,
            br#"{"slot":"menu-main","doc":"a","frame":"top","kind":"trace"}"#,
            br#"{"slot":"menu-main","doc":"a","frame":"","kind":"clipboard"}"#,
            b"not json",
        ] {
            server.accept_report(body);
        }
        assert_eq!((server.reports.len(), server.rejected_reports), (2, 5));
        for _ in 0..800 {
            server.accept_report(br#"{"slot":"menu-main","doc":"a","frame":"","kind":"move"}"#);
        }
        assert_eq!(server.reports.len(), 768);
        for (route, query, name) in [
            ("/menu-page", "slot=menu-main&doc=b&hold=1", "page-b"),
            ("/menu-page", "doc=%3Cscript%3E", "page-x"),
            ("/menu-frame", "slot=menu-main&doc=a&frame=cross", "frame-cross"),
            ("/menu-target", "item=7&q=a%20b", "target-7"),
            ("/menu-target", "item=77", "target-x"),
            ("/menu-image.png", "i=2", "image-2"),
            ("/menu-hold", "slot=menu-main", "hold"),
            ("/menu-report", "", "report"),
        ] {
            assert!(serves(route), "{route}");
            assert_eq!(resource(route, query), name);
        }
        for route in ["/", "/menu", "/menu-page.html", "/measure-report", "/proof"] {
            assert!(!serves(route), "{route}");
        }
    }

    #[test]
    fn fixture_media_are_what_their_content_types_say() {
        let wav = tone();
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(wav[4..8].try_into().unwrap()) as usize, wav.len() - 8);
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()) as usize, wav.len() - 44);
        assert_eq!(&decoded(IMAGE_PNG)[..8], b"\x89PNG\r\n\x1a\n");
        // EBML magic of a WebM container.
        let clip = decoded(CLIP_WEBM);
        assert_eq!(&clip[..4], [0x1A, 0x45, 0xDF, 0xA3]);
        assert!(clip.len() < 4096);
    }

    #[test]
    fn every_target_in_the_plans_exists_in_a_fixture_page() {
        let page = include_str!("../../fixtures/menu-page.html");
        let frame = include_str!("../../fixtures/menu-frame.html");
        for plan in &PLANS {
            for step in plan.steps {
                let target = match step.op {
                    Op::Menu { target, .. } | Op::Left { target, .. } => target,
                    _ => continue,
                };
                let (document, holder) = home(target);
                let (source, id) = match holder {
                    None => (page, target),
                    Some(_) => (frame, target.split_once('-').unwrap().1),
                };
                assert!(source.contains(&format!("id=\"{id}\"")), "{target} ({document})");
            }
        }
    }
}
