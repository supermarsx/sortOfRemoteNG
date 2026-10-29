//! Browser-process OTP keyboard pipeline. No seed or code in renderer IPC.
use super::*;
use crate::cef_renderer::message_text;
use crate::native_totp::input::{
    send_cef_login_character, NativeAuthTarget, NativeAuthTyping, TypingStatus,
};
use crate::native_totp::{self, NativeTotpCode, NativeTotpRequest};
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "cef_login_typing.rs"]
mod keyboard;

// While a manual-input slot owns the keyboard the renderer repeats a deferred
// start after this long, and the host re-evaluates a held request at this rate.
const INTERLOCK_WAIT_MS: i32 = 200;
// A stage request the interlock still holds after this long is abandoned.
const STAGE_HOLD: Duration = Duration::from_secs(30);
const MAX_HELD_STAGES: u8 = 8;
static NEXT_HOLD: AtomicU64 = AtomicU64::new(1);

/// How a login input request reached the host.
#[derive(Clone, Copy)]
struct Entry {
    /// A manual-input slot owns the keyboard right now.
    manual: bool,
    /// Serial of the held request this call resumes.
    held: Option<u64>,
}

#[derive(Debug, PartialEq, Eq)]
enum Pace {
    Send,
    Hold(Duration),
    Reject,
}

/// One request per key or submit. Renderer receipts are event-driven, so the
/// next request can arrive before the native pacing interval ends, and a
/// manual-input slot can own the keyboard: either way the request is held on
/// the UI thread and resumed, never dropped or cancelled. A second request
/// while one is held is a protocol violation.
fn pace(manual: bool, ready_in: Duration, held: Option<u64>, resumed: Option<u64>) -> Pace {
    if held != resumed {
        Pace::Reject
    } else if manual {
        Pace::Hold(Duration::from_millis(INTERLOCK_WAIT_MS as u64))
    } else if ready_in.is_zero() {
        Pace::Send
    } else {
        Pace::Hold(ready_in)
    }
}

fn next_hold() -> u64 {
    NEXT_HOLD.fetch_add(1, Ordering::Relaxed)
}

/// The renderer's request, kept only while the host holds it.
#[derive(Clone)]
struct HeldRequest {
    nonce: String,
    event: String,
    url: String,
    origin: String,
}

#[allow(clippy::too_many_arguments)]
fn hold(
    shared: &Arc<Shared>,
    browser: &Browser,
    frame: &Frame,
    nonce: &str,
    event: &str,
    url: &str,
    origin: &str,
    serial: u64,
    wait: Duration,
) -> bool {
    let request = HeldRequest {
        nonce: nonce.into(),
        event: event.into(),
        url: url.into(),
        origin: origin.into(),
    };
    let mut task = HeldInput::new(
        Arc::downgrade(shared),
        browser.clone(),
        frame.clone(),
        request,
        serial,
    );
    post_delayed_task(ThreadId::UI, Some(&mut task), wait.as_millis() as i64 + 1) == 1
}

#[derive(Debug, PartialEq, Eq)]
enum StageHold {
    Again,
    Resume,
    Abandon,
}

/// What a held stage request does when its timer fires.
fn stage_hold(manual: bool, now: Instant, until: Instant) -> StageHold {
    match (manual, now < until) {
        (false, _) => StageHold::Resume,
        (true, true) => StageHold::Again,
        (true, false) => StageHold::Abandon,
    }
}

// Saved automatic login belongs to the live attempt: hidden tabs, and views a
// shell dialog or menu covers. Overlays block manual input, focus and DevTools
// only; `accepts` keeps the owner and Attached/Hidden lifecycle fence, and each
// key still needs its consent and DOM receipt.
fn automatic_input_current(shared: &Shared, browser: &Browser) -> bool {
    shared.current() && shared.accepts(Some(browser))
}

#[derive(Default)]
pub(super) struct State {
    keyboard: keyboard::State,
    pending: Option<Pending>,
    starts: u8,
    held_stages: u8,
}

struct Pending {
    nonce: String,
    url: String,
    frame_id: String,
    generation: u64,
    challenge: String,
    typing: NativeAuthTyping,
    digits: u8,
    next: u8,
    expires: Instant,
    deadline: f64,
    auto_submit: bool,
    held: Option<u64>,
}

impl State {
    pub(super) fn cancel_frame(&mut self, frame_id: &str) {
        if self.pending.as_ref().is_some_and(|p| p.frame_id == frame_id) {
            self.pending = None;
        }
        self.keyboard.cancel_frame(frame_id);
    }

    pub(super) fn cancel(&mut self) {
        self.pending = None;
        self.keyboard.cancel();
    }

    /// A one-time code or a credential is being typed, or a stage request is
    /// held for the manual-input slot: a retry now would race that entry.
    pub(super) fn entering(&self) -> bool {
        self.pending.is_some() || self.keyboard.busy() || self.held_stages != 0
    }

    /// Explicit user retry allowance: the page may start code entry again.
    /// Which code, if any, is still decided by the owner's one-code grant.
    pub(super) fn rearm_code_entry(&mut self) {
        if self.pending.is_none() {
            self.starts = 0;
        }
    }

    /// Explicit user credentials retry: typing starts over with the budget.
    pub(super) fn restart_typing(&mut self) {
        self.keyboard.restart();
    }
}

/// Keep document checks separate from the non-reentrant consent boundary.
/// `document_current` must not call authority hooks: `with_totp` holds consent
/// valid throughout its synchronous delivery, including this document check.
struct TotpGate<'a> {
    hooks: &'a dyn NativeDocumentHooks,
    request: &'a NativeTotpRequest<'a>,
    document_current: &'a dyn Fn() -> bool,
}

