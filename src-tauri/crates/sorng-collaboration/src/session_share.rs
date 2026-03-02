//! # Session Share Manager
//!
//! Manages live session sharing — allowing multiple users to view or interact
//! with an active connection session (SSH terminal, RDP desktop, VNC screen, etc.).

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;

/// Manages all active shared sessions.
pub struct SessionShareManager {
    /// Active shared sessions indexed by session ID
    sessions: HashMap<String, SharedSession>,
}

impl SessionShareManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Start sharing an active session.
    pub fn start_share(
        &mut self,
        workspace_id: &str,
        connection_id: &str,
        owner_id: &str,
        protocol: SessionProtocol,
        mode: ShareMode,
        max_participants: u32,
    ) -> Result<SharedSession, String> {
        // Check if there's already an active share for this connection by this owner
        let already_shared = self.sessions.values().any(|s| {
            s.connection_id == connection_id
                && s.owner_id == owner_id
                && s.active
        });
        if already_shared {
            return Err("This session is already being shared".to_string());
        }

        let session = SharedSession {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.to_string(),
            owner_id: owner_id.to_string(),
            connection_id: connection_id.to_string(),
            protocol,
            mode,
            participants: Vec::new(),
            max_participants,
            started_at: Utc::now(),
            active: true,
        };
        self.sessions.insert(session.id.clone(), session.clone());
        Ok(session)
    }

    /// Join an active shared session as a participant.
    pub fn join_session(
        &mut self,
        session_id: &str,
        user_id: &str,
    ) -> Result<SharedSession, String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        if !session.active {
            return Err("Session is no longer active".to_string());
        }

        if session.max_participants > 0
            && session.participants.len() as u32 >= session.max_participants
        {
            return Err("Session has reached maximum participants".to_string());
        }

        // Check if already participating
        if session.participants.iter().any(|p| p.user_id == user_id) {
            return Err("Already participating in this session".to_string());
        }

        let has_input = match session.mode {
            ShareMode::Interactive => true,
            ShareMode::ViewOnly => false,
            ShareMode::Controlled => false, // Owner grants input explicitly
        };

        session.participants.push(SessionParticipant {
            user_id: user_id.to_string(),
            has_input,
            joined_at: Utc::now(),
        });

        Ok(session.clone())
    }

    /// Leave a shared session.
    pub fn leave_session(
        &mut self,
        session_id: &str,
        user_id: &str,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        session.participants.retain(|p| p.user_id != user_id);
        Ok(())
    }

    /// Stop sharing a session.
    pub fn stop_share(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        session.active = false;
        session.participants.clear();
        Ok(())
    }

    /// Get a session by ID.
    pub fn get_session(&self, session_id: &str) -> Result<SharedSession, String> {
        self.sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| "Session not found".to_string())
    }

    /// List all active shared sessions in a workspace.
    pub fn list_active_sessions(&self, workspace_id: &str) -> Vec<&SharedSession> {
        self.sessions
            .values()
            .filter(|s| s.workspace_id == workspace_id && s.active)
            .collect()
    }

    /// Grant input control to a participant (for Controlled mode).
    pub fn grant_input(
        &mut self,
        session_id: &str,
        owner_id: &str,
        target_user_id: &str,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        if session.owner_id != owner_id {
            return Err("Only the session owner can grant input control".to_string());
        }
        if let Some(participant) = session
            .participants
            .iter_mut()
            .find(|p| p.user_id == target_user_id)
        {
            participant.has_input = true;
            Ok(())
        } else {
            Err("User is not a participant in this session".to_string())
        }
    }

    /// Revoke input control from a participant.
    pub fn revoke_input(
        &mut self,
        session_id: &str,
        owner_id: &str,
        target_user_id: &str,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        if session.owner_id != owner_id {
            return Err("Only the session owner can revoke input control".to_string());
        }
        if let Some(participant) = session
            .participants
            .iter_mut()
            .find(|p| p.user_id == target_user_id)
        {
            participant.has_input = false;
            Ok(())
        } else {
            Err("User is not a participant in this session".to_string())
        }
    }

    /// Get the count of active shared sessions.
    pub fn active_session_count(&self) -> usize {
        self.sessions.values().filter(|s| s.active).count()
    }

    /// Clean up sessions that are no longer active.
    pub fn cleanup_inactive(&mut self) {
        self.sessions.retain(|_, s| s.active);
    }
}
