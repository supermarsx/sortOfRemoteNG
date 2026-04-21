//! # netstat — Socket / connection listing (netstat / ss)
//!
//! Wraps `ss` (or `netstat`) for listing active sockets, connections,
//! and listening ports with filtering by state and protocol.

use crate::types::*;

/// Build `ss` arguments for socket listing.
pub fn build_ss_args(listening_only: bool, tcp: bool, udp: bool, numeric: bool) -> Vec<String> {
    let mut args = Vec::new();
    if listening_only {
        args.push("-l".to_string());
    }
    if tcp {
        args.push("-t".to_string());
    }
    if udp {
        args.push("-u".to_string());
    }
    if numeric {
        args.push("-n".to_string());
    }
    args.push("-p".to_string()); // show process
    args
}

/// Build `netstat` arguments (fallback for non-Linux systems).
pub fn build_netstat_args(listening_only: bool, tcp: bool, numeric: bool) -> Vec<String> {
    let mut args = vec!["-a".to_string()];
    if listening_only {
        args.push("-l".to_string());
    }
    if tcp {
        args.push("-t".to_string());
    }
    if numeric {
        args.push("-n".to_string());
    }
    args.push("-p".to_string());
    args
}

/// Parse ss output into `SocketEntry` structs.
pub fn parse_ss_output(output: &str) -> Vec<SocketEntry> {
    let mut entries = Vec::new();
    let mut lines = output.lines();

    // Skip header line
    if lines.next().is_none() {
        return entries;
    }

    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Fields are whitespace-separated; the last field (process) may contain spaces
        // Format: State Recv-Q Send-Q Local_Address:Port Peer_Address:Port Process
        let fields: Vec<&str> = trimmed.splitn(6, char::is_whitespace).collect();
        // Filter out empty fields from multiple spaces
        let fields: Vec<&str> = fields
            .iter()
            .map(|f| f.trim())
            .filter(|f| !f.is_empty())
            .collect();

        if fields.len() < 5 {
            continue;
        }

        let state = match fields[0].to_uppercase().as_str() {
            "ESTAB" | "ESTABLISHED" => SocketState::Established,
            "SYN-SENT" => SocketState::SynSent,
            "SYN-RECV" => SocketState::SynRecv,
            "FIN-WAIT-1" => SocketState::FinWait1,
            "FIN-WAIT-2" => SocketState::FinWait2,
            "TIME-WAIT" => SocketState::TimeWait,
            "CLOSE" | "UNCONN" => SocketState::Close,
            "CLOSE-WAIT" => SocketState::CloseWait,
            "LAST-ACK" => SocketState::LastAck,
            "LISTEN" => SocketState::Listen,
            "CLOSING" => SocketState::Closing,
            _ => SocketState::Unknown,
        };

        let recv_queue: u64 = fields[1].parse().unwrap_or(0);
        let send_queue: u64 = fields[2].parse().unwrap_or(0);

        // Parse local address:port
        let (local_addr, local_port) = parse_addr_port(fields[3]);
        // Parse peer address:port
        let (remote_addr_str, remote_port_val) = parse_addr_port(fields[4]);

        let remote_addr = if remote_addr_str == "*" || remote_addr_str.is_empty() {
            None
        } else {
            Some(remote_addr_str)
        };
        let remote_port = if remote_port_val == 0 && fields[4].contains('*') {
            None
        } else {
            Some(remote_port_val)
        };

        // Parse process info from remaining text: users:(("sshd",pid=1234,fd=3))
        let mut pid: Option<u32> = None;
        let mut process_name: Option<String> = None;

        if fields.len() > 5 {
            let proc_info = fields[5];
            // Extract process name: between ((" and "
            if let Some(start) = proc_info.find("((\"") {
                let after = &proc_info[start + 3..];
                if let Some(end) = after.find('"') {
                    process_name = Some(after[..end].to_string());
                }
            }
            // Extract pid: "pid=1234"
            if let Some(pid_start) = proc_info.find("pid=") {
                let after = &proc_info[pid_start + 4..];
                let pid_str: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
                pid = pid_str.parse().ok();
            }
        }

        // Determine protocol from local address format
        let protocol = if local_addr.contains(':') && local_addr.matches(':').count() > 1 {
            // IPv6 address
            if state == SocketState::Close {
                SocketProtocol::Udp6
            } else {
                SocketProtocol::Tcp6
            }
        } else if state == SocketState::Close {
            SocketProtocol::Udp
        } else {
            SocketProtocol::Tcp
        };

        entries.push(SocketEntry {
            protocol,
            state,
            local_addr,
            local_port,
            remote_addr,
            remote_port,
            pid,
            process_name,
            user: None,
            inode: None,
            recv_queue,
            send_queue,
            timer: None,
        });
    }

    entries
}

/// Split an address:port string. Handles IPv4 "0.0.0.0:22" and IPv6 "[::]:22" or ":::22".
fn parse_addr_port(s: &str) -> (String, u16) {
    // Handle [addr]:port (bracketed IPv6)
    if s.starts_with('[') {
        if let Some(bracket_end) = s.find(']') {
            let addr = s[1..bracket_end].to_string();
            let port_str = if bracket_end + 1 < s.len() && s.as_bytes()[bracket_end + 1] == b':' {
                &s[bracket_end + 2..]
            } else {
                "0"
            };
            let port = port_str.parse().unwrap_or(0);
            return (addr, port);
        }
    }

    // Handle "*:*" or "0.0.0.0:*"
    if let Some(last_colon) = s.rfind(':') {
        let addr = &s[..last_colon];
        let port_str = &s[last_colon + 1..];
        let port = if port_str == "*" {
            0
        } else {
            port_str.parse().unwrap_or(0)
        };
        (addr.to_string(), port)
    } else {
        (s.to_string(), 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ss_listening_tcp() {
        let args = build_ss_args(true, true, false, true);
        assert!(args.contains(&"-l".to_string()));
        assert!(args.contains(&"-t".to_string()));
        assert!(args.contains(&"-n".to_string()));
    }
}
