//! Session configuration management.
//!
//! Register, modify, and manage PowerShell session configurations
//! (WinRM endpoints), including custom constrained endpoints,
//! startup scripts, and access control.

use crate::session::PsSessionManager;
use crate::types::*;
use log::{debug, info};
use std::collections::HashMap;

/// Session configuration operations.
pub struct PsConfigurationManager;

impl PsConfigurationManager {
    /// Get all session configurations on a remote system.
    pub async fn get_configurations(
        ps_manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<Vec<PsSessionConfiguration>, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = r#"Get-PSSessionConfiguration | ForEach-Object {
            [PSCustomObject]@{
                Name = $_.Name
                PSVersion = if ($_.PSVersion) { $_.PSVersion.ToString() } else { $null }
                StartupScript = $_.StartupScript
                Permission = $_.Permission
                RunAsUser = $_.RunAsUser
                SessionType = $_.SessionType
                OutputBufferingMode = $_.OutputBufferingMode
                MaxReceivedCommandSizeMB = $_.MaxReceivedCommandSizeMB
                MaxReceivedObjectSizeMB = $_.MaxReceivedObjectSizeMB
                MaxSessionsPerUser = $_.MaxSessionsPerUser
                Enabled = ($_.Enabled -eq 'True')
                URI = $_.URI
                SDKVersion = if ($_.SDKVersion) { $_.SDKVersion.ToString() } else { $null }
                Architecture = $_.Architecture
                Description = $_.Description
            }
        } | ConvertTo-Json -Depth 3"#;

        let (stdout, _stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        parse_configurations(&stdout)
    }

    /// Register a new session configuration.
    pub async fn register_configuration(
        ps_manager: &PsSessionManager,
        session_id: &str,
        config: &NewSessionConfigurationParams,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let mut params = vec![format!("-Name '{}'", config.name)];

        if let Some(ref script_path) = config.startup_script {
            params.push(format!("-StartupScript '{}'", script_path));
        }
        if let Some(ref run_as) = config.run_as_credential {
            params.push(format!(
                "-RunAsCredential (New-Object PSCredential('{}', (ConvertTo-SecureString '{}' -AsPlainText -Force)))",
                run_as.username, run_as.password.as_deref().unwrap_or("")
            ));
        }
        if let Some(ref session_type) = config.session_type {
            params.push(format!("-SessionType {}", session_type));
        }
        if let Some(ref ps_version) = config.ps_version {
            params.push(format!("-PSVersion '{}'", ps_version));
        }
        if let Some(max_cmd_size) = config.max_received_command_size_mb {
            params.push(format!("-MaximumReceivedDataSizePerCommandMB {}", max_cmd_size));
        }
        if let Some(max_obj_size) = config.max_received_object_size_mb {
            params.push(format!("-MaximumReceivedObjectSizeMB {}", max_obj_size));
        }
        if let Some(ref desc) = config.description {
            params.push(format!("-Description '{}'", desc.replace('\'', "''")));
        }
        if let Some(threading) = config.use_shared_process {
            if threading {
                params.push("-UseSharedProcess".to_string());
            }
        }

        params.push("-Force".to_string());
        params.push("-NoServiceRestart".to_string());

        let script = format!("Register-PSSessionConfiguration {}", params.join(" "));

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if stderr.contains("error") || stderr.contains("Error") {
            // Filter out informational restart messages
            let real_errors: Vec<&str> = stderr
                .lines()
                .filter(|l| {
                    !l.contains("restart the WinRM service")
                        && !l.contains("WSManServiceRestartRequired")
                        && !l.trim().is_empty()
                })
                .collect();
            if !real_errors.is_empty() {
                return Err(format!(
                    "Failed to register configuration: {}",
                    real_errors.join("\n")
                ));
            }
        }

        info!("Session configuration '{}' registered", config.name);
        Ok(())
    }

    /// Unregister a session configuration.
    pub async fn unregister_configuration(
        ps_manager: &PsSessionManager,
        session_id: &str,
        config_name: &str,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = format!(
            "Unregister-PSSessionConfiguration -Name '{}' -Force -NoServiceRestart",
            config_name
        );

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if stderr.contains("error") || stderr.contains("Error") {
            let real_errors: Vec<&str> = stderr
                .lines()
                .filter(|l| {
                    !l.contains("restart the WinRM service")
                        && !l.contains("WSManServiceRestartRequired")
                        && !l.trim().is_empty()
                })
                .collect();
            if !real_errors.is_empty() {
                return Err(format!(
                    "Failed to unregister configuration: {}",
                    real_errors.join("\n")
                ));
            }
        }

        info!("Session configuration '{}' unregistered", config_name);
        Ok(())
    }

