//! Native find callbacks; no renderer script, content extraction, or focus/paint
//! changes. Each slot belongs to one Shared/native view and document generation.
use super::*;
use std::cell::RefCell;
use std::sync::Weak;

#[path = "native_find.rs"]
mod model;
pub use model::NativeFindResult;
pub type NativeFindCompletion = Arc<dyn Fn(NativeFindResult) + Send + Sync>;

const MAX_VIEWS: usize = 128;
const TIMEOUT_MS: i64 = 5_000;
static NEXT_DISPATCH: AtomicU64 = AtomicU64::new(1);

struct Slot {
    owner: Weak<Shared>,
    generation: u64,
    serial: u64,
    armed: bool,
    state: model::FindState<NativeFindCompletion>,
}
thread_local! { static SLOTS: RefCell<HashMap<usize, Slot>> = RefCell::new(HashMap::new()); }

fn key(shared: &Shared) -> usize {
    shared as *const Shared as usize
}

fn generation(shared: &Shared) -> Option<u64> {
    let state = shared.automation.lock().ok()?;
    state.available().then_some(state.generation)
}

fn eligible(shared: &Shared, browser: &Browser) -> bool {
    shared.focus_allowed(Some(browser))
        && browser.is_loading() == 0
        && browser
            .main_frame()
            .is_some_and(|frame| frame.is_valid() == 1)
}

pub(super) fn invalidate(shared: &Shared) {
    SLOTS.with(|slots| {
        slots.borrow_mut().remove(&key(shared));
    });
}

fn dispatch(
    shared: &Arc<Shared>,
    browser: &Browser,
    request: model::Dispatch,
) -> Result<(), BrowserError> {
    if !eligible(shared, browser) {
        invalidate(shared);
        return Err(BrowserError::SessionUnavailable);
    }
    let host = browser.host().ok_or(BrowserError::NativeSurface)?;
    let serial = NEXT_DISPATCH.fetch_add(1, Ordering::Relaxed);
    let armed = SLOTS.with(|slots| {
        let mut slots = slots.borrow_mut();
        let Some(slot) = slots.get_mut(&key(shared)) else {
            return false;
        };
        slot.serial = serial;
        slot.armed = false;
        true
    });
    if !armed {
        return Err(BrowserError::StateUnavailable);
    }
    let mut timeout = FindTimeout::new(Arc::downgrade(shared), browser.clone(), serial);
    if post_delayed_task(ThreadId::UI, Some(&mut timeout), TIMEOUT_MS) != 1 {
        invalidate(shared);
        host.stop_finding(1);
        return Err(BrowserError::StateUnavailable);
    }
    // Stop establishes a new Chromium find-session ID. Old replies are filtered
    // in FindTabHelper before CEF invokes our handler; never predict global IDs.
    if request.restart {
        host.stop_finding(1);
    }
    // StopFinding is a native boundary; ignore any reentrant old feedback until
    // its abort fence is installed. No lock/RefCell borrow crosses native code.
    let armed = SLOTS.with(|slots| {
        let mut slots = slots.borrow_mut();
        let Some(slot) = slots.get_mut(&key(shared)) else {
            return false;
        };
        if slot.serial != serial {
            return false;
        }
        slot.armed = true;
        true
    });
    if !armed {
        return Err(BrowserError::StateUnavailable);
    }
    // In pinned Chromium the fourth parameter is find_match: true is required
    // to select a match even on the initial query. Restart is handled above.
    host.find(
        Some(&CefString::from(request.text.as_str())),
        i32::from(request.forward),
        i32::from(request.match_case),
        1,
    );
    Ok(())
}

