use crate::client::UpsClient;
use crate::devices::parse_upsc_output;
use crate::error::{UpsError, UpsResult};
use crate::types::OutputInfo;

pub struct OutputManager<'a> {
    client: &'a UpsClient,
}

impl<'a> OutputManager<'a> {
    pub fn new(client: &'a UpsClient) -> Self {
        Self { client }
    }

    pub async fn get_output_info(&self, ups_name: &str) -> UpsResult<OutputInfo> {
        let raw = self.client.exec_upsc(ups_name, None).await?;
        let v = parse_upsc_output(&raw);
        Ok(OutputInfo {
            voltage: v.get("output.voltage").and_then(|s| s.parse().ok()),
            voltage_nominal: v.get("output.voltage.nominal").and_then(|s| s.parse().ok()),
            frequency: v.get("output.frequency").and_then(|s| s.parse().ok()),
            frequency_nominal: v
                .get("output.frequency.nominal")
                .and_then(|s| s.parse().ok()),
            current: v.get("output.current").and_then(|s| s.parse().ok()),
            power: v.get("output.power").and_then(|s| s.parse().ok()),
            power_percent: v.get("ups.load").and_then(|s| s.parse().ok()),
            phases: v.get("output.phases").and_then(|s| s.parse().ok()),
        })
    }

    pub async fn get_output_voltage(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("output.voltage"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_output_voltage_nominal(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("output.voltage.nominal"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_output_frequency(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("output.frequency"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_output_frequency_nominal(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("output.frequency.nominal"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_output_current(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("output.current"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_output_power(&self, ups_name: &str) -> UpsResult<f64> {
        // Try direct output.power variable first
        if let Ok(val) = self.client.exec_upsc(ups_name, Some("output.power")).await {
            if let Ok(p) = val.trim().parse::<f64>() {
                return Ok(p);
            }
        }
        // Fallback: compute from voltage * current
        let voltage = self.get_output_voltage(ups_name).await?;
        let current = self.get_output_current(ups_name).await?;
        Ok(voltage * current)
    }

    pub async fn set_output_voltage_nominal(&self, ups_name: &str, voltage: f64) -> UpsResult<()> {
        self.client
            .exec_upsrw(ups_name, "output.voltage.nominal", &voltage.to_string())
            .await?;
        Ok(())
    }

    pub async fn get_output_phases(&self, ups_name: &str) -> UpsResult<u32> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("output.phases"))
            .await?;
        val.trim()
            .parse::<u32>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_output_power_percent(&self, ups_name: &str) -> UpsResult<f64> {
        // Try ups.load first (most common)
        if let Ok(val) = self.client.exec_upsc(ups_name, Some("ups.load")).await {
            if let Ok(p) = val.trim().parse::<f64>() {
                return Ok(p);
            }
        }
        // Fallback: compute output.power / ups.power.nominal * 100
        let power = self.get_output_power(ups_name).await?;
        let nominal = self
            .client
            .exec_upsc(ups_name, Some("ups.power.nominal"))
            .await?;
        let nominal: f64 = nominal
            .trim()
            .parse()
            .map_err(|e: std::num::ParseFloatError| UpsError::parse(e.to_string()))?;
        if nominal > 0.0 {
            Ok((power / nominal) * 100.0)
        } else {
            Err(UpsError::parse("nominal power is zero"))
        }
    }
}
