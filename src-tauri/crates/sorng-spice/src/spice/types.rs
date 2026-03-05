//! SPICE protocol types: configuration, session metadata, channels, pixel formats,
//! events, QoS, TLS, errors.

use serde::{Deserialize, Serialize};
use std::fmt;

// ═══════════════════════════════════════════════════════════════════════════════
//  Protocol Constants
// ═══════════════════════════════════════════════════════════════════════════════

/// SPICE protocol magic bytes.
pub const SPICE_MAGIC: u32 = 0x5049_4352; // "RCIP" little-endian → "SPIC"

/// Supported SPICE protocol versions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpiceVersion {
    /// SPICE 1.0 (original).
    V1,
    /// SPICE 2.0 (mini-header, capabilities).
    V2,
    /// SPICE 3.0 (multi-media, streaming).
    V3,
}

impl SpiceVersion {
    pub fn major(&self) -> u32 {
        match self {
            Self::V1 => 1,
            Self::V2 => 2,
            Self::V3 => 3,
        }
    }
    pub fn minor(&self) -> u32 { 0 }
}

impl fmt::Display for SpiceVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.major(), self.minor())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Channel Types
// ═══════════════════════════════════════════════════════════════════════════════

/// SPICE channel identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum SpiceChannelType {
    Main = 1,
    Display = 2,
    Inputs = 3,
    Cursor = 4,
    Playback = 5,
    Record = 6,
    Tunnel = 7,
    SmartCard = 8,
    UsbRedir = 9,
    Port = 10,
    WebDav = 11,
}

impl SpiceChannelType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::Main),
            2 => Some(Self::Display),
            3 => Some(Self::Inputs),
            4 => Some(Self::Cursor),
            5 => Some(Self::Playback),
            6 => Some(Self::Record),
            7 => Some(Self::Tunnel),
            8 => Some(Self::SmartCard),
            9 => Some(Self::UsbRedir),
            10 => Some(Self::Port),
            11 => Some(Self::WebDav),
            _ => None,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::Main => "main",
            Self::Display => "display",
            Self::Inputs => "inputs",
            Self::Cursor => "cursor",
            Self::Playback => "playback",
            Self::Record => "record",
            Self::Tunnel => "tunnel",
            Self::SmartCard => "smartcard",
            Self::UsbRedir => "usbredir",
            Self::Port => "port",
            Self::WebDav => "webdav",
        }
    }
}

impl fmt::Display for SpiceChannelType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.name())
    }
}

/// Channel state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChannelState {
    Disconnected,
    Connecting,
    Authenticating,
    Connected,
    Error,
}

/// Individual channel status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelStatus {
    pub channel_type: SpiceChannelType,
    pub channel_id: u8,
    pub state: ChannelState,
    pub capabilities: Vec<u32>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Image / Display Types
// ═══════════════════════════════════════════════════════════════════════════════

/// SPICE image compression methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageCompression {
    /// No compression — raw pixel data.
    Off,
    /// QUIC (SFALIC-based) adaptive compression.
    Quic,
    /// Lempel-Ziv compression.
    Lz,
    /// Glib-LZ with global dictionary.
    Glz,
    /// LZ4 fast compression.
    Lz4,
    /// JPEG for photographic regions.
    Jpeg,
    /// ZLIB standard compression.
    Zlib,
    /// Auto-select based on content analysis.
    AutoGlz,
    /// Auto with JPEG for suitable regions.
    AutoLz,
}

impl fmt::Display for ImageCompression {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            Self::Off => "off",
            Self::Quic => "quic",
            Self::Lz => "lz",
            Self::Glz => "glz",
            Self::Lz4 => "lz4",
            Self::Jpeg => "jpeg",
            Self::Zlib => "zlib",
            Self::AutoGlz => "auto_glz",
            Self::AutoLz => "auto_lz",
        };
        write!(f, "{}", s)
    }
}

/// SPICE video codec type for streaming regions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VideoCodec {
    Mjpeg,
    Vp8,
    Vp9,
    H264,
    H265,
}

