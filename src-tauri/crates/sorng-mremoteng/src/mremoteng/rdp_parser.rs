//! .rdp file parser — Microsoft Remote Desktop Connection format.
//!
//! Parses plain-text .rdp files (key:type:value lines) and maps them
//! to `MrngConnectionInfo`.

use super::error::MremotengResult;
use super::types::*;

/// Parse a .rdp file string into `RdpFileSettings`.
pub fn parse_rdp_file(content: &str) -> MremotengResult<RdpFileSettings> {
    let mut settings = RdpFileSettings::default();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('/') {
            continue;
        }

        // Format: key:type:value
        // type: s = string, i = integer, b = binary
        let parts: Vec<&str> = line.splitn(3, ':').collect();
        if parts.len() < 3 {
            continue;
        }

        let key = parts[0].trim().to_lowercase();
        let val = parts[2].trim();

        match key.as_str() {
            "full address" => settings.full_address = val.to_string(),
            "server port" => settings.server_port = val.parse().ok(),
            "username" => settings.username = val.to_string(),
            "domain" => settings.domain = val.to_string(),
            "screen mode id" => settings.screen_mode_id = val.parse().unwrap_or(0),
            "desktopwidth" => settings.desktopwidth = val.parse().unwrap_or(0),
            "desktopheight" => settings.desktopheight = val.parse().unwrap_or(0),
            "session bpp" => settings.session_bpp = val.parse().unwrap_or(32),
            "use multimon" => settings.use_multimon = val == "1",
            "audiomode" => settings.audiomode = val.parse().unwrap_or(0),
            "audiocapturemode" => settings.audiocapturemode = val.parse().unwrap_or(0),
            "redirectclipboard" => settings.redirectclipboard = val == "1",
            "redirectprinters" => settings.redirectprinters = val == "1",
            "redirectcomports" => settings.redirectcomports = val == "1",
            "redirectsmartcards" => settings.redirectsmartcards = val == "1",
            "drivestoredirect" => settings.redirectdrives = !val.is_empty() && val != "",
            "alternate shell" => settings.alternate_shell = val.to_string(),
            "shell working directory" => settings.shell_working_directory = val.to_string(),
            "gatewayusagemethod" => settings.gatewayusagemethod = val.parse().unwrap_or(0),
            "gatewayhostname" => settings.gatewayhostname = val.to_string(),
            "gatewaycredentialssource" => settings.gatewaycredentialssource = val.parse().unwrap_or(0),
            "gatewayprofileusagemethod" => settings.gatewayprofileusagemethod = val.parse().unwrap_or(0),
            "authentication level" => settings.authentication_level = val.parse().unwrap_or(0),
            "enablecredsspsupport" => settings.enablecredsspsupport = val == "1",
            "disable wallpaper" => settings.disable_wallpaper = val == "1",
            "disable themes" => settings.disable_themes = val == "1",
            "disable menu anims" => settings.disable_menu_anims = val == "1",
            "disable full window drag" => settings.disable_full_window_drag = val == "1",
            "disable cursor setting" => settings.disable_cursor_setting = val == "1",
            "allow font smoothing" => settings.allow_font_smoothing = val == "1",
            "allow desktop composition" => settings.allow_desktop_composition = val == "1",
            "connection type" => settings.connection_type = val.parse().unwrap_or(0),
            "networkautodetect" => settings.networkautodetect = val == "1",
            "bandwidthautodetect" => settings.bandwidthautodetect = val == "1",
            _ => {
                settings.extra.insert(key, val.to_string());
            }
        }
    }

    // Parse host:port from full_address
    if settings.server_port.is_none() && settings.full_address.contains(':') {
        let parts: Vec<&str> = settings.full_address.splitn(2, ':').collect();
        if parts.len() == 2 {
            if let Ok(port) = parts[1].parse::<u16>() {
                settings.server_port = Some(port);
                settings.full_address = parts[0].to_string();
            }
        }
    }

    Ok(settings)
}

