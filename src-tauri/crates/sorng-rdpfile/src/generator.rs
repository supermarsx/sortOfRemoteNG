//! Full .rdp file generator.
//!
//! Produces valid Microsoft `.rdp` file content from an [`RdpFile`] struct.

use crate::types::{RdpFile, RdpValue};
use serde::{Deserialize, Serialize};

// ─── GenerateOptions ────────────────────────────────────────────────

/// Options controlling which sections of an RDP file to include.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateOptions {
    /// Whether to include username/domain fields.
    pub include_credentials: bool,
    /// Whether to include gateway settings.
    pub include_gateway: bool,
    /// Whether to include display settings (resolution, color depth, etc.).
    pub include_display: bool,
    /// Whether to include redirection settings (printers, clipboard, drives, etc.).
    pub include_redirections: bool,
    /// Whether to include performance settings (wallpaper, themes, etc.).
    pub include_performance: bool,
    /// Optional comment header prepended to the file.
    pub header_comment: Option<String>,
}

impl Default for GenerateOptions {
    fn default() -> Self {
        Self {
            include_credentials: true,
            include_gateway: true,
            include_display: true,
            include_redirections: true,
            include_performance: true,
            header_comment: None,
        }
    }
}

// ─── Helper macros / functions ──────────────────────────────────────

/// Append an integer setting line.
fn write_int(output: &mut String, key: &str, value: i64) {
    output.push_str(&format!("{key}:i:{value}\r\n"));
}

/// Append a string setting line.
fn write_str(output: &mut String, key: &str, value: &str) {
    output.push_str(&format!("{key}:s:{value}\r\n"));
}

/// Append a boolean setting line (true = 1, false = 0).
fn write_bool(output: &mut String, key: &str, value: bool) {
    write_int(output, key, if value { 1 } else { 0 });
}

/// Append an optional integer setting line.
#[allow(dead_code)]
fn write_opt_int(output: &mut String, key: &str, value: Option<i64>) {
    if let Some(v) = value {
        write_int(output, key, v);
    }
}

/// Append an optional u8 as integer.
fn write_opt_u8(output: &mut String, key: &str, value: Option<u8>) {
    if let Some(v) = value {
        write_int(output, key, v as i64);
    }
}

/// Append an optional u16 as integer.
fn write_opt_u16(output: &mut String, key: &str, value: Option<u16>) {
    if let Some(v) = value {
        write_int(output, key, v as i64);
    }
}

/// Append an optional u32 as integer.
fn write_opt_u32(output: &mut String, key: &str, value: Option<u32>) {
    if let Some(v) = value {
        write_int(output, key, v as i64);
    }
}

/// Append an optional bool.
fn write_opt_bool(output: &mut String, key: &str, value: Option<bool>) {
    if let Some(v) = value {
        write_bool(output, key, v);
    }
}

/// Append an optional string.
fn write_opt_str(output: &mut String, key: &str, value: &Option<String>) {
    if let Some(v) = value {
        write_str(output, key, v);
    }
}

// ─── Public API ─────────────────────────────────────────────────────

/// Generate a complete `.rdp` file from the given RDP file struct.
///
/// All non-`None` fields are written out in the standard `key:type:value` format.
pub fn generate_rdp_file(rdp: &RdpFile) -> String {
    generate_with_options(rdp, &GenerateOptions::default())
}