impl fmt::Display for VideoCodec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            Self::Mjpeg => "mjpeg",
            Self::Vp8 => "vp8",
            Self::Vp9 => "vp9",
            Self::H264 => "h264",
            Self::H265 => "h265",
        };
        write!(f, "{}", s)
    }
}

/// Surface/display pixel format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpicePixelFormat {
    pub bits_per_pixel: u8,
    pub depth: u8,
    pub red_mask: u32,
    pub green_mask: u32,
    pub blue_mask: u32,
    pub alpha_mask: u32,
}

impl SpicePixelFormat {
    /// Standard 32-bit BGRA (SPICE default).
    pub fn bgra32() -> Self {
        Self {
            bits_per_pixel: 32,
            depth: 24,
            red_mask: 0x00FF_0000,
            green_mask: 0x0000_FF00,
            blue_mask: 0x0000_00FF,
            alpha_mask: 0xFF00_0000,
        }
    }

    /// 16-bit RGB 565.
    pub fn rgb565() -> Self {
        Self {
            bits_per_pixel: 16,
            depth: 16,
            red_mask: 0xF800,
            green_mask: 0x07E0,
            blue_mask: 0x001F,
            alpha_mask: 0,
        }
    }
}

/// A SPICE surface (virtual display).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceSurface {
    pub surface_id: u32,
    pub width: u32,
    pub height: u32,
    pub format: SpicePixelFormat,
    pub flags: u32,
    pub is_primary: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Display Draw Commands
// ═══════════════════════════════════════════════════════════════════════════════

/// Display draw command types.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DrawCommand {
    Fill {
        surface_id: u32,
        x: i32, y: i32, width: u32, height: u32,
        color: u32,
    },
    Copy {
        surface_id: u32,
        src_x: i32, src_y: i32,
        dst_x: i32, dst_y: i32,
        width: u32, height: u32,
    },
    Opaque {
        surface_id: u32,
        x: i32, y: i32, width: u32, height: u32,
        /// Base64-encoded image data.
        data: String,
        compression: ImageCompression,
    },
    Inval {
        surface_id: u32,
        x: i32, y: i32, width: u32, height: u32,
    },
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Cursor
// ═══════════════════════════════════════════════════════════════════════════════

/// Cursor type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CursorType {
    Alpha,
    Mono,
    Color4,
    Color8,
    Color16,
    Color24,
    Color32,
}

/// Cursor update from the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceCursor {
    pub cursor_type: CursorType,
    pub width: u16,
    pub height: u16,
    pub hot_x: u16,
    pub hot_y: u16,
    /// Base64-encoded cursor image data.
    pub data: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Input types
// ═══════════════════════════════════════════════════════════════════════════════

/// Keyboard scan-code set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KeyboardModifier {
    ScrollLock,
    NumLock,
    CapsLock,
}

/// Mouse button mask bits.
pub struct MouseButton;
impl MouseButton {
    pub const LEFT: u8 = 1;
    pub const MIDDLE: u8 = 2;
    pub const RIGHT: u8 = 4;
    pub const SCROLL_UP: u8 = 8;
    pub const SCROLL_DOWN: u8 = 16;
    pub const SIDE: u8 = 32;
    pub const EXTRA: u8 = 64;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  USB Redirection
// ═══════════════════════════════════════════════════════════════════════════════

/// USB device info for redirection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsbDevice {
    pub vendor_id: u16,
    pub product_id: u16,
    pub device_class: u8,
    pub device_subclass: u8,
    pub device_protocol: u8,
    pub manufacturer: String,
    pub product: String,
    pub serial: String,
    pub bus: u8,
    pub address: u8,
    pub redirected: bool,
}

/// USB redirection filter rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsbFilter {
    pub vendor_id: Option<u16>,
    pub product_id: Option<u16>,
    pub device_class: Option<u8>,
    pub device_subclass: Option<u8>,
    pub device_protocol: Option<u8>,
    pub allow: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Streaming
// ═══════════════════════════════════════════════════════════════════════════════

/// Active video stream info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoStream {
    pub stream_id: u32,
    pub surface_id: u32,
    pub codec: VideoCodec,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub flags: u32,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Audio
