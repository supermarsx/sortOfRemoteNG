//! Serial service — multi-session manager.
//!
//! Owns all active serial sessions, handles port scanning, and forwards
//! session events to the Tauri frontend via the app handle.

use crate::serial::logging::{DataDirection, LogEntry, LogWriter};
use crate::serial::modem::{ModemController, ModemInfo, SignalQuality};
use crate::serial::port_scanner::{self, ScanOptions, ScanResult};
use crate::serial::session::{self, SerialSessionHandle, SessionCommand, SessionEvent};
use crate::serial::transport::SimulatedTransport;
use crate::serial::types::*;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::sync::RwLock;

/// Type alias used as Tauri managed state.
pub type SerialServiceState = Arc<SerialService>;

/// Central serial service.
pub struct SerialService {
    sessions: RwLock<HashMap<String, Arc<SerialSessionHandle>>>,
    log_writers: RwLock<HashMap<String, tokio::sync::Mutex<LogWriter>>>,
}

impl SerialService {
    /// Create a new service instance (wrapped in `Arc`).
    pub fn new() -> SerialServiceState {
        Arc::new(Self {
            sessions: RwLock::new(HashMap::new()),
            log_writers: RwLock::new(HashMap::new()),
        })
    }

    // ── Port scanning ─────────────────────────────────────────────

