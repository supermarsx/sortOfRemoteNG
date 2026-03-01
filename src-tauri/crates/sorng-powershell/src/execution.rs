//! PowerShell command and script block execution.
//!
//! Implements Invoke-Command semantics including script block execution,
//! argument passing, fan-out to multiple computers, background jobs,
//! and streaming output collection.

use crate::serialization;
use crate::session::PsSessionManager;
use crate::transport::WinRmTransport;
use crate::types::*;
use chrono::Utc;
use log::{debug, error, info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

// ─── Command Executor ────────────────────────────────────────────────────────

/// Executes PowerShell commands on remote sessions.
pub struct PsCommandExecutor {
    /// Active invocations by invocation ID
    invocations: HashMap<String, PsInvocation>,
}

/// Tracks a single command invocation.
struct PsInvocation {
    pub id: String,
    pub session_id: String,
    pub command_id: String,
    pub command: String,
    pub state: PsInvocationState,
    pub started_at: chrono::DateTime<Utc>,
    pub output: Vec<PsStreamRecord>,
}

impl PsCommandExecutor {
    pub fn new() -> Self {
        Self {
            invocations: HashMap::new(),
        }
    }

    /// Execute a PowerShell script block on a session.
    pub async fn invoke_command(
        &mut self,
        manager: &mut PsSessionManager,
        params: PsInvokeCommandParams,
    ) -> Result<PsCommandOutput, String> {
        let session_id = params
            .session_id
            .as_ref()
            .ok_or("Session ID is required")?;

        // Validate session state
        let session = manager.get_session(session_id)?;
        if session.state != PsSessionState::Opened {
            return Err(format!(
                "Session '{}' is not in Opened state (current: {:?})",
                session_id, session.state
            ));
        }
        if session.availability == PsSessionAvailability::Busy && !params.as_job {
            return Err(format!("Session '{}' is busy", session_id));
        }

        let invocation_id = Uuid::new_v4().to_string();
        let script = build_script(&params)?;

        // Get transport and shell ID
        let transport = manager.get_transport(session_id)?;
        let shell_id = manager.get_shell_id(session_id)?;

        // Mark session as busy
        manager.mark_busy(session_id, &invocation_id);

        let started_at = Utc::now();

        // Execute the command
        debug!(
            "Invoking command {} on session {}: {}",
            invocation_id,
            session_id,
            truncate_str(&script, 200)
        );

        let command_id = {
            let mut t = transport.lock().await;
            t.execute_ps_command(&shell_id, &script).await?
        };

        // Track the invocation
        self.invocations.insert(
            invocation_id.clone(),
            PsInvocation {
                id: invocation_id.clone(),
                session_id: session_id.clone(),
                command_id: command_id.clone(),
                command: params.script_block.clone(),
                state: PsInvocationState::Running,
                started_at,
                output: Vec::new(),
            },
        );

        // If invoke-and-disconnect, disconnect the session
        if params.invoke_and_disconnect {
            info!(
                "Invoke-and-disconnect: disconnecting session {} after starting command",
                session_id
            );
            manager.disconnect_session(session_id).await?;

            return Ok(PsCommandOutput {
                invocation_id,
                session_id: session_id.clone(),
                command: params.script_block,
                state: PsInvocationState::Disconnected,
                streams: Vec::new(),
                output: Vec::new(),
                errors: Vec::new(),
                had_errors: false,
                started_at,
                completed_at: None,
                duration_ms: 0,
                raw_clixml: None,
            });
        }

        // Collect output (synchronous by default)
        if !params.as_job {
            let result = self
                .collect_output(
                    transport.clone(),
                    &shell_id,
                    &command_id,
                    session_id,
                    &invocation_id,
                    &params.script_block,
                    started_at,
                    params.timeout_sec,
                )
                .await;

            // Mark session as available
            manager.mark_available(session_id, &invocation_id);

            // Clean up invocation tracking
            self.invocations.remove(&invocation_id);

            result
        } else {
            // Background job - return immediately with Running state
            Ok(PsCommandOutput {
                invocation_id,
                session_id: session_id.clone(),
                command: params.script_block,
                state: PsInvocationState::Running,
                streams: Vec::new(),
                output: Vec::new(),
                errors: Vec::new(),
                had_errors: false,
                started_at,
                completed_at: None,
                duration_ms: 0,
                raw_clixml: None,
            })
        }
    }

    /// Execute the same script block on multiple sessions (fan-out).
    pub async fn invoke_command_fanout(
        &mut self,
        manager: &mut PsSessionManager,
        session_ids: &[String],
        params: PsInvokeCommandParams,
    ) -> Vec<Result<PsCommandOutput, String>> {
        let mut results = Vec::new();
        let throttle = params.throttle_limit.max(1) as usize;

        // Process in chunks according to throttle limit
        for chunk in session_ids.chunks(throttle) {
            let mut handles: Vec<()> = Vec::new();

            for session_id in chunk {
                let mut p = params.clone();
                p.session_id = Some(session_id.clone());

                // Note: In a real implementation, this would use proper
                // concurrent execution with Arc<Mutex<PsSessionManager>>.
                // For now, execute sequentially within each chunk.
                let result = self.invoke_command(manager, p).await;
                results.push(result);
            }
        }

        results
    }

    /// Collect output from a running command until completion.
    async fn collect_output(
        &mut self,
        transport: Arc<Mutex<WinRmTransport>>,
        shell_id: &str,
        command_id: &str,
        session_id: &str,
        invocation_id: &str,
        command_text: &str,
        started_at: chrono::DateTime<Utc>,
        timeout_sec: u32,
    ) -> Result<PsCommandOutput, String> {
        let mut all_stdout = String::new();
        let mut all_stderr = String::new();
        let timeout = if timeout_sec > 0 {
            Some(std::time::Duration::from_secs(timeout_sec as u64))
        } else {
            None
        };
        let start_time = std::time::Instant::now();

        loop {
            // Check timeout
            if let Some(to) = timeout {
                if start_time.elapsed() > to {
                    // Send terminate signal
                    let mut t = transport.lock().await;
                    let _ = t
                        .signal_command(shell_id, command_id, WsManSignal::TERMINATE)
                        .await;
                    return Err(format!(
                        "Command timed out after {} seconds",
                        timeout_sec
                    ));
                }
            }

            let (stdout, stderr, done) = {
                let mut t = transport.lock().await;
                t.receive_output(shell_id, command_id).await?
            };

            all_stdout.push_str(&stdout);
            all_stderr.push_str(&stderr);

            if done {
                break;
            }

            // Small delay to avoid busy-waiting
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        // Signal command termination (cleanup)
        {
            let mut t = transport.lock().await;
            let _ = t
                .signal_command(shell_id, command_id, WsManSignal::TERMINATE)
                .await;
        }

        let completed_at = Utc::now();
        let duration_ms = (completed_at - started_at).num_milliseconds().max(0) as u64;

        // Parse output streams
        let mut streams = Vec::new();
        let mut output_objects = Vec::new();
        let mut errors = Vec::new();
        let mut had_errors = false;

        // Parse stdout
        if !all_stdout.is_empty() {
            if all_stdout.contains(serialization::CLIXML_HEADER)
                || all_stdout.contains("<Objs")
            {
                // CLIXML output
                match serialization::parse_clixml_to_json(&all_stdout) {
                    Ok(objects) => {
                        for obj in objects {
                            output_objects.push(obj.clone());
                            streams.push(PsStreamRecord {
                                stream: PsStreamType::Output,
                                data: obj,
                                timestamp: Utc::now(),
                                exception: None,
                                progress: None,
                            });
                        }
                    }
                    Err(e) => {
                        warn!("Failed to parse CLIXML output: {}", e);
                        // Fallback: treat as plain text
                        let text = serde_json::Value::String(all_stdout.clone());
                        output_objects.push(text.clone());
                        streams.push(PsStreamRecord {
                            stream: PsStreamType::Output,
                            data: text,
                            timestamp: Utc::now(),
                            exception: None,
                            progress: None,
                        });
                    }
                }
            } else {
                // Plain text output (line by line)
                for line in all_stdout.lines() {
                    let text = serde_json::Value::String(line.to_string());
                    output_objects.push(text.clone());
                    streams.push(PsStreamRecord {
                        stream: PsStreamType::Output,
                        data: text,
                        timestamp: Utc::now(),
                        exception: None,
                        progress: None,
                    });
                }
            }
        }

        // Parse stderr
        if !all_stderr.is_empty() {
            had_errors = true;
            let parsed_errors = serialization::parse_error_stream(&all_stderr);
            if !parsed_errors.is_empty() {
                errors = parsed_errors;
            } else {
                // Plain text errors
                for line in all_stderr.lines() {
                    if !line.trim().is_empty() {
                        errors.push(PsErrorRecord {
                            exception_type: "System.Management.Automation.RemoteException"
                                .to_string(),
                            message: line.to_string(),
                            fully_qualified_error_id: None,
                            category: None,
                            target_object: None,
                            script_stack_trace: None,
                            invocation_info: None,
                            pipeline_iteration_info: None,
                        });
                    }
                }
            }

            for error in &errors {
                streams.push(PsStreamRecord {
                    stream: PsStreamType::Error,
                    data: serde_json::to_value(error).unwrap_or(serde_json::Value::Null),
                    timestamp: Utc::now(),
                    exception: Some(error.clone()),
                    progress: None,
                });
            }
        }

        let state = if had_errors {
            PsInvocationState::Failed
        } else {
            PsInvocationState::Completed
        };

        info!(
            "Command {} completed in {}ms (state: {:?}, {} output objects, {} errors)",
            invocation_id,
            duration_ms,
            state,
            output_objects.len(),
            errors.len()
        );

        Ok(PsCommandOutput {
            invocation_id: invocation_id.to_string(),
            session_id: session_id.to_string(),
            command: command_text.to_string(),
            state,
            streams,
            output: output_objects,
            errors,
            had_errors,
            started_at,
            completed_at: Some(completed_at),
            duration_ms,
            raw_clixml: if all_stdout.contains(serialization::CLIXML_HEADER) {
                Some(all_stdout)
            } else {
                None
            },
        })
    }

    /// Stop a running command (send Ctrl+C).
    pub async fn stop_command(
        &mut self,
        manager: &PsSessionManager,
        invocation_id: &str,
    ) -> Result<(), String> {
        let invocation = self
            .invocations
            .get(invocation_id)
            .ok_or_else(|| format!("Invocation '{}' not found", invocation_id))?;

        if invocation.state != PsInvocationState::Running {
            return Err(format!(
                "Cannot stop invocation in state {:?}",
                invocation.state
            ));
        }

        let transport = manager.get_transport(&invocation.session_id)?;
        let shell_id = manager.get_shell_id(&invocation.session_id)?;

        let mut t = transport.lock().await;
        t.signal_command(&shell_id, &invocation.command_id, WsManSignal::CTRL_C)
            .await?;

        if let Some(inv) = self.invocations.get_mut(invocation_id) {
            inv.state = PsInvocationState::Stopping;
        }

        info!("Stop signal sent to invocation {}", invocation_id);
        Ok(())
    }

    /// Get the state of a command invocation.
    pub fn get_invocation_state(&self, invocation_id: &str) -> Option<PsInvocationState> {
        self.invocations.get(invocation_id).map(|i| i.state.clone())
    }

    /// List all active invocations.
    pub fn list_invocations(&self) -> Vec<(String, String, PsInvocationState)> {
        self.invocations
            .values()
            .map(|i| (i.id.clone(), i.session_id.clone(), i.state.clone()))
            .collect()
    }
}

// ─── Script Builder ──────────────────────────────────────────────────────────

/// Build the effective PowerShell script from invocation parameters.
fn build_script(params: &PsInvokeCommandParams) -> Result<String, String> {
    let mut script = String::new();

    // If a file path is specified, read and use that instead of script block
    if let Some(ref file_path) = params.file_path {
        script.push_str(&format!(
            "& {{ . '{}' ",
            file_path.replace('\'', "''")
        ));
    } else if let Some(ref command_name) = params.command_name {
        // Direct command execution
        script.push_str(&format!("{} ", command_name));
    } else {
        // Script block execution
        script.push_str("& { ");
        script.push_str(&params.script_block);
        script.push(' ');
    }

    // Add named parameters
    if !params.parameters.is_empty() {
        for (key, value) in &params.parameters {
            script.push_str(&format!("-{} {} ", key, ps_value_to_arg(value)));
        }
    }

    // Add positional arguments
    if !params.argument_list.is_empty() {
        for arg in &params.argument_list {
            script.push_str(&format!("{} ", ps_value_to_arg(arg)));
        }
    }

    // Close the script block wrapper
    if params.file_path.is_some() || params.command_name.is_none() {
        script.push('}');
    }

    // Wrap with input object piping if provided
    if !params.input_object.is_empty() {
        let input_json = serde_json::to_string(&params.input_object)
            .map_err(|e| format!("Failed to serialize input objects: {}", e))?;
        let wrapped = format!(
            "('{}' | ConvertFrom-Json) | ForEach-Object {{ $_ }} | {}",
            input_json.replace('\'', "''"),
            script
        );
        return Ok(wrapped);
    }

    // Add output formatting if not hiding computer name
    if !params.hide_computer_name {
        // Note: PSComputerName is automatically added by real PS remoting
    }

    Ok(script)
}

/// Convert a JSON value to a PowerShell argument string.
fn ps_value_to_arg(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "$null".to_string(),
        serde_json::Value::Bool(b) => {
            if *b {
                "$true".to_string()
            } else {
                "$false".to_string()
            }
        }
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => format!("'{}'", s.replace('\'', "''")),
        serde_json::Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(ps_value_to_arg).collect();
            format!("@({})", items.join(", "))
        }
        serde_json::Value::Object(map) => {
            let items: Vec<String> = map
                .iter()
                .map(|(k, v)| format!("'{}' = {}", k.replace('\'', "''"), ps_value_to_arg(v)))
                .collect();
            format!("@{{{}}}", items.join("; "))
        }
    }
}

