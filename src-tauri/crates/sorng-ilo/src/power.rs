//! Power management — status, on/off/reset/cycle, metrics, supply details.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Power management operations.
pub struct PowerManager<'a> {
    client: &'a IloClient,
}

impl<'a> PowerManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get current power state.
    pub async fn get_power_state(&self) -> IloResult<String> {
        if let Ok(rf) = self.client.require_redfish() {
            let sys: serde_json::Value = rf.get_system().await?;
            return Ok(sys
                .get("PowerState")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string());
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let data = ribcl.get_host_data().await?;
            return Ok(data
                .get("HOST_POWER")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string());
        }

        if let Ok(ipmi) = self.client.require_ipmi() {
            let status = ipmi.get_chassis_status().await?;
            return Ok(if status.power_on {
                "On".to_string()
            } else {
                "Off".to_string()
            });
        }

        Err(IloError::unsupported(
            "No protocol available for power state",
        ))
    }

    /// Execute a power action.
    pub async fn power_action(&self, action: PowerAction) -> IloResult<()> {
        // Try Redfish
        if let Ok(rf) = self.client.require_redfish() {
            rf.power_action(action.to_redfish()).await?;
            return Ok(());
        }

        // RIBCL fallback — map power actions
        if let Ok(ribcl) = self.client.require_ribcl() {
            match action {
                PowerAction::On => ribcl.set_host_power_on().await?,
                PowerAction::GracefulShutdown => ribcl.press_power_button().await?,
                PowerAction::ForceOff => ribcl.hold_power_button().await?,
                PowerAction::ForceRestart => ribcl.warm_boot().await?,
                PowerAction::Nmi => {
                    return Err(IloError::unsupported("NMI not supported via RIBCL"))
                }
                PowerAction::PushPowerButton => ribcl.press_power_button().await?,
                PowerAction::GracefulRestart => ribcl.warm_boot().await?,
                PowerAction::PowerCycle => ribcl.cold_boot().await?,
            };
            return Ok(());
        }

        // IPMI fallback
        if let Ok(ipmi) = self.client.require_ipmi() {
            let cmd = action.to_ipmi();
            ipmi.chassis_control(cmd).await?;
            return Ok(());
        }

        Err(IloError::unsupported(
            "No protocol available for power action",
        ))
    }

    /// Get power metrics (consumption, supplies).
    pub async fn get_power_metrics(&self) -> IloResult<BmcPowerMetrics> {
        if let Ok(rf) = self.client.require_redfish() {
            let pwr: serde_json::Value = rf.get_power().await?;

            let current_watts = pwr
                .pointer("/PowerControl/0/PowerConsumedWatts")
                .and_then(|v| v.as_f64());

            let min_watts = pwr
                .pointer("/PowerControl/0/PowerMetrics/MinConsumedWatts")
                .and_then(|v| v.as_f64());

            let max_watts = pwr
                .pointer("/PowerControl/0/PowerMetrics/MaxConsumedWatts")
                .and_then(|v| v.as_f64());

            let avg_watts = pwr
                .pointer("/PowerControl/0/PowerMetrics/AverageConsumedWatts")
                .and_then(|v| v.as_f64());

            let supplies: Vec<_> = pwr
                .get("PowerSupplies")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|ps| BmcPowerSupply {
                            id: ps
                                .get("MemberId")
                                .or_else(|| ps.get("Name"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            name: ps
                                .get("Name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("PSU")
                                .to_string(),
                            model: ps
                                .get("Model")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            serial_number: ps
                                .get("SerialNumber")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            firmware_version: ps
                                .get("FirmwareVersion")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            status: component_health(
                                ps.get("Status")
                                    .and_then(|s| s.get("Health"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Unknown"),
                            ),
                            capacity_watts: ps.get("PowerCapacityWatts").and_then(|v| v.as_f64()),
                            input_voltage: ps.get("LineInputVoltage").and_then(|v| v.as_f64()),
                            output_watts: ps.get("LastPowerOutputWatts").and_then(|v| v.as_f64()),
                            manufacturer: ps
                                .get("Manufacturer")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            part_number: ps
                                .get("PartNumber")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            efficiency_rating: None,
                        })
                        .collect()
                })
                .unwrap_or_default();

            let _ = supplies; // power supplies tracked separately

            return Ok(BmcPowerMetrics {
                current_watts,
                min_watts,
                max_watts,
                average_watts: avg_watts,
                power_cap_watts: pwr
                    .pointer("/PowerControl/0/PowerLimit/LimitInWatts")
                    .and_then(|v| v.as_f64()),
                power_cap_enabled: pwr
                    .pointer("/PowerControl/0/PowerLimit/LimitInWatts")
                    .is_some(),
            });
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let data = ribcl.get_power_readings().await?;
            let current = data
                .get("PRESENT_POWER_READING")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<f64>().ok());

            return Ok(BmcPowerMetrics {
                current_watts: current,
                min_watts: None,
                max_watts: None,
                average_watts: data
                    .get("AVERAGE_POWER_READING")
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.parse::<f64>().ok()),
                power_cap_watts: None,
                power_cap_enabled: false,
            });
        }

        Err(IloError::unsupported(
            "No protocol available for power metrics",
        ))
    }
}
