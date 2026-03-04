//! Health rollup for Supermicro BMCs.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct HealthManager;

impl HealthManager {
    /// Get overall health rollup (Redfish only).
    pub async fn get_health_rollup(client: &SmcClient) -> SmcResult<HealthRollup> {
        let rf = client.require_redfish()?;
        rf.get_health_rollup().await
    }

    /// Get aggregate dashboard — combines system, BMC, power, thermal info.
    pub async fn get_dashboard(client: &SmcClient) -> SmcResult<SmcDashboard> {
        let system_info = crate::system::SystemManager::get_system_info(client).await.ok();
        let bmc_info = crate::system::SystemManager::get_bmc_info(client).await.ok();
        let power_state = crate::power::PowerManager::get_power_state(client).await.ok();
        let health = Self::get_health_rollup(client).await.ok();
        let thermal = crate::thermal::ThermalManager::get_thermal_summary(client).await.ok();
        let power_metrics = crate::power::PowerManager::get_power_metrics(client).await.ok();
        let event_log = crate::event_log::EventLogManager::get_event_log(client).await.ok();

        let platform = bmc_info.as_ref()
            .map(|b| b.platform.clone())
            .unwrap_or_else(|| client.platform().clone());

        Ok(SmcDashboard {
            platform,
            system_info: system_info.clone(),
            bmc_info,
            power_state,
            health_status: health.as_ref().map(|h| h.overall_status.clone()),
            total_memory_gb: system_info.as_ref().and_then(|s| s.total_memory_gib),
            cpu_count: system_info.as_ref().and_then(|s| s.processor_count),
            storage_controller_count: None, // Would need extra call
            nic_count: None, // Would need extra call
            ambient_temp_celsius: thermal.as_ref().and_then(|t| t.ambient_temp_celsius),
            total_power_watts: power_metrics.as_ref().and_then(|p| p.total_consumed_watts),
            sel_entry_count: event_log.as_ref().map(|e| e.len() as u32),
            license_tier: None, // Only available via separate license call
        })
    }
}
