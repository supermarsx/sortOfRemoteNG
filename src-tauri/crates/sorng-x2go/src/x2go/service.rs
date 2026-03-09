//! X2Go service — multi-session manager.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::x2go::session::{SessionCommand, X2goSessionHandle};
use crate::x2go::types::*;

pub type X2goServiceState = Arc<Mutex<X2goService>>;

pub struct X2goService {
    sessions: HashMap<String, X2goSessionHandle>,
}

impl X2goService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Connect to an X2Go server (start or resume a session).
    pub async fn connect(
        &mut self,
        session_id: String,
        config: X2goConfig,
    ) -> Result<(), X2goError> {
        if self.sessions.contains_key(&session_id) {
            return Err(X2goError::already_exists(format!(
                "session '{}' already exists",
                session_id
            )));
        }

        let handle = X2goSessionHandle::connect(session_id.clone(), config).await?;
        self.sessions.insert(session_id, handle);
        Ok(())
    }

    /// Suspend a session (keep it alive on the server).
    pub async fn suspend(&mut self, session_id: &str) -> Result<(), X2goError> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| X2goError::not_found(format!("session '{}' not found", session_id)))?;
        handle.suspend().await?;
        // Remove from local tracking after suspend
        self.sessions.remove(session_id);
        Ok(())
    }

    /// Terminate a session permanently.
    pub async fn terminate(&mut self, session_id: &str) -> Result<(), X2goError> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| X2goError::not_found(format!("session '{}' not found", session_id)))?;
        handle.terminate().await?;
        self.sessions.remove(session_id);
        Ok(())
    }

    /// Disconnect locally (session may keep running on server).
    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), X2goError> {
        let handle = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| X2goError::not_found(format!("session '{}' not found", session_id)))?;
        let _ = handle.disconnect().await;
        Ok(())
    }

    /// Disconnect all sessions.
    pub async fn disconnect_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            if let Some(handle) = self.sessions.remove(&id) {
                let _ = handle.disconnect().await;
            }
        }
    }

    /// Send clipboard data.
    pub async fn send_clipboard(&self, session_id: &str, data: String) -> Result<(), X2goError> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| X2goError::not_found(format!("session '{}' not found", session_id)))?;
        handle
            .send_command(SessionCommand::SendClipboard(data))
            .await
    }

    /// Resize remote display.
    pub async fn resize(&self, session_id: &str, width: u32, height: u32) -> Result<(), X2goError> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| X2goError::not_found(format!("session '{}' not found", session_id)))?;
        handle
            .send_command(SessionCommand::Resize { width, height })
            .await
    }

    /// Mount a shared folder.
    pub async fn mount_folder(
        &self,
        session_id: &str,
        local_path: String,
        remote_name: String,
    ) -> Result<(), X2goError> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| X2goError::not_found(format!("session '{}' not found", session_id)))?;
        handle
            .send_command(SessionCommand::MountFolder {
                local_path,
                remote_name,
            })
            .await
    }

    /// Unmount a shared folder.
    pub async fn unmount_folder(
        &self,
        session_id: &str,
        remote_name: String,
    ) -> Result<(), X2goError> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| X2goError::not_found(format!("session '{}' not found", session_id)))?;
        handle
            .send_command(SessionCommand::UnmountFolder { remote_name })
            .await
    }

    /// Check if a session is connected.
    pub async fn is_connected(&self, session_id: &str) -> bool {
        if let Some(handle) = self.sessions.get(session_id) {
            let st = handle.state.lock().await;
            matches!(
                st.state,
                X2goSessionState::Running
                    | X2goSessionState::Starting
                    | X2goSessionState::Resuming
                    | X2goSessionState::Connecting
                    | X2goSessionState::Authenticating
            )
        } else {
            false
        }
    }

    /// Get session info as JSON.
    pub async fn get_session_info(&self, session_id: &str) -> Result<serde_json::Value, X2goError> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| X2goError::not_found(format!("session '{}' not found", session_id)))?;
        let st = handle.state.lock().await;
        Ok(serde_json::json!({
            "id": session_id,
            "host": handle.config.host,
            "username": handle.config.username,
            "state": format!("{:?}", st.state),
            "remote_session_id": st.remote_session_id,
            "display_number": st.display_number,
            "agent_pid": st.agent_pid,
            "gr_port": st.gr_port,
            "snd_port": st.snd_port,
            "fs_port": st.fs_port,
            "display_width": st.display_width,
            "display_height": st.display_height,
            "bytes_sent": st.bytes_sent,
            "bytes_received": st.bytes_received,
            "audio_active": st.audio_active,
            "mounted_folders": st.mounted_folders,
            "server_version": st.server_version,
            "last_activity": st.last_activity,
        }))
    }

    /// List all sessions.
    pub async fn list_sessions(&self) -> Vec<serde_json::Value> {
        let mut list = Vec::new();
        for (id, handle) in &self.sessions {
            let st = handle.state.lock().await;
            list.push(serde_json::json!({
                "id": id,
                "host": handle.config.host,
                "username": handle.config.username,
                "state": format!("{:?}", st.state),
                "remote_session_id": st.remote_session_id,
                "session_type": format!("{:?}", handle.config.session_type),
            }));
        }
        list
    }

    /// Get session stats.
    pub async fn get_session_stats(
        &self,
        session_id: &str,
    ) -> Result<serde_json::Value, X2goError> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| X2goError::not_found(format!("session '{}' not found", session_id)))?;
        let st = handle.state.lock().await;
        Ok(serde_json::json!({
            "bytes_sent": st.bytes_sent,
            "bytes_received": st.bytes_received,
            "audio_active": st.audio_active,
            "mounted_folders": st.mounted_folders.len(),
            "last_activity": st.last_activity,
        }))
    }

    /// Number of active sessions.
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Remove ended / failed sessions.
    pub async fn prune_ended(&mut self) -> Vec<String> {
        let mut pruned = Vec::new();
        let mut to_remove = Vec::new();

        for (id, handle) in &self.sessions {
            let st = handle.state.lock().await;
            if matches!(st.state, X2goSessionState::Ended | X2goSessionState::Failed) {
                to_remove.push(id.clone());
            }
        }

        for id in to_remove {
            self.sessions.remove(&id);
            pruned.push(id);
        }

        pruned
    }
}

impl Default for X2goService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_new() {
        let svc = X2goService::new();
        assert_eq!(svc.session_count(), 0);
    }

    #[tokio::test]
    async fn service_list_empty() {
        let svc = X2goService::new();
        assert!(svc.list_sessions().await.is_empty());
    }
}
