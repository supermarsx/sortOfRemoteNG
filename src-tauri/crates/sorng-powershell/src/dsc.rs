//! Desired State Configuration (DSC) management.
//!
//! Implements remote DSC operations including configuration testing,
//! application, retrieval, and compliance reporting.

use crate::session::PsSessionManager;
use crate::types::*;
use chrono::Utc;
use log::{debug, info, warn};
use std::collections::HashMap;

/// DSC operations manager.
pub struct DscManager;

impl DscManager {
    /// Test-DscConfiguration – check if a node is in desired state.
    pub async fn test_configuration(
        ps_manager: &PsSessionManager,
        session_id: &str,
        detailed: bool,
    ) -> Result<DscResult, String> {
        let session = ps_manager.get_session(session_id)?;
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = if detailed {
            "Test-DscConfiguration -Detailed | ConvertTo-Json -Depth 5"
        } else {
            "Test-DscConfiguration | ConvertTo-Json -Depth 5"
        };

        let (stdout, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        let mut errors = Vec::new();
        if !stderr.trim().is_empty() {
            errors.push(stderr.trim().to_string());
        }

        // Parse the JSON output
        let in_desired_state = stdout.trim() == "True"
            || stdout.contains("\"InDesiredState\":true")
            || stdout.contains("\"InDesiredState\": true");

        let resources = if detailed {
            parse_dsc_resources(&stdout).unwrap_or_default()
        } else {
            Vec::new()
        };

        let status = if !errors.is_empty() {
            DscComplianceStatus::Error
        } else if in_desired_state {
            DscComplianceStatus::Compliant
        } else {
            DscComplianceStatus::NonCompliant
        };

        Ok(DscResult {
            computer_name: session.computer_name,
            status,
            resources,
            reboot_required: stdout.contains("\"RebootRequested\":true")
                || stdout.contains("\"RebootRequested\": true"),
            timestamp: Utc::now(),
            errors,
        })
    }

    /// Get-DscConfiguration – retrieve the current applied configuration.
    pub async fn get_configuration(
        ps_manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<Vec<DscResourceState>, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = "Get-DscConfiguration | ConvertTo-Json -Depth 5";

        let (stdout, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if !stderr.trim().is_empty() {
            warn!("Get-DscConfiguration warnings: {}", stderr.trim());
        }

        parse_dsc_resources(&stdout)
    }

    /// Start-DscConfiguration – apply a configuration document.
    pub async fn start_configuration(
        ps_manager: &PsSessionManager,
        session_id: &str,
        config: &DscConfiguration,
        wait: bool,
        force: bool,
    ) -> Result<DscResult, String> {
        let session = ps_manager.get_session(session_id)?;
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        // First, push the configuration content to a temp file
        let config_escaped = config.content.replace('\'', "''");
        let push_script = format!(
            "$configContent = @'\n{}\n'@\n\
             $tempPath = Join-Path $env:TEMP 'sorng_dsc_{}.ps1'\n\
             Set-Content -Path $tempPath -Value $configContent -Force\n\
             Write-Output $tempPath",
            config_escaped, config.name
        );

        let temp_path = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &push_script).await?;
            let (stdout, _) = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            stdout.trim().to_string()
        };

        // Compile the configuration
        let compile_script = format!(
            ". '{}'\n{} -OutputPath $env:TEMP\\SorngDSC",
            temp_path, config.name
        );

        {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &compile_script).await?;
            let (_, stderr) = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;

            if !stderr.trim().is_empty() {
                return Err(format!(
                    "DSC configuration compilation failed: {}",
                    stderr.trim()
                ));
            }
        }

        // Apply the configuration
        let mut apply_script =
            "Start-DscConfiguration -Path $env:TEMP\\SorngDSC".to_string();
        if wait {
            apply_script.push_str(" -Wait -Verbose");
        }
        if force {
            apply_script.push_str(" -Force");
        }
        apply_script.push_str(" 2>&1 | ConvertTo-Json -Depth 5");

        let (stdout, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &apply_script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        // Clean up temp files
        {
            let cleanup_script = format!(
                "Remove-Item '{}' -Force -ErrorAction SilentlyContinue; Remove-Item $env:TEMP\\SorngDSC -Recurse -Force -ErrorAction SilentlyContinue",
                temp_path
            );
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &cleanup_script).await?;
            let _ = t.receive_all_output(&shell_id, &cmd_id).await;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
        }

