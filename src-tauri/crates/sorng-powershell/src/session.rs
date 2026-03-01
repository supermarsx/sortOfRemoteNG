//! PSSession lifecycle management.
//!
//! Handles creating, tracking, disconnecting, reconnecting,
//! and removing PowerShell Remoting sessions.

use crate::transport::WinRmTransport;
use crate::types::*;
use chrono::Utc;
use log::{debug, error, info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

// ─── Session Manager ─────────────────────────────────────────────────────────

/// Manages multiple PSSession instances with lifecycle tracking.
pub struct PsSessionManager {
    /// Active sessions by ID
    sessions: HashMap<String, ManagedSession>,
    /// Session name counter for auto-naming
    name_counter: u32,
    /// Maximum concurrent sessions
    max_sessions: u32,
    /// Default session options
    default_options: PsSessionOption,
}

/// A managed session with its transport and metadata.
pub struct ManagedSession {
    /// Session metadata
    pub info: PsSession,
    /// WinRM transport handle
    pub transport: Arc<Mutex<WinRmTransport>>,
    /// Session configuration
    pub config: PsRemotingConfig,
    /// Keep-alive task handle
    keepalive_handle: Option<tokio::task::JoinHandle<()>>,
    /// Active command IDs
    active_commands: Vec<String>,
}

impl PsSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            name_counter: 0,
            max_sessions: 25,
            default_options: PsSessionOption::default(),
        }
    }

    /// Create a new PSSession to a remote computer.
    pub async fn new_session(
        &mut self,
        config: PsRemotingConfig,
        name: Option<String>,
    ) -> Result<PsSession, String> {
        // Check session limit
        let active_count = self
            .sessions
            .values()
            .filter(|s| {
                s.info.state == PsSessionState::Opened
                    || s.info.state == PsSessionState::Opening
            })
            .count();

        if active_count >= self.max_sessions as usize {
            return Err(format!(
                "Maximum concurrent sessions ({}) reached",
                self.max_sessions
            ));
        }

        let session_id = Uuid::new_v4().to_string();
        self.name_counter += 1;

        let session_name = name.unwrap_or_else(|| format!("WinRM{}", self.name_counter));

        let port = config.effective_port();
        let computer_name = config.computer_name.clone();
        let configuration_name = config.configuration_name.clone();
        let transport_proto = config.transport.clone();
        let auth_method = config.auth_method.clone();

        info!(
            "Creating PSSession '{}' to {}:{} ({})",
            session_name,
            computer_name,
            port,
            config.auth_method.name()
        );

        // Create transport
        let mut transport = WinRmTransport::new(&config)?;

        // Set up authentication
        let auth_provider = crate::auth::create_auth_provider(
            &config.auth_method,
            &config.credential,
            &config.computer_name,
        )?;

        let auth_header = auth_provider.initial_auth_header()?;
        if !auth_header.is_empty() {
            transport.set_auth_header(auth_header);
        }

        // Create the remote shell
        let resource_uri = WsManResourceUri::PS_SHELL;
        let shell_id = transport
            .create_shell(
                resource_uri,
                &config.configuration_name,
                &config.session_option,
            )
            .await?;

        let now = Utc::now();
        let session = PsSession {
            id: session_id.clone(),
            shell_id: Some(shell_id),
            name: session_name,
            computer_name: computer_name.clone(),
            state: PsSessionState::Opened,
            availability: PsSessionAvailability::Available,
            configuration_name,
            ps_version: None,
            os_version: None,
            created_at: now,
            last_activity: now,
            idle_seconds: 0,
            command_count: 0,
            transport: transport_proto,
            auth_method,
            supports_disconnect: true,
            reconnect_count: 0,
            runspace_id: Some(Uuid::new_v4().to_string()),
            port,
        };

        let transport = Arc::new(Mutex::new(transport));

        let managed = ManagedSession {
            info: session.clone(),
            transport,
            config,
            keepalive_handle: None,
            active_commands: Vec::new(),
        };

        self.sessions.insert(session_id.clone(), managed);

        // Start keep-alive if configured
        if self.default_options.keepalive_interval_sec > 0 {
            self.start_keepalive(&session_id).await;
        }

        info!("PSSession '{}' ({}) opened successfully", session.name, session_id);
        Ok(session)
    }

    /// Get session information.
    pub fn get_session(&self, session_id: &str) -> Result<PsSession, String> {
        self.sessions
            .get(session_id)
            .map(|s| {
                let mut info = s.info.clone();
                info.idle_seconds = (Utc::now() - info.last_activity).num_seconds().max(0) as u64;
                info
            })
            .ok_or_else(|| format!("Session '{}' not found", session_id))
    }

    /// List all sessions, optionally filtered by state.
    pub fn list_sessions(&self, state_filter: Option<PsSessionState>) -> Vec<PsSession> {
        self.sessions
            .values()
            .filter(|s| {
                state_filter
                    .as_ref()
                    .map_or(true, |state| s.info.state == *state)
            })
            .map(|s| {
                let mut info = s.info.clone();
                info.idle_seconds =
                    (Utc::now() - info.last_activity).num_seconds().max(0) as u64;
                info
            })
            .collect()
    }

    /// Disconnect a session (preserving it for later reconnection).
    pub async fn disconnect_session(&mut self, session_id: &str) -> Result<PsSession, String> {
        let managed = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        if managed.info.state != PsSessionState::Opened {
            return Err(format!(
                "Cannot disconnect session in state {:?}",
                managed.info.state
            ));
        }

        let shell_id = managed
            .info
            .shell_id
            .clone()
            .ok_or("Session has no shell ID")?;

        // Stop keep-alive
        if let Some(handle) = managed.keepalive_handle.take() {
            handle.abort();
        }

        // Send disconnect signal
        let mut transport = managed.transport.lock().await;
        transport.disconnect_shell(&shell_id).await?;
        drop(transport);

        managed.info.state = PsSessionState::Disconnected;
        managed.info.availability = PsSessionAvailability::None;
        managed.info.last_activity = Utc::now();

        info!(
            "PSSession '{}' ({}) disconnected",
            managed.info.name, session_id
        );

        Ok(managed.info.clone())
    }

    /// Reconnect to a previously disconnected session.
    pub async fn reconnect_session(&mut self, session_id: &str) -> Result<PsSession, String> {
        let managed = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        if managed.info.state != PsSessionState::Disconnected {
            return Err(format!(
                "Cannot reconnect session in state {:?}",
                managed.info.state
            ));
        }

        let shell_id = managed
            .info
            .shell_id
            .clone()
            .ok_or("Session has no shell ID")?;

        // Re-create transport if needed and reconnect
        let mut transport = managed.transport.lock().await;
        transport.reconnect_shell(&shell_id).await?;
        drop(transport);

        managed.info.state = PsSessionState::Opened;
        managed.info.availability = PsSessionAvailability::Available;
        managed.info.reconnect_count += 1;
        managed.info.last_activity = Utc::now();

        info!(
            "PSSession '{}' ({}) reconnected (count: {})",
            managed.info.name, session_id, managed.info.reconnect_count
        );

        // Restart keep-alive
        self.start_keepalive(session_id).await;

        Ok(self.sessions[session_id].info.clone())
    }

    /// Remove (close) a session.
    pub async fn remove_session(&mut self, session_id: &str) -> Result<(), String> {
        let managed = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        // Stop keep-alive
        if let Some(handle) = managed.keepalive_handle.take() {
            handle.abort();
        }

        // Close the shell if still open
        if managed.info.state == PsSessionState::Opened
            || managed.info.state == PsSessionState::Disconnected
        {
            if let Some(ref shell_id) = managed.info.shell_id {
                let mut transport = managed.transport.lock().await;
                if let Err(e) = transport.delete_shell(shell_id).await {
                    warn!(
                        "Failed to cleanly close shell for session {}: {}",
                        session_id, e
                    );
                }
            }
        }

        let name = managed.info.name.clone();
        self.sessions.remove(session_id);
        info!("PSSession '{}' ({}) removed", name, session_id);

        Ok(())
    }

    /// Remove all sessions.
    pub async fn remove_all_sessions(&mut self) -> Vec<String> {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        let mut errors = Vec::new();

        for id in &ids {
            if let Err(e) = self.remove_session(id).await {
                errors.push(format!("{}: {}", id, e));
            }
        }

        errors
    }

    /// Get the transport handle for a session.
    pub fn get_transport(
        &self,
        session_id: &str,
    ) -> Result<Arc<Mutex<WinRmTransport>>, String> {
        self.sessions
            .get(session_id)
            .map(|s| s.transport.clone())
            .ok_or_else(|| format!("Session '{}' not found", session_id))
    }

    /// Get the shell ID for a session.
    pub fn get_shell_id(&self, session_id: &str) -> Result<String, String> {
        self.sessions
            .get(session_id)
            .and_then(|s| s.info.shell_id.clone())
            .ok_or_else(|| format!("Session '{}' has no shell ID", session_id))
    }

    /// Mark a session as busy (running a command).
    pub fn mark_busy(&mut self, session_id: &str, command_id: &str) {
        if let Some(managed) = self.sessions.get_mut(session_id) {
            managed.info.availability = PsSessionAvailability::Busy;
            managed.info.last_activity = Utc::now();
            managed.active_commands.push(command_id.to_string());
        }
    }

    /// Mark a session as available (command completed).
    pub fn mark_available(&mut self, session_id: &str, command_id: &str) {
        if let Some(managed) = self.sessions.get_mut(session_id) {
            managed.active_commands.retain(|id| id != command_id);
            if managed.active_commands.is_empty() {
                managed.info.availability = PsSessionAvailability::Available;
            }
            managed.info.command_count += 1;
            managed.info.last_activity = Utc::now();
        }
    }

    /// Start a background keep-alive task for a session.
    async fn start_keepalive(&mut self, session_id: &str) {
        let managed = match self.sessions.get_mut(session_id) {
            Some(m) => m,
            None => return,
        };

        let interval = self.default_options.keepalive_interval_sec;
        if interval == 0 {
            return;
        }

        let transport = managed.transport.clone();
        let shell_id = match managed.info.shell_id.clone() {
            Some(id) => id,
            None => return,
        };
        let sid = session_id.to_string();

        let handle = tokio::spawn(async move {
            let mut interval_timer =
                tokio::time::interval(std::time::Duration::from_secs(interval as u64));

            loop {
                interval_timer.tick().await;
                let mut t = transport.lock().await;
                match t.keepalive(&shell_id).await {
                    Ok(latency) => {
                        debug!("Keep-alive for session {}: {}ms", sid, latency);
                    }
                    Err(e) => {
                        warn!("Keep-alive failed for session {}: {}", sid, e);
                        break;
                    }
                }
            }
        });

        managed.keepalive_handle = Some(handle);
    }

    /// Update default session options.
    pub fn set_default_options(&mut self, options: PsSessionOption) {
        self.default_options = options;
    }

    /// Set maximum concurrent sessions.
    pub fn set_max_sessions(&mut self, max: u32) {
        self.max_sessions = max;
    }
}

