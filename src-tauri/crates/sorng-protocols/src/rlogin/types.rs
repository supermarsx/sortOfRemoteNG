use serde::{Deserialize, Serialize};
use sorng_socket_transport::{AddressFamily, Route, RouteKind, TransportError};
use std::fmt;
use std::net::IpAddr;
use std::time::Duration;

pub const DEFAULT_RLOGIN_PORT: u16 = 513;
pub const DEFAULT_REPLAY_CAPACITY_BYTES: usize = 1024 * 1024;
pub const MAX_ACTIVE_RLOGIN_SESSIONS: usize = 64;
pub const MAX_RLOGIN_INPUT_BYTES: usize = 1024 * 1024;
pub const MAX_USERNAME_BYTES: usize = 256;
pub const MAX_TERMINAL_TYPE_BYTES: usize = 128;
pub const MAX_SERVER_DIAGNOSTIC_BYTES: usize = 1024;

fn default_port() -> u16 {
    DEFAULT_RLOGIN_PORT
}

fn default_terminal_type() -> String {
    "xterm-256color".to_string()
}

fn default_terminal_speed() -> u32 {
    38_400
}

fn default_encoding() -> String {
    "utf-8".to_string()
}

fn default_handshake_timeout_ms() -> u64 {
    10_000
}

fn default_write_timeout_ms() -> u64 {
    10_000
}

fn default_idle_timeout_ms() -> u64 {
    5 * 60 * 1_000
}

fn default_replay_capacity() -> usize {
    DEFAULT_REPLAY_CAPACITY_BYTES
}

fn default_true() -> bool {
    true
}

fn default_escape_byte() -> u8 {
    b'~'
}

/// User-visible RLogin settings.  Network-path details intentionally do not
/// live here; the caller resolves them before constructing the byte stream.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct RloginConfig {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub local_username: String,
    pub remote_username: String,
    #[serde(default = "default_terminal_type")]
    pub terminal_type: String,
    #[serde(default = "default_terminal_speed")]
    pub terminal_speed: u32,
    #[serde(default = "default_encoding")]
    pub encoding: String,
    #[serde(default = "default_handshake_timeout_ms")]
    pub handshake_timeout_ms: u64,
    #[serde(default = "default_write_timeout_ms")]
    pub write_timeout_ms: u64,
    #[serde(default = "default_idle_timeout_ms")]
    pub idle_timeout_ms: u64,
    #[serde(default = "default_replay_capacity")]
    pub replay_capacity_bytes: usize,
    #[serde(default = "default_true")]
    pub local_flow_control: bool,
    #[serde(default = "default_true")]
    pub escape_enabled: bool,
    #[serde(default = "default_escape_byte")]
    pub escape_byte: u8,
    pub initial_window: WindowSize,
}

impl Default for RloginConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: default_port(),
            local_username: String::new(),
            remote_username: String::new(),
            terminal_type: default_terminal_type(),
            terminal_speed: default_terminal_speed(),
            encoding: default_encoding(),
            handshake_timeout_ms: default_handshake_timeout_ms(),
            write_timeout_ms: default_write_timeout_ms(),
            idle_timeout_ms: default_idle_timeout_ms(),
            replay_capacity_bytes: default_replay_capacity(),
            local_flow_control: true,
            escape_enabled: true,
            escape_byte: default_escape_byte(),
            initial_window: WindowSize::default(),
        }
    }
}

