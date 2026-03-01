//! PuTTY session importer — reads sessions from Windows registry
//! (HKCU\Software\SimonTatham\PuTTY\Sessions) or from exported .reg files.
//!
//! On non-Windows platforms, only .reg file parsing is available.

use super::error::MremotengResult;
use super::types::*;

/// PuTTY registry path constant.
const PUTTY_SESSIONS_PATH: &str = r"Software\SimonTatham\PuTTY\Sessions";

/// Parse a PuTTY `.reg` export file into `PuttySession` objects.
///
/// Expects the Windows Registry Editor format:
/// ```text
/// Windows Registry Editor Version 5.00
///
/// [HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\MySession]
/// "HostName"="server.example.com"
/// "PortNumber"=dword:00000016
/// "Protocol"="ssh"
/// ```
pub fn parse_reg_file(content: &str) -> MremotengResult<Vec<PuttySession>> {
    let mut sessions: Vec<PuttySession> = Vec::new();
    let mut current_session: Option<PuttySession> = None;

    for line in content.lines() {
        let line = line.trim();

        // New session key
        if line.starts_with('[') && line.ends_with(']') {
            // Save previous session
            if let Some(session) = current_session.take() {
                if !session.hostname.is_empty() {
                    sessions.push(session);
                }
            }

            // Extract session name from registry path
            let path = &line[1..line.len() - 1];
            if let Some(name_part) = path.split('\\').last() {
                // URL-decode the session name (PuTTY uses %XX encoding)
                let name = url_decode(name_part);
                if name != "Default%20Settings" && name != "Default Settings" {
                    current_session = Some(PuttySession {
                        name: name.clone(),
                        ..Default::default()
                    });
                }
            }
            continue;
        }

        // Key-value pairs
        if let Some(ref mut session) = current_session {
            if let Some((key, value)) = parse_reg_value(line) {
                match key.as_str() {
                    "HostName" => session.hostname = value,
                    "PortNumber" => session.port = parse_dword(&value).unwrap_or(22) as u16,
                    "Protocol" => session.protocol = value,
                    "UserName" => session.username = value,
                    "ProxyHost" => session.proxy_host = value,
                    "ProxyPort" => session.proxy_port = parse_dword(&value).unwrap_or(0) as u16,
                    "ProxyMethod" => session.proxy_type = parse_dword(&value).unwrap_or(0),
                    "ProxyUsername" => session.proxy_username = value,
                    "PublicKeyFile" | "KeyExchange" => {
                        if key == "PublicKeyFile" {
                            session.private_key_file = value;
                        }
                    }
                    "TerminalType" => session.terminal_type = value,
                    "SerialLine" => session.serial_line = value,
                    "SerialSpeed" => session.serial_speed = parse_dword(&value).unwrap_or(9600),
                    _ => {}
                }
            }
        }
    }

    // Don't forget the last session
    if let Some(session) = current_session {
        if !session.hostname.is_empty() {
            sessions.push(session);
        }
    }

    Ok(sessions)
}

/// Read PuTTY sessions from the Windows registry.
///
/// Returns an empty Vec on non-Windows platforms.
#[cfg(target_os = "windows")]
pub fn read_registry_sessions() -> MremotengResult<Vec<PuttySession>> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let sessions_key = match hkcu.open_subkey(PUTTY_SESSIONS_PATH) {
        Ok(k) => k,
        Err(_) => return Ok(Vec::new()), // No PuTTY sessions
    };

    let mut sessions = Vec::new();

    for name_result in sessions_key.enum_keys() {
        let name = match name_result {
            Ok(n) => n,
            Err(_) => continue,
        };

        if name == "Default%20Settings" || name == "Default Settings" {
            continue;
        }

        let subkey = match sessions_key.open_subkey(&name) {
            Ok(k) => k,
            Err(_) => continue,
        };

        let decoded_name = url_decode(&name);
        let mut session = PuttySession {
            name: decoded_name,
            ..Default::default()
        };

        session.hostname = subkey.get_value("HostName").unwrap_or_default();
        session.port = subkey.get_value::<u32, _>("PortNumber").unwrap_or(22) as u16;
        session.protocol = subkey.get_value("Protocol").unwrap_or_else(|_| "ssh".into());
        session.username = subkey.get_value("UserName").unwrap_or_default();
        session.proxy_host = subkey.get_value("ProxyHost").unwrap_or_default();
        session.proxy_port = subkey.get_value::<u32, _>("ProxyPort").unwrap_or(0) as u16;
        session.proxy_type = subkey.get_value::<u32, _>("ProxyMethod").unwrap_or(0);
        session.proxy_username = subkey.get_value("ProxyUsername").unwrap_or_default();
        session.private_key_file = subkey.get_value("PublicKeyFile").unwrap_or_default();
        session.terminal_type = subkey.get_value("TerminalType").unwrap_or_default();
        session.serial_line = subkey.get_value("SerialLine").unwrap_or_default();
        session.serial_speed = subkey.get_value::<u32, _>("SerialSpeed").unwrap_or(9600);

        if !session.hostname.is_empty() {
            sessions.push(session);
        }
    }

    Ok(sessions)
}