/// Convert `RdpFileSettings` to an `MrngConnectionInfo`.
pub fn rdp_settings_to_connection(settings: &RdpFileSettings) -> MrngConnectionInfo {
    let mut conn = MrngConnectionInfo {
        protocol: MrngProtocol::RDP,
        hostname: settings.full_address.clone(),
        port: settings.server_port.unwrap_or(3389),
        username: settings.username.clone(),
        domain: settings.domain.clone(),
        use_cred_ssp: settings.enablecredsspsupport,
        ..Default::default()
    };

    // Name = hostname if no name set
    if conn.hostname.is_empty() {
        conn.name = "Imported RDP".into();
    } else {
        conn.name = conn.hostname.clone();
    }

    // Display settings
    conn.resolution = match (settings.desktopwidth, settings.desktopheight) {
        (0, 0) | (0, _) | (_, 0) => RDPResolutions::FitToWindow,
        (800, 600) => RDPResolutions::Res800x600,
        (1024, 768) => RDPResolutions::Res1024x768,
        (1280, 1024) => RDPResolutions::Res1280x1024,
        (1600, 1200) => RDPResolutions::Res1600x1200,
        _ => {
            if settings.screen_mode_id == 2 {
                RDPResolutions::Fullscreen
            } else {
                RDPResolutions::FitToWindow
            }
        }
    };

    conn.colors = match settings.session_bpp {
        8 => RDPColors::Colors256,
        15 => RDPColors::Colors15Bit,
        16 => RDPColors::Colors16Bit,
        24 => RDPColors::Colors24Bit,
        32 | _ => RDPColors::Colors32Bit,
    };

    // Sound
    conn.redirect_sound = match settings.audiomode {
        0 => RDPSounds::BringToThisComputer,
        1 => RDPSounds::LeaveAtRemoteComputer,
        _ => RDPSounds::DoNotPlay,
    };
    conn.redirect_audio_capture = settings.audiocapturemode == 1;

    // Authentication
    conn.rdp_authentication_level = match settings.authentication_level {
        0 => AuthenticationLevel::NoAuth,
        1 => AuthenticationLevel::AuthRequired,
        2 => AuthenticationLevel::WarnOnFailedAuth,
        _ => AuthenticationLevel::NoAuth,
    };

    // Redirections
    conn.redirect_clipboard = settings.redirectclipboard;
    conn.redirect_printers = settings.redirectprinters;
    conn.redirect_ports = settings.redirectcomports;
    conn.redirect_smart_cards = settings.redirectsmartcards;
    if settings.redirectdrives {
        conn.redirect_disk_drives = RDPDiskDrives::All;
    }

    // Performance
    conn.display_wallpaper = !settings.disable_wallpaper;
    conn.display_themes = !settings.disable_themes;
    conn.disable_menu_animations = settings.disable_menu_anims;
    conn.disable_full_window_drag = settings.disable_full_window_drag;
    conn.disable_cursor_shadow = settings.disable_cursor_setting;
    conn.enable_font_smoothing = settings.allow_font_smoothing;
    conn.enable_desktop_composition = settings.allow_desktop_composition;

    // Start program
    conn.rdp_start_program = settings.alternate_shell.clone();
    conn.rdp_start_program_work_dir = settings.shell_working_directory.clone();

    // Gateway
    conn.rd_gateway_usage_method = match settings.gatewayusagemethod {
        0 => RDGatewayUsageMethod::Never,
        1 => RDGatewayUsageMethod::Always,
        2 => RDGatewayUsageMethod::Detect,
        _ => RDGatewayUsageMethod::Never,
    };
    conn.rd_gateway_hostname = settings.gatewayhostname.clone();
    conn.rd_gateway_use_connection_credentials = match settings.gatewaycredentialssource {
        0 => RDGatewayUseConnectionCredentials::Yes,
        1 => RDGatewayUseConnectionCredentials::SmartCard,
        _ => RDGatewayUseConnectionCredentials::AskForCredentials,
    };

    conn
}

