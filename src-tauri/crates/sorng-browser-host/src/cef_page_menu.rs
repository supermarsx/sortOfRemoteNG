//! Native-only print/history operations. No generic DevTools method, script,
//! destination URL, output path, or native handle is accepted from the shell.
use super::*;
use std::cell::RefCell;
use std::sync::Weak;

#[path = "native_history.rs"]
mod model;
pub use model::{HistoryEntry, HistorySnapshot};

pub enum PageMenuResult {
    History(HistorySnapshot),
    Done,
}
pub type PageMenuCompletion = Box<dyn FnOnce(Result<PageMenuResult, BrowserError>) + Send>;
pub type PageMenuGuard = Arc<dyn Fn() -> bool + Send + Sync>;

const QUERY_MS: i64 = 5_000;
const RECEIPT_MS: i64 = 30_000;
const MAX_VIEWS: usize = 128;
const MAX_REPLY: usize = 1024 * 1024;
static NEXT: AtomicU64 = AtomicU64::new(1);

enum Phase {
    List,
    ResolveJump { token: String, index: i32 },
    JumpSubmitted,
}
struct Pending {
    serial: u64,
    message: i32,
    generation: u64,
    phase: Phase,
    guard: PageMenuGuard,
    callback: PageMenuCompletion,
    registration: Option<Registration>,
    deadline: Instant,
}
struct Slot {
    owner: Weak<Shared>,
    generation: u64,
    receipt_serial: u64,
    receipt_deadline: Instant,
    history: model::History,
    pending: Option<Pending>,
}
thread_local! { static SLOTS: RefCell<HashMap<usize, Slot>> = RefCell::new(HashMap::new()); }

fn key(shared: &Shared) -> usize {
    shared as *const Shared as usize
}
fn unavailable() -> BrowserError {
    BrowserError::StateUnavailable
}
fn unavailable_at(stage: &'static str) -> BrowserError {
    // Fixed internal stage codes only. Never include native payloads, entry
    // URLs/titles, owner identities, paths, or engine-provided error messages.
    use std::io::Write;
    let _ = writeln!(
        std::io::stderr().lock(),
        "Native browser history failure stage={stage}"
    );
    unavailable()
}
fn generation(shared: &Shared) -> Result<u64, BrowserError> {
    shared
        .automation
        .lock()
        .map(|s| s.generation)
        .map_err(|_| unavailable())
}
fn finish(owner: usize, serial: u64, result: Result<PageMenuResult, BrowserError>) {
    let pending = SLOTS.with(|slots| {
        let mut slots = slots.borrow_mut();
        let slot = slots.get_mut(&owner)?;
        if slot.pending.as_ref()?.serial != serial {
            return None;
        }
        slot.pending.take()
    });
    if let Some(pending) = pending {
        // Release the native observer and registry borrow before application code.
        drop(pending.registration);
        let _ = catch_unwind(AssertUnwindSafe(|| (pending.callback)(result)));
    }
}

#[derive(Clone, Copy, Debug)]
enum CollectionFailure {
    EntryOrder,
    InvalidEntry,
    EmptyUrl,
    UrlBound,
    TitleEncodingOrBound,
    DisplayText,
    DuplicateCurrent,
}

#[derive(Default)]
struct Collected {
    entries: Vec<(String, String)>,
    current: Option<i32>,
    total: Option<i32>,
    invalid: Option<CollectionFailure>,
}
wrap_navigation_entry_visitor! {
    struct Entries { value: Arc<Mutex<Collected>> }
    impl NavigationEntryVisitor {
        fn visit(&self, entry: Option<&mut NavigationEntry>, current: i32, index: i32, total: i32) -> i32 {
            let Ok(mut out) = self.value.lock() else { return 0; };
            let value = (|| -> Result<(), CollectionFailure> {
                if index < 0 || index as usize != out.entries.len() || total < 1
                    || total as usize > model::MAX_ENTRIES || index >= total
                    || out.total.is_some_and(|old| old != total) || !matches!(current, 0 | 1) { return Err(CollectionFailure::EntryOrder); }
                let entry = entry.filter(|entry| entry.is_valid() == 1).ok_or(CollectionFailure::InvalidEntry)?;
                let url = CefString::from(&entry.url());
                let title = CefString::from(&entry.title());
                let url_units = url.as_slice().ok_or(CollectionFailure::EmptyUrl)?;
                if url_units.len() > 16_384 { return Err(CollectionFailure::UrlBound); }
                let url = url.to_string();
                let title = model::decode_title(title.as_slice()).ok_or(CollectionFailure::TitleEncodingOrBound)?;
                if !display_text_safe(&title, 512) || url.len() > 16_384 { return Err(CollectionFailure::DisplayText); }
                if current == 1 {
                    if out.current.is_some() { return Err(CollectionFailure::DuplicateCurrent); }
                    out.current = Some(index);
                }
                out.total = Some(total);
                out.entries.push((url, title));
                Ok(())
            })();
            if let Err(failure) = value {
                use std::io::Write;
                let _ = writeln!(std::io::stderr().lock(),
                    "Native browser history collection failure={failure:?} index={index} total={total} current={current} collected={}", out.entries.len());
                out.invalid = Some(failure);
                return 0;
            }
            1
        }
    }
}

