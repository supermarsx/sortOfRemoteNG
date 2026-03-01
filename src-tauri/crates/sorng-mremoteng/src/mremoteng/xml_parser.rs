//! XML parser for mRemoteNG confCons.xml format.
//!
//! Reads the hierarchical connection tree from XML, handling:
//! - Root `<Connections>` element with metadata (version, encryption config)
//! - `<Node>` elements for connections and containers
//! - Nested `<Node>` elements for tree structure
//! - Per-property inheritance flags
//! - Encrypted password fields

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::str;

use super::encryption;
use super::error::{MremotengError, MremotengResult};
use super::types::*;

/// Parse a confCons.xml file from a string.
pub fn parse_xml(xml_content: &str, master_password: &str) -> MremotengResult<MrngConnectionFile> {
    let mut reader = Reader::from_str(xml_content);
    reader.config_mut().trim_text(true);

    let mut file = MrngConnectionFile::default();
    let mut stack: Vec<MrngConnectionInfo> = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let name_bytes = e.name();
                let tag_name = str::from_utf8(name_bytes.as_ref())
                    .map_err(|_| MremotengError::XmlParse("Invalid UTF-8 in tag name".into()))?;

                match tag_name {
                    "Connections" => {
                        parse_connections_element(e, &mut file)?;
                    }
                    "Node" => {
                        let node = parse_node_element(e, master_password, file.encryption.kdf_iterations)?;
                        stack.push(node);
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                let name_bytes = e.name();
                let tag_name = str::from_utf8(name_bytes.as_ref())
                    .map_err(|_| MremotengError::XmlParse("Invalid UTF-8 in tag name".into()))?;

                if tag_name == "Node" {
                    let node = parse_node_element(e, master_password, file.encryption.kdf_iterations)?;
                    // Self-closing node — add to current parent or root
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(node);
                    } else {
                        file.root.children.push(node);
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let name_bytes = e.name();
                let tag_name = str::from_utf8(name_bytes.as_ref())
                    .map_err(|_| MremotengError::XmlParse("Invalid UTF-8 in tag name".into()))?;

                if tag_name == "Node" {
                    if let Some(node) = stack.pop() {
                        if let Some(parent) = stack.last_mut() {
                            parent.children.push(node);
                        } else {
                            // Top-level node under root
                            file.root.children.push(node);
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(MremotengError::XmlParse(format!("XML error at position {}: {}", reader.buffer_position(), e))),
            _ => {}
        }
    }

    Ok(file)
}

/// Parse `<Connections>` root element attributes.
fn parse_connections_element(e: &BytesStart, file: &mut MrngConnectionFile) -> MremotengResult<()> {
    for attr in e.attributes() {
        let attr = attr?;
        let key = str::from_utf8(attr.key.as_ref()).unwrap_or("");
        let val = attr.unescape_value()
            .map_err(|e| MremotengError::XmlParse(e.to_string()))?;

        match key {
            "Name" => file.name = val.to_string(),
            "ConfVersion" => file.conf_version = val.to_string(),
            "Protected" => file.protected = val.to_string(),
            "FullFileEncryption" => {
                file.encryption.full_file_encryption = parse_bool(&val);
            }
            "BlockCipherMode" => {
                file.encryption.mode = match val.as_ref() {
                    "GCM" => BlockCipherMode::GCM,
                    "CCM" => BlockCipherMode::CCM,
                    "EAX" => BlockCipherMode::EAX,
                    _ => BlockCipherMode::GCM,
                };
            }
            "KdfIterations" => {
                file.encryption.kdf_iterations = val.parse().unwrap_or(1000);
            }
            "EncryptionEngine" => {
                file.encryption.engine = match val.as_ref() {
                    "AES" => BlockCipherEngine::AES,
                    "Serpent" => BlockCipherEngine::Serpent,
                    "Twofish" => BlockCipherEngine::Twofish,
                    _ => BlockCipherEngine::AES,
                };
            }
            _ => {}
        }
    }
    Ok(())
}

/// Parse a `<Node>` element into `MrngConnectionInfo`.
fn parse_node_element(
    e: &BytesStart,
    master_password: &str,
    kdf_iterations: u32,
) -> MremotengResult<MrngConnectionInfo> {
    let mut node = MrngConnectionInfo::default();

    for attr in e.attributes() {
        let attr = attr?;
        let key = str::from_utf8(attr.key.as_ref()).unwrap_or("");
        let val = attr.unescape_value()
            .map_err(|e| MremotengError::XmlParse(e.to_string()))?;
        let val = val.as_ref();

        match key {
            // ── Identity ─────────────────────────────────────────
            "Name" => node.name = val.to_string(),
            "Type" => node.node_type = MrngNodeType::from_str_loose(val),
            "Id" | "ConstantID" => node.constant_id = val.to_string(),

            // ── Display ──────────────────────────────────────────
            "Descr" | "Description" => node.description = val.to_string(),
            "Icon" => node.icon = val.to_string(),
            "Panel" => node.panel = val.to_string(),
            "Color" => node.color = val.to_string(),
            "TabColor" => node.tab_color = val.to_string(),
            "ConnectionFrameColor" => {
                node.connection_frame_color = parse_enum_u32::<ConnectionFrameColor>(val);
            }

            // ── Connection ───────────────────────────────────────
            "Hostname" => node.hostname = val.to_string(),
            "Port" => node.port = val.parse().unwrap_or(0),
            "Protocol" => node.protocol = MrngProtocol::from_str_loose(val),
            "RdpVersion" | "RDPVersion" => {
                node.rdp_version = parse_enum_u32::<RdpVersion>(val);
            }
            "ExtApp" => node.ext_app = val.to_string(),
            "PuttySession" => node.putty_session = val.to_string(),
            "SSHOptions" => node.ssh_options = val.to_string(),
            "SSHTunnelConnectionName" => node.ssh_tunnel_connection_name = val.to_string(),
            "OpeningCommand" => node.opening_command = val.to_string(),

            // ── Credentials ──────────────────────────────────────
            "Username" => node.username = val.to_string(),
            "Password" => {
                node.password = encryption::decrypt_password(val, master_password, kdf_iterations);
            }
            "Domain" => node.domain = val.to_string(),
            "ExternalCredentialProvider" => {
                node.external_credential_provider = parse_enum_u32::<ExternalCredentialProvider>(val);
            }
            "UserViaAPI" => node.user_via_api = val.to_string(),
            "VaultOpenbaoMount" => node.vault_openbao_mount = val.to_string(),
            "VaultOpenbaoRole" => node.vault_openbao_role = val.to_string(),

            // ── External Address ─────────────────────────────────
            "ExternalAddressProvider" => {
                node.external_address_provider = parse_enum_u32::<ExternalAddressProvider>(val);
            }
            "EC2InstanceId" => node.ec2_instance_id = val.to_string(),
            "EC2Region" => node.ec2_region = val.to_string(),

            // ── Hyper-V ──────────────────────────────────────────
            "VmId" => node.vm_id = val.to_string(),
            "UseVmId" => node.use_vm_id = parse_bool(val),
            "UseEnhancedMode" => node.use_enhanced_mode = parse_bool(val),

            // ── RDP Protocol ─────────────────────────────────────
            "UseConsoleSession" => node.use_console_session = parse_bool(val),
            "RDPAuthenticationLevel" => {
                node.rdp_authentication_level = parse_enum_u32::<AuthenticationLevel>(val);
            }
            "RDPMinutesToIdleTimeout" => node.rdp_minutes_to_idle_timeout = val.parse().unwrap_or(0),
            "RDPAlertIdleTimeout" => node.rdp_alert_idle_timeout = parse_bool(val),
            "LoadBalanceInfo" => node.load_balance_info = val.to_string(),
            "RenderingEngine" => {
                node.rendering_engine = parse_enum_u32::<RenderingEngine>(val);
            }
            "UseCredSsp" => node.use_cred_ssp = parse_bool(val),
            "UseRestrictedAdmin" => node.use_restricted_admin = parse_bool(val),
            "UseRCG" => node.use_rcg = parse_bool(val),

            // ── RD Gateway ───────────────────────────────────────
            "RDGatewayUsageMethod" => {
                node.rd_gateway_usage_method = parse_enum_u32::<RDGatewayUsageMethod>(val);
            }
            "RDGatewayHostname" => node.rd_gateway_hostname = val.to_string(),
            "RDGatewayUseConnectionCredentials" => {
                node.rd_gateway_use_connection_credentials = parse_enum_u32::<RDGatewayUseConnectionCredentials>(val);
            }
            "RDGatewayUsername" => node.rd_gateway_username = val.to_string(),
            "RDGatewayPassword" => {
                node.rd_gateway_password = encryption::decrypt_password(val, master_password, kdf_iterations);
            }
            "RDGatewayDomain" => node.rd_gateway_domain = val.to_string(),
            "RDGatewayAccessToken" => node.rd_gateway_access_token = val.to_string(),
            "RDGatewayExternalCredentialProvider" => {
                node.rd_gateway_external_credential_provider = parse_enum_u32::<ExternalCredentialProvider>(val);
            }
            "RDGatewayUserViaAPI" => node.rd_gateway_user_via_api = val.to_string(),

            // ── Appearance ───────────────────────────────────────
            "Resolution" => node.resolution = parse_enum_u32::<RDPResolutions>(val),
            "AutomaticResize" => node.automatic_resize = parse_bool(val),
            "Colors" => node.colors = parse_enum_u32::<RDPColors>(val),
            "CacheBitmaps" => node.cache_bitmaps = parse_bool(val),
            "DisplayWallpaper" => node.display_wallpaper = parse_bool(val),
            "DisplayThemes" => node.display_themes = parse_bool(val),
            "EnableFontSmoothing" => node.enable_font_smoothing = parse_bool(val),
            "EnableDesktopComposition" => node.enable_desktop_composition = parse_bool(val),
            "DisableFullWindowDrag" => node.disable_full_window_drag = parse_bool(val),
            "DisableMenuAnimations" => node.disable_menu_animations = parse_bool(val),
            "DisableCursorShadow" => node.disable_cursor_shadow = parse_bool(val),
            "DisableCursorBlinking" => node.disable_cursor_blinking = parse_bool(val),

            // ── Redirect ─────────────────────────────────────────
            "RedirectKeys" => node.redirect_keys = parse_bool(val),
            "RedirectDiskDrives" => node.redirect_disk_drives = parse_enum_u32::<RDPDiskDrives>(val),
            "RedirectDiskDrivesCustom" => node.redirect_disk_drives_custom = val.to_string(),
            "RedirectPrinters" => node.redirect_printers = parse_bool(val),
            "RedirectClipboard" => node.redirect_clipboard = parse_bool(val),
            "RedirectPorts" => node.redirect_ports = parse_bool(val),
            "RedirectSmartCards" => node.redirect_smart_cards = parse_bool(val),
            "RedirectSound" => node.redirect_sound = parse_enum_u32::<RDPSounds>(val),
            "SoundQuality" => node.sound_quality = parse_enum_u32::<RDPSoundQuality>(val),
            "RedirectAudioCapture" => node.redirect_audio_capture = parse_bool(val),

            // ── RDS ──────────────────────────────────────────────
            "RDPStartProgram" => node.rdp_start_program = val.to_string(),
            "RDPStartProgramWorkDir" => node.rdp_start_program_work_dir = val.to_string(),

            // ── VNC ──────────────────────────────────────────────
            "VNCCompression" => node.vnc_compression = parse_enum_u32::<VncCompression>(val),
            "VNCEncoding" => node.vnc_encoding = parse_enum_u32::<VncEncoding>(val),
            "VNCAuthMode" => node.vnc_auth_mode = parse_enum_u32::<VncAuthMode>(val),
            "VNCProxyType" => node.vnc_proxy_type = parse_enum_u32::<VncProxyType>(val),
            "VNCProxyIP" => node.vnc_proxy_ip = val.to_string(),
            "VNCProxyPort" => node.vnc_proxy_port = val.parse().unwrap_or(0),
            "VNCProxyUsername" => node.vnc_proxy_username = val.to_string(),
            "VNCProxyPassword" => {
                node.vnc_proxy_password = encryption::decrypt_password(val, master_password, kdf_iterations);
            }
            "VNCColors" => node.vnc_colors = parse_enum_u32::<VncColors>(val),
            "VNCSmartSizeMode" => node.vnc_smart_size_mode = parse_enum_u32::<VncSmartSizeMode>(val),
            "VNCViewOnly" => node.vnc_view_only = parse_bool(val),

            // ── Miscellaneous ────────────────────────────────────
            "PreExtApp" => node.pre_ext_app = val.to_string(),
            "PostExtApp" => node.post_ext_app = val.to_string(),
            "MacAddress" => node.mac_address = val.to_string(),
            "UserField" => node.user_field = val.to_string(),
            "EnvironmentTags" => node.environment_tags = val.to_string(),
            "Favorite" => node.favorite = parse_bool(val),

            // ── Inheritance ──────────────────────────────────────
            "InheritCacheBitmaps" => node.inheritance.cache_bitmaps = parse_bool(val),
            "InheritColors" => node.inheritance.colors = parse_bool(val),
            "InheritDescription" => node.inheritance.description = parse_bool(val),
            "InheritDisplayThemes" => node.inheritance.display_themes = parse_bool(val),
            "InheritDisplayWallpaper" => node.inheritance.display_wallpaper = parse_bool(val),
            "InheritEnableFontSmoothing" => node.inheritance.enable_font_smoothing = parse_bool(val),
            "InheritEnableDesktopComposition" => node.inheritance.enable_desktop_composition = parse_bool(val),
            "InheritDisableFullWindowDrag" => node.inheritance.disable_full_window_drag = parse_bool(val),
            "InheritDisableMenuAnimations" => node.inheritance.disable_menu_animations = parse_bool(val),
            "InheritDisableCursorShadow" => node.inheritance.disable_cursor_shadow = parse_bool(val),
            "InheritDisableCursorBlinking" => node.inheritance.disable_cursor_blinking = parse_bool(val),
            "InheritDomain" => node.inheritance.domain = parse_bool(val),
            "InheritExtApp" => node.inheritance.ext_app = parse_bool(val),
            "InheritIcon" => node.inheritance.icon = parse_bool(val),
            "InheritPanel" => node.inheritance.panel = parse_bool(val),
            "InheritPassword" => node.inheritance.password = parse_bool(val),
            "InheritPort" => node.inheritance.port = parse_bool(val),
            "InheritProtocol" => node.inheritance.protocol = parse_bool(val),
            "InheritPuttySession" => node.inheritance.putty_session = parse_bool(val),
            "InheritSSHOptions" => node.inheritance.ssh_options = parse_bool(val),
            "InheritRDPAuthenticationLevel" => node.inheritance.rdp_authentication_level = parse_bool(val),
            "InheritRDPMinutesToIdleTimeout" => node.inheritance.rdp_minutes_to_idle_timeout = parse_bool(val),
            "InheritRDPAlertIdleTimeout" => node.inheritance.rdp_alert_idle_timeout = parse_bool(val),
            "InheritLoadBalanceInfo" => node.inheritance.load_balance_info = parse_bool(val),
            "InheritRedirectDiskDrives" => node.inheritance.redirect_disk_drives = parse_bool(val),
            "InheritRedirectDiskDrivesCustom" => node.inheritance.redirect_disk_drives_custom = parse_bool(val),
            "InheritRedirectKeys" => node.inheritance.redirect_keys = parse_bool(val),
            "InheritRedirectPrinters" => node.inheritance.redirect_printers = parse_bool(val),
            "InheritRedirectClipboard" => node.inheritance.redirect_clipboard = parse_bool(val),
            "InheritRedirectPorts" => node.inheritance.redirect_ports = parse_bool(val),
            "InheritRedirectSmartCards" => node.inheritance.redirect_smart_cards = parse_bool(val),
            "InheritRedirectSound" => node.inheritance.redirect_sound = parse_bool(val),
            "InheritSoundQuality" => node.inheritance.sound_quality = parse_bool(val),
            "InheritRedirectAudioCapture" => node.inheritance.redirect_audio_capture = parse_bool(val),
            "InheritRenderingEngine" => node.inheritance.rendering_engine = parse_bool(val),
            "InheritResolution" => node.inheritance.resolution = parse_bool(val),
            "InheritAutomaticResize" => node.inheritance.automatic_resize = parse_bool(val),
            "InheritUseConsoleSession" => node.inheritance.use_console_session = parse_bool(val),
            "InheritUseCredSsp" => node.inheritance.use_cred_ssp = parse_bool(val),
            "InheritUseRestrictedAdmin" => node.inheritance.use_restricted_admin = parse_bool(val),
            "InheritUseRCG" => node.inheritance.use_rcg = parse_bool(val),
            "InheritUseVmId" => node.inheritance.use_vm_id = parse_bool(val),
            "InheritUseEnhancedMode" => node.inheritance.use_enhanced_mode = parse_bool(val),
            "InheritUsername" => node.inheritance.username = parse_bool(val),
            "InheritRdpVersion" | "InheritRDPVersion" => node.inheritance.rdp_version = parse_bool(val),
            "InheritVNCAuthMode" => node.inheritance.vnc_auth_mode = parse_bool(val),
            "InheritVNCColors" => node.inheritance.vnc_colors = parse_bool(val),
            "InheritVNCCompression" => node.inheritance.vnc_compression = parse_bool(val),
            "InheritVNCEncoding" => node.inheritance.vnc_encoding = parse_bool(val),
            "InheritVNCProxyIP" => node.inheritance.vnc_proxy_ip = parse_bool(val),
            "InheritVNCProxyPassword" => node.inheritance.vnc_proxy_password = parse_bool(val),
            "InheritVNCProxyPort" => node.inheritance.vnc_proxy_port = parse_bool(val),
            "InheritVNCProxyType" => node.inheritance.vnc_proxy_type = parse_bool(val),
            "InheritVNCProxyUsername" => node.inheritance.vnc_proxy_username = parse_bool(val),
            "InheritVNCSmartSizeMode" => node.inheritance.vnc_smart_size_mode = parse_bool(val),
            "InheritVNCViewOnly" => node.inheritance.vnc_view_only = parse_bool(val),
            "InheritRDGatewayUsageMethod" => node.inheritance.rd_gateway_usage_method = parse_bool(val),
            "InheritRDGatewayHostname" => node.inheritance.rd_gateway_hostname = parse_bool(val),
            "InheritRDGatewayUseConnectionCredentials" => node.inheritance.rd_gateway_use_connection_credentials = parse_bool(val),
            "InheritRDGatewayUsername" => node.inheritance.rd_gateway_username = parse_bool(val),
            "InheritRDGatewayPassword" => node.inheritance.rd_gateway_password = parse_bool(val),
            "InheritRDGatewayDomain" => node.inheritance.rd_gateway_domain = parse_bool(val),
            "InheritRDGatewayExternalCredentialProvider" => node.inheritance.rd_gateway_external_credential_provider = parse_bool(val),
            "InheritRDGatewayUserViaAPI" => node.inheritance.rd_gateway_user_via_api = parse_bool(val),
            "InheritExternalCredentialProvider" => node.inheritance.external_credential_provider = parse_bool(val),
            "InheritUserViaAPI" => node.inheritance.user_via_api = parse_bool(val),
            "InheritExternalAddressProvider" => node.inheritance.external_address_provider = parse_bool(val),
            "InheritUserField" => node.inheritance.user_field = parse_bool(val),
            "InheritEnvironmentTags" => node.inheritance.environment_tags = parse_bool(val),
            "InheritFavorite" => node.inheritance.favorite = parse_bool(val),
            "InheritPreExtApp" => node.inheritance.pre_ext_app = parse_bool(val),
            "InheritPostExtApp" => node.inheritance.post_ext_app = parse_bool(val),
            "InheritMacAddress" => node.inheritance.mac_address = parse_bool(val),
            "InheritSSHTunnelConnectionName" => node.inheritance.ssh_tunnel_connection_name = parse_bool(val),
            "InheritOpeningCommand" => node.inheritance.opening_command = parse_bool(val),
            "InheritRDPStartProgram" => node.inheritance.rdp_start_program = parse_bool(val),
            "InheritRDPStartProgramWorkDir" => node.inheritance.rdp_start_program_work_dir = parse_bool(val),
            "InheritVmId" => node.inheritance.vm_id = parse_bool(val),

            _ => { /* Ignore unknown attributes for forward compatibility */ }
        }
    }

    Ok(node)
}

// ─── Helpers ────────────────────────────────────────────────────────

fn parse_bool(val: &str) -> bool {
    matches!(val.to_lowercase().as_str(), "true" | "1" | "yes")
}

/// Parse a string that could be either a numeric value (enum discriminant)
/// or a name, into one of our Serde-serializable enums.
/// Falls back to Default if parsing fails.
fn parse_enum_u32<T: Default>(val: &str) -> T
where
    T: From<u32>,
{
    val.parse::<u32>()
        .map(T::from)
        .unwrap_or_default()
}

// Implement From<u32> for all our enums

impl From<u32> for ConnectionFrameColor {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::None,
            1 => Self::Red,
            2 => Self::Green,
            3 => Self::Blue,
            4 => Self::Yellow,
            5 => Self::Orange,
            6 => Self::Purple,
            _ => Self::None,
        }
    }
}

impl From<u32> for RdpVersion {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::Rdc6,
            1 => Self::Rdc7,
            2 => Self::Rdc8,
            3 => Self::Rdc10,
            _ => Self::Rdc10,
        }
    }
}

