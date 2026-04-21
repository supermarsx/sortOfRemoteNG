use crate::error::AiAssistError;
use crate::shell_detect::ShellDetector;
use crate::types::*;

use std::collections::HashMap;

/// Manages per-connection AI assist sessions.
pub struct SessionManager {
    sessions: HashMap<String, SessionContext>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Create a new session for an SSH connection.
    pub fn create_session(
        &mut self,
        session_id: &str,
        host: &str,
        username: &str,
    ) -> &SessionContext {
        let ctx = SessionContext::new(session_id, host, username);
        self.sessions.insert(session_id.to_string(), ctx);
        // SAFETY: entry was just inserted on the line above
        self.sessions.get(session_id).expect("entry was just inserted")
    }

    /// Get a session by ID.
    pub fn get_session(&self, session_id: &str) -> Option<&SessionContext> {
        self.sessions.get(session_id)
    }

    /// Get a mutable session by ID.
    pub fn get_session_mut(&mut self, session_id: &str) -> Option<&mut SessionContext> {
        self.sessions.get_mut(session_id)
    }

    /// Remove a session.
    pub fn remove_session(&mut self, session_id: &str) -> Option<SessionContext> {
        self.sessions.remove(session_id)
    }

    /// List all active session IDs.
    pub fn list_sessions(&self) -> Vec<String> {
        self.sessions.keys().cloned().collect()
    }

    /// Update session context with new environment info.
    pub fn update_context(
        &mut self,
        session_id: &str,
        cwd: Option<String>,
        shell_env: Option<String>,
        uname_output: Option<String>,
        env_vars: Option<Vec<(String, String)>>,
    ) -> Result<(), AiAssistError> {
        let ctx = self.sessions.get_mut(session_id).ok_or_else(|| {
            AiAssistError::session_error(&format!("Session '{}' not found", session_id))
        })?;

        if let Some(dir) = cwd {
            ctx.cwd = dir;
        }

        if let Some(shell) = shell_env {
            ctx.shell = ShellDetector::detect_shell(Some(&shell), None);
        }

        if let Some(ref env) = env_vars {
            let os = ShellDetector::detect_os(uname_output.as_deref(), env);
            ctx.os = os;
            ctx.env_vars = env.clone();
        } else if let Some(ref uname) = uname_output {
            ctx.os = ShellDetector::detect_os(Some(uname), &ctx.env_vars);
        }

        Ok(())
    }

    /// Record a command execution in the session.
    pub fn record_command(
        &mut self,
        session_id: &str,
        command: &str,
        exit_code: Option<i32>,
        output: Option<String>,
        duration_ms: Option<u64>,
    ) -> Result<(), AiAssistError> {
        let ctx = self.sessions.get_mut(session_id).ok_or_else(|| {
            AiAssistError::session_error(&format!("Session '{}' not found", session_id))
        })?;

        ctx.add_command(command, exit_code, duration_ms);
        ctx.last_exit_code = exit_code;
        ctx.last_output = output;

        Ok(())
    }

    /// Set installed tools for a session.
    pub fn set_installed_tools(
        &mut self,
        session_id: &str,
        tools: Vec<String>,
    ) -> Result<(), AiAssistError> {
        let ctx = self.sessions.get_mut(session_id).ok_or_else(|| {
            AiAssistError::session_error(&format!("Session '{}' not found", session_id))
        })?;
        ctx.installed_tools = tools;
        Ok(())
    }

    /// Get session count.
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }
}