fn collect(browser: &Browser, bytes: &[u8]) -> Result<(i32, Vec<model::Entry>), BrowserError> {
    // The pinned CEF implementation completes this visitor synchronously on UI.
    let output = Arc::new(Mutex::new(Collected::default()));
    let mut visitor = Entries::new(output.clone());
    browser
        .host()
        .ok_or_else(unavailable)?
        .navigation_entries(Some(&mut visitor), 0);
    let output = output.lock().map_err(|_| unavailable())?;
    if output.invalid.is_some() || output.total.unwrap_or(0) as usize != output.entries.len() {
        return Err(unavailable_at("cef-entry-collection"));
    }
    let result = parse_json_buffer(Some(bytes), JsonParserOptions::RFC)
        .and_then(|value| value.dictionary())
        .ok_or_else(|| unavailable_at("cdp-json-dictionary"))?;
    let current_key = CefString::from("currentIndex");
    if result.get_type(Some(&current_key)) != ValueType::INT {
        return Err(unavailable_at("cdp-current-index-type"));
    }
    let current = result.int(Some(&current_key));
    let rows = result
        .list(Some(&CefString::from("entries")))
        .ok_or_else(|| unavailable_at("cdp-entries-list"))?;
    if rows.size() > model::MAX_ENTRIES
        || rows.size() != output.entries.len()
        || current != output.current.unwrap_or(-1)
    {
        use std::io::Write;
        let _ = writeln!(std::io::stderr().lock(),
            "Native browser history count mismatch native_count={} cdp_count={} native_current={} cdp_current={current}",
            output.entries.len(), rows.size(), output.current.unwrap_or(-1));
        return Err(unavailable_at("native-cdp-count-or-current"));
    }
    let mut entries = Vec::with_capacity(rows.size());
    for (index, (url, title)) in output.entries.iter().enumerate() {
        let row = rows
            .dictionary(index)
            .ok_or_else(|| unavailable_at("cdp-entry-dictionary"))?;
        let id_key = CefString::from("id");
        let url_key = CefString::from("url");
        if row.get_type(Some(&id_key)) != ValueType::INT
            || row.get_type(Some(&url_key)) != ValueType::STRING
            || CefString::from(&row.string(Some(&url_key))).to_string() != *url
        {
            use std::io::Write;
            let _ = writeln!(
                std::io::stderr().lock(),
                "Native browser history entry mismatch index={index}"
            );
            return Err(unavailable_at("native-cdp-entry-match"));
        }
        entries.push(model::Entry {
            id: row.int(Some(&id_key)),
            url: display_url(url),
            title: title.clone(),
        });
    }
    Ok((current, entries))
}

wrap_dev_tools_message_observer! {
    struct Observer { owner: Weak<Shared>, serial: u64 }
    impl DevToolsMessageObserver {
        fn on_dev_tools_method_result(&self, browser: Option<&mut Browser>, message_id: i32, success: i32, result: Option<&[u8]>) {
            let Some(shared) = self.owner.upgrade() else { return; };
            let relevant = SLOTS.with(|slots| slots.borrow().get(&key(&shared)).and_then(|s| s.pending.as_ref())
                .is_some_and(|p| p.serial == self.serial && (p.message == 0 || p.message == message_id)));
            if !relevant { return; }
            let bytes = result.filter(|s| s.len() <= MAX_REPLY).map(|s| Arc::new(s.to_vec()));
            let mut task = Reply::new(self.owner.clone(), self.serial, message_id, success, bytes, browser.cloned());
            // Always defer: CEF may answer synchronously before Execute returns
            // its actual message ID, and the caller may hold the app UI registry.
            if post_task(ThreadId::UI, Some(&mut task)) != 1 {
                finish(key(&shared), self.serial, Err(unavailable()));
            }
        }
    }
}

