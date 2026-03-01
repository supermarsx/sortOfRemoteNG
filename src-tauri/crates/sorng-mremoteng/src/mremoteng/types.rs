//! mRemoteNG data types — complete connection model mirroring all
//! properties from mRemoteNG's `ConnectionInfo` / `AbstractConnectionRecord`.

use serde::{Deserialize, Serialize};

// ─── Protocol Types ─────────────────────────────────────────────────

/// Protocol types supported by mRemoteNG (mirrors `ProtocolType` enum).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MrngProtocol {
    RDP = 0,
    VNC = 1,
    SSH1 = 2,
    SSH2 = 3,
    Telnet = 4,
    Rlogin = 5,
    RAW = 6,
    HTTP = 7,
    HTTPS = 8,
    PowerShell = 10,
    Winbox = 11,
    IntApp = 20,
}

impl Default for MrngProtocol {
    fn default() -> Self { Self::RDP }
}

impl MrngProtocol {
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_uppercase().as_str() {
            "RDP" | "0" => Self::RDP,
            "VNC" | "1" => Self::VNC,
            "SSH1" | "2" => Self::SSH1,
            "SSH2" | "SSH" | "3" => Self::SSH2,
            "TELNET" | "4" => Self::Telnet,
            "RLOGIN" | "5" => Self::Rlogin,
            "RAW" | "6" => Self::RAW,
            "HTTP" | "7" => Self::HTTP,
            "HTTPS" | "8" => Self::HTTPS,
            "POWERSHELL" | "10" => Self::PowerShell,
            "WINBOX" | "11" => Self::Winbox,
            "INTAPP" | "20" => Self::IntApp,
            _ => Self::RDP,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::RDP => "RDP",
            Self::VNC => "VNC",
            Self::SSH1 => "SSH1",
            Self::SSH2 => "SSH2",
            Self::Telnet => "Telnet",
            Self::Rlogin => "Rlogin",
            Self::RAW => "RAW",
            Self::HTTP => "HTTP",
            Self::HTTPS => "HTTPS",
            Self::PowerShell => "PowerShell",
            Self::Winbox => "Winbox",
            Self::IntApp => "IntApp",
        }
    }

    pub fn default_port(&self) -> u16 {
        match self {
            Self::RDP => 3389,
            Self::VNC => 5900,
            Self::SSH1 | Self::SSH2 => 22,
            Self::Telnet => 23,
            Self::Rlogin => 513,
            Self::RAW => 23,
            Self::HTTP => 80,
            Self::HTTPS => 443,
            Self::PowerShell => 5985,
            Self::Winbox => 8291,
            Self::IntApp => 0,
        }
    }
}

