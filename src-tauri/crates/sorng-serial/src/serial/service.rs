//! Serial service — multi-session manager.
//!
//! Owns all active serial sessions, handles port scanning, and forwards
//! session events to the frontend via the event emitter.

use crate::serial::logging::{DataDirection, LogEntry, LogWriter};
use crate::serial::modem::{ModemController, ModemInfo, SignalQuality};
use crate::serial::native_transport::NativeTransport;
use crate::serial::port_scanner::{self, ScanOptions, ScanResult};
use crate::serial::session::{self, SerialSessionHandle, SessionCommand, SessionEvent};
use crate::serial::types::*;
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

const MAX_SERIAL_SESSIONS: usize = 64;

fn bounded_event_text(mut value: String, max_bytes: usize) -> String {
    if value.len() > max_bytes {
        let mut end = max_bytes;
        while !value.is_char_boundary(end) {
            end -= 1;
        }
        value.truncate(end);
    }
    value
}

async fn write_deadline(handle: &SerialSessionHandle) -> tokio::time::Instant {
    let timeout_ms = handle
        .config
        .read()
        .await
        .write_timeout_ms
        .clamp(1, MAX_SERIAL_TIMEOUT_MS);
    tokio::time::Instant::now() + tokio::time::Duration::from_millis(timeout_ms)
}

async fn await_command_completion(
    handle: &SerialSessionHandle,
    command: SessionCommand,
    completion: tokio::sync::oneshot::Receiver<Result<(), String>>,
    deadline: tokio::time::Instant,
) -> Result<(), String> {
    match tokio::time::timeout_at(deadline, handle.send_command(command)).await {
        Ok(result) => result?,
        Err(_) => return Err("Serial command timed out before queue admission".to_string()),
    }
    match tokio::time::timeout_at(deadline, completion).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Serial session closed before command completion".to_string()),
        Err(_) => Err("Serial command completion timed out".to_string()),
    }
}

/// Type alias used as Tauri managed state.
pub type SerialServiceState = Arc<SerialService>;

/// Central serial service.
pub struct SerialService {
    sessions: RwLock<HashMap<String, Arc<SerialSessionHandle>>>,
    log_writers: Arc<RwLock<HashMap<String, tokio::sync::Mutex<LogWriter>>>>,
    event_emitter: Option<DynEventEmitter>,
}

impl SerialService {
    /// Create a new service instance (wrapped in `Arc`).
    pub fn new() -> SerialServiceState {
        Arc::new(Self {
            sessions: RwLock::new(HashMap::new()),
            log_writers: Arc::new(RwLock::new(HashMap::new())),
            event_emitter: None,
        })
    }

    /// Create a new service instance with an event emitter for frontend events.
    pub fn new_with_emitter(emitter: DynEventEmitter) -> SerialServiceState {
        Arc::new(Self {
            sessions: RwLock::new(HashMap::new()),
            log_writers: Arc::new(RwLock::new(HashMap::new())),
            event_emitter: Some(emitter),
        })
    }

    // ── Port scanning ─────────────────────────────────────────────

    /// Scan for available serial ports.
    pub async fn scan_ports(&self, options: ScanOptions) -> Result<ScanResult, String> {
        // Use native enumeration via the serialport crate.
        // This runs blocking I/O, so offload to a blocking thread.
        let opts = options.clone();
        let result = tokio::task::spawn_blocking(move || port_scanner::scan_native_ports(&opts))
            .await
            .map_err(|e| format!("spawn_blocking join error: {}", e))?;

        // Mark ports that are currently in use by our sessions
        let sessions = self.sessions.read().await;
        let in_use_ports: Vec<String> = sessions
            .values()
            .filter(|h| h.is_connected())
            .map(|h| h.port_name.clone())
            .collect();
        drop(sessions);

        let mut result = result;
        for port in &mut result.ports {
            if in_use_ports.contains(&port.port_name) {
                port.in_use = true;
            }
        }

        Ok(result)
    }

    // ── Session management ────────────────────────────────────────

