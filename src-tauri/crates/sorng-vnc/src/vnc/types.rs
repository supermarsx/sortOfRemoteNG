//! VNC/RFB types: configuration, session metadata, pixel formats, events, errors.

use serde::{Deserialize, Serialize};
use std::fmt;

// ── RFB Protocol Version ────────────────────────────────────────────────

/// Supported RFB protocol versions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RfbVersion {
    /// RFB 3.3 — original version, limited security.
    V3_3,
    /// RFB 3.7 — multiple security type negotiation.
    V3_7,
    /// RFB 3.8 — improved error reporting.
    V3_8,
}

impl RfbVersion {
    /// Parse from the 12-byte server version string.
    pub fn from_version_string(s: &str) -> Option<Self> {
        let trimmed = s.trim();
        if trimmed.starts_with("RFB 003.008") {
            Some(Self::V3_8)
        } else if trimmed.starts_with("RFB 003.007") {
            Some(Self::V3_7)
        } else if trimmed.starts_with("RFB 003.003") {
            Some(Self::V3_3)
        } else {
            None
        }
    }

    /// The 12-byte version string we send as our client version.
    pub fn client_version_string() -> &'static [u8; 12] {
        b"RFB 003.008\n"
    }
}

impl fmt::Display for RfbVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::V3_3 => write!(f, "3.3"),
            Self::V3_7 => write!(f, "3.7"),
            Self::V3_8 => write!(f, "3.8"),
        }
    }
}

// ── Security Types ──────────────────────────────────────────────────────

/// RFB security types (RFC 6143 §7.1.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum SecurityType {
    /// No authentication required.
    None = 1,
    /// VNC authentication (DES challenge-response).
    VncAuthentication = 2,
    /// Tight security (TightVNC extension).
    Tight = 16,
    /// VeNCrypt — TLS wrapper.
    VeNCrypt = 19,
    /// Apple Remote Desktop (ARD).
    AppleRemoteDesktop = 30,
}

impl SecurityType {
    pub fn from_byte(b: u8) -> Option<Self> {
        match b {
            1 => Some(Self::None),
            2 => Some(Self::VncAuthentication),
            16 => Some(Self::Tight),
            19 => Some(Self::VeNCrypt),
            30 => Some(Self::AppleRemoteDesktop),
            _ => None,
        }
    }

    pub fn to_byte(&self) -> u8 {
        *self as u8
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::None => "None",
            Self::VncAuthentication => "VNC Authentication",
            Self::Tight => "Tight",
            Self::VeNCrypt => "VeNCrypt",
            Self::AppleRemoteDesktop => "Apple Remote Desktop",
        }
    }
}

impl fmt::Display for SecurityType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.name())
    }
}

// ── Pixel Format ────────────────────────────────────────────────────────

/// RFB pixel format descriptor (§7.4).
/// Describes how pixels are encoded in framebuffer pixel data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PixelFormat {
    /// Bits per pixel (8, 16, or 32).
    pub bits_per_pixel: u8,
    /// Number of useful bits in each pixel value.
    pub depth: u8,
    /// Non-zero = most significant byte first.
    pub big_endian: bool,
    /// Non-zero = true colour (as opposed to colour-map).
    pub true_colour: bool,
    /// Maximum value for red in true colour mode.
    pub red_max: u16,
    /// Maximum value for green in true colour mode.
    pub green_max: u16,
    /// Maximum value for blue in true colour mode.
    pub blue_max: u16,
    /// Bit shift for red channel.
    pub red_shift: u8,
    /// Bit shift for green channel.
    pub green_shift: u8,
    /// Bit shift for blue channel.
    pub blue_shift: u8,
}

impl PixelFormat {
    /// Standard 32-bit RGBA pixel format.
    pub fn rgba32() -> Self {
        Self {
            bits_per_pixel: 32,
            depth: 24,
            big_endian: false,
            true_colour: true,
            red_max: 255,
            green_max: 255,
            blue_max: 255,
            red_shift: 16,
            green_shift: 8,
            blue_shift: 0,
        }
    }

