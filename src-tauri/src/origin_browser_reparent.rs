//! Display-only reparent of a native browser page onto a detached app window.
//!
//! The page keeps its single native owner: `Attempt.window`, the
//! `NativeOwnerLease`, the event sink, downloads and certificate hooks all stay
//! on the owner window (`main`). Only the page's native child HWND is moved so
//! a detached window can *display* the same live page without a reload or a new
//! sign-in. The detached window gains no capability: every command here must be
//! issued by the owner window and names a target that is a different, trusted,
//! local `detached-<sessionId>` app window.
//!
//! If the owner window closes the page closes (existing behaviour). If the
//! target window closes the page is first returned to the owner window.
use super::*;
use crate::origin_browser_reparent_state::{Action, Event, Notice, State};
use serde::Deserialize;
use serde_json::json;
use sorng_commands_core::database_protection::delegation;

/// Owner-window event: the page left its target window (or was closed).
pub(super) const EVENT: &str = "origin-browser-reparent";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReparentRequest {
    pub identity: OriginBrowserIdentity,
    pub action: ReparentAction,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum ReparentAction {
    /// Move the page onto `target` (hidden until the owner presents it there).
    Move { target: String },
    /// The owner saw `target` report a usable slot.
    Claim { target: String },
    /// Take the page back into the owner window.
    Release {},
}

impl ReparentRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        self.identity.validate().map_err(|error| error.to_string())
    }
}

pub(crate) fn supported() -> bool {
    CefBrowserHost::reparent_supported()
}

#[cfg(target_os = "windows")]
fn handle_of(window: &WebviewWindow) -> Result<usize, String> {
    window
        .hwnd()
        .map(|hwnd| hwnd.0 as usize)
        .map_err(|_| UNAVAILABLE.to_owned())
}

#[cfg(not(target_os = "windows"))]
fn handle_of(_window: &WebviewWindow) -> Result<usize, String> {
    Err("Detaching a native browser page is not supported on this platform.".into())
}

pub(crate) async fn command(
    window: WebviewWindow,
    request: ReparentRequest,
) -> Result<(), String> {
    if !supported() {
        return Err("Detaching a native browser page is not supported on this platform.".into());
    }
    // Only the owner window of this exact attempt; `lookup` compares the
    // caller's label with `Attempt.window` and the full identity.
    let attempt = lookup(&window, &request.identity)?;
    if attempt.window != "main" || window.label() != "main" || !attempt.current() {
        return Err(STALE.into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let owner = window.clone();
    window
        .run_on_main_thread(move || {
            let result = UI.with(|slot| {
                let mut slot = slot.borrow_mut();
                let ui = slot.as_mut().ok_or(UNAVAILABLE)?;
                let view = ui
                    .views
                    .get_mut(&attempt.identity.attempt_id().to_string())
                    .ok_or(STALE)?;
                if !Arc::ptr_eq(&view.attempt, &attempt) || !attempt.current() {
                    return Err(STALE.to_owned());
                }
                apply(view, &owner, request.action)
            });
            let _ = sender.send(result);
        })
        .map_err(|_| UNAVAILABLE.to_owned())?;
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| UNAVAILABLE.to_owned())?
        .map_err(|_| UNAVAILABLE.to_owned())?
}

fn apply(view: &mut View, owner: &WebviewWindow, action: ReparentAction) -> Result<(), String> {
    match action {
        ReparentAction::Move { target } => {
            // Popup views are separate native children that are not moved.
            if view.popups.selected.is_some() {
                return Err("Close the page's popup view before detaching it.".into());
            }
            let session = view.attempt.identity.session_id();
            if target != format!("detached-{session}") {
                return Err("The target is not this session's detached window.".into());
            }
            // Same proof database delegation uses for a detached shell.
            let target_window = delegation::require_detached_app_window(owner, &target)
                .map_err(|_| "The detached window is not a trusted app window.".to_owned())?;
            let handle = handle_of(&target_window)?;
            match view
                .reparent
                .step(Event::Handoff { target, now: Instant::now() })
            {
                Action::MoveTo(_) => {}
                _ => return Err("The page is already shown in another window.".into()),
            }
            match view.host.reparent(&view.attempt.identity, handle) {
                Ok(()) => {
                    view.display = Some(target_window);
                    moved(view);
                    Ok(())
                }
                Err(_) => {
                    // Nothing moved; the page stays presented where it was.
                    view.reparent = State::Held;
                    Err("The browser page could not be moved to the detached window.".into())
                }
            }
        }
        ReparentAction::Claim { target } => match view.reparent.step(Event::Claim { target }) {
            Action::None => Ok(()),
            _ => Err("The claim does not match the detached window.".into()),
        },
        ReparentAction::Release {} => run(view, Event::Release),
    }
}

/// The page is hidden, fenced and has no known geometry until re-presented.
fn moved(view: &mut View) {
    view.visible = false;
    view.input_blocked = true;
    view.presentation_bounds = None;
}

/// Feed one event to the machine and perform the resulting native action.
fn run(view: &mut View, event: Event) -> Result<(), String> {
    match view.reparent.step(event) {
        Action::None => Ok(()),
        Action::Refuse(_) => Err("The request does not match the page's display window.".into()),
        Action::MoveTo(_) => Ok(()),
        Action::ReturnToOwner(notice) => {
            let back = handle_of(&view.window)
                .and_then(|handle| {
                    view.host
                        .reparent(&view.attempt.identity, handle)
                        .map_err(|_| UNAVAILABLE.to_owned())
                });
            match back {
                Ok(()) => {
                    view.display = None;
                    moved(view);
                    view.reparent.step(Event::ReturnDone);
                    publish(view, "returned", notice);
                    Ok(())
                }
                Err(error) => {
                    let _ = view.reparent.step(Event::ReturnFailed);
                    view.display = None;
                    publish(view, "closed", Some(Notice::ReturnFailed));
                    retire(view);
                    Err(error)
                }
            }
        }
        Action::Close(notice) => {
            publish(view, "closed", Some(notice));
            retire(view);
            Ok(())
        }
    }
}

fn publish(view: &View, kind: &str, notice: Option<Notice>) {
    let _ = view.window.emit(
        EVENT,
        json!({
            "kind": kind,
            "reason": notice.as_ref().map(Notice::code),
            "sessionId": view.attempt.identity.session_id(),
            "attemptId": view.attempt.identity.attempt_id().to_string(),
        }),
    );
}

/// Housekeeping: an unclaimed handoff returns to the owner after its deadline.
pub(super) fn tick(view: &mut View) {
    if view.reparent.displayed_elsewhere() && view.attempt.current() {
        let _ = run(view, Event::Tick { now: Instant::now() });
    }
}

/// A display window is closing (or already gone): every page it shows goes
/// back to its owner window first; a page that cannot return is closed.
pub(super) fn display_closing(label: &str) {
    UI.with(|slot| {
        let mut slot = slot.borrow_mut();
        let Some(ui) = slot.as_mut() else {
            return;
        };
        for view in ui.views.values_mut() {
            if view.reparent.target() == Some(label) && view.attempt.current() {
                let _ = run(
                    view,
                    Event::TargetClosed {
                        target: label.to_owned(),
                    },
                );
            }
        }
    });
}
