//! Input validation for VPN/proxy service parameters.
//!
//! Provides validation functions for user-supplied inputs before they are passed
//! to shell commands or network operations. Prevents command injection and
//! malformed inputs.

/// Validates that a string is safe for shell use (no metacharacters).
///
/// Allows alphanumeric characters plus: `.` `-` `_` `:` `[` `]` `/` `\` `@`
/// This is suitable for hostnames, IPs, usernames, and file paths.
pub fn validate_shell_safe(input: &str) -> Result<&str, String> {
    if input.is_empty() {
        return Err("Input must not be empty".to_string());
    }
    if input
        .chars()
        .all(|c| c.is_alphanumeric() || ".-_:[]/\\@".contains(c))
    {
        Ok(input)
    } else {
        Err(format!(
            "Invalid characters in input: '{}'",
            input.chars().take(30).collect::<String>()
        ))
    }
}

/// Validates that a string is a safe file path (no traversal or shell metacharacters).
///
/// Rejects paths containing `..`, null bytes, or shell-special characters
/// like `;`, `|`, `&`, `$`, `` ` ``, `(`, `)`, `{`, `}`, `>`, `<`, `!`, `~`.
pub fn validate_path_safe(path: &str) -> Result<&str, String> {
    if path.is_empty() {
        return Err("Path must not be empty".to_string());
    }
    if path.contains("..") {
        return Err(format!("Path traversal not allowed: '{}'", path));
    }
    if path.contains('\0') {
        return Err("Null bytes not allowed in path".to_string());
    }
    let dangerous_chars = [';', '|', '&', '$', '`', '(', ')', '{', '}', '>', '<', '!', '~'];
    for ch in dangerous_chars {
        if path.contains(ch) {
            return Err(format!(
                "Dangerous character '{}' in path: '{}'",
                ch,
                path.chars().take(30).collect::<String>()
            ));
        }
    }
    Ok(path)
}

/// Validates a hostname or IP address.
///
/// Accepts: alphanumeric, dots, hyphens, colons (IPv6), square brackets.
pub fn validate_hostname(host: &str) -> Result<&str, String> {
    if host.is_empty() {
        return Err("Hostname must not be empty".to_string());
    }
    if host.len() > 253 {
        return Err("Hostname too long (max 253 characters)".to_string());
    }
    if host
        .chars()
        .all(|c| c.is_alphanumeric() || ".-_:[]%".contains(c))
    {
        Ok(host)
    } else {
        Err(format!(
            "Invalid hostname: '{}'",
            host.chars().take(30).collect::<String>()
        ))
    }
}

/// Validates that a port number is in the valid range (1-65535).
pub fn validate_port(port: u16) -> Result<u16, String> {
    if port == 0 {
        return Err("Port must be between 1 and 65535".to_string());
    }
    Ok(port)
}

/// Validates that a port number is in a specific range.
pub fn validate_port_range(port: u16, min: u16, max: u16) -> Result<u16, String> {
    if port < min || port > max {
        return Err(format!(
            "Port {} out of allowed range {}-{}",
            port, min, max
        ));
    }
    Ok(port)
}

/// Validates a network ID string (e.g., ZeroTier network IDs are hex strings).
pub fn validate_network_id(id: &str) -> Result<&str, String> {
    if id.is_empty() {
        return Err("Network ID must not be empty".to_string());
    }
    if id.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(id)
    } else {
        Err(format!("Invalid network ID (expected hex): '{}'", id))
    }
}

/// Sanitize a connection name for use as a system identifier (e.g., RAS entry name, interface name).
///
/// Replaces unsafe characters with underscores, truncates to max_len.
pub fn sanitize_system_name(name: &str, max_len: usize) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(max_len)
        .collect();
    if sanitized.is_empty() {
        "unnamed".to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_safe_accepts_valid_hostname() {
        assert!(validate_shell_safe("example.com").is_ok());
        assert!(validate_shell_safe("192.168.1.1").is_ok());
        assert!(validate_shell_safe("[::1]").is_ok());
        assert!(validate_shell_safe("user_name").is_ok());
    }

    #[test]
    fn shell_safe_rejects_metacharacters() {
        assert!(validate_shell_safe("host; rm -rf /").is_err());
        assert!(validate_shell_safe("$(whoami)").is_err());
        assert!(validate_shell_safe("host`id`").is_err());
        assert!(validate_shell_safe("").is_err());
    }

    #[test]
    fn path_safe_rejects_traversal() {
        assert!(validate_path_safe("../../etc/passwd").is_err());
        assert!(validate_path_safe("normal/path/file.conf").is_ok());
    }

    #[test]
    fn path_safe_rejects_dangerous_chars() {
        assert!(validate_path_safe("/tmp/file; rm -rf /").is_err());
        assert!(validate_path_safe("/tmp/file|pipe").is_err());
        assert!(validate_path_safe("/tmp/$(cmd)").is_err());
    }

    #[test]
    fn hostname_validation() {
        assert!(validate_hostname("vpn.example.com").is_ok());
        assert!(validate_hostname("10.0.0.1").is_ok());
        assert!(validate_hostname("[fe80::1%eth0]").is_ok());
        assert!(validate_hostname("").is_err());
        assert!(validate_hostname("host;bad").is_err());
    }

    #[test]
    fn port_validation() {
        assert!(validate_port(443).is_ok());
        assert!(validate_port(0).is_err());
        assert!(validate_port(1).is_ok());
        assert!(validate_port(65535).is_ok());
    }

    #[test]
    fn port_range_validation() {
        assert!(validate_port_range(1024, 1024, 65535).is_ok());
        assert!(validate_port_range(80, 1024, 65535).is_err());
    }

    #[test]
    fn network_id_validation() {
        assert!(validate_network_id("abcdef0123456789").is_ok());
        assert!(validate_network_id("not-hex!").is_err());
        assert!(validate_network_id("").is_err());
    }

    #[test]
    fn sanitize_system_name_works() {
        assert_eq!(sanitize_system_name("My VPN Connection!", 20), "My_VPN_Connection_");
        assert_eq!(sanitize_system_name("a".repeat(100).as_str(), 10), "aaaaaaaaaa");
        assert_eq!(sanitize_system_name("", 20), "unnamed");
        assert_eq!(sanitize_system_name("valid-name_01", 20), "valid-name_01");
    }
}
