//! Core XDMCP data types, configuration, session info, errors.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::net::IpAddr;

// ── Protocol Constants ──────────────────────────────────────────────────────

/// XDMCP default UDP port (per RFC 1198).
pub const XDMCP_PORT: u16 = 177;

/// XDMCP protocol version.
pub const XDMCP_PROTOCOL_VERSION: u16 = 1;

// ── Message Types (opcodes) ─────────────────────────────────────────────────

/// XDMCP message opcodes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum XdmcpOpcode {
    /// Direct query: "are you a display manager?"
    Query,
    /// Broadcast: sent to 255.255.255.255 or subnet broadcast.
    BroadcastQuery,
    /// Indirect: ask an XDMCP manager list broker.
    IndirectQuery,
    /// Response to query: "yes, I'm willing".
    Willing,
    /// Response: "not willing" (busy, etc).
    Unwilling,
    /// Request a session.
    Request,
    /// Session accepted.
    Accept,
    /// Session declined.
    Decline,
    /// Start managing the display.
    Manage,
    /// Refuse the manage request.
    Refuse,
    /// Connection failed after accept.
    Failed,
    /// Forward query (used by XDMCP chooser).
    ForwardQuery,
    /// Keep-alive probe.
    KeepAlive,
    /// Keep-alive response.
    Alive,
}

impl XdmcpOpcode {
    /// Wire opcode value per RFC 1198.
    pub fn to_u16(&self) -> u16 {
        match self {
            Self::BroadcastQuery => 1,
            Self::Query => 2,
            Self::IndirectQuery => 3,
            Self::ForwardQuery => 4,
            Self::Willing => 5,
            Self::Unwilling => 6,
            Self::Request => 7,
            Self::Accept => 8,
            Self::Decline => 9,
            Self::Manage => 10,
            Self::Refuse => 11,
            Self::Failed => 12,
            Self::KeepAlive => 13,
            Self::Alive => 14,
        }
    }

    pub fn from_u16(v: u16) -> Option<Self> {
        match v {
            1 => Some(Self::BroadcastQuery),
            2 => Some(Self::Query),
            3 => Some(Self::IndirectQuery),
            4 => Some(Self::ForwardQuery),
            5 => Some(Self::Willing),
            6 => Some(Self::Unwilling),
            7 => Some(Self::Request),
            8 => Some(Self::Accept),
            9 => Some(Self::Decline),
            10 => Some(Self::Manage),
            11 => Some(Self::Refuse),
            12 => Some(Self::Failed),
            13 => Some(Self::KeepAlive),
            14 => Some(Self::Alive),
            _ => None,
        }
    }
}

// ── Authentication ──────────────────────────────────────────────────────────

/// XDMCP authentication name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum XdmcpAuthType {
    /// No authentication (most common).
    None,
    /// MIT-MAGIC-COOKIE-1.
    MitMagicCookie,
    /// XDM-AUTHORIZATION-1.
    XdmAuthorization,
    /// Custom/vendor-specific.
    Custom(String),
}

impl XdmcpAuthType {
    pub fn wire_name(&self) -> &str {
        match self {
            Self::None => "",
            Self::MitMagicCookie => "MIT-MAGIC-COOKIE-1",
            Self::XdmAuthorization => "XDM-AUTHORIZATION-1",
            Self::Custom(name) => name,
        }
    }
}

// ── Display Manager Info ────────────────────────────────────────────────────

/// Information about a discovered display manager.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayManagerInfo {
    pub address: IpAddr,
    pub hostname: String,
    pub status: String,
    pub auth_types: Vec<String>,
    pub willing: bool,
    pub discovered_at: String,
}

// ── X Server Type ───────────────────────────────────────────────────────────

/// The X server implementation to use on the client side.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum XServerType {
    /// Xephyr (nested X server — recommended).
    Xephyr,
    /// Xorg (full server, requires root / DRM access).
    Xorg,
    /// XWayland (X11 on Wayland).
    XWayland,
    /// Xvfb (virtual framebuffer, headless).
    Xvfb,
    /// VcXsrv (Windows X server).
    VcXsrv,
    /// Xming (Windows X server).
    Xming,
    /// MobaXterm (Windows X server).
    MobaXterm,
    /// Custom X server binary.
    Custom(String),
}

