//! Core NX data types, configuration, session info, errors.

use serde::{Deserialize, Serialize};
use std::fmt;

// ── Protocol Version ────────────────────────────────────────────────────────

/// NX protocol version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NxVersion {
    /// NX protocol version 3 (FreeNX / X2Go compatible).
    V3,
    /// NX protocol version 4 (NoMachine 4+).
    V4,
    /// NX protocol version 5 (NoMachine 7+, latest).
    V5,
}

impl fmt::Display for NxVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NxVersion::V3 => write!(f, "3"),
            NxVersion::V4 => write!(f, "4"),
            NxVersion::V5 => write!(f, "5"),
        }
    }
}

// ── Session Type ────────────────────────────────────────────────────────────

/// Type of NX session (desktop environment or application).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum NxSessionType {
    /// Unix/Linux desktop session.
    UnixDesktop,
    /// Unix/Linux GNOME desktop.
    UnixGnome,
    /// Unix/Linux KDE desktop.
    UnixKde,
    /// Unix/Linux XFCE desktop.
    UnixXfce,
    /// Unix custom command session.
    UnixCustom,
    /// Shadow (view/control an existing session).
    Shadow,
    /// Windows desktop via RDP proxy.
    Windows,
    /// VNC proxy session.
    Vnc,
    /// Single application mode.
    Application,
    /// Console (root desktop on :0).
    Console,
}

impl fmt::Display for NxSessionType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NxSessionType::UnixDesktop => write!(f, "unix-desktop"),
            NxSessionType::UnixGnome => write!(f, "unix-gnome"),
            NxSessionType::UnixKde => write!(f, "unix-kde"),
            NxSessionType::UnixXfce => write!(f, "unix-xfce"),
            NxSessionType::UnixCustom => write!(f, "unix-custom"),
            NxSessionType::Shadow => write!(f, "shadow"),
            NxSessionType::Windows => write!(f, "windows"),
            NxSessionType::Vnc => write!(f, "vnc"),
            NxSessionType::Application => write!(f, "application"),
            NxSessionType::Console => write!(f, "console"),
        }
    }
}

// ── Session State ───────────────────────────────────────────────────────────

/// Session lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NxSessionState {
    Starting,
    Running,
    Suspended,
    Resuming,
    Terminating,
    Terminated,
    Failed,
}

impl fmt::Display for NxSessionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NxSessionState::Starting => write!(f, "starting"),
            NxSessionState::Running => write!(f, "running"),
            NxSessionState::Suspended => write!(f, "suspended"),
            NxSessionState::Resuming => write!(f, "resuming"),
            NxSessionState::Terminating => write!(f, "terminating"),
            NxSessionState::Terminated => write!(f, "terminated"),
            NxSessionState::Failed => write!(f, "failed"),
        }
    }
}

// ── Compression ─────────────────────────────────────────────────────────────

/// NX compression method.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NxCompression {
    /// No compression.
    None,
    /// ZLIB stream compression.
    Zlib,
    /// JPEG lossy for images.
    Jpeg,
    /// PNG lossless for images.
    Png,
    /// Adaptive (auto-select based on content).
    Adaptive,
}

/// NX compression level (0–9, where 9 is maximum).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompressionLevel(pub u8);

impl Default for CompressionLevel {
    fn default() -> Self { Self(6) }
}

impl CompressionLevel {
    pub fn new(level: u8) -> Self { Self(level.min(9)) }
}

// ── Link Speed ──────────────────────────────────────────────────────────────

/// Network link speed hint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LinkSpeed {
    Modem,
    Isdn,
    Adsl,
    Wan,
    Lan,
}

impl LinkSpeed {
    /// Suggested bandwidth limit in kbps.
    pub fn bandwidth_kbps(&self) -> u32 {
        match self {
            LinkSpeed::Modem => 56,
            LinkSpeed::Isdn => 128,
            LinkSpeed::Adsl => 2048,
            LinkSpeed::Wan => 10240,
            LinkSpeed::Lan => 0, // unlimited
        }
    }
}

// ── Display Quality ─────────────────────────────────────────────────────────

/// Image quality preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageQuality {
    /// Lowest quality, highest compression.
    Low,
    /// Medium quality.
    Medium,
    /// High quality.
    High,
    /// Lossless (pixel-perfect).
    Lossless,
}

impl ImageQuality {
    /// JPEG quality percentage.
    pub fn jpeg_quality(&self) -> u8 {
        match self {
            ImageQuality::Low => 30,
            ImageQuality::Medium => 60,
            ImageQuality::High => 85,
            ImageQuality::Lossless => 100,
        }
    }
}

// ── Keyboard Layout ─────────────────────────────────────────────────────────

/// Keyboard layout identification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyboardLayout {
    pub model: String,
    pub layout: String,
    pub variant: Option<String>,
    pub options: Option<String>,
}

