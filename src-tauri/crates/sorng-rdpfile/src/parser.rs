//! Full .rdp file parser.
//!
//! Parses Microsoft `.rdp` files that use the `key:type:value` format,
//! where type is `i` for integer or `s` for string.

use std::collections::HashMap;

use crate::error::RdpFileError;
use crate::types::{RdpFile, RdpParseResult, RdpValue};

/// Known deprecated settings that should generate warnings.
const DEPRECATED_SETTINGS: &[&str] = &[
    "autoreconnect max retries",
    "connect to console",
    "span monitors",
    "pinconnectionbar",
];

/// Parse a single line of an `.rdp` file.
///
/// Expected formats:
/// - `key:i:value` (integer)
/// - `key:s:value` (string)
/// - `key:value`   (legacy / missing type prefix → try integer, then string)
///
/// Returns `None` for blank lines and comments (lines starting with `;` or `#`).
pub fn parse_line(line: &str) -> Option<(String, RdpValue)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
        return None;
    }

    // Try `key:type:value` (3-part)
    let parts: Vec<&str> = trimmed.splitn(3, ':').collect();
    match parts.len() {
        3 => {
            let key = parts[0].trim().to_lowercase();
            let type_char = parts[1].trim().to_lowercase();
            let raw_value = parts[2].trim();

            match type_char.as_str() {
                "i" => {
                    let int_val = raw_value.parse::<i64>().unwrap_or(0);
                    Some((key, RdpValue::Integer(int_val)))
                }
                "s" => Some((key, RdpValue::String(raw_value.to_string()))),
                _ => {
                    // Unknown type — store as string
                    Some((key, RdpValue::String(raw_value.to_string())))
                }
            }
        }
        2 => {
            // `key:value` — legacy or missing type prefix
            let key = parts[0].trim().to_lowercase();
            let raw_value = parts[1].trim();

            if let Ok(int_val) = raw_value.parse::<i64>() {
                Some((key, RdpValue::Integer(int_val)))
            } else {
                Some((key, RdpValue::String(raw_value.to_string())))
            }
        }
        _ => None,
    }
}

/// Helper: extract an integer from an `RdpValue`, returning `None` if it's a string.
fn val_to_i64(v: &RdpValue) -> Option<i64> {
    v.as_integer()
}

/// Helper: convert integer value to bool (0 = false, nonzero = true).
fn val_to_bool(v: &RdpValue) -> Option<bool> {
    v.as_bool()
}

/// Helper: extract a string from an `RdpValue`.
fn val_to_string(v: &RdpValue) -> Option<String> {
    match v {
        RdpValue::String(s) => Some(s.clone()),
        RdpValue::Integer(i) => Some(i.to_string()),
    }
}

/// All known setting keys that map to typed `RdpFile` fields.
#[allow(dead_code)]
const KNOWN_SETTINGS: &[&str] = &[
    "full address",
    "server port",
    "username",
    "domain",
    "screen mode id",
    "desktopwidth",
    "desktopheight",
    "session bpp",
    "use multimon",
    "smart sizing",
    "dynamic resolution",
    "compression",
    "connection type",
    "networkautodetect",
    "bandwidthautodetect",
    "displayconnectionbar",
    "enableworkspacereconnect",
    "disable wallpaper",
    "allow font smoothing",
    "allow desktop composition",
    "disable full window drag",
    "disable menu anims",
    "disable themes",
    "disable cursor setting",
    "bitmapcachepersistenable",
    "bitmapcachesize",
    "audiomode",
    "audiocapturemode",
    "videoplaybackmode",
    "redirectprinters",
    "redirectcomports",
    "redirectsmartcards",
    "redirectclipboard",
    "redirectposdevices",
    "redirectdirectx",
    "drivestoredirect",
    "redirectwebauthn",
    "autoreconnection enabled",
    "authentication level",
    "prompt for credentials",
    "negotiate security layer",
    "enablecredsspsupport",
    "remoteapplicationmode",
    "alternate shell",
    "shell working directory",
    "gatewayhostname",
    "gatewayusagemethod",
    "gatewaycredentialssource",
    "gatewayprofileusagemethod",
    "keyboardhook",
    "use redirection server name",
    "loadbalanceinfo",
    "rdgiskdcproxy",
    "kdcproxyname",
];

