//! Data types for RDP file parsing and generation.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── RdpValue ───────────────────────────────────────────────────────

/// A typed value from an RDP file setting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum RdpValue {
    /// An integer value (corresponds to `i:` prefix in .rdp files).
    Integer(i64),
    /// A string value (corresponds to `s:` prefix in .rdp files).
    String(String),
}

impl RdpValue {
    /// Try to extract as an integer.
    pub fn as_integer(&self) -> Option<i64> {
        match self {
            RdpValue::Integer(v) => Some(*v),
            _ => None,
        }
    }

    /// Try to extract as a string.
    pub fn as_string(&self) -> Option<&str> {
        match self {
            RdpValue::String(v) => Some(v.as_str()),
            _ => None,
        }
    }

    /// Convert a boolean-style value to bool (0 = false, nonzero = true).
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            RdpValue::Integer(v) => Some(*v != 0),
            _ => None,
        }
    }
}

// ─── RdpFile ────────────────────────────────────────────────────────

/// Represents a fully parsed Microsoft .rdp file with all standard settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpFile {
    // ── Connection ──────────────────────────────────────────────
    /// The remote computer address (e.g. "192.168.1.100" or "server.example.com").
    pub full_address: String,
    /// Server port (default 3389).
    pub server_port: Option<u16>,
    /// Username for auto-logon.
    pub username: Option<String>,
    /// Domain for auto-logon.
    pub domain: Option<String>,

    // ── Display ─────────────────────────────────────────────────
    /// 1 = windowed, 2 = fullscreen.
    pub screen_mode_id: Option<u8>,
    /// Desktop width in pixels.
    pub desktopwidth: Option<u32>,
    /// Desktop height in pixels.
    pub desktopheight: Option<u32>,
    /// Session color depth in bits per pixel (e.g. 15, 16, 24, 32).
    pub session_bpp: Option<u8>,
    /// Enable multi-monitor support.
    pub use_multimon: Option<bool>,
    /// Enable smart sizing (scale remote desktop to window).
    pub smart_sizing: Option<bool>,
    /// Enable dynamic resolution updates.
    pub dynamic_resolution: Option<bool>,

    // ── Performance ─────────────────────────────────────────────
    /// Enable compression.
    pub compression: Option<bool>,
    /// Connection type: 1=Modem, 2=Low-speed, 3=Satellite, 4=High-speed, 5=WAN, 6=LAN, 7=Auto.
    pub connection_type: Option<u8>,
    /// Enable automatic network type detection.
    pub networkautodetect: Option<bool>,
    /// Enable bandwidth auto-detection.
    pub bandwidthautodetect: Option<bool>,
    /// Show the connection bar in fullscreen.
    pub displayconnectionbar: Option<bool>,
    /// Enable workspace reconnect.
    pub enableworkspacereconnect: Option<bool>,
    /// Disable desktop wallpaper.
    pub disable_wallpaper: Option<bool>,
    /// Allow font smoothing (ClearType).
    pub allow_font_smoothing: Option<bool>,
    /// Allow desktop composition (Aero).
    pub allow_desktop_composition: Option<bool>,
    /// Disable full-window drag.
    pub disable_full_window_drag: Option<bool>,
    /// Disable menu animations.
    pub disable_menu_anims: Option<bool>,
    /// Disable visual themes.
    pub disable_themes: Option<bool>,
    /// Disable cursor setting.
    pub disable_cursor_setting: Option<bool>,
    /// Enable persistent bitmap caching.
    pub bitmapcachepersistenable: Option<bool>,
    /// Bitmap cache size in KB.
    pub bitmapcachesize: Option<u32>,

    // ── Audio / Video ───────────────────────────────────────────
    /// Audio playback mode: 0=local, 1=remote, 2=none.
    pub audiomode: Option<u8>,
    /// Audio capture mode: 0=don't capture, 1=capture.
    pub audiocapturemode: Option<u8>,
    /// Video playback mode: 0=don't use, 1=use.
    pub videoplaybackmode: Option<u8>,

    // ── Redirection ─────────────────────────────────────────────
    /// Redirect printers.
    pub redirectprinters: Option<bool>,
    /// Redirect COM/serial ports.
    pub redirectcomports: Option<bool>,
    /// Redirect smart cards.
    pub redirectsmartcards: Option<bool>,
    /// Redirect clipboard.
    pub redirectclipboard: Option<bool>,
    /// Redirect POS (Point of Service) devices.
    pub redirectposdevices: Option<bool>,
    /// Redirect DirectX.
    pub redirectdirectx: Option<bool>,
    /// Drive redirection string (e.g. "*" for all, "C:;D:" for specific).
    pub drivestoredirect: Option<String>,
    /// Redirect WebAuthn requests.
    pub redirectwebauthn: Option<bool>,

    // ── Authentication / Security ───────────────────────────────
    /// Auto-reconnection enabled.
    pub autoreconnection_enabled: Option<bool>,
    /// Authentication level: 0=connect, 1=no connect, 2=warn, 3=not required.
    pub authentication_level: Option<u8>,
    /// Prompt for credentials on the client.
    pub prompt_for_credentials: Option<bool>,
    /// Negotiate security layer.
    pub negotiate_security_layer: Option<bool>,
    /// Enable CredSSP (Network Level Authentication).
    pub enablecredsspsupport: Option<bool>,

    // ── RemoteApp ───────────────────────────────────────────────
    /// Enable RemoteApp/published application mode.
    pub remoteapplicationmode: Option<bool>,
    /// Alternate shell (program to start on connection).
    pub alternate_shell: Option<String>,
    /// Shell working directory.
    pub shell_working_directory: Option<String>,

    // ── Gateway ─────────────────────────────────────────────────
    /// RD Gateway hostname.
    pub gatewayhostname: Option<String>,
    /// Gateway usage method: 0=none, 1=always, 2=detect, 3=default, 4=never.
    pub gatewayusagemethod: Option<u8>,
    /// Gateway credentials source: 0=ask, 1=smartcard, 4=allow later.
    pub gatewaycredentialssource: Option<u8>,
    /// Gateway profile usage method.
    pub gatewayprofileusagemethod: Option<u8>,

    // ── Keyboard / Input ────────────────────────────────────────
    /// Keyboard hook mode: 0=local, 1=remote, 2=fullscreen only.
    pub keyboardhook: Option<u8>,

    // ── Misc ────────────────────────────────────────────────────
    /// Use redirection server name.
    pub use_redirection_server_name: Option<bool>,
    /// Load balance info string.
    pub loadbalanceinfo: Option<String>,
    /// Whether the RDG is a KDC proxy.
    pub rdgiskdcproxy: Option<bool>,
    /// KDC proxy name.
    pub kdcproxyname: Option<String>,

    // ── Catch-all ───────────────────────────────────────────────
    /// Any settings not covered by the typed fields above.
    pub custom_settings: HashMap<String, RdpValue>,
}