impl From<u32> for AuthenticationLevel {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::NoAuth,
            1 => Self::AuthRequired,
            2 => Self::WarnOnFailedAuth,
            _ => Self::NoAuth,
        }
    }
}

impl From<u32> for RDPResolutions {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::FitToWindow,
            1 => Self::Fullscreen,
            2 => Self::SmartSize,
            3 => Self::Res800x600,
            4 => Self::Res1024x768,
            5 => Self::Res1280x1024,
            6 => Self::Res1600x1200,
            _ => Self::FitToWindow,
        }
    }
}

impl From<u32> for RDPColors {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::Colors256,
            1 => Self::Colors15Bit,
            2 => Self::Colors16Bit,
            3 => Self::Colors24Bit,
            4 => Self::Colors32Bit,
            _ => Self::Colors32Bit,
        }
    }
}

impl From<u32> for RDPSounds {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::BringToThisComputer,
            1 => Self::LeaveAtRemoteComputer,
            2 => Self::DoNotPlay,
            _ => Self::BringToThisComputer,
        }
    }
}

impl From<u32> for RDPSoundQuality {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::Dynamic,
            1 => Self::Medium,
            2 => Self::High,
            _ => Self::Dynamic,
        }
    }
}

impl From<u32> for RDPDiskDrives {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::None,
            1 => Self::Local,
            2 => Self::Custom,
            3 => Self::All,
            _ => Self::None,
        }
    }
}

