//! Domain types for Terminal Services management.
//!
//! These are Rust-native, serde-friendly wrappers around the native Windows
//! WTS API structures. On non-Windows platforms, the types are still available
//! so the frontend can reference them, but all operations will return
//! `Err(PlatformNotSupported)`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Error types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// All possible errors produced by this crate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TsError {
    pub kind: TsErrorKind,
    pub message: String,
}

impl fmt::Display for TsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for TsError {}

impl From<TsError> for String {
    fn from(e: TsError) -> Self {
        e.to_string()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TsErrorKind {
    /// API call failed with a Win32 error code.
    Win32Error(u32),
    /// The requested session was not found.
    SessionNotFound,
    /// The requested server could not be opened.
    ServerNotFound,
    /// Access denied (insufficient privileges).
    AccessDenied,
    /// Operation timed out.
    Timeout,
    /// Invalid parameter supplied.
    InvalidParameter,
    /// The operation is not supported on this platform.
    PlatformNotSupported,
    /// Generic / catch-all.
    Other,
}

impl TsError {
    pub fn new(kind: TsErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }

    pub fn platform() -> Self {
        Self::new(
            TsErrorKind::PlatformNotSupported,
            "Terminal Services API is only available on Windows",
        )
    }

    #[cfg(windows)]
    pub fn win32(context: &str) -> Self {
        let code = unsafe { windows::Win32::Foundation::GetLastError() };
        Self::new(
            TsErrorKind::Win32Error(code.0),
            format!("{}: Win32 error {}", context, code.0),
        )
    }
}

pub type TsResult<T> = Result<T, TsError>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Connection state
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// WTS_CONNECTSTATE_CLASS – maps to the 10 possible session states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    /// User is logged on and actively connected.
    Active,
    /// Session is connected to the client.
    Connected,
    /// Session is in the process of connecting to the client.
    ConnectQuery,
    /// Session is shadowing another session.
    Shadow,
    /// Session is active but the client is disconnected.
    Disconnected,
    /// WinStation is waiting for a client to connect.
    Idle,
    /// WinStation is listening for a connection.
    Listen,
    /// WinStation is being reset.
    Reset,
    /// WinStation is down due to an error.
    Down,
    /// WinStation is initializing.
    Init,
    /// Unknown state not mapped from the API.
    Unknown,
}

impl fmt::Display for SessionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Active => write!(f, "Active"),
            Self::Connected => write!(f, "Connected"),
            Self::ConnectQuery => write!(f, "ConnectQuery"),
            Self::Shadow => write!(f, "Shadow"),
            Self::Disconnected => write!(f, "Disconnected"),
            Self::Idle => write!(f, "Idle"),
            Self::Listen => write!(f, "Listen"),
            Self::Reset => write!(f, "Reset"),
            Self::Down => write!(f, "Down"),
            Self::Init => write!(f, "Init"),
            Self::Unknown => write!(f, "Unknown"),
        }
    }
}

