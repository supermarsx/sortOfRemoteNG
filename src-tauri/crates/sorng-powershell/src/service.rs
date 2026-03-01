//! Main PowerShell Remoting service.
//!
//! Aggregates all sub-managers (sessions, execution, file transfer, CIM,
//! DSC, JEA, PowerShell Direct, diagnostics, configuration) into a single
//! service struct suitable for use as Tauri managed state.

use crate::cim::CimSessionManager;
use crate::copy::PsFileTransferManager;
use crate::direct::PsDirectManager;
use crate::dsc::DscManager;
use crate::execution::PsCommandExecutor;
use crate::interactive::InteractiveSession;
use crate::session::PsSessionManager;
use crate::types::*;
use log::info;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Tauri-managed state type for the PowerShell Remoting service.
pub type PsRemotingServiceState = Arc<Mutex<PsRemotingService>>;

/// The main PowerShell Remoting service combining all sub-managers.
pub struct PsRemotingService {
    /// PSSession lifecycle management.
    pub sessions: PsSessionManager,
    /// Command/script execution (Invoke-Command).
    pub executor: PsCommandExecutor,
    /// File transfer (Copy-Item -ToSession/-FromSession).
    pub file_transfer: PsFileTransferManager,
    /// CIM session management.
    pub cim: CimSessionManager,
    /// PowerShell Direct (Hyper-V VM) sessions.
    pub direct: PsDirectManager,
    /// Interactive session buffers.
    pub interactive_sessions: HashMap<String, InteractiveSession>,
    /// Event log.
    events: Vec<PsRemotingEvent>,
    /// Maximum events to retain.
    max_events: usize,
}

impl PsRemotingService {
    /// Create a new PowerShell Remoting service.
    pub fn new() -> Self {
        Self {
            sessions: PsSessionManager::new(),
            executor: PsCommandExecutor::new(),
            file_transfer: PsFileTransferManager::new(),
            cim: CimSessionManager::new(),
            direct: PsDirectManager::new(),
            interactive_sessions: HashMap::new(),
            events: Vec::new(),
            max_events: 10_000,
        }
    }

    // ─── Session Operations ──────────────────────────────────────────

    /// Create a new PSSession.
    pub async fn new_session(
        &mut self,
        config: PsRemotingConfig,
        name: Option<String>,
    ) -> Result<PsSession, String> {
        let session = self.sessions.new_session(config, name).await?;

        self.emit_event(PsRemotingEvent::SessionCreated {
            session_id: session.id.clone(),
            computer_name: session.computer_name.clone(),
            timestamp: chrono::Utc::now(),
        });

        Ok(session)
    }

    /// Get session info by ID.
    pub fn get_session(&self, session_id: &str) -> Result<PsSession, String> {
        self.sessions.get_session(session_id)
    }

    /// List all sessions.
    pub fn list_sessions(&self) -> Vec<PsSession> {
        self.sessions.list_sessions(None)
    }

    /// Disconnect a session (session remains on remote server).
    pub async fn disconnect_session(&mut self, session_id: &str) -> Result<(), String> {
        self.sessions.disconnect_session(session_id).await?;

        self.emit_event(PsRemotingEvent::SessionDisconnected {
            session_id: session_id.to_string(),
            timestamp: chrono::Utc::now(),
        });

        Ok(())
    }

    /// Reconnect a previously disconnected session.
    pub async fn reconnect_session(&mut self, session_id: &str) -> Result<(), String> {
        self.sessions.reconnect_session(session_id).await?;

        self.emit_event(PsRemotingEvent::SessionReconnected {
            session_id: session_id.to_string(),
            timestamp: chrono::Utc::now(),
        });

        Ok(())
    }

    /// Remove (close) a session.
    pub async fn remove_session(&mut self, session_id: &str) -> Result<(), String> {
        // Clean up interactive session if any
        self.interactive_sessions.remove(session_id);

        self.sessions.remove_session(session_id).await?;

        self.emit_event(PsRemotingEvent::SessionClosed {
            session_id: session_id.to_string(),
            timestamp: chrono::Utc::now(),
        });

        Ok(())
    }

