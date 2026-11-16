//! Telnet service — manages multiple concurrent telnet sessions.

use std::collections::HashMap;
use std::sync::Arc;

use sorng_core::events::DynEventEmitter;
use sorng_core::session_resilience::{LiveSessionDescriptor, OutputSnapshot};
use tokio::sync::{Mutex, RwLock};

use crate::telnet::session::{
    self, hex_decode, SessionCommand, SessionEvent, TelnetSessionHandle, MAX_COMMAND_BYTES,
};
use crate::telnet::types::*;

/// Shared telnet service state stored via `app.manage()`.
pub type TelnetServiceState = Arc<TelnetService>;

const MAX_SESSIONS: usize = 32;
const MAX_SESSION_ID_BYTES: usize = 64;
const MAX_RAW_BYTES: usize = MAX_COMMAND_BYTES;

/// Manages all active telnet sessions.
pub struct TelnetService {
    sessions: RwLock<HashMap<String, Arc<TelnetSessionHandle>>>,
    event_emitter: Option<DynEventEmitter>,
    connect_gate: Mutex<()>,
}

impl TelnetService {
    /// Create a new, empty service.
    pub fn new() -> TelnetServiceState {
        Arc::new(Self {
            sessions: RwLock::new(HashMap::new()),
            event_emitter: None,
            connect_gate: Mutex::new(()),
        })
    }

    /// Create a new service with an event emitter.
    pub fn new_with_emitter(emitter: DynEventEmitter) -> TelnetServiceState {
        Arc::new(Self {
            sessions: RwLock::new(HashMap::new()),
            event_emitter: Some(emitter),
            connect_gate: Mutex::new(()),
        })
    }

    // ── Connect ─────────────────────────────────────────────────────

    /// Open a new telnet session.
    ///
    /// Returns the session ID on success.
    pub async fn connect(&self, config: TelnetConfig) -> Result<String, String> {
        config.validate().map_err(|e| e.to_string())?;
        let _connect_guard = self.connect_gate.lock().await;
        {
            let mut sessions = self.sessions.write().await;
            sessions
                .retain(|_, handle| handle.connected.load(std::sync::atomic::Ordering::Relaxed));
            if sessions.len() >= MAX_SESSIONS {
                return Err(format!(
                    "Telnet session limit of {} has been reached",
                    MAX_SESSIONS
                ));
            }
        }

        let id = uuid::Uuid::new_v4().to_string();

        let handle = session::connect(id.clone(), config)
            .await
            .map_err(|e| e.to_string())?;

        let handle = Arc::new(handle);

        let emitter = self.event_emitter.clone();
        let handle_clone = handle.clone();
        let session_id = id.clone();

        self.sessions.write().await.insert(id.clone(), handle);

        // Spawn an event-forwarding loop that reads from the session's
        // event channel and emits events via the emitter.
        tokio::spawn(async move {
            Self::event_forwarder(emitter, handle_clone, session_id).await;
        });

        log::info!("[telnet-service] session {} created", id);
        Ok(id)
    }

    // ── Disconnect ──────────────────────────────────────────────────