/// Convert an `MrngConnectionInfo` back to a `.rdp` file string.
pub fn connection_to_rdp_string(conn: &MrngConnectionInfo) -> String {
    let mut lines: Vec<String> = Vec::new();

    let addr = if conn.port != 0 && conn.port != 3389 {
        format!("{}:{}", conn.hostname, conn.port)
    } else {
        conn.hostname.clone()
    };
    lines.push(format!("full address:s:{}", addr));

    if !conn.username.is_empty() {
        lines.push(format!("username:s:{}", conn.username));
    }
    if !conn.domain.is_empty() {
        lines.push(format!("domain:s:{}", conn.domain));
    }

    // Display
    let (width, height) = match conn.resolution {
        RDPResolutions::Res800x600 => (800, 600),
        RDPResolutions::Res1024x768 => (1024, 768),
        RDPResolutions::Res1280x1024 => (1280, 1024),
        RDPResolutions::Res1600x1200 => (1600, 1200),
        _ => (0, 0),
    };
    if width > 0 {
        lines.push(format!("desktopwidth:i:{}", width));
        lines.push(format!("desktopheight:i:{}", height));
    }

    let screen_mode = match conn.resolution {
        RDPResolutions::Fullscreen => 2,
        _ => 1,
    };
    lines.push(format!("screen mode id:i:{}", screen_mode));

    let bpp = match conn.colors {
        RDPColors::Colors256 => 8,
        RDPColors::Colors15Bit => 15,
        RDPColors::Colors16Bit => 16,
        RDPColors::Colors24Bit => 24,
        RDPColors::Colors32Bit => 32,
    };
    lines.push(format!("session bpp:i:{}", bpp));

    // Audio
    let audiomode = match conn.redirect_sound {
        RDPSounds::BringToThisComputer => 0,
        RDPSounds::LeaveAtRemoteComputer => 1,
        RDPSounds::DoNotPlay => 2,
    };
    lines.push(format!("audiomode:i:{}", audiomode));
    lines.push(format!("audiocapturemode:i:{}", if conn.redirect_audio_capture { 1 } else { 0 }));

    // Redirections
    lines.push(format!("redirectclipboard:i:{}", if conn.redirect_clipboard { 1 } else { 0 }));
    lines.push(format!("redirectprinters:i:{}", if conn.redirect_printers { 1 } else { 0 }));
    lines.push(format!("redirectcomports:i:{}", if conn.redirect_ports { 1 } else { 0 }));
    lines.push(format!("redirectsmartcards:i:{}", if conn.redirect_smart_cards { 1 } else { 0 }));

    if conn.redirect_disk_drives != RDPDiskDrives::None {
        lines.push("drivestoredirect:s:*".to_string());
    }

    // Performance
    lines.push(format!("disable wallpaper:i:{}", if conn.display_wallpaper { 0 } else { 1 }));
    lines.push(format!("disable themes:i:{}", if conn.display_themes { 0 } else { 1 }));
    lines.push(format!("disable menu anims:i:{}", if conn.disable_menu_animations { 1 } else { 0 }));
    lines.push(format!("disable full window drag:i:{}", if conn.disable_full_window_drag { 1 } else { 0 }));
    lines.push(format!("disable cursor setting:i:{}", if conn.disable_cursor_shadow { 1 } else { 0 }));
    lines.push(format!("allow font smoothing:i:{}", if conn.enable_font_smoothing { 1 } else { 0 }));
    lines.push(format!("allow desktop composition:i:{}", if conn.enable_desktop_composition { 1 } else { 0 }));

    // Auth
    let auth_level = conn.rdp_authentication_level as u32;
    lines.push(format!("authentication level:i:{}", auth_level));
    lines.push(format!("enablecredsspsupport:i:{}", if conn.use_cred_ssp { 1 } else { 0 }));

    // Start program
    if !conn.rdp_start_program.is_empty() {
        lines.push(format!("alternate shell:s:{}", conn.rdp_start_program));
    }
    if !conn.rdp_start_program_work_dir.is_empty() {
        lines.push(format!("shell working directory:s:{}", conn.rdp_start_program_work_dir));
    }

    // Gateway
    lines.push(format!("gatewayusagemethod:i:{}", conn.rd_gateway_usage_method as u32));
    if !conn.rd_gateway_hostname.is_empty() {
        lines.push(format!("gatewayhostname:s:{}", conn.rd_gateway_hostname));
    }
    lines.push(format!("gatewaycredentialssource:i:{}", conn.rd_gateway_use_connection_credentials as u32));

    lines.join("\r\n")
}

/// Parse multiple .rdp files, returning a connection for each.
pub fn parse_rdp_files(files: &[(String, String)]) -> Vec<MremotengResult<MrngConnectionInfo>> {
    files
        .iter()
        .map(|(name, content)| {
            let settings = parse_rdp_file(content)?;
            let mut conn = rdp_settings_to_connection(&settings);
            // Use filename (without .rdp) as name if shorter
            let clean_name = name.trim_end_matches(".rdp").trim_end_matches(".RDP");
            if !clean_name.is_empty() {
                conn.name = clean_name.to_string();
            }
            Ok(conn)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rdp_file() {
        let content = r#"full address:s:server.example.com:3390
username:s:admin
domain:s:CORP
screen mode id:i:2
desktopwidth:i:1920
desktopheight:i:1080
session bpp:i:32
audiomode:i:0
redirectclipboard:i:1
redirectprinters:i:0
enablecredsspsupport:i:1
disable wallpaper:i:1
allow font smoothing:i:1
gatewayusagemethod:i:1
gatewayhostname:s:gw.example.com
"#;
        let settings = parse_rdp_file(content).unwrap();
        assert_eq!(settings.full_address, "server.example.com");
        assert_eq!(settings.server_port, Some(3390));
        assert_eq!(settings.username, "admin");
        assert_eq!(settings.domain, "CORP");
        assert!(settings.enablecredsspsupport);
        assert_eq!(settings.gatewayhostname, "gw.example.com");

        let conn = rdp_settings_to_connection(&settings);
        assert_eq!(conn.hostname, "server.example.com");
        assert_eq!(conn.port, 3390);
        assert_eq!(conn.protocol, MrngProtocol::RDP);
        assert!(conn.use_cred_ssp);
        assert!(conn.enable_font_smoothing);
        assert!(!conn.display_wallpaper);
    }

    #[test]
    fn test_roundtrip_rdp_string() {
        let mut conn = MrngConnectionInfo::default();
        conn.hostname = "10.0.0.1".into();
        conn.port = 3389;
        conn.username = "user".into();
        conn.redirect_clipboard = true;
        conn.enable_font_smoothing = true;

        let rdp_str = connection_to_rdp_string(&conn);
        assert!(rdp_str.contains("full address:s:10.0.0.1"));
        assert!(rdp_str.contains("username:s:user"));
        assert!(rdp_str.contains("redirectclipboard:i:1"));
        assert!(rdp_str.contains("allow font smoothing:i:1"));
    }
}