    /// Remove all sessions.
    pub async fn remove_all_sessions(&mut self) -> Result<u32, String> {
        self.interactive_sessions.clear();
        let removed = self.sessions.remove_all_sessions().await;
        Ok(removed.len() as u32)
    }

    // ─── Command Execution ───────────────────────────────────────────

    /// Execute a command on a remote session (Invoke-Command).
    pub async fn invoke_command(
        &mut self,
        session_id: &str,
        params: PsInvokeCommandParams,
    ) -> Result<PsCommandOutput, String> {
        let cmd_id = uuid::Uuid::new_v4().to_string();
        self.sessions.mark_busy(session_id, &cmd_id);

        let mut invoke_params = params;
        invoke_params.session_id = Some(session_id.to_string());

        let result = self
            .executor
            .invoke_command(&mut self.sessions, invoke_params)
            .await;

        self.sessions.mark_available(session_id, &cmd_id);

        let output = result?;

        self.emit_event(PsRemotingEvent::CommandCompleted {
            session_id: session_id.to_string(),
            invocation_id: output.invocation_id.clone(),
            had_errors: output.had_errors,
            duration_ms: output.duration_ms,
            timestamp: chrono::Utc::now(),
        });

        Ok(output)
    }

    /// Execute a command across multiple sessions (fan-out).
    pub async fn invoke_command_fanout(
        &mut self,
        session_ids: &[String],
        params: PsInvokeCommandParams,
    ) -> Vec<Result<PsCommandOutput, String>> {
        self.executor
            .invoke_command_fanout(&mut self.sessions, session_ids, params)
            .await
    }

    /// Stop a running command.
    pub async fn stop_command(
        &mut self,
        _session_id: &str,
        command_id: &str,
    ) -> Result<(), String> {
        self.executor
            .stop_command(&self.sessions, command_id)
            .await
    }

    // ─── Interactive Sessions ────────────────────────────────────────

    /// Enter an interactive session (Enter-PSSession).
    pub async fn enter_session(
        &mut self,
        session_id: &str,
    ) -> Result<String, String> {
        let cmd_id = uuid::Uuid::new_v4().to_string();
        self.sessions.mark_busy(session_id, &cmd_id);

        let interactive = InteractiveSession::enter(&self.sessions, session_id).await?;
        let prompt = interactive.prompt().to_string();

        self.interactive_sessions
            .insert(session_id.to_string(), interactive);

        self.emit_event(PsRemotingEvent::InteractiveSessionStarted {
            session_id: session_id.to_string(),
            timestamp: chrono::Utc::now(),
        });

        Ok(prompt)
    }

    /// Execute a line in an interactive session.
    pub async fn execute_interactive_line(
        &mut self,
        session_id: &str,
        line: &str,
    ) -> Result<String, String> {
        let interactive = self.interactive_sessions.get_mut(session_id)
            .ok_or_else(|| format!("No interactive session for '{}'", session_id))?;
        let lines = interactive.execute_line(line).await?;
        Ok(lines.into_iter().map(|l| l.text).collect::<Vec<_>>().join("\n"))
    }

    /// Tab-complete in an interactive session.
    pub async fn tab_complete(
        &self,
        session_id: &str,
        partial: &str,
    ) -> Result<Vec<String>, String> {
        let interactive = self.interactive_sessions.get(session_id)
            .ok_or_else(|| format!("No interactive session for '{}'", session_id))?;
        interactive.tab_complete(partial, partial.len() as u32).await
    }

    /// Exit an interactive session.
    pub async fn exit_session(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(interactive) = self.interactive_sessions.remove(session_id) {
            interactive.exit();
        }
        let cmd_id = uuid::Uuid::new_v4().to_string();
        self.sessions.mark_available(session_id, &cmd_id);

        self.emit_event(PsRemotingEvent::InteractiveSessionEnded {
            session_id: session_id.to_string(),
            timestamp: chrono::Utc::now(),
        });

        Ok(())
    }

