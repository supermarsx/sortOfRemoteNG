//! CEF download callbacks only. No StartDownload, URLRequest, separate client,
//! fetch or external browser exists in this adapter. Explicit-path failure must
//! cancel in CEF: patch 0006 is required to eliminate its upstream temp fallback.
//! Until that engine is built/selected/live-verified, that guarantee is pending.
use crate::{ipc::OriginBrowserIdentity, native_downloads::*};
use cef::{rc::Rc as CefRc, *};
use sorng_protocols::origin_browser::BrowserIdentity;
use std::{
    cell::{Cell, RefCell},
    panic::{catch_unwind, AssertUnwindSafe},
    rc::{Rc, Weak},
    sync::Arc,
    time::Instant,
};

/// Implement in the native host using its existing exact-browser/attempt and
/// destination-permission checks. This is not supplied by the renderer.
pub trait CefDownloadGuard: Send + Sync {
    fn is_current(&self) -> bool;
    fn accepts(&self, browser: &Browser) -> bool;
    fn allows_destination(&self, browser: &Browser, url: &str) -> bool;
}

/// Share this slot between CefBrowserHost and NativeClient. The handler may be
/// installed at browser creation; downloads remain denied until the runtime
/// attaches its authenticated owner delegate before initial navigation.
#[derive(Clone, Default)]
pub struct DownloadAttachment {
    bridge: Rc<RefCell<Option<CefDownloadBridge>>>,
}
impl DownloadAttachment {
    pub fn attach(
        &self,
        identity: BrowserIdentity,
        delegate: Arc<dyn NativeDownloadDelegate>,
        guard: Arc<dyn CefDownloadGuard>,
    ) -> Result<(), DownloadError> {
        if currently_on(ThreadId::UI) != 1 || !guard.is_current() {
            return Err(DownloadError::OwnerUnavailable);
        }
        let mut bridge = self
            .bridge
            .try_borrow_mut()
            .map_err(|_| DownloadError::Unavailable)?;
        if bridge.is_some() {
            return Err(DownloadError::Unavailable);
        }
        *bridge = Some(CefDownloadBridge::new(identity, delegate, guard));
        Ok(())
    }
    fn attached(&self) -> Option<CefDownloadBridge> {
        self.bridge.try_borrow().ok()?.clone()
    }
    pub fn handler(&self) -> DownloadHandler {
        AttachedDownloads::new(self.clone())
    }
    pub fn list(
        &self,
        identity: &OriginBrowserIdentity,
    ) -> Result<Vec<DownloadSnapshot>, DownloadError> {
        self.attached()
            .ok_or(DownloadError::Unavailable)?
            .list(identity)
    }
    pub fn control(&self, request: &DownloadControlRequest) -> Result<(), DownloadError> {
        self.attached()
            .ok_or(DownloadError::Unavailable)?
            .control(request)
    }
    pub fn revoke(&self) {
        if let Some(bridge) = self.attached() {
            bridge.revoke();
        }
    }
}

wrap_download_handler! {
    struct AttachedDownloads { attachment: DownloadAttachment }
    impl DownloadHandler {
        fn can_download(&self, browser: Option<&mut Browser>, url: Option<&CefString>, request_method: Option<&CefString>) -> i32 {
            self.attachment.attached().map_or(0, |bridge| bridge.handler().can_download(browser, url, request_method))
        }
        fn on_before_download(&self, browser: Option<&mut Browser>, item: Option<&mut DownloadItem>, suggested: Option<&CefString>, callback: Option<&mut BeforeDownloadCallback>) -> i32 {
            self.attachment.attached().map_or(1, |bridge| bridge.handler().on_before_download(browser, item, suggested, callback))
        }
        fn on_download_updated(&self, browser: Option<&mut Browser>, item: Option<&mut DownloadItem>, callback: Option<&mut DownloadItemCallback>) {
            if let Some(bridge) = self.attachment.attached() { bridge.handler().on_download_updated(browser, item, callback); }
            else if let Some(callback) = callback { callback.cancel(); }
        }
    }
}

