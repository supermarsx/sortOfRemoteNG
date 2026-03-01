//! Serial session management.
//!
//! Each session wraps a `SerialTransport` and provides async read/write
//! loops, command/event channels, line buffering, and statistics tracking.

use crate::serial::transport::{LineDiscipline, SerialTransport, XonXoffController};
use crate::serial::types::*;
use chrono::Utc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session commands (frontend → session)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Commands that can be sent to a running session.
#[derive(Debug)]
pub enum SessionCommand {
    /// Send raw bytes to the port.
    SendRaw(Vec<u8>),
    /// Send a string with line ending appended.
    SendLine(String),
    /// Send a single character (for interactive terminal).
    SendChar(u8),
    /// Send a break signal.
    SendBreak(u32),
    /// Set DTR line.
    SetDtr(bool),
    /// Set RTS line.
    SetRts(bool),
    /// Read control lines (response via oneshot).
    ReadControlLines(oneshot::Sender<Result<ControlLines, String>>),
    /// Reconfigure the port on the fly.
    Reconfigure(SerialConfig),
    /// Change line ending.
    SetLineEnding(LineEnding),
    /// Toggle local echo.
    SetLocalEcho(bool),
    /// Flush output.
    Flush,
    /// Get session statistics.
    GetStats(oneshot::Sender<SessionStats>),
    /// Disconnect and clean up.
    Disconnect,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session events (session → frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Events emitted by a running session.
#[derive(Debug, Clone)]
pub enum SessionEvent {
    /// Data received from the port.
    DataReceived {
        data: Vec<u8>,
        text: String,
    },
    /// Echo data for local display.
    Echo(Vec<u8>),
    /// Error occurred.
    Error {
        message: String,
        recoverable: bool,
    },
    /// Control lines changed.
    ControlLineChange(ControlLines),
    /// Session disconnected.
    Disconnected {
        reason: String,
    },
    /// Statistics update.
    StatsUpdate(SessionStats),
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session Handle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Handle to a running serial session.  Held by the service layer.
pub struct SerialSessionHandle {
    /// Unique session ID.
    pub id: String,
    /// Port name.
    pub port_name: String,
    /// The underlying transport.
    pub transport: Arc<dyn SerialTransport>,
    /// Channel to send commands to the session task.
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    /// Channel to receive events from the session task.
    pub event_rx: Mutex<mpsc::Receiver<SessionEvent>>,
    /// Whether the session is connected.
    pub connected: Arc<AtomicBool>,
    /// Config used to open the session.
    pub config: RwLock<SerialConfig>,
    /// When the session was opened.
    pub connected_at: chrono::DateTime<Utc>,
    /// Bytes received.
    pub bytes_rx: Arc<AtomicU64>,
    /// Bytes sent.
    pub bytes_tx: Arc<AtomicU64>,
}

impl SerialSessionHandle {
    /// Build a `SerialSession` info snapshot.
    pub async fn info(&self) -> SerialSession {
        let config = self.config.read().await;
        let cl = self
            .transport
            .read_control_lines()
            .await
            .unwrap_or_default();
        let state = if self.connected.load(Ordering::SeqCst) {
            SessionState::Connected
        } else {
            SessionState::Disconnected
        };
        SerialSession {
            id: self.id.clone(),
            port_name: self.port_name.clone(),
            config_shorthand: config.shorthand(),
            state,
            label: config.label.clone(),
            connected_at: self.connected_at,
            bytes_rx: self.bytes_rx.load(Ordering::Relaxed),
            bytes_tx: self.bytes_tx.load(Ordering::Relaxed),
            control_lines: cl,
        }
    }

    /// Send a command to the session.
    pub async fn send_command(&self, cmd: SessionCommand) -> Result<(), String> {
        self.cmd_tx
            .send(cmd)
            .await
            .map_err(|_| "Session command channel closed".to_string())
    }

    /// Check whether the session is still connected.
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session runner (async task)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Internal state for the session task.
struct SessionRunner {
    transport: Arc<dyn SerialTransport>,
    config: SerialConfig,
    line_discipline: LineDiscipline,
    xon_xoff: Option<XonXoffController>,
    event_tx: mpsc::Sender<SessionEvent>,
    bytes_rx: Arc<AtomicU64>,
    bytes_tx: Arc<AtomicU64>,
    connected: Arc<AtomicBool>,
    stats: SessionStats,
}

impl SessionRunner {
    fn new(
        transport: Arc<dyn SerialTransport>,
        config: SerialConfig,
        event_tx: mpsc::Sender<SessionEvent>,
        bytes_rx: Arc<AtomicU64>,
        bytes_tx: Arc<AtomicU64>,
        connected: Arc<AtomicBool>,
    ) -> Self {
        let line_discipline = LineDiscipline::new(config.line_ending, config.local_echo);
        let xon_xoff = if config.flow_control == FlowControl::XonXoff {
            Some(XonXoffController::new(
                config.rx_buffer_size * 3 / 4,
                config.rx_buffer_size / 4,
            ))
        } else {
            None
        };

        Self {
            transport,
            config,
            line_discipline,
            xon_xoff,
            event_tx,
            bytes_rx,
            bytes_tx,
            connected,
            stats: SessionStats::default(),
        }
    }

    /// Main session loop.
    async fn run(mut self, mut cmd_rx: mpsc::Receiver<SessionCommand>) {
        let mut read_buf = vec![0u8; self.config.rx_buffer_size];
        let read_interval = tokio::time::Duration::from_millis(self.config.read_timeout_ms.max(10));
        let mut control_check_interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
        let mut last_control_lines = ControlLines::default();

        loop {
            tokio::select! {
                // Read data from the port
                _ = tokio::time::sleep(read_interval) => {
                    if !self.connected.load(Ordering::SeqCst) {
                        break;
                    }
                    match self.transport.read(&mut read_buf).await {
                        Ok(0) => {},
                        Ok(n) => {
                            let mut data = Vec::with_capacity(n);
                            for &byte in &read_buf[..n] {
                                // XON/XOFF filtering
                                if let Some(ref xon_xoff) = self.xon_xoff {
                                    if xon_xoff.process_incoming(byte) {
                                        continue;
                                    }
                                }
                                data.push(byte);
                            }
                            if !data.is_empty() {
                                let count = data.len() as u64;
                                self.bytes_rx.fetch_add(count, Ordering::Relaxed);
                                self.stats.bytes_rx += count;
                                self.stats.frames_rx += 1;

                                let text = String::from_utf8_lossy(&data).to_string();
                                let _ = self.event_tx.send(SessionEvent::DataReceived {
                                    data,
                                    text,
                                }).await;
                            }
                        }
                        Err(e) => {
                            self.stats.errors_rx += 1;
                            let _ = self.event_tx.send(SessionEvent::Error {
                                message: e.clone(),
                                recoverable: true,
                            }).await;
                        }
                    }
                }

                // Process commands from the service
                Some(cmd) = cmd_rx.recv() => {
                    match cmd {
                        SessionCommand::SendRaw(data) => {
                            if let Err(e) = self.handle_send_raw(&data).await {
                                let _ = self.event_tx.send(SessionEvent::Error {
                                    message: e,
                                    recoverable: true,
                                }).await;
                            }
                        }
                        SessionCommand::SendLine(line) => {
                            let mut data = line.into_bytes();
                            self.line_discipline.append_line_ending(&mut data);
                            if let Err(e) = self.handle_send_raw(&data).await {
                                let _ = self.event_tx.send(SessionEvent::Error {
                                    message: e,
                                    recoverable: true,
                                }).await;
                            }
                        }
                        SessionCommand::SendChar(ch) => {
                            let (completed_line, echo) = self.line_discipline.process_byte(ch);
                            if !echo.is_empty() {
                                let _ = self.event_tx.send(SessionEvent::Echo(echo)).await;
                            }
                            if let Some(line) = completed_line {
                                let mut data = line;
                                self.line_discipline.append_line_ending(&mut data);
                                if let Err(e) = self.handle_send_raw(&data).await {
                                    let _ = self.event_tx.send(SessionEvent::Error {
                                        message: e,
                                        recoverable: true,
                                    }).await;
                                }
                            }
                        }
                        SessionCommand::SendBreak(duration) => {
                            if let Err(e) = self.transport.send_break(duration).await {
                                let _ = self.event_tx.send(SessionEvent::Error {
                                    message: e,
                                    recoverable: true,
                                }).await;
                            }
                            self.stats.break_count += 1;
                        }
                        SessionCommand::SetDtr(state) => {
                            let _ = self.transport.set_dtr(state).await;
                        }
                        SessionCommand::SetRts(state) => {
                            let _ = self.transport.set_rts(state).await;
                        }
                        SessionCommand::ReadControlLines(reply) => {
                            let result = self.transport.read_control_lines().await;
                            let _ = reply.send(result);
                        }
                        SessionCommand::Reconfigure(new_config) => {
                            if let Err(e) = self.transport.reconfigure(&new_config).await {
                                let _ = self.event_tx.send(SessionEvent::Error {
                                    message: format!("Reconfigure failed: {}", e),
                                    recoverable: true,
                                }).await;
                            } else {
                                self.config = new_config;
                                self.line_discipline.set_line_ending(self.config.line_ending);
                                self.line_discipline.set_local_echo(self.config.local_echo);
                            }
                        }
                        SessionCommand::SetLineEnding(le) => {
                            self.line_discipline.set_line_ending(le);
                        }
                        SessionCommand::SetLocalEcho(echo) => {
                            self.line_discipline.set_local_echo(echo);
                        }
                        SessionCommand::Flush => {
                            let _ = self.transport.flush().await;
                        }
                        SessionCommand::GetStats(reply) => {
                            let _start = self.stats.uptime_seconds;
                            // We don't have a real start time in stats, so calculate from connected_at if needed
                            self.stats.bytes_rx = self.bytes_rx.load(Ordering::Relaxed);
                            self.stats.bytes_tx = self.bytes_tx.load(Ordering::Relaxed);
                            let _ = reply.send(self.stats.clone());
                        }
                        SessionCommand::Disconnect => {
                            break;
                        }
                    }
                }

                // Periodic control line check
                _ = control_check_interval.tick() => {
                    if let Ok(cl) = self.transport.read_control_lines().await {
                        if cl != last_control_lines {
                            last_control_lines = cl;
                            let _ = self.event_tx.send(SessionEvent::ControlLineChange(cl)).await;
                        }
                    }
                }
            }
        }

        // Cleanup
        self.connected.store(false, Ordering::SeqCst);
        let _ = self.transport.close().await;
        let _ = self
            .event_tx
            .send(SessionEvent::Disconnected {
                reason: "Session ended".to_string(),
            })
            .await;
    }

    async fn handle_send_raw(&mut self, data: &[u8]) -> Result<(), String> {
        // Check XON/XOFF pause
        if let Some(ref xon_xoff) = self.xon_xoff {
            if xon_xoff.is_remote_paused() {
                return Err("Remote side has paused transmission (XOFF)".to_string());
            }
        }

        let n = if self.config.char_delay_ms > 0 {
            crate::serial::transport::write_with_char_delay(
                self.transport.as_ref(),
                data,
                self.config.char_delay_ms,
            )
            .await?
        } else {
            self.transport.write(data).await?
        };

        self.bytes_tx.fetch_add(n as u64, Ordering::Relaxed);
        self.stats.bytes_tx += n as u64;
        self.stats.frames_tx += 1;
        Ok(())
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session factory
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Create and start a new serial session.
///
/// Returns the session handle.  The session task runs in the background
/// and communicates via the command/event channels on the handle.
pub async fn create_session(
    id: String,
    transport: Arc<dyn SerialTransport>,
    config: SerialConfig,
) -> Result<Arc<SerialSessionHandle>, String> {
    // Open the transport
    transport.open(&config).await?;

    let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>(64);
    let (event_tx, event_rx) = mpsc::channel::<SessionEvent>(256);

    let connected = Arc::new(AtomicBool::new(true));
    let bytes_rx = Arc::new(AtomicU64::new(0));
    let bytes_tx = Arc::new(AtomicU64::new(0));

    let handle = Arc::new(SerialSessionHandle {
        id: id.clone(),
        port_name: config.port_name.clone(),
        transport: transport.clone(),
        cmd_tx,
        event_rx: Mutex::new(event_rx),
        connected: connected.clone(),
        config: RwLock::new(config.clone()),
        connected_at: Utc::now(),
        bytes_rx: bytes_rx.clone(),
        bytes_tx: bytes_tx.clone(),
    });

    let runner = SessionRunner::new(
        transport,
        config,
        event_tx,
        bytes_rx,
        bytes_tx,
        connected,
    );

    // Spawn the session task
    tokio::spawn(async move {
        runner.run(cmd_rx).await;
    });

    Ok(handle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::serial::transport::SimulatedTransport;

    #[tokio::test]
    async fn test_create_session_and_disconnect() {
        let transport = SimulatedTransport::new("COM1");
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            ..Default::default()
        };
        let handle = create_session("sess-1".to_string(), transport, config)
            .await
            .unwrap();
        assert!(handle.is_connected());

        handle
            .send_command(SessionCommand::Disconnect)
            .await
            .unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    }

    #[tokio::test]
    async fn test_session_send_raw() {
        let transport = SimulatedTransport::new("COM1");
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            ..Default::default()
        };
        let t = transport.clone();
        let handle = create_session("sess-2".to_string(), transport, config)
            .await
            .unwrap();

        handle
            .send_command(SessionCommand::SendRaw(b"hello".to_vec()))
            .await
            .unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let tx_data = t.drain_tx().await;
        assert_eq!(tx_data, b"hello");

        handle
            .send_command(SessionCommand::Disconnect)
            .await
            .unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }

    #[tokio::test]
    async fn test_session_send_line() {
        let transport = SimulatedTransport::new("COM1");
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            line_ending: LineEnding::CrLf,
            ..Default::default()
        };
        let t = transport.clone();
        let handle = create_session("sess-3".to_string(), transport, config)
            .await
            .unwrap();

        handle
            .send_command(SessionCommand::SendLine("AT".to_string()))
            .await
            .unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let tx_data = t.drain_tx().await;
        assert_eq!(tx_data, b"AT\r\n");

        handle
            .send_command(SessionCommand::Disconnect)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_session_receive_data() {
        let transport = SimulatedTransport::new("COM1");
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            read_timeout_ms: 20,
            ..Default::default()
        };
        let t = transport.clone();
        let handle = create_session("sess-4".to_string(), transport, config)
            .await
            .unwrap();

        t.inject_rx(b"world").await;
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        let mut rx = handle.event_rx.lock().await;
        let mut received = false;
        while let Ok(event) = rx.try_recv() {
            if let SessionEvent::DataReceived { text, .. } = event {
                if text.contains("world") {
                    received = true;
                }
            }
        }
        drop(rx);
        assert!(received, "Should have received 'world' data event");

        handle
            .send_command(SessionCommand::Disconnect)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_session_control_lines() {
        let transport = SimulatedTransport::new("COM1");
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            dtr_on_open: true,
            rts_on_open: true,
            ..Default::default()
        };
        let handle = create_session("sess-5".to_string(), transport, config)
            .await
            .unwrap();

        let (tx, rx) = oneshot::channel();
        handle
            .send_command(SessionCommand::ReadControlLines(tx))
            .await
            .unwrap();
        let cl = rx.await.unwrap().unwrap();
        assert!(cl.dtr);
        assert!(cl.rts);

        handle
            .send_command(SessionCommand::SetDtr(false))
            .await
            .unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        let (tx2, rx2) = oneshot::channel();
        handle
            .send_command(SessionCommand::ReadControlLines(tx2))
            .await
            .unwrap();
        let cl2 = rx2.await.unwrap().unwrap();
        assert!(!cl2.dtr);

        handle
            .send_command(SessionCommand::Disconnect)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_session_info() {
        let transport = SimulatedTransport::new("COM7");
        let config = SerialConfig {
            port_name: "COM7".to_string(),
            baud_rate: BaudRate::Baud115200,
            ..Default::default()
        };
        let handle = create_session("sess-6".to_string(), transport, config)
            .await
            .unwrap();

        let info = handle.info().await;
        assert_eq!(info.id, "sess-6");
        assert_eq!(info.port_name, "COM7");
        assert!(info.config_shorthand.contains("115200"));
        assert_eq!(info.state, SessionState::Connected);

        handle
            .send_command(SessionCommand::Disconnect)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_session_get_stats() {
        let transport = SimulatedTransport::new("COM1");
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            ..Default::default()
        };
        let t = transport.clone();
        let handle = create_session("sess-7".to_string(), transport, config)
            .await
            .unwrap();

        handle
            .send_command(SessionCommand::SendRaw(b"test".to_vec()))
            .await
            .unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let (tx, rx) = oneshot::channel();
        handle
            .send_command(SessionCommand::GetStats(tx))
            .await
            .unwrap();
        let stats = rx.await.unwrap();
        assert!(stats.bytes_tx >= 4);

        handle
            .send_command(SessionCommand::Disconnect)
            .await
            .unwrap();
    }
}