    /// Open a new serial session.
    pub async fn connect(&self, config: SerialConfig) -> Result<SerialSession, String> {
        config.validate()?;
        let session_id = uuid::Uuid::new_v4().to_string();

        // Check for duplicate port
        {
            let sessions = self.sessions.read().await;
            if sessions.len() >= MAX_SERIAL_SESSIONS {
                return Err(format!(
                    "Serial session limit of {} has been reached",
                    MAX_SERIAL_SESSIONS
                ));
            }
            for handle in sessions.values() {
                if handle.port_name == config.port_name && handle.is_connected() {
                    return Err(format!(
                        "Port {} is already in use by session {}",
                        config.port_name, handle.id
                    ));
                }
            }
        }

        // Create a real native transport for hardware COM / tty ports
        let transport = NativeTransport::new(&config.port_name);

        let handle = session::create_session(session_id.clone(), transport, config.clone()).await?;

        let info = handle.info().await;

        // Store the session
        {
            let mut sessions = self.sessions.write().await;
            if sessions.len() >= MAX_SERIAL_SESSIONS
                || sessions.values().any(|existing| {
                    existing.port_name == config.port_name && existing.is_connected()
                })
            {
                drop(sessions);
                let _ = handle.send_command(SessionCommand::Disconnect).await;
                return Err(
                    "Serial session admission changed while the port was opening".to_string(),
                );
            }
            sessions.insert(session_id.clone(), handle.clone());
        }
        self.start_event_forwarder(self.event_emitter.clone(), session_id.clone(), handle);

        Ok(info)
    }