    // ─── File Transfer ───────────────────────────────────────────────

    /// Copy a file to a remote session.
    pub async fn copy_to_session(
        &mut self,
        session_id: &str,
        params: PsFileCopyParams,
    ) -> Result<String, String> {
        let progress = self
            .file_transfer
            .copy_to_session(&self.sessions, &params)
            .await?;

        let transfer_id = progress.transfer_id.clone();

        self.emit_event(PsRemotingEvent::FileTransferStarted {
            session_id: session_id.to_string(),
            transfer_id: transfer_id.clone(),
            direction: "upload".to_string(),
            timestamp: chrono::Utc::now(),
        });

        Ok(transfer_id)
    }

    /// Copy a file from a remote session.
    pub async fn copy_from_session(
        &mut self,
        session_id: &str,
        params: PsFileCopyParams,
    ) -> Result<String, String> {
        let progress = self
            .file_transfer
            .copy_from_session(&self.sessions, &params)
            .await?;

        let transfer_id = progress.transfer_id.clone();

        self.emit_event(PsRemotingEvent::FileTransferStarted {
            session_id: session_id.to_string(),
            transfer_id: transfer_id.clone(),
            direction: "download".to_string(),
            timestamp: chrono::Utc::now(),
        });

        Ok(transfer_id)
    }

    /// Get file transfer progress.
    pub fn get_transfer_progress(&self, transfer_id: &str) -> Result<PsFileTransferProgress, String> {
        self.file_transfer.get_progress(transfer_id)
            .ok_or_else(|| format!("Transfer '{}' not found", transfer_id))
    }

    /// Cancel a file transfer.
    pub fn cancel_transfer(&mut self, transfer_id: &str) -> Result<(), String> {
        self.file_transfer.cancel_transfer(transfer_id)
    }

    /// List all file transfers.
    pub fn list_transfers(&self) -> Vec<PsFileTransferProgress> {
        self.file_transfer.list_transfers()
    }

    // ─── CIM Operations ─────────────────────────────────────────────

    /// Create a new CIM session.
    pub async fn new_cim_session(
        &mut self,
        session_id: &str,
        config: CimSessionConfig,
    ) -> Result<String, String> {
        self.cim
            .new_cim_session(&self.sessions, session_id, config)
            .await
    }

    /// Get CIM instances (Get-CimInstance).
    pub async fn get_cim_instances(
        &self,
        _session_id: &str,
        _cim_session_id: &str,
        params: CimQueryParams,
    ) -> Result<Vec<CimInstance>, String> {
        self.cim
            .get_instances(&self.sessions, &params)
            .await
    }

    /// Invoke a CIM method.
    pub async fn invoke_cim_method(
        &self,
        _session_id: &str,
        _cim_session_id: &str,
        params: CimMethodParams,
    ) -> Result<serde_json::Value, String> {
        self.cim
            .invoke_method(&self.sessions, &params)
            .await
    }

    /// Remove a CIM session.
    pub async fn remove_cim_session(
        &mut self,
        _session_id: &str,
        cim_session_id: &str,
    ) -> Result<(), String> {
        self.cim
            .remove_session(cim_session_id)
    }

    // ─── DSC Operations ──────────────────────────────────────────────

    /// Test DSC configuration compliance.
    pub async fn test_dsc_configuration(
        &self,
        session_id: &str,
    ) -> Result<DscResult, String> {
        DscManager::test_configuration(&self.sessions, session_id, true).await
    }

    /// Get current DSC configuration.
    pub async fn get_dsc_configuration(
        &self,
        session_id: &str,
    ) -> Result<Vec<DscResourceState>, String> {
        DscManager::get_configuration(&self.sessions, session_id).await
    }

    /// Apply a DSC configuration.
    pub async fn start_dsc_configuration(
        &self,
        session_id: &str,
        configuration: &DscConfiguration,
    ) -> Result<DscResult, String> {
        DscManager::start_configuration(&self.sessions, session_id, configuration, true, false).await
    }

