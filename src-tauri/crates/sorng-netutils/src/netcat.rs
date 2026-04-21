//! # netcat — TCP/UDP probing wrapper
//!
//! Wraps `nc` (netcat) for TCP/UDP connectivity testing,
//! port scanning, and banner grabbing.

/// Build `nc` arguments for TCP connection test.
pub fn build_tcp_test_args(host: &str, port: u16, timeout_secs: Option<u32>) -> Vec<String> {
    let mut args = vec!["-z".to_string(), "-v".to_string()];
    if let Some(t) = timeout_secs {
        args.push("-w".to_string());
        args.push(t.to_string());
    }
    args.push(host.to_string());
    args.push(port.to_string());
    args
}

/// Build `nc` arguments for UDP connection test.
pub fn build_udp_test_args(host: &str, port: u16, timeout_secs: Option<u32>) -> Vec<String> {
    let mut args = vec!["-z".to_string(), "-v".to_string(), "-u".to_string()];
    if let Some(t) = timeout_secs {
        args.push("-w".to_string());
        args.push(t.to_string());
    }
    args.push(host.to_string());
    args.push(port.to_string());
    args
}

/// Build `nc` arguments for port range scan.
pub fn build_port_scan_args(host: &str, start_port: u16, end_port: u16) -> Vec<String> {
    vec![
        "-z".to_string(),
        "-v".to_string(),
        host.to_string(),
        format!("{}-{}", start_port, end_port),
    ]
}

/// Build `nc` arguments for banner grabbing.
pub fn build_banner_grab_args(host: &str, port: u16, timeout_secs: u32) -> Vec<String> {
    vec![
        "-w".to_string(),
        timeout_secs.to_string(),
        host.to_string(),
        port.to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tcp_test() {
        let args = build_tcp_test_args("10.0.0.1", 22, Some(5));
        assert!(args.contains(&"-z".to_string()));
        assert!(args.contains(&"-w".to_string()));
        assert!(!args.contains(&"-u".to_string()));
    }

    #[test]
    fn udp_test() {
        let args = build_udp_test_args("10.0.0.1", 53, None);
        assert!(args.contains(&"-u".to_string()));
    }

    #[test]
    fn port_scan() {
        let args = build_port_scan_args("10.0.0.1", 1, 1024);
        assert!(args.contains(&"1-1024".to_string()));
    }
}