// ═══════════════════════════════════════════════════════════════════════════════

/// Audio parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioParams {
    pub channels: u8,
    pub bits_per_sample: u8,
    pub frequency: u32,
}

impl Default for AudioParams {
    fn default() -> Self {
        Self {
            channels: 2,
            bits_per_sample: 16,
            frequency: 44100,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TLS / Security
// ═══════════════════════════════════════════════════════════════════════════════

/// TLS / connection security options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpiceTlsConfig {
    /// Require TLS on all channels.
    pub require_tls: bool,
    /// CA certificate path (PEM).
    pub ca_cert: Option<String>,
    /// Client certificate path (PEM) for mutual TLS.
    pub client_cert: Option<String>,
    /// Client key path (PEM).
    pub client_key: Option<String>,
    /// Accept self-signed server certificates.
    pub allow_self_signed: bool,
    /// Specific hostname to verify against (overrides connection host).
    pub verify_hostname: Option<String>,
    /// Cipher suite specification (OpenSSL format).
    pub ciphers: Option<String>,
}

/// SASL authentication configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpiceSaslConfig {
    pub enabled: bool,
    pub mechanism: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Connection Configuration
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration for a new SPICE connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceConfig {
    /// Target host / IP.
    pub host: String,
    /// Target port (default 5900).
    #[serde(default = "default_spice_port")]
    pub port: u16,
    /// TLS port (if separate from plain port).
    pub tls_port: Option<u16>,
    /// SPICE ticket / password.
    pub password: Option<String>,
    /// Connection label / friendly name.
    pub label: Option<String>,

    // ── Display ───────────────────────────────────────────────────
    /// Preferred image compression.
    #[serde(default)]
    pub image_compression: Option<ImageCompression>,
    /// Preferred video codec for streaming regions.
    #[serde(default)]
    pub video_codec: Option<VideoCodec>,
    /// Request specific display resolution (width).
    pub preferred_width: Option<u32>,
    /// Request specific display resolution (height).
    pub preferred_height: Option<u32>,
    /// Number of display heads (monitors) to request.
    #[serde(default = "default_display_count")]
    pub display_count: u8,
    /// Enable video streaming (GL acceleration/GStreamer).
    #[serde(default = "default_true")]
    pub streaming: bool,

    // ── Input ─────────────────────────────────────────────────────
    /// View only — no keyboard/mouse input.
    #[serde(default)]
    pub view_only: bool,
    /// Share clipboard between guest and client.
    #[serde(default = "default_true")]
    pub share_clipboard: bool,

    // ── Audio ─────────────────────────────────────────────────────
    /// Enable audio playback channel.
    #[serde(default = "default_true")]
    pub audio_playback: bool,
    /// Enable audio record (microphone) channel.
    #[serde(default)]
    pub audio_record: bool,
    /// Audio playback parameters.
    #[serde(default)]
    pub audio_params: Option<AudioParams>,

    // ── USB ───────────────────────────────────────────────────────
    /// Enable USB redirection.
    #[serde(default)]
    pub usb_redirection: bool,
    /// USB auto-redirect on connect.
    #[serde(default)]
    pub usb_auto_redirect: bool,
    /// USB filter rules.
    #[serde(default)]
    pub usb_filters: Vec<UsbFilter>,

    // ── File sharing ──────────────────────────────────────────────
    /// Enable WebDAV file sharing.
    #[serde(default)]
    pub file_sharing: bool,
    /// Shared folder path for WebDAV.
    pub shared_folder: Option<String>,

    // ── Security ──────────────────────────────────────────────────
    /// TLS configuration.
    #[serde(default)]
    pub tls: SpiceTlsConfig,
    /// SASL authentication.
    #[serde(default)]
    pub sasl: SpiceSaslConfig,

    // ── Network ───────────────────────────────────────────────────
    /// TCP connect timeout in seconds.
    #[serde(default = "default_connect_timeout")]
    pub connect_timeout_secs: u64,
    /// Keepalive interval in seconds (0 = disabled).
    #[serde(default)]
    pub keepalive_secs: u64,
    /// Use mini-header protocol (SPICE 2+).
    #[serde(default = "default_true")]
    pub mini_header: bool,

    // ── Proxy ─────────────────────────────────────────────────────
    /// SPICE proxy URI (spice://host:port or http://proxy:port).
    pub proxy: Option<String>,

    // ── Misc ──────────────────────────────────────────────────────
    /// Channels to open (empty = all default channels).
    #[serde(default)]
    pub channels: Vec<SpiceChannelType>,
    /// Enable agent communication (guest agent in VM).
    #[serde(default = "default_true")]
    pub agent: bool,
    /// Colour depth preference.
    pub color_depth: Option<u8>,
    /// Disable display effects in guest (wallpaper, font smoothing, etc.).
    #[serde(default)]
    pub disable_effects: Vec<String>,
}

fn default_spice_port() -> u16 { 5900 }
fn default_true() -> bool { true }
fn default_connect_timeout() -> u64 { 15 }
fn default_display_count() -> u8 { 1 }

impl Default for SpiceConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: default_spice_port(),
            tls_port: None,
            password: None,
            label: None,
            image_compression: None,
            video_codec: None,
            preferred_width: None,
            preferred_height: None,
            display_count: default_display_count(),
            streaming: true,
            view_only: false,
            share_clipboard: true,
            audio_playback: true,
            audio_record: false,
            audio_params: None,
            usb_redirection: false,
            usb_auto_redirect: false,
            usb_filters: vec![],
            file_sharing: false,
            shared_folder: None,
            tls: SpiceTlsConfig::default(),
            sasl: SpiceSaslConfig::default(),
            connect_timeout_secs: default_connect_timeout(),
            keepalive_secs: 0,
            mini_header: true,
            proxy: None,
            channels: vec![],
            agent: true,
            color_depth: None,
            disable_effects: vec![],
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Session Metadata
// ═══════════════════════════════════════════════════════════════════════════════

/// Metadata about a live SPICE session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub tls_port: Option<u16>,
    pub connected: bool,
    pub label: Option<String>,
    /// Negotiated protocol version.
    pub protocol_version: Option<String>,
    /// Whether the connection uses TLS.
    pub tls_active: bool,
    /// Guest agent available.
    pub agent_connected: bool,
    /// Active channels.
    pub channels: Vec<ChannelStatus>,
    /// Surfaces (displays) in the session.
    pub surfaces: Vec<SpiceSurface>,
    /// Active video streams.
    pub video_streams: Vec<VideoStream>,
    /// USB devices currently redirected.
    pub usb_devices: Vec<UsbDevice>,
    /// Display resolution.
    pub display_width: u32,
    pub display_height: u32,
    /// View-only mode.
    pub view_only: bool,
    /// ISO-8601 connection timestamp.
    pub connected_at: String,
    /// ISO-8601 last activity.
    pub last_activity: String,
    /// Total bytes sent across all channels.
    pub bytes_sent: u64,
    /// Total bytes received across all channels.
    pub bytes_received: u64,
    /// Frame count (display updates).
    pub frame_count: u64,
}

impl SpiceSession {
    pub fn from_config(config: &SpiceConfig, id: String, connected: bool) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id,
            host: config.host.clone(),
            port: config.port,
            tls_port: config.tls_port,
            connected,
            label: config.label.clone(),
            protocol_version: None,
            tls_active: false,
            agent_connected: false,
            channels: vec![],
            surfaces: vec![],
            video_streams: vec![],
            usb_devices: vec![],
            display_width: config.preferred_width.unwrap_or(0),
            display_height: config.preferred_height.unwrap_or(0),
            view_only: config.view_only,
            connected_at: now.clone(),
            last_activity: now,
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Frontend Events
// ═══════════════════════════════════════════════════════════════════════════════

/// Display frame update event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceFrameEvent {
    pub session_id: String,
    pub surface_id: u32,
    /// Base64-encoded pixel data.
    pub data: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub compression: String,
}

/// Cursor update event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceCursorEvent {
    pub session_id: String,
    pub cursor: SpiceCursor,
    pub visible: bool,
    pub x: i32,
    pub y: i32,
}