impl TotpGate<'_> {
    fn current(&self, submit: bool) -> bool {
        (self.document_current)() && self.hooks.totp_current(self.request, submit)
    }

    fn with_code(&self, deliver: &mut dyn FnMut(NativeTotpCode<'_>)) -> Option<Duration> {
        if !(self.document_current)() {
            return None;
        }
        self.hooks.with_totp(self.request, &mut |code| {
            // Do not call current()/totp_current() here: the consent mutex is
            // already held by with_totp. Keep it held through borrowed delivery.
            if (self.document_current)() && Instant::now() < code.valid_until {
                deliver(code);
            }
        })
    }
}

fn command(event: &str) -> Option<(&str, &str, u8)> {
    if event.len() > 256 {
        return None;
    }
    let fields: Vec<_> = event.split('|').collect();
    if fields.len() != 4
        || fields[0] != "totp"
        || !matches!(fields[1], "start" | "key" | "finish" | "cancel")
        || fields[2].is_empty()
        || fields[2].len() > 128
        || !fields[2]
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return None;
    }
    let index = fields[3].parse::<u8>().ok().filter(|i| *i <= 8)?;
    if matches!(fields[1], "start" | "cancel") && index != 0 {
        return None;
    }
    Some((fields[1], fields[2], index))
}

#[allow(clippy::too_many_arguments)]
fn reply(
    frame: &Frame,
    nonce: &str,
    origin: &str,
    challenge: &str,
    action: &str,
    index: i32,
    deadline: f64,
    submit: bool,
) -> bool {
    let Some(mut message) = process_message_create(Some(&CefString::from(native_totp::DELIVERY)))
    else {
        return false;
    };
    let Some(args) = message.argument_list() else {
        return false;
    };
    if args.set_string(0, Some(&CefString::from(nonce))) != 1
        || args.set_string(1, Some(&CefString::from(origin))) != 1
        || args.set_string(2, Some(&CefString::from(action))) != 1
        || args.set_int(3, index) != 1
        || args.set_double(4, deadline) != 1
        || args.set_bool(5, i32::from(submit)) != 1
        || args.set_string(6, Some(&CefString::from(challenge))) != 1
    {
        return false;
    }
    frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
    true
}

impl Shared {
    pub(super) fn totp_message(
        self: &Arc<Self>,
        browser: &Browser,
        frame: &Frame,
        args: &ListValue,
        url: &str,
        origin: &str,
        manual: bool,
    ) {
        let (Some(nonce), Some(event)) = (message_text(args, 0, 80), message_text(args, 2, 256))
        else {
            return;
        };
        if nonce.is_empty() || message_text(args, 1, 1024).as_deref() != Some(origin) {
            return;
        }
        let entry = Entry { manual, held: None };
        self.login_input(browser, frame, &nonce, &event, url, origin, entry);
    }

    /// A stage was released to this frame's document. Until one of its keys is
    /// sent, a navigation that replaces the document ends the release unused.
    pub(super) fn login_released(
        &self,
        browser: &Browser,
        frame: &Frame,
        origin: &str,
        stage: NativeLoginStage,
    ) {
        if stage.is_action() {
            return;
        }
        let id = |frame: &Frame| CefString::from(&frame.identifier()).to_string();
        let main = browser.main_frame().map(|main| id(&main)).unwrap_or_default();
        if let Ok(mut state) = self.login_totp.lock() {
            state.keyboard.released(id(frame), main, origin, stage);
        }
    }

    /// A release that ended before its stage's first key entered nothing. Tell
    /// the budget before the reservation of `stage`, so that it can be re-armed.
    pub(super) fn settle_login_typing(&self, stage: NativeLoginStage) {
        let ended = self
            .login_totp
            .lock()
            .map(|mut state| state.keyboard.take_ended(stage == NativeLoginStage::FormPrepare))
            .unwrap_or_default();
        if ended.is_empty() {
            return;
        }
        if let Ok(mut budget) = self.login_budget.lock() {
            for (origin, stage) in ended {
                budget.cancelled(self.login_adapter, &origin, stage);
            }
        }
    }

    /// A stage request that met the manual-input interlock. Delivering it would
    /// make the page focus a login field under the manual slot, and the stage
    /// channel has no `wait` reply, so the host keeps the request and runs it
    /// again from the top once the slot has ended.
    pub(super) fn hold_stage(
        self: &Arc<Self>,
        browser: &Browser,
        frame: &Frame,
        nonce: &str,
        origin: &str,
        stage: NativeLoginStage,
    ) -> bool {
        let Ok(mut state) = self.login_totp.lock() else {
            return false;
        };
        if state.held_stages >= MAX_HELD_STAGES {
            return false;
        }
        let mut task = HeldStage::new(
            Arc::downgrade(self),
            browser.clone(),
            frame.clone(),
            nonce.into(),
            origin.into(),
            stage,
            Instant::now() + STAGE_HOLD,
        );
        if post_delayed_task(ThreadId::UI, Some(&mut task), INTERLOCK_WAIT_MS.into()) != 1 {
            return false;
        }
        state.held_stages += 1;
        true
    }

    fn resume_stage(
        self: &Arc<Self>,
        browser: &Browser,
        frame: &Frame,
        nonce: &str,
        origin: &str,
        stage: NativeLoginStage,
    ) {
        let Some(message) =
            process_message_create(Some(&CefString::from(crate::cef_renderer::LOGIN_REQUEST)))
        else {
            return;
        };
        let Some(args) = message.argument_list() else {
            return;
        };
        if args.set_string(0, Some(&CefString::from(nonce))) != 1
            || args.set_string(1, Some(&CefString::from(origin))) != 1
            || args.set_string(2, Some(&CefString::from(stage.wire()))) != 1
        {
            return;
        }
        // Every owner, document, origin and budget check runs again.
        self.login_message(Some(browser), Some(frame), ProcessId::RENDERER, Some(&message));
    }