impl RloginConfig {
    pub fn validate(&self) -> Result<(), RloginError> {
        validate_nonempty("host", &self.host)?;
        if self.port == 0 {
            return Err(RloginError::invalid("port", "must be between 1 and 65535"));
        }
        validate_handshake_field(
            "localUsername",
            &self.local_username,
            MAX_USERNAME_BYTES,
            true,
        )?;
        validate_handshake_field(
            "remoteUsername",
            &self.remote_username,
            MAX_USERNAME_BYTES,
            true,
        )?;
        validate_handshake_field(
            "terminalType",
            &self.terminal_type,
            MAX_TERMINAL_TYPE_BYTES,
            true,
        )?;
        validate_nonempty("encoding", &self.encoding)?;
        if self.handshake_timeout_ms == 0 {
            return Err(RloginError::invalid(
                "handshakeTimeoutMs",
                "must be greater than zero",
            ));
        }
        if self.write_timeout_ms == 0 {
            return Err(RloginError::invalid(
                "writeTimeoutMs",
                "must be greater than zero",
            ));
        }
        if self.idle_timeout_ms == 0 {
            return Err(RloginError::invalid(
                "idleTimeoutMs",
                "must be greater than zero",
            ));
        }
        if self.replay_capacity_bytes == 0 {
            return Err(RloginError::invalid(
                "replayCapacityBytes",
                "must be greater than zero",
            ));
        }
        if self.escape_byte == 0 {
            return Err(RloginError::invalid(
                "escapeByte",
                "NUL cannot be used as the local escape byte",
            ));
        }
        Ok(())
    }

    pub fn handshake_timeout(&self) -> Duration {
        Duration::from_millis(self.handshake_timeout_ms)
    }

    pub fn write_timeout(&self) -> Duration {
        Duration::from_millis(self.write_timeout_ms)
    }

    pub fn idle_timeout(&self) -> Duration {
        Duration::from_millis(self.idle_timeout_ms)
    }

    pub fn terminal_descriptor(&self) -> String {
        format!("{}/{}", self.terminal_type, self.terminal_speed)
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RloginSourcePortMode {
    #[default]
    Ephemeral,
    Reserved,
    Auto,
}

fn default_connect_timeout_ms() -> u64 {
    10_000
}

fn default_reserved_port_start() -> u16 {
    512
}

fn default_reserved_port_end() -> u16 {
    1023
}

fn default_tcp_keepalive_seconds() -> Option<u64> {
    Some(60)
}

/// Complete transport and protocol options accepted by the native RLogin
/// adapter. The protocol fields are flattened so the IPC shape matches the
/// versioned connection settings rather than exposing an internal engine
/// object.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct RloginConnectOptions {
    #[serde(flatten)]
    pub config: RloginConfig,
    pub connection_id: Option<String>,
    pub route: Route,
    pub address_family: AddressFamily,
    pub local_bind_address: Option<IpAddr>,
    pub source_port_mode: RloginSourcePortMode,
    #[serde(default = "default_reserved_port_start")]
    pub reserved_port_start: u16,
    #[serde(default = "default_reserved_port_end")]
    pub reserved_port_end: u16,
    #[serde(default = "default_connect_timeout_ms")]
    pub connect_timeout_ms: u64,
    #[serde(default = "default_true")]
    pub tcp_no_delay: bool,
    #[serde(default = "default_tcp_keepalive_seconds")]
    pub tcp_keepalive_seconds: Option<u64>,
    /// RLogin sends usernames and terminal traffic in plaintext. Callers must
    /// make the saved per-connection acknowledgement explicit at connect time.
    pub plaintext_acknowledged: bool,
}

impl Default for RloginConnectOptions {
    fn default() -> Self {
        Self {
            config: RloginConfig::default(),
            connection_id: None,
            route: Route::Direct,
            address_family: AddressFamily::Any,
            local_bind_address: None,
            source_port_mode: RloginSourcePortMode::Ephemeral,
            reserved_port_start: default_reserved_port_start(),
            reserved_port_end: default_reserved_port_end(),
            connect_timeout_ms: default_connect_timeout_ms(),
            tcp_no_delay: true,
            tcp_keepalive_seconds: default_tcp_keepalive_seconds(),
            plaintext_acknowledged: false,
        }
    }
}

impl RloginConnectOptions {
    pub fn validate(&self) -> Result<(), RloginError> {
        self.config.validate()?;
        if !self.plaintext_acknowledged {
            return Err(RloginError::PlaintextAcknowledgementRequired);
        }
        if self.route != Route::Direct {
            return Err(RloginError::UnsupportedRoute(self.route.kind()));
        }
        if self.source_port_mode == RloginSourcePortMode::Reserved {
            return Err(RloginError::ReservedSourcePortUnavailable);
        }
        if !(512..=1023).contains(&self.reserved_port_start)
            || !(512..=1023).contains(&self.reserved_port_end)
            || self.reserved_port_start > self.reserved_port_end
            || self.connect_timeout_ms == 0
            || self.connect_timeout_ms > 86_400_000
            || self
                .tcp_keepalive_seconds
                .is_some_and(|seconds| seconds == 0 || seconds > 86_400)
            || self.connection_id.as_ref().is_some_and(|id| id.len() > 256)
        {
            return Err(RloginError::invalid(
                "transport",
                "source-port range, timeout, keepalive, or connection id is invalid",
            ));
        }
        Ok(())
    }

