//! Per-connection telnet session with async I/O, negotiation, and keep-alive.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex, Notify};
use tokio::time::timeout;

use crate::telnet::codec::TelnetCodec;
use crate::telnet::negotiation::NegotiationManager;
use crate::telnet::protocol::{self, TelnetFrame, NOP, SN_SEND};
use crate::telnet::types::*;

pub(crate) const MAX_COMMAND_BYTES: usize = 256 * 1024;
pub(crate) const COMMAND_QUEUE_DEPTH: usize = 16;
const IO_TIMEOUT: Duration = Duration::from_secs(30);
const TERMINAL_EVENT_TIMEOUT: Duration = Duration::from_secs(1);

fn saturating_add(counter: &AtomicU64, amount: u64) {
    let _ = counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
        Some(current.saturating_add(amount))
    });
}

// ── Internal messages sent from the session read-loop to the service ────

/// Events produced by a session's read loop.
#[derive(Debug)]
pub enum SessionEvent {
    /// Decoded data ready for the frontend.
    Data(String),
    /// A protocol error or I/O error.
    Error(String),
    /// Session was closed (normal or abnormal).
    Closed(String),
    /// Negotiation event for diagnostic display.
    Negotiation {
        direction: String,
        command: String,
        option: String,
    },
    /// Raw bytes that should be written back to the socket (e.g. negotiation responses).
    WriteBack(Vec<u8>),
}

/// Commands sent *to* a session's write-loop.
#[derive(Debug)]
pub enum SessionCommand {
    /// Send raw bytes.
    SendRaw(Vec<u8>),
    /// Send a text line (will be encoded with the session's line-ending mode).
    SendLine(String),
    /// Resize the terminal.
    Resize { cols: u16, rows: u16 },
    /// Send a break signal (IAC BRK).
    Break,
    /// Send Are-You-There (IAC AYT).
    AreYouThere,
    /// Graceful disconnect.
    Disconnect,
}

/// A handle to a running telnet session.
pub struct TelnetSessionHandle {
    /// Unique session id.
    pub id: String,
    /// Configuration used to create the session.
    pub config: TelnetConfig,
    /// Channel to send commands to the session.
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    /// Channel to receive events from the session.
    pub event_rx: Mutex<mpsc::Receiver<SessionEvent>>,
    /// Whether the session is still connected.
    pub connected: Arc<AtomicBool>,
    /// Bytes received counter.
    pub bytes_received: Arc<AtomicU64>,
    /// Bytes sent counter.
    pub bytes_sent: Arc<AtomicU64>,
    /// Timestamp (epoch millis) of session creation.
    pub connected_at: i64,
    /// Timestamp (epoch millis) of last activity.
    pub last_activity: Arc<AtomicU64>,
    /// Reconnect counter.
    pub reconnect_count: Arc<AtomicU64>,
    /// Wakes both I/O loops when the service disconnects the session.
    pub shutdown: Arc<Notify>,
}

impl TelnetSessionHandle {
    /// Build a [`TelnetSession`] metadata snapshot from this handle.
    pub fn to_session_info(&self) -> TelnetSession {
        TelnetSession {
            id: self.id.clone(),
            host: self.config.host.clone(),
            port: self.config.port,
            connected: self.connected.load(Ordering::Relaxed),
            username: self.config.username.clone(),
            label: self.config.label.clone(),
            connected_at: chrono::DateTime::from_timestamp_millis(self.connected_at)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default(),
            last_activity: chrono::DateTime::from_timestamp_millis(
                self.last_activity.load(Ordering::Relaxed) as i64,
            )
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_default(),
            bytes_received: self.bytes_received.load(Ordering::Relaxed),
            bytes_sent: self.bytes_sent.load(Ordering::Relaxed),
            terminal_type: self.config.terminal_type.clone(),
            window_cols: self.config.cols,
            window_rows: self.config.rows,
            reconnect_count: self
                .reconnect_count
                .load(Ordering::Relaxed)
                .min(u32::MAX as u64) as u32,
        }
    }
}