    /// Disconnect a session by ID.
    pub async fn disconnect(&self, session_id: &str) -> Result<(), String> {
        Self::validate_session_id(session_id)?;
        let handle = self
            .sessions
            .write()
            .await
            .remove(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        handle
            .connected
            .store(false, std::sync::atomic::Ordering::Relaxed);
        handle.shutdown.notify_waiters();
        let _ = handle.cmd_tx.try_send(SessionCommand::Disconnect);
        // Real close: zeroize the replay ring and ignore late output.
        handle.output_ring.close();
        log::info!("[telnet-service] session {} disconnected", session_id);
        Ok(())
    }

    /// Disconnect all sessions.
    pub async fn disconnect_all(&self) -> Result<(), String> {
        let ids: Vec<String> = self.sessions.read().await.keys().cloned().collect();
        for id in ids {
            if let Err(e) = self.disconnect(&id).await {
                log::warn!("[telnet-service] error disconnecting {}: {}", id, e);
            }
        }
        Ok(())
    }

    // ── Send ────────────────────────────────────────────────────────

    /// Send a command/text line to a session.
    pub async fn send_command(&self, session_id: &str, command: &str) -> Result<(), String> {
        if command.len() > MAX_COMMAND_BYTES {
            return Err("Telnet command exceeds the allowed size".to_string());
        }
        let handle = self.get_live_handle(session_id).await?;
        Self::queue(&handle, SessionCommand::SendLine(command.to_string()))
    }

    /// Send raw bytes to a session (hex-encoded string).
    pub async fn send_raw(&self, session_id: &str, hex_data: &str) -> Result<(), String> {
        if hex_data.len() > MAX_RAW_BYTES.saturating_mul(2) {
            return Err("Telnet raw payload exceeds the allowed size".to_string());
        }
        let data = hex_decode(hex_data).ok_or_else(|| "Invalid hex string".to_string())?;
        let handle = self.get_live_handle(session_id).await?;
        Self::queue(&handle, SessionCommand::SendRaw(data))
    }

    /// Send a break signal to a session.
    pub async fn send_break(&self, session_id: &str) -> Result<(), String> {
        let handle = self.get_live_handle(session_id).await?;
        Self::queue(&handle, SessionCommand::Break)
    }

    /// Send Are-You-There to a session.
    pub async fn send_ayt(&self, session_id: &str) -> Result<(), String> {
        let handle = self.get_live_handle(session_id).await?;
        Self::queue(&handle, SessionCommand::AreYouThere)
    }

    /// Resize the terminal for a session (sends NAWS sub-negotiation).
    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if !(1..=1_000).contains(&cols) || !(1..=1_000).contains(&rows) {
            return Err("Telnet terminal dimensions must be between 1 and 1000".to_string());
        }
        let handle = self.get_live_handle(session_id).await?;
        Self::queue(&handle, SessionCommand::Resize { cols, rows })
    }

    // ── Query ────────────────────────────────────────────────────────

    /// Get session info.
    pub async fn get_session_info(&self, session_id: &str) -> Result<TelnetSession, String> {
        Self::validate_session_id(session_id)?;
        let sessions = self.sessions.read().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        Ok(handle.to_session_info())
    }

    /// List all sessions.
    pub async fn list_sessions(&self) -> Vec<TelnetSession> {
        let sessions = self.sessions.read().await;
        sessions
            .values()
            .filter(|handle| handle.connected.load(std::sync::atomic::Ordering::Relaxed))
            .map(|handle| handle.to_session_info())
            .collect()
    }

    /// One bounded page of the session's replay ring, same shape as the SSH
    /// `get_terminal_buffer_snapshot` response (`encoding: "utf8"`).
    pub async fn get_output_snapshot(
        &self,
        session_id: &str,
        generation: Option<u64>,
        after_sequence: Option<u64>,
        max_bytes: Option<usize>,
    ) -> Result<OutputSnapshot, String> {
        Self::validate_session_id(session_id)?;
        let handle = self
            .sessions
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        Ok(handle
            .output_ring
            .snapshot(session_id, generation, after_sequence, max_bytes))
    }

    /// Registry rows for every session still held by the service, including
    /// ones that dropped but were not yet pruned (state `disconnected`).
    pub async fn live_descriptors(&self) -> Vec<LiveSessionDescriptor> {
        self.sessions
            .read()
            .await
            .values()
            .map(|handle| handle.to_live_descriptor())
            .collect()
    }

    /// Check whether a session is still connected.
    pub async fn is_connected(&self, session_id: &str) -> Result<bool, String> {
        Self::validate_session_id(session_id)?;
        let sessions = self.sessions.read().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        Ok(handle.connected.load(std::sync::atomic::Ordering::Relaxed))
    }