    /// Enable a session configuration.
    pub async fn enable_configuration(
        ps_manager: &PsSessionManager,
        session_id: &str,
        config_name: &str,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = format!(
            "Enable-PSSessionConfiguration -Name '{}' -Force -NoServiceRestart",
            config_name
        );

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        filter_configuration_errors(&stderr, "enable")?;

        info!("Session configuration '{}' enabled", config_name);
        Ok(())
    }

    /// Disable a session configuration.
    pub async fn disable_configuration(
        ps_manager: &PsSessionManager,
        session_id: &str,
        config_name: &str,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = format!(
            "Disable-PSSessionConfiguration -Name '{}' -Force -NoServiceRestart",
            config_name
        );

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        filter_configuration_errors(&stderr, "disable")?;

        info!("Session configuration '{}' disabled", config_name);
        Ok(())
    }

    /// Set access permissions on a session configuration.
    pub async fn set_configuration_access(
        ps_manager: &PsSessionManager,
        session_id: &str,
        config_name: &str,
        sddl: &str,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = format!(
            "Set-PSSessionConfiguration -Name '{}' -SecurityDescriptorSddl '{}' -Force -NoServiceRestart",
            config_name, sddl
        );

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        filter_configuration_errors(&stderr, "set access on")?;
        Ok(())
    }

    /// Modify a session configuration.
    pub async fn set_configuration(
        ps_manager: &PsSessionManager,
        session_id: &str,
        config_name: &str,
        params: &SetSessionConfigurationParams,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let mut args = vec![format!("-Name '{}'", config_name)];

        if let Some(ref startup) = params.startup_script {
            args.push(format!("-StartupScript '{}'", startup));
        }
        if let Some(max_cmd) = params.max_received_command_size_mb {
            args.push(format!("-MaximumReceivedDataSizePerCommandMB {}", max_cmd));
        }
        if let Some(max_obj) = params.max_received_object_size_mb {
            args.push(format!("-MaximumReceivedObjectSizeMB {}", max_obj));
        }
        if let Some(max_sessions) = params.max_sessions_per_user {
            args.push(format!("-MaxSessions {}", max_sessions));
        }
        if let Some(ref desc) = params.description {
            args.push(format!("-Description '{}'", desc.replace('\'', "''")));
        }
        if let Some(ref output_mode) = params.output_buffering_mode {
            args.push(format!("-OutputBufferingMode {}", output_mode));
        }

        args.push("-Force".to_string());
        args.push("-NoServiceRestart".to_string());

        let script = format!("Set-PSSessionConfiguration {}", args.join(" "));

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        filter_configuration_errors(&stderr, "set")?;

        info!("Session configuration '{}' updated", config_name);
        Ok(())
    }

    /// Restart WinRM service on a remote system (required after configuration changes).
    pub async fn restart_winrm(
        ps_manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = "Restart-Service WinRM -Force";

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        // Note: restarting WinRM will likely disconnect this session
        info!("WinRM restart requested on session {}", session_id);
        Ok(())
    }

    /// Get WinRM configuration details.
    pub async fn get_winrm_config(
        ps_manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<serde_json::Value, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = r#"@{
            Service = (Get-Item WSMan:\localhost\Service\* | ForEach-Object { @{ $_.Name = $_.Value } })
            Client = (Get-Item WSMan:\localhost\Client\* | ForEach-Object { @{ $_.Name = $_.Value } })
            Shell = (Get-Item WSMan:\localhost\Shell\* | ForEach-Object { @{ $_.Name = $_.Value } })
            Listener = (Get-ChildItem WSMan:\localhost\Listener | ForEach-Object {
                $listenerPath = $_.PSPath
                @{
                    Name = $_.Name
                    Properties = (Get-ChildItem $listenerPath | ForEach-Object { @{ $_.Name = $_.Value } })
                }
            })
            MaxEnvelopeSizekb = (Get-Item WSMan:\localhost\MaxEnvelopeSizekb).Value
            MaxTimeoutms = (Get-Item WSMan:\localhost\MaxTimeoutms).Value
            MaxBatchItems = (Get-Item WSMan:\localhost\MaxBatchItems).Value
        } | ConvertTo-Json -Depth 5"#;