    /// Standard 16-bit RGB565 format.
    pub fn rgb565() -> Self {
        Self {
            bits_per_pixel: 16,
            depth: 16,
            big_endian: false,
            true_colour: true,
            red_max: 31,
            green_max: 63,
            blue_max: 31,
            red_shift: 11,
            green_shift: 5,
            blue_shift: 0,
        }
    }

    /// 8-bit indexed colour (colour map).
    pub fn indexed8() -> Self {
        Self {
            bits_per_pixel: 8,
            depth: 8,
            big_endian: false,
            true_colour: false,
            red_max: 7,
            green_max: 7,
            blue_max: 3,
            red_shift: 0,
            green_shift: 3,
            blue_shift: 6,
        }
    }

    /// Serialize to the 16-byte wire format.
    pub fn to_bytes(&self) -> [u8; 16] {
        let mut buf = [0u8; 16];
        buf[0] = self.bits_per_pixel;
        buf[1] = self.depth;
        buf[2] = if self.big_endian { 1 } else { 0 };
        buf[3] = if self.true_colour { 1 } else { 0 };
        buf[4] = (self.red_max >> 8) as u8;
        buf[5] = (self.red_max & 0xFF) as u8;
        buf[6] = (self.green_max >> 8) as u8;
        buf[7] = (self.green_max & 0xFF) as u8;
        buf[8] = (self.blue_max >> 8) as u8;
        buf[9] = (self.blue_max & 0xFF) as u8;
        buf[10] = self.red_shift;
        buf[11] = self.green_shift;
        buf[12] = self.blue_shift;
        // 13..16 = padding
        buf
    }

    /// Parse from the 16-byte wire format.
    pub fn from_bytes(buf: &[u8; 16]) -> Self {
        Self {
            bits_per_pixel: buf[0],
            depth: buf[1],
            big_endian: buf[2] != 0,
            true_colour: buf[3] != 0,
            red_max: (buf[4] as u16) << 8 | buf[5] as u16,
            green_max: (buf[6] as u16) << 8 | buf[7] as u16,
            blue_max: (buf[8] as u16) << 8 | buf[9] as u16,
            red_shift: buf[10],
            green_shift: buf[11],
            blue_shift: buf[12],
        }
    }

    /// Bytes per pixel (1, 2, or 4).
    pub fn bytes_per_pixel(&self) -> usize {
        (self.bits_per_pixel as usize + 7) / 8
    }
}

impl Default for PixelFormat {
    fn default() -> Self {
        Self::rgba32()
    }
}

impl fmt::Display for PixelFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.true_colour {
            write!(
                f,
                "{}bpp depth={} R:{}/{}  G:{}/{}  B:{}/{} {}",
                self.bits_per_pixel,
                self.depth,
                self.red_max,
                self.red_shift,
                self.green_max,
                self.green_shift,
                self.blue_max,
                self.blue_shift,
                if self.big_endian { "BE" } else { "LE" }
            )
        } else {
            write!(f, "{}bpp indexed colour", self.bits_per_pixel)
        }
    }
}

// ── Encoding Types ──────────────────────────────────────────────────────

/// RFB encoding types (§7.7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EncodingType {
    /// Raw pixel data.
    Raw,
    /// Copy rectangle from another area.
    CopyRect,
    /// RRE — Rise and Run length Encoding.
    RRE,
    /// Hextile — tiled encoding.
    Hextile,
    /// TRLE — Tight Run-Length Encoding.
    TRLE,
    /// ZRLE — Zlib compressed TRLE.
    ZRLE,
    /// Tight — TightVNC encoding.
    Tight,
    /// Cursor pseudo-encoding (local cursor rendering).
    CursorPseudo,
    /// DesktopSize pseudo-encoding.
    DesktopSizePseudo,
    /// ContinuousUpdates pseudo-encoding.
    ContinuousUpdatesPseudo,
    /// LastRect pseudo-encoding.
    LastRectPseudo,
    /// Extended desktop size
    ExtendedDesktopSizePseudo,
    /// Unknown / custom encoding.
    Other(i32),
}

