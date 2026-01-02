use std::sync::Arc;
use tokio::sync::Mutex;

pub type WolServiceState = Arc<Mutex<WolService>>;

pub struct WolService {
    // Placeholder
}

impl WolService {
    pub fn new() -> WolServiceState {
        Arc::new(Mutex::new(WolService {}))
    }

    pub async fn wake_on_lan(&self, mac_address: String) -> Result<(), String> {
        let mac = mac_address.replace(":", "").replace("-", "");
        if mac.len() != 12 {
            return Err("Invalid MAC address".to_string());
        }
        let mac_bytes = (0..6).map(|i| u8::from_str_radix(&mac[i*2..i*2+2], 16).map_err(|_| "Invalid MAC".to_string())).collect::<Result<Vec<_>, _>>()?;
        
        let mut packet = vec![0xFF; 6];
        for _ in 0..16 {
            packet.extend(&mac_bytes);
        }
        
        let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
        socket.set_broadcast(true).map_err(|e| e.to_string())?;
        socket.send_to(&packet, "255.255.255.255:9").map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
pub async fn wake_on_lan(state: tauri::State<'_, WolServiceState>, mac_address: String) -> Result<(), String> {
    let wol = state.lock().await;
    wol.wake_on_lan(mac_address).await
}