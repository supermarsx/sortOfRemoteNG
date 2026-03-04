//! Lenovo OneCLI command passthrough (XCC only).
//!
//! OneCLI is Lenovo's command-line tool for server configuration.
//! On XCC, some OneCLI operations can be triggered through Redfish OEM actions.

use crate::client::LenovoClient;
use crate::error::{LenovoError, LenovoResult};
use crate::types::*;

pub struct OnecliManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> OnecliManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    /// Execute a OneCLI-style command via XCC Redfish OEM endpoint.
    ///
    /// Note: Not all OneCLI commands are supported via Redfish. This is primarily
    /// for configuration get/set operations that XCC exposes through OEM actions.
    pub async fn execute(&self, command: &str) -> LenovoResult<OnecliResult> {
        let rf = self.client.require_redfish()?;

        if !self.client.generation.supports_redfish() {
            return Err(LenovoError::onecli(
                "OneCLI passthrough requires XCC/XCC2 with Redfish support",
            ));
        }

        let body = serde_json::json!({
            "Command": command,
        });

        let start = std::time::Instant::now();
        let result: serde_json::Value = rf
            .inner
            .post_json(
                "/redfish/v1/Managers/1/Oem/Lenovo/Actions/Manager.ExecuteOneCLI",
                &body,
            )
            .await
            .map_err(LenovoError::from)?;
        let duration = start.elapsed();

        Ok(OnecliResult {
            command: command.to_string(),
            exit_code: result
                .get("ExitCode")
                .and_then(|v| v.as_i64())
                .unwrap_or(-1) as i32,
            stdout: result
                .get("Output")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            stderr: result
                .get("Error")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            duration_ms: duration.as_millis() as u64,
        })
    }
}