    /// Open a new serial session using a simulated transport (for testing).
    #[cfg(test)]
    pub async fn connect_simulated(&self, config: SerialConfig) -> Result<SerialSession, String> {
        use crate::serial::transport::SimulatedTransport;
        config.validate()?;
        let session_id = uuid::Uuid::new_v4().to_string();

        // Check for duplicate port
        {
            let sessions = self.sessions.read().await;
            for (_, handle) in sessions.iter() {
                if handle.port_name == config.port_name && handle.is_connected() {
                    return Err(format!(
                        "Port {} is already in use by session {}",
                        config.port_name, handle.id
                    ));
                }
            }
        }

        let transport = SimulatedTransport::new(&config.port_name);
        let handle = session::create_session(session_id.clone(), transport, config.clone()).await?;

        let info = handle.info().await;
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), handle.clone());
        }
        self.start_event_forwarder(None, session_id.clone(), handle);
        Ok(info)
    }

    /// Disconnect a session.
    pub async fn disconnect(&self, session_id: &str) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        handle.send_command(SessionCommand::Disconnect).await?;

        // Remove from sessions map
        {
            let mut sessions = self.sessions.write().await;
            sessions.remove(session_id);
        }

        // Remove log writer if any
        {
            let mut writers = self.log_writers.write().await;
            if let Some(writer) = writers.remove(session_id) {
                let mut w = writer.lock().await;
                w.close();
            }
        }

        Ok(())
    }

    /// Disconnect all sessions.
    pub async fn disconnect_all(&self) -> Result<Vec<String>, String> {
        let ids: Vec<String> = {
            let sessions = self.sessions.read().await;
            sessions.keys().cloned().collect()
        };

        let mut disconnected = Vec::new();
        for id in ids {
            if self.disconnect(&id).await.is_ok() {
                disconnected.push(id);
            }
        }
        Ok(disconnected)
    }

    /// Send raw bytes to a session.
    pub async fn send_raw(&self, session_id: &str, data: Vec<u8>) -> Result<(), String> {
        if data.len() > MAX_SERIAL_PAYLOAD_BYTES {
            return Err(format!(
                "Serial payload exceeds {} bytes",
                MAX_SERIAL_PAYLOAD_BYTES
            ));
        }
        let handle = self.get_session(session_id).await?;
        let deadline = write_deadline(handle.as_ref()).await;
        let (completion_tx, completion_rx) = tokio::sync::oneshot::channel();
        let command = SessionCommand::SendRaw {
            data: data.clone(),
            deadline,
            completion: completion_tx,
        };
        await_command_completion(handle.as_ref(), command, completion_rx, deadline).await?;
        self.log_data(session_id, DataDirection::Tx, &data).await;
        Ok(())
    }

    /// Send a line of text to a session.
    pub async fn send_line(&self, session_id: &str, line: String) -> Result<(), String> {
        if line.len().saturating_add(2) > MAX_SERIAL_PAYLOAD_BYTES {
            return Err(format!(
                "Serial line exceeds {} bytes",
                MAX_SERIAL_PAYLOAD_BYTES.saturating_sub(2)
            ));
        }
        let handle = self.get_session(session_id).await?;
        let logged = line.clone();
        let deadline = write_deadline(handle.as_ref()).await;
        let (completion_tx, completion_rx) = tokio::sync::oneshot::channel();
        let command = SessionCommand::SendLine {
            line,
            deadline,
            completion: completion_tx,
        };
        await_command_completion(handle.as_ref(), command, completion_rx, deadline).await?;
        self.log_data(session_id, DataDirection::Tx, logged.as_bytes())
            .await;
        Ok(())
    }

    /// Send a character to a session.
    pub async fn send_char(&self, session_id: &str, ch: u8) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        let deadline = write_deadline(handle.as_ref()).await;
        let (completion_tx, completion_rx) = tokio::sync::oneshot::channel();
        let command = SessionCommand::SendChar {
            ch,
            deadline,
            completion: completion_tx,
        };
        await_command_completion(handle.as_ref(), command, completion_rx, deadline).await
    }

    /// Send a break signal.
    pub async fn send_break(&self, session_id: &str, duration_ms: u32) -> Result<(), String> {
        if duration_ms > MAX_SERIAL_BREAK_MS {
            return Err(format!(
                "Serial break duration cannot exceed {} ms",
                MAX_SERIAL_BREAK_MS
            ));
        }
        let handle = self.get_session(session_id).await?;
        handle
            .send_command(SessionCommand::SendBreak(duration_ms))
            .await
    }

    /// Set DTR line.
    pub async fn set_dtr(&self, session_id: &str, state: bool) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        handle.send_command(SessionCommand::SetDtr(state)).await
    }

    /// Set RTS line.
    pub async fn set_rts(&self, session_id: &str, state: bool) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        handle.send_command(SessionCommand::SetRts(state)).await
    }

    /// Read control lines.
    pub async fn read_control_lines(&self, session_id: &str) -> Result<ControlLines, String> {
        let handle = self.get_session(session_id).await?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        handle
            .send_command(SessionCommand::ReadControlLines(tx))
            .await?;
        rx.await
            .map_err(|_| "Failed to read control lines".to_string())?
    }

    /// Reconfigure a session on the fly.
    pub async fn reconfigure(&self, session_id: &str, config: SerialConfig) -> Result<(), String> {
        config.validate()?;
        let handle = self.get_session(session_id).await?;
        if config.port_name != handle.port_name {
            return Err("Cannot change a serial session's port name".to_string());
        }
        let timeout_ms = config.write_timeout_ms.clamp(1, MAX_SERIAL_TIMEOUT_MS);
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_millis(timeout_ms);
        let (completion_tx, completion_rx) = tokio::sync::oneshot::channel();
        let command = SessionCommand::Reconfigure {
            config,
            deadline,
            completion: completion_tx,
        };
        await_command_completion(handle.as_ref(), command, completion_rx, deadline).await
    }

    /// Set line ending for a session.
    pub async fn set_line_ending(
        &self,
        session_id: &str,
        line_ending: LineEnding,
    ) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        handle
            .send_command(SessionCommand::SetLineEnding(line_ending))
            .await
    }

    /// Set local echo for a session.
    pub async fn set_local_echo(&self, session_id: &str, echo: bool) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        handle
            .send_command(SessionCommand::SetLocalEcho(echo))
            .await
    }

    /// Flush output for a session.
    pub async fn flush(&self, session_id: &str) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        handle.send_command(SessionCommand::Flush).await
    }

    /// Get session statistics.
    pub async fn get_stats(&self, session_id: &str) -> Result<SessionStats, String> {
        let handle = self.get_session(session_id).await?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        handle.send_command(SessionCommand::GetStats(tx)).await?;
        rx.await.map_err(|_| "Failed to get stats".to_string())
    }

    /// Get info about a session.
    pub async fn get_session_info(&self, session_id: &str) -> Result<SerialSession, String> {
        let handle = self.get_session(session_id).await?;
        Ok(handle.info().await)
    }

    /// List all active sessions.
    pub async fn list_sessions(&self) -> Vec<SerialSession> {
        let sessions = self.sessions.read().await;
        let mut list = Vec::new();
        for handle in sessions.values() {
            list.push(handle.info().await);
        }
        list
    }

    // ── Modem commands ────────────────────────────────────────────

    /// Send an AT command to a session (modem mode).
    pub async fn send_at_command(
        &self,
        session_id: &str,
        command: &str,
        timeout_ms: u64,
    ) -> Result<AtCommandResult, String> {
        if command.is_empty()
            || command.len() > MAX_SERIAL_MODEM_COMMAND_BYTES
            || command.chars().any(char::is_control)
        {
            return Err(
                "AT command is empty, oversized, or contains control characters".to_string(),
            );
        }
        if timeout_ms == 0 || timeout_ms > MAX_SERIAL_TIMEOUT_MS {
            return Err(format!(
                "AT command timeout must be between 1 and {} ms",
                MAX_SERIAL_TIMEOUT_MS
            ));
        }
        let handle = self.get_session(session_id).await?;
        crate::serial::modem::execute_at_command(handle.transport.as_ref(), command, timeout_ms)
            .await
    }

    /// Get modem info.
    pub async fn get_modem_info(&self, session_id: &str) -> Result<ModemInfo, String> {
        let handle = self.get_session(session_id).await?;
        let controller =
            ModemController::new(handle.transport.clone(), ModemProfile::default(), 5000);
        controller.get_info().await
    }

    /// Get modem signal quality.
    pub async fn get_signal_quality(&self, session_id: &str) -> Result<SignalQuality, String> {
        let handle = self.get_session(session_id).await?;
        let controller =
            ModemController::new(handle.transport.clone(), ModemProfile::default(), 5000);
        controller.get_signal_quality().await
    }

    /// Initialize modem with profile.
    pub async fn modem_init(
        &self,
        session_id: &str,
        profile: Option<ModemProfile>,
    ) -> Result<AtCommandResult, String> {
        let handle = self.get_session(session_id).await?;
        let p = profile.unwrap_or_default();
        let controller = ModemController::new(handle.transport.clone(), p, 5000);
        controller.initialize().await
    }

    /// Dial a number.
    pub async fn modem_dial(
        &self,
        session_id: &str,
        number: &str,
    ) -> Result<AtCommandResult, String> {
        if number.is_empty() || number.len() > 256 || number.chars().any(char::is_control) {
            return Err(
                "Dial string is empty, oversized, or contains control characters".to_string(),
            );
        }
        let handle = self.get_session(session_id).await?;
        let controller =
            ModemController::new(handle.transport.clone(), ModemProfile::default(), 60000);
        controller.dial(number).await
    }

    /// Hang up.
    pub async fn modem_hangup(&self, session_id: &str) -> Result<AtCommandResult, String> {
        let handle = self.get_session(session_id).await?;
        let controller =
            ModemController::new(handle.transport.clone(), ModemProfile::default(), 5000);
        controller.hangup().await
    }

    // ── Logging ───────────────────────────────────────────────────

    /// Start logging for a session.
    pub async fn start_logging(&self, session_id: &str, config: LogConfig) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        let mut writer = LogWriter::new(config)?;
        let info = handle.info().await;
        writer.write_header(session_id, &info.port_name, &info.config_shorthand)?;

        let mut writers = self.log_writers.write().await;
        writers.insert(session_id.to_string(), tokio::sync::Mutex::new(writer));
        Ok(())
    }

    /// Stop logging for a session.
    pub async fn stop_logging(&self, session_id: &str) -> Result<(), String> {
        let mut writers = self.log_writers.write().await;
        if let Some(writer) = writers.remove(session_id) {
            let mut w = writer.lock().await;
            w.flush()?;
            w.close();
        }
        Ok(())
    }

    async fn log_data(&self, session_id: &str, direction: DataDirection, data: &[u8]) {
        if data.len() > MAX_SERIAL_PAYLOAD_BYTES {
            return;
        }
        let writers = self.log_writers.read().await;
        if let Some(writer) = writers.get(session_id) {
            let mut w = writer.lock().await;
            if let Err(error) = w.log(LogEntry::new(direction, data.to_vec())) {
                log::warn!(
                    "Serial capture write failed: {}",
                    bounded_event_text(error, MAX_SERIAL_ERROR_BYTES)
                );
            }
        }
    }

    // ── Event forwarding ──────────────────────────────────────────

    /// Start forwarding events from a session to the event emitter.
    /// Call this after `connect()`.
    pub fn start_event_forwarder(
        &self,
        emitter: Option<DynEventEmitter>,
        session_id: String,
        handle: Arc<SerialSessionHandle>,
    ) {
        let log_writers = self.log_writers.clone();
        tokio::spawn(async move {
            let mut event_rx = handle.event_rx.lock().await;
            while let Some(event) = event_rx.recv().await {
                match event {
                    SessionEvent::DataReceived { data, text } => {
                        if let Some(writer) = log_writers.read().await.get(&session_id) {
                            let mut writer = writer.lock().await;
                            if let Err(error) =
                                writer.log(LogEntry::new(DataDirection::Rx, data.clone()))
                            {
                                log::warn!(
                                    "Serial capture write failed: {}",
                                    bounded_event_text(error, MAX_SERIAL_ERROR_BYTES)
                                );
                            }
                        }
                        if let Some(emitter) = &emitter {
                            let payload = SerialOutputEvent {
                                session_id: session_id.clone(),
                                data: base64::Engine::encode(
                                    &base64::engine::general_purpose::STANDARD,
                                    &data,
                                ),
                                text: bounded_event_text(text, MAX_SERIAL_PAYLOAD_BYTES),
                            };
                            let _ = emitter.emit_event(
                                "serial:output",
                                serde_json::to_value(&payload).unwrap_or_default(),
                            );
                        }
                    }
                    SessionEvent::Echo(data) => {
                        if let Some(emitter) = &emitter {
                            let text = bounded_event_text(
                                String::from_utf8_lossy(&data).to_string(),
                                MAX_SERIAL_PAYLOAD_BYTES,
                            );
                            let payload = SerialOutputEvent {
                                session_id: session_id.clone(),
                                data: base64::Engine::encode(
                                    &base64::engine::general_purpose::STANDARD,
                                    &data,
                                ),
                                text,
                            };
                            let _ = emitter.emit_event(
                                "serial:echo",
                                serde_json::to_value(&payload).unwrap_or_default(),
                            );
                        }
                    }
                    SessionEvent::Error {
                        message,
                        recoverable,
                    } => {
                        if let Some(emitter) = &emitter {
                            let payload = SerialErrorEvent {
                                session_id: session_id.clone(),
                                message: bounded_event_text(message, MAX_SERIAL_ERROR_BYTES),
                                recoverable,
                            };
                            let _ = emitter.emit_event(
                                "serial:error",
                                serde_json::to_value(&payload).unwrap_or_default(),
                            );
                        }
                    }
                    SessionEvent::ControlLineChange(lines) => {
                        if let Some(emitter) = &emitter {
                            let payload = ControlLineChangeEvent {
                                session_id: session_id.clone(),
                                lines,
                            };
                            let _ = emitter.emit_event(
                                "serial:control-lines",
                                serde_json::to_value(&payload).unwrap_or_default(),
                            );
                        }
                    }
                    SessionEvent::Disconnected { reason } => {
                        if let Some(emitter) = &emitter {
                            let payload = SerialClosedEvent {
                                session_id: session_id.clone(),
                                reason,
                            };
                            let _ = emitter.emit_event(
                                "serial:closed",
                                serde_json::to_value(&payload).unwrap_or_default(),
                            );
                        }
                        break;
                    }
                    SessionEvent::StatsUpdate(stats) => {
                        if let Some(emitter) = &emitter {
                            let _ = emitter.emit_event(
                                "serial:stats",
                                serde_json::to_value(&stats).unwrap_or_default(),
                            );
                        }
                    }
                }
            }
        });
    }

    /// Connect with event forwarding to the stored emitter.
    pub async fn connect_with_events(&self, config: SerialConfig) -> Result<SerialSession, String> {
        self.connect(config).await
    }

    // ── Helpers ───────────────────────────────────────────────────

    async fn get_session(&self, session_id: &str) -> Result<Arc<SerialSessionHandle>, String> {
        if session_id.is_empty() || session_id.len() > MAX_SERIAL_SESSION_ID_BYTES {
            return Err("Invalid serial session identifier".to_string());
        }
        let sessions = self.sessions.read().await;
        sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| "Serial session not found".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_service_new() {
        let service = SerialService::new();
        let sessions = service.list_sessions().await;
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn test_service_connect_disconnect() {
        let service = SerialService::new();
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            ..Default::default()
        };
        let info = service.connect_simulated(config).await.unwrap();
        assert_eq!(info.port_name, "COM1");
        assert_eq!(info.state, SessionState::Connected);

        let sessions = service.list_sessions().await;
        assert_eq!(sessions.len(), 1);

        service.disconnect(&info.id).await.unwrap();
        let sessions = service.list_sessions().await;
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn test_service_duplicate_port() {
        let service = SerialService::new();
        let config = SerialConfig {
            port_name: "COM2".to_string(),
            ..Default::default()
        };
        service.connect_simulated(config.clone()).await.unwrap();
        let result = service.connect_simulated(config).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already in use"));
    }

    #[tokio::test]
    async fn test_service_send_raw() {
        let service = SerialService::new();
        let config = SerialConfig {
            port_name: "COM3".to_string(),
            ..Default::default()
        };
        let info = service.connect_simulated(config).await.unwrap();
        service.send_raw(&info.id, b"test".to_vec()).await.unwrap();
        service.disconnect(&info.id).await.unwrap();
    }

    #[tokio::test]
    async fn test_service_send_line() {
        let service = SerialService::new();
        let config = SerialConfig {
            port_name: "COM4".to_string(),
            ..Default::default()
        };
        let info = service.connect_simulated(config).await.unwrap();
        service.send_line(&info.id, "AT".to_string()).await.unwrap();
        service.disconnect(&info.id).await.unwrap();
    }

    #[tokio::test]
    async fn test_service_control_lines() {
        let service = SerialService::new();
        let config = SerialConfig {
            port_name: "COM5".to_string(),
            dtr_on_open: true,
            rts_on_open: true,
            ..Default::default()
        };
        let info = service.connect_simulated(config).await.unwrap();

        let cl = service.read_control_lines(&info.id).await.unwrap();
        assert!(cl.dtr);
        assert!(cl.rts);

        service.set_dtr(&info.id, false).await.unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        let cl2 = service.read_control_lines(&info.id).await.unwrap();
        assert!(!cl2.dtr);

        service.disconnect(&info.id).await.unwrap();
    }

    #[tokio::test]
    async fn test_service_get_session_info() {
        let service = SerialService::new();
        let config = SerialConfig {
            port_name: "COM6".to_string(),
            baud_rate: BaudRate::Baud115200,
            ..Default::default()
        };
        let info = service.connect_simulated(config).await.unwrap();
        let fetched = service.get_session_info(&info.id).await.unwrap();
        assert_eq!(fetched.port_name, "COM6");
        assert!(fetched.config_shorthand.contains("115200"));
        service.disconnect(&info.id).await.unwrap();
    }

    #[tokio::test]
    async fn test_service_session_not_found() {
        let service = SerialService::new();
        let result = service.send_raw("nonexistent", b"x".to_vec()).await;
        assert_eq!(result, Err("Serial session not found".to_string()));
    }

    #[tokio::test]
    async fn test_service_disconnect_all() {
        let service = SerialService::new();
        for i in 1..=3 {
            let config = SerialConfig {
                port_name: format!("COM{}", i + 10),
                ..Default::default()
            };
            service.connect_simulated(config).await.unwrap();
        }
        assert_eq!(service.list_sessions().await.len(), 3);

        let disconnected = service.disconnect_all().await.unwrap();
        assert_eq!(disconnected.len(), 3);
        assert!(service.list_sessions().await.is_empty());
    }

    #[tokio::test]
    async fn test_service_get_stats() {
        let service = SerialService::new();
        let config = SerialConfig {
            port_name: "COM7".to_string(),
            ..Default::default()
        };
        let info = service.connect_simulated(config).await.unwrap();
        let stats = service.get_stats(&info.id).await.unwrap();
        assert_eq!(stats.bytes_rx, 0);
        service.disconnect(&info.id).await.unwrap();
    }

    #[tokio::test]
    async fn test_service_scan_ports() {
        let service = SerialService::new();
        let _result = service.scan_ports(ScanOptions::default()).await.unwrap();
        // total_found is platform dependent; simply exercising the API is enough.
    }

    #[tokio::test]
    async fn test_service_set_line_ending() {
        let service = SerialService::new();
        let config = SerialConfig {
            port_name: "COM8".to_string(),
            ..Default::default()
        };
        let info = service.connect_simulated(config).await.unwrap();
        service
            .set_line_ending(&info.id, LineEnding::Lf)
            .await
            .unwrap();
        service.disconnect(&info.id).await.unwrap();
    }

    #[tokio::test]
    async fn test_service_set_local_echo() {
        let service = SerialService::new();
        let config = SerialConfig {
            port_name: "COM9".to_string(),
            ..Default::default()
        };
        let info = service.connect_simulated(config).await.unwrap();
        service.set_local_echo(&info.id, true).await.unwrap();
        service.disconnect(&info.id).await.unwrap();
    }

    #[tokio::test]
    async fn test_service_send_break() {
        let service = SerialService::new();
        let config = SerialConfig {
            port_name: "COM10".to_string(),
            ..Default::default()
        };
        let info = service.connect_simulated(config).await.unwrap();
        service.send_break(&info.id, 250).await.unwrap();
        service.disconnect(&info.id).await.unwrap();
    }
}
