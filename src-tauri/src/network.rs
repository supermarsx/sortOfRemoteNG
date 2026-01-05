use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::process::Command;
use std::process::Stdio;
use tokio::net::TcpStream;
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
    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(5));
    
    // Try to connect to the gateway
    let addr = format!("{}:80", gateway);
    match timeout(timeout_duration, TcpStream::connect(&addr)).await {
        Ok(Ok(_)) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(PingResult {
                success: true,
                time_ms: Some(elapsed),
                error: None,
            })
        }
        _ => {
            // TCP failed, try ICMP ping via system command
            let mut cmd = Command::new("ping");
            #[cfg(target_os = "windows")]
            cmd.arg("-n").arg("1").arg("-w").arg("1000");
            #[cfg(not(target_os = "windows"))]
            cmd.arg("-c").arg("1").arg("-W").arg("1");
            cmd.arg(&gateway)
               .stdout(Stdio::null())
               .stderr(Stdio::null());

            match cmd.status().await {
                Ok(status) if status.success() => {
                    let elapsed = start.elapsed().as_millis() as u64;
                    Ok(PingResult {
                        success: true,
                        time_ms: Some(elapsed),
                        error: None,
                    })
                }
                _ => Ok(PingResult {
                    success: false,
                    time_ms: None,
                    error: Some("Gateway not reachable".to_string()),
                })
            }
        }
    }
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
        Ok(Ok(_)) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(PortCheckResult {
                port,
                open: true,
                service,
                time_ms: Some(elapsed),
            })
        }
        _ => Ok(PortCheckResult {
            port,
            open: false,
            service,
            time_ms: None,
        })
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
            
            hops.push(hop);
            
            // Stop if we've reached the target (check if "Trace complete" or similar)
            if trimmed.contains("Trace complete") || hop.hop >= max_hops {
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
