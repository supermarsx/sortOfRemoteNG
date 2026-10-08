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
struct Slot {
    owner: Weak<Shared>,
    json: String,
    registration: Option<Registration>,
    pending: Option<Pending>,
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
    let mut names = CefStringList::new();
    browser.frame_identifiers(Some(&mut names));
    let native_only = config.native_only_status(shared.capabilities.website_extensions_enabled);
    let extensions_enabled = native_only.is_none();
    let frames: Vec<_> = names
        .into_iter()
        .filter_map(|name| browser.frame_by_identifier(Some(&CefString::from(name.as_str()))))
        .filter(|frame| {
            let url = CefString::from(&frame.url()).to_string();
            frame.is_valid() == 1 && policy::eligible_document(&url)
        })
        .collect();
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
        });
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
        let Some(mut message) = process_message_create(Some(&CefString::from(policy::REQUEST)))
        else {
            complete(shared, serial, Err(error()));
            return Ok(());
        };
        let Some(args) = message.argument_list() else {
            complete(shared, serial, Err(error()));
            return Ok(());
        };
        args.set_string(0, Some(&CefString::from(serial.to_string().as_str())));
        args.set_string(1, Some(&CefString::from(json)));
        frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
    }
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
    let Some(args) = message.argument_list().filter(|a| a.size() == 2) else {
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
    if revision == "0" {
        let (pending, json) = SLOTS.with(|s| {
            s.borrow()
                .get(&key(shared))
                .map(|s| (s.pending.is_some(), Some(s.json.clone())))
                .unwrap_or((false, None))
        });
        if !pending {
            let json = json
                .or_else(|| {
                    shared
                        .hooks
                        .as_ref()
                        .and_then(|h| h.appearance_configuration())
                })
                .unwrap_or_else(|| policy::DEFAULT_JSON.into());
            let _ = start(shared, browser, &json, Arc::new(|| true), None);
        }
        return true;
    }
    let Some(serial) = revision.parse::<u64>().ok() else {
        return true;
    };
    let frame_id = CefString::from(&frame.identifier()).to_string();
    let state = SLOTS.with(|s| {
        s.borrow()
            .get(&key(shared))
            .and_then(|s| s.pending.as_ref())
            .filter(|p| p.serial == serial)
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
        let Some(p) = s.get_mut(&key(shared)).and_then(|s| s.pending.as_mut()) else {
            return false;
        };
        if p.serial != serial || p.cdp.is_some() || !p.frames.remove(&frame_id) {
            return false;
        }
        p.fallback |= status == AppearanceStatus::Fallback;
        if !p.frames.is_empty() {
            return false;
        }
        p.cdp = Some(0);
        true
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
