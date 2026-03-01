//! Telnet types: configuration, session metadata, events, and option descriptors.

use serde::{Deserialize, Serialize};
use std::fmt;

// ── RFC 854 / 855 command bytes ─────────────────────────────────────────

/// Telnet protocol command bytes (RFC 854).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum TelnetCommand {
    /// Sub-negotiation End
    SE = 240,
    /// No Operation
    NOP = 241,
    /// Data Mark
    DataMark = 242,
    /// Break
    Break = 243,
    /// Interrupt Process
    InterruptProcess = 244,
    /// Abort Output
    AbortOutput = 245,
    /// Are You There
    AreYouThere = 246,
    /// Erase Character
    EraseCharacter = 247,
    /// Erase Line
    EraseLine = 248,
    /// Go Ahead
    GoAhead = 249,
    /// Sub-negotiation Begin
    SB = 250,
    /// WILL (sender wants to enable option)
    WILL = 251,
    /// WON'T (sender refuses to enable option)
    WONT = 252,
    /// DO (sender wants receiver to enable option)
    DO = 253,
    /// DON'T (sender wants receiver to disable option)
    DONT = 254,
    /// Interpret As Command (escape byte)
    IAC = 255,
}

impl TelnetCommand {
    /// Try to convert a raw byte into a `TelnetCommand`.
    pub fn from_byte(b: u8) -> Option<Self> {
        match b {
            240 => Some(Self::SE),
            241 => Some(Self::NOP),
            242 => Some(Self::DataMark),
            243 => Some(Self::Break),
            244 => Some(Self::InterruptProcess),
            245 => Some(Self::AbortOutput),
            246 => Some(Self::AreYouThere),
            247 => Some(Self::EraseCharacter),
            248 => Some(Self::EraseLine),
            249 => Some(Self::GoAhead),
            250 => Some(Self::SB),
            251 => Some(Self::WILL),
            252 => Some(Self::WONT),
            253 => Some(Self::DO),
            254 => Some(Self::DONT),
            255 => Some(Self::IAC),
            _ => None,
        }
    }
}

impl fmt::Display for TelnetCommand {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

// ── Well-known Telnet option codes ──────────────────────────────────────

/// Well-known Telnet option codes (RFC 855 / various RFCs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum TelnetOption {
    /// Binary Transmission (RFC 856)
    BinaryTransmission = 0,
    /// Echo (RFC 857)
    Echo = 1,
    /// Reconnection (NIC 15391)
    Reconnection = 2,
    /// Suppress Go Ahead (RFC 858)
    SuppressGoAhead = 3,
    /// Status (RFC 859)
    Status = 5,
    /// Timing Mark (RFC 860)
    TimingMark = 6,
    /// Terminal Type (RFC 1091)
    TerminalType = 24,
    /// End of Record (RFC 885)
    EndOfRecord = 25,
    /// NAWS – Negotiate About Window Size (RFC 1073)
    NAWS = 31,
    /// Terminal Speed (RFC 1079)
    TerminalSpeed = 32,
    /// Remote Flow Control (RFC 1372)
    RemoteFlowControl = 33,
    /// Linemode (RFC 1184)
    Linemode = 34,
    /// X Display Location (RFC 1096)
    XDisplayLocation = 35,
    /// Environment Option (RFC 1572)
    NewEnvironment = 39,
    /// CHARSET (RFC 2066)
    Charset = 42,
    /// COM Port Control (RFC 2217)
    ComPortControl = 44,
    /// GMCP – Generic MUD Communication Protocol (non-standard, widely used)
    GMCP = 201,
}

impl TelnetOption {
    /// Try to convert a raw byte into a known `TelnetOption`.
    pub fn from_byte(b: u8) -> Option<Self> {
        match b {
            0 => Some(Self::BinaryTransmission),
            1 => Some(Self::Echo),
            2 => Some(Self::Reconnection),
            3 => Some(Self::SuppressGoAhead),
            5 => Some(Self::Status),
            6 => Some(Self::TimingMark),
            24 => Some(Self::TerminalType),
            25 => Some(Self::EndOfRecord),
            31 => Some(Self::NAWS),
            32 => Some(Self::TerminalSpeed),
            33 => Some(Self::RemoteFlowControl),
            34 => Some(Self::Linemode),
            35 => Some(Self::XDisplayLocation),
            39 => Some(Self::NewEnvironment),
            42 => Some(Self::Charset),
            44 => Some(Self::ComPortControl),
            201 => Some(Self::GMCP),
            _ => None,
        }
    }