/// Generate an `.rdp` file with selective inclusion of setting groups.
pub fn generate_with_options(rdp: &RdpFile, options: &GenerateOptions) -> String {
    let mut output = String::with_capacity(2048);

    // Optional header comment
    if let Some(ref comment) = options.header_comment {
        for line in comment.lines() {
            output.push_str(&format!("; {line}\r\n"));
        }
        output.push_str("\r\n");
    }

    // ── Connection (always included) ────────────────────────────
    write_str(&mut output, "full address", &rdp.full_address);
    write_opt_u16(&mut output, "server port", rdp.server_port);

    if options.include_credentials {
        write_opt_str(&mut output, "username", &rdp.username);
        write_opt_str(&mut output, "domain", &rdp.domain);
    }

    // ── Display ─────────────────────────────────────────────────
    if options.include_display {
        write_opt_u8(&mut output, "screen mode id", rdp.screen_mode_id);
        write_opt_u32(&mut output, "desktopwidth", rdp.desktopwidth);
        write_opt_u32(&mut output, "desktopheight", rdp.desktopheight);
        write_opt_u8(&mut output, "session bpp", rdp.session_bpp);
        write_opt_bool(&mut output, "use multimon", rdp.use_multimon);
        write_opt_bool(&mut output, "smart sizing", rdp.smart_sizing);
        write_opt_bool(&mut output, "dynamic resolution", rdp.dynamic_resolution);
    }

    // ── Performance ─────────────────────────────────────────────
    if options.include_performance {
        write_opt_bool(&mut output, "compression", rdp.compression);
        write_opt_u8(&mut output, "connection type", rdp.connection_type);
        write_opt_bool(&mut output, "networkautodetect", rdp.networkautodetect);
        write_opt_bool(&mut output, "bandwidthautodetect", rdp.bandwidthautodetect);
        write_opt_bool(&mut output, "displayconnectionbar", rdp.displayconnectionbar);
        write_opt_bool(
            &mut output,
            "enableworkspacereconnect",
            rdp.enableworkspacereconnect,
        );
        write_opt_bool(&mut output, "disable wallpaper", rdp.disable_wallpaper);
        write_opt_bool(
            &mut output,
            "allow font smoothing",
            rdp.allow_font_smoothing,
        );
        write_opt_bool(
            &mut output,
            "allow desktop composition",
            rdp.allow_desktop_composition,
        );
        write_opt_bool(
            &mut output,
            "disable full window drag",
            rdp.disable_full_window_drag,
        );
        write_opt_bool(
            &mut output,
            "disable menu anims",
            rdp.disable_menu_anims,
        );
        write_opt_bool(&mut output, "disable themes", rdp.disable_themes);
        write_opt_bool(
            &mut output,
            "disable cursor setting",
            rdp.disable_cursor_setting,
        );
        write_opt_bool(
            &mut output,
            "bitmapcachepersistenable",
            rdp.bitmapcachepersistenable,
        );
        write_opt_u32(&mut output, "bitmapcachesize", rdp.bitmapcachesize);
    }

    // ── Audio / Video ───────────────────────────────────────────
    write_opt_u8(&mut output, "audiomode", rdp.audiomode);
    write_opt_u8(&mut output, "audiocapturemode", rdp.audiocapturemode);
    write_opt_u8(&mut output, "videoplaybackmode", rdp.videoplaybackmode);

    // ── Redirection ─────────────────────────────────────────────
    if options.include_redirections {
        write_opt_bool(&mut output, "redirectprinters", rdp.redirectprinters);
        write_opt_bool(&mut output, "redirectcomports", rdp.redirectcomports);
        write_opt_bool(&mut output, "redirectsmartcards", rdp.redirectsmartcards);
        write_opt_bool(&mut output, "redirectclipboard", rdp.redirectclipboard);
        write_opt_bool(&mut output, "redirectposdevices", rdp.redirectposdevices);
        write_opt_bool(&mut output, "redirectdirectx", rdp.redirectdirectx);
        write_opt_str(&mut output, "drivestoredirect", &rdp.drivestoredirect);
        write_opt_bool(&mut output, "redirectwebauthn", rdp.redirectwebauthn);
    }

    // ── Authentication / Security ───────────────────────────────
    write_opt_bool(
        &mut output,
        "autoreconnection enabled",
        rdp.autoreconnection_enabled,
    );
    write_opt_u8(
        &mut output,
        "authentication level",
        rdp.authentication_level,
    );
    write_opt_bool(
        &mut output,
        "prompt for credentials",
        rdp.prompt_for_credentials,
    );
    write_opt_bool(
        &mut output,
        "negotiate security layer",
        rdp.negotiate_security_layer,
    );
    write_opt_bool(
        &mut output,
        "enablecredsspsupport",
        rdp.enablecredsspsupport,
    );

    // ── RemoteApp ───────────────────────────────────────────────
    write_opt_bool(
        &mut output,
        "remoteapplicationmode",
        rdp.remoteapplicationmode,
    );
    write_opt_str(&mut output, "alternate shell", &rdp.alternate_shell);
    write_opt_str(
        &mut output,
        "shell working directory",
        &rdp.shell_working_directory,
    );

    // ── Gateway ─────────────────────────────────────────────────
    if options.include_gateway {
        write_opt_str(&mut output, "gatewayhostname", &rdp.gatewayhostname);
        write_opt_u8(&mut output, "gatewayusagemethod", rdp.gatewayusagemethod);
        write_opt_u8(
            &mut output,
            "gatewaycredentialssource",
            rdp.gatewaycredentialssource,
        );
        write_opt_u8(
            &mut output,
            "gatewayprofileusagemethod",
            rdp.gatewayprofileusagemethod,
        );
    }

    // ── Keyboard / Input ────────────────────────────────────────
    write_opt_u8(&mut output, "keyboardhook", rdp.keyboardhook);

    // ── Misc ────────────────────────────────────────────────────
    write_opt_bool(
        &mut output,
        "use redirection server name",
        rdp.use_redirection_server_name,
    );
    write_opt_str(&mut output, "loadbalanceinfo", &rdp.loadbalanceinfo);
    write_opt_bool(&mut output, "rdgiskdcproxy", rdp.rdgiskdcproxy);
    write_opt_str(&mut output, "kdcproxyname", &rdp.kdcproxyname);

    // ── Custom settings ─────────────────────────────────────────
    let mut custom_keys: Vec<&String> = rdp.custom_settings.keys().collect();
    custom_keys.sort();
    for key in custom_keys {
        if let Some(value) = rdp.custom_settings.get(key) {
            match value {
                RdpValue::Integer(v) => write_int(&mut output, key, *v),
                RdpValue::String(v) => write_str(&mut output, key, v),
            }
        }
    }

    output
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser;

    #[test]
    fn generate_basic_rdp_file() {
        let mut rdp = RdpFile::default();
        rdp.full_address = "10.0.0.1".to_string();
        rdp.server_port = Some(3389);
        rdp.username = Some("admin".to_string());
        rdp.screen_mode_id = Some(2);
        rdp.desktopwidth = Some(1920);
        rdp.desktopheight = Some(1080);

        let content = generate_rdp_file(&rdp);
        assert!(content.contains("full address:s:10.0.0.1"));
        assert!(content.contains("server port:i:3389"));
        assert!(content.contains("username:s:admin"));
        assert!(content.contains("screen mode id:i:2"));
        assert!(content.contains("desktopwidth:i:1920"));
        assert!(content.contains("desktopheight:i:1080"));
    }

    #[test]
    fn generate_with_header_comment() {
        let rdp = RdpFile {
            full_address: "myserver".to_string(),
            ..Default::default()
        };
        let options = GenerateOptions {
            header_comment: Some("Generated by SortOfRemote NG".to_string()),
            ..Default::default()
        };
        let content = generate_with_options(&rdp, &options);
        assert!(content.starts_with("; Generated by SortOfRemote NG"));
    }

    #[test]
    fn generate_excludes_credentials() {
        let rdp = RdpFile {
            full_address: "server1".to_string(),
            username: Some("testuser".to_string()),
            domain: Some("CORP".to_string()),
            ..Default::default()
        };
        let options = GenerateOptions {
            include_credentials: false,
            ..Default::default()
        };
        let content = generate_with_options(&rdp, &options);
        assert!(!content.contains("username"));
        assert!(!content.contains("domain"));
    }

    #[test]
    fn round_trip_fidelity() {
        let mut rdp = RdpFile::default();
        rdp.full_address = "192.168.1.50".to_string();
        rdp.server_port = Some(3390);
        rdp.username = Some("user1".to_string());
        rdp.domain = Some("EXAMPLE".to_string());
        rdp.screen_mode_id = Some(1);
        rdp.desktopwidth = Some(1280);
        rdp.desktopheight = Some(720);
        rdp.session_bpp = Some(24);
        rdp.redirectclipboard = Some(true);
        rdp.audiomode = Some(0);
        rdp.connection_type = Some(6);

        let generated = generate_rdp_file(&rdp);
        let parsed = parser::parse_rdp_file(&generated).unwrap();

        assert_eq!(parsed.rdp_file.full_address, rdp.full_address);
        assert_eq!(parsed.rdp_file.server_port, rdp.server_port);
        assert_eq!(parsed.rdp_file.username, rdp.username);
        assert_eq!(parsed.rdp_file.domain, rdp.domain);
        assert_eq!(parsed.rdp_file.screen_mode_id, rdp.screen_mode_id);
        assert_eq!(parsed.rdp_file.desktopwidth, rdp.desktopwidth);
        assert_eq!(parsed.rdp_file.desktopheight, rdp.desktopheight);
        assert_eq!(parsed.rdp_file.session_bpp, rdp.session_bpp);
        assert_eq!(parsed.rdp_file.redirectclipboard, rdp.redirectclipboard);
        assert_eq!(parsed.rdp_file.audiomode, rdp.audiomode);
        assert_eq!(parsed.rdp_file.connection_type, rdp.connection_type);
    }

    #[test]
    fn generate_custom_settings() {
        let mut rdp = RdpFile::default();
        rdp.full_address = "host1".to_string();
        rdp.custom_settings
            .insert("mycustom".to_string(), RdpValue::Integer(99));
        rdp.custom_settings
            .insert("anothercustom".to_string(), RdpValue::String("val".to_string()));

        let content = generate_rdp_file(&rdp);
        assert!(content.contains("mycustom:i:99"));
        assert!(content.contains("anothercustom:s:val"));
    }
}
