//! # bandwidth — Real-time bandwidth monitoring
//!
//! Wraps `nload`, `iftop`, `bmon`, and `/proc/net/dev` for monitoring
//! per-interface and per-connection bandwidth usage.

use crate::types::*;

/// Read `/proc/net/dev` counters for a given interface.
/// Returns (rx_bytes, tx_bytes) or None if interface not found.
pub fn parse_proc_net_dev(content: &str, interface: &str) -> Option<(u64, u64)> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(&format!("{}:", interface)) {
            let fields: Vec<&str> = rest.split_whitespace().collect();
            if fields.len() >= 9 {
                let rx = fields[0].parse::<u64>().ok()?;
                let tx = fields[8].parse::<u64>().ok()?;
                return Some((rx, tx));
            }
        }
    }
    None
}

/// Build `nload -t 1000 -u M <interface>` arguments.
pub fn build_nload_args(interface: &str) -> Vec<String> {
    vec!["-t".to_string(), "1000".to_string(), "-u".to_string(), "M".to_string(), interface.to_string()]
}

/// Build `iftop -n -t -s 1 -i <interface>` arguments.
pub fn build_iftop_args(interface: &str) -> Vec<String> {
    vec!["-n".to_string(), "-t".to_string(), "-s".to_string(), "1".to_string(), "-i".to_string(), interface.to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_proc_net_dev_found() {
        let content = r#"Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 12345     100    0    0    0     0          0         0 67890     200    0    0    0     0       0          0
  eth0: 9876543  5000    0    0    0     0          0         0 1234567  3000    0    0    0     0       0          0"#;
        let (rx, tx) = parse_proc_net_dev(content, "eth0").unwrap();
        assert_eq!(rx, 9876543);
        assert_eq!(tx, 1234567);
    }

    #[test]
    fn parse_proc_net_dev_not_found() {
        let content = "  lo: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0";
        assert!(parse_proc_net_dev(content, "eth0").is_none());
    }

    #[test]
    fn nload_args() {
        let args = build_nload_args("eth0");
        assert!(args.contains(&"eth0".to_string()));
    }
}
