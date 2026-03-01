//! VNC service — multi-session manager.
//!
//! `VncService` maintains a collection of VNC sessions keyed by id and
//! provides a high-level async API for the Tauri command layer.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::vnc::session::{frame_to_event, SessionCommand, SessionEvent, VncSessionHandle};
use crate::vnc::types::*;

/// Thread-safe wrapper for the VNC service state (used as Tauri managed state).
pub type VncServiceState = Arc<Mutex<VncService>>;

/// Multi-session VNC service.
pub struct VncService {
    sessions: HashMap<String, VncSessionHandle>,
}

impl VncService {
    /// Create a new (empty) service.
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Create a service wrapped in `Arc<Mutex<>>` for Tauri state management.
    pub fn new_state() -> VncServiceState {
        Arc::new(Mutex::new(Self::new()))
    }

    /// Connect a new VNC session.
    ///
    /// Returns the session id on success.
    pub async fn connect(&mut self, config: VncConfig) -> Result<String, VncError> {
        let id = uuid::Uuid::new_v4().to_string();

        // Check for duplicate connections to the same host:port.
        for session in self.sessions.values() {
            if session.config.host == config.host && session.config.port == config.port {
                let st = session.state.lock().await;
                if st.connected {
                    return Err(VncError::new(
                        VncErrorKind::AlreadyConnected,
                        format!("Already connected to {}:{}", config.host, config.port),
                    ));
                }
            }
        }

        let handle = VncSessionHandle::connect(id.clone(), config).await?;
        self.sessions.insert(id.clone(), handle);

        Ok(id)
    }

    /// Disconnect a specific session.
    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), VncError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;

        session.disconnect().await?;

        // Mark as disconnected in shared state.
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
    pub async fn disconnect_and_remove(&mut self, session_id: &str) -> Result<(), VncError> {
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
        down: bool,
        key: u32,
    ) -> Result<(), VncError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::KeyEvent { down, key })
            .await
    }

    /// Send a pointer (mouse) event to a session.
    pub async fn send_pointer_event(
        &self,
        session_id: &str,
        button_mask: u8,
        x: u16,
        y: u16,
    ) -> Result<(), VncError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::PointerEvent { button_mask, x, y })
            .await
    }

    /// Send clipboard text to a session.
    pub async fn send_clipboard(
        &self,
        session_id: &str,
        text: String,
    ) -> Result<(), VncError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::ClientCutText(text))
            .await
    }

    /// Request a framebuffer update for a session.
    pub async fn request_update(
        &self,
        session_id: &str,
        incremental: bool,
    ) -> Result<(), VncError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::RequestUpdate { incremental })
            .await
    }

    /// Set the pixel format for a session.
    pub async fn set_pixel_format(
        &self,
        session_id: &str,
        pixel_format: PixelFormat,
    ) -> Result<(), VncError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::SetPixelFormat(pixel_format))
            .await
    }

    /// Set preferred encodings for a session.
    pub async fn set_encodings(
        &self,
        session_id: &str,
        encodings: Vec<EncodingType>,
    ) -> Result<(), VncError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;
        session
            .send_command(SessionCommand::SetEncodings(encodings))
            .await
    }

    /// Retrieve information about a specific session.
    pub async fn get_session_info(&self, session_id: &str) -> Result<VncSession, VncError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;

        let st = session.state.lock().await;

        Ok(VncSession {
            id: session.id.clone(),
            host: session.config.host.clone(),
            port: session.config.port,
            connected: st.connected,
            username: session.config.username.clone(),
            label: session.config.label.clone(),
            protocol_version: Some(st.protocol_version.clone()),
            security_type: Some(st.security_type.clone()),
            server_name: if st.server_name.is_empty() {
                None
            } else {
                Some(st.server_name.clone())
            },
            framebuffer_width: st.framebuffer_width,
            framebuffer_height: st.framebuffer_height,
            pixel_format: format!("{}", st.pixel_format),
            connected_at: st.last_activity.clone(), // Approximation.
            last_activity: st.last_activity.clone(),
            frame_count: st.frame_count,
            bytes_received: st.bytes_received,
            bytes_sent: st.bytes_sent,
            view_only: session.config.view_only,
        })
    }

    /// Get statistics for a session.
    pub async fn get_session_stats(&self, session_id: &str) -> Result<VncStats, VncError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;

        let st = session.state.lock().await;

        Ok(VncStats {
            session_id: session.id.clone(),
            bytes_sent: st.bytes_sent,
            bytes_received: st.bytes_received,
            frame_count: st.frame_count,
            connected_at: st.last_activity.clone(),
            last_activity: st.last_activity.clone(),
            uptime_secs: 0, // Could be computed from connected_at.
            framebuffer_width: st.framebuffer_width,
            framebuffer_height: st.framebuffer_height,
            pixel_format: format!("{}", st.pixel_format),
            encoding: String::new(),
        })
    }

    /// List all active session IDs.
    pub fn list_sessions(&self) -> Vec<String> {
        self.sessions.keys().cloned().collect()
    }

    /// List full info for all sessions.
    pub async fn list_session_info(&self) -> Vec<VncSession> {
        let mut result = Vec::with_capacity(self.sessions.len());
        for id in self.sessions.keys() {
            if let Ok(info) = self.get_session_info(id).await {
                result.push(info);
            }
        }
        result
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

    /// Get the total number of sessions.
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Drain events from a session.
    ///
    /// Returns up to `max` events, or all available if `max` is 0.
    pub async fn drain_events(
        &mut self,
        session_id: &str,
        max: usize,
    ) -> Result<Vec<SessionEvent>, VncError> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;

        let mut events = Vec::new();
        let limit = if max == 0 { 1000 } else { max };
        for _ in 0..limit {
            match session.event_rx.try_recv() {
                Ok(ev) => events.push(ev),
                Err(_) => break,
            }
        }

        Ok(events)
    }

    /// Collect frame events and convert them to Tauri event payloads.
    pub async fn collect_frame_events(
        &mut self,
        session_id: &str,
        max: usize,
    ) -> Result<Vec<VncFrameEvent>, VncError> {
        let events = self.drain_events(session_id, max).await?;
        let mut frames = Vec::new();
        for ev in events {
            if let SessionEvent::Frame(rect) = ev {
                frames.push(frame_to_event(session_id, &rect));
            }
        }
        Ok(frames)
    }

    /// Prune disconnected sessions from the map.
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