impl CefBrowserHost<'_> {
    /// Completion is called on CEF UI, without host locks. Capture exact owner
    /// window + root/popup identity; recheck the app lease and enqueue promptly.
    #[allow(clippy::too_many_arguments)]
    pub fn find_with_results(
        &self,
        identity: &BrowserIdentity,
        request_id: &str,
        text: &str,
        forward: bool,
        match_case: bool,
        find_next: bool,
        completion: NativeFindCompletion,
    ) -> Result<(), BrowserError> {
        crate::ipc::validate_find_text(text).map_err(|_| BrowserError::StateUnavailable)?;
        // Chromium strips CR. A CR-only request produces no FindResult.
        if !model::valid_request_id(request_id) || text.chars().all(|value| value == '\r') {
            return Err(BrowserError::StateUnavailable);
        }
        let browser = self.check(identity)?;
        if !eligible(&self.shared, &browser) {
            return Err(BrowserError::SessionUnavailable);
        }
        let generation = generation(&self.shared).ok_or(BrowserError::StateUnavailable)?;
        let request = model::Request {
            request_id: request_id.to_owned(),
            text: zeroize::Zeroizing::new(text.replace('\r', "")),
            forward,
            match_case,
            find_next,
            completion,
        };
        let next = SLOTS.with(|slots| {
            let mut slots = slots.borrow_mut();
            slots.retain(|_, slot| slot.owner.strong_count() != 0);
            let key = key(&self.shared);
            if !slots.contains_key(&key) && slots.len() >= MAX_VIEWS {
                return Err(BrowserError::StateUnavailable);
            }
            let slot = slots.entry(key).or_insert_with(|| Slot {
                owner: Arc::downgrade(&self.shared),
                generation,
                serial: 0,
                armed: false,
                state: model::FindState::default(),
            });
            if slot.generation != generation {
                slot.state.clear();
                slot.generation = generation;
            }
            Ok(slot.state.submit(request))
        })?;
        if let Some(next) = next {
            dispatch(&self.shared, &browser, next)?;
        }
        Ok(())
    }
}

pub(super) fn handler(shared: Arc<Shared>) -> FindHandler {
    NativeFind::new(shared)
}

wrap_find_handler! {
    struct NativeFind { shared: Arc<Shared> }
    impl FindHandler {
        fn on_find_result(&self, browser: Option<&mut Browser>, identifier: i32, count: i32,
            _selection_rect: Option<&Rect>, active_match_ordinal: i32, final_update: i32) {
            let Some(browser) = browser else { return; };
            if !eligible(&self.shared, browser) { invalidate(&self.shared); return; }
            let generation = generation(&self.shared);
            let (result, advance) = SLOTS.with(|slots| {
                let mut slots = slots.borrow_mut();
                let Some(slot) = slots.get_mut(&key(&self.shared)) else { return (None, None); };
                if !slot.armed { return (None, None); }
                if generation != Some(slot.generation) { slot.state.clear(); return (None, None); }
                let result = slot.state.reply(identifier, count, active_match_ordinal, final_update);
                (result, slot.state.ready().then_some(slot.serial))
            });
            if let Some((completion, result)) = result {
                if catch_unwind(AssertUnwindSafe(|| completion(result))).is_err() {
                    invalidate(&self.shared);
                    return;
                }
            }
            if let Some(serial) = advance {
                // Leave Chromium's result callback before the next Find call.
                let mut task = FindAdvance::new(Arc::downgrade(&self.shared), browser.clone(), serial);
                if post_task(ThreadId::UI, Some(&mut task)) != 1 { invalidate(&self.shared); }
            }
        }
    }
}

wrap_task! {
    struct FindAdvance { shared: Weak<Shared>, browser: Browser, serial: u64 }
    impl Task {
        fn execute(&self) {
            let Some(shared) = self.shared.upgrade() else { return; };
            if !eligible(&shared, &self.browser) { invalidate(&shared); return; }
            let generation = generation(&shared);
            let next = SLOTS.with(|slots| {
                let mut slots = slots.borrow_mut();
                let slot = slots.get_mut(&key(&shared))?;
                if slot.serial != self.serial || generation != Some(slot.generation) { return None; }
                slot.state.advance()
            });
            if let Some(next) = next { let _ = dispatch(&shared, &self.browser, next); }
        }
    }
}

wrap_task! {
    struct FindTimeout { shared: Weak<Shared>, browser: Browser, serial: u64 }
    impl Task {
        fn execute(&self) {
            let Some(shared) = self.shared.upgrade() else { return; };
            let expired = SLOTS.with(|slots| {
                let mut slots = slots.borrow_mut();
                if slots.get(&key(&shared)).is_some_and(|slot| slot.serial == self.serial) {
                    // Finished results may remain as the next-match anchor.
                    let slot = slots.get_mut(&key(&shared)).unwrap();
                    slot.state.expire()
                } else { false }
            });
            if expired && shared.accepts(Some(&self.browser)) {
                if let Some(host) = self.browser.host() { host.stop_finding(1); }
            }
        }
    }
}
