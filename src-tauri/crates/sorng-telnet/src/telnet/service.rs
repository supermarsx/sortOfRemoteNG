//! Telnet service — manages multiple concurrent telnet sessions.

use std::collections::HashMap;
use std::sync::Arc;

use sorng_core::events::DynEventEmitter;
use tokio::sync::RwLock;

use crate::telnet::session::{self, hex_decode, SessionCommand, SessionEvent, TelnetSessionHandle};
use crate::telnet::types::*;

/// Shared telnet service state stored via `app.manage()`.
pub type TelnetServiceState = Arc<TelnetService>;

/// Manages all active telnet sessions.
pub struct TelnetService {
    sessions: RwLock<HashMap<String, Arc<TelnetSessionHandle>>>,
    event_emitter: Option<DynEventEmitter>,
}

impl TelnetService {
    /// Create a new, empty service.
    pub fn new() -> TelnetServiceState {
        Arc::new(Self {
            sessions: RwLock::new(HashMap::new()),
            event_emitter: None,
        })
    }

    /// Create a new service with an event emitter.
    pub fn new_with_emitter(emitter: DynEventEmitter) -> TelnetServiceState {
        Arc::new(Self {
            sessions: RwLock::new(HashMap::new()),
            event_emitter: Some(emitter),
        })
    }

    // ── Connect ─────────────────────────────────────────────────────

    /// Open a new telnet session.
    ///
    /// Returns the session ID on success.
    pub async fn connect(&self, config: TelnetConfig) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();

        let handle = session::connect(id.clone(), config)
            .await
            .map_err(|e| e.to_string())?;

        let handle = Arc::new(handle);

        // Spawn an event-forwarding loop that reads from the session's
        // event channel and emits events via the emitter.
        if let Some(ref emitter) = self.event_emitter {
            let emitter_clone = emitter.clone();
            let handle_clone = handle.clone();
            let session_id = id.clone();

            tokio::spawn(async move {
                Self::event_forwarder(emitter_clone, handle_clone, session_id).await;
            });
        }

        self.sessions.write().await.insert(id.clone(), handle);
        log::info!("[telnet-service] session {} created", id);
        Ok(id)
    }

    // ── Disconnect ──────────────────────────────────────────────────

    /// Disconnect a session by ID.
    pub async fn disconnect(&self, session_id: &str) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        handle
            .cmd_tx
            .send(SessionCommand::Disconnect)
            .await
            .map_err(|e| format!("Failed to send disconnect: {}", e))?;
        drop(sessions);

        // Remove from map.
        self.sessions.write().await.remove(session_id);
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
        let sessions = self.sessions.read().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        handle
            .cmd_tx
            .send(SessionCommand::SendLine(command.to_string()))
            .await
            .map_err(|e| format!("Failed to send command: {}", e))
    }

    /// Send raw bytes to a session (hex-encoded string).
    pub async fn send_raw(&self, session_id: &str, hex_data: &str) -> Result<(), String> {
        let data = hex_decode(hex_data).ok_or_else(|| "Invalid hex string".to_string())?;
        let sessions = self.sessions.read().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        handle
            .cmd_tx
            .send(SessionCommand::SendRaw(data))
            .await
            .map_err(|e| format!("Failed to send raw data: {}", e))
    }

    /// Send a break signal to a session.
    pub async fn send_break(&self, session_id: &str) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        handle
            .cmd_tx
            .send(SessionCommand::Break)
            .await
            .map_err(|e| format!("Failed to send break: {}", e))
    }

    /// Send Are-You-There to a session.
    pub async fn send_ayt(&self, session_id: &str) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        handle
            .cmd_tx
            .send(SessionCommand::AreYouThere)
            .await
            .map_err(|e| format!("Failed to send AYT: {}", e))
    }

    /// Resize the terminal for a session (sends NAWS sub-negotiation).
    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        handle
            .cmd_tx
            .send(SessionCommand::Resize { cols, rows })
            .await
            .map_err(|e| format!("Failed to send resize: {}", e))
    }

    // ── Query ────────────────────────────────────────────────────────

    /// Get session info.
    pub async fn get_session_info(&self, session_id: &str) -> Result<TelnetSession, String> {
        let sessions = self.sessions.read().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        Ok(handle.to_session_info())
    }

    /// List all sessions.
    pub async fn list_sessions(&self) -> Vec<TelnetSession> {
        let sessions = self.sessions.read().await;
        sessions.values().map(|h| h.to_session_info()).collect()
    }

    /// Check whether a session is still connected.
    pub async fn is_connected(&self, session_id: &str) -> Result<bool, String> {
        let sessions = self.sessions.read().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        Ok(handle.connected.load(std::sync::atomic::Ordering::Relaxed))
    }

    // ── Event forwarder ─────────────────────────────────────────────

    /// Reads events from a session handle and emits them via the event emitter.
    async fn event_forwarder(
        emitter: DynEventEmitter,
        handle: Arc<TelnetSessionHandle>,
        session_id: String,
    ) {
        loop {
            let event = {
                let mut rx = handle.event_rx.lock().await;
                rx.recv().await
            };

            match event {
                Some(SessionEvent::Data(data)) => {
                    if !data.is_empty() {
                        let _ = emitter.emit_event(
                            "telnet-output",
                            serde_json::to_value(&TelnetOutputEvent {
                                session_id: session_id.clone(),
                                data,
                            }).unwrap_or_default(),
                        );
                    }
                }
                Some(SessionEvent::Error(msg)) => {
                    let _ = emitter.emit_event(
                        "telnet-error",
                        serde_json::to_value(&TelnetErrorEvent {
                            session_id: session_id.clone(),
                            message: msg,
                        }).unwrap_or_default(),
                    );
                }
                Some(SessionEvent::Closed(reason)) => {
                    let _ = emitter.emit_event(
                        "telnet-closed",
                        serde_json::to_value(&TelnetClosedEvent {
                            session_id: session_id.clone(),
                            reason,
                        }).unwrap_or_default(),
                    );
                    break;
                }
                Some(SessionEvent::Negotiation {
                    direction,
                    command,
                    option,
                }) => {
                    if direction == "sent_raw" {
                        if let Some(raw_bytes) = hex_decode(&command) {
                            let _ = handle.cmd_tx.send(SessionCommand::SendRaw(raw_bytes)).await;
                        }
                    }

                    let _ = emitter.emit_event(
                        "telnet-negotiation",
                        serde_json::to_value(&TelnetNegotiationEvent {
                            session_id: session_id.clone(),
                            direction,
                            command,
                            option,
                        }).unwrap_or_default(),
                    );
                }
                None => {
                    break;
                }
            }
        }

        log::info!("[telnet-service] event forwarder for {} exited", session_id);
    }
}

impl Default for TelnetService {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            event_emitter: None,
        }
    }
}