struct Inner {
    manager: RefCell<DownloadManager>,
    guard: Arc<dyn CefDownloadGuard>,
    poll_scheduled: Cell<bool>,
}

/// Construct once per CefBrowserHost and pass handler() to NativeClient.
/// All methods and destruction require the CEF UI thread, like the host itself.
#[derive(Clone)]
pub struct CefDownloadBridge {
    inner: Rc<Inner>,
}
impl CefDownloadBridge {
    pub fn new(
        identity: BrowserIdentity,
        delegate: Arc<dyn NativeDownloadDelegate>,
        guard: Arc<dyn CefDownloadGuard>,
    ) -> Self {
        Self {
            inner: Rc::new(Inner {
                manager: RefCell::new(DownloadManager::new(identity, delegate)),
                guard,
                poll_scheduled: Cell::new(false),
            }),
        }
    }
    pub fn handler(&self) -> DownloadHandler {
        OwnedDownloads::new(self.inner.clone())
    }
    pub fn list(
        &self,
        identity: &OriginBrowserIdentity,
    ) -> Result<Vec<DownloadSnapshot>, DownloadError> {
        if currently_on(ThreadId::UI) != 1 || !self.inner.guard.is_current() {
            self.inner.revoke();
            return Err(DownloadError::Unavailable);
        }
        self.inner
            .manager
            .try_borrow_mut()
            .map_err(|_| DownloadError::Unavailable)?
            .list(identity)
    }
    pub fn control(&self, request: &DownloadControlRequest) -> Result<(), DownloadError> {
        if currently_on(ThreadId::UI) != 1 || !self.inner.guard.is_current() {
            self.inner.revoke();
            return Err(DownloadError::Unavailable);
        }
        self.inner
            .manager
            .try_borrow_mut()
            .map_err(|_| DownloadError::Unavailable)?
            .control(request, Instant::now())
    }
    /// Call before closing/revoking the native host; a failed owner check also
    /// cancels on the next bounded UI poll without needing a renderer event.
    pub fn revoke(&self) {
        self.inner.revoke();
    }
}

impl Inner {
    fn revoke(&self) {
        if let Ok(mut manager) = self.manager.try_borrow_mut() {
            manager.revoke();
        }
    }
    fn accept(&self, browser: Option<&Browser>) -> bool {
        currently_on(ThreadId::UI) == 1
            && self.guard.is_current()
            && browser.is_some_and(|browser| self.guard.accepts(browser))
            && self
                .manager
                .try_borrow()
                .is_ok_and(|manager| manager.current())
    }
    fn allowed(&self, browser: Option<&Browser>, url: Option<&CefString>) -> bool {
        self.accept(browser)
            && browser.zip(url).is_some_and(|(browser, url)| {
                url.as_slice()
                    .is_some_and(|s| !s.is_empty() && s.len() <= 16_384)
                    && self.guard.allows_destination(browser, &url.to_string())
            })
    }
    fn schedule(self: &Rc<Self>) {
        if self.poll_scheduled.replace(true) {
            return;
        }
        let mut task = PollDownloads::new(Rc::downgrade(self));
        if post_delayed_task(ThreadId::UI, Some(&mut task), 100) != 1 {
            self.poll_scheduled.set(false);
            self.revoke();
        }
    }
    fn protect<T>(&self, fallback: T, action: impl FnOnce() -> T) -> T {
        match catch_unwind(AssertUnwindSafe(action)) {
            Ok(result) => result,
            Err(_) => {
                self.revoke();
                fallback
            }
        }
    }
}