impl From<u32> for RDGatewayUsageMethod {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::Never,
            1 => Self::Always,
            2 => Self::Detect,
            _ => Self::Never,
        }
    }
}

impl From<u32> for RDGatewayUseConnectionCredentials {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::Yes,
            1 => Self::SmartCard,
            2 => Self::AskForCredentials,
            _ => Self::Yes,
        }
    }
}

impl From<u32> for RenderingEngine {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::IE,
            1 => Self::Gecko,
            2 => Self::Webkit,
            3 => Self::EdgeChromium,
            _ => Self::IE,
        }
    }
}

impl From<u32> for ExternalAddressProvider {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::None,
            1 => Self::AmazonEC2,
            _ => Self::None,
        }
    }
}

impl From<u32> for ExternalCredentialProvider {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::None,
            1 => Self::CyberArkPSM,
            2 => Self::VaultOpenbao,
            _ => Self::None,
        }
    }
}

impl From<u32> for VncCompression {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::CompNone,
            1 => Self::Comp0,
            2 => Self::Comp1,
            3 => Self::Comp2,
            4 => Self::Comp3,
            5 => Self::Comp4,
            6 => Self::Comp5,
            7 => Self::Comp6,
            8 => Self::Comp7,
            9 => Self::Comp8,
            10 => Self::Comp9,
            _ => Self::CompNone,
        }
    }
}

