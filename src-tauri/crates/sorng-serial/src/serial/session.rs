//! Serial session management.
//!
//! Each session wraps a `SerialTransport` and runs two independent tasks:
//!
//! * a **reader task** that continuously reads from the transport, filters
//!   XON/XOFF, decodes text incrementally (multi-byte safe) and emits
//!   `DataReceived` events; and
//! * a **writer / command task** (the `SessionRunner`) that drains the
//!   command queue, coalesces adjacent raw writes into one transport write
//!   and applies the write deadline to *execution*, not to queue wait.
//!
//! Because the two never wait on each other, a slow or blocking read can no
//! longer delay (or expire) a keystroke.

use crate::serial::transport::{LineDiscipline, SerialTransport, XonXoffController};
use crate::serial::types::*;
use chrono::Utc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};

/// Commands queued ahead of the writer before senders see backpressure.
const SESSION_COMMAND_QUEUE_CAPACITY: usize = 256;
const SESSION_EVENT_QUEUE_CAPACITY: usize = 64;
const MAX_CONSECUTIVE_READ_ERRORS: u32 = 3;
/// Upper bound for one coalesced transport write.
const MAX_COALESCED_WRITE_BYTES: usize = 4096;

/// A queued command is only dropped for age after sitting in the queue this
/// long (on top of its own write timeout).  This is a safety cap against a
/// wedged writer; ordinary bursts never reach it.
pub const QUEUE_AGE_CAP: std::time::Duration = std::time::Duration::from_secs(30);

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
//  Incremental UTF-8 decoding
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Decodes a byte stream into text, carrying an incomplete trailing
/// multi-byte sequence over to the next chunk instead of replacing it.
#[derive(Debug, Default)]
pub(crate) struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    pub(crate) fn decode(&mut self, chunk: &[u8]) -> String {
        let mut input = std::mem::take(&mut self.pending);
        input.extend_from_slice(chunk);
        let mut out = String::with_capacity(input.len());
        let mut rest: &[u8] = &input;
        loop {
            match std::str::from_utf8(rest) {
                Ok(valid) => {
                    out.push_str(valid);
                    break;
                }
                Err(error) => {
                    let (valid, after) = rest.split_at(error.valid_up_to());
                    out.push_str(&String::from_utf8_lossy(valid));
                    match error.error_len() {
                        Some(invalid) => {
                            out.push('\u{FFFD}');
                            rest = &after[invalid..];
                        }
                        None => {
                            // Incomplete sequence at the end of the chunk.
                            self.pending = after.to_vec();
                            break;
                        }
                    }
                }
            }
        }
        out
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session commands (frontend → session)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Commands that can be sent to a running session.
///
/// The `deadline` carried by write-type commands is the *queue-age safety
/// cap*: a command still queued past it is dropped with a distinct error.
/// The write itself is bounded separately by the session's
/// `write_timeout_ms`, measured from when execution starts.
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
    /// Whether `port_name` was chosen by the port resolver (auto selection)
    /// rather than typed by the user.
    pub auto_selected: bool,
    /// Friendly name of the resolved port (e.g. `COM7 - FTDI FT232R`), when
    /// the port was auto-selected from an enumeration.
    pub port_display_name: Option<String>,
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
            auto_selected: self.auto_selected,
            port_display_name: self.port_display_name.clone(),
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
//  Reader task
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// State shared between the reader task and the writer/command task.
struct ReaderShared {
    xon_xoff: std::sync::RwLock<Option<Arc<XonXoffController>>>,
    rx_buffer_size: AtomicUsize,
    frames_rx: AtomicU64,
    errors_rx: AtomicU64,
}

fn new_xon_xoff(config: &SerialConfig) -> Option<Arc<XonXoffController>> {
    if config.flow_control == FlowControl::XonXoff {
        Some(Arc::new(XonXoffController::new(
            config.rx_buffer_size.saturating_mul(3) / 4,
            config.rx_buffer_size / 4,
        )))
    } else {
        None
    }
}

struct ReaderTask {
    transport: Arc<dyn SerialTransport>,
    shared: Arc<ReaderShared>,
    event_tx: mpsc::Sender<SessionEvent>,
    bytes_rx: Arc<AtomicU64>,
    connected: Arc<AtomicBool>,
    errored: Arc<AtomicBool>,
}

impl ReaderTask {
    async fn run(self) {
        let mut buf = vec![0u8; self.shared.rx_buffer_size.load(Ordering::Relaxed).max(1)];
        let mut decoder = Utf8StreamDecoder::default();
        let mut consecutive_errors = 0u32;

        while self.connected.load(Ordering::SeqCst) {
            let wanted = self.shared.rx_buffer_size.load(Ordering::Relaxed).max(1);
            if buf.len() != wanted {
                buf.resize(wanted, 0);
            }
            let started = std::time::Instant::now();
            match self.transport.read(&mut buf).await {
                Ok(0) => {
                    // A well-behaved transport blocks for its read timeout;
                    // never spin if one returns immediately.
                    if started.elapsed() < std::time::Duration::from_millis(2) {
                        tokio::time::sleep(tokio::time::Duration::from_millis(2)).await;
                    }
                }
                Ok(n) => {
                    if n > buf.len() {
                        self.errored.store(true, Ordering::SeqCst);
                        self.connected.store(false, Ordering::SeqCst);
                        let _ = self
                            .event_tx
                            .send(SessionEvent::Error {
                                message: "Serial transport returned more bytes than requested"
                                    .to_string(),
                                recoverable: false,
                            })
                            .await;
                        return;
                    }
                    consecutive_errors = 0;
                    let xon_xoff = self
                        .shared
                        .xon_xoff
                        .read()
                        .ok()
                        .and_then(|guard| guard.clone());
                    let mut data = Vec::with_capacity(n);
                    for &byte in &buf[..n] {
                        if let Some(ref controller) = xon_xoff {
                            if controller.process_incoming(byte) {
                                continue;
                            }
                        }
                        data.push(byte);
                    }
                    if !data.is_empty() {
                        atomic_saturating_add(&self.bytes_rx, data.len() as u64);
                        atomic_saturating_add(&self.shared.frames_rx, 1);
                        let text = decoder.decode(&data);
                        if self
                            .event_tx
                            .send(SessionEvent::DataReceived { data, text })
                            .await
                            .is_err()
                        {
                            return;
                        }
                    }
                }
                Err(e) => {
                    if !self.connected.load(Ordering::SeqCst) {
                        return;
                    }
                    atomic_saturating_add(&self.shared.errors_rx, 1);
                    consecutive_errors = consecutive_errors.saturating_add(1);
                    let recoverable = consecutive_errors < MAX_CONSECUTIVE_READ_ERRORS;
                    if !recoverable {
                        self.errored.store(true, Ordering::SeqCst);
                        self.connected.store(false, Ordering::SeqCst);
                    }
                    let _ = self
                        .event_tx
                        .send(SessionEvent::Error {
                            message: bounded_error(e),
                            recoverable,
                        })
                        .await;
                    if !recoverable {
                        return;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                }
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session runner (writer / command task)
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
    shared: Arc<ReaderShared>,
    event_tx: mpsc::Sender<SessionEvent>,
    bytes_rx: Arc<AtomicU64>,
    bytes_tx: Arc<AtomicU64>,
    connected: Arc<AtomicBool>,
    errored: Arc<AtomicBool>,
    stats: SessionStats,
    started_at: std::time::Instant,
}

/// Whether the command loop should keep running.
enum Flow {
    Continue,
    Stop,
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
        let shared = Arc::new(ReaderShared {
            xon_xoff: std::sync::RwLock::new(new_xon_xoff(&config)),
            rx_buffer_size: AtomicUsize::new(config.rx_buffer_size),
            frames_rx: AtomicU64::new(0),
            errors_rx: AtomicU64::new(0),
        });

        Self {
            transport,
            config,
            config_metadata,
            line_discipline,
            shared,
            event_tx,
            bytes_rx,
            bytes_tx,
            connected,
            errored,
            stats: SessionStats::default(),
            started_at: std::time::Instant::now(),
        }
    }

    async fn emit_error(&self, message: String, recoverable: bool) {
        let _ = self
            .event_tx
            .send(SessionEvent::Error {
                message: bounded_error(message),
                recoverable,
            })
            .await;
    }

    /// Main session loop.
    async fn run(mut self, mut cmd_rx: mpsc::Receiver<SessionCommand>) {
        let mut reader = tokio::spawn(
            ReaderTask {
                transport: self.transport.clone(),
                shared: self.shared.clone(),
                event_tx: self.event_tx.clone(),
                bytes_rx: self.bytes_rx.clone(),
                connected: self.connected.clone(),
                errored: self.errored.clone(),
            }
            .run(),
        );
        let mut reader_done = false;
        let mut control_check_interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
        let mut last_control_lines = ControlLines::default();
        // A command read while coalescing that could not be merged.
        let mut pending: Option<SessionCommand> = None;

        loop {
            let cmd = match pending.take() {
                Some(cmd) => cmd,
                None => tokio::select! {
                    _ = &mut reader => {
                        reader_done = true;
                        break;
                    }
                    // Periodic control line check
                    _ = control_check_interval.tick() => {
                        if let Ok(cl) = self.transport.read_control_lines().await {
                            if cl != last_control_lines {
                                last_control_lines = cl;
                                let _ = self.event_tx.send(SessionEvent::ControlLineChange(cl)).await;
                            }
                        }
                        continue;
                    }
                    // Process commands from the service
                    cmd = cmd_rx.recv() => match cmd {
                        Some(cmd) => cmd,
                        None => break,
                    },
                },
            };
            if !self.connected.load(Ordering::SeqCst) {
                break;
            }
            if let Flow::Stop = self.handle_command(cmd, &mut cmd_rx, &mut pending).await {
                break;
            }
        }

        // Cleanup: stop the reader first so every received byte is delivered
        // before the Disconnected event.
        self.connected.store(false, Ordering::SeqCst);
        if !reader_done
            && tokio::time::timeout(tokio::time::Duration::from_millis(750), &mut reader)
                .await
                .is_err()
        {
            reader.abort();
        }
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

    /// Reject a command that sat in the queue past the age cap.
    fn queue_expired(&mut self, deadline: tokio::time::Instant) -> Option<String> {
        if tokio::time::Instant::now() >= deadline {
            self.stats.queue_expired = self.stats.queue_expired.saturating_add(1);
            Some(
                "Serial command dropped: it waited in the queue past the safety cap \
                 (the port is not accepting writes)"
                    .to_string(),
            )
        } else {
            None
        }
    }

    async fn handle_command(
        &mut self,
        cmd: SessionCommand,
        cmd_rx: &mut mpsc::Receiver<SessionCommand>,
        pending: &mut Option<SessionCommand>,
    ) -> Flow {
        match cmd {
            SessionCommand::SendRaw {
                data,
                deadline,
                completion,
            } => {
                let mut batch = data;
                let mut parts: Vec<oneshot::Sender<Result<(), String>>> = Vec::new();
                let mut expired: Vec<oneshot::Sender<Result<(), String>>> = Vec::new();
                match self.queue_expired(deadline) {
                    Some(_) => {
                        expired.push(completion);
                        batch.clear();
                    }
                    None => parts.push(completion),
                }
                // Coalesce adjacent raw writes into one transport write.
                // Per-character pacing is preserved by not merging when a
                // character delay is configured.
                if self.config.char_delay_ms == 0 {
                    while batch.len() < MAX_COALESCED_WRITE_BYTES {
                        match cmd_rx.try_recv() {
                            Ok(SessionCommand::SendRaw {
                                data,
                                deadline,
                                completion,
                            }) if batch.len() + data.len() <= MAX_COALESCED_WRITE_BYTES => {
                                if self.queue_expired(deadline).is_some() {
                                    expired.push(completion);
                                } else {
                                    batch.extend_from_slice(&data);
                                    parts.push(completion);
                                }
                            }
                            Ok(other) => {
                                *pending = Some(other);
                                break;
                            }
                            Err(_) => break,
                        }
                    }
                }
                for completion in expired {
                    let _ = completion.send(Err(
                        "Serial command dropped: it waited in the queue past the safety cap"
                            .to_string(),
                    ));
                    self.stats.errors_tx = self.stats.errors_tx.saturating_add(1);
                }
                if parts.is_empty() {
                    self.emit_error(
                        "Serial command dropped: it waited in the queue past the safety cap"
                            .to_string(),
                        true,
                    )
                    .await;
                    return Flow::Continue;
                }
                let result = self.execute_write(&batch).await;
                for completion in parts.drain(..) {
                    let _ = completion.send(result.clone());
                }
                match result {
                    Ok(()) if self.config.local_echo => {
                        let _ = self.event_tx.send(SessionEvent::Echo(batch)).await;
                    }
                    Ok(()) => {}
                    Err(e) => {
                        self.stats.errors_tx = self.stats.errors_tx.saturating_add(1);
                        self.emit_error(e, true).await;
                    }
                }
            }
            SessionCommand::SendLine {
                line,
                deadline,
                completion,
            } => {
                let result = if let Some(expired) = self.queue_expired(deadline) {
                    Err(expired)
                } else {
                    let mut data = line.into_bytes();
                    self.line_discipline.append_line_ending(&mut data);
                    self.execute_write(&data).await
                };
                let _ = completion.send(result.clone());
                if let Err(e) = result {
                    self.stats.errors_tx = self.stats.errors_tx.saturating_add(1);
                    self.emit_error(e, true).await;
                }
            }
            SessionCommand::SendChar {
                ch,
                deadline,
                completion,
            } => {
                let mut echo = Vec::new();
                let result = if let Some(expired) = self.queue_expired(deadline) {
                    Err(expired)
                } else {
                    let (completed_line, local_echo) = self.line_discipline.process_byte(ch);
                    echo = local_echo;
                    if let Some(line) = completed_line {
                        let mut data = line;
                        self.line_discipline.append_line_ending(&mut data);
                        self.execute_write(&data).await
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
                    self.emit_error(e, true).await;
                }
            }
            SessionCommand::SendBreak(duration) => {
                if let Err(e) = self.transport.send_break(duration).await {
                    self.stats.errors_tx = self.stats.errors_tx.saturating_add(1);
                    self.emit_error(e, true).await;
                } else {
                    self.stats.break_count = self.stats.break_count.saturating_add(1);
                }
            }
            SessionCommand::SetDtr(state) => {
                if let Err(e) = self.transport.set_dtr(state).await {
                    self.emit_error(e, true).await;
                }
            }
            SessionCommand::SetRts(state) => {
                if let Err(e) = self.transport.set_rts(state).await {
                    self.emit_error(e, true).await;
                }
            }
            SessionCommand::ReadControlLines(reply) => {
                let result = self.transport.read_control_lines().await;
                let _ = reply.send(result);
            }
            SessionCommand::Reconfigure {
                config: new_config,
                deadline: _,
                completion,
            } => {
                // The reconfigure budget runs from execution start; the
                // queue-age cap is not applied to it.
                let budget = tokio::time::Duration::from_millis(
                    new_config.write_timeout_ms.clamp(1, MAX_SERIAL_TIMEOUT_MS),
                );
                let result =
                    match tokio::time::timeout(budget, self.transport.reconfigure(&new_config))
                        .await
                    {
                        Ok(result) => result,
                        Err(_) => Err("Serial reconfigure timed out".to_string()),
                    };
                if result.is_ok() {
                    self.config = new_config;
                    self.line_discipline
                        .set_line_ending(self.config.line_ending);
                    self.line_discipline.set_local_echo(self.config.local_echo);
                    self.line_discipline.set_max_line_length(
                        self.config
                            .tx_buffer_size
                            .min(MAX_SERIAL_PAYLOAD_BYTES.saturating_sub(2)),
                    );
                    if let Ok(mut guard) = self.shared.xon_xoff.write() {
                        *guard = new_xon_xoff(&self.config);
                    }
                    self.shared
                        .rx_buffer_size
                        .store(self.config.rx_buffer_size, Ordering::Relaxed);
                    *self.config_metadata.write().await = self.config.clone();
                }
                let _ = completion.send(result.clone());
                if let Err(e) = result {
                    self.emit_error(format!("Reconfigure failed: {}", e), true)
                        .await;
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
                    self.emit_error(e, true).await;
                }
            }
            SessionCommand::GetStats(reply) => {
                self.stats.bytes_rx = self.bytes_rx.load(Ordering::Relaxed);
                self.stats.bytes_tx = self.bytes_tx.load(Ordering::Relaxed);
                self.stats.frames_rx = self.shared.frames_rx.load(Ordering::Relaxed);
                self.stats.errors_rx = self.shared.errors_rx.load(Ordering::Relaxed);
                self.stats.uptime_seconds = self.started_at.elapsed().as_secs();
                let _ = reply.send(self.stats.clone());
            }
            SessionCommand::Disconnect => return Flow::Stop,
        }
        Flow::Continue
    }

    async fn handle_send_raw(&mut self, data: &[u8]) -> Result<(), String> {
        if data.len() > MAX_SERIAL_PAYLOAD_BYTES {
            return Err(format!(
                "Serial write exceeds {} bytes",
                MAX_SERIAL_PAYLOAD_BYTES
            ));
        }
        // Check XON/XOFF pause
        let paused = self
            .shared
            .xon_xoff
            .read()
            .ok()
            .and_then(|guard| guard.clone())
            .map(|controller| controller.is_remote_paused())
            .unwrap_or(false);
        if paused {
            return Err("Remote side has paused transmission (XOFF)".to_string());
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

    /// Run one transport write under the write timeout.  The budget starts
    /// now (execution), plus the deliberate inter-character delay time.
    async fn execute_write(&mut self, data: &[u8]) -> Result<(), String> {
        let base = self.config.write_timeout_ms.clamp(1, MAX_SERIAL_TIMEOUT_MS);
        let paced = self.config.char_delay_ms.saturating_mul(data.len() as u64);
        let budget = tokio::time::Duration::from_millis(base.saturating_add(paced));
        match tokio::time::timeout(budget, self.handle_send_raw(data)).await {
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
    create_session_resolved(id, transport, config, false, None).await
}

/// Create and start a new serial session whose port was chosen by the
/// port resolver.
///
/// `config.port_name` must already hold the concrete resolved port;
/// `auto_selected` / `port_display_name` are carried into every
/// [`SerialSessionHandle::info`] snapshot so the frontend can show which
/// device an auto-selection ended up on.
pub async fn create_session_resolved(
    id: String,
    transport: Arc<dyn SerialTransport>,
    config: SerialConfig,
    auto_selected: bool,
    port_display_name: Option<String>,
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
        auto_selected,
        port_display_name,
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

    // ── Reader/writer split, latency and coalescing regressions ───────

    fn queue_cap_deadline() -> tokio::time::Instant {
        tokio::time::Instant::now() + QUEUE_AGE_CAP + tokio::time::Duration::from_secs(1)
    }

    async fn queue_raw(
        handle: &SerialSessionHandle,
        data: Vec<u8>,
    ) -> oneshot::Receiver<Result<(), String>> {
        let (completion, completed) = oneshot::channel();
        handle
            .send_command(SessionCommand::SendRaw {
                data,
                deadline: queue_cap_deadline(),
                completion,
            })
            .await
            .unwrap();
        completed
    }

    async fn stop(handle: &SerialSessionHandle) {
        let _ = handle.send_command(SessionCommand::Disconnect).await;
    }

    #[tokio::test]
    async fn slow_read_transport_does_not_delay_writes() {
        // Every read takes 100 ms (the old design serialized each write
        // behind such a read, so 200 keystrokes took tens of seconds and the
        // tail expired).
        let transport = SimulatedTransport::new("COM1");
        transport.set_read_delay_ms(100);
        let t = transport.clone();
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            write_timeout_ms: 1000,
            ..Default::default()
        };
        let handle = create_session("slow-read".to_string(), transport, config)
            .await
            .unwrap();

        let started = std::time::Instant::now();
        let mut completions = Vec::new();
        for i in 0..200u32 {
            completions.push(queue_raw(&handle, vec![(i % 251) as u8]).await);
        }
        for completed in completions {
            completed
                .await
                .unwrap()
                .expect("no keystroke may fail or expire");
        }
        let elapsed = started.elapsed();
        assert!(
            elapsed < std::time::Duration::from_millis(900),
            "200 queued writes took {elapsed:?} with a 100 ms read in flight"
        );

        let expected: Vec<u8> = (0..200u32).map(|i| (i % 251) as u8).collect();
        assert_eq!(t.drain_tx().await, expected, "ordered, nothing lost");
        stop(&handle).await;
    }

    #[tokio::test]
    async fn a_burst_of_queued_writes_does_not_expire() {
        // Each non-coalescible SendLine takes 15 ms to execute; 120 of them
        // queue for ~1.8 s, far past the 1 s write timeout.  The timeout
        // applies to execution, so none may fail.
        let transport = SimulatedTransport::new("COM1");
        transport.set_write_delay_ms(15);
        let t = transport.clone();
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            write_timeout_ms: 1000,
            line_ending: LineEnding::Lf,
            ..Default::default()
        };
        let handle = create_session("burst".to_string(), transport, config)
            .await
            .unwrap();

        let mut completions = Vec::new();
        for i in 0..120u32 {
            let (completion, completed) = oneshot::channel();
            handle
                .send_command(SessionCommand::SendLine {
                    line: format!("L{i}"),
                    deadline: queue_cap_deadline(),
                    completion,
                })
                .await
                .unwrap();
            completions.push(completed);
        }
        for completed in completions {
            let result = completed.await.unwrap();
            assert!(result.is_ok(), "queued command failed: {result:?}");
        }
        let expected: String = (0..120u32).map(|i| format!("L{i}\n")).collect();
        assert_eq!(String::from_utf8(t.drain_tx().await).unwrap(), expected);

        let (tx, rx) = oneshot::channel();
        handle
            .send_command(SessionCommand::GetStats(tx))
            .await
            .unwrap();
        assert_eq!(rx.await.unwrap().queue_expired, 0);
        stop(&handle).await;
    }

    #[tokio::test]
    async fn adjacent_raw_writes_are_coalesced_in_order() {
        let transport = SimulatedTransport::new("COM1");
        // The first write blocks the writer while the rest queue up.
        transport.set_write_delay_ms(80);
        let t = transport.clone();
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            ..Default::default()
        };
        let handle = create_session("coalesce".to_string(), transport, config)
            .await
            .unwrap();

        let mut completions = Vec::new();
        for i in 0..100u8 {
            completions.push(queue_raw(&handle, vec![b'a' + (i % 26)]).await);
        }
        for completed in completions {
            completed.await.unwrap().unwrap();
        }
        let expected: Vec<u8> = (0..100u8).map(|i| b'a' + (i % 26)).collect();
        assert_eq!(t.drain_tx().await, expected);
        assert!(
            t.write_calls() <= 10,
            "100 queued single-byte writes should coalesce, got {} transport writes",
            t.write_calls()
        );
        stop(&handle).await;
    }

    #[tokio::test]
    async fn a_hung_write_still_times_out_from_execution_start() {
        let transport = SimulatedTransport::new("COM1");
        transport.set_write_delay_ms(400);
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            write_timeout_ms: 50,
            ..Default::default()
        };
        let handle = create_session("hung".to_string(), transport, config)
            .await
            .unwrap();
        let completed = queue_raw(&handle, b"x".to_vec()).await;
        let error = completed.await.unwrap().unwrap_err();
        assert!(error.contains("timed out"), "unexpected error: {error}");
        stop(&handle).await;
    }

    #[tokio::test]
    async fn only_the_queue_age_cap_drops_commands_with_a_distinct_error() {
        let transport = SimulatedTransport::new("COM1");
        let t = transport.clone();
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            ..Default::default()
        };
        let handle = create_session("cap".to_string(), transport, config)
            .await
            .unwrap();

        let (completion, completed) = oneshot::channel();
        handle
            .send_command(SessionCommand::SendRaw {
                data: b"stale".to_vec(),
                deadline: tokio::time::Instant::now(),
                completion,
            })
            .await
            .unwrap();
        let error = completed.await.unwrap().unwrap_err();
        assert!(error.contains("queue"), "unexpected error: {error}");
        assert!(!error.contains("expired before execution"));

        // A fresh command still goes through.
        queue_raw(&handle, b"fresh".to_vec())
            .await
            .await
            .unwrap()
            .unwrap();
        assert_eq!(t.drain_tx().await, b"fresh");

        let (tx, rx) = oneshot::channel();
        handle
            .send_command(SessionCommand::GetStats(tx))
            .await
            .unwrap();
        assert_eq!(rx.await.unwrap().queue_expired, 1);
        stop(&handle).await;
    }

    #[tokio::test]
    async fn send_char_does_not_expire_behind_a_slow_read() {
        let transport = SimulatedTransport::new("COM1");
        transport.set_read_delay_ms(100);
        let t = transport.clone();
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            line_ending: LineEnding::Cr,
            ..Default::default()
        };
        let handle = create_session("chars".to_string(), transport, config)
            .await
            .unwrap();
        let mut completions = Vec::new();
        for ch in b"hello\r".iter().copied() {
            let (completion, completed) = oneshot::channel();
            handle
                .send_command(SessionCommand::SendChar {
                    ch,
                    deadline: queue_cap_deadline(),
                    completion,
                })
                .await
                .unwrap();
            completions.push(completed);
        }
        for completed in completions {
            completed.await.unwrap().unwrap();
        }
        assert_eq!(t.drain_tx().await, b"hello\r");
        stop(&handle).await;
    }

    #[tokio::test]
    async fn multibyte_text_split_across_reads_is_decoded_intact() {
        let transport = SimulatedTransport::new("COM1");
        let t = transport.clone();
        let config = SerialConfig {
            port_name: "COM1".to_string(),
            ..Default::default()
        };
        let handle = create_session("utf8".to_string(), transport, config)
            .await
            .unwrap();

        // U+20AC (euro sign) = E2 82 AC, delivered one byte at a time.
        for byte in [0xE2u8, 0x82, 0xAC] {
            t.inject_rx(&[byte]).await;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
        }
        let mut text = String::new();
        let mut raw = Vec::new();
        {
            let mut rx = handle.event_rx.lock().await;
            while let Ok(event) = rx.try_recv() {
                if let SessionEvent::DataReceived { data, text: chunk } = event {
                    raw.extend(data);
                    text.push_str(&chunk);
                }
            }
        }
        assert_eq!(raw, vec![0xE2, 0x82, 0xAC]);
        assert_eq!(text, "\u{20AC}");
        stop(&handle).await;
    }

    #[test]
    fn utf8_stream_decoder_handles_split_invalid_and_ascii() {
        let mut decoder = Utf8StreamDecoder::default();
        assert_eq!(decoder.decode(b"abc"), "abc");
        assert_eq!(decoder.decode(&[0xF0, 0x9F]), "");
        assert_eq!(decoder.decode(&[0x98, 0x80, b'!']), "\u{1F600}!");
        // An invalid byte becomes a replacement char without eating the rest.
        assert_eq!(decoder.decode(&[0xFF, b'o', b'k']), "\u{FFFD}ok");
        // A truncated sequence followed by an ASCII byte is replaced, not held.
        assert_eq!(decoder.decode(&[0xE2, b'x']), "\u{FFFD}x");
    }
}