    /// Get DSC resources available on the remote system.
    pub async fn get_dsc_resources(
        &self,
        session_id: &str,
    ) -> Result<Vec<serde_json::Value>, String> {
        DscManager::get_dsc_resources(&self.sessions, session_id, None).await
    }

    // ─── JEA Operations ─────────────────────────────────────────────

    /// Register a JEA endpoint.
    pub async fn register_jea_endpoint(
        &self,
        session_id: &str,
        endpoint: &JeaEndpoint,
    ) -> Result<(), String> {
        crate::jea::JeaManager::register_endpoint(&self.sessions, session_id, endpoint).await
    }

    /// Unregister a JEA endpoint.
    pub async fn unregister_jea_endpoint(
        &self,
        session_id: &str,
        endpoint_name: &str,
    ) -> Result<(), String> {
        crate::jea::JeaManager::unregister_endpoint(&self.sessions, session_id, endpoint_name)
            .await
    }

    /// List JEA/session endpoints.
    pub async fn list_jea_endpoints(
        &self,
        session_id: &str,
    ) -> Result<Vec<PsSessionConfiguration>, String> {
        crate::jea::JeaManager::list_endpoints(&self.sessions, session_id).await
    }

    /// Create a JEA role capability.
    pub async fn create_jea_role_capability(
        &self,
        session_id: &str,
        role_name: &str,
        capability: &JeaRoleCapability,
    ) -> Result<String, String> {
        crate::jea::JeaManager::create_role_capability(
            &self.sessions,
            session_id,
            role_name,
            capability,
        )
        .await
    }

    // ─── PowerShell Direct ───────────────────────────────────────────

    /// List Hyper-V VMs on a remote host.
    pub async fn list_vms(&self, session_id: &str) -> Result<Vec<crate::direct::HyperVVmInfo>, String> {
        PsDirectManager::list_vms(&self.sessions, session_id).await
    }

    /// Execute a command inside a Hyper-V VM.
    pub async fn invoke_command_vm(
        &self,
        session_id: &str,
        config: &PsDirectConfig,
        script: &str,
    ) -> Result<PsCommandOutput, String> {
        PsDirectManager::invoke_command_vm(&self.sessions, session_id, config, script).await
    }

    /// Copy a file to a Hyper-V VM.
    pub async fn copy_to_vm(
        &self,
        session_id: &str,
        config: &PsDirectConfig,
        source: &str,
        destination: &str,
    ) -> Result<(), String> {
        PsDirectManager::copy_to_vm(&self.sessions, session_id, config, source, destination).await
    }

    // ─── Configuration Management ────────────────────────────────────

    /// Get session configurations on a remote system.
    pub async fn get_session_configurations(
        &self,
        session_id: &str,
    ) -> Result<Vec<PsSessionConfiguration>, String> {
        crate::configuration::PsConfigurationManager::get_configurations(
            &self.sessions,
            session_id,
        )
        .await
    }

    /// Get WinRM configuration.
    pub async fn get_winrm_config(
        &self,
        session_id: &str,
    ) -> Result<serde_json::Value, String> {
        crate::configuration::PsConfigurationManager::get_winrm_config(&self.sessions, session_id)
            .await
    }

    /// Get trusted hosts.
    pub async fn get_trusted_hosts(
        &self,
        session_id: &str,
    ) -> Result<Vec<String>, String> {
        crate::configuration::PsConfigurationManager::get_trusted_hosts(&self.sessions, session_id)
            .await
    }

    /// Set trusted hosts.
    pub async fn set_trusted_hosts(
        &self,
        session_id: &str,
        hosts: &[String],
    ) -> Result<(), String> {
        crate::configuration::PsConfigurationManager::set_trusted_hosts(
            &self.sessions,
            session_id,
            hosts,
        )
        .await
    }

    // ─── Diagnostics ─────────────────────────────────────────────────

    /// Test WinRM connectivity (Test-WSMan equivalent).
    pub async fn test_wsman(
        &self,
        config: &PsRemotingConfig,
    ) -> Result<PsDiagnosticResult, String> {
        crate::diagnostics::PsDiagnosticsManager::test_wsman(config).await
    }