wrap_download_handler! {
    struct OwnedDownloads { inner: Rc<Inner> }
    impl DownloadHandler {
        fn can_download(&self, browser: Option<&mut Browser>, url: Option<&CefString>, _request_method: Option<&CefString>) -> i32 {
            self.inner.protect(0, || {
                (self.inner.allowed(browser.as_deref(), url)
                    && self.inner.manager.try_borrow().is_ok_and(|manager| manager.can_start())) as i32
            })
        }
        fn on_before_download(&self, browser: Option<&mut Browser>, download_item: Option<&mut DownloadItem>,
            suggested_name: Option<&CefString>, callback: Option<&mut BeforeDownloadCallback>) -> i32 {
            self.inner.protect(1, || {
                let Some(item) = download_item.filter(|item| item.is_valid() == 1) else { return 1; };
                let url = CefString::from(&item.url());
                if !self.inner.allowed(browser.as_deref(), Some(&url)) { return 1; }
                let Some(callback) = callback else { return 1; };
                let name = suggested_name.filter(|name| name.as_slice().is_some_and(|s| s.len() <= 4096))
                    .map(|name| name.to_string()).unwrap_or_else(|| "download".into());
                let before = Box::new(CefBefore { callback: Some(callback.clone()), inner: Rc::downgrade(&self.inner), cef_id: item.id() });
                let result = self.inner.manager.try_borrow_mut().ok().map(|mut manager| manager.before(item.id(), &name, before, Instant::now()));
                if matches!(result, Some(Ok(()))) { self.inner.schedule(); }
                // Always own handling. Releasing an unused BeforeDownloadCallback
                // cancels, even if a future runtime selects Chrome style.
                1
            })
        }
        fn on_download_updated(&self, browser: Option<&mut Browser>, download_item: Option<&mut DownloadItem>, callback: Option<&mut DownloadItemCallback>) {
            let Some(callback) = callback else { return; };
            let success = self.inner.protect(false, || {
                let Some(item) = download_item.filter(|item| item.is_valid() == 1) else { return false; };
                let url = CefString::from(&item.url());
                if !self.inner.allowed(browser.as_deref(), Some(&url)) {
                    // Only an exact current browser may identify a row here.
                    // Cancel state as well as CEF's callback: later updates for
                    // the same rejected URL cannot reach manager.update().
                    if self.inner.accept(browser.as_deref()) {
                        if let Ok(mut manager) = self.inner.manager.try_borrow_mut() {
                            manager.deny(item.id(), Instant::now());
                        }
                    } else if !self.inner.guard.is_current() {
                        self.inner.revoke();
                    }
                    return false;
                }
                let progress = DownloadProgress { in_progress: item.is_in_progress() == 1, complete: item.is_complete() == 1,
                    cancelled: item.is_canceled() == 1, interrupted: item.is_interrupted() == 1,
                    // The pinned Rust binding has no IsPaused; pause state is
                    // tracked from our owner-authorized CEF Pause/Resume calls.
                    paused: false, received: item.received_bytes(), total: item.total_bytes(), speed: item.current_speed() };
                let control = Box::new(CefControl { callback: callback.clone(), inner: Rc::downgrade(&self.inner), cef_id: item.id() });
                let result = self.inner.manager.try_borrow_mut().ok().map(|mut manager| manager.update(item.id(), progress, control, Instant::now()));
                match result {
                    Some(Ok(())) => { self.inner.schedule(); true }
                    // The manager already cancelled the supplied callback.
                    Some(Err(_)) => true,
                    None => false,
                }
            });
            if !success { callback.cancel(); }
        }
    }
}

wrap_task! {
    struct PollDownloads { inner: Weak<Inner> }
    impl Task {
        fn execute(&self) {
            let Some(inner) = self.inner.upgrade() else { return; };
            inner.poll_scheduled.set(false);
            if !inner.guard.is_current() { inner.revoke(); return; }
            let again = inner.protect(false, || inner.manager.try_borrow_mut().is_ok_and(|mut manager| manager.poll(Instant::now())));
            if again { inner.schedule(); }
        }
    }
}

