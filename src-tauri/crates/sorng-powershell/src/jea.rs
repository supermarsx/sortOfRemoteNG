//! Just Enough Administration (JEA) endpoint management.
//!
//! Provides tools for configuring, deploying, and managing JEA endpoints
//! (constrained PowerShell session configurations) on remote systems.

use crate::session::PsSessionManager;
use crate::types::*;
use log::{debug, info, warn};
use std::collections::HashMap;

/// JEA operations manager.
pub struct JeaManager;

impl JeaManager {
    /// Register a JEA session configuration on a remote system.
    pub async fn register_endpoint(
        ps_manager: &PsSessionManager,
        session_id: &str,
        endpoint: &JeaEndpoint,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        // Build the session configuration file content
        let pssc_content = build_pssc_content(endpoint);

        // Create the .pssc file on the remote system
        let pssc_path = format!(
            "$env:ProgramData\\JEAConfiguration\\{}.pssc",
            endpoint.name
        );

        let create_script = format!(
            "$dir = Split-Path '{}' -Parent\n\
             if (-not (Test-Path $dir)) {{ New-Item -ItemType Directory -Path $dir -Force | Out-Null }}\n\
             @'\n{}\n'@ | Set-Content -Path '{}' -Force -Encoding UTF8",
            pssc_path, pssc_content, pssc_path
        );

        {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &create_script).await?;
            let (_, stderr) = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;

            if !stderr.trim().is_empty() {
                return Err(format!(
                    "Failed to create JEA configuration file: {}",
                    stderr.trim()
                ));
            }
        }

        // Register the session configuration
        let register_script = format!(
            "Register-PSSessionConfiguration -Name '{}' -Path '{}' -Force",
            endpoint.name, pssc_path
        );

        {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &register_script).await?;
            let (_, stderr) = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;

            if stderr.contains("error") || stderr.contains("Error") {
                return Err(format!(
                    "Failed to register JEA endpoint: {}",
                    stderr.trim()
                ));
            }
        }

        info!(
            "JEA endpoint '{}' registered on session {}",
            endpoint.name, session_id
        );
        Ok(())
    }

    /// Unregister a JEA session configuration.
    pub async fn unregister_endpoint(
        ps_manager: &PsSessionManager,
        session_id: &str,
        endpoint_name: &str,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = format!(
            "Unregister-PSSessionConfiguration -Name '{}' -Force -NoServiceRestart",
            endpoint_name
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
            return Err(format!(
                "Failed to unregister JEA endpoint: {}",
                stderr.trim()
            ));
        }

        info!(
            "JEA endpoint '{}' unregistered from session {}",
            endpoint_name, session_id
        );
        Ok(())
    }

    /// List all registered session configurations on a remote system.
    pub async fn list_endpoints(
        ps_manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<Vec<PsSessionConfiguration>, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = r#"Get-PSSessionConfiguration | Select-Object Name, PSVersion, StartupScript, Permission, RunAsUser, SessionType, OutputBufferingMode, MaxReceivedCommandSizeMB, MaxReceivedObjectSizeMB, MaxSessionsPerUser, @{N='Enabled';E={$_.Enabled -eq 'True'}}, URI, SDKVersion, Architecture, Description | ConvertTo-Json -Depth 3"#;

        let (stdout, _) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        parse_session_configurations(&stdout)
    }

    /// Get details of a specific JEA endpoint.
    pub async fn get_endpoint_details(
        ps_manager: &PsSessionManager,
        session_id: &str,
        endpoint_name: &str,
    ) -> Result<serde_json::Value, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = format!(
            "Get-PSSessionConfiguration -Name '{}' | ConvertTo-Json -Depth 5",
            endpoint_name
        );

        let (stdout, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if !stderr.trim().is_empty() {
            return Err(format!(
                "Failed to get endpoint details: {}",
                stderr.trim()
            ));
        }

        serde_json::from_str(stdout.trim())
            .map_err(|e| format!("Failed to parse endpoint details: {}", e))
    }

    /// Create a role capability file (.psrc) on a remote system.
    pub async fn create_role_capability(
        ps_manager: &PsSessionManager,
        session_id: &str,
        role_name: &str,
        capability: &JeaRoleCapability,
    ) -> Result<String, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let psrc_content = build_psrc_content(role_name, capability);
        let psrc_path = format!(
            "$env:ProgramFiles\\WindowsPowerShell\\Modules\\JEARoles\\RoleCapabilities\\{}.psrc",
            role_name
        );

        let script = format!(
            "$dir = Split-Path '{}' -Parent\n\
             if (-not (Test-Path $dir)) {{ New-Item -ItemType Directory -Path $dir -Force | Out-Null }}\n\
             @'\n{}\n'@ | Set-Content -Path '{}' -Force -Encoding UTF8\n\
             Write-Output '{}'",
            psrc_path, psrc_content, psrc_path, psrc_path
        );

        let (stdout, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if !stderr.trim().is_empty() {
            return Err(format!(
                "Failed to create role capability: {}",
                stderr.trim()
            ));
        }

        info!("Role capability '{}' created at {}", role_name, stdout.trim());
        Ok(stdout.trim().to_string())
    }

    /// Test a JEA endpoint by checking which commands a user can run.
    pub async fn test_endpoint_access(
        ps_manager: &PsSessionManager,
        session_id: &str,
        endpoint_name: &str,
        username: &str,
    ) -> Result<Vec<String>, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = format!(
            "$session = New-PSSession -ConfigurationName '{}' -ComputerName localhost\n\
             Invoke-Command -Session $session -ScriptBlock {{ Get-Command | Select-Object -ExpandProperty Name }}\n\
             Remove-PSSession -Session $session",
            endpoint_name
        );

        let (stdout, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if !stderr.trim().is_empty() {
            warn!("JEA endpoint test warnings: {}", stderr.trim());
        }

        let commands: Vec<String> = stdout
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| l.trim().to_string())
            .collect();

        Ok(commands)
    }

    /// Generate a JEA endpoint audit/transcript report.
    pub async fn get_transcript_log(
        ps_manager: &PsSessionManager,
        session_id: &str,
        transcript_directory: &str,
        hours: u32,
    ) -> Result<Vec<serde_json::Value>, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = format!(
            "Get-ChildItem -Path '{}' -Filter '*.txt' -Recurse | \
             Where-Object {{ $_.LastWriteTime -gt (Get-Date).AddHours(-{}) }} | \
             ForEach-Object {{ \
                 @{{ \
                     Path = $_.FullName; \
                     Size = $_.Length; \
                     LastWriteTime = $_.LastWriteTime.ToString('o'); \
                     Content = (Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue) \
                 }} \
             }} | ConvertTo-Json -Depth 3",
            transcript_directory.replace('\'', "''"),
            hours
        );

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
            .unwrap_or(serde_json::Value::Array(Vec::new()));

        match value {
            serde_json::Value::Array(arr) => Ok(arr),
            obj @ serde_json::Value::Object(_) => Ok(vec![obj]),
            _ => Ok(Vec::new()),
        }
    }
}

