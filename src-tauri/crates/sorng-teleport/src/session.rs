//! # Teleport Session Management
//!
//! List, join, and manage active sessions. Provides helpers for
//! session metadata, participant management, and session commands.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Build `tsh sessions ls` command.
pub fn list_sessions_command(format_json: bool) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "sessions".to_string(), "ls".to_string()];
    if format_json {
        cmd.push("--format=json".to_string());
    }
    cmd
}

/// Build `tsh join` command to join an existing session.
pub fn join_session_command(session_id: &str, mode: ParticipantMode) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "join".to_string()];
    let mode_str = match mode {
        ParticipantMode::Observer => "observer",
        ParticipantMode::Moderator => "moderator",
        ParticipantMode::Peer => "peer",
    };
    cmd.push(format!("--mode={}", mode_str));
    cmd.push(session_id.to_string());
    cmd
}

/// Filter sessions by type.
pub fn filter_by_type<'a>(
    sessions: &[&'a TeleportSession],
    session_type: SessionType,
) -> Vec<&'a TeleportSession> {
    sessions
        .iter()
        .filter(|s| s.session_type == session_type)
        .copied()
        .collect()
}

/// Filter sessions by user.
pub fn filter_by_user<'a>(
    sessions: &[&'a TeleportSession],
    user: &str,
) -> Vec<&'a TeleportSession> {
    sessions
        .iter()
        .filter(|s| s.user == user)
        .copied()
        .collect()
}

/// Session summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub total: u32,
    pub ssh: u32,
    pub kube: u32,
    pub db: u32,
    pub app: u32,
    pub desktop: u32,
    pub interactive: u32,
    pub with_enhanced_recording: u32,
}

pub fn summarize_sessions(sessions: &[&TeleportSession]) -> SessionSummary {
    SessionSummary {
        total: sessions.len() as u32,
        ssh: sessions.iter().filter(|s| s.session_type == SessionType::Ssh).count() as u32,
        kube: sessions.iter().filter(|s| s.session_type == SessionType::Kubernetes).count() as u32,
        db: sessions.iter().filter(|s| s.session_type == SessionType::Database).count() as u32,
        app: sessions.iter().filter(|s| s.session_type == SessionType::App).count() as u32,
        desktop: sessions.iter().filter(|s| s.session_type == SessionType::Desktop).count() as u32,
        interactive: sessions.iter().filter(|s| s.interactive).count() as u32,
        with_enhanced_recording: sessions.iter().filter(|s| s.enhanced_recording).count() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_join_session_command() {
        let cmd = join_session_command("sess-123", ParticipantMode::Observer);
        assert!(cmd.contains(&"--mode=observer".to_string()));
        assert!(cmd.contains(&"sess-123".to_string()));
    }

    #[test]
    fn test_list_sessions_command() {
        let cmd = list_sessions_command(true);
        assert!(cmd.contains(&"--format=json".to_string()));
    }
}
