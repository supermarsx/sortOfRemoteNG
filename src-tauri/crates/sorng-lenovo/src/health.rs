//! Health rollup and dashboard for Lenovo servers.

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct HealthManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> HealthManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_health_rollup(&self) -> LenovoResult<BmcHealthRollup> {
        let rf = self.client.require_redfish()?;
        rf.get_health_rollup().await
    }

    pub async fn get_dashboard(&self) -> LenovoResult<XccDashboard> {
        let rf = self.client.require_redfish()?;

        let system = rf.get_system_info().await.ok();
        let controller = rf.get_xcc_info().await.ok();
        let power_state = rf.get_power_state().await.ok();
        let health = rf.get_health_rollup().await.ok();
        let power_metrics = rf.get_power_metrics().await.ok();
        let thermal = rf.get_thermal_data().await.ok();

        let ambient = thermal.as_ref().and_then(|t| {
            t.temperatures
                .iter()
                .find(|s| {
                    s.physical_context.as_deref() == Some("Intake")
                        || s.name.to_lowercase().contains("ambient")
                })
                .and_then(|s| s.reading_celsius)
        });

        let cpu_temp = thermal.as_ref().and_then(|t| {
            t.temperatures
                .iter()
                .filter(|s| {
                    s.physical_context.as_deref() == Some("CPU")
                        || s.name.to_lowercase().contains("cpu")
                })
                .filter_map(|s| s.reading_celsius)
                .fold(None, |max: Option<f64>, r| {
                    Some(max.map_or(r, |m: f64| m.max(r)))
                })
        });

        let fan_count = thermal.as_ref().map(|t| t.fans.len() as u32);
        let dimm_count = rf.get_memory().await.ok().map(|d| d.len() as u32);

        Ok(XccDashboard {
            system,
            controller,
            power_state,
            health,
            power_watts: power_metrics.as_ref().and_then(|p| p.current_watts),
            ambient_temp_celsius: ambient,
            cpu_temp_celsius: cpu_temp,
            fan_count,
            dimm_count,
            disk_count: None,
        })
    }
}
