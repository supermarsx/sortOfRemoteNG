//! VNC service — multi-session manager.
//!
//! `VncService` maintains a collection of VNC sessions keyed by id and
//! provides a high-level async API for the Tauri command layer.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use zeroize::Zeroize;

use crate::vnc::session::{
    frame_to_event, SessionCommand, SessionEvent, SharedSessionState, VncSessionHandle,
};
use crate::vnc::types::*;

/// Thread-safe wrapper for the VNC service state (used as Tauri managed state).
pub type VncServiceState = Arc<Mutex<VncService>>;

/// Multi-session VNC service.
pub struct VncService {
    sessions: HashMap<String, VncSessionHandle>,
}

fn session_stats(session: &VncSessionHandle, state: &SharedSessionState) -> VncStats {
    VncStats {
        session_id: session.id.clone(),
        bytes_sent: state.bytes_sent,
        bytes_received: state.bytes_received,
        frame_count: state.frame_count,
        connected_at: state.last_activity.clone(),
        last_activity: state.last_activity.clone(),
        uptime_secs: 0,
        framebuffer_width: state.framebuffer_width,
        framebuffer_height: state.framebuffer_height,
        pixel_format: format!("{}", state.pixel_format),
        encoding: String::new(),
    }
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
    pub async fn connect(&mut self, mut config: VncConfig) -> Result<String, VncError> {
        if self.sessions.len() >= MAX_VNC_SESSIONS {
            if let Some(password) = config.password.as_mut() {
                password.zeroize();
            }
            return Err(VncError::new(
                VncErrorKind::Internal,
                "VNC session limit reached",
            ));
        }
        let id = uuid::Uuid::new_v4().to_string();

        // Check for duplicate connections to the same host:port.
        for session in self.sessions.values() {
            if session.config.host == config.host && session.config.port == config.port {
                let st = session.state.lock().await;
                if !st.terminated {
                    let message = format!("Already connected to {}:{}", config.host, config.port);
                    if let Some(password) = config.password.as_mut() {
                        password.zeroize();
                    }
                    return Err(VncError::new(VncErrorKind::AlreadyConnected, message));
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
        self.disconnect(session_id).await?;
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
        let st = session.state.lock().await;
        if !st.connected {
            return Err(VncError::new(
                VncErrorKind::NotConnected,
                "VNC session is not connected",
            ));
        }
        drop(st);
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
        let st = session.state.lock().await;
        if !st.connected {
            return Err(VncError::new(
                VncErrorKind::NotConnected,
                "VNC session is not connected",
            ));
        }
        if x >= st.framebuffer_width || y >= st.framebuffer_height {
            return Err(VncError::protocol(
                "VNC pointer coordinates lie outside the framebuffer",
            ));
        }
        drop(st);
        session
            .send_command(SessionCommand::PointerEvent { button_mask, x, y })
            .await
    }

    /// Send clipboard text to a session.
    pub async fn send_clipboard(&self, session_id: &str, text: String) -> Result<(), VncError> {
        if text.len() > MAX_VNC_CLIPBOARD_BYTES {
            return Err(VncError::protocol(
                "VNC clipboard text exceeds the safety limit",
            ));
        }
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
        session.request_update(incremental).await
    }

    /// Replace renderer activity authority for one session when the supplied
    /// generation is strictly newer than native state.
    pub fn set_session_activity(
        &self,
        session_id: &str,
        active: bool,
        activity_generation: u64,
    ) -> Result<VncActivityResult, VncError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;
        session.set_activity(active, activity_generation)
    }

    /// Acknowledge exactly one epoch-and-token renderer tile.
    pub fn acknowledge_frame(
        &self,
        session_id: &str,
        delivery_epoch: u64,
        frame_token: u64,
    ) -> Result<VncFrameAckResult, VncError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;
        session.acknowledge_frame(delivery_epoch, frame_token)
    }

    /// Set the pixel format for a session.
    pub async fn set_pixel_format(
        &self,
        session_id: &str,
        pixel_format: PixelFormat,
    ) -> Result<(), VncError> {
        pixel_format.validate()?;
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
        if encodings.is_empty()
            || encodings.len() > MAX_VNC_ENCODINGS
            || encodings.iter().any(|encoding| {
                !matches!(
                    encoding,
                    EncodingType::Raw
                        | EncodingType::CopyRect
                        | EncodingType::RRE
                        | EncodingType::Hextile
                        | EncodingType::CursorPseudo
                        | EncodingType::DesktopSizePseudo
                        | EncodingType::LastRectPseudo
                )
            })
        {
            return Err(VncError::protocol(
                "Unsupported or oversized VNC encoding list",
            ));
        }
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

        Ok(session_stats(session, &st))
    }

    /// Atomically pair the stats snapshot with its bounded native event drain.
    /// The state -> delivery lock order matches framebuffer resize commit.
    pub async fn poll_session_stats_and_events(
        &mut self,
        session_id: &str,
        max: usize,
    ) -> Result<(VncStats, Vec<SessionEvent>), VncError> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;
        let state = Arc::clone(&session.state);
        let state = state.lock().await;
        let stats = session_stats(session, &state);
        let limit = if max == 0 {
            MAX_VNC_DRAIN_EVENTS
        } else {
            max.min(MAX_VNC_DRAIN_EVENTS)
        };
        let events = session.events.drain(limit)?;
        Ok((stats, events))
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

        let limit = if max == 0 {
            MAX_VNC_DRAIN_EVENTS
        } else {
            max.min(MAX_VNC_DRAIN_EVENTS)
        };
        session.events.drain(limit)
    }

    /// Collect frame events and convert them to Tauri event payloads.
    pub async fn collect_frame_events(
        &mut self,
        session_id: &str,
        _max: usize,
    ) -> Result<Vec<VncFrameEvent>, VncError> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;
        if let Some(rect) = session.events.drain_frame_only()? {
            return Ok(vec![frame_to_event(session_id, rect)?]);
        }
        Ok(Vec::new())
    }

    /// Prune disconnected sessions from the map.
    pub async fn prune_disconnected(&mut self) -> Vec<String> {
        let mut to_remove = Vec::new();
        for (id, session) in &self.sessions {
            let st = session.state.lock().await;
            if st.terminated {
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

    fn poll_test_state() -> crate::vnc::session::SharedState {
        Arc::new(Mutex::new(SharedSessionState {
            connected: true,
            terminated: false,
            framebuffer_width: 1,
            framebuffer_height: 1,
            pixel_format: PixelFormat::rgba32(),
            server_name: "test".into(),
            protocol_version: "3.8".into(),
            security_type: "None".into(),
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            last_activity: String::new(),
        }))
    }

    #[tokio::test]
    async fn atomic_poll_cannot_pair_old_stats_with_committed_resize_frame() {
        let session_id = "atomic-poll".to_string();
        let state = poll_test_state();
        let (handle, delivery) =
            VncSessionHandle::test_handle(session_id.clone(), Arc::clone(&state), 1, 1).unwrap();
        let mut service = VncService::new();
        service.sessions.insert(session_id.clone(), handle);
        let service = Arc::new(Mutex::new(service));

        delivery.begin_framebuffer_update().unwrap();
        delivery.resize_framebuffer(2, 1).unwrap();
        delivery
            .apply_frame(crate::vnc::encoding::DecodedRect {
                x: 1,
                y: 0,
                width: 1,
                height: 1,
                source_x: None,
                source_y: None,
                pixels: vec![9, 8, 7, 255],
            })
            .unwrap();

        let held_state = state.lock().await;
        let poll_service = Arc::clone(&service);
        let poll_id = session_id.clone();
        let poll = tokio::spawn(async move {
            poll_service
                .lock()
                .await
                .poll_session_stats_and_events(&poll_id, 2)
                .await
        });
        for _ in 0..100 {
            if service.try_lock().is_err() {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(
            service.try_lock().is_err(),
            "poll did not acquire the service lock"
        );

        let commit_state = Arc::clone(&state);
        let commit_delivery = delivery.clone();
        let commit = tokio::spawn(async move {
            let mut state = commit_state.lock().await;
            state.framebuffer_width = 2;
            state.framebuffer_height = 1;
            commit_delivery.finish_framebuffer_update().unwrap();
            drop(state);
            commit_delivery
                .publish_control(SessionEvent::Resize {
                    width: 2,
                    height: 1,
                })
                .unwrap();
        });
        tokio::task::yield_now().await;
        drop(held_state);

        let (old_stats, old_events) = poll.await.unwrap().unwrap();
        assert_eq!(
            (old_stats.framebuffer_width, old_stats.framebuffer_height),
            (1, 1)
        );
        assert!(old_events.is_empty());
        commit.await.unwrap();

        let (new_stats, new_events) = service
            .lock()
            .await
            .poll_session_stats_and_events(&session_id, 2)
            .await
            .unwrap();
        assert_eq!(
            (new_stats.framebuffer_width, new_stats.framebuffer_height),
            (2, 1)
        );
        assert!(new_events.iter().any(|event| matches!(
            event,
            SessionEvent::Resize {
                width: 2,
                height: 1
            }
        )));
        assert!(new_events
            .iter()
            .any(|event| matches!(event, SessionEvent::Frame(_))));
    }

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
        assert!(svc
            .set_pixel_format("none", PixelFormat::rgba32())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn set_encodings_missing() {
        let svc = VncService::new();
        assert!(svc
            .set_encodings("none", vec![EncodingType::Raw])
            .await
            .is_err());
    }

    #[test]
    fn remove_session_missing() {
        let mut svc = VncService::new();
        assert!(!svc.remove_session("nonexistent"));
    }

    #[tokio::test]
    async fn disconnect_and_remove_missing() {
        let mut svc = VncService::new();
        assert!(svc.disconnect_and_remove("none").await.is_err());
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
