//! Opt-in real-engine measurements for hidden, blocked, concurrent and
//! background logins and for relay capacity. Observations only: nothing here
//! grants acceptance or production readiness, and a login that does not
//! complete is a result to record, not a failure of this client.
use super::{fixture, Result};
use sorng_browser_host::{
    cef_browser::{
        BrowserEvent, BrowserEventSink, CefBrowserHost, NativeDocumentHooks, NativeNavigationStatus,
    },
    cef_context::{PreparationStatus, PrivateRequestContext},
    cef_runtime::CefRuntime,
    control::{Lifecycle, ViewportBounds},
    domain_permissions::{WebsitePermissionDecision, WebsitePermissionEngine, WebsiteRequestClass},
    ipc::OriginBrowserBounds,
    native_features::{
        NativeFeatureStatus, NativeLoginAdapter, NativeLoginCredentials, NativeLoginRequest,
        NativeLoginStage,
    },
};
use sorng_protocols::{
    origin_browser::{
        BrowserIdentity, NativeHostReadiness, OriginBrowserPolicy, OriginBrowserSession,
    },
    private_forward_proxy::{Authority, BoxedStream, DialFuture, ProxyLimits, RouteDialer},
};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tao::{
    event::Event,
    event_loop::{ControlFlow, EventLoop},
    platform::run_return::EventLoopExtRunReturn,
    window::Window,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// Context-menu evidence: the same client, window and fixture server, its own
// scenarios. A child module so that it shares the inert fixture window.
pub(crate) mod menu;

pub(crate) const MODE_VARIABLE: &str = "SORNG_CEF_ACCEPTANCE_MODE";
const WINDOW_VARIABLE: &str = "SORNG_CEF_MEASURE_WINDOW_MS";
const ONLY_VARIABLE: &str = "SORNG_CEF_MEASURE_ONLY";
const ORIGIN: &str = "https://fixture.test";
const USERNAME: &str = "synthetic@example.test";
const PASSWORD: &str = "synthetic-local-only";
// The app's attempt-scoped login consent (CONSENT_LIFETIME in
// src-tauri/src/origin_browser_login.rs). The three acceptance attempts grant
// two seconds; here the production budgets must be what limits a login.
const CONSENT_LIFETIME: Duration = Duration::from_secs(600);
// Shape and defaults of a saved "custom" form profile, as built by
// saved_form_configuration in src-tauri/src/origin_browser_authority.rs.
const FORM_SETUP: &str = r#"{"selectors":{"username":"input[name=\"username\"]","password":"input[name=\"password\"]","submit":"button[type=\"submit\"]"},"readiness":{"detectionTimeoutMs":8000}}"#;
const FORM_OPTIONS: &str = r#"{"version":1,"fillDelayMs":0,"submitDelayMs":0,"detectionTimeoutMs":8000,"submit":true,"fields":[]}"#;
const CAPACITY_SOCKETS: usize = 40;
const CAPACITY_HOLDS_PER_HOST: usize = 6;
// The cap the second capacity scenario gives its own relay: what the default
// was before the relay was sized to the engine's socket pools, and fewer than
// that scenario's page opens. The default itself is never assumed here.
const CAPACITY_SMALL_CAP: usize = 32;
const SHOWN_BEFORE_HIDE: Duration = Duration::from_millis(700);
const REPORT_GRACE: Duration = Duration::from_secs(6);
const SCENARIO_SLACK: Duration = Duration::from_secs(35);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Presentation {
    Visible,
    VisibleInputBlocked,
    HiddenAfterAttach,
    BornHidden,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Shell {
    AsLaunched,
    Inactive,
    Covered,
    Minimized,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Page {
    Login,
    Capacity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Adapter {
    /// The native key pipeline (FormPrepare, Form, FormSubmit).
    ModularForm,
    /// Value assignment in page script; sends no key events.
    Generic,
    Manual,
}

/// A presentation change late in the window, to observe the transition itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Flip {
    None,
    HideLate,
    ShowLate,
}

pub(crate) struct SlotPlan {
    pub id: &'static str,
    pub presentation: Presentation,
    pub width: f64,
    pub height: f64,
    pub adapter: Adapter,
    pub flip: Flip,
    /// `None` leaves the relay at its default client cap.
    pub relay_clients: Option<usize>,
}

pub(crate) struct ScenarioPlan {
    pub id: &'static str,
    pub shell: Shell,
    pub page: Page,
    /// Two and a half windows, to show throttling that starts late.
    pub long_window: bool,
    pub slots: &'static [SlotPlan],
}

const fn login(id: &'static str, presentation: Presentation, flip: Flip) -> SlotPlan {
    SlotPlan {
        id,
        presentation,
        width: 800.0,
        height: 600.0,
        adapter: Adapter::ModularForm,
        flip,
        relay_clients: None,
    }
}

// Scenarios (a)-(f) in run order. MEASUREMENT_SCENARIOS in
// scripts/cef-browser-acceptance.mjs mirrors this table and a tooling test
// compares the two. The (e) scenarios run last: they change the window state.
pub(crate) const SCENARIOS: &[ScenarioPlan] = &[
    ScenarioPlan {
        id: "baseline-visible",
        shell: Shell::AsLaunched,
        page: Page::Login,
        long_window: false,
        slots: &[login("baseline-visible", Presentation::Visible, Flip::HideLate)],
    },
    ScenarioPlan {
        id: "a-hidden-after-attach",
        shell: Shell::AsLaunched,
        page: Page::Login,
        long_window: false,
        slots: &[login("a-hidden-after-attach", Presentation::HiddenAfterAttach, Flip::ShowLate)],
    },
    ScenarioPlan {
        id: "b-born-hidden-1x1",
        shell: Shell::AsLaunched,
        page: Page::Login,
        long_window: false,
        slots: &[SlotPlan {
            id: "b-born-hidden-1x1",
            presentation: Presentation::BornHidden,
            width: 1.0,
            height: 1.0,
            adapter: Adapter::ModularForm,
            flip: Flip::None,
            relay_clients: None,
        }],
    },
    ScenarioPlan {
        id: "b-born-hidden-1280x800",
        shell: Shell::AsLaunched,
        page: Page::Login,
        long_window: true,
        slots: &[SlotPlan {
            id: "b-born-hidden-1280x800",
            presentation: Presentation::BornHidden,
            width: 1280.0,
            height: 800.0,
            adapter: Adapter::ModularForm,
            flip: Flip::None,
            relay_clients: None,
        }],
    },
    ScenarioPlan {
        id: "b-born-hidden-generic",
        shell: Shell::AsLaunched,
        page: Page::Login,
        long_window: false,
        slots: &[SlotPlan {
            id: "b-born-hidden-generic",
            presentation: Presentation::BornHidden,
            width: 1280.0,
            height: 800.0,
            adapter: Adapter::Generic,
            flip: Flip::None,
            relay_clients: None,
        }],
    },
    ScenarioPlan {
        id: "c-visible-input-blocked",
        shell: Shell::AsLaunched,
        page: Page::Login,
        long_window: false,
        slots: &[login("c-visible-input-blocked", Presentation::VisibleInputBlocked, Flip::None)],
    },
    ScenarioPlan {
        id: "d-concurrent",
        shell: Shell::AsLaunched,
        page: Page::Login,
        long_window: false,
        slots: &[
            login("d-visible", Presentation::Visible, Flip::None),
            login("d-hidden-after-attach", Presentation::HiddenAfterAttach, Flip::None),
            login("d-born-hidden", Presentation::BornHidden, Flip::None),
        ],
    },
    ScenarioPlan {
        id: "f-relay-capacity",
        shell: Shell::AsLaunched,
        page: Page::Capacity,
        long_window: false,
        slots: &[SlotPlan {
            id: "f-relay-capacity",
            presentation: Presentation::Visible,
            width: 800.0,
            height: 600.0,
            adapter: Adapter::Manual,
            flip: Flip::None,
            relay_clients: None,
        }],
    },
    // The same page through a relay whose cap the fixture sets below what
    // the page opens: the refusal path, whatever the default is.
    ScenarioPlan {
        id: "f-relay-capacity-capped",
        shell: Shell::AsLaunched,
        page: Page::Capacity,
        long_window: false,
        slots: &[SlotPlan {
            id: "f-relay-capacity-capped",
            presentation: Presentation::Visible,
            width: 800.0,
            height: 600.0,
            adapter: Adapter::Manual,
            flip: Flip::None,
            relay_clients: Some(CAPACITY_SMALL_CAP),
        }],
    },
    ScenarioPlan {
        id: "e-inactive",
        shell: Shell::Inactive,
        page: Page::Login,
        long_window: false,
        slots: &[login("e-inactive", Presentation::Visible, Flip::None)],
    },
    ScenarioPlan {
        id: "e-covered",
        shell: Shell::Covered,
        page: Page::Login,
        long_window: false,
        slots: &[login("e-covered", Presentation::Visible, Flip::None)],
    },
    ScenarioPlan {
        id: "e-minimized-hidden",
        shell: Shell::Minimized,
        page: Page::Login,
        long_window: false,
        slots: &[login("e-minimized-hidden", Presentation::BornHidden, Flip::None)],
    },
];

impl Presentation {
    fn label(self) -> &'static str {
        match self {
            Self::Visible => "visible",
            Self::VisibleInputBlocked => "visible-input-blocked",
            Self::HiddenAfterAttach => "hidden-after-attach",
            Self::BornHidden => "born-hidden",
        }
    }
}

impl Shell {
    fn label(self) -> &'static str {
        match self {
            Self::AsLaunched => "as-launched",
            Self::Inactive => "inactive",
            Self::Covered => "covered",
            Self::Minimized => "minimized",
        }
    }
}

impl Page {
    fn label(self) -> &'static str {
        match self {
            Self::Login => "login",
            Self::Capacity => "capacity",
        }
    }
}

