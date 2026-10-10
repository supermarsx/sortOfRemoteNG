//! Owner-fenced renderer acknowledgement followed by native auto-dark override.
use super::*;
use crate::native_appearance::{self as policy, AppearanceStatus};
use std::{cell::RefCell, collections::HashSet, sync::Weak};

pub type AppearanceCompletion = Box<dyn FnOnce(Result<AppearanceStatus, BrowserError>) + Send>;
pub type AppearanceGuard = Arc<dyn Fn() -> bool + Send + Sync>;
static NEXT: AtomicU64 = AtomicU64::new(1);
const TIMEOUT_MS: i64 = 5_000;

struct Pending {
    serial: u64,
    frames: HashSet<String>,
    fallback: bool,
    enabled: bool,
    cdp: Option<i32>,
    deadline: Instant,
    guard: AppearanceGuard,
    callback: Option<AppearanceCompletion>,
}

impl Pending {
    fn resynchronize_document(&mut self, frame_id: String) -> Result<(), BrowserError> {
        if self.frames.len() >= 128 && !self.frames.contains(&frame_id) {
            return Err(error());
        }
        self.frames.insert(frame_id);
        // A new/reloaded context has not acknowledged this broadcast. Ignore
        // any in-flight native override reply until its replacement is ready.
        self.cdp = None;
        Ok(())
    }

    fn acknowledge_document(&mut self, frame_id: &str, status: AppearanceStatus) -> bool {
        if self.cdp.is_some() || !self.frames.remove(frame_id) {
            return false;
        }
        self.fallback |= status == AppearanceStatus::Fallback;
        if !self.frames.is_empty() {
            return false;
        }
        self.cdp = Some(0);
        true
    }
}
struct Slot {
    owner: Weak<Shared>,
    json: String,
    registration: Option<Registration>,
    pending: Option<Pending>,
    documents: HashMap<String, String>,
    document_processes: HashMap<String, HashMap<u32, u64>>,
}
impl Slot {
    fn observe_document(&mut self, frame_id: &str, token: &str) -> Result<bool, BrowserError> {
        let (process, nonce) = policy::document_token_parts(token).ok_or_else(error)?;
        if self
            .document_processes
            .get(frame_id)
            .and_then(|processes| processes.get(&process))
            .is_some_and(|previous| nonce <= *previous)
        {
            return Ok(false);
        }
        if self.documents.len() >= 128 && !self.documents.contains_key(frame_id) {
            return Err(error());
        }
        let processes = self.document_processes.entry(frame_id.into()).or_default();
        if processes.len() >= 128 && !processes.contains_key(&process) {
            return Err(error());
        }
        processes.insert(process, nonce);
        self.documents.insert(frame_id.into(), token.into());
        Ok(true)
    }

    fn prune_documents(&mut self, frames: &HashSet<String>) {
        self.documents.retain(|id, _| frames.contains(id));
        self.document_processes.retain(|id, _| frames.contains(id));
        if let Some(pending) = &mut self.pending {
            pending.frames.retain(|id| frames.contains(id));
        }
    }

    fn accepts_document(&self, frame_id: &str, token: &str) -> bool {
        self.documents
            .get(frame_id)
            .is_some_and(|current| current == token)
    }
}
thread_local! { static SLOTS: RefCell<HashMap<usize, Slot>> = RefCell::new(HashMap::new()); }
fn key(shared: &Shared) -> usize {
    shared as *const Shared as usize
}
fn error() -> BrowserError {
    BrowserError::StateUnavailable
}
fn complete(shared: &Shared, serial: u64, result: Result<AppearanceStatus, BrowserError>) {
    let pending = SLOTS.with(|slots| {
        let mut slots = slots.borrow_mut();
        let slot = slots.get_mut(&key(shared))?;
        if slot.pending.as_ref()?.serial != serial {
            return None;
        }
        slot.pending.take()
    });
    if let Some(callback) = pending.and_then(|p| p.callback) {
        let _ = catch_unwind(AssertUnwindSafe(|| callback(result)));
    }
}
pub(super) fn revoke(shared: &Shared) {
    let slot = SLOTS.with(|slots| slots.borrow_mut().remove(&key(shared)));
    if let Some(slot) = slot {
        drop(slot.registration);
        if let Some(callback) = slot.pending.and_then(|p| p.callback) {
            let _ = catch_unwind(AssertUnwindSafe(|| callback(Err(error()))));
        }
    }
}

