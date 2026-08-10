//! VNC service — multi-session manager.
//!
//! `VncService` maintains a collection of VNC sessions keyed by id and
//! provides a high-level async API for the Tauri command layer.

use std::collections::{HashMap, HashSet};
use std::sync::{atomic::AtomicUsize, Arc, Mutex as StdMutex};
use tokio::sync::{RwLock, Semaphore};
use tokio::task::JoinSet;
use tokio::time::{timeout, Duration};
use zeroize::Zeroizing;

use crate::vnc::session::{
    frame_to_event, SessionCommand, SessionEvent, SharedSessionState, VncSessionHandle,
};
use crate::vnc::types::*;

const CONNECT_ADMISSION_TIMEOUT: Duration = Duration::from_secs(15);
const VNC_MAX_SESSIONS_ENV: &str = "SORTOFREMOTENG_VNC_MAX_SESSIONS";
const VNC_MAX_CONNECTING_ENV: &str = "SORTOFREMOTENG_VNC_MAX_CONNECTING";
const VNC_RESOURCE_BUDGET_MIB_ENV: &str = "SORTOFREMOTENG_VNC_RESOURCE_BUDGET_MIB";

/// Thread-safe VNC service state used directly as Tauri managed state. Session
/// lookup has its own short-lived lock; no command holds a process-wide mutex
/// across socket, handshake, state, or delivery awaits.
pub type VncServiceState = Arc<VncService>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VncServiceLimits {
    pub max_sessions: usize,
    pub max_connecting: usize,
    pub resource_budget_bytes: usize,
}

impl VncServiceLimits {
    fn normalized(self) -> Self {
        let resource_budget_bytes = self.resource_budget_bytes.clamp(
            VNC_SESSION_RESOURCE_RESERVATION_BYTES,
            MAX_VNC_RESOURCE_BUDGET_BYTES,
        );
        let budget_sessions = resource_budget_bytes / VNC_SESSION_RESOURCE_RESERVATION_BYTES;
        let max_sessions = self
            .max_sessions
            .clamp(1, MAX_VNC_SESSIONS)
            .min(budget_sessions);
        let max_connecting = self
            .max_connecting
            .clamp(1, MAX_VNC_CONNECTING)
            .min(max_sessions);
        Self {
            max_sessions,
            max_connecting,
            resource_budget_bytes,
        }
    }

    fn from_values(
        max_sessions: Option<&str>,
        max_connecting: Option<&str>,
        resource_budget_mib: Option<&str>,
    ) -> Self {
        let max_sessions = max_sessions
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_MAX_VNC_SESSIONS);
        let max_connecting = max_connecting
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_MAX_VNC_CONNECTING);
        let resource_budget_bytes = resource_budget_mib
            .and_then(|value| value.parse::<usize>().ok())
            .map(|mib| {
                mib.clamp(
                    VNC_SESSION_RESOURCE_RESERVATION_BYTES / (1024 * 1024),
                    MAX_VNC_RESOURCE_BUDGET_BYTES / (1024 * 1024),
                ) * (1024 * 1024)
            })
            .unwrap_or(DEFAULT_VNC_RESOURCE_BUDGET_BYTES);
        Self {
            max_sessions,
            max_connecting,
            resource_budget_bytes,
        }
        .normalized()
    }

    pub fn from_env() -> Self {
        let max_sessions = std::env::var(VNC_MAX_SESSIONS_ENV).ok();
        let max_connecting = std::env::var(VNC_MAX_CONNECTING_ENV).ok();
        let resource_budget_mib = std::env::var(VNC_RESOURCE_BUDGET_MIB_ENV).ok();
        Self::from_values(
            max_sessions.as_deref(),
            max_connecting.as_deref(),
            resource_budget_mib.as_deref(),
        )
    }
}