/// Parse the full content of an `.rdp` file into an [`RdpParseResult`].
///
/// Handles `i:integer` and `s:string` type prefixes, tolerates missing
/// prefixes, collects unknown settings into `custom_settings`, and
/// generates warnings for deprecated/unusual settings.
pub fn parse_rdp_file(content: &str) -> Result<RdpParseResult, RdpFileError> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err(RdpFileError::EmptyFile);
    }

    let mut parsed: HashMap<String, RdpValue> = HashMap::new();
    let mut warnings: Vec<String> = Vec::new();

    for (line_num, line) in content.lines().enumerate() {
        if let Some((key, value)) = parse_line(line) {
            // Check for deprecated settings
            if DEPRECATED_SETTINGS.contains(&key.as_str()) {
                warnings.push(format!(
                    "line {}: setting '{}' is deprecated",
                    line_num + 1,
                    key
                ));
            }
            parsed.insert(key, value);
        }
    }

    // Build the RdpFile struct from parsed entries
    let mut rdp = RdpFile::default();
    let mut unknown_settings: Vec<String> = Vec::new();

    for (key, value) in &parsed {
        match key.as_str() {
            "full address" => {
                rdp.full_address = val_to_string(value).unwrap_or_default();
            }
            "server port" => {
                rdp.server_port = val_to_i64(value).map(|v| v as u16);
            }
            "username" => {
                rdp.username = val_to_string(value);
            }
            "domain" => {
                rdp.domain = val_to_string(value);
            }
            "screen mode id" => {
                rdp.screen_mode_id = val_to_i64(value).map(|v| v as u8);
            }
            "desktopwidth" => {
                rdp.desktopwidth = val_to_i64(value).map(|v| v as u32);
            }
            "desktopheight" => {
                rdp.desktopheight = val_to_i64(value).map(|v| v as u32);
            }
            "session bpp" => {
                rdp.session_bpp = val_to_i64(value).map(|v| v as u8);
            }
            "use multimon" => {
                rdp.use_multimon = val_to_bool(value);
            }
            "smart sizing" => {
                rdp.smart_sizing = val_to_bool(value);
            }
            "dynamic resolution" => {
                rdp.dynamic_resolution = val_to_bool(value);
            }
            "compression" => {
                rdp.compression = val_to_bool(value);
            }
            "connection type" => {
                rdp.connection_type = val_to_i64(value).map(|v| v as u8);
            }
            "networkautodetect" => {
                rdp.networkautodetect = val_to_bool(value);
            }
            "bandwidthautodetect" => {
                rdp.bandwidthautodetect = val_to_bool(value);
            }
            "displayconnectionbar" => {
                rdp.displayconnectionbar = val_to_bool(value);
            }
            "enableworkspacereconnect" => {
                rdp.enableworkspacereconnect = val_to_bool(value);
            }
            "disable wallpaper" => {
                rdp.disable_wallpaper = val_to_bool(value);
            }
            "allow font smoothing" => {
                rdp.allow_font_smoothing = val_to_bool(value);
            }
            "allow desktop composition" => {
                rdp.allow_desktop_composition = val_to_bool(value);
            }
            "disable full window drag" => {
                rdp.disable_full_window_drag = val_to_bool(value);
            }
            "disable menu anims" => {
                rdp.disable_menu_anims = val_to_bool(value);
            }
            "disable themes" => {
                rdp.disable_themes = val_to_bool(value);
            }
            "disable cursor setting" => {
                rdp.disable_cursor_setting = val_to_bool(value);
            }
            "bitmapcachepersistenable" => {
                rdp.bitmapcachepersistenable = val_to_bool(value);
            }
            "bitmapcachesize" => {
                rdp.bitmapcachesize = val_to_i64(value).map(|v| v as u32);
            }
            "audiomode" => {
                rdp.audiomode = val_to_i64(value).map(|v| v as u8);
            }
            "audiocapturemode" => {
                rdp.audiocapturemode = val_to_i64(value).map(|v| v as u8);
            }
            "videoplaybackmode" => {
                rdp.videoplaybackmode = val_to_i64(value).map(|v| v as u8);
            }
            "redirectprinters" => {
                rdp.redirectprinters = val_to_bool(value);
            }
            "redirectcomports" => {
                rdp.redirectcomports = val_to_bool(value);
            }
            "redirectsmartcards" => {
                rdp.redirectsmartcards = val_to_bool(value);
            }
            "redirectclipboard" => {
                rdp.redirectclipboard = val_to_bool(value);
            }
            "redirectposdevices" => {
                rdp.redirectposdevices = val_to_bool(value);
            }
            "redirectdirectx" => {
                rdp.redirectdirectx = val_to_bool(value);
            }
            "drivestoredirect" => {
                rdp.drivestoredirect = val_to_string(value);
            }
            "redirectwebauthn" => {
                rdp.redirectwebauthn = val_to_bool(value);
            }
            "autoreconnection enabled" => {
                rdp.autoreconnection_enabled = val_to_bool(value);
            }
            "authentication level" => {
                rdp.authentication_level = val_to_i64(value).map(|v| v as u8);
            }
            "prompt for credentials" => {
                rdp.prompt_for_credentials = val_to_bool(value);
            }
            "negotiate security layer" => {
                rdp.negotiate_security_layer = val_to_bool(value);
            }
            "enablecredsspsupport" => {
                rdp.enablecredsspsupport = val_to_bool(value);
            }
            "remoteapplicationmode" => {
                rdp.remoteapplicationmode = val_to_bool(value);
            }
            "alternate shell" => {
                rdp.alternate_shell = val_to_string(value);
            }
            "shell working directory" => {
                rdp.shell_working_directory = val_to_string(value);
            }
            "gatewayhostname" => {
                rdp.gatewayhostname = val_to_string(value);
            }
            "gatewayusagemethod" => {
                rdp.gatewayusagemethod = val_to_i64(value).map(|v| v as u8);
            }
            "gatewaycredentialssource" => {
                rdp.gatewaycredentialssource = val_to_i64(value).map(|v| v as u8);
            }
            "gatewayprofileusagemethod" => {
                rdp.gatewayprofileusagemethod = val_to_i64(value).map(|v| v as u8);
            }
            "keyboardhook" => {
                rdp.keyboardhook = val_to_i64(value).map(|v| v as u8);
            }
            "use redirection server name" => {
                rdp.use_redirection_server_name = val_to_bool(value);
            }
            "loadbalanceinfo" => {
                rdp.loadbalanceinfo = val_to_string(value);
            }
            "rdgiskdcproxy" => {
                rdp.rdgiskdcproxy = val_to_bool(value);
            }
            "kdcproxyname" => {
                rdp.kdcproxyname = val_to_string(value);
            }
            _ => {
                unknown_settings.push(key.clone());
                rdp.custom_settings.insert(key.clone(), value.clone());
            }
        }
    }

    // Warn if no full address was found
    if rdp.full_address.is_empty() {
        warnings.push("missing 'full address' — required for a valid RDP connection".to_string());
    }

    // Validate some ranges
    if let Some(bpp) = rdp.session_bpp {
        if !matches!(bpp, 8 | 15 | 16 | 24 | 32) {
            warnings.push(format!(
                "unusual session bpp value: {bpp} (expected 8, 15, 16, 24, or 32)"
            ));
        }
    }
    if let Some(ct) = rdp.connection_type {
        if ct > 7 {
            warnings.push(format!(
                "connection type {ct} is out of range (expected 1–7)"
            ));
        }
    }
    if let Some(am) = rdp.audiomode {
        if am > 2 {
            warnings.push(format!(
                "audiomode {am} is out of range (expected 0–2)"
            ));
        }
    }

    unknown_settings.sort();

    Ok(RdpParseResult {
        rdp_file: rdp,
        warnings,
        unknown_settings,
    })
}