/// Clipboard event (guest → client).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceClipboardEvent {
    pub session_id: String,
    pub mime_type: String,
    /// Base64-encoded clipboard data.
    pub data: String,
}

/// Session state change event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceStateEvent {
    pub session_id: String,
    pub state: String,
    pub message: String,
}

/// Surface created/destroyed event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceSurfaceEvent {
    pub session_id: String,
    pub surface: SpiceSurface,
    pub created: bool,
}

/// Display resize event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceResizeEvent {
    pub session_id: String,
    pub width: u32,
    pub height: u32,
    pub surface_id: u32,
}

/// USB device event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceUsbEvent {
    pub session_id: String,
    pub device: UsbDevice,
    pub event: String, // "added", "removed", "redirected", "unredirected"
}

/// Audio playback event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceAudioEvent {
    pub session_id: String,
    pub params: AudioParams,
    pub event: String, // "start", "stop", "data"
    /// Base64-encoded PCM data (for "data" events).
    pub data: Option<String>,
}

/// Video stream event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceStreamEvent {
    pub session_id: String,
    pub stream: VideoStream,
    pub event: String, // "created", "data", "destroyed"
    /// Base64-encoded frame data.
    pub data: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Session Statistics
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceStats {
    pub session_id: String,
    pub uptime_secs: u64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub frame_count: u64,
    pub connected_at: String,
    pub last_activity: String,
    pub display_width: u32,
    pub display_height: u32,
    pub channels_open: u32,
    pub mouse_mode: String,
    pub channels: Vec<ChannelStats>,
}