impl Default for VncServiceLimits {
    fn default() -> Self {
        Self {
            max_sessions: DEFAULT_MAX_VNC_SESSIONS,
            max_connecting: DEFAULT_MAX_VNC_CONNECTING,
            resource_budget_bytes: DEFAULT_VNC_RESOURCE_BUDGET_BYTES,
        }
    }
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct Endpoint {
    host: String,
    port: u16,
}

impl Endpoint {
    fn from_config(config: &VncConfig) -> Self {
        Self {
            host: config.host.clone(),
            port: config.port,
        }
    }
}

#[derive(Debug, Default)]
struct AdmissionState {
    endpoints: HashSet<Endpoint>,
    reserved_bytes: usize,
}

#[derive(Debug)]
struct ResourceAdmission {
    limits: VncServiceLimits,
    state: StdMutex<AdmissionState>,
}

impl ResourceAdmission {
    fn new(limits: VncServiceLimits) -> Arc<Self> {
        Arc::new(Self {
            limits: limits.normalized(),
            state: StdMutex::new(AdmissionState::default()),
        })
    }

    fn reserve(self: &Arc<Self>, endpoint: Endpoint) -> Result<SessionLease, VncError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| VncError::new(VncErrorKind::Internal, "VNC admission lock is poisoned"))?;
        if state.endpoints.contains(&endpoint) {
            return Err(VncError::new(
                VncErrorKind::AlreadyConnected,
                format!(
                    "Already connected or connecting to {}:{}",
                    endpoint.host, endpoint.port
                ),
            ));
        }
        let next_reserved_bytes = state
            .reserved_bytes
            .checked_add(VNC_SESSION_RESOURCE_RESERVATION_BYTES)
            .ok_or_else(|| {
                VncError::new(VncErrorKind::Internal, "VNC resource accounting overflow")
            })?;
        if state.endpoints.len() >= self.limits.max_sessions
            || next_reserved_bytes > self.limits.resource_budget_bytes
        {
            return Err(VncError::new(
                VncErrorKind::Internal,
                format!(
                    "VNC session resource limit reached ({} sessions, {} MiB payload budget)",
                    self.limits.max_sessions,
                    self.limits.resource_budget_bytes / (1024 * 1024)
                ),
            ));
        }
        state.endpoints.insert(endpoint.clone());
        state.reserved_bytes = next_reserved_bytes;
        Ok(SessionLease {
            admission: Arc::clone(self),
            endpoint: Some(endpoint),
        })
    }

    #[cfg(test)]
    fn snapshot(&self) -> (usize, usize) {
        let state = self.state.lock().unwrap();
        (state.endpoints.len(), state.reserved_bytes)
    }
}

#[derive(Debug)]
struct SessionLease {
    admission: Arc<ResourceAdmission>,
    endpoint: Option<Endpoint>,
}

impl Drop for SessionLease {
    fn drop(&mut self) {
        let Some(endpoint) = self.endpoint.take() else {
            return;
        };
        let Ok(mut state) = self.admission.state.lock() else {
            return;
        };
        if state.endpoints.remove(&endpoint) {
            state.reserved_bytes = state
                .reserved_bytes
                .saturating_sub(VNC_SESSION_RESOURCE_RESERVATION_BYTES);
        }
    }
}

struct SessionEntry {
    handle: VncSessionHandle,
    _lease: SessionLease,
}