impl Adapter {
    fn label(self) -> &'static str {
        match self {
            Self::ModularForm => "modular-form",
            Self::Generic => "generic",
            Self::Manual => "manual",
        }
    }
}

impl Flip {
    fn label(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::HideLate => "hide-late",
            Self::ShowLate => "show-late",
        }
    }
}

fn label_safe(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 48
        && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `Ok(false)` for an ordinary acceptance run. An unknown value is an error:
/// a typo must not silently run the other mode. `menu` selects the
/// context-menu evidence scenarios, which share this mode's window.
pub(crate) fn requested() -> Result<bool> {
    match std::env::var(MODE_VARIABLE) {
        Err(std::env::VarError::NotPresent) => Ok(false),
        Ok(mode) if mode.is_empty() || mode == "acceptance" => Ok(false),
        Ok(mode) if mode == "measure" || mode == "menu" => Ok(true),
        _ => Err("unknown acceptance mode".into()),
    }
}

fn window_ms(value: Option<&str>) -> Result<u64> {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return Ok(12_000);
    };
    value
        .parse::<u64>()
        .ok()
        .filter(|ms| (5_000..=40_000).contains(ms))
        .ok_or_else(|| "measurement window must be 5000..40000 ms".into())
}

fn only(value: Option<&str>) -> Result<Option<Vec<&'static str>>> {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let mut selected = Vec::new();
    for id in value.split(',') {
        let plan = SCENARIOS
            .iter()
            .find(|plan| plan.id == id)
            .ok_or("unknown measurement scenario")?;
        if !selected.contains(&plan.id) {
            selected.push(plan.id);
        }
    }
    Ok(Some(selected))
}

// ---------------------------------------------------------------------------
// Fixture routes. Reports carry counts, sizes and times chosen by the fixture
// page; nothing typed, no header text and no URL is retained.
// ---------------------------------------------------------------------------

pub(crate) struct Report {
    pub slot: String,
    pub kind: String,
    pub received: Instant,
    pub body: serde_json::Value,
}

pub(crate) struct ServerState {
    pub reports: Vec<Report>,
    pub rejected_reports: usize,
    pub requests: usize,
    pub holds_accepted: usize,
    pub sockets_accepted: usize,
    pub socket_handshakes_rejected: usize,
    pub held_now: usize,
    pub held_peak: usize,
    pub held_released: usize,
    pub held_peer_closed: usize,
    pub held_deadline: usize,
    release: tokio::sync::watch::Sender<u64>,
    /// The report's `measurements` object; present only in measurement mode.
    pub document: Option<serde_json::Value>,
    pub menu: menu::Server,
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            reports: Vec::new(),
            rejected_reports: 0,
            requests: 0,
            holds_accepted: 0,
            sockets_accepted: 0,
            socket_handshakes_rejected: 0,
            held_now: 0,
            held_peak: 0,
            held_released: 0,
            held_peer_closed: 0,
            held_deadline: 0,
            release: tokio::sync::watch::channel(0).0,
            document: None,
            menu: menu::Server::default(),
        }
    }
}

impl ServerState {
    fn accept_report(&mut self, body: &[u8]) {
        let report = serde_json::from_slice::<serde_json::Value>(body).ok();
        let labels = report.as_ref().and_then(|report| {
            let slot = report["slot"].as_str().filter(|slot| label_safe(slot))?;
            let kind = report["kind"]
                .as_str()
                .filter(|kind| matches!(*kind, "sample" | "mid" | "login" | "final"))?;
            Some((slot.to_owned(), kind.to_owned()))
        });
        match (report, labels) {
            (Some(body), Some((slot, kind))) if self.reports.len() < 128 => {
                self.reports.push(Report {
                    slot,
                    kind,
                    received: Instant::now(),
                    body,
                })
            }
            _ => self.rejected_reports += 1,
        }
    }

    fn reset_capacity(&mut self) {
        self.holds_accepted = 0;
        self.sockets_accepted = 0;
        self.socket_handshakes_rejected = 0;
        self.held_peak = self.held_now;
        self.held_released = 0;
        self.held_peer_closed = 0;
        self.held_deadline = 0;
    }

    fn release_held(&self) {
        self.release.send_modify(|generation| *generation += 1);
    }

    fn capacity(&self) -> serde_json::Value {
        serde_json::json!({
            "socketsAccepted":self.sockets_accepted,"holdsAccepted":self.holds_accepted,
            "socketHandshakesRejected":self.socket_handshakes_rejected,
            "heldNow":self.held_now,"heldPeak":self.held_peak,"heldReleased":self.held_released,
            "heldPeerClosed":self.held_peer_closed,"heldDeadline":self.held_deadline
        })
    }
}

type TlsStream = tokio_rustls::server::TlsStream<tokio::net::TcpStream>;

pub(crate) struct Held {
    tls: TlsStream,
}

pub(crate) enum Served {
    Legacy,
    Measure,
    Held(Held),
}

pub(crate) fn serves(route: &str) -> bool {
    matches!(
        route,
        "/measure-login" | "/measure-capacity" | "/measure-report" | "/measure-hold" | "/measure-socket"
    ) || menu::serves(route)
}

pub(crate) async fn serve(
    mut tls: TlsStream,
    state: &Mutex<fixture::Observations>,
    route: &str,
    header: &str,
    body: &[u8],
) -> std::io::Result<Served> {
    if menu::serves(route) {
        return menu::serve(tls, state, route, header, body).await;
    }
    state.lock().unwrap().measure.requests += 1;
    let page = match route {
        "/measure-login" => include_str!("../fixtures/measure-login.html"),
        "/measure-capacity" => include_str!("../fixtures/measure-capacity.html"),
        "/measure-report" => {
            state.lock().unwrap().measure.accept_report(body);
            "{}"
        }
        "/measure-hold" => {
            state.lock().unwrap().measure.holds_accepted += 1;
            return Ok(Served::Held(Held { tls }));
        }
        _ => {
            let Some(accept) = websocket_accept(header) else {
                state.lock().unwrap().measure.socket_handshakes_rejected += 1;
                tls.write_all(
                    b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await?;
                tls.shutdown().await?;
                return Ok(Served::Measure);
            };
            tls.write_all(
                format!(
                    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
                )
                .as_bytes(),
            )
            .await?;
            tls.flush().await?;
            state.lock().unwrap().measure.sockets_accepted += 1;
            return Ok(Served::Held(Held { tls }));
        }
    };
    tls.write_all(
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
            page.len()
        )
        .as_bytes(),
    )
    .await?;
    tls.shutdown().await?;
    Ok(Served::Measure)
}

impl Held {
    /// Keeps the connection open and silent until the scenario releases it,
    /// the peer closes it, or a deadline passes. Nothing is read as content.
    pub(crate) async fn wait(mut self, state: &Mutex<fixture::Observations>) {
        let mut release = {
            let mut state = state.lock().unwrap();
            let measure = &mut state.measure;
            measure.held_now += 1;
            measure.held_peak = measure.held_peak.max(measure.held_now);
            measure.release.subscribe()
        };
        let mut block = [0u8; 1024];
        let outcome = tokio::select! {
            _ = release.changed() => 0,
            _ = tokio::time::sleep(Duration::from_secs(45)) => 1,
            _ = async {
                while matches!(self.tls.read(&mut block).await, Ok(read) if read > 0) {}
            } => 2,
        };
        let mut state = state.lock().unwrap();
        let measure = &mut state.measure;
        measure.held_now = measure.held_now.saturating_sub(1);
        match outcome {
            0 => measure.held_released += 1,
            1 => measure.held_deadline += 1,
            _ => measure.held_peer_closed += 1,
        }
    }
}

