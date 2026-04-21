use crate::client::UpsClient;
use crate::devices::parse_upsc_output;
use crate::error::{UpsError, UpsResult};
use crate::types::InputInfo;

pub struct InputManager<'a> {
    client: &'a UpsClient,
}

impl<'a> InputManager<'a> {
    pub fn new(client: &'a UpsClient) -> Self {
        Self { client }
    }

    pub async fn get_input_info(&self, ups_name: &str) -> UpsResult<InputInfo> {
        let raw = self.client.exec_upsc(ups_name, None).await?;
        let v = parse_upsc_output(&raw);
        Ok(InputInfo {
            voltage: v.get("input.voltage").and_then(|s| s.parse().ok()),
            voltage_nominal: v.get("input.voltage.nominal").and_then(|s| s.parse().ok()),
            voltage_max: v.get("input.voltage.maximum").and_then(|s| s.parse().ok()),
            voltage_min: v.get("input.voltage.minimum").and_then(|s| s.parse().ok()),
            frequency: v.get("input.frequency").and_then(|s| s.parse().ok()),
            frequency_nominal: v
                .get("input.frequency.nominal")
                .and_then(|s| s.parse().ok()),
            current: v.get("input.current").and_then(|s| s.parse().ok()),
            power: v.get("input.power").and_then(|s| s.parse().ok()),
            sensitivity: v.get("input.sensitivity").cloned(),
            transfer_high: v.get("input.transfer.high").and_then(|s| s.parse().ok()),
            transfer_low: v.get("input.transfer.low").and_then(|s| s.parse().ok()),
            phases: v.get("input.phases").and_then(|s| s.parse().ok()),
            quality: v.get("input.quality").cloned(),
        })
    }

    pub async fn get_input_voltage(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("input.voltage"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_input_voltage_nominal(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("input.voltage.nominal"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_input_frequency(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("input.frequency"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_input_frequency_nominal(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("input.frequency.nominal"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_input_current(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("input.current"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_input_power(&self, ups_name: &str) -> UpsResult<f64> {
        if let Ok(val) = self.client.exec_upsc(ups_name, Some("input.power")).await {
            if let Ok(p) = val.trim().parse::<f64>() {
                return Ok(p);
            }
        }
        // Fallback: compute from voltage * current
        let voltage = self.get_input_voltage(ups_name).await?;
        let current = self.get_input_current(ups_name).await?;
        Ok(voltage * current)
    }

    pub async fn get_input_sensitivity(&self, ups_name: &str) -> UpsResult<String> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("input.sensitivity"))
            .await?;
        Ok(val.trim().to_string())
    }

    pub async fn set_input_sensitivity(&self, ups_name: &str, sensitivity: &str) -> UpsResult<()> {
        self.client
            .exec_upsrw(ups_name, "input.sensitivity", sensitivity)
            .await?;
        Ok(())
    }

    pub async fn get_input_transfer_high(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("input.transfer.high"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn set_input_transfer_high(&self, ups_name: &str, voltage: f64) -> UpsResult<()> {
        self.client
            .exec_upsrw(ups_name, "input.transfer.high", &voltage.to_string())
            .await?;
        Ok(())
    }

    pub async fn get_input_transfer_low(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("input.transfer.low"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn set_input_transfer_low(&self, ups_name: &str, voltage: f64) -> UpsResult<()> {
        self.client
            .exec_upsrw(ups_name, "input.transfer.low", &voltage.to_string())
            .await?;
        Ok(())
    }

    pub async fn get_input_phases(&self, ups_name: &str) -> UpsResult<u32> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("input.phases"))
            .await?;
        val.trim()
            .parse::<u32>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_input_voltage_max(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("input.voltage.maximum"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_input_voltage_min(&self, ups_name: &str) -> UpsResult<f64> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("input.voltage.minimum"))
            .await?;
        val.trim()
            .parse::<f64>()
            .map_err(|e| UpsError::parse(e.to_string()))
    }

    pub async fn get_input_quality(&self, ups_name: &str) -> UpsResult<String> {
        let val = self
            .client
            .exec_upsc(ups_name, Some("input.quality"))
            .await?;
        Ok(val.trim().to_string())
    }
}