pub(super) fn write_extra_info(
    shared: &Shared,
    info: &mut DictionaryValue,
) -> Result<(), BrowserError> {
    if info.set_bool(
        Some(&CefString::from("appearance-extensions-enabled")),
        shared.capabilities.website_extensions_enabled as i32,
    ) != 1
    {
        return Err(error());
    }
    let json = shared
        .hooks
        .as_ref()
        .and_then(|h| h.appearance_configuration())
        .unwrap_or_else(|| policy::DEFAULT_JSON.into());
    if policy::wire::parse(&json).is_none() {
        return Err(error());
    }
    if info.set_string(
        Some(&CefString::from("appearance-json")),
        Some(&CefString::from(json.as_str())),
    ) != 1
    {
        return Err(error());
    }
    Ok(())
}

wrap_dev_tools_message_observer! {
    struct OverrideObserver { owner: Weak<Shared> }
    impl DevToolsMessageObserver {
        fn on_dev_tools_method_result(&self,_browser:Option<&mut Browser>,message_id:i32,success:i32,_result:Option<&[u8]>) {
            let Some(shared)=self.owner.upgrade() else {return;};
            let serial=SLOTS.with(|s|s.borrow().get(&key(&shared)).and_then(|s|s.pending.as_ref()).and_then(|p|
                p.cdp.filter(|id|*id==0 || *id==message_id).map(|_|p.serial)));
            if let Some(serial)=serial {
                let mut reply=OverrideReply::new(self.owner.clone(),serial,message_id,success);
                if post_task(ThreadId::UI,Some(&mut reply))!=1 {complete(&shared,serial,Err(error()));}
            }
        }
    }
}
wrap_task! {
    struct OverrideReply { owner:Weak<Shared>,serial:u64,message:i32,success:i32 }
    impl Task {
        fn execute(&self) {
            let Some(shared)=self.owner.upgrade() else {return;};
            let state=SLOTS.with(|s|s.borrow().get(&key(&shared)).and_then(|s|s.pending.as_ref())
                .filter(|p|p.serial==self.serial && p.cdp==Some(self.message))
                .map(|p|(p.guard.clone(),p.deadline,p.enabled,p.fallback)));
            let Some((guard,deadline,enabled,fallback))=state else {return;};
            let current=shared.current() && Instant::now()<deadline && catch_unwind(AssertUnwindSafe(||guard())).unwrap_or(false);
            complete(&shared,self.serial,if self.success==1 && current {
                Ok(if !enabled {AppearanceStatus::Off} else if fallback {AppearanceStatus::Fallback} else {AppearanceStatus::Applied})
            } else {Err(error())});
        }
    }
}
wrap_task! {
    struct AppearanceTimeout { owner:Weak<Shared>,serial:u64 }
    impl Task {
        fn execute(&self) {
            if let Some(shared)=self.owner.upgrade() {complete(&shared,self.serial,Err(error()));}
            else {SLOTS.with(|s|s.borrow_mut().retain(|_,slot|slot.owner.strong_count()!=0));}
        }
    }
}

