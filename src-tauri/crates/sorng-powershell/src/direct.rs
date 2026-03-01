//! PowerShell Direct — Hyper-V VM connections.
//!
//! Enables PowerShell Remoting directly into Hyper-V VMs via the VMBus
//! (no network required). Supports Enter-PSSession -VMName and
//! Invoke-Command -VMName semantics.

use crate::session::PsSessionManager;
use crate::types::*;
use log::{debug, info, warn};
use std::collections::HashMap;
use tokio::sync::Mutex;
use std::sync::Arc;

/// Manager for PowerShell Direct (Hyper-V VM) sessions.
pub struct PsDirectManager {
    /// Maps VM session IDs → host session IDs (the Hyper-V host session).
    vm_sessions: HashMap<String, VmSessionEntry>,
}

struct VmSessionEntry {
    host_session_id: String,
    vm_name: String,
    vm_id: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
}

impl PsDirectManager {
    pub fn new() -> Self {
        Self {
            vm_sessions: HashMap::new(),
        }
    }

    /// List Hyper-V VMs on a remote host.
    pub async fn list_vms(
        ps_manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<Vec<HyperVVmInfo>, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = r#"Get-VM | Select-Object Name, Id, State, Status, Uptime, MemoryAssigned, ProcessorCount, Generation, Version, Path, @{N='IntegrationServicesVersion';E={$_.IntegrationServicesVersion.ToString()}} | ConvertTo-Json -Depth 3"#;

        let (stdout, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        if stderr.contains("is not recognized") {
            return Err(
                "Hyper-V module is not available on the target. Ensure Hyper-V role is installed."
                    .to_string(),
            );
        }

        parse_vm_list(&stdout)
    }

    /// Execute a command inside a Hyper-V VM via PowerShell Direct.
    pub async fn invoke_command_vm(
        ps_manager: &PsSessionManager,
        session_id: &str,
        config: &PsDirectConfig,
        script: &str,
    ) -> Result<PsCommandOutput, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let vm_target = if let Some(ref id) = config.vm_id {
            format!("-VMId '{}'", id)
        } else {
            format!("-VMName '{}'", config.vm_name.as_deref().unwrap_or(""))
        };

        let cred_block = format_credential_block(&config.credential);

        // Build the Invoke-Command call that targets the VM
        let ps_script = format!(
            "{}\n\
             $result = Invoke-Command {} -Credential $cred -ScriptBlock {{\n\
                 {}\n\
             }} -ErrorAction Stop 2>&1\n\
             $result | ForEach-Object {{\n\
                 if ($_ -is [System.Management.Automation.ErrorRecord]) {{\n\
                     Write-Error $_.ToString()\n\
                 }} else {{\n\
                     $_\n\
                 }}\n\
             }}",
            cred_block, vm_target, script
        );

        let start_time = chrono::Utc::now();

        let (stdout, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &ps_script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        let end_time = chrono::Utc::now();
        let had_errors = !stderr.trim().is_empty();

        let output = PsCommandOutput {
            invocation_id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            command: script.to_string(),
            state: if had_errors {
                PsInvocationState::Failed
            } else {
                PsInvocationState::Completed
            },
            streams: build_stream_records(&stdout, &stderr),
            output: if stdout.trim().is_empty() { Vec::new() } else { vec![serde_json::Value::String(stdout.clone())] },
            errors: Vec::new(),
            had_errors,
            started_at: start_time,
            completed_at: Some(end_time),
            duration_ms: (end_time - start_time).num_milliseconds().max(0) as u64,
            raw_clixml: None,
        };

        Ok(output)
    }

    /// Enter an interactive PS Direct session with a VM.
    pub async fn enter_vm_session(
        &mut self,
        ps_manager: &PsSessionManager,
        host_session_id: &str,
        config: &PsDirectConfig,
    ) -> Result<String, String> {
        let transport = ps_manager.get_transport(host_session_id)?;
        let shell_id = ps_manager.get_shell_id(host_session_id)?;

        let vm_target = if let Some(ref id) = config.vm_id {
            format!("-VMId '{}'", id)
        } else {
            format!("-VMName '{}'", config.vm_name.as_deref().unwrap_or(""))
        };

        let cred_block = format_credential_block(&config.credential);

        // Create a PSSession to the VM
        let script = format!(
            "{}\n\
             $vmSession = New-PSSession {} -Credential $cred\n\
             $vmSession.Id",
            cred_block, vm_target
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
            return Err(format!("Failed to create VM session: {}", stderr.trim()));
        }

        let vm_session_id = uuid::Uuid::new_v4().to_string();

        self.vm_sessions.insert(
            vm_session_id.clone(),
            VmSessionEntry {
                host_session_id: host_session_id.to_string(),
                vm_name: config.vm_name.clone().unwrap_or_default(),
                vm_id: config.vm_id.clone(),
                created_at: chrono::Utc::now(),
            },
        );

        info!(
            "VM session {} created for VM '{}' via host session {}",
            vm_session_id, config.vm_name.as_deref().unwrap_or(""), host_session_id
        );

        Ok(vm_session_id)
    }

    /// Execute a command on a VM session that was previously created.
    pub async fn execute_on_vm_session(
        &self,
        ps_manager: &PsSessionManager,
        vm_session_id: &str,
        command: &str,
    ) -> Result<PsCommandOutput, String> {
        let entry = self
            .vm_sessions
            .get(vm_session_id)
            .ok_or_else(|| format!("VM session '{}' not found", vm_session_id))?;

        let transport = ps_manager.get_transport(&entry.host_session_id)?;
        let shell_id = ps_manager.get_shell_id(&entry.host_session_id)?;

        let script = format!(
            "$vmSession = Get-PSSession | Where-Object {{ $_.ComputerType -eq 'VirtualMachine' -and $_.Name -like '*{}*' }} | Select-Object -First 1\n\
             if ($vmSession) {{\n\
                 Invoke-Command -Session $vmSession -ScriptBlock {{ {} }}\n\
             }} else {{\n\
                 Write-Error 'VM session not found. It may have been disconnected.'\n\
             }}",
            entry.vm_name, command
        );

        let start_time = chrono::Utc::now();

        let (stdout, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        let end_time = chrono::Utc::now();
        let had_errors = !stderr.trim().is_empty();

        Ok(PsCommandOutput {
            invocation_id: uuid::Uuid::new_v4().to_string(),
            session_id: entry.host_session_id.clone(),
            command: command.to_string(),
            state: if had_errors {
                PsInvocationState::Failed
            } else {
                PsInvocationState::Completed
            },
            streams: build_stream_records(&stdout, &stderr),
            output: if stdout.trim().is_empty() { Vec::new() } else { vec![serde_json::Value::String(stdout.clone())] },
            errors: Vec::new(),
            had_errors,
            started_at: start_time,
            completed_at: Some(end_time),
            duration_ms: (end_time - start_time).num_milliseconds().max(0) as u64,
            raw_clixml: None,
        })
    }

    /// Copy a file into a VM via PowerShell Direct.
    pub async fn copy_to_vm(
        ps_manager: &PsSessionManager,
        host_session_id: &str,
        config: &PsDirectConfig,
        source_path: &str,
        destination_path: &str,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(host_session_id)?;
        let shell_id = ps_manager.get_shell_id(host_session_id)?;

        let vm_target = if let Some(ref id) = config.vm_id {
            format!("-VMId '{}'", id)
        } else {
            format!("-VMName '{}'", config.vm_name.as_deref().unwrap_or(""))
        };

        let cred_block = format_credential_block(&config.credential);

        let script = format!(
            "{}\n\
             $vmSession = New-PSSession {} -Credential $cred\n\
             Copy-Item -Path '{}' -Destination '{}' -ToSession $vmSession -Force\n\
             Remove-PSSession -Session $vmSession",
            cred_block, vm_target, source_path, destination_path
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

        if !stderr.trim().is_empty() {
            return Err(format!("Failed to copy file to VM: {}", stderr.trim()));
        }

        Ok(())
    }

    /// Copy a file from a VM via PowerShell Direct.
    pub async fn copy_from_vm(
        ps_manager: &PsSessionManager,
        host_session_id: &str,
        config: &PsDirectConfig,
        source_path: &str,
        destination_path: &str,
    ) -> Result<(), String> {
        let transport = ps_manager.get_transport(host_session_id)?;
        let shell_id = ps_manager.get_shell_id(host_session_id)?;

        let vm_target = if let Some(ref id) = config.vm_id {
            format!("-VMId '{}'", id)
        } else {
            format!("-VMName '{}'", config.vm_name.as_deref().unwrap_or(""))
        };

        let cred_block = format_credential_block(&config.credential);

        let script = format!(
            "{}\n\
             $vmSession = New-PSSession {} -Credential $cred\n\
             Copy-Item -Path '{}' -Destination '{}' -FromSession $vmSession -Force\n\
             Remove-PSSession -Session $vmSession",
            cred_block, vm_target, source_path, destination_path
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

        if !stderr.trim().is_empty() {
            return Err(format!("Failed to copy file from VM: {}", stderr.trim()));
        }

        Ok(())
    }

    /// Disconnect a VM session.
    pub fn remove_vm_session(&mut self, vm_session_id: &str) -> Result<(), String> {
        self.vm_sessions
            .remove(vm_session_id)
            .ok_or_else(|| format!("VM session '{}' not found", vm_session_id))?;
        Ok(())
    }

    /// List active VM sessions.
    pub fn list_vm_sessions(&self) -> Vec<VmSessionInfo> {
        self.vm_sessions
            .iter()
            .map(|(id, entry)| VmSessionInfo {
                session_id: id.clone(),
                host_session_id: entry.host_session_id.clone(),
                vm_name: entry.vm_name.clone(),
                vm_id: entry.vm_id.clone(),
                created_at: entry.created_at.to_rfc3339(),
            })
            .collect()
    }
}

// ─── Types specific to PowerShell Direct ─────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HyperVVmInfo {
    pub name: String,
    pub id: Option<String>,
    pub state: String,
    pub status: Option<String>,
    pub uptime: Option<String>,
    pub memory_assigned: Option<u64>,
    pub processor_count: Option<u32>,
    pub generation: Option<u32>,
    pub version: Option<String>,
    pub path: Option<String>,
    pub integration_services_version: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmSessionInfo {
    pub session_id: String,
    pub host_session_id: String,
    pub vm_name: String,
    pub vm_id: Option<String>,
    pub created_at: String,
}

// ─── Helpers ─────────────────────────────────────────────────────────

fn format_credential_block(credential: &PsCredential) -> String {
    format!(
        "$secpass = ConvertTo-SecureString '{}' -AsPlainText -Force\n\
         $cred = New-Object System.Management.Automation.PSCredential ('{}', $secpass)",
        credential.password.as_deref().unwrap_or("").replace('\'', "''"),
        credential.username.replace('\'', "''")
    )
}

fn build_stream_records(stdout: &str, stderr: &str) -> Vec<PsStreamRecord> {
    let mut records = Vec::new();

    for line in stdout.lines() {
        if !line.trim().is_empty() {
            records.push(PsStreamRecord {
                stream: PsStreamType::Output,
                data: serde_json::Value::String(line.to_string()),
                timestamp: chrono::Utc::now(),
                exception: None,
                progress: None,
            });
        }
    }

    for line in stderr.lines() {
        if !line.trim().is_empty() {
            records.push(PsStreamRecord {
                stream: PsStreamType::Error,
                data: serde_json::Value::String(line.to_string()),
                timestamp: chrono::Utc::now(),
                exception: None,
                progress: None,
            });
        }
    }

    records
}

fn parse_vm_list(json_str: &str) -> Result<Vec<HyperVVmInfo>, String> {
    let trimmed = json_str.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let value: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("Failed to parse VM list: {}", e))?;

    let items = match &value {
        serde_json::Value::Array(arr) => arr.clone(),
        obj @ serde_json::Value::Object(_) => vec![obj.clone()],
        _ => return Ok(Vec::new()),
    };

    let mut vms = Vec::new();
    for item in items {
        if let serde_json::Value::Object(map) = &item {
            vms.push(HyperVVmInfo {
                name: map
                    .get("Name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                id: map.get("Id").and_then(|v| v.as_str()).map(String::from),
                state: map
                    .get("State")
                    .and_then(|v| v.as_str())
                    .or_else(|| map.get("State").and_then(|v| v.as_u64()).map(|_| ""))
                    .unwrap_or("Unknown")
                    .to_string(),
                status: map.get("Status").and_then(|v| v.as_str()).map(String::from),
                uptime: map.get("Uptime").and_then(|v| v.as_str()).map(String::from),
                memory_assigned: map.get("MemoryAssigned").and_then(|v| v.as_u64()),
                processor_count: map
                    .get("ProcessorCount")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32),
                generation: map
                    .get("Generation")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32),
                version: map
                    .get("Version")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                path: map.get("Path").and_then(|v| v.as_str()).map(String::from),
                integration_services_version: map
                    .get("IntegrationServicesVersion")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            });
        }
    }

    Ok(vms)
}