impl Default for RdpFile {
    fn default() -> Self {
        Self {
            full_address: String::new(),
            server_port: None,
            username: None,
            domain: None,
            screen_mode_id: None,
            desktopwidth: None,
            desktopheight: None,
            session_bpp: None,
            use_multimon: None,
            smart_sizing: None,
            dynamic_resolution: None,
            compression: None,
            connection_type: None,
            networkautodetect: None,
            bandwidthautodetect: None,
            displayconnectionbar: None,
            enableworkspacereconnect: None,
            disable_wallpaper: None,
            allow_font_smoothing: None,
            allow_desktop_composition: None,
            disable_full_window_drag: None,
            disable_menu_anims: None,
            disable_themes: None,
            disable_cursor_setting: None,
            bitmapcachepersistenable: None,
            bitmapcachesize: None,
            audiomode: None,
            audiocapturemode: None,
            videoplaybackmode: None,
            redirectprinters: None,
            redirectcomports: None,
            redirectsmartcards: None,
            redirectclipboard: None,
            redirectposdevices: None,
            redirectdirectx: None,
            drivestoredirect: None,
            redirectwebauthn: None,
            autoreconnection_enabled: None,
            authentication_level: None,
            prompt_for_credentials: None,
            negotiate_security_layer: None,
            enablecredsspsupport: None,
            remoteapplicationmode: None,
            alternate_shell: None,
            shell_working_directory: None,
            gatewayhostname: None,
            gatewayusagemethod: None,
            gatewaycredentialssource: None,
            gatewayprofileusagemethod: None,
            keyboardhook: None,
            use_redirection_server_name: None,
            loadbalanceinfo: None,
            rdgiskdcproxy: None,
            kdcproxyname: None,
            custom_settings: HashMap::new(),
        }
    }
}

// ─── RdpParseResult ─────────────────────────────────────────────────

/// Result of parsing an .rdp file, including warnings and unknown settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpParseResult {
    /// The parsed RDP file structure.
    pub rdp_file: RdpFile,
    /// Warnings encountered during parsing (deprecated settings, unusual values, etc.).
    pub warnings: Vec<String>,
    /// Names of settings that were not recognized and placed into `custom_settings`.
    pub unknown_settings: Vec<String>,
}

// ─── ConnectionImport ───────────────────────────────────────────────

/// A connection record converted from an RDP file, suitable for import into the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionImport {
    /// Display name for the connection.
    pub name: String,
    /// Hostname / IP address.
    pub hostname: String,
    /// Port number (default 3389).
    pub port: u16,
    /// Username.
    pub username: Option<String>,
    /// Domain.
    pub domain: Option<String>,
    /// All RDP-specific settings as a JSON value for flexible storage.
    pub rdp_settings: serde_json::Value,
}
