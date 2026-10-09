//! Actual CEF popup adoption. All native handles and the registry remain on the
//! CEF UI thread. The source host retains its PrivateRequestContext and parent
//! until every child/pending creation acknowledges closure. No new session,
//! request context, credentials, proxy, or owner grant is created here.
use super::*;
use crate::native_popups::{
    tab_destination, NativePopupPolicy, PopupAuthority, PopupDisposition, PopupError, PopupPhase,
    PopupRegistry, PopupSourceIdentity, PopupView,
};
use std::cell::RefCell;
use std::sync::atomic::AtomicBool;

#[cfg(test)]
#[path = "cef_popups_tests.rs"]
mod tests;

static NEXT_GROUP: AtomicU64 = AtomicU64::new(1);
static NEXT_LINK_TAB: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(-1);
const OWNER: &str = "source-host";

#[derive(Clone, Default)]
pub(super) struct PopupRole {
    group: u64,
    child: Option<(String, Arc<AtomicBool>)>,
}

impl PopupRole {
    pub(super) fn root() -> Self {
        Self {
            group: NEXT_GROUP.fetch_add(1, Ordering::Relaxed),
            child: None,
        }
    }
    pub(super) fn view_closed(&self) -> Option<Arc<AtomicBool>> {
        self.child.as_ref().map(|(_, closed)| closed.clone())
    }
}

struct Context {
    native: RequestContext,
    info: WindowInfo,
    settings: BrowserSettings,
    extra_info: DictionaryValue,
    bounds: ViewportBounds,
    source: std::sync::Weak<Shared>,
}

struct Authority;
impl PopupAuthority<Context> for Authority {
    fn current(&self, context: &ThreadBound<Context>) -> bool {
        context
            .source
            .upgrade()
            .is_some_and(|shared| shared.current())
    }
    fn destination_allowed(&self, context: &ThreadBound<Context>, target: &str) -> bool {
        let Some(shared) = context.source.upgrade() else {
            return false;
        };
        shared.current()
            && (target == "about:blank"
                || shared.session.lock().is_ok_and(|session| {
                    navigation_allowed(
                        &session,
                        &shared.identity,
                        &shared.permissions,
                        target,
                        true,
                    )
                }))
    }
}

struct View {
    host: CefBrowserHost<'static>,
}
impl PopupView for View {
    fn browser_id(&self) -> i32 {
        self.host
            .shared
            .state
            .lock()
            .ok()
            .and_then(|s| s.browser_id)
            .unwrap_or(0)
    }
    fn request_close(&mut self) -> Result<(), PopupError> {
        self.host
            .close(self.host.identity())
            .map_err(|_| PopupError::NativeCloseFailed)
    }
}

#[derive(Default)]
struct Events {
    revision: AtomicU64,
    values: Mutex<HashMap<String, BrowserEvent>>,
}
struct PopupSink {
    events: Arc<Events>,
    view_id: String,
}
impl BrowserEventSink for PopupSink {
    fn on_event(&self, event: BrowserEvent) {
        if let Ok(mut events) = self.events.values.lock() {
            events.insert(self.view_id.clone(), event);
            self.events.revision.fetch_add(1, Ordering::Relaxed);
        }
    }
}

struct Group {
    policy: Option<NativePopupPolicy>,
    downloads: Option<Arc<dyn crate::native_downloads::NativeDownloadDelegate>>,
    source: PopupSourceIdentity,
    context: ThreadBound<Context>,
    registry: PopupRegistry<Context, View, Authority>,
    pending: HashMap<String, View>,
    requests: HashMap<(i32, i32), String>,
    events: Arc<Events>,
}
thread_local! {
    static GROUPS: RefCell<HashMap<u64, Group>> = RefCell::new(HashMap::new());
}