impl fmt::Display for XServerType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Xephyr => write!(f, "Xephyr"),
            Self::Xorg => write!(f, "Xorg"),
            Self::XWayland => write!(f, "XWayland"),
            Self::Xvfb => write!(f, "Xvfb"),
            Self::VcXsrv => write!(f, "VcXsrv"),
            Self::Xming => write!(f, "Xming"),
            Self::MobaXterm => write!(f, "MobaXterm"),
            Self::Custom(name) => write!(f, "{}", name),
        }
    }
}

// ── Session State ───────────────────────────────────────────────────────────

/// XDMCP session lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum XdmcpSessionState {
    /// Discovering display managers.
    Discovering,
    /// Sending Request.
    Requesting,
    /// Accepted, waiting for Manage.
    Accepted,
    /// X server is running, managing session.
    Running,
    /// Session ended normally.
    Ended,
    /// Session failed.
    Failed,
}

impl fmt::Display for XdmcpSessionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Discovering => write!(f, "discovering"),
            Self::Requesting => write!(f, "requesting"),
            Self::Accepted => write!(f, "accepted"),
            Self::Running => write!(f, "running"),
            Self::Ended => write!(f, "ended"),
            Self::Failed => write!(f, "failed"),
        }
    }
}

// ── Configuration ───────────────────────────────────────────────────────────

/// Full XDMCP connection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XdmcpConfig {
    pub host: String,
    pub port: u16,
    pub label: Option<String>,

    // Query
    pub query_type: Option<QueryType>,
    pub broadcast_address: Option<String>,

    // Authentication
    pub auth_type: Option<XdmcpAuthType>,
    pub auth_data: Option<Vec<u8>>,

    // Display
    pub display_number: Option<u32>,
    pub resolution_width: Option<u32>,
    pub resolution_height: Option<u32>,
    pub color_depth: Option<u8>,
    pub fullscreen: Option<bool>,

    // X Server
    pub x_server_type: Option<XServerType>,
    pub x_server_path: Option<String>,
    pub x_server_extra_args: Option<Vec<String>>,

    // Network
    pub connect_timeout: Option<u32>,
    pub keepalive_interval: Option<u32>,
    pub retry_count: Option<u32>,
}

/// Query discovery mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QueryType {
    Direct,
    Broadcast,
    Indirect,
}

impl Default for XdmcpConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: XDMCP_PORT,
            label: None,
            query_type: Some(QueryType::Direct),
            broadcast_address: None,
            auth_type: Some(XdmcpAuthType::None),
            auth_data: None,
            display_number: None,
            resolution_width: Some(1024),
            resolution_height: Some(768),
            color_depth: Some(24),
            fullscreen: Some(false),
            x_server_type: Some(XServerType::Xephyr),
            x_server_path: None,
            x_server_extra_args: None,
            connect_timeout: Some(30),
            keepalive_interval: Some(60),
            retry_count: Some(3),
        }
    }
}

// ── Session Info ────────────────────────────────────────────────────────────

/// Information about an XDMCP session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XdmcpSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub label: Option<String>,
    pub state: XdmcpSessionState,
    pub display_number: Option<u32>,
    pub session_id: Option<u32>,
    pub display_manager: Option<String>,
    pub resolution_width: u32,
    pub resolution_height: u32,
    pub x_server_type: String,
    pub connected_at: String,
    pub last_activity: String,
}

impl XdmcpSession {
    pub fn from_config(config: &XdmcpConfig, id: String, state: XdmcpSessionState) -> Self {
        Self {
            id,
            host: config.host.clone(),
            port: config.port,
            label: config.label.clone(),
            state,
            display_number: config.display_number,
            session_id: None,
            display_manager: None,
            resolution_width: config.resolution_width.unwrap_or(1024),
            resolution_height: config.resolution_height.unwrap_or(768),
            x_server_type: config
                .x_server_type
                .as_ref()
                .map(|x| x.to_string())
                .unwrap_or_else(|| "Xephyr".into()),
            connected_at: chrono::Utc::now().to_rfc3339(),
            last_activity: chrono::Utc::now().to_rfc3339(),
        }
    }
}

