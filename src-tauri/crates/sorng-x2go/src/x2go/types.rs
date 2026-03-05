//! Core X2Go types, configuration, and error handling.

use serde::{Deserialize, Serialize};

// ── Session types ───────────────────────────────────────────────────────────

/// X2Go desktop session type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum X2goSessionType {
    /// KDE Plasma desktop
    Kde,
    /// GNOME desktop
    Gnome,
    /// Xfce desktop
    Xfce,
    /// LXDE desktop
    Lxde,
    /// LXQt desktop
    Lxqt,
    /// MATE desktop
    Mate,
    /// Cinnamon desktop
    Cinnamon,
    /// Unity desktop
    Unity,
    /// Trinity desktop
    Trinity,
    /// Custom desktop command
    Custom,
    /// Single published application
    Application,
    /// Shadow an existing desktop session
    Shadow,
    /// RDP session through X2Go
    Rdp,
}

impl X2goSessionType {
    /// Session type string for x2goserver commands.
    pub fn to_x2go_string(&self) -> &'static str {
        match self {
            Self::Kde => "K",
            Self::Gnome => "G",
            Self::Xfce => "X",
            Self::Lxde => "L",
            Self::Lxqt => "Q",
            Self::Mate => "M",
            Self::Cinnamon => "C",
            Self::Unity => "U",
            Self::Trinity => "T",
            Self::Custom => "C",
            Self::Application => "S",
            Self::Shadow => "S",
            Self::Rdp => "R",
        }
    }

    pub fn from_x2go_string(s: &str) -> Option<Self> {
        match s {
            "K" => Some(Self::Kde),
            "G" => Some(Self::Gnome),
            "X" => Some(Self::Xfce),
            "L" => Some(Self::Lxde),
            "Q" => Some(Self::Lxqt),
            "M" => Some(Self::Mate),
            "U" => Some(Self::Unity),
            "T" => Some(Self::Trinity),
            "S" => Some(Self::Application),
            "R" => Some(Self::Rdp),
            _ => None,
        }
    }
}

// ── Session state ───────────────────────────────────────────────────────────

/// X2Go session lifecycle states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum X2goSessionState {
    /// SSH connection in progress
    Connecting,
    /// SSH authenticated, querying existing sessions
    Authenticating,
    /// Starting a new session (x2gostartagent)
    Starting,
    /// Resuming a suspended session (x2goresume-session)
    Resuming,
    /// Session is running
    Running,
    /// Session suspended (detached but alive on server)
    Suspended,
    /// Session is being terminated
    Terminating,
    /// Session ended
    Ended,
    /// Session failed
    Failed,
}

// ── Compression ─────────────────────────────────────────────────────────────

/// NX compression methods (X2Go uses NX3 under the hood).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum X2goCompression {
    /// No compression
    None,
    /// Minimal compression
    Modem,
    /// Low bandwidth ISDN
    Isdn,
    /// Broadband (ADSL)
    Adsl,
    /// High-speed WAN
    Wan,
    /// Local area network
    Lan,
}

impl X2goCompression {
    pub fn to_speed_string(&self) -> &'static str {
        match self {
            Self::None => "0",
            Self::Modem => "56",
            Self::Isdn => "64",
            Self::Adsl => "256",
            Self::Wan => "2048",
            Self::Lan => "0",
        }
    }
}

// ── Audio ───────────────────────────────────────────────────────────────────

/// Audio subsystem selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum X2goAudioSystem {
    /// PulseAudio forwarding
    Pulse,
    /// ESD (Enlightened Sound Daemon)
    Esd,
    /// ALSA pass-through
    Alsa,
    /// No audio
    None,
}

impl X2goAudioSystem {
    pub fn to_x2go_string(&self) -> &'static str {
        match self {
            Self::Pulse => "pulse",
            Self::Esd => "esd",
            Self::Alsa => "arts",
            Self::None => "none",
        }
    }
}

/// Audio configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X2goAudioConfig {
    pub system: X2goAudioSystem,
    pub enabled: bool,
    /// PulseAudio TCP port to forward to (0 = auto).
    pub port: u16,
}

impl Default for X2goAudioConfig {
    fn default() -> Self {
        Self {
            system: X2goAudioSystem::Pulse,
            enabled: true,
            port: 0,
        }
    }
}

// ── File sharing ────────────────────────────────────────────────────────────

/// Shared folder configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X2goSharedFolder {
    /// Local directory path
    pub local_path: String,
    /// Mount point on the remote side (relative to ~/media)
    pub remote_name: String,
    /// Auto-mount on session start
    pub auto_mount: bool,
}