// ─── PSSC / PSRC Builders ────────────────────────────────────────────────────

fn build_pssc_content(endpoint: &JeaEndpoint) -> String {
    let mut lines = Vec::new();

    lines.push("@{".to_string());

    // Schema version
    lines.push("    SchemaVersion = '2.0.0.0'".to_string());

    // GUID
    let default_guid = uuid::Uuid::new_v4().to_string();
    let guid = endpoint
        .guid
        .as_deref()
        .unwrap_or(&default_guid);
    lines.push(format!("    GUID = '{}'", guid));

    // Session type
    let session_type = match endpoint.session_type {
        JeaSessionType::RestrictedRemoteServer => "RestrictedRemoteServer",
        JeaSessionType::Empty => "Empty",
        JeaSessionType::Default => "Default",
    };
    lines.push(format!("    SessionType = '{}'", session_type));

    // Language mode
    let lang_mode = match endpoint.language_mode {
        PsLanguageMode::FullLanguage => "FullLanguage",
        PsLanguageMode::RestrictedLanguage => "RestrictedLanguage",
        PsLanguageMode::ConstrainedLanguage => "ConstrainedLanguage",
        PsLanguageMode::NoLanguage => "NoLanguage",
    };
    lines.push(format!("    LanguageMode = '{}'", lang_mode));

    // Execution policy
    let exec_policy = match endpoint.execution_policy {
        PsExecutionPolicy::Unrestricted => "Unrestricted",
        PsExecutionPolicy::RemoteSigned => "RemoteSigned",
        PsExecutionPolicy::AllSigned => "AllSigned",
        PsExecutionPolicy::Restricted => "Restricted",
        PsExecutionPolicy::Bypass => "Bypass",
        PsExecutionPolicy::Undefined => "Undefined",
    };
    lines.push(format!("    ExecutionPolicy = '{}'", exec_policy));

    // Virtual account
    if endpoint.run_as_virtual_account {
        lines.push("    RunAsVirtualAccount = $true".to_string());
        if !endpoint.run_as_virtual_account_groups.is_empty() {
            let groups = endpoint
                .run_as_virtual_account_groups
                .iter()
                .map(|g| format!("'{}'", g))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!("    RunAsVirtualAccountGroups = @({})", groups));
        }
    }

    // Transcript directory
    if let Some(ref dir) = endpoint.transcript_directory {
        lines.push(format!("    TranscriptDirectory = '{}'", dir));
    }

    // Modules to import
    if !endpoint.modules_to_import.is_empty() {
        let modules = endpoint
            .modules_to_import
            .iter()
            .map(|m| format!("'{}'", m))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("    ModulesToImport = @({})", modules));
    }

    // Visible cmdlets
    if !endpoint.visible_cmdlets.is_empty() {
        let cmdlets = endpoint
            .visible_cmdlets
            .iter()
            .map(|c| format!("'{}'", c))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("    VisibleCmdlets = @({})", cmdlets));
    }

    // Visible functions
    if !endpoint.visible_functions.is_empty() {
        let funcs = endpoint
            .visible_functions
            .iter()
            .map(|f| format!("'{}'", f))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("    VisibleFunctions = @({})", funcs));
    }

    // Visible providers
    if !endpoint.visible_providers.is_empty() {
        let provs = endpoint
            .visible_providers
            .iter()
            .map(|p| format!("'{}'", p))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("    VisibleProviders = @({})", provs));
    }

    // Visible external commands
    if !endpoint.visible_external_commands.is_empty() {
        let cmds = endpoint
            .visible_external_commands
            .iter()
            .map(|c| format!("'{}'", c))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("    VisibleExternalCommands = @({})", cmds));
    }

    // Role definitions
    if !endpoint.role_definitions.is_empty() {
        lines.push("    RoleDefinitions = @{".to_string());
        for (group, role) in &endpoint.role_definitions {
            let role_files = role
                .role_capability_files
                .iter()
                .map(|f| format!("'{}'", f))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!(
                "        '{}' = @{{ RoleCapabilities = @({}) }}",
                group, role_files
            ));
        }
        lines.push("    }".to_string());
    }

    // Description
    if let Some(ref desc) = endpoint.description {
        lines.push(format!("    Description = '{}'", desc.replace('\'', "''")));
    }

    // Environment variables
    if !endpoint.environment_variables.is_empty() {
        lines.push("    EnvironmentVariables = @{".to_string());
        for (key, value) in &endpoint.environment_variables {
            lines.push(format!("        '{}' = '{}'", key, value));
        }
        lines.push("    }".to_string());
    }

    lines.push("}".to_string());
    lines.join("\n")
}

