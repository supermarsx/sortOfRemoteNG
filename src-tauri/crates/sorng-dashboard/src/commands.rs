// Tauri command handlers for the dashboard engine.
//
// Each command follows the `dash_*` naming convention and delegates
// to [`DashboardService`].

use tauri::State;

use super::service::DashboardServiceState;
use super::types::*;

/// Helper to map `DashboardError` → `String` for Tauri command results.
fn err_str(e: super::error::DashboardError) -> String {
    e.to_string()
}

// ─── State & Summaries ──────────────────────────────────────────────

#[tauri::command]
pub async fn dash_get_state(
    state: State<'_, DashboardServiceState>,
) -> Result<DashboardState, String> {
    let svc = state.lock().await;
    Ok(svc.get_state().await)
}

#[tauri::command]
pub async fn dash_get_health_summary(
    state: State<'_, DashboardServiceState>,
) -> Result<HealthSummary, String> {
    let svc = state.lock().await;
    Ok(svc.get_health_summary())
}

#[tauri::command]
pub async fn dash_get_quick_stats(
    state: State<'_, DashboardServiceState>,
) -> Result<QuickStats, String> {
    let svc = state.lock().await;
    Ok(svc.get_quick_stats())
}

// ─── Alerts ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dash_get_alerts(
    state: State<'_, DashboardServiceState>,
) -> Result<Vec<DashboardAlert>, String> {
    let svc = state.lock().await;
    Ok(svc.get_alerts())
}

#[tauri::command]
pub async fn dash_acknowledge_alert(
    state: State<'_, DashboardServiceState>,
    alert_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.acknowledge_alert(&alert_id).map_err(err_str)
}

// ─── Connection Health ──────────────────────────────────────────────

#[tauri::command]
pub async fn dash_get_connection_health(
    state: State<'_, DashboardServiceState>,
    connection_id: String,
) -> Result<ConnectionHealthEntry, String> {
    let svc = state.lock().await;
    svc.get_connection_health(&connection_id).map_err(err_str)
}

#[tauri::command]
pub async fn dash_get_all_health(
    state: State<'_, DashboardServiceState>,
) -> Result<Vec<ConnectionHealthEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.get_all_health())
}

#[tauri::command]
pub async fn dash_get_unhealthy(
    state: State<'_, DashboardServiceState>,
) -> Result<Vec<ConnectionHealthEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.get_unhealthy())
}

// ─── Sparkline ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn dash_get_sparkline(
    state: State<'_, DashboardServiceState>,
    connection_id: String,
    width: usize,
) -> Result<Vec<f64>, String> {
    let svc = state.lock().await;
    svc.get_sparkline(&connection_id, width).map_err(err_str)
}

// ─── Widget Data ────────────────────────────────────────────────────

#[tauri::command]
pub async fn dash_get_widget_data(
    state: State<'_, DashboardServiceState>,
    widget_type: WidgetType,
) -> Result<WidgetData, String> {
    let svc = state.lock().await;
    Ok(svc.get_widget_data(&widget_type))
}

// ─── Monitoring Lifecycle ───────────────────────────────────────────

#[tauri::command]
pub async fn dash_start_monitoring(state: State<'_, DashboardServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.start_monitoring().await.map_err(err_str)
}

#[tauri::command]
pub async fn dash_stop_monitoring(state: State<'_, DashboardServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.stop_monitoring().await.map_err(err_str)
}

#[tauri::command]
pub async fn dash_force_refresh(state: State<'_, DashboardServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.force_refresh();
    Ok(())
}

// ─── Configuration ──────────────────────────────────────────────────

#[tauri::command]
pub async fn dash_get_config(
    state: State<'_, DashboardServiceState>,
) -> Result<DashboardConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

#[tauri::command]
pub async fn dash_update_config(
    state: State<'_, DashboardServiceState>,
    config: DashboardConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_config(config);
    Ok(())
}

// ─── Layout ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dash_get_layout(
    state: State<'_, DashboardServiceState>,
) -> Result<DashboardLayout, String> {
    let svc = state.lock().await;
    Ok(svc.get_layout())
}

#[tauri::command]
pub async fn dash_update_layout(
    state: State<'_, DashboardServiceState>,
    layout: DashboardLayout,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_layout(layout);
    Ok(())
}

// ─── Heatmap & Helpers ──────────────────────────────────────────────

#[tauri::command]
pub async fn dash_get_heatmap(
    state: State<'_, DashboardServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    Ok(svc.get_heatmap())
}

#[tauri::command]
pub async fn dash_get_recent(
    state: State<'_, DashboardServiceState>,
    count: usize,
) -> Result<Vec<ConnectionHealthEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.get_recent(count))
}

#[tauri::command]
pub async fn dash_get_top_latency(
    state: State<'_, DashboardServiceState>,
    count: usize,
) -> Result<Vec<ConnectionHealthEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.get_top_latency(count))
}

#[tauri::command]
pub async fn dash_check_connection(
    state: State<'_, DashboardServiceState>,
    id: String,
    hostname: String,
    port: u16,
    protocol: String,
) -> Result<ConnectionHealthEntry, String> {
    let mut svc = state.lock().await;
    Ok(svc.check_connection(&id, &hostname, port, &protocol).await)
}