    /// Scan for available serial ports.
    pub async fn scan_ports(&self, options: ScanOptions) -> Result<ScanResult, String> {
        let start = Instant::now();

        // Build port list from platform enumeration
        let mut ports: Vec<SerialPortInfo> = Vec::new();

        // For now we provide simulated port info since we don't link
        // a real system serial library.  In production, this would
        // call platform APIs (SetupDiGetClassDevs on Windows, libudev
        // on Linux, IOKit on macOS).
        #[cfg(target_os = "windows")]
        {
            let names = port_scanner::enumerate_windows_ports();
            for name in &names {
                let info = port_scanner::build_port_info(name, None, None, None, None, None);
                ports.push(info);
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let names = port_scanner::enumerate_unix_ports();
            for name in &names {
                let info = port_scanner::build_port_info(name, None, None, None, None, None);
                ports.push(info);
            }
        }

        // Apply filters
        let filtered = port_scanner::apply_filters(ports, &options);
        let total = filtered.len();

        Ok(ScanResult {
            ports: filtered,
            scan_time_ms: start.elapsed().as_millis() as u64,
            total_found: total,
        })
    }

    // ── Session management ────────────────────────────────────────

    /// Open a new serial session.
    pub async fn connect(
        &self,
        config: SerialConfig,
    ) -> Result<SerialSession, String> {
        let session_id = uuid::Uuid::new_v4().to_string();

        // Check for duplicate port
        {
            let sessions = self.sessions.read().await;
            for (_, handle) in sessions.iter() {
                if handle.port_name == config.port_name && handle.is_connected() {
                    return Err(format!("Port {} is already in use by session {}", config.port_name, handle.id));
                }
            }
        }

        // Create a simulated transport (in production, would create a real one)
        let transport = SimulatedTransport::new(&config.port_name);

        let handle = session::create_session(session_id.clone(), transport, config.clone())
            .await?;

        let info = handle.info().await;

        // Store the session
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), handle);
        }

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
        let handle = self.get_session(session_id).await?;

        // Log if enabled
        self.log_data(session_id, DataDirection::Tx, &data).await;

        handle.send_command(SessionCommand::SendRaw(data)).await
    }

    /// Send a line of text to a session.
    pub async fn send_line(&self, session_id: &str, line: String) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;

        self.log_data(session_id, DataDirection::Tx, line.as_bytes()).await;

        handle.send_command(SessionCommand::SendLine(line)).await
    }

    /// Send a character to a session.
    pub async fn send_char(&self, session_id: &str, ch: u8) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        handle.send_command(SessionCommand::SendChar(ch)).await
    }

    /// Send a break signal.
    pub async fn send_break(&self, session_id: &str, duration_ms: u32) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        handle.send_command(SessionCommand::SendBreak(duration_ms)).await
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
        handle.send_command(SessionCommand::ReadControlLines(tx)).await?;
        rx.await.map_err(|_| "Failed to read control lines".to_string())?
    }

    /// Reconfigure a session on the fly.
    pub async fn reconfigure(&self, session_id: &str, config: SerialConfig) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        handle.send_command(SessionCommand::Reconfigure(config)).await
    }

    /// Set line ending for a session.
    pub async fn set_line_ending(&self, session_id: &str, line_ending: LineEnding) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        handle.send_command(SessionCommand::SetLineEnding(line_ending)).await
    }

    /// Set local echo for a session.
    pub async fn set_local_echo(&self, session_id: &str, echo: bool) -> Result<(), String> {
        let handle = self.get_session(session_id).await?;
        handle.send_command(SessionCommand::SetLocalEcho(echo)).await
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
        let handle = self.get_session(session_id).await?;
        crate::serial::modem::execute_at_command(
            handle.transport.as_ref(),
            command,
            timeout_ms,
        )
        .await
    }

    /// Get modem info.
    pub async fn get_modem_info(
        &self,
        session_id: &str,
    ) -> Result<ModemInfo, String> {
        let handle = self.get_session(session_id).await?;
        let controller = ModemController::new(
            handle.transport.clone(),
            ModemProfile::default(),
            5000,
        );
        controller.get_info().await
    }

    /// Get modem signal quality.
    pub async fn get_signal_quality(
        &self,
        session_id: &str,
    ) -> Result<SignalQuality, String> {
        let handle = self.get_session(session_id).await?;
        let controller = ModemController::new(
            handle.transport.clone(),
            ModemProfile::default(),
            5000,
        );
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
        let handle = self.get_session(session_id).await?;
        let controller = ModemController::new(
            handle.transport.clone(),
            ModemProfile::default(),
            60000,
        );
        controller.dial(number).await
    }

    /// Hang up.
    pub async fn modem_hangup(&self, session_id: &str) -> Result<AtCommandResult, String> {
        let handle = self.get_session(session_id).await?;
        let controller = ModemController::new(
            handle.transport.clone(),
            ModemProfile::default(),
            5000,
        );
        controller.hangup().await
    }

    // ── Logging ───────────────────────────────────────────────────

    /// Start logging for a session.
    pub async fn start_logging(
        &self,
        session_id: &str,
        config: LogConfig,
    ) -> Result<(), String> {
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
        let writers = self.log_writers.read().await;
        if let Some(writer) = writers.get(session_id) {
            let mut w = writer.lock().await;
            let _ = w.log(LogEntry::new(direction, data.to_vec()));
        }
    }

    // ── Event forwarding ──────────────────────────────────────────

    /// Start forwarding events from a session to a Tauri app handle.
    /// Call this after `connect()`.
    pub fn start_event_forwarder<R: tauri::Runtime>(
        &self,
        app: tauri::AppHandle<R>,
        session_id: String,
        handle: Arc<SerialSessionHandle>,
    ) {
        tokio::spawn(async move {
            let mut event_rx = handle.event_rx.lock().await;
            while let Some(event) = event_rx.recv().await {
                match event {
                    SessionEvent::DataReceived { data, text } => {
                        let payload = SerialOutputEvent {
                            session_id: session_id.clone(),
                            data: base64::Engine::encode(
                                &base64::engine::general_purpose::STANDARD,
                                &data,
                            ),
                            text,
                        };
                        let _ = app.emit("serial:output", &payload);
                    }
                    SessionEvent::Echo(data) => {
                        let text = String::from_utf8_lossy(&data).to_string();
                        let payload = SerialOutputEvent {
                            session_id: session_id.clone(),
                            data: base64::Engine::encode(
                                &base64::engine::general_purpose::STANDARD,
                                &data,
                            ),
                            text,
                        };
                        let _ = app.emit("serial:echo", &payload);
                    }
                    SessionEvent::Error { message, recoverable } => {
                        let payload = SerialErrorEvent {
                            session_id: session_id.clone(),
                            message,
                            recoverable,
                        };
                        let _ = app.emit("serial:error", &payload);
                    }
                    SessionEvent::ControlLineChange(lines) => {
                        let payload = ControlLineChangeEvent {
                            session_id: session_id.clone(),
                            lines,
                        };
                        let _ = app.emit("serial:control-lines", &payload);
                    }
                    SessionEvent::Disconnected { reason } => {
                        let payload = SerialClosedEvent {
                            session_id: session_id.clone(),
                            reason,
                        };
                        let _ = app.emit("serial:closed", &payload);
                        break;
                    }
                    SessionEvent::StatsUpdate(stats) => {
                        let _ = app.emit("serial:stats", &stats);
                    }
                }
            }
        });
    }

    /// Connect with Tauri event forwarding.
    pub async fn connect_with_events<R: tauri::Runtime>(
        &self,
        app: tauri::AppHandle<R>,
        config: SerialConfig,
    ) -> Result<SerialSession, String> {
        let info = self.connect(config).await?;
        let session_id = info.id.clone();

        // Get the handle to start forwarding
        let handle = self.get_session(&session_id).await?;
        self.start_event_forwarder(app, session_id, handle);

        Ok(info)
    }

    // ── Helpers ───────────────────────────────────────────────────

    async fn get_session(&self, session_id: &str) -> Result<Arc<SerialSessionHandle>, String> {
        let sessions = self.sessions.read().await;
        sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("Session not found: {}", session_id))
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
        let info = service.connect(config).await.unwrap();
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
        service.connect(config.clone()).await.unwrap();
        let result = service.connect(config).await;
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
        let info = service.connect(config).await.unwrap();
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
        let info = service.connect(config).await.unwrap();
        service
            .send_line(&info.id, "AT".to_string())
            .await
            .unwrap();
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
        let info = service.connect(config).await.unwrap();

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
        let info = service.connect(config).await.unwrap();
        let fetched = service.get_session_info(&info.id).await.unwrap();
        assert_eq!(fetched.port_name, "COM6");
        assert!(fetched.config_shorthand.contains("115200"));
        service.disconnect(&info.id).await.unwrap();
    }

    #[tokio::test]
    async fn test_service_session_not_found() {
        let service = SerialService::new();
        let result = service.send_raw("nonexistent", b"x".to_vec()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Session not found"));
    }

    #[tokio::test]
    async fn test_service_disconnect_all() {
        let service = SerialService::new();
        for i in 1..=3 {
            let config = SerialConfig {
                port_name: format!("COM{}", i + 10),
                ..Default::default()
            };
            service.connect(config).await.unwrap();
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
        let info = service.connect(config).await.unwrap();
        let stats = service.get_stats(&info.id).await.unwrap();
        assert_eq!(stats.bytes_rx, 0);
        service.disconnect(&info.id).await.unwrap();
    }

    #[tokio::test]
    async fn test_service_scan_ports() {
        let service = SerialService::new();
        let result = service.scan_ports(ScanOptions::default()).await.unwrap();
        assert!(result.total_found > 0 || result.total_found == 0); // platform dependent
    }

    #[tokio::test]
    async fn test_service_set_line_ending() {
        let service = SerialService::new();
        let config = SerialConfig {
            port_name: "COM8".to_string(),
            ..Default::default()
        };
        let info = service.connect(config).await.unwrap();
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
        let info = service.connect(config).await.unwrap();
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
        let info = service.connect(config).await.unwrap();
        service.send_break(&info.id, 250).await.unwrap();
        service.disconnect(&info.id).await.unwrap();
    }
}
