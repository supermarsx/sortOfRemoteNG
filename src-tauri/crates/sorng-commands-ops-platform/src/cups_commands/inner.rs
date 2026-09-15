// Tauri command handlers for the CUPS integration.
//
// Each function is annotated with `#[tauri::command]` and prefixed with
// `cups_`. They acquire the `CupsServiceState` lock, delegate to the
// `CupsService` methods, and map errors to `String` for the Tauri IPC
// boundary.

use super::service::CupsServiceState;
use super::types::*;
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════
// Session management
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn cups_connect(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    config: CupsConnectionConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.open_session(session_id, config)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_disconnect(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_list_sessions(
    state: tauri::State<'_, CupsServiceState>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

// ═══════════════════════════════════════════════════════════════════════
// Printers
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn cups_list_printers(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
) -> Result<Vec<PrinterInfo>, String> {
    let svc = state.lock().await;
    svc.list_printers(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_get_printer(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
) -> Result<PrinterInfo, String> {
    let svc = state.lock().await;
    svc.get_printer(&session_id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn cups_add_printer(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
    device_uri: String,
    ppd_name: Option<String>,
    location: Option<String>,
    description: Option<String>,
    shared: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.add_printer(
        &session_id,
        &name,
        &device_uri,
        ppd_name.as_deref(),
        location.as_deref(),
        description.as_deref(),
        shared,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_modify_printer(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
    changes: ModifyPrinterArgs,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.modify_printer(&session_id, &name, &changes)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_delete_printer(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_printer(&session_id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_pause_printer(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.pause_printer(&session_id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_resume_printer(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.resume_printer(&session_id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_set_default_printer(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_default_printer(&session_id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_get_default_printer(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
) -> Result<PrinterInfo, String> {
    let svc = state.lock().await;
    svc.get_default_printer(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_accept_jobs(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.accept_jobs(&session_id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_reject_jobs(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.reject_jobs(&session_id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_discover_printers(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
) -> Result<Vec<DiscoveredDevice>, String> {
    let svc = state.lock().await;
    svc.discover_printers(&session_id)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Jobs
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn cups_list_jobs(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer: Option<String>,
    which: WhichJobs,
    my_jobs: bool,
    limit: Option<u32>,
) -> Result<Vec<JobInfo>, String> {
    let svc = state.lock().await;
    svc.list_jobs(&session_id, printer.as_deref(), which, my_jobs, limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_get_job(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    job_id: u32,
) -> Result<JobInfo, String> {
    let svc = state.lock().await;
    svc.get_job(&session_id, job_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_submit_job(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer: String,
    document_data: Vec<u8>,
    filename: String,
    options: PrintOptions,
) -> Result<u32, String> {
    let svc = state.lock().await;
    svc.submit_job(&session_id, &printer, &document_data, &filename, &options)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_submit_job_uri(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer: String,
    document_uri: String,
    options: PrintOptions,
) -> Result<u32, String> {
    let svc = state.lock().await;
    svc.submit_job_uri(&session_id, &printer, &document_uri, &options)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_cancel_job(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer: String,
    job_id: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.cancel_job(&session_id, &printer, job_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_hold_job(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer: String,
    job_id: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.hold_job(&session_id, &printer, job_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_release_job(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer: String,
    job_id: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.release_job(&session_id, &printer, job_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_cancel_all_jobs(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.cancel_all_jobs(&session_id, &printer)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_move_job(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    job_id: u32,
    target_printer: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.move_job(&session_id, job_id, &target_printer)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Classes
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn cups_list_classes(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
) -> Result<Vec<PrinterClass>, String> {
    let svc = state.lock().await;
    svc.list_classes(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_get_class(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
) -> Result<PrinterClass, String> {
    let svc = state.lock().await;
    svc.get_class(&session_id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_create_class(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
    members: Vec<String>,
    description: Option<String>,
    location: Option<String>,
    shared: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    let member_refs: Vec<&str> = members.iter().map(|s| s.as_str()).collect();
    svc.create_class(
        &session_id,
        &name,
        &member_refs,
        description.as_deref(),
        location.as_deref(),
        shared,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_modify_class(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
    changes: ModifyClassArgs,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.modify_class(&session_id, &name, &changes)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_delete_class(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_class(&session_id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_add_class_member(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    class_name: String,
    printer_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.add_class_member(&session_id, &class_name, &printer_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_remove_class_member(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    class_name: String,
    printer_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_class_member(&session_id, &class_name, &printer_name)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// PPD
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn cups_list_ppds(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    filter: Option<PpdFilter>,
) -> Result<Vec<PpdInfo>, String> {
    let svc = state.lock().await;
    svc.list_ppds(&session_id, filter.as_ref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_search_ppds(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    query: String,
) -> Result<Vec<PpdInfo>, String> {
    let svc = state.lock().await;
    svc.search_ppds(&session_id, &query)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_get_ppd(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer_name: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_ppd(&session_id, &printer_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_get_ppd_options(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer_name: String,
) -> Result<PpdContent, String> {
    let svc = state.lock().await;
    svc.get_ppd_options(&session_id, &printer_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_upload_ppd(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer_name: String,
    ppd_content: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.upload_ppd(&session_id, &printer_name, &ppd_content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_assign_ppd(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer_name: String,
    ppd_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.assign_ppd(&session_id, &printer_name, &ppd_name)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Drivers
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn cups_list_drivers(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
) -> Result<Vec<DriverInfo>, String> {
    let svc = state.lock().await;
    svc.list_drivers(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_get_driver(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    ppd_name: String,
) -> Result<DriverInfo, String> {
    let svc = state.lock().await;
    svc.get_driver(&session_id, &ppd_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_recommend_driver(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    device_id: Option<String>,
    make_model: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<DriverInfo>, String> {
    let svc = state.lock().await;
    svc.recommend_driver(
        &session_id,
        device_id.as_deref(),
        make_model.as_deref(),
        limit,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_get_driver_options(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    ppd_name: String,
) -> Result<Vec<PpdOption>, String> {
    let svc = state.lock().await;
    svc.get_driver_options(&session_id, &ppd_name)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Admin
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn cups_get_server_settings(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
) -> Result<CupsServerInfo, String> {
    let svc = state.lock().await;
    svc.get_server_settings(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_update_server_settings(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    settings: HashMap<String, String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.update_server_settings(&session_id, &settings)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_get_error_log(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    log_type: LogType,
    max_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.get_error_log(&session_id, log_type, max_lines)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_test_page(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer_name: String,
) -> Result<u32, String> {
    let svc = state.lock().await;
    svc.test_page(&session_id, &printer_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_get_subscriptions_status(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
) -> Result<u32, String> {
    let svc = state.lock().await;
    svc.get_subscriptions_status(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_cleanup_jobs(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    max_age_secs: u64,
) -> Result<u32, String> {
    let svc = state.lock().await;
    svc.cleanup_jobs(&session_id, max_age_secs)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_restart(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.restart_cups(&session_id)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Subscriptions
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn cups_create_subscription(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    events: Vec<NotifyEvent>,
    printer_name: Option<String>,
    lease_secs: Option<u32>,
    recipient_uri: Option<String>,
) -> Result<u32, String> {
    let svc = state.lock().await;
    svc.create_subscription(
        &session_id,
        &events,
        printer_name.as_deref(),
        lease_secs,
        recipient_uri.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_cancel_subscription(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    subscription_id: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.cancel_subscription(&session_id, subscription_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_list_subscriptions(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    printer_name: Option<String>,
) -> Result<Vec<SubscriptionInfo>, String> {
    let svc = state.lock().await;
    svc.list_subscriptions(&session_id, printer_name.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_get_events(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    subscription_id: u32,
    since_sequence: u32,
) -> Result<Vec<NotificationEvent>, String> {
    let svc = state.lock().await;
    svc.get_events(&session_id, subscription_id, since_sequence)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cups_renew_subscription(
    state: tauri::State<'_, CupsServiceState>,
    session_id: String,
    subscription_id: u32,
    lease_secs: Option<u32>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.renew_subscription(&session_id, subscription_id, lease_secs)
        .await
        .map_err(|e| e.to_string())
}
