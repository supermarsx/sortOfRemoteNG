//! # lsof — Network file descriptor listing
//!
//! Wraps `lsof` for listing open network file descriptors,
//! useful for identifying which processes hold network connections.

use crate::types::*;

/// Build `lsof -i` arguments for network fd listing.
pub fn build_lsof_inet_args(protocol: Option<&str>, port: Option<u16>) -> Vec<String> {
    let mut args = vec!["-n".to_string(), "-P".to_string()];
    match (protocol, port) {
        (Some(proto), Some(p)) => args.push(format!("-i{}:{}", proto, p)),
        (Some(proto), None) => args.push(format!("-i{}", proto)),
        (None, Some(p)) => args.push(format!("-i:{}", p)),
        (None, None) => args.push("-i".to_string()),
    }
    args
}

/// Build `lsof -p <pid>` arguments for process fd listing.
pub fn build_lsof_pid_args(pid: u32) -> Vec<String> {
    vec![
        "-n".to_string(),
        "-P".to_string(),
        "-p".to_string(),
        pid.to_string(),
    ]
}

/// Parse lsof output into `NetworkFd` entries.
pub fn parse_lsof_output(output: &str) -> Vec<NetworkFd> {
    let mut results = Vec::new();
    let mut lines = output.lines();

    // Skip header line(s) starting with "COMMAND"
    if let Some(header) = lines.next() {
        if !header.starts_with("COMMAND") {
            // Not expected format
            return results;
        }
    } else {
        return results;
    }

    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // lsof columns are whitespace-delimited, but COMMAND can be truncated
        // Fields: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
        // NAME may contain spaces (e.g., "*:22 (LISTEN)")
        let parts: Vec<&str> = line.splitn(9, char::is_whitespace).collect();
        if parts.len() < 9 {
            continue;
        }

        let process_name = parts[0].to_string();
        let pid: u32 = match parts[1].trim().parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let user = parts[2].trim().to_string();
        let fd = parts[3].trim().to_string();
        let fd_type = parts[4].trim().to_string();
        // parts[5] = DEVICE, parts[6] = SIZE/OFF
        let node = parts[7].trim().to_string();
        let name = parts[8].trim().to_string();

        // Extract protocol from NODE (e.g., "TCP", "UDP")
        let protocol = if !node.is_empty() && node != "" {
            Some(node.clone())
        } else {
            None
        };

        // Parse NAME field for addresses and state
        // Formats:
        //   *:22 (LISTEN)
        //   192.168.1.1:443->10.0.0.1:12345 (ESTABLISHED)
        //   [::1]:8080->[::1]:54321 (ESTABLISHED)
        //   localhost:22 (LISTEN)
        let (local_addr, local_port, remote_addr, remote_port, state) = parse_lsof_name(&name);

        results.push(NetworkFd {
            pid,
            process_name,
            user,
            fd,
            fd_type,
            protocol,
            local_addr,
            local_port,
            remote_addr,
            remote_port,
            state,
            node: Some(node),
        });
    }

    results
}

/// Parse the NAME field from lsof output into address components and state.
fn parse_lsof_name(
    name: &str,
) -> (
    Option<String>,
    Option<u16>,
    Option<String>,
    Option<u16>,
    Option<String>,
) {
    // Extract state from parentheses at end, e.g. "(LISTEN)"
    let (addr_part, state) = if let Some(paren_start) = name.rfind('(') {
        let state_str = name[paren_start + 1..].trim_end_matches(')');
        (name[..paren_start].trim(), Some(state_str.to_string()))
    } else {
        (name.as_ref(), None)
    };

    // Split on "->" for local->remote
    let (local_str, remote_str) = if let Some(arrow_pos) = addr_part.find("->") {
        (&addr_part[..arrow_pos], Some(&addr_part[arrow_pos + 2..]))
    } else {
        (addr_part, None)
    };

    let (local_addr, local_port) = split_addr_port(local_str.trim());
    let (remote_addr, remote_port) = match remote_str {
        Some(r) => split_addr_port(r.trim()),
        None => (None, None),
    };

    (local_addr, local_port, remote_addr, remote_port, state)
}

/// Split an address:port string. Handles IPv6 bracket notation.
fn split_addr_port(s: &str) -> (Option<String>, Option<u16>) {
    if s.is_empty() {
        return (None, None);
    }

    // IPv6 bracket notation: [::1]:port
    if s.starts_with('[') {
        if let Some(bracket_end) = s.find(']') {
            let addr = s[1..bracket_end].to_string();
            let port = if bracket_end + 1 < s.len() && s.as_bytes()[bracket_end + 1] == b':' {
                s[bracket_end + 2..].parse::<u16>().ok()
            } else {
                None
            };
            return (Some(addr), port);
        }
    }

    // Regular addr:port — split on last ':'
    if let Some(colon_pos) = s.rfind(':') {
        let addr_str = &s[..colon_pos];
        let port_str = &s[colon_pos + 1..];
        let port = port_str.parse::<u16>().ok();
        let addr = if addr_str == "*" {
            Some("*".to_string())
        } else {
            Some(addr_str.to_string())
        };
        (addr, port)
    } else {
        (Some(s.to_string()), None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inet_all() {
        let args = build_lsof_inet_args(None, None);
        assert!(args.contains(&"-i".to_string()));
    }

    #[test]
    fn inet_tcp_port() {
        let args = build_lsof_inet_args(Some("tcp"), Some(80));
        assert!(args.contains(&"-itcp:80".to_string()));
    }

    #[test]
    fn by_pid() {
        let args = build_lsof_pid_args(1234);
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"1234".to_string()));
    }
}
