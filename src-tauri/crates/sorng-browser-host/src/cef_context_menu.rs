//! Native menu presentation with explicit app-owned commands. CEF draws only
//! our allowlisted model; unknown/default commands are always consumed.
use super::*;
use crate::cef_devtools_policy::inspect_point;
use std::cell::RefCell;
use std::sync::Weak;

#[path = "cef_context_menu_clipboard.rs"]
mod clipboard;
#[path = "cef_context_menu_policy.rs"]
mod policy;
use policy::{Action, Address, Command, Document, Media, MenuState, Receipt, Target, MAX_ADDRESS};
#[cfg(test)]
#[path = "cef_context_menu_tests.rs"]
mod tests;

struct Pending {
    owner: Weak<Shared>,
    receipt: Receipt,
}
// GetContextMenuHandler may return a fresh wrapper per callback. Keep the
// receipt per exact native view, not per wrapper, and never retain the owner.
thread_local! { static MENUS: RefCell<HashMap<usize, Pending>> = RefCell::new(HashMap::new()); }

fn key(shared: &Shared) -> usize {
    shared as *const Shared as usize
}

fn clear(shared: &Shared) {
    MENUS.with(|menus| {
        menus.borrow_mut().remove(&key(shared));
    });
}

/// The handler's only way to the host and to the OS clipboard. Production has
/// one implementation. Unit tests substitute a recorder: host methods need
/// the CEF UI thread, and no test may write the developer's clipboard.
trait Effects {
    fn manual_input(&self, shared: &Shared) -> bool;
    /// The view's popup policy lets it open a new tab.
    fn tabs(&self, shared: &Shared) -> bool;
    fn clipboard(&self) -> bool;
    fn run(&self, host: &CefBrowserHost<'_>, command: &Command) -> Result<(), BrowserError>;
}

struct Native;
impl Effects for Native {
    fn manual_input(&self, shared: &Shared) -> bool {
        manual_input::active(shared)
    }

    fn tabs(&self, shared: &Shared) -> bool {
        cef_popups::tabs_allowed(&shared.popup)
    }

    fn clipboard(&self) -> bool {
        clipboard::AVAILABLE
    }

