//! Telnet service — manages multiple concurrent telnet sessions.

use std::collections::HashMap;
use std::sync::Arc;

use sorng_core::events::DynEventEmitter;
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
                        if let Some(ref emitter) = emitter {
                            let _ = emitter.emit_event(
                                "telnet-output",
                                serde_json::to_value(&TelnetOutputEvent {
                                    session_id: session_id.clone(),
                                    client_correlation_id: client_correlation_id.clone(),
                                    data,
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
