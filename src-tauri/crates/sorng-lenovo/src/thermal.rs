//! Thermal monitoring for Lenovo servers.

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct ThermalManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> ThermalManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_thermal_data(&self) -> LenovoResult<BmcThermalData> {
        let rf = self.client.require_redfish()?;
        rf.get_thermal_data().await
    }

    pub async fn get_thermal_summary(&self) -> LenovoResult<ThermalSummary> {
        let data = self.get_thermal_data().await?;

        let ambient = data
            .temperatures
            .iter()
            .find(|t| {
                t.physical_context.as_deref() == Some("Intake")
                    || t.name.to_lowercase().contains("ambient")
            })
            .and_then(|t| t.reading_celsius);

        let cpu_max = data
            .temperatures
            .iter()
            .filter(|t| {
                t.physical_context.as_deref() == Some("CPU")
                    || t.name.to_lowercase().contains("cpu")
            })
            .filter_map(|t| t.reading_celsius)
            .fold(None, |max: Option<f64>, r| {
                Some(max.map_or(r, |m: f64| m.max(r)))
            });

        let fans_ok = data
            .fans
            .iter()
            .filter(|f| f.status.health.as_deref() == Some("OK"))
            .count() as u32;

        let temp_warnings = data
            .temperatures
            .iter()
            .filter(|t| t.status.health.as_deref() == Some("Warning"))
            .count() as u32;

        let temp_critical = data
            .temperatures
            .iter()
            .filter(|t| t.status.health.as_deref() == Some("Critical"))
            .count() as u32;

        Ok(ThermalSummary {
            ambient_celsius: ambient,
            cpu_max_celsius: cpu_max,
            fan_count: data.fans.len() as u32,
            fans_ok,
            temp_sensors: data.temperatures.len() as u32,
            temp_warnings,
            temp_critical,
        })
    }
}
