use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::process::Command;
use std::process::Stdio;

pub type NetworkServiceState = Arc<Mutex<NetworkService>>;

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