impl Default for KeyboardLayout {
    fn default() -> Self {
        Self {
            model: "pc105".into(),
            layout: "us".into(),
            variant: None,
            options: None,
        }
    }
}

// ── Audio Config ────────────────────────────────────────────────────────────

/// Audio forwarding configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NxAudioConfig {
    pub enabled: bool,
    pub codec: NxAudioCodec,
    pub sample_rate: u32,
    pub channels: u8,
    pub bit_depth: u8,
}

impl Default for NxAudioConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            codec: NxAudioCodec::Opus,
            sample_rate: 44100,
            channels: 2,
            bit_depth: 16,
        }
    }
}

/// Audio codec.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NxAudioCodec {
    /// Uncompressed PCM.
    Pcm,
    /// ESD protocol.
    Esd,
    /// PulseAudio native.
    Pulse,
    /// Opus codec (low-latency).
    Opus,
    /// MP3.
    Mp3,
}

// ── Printing Config ─────────────────────────────────────────────────────────

/// Printer forwarding configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NxPrintConfig {
    pub enabled: bool,
    pub driver: PrinterDriver,
    pub paper_size: String,
    pub default_printer: Option<String>,
}

impl Default for NxPrintConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            driver: PrinterDriver::Cups,
            paper_size: "A4".into(),
            default_printer: None,
        }
    }
}

/// Printer driver backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrinterDriver {
    /// CUPS/IPP.
    Cups,
    /// PostScript passthrough.
    PostScript,
    /// PDF virtual printer.
    Pdf,
    /// SMB/Windows printer.
    Smb,
}

// ── Configuration ───────────────────────────────────────────────────────────

/// Full NX connection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NxConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub label: Option<String>,

    // Session
    pub session_type: Option<NxSessionType>,
    pub custom_command: Option<String>,
    pub version: Option<NxVersion>,

    // Display
    pub resolution_width: Option<u32>,
    pub resolution_height: Option<u32>,
    pub fullscreen: Option<bool>,
    pub color_depth: Option<u8>,

    // Compression
    pub compression: Option<NxCompression>,
    pub compression_level: Option<u8>,
    pub image_quality: Option<ImageQuality>,
    pub link_speed: Option<LinkSpeed>,

    // Features
    pub audio: Option<NxAudioConfig>,
    pub printing: Option<NxPrintConfig>,
    pub clipboard: Option<bool>,
    pub file_sharing: Option<bool>,
    pub shared_folder: Option<String>,
    pub media_forwarding: Option<bool>,

    // Keyboard
    pub keyboard: Option<KeyboardLayout>,

    // Network
    pub ssh_port: Option<u16>,
    pub proxy_host: Option<String>,
    pub proxy_port: Option<u16>,
    pub connect_timeout: Option<u32>,
    pub keepalive_interval: Option<u32>,

    // nxproxy
    pub nxproxy_path: Option<String>,
    pub nxproxy_extra_args: Option<Vec<String>>,

    // Session resume
    pub resume_session_id: Option<String>,
    pub auto_resume: Option<bool>,
}

impl Default for NxConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 4000,
            username: None,
            password: None,
            private_key: None,
            label: None,
            session_type: Some(NxSessionType::UnixDesktop),
            custom_command: None,
            version: Some(NxVersion::V3),
            resolution_width: Some(1024),
            resolution_height: Some(768),
            fullscreen: Some(false),
            color_depth: Some(24),
            compression: Some(NxCompression::Adaptive),
            compression_level: Some(6),
            image_quality: Some(ImageQuality::Medium),
            link_speed: Some(LinkSpeed::Adsl),
            audio: Some(NxAudioConfig::default()),
            printing: Some(NxPrintConfig::default()),
            clipboard: Some(true),
            file_sharing: Some(false),
            shared_folder: None,
            media_forwarding: Some(true),
            keyboard: Some(KeyboardLayout::default()),
            ssh_port: Some(22),
            proxy_host: None,
            proxy_port: None,
            connect_timeout: Some(30),
            keepalive_interval: Some(60),
            nxproxy_path: None,
            nxproxy_extra_args: None,
            resume_session_id: None,
            auto_resume: Some(true),
        }
    }
}

// ── Session Info ────────────────────────────────────────────────────────────

/// Information about an NX session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NxSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub label: Option<String>,
    pub session_type: String,
    pub state: NxSessionState,
    pub display: Option<u32>,
    pub resolution_width: u32,
    pub resolution_height: u32,
    pub connected_at: String,
    pub last_activity: String,
    pub suspended_at: Option<String>,
    pub server_session_id: Option<String>,
}

impl NxSession {
    pub fn from_config(config: &NxConfig, id: String, state: NxSessionState) -> Self {
        Self {
            id,
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            label: config.label.clone(),
            session_type: config
                .session_type
                .as_ref()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "unix-desktop".into()),
            state,
            display: None,
            resolution_width: config.resolution_width.unwrap_or(1024),
            resolution_height: config.resolution_height.unwrap_or(768),
            connected_at: chrono::Utc::now().to_rfc3339(),
            last_activity: chrono::Utc::now().to_rfc3339(),
            suspended_at: None,
            server_session_id: None,
        }
    }
}