    /// Option code byte.
    pub fn code(self) -> u8 {
        self as u8
    }
}

impl fmt::Display for TelnetOption {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}({})", self, *self as u8)
    }
}

// ── Negotiation Q-method state (RFC 1143) ───────────────────────────────

/// Per-option negotiation state for one side (local or remote).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QState {
    No,
    Yes,
    WantNo,
    WantYes,
    /// WantNo with a queued opposite request.
    WantNoOpposite,
    /// WantYes with a queued opposite request.
    WantYesOpposite,
}

impl Default for QState {
    fn default() -> Self {
        Self::No
    }
}

// ── Option negotiation tracking ─────────────────────────────────────────

/// Tracks the state of a single telnet option for both the local and
/// remote side using the RFC 1143 Q-method.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionState {
    /// What the local side *is* doing (WILL/WONT perspective).
    pub local: QState,
    /// What the remote side *is* doing (DO/DONT perspective).
    pub remote: QState,
}

impl Default for OptionState {
    fn default() -> Self {
        Self {
            local: QState::No,
            remote: QState::No,
        }
    }
}

// ── Configuration ───────────────────────────────────────────────────────

/// Configuration for a new telnet connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetConfig {
    /// Target host.
    pub host: String,
    /// Target port (default 23).
    #[serde(default = "default_telnet_port")]
    pub port: u16,
    /// Optional username for auto-login (RFC 1416 or custom prompt detection).
    pub username: Option<String>,
    /// Optional password for auto-login.
    pub password: Option<String>,
    /// Terminal type string sent during TTYPE negotiation.
    #[serde(default = "default_terminal_type")]
    pub terminal_type: String,
    /// Terminal width (columns) for NAWS negotiation.
    #[serde(default = "default_cols")]
    pub cols: u16,
    /// Terminal height (rows) for NAWS negotiation.
    #[serde(default = "default_rows")]
    pub rows: u16,
    /// TCP connect timeout in seconds.
    #[serde(default = "default_connect_timeout")]
    pub connect_timeout_secs: u64,
    /// Whether to perform local echo.
    #[serde(default)]
    pub local_echo: bool,
    /// Send CR+LF on Enter (standard). If false, sends CR+NUL.
    #[serde(default = "default_true")]
    pub crlf_mode: bool,
    /// Enable binary mode (RFC 856).
    #[serde(default)]
    pub binary_mode: bool,
    /// Enable Suppress-Go-Ahead (SGA).
    #[serde(default = "default_true")]
    pub suppress_go_ahead: bool,
    /// Maximum number of reconnect attempts (0 = no reconnect).
    #[serde(default)]
    pub max_reconnect_attempts: u32,
    /// Delay between reconnect attempts in seconds.
    #[serde(default = "default_reconnect_delay")]
    pub reconnect_delay_secs: u64,
    /// Keep-alive interval in seconds (0 = disabled). Sends NOP commands.
    #[serde(default)]
    pub keepalive_interval_secs: u64,
    /// Connection label / friendly name.
    pub label: Option<String>,
    /// Environment variables to send (RFC 1572 NEW-ENVIRON).
    #[serde(default)]
    pub environment: std::collections::HashMap<String, String>,
    /// Character encoding. Currently informational (we always do UTF-8 internally).
    #[serde(default = "default_encoding")]
    pub encoding: String,
    /// Terminal speed string for TSPEED sub-negotiation (e.g. "38400,38400").
    #[serde(default = "default_terminal_speed")]
    pub terminal_speed: String,
    /// Escape character byte (default 0x1d = Ctrl-]).
    #[serde(default = "default_escape_char")]
    pub escape_char: u8,
}

fn default_telnet_port() -> u16 { 23 }
fn default_terminal_type() -> String { "xterm-256color".to_string() }
fn default_cols() -> u16 { 80 }
fn default_rows() -> u16 { 24 }
fn default_connect_timeout() -> u64 { 15 }
fn default_true() -> bool { true }
fn default_reconnect_delay() -> u64 { 5 }
fn default_encoding() -> String { "utf-8".to_string() }
fn default_terminal_speed() -> String { "38400,38400".to_string() }
fn default_escape_char() -> u8 { 0x1d }

