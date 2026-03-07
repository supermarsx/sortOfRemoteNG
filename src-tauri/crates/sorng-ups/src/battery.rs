//! Battery management – status, health, testing, calibration, history.

use crate::client::UpsClient;
use crate::error::UpsResult;
use crate::types::*;

pub struct BatteryManager;

impl BatteryManager {
    /// Get comprehensive battery status.
    pub async fn get_status(client: &UpsClient, name: &str) -> UpsResult<BatteryStatus> {
        let raw = client.upsc(name, None).await?;
        let vars = parse_vars(&raw);

        let charge = vars.get("battery.charge").and_then(|v| v.parse::<f64>().ok());
        let health = match charge {
            Some(c) if c >= 80.0 => BatteryHealth::Good,
            Some(c) if c >= 50.0 => BatteryHealth::Weak,
            Some(_) => BatteryHealth::Replace,
            None => BatteryHealth::Unknown,
        };

        Ok(BatteryStatus {
            charge_percent: charge,
            runtime_seconds: vars.get("battery.runtime").and_then(|v| v.parse().ok()),
            voltage: vars.get("battery.voltage").and_then(|v| v.parse().ok()),
            voltage_nominal: vars.get("battery.voltage.nominal").and_then(|v| v.parse().ok()),
            current: vars.get("battery.current").and_then(|v| v.parse().ok()),
            temperature: vars.get("battery.temperature").and_then(|v| v.parse().ok()),
            date_installed: vars.get("battery.date").cloned(),
            date_last_replaced: vars.get("battery.date.replacement").cloned(),
            chemistry: vars.get("battery.type").cloned(),
            packs: vars.get("battery.packs").and_then(|v| v.parse().ok()),
            packs_bad: vars.get("battery.packs.bad").and_then(|v| v.parse().ok()),
            health,
            capacity_ah: vars.get("battery.capacity").and_then(|v| v.parse().ok()),
            remaining_ah: None,
            charge_cycles: None,
        })
    }

    /// Get battery health assessment.
    pub async fn get_health(client: &UpsClient, name: &str) -> UpsResult<BatteryHealth> {
        let status = Self::get_status(client, name).await?;
        Ok(status.health)
    }

    /// Start a battery test (quick, deep, or custom).
    pub async fn start_test(client: &UpsClient, name: &str, test_type: &str) -> UpsResult<CommandResult> {
        let cmd = match test_type {
            "quick" => "test.battery.start.quick",
            "deep" => "test.battery.start.deep",
            _ => "test.battery.start",
        };
        client.upscmd(name, cmd).await?;
        Ok(CommandResult {
            success: true,
            message: format!("Battery {} test started on {}", test_type, name),
        })
    }

    /// Get the result of the last battery test.
    pub async fn get_test_result(client: &UpsClient, name: &str) -> UpsResult<BatteryTest> {
        let raw = client.upsc(name, None).await?;
        let vars = parse_vars(&raw);
        Ok(BatteryTest {
            result: vars.get("ups.test.result").cloned(),
            date: vars.get("ups.test.date").cloned(),
            duration_secs: vars.get("ups.test.interval").and_then(|v| v.parse().ok()),
            details: None,
        })
    }

    /// Get estimated remaining runtime in seconds.
    pub async fn get_runtime_estimate(client: &UpsClient, name: &str) -> UpsResult<Option<u64>> {
        let val = client.upsc(name, Some("battery.runtime")).await.unwrap_or_default();
        Ok(val.trim().parse().ok())
    }

    /// Get battery charge rate.
    pub async fn get_charge_rate(client: &UpsClient, name: &str) -> UpsResult<Option<f64>> {
        let val = client.upsc(name, Some("battery.charge.rate")).await.unwrap_or_default();
        Ok(val.trim().parse().ok())
    }

    /// Get battery history from syslog / NUT logs.
    pub async fn get_history(client: &UpsClient, _name: &str, limit: Option<u32>) -> UpsResult<Vec<serde_json::Value>> {
        let lines = limit.unwrap_or(50);
        let out = client
            .exec_ssh(&format!("tail -n {} /var/log/nut/ups.log 2>/dev/null || echo ''", lines))
            .await?;
        let entries: Vec<serde_json::Value> = out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::json!({ "raw": l }))
            .collect();
        Ok(entries)
    }

    /// Start battery runtime calibration.
    pub async fn calibrate(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        client.upscmd(name, "calibrate.start").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Battery calibration started on {}", name),
        })
    }

    /// Get battery replacement information.
    pub async fn get_replacement_info(client: &UpsClient, name: &str) -> UpsResult<serde_json::Value> {
        let raw = client.upsc(name, None).await?;
        let vars = parse_vars(&raw);
        let needs_replacement = vars
            .get("ups.status")
            .map(|s| s.contains("RB"))
            .unwrap_or(false);
        Ok(serde_json::json!({
            "needs_replacement": needs_replacement,
            "date_installed": vars.get("battery.date"),
            "date_last_replaced": vars.get("battery.date.replacement"),
            "chemistry": vars.get("battery.type"),
            "packs": vars.get("battery.packs"),
            "packs_bad": vars.get("battery.packs.bad"),
        }))
    }
}

fn parse_vars(raw: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in raw.lines() {
        if let Some((k, v)) = line.split_once(": ") {
            map.insert(k.to_string(), v.to_string());
        }
    }
    map
}
