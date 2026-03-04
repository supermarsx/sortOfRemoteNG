//! Health roll-up — aggregate status across subsystems.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;
use sorng_bmc_common::health::{rollup_health, is_healthy};

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

            let system_health = sys.get("Status").and_then(|s| s.get("Health"))
                .and_then(|v| v.as_str()).unwrap_or("Unknown").to_string();

            let proc_health = sys.pointer("/ProcessorSummary/Status/Health")
                .and_then(|v| v.as_str()).map(|s| s.to_string());

            let memory_health = sys.pointer("/MemorySummary/Status/Health")
                .and_then(|v| v.as_str()).map(|s| s.to_string());

            // Get chassis for power/thermal health
            let chassis: serde_json::Value = rf.get_chassis().await?;
            let thermal_health = chassis.pointer("/Oem/Hpe/SystemMaintenanceSwitches/Thermal")
                .and_then(|v| v.as_str())
                .or_else(|| chassis.get("Status").and_then(|s| s.get("Health")).and_then(|v| v.as_str()))
                .map(|s| s.to_string());

            let statuses: Vec<&str> = [
                Some(system_health.as_str()),
                proc_health.as_deref(),
                memory_health.as_deref(),
                thermal_health.as_deref(),
            ]
            .iter()
            .filter_map(|s| *s)
            .collect();

            let overall = rollup_health(&statuses);

            let components = vec![
                ComponentHealth {
                    name: "System".to_string(),
                    status: system_health.clone(),
                },
                ComponentHealth {
                    name: "Processors".to_string(),
                    status: proc_health.unwrap_or_else(|| "Unknown".to_string()),
                },
                ComponentHealth {
                    name: "Memory".to_string(),
                    status: memory_health.unwrap_or_else(|| "Unknown".to_string()),
                },
                ComponentHealth {
                    name: "Thermal".to_string(),
                    status: thermal_health.unwrap_or_else(|| "Unknown".to_string()),
                },
            ];

            return Ok(BmcHealthRollup {
                overall_health: overall.to_string(),
                is_healthy: is_healthy(&overall),
                components,
            });
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let health = ribcl.get_embedded_health().await?;
            let mut components = Vec::new();

            // Parse RIBCL health categories
            for section in &["FANS", "TEMPERATURE", "VRM", "POWER_SUPPLY", "PROCESSOR", "MEMORY", "NIC", "STORAGE"] {
                if let Some(data) = health.get(*section) {
                    let status = data.get("STATUS")
                        .and_then(|v| v.as_str())
                        .unwrap_or("OK");
                    components.push(ComponentHealth {
                        name: section.to_string(),
                        status: status.to_string(),
                    });
                }
            }

            let statuses: Vec<&str> = components.iter().map(|c| c.status.as_str()).collect();
            let overall = rollup_health(&statuses);

            return Ok(BmcHealthRollup {
                overall_health: overall.to_string(),
                is_healthy: is_healthy(&overall),
                components,
            });
        }

        Err(IloError::unsupported("No protocol available for health status"))
    }

    /// Get an aggregated dashboard view.
    pub async fn get_dashboard(&self) -> IloResult<IloDashboard> {
        use crate::system::SystemManager;
        use crate::power::PowerManager;
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
