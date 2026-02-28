use std::sync::Arc;
use std::process::Command;
use tokio::sync::Mutex;
use tokio::task;
use serde::{Deserialize, Serialize};

pub type WolServiceState = Arc<Mutex<WolService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WolDevice {
    pub ip: String,
    pub mac: String,
    pub hostname: Option<String>,
    pub last_seen: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WolSchedule {
    pub id: String,
    pub mac_address: String,
    pub name: Option<String>,
    pub broadcast_address: String,
    pub port: u16,
    pub password: Option<String>,
    pub wake_time: String,
    pub recurrence: Option<String>,
    pub enabled: bool,
}

pub struct WolService {
    schedules: Vec<WolSchedule>,
}

impl WolService {
    pub fn new() -> WolServiceState {
        Arc::new(Mutex::new(WolService {
            schedules: Vec::new(),
        }))
    }

    /// Send a Wake-on-LAN magic packet in a dedicated thread
    /// Supports optional SecureOn password (6-byte password appended to packet)
    pub async fn wake_on_lan(&self, mac_address: String, broadcast_address: Option<String>, port: Option<u16>, password: Option<String>) -> Result<(), String> {
        // Spawn a blocking task to handle the UDP socket operation
        task::spawn_blocking(move || {
            let mac = mac_address.replace(":", "").replace("-", "");
            if mac.len() != 12 {
                return Err("Invalid MAC address".to_string());
            }
            let mac_bytes = (0..6).map(|i| u8::from_str_radix(&mac[i*2..i*2+2], 16).map_err(|_| "Invalid MAC".to_string())).collect::<Result<Vec<_>, _>>()?;
            
            // Create magic packet: 6 bytes of 0xFF + 16 repetitions of MAC
            let mut packet = vec![0xFF; 6];
            for _ in 0..16 {
                packet.extend(&mac_bytes);
            }
            
            // Add SecureOn password if provided (6 bytes)
            if let Some(pwd) = password {
                let pwd_clean = pwd.replace(":", "").replace("-", "");
                if pwd_clean.len() != 12 {
                    return Err("SecureOn password must be 6 bytes (12 hex characters)".to_string());
                }
                let pwd_bytes = (0..6).map(|i| u8::from_str_radix(&pwd_clean[i*2..i*2+2], 16).map_err(|_| "Invalid SecureOn password".to_string())).collect::<Result<Vec<_>, _>>()?;
                packet.extend(&pwd_bytes);
            }
            
            let broadcast = broadcast_address.unwrap_or_else(|| "255.255.255.255".to_string());
            let wol_port = port.unwrap_or(9);
            
            let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
            socket.set_broadcast(true).map_err(|e| e.to_string())?;
            socket.send_to(&packet, format!("{}:{}", broadcast, wol_port)).map_err(|e| e.to_string())?;
            
            Ok(())
        }).await.map_err(|e| format!("Task join error: {}", e))?
    }

    /// Wake multiple hosts in parallel, each in its own thread
    pub async fn wake_multiple(&self, mac_addresses: Vec<String>, broadcast_address: Option<String>, port: Option<u16>) -> Result<Vec<Result<(), String>>, String> {
        let broadcast = broadcast_address.unwrap_or_else(|| "255.255.255.255".to_string());
        let wol_port = port.unwrap_or(9);
        
        // Spawn a thread for each host
        let handles: Vec<_> = mac_addresses.into_iter().map(|mac_address| {
            let broadcast = broadcast.clone();
            task::spawn_blocking(move || {
                let mac = mac_address.replace(":", "").replace("-", "");
                if mac.len() != 12 {
                    return Err("Invalid MAC address".to_string());
                }
                let mac_bytes: Result<Vec<_>, _> = (0..6)
                    .map(|i| u8::from_str_radix(&mac[i*2..i*2+2], 16).map_err(|_| "Invalid MAC".to_string()))
                    .collect();
                let mac_bytes = mac_bytes?;
                
                // Create magic packet
                let mut packet = vec![0xFF; 6];
                for _ in 0..16 {
                    packet.extend(&mac_bytes);
                }
                
                let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
                socket.set_broadcast(true).map_err(|e| e.to_string())?;
                socket.send_to(&packet, format!("{}:{}", broadcast, wol_port)).map_err(|e| e.to_string())?;
                
                Ok(())
            })
        }).collect();
        
        // Wait for all threads to complete
        let mut results = Vec::new();
        for handle in handles {
            match handle.await {
                Ok(result) => results.push(result),
                Err(e) => results.push(Err(format!("Task join error: {}", e))),
            }
        }
        
        Ok(results)
    }

    /// Discover devices by scanning ARP table in a dedicated thread
    pub async fn discover_devices(&self) -> Result<Vec<WolDevice>, String> {
        task::spawn_blocking(|| {
            let mut devices = Vec::new();
            
            #[cfg(target_os = "windows")]
            {
                let output = Command::new("arp")
                    .arg("-a")
                    .output()
                    .map_err(|e| format!("Failed to execute arp command: {}", e))?;
                
                let stdout = String::from_utf8_lossy(&output.stdout);
                
                for line in stdout.lines() {
                    // Windows ARP output format: "  192.168.1.1       00-11-22-33-44-55     dynamic"
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        let ip = parts[0];
                        let mac = parts[1];
                        
                        // Validate IP and MAC format
                        if ip.contains('.') && (mac.contains('-') || mac.contains(':')) {
                            let normalized_mac = mac.replace("-", ":").to_lowercase();
                            if normalized_mac.len() == 17 {
                                devices.push(WolDevice {
                                    ip: ip.to_string(),
                                    mac: normalized_mac,
                                    hostname: None,
                                    last_seen: Some(chrono::Utc::now().to_rfc3339()),
                                });
                            }
                        }
                    }
                }
            }
            
            #[cfg(not(target_os = "windows"))]
            {
                let output = Command::new("arp")
                    .arg("-n")
                    .output()
                    .map_err(|e| format!("Failed to execute arp command: {}", e))?;
                
                let stdout = String::from_utf8_lossy(&output.stdout);
                
                for line in stdout.lines().skip(1) {
                    // Linux ARP output format: "Address    HWtype  HWaddress          Flags Mask    Iface"
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        let ip = parts[0];
                        let mac = parts[2];
                        
                        if ip.contains('.') && mac.contains(':') && mac.len() == 17 {
                            devices.push(WolDevice {
                                ip: ip.to_string(),
                                mac: mac.to_lowercase(),
                                hostname: None,
                                last_seen: Some(chrono::Utc::now().to_rfc3339()),
                            });
                        }
                    }
                }
            }
            
            // Try to resolve hostnames in parallel for efficiency
            let device_ips: Vec<String> = devices.iter().map(|d| d.ip.clone()).collect();
            let hostname_handles: Vec<_> = device_ips.into_iter().map(|ip| {
                std::thread::spawn(move || {
                    if let Ok(output) = Command::new("nslookup")
                        .arg(&ip)
                        .output()
                    {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        for line in stdout.lines() {
                            if line.contains("name =") || line.contains("Name:") {
                                if let Some(name) = line.split(['=', ':']).last() {
                                    let name = name.trim().trim_end_matches('.');
                                    if !name.is_empty() {
                                        return Some(name.to_string());
                                    }
                                }
                                break;
                            }
                        }
                    }
                    None
                })
            }).collect();
            
            // Collect hostname results
            for (device, handle) in devices.iter_mut().zip(hostname_handles) {
                if let Ok(hostname) = handle.join() {
                    device.hostname = hostname;
                }
            }
            
            Ok(devices)
        }).await.map_err(|e| format!("Task join error: {}", e))?
    }

    /// Add a WOL schedule
    pub fn add_schedule(&mut self, schedule: WolSchedule) -> Result<String, String> {
        let id = schedule.id.clone();
        self.schedules.push(schedule);
        Ok(id)
    }

    /// Remove a WOL schedule
    pub fn remove_schedule(&mut self, schedule_id: &str) -> Result<(), String> {
        let initial_len = self.schedules.len();
        self.schedules.retain(|s| s.id != schedule_id);
        if self.schedules.len() == initial_len {
            Err("Schedule not found".to_string())
        } else {
            Ok(())
        }
    }

    /// List all schedules
    pub fn list_schedules(&self) -> Vec<WolSchedule> {
        self.schedules.clone()
    }

    /// Update a schedule
    pub fn update_schedule(&mut self, schedule: WolSchedule) -> Result<(), String> {
        if let Some(existing) = self.schedules.iter_mut().find(|s| s.id == schedule.id) {
            *existing = schedule;
            Ok(())
        } else {
            Err("Schedule not found".to_string())
        }
    }
}

