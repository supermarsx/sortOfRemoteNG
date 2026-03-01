//! CSV import for mRemoteNG flat-table format.
//!
//! mRemoteNG CSV exports all connections as flat rows with columns
//! matching the XML attribute names. Containers are represented by
//! a "TreePath" column (e.g. "Connections/Production/WebServers").

use super::error::{MremotengError, MremotengResult};
use super::encryption;
use super::types::*;

/// Parse a mRemoteNG CSV string into a list of connections.
///
/// The CSV uses semicollon (`;`) as delimiter in mRemoteNG format.
/// Falls back to comma if semicolon produces no columns.
pub fn parse_csv(
    csv_content: &str,
    master_password: &str,
    kdf_iterations: u32,
) -> MremotengResult<Vec<MrngConnectionInfo>> {
    // Try semicolon first (mRemoteNG default), then comma
    let delimiter = if csv_content.lines().next().map_or(false, |l| l.contains(';')) {
        b';'
    } else {
        b','
    };

    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .has_headers(true)
        .from_reader(csv_content.as_bytes());

    let headers = reader.headers()
        .map_err(|e| MremotengError::CsvParse(format!("Failed to read headers: {}", e)))?
        .clone();

    let mut connections = Vec::new();

    for result in reader.records() {
        let record = result.map_err(|e| MremotengError::CsvParse(e.to_string()))?;
        let mut node = MrngConnectionInfo::default();

        for (i, header) in headers.iter().enumerate() {
            let val = record.get(i).unwrap_or("");
            if val.is_empty() { continue; }

            match header.trim() {
                "Name" => node.name = val.to_string(),
                "Type" | "NodeType" => node.node_type = MrngNodeType::from_str_loose(val),
                "Id" | "ConstantID" => node.constant_id = val.to_string(),
                "Description" | "Descr" => node.description = val.to_string(),
                "Icon" => node.icon = val.to_string(),
                "Panel" => node.panel = val.to_string(),
                "Hostname" => node.hostname = val.to_string(),
                "Port" => node.port = val.parse().unwrap_or(0),
                "Protocol" => node.protocol = MrngProtocol::from_str_loose(val),
                "Username" => node.username = val.to_string(),
                "Password" => {
                    node.password = encryption::decrypt_password(val, master_password, kdf_iterations);
                }
                "Domain" => node.domain = val.to_string(),
                "PuttySession" => node.putty_session = val.to_string(),
                "SSHOptions" => node.ssh_options = val.to_string(),
                "ExtApp" => node.ext_app = val.to_string(),
                "UseConsoleSession" => node.use_console_session = parse_bool(val),
                "RDPAuthenticationLevel" => node.rdp_authentication_level = parse_enum_u32(val),
                "RDGatewayHostname" => node.rd_gateway_hostname = val.to_string(),
                "RDGatewayUsageMethod" => node.rd_gateway_usage_method = parse_enum_u32(val),
                "RDGatewayUsername" => node.rd_gateway_username = val.to_string(),
                "Resolution" => node.resolution = parse_enum_u32(val),
                "Colors" => node.colors = parse_enum_u32(val),
                "CacheBitmaps" => node.cache_bitmaps = parse_bool(val),
                "RedirectKeys" => node.redirect_keys = parse_bool(val),
                "RedirectDiskDrives" => node.redirect_disk_drives = parse_enum_u32(val),
                "RedirectPrinters" => node.redirect_printers = parse_bool(val),
                "RedirectClipboard" => node.redirect_clipboard = parse_bool(val),
                "RedirectPorts" => node.redirect_ports = parse_bool(val),
                "RedirectSmartCards" => node.redirect_smart_cards = parse_bool(val),
                "RedirectSound" => node.redirect_sound = parse_enum_u32(val),
                "PreExtApp" => node.pre_ext_app = val.to_string(),
                "PostExtApp" => node.post_ext_app = val.to_string(),
                "MacAddress" => node.mac_address = val.to_string(),
                "UserField" => node.user_field = val.to_string(),
                "Favorite" => node.favorite = parse_bool(val),
                "VNCCompression" => node.vnc_compression = parse_enum_u32(val),
                "VNCEncoding" => node.vnc_encoding = parse_enum_u32(val),
                "VNCAuthMode" => node.vnc_auth_mode = parse_enum_u32(val),
                "VNCProxyType" => node.vnc_proxy_type = parse_enum_u32(val),
                "VNCProxyIP" => node.vnc_proxy_ip = val.to_string(),
                "VNCProxyPort" => node.vnc_proxy_port = val.parse().unwrap_or(0),
                "VNCProxyUsername" => node.vnc_proxy_username = val.to_string(),
                "VNCColors" => node.vnc_colors = parse_enum_u32(val),
                "VNCSmartSizeMode" => node.vnc_smart_size_mode = parse_enum_u32(val),
                "VNCViewOnly" => node.vnc_view_only = parse_bool(val),
                "RenderingEngine" => node.rendering_engine = parse_enum_u32(val),
                "UseCredSsp" => node.use_cred_ssp = parse_bool(val),
                "UseRestrictedAdmin" => node.use_restricted_admin = parse_bool(val),
                "Color" => node.color = val.to_string(),
                "TabColor" => node.tab_color = val.to_string(),
                "OpeningCommand" => node.opening_command = val.to_string(),
                "SSHTunnelConnectionName" => node.ssh_tunnel_connection_name = val.to_string(),
                "EnvironmentTags" => node.environment_tags = val.to_string(),
                _ => { /* Ignore unknown columns */ }
            }
        }

        if !node.name.is_empty() {
            connections.push(node);
        }
    }

    Ok(connections)
}

fn parse_bool(val: &str) -> bool {
    matches!(val.to_lowercase().as_str(), "true" | "1" | "yes")
}

fn parse_enum_u32<T: Default + From<u32>>(val: &str) -> T {
    val.parse::<u32>().map(T::from).unwrap_or_default()
}