// ─── RDP Enums ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RdpVersion {
    Rdc6 = 0,
    Rdc7 = 1,
    Rdc8 = 2,
    Rdc10 = 3,
}
impl Default for RdpVersion { fn default() -> Self { Self::Rdc10 } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthenticationLevel {
    NoAuth = 0,
    AuthRequired = 1,
    WarnOnFailedAuth = 2,
}
impl Default for AuthenticationLevel { fn default() -> Self { Self::NoAuth } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RDPResolutions {
    FitToWindow = 0,
    Fullscreen = 1,
    SmartSize = 2,
    Res800x600 = 3,
    Res1024x768 = 4,
    Res1280x1024 = 5,
    Res1600x1200 = 6,
}
impl Default for RDPResolutions { fn default() -> Self { Self::FitToWindow } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RDPColors {
    Colors256 = 0,
    Colors15Bit = 1,
    Colors16Bit = 2,
    Colors24Bit = 3,
    Colors32Bit = 4,
}
impl Default for RDPColors { fn default() -> Self { Self::Colors32Bit } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RDPSounds {
    BringToThisComputer = 0,
    LeaveAtRemoteComputer = 1,
    DoNotPlay = 2,
}
impl Default for RDPSounds { fn default() -> Self { Self::BringToThisComputer } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RDPSoundQuality {
    Dynamic = 0,
    Medium = 1,
    High = 2,
}
impl Default for RDPSoundQuality { fn default() -> Self { Self::Dynamic } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RDPDiskDrives {
    None = 0,
    Local = 1,
    Custom = 2,
    All = 3,
}
impl Default for RDPDiskDrives { fn default() -> Self { Self::None } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RDGatewayUsageMethod {
    Never = 0,
    Always = 1,
    Detect = 2,
}
impl Default for RDGatewayUsageMethod { fn default() -> Self { Self::Never } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RDGatewayUseConnectionCredentials {
    Yes = 0,
    SmartCard = 1,
    AskForCredentials = 2,
}
impl Default for RDGatewayUseConnectionCredentials { fn default() -> Self { Self::Yes } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RenderingEngine {
    IE = 0,
    Gecko = 1,
    Webkit = 2,
    EdgeChromium = 3,
}
impl Default for RenderingEngine { fn default() -> Self { Self::IE } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExternalAddressProvider {
    None = 0,
    AmazonEC2 = 1,
}
impl Default for ExternalAddressProvider { fn default() -> Self { Self::None } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExternalCredentialProvider {
    None = 0,
    CyberArkPSM = 1,
    VaultOpenbao = 2,
}
impl Default for ExternalCredentialProvider { fn default() -> Self { Self::None } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionFrameColor {
    None = 0,
    Red = 1,
    Green = 2,
    Blue = 3,
    Yellow = 4,
    Orange = 5,
    Purple = 6,
}
impl Default for ConnectionFrameColor { fn default() -> Self { Self::None } }

// ─── VNC Enums ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VncCompression {
    CompNone = 0,
    Comp0 = 1,
    Comp1 = 2,
    Comp2 = 3,
    Comp3 = 4,
    Comp4 = 5,
    Comp5 = 6,
    Comp6 = 7,
    Comp7 = 8,
    Comp8 = 9,
    Comp9 = 10,
}
impl Default for VncCompression { fn default() -> Self { Self::CompNone } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VncEncoding {
    EncRaw = 0,
    EncRRE = 1,
    EncCoRRE = 2,
    EncHextile = 3,
    EncZlib = 4,
    EncTight = 5,
    EncZRLE = 6,
    EncZYWRLE = 7,
    EncUltra = 8,
    EncUltra2 = 9,
}
impl Default for VncEncoding { fn default() -> Self { Self::EncTight } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VncAuthMode {
    AuthVNC = 0,
    AuthWin = 1,
}
impl Default for VncAuthMode { fn default() -> Self { Self::AuthVNC } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VncProxyType {
    ProxyNone = 0,
    ProxySocks5 = 1,
    ProxyHTTP = 2,
    ProxyUltra = 3,
}
impl Default for VncProxyType { fn default() -> Self { Self::ProxyNone } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VncColors {
    ColNormal = 0,
    Col8Bit = 1,
    Col16Bit = 2,
    Col256 = 3,
    Col64 = 4,
    Col8 = 5,
    Col3 = 6,
    Col2 = 7,
}
impl Default for VncColors { fn default() -> Self { Self::ColNormal } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VncSmartSizeMode {
    SmartSizeDisabled = 0,
    SmartSizeFree = 1,
    SmartSizeAspect = 2,
}
impl Default for VncSmartSizeMode { fn default() -> Self { Self::SmartSizeDisabled } }

// ─── Encryption Config ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BlockCipherEngine {
    AES,
    Serpent,
    Twofish,
}
impl Default for BlockCipherEngine { fn default() -> Self { Self::AES } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BlockCipherMode {
    GCM,
    CCM,
    EAX,
}
impl Default for BlockCipherMode { fn default() -> Self { Self::GCM } }

/// Encryption configuration stored in the root `<Connections>` element.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrngEncryptionConfig {
    pub engine: BlockCipherEngine,
    pub mode: BlockCipherMode,
    pub kdf_iterations: u32,
    pub full_file_encryption: bool,
}

impl Default for MrngEncryptionConfig {
    fn default() -> Self {
        Self {
            engine: BlockCipherEngine::AES,
            mode: BlockCipherMode::GCM,
            kdf_iterations: 1000,
            full_file_encryption: false,
        }
    }
}

// ─── Node Types ─────────────────────────────────────────────────────

/// The type of a node in the connection tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MrngNodeType {
    Connection,
    Container,
    Root,
}

impl Default for MrngNodeType {
    fn default() -> Self { Self::Connection }
}

impl MrngNodeType {
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "connection" => Self::Connection,
            "container" => Self::Container,
            "root" | "rootnode" => Self::Root,
            _ => Self::Connection,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Connection => "Connection",
            Self::Container => "Container",
            Self::Root => "Root",
        }
    }
}

// ─── Connection Info ────────────────────────────────────────────────

/// Complete mRemoteNG connection/container node with every property.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrngConnectionInfo {
    // ── Identity ────────────────────────────────────────────────
    pub constant_id: String,
    pub name: String,
    pub node_type: MrngNodeType,

