use serde::{Deserialize, Serialize};
use sorng_socket_transport::{AddressFamily, LocalBind, Route, TransportError, TransportProtocol};
use std::net::IpAddr;
use std::time::Duration;
use thiserror::Error;

pub const MAX_ACTIVE_SESSIONS: usize = 64;
pub const MAX_TCP_SEND_BYTES: usize = 1024 * 1024;
pub const MAX_UDP_DATAGRAM_BYTES: usize = 65_507;
pub const MAX_REPLAY_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_REPLAY_FRAMES: usize = 4_096;
pub const MAX_READ_CHUNK_BYTES: usize = 64 * 1024;
pub const MAX_COMMAND_QUEUE_CAPACITY: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RawSocketTransport {
    Tcp,
    Udp,
}

impl RawSocketTransport {
    pub const fn protocol(self) -> TransportProtocol {
        match self {
            Self::Tcp => TransportProtocol::Tcp,
            Self::Udp => TransportProtocol::Udp,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSocketLimits {
    #[serde(default = "default_command_queue_capacity")]
    pub command_queue_capacity: usize,
    #[serde(default = "default_queue_wait_timeout_ms")]
    pub queue_wait_timeout_ms: u64,
    #[serde(default = "default_replay_frames")]
    pub replay_frames: usize,
    #[serde(default = "default_replay_bytes")]
    pub replay_bytes: usize,
    #[serde(default = "default_read_chunk_bytes")]
    pub read_chunk_bytes: usize,
    #[serde(default = "default_max_send_bytes")]
    pub max_send_bytes: usize,
}

impl Default for RawSocketLimits {
    fn default() -> Self {
        Self {
            command_queue_capacity: default_command_queue_capacity(),
            queue_wait_timeout_ms: default_queue_wait_timeout_ms(),
            replay_frames: default_replay_frames(),
            replay_bytes: default_replay_bytes(),
            read_chunk_bytes: default_read_chunk_bytes(),
            max_send_bytes: default_max_send_bytes(),
        }
    }
}

impl RawSocketLimits {
    pub(crate) fn validate(&self, transport: RawSocketTransport) -> Result<(), RawSocketError> {
        let max_payload = match transport {
            RawSocketTransport::Tcp => MAX_TCP_SEND_BYTES,
            RawSocketTransport::Udp => MAX_UDP_DATAGRAM_BYTES,
        };
        if self.command_queue_capacity == 0
            || self.command_queue_capacity > MAX_COMMAND_QUEUE_CAPACITY
            || self.queue_wait_timeout_ms == 0
            || self.queue_wait_timeout_ms > 60_000
            || self.replay_frames > MAX_REPLAY_FRAMES
            || self.replay_bytes > MAX_REPLAY_BYTES
            || self.read_chunk_bytes == 0
            || self.read_chunk_bytes > MAX_READ_CHUNK_BYTES
            || self.max_send_bytes == 0
            || self.max_send_bytes > max_payload
        {
            return Err(RawSocketError::InvalidConfiguration);
        }
        Ok(())
    }
}

const fn default_command_queue_capacity() -> usize {
    64
}

const fn default_queue_wait_timeout_ms() -> u64 {
    2_000
}

const fn default_replay_frames() -> usize {
    512
}

const fn default_replay_bytes() -> usize {
    2 * 1024 * 1024
}

const fn default_read_chunk_bytes() -> usize {
    16 * 1024
}

const fn default_max_send_bytes() -> usize {
    MAX_UDP_DATAGRAM_BYTES
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSocketConnectOptions {
    pub host: String,
    pub port: u16,
    pub transport: RawSocketTransport,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub route: Route,
    #[serde(default)]
    pub address_family: AddressFamily,
    #[serde(default)]
    pub local_bind_address: Option<IpAddr>,
    #[serde(default)]
    pub local_bind_port: u16,
    #[serde(default = "default_connect_timeout_ms")]
    pub connect_timeout_ms: u64,
    #[serde(default = "default_write_timeout_ms")]
    pub write_timeout_ms: u64,
    #[serde(default = "default_idle_timeout_ms")]
    pub idle_timeout_ms: u64,
    #[serde(default = "default_true")]
    pub tcp_no_delay: bool,
    #[serde(default = "default_keepalive_ms")]
    pub tcp_keepalive_ms: Option<u64>,
    #[serde(default)]
    pub limits: RawSocketLimits,
}

impl RawSocketConnectOptions {
    pub(crate) fn validate(&self) -> Result<(), RawSocketError> {
        self.limits.validate(self.transport)?;
        if self.host.trim().is_empty()
            || self.host.len() > 253
            || self.port == 0
            || self.connect_timeout_ms == 0
            || self.write_timeout_ms == 0
            || self.idle_timeout_ms == 0
            || self.connect_timeout_ms > 86_400_000
            || self.write_timeout_ms > 86_400_000
            || self.idle_timeout_ms > 86_400_000
            || self
                .tcp_keepalive_ms
                .is_some_and(|value| value == 0 || value > 86_400_000)
            || self.connection_id.as_ref().is_some_and(|id| id.len() > 256)
        {
            return Err(RawSocketError::InvalidConfiguration);
        }
        Ok(())
    }

    pub(crate) fn local_bind(&self) -> Option<LocalBind> {
        self.local_bind_address.map(|address| LocalBind {
            address,
            port: self.local_bind_port,
        })
    }

    pub(crate) fn timeouts(&self) -> sorng_socket_transport::IoTimeouts {
        sorng_socket_transport::IoTimeouts {
            connect: Duration::from_millis(self.connect_timeout_ms),
            write: Duration::from_millis(self.write_timeout_ms),
            idle: Duration::from_millis(self.idle_timeout_ms),
        }
    }
}

const fn default_connect_timeout_ms() -> u64 {
    10_000
}

const fn default_write_timeout_ms() -> u64 {
    10_000
}

const fn default_idle_timeout_ms() -> u64 {
    5 * 60 * 1_000
}

const fn default_keepalive_ms() -> Option<u64> {
    Some(60_000)
}

const fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RawSocketStatus {
    Connected,
    WriteClosed,
    Closing,
    Disconnected,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RawSocketDirection {
    Inbound,
    Outbound,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSocketStats {
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub frames_sent: u64,
    pub frames_received: u64,
    pub datagrams_sent: u64,
    pub datagrams_received: u64,
    pub delivery_failures: u64,
    pub replay_evictions: u64,
    pub connected_at_ms: i64,
    pub last_activity_at_ms: i64,
    pub disconnected_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSocketSession {
    pub id: String,
    pub connection_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub transport: RawSocketTransport,
    pub status: RawSocketStatus,
    pub local_address: String,
    pub remote_address: String,
    pub stats: RawSocketStats,
    pub terminal_reason: Option<RawSocketTerminalReason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSocketFrame {
    pub sequence: u64,
    pub timestamp_ms: i64,
    pub direction: RawSocketDirection,
    pub datagram: bool,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSocketFrameMetadata {
    pub session_id: String,
    pub sequence: u64,
    pub timestamp_ms: i64,
    pub direction: RawSocketDirection,
    pub datagram: bool,
    pub byte_length: usize,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RawSocketEvent {
    Connected {
        session: RawSocketSession,
    },
    Data {
        frame: RawSocketFrameMetadata,
    },
    WriteClosed {
        session_id: String,
    },
    ReplayStarted {
        session_id: String,
        frame_count: usize,
    },
    ReplayCompleted {
        session_id: String,
        frame_count: usize,
    },
    Detached {
        session_id: String,
    },
    Disconnected {
        session: RawSocketSession,
        reason: RawSocketTerminalReason,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RawSocketTerminalReason {
    Requested,
    PeerEof,
    IdleTimeout,
    CommandChannelClosed,
    TransportError { error: TransportError },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSocketReplay {
    pub session_id: String,
    pub frames: Vec<RawSocketFrame>,
    pub evicted_frames: u64,
}

#[derive(Debug, Error, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", content = "details", rename_all = "snake_case")]
pub enum RawSocketError {
    #[error("raw socket configuration is invalid")]
    InvalidConfiguration,
    #[error("the raw socket session limit has been reached")]
    SessionLimitReached,
    #[error("raw socket session was not found")]
    SessionNotFound,
    #[error("raw socket session is closed")]
    SessionClosed,
    #[error("raw socket command queue is full")]
    CommandQueueFull,
    #[error("raw socket command timed out")]
    CommandTimedOut,
    #[error("payload exceeds the configured raw socket limit")]
    PayloadTooLarge,
    #[error("write-half shutdown is only valid for TCP sessions")]
    HalfCloseUnsupported,
    #[error("raw socket delivery channel is unavailable")]
    DeliveryUnavailable,
    #[error(transparent)]
    Transport(#[from] TransportError),
}
