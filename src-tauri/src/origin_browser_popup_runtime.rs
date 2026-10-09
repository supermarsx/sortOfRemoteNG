//! Transient children of an existing Attempt. Never creates authority, sessions,
//! contexts or credentials. Every request is owner-window/source-lease fenced.
use super::*;
use crate::origin_browser_commands::{PopupAction, PopupRequest};
use serde_json::{json, Value};
use sorng_browser_host::native_popups::{PopupDisposition, PopupPhase};

pub(super) const EVENT: &str = "origin-browser-popups";
#[derive(Default)]
pub(super) struct Selection {
    pub selected: Option<String>,
    revision: u64,
    published: Option<u64>,
    occlusions: Vec<OriginBrowserBounds>,
}

fn with_target<R>(
    view: &View,
    target: Option<&str>,
    action: impl FnOnce(&CefBrowserHost<'_>) -> Result<R, String>,
) -> Result<R, String> {
    if target != view.popups.selected.as_deref() {
        return Err("The requested website view is no longer selected.".into());
    }
    match target {
        Some(id) => view
            .host
            .with_popup(&view.attempt.identity, id, action)
            .map_err(|_| STALE.to_owned())?,
        None => action(&view.host),
    }
}

pub(super) fn hide_selected(view: &View) {
    let _ = with_target(view, view.popups.selected.as_deref(), |host| {
        host.hide(&view.attempt.identity)
            .map_err(|_| UNAVAILABLE.into())
    });
}

fn apply_presentation(
    view: &mut View,
    bounds: Option<OriginBrowserBounds>,
    visible: bool,
    occlusions: &[OriginBrowserBounds],
    input_blocked: bool,
) -> Result<(), String> {
    let id = &view.attempt.identity;
    let scale = view.window.scale_factor().map_err(|_| UNAVAILABLE)?;
    let resize = bounds.filter(|bounds| view.presentation_bounds != Some((*bounds, scale)));
    let was_visible = view.visible;
    let result = with_target(view, view.popups.selected.as_deref(), |host| {
        if let Some(bounds) = resize {
            host.resize(id, bounds.to_native().map_err(|e| e.to_string())?, scale)
                .map_err(|_| UNAVAILABLE)?;
        }
        if visible {
            let bounds = bounds.ok_or(UNAVAILABLE)?;
            host.occlude(id, bounds, occlusions, scale, input_blocked)
                .map_err(|_| UNAVAILABLE)?;
            if !was_visible {
                host.show(id).map_err(|_| UNAVAILABLE)?;
            }
            // show enables input; restore the trusted overlay's input fence.
            host.occlude(id, bounds, occlusions, scale, input_blocked)
                .map_err(|_| UNAVAILABLE)?;
        } else {
            host.hide(id).map_err(|_| UNAVAILABLE)?;
        }
        Ok(())
    });
    if result.is_err() {
        hide_selected(view);
        view.visible = false;
        return result;
    }
    if let Some(bounds) = bounds {
        view.presentation_bounds = Some((bounds, scale));
    }
    view.visible = visible;
    view.input_blocked = input_blocked;
    view.popups.occlusions = occlusions.to_vec();
    Ok(())
}

pub(super) fn present(
    view: &mut View,
    revision: u64,
    bounds: Option<OriginBrowserBounds>,
    visible: bool,
    occlusions: &[OriginBrowserBounds],
    input_blocked: bool,
) -> Result<(), String> {
    if revision <= view.presentation {
        return Ok(());
    }
    view.presentation = revision;
    apply_presentation(view, bounds, visible, occlusions, input_blocked)
}

fn select(view: &mut View, target: Option<String>) -> Result<(), String> {
    if target == view.popups.selected {
        return Ok(());
    }
    if let Some(id) = &target {
        view.host
            .with_popup(&view.attempt.identity, id, |_| ())
            .map_err(|_| STALE)?;
    }
    let bounds = view.presentation_bounds.map(|(bounds, _)| bounds);
    let visible = view.visible;
    let blocked = view.input_blocked;
    let occlusions = view.popups.occlusions.clone();
    hide_selected(view);
    view.popups.selected = target;
    view.visible = false;
    view.presentation_bounds = None; // force the newly selected actual view's geometry
    apply_presentation(
        view,
        bounds,
        visible && bounds.is_some(),
        &occlusions,
        blocked,
    )
}

fn inventory(view: &View) -> Result<Value, String> {
    let inventory = view
        .host
        .popup_inventory(&view.attempt.identity)
        .map_err(|_| STALE)?;
    let closed = inventory.source_closed || !view.attempt.current();
    let mut views = Vec::new();
    if !closed {
        for child in inventory.views {
            let phase = match child.phase {
                PopupPhase::Pending => continue,
                PopupPhase::Available => "available",
                PopupPhase::Adopted => "adopted",
                PopupPhase::Closing => "closing",
            };
            let snapshot = child.state.as_ref().and_then(|state| {
                OriginBrowserSnapshot::new(
                    &view.attempt.identity,
                    inventory.sequence,
                    OriginBrowserPhase::Attached,
                    OriginBrowserPageState {
                        url: &child.display.url,
                        title: &child.display.title,
                        loading: state.loading,
                        can_go_back: state.can_go_back,
                        can_go_forward: state.can_go_forward,
                    },
                )
                .ok()
            });
            views.push(json!({"viewId":child.view_id,"phase":phase,
                "disposition": if child.disposition == PopupDisposition::Background { "background" } else { "foreground" },
                "title":child.display.title,"snapshot":snapshot}));
        }
    }
    Ok(
        json!({"sourceIdentity":OriginBrowserIdentity::from_native(&view.attempt.identity),
        "sequence":inventory.sequence,"sourceClosed":closed,"views":views}),
    )
}

pub(super) fn poll(view: &mut View) {
    let Ok(payload) = inventory(view) else {
        return;
    };
    if let Some(selected) = &view.popups.selected {
        let present = payload["views"].as_array().is_some_and(|rows| {
            rows.iter()
                .any(|row| row["viewId"].as_str() == Some(selected) && row["phase"] == "adopted")
        });
        if !present && view.attempt.current() {
            let _ = select(view, None);
        }
    }
    let sequence = payload["sequence"].as_u64().unwrap_or(0);
    if view.popups.published == Some(sequence) {
        return;
    }
    view.popups.published = Some(sequence);
    // Window-targeted only. No global event or retained page data after revoke.
    let _ = view.window.emit_to(
        tauri::EventTarget::webview_window(view.window.label()),
        EVENT,
        payload,
    );
}

fn control(view: &View, target: Option<&str>, action: OriginBrowserAction) -> Result<(), String> {
    if !view.visible || view.input_blocked {
        return Err("The website view is not interactive.".into());
    }
    let id = &view.attempt.identity;
    with_target(view, target, |host| {
        let result = match action {
            OriginBrowserAction::Back {} => host.back(id),
            OriginBrowserAction::Forward {} => host.forward(id),
            OriginBrowserAction::Reload {} => host.reload(id),
            OriginBrowserAction::Stop {} => host.stop(id),
            OriginBrowserAction::Focus {
                presentation_revision,
            } if presentation_revision == view.presentation => host.focus(id),
            OriginBrowserAction::Devtools {
                presentation_revision,
            } if presentation_revision == view.presentation => host.open_devtools(id),
            OriginBrowserAction::Zoom {
                percent,
                presentation_revision,
            } if presentation_revision == view.presentation => host.zoom(id, percent),
            OriginBrowserAction::Find {
                request_id,
                text,
                forward,
                match_case,
                find_next,
                presentation_revision,
            } if presentation_revision == view.presentation => {
                find::start(view, host, target, request_id.as_deref(), &text, forward, match_case, find_next)
            }
            OriginBrowserAction::StopFind {
                clear_selection,
                presentation_revision,
            } if presentation_revision == view.presentation => host.stop_find(id, clear_selection),
            _ => return Err("The website presentation changed.".into()),
        };
        result.map_err(|_| "The selected website action is unavailable.".into())
    })
}

pub(crate) async fn operate(
    window: WebviewWindow,
    state: &EncryptionState,
    request: PopupRequest,
) -> Result<Value, String> {
    let attempt = lookup(&window, &request.source_identity)?;
    let closing = matches!(request.action, PopupAction::Close { .. });
    if matches!(
        &request.action,
        PopupAction::Navigate { .. }
            | PopupAction::OpenTab { .. }
            | PopupAction::Adopt { .. }
            | PopupAction::Control {
                action: OriginBrowserAction::Back {}
                    | OriginBrowserAction::Forward {}
                    | OriginBrowserAction::Reload {}
                    | OriginBrowserAction::Devtools { .. },
                ..
            }
    ) {
        attempt
            .lease
            .recheck(&window, state)
            .await
            .map_err(|_| STALE)?;
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            if sender.is_closed() {
                return;
            }
            let result = UI.with(|slot| {
                let mut slot = slot.borrow_mut();
                let ui = slot.as_mut().ok_or(UNAVAILABLE)?;
                let view = ui
                    .views
                    .get_mut(&attempt.identity.attempt_id().to_string())
                    .ok_or(STALE)?;
                if !Arc::ptr_eq(&view.attempt, &attempt)
                    || (!closing && (!shared().admission.ready() || !attempt.current()))
                {
                    return Err(STALE.into());
                }
                match request.action {
                    PopupAction::List {} => (),
                    PopupAction::Adopt { view_id } => view
                        .host
                        .adopt_popup(&attempt.identity, &view_id)
                        .map_err(|_| STALE)?,
                    PopupAction::Close { view_id } => {
                        if view.popups.selected.as_ref() == Some(&view_id) && attempt.current() {
                            select(view, None)?;
                        }
                        view.host
                            .close_popup(&attempt.identity, &view_id)
                            .map_err(|_| STALE)?;
                    }
                    PopupAction::Select { view_id, revision } => {
                        if revision > view.popups.revision {
                            select(view, view_id)?;
                            view.popups.revision = revision;
                        }
                    }
                    PopupAction::Navigate { view_id, url } => {
                        if !view.visible || view.input_blocked {
                            return Err("The website view is not interactive.".into());
                        }
                        with_target(view, view_id.as_deref(), |host| {
                            host.navigate(&attempt.identity, &url).map_err(|_| {
                                "The selected website navigation is unavailable.".into()
                            })
                        })?;
                    }
                    PopupAction::OpenTab {
                        view_id,
                        url,
                        presentation_revision,
                    } => {
                        if !view.visible || view.input_blocked {
                            return Err("The website view is not interactive.".into());
                        }
                        if presentation_revision == 0 || presentation_revision != view.presentation {
                            return Err("The website presentation changed.".into());
                        }
                        with_target(view, view_id.as_deref(), |host| {
                            host.open_tab(&attempt.identity, url.as_deref())
                                .map_err(|_| {
                                    "Opening a native tab is unavailable for this view or address."
                                        .into()
                                })
                        })?;
                    }
                    PopupAction::Control { view_id, action } => {
                        control(view, view_id.as_deref(), action)?
                    }
                    PopupAction::Downloads { view_id } => {
                        return with_target(view, view_id.as_deref(), |_| {
                            view.host
                                .downloads_across_views(&attempt.identity)
                                .map_err(|_| {
                                    "Downloads are unavailable for the selected view.".into()
                                })
                                .and_then(|rows| {
                                    serde_json::to_value(rows).map_err(|_| UNAVAILABLE.into())
                                })
                        })
                    }
                    PopupAction::DownloadControl { view_id, request } => {
                        with_target(view, view_id.as_deref(), |_| {
                            view.host
                                .control_download_across_views(&request)
                                .map_err(|_| "The selected download action is unavailable.".into())
                        })?;
                    }
                }
                inventory(view)
            });
            let _ = sender.send(result);
        })
        .map_err(|_| UNAVAILABLE)?;
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| UNAVAILABLE)?
        .map_err(|_| UNAVAILABLE)?
}