impl From<u32> for VncEncoding {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::EncRaw,
            1 => Self::EncRRE,
            2 => Self::EncCoRRE,
            3 => Self::EncHextile,
            4 => Self::EncZlib,
            5 => Self::EncTight,
            6 => Self::EncZRLE,
            7 => Self::EncZYWRLE,
            8 => Self::EncUltra,
            9 => Self::EncUltra2,
            _ => Self::EncTight,
        }
    }
}

impl From<u32> for VncAuthMode {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::AuthVNC,
            1 => Self::AuthWin,
            _ => Self::AuthVNC,
        }
    }
}

impl From<u32> for VncProxyType {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::ProxyNone,
            1 => Self::ProxySocks5,
            2 => Self::ProxyHTTP,
            3 => Self::ProxyUltra,
            _ => Self::ProxyNone,
        }
    }
}

impl From<u32> for VncColors {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::ColNormal,
            1 => Self::Col8Bit,
            2 => Self::Col16Bit,
            3 => Self::Col256,
            4 => Self::Col64,
            5 => Self::Col8,
            6 => Self::Col3,
            7 => Self::Col2,
            _ => Self::ColNormal,
        }
    }
}

impl From<u32> for VncSmartSizeMode {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::SmartSizeDisabled,
            1 => Self::SmartSizeFree,
            2 => Self::SmartSizeAspect,
            _ => Self::SmartSizeDisabled,
        }
    }
}