    #[allow(clippy::too_many_arguments)]
    fn login_input(
        self: &Arc<Self>,
        browser: &Browser,
        frame: &Frame,
        nonce: &str,
        event: &str,
        url: &str,
        origin: &str,
        entry: Entry,
    ) {
        if event.starts_with("type|") {
            keyboard::receive(self, browser, frame, nonce, event, url, origin, entry);
            return;
        }
        let nonce = nonce.to_owned();
        // Credential typing shares this channel; automatic OTP consent remains
        // HTTPS-only even when the saved login source explicitly permits HTTP.
        if frame.is_main() != 1 || https_origin(url).as_deref() != Some(origin) {
            return;
        }
        let Some((action, challenge, index)) = command(event) else {
            return;
        };
        let Some(hooks) = &self.hooks else {
            return;
        };
        // Explicit manual entry owns the keyboard. A start repeats after the
        // delay without spending a start; a key or submit is held further down.
        if entry.manual && action == "start" {
            reply(frame, &nonce, origin, challenge, "wait", INTERLOCK_WAIT_MS, 0.0, false);
            return;
        }
        let request = NativeTotpRequest {
            identity: &self.identity,
            origin,
            document_url: url,
            challenge,
        };
        let generation = self
            .automation
            .lock()
            .ok()
            .filter(|s| s.available())
            .map(|s| s.generation);
        let Some(generation) = generation else {
            // The renderer can discover a challenge before load-end. Wait
            // without generating/caching a code or spending the one-shot grant.
            reply(
                frame,
                &nonce,
                origin,
                challenge,
                if action == "start" { "wait" } else { "cancel" },
                if action == "start" { 200 } else { 0 },
                0.0,
                false,
            );
            return;
        };
        let frame_id = CefString::from(&frame.identifier()).to_string();
        let document_current = || {
            automatic_input_current(self, browser)
                && frame.is_valid() == 1
                && frame.is_main() == 1
                && CefString::from(&frame.url()).to_string() == url
                && self
                    .automation
                    .lock()
                    .is_ok_and(|s| s.available() && s.generation == generation)
                && self.session.lock().is_ok_and(|s| {
                    navigation_allowed(&s, &self.identity, &self.permissions, url, true)
                })
        };
        let gate = TotpGate {
            hooks: hooks.as_ref(),
            request: &request,
            document_current: &document_current,
        };
        let current = || gate.current(false);
        let result = catch_unwind(AssertUnwindSafe(|| {
            let Ok(mut state) = self.login_totp.lock() else {
                return;
            };
            // Typing that was cancelled or replaced while its request was held.
            if entry.held.is_some()
                && state.pending.as_ref().and_then(|pending| pending.held) != entry.held
            {
                reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                return;
            }
            if action == "cancel" {
                if state.pending.as_ref().is_some_and(|p| p.nonce == nonce) {
                    state.cancel();
                }
                return;
            }
            if !current() {
                state.cancel();
                reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                return;
            }
            if action == "start" {
                if state.pending.is_some() || state.starts >= 2 {
                    state.cancel();
                    // Answered, never dropped: the renderer must not wait for expiry.
                    reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                    return;
                }
                state.starts += 1;
                let mut granted = false;
                let wait = gate.with_code(&mut |code| {
                    if granted
                        || !(6..=8).contains(&code.code.len())
                        || !code.code.bytes().all(|b| b.is_ascii_digit())
                    {
                        return;
                    }
                    granted = true;
                    let now = Instant::now();
                    let Some(typing) = NativeAuthTyping::new(
                        NativeAuthTarget {
                            identity: self.identity.clone(),
                            browser_id: browser.identifier(),
                            frame_id: frame_id.clone(),
                            document_sequence: generation,
                            document_url: url.into(),
                            field_token: nonce.clone(),
                        },
                        code.code,
                        Duration::from_millis(30),
                        now,
                        code.valid_until,
                    ) else {
                        return;
                    };
                    let Ok(wall) = (SystemTime::now()
                        + code.valid_until.saturating_duration_since(now))
                    .duration_since(UNIX_EPOCH) else {
                        return;
                    };
                    let deadline = wall.as_millis() as f64;
                    let pending = Pending {
                        nonce: nonce.clone(),
                        url: url.into(),
                        frame_id: frame_id.clone(),
                        generation,
                        challenge: challenge.into(),
                        typing,
                        digits: code.code.len() as u8,
                        next: 0,
                        expires: code.valid_until,
                        deadline,
                        auto_submit: code.auto_submit,
                        held: None,
                    };
                    let mut expiry = OtpExpiry::new(Arc::downgrade(self), nonce.clone());
                    if post_delayed_task(
                        ThreadId::UI,
                        Some(&mut expiry),
                        code.valid_until
                            .saturating_duration_since(now)
                            .as_millis()
                            .min(3_600_000) as i64
                            + 1,
                    ) != 1
                    {
                        return;
                    }
                    if reply(
                        frame,
                        &nonce,
                        origin,
                        challenge,
                        "probe",
                        0,
                        deadline,
                        code.auto_submit,
                    ) {
                        state.pending = Some(pending);
                    }
                });
                if state.pending.is_none() {
                    if let Some(wait) =
                        wait.filter(|w| !granted && !w.is_zero() && *w <= Duration::from_millis(33020))
                    {
                        reply(
                            frame,
                            &nonce,
                            origin,
                            challenge,
                            "wait",
                            wait.as_millis() as i32,
                            0.0,
                            false,
                        );
                    } else {
                        reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                    }
                }
                return;
            }
            let Some(pending) = state.pending.as_mut() else {
                // Typing was cancelled natively (navigation, manual entry, expiry).
                reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                return;
            };
            if pending.nonce != nonce
                || pending.url != url
                || pending.frame_id != frame_id
                || pending.generation != generation
                || pending.challenge != challenge
                || pending.next != index
                || Instant::now() >= pending.expires
            {
                state.cancel();
                reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                return;
            }
            let now = Instant::now();
            let ready_in = if action == "key" {
                pending.typing.ready_in(now)
            } else {
                Duration::ZERO
            };
            match pace(entry.manual, ready_in, pending.held, entry.held) {
                Pace::Send => pending.held = None,
                Pace::Hold(wait) => {
                    let serial = next_hold();
                    pending.held = Some(serial);
                    if !hold(self, browser, frame, &nonce, event, url, origin, serial, wait) {
                        state.cancel();
                        reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                    }
                    return;
                }
                Pace::Reject => {
                    state.cancel();
                    reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                    return;
                }
            }
            if action == "key" && index < pending.digits {
                let status = pending.typing.tick(
                    now,
                    |target| {
                        target.identity == self.identity
                            && target.document_sequence == generation
                            && target.field_token == nonce
                            && current()
                    },
                    |target, unit| send_cef_login_character(browser, target, unit),
                );
                if matches!(status, TypingStatus::Sent | TypingStatus::Complete) {
                    pending.next += 1;
                    if !reply(
                        frame,
                        &nonce,
                        origin,
                        challenge,
                        "probe",
                        pending.next.into(),
                        pending.deadline,
                        pending.auto_submit,
                    ) {
                        state.cancel();
                    }
                } else {
                    state.cancel();
                    reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                }
            } else if action == "finish"
                && index == pending.digits
                && pending.auto_submit
                && hooks.totp_current(&request, true)
            {
                let deadline = pending.deadline;
                state.cancel();
                if current() {
                    reply(
                        frame,
                        &nonce,
                        origin,
                        challenge,
                        "submit",
                        index.into(),
                        deadline,
                        true,
                    );
                }
            } else {
                state.cancel();
            }
        }));
        if result.is_err() {
            self.fault(Some(browser), BrowserFault::Callback);
        }
    }
}