/// Connect to a telnet server and spawn async read/write loops.
///
/// Returns: `(TelnetSessionHandle)` on success, or a `TelnetError`.
pub async fn connect(id: String, config: TelnetConfig) -> Result<TelnetSessionHandle, TelnetError> {
    config.validate()?;
    let addr = format!("{}:{}", config.host, config.port);
    log::warn!(
        "[telnet:{}] opening explicitly acknowledged plaintext connection to {}",
        id,
        addr
    );

    let stream = timeout(
        Duration::from_secs(config.connect_timeout_secs),
        TcpStream::connect((config.host.as_str(), config.port)),
    )
    .await
    .map_err(|_| {
        TelnetError::timeout(format!(
            "Connection to {} timed out after {}s",
            addr, config.connect_timeout_secs
        ))
    })?
    .map_err(TelnetError::from)?;

    log::info!("[telnet:{}] TCP connected to {}", id, addr);

    let (read_half, write_half) = stream.into_split();

    let (event_tx, event_rx) = mpsc::channel::<SessionEvent>(256);
    let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>(COMMAND_QUEUE_DEPTH);

    let connected = Arc::new(AtomicBool::new(true));
    let bytes_received = Arc::new(AtomicU64::new(0));
    let bytes_sent = Arc::new(AtomicU64::new(0));
    let now_millis = chrono::Utc::now().timestamp_millis();
    let last_activity = Arc::new(AtomicU64::new(now_millis as u64));
    let reconnect_count = Arc::new(AtomicU64::new(0));
    let shutdown = Arc::new(Notify::new());

    // Build negotiation manager with desired/accepted options.
    let mut negotiation = NegotiationManager::new();

    // We want to tell the server our terminal type and window size.
    negotiation.desire_local(TelnetOption::TerminalType as u8);
    negotiation.desire_local(TelnetOption::NAWS as u8);
    if config.suppress_go_ahead {
        negotiation.desire_local(TelnetOption::SuppressGoAhead as u8);
    }
    if config.binary_mode {
        negotiation.desire_local(TelnetOption::BinaryTransmission as u8);
    }

    // Accept the server enabling Echo and SGA on its side.
    negotiation.accept_remote(TelnetOption::Echo as u8);
    negotiation.accept_remote(TelnetOption::SuppressGoAhead as u8);

    let negotiation = Arc::new(Mutex::new(negotiation));

    // Spawn write loop.
    let write_connected = connected.clone();
    let write_bytes_sent = bytes_sent.clone();
    let write_last_activity = last_activity.clone();
    let crlf = config.crlf_mode;
    let keepalive = config.keepalive_interval_secs;
    let terminal_type = config.terminal_type.clone();
    let terminal_speed = config.terminal_speed.clone();
    let cols = config.cols;
    let rows = config.rows;
    let session_id = id.clone();
    let write_shutdown = shutdown.clone();
    let write_event_tx = event_tx.clone();

    tokio::spawn(async move {
        write_loop(
            session_id,
            write_half,
            cmd_rx,
            write_connected,
            write_bytes_sent,
            write_last_activity,
            crlf,
            keepalive,
            terminal_type,
            terminal_speed,
            cols,
            rows,
            write_shutdown,
            write_event_tx,
        )
        .await;
    });

    // Spawn read loop.
    let read_connected = connected.clone();
    let read_bytes_received = bytes_received.clone();
    let read_last_activity = last_activity.clone();
    let read_negotiation = negotiation.clone();
    let read_session_id = id.clone();
    let read_terminal_type = config.terminal_type.clone();
    let read_terminal_speed = config.terminal_speed.clone();
    let read_cols = config.cols;
    let read_rows = config.rows;
    let read_shutdown = shutdown.clone();

    tokio::spawn(async move {
        read_loop(
            read_session_id,
            read_half,
            event_tx,
            read_connected,
            read_bytes_received,
            read_last_activity,
            read_negotiation,
            read_terminal_type,
            read_terminal_speed,
            read_cols,
            read_rows,
            read_shutdown,
        )
        .await;
    });

    // Send initial negotiation bytes via the command channel.
    {
        let mut neg = negotiation.lock().await;
        let init_bytes = neg.initial_negotiation();
        if !init_bytes.is_empty()
            && cmd_tx
                .try_send(SessionCommand::SendRaw(init_bytes))
                .is_err()
        {
            connected.store(false, Ordering::Relaxed);
            shutdown.notify_waiters();
            return Err(TelnetError::protocol(
                "Failed to queue initial Telnet negotiation",
            ));
        }
    }

    Ok(TelnetSessionHandle {
        id,
        config,
        cmd_tx,
        event_rx: Mutex::new(event_rx),
        connected,
        bytes_received,
        bytes_sent,
        connected_at: now_millis,
        last_activity,
        reconnect_count,
        shutdown,
    })
}

