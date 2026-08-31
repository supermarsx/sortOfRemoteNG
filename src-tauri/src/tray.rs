use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub const TRAY_ID: &str = "sortofremoteng-main-tray";
pub const TRAY_QUIT_REQUESTED_EVENT: &str = "tray-quit-requested";

const OPEN_MENU_ID: &str = "sortofremoteng-tray-open";
const QUIT_MENU_ID: &str = "sortofremoteng-tray-quit";

// Settings updates can arrive from more than one webview. Serialize creation
// and visibility changes so two concurrent `show` requests cannot race to
// register duplicate tray icons or event handlers.
static TRAY_UPDATE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayMenuAction {
    Open,
    Quit,
}

fn tray_menu_action(id: &str) -> Option<TrayMenuAction> {
    match id {
        OPEN_MENU_ID => Some(TrayMenuAction::Open),
        QUIT_MENU_ID => Some(TrayMenuAction::Quit),
        _ => None,
    }
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("main window is unavailable".to_string());
    };

    window
        .show()
        .map_err(|error| format!("failed to show main window: {error}"))?;
    // A hidden window can still retain its minimized state. Best effort here:
    // showing and focusing remain useful even on a platform that rejects the
    // unminimize request.
    if let Err(error) = window.unminimize() {
        log::warn!("Failed to unminimize main window from tray: {error}");
    }
    window
        .set_focus()
        .map_err(|error| format!("failed to focus main window: {error}"))
}

fn request_frontend_quit(app: &AppHandle) {
    if let Err(error) = show_main_window(app) {
        log::warn!("Failed to restore the main window for tray Quit: {error}");
    }
    // The frontend owns connection persistence and active-session warnings.
    // Asking it to close, rather than calling `AppHandle::exit`, preserves that
    // established lifecycle and its clean-exit bookkeeping.
    if let Err(error) = app.emit_to("main", TRAY_QUIT_REQUESTED_EVENT, ()) {
        log::error!("Failed to deliver tray Quit request: {error}");
    }
}

fn handle_menu_action(app: &AppHandle, action: TrayMenuAction) {
    match action {
        TrayMenuAction::Open => {
            if let Err(error) = show_main_window(app) {
                log::warn!("Failed to restore the main window from tray: {error}");
            }
        }
        TrayMenuAction::Quit => request_frontend_quit(app),
    }
}

fn create_tray(app: &AppHandle) -> Result<(), String> {
    let open_item = MenuItem::with_id(app, OPEN_MENU_ID, "Open sortOfRemoteNG", true, None::<&str>)
        .map_err(|error| format!("failed to create tray Open item: {error}"))?;
    let separator = PredefinedMenuItem::separator(app)
        .map_err(|error| format!("failed to create tray separator: {error}"))?;
    let quit_item = MenuItem::with_id(app, QUIT_MENU_ID, "Quit", true, None::<&str>)
        .map_err(|error| format!("failed to create tray Quit item: {error}"))?;
    let menu = Menu::with_items(app, &[&open_item, &separator, &quit_item])
        .map_err(|error| format!("failed to create tray menu: {error}"))?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "the application has no default window icon".to_string())?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("sortOfRemoteNG")
        // Windows and macOS restore the app directly on a left click. Linux
        // does not emit tray click events, so the menu's Open item is the
        // portable restoration path there.
        .show_menu_on_left_click(false)
        .menu(&menu)
        .on_menu_event(|app, event| {
            if let Some(action) = tray_menu_action(event.id().as_ref()) {
                handle_menu_action(app, action);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                handle_menu_action(tray.app_handle(), TrayMenuAction::Open);
            }
        })
        .build(app)
        .map_err(|error| format!("failed to create system tray icon: {error}"))?;

    Ok(())
}

/// Apply the persisted tray visibility setting immediately.
///
/// The tray object is retained while hidden so toggling the setting repeatedly
/// does not accumulate Tauri global menu listeners. If the main window is
/// currently hidden, disabling the tray restores it first so the application
/// can never become unreachable.
#[tauri::command]
pub fn set_tray_icon_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let _guard = TRAY_UPDATE_LOCK
        .lock()
        .map_err(|_| "system tray update lock is poisoned".to_string())?;

    if visible {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            return tray
                .set_visible(true)
                .map_err(|error| format!("failed to show system tray icon: {error}"));
        }
        return create_tray(&app);
    }

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Some(window) = app.get_webview_window("main") {
            match window.is_visible() {
                Ok(false) => show_main_window(&app)?,
                Ok(true) => {}
                Err(error) => {
                    return Err(format!(
                        "failed to verify main-window visibility before hiding tray: {error}"
                    ));
                }
            }
        }
        tray.set_visible(false)
            .map_err(|error| format!("failed to hide system tray icon: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_ids_map_only_to_supported_actions() {
        assert_eq!(tray_menu_action(OPEN_MENU_ID), Some(TrayMenuAction::Open));
        assert_eq!(tray_menu_action(QUIT_MENU_ID), Some(TrayMenuAction::Quit));
        assert_eq!(tray_menu_action("other-menu-item"), None);
    }
}
