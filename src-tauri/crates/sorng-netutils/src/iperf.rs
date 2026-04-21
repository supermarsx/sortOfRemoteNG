//! # iperf — iperf3 bandwidth measurement wrapper
//!
//! Wraps `iperf3` for TCP/UDP throughput testing between a client
//! and server, with JSON output parsing.

use crate::types::*;
use chrono::DateTime;

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
pub fn parse_iperf_json(json: &str) -> Option<IperfResult> {
    let root: serde_json::Value = serde_json::from_str(json).ok()?;

    // Connection info from start.connected[0]
    let start = root.get("start")?;
    let connected = start.get("connected")?.as_array()?;
    let conn = connected.first()?;
    let host = conn.get("remote_host")?.as_str()?.to_string();
    let port = conn.get("remote_port")?.as_u64()? as u16;

    // Timestamp
    let timesecs = start.get("timestamp")?.get("timesecs")?.as_i64()?;
    let started_at = DateTime::from_timestamp(timesecs, 0)?;

    // Protocol
    let test_start = start.get("test_start");
    let protocol = match test_start
        .and_then(|ts| ts.get("protocol"))
        .and_then(|p| p.as_str())
    {
        Some("UDP") => IperfProtocol::Udp,
        _ => IperfProtocol::Tcp,
    };

    // Reverse
    let reverse = test_start
        .and_then(|ts| ts.get("reverse"))
        .and_then(|r| r.as_u64())
        .map(|r| r != 0)
        .unwrap_or(false);

    // Streams
    let streams = test_start
        .and_then(|ts| ts.get("num_streams"))
        .and_then(|n| n.as_u64())
        .unwrap_or(1) as u8;

    // Direction
    let direction = if test_start
        .and_then(|ts| ts.get("bidirectional"))
        .and_then(|b| b.as_u64())
        .unwrap_or(0)
        != 0
    {
        IperfDirection::Bidirectional
    } else if reverse {
        IperfDirection::Download
    } else {
        IperfDirection::Upload
    };

    // Parse intervals
    let intervals_arr = root.get("intervals")?.as_array()?;
    let intervals: Vec<IperfInterval> = intervals_arr
        .iter()
        .filter_map(|iv| {
            let sum = iv.get("sum")?;
            Some(IperfInterval {
                start_secs: sum.get("start")?.as_f64()?,
                end_secs: sum.get("end")?.as_f64()?,
                bytes: sum.get("bytes")?.as_u64()?,
                bits_per_sec: sum.get("bits_per_second")?.as_f64()?,
                retransmits: sum
                    .get("retransmits")
                    .and_then(|r| r.as_u64())
                    .map(|r| r as u32),
                cwnd_bytes: sum.get("snd_cwnd").and_then(|c| c.as_u64()),
                rtt_us: sum.get("rtt").and_then(|r| r.as_u64()),
                jitter_ms: sum.get("jitter_ms").and_then(|j| j.as_f64()),
                lost_packets: sum
                    .get("lost_packets")
                    .and_then(|l| l.as_u64())
                    .map(|l| l as u32),
                total_packets: sum
                    .get("packets")
                    .and_then(|p| p.as_u64())
                    .map(|p| p as u32),
            })
        })
        .collect();

    // Summary from end.sum_sent
    let end = root.get("end")?;
    let sum_sent = end.get("sum_sent")?;
    let cpu = end.get("cpu_utilization_percent");

    let summary = IperfSummary {
        bytes: sum_sent.get("bytes")?.as_u64()?,
        bits_per_sec: sum_sent.get("bits_per_second")?.as_f64()?,
        retransmits: sum_sent
            .get("retransmits")
            .and_then(|r| r.as_u64())
            .map(|r| r as u32),
        jitter_ms: sum_sent.get("jitter_ms").and_then(|j| j.as_f64()),
        lost_packets: sum_sent
            .get("lost_packets")
            .and_then(|l| l.as_u64())
            .map(|l| l as u32),
        lost_pct: sum_sent.get("lost_percent").and_then(|p| p.as_f64()),
        cpu_sender: cpu
            .and_then(|c| c.get("host_total"))
            .and_then(|v| v.as_f64()),
        cpu_receiver: cpu
            .and_then(|c| c.get("remote_total"))
            .and_then(|v| v.as_f64()),
    };

    let duration_secs = sum_sent
        .get("seconds")
        .and_then(|s| s.as_f64())
        .or_else(|| intervals.last().map(|iv| iv.end_secs))
        .unwrap_or(0.0);

    Some(IperfResult {
        host,
        port,
        protocol,
        direction,
        intervals,
        summary,
        started_at,
        duration_secs,
        streams,
        reverse,
    })
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