    fn validate_session_id(session_id: &str) -> Result<(), String> {
        if session_id.is_empty()
            || session_id.len() > MAX_SESSION_ID_BYTES
            || !session_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("Invalid Telnet session identifier".to_string());
        }
        Ok(())
    }

    async fn get_live_handle(&self, session_id: &str) -> Result<Arc<TelnetSessionHandle>, String> {
        Self::validate_session_id(session_id)?;
        let handle = self
            .sessions
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        if !handle.connected.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("Telnet session is not connected".to_string());
        }
        Ok(handle)
    }

    fn queue(handle: &TelnetSessionHandle, command: SessionCommand) -> Result<(), String> {
        handle
            .cmd_tx
            .try_send(command)
            .map_err(|error| match error {
                tokio::sync::mpsc::error::TrySendError::Full(_) => {
                    "Telnet session command queue is full".to_string()
                }
                tokio::sync::mpsc::error::TrySendError::Closed(_) => {
                    "Telnet session command queue is closed".to_string()
                }
            })
    }

    // ── Event forwarder ─────────────────────────────────────────────

    /// Reads events from a session handle and emits them via the event emitter.
    async fn event_forwarder(
        emitter: Option<DynEventEmitter>,
        handle: Arc<TelnetSessionHandle>,
        session_id: String,
    ) {
        let client_correlation_id = handle.config.client_correlation_id.clone();
        loop {
            let event = {
                let mut rx = handle.event_rx.lock().await;
                rx.recv().await
            };

            match event {
                Some(SessionEvent::Data(data)) => {
                    if !data.is_empty() {
                        // Cheap append into the tail chunk; the ring has its
                        // own lock and never touches the write path.
                        let meta = handle.output_ring.push(data.as_bytes());
                        if let Some(ref emitter) = emitter {
                            let _ = emitter.emit_event(
                                "telnet-output",
                                serde_json::to_value(&TelnetOutputEvent {
                                    session_id: session_id.clone(),
                                    client_correlation_id: client_correlation_id.clone(),
                                    data,
                                    generation: Some(meta.generation),
                                    sequence_start: Some(meta.sequence_start),
                                    sequence_end: Some(meta.sequence_end),
                                })
                                .unwrap_or_default(),
                            );
                        }
                    }
                }
                Some(SessionEvent::Error(msg)) => {
                    if let Some(ref emitter) = emitter {
                        let _ = emitter.emit_event(
                            "telnet-error",
                            serde_json::to_value(&TelnetErrorEvent {
                                session_id: session_id.clone(),
                                client_correlation_id: client_correlation_id.clone(),
                                message: msg,
                            })
                            .unwrap_or_default(),
                        );
                    }
                }
                Some(SessionEvent::Closed(reason)) => {
                    handle
                        .connected
                        .store(false, std::sync::atomic::Ordering::Relaxed);
                    handle.shutdown.notify_waiters();
                    if let Some(ref emitter) = emitter {
                        let _ = emitter.emit_event(
                            "telnet-closed",
                            serde_json::to_value(&TelnetClosedEvent {
                                session_id: session_id.clone(),
                                client_correlation_id: client_correlation_id.clone(),
                                reason,
                            })
                            .unwrap_or_default(),
                        );
                    }
                    break;
                }
                Some(SessionEvent::Negotiation {
                    direction,
                    command,
                    option,
                }) => {
                    if let Some(ref emitter) = emitter {
                        let _ = emitter.emit_event(
                            "telnet-negotiation",
                            serde_json::to_value(&TelnetNegotiationEvent {
                                session_id: session_id.clone(),
                                client_correlation_id: client_correlation_id.clone(),
                                direction,
                                command,
                                option,
                            })
                            .unwrap_or_default(),
                        );
                    }
                }
                Some(SessionEvent::WriteBack(data)) => {
                    if let Err(error) = Self::queue(&handle, SessionCommand::SendRaw(data)) {
                        handle
                            .connected
                            .store(false, std::sync::atomic::Ordering::Relaxed);
                        handle.shutdown.notify_waiters();
                        if let Some(ref emitter) = emitter {
                            let _ = emitter.emit_event(
                                "telnet-error",
                                serde_json::to_value(&TelnetErrorEvent {
                                    session_id: session_id.clone(),
                                    client_correlation_id: client_correlation_id.clone(),
                                    message: error.clone(),
                                })
                                .unwrap_or_default(),
                            );
                            let _ = emitter.emit_event(
                                "telnet-closed",
                                serde_json::to_value(&TelnetClosedEvent {
                                    session_id: session_id.clone(),
                                    client_correlation_id: client_correlation_id.clone(),
                                    reason: error,
                                })
                                .unwrap_or_default(),
                            );
                        }
                        break;
                    }
                }
                None => {
                    break;
                }
            }
        }

        handle
            .connected
            .store(false, std::sync::atomic::Ordering::Relaxed);
        handle.shutdown.notify_waiters();
        log::info!("[telnet-service] event forwarder for {} exited", session_id);
    }
}