impl EncodingType {
    /// Encoding type as a signed 32-bit integer for the wire.
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Raw => 0,
            Self::CopyRect => 1,
            Self::RRE => 2,
            Self::Hextile => 5,
            Self::TRLE => 15,
            Self::ZRLE => 16,
            Self::Tight => 7,
            Self::CursorPseudo => -239,
            Self::DesktopSizePseudo => -223,
            Self::ContinuousUpdatesPseudo => -313,
            Self::LastRectPseudo => -224,
            Self::ExtendedDesktopSizePseudo => -308,
            Self::Other(v) => *v,
        }
    }

    /// Parse from a signed 32-bit integer.
    pub fn from_i32(v: i32) -> Self {
        match v {
            0 => Self::Raw,
            1 => Self::CopyRect,
            2 => Self::RRE,
            5 => Self::Hextile,
            15 => Self::TRLE,
            16 => Self::ZRLE,
            7 => Self::Tight,
            -239 => Self::CursorPseudo,
            -223 => Self::DesktopSizePseudo,
            -313 => Self::ContinuousUpdatesPseudo,
            -224 => Self::LastRectPseudo,
            -308 => Self::ExtendedDesktopSizePseudo,
            other => Self::Other(other),
        }
    }

    pub fn name(&self) -> String {
        match self {
            Self::Raw => "Raw".into(),
            Self::CopyRect => "CopyRect".into(),
            Self::RRE => "RRE".into(),
            Self::Hextile => "Hextile".into(),
            Self::TRLE => "TRLE".into(),
            Self::ZRLE => "ZRLE".into(),
            Self::Tight => "Tight".into(),
            Self::CursorPseudo => "Cursor (pseudo)".into(),
            Self::DesktopSizePseudo => "DesktopSize (pseudo)".into(),
            Self::ContinuousUpdatesPseudo => "ContinuousUpdates (pseudo)".into(),
            Self::LastRectPseudo => "LastRect (pseudo)".into(),
            Self::ExtendedDesktopSizePseudo => "ExtendedDesktopSize (pseudo)".into(),
            Self::Other(v) => format!("Unknown({})", v),
        }
    }
}

// ── Client → Server Message Types ───────────────────────────────────────

/// Client-to-server message type codes (§7.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ClientMessageType {
    SetPixelFormat = 0,
    SetEncodings = 2,
    FramebufferUpdateRequest = 3,
    KeyEvent = 4,
    PointerEvent = 5,
    ClientCutText = 6,
}

// ── Server → Client Message Types ───────────────────────────────────────

/// Server-to-client message type codes (§7.6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ServerMessageType {
    FramebufferUpdate = 0,
    SetColourMapEntries = 1,
    Bell = 2,
    ServerCutText = 3,
}

impl ServerMessageType {
    pub fn from_byte(b: u8) -> Option<Self> {
        match b {
            0 => Some(Self::FramebufferUpdate),
            1 => Some(Self::SetColourMapEntries),
            2 => Some(Self::Bell),
            3 => Some(Self::ServerCutText),
            _ => None,
        }
    }
}

// ── Key Event Symbols (X11 keysym subset) ───────────────────────────────