// ── Read loop ───────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn read_loop(
    session_id: String,
    mut reader: tokio::net::tcp::OwnedReadHalf,
    event_tx: mpsc::Sender<SessionEvent>,
    connected: Arc<AtomicBool>,
    bytes_received: Arc<AtomicU64>,
    last_activity: Arc<AtomicU64>,
    negotiation: Arc<Mutex<NegotiationManager>>,
    terminal_type: String,
    terminal_speed: String,
    cols: u16,
    rows: u16,
    shutdown: Arc<Notify>,
) {
    let mut codec = TelnetCodec::new();
    let mut buf = [0u8; 4096];

    loop {
        if !connected.load(Ordering::Relaxed) {
            break;
        }

        let read_result = tokio::select! {
            _ = shutdown.notified() => break,
            result = reader.read(&mut buf) => result,
        };
        let n = match read_result {
            Ok(0) => {
                log::info!("[telnet:{}] connection closed by remote", session_id);
                connected.store(false, Ordering::Relaxed);
                let _ = event_tx
                    .send(SessionEvent::Closed("Connection closed by remote".into()))
                    .await;
                break;
            }
            Ok(n) => n,
            Err(e) => {
                log::error!("[telnet:{}] read error: {}", session_id, e);
                connected.store(false, Ordering::Relaxed);
                let _ = event_tx
                    .send(SessionEvent::Error("Telnet receive failed".into()))
                    .await;
                let _ = event_tx
                    .send(SessionEvent::Closed("Telnet receive failed".into()))
                    .await;
                break;
            }
        };

        saturating_add(&bytes_received, n as u64);
        last_activity.store(
            chrono::Utc::now().timestamp_millis() as u64,
            Ordering::Relaxed,
        );

        let frames = codec.decode(&buf[..n]);
        if let Some(message) = codec.take_violation() {
            connected.store(false, Ordering::Relaxed);
            let _ = event_tx
                .send(SessionEvent::Error(message.to_string()))
                .await;
            let _ = event_tx
                .send(SessionEvent::Closed(message.to_string()))
                .await;
            break;
        }

        for frame in frames {
            match frame {
                TelnetFrame::Data(data) => {
                    // Convert to UTF-8 (lossy).
                    let text = String::from_utf8_lossy(&data).to_string();
                    if !text.is_empty() {
                        let _ = event_tx.send(SessionEvent::Data(text)).await;
                    }
                }
                TelnetFrame::Negotiation { command, option } => {
                    let opt_name = TelnetOption::from_byte(option)
                        .map(|o| format!("{:?}", o))
                        .unwrap_or_else(|| format!("Unknown({})", option));

                    log::debug!("[telnet:{}] recv {:?} {}", session_id, command, opt_name);

                    let _ = event_tx
                        .send(SessionEvent::Negotiation {
                            direction: "received".into(),
                            command: format!("{:?}", command),
                            option: opt_name.clone(),
                        })
                        .await;

                    // Process via Q-method state machine.
                    let response = {
                        let mut neg = negotiation.lock().await;
                        match command {
                            crate::telnet::types::TelnetCommand::WILL => neg.receive_will(option),
                            crate::telnet::types::TelnetCommand::WONT => neg.receive_wont(option),
                            crate::telnet::types::TelnetCommand::DO => neg.receive_do(option),
                            crate::telnet::types::TelnetCommand::DONT => neg.receive_dont(option),
                            _ => Vec::new(),
                        }
                    };

                    if !response.is_empty() {
                        log::debug!(
                            "[telnet:{}] negotiation response: {} bytes",
                            session_id,
                            response.len()
                        );
                        // Send the raw negotiation response back via the WriteBack event
                        // so the service layer can route it to the write side.
                        let _ = event_tx
                            .send(SessionEvent::WriteBack(response.clone()))
                            .await;
                        let _ = event_tx
                            .send(SessionEvent::Negotiation {
                                direction: "sent_raw".into(),
                                command: base64_encode(&response),
                                option: opt_name,
                            })
                            .await;
                    }
                }
                TelnetFrame::SubNegotiation { option, data } => {
                    log::debug!(
                        "[telnet:{}] recv SB {} data({} bytes)",
                        session_id,
                        option,
                        data.len()
                    );

                    // Handle known sub-negotiations.
                    let response = handle_subnegotiation(
                        option,
                        &data,
                        &terminal_type,
                        &terminal_speed,
                        cols,
                        rows,
                    );

                    if !response.is_empty() {
                        let _ = event_tx
                            .send(SessionEvent::WriteBack(response.clone()))
                            .await;
                        let _ = event_tx
                            .send(SessionEvent::Negotiation {
                                direction: "sent_raw".into(),
                                command: base64_encode(&response),
                                option: TelnetOption::from_byte(option)
                                    .map(|o| format!("{:?}", o))
                                    .unwrap_or_else(|| format!("Unknown({})", option)),
                            })
                            .await;
                    }
                }
                TelnetFrame::Command(cmd) => {
                    log::debug!("[telnet:{}] recv command {:?}", session_id, cmd);
                }
            }
        }
    }

    connected.store(false, Ordering::Relaxed);
    shutdown.notify_waiters();
    log::info!("[telnet:{}] read loop exited", session_id);
}

