//! Session configuration management.
//!
//! Register, modify, and manage PowerShell session configurations
//! (WinRM endpoints), including custom constrained endpoints,
//! startup scripts, and access control.

use crate::session::PsSessionManager;
use crate::types::*;
use log::info;
use zeroize::Zeroizing;

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
        let script = build_register_configuration_script(config)?;

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script.as_str()).await?;
            drop(script);
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        filter_configuration_errors(&stderr, "register")?;
        info!(
            "Session configuration registered (name_chars={})",
            config.name.chars().count()
        );
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

        let script = build_named_configuration_script(ConfigurationAction::Unregister, config_name);

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script.as_str()).await?;
            drop(script);
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        filter_configuration_errors(&stderr, "unregister")?;
        info!(
            "Session configuration unregistered (name_chars={})",
            config_name.chars().count()
        );
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

        let script = build_named_configuration_script(ConfigurationAction::Enable, config_name);

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script.as_str()).await?;
            drop(script);
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        filter_configuration_errors(&stderr, "enable")?;

        info!(
            "Session configuration enabled (name_chars={})",
            config_name.chars().count()
        );
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

        let script = build_named_configuration_script(ConfigurationAction::Disable, config_name);

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script.as_str()).await?;
            drop(script);
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        filter_configuration_errors(&stderr, "disable")?;

        info!(
            "Session configuration disabled (name_chars={})",
            config_name.chars().count()
        );
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

        let script = build_configuration_access_script(config_name, sddl);

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script.as_str()).await?;
            drop(script);
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

        let script = build_set_configuration_script(config_name, params)?;

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script.as_str()).await?;
            drop(script);
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        filter_configuration_errors(&stderr, "set")?;

        info!(
            "Session configuration updated (name_chars={})",
            config_name.chars().count()
        );
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

        let (_, _stderr) = {
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

        let port_num = port.unwrap_or(if use_https { 5986 } else { 5985 });
        let protocol = if use_https { "HTTPS" } else { "HTTP" };
        let script = build_configure_listener_script(use_https, cert_thumbprint, port_num)?;

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script.as_str()).await?;
            drop(script);
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if stderr.contains("error") || stderr.contains("Error") {
            return Err(format!(
                "Failed to configure {} listener (remote error output omitted; {} bytes)",
                protocol,
                stderr.len()
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

        let script = build_set_trusted_hosts_script(hosts);

        let (_, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script.as_str()).await?;
            drop(script);
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if !stderr.trim().is_empty() && stderr.contains("Error") {
            return Err(format!(
                "Failed to set trusted hosts (remote error output omitted; {} bytes)",
                stderr.len()
            ));
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

/// Encode one PowerShell single-quoted string literal.
///
/// PowerShell treats every character inside a single-quoted literal as data
/// except an apostrophe, which is represented by two consecutive apostrophes.
/// This keeps semicolons, newlines, subexpressions, and backticks inside one
/// parser token without relying on a blacklist.
fn ps_single_quoted_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn finite_ps_number(parameter: &str, value: f64) -> Result<String, String> {
    if !value.is_finite() {
        return Err(format!("{parameter} must be a finite number"));
    }
    Ok(value.to_string())
}

fn assemble_configuration_script(prefix: &str, arguments: &[String]) -> Zeroizing<String> {
    let joined = Zeroizing::new(arguments.join(" "));
    Zeroizing::new(format!("{prefix} {}", joined.as_str()))
}

#[derive(Clone, Copy)]
enum ConfigurationAction {
    Unregister,
    Enable,
    Disable,
}

impl ConfigurationAction {
    fn cmdlet(self) -> &'static str {
        match self {
            Self::Unregister => "Unregister-PSSessionConfiguration",
            Self::Enable => "Enable-PSSessionConfiguration",
            Self::Disable => "Disable-PSSessionConfiguration",
        }
    }
}

fn build_register_configuration_script(
    config: &NewSessionConfigurationParams,
) -> Result<Zeroizing<String>, String> {
    let mut arguments = Zeroizing::new(vec![format!(
        "-Name {}",
        ps_single_quoted_literal(&config.name)
    )]);

    if let Some(startup_script) = config.startup_script.as_deref() {
        arguments.push(format!(
            "-StartupScript {}",
            ps_single_quoted_literal(startup_script)
        ));
    }
    if let Some(run_as) = config.run_as_credential.as_ref() {
        let username = Zeroizing::new(ps_single_quoted_literal(&run_as.username));
        let password = Zeroizing::new(ps_single_quoted_literal(
            run_as.password.as_deref().unwrap_or(""),
        ));
        arguments.push(format!(
            "-RunAsCredential ([System.Management.Automation.PSCredential]::new({}, (ConvertTo-SecureString {} -AsPlainText -Force)))",
            username.as_str(),
            password.as_str()
        ));
    }
    if let Some(session_type) = config.session_type.as_deref() {
        arguments.push(format!(
            "-SessionType {}",
            ps_single_quoted_literal(session_type)
        ));
    }
    if let Some(ps_version) = config.ps_version.as_deref() {
        arguments.push(format!(
            "-PSVersion {}",
            ps_single_quoted_literal(ps_version)
        ));
    }
    if let Some(max_command_size) = config.max_received_command_size_mb {
        arguments.push(format!(
            "-MaximumReceivedDataSizePerCommandMB {}",
            finite_ps_number("MaximumReceivedDataSizePerCommandMB", max_command_size,)?
        ));
    }
    if let Some(max_object_size) = config.max_received_object_size_mb {
        arguments.push(format!(
            "-MaximumReceivedObjectSizeMB {}",
            finite_ps_number("MaximumReceivedObjectSizeMB", max_object_size)?
        ));
    }
    if let Some(description) = config.description.as_deref() {
        arguments.push(format!(
            "-Description {}",
            ps_single_quoted_literal(description)
        ));
    }
    if config.use_shared_process == Some(true) {
        arguments.push("-UseSharedProcess".to_string());
    }
    arguments.push("-Force".to_string());
    arguments.push("-NoServiceRestart".to_string());

    Ok(assemble_configuration_script(
        "Register-PSSessionConfiguration",
        arguments.as_slice(),
    ))
}

fn build_named_configuration_script(
    action: ConfigurationAction,
    config_name: &str,
) -> Zeroizing<String> {
    Zeroizing::new(format!(
        "{} -Name {} -Force -NoServiceRestart",
        action.cmdlet(),
        ps_single_quoted_literal(config_name)
    ))
}

fn build_configuration_access_script(config_name: &str, sddl: &str) -> Zeroizing<String> {
    Zeroizing::new(format!(
        "Set-PSSessionConfiguration -Name {} -SecurityDescriptorSddl {} -Force -NoServiceRestart",
        ps_single_quoted_literal(config_name),
        ps_single_quoted_literal(sddl)
    ))
}

fn build_set_configuration_script(
    config_name: &str,
    params: &SetSessionConfigurationParams,
) -> Result<Zeroizing<String>, String> {
    let mut arguments = Zeroizing::new(vec![format!(
        "-Name {}",
        ps_single_quoted_literal(config_name)
    )]);

    if let Some(startup_script) = params.startup_script.as_deref() {
        arguments.push(format!(
            "-StartupScript {}",
            ps_single_quoted_literal(startup_script)
        ));
    }
    if let Some(max_command_size) = params.max_received_command_size_mb {
        arguments.push(format!(
            "-MaximumReceivedDataSizePerCommandMB {}",
            finite_ps_number("MaximumReceivedDataSizePerCommandMB", max_command_size,)?
        ));
    }
    if let Some(max_object_size) = params.max_received_object_size_mb {
        arguments.push(format!(
            "-MaximumReceivedObjectSizeMB {}",
            finite_ps_number("MaximumReceivedObjectSizeMB", max_object_size)?
        ));
    }
    if let Some(max_sessions) = params.max_sessions_per_user {
        arguments.push(format!("-MaxSessions {max_sessions}"));
    }
    if let Some(description) = params.description.as_deref() {
        arguments.push(format!(
            "-Description {}",
            ps_single_quoted_literal(description)
        ));
    }
    if let Some(output_mode) = params.output_buffering_mode.as_deref() {
        arguments.push(format!(
            "-OutputBufferingMode {}",
            ps_single_quoted_literal(output_mode)
        ));
    }
    arguments.push("-Force".to_string());
    arguments.push("-NoServiceRestart".to_string());

    Ok(assemble_configuration_script(
        "Set-PSSessionConfiguration",
        arguments.as_slice(),
    ))
}

fn build_configure_listener_script(
    use_https: bool,
    cert_thumbprint: Option<&str>,
    port: u16,
) -> Result<Zeroizing<String>, String> {
    let protocol = if use_https { "HTTPS" } else { "HTTP" };
    let listener_key = ps_single_quoted_literal(&format!("Transport={protocol}"));
    let mut script = Zeroizing::new(format!(
        "# Remove existing listeners for this transport\n\
         Get-ChildItem WSMan:\\localhost\\Listener | Where-Object {{ $_.Keys -contains {listener_key} }} | Remove-Item -Recurse -Force\n\n"
    ));

    if use_https {
        let thumbprint =
            cert_thumbprint.ok_or("Certificate thumbprint is required for HTTPS listener")?;
        script.push_str(&format!(
            "New-Item -Path WSMan:\\localhost\\Listener -Transport HTTPS -Address * -CertificateThumbPrint {} -Port {port} -Force\n",
            ps_single_quoted_literal(thumbprint)
        ));
    } else {
        script.push_str(&format!(
            "New-Item -Path WSMan:\\localhost\\Listener -Transport HTTP -Address * -Port {port} -Force\n"
        ));
    }
    Ok(script)
}

fn build_set_trusted_hosts_script(hosts: &[String]) -> Zeroizing<String> {
    let hosts_value = Zeroizing::new(hosts.join(","));
    let hosts_literal = Zeroizing::new(ps_single_quoted_literal(hosts_value.as_str()));
    Zeroizing::new(format!(
        "Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value {} -Force",
        hosts_literal.as_str()
    ))
}

fn filter_configuration_errors(stderr: &str, action: &str) -> Result<(), String> {
    if stderr.contains("error") || stderr.contains("Error") {
        let error_bytes = stderr
            .lines()
            .filter(|l| {
                !l.contains("restart the WinRM service")
                    && !l.contains("WSManServiceRestartRequired")
                    && !l.trim().is_empty()
            })
            .map(str::len)
            .sum::<usize>();
        if error_bytes > 0 {
            return Err(format!(
                "Failed to {} configuration (remote error output omitted; {} bytes)",
                action, error_bytes
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

#[cfg(test)]
mod tests {
    use super::*;

    const UNIQUE_SECRET: &str = "SORNG_PS_CONFIG_SECRET_60f4b929";

    fn decode_single_quoted_literal(literal: &str) -> String {
        let characters = literal.chars().collect::<Vec<_>>();
        assert!(characters.len() >= 2);
        assert_eq!(characters.first(), Some(&'\''));
        assert_eq!(characters.last(), Some(&'\''));

        let mut decoded = String::new();
        let mut index = 1;
        while index < characters.len() - 1 {
            if characters[index] == '\'' {
                assert!(index + 1 < characters.len() - 1);
                assert_eq!(characters[index + 1], '\'');
                decoded.push('\'');
                index += 2;
            } else {
                decoded.push(characters[index]);
                index += 1;
            }
        }
        decoded
    }

    fn assert_literal_argument(script: &str, parameter: &str, value: &str) {
        let expected = format!("{parameter} {}", ps_single_quoted_literal(value));
        assert!(script.contains(&expected));
    }

    fn empty_registration(name: &str) -> NewSessionConfigurationParams {
        NewSessionConfigurationParams {
            name: name.to_string(),
            startup_script: None,
            run_as_credential: None,
            session_type: None,
            ps_version: None,
            max_received_command_size_mb: None,
            max_received_object_size_mb: None,
            description: None,
            use_shared_process: None,
        }
    }

    fn empty_update() -> SetSessionConfigurationParams {
        SetSessionConfigurationParams {
            startup_script: None,
            max_received_command_size_mb: None,
            max_received_object_size_mb: None,
            max_sessions_per_user: None,
            description: None,
            output_buffering_mode: None,
        }
    }

    #[test]
    fn single_quoted_encoder_preserves_adversarial_values_as_one_literal() {
        for value in [
            "",
            "O'Brien",
            "name; Remove-Item C:\\\\*",
            "first line\nsecond line",
            "$(Get-Content env:SECRET)",
            "`$(whoami)`",
            UNIQUE_SECRET,
            "prefix'; Write-Output $(Get-Secret); #\n`suffix",
        ] {
            let encoded = ps_single_quoted_literal(value);
            assert_eq!(decode_single_quoted_literal(&encoded), value);
        }
    }

    #[test]
    fn every_configuration_builder_quotes_untrusted_strings() {
        let hostile = "O'Brien'; Write-Output $(Get-Secret); #\n`tail";
        let password = format!("{UNIQUE_SECRET}'; Invoke-Expression $(Get-Secret)");
        let mut registration = empty_registration(hostile);
        registration.startup_script = Some(hostile.to_string());
        registration.run_as_credential = Some(PsCredential {
            username: hostile.to_string(),
            password: Some(password.clone()),
            domain: None,
            certificate_path: None,
            certificate_thumbprint: None,
            private_key_path: None,
            ssh_key_path: None,
        });
        registration.session_type = Some(hostile.to_string());
        registration.ps_version = Some(hostile.to_string());
        registration.description = Some(hostile.to_string());
        registration.max_received_command_size_mb = Some(12.5);
        registration.max_received_object_size_mb = Some(7.25);
        registration.use_shared_process = Some(true);

        let registration_debug = format!("{registration:?}");
        assert!(!registration_debug.contains(UNIQUE_SECRET));
        assert!(registration_debug.contains("[redacted]"));

        let register_script = build_register_configuration_script(&registration)
            .expect("finite registration parameters");
        assert_literal_argument(register_script.as_str(), "-Name", hostile);
        assert_literal_argument(register_script.as_str(), "-StartupScript", hostile);
        assert_literal_argument(register_script.as_str(), "-SessionType", hostile);
        assert_literal_argument(register_script.as_str(), "-PSVersion", hostile);
        assert_literal_argument(register_script.as_str(), "-Description", hostile);
        assert!(register_script.contains(&format!(
            "PSCredential]::new({},",
            ps_single_quoted_literal(hostile)
        )));
        assert!(register_script.contains(&format!(
            "ConvertTo-SecureString {} -AsPlainText",
            ps_single_quoted_literal(&password)
        )));

        let named_script = build_named_configuration_script(ConfigurationAction::Enable, hostile);
        assert_literal_argument(named_script.as_str(), "-Name", hostile);

        let access_script = build_configuration_access_script(hostile, hostile);
        assert_literal_argument(access_script.as_str(), "-Name", hostile);
        assert_literal_argument(access_script.as_str(), "-SecurityDescriptorSddl", hostile);

        let mut update = empty_update();
        update.startup_script = Some(hostile.to_string());
        update.description = Some(hostile.to_string());
        update.output_buffering_mode = Some(hostile.to_string());
        let update_script =
            build_set_configuration_script(hostile, &update).expect("finite update parameters");
        assert_literal_argument(update_script.as_str(), "-Name", hostile);
        assert_literal_argument(update_script.as_str(), "-StartupScript", hostile);
        assert_literal_argument(update_script.as_str(), "-Description", hostile);
        assert_literal_argument(update_script.as_str(), "-OutputBufferingMode", hostile);

        let listener_script =
            build_configure_listener_script(true, Some(hostile), 5986).expect("HTTPS thumbprint");
        assert_literal_argument(listener_script.as_str(), "-CertificateThumbPrint", hostile);

        let hosts = vec![hostile.to_string(), "second;$(host)".to_string()];
        let hosts_script = build_set_trusted_hosts_script(&hosts);
        assert_literal_argument(hosts_script.as_str(), "-Value", &hosts.join(","));
    }

    #[test]
    fn nonfinite_configuration_numbers_are_rejected() {
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(finite_ps_number("TestParameter", value).is_err());

            let mut registration = empty_registration("finite-check");
            registration.max_received_command_size_mb = Some(value);
            assert!(build_register_configuration_script(&registration).is_err());

            let mut update = empty_update();
            update.max_received_object_size_mb = Some(value);
            assert!(build_set_configuration_script("finite-check", &update).is_err());
        }
    }

    #[test]
    fn remote_configuration_errors_omit_untrusted_output() {
        let stderr = format!("Error: remote detail includes {UNIQUE_SECRET}");
        let error =
            filter_configuration_errors(&stderr, "register").expect_err("remote error should fail");

        assert!(error.contains("remote error output omitted"));
        assert!(!error.contains(UNIQUE_SECRET));
    }
}
