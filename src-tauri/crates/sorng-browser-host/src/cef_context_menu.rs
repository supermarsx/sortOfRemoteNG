//! Native menu presentation with explicit app-owned commands. CEF draws only
//! our allowlisted model; unknown/default commands are always consumed.
use super::*;
use std::cell::RefCell;
use std::sync::Weak;

#[path = "cef_context_menu_policy.rs"]
mod policy;
use policy::{Action, Document, MenuState, Receipt};
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

fn capture(
    shared: &Shared,
    browser: Option<&Browser>,
    frame: Option<&Frame>,
    params: Option<&ContextMenuParams>,
) -> Option<(Document, MenuState)> {
    let browser = browser.filter(|browser| shared.focus_allowed(Some(browser)))?;
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
            edit_flags: params.edit_state_flags().as_ref().0 as u32,
        },
    ))
}

pub(super) fn handler(
    shared: Arc<Shared>,
    browser: BrowserSlot,
    downloads: DownloadAttachment,
) -> ContextMenuHandler {
    OwnedContextMenu::new(shared, browser, downloads)
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
    struct OwnedContextMenu { shared: Arc<Shared>, browser: BrowserSlot, downloads: DownloadAttachment }
    impl ContextMenuHandler {
        fn on_before_context_menu(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            params: Option<&mut ContextMenuParams>, model: Option<&mut MenuModel>) {
            clear(&self.shared);
            let Some(model) = model else { return; };
            // Never inherit CEF save-as, external navigation, raw downloads,
            // source viewing, search-provider or default developer-tool actions.
            if model.clear() != 1 { return; }
            let Some((document, state)) = capture(&self.shared, browser.as_deref(), frame.as_deref(), params.as_deref()) else { return; };
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
                    receipt: Receipt { document, rows } });
                true
            });
            if !published { model.clear(); }
        }

        fn run_context_menu(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            params: Option<&mut ContextMenuParams>, model: Option<&mut MenuModel>, callback: Option<&mut RunContextMenuCallback>) -> i32 {
            let current = capture(&self.shared, browser.as_deref(), frame.as_deref(), params.as_deref());
            let allowed = current.is_some_and(|(document, _)| MENUS.with(|menus| {
                menus.borrow().get(&key(&self.shared)).is_some_and(|pending|
                    pending.owner.ptr_eq(&Arc::downgrade(&self.shared)) && pending.receipt.document == document)
            })) && model.is_some_and(|model| model.count() > 0);
            if allowed {
                // CEF's native, keyboard-accessible presentation, NOT its command
                // implementation. Do not cancel or retain its callback/model.
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
            let current = capture(&self.shared, browser.as_deref(), frame.as_deref(), params.as_deref());
            if let Some((pending, (document, state))) = pending.zip(current) {
                if let Some(action) = pending.receipt.resolve(&document, state, command_id) {
                    let host = facade(self.shared.clone(), self.browser.clone(), self.downloads.clone());
                    let identity = &self.shared.identity;
                    // Existing host navigation methods authorize the owner/current
                    // URL, with destination policy checked again by OnBeforeBrowse.
                    let result = match action {
                        Action::Back => host.back(identity),
                        Action::Forward => host.forward(identity),
                        Action::Reload => host.reload(identity),
                        Action::Stop => host.stop(identity),
                        Action::DevTools => host.open_devtools(identity),
                        _ => {
                            if let Some(frame) = frame.filter(|frame| frame.is_focused() == 1) {
                                match action {
                                    Action::Undo => frame.undo(), Action::Redo => frame.redo(),
                                    Action::Cut => frame.cut(), Action::Copy => frame.copy(),
                                    Action::Paste => frame.paste(), Action::Delete => frame.del(),
                                    Action::SelectAll => frame.select_all(), _ => {}
                                }
                                Ok(())
                            } else { Err(BrowserError::StateUnavailable) }
                        }
                    };
                    if result.is_err() {
                        // Fixed action/stage codes only: never include page text,
                        // clipboard contents, URLs or native error payloads.
                        use std::io::Write;
                        let _ = writeln!(std::io::stderr().lock(),
                            "Native browser context-menu action={action:?} failure=command-unavailable");
                    }
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