// ── Printing ────────────────────────────────────────────────────────────────

/// Printing configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X2goPrintConfig {
    pub enabled: bool,
    /// Local CUPS server address.
    pub cups_server: Option<String>,
    /// Default printer name.
    pub default_printer: Option<String>,
}

impl Default for X2goPrintConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            cups_server: None,
            default_printer: None,
        }
    }
}

// ── Display ─────────────────────────────────────────────────────────────────

/// Display mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum X2goDisplayMode {
    /// Windowed at specific resolution
    Window { width: u32, height: u32 },
    /// Full screen
    Fullscreen,
    /// Single application mode
    SingleApplication { command: String },
}

impl Default for X2goDisplayMode {
    fn default() -> Self {
        Self::Window {
            width: 1024,
            height: 768,
        }
    }
}

// ── Keyboard ────────────────────────────────────────────────────────────────

/// Keyboard layout model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X2goKeyboard {
    pub layout: String,
    pub model: String,
    pub variant: Option<String>,
}

impl Default for X2goKeyboard {
    fn default() -> Self {
        Self {
            layout: "us".into(),
            model: "pc105".into(),
            variant: None,
        }
    }
}

// ── SSH configuration ───────────────────────────────────────────────────────

/// SSH authentication method.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum X2goSshAuth {
    /// Password authentication
    Password { password: String },
    /// Private key authentication
    PrivateKey {
        key_path: String,
        passphrase: Option<String>,
    },
    /// SSH agent
    Agent,
    /// Kerberos/GSSAPI
    Gssapi,
}

/// SSH configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X2goSshConfig {
    /// SSH port (default 22).
    pub port: u16,
    /// SSH authentication method.
    pub auth: X2goSshAuth,
    /// SSH host key policy.
    pub strict_host_key: bool,
    /// Known hosts file path.
    pub known_hosts_file: Option<String>,
    /// SSH proxy/jump host command.
    pub proxy_command: Option<String>,
    /// SSH configuration file path.
    pub ssh_config_file: Option<String>,
    /// Connection timeout in seconds.
    pub connect_timeout: u32,
}

impl Default for X2goSshConfig {
    fn default() -> Self {
        Self {
            port: 22,
            auth: X2goSshAuth::Agent,
            strict_host_key: true,
            known_hosts_file: None,
            proxy_command: None,
            ssh_config_file: None,
            connect_timeout: 30,
        }
    }
}

// ── Connection config ───────────────────────────────────────────────────────

/// Full X2Go connection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X2goConfig {
    /// Remote host.
    pub host: String,
    /// Username on the remote host.
    pub username: String,
    /// SSH configuration.
    #[serde(default)]
    pub ssh: X2goSshConfig,
    /// Session type (desktop/application/shadow).
    pub session_type: X2goSessionType,
    /// Custom command (for Custom/Application session types).
    pub command: Option<String>,
    /// Display mode.
    #[serde(default)]
    pub display: X2goDisplayMode,
    /// Color depth (8, 16, 24).
    pub color_depth: Option<u8>,
    /// Compression.
    pub compression: Option<X2goCompression>,
    /// DPI setting.
    pub dpi: Option<u32>,
    /// Keyboard layout.
    #[serde(default)]
    pub keyboard: X2goKeyboard,
    /// Audio configuration.
    #[serde(default)]
    pub audio: X2goAudioConfig,
    /// Printing configuration.
    #[serde(default)]
    pub printing: X2goPrintConfig,
    /// Shared folders.
    #[serde(default)]
    pub shared_folders: Vec<X2goSharedFolder>,
    /// Clipboard sharing mode.
    #[serde(default)]
    pub clipboard: X2goClipboardMode,
    /// Root-less mode (separate window per app).
    #[serde(default)]
    pub rootless: bool,
    /// Use published applications mode.
    #[serde(default)]
    pub published_applications: bool,
    /// Session resume ID (to resume a specific suspended session).
    pub resume_session: Option<String>,
    /// X2Go broker URL (optional).
    pub broker_url: Option<String>,
    /// Use X2Go broker for session profiles.
    #[serde(default)]
    pub use_broker: bool,
    /// XDG session cookie.
    pub session_cookie: Option<String>,
}

impl Default for X2goConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            username: String::new(),
            ssh: X2goSshConfig::default(),
            session_type: X2goSessionType::Kde,
            command: None,
            display: X2goDisplayMode::default(),
            color_depth: Some(24),
            compression: Some(X2goCompression::Adsl),
            dpi: Some(96),
            keyboard: X2goKeyboard::default(),
            audio: X2goAudioConfig::default(),
            printing: X2goPrintConfig::default(),
            shared_folders: Vec::new(),
            clipboard: X2goClipboardMode::Both,
            rootless: false,
            published_applications: false,
            resume_session: None,
            broker_url: None,
            use_broker: false,
            session_cookie: None,
        }
    }
}