wrap_task! {
    struct Reply { owner: Weak<Shared>, serial: u64, message: i32, success: i32, bytes: Option<Arc<Vec<u8>>>, browser: Option<Browser> }
    impl Task {
        fn execute(&self) {
            let Some(shared) = self.owner.upgrade() else { return; };
            let owner = key(&shared);
            let state = SLOTS.with(|slots| slots.borrow().get(&owner).and_then(|slot| slot.pending.as_ref()).and_then(|p| {
                (p.serial == self.serial && p.message == self.message).then(||
                    (p.guard.clone(), p.generation, p.deadline, matches!(p.phase, Phase::JumpSubmitted)))
            }));
            let Some((guard, expected_generation, deadline, submitted)) = state else { return; };
            let failure = if self.success != 1 { Some("devtools-method-result") }
                else if Instant::now() >= deadline { Some("reply-deadline") }
                else if !shared.current() { Some("owner-current") }
                else if !shared.accepts(self.browser.as_ref()) { Some("browser-current") }
                else if !catch_unwind(AssertUnwindSafe(|| guard())).unwrap_or(false) { Some("selected-view-guard") }
                else if !submitted && generation(&shared).ok() != Some(expected_generation) { Some("document-generation") }
                else { None };
            if let Some(stage) = failure { finish(owner, self.serial, Err(unavailable_at(stage))); return; }
            if submitted { finish(owner, self.serial, Ok(PageMenuResult::Done)); return; }
            let result = self.browser.as_ref().zip(self.bytes.as_ref()).ok_or_else(|| unavailable_at("reply-payload"))
                .and_then(|(browser, bytes)| collect(browser, bytes));
            let Ok((current, entries)) = result else { finish(owner, self.serial, Err(unavailable())); return; };
            let next = SLOTS.with(|slots| {
                let mut slots = slots.borrow_mut();
                let slot = slots.get_mut(&owner).ok_or_else(unavailable)?;
                let pending = slot.pending.as_mut().ok_or_else(unavailable)?;
                match &pending.phase {
                    Phase::List => {
                        let snapshot = slot.history.publish(self.serial.to_string(), current, entries).ok_or_else(|| unavailable_at("receipt-publish"))?;
                        slot.generation = expected_generation;
                        slot.receipt_serial = self.serial;
                        Ok(Ok(snapshot))
                    }
                    Phase::ResolveJump { token, index } => {
                        if slot.generation != expected_generation || Instant::now() >= slot.receipt_deadline { return Err(unavailable_at("receipt-generation-or-deadline")); }
                        let id = slot.history.consume(token, *index, current, &entries).ok_or_else(|| unavailable_at("receipt-consume"))?;
                        pending.phase = Phase::JumpSubmitted;
                        pending.message = 0;
                        Ok(Err(id))
                    }
                    Phase::JumpSubmitted => Err(unavailable()),
                }
            });
            match next {
                Ok(Ok(snapshot)) => finish(owner, self.serial, Ok(PageMenuResult::History(snapshot))),
                Ok(Err(id)) => {
                    let Some(mut params) = dictionary_value_create() else { finish(owner, self.serial, Err(unavailable())); return; };
                    params.set_int(Some(&CefString::from("entryId")), id);
                    let host = self.browser.as_ref().and_then(|b| b.host());
                    let message = host.map(|host| host.execute_dev_tools_method(0,
                        Some(&CefString::from("Page.navigateToHistoryEntry")), Some(&mut params))).unwrap_or(0);
                    set_message(owner, self.serial, message);
                }
                Err(error) => finish(owner, self.serial, Err(error)),
            }
        }
    }
}

fn set_message(owner: usize, serial: u64, message: i32) {
    if message <= 0 {
        finish(owner, serial, Err(unavailable()));
        return;
    }
    SLOTS.with(|slots| {
        if let Some(pending) = slots
            .borrow_mut()
            .get_mut(&owner)
            .and_then(|slot| slot.pending.as_mut())
        {
            if pending.serial == serial {
                pending.message = message;
            }
        }
    });
}

wrap_task! {
    struct Expire { owner: Weak<Shared>, serial: u64, receipt: bool }
    impl Task {
        fn execute(&self) {
            let Some(shared) = self.owner.upgrade() else {
                // Weak-only slots never retain a closed browser/session.
                SLOTS.with(|slots| slots.borrow_mut().retain(|_, slot| slot.owner.strong_count() != 0));
                return;
            };
            let owner = key(&shared);
            if !self.receipt {
                // Timers outlive successful replies. Do not report a timeout
                // for an already-completed (or replaced) query.
                let pending = SLOTS.with(|slots| slots.borrow().get(&owner)
                    .and_then(|slot| slot.pending.as_ref())
                    .is_some_and(|query| query.serial == self.serial));
                if pending {
                    finish(owner, self.serial, Err(unavailable_at("query-timeout")));
                }
                return;
            }
            let removed = SLOTS.with(|slots| {
                let mut slots = slots.borrow_mut();
                if slots.get(&owner).is_some_and(|s| s.receipt_serial == self.serial && s.pending.is_none()) {
                    slots.remove(&owner)
                } else { None }
            });
            drop(removed);
        }
    }
}