/// Per-channel statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelStats {
    pub channel_type: SpiceChannelType,
    pub messages_sent: u64,
    pub messages_received: u64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Error Type
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SpiceErrorKind {
    ConnectionRefused,
    Timeout,
    DnsResolution,
    Io,
    TlsError,
    AuthFailed,
    AuthUnsupported,
    ProtocolViolation,
    ChannelError,
    SessionNotFound,
    AlreadyConnected,
    NotConnected,
    UsbError,
    ClipboardError,
    UnsupportedFeature,
    AgentError,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiceError {
    pub kind: SpiceErrorKind,
    pub message: String,
}

impl fmt::Display for SpiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for SpiceError {}

impl SpiceError {
    pub fn new(kind: SpiceErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn session_not_found(id: &str) -> Self {
        Self::new(SpiceErrorKind::SessionNotFound, format!("Session '{}' not found", id))
    }
    pub fn protocol(msg: impl Into<String>) -> Self {
        Self::new(SpiceErrorKind::ProtocolViolation, msg)
    }
    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(SpiceErrorKind::AuthFailed, msg)
    }
    pub fn io(msg: impl Into<String>) -> Self {
        Self::new(SpiceErrorKind::Io, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(SpiceErrorKind::Timeout, msg)
    }
    pub fn tls(msg: impl Into<String>) -> Self {
        Self::new(SpiceErrorKind::TlsError, msg)
    }
    pub fn channel(msg: impl Into<String>) -> Self {
        Self::new(SpiceErrorKind::ChannelError, msg)
    }
    pub fn usb(msg: impl Into<String>) -> Self {
        Self::new(SpiceErrorKind::UsbError, msg)
    }
    pub fn unsupported(msg: impl Into<String>) -> Self {
        Self::new(SpiceErrorKind::UnsupportedFeature, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(SpiceErrorKind::AuthFailed, msg)
    }
    pub fn disconnected(msg: impl Into<String>) -> Self {
        Self::new(SpiceErrorKind::NotConnected, msg)
    }
}

impl From<std::io::Error> for SpiceError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::ConnectionRefused => {
                Self::new(SpiceErrorKind::ConnectionRefused, e.to_string())
            }
            std::io::ErrorKind::TimedOut => {
                Self::new(SpiceErrorKind::Timeout, e.to_string())
            }
            _ => Self::new(SpiceErrorKind::Io, e.to_string()),
        }
    }
}
