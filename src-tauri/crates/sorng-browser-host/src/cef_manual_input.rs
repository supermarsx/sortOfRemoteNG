//! Native one-shot manual input. No script grants or automatic-login authority.
use super::*;
use crate::native_manual_input::{
    self as wire, ManualInputAction, ManualInputResponse, TypingMode,
};
use crate::native_totp::input::{
    send_cef_character, NativeAuthTarget, NativeAuthTyping, TypingStatus,
};
use std::{
    cell::RefCell,
    sync::Weak,
    time::{SystemTime, UNIX_EPOCH},
};

pub type ManualInputGuard = Arc<dyn Fn() -> bool + Send + Sync>;
pub type ManualInputCompletion = Box<dyn FnOnce(Result<ManualInputResponse, &'static str>) + Send>;
const STALE: &str = "stale";
const FIELD: &str = "focus-lost";
static NEXT: AtomicU64 = AtomicU64::new(1);
#[derive(PartialEq, Eq)]
enum Phase {
    Capture,
    Ready,
    Restore,
    Check,
}
fn pending_receipt(phase: &Phase, deadline: Instant, reason: &str, now: Instant) -> bool {
    reason == "pending" && *phase == Phase::Check && now < deadline
}
fn capture_frame(focused: Option<Frame>) -> Result<Option<Frame>, &'static str> {
    if focused
        .as_ref()
        .is_some_and(|frame| frame.is_valid() == 1 && frame.is_main() != 1)
    {
        return Err("unsupported-frame");
    }
    Ok(focused.filter(|frame| frame.is_valid() == 1 && frame.is_main() == 1))
}
struct Slot {
    owner: Weak<Shared>,
    browser: Browser,
    frame: Frame,
    url: String,
    generation: u64,
    capture: String,
    serial: u64,
    phase: Phase,
    deadline: Instant,
    ack_deadline: Instant,
    guard: ManualInputGuard,
    callback: Option<ManualInputCompletion>,
    input: Option<NativeAuthTyping>,
    validity: Option<(u64, u64)>,
    last_clock: u64,
    complete: bool,
    interval_ms: i64,
    receipt_deadline: Instant,
}
thread_local! { static SLOTS: RefCell<HashMap<usize,Slot>> = RefCell::new(HashMap::new()); }
fn key(shared: &Shared) -> usize {
    shared as *const Shared as usize
}
pub(super) fn active(shared: &Shared) -> bool {
    currently_on(ThreadId::UI) == 1 && SLOTS.with(|s| s.borrow().contains_key(&key(shared)))
}
fn clock() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}
fn callback(slot: &mut Slot, result: Result<ManualInputResponse, &'static str>) {
    if let Some(cb) = slot.callback.take() {
        let _ = catch_unwind(AssertUnwindSafe(|| cb(result)));
    }
}
fn dispatch(slot: &mut Slot, action: &str) -> bool {
    slot.serial = NEXT.fetch_add(1, Ordering::Relaxed);
    slot.ack_deadline = Instant::now() + Duration::from_secs(3);
    let Some(mut message) = process_message_create(Some(&CefString::from(wire::REQUEST))) else {
        return false;
    };
    let Some(args) = message.argument_list() else {
        return false;
    };
    let length = slot.input.as_ref().map_or(0, |i| i.units_sent()) as i32;
    if args.set_string(0, Some(&CefString::from(slot.capture.as_str()))) != 1
        || args.set_string(1, Some(&CefString::from(action))) != 1
        || args.set_int(2, length) != 1
        || args.set_string(3, Some(&CefString::from(slot.serial.to_string().as_str()))) != 1
    {
        return false;
    }
    slot.frame
        .send_process_message(ProcessId::RENDERER, Some(&mut message));
    true
}
fn retire(mut slot: Slot, error: Option<&'static str>) {
    // Erase native text before a renderer cancellation or arbitrary owner callback.
    slot.input = None;
    let _ = dispatch(&mut slot, "cancel");
    let response = ManualInputResponse {
        status: if error.is_some() {
            "cancelled"
        } else {
            "complete"
        },
        capture_id: slot.capture.clone(),
    };
    callback(&mut slot, error.map_or(Ok(response), Err));
}
fn wait_for_field(mut slot: Slot) {
    // A denied DOM capture is expected while the user selects an empty field.
    // Retire its renderer receipt; a later poll must capture anew. This path
    // never runs after text delivery or for an invalid owner/document reply.
    debug_assert!(slot.phase == Phase::Capture && slot.input.is_none());
    let _ = dispatch(&mut slot, "cancel");
    callback(&mut slot, Ok(ManualInputResponse::waiting()));
}
fn reap_dead_owners() {
    let dead = SLOTS.with(|slots| {
        let mut slots = slots.borrow_mut();
        let keys = slots
            .iter()
            .filter(|(_, slot)| slot.owner.upgrade().is_none())
            .map(|(key, _)| *key)
            .collect::<Vec<_>>();
        keys.into_iter()
            .filter_map(|key| slots.remove(&key))
            .collect::<Vec<_>>()
    });
    for slot in dead {
        retire(slot, Some(STALE));
    }
}
fn current(slot: &Slot, require_input: bool) -> bool {
    let Some(shared) = slot.owner.upgrade() else {
        return false;
    };
    shared.current()
        && (slot.guard)()
        && shared.accepts(Some(&slot.browser))
        && (!require_input || !shared.input_blocked.load(Ordering::Acquire))
        && slot.frame.is_valid() == 1
        && slot.frame.is_main() == 1
        && CefString::from(&slot.frame.url()).to_string() == slot.url
        && shared.session.lock().is_ok_and(|session| {
            wire::document_allowed(session.policy().source_origin(), &slot.url)
        })
        && shared
            .automation
            .lock()
            .is_ok_and(|s| s.available() && s.generation == slot.generation)
        && Instant::now() < slot.deadline
        && slot
            .validity
            .is_none_or(|(s, e)| clock() >= slot.last_clock && wire::code_current(s, e, clock()))
}
pub(super) fn invalidate(shared: &Shared) {
    if currently_on(ThreadId::UI) != 1 {
        return;
    }
    if let Some(slot) = SLOTS.with(|s| s.borrow_mut().remove(&key(shared))) {
        retire(slot, Some(STALE));
    }
}
wrap_task! {
    struct Probe { owner: Weak<Shared>, capture: String, serial: u64 }
    impl Task {
        fn execute(&self) {
            reap_dead_owners();
            let Some(shared)=self.owner.upgrade() else {return;};
            let slot=SLOTS.with(|s| {
                let mut s=s.borrow_mut();
                if !s.get(&key(&shared)).is_some_and(|v|v.capture==self.capture && v.serial==self.serial) {return None;}
                s.remove(&key(&shared))
            });
            let Some(mut slot)=slot else {return;};
            if !current(&slot,true) || !dispatch(&mut slot,"check") {retire(slot,Some(STALE));return;}
            SLOTS.with(|s|s.borrow_mut().insert(key(&shared),slot));
        }
    }
}
wrap_task! {
    struct Watch { owner: Weak<Shared>, capture: String }
    impl Task {
        fn execute(&self) {
            reap_dead_owners();
            let Some(shared)=self.owner.upgrade() else {return;};
            let slot=SLOTS.with(|s| {
                let mut s=s.borrow_mut();
                if !s.get(&key(&shared)).is_some_and(|v|v.capture==self.capture) {return None;}
                s.remove(&key(&shared))
            });
            let Some(mut slot)=slot else {return;};
            if Instant::now()>=slot.deadline || (slot.phase==Phase::Check && Instant::now()>=slot.receipt_deadline) || (slot.phase!=Phase::Ready && Instant::now()>=slot.ack_deadline) {
                retire(slot,Some("timed-out")); return;
            }
            if !current(&slot,slot.input.is_some()) {
                retire(slot,Some(STALE)); return;
            }
            slot.last_clock=clock();
            SLOTS.with(|s|s.borrow_mut().insert(key(&shared),slot));
            let mut next=Watch::new(self.owner.clone(),self.capture.clone());
            if post_delayed_task(ThreadId::UI,Some(&mut next),20)!=1 {invalidate(&shared);}
        }
    }
}

