//! Thermal management for Supermicro BMCs.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct ThermalManager;

impl ThermalManager {
    /// Get thermal data — temperatures and fans (Redfish → legacy web sensors).
    pub async fn get_thermal_data(client: &SmcClient) -> SmcResult<ThermalData> {
        if let Some(ref rf) = client.redfish {
            return rf.get_thermal_data().await;
        }
        // Legacy web — parse sensor data into thermal format
        if let Some(ref web) = client.legacy_web {
            let sensors = web.get_sensor_data().await?;
            return parse_sensor_thermal(&sensors);
        }
        Err(crate::error::SmcError::thermal("No protocol available for thermal data"))
    }

    /// Get aggregated thermal summary.
    pub async fn get_thermal_summary(client: &SmcClient) -> SmcResult<ThermalSummary> {
        let thermal = Self::get_thermal_data(client).await?;

        let ambient = thermal.temperatures.iter()
            .find(|t| t.name.contains("Ambient") || t.name.contains("Inlet") || t.name.contains("System"))
            .and_then(|t| t.reading_celsius);

        let cpu_max = thermal.temperatures.iter()
            .filter(|t| t.name.contains("CPU") || t.name.contains("Processor"))
            .filter_map(|t| t.reading_celsius)
            .fold(None, |acc: Option<f64>, val| Some(acc.map_or(val, |a| a.max(val))));

        let dimm_max = thermal.temperatures.iter()
            .filter(|t| t.name.contains("DIMM") || t.name.contains("Memory"))
            .filter_map(|t| t.reading_celsius)
            .fold(None, |acc: Option<f64>, val| Some(acc.map_or(val, |a| a.max(val))));

        let fan_count = thermal.fans.len() as u32;
        let fans_ok = thermal.fans.iter().filter(|f| f.status == "OK").count() as u32;
        let fans_warning = thermal.fans.iter().filter(|f| f.status == "Warning").count() as u32;
        let fans_critical = thermal.fans.iter().filter(|f| f.status == "Critical").count() as u32;

        let overall_status = if fans_critical > 0 || thermal.temperatures.iter().any(|t| t.status == "Critical") {
            "Critical"
        } else if fans_warning > 0 || thermal.temperatures.iter().any(|t| t.status == "Warning") {
            "Warning"
        } else {
            "OK"
        };

        Ok(ThermalSummary {
            ambient_temp_celsius: ambient,
            cpu_max_temp_celsius: cpu_max,
            dimm_max_temp_celsius: dimm_max,
            fan_count,
            fans_ok,
            fans_warning,
            fans_critical,
            overall_status: overall_status.to_string(),
        })
    }
}

/// Parse legacy sensor data into ThermalData.
fn parse_sensor_thermal(sensors: &serde_json::Value) -> SmcResult<ThermalData> {
    let mut temperatures = Vec::new();
    let mut fans = Vec::new();

    if let Some(arr) = sensors.get("Sensors")
        .or_else(|| sensors.get("sensors"))
        .and_then(|v| v.as_array())
    {
        for sensor in arr {
            let name = sensor.get("Name")
                .or_else(|| sensor.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();
            let reading = sensor.get("Reading")
                .or_else(|| sensor.get("reading"))
                .and_then(|v| v.as_f64());
            let sensor_type = sensor.get("Type")
                .or_else(|| sensor.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let status = sensor.get("Status")
                .or_else(|| sensor.get("status"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();

            match sensor_type {
                "Temperature" | "temperature" => {
                    temperatures.push(TemperatureReading {
                        name,
                        reading_celsius: reading,
                        upper_warning: None,
                        upper_critical: None,
                        upper_fatal: None,
                        lower_warning: None,
                        lower_critical: None,
                        status,
                        location: None,
                    });
                }
                "Fan" | "fan" => {
                    fans.push(FanReading {
                        name,
                        reading_rpm: reading.map(|v| v as u32),
                        reading_percent: None,
                        status,
                        location: None,
                        redundancy: None,
                    });
                }
                _ => {}
            }
        }
    }

    Ok(ThermalData { temperatures, fans })
}
