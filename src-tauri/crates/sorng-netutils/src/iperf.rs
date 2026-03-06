//! # iperf — iperf3 bandwidth measurement wrapper
//!
//! Wraps `iperf3` for TCP/UDP throughput testing between a client
//! and server, with JSON output parsing.

use crate::types::*;

/// Build iperf3 client arguments.
pub fn build_iperf_client_args(server: &str, opts: &IperfOptions) -> Vec<String> {
    let mut args = vec!["-c".to_string(), server.to_string(), "--json".to_string()];
    if let Some(port) = opts.port {
        args.push("-p".to_string());
        args.push(port.to_string());
    }
    if let Some(dur) = opts.duration_secs {
        args.push("-t".to_string());
        args.push(dur.to_string());
    }
    if let Some(streams) = opts.streams {
        args.push("-P".to_string());
        args.push(streams.to_string());
    }
    if let Some(IperfProtocol::Udp) = opts.protocol {
        args.push("-u".to_string());
        if let Some(ref bw) = opts.bandwidth_limit {
            args.push("-b".to_string());
            args.push(bw.clone());
        }
    }
    if opts.reverse {
        args.push("-R".to_string());
    }
    args
}

/// Build iperf3 server arguments.
pub fn build_iperf_server_args(port: Option<u16>) -> Vec<String> {
    let mut args = vec!["-s".to_string(), "--json".to_string()];
    if let Some(p) = port {
        args.push("-p".to_string());
        args.push(p.to_string());
    }
    args
}

/// Parse iperf3 JSON output into `IperfResult`.
pub fn parse_iperf_json(_json: &str) -> Option<IperfResult> {
    // TODO: implement
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_args() {
        let opts = IperfOptions {
            port: Some(5201),
            duration_secs: Some(10),
            streams: Some(4),
            reverse: false,
            protocol: None,
            bandwidth_limit: None,
            interval_secs: None,
            window_size: None,
            mss: None,
            bidirectional: false,
            no_delay: false,
            json: true,
        };
        let args = build_iperf_client_args("10.0.0.1", &opts);
        assert!(args.contains(&"-c".to_string()));
        assert!(args.contains(&"10.0.0.1".to_string()));
        assert!(args.contains(&"-P".to_string()));
    }

    #[test]
    fn udp_mode() {
        let opts = IperfOptions {
            port: None,
            duration_secs: None,
            streams: None,
            reverse: false,
            protocol: Some(IperfProtocol::Udp),
            bandwidth_limit: Some("100M".to_string()),
            interval_secs: None,
            window_size: None,
            mss: None,
            bidirectional: false,
            no_delay: false,
            json: true,
        };
        let args = build_iperf_client_args("10.0.0.1", &opts);
        assert!(args.contains(&"-u".to_string()));
        assert!(args.contains(&"-b".to_string()));
    }
}
