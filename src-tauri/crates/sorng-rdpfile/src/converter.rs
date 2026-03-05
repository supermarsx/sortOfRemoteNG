//! Convert between [`RdpFile`] and the app's connection format.

use crate::error::RdpFileError;
use crate::types::{ConnectionImport, RdpFile};

/// Default RDP port.
const DEFAULT_RDP_PORT: u16 = 3389;

/// Convert an [`RdpFile`] into a [`ConnectionImport`] suitable for importing
/// into the SortOfRemote NG connection tree.
///
/// The connection name is derived from the `full_address` field.
/// All RDP-specific settings are serialized into `rdp_settings` as JSON.
pub fn rdp_to_connection(rdp: &RdpFile) -> ConnectionImport {
    let hostname = rdp.full_address.clone();
    let port = rdp.server_port.unwrap_or(DEFAULT_RDP_PORT);

    // Derive a display name from address + optional username
    let name = match &rdp.username {
        Some(user) if !user.is_empty() => format!("{user}@{hostname}"),
        _ => hostname.clone(),
    };

    // Serialize the entire RdpFile to JSON for flexible storage
    let rdp_settings = serde_json::to_value(rdp).unwrap_or(serde_json::Value::Null);

    ConnectionImport {
        name,
        hostname,
        port,
        username: rdp.username.clone(),
        domain: rdp.domain.clone(),
        rdp_settings,
    }
}