wrap_task! {
    struct HeldInput {
        shared: std::sync::Weak<Shared>, browser: Browser, frame: Frame,
        request: HeldRequest, serial: u64
    }
    impl Task {
        fn execute(&self) {
            if let Some(shared) = self.shared.upgrade() {
                // Every owner, document and consent check runs again on resume.
                let entry = Entry { manual: manual_input::active(&shared), held: Some(self.serial) };
                let HeldRequest { nonce, event, url, origin } = &self.request;
                shared.login_input(&self.browser, &self.frame, nonce, event, url, origin, entry);
            }
        }
    }
}

wrap_task! {
    struct HeldStage {
        shared: std::sync::Weak<Shared>, browser: Browser, frame: Frame,
        nonce: String, origin: String, stage: NativeLoginStage, until: Instant
    }
    impl Task {
        fn execute(&self) {
            let Some(shared) = self.shared.upgrade() else { return; };
            let mut outcome = stage_hold(manual_input::active(&shared), Instant::now(), self.until);
            if outcome == StageHold::Again {
                let mut again = HeldStage::new(self.shared.clone(), self.browser.clone(), self.frame.clone(),
                    self.nonce.clone(), self.origin.clone(), self.stage, self.until);
                if post_delayed_task(ThreadId::UI, Some(&mut again), INTERLOCK_WAIT_MS.into()) == 1 { return; }
                outcome = StageHold::Abandon;
            }
            if let Ok(mut state) = shared.login_totp.lock() {
                state.held_stages = state.held_stages.saturating_sub(1);
            }
            if outcome == StageHold::Resume {
                shared.resume_stage(&self.browser, &self.frame, &self.nonce, &self.origin, self.stage);
            } else {
                // Reported, and never delivered under the manual slot.
                shared.feature_event(Some(&self.browser), &self.origin, NativeFeatureStatus::LoginDelivery(
                    crate::native_features::NativeLoginDeliveryStatus::NativeNotDelivered));
            }
        }
    }
}

