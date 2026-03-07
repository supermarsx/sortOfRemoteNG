//! Aggregate UPS service façade.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::actions::ActionManager;
use crate::battery::BatteryManager;
use crate::client::UpsClient;
use crate::config::ConfigManager;
use crate::devices::DeviceManager;
use crate::error::{UpsError, UpsResult};
use crate::events::EventManager;
use crate::nut::NutManager;
use crate::outlet::OutletManager;
use crate::scheduling::ScheduleManager;
use crate::status::StatusManager;
use crate::types::*;

/// Shared Tauri state handle.
pub type UpsServiceState = Arc<Mutex<UpsService>>;

/// Main UPS service managing connections.
pub struct UpsService {
    connections: HashMap<String, UpsClient>,
}

impl UpsService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: UpsConnectionConfig) -> UpsResult<UpsConnectionSummary> {
        if self.connections.contains_key(&id) {
            return Err(UpsError::already_connected(format!("Connection '{}' already exists", id)));
        }
        let client = UpsClient::new(config)?;
        let ver = client
            .exec_ssh("upsd -V 2>/dev/null || echo ''")
            .await
            .ok()
            .map(|o| o.stdout.trim().to_string())
            .filter(|s| !s.is_empty());
        let devices = client
            .exec_ssh("upsc -l 2>/dev/null || echo ''")
            .await
            .ok()
            .map(|o| o.stdout.lines().filter(|l| !l.trim().is_empty()).count() as u32)
            .unwrap_or(0);
        let summary = UpsConnectionSummary {
            host: client.config.host.clone(),
            devices_count: devices,
            nut_version: ver,
            server_info: None,
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> UpsResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| UpsError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> UpsResult<&UpsClient> {
        self.connections
            .get(id)
            .ok_or_else(|| UpsError::not_connected(format!("No connection '{}'", id)))
    }

    // ═════════════════════════════════════════════════════════════════
    // Devices
    // ═════════════════════════════════════════════════════════════════

    pub async fn list_devices(&self, id: &str) -> UpsResult<Vec<UpsDevice>> {
        DeviceManager::list(self.client(id)?).await
    }

    pub async fn get_device(&self, id: &str, name: &str) -> UpsResult<UpsDevice> {
        DeviceManager::get(self.client(id)?, name).await
    }

    pub async fn add_device(&self, id: &str, req: &CreateDeviceRequest) -> UpsResult<CommandResult> {
        DeviceManager::add(self.client(id)?, req).await
    }

    pub async fn remove_device(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        DeviceManager::remove(self.client(id)?, name).await
    }

    pub async fn list_variables(&self, id: &str, name: &str) -> UpsResult<Vec<UpsVariable>> {
        DeviceManager::list_variables(self.client(id)?, name).await
    }

    pub async fn get_variable(&self, id: &str, name: &str, var: &str) -> UpsResult<String> {
        DeviceManager::get_variable(self.client(id)?, name, var).await
    }

    pub async fn set_variable(&self, id: &str, name: &str, var: &str, val: &str) -> UpsResult<CommandResult> {
        DeviceManager::set_variable(self.client(id)?, name, var, val).await
    }

    pub async fn list_commands(&self, id: &str, name: &str) -> UpsResult<Vec<String>> {
        DeviceManager::list_commands(self.client(id)?, name).await
    }

    pub async fn list_clients(&self, id: &str, name: &str) -> UpsResult<Vec<String>> {
        DeviceManager::list_clients(self.client(id)?, name).await
    }

    pub async fn list_drivers(&self, id: &str) -> UpsResult<Vec<UpsDriver>> {
        DeviceManager::list_drivers(self.client(id)?).await
    }

    pub async fn get_device_type(&self, id: &str, name: &str) -> UpsResult<String> {
        DeviceManager::get_device_type(self.client(id)?, name).await
    }

    // ═════════════════════════════════════════════════════════════════
    // Status
    // ═════════════════════════════════════════════════════════════════

    pub async fn get_status(&self, id: &str, name: &str) -> UpsResult<UpsStatus> {
        StatusManager::get_status(self.client(id)?, name).await
    }

    pub async fn get_power_quality(&self, id: &str, name: &str) -> UpsResult<PowerQuality> {
        StatusManager::get_power_quality(self.client(id)?, name).await
    }

    pub async fn get_alarms(&self, id: &str, name: &str) -> UpsResult<Vec<String>> {
        StatusManager::get_alarms(self.client(id)?, name).await
    }

    pub async fn get_input_stats(&self, id: &str, name: &str) -> UpsResult<serde_json::Value> {
        StatusManager::get_input_stats(self.client(id)?, name).await
    }

    pub async fn get_output_stats(&self, id: &str, name: &str) -> UpsResult<serde_json::Value> {
        StatusManager::get_output_stats(self.client(id)?, name).await
    }

    pub async fn get_bypass_info(&self, id: &str, name: &str) -> UpsResult<serde_json::Value> {
        StatusManager::get_bypass_info(self.client(id)?, name).await
    }

    pub async fn is_on_battery(&self, id: &str, name: &str) -> UpsResult<bool> {
        StatusManager::is_on_battery(self.client(id)?, name).await
    }

    pub async fn is_online(&self, id: &str, name: &str) -> UpsResult<bool> {
        StatusManager::is_online(self.client(id)?, name).await
    }

    pub async fn get_efficiency(&self, id: &str, name: &str) -> UpsResult<Option<f64>> {
        StatusManager::get_efficiency(self.client(id)?, name).await
    }

    pub async fn get_self_test_result(&self, id: &str, name: &str) -> UpsResult<Option<String>> {
        StatusManager::get_self_test_result(self.client(id)?, name).await
    }

    // ═════════════════════════════════════════════════════════════════
    // Battery
    // ═════════════════════════════════════════════════════════════════

    pub async fn get_battery_status(&self, id: &str, name: &str) -> UpsResult<BatteryStatus> {
        BatteryManager::get_status(self.client(id)?, name).await
    }

    pub async fn get_battery_health(&self, id: &str, name: &str) -> UpsResult<BatteryHealth> {
        BatteryManager::get_health(self.client(id)?, name).await
    }

    pub async fn start_battery_test(&self, id: &str, name: &str, test_type: &str) -> UpsResult<CommandResult> {
        BatteryManager::start_test(self.client(id)?, name, test_type).await
    }

    pub async fn get_battery_test_result(&self, id: &str, name: &str) -> UpsResult<BatteryTest> {
        BatteryManager::get_test_result(self.client(id)?, name).await
    }

    pub async fn get_runtime_estimate(&self, id: &str, name: &str) -> UpsResult<Option<u64>> {
        BatteryManager::get_runtime_estimate(self.client(id)?, name).await
    }

    pub async fn get_charge_rate(&self, id: &str, name: &str) -> UpsResult<Option<f64>> {
        BatteryManager::get_charge_rate(self.client(id)?, name).await
    }

    pub async fn get_battery_history(&self, id: &str, name: &str, limit: Option<u32>) -> UpsResult<Vec<serde_json::Value>> {
        BatteryManager::get_history(self.client(id)?, name, limit).await
    }

    pub async fn calibrate_battery(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        BatteryManager::calibrate(self.client(id)?, name).await
    }

    pub async fn get_battery_replacement_info(&self, id: &str, name: &str) -> UpsResult<serde_json::Value> {
        BatteryManager::get_replacement_info(self.client(id)?, name).await
    }

    // ═════════════════════════════════════════════════════════════════
    // Outlets
    // ═════════════════════════════════════════════════════════════════

    pub async fn list_outlets(&self, id: &str, name: &str) -> UpsResult<Vec<UpsOutlet>> {
        OutletManager::list(self.client(id)?, name).await
    }

    pub async fn get_outlet(&self, id: &str, name: &str, outlet_id: u32) -> UpsResult<UpsOutlet> {
        OutletManager::get(self.client(id)?, name, outlet_id).await
    }

    pub async fn set_outlet_status(&self, id: &str, name: &str, req: &SetOutletRequest) -> UpsResult<CommandResult> {
        OutletManager::set_status(self.client(id)?, name, req).await
    }

    pub async fn set_outlet_group_status(&self, id: &str, name: &str, group: &OutletGroup, status: &OutletStatus) -> UpsResult<CommandResult> {
        OutletManager::set_group_status(self.client(id)?, name, group, status).await
    }

    pub async fn list_outlet_groups(&self, id: &str, name: &str) -> UpsResult<Vec<OutletGroup>> {
        OutletManager::list_groups(self.client(id)?, name).await
    }

    pub async fn create_outlet_group(&self, id: &str, name: &str, group: &OutletGroup) -> UpsResult<CommandResult> {
        OutletManager::create_group(self.client(id)?, name, group).await
    }

    pub async fn delete_outlet_group(&self, id: &str, name: &str, group_id: &str) -> UpsResult<CommandResult> {
        OutletManager::delete_group(self.client(id)?, name, group_id).await
    }

    pub async fn get_outlet_load(&self, id: &str, name: &str, outlet_id: u32) -> UpsResult<Option<f64>> {
        OutletManager::get_load(self.client(id)?, name, outlet_id).await
    }

    pub async fn schedule_outlet(&self, id: &str, name: &str, outlet_id: u32, status: &OutletStatus, delay_secs: u32) -> UpsResult<CommandResult> {
        OutletManager::schedule_outlet(self.client(id)?, name, outlet_id, status, delay_secs).await
    }

    // ═════════════════════════════════════════════════════════════════
    // Events
    // ═════════════════════════════════════════════════════════════════

    pub async fn list_events(&self, id: &str, filter: Option<&EventFilter>) -> UpsResult<Vec<UpsEvent>> {
        EventManager::list_events(self.client(id)?, filter).await
    }

    pub async fn get_recent_events(&self, id: &str, limit: Option<u32>) -> UpsResult<Vec<UpsEvent>> {
        EventManager::get_recent(self.client(id)?, limit).await
    }

    pub async fn subscribe_events(&self, id: &str, device: &str) -> UpsResult<CommandResult> {
        EventManager::subscribe(self.client(id)?, device).await
    }

    pub async fn clear_events(&self, id: &str) -> UpsResult<CommandResult> {
        EventManager::clear_events(self.client(id)?).await
    }

    pub async fn get_event_counts(&self, id: &str) -> UpsResult<serde_json::Value> {
        EventManager::get_event_counts(self.client(id)?).await
    }

    pub async fn export_events(&self, id: &str, filter: Option<&EventFilter>) -> UpsResult<String> {
        EventManager::export_events(self.client(id)?, filter).await
    }

    // ═════════════════════════════════════════════════════════════════
    // Config
    // ═════════════════════════════════════════════════════════════════

    pub async fn get_nut_config(&self, id: &str) -> UpsResult<NutConfig> {
        ConfigManager::get_nut_config(self.client(id)?).await
    }

    pub async fn update_nut_config(&self, id: &str, config: &NutConfig) -> UpsResult<()> {
        ConfigManager::update_nut_config(self.client(id)?, config).await
    }

    pub async fn get_ups_config(&self, id: &str) -> UpsResult<Vec<NutUpsConfig>> {
        ConfigManager::get_ups_config(self.client(id)?).await
    }

    pub async fn update_ups_config(&self, id: &str, configs: &[NutUpsConfig]) -> UpsResult<()> {
        ConfigManager::update_ups_config(self.client(id)?, configs).await
    }

    pub async fn get_upsd_config(&self, id: &str) -> UpsResult<NutUpsdConfig> {
        ConfigManager::get_upsd_config(self.client(id)?).await
    }

    pub async fn update_upsd_config(&self, id: &str, config: &NutUpsdConfig) -> UpsResult<()> {
        ConfigManager::update_upsd_config(self.client(id)?, config).await
    }

    pub async fn get_upsmon_config(&self, id: &str) -> UpsResult<UpsmonConfig> {
        ConfigManager::get_upsmon_config(self.client(id)?).await
    }

    pub async fn update_upsmon_config(&self, id: &str, config: &UpsmonConfig) -> UpsResult<()> {
        ConfigManager::update_upsmon_config(self.client(id)?, config).await
    }

    pub async fn get_upssched_config(&self, id: &str) -> UpsResult<UpsSched> {
        ConfigManager::get_upssched_config(self.client(id)?).await
    }

    pub async fn update_upssched_config(&self, id: &str, config: &UpsSched) -> UpsResult<()> {
        ConfigManager::update_upssched_config(self.client(id)?, config).await
    }

    pub async fn validate_config(&self, id: &str) -> UpsResult<ConfigValidationResult> {
        ConfigManager::validate_config(self.client(id)?).await
    }

    pub async fn reload_config(&self, id: &str) -> UpsResult<CommandResult> {
        ConfigManager::reload_config(self.client(id)?).await
    }

    // ═════════════════════════════════════════════════════════════════
    // Actions
    // ═════════════════════════════════════════════════════════════════

    pub async fn shutdown(&self, id: &str, req: &ShutdownRequest) -> UpsResult<CommandResult> {
        ActionManager::shutdown(self.client(id)?, req).await
    }

    pub async fn shutdown_return(&self, id: &str, name: &str, delay_secs: Option<u64>) -> UpsResult<CommandResult> {
        ActionManager::shutdown_return(self.client(id)?, name, delay_secs).await
    }

    pub async fn reboot(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        ActionManager::reboot(self.client(id)?, name).await
    }

    pub async fn load_off(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        ActionManager::load_off(self.client(id)?, name).await
    }

    pub async fn load_on(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        ActionManager::load_on(self.client(id)?, name).await
    }

    pub async fn test_battery(&self, id: &str, name: &str, test_type: &str) -> UpsResult<CommandResult> {
        ActionManager::test_battery(self.client(id)?, name, test_type).await
    }

    pub async fn test_panel(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        ActionManager::test_panel(self.client(id)?, name).await
    }

    pub async fn calibrate(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        ActionManager::calibrate(self.client(id)?, name).await
    }

    pub async fn beeper_enable(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        ActionManager::beeper_enable(self.client(id)?, name).await
    }

    pub async fn beeper_disable(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        ActionManager::beeper_disable(self.client(id)?, name).await
    }

    pub async fn beeper_mute(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        ActionManager::beeper_mute(self.client(id)?, name).await
    }

    pub async fn bypass_start(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        ActionManager::bypass_start(self.client(id)?, name).await
    }

    pub async fn bypass_stop(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        ActionManager::bypass_stop(self.client(id)?, name).await
    }

    pub async fn reset_min_max(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        ActionManager::reset_min_max(self.client(id)?, name).await
    }

    pub async fn run_custom_command(&self, id: &str, name: &str, command: &str) -> UpsResult<CommandResult> {
        ActionManager::run_custom_command(self.client(id)?, name, command).await
    }

    // ═════════════════════════════════════════════════════════════════
    // Scheduling
    // ═════════════════════════════════════════════════════════════════

    pub async fn list_schedules(&self, id: &str) -> UpsResult<Vec<PowerSchedule>> {
        ScheduleManager::list(self.client(id)?).await
    }

    pub async fn get_schedule(&self, id: &str, schedule_id: &str) -> UpsResult<PowerSchedule> {
        ScheduleManager::get(self.client(id)?, schedule_id).await
    }

    pub async fn create_schedule(&self, id: &str, req: &CreateScheduleRequest) -> UpsResult<PowerSchedule> {
        ScheduleManager::create(self.client(id)?, req).await
    }

    pub async fn update_schedule(&self, id: &str, schedule_id: &str, req: &UpdateScheduleRequest) -> UpsResult<PowerSchedule> {
        ScheduleManager::update(self.client(id)?, schedule_id, req).await
    }

    pub async fn delete_schedule(&self, id: &str, schedule_id: &str) -> UpsResult<()> {
        ScheduleManager::delete(self.client(id)?, schedule_id).await
    }

    pub async fn enable_schedule(&self, id: &str, schedule_id: &str) -> UpsResult<PowerSchedule> {
        ScheduleManager::enable(self.client(id)?, schedule_id).await
    }

    pub async fn disable_schedule(&self, id: &str, schedule_id: &str) -> UpsResult<PowerSchedule> {
        ScheduleManager::disable(self.client(id)?, schedule_id).await
    }

    pub async fn run_schedule_now(&self, id: &str, schedule_id: &str) -> UpsResult<CommandResult> {
        ScheduleManager::run_now(self.client(id)?, schedule_id).await
    }

    pub async fn list_schedule_history(&self, id: &str, schedule_id: Option<&str>) -> UpsResult<Vec<ScheduleHistoryEntry>> {
        ScheduleManager::list_history(self.client(id)?, schedule_id).await
    }

    // ═════════════════════════════════════════════════════════════════
    // NUT Server
    // ═════════════════════════════════════════════════════════════════

    pub async fn get_server_info(&self, id: &str) -> UpsResult<NutServerInfo> {
        NutManager::get_server_info(self.client(id)?).await
    }

    pub async fn list_nut_devices(&self, id: &str) -> UpsResult<Vec<String>> {
        NutManager::list_ups_devices(self.client(id)?).await
    }

    pub async fn get_nut_data(&self, id: &str, name: &str) -> UpsResult<serde_json::Value> {
        NutManager::get_ups_data(self.client(id)?, name).await
    }

    pub async fn run_nut_command(&self, id: &str, name: &str, command: &str) -> UpsResult<CommandResult> {
        NutManager::run_ups_command(self.client(id)?, name, command).await
    }

    pub async fn list_writable_vars(&self, id: &str, name: &str) -> UpsResult<Vec<UpsVariable>> {
        NutManager::list_writable_vars(self.client(id)?, name).await
    }

    pub async fn nut_set_variable(&self, id: &str, name: &str, var: &str, val: &str) -> UpsResult<CommandResult> {
        NutManager::set_variable(self.client(id)?, name, var, val).await
    }

    pub async fn nut_login(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        NutManager::login(self.client(id)?, name).await
    }

    pub async fn nut_logout(&self, id: &str, name: &str) -> UpsResult<CommandResult> {
        NutManager::logout(self.client(id)?, name).await
    }

    pub async fn get_num_logins(&self, id: &str, name: &str) -> UpsResult<u32> {
        NutManager::get_num_logins(self.client(id)?, name).await
    }
}