/// Parse an RDP file given its file path.
///
/// In a real implementation this would read from disk via `std::fs::read_to_string`.
/// Here we accept the content as if already read, to remain pure and testable.
pub fn parse_rdp_file_from_path(content: &str) -> Result<RdpParseResult, RdpFileError> {
    parse_rdp_file(content)
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_rdp_file() {
        let content = "\
full address:s:192.168.1.100
server port:i:3389
username:s:admin
screen mode id:i:2
desktopwidth:i:1920
desktopheight:i:1080
session bpp:i:32
redirectclipboard:i:1
";
        let result = parse_rdp_file(content).unwrap();
        assert_eq!(result.rdp_file.full_address, "192.168.1.100");
        assert_eq!(result.rdp_file.server_port, Some(3389));
        assert_eq!(result.rdp_file.username, Some("admin".to_string()));
        assert_eq!(result.rdp_file.screen_mode_id, Some(2));
        assert_eq!(result.rdp_file.desktopwidth, Some(1920));
        assert_eq!(result.rdp_file.desktopheight, Some(1080));
        assert_eq!(result.rdp_file.session_bpp, Some(32));
        assert_eq!(result.rdp_file.redirectclipboard, Some(true));
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn parse_unknown_settings_collected() {
        let content = "\
full address:s:myserver
custom_thing:i:42
another_custom:s:hello
";
        let result = parse_rdp_file(content).unwrap();
        assert_eq!(result.unknown_settings.len(), 2);
        assert!(result.rdp_file.custom_settings.contains_key("custom_thing"));
        assert!(result.rdp_file.custom_settings.contains_key("another_custom"));
    }

    #[test]
    fn parse_empty_file_errors() {
        assert!(parse_rdp_file("").is_err());
        assert!(parse_rdp_file("   \n  \n  ").is_err());
    }

    #[test]
    fn parse_comments_and_blank_lines() {
        let content = "\
; This is a comment
# Another comment

full address:s:server1
";
        let result = parse_rdp_file(content).unwrap();
        assert_eq!(result.rdp_file.full_address, "server1");
    }

    #[test]
    fn parse_deprecated_setting_warns() {
        let content = "\
full address:s:server1
connect to console:i:1
";
        let result = parse_rdp_file(content).unwrap();
        assert!(result.warnings.iter().any(|w| w.contains("deprecated")));
    }

    #[test]
    fn parse_line_basic() {
        let (key, val) = parse_line("full address:s:10.0.0.1").unwrap();
        assert_eq!(key, "full address");
        assert_eq!(val, RdpValue::String("10.0.0.1".to_string()));

        let (key, val) = parse_line("desktopwidth:i:1920").unwrap();
        assert_eq!(key, "desktopwidth");
        assert_eq!(val, RdpValue::Integer(1920));
    }

    #[test]
    fn parse_line_no_type_prefix() {
        let (key, val) = parse_line("server port:3389").unwrap();
        assert_eq!(key, "server port");
        assert_eq!(val, RdpValue::Integer(3389));

        let (key, val) = parse_line("full address:myhost").unwrap();
        assert_eq!(key, "full address");
        assert_eq!(val, RdpValue::String("myhost".to_string()));
    }

    #[test]
    fn parse_line_blank_and_comment() {
        assert!(parse_line("").is_none());
        assert!(parse_line("  ").is_none());
        assert!(parse_line("; comment").is_none());
        assert!(parse_line("# comment").is_none());
    }
}
