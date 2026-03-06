//! # tcpdump — Packet capture wrapper
//!
//! Wraps `tcpdump` for live packet capture with BPF filters,
//! pcap file export, and capture session management.

use crate::types::*;

/// Build `tcpdump` arguments from a capture configuration.
pub fn build_tcpdump_args(config: &CaptureConfig) -> Vec<String> {
    let mut args = Vec::new();
    args.push("-i".to_string());
    args.push(config.interface.clone());

    if config.promiscuous {
        // default behavior for tcpdump
    } else {
        args.push("-p".to_string());
    }

    if let Some(count) = config.packet_count {
        args.push("-c".to_string());
        args.push(count.to_string());
    }

    if let Some(ref snap) = config.snap_len {
        args.push("-s".to_string());
        args.push(snap.to_string());
    }

    if let Some(ref output) = config.output_file {
        args.push("-w".to_string());
        args.push(output.clone());
    }

    if !config.resolve_names {
        args.push("-nn".to_string());
    }

    if let Some(ref filter) = config.filter {
        args.push(filter.clone());
    }

    args
}

/// Build `tcpdump -r <file>` arguments for reading a pcap.
pub fn build_read_pcap_args(file: &str, filter: Option<&str>) -> Vec<String> {
    let mut args = vec!["-r".to_string(), file.to_string(), "-nn".to_string()];
    if let Some(f) = filter {
        args.push(f.to_string());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_capture() {
        let cfg = CaptureConfig {
            id: "cap1".to_string(),
            interface: "eth0".to_string(),
            filter: Some("port 80".to_string()),
            promiscuous: true,
            snap_len: None,
            packet_count: Some(100),
            duration_secs: None,
            output_file: Some("/tmp/cap.pcap".to_string()),
            resolve_names: false,
            buffer_size: None,
        };
        let args = build_tcpdump_args(&cfg);
        assert!(args.contains(&"eth0".to_string()));
        assert!(args.contains(&"-c".to_string()));
        assert!(args.contains(&"-nn".to_string()));
        assert!(args.contains(&"port 80".to_string()));
    }
}
