//! CSV export for mRemoteNG flat-table format.
//!
//! Writes connections as a flat CSV with semicolon delimiter,
//! matching the mRemoteNG native CSV format.

use super::encryption;
use super::error::{MremotengError, MremotengResult};
use super::types::*;

/// CSV column headers matching mRemoteNG export format.
const CSV_HEADERS: &[&str] = &[
    "Name", "Id", "Type", "Description", "Icon", "Panel",
    "Hostname", "Port", "Protocol", "Username", "Password", "Domain",
    "PuttySession", "SSHOptions", "ExtApp", "UseConsoleSession",
    "RDPAuthenticationLevel", "LoadBalanceInfo", "RenderingEngine",
    "UseCredSsp", "UseRestrictedAdmin", "UseRCG",
    "RDGatewayUsageMethod", "RDGatewayHostname",
    "RDGatewayUseConnectionCredentials", "RDGatewayUsername", "RDGatewayDomain",
    "Resolution", "AutomaticResize", "Colors", "CacheBitmaps",
    "DisplayWallpaper", "DisplayThemes", "EnableFontSmoothing",
    "EnableDesktopComposition", "DisableFullWindowDrag",
    "DisableMenuAnimations", "DisableCursorShadow", "DisableCursorBlinking",
    "RedirectKeys", "RedirectDiskDrives", "RedirectDiskDrivesCustom",
    "RedirectPrinters", "RedirectClipboard", "RedirectPorts",
    "RedirectSmartCards", "RedirectSound", "SoundQuality", "RedirectAudioCapture",
    "RDPStartProgram", "RDPStartProgramWorkDir",
    "VNCCompression", "VNCEncoding", "VNCAuthMode",
    "VNCProxyType", "VNCProxyIP", "VNCProxyPort",
    "VNCProxyUsername", "VNCColors", "VNCSmartSizeMode", "VNCViewOnly",
    "PreExtApp", "PostExtApp", "MacAddress", "UserField",
    "EnvironmentTags", "Favorite",
    "Color", "TabColor", "OpeningCommand", "SSHTunnelConnectionName",
];

/// Write connections to a CSV string.
pub fn write_csv(
    connections: &[MrngConnectionInfo],
    master_password: &str,
    kdf_iterations: u32,
    encrypt_passwords: bool,
) -> MremotengResult<String> {
    let mut buf = Vec::new();
    {
        let mut wtr = csv::WriterBuilder::new()
            .delimiter(b';')
            .from_writer(&mut buf);

        // Write header
        wtr.write_record(CSV_HEADERS)
            .map_err(|e| MremotengError::Serialization(e.to_string()))?;

        // Flatten tree and write rows
        let flat = flatten_tree(connections);
        for node in &flat {
            let password = if encrypt_passwords {
                encryption::encrypt_password(&node.password, master_password, kdf_iterations)
                    .unwrap_or_default()
            } else {
                node.password.clone()
            };

            let row: Vec<String> = vec![
                node.name.clone(),
                node.constant_id.clone(),
                node.node_type.as_str().to_string(),
                node.description.clone(),
                node.icon.clone(),
                node.panel.clone(),
                node.hostname.clone(),
                node.port.to_string(),
                node.protocol.as_str().to_string(),
                node.username.clone(),
                password,
                node.domain.clone(),
                node.putty_session.clone(),
                node.ssh_options.clone(),
                node.ext_app.clone(),
                bool_str(node.use_console_session).to_string(),
                u32_str(node.rdp_authentication_level as u32),
                node.load_balance_info.clone(),
                u32_str(node.rendering_engine as u32),
                bool_str(node.use_cred_ssp).to_string(),
                bool_str(node.use_restricted_admin).to_string(),
                bool_str(node.use_rcg).to_string(),
                u32_str(node.rd_gateway_usage_method as u32),
                node.rd_gateway_hostname.clone(),
                u32_str(node.rd_gateway_use_connection_credentials as u32),
                node.rd_gateway_username.clone(),
                node.rd_gateway_domain.clone(),
                u32_str(node.resolution as u32),
                bool_str(node.automatic_resize).to_string(),
                u32_str(node.colors as u32),
                bool_str(node.cache_bitmaps).to_string(),
                bool_str(node.display_wallpaper).to_string(),
                bool_str(node.display_themes).to_string(),
                bool_str(node.enable_font_smoothing).to_string(),
                bool_str(node.enable_desktop_composition).to_string(),
                bool_str(node.disable_full_window_drag).to_string(),
                bool_str(node.disable_menu_animations).to_string(),
                bool_str(node.disable_cursor_shadow).to_string(),
                bool_str(node.disable_cursor_blinking).to_string(),
                bool_str(node.redirect_keys).to_string(),
                u32_str(node.redirect_disk_drives as u32),
                node.redirect_disk_drives_custom.clone(),
                bool_str(node.redirect_printers).to_string(),
                bool_str(node.redirect_clipboard).to_string(),
                bool_str(node.redirect_ports).to_string(),
                bool_str(node.redirect_smart_cards).to_string(),
                u32_str(node.redirect_sound as u32),
                u32_str(node.sound_quality as u32),
                bool_str(node.redirect_audio_capture).to_string(),
                node.rdp_start_program.clone(),
                node.rdp_start_program_work_dir.clone(),
                u32_str(node.vnc_compression as u32),
                u32_str(node.vnc_encoding as u32),
                u32_str(node.vnc_auth_mode as u32),
                u32_str(node.vnc_proxy_type as u32),
                node.vnc_proxy_ip.clone(),
                node.vnc_proxy_port.to_string(),
                node.vnc_proxy_username.clone(),
                u32_str(node.vnc_colors as u32),
                u32_str(node.vnc_smart_size_mode as u32),
                bool_str(node.vnc_view_only).to_string(),
                node.pre_ext_app.clone(),
                node.post_ext_app.clone(),
                node.mac_address.clone(),
                node.user_field.clone(),
                node.environment_tags.clone(),
                bool_str(node.favorite).to_string(),
                node.color.clone(),
                node.tab_color.clone(),
                node.opening_command.clone(),
                node.ssh_tunnel_connection_name.clone(),
            ];

            wtr.write_record(&row)
                .map_err(|e| MremotengError::Serialization(e.to_string()))?;
        }

        wtr.flush().map_err(|e| MremotengError::Serialization(e.to_string()))?;
    }

    String::from_utf8(buf).map_err(|e| MremotengError::Serialization(e.to_string()))
}

/// Flatten a tree of connections into a flat list (depth-first).
fn flatten_tree(nodes: &[MrngConnectionInfo]) -> Vec<&MrngConnectionInfo> {
    let mut flat = Vec::new();
    for node in nodes {
        flat.push(node);
        if !node.children.is_empty() {
            flat.extend(flatten_tree(&node.children));
        }
    }
    flat
}

fn bool_str(val: bool) -> &'static str {
    if val { "True" } else { "False" }
}

fn u32_str(val: u32) -> String {
    val.to_string()
}