fn websocket_accept(header: &str) -> Option<String> {
    use base64::Engine;
    let key = header.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("sec-websocket-key")
            .then(|| value.trim())
    })?;
    if key.len() != 24 || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b)) {
        return None;
    }
    let digest = sha1(format!("{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11").as_bytes());
    Some(base64::engine::general_purpose::STANDARD.encode(digest))
}

// RFC 6455 fixes SHA-1 for the handshake reply; it protects nothing here. A
// local copy keeps the fixture free of another dependency.
fn sha1(input: &[u8]) -> [u8; 20] {
    let mut state: [u32; 5] = [0x6745_2301, 0xEFCD_AB89, 0x98BA_DCFE, 0x1032_5476, 0xC3D2_E1F0];
    let mut message = input.to_vec();
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&((input.len() as u64) * 8).to_be_bytes());
    for block in message.chunks_exact(64) {
        let mut words = [0u32; 80];
        for (index, bytes) in block.chunks_exact(4).enumerate() {
            words[index] = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        }
        for index in 16..80 {
            words[index] = (words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16])
                .rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = state;
        for (index, word) in words.iter().enumerate() {
            let (mix, constant) = match index {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999u32),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let next = a
                .rotate_left(5)
                .wrapping_add(mix)
                .wrapping_add(e)
                .wrapping_add(constant)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = next;
        }
        for (value, add) in state.iter_mut().zip([a, b, c, d, e]) {
            *value = value.wrapping_add(add);
        }
    }
    let mut digest = [0u8; 20];
    for (bytes, value) in digest.chunks_exact_mut(4).zip(state) {
        bytes.copy_from_slice(&value.to_be_bytes());
    }
    digest
}

// ---------------------------------------------------------------------------
// Native hooks. Fixed labels, counts and times only.
// ---------------------------------------------------------------------------

struct SlotLog {
    origin: Instant,
    features: Vec<serde_json::Value>,
    lifecycle: Vec<serde_json::Value>,
    loading: Vec<serde_json::Value>,
    last_lifecycle: String,
    last_loading: Option<bool>,
    events: usize,
    faults: Vec<String>,
    load_errors: Vec<i32>,
    browse_allowed: usize,
    browse_denied: usize,
    main_documents: usize,
    credential_calls: BTreeMap<&'static str, usize>,
    first_grant_ms: BTreeMap<&'static str, u64>,
    dials_admitted: usize,
    dials_denied: usize,
    dials_failed: usize,
}

impl SlotLog {
    fn new() -> Self {
        Self {
            origin: Instant::now(),
            features: Vec::new(),
            lifecycle: Vec::new(),
            loading: Vec::new(),
            last_lifecycle: String::new(),
            last_loading: None,
            events: 0,
            faults: Vec::new(),
            load_errors: Vec::new(),
            browse_allowed: 0,
            browse_denied: 0,
            main_documents: 0,
            credential_calls: BTreeMap::new(),
            first_grant_ms: BTreeMap::new(),
            dials_admitted: 0,
            dials_denied: 0,
            dials_failed: 0,
        }
    }

    fn ms(&self) -> u64 {
        self.origin.elapsed().as_millis() as u64
    }

    fn document(&self) -> serde_json::Value {
        serde_json::json!({
            "features":self.features,"lifecycle":self.lifecycle,"loading":self.loading,
            "browserEvents":self.events,"faults":self.faults,"loadErrors":self.load_errors,
            "browseAllowed":self.browse_allowed,"browseDenied":self.browse_denied,
            "mainDocuments":self.main_documents,"credentialCalls":self.credential_calls,
            "firstGrantMs":self.first_grant_ms,
            "dials":{"admitted":self.dials_admitted,"denied":self.dials_denied,"failed":self.dials_failed}
        })
    }
}

struct Hooks {
    identity: BrowserIdentity,
    adapter: Adapter,
    consent_until: Instant,
    log: Arc<Mutex<SlotLog>>,
}

impl Hooks {
    fn granted(&self, request: &NativeLoginRequest<'_>) -> bool {
        request.identity == &self.identity && request.origin == ORIGIN
    }

    fn count(&self, stage: NativeLoginStage) {
        let label = match stage {
            NativeLoginStage::FormPrepare => "form-prepare",
            NativeLoginStage::Form => "form",
            NativeLoginStage::FormSubmit => "form-submit",
            _ => "other",
        };
        let mut log = self.log.lock().unwrap();
        let at = log.ms();
        *log.credential_calls.entry(label).or_default() += 1;
        log.first_grant_ms.entry(label).or_insert(at);
    }

    fn credentials<'a>(
        &'a self,
        username: &'a str,
        password: &'a str,
    ) -> NativeLoginCredentials<'a> {
        NativeLoginCredentials {
            identity: &self.identity,
            origin: ORIGIN,
            valid_until: self.consent_until,
            username,
            password,
            auto_submit: true,
        }
    }
}

impl BrowserEventSink for Hooks {
    fn on_event(&self, event: BrowserEvent) {
        let mut log = self.log.lock().unwrap();
        let at = log.ms();
        log.events += 1;
        let lifecycle = format!("{:?}", event.state.lifecycle);
        if log.last_lifecycle != lifecycle && log.lifecycle.len() < 16 {
            log.lifecycle
                .push(serde_json::json!({"atMs":at,"lifecycle":lifecycle}));
            log.last_lifecycle = lifecycle;
        }
        if log.last_loading != Some(event.state.loading) && log.loading.len() < 16 {
            log.loading
                .push(serde_json::json!({"atMs":at,"loading":event.state.loading}));
            log.last_loading = Some(event.state.loading);
        }
        if let Some(fault) = event.state.fault {
            if log.faults.len() < 8 {
                log.faults.push(format!("{fault:?}"));
            }
        }
    }
}

impl NativeDocumentHooks for Hooks {
    fn on_main_document(&self, _: &BrowserIdentity, _: u64) {
        self.log.lock().unwrap().main_documents += 1;
    }

    fn on_navigation_status(&self, _: &BrowserIdentity, status: NativeNavigationStatus) {
        let mut log = self.log.lock().unwrap();
        match status {
            NativeNavigationStatus::BeforeBrowse { allowed: true, .. } => log.browse_allowed += 1,
            NativeNavigationStatus::BeforeBrowse { allowed: false, .. } => log.browse_denied += 1,
            NativeNavigationStatus::LoadError { code, main_frame: true }
                if log.load_errors.len() < 8 =>
            {
                log.load_errors.push(code)
            }
            _ => {}
        }
    }

    fn login_adapter(&self) -> NativeLoginAdapter {
        match self.adapter {
            Adapter::ModularForm => NativeLoginAdapter::ModularForm,
            Adapter::Generic => NativeLoginAdapter::Generic,
            Adapter::Manual => NativeLoginAdapter::Manual,
        }
    }

    fn form_configuration(&self) -> Option<String> {
        (self.adapter == Adapter::ModularForm).then(|| FORM_SETUP.into())
    }

    fn on_feature_status(&self, _: &BrowserIdentity, origin: &str, status: NativeFeatureStatus) {
        let mut log = self.log.lock().unwrap();
        let at = log.ms();
        if log.features.len() < 64 {
            log.features.push(serde_json::json!({
                "atMs":at,"status":format!("{status:?}"),"bootstrap":origin=="about:blank"
            }));
        }
    }