/// Handle a sub-negotiation and optionally produce a response.
fn handle_subnegotiation(
    option: u8,
    data: &[u8],
    terminal_type: &str,
    terminal_speed: &str,
    cols: u16,
    rows: u16,
) -> Vec<u8> {
    let ttype = TelnetOption::TerminalType as u8;
    let naws = TelnetOption::NAWS as u8;
    let tspeed = TelnetOption::TerminalSpeed as u8;

    if option == ttype {
        // TTYPE sub-negotiation: if data == [SEND], reply with IS <terminal_type>.
        if data.first() == Some(&SN_SEND) {
            return protocol::build_ttype_is(terminal_type);
        }
    } else if option == naws {
        // Received a NAWS query – respond with our window size.
        return protocol::build_naws(cols, rows);
    } else if option == tspeed && data.first() == Some(&SN_SEND) {
        return protocol::build_tspeed_is(terminal_speed);
    }

    Vec::new()
}

// ── Write loop ──────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn write_loop(
    session_id: String,
    mut writer: tokio::net::tcp::OwnedWriteHalf,
    mut cmd_rx: mpsc::Receiver<SessionCommand>,
    connected: Arc<AtomicBool>,
    bytes_sent: Arc<AtomicU64>,
    last_activity: Arc<AtomicU64>,
    crlf: bool,
    keepalive_secs: u64,
    _terminal_type: String,
    _terminal_speed: String,
    _cols: u16,
    _rows: u16,
    shutdown: Arc<Notify>,
    event_tx: mpsc::Sender<SessionEvent>,
) {
    let keepalive_interval = if keepalive_secs > 0 {
        Some(Duration::from_secs(keepalive_secs))
    } else {
        None
    };

    loop {
        let cmd = if let Some(interval) = keepalive_interval {
            let next = tokio::select! {
                _ = shutdown.notified() => break,
                result = tokio::time::timeout(interval, cmd_rx.recv()) => result,
            };
            match next {
                Ok(Some(cmd)) => cmd,
                Ok(None) => {
                    // Channel closed → session done.
                    break;
                }
                Err(_) => {
                    // Timeout → send keepalive NOP.
                    if connected.load(Ordering::Relaxed) {
                        let nop = protocol::build_command(NOP);
                        match timeout(IO_TIMEOUT, writer.write_all(&nop)).await {
                            Ok(Ok(())) => saturating_add(&bytes_sent, nop.len() as u64),
                            Ok(Err(e)) => {
                                log::warn!("[telnet:{}] keepalive write error: {}", session_id, e);
                                connected.store(false, Ordering::Relaxed);
                                report_write_failure(&event_tx, "Telnet keepalive write failed")
                                    .await;
                                break;
                            }
                            Err(_) => {
                                log::warn!("[telnet:{}] keepalive write timed out", session_id);
                                connected.store(false, Ordering::Relaxed);
                                report_write_failure(&event_tx, "Telnet keepalive write timed out")
                                    .await;
                                break;
                            }
                        }
                    }
                    continue;
                }
            }
        } else {
            let next = tokio::select! {
                _ = shutdown.notified() => break,
                command = cmd_rx.recv() => command,
            };
            match next {
                Some(cmd) => cmd,
                None => break,
            }
        };

        if !connected.load(Ordering::Relaxed) {
            break;
        }

        let data = match cmd {
            SessionCommand::SendRaw(data) if data.len() <= MAX_COMMAND_BYTES => data,
            SessionCommand::SendLine(line) if line.len() <= MAX_COMMAND_BYTES => {
                protocol::encode_line(&line, crlf)
            }
            SessionCommand::SendRaw(_) | SessionCommand::SendLine(_) => {
                log::warn!("[telnet:{}] rejected oversized queued payload", session_id);
                connected.store(false, Ordering::Relaxed);
                report_write_failure(&event_tx, "Telnet queued payload exceeded the size limit")
                    .await;
                break;
            }
            SessionCommand::Resize { cols, rows } => protocol::build_naws(cols, rows),
            SessionCommand::Break => protocol::build_command(protocol::BRK),
            SessionCommand::AreYouThere => protocol::build_command(protocol::AYT),
            SessionCommand::Disconnect => {
                log::info!("[telnet:{}] disconnect requested", session_id);
                connected.store(false, Ordering::Relaxed);
                let _ = timeout(IO_TIMEOUT, writer.shutdown()).await;
                break;
            }
        };

        if !data.is_empty() {
            match timeout(IO_TIMEOUT, writer.write_all(&data)).await {
                Ok(Ok(())) => {
                    saturating_add(&bytes_sent, data.len() as u64);
                    last_activity.store(
                        chrono::Utc::now().timestamp_millis() as u64,
                        Ordering::Relaxed,
                    );
                }
                Ok(Err(e)) => {
                    log::error!("[telnet:{}] write error: {}", session_id, e);
                    connected.store(false, Ordering::Relaxed);
                    report_write_failure(&event_tx, "Telnet write failed").await;
                    break;
                }
                Err(_) => {
                    log::error!("[telnet:{}] write timed out", session_id);
                    connected.store(false, Ordering::Relaxed);
                    report_write_failure(&event_tx, "Telnet write timed out").await;
                    break;
                }
            }
        }
    }

    connected.store(false, Ordering::Relaxed);
    shutdown.notify_waiters();
    log::info!("[telnet:{}] write loop exited", session_id);
}