impl Default for VncService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_service_is_empty() {
        let svc = VncService::new();
        assert_eq!(svc.session_count(), 0);
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn new_state_returns_arc_mutex() {
        let state = VncService::new_state();
        // Just verify it compiles and runs.
        let _ = state;
    }

    #[test]
    fn default_impl() {
        let svc = VncService::default();
        assert_eq!(svc.session_count(), 0);
    }

    #[tokio::test]
    async fn is_connected_missing_session() {
        let svc = VncService::new();
        assert!(!svc.is_connected("nonexistent").await);
    }

    #[tokio::test]
    async fn disconnect_missing_session() {
        let mut svc = VncService::new();
        let result = svc.disconnect("nonexistent").await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.kind, VncErrorKind::SessionNotFound);
    }

    #[tokio::test]
    async fn get_session_info_missing() {
        let svc = VncService::new();
        let result = svc.get_session_info("none").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn get_session_stats_missing() {
        let svc = VncService::new();
        let result = svc.get_session_stats("none").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn send_key_event_missing() {
        let svc = VncService::new();
        assert!(svc.send_key_event("none", true, 0x41).await.is_err());
    }

    #[tokio::test]
    async fn send_pointer_event_missing() {
        let svc = VncService::new();
        assert!(svc.send_pointer_event("none", 0, 100, 200).await.is_err());
    }

    #[tokio::test]
    async fn send_clipboard_missing() {
        let svc = VncService::new();
        assert!(svc.send_clipboard("none", "text".into()).await.is_err());
    }

    #[tokio::test]
    async fn request_update_missing() {
        let svc = VncService::new();
        assert!(svc.request_update("none", true).await.is_err());
    }

    #[tokio::test]
    async fn set_pixel_format_missing() {
        let svc = VncService::new();
        assert!(
            svc.set_pixel_format("none", PixelFormat::rgba32())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn set_encodings_missing() {
        let svc = VncService::new();
        assert!(
            svc.set_encodings("none", vec![EncodingType::Raw])
                .await
                .is_err()
        );
    }

    #[test]
    fn remove_session_missing() {
        let mut svc = VncService::new();
        assert!(!svc.remove_session("nonexistent"));
    }

    #[tokio::test]
    async fn disconnect_and_remove_missing() {
        let mut svc = VncService::new();
        // Should not error — it silently ignores missing.
        assert!(svc.disconnect_and_remove("none").await.is_ok());
    }

    #[tokio::test]
    async fn disconnect_all_empty() {
        let mut svc = VncService::new();
        let result = svc.disconnect_all().await;
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn list_session_info_empty() {
        let svc = VncService::new();
        let info = svc.list_session_info().await;
        assert!(info.is_empty());
    }

    #[tokio::test]
    async fn prune_disconnected_empty() {
        let mut svc = VncService::new();
        let pruned = svc.prune_disconnected().await;
        assert!(pruned.is_empty());
    }

    #[tokio::test]
    async fn drain_events_missing() {
        let mut svc = VncService::new();
        assert!(svc.drain_events("none", 10).await.is_err());
    }

    #[tokio::test]
    async fn collect_frame_events_missing() {
        let mut svc = VncService::new();
        assert!(svc.collect_frame_events("none", 10).await.is_err());
    }
}