// ── Clipboard ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum X2goClipboardMode {
    /// Bidirectional clipboard sharing
    Both,
    /// Client-to-server only
    ClientToServer,
    /// Server-to-client only
    ServerToClient,
    /// Disabled
    None,
}

impl Default for X2goClipboardMode {
    fn default() -> Self {
        Self::Both
    }
}

impl X2goClipboardMode {
    pub fn to_x2go_string(&self) -> &'static str {
        match self {
            Self::Both => "both",
            Self::ClientToServer => "client",
            Self::ServerToClient => "server",
            Self::None => "none",
        }
    }
}

// ── Remote session info (from x2golistsessions) ────────────────────────────

/// A remote session as reported by x2golistsessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X2goRemoteSession {
    /// Agent PID
    pub agent_pid: u32,
    /// Session ID (e.g., "user-50-1234567890_stDKDE_dp24")
    pub session_id: String,
    /// Display number
    pub display: u32,
    /// Server hostname
    pub server: String,
    /// Session state on the server
    pub status: String,
    /// Session type code
    pub session_type: String,
    /// Username
    pub username: String,
    /// Screen geometry (e.g., "1024x768")
    pub geometry: String,
    /// Color depth
    pub color_depth: u8,
    /// Session creation time
    pub created_at: String,
    /// Is session suspended?
    pub suspended: bool,
    /// Graphics port
    pub gr_port: u16,
    /// Sound port
    pub snd_port: u16,
    /// FS mountpoint
    pub fs_port: u16,
}

/// Parse x2golistsessions output.
pub fn parse_session_list(output: &str) -> Vec<X2goRemoteSession> {
    let mut sessions = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 12 {
            continue;
        }

        sessions.push(X2goRemoteSession {
            agent_pid: parts[0].parse().unwrap_or(0),
            session_id: parts[1].to_string(),
            display: parts[2].parse().unwrap_or(0),
            server: parts[3].to_string(),
            status: parts[4].to_string(),
            session_type: parts[5].to_string(),
            username: parts[6].to_string(),
            geometry: parts[7].to_string(),
            color_depth: parts[8].parse().unwrap_or(24),
            created_at: parts[9].to_string(),
            suspended: parts[4] == "S",
            gr_port: parts.get(10).and_then(|s| s.parse().ok()).unwrap_or(0),
            snd_port: parts.get(11).and_then(|s| s.parse().ok()).unwrap_or(0),
            fs_port: parts.get(12).and_then(|s| s.parse().ok()).unwrap_or(0),
        });
    }

    sessions
}

// ── Session ─────────────────────────────────────────────────────────────────

/// Live session data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X2goSession {
    pub id: String,
    pub config: X2goConfig,
    pub state: X2goSessionState,
    pub remote_session_id: Option<String>,
    pub display_number: Option<u32>,
    pub agent_pid: Option<u32>,
    pub gr_port: Option<u16>,
    pub snd_port: Option<u16>,
    pub fs_port: Option<u16>,
    pub ssh_pid: Option<u32>,
    pub started_at: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
}

impl X2goSession {
    pub fn from_config(id: String, config: X2goConfig) -> Self {
        Self {
            id,
            config,
            state: X2goSessionState::Connecting,
            remote_session_id: None,
            display_number: None,
            agent_pid: None,
            gr_port: None,
            snd_port: None,
            fs_port: None,
            ssh_pid: None,
            started_at: chrono::Utc::now().to_rfc3339(),
            bytes_sent: 0,
            bytes_received: 0,
        }
    }
}

// ── Statistics ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X2goStats {
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub session_duration_secs: u64,
    pub audio_bytes: u64,
    pub fs_bytes: u64,
    pub print_bytes: u64,
}

// ── Errors ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum X2goErrorKind {
    ConnectionFailed,
    AuthenticationFailed,
    SshError,
    SessionStartFailed,
    SessionResumeFailed,
    SessionSuspendFailed,
    SessionTerminateFailed,
    BrokerError,
    ProxyError,
    AudioError,
    PrintError,
    FileSharingError,
    ClipboardError,
    Timeout,
    NotFound,
    AlreadyExists,
    Disconnected,
    CommandFailed,
    InvalidConfig,
    PermissionDenied,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X2goError {
    pub kind: X2goErrorKind,
    pub message: String,
}

impl std::fmt::Display for X2goError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for X2goError {}