wrap_task! {
    struct OtpExpiry { shared: std::sync::Weak<Shared>, nonce: String }
    impl Task {
        fn execute(&self) {
            if let Some(shared) = self.shared.upgrade() {
                if let Ok(mut state) = shared.login_totp.lock() {
                    if state.pending.as_ref().is_some_and(|p| p.nonce == self.nonce && Instant::now() >= p.expires) { state.cancel(); }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_protocols::origin_browser::OriginBrowserPolicy;
    use std::sync::atomic::AtomicUsize;

    #[tokio::test]
    async fn background_login_keeps_owner_and_input_guards_without_granting_focus() {
        struct Sink;
        impl BrowserEventSink for Sink { fn on_event(&self, _: BrowserEvent) {} }
        let shared = super::super::tests::fixture(Arc::new(Sink)).await;
        shared.state.lock().unwrap().browser_id = Some(41);
        let browser = super::super::tests::focus_browser(1, 41);
        assert!(automatic_input_current(&shared, &browser));
        shared.state.lock().unwrap().control.hide(&shared.identity).unwrap();
        assert!(automatic_input_current(&shared, &browser));
        assert!(!shared.focus_allowed(Some(&browser)));
        shared.input_blocked.store(true, Ordering::Release);
        assert!(automatic_input_current(&shared, &browser));
        assert!(!shared.focus_allowed(Some(&browser)));
        shared.state.lock().unwrap().control.show(&shared.identity).unwrap();
        assert!(automatic_input_current(&shared, &browser));
        assert!(!shared.focus_allowed(Some(&browser)));
        shared.state.lock().unwrap().control.hide(&shared.identity).unwrap();
        shared.input_blocked.store(false, Ordering::Release);
        assert!(automatic_input_current(&shared, &browser));
        for other in [super::super::tests::focus_browser(1, 42), super::super::tests::focus_browser(0, 41)] {
            assert!(!automatic_input_current(&shared, &other));
        }
        shared.session.lock().unwrap().revoke(&shared.identity).unwrap();
        assert!(!automatic_input_current(&shared, &browser));
    }

    // Finding M1: a shell dialog or menu, often raised for another tab, blocks
    // input to this visible view. It must not cancel this tab's saved login.
    #[tokio::test]
    async fn shell_overlay_blocks_focus_but_not_saved_login_typing_in_an_attached_view() {
        struct Sink;
        impl BrowserEventSink for Sink { fn on_event(&self, _: BrowserEvent) {} }
        let shared = super::super::tests::fixture(Arc::new(Sink)).await;
        shared.state.lock().unwrap().browser_id = Some(41);
        let browser = super::super::tests::focus_browser(1, 41);
        assert_eq!(shared.state.lock().unwrap().control.lifecycle(), Lifecycle::Attached);
        for blocked in [false, true, false] {
            shared.input_blocked.store(blocked, Ordering::Release);
            assert_eq!(shared.focus_allowed(Some(&browser)), !blocked);
            assert!(automatic_input_current(&shared, &browser), "blocked: {blocked}");
        }
        // The overlay changes nothing about the owner and lifecycle fences.
        shared.input_blocked.store(true, Ordering::Release);
        for other in [super::super::tests::focus_browser(1, 42), super::super::tests::focus_browser(0, 41)] {
            assert!(!automatic_input_current(&shared, &other));
        }
        shared.state.lock().unwrap().control.begin_close(&shared.identity).unwrap();
        assert!(!automatic_input_current(&shared, &browser));
    }

    #[test]
    fn a_retry_waits_for_entry_and_rearms_only_code_entry_starts() {
        let mut state = State::default();
        assert!(!state.entering());
        state.starts = 2;
        state.rearm_code_entry();
        assert_eq!(state.starts, 0);
        // A held stage request is about to type: a retry would race it.
        state.held_stages = 1;
        assert!(state.entering());
        state.held_stages = 0;
        state.restart_typing();
        assert!(!state.entering());
    }

    #[test]
    fn early_and_interlocked_requests_are_held_for_resumption_instead_of_cancelled() {
        let (early, slot) = (Duration::from_millis(20), Duration::from_millis(INTERLOCK_WAIT_MS as u64));
        assert_eq!(pace(false, Duration::ZERO, None, None), Pace::Send);
        // Event-driven receipts ask for the next key before the pacing interval ends.
        assert_eq!(pace(false, early, None, None), Pace::Hold(early));
        // The held request resumes under its own serial, and may be held again.
        assert_eq!(pace(false, Duration::ZERO, Some(7), Some(7)), Pace::Send);
        assert_eq!(pace(false, Duration::from_millis(3), Some(7), Some(7)), Pace::Hold(Duration::from_millis(3)));
        // A manual-input slot owns the keyboard: nothing is sent, whatever the pacing says.
        for ready_in in [Duration::ZERO, early] {
            assert_eq!(pace(true, ready_in, None, None), Pace::Hold(slot));
            assert_eq!(pace(true, ready_in, Some(7), Some(7)), Pace::Hold(slot));
        }
        // One request per key: a second one while the first is held is refused.
        for manual in [false, true] {
            assert_eq!(pace(manual, early, Some(7), None), Pace::Reject);
            assert_eq!(pace(manual, Duration::ZERO, Some(7), None), Pace::Reject);
            assert_eq!(pace(manual, Duration::ZERO, Some(8), Some(7)), Pace::Reject);
            assert_eq!(pace(manual, Duration::ZERO, None, Some(7)), Pace::Reject);
        }
        assert_ne!(next_hold(), next_hold());
    }

    #[test]
    fn a_held_stage_request_resumes_when_the_slot_ends_and_is_abandoned_at_its_bound() {
        let now = Instant::now();
        let (before, after) = (now + Duration::from_millis(1), now);
        assert_eq!(stage_hold(true, now, before), StageHold::Again);
        assert_eq!(stage_hold(true, now, after), StageHold::Abandon);
        // The slot ended: the request runs, however long it was held.
        assert_eq!(stage_hold(false, now, before), StageHold::Resume);
        assert_eq!(stage_hold(false, now, after), StageHold::Resume);
        assert!(STAGE_HOLD >= Duration::from_millis(INTERLOCK_WAIT_MS as u64) && MAX_HELD_STAGES > 0);
    }

    use cef::rc::{ConvertReturnValue, RcImpl};
    use cef::sys::{_cef_browser_t, _cef_frame_t, cef_string_userfree_t};

    pub(super) type Replies = Arc<Mutex<Vec<(String, i32, String)>>>;
    // What the library-owned vtables below serve: recorded replies and a URL.
    type Document = (Replies, String);

    fn userfree(value: &str) -> cef_string_userfree_t {
        let value: Vec<_> = value.encode_utf16().collect();
        // SAFETY: CEF allocates and later frees the returned string.
        unsafe {
            let out = cef::sys::cef_string_userfree_utf16_alloc();
            assert!(!out.is_null());
            assert_eq!(cef::sys::cef_string_utf16_set(value.as_ptr(), value.len(), out, 1), 1);
            out
        }
    }

    // A valid main frame "login-frame" of browser 41 at the document URL. It
    // records (action, index, role) of each native reply.
    fn raw_frame(document: Document) -> *mut _cef_frame_t {
        use cef::sys::{_cef_process_message_t, cef_process_id_t};
        extern "C" fn one(_: *mut _cef_frame_t) -> i32 { 1 }
        extern "C" fn identifier(_: *mut _cef_frame_t) -> cef_string_userfree_t { userfree("login-frame") }
        extern "C" fn url(this: *mut _cef_frame_t) -> cef_string_userfree_t {
            userfree(&RcImpl::<_cef_frame_t, Document>::get(this).interface.1)
        }
        extern "C" fn browser(this: *mut _cef_frame_t) -> *mut _cef_browser_t {
            raw_browser(RcImpl::<_cef_frame_t, Document>::get(this).interface.clone())
        }
        extern "C" fn send(this: *mut _cef_frame_t, _: cef_process_id_t, message: *mut _cef_process_message_t) {
            // The generated binding transfers one reference with the argument.
            let message: ProcessMessage = message.wrap_result();
            let args = message.argument_list().unwrap();
            RcImpl::<_cef_frame_t, Document>::get(this).interface.0.lock().unwrap().push((
                CefString::from(&args.string(2)).to_string(),
                args.int(3),
                CefString::from(&args.string(6)).to_string(),
            ));
        }
        let raw = _cef_frame_t {
            is_valid: Some(one), is_main: Some(one), get_identifier: Some(identifier),
            get_url: Some(url), get_browser: Some(browser), send_process_message: Some(send),
            // SAFETY: Unused vtable slots are nullable; RcImpl owns refcounting.
            ..unsafe { std::mem::zeroed() }
        };
        RcImpl::new(raw, document).cast()
    }

    // Browser 41, whose main and only frame is the one above.
    fn raw_browser(document: Document) -> *mut _cef_browser_t {
        extern "C" fn valid(_: *mut _cef_browser_t) -> i32 { 1 }
        extern "C" fn identifier(_: *mut _cef_browser_t) -> i32 { 41 }
        extern "C" fn same(_: *mut _cef_browser_t, that: *mut _cef_browser_t) -> i32 {
            // The generated binding transfers one reference with the argument.
            if !that.is_null() { let _: Browser = that.wrap_result(); }
            1
        }
        extern "C" fn main_frame(this: *mut _cef_browser_t) -> *mut _cef_frame_t {
            raw_frame(RcImpl::<_cef_browser_t, Document>::get(this).interface.clone())
        }
        extern "C" fn frame_by_identifier(this: *mut _cef_browser_t, _: *const cef::sys::cef_string_t) -> *mut _cef_frame_t {
            main_frame(this)
        }
        let raw = _cef_browser_t {
            is_valid: Some(valid), get_identifier: Some(identifier), is_same: Some(same),
            get_main_frame: Some(main_frame), get_frame_by_identifier: Some(frame_by_identifier),
            // SAFETY: Unused vtable slots are nullable; RcImpl owns refcounting.
            ..unsafe { std::mem::zeroed() }
        };
        RcImpl::new(raw, document).cast()
    }

    /// A frame that only records native replies; it has no document URL, so no
    /// login origin. No renderer, window or website is involved.
    pub(super) fn reply_frame(replies: Replies) -> Frame {
        raw_frame((replies, String::new())).wrap_result()
    }

    /// Browser 41 and its main frame at `url`, as the login frame policy and
    /// the typing gate read them. No renderer, window or website is involved.
    pub(super) fn login_document(replies: Replies, url: &str) -> (Browser, Frame) {
        let document = (replies, url.to_owned());
        (raw_browser(document.clone()).wrap_result(), raw_frame(document).wrap_result())
    }

    pub(super) fn native_api() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        crate::bootstrap_platform::select_pinned_api().unwrap();
    }

    // A modular document that was released only its prepare stage and then
    // navigated away used to block every later document of that origin: the
    // user saw one automatic login and then none for the rest of the tab.
    #[tokio::test]
    async fn a_prepare_only_document_that_was_replaced_does_not_block_its_successor() {
        use crate::domain_permissions::{
            WebsitePermissionDecision, WebsitePermissionEngine, WebsiteRequestClass,
        };
        use sorng_protocols::origin_browser::NativeHostReadiness;
        struct Sink;
        impl BrowserEventSink for Sink { fn on_event(&self, _: BrowserEvent) {} }
        struct Hooks;
        impl NativeDocumentHooks for Hooks {
            fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}
            fn with_form_credentials(
                &self,
                request: &NativeLoginRequest<'_>,
                deliver: &mut dyn FnMut(NativeLoginCredentials<'_>, Option<&str>),
            ) {
                let secret = request.stage == NativeLoginStage::Form;
                deliver(NativeLoginCredentials {
                    identity: request.identity, origin: request.origin,
                    valid_until: Instant::now() + Duration::from_secs(30),
                    username: if secret { "synthetic-user" } else { "" },
                    password: if secret { "synthetic-password" } else { "" },
                    auto_submit: true,
                }, Some(crate::cef_renderer::DEFAULT_FORM_OPTIONS));
            }
        }
        native_api();
        let mut shared = super::super::tests::fixture(Arc::new(Sink)).await;
        shared.hooks = Some(Arc::new(Hooks));
        shared.login_adapter = NativeLoginAdapter::ModularForm;
        shared.permissions = Arc::new(WebsitePermissionEngine::new(None, None,
            &[(WebsiteRequestClass::Navigation, WebsitePermissionDecision::Allow)].into_iter().collect(),
        ).unwrap());
        shared.state.lock().unwrap().browser_id = Some(41);
        {
            // Pure admission fixture, never evidence of live containment.
            let mut session = shared.session.lock().unwrap();
            let report = NativeHostReadiness::Ready {
                profile_key: session.policy().profile_key().to_owned(),
                proxy_endpoint: session.proxy_endpoint(),
            };
            session.report_host(&shared.identity, report).unwrap();
        }
        let shared = Arc::new(shared);
        let (origin, url) = ("https://fixture.invalid", "https://fixture.invalid/login.html");
        let replies = Replies::default();
        let (browser, frame) = login_document(replies.clone(), url);
        let request = |nonce: &str, stage: &str, manual: bool| {
            let message = process_message_create(Some(&CefString::from(crate::cef_renderer::LOGIN_REQUEST))).unwrap();
            let args = message.argument_list().unwrap();
            for (index, value) in [nonce, origin, stage].into_iter().enumerate() {
                assert_eq!(args.set_string(index, Some(&CefString::from(value))), 1);
            }
            assert_eq!(shared.login_request(Some(&browser), Some(&frame), ProcessId::RENDERER, Some(&message), manual), 1);
        };
        // The stage of each delivery sent to the renderer, in order.
        let delivered = || replies.lock().unwrap().iter().map(|reply| reply.2.clone()).collect::<Vec<_>>();
        // What on_before_browse does when the login frame navigates or reloads.
        let replace_document = || shared.login_totp.lock().unwrap().cancel_frame("login-frame");

        request("document-1", "form-prepare", false);
        assert_eq!(delivered(), ["form-prepare"]);
        // While that document is in place its release stays exclusive.
        request("document-2", "form-prepare", false);
        assert_eq!(delivered(), ["form-prepare"]);

        replace_document();
        // Nothing is consumed or re-armed while a manual-input slot is active.
        request("document-2", "form-prepare", true);
        assert_eq!(delivered(), ["form-prepare"]);
        assert!(shared.login_budget.lock().unwrap().released(origin, NativeLoginStage::FormPrepare));
        // The successor gets the chain once more, and its fill.
        request("document-2", "form-prepare", false);
        request("document-2", "form", false);
        assert_eq!(delivered(), ["form-prepare", "form-prepare", "form"]);

        // Once: a third document is refused, whatever its predecessor reached.
        replace_document();
        request("document-3", "form-prepare", false);
        request("document-3", "form", false);
        assert_eq!(delivered().len(), 3);
    }

    // on_before_browse runs before the navigation is allowed. A document whose
    // navigation was refused is still in place and must keep its prepare.
    #[tokio::test]
    async fn a_refused_navigation_does_not_cost_a_prepared_document_its_fill() {
        use crate::domain_permissions::{
            WebsitePermissionDecision, WebsitePermissionEngine, WebsiteRequestClass,
        };
        use sorng_protocols::origin_browser::NativeHostReadiness;
        struct Sink;
        impl BrowserEventSink for Sink { fn on_event(&self, _: BrowserEvent) {} }
        struct Hooks;
        impl NativeDocumentHooks for Hooks {
            fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}
            fn with_form_credentials(
                &self,
                request: &NativeLoginRequest<'_>,
                deliver: &mut dyn FnMut(NativeLoginCredentials<'_>, Option<&str>),
            ) {
                let secret = request.stage == NativeLoginStage::Form;
                deliver(NativeLoginCredentials {
                    identity: request.identity, origin: request.origin,
                    valid_until: Instant::now() + Duration::from_secs(30),
                    username: if secret { "synthetic-user" } else { "" },
                    password: if secret { "synthetic-password" } else { "" },
                    auto_submit: true,
                }, Some(crate::cef_renderer::DEFAULT_FORM_OPTIONS));
            }
        }
        native_api();
        let mut shared = super::super::tests::fixture(Arc::new(Sink)).await;
        shared.hooks = Some(Arc::new(Hooks));
        shared.login_adapter = NativeLoginAdapter::ModularForm;
        shared.permissions = Arc::new(WebsitePermissionEngine::new(None, None,
            &[(WebsiteRequestClass::Navigation, WebsitePermissionDecision::Allow)].into_iter().collect(),
        ).unwrap());
        shared.state.lock().unwrap().browser_id = Some(41);
        {
            // Pure admission fixture, never evidence of live containment.
            let mut session = shared.session.lock().unwrap();
            let report = NativeHostReadiness::Ready {
                profile_key: session.policy().profile_key().to_owned(),
                proxy_endpoint: session.proxy_endpoint(),
            };
            session.report_host(&shared.identity, report).unwrap();
        }
        let shared = Arc::new(shared);
        let (origin, url) = ("https://fixture.invalid", "https://fixture.invalid/login.html");
        let replies = Replies::default();
        let (browser, frame) = login_document(replies.clone(), url);
        let request = |stage: &str| {
            let message = process_message_create(Some(&CefString::from(crate::cef_renderer::LOGIN_REQUEST))).unwrap();
            let args = message.argument_list().unwrap();
            for (index, value) in ["document-1", origin, stage].into_iter().enumerate() {
                assert_eq!(args.set_string(index, Some(&CefString::from(value))), 1);
            }
            assert_eq!(shared.login_request(Some(&browser), Some(&frame), ProcessId::RENDERER, Some(&message), false), 1);
        };
        request("form-prepare");
        shared.login_totp.lock().unwrap().cancel_frame("login-frame");
        request("form");
        let delivered: Vec<_> = replies.lock().unwrap().iter().map(|reply| reply.2.clone()).collect();
        assert_eq!(delivered, ["form-prepare", "form"]);
    }

    // Finding C7: the interlock used to drop these messages without a reply,
    // stalling an in-flight automatic login until its own expiry.
    #[tokio::test]
    async fn manual_entry_defers_an_otp_start_with_wait_and_still_honours_cancel() {
        struct Sink;
        impl BrowserEventSink for Sink { fn on_event(&self, _: BrowserEvent) {} }
        struct Hooks;
        impl NativeDocumentHooks for Hooks { fn on_main_document(&self, _: &BrowserIdentity, _: u64) {} }
        native_api();
        let mut shared = super::super::tests::fixture(Arc::new(Sink)).await;
        shared.hooks = Some(Arc::new(Hooks));
        shared.state.lock().unwrap().browser_id = Some(41);
        let shared = Arc::new(shared);
        let browser = super::super::tests::focus_browser(1, 41);
        let replies = Replies::default();
        let frame = reply_frame(replies.clone());
        let (origin, url) = ("https://fixture.invalid", "https://fixture.invalid/user/two_factor");
        let manual = Entry { manual: true, held: None };
        let send = |event: &str, origin: &str| shared.login_input(&browser, &frame, "document-1", event, url, origin, manual);

        send("totp|start|gitea-totp|0", origin);
        send("totp|start|gitea-totp|0", origin);
        assert_eq!(*replies.lock().unwrap(), vec![("wait".to_owned(), INTERLOCK_WAIT_MS, "gitea-totp".to_owned()); 2]);
        // Deferred, not spent: the two starts of this attempt are still available.
        assert_eq!(shared.login_totp.lock().unwrap().starts, 0);

        // Malformed or foreign-origin requests still get nothing at all.
        send("totp|key|UPPER|0", origin);
        send("totp|start|gitea-totp|0", "https://other.invalid");
        assert_eq!(replies.lock().unwrap().len(), 2);

        // A cancel is never deferred: it only clears native state.
        let now = Instant::now();
        shared.login_totp.lock().unwrap().pending = Some(Pending {
            nonce: "document-1".into(), url: url.into(), frame_id: "login-frame".into(), generation: 0,
            challenge: "gitea-totp".into(),
            typing: NativeAuthTyping::new(NativeAuthTarget {
                identity: shared.identity.clone(), browser_id: 41, frame_id: "login-frame".into(),
                document_sequence: 0, document_url: url.into(), field_token: "document-1".into(),
            }, "123456", Duration::from_millis(30), now, now + Duration::from_secs(30)).unwrap(),
            digits: 6, next: 0, expires: now + Duration::from_secs(30), deadline: 1.0,
            auto_submit: false, held: None,
        });
        send("totp|cancel|gitea-totp|0", origin);
        assert!(shared.login_totp.lock().unwrap().pending.is_none());
        assert_eq!(replies.lock().unwrap().len(), 2);
    }

    struct LockedConsentHooks {
        active: Mutex<bool>,
        document_current: AtomicBool,
        invalidate_document_on_delivery: bool,
        expired: bool,
        consent_checks: AtomicUsize,
    }

    impl LockedConsentHooks {
        fn new() -> Self {
            Self {
                active: Mutex::new(true),
                document_current: AtomicBool::new(true),
                invalidate_document_on_delivery: false,
                expired: false,
                consent_checks: AtomicUsize::new(0),
            }
        }
    }

    impl NativeDocumentHooks for LockedConsentHooks {
        fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}

        fn totp_current(&self, _: &NativeTotpRequest<'_>, submit: bool) -> bool {
            self.consent_checks.fetch_add(1, Ordering::Relaxed);
            // Fail immediately instead of hanging the suite if the production
            // gate ever re-enters consent while borrowed delivery holds it.
            let active = self.active.try_lock().expect("reentrant consent check");
            *active && !self.expired && !submit
        }

        fn with_totp(
            &self,
            _: &NativeTotpRequest<'_>,
            deliver: &mut dyn FnMut(NativeTotpCode<'_>),
        ) -> Option<Duration> {
            let active = self.active.try_lock().expect("reentrant consent delivery");
            if *active {
                if self.invalidate_document_on_delivery {
                    self.document_current.store(false, Ordering::Release);
                }
                deliver(NativeTotpCode {
                    code: "123456",
                    valid_until: if self.expired {
                        Instant::now() - Duration::from_secs(1)
                    } else {
                        Instant::now() + Duration::from_secs(30)
                    },
                    auto_submit: false,
                });
            }
            None
        }
    }

    fn gate_request(identity: &BrowserIdentity) -> NativeTotpRequest<'_> {
        NativeTotpRequest {
            identity,
            origin: "https://fixture.invalid",
            document_url: "https://fixture.invalid/user/two_factor",
            challenge: "gitea-totp",
        }
    }

    #[test]
    fn otp_delivery_keeps_consent_locked_without_reentering_it() {
        let policy = OriginBrowserPolicy::new(
            "owner", "connection", "tab", "https://fixture.invalid",
        ).unwrap();
        let request = gate_request(policy.identity());
        let hooks = LockedConsentHooks::new();
        let document_checks = AtomicUsize::new(0);
        let document_current = || {
            document_checks.fetch_add(1, Ordering::Relaxed);
            hooks.document_current.load(Ordering::Acquire)
        };
        let gate = TotpGate { hooks: &hooks, request: &request, document_current: &document_current };
        let state = Mutex::new(State::default());
        let _state = state.lock().unwrap(); // Same outer lock as totp_message.
        assert!(gate.current(false));
        let mut deliveries = 0;
        assert!(gate.with_code(&mut |code| {
            assert!(hooks.active.try_lock().is_err(), "consent must cover delivery");
            assert_eq!(code.code.len(), 6);
            assert!(!code.auto_submit);
            deliveries += 1;
        }).is_none());
        assert_eq!(deliveries, 1);
        assert_eq!(document_checks.load(Ordering::Relaxed), 3);
        assert_eq!(hooks.consent_checks.load(Ordering::Relaxed), 1);
        assert!(gate.current(false)); // Subsequent keys still recheck consent.
        assert!(!gate.current(true)); // Manual-submit grant cannot submit.
        *hooks.active.lock().unwrap() = false;
        assert!(!gate.current(false));
        assert!(!gate.current(true));
        gate.with_code(&mut |_| panic!("revoked consent delivered"));
    }

    #[test]
    fn otp_delivery_rechecks_document_and_expiry_inside_the_consent_boundary() {
        let policy = OriginBrowserPolicy::new(
            "owner", "connection", "tab", "https://fixture.invalid",
        ).unwrap();
        let request = gate_request(policy.identity());
        for mode in 0..3 {
            let mut hooks = LockedConsentHooks::new();
            hooks.document_current.store(mode != 0, Ordering::Release);
            hooks.invalidate_document_on_delivery = mode == 1;
            hooks.expired = mode == 2;
            let document_current = || hooks.document_current.load(Ordering::Acquire);
            let gate = TotpGate { hooks: &hooks, request: &request, document_current: &document_current };
            gate.with_code(&mut |_| panic!("stale document or expired code delivered"));
            assert!(hooks.active.try_lock().is_ok());
        }
    }

    #[test]
    fn otp_start_cannot_reuse_consent_revoked_after_the_initial_check() {
        let policy = OriginBrowserPolicy::new(
            "owner", "connection", "tab", "https://fixture.invalid",
        ).unwrap();
        let request = gate_request(policy.identity());
        let hooks = LockedConsentHooks::new();
        let gate = TotpGate { hooks: &hooks, request: &request, document_current: &|| true };
        assert!(gate.current(false));
        *hooks.active.lock().unwrap() = false;
        gate.with_code(&mut |_| panic!("initial check must not cache consent"));
        assert!(!gate.current(false));
    }

    #[test]
    fn otp_messages_are_bounded_and_cannot_smuggle_credentials_or_another_stage() {
        assert_eq!(
            command("totp|key|gitea-totp|5"),
            Some(("key", "gitea-totp", 5))
        );
        for invalid in [
            "totp|start|gitea-totp|1",
            "totp|password|gitea-totp|0",
            "totp|key|gitea-totp|9",
            "totp|key|gitea-totp|0|secret",
            "totp|key||0",
            "totp|key|UPPER|0",
        ] {
            assert!(command(invalid).is_none());
        }
    }
}
