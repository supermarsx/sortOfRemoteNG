//! # nmap — Nmap network scanner wrapper
//!
//! Wraps `nmap` for port scanning, service detection, OS fingerprinting,
//! and NSE script execution. Parses XML output for structured results.

use crate::types::*;

/// Build nmap command arguments.
pub fn build_nmap_args(target: &str, opts: &NmapOptions) -> Vec<String> {
    let mut args = vec!["-oX".to_string(), "-".to_string()]; // XML to stdout
    if opts.service_detection {
        args.push("-sV".to_string());
    }
    if opts.os_detection {
        args.push("-O".to_string());
    }
    if let Some(ref timing) = opts.timing {
        let flag = match timing {
            NmapTiming::Paranoid => "-T0",
            NmapTiming::Sneaky => "-T1",
            NmapTiming::Polite => "-T2",
            NmapTiming::Normal => "-T3",
            NmapTiming::Aggressive => "-T4",
            NmapTiming::Insane => "-T5",
        };
        args.push(flag.to_string());
    }
    if let Some(ref scan_type) = opts.scan_type {
        let flag = match scan_type {
            NmapScanType::TcpSyn => "-sS",
            NmapScanType::TcpConnect => "-sT",
            NmapScanType::TcpAck => "-sA",
            NmapScanType::Udp => "-sU",
            NmapScanType::TcpFin => "-sF",
            NmapScanType::TcpXmas => "-sX",
            NmapScanType::TcpNull => "-sN",
            NmapScanType::TcpWindow => "-sW",
            NmapScanType::SctpInit => "-sY",
            NmapScanType::SctpCookieEcho => "-sZ",
            NmapScanType::IpProtocol => "-sO",
            NmapScanType::Ping => "-sn",
            NmapScanType::ListScan => "-sL",
            NmapScanType::VersionDetect => "-sV",
            NmapScanType::OsDetect => "-O",
            NmapScanType::ScriptScan => "-sC",
        };
        args.push(flag.to_string());
    }
    if let Some(ref ports) = opts.ports {
        args.push("-p".to_string());
        args.push(ports.clone());
    }
    for script in &opts.scripts {
        args.push("--script".to_string());
        args.push(script.clone());
    }
    if let Some(IpVersion::V6) = opts.ip_version {
        args.push("-6".to_string());
    }
    args.push(target.to_string());
    args
}

/// Parse nmap XML output into `NmapScanResult`.
pub fn parse_nmap_xml(_xml: &str) -> Option<NmapScanResult> {
    // TODO: implement XML parsing
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_scan() {
        let opts = NmapOptions {
            scan_type: None,
            ports: Some("1-1000".to_string()),
            service_detection: true,
            os_detection: false,
            timing: Some(NmapTiming::Aggressive),
            scripts: Vec::new(),
            script_args: HashMap::new(),
            ip_version: None,
            top_ports: None,
            min_rate: None,
            max_rate: None,
            max_retries: None,
            interface: None,
            source_port: None,
            decoys: Vec::new(),
            privileged: false,
            host_timeout_ms: None,
        };
        let args = build_nmap_args("192.168.1.0/24", &opts);
        assert!(args.contains(&"-sV".to_string()));
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"192.168.1.0/24".to_string()));
    }

    #[test]
    fn nse_scripts() {
        let opts = NmapOptions {
            scan_type: None,
            ports: None,
            service_detection: false,
            os_detection: false,
            timing: None,
            scripts: vec!["vuln".to_string(), "http-enum".to_string()],
            script_args: HashMap::new(),
            ip_version: None,
            top_ports: None,
            min_rate: None,
            max_rate: None,
            max_retries: None,
            interface: None,
            source_port: None,
            decoys: Vec::new(),
            privileged: false,
            host_timeout_ms: None,
        };
        let args = build_nmap_args("10.0.0.1", &opts);
        assert!(args.iter().filter(|a| *a == "--script").count() == 2);
    }
}