impl From<std::io::Error> for X2goError {
    fn from(e: std::io::Error) -> Self {
        Self {
            kind: X2goErrorKind::ConnectionFailed,
            message: e.to_string(),
        }
    }
}

impl X2goError {
    pub fn new(kind: X2goErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }

    pub fn ssh(msg: impl Into<String>) -> Self {
        Self::new(X2goErrorKind::SshError, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(X2goErrorKind::AuthenticationFailed, msg)
    }

    pub fn session_start(msg: impl Into<String>) -> Self {
        Self::new(X2goErrorKind::SessionStartFailed, msg)
    }

    pub fn session_resume(msg: impl Into<String>) -> Self {
        Self::new(X2goErrorKind::SessionResumeFailed, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(X2goErrorKind::Timeout, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(X2goErrorKind::NotFound, msg)
    }

    pub fn already_exists(msg: impl Into<String>) -> Self {
        Self::new(X2goErrorKind::AlreadyExists, msg)
    }

    pub fn disconnected(msg: impl Into<String>) -> Self {
        Self::new(X2goErrorKind::Disconnected, msg)
    }

    pub fn command_failed(msg: impl Into<String>) -> Self {
        Self::new(X2goErrorKind::CommandFailed, msg)
    }

    pub fn broker(msg: impl Into<String>) -> Self {
        Self::new(X2goErrorKind::BrokerError, msg)
    }

    pub fn proxy(msg: impl Into<String>) -> Self {
        Self::new(X2goErrorKind::ProxyError, msg)
    }

    pub fn invalid_config(msg: impl Into<String>) -> Self {
        Self::new(X2goErrorKind::InvalidConfig, msg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_type_roundtrip() {
        let types = [
            (X2goSessionType::Kde, "K"),
            (X2goSessionType::Gnome, "G"),
            (X2goSessionType::Xfce, "X"),
            (X2goSessionType::Lxde, "L"),
        ];
        for (st, expected) in &types {
            assert_eq!(st.to_x2go_string(), *expected);
        }
    }

    #[test]
    fn default_config() {
        let cfg = X2goConfig::default();
        assert_eq!(cfg.ssh.port, 22);
        assert_eq!(cfg.session_type, X2goSessionType::Kde);
        assert_eq!(cfg.color_depth, Some(24));
    }

    #[test]
    fn compression_speeds() {
        assert_eq!(X2goCompression::Lan.to_speed_string(), "0");
        assert_eq!(X2goCompression::Adsl.to_speed_string(), "256");
        assert_eq!(X2goCompression::Modem.to_speed_string(), "56");
    }

    #[test]
    fn clipboard_strings() {
        assert_eq!(X2goClipboardMode::Both.to_x2go_string(), "both");
        assert_eq!(X2goClipboardMode::None.to_x2go_string(), "none");
    }

    #[test]
    fn parse_session_list_output() {
        let output = "1234|user-50-1234567890_stDKDE_dp24|50|server.local|R|K|user|1024x768|24|2024-01-01|5100|5200|5300\n";
        let sessions = parse_session_list(output);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].agent_pid, 1234);
        assert_eq!(sessions[0].session_id, "user-50-1234567890_stDKDE_dp24");
        assert_eq!(sessions[0].display, 50);
        assert_eq!(sessions[0].server, "server.local");
        assert!(!sessions[0].suspended); // status is "R" (running)
    }

    #[test]
    fn parse_suspended_session() {
        let output = "5678|user-60-9876543210_stDXFCE_dp24|60|server2|S|X|user|1920x1080|24|2024-06-15|6100|6200|6300";
        let sessions = parse_session_list(output);
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].suspended);
    }

    #[test]
    fn error_constructors() {
        let e = X2goError::ssh("connection refused");
        assert_eq!(e.kind, X2goErrorKind::SshError);
        assert!(e.message.contains("refused"));

        let e2 = X2goError::from(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "timed out",
        ));
        assert_eq!(e2.kind, X2goErrorKind::ConnectionFailed);
    }

    #[test]
    fn session_from_config() {
        let cfg = X2goConfig {
            host: "myhost".into(),
            username: "admin".into(),
            ..Default::default()
        };
        let sess = X2goSession::from_config("test-1".into(), cfg);
        assert_eq!(sess.state, X2goSessionState::Connecting);
        assert!(sess.remote_session_id.is_none());
    }

    #[test]
    fn audio_system_strings() {
        assert_eq!(X2goAudioSystem::Pulse.to_x2go_string(), "pulse");
        assert_eq!(X2goAudioSystem::None.to_x2go_string(), "none");
    }
}