    fn run(&self, host: &CefBrowserHost<'_>, command: &Command) -> Result<(), BrowserError> {
        let identity = &host.shared.identity;
        #[cfg(feature = "acceptance-probe")]
        if let (Command::CopyText(address), Some(sink)) = (command, probe::sink(&host.shared)) {
            return clipboard::write(&sink, address).map_err(|_| BrowserError::StateUnavailable);
        }
        // Existing host methods authorize the owner/current URL, with
        // destination policy checked again by OnBeforeBrowse. A new tab's
        // address is admitted by open_tab() exactly as navigate() admits one.
        match command {
            Command::Back => host.back(identity),
            Command::Forward => host.forward(identity),
            Command::Reload => host.reload(identity),
            Command::Stop => host.stop(identity),
            Command::DevTools => host.open_devtools(identity),
            Command::Inspect(x, y) => host.inspect_element(identity, *x, *y),
            Command::Print => host.print_page(identity),
            Command::OpenTab(address) => host
                .open_tab(identity, Some(address))
                .map_err(|_| BrowserError::StateUnavailable),
            Command::CopyText(address) => clipboard::write(&clipboard::System, address)
                .map_err(|_| BrowserError::StateUnavailable),
        }
    }
}

/// A clicked address, or nothing when the engine reports none or one too
/// long to keep.
fn address(value: &CefString) -> String {
    match value.as_slice() {
        Some(units) if units.len() <= MAX_ADDRESS => value.to_string(),
        _ => String::new(),
    }
}

// Compared as values: the enum's integer type differs between platforms.
fn media(kind: ContextMenuMediaType) -> Media {
    if kind == ContextMenuMediaType::IMAGE {
        Media::Image
    } else if kind == ContextMenuMediaType::VIDEO {
        Media::Video
    } else if kind == ContextMenuMediaType::AUDIO {
        Media::Audio
    } else {
        Media::None
    }
}

// The flags newtype wraps c_int on Windows and c_uint on macOS and Linux; i64
// holds either. A value outside u32 cannot be a flag set: nothing is allowed.
fn edit_flags(flags: ContextMenuEditStateFlags) -> u32 {
    u32::try_from(i64::from(flags.as_ref().0)).unwrap_or(0)
}

fn capture(
    shared: &Shared,
    effects: &dyn Effects,
    browser: Option<&Browser>,
    frame: Option<&Frame>,
    params: Option<&ContextMenuParams>,
) -> Option<(Document, MenuState, Target)> {
    let browser = browser.filter(|browser| shared.focus_allowed(Some(browser)))?;
    // A manual-input slot owns the focused field until it completes. No menu
    // command may edit, navigate or take focus underneath it.
    if effects.manual_input(shared) {
        return None;
    }
    let frame =
        frame.filter(|frame| frame.is_valid() == 1 && shared.accepts(frame.browser().as_ref()))?;
    let params = params?;
    let identifier = CefString::from(&frame.identifier());
    let url = CefString::from(&frame.url());
    if identifier
        .as_slice()
        .is_none_or(|value| value.is_empty() || value.len() > 256)
        || url.as_slice().is_none_or(|value| value.len() > 16_384)
    {
        return None;
    }
    let generation = shared.automation.lock().ok()?.generation;
    let link = address(&CefString::from(&params.link_url()));
    let unfiltered_link = address(&CefString::from(&params.unfiltered_link_url()));
    let media = media(params.media_type());
    let source = match media {
        Media::None => String::new(),
        _ => address(&CefString::from(&params.source_url())),
    };
    // "Open ... in new tab" is enabled only for what open_tab() would act
    // on: the view's popup policy allows tabs and the navigation policy
    // admits the address. open_tab() checks both again with the command.
    let tabs = effects.tabs(shared);
    let admitted = |address: &str| {
        tabs && shared.session.lock().is_ok_and(|session| {
            navigation_allowed(
                &session,
                &shared.identity,
                &shared.permissions,
                address,
                true,
            )
        })
    };
    // The click in the coordinates of the page's own view, also when it
    // landed inside a frame (measured in the engine; see inspect_element).
    let point = (params.xcoord(), params.ycoord());
    Some((
        Document {
            browser: browser.identifier(),
            generation,
            frame: identifier.to_string(),
            url: url.to_string(),
        },
        MenuState {
            back: browser.can_go_back() == 1,
            forward: browser.can_go_forward() == 1,
            loading: browser.is_loading() == 1,
            editable: params.is_editable() == 1,
            edit_flags: edit_flags(params.edit_state_flags()),
            link: Address::of(&link, &unfiltered_link, admitted),
            media,
            source: Address::of(&source, &source, admitted),
            clipboard: effects.clipboard(),
            inspect: inspect_point(point.0, point.1).is_some(),
        },
        Target {
            link,
            unfiltered_link,
            source,
            point,
        },
    ))
}

// Edit rows act on the frame that was clicked, and only while it has focus.
fn edit(frame: Option<&Frame>, action: Action) -> Result<(), BrowserError> {
    let frame = frame
        .filter(|frame| frame.is_focused() == 1)
        .ok_or(BrowserError::StateUnavailable)?;
    match action {
        Action::Undo => frame.undo(),
        Action::Redo => frame.redo(),
        Action::Cut => frame.cut(),
        Action::Copy => frame.copy(),
        Action::Paste => frame.paste(),
        Action::PasteAsPlainText => frame.paste_and_match_style(),
        Action::Delete => frame.del(),
        Action::SelectAll => frame.select_all(),
        _ => return Err(BrowserError::StateUnavailable),
    }
    Ok(())
}

// Fixed action code only. This takes no command on purpose: page text,
// clipboard contents, addresses and native error payloads cannot reach it.
fn report(action: Action) {
    use std::io::Write;
    let _ = writeln!(
        std::io::stderr().lock(),
        "Native browser context-menu action={action:?} failure=command-unavailable"
    );
}

pub(super) fn handler(
    shared: Arc<Shared>,
    browser: BrowserSlot,
    downloads: DownloadAttachment,
) -> ContextMenuHandler {
    OwnedContextMenu::new(shared, browser, downloads, Arc::new(Native))
}

// This facade borrows the exact root/child controls. It cannot close a view,
// release its private context or recreate a browser when dropped.
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

wrap_context_menu_handler! {
    struct OwnedContextMenu { shared: Arc<Shared>, browser: BrowserSlot, downloads: DownloadAttachment, effects: Arc<dyn Effects> }
    impl ContextMenuHandler {
        fn on_before_context_menu(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            params: Option<&mut ContextMenuParams>, model: Option<&mut MenuModel>) {
            #[cfg(feature = "acceptance-probe")]
            probe::requested(&self.shared);
            clear(&self.shared);
            let Some(model) = model else { return; };
            // Never inherit CEF save-as, external navigation, raw downloads,
            // source viewing, search-provider or default developer-tool actions.
            if model.clear() != 1 { return; }
            // Rows are only ever added inside this engine-initiated callback.
            // Nothing in this module asks CEF to open a menu, so a page that
            // takes over `contextmenu` is not overridden from here.
            let Some((document, state, target)) = capture(&self.shared, &*self.effects, browser.as_deref(), frame.as_deref(), params.as_deref()) else { return; };
            #[cfg(feature = "acceptance-probe")]
            probe::observed(&self.shared, state, &target);
            let rows = state.rows();
            let mut previous = None;
            for (action, enabled) in &rows {
                if previous.is_some_and(|group| group != action.group()) && model.add_separator() != 1 {
                    model.clear(); return;
                }
                if model.add_item(*action as i32, Some(&CefString::from(action.label()))) != 1
                    || model.set_enabled(*action as i32, i32::from(*enabled)) != 1 {
                    model.clear(); return;
                }
                previous = Some(action.group());
            }
            let published = MENUS.with(|menus| {
                let mut menus = menus.borrow_mut();
                menus.retain(|_, pending| pending.owner.strong_count() != 0);
                if menus.len() >= 128 { return false; }
                menus.insert(key(&self.shared), Pending { owner: Arc::downgrade(&self.shared),
                    receipt: Receipt { document, rows, target } });
                true
            });
            if !published { model.clear(); }
        }

        fn run_context_menu(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            params: Option<&mut ContextMenuParams>, model: Option<&mut MenuModel>, callback: Option<&mut RunContextMenuCallback>) -> i32 {
            let current = capture(&self.shared, &*self.effects, browser.as_deref(), frame.as_deref(), params.as_deref());
            let allowed = current.is_some_and(|(document, _, _)| MENUS.with(|menus| {
                menus.borrow().get(&key(&self.shared)).is_some_and(|pending|
                    pending.owner.ptr_eq(&Arc::downgrade(&self.shared)) && pending.receipt.document == document)
            })) && model.is_some_and(|model| model.count() > 0);
            if allowed {
                // An acceptance probe stands in for the popup. It selects only a
                // row the policy offered enabled; anything else is cancelled
                // below, exactly like a menu that may not be shown.
                #[cfg(feature = "acceptance-probe")]
                match (probe::choose(&self.shared), callback.as_deref()) {
                    (None, _) => return 0,
                    (Some(Some(id)), Some(callback)) => { callback.cont(id, EventFlags::default()); return 1; }
                    _ => {}
                }
                // CEF's native, keyboard-accessible presentation, NOT its command
                // implementation. Do not cancel or retain its callback/model.
                #[cfg(not(feature = "acceptance-probe"))]
                return 0;
            }
            clear(&self.shared);
            if let Some(callback) = callback { callback.cancel(); }
            1
        }

        fn on_context_menu_command(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            params: Option<&mut ContextMenuParams>, command_id: i32, _event_flags: EventFlags) -> i32 {
            // Consume before any native call: duplicate/reentrant commands cannot
            // reuse a gesture or redirect it to a replaced/hidden/revoked view.
            let pending = MENUS.with(|menus| menus.borrow_mut().remove(&key(&self.shared)));
            let current = capture(&self.shared, &*self.effects, browser.as_deref(), frame.as_deref(), params.as_deref());
            if let Some((pending, (document, state, target))) = pending.zip(current) {
                if let Some(action) = pending.receipt.resolve(&document, state, &target, command_id) {
                    // The address or point comes from the receipt, which the
                    // command-time params were just required to equal.
                    let result = match pending.receipt.target.command(action) {
                        Some(command) => self.effects.run(
                            &facade(self.shared.clone(), self.browser.clone(), self.downloads.clone()), &command),
                        None => edit(frame.as_deref(), action),
                    };
                    if result.is_err() { report(action); }
                }
            }
            1 // Never execute a CEF default, even on stale state or failure.
        }

        fn on_context_menu_dismissed(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>) {
            clear(&self.shared);
        }

        fn run_quick_menu(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _location: Option<&Point>, _size: Option<&Size>, _edit_state_flags: QuickMenuEditStateFlags,
            callback: Option<&mut RunQuickMenuCallback>) -> i32 { if let Some(callback) = callback { callback.cancel(); } 1 }
        fn on_quick_menu_command(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _command_id: i32, _event_flags: EventFlags) -> i32 { 1 }
    }
}

/// Acceptance evidence only. This module, and the three host methods in it,
/// exist solely with the `acceptance-probe` feature. Only the standalone
/// acceptance client enables it; the app's build contains none of this.
///
/// A probe is installed from in-process Rust for one exact view. It stands in
/// for the OS popup and the OS clipboard and for nothing else: the rows are
/// still the policy's, a pick is honoured only for a row the policy offered
/// enabled, and the command still has to pass the receipt. Its observer is
/// told what the policy saw and can change none of it. What it is told
/// includes page-controlled addresses: they go to the callback only.
#[cfg(feature = "acceptance-probe")]
mod probe {
    use super::*;

