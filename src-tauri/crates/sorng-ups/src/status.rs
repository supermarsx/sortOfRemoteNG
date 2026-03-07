//! UPS status monitoring – power quality, alarms, input/output stats.

use crate::client::UpsClient;
use crate::error::UpsResult;
use crate::types::*;

pub struct StatusManager;

impl StatusManager {
    /// Get comprehensive UPS status.
    pub async fn get_status(client: &UpsClient, name: &str) -> UpsResult<UpsStatus> {
        let raw = client.upsc(name, None).await?;
        let vars = parse_vars(&raw);

        let flags = vars
            .get("ups.status")
            .map(|s| parse_status_flags(s))
            .unwrap_or_default();

        Ok(UpsStatus {
            status_flags: flags,
            line_voltage: vars.get("input.voltage").and_then(|v| v.parse().ok()),
            line_frequency: vars.get("input.frequency").and_then(|v| v.parse().ok()),
            output_voltage: vars.get("output.voltage").and_then(|v| v.parse().ok()),
            output_frequency: vars.get("output.frequency").and_then(|v| v.parse().ok()),
            output_current: vars.get("output.current").and_then(|v| v.parse().ok()),
            output_power: vars.get("output.power").and_then(|v| v.parse().ok()),
            ups_load: vars.get("ups.load").and_then(|v| v.parse().ok()),
            ups_temperature: vars.get("ups.temperature").and_then(|v| v.parse().ok()),
            ups_efficiency: vars.get("ups.efficiency").and_then(|v| v.parse().ok()),
            input_sensitivity: vars.get("input.sensitivity").cloned(),
            alarm_status: vars
                .get("ups.alarm")
                .map(|a| a.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_default(),
            last_transfer_reason: vars.get("input.transfer.reason").cloned(),
            self_test_result: vars.get("ups.test.result").cloned(),
            self_test_date: vars.get("ups.test.date").cloned(),
        })
    }

    /// Get power quality metrics.
    pub async fn get_power_quality(client: &UpsClient, name: &str) -> UpsResult<PowerQuality> {
        let raw = client.upsc(name, None).await?;
        let vars = parse_vars(&raw);

        Ok(PowerQuality {
            input_voltage_min: vars.get("input.voltage.minimum").and_then(|v| v.parse().ok()),
            input_voltage_max: vars.get("input.voltage.maximum").and_then(|v| v.parse().ok()),
            input_voltage_avg: vars.get("input.voltage").and_then(|v| v.parse().ok()),
            input_frequency: vars.get("input.frequency").and_then(|v| v.parse().ok()),
            input_sensitivity: vars.get("input.sensitivity").cloned(),
            output_voltage: vars.get("output.voltage").and_then(|v| v.parse().ok()),
            output_frequency: vars.get("output.frequency").and_then(|v| v.parse().ok()),
            power_factor: vars.get("output.powerfactor").and_then(|v| v.parse().ok()),
            apparent_power: vars.get("ups.power").and_then(|v| v.parse().ok()),
            active_power: vars.get("ups.realpower").and_then(|v| v.parse().ok()),
            reactive_power: None,
            thd_voltage: None,
            thd_current: None,
        })
    }

    /// Get current alarm messages.
    pub async fn get_alarms(client: &UpsClient, name: &str) -> UpsResult<Vec<String>> {
        let val = client.upsc(name, Some("ups.alarm")).await.unwrap_or_default();
        if val.trim().is_empty() {
            return Ok(Vec::new());
        }
        Ok(val.trim().split(',').map(|s| s.trim().to_string()).collect())
    }

    /// Get input power statistics.
    pub async fn get_input_stats(client: &UpsClient, name: &str) -> UpsResult<serde_json::Value> {
        let raw = client.upsc(name, None).await?;
        let vars = parse_vars(&raw);
        let mut stats = serde_json::Map::new();
        for (k, v) in &vars {
            if k.starts_with("input.") {
                stats.insert(k.clone(), serde_json::Value::String(v.clone()));
            }
        }
        Ok(serde_json::Value::Object(stats))
    }

    /// Get output power statistics.
    pub async fn get_output_stats(client: &UpsClient, name: &str) -> UpsResult<serde_json::Value> {
        let raw = client.upsc(name, None).await?;
        let vars = parse_vars(&raw);
        let mut stats = serde_json::Map::new();
        for (k, v) in &vars {
            if k.starts_with("output.") {
                stats.insert(k.clone(), serde_json::Value::String(v.clone()));
            }
        }
        Ok(serde_json::Value::Object(stats))
    }

    /// Get bypass information.
    pub async fn get_bypass_info(client: &UpsClient, name: &str) -> UpsResult<serde_json::Value> {
        let raw = client.upsc(name, None).await?;
        let vars = parse_vars(&raw);
        let mut info = serde_json::Map::new();
        for (k, v) in &vars {
            if k.starts_with("ups.bypass.") || k.contains("bypass") {
                info.insert(k.clone(), serde_json::Value::String(v.clone()));
            }
        }
        Ok(serde_json::Value::Object(info))
    }

    /// Check if UPS is running on battery.
    pub async fn is_on_battery(client: &UpsClient, name: &str) -> UpsResult<bool> {
        let val = client.upsc(name, Some("ups.status")).await?;
        Ok(val.contains("OB"))
    }

    /// Check if UPS is online (mains power).
    pub async fn is_online(client: &UpsClient, name: &str) -> UpsResult<bool> {
        let val = client.upsc(name, Some("ups.status")).await?;
        Ok(val.contains("OL"))
    }

    /// Get UPS efficiency percentage.
    pub async fn get_efficiency(client: &UpsClient, name: &str) -> UpsResult<Option<f64>> {
        let val = client.upsc(name, Some("ups.efficiency")).await.unwrap_or_default();
        Ok(val.trim().parse().ok())
    }

    /// Get self-test result.
    pub async fn get_self_test_result(client: &UpsClient, name: &str) -> UpsResult<Option<String>> {
        let val = client.upsc(name, Some("ups.test.result")).await.unwrap_or_default();
        let trimmed = val.trim().to_string();
        if trimmed.is_empty() { Ok(None) } else { Ok(Some(trimmed)) }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

fn parse_vars(raw: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in raw.lines() {
        if let Some((k, v)) = line.split_once(": ") {
            map.insert(k.to_string(), v.to_string());
        }
    }
    map
}

fn parse_status_flags(status: &str) -> Vec<UpsStatusFlag> {
    let mut flags = Vec::new();
    for token in status.split_whitespace() {
        match token {
            "OL" => flags.push(UpsStatusFlag::Online),
            "OB" => flags.push(UpsStatusFlag::OnBattery),
            "LB" => flags.push(UpsStatusFlag::LowBattery),
            "HB" => flags.push(UpsStatusFlag::HighBattery),
            "RB" => flags.push(UpsStatusFlag::Replacing),
            "CHRG" => flags.push(UpsStatusFlag::Charging),
            "DISCHRG" => flags.push(UpsStatusFlag::Discharging),
            "BYPASS" => flags.push(UpsStatusFlag::Bypass),
            "OFF" => flags.push(UpsStatusFlag::Off),
            "OVER" => flags.push(UpsStatusFlag::Overload),
            "TRIM" => flags.push(UpsStatusFlag::Trim),
            "BOOST" => flags.push(UpsStatusFlag::Boost),
            "FSD" => flags.push(UpsStatusFlag::ForcedShutdown),
            "ALARM" => flags.push(UpsStatusFlag::Alarm),
            "TEST" => flags.push(UpsStatusFlag::Test),
            "CAL" => flags.push(UpsStatusFlag::Calibrating),
            "COMM" => flags.push(UpsStatusFlag::Communication),
            _ => {}
        }
    }
    flags
}