    // The key pipeline rechecks this grant before every character; each call is
    // counted, never traced. Credentials are projected per stage exactly as
    // the app does: the preparation and submit grants carry no values.
    fn with_form_credentials(
        &self,
        request: &NativeLoginRequest<'_>,
        deliver: &mut dyn FnMut(NativeLoginCredentials<'_>, Option<&str>),
    ) {
        if self.adapter != Adapter::ModularForm {
            self.with_auto_login(request, &mut |credentials| deliver(credentials, None));
            return;
        }
        if !self.granted(request) {
            return;
        }
        let (username, password) = match request.stage {
            NativeLoginStage::Form => (USERNAME, PASSWORD),
            NativeLoginStage::FormPrepare | NativeLoginStage::FormSubmit => ("", ""),
            _ => return,
        };
        self.count(request.stage);
        deliver(self.credentials(username, password), Some(FORM_OPTIONS));
    }

    fn with_auto_login(
        &self,
        request: &NativeLoginRequest<'_>,
        deliver: &mut dyn FnMut(NativeLoginCredentials<'_>),
    ) {
        if self.adapter != Adapter::Generic
            || !self.granted(request)
            || request.stage != NativeLoginStage::Form
        {
            return;
        }
        self.count(request.stage);
        deliver(self.credentials(USERNAME, PASSWORD));
    }
}

// ---------------------------------------------------------------------------
// Scenario engine
// ---------------------------------------------------------------------------

pub(crate) struct Run<'a, 'r> {
    pub runtime: &'a CefRuntime<'r>,
    pub fixture: &'a fixture::Fixture,
    pub events: &'a mut EventLoop<()>,
    pub parent: Arc<Window>,
    pub async_runtime: &'a tokio::runtime::Runtime,
    pub initialized: &'a AtomicUsize,
    pub output: &'a Path,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage {
    Preparing,
    Created,
    Shown(Instant),
    Armed,
    Navigated,
    Revoked,
}

struct Slot {
    plan: &'static SlotPlan,
    identity: BrowserIdentity,
    session: Arc<Mutex<OriginBrowserSession>>,
    permissions: Arc<WebsitePermissionEngine>,
    hooks: Arc<Hooks>,
    log: Arc<Mutex<SlotLog>>,
    context: Option<PrivateRequestContext>,
    browser: Option<CefBrowserHost<'static>>,
    child: Option<shell::Handle>,
    stage: Stage,
    flipped: bool,
    record: serde_json::Map<String, serde_json::Value>,
    reports: serde_json::Map<String, serde_json::Value>,
    received: serde_json::Map<String, serde_json::Value>,
}

impl Slot {
    fn start(run: &Run<'_, '_>, plan: &'static SlotPlan) -> Result<Self> {
        let log = Arc::new(Mutex::new(SlotLog::new()));
        let address = run.fixture.address;
        let dials = log.clone();
        // Fixture-only route: two synthetic hosts, both served by the numeric
        // loopback listener. No DNS and no fallback.
        let dialer: Arc<dyn RouteDialer> = Arc::new(move |authority: Authority| -> DialFuture {
            let dials = dials.clone();
            Box::pin(async move {
                if authority.port() != 443
                    || !["fixture.test", "frame.test"].contains(&authority.host())
                {
                    dials.lock().unwrap().dials_denied += 1;
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "fixture-only route",
                    ));
                }
                match tokio::net::TcpStream::connect(address).await {
                    Ok(stream) => {
                        dials.lock().unwrap().dials_admitted += 1;
                        Ok(Box::new(stream) as BoxedStream)
                    }
                    Err(error) => {
                        dials.lock().unwrap().dials_failed += 1;
                        Err(error)
                    }
                }
            })
        });
        let policy = OriginBrowserPolicy::new_with_allowed_origins(
            "measure",
            plan.id,
            plan.id,
            ORIGIN,
            &["https://frame.test"],
        )?;
        let identity = policy.identity().clone();
        let limits = match plan.relay_clients {
            Some(max_clients) => ProxyLimits {
                max_clients,
                ..ProxyLimits::default()
            },
            None => ProxyLimits::default(),
        };
        let session = Arc::new(Mutex::new(run.async_runtime.block_on(
            OriginBrowserSession::start(policy, dialer, limits),
        )?));
        let defaults = [
            "navigation",
            "frame",
            "script",
            "stylesheet",
            "image-media",
            "font",
            "fetch-xhr",
            "websocket",
        ]
        .into_iter()
        .filter_map(|class| {
            WebsiteRequestClass::parse(class).map(|class| (class, WebsitePermissionDecision::Allow))
        })
        .collect();
        let permissions = Arc::new(WebsitePermissionEngine::new(None, None, &defaults)?);
        let hooks = Arc::new(Hooks {
            identity: identity.clone(),
            adapter: plan.adapter,
            consent_until: Instant::now() + CONSENT_LIFETIME,
            log: log.clone(),
        });
        let mut record = serde_json::Map::new();
        for (key, value) in [
            ("id", serde_json::json!(plan.id)),
            ("presentation", serde_json::json!(plan.presentation.label())),
            ("adapter", serde_json::json!(plan.adapter.label())),
            ("width", serde_json::json!(plan.width)),
            ("height", serde_json::json!(plan.height)),
            ("plannedFlip", serde_json::json!(plan.flip.label())),
            ("relayMaxClients", serde_json::json!(limits.max_clients)),
            ("relayCapExplicit", serde_json::json!(plan.relay_clients.is_some())),
            ("navigated", serde_json::json!(false)),
        ] {
            record.insert(key.into(), value);
        }
        Ok(Self {
            plan,
            identity,
            session,
            permissions,
            hooks,
            log,
            context: None,
            browser: None,
            child: None,
            stage: Stage::Preparing,
            flipped: false,
            record,
            reports: serde_json::Map::new(),
            received: serde_json::Map::new(),
        })
    }

    fn set(&mut self, key: &str, value: serde_json::Value) {
        self.record.insert(key.into(), value);
    }

    fn child_state(&mut self, moment: &str) {
        let state = shell::child_state(self.child);
        let windows = self
            .record
            .entry("childWindow")
            .or_insert_with(|| serde_json::json!({}));
        windows[moment] = state;
    }

    /// Context, browser and the presentation steps that precede navigation.
    fn advance(&mut self, parent: &Arc<Window>, scale: f64) -> Result<()> {
        if self.context.is_none() && self.browser.is_none() {
            self.context = Some(unsafe {
                PrivateRequestContext::create_with_permissions(
                    self.session.clone(),
                    self.identity.clone(),
                    self.permissions.clone(),
                )?
            });
        }
        let status = self.context.as_ref().map(|context| context.status());
        if let Some(status @ (PreparationStatus::Failed(_) | PreparationStatus::Revoked)) = status {
            return Err(format!("{}: context preparation failed: {status:?}", self.plan.id).into());
        }
        if status == Some(PreparationStatus::ProxyConfigured) {
            if let Some(context) = self.context.take() {
                let before = shell::children(parent);
                self.browser = Some(unsafe {
                    CefBrowserHost::create_owned_engineering_probe(
                        parent.clone(),
                        context,
                        self.session.clone(),
                        self.identity.clone(),
                        ViewportBounds::new(0., 0., self.plan.width, self.plan.height)?,
                        scale,
                        self.hooks.clone(),
                        Some(self.hooks.clone()),
                    )?
                });
                self.child = shell::children(parent)
                    .into_iter()
                    .find(|child| !before.contains(child));
                self.child_state("atCreation");
                self.stage = Stage::Created;
            }
        }
        let Some(browser) = &self.browser else {
            return Ok(());
        };
        match self.stage {
            Stage::Created if browser.features_ready(&self.identity)? => {
                {
                    let mut session = self.session.lock().unwrap();
                    let ready = NativeHostReadiness::Ready {
                        profile_key: session.policy().profile_key().into(),
                        proxy_endpoint: session.proxy_endpoint(),
                    };
                    // Engineering fixture only. Does not change production readiness.
                    session.report_host(&self.identity, ready)?;
                }
                if self.plan.presentation == Presentation::HiddenAfterAttach {
                    // What an active tab goes through before the user leaves it.
                    browser.show(&self.identity)?;
                    let focused = browser.focus(&self.identity).is_ok();
                    self.stage = Stage::Shown(Instant::now());
                    self.set("focusAccepted", focused.into());
                    self.child_state("whileShown");
                } else {
                    self.stage = Stage::Armed;
                }
            }
            Stage::Shown(at) if at.elapsed() >= SHOWN_BEFORE_HIDE => {
                browser.hide(&self.identity)?;
                self.stage = Stage::Armed;
            }
            _ => {}
        }
        Ok(())
    }

    fn navigate(&mut self, url: &str, scale: f64) -> Result<()> {
        let Some(browser) = &self.browser else {
            return Err("navigation without a browser".into());
        };
        // A refused navigation is this slot's result, not a reason to stop.
        let refusal = browser.navigate(&self.identity, url).err().map(|e| e.to_string());
        let blocked = self.plan.presentation == Presentation::VisibleInputBlocked;
        match self.plan.presentation {
            Presentation::Visible => browser.show(&self.identity)?,
            Presentation::VisibleInputBlocked => {
                // The app's order for a tab presented under a shell overlay.
                let bounds = OriginBrowserBounds {
                    x: 0.,
                    y: 0.,
                    width: self.plan.width,
                    height: self.plan.height,
                };
                browser.occlude(&self.identity, bounds, &[], scale, true)?;
                browser.show(&self.identity)?;
                browser.occlude(&self.identity, bounds, &[], scale, true)?;
            }
            Presentation::HiddenAfterAttach | Presentation::BornHidden => {}
        }
        let lifecycle = format!("{:?}", browser.lifecycle());
        // Native times in this slot count from its creation; this is the offset.
        let at = self.log.lock().unwrap().ms();
        self.set("navigatedAtMs", at.into());
        self.set("navigated", refusal.is_none().into());
        self.set("navigationError", refusal.into());
        self.set("lifecycleAtNavigation", lifecycle.into());
        self.set("inputBlockedRequested", blocked.into());
        self.child_state("atNavigation");
        self.stage = Stage::Navigated;
        Ok(())
    }