#[tauri::command]
pub async fn wake_on_lan(
    state: tauri::State<'_, WolServiceState>, 
    mac_address: String,
    broadcast_address: Option<String>,
    port: Option<u16>,
    password: Option<String>
) -> Result<(), String> {
    let wol = state.lock().await;
    wol.wake_on_lan(mac_address, broadcast_address, port, password).await
}

/// Wake multiple hosts in parallel, each in its own thread
#[tauri::command]
pub async fn wake_multiple_hosts(
    state: tauri::State<'_, WolServiceState>,
    mac_addresses: Vec<String>,
    broadcast_address: Option<String>,
    port: Option<u16>
) -> Result<Vec<Result<(), String>>, String> {
    let wol = state.lock().await;
    wol.wake_multiple(mac_addresses, broadcast_address, port).await
}

#[tauri::command]
pub async fn discover_wol_devices(state: tauri::State<'_, WolServiceState>) -> Result<Vec<WolDevice>, String> {
    let wol = state.lock().await;
    wol.discover_devices().await
}

#[tauri::command]
pub async fn add_wol_schedule(state: tauri::State<'_, WolServiceState>, schedule: WolSchedule) -> Result<String, String> {
    let mut wol = state.lock().await;
    wol.add_schedule(schedule)
}

#[tauri::command]
pub async fn remove_wol_schedule(state: tauri::State<'_, WolServiceState>, schedule_id: String) -> Result<(), String> {
    let mut wol = state.lock().await;
    wol.remove_schedule(&schedule_id)
}

#[tauri::command]
pub async fn list_wol_schedules(state: tauri::State<'_, WolServiceState>) -> Result<Vec<WolSchedule>, String> {
    let wol = state.lock().await;
    Ok(wol.list_schedules())
}

#[tauri::command]
pub async fn update_wol_schedule(state: tauri::State<'_, WolServiceState>, schedule: WolSchedule) -> Result<(), String> {
    let mut wol = state.lock().await;
    wol.update_schedule(schedule)
}