    // ── Display ─────────────────────────────────────────────────
    pub description: String,
    pub icon: String,
    pub panel: String,
    pub color: String,
    pub tab_color: String,
    pub connection_frame_color: ConnectionFrameColor,

    // ── Connection ──────────────────────────────────────────────
    pub hostname: String,
    pub port: u16,
    pub protocol: MrngProtocol,
    pub rdp_version: RdpVersion,
    pub ext_app: String,
    pub putty_session: String,
    pub ssh_options: String,
    pub ssh_tunnel_connection_name: String,
    pub opening_command: String,

    // ── Credentials ─────────────────────────────────────────────
    pub username: String,
    pub password: String,
    pub domain: String,
    pub external_credential_provider: ExternalCredentialProvider,
    pub user_via_api: String,
    pub vault_openbao_mount: String,
    pub vault_openbao_role: String,

    // ── External Address ────────────────────────────────────────
    pub external_address_provider: ExternalAddressProvider,
    pub ec2_instance_id: String,
    pub ec2_region: String,

    // ── Hyper-V ─────────────────────────────────────────────────
    pub vm_id: String,
    pub use_vm_id: bool,
    pub use_enhanced_mode: bool,

    // ── RDP Protocol Options ────────────────────────────────────
    pub use_console_session: bool,
    pub rdp_authentication_level: AuthenticationLevel,
    pub rdp_minutes_to_idle_timeout: u32,
    pub rdp_alert_idle_timeout: bool,
    pub load_balance_info: String,
    pub rendering_engine: RenderingEngine,
    pub use_cred_ssp: bool,
    pub use_restricted_admin: bool,
    pub use_rcg: bool,

    // ── RD Gateway ──────────────────────────────────────────────
    pub rd_gateway_usage_method: RDGatewayUsageMethod,
    pub rd_gateway_hostname: String,
    pub rd_gateway_use_connection_credentials: RDGatewayUseConnectionCredentials,
    pub rd_gateway_username: String,
    pub rd_gateway_password: String,
    pub rd_gateway_domain: String,
    pub rd_gateway_access_token: String,
    pub rd_gateway_external_credential_provider: ExternalCredentialProvider,
    pub rd_gateway_user_via_api: String,

    // ── Appearance (RDP) ────────────────────────────────────────
    pub resolution: RDPResolutions,
    pub automatic_resize: bool,
    pub colors: RDPColors,
    pub cache_bitmaps: bool,
    pub display_wallpaper: bool,
    pub display_themes: bool,
    pub enable_font_smoothing: bool,
    pub enable_desktop_composition: bool,
    pub disable_full_window_drag: bool,
    pub disable_menu_animations: bool,
    pub disable_cursor_shadow: bool,
    pub disable_cursor_blinking: bool,

    // ── Redirect (RDP) ──────────────────────────────────────────
    pub redirect_keys: bool,
    pub redirect_disk_drives: RDPDiskDrives,
    pub redirect_disk_drives_custom: String,
    pub redirect_printers: bool,
    pub redirect_clipboard: bool,
    pub redirect_ports: bool,
    pub redirect_smart_cards: bool,
    pub redirect_sound: RDPSounds,
    pub sound_quality: RDPSoundQuality,
    pub redirect_audio_capture: bool,

    // ── Remote Desktop Services ─────────────────────────────────
    pub rdp_start_program: String,
    pub rdp_start_program_work_dir: String,