fn source(identity: &BrowserIdentity) -> PopupSourceIdentity {
    let identity = crate::ipc::OriginBrowserIdentity::from_native(identity);
    PopupSourceIdentity {
        owner_database_id: identity.owner_database_id,
        connection_id: identity.connection_id,
        session_id: identity.session_id,
        attempt_id: identity.attempt_id,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn install(
    shared: &Arc<Shared>,
    browser: &Browser,
    native: RequestContext,
    info: WindowInfo,
    settings: BrowserSettings,
    extra_info: DictionaryValue,
    bounds: ViewportBounds,
) -> Result<(), BrowserError> {
    let source = source(&shared.identity);
    let context = ThreadBound::new(Context {
        native,
        info,
        settings,
        extra_info,
        bounds,
        source: Arc::downgrade(shared),
    });
    let registry = PopupRegistry::new(
        source.clone(),
        OWNER.into(),
        browser.identifier(),
        context.clone(),
        Authority,
    )
    .map_err(|_| BrowserError::StateUnavailable)?;
    GROUPS.with(|groups| {
        groups.borrow_mut().insert(
            shared.popup.group,
            Group {
                policy: None,
                downloads: None,
                source,
                context,
                registry,
                pending: HashMap::new(),
                requests: HashMap::new(),
                events: Arc::new(Events::default()),
            },
        );
    });
    Ok(())
}

// This facade borrows only a child's controls. Dropping it cannot close the
// child, checkpoint shared cookies, or drop/revoke the source private context.
fn facade(
    shared: Arc<Shared>,
    browser: BrowserSlot,
    downloads: DownloadAttachment,
) -> CefBrowserHost<'static> {
    CefBrowserHost {
        shared,
        browser,
        downloads,
        _context: None,
        _parent: None,
        close_on_drop: false,
        _ui_thread: PhantomData,
    }
}

fn child_shared(
    source: &Arc<Shared>,
    role: PopupRole,
    sink: Arc<dyn BrowserEventSink>,
    bounds: ViewportBounds,
) -> Arc<Shared> {
    Arc::new(Shared {
        input_blocked: AtomicBool::new(false),
        popup: role,
        inspector_bootstrap: source.inspector_bootstrap.clone(),
        session: source.session.clone(),
        identity: source.identity.clone(),
        permissions: source.permissions.clone(),
        hooks: source.hooks.clone(),
        sink,
        login_adapter: source.login_adapter,
        certificate_policy: source.certificate_policy,
        capabilities: source.capabilities,
        login_budget: Mutex::new(LoginBudget::default()),
        login_totp: Mutex::new(login_totp::State::default()),
        feature_gate: Mutex::new(RendererFeatureGate::default()),
        certificate_pending: Mutex::new(None),
        automation: Mutex::new(AutomationState::default()),
        media_pending: Mutex::new(None),
        state: Arc::new(Mutex::new(State {
            control: BrowserControl::new(source.identity.clone(), bounds),
            browser_id: None,
            cleanup: CleanupProgress::Idle,
            sequence: 0,
            display: BrowserDisplayState::default(),
            page: BrowserState {
                lifecycle: Lifecycle::Starting,
                url: RedactedUrl::Bootstrap,
                title: RedactedTitle::Empty,
                loading: false,
                can_go_back: false,
                can_go_forward: false,
                fault: None,
                load_failure: None,
            },
        })),
    })
}

fn disposition(value: WindowOpenDisposition) -> Option<PopupDisposition> {
    match value {
        WindowOpenDisposition::NEW_FOREGROUND_TAB
        | WindowOpenDisposition::NEW_POPUP
        | WindowOpenDisposition::NEW_WINDOW => Some(PopupDisposition::Foreground),
        WindowOpenDisposition::NEW_BACKGROUND_TAB => Some(PopupDisposition::Background),
        _ => None,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn before_popup(
    opener: &Arc<Shared>,
    browser: Option<&Browser>,
    frame: Option<&Frame>,
    popup_id: i32,
    target: Option<&CefString>,
    target_disposition: WindowOpenDisposition,
    user_gesture: bool,
    info: Option<&mut WindowInfo>,
    client: Option<&mut Option<Client>>,
    settings: Option<&mut BrowserSettings>,
    extra_info: Option<&mut Option<DictionaryValue>>,
) -> Result<String, PopupError> {
    ui_thread().map_err(|_| PopupError::OwnerUnavailable)?;
    let (Some(browser), Some(frame), Some(info), Some(client), Some(settings), Some(extra_info)) =
        (browser, frame, info, client, settings, extra_info)
    else {
        return Err(PopupError::InvalidSource);
    };
    if !opener.current()
        || !opener.accepts(Some(browser))
        || frame.is_valid() != 1
        || !frame
            .browser()
            .is_some_and(|owner| owner.is_same(Some(&mut browser.clone())) == 1)
    {
        return Err(PopupError::OwnerUnavailable);
    }
    if target.is_some_and(|target| !target.as_slice().is_some_and(|text| text.len() <= 16_384)) {
        return Err(PopupError::InvalidDestination);
    }
    let disposition = disposition(target_disposition).ok_or(PopupError::InvalidDestination)?;
    // Empty window.open() is the inert bootstrap, not a network grant.
    let target = target.map(|target| target.to_string()).unwrap_or_default();
    let target = if target.is_empty() {
        "about:blank"
    } else {
        &target
    };
    GROUPS.with(|groups| {
        let mut groups = groups
            .try_borrow_mut()
            .map_err(|_| PopupError::OwnerUnavailable)?;
        let group = groups
            .get_mut(&opener.popup.group)
            .ok_or(PopupError::OwnerUnavailable)?;
        if group.policy != Some(NativePopupPolicy::Tabs) {
            return Err(PopupError::OwnerUnavailable);
        }
        let id = group.registry.reserve(
            browser.identifier(),
            popup_id,
            target,
            disposition,
            user_gesture,
            Instant::now(),
        )?;
        let sink = Arc::new(PopupSink {
            events: group.events.clone(),
            view_id: id.clone(),
        });
        let role = PopupRole {
            group: opener.popup.group,
            child: Some((id.clone(), Arc::new(AtomicBool::new(false)))),
        };
        let shared = child_shared(opener, role, sink, group.context.bounds);
        let slot = Arc::new(Mutex::new(None));
        let request = request_handler_with_lifecycle(
            shared.session.clone(),
            shared.identity.clone(),
            shared.permissions.clone(),
            Some(shared.clone()),
        );
        let downloads = DownloadAttachment::default();
        if let Some(delegate) = &group.downloads {
            if downloads
                .attach(shared.identity.clone(), delegate.clone(), shared.clone())
                .is_err()
            {
                group.registry.creation_aborted(&id);
                return Err(PopupError::OwnerUnavailable);
            }
        }
        let native_client =
            NativeClient::new(shared.clone(), request, slot.clone(), downloads.clone());
        // CEF creates the ACTUAL popup with the opener's request context. Do
        // not replay its URL or set no_javascript_access: preserve window.opener.
        // Reuse only the captured trusted embedded parent, never page geometry.
        *info = group.context.info.clone();
        *settings = group.context.settings.clone();
        let mut appearance_info = group.context.extra_info.copy(0)
            .unwrap_or_else(|| group.context.extra_info.clone());
        let _ = cef_appearance::write_extra_info(&shared, &mut appearance_info);
        *extra_info = Some(appearance_info);
        *client = Some(native_client);
        group.pending.insert(
            id.clone(),
            View {
                host: facade(shared, slot, downloads),
            },
        );
        group
            .requests
            .insert((browser.identifier(), popup_id), id.clone());
        Ok(id)
    })
}

/// CEF does not create a popup for OnOpenURLFromTab; allowing its default would
/// navigate the opener. Cancel that navigation and create a REAL native child
/// on the next UI turn with the exact already-existing request context.
pub(super) fn open_url_from_tab(
    opener: &Arc<Shared>,
    browser: Option<&Browser>,
    frame: Option<&Frame>,
    target: Option<&CefString>,
    disposition: WindowOpenDisposition,
    gesture: bool,
) -> Result<(), PopupError> {
    let target = target.ok_or(PopupError::InvalidDestination)?;
    let popup_id = NEXT_LINK_TAB
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_sub(1))
        .map_err(|_| PopupError::LimitReached)?;
    let mut info = WindowInfo::default();
    let mut settings = BrowserSettings::default();
    let mut client = None;
    let mut extra = None;
    let id = before_popup(
        opener,
        browser,
        frame,
        popup_id,
        Some(target),
        disposition,
        gesture,
        Some(&mut info),
        Some(&mut client),
        Some(&mut settings),
        Some(&mut extra),
    )?;
    let opener_id = browser.ok_or(PopupError::InvalidSource)?.identifier();
    let Some(client) = client else {
        aborted(&opener.popup, opener_id, popup_id);
        return Err(PopupError::OwnerUnavailable);
    };
    let mut task = DeferredLinkTab::new(
        Arc::downgrade(opener),
        opener_id,
        popup_id,
        id,
        client,
        target.to_string(),
    );
    if post_task(ThreadId::UI, Some(&mut task)) != 1 {
        aborted(&opener.popup, opener_id, popup_id);
        return Err(PopupError::OwnerUnavailable);
    }
    Ok(())
}

wrap_task! {
    struct DeferredLinkTab {
        opener: std::sync::Weak<Shared>, opener_id: i32, popup_id: i32,
        view_id: String, client: Client, target: String
    }
    impl Task {
        fn execute(&self) {
            let Some(opener) = self.opener.upgrade() else { return; };
            let context = GROUPS.with(|groups| {
                let groups = groups.try_borrow().ok()?;
                let group = groups.get(&opener.popup.group)?;
                (opener.current() && group.policy == Some(NativePopupPolicy::Tabs)
                    && group.registry.pending_navigation_allowed(&self.view_id, &self.target, Instant::now()))
                    .then(|| group.context.clone())
            });
            let Some(context) = context else {
                aborted(&opener.popup, self.opener_id, self.popup_id);
                return;
            };
            // No RefCell/registry borrow survives into re-entrant CEF callbacks.
            let mut appearance_info = context.extra_info.copy(0)
                .unwrap_or_else(|| context.extra_info.clone());
            let _ = cef_appearance::write_extra_info(&opener, &mut appearance_info);
            let browser = browser_host_create_browser_sync(Some(&context.info),
                Some(&mut self.client.clone()), Some(&CefString::from(self.target.as_str())),
                Some(&context.settings), Some(&mut appearance_info),
                Some(&mut context.native.clone()));
            if browser.is_none() { aborted(&opener.popup, self.opener_id, self.popup_id); }
        }
    }
}

pub(super) fn after_created(shared: &Arc<Shared>, browser: &Browser) -> bool {
    let Some((id, _)) = &shared.popup.child else {
        return true;
    };
    GROUPS.with(|groups| {
        let Ok(mut groups) = groups.try_borrow_mut() else {
            return false;
        };
        let Some(group) = groups.get_mut(&shared.popup.group) else {
            return false;
        };
        let Some(view) = group.pending.remove(id) else {
            return false;
        };
        let same_context = browser
            .host()
            .and_then(|host| host.request_context())
            .is_some_and(|context| context.is_same(Some(&mut group.context.native.clone())) == 1);
        group
            .registry
            .attach_verified(
                id,
                group.context.clone(),
                view,
                same_context && shared.current(),
                Instant::now(),
            )
            .is_ok()
    })
}

pub(super) fn aborted(role: &PopupRole, browser_id: i32, popup_id: i32) {
    GROUPS.with(|groups| {
        let Ok(mut groups) = groups.try_borrow_mut() else {
            return;
        };
        let Some(group) = groups.get_mut(&role.group) else {
            return;
        };
        if let Some(id) = group.requests.remove(&(browser_id, popup_id)) {
            group.registry.creation_aborted(&id);
            group.pending.remove(&id);
            if let Ok(mut events) = group.events.values.lock() {
                events.remove(&id);
            }
        }
    });
}

pub(super) fn before_close(shared: &Shared) {
    GROUPS.with(|groups| {
        let Ok(mut groups) = groups.try_borrow_mut() else {
            return;
        };
        let Some(group) = groups.get_mut(&shared.popup.group) else {
            return;
        };
        if let Some(browser_id) = shared.state.lock().ok().and_then(|state| state.browser_id) {
            for pending in group.registry.opener_closed(browser_id) {
                if let Some(view) = group.pending.remove(&pending) {
                    view.host.shared.revoke();
                }
                group.requests.retain(|_, value| value != &pending);
            }
            group.registry.before_close(browser_id);
        }
        let Some((id, _)) = &shared.popup.child else {
            return;
        };
        group.pending.remove(id);
        group.requests.retain(|_, value| value != id);
        if let Ok(mut events) = group.events.values.lock() {
            events.remove(id);
        };
    });
}

pub(super) fn close_source(role: &PopupRole) {
    if role.child.is_some() || currently_on(ThreadId::UI) != 1 {
        return;
    }
    GROUPS.with(|groups| {
        if let Ok(mut groups) = groups.try_borrow_mut() {
            if let Some(group) = groups.get_mut(&role.group) {
                let _ = group.registry.close_source();
            }
        }
    });
}

pub(super) fn source_lifecycle(role: &PopupRole, lifecycle: Lifecycle) -> Lifecycle {
    if role.child.is_some() || role.group == 0 || currently_on(ThreadId::UI) != 1 {
        return lifecycle;
    }
    GROUPS.with(|groups| {
        let Ok(mut groups) = groups.try_borrow_mut() else {
            return Lifecycle::Closing;
        };
        let Some(group) = groups.get_mut(&role.group) else {
            return lifecycle;
        };
        let _ = group.registry.maintain(Instant::now());
        if lifecycle == Lifecycle::Closed && !group.registry.drained() {
            Lifecycle::Closing
        } else {
            lifecycle
        }
    })
}

pub(super) fn release(role: &PopupRole) {
    if role.child.is_some() {
        return;
    }
    GROUPS.with(|groups| {
        if let Ok(mut groups) = groups.try_borrow_mut() {
            if groups
                .get(&role.group)
                .is_some_and(|group| group.registry.drained())
            {
                groups.remove(&role.group);
            }
        }
    });
}

/// Native-only owner-window data. Runtime must authenticate its existing source
/// Attempt/window before forwarding a bounded allowlist DTO (never broadcast).
pub struct NativePopupInventory {
    pub source_identity: BrowserIdentity,
    pub sequence: u64,
    pub source_closed: bool,
    pub views: Vec<NativePopupViewState>,
}
pub struct NativePopupViewState {
    pub view_id: String,
    pub disposition: PopupDisposition,
    pub phase: PopupPhase,
    pub state: Option<BrowserState>,
    pub display: BrowserDisplayState,
}

impl CefBrowserHost<'_> {
    /// Explicit owner-shell new tab, not a renderer claim about the current URL.
    /// The runtime must fence its exact selected view/presentation and lease.
    /// Omitted address reads this actual browser's native main frame; supplied
    /// addresses are admitted by the same navigation policy as navigate().
    /// Creation/adoption uses the existing group's private context and sink.
    pub fn open_tab(
        &self,
        identity: &BrowserIdentity,
        address: Option<&str>,
    ) -> Result<(), PopupError> {
        let browser = self
            .check(identity)
            .map_err(|_| PopupError::OwnerUnavailable)?;
        if self.shared.input_blocked.load(Ordering::Acquire) {
            return Err(PopupError::OwnerUnavailable);
        }
        let frame = browser.main_frame().ok_or(PopupError::InvalidSource)?;
        if frame.is_valid() != 1 || frame.is_main() != 1 {
            return Err(PopupError::InvalidSource);
        }
        let target = tab_destination(address, || {
            let url = CefString::from(&frame.url());
            url.as_slice()
                .filter(|value| value.len() <= 16_384)
                .map(|_| url.to_string())
        })?;
        self.authorize(identity, &target)
            .map_err(|_| PopupError::InvalidDestination)?;
        open_url_from_tab(
            &self.shared,
            Some(&browser),
            Some(&frame),
            Some(&CefString::from(target.as_str())),
            WindowOpenDisposition::NEW_FOREGROUND_TAB,
            true, // Explicit owner-shell action, never a page-provided gesture.
        )
    }

    fn download_slots(
        &self,
        identity: &BrowserIdentity,
    ) -> Result<
        Vec<(Option<String>, crate::native_downloads::DownloadSnapshot)>,
        crate::native_downloads::DownloadError,
    > {
        use crate::native_downloads::DownloadError;
        self.popup_owner(identity)
            .map_err(|_| DownloadError::OwnerUnavailable)?;
        let mut rows: Vec<_> = self
            .downloads(identity)?
            .into_iter()
            .map(|row| (None, row))
            .collect();
        let inventory = self
            .popup_inventory(identity)
            .map_err(|_| DownloadError::OwnerUnavailable)?;
        for child in inventory
            .views
            .into_iter()
            .filter(|child| child.phase == PopupPhase::Adopted)
        {
            let downloads =
                self.with_popup(identity, &child.view_id, |host| host.downloads(identity));
            // Closing children can disappear between native callbacks. Never
            // redirect their controls to another manager or revoke the source.
            if let Ok(Ok(downloads)) = downloads {
                rows.extend(
                    downloads
                        .into_iter()
                        .map(|row| (Some(child.view_id.clone()), row)),
                );
            }
        }
        let mut ids = std::collections::HashSet::new();
        if rows.len() > 128 || rows.iter().any(|(_, row)| !ids.insert(row.download_id)) {
            return Err(DownloadError::Unavailable);
        }
        Ok(rows)
    }

    /// Source-wide inventory, using the shared attempt pool's globally unique
    /// IDs. Individual managers retain their exact-browser native guards.
    pub fn downloads_across_views(
        &self,
        identity: &BrowserIdentity,
    ) -> Result<
        Vec<crate::native_downloads::DownloadSnapshot>,
        crate::native_downloads::DownloadError,
    > {
        self.download_slots(identity)
            .map(|rows| rows.into_iter().map(|(_, row)| row).collect())
    }

    pub fn control_download_across_views(
        &self,
        request: &crate::native_downloads::DownloadControlRequest,
    ) -> Result<(), crate::native_downloads::DownloadError> {
        use crate::native_downloads::DownloadError;
        request
            .identity
            .validate_matches(self.identity())
            .map_err(|_| DownloadError::OwnerUnavailable)?;
        let owner = self
            .download_slots(self.identity())?
            .into_iter()
            .find(|(_, row)| row.download_id == request.download_id)
            .ok_or(DownloadError::Unavailable)?
            .0;
        match owner {
            None => self.download_control(request),
            Some(id) => self
                .with_popup(self.identity(), &id, |host| host.download_control(request))
                .map_err(|_| DownloadError::Unavailable)?,
        }
    }

    /// Supply the SAME native-authorized delegate used by enable_downloads.
    /// Each future child gets its own attachment with an exact-child guard.
    /// Omitting this keeps child downloads denied; no policy is inferred.
    pub fn enable_popup_downloads(
        &self,
        delegate: Arc<dyn crate::native_downloads::NativeDownloadDelegate>,
    ) -> Result<(), BrowserError> {
        self.check(self.identity())?;
        if self.shared.popup.child.is_some() {
            return Err(BrowserError::StateUnavailable);
        }
        GROUPS.with(|groups| {
            let mut groups = groups
                .try_borrow_mut()
                .map_err(|_| BrowserError::StateUnavailable)?;
            let group = groups
                .get_mut(&self.shared.popup.group)
                .ok_or(BrowserError::StateUnavailable)?;
            if group.downloads.is_some() {
                return Err(BrowserError::StateUnavailable);
            }
            group.downloads = Some(delegate);
            Ok(())
        })
    }

    /// Install the native-resolved saved global policy once, before website
    /// navigation. No popup callback or renderer payload can enable this.
    pub fn configure_popup_policy(&self, policy: NativePopupPolicy) -> Result<(), BrowserError> {
        self.check(self.identity())?;
        if self.shared.popup.child.is_some() {
            return Err(BrowserError::StateUnavailable);
        }
        GROUPS.with(|groups| {
            let mut groups = groups
                .try_borrow_mut()
                .map_err(|_| BrowserError::StateUnavailable)?;
            let group = groups
                .get_mut(&self.shared.popup.group)
                .ok_or(BrowserError::StateUnavailable)?;
            if group.policy.is_some_and(|current| current != policy) {
                return Err(BrowserError::StateUnavailable);
            }
            group.policy = Some(policy);
            Ok(())
        })
    }

    fn popup_owner(&self, identity: &BrowserIdentity) -> Result<(), PopupError> {
        ui_thread().map_err(|_| PopupError::OwnerUnavailable)?;
        if identity != self.identity() || self.shared.popup.child.is_some() {
            return Err(PopupError::InvalidSource);
        }
        Ok(())
    }

    /// Poll from the existing UI pump; sequence advances for registry AND child
    /// page-state changes. This never publishes to the source root event sink.
    pub fn popup_inventory(
        &self,
        identity: &BrowserIdentity,
    ) -> Result<NativePopupInventory, PopupError> {
        self.popup_owner(identity)?;
        GROUPS.with(|groups| {
            let mut groups = groups
                .try_borrow_mut()
                .map_err(|_| PopupError::OwnerUnavailable)?;
            let group = groups
                .get_mut(&self.shared.popup.group)
                .ok_or(PopupError::OwnerUnavailable)?;
            group.registry.maintain(Instant::now())?;
            let inventory = group.registry.inventory(OWNER, &group.source)?;
            let events = group
                .events
                .values
                .lock()
                .map_err(|_| PopupError::OwnerUnavailable)?;
            Ok(NativePopupInventory {
                source_identity: identity.clone(),
                sequence: inventory
                    .sequence
                    .saturating_add(group.events.revision.load(Ordering::Relaxed)),
                source_closed: inventory.source_closed,
                views: inventory
                    .views
                    .into_iter()
                    .map(|view| {
                        let event = events.get(&view.view_id);
                        NativePopupViewState {
                            view_id: view.view_id,
                            disposition: view.disposition,
                            phase: view.phase,
                            state: event.map(|event| event.state.clone()),
                            display: event
                                .map(|event| BrowserDisplayState {
                                    url: event.display.url.clone(),
                                    title: event.display.title.clone(),
                                })
                                .unwrap_or_default(),
                        }
                    })
                    .collect(),
            })
        })
    }

    /// Claims the existing hidden native popup. It does NOT show/focus it.
    pub fn adopt_popup(&self, identity: &BrowserIdentity, view_id: &str) -> Result<(), PopupError> {
        self.popup_owner(identity)?;
        GROUPS.with(|groups| {
            let mut groups = groups
                .try_borrow_mut()
                .map_err(|_| PopupError::OwnerUnavailable)?;
            let group = groups
                .get_mut(&self.shared.popup.group)
                .ok_or(PopupError::OwnerUnavailable)?;
            group
                .registry
                .adopt(OWNER, &group.source, view_id, Instant::now())
        })
    }

    /// Borrow distinct child controls outside the registry borrow, so CEF may
    /// synchronously re-enter callbacks. Route navigation, bounds, occlusion,
    /// input blocking and focus through the existing host methods unchanged.
    pub fn with_popup<R>(
        &self,
        identity: &BrowserIdentity,
        view_id: &str,
        action: impl FnOnce(&CefBrowserHost<'_>) -> R,
    ) -> Result<R, PopupError> {
        self.popup_owner(identity)?;
        let host = GROUPS.with(|groups| {
            let mut groups = groups
                .try_borrow_mut()
                .map_err(|_| PopupError::OwnerUnavailable)?;
            let group = groups
                .get_mut(&self.shared.popup.group)
                .ok_or(PopupError::OwnerUnavailable)?;
            group
                .registry
                .with_view(OWNER, &group.source, view_id, |view| {
                    facade(
                        view.host.shared.clone(),
                        view.host.browser.clone(),
                        view.host.downloads.clone(),
                    )
                })
        })?;
        Ok(action(&host))
    }

    /// Idempotent view-only cleanup remains authorized after source revocation.
    pub fn close_popup(&self, identity: &BrowserIdentity, view_id: &str) -> Result<(), PopupError> {
        self.popup_owner(identity)?;
        GROUPS.with(|groups| {
            let mut groups = groups
                .try_borrow_mut()
                .map_err(|_| PopupError::OwnerUnavailable)?;
            let group = groups
                .get_mut(&self.shared.popup.group)
                .ok_or(PopupError::OwnerUnavailable)?;
            group.registry.close_view(OWNER, &group.source, view_id)
        })
    }
}