        let mut errors = Vec::new();
        if !stderr.trim().is_empty() {
            errors.push(stderr.trim().to_string());
        }

        let status = if errors.is_empty() {
            DscComplianceStatus::Compliant
        } else {
            DscComplianceStatus::Error
        };

        info!(
            "DSC configuration '{}' applied to {} (status: {:?})",
            config.name, session.computer_name, status
        );

        Ok(DscResult {
            computer_name: session.computer_name,
            status,
            resources: Vec::new(),
            reboot_required: stdout.contains("reboot"),
            timestamp: Utc::now(),
            errors,
        })
    }

    /// Get-DscLocalConfigurationManager – retrieve LCM settings.
    pub async fn get_lcm_settings(
        ps_manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<serde_json::Value, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = "Get-DscLocalConfigurationManager | ConvertTo-Json -Depth 5";

        let (stdout, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if !stderr.trim().is_empty() {
            warn!("Get-DscLocalConfigurationManager warnings: {}", stderr.trim());
        }

        serde_json::from_str(stdout.trim())
            .map_err(|e| format!("Failed to parse LCM settings: {}", e))
    }

    /// Restore-DscConfiguration – revert to the previous configuration.
    pub async fn restore_configuration(
        ps_manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = "Restore-DscConfiguration -Wait -Verbose 2>&1";

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if stderr.contains("error") || stderr.contains("Error") {
            return Err(format!(
                "Restore-DscConfiguration failed: {}",
                stderr.trim()
            ));
        }

        info!(
            "DSC configuration restored on session {}",
            session_id
        );
        Ok(())
    }

    /// List available DSC resources on the remote machine.
    pub async fn get_dsc_resources(
        ps_manager: &PsSessionManager,
        session_id: &str,
        module_name: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = if let Some(module) = module_name {
            format!(
                "Get-DscResource -Module '{}' | Select-Object Name, ResourceType, ModuleName, Version, Properties | ConvertTo-Json -Depth 3",
                module
            )
        } else {
            "Get-DscResource | Select-Object Name, ResourceType, ModuleName, Version, Properties | ConvertTo-Json -Depth 3".to_string()
        };

        let (stdout, _) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        let value: serde_json::Value = serde_json::from_str(stdout.trim())
            .map_err(|e| format!("Failed to parse DSC resources: {}", e))?;

        match value {
            serde_json::Value::Array(arr) => Ok(arr),
            obj @ serde_json::Value::Object(_) => Ok(vec![obj]),
            _ => Ok(Vec::new()),
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn parse_dsc_resources(json_str: &str) -> Result<Vec<DscResourceState>, String> {
    let trimmed = json_str.trim();
    if trimmed.is_empty() || trimmed == "True" || trimmed == "False" {
        return Ok(Vec::new());
    }

    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse DSC output: {}", e))?;

    let items = match &value {
        serde_json::Value::Array(arr) => arr.clone(),
        obj @ serde_json::Value::Object(_) => {
            // Check if this is a detailed result with ResourcesInDesiredState/ResourcesNotInDesiredState
            let mut resources = Vec::new();
            if let Some(serde_json::Value::Array(arr)) = obj.get("ResourcesInDesiredState") {
                resources.extend(arr.clone());
            }
            if let Some(serde_json::Value::Array(arr)) = obj.get("ResourcesNotInDesiredState") {
                resources.extend(arr.clone());
            }
            if resources.is_empty() {
                vec![obj.clone()]
            } else {
                resources
            }
        }
        _ => return Ok(Vec::new()),
    };

    let mut result = Vec::new();
    for item in items {
        if let serde_json::Value::Object(map) = &item {
            let resource_name = map
                .get("ResourceName")
                .or_else(|| map.get("ResourceId"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();

            let module_name = map
                .get("ModuleName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let instance_name = map
                .get("InstanceName")
                .and_then(|v| v.as_str())
                .unwrap_or(&resource_name)
                .to_string();

            let in_desired_state = map
                .get("InDesiredState")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);

            let mut props = HashMap::new();
            for (key, val) in map {
                if key != "ResourceName"
                    && key != "ModuleName"
                    && key != "InstanceName"
                    && key != "InDesiredState"
                {
                    props.insert(key.clone(), val.clone());
                }
            }

            result.push(DscResourceState {
                resource_name,
                module_name,
                instance_name,
                in_desired_state,
                properties: props,
            });
        }
    }

    Ok(result)
}