fn start(
    shared: &Arc<Shared>,
    browser: &Browser,
    json: &str,
    guard: AppearanceGuard,
    callback: Option<AppearanceCompletion>,
) -> Result<(), BrowserError> {
    ui_thread()?;
    if !shared.current() || !shared.accepts(Some(browser)) || browser.frame_count() > 128 {
        return Err(error());
    }
    let (config, _) = policy::wire::parse(json).ok_or_else(error)?;
    let native = browser.host().ok_or_else(error)?;
    let native_only = config.native_only_status(shared.capabilities.website_extensions_enabled);
    let extensions_enabled = native_only.is_none();
    let frames = appearance_frames(browser);
    if extensions_enabled && (frames.is_empty() || frames.len() > 128) {
        return Err(error());
    }
    let serial = NEXT
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_add(1))
        .map_err(|_| error())?;
    let old = SLOTS.with(|slots| {
        let mut slots = slots.borrow_mut();
        slots.retain(|_, s| s.owner.strong_count() != 0);
        if slots.len() >= 128 && !slots.contains_key(&key(shared)) {
            return Err(error());
        }
        let slot = slots.entry(key(shared)).or_insert_with(|| Slot {
            owner: Arc::downgrade(shared),
            json: json.into(),
            registration: None,
            pending: None,
            documents: HashMap::new(),
            document_processes: HashMap::new(),
        });
        let frame_ids: HashSet<_> = frames
            .iter()
            .map(|f| CefString::from(&f.identifier()).to_string())
            .collect();
        slot.prune_documents(&frame_ids);
        slot.json = json.into();
        Ok(slot.pending.replace(Pending {
            serial,
            frames: frames
                .iter()
                .map(|f| CefString::from(&f.identifier()).to_string())
                .collect(),
            fallback: !extensions_enabled,
            enabled: config.enabled,
            cdp: None,
            deadline: Instant::now() + Duration::from_millis(TIMEOUT_MS as u64),
            guard,
            callback,
        }))
    })?;
    if let Some(callback) = old.and_then(|p| p.callback) {
        let _ = catch_unwind(AssertUnwindSafe(|| callback(Err(error()))));
    }
    let needs_observer = SLOTS.with(|s| {
        s.borrow()
            .get(&key(shared))
            .is_some_and(|s| s.registration.is_none())
    });
    if needs_observer {
        let mut observer = OverrideObserver::new(Arc::downgrade(shared));
        let Some(registration) = native.add_dev_tools_message_observer(Some(&mut observer)) else {
            complete(shared, serial, Err(error()));
            return Ok(());
        };
        SLOTS.with(|s| {
            if let Some(slot) = s.borrow_mut().get_mut(&key(shared)) {
                slot.registration = Some(registration);
            }
        });
    }
    let mut timeout = AppearanceTimeout::new(Arc::downgrade(shared), serial);
    if post_delayed_task(ThreadId::UI, Some(&mut timeout), TIMEOUT_MS) != 1 {
        complete(shared, serial, Err(error()));
        return Ok(());
    }
    if !extensions_enabled {
        // The extension master gate permits only native presentation. This
        // never sends a renderer request, including for explicit forceDark off.
        native_override(shared, browser, serial, config.enabled);
        return Ok(());
    }
    for frame in frames {
        if send_configuration(&frame, serial, json).is_err() {
            complete(shared, serial, Err(error()));
            return Ok(());
        }
    }
    Ok(())
}

fn appearance_frames(browser: &Browser) -> Vec<Frame> {
    let mut names = CefStringList::new();
    browser.frame_identifiers(Some(&mut names));
    names
        .into_iter()
        .filter_map(|name| browser.frame_by_identifier(Some(&CefString::from(name.as_str()))))
        .filter(|frame| {
            frame.is_valid() == 1
                && policy::eligible_frame_document(
                    &CefString::from(&frame.url()).to_string(),
                    frame.is_main() == 1,
                )
        })
        .collect()
}

fn send_configuration(frame: &Frame, serial: u64, json: &str) -> Result<(), BrowserError> {
    let mut message =
        process_message_create(Some(&CefString::from(policy::REQUEST))).ok_or_else(error)?;
    let args = message.argument_list().ok_or_else(error)?;
    args.set_string(0, Some(&CefString::from(serial.to_string().as_str())));
    args.set_string(1, Some(&CefString::from(json)));
    frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
    Ok(())
}