// ── Statistics ──────────────────────────────────────────────────────────────

/// Session statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NxStats {
    pub session_id: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub frame_count: u64,
    pub connected_at: String,
    pub last_activity: String,
    pub uptime_secs: u64,
    pub display_width: u32,
    pub display_height: u32,
    pub compression_ratio: f64,
    pub round_trip_ms: u32,
    pub bandwidth_kbps: u32,
    pub suspended_count: u32,
    pub resumed_count: u32,
}

// ── Errors ──────────────────────────────────────────────────────────────────

/// Error kind for NX operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum NxErrorKind {
    ConnectionFailed,
    AuthenticationFailed,
    SessionNotFound,
    SessionAlreadyExists,
    AlreadyConnected,
    ProxyError,
    ProtocolError,
    Timeout,
    SshError,
    DisplayError,
    AudioError,
    PrintError,
    Disconnected,
    ResumeError,
    ConfigError,
    IoError,
    Unknown,
}

/// NX error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NxError {
    pub kind: NxErrorKind,
    pub message: String,
}

impl fmt::Display for NxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for NxError {}

impl From<std::io::Error> for NxError {
    fn from(e: std::io::Error) -> Self {
        Self {
            kind: NxErrorKind::IoError,
            message: e.to_string(),
        }
    }
}

impl NxError {
    pub fn new(kind: NxErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }

    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(NxErrorKind::ConnectionFailed, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(NxErrorKind::AuthenticationFailed, msg)
    }

    pub fn session_not_found(id: &str) -> Self {
        Self::new(NxErrorKind::SessionNotFound, format!("session not found: {}", id))
    }

    pub fn proxy(msg: impl Into<String>) -> Self {
        Self::new(NxErrorKind::ProxyError, msg)
    }

    pub fn protocol(msg: impl Into<String>) -> Self {
        Self::new(NxErrorKind::ProtocolError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(NxErrorKind::Timeout, msg)
    }

    pub fn ssh(msg: impl Into<String>) -> Self {
        Self::new(NxErrorKind::SshError, msg)
    }

    pub fn disconnected(msg: impl Into<String>) -> Self {
        Self::new(NxErrorKind::Disconnected, msg)
    }

    pub fn resume(msg: impl Into<String>) -> Self {
        Self::new(NxErrorKind::ResumeError, msg)
    }

    pub fn config(msg: impl Into<String>) -> Self {
        Self::new(NxErrorKind::ConfigError, msg)
    }
}

// ── NX Proxy Info ───────────────────────────────────────────────────────────

/// Information about available NX proxy binaries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NxProxyInfo {
    pub path: String,
    pub version: Option<String>,
    pub capabilities: Vec<String>,
}

/// Resumable session descriptor from the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumableSession {
    pub session_id: String,
    pub display: u32,
    pub session_type: String,
    pub state: String,
    pub created_at: String,
    pub user: String,
    pub geometry: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config() {
        let config = NxConfig::default();
        assert_eq!(config.port, 4000);
        assert_eq!(
            config.session_type,
            Some(NxSessionType::UnixDesktop)
        );
        assert_eq!(config.version, Some(NxVersion::V3));
    }

    #[test]
    fn error_display() {
        let err = NxError::auth("bad password");
        assert!(err.to_string().contains("bad password"));
    }

    #[test]
    fn link_speed_bandwidth() {
        assert_eq!(LinkSpeed::Modem.bandwidth_kbps(), 56);
        assert_eq!(LinkSpeed::Lan.bandwidth_kbps(), 0);
    }

    #[test]
    fn image_quality_jpeg() {
        assert_eq!(ImageQuality::Low.jpeg_quality(), 30);
        assert_eq!(ImageQuality::Lossless.jpeg_quality(), 100);
    }

    #[test]
    fn compression_level_clamp() {
        let cl = CompressionLevel::new(15);
        assert_eq!(cl.0, 9);
    }

    #[test]
    fn session_from_config() {
        let config = NxConfig::default();
        let session = NxSession::from_config(&config, "test-id".into(), NxSessionState::Starting);
        assert_eq!(session.id, "test-id");
        assert_eq!(session.state, NxSessionState::Starting);
    }

    #[test]
    fn session_type_display() {
        assert_eq!(NxSessionType::UnixGnome.to_string(), "unix-gnome");
        assert_eq!(NxSessionType::Shadow.to_string(), "shadow");
    }

    #[test]
    fn error_from_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::BrokenPipe, "broken");
        let nx_err = NxError::from(io_err);
        assert_eq!(nx_err.kind, NxErrorKind::IoError);
    }
}
