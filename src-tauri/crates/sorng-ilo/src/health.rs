//! Health roll-up — aggregate status across subsystems.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Health assessment operations.
pub struct HealthManager<'a> {
    client: &'a IloClient,
}

impl<'a> HealthManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get health roll-up from Redfish chassis/system.
    pub async fn get_health_rollup(&self) -> IloResult<BmcHealthRollup> {
        if let Ok(rf) = self.client.require_redfish() {
            let sys: serde_json::Value = rf.get_system().await?;

            let system_health = sys
                .get("Status")
                .and_then(|s| s.get("Health"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();

            let proc_health = sys
                .pointer("/ProcessorSummary/Status/Health")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();

            let memory_health = sys
                .pointer("/MemorySummary/Status/Health")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();

            return Ok(BmcHealthRollup {
                overall: system_health,
                processors: proc_health,
                memory: memory_health,
                storage: "Unknown".to_string(),
                fans: "Unknown".to_string(),
                temperatures: "Unknown".to_string(),
                power_supplies: "Unknown".to_string(),
                network: "Unknown".to_string(),
            });
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let health = ribcl.get_embedded_health().await?;

            let get_status = |section: &str| -> String {
                health
                    .get(section)
                    .and_then(|d| d.get("STATUS"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown")
                    .to_string()
            };

            let overall = get_status("FANS"); // Use first available as overall
            return Ok(BmcHealthRollup {
                overall,
                processors: get_status("PROCESSOR"),
                memory: get_status("MEMORY"),
                storage: get_status("STORAGE"),
                fans: get_status("FANS"),
                temperatures: get_status("TEMPERATURE"),
                power_supplies: get_status("POWER_SUPPLY"),
                network: get_status("NIC"),
            });
        }

        Err(IloError::unsupported(
            "No protocol available for health status",
        ))
    }

    /// Get an aggregated dashboard view.
    pub async fn get_dashboard(&self) -> IloResult<IloDashboard> {
        use crate::power::PowerManager;
        use crate::system::SystemManager;
        use crate::thermal::ThermalManager;

        let system = SystemManager::new(self.client);
        let power = PowerManager::new(self.client);
        let thermal = ThermalManager::new(self.client);

        let system_info = system.get_system_info().await.ok();
        let ilo_info = system.get_ilo_info().await.ok();
        let health = self.get_health_rollup().await.ok();
        let power_state = power.get_power_state().await.ok();
        let power_metrics = power.get_power_metrics().await.ok();
        let thermal_summary = thermal.get_thermal_summary().await.ok();

        Ok(IloDashboard {
            system_info,
            ilo_info,
            health,
            power_state,
            power_consumption_watts: power_metrics.as_ref().and_then(|p| p.current_watts),
            thermal_summary,
        })
    }
}
