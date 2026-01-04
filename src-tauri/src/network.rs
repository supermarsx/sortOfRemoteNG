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
