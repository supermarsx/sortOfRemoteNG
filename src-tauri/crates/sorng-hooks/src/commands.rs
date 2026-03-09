//! Tauri command handlers for the hook engine.
//!
//! Each command follows the `hook_*` naming convention and delegates
//! to [`HookService`].

use tauri::State;

use crate::service::HookServiceState;
use crate::types::*;

/// Helper to map HookError → String for Tauri command results.
fn err_str(e: crate::error::HookError) -> String {
    e.to_string()
}

// ─── Subscription Commands ──────────────────────────────────────────

#[tauri::command]
pub async fn hook_subscribe(
    state: State<'_, HookServiceState>,
    subscription: HookSubscription,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.subscribe(subscription).map_err(err_str)
}

#[tauri::command]
pub async fn hook_unsubscribe(
    state: State<'_, HookServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.unsubscribe(&id).map_err(err_str)
}

#[tauri::command]
pub async fn hook_list_subscriptions(
    state: State<'_, HookServiceState>,
) -> Result<Vec<HookSubscription>, String> {
    let svc = state.lock().await;
    Ok(svc.list_subscriptions())
}

#[tauri::command]
pub async fn hook_get_subscription(
    state: State<'_, HookServiceState>,
    id: String,
) -> Result<HookSubscription, String> {
    let svc = state.lock().await;
    svc.get_subscription(&id).map_err(err_str)
}

#[tauri::command]
pub async fn hook_enable_subscription(
    state: State<'_, HookServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.enable_subscription(&id).map_err(err_str)
}

#[tauri::command]
pub async fn hook_disable_subscription(
    state: State<'_, HookServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disable_subscription(&id).map_err(err_str)
}

// ─── Event Dispatch Commands ────────────────────────────────────────

#[tauri::command]
pub async fn hook_dispatch_event(
    state: State<'_, HookServiceState>,
    event: HookEventData,
) -> Result<Vec<HookExecutionResult>, String> {
    let mut svc = state.lock().await;
    Ok(svc.dispatch_event(event))
}

#[tauri::command]
pub async fn hook_get_recent_events(
    state: State<'_, HookServiceState>,
    count: usize,
) -> Result<Vec<HookEventData>, String> {
    let svc = state.lock().await;
    Ok(svc.get_recent_events(count))
}

#[tauri::command]
pub async fn hook_get_events_by_type(
    state: State<'_, HookServiceState>,
    event_type: HookEvent,
) -> Result<Vec<HookEventData>, String> {
    let svc = state.lock().await;
    Ok(svc.get_events_by_type(&event_type))
}

#[tauri::command]
pub async fn hook_get_stats(state: State<'_, HookServiceState>) -> Result<HookStats, String> {
    let svc = state.lock().await;
    Ok(svc.get_stats())
}

#[tauri::command]
pub async fn hook_clear_events(state: State<'_, HookServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.clear_events();
    Ok(())
}

// ─── Pipeline Commands ──────────────────────────────────────────────

#[tauri::command]
pub async fn hook_create_pipeline(
    state: State<'_, HookServiceState>,
    pipeline: HookPipeline,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    Ok(svc.create_pipeline(pipeline))
}

#[tauri::command]
pub async fn hook_delete_pipeline(
    state: State<'_, HookServiceState>,
    id: String,
) -> Result<HookPipeline, String> {
    let mut svc = state.lock().await;
    svc.delete_pipeline(&id).map_err(err_str)
}

#[tauri::command]
pub async fn hook_list_pipelines(
    state: State<'_, HookServiceState>,
) -> Result<Vec<HookPipeline>, String> {
    let svc = state.lock().await;
    Ok(svc.list_pipelines())
}

#[tauri::command]
pub async fn hook_execute_pipeline(
    state: State<'_, HookServiceState>,
    pipeline_id: String,
    event: HookEventData,
) -> Result<Vec<crate::pipeline::PipelineStepResult>, String> {
    let svc = state.lock().await;
    svc.execute_pipeline(&pipeline_id, &event).map_err(err_str)
}

// ─── Config Commands ────────────────────────────────────────────────

#[tauri::command]
pub async fn hook_get_config(state: State<'_, HookServiceState>) -> Result<HooksConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

#[tauri::command]
pub async fn hook_update_config(
    state: State<'_, HookServiceState>,
    config: HooksConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_config(config);
    Ok(())
}