impl From<u32> for MrngProtocol {
    fn from(v: u32) -> Self {
        match v {
            0 => Self::RDP,
            1 => Self::VNC,
            2 => Self::SSH1,
            3 => Self::SSH2,
            4 => Self::Telnet,
            5 => Self::Rlogin,
            6 => Self::RAW,
            7 => Self::HTTP,
            8 => Self::HTTPS,
            10 => Self::PowerShell,
            11 => Self::Winbox,
            20 => Self::IntApp,
            _ => Self::RDP,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_minimal_xml() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections" Export="false" EncryptionEngine="AES" BlockCipherMode="GCM"
 KdfIterations="1000" FullFileEncryption="false" Protected="" ConfVersion="2.7">
    <Node Name="MyServer" Type="Connection" Descr="" Icon="mRemoteNG" Panel="General"
     Id="abc-123" Username="admin" Hostname="192.168.1.1" Protocol="RDP" Port="3389"
     Password="" Domain="" />
</Connections>"#;

        let file = parse_xml(xml, "").unwrap();
        assert_eq!(file.name, "Connections");
        assert_eq!(file.conf_version, "2.7");
        assert_eq!(file.root.children.len(), 1);

        let node = &file.root.children[0];
        assert_eq!(node.name, "MyServer");
        assert_eq!(node.hostname, "192.168.1.1");
        assert_eq!(node.port, 3389);
        assert_eq!(node.username, "admin");
        assert!(matches!(node.protocol, MrngProtocol::RDP));
        assert!(matches!(node.node_type, MrngNodeType::Connection));
    }

    #[test]
    fn test_parse_nested_containers() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections" ConfVersion="2.7" EncryptionEngine="AES"
 BlockCipherMode="GCM" KdfIterations="1000" FullFileEncryption="false" Protected="">
    <Node Name="Production" Type="Container" Id="folder-1">
        <Node Name="WebServer" Type="Connection" Hostname="10.0.0.1" Protocol="SSH2" Port="22" Id="conn-1" />
        <Node Name="Database" Type="Connection" Hostname="10.0.0.2" Protocol="SSH2" Port="22" Id="conn-2" />
    </Node>
    <Node Name="Staging" Type="Container" Id="folder-2">
        <Node Name="App" Type="Connection" Hostname="10.0.1.1" Protocol="RDP" Port="3389" Id="conn-3" />
    </Node>
</Connections>"#;

        let file = parse_xml(xml, "").unwrap();
        assert_eq!(file.root.children.len(), 2);

        let prod = &file.root.children[0];
        assert_eq!(prod.name, "Production");
        assert!(matches!(prod.node_type, MrngNodeType::Container));
        assert_eq!(prod.children.len(), 2);

        let staging = &file.root.children[1];
        assert_eq!(staging.name, "Staging");
        assert_eq!(staging.children.len(), 1);
        assert_eq!(staging.children[0].hostname, "10.0.1.1");
    }

    #[test]
    fn test_parse_all_protocols() {
        for (val, expected) in &[
            ("RDP", MrngProtocol::RDP),
            ("VNC", MrngProtocol::VNC),
            ("SSH1", MrngProtocol::SSH1),
            ("SSH2", MrngProtocol::SSH2),
            ("Telnet", MrngProtocol::Telnet),
            ("Rlogin", MrngProtocol::Rlogin),
            ("RAW", MrngProtocol::RAW),
            ("HTTP", MrngProtocol::HTTP),
            ("HTTPS", MrngProtocol::HTTPS),
            ("PowerShell", MrngProtocol::PowerShell),
            ("Winbox", MrngProtocol::Winbox),
            ("IntApp", MrngProtocol::IntApp),
        ] {
            assert_eq!(MrngProtocol::from_str_loose(val), *expected);
        }
    }
}