// ── Statistics ──────────────────────────────────────────────────────────────

/// Session statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XdmcpStats {
    pub session_id: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub packets_sent: u64,
    pub packets_received: u64,
    pub connected_at: String,
    pub last_activity: String,
    pub uptime_secs: u64,
    pub display_width: u32,
    pub display_height: u32,
    pub keepalive_count: u64,
    pub x_server_pid: Option<u32>,
}

// ── Errors ──────────────────────────────────────────────────────────────────

/// Error kind for XDMCP operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum XdmcpErrorKind {
    ConnectionFailed,
    Timeout,
    Declined,
    Refused,
    AuthenticationFailed,
    SessionNotFound,
    AlreadyConnected,
    XServerError,
    DiscoveryFailed,
    ProtocolError,
    Disconnected,
    IoError,
    Unknown,
}

/// XDMCP error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XdmcpError {
    pub kind: XdmcpErrorKind,
    pub message: String,
}

impl fmt::Display for XdmcpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for XdmcpError {}

impl From<std::io::Error> for XdmcpError {
    fn from(e: std::io::Error) -> Self {
        Self { kind: XdmcpErrorKind::IoError, message: e.to_string() }
    }
}

impl XdmcpError {
    pub fn new(kind: XdmcpErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }

    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(XdmcpErrorKind::ConnectionFailed, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(XdmcpErrorKind::Timeout, msg)
    }

    pub fn declined(msg: impl Into<String>) -> Self {
        Self::new(XdmcpErrorKind::Declined, msg)
    }

    pub fn refused(msg: impl Into<String>) -> Self {
        Self::new(XdmcpErrorKind::Refused, msg)
    }

    pub fn session_not_found(id: &str) -> Self {
        Self::new(XdmcpErrorKind::SessionNotFound, format!("session not found: {}", id))
    }

    pub fn protocol(msg: impl Into<String>) -> Self {
        Self::new(XdmcpErrorKind::ProtocolError, msg)
    }

    pub fn x_server(msg: impl Into<String>) -> Self {
        Self::new(XdmcpErrorKind::XServerError, msg)
    }

    pub fn disconnected(msg: impl Into<String>) -> Self {
        Self::new(XdmcpErrorKind::Disconnected, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(XdmcpErrorKind::SessionNotFound, msg)
    }

    pub fn already_exists(msg: impl Into<String>) -> Self {
        Self::new(XdmcpErrorKind::AlreadyConnected, msg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config() {
        let config = XdmcpConfig::default();
        assert_eq!(config.port, 177);
        assert_eq!(config.query_type, Some(QueryType::Direct));
    }

    #[test]
    fn opcode_roundtrip() {
        let opcodes = [
            XdmcpOpcode::Query,
            XdmcpOpcode::BroadcastQuery,
            XdmcpOpcode::Willing,
            XdmcpOpcode::Request,
            XdmcpOpcode::Accept,
            XdmcpOpcode::Decline,
            XdmcpOpcode::Manage,
            XdmcpOpcode::Refuse,
            XdmcpOpcode::Failed,
            XdmcpOpcode::KeepAlive,
            XdmcpOpcode::Alive,
        ];
        for op in opcodes {
            let code = op.to_u16();
            assert_eq!(XdmcpOpcode::from_u16(code), Some(op));
        }
    }

    #[test]
    fn error_display() {
        let err = XdmcpError::declined("busy");
        assert!(err.to_string().contains("busy"));
    }

    #[test]
    fn session_from_config() {
        let config = XdmcpConfig::default();
        let session = XdmcpSession::from_config(&config, "test".into(), XdmcpSessionState::Discovering);
        assert_eq!(session.state, XdmcpSessionState::Discovering);
    }

    #[test]
    fn auth_type_wire_name() {
        assert_eq!(XdmcpAuthType::None.wire_name(), "");
        assert_eq!(XdmcpAuthType::MitMagicCookie.wire_name(), "MIT-MAGIC-COOKIE-1");
    }
}
