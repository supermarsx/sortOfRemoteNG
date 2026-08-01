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

const SESSION_COMMAND_QUEUE_CAPACITY: usize = 32;
const SESSION_EVENT_QUEUE_CAPACITY: usize = 64;
const MAX_CONSECUTIVE_READ_ERRORS: u32 = 3;

fn atomic_saturating_add(counter: &AtomicU64, value: u64) {
    let _ = counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
        Some(current.saturating_add(value))
    });
}

fn bounded_error(mut message: String) -> String {
    if message.len() > MAX_SERIAL_ERROR_BYTES {
        let mut end = MAX_SERIAL_ERROR_BYTES;
        while !message.is_char_boundary(end) {
            end -= 1;
        }
        message.truncate(end);
    }
    message
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session commands (frontend → session)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Commands that can be sent to a running session.
#[derive(Debug)]
pub enum SessionCommand {
    /// Send raw bytes to the port.
    SendRaw {
        data: Vec<u8>,
        deadline: tokio::time::Instant,
        completion: oneshot::Sender<Result<(), String>>,
    },
    /// Send a string with line ending appended.
    SendLine {
        line: String,
        deadline: tokio::time::Instant,
        completion: oneshot::Sender<Result<(), String>>,
    },
    /// Send a single character (for interactive terminal).
    SendChar {
        ch: u8,
        deadline: tokio::time::Instant,
        completion: oneshot::Sender<Result<(), String>>,
    },
    /// Send a break signal.
    SendBreak(u32),
    /// Set DTR line.
    SetDtr(bool),
    /// Set RTS line.
    SetRts(bool),
    /// Read control lines (response via oneshot).
    ReadControlLines(oneshot::Sender<Result<ControlLines, String>>),
    /// Reconfigure the port on the fly.
    Reconfigure {
        config: SerialConfig,
        deadline: tokio::time::Instant,
        completion: oneshot::Sender<Result<(), String>>,
    },
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
    DataReceived { data: Vec<u8>, text: String },
    /// Echo data for local display.
    Echo(Vec<u8>),
    /// Error occurred.
    Error { message: String, recoverable: bool },
    /// Control lines changed.
    ControlLineChange(ControlLines),
    /// Session disconnected.
    Disconnected { reason: String },
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
    /// Whether the session stopped because the transport failed.
    pub errored: Arc<AtomicBool>,
    /// Config used to open the session.
    pub config: Arc<RwLock<SerialConfig>>,
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
        let config = self.config.read().await.clone();
        let connected = self.connected.load(Ordering::SeqCst) && self.transport.is_open();
        let state = if self.errored.load(Ordering::SeqCst) {
            SessionState::Error
        } else if connected {
            SessionState::Connected
        } else {
            SessionState::Disconnected
        };
        let cl = if connected {
            self.transport
                .read_control_lines()
                .await
                .unwrap_or_default()
        } else {
            ControlLines::default()
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
            && !self.errored.load(Ordering::SeqCst)
            && self.transport.is_open()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session runner (async task)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Internal state for the session task.
struct SessionRunnerContext {
    config_metadata: Arc<RwLock<SerialConfig>>,
    event_tx: mpsc::Sender<SessionEvent>,
    bytes_rx: Arc<AtomicU64>,
    bytes_tx: Arc<AtomicU64>,
    connected: Arc<AtomicBool>,
    errored: Arc<AtomicBool>,
}

struct SessionRunner {
    transport: Arc<dyn SerialTransport>,
    config: SerialConfig,
    config_metadata: Arc<RwLock<SerialConfig>>,
    line_discipline: LineDiscipline,
    xon_xoff: Option<XonXoffController>,
    event_tx: mpsc::Sender<SessionEvent>,
    bytes_rx: Arc<AtomicU64>,
    bytes_tx: Arc<AtomicU64>,
    connected: Arc<AtomicBool>,
    errored: Arc<AtomicBool>,
    stats: SessionStats,
    started_at: std::time::Instant,
}

impl SessionRunner {
    fn new(
        transport: Arc<dyn SerialTransport>,
        config: SerialConfig,
        context: SessionRunnerContext,
    ) -> Self {
        let SessionRunnerContext {
            config_metadata,
            event_tx,
            bytes_rx,
            bytes_tx,
            connected,
            errored,
        } = context;

        let mut line_discipline = LineDiscipline::new(config.line_ending, config.local_echo);
        line_discipline.set_max_line_length(
            config
                .tx_buffer_size
                .min(MAX_SERIAL_PAYLOAD_BYTES.saturating_sub(2)),
        );
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
            config_metadata,
            line_discipline,
            xon_xoff,
            event_tx,
            bytes_rx,
            bytes_tx,
            connected,
            errored,
            stats: SessionStats::default(),
            started_at: std::time::Instant::now(),
        }
    }

    /// Main session loop.
    async fn run(mut self, mut cmd_rx: mpsc::Receiver<SessionCommand>) {
        let mut read_buf = vec![0u8; self.config.rx_buffer_size];
        let mut read_interval =
            tokio::time::Duration::from_millis(self.config.read_timeout_ms.max(10));
        let mut control_check_interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
        let mut last_control_lines = ControlLines::default();
        let mut consecutive_read_errors = 0u32;

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
                            if n > read_buf.len() {
                                self.errored.store(true, Ordering::SeqCst);
                                self.connected.store(false, Ordering::SeqCst);
                                let _ = self.event_tx.send(SessionEvent::Error {
                                    message: "Serial transport returned more bytes than requested".to_string(),
                                    recoverable: false,
                                }).await;
                                break;
                            }
                            consecutive_read_errors = 0;
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
                                atomic_saturating_add(&self.bytes_rx, count);
                                self.stats.bytes_rx = self.stats.bytes_rx.saturating_add(count);
                                self.stats.frames_rx = self.stats.frames_rx.saturating_add(1);

                                let text = String::from_utf8_lossy(&data).to_string();
                                let _ = self.event_tx.send(SessionEvent::DataReceived {
                                    data,
                                    text,
                                }).await;
                            }
                        }
                        Err(e) => {
                            self.stats.errors_rx = self.stats.errors_rx.saturating_add(1);
                            consecutive_read_errors = consecutive_read_errors.saturating_add(1);
                            let recoverable =
                                consecutive_read_errors < MAX_CONSECUTIVE_READ_ERRORS;
                            if !recoverable {
                                self.errored.store(true, Ordering::SeqCst);
                                self.connected.store(false, Ordering::SeqCst);
                            }
                            let _ = self.event_tx.send(SessionEvent::Error {
                                message: bounded_error(e),
                                recoverable,
                            }).await;
                            if !recoverable {
                                break;
                            }
                        }
                    }
                }

                // Process commands from the service
                Some(cmd) = cmd_rx.recv() => {
                    match cmd {
                        SessionCommand::SendRaw {
                            data,
                            deadline,
                            completion,
                        } => {
                            let result = self.handle_send_raw_until(&data, deadline).await;
                            let _ = completion.send(result.clone());
                            match result {
                                Ok(()) if self.config.local_echo => {
                                    let _ = self.event_tx.send(SessionEvent::Echo(data)).await;
                                }
                                Ok(()) => {}
                                Err(e) => {
                                    self.stats.errors_tx = self.stats.errors_tx.saturating_add(1);
                                    let _ = self.event_tx.send(SessionEvent::Error {
                                        message: bounded_error(e),
                                        recoverable: true,
                                    }).await;
                                }
                            }
                        }
                        SessionCommand::SendLine {
                            line,
                            deadline,
                            completion,
                        } => {
                            let mut data = line.into_bytes();
                            self.line_discipline.append_line_ending(&mut data);
                            let result = self.handle_send_raw_until(&data, deadline).await;
                            let _ = completion.send(result.clone());
                            if let Err(e) = result {
                                self.stats.errors_tx = self.stats.errors_tx.saturating_add(1);
                                let _ = self.event_tx.send(SessionEvent::Error {
                                    message: bounded_error(e),
                                    recoverable: true,
                                }).await;
                            }
                        }
                        SessionCommand::SendChar {
                            ch,
                            deadline,
                            completion,
                        } => {
                            let mut echo = Vec::new();
                            let result = if tokio::time::Instant::now() >= deadline {
                                Err("Serial command expired before execution".to_string())
                            } else {
                                let (completed_line, local_echo) =
                                    self.line_discipline.process_byte(ch);
                                echo = local_echo;
                                if let Some(line) = completed_line {
                                    let mut data = line;
                                    self.line_discipline.append_line_ending(&mut data);
                                    self.handle_send_raw_until(&data, deadline).await
                                } else {
                                    Ok(())
                                }
                            };
                            let _ = completion.send(result.clone());
                            if result.is_ok() && !echo.is_empty() {
                                let _ = self.event_tx.send(SessionEvent::Echo(echo)).await;
                            }
                            if let Err(e) = result {
                                    self.stats.errors_tx = self.stats.errors_tx.saturating_add(1);
                                    let _ = self.event_tx.send(SessionEvent::Error {
                                        message: bounded_error(e),
                                        recoverable: true,
                                    }).await;
                            }
                        }
                        SessionCommand::SendBreak(duration) => {
                            if let Err(e) = self.transport.send_break(duration).await {
                                self.stats.errors_tx = self.stats.errors_tx.saturating_add(1);
                                let _ = self.event_tx.send(SessionEvent::Error {
                                    message: bounded_error(e),
                                    recoverable: true,
                                }).await;
                            } else {
                                self.stats.break_count = self.stats.break_count.saturating_add(1);
                            }
                        }
                        SessionCommand::SetDtr(state) => {
                            if let Err(e) = self.transport.set_dtr(state).await {
                                let _ = self.event_tx.send(SessionEvent::Error {
                                    message: bounded_error(e),
                                    recoverable: true,
                                }).await;
                            }
                        }
                        SessionCommand::SetRts(state) => {
                            if let Err(e) = self.transport.set_rts(state).await {
                                let _ = self.event_tx.send(SessionEvent::Error {
                                    message: bounded_error(e),
                                    recoverable: true,
                                }).await;
                            }
                        }
                        SessionCommand::ReadControlLines(reply) => {
                            let result = self.transport.read_control_lines().await;
                            let _ = reply.send(result);
                        }
                        SessionCommand::Reconfigure {
                            config: new_config,
                            deadline,
                            completion,
                        } => {
                            let result = match tokio::time::timeout_at(
                                deadline,
                                self.transport.reconfigure(&new_config),
                            )
                            .await
                            {
                                Ok(result) => result,
                                Err(_) => Err("Serial reconfigure timed out".to_string()),
                            };
                            if result.is_ok() {
                                self.config = new_config;
                                self.line_discipline.set_line_ending(self.config.line_ending);
                                self.line_discipline.set_local_echo(self.config.local_echo);
                                self.line_discipline.set_max_line_length(
                                    self.config
                                        .tx_buffer_size
                                        .min(MAX_SERIAL_PAYLOAD_BYTES.saturating_sub(2)),
                                );
                                self.xon_xoff =
                                    if self.config.flow_control == FlowControl::XonXoff {
                                        Some(XonXoffController::new(
                                            self.config.rx_buffer_size.saturating_mul(3) / 4,
                                            self.config.rx_buffer_size / 4,
                                        ))
                                    } else {
                                        None
                                    };
                                read_buf.resize(self.config.rx_buffer_size, 0);
                                read_interval = tokio::time::Duration::from_millis(
                                    self.config.read_timeout_ms.max(10),
                                );
                                *self.config_metadata.write().await = self.config.clone();
                            }
                            let _ = completion.send(result.clone());
                            if let Err(e) = result {
                                let _ = self.event_tx.send(SessionEvent::Error {
                                    message: bounded_error(format!("Reconfigure failed: {}", e)),
                                    recoverable: true,
                                }).await;
                            }
                        }
                        SessionCommand::SetLineEnding(le) => {
                            self.config.line_ending = le;
                            self.line_discipline.set_line_ending(le);
                            *self.config_metadata.write().await = self.config.clone();
                        }
                        SessionCommand::SetLocalEcho(echo) => {
                            self.config.local_echo = echo;
                            self.line_discipline.set_local_echo(echo);
                            *self.config_metadata.write().await = self.config.clone();
                        }
                        SessionCommand::Flush => {
                            if let Err(e) = self.transport.flush().await {
                                let _ = self.event_tx.send(SessionEvent::Error {
                                    message: bounded_error(e),
                                    recoverable: true,
                                }).await;
                            }
                        }
                        SessionCommand::GetStats(reply) => {
                            self.stats.bytes_rx = self.bytes_rx.load(Ordering::Relaxed);
                            self.stats.bytes_tx = self.bytes_tx.load(Ordering::Relaxed);
                            self.stats.uptime_seconds = self.started_at.elapsed().as_secs();
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
        if self.transport.close().await.is_err() {
            self.errored.store(true, Ordering::SeqCst);
        }
        let reason = if self.errored.load(Ordering::SeqCst) {
            "Session ended after a serial transport error"
        } else {
            "Session ended"
        };
        let _ = self
            .event_tx
            .send(SessionEvent::Disconnected {
                reason: reason.to_string(),
            })
            .await;
    }

    async fn handle_send_raw(&mut self, data: &[u8]) -> Result<(), String> {
        if data.len() > MAX_SERIAL_PAYLOAD_BYTES {
            return Err(format!(
                "Serial write exceeds {} bytes",
                MAX_SERIAL_PAYLOAD_BYTES
            ));
        }
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

        if n != data.len() {
            return Err(format!(
                "Serial transport accepted {} of {} bytes",
                n,
                data.len()
            ));
        }
        atomic_saturating_add(&self.bytes_tx, n as u64);
        self.stats.bytes_tx = self.stats.bytes_tx.saturating_add(n as u64);
        self.stats.frames_tx = self.stats.frames_tx.saturating_add(1);
        Ok(())
    }

    async fn handle_send_raw_until(
        &mut self,
        data: &[u8],
        deadline: tokio::time::Instant,
    ) -> Result<(), String> {
        if tokio::time::Instant::now() >= deadline {
            return Err("Serial command expired before execution".to_string());
        }
        match tokio::time::timeout_at(deadline, self.handle_send_raw(data)).await {
            Ok(result) => result,
            Err(_) => Err("Serial write timed out".to_string()),
        }
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
    config.validate()?;
    // Open the transport
    transport.open(&config).await?;

    let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>(SESSION_COMMAND_QUEUE_CAPACITY);
    let (event_tx, event_rx) = mpsc::channel::<SessionEvent>(SESSION_EVENT_QUEUE_CAPACITY);

    let connected = Arc::new(AtomicBool::new(true));
    let errored = Arc::new(AtomicBool::new(false));
    let bytes_rx = Arc::new(AtomicU64::new(0));
    let bytes_tx = Arc::new(AtomicU64::new(0));
    let config_metadata = Arc::new(RwLock::new(config.clone()));

    let handle = Arc::new(SerialSessionHandle {
        id: id.clone(),
        port_name: config.port_name.clone(),
        transport: transport.clone(),
        cmd_tx,
        event_rx: Mutex::new(event_rx),
        connected: connected.clone(),
        errored: errored.clone(),
        config: config_metadata.clone(),
        connected_at: Utc::now(),
        bytes_rx: bytes_rx.clone(),
        bytes_tx: bytes_tx.clone(),
    });

    let runner = SessionRunner::new(
        transport,
        config,
        SessionRunnerContext {
            config_metadata,
            event_tx,
            bytes_rx,
            bytes_tx,
            connected,
            errored,
        },
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

        let (completion, completed) = oneshot::channel();
        handle
            .send_command(SessionCommand::SendRaw {
                data: b"hello".to_vec(),
                deadline: tokio::time::Instant::now() + tokio::time::Duration::from_secs(1),
                completion,
            })
            .await
            .unwrap();
        completed.await.unwrap().unwrap();

        let tx_data = t.drain_tx().await;
        assert_eq!(tx_data, b"hello");

        let mut rx = handle.event_rx.lock().await;
        let echo_count = std::iter::from_fn(|| rx.try_recv().ok())
            .filter(|event| matches!(event, SessionEvent::Echo(_)))
            .count();
        drop(rx);
        assert_eq!(echo_count, 0, "local echo is disabled by default");

        handle
            .send_command(SessionCommand::Disconnect)
            .await
            .unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }

    #[tokio::test]
    async fn test_session_send_raw_emits_one_echo_after_successful_write() {
        let transport = SimulatedTransport::new("COM1");
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            local_echo: true,
            ..Default::default()
        };
        let t = transport.clone();
        let handle = create_session("sess-raw-echo".to_string(), transport, config)
            .await
            .unwrap();

        let (completion, completed) = oneshot::channel();
        handle
            .send_command(SessionCommand::SendRaw {
                data: b"hello".to_vec(),
                deadline: tokio::time::Instant::now() + tokio::time::Duration::from_secs(1),
                completion,
            })
            .await
            .unwrap();
        completed.await.unwrap().unwrap();

        // The runner emits Echo only from the successful write branch.
        assert_eq!(t.drain_tx().await, b"hello");
        let mut rx = handle.event_rx.lock().await;
        let echoes: Vec<Vec<u8>> = std::iter::from_fn(|| rx.try_recv().ok())
            .filter_map(|event| match event {
                SessionEvent::Echo(data) => Some(data),
                _ => None,
            })
            .collect();
        drop(rx);
        assert_eq!(echoes, vec![b"hello".to_vec()]);

        handle
            .send_command(SessionCommand::Disconnect)
            .await
            .unwrap();
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

        let (completion, completed) = oneshot::channel();
        handle
            .send_command(SessionCommand::SendLine {
                line: "AT".to_string(),
                deadline: tokio::time::Instant::now() + tokio::time::Duration::from_secs(1),
                completion,
            })
            .await
            .unwrap();
        completed.await.unwrap().unwrap();

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
        let _t = transport.clone();
        let handle = create_session("sess-7".to_string(), transport, config)
            .await
            .unwrap();

        let (completion, completed) = oneshot::channel();
        handle
            .send_command(SessionCommand::SendRaw {
                data: b"test".to_vec(),
                deadline: tokio::time::Instant::now() + tokio::time::Duration::from_secs(1),
                completion,
            })
            .await
            .unwrap();
        completed.await.unwrap().unwrap();

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