async fn report_write_failure(event_tx: &mpsc::Sender<SessionEvent>, message: &'static str) {
    let _ = timeout(
        TERMINAL_EVENT_TIMEOUT,
        event_tx.send(SessionEvent::Error(message.to_string())),
    )
    .await;
    let _ = timeout(
        TERMINAL_EVENT_TIMEOUT,
        event_tx.send(SessionEvent::Closed(message.to_string())),
    )
    .await;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/// Simple base64 encoding for piggybacking raw bytes through string events.
fn base64_encode(data: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(data.len() * 2);
    for &b in data {
        write!(s, "{:02x}", b).expect("write to String never fails");
    }
    s
}

/// Decode hex-encoded bytes.
pub fn hex_decode(s: &str) -> Option<Vec<u8>> {
    let bytes = s.as_bytes();
    if !bytes.len().is_multiple_of(2) || !bytes.iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    let nibble = |byte: u8| match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    };
    bytes
        .chunks_exact(2)
        .map(|pair| Some((nibble(pair[0])? << 4) | nibble(pair[1])?))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telnet::protocol::{IAC, SB};

    #[test]
    fn hex_encode_decode_roundtrip() {
        let data = vec![0xFF, 0xFB, 0x01, 0x00, 0xAB];
        let encoded = base64_encode(&data);
        let decoded = hex_decode(&encoded).unwrap();
        assert_eq!(decoded, data);
    }

    #[test]
    fn hex_decode_invalid_length() {
        assert!(hex_decode("abc").is_none());
    }

    #[test]
    fn hex_decode_empty() {
        assert_eq!(hex_decode(""), Some(vec![]));
    }

    #[test]
    fn handle_subneg_ttype_send_returns_is() {
        let resp = handle_subnegotiation(
            TelnetOption::TerminalType as u8,
            &[SN_SEND],
            "xterm-256color",
            "38400,38400",
            80,
            24,
        );
        // Should be IAC SB 24 IS <terminal_type> IAC SE
        assert!(!resp.is_empty());
        assert_eq!(resp[0], IAC);
        assert_eq!(resp[1], SB);
        assert_eq!(resp[2], TelnetOption::TerminalType as u8);
    }

    #[test]
    fn handle_subneg_ttype_unknown_data() {
        let resp = handle_subnegotiation(
            TelnetOption::TerminalType as u8,
            &[99], // not SEND
            "vt100",
            "38400,38400",
            80,
            24,
        );
        assert!(resp.is_empty());
    }

    #[test]
    fn handle_subneg_naws() {
        let resp = handle_subnegotiation(
            TelnetOption::NAWS as u8,
            &[],
            "xterm",
            "38400,38400",
            120,
            40,
        );
        assert!(!resp.is_empty());
        // Check it's a valid NAWS frame: IAC SB 31 <4 bytes> IAC SE
        assert_eq!(resp.len(), 9);
        assert_eq!(resp[2], TelnetOption::NAWS as u8);
    }

    #[test]
    fn handle_subneg_tspeed_send() {
        let resp = handle_subnegotiation(
            TelnetOption::TerminalSpeed as u8,
            &[SN_SEND],
            "xterm",
            "9600,9600",
            80,
            24,
        );
        assert!(!resp.is_empty());
        assert_eq!(resp[2], TelnetOption::TerminalSpeed as u8);
    }

    #[test]
    fn handle_subneg_unknown_option() {
        let resp = handle_subnegotiation(200, &[1, 2, 3], "xterm", "38400,38400", 80, 24);
        assert!(resp.is_empty());
    }

    #[test]
    fn session_info_from_config() {
        let cfg = TelnetConfig {
            host: "192.168.1.1".into(),
            port: 23,
            username: Some("admin".into()),
            label: Some("switch".into()),
            ..Default::default()
        };
        let info = TelnetSession::from_config("test-1".into(), &cfg);
        assert_eq!(info.id, "test-1");
        assert!(info.connected);
        assert_eq!(info.host, "192.168.1.1");
    }

    // ── WriteBack variant tests ──────────────────────────────

    #[test]
    fn session_event_writeback_carries_data() {
        let data = vec![IAC, 0xFB, 0x01];
        let event = SessionEvent::WriteBack(data.clone());
        let SessionEvent::WriteBack(d) = event else {
            unreachable!("expected WriteBack")
        };
        assert_eq!(d, data);
    }

    #[test]
    fn session_event_writeback_empty() {
        let event = SessionEvent::WriteBack(vec![]);
        let SessionEvent::WriteBack(d) = event else {
            unreachable!("expected WriteBack")
        };
        assert!(d.is_empty());
    }

    #[test]
    fn handle_subneg_ttype_produces_writeback_data() {
        // handle_subnegotiation returns a non-empty Vec<u8> for TTYPE SEND,
        // which is what gets wrapped in WriteBack during the read loop.
        let resp = handle_subnegotiation(
            TelnetOption::TerminalType as u8,
            &[SN_SEND],
            "xterm-256color",
            "38400,38400",
            80,
            24,
        );
        assert!(!resp.is_empty());
        // Verify it starts with IAC SB (subneg response)
        assert_eq!(resp[0], IAC);
        assert_eq!(resp[1], SB);
    }

    #[test]
    fn handle_subneg_naws_produces_window_size() {
        let resp = handle_subnegotiation(
            TelnetOption::NAWS as u8,
            &[],
            "xterm",
            "38400,38400",
            132,
            50,
        );
        // IAC SB NAWS <width_hi> <width_lo> <height_hi> <height_lo> IAC SE
        assert_eq!(resp.len(), 9);
        // Width = 132 = 0x0084
        assert_eq!(resp[3], 0); // width high byte
        assert_eq!(resp[4], 132); // width low byte
        assert_eq!(resp[5], 0); // height high byte
        assert_eq!(resp[6], 50); // height low byte
    }
}
