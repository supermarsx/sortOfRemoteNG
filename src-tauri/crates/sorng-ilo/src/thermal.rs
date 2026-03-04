//! Thermal monitoring — temperatures, fans, thresholds.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Thermal monitoring operations.
pub struct ThermalManager<'a> {
    client: &'a IloClient,
}

impl<'a> ThermalManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get full thermal data (temps + fans).
    pub async fn get_thermal_data(&self) -> IloResult<BmcThermalData> {
        if let Ok(rf) = self.client.require_redfish() {
            let thermal: serde_json::Value = rf.get_thermal().await?;

            let temperatures = thermal.get("Temperatures")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|t| {
                    let name = t.get("Name").and_then(|v| v.as_str())?;
                    Some(BmcTemperatureSensor {
                        name: name.to_string(),
                        reading_celsius: t.get("ReadingCelsius").and_then(|v| v.as_f64()),
                        upper_threshold_critical: t.get("UpperThresholdCritical").and_then(|v| v.as_f64()),
                        upper_threshold_fatal: t.get("UpperThresholdFatal").and_then(|v| v.as_f64()),
                        status: t.get("Status").and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str()).unwrap_or("Unknown").to_string(),
                        location: t.get("PhysicalContext")
                            .and_then(|v| v.as_str()).map(|s| s.to_string()),
                    })
                }).collect())
                .unwrap_or_default();

            let fans = thermal.get("Fans")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|f| {
                    let name = f.get("Name").and_then(|v| v.as_str())?;
                    Some(BmcFan {
                        name: name.to_string(),
                        reading: f.get("Reading").and_then(|v| v.as_f64()),
                        reading_units: f.get("ReadingUnits")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Percent").to_string(),
                        status: f.get("Status").and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str()).unwrap_or("Unknown").to_string(),
                    })
                }).collect())
                .unwrap_or_default();

            return Ok(BmcThermalData { temperatures, fans });
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let health = ribcl.get_embedded_health().await?;
            let mut temperatures = Vec::new();
            let mut fans = Vec::new();

            if let Some(temp_arr) = health.get("TEMPERATURE").and_then(|v| v.as_array()) {
                for t in temp_arr {
                    let label = t.get("LABEL").and_then(|v| v.as_str()).unwrap_or("Sensor");
                    let reading = t.get("CURRENTREADING")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<f64>().ok());
                    let caution = t.get("CAUTION")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<f64>().ok());
                    let critical = t.get("CRITICAL")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<f64>().ok());
                    let status = t.get("STATUS").and_then(|v| v.as_str()).unwrap_or("Unknown");

                    temperatures.push(BmcTemperatureSensor {
                        name: label.to_string(),
                        reading_celsius: reading,
                        upper_threshold_critical: caution,
                        upper_threshold_fatal: critical,
                        status: status.to_string(),
                        location: t.get("LOCATION").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    });
                }
            }

            if let Some(fan_arr) = health.get("FANS").and_then(|v| v.as_array()) {
                for f in fan_arr {
                    let label = f.get("LABEL").and_then(|v| v.as_str()).unwrap_or("Fan");
                    let speed = f.get("SPEED")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<f64>().ok());
                    let status = f.get("STATUS").and_then(|v| v.as_str()).unwrap_or("Unknown");
                    let unit = f.get("UNIT")
                        .and_then(|v| v.as_str()).unwrap_or("Percent");

                    fans.push(BmcFan {
                        name: label.to_string(),
                        reading: speed,
                        reading_units: unit.to_string(),
                        status: status.to_string(),
                    });
                }
            }

            return Ok(BmcThermalData { temperatures, fans });
        }

        Err(IloError::unsupported("No protocol available for thermal data"))
    }

    /// Get thermal summary (aggregate highs/lows/alerts).
    pub async fn get_thermal_summary(&self) -> IloResult<ThermalSummary> {
        let data = self.get_thermal_data().await?;

        let mut ambient: Option<f64> = None;
        let mut cpu_max: Option<f64> = None;
        let mut fan_min: Option<f64> = None;
        let mut fan_max: Option<f64> = None;
        let mut alerts = 0u32;

        for t in &data.temperatures {
            if let Some(reading) = t.reading_celsius {
                let lower = t.name.to_lowercase();
                if lower.contains("ambient") || lower.contains("inlet") {
                    ambient = Some(reading);
                }
                if lower.contains("cpu") || lower.contains("proc") {
                    cpu_max = Some(cpu_max.map_or(reading, |cur: f64| cur.max(reading)));
                }
            }
            if t.status == "Critical" || t.status == "Warning" {
                alerts += 1;
            }
        }

        for f in &data.fans {
            if let Some(reading) = f.reading {
                fan_min = Some(fan_min.map_or(reading, |cur: f64| cur.min(reading)));
                fan_max = Some(fan_max.map_or(reading, |cur: f64| cur.max(reading)));
            }
        }

        Ok(ThermalSummary {
            ambient_temp_celsius: ambient,
            cpu_temp_max_celsius: cpu_max,
            fan_speed_min_percent: fan_min,
            fan_speed_max_percent: fan_max,
            thermal_alerts: alerts,
        })
    }
}
