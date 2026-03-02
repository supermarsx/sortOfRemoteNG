//! # Session Manager
//!
//! Tracks all gateway-proxied sessions through their lifecycle:
//! Pending → Authenticating → Active → Closed/Error/Terminated.

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;

/// Manages all gateway sessions.
pub struct SessionManager {
    /// All sessions indexed by session ID
    sessions: HashMap<String, GatewaySession>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Create a new session.
    pub fn create_session(
        &mut self,
        user_id: &str,
        username: &str,
        protocol: GatewayProtocol,
        source_addr: &str,
        target_addr: &str,
        recording: bool,
    ) -> GatewaySession {
        let session = GatewaySession {
            id: uuid::Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            username: username.to_string(),
            protocol,
            source_addr: source_addr.to_string(),
            target_addr: target_addr.to_string(),
            target_hostname: None,
            route_id: None,
            state: SessionState::Pending,
            created_at: Utc::now(),
            connected_at: None,
            ended_at: None,
            bytes_sent: 0,
            bytes_received: 0,
            recording,
            recording_id: None,
            metadata: HashMap::new(),
        };

        self.sessions.insert(session.id.clone(), session.clone());
        session
    }

    /// Transition a session to the Active state.
    pub fn activate_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        session.state = SessionState::Active;
        session.connected_at = Some(Utc::now());
        Ok(())
    }

    /// Terminate a session (admin/policy action).
    pub fn terminate_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        session.state = SessionState::Terminated;
        session.ended_at = Some(Utc::now());
        Ok(())
    }

    /// Close a session normally.
    pub fn close_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        session.state = SessionState::Closed;
        session.ended_at = Some(Utc::now());
        Ok(())
    }

    /// Mark a session as errored.
    pub fn error_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        session.state = SessionState::Error;
        session.ended_at = Some(Utc::now());
        Ok(())
    }

    /// Get a session by ID.
    pub fn get_session(&self, session_id: &str) -> Result<GatewaySession, String> {
        self.sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| "Session not found".to_string())
    }

    /// List all active sessions.
    pub fn list_active(&self) -> Vec<&GatewaySession> {
        self.sessions
            .values()
            .filter(|s| matches!(s.state, SessionState::Active | SessionState::Authenticating))
            .collect()
    }

    /// List sessions by user.
    pub fn list_by_user(&self, user_id: &str) -> Vec<&GatewaySession> {
        self.sessions
            .values()
            .filter(|s| s.user_id == user_id)
            .collect()
    }

    /// List active sessions by user.
    pub fn list_active_by_user(&self, user_id: &str) -> Vec<&GatewaySession> {
        self.sessions
            .values()
            .filter(|s| {
                s.user_id == user_id
                    && matches!(s.state, SessionState::Active | SessionState::Authenticating)
            })
            .collect()
    }

    /// Update bytes transferred for a session.
    pub fn update_bytes(
        &mut self,
        session_id: &str,
        sent: u64,
        received: u64,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        session.bytes_sent += sent;
        session.bytes_received += received;
        Ok(())
    }

    /// Get the count of active sessions.
    pub fn active_count(&self) -> u32 {
        self.list_active().len() as u32
    }

    /// Get the count of active sessions for a specific user.
    pub fn active_count_by_user(&self, user_id: &str) -> u32 {
        self.list_active_by_user(user_id).len() as u32
    }

    /// Get total session count (all states).
    pub fn total_count(&self) -> u64 {
        self.sessions.len() as u64
    }

    /// Check if a session is active.
    pub fn is_active(&self, session_id: &str) -> bool {
        self.sessions
            .get(session_id)
            .map(|s| matches!(s.state, SessionState::Active))
            .unwrap_or(false)
    }

    /// Set session metadata.
    pub fn set_metadata(
        &mut self,
        session_id: &str,
        key: &str,
        value: &str,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        session.metadata.insert(key.to_string(), value.to_string());
        Ok(())
    }

    /// Clean up old ended sessions from memory.
    pub fn cleanup_ended(&mut self, keep_recent: usize) {
        let mut ended: Vec<(String, chrono::DateTime<Utc>)> = self
            .sessions
            .iter()
            .filter(|(_, s)| {
                matches!(
                    s.state,
                    SessionState::Closed | SessionState::Error | SessionState::Terminated
                )
            })
            .map(|(id, s)| (id.clone(), s.ended_at.unwrap_or(s.created_at)))
            .collect();

        ended.sort_by(|a, b| b.1.cmp(&a.1));

        // Keep the most recent `keep_recent` ended sessions, remove the rest
        if ended.len() > keep_recent {
            for (id, _) in &ended[keep_recent..] {
                self.sessions.remove(id);
            }
        }
    }
}