    /// One row as the model holds it: id, label, enabled.
    pub(super) type Row = (i32, &'static str, bool);
    pub(super) type Choose = dyn Fn(&[Row]) -> Option<i32>;
    pub(super) type Copied = dyn Fn(&str);
    /// In order: the validated link, the unfiltered link, the source
    /// address, the media kind, the raw edit-state flags, whether the target
    /// is editable, and the click point.
    pub(super) type Observe = dyn Fn(&str, &str, &str, &'static str, u32, bool, (i32, i32));

    /// The stand-in for the OS popup and the OS clipboard.
    struct Popup {
        requests: Arc<AtomicU64>,
        choose: ThreadBound<Choose>,
        copied: ThreadBound<Copied>,
    }
    struct Probe {
        owner: Weak<Shared>,
        popup: Option<Popup>,
        observe: Option<ThreadBound<Observe>>,
    }
    thread_local! { static PROBES: RefCell<HashMap<usize, Probe>> = RefCell::new(HashMap::new()); }

    // Copy what is needed out of the map before calling a probe's closure:
    // the closure may end or replace the probe.
    fn read<T>(shared: &Arc<Shared>, value: impl FnOnce(&Probe) -> Option<T>) -> Option<T> {
        PROBES.with(|probes| {
            probes
                .borrow()
                .get(&key(shared))
                .filter(|probe| probe.owner.ptr_eq(&Arc::downgrade(shared)))
                .and_then(value)
        })
    }

    // This view's probe, created empty if it has none. A dead view that
    // lived at the same address is dropped first.
    fn change(shared: &Arc<Shared>, part: impl FnOnce(&mut Probe)) {
        PROBES.with(|probes| {
            let mut probes = probes.borrow_mut();
            probes.retain(|_, probe| probe.owner.strong_count() != 0);
            part(probes.entry(key(shared)).or_insert_with(|| Probe {
                owner: Arc::downgrade(shared),
                popup: None,
                observe: None,
            }));
        });
    }

    pub(super) fn install(
        shared: &Arc<Shared>,
        requests: Arc<AtomicU64>,
        choose: Box<Choose>,
        copied: Box<Copied>,
    ) {
        change(shared, |probe| {
            probe.popup = Some(Popup {
                requests,
                choose: choose.into(),
                copied: copied.into(),
            });
        });
    }

    pub(super) fn watch(shared: &Arc<Shared>, observe: Box<Observe>) {
        change(shared, |probe| probe.observe = Some(observe.into()));
    }

    pub(super) fn remove(shared: &Arc<Shared>) {
        PROBES.with(|probes| {
            probes.borrow_mut().remove(&key(shared));
        });
    }

    /// The engine asked this view for a menu, whether or not one may be shown.
    pub(super) fn requested(shared: &Arc<Shared>) {
        let popup = |probe: &Probe| Some(probe.popup.as_ref()?.requests.clone());
        if let Some(requests) = read(shared, popup) {
            requests.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// The engine's request reached the policy. Observation only: the
    /// observer gets borrowed text and copies, and returns nothing.
    pub(super) fn observed(shared: &Arc<Shared>, state: MenuState, target: &Target) {
        let Some(observe) = read(shared, |probe| probe.observe.clone()) else {
            return;
        };
        let media = match state.media {
            Media::None => "none",
            Media::Image => "image",
            Media::Video => "video",
            Media::Audio => "audio",
        };
        observe(
            &target.link,
            &target.unfiltered_link,
            &target.source,
            media,
            state.edit_flags,
            state.editable,
            target.point,
        );
    }

    /// `None`: no probe here, the OS popup is used. `Some(None)`: cancel.
    /// `Some(Some(id))`: select that row, which the policy offered enabled.
    pub(super) fn choose(shared: &Arc<Shared>) -> Option<Option<i32>> {
        let choose = read(shared, |probe| Some(probe.popup.as_ref()?.choose.clone()))?;
        let rows: Vec<Row> = MENUS.with(|menus| {
            let menus = menus.borrow();
            let offered = menus
                .get(&key(shared))
                .map(|pending| &pending.receipt.rows[..]);
            let offered = offered.unwrap_or_default().iter();
            offered
                .map(|(action, enabled)| (*action as i32, action.label(), *enabled))
                .collect()
        });
        let picked = choose(&rows);
        Some(picked.filter(|id| rows.iter().any(|row| row.0 == *id && row.2)))
    }

    /// Where a "Copy ... address" row writes while a probe is installed. It
    /// goes through the same `clipboard::write` validation as the OS writer.
    pub(super) struct Sink(ThreadBound<Copied>);
    impl clipboard::Backend for Sink {
        fn replace(&self, text: &str) -> bool {
            (self.0)(text);
            true
        }
    }

    pub(super) fn sink(shared: &Arc<Shared>) -> Option<Sink> {
        read(shared, |probe| {
            Some(Sink(probe.popup.as_ref()?.copied.clone()))
        })
    }

    impl CefBrowserHost<'_> {
        /// Until `end_context_menu_probe`, for this exact view:
        /// - `requests` counts every menu the engine asks this view for,
        ///   including one the host then refuses to show. It moves only when
        ///   the engine asks, which tells a page that kept its own
        ///   `contextmenu` menu apart from a menu the host refused.
        /// - `choose` replaces the OS popup. It gets the rows the policy
        ///   produced (id, label, enabled) in display order, without
        ///   separators, and returns the id to select or `None` to cancel.
        ///   Only an enabled row it was given is selected; any other id
        ///   cancels.
        /// - `copied` gets the text of a "Copy ... address" row instead of the
        ///   OS clipboard.
        pub fn probe_context_menu(
            &self,
            identity: &BrowserIdentity,
            requests: Arc<AtomicU64>,
            choose: Box<Choose>,
            copied: Box<Copied>,
        ) -> Result<(), BrowserError> {
            self.check(identity)?;
            install(&self.shared, requests, choose, copied);
            Ok(())
        }

        /// Until `end_context_menu_probe`, `observe` is called once for each
        /// menu the engine asks this view for that reaches the policy, with
        /// what the policy saw, in this order:
        /// 1. the validated link (`link_url`), which a new tab would open;
        /// 2. the unfiltered link (`unfiltered_link_url`), which would be
        ///    copied: the same resolved, escaped address, unless the
        ///    browser process replaced the validated one;
        /// 3. the source address, kept only for an image, video or audio;
        /// 4. the media kind: "none", "image", "video" or "audio" (a
        ///    canvas, file or plugin is "none");
        /// 5. the raw edit-state flags;
        /// 6. whether the target is editable;
        /// 7. the click point (`xcoord`, `ycoord`) in the page's own view,
        ///    unchanged, exactly as "Inspect" passes it to the engine.
        ///
        /// An address the engine did not report, or one longer than 16,384
        /// UTF-16 units, is "". It is not called for a request the host
        /// refuses before the policy (those only move `requests`).
        /// Observation only: nothing it does or returns reaches the receipt,
        /// the rows or the command. It works with or without
        /// `probe_context_menu`.
        pub fn observe_context_menu_targets(
            &self,
            identity: &BrowserIdentity,
            observe: Box<Observe>,
        ) -> Result<(), BrowserError> {
            self.check(identity)?;
            watch(&self.shared, observe);
            Ok(())
        }

        /// Back to the OS popup and the real clipboard writer, and no more
        /// observer calls.
        pub fn end_context_menu_probe(
            &self,
            identity: &BrowserIdentity,
        ) -> Result<(), BrowserError> {
            self.check(identity)?;
            remove(&self.shared);
            Ok(())
        }
    }
}
