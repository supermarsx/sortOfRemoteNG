//! Telnet service — manages multiple concurrent telnet sessions.
//!
//! The service is designed to be stored in Tauri's managed state
//! (`app.manage(TelnetService::new())`) and accessed from `#[tauri::command]`
//! handlers.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;
use tauri::{AppHandle, Emitter, Runtime};

use crate::telnet::session::{
    self, SessionCommand, SessionEvent, TelnetSessionHandle, hex_decode,
};
use crate::telnet::types::*;

/// Shared telnet service state stored via `app.manage()`.
pub type TelnetServiceState = Arc<TelnetService>;

/// Manages all active telnet sessions.
pub struct TelnetService {
    sessions: RwLock<HashMap<String, Arc<TelnetSessionHandle>>>,
}

impl TelnetService {
    /// Create a new, empty service.
    pub fn new() -> TelnetServiceState {
        Arc::new(Self {
            sessions: RwLock::new(HashMap::new()),
        })
    }

    // ── Connect ─────────────────────────────────────────────────────

    /// Open a new telnet session.
    ///
    /// Returns the session ID on success.
    pub async fn connect<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        config: TelnetConfig,
    ) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();

        let handle = session::connect(id.clone(), config)
            .await
            .map_err(|e| e.to_string())?;

        let handle = Arc::new(handle);

        // Spawn an event-forwarding loop that reads from the session's
        // event channel and emits Tauri events.
        let app_clone = app.clone();
        let handle_clone = handle.clone();
        let session_id = id.clone();

        tokio::spawn(async move {
            Self::event_forwarder(app_clone, handle_clone, session_id).await;
        });

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
    pub async fn send_command(
        &self,
        session_id: &str,
        command: &str,
    ) -> Result<(), String> {
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
    pub async fn send_raw(
        &self,
        session_id: &str,
        hex_data: &str,
    ) -> Result<(), String> {
        let data = hex_decode(hex_data)
            .ok_or_else(|| "Invalid hex string".to_string())?;
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

    // ── Resize ──────────────────────────────────────────────────────

    /// Resize the terminal window for a session (sends NAWS).
    pub async fn resize(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
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

    // ── Query ───────────────────────────────────────────────────────

    /// Get session info for a specific session.
    pub async fn get_session_info(
        &self,
        session_id: &str,
    ) -> Result<TelnetSession, String> {
        let sessions = self.sessions.read().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;
        Ok(handle.to_session_info())
    }

    /// List all active sessions.
    pub async fn list_sessions(&self) -> Vec<TelnetSession> {
        let sessions = self.sessions.read().await;
        sessions
            .values()
            .map(|h| h.to_session_info())
            .collect()
    }

    /// Get the number of active sessions.
    pub async fn session_count(&self) -> usize {
        self.sessions.read().await.len()
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

    /// Reads events from a session handle and emits them as Tauri events.
    async fn event_forwarder<R: Runtime>(
        app: AppHandle<R>,
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
                        let _ = app.emit(
                            "telnet-output",
                            TelnetOutputEvent {
                                session_id: session_id.clone(),
                                data,
                            },
                        );
                    }
                }
                Some(SessionEvent::Error(msg)) => {
                    let _ = app.emit(
                        "telnet-error",
                        TelnetErrorEvent {
                            session_id: session_id.clone(),
                            message: msg,
                        },
                    );
                }
                Some(SessionEvent::Closed(reason)) => {
                    let _ = app.emit(
                        "telnet-closed",
                        TelnetClosedEvent {
                            session_id: session_id.clone(),
                            reason,
                        },
                    );
                    break;
                }
                Some(SessionEvent::Negotiation { direction, command, option }) => {
                    // If this is a "sent_raw" event, it contains hex-encoded bytes
                    // that need to be sent back to the server.
                    if direction == "sent_raw" {
                        if let Some(raw_bytes) = hex_decode(&command) {
                            let _ = handle
                                .cmd_tx
                                .send(SessionCommand::SendRaw(raw_bytes))
                                .await;
                        }
                    }

                    let _ = app.emit(
                        "telnet-negotiation",
                        TelnetNegotiationEvent {
                            session_id: session_id.clone(),
                            direction,
                            command,
                            option,
                        },
                    );
                }
                None => {
                    // Channel closed.
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
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn service_new_is_empty() {
        let svc = TelnetService::new();
        assert_eq!(svc.session_count().await, 0);
        assert!(svc.list_sessions().await.is_empty());
    }

    #[tokio::test]
    async fn disconnect_nonexistent_session_errors() {
        let svc = TelnetService::new();
        let result = svc.disconnect("nonexistent").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn send_command_nonexistent_session_errors() {
        let svc = TelnetService::new();
        let result = svc.send_command("nope", "ls").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn send_raw_invalid_hex_errors() {
        let svc = TelnetService::new();
        // Even with a valid session id this would fail, but we test hex validation first
        // by providing a session id that doesn't exist.
        let result = svc.send_raw("nope", "xyz").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn get_session_info_nonexistent_errors() {
        let svc = TelnetService::new();
        let result = svc.get_session_info("ghost").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn is_connected_nonexistent_errors() {
        let svc = TelnetService::new();
        let result = svc.is_connected("nope").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn send_break_nonexistent_errors() {
        let svc = TelnetService::new();
        let result = svc.send_break("nope").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn send_ayt_nonexistent_errors() {
        let svc = TelnetService::new();
        let result = svc.send_ayt("nope").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn resize_nonexistent_errors() {
        let svc = TelnetService::new();
        let result = svc.resize("nope", 80, 24).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn disconnect_all_empty_is_ok() {
        let svc = TelnetService::new();
        let result = svc.disconnect_all().await;
        assert!(result.is_ok());
    }
}
