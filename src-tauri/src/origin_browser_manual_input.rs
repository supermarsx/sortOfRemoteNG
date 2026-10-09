//! Explicit shell-only typing. The database lease and selected native child,
//! not the caller's URL or text, decide where this transient operation may run.
use super::*;
use sorng_browser_host::cef_browser::{ManualInputCompletion, ManualInputGuard};
use sorng_browser_host::native_manual_input::{
    ManualInputAction, ManualInputRequest, ManualInputResponse,
};

// On Windows, keyboard focus moves from the shell HWND to the embedded CEF
// child. Tao's cached is_focused() can then be false for the still-active app.
// Authorize only this exact foreground top-level window, never another window
// in the same process. The selected native view and captured DOM field are
// independently checked before capture and every input tick.
#[cfg(target_os = "windows")]
fn owner_window_has_focus(window: &WebviewWindow) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, IsIconic, IsWindowVisible,
    };
    let Ok(handle) = window.hwnd() else {
        return false;
    };
    // Tauri may expose HWND from a different windows crate version. Rewrap
    // the same borrowed OS handle for this crate's API; ownership is unchanged.
    let handle = HWND(handle.0);
    if handle.0.is_null() {
        return false;
    }
    unsafe {
        GetForegroundWindow() == handle
            && IsWindowVisible(handle).as_bool()
            && !IsIconic(handle).as_bool()
    }
}

#[cfg(not(target_os = "windows"))]
fn owner_window_has_focus(window: &WebviewWindow) -> bool {
    window.is_focused().ok() == Some(true)
}

fn selected(view: &View, attempt: &Arc<Attempt>, target: Option<&str>) -> bool {
    Arc::ptr_eq(&view.attempt, attempt)
        && attempt.current()
        && shared().admission.ready()
        && view.visible
        && view.popups.selected.as_deref() == target
}
pub(crate) async fn operate(
    window: WebviewWindow,
    state: &EncryptionState,
    request: ManualInputRequest,
) -> Result<ManualInputResponse, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "System clock is unavailable.")?
        .as_millis() as u64;
    request.validate(now)?;
    if matches!(&request.action, ManualInputAction::Capture { .. })
        && !owner_window_has_focus(&window)
    {
        return Err("Focus this app and the website input before opening Credentials.".into());
    }
    let attempt = lookup(&window, &request.identity)?;
    attempt
        .lease
        .recheck(&window, state)
        .await
        .map_err(|_| STALE)?;
    let typing = matches!(&request.action, ManualInputAction::Type { .. });
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let pending = sender.clone();
    let weak = Arc::downgrade(&attempt);
    let target = request.view_id.clone();
    let owner_window = window.clone();
    let active: ManualInputGuard = Arc::new(move || {
        if !owner_window_has_focus(&owner_window) {
            return false;
        }
        if typing
            && pending
                .lock()
                .map_or(true, |s| s.as_ref().is_none_or(|s| s.is_closed()))
        {
            return false;
        }
        let Some(attempt) = weak.upgrade() else {
            return false;
        };
        UI.with(|slot| {
            slot.try_borrow()
                .ok()
                .and_then(|s| {
                    s.as_ref().and_then(|ui| {
                        ui.views
                            .get(&attempt.identity.attempt_id().to_string())
                            .map(|v| {
                                selected(v, &attempt, target.as_deref())
                                    && (!typing || !v.input_blocked)
                            })
                    })
                })
                .unwrap_or(false)
        })
    });
    window.run_on_main_thread(move || {
        if sender.lock().map_or(true,|s|s.as_ref().is_none_or(|s|s.is_closed())) {return;}
        let reply=sender.clone();
        let result=UI.with(|slot| {
            let slot=slot.borrow();
            let view=slot.as_ref().and_then(|ui|ui.views.get(&attempt.identity.attempt_id().to_string())).ok_or(STALE)?;
            let cancelling=matches!(&request.action,ManualInputAction::Cancel{..});
            // Cancellation may target a now-hidden child, but never a different owner.
            if !Arc::ptr_eq(&view.attempt,&attempt) || !attempt.current()
                || (!cancelling && (!selected(view,&attempt,request.view_id.as_deref()) || view.input_blocked)) {return Err(STALE.to_string());}
            let callback:ManualInputCompletion=Box::new(move |result| {
                if let Some(sender)=reply.lock().ok().and_then(|mut s|s.take()) {let _=sender.send(result.map_err(str::to_string));}
            });
            let perform=|host:&CefBrowserHost<'_>|host.manual_input(host.identity(),&request.action,active,callback);
            let result=if let Some(target)=request.view_id.as_deref() {
                view.host.with_popup(&attempt.identity,target,perform).map_err(|_|"The selected child website is unavailable.".to_string())?
            } else {perform(&view.host)};
            result.map_err(|_|"Manual typing is unavailable in this browser attempt. Focus an empty main-frame HTTPS input and capture it again.".to_string())
        });
        if let Err(error)=result {if let Some(sender)=sender.lock().ok().and_then(|mut s|s.take()) {let _=sender.send(Err(error));}}
    }).map_err(|_|UNAVAILABLE)?;
    tokio::time::timeout(Duration::from_secs(32), receiver)
        .await
        .map_err(|_| {
            "Manual typing timed out. Capture the field again; no automatic retry was performed."
        })?
        .map_err(|_| UNAVAILABLE.to_string())?
}