    fn flip(&mut self, since: Instant) -> Result<()> {
        if self.flipped {
            return Ok(());
        }
        self.flipped = true;
        let Some(browser) = &self.browser else {
            return Ok(());
        };
        match self.plan.flip {
            Flip::None => return Ok(()),
            Flip::HideLate => browser.hide(&self.identity)?,
            Flip::ShowLate => browser.show(&self.identity)?,
        }
        let lifecycle = format!("{:?}", browser.lifecycle());
        self.set(
            "flip",
            serde_json::json!({
                "kind":self.plan.flip.label(),"atMs":since.elapsed().as_millis() as u64,
                "lifecycleAfter":lifecycle
            }),
        );
        self.child_state("afterFlip");
        Ok(())
    }

    fn finish(&mut self) -> Result<()> {
        if let Some(browser) = &self.browser {
            let lifecycle = format!("{:?}", browser.lifecycle());
            self.set("lifecycleAtEnd", lifecycle.into());
        }
        self.child_state("atEnd");
        let relay = serde_json::to_value(self.session.lock().unwrap().proxy_diagnostics())?;
        self.set("relay", relay);
        self.session.lock().unwrap().revoke(&self.identity)?;
        self.stage = Stage::Revoked;
        Ok(())
    }

    fn document(mut self) -> (serde_json::Value, Arc<Mutex<OriginBrowserSession>>) {
        let login_ms = self.received.get("login").cloned();
        self.record
            .insert("reports".into(), std::mem::take(&mut self.reports).into());
        self.record
            .insert("reportReceivedMs".into(), std::mem::take(&mut self.received).into());
        self.record.insert(
            "navigationToLoginReportMs".into(),
            login_ms.unwrap_or(serde_json::Value::Null),
        );
        self.record
            .insert("native".into(), self.log.lock().unwrap().document());
        // The browser goes first and takes its context with it.
        drop(self.browser.take());
        drop(self.context.take());
        (std::mem::take(&mut self.record).into(), self.session.clone())
    }
}

fn plan_document() -> serde_json::Value {
    SCENARIOS
        .iter()
        .map(|plan| {
            serde_json::json!({
                "id":plan.id,"shell":plan.shell.label(),"page":plan.page.label(),
                "longWindow":plan.long_window,
                "slots":plan.slots.iter().map(|slot| serde_json::json!({
                    "id":slot.id,"presentation":slot.presentation.label(),"adapter":slot.adapter.label()
                })).collect::<Vec<_>>()
            })
        })
        .collect()
}

fn publish(
    fixture: &fixture::Fixture,
    window_ms: u64,
    selected: &Option<Vec<&'static str>>,
    scenarios: &[serde_json::Value],
) {
    fixture.observations.lock().unwrap().measure.document = Some(serde_json::json!({
        "schema":1,"windowMs":window_ms,"only":selected,"plan":plan_document(),
        "consentLifetimeMs":CONSENT_LIFETIME.as_millis() as u64,
        "relayMaxClients":ProxyLimits::default().max_clients,
        "credentialsSynthetic":true,"scenarios":scenarios
    }));
}

/// Runs the selected scenarios in order. `Err` means the run stopped early at
/// a point where native shutdown is still safe; the caller shuts down either
/// way and reports. Failures collected here are failures of the tool.
pub(crate) fn run(mut run: Run<'_, '_>, failures: &mut Vec<String>) -> Result<()> {
    if menu::requested() {
        return menu::run(&mut run, failures);
    }
    let window_ms = window_ms(std::env::var(WINDOW_VARIABLE).ok().as_deref())?;
    let selected = only(std::env::var(ONLY_VARIABLE).ok().as_deref())?;
    let mut scenarios = Vec::new();
    let mut decoy = None;
    publish(run.fixture, window_ms, &selected, &scenarios);
    // The runner starts this process hidden, and Windows applies that to the
    // first ShowWindow call. Show the fixture window without activating it,
    // and keep it from ever taking the keyboard from the desktop.
    shell::present_inert(&run.parent);
    for plan in SCENARIOS {
        if selected
            .as_ref()
            .is_some_and(|ids| !ids.contains(&plan.id))
        {
            continue;
        }
        run.fixture.observations.lock().unwrap().record(
            "measure-scenario-enter",
            serde_json::json!({"scenario":plan.id}),
        );
        let outcome = scenario(&mut run, plan, window_ms, &mut decoy, failures);
        let stop = match outcome {
            Ok(record) => {
                scenarios.push(record);
                None
            }
            Err(error) => Some(error),
        };
        run.fixture.observations.lock().unwrap().record(
            "measure-scenario-return",
            serde_json::json!({"scenario":plan.id,"stopped":stop.is_some()}),
        );
        publish(run.fixture, window_ms, &selected, &scenarios);
        run.fixture.write_progress(run.output, failures)?;
        if let Some(error) = stop {
            failures.push(format!("{}: {error}", plan.id));
            return Err("measurement run stopped early".into());
        }
    }
    Ok(())
}

