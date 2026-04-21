//! RACADM command passthrough — execute RACADM commands via OEM endpoints.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;

/// RACADM remote command execution via iDRAC OEM Redfish endpoints.
pub struct RacadmManager<'a> {
    client: &'a IdracClient,
}

impl<'a> RacadmManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// Execute a RACADM command via Redfish OEM endpoint.
    pub async fn execute(&self, command: &str) -> IdracResult<RacadmResult> {
        let rf = self.client.require_redfish()?;

        // Dell OEM RACADM passthrough via SSE or Jobs
        // The actual endpoint varies by iDRAC version
        let body = serde_json::json!({
            "Command": command
        });

        // Try Dell OEM RACADM endpoint
        match rf
            .post_json::<serde_json::Value, serde_json::Value>(
                "/redfish/v1/Dell/Managers/iDRAC.Embedded.1/DellManager/Actions/DellManager.ExecuteRACCommand",
                &body,
            )
            .await
        {
            Ok(result) => {
                let output = result
                    .get("CommandOutput")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let return_code = result
                    .get("ReturnCode")
                    .and_then(|v| v.as_i64())
                    .map(|n| n as i32)
                    .unwrap_or(0);

                Ok(RacadmResult {
                    command: command.to_string(),
                    output,
                    return_code,
                    success: return_code == 0,
                    error: if return_code != 0 {
                        result.get("StatusMessage").and_then(|v| v.as_str()).map(|s| s.to_string())
                    } else {
                        None
                    },
                })
            }
            Err(_) => {
                // Fallback: try via OEM reset/attribute path for common operations
                self.execute_via_attributes(command).await
            }
        }
    }

    /// Fallback: execute common RACADM-like operations via standard Redfish.
    async fn execute_via_attributes(&self, command: &str) -> IdracResult<RacadmResult> {
        let parts: Vec<&str> = command.split_whitespace().collect();
        if parts.is_empty() {
            return Err(IdracError::racadm("Empty command"));
        }

        match parts[0] {
            "getversion" | "get" if parts.len() > 1 => {
                self.racadm_get(parts.get(1).unwrap_or(&"")).await
            }
            "set" if parts.len() > 2 => self.racadm_set(parts[1], parts[2]).await,
            "racreset" => self.racadm_racreset().await,
            "serveraction" if parts.len() > 1 => self.racadm_serveraction(parts[1]).await,
            "getsysinfo" | "getracinfo" => self.racadm_getsysinfo().await,
            "jobqueue" if parts.get(1) == Some(&"view") => self.racadm_jobqueue_view().await,
            "clrsel" => self.racadm_clrsel().await,
            _ => Err(IdracError::racadm(format!(
                "RACADM passthrough not available for '{}'. Use Redfish API directly.",
                command
            ))),
        }
    }

    async fn racadm_get(&self, attribute: &str) -> IdracResult<RacadmResult> {
        let rf = self.client.require_redfish()?;

        let attrs: serde_json::Value = rf
            .get("/redfish/v1/Managers/iDRAC.Embedded.1/Attributes")
            .await?;

        let value = attrs
            .get("Attributes")
            .and_then(|a| a.get(attribute))
            .map(|v| v.to_string())
            .unwrap_or_else(|| "Not found".to_string());

        Ok(RacadmResult {
            command: format!("get {}", attribute),
            output: format!("{} = {}", attribute, value),
            return_code: 0,
            success: true,
            error: None,
        })
    }

    async fn racadm_set(&self, attribute: &str, value: &str) -> IdracResult<RacadmResult> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "Attributes": {
                attribute: value
            }
        });

        rf.patch_json("/redfish/v1/Managers/iDRAC.Embedded.1/Attributes", &body)
            .await?;

        Ok(RacadmResult {
            command: format!("set {} {}", attribute, value),
            output: "Object value modified successfully".to_string(),
            return_code: 0,
            success: true,
            error: None,
        })
    }

    async fn racadm_racreset(&self) -> IdracResult<RacadmResult> {
        let rf = self.client.require_redfish()?;

        rf.post_action(
            "/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Manager.Reset",
            &serde_json::json!({ "ResetType": "GracefulRestart" }),
        )
        .await?;

        Ok(RacadmResult {
            command: "racreset".to_string(),
            output: "RAC reset operation initiated successfully".to_string(),
            return_code: 0,
            success: true,
            error: None,
        })
    }

    async fn racadm_serveraction(&self, action: &str) -> IdracResult<RacadmResult> {
        let rf = self.client.require_redfish()?;

        let lowered = action.to_lowercase();
        let reset_type = match lowered.as_str() {
            "powerup" => "On",
            "powerdown" => "ForceOff",
            "powercycle" => "PowerCycle",
            "hardreset" => "ForceRestart",
            "graceshutdown" => "GracefulShutdown",
            other => other,
        };

        rf.post_action(
            "/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset",
            &serde_json::json!({ "ResetType": reset_type }),
        )
        .await?;

        Ok(RacadmResult {
            command: format!("serveraction {}", action),
            output: format!("Server action {} initiated successfully", action),
            return_code: 0,
            success: true,
            error: None,
        })
    }

    async fn racadm_getsysinfo(&self) -> IdracResult<RacadmResult> {
        let rf = self.client.require_redfish()?;

        let sys: serde_json::Value = rf.get("/redfish/v1/Systems/System.Embedded.1").await?;

        let mgr: serde_json::Value = rf.get("/redfish/v1/Managers/iDRAC.Embedded.1").await?;

        let output = format!(
            "System Model = {}\nService Tag = {}\nBIOS Version = {}\nPower State = {}\niDRAC Version = {}\nFirmware Version = {}",
            sys.get("Model").and_then(|v| v.as_str()).unwrap_or("N/A"),
            sys.get("SKU").and_then(|v| v.as_str()).unwrap_or("N/A"),
            sys.get("BiosVersion").and_then(|v| v.as_str()).unwrap_or("N/A"),
            sys.get("PowerState").and_then(|v| v.as_str()).unwrap_or("N/A"),
            mgr.get("Model").and_then(|v| v.as_str()).unwrap_or("N/A"),
            mgr.get("FirmwareVersion").and_then(|v| v.as_str()).unwrap_or("N/A"),
        );

        Ok(RacadmResult {
            command: "getsysinfo".to_string(),
            output,
            return_code: 0,
            success: true,
            error: None,
        })
    }

    async fn racadm_jobqueue_view(&self) -> IdracResult<RacadmResult> {
        let rf = self.client.require_redfish()?;

        let col: serde_json::Value = match rf
            .get("/redfish/v1/Managers/iDRAC.Embedded.1/Oem/Dell/Jobs")
            .await
        {
            Ok(v) => v,
            Err(_) => rf
                .get("/redfish/v1/TaskService/Tasks")
                .await
                .unwrap_or_default(),
        };

        let count = col
            .get("Members@odata.count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        Ok(RacadmResult {
            command: "jobqueue view".to_string(),
            output: format!("Job queue contains {} jobs", count),
            return_code: 0,
            success: true,
            error: None,
        })
    }

    async fn racadm_clrsel(&self) -> IdracResult<RacadmResult> {
        let rf = self.client.require_redfish()?;

        rf.post_action(
            "/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Sel/Actions/LogService.ClearLog",
            &serde_json::json!({}),
        )
        .await?;

        Ok(RacadmResult {
            command: "clrsel".to_string(),
            output: "SEL records cleared successfully".to_string(),
            return_code: 0,
            success: true,
            error: None,
        })
    }

    /// Reset iDRAC (graceful restart).
    pub async fn reset_idrac(&self) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        rf.post_action(
            "/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Manager.Reset",
            &serde_json::json!({ "ResetType": "GracefulRestart" }),
        )
        .await?;

        Ok(())
    }

    /// Get an iDRAC attribute value.
    pub async fn get_attribute(&self, name: &str) -> IdracResult<Option<String>> {
        let rf = self.client.require_redfish()?;

        let attrs: serde_json::Value = rf
            .get("/redfish/v1/Managers/iDRAC.Embedded.1/Attributes")
            .await?;

        Ok(attrs
            .get("Attributes")
            .and_then(|a| a.get(name))
            .map(|v| match v {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            }))
    }

    /// Set an iDRAC attribute value.
    pub async fn set_attribute(&self, name: &str, value: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "Attributes": {
                name: value
            }
        });

        rf.patch_json("/redfish/v1/Managers/iDRAC.Embedded.1/Attributes", &body)
            .await
    }
}