/// Common X11 keysym values used in VNC key events.
pub mod keysym {
    pub const BACKSPACE: u32 = 0xFF08;
    pub const TAB: u32 = 0xFF09;
    pub const RETURN: u32 = 0xFF0D;
    pub const ESCAPE: u32 = 0xFF1B;
    pub const INSERT: u32 = 0xFF63;
    pub const DELETE: u32 = 0xFFFF;
    pub const HOME: u32 = 0xFF50;
    pub const END: u32 = 0xFF57;
    pub const PAGE_UP: u32 = 0xFF55;
    pub const PAGE_DOWN: u32 = 0xFF56;
    pub const LEFT: u32 = 0xFF51;
    pub const UP: u32 = 0xFF52;
    pub const RIGHT: u32 = 0xFF53;
    pub const DOWN: u32 = 0xFF54;
    pub const F1: u32 = 0xFFBE;
    pub const F2: u32 = 0xFFBF;
    pub const F3: u32 = 0xFFC0;
    pub const F4: u32 = 0xFFC1;
    pub const F5: u32 = 0xFFC2;
    pub const F6: u32 = 0xFFC3;
    pub const F7: u32 = 0xFFC4;
    pub const F8: u32 = 0xFFC5;
    pub const F9: u32 = 0xFFC6;
    pub const F10: u32 = 0xFFC7;
    pub const F11: u32 = 0xFFC8;
    pub const F12: u32 = 0xFFC9;
    pub const SHIFT_L: u32 = 0xFFE1;
    pub const SHIFT_R: u32 = 0xFFE2;
    pub const CONTROL_L: u32 = 0xFFE3;
    pub const CONTROL_R: u32 = 0xFFE4;
    pub const META_L: u32 = 0xFFE7;
    pub const META_R: u32 = 0xFFE8;
    pub const ALT_L: u32 = 0xFFE9;
    pub const ALT_R: u32 = 0xFFEA;
    pub const SUPER_L: u32 = 0xFFEB;
    pub const SUPER_R: u32 = 0xFFEC;
    pub const CAPS_LOCK: u32 = 0xFFE5;
    pub const NUM_LOCK: u32 = 0xFF7F;
    pub const SCROLL_LOCK: u32 = 0xFF14;
}

// ── Mouse Button Mask ───────────────────────────────────────────────────

/// Mouse button mask bits for VNC pointer events.
pub mod mouse_button {
    pub const LEFT: u8 = 1;
    pub const MIDDLE: u8 = 2;
    pub const RIGHT: u8 = 4;
    pub const SCROLL_UP: u8 = 8;
    pub const SCROLL_DOWN: u8 = 16;
}

// ── Configuration ───────────────────────────────────────────────────────

/// Configuration for a new VNC connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncConfig {
    /// Target host.
    pub host: String,
    /// Target port (default 5900).
    #[serde(default = "default_vnc_port")]
    pub port: u16,
    /// VNC password (used with VNC Authentication security type).
    pub password: Option<String>,
    /// Username (some servers support this with VeNCrypt or Tight).
    pub username: Option<String>,
    /// Preferred pixel format (None = use server default).
    pub pixel_format: Option<PixelFormat>,
    /// Preferred encodings, most desired first.
    #[serde(default = "default_encodings")]
    pub encodings: Vec<String>,
    /// Request shared desktop (allow other clients).
    #[serde(default = "default_true")]
    pub shared: bool,
    /// View-only mode — no keyboard/mouse events will be sent.
    #[serde(default)]
    pub view_only: bool,
    /// TCP connect timeout in seconds.
    #[serde(default = "default_connect_timeout")]
    pub connect_timeout_secs: u64,
    /// Framebuffer update request interval (ms).
    #[serde(default = "default_update_interval")]
    pub update_interval_ms: u64,
    /// Whether to request local cursor rendering via pseudo-encoding.
    #[serde(default = "default_true")]
    pub local_cursor: bool,
    /// Show the server desktop name in the session info.
    #[serde(default = "default_true")]
    pub show_desktop_name: bool,
    /// Connection label / friendly name.
    pub label: Option<String>,
    /// JPEG quality (1-9) for Tight encoding, 0 = lossless. Ignored if Tight isn't used.
    #[serde(default = "default_jpeg_quality")]
    pub jpeg_quality: u8,
    /// Compression level (0-9) for Tight or ZRLE.
    #[serde(default = "default_compression")]
    pub compression_level: u8,
    /// Keep-alive interval in seconds (0 = disabled, sends FramebufferUpdateRequest).
    #[serde(default)]
    pub keepalive_interval_secs: u64,
}

