//! Palette-only live updates across the attempt's owned native views.
use super::*;
use crate::origin_browser_appearance_request::{AppearanceRequest, AppearanceResponse};
use sorng_browser_host::{
    cef_browser::{AppearanceCompletion, AppearanceGuard},
    native_appearance::AppearanceStatus,
};

pub(crate) async fn apply(
    window: WebviewWindow,
    state: &EncryptionState,
    request: AppearanceRequest,
) -> Result<AppearanceResponse, String> {
    request.identity.validate().map_err(|_| STALE)?;
    let attempt = lookup(&window, &request.identity)?;
    attempt
        .lease
        .recheck(&window, state)
        .await
        .map_err(|_| STALE)?;
    let config = attempt
        .preferences
        .appearance
        .with_palette(request.app_palette.as_ref())
        .map_err(str::to_owned)?;
    let following_app_theme = config.theme.follow_app_theme
        && attempt.preferences.capabilities.website_extensions_enabled;
    let enabled = config.enabled;
    let json = serde_json::to_string(&config).map_err(|_| UNAVAILABLE)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            if sender.is_closed() {
                return;
            }
            let result = UI.with(|slot| {
                let slot = slot.borrow();
                let ui = slot.as_ref().ok_or(UNAVAILABLE)?;
                let view = ui
                    .views
                    .get(&attempt.identity.attempt_id().to_string())
                    .ok_or(STALE)?;
                if !Arc::ptr_eq(&view.attempt, &attempt)
                    || !attempt.current()
                    || !shared().admission.ready()
                {
                    return Err(STALE.to_string());
                }
                let children = view
                    .host
                    .popup_inventory(&attempt.identity)
                    .map_err(|_| STALE)?;
                let children: Vec<_> = children
                    .views
                    .into_iter()
                    .filter(|child| {
                        child.phase == sorng_browser_host::native_popups::PopupPhase::Adopted
                    })
                    .collect();
                if children.len() > 64 {
                    return Err(UNAVAILABLE.into());
                }
                // Refresh only palette data on the already-authorized immutable
                // config. New popup hooks inherit it; saved opt-outs cannot change.
                attempt.login.set_appearance_configuration(config)?;
                let weak = Arc::downgrade(&attempt);
                let guard: AppearanceGuard = Arc::new(move || {
                    weak.upgrade().is_some_and(|a| a.current()) && shared().admission.ready()
                });
                let apply = |host: &CefBrowserHost<'_>| {
                    let (sender, receiver) = tokio::sync::oneshot::channel();
                    let callback: AppearanceCompletion = Box::new(move |result| {
                        let _ = sender.send(result);
                    });
                    host.apply_appearance(&attempt.identity, &json, guard.clone(), callback)
                        .map_err(|_| UNAVAILABLE.to_string())?;
                    Ok::<_, String>(receiver)
                };
                let mut pending = vec![apply(&view.host)?];
                for child in children {
                    pending.push(
                        view.host
                            .with_popup(&attempt.identity, &child.view_id, apply)
                            .map_err(|_| STALE)??,
                    );
                }
                Ok(pending)
            });
            let _ = sender.send(result);
        })
        .map_err(|_| UNAVAILABLE)?;
    let pending = tokio::time::timeout(Duration::from_secs(6), receiver)
        .await
        .map_err(|_| "Native appearance acknowledgement timed out.")?
        .map_err(|_| UNAVAILABLE)??;
    let result = tokio::time::timeout(Duration::from_secs(6), async move {
        let mut fallback = false;
        for response in pending {
            let status = response
                .await
                .map_err(|_| UNAVAILABLE)?
                .map_err(|_| "Native appearance installation was not acknowledged.")?;
            if enabled == (status == AppearanceStatus::Off) {
                return Err(UNAVAILABLE);
            }
            fallback |= status == AppearanceStatus::Fallback;
        }
        Ok(if !enabled {
            AppearanceStatus::Off
        } else if fallback {
            AppearanceStatus::Fallback
        } else {
            AppearanceStatus::Applied
        })
    })
    .await
    .map_err(|_| "Native appearance acknowledgement timed out.")?
    .map_err(str::to_owned)?;
    Ok(AppearanceResponse::acknowledged(
        result,
        following_app_theme,
    ))
}
