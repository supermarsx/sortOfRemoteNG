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
pub fn parse_ss_output(_output: &str) -> Vec<SocketEntry> {
    // TODO: implement
    Vec::new()
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