fn start(
    host: &CefBrowserHost<'_>,
    identity: &BrowserIdentity,
    phase: Phase,
    guard: PageMenuGuard,
    callback: PageMenuCompletion,
) -> Result<(), BrowserError> {
    let browser = host.authorize_current(identity)?;
    if host.lifecycle() != Lifecycle::Attached || browser.is_loading() == 1 {
        return Err(unavailable());
    }
    let native = host.native_host(&browser)?;
    let expected_generation = generation(&host.shared)?;
    let serial = NEXT
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_add(1))
        .map_err(|_| unavailable())?;
    let owner = key(&host.shared);
    SLOTS.with(|slots| {
        let mut slots = slots.borrow_mut();
        slots.retain(|_, slot| slot.owner.strong_count() != 0);
        if slots.len() >= MAX_VIEWS && !slots.contains_key(&owner) {
            return Err(unavailable());
        }
        let slot = slots.entry(owner).or_insert_with(|| Slot {
            owner: Arc::downgrade(&host.shared),
            generation: expected_generation,
            receipt_serial: serial,
            receipt_deadline: Instant::now(),
            history: model::History::default(),
            pending: None,
        });
        if slot.pending.is_some() || !slot.owner.ptr_eq(&Arc::downgrade(&host.shared)) {
            return Err(unavailable());
        }
        if matches!(phase, Phase::List) {
            slot.history.invalidate();
            slot.receipt_deadline = Instant::now() + Duration::from_millis(RECEIPT_MS as u64);
        } else if Instant::now() >= slot.receipt_deadline || slot.generation != expected_generation
        {
            slot.history.invalidate();
            return Err(unavailable());
        }
        slot.receipt_serial = serial;
        slot.pending = Some(Pending {
            serial,
            message: 0,
            generation: expected_generation,
            phase,
            guard,
            callback,
            registration: None,
            deadline: Instant::now() + Duration::from_millis(QUERY_MS as u64),
        });
        Ok(())
    })?;
    let mut observer = Observer::new(Arc::downgrade(&host.shared), serial);
    let Some(registration) = native.add_dev_tools_message_observer(Some(&mut observer)) else {
        finish(owner, serial, Err(unavailable()));
        return Ok(());
    };
    SLOTS.with(|slots| {
        if let Some(p) = slots
            .borrow_mut()
            .get_mut(&owner)
            .and_then(|slot| slot.pending.as_mut())
        {
            p.registration = Some(registration);
        }
    });
    let mut timeout = Expire::new(Arc::downgrade(&host.shared), serial, false);
    let mut expiry = Expire::new(Arc::downgrade(&host.shared), serial, true);
    if post_delayed_task(ThreadId::UI, Some(&mut timeout), QUERY_MS) != 1
        || post_delayed_task(ThreadId::UI, Some(&mut expiry), RECEIPT_MS) != 1
    {
        finish(owner, serial, Err(unavailable()));
        return Ok(());
    }
    let message = native.execute_dev_tools_method(
        0,
        Some(&CefString::from("Page.getNavigationHistory")),
        None,
    );
    set_message(owner, serial, message);
    Ok(())
}

pub(super) fn history(
    host: &CefBrowserHost<'_>,
    identity: &BrowserIdentity,
    guard: PageMenuGuard,
    callback: PageMenuCompletion,
) -> Result<(), BrowserError> {
    start(host, identity, Phase::List, guard, callback)
}
pub(super) fn jump(
    host: &CefBrowserHost<'_>,
    identity: &BrowserIdentity,
    token: &str,
    index: i32,
    guard: PageMenuGuard,
    callback: PageMenuCompletion,
) -> Result<(), BrowserError> {
    if token.is_empty()
        || token.len() > 32
        || !token.bytes().all(|b| b.is_ascii_digit())
        || index < 0
        || index as usize >= model::MAX_ENTRIES
        || host.shared.input_blocked.load(Ordering::Acquire)
    {
        return Err(unavailable());
    }
    start(
        host,
        identity,
        Phase::ResolveJump {
            token: token.into(),
            index,
        },
        guard,
        callback,
    )
}

pub(super) fn print(
    host: &CefBrowserHost<'_>,
    identity: &BrowserIdentity,
) -> Result<(), BrowserError> {
    let browser = host.authorize_current(identity)?;
    if host.lifecycle() != Lifecycle::Attached
        || browser.is_loading() == 1
        || host.shared.input_blocked.load(Ordering::Acquire)
    {
        return Err(unavailable());
    }
    // The OS dialog owns printer/PDF selection; never silently writes a file.
    host.native_host(&browser)?.print();
    Ok(())
}
