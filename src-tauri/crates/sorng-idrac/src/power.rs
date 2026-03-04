//! Power management — power actions, PSU info, power consumption.
//!
//! Supports Redfish, WSMAN, and IPMI for power operations.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;
use crate::wsman::dcim_classes;

/// Power management operations.
pub struct PowerManager<'a> {
    client: &'a IdracClient,
}

impl<'a> PowerManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// Execute a power action (on, off, restart, etc.).
    pub async fn power_action(&self, action: PowerAction) -> IdracResult<()> {
        // Try Redfish first
        if let Ok(rf) = self.client.require_redfish() {
            let body = serde_json::json!({
                "ResetType": action.to_redfish()
            });
            rf.post_action(
                "/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset",
                &body,
            )
            .await?;
            return Ok(());
        }

        // WSMAN fallback
        if let Ok(ws) = self.client.require_wsman() {
            let state = action.to_wsman_state();
            ws.invoke(
                "CIM_ComputerSystem",
                "RequestStateChange",
                &[("CreationClassName", "DCIM_ComputerSystem"), ("Name", "srv:system")],
                &[("RequestedState", &state.to_string())],
            )
            .await?;
            return Ok(());
        }

        // IPMI fallback
        if let Ok(ipmi) = self.client.require_ipmi() {
            match action {
                PowerAction::On => ipmi.power_on().await?,
                PowerAction::ForceOff => ipmi.power_off().await?,
                PowerAction::PowerCycle => ipmi.power_cycle().await?,
                PowerAction::ForceRestart => ipmi.power_reset().await?,
                PowerAction::GracefulShutdown => ipmi.soft_shutdown().await?,
                PowerAction::GracefulRestart => ipmi.power_reset().await?,
                _ => {
                    return Err(IdracError::unsupported(format!(
                        "IPMI does not support power action: {:?}",
                        action
                    )));
                }
            }
            return Ok(());
        }

        Err(IdracError::unsupported("No protocol available for power action"))
    }

    /// Get current power state.
    pub async fn get_power_state(&self) -> IdracResult<String> {
        if let Ok(rf) = self.client.require_redfish() {
            let sys: serde_json::Value = rf
                .get("/redfish/v1/Systems/System.Embedded.1")
                .await?;
            return Ok(sys
                .get("PowerState")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string());
        }

        if let Ok(ipmi) = self.client.require_ipmi() {
            let status = ipmi.get_chassis_status().await?;
            return Ok(if status.power_on { "On" } else { "Off" }.to_string());
        }

        Err(IdracError::unsupported("No protocol available for power state"))
    }

    /// Get power consumption metrics.
    pub async fn get_power_metrics(&self) -> IdracResult<PowerMetrics> {
        if let Ok(rf) = self.client.require_redfish() {
            // iDRAC 9 path
            let power: serde_json::Value = rf
                .get("/redfish/v1/Chassis/System.Embedded.1/Power")
                .await?;

            let pc = power.get("PowerControl").and_then(|v| v.as_array()).and_then(|a| a.first());

            return Ok(PowerMetrics {
                current_watts: pc
                    .and_then(|p| p.get("PowerConsumedWatts"))
                    .and_then(|v| v.as_f64()),
                min_watts: pc
                    .and_then(|p| p.pointer("/PowerMetrics/MinConsumedWatts"))
                    .and_then(|v| v.as_f64()),
                max_watts: pc
                    .and_then(|p| p.pointer("/PowerMetrics/MaxConsumedWatts"))
                    .and_then(|v| v.as_f64()),
                average_watts: pc
                    .and_then(|p| p.pointer("/PowerMetrics/AverageConsumedWatts"))
                    .and_then(|v| v.as_f64()),
                power_cap_watts: pc
                    .and_then(|p| p.get("PowerLimit"))
                    .and_then(|l| l.get("LimitInWatts"))
                    .and_then(|v| v.as_f64()),
                power_cap_enabled: pc
                    .and_then(|p| p.get("PowerLimit"))
                    .and_then(|l| l.get("LimitInWatts"))
                    .and_then(|v| v.as_f64())
                    .map(|w| w > 0.0)
                    .unwrap_or(false),
            });
        }

        Err(IdracError::unsupported("Power metrics require Redfish"))
    }

    /// List power supply units.
    pub async fn list_power_supplies(&self) -> IdracResult<Vec<PowerSupply>> {
        if let Ok(rf) = self.client.require_redfish() {
            let power: serde_json::Value = rf
                .get("/redfish/v1/Chassis/System.Embedded.1/Power")
                .await?;

            let psus = power
                .get("PowerSupplies")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            return Ok(psus
                .iter()
                .map(|p| PowerSupply {
                    id: p.get("MemberId").or_else(|| p.get("Name")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    name: p.get("Name").and_then(|v| v.as_str()).unwrap_or("PSU").to_string(),
                    model: p.get("Model").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    serial_number: p.get("SerialNumber").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    firmware_version: p.get("FirmwareVersion").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    status: ComponentHealth {
                        health: p.pointer("/Status/Health").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        health_rollup: p.pointer("/Status/HealthRollup").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        state: p.pointer("/Status/State").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    },
                    capacity_watts: p.get("PowerCapacityWatts").and_then(|v| v.as_f64()),
                    input_voltage: p.get("LineInputVoltage").and_then(|v| v.as_f64()),
                    output_watts: p.get("PowerOutputWatts").or_else(|| p.get("LastPowerOutputWatts")).and_then(|v| v.as_f64()),
                    line_input_voltage_type: p.get("LineInputVoltageType").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    power_supply_type: p.get("PowerSupplyType").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    manufacturer: p.get("Manufacturer").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    part_number: p.get("PartNumber").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    spare_part_number: p.get("SparePartNumber").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    efficiency_rating: p.get("EfficiencyPercent").and_then(|v| v.as_f64()),
                })
                .collect());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::POWER_SUPPLY_VIEW).await?;
            return Ok(views
                .iter()
                .map(|v| {
                    let get = |k: &str| v.properties.get(k).and_then(|val| val.as_str()).map(|s| s.to_string());
                    PowerSupply {
                        id: get("FQDD").unwrap_or_default(),
                        name: get("DeviceDescription").unwrap_or_else(|| "PSU".to_string()),
                        model: get("Model"),
                        serial_number: get("SerialNumber"),
                        firmware_version: get("FirmwareVersion"),
                        status: ComponentHealth {
                            health: get("PrimaryStatus"),
                            health_rollup: None,
                            state: None,
                        },
                        capacity_watts: v.properties.get("TotalOutputPower").and_then(|val| val.as_f64()),
                        input_voltage: v.properties.get("InputVoltage").and_then(|val| val.as_f64()),
                        output_watts: v.properties.get("CurrentOutputPower").and_then(|val| val.as_f64()),
                        line_input_voltage_type: get("InputVoltageType"),
                        power_supply_type: get("Type"),
                        manufacturer: get("Manufacturer"),
                        part_number: get("PartNumber"),
                        spare_part_number: None,
                        efficiency_rating: None,
                    }
                })
                .collect());
        }

        Err(IdracError::unsupported("No protocol available for PSU listing"))
    }

    /// Set power cap (watts). Set to 0 to disable.
    pub async fn set_power_cap(&self, watts: f64) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;
        let body = if watts > 0.0 {
            serde_json::json!({
                "PowerControl": [{
                    "PowerLimit": {
                        "LimitInWatts": watts,
                        "LimitException": "LogEventOnly"
                    }
                }]
            })
        } else {
            serde_json::json!({
                "PowerControl": [{
                    "PowerLimit": {
                        "LimitInWatts": null
                    }
                }]
            })
        };
        rf.patch_json("/redfish/v1/Chassis/System.Embedded.1/Power", &body).await
    }
}
