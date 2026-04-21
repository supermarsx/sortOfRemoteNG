// ── sorng-ups – Battery management ────────────────────────────────────────────
//! Battery health, charge, runtime, and replacement queries via NUT variables.

use crate::client::UpsClient;
use crate::devices::parse_upsc_output;
use crate::error::{UpsError, UpsResult};
use crate::types::*;

pub struct BatteryManager;

impl BatteryManager {
    /// Get comprehensive battery info by parsing `upsc` variables.
    pub async fn get_info(client: &UpsClient, name: &str) -> UpsResult<BatteryInfo> {
        let raw = client.exec_upsc(name, None).await?;
        let v = parse_upsc_output(&raw);
        Ok(BatteryInfo {
            charge_percent: v.get("battery.charge").and_then(|s| s.parse().ok()),
            voltage: v.get("battery.voltage").and_then(|s| s.parse().ok()),
            voltage_nominal: v
                .get("battery.voltage.nominal")
                .and_then(|s| s.parse().ok()),
            voltage_low: v.get("battery.voltage.low").and_then(|s| s.parse().ok()),
            voltage_high: v.get("battery.voltage.high").and_then(|s| s.parse().ok()),
            runtime_seconds: v.get("battery.runtime").and_then(|s| s.parse().ok()),
            runtime_low: v.get("battery.runtime.low").and_then(|s| s.parse().ok()),
            temperature: v.get("battery.temperature").and_then(|s| s.parse().ok()),
            type_name: v.get("battery.type").cloned(),
            date: v.get("battery.date").cloned(),
            mfr_date: v.get("battery.mfr.date").cloned(),
            packs: v.get("battery.packs").and_then(|s| s.parse().ok()),
            packs_bad: v.get("battery.packs.bad").and_then(|s| s.parse().ok()),
            alarm_threshold: v.get("battery.alarm.threshold").cloned(),
            charge_low: v.get("battery.charge.low").and_then(|s| s.parse().ok()),
            charge_warning: v.get("battery.charge.warning").and_then(|s| s.parse().ok()),
            charge_restart: v.get("battery.charge.restart").and_then(|s| s.parse().ok()),
        })
    }

    /// Current battery charge percentage.
    pub async fn get_charge(client: &UpsClient, name: &str) -> UpsResult<f64> {
        let val = client.exec_upsc(name, Some("battery.charge")).await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    /// Estimated remaining runtime in seconds.
    pub async fn get_runtime(client: &UpsClient, name: &str) -> UpsResult<u64> {
        let val = client.exec_upsc(name, Some("battery.runtime")).await?;
        val.trim()
            .parse::<u64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    /// Current battery voltage.
    pub async fn get_voltage(client: &UpsClient, name: &str) -> UpsResult<f64> {
        let val = client.exec_upsc(name, Some("battery.voltage")).await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    /// True if `ups.status` contains `LB` (Low Battery).
    pub async fn is_low(client: &UpsClient, name: &str) -> UpsResult<bool> {
        let val = client.exec_upsc(name, Some("ups.status")).await?;
        Ok(val.trim().contains("LB"))
    }

    /// True if `ups.status` contains `RB` (Replace Battery).
    pub async fn needs_replacement(client: &UpsClient, name: &str) -> UpsResult<bool> {
        let val = client.exec_upsc(name, Some("ups.status")).await?;
        Ok(val.trim().contains("RB"))
    }

    /// Simple health assessment string based on charge & status flags.
    pub async fn get_health(client: &UpsClient, name: &str) -> UpsResult<String> {
        let raw = client.exec_upsc(name, None).await?;
        let v = parse_upsc_output(&raw);
        let status = v.get("ups.status").cloned().unwrap_or_default();
        let charge: f64 = v
            .get("battery.charge")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0);

        let health = if status.contains("RB") {
            "Replace battery"
        } else if status.contains("LB") {
            "Low battery"
        } else if charge >= 80.0 {
            "Good"
        } else if charge >= 50.0 {
            "Fair"
        } else {
            "Poor"
        };
        Ok(health.to_string())
    }

    /// Battery install date (`battery.date`).
    pub async fn get_date(client: &UpsClient, name: &str) -> UpsResult<Option<String>> {
        let val = client.exec_upsc(name, Some("battery.date")).await?;
        let trimmed = val.trim();
        if trimmed.is_empty() {
            Ok(None)
        } else {
            Ok(Some(trimmed.to_string()))
        }
    }
}
