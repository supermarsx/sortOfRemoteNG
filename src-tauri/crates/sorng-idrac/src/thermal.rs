//! Thermal management — temperatures, fans, cooling profiles.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;
use crate::wsman::dcim_classes;

/// Thermal monitoring and fan management.
pub struct ThermalManager<'a> {
    client: &'a IdracClient,
}

impl<'a> ThermalManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// Get all thermal data (temperatures + fans).
    pub async fn get_thermal_data(&self) -> IdracResult<ThermalData> {
        if let Ok(rf) = self.client.require_redfish() {
            let thermal: serde_json::Value = rf
                .get("/redfish/v1/Chassis/System.Embedded.1/Thermal")
                .await?;

            let temps = thermal
                .get("Temperatures")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            let fans = thermal
                .get("Fans")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            return Ok(ThermalData {
                temperatures: temps
                    .iter()
                    .map(|t| TemperatureSensor {
                        name: t
                            .get("Name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Sensor")
                            .to_string(),
                        reading_celsius: t.get("ReadingCelsius").and_then(|v| v.as_f64()),
                        upper_threshold_non_critical: t
                            .get("UpperThresholdNonCritical")
                            .and_then(|v| v.as_f64()),
                        upper_threshold_critical: t
                            .get("UpperThresholdCritical")
                            .and_then(|v| v.as_f64()),
                        upper_threshold_fatal: t
                            .get("UpperThresholdFatal")
                            .and_then(|v| v.as_f64()),
                        lower_threshold_non_critical: t
                            .get("LowerThresholdNonCritical")
                            .and_then(|v| v.as_f64()),
                        lower_threshold_critical: t
                            .get("LowerThresholdCritical")
                            .and_then(|v| v.as_f64()),
                        status: ComponentHealth {
                            health: t
                                .pointer("/Status/Health")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            health_rollup: None,
                            state: t
                                .pointer("/Status/State")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        },
                        physical_context: t
                            .get("PhysicalContext")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        sensor_number: t
                            .get("SensorNumber")
                            .and_then(|v| v.as_u64())
                            .map(|n| n as u32),
                        member_id: t
                            .get("MemberId")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    })
                    .collect(),
                fans: fans
                    .iter()
                    .map(|f| Fan {
                        name: f
                            .get("Name")
                            .or_else(|| f.get("FanName"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Fan")
                            .to_string(),
                        reading_rpm: f
                            .get("Reading")
                            .and_then(|v| v.as_f64())
                            .or_else(|| f.get("CurrentReading").and_then(|v| v.as_f64())),
                        reading_percent: None,
                        lower_threshold_non_critical: f
                            .get("LowerThresholdNonCritical")
                            .and_then(|v| v.as_f64()),
                        lower_threshold_critical: f
                            .get("LowerThresholdCritical")
                            .and_then(|v| v.as_f64()),
                        upper_threshold_non_critical: f
                            .get("UpperThresholdNonCritical")
                            .and_then(|v| v.as_f64()),
                        upper_threshold_critical: f
                            .get("UpperThresholdCritical")
                            .and_then(|v| v.as_f64()),
                        status: ComponentHealth {
                            health: f
                                .pointer("/Status/Health")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            health_rollup: None,
                            state: f
                                .pointer("/Status/State")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        },
                        physical_context: f
                            .get("PhysicalContext")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        member_id: f
                            .get("MemberId")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        hot_pluggable: f.get("HotPluggable").and_then(|v| v.as_bool()),
                    })
                    .collect(),
            });
        }

        if let Ok(ws) = self.client.require_wsman() {
            let fan_views = ws.enumerate(dcim_classes::FAN_VIEW).await?;
            let sensor_views = ws.enumerate(dcim_classes::NUMERIC_SENSOR_VIEW).await?;

            let fans: Vec<Fan> = fan_views
                .iter()
                .map(|v| {
                    let get = |k: &str| {
                        v.properties
                            .get(k)
                            .and_then(|val| val.as_str())
                            .map(|s| s.to_string())
                    };
                    Fan {
                        name: get("DeviceDescription").unwrap_or_else(|| "Fan".to_string()),
                        reading_rpm: v
                            .properties
                            .get("CurrentReading")
                            .and_then(|val| val.as_f64()),
                        reading_percent: None,
                        lower_threshold_non_critical: v
                            .properties
                            .get("LowerThresholdNonCritical")
                            .and_then(|val| val.as_f64()),
                        lower_threshold_critical: v
                            .properties
                            .get("LowerThresholdCritical")
                            .and_then(|val| val.as_f64()),
                        upper_threshold_non_critical: v
                            .properties
                            .get("UpperThresholdNonCritical")
                            .and_then(|val| val.as_f64()),
                        upper_threshold_critical: v
                            .properties
                            .get("UpperThresholdCritical")
                            .and_then(|val| val.as_f64()),
                        status: ComponentHealth {
                            health: get("PrimaryStatus"),
                            health_rollup: None,
                            state: None,
                        },
                        physical_context: get("Location"),
                        member_id: get("FQDD"),
                        hot_pluggable: None,
                    }
                })
                .collect();

            let temps: Vec<TemperatureSensor> = sensor_views
                .iter()
                .filter(|v| {
                    v.properties
                        .get("SensorType")
                        .and_then(|val| val.as_str())
                        .map(|s| s.contains("Temperature") || s == "1")
                        .unwrap_or(false)
                })
                .map(|v| {
                    let get = |k: &str| {
                        v.properties
                            .get(k)
                            .and_then(|val| val.as_str())
                            .map(|s| s.to_string())
                    };
                    TemperatureSensor {
                        name: get("DeviceDescription").unwrap_or_else(|| "Sensor".to_string()),
                        reading_celsius: v
                            .properties
                            .get("CurrentReading")
                            .and_then(|val| val.as_f64()),
                        upper_threshold_non_critical: v
                            .properties
                            .get("UpperThresholdNonCritical")
                            .and_then(|val| val.as_f64()),
                        upper_threshold_critical: v
                            .properties
                            .get("UpperCriticalThreshold")
                            .and_then(|val| val.as_f64()),
                        upper_threshold_fatal: None,
                        lower_threshold_non_critical: None,
                        lower_threshold_critical: None,
                        status: ComponentHealth {
                            health: get("PrimaryStatus"),
                            health_rollup: None,
                            state: None,
                        },
                        physical_context: get("Location"),
                        sensor_number: None,
                        member_id: get("FQDD"),
                    }
                })
                .collect();

            return Ok(ThermalData {
                temperatures: temps,
                fans,
            });
        }

        Err(IdracError::unsupported(
            "Thermal data requires Redfish or WSMAN",
        ))
    }

    /// Get thermal summary (hottest temp, average, fan status).
    pub async fn get_thermal_summary(&self) -> IdracResult<ThermalSummary> {
        let data = self.get_thermal_data().await?;

        let active_temps: Vec<f64> = data
            .temperatures
            .iter()
            .filter_map(|t| t.reading_celsius)
            .filter(|&t| t > 0.0 && t < 200.0) // filter invalid
            .collect();

        let inlet_temp = data
            .temperatures
            .iter()
            .find(|t| {
                t.name.to_lowercase().contains("inlet")
                    || t.physical_context.as_deref() == Some("Intake")
            })
            .and_then(|t| t.reading_celsius);

        let exhaust_temp = data
            .temperatures
            .iter()
            .find(|t| {
                t.name.to_lowercase().contains("exhaust")
                    || t.physical_context.as_deref() == Some("Exhaust")
            })
            .and_then(|t| t.reading_celsius);

        let max_temp = active_temps
            .iter()
            .cloned()
            .fold(f64::NEG_INFINITY, f64::max);
        let avg_temp = if active_temps.is_empty() {
            None
        } else {
            Some(active_temps.iter().sum::<f64>() / active_temps.len() as f64)
        };

        let fan_count = data.fans.len() as u32;
        let fans_ok = data.fans.iter().all(|f| {
            f.status
                .health
                .as_deref()
                .map(|h| h == "OK")
                .unwrap_or(true)
        });

        Ok(ThermalSummary {
            inlet_temp_celsius: inlet_temp,
            exhaust_temp_celsius: exhaust_temp,
            max_temp_celsius: if max_temp > f64::NEG_INFINITY {
                Some(max_temp)
            } else {
                None
            },
            avg_temp_celsius: avg_temp,
            fan_count,
            fans_healthy: fans_ok,
            sensor_count: data.temperatures.len() as u32,
        })
    }

    /// Set fan offset (Dell OEM — requires Redfish).
    pub async fn set_fan_offset(&self, offset: i32) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;
        let body = serde_json::json!({
            "FanPWMOffset": offset
        });
        rf.patch_json(
            "/redfish/v1/Managers/iDRAC.Embedded.1/Oem/Dell/DellAttributes",
            &body,
        )
        .await
    }
}