    /// Comprehensive connection diagnostics.
    pub async fn diagnose_connection(
        &self,
        config: &PsRemotingConfig,
    ) -> Result<PsDiagnosticResult, String> {
        crate::diagnostics::PsDiagnosticsManager::diagnose_connection(config).await
    }

    /// Check WinRM service status.
    pub async fn check_winrm_service(
        &self,
        session_id: &str,
    ) -> Result<crate::diagnostics::WinRmServiceStatus, String> {
        crate::diagnostics::PsDiagnosticsManager::check_winrm_service(&self.sessions, session_id)
            .await
    }

    /// Check firewall rules for WinRM.
    pub async fn check_firewall_rules(
        &self,
        session_id: &str,
    ) -> Result<Vec<crate::diagnostics::FirewallRuleInfo>, String> {
        crate::diagnostics::PsDiagnosticsManager::check_firewall_rules(&self.sessions, session_id)
            .await
    }

    /// Measure PS Remoting latency.
    pub async fn measure_latency(
        &self,
        session_id: &str,
        iterations: u32,
    ) -> Result<crate::diagnostics::LatencyResult, String> {
        crate::diagnostics::PsDiagnosticsManager::measure_latency(
            &self.sessions,
            session_id,
            iterations,
        )
        .await
    }

    /// Get certificates used by WinRM.
    pub async fn get_certificate_info(
        &self,
        session_id: &str,
    ) -> Result<Vec<PsCertificateInfo>, String> {
        crate::diagnostics::PsDiagnosticsManager::get_certificate_info(&self.sessions, session_id)
            .await
    }

    // ─── Events ──────────────────────────────────────────────────────

    /// Emit an internal event.
    fn emit_event(&mut self, event: PsRemotingEvent) {
        if self.events.len() >= self.max_events {
            // Keep the last half
            let drain_to = self.max_events / 2;
            self.events.drain(0..drain_to);
        }
        self.events.push(event);
    }

    /// Get recent events.
    pub fn get_events(&self, limit: Option<usize>) -> Vec<PsRemotingEvent> {
        let limit = limit.unwrap_or(100);
        let skip = if self.events.len() > limit {
            self.events.len() - limit
        } else {
            0
        };
        self.events[skip..].to_vec()
    }

    /// Clear event log.
    pub fn clear_events(&mut self) {
        self.events.clear();
    }

    /// Get service statistics.
    pub fn get_stats(&self) -> PsRemotingStats {
        let sessions = self.sessions.list_sessions(None);
        let active = sessions
            .iter()
            .filter(|s| s.state == PsSessionState::Opened)
            .count();
        let disconnected = sessions
            .iter()
            .filter(|s| s.state == PsSessionState::Disconnected)
            .count();

        PsRemotingStats {
            total_sessions: sessions.len() as u32,
            active_sessions: active as u32,
            disconnected_sessions: disconnected as u32,
            interactive_sessions: self.interactive_sessions.len() as u32,
            active_transfers: self
                .file_transfer
                .list_transfers()
                .iter()
                .filter(|t| t.state == PsTransferState::Transferring)
                .count() as u32,
            cim_sessions: self.cim.list_sessions().len() as u32,
            vm_sessions: self.direct.list_vm_sessions().len() as u32,
            total_events: self.events.len() as u32,
        }
    }

    /// Cleanup all resources.
    pub async fn cleanup(&mut self) -> Result<(), String> {
        self.interactive_sessions.clear();
        self.file_transfer.cleanup();
        let _ = self.sessions.remove_all_sessions().await;
        self.events.clear();
        info!("PowerShell Remoting service cleaned up");
        Ok(())
    }
}

impl Default for PsRemotingService {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Stats ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsRemotingStats {
    pub total_sessions: u32,
    pub active_sessions: u32,
    pub disconnected_sessions: u32,
    pub interactive_sessions: u32,
    pub active_transfers: u32,
    pub cim_sessions: u32,
    pub vm_sessions: u32,
    pub total_events: u32,
}