    // ── VNC ─────────────────────────────────────────────────────
    pub vnc_compression: VncCompression,
    pub vnc_encoding: VncEncoding,
    pub vnc_auth_mode: VncAuthMode,
    pub vnc_proxy_type: VncProxyType,
    pub vnc_proxy_ip: String,
    pub vnc_proxy_port: u16,
    pub vnc_proxy_username: String,
    pub vnc_proxy_password: String,
    pub vnc_colors: VncColors,
    pub vnc_smart_size_mode: VncSmartSizeMode,
    pub vnc_view_only: bool,

    // ── Miscellaneous ───────────────────────────────────────────
    pub pre_ext_app: String,
    pub post_ext_app: String,
    pub mac_address: String,
    pub user_field: String,
    pub environment_tags: String,
    pub favorite: bool,

    // ── Inheritance ─────────────────────────────────────────────
    pub inheritance: MrngInheritance,

    // ── Children (for containers) ───────────────────────────────
    pub children: Vec<MrngConnectionInfo>,
}

impl Default for MrngConnectionInfo {
    fn default() -> Self {
        Self {
            constant_id: uuid::Uuid::new_v4().to_string(),
            name: String::new(),
            node_type: MrngNodeType::Connection,
            description: String::new(),
            icon: "mRemoteNG".into(),
            panel: "General".into(),
            color: String::new(),
            tab_color: String::new(),
            connection_frame_color: ConnectionFrameColor::None,
            hostname: String::new(),
            port: 0,
            protocol: MrngProtocol::RDP,
            rdp_version: RdpVersion::default(),
            ext_app: String::new(),
            putty_session: "Default Settings".into(),
            ssh_options: String::new(),
            ssh_tunnel_connection_name: String::new(),
            opening_command: String::new(),
            username: String::new(),
            password: String::new(),
            domain: String::new(),
            external_credential_provider: ExternalCredentialProvider::None,
            user_via_api: String::new(),
            vault_openbao_mount: String::new(),
            vault_openbao_role: String::new(),
            external_address_provider: ExternalAddressProvider::None,
            ec2_instance_id: String::new(),
            ec2_region: String::new(),
            vm_id: String::new(),
            use_vm_id: false,
            use_enhanced_mode: false,
            use_console_session: false,
            rdp_authentication_level: AuthenticationLevel::NoAuth,
            rdp_minutes_to_idle_timeout: 0,
            rdp_alert_idle_timeout: false,
            load_balance_info: String::new(),
            rendering_engine: RenderingEngine::IE,
            use_cred_ssp: true,
            use_restricted_admin: false,
            use_rcg: false,
            rd_gateway_usage_method: RDGatewayUsageMethod::Never,
            rd_gateway_hostname: String::new(),
            rd_gateway_use_connection_credentials: RDGatewayUseConnectionCredentials::Yes,
            rd_gateway_username: String::new(),
            rd_gateway_password: String::new(),
            rd_gateway_domain: String::new(),
            rd_gateway_access_token: String::new(),
            rd_gateway_external_credential_provider: ExternalCredentialProvider::None,
            rd_gateway_user_via_api: String::new(),
            resolution: RDPResolutions::FitToWindow,
            automatic_resize: true,
            colors: RDPColors::Colors32Bit,
            cache_bitmaps: false,
            display_wallpaper: false,
            display_themes: false,
            enable_font_smoothing: false,
            enable_desktop_composition: false,
            disable_full_window_drag: false,
            disable_menu_animations: false,
            disable_cursor_shadow: false,
            disable_cursor_blinking: false,
            redirect_keys: false,
            redirect_disk_drives: RDPDiskDrives::None,
            redirect_disk_drives_custom: String::new(),
            redirect_printers: false,
            redirect_clipboard: true,
            redirect_ports: false,
            redirect_smart_cards: false,
            redirect_sound: RDPSounds::DoNotPlay,
            sound_quality: RDPSoundQuality::Dynamic,
            redirect_audio_capture: false,
            rdp_start_program: String::new(),
            rdp_start_program_work_dir: String::new(),
            vnc_compression: VncCompression::default(),
            vnc_encoding: VncEncoding::default(),
            vnc_auth_mode: VncAuthMode::default(),
            vnc_proxy_type: VncProxyType::default(),
            vnc_proxy_ip: String::new(),
            vnc_proxy_port: 0,
            vnc_proxy_username: String::new(),
            vnc_proxy_password: String::new(),
            vnc_colors: VncColors::default(),
            vnc_smart_size_mode: VncSmartSizeMode::default(),
            vnc_view_only: false,
            pre_ext_app: String::new(),
            post_ext_app: String::new(),
            mac_address: String::new(),
            user_field: String::new(),
            environment_tags: String::new(),
            favorite: false,
            inheritance: MrngInheritance::default(),
            children: Vec::new(),
        }
    }
}

// ─── Inheritance ────────────────────────────────────────────────────

/// Per-property inheritance flags.
/// When `true`, the property is inherited from the parent container.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MrngInheritance {
    pub cache_bitmaps: bool,
    pub colors: bool,
    pub description: bool,
    pub display_themes: bool,
    pub display_wallpaper: bool,
    pub enable_font_smoothing: bool,
    pub enable_desktop_composition: bool,
    pub disable_full_window_drag: bool,
    pub disable_menu_animations: bool,
    pub disable_cursor_shadow: bool,
    pub disable_cursor_blinking: bool,
    pub domain: bool,
    pub ext_app: bool,
    pub icon: bool,
    pub panel: bool,
    pub password: bool,
    pub port: bool,
    pub protocol: bool,
    pub putty_session: bool,
    pub ssh_options: bool,
    pub rdp_authentication_level: bool,
    pub rdp_minutes_to_idle_timeout: bool,
    pub rdp_alert_idle_timeout: bool,
    pub load_balance_info: bool,
    pub redirect_disk_drives: bool,
    pub redirect_disk_drives_custom: bool,
    pub redirect_keys: bool,
    pub redirect_printers: bool,
    pub redirect_clipboard: bool,
    pub redirect_ports: bool,
    pub redirect_smart_cards: bool,
    pub redirect_sound: bool,
    pub sound_quality: bool,
    pub redirect_audio_capture: bool,
    pub rendering_engine: bool,
    pub resolution: bool,
    pub automatic_resize: bool,
    pub use_console_session: bool,
    pub use_cred_ssp: bool,
    pub use_restricted_admin: bool,
    pub use_rcg: bool,
    pub use_vm_id: bool,
    pub use_enhanced_mode: bool,
    pub username: bool,
    pub rdp_version: bool,
    pub vnc_auth_mode: bool,
    pub vnc_colors: bool,
    pub vnc_compression: bool,
    pub vnc_encoding: bool,
    pub vnc_proxy_ip: bool,
    pub vnc_proxy_password: bool,
    pub vnc_proxy_port: bool,
    pub vnc_proxy_type: bool,
    pub vnc_proxy_username: bool,
    pub vnc_smart_size_mode: bool,
    pub vnc_view_only: bool,
    pub rd_gateway_usage_method: bool,
    pub rd_gateway_hostname: bool,
    pub rd_gateway_use_connection_credentials: bool,
    pub rd_gateway_username: bool,
    pub rd_gateway_password: bool,
    pub rd_gateway_domain: bool,
    pub rd_gateway_external_credential_provider: bool,
    pub rd_gateway_user_via_api: bool,
    pub external_credential_provider: bool,
    pub user_via_api: bool,
    pub external_address_provider: bool,
    pub user_field: bool,
    pub environment_tags: bool,
    pub favorite: bool,
    pub pre_ext_app: bool,
    pub post_ext_app: bool,
    pub mac_address: bool,
    pub ssh_tunnel_connection_name: bool,
    pub opening_command: bool,
    pub rdp_start_program: bool,
    pub rdp_start_program_work_dir: bool,
    pub vm_id: bool,
}

// ─── Connection File ────────────────────────────────────────────────

/// Represents a full mRemoteNG connection file (confCons.xml root).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrngConnectionFile {
    pub name: String,
    pub conf_version: String,
    pub encryption: MrngEncryptionConfig,
    pub protected: String,
    pub root: MrngConnectionInfo,
}

impl Default for MrngConnectionFile {
    fn default() -> Self {
        Self {
            name: "Connections".into(),
            conf_version: "2.7".into(),
            encryption: MrngEncryptionConfig::default(),
            protected: String::new(),
            root: MrngConnectionInfo {
                name: "Connections".into(),
                node_type: MrngNodeType::Root,
                ..Default::default()
            },
        }
    }
}

// ─── Import/Export Config ───────────────────────────────────────────

/// Configuration for import operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrngImportConfig {
    pub password: Option<String>,
    pub target_folder_id: Option<String>,
    pub merge_duplicates: bool,
    pub overwrite_existing: bool,
}

impl Default for MrngImportConfig {
    fn default() -> Self {
        Self {
            password: None,
            target_folder_id: None,
            merge_duplicates: false,
            overwrite_existing: false,
        }
    }
}

/// Configuration for export operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrngExportConfig {
    pub password: Option<String>,
    pub encrypt_passwords: bool,
    pub include_inheritance: bool,
    pub conf_version: String,
    pub kdf_iterations: u32,
}

impl Default for MrngExportConfig {
    fn default() -> Self {
        Self {
            password: None,
            encrypt_passwords: true,
            include_inheritance: true,
            conf_version: "2.7".into(),
            kdf_iterations: 1000,
        }
    }
}

// ─── Import result ──────────────────────────────────────────────────

/// Result of an import operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrngImportResult {
    pub total: usize,
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
    pub connections: Vec<MrngConnectionInfo>,
}

/// Result of an export operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrngExportResult {
    pub total: usize,
    pub exported: usize,
    pub format: String,
    pub path: Option<String>,
    pub content: Option<String>,
}

// ─── RDP File Settings ──────────────────────────────────────────────

/// Parsed .rdp file key-value settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RdpFileSettings {
    pub full_address: String,
    pub server_port: Option<u16>,
    pub username: String,
    pub domain: String,
    pub screen_mode_id: u32,
    pub desktopwidth: u32,
    pub desktopheight: u32,
    pub session_bpp: u32,
    pub use_multimon: bool,
    pub audiomode: u32,
    pub audiocapturemode: u32,
    pub redirectclipboard: bool,
    pub redirectprinters: bool,
    pub redirectcomports: bool,
    pub redirectsmartcards: bool,
    pub redirectdrives: bool,
    pub alternate_shell: String,
    pub shell_working_directory: String,
    pub gatewayusagemethod: u32,
    pub gatewayhostname: String,
    pub gatewaycredentialssource: u32,
    pub gatewayprofileusagemethod: u32,
    pub authentication_level: u32,
    pub enablecredsspsupport: bool,
    pub disable_wallpaper: bool,
    pub disable_themes: bool,
    pub disable_menu_anims: bool,
    pub disable_full_window_drag: bool,
    pub disable_cursor_setting: bool,
    pub allow_font_smoothing: bool,
    pub allow_desktop_composition: bool,
    pub connection_type: u32,
    pub networkautodetect: bool,
    pub bandwidthautodetect: bool,
    pub extra: std::collections::HashMap<String, String>,
}

// ─── PuTTY Session ──────────────────────────────────────────────────

/// Parsed PuTTY session from Windows registry.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PuttySession {
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub protocol: String,
    pub username: String,
    pub proxy_host: String,
    pub proxy_port: u16,
    pub proxy_type: u32,
    pub proxy_username: String,
    pub private_key_file: String,
    pub terminal_type: String,
    pub serial_line: String,
    pub serial_speed: u32,
}

// ─── Supported Import Formats ───────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImportFormat {
    MremotengXml,
    MremotengCsv,
    RdpFile,
    PuttySessions,
}

impl ImportFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MremotengXml => "mRemoteNG XML (confCons.xml)",
            Self::MremotengCsv => "mRemoteNG CSV",
            Self::RdpFile => "RDP File (.rdp)",
            Self::PuttySessions => "PuTTY Sessions (Registry)",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExportFormat {
    MremotengXml,
    MremotengCsv,
}

impl ExportFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MremotengXml => "mRemoteNG XML (confCons.xml)",
            Self::MremotengCsv => "mRemoteNG CSV",
        }
    }
}
