// ── sorng-ups – Threshold management ─────────────────────────────────────────
//! Read and configure UPS thresholds (battery.charge.low, battery.runtime.low, etc.).

use crate::client::UpsClient;
use crate::devices::parse_upsc_output;
use crate::error::{UpsError, UpsResult};
use crate::types::*;

pub struct ThresholdManager;

impl ThresholdManager {
    /// List known thresholds for a device.
    pub async fn list(client: &UpsClient, device: &str) -> UpsResult<Vec<UpsThreshold>> {
        let raw = client.exec_upsc(device, None).await?;
        let vars = parse_upsc_output(&raw);

        let threshold_defs: Vec<(&str, &str, &str)> = vec![
            ("battery.charge.low", "battery.charge", "%"),
            ("battery.charge.warning", "battery.charge", "%"),
            ("battery.runtime.low", "battery.runtime", "s"),
            ("battery.voltage.low", "battery.voltage", "V"),
            ("battery.voltage.high", "battery.voltage", "V"),
            ("input.transfer.low", "input.voltage", "V"),
            ("input.transfer.high", "input.voltage", "V"),
            ("ups.delay.shutdown", "ups.delay.shutdown", "s"),
            ("ups.delay.start", "ups.delay.start", "s"),
        ];

        let mut thresholds = Vec::new();
        for (var, current_var, unit) in threshold_defs {
            if let Some(val) = vars.get(var) {
                thresholds.push(UpsThreshold {
                    name: var.to_string(),
                    variable: var.to_string(),
                    low: if var.contains("low") {
                        val.parse().ok()
                    } else {
                        None
                    },
                    high: if var.contains("high") {
                        val.parse().ok()
                    } else {
                        None
                    },
                    current_value: vars.get(current_var).and_then(|s| s.parse().ok()),
                    unit: Some(unit.to_string()),
                });
            }
        }
        Ok(thresholds)
    }

    /// Get a single threshold.
    pub async fn get(client: &UpsClient, device: &str, var: &str) -> UpsResult<UpsThreshold> {
        let thresholds = Self::list(client, device).await?;
        thresholds
            .into_iter()
            .find(|t| t.variable == var)
            .ok_or_else(|| UpsError::variable_not_found(var))
    }

    /// Set low and/or high threshold values via `upsrw`.
    pub async fn set(
        client: &UpsClient,
        device: &str,
        var: &str,
        low: Option<f64>,
        high: Option<f64>,
    ) -> UpsResult<()> {
        if let Some(lo) = low {
            let low_var = if var.ends_with(".low") {
                var.to_string()
            } else {
                format!("{}.low", var)
            };
            client.exec_upsrw(device, &low_var, &lo.to_string()).await?;
        }
        if let Some(hi) = high {
            let high_var = if var.ends_with(".high") {
                var.to_string()
            } else {
                format!("{}.high", var)
            };
            client
                .exec_upsrw(device, &high_var, &hi.to_string())
                .await?;
        }
        Ok(())
    }

    /// Get the low battery charge threshold (battery.charge.low).
    pub async fn get_low_battery(client: &UpsClient, device: &str) -> UpsResult<f64> {
        let val = client.exec_upsc(device, Some("battery.charge.low")).await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    /// Set the low battery charge threshold.
    pub async fn set_low_battery(client: &UpsClient, device: &str, value: f64) -> UpsResult<()> {
        client
            .exec_upsrw(device, "battery.charge.low", &value.to_string())
            .await?;
        Ok(())
    }

    /// Get the low runtime threshold (battery.runtime.low) in seconds.
    pub async fn get_low_runtime(client: &UpsClient, device: &str) -> UpsResult<u64> {
        let val = client
            .exec_upsc(device, Some("battery.runtime.low"))
            .await?;
        val.trim()
            .parse::<u64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    /// Set the low runtime threshold in seconds.
    pub async fn set_low_runtime(client: &UpsClient, device: &str, value: u64) -> UpsResult<()> {
        client
            .exec_upsrw(device, "battery.runtime.low", &value.to_string())
            .await?;
        Ok(())
    }
}
