use crate::client::UpsClient;
use crate::error::UpsResult;
use crate::types::InputInfo;

pub struct InputManager<'a> {
    client: &'a UpsClient,
}

impl<'a> InputManager<'a> {
    pub fn new(client: &'a UpsClient) -> Self {
        Self { client }
    }

    pub async fn get_input_info(&self, _ups_name: &str) -> UpsResult<InputInfo> {
        let _client = &self.client;
        todo!("get_input_info: aggregate all input.* variables into InputInfo")
    }

    pub async fn get_input_voltage(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_input_voltage: parse `upsc <ups_name> input.voltage`")
    }

    pub async fn get_input_voltage_nominal(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_input_voltage_nominal: parse `upsc <ups_name> input.voltage.nominal`")
    }

    pub async fn get_input_frequency(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_input_frequency: parse `upsc <ups_name> input.frequency`")
    }

    pub async fn get_input_frequency_nominal(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_input_frequency_nominal: parse `upsc <ups_name> input.frequency.nominal`")
    }

    pub async fn get_input_current(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_input_current: parse `upsc <ups_name> input.current`")
    }

    pub async fn get_input_power(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_input_power: parse `upsc <ups_name> input.power` or compute from V*I")
    }

    pub async fn get_input_sensitivity(&self, _ups_name: &str) -> UpsResult<String> {
        todo!("get_input_sensitivity: parse `upsc <ups_name> input.sensitivity`")
    }

    pub async fn set_input_sensitivity(
        &self,
        _ups_name: &str,
        _sensitivity: &str,
    ) -> UpsResult<()> {
        todo!("set_input_sensitivity: run `upsrw input.sensitivity=<value>`")
    }

    pub async fn get_input_transfer_high(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_input_transfer_high: parse `upsc <ups_name> input.transfer.high`")
    }

    pub async fn set_input_transfer_high(
        &self,
        _ups_name: &str,
        _voltage: f64,
    ) -> UpsResult<()> {
        todo!("set_input_transfer_high: run `upsrw input.transfer.high=<voltage>`")
    }

    pub async fn get_input_transfer_low(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_input_transfer_low: parse `upsc <ups_name> input.transfer.low`")
    }

    pub async fn set_input_transfer_low(&self, _ups_name: &str, _voltage: f64) -> UpsResult<()> {
        todo!("set_input_transfer_low: run `upsrw input.transfer.low=<voltage>`")
    }

    pub async fn get_input_phases(&self, _ups_name: &str) -> UpsResult<u32> {
        todo!("get_input_phases: parse `upsc <ups_name> input.phases`")
    }

    pub async fn get_input_voltage_max(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_input_voltage_max: parse `upsc <ups_name> input.voltage.maximum`")
    }

    pub async fn get_input_voltage_min(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_input_voltage_min: parse `upsc <ups_name> input.voltage.minimum`")
    }

    pub async fn get_input_quality(&self, _ups_name: &str) -> UpsResult<String> {
        todo!("get_input_quality: parse `upsc <ups_name> input.quality`")
    }
}
