//! Telemetry — power/thermal metrics over time, Dell OEM telemetry.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;

/// Server telemetry and metrics collection.
pub struct TelemetryManager<'a> {
    client: &'a IdracClient,
}

impl<'a> TelemetryManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// Get power telemetry (consumption over time).
    pub async fn get_power_telemetry(&self) -> IdracResult<PowerTelemetry> {
        let rf = self.client.require_redfish()?;

        let power: serde_json::Value = rf
            .get("/redfish/v1/Chassis/System.Embedded.1/Power")
            .await?;

        let pc = power.get("PowerControl").and_then(|v| v.as_array()).and_then(|a| a.first());

        let current_watts = pc
            .and_then(|p| p.get("PowerConsumedWatts"))
            .and_then(|v| v.as_f64());
        let min_watts = pc
            .and_then(|p| p.pointer("/PowerMetrics/MinConsumedWatts"))
            .and_then(|v| v.as_f64());
        let max_watts = pc
            .and_then(|p| p.pointer("/PowerMetrics/MaxConsumedWatts"))
            .and_then(|v| v.as_f64());
        let avg_watts = pc
            .and_then(|p| p.pointer("/PowerMetrics/AverageConsumedWatts"))
            .and_then(|v| v.as_f64());
        let interval_minutes = pc
            .and_then(|p| p.pointer("/PowerMetrics/IntervalInMin"))
            .and_then(|v| v.as_u64())
            .map(|n| n as u32);

        // Try Dell OEM telemetry endpoint for historical data
        let history = if let Ok(tel) = rf
            .get::<serde_json::Value>("/redfish/v1/TelemetryService/MetricReports/PowerMetrics")
            .await
        {
            tel.get("MetricValues")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .map(|m| TelemetryDataPoint {
                            timestamp: m.get("Timestamp").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            value: m.get("MetricValue").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()),                            label: None,                            metric_id: m.get("MetricId").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        Ok(PowerTelemetry {
            current_watts,
            min_watts,
            max_watts,
            avg_watts,
            interval_minutes,
            history,
            timestamp: Some(chrono::Utc::now().to_rfc3339()),
        })
    }

    /// Get thermal telemetry.
    pub async fn get_thermal_telemetry(&self) -> IdracResult<ThermalTelemetry> {
        let rf = self.client.require_redfish()?;

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

        let inlet = temps
            .iter()
            .find(|t| {
                t.get("Name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_lowercase().contains("inlet"))
                    .unwrap_or(false)
            })
            .and_then(|t| t.get("ReadingCelsius").and_then(|v| v.as_f64()));

        let exhaust = temps
            .iter()
            .find(|t| {
                t.get("Name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_lowercase().contains("exhaust"))
                    .unwrap_or(false)
            })
            .and_then(|t| t.get("ReadingCelsius").and_then(|v| v.as_f64()));

        let sensor_readings: Vec<TelemetryDataPoint> = temps
            .iter()
            .filter_map(|t| {
                let name = t.get("Name").and_then(|v| v.as_str()).map(|s| s.to_string());
                let reading = t.get("ReadingCelsius").and_then(|v| v.as_f64());
                reading.map(|r| TelemetryDataPoint {
                    timestamp: Some(chrono::Utc::now().to_rfc3339()),
                    value: Some(r),
                    label: None,
                    metric_id: name,
                })
            })
            .collect();

        let fan_readings: Vec<TelemetryDataPoint> = fans
            .iter()
            .filter_map(|f| {
                let name = f.get("Name").or_else(|| f.get("FanName")).and_then(|v| v.as_str()).map(|s| s.to_string());
                let reading = f.get("Reading").and_then(|v| v.as_f64());
                reading.map(|r| TelemetryDataPoint {
                    timestamp: Some(chrono::Utc::now().to_rfc3339()),
                    value: Some(r),
                    label: None,
                    metric_id: name,
                })
            })
            .collect();

        // Try OEM thermal telemetry history
        let history = if let Ok(tel) = rf
            .get::<serde_json::Value>("/redfish/v1/TelemetryService/MetricReports/ThermalMetrics")
            .await
        {
            tel.get("MetricValues")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .map(|m| TelemetryDataPoint {
                            timestamp: m.get("Timestamp").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            value: m.get("MetricValue").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()),
                            label: None,
                            metric_id: m.get("MetricId").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        Ok(ThermalTelemetry {
            inlet_temp_celsius: inlet,
            exhaust_temp_celsius: exhaust,
            sensor_readings,
            fan_readings,
            history,
            timestamp: Some(chrono::Utc::now().to_rfc3339()),
        })
    }

    /// Get available telemetry report definitions.
    pub async fn list_telemetry_reports(&self) -> IdracResult<Vec<TelemetryReport>> {
        let rf = self.client.require_redfish()?;

        let col: serde_json::Value = rf
            .get("/redfish/v1/TelemetryService/MetricReports?$expand=*($levels=1)")
            .await
            .unwrap_or_default();

        let members = col.get("Members").and_then(|v| v.as_array()).cloned().unwrap_or_default();

        Ok(members
            .iter()
            .map(|r| TelemetryReport {
                id: r.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                name: r.get("Name").and_then(|v| v.as_str()).unwrap_or("Report").to_string(),
                report_sequence: r.get("ReportSequence").and_then(|v| v.as_str()).map(|s| s.to_string()),
                timestamp: r.get("Timestamp").and_then(|v| v.as_str()).map(|s| s.to_string()),
                metric_values_count: r.get("MetricValues").and_then(|v| v.as_array()).map(|a| a.len() as u32),
            })
            .collect())
    }

    /// Get a specific telemetry report.
    pub async fn get_telemetry_report(&self, report_id: &str) -> IdracResult<Vec<TelemetryDataPoint>> {
        let rf = self.client.require_redfish()?;

        let report: serde_json::Value = rf
            .get(&format!("/redfish/v1/TelemetryService/MetricReports/{}", report_id))
            .await?;

        let values = report
            .get("MetricValues")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        Ok(values
            .iter()
            .map(|m| TelemetryDataPoint {
                timestamp: m.get("Timestamp").and_then(|v| v.as_str()).map(|s| s.to_string()),
                value: m.get("MetricValue").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()),
                label: None,
                metric_id: m.get("MetricId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            })
            .collect())
    }
}