fn default_vnc_port() -> u16 { 5900 }
fn default_true() -> bool { true }
fn default_connect_timeout() -> u64 { 15 }
fn default_update_interval() -> u64 { 33 } // ~30 fps
fn default_jpeg_quality() -> u8 { 6 }
fn default_compression() -> u8 { 2 }
fn default_encodings() -> Vec<String> {
    vec![
        "ZRLE".into(),
        "Tight".into(),
        "Hextile".into(),
        "CopyRect".into(),
        "Raw".into(),
    ]
}

impl Default for VncConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: default_vnc_port(),
            password: None,
            username: None,
            pixel_format: None,
            encodings: default_encodings(),
            shared: true,
            view_only: false,
            connect_timeout_secs: default_connect_timeout(),
            update_interval_ms: default_update_interval(),
            local_cursor: true,
            show_desktop_name: true,
            label: None,
            jpeg_quality: default_jpeg_quality(),
            compression_level: default_compression(),
            keepalive_interval_secs: 0,
        }
    }
}

// ── Session metadata ────────────────────────────────────────────────────

/// Metadata about a live (or recently closed) VNC session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub connected: bool,
    pub username: Option<String>,
    pub label: Option<String>,
    /// Negotiated RFB protocol version string (e.g. "3.8").
    pub protocol_version: Option<String>,
    /// Security type used.
    pub security_type: Option<String>,
    /// Server desktop name.
    pub server_name: Option<String>,
    /// Framebuffer width in pixels.
    pub framebuffer_width: u16,
    /// Framebuffer height in pixels.
    pub framebuffer_height: u16,
    /// Current pixel format description string.
    pub pixel_format: String,
    /// ISO-8601 when session was created.
    pub connected_at: String,
    /// ISO-8601 of last activity.
    pub last_activity: String,
    /// Total framebuffer update messages received.
    pub frame_count: u64,
    /// Total bytes received.
    pub bytes_received: u64,
    /// Total bytes sent.
    pub bytes_sent: u64,
    /// View-only mode indicator.
    pub view_only: bool,
}

impl VncSession {
    pub fn from_config(id: String, config: &VncConfig) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id,
            host: config.host.clone(),
            port: config.port,
            connected: true,
            username: config.username.clone(),
            label: config.label.clone(),
            protocol_version: None,
            security_type: None,
            server_name: None,
            framebuffer_width: 0,
            framebuffer_height: 0,
            pixel_format: String::new(),
            connected_at: now.clone(),
            last_activity: now,
            frame_count: 0,
            bytes_received: 0,
            bytes_sent: 0,
            view_only: config.view_only,
        }
    }
}

// ── Events emitted to the frontend ──────────────────────────────────────

/// Framebuffer update event payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncFrameEvent {
    pub session_id: String,
    /// Base64-encoded raw pixel data (RGBA).
    pub data: String,
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

/// Bell event (server requests attention).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncBellEvent {
    pub session_id: String,
}

/// Server cut-text (clipboard) event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncClipboardEvent {
    pub session_id: String,
    pub text: String,
}

/// Session state change event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncStateEvent {
    pub session_id: String,
    pub state: String,
    pub message: String,
}

/// Desktop resize event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncResizeEvent {
    pub session_id: String,
    pub width: u16,
    pub height: u16,
}

/// Cursor update event (pseudo-encoding).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncCursorEvent {
    pub session_id: String,
    /// Base64-encoded RGBA cursor image.
    pub data: String,
    pub width: u16,
    pub height: u16,
    pub hotspot_x: u16,
    pub hotspot_y: u16,
}

// ── Error type ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum VncErrorKind {
    ConnectionRefused,
    Timeout,
    DnsResolution,
    Io,
    ProtocolViolation,
    UnsupportedVersion,
    AuthFailed,
    AuthUnsupported,
    SessionNotFound,
    AlreadyConnected,
    NotConnected,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncError {
    pub kind: VncErrorKind,
    pub message: String,
}

impl fmt::Display for VncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for VncError {}

