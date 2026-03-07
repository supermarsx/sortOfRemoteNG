// ── sorng-ups/src/service.rs ────────────────────────────────────────────────
//! Aggregate UPS (NUT) service – holds connections and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::UpsClient;
use crate::error::{UpsError, UpsResult};
use crate::types::*;

use crate::battery;
use crate::configuration;
use crate::devices;
use crate::events;
use crate::notifications;
use crate::outlets;
use crate::scheduling;
use crate::status;
use crate::testing;
use crate::thresholds;

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

    // ── Connection lifecycle ─────────────────────────────────────

    pub fn connect(&mut self, id: String, config: UpsConnectionConfig) -> UpsResult<String> {
        let client = UpsClient::new(config)?;
        self.connections.insert(id.clone(), client);
        Ok(id)
    }

    pub fn disconnect(&mut self, id: &str) -> UpsResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| UpsError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> UpsResult<&UpsClient> {
        self.connections
            .get(id)
            .ok_or_else(|| UpsError::not_connected(format!("No connection '{id}'")))
    }

    // ── Devices ──────────────────────────────────────────────────

    pub async fn list_devices(&self, id: &str) -> UpsResult<Vec<UpsDevice>> {
        devices::DeviceManager::list(self.client(id)?).await
    }

    pub async fn get_device(&self, id: &str, name: &str) -> UpsResult<UpsDevice> {
        devices::DeviceManager::get(self.client(id)?, name).await
    }

    pub async fn list_device_variables(&self, id: &str, name: &str) -> UpsResult<Vec<UpsVariable>> {
        devices::DeviceManager::list_variables(self.client(id)?, name).await
    }

    pub async fn get_device_variable(&self, id: &str, name: &str, var: &str) -> UpsResult<UpsVariable> {
        devices::DeviceManager::get_variable(self.client(id)?, name, var).await
    }

    pub async fn set_device_variable(&self, id: &str, name: &str, var: &str, value: &str) -> UpsResult<()> {
        devices::DeviceManager::set_variable(self.client(id)?, name, var, value).await
    }

    pub async fn list_device_commands(&self, id: &str, name: &str) -> UpsResult<Vec<UpsCommand>> {
        devices::DeviceManager::list_commands(self.client(id)?, name).await
    }

    pub async fn run_device_command(&self, id: &str, name: &str, cmd: &str) -> UpsResult<String> {
        devices::DeviceManager::run_command(self.client(id)?, name, cmd).await
    }

    // ── Status ───────────────────────────────────────────────────

    pub async fn get_status(&self, id: &str, name: &str) -> UpsResult<UpsStatus> {
        status::StatusManager::get(self.client(id)?, name).await
    }

    pub async fn is_on_battery(&self, id: &str, name: &str) -> UpsResult<bool> {
        status::StatusManager::is_on_battery(self.client(id)?, name).await
    }

    pub async fn is_online(&self, id: &str, name: &str) -> UpsResult<bool> {
        status::StatusManager::is_online(self.client(id)?, name).await
    }

    pub async fn get_load(&self, id: &str, name: &str) -> UpsResult<f64> {
        status::StatusManager::get_load(self.client(id)?, name).await
    }

    pub async fn get_input_voltage(&self, id: &str, name: &str) -> UpsResult<f64> {
        status::StatusManager::get_input_voltage(self.client(id)?, name).await
    }

    pub async fn get_output_voltage(&self, id: &str, name: &str) -> UpsResult<f64> {
        status::StatusManager::get_output_voltage(self.client(id)?, name).await
    }

    pub async fn get_temperature(&self, id: &str, name: &str) -> UpsResult<f64> {
        status::StatusManager::get_temperature(self.client(id)?, name).await
    }

    pub async fn list_all_status(&self, id: &str) -> UpsResult<Vec<UpsStatus>> {
        status::StatusManager::list_all_status(self.client(id)?).await
    }

    // ── Battery ──────────────────────────────────────────────────

    pub async fn get_battery_info(&self, id: &str, name: &str) -> UpsResult<BatteryInfo> {
        battery::BatteryManager::get_info(self.client(id)?, name).await
    }

    pub async fn get_battery_charge(&self, id: &str, name: &str) -> UpsResult<f64> {
        battery::BatteryManager::get_charge(self.client(id)?, name).await
    }

    pub async fn get_battery_runtime(&self, id: &str, name: &str) -> UpsResult<u64> {
        battery::BatteryManager::get_runtime(self.client(id)?, name).await
    }

    pub async fn get_battery_voltage(&self, id: &str, name: &str) -> UpsResult<f64> {
        battery::BatteryManager::get_voltage(self.client(id)?, name).await
    }

    pub async fn is_battery_low(&self, id: &str, name: &str) -> UpsResult<bool> {
        battery::BatteryManager::is_low(self.client(id)?, name).await
    }

    pub async fn battery_needs_replacement(&self, id: &str, name: &str) -> UpsResult<bool> {
        battery::BatteryManager::needs_replacement(self.client(id)?, name).await
    }

    pub async fn get_battery_health(&self, id: &str, name: &str) -> UpsResult<String> {
        battery::BatteryManager::get_health(self.client(id)?, name).await
    }

    // ── Events ───────────────────────────────────────────────────

    pub async fn list_events(&self, id: &str, device: Option<&str>, limit: Option<usize>) -> UpsResult<Vec<UpsEvent>> {
        events::EventManager::list(self.client(id)?, device, limit).await
    }

    pub async fn get_recent_events(&self, id: &str, device: Option<&str>, hours: u64) -> UpsResult<Vec<UpsEvent>> {
        events::EventManager::get_recent(self.client(id)?, device, hours).await
    }

    pub async fn clear_event_log(&self, id: &str, device: Option<&str>) -> UpsResult<()> {
        events::EventManager::clear_log(self.client(id)?, device).await
    }

    // ── Outlets ──────────────────────────────────────────────────

    pub async fn list_outlets(&self, id: &str, device: &str) -> UpsResult<Vec<UpsOutlet>> {
        outlets::OutletManager::list(self.client(id)?, device).await
    }

    pub async fn get_outlet(&self, id: &str, device: &str, outlet_id: &str) -> UpsResult<UpsOutlet> {
        outlets::OutletManager::get(self.client(id)?, device, outlet_id).await
    }

    pub async fn switch_outlet_on(&self, id: &str, device: &str, outlet_id: &str) -> UpsResult<()> {
        outlets::OutletManager::switch_on(self.client(id)?, device, outlet_id).await
    }

    pub async fn switch_outlet_off(&self, id: &str, device: &str, outlet_id: &str) -> UpsResult<()> {
        outlets::OutletManager::switch_off(self.client(id)?, device, outlet_id).await
    }

    pub async fn get_outlet_delay(&self, id: &str, device: &str, outlet_id: &str) -> UpsResult<(u64, u64)> {
        outlets::OutletManager::get_delay(self.client(id)?, device, outlet_id).await
    }

    pub async fn set_outlet_delay(&self, id: &str, device: &str, outlet_id: &str, shutdown_delay: u64, start_delay: u64) -> UpsResult<()> {
        outlets::OutletManager::set_delay(self.client(id)?, device, outlet_id, shutdown_delay, start_delay).await
    }

    // ── Scheduling ───────────────────────────────────────────────

    pub async fn list_schedules(&self, id: &str) -> UpsResult<Vec<UpsSchedule>> {
        scheduling::ScheduleManager::list(self.client(id)?).await
    }

    pub async fn get_schedule(&self, id: &str, sched_id: &str) -> UpsResult<UpsSchedule> {
        scheduling::ScheduleManager::get(self.client(id)?, sched_id).await
    }

    pub async fn create_schedule(&self, id: &str, schedule: &UpsSchedule) -> UpsResult<UpsSchedule> {
        scheduling::ScheduleManager::create(self.client(id)?, schedule).await
    }

    pub async fn update_schedule(&self, id: &str, sched_id: &str, schedule: &UpsSchedule) -> UpsResult<UpsSchedule> {
        scheduling::ScheduleManager::update(self.client(id)?, sched_id, schedule).await
    }

    pub async fn delete_schedule(&self, id: &str, sched_id: &str) -> UpsResult<()> {
        scheduling::ScheduleManager::delete(self.client(id)?, sched_id).await
    }

    pub async fn enable_schedule(&self, id: &str, sched_id: &str) -> UpsResult<()> {
        scheduling::ScheduleManager::enable(self.client(id)?, sched_id).await
    }

    pub async fn disable_schedule(&self, id: &str, sched_id: &str) -> UpsResult<()> {
        scheduling::ScheduleManager::disable(self.client(id)?, sched_id).await
    }

    // ── Thresholds ───────────────────────────────────────────────

    pub async fn list_thresholds(&self, id: &str, device: &str) -> UpsResult<Vec<UpsThreshold>> {
        thresholds::ThresholdManager::list(self.client(id)?, device).await
    }

    pub async fn get_threshold(&self, id: &str, device: &str, var: &str) -> UpsResult<UpsThreshold> {
        thresholds::ThresholdManager::get(self.client(id)?, device, var).await
    }

    pub async fn set_threshold(&self, id: &str, device: &str, var: &str, low: Option<f64>, high: Option<f64>) -> UpsResult<()> {
        thresholds::ThresholdManager::set(self.client(id)?, device, var, low, high).await
    }

    pub async fn get_low_battery_threshold(&self, id: &str, device: &str) -> UpsResult<f64> {
        thresholds::ThresholdManager::get_low_battery(self.client(id)?, device).await
    }

    pub async fn set_low_battery_threshold(&self, id: &str, device: &str, value: f64) -> UpsResult<()> {
        thresholds::ThresholdManager::set_low_battery(self.client(id)?, device, value).await
    }

    // ── Testing ──────────────────────────────────────────────────

    pub async fn quick_test(&self, id: &str, device: &str) -> UpsResult<UpsTestResult> {
        testing::TestManager::quick_test(self.client(id)?, device).await
    }

    pub async fn deep_test(&self, id: &str, device: &str) -> UpsResult<UpsTestResult> {
        testing::TestManager::deep_test(self.client(id)?, device).await
    }

    pub async fn abort_test(&self, id: &str, device: &str) -> UpsResult<()> {
        testing::TestManager::abort_test(self.client(id)?, device).await
    }

    pub async fn get_last_test_result(&self, id: &str, device: &str) -> UpsResult<UpsTestResult> {
        testing::TestManager::get_last_result(self.client(id)?, device).await
    }

    pub async fn calibrate_battery(&self, id: &str, device: &str) -> UpsResult<UpsTestResult> {
        testing::TestManager::calibrate_battery(self.client(id)?, device).await
    }

    pub async fn get_test_history(&self, id: &str, device: &str) -> UpsResult<Vec<UpsTestResult>> {
        testing::TestManager::get_test_history(self.client(id)?, device).await
    }

    // ── Configuration ────────────────────────────────────────────

    pub async fn get_nut_config(&self, id: &str) -> UpsResult<NutConfig> {
        configuration::ConfigManager::get_nut_config(self.client(id)?).await
    }

    pub async fn get_ups_conf(&self, id: &str) -> UpsResult<String> {
        configuration::ConfigManager::get_ups_conf(self.client(id)?).await
    }

    pub async fn set_ups_conf(&self, id: &str, content: &str) -> UpsResult<()> {
        configuration::ConfigManager::set_ups_conf(self.client(id)?, content).await
    }

    pub async fn get_upsd_conf(&self, id: &str) -> UpsResult<String> {
        configuration::ConfigManager::get_upsd_conf(self.client(id)?).await
    }

    pub async fn set_upsd_conf(&self, id: &str, content: &str) -> UpsResult<()> {
        configuration::ConfigManager::set_upsd_conf(self.client(id)?, content).await
    }

    pub async fn reload_upsd(&self, id: &str) -> UpsResult<()> {
        configuration::ConfigManager::reload_upsd(self.client(id)?).await
    }

    pub async fn reload_upsmon(&self, id: &str) -> UpsResult<()> {
        configuration::ConfigManager::reload_upsmon(self.client(id)?).await
    }

    pub async fn restart_nut(&self, id: &str) -> UpsResult<()> {
        configuration::ConfigManager::restart_nut(self.client(id)?).await
    }

    pub async fn get_nut_mode(&self, id: &str) -> UpsResult<String> {
        configuration::ConfigManager::get_nut_mode(self.client(id)?).await
    }

    pub async fn set_nut_mode(&self, id: &str, mode: &str) -> UpsResult<()> {
        configuration::ConfigManager::set_nut_mode(self.client(id)?, mode).await
    }

    // ── Notifications ────────────────────────────────────────────

    pub async fn list_notifications(&self, id: &str) -> UpsResult<Vec<UpsNotification>> {
        notifications::NotificationManager::list(self.client(id)?).await
    }

    pub async fn get_notify_flags(&self, id: &str, event_type: &str) -> UpsResult<NotifyFlags> {
        notifications::NotificationManager::get_flags(self.client(id)?, event_type).await
    }

    pub async fn set_notify_flags(&self, id: &str, event_type: &str, flags: &NotifyFlags) -> UpsResult<()> {
        notifications::NotificationManager::set_flags(self.client(id)?, event_type, flags).await
    }

    pub async fn get_notify_message(&self, id: &str, event_type: &str) -> UpsResult<String> {
        notifications::NotificationManager::get_message(self.client(id)?, event_type).await
    }

    pub async fn set_notify_message(&self, id: &str, event_type: &str, message: &str) -> UpsResult<()> {
        notifications::NotificationManager::set_message(self.client(id)?, event_type, message).await
    }

    pub async fn get_notify_cmd(&self, id: &str) -> UpsResult<String> {
        notifications::NotificationManager::get_notify_cmd(self.client(id)?).await
    }

    pub async fn set_notify_cmd(&self, id: &str, cmd: &str) -> UpsResult<()> {
        notifications::NotificationManager::set_notify_cmd(self.client(id)?, cmd).await
    }

    pub async fn test_notification(&self, id: &str, event_type: &str) -> UpsResult<()> {
        notifications::NotificationManager::test_notification(self.client(id)?, event_type).await
    }
}
