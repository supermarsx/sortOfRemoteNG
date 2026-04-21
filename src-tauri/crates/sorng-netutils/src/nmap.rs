//! # nmap — Nmap network scanner wrapper
//!
//! Wraps `nmap` for port scanning, service detection, OS fingerprinting,
//! and NSE script execution. Parses XML output for structured results.

use crate::types::*;
use chrono::DateTime;

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

/// Extract the value of an attribute from an XML tag string.
fn extract_attr<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
    let search = format!("{}=\"", attr);
    let start = tag.find(&search)? + search.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    Some(&rest[..end])
}

/// Parse nmap XML output into `NmapScanResult`.
pub fn parse_nmap_xml(xml: &str) -> Option<NmapScanResult> {
    // Extract <nmaprun> tag
    let nmaprun_start = xml.find("<nmaprun")?;
    let nmaprun_end = xml[nmaprun_start..].find('>')? + nmaprun_start;
    let nmaprun_tag = &xml[nmaprun_start..=nmaprun_end];

    let nmap_version = extract_attr(nmaprun_tag, "version").map(|s| s.to_string());
    let target = extract_attr(nmaprun_tag, "args")
        .and_then(|args| args.split_whitespace().last())
        .unwrap_or("")
        .to_string();

    let start_time = extract_attr(nmaprun_tag, "start")
        .and_then(|s| s.parse::<i64>().ok())
        .and_then(|t| DateTime::from_timestamp(t, 0))
        .unwrap_or_else(chrono::Utc::now);

    // Parse hosts
    let mut hosts = Vec::new();
    let mut search_from = 0;
    while let Some(host_offset) = xml[search_from..].find("<host") {
        let host_start = search_from + host_offset;
        let host_end = match xml[host_start..].find("</host>") {
            Some(e) => host_start + e + "</host>".len(),
            None => break,
        };
        let host_block = &xml[host_start..host_end];
        if let Some(host) = parse_nmap_host(host_block) {
            hosts.push(host);
        }
        search_from = host_end;
    }

    // Parse runstats
    let mut total_hosts_up = 0u32;
    let mut total_hosts_down = 0u32;
    let mut elapsed_ms = 0u64;

    if let Some(stats_start) = xml.find("<runstats>") {
        let stats_block = &xml[stats_start..];

        if let Some(finished_start) = stats_block.find("<finished") {
            if let Some(end) = stats_block[finished_start..]
                .find("/>")
                .or_else(|| stats_block[finished_start..].find('>'))
            {
                let finished_tag = &stats_block[finished_start..finished_start + end + 2];
                if let Some(elapsed_str) = extract_attr(finished_tag, "elapsed") {
                    if let Ok(secs) = elapsed_str.parse::<f64>() {
                        elapsed_ms = (secs * 1000.0) as u64;
                    }
                }
            }
        }

        if let Some(hosts_start) = stats_block.find("<hosts") {
            if let Some(end) = stats_block[hosts_start..]
                .find("/>")
                .or_else(|| stats_block[hosts_start..].find('>'))
            {
                let hosts_tag = &stats_block[hosts_start..hosts_start + end + 2];
                if let Some(up_str) = extract_attr(hosts_tag, "up") {
                    total_hosts_up = up_str.parse().unwrap_or(0);
                }
                if let Some(down_str) = extract_attr(hosts_tag, "down") {
                    total_hosts_down = down_str.parse().unwrap_or(0);
                }
            }
        }
    }

    Some(NmapScanResult {
        target,
        hosts,
        scan_type: NmapScanType::TcpSyn,
        started_at: start_time,
        duration_ms: elapsed_ms,
        total_hosts_up,
        total_hosts_down,
        nmap_version,
        xml_output: Some(xml.to_string()),
    })
}