impl VncError {
    pub fn new(kind: VncErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn session_not_found(id: &str) -> Self {
        Self::new(VncErrorKind::SessionNotFound, format!("Session '{}' not found", id))
    }
    pub fn protocol(msg: impl Into<String>) -> Self {
        Self::new(VncErrorKind::ProtocolViolation, msg)
    }
    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(VncErrorKind::AuthFailed, msg)
    }
    pub fn io(msg: impl Into<String>) -> Self {
        Self::new(VncErrorKind::Io, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(VncErrorKind::Timeout, msg)
    }
}

impl From<std::io::Error> for VncError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::ConnectionRefused => {
                Self::new(VncErrorKind::ConnectionRefused, e.to_string())
            }
            std::io::ErrorKind::TimedOut => {
                Self::new(VncErrorKind::Timeout, e.to_string())
            }
            _ => Self::new(VncErrorKind::Io, e.to_string()),
        }
    }
}

// ── Session statistics ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncStats {
    pub session_id: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub frame_count: u64,
    pub connected_at: String,
    pub last_activity: String,
    pub uptime_secs: u64,
    pub framebuffer_width: u16,
    pub framebuffer_height: u16,
    pub pixel_format: String,
    pub encoding: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── RfbVersion ──────────────────────────────────────────────────

    #[test]
    fn rfb_version_parse_3_8() {
        assert_eq!(
            RfbVersion::from_version_string("RFB 003.008\n"),
            Some(RfbVersion::V3_8)
        );
    }

    #[test]
    fn rfb_version_parse_3_7() {
        assert_eq!(
            RfbVersion::from_version_string("RFB 003.007\n"),
            Some(RfbVersion::V3_7)
        );
    }

    #[test]
    fn rfb_version_parse_3_3() {
        assert_eq!(
            RfbVersion::from_version_string("RFB 003.003\n"),
            Some(RfbVersion::V3_3)
        );
    }

    #[test]
    fn rfb_version_parse_unknown() {
        assert!(RfbVersion::from_version_string("RFB 004.000\n").is_none());
    }

    #[test]
    fn rfb_version_display() {
        assert_eq!(format!("{}", RfbVersion::V3_8), "3.8");
    }

    #[test]
    fn rfb_client_version_string() {
        assert_eq!(RfbVersion::client_version_string(), b"RFB 003.008\n");
    }

    // ── SecurityType ────────────────────────────────────────────────

    #[test]
    fn security_type_from_byte() {
        assert_eq!(SecurityType::from_byte(1), Some(SecurityType::None));
        assert_eq!(SecurityType::from_byte(2), Some(SecurityType::VncAuthentication));
        assert_eq!(SecurityType::from_byte(16), Some(SecurityType::Tight));
        assert_eq!(SecurityType::from_byte(19), Some(SecurityType::VeNCrypt));
        assert_eq!(SecurityType::from_byte(30), Some(SecurityType::AppleRemoteDesktop));
        assert!(SecurityType::from_byte(99).is_none());
    }

    #[test]
    fn security_type_name() {
        assert_eq!(SecurityType::None.name(), "None");
        assert_eq!(SecurityType::VncAuthentication.name(), "VNC Authentication");
    }

    // ── PixelFormat ─────────────────────────────────────────────────

    #[test]
    fn pixel_format_rgba32() {
        let pf = PixelFormat::rgba32();
        assert_eq!(pf.bits_per_pixel, 32);
        assert_eq!(pf.depth, 24);
        assert!(!pf.big_endian);
        assert!(pf.true_colour);
        assert_eq!(pf.red_max, 255);
        assert_eq!(pf.bytes_per_pixel(), 4);
    }

    #[test]
    fn pixel_format_rgb565() {
        let pf = PixelFormat::rgb565();
        assert_eq!(pf.bits_per_pixel, 16);
        assert_eq!(pf.red_max, 31);
        assert_eq!(pf.green_max, 63);
        assert_eq!(pf.bytes_per_pixel(), 2);
    }

    #[test]
    fn pixel_format_indexed8() {
        let pf = PixelFormat::indexed8();
        assert_eq!(pf.bits_per_pixel, 8);
        assert!(!pf.true_colour);
        assert_eq!(pf.bytes_per_pixel(), 1);
    }

    #[test]
    fn pixel_format_bytes_roundtrip() {
        let pf = PixelFormat::rgba32();
        let bytes = pf.to_bytes();
        let parsed = PixelFormat::from_bytes(&bytes);
        assert_eq!(pf, parsed);
    }

    #[test]
    fn pixel_format_rgb565_bytes_roundtrip() {
        let pf = PixelFormat::rgb565();
        let bytes = pf.to_bytes();
        let parsed = PixelFormat::from_bytes(&bytes);
        assert_eq!(pf, parsed);
    }

    #[test]
    fn pixel_format_display_truecolour() {
        let s = format!("{}", PixelFormat::rgba32());
        assert!(s.contains("32bpp"));
        assert!(s.contains("LE"));
    }

    #[test]
    fn pixel_format_display_indexed() {
        let s = format!("{}", PixelFormat::indexed8());
        assert!(s.contains("indexed"));
    }

    // ── EncodingType ────────────────────────────────────────────────

    #[test]
    fn encoding_type_roundtrip() {
        let types = vec![
            EncodingType::Raw,
            EncodingType::CopyRect,
            EncodingType::RRE,
            EncodingType::Hextile,
            EncodingType::TRLE,
            EncodingType::ZRLE,
            EncodingType::Tight,
            EncodingType::CursorPseudo,
            EncodingType::DesktopSizePseudo,
        ];
        for t in types {
            let v = t.to_i32();
            assert_eq!(EncodingType::from_i32(v), t);
        }
    }

    #[test]
    fn encoding_type_other() {
        let e = EncodingType::from_i32(9999);
        assert_eq!(e, EncodingType::Other(9999));
        assert_eq!(e.to_i32(), 9999);
    }

    #[test]
    fn encoding_type_name() {
        assert_eq!(EncodingType::Raw.name(), "Raw");
        assert_eq!(EncodingType::ZRLE.name(), "ZRLE");
        assert_eq!(EncodingType::Other(42).name(), "Unknown(42)");
    }

    // ── ServerMessageType ───────────────────────────────────────────

    #[test]
    fn server_msg_type_from_byte() {
        assert_eq!(ServerMessageType::from_byte(0), Some(ServerMessageType::FramebufferUpdate));
        assert_eq!(ServerMessageType::from_byte(2), Some(ServerMessageType::Bell));
        assert!(ServerMessageType::from_byte(99).is_none());
    }

    // ── VncConfig ───────────────────────────────────────────────────

    #[test]
    fn config_default() {
        let cfg = VncConfig::default();
        assert_eq!(cfg.port, 5900);
        assert!(cfg.shared);
        assert!(!cfg.view_only);
        assert!(cfg.local_cursor);
        assert_eq!(cfg.connect_timeout_secs, 15);
        assert_eq!(cfg.update_interval_ms, 33);
        assert_eq!(cfg.jpeg_quality, 6);
        assert_eq!(cfg.compression_level, 2);
    }

    #[test]
    fn config_serde_roundtrip() {
        let cfg = VncConfig {
            host: "10.0.0.5".into(),
            port: 5901,
            password: Some("secret".into()),
            label: Some("Server".into()),
            ..Default::default()
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let de: VncConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(de.host, "10.0.0.5");
        assert_eq!(de.port, 5901);
        assert_eq!(de.password.as_deref(), Some("secret"));
    }

    #[test]
    fn config_deserialize_minimal() {
        let json = r#"{"host":"10.0.0.1"}"#;
        let cfg: VncConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.host, "10.0.0.1");
        assert_eq!(cfg.port, 5900);
        assert!(cfg.shared);
    }

    // ── VncSession ──────────────────────────────────────────────────

    #[test]
    fn session_from_config() {
        let cfg = VncConfig {
            host: "host.example.com".into(),
            port: 5900,
            username: Some("admin".into()),
            label: Some("Desktop".into()),
            view_only: true,
            ..Default::default()
        };
        let s = VncSession::from_config("sess-1".into(), &cfg);
        assert_eq!(s.id, "sess-1");
        assert!(s.connected);
        assert!(s.view_only);
        assert_eq!(s.host, "host.example.com");
        assert_eq!(s.label.as_deref(), Some("Desktop"));
    }

    #[test]
    fn session_serde_roundtrip() {
        let cfg = VncConfig { host: "10.0.0.1".into(), ..Default::default() };
        let s = VncSession::from_config("s1".into(), &cfg);
        let json = serde_json::to_string(&s).unwrap();
        let de: VncSession = serde_json::from_str(&json).unwrap();
        assert_eq!(de.id, "s1");
    }

    // ── Event payloads ──────────────────────────────────────────────

    #[test]
    fn frame_event_serde() {
        let ev = VncFrameEvent {
            session_id: "x".into(),
            data: "AAAA".into(),
            x: 0, y: 0, width: 100, height: 100,
        };
        let json = serde_json::to_string(&ev).unwrap();
        let de: VncFrameEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(de.width, 100);
    }

    #[test]
    fn bell_event_serde() {
        let ev = VncBellEvent { session_id: "x".into() };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("session_id"));
    }

    #[test]
    fn clipboard_event_serde() {
        let ev = VncClipboardEvent { session_id: "x".into(), text: "hello".into() };
        let json = serde_json::to_string(&ev).unwrap();
        let de: VncClipboardEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(de.text, "hello");
    }

    #[test]
    fn resize_event_serde() {
        let ev = VncResizeEvent { session_id: "x".into(), width: 1920, height: 1080 };
        let json = serde_json::to_string(&ev).unwrap();
        let de: VncResizeEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(de.width, 1920);
    }

    // ── VncError ────────────────────────────────────────────────────

    #[test]
    fn error_display() {
        let e = VncError::new(VncErrorKind::AuthFailed, "bad password");
        let s = format!("{}", e);
        assert!(s.contains("AuthFailed"));
        assert!(s.contains("bad password"));
    }

    #[test]
    fn error_session_not_found() {
        let e = VncError::session_not_found("abc");
        assert_eq!(e.kind, VncErrorKind::SessionNotFound);
        assert!(e.message.contains("abc"));
    }

    #[test]
    fn error_from_io_refused() {
        let io_err = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "refused");
        let ve: VncError = io_err.into();
        assert_eq!(ve.kind, VncErrorKind::ConnectionRefused);
    }

    #[test]
    fn error_from_io_timeout() {
        let io_err = std::io::Error::new(std::io::ErrorKind::TimedOut, "timed out");
        let ve: VncError = io_err.into();
        assert_eq!(ve.kind, VncErrorKind::Timeout);
    }

    #[test]
    fn error_from_io_other() {
        let io_err = std::io::Error::new(std::io::ErrorKind::BrokenPipe, "pipe");
        let ve: VncError = io_err.into();
        assert_eq!(ve.kind, VncErrorKind::Io);
    }

    #[test]
    fn error_serde_roundtrip() {
        let e = VncError::auth_failed("wrong key");
        let json = serde_json::to_string(&e).unwrap();
        let de: VncError = serde_json::from_str(&json).unwrap();
        assert_eq!(de.kind, VncErrorKind::AuthFailed);
        assert_eq!(de.message, "wrong key");
    }

    // ── Keysyms ─────────────────────────────────────────────────────

    #[test]
    fn keysym_values() {
        assert_eq!(keysym::BACKSPACE, 0xFF08);
        assert_eq!(keysym::RETURN, 0xFF0D);
        assert_eq!(keysym::F1, 0xFFBE);
        assert_eq!(keysym::CONTROL_L, 0xFFE3);
    }

    // ── Mouse buttons ───────────────────────────────────────────────

    #[test]
    fn mouse_button_mask() {
        assert_eq!(mouse_button::LEFT, 1);
        assert_eq!(mouse_button::MIDDLE, 2);
        assert_eq!(mouse_button::RIGHT, 4);
        assert_eq!(mouse_button::SCROLL_UP, 8);
        assert_eq!(mouse_button::SCROLL_DOWN, 16);
    }
}
