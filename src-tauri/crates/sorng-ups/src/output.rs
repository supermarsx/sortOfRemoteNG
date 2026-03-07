use crate::client::UpsClient;
use crate::error::UpsResult;
use crate::types::OutputInfo;

pub struct OutputManager<'a> {
    client: &'a UpsClient,
}

impl<'a> OutputManager<'a> {
    pub fn new(client: &'a UpsClient) -> Self {
        Self { client }
    }

    pub async fn get_output_info(&self, _ups_name: &str) -> UpsResult<OutputInfo> {
        let _client = &self.client;
        todo!("get_output_info: aggregate all output.* variables into OutputInfo")
    }

    pub async fn get_output_voltage(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_output_voltage: parse `upsc <ups_name> output.voltage`")
    }

    pub async fn get_output_voltage_nominal(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_output_voltage_nominal: parse `upsc <ups_name> output.voltage.nominal`")
    }

    pub async fn get_output_frequency(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_output_frequency: parse `upsc <ups_name> output.frequency`")
    }

    pub async fn get_output_frequency_nominal(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_output_frequency_nominal: parse `upsc <ups_name> output.frequency.nominal`")
    }

    pub async fn get_output_current(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_output_current: parse `upsc <ups_name> output.current`")
    }

    pub async fn get_output_power(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_output_power: parse `upsc <ups_name> output.power` or compute from V*I")
    }

    pub async fn set_output_voltage_nominal(
        &self,
        _ups_name: &str,
        _voltage: f64,
    ) -> UpsResult<()> {
        todo!("set_output_voltage_nominal: run `upsrw output.voltage.nominal=<voltage>`")
    }

    pub async fn get_output_phases(&self, _ups_name: &str) -> UpsResult<u32> {
        todo!("get_output_phases: parse `upsc <ups_name> output.phases`")
    }

    pub async fn get_output_power_percent(&self, _ups_name: &str) -> UpsResult<f64> {
        todo!("get_output_power_percent: parse ups.load or compute output.power / ups.power.nominal")
    }
}