pub(super) fn operate(
    host: &CefBrowserHost<'_>,
    identity: &BrowserIdentity,
    action: &ManualInputAction,
    guard: ManualInputGuard,
    completion: ManualInputCompletion,
) -> Result<(), BrowserError> {
    reap_dead_owners();
    let browser = host.check(identity)?;
    let owner = key(&host.shared);
    match action {
        ManualInputAction::Capture {} => {
            invalidate(&host.shared);
            if !(guard)() || host.shared.input_blocked.load(Ordering::Acquire) {
                completion(Err(STALE));
                return Ok(());
            }
            let focused = match capture_frame(browser.focused_frame()) {
                Ok(frame) => frame,
                Err(reason) => {
                    completion(Err(reason));
                    return Ok(());
                }
            };
            let Some(frame) = focused else {
                completion(Ok(ManualInputResponse::waiting()));
                return Ok(());
            };
            let url = CefString::from(&frame.url()).to_string();
            if !host
                .shared
                .session
                .lock()
                .is_ok_and(|session| wire::document_allowed(session.policy().source_origin(), &url))
            {
                completion(Err(FIELD));
                return Ok(());
            }
            let generation = host
                .shared
                .automation
                .lock()
                .ok()
                .filter(|s| s.available())
                .map(|s| s.generation);
            let Some(generation) = generation else {
                completion(Err(STALE));
                return Ok(());
            };
            let capture = format!(
                "{:x}-{:x}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            );
            let mut slot = Slot {
                owner: Arc::downgrade(&host.shared),
                browser,
                frame,
                url,
                generation,
                capture: capture.clone(),
                serial: 0,
                phase: Phase::Capture,
                deadline: Instant::now() + Duration::from_millis(wire::CAPTURE_MS),
                ack_deadline: Instant::now(),
                guard,
                callback: Some(completion),
                input: None,
                validity: None,
                last_clock: clock(),
                complete: false,
                interval_ms: 20,
                receipt_deadline: Instant::now(),
            };
            if !dispatch(&mut slot, "capture") {
                retire(slot, Some(STALE));
                return Ok(());
            }
            SLOTS.with(|s| s.borrow_mut().insert(owner, slot));
            let mut task = Watch::new(Arc::downgrade(&host.shared), capture);
            if post_delayed_task(ThreadId::UI, Some(&mut task), 20) != 1 {
                invalidate(&host.shared);
            }
        }
        ManualInputAction::Cancel { capture_id } => {
            let slot = SLOTS.with(|s| {
                let mut s = s.borrow_mut();
                if !s.get(&owner).is_some_and(|v| v.capture == *capture_id) {
                    return None;
                }
                s.remove(&owner)
            });
            if let Some(slot) = slot {
                retire(slot, Some("cancelled"));
            }
            completion(Ok(ManualInputResponse {
                status: "cancelled",
                capture_id: capture_id.clone(),
            }));
        }
        ManualInputAction::Type {
            capture_id,
            text,
            starts_at_unix_ms,
            expires_at_unix_ms,
            typing_mode,
            restore_focus,
            ..
        } => {
            let slot = SLOTS.with(|s| s.borrow_mut().remove(&owner));
            let Some(mut slot) = slot else {
                completion(Err(STALE));
                return Ok(());
            };
            if slot.capture != *capture_id
                || slot.phase != Phase::Ready
                || !restore_focus
                || !(guard)()
                || !current(&slot, true)
            {
                retire(slot, Some(STALE));
                completion(Err(STALE));
                return Ok(());
            }
            slot.guard = guard;
            slot.callback = Some(completion);
            slot.validity = starts_at_unix_ms.zip(*expires_at_unix_ms);
            slot.interval_ms = if *typing_mode == TypingMode::Instant {
                1
            } else {
                20
            };
            let now = Instant::now();
            let ms = wire::TYPE_MS
                .min(expires_at_unix_ms.map_or(wire::TYPE_MS, |e| e.saturating_sub(clock())));
            slot.deadline = slot.deadline.min(now + Duration::from_millis(ms));
            slot.input = NativeAuthTyping::new(
                NativeAuthTarget {
                    identity: identity.clone(),
                    browser_id: slot.browser.identifier(),
                    frame_id: CefString::from(&slot.frame.identifier()).to_string(),
                    document_sequence: slot.generation,
                    document_url: slot.url.clone(),
                    field_token: slot.capture.clone(),
                },
                text,
                Duration::from_millis(if *typing_mode == TypingMode::Instant {
                    1
                } else {
                    20
                }),
                now,
                slot.deadline,
            );
            if slot.input.is_none() || !current(&slot, true) {
                retire(slot, Some(STALE));
                return Ok(());
            }
            // Automatic typing cannot race this explicit manual operation.
            host.shared
                .login_totp
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .cancel();
            slot.phase = Phase::Restore;
            // DOM focus does not restore a native CEF child after the trusted
            // toolbar received OS focus. Only the explicit, consumed capture
            // can request this; normal occlusion/focus policy stays enforced.
            if host.focus(identity).is_err() || !current(&slot, true) {
                retire(slot, Some(STALE));
                return Ok(());
            }
            if !dispatch(&mut slot, "restore") {
                retire(slot, Some(STALE));
                return Ok(());
            }
            SLOTS.with(|s| s.borrow_mut().insert(owner, slot));
        }
    }
    Ok(())
}

pub(super) fn receive(
    shared: &Arc<Shared>,
    browser: &Browser,
    frame: &Frame,
    source: ProcessId,
    message: &ProcessMessage,
) -> bool {
    if CefString::from(&message.name()).to_string() != wire::RESPONSE {
        return false;
    }
    if source != ProcessId::RENDERER || frame.is_main() != 1 {
        return true;
    }
    let Some(args) = message.argument_list().filter(|a| a.size() == 4) else {
        return true;
    };
    let (Some(id), Some(serial)) = (
        crate::cef_renderer::message_text(&args, 0, 80),
        crate::cef_renderer::message_text(&args, 1, 32),
    ) else {
        return true;
    };
    let slot = SLOTS.with(|s| {
        let mut s = s.borrow_mut();
        let slot = s.get(&key(shared))?;
        if slot.capture != id || slot.serial.to_string() != serial {
            return None;
        }
        s.remove(&key(shared))
    });
    let Some(mut slot) = slot else {
        return true;
    };
    if args.get_type(2) != ValueType::BOOL
        || browser.is_same(Some(&mut slot.browser.clone())) != 1
        || CefString::from(&frame.identifier()).to_string()
            != CefString::from(&slot.frame.identifier()).to_string()
        || !current(&slot, slot.input.is_some())
    {
        retire(slot, Some(STALE));
        return true;
    }
    if args.bool(2) != 1 {
        let reason = crate::cef_renderer::message_text(&args, 3, 32).unwrap_or_default();
        if pending_receipt(&slot.phase, slot.receipt_deadline, &reason, Instant::now()) {
            slot.serial = NEXT.fetch_add(1, Ordering::Relaxed);
            let mut probe = Probe::new(Arc::downgrade(shared), slot.capture.clone(), slot.serial);
            if post_delayed_task(ThreadId::UI, Some(&mut probe), 20) != 1 {
                retire(slot, Some(STALE));
                return true;
            }
            SLOTS.with(|slots| slots.borrow_mut().insert(key(shared), slot));
            return true;
        }
        if slot.phase == Phase::Capture {
            if matches!(
                wire::ManualInputReason::parse(&reason),
                Some(
                    wire::ManualInputReason::UnsupportedFrame
                        | wire::ManualInputReason::FieldNotEmpty
                )
            ) {
                retire(
                    slot,
                    Some(wire::ManualInputReason::parse(&reason).unwrap().wire()),
                );
            } else {
                wait_for_field(slot);
            }
        } else {
            let reason = if reason == "pending" {
                "timed-out"
            } else {
                wire::ManualInputReason::parse(&reason).map_or(FIELD, |reason| reason.wire())
            };
            retire(slot, Some(reason));
        }
        return true;
    }
    if slot.phase == Phase::Capture {
        // Consume this acknowledgement before owner callbacks can re-enter.
        slot.serial = NEXT.fetch_add(1, Ordering::Relaxed);
        slot.phase = Phase::Ready;
        let response = ManualInputResponse {
            status: "captured",
            capture_id: slot.capture.clone(),
        };
        let cb = slot.callback.take();
        SLOTS.with(|s| s.borrow_mut().insert(key(shared), slot));
        if let Some(cb) = cb {
            let _ = catch_unwind(AssertUnwindSafe(|| cb(Ok(response))));
        }
        return true;
    }
    if slot.phase == Phase::Ready {
        retire(slot, Some(STALE));
        return true;
    }
    // One private field receipt authorizes at most one input tick. A duplicate
    // renderer reply cannot authorize another character while Probe is queued.
    slot.serial = NEXT.fetch_add(1, Ordering::Relaxed);
    slot.last_clock = clock();
    if slot.complete {
        retire(slot, None);
        return true;
    }
    let Some(mut input) = slot.input.take() else {
        retire(slot, Some(STALE));
        return true;
    };
    let result = input.tick(
        Instant::now(),
        |_| current(&slot, true),
        |target, unit| send_cef_character(browser, target, unit),
    );
    slot.input = Some(input);
    if result == TypingStatus::Cancelled {
        retire(slot, Some(STALE));
        return true;
    }
    slot.complete = result == TypingStatus::Complete;
    slot.phase = Phase::Check;
    slot.receipt_deadline = Instant::now() + Duration::from_millis(wire::RECEIPT_MS);
    // A fresh private focused-field receipt is required after EVERY character.
    // Waiting still probes; it never queues the secret to the renderer.
    let mut probe = Probe::new(Arc::downgrade(shared), slot.capture.clone(), slot.serial);
    if post_delayed_task(ThreadId::UI, Some(&mut probe), slot.interval_ms) != 1 {
        retire(slot, Some(STALE));
        return true;
    }
    SLOTS.with(|s| s.borrow_mut().insert(key(shared), slot));
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use cef::rc::{ConvertReturnValue, RcImpl};
    fn inert_browser() -> Browser {
        let raw: *mut cef::sys::_cef_browser_t =
            RcImpl::<cef::sys::_cef_browser_t, ()>::new(unsafe { std::mem::zeroed() }, ()).cast();
        raw.wrap_result()
    }
    fn inert_frame() -> Frame {
        let raw: *mut cef::sys::_cef_frame_t =
            RcImpl::<cef::sys::_cef_frame_t, ()>::new(unsafe { std::mem::zeroed() }, ()).cast();
        raw.wrap_result()
    }
    #[test]
    fn the_native_focused_child_is_rejected_before_a_capture_slot_or_renderer_request() {
        extern "C" fn valid(_: *mut cef::sys::_cef_frame_t) -> i32 {
            1
        }
        extern "C" fn child(_: *mut cef::sys::_cef_frame_t) -> i32 {
            0
        }
        let raw = cef::sys::_cef_frame_t {
            is_valid: Some(valid),
            is_main: Some(child),
            ..unsafe { std::mem::zeroed() }
        };
        let raw: *mut cef::sys::_cef_frame_t = RcImpl::new(raw, ()).cast();
        assert_eq!(
            capture_frame(Some(raw.wrap_result())).err(),
            Some("unsupported-frame")
        );
        assert!(capture_frame(None).unwrap().is_none());
    }
    #[test]
    fn delayed_receipt_polling_cannot_extend_the_first_key_deadline_or_authorize_other_phases() {
        let start = Instant::now();
        let deadline = start + Duration::from_millis(wire::RECEIPT_MS);
        for elapsed in [0, 20, 200, 599] {
            assert!(pending_receipt(
                &Phase::Check,
                deadline,
                "pending",
                start + Duration::from_millis(elapsed)
            ));
        }
        for elapsed in [600, 601, 1000] {
            assert!(!pending_receipt(
                &Phase::Check,
                deadline,
                "pending",
                start + Duration::from_millis(elapsed)
            ));
        }
        assert!(!pending_receipt(
            &Phase::Restore,
            deadline,
            "pending",
            start
        ));
        assert!(!pending_receipt(
            &Phase::Capture,
            deadline,
            "pending",
            start
        ));
        assert!(!pending_receipt(
            &Phase::Check,
            deadline,
            "focus-lost",
            start
        ));
    }
    #[test]
    fn a_dead_owner_removes_the_native_slot_and_completes_its_caller() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        crate::bootstrap_platform::select_pinned_api().unwrap();
        let result = Arc::new(Mutex::new(None));
        let observed = result.clone();
        let now = Instant::now();
        let slot = Slot {
            owner: Weak::new(),
            browser: inert_browser(),
            frame: inert_frame(),
            url: "https://fixture.invalid".into(),
            generation: 1,
            capture: "a".into(),
            serial: 1,
            phase: Phase::Check,
            deadline: now + Duration::from_secs(30),
            ack_deadline: now + Duration::from_secs(3),
            guard: Arc::new(|| true),
            callback: Some(Box::new(move |reply| {
                *observed.lock().unwrap() = Some(reply.map(|value| value.status))
            })),
            input: None,
            validity: None,
            last_clock: 0,
            complete: false,
            interval_ms: 20,
            receipt_deadline: now + Duration::from_millis(wire::RECEIPT_MS),
        };
        SLOTS.with(|slots| slots.borrow_mut().insert(usize::MAX, slot));
        reap_dead_owners();
        assert!(SLOTS.with(|slots| !slots.borrow().contains_key(&usize::MAX)));
        assert_eq!(*result.lock().unwrap(), Some(Err("stale")));
    }
}
