use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::process::Command;
use std::process::Stdio;
use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::{timeout, Duration};
use dns_lookup::lookup_addr;
use mac_address::get_mac_address;
use serde::{Deserialize, Serialize};

pub type NetworkServiceState = Arc<Mutex<NetworkService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredHost {
    pub id: String,
    pub ip: String,
    pub hostname: Option<String>,
    pub mac: Option<String>,
    pub services: Vec<DiscoveredService>,
    pub last_seen: u64,
    pub response_time: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredService {
    pub port: u16,
    pub protocol: String,
    pub service_name: String,
    pub status: String,
}

pub struct NetworkService {
    // Placeholder
}

impl NetworkService {
    pub fn new() -> NetworkServiceState {
        Arc::new(Mutex::new(NetworkService {}))
    }

    pub async fn ping_host(&self, host: String) -> Result<bool, String> {
        // Use system ping command
        let mut cmd = Command::new("ping");
        cmd.arg("-n").arg("1")  // Windows: -n 1 (1 packet)
           .arg("-w").arg("1000")  // Windows: -w 1000 (1 second timeout)
           .arg(&host)
           .stdout(Stdio::null())
           .stderr(Stdio::null());

        let output = cmd.status().await
            .map_err(|e| format!("Failed to execute ping: {}", e))?;

        Ok(output.success())
    }

    pub async fn ping_host_with_timing(&self, host: String) -> Result<(bool, Option<u64>), String> {
        let start = std::time::Instant::now();
        let result = self.ping_host(host).await;
        let elapsed = start.elapsed().as_millis() as u64;

        match result {
            Ok(true) => Ok((true, Some(elapsed))),
            Ok(false) => Ok((false, None)),
            Err(e) => Err(e),
        }
    }

    pub async fn resolve_hostname(&self, ip: &str) -> Option<String> {
        match lookup_addr(&ip.parse().unwrap()) {
            Ok(hostname) => Some(hostname),
            Err(_) => None,
        }
    }

    pub async fn get_mac_address(&self, _ip: &str) -> Option<String> {
        // This is a simplified implementation
        // In a real implementation, you'd use ARP table lookup or send ARP requests
        match get_mac_address() {
            Ok(Some(ma)) => Some(ma.to_string()),
            _ => None,
        }
    }

    pub async fn scan_port(&self, ip: &str, port: u16) -> Result<bool, String> {
        let addr = format!("{}:{}", ip, port);
        match timeout(Duration::from_millis(1000), TcpStream::connect(&addr)).await {
            Ok(Ok(_)) => Ok(true),
            Ok(Err(_)) => Ok(false),
            Err(_) => Ok(false),
        }
    }

    pub fn get_common_ports() -> Vec<(u16, String)> {
        vec![
            (22, "ssh".to_string()),
            (23, "telnet".to_string()),
            (25, "smtp".to_string()),
            (53, "dns".to_string()),
            (80, "http".to_string()),
            (110, "pop3".to_string()),
            (143, "imap".to_string()),
            (443, "https".to_string()),
            (993, "imaps".to_string()),
            (995, "pop3s".to_string()),
            (3389, "rdp".to_string()),
            (5900, "vnc".to_string()),
            (3306, "mysql".to_string()),
            (5432, "postgresql".to_string()),
            (6379, "redis".to_string()),
        ]
    }

    pub async fn discover_services(&self, ip: &str, ports: Vec<u16>) -> Vec<DiscoveredService> {
        let mut services = Vec::new();

        for port in ports {
            if let Ok(true) = self.scan_port(ip, port).await {
                let service_name = NetworkService::get_common_ports()
                    .iter()
                    .find(|(p, _)| *p == port)
                    .map(|(_, name)| name.clone())
                    .unwrap_or_else(|| "unknown".to_string());

                services.push(DiscoveredService {
                    port,
                    protocol: "tcp".to_string(),
                    service_name,
                    status: "open".to_string(),
                });
            }
        }

        services
    }

    pub async fn scan_network_comprehensive(&self, subnet: String, scan_ports: bool) -> Result<Vec<DiscoveredHost>, String> {
        let mut discovered_hosts = Vec::new();

        // Parse subnet (e.g., "192.168.1.0/24" -> "192.168.1")
        let base_ip = if subnet.contains('/') {
            subnet.split('/').next().unwrap().to_string()
        } else {
            subnet.clone()
        };

        // Extract base IP parts
        let parts: Vec<&str> = base_ip.split('.').collect();
        if parts.len() != 4 {
            return Err("Invalid subnet format".to_string());
        }

        let base = format!("{}.{}.{}", parts[0], parts[1], parts[2]);
        let start_octet: u8 = parts[3].parse().unwrap_or(1);
        let end_octet: u8 = if subnet.contains("/24") { 254 } else { start_octet + 10 };

        // Scan IP range concurrently
        let mut handles = vec![];

        for i in start_octet..=end_octet {
            let ip = format!("{}.{}", base, i);
            let ip_clone = ip.clone();
            let scan_ports = scan_ports;

            let handle = tokio::spawn(async move {
                // Check if host is up
                let network_service = NetworkService::new();
                let network = network_service.lock().await;

                match network.ping_host_with_timing(ip_clone.clone()).await {
                    Ok((true, response_time)) => {
                        // Host is up, gather more info
                        let hostname = network.resolve_hostname(&ip_clone).await;
                        let mac = network.get_mac_address(&ip_clone).await;

                        let services = if scan_ports {
                            let common_ports: Vec<u16> = NetworkService::get_common_ports()
                                .iter()
                                .map(|(port, _)| *port)
                                .collect();
                            network.discover_services(&ip_clone, common_ports).await
                        } else {
                            Vec::new()
                        };

                        Some(DiscoveredHost {
                            id: uuid::Uuid::new_v4().to_string(),
                            ip: ip_clone,
                            hostname,
                            mac,
                            services,
                            last_seen: std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_secs(),
                            response_time,
                        })
                    },
                    _ => None,
                }
            });
            handles.push(handle);
        }

        // Wait for all scans to complete
        for handle in handles {
            if let Ok(Some(host)) = handle.await {
                discovered_hosts.push(host);
            }
        }

        Ok(discovered_hosts)
    }

    pub async fn scan_network(&self, subnet: String) -> Result<Vec<String>, String> {
        let mut results = Vec::new();

        // Parse subnet (e.g., "192.168.1.0/24" -> "192.168.1")
        let base_ip = if subnet.contains('/') {
            subnet.split('/').next().unwrap().to_string()
        } else {
            subnet.clone()
        };

        // Extract base IP parts
        let parts: Vec<&str> = base_ip.split('.').collect();
        if parts.len() != 4 {
            return Err("Invalid subnet format".to_string());
        }

        let base = format!("{}.{}.{}", parts[0], parts[1], parts[2]);
        let start_octet: u8 = parts[3].parse().unwrap_or(1);
        let end_octet: u8 = if subnet.contains("/24") { 254 } else { start_octet + 10 };

        // Scan IP range concurrently
        let mut handles = vec![];

        for i in start_octet..=end_octet {
            let ip = format!("{}.{}", base, i);
            let ip_clone = ip.clone();
            let handle = tokio::spawn(async move {
                // Simple ping check - in production, you'd want more sophisticated scanning
                let mut cmd = Command::new("ping");
                cmd.arg("-n").arg("1")
                   .arg("-w").arg("500")  // Shorter timeout for scanning
                   .arg(&ip_clone)
                   .stdout(Stdio::null())
                   .stderr(Stdio::null());

                match cmd.status().await {
                    Ok(status) if status.success() => Some(ip_clone),
                    _ => None,
                }
            });
            handles.push(handle);
        }

        // Wait for all ping operations to complete
        for handle in handles {
            if let Ok(Some(ip)) = handle.await {
                results.push(ip);
            }
        }

        Ok(results)
    }
}

#[tauri::command]
pub async fn ping_host(state: tauri::State<'_, NetworkServiceState>, host: String) -> Result<bool, String> {
    let network = state.lock().await;
    network.ping_host(host).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResult {
    pub success: bool,
    pub time_ms: Option<u64>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn ping_host_detailed(
    state: tauri::State<'_, NetworkServiceState>, 
    host: String,
    count: Option<u32>,
    timeout_secs: Option<u64>,
) -> Result<PingResult, String> {
    let network = state.lock().await;
    let start = std::time::Instant::now();
    
    match network.ping_host(host).await {
        Ok(success) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(PingResult {
                success,
                time_ms: if success { Some(elapsed) } else { None },
                error: None,
            })
        }
        Err(e) => Ok(PingResult {
            success: false,
            time_ms: None,
            error: Some(e),
        })
    }
}

#[tauri::command]
pub async fn ping_gateway(timeout_secs: Option<u64>) -> Result<PingResult, String> {
    // Try to get the default gateway
    let gateway = get_default_gateway()?;
    
    let start = std::time::Instant::now();
    let timeout_ms = (timeout_secs.unwrap_or(5) * 1000) as u32;
    
    // Use ICMP ping directly - gateways typically don't have TCP services open
    let mut cmd = Command::new("ping");
    #[cfg(target_os = "windows")]
    cmd.arg("-n").arg("1").arg("-w").arg(timeout_ms.to_string());
    #[cfg(not(target_os = "windows"))]
    cmd.arg("-c").arg("1").arg("-W").arg((timeout_secs.unwrap_or(5)).to_string());
    cmd.arg(&gateway)
       .stdout(Stdio::piped())
       .stderr(Stdio::null());

    match cmd.output().await {
        Ok(output) if output.status.success() => {
            // Try to parse ping time from output
            let stdout = String::from_utf8_lossy(&output.stdout);
            let time_ms = parse_ping_time(&stdout).unwrap_or(start.elapsed().as_millis() as u64);
            Ok(PingResult {
                success: true,
                time_ms: Some(time_ms),
                error: None,
            })
        }
        Ok(_) => Ok(PingResult {
            success: false,
            time_ms: None,
            error: Some(format!("Gateway {} not reachable via ICMP", gateway)),
        }),
        Err(e) => Ok(PingResult {
            success: false,
            time_ms: None,
            error: Some(format!("Ping command failed: {}", e)),
        })
    }
}

/// Parse ping time from ping command output
fn parse_ping_time(output: &str) -> Option<u64> {
    // Windows: "time=XXms" or "time<1ms"
    // Unix: "time=XX.X ms"
    for line in output.lines() {
        let line_lower = line.to_lowercase();
        if let Some(pos) = line_lower.find("time=") {
            let after_time = &line[pos + 5..];
            let num_str: String = after_time.chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if let Ok(ms) = num_str.parse::<f64>() {
                return Some(ms.round() as u64);
            }
        }
        if line_lower.contains("time<1ms") || line_lower.contains("time<1 ms") {
            return Some(1);
        }
    }
    None
}

fn get_default_gateway() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        // On Windows, use ipconfig
        let output = std::process::Command::new("ipconfig")
            .output()
            .map_err(|e| format!("Failed to get gateway: {}", e))?;
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            if line.contains("Default Gateway") && line.contains(":") {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() > 1 {
                    let gateway = parts[1].trim();
                    if !gateway.is_empty() && gateway.contains('.') {
                        return Ok(gateway.to_string());
                    }
                }
            }
        }
        Err("Could not find default gateway".to_string())
    }
    
    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("ip")
            .args(["route", "show", "default"])
            .output()
            .map_err(|e| format!("Failed to get gateway: {}", e))?;
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() > 2 && parts[0] == "default" {
                return Ok(parts[2].to_string());
            }
        }
        Err("Could not find default gateway".to_string())
    }
    
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("netstat")
            .args(["-nr"])
            .output()
            .map_err(|e| format!("Failed to get gateway: {}", e))?;
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            if line.starts_with("default") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() > 1 {
                    return Ok(parts[1].to_string());
                }
            }
        }
        Err("Could not find default gateway".to_string())
    }
    
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        Err("Gateway detection not supported on this platform".to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortCheckResult {
    pub port: u16,
    pub open: bool,
    pub service: Option<String>,
    pub time_ms: Option<u64>,
    pub banner: Option<String>,
}

#[tauri::command]
pub async fn check_port(
    host: String,
    port: u16,
    timeout_secs: Option<u64>,
) -> Result<PortCheckResult, String> {
    let start = std::time::Instant::now();
    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(5));
    let addr = format!("{}:{}", host, port);
    
    let service = NetworkService::get_common_ports()
        .iter()
        .find(|(p, _)| *p == port)
        .map(|(_, s)| s.clone());
    
    match timeout(timeout_duration, TcpStream::connect(&addr)).await {
        Ok(Ok(mut stream)) => {
            let elapsed = start.elapsed().as_millis() as u64;
            
            // Try to grab a banner (first ~128 bytes within 2 seconds)
            let banner = {
                let mut buf = vec![0u8; 128];
                let banner_timeout = Duration::from_secs(2);
                match timeout(banner_timeout, stream.read(&mut buf)).await {
                    Ok(Ok(n)) if n > 0 => {
                        // Convert to string, filter non-printable chars, take first 64 chars
                        let raw = String::from_utf8_lossy(&buf[..n]);
                        let cleaned: String = raw
                            .chars()
                            .filter(|c| c.is_ascii_graphic() || *c == ' ')
                            .take(64)
                            .collect();
                        if !cleaned.is_empty() {
                            Some(cleaned)
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            };
            
            Ok(PortCheckResult {
                port,
                open: true,
                service,
                time_ms: Some(elapsed),
                banner,
            })
        }
        _ => Ok(PortCheckResult {
            port,
            open: false,
            service,
            time_ms: None,
            banner: None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsResult {
    pub success: bool,
    pub resolved_ips: Vec<String>,
    pub reverse_dns: Option<String>,
    pub resolution_time_ms: u64,
    pub dns_server: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn dns_lookup(
    host: String,
    timeout_secs: Option<u64>,
) -> Result<DnsResult, String> {
    use std::net::ToSocketAddrs;
    
    let start = std::time::Instant::now();
    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(5));
    
    // Try to resolve hostname to IP addresses
    let resolve_result = tokio::task::spawn_blocking(move || {
        let addr_with_port = format!("{}:80", host);
        addr_with_port.to_socket_addrs()
            .map(|addrs| addrs.map(|a| a.ip().to_string()).collect::<Vec<_>>())
    });
    
    match timeout(timeout_duration, resolve_result).await {
        Ok(Ok(Ok(ips))) if !ips.is_empty() => {
            let elapsed = start.elapsed().as_millis() as u64;
            
            // Try reverse DNS on first IP
            let first_ip = ips.first().cloned();
            let reverse = if let Some(ref ip) = first_ip {
                if let Ok(addr) = ip.parse::<std::net::IpAddr>() {
                    lookup_addr(&addr).ok()
                } else {
                    None
                }
            } else {
                None
            };
            
            Ok(DnsResult {
                success: true,
                resolved_ips: ips,
                reverse_dns: reverse,
                resolution_time_ms: elapsed,
                dns_server: None,
                error: None,
            })
        }
        Ok(Ok(Ok(_))) => Ok(DnsResult {
            success: false,
            resolved_ips: vec![],
            reverse_dns: None,
            resolution_time_ms: start.elapsed().as_millis() as u64,
            dns_server: None,
            error: Some("No addresses found".to_string()),
        }),
        Ok(Ok(Err(e))) => Ok(DnsResult {
            success: false,
            resolved_ips: vec![],
            reverse_dns: None,
            resolution_time_ms: start.elapsed().as_millis() as u64,
            dns_server: None,
            error: Some(format!("DNS resolution failed: {}", e)),
        }),
        Ok(Err(_)) => Ok(DnsResult {
            success: false,
            resolved_ips: vec![],
            reverse_dns: None,
            resolution_time_ms: start.elapsed().as_millis() as u64,
            dns_server: None,
            error: Some("DNS lookup task failed".to_string()),
        }),
        Err(_) => Ok(DnsResult {
            success: false,
            resolved_ips: vec![],
            reverse_dns: None,
            resolution_time_ms: start.elapsed().as_millis() as u64,
            dns_server: None,
            error: Some("DNS lookup timed out".to_string()),
        }),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpClassification {
    pub ip: String,
    pub ip_type: String,         // "private", "public", "loopback", "link_local", "cgnat", "multicast"
    pub ip_class: Option<String>, // "A", "B", "C", "D", "E" for IPv4
    pub is_ipv6: bool,
    pub network_info: Option<String>,
}

#[tauri::command]
pub fn classify_ip(ip: String) -> Result<IpClassification, String> {
    use std::net::IpAddr;
    
    let addr: IpAddr = ip.parse()
        .map_err(|e| format!("Invalid IP address: {}", e))?;
    
    match addr {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            let first = octets[0];
            
            // Determine IP type
            let (ip_type, network_info) = if v4.is_loopback() {
                ("loopback", Some("127.0.0.0/8 - Loopback"))
            } else if v4.is_private() {
                let info = if first == 10 {
                    "10.0.0.0/8 - Class A Private"
                } else if first == 172 && (16..=31).contains(&octets[1]) {
                    "172.16.0.0/12 - Class B Private"
                } else {
                    "192.168.0.0/16 - Class C Private"
                };
                ("private", Some(info))
            } else if v4.is_link_local() {
                ("link_local", Some("169.254.0.0/16 - Link-Local (APIPA)"))
            } else if v4.is_multicast() {
                ("multicast", Some("224.0.0.0/4 - Multicast"))
            } else if v4.is_broadcast() {
                ("broadcast", Some("255.255.255.255 - Broadcast"))
            } else if first == 100 && (64..=127).contains(&octets[1]) {
                ("cgnat", Some("100.64.0.0/10 - Carrier-Grade NAT"))
            } else if first == 0 {
                ("reserved", Some("0.0.0.0/8 - Current Network"))
            } else {
                ("public", None)
            };
            
            // Determine IP class (legacy classful networking)
            let ip_class = if first < 128 {
                Some("A")
            } else if first < 192 {
                Some("B")
            } else if first < 224 {
                Some("C")
            } else if first < 240 {
                Some("D")
            } else {
                Some("E")
            };
            
            Ok(IpClassification {
                ip,
                ip_type: ip_type.to_string(),
                ip_class: ip_class.map(String::from),
                is_ipv6: false,
                network_info: network_info.map(String::from),
            })
        }
        IpAddr::V6(v6) => {
            let ip_type = if v6.is_loopback() {
                "loopback"
            } else if v6.is_multicast() {
                "multicast"
            } else if v6.is_unspecified() {
                "unspecified"
            } else {
                // Check for common IPv6 prefixes
                let segments = v6.segments();
                if segments[0] & 0xfe00 == 0xfc00 {
                    "private" // Unique local address (fc00::/7)
                } else if segments[0] & 0xffc0 == 0xfe80 {
                    "link_local" // Link-local (fe80::/10)
                } else {
                    "public"
                }
            };
            
            Ok(IpClassification {
                ip,
                ip_type: ip_type.to_string(),
                ip_class: None, // IPv6 doesn't use classful addressing
                is_ipv6: true,
                network_info: None,
            })
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteHop {
    pub hop: u32,
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub time_ms: Option<u64>,
    pub timeout: bool,
}

#[tauri::command]
pub async fn traceroute(
    host: String,
    max_hops: Option<u32>,
    timeout_secs: Option<u64>,
) -> Result<Vec<TracerouteHop>, String> {
    let max_hops = max_hops.unwrap_or(30);
    
    #[cfg(target_os = "windows")]
    let cmd_name = "tracert";
    #[cfg(not(target_os = "windows"))]
    let cmd_name = "traceroute";
    
    let mut cmd = Command::new(cmd_name);
    
    #[cfg(target_os = "windows")]
    {
        cmd.arg("-d") // Don't resolve hostnames (faster)
           .arg("-h").arg(max_hops.to_string())
           .arg("-w").arg((timeout_secs.unwrap_or(3) * 1000).to_string())
           .arg(&host);
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        cmd.arg("-n") // Don't resolve hostnames
           .arg("-m").arg(max_hops.to_string())
           .arg("-w").arg(timeout_secs.unwrap_or(3).to_string())
           .arg(&host);
    }
    
    let output = cmd.output().await
        .map_err(|e| format!("Failed to run traceroute: {}", e))?;
    
    let output_str = String::from_utf8_lossy(&output.stdout);
    let mut hops = Vec::new();
    
    for line in output_str.lines() {
        // Parse traceroute output - format varies by OS
        let trimmed = line.trim();
        
        // Skip empty lines and headers
        if trimmed.is_empty() || trimmed.starts_with("Tracing") || trimmed.starts_with("traceroute") {
            continue;
        }
        
        // Try to parse hop number
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        
        if let Ok(hop_num) = parts[0].parse::<u32>() {
            let mut hop = TracerouteHop {
                hop: hop_num,
                ip: None,
                hostname: None,
                time_ms: None,
                timeout: false,
            };
            
            // Check for timeout (asterisks)
            if trimmed.contains("*") && !trimmed.contains("ms") {
                hop.timeout = true;
            } else {
                // Try to find IP address
                for part in &parts[1..] {
                    // Check if it looks like an IP
                    if part.contains('.') && !part.contains("ms") {
                        let ip = part.trim_matches(|c| c == '(' || c == ')' || c == '[' || c == ']');
                        hop.ip = Some(ip.to_string());
                        break;
                    }
                }
                
                // Try to find timing
                for (i, part) in parts.iter().enumerate() {
                    if *part == "ms" || part.ends_with("ms") {
                        // Get the number before "ms"
                        let num_str = if *part == "ms" {
                            if i > 0 { parts[i - 1] } else { continue }
                        } else {
                            part.trim_end_matches("ms")
                        };
                        
                        if let Ok(time) = num_str.parse::<f64>() {
                            hop.time_ms = Some(time as u64);
                            break;
                        }
                    }
                }
            }
            
            let hop_num_check = hop.hop;
            hops.push(hop);
            
            // Stop if we've reached the target (check if "Trace complete" or similar)
            if trimmed.contains("Trace complete") || hop_num_check >= max_hops {
                break;
            }
        }
    }
    
    Ok(hops)
}

#[tauri::command]
pub async fn scan_network(state: tauri::State<'_, NetworkServiceState>, subnet: String) -> Result<Vec<String>, String> {
    let network = state.lock().await;
    network.scan_network(subnet).await
}

#[tauri::command]
pub async fn scan_network_comprehensive(state: tauri::State<'_, NetworkServiceState>, subnet: String, scan_ports: bool) -> Result<Vec<DiscoveredHost>, String> {
    let network = state.lock().await;
    network.scan_network_comprehensive(subnet, scan_ports).await
}

// ============================================================================
// Advanced Diagnostics
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpTimingResult {
    pub connect_time_ms: u64,
    pub syn_ack_time_ms: Option<u64>,
    pub total_time_ms: u64,
    pub success: bool,
    pub slow_connection: bool,
    pub error: Option<String>,
}

/// Measure TCP connection timing in detail
#[tauri::command]
pub async fn tcp_connection_timing(
    host: String,
    port: u16,
    timeout_secs: Option<u64>,
) -> Result<TcpTimingResult, String> {
    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(10));
    let addr = format!("{}:{}", host, port);
    
    let start = std::time::Instant::now();
    
    match timeout(timeout_duration, TcpStream::connect(&addr)).await {
        Ok(Ok(_stream)) => {
            let connect_time = start.elapsed().as_millis() as u64;
            
            // Connection time > 200ms is considered slow
            let slow = connect_time > 200;
            
            Ok(TcpTimingResult {
                connect_time_ms: connect_time,
                syn_ack_time_ms: Some(connect_time), // In async, these are effectively the same
                total_time_ms: connect_time,
                success: true,
                slow_connection: slow,
                error: None,
            })
        }
        Ok(Err(e)) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(TcpTimingResult {
                connect_time_ms: elapsed,
                syn_ack_time_ms: None,
                total_time_ms: elapsed,
                success: false,
                slow_connection: false,
                error: Some(format!("Connection failed: {}", e)),
            })
        }
        Err(_) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(TcpTimingResult {
                connect_time_ms: elapsed,
                syn_ack_time_ms: None,
                total_time_ms: elapsed,
                success: false,
                slow_connection: true,
                error: Some("Connection timed out".to_string()),
            })
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtuCheckResult {
    pub path_mtu: Option<u32>,
    pub fragmentation_needed: bool,
    pub recommended_mtu: u32,
    pub test_results: Vec<MtuTestPoint>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtuTestPoint {
    pub size: u32,
    pub success: bool,
}

/// Check MTU to host using ping with don't fragment flag
#[tauri::command]
pub async fn check_mtu(
    host: String,
) -> Result<MtuCheckResult, String> {
    let test_sizes = vec![1472, 1400, 1300, 1200, 1000, 576];
    let mut test_results = Vec::new();
    let mut largest_working = 576u32;
    let mut fragmentation_needed = false;
    
    for size in &test_sizes {
        let mut cmd = Command::new("ping");
        
        #[cfg(target_os = "windows")]
        {
            cmd.arg("-n").arg("1")
               .arg("-f")  // Don't fragment
               .arg("-l").arg(size.to_string())
               .arg("-w").arg("2000")
               .arg(&host);
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            cmd.arg("-c").arg("1")
               .arg("-M").arg("do")  // Don't fragment (Linux)
               .arg("-s").arg(size.to_string())
               .arg("-W").arg("2")
               .arg(&host);
        }
        
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        
        match cmd.output().await {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined = format!("{}{}", stdout, stderr).to_lowercase();
                
                // Check for fragmentation needed messages
                let needs_frag = combined.contains("fragmentation needed") 
                    || combined.contains("frag needed")
                    || combined.contains("message too long")
                    || combined.contains("packet needs to be fragmented");
                
                let success = output.status.success() && !needs_frag;
                
                if needs_frag {
                    fragmentation_needed = true;
                }
                
                if success && *size as u32 > largest_working {
                    largest_working = *size as u32;
                }
                
                test_results.push(MtuTestPoint {
                    size: *size as u32,
                    success,
                });
            }
            Err(_) => {
                test_results.push(MtuTestPoint {
                    size: *size as u32,
                    success: false,
                });
            }
        }
    }
    
    // Path MTU = largest working payload + 28 (IP header + ICMP header)
    let path_mtu = if largest_working > 576 {
        Some(largest_working + 28)
    } else {
        None
    };
    
    // Standard ethernet MTU is 1500, recommend 1400 for safe internet traversal
    let recommended = if largest_working >= 1472 {
        1500
    } else if largest_working >= 1400 {
        1428
    } else {
        largest_working + 28
    };
    
    Ok(MtuCheckResult {
        path_mtu,
        fragmentation_needed,
        recommended_mtu: recommended,
        test_results,
        error: None,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IcmpBlockadeResult {
    pub icmp_allowed: bool,
    pub tcp_reachable: bool,
    pub likely_blocked: bool,
    pub diagnosis: String,
}

/// Detect if ICMP is being blocked to a host
#[tauri::command]
pub async fn detect_icmp_blockade(
    host: String,
    port: Option<u16>,
) -> Result<IcmpBlockadeResult, String> {
    // First try ICMP ping
    let mut ping_cmd = Command::new("ping");
    
    #[cfg(target_os = "windows")]
    ping_cmd.arg("-n").arg("2").arg("-w").arg("2000").arg(&host);
    
    #[cfg(not(target_os = "windows"))]
    ping_cmd.arg("-c").arg("2").arg("-W").arg("2").arg(&host);
    
    ping_cmd.stdout(Stdio::null()).stderr(Stdio::null());
    
    let icmp_result = ping_cmd.status().await;
    let icmp_allowed = icmp_result.map(|s| s.success()).unwrap_or(false);
    
    // Try TCP connection to common ports or specified port
    let ports_to_try = if let Some(p) = port {
        vec![p]
    } else {
        vec![80, 443, 22]
    };
    
    let mut tcp_reachable = false;
    for p in ports_to_try {
        let addr = format!("{}:{}", host, p);
        if let Ok(Ok(_)) = timeout(Duration::from_secs(3), TcpStream::connect(&addr)).await {
            tcp_reachable = true;
            break;
        }
    }
    
    let (likely_blocked, diagnosis) = match (icmp_allowed, tcp_reachable) {
        (true, true) => (false, "Host fully reachable via ICMP and TCP".to_string()),
        (true, false) => (false, "ICMP allowed but TCP ports closed/filtered".to_string()),
        (false, true) => (true, "ICMP appears blocked - host reachable via TCP but not ping".to_string()),
        (false, false) => (false, "Host unreachable via both ICMP and TCP".to_string()),
    };
    
    Ok(IcmpBlockadeResult {
        icmp_allowed,
        tcp_reachable,
        likely_blocked,
        diagnosis,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsCheckResult {
    pub tls_supported: bool,
    pub tls_version: Option<String>,
    pub certificate_valid: bool,
    pub certificate_subject: Option<String>,
    pub certificate_issuer: Option<String>,
    pub certificate_expiry: Option<String>,
    pub handshake_time_ms: u64,
    pub error: Option<String>,
}

/// Check TLS/SSL handshake for a host
#[tauri::command]
pub async fn check_tls(
    host: String,
    port: Option<u16>,
) -> Result<TlsCheckResult, String> {
    let port = port.unwrap_or(443);
    let start = std::time::Instant::now();
    
    // Use openssl s_client or similar for TLS check
    #[cfg(target_os = "windows")]
    {
        // Try PowerShell TLS check
        let script = format!(
            r#"
            try {{
                $tcp = New-Object System.Net.Sockets.TcpClient
                $tcp.Connect('{}', {})
                $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, ({{$true}}))
                $ssl.AuthenticateAsClient('{}')
                $cert = $ssl.RemoteCertificate
                $cert2 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cert)
                @{{
                    TlsVersion = $ssl.SslProtocol.ToString()
                    Subject = $cert2.Subject
                    Issuer = $cert2.Issuer
                    Expiry = $cert2.NotAfter.ToString('o')
                    Valid = ($cert2.NotAfter -gt (Get-Date))
                }} | ConvertTo-Json
                $ssl.Close()
                $tcp.Close()
            }} catch {{
                @{{ Error = $_.Exception.Message }} | ConvertTo-Json
            }}
            "#,
            host, port, host
        );
        
        let mut cmd = Command::new("powershell");
        cmd.arg("-NoProfile")
           .arg("-Command")
           .arg(&script)
           .stdout(Stdio::piped())
           .stderr(Stdio::piped());
        
        match timeout(Duration::from_secs(10), cmd.output()).await {
            Ok(Ok(output)) => {
                let elapsed = start.elapsed().as_millis() as u64;
                let stdout = String::from_utf8_lossy(&output.stdout);
                
                // Try to parse JSON response
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    if let Some(err) = json.get("Error").and_then(|e| e.as_str()) {
                        return Ok(TlsCheckResult {
                            tls_supported: false,
                            tls_version: None,
                            certificate_valid: false,
                            certificate_subject: None,
                            certificate_issuer: None,
                            certificate_expiry: None,
                            handshake_time_ms: elapsed,
                            error: Some(err.to_string()),
                        });
                    }
                    
                    return Ok(TlsCheckResult {
                        tls_supported: true,
                        tls_version: json.get("TlsVersion").and_then(|v| v.as_str()).map(String::from),
                        certificate_valid: json.get("Valid").and_then(|v| v.as_bool()).unwrap_or(false),
                        certificate_subject: json.get("Subject").and_then(|v| v.as_str()).map(String::from),
                        certificate_issuer: json.get("Issuer").and_then(|v| v.as_str()).map(String::from),
                        certificate_expiry: json.get("Expiry").and_then(|v| v.as_str()).map(String::from),
                        handshake_time_ms: elapsed,
                        error: None,
                    });
                }
                
                Ok(TlsCheckResult {
                    tls_supported: false,
                    tls_version: None,
                    certificate_valid: false,
                    certificate_subject: None,
                    certificate_issuer: None,
                    certificate_expiry: None,
                    handshake_time_ms: elapsed,
                    error: Some("Failed to parse TLS response".to_string()),
                })
            }
            Ok(Err(e)) => Ok(TlsCheckResult {
                tls_supported: false,
                tls_version: None,
                certificate_valid: false,
                certificate_subject: None,
                certificate_issuer: None,
                certificate_expiry: None,
                handshake_time_ms: start.elapsed().as_millis() as u64,
                error: Some(format!("TLS check failed: {}", e)),
            }),
            Err(_) => Ok(TlsCheckResult {
                tls_supported: false,
                tls_version: None,
                certificate_valid: false,
                certificate_subject: None,
                certificate_issuer: None,
                certificate_expiry: None,
                handshake_time_ms: start.elapsed().as_millis() as u64,
                error: Some("TLS check timed out".to_string()),
            }),
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        // Use openssl s_client on Unix
        let mut cmd = Command::new("timeout");
        cmd.arg("10")
           .arg("openssl")
           .arg("s_client")
           .arg("-connect").arg(format!("{}:{}", host, port))
           .arg("-servername").arg(&host)
           .arg("-brief")
           .stdin(Stdio::null())
           .stdout(Stdio::piped())
           .stderr(Stdio::piped());
        
        match cmd.output().await {
            Ok(output) => {
                let elapsed = start.elapsed().as_millis() as u64;
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined = format!("{}\n{}", stdout, stderr);
                
                let tls_supported = combined.contains("CONNECTION ESTABLISHED") 
                    || combined.contains("Verification:") 
                    || output.status.success();
                
                // Extract TLS version
                let tls_version = if combined.contains("TLSv1.3") {
                    Some("TLS 1.3".to_string())
                } else if combined.contains("TLSv1.2") {
                    Some("TLS 1.2".to_string())
                } else if combined.contains("TLSv1.1") {
                    Some("TLS 1.1".to_string())
                } else if combined.contains("TLSv1") {
                    Some("TLS 1.0".to_string())
                } else {
                    None
                };
                
                Ok(TlsCheckResult {
                    tls_supported,
                    tls_version,
                    certificate_valid: combined.contains("Verification: OK"),
                    certificate_subject: None,
                    certificate_issuer: None,
                    certificate_expiry: None,
                    handshake_time_ms: elapsed,
                    error: if !tls_supported { Some("TLS connection failed".to_string()) } else { None },
                })
            }
            Err(e) => Ok(TlsCheckResult {
                tls_supported: false,
                tls_version: None,
                certificate_valid: false,
                certificate_subject: None,
                certificate_issuer: None,
                certificate_expiry: None,
                handshake_time_ms: start.elapsed().as_millis() as u64,
                error: Some(format!("TLS check failed: {}", e)),
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceFingerprint {
    pub port: u16,
    pub service: String,
    pub version: Option<String>,
    pub banner: Option<String>,
    pub protocol_detected: Option<String>,
    pub response_preview: Option<String>,
}

/// Enhanced service fingerprinting with protocol detection
#[tauri::command]
pub async fn fingerprint_service(
    host: String,
    port: u16,
) -> Result<ServiceFingerprint, String> {
    let addr = format!("{}:{}", host, port);
    let timeout_duration = Duration::from_secs(5);
    
    // Known service name
    let service_name = NetworkService::get_common_ports()
        .iter()
        .find(|(p, _)| *p == port)
        .map(|(_, s)| s.clone())
        .unwrap_or_else(|| "unknown".to_string());
    
    // Try to connect and probe
    match timeout(timeout_duration, TcpStream::connect(&addr)).await {
        Ok(Ok(mut stream)) => {
            let mut banner = None;
            let mut protocol_detected = None;
            let mut version = None;
            let mut response_preview = None;
            
            // Send protocol-specific probes based on port
            let probe_data: Option<&[u8]> = match port {
                80 | 8080 | 8000 | 8888 => Some(b"HEAD / HTTP/1.0\r\nHost: test\r\n\r\n"),
                443 | 8443 => None, // TLS ports - just connect
                21 => Some(b""), // FTP sends banner automatically
                22 => Some(b""), // SSH sends banner automatically  
                25 | 587 => Some(b"EHLO test\r\n"),
                110 => Some(b""), // POP3 sends banner automatically
                143 => Some(b""), // IMAP sends banner automatically
                3306 => Some(b""), // MySQL sends greeting
                5432 => Some(b"\x00\x00\x00\x08\x04\xd2\x16\x2f"), // PostgreSQL startup
                6379 => Some(b"PING\r\n"), // Redis
                _ => Some(b""),
            };
            
            // Send probe if any
            if let Some(probe) = probe_data {
                if !probe.is_empty() {
                    let _ = stream.write_all(probe).await;
                }
            }
            
            // Read response
            let mut buf = vec![0u8; 512];
            let read_timeout = Duration::from_secs(3);
            
            if let Ok(Ok(n)) = timeout(read_timeout, stream.read(&mut buf)).await {
                if n > 0 {
                    let raw = String::from_utf8_lossy(&buf[..n]);
                    
                    // Clean banner (printable chars only)
                    let cleaned: String = raw
                        .chars()
                        .filter(|c| c.is_ascii_graphic() || c.is_ascii_whitespace())
                        .take(128)
                        .collect();
                    
                    if !cleaned.trim().is_empty() {
                        banner = Some(cleaned.trim().to_string());
                    }
                    
                    // Detect protocol from response
                    let response_lower = raw.to_lowercase();
                    
                    if response_lower.contains("http/") {
                        protocol_detected = Some("HTTP".to_string());
                        // Try to extract server version
                        for line in raw.lines() {
                            if line.to_lowercase().starts_with("server:") {
                                version = Some(line[7..].trim().to_string());
                                break;
                            }
                        }
                    } else if response_lower.starts_with("ssh-") {
                        protocol_detected = Some("SSH".to_string());
                        version = raw.lines().next().map(|s| s.to_string());
                    } else if response_lower.contains("220") && (response_lower.contains("ftp") || response_lower.contains("smtp")) {
                        protocol_detected = Some(if response_lower.contains("ftp") { "FTP" } else { "SMTP" }.to_string());
                        version = raw.lines().next().map(|s| s.trim().to_string());
                    } else if response_lower.starts_with("+ok") || response_lower.starts_with("-err") {
                        protocol_detected = Some("POP3".to_string());
                    } else if response_lower.starts_with("* ok") {
                        protocol_detected = Some("IMAP".to_string());
                    } else if response_lower.contains("mysql") {
                        protocol_detected = Some("MySQL".to_string());
                    } else if response_lower.contains("postgresql") || buf[0] == b'R' {
                        protocol_detected = Some("PostgreSQL".to_string());
                    } else if response_lower.starts_with("+pong") || response_lower.starts_with("-") {
                        protocol_detected = Some("Redis".to_string());
                    }
                    
                    // Truncated preview
                    response_preview = Some(cleaned.chars().take(64).collect());
                }
            }
            
            Ok(ServiceFingerprint {
                port,
                service: service_name,
                version,
                banner,
                protocol_detected,
                response_preview,
            })
        }
        Ok(Err(e)) => Err(format!("Connection failed: {}", e)),
        Err(_) => Err("Connection timed out".to_string()),
    }
}