/// Convert an app connection JSON value back into an [`RdpFile`].
///
/// Expects the JSON to contain at least a `hostname` field. Additional
/// RDP settings may be nested under an `rdp_settings` key, or the JSON
/// may be a full serialized `RdpFile`.
pub fn connection_to_rdp(connection_json: &serde_json::Value) -> Result<RdpFile, RdpFileError> {
    // If the JSON is a complete serialized RdpFile, try to deserialize directly
    if connection_json.get("full_address").is_some() {
        let rdp: RdpFile = serde_json::from_value(connection_json.clone())?;
        return Ok(rdp);
    }

    let mut rdp = RdpFile::default();

    // Extract hostname
    rdp.full_address = connection_json
        .get("hostname")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if rdp.full_address.is_empty() {
        return Err(RdpFileError::MissingAddress);
    }

    // Extract port
    rdp.server_port = connection_json
        .get("port")
        .and_then(|v| v.as_u64())
        .map(|v| v as u16)
        .or(Some(DEFAULT_RDP_PORT));

    // Extract username
    rdp.username = connection_json
        .get("username")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Extract domain
    rdp.domain = connection_json
        .get("domain")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // If there's an rdp_settings sub-object, merge those settings
    if let Some(settings) = connection_json.get("rdp_settings") {
        if let Some(obj) = settings.as_object() {
            // Display settings
            if let Some(v) = obj.get("screen_mode_id").and_then(|v| v.as_u64()) {
                rdp.screen_mode_id = Some(v as u8);
            }
            if let Some(v) = obj.get("desktopwidth").and_then(|v| v.as_u64()) {
                rdp.desktopwidth = Some(v as u32);
            }
            if let Some(v) = obj.get("desktopheight").and_then(|v| v.as_u64()) {
                rdp.desktopheight = Some(v as u32);
            }
            if let Some(v) = obj.get("session_bpp").and_then(|v| v.as_u64()) {
                rdp.session_bpp = Some(v as u8);
            }
            if let Some(v) = obj.get("use_multimon").and_then(|v| v.as_bool()) {
                rdp.use_multimon = Some(v);
            }
            if let Some(v) = obj.get("smart_sizing").and_then(|v| v.as_bool()) {
                rdp.smart_sizing = Some(v);
            }
            if let Some(v) = obj.get("dynamic_resolution").and_then(|v| v.as_bool()) {
                rdp.dynamic_resolution = Some(v);
            }

            // Audio
            if let Some(v) = obj.get("audiomode").and_then(|v| v.as_u64()) {
                rdp.audiomode = Some(v as u8);
            }
            if let Some(v) = obj.get("audiocapturemode").and_then(|v| v.as_u64()) {
                rdp.audiocapturemode = Some(v as u8);
            }
            if let Some(v) = obj.get("videoplaybackmode").and_then(|v| v.as_u64()) {
                rdp.videoplaybackmode = Some(v as u8);
            }

            // Performance
            if let Some(v) = obj.get("compression").and_then(|v| v.as_bool()) {
                rdp.compression = Some(v);
            }
            if let Some(v) = obj.get("connection_type").and_then(|v| v.as_u64()) {
                rdp.connection_type = Some(v as u8);
            }
            if let Some(v) = obj.get("networkautodetect").and_then(|v| v.as_bool()) {
                rdp.networkautodetect = Some(v);
            }
            if let Some(v) = obj.get("bandwidthautodetect").and_then(|v| v.as_bool()) {
                rdp.bandwidthautodetect = Some(v);
            }

            // Redirection
            if let Some(v) = obj.get("redirectclipboard").and_then(|v| v.as_bool()) {
                rdp.redirectclipboard = Some(v);
            }
            if let Some(v) = obj.get("redirectprinters").and_then(|v| v.as_bool()) {
                rdp.redirectprinters = Some(v);
            }
            if let Some(v) = obj.get("redirectcomports").and_then(|v| v.as_bool()) {
                rdp.redirectcomports = Some(v);
            }
            if let Some(v) = obj.get("redirectsmartcards").and_then(|v| v.as_bool()) {
                rdp.redirectsmartcards = Some(v);
            }
            if let Some(v) = obj.get("drivestoredirect").and_then(|v| v.as_str()) {
                rdp.drivestoredirect = Some(v.to_string());
            }

            // Security
            if let Some(v) = obj.get("authentication_level").and_then(|v| v.as_u64()) {
                rdp.authentication_level = Some(v as u8);
            }
            if let Some(v) = obj.get("enablecredsspsupport").and_then(|v| v.as_bool()) {
                rdp.enablecredsspsupport = Some(v);
            }

            // Gateway
            if let Some(v) = obj.get("gatewayhostname").and_then(|v| v.as_str()) {
                rdp.gatewayhostname = Some(v.to_string());
            }
            if let Some(v) = obj.get("gatewayusagemethod").and_then(|v| v.as_u64()) {
                rdp.gatewayusagemethod = Some(v as u8);
            }
            if let Some(v) = obj.get("gatewaycredentialssource").and_then(|v| v.as_u64()) {
                rdp.gatewaycredentialssource = Some(v as u8);
            }
        }
    }

    Ok(rdp)
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rdp_to_connection_basic() {
        let rdp = RdpFile {
            full_address: "10.0.0.5".to_string(),
            server_port: Some(3390),
            username: Some("admin".to_string()),
            domain: Some("CORP".to_string()),
            ..Default::default()
        };
        let conn = rdp_to_connection(&rdp);
        assert_eq!(conn.name, "admin@10.0.0.5");
        assert_eq!(conn.hostname, "10.0.0.5");
        assert_eq!(conn.port, 3390);
        assert_eq!(conn.username, Some("admin".to_string()));
        assert_eq!(conn.domain, Some("CORP".to_string()));
    }

    #[test]
    fn rdp_to_connection_default_port() {
        let rdp = RdpFile {
            full_address: "myhost".to_string(),
            ..Default::default()
        };
        let conn = rdp_to_connection(&rdp);
        assert_eq!(conn.port, 3389);
        assert_eq!(conn.name, "myhost");
    }

    #[test]
    fn connection_to_rdp_basic() {
        let json = serde_json::json!({
            "hostname": "server.local",
            "port": 3389,
            "username": "testuser",
            "domain": "EXAMPLE"
        });
        let rdp = connection_to_rdp(&json).unwrap();
        assert_eq!(rdp.full_address, "server.local");
        assert_eq!(rdp.server_port, Some(3389));
        assert_eq!(rdp.username, Some("testuser".to_string()));
        assert_eq!(rdp.domain, Some("EXAMPLE".to_string()));
    }

    #[test]
    fn connection_to_rdp_with_settings() {
        let json = serde_json::json!({
            "hostname": "fileserver",
            "port": 3390,
            "rdp_settings": {
                "screen_mode_id": 2,
                "desktopwidth": 1920,
                "desktopheight": 1080,
                "redirectclipboard": true,
                "audiomode": 0
            }
        });
        let rdp = connection_to_rdp(&json).unwrap();
        assert_eq!(rdp.full_address, "fileserver");
        assert_eq!(rdp.screen_mode_id, Some(2));
        assert_eq!(rdp.desktopwidth, Some(1920));
        assert_eq!(rdp.redirectclipboard, Some(true));
    }

    #[test]
    fn connection_to_rdp_missing_hostname() {
        let json = serde_json::json!({ "port": 3389 });
        assert!(connection_to_rdp(&json).is_err());
    }

    #[test]
    fn connection_to_rdp_full_rdpfile_json() {
        let rdp_orig = RdpFile {
            full_address: "host1".to_string(),
            server_port: Some(3389),
            username: Some("u".to_string()),
            session_bpp: Some(32),
            ..Default::default()
        };
        let json = serde_json::to_value(&rdp_orig).unwrap();
        let rdp = connection_to_rdp(&json).unwrap();
        assert_eq!(rdp.full_address, "host1");
        assert_eq!(rdp.session_bpp, Some(32));
    }
}