impl Default for TelnetService {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            event_emitter: None,
            connect_gate: Mutex::new(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_core::events::AppEventEmitter;
    use std::time::Duration;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    /// Loopback server that writes each payload once, then idles.
    async fn serve(payloads: Vec<Vec<u8>>) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        tokio::spawn(async move {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            for payload in payloads {
                if socket.write_all(&payload).await.is_err() {
                    return;
                }
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
        });
        port
    }

    fn config(port: u16) -> TelnetConfig {
        TelnetConfig {
            host: "127.0.0.1".into(),
            port,
            allow_insecure_transport: true,
            ..Default::default()
        }
    }

    async fn wait_for_end(service: &TelnetService, id: &str, end: u64) {
        for _ in 0..500 {
            let snapshot = service
                .get_output_snapshot(id, None, None, Some(4))
                .await
                .expect("snapshot");
            let range = service
                .sessions
                .read()
                .await
                .get(id)
                .expect("session")
                .output_ring
                .range();
            if range.sequence_end >= end && snapshot.generation == range.generation {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("ring never reached sequence {end}");
    }

    #[tokio::test]
    async fn output_is_replayable_in_sequence_with_resume_cursor() {
        let port = serve(vec![b"login: ".to_vec(), b"Password: ".to_vec()]).await;
        let service = TelnetService::new();
        let id = service.connect(config(port)).await.expect("connect");
        wait_for_end(&service, &id, 17).await;

        let all = service
            .get_output_snapshot(&id, None, None, None)
            .await
            .expect("snapshot");
        assert_eq!(all.data, "login: Password: ");
        assert_eq!((all.sequence_start, all.sequence_end), (0, 17));
        assert!(!all.gap && !all.has_more);
        assert_eq!(all.session_id, id);

        let tail = service
            .get_output_snapshot(&id, Some(all.generation), Some(7), None)
            .await
            .expect("snapshot");
        assert_eq!(tail.data, "Password: ");
        assert_eq!(tail.sequence_start, 7);
        service.disconnect(&id).await.expect("disconnect");
    }

    #[tokio::test]
    async fn replay_pages_never_split_multibyte_characters() {
        let text = "caf\u{e9} \u{1F600} done".as_bytes().to_vec();
        let total = text.len() as u64;
        let port = serve(vec![text]).await;
        let service = TelnetService::new();
        let id = service.connect(config(port)).await.expect("connect");
        wait_for_end(&service, &id, total).await;
        let mut cursor = None;
        let mut out = String::new();
        loop {
            let page = service
                .get_output_snapshot(&id, None, cursor, Some(4))
                .await
                .expect("snapshot");
            out.push_str(&page.data);
            cursor = Some(page.sequence_end);
            if !page.has_more {
                break;
            }
        }
        assert_eq!(out, "caf\u{e9} \u{1F600} done");
        service.disconnect(&id).await.expect("disconnect");
    }

    #[tokio::test]
    async fn ring_is_capped_and_reports_a_gap_for_a_stale_cursor() {
        // 3 MiB of text against the 1 MiB default cap.
        let chunk = vec![b'x'; 64 * 1024];
        let port = serve((0..48).map(|_| chunk.clone()).collect()).await;
        let service = TelnetService::new();
        let id = service.connect(config(port)).await.expect("connect");
        wait_for_end(&service, &id, 48 * 64 * 1024).await;
        let handle = service
            .sessions
            .read()
            .await
            .get(&id)
            .cloned()
            .expect("handle");
        let range = handle.output_ring.range();
        assert_eq!(range.sequence_end, 48 * 64 * 1024);
        assert!(range.sequence_end - range.sequence_start <= 1024 * 1024);
        assert!(range.dropped_bytes >= 2 * 1024 * 1024);
        let stale = service
            .get_output_snapshot(&id, None, Some(10), Some(16))
            .await
            .expect("snapshot");
        assert!(stale.gap);
        assert_eq!(stale.sequence_start, stale.retained_start);
        service.disconnect(&id).await.expect("disconnect");
    }

    #[tokio::test]
    async fn disconnect_closes_and_zeroizes_the_ring() {
        let port = serve(vec![b"secret banner".to_vec()]).await;
        let service = TelnetService::new();
        let id = service.connect(config(port)).await.expect("connect");
        wait_for_end(&service, &id, 13).await;
        let handle = service
            .sessions
            .read()
            .await
            .get(&id)
            .cloned()
            .expect("handle");
        service.disconnect(&id).await.expect("disconnect");
        assert!(handle.output_ring.is_closed());
        assert_eq!(handle.output_ring.range().sequence_end, 0);
        assert!(handle
            .output_ring
            .snapshot(&id, None, None, None)
            .data
            .is_empty());
        assert!(service
            .get_output_snapshot(&id, None, None, None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn registry_row_describes_the_session_without_output() {
        let port = serve(vec![b"hunter2".to_vec()]).await;
        let service = TelnetService::new();
        let mut cfg = config(port);
        cfg.label = Some("lab router".into());
        let id = service.connect(cfg).await.expect("connect");
        wait_for_end(&service, &id, 7).await;
        let rows = service.live_descriptors().await;
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.protocol, "telnet");
        assert_eq!(row.backend_session_id, id);
        assert_eq!(row.title, "lab router");
        assert_eq!(row.target, "127.0.0.1");
        assert_eq!(row.port, Some(port));
        assert_eq!(row.state, "connected");
        assert_eq!(row.buffer.expect("range").sequence_end, 7);
        assert!(!serde_json::to_string(row)
            .expect("json")
            .contains("hunter2"));
        service.disconnect(&id).await.expect("disconnect");
    }

    #[tokio::test]
    async fn live_events_carry_the_ring_position() {
        struct Capture(std::sync::Mutex<Vec<(String, serde_json::Value)>>);
        impl AppEventEmitter for Capture {
            fn emit_event(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
                self.0
                    .lock()
                    .expect("capture")
                    .push((event.to_string(), payload));
                Ok(())
            }
        }
        let capture = Arc::new(Capture(Default::default()));
        let port = serve(vec![b"abc".to_vec()]).await;
        let service = TelnetService::new_with_emitter(capture.clone());
        let id = service.connect(config(port)).await.expect("connect");
        wait_for_end(&service, &id, 3).await;
        let events = capture.0.lock().expect("capture").clone();
        let output = events
            .iter()
            .find(|(name, _)| name == "telnet-output")
            .expect("an output event");
        assert_eq!(output.1["data"], "abc");
        assert_eq!(output.1["sequence_start"], 0);
        assert_eq!(output.1["sequence_end"], 3);
        assert!(output.1["generation"].as_u64().is_some());
        service.disconnect(&id).await.expect("disconnect");
    }

    #[tokio::test]
    async fn concurrent_writes_do_not_block_on_the_ring() {
        let chunk = vec![b'y'; 4096];
        let port = serve((0..64).map(|_| chunk.clone()).collect()).await;
        let service = TelnetService::new();
        let id = service.connect(config(port)).await.expect("connect");
        // Hammer the write path and the snapshot path while output streams in.
        let reader = {
            let service = service.clone();
            let id = id.clone();
            tokio::spawn(async move {
                for _ in 0..200 {
                    let _ = service
                        .get_output_snapshot(&id, None, None, Some(1024))
                        .await;
                    tokio::task::yield_now().await;
                }
            })
        };
        for _ in 0..50 {
            // The command queue is shallow by design; back off when it is full.
            loop {
                match service.send_command(&id, "ls").await {
                    Ok(()) => break,
                    Err(error) if error.contains("queue is full") => {
                        tokio::time::sleep(Duration::from_millis(1)).await;
                    }
                    Err(error) => panic!("send failed: {error}"),
                }
            }
        }
        reader.await.expect("reader");
        wait_for_end(&service, &id, 64 * 4096).await;
        service.disconnect(&id).await.expect("disconnect");
    }
}
