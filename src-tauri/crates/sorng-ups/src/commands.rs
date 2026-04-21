// ── sorng-ups/src/commands.rs ────────────────────────────────────────────────
// Tauri command wrappers for UPS (NUT) management.

use tauri::State;

use super::service::UpsServiceState;
use super::types::*;

type CmdResult<T> = Result<T, String>;
fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection lifecycle ─────────────────────────────────────

#[tauri::command]
pub async fn ups_connect(
    state: State<'_, UpsServiceState>,
    id: String,
    config: UpsConnectionConfig,
) -> CmdResult<String> {
    state.lock().await.connect(id, config).map_err(map_err)
}

#[tauri::command]
pub async fn ups_disconnect(state: State<'_, UpsServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn ups_list_connections(state: State<'_, UpsServiceState>) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

// ── Devices ──────────────────────────────────────────────────

#[tauri::command]
pub async fn ups_list_devices(
    state: State<'_, UpsServiceState>,
    id: String,
) -> CmdResult<Vec<UpsDevice>> {
    state.lock().await.list_devices(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_device(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<UpsDevice> {
    state
        .lock()
        .await
        .get_device(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_list_device_variables(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<Vec<UpsVariable>> {
    state
        .lock()
        .await
        .list_device_variables(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_device_variable(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
    var: String,
) -> CmdResult<UpsVariable> {
    state
        .lock()
        .await
        .get_device_variable(&id, &name, &var)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_set_device_variable(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
    var: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_device_variable(&id, &name, &var, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_list_device_commands(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<Vec<UpsCommand>> {
    state
        .lock()
        .await
        .list_device_commands(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_run_device_command(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
    cmd: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .run_device_command(&id, &name, &cmd)
        .await
        .map_err(map_err)
}

// ── Status ───────────────────────────────────────────────────

#[tauri::command]
pub async fn ups_get_status(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<UpsStatus> {
    state
        .lock()
        .await
        .get_status(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_is_on_battery(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .is_on_battery(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_is_online(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .is_online(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_load(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<f64> {
    state
        .lock()
        .await
        .get_load(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_input_voltage(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<f64> {
    state
        .lock()
        .await
        .get_input_voltage(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_output_voltage(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<f64> {
    state
        .lock()
        .await
        .get_output_voltage(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_temperature(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<f64> {
    state
        .lock()
        .await
        .get_temperature(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_list_all_status(
    state: State<'_, UpsServiceState>,
    id: String,
) -> CmdResult<Vec<UpsStatus>> {
    state
        .lock()
        .await
        .list_all_status(&id)
        .await
        .map_err(map_err)
}

// ── Battery ──────────────────────────────────────────────────

#[tauri::command]
pub async fn ups_get_battery_info(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<BatteryInfo> {
    state
        .lock()
        .await
        .get_battery_info(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_battery_charge(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<f64> {
    state
        .lock()
        .await
        .get_battery_charge(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_battery_runtime(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<u64> {
    state
        .lock()
        .await
        .get_battery_runtime(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_battery_voltage(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<f64> {
    state
        .lock()
        .await
        .get_battery_voltage(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_is_battery_low(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .is_battery_low(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_battery_needs_replacement(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .battery_needs_replacement(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_battery_health(
    state: State<'_, UpsServiceState>,
    id: String,
    name: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_battery_health(&id, &name)
        .await
        .map_err(map_err)
}

// ── Events ───────────────────────────────────────────────────

#[tauri::command]
pub async fn ups_list_events(
    state: State<'_, UpsServiceState>,
    id: String,
    device: Option<String>,
    limit: Option<usize>,
) -> CmdResult<Vec<UpsEvent>> {
    state
        .lock()
        .await
        .list_events(&id, device.as_deref(), limit)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_recent_events(
    state: State<'_, UpsServiceState>,
    id: String,
    device: Option<String>,
    hours: u64,
) -> CmdResult<Vec<UpsEvent>> {
    state
        .lock()
        .await
        .get_recent_events(&id, device.as_deref(), hours)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_clear_event_log(
    state: State<'_, UpsServiceState>,
    id: String,
    device: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .clear_event_log(&id, device.as_deref())
        .await
        .map_err(map_err)
}

// ── Outlets ──────────────────────────────────────────────────

#[tauri::command]
pub async fn ups_list_outlets(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
) -> CmdResult<Vec<UpsOutlet>> {
    state
        .lock()
        .await
        .list_outlets(&id, &device)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_outlet(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
    outlet_id: String,
) -> CmdResult<UpsOutlet> {
    state
        .lock()
        .await
        .get_outlet(&id, &device, &outlet_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_switch_outlet_on(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
    outlet_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .switch_outlet_on(&id, &device, &outlet_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_switch_outlet_off(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
    outlet_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .switch_outlet_off(&id, &device, &outlet_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_outlet_delay(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
    outlet_id: String,
) -> CmdResult<(u64, u64)> {
    state
        .lock()
        .await
        .get_outlet_delay(&id, &device, &outlet_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_set_outlet_delay(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
    outlet_id: String,
    shutdown_delay: u64,
    start_delay: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_outlet_delay(&id, &device, &outlet_id, shutdown_delay, start_delay)
        .await
        .map_err(map_err)
}

// ── Scheduling ───────────────────────────────────────────────

#[tauri::command]
pub async fn ups_list_schedules(
    state: State<'_, UpsServiceState>,
    id: String,
) -> CmdResult<Vec<UpsSchedule>> {
    state
        .lock()
        .await
        .list_schedules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_schedule(
    state: State<'_, UpsServiceState>,
    id: String,
    sched_id: String,
) -> CmdResult<UpsSchedule> {
    state
        .lock()
        .await
        .get_schedule(&id, &sched_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_create_schedule(
    state: State<'_, UpsServiceState>,
    id: String,
    schedule: UpsSchedule,
) -> CmdResult<UpsSchedule> {
    state
        .lock()
        .await
        .create_schedule(&id, &schedule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_update_schedule(
    state: State<'_, UpsServiceState>,
    id: String,
    sched_id: String,
    schedule: UpsSchedule,
) -> CmdResult<UpsSchedule> {
    state
        .lock()
        .await
        .update_schedule(&id, &sched_id, &schedule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_delete_schedule(
    state: State<'_, UpsServiceState>,
    id: String,
    sched_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_schedule(&id, &sched_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_enable_schedule(
    state: State<'_, UpsServiceState>,
    id: String,
    sched_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_schedule(&id, &sched_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_disable_schedule(
    state: State<'_, UpsServiceState>,
    id: String,
    sched_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_schedule(&id, &sched_id)
        .await
        .map_err(map_err)
}

// ── Thresholds ───────────────────────────────────────────────

#[tauri::command]
pub async fn ups_list_thresholds(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
) -> CmdResult<Vec<UpsThreshold>> {
    state
        .lock()
        .await
        .list_thresholds(&id, &device)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_threshold(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
    var: String,
) -> CmdResult<UpsThreshold> {
    state
        .lock()
        .await
        .get_threshold(&id, &device, &var)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_set_threshold(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
    var: String,
    low: Option<f64>,
    high: Option<f64>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_threshold(&id, &device, &var, low, high)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_low_battery_threshold(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
) -> CmdResult<f64> {
    state
        .lock()
        .await
        .get_low_battery_threshold(&id, &device)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_set_low_battery_threshold(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
    value: f64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_low_battery_threshold(&id, &device, value)
        .await
        .map_err(map_err)
}

// ── Testing ──────────────────────────────────────────────────

#[tauri::command]
pub async fn ups_quick_test(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
) -> CmdResult<UpsTestResult> {
    state
        .lock()
        .await
        .quick_test(&id, &device)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_deep_test(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
) -> CmdResult<UpsTestResult> {
    state
        .lock()
        .await
        .deep_test(&id, &device)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_abort_test(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .abort_test(&id, &device)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_last_test_result(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
) -> CmdResult<UpsTestResult> {
    state
        .lock()
        .await
        .get_last_test_result(&id, &device)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_calibrate_battery(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
) -> CmdResult<UpsTestResult> {
    state
        .lock()
        .await
        .calibrate_battery(&id, &device)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_test_history(
    state: State<'_, UpsServiceState>,
    id: String,
    device: String,
) -> CmdResult<Vec<UpsTestResult>> {
    state
        .lock()
        .await
        .get_test_history(&id, &device)
        .await
        .map_err(map_err)
}

// ── Configuration ────────────────────────────────────────────

#[tauri::command]
pub async fn ups_get_nut_config(
    state: State<'_, UpsServiceState>,
    id: String,
) -> CmdResult<NutConfig> {
    state
        .lock()
        .await
        .get_nut_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_ups_conf(state: State<'_, UpsServiceState>, id: String) -> CmdResult<String> {
    state.lock().await.get_ups_conf(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ups_set_ups_conf(
    state: State<'_, UpsServiceState>,
    id: String,
    content: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_ups_conf(&id, &content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_upsd_conf(state: State<'_, UpsServiceState>, id: String) -> CmdResult<String> {
    state.lock().await.get_upsd_conf(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ups_set_upsd_conf(
    state: State<'_, UpsServiceState>,
    id: String,
    content: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_upsd_conf(&id, &content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_reload_upsd(state: State<'_, UpsServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.reload_upsd(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ups_reload_upsmon(state: State<'_, UpsServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.reload_upsmon(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ups_restart_nut(state: State<'_, UpsServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.restart_nut(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_nut_mode(state: State<'_, UpsServiceState>, id: String) -> CmdResult<String> {
    state.lock().await.get_nut_mode(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ups_set_nut_mode(
    state: State<'_, UpsServiceState>,
    id: String,
    mode: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_nut_mode(&id, &mode)
        .await
        .map_err(map_err)
}

// ── Notifications ────────────────────────────────────────────

#[tauri::command]
pub async fn ups_list_notifications(
    state: State<'_, UpsServiceState>,
    id: String,
) -> CmdResult<Vec<UpsNotification>> {
    state
        .lock()
        .await
        .list_notifications(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_notify_flags(
    state: State<'_, UpsServiceState>,
    id: String,
    event_type: String,
) -> CmdResult<NotifyFlags> {
    state
        .lock()
        .await
        .get_notify_flags(&id, &event_type)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_set_notify_flags(
    state: State<'_, UpsServiceState>,
    id: String,
    event_type: String,
    flags: NotifyFlags,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_notify_flags(&id, &event_type, &flags)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_notify_message(
    state: State<'_, UpsServiceState>,
    id: String,
    event_type: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_notify_message(&id, &event_type)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_set_notify_message(
    state: State<'_, UpsServiceState>,
    id: String,
    event_type: String,
    message: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_notify_message(&id, &event_type, &message)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_get_notify_cmd(
    state: State<'_, UpsServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_notify_cmd(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_set_notify_cmd(
    state: State<'_, UpsServiceState>,
    id: String,
    cmd: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_notify_cmd(&id, &cmd)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn ups_test_notification(
    state: State<'_, UpsServiceState>,
    id: String,
    event_type: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .test_notification(&id, &event_type)
        .await
        .map_err(map_err)
}