fn scenario(
    run: &mut Run<'_, '_>,
    plan: &'static ScenarioPlan,
    window_ms: u64,
    decoy: &mut Option<Window>,
    failures: &mut Vec<String>,
) -> Result<serde_json::Value> {
    let window = Duration::from_millis(if plan.long_window {
        (window_ms * 5 / 2).min(60_000)
    } else {
        window_ms
    });
    let mut record = serde_json::json!({
        "id":plan.id,"shell":plan.shell.label(),"page":plan.page.label(),
        "windowMs":window.as_millis() as u64,"navigated":false,"closed":false
    });
    let Some(preparation) = shell::prepare(plan.shell, &run.parent, &*run.events, decoy) else {
        record["skipped"] = "shell-control-unavailable".into();
        return Ok(record);
    };
    record["shellPreparation"] = preparation.into();
    run.fixture
        .observations
        .lock()
        .unwrap()
        .measure
        .reset_capacity();
    let mut slots = Vec::new();
    for slot in plan.slots {
        slots.push(Slot::start(run, slot)?);
    }
    let (runtime, fixture, output, initialized) =
        (run.runtime, run.fixture, run.output, run.initialized);
    let parent = run.parent.clone();
    let scale = parent.scale_factor();
    let started = Instant::now();
    let mut policy_read = false;
    let mut navigated_at: Option<Instant> = None;
    let mut revoked_at: Option<Instant> = None;
    let mut closed = false;
    let mut last_snapshot = Instant::now();
    let mut ever_foreground = false;
    // The first window of this process seen as the desktop's foreground
    // window, on any turn of the loop from the scenario's start to its end.
    let mut own_foreground: Option<String> = None;
    let mut stopped: Option<String> = None;
    let decoy_window = decoy.as_ref();
    run.events.run_return(|event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(5));
        if !matches!(event, Event::MainEventsCleared) {
            return;
        }
        let step = (|| -> Result<()> {
            runtime.work()?;
            if own_foreground.is_none() {
                own_foreground = shell::foreground_own(&parent);
            }
            match initialized.load(Ordering::Acquire) {
                2 => {}
                3 => return Err("global test rejecting proxy installation failed".into()),
                _ => return Ok(()),
            }
            if !policy_read {
                // Production installs its policy after the fixture's temporary
                // guard; read back the production policy itself.
                if !super::observe_network_policy(runtime, fixture, "before-private-context")? {
                    return Err("production network policy not configured".into());
                }
                policy_read = true;
            }
            for slot in slots.iter_mut() {
                slot.advance(&parent, scale)?;
            }
            if navigated_at.is_none() && slots.iter().all(|slot| slot.stage == Stage::Armed) {
                record["windowState"] =
                    serde_json::json!({"atNavigation":shell::state(&parent, decoy_window)});
                // Every slot of a scenario starts in the same turn of the loop.
                for slot in slots.iter_mut() {
                    let url = match plan.page {
                        Page::Login => format!(
                            "{ORIGIN}/measure-login?slot={}&w={}",
                            slot.plan.id,
                            window.as_millis()
                        ),
                        Page::Capacity => format!(
                            "{ORIGIN}/measure-capacity?slot={}&sockets={CAPACITY_SOCKETS}&holds={CAPACITY_HOLDS_PER_HOST}",
                            slot.plan.id
                        ),
                    };
                    slot.navigate(&url, scale)?;
                }
                record["navigated"] = true.into();
                navigated_at = Some(Instant::now());
            }
            if let (Some(at), None) = (navigated_at, revoked_at) {
                ever_foreground |= shell::foreground(&parent);
                {
                    let state = fixture.observations.lock().unwrap();
                    for report in &state.measure.reports {
                        let Some(slot) = slots.iter_mut().find(|slot| slot.plan.id == report.slot)
                        else {
                            continue;
                        };
                        if !slot.reports.contains_key(&report.kind) {
                            slot.reports.insert(report.kind.clone(), report.body.clone());
                            slot.received.insert(
                                report.kind.clone(),
                                (report.received.saturating_duration_since(at).as_millis() as u64)
                                    .into(),
                            );
                        }
                    }
                }
                if at.elapsed() >= window.mul_f64(0.6) {
                    for slot in slots.iter_mut() {
                        slot.flip(at)?;
                    }
                }
                let reported = slots.iter().all(|slot| slot.reports.contains_key("final"));
                if reported || at.elapsed() > window + REPORT_GRACE {
                    record["windowState"]["atEnd"] = shell::state(&parent, decoy_window);
                    // Sampled on every turn of the loop between the two states.
                    record["windowState"]["everForeground"] = ever_foreground.into();
                    for slot in slots.iter_mut() {
                        slot.finish()?;
                    }
                    let state = fixture.observations.lock().unwrap();
                    if plan.page == Page::Capacity {
                        // Relay counters are cumulative for the attempt, so the
                        // reading taken at the end covers the held connections.
                        record["capacity"] = serde_json::json!({
                            "requested":{"sockets":CAPACITY_SOCKETS,"holdsPerHost":CAPACITY_HOLDS_PER_HOST,"holdHosts":2},
                            "relayMaxClients":slots[0].record.get("relayMaxClients"),
                            "relayCapExplicit":slots[0].plan.relay_clients.is_some(),
                            "relay":slots[0].record.get("relay"),"fixture":state.measure.capacity()
                        });
                    }
                    state.measure.release_held();
                    revoked_at = Some(Instant::now());
                }
            }
            if revoked_at.is_some_and(|at| at.elapsed() > Duration::from_millis(500)) {
                let mut all = true;
                for slot in &slots {
                    if let Some(browser) = &slot.browser {
                        browser.close(&slot.identity)?;
                        all &= browser.lifecycle() == Lifecycle::Closed;
                    }
                }
                if all {
                    closed = true;
                    *flow = ControlFlow::Exit;
                }
            }
            if started.elapsed() > window + SCENARIO_SLACK {
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
    record["closed"] = closed.into();
    record["elapsedMs"] = (started.elapsed().as_millis() as u64).into();
    record["windowState"]["foregroundOwnedByFixtureProcess"] = own_foreground.into();
    let created = slots.iter().any(|slot| slot.browser.is_some());
    let mut sessions = Vec::new();
    if !closed && created {
        // Never call CEF shutdown with live references; terminate the process
        // at this failed boundary. The runner records the failure.
        failures.push(format!(
            "{}: {}",
            plan.id,
            stopped.as_deref().unwrap_or("browser did not close")
        ));
        fixture.write_report(output, failures)?;
        std::process::exit(3);
    }
    let mut documents = Vec::new();
    for slot in slots {
        let (document, session) = slot.document();
        documents.push(document);
        sessions.push(session);
    }
    record["slots"] = documents.into();
    for session in sessions {
        run.async_runtime.block_on(session.lock().unwrap().stop())?;
    }
    record["shellRestore"] = shell::restore(plan.shell, &run.parent, decoy.as_ref()).into();
    match stopped {
        Some(error) => Err(error.into()),
        None => Ok(record),
    }
}

// ---------------------------------------------------------------------------
// Top-level window state. Windows only; elsewhere the (e) scenarios are
// skipped and the state is reported as unsupported. Nothing here sends input
// or activates a window that belongs to another process.
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod shell {
    use super::Shell;
    use std::ffi::c_void;
    use tao::{event_loop::EventLoop, window::Window};

    pub(super) type Handle = isize;
    type Hwnd = *mut c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> Hwnd;
        fn SetForegroundWindow(window: Hwnd) -> i32;
        fn EnableWindow(window: Hwnd, enable: i32) -> i32;
        fn IsIconic(window: Hwnd) -> i32;
        fn IsWindowVisible(window: Hwnd) -> i32;
        fn IsWindowEnabled(window: Hwnd) -> i32;
        fn GetWindow(window: Hwnd, command: u32) -> Hwnd;
        fn GetWindowRect(window: Hwnd, rect: *mut Rect) -> i32;
        fn GetClientRect(window: Hwnd, rect: *mut Rect) -> i32;
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
        fn ShowWindow(window: Hwnd, command: i32) -> i32;
        fn GetWindowThreadProcessId(window: Hwnd, process: *mut u32) -> u32;
        fn GetClassNameW(window: Hwnd, name: *mut u16, capacity: i32) -> i32;
    }
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(window: Hwnd, attribute: u32, value: *mut c_void, size: u32) -> i32;
    }

    const GW_HWNDNEXT: u32 = 2;
    const GW_HWNDPREV: u32 = 3;
    const GW_CHILD: u32 = 5;
    const GWL_STYLE: i32 = -16;
    const GWL_EXSTYLE: i32 = -20;
    const WS_VISIBLE: isize = 0x1000_0000;
    const WS_EX_TRANSPARENT: isize = 0x20;
    const WS_EX_LAYERED: isize = 0x8_0000;
    const SWP_NOSIZE: u32 = 0x1;
    const SWP_NOMOVE: u32 = 0x2;
    const SWP_NOZORDER: u32 = 0x4;
    const SWP_NOACTIVATE: u32 = 0x10;
    const SW_HIDE: i32 = 0;
    const SW_SHOWNOACTIVATE: i32 = 4;
    const SW_MINIMIZE: i32 = 6;
    const SW_SHOWMINNOACTIVE: i32 = 7;
    const DWMWA_CLOAKED: u32 = 14;

    fn hwnd(window: &Window) -> Option<Hwnd> {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        match window.window_handle().ok()?.as_raw() {
            RawWindowHandle::Win32(handle) => Some(handle.hwnd.get() as Hwnd),
            _ => None,
        }
    }

    fn rect(window: Hwnd) -> Option<Rect> {
        let mut rect = Rect::default();
        (unsafe { GetWindowRect(window, &mut rect) } != 0
            && rect.right > rect.left
            && rect.bottom > rect.top)
            .then_some(rect)
    }

    fn above(window: Hwnd) -> Vec<Hwnd> {
        let mut windows = Vec::new();
        let mut next = unsafe { GetWindow(window, GW_HWNDPREV) };
        while !next.is_null() && windows.len() < 1024 {
            windows.push(next);
            next = unsafe { GetWindow(next, GW_HWNDPREV) };
        }
        windows
    }

    // An estimate in the manner of Chromium's own occlusion tracker, which is
    // not consulted here: shown, not minimized, not cloaked, not click-through
    // and not layered.
    fn occludes(window: Hwnd) -> bool {
        unsafe {
            let mut cloaked = 0u32;
            let known = DwmGetWindowAttribute(
                window,
                DWMWA_CLOAKED,
                (&mut cloaked as *mut u32).cast(),
                std::mem::size_of::<u32>() as u32,
            ) == 0;
            IsWindowVisible(window) != 0
                && IsIconic(window) == 0
                && !(known && cloaked != 0)
                && GetWindowLongPtrW(window, GWL_EXSTYLE) & (WS_EX_TRANSPARENT | WS_EX_LAYERED) == 0
        }
    }

    fn own(window: Hwnd) -> bool {
        let mut process = 0u32;
        unsafe { GetWindowThreadProcessId(window, &mut process) };
        process == std::process::id()
    }

    /// Share of a 16 by 12 grid over the fixture window that no window above
    /// it in the Z order covers, in thousandths; how many windows cover any of
    /// it; and how many of those belong to this process (the decoy).
    fn exposure(window: Hwnd) -> (u32, usize, usize) {
        let Some(area) = rect(window) else {
            return (0, 0, 0);
        };
        if unsafe { IsIconic(window) != 0 || IsWindowVisible(window) == 0 } {
            return (0, 0, 0);
        }
        let covering: Vec<(Hwnd, Rect)> = above(window)
            .into_iter()
            .filter(|other| occludes(*other))
            .filter_map(|other| rect(other).map(|area| (other, area)))
            .filter(|(_, other)| {
                other.left < area.right
                    && other.right > area.left
                    && other.top < area.bottom
                    && other.bottom > area.top
            })
            .collect();
        let owned = covering.iter().filter(|(other, _)| own(*other)).count();
        let covers: Vec<Rect> = covering.into_iter().map(|(_, area)| area).collect();
        let (width, height) = (area.right - area.left - 16, area.bottom - area.top - 16);
        if width <= 0 || height <= 0 {
            return (0, covers.len(), owned);
        }
        let mut exposed = 0u32;
        for row in 0..12 {
            for column in 0..16 {
                let x = area.left + 8 + (width * (2 * column + 1)) / 32;
                let y = area.top + 8 + (height * (2 * row + 1)) / 24;
                if !covers
                    .iter()
                    .any(|c| x >= c.left && x < c.right && y >= c.top && y < c.bottom)
                {
                    exposed += 1;
                }
            }
        }
        (exposed * 1000 / 192, covers.len(), owned)
    }

    /// A visible view asks for native focus when it navigates, and Windows
    /// lets a freshly launched process take the foreground with it. A disabled
    /// top-level window cannot be given focus or activated by a click, so the
    /// fixture never takes the keyboard from whatever the desktop is doing.
    /// Pages are driven through CEF, not through this window's input.
    pub(super) fn present_inert(window: &Window) {
        if let Some(window) = hwnd(window) {
            unsafe {
                EnableWindow(window, 0);
                ShowWindow(window, SW_SHOWNOACTIVATE);
            }
        }
    }

    pub(super) fn foreground(window: &Window) -> bool {
        hwnd(window).is_some_and(|window| unsafe { GetForegroundWindow() == window })
    }

    /// The foreground window when it belongs to this process: the fixture
    /// window, or any other window by its class. The toolkit and the engine
    /// own further top-level windows, and a disabled fixture window does not
    /// stop one of those from becoming the active one. A window title can
    /// carry page text and is never read.
    pub(super) fn foreground_own(fixture: &Window) -> Option<String> {
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.is_null() || !own(foreground) {
            return None;
        }
        if hwnd(fixture) == Some(foreground) {
            return Some("fixture-window".into());
        }
        let mut name = [0u16; 64];
        let length = unsafe { GetClassNameW(foreground, name.as_mut_ptr(), 64) }.clamp(0, 64);
        Some(String::from_utf16_lossy(&name[..length as usize]))
    }

    pub(super) fn children(parent: &Window) -> Vec<Handle> {
        let mut children = Vec::new();
        let Some(parent) = hwnd(parent) else {
            return children;
        };
        let mut child = unsafe { GetWindow(parent, GW_CHILD) };
        while !child.is_null() && children.len() < 64 {
            children.push(child as Handle);
            child = unsafe { GetWindow(child, GW_HWNDNEXT) };
        }
        children
    }

    pub(super) fn child_state(child: Option<Handle>) -> serde_json::Value {
        let Some(child) = child.map(|child| child as Hwnd) else {
            return serde_json::json!({"known":false});
        };
        let mut client = Rect::default();
        unsafe {
            GetClientRect(child, &mut client);
            serde_json::json!({
                "known":true,"visible":IsWindowVisible(child) != 0,
                "styleVisible":GetWindowLongPtrW(child, GWL_STYLE) & WS_VISIBLE != 0,
                "enabled":IsWindowEnabled(child) != 0,
                "width":client.right - client.left,"height":client.bottom - client.top
            })
        }
    }

    pub(super) fn state(parent: &Window, decoy: Option<&Window>) -> serde_json::Value {
        let Some(parent) = hwnd(parent) else {
            return serde_json::json!({"supported":false});
        };
        let (exposed, covering, covering_own) = exposure(parent);
        let decoy = decoy.and_then(hwnd).map(|decoy| unsafe {
            let is_above = above(parent).contains(&decoy);
            let shown = IsWindowVisible(decoy) != 0 && IsIconic(decoy) == 0;
            let covers = match (rect(parent), rect(decoy)) {
                (Some(inner), Some(outer)) => {
                    outer.left <= inner.left
                        && outer.top <= inner.top
                        && outer.right >= inner.right
                        && outer.bottom >= inner.bottom
                }
                _ => false,
            };
            serde_json::json!({
                "shown":shown,"foreground":GetForegroundWindow() == decoy,
                "aboveFixture":is_above,"coversFixture":shown && is_above && covers
            })
        });
        unsafe {
            serde_json::json!({
                "supported":true,"visible":IsWindowVisible(parent) != 0,
                "minimized":IsIconic(parent) != 0,"foreground":GetForegroundWindow() == parent,
                "exposedPermille":exposed,"coveringWindows":covering,
                "coveringOwnWindows":covering_own,"decoy":decoy
            })
        }
    }

    fn ensure_decoy(events: &EventLoop<()>, decoy: &mut Option<Window>) -> Option<Hwnd> {
        if decoy.is_none() {
            *decoy = tao::window::WindowBuilder::new()
                .with_title("Local CEF acceptance — decoy window, synthetic fixtures only")
                .with_inner_size(tao::dpi::LogicalSize::new(320., 200.))
                .with_focused(false)
                .build(events)
                .ok();
        }
        decoy.as_ref().and_then(hwnd)
    }

    /// `None` when the state cannot be arranged here. Fixed labels only.
    pub(super) fn prepare(
        shell: Shell,
        parent: &Window,
        events: &EventLoop<()>,
        decoy: &mut Option<Window>,
    ) -> Option<Vec<&'static str>> {
        let window = hwnd(parent)?;
        let foreground = unsafe { GetForegroundWindow() == window };
        Some(match shell {
            Shell::AsLaunched => vec![],
            Shell::Inactive if !foreground => vec!["already-inactive"],
            Shell::Inactive => {
                // Only reached when the user gave this window the foreground.
                // It is handed to this process's own decoy, never taken from
                // another process.
                let decoy = ensure_decoy(events, decoy)?;
                unsafe {
                    ShowWindow(decoy, SW_SHOWNOACTIVATE);
                    SetForegroundWindow(decoy);
                }
                vec!["foreground-handed-to-decoy"]
            }
            Shell::Covered => {
                let decoy = ensure_decoy(events, decoy)?;
                let area = rect(window)?;
                unsafe {
                    SetWindowPos(
                        decoy,
                        std::ptr::null_mut(),
                        area.left - 16,
                        area.top - 16,
                        area.right - area.left + 32,
                        area.bottom - area.top + 32,
                        SWP_NOZORDER | SWP_NOACTIVATE,
                    );
                    ShowWindow(decoy, SW_SHOWNOACTIVATE);
                    // Place the fixture window directly below the decoy.
                    SetWindowPos(
                        window,
                        decoy,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                    );
                }
                vec!["decoy-placed-over-fixture"]
            }
            Shell::Minimized if foreground => {
                // Windows gives the foreground back to the next window.
                unsafe { ShowWindow(window, SW_MINIMIZE) };
                vec!["minimized"]
            }
            Shell::Minimized => {
                unsafe { ShowWindow(window, SW_SHOWMINNOACTIVE) };
                vec!["minimized-without-activation"]
            }
        })
    }

    pub(super) fn restore(shell: Shell, parent: &Window, decoy: Option<&Window>) -> Vec<&'static str> {
        let mut actions = Vec::new();
        if matches!(shell, Shell::Inactive | Shell::Covered) {
            if let Some(decoy) = decoy.and_then(hwnd) {
                if unsafe { IsWindowVisible(decoy) != 0 } {
                    unsafe { ShowWindow(decoy, SW_HIDE) };
                    actions.push("decoy-hidden");
                }
            }
        }
        if shell == Shell::Minimized {
            if let Some(window) = hwnd(parent) {
                unsafe { ShowWindow(window, SW_SHOWNOACTIVATE) };
                actions.push("restored-without-activation");
            }
        }
        actions
    }
}

