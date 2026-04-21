//! NX service — multi-session manager.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::nx::session::{NxSessionHandle, SessionCommand};
use crate::nx::types::*;

/// Thread-safe wrapper for the NX service state.
pub type NxServiceState = Arc<Mutex<NxService>>;

/// Multi-session NX service.
pub struct NxService {
    sessions: HashMap<String, NxSessionHandle>,
}

impl Default for NxService {
    fn default() -> Self {
        Self::new()
    }
}

impl NxService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn new_state() -> NxServiceState {
        Arc::new(Mutex::new(Self::new()))
    }

    /// Connect a new NX session.
    pub async fn connect(&mut self, config: NxConfig) -> Result<String, NxError> {
        let id = uuid::Uuid::new_v4().to_string();

        for session in self.sessions.values() {
            if session.config.host == config.host && session.config.port == config.port {
                let st = session.state.lock().await;
                if st.state == NxSessionState::Running {
                    return Err(NxError::new(
                        NxErrorKind::AlreadyConnected,
                        format!("Already connected to {}:{}", config.host, config.port),
                    ));
                }
            }
        }

        let handle = NxSessionHandle::connect(id.clone(), config).await?;
        self.sessions.insert(id.clone(), handle);
        Ok(id)
    }

    /// Disconnect a session.
    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), NxError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| NxError::session_not_found(session_id))?;
        session.disconnect().await?;
        let mut st = session.state.lock().await;
        st.state = NxSessionState::Terminated;
        Ok(())
    }

    /// Suspend a session (keep it alive on the server).
    pub async fn suspend(&mut self, session_id: &str) -> Result<(), NxError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| NxError::session_not_found(session_id))?;
        session.suspend().await
    }

    /// Remove a session.
    pub fn remove_session(&mut self, session_id: &str) -> bool {
        self.sessions.remove(session_id).is_some()
    }

    /// Disconnect and remove.
    pub async fn disconnect_and_remove(&mut self, session_id: &str) -> Result<(), NxError> {
        self.disconnect(session_id).await.ok();
        self.remove_session(session_id);
        Ok(())
    }

    /// Disconnect all sessions.
    pub async fn disconnect_all(&mut self) -> Vec<String> {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        let mut disconnected = Vec::new();
        for id in &ids {
            if self.disconnect(id).await.is_ok() {
                disconnected.push(id.clone());
            }
        }
        self.sessions.clear();
        disconnected
    }

    /// Send key event.
    pub async fn send_key_event(
        &self,
        session_id: &str,
        keysym: u32,
        down: bool,
    ) -> Result<(), NxError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| NxError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::KeyEvent { keysym, down })
            .await
    }

    /// Send pointer event.
    pub async fn send_pointer_event(
        &self,
        session_id: &str,
        x: i32,
        y: i32,
        button_mask: u8,
    ) -> Result<(), NxError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| NxError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::PointerEvent { x, y, button_mask })
            .await
    }

    /// Send clipboard text.
    pub async fn send_clipboard(&self, session_id: &str, text: String) -> Result<(), NxError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| NxError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::SendClipboard(text))
            .await
    }

    /// Resize the display.
    pub async fn resize(&self, session_id: &str, width: u32, height: u32) -> Result<(), NxError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| NxError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::Resize { width, height })
            .await
    }

    /// Check if a session is running.
    pub async fn is_connected(&self, session_id: &str) -> bool {
        if let Some(session) = self.sessions.get(session_id) {
            let st = session.state.lock().await;
            st.state == NxSessionState::Running
        } else {
            false
        }
    }

    /// Get session info.
    pub async fn get_session_info(&self, session_id: &str) -> Result<NxSession, NxError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| NxError::session_not_found(session_id))?;
        let st = session.state.lock().await;
        Ok(NxSession::from_config(
            &session.config,
            session.id.clone(),
            st.state,
        ))
    }

    /// List all sessions.
    pub async fn list_sessions(&self) -> Vec<NxSession> {
        let mut list = Vec::new();
        for session in self.sessions.values() {
            let st = session.state.lock().await;
            list.push(NxSession::from_config(
                &session.config,
                session.id.clone(),
                st.state,
            ));
        }
        list
    }

    /// Get session statistics.
    pub async fn get_session_stats(&self, session_id: &str) -> Result<NxStats, NxError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| NxError::session_not_found(session_id))?;
        let st = session.state.lock().await;
        Ok(NxStats {
            session_id: session.id.clone(),
            bytes_sent: st.bytes_sent,
            bytes_received: st.bytes_received,
            frame_count: st.frame_count,
            connected_at: st.last_activity.clone(),
            last_activity: st.last_activity.clone(),
            uptime_secs: 0,
            display_width: st.display_width,
            display_height: st.display_height,
            compression_ratio: 0.0,
            round_trip_ms: 0,
            bandwidth_kbps: 0,
            suspended_count: st.suspended_count,
            resumed_count: st.resumed_count,
        })
    }

    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Prune terminated sessions.
    pub async fn prune_terminated(&mut self) -> Vec<String> {
        let mut to_remove = Vec::new();
        for (id, session) in &self.sessions {
            let st = session.state.lock().await;
            if st.state == NxSessionState::Terminated || st.state == NxSessionState::Failed {
                to_remove.push(id.clone());
            }
        }
        for id in &to_remove {
            self.sessions.remove(id);
        }
        to_remove
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_new() {
        let svc = NxService::new();
        assert_eq!(svc.session_count(), 0);
    }

    #[test]
    fn service_state() {
        let state = NxService::new_state();
        assert_eq!(Arc::strong_count(&state), 1);
    }
}
