//! Aggregate service facade for the Terminal Services Management crate.
//!
//! Manages open server handles and delegates to the domain-specific modules
//! (sessions, processes, server, shadow, messaging, listeners).
//! Provides the `TermServServiceState` type alias for Tauri managed state.

use crate::types::*;
use chrono::Utc;
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Alias for Tauri managed state.
pub type TermServServiceState = Arc<Mutex<TermServService>>;

/// Configuration for the Terminal Services service.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermServConfig {
    /// Default timeout for blocking operations (seconds).
    pub default_timeout_seconds: u32,
    /// Whether to wait for session operations to complete.
    pub wait_for_operations: bool,
    /// Maximum number of open server handles.
    pub max_open_servers: usize,
}

impl Default for TermServConfig {
    fn default() -> Self {
        Self {
            default_timeout_seconds: 30,
            wait_for_operations: true,
            max_open_servers: 20,
        }
    }
}

/// Central service managing Terminal Services interactions.
pub struct TermServService {
    /// Open server handles keyed by handle_id.
    #[cfg(windows)]
    handles: HashMap<String, OpenServer>,
    /// Global configuration.
    config: TermServConfig,
}

#[cfg(windows)]
struct OpenServer {
    handle: SendHandle,
    meta: ServerHandle,
}

/// A Send/Sync wrapper for a Windows HANDLE.
/// SAFETY: WTS server handles are safe to use from any thread.
#[cfg(windows)]
#[derive(Debug, Clone, Copy)]
struct SendHandle(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for SendHandle {}
#[cfg(windows)]
unsafe impl Sync for SendHandle {}

impl TermServService {
    /// Create a new service with default config.
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            handles: HashMap::new(),
            config: TermServConfig::default(),
        }
    }

    /// Create a new service with custom config.
    pub fn with_config(config: TermServConfig) -> Self {
        Self {
            #[cfg(windows)]
            handles: HashMap::new(),
            config,
        }
    }

    /// Create a properly wrapped state value for Tauri.
    pub fn new_state() -> TermServServiceState {
        Arc::new(Mutex::new(Self::new()))
    }

    /// Get the current configuration.
    pub fn get_config(&self) -> TermServConfig {
        self.config.clone()
    }

    /// Update the configuration.
    pub fn set_config(&mut self, config: TermServConfig) {
        self.config = config;
    }

    // ─── Server handle management ────────────────────────────────

    /// Open a handle to a remote RD Session Host server.
    #[cfg(windows)]
    pub fn open_server(&mut self, server_name: &str) -> Result<ServerHandle, String> {
        if self.handles.len() >= self.config.max_open_servers {
            return Err(format!(
                "Maximum open servers ({}) reached",
                self.config.max_open_servers
            ));
        }

        let handle = crate::server::open_server(server_name).map_err(|e| e.to_string())?;
        let handle_id = uuid::Uuid::new_v4().to_string();
        let meta = ServerHandle {
            handle_id: handle_id.clone(),
            server_name: server_name.to_string(),
            opened_at: Utc::now(),
        };
        self.handles.insert(
            handle_id.clone(),
            OpenServer {
                handle: SendHandle(handle),
                meta: meta.clone(),
            },
        );
        info!("Opened server '{}' as handle {}", server_name, handle_id);
        Ok(meta)
    }

    #[cfg(not(windows))]
    pub fn open_server(&mut self, _server_name: &str) -> Result<ServerHandle, String> {
        Err(TsError::platform().to_string())
    }

    /// Close an open server handle.
    #[cfg(windows)]
    pub fn close_server(&mut self, handle_id: &str) -> Result<(), String> {
        if let Some(open) = self.handles.remove(handle_id) {
            crate::server::close_server(open.handle.0);
            info!("Closed server handle {}", handle_id);
            Ok(())
        } else {
            Err(format!("Handle '{}' not found", handle_id))
        }
    }

    #[cfg(not(windows))]
    pub fn close_server(&mut self, _handle_id: &str) -> Result<(), String> {
        Err(TsError::platform().to_string())
    }

    /// Close all open server handles.
    #[cfg(windows)]
    pub fn close_all_servers(&mut self) -> usize {
        let count = self.handles.len();
        for (_, open) in self.handles.drain() {
            crate::server::close_server(open.handle.0);
        }
        info!("Closed {} server handles", count);
        count
    }

    #[cfg(not(windows))]
    pub fn close_all_servers(&mut self) -> usize {
        0
    }

    /// List all open server handles.
    #[cfg(windows)]
    pub fn list_open_servers(&self) -> Vec<ServerHandle> {
        self.handles.values().map(|o| o.meta.clone()).collect()
    }

    #[cfg(not(windows))]
    pub fn list_open_servers(&self) -> Vec<ServerHandle> {
        Vec::new()
    }

    /// Resolve a handle_id to the native HANDLE, or use the local server.
    #[cfg(windows)]
    fn resolve_handle(&self, handle_id: &Option<String>) -> Result<windows::Win32::Foundation::HANDLE, String> {
        match handle_id {
            Some(id) if !id.is_empty() => {
                self.handles
                    .get(id)
                    .map(|o| o.handle.0)
                    .ok_or_else(|| format!("Handle '{}' not found", id))
            }
            _ => Ok(crate::wts_ffi::WTS_CURRENT_SERVER),
        }
    }

    // ─── Session operations ──────────────────────────────────────

    /// Enumerate sessions on a server.
    #[cfg(windows)]
    pub fn list_sessions(
        &self,
        handle_id: Option<String>,
        state_filter: Option<SessionState>,
    ) -> Result<Vec<SessionEntry>, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::sessions::list_sessions(server, state_filter).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn list_sessions(
        &self,
        _handle_id: Option<String>,
        _state_filter: Option<SessionState>,
    ) -> Result<Vec<SessionEntry>, String> {
        Err(TsError::platform().to_string())
    }

    /// List user sessions (Active + Disconnected).
    #[cfg(windows)]
    pub fn list_user_sessions(
        &self,
        handle_id: Option<String>,
    ) -> Result<Vec<SessionEntry>, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::sessions::list_user_sessions(server).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn list_user_sessions(
        &self,
        _handle_id: Option<String>,
    ) -> Result<Vec<SessionEntry>, String> {
        Err(TsError::platform().to_string())
    }

    /// Get detailed information about a specific session.
    #[cfg(windows)]
    pub fn get_session_detail(
        &self,
        handle_id: Option<String>,
        session_id: u32,
    ) -> Result<SessionDetail, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::sessions::get_session_detail(server, session_id).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn get_session_detail(
        &self,
        _handle_id: Option<String>,
        _session_id: u32,
    ) -> Result<SessionDetail, String> {
        Err(TsError::platform().to_string())
    }

    /// Get detailed information about all sessions.
    #[cfg(windows)]
    pub fn get_all_session_details(
        &self,
        handle_id: Option<String>,
    ) -> Result<Vec<SessionDetail>, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::sessions::get_all_session_details(server).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn get_all_session_details(
        &self,
        _handle_id: Option<String>,
    ) -> Result<Vec<SessionDetail>, String> {
        Err(TsError::platform().to_string())
    }

    /// Disconnect a session.
    #[cfg(windows)]
    pub fn disconnect_session(
        &self,
        handle_id: Option<String>,
        session_id: u32,
    ) -> Result<(), String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::sessions::disconnect(server, session_id, self.config.wait_for_operations)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn disconnect_session(
        &self,
        _handle_id: Option<String>,
        _session_id: u32,
    ) -> Result<(), String> {
        Err(TsError::platform().to_string())
    }

    /// Log off a session.
    #[cfg(windows)]
    pub fn logoff_session(
        &self,
        handle_id: Option<String>,
        session_id: u32,
    ) -> Result<(), String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::sessions::logoff(server, session_id, self.config.wait_for_operations)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn logoff_session(
        &self,
        _handle_id: Option<String>,
        _session_id: u32,
    ) -> Result<(), String> {
        Err(TsError::platform().to_string())
    }

    /// Connect (transfer) a disconnected session to another.
    #[cfg(windows)]
    pub fn connect_session(
        &self,
        logon_id: u32,
        target_logon_id: u32,
        password: String,
    ) -> Result<(), String> {
        crate::sessions::connect(
            logon_id,
            target_logon_id,
            &password,
            self.config.wait_for_operations,
        )
        .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn connect_session(
        &self,
        _logon_id: u32,
        _target_logon_id: u32,
        _password: String,
    ) -> Result<(), String> {
        Err(TsError::platform().to_string())
    }

    /// Log off all disconnected sessions.
    #[cfg(windows)]
    pub fn logoff_disconnected(
        &self,
        handle_id: Option<String>,
    ) -> Result<u32, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::sessions::logoff_disconnected(server).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn logoff_disconnected(
        &self,
        _handle_id: Option<String>,
    ) -> Result<u32, String> {
        Err(TsError::platform().to_string())
    }

    /// Find sessions by user name pattern.
    #[cfg(windows)]
    pub fn find_sessions_by_user(
        &self,
        handle_id: Option<String>,
        user_pattern: String,
    ) -> Result<Vec<SessionDetail>, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::sessions::find_sessions_by_user(server, &user_pattern)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn find_sessions_by_user(
        &self,
        _handle_id: Option<String>,
        _user_pattern: String,
    ) -> Result<Vec<SessionDetail>, String> {
        Err(TsError::platform().to_string())
    }

    /// Get a server summary (session counts, process count).
    #[cfg(windows)]
    pub fn server_summary(
        &self,
        handle_id: Option<String>,
    ) -> Result<TsServerSummary, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::sessions::server_summary(server).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn server_summary(
        &self,
        _handle_id: Option<String>,
    ) -> Result<TsServerSummary, String> {
        Err(TsError::platform().to_string())
    }

    /// Get the console session ID.
    #[cfg(windows)]
    pub fn get_console_session_id(&self) -> u32 {
        crate::sessions::get_console_session_id()
    }

    #[cfg(not(windows))]
    pub fn get_console_session_id(&self) -> u32 {
        0
    }

    /// Get the current process's session ID.
    #[cfg(windows)]
    pub fn get_current_session_id(&self) -> u32 {
        crate::sessions::get_current_session_id()
    }

    #[cfg(not(windows))]
    pub fn get_current_session_id(&self) -> u32 {
        0
    }

    /// Check if a session is remote.
    #[cfg(windows)]
    pub fn is_remote_session(
        &self,
        handle_id: Option<String>,
        session_id: u32,
    ) -> Result<bool, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::sessions::is_remote_session(server, session_id).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn is_remote_session(
        &self,
        _handle_id: Option<String>,
        _session_id: u32,
    ) -> Result<bool, String> {
        Err(TsError::platform().to_string())
    }

    /// Get idle time in seconds for a session.
    #[cfg(windows)]
    pub fn get_idle_seconds(
        &self,
        handle_id: Option<String>,
        session_id: u32,
    ) -> Result<Option<i64>, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::sessions::get_idle_seconds(server, session_id).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn get_idle_seconds(
        &self,
        _handle_id: Option<String>,
        _session_id: u32,
    ) -> Result<Option<i64>, String> {
        Err(TsError::platform().to_string())
    }

    // ─── Process operations ─────────────────────────────────────

    /// List all processes on the server.
    #[cfg(windows)]
    pub fn list_processes(
        &self,
        handle_id: Option<String>,
    ) -> Result<Vec<TsProcessInfo>, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::processes::list_processes(server).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn list_processes(
        &self,
        _handle_id: Option<String>,
    ) -> Result<Vec<TsProcessInfo>, String> {
        Err(TsError::platform().to_string())
    }

    /// List processes for a specific session.
    #[cfg(windows)]
    pub fn list_session_processes(
        &self,
        handle_id: Option<String>,
        session_id: u32,
    ) -> Result<Vec<TsProcessInfo>, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::processes::list_session_processes(server, session_id)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn list_session_processes(
        &self,
        _handle_id: Option<String>,
        _session_id: u32,
    ) -> Result<Vec<TsProcessInfo>, String> {
        Err(TsError::platform().to_string())
    }

    /// Search processes by name.
    #[cfg(windows)]
    pub fn find_processes_by_name(
        &self,
        handle_id: Option<String>,
        name_pattern: String,
    ) -> Result<Vec<TsProcessInfo>, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::processes::find_processes_by_name(server, &name_pattern)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn find_processes_by_name(
        &self,
        _handle_id: Option<String>,
        _name_pattern: String,
    ) -> Result<Vec<TsProcessInfo>, String> {
        Err(TsError::platform().to_string())
    }

    /// Terminate a process by PID.
    #[cfg(windows)]
    pub fn terminate_process(
        &self,
        handle_id: Option<String>,
        process_id: u32,
        exit_code: u32,
    ) -> Result<(), String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::processes::terminate(server, process_id, exit_code)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn terminate_process(
        &self,
        _handle_id: Option<String>,
        _process_id: u32,
        _exit_code: u32,
    ) -> Result<(), String> {
        Err(TsError::platform().to_string())
    }

    /// Terminate all processes matching a name pattern in a session.
    #[cfg(windows)]
    pub fn terminate_processes_by_name(
        &self,
        handle_id: Option<String>,
        session_id: u32,
        name_pattern: String,
        exit_code: u32,
    ) -> Result<u32, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::processes::terminate_by_name(server, session_id, &name_pattern, exit_code)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn terminate_processes_by_name(
        &self,
        _handle_id: Option<String>,
        _session_id: u32,
        _name_pattern: String,
        _exit_code: u32,
    ) -> Result<u32, String> {
        Err(TsError::platform().to_string())
    }

    /// Get process count per session.
    #[cfg(windows)]
    pub fn process_count_per_session(
        &self,
        handle_id: Option<String>,
    ) -> Result<Vec<(u32, usize)>, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::processes::process_count_per_session(server)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn process_count_per_session(
        &self,
        _handle_id: Option<String>,
    ) -> Result<Vec<(u32, usize)>, String> {
        Err(TsError::platform().to_string())
    }

    /// Get the top N process names by frequency.
    #[cfg(windows)]
    pub fn top_process_names(
        &self,
        handle_id: Option<String>,
        n: usize,
    ) -> Result<Vec<(String, usize)>, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::processes::top_process_names(server, n)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn top_process_names(
        &self,
        _handle_id: Option<String>,
        _n: usize,
    ) -> Result<Vec<(String, usize)>, String> {
        Err(TsError::platform().to_string())
    }

    // ─── Messaging ──────────────────────────────────────────────

    /// Send a message to a session.
    #[cfg(windows)]
    pub fn send_message(
        &self,
        handle_id: Option<String>,
        params: SendMessageParams,
    ) -> Result<MessageResponse, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::messaging::send_message(server, &params).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn send_message(
        &self,
        _handle_id: Option<String>,
        _params: SendMessageParams,
    ) -> Result<MessageResponse, String> {
        Err(TsError::platform().to_string())
    }

    /// Send a quick info message.
    #[cfg(windows)]
    pub fn send_info(
        &self,
        handle_id: Option<String>,
        session_id: u32,
        title: String,
        message: String,
    ) -> Result<MessageResponse, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::messaging::send_info(server, session_id, &title, &message)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn send_info(
        &self,
        _handle_id: Option<String>,
        _session_id: u32,
        _title: String,
        _message: String,
    ) -> Result<MessageResponse, String> {
        Err(TsError::platform().to_string())
    }

    /// Broadcast a message to all active sessions.
    #[cfg(windows)]
    pub fn broadcast_message(
        &self,
        handle_id: Option<String>,
        title: String,
        message: String,
        timeout_seconds: u32,
    ) -> Result<u32, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::messaging::broadcast_message(server, &title, &message, timeout_seconds)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn broadcast_message(
        &self,
        _handle_id: Option<String>,
        _title: String,
        _message: String,
        _timeout_seconds: u32,
    ) -> Result<u32, String> {
        Err(TsError::platform().to_string())
    }

    // ─── Shadow ─────────────────────────────────────────────────

    /// Start remote control of a session.
    #[cfg(windows)]
    pub fn start_shadow(&self, opts: ShadowOptions) -> Result<(), String> {
        crate::shadow::start_shadow(&opts).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn start_shadow(&self, _opts: ShadowOptions) -> Result<(), String> {
        Err(TsError::platform().to_string())
    }

    /// Stop remote control of a session.
    #[cfg(windows)]
    pub fn stop_shadow(&self, session_id: u32) -> Result<(), String> {
        crate::shadow::stop_shadow(session_id).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn stop_shadow(&self, _session_id: u32) -> Result<(), String> {
        Err(TsError::platform().to_string())
    }

    // ─── Server operations ──────────────────────────────────────

    /// Enumerate domain servers.
    #[cfg(windows)]
    pub fn enumerate_domain_servers(&self, domain: String) -> Result<Vec<TsServerInfo>, String> {
        crate::server::enumerate_domain_servers(&domain).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn enumerate_domain_servers(&self, _domain: String) -> Result<Vec<TsServerInfo>, String> {
        Err(TsError::platform().to_string())
    }

    /// Shutdown a server.
    #[cfg(windows)]
    pub fn shutdown_server(
        &self,
        handle_id: Option<String>,
        flag: ShutdownFlag,
    ) -> Result<(), String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::server::shutdown(server, flag).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn shutdown_server(
        &self,
        _handle_id: Option<String>,
        _flag: ShutdownFlag,
    ) -> Result<(), String> {
        Err(TsError::platform().to_string())
    }

    /// List listeners on a server.
    #[cfg(windows)]
    pub fn list_listeners(
        &self,
        handle_id: Option<String>,
    ) -> Result<Vec<TsListenerInfo>, String> {
        let server = self.resolve_handle(&handle_id)?;
        crate::server::list_listeners(server).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn list_listeners(
        &self,
        _handle_id: Option<String>,
    ) -> Result<Vec<TsListenerInfo>, String> {
        Err(TsError::platform().to_string())
    }

    // ─── User configuration ─────────────────────────────────────

    /// Query Terminal Services user configuration.
    #[cfg(windows)]
    pub fn query_user_config(
        &self,
        server_name: &str,
        user_name: &str,
    ) -> Result<TsUserConfig, String> {
        crate::wts_ffi::query_user_config(server_name, user_name)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn query_user_config(
        &self,
        _server_name: &str,
        _user_name: &str,
    ) -> Result<TsUserConfig, String> {
        Err(TsError::platform().to_string())
    }

    /// Set Terminal Services user configuration.
    #[cfg(windows)]
    pub fn set_user_config(&self, config: &TsUserConfig) -> Result<(), String> {
        crate::wts_ffi::set_user_config(config).map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn set_user_config(&self, _config: &TsUserConfig) -> Result<(), String> {
        Err(TsError::platform().to_string())
    }

    // ─── Encryption & address ───────────────────────────────────

    /// Query the encryption level for a session.
    #[cfg(windows)]
    pub fn get_encryption_level(
        &self,
        handle_id: Option<String>,
        session_id: u32,
    ) -> Result<EncryptionLevel, String> {
        let server = self.resolve_handle(&handle_id)?;
        let (level, _desc) = crate::wts_ffi::query_encryption_level(server, session_id);
        Ok(EncryptionLevel::from_u8(level))
    }

    #[cfg(not(windows))]
    pub fn get_encryption_level(
        &self,
        _handle_id: Option<String>,
        _session_id: u32,
    ) -> Result<EncryptionLevel, String> {
        Err(TsError::platform().to_string())
    }

    /// Query the session virtual IP address (IPv4).
    #[cfg(windows)]
    pub fn get_session_address(
        &self,
        handle_id: Option<String>,
        session_id: u32,
    ) -> Result<Option<String>, String> {
        let server = self.resolve_handle(&handle_id)?;
        Ok(crate::wts_ffi::query_session_address_v4(server, session_id))
    }

    #[cfg(not(windows))]
    pub fn get_session_address(
        &self,
        _handle_id: Option<String>,
        _session_id: u32,
    ) -> Result<Option<String>, String> {
        Err(TsError::platform().to_string())
    }

    // ─── Session filtering & batch ops ──────────────────────────

    /// List sessions matching a `SessionFilter`.
    #[cfg(windows)]
    pub fn list_sessions_filtered(
        &self,
        handle_id: Option<String>,
        filter: SessionFilter,
    ) -> Result<Vec<SessionDetail>, String> {
        let server = self.resolve_handle(&handle_id)?;
        let all = crate::sessions::get_all_session_details(server)
            .map_err(|e| e.to_string())?;
        let filtered = all.into_iter().filter(|s| {
            if let Some(ref state) = filter.state {
                if s.state != *state { return false; }
            }
            if filter.user_sessions_only && s.user_name.is_empty() {
                return false;
            }
            if filter.remote_only && !s.is_remote_session {
                return false;
            }
            if let Some(ref pat) = filter.user_pattern {
                let pat_lc = pat.to_lowercase();
                if !s.user_name.to_lowercase().contains(&pat_lc) {
                    return false;
                }
            }
            if let Some(min_idle) = filter.min_idle_seconds {
                if let Some(ref lit) = s.last_input_time {
                    let idle_secs = (Utc::now() - *lit).num_seconds();
                    if idle_secs < min_idle as i64 { return false; }
                }
            }
            true
        }).collect();
        Ok(filtered)
    }

    #[cfg(not(windows))]
    pub fn list_sessions_filtered(
        &self,
        _handle_id: Option<String>,
        _filter: SessionFilter,
    ) -> Result<Vec<SessionDetail>, String> {
        Err(TsError::platform().to_string())
    }

    /// Batch disconnect sessions by IDs.
    #[cfg(windows)]
    pub fn batch_disconnect(
        &self,
        handle_id: Option<String>,
        session_ids: Vec<u32>,
    ) -> Result<BatchResult, String> {
        let server = self.resolve_handle(&handle_id)?;
        let mut result = BatchResult::new();
        for sid in session_ids {
            match crate::sessions::disconnect(server, sid, self.config.wait_for_operations) {
                Ok(()) => result.record_success(),
                Err(e) => result.record_failure(format!("session {}: {}", sid, e)),
            }
        }
        Ok(result)
    }

    #[cfg(not(windows))]
    pub fn batch_disconnect(
        &self,
        _handle_id: Option<String>,
        _session_ids: Vec<u32>,
    ) -> Result<BatchResult, String> {
        Err(TsError::platform().to_string())
    }

    /// Batch logoff sessions by IDs.
    #[cfg(windows)]
    pub fn batch_logoff(
        &self,
        handle_id: Option<String>,
        session_ids: Vec<u32>,
    ) -> Result<BatchResult, String> {
        let server = self.resolve_handle(&handle_id)?;
        let mut result = BatchResult::new();
        for sid in session_ids {
            match crate::sessions::logoff(server, sid, self.config.wait_for_operations) {
                Ok(()) => result.record_success(),
                Err(e) => result.record_failure(format!("session {}: {}", sid, e)),
            }
        }
        Ok(result)
    }

    #[cfg(not(windows))]
    pub fn batch_logoff(
        &self,
        _handle_id: Option<String>,
        _session_ids: Vec<u32>,
    ) -> Result<BatchResult, String> {
        Err(TsError::platform().to_string())
    }

    /// Broadcast a message and return per-session results.
    #[cfg(windows)]
    pub fn batch_send_message(
        &self,
        handle_id: Option<String>,
        session_ids: Vec<u32>,
        title: String,
        message: String,
        timeout_seconds: u32,
    ) -> Result<BatchResult, String> {
        let server = self.resolve_handle(&handle_id)?;
        let mut result = BatchResult::new();
        for sid in session_ids {
            let params = SendMessageParams {
                session_id: sid,
                title: title.clone(),
                message: message.clone(),
                style: MessageStyle::Ok,
                timeout_seconds,
                wait: false,
            };
            match crate::messaging::send_message(server, &params) {
                Ok(_) => result.record_success(),
                Err(e) => result.record_failure(format!("session {}: {}", sid, e)),
            }
        }
        Ok(result)
    }

    #[cfg(not(windows))]
    pub fn batch_send_message(
        &self,
        _handle_id: Option<String>,
        _session_ids: Vec<u32>,
        _title: String,
        _message: String,
        _timeout_seconds: u32,
    ) -> Result<BatchResult, String> {
        Err(TsError::platform().to_string())
    }

    // ─── Event monitoring ───────────────────────────────────────

    /// Wait for a system event (blocking). Use from a background thread.
    #[cfg(windows)]
    pub fn wait_system_event(
        &self,
        handle_id: Option<String>,
        event_mask: u32,
    ) -> Result<TsEventRecord, String> {
        let server = self.resolve_handle(&handle_id)?;
        let flags = crate::wts_ffi::wait_system_event(server, event_mask)
            .map_err(|e| e.to_string())?;
        let events = crate::wts_ffi::decode_event_flags(flags);
        Ok(TsEventRecord {
            timestamp: Utc::now(),
            event_flags: flags,
            events,
        })
    }

    #[cfg(not(windows))]
    pub fn wait_system_event(
        &self,
        _handle_id: Option<String>,
        _event_mask: u32,
    ) -> Result<TsEventRecord, String> {
        Err(TsError::platform().to_string())
    }
}

impl Default for TermServService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(windows)]
impl Drop for TermServService {
    fn drop(&mut self) {
        self.close_all_servers();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_new() {
        let svc = TermServService::new();
        let config = svc.get_config();
        assert_eq!(config.default_timeout_seconds, 30);
        assert!(config.wait_for_operations);
    }

    #[test]
    fn service_with_config() {
        let cfg = TermServConfig {
            default_timeout_seconds: 60,
            wait_for_operations: false,
            max_open_servers: 5,
        };
        let svc = TermServService::with_config(cfg.clone());
        assert_eq!(svc.get_config().default_timeout_seconds, 60);
    }

    #[test]
    fn service_state_is_sendable() {
        let state = TermServService::new_state();
        // Ensure it can be sent across threads (required by Tauri).
        fn assert_send<T: Send>() {}
        assert_send::<TermServServiceState>();
        drop(state);
    }

    #[test]
    fn config_serde_roundtrip() {
        let cfg = TermServConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: TermServConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.default_timeout_seconds, 30);
    }

    #[test]
    fn list_open_servers_initially_empty() {
        let svc = TermServService::new();
        assert!(svc.list_open_servers().is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn console_and_current_session_ids() {
        let svc = TermServService::new();
        let console_id = svc.get_console_session_id();
        let current_id = svc.get_current_session_id();
        assert!(console_id <= 65535);
        assert!(current_id <= 65535);
    }

    #[test]
    fn config_camel_case_serde() {
        let cfg = TermServConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("defaultTimeoutSeconds"));
        assert!(json.contains("waitForOperations"));
        assert!(json.contains("maxOpenServers"));
    }

    #[test]
    fn service_set_config() {
        let mut svc = TermServService::new();
        let mut cfg = svc.get_config();
        cfg.default_timeout_seconds = 120;
        cfg.wait_for_operations = false;
        svc.set_config(cfg);
        let c2 = svc.get_config();
        assert_eq!(c2.default_timeout_seconds, 120);
        assert!(!c2.wait_for_operations);
    }

    #[test]
    fn service_default_trait() {
        let svc = TermServService::default();
        assert_eq!(svc.get_config().default_timeout_seconds, 30);
    }

    #[cfg(not(windows))]
    #[test]
    fn platform_not_supported_stubs() {
        let svc = TermServService::new();
        assert!(svc.list_sessions(None, None).is_err());
        assert!(svc.list_user_sessions(None).is_err());
        assert!(svc.get_session_detail(None, 1).is_err());
        assert!(svc.get_all_session_details(None).is_err());
        assert!(svc.disconnect_session(None, 1).is_err());
        assert!(svc.logoff_session(None, 1).is_err());
        assert!(svc.connect_session(0, 1, "pw".to_string()).is_err());
        assert!(svc.logoff_disconnected(None).is_err());
        assert!(svc.find_sessions_by_user(None, "test".to_string()).is_err());
        assert!(svc.server_summary(None).is_err());
        assert!(svc.is_remote_session(None, 0).is_err());
        assert!(svc.get_idle_seconds(None, 0).is_err());
        assert!(svc.list_processes(None).is_err());
        assert!(svc.list_session_processes(None, 0).is_err());
        assert!(svc.find_processes_by_name(None, "x".to_string()).is_err());
        assert!(svc.terminate_process(None, 0, 0).is_err());
        assert!(svc.terminate_processes_by_name(None, 0, "x".to_string(), 0).is_err());
        assert!(svc.send_message(None, SendMessageParams {
            session_id: 0,
            title: String::new(),
            message: String::new(),
            style: MessageStyle::Ok,
            timeout_seconds: 0,
            wait: false,
        }).is_err());
        assert!(svc.start_shadow(ShadowOptions {
            target_session_id: 0,
            hotkey_vk: 0,
            hotkey_modifier: 0,
            control: false,
        }).is_err());
        assert!(svc.stop_shadow(0).is_err());
        assert!(svc.enumerate_domain_servers("dom".to_string()).is_err());
        assert!(svc.list_listeners(None).is_err());
        assert!(svc.query_user_config("srv", "user").is_err());
        assert!(svc.set_user_config(&TsUserConfig::default()).is_err());
        assert!(svc.get_encryption_level(None, 0).is_err());
        assert!(svc.get_session_address(None, 0).is_err());
        assert!(svc.list_sessions_filtered(None, SessionFilter::default()).is_err());
        assert!(svc.batch_disconnect(None, vec![1, 2]).is_err());
        assert!(svc.batch_logoff(None, vec![1, 2]).is_err());
        assert!(svc.batch_send_message(None, vec![1], "t".into(), "m".into(), 5).is_err());
        assert!(svc.wait_system_event(None, 0).is_err());
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_server_ops() {
        let mut svc = TermServService::new();
        assert!(svc.open_server("test").is_err());
        assert!(svc.close_server("x").is_err());
        assert_eq!(svc.close_all_servers(), 0);
        assert!(svc.list_open_servers().is_empty());
        assert_eq!(svc.get_console_session_id(), 0);
        assert_eq!(svc.get_current_session_id(), 0);
    }
}