#[cfg(not(windows))]
mod shell {
    use super::Shell;
    use tao::{event_loop::EventLoop, window::Window};

    pub(super) type Handle = isize;

    pub(super) fn present_inert(_: &Window) {}

    pub(super) fn foreground(_: &Window) -> bool {
        false
    }

    pub(super) fn foreground_own(_: &Window) -> Option<String> {
        None
    }

    pub(super) fn children(_: &Window) -> Vec<Handle> {
        Vec::new()
    }

    pub(super) fn child_state(_: Option<Handle>) -> serde_json::Value {
        serde_json::json!({"known":false})
    }

    pub(super) fn state(_: &Window, _: Option<&Window>) -> serde_json::Value {
        serde_json::json!({"supported":false})
    }

    pub(super) fn prepare(
        shell: Shell,
        _: &Window,
        _: &EventLoop<()>,
        _: &mut Option<Window>,
    ) -> Option<Vec<&'static str>> {
        (shell == Shell::AsLaunched).then(Vec::new)
    }

    pub(super) fn restore(_: Shell, _: &Window, _: Option<&Window>) -> Vec<&'static str> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn websocket_reply_matches_the_rfc_6455_example_and_rejects_malformed_keys() {
        // RFC 3174 test vector, then the RFC 6455 section 1.3 handshake.
        assert_eq!(
            sha1(b"abc"),
            [
                0xa9, 0x99, 0x3e, 0x36, 0x47, 0x06, 0x81, 0x6a, 0xba, 0x3e, 0x25, 0x71, 0x78, 0x50,
                0xc2, 0x6c, 0x9c, 0xd0, 0xd8, 0x9d
            ]
        );
        assert_eq!(
            websocket_accept("GET /measure-socket HTTP/1.1\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n")
                .as_deref(),
            Some("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
        );
        for header in [
            "GET /measure-socket HTTP/1.1\r\n",
            "Sec-WebSocket-Key: short\r\n",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25j\r\nZQ==\r\n",
        ] {
            assert!(websocket_accept(header).is_none());
        }
    }

    #[test]
    fn scenario_table_has_unique_safe_ids_and_runs_window_changes_last() {
        let mut ids = Vec::new();
        for plan in SCENARIOS {
            assert!(!plan.slots.is_empty() && plan.slots.len() <= 3);
            for id in std::iter::once(plan.id).chain(plan.slots.iter().map(|slot| slot.id)) {
                assert!(label_safe(id), "{id}");
            }
            assert!(!ids.contains(&plan.id));
            ids.push(plan.id);
            for slot in plan.slots {
                assert!(ViewportBounds::new(0., 0., slot.width, slot.height).is_ok());
                assert_eq!(
                    slot.adapter == Adapter::Manual,
                    plan.page == Page::Capacity,
                    "{}",
                    slot.id
                );
            }
        }
        let first_changed = SCENARIOS
            .iter()
            .position(|plan| plan.shell != Shell::AsLaunched)
            .unwrap();
        assert!(SCENARIOS[first_changed..]
            .iter()
            .all(|plan| plan.shell != Shell::AsLaunched));
        // One page's connections, through both of Chromium's socket pools:
        // within the relay's default, which follows the engine's own limits,
        // and more than the cap the second capacity scenario sets itself.
        let requested = CAPACITY_SOCKETS + 2 * CAPACITY_HOLDS_PER_HOST;
        assert!(requested <= ProxyLimits::default().max_clients);
        assert!(requested > CAPACITY_SMALL_CAP);
        let caps: Vec<(&str, Option<usize>)> = SCENARIOS
            .iter()
            .filter(|plan| plan.page == Page::Capacity)
            .map(|plan| (plan.id, plan.slots[0].relay_clients))
            .collect();
        assert_eq!(
            caps,
            [
                ("f-relay-capacity", None),
                ("f-relay-capacity-capped", Some(CAPACITY_SMALL_CAP))
            ]
        );
        // No other scenario touches its relay's cap, and a cap the fixture
        // sets is one the relay accepts.
        for plan in SCENARIOS.iter().filter(|plan| plan.page != Page::Capacity) {
            assert!(plan.slots.iter().all(|slot| slot.relay_clients.is_none()), "{}", plan.id);
        }
        assert!((1..=256).contains(&CAPACITY_SMALL_CAP));
    }

    #[test]
    fn mode_window_and_scenario_selection_fail_closed() {
        assert_eq!(window_ms(None).unwrap(), 12_000);
        assert_eq!(window_ms(Some("")).unwrap(), 12_000);
        assert_eq!(window_ms(Some("5000")).unwrap(), 5_000);
        for value in ["4999", "40001", "12s", "-1"] {
            assert!(window_ms(Some(value)).is_err(), "{value}");
        }
        assert!(only(None).unwrap().is_none());
        assert_eq!(
            only(Some("e-covered,baseline-visible,e-covered")).unwrap().unwrap(),
            ["e-covered", "baseline-visible"]
        );
        for value in ["unknown", "baseline-visible,", " baseline-visible"] {
            assert!(only(Some(value)).is_err(), "{value}");
        }
    }

    #[test]
    fn reports_are_bounded_labelled_and_never_keyed_by_page_text() {
        let mut state = ServerState::default();
        for body in [
            &br#"{"slot":"baseline-visible","kind":"final","atMs":1}"#[..],
            br#"{"slot":"Baseline Visible","kind":"final"}"#,
            br#"{"slot":"baseline-visible","kind":"<script>"}"#,
            br#"{"slot":"baseline-visible"}"#,
            b"not json",
        ] {
            state.accept_report(body);
        }
        assert_eq!(state.reports.len(), 1);
        assert_eq!(state.rejected_reports, 4);
        assert_eq!(state.reports[0].slot, "baseline-visible");
        for _ in 0..200 {
            state.accept_report(br#"{"slot":"a","kind":"sample"}"#);
        }
        assert_eq!(state.reports.len(), 128);
        assert_eq!(state.rejected_reports, 4 + 200 - 127);
    }

    #[test]
    fn stage_grants_carry_values_only_for_the_form_stage() {
        let policy = OriginBrowserPolicy::new("measure", "slot", "slot", ORIGIN).unwrap();
        let other = OriginBrowserPolicy::new("measure", "other", "other", ORIGIN).unwrap();
        let hooks = |adapter| Hooks {
            identity: policy.identity().clone(),
            adapter,
            consent_until: Instant::now() + CONSENT_LIFETIME,
            log: Arc::new(Mutex::new(SlotLog::new())),
        };
        fn request<'a>(
            identity: &'a BrowserIdentity,
            origin: &'a str,
            adapter: NativeLoginAdapter,
            stage: NativeLoginStage,
        ) -> NativeLoginRequest<'a> {
            NativeLoginRequest {
                identity,
                origin,
                adapter,
                stage,
                path: "/",
                frame: None,
            }
        }
        let modular = hooks(Adapter::ModularForm);
        for (stage, expected) in [
            (NativeLoginStage::FormPrepare, ("", "")),
            (NativeLoginStage::Form, (USERNAME, PASSWORD)),
            (NativeLoginStage::FormSubmit, ("", "")),
        ] {
            let mut seen = None;
            modular.with_form_credentials(
                &request(policy.identity(), ORIGIN, NativeLoginAdapter::ModularForm, stage),
                &mut |credentials, options| {
                    seen = Some((
                        credentials.username.to_owned(),
                        credentials.password.to_owned(),
                        options.map(str::to_owned),
                    ))
                },
            );
            let (username, password, options) = seen.unwrap();
            assert_eq!((username.as_str(), password.as_str()), expected);
            assert_eq!(options.as_deref(), Some(FORM_OPTIONS));
        }
        // Another attempt, another origin and a provider stage get nothing.
        for (identity, origin, stage) in [
            (other.identity(), ORIGIN, NativeLoginStage::Form),
            (policy.identity(), "https://frame.test", NativeLoginStage::Form),
            (policy.identity(), ORIGIN, NativeLoginStage::Password),
        ] {
            modular.with_form_credentials(
                &request(identity, origin, NativeLoginAdapter::ModularForm, stage),
                &mut |_, _| panic!("no grant expected"),
            );
        }
        let generic = hooks(Adapter::Generic);
        let mut delivered = 0;
        generic.with_form_credentials(
            &request(policy.identity(), ORIGIN, NativeLoginAdapter::Generic, NativeLoginStage::Form),
            &mut |credentials, options| {
                delivered += 1;
                assert_eq!(credentials.username, USERNAME);
                assert!(options.is_none());
            },
        );
        assert_eq!(delivered, 1);
        hooks(Adapter::Manual).with_form_credentials(
            &request(policy.identity(), ORIGIN, NativeLoginAdapter::Manual, NativeLoginStage::Form),
            &mut |_, _| panic!("manual slots never grant"),
        );
        assert_eq!(modular.log.lock().unwrap().credential_calls["form"], 1);
        for setup in [FORM_SETUP, FORM_OPTIONS] {
            assert!(serde_json::from_str::<serde_json::Value>(setup).unwrap().is_object());
        }
    }
}