pub(super) fn apply(
    host: &CefBrowserHost<'_>,
    identity: &BrowserIdentity,
    json: &str,
    guard: AppearanceGuard,
    callback: AppearanceCompletion,
) -> Result<(), BrowserError> {
    let browser = host.check(identity)?;
    if !matches!(host.lifecycle(), Lifecycle::Attached | Lifecycle::Hidden) {
        return Err(error());
    }
    start(&host.shared, &browser, json, guard, Some(callback))
}

pub(super) fn receive(
    shared: &Arc<Shared>,
    browser: &Browser,
    frame: &Frame,
    source: ProcessId,
    message: &ProcessMessage,
) -> bool {
    if source != ProcessId::RENDERER
        || CefString::from(&message.name()).to_string() != policy::STATUS
    {
        return false;
    }
    if !shared.current() || !shared.accepts(Some(browser)) || frame.is_valid() != 1 {
        return true;
    }
    let Some(args) = message.argument_list().filter(|a| a.size() == 3) else {
        return true;
    };
    let (Some(revision), Some(status)) = (
        crate::cef_renderer::message_text(&args, 0, 20),
        crate::cef_renderer::message_text(&args, 1, 20),
    ) else {
        return true;
    };
    let Some(status) = AppearanceStatus::parse(&status) else {
        return true;
    };
    let Some(token) = crate::cef_renderer::message_text(&args, 2, policy::MAX_DOCUMENT_TOKEN)
        .filter(|token| policy::document_token_parts(token).is_some())
    else {
        return true;
    };
    let frame_id = CefString::from(&frame.identifier()).to_string();
    if revision == "0" {
        if !policy::eligible_frame_document(
            &CefString::from(&frame.url()).to_string(),
            frame.is_main() == 1,
        ) {
            return true;
        }
        let live_frames = appearance_frames(browser)
            .into_iter()
            .map(|f| CefString::from(&f.identifier()).to_string())
            .collect();
        let (changed, pending, json) = SLOTS.with(|s| {
            s.borrow_mut()
                .get_mut(&key(shared))
                .map(|s| {
                    s.prune_documents(&live_frames);
                    (
                        s.observe_document(&frame_id, &token),
                        s.pending
                            .as_ref()
                            .map(|p| (p.serial, p.guard.clone(), p.deadline)),
                        Some(s.json.clone()),
                    )
                })
                .unwrap_or((Ok(true), None, None))
        });
        if matches!(changed, Ok(false)) {
            // The controller deliberately does not re-acknowledge an already
            // applied serial. Repeated readiness must not enroll it again.
            return true;
        }
        if let Some((serial, guard, deadline)) = pending {
            if changed.is_err()
                || Instant::now() >= deadline
                || !catch_unwind(AssertUnwindSafe(|| guard())).unwrap_or(false)
                || browser.frame_count() > 128
            {
                complete(shared, serial, Err(error()));
                return true;
            }
            if !shared.capabilities.website_extensions_enabled {
                // The browser-wide native override already covers new frames.
                // A readiness notification never grants renderer permission.
                return true;
            }
            let enrolled = SLOTS.with(|s| {
                s.borrow_mut()
                    .get_mut(&key(shared))
                    .and_then(|s| s.pending.as_mut())
                    .filter(|p| p.serial == serial)
                    .map(|p| p.resynchronize_document(frame_id.clone()))
            });
            if let Some(result) = enrolled {
                if result
                    .and_then(|_| {
                        send_configuration(frame, serial, json.as_deref().ok_or_else(error)?)
                    })
                    .is_err()
                {
                    complete(shared, serial, Err(error()));
                }
            }
        } else if changed.is_ok() {
            let json = json
                .or_else(|| {
                    shared
                        .hooks
                        .as_ref()
                        .and_then(|h| h.appearance_configuration())
                })
                .unwrap_or_else(|| policy::DEFAULT_JSON.into());
            let _ = start(shared, browser, &json, Arc::new(|| true), None);
            SLOTS.with(|s| {
                if let Some(slot) = s.borrow_mut().get_mut(&key(shared)) {
                    let _ = slot.observe_document(&frame_id, &token);
                }
            });
        }
        return true;
    }
    let Some(serial) = revision.parse::<u64>().ok() else {
        return true;
    };
    let state = SLOTS.with(|s| {
        s.borrow()
            .get(&key(shared))
            .filter(|slot| slot.accepts_document(&frame_id, &token))
            .and_then(|s| s.pending.as_ref())
            .filter(|p| p.serial == serial && p.frames.contains(&frame_id))
            .map(|p| (p.guard.clone(), p.deadline, p.enabled))
    });
    let Some((guard, deadline, enabled)) = state else {
        return true;
    };
    if Instant::now() >= deadline
        || !catch_unwind(AssertUnwindSafe(|| guard())).unwrap_or(false)
        || enabled == (status == AppearanceStatus::Off)
    {
        complete(shared, serial, Err(error()));
        return true;
    }
    let ready = SLOTS.with(|s| {
        let mut s = s.borrow_mut();
        let Some(slot) = s.get_mut(&key(shared)) else {
            return false;
        };
        if !slot.accepts_document(&frame_id, &token) {
            return false;
        }
        let Some(p) = slot.pending.as_mut().filter(|p| p.serial == serial) else {
            return false;
        };
        p.acknowledge_document(&frame_id, status)
    });
    if ready {
        // Keep CEF's startup/prepaint dark conversion until every eligible
        // current document confirms its replacement (or explicit off).
        let fallback = SLOTS.with(|s| {
            s.borrow()
                .get(&key(shared))
                .and_then(|s| s.pending.as_ref())
                .is_none_or(|p| p.fallback)
        });
        // A client reporting fallback has NOT installed a replacement. Keep
        // native darkness; never turn a failed optional enhancement into white.
        native_override(shared, browser, serial, fallback && enabled);
    }
    true
}