fn parse_nmap_host(block: &str) -> Option<NmapHost> {
    // Status
    let status = if let Some(status_start) = block.find("<status") {
        let status_end = block[status_start..]
            .find("/>")
            .or_else(|| block[status_start..].find('>'))?;
        let status_tag = &block[status_start..status_start + status_end + 2];
        match extract_attr(status_tag, "state") {
            Some("up") => NmapHostStatus::Up,
            Some("down") => NmapHostStatus::Down,
            _ => NmapHostStatus::Unknown,
        }
    } else {
        NmapHostStatus::Unknown
    };

    // Primary address (first <address>)
    let ip = if let Some(addr_start) = block.find("<address") {
        let addr_end = block[addr_start..]
            .find("/>")
            .or_else(|| block[addr_start..].find('>'))?;
        let addr_tag = &block[addr_start..addr_start + addr_end + 2];
        extract_attr(addr_tag, "addr").unwrap_or("").to_string()
    } else {
        return None;
    };

    // MAC address (second <address> with addrtype="mac")
    let mut mac_address = None;
    let mut mac_vendor = None;
    if let Some(first_addr) = block.find("<address") {
        let after_first = first_addr + 1;
        if let Some(second_offset) = block[after_first..].find("<address") {
            let addr_start = after_first + second_offset;
            if let Some(end) = block[addr_start..]
                .find("/>")
                .or_else(|| block[addr_start..].find('>'))
            {
                let addr_tag = &block[addr_start..addr_start + end + 2];
                if extract_attr(addr_tag, "addrtype") == Some("mac") {
                    mac_address = extract_attr(addr_tag, "addr").map(|s| s.to_string());
                    mac_vendor = extract_attr(addr_tag, "vendor").map(|s| s.to_string());
                }
            }
        }
    }

    // Hostnames
    let mut hostnames = Vec::new();
    let mut hn_search = 0;
    while let Some(hn_offset) = block[hn_search..].find("<hostname") {
        let hn_start = hn_search + hn_offset;
        if let Some(end) = block[hn_start..]
            .find("/>")
            .or_else(|| block[hn_start..].find('>'))
        {
            let hn_tag = &block[hn_start..hn_start + end + 2];
            if let Some(name) = extract_attr(hn_tag, "name") {
                hostnames.push(name.to_string());
            }
        }
        hn_search = hn_start + 1;
    }

    // Ports
    let mut ports = Vec::new();
    let mut port_search = 0;
    while let Some(port_offset) = block[port_search..].find("<port ") {
        let port_start = port_search + port_offset;
        let port_block_end = block[port_start..]
            .find("</port>")
            .map(|e| port_start + e + "</port>".len())
            .or_else(|| {
                block[port_start + 1..]
                    .find("<port ")
                    .map(|e| port_start + 1 + e)
            })
            .unwrap_or(block.len());
        let port_block = &block[port_start..port_block_end];
        if let Some(port) = parse_nmap_port(port_block) {
            ports.push(port);
        }
        port_search = port_block_end;
    }

    Some(NmapHost {
        ip,
        hostnames,
        status,
        ports,
        os_matches: Vec::new(),
        mac_address,
        mac_vendor,
        distance_hops: None,
        uptime_seconds: None,
        scripts: Vec::new(),
    })
}

fn parse_nmap_port(block: &str) -> Option<NmapPort> {
    let port_tag_end = block.find('>')?;
    let port_tag = &block[..port_tag_end + 1];

    let portid = extract_attr(port_tag, "portid")?.parse::<u16>().ok()?;
    let protocol = match extract_attr(port_tag, "protocol") {
        Some("tcp") => PortProtocol::Tcp,
        Some("udp") => PortProtocol::Udp,
        Some("sctp") => PortProtocol::Sctp,
        _ => PortProtocol::Tcp,
    };

    // State
    let (state, reason) = if let Some(state_start) = block.find("<state") {
        let state_end = block[state_start..]
            .find("/>")
            .or_else(|| block[state_start..].find('>'))?;
        let state_tag = &block[state_start..state_start + state_end + 2];
        let st = match extract_attr(state_tag, "state") {
            Some("open") => NmapPortState::Open,
            Some("closed") => NmapPortState::Closed,
            Some("filtered") => NmapPortState::Filtered,
            Some("unfiltered") => NmapPortState::Unfiltered,
            Some("open|filtered") => NmapPortState::OpenFiltered,
            Some("closed|filtered") => NmapPortState::ClosedFiltered,
            _ => NmapPortState::Filtered,
        };
        let reason = extract_attr(state_tag, "reason").map(|s| s.to_string());
        (st, reason)
    } else {
        (NmapPortState::Filtered, None)
    };

    // Service
    let (service_name, service_product, service_version, service_extra) =
        if let Some(svc_start) = block.find("<service") {
            let svc_end = block[svc_start..]
                .find("/>")
                .or_else(|| block[svc_start..].find('>'))?;
            let svc_tag = &block[svc_start..svc_start + svc_end + 2];
            (
                extract_attr(svc_tag, "name").map(|s| s.to_string()),
                extract_attr(svc_tag, "product").map(|s| s.to_string()),
                extract_attr(svc_tag, "version").map(|s| s.to_string()),
                extract_attr(svc_tag, "extrainfo").map(|s| s.to_string()),
            )
        } else {
            (None, None, None, None)
        };

    Some(NmapPort {
        port: portid,
        protocol,
        state,
        service_name,
        service_product,
        service_version,
        service_extra,
        scripts: Vec::new(),
        reason,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

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