#[cfg(not(target_os = "windows"))]
pub fn read_registry_sessions() -> MremotengResult<Vec<PuttySession>> {
    Ok(Vec::new())
}

/// Convert a PuTTY session to an `MrngConnectionInfo`.
pub fn putty_session_to_connection(session: &PuttySession) -> MrngConnectionInfo {
    let protocol = match session.protocol.to_lowercase().as_str() {
        "ssh" | "ssh2" => MrngProtocol::SSH2,
        "ssh1" => MrngProtocol::SSH1,
        "telnet" => MrngProtocol::Telnet,
        "rlogin" => MrngProtocol::Rlogin,
        "raw" => MrngProtocol::RAW,
        "serial" => MrngProtocol::RAW, // Map serial to RAW (closest)
        _ => MrngProtocol::SSH2,
    };

    let port = if session.port == 0 {
        protocol.default_port()
    } else {
        session.port
    };

    MrngConnectionInfo {
        name: session.name.clone(),
        hostname: session.hostname.clone(),
        port,
        protocol,
        username: session.username.clone(),
        putty_session: session.name.clone(),
        ..Default::default()
    }
}

/// Convert multiple PuTTY sessions to connections.
pub fn putty_sessions_to_connections(sessions: &[PuttySession]) -> Vec<MrngConnectionInfo> {
    sessions.iter().map(putty_session_to_connection).collect()
}

// ─── Helpers ─────────────────────────────────────────────────

/// Parse a registry value line:  "Key"="Value" or "Key"=dword:XXXX
fn parse_reg_value(line: &str) -> Option<(String, String)> {
    if !line.starts_with('"') {
        return None;
    }

    let after_first_quote = &line[1..];
    let end_key = after_first_quote.find('"')?;
    let key = after_first_quote[..end_key].to_string();

    let rest = &after_first_quote[end_key + 1..];
    if !rest.starts_with('=') {
        return None;
    }
    let value_part = &rest[1..];

    let value = if value_part.starts_with('"') && value_part.ends_with('"') {
        // String value
        value_part[1..value_part.len() - 1]
            .replace("\\\\", "\\")
            .replace("\\\"", "\"")
    } else if value_part.starts_with("dword:") {
        // DWORD value — keep as numeric string for parse_dword
        value_part.to_string()
    } else {
        value_part.to_string()
    };

    Some((key, value))
}

/// Parse a DWORD value from a registry string like "dword:00000016".
fn parse_dword(value: &str) -> Option<u32> {
    if let Some(hex) = value.strip_prefix("dword:") {
        u32::from_str_radix(hex, 16).ok()
    } else {
        value.parse().ok()
    }
}

/// URL-decode a PuTTY session name (%20 → space, etc.)
fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
            } else {
                result.push('%');
                result.push_str(&hex);
            }
        } else {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_reg_file() {
        let content = r#"Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\My%20Server]
"HostName"="ssh.example.com"
"PortNumber"=dword:00000016
"Protocol"="ssh"
"UserName"="admin"
"PublicKeyFile"="C:\\Users\\me\\.ssh\\id_rsa.ppk"

[HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\Telnet%20Box]
"HostName"="192.168.1.50"
"PortNumber"=dword:00000017
"Protocol"="telnet"
"#;

        let sessions = parse_reg_file(content).unwrap();
        assert_eq!(sessions.len(), 2);

        assert_eq!(sessions[0].name, "My Server");
        assert_eq!(sessions[0].hostname, "ssh.example.com");
        assert_eq!(sessions[0].port, 22);
        assert_eq!(sessions[0].protocol, "ssh");
        assert_eq!(sessions[0].username, "admin");
        assert!(sessions[0].private_key_file.contains("id_rsa.ppk"));

        assert_eq!(sessions[1].name, "Telnet Box");
        assert_eq!(sessions[1].hostname, "192.168.1.50");
        assert_eq!(sessions[1].port, 23);
        assert_eq!(sessions[1].protocol, "telnet");
    }

    #[test]
    fn test_putty_to_connection() {
        let session = PuttySession {
            name: "Test SSH".into(),
            hostname: "10.0.0.5".into(),
            port: 2222,
            protocol: "ssh".into(),
            username: "root".into(),
            ..Default::default()
        };

        let conn = putty_session_to_connection(&session);
        assert_eq!(conn.name, "Test SSH");
        assert_eq!(conn.hostname, "10.0.0.5");
        assert_eq!(conn.port, 2222);
        assert_eq!(conn.protocol, MrngProtocol::SSH2);
        assert_eq!(conn.username, "root");
    }

    #[test]
    fn test_url_decode() {
        assert_eq!(url_decode("Hello%20World"), "Hello World");
        assert_eq!(url_decode("My%20Server%20%2F%20Prod"), "My Server / Prod");
        assert_eq!(url_decode("NoEncoding"), "NoEncoding");
    }
}
