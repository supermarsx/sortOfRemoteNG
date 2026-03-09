//! Health monitoring — overall health rollup, component status.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;

/// Server health rollup and component status.
pub struct HealthManager<'a> {
    client: &'a IdracClient,
}

impl<'a> HealthManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// Get overall server health rollup.
    pub async fn get_health_rollup(&self) -> IdracResult<ServerHealthRollup> {
        if let Ok(rf) = self.client.require_redfish() {
            let sys: serde_json::Value = rf.get("/redfish/v1/Systems/System.Embedded.1").await?;

            let chassis: serde_json::Value = rf
                .get("/redfish/v1/Chassis/System.Embedded.1")
                .await
                .unwrap_or_default();

            let mgr: serde_json::Value = rf
                .get("/redfish/v1/Managers/iDRAC.Embedded.1")
                .await
                .unwrap_or_default();

            return Ok(ServerHealthRollup {
                overall_health: sys
                    .pointer("/Status/HealthRollup")
                    .or_else(|| sys.pointer("/Status/Health"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                system_health: ComponentHealth {
                    health: sys
                        .pointer("/Status/Health")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    health_rollup: sys
                        .pointer("/Status/HealthRollup")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    state: sys
                        .pointer("/Status/State")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                },
                chassis_health: ComponentHealth {
                    health: chassis
                        .pointer("/Status/Health")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    health_rollup: chassis
                        .pointer("/Status/HealthRollup")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    state: chassis
                        .pointer("/Status/State")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                },
                idrac_health: ComponentHealth {
                    health: mgr
                        .pointer("/Status/Health")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    health_rollup: mgr
                        .pointer("/Status/HealthRollup")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    state: mgr
                        .pointer("/Status/State")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                },
                processor_health: ComponentHealth {
                    health: sys
                        .pointer("/ProcessorSummary/Status/Health")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    health_rollup: sys
                        .pointer("/ProcessorSummary/Status/HealthRollup")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    state: sys
                        .pointer("/ProcessorSummary/Status/State")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                },
                memory_health: ComponentHealth {
                    health: sys
                        .pointer("/MemorySummary/Status/Health")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    health_rollup: sys
                        .pointer("/MemorySummary/Status/HealthRollup")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    state: sys
                        .pointer("/MemorySummary/Status/State")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                },
                storage_health: None,
                network_health: None,
                power_state: sys
                    .get("PowerState")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                indicator_led: sys
                    .get("IndicatorLED")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            });
        }

        if let Ok(ipmi) = self.client.require_ipmi() {
            let status = ipmi.get_chassis_status().await?;
            return Ok(ServerHealthRollup {
                overall_health: Some(if status.fault { "Critical" } else { "OK" }.to_string()),
                system_health: ComponentHealth {
                    health: Some(if status.fault { "Critical" } else { "OK" }.to_string()),
                    health_rollup: None,
                    state: Some(
                        if status.power_on {
                            "Enabled"
                        } else {
                            "StandbyOffline"
                        }
                        .to_string(),
                    ),
                },
                chassis_health: ComponentHealth::default(),
                idrac_health: ComponentHealth::default(),
                processor_health: ComponentHealth::default(),
                memory_health: ComponentHealth::default(),
                storage_health: None,
                network_health: None,
                power_state: Some(if status.power_on { "On" } else { "Off" }.to_string()),
                indicator_led: None,
            });
        }

        Err(IdracError::unsupported("Health requires Redfish or IPMI"))
    }

    /// Get component-level health details.
    pub async fn get_component_health(&self) -> IdracResult<Vec<(String, ComponentHealth)>> {
        let rf = self.client.require_redfish()?;

        let mut components = Vec::new();

        // System
        if let Ok(sys) = rf
            .get::<serde_json::Value>("/redfish/v1/Systems/System.Embedded.1")
            .await
        {
            components.push((
                "System".to_string(),
                ComponentHealth {
                    health: sys
                        .pointer("/Status/Health")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    health_rollup: sys
                        .pointer("/Status/HealthRollup")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    state: sys
                        .pointer("/Status/State")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                },
            ));

            components.push((
                "Processors".to_string(),
                ComponentHealth {
                    health: sys
                        .pointer("/ProcessorSummary/Status/Health")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    health_rollup: sys
                        .pointer("/ProcessorSummary/Status/HealthRollup")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    state: sys
                        .pointer("/ProcessorSummary/Status/State")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                },
            ));

            components.push((
                "Memory".to_string(),
                ComponentHealth {
                    health: sys
                        .pointer("/MemorySummary/Status/Health")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    health_rollup: sys
                        .pointer("/MemorySummary/Status/HealthRollup")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    state: sys
                        .pointer("/MemorySummary/Status/State")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                },
            ));
        }

        // Chassis
        if let Ok(chassis) = rf
            .get::<serde_json::Value>("/redfish/v1/Chassis/System.Embedded.1")
            .await
        {
            components.push((
                "Chassis".to_string(),
                ComponentHealth {
                    health: chassis
                        .pointer("/Status/Health")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    health_rollup: chassis
                        .pointer("/Status/HealthRollup")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    state: chassis
                        .pointer("/Status/State")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                },
            ));
        }

        // Power
        if let Ok(power) = rf
            .get::<serde_json::Value>("/redfish/v1/Chassis/System.Embedded.1/Power")
            .await
        {
            if let Some(psus) = power.get("PowerSupplies").and_then(|v| v.as_array()) {
                for (i, psu) in psus.iter().enumerate() {
                    components.push((
                        format!("PSU {}", i),
                        ComponentHealth {
                            health: psu
                                .pointer("/Status/Health")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            health_rollup: None,
                            state: psu
                                .pointer("/Status/State")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        },
                    ));
                }
            }
        }

        // iDRAC
        if let Ok(mgr) = rf
            .get::<serde_json::Value>("/redfish/v1/Managers/iDRAC.Embedded.1")
            .await
        {
            components.push((
                "iDRAC".to_string(),
                ComponentHealth {
                    health: mgr
                        .pointer("/Status/Health")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    health_rollup: mgr
                        .pointer("/Status/HealthRollup")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    state: mgr
                        .pointer("/Status/State")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                },
            ));
        }

        Ok(components)
    }

    /// Check if server is in a healthy state (no Critical components).
    pub async fn is_healthy(&self) -> IdracResult<bool> {
        let rollup = self.get_health_rollup().await?;
        Ok(rollup.overall_health.as_deref() == Some("OK"))
    }
}