impl Default for SessionState {
    fn default() -> Self {
        Self::Unknown
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session info
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Basic session entry (from WTSEnumerateSessions).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEntry {
    /// Session ID.
    pub session_id: u32,
    /// WinStation name (e.g. "console", "RDP-Tcp#0", "services").
    pub win_station_name: String,
    /// Current connection state.
    pub state: SessionState,
}

/// Detailed session information aggregated from multiple WTSQuerySessionInformation calls.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    // ── Basic identification ─────────────────────────────────
    pub session_id: u32,
    pub win_station_name: String,
    pub state: SessionState,

    // ── User ─────────────────────────────────────────────────
    pub user_name: String,
    pub domain_name: String,

    // ── Client information ───────────────────────────────────
    pub client_name: String,
    pub client_address: String,
    pub client_address_family: String,
    pub client_build_number: u32,
    pub client_directory: String,
    pub client_product_id: u16,
    pub client_hardware_id: u32,
    pub client_protocol_type: ClientProtocol,
    pub encryption_level: u8,

    // ── Display ──────────────────────────────────────────────
    pub client_display_width: u16,
    pub client_display_height: u16,
    pub client_display_color_depth: u16,

    // ── Timing ───────────────────────────────────────────────
    pub connect_time: Option<DateTime<Utc>>,
    pub disconnect_time: Option<DateTime<Utc>>,
    pub last_input_time: Option<DateTime<Utc>>,
    pub logon_time: Option<DateTime<Utc>>,
    pub current_time: Option<DateTime<Utc>>,

    // ── Traffic stats ────────────────────────────────────────
    pub incoming_bytes: u32,
    pub outgoing_bytes: u32,
    pub incoming_frames: u32,
    pub outgoing_frames: u32,
    pub incoming_compressed_bytes: u32,
    pub outgoing_compressed_bytes: u32,

    // ── Misc ─────────────────────────────────────────────────
    pub initial_program: String,
    pub application_name: String,
    pub working_directory: String,
    pub is_remote_session: bool,
}

impl Default for SessionDetail {
    fn default() -> Self {
        Self {
            session_id: 0,
            win_station_name: String::new(),
            state: SessionState::Unknown,
            user_name: String::new(),
            domain_name: String::new(),
            client_name: String::new(),
            client_address: String::new(),
            client_address_family: String::new(),
            client_build_number: 0,
            client_directory: String::new(),
            client_product_id: 0,
            client_hardware_id: 0,
            client_protocol_type: ClientProtocol::Console,
            encryption_level: 0,
            client_display_width: 0,
            client_display_height: 0,
            client_display_color_depth: 0,
            connect_time: None,
            disconnect_time: None,
            last_input_time: None,
            logon_time: None,
            current_time: None,
            incoming_bytes: 0,
            outgoing_bytes: 0,
            incoming_frames: 0,
            outgoing_frames: 0,
            incoming_compressed_bytes: 0,
            outgoing_compressed_bytes: 0,
            initial_program: String::new(),
            application_name: String::new(),
            working_directory: String::new(),
            is_remote_session: false,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Client protocol
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Client protocol type (from WTSClientProtocolType).
/// 0 = Console, 1 = legacy (ICA, not used), 2 = RDP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClientProtocol {
    /// Physical console session.
    Console,
    /// Legacy protocol (ICA / Citrix).
    Legacy,
    /// Remote Desktop Protocol (RDP).
    Rdp,
    /// Unknown / unmapped value.
    Unknown,
}

impl Default for ClientProtocol {
    fn default() -> Self {
        Self::Console
    }
}

impl ClientProtocol {
    pub fn from_u16(v: u16) -> Self {
        match v {
            0 => Self::Console,
            1 => Self::Legacy,
            2 => Self::Rdp,
            _ => Self::Unknown,
        }
    }
}

impl fmt::Display for ClientProtocol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Console => write!(f, "Console"),
            Self::Legacy => write!(f, "Legacy"),
            Self::Rdp => write!(f, "RDP"),
            Self::Unknown => write!(f, "Unknown"),
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Process info
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A process running on an RD Session Host server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TsProcessInfo {
    /// Session ID that owns this process.
    pub session_id: u32,
    /// OS process ID.
    pub process_id: u32,
    /// Executable name (e.g. "explorer.exe").
    pub process_name: String,
    /// User SID string (e.g. "S-1-5-21-...").
    pub user_sid: String,
    /// Resolved user name if available (DOMAIN\User).
    pub user_name: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Server info
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A Remote Desktop Session Host server discovered in a domain.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TsServerInfo {
    /// Server name.
    pub server_name: String,
}

/// Identifier for an open server handle.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerHandle {
    /// Unique identifier assigned by the service layer.
    pub handle_id: String,
    /// Server name or address that was opened.
    pub server_name: String,
    /// When the handle was opened.
    pub opened_at: DateTime<Utc>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Shadow / Remote Control
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Options for starting a remote control (shadow) session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowOptions {
    /// Session ID to shadow.
    pub target_session_id: u32,
    /// Hot-key virtual key code to stop the shadow (e.g. VK_MULTIPLY = 0x6A).
    pub hotkey_vk: u8,
    /// Hot-key modifier (1 = SHIFT, 2 = CTRL, 4 = ALT).
    pub hotkey_modifier: u16,
    /// Whether to request interactive control or view-only.
    pub control: bool,
}

impl Default for ShadowOptions {
    fn default() -> Self {
        Self {
            target_session_id: 0,
            hotkey_vk: 0x6A, // VK_MULTIPLY (numpad *)
            hotkey_modifier: 2, // CTRL
            control: true,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Messaging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Style for the message box displayed on the client desktop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageStyle {
    /// OK button only.
    Ok,
    /// OK + Cancel.
    OkCancel,
    /// Yes + No.
    YesNo,
    /// Yes + No + Cancel.
    YesNoCancel,
    /// Abort + Retry + Ignore.
    AbortRetryIgnore,
    /// Retry + Cancel.
    RetryCancel,
}

impl Default for MessageStyle {
    fn default() -> Self {
        Self::Ok
    }
}

impl MessageStyle {
    /// Convert to Win32 MB_xxx flags.
    pub fn to_u32(self) -> u32 {
        match self {
            Self::Ok => 0x0000_0000,
            Self::OkCancel => 0x0000_0001,
            Self::YesNo => 0x0000_0004,
            Self::YesNoCancel => 0x0000_0003,
            Self::AbortRetryIgnore => 0x0000_0002,
            Self::RetryCancel => 0x0000_0005,
        }
    }
}

/// Response ID from the message box.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageResponse {
    Ok,
    Cancel,
    Yes,
    No,
    Abort,
    Retry,
    Ignore,
    Timeout,
    AsyncSent,
    Unknown,
}

impl MessageResponse {
    pub fn from_u32(v: u32) -> Self {
        match v {
            1 => Self::Ok,
            2 => Self::Cancel,
            3 => Self::Abort,
            4 => Self::Retry,
            5 => Self::Ignore,
            6 => Self::Yes,
            7 => Self::No,
            32000 => Self::Timeout,
            0 => Self::AsyncSent,
            _ => Self::Unknown,
        }
    }
}

/// Parameters to send a message to a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageParams {
    /// Session ID to send to.
    pub session_id: u32,
    /// Title bar text.
    pub title: String,
    /// Message body text.
    pub message: String,
    /// Message box style.
    pub style: MessageStyle,
    /// Timeout in seconds (0 = wait forever).
    pub timeout_seconds: u32,
    /// Whether to wait for the user to respond.
    pub wait: bool,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Listener info
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A Remote Desktop Services listener.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TsListenerInfo {
    pub name: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Shutdown flags
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Shutdown behaviour for WTSShutdownSystem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShutdownFlag {
    /// Log off all sessions then shut down.
    LogoffAndShutdown,
    /// Log off all sessions then reboot.
    LogoffAndReboot,
    /// Force-shut down (no logoff notification).
    ForceShutdown,
    /// Force-reboot (no logoff notification).
    ForceReboot,
    /// Perform a poweroff.
    Poweroff,
    /// Force-poweroff.
    ForcePoweroff,
}

impl ShutdownFlag {
    /// Map to the WTS_WSD_xxx constants.
    /// WTS_WSD_LOGOFF  = 0x1, WTS_WSD_SHUTDOWN = 0x2,
    /// WTS_WSD_REBOOT  = 0x4, WTS_WSD_POWEROFF = 0x8,
    /// WTS_WSD_FASTREBOOT = 0x10
    pub fn to_u32(self) -> u32 {
        match self {
            Self::LogoffAndShutdown => 0x1 | 0x2,       // LOGOFF | SHUTDOWN
            Self::LogoffAndReboot => 0x1 | 0x4,         // LOGOFF | REBOOT
            Self::ForceShutdown => 0x2,                  // SHUTDOWN
            Self::ForceReboot => 0x4,                    // REBOOT
            Self::Poweroff => 0x1 | 0x8,                 // LOGOFF | POWEROFF
            Self::ForcePoweroff => 0x8,                  // POWEROFF
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Aggregate status / summary
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Quick overview of the Terminal Services state on a server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TsServerSummary {
    pub server_name: String,
    pub total_sessions: usize,
    pub active_sessions: usize,
    pub disconnected_sessions: usize,
    pub idle_sessions: usize,
    pub listen_sessions: usize,
    pub total_processes: usize,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session event (for WTSWaitSystemEvent)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Event flags that can be awaited with WTSWaitSystemEvent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TsEventMask {
    /// Any event.
    All,
    /// New session created.
    Creation,
    /// Session deleted.
    Deletion,
    /// Session renamed.
    Rename,
    /// Session connected.
    Connect,
    /// Session disconnected.
    Disconnect,
    /// Session logged on.
    Logon,
    /// Session logged off.
    Logoff,
    /// Session state changed.
    StateChange,
    /// License state changed.
    License,
}

impl TsEventMask {
    /// Map to WTS_EVENT_xxx flags.
    pub fn to_u32(self) -> u32 {
        match self {
            Self::All => 0x7FFFFFFF,
            Self::Creation => 0x0001,
            Self::Deletion => 0x0002,
            Self::Rename => 0x0004,
            Self::Connect => 0x0008,
            Self::Disconnect => 0x0010,
            Self::Logon => 0x0020,
            Self::Logoff => 0x0040,
            Self::StateChange => 0x0080,
            Self::License => 0x0100,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  User config
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Terminal Services user configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TsUserConfig {
    pub user_name: String,
    pub server_name: String,
    /// Initial program to run on logon.
    pub initial_program: String,
    /// Working directory for the initial program.
    pub working_directory: String,
    /// Whether to inherit the initial program from the client.
    pub inherit_initial_program: bool,
    /// Whether connections from this user are allowed.
    pub allow_logon: bool,
    /// Maximum time (minutes) a disconnected session stays alive (0 = unlimited).
    pub max_disconnection_time: u32,
    /// Maximum time (minutes) an active session can stay connected (0 = unlimited).
    pub max_connection_time: u32,
    /// Maximum idle time (minutes) before disconnect (0 = unlimited).
    pub max_idle_time: u32,
    /// Whether to reset the session on disconnect rather than keep it.
    pub broken_connection_action_reset: bool,
    /// Whether to reconnect from any client or only the original.
    pub reconnect_same_client: bool,
    /// Terminal Services profile path.
    pub ts_profile_path: String,
    /// Terminal Services home directory.
    pub ts_home_dir: String,
    /// Terminal Services home drive letter.
    pub ts_home_drive: String,
}

impl Default for TsUserConfig {
    fn default() -> Self {
        Self {
            user_name: String::new(),
            server_name: String::new(),
            initial_program: String::new(),
            working_directory: String::new(),
            inherit_initial_program: true,
            allow_logon: true,
            max_disconnection_time: 0,
            max_connection_time: 0,
            max_idle_time: 0,
            broken_connection_action_reset: false,
            reconnect_same_client: false,
            ts_profile_path: String::new(),
            ts_home_dir: String::new(),
            ts_home_drive: String::new(),
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Virtual Channel
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Information about an open virtual channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualChannelInfo {
    /// Channel name (e.g. "CLIPRDR", "RDPDR", "DRDYNVC").
    pub channel_name: String,
    /// Session ID the channel belongs to.
    pub session_id: u32,
    /// Whether the channel is currently open.
    pub is_open: bool,
}

/// Well-known RDP static virtual channel names.
pub mod channel_names {
    /// Clipboard redirection.
    pub const CLIPRDR: &str = "CLIPRDR";
    /// Device redirection (drives, printers, serial ports).
    pub const RDPDR: &str = "RDPDR";
    /// Dynamic virtual channel transport.
    pub const DRDYNVC: &str = "DRDYNVC";
    /// Audio output redirection.
    pub const RDPSND: &str = "RDPSND";
    /// Smart card redirection.
    pub const SCARD: &str = "SCARD";
    /// Serial port redirection.
    pub const RDPCOM: &str = "RDPCOM";
    /// Display control (resize, monitors).
    pub const DISP: &str = "Microsoft::Windows::RDS::DisplayControl";
    /// Audio input (microphone) redirection.
    pub const AUDIN: &str = "AUDIO_INPUT";
    /// Graphics pipeline (RDPGFX).
    pub const RDPGFX: &str = "Microsoft::Windows::RDS::Graphics";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Encryption level descriptions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// RDP encryption level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EncryptionLevel {
    /// No encryption.
    None,
    /// 56-bit encryption.
    Low,
    /// Client compatible.
    ClientCompatible,
    /// 128-bit encryption.
    High,
    /// FIPS 140-1 compliant.
    FipsCompliant,
    /// Unknown level.
    Unknown,
}

impl EncryptionLevel {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::None,
            1 => Self::Low,
            2 => Self::ClientCompatible,
            3 => Self::High,
            4 => Self::FipsCompliant,
            _ => Self::Unknown,
        }
    }
}

impl fmt::Display for EncryptionLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::None => write!(f, "None"),
            Self::Low => write!(f, "Low (56-bit)"),
            Self::ClientCompatible => write!(f, "Client Compatible"),
            Self::High => write!(f, "High (128-bit)"),
            Self::FipsCompliant => write!(f, "FIPS Compliant"),
            Self::Unknown => write!(f, "Unknown"),
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session event record
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A recorded session event (from WTSWaitSystemEvent monitoring).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TsEventRecord {
    /// When the event was received.
    pub timestamp: DateTime<Utc>,
    /// The raw event flags bitmask.
    pub event_flags: u32,
    /// Decoded event types.
    pub events: Vec<TsEventMask>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session filter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Filter criteria for listing sessions.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFilter {
    /// Only include sessions in this state.
    pub state: Option<SessionState>,
    /// Only include sessions with this user (case-insensitive partial match).
    pub user_pattern: Option<String>,
    /// Only include sessions with a connected client (Active or Disconnected).
    pub user_sessions_only: bool,
    /// Only include remote (RDP) sessions.
    pub remote_only: bool,
    /// Minimum idle time in seconds (only include sessions idling at least this long).
    pub min_idle_seconds: Option<i64>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Batch operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Result of a batch operation (logoff, disconnect, message).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult {
    /// Number of sessions successfully operated on.
    pub succeeded: u32,
    /// Number of sessions that failed.
    pub failed: u32,
    /// Error messages for failures.
    pub errors: Vec<String>,
}

impl BatchResult {
    pub fn new() -> Self {
        Self { succeeded: 0, failed: 0, errors: Vec::new() }
    }

    pub fn record_success(&mut self) {
        self.succeeded += 1;
    }

    pub fn record_failure(&mut self, msg: String) {
        self.failed += 1;
        self.errors.push(msg);
    }
}

impl Default for BatchResult {
    fn default() -> Self {
        Self::new()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_state_display() {
        assert_eq!(SessionState::Active.to_string(), "Active");
        assert_eq!(SessionState::Disconnected.to_string(), "Disconnected");
        assert_eq!(SessionState::Listen.to_string(), "Listen");
    }

    #[test]
    fn session_state_default() {
        assert_eq!(SessionState::default(), SessionState::Unknown);
    }

    #[test]
    fn client_protocol_from_u16() {
        assert_eq!(ClientProtocol::from_u16(0), ClientProtocol::Console);
        assert_eq!(ClientProtocol::from_u16(2), ClientProtocol::Rdp);
        assert_eq!(ClientProtocol::from_u16(99), ClientProtocol::Unknown);
    }

    #[test]
    fn client_protocol_display() {
        assert_eq!(ClientProtocol::Rdp.to_string(), "RDP");
        assert_eq!(ClientProtocol::Console.to_string(), "Console");
    }

    #[test]
    fn message_style_to_u32() {
        assert_eq!(MessageStyle::Ok.to_u32(), 0);
        assert_eq!(MessageStyle::OkCancel.to_u32(), 1);
        assert_eq!(MessageStyle::YesNo.to_u32(), 4);
        assert_eq!(MessageStyle::YesNoCancel.to_u32(), 3);
    }

    #[test]
    fn message_response_from_u32() {
        assert_eq!(MessageResponse::from_u32(1), MessageResponse::Ok);
        assert_eq!(MessageResponse::from_u32(6), MessageResponse::Yes);
        assert_eq!(MessageResponse::from_u32(7), MessageResponse::No);
        assert_eq!(MessageResponse::from_u32(32000), MessageResponse::Timeout);
        assert_eq!(MessageResponse::from_u32(999), MessageResponse::Unknown);
    }

    #[test]
    fn shutdown_flag_values() {
        assert_eq!(ShutdownFlag::LogoffAndShutdown.to_u32(), 3); // 0x1 | 0x2
        assert_eq!(ShutdownFlag::LogoffAndReboot.to_u32(), 5);   // 0x1 | 0x4
        assert_eq!(ShutdownFlag::ForceReboot.to_u32(), 4);       // 0x4
    }

    #[test]
    fn event_mask_values() {
        assert_eq!(TsEventMask::All.to_u32(), 0x7FFFFFFF);
        assert_eq!(TsEventMask::Logon.to_u32(), 0x0020);
        assert_eq!(TsEventMask::Disconnect.to_u32(), 0x0010);
    }

    #[test]
    fn ts_error_display() {
        let e = TsError::new(TsErrorKind::SessionNotFound, "no such session 42");
        assert!(e.to_string().contains("SessionNotFound"));
        assert!(e.to_string().contains("no such session 42"));
    }

    #[test]
    fn ts_error_into_string() {
        let e = TsError::new(TsErrorKind::AccessDenied, "nope");
        let s: String = e.into();
        assert!(s.contains("AccessDenied"));
    }

    #[test]
    fn session_detail_default() {
        let d = SessionDetail::default();
        assert_eq!(d.session_id, 0);
        assert_eq!(d.state, SessionState::Unknown);
        assert!(d.user_name.is_empty());
    }

    #[test]
    fn session_entry_serde_roundtrip() {
        let entry = SessionEntry {
            session_id: 3,
            win_station_name: "RDP-Tcp#0".to_string(),
            state: SessionState::Active,
        };
        let json = serde_json::to_string(&entry).unwrap();
        let back: SessionEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(back.session_id, 3);
        assert_eq!(back.state, SessionState::Active);
    }

    #[test]
    fn session_detail_serde_roundtrip() {
        let detail = SessionDetail {
            session_id: 5,
            user_name: "Administrator".to_string(),
            domain_name: "CORP".to_string(),
            client_protocol_type: ClientProtocol::Rdp,
            ..Default::default()
        };
        let json = serde_json::to_string(&detail).unwrap();
        let back: SessionDetail = serde_json::from_str(&json).unwrap();
        assert_eq!(back.user_name, "Administrator");
        assert_eq!(back.client_protocol_type, ClientProtocol::Rdp);
    }

    #[test]
    fn ts_process_info_serde() {
        let p = TsProcessInfo {
            session_id: 1,
            process_id: 4567,
            process_name: "explorer.exe".to_string(),
            user_sid: "S-1-5-21-123456".to_string(),
            user_name: "CORP\\admin".to_string(),
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: TsProcessInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(back.process_id, 4567);
    }

    #[test]
    fn server_info_serde() {
        let s = TsServerInfo {
            server_name: "RDSH-01".to_string(),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("RDSH-01"));
    }

    #[test]
    fn shadow_options_default() {
        let so = ShadowOptions::default();
        assert_eq!(so.hotkey_vk, 0x6A); // VK_MULTIPLY
        assert_eq!(so.hotkey_modifier, 2); // CTRL
        assert!(so.control);
    }

    #[test]
    fn ts_user_config_default() {
        let cfg = TsUserConfig::default();
        assert!(cfg.allow_logon);
        assert_eq!(cfg.max_idle_time, 0);
        assert!(cfg.inherit_initial_program);
    }

    #[test]
    fn ts_server_summary_serde() {
        let sum = TsServerSummary {
            server_name: "HOST1".to_string(),
            total_sessions: 10,
            active_sessions: 3,
            disconnected_sessions: 2,
            idle_sessions: 4,
            listen_sessions: 1,
            total_processes: 150,
        };
        let json = serde_json::to_string(&sum).unwrap();
        let back: TsServerSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(back.total_sessions, 10);
    }

    #[test]
    fn send_message_params_serde() {
        let p = SendMessageParams {
            session_id: 2,
            title: "Warning".to_string(),
            message: "Server restarting in 5 min".to_string(),
            style: MessageStyle::OkCancel,
            timeout_seconds: 60,
            wait: true,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: SendMessageParams = serde_json::from_str(&json).unwrap();
        assert_eq!(back.timeout_seconds, 60);
    }

    #[test]
    fn ts_error_platform() {
        let e = TsError::platform();
        assert_eq!(e.kind, TsErrorKind::PlatformNotSupported);
        assert!(e.message.contains("Windows"));
    }

    #[test]
    fn listener_info_serde() {
        let li = TsListenerInfo {
            name: "RDP-Tcp".to_string(),
        };
        let json = serde_json::to_string(&li).unwrap();
        assert!(json.contains("RDP-Tcp"));
    }

    // ── New exhaustive tests ─────────────────────────────────────

    #[test]
    fn session_state_all_variants_display() {
        let variants = vec![
            (SessionState::Active, "Active"),
            (SessionState::Connected, "Connected"),
            (SessionState::ConnectQuery, "ConnectQuery"),
            (SessionState::Shadow, "Shadow"),
            (SessionState::Disconnected, "Disconnected"),
            (SessionState::Idle, "Idle"),
            (SessionState::Listen, "Listen"),
            (SessionState::Reset, "Reset"),
            (SessionState::Down, "Down"),
            (SessionState::Init, "Init"),
            (SessionState::Unknown, "Unknown"),
        ];
        for (state, expected) in variants {
            assert_eq!(state.to_string(), expected, "SessionState::{:?}", state);
        }
    }

    #[test]
    fn session_state_serde_all_variants() {
        let states = vec![
            SessionState::Active, SessionState::Connected,
            SessionState::Disconnected, SessionState::Idle,
            SessionState::Listen, SessionState::Shadow,
            SessionState::Unknown,
        ];
        for s in states {
            let json = serde_json::to_string(&s).unwrap();
            let back: SessionState = serde_json::from_str(&json).unwrap();
            assert_eq!(back, s);
        }
    }

    #[test]
    fn client_protocol_all_variants() {
        assert_eq!(ClientProtocol::from_u16(0), ClientProtocol::Console);
        assert_eq!(ClientProtocol::from_u16(1), ClientProtocol::Legacy);
        assert_eq!(ClientProtocol::from_u16(2), ClientProtocol::Rdp);
        assert_eq!(ClientProtocol::from_u16(3), ClientProtocol::Unknown);
        assert_eq!(ClientProtocol::from_u16(255), ClientProtocol::Unknown);
    }

    #[test]
    fn client_protocol_all_display() {
        assert_eq!(ClientProtocol::Console.to_string(), "Console");
        assert_eq!(ClientProtocol::Legacy.to_string(), "Legacy");
        assert_eq!(ClientProtocol::Rdp.to_string(), "RDP");
        assert_eq!(ClientProtocol::Unknown.to_string(), "Unknown");
    }

    #[test]
    fn client_protocol_default() {
        assert_eq!(ClientProtocol::default(), ClientProtocol::Console);
    }

    #[test]
    fn message_style_all_u32() {
        assert_eq!(MessageStyle::Ok.to_u32(), 0x0000_0000);
        assert_eq!(MessageStyle::OkCancel.to_u32(), 0x0000_0001);
        assert_eq!(MessageStyle::AbortRetryIgnore.to_u32(), 0x0000_0002);
        assert_eq!(MessageStyle::YesNoCancel.to_u32(), 0x0000_0003);
        assert_eq!(MessageStyle::YesNo.to_u32(), 0x0000_0004);
        assert_eq!(MessageStyle::RetryCancel.to_u32(), 0x0000_0005);
    }

    #[test]
    fn message_response_all_u32() {
        assert_eq!(MessageResponse::from_u32(0), MessageResponse::AsyncSent);
        assert_eq!(MessageResponse::from_u32(1), MessageResponse::Ok);
        assert_eq!(MessageResponse::from_u32(2), MessageResponse::Cancel);
        assert_eq!(MessageResponse::from_u32(3), MessageResponse::Abort);
        assert_eq!(MessageResponse::from_u32(4), MessageResponse::Retry);
        assert_eq!(MessageResponse::from_u32(5), MessageResponse::Ignore);
        assert_eq!(MessageResponse::from_u32(6), MessageResponse::Yes);
        assert_eq!(MessageResponse::from_u32(7), MessageResponse::No);
        assert_eq!(MessageResponse::from_u32(32000), MessageResponse::Timeout);
        assert_eq!(MessageResponse::from_u32(12345), MessageResponse::Unknown);
    }

    #[test]
    fn shutdown_flag_all_values() {
        assert_eq!(ShutdownFlag::LogoffAndShutdown.to_u32(), 0x1 | 0x2);
        assert_eq!(ShutdownFlag::LogoffAndReboot.to_u32(), 0x1 | 0x4);
        assert_eq!(ShutdownFlag::ForceShutdown.to_u32(), 0x2);
        assert_eq!(ShutdownFlag::ForceReboot.to_u32(), 0x4);
        assert_eq!(ShutdownFlag::Poweroff.to_u32(), 0x1 | 0x8);
        assert_eq!(ShutdownFlag::ForcePoweroff.to_u32(), 0x8);
    }

    #[test]
    fn event_mask_all_values() {
        assert_eq!(TsEventMask::All.to_u32(), 0x7FFF_FFFF);
        assert_eq!(TsEventMask::Creation.to_u32(), 0x0001);
        assert_eq!(TsEventMask::Deletion.to_u32(), 0x0002);
        assert_eq!(TsEventMask::Rename.to_u32(), 0x0004);
        assert_eq!(TsEventMask::Connect.to_u32(), 0x0008);
        assert_eq!(TsEventMask::Disconnect.to_u32(), 0x0010);
        assert_eq!(TsEventMask::Logon.to_u32(), 0x0020);
        assert_eq!(TsEventMask::Logoff.to_u32(), 0x0040);
        assert_eq!(TsEventMask::StateChange.to_u32(), 0x0080);
        assert_eq!(TsEventMask::License.to_u32(), 0x0100);
    }

    #[test]
    fn ts_error_kind_win32_variant() {
        let e = TsError::new(TsErrorKind::Win32Error(5), "Access denied");
        assert_eq!(e.kind, TsErrorKind::Win32Error(5));
        assert!(e.to_string().contains("Access denied"));
    }

    #[test]
    fn ts_error_kind_all_variants_serde() {
        let kinds = vec![
            TsErrorKind::Win32Error(123),
            TsErrorKind::SessionNotFound,
            TsErrorKind::ServerNotFound,
            TsErrorKind::AccessDenied,
            TsErrorKind::Timeout,
            TsErrorKind::InvalidParameter,
            TsErrorKind::PlatformNotSupported,
            TsErrorKind::Other,
        ];
        for k in kinds {
            let e = TsError::new(k.clone(), "test");
            let json = serde_json::to_string(&e).unwrap();
            let back: TsError = serde_json::from_str(&json).unwrap();
            assert_eq!(back.kind, k);
        }
    }

    #[test]
    fn session_detail_all_fields_populated() {
        let d = SessionDetail {
            session_id: 42,
            win_station_name: "RDP-Tcp#7".to_string(),
            state: SessionState::Active,
            user_name: "jsmith".to_string(),
            domain_name: "ACME".to_string(),
            client_name: "DESKTOP-ABC".to_string(),
            client_address: "192.168.1.100".to_string(),
            client_address_family: "AF_INET".to_string(),
            client_build_number: 10240,
            client_directory: "C:\\Windows\\system32\\mstscax.dll".to_string(),
            client_product_id: 1,
            client_hardware_id: 0,
            client_protocol_type: ClientProtocol::Rdp,
            encryption_level: 3,
            client_display_width: 1920,
            client_display_height: 1080,
            client_display_color_depth: 32,
            connect_time: Some(chrono::Utc::now()),
            disconnect_time: None,
            last_input_time: Some(chrono::Utc::now()),
            logon_time: Some(chrono::Utc::now()),
            current_time: Some(chrono::Utc::now()),
            incoming_bytes: 50000,
            outgoing_bytes: 120000,
            incoming_frames: 100,
            outgoing_frames: 250,
            incoming_compressed_bytes: 40000,
            outgoing_compressed_bytes: 95000,
            initial_program: String::new(),
            application_name: String::new(),
            working_directory: String::new(),
            is_remote_session: true,
        };
        let json = serde_json::to_string(&d).unwrap();
        let back: SessionDetail = serde_json::from_str(&json).unwrap();
        assert_eq!(back.session_id, 42);
        assert_eq!(back.client_display_width, 1920);
        assert!(back.is_remote_session);
        assert_eq!(back.incoming_bytes, 50000);
        assert_eq!(back.encryption_level, 3);
    }

    #[test]
    fn encryption_level_from_u8() {
        assert_eq!(EncryptionLevel::from_u8(0), EncryptionLevel::None);
        assert_eq!(EncryptionLevel::from_u8(1), EncryptionLevel::Low);
        assert_eq!(EncryptionLevel::from_u8(2), EncryptionLevel::ClientCompatible);
        assert_eq!(EncryptionLevel::from_u8(3), EncryptionLevel::High);
        assert_eq!(EncryptionLevel::from_u8(4), EncryptionLevel::FipsCompliant);
        assert_eq!(EncryptionLevel::from_u8(99), EncryptionLevel::Unknown);
    }

    #[test]
    fn encryption_level_display() {
        assert_eq!(EncryptionLevel::Low.to_string(), "Low (56-bit)");
        assert_eq!(EncryptionLevel::High.to_string(), "High (128-bit)");
        assert_eq!(EncryptionLevel::FipsCompliant.to_string(), "FIPS Compliant");
    }

    #[test]
    fn virtual_channel_info_serde() {
        let vc = VirtualChannelInfo {
            channel_name: "CLIPRDR".to_string(),
            session_id: 3,
            is_open: true,
        };
        let json = serde_json::to_string(&vc).unwrap();
        let back: VirtualChannelInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(back.channel_name, "CLIPRDR");
        assert!(back.is_open);
    }

    #[test]
    fn channel_names_defined() {
        assert_eq!(channel_names::CLIPRDR, "CLIPRDR");
        assert_eq!(channel_names::RDPDR, "RDPDR");
        assert_eq!(channel_names::DRDYNVC, "DRDYNVC");
        assert_eq!(channel_names::RDPSND, "RDPSND");
        assert_eq!(channel_names::SCARD, "SCARD");
    }

    #[test]
    fn session_filter_default() {
        let f = SessionFilter::default();
        assert!(f.state.is_none());
        assert!(f.user_pattern.is_none());
        assert!(!f.user_sessions_only);
        assert!(!f.remote_only);
        assert!(f.min_idle_seconds.is_none());
    }

    #[test]
    fn session_filter_serde() {
        let f = SessionFilter {
            state: Some(SessionState::Active),
            user_pattern: Some("admin".to_string()),
            user_sessions_only: true,
            remote_only: true,
            min_idle_seconds: Some(300),
        };
        let json = serde_json::to_string(&f).unwrap();
        let back: SessionFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(back.state, Some(SessionState::Active));
        assert_eq!(back.user_pattern.as_deref(), Some("admin"));
        assert!(back.remote_only);
        assert_eq!(back.min_idle_seconds, Some(300));
    }

    #[test]
    fn batch_result_tracking() {
        let mut br = BatchResult::new();
        assert_eq!(br.succeeded, 0);
        assert_eq!(br.failed, 0);

        br.record_success();
        br.record_success();
        br.record_failure("session 3: access denied".to_string());

        assert_eq!(br.succeeded, 2);
        assert_eq!(br.failed, 1);
        assert_eq!(br.errors.len(), 1);
        assert!(br.errors[0].contains("session 3"));
    }

    #[test]
    fn batch_result_serde() {
        let mut br = BatchResult::new();
        br.record_success();
        br.record_failure("error".to_string());
        let json = serde_json::to_string(&br).unwrap();
        let back: BatchResult = serde_json::from_str(&json).unwrap();
        assert_eq!(back.succeeded, 1);
        assert_eq!(back.failed, 1);
    }

    #[test]
    fn ts_event_record_serde() {
        let rec = TsEventRecord {
            timestamp: chrono::Utc::now(),
            event_flags: 0x28, // CONNECT | LOGON
            events: vec![TsEventMask::Connect, TsEventMask::Logon],
        };
        let json = serde_json::to_string(&rec).unwrap();
        let back: TsEventRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(back.event_flags, 0x28);
        assert_eq!(back.events.len(), 2);
    }

    #[test]
    fn ts_user_config_serde_roundtrip() {
        let cfg = TsUserConfig {
            user_name: "testuser".to_string(),
            server_name: "RDSH-01".to_string(),
            initial_program: "notepad.exe".to_string(),
            working_directory: "C:\\Users\\test".to_string(),
            inherit_initial_program: false,
            allow_logon: true,
            max_disconnection_time: 60,
            max_connection_time: 480,
            max_idle_time: 30,
            broken_connection_action_reset: true,
            reconnect_same_client: true,
            ts_profile_path: "\\\\server\\profiles\\test".to_string(),
            ts_home_dir: "\\\\server\\home\\test".to_string(),
            ts_home_drive: "H:".to_string(),
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let back: TsUserConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.user_name, "testuser");
        assert!(!back.inherit_initial_program);
        assert_eq!(back.max_disconnection_time, 60);
        assert_eq!(back.ts_home_drive, "H:");
    }

    #[test]
    fn server_handle_serde() {
        let h = ServerHandle {
            handle_id: "abc-123".to_string(),
            server_name: "RDSH-01".to_string(),
            opened_at: chrono::Utc::now(),
        };
        let json = serde_json::to_string(&h).unwrap();
        let back: ServerHandle = serde_json::from_str(&json).unwrap();
        assert_eq!(back.handle_id, "abc-123");
    }

    #[test]
    fn session_detail_json_field_names_are_camel_case() {
        let d = SessionDetail {
            session_id: 1,
            client_display_width: 1920,
            is_remote_session: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&d).unwrap();
        assert!(json.contains("sessionId"));
        assert!(json.contains("clientDisplayWidth"));
        assert!(json.contains("isRemoteSession"));
        // Ensure snake_case is NOT present
        assert!(!json.contains("session_id"));
        assert!(!json.contains("client_display_width"));
    }

    #[test]
    fn shadow_options_serde_roundtrip() {
        let so = ShadowOptions {
            target_session_id: 5,
            hotkey_vk: 0x70, // VK_F1
            hotkey_modifier: 4, // ALT
            control: false,
        };
        let json = serde_json::to_string(&so).unwrap();
        let back: ShadowOptions = serde_json::from_str(&json).unwrap();
        assert_eq!(back.target_session_id, 5);
        assert!(!back.control);
    }

    #[test]
    fn shutdown_flag_serde_roundtrip() {
        let flags = vec![
            ShutdownFlag::LogoffAndShutdown,
            ShutdownFlag::LogoffAndReboot,
            ShutdownFlag::ForceShutdown,
            ShutdownFlag::ForceReboot,
            ShutdownFlag::Poweroff,
            ShutdownFlag::ForcePoweroff,
        ];
        for flag in flags {
            let json = serde_json::to_string(&flag).unwrap();
            let back: ShutdownFlag = serde_json::from_str(&json).unwrap();
            assert_eq!(back, flag);
        }
    }

    #[test]
    fn message_style_serde_roundtrip() {
        let styles = vec![
            MessageStyle::Ok,
            MessageStyle::OkCancel,
            MessageStyle::YesNo,
            MessageStyle::YesNoCancel,
            MessageStyle::AbortRetryIgnore,
            MessageStyle::RetryCancel,
        ];
        for s in styles {
            let json = serde_json::to_string(&s).unwrap();
            let back: MessageStyle = serde_json::from_str(&json).unwrap();
            assert_eq!(back, s);
        }
    }

    #[test]
    fn message_response_serde_roundtrip() {
        let responses = vec![
            MessageResponse::Ok,
            MessageResponse::Cancel,
            MessageResponse::Yes,
            MessageResponse::No,
            MessageResponse::Abort,
            MessageResponse::Retry,
            MessageResponse::Ignore,
            MessageResponse::Timeout,
            MessageResponse::AsyncSent,
            MessageResponse::Unknown,
        ];
        for r in responses {
            let json = serde_json::to_string(&r).unwrap();
            let back: MessageResponse = serde_json::from_str(&json).unwrap();
            assert_eq!(back, r);
        }
    }

    #[test]
    fn ts_error_std_error_trait() {
        let e = TsError::new(TsErrorKind::Other, "boom");
        let _: &dyn std::error::Error = &e;
    }

    #[test]
    fn message_style_default() {
        assert_eq!(MessageStyle::default(), MessageStyle::Ok);
    }
}