fn native_override(shared: &Shared, browser: &Browser, serial: u64, enabled: bool) {
    SLOTS.with(|s| {
        if let Some(p) = s
            .borrow_mut()
            .get_mut(&key(shared))
            .and_then(|s| s.pending.as_mut())
        {
            if p.serial == serial {
                p.cdp = Some(0);
            }
        }
    });
    let Some(mut params) = dictionary_value_create() else {
        complete(shared, serial, Err(error()));
        return;
    };
    params.set_bool(Some(&CefString::from("enabled")), enabled as i32);
    let id = browser
        .host()
        .map(|h| {
            h.execute_dev_tools_method(
                0,
                Some(&CefString::from("Emulation.setAutoDarkModeOverride")),
                Some(&mut params),
            )
        })
        .unwrap_or(0);
    if id <= 0 {
        complete(shared, serial, Err(error()));
    } else {
        SLOTS.with(|s| {
            if let Some(p) = s
                .borrow_mut()
                .get_mut(&key(shared))
                .and_then(|s| s.pending.as_mut())
            {
                if p.serial == serial {
                    p.cdp = Some(id);
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(frames: &[&str]) -> Slot {
        Slot {
            owner: Weak::new(),
            json: policy::DEFAULT_JSON.into(),
            registration: None,
            documents: HashMap::new(),
            document_processes: HashMap::new(),
            pending: Some(Pending {
                serial: 42,
                frames: frames.iter().map(|id| id.to_string()).collect(),
                fallback: false,
                enabled: true,
                cdp: None,
                deadline: Instant::now() + Duration::from_secs(5),
                guard: Arc::new(|| true),
                callback: Some(Box::new(|_| {})),
            }),
        }
    }

    #[test]
    fn late_child_readiness_joins_the_pending_broadcast_without_replacing_its_owner() {
        let mut slot = slot(&["main", "existing-child"]);
        let pending = slot.pending.as_ref().unwrap();
        let deadline = pending.deadline;
        let guard = pending.guard.clone();
        assert!(slot.observe_document("late-child", "100:1").unwrap());
        let pending = slot.pending.as_mut().unwrap();
        pending.resynchronize_document("late-child".into()).unwrap();
        assert_eq!(pending.serial, 42);
        assert_eq!(pending.deadline, deadline);
        assert!(Arc::ptr_eq(&pending.guard, &guard));
        assert!(pending.callback.is_some());
        assert!(!pending.acknowledge_document("main", AppearanceStatus::Applied));
        assert!(!pending.acknowledge_document("existing-child", AppearanceStatus::Applied));
        assert!(pending.acknowledge_document("late-child", AppearanceStatus::Applied));
        assert_eq!(pending.cdp, Some(0));
    }

    #[test]
    fn repeated_zero_readiness_after_ack_does_not_wait_for_an_impossible_same_revision_ack() {
        let mut slot = slot(&["child"]);
        assert!(slot.observe_document("child", "100:1").unwrap());
        assert!(slot
            .pending
            .as_mut()
            .unwrap()
            .acknowledge_document("child", AppearanceStatus::Applied));
        slot.pending.as_mut().unwrap().cdp = Some(71);
        // Native install and delayed JS root readiness can both announce zero.
        assert!(!slot.observe_document("child", "100:1").unwrap());
        let pending = slot.pending.as_ref().unwrap();
        assert!(pending.frames.is_empty());
        assert_eq!(pending.cdp, Some(71));
    }

    #[test]
    fn reloaded_child_or_new_renderer_process_reopens_the_native_override_barrier() {
        let mut slot = slot(&["child"]);
        for token in ["100:1", "100:2", "101:1"] {
            assert!(slot.observe_document("child", token).unwrap());
            let pending = slot.pending.as_mut().unwrap();
            pending.resynchronize_document("child".into()).unwrap();
            assert_eq!(pending.cdp, None);
            assert!(pending.frames.contains("child"));
            assert!(pending.acknowledge_document("child", AppearanceStatus::Applied));
            pending.cdp = Some(72);
            assert!(!slot.observe_document("child", token).unwrap());
        }
        assert_eq!(slot.documents["child"], "101:1");
        assert!(!slot.observe_document("child", "100:2").unwrap());
        assert!(!slot.observe_document("child", "100:1").unwrap());
        assert!(!slot.accepts_document("child", "100:2"));
        assert!(!slot.accepts_document("child", "100:1"));
        assert!(slot.accepts_document("child", "101:1"));
        assert_eq!(slot.pending.as_ref().unwrap().cdp, Some(72));
    }

    #[test]
    fn sequential_frame_lifetimes_do_not_exhaust_the_live_document_registry() {
        let mut slot = slot(&["main"]);
        for nonce in 1..=512 {
            let frame = format!("child-{nonce}");
            slot.prune_documents(&HashSet::from(["main".into(), frame.clone()]));
            assert!(slot
                .observe_document(&frame, &format!("100:{nonce}"))
                .unwrap());
            slot.pending
                .as_mut()
                .unwrap()
                .resynchronize_document(frame)
                .unwrap();
            assert_eq!(slot.documents.len(), 1);
            assert_eq!(slot.document_processes.len(), 1);
            assert_eq!(slot.pending.as_ref().unwrap().frames.len(), 2);
        }
    }

    #[test]
    fn resynchronization_keeps_fallback_and_frame_limits() {
        let mut slot = slot(&["main"]);
        let pending = slot.pending.as_mut().unwrap();
        assert!(pending.acknowledge_document("main", AppearanceStatus::Fallback));
        for index in 0..128 {
            let frame = format!("child-{index}");
            pending.resynchronize_document(frame.clone()).unwrap();
        }
        assert!(pending
            .resynchronize_document("one-too-many".into())
            .is_err());
        assert!(pending.fallback);
        assert_eq!(pending.frames.len(), 128);
        for index in 0..128 {
            assert!(slot
                .observe_document(&format!("child-{index}"), "100:1")
                .unwrap());
        }
        assert!(slot.observe_document("one-too-many", "100:1").is_err());
        assert!(!slot.observe_document("child-1", "100:1").unwrap());
        assert!(slot.observe_document("child-1", "100:2").unwrap());
    }
}