fn build_psrc_content(role_name: &str, capability: &JeaRoleCapability) -> String {
    let mut lines = Vec::new();

    lines.push("@{".to_string());

    // Module version
    lines.push("    ModuleVersion = '1.0.0.0'".to_string());
    lines.push(format!("    GUID = '{}'", uuid::Uuid::new_v4()));

    // Visible cmdlets
    if !capability.visible_cmdlets.is_empty() {
        let cmdlets = capability
            .visible_cmdlets
            .iter()
            .map(|c| format!("'{}'", c))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("    VisibleCmdlets = @({})", cmdlets));
    }

    // Visible functions
    if !capability.visible_functions.is_empty() {
        let funcs = capability
            .visible_functions
            .iter()
            .map(|f| format!("'{}'", f))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("    VisibleFunctions = @({})", funcs));
    }

    // Visible providers
    if !capability.visible_providers.is_empty() {
        let providers = capability
            .visible_providers
            .iter()
            .map(|p| format!("'{}'", p))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("    VisibleProviders = @({})", providers));
    }

    // Visible external commands
    if !capability.visible_external_commands.is_empty() {
        let cmds = capability
            .visible_external_commands
            .iter()
            .map(|c| format!("'{}'", c))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("    VisibleExternalCommands = @({})", cmds));
    }

    // Function definitions
    if !capability.function_definitions.is_empty() {
        lines.push("    FunctionDefinitions = @{".to_string());
        for (name, body) in &capability.function_definitions {
            lines.push(format!(
                "        '{}' = @{{ ScriptBlock = '{}' }}",
                name,
                body.replace('\'', "''")
            ));
        }
        lines.push("    }".to_string());
    }

    lines.push("}".to_string());
    lines.join("\n")
}

fn parse_session_configurations(json_str: &str) -> Result<Vec<PsSessionConfiguration>, String> {
    let trimmed = json_str.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse session configurations: {}", e))?;

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
                ps_version: map.get("PSVersion").and_then(|v| v.as_str()).map(String::from),
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