// CEF callbacks may re-enter the download handler. Queue their execution to a
// fresh UI turn, outside the manager borrow, and recheck cancellation there.
enum Operation {
    Save {
        callback: BeforeDownloadCallback,
        destination: SaveDestination,
    },
    Control {
        callback: DownloadItemCallback,
        action: DownloadAction,
    },
    Release(BeforeDownloadCallback),
}
fn enqueue(inner: Weak<Inner>, cef_id: u32, operation: Operation) {
    let operation = Rc::new(RefCell::new(Some(operation)));
    let mut task = DownloadOperation::new(inner.clone(), cef_id, operation.clone());
    if post_task(ThreadId::UI, Some(&mut task)) != 1 {
        if let Some(Operation::Control { callback, .. }) = operation.borrow_mut().take() {
            callback.cancel();
        }
        if let Some(inner) = inner.upgrade() {
            inner.revoke();
        }
    }
}

wrap_task! {
    struct DownloadOperation { inner: Weak<Inner>, cef_id: u32, operation: Rc<RefCell<Option<Operation>>> }
    impl Task {
        fn execute(&self) {
            let Some(operation) = self.operation.borrow_mut().take() else { return; };
            let inner = self.inner.upgrade();
            let _ = catch_unwind(AssertUnwindSafe(|| match operation {
                Operation::Save { callback, destination } => {
                    let allowed = inner.as_ref().is_some_and(|inner| inner.guard.is_current() && inner.manager.try_borrow().is_ok_and(|manager| manager.permits_transfer(self.cef_id)));
                    if allowed {
                        if let Some(path) = destination.path().to_str() {
                            callback.cont(Some(&CefString::from(path)), 0);
                        }
                    }
                }
                Operation::Control { callback, action } => {
                    if action == DownloadAction::Cancel { callback.cancel(); return; }
                    let allowed = inner.as_ref().is_some_and(|inner| inner.guard.is_current() && inner.manager.try_borrow().is_ok_and(|manager| manager.wants_control(self.cef_id, action)));
                    if allowed { match action { DownloadAction::Pause => callback.pause(), DownloadAction::Resume => callback.resume(), DownloadAction::Cancel | DownloadAction::Reveal => {} } }
                    else if !inner.as_ref().is_some_and(|inner| inner.guard.is_current() && inner.manager.try_borrow().is_ok_and(|manager| manager.permits_transfer(self.cef_id))) { callback.cancel(); }
                }
                Operation::Release(callback) => drop(callback),
            }));
        }
    }
}

struct CefBefore {
    callback: Option<BeforeDownloadCallback>,
    inner: Weak<Inner>,
    cef_id: u32,
}
impl BeforeDownload for CefBefore {
    fn save(mut self: Box<Self>, destination: SaveDestination) {
        if let Some(callback) = self.callback.take() {
            enqueue(
                self.inner.clone(),
                self.cef_id,
                Operation::Save {
                    callback,
                    destination,
                },
            );
        }
    }
}
impl Drop for CefBefore {
    fn drop(&mut self) {
        if let Some(callback) = self.callback.take() {
            enqueue(
                self.inner.clone(),
                self.cef_id,
                Operation::Release(callback),
            );
        }
    }
}
struct CefControl {
    callback: DownloadItemCallback,
    inner: Weak<Inner>,
    cef_id: u32,
}
impl DownloadControl for CefControl {
    fn cancel(&self) {
        enqueue(
            self.inner.clone(),
            self.cef_id,
            Operation::Control {
                callback: self.callback.clone(),
                action: DownloadAction::Cancel,
            },
        );
    }
    fn pause(&self) {
        enqueue(
            self.inner.clone(),
            self.cef_id,
            Operation::Control {
                callback: self.callback.clone(),
                action: DownloadAction::Pause,
            },
        );
    }
    fn resume(&self) {
        enqueue(
            self.inner.clone(),
            self.cef_id,
            Operation::Control {
                callback: self.callback.clone(),
                action: DownloadAction::Resume,
            },
        );
    }
}