        let (stdout, _) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        serde_json::from_str(stdout.trim())
            .map_err(|e| format!("Failed to parse WinRM config: {}", e))
    }

    /// Configure WinRM listener (HTTP/HTTPS).
    pub async fn configure_listener(
        ps_manager: &PsSessionManager,
        session_id: &str,
        use_https: bool,
        cert_thumbprint: Option<&str>,
        port: Option<u16>,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let protocol = if use_https { "HTTPS" } else { "HTTP" };
        let port_num = port.unwrap_or(if use_https { 5986 } else { 5985 });

        let mut script = format!(
            "# Remove existing listeners for this transport\n\
             Get-ChildItem WSMan:\\localhost\\Listener | Where-Object {{ $_.Keys -contains 'Transport={}' }} | Remove-Item -Recurse -Force\n\n",
            protocol
        );

        if use_https {
            let thumbprint = cert_thumbprint
                .ok_or("Certificate thumbprint is required for HTTPS listener")?;
            script.push_str(&format!(
                "New-Item -Path WSMan:\\localhost\\Listener -Transport HTTPS -Address * -CertificateThumbPrint '{}' -Port {} -Force\n",
                thumbprint, port_num
            ));
        } else {
            script.push_str(&format!(
                "New-Item -Path WSMan:\\localhost\\Listener -Transport HTTP -Address * -Port {} -Force\n",
                port_num
            ));
        }

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if stderr.contains("error") || stderr.contains("Error") {
            return Err(format!(
                "Failed to configure {} listener: {}",
                protocol,
                stderr.trim()
            ));
        }

        info!(
            "{} listener configured on port {} for session {}",
            protocol, port_num, session_id
        );
        Ok(())
    }

    /// Set WinRM trusted hosts.
    pub async fn set_trusted_hosts(
        ps_manager: &PsSessionManager,
        session_id: &str,
        hosts: &[String],
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let hosts_value = hosts.join(",");
        let script = format!(
            "Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value '{}' -Force",
            hosts_value
        );

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if !stderr.trim().is_empty() && stderr.contains("Error") {
            return Err(format!("Failed to set trusted hosts: {}", stderr.trim()));
        }

        Ok(())
    }

    /// Get current trusted hosts.
    pub async fn get_trusted_hosts(
        ps_manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<Vec<String>, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = "(Get-Item WSMan:\\localhost\\Client\\TrustedHosts).Value";

        let (stdout, _) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        let hosts: Vec<String> = stdout
            .trim()
            .split(',')
            .filter(|h| !h.trim().is_empty())
            .map(|h| h.trim().to_string())
            .collect();

        Ok(hosts)
    }
}

// ─── Configuration Param Types ───────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSessionConfigurationParams {
    pub name: String,
    pub startup_script: Option<String>,
    pub run_as_credential: Option<PsCredential>,
    pub session_type: Option<String>,
    pub ps_version: Option<String>,
    pub max_received_command_size_mb: Option<f64>,
    pub max_received_object_size_mb: Option<f64>,
    pub description: Option<String>,
    pub use_shared_process: Option<bool>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSessionConfigurationParams {
    pub startup_script: Option<String>,
    pub max_received_command_size_mb: Option<f64>,
    pub max_received_object_size_mb: Option<f64>,
    pub max_sessions_per_user: Option<u32>,
    pub description: Option<String>,
    pub output_buffering_mode: Option<String>,
}

// ─── Helpers ─────────────────────────────────────────────────────────

fn filter_configuration_errors(stderr: &str, action: &str) -> Result<(), String> {
    if stderr.contains("error") || stderr.contains("Error") {
        let real_errors: Vec<&str> = stderr
            .lines()
            .filter(|l| {
                !l.contains("restart the WinRM service")
                    && !l.contains("WSManServiceRestartRequired")
                    && !l.trim().is_empty()
            })
            .collect();
        if !real_errors.is_empty() {
            return Err(format!(
                "Failed to {} configuration: {}",
                action,
                real_errors.join("\n")
            ));
        }
    }
    Ok(())
}

fn parse_configurations(json_str: &str) -> Result<Vec<PsSessionConfiguration>, String> {
    let trimmed = json_str.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse configurations: {}", e))?;

    let items = match &value {
        serde_json::Value::Array(arr) => arr.clone(),
        obj @ serde_json::Value::Object(_) => vec![obj.clone()],
        _ => return Ok(Vec::new()),
    };

    let mut configs = Vec::new();
    for item in items {
        if let serde_json::Value::Object(map) = &item {
            configs.push(PsSessionConfiguration {
                name: map
                    .get("Name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                ps_version: map
                    .get("PSVersion")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                startup_script: map
                    .get("StartupScript")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                permission: map
                    .get("Permission")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                run_as_user: map
                    .get("RunAsUser")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                session_type: map
                    .get("SessionType")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                output_buffering_mode: map
                    .get("OutputBufferingMode")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                max_received_command_size_mb: map
                    .get("MaxReceivedCommandSizeMB")
                    .and_then(|v| v.as_f64()),
                max_received_object_size_mb: map
                    .get("MaxReceivedObjectSizeMB")
                    .and_then(|v| v.as_f64()),
                max_sessions_per_user: map
                    .get("MaxSessionsPerUser")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32),
                enabled: map
                    .get("Enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                uri: map.get("URI").and_then(|v| v.as_str()).map(String::from),
                sdk_version: map
                    .get("SDKVersion")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                architecture: map
                    .get("Architecture")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                description: map
                    .get("Description")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            });
        }
    }

    Ok(configs)
}
