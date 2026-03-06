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
    vec!["-n".to_string(), "-P".to_string(), "-p".to_string(), pid.to_string()]
}

/// Parse lsof output into `NetworkFd` entries.
pub fn parse_lsof_output(_output: &str) -> Vec<NetworkFd> {
    // TODO: implement
    Vec::new()
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
