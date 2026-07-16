//! SPICE service — multi-session manager.
//!
//! `SpiceService` maintains a collection of SPICE sessions keyed by id and
//! provides a high-level async API for the Tauri command layer.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::spice::native_viewer::NativeSpiceSessionHandle;
use crate::spice::types::*;

/// Thread-safe wrapper for the SPICE service state (used as Tauri managed state).
pub type SpiceServiceState = Arc<Mutex<SpiceService>>;

/// Multi-session SPICE service.
pub struct SpiceService {
    sessions: HashMap<String, NativeSpiceSessionHandle>,
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
                if st.running {
                    return Err(SpiceError::new(
                        SpiceErrorKind::AlreadyConnected,
                        format!("Already connected to {}:{}", config.host, config.port),
                    ));
                }
            }
        }

        let handle = NativeSpiceSessionHandle::connect(id.clone(), config).await?;
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
        _scancode: u32,
        _down: bool,
    ) -> Result<(), SpiceError> {
        let _session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        Err(SpiceError::unsupported(
            "Embedded SPICE key injection is unavailable because the interactive session is owned by the native remote-viewer window",
        ))
    }

    /// Send a pointer (mouse) event to a session.
    pub async fn send_pointer_event(
        &self,
        session_id: &str,
        _x: i32,
        _y: i32,
        _button_mask: u8,
    ) -> Result<(), SpiceError> {
        let _session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        Err(SpiceError::unsupported(
            "Embedded SPICE pointer injection is unavailable because the interactive session is owned by the native remote-viewer window",
        ))
    }

    /// Send clipboard text to a session.
    pub async fn send_clipboard(&self, session_id: &str, _text: String) -> Result<(), SpiceError> {
        let _session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        Err(SpiceError::unsupported(
            "Clipboard synchronization is owned by the native remote-viewer window and cannot be injected through the embedded command API",
        ))
    }

    /// Request a display update for a session.
    pub async fn request_update(&self, session_id: &str) -> Result<(), SpiceError> {
        let _session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        Err(SpiceError::unsupported(
            "SPICE display update requests are not implemented; refusing to send placeholder data",
        ))
    }

    /// Set display resolution for a session.
    pub async fn set_resolution(
        &self,
        session_id: &str,
        _width: u32,
        _height: u32,
    ) -> Result<(), SpiceError> {
        let _session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        Err(SpiceError::unsupported(
            "Resolution changes must be made in the native remote-viewer window",
        ))
    }

    /// Redirect a USB device to the guest.
    pub async fn redirect_usb(
        &self,
        session_id: &str,
        _vendor_id: u16,
        _product_id: u16,
    ) -> Result<(), SpiceError> {
        let _session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        Err(SpiceError::unsupported(
            "USB device selection is owned by the native remote-viewer window",
        ))
    }

    /// Un-redirect a USB device.
    pub async fn unredirect_usb(
        &self,
        session_id: &str,
        _vendor_id: u16,
        _product_id: u16,
    ) -> Result<(), SpiceError> {
        let _session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SpiceError::session_not_found(session_id))?;
        Err(SpiceError::unsupported(
            "USB device selection is owned by the native remote-viewer window",
        ))
    }

    /// Check if a session is connected.
    pub async fn is_connected(&self, session_id: &str) -> bool {
        if let Some(session) = self.sessions.get(session_id) {
            let st = session.state.lock().await;
            st.running
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
            st.running,
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
                st.running,
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
            // The complete protocol is owned by remote-viewer. The process API
            // does not expose byte/frame counters, so report no invented data.
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            connected_at: st.started_at.clone(),
            last_activity: st.last_activity.clone(),
            uptime_secs: 0,
            display_width: 0,
            display_height: 0,
            channels_open: 0,
            mouse_mode: "native-viewer".into(),
            channels: vec![],
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
            if !st.running {
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
    use crate::spice::native_viewer::NativeSpiceSessionHandle;

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

    #[tokio::test]
    async fn request_update_returns_unsupported_for_registered_session() {
        let mut svc = SpiceService::new();
        let id = "test-session".to_string();
        svc.sessions.insert(
            id.clone(),
            NativeSpiceSessionHandle::test_handle(&id, SpiceConfig::default()),
        );

        let err = svc.request_update(&id).await.unwrap_err();
        assert_eq!(err.kind, SpiceErrorKind::UnsupportedFeature);
    }

    #[tokio::test]
    async fn command_level_disconnect_is_idempotent() {
        let mut svc = SpiceService::new();
        svc.disconnect_and_remove("already-gone").await.unwrap();
        svc.disconnect_and_remove("already-gone").await.unwrap();
        assert_eq!(svc.session_count(), 0);
    }
}