/// Truncate a string for logging purposes.
fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() > max_len {
        format!("{}...", &s[..max_len])
    } else {
        s.to_string()
    }
}

// ─── Common PowerShell Commands ──────────────────────────────────────────────

/// Pre-built script templates for common operations.
pub struct PsScriptTemplates;

impl PsScriptTemplates {
    /// Get-Process equivalent.
    pub fn get_process(name: Option<&str>) -> String {
        match name {
            Some(n) => format!("Get-Process -Name '{}' | ConvertTo-Json -Depth 3", n),
            None => "Get-Process | ConvertTo-Json -Depth 3".to_string(),
        }
    }

    /// Get-Service equivalent.
    pub fn get_service(name: Option<&str>) -> String {
        match name {
            Some(n) => format!(
                "Get-Service -Name '{}' | Select-Object Name, Status, DisplayName, StartType | ConvertTo-Json -Depth 3",
                n
            ),
            None => "Get-Service | Select-Object Name, Status, DisplayName, StartType | ConvertTo-Json -Depth 3".to_string(),
        }
    }

    /// Get system information.
    pub fn get_system_info() -> String {
        r#"@{
    ComputerName = $env:COMPUTERNAME
    OSVersion = [System.Environment]::OSVersion.VersionString
    PSVersion = $PSVersionTable.PSVersion.ToString()
    CLRVersion = $PSVersionTable.CLRVersion?.ToString()
    Architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    TotalMemoryMB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB, 2)
    Uptime = (Get-Uptime).ToString()
    CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    Domain = [System.Net.Dns]::GetHostEntry('').HostName
    IPAddresses = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' }).IPAddress
} | ConvertTo-Json -Depth 3"#
            .to_string()
    }

    /// Get event log entries.
    pub fn get_event_log(log_name: &str, count: u32) -> String {
        format!(
            "Get-WinEvent -LogName '{}' -MaxEvents {} | Select-Object TimeCreated, Id, LevelDisplayName, Message | ConvertTo-Json -Depth 3",
            log_name, count
        )
    }

    /// Restart a service.
    pub fn restart_service(name: &str) -> String {
        format!("Restart-Service -Name '{}' -Force -PassThru | Select-Object Name, Status | ConvertTo-Json", name)
    }

    /// Get disk information.
    pub fn get_disk_info() -> String {
        "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, DriveType, @{N='SizeGB';E={[math]::Round($_.Size/1GB,2)}}, @{N='FreeGB';E={[math]::Round($_.FreeSpace/1GB,2)}}, @{N='PercentFree';E={[math]::Round($_.FreeSpace/$_.Size*100,1)}} | ConvertTo-Json -Depth 3".to_string()
    }

    /// Get installed software.
    pub fn get_installed_software() -> String {
        "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Select-Object DisplayName, DisplayVersion, Publisher, InstallDate | Where-Object { $_.DisplayName } | Sort-Object DisplayName | ConvertTo-Json -Depth 3".to_string()
    }

    /// Execute a file integrity check (hash).
    pub fn get_file_hash(path: &str, algorithm: &str) -> String {
        format!(
            "Get-FileHash -Path '{}' -Algorithm {} | ConvertTo-Json",
            path, algorithm
        )
    }

    /// Get Windows Update history.
    pub fn get_update_history(count: u32) -> String {
        format!(
            "Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First {} | ConvertTo-Json -Depth 3",
            count
        )
    }

    /// Test network connectivity.
    pub fn test_connection(target: &str, count: u32) -> String {
        format!(
            "Test-Connection -ComputerName '{}' -Count {} | ConvertTo-Json -Depth 3",
            target, count
        )
    }

    /// Get firewall rules.
    pub fn get_firewall_rules(enabled_only: bool) -> String {
        if enabled_only {
            "Get-NetFirewallRule -Enabled True | Select-Object Name, DisplayName, Direction, Action, Profile | ConvertTo-Json -Depth 3".to_string()
        } else {
            "Get-NetFirewallRule | Select-Object Name, DisplayName, Direction, Action, Profile, Enabled | ConvertTo-Json -Depth 3".to_string()
        }
    }

    /// Get scheduled tasks.
    pub fn get_scheduled_tasks() -> String {
        "Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' } | Select-Object TaskName, TaskPath, State, @{N='NextRun';E={(Get-ScheduledTaskInfo $_.TaskName -ErrorAction SilentlyContinue).NextRunTime}} | ConvertTo-Json -Depth 3".to_string()
    }

    /// Get local users.
    pub fn get_local_users() -> String {
        "Get-LocalUser | Select-Object Name, Enabled, LastLogon, PasswordRequired, UserMayChangePassword, Description | ConvertTo-Json -Depth 3".to_string()
    }

    /// Get local group members.
    pub fn get_local_group_members(group: &str) -> String {
        format!(
            "Get-LocalGroupMember -Group '{}' | Select-Object Name, ObjectClass, PrincipalSource | ConvertTo-Json -Depth 3",
            group
        )
    }
}