impl Default for TelnetConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: default_telnet_port(),
            username: None,
            password: None,
            terminal_type: default_terminal_type(),
            cols: default_cols(),
            rows: default_rows(),
            connect_timeout_secs: default_connect_timeout(),
            local_echo: false,
            crlf_mode: true,
            binary_mode: false,
            suppress_go_ahead: true,
            max_reconnect_attempts: 0,
            reconnect_delay_secs: default_reconnect_delay(),
            keepalive_interval_secs: 0,
            label: None,
            environment: Default::default(),
            encoding: default_encoding(),
            terminal_speed: default_terminal_speed(),
            escape_char: default_escape_char(),
        }
    }
}

// ── Session metadata ────────────────────────────────────────────────────

/// Metadata about a live (or recently closed) telnet session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub connected: bool,
    pub username: Option<String>,
    pub label: Option<String>,
    /// ISO-8601 timestamp when the session was created.
    pub connected_at: String,
    /// ISO-8601 timestamp of last data activity.
    pub last_activity: String,
    /// Total bytes received from the server.
    pub bytes_received: u64,
    /// Total bytes sent to the server.
    pub bytes_sent: u64,
    /// Terminal type negotiated.
    pub terminal_type: String,
    /// Current negotiated window size.
    pub window_cols: u16,
    pub window_rows: u16,
    /// Number of connectivity interruptions.
    pub reconnect_count: u32,
}

impl TelnetSession {
    /// Build a new session from a config.
    pub fn from_config(id: String, config: &TelnetConfig) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id,
            host: config.host.clone(),
            port: config.port,
            connected: true,
            username: config.username.clone(),
            label: config.label.clone(),
            connected_at: now.clone(),
            last_activity: now,
            bytes_received: 0,
            bytes_sent: 0,
            terminal_type: config.terminal_type.clone(),
            window_cols: config.cols,
            window_rows: config.rows,
            reconnect_count: 0,
        }
    }
}

// ── Events emitted to the frontend ──────────────────────────────────────

/// Payload for `telnet-output` events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetOutputEvent {
    pub session_id: String,
    pub data: String,
}

/// Payload for `telnet-error` events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetErrorEvent {
    pub session_id: String,
    pub message: String,
}

/// Payload for `telnet-closed` events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetClosedEvent {
    pub session_id: String,
    pub reason: String,
}

/// Payload for `telnet-negotiation` debug events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetNegotiationEvent {
    pub session_id: String,
    pub direction: String,
    pub command: String,
    pub option: String,
}

// ── Session statistics ──────────────────────────────────────────────────

/// Detailed statistics snapshot for a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetStats {
    pub session_id: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub connected_at: String,
    pub last_activity: String,
    pub reconnect_count: u32,
    pub uptime_secs: u64,
    pub negotiated_options: Vec<String>,
}

// ── Error type ──────────────────────────────────────────────────────────

/// Telnet crate error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetError {
    pub kind: TelnetErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TelnetErrorKind {
    ConnectionRefused,
    Timeout,
    DnsResolution,
    Io,
    ProtocolViolation,
    SessionNotFound,
    AlreadyConnected,
    NotConnected,
    NegotiationFailed,
    AuthFailed,
    Internal,
}

impl fmt::Display for TelnetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for TelnetError {}

impl TelnetError {
    pub fn new(kind: TelnetErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }

    pub fn session_not_found(id: &str) -> Self {
        Self::new(TelnetErrorKind::SessionNotFound, format!("Session '{}' not found", id))
    }

    pub fn not_connected() -> Self {
        Self::new(TelnetErrorKind::NotConnected, "Not connected")
    }