/// Multi-session VNC service.
pub struct VncService {
    sessions: RwLock<HashMap<String, Arc<SessionEntry>>>,
    admission: Arc<ResourceAdmission>,
    connect_slots: Semaphore,
    active_tasks: Arc<AtomicUsize>,
    limits: VncServiceLimits,
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
        Self::with_limits(VncServiceLimits::from_env())
    }

    pub fn with_limits(limits: VncServiceLimits) -> Self {
        let limits = limits.normalized();
        Self {
            sessions: RwLock::new(HashMap::new()),
            admission: ResourceAdmission::new(limits),
            connect_slots: Semaphore::new(limits.max_connecting),
            active_tasks: Arc::new(AtomicUsize::new(0)),
            limits,
        }
    }

    /// Create a shared service for Tauri state management.
    pub fn new_state() -> VncServiceState {
        Arc::new(Self::new())
    }

    /// Connect a new VNC session.
    ///
    /// Returns the session id on success.
    pub async fn connect(&self, mut config: VncConfig) -> Result<String, VncError> {
        let password = config.password.take().map(Zeroizing::new);
        if password
            .as_ref()
            .is_some_and(|value| value.len() > MAX_VNC_PASSWORD_BYTES)
        {
            return Err(VncError::protocol("VNC password exceeds the safety limit"));
        }
        config.validate()?;
        self.prune_disconnected().await;
        let lease = match self.admission.reserve(Endpoint::from_config(&config)) {
            Ok(lease) => lease,
            Err(error) => return Err(error),
        };
        let connect_slot =
            match timeout(CONNECT_ADMISSION_TIMEOUT, self.connect_slots.acquire()).await {
                Ok(Ok(slot)) => slot,
                Ok(Err(_)) => {
                    return Err(VncError::new(
                        VncErrorKind::Internal,
                        "VNC connection admission is closed",
                    ));
                }
                Err(_) => {
                    return Err(VncError::timeout(
                        "Timed out waiting for bounded VNC connection admission",
                    ));
                }
            };
        let id = uuid::Uuid::new_v4().to_string();
        config.password = password.map(|value| value.to_string());
        let handle =
            VncSessionHandle::connect(id.clone(), config, Arc::clone(&self.active_tasks)).await?;
        drop(connect_slot);
        let mut sessions = self.sessions.write().await;
        if sessions.contains_key(&id) {
            return Err(VncError::new(
                VncErrorKind::Internal,
                "VNC session identifier collision",
            ));
        }
        sessions.insert(
            id.clone(),
            Arc::new(SessionEntry {
                handle,
                _lease: lease,
            }),
        );
        Ok(id)
    }

    async fn session_entry(&self, session_id: &str) -> Result<Arc<SessionEntry>, VncError> {
        self.sessions
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| VncError::session_not_found(session_id))
    }

    /// Disconnect a specific session.
    pub async fn disconnect(&self, session_id: &str) -> Result<(), VncError> {
        let session = self.session_entry(session_id).await?;

        session.handle.disconnect().await?;

        // Mark as disconnected in shared state.
        {
            let mut st = session.handle.state.lock().await;
            st.connected = false;
        }

        Ok(())
    }

    /// Remove a disconnected session from the map.
    pub async fn remove_session(&self, session_id: &str) -> bool {
        self.sessions.write().await.remove(session_id).is_some()
    }

    /// Disconnect and remove a session.
    pub async fn disconnect_and_remove(&self, session_id: &str) -> Result<(), VncError> {
        let entry = self
            .sessions
            .write()
            .await
            .remove(session_id)
            .ok_or_else(|| VncError::session_not_found(session_id))?;
        entry.handle.disconnect().await
    }

    /// Disconnect all sessions.
    pub async fn disconnect_all(&self) -> Vec<String> {
        let entries: Vec<(String, Arc<SessionEntry>)> = {
            let mut sessions = self.sessions.write().await;
            sessions.drain().collect()
        };
        let mut tasks = JoinSet::new();
        for (id, entry) in entries {
            tasks.spawn(async move {
                let result = entry.handle.disconnect().await;
                (id, result)
            });
        }
        let mut disconnected = Vec::new();
        while let Some(result) = tasks.join_next().await {
            if let Ok((id, Ok(()))) = result {
                disconnected.push(id);
            }
        }
        disconnected.sort_unstable();
        disconnected
    }

    /// Send a key event to a session.
    pub async fn send_key_event(
        &self,
        session_id: &str,
        down: bool,
        key: u32,
    ) -> Result<(), VncError> {
        let session = self.session_entry(session_id).await?;
        let st = session.handle.state.lock().await;
        if !st.connected {
            return Err(VncError::new(
                VncErrorKind::NotConnected,
                "VNC session is not connected",
            ));
        }
        drop(st);
        session
            .handle
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
        let session = self.session_entry(session_id).await?;
        let st = session.handle.state.lock().await;
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
            .handle
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
        let session = self.session_entry(session_id).await?;
        session
            .handle
            .send_command(SessionCommand::ClientCutText(text))
            .await
    }

    /// Request a framebuffer update for a session.
    pub async fn request_update(
        &self,
        session_id: &str,
        incremental: bool,
    ) -> Result<(), VncError> {
        let session = self.session_entry(session_id).await?;
        session.handle.request_update(incremental).await
    }

    /// Replace renderer activity authority for one session when the supplied
    /// generation is strictly newer than native state.
    pub async fn set_session_activity(
        &self,
        session_id: &str,
        active: bool,
        activity_generation: u64,
    ) -> Result<VncActivityResult, VncError> {
        let session = self.session_entry(session_id).await?;
        session.handle.set_activity(active, activity_generation)
    }

    /// Acknowledge exactly one epoch-and-token renderer tile.
    pub async fn acknowledge_frame(
        &self,
        session_id: &str,
        delivery_epoch: u64,
        frame_token: u64,
    ) -> Result<VncFrameAckResult, VncError> {
        let session = self.session_entry(session_id).await?;
        session
            .handle
            .acknowledge_frame(delivery_epoch, frame_token)
    }

    /// Set the pixel format for a session.
    pub async fn set_pixel_format(
        &self,
        session_id: &str,
        pixel_format: PixelFormat,
    ) -> Result<(), VncError> {
        pixel_format.validate()?;
        let session = self.session_entry(session_id).await?;
        session
            .handle
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
        let session = self.session_entry(session_id).await?;
        session
            .handle
            .send_command(SessionCommand::SetEncodings(encodings))
            .await
    }

    /// Retrieve information about a specific session.
    pub async fn get_session_info(&self, session_id: &str) -> Result<VncSession, VncError> {
        let session = self.session_entry(session_id).await?;

        let st = session.handle.state.lock().await;

        Ok(VncSession {
            id: session.handle.id.clone(),
            host: session.handle.config.host.clone(),
            port: session.handle.config.port,
            connected: st.connected,
            username: session.handle.config.username.clone(),
            label: session.handle.config.label.clone(),
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
            view_only: session.handle.config.view_only,
        })
    }

    /// Get statistics for a session.
    pub async fn get_session_stats(&self, session_id: &str) -> Result<VncStats, VncError> {
        let session = self.session_entry(session_id).await?;

        let st = session.handle.state.lock().await;

        Ok(session_stats(&session.handle, &st))
    }

    /// Atomically pair the stats snapshot with its bounded native event drain.
    /// The state -> delivery lock order matches framebuffer resize commit.
    pub async fn poll_session_stats_and_events(
        &self,
        session_id: &str,
        max: usize,
    ) -> Result<(VncStats, Vec<SessionEvent>), VncError> {
        let session = self.session_entry(session_id).await?;
        let state = Arc::clone(&session.handle.state);
        let state = state.lock().await;
        let stats = session_stats(&session.handle, &state);
        let limit = if max == 0 {
            MAX_VNC_DRAIN_EVENTS
        } else {
            max.min(MAX_VNC_DRAIN_EVENTS)
        };
        let events = session.handle.events.drain(limit)?;
        Ok((stats, events))
    }

    /// List all active session IDs.
    pub async fn list_sessions(&self) -> Vec<String> {
        self.sessions.read().await.keys().cloned().collect()
    }

    /// List full info for all sessions.
    pub async fn list_session_info(&self) -> Vec<VncSession> {
        let ids = self.list_sessions().await;
        let mut result = Vec::with_capacity(ids.len());
        for id in ids {
            if let Ok(info) = self.get_session_info(&id).await {
                result.push(info);
            }
        }
        result
    }

    /// Check if a session is connected.
    pub async fn is_connected(&self, session_id: &str) -> bool {
        if let Ok(session) = self.session_entry(session_id).await {
            let st = session.handle.state.lock().await;
            st.connected
        } else {
            false
        }
    }

    /// Get the total number of sessions.
    pub async fn session_count(&self) -> usize {
        self.sessions.read().await.len()
    }

    pub fn limits(&self) -> VncServiceLimits {
        self.limits
    }

    /// Drain events from a session.
    ///
    /// Returns up to `max` events, or all available if `max` is 0.
    pub async fn drain_events(
        &self,
        session_id: &str,
        max: usize,
    ) -> Result<Vec<SessionEvent>, VncError> {
        let session = self.session_entry(session_id).await?;

        let limit = if max == 0 {
            MAX_VNC_DRAIN_EVENTS
        } else {
            max.min(MAX_VNC_DRAIN_EVENTS)
        };
        session.handle.events.drain(limit)
    }

    /// Collect frame events and convert them to Tauri event payloads.
    pub async fn collect_frame_events(
        &self,
        session_id: &str,
        _max: usize,
    ) -> Result<Vec<VncFrameEvent>, VncError> {
        let session = self.session_entry(session_id).await?;
        if let Some(rect) = session.handle.events.drain_frame_only()? {
            return Ok(vec![frame_to_event(session_id, rect)?]);
        }
        Ok(Vec::new())
    }

    /// Prune disconnected sessions from the map.
    pub async fn prune_disconnected(&self) -> Vec<String> {
        let sessions: Vec<(String, Arc<SessionEntry>)> = self
            .sessions
            .read()
            .await
            .iter()
            .map(|(id, entry)| (id.clone(), Arc::clone(entry)))
            .collect();
        let mut to_remove = Vec::new();
        for (id, session) in sessions {
            let st = session.handle.state.lock().await;
            if st.terminated {
                to_remove.push(id);
            }
        }
        if !to_remove.is_empty() {
            let mut sessions = self.sessions.write().await;
            for id in &to_remove {
                sessions.remove(id);
            }
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
    use std::sync::atomic::Ordering;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpListener;
    use tokio::sync::Mutex;

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

    fn test_limits(max_sessions: usize, max_connecting: usize) -> VncServiceLimits {
        VncServiceLimits {
            max_sessions,
            max_connecting,
            resource_budget_bytes: max_sessions * VNC_SESSION_RESOURCE_RESERVATION_BYTES,
        }
    }

    fn waiting_config(host: &str) -> VncConfig {
        VncConfig {
            host: host.into(),
            password: Some("sensitive".into()),
            ..VncConfig::default()
        }
    }

    async fn insert_test_session(
        service: &VncService,
        session_id: &str,
        state: crate::vnc::session::SharedState,
        width: u16,
        height: u16,
    ) -> crate::vnc::delivery::VncEventSender {
        let config = VncConfig {
            host: session_id.into(),
            ..VncConfig::default()
        };
        let lease = service
            .admission
            .reserve(Endpoint::from_config(&config))
            .unwrap();
        let (mut handle, delivery) =
            VncSessionHandle::test_handle(session_id.into(), state, width, height).unwrap();
        handle.config = config;
        service.sessions.write().await.insert(
            session_id.into(),
            Arc::new(SessionEntry {
                handle,
                _lease: lease,
            }),
        );
        delivery
    }

    #[tokio::test]
    async fn atomic_poll_cannot_pair_old_stats_with_committed_resize_frame() {
        let session_id = "atomic-poll".to_string();
        let state = poll_test_state();
        let service = Arc::new(VncService::with_limits(test_limits(2, 1)));
        let delivery = insert_test_session(&service, &session_id, Arc::clone(&state), 1, 1).await;

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
                .poll_session_stats_and_events(&poll_id, 2)
                .await
        });
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
        assert!(!poll.is_finished(), "poll did not wait for session state");
        assert_eq!(
            timeout(Duration::from_millis(100), service.session_count())
                .await
                .expect("a blocked session poll held the service map lock"),
            1
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

    #[tokio::test]
    async fn new_service_is_empty_and_does_not_eagerly_allocate_reserved_payloads() {
        let service = VncService::with_limits(VncServiceLimits::default());
        assert_eq!(service.session_count().await, 0);
        assert!(service.list_sessions().await.is_empty());
        assert_eq!(service.admission.snapshot(), (0, 0));
    }

    #[test]
    fn new_state_returns_direct_arc_service() {
        let state = VncService::new_state();
        assert_eq!(
            state.limits().max_sessions,
            state.admission.limits.max_sessions
        );
    }

    #[tokio::test]
    async fn default_impl() {
        let svc = VncService::default();
        assert_eq!(svc.session_count().await, 0);
    }

    #[test]
    fn default_payload_envelope_has_test_backed_headroom() {
        let forced_coverage = MAX_VNC_FRAMEBUFFER_BYTES / (4 * u8::BITS as usize);
        let decoded_wire_and_rgba = MAX_VNC_RECT_WIRE_BYTES + MAX_VNC_RECT_RGBA_BYTES;
        let queued_clipboards = MAX_VNC_COMMAND_QUEUE * MAX_VNC_CLIPBOARD_BYTES;
        let bounded_controls_cursor_and_tile = 2 * 1024 * 1024 + 512 * 512 * 4 + 256 * 256 * 4;
        let accounted_payload = 2 * MAX_VNC_FRAMEBUFFER_BYTES
            + forced_coverage
            + decoded_wire_and_rgba
            + queued_clipboards
            + bounded_controls_cursor_and_tile;
        assert!(VNC_SESSION_RESOURCE_RESERVATION_BYTES >= accounted_payload);
        assert_eq!(
            DEFAULT_VNC_RESOURCE_BUDGET_BYTES,
            DEFAULT_MAX_VNC_SESSIONS * VNC_SESSION_RESOURCE_RESERVATION_BYTES
        );
        assert_eq!(
            MAX_VNC_RESOURCE_BUDGET_BYTES,
            VNC_SESSION_RESOURCE_RESERVATION_BYTES
                .checked_mul(MAX_VNC_SESSIONS)
                .expect("the hard VNC payload budget must fit usize")
        );
    }

    #[test]
    fn configured_limits_fail_closed_and_clamp_to_hard_bounds() {
        assert_eq!(
            VncServiceLimits::from_values(None, None, None),
            VncServiceLimits::default()
        );
        assert_eq!(
            VncServiceLimits::from_values(Some("invalid"), Some("invalid"), Some("invalid")),
            VncServiceLimits::default()
        );

        let minimum = VncServiceLimits::from_values(Some("0"), Some("0"), Some("0"));
        assert_eq!(minimum.max_sessions, 1);
        assert_eq!(minimum.max_connecting, 1);
        assert_eq!(
            minimum.resource_budget_bytes,
            VNC_SESSION_RESOURCE_RESERVATION_BYTES
        );

        let maximum = VncServiceLimits::from_values(Some("999"), Some("999"), Some("999999"));
        assert_eq!(maximum.max_sessions, MAX_VNC_SESSIONS);
        assert_eq!(maximum.max_connecting, MAX_VNC_CONNECTING);
        assert_eq!(maximum.resource_budget_bytes, MAX_VNC_RESOURCE_BUDGET_BYTES);

        let overflow = usize::MAX.to_string();
        let overflowed =
            VncServiceLimits::from_values(Some(&overflow), Some(&overflow), Some(&overflow));
        assert_eq!(overflowed.max_sessions, MAX_VNC_SESSIONS);
        assert_eq!(overflowed.max_connecting, MAX_VNC_CONNECTING);
        assert_eq!(
            overflowed.resource_budget_bytes,
            MAX_VNC_RESOURCE_BUDGET_BYTES
        );

        let budget_limited = VncServiceLimits::from_values(Some("8"), Some("4"), Some("192"));
        assert_eq!(budget_limited.max_sessions, 2);
        assert_eq!(budget_limited.max_connecting, 2);
    }

    #[test]
    fn reservation_arithmetic_cannot_overflow_or_partially_insert() {
        let admission = ResourceAdmission::new(VncServiceLimits::default());
        admission.state.lock().unwrap().reserved_bytes =
            usize::MAX - VNC_SESSION_RESOURCE_RESERVATION_BYTES + 1;
        let error = admission
            .reserve(Endpoint {
                host: "overflow".into(),
                port: 5900,
            })
            .unwrap_err();
        assert_eq!(error.kind, VncErrorKind::Internal);
        let state = admission.state.lock().unwrap();
        assert!(state.endpoints.is_empty());
        assert_eq!(
            state.reserved_bytes,
            usize::MAX - VNC_SESSION_RESOURCE_RESERVATION_BYTES + 1
        );
    }

    #[test]
    fn duplicate_endpoint_semantics_remain_exact_host_and_port() {
        let admission = ResourceAdmission::new(VncServiceLimits::default());
        let first = admission
            .reserve(Endpoint {
                host: "VncHost".into(),
                port: 5900,
            })
            .unwrap();
        let duplicate = admission
            .reserve(Endpoint {
                host: "VncHost".into(),
                port: 5900,
            })
            .unwrap_err();
        assert_eq!(duplicate.kind, VncErrorKind::AlreadyConnected);
        let case_distinct = admission
            .reserve(Endpoint {
                host: "vnchost".into(),
                port: 5900,
            })
            .unwrap();
        assert_eq!(admission.snapshot().0, 2);
        drop((first, case_distinct));
        assert_eq!(admission.snapshot(), (0, 0));
    }

    #[tokio::test(start_paused = true)]
    async fn admission_and_one_hour_idle_accounting_are_bounded_at_100_500_and_1000_attempts() {
        for attempts in [100usize, 500, 1_000] {
            let admission = ResourceAdmission::new(VncServiceLimits::default());
            let mut leases = Vec::new();
            for index in 0..attempts {
                if let Ok(lease) = admission.reserve(Endpoint {
                    host: format!("host-{index}"),
                    port: 5900,
                }) {
                    leases.push(lease);
                }
            }
            assert_eq!(leases.len(), DEFAULT_MAX_VNC_SESSIONS);
            assert_eq!(
                admission.snapshot(),
                (DEFAULT_MAX_VNC_SESSIONS, DEFAULT_VNC_RESOURCE_BUDGET_BYTES)
            );
            let before_idle = admission.snapshot();
            tokio::time::advance(Duration::from_secs(60 * 60)).await;
            tokio::task::yield_now().await;
            assert_eq!(admission.snapshot(), before_idle);
            drop(leases);
            assert_eq!(admission.snapshot(), (0, 0));
        }
    }

    #[tokio::test]
    async fn cancelled_connect_wait_releases_endpoint_and_payload_reservation() {
        let service = Arc::new(VncService::with_limits(test_limits(2, 1)));
        let held_slot = service.connect_slots.acquire().await.unwrap();
        let connect_service = Arc::clone(&service);
        let connect = tokio::spawn(async move {
            connect_service
                .connect(waiting_config("cancelled.example"))
                .await
        });
        for _ in 0..100 {
            if service.admission.snapshot().0 == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(service.admission.snapshot().0, 1);
        connect.abort();
        let _ = connect.await;
        drop(held_slot);
        assert_eq!(service.admission.snapshot(), (0, 0));
    }

    #[tokio::test]
    async fn cancelling_spawned_handshakes_aborts_tasks_sockets_and_all_admission() {
        let service = Arc::new(VncService::with_limits(test_limits(2, 1)));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        for attempt in 0..32 {
            let mut config = waiting_config("127.0.0.1");
            config.port = address.port();
            let connect_service = Arc::clone(&service);
            let connect = tokio::spawn(async move { connect_service.connect(config).await });
            let (mut peer, _) = listener.accept().await.unwrap();

            for _ in 0..100 {
                if service.active_tasks.load(Ordering::Acquire) == 1 {
                    break;
                }
                tokio::task::yield_now().await;
            }
            assert_eq!(
                service.active_tasks.load(Ordering::Acquire),
                1,
                "attempt {attempt} did not enter the spawned handshake"
            );
            assert_eq!(service.admission.snapshot().0, 1);
            assert_eq!(service.connect_slots.available_permits(), 0);
            assert_eq!(service.session_count().await, 0);

            connect.abort();
            let _ = connect.await;
            assert_eq!(service.active_tasks.load(Ordering::Acquire), 0);
            assert_eq!(service.admission.snapshot(), (0, 0));
            assert_eq!(service.connect_slots.available_permits(), 1);
            assert_eq!(service.session_count().await, 0);

            let mut byte = [0u8; 1];
            let bytes = timeout(Duration::from_secs(1), peer.read(&mut byte))
                .await
                .expect("aborted handshake socket stayed open")
                .unwrap();
            assert_eq!(bytes, 0, "aborted handshake peer did not observe EOF");
        }
    }

    #[tokio::test]
    async fn retained_session_entry_keeps_lease_until_the_last_inflight_reference_drops() {
        let service = VncService::with_limits(test_limits(2, 1));
        let session_id = "retained-entry";
        let delivery = insert_test_session(&service, session_id, poll_test_state(), 1, 1).await;
        drop(delivery);
        let retained = service.session_entry(session_id).await.unwrap();

        assert!(service.remove_session(session_id).await);
        assert_eq!(service.session_count().await, 0);
        assert_eq!(
            service.admission.snapshot(),
            (1, VNC_SESSION_RESOURCE_RESERVATION_BYTES)
        );
        let duplicate = service
            .admission
            .reserve(Endpoint {
                host: session_id.into(),
                port: 5900,
            })
            .unwrap_err();
        assert_eq!(duplicate.kind, VncErrorKind::AlreadyConnected);

        drop(retained);
        assert_eq!(service.admission.snapshot(), (0, 0));
        let replacement = service
            .admission
            .reserve(Endpoint {
                host: session_id.into(),
                port: 5900,
            })
            .unwrap();
        assert_eq!(
            service.admission.snapshot(),
            (1, VNC_SESSION_RESOURCE_RESERVATION_BYTES)
        );
        drop(replacement);
        assert_eq!(service.admission.snapshot(), (0, 0));
    }

    #[tokio::test(start_paused = true)]
    async fn connect_admission_timeout_leaves_no_tombstone() {
        let service = Arc::new(VncService::with_limits(test_limits(2, 1)));
        let held_slot = service.connect_slots.acquire().await.unwrap();
        let connect_service = Arc::clone(&service);
        let connect = tokio::spawn(async move {
            connect_service
                .connect(waiting_config("timeout.example"))
                .await
        });
        for _ in 0..100 {
            if service.admission.snapshot().0 == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        tokio::time::advance(CONNECT_ADMISSION_TIMEOUT + Duration::from_secs(1)).await;
        let error = connect.await.unwrap().unwrap_err();
        assert_eq!(error.kind, VncErrorKind::Timeout);
        drop(held_slot);
        assert_eq!(service.admission.snapshot(), (0, 0));
    }

    #[tokio::test]
    async fn invalid_connect_never_consumes_admission_resources() {
        let service = VncService::with_limits(VncServiceLimits::default());
        let error = service
            .connect(waiting_config("bad host"))
            .await
            .unwrap_err();
        assert_eq!(error.kind, VncErrorKind::DnsResolution);
        assert_eq!(service.admission.snapshot(), (0, 0));
    }

    #[tokio::test]
    async fn is_connected_missing_session() {
        let svc = VncService::new();
        assert!(!svc.is_connected("nonexistent").await);
    }

    #[tokio::test]
    async fn disconnect_missing_session() {
        let svc = VncService::new();
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

    #[tokio::test]
    async fn remove_session_missing() {
        let svc = VncService::new();
        assert!(!svc.remove_session("nonexistent").await);
    }

    #[tokio::test]
    async fn disconnect_and_remove_missing() {
        let svc = VncService::new();
        assert!(svc.disconnect_and_remove("none").await.is_err());
    }

    #[tokio::test]
    async fn disconnect_all_empty() {
        let svc = VncService::new();
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
        let svc = VncService::new();
        let pruned = svc.prune_disconnected().await;
        assert!(pruned.is_empty());
    }

    #[tokio::test]
    async fn drain_events_missing() {
        let svc = VncService::new();
        assert!(svc.drain_events("none", 10).await.is_err());
    }

    #[tokio::test]
    async fn collect_frame_events_missing() {
        let svc = VncService::new();
        assert!(svc.collect_frame_events("none", 10).await.is_err());
    }
}