    pub fn capabilities(&self) -> RloginCapabilities {
        RloginCapabilities::production()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RloginCapabilities {
    pub direct_route: bool,
    pub proxy_routes: bool,
    pub reserved_source_port: bool,
    pub out_of_band_control: bool,
    pub limitation_messages: Vec<String>,
}

impl RloginCapabilities {
    pub fn production() -> Self {
        Self {
            direct_route: true,
            proxy_routes: false,
            reserved_source_port: false,
            out_of_band_control: false,
            limitation_messages: vec![
                "Only direct TCP routes are available in the current RLogin adapter.".to_string(),
                "Reserved client ports 512-1023 are not allocated by the current adapter."
                    .to_string(),
                "TCP urgent/OOB control extraction is unavailable; ordinary stream bytes are never interpreted as urgent controls."
                    .to_string(),
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RloginDiagnosis {
    pub compatible: bool,
    pub requested_route: RouteKind,
    pub source_port_mode: RloginSourcePortMode,
    pub capabilities: RloginCapabilities,
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
}

impl RloginDiagnosis {
    pub fn for_options(options: &RloginConnectOptions) -> Self {
        let mut blockers = Vec::new();
        let mut warnings = Vec::new();
        if options.route != Route::Direct {
            blockers.push("The requested network route is not implemented for RLogin.".to_string());
        }
        if options.source_port_mode == RloginSourcePortMode::Reserved {
            blockers.push(
                "Reserved source-port mode is unavailable; choose ephemeral or auto fallback."
                    .to_string(),
            );
        }
        if options.source_port_mode == RloginSourcePortMode::Auto {
            warnings.push(
                "Auto source-port mode uses its documented ephemeral fallback because reserved allocation is unavailable."
                    .to_string(),
            );
        }
        if !options.plaintext_acknowledged {
            blockers.push("Plaintext RLogin risk has not been acknowledged.".to_string());
        }
        warnings.push(
            "Urgent/OOB controls and server-requested window updates are unavailable on this transport adapter."
                .to_string(),
        );
        Self {
            compatible: blockers.is_empty(),
            requested_route: options.route.kind(),
            source_port_mode: options.source_port_mode,
            capabilities: RloginCapabilities::production(),
            blockers,
            warnings,
        }
    }
}

fn validate_nonempty(field: &'static str, value: &str) -> Result<(), RloginError> {
    if value.is_empty() {
        return Err(RloginError::invalid(field, "must not be empty"));
    }
    Ok(())
}

fn validate_handshake_field(
    field: &'static str,
    value: &str,
    max_bytes: usize,
    required: bool,
) -> Result<(), RloginError> {
    if required {
        validate_nonempty(field, value)?;
    }
    if value.as_bytes().contains(&0) {
        return Err(RloginError::invalid(field, "must not contain a NUL byte"));
    }
    if value.len() > max_bytes {
        return Err(RloginError::invalid(
            field,
            format!("must not exceed {max_bytes} UTF-8 bytes"),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowSize {
    pub rows: u16,
    pub columns: u16,
    pub width_pixels: u16,
    pub height_pixels: u16,
}

impl Default for WindowSize {
    fn default() -> Self {
        Self {
            rows: 24,
            columns: 80,
            width_pixels: 0,
            height_pixels: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RloginLifecycle {
    Connecting,
    Connected,
    Closing,
    Closed,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalMode {
    Cooked,
    Raw,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LocalFlowAction {
    PauseOutput,
    ResumeOutput,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RloginStats {
    pub handshake_bytes_sent: u64,
    pub terminal_bytes_sent: u64,
    pub terminal_bytes_received: u64,
    pub protocol_bytes_sent: u64,
    pub resize_frames_sent: u64,
    pub urgent_controls_received: u64,
    pub discarded_output_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "code", content = "details", rename_all = "snake_case")]
pub enum RloginError {
    InvalidField {
        field: &'static str,
        reason: String,
    },
    HandshakeTimeout {
        timeout_ms: u64,
    },
    OperationTimeout {
        operation: &'static str,
        timeout_ms: u64,
    },
    Cancelled,
    ServerDiagnostic(String),
    ServerDiagnosticTooLong {
        limit: usize,
    },
    UnexpectedAcknowledgement(u8),
    Io(String),
    NotConnected,
    SessionNotFound,
    TransportUnavailable,
    PlaintextAcknowledgementRequired,
    UnsupportedRoute(RouteKind),
    ReservedSourcePortUnavailable,
    SessionLimitReached,
    SessionClosed,
    CommandQueueFull,
    CommandTimedOut,
    InputTooLarge,
    DeliveryUnavailable,
    Transport(TransportError),
}

impl RloginError {
    pub fn invalid(field: &'static str, reason: impl Into<String>) -> Self {
        Self::InvalidField {
            field,
            reason: reason.into(),
        }
    }

    pub fn io(error: impl fmt::Display) -> Self {
        Self::Io(error.to_string())
    }
}

impl fmt::Display for RloginError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidField { field, reason } => {
                write!(formatter, "invalid RLogin {field}: {reason}")
            }
            Self::HandshakeTimeout { timeout_ms } => {
                write!(
                    formatter,
                    "RLogin handshake timed out after {timeout_ms} ms"
                )
            }
            Self::OperationTimeout {
                operation,
                timeout_ms,
            } => write!(
                formatter,
                "RLogin {operation} timed out after {timeout_ms} ms"
            ),
            Self::Cancelled => write!(formatter, "RLogin operation was cancelled"),
            Self::ServerDiagnostic(message) => write!(
                formatter,
                "RLogin server rejected the connection: {message}"
            ),
            Self::ServerDiagnosticTooLong { limit } => write!(
                formatter,
                "RLogin server diagnostic exceeded the {limit}-byte safety limit"
            ),
            Self::UnexpectedAcknowledgement(code) => write!(
                formatter,
                "RLogin server returned unexpected acknowledgement 0x{code:02x}"
            ),
            Self::Io(message) => write!(formatter, "RLogin I/O error: {message}"),
            Self::NotConnected => write!(formatter, "RLogin session is not connected"),
            Self::SessionNotFound => write!(formatter, "RLogin session not found"),
            Self::TransportUnavailable => write!(
                formatter,
                "RLogin requires a resolved byte-stream transport adapter"
            ),
            Self::PlaintextAcknowledgementRequired => write!(
                formatter,
                "RLogin plaintext risk must be acknowledged before connecting"
            ),
            Self::UnsupportedRoute(route) => {
                write!(formatter, "RLogin route is unsupported: {route:?}")
            }
            Self::ReservedSourcePortUnavailable => write!(
                formatter,
                "reserved RLogin source ports are unavailable in this adapter"
            ),
            Self::SessionLimitReached => write!(formatter, "RLogin session limit reached"),
            Self::SessionClosed => write!(formatter, "RLogin session is closed"),
            Self::CommandQueueFull => write!(formatter, "RLogin command queue is full"),
            Self::CommandTimedOut => write!(formatter, "RLogin command timed out"),
            Self::InputTooLarge => write!(formatter, "RLogin input exceeds the safety limit"),
            Self::DeliveryUnavailable => write!(formatter, "RLogin output channel is unavailable"),
            Self::Transport(error) => write!(formatter, "RLogin transport error: {error}"),
        }
    }
}

impl std::error::Error for RloginError {}

impl From<TransportError> for RloginError {
    fn from(value: TransportError) -> Self {
        Self::Transport(value)
    }
}
