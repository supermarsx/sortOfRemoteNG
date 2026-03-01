//! CIM (Common Information Model) sessions over WinRM.
//!
//! Provides CIM session management, instance querying, method invocation,
//! and event subscription through WS-Management protocol.

use crate::session::PsSessionManager;
use crate::transport;
use crate::types::*;
use chrono::Utc;
use log::{debug, info, warn};
use std::collections::HashMap;
use uuid::Uuid;

// ─── CIM Session Manager ────────────────────────────────────────────────────

/// Manages CIM sessions for querying WMI/CIM repositories remotely.
pub struct CimSessionManager {
    /// Active CIM sessions by ID
    sessions: HashMap<String, CimManagedSession>,
    /// Active subscriptions
    subscriptions: HashMap<String, CimSubscription>,
}

struct CimManagedSession {
    pub id: String,
    pub config: CimSessionConfig,
    pub connected: bool,
    pub ps_session_id: String,
    pub created_at: chrono::DateTime<Utc>,
}

struct CimSubscription {
    pub id: String,
    pub cim_session_id: String,
    pub query: String,
    pub active: bool,
}

impl CimSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            subscriptions: HashMap::new(),
        }
    }

    /// Create a new CIM session using an underlying PSSession.
    pub async fn new_cim_session(
        &mut self,
        ps_manager: &PsSessionManager,
        ps_session_id: &str,
        config: CimSessionConfig,
    ) -> Result<String, String> {
        // Verify the PS session is open
        let session = ps_manager.get_session(ps_session_id)?;
        if session.state != PsSessionState::Opened {
            return Err("Underlying PSSession is not open".to_string());
        }

        let cim_session_id = Uuid::new_v4().to_string();

        // Create CIM session via PowerShell command
        let script = build_new_cim_session_script(&config);
        let transport = ps_manager.get_transport(ps_session_id)?;
        let shell_id = ps_manager.get_shell_id(ps_session_id)?;

        {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let (stdout, stderr) = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;

            if !stderr.trim().is_empty() {
                return Err(format!("Failed to create CIM session: {}", stderr.trim()));
            }

            debug!("CIM session creation output: {}", stdout.trim());
        }

        self.sessions.insert(
            cim_session_id.clone(),
            CimManagedSession {
                id: cim_session_id.clone(),
                config,
                connected: true,
                ps_session_id: ps_session_id.to_string(),
                created_at: Utc::now(),
            },
        );

        info!("CIM session {} created on PS session {}", cim_session_id, ps_session_id);
        Ok(cim_session_id)
    }

    /// Query CIM instances (Get-CimInstance equivalent).
    pub async fn get_instances(
        &self,
        ps_manager: &PsSessionManager,
        params: &CimQueryParams,
    ) -> Result<Vec<CimInstance>, String> {
        let cim_session = self
            .sessions
            .get(&params.session_id)
            .ok_or_else(|| format!("CIM session '{}' not found", params.session_id))?;

        let namespace = params
            .namespace
            .as_deref()
            .unwrap_or("root/cimv2");

        let mut script = format!(
            "Get-CimInstance -ClassName '{}' -Namespace '{}'",
            params.class_name, namespace
        );

        if let Some(ref filter) = params.filter {
            script.push_str(&format!(" -Filter \"{}\"", filter.replace('"', "`\"")));
        }

        if !params.property.is_empty() {
            let props = params
                .property
                .iter()
                .map(|p| format!("'{}'", p))
                .collect::<Vec<_>>()
                .join(", ");
            script.push_str(&format!(" -Property @({})", props));
        }

        if params.key_only {
            script.push_str(" -KeyOnly");
        }

        if params.shallow {
            script.push_str(" -Shallow");
        }

        script.push_str(" | ConvertTo-Json -Depth 5");

        let transport = ps_manager.get_transport(&cim_session.ps_session_id)?;
        let shell_id = ps_manager.get_shell_id(&cim_session.ps_session_id)?;

        let json_output = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let (stdout, stderr) = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;

            if !stderr.trim().is_empty() {
                warn!("CIM query warnings: {}", stderr.trim());
            }
            stdout
        };

        // Parse JSON output into CimInstance structures
        parse_cim_instances(&json_output, &params.class_name, namespace)
    }

    /// Invoke a CIM method (Invoke-CimMethod equivalent).
    pub async fn invoke_method(
        &self,
        ps_manager: &PsSessionManager,
        params: &CimMethodParams,
    ) -> Result<serde_json::Value, String> {
        let cim_session = self
            .sessions
            .get(&params.session_id)
            .ok_or_else(|| format!("CIM session '{}' not found", params.session_id))?;

        let namespace = params
            .namespace
            .as_deref()
            .unwrap_or("root/cimv2");

        let mut script = format!(
            "Invoke-CimMethod -ClassName '{}' -Namespace '{}' -MethodName '{}'",
            params.class_name, namespace, params.method_name
        );

        if !params.arguments.is_empty() {
            let args_json = serde_json::to_string(&params.arguments)
                .map_err(|e| format!("Failed to serialize arguments: {}", e))?;
            script.push_str(&format!(
                " -Arguments ('{}' | ConvertFrom-Json -AsHashtable)",
                args_json.replace('\'', "''")
            ));
        }

        script.push_str(" | ConvertTo-Json -Depth 5");

        let transport = ps_manager.get_transport(&cim_session.ps_session_id)?;
        let shell_id = ps_manager.get_shell_id(&cim_session.ps_session_id)?;

        let output = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let (stdout, stderr) = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;

            if !stderr.trim().is_empty() {
                return Err(format!("CIM method invocation error: {}", stderr.trim()));
            }
            stdout
        };

        serde_json::from_str(&output)
            .map_err(|e| format!("Failed to parse CIM method result: {}", e))
    }

    /// Register a CIM event subscription.
    pub async fn register_event(
        &mut self,
        ps_manager: &PsSessionManager,
        params: &CimSubscriptionParams,
    ) -> Result<String, String> {
        let cim_session = self
            .sessions
            .get(&params.session_id)
            .ok_or_else(|| format!("CIM session '{}' not found", params.session_id))?;

        let subscription_id = Uuid::new_v4().to_string();
        let namespace = params.namespace.as_deref().unwrap_or("root/cimv2");

        let mut script = format!(
            "Register-CimIndicationEvent -Namespace '{}' -Query \"{}\" -QueryDialect '{}' -SourceIdentifier '{}'",
            namespace,
            params.query.replace('"', "`\""),
            params.query_dialect,
            subscription_id
        );

        if let Some(interval) = params.polling_interval_sec {
            script.push_str(&format!(
                " -OperationTimeoutSec {}",
                interval
            ));
        }

        let transport = ps_manager.get_transport(&cim_session.ps_session_id)?;
        let shell_id = ps_manager.get_shell_id(&cim_session.ps_session_id)?;

        {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let (_, stderr) = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;

            if !stderr.trim().is_empty() {
                return Err(format!("Failed to register CIM event: {}", stderr.trim()));
            }
        }

        self.subscriptions.insert(
            subscription_id.clone(),
            CimSubscription {
                id: subscription_id.clone(),
                cim_session_id: params.session_id.clone(),
                query: params.query.clone(),
                active: true,
            },
        );

        info!("CIM event subscription {} registered", subscription_id);
        Ok(subscription_id)
    }

    /// Unregister a CIM event subscription.
    pub async fn unregister_event(
        &mut self,
        ps_manager: &PsSessionManager,
        subscription_id: &str,
    ) -> Result<(), String> {
        let sub = self
            .subscriptions
            .get(subscription_id)
            .ok_or_else(|| format!("Subscription '{}' not found", subscription_id))?;

        let cim_session = self
            .sessions
            .get(&sub.cim_session_id)
            .ok_or("CIM session not found")?;

        let script = format!(
            "Unregister-Event -SourceIdentifier '{}'",
            subscription_id
        );

        let transport = ps_manager.get_transport(&cim_session.ps_session_id)?;
        let shell_id = ps_manager.get_shell_id(&cim_session.ps_session_id)?;

        {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let _ = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
        }

        self.subscriptions.remove(subscription_id);
        info!("CIM event subscription {} unregistered", subscription_id);
        Ok(())
    }

    /// Remove a CIM session.
    pub fn remove_session(&mut self, cim_session_id: &str) -> Result<(), String> {
        self.sessions
            .remove(cim_session_id)
            .ok_or_else(|| format!("CIM session '{}' not found", cim_session_id))?;

        // Remove associated subscriptions
        self.subscriptions
            .retain(|_, sub| sub.cim_session_id != cim_session_id);

        info!("CIM session {} removed", cim_session_id);
        Ok(())
    }

    /// List all CIM sessions.
    pub fn list_sessions(&self) -> Vec<(String, String, bool)> {
        self.sessions
            .values()
            .map(|s| (s.id.clone(), s.config.computer_name.clone(), s.connected))
            .collect()
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn build_new_cim_session_script(config: &CimSessionConfig) -> String {
    let mut parts = Vec::new();

    parts.push(format!(
        "$opt = New-CimSessionOption -Protocol {}",
        match config.protocol {
            CimProtocol::Wsman => "Wsman",
            CimProtocol::Dcom => "Dcom",
        }
    ));

    if config.skip_ca_check {
        parts.push("$opt.SkipCACheck = $true".to_string());
    }
    if config.skip_cn_check {
        parts.push("$opt.SkipCNCheck = $true".to_string());
    }
    if config.skip_revocation_check {
        parts.push("$opt.SkipRevocationCheck = $true".to_string());
    }

    parts.push(format!(
        "New-CimSession -ComputerName '{}' -SessionOption $opt",
        config.computer_name
    ));

    if let Some(port) = config.port {
        parts.last_mut().unwrap().push_str(&format!(" -Port {}", port));
    }

    parts.join("; ")
}

fn parse_cim_instances(
    json_str: &str,
    class_name: &str,
    namespace: &str,
) -> Result<Vec<CimInstance>, String> {
    let trimmed = json_str.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse CIM response JSON: {}", e))?;

    let items = match &value {
        serde_json::Value::Array(arr) => arr.clone(),
        obj @ serde_json::Value::Object(_) => vec![obj.clone()],
        _ => return Ok(Vec::new()),
    };

    let mut instances = Vec::new();
    for item in items {
        if let serde_json::Value::Object(map) = item {
            let mut props = HashMap::new();
            let mut sys_props = HashMap::new();

            for (key, val) in &map {
                if key.starts_with("Cim") || key == "PSComputerName" {
                    sys_props.insert(key.clone(), val.clone());
                } else {
                    props.insert(key.clone(), val.clone());
                }
            }

            instances.push(CimInstance {
                class_name: class_name.to_string(),
                namespace: namespace.to_string(),
                server_name: map
                    .get("PSComputerName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                properties: props,
                system_properties: sys_props,
            });
        }
    }

    Ok(instances)
}