// ─── Session Pool ────────────────────────────────────────────────────────────

/// A pool of reusable sessions for batch/fan-out operations.
pub struct PsSessionPool {
    /// Available sessions by target computer
    pool: HashMap<String, Vec<String>>,
    /// Maximum sessions per target
    max_per_target: u32,
}

impl PsSessionPool {
    pub fn new(max_per_target: u32) -> Self {
        Self {
            pool: HashMap::new(),
            max_per_target,
        }
    }

    /// Get or create a session for a target computer.
    pub async fn acquire(
        &mut self,
        computer_name: &str,
        manager: &mut PsSessionManager,
        config: &PsRemotingConfig,
    ) -> Result<String, String> {
        // Check for available session in the pool
        if let Some(sessions) = self.pool.get_mut(computer_name) {
            for session_id in sessions.iter() {
                if let Ok(info) = manager.get_session(session_id) {
                    if info.availability == PsSessionAvailability::Available
                        && info.state == PsSessionState::Opened
                    {
                        return Ok(session_id.clone());
                    }
                }
            }

            // Check if we can create a new one
            if sessions.len() >= self.max_per_target as usize {
                return Err(format!(
                    "Maximum sessions per target ({}) reached for {}",
                    self.max_per_target, computer_name
                ));
            }
        }

        // Create a new session
        let session = manager.new_session(config.clone(), None).await?;
        let session_id = session.id.clone();

        self.pool
            .entry(computer_name.to_string())
            .or_insert_with(Vec::new)
            .push(session_id.clone());

        Ok(session_id)
    }

    /// Release a session back to the pool.
    pub fn release(&mut self, _session_id: &str) {
        // Session is released by the session manager marking it as available
    }

    /// Clear the pool, removing all sessions.
    pub async fn drain(&mut self, manager: &mut PsSessionManager) {
        for sessions in self.pool.values() {
            for session_id in sessions {
                let _ = manager.remove_session(session_id).await;
            }
        }
        self.pool.clear();
    }
}

// ─── Helper for auth method name ─────────────────────────────────────────────

impl PsAuthMethod {
    pub fn name(&self) -> &str {
        match self {
            Self::Basic => "Basic",
            Self::Ntlm => "NTLM",
            Self::Negotiate => "Negotiate",
            Self::Kerberos => "Kerberos",
            Self::CredSsp => "CredSSP",
            Self::Certificate => "Certificate",
            Self::Default => "Default",
            Self::Digest => "Digest",
        }
    }
}
