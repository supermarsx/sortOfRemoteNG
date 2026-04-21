// ── sorng-ups – Status monitoring ─────────────────────────────────────────────
//! Query UPS status variables via `upsc`.

use crate::client::UpsClient;
use crate::devices::{parse_upsc_output, DeviceManager};
use crate::error::UpsResult;
use crate::types::*;

pub struct StatusManager;

impl StatusManager {
    /// Get full status for a device by parsing all `upsc` variables.
    pub async fn get(client: &UpsClient, name: &str) -> UpsResult<UpsStatus> {
        let raw = client.exec_upsc(name, None).await?;
        let v = parse_upsc_output(&raw);
        Ok(Self::build_status(name, &v))
    }

    /// Quick one-line summary: status + load + battery charge.
    pub async fn get_summary(client: &UpsClient, name: &str) -> UpsResult<String> {
        let s = Self::get(client, name).await?;
        Ok(format!(
            "{}: status={} load={}% battery={}%",
            s.device_name,
            s.status.as_deref().unwrap_or("unknown"),
            s.load_percent
                .map(|v| format!("{v:.1}"))
                .unwrap_or_else(|| "?".into()),
            s.battery_charge
                .map(|v| format!("{v:.1}"))
                .unwrap_or_else(|| "?".into()),
        ))
    }

    /// True when `ups.status` contains `OB` (On Battery).
    pub async fn is_on_battery(client: &UpsClient, name: &str) -> UpsResult<bool> {
        let val = client.exec_upsc(name, Some("ups.status")).await?;
        Ok(val.trim().contains("OB"))
    }

    /// True when `ups.status` contains `OL` (On Line).
    pub async fn is_online(client: &UpsClient, name: &str) -> UpsResult<bool> {
        let val = client.exec_upsc(name, Some("ups.status")).await?;
        Ok(val.trim().contains("OL"))
    }

    /// Current load percentage.
    pub async fn get_load(client: &UpsClient, name: &str) -> UpsResult<f64> {
        let val = client.exec_upsc(name, Some("ups.load")).await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| crate::error::UpsError::parse(e.to_string()))
    }

    /// Current input voltage.
    pub async fn get_input_voltage(client: &UpsClient, name: &str) -> UpsResult<f64> {
        let val = client.exec_upsc(name, Some("input.voltage")).await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| crate::error::UpsError::parse(e.to_string()))
    }

    /// Current output voltage.
    pub async fn get_output_voltage(client: &UpsClient, name: &str) -> UpsResult<f64> {
        let val = client.exec_upsc(name, Some("output.voltage")).await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| crate::error::UpsError::parse(e.to_string()))
    }

    /// UPS temperature (°C).
    pub async fn get_temperature(client: &UpsClient, name: &str) -> UpsResult<f64> {
        let val = client.exec_upsc(name, Some("ups.temperature")).await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| crate::error::UpsError::parse(e.to_string()))
    }

    /// Get status for every device on the server.
    pub async fn list_all_status(client: &UpsClient) -> UpsResult<Vec<UpsStatus>> {
        let devices = DeviceManager::list(client).await?;
        let mut statuses = Vec::new();
        for dev in &devices {
            if let Ok(s) = Self::get(client, &dev.name).await {
                statuses.push(s);
            }
        }
        Ok(statuses)
    }

    // ── Internal ────────────────────────────────────────────────

    fn build_status(name: &str, v: &std::collections::HashMap<String, String>) -> UpsStatus {
        UpsStatus {
            device_name: name.to_string(),
            status: v.get("ups.status").cloned(),
            load_percent: v.get("ups.load").and_then(|s| s.parse().ok()),
            input_voltage: v.get("input.voltage").and_then(|s| s.parse().ok()),
            input_frequency: v.get("input.frequency").and_then(|s| s.parse().ok()),
            output_voltage: v.get("output.voltage").and_then(|s| s.parse().ok()),
            output_frequency: v.get("output.frequency").and_then(|s| s.parse().ok()),
            output_current: v.get("output.current").and_then(|s| s.parse().ok()),
            temperature: v.get("ups.temperature").and_then(|s| s.parse().ok()),
            humidity: v.get("ambient.humidity").and_then(|s| s.parse().ok()),
            battery_charge: v.get("battery.charge").and_then(|s| s.parse().ok()),
            battery_voltage: v.get("battery.voltage").and_then(|s| s.parse().ok()),
            battery_runtime: v.get("battery.runtime").and_then(|s| s.parse().ok()),
            battery_type: v.get("battery.type").cloned(),
            battery_date: v.get("battery.date").cloned(),
            battery_mfr_date: v.get("battery.mfr.date").cloned(),
            ups_power_nominal: v.get("ups.power.nominal").and_then(|s| s.parse().ok()),
            ups_realpower: v.get("ups.realpower").and_then(|s| s.parse().ok()),
            ups_realpower_nominal: v.get("ups.realpower.nominal").and_then(|s| s.parse().ok()),
            beeper_status: v.get("ups.beeper.status").cloned(),
            ups_delay_start: v.get("ups.delay.start").and_then(|s| s.parse().ok()),
            ups_delay_shutdown: v.get("ups.delay.shutdown").and_then(|s| s.parse().ok()),
            ups_timer_start: v.get("ups.timer.start").and_then(|s| s.parse().ok()),
            ups_timer_shutdown: v.get("ups.timer.shutdown").and_then(|s| s.parse().ok()),
            ups_test_result: v.get("ups.test.result").cloned(),
            ups_test_date: v.get("ups.test.date").cloned(),
        }
    }
}