    pub fn io(msg: impl Into<String>) -> Self {
        Self::new(TelnetErrorKind::Io, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(TelnetErrorKind::Timeout, msg)
    }

    pub fn protocol(msg: impl Into<String>) -> Self {
        Self::new(TelnetErrorKind::ProtocolViolation, msg)
    }
}

impl From<std::io::Error> for TelnetError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::ConnectionRefused => {
                Self::new(TelnetErrorKind::ConnectionRefused, e.to_string())
            }
            std::io::ErrorKind::TimedOut => {
                Self::new(TelnetErrorKind::Timeout, e.to_string())
            }
            _ => Self::new(TelnetErrorKind::Io, e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── TelnetCommand ───────────────────────────────────────────────

    #[test]
    fn command_from_byte_roundtrip() {
        for b in 240..=255 {
            let cmd = TelnetCommand::from_byte(b).unwrap();
            assert_eq!(cmd as u8, b);
        }
    }

    #[test]
    fn command_from_byte_invalid() {
        assert!(TelnetCommand::from_byte(0).is_none());
        assert!(TelnetCommand::from_byte(100).is_none());
        assert!(TelnetCommand::from_byte(239).is_none());
    }

    #[test]
    fn command_display() {
        let s = format!("{}", TelnetCommand::IAC);
        assert!(s.contains("IAC"));
    }

    // ── TelnetOption ────────────────────────────────────────────────

    #[test]
    fn option_from_byte_known() {
        assert_eq!(TelnetOption::from_byte(0), Some(TelnetOption::BinaryTransmission));
        assert_eq!(TelnetOption::from_byte(1), Some(TelnetOption::Echo));
        assert_eq!(TelnetOption::from_byte(3), Some(TelnetOption::SuppressGoAhead));
        assert_eq!(TelnetOption::from_byte(24), Some(TelnetOption::TerminalType));
        assert_eq!(TelnetOption::from_byte(31), Some(TelnetOption::NAWS));
        assert_eq!(TelnetOption::from_byte(39), Some(TelnetOption::NewEnvironment));
        assert_eq!(TelnetOption::from_byte(201), Some(TelnetOption::GMCP));
    }

    #[test]
    fn option_from_byte_unknown() {
        assert!(TelnetOption::from_byte(99).is_none());
        assert!(TelnetOption::from_byte(200).is_none());
    }

    #[test]
    fn option_code() {
        assert_eq!(TelnetOption::Echo.code(), 1);
        assert_eq!(TelnetOption::NAWS.code(), 31);
    }

    #[test]
    fn option_display() {
        let s = format!("{}", TelnetOption::TerminalType);
        assert!(s.contains("TerminalType"));
        assert!(s.contains("24"));
    }

    // ── QState default ──────────────────────────────────────────────

    #[test]
    fn qstate_default_is_no() {
        assert_eq!(QState::default(), QState::No);
    }

    // ── OptionState default ─────────────────────────────────────────

    #[test]
    fn option_state_default() {
        let os = OptionState::default();
        assert_eq!(os.local, QState::No);
        assert_eq!(os.remote, QState::No);
    }

    // ── TelnetConfig ────────────────────────────────────────────────

    #[test]
    fn config_default_values() {
        let cfg = TelnetConfig::default();
        assert_eq!(cfg.port, 23);
        assert_eq!(cfg.terminal_type, "xterm-256color");
        assert_eq!(cfg.cols, 80);
        assert_eq!(cfg.rows, 24);
        assert_eq!(cfg.connect_timeout_secs, 15);
        assert!(cfg.crlf_mode);
        assert!(cfg.suppress_go_ahead);
        assert!(!cfg.local_echo);
        assert!(!cfg.binary_mode);
        assert_eq!(cfg.encoding, "utf-8");
        assert_eq!(cfg.terminal_speed, "38400,38400");
        assert_eq!(cfg.escape_char, 0x1d);
    }

    #[test]
    fn config_serde_roundtrip() {
        let cfg = TelnetConfig {
            host: "192.168.1.1".into(),
            port: 2323,
            username: Some("admin".into()),
            password: Some("secret".into()),
            terminal_type: "vt100".into(),
            cols: 132,
            rows: 43,
            ..Default::default()
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let de: TelnetConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(de.host, "192.168.1.1");
        assert_eq!(de.port, 2323);
        assert_eq!(de.username.as_deref(), Some("admin"));
        assert_eq!(de.cols, 132);
    }

    #[test]
    fn config_deserialize_minimal() {
        let json = r#"{"host":"10.0.0.1"}"#;
        let cfg: TelnetConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.host, "10.0.0.1");
        assert_eq!(cfg.port, 23);
        assert_eq!(cfg.terminal_type, "xterm-256color");
    }

    // ── TelnetSession ───────────────────────────────────────────────

    #[test]
    fn session_from_config() {
        let cfg = TelnetConfig {
            host: "host.example.com".into(),
            port: 23,
            username: Some("root".into()),
            terminal_type: "vt220".into(),
            cols: 120,
            rows: 40,
            label: Some("Router".into()),
            ..Default::default()
        };
        let s = TelnetSession::from_config("sess-1".into(), &cfg);
        assert_eq!(s.id, "sess-1");
        assert_eq!(s.host, "host.example.com");
        assert_eq!(s.port, 23);
        assert!(s.connected);
        assert_eq!(s.username.as_deref(), Some("root"));
        assert_eq!(s.label.as_deref(), Some("Router"));
        assert_eq!(s.terminal_type, "vt220");
        assert_eq!(s.window_cols, 120);
        assert_eq!(s.window_rows, 40);
        assert_eq!(s.bytes_received, 0);
        assert_eq!(s.bytes_sent, 0);
    }

    #[test]
    fn session_serde_roundtrip() {
        let cfg = TelnetConfig {
            host: "10.0.0.1".into(),
            ..Default::default()
        };
        let s = TelnetSession::from_config("s1".into(), &cfg);
        let json = serde_json::to_string(&s).unwrap();
        let de: TelnetSession = serde_json::from_str(&json).unwrap();
        assert_eq!(de.id, "s1");
        assert_eq!(de.host, "10.0.0.1");
    }

    // ── Event payloads ──────────────────────────────────────────────

    #[test]
    fn output_event_serde() {
        let ev = TelnetOutputEvent { session_id: "x".into(), data: "hello".into() };
        let json = serde_json::to_string(&ev).unwrap();
        let de: TelnetOutputEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(de.session_id, "x");
        assert_eq!(de.data, "hello");
    }

    #[test]
    fn error_event_serde() {
        let ev = TelnetErrorEvent { session_id: "x".into(), message: "boom".into() };
        let json = serde_json::to_string(&ev).unwrap();
        let de: TelnetErrorEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(de.message, "boom");
    }

    #[test]
    fn closed_event_serde() {
        let ev = TelnetClosedEvent {
            session_id: "x".into(),
            reason: "server closed".into(),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("server closed"));
    }

    #[test]
    fn negotiation_event_serde() {
        let ev = TelnetNegotiationEvent {
            session_id: "x".into(),
            direction: "sent".into(),
            command: "WILL".into(),
            option: "SGA".into(),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("WILL"));
    }

    // ── TelnetError ─────────────────────────────────────────────────

    #[test]
    fn error_display() {
        let e = TelnetError::new(TelnetErrorKind::Timeout, "timed out after 15s");
        let s = format!("{}", e);
        assert!(s.contains("Timeout"));
        assert!(s.contains("timed out after 15s"));
    }

    #[test]
    fn error_session_not_found() {
        let e = TelnetError::session_not_found("abc");
        assert_eq!(e.kind, TelnetErrorKind::SessionNotFound);
        assert!(e.message.contains("abc"));
    }

    #[test]
    fn error_from_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "refused");
        let te: TelnetError = io_err.into();
        assert_eq!(te.kind, TelnetErrorKind::ConnectionRefused);
    }

    #[test]
    fn error_from_io_timeout() {
        let io_err = std::io::Error::new(std::io::ErrorKind::TimedOut, "timed out");
        let te: TelnetError = io_err.into();
        assert_eq!(te.kind, TelnetErrorKind::Timeout);
    }

    #[test]
    fn error_from_io_other() {
        let io_err = std::io::Error::new(std::io::ErrorKind::BrokenPipe, "pipe broke");
        let te: TelnetError = io_err.into();
        assert_eq!(te.kind, TelnetErrorKind::Io);
    }

    #[test]
    fn error_serde_roundtrip() {
        let e = TelnetError::new(TelnetErrorKind::AuthFailed, "bad pw");
        let json = serde_json::to_string(&e).unwrap();
        let de: TelnetError = serde_json::from_str(&json).unwrap();
        assert_eq!(de.kind, TelnetErrorKind::AuthFailed);
        assert_eq!(de.message, "bad pw");
    }

    // ── TelnetStats ─────────────────────────────────────────────────

    #[test]
    fn stats_serde_roundtrip() {
        let st = TelnetStats {
            session_id: "s1".into(),
            bytes_sent: 1024,
            bytes_received: 8192,
            connected_at: "2026-01-01T00:00:00Z".into(),
            last_activity: "2026-01-01T01:00:00Z".into(),
            reconnect_count: 2,
            uptime_secs: 3600,
            negotiated_options: vec!["Echo".into(), "SGA".into()],
        };
        let json = serde_json::to_string(&st).unwrap();
        let de: TelnetStats = serde_json::from_str(&json).unwrap();
        assert_eq!(de.bytes_sent, 1024);
        assert_eq!(de.negotiated_options.len(), 2);
    }
}
