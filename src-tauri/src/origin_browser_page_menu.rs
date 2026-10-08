//! Owner-window/selected-view entry point for native printing and history.
//! Mount as a child of origin_browser_runtime; command registration is central.
use super::*;
use crate::origin_browser_page_request::target_is_current;
pub(crate) use crate::origin_browser_page_request::{PageMenuAction, PageMenuRequest};
use serde_json::Value;
use sorng_browser_host::cef_browser::{PageMenuCompletion, PageMenuGuard, PageMenuResult};

fn selected(view: &View, attempt: &Arc<Attempt>, target: Option<&str>, mutating: bool) -> bool {
    Arc::ptr_eq(&view.attempt, attempt)
        && attempt.current()
        && shared().admission.ready()
        && target_is_current(
            target,
            view.popups.selected.as_deref(),
            view.visible,
            view.input_blocked,
            mutating,
        )
}

fn guard(attempt: &Arc<Attempt>, target: Option<String>, mutating: bool) -> PageMenuGuard {
    let weak = Arc::downgrade(attempt);
    Arc::new(move || {
        let Some(attempt) = weak.upgrade() else {
            return false;
        };
        UI.with(|slot| {
            let Ok(slot) = slot.try_borrow() else {
                return false;
            };
            slot.as_ref()
                .and_then(|ui| ui.views.get(&attempt.identity.attempt_id().to_string()))
                .is_some_and(|view| selected(view, &attempt, target.as_deref(), mutating))
        })
    })
}

pub(crate) async fn operate(
    window: WebviewWindow,
    state: &EncryptionState,
    request: PageMenuRequest,
) -> Result<Value, String> {
    request.validate()?;
    let attempt = lookup(&window, &request.identity)?;
    attempt
        .lease
        .recheck(&window, state)
        .await
        .map_err(|_| STALE)?;
    let mutating = !matches!(request.action, PageMenuAction::History {});
    let active = guard(&attempt, request.view_id.clone(), mutating);
    let (sender, receiver) = tokio::sync::oneshot::channel();
    // Allows synchronous start errors and asynchronous CEF completion to share
    // exactly one response; no application lock is held while CEF calls back.
    let sender = Arc::new(Mutex::new(Some(sender)));
    window.run_on_main_thread(move || {
        if sender.lock().map_or(true, |s| s.as_ref().is_none_or(|s| s.is_closed())) { return; }
        let reply = sender.clone();
        let result = UI.with(|slot| {
            let slot = slot.borrow();
            let ui = slot.as_ref().ok_or(UNAVAILABLE)?;
            let view = ui.views.get(&attempt.identity.attempt_id().to_string()).ok_or(STALE)?;
            if !selected(view, &attempt, request.view_id.as_deref(), mutating) { return Err(STALE.to_string()); }
            let callback: PageMenuCompletion = Box::new(move |result| {
                let result = match result {
                    Ok(PageMenuResult::History(snapshot)) => serde_json::to_value(snapshot).map_err(|_| UNAVAILABLE.to_string()),
                    Ok(PageMenuResult::Done) => Ok(Value::Null),
                    Err(_) => Err("The native history changed or the selected page is unavailable. Refresh the menu and try again.".into()),
                };
                let sender = reply.lock().ok().and_then(|mut s| s.take());
                if let Some(sender) = sender { let _ = sender.send(result); }
            });
            let action = |host: &CefBrowserHost<'_>| {
                match request.action {
                    PageMenuAction::Print {} => {
                        host.print_page(&attempt.identity)?;
                        callback(Ok(PageMenuResult::Done));
                        Ok(())
                    }
                    PageMenuAction::History {} => host.navigation_history(&attempt.identity, active, callback),
                    PageMenuAction::HistoryJump { snapshot_id, index } =>
                        host.navigate_history(&attempt.identity, &snapshot_id, index, active, callback),
                }
            };
            let result = if let Some(target) = request.view_id.as_deref() {
                view.host.with_popup(&attempt.identity, target, action)
                    .map_err(|_| "The selected website view is unavailable.".to_string())?
            } else { action(&view.host) };
            result.map_err(|_| "The native page-menu action is unavailable for the selected page.".to_string())
        });
        if let Err(error) = result {
            let sender = sender.lock().ok().and_then(|mut s| s.take());
            if let Some(sender) = sender { let _ = sender.send(Err(error)); }
        }
    }).map_err(|_| UNAVAILABLE)?;
    tokio::time::timeout(Duration::from_secs(6), receiver)
        .await
        .map_err(|_| "The native page-menu request timed out.".to_string())?
        .map_err(|_| UNAVAILABLE.to_string())?
}
