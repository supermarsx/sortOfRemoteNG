//! SPICE service — multi-session manager.
//!
//! `SpiceService` maintains a collection of SPICE sessions keyed by id and
//! provides a high-level async API for the Tauri command layer.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::spice::session::{SessionCommand, SpiceSessionHandle};
use crate::spice::types::*;

/// Thread-safe wrapper for the SPICE service state (used as Tauri managed state).
pub type SpiceServiceState = Arc<Mutex<SpiceService>>;

/// Multi-session SPICE service.
pub struct SpiceService {
    sessions: HashMap<String, SpiceSessionHandle>,
}

impl Default for SpiceService {
    fn default() -> Self {
        Self::new()
    }
}

impl SpiceService {
    /// Create a new (empty) service.
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Create a service wrapped in `Arc<Mutex<>>` for Tauri state management.
    pub fn new_state() -> SpiceServiceState {
        Arc::new(Mutex::new(Self::new()))
    }

    /// Connect a new SPICE session.
    pub async fn connect(&mut self, config: SpiceConfig) -> Result<String, SpiceError> {
        let id = uuid::Uuid::new_v4().to_string();

        // Check for duplicate connections to the same host:port.
        for session in self.sessions.values() {
            if session.config.host == config.host && session.config.port == config.port {
                let st = session.state.lock().await;
                if st.connected {
                    return Err(SpiceError::new(
                        SpiceErrorKind::AlreadyConnected,
                        format!("Already connected to {}:{}", config.host, config.port),
                    ));
                }
            }
        }

        let handle = SpiceSessionHandle::connect(id.clone(), config).await?;
        self.sessions.insert(id.clone(), handle);

        Ok(id)
    }

    /// Disconnect a specific session.
    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), SpiceError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;

        session.disconnect().await?;

        {
            let mut st = session.state.lock().await;
            st.connected = false;
        }

        Ok(())
    }

    /// Remove a disconnected session from the map.
    pub fn remove_session(&mut self, session_id: &str) -> bool {
        self.sessions.remove(session_id).is_some()
    }

    /// Disconnect and remove a session.
    pub async fn disconnect_and_remove(&mut self, session_id: &str) -> Result<(), SpiceError> {
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

    /// Send a key event to a session.
    pub async fn send_key_event(
        &self,
        session_id: &str,
        scancode: u32,
        down: bool,
    ) -> Result<(), SpiceError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::KeyEvent { scancode, down })
            .await
    }

    /// Send a pointer (mouse) event to a session.
    pub async fn send_pointer_event(
        &self,
        session_id: &str,
        x: i32,
        y: i32,
        button_mask: u8,
    ) -> Result<(), SpiceError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::PointerEvent { x, y, button_mask })
            .await
    }

    /// Send clipboard text to a session.
    pub async fn send_clipboard(&self, session_id: &str, text: String) -> Result<(), SpiceError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::SendClipboard(text))
            .await
    }

    /// Request a display update for a session.
    pub async fn request_update(&self, session_id: &str) -> Result<(), SpiceError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        session.send_command(SessionCommand::RequestUpdate).await
    }

    /// Set display resolution for a session.
    pub async fn set_resolution(
        &self,
        session_id: &str,
        width: u32,
        height: u32,
    ) -> Result<(), SpiceError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::SetResolution { width, height })
            .await
    }

    /// Redirect a USB device to the guest.
    pub async fn redirect_usb(
        &self,
        session_id: &str,
        vendor_id: u16,
        product_id: u16,
    ) -> Result<(), SpiceError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::RedirectUsb {
                vendor_id,
                product_id,
            })
            .await
    }

    /// Un-redirect a USB device.
    pub async fn unredirect_usb(
        &self,
        session_id: &str,
        vendor_id: u16,
        product_id: u16,
    ) -> Result<(), SpiceError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::UnredirectUsb {
                vendor_id,
                product_id,
            })
            .await
    }

    /// Check if a session is connected.
    pub async fn is_connected(&self, session_id: &str) -> bool {
        if let Some(session) = self.sessions.get(session_id) {
            let st = session.state.lock().await;
            st.connected
        } else {
            false
        }
    }

    /// Get session info.
    pub async fn get_session_info(&self, session_id: &str) -> Result<SpiceSession, SpiceError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;

        let st = session.state.lock().await;

        Ok(SpiceSession::from_config(
            &session.config,
            session.id.clone(),
            st.connected,
        ))
    }

    /// List all sessions.
    pub async fn list_sessions(&self) -> Vec<SpiceSession> {
        let mut list = Vec::new();
        for session in self.sessions.values() {
            let st = session.state.lock().await;
            list.push(SpiceSession::from_config(
                &session.config,
                session.id.clone(),
                st.connected,
            ));
        }
        list
    }

    /// Get session statistics.
    pub async fn get_session_stats(&self, session_id: &str) -> Result<SpiceStats, SpiceError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;

        let st = session.state.lock().await;

        Ok(SpiceStats {
            session_id: session.id.clone(),
            bytes_sent: st.bytes_sent,
            bytes_received: st.bytes_received,
            frame_count: st.frame_count,
            connected_at: st.last_activity.clone(),
            last_activity: st.last_activity.clone(),
            uptime_secs: 0,
            display_width: st.display_width,
            display_height: st.display_height,
            channels_open: st.channels_open.len() as u32,
            mouse_mode: st.mouse_mode.clone(),
            channels: st
                .channels_open
                .iter()
                .map(|c| ChannelStats {
                    channel_type: *c,
                    messages_sent: 0,
                    messages_received: 0,
                    bytes_sent: 0,
                    bytes_received: 0,
                })
                .collect(),
        })
    }

    /// Number of tracked sessions.
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Prune disconnected sessions, returning removed ids.
    pub async fn prune_disconnected(&mut self) -> Vec<String> {
        let mut to_remove = Vec::new();
        for (id, session) in &self.sessions {
            let st = session.state.lock().await;
            if !st.connected {
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
        let svc = SpiceService::new();
        assert_eq!(svc.session_count(), 0);
    }

    #[test]
    fn service_state() {
        let state = SpiceService::new_state();
        assert!(Arc::strong_count(&state) == 1);
    }
}
