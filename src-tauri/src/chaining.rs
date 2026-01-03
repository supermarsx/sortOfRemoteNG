use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use tauri;

use crate::proxy::ProxyServiceState;
use crate::openvpn::OpenVPNServiceState;
use crate::wireguard::WireGuardServiceState;
use crate::zerotier::ZeroTierServiceState;
use crate::tailscale::TailscaleServiceState;

pub type ChainingServiceState = Arc<Mutex<ChainingService>>;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ConnectionType {
    Proxy,
    OpenVPN,
    WireGuard,
    IKEv2,
    SSTP,
    L2TP,
    PPTP,
    SoftEther,
    ZeroTier,
    Tailscale,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChainLayer {
    pub id: String,
    pub connection_type: ConnectionType,
    pub connection_id: String,
    pub position: usize,
    pub status: ChainLayerStatus,
    pub local_port: Option<u16>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ChainLayerStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConnectionChain {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub layers: Vec<ChainLayer>,
    pub status: ChainStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub final_local_port: Option<u16>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ChainStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

pub struct ChainingService {
    chains: HashMap<String, ConnectionChain>,
    proxy_service: ProxyServiceState,
    openvpn_service: OpenVPNServiceState,
    wireguard_service: WireGuardServiceState,
    zerotier_service: ZeroTierServiceState,
    tailscale_service: TailscaleServiceState,
}

impl ChainingService {
    pub fn new(
        proxy_service: ProxyServiceState,
        openvpn_service: OpenVPNServiceState,
        wireguard_service: WireGuardServiceState,
        zerotier_service: ZeroTierServiceState,
        tailscale_service: TailscaleServiceState,
    ) -> ChainingServiceState {
        Arc::new(Mutex::new(ChainingService {
            chains: HashMap::new(),
            proxy_service,
            openvpn_service,
            wireguard_service,
            zerotier_service,
            tailscale_service,
        }))
    }

    pub async fn create_chain(&mut self, name: String, description: Option<String>, layers: Vec<ChainLayer>) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();

        // Validate layers
        if layers.is_empty() {
            return Err("Chain must have at least one layer".to_string());
        }

        // Sort layers by position
        let mut sorted_layers = layers;
        sorted_layers.sort_by_key(|l| l.position);

        // Reassign positions to ensure continuity
        for (i, layer) in sorted_layers.iter_mut().enumerate() {
            layer.position = i;
        }

        let chain = ConnectionChain {
            id: id.clone(),
            name,
            description,
            layers: sorted_layers,
            status: ChainStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            final_local_port: None,
            error: None,
        };

        self.chains.insert(id.clone(), chain);
        Ok(id)
    }

    pub async fn connect_chain(&mut self, chain_id: &str) -> Result<(), String> {
        // Check if chain exists first
        if !self.chains.contains_key(chain_id) {
            return Err("Chain not found".to_string());
        }

        // Get layer info before any mutable borrows
        let layer_infos: Vec<(ConnectionType, String, u32)> = {
            let chain = &self.chains[chain_id];
            if let ChainStatus::Connected = chain.status {
                return Ok(());
            }
            chain.layers.iter().map(|l| (l.connection_type.clone(), l.connection_id.clone(), l.position as u32)).collect()
        };

        // Connect layers in order and collect results
        let mut layer_results = Vec::new();
        for (connection_type, connection_id, position) in layer_infos {
            let result = self.connect_layer_by_info(&connection_type, &connection_id).await;
            layer_results.push((connection_type, connection_id, position, result));
        }

        // Now update the chain status
        let chain = self.chains.get_mut(chain_id).unwrap();
        chain.status = ChainStatus::Connecting;
        chain.error = None;

        // Update each layer status
        for (connection_type, connection_id, position, result) in layer_results {
            let layer = chain.layers.iter_mut().find(|l| l.connection_type == connection_type && l.connection_id == connection_id).unwrap();
            match result {
                Ok(local_port) => {
                    layer.status = ChainLayerStatus::Connected;
                    layer.local_port = Some(local_port);
                    layer.error = None;
                }
                Err(e) => {
                    layer.status = ChainLayerStatus::Error(e.clone());
                    layer.error = Some(e.clone());
                    chain.status = ChainStatus::Error(format!("Layer {} failed: {}", position, e));
                    return Err(format!("Failed to connect chain layer {}: {}", position, e));
                }
            }
        }

        chain.status = ChainStatus::Connected;
        chain.connected_at = Some(Utc::now());

        // The final local port is from the last layer
        if let Some(last_layer) = chain.layers.last() {
            chain.final_local_port = last_layer.local_port;
        }

        Ok(())
    }

    pub async fn disconnect_chain(&mut self, chain_id: &str) -> Result<(), String> {
        // Check if chain exists first
        if !self.chains.contains_key(chain_id) {
            return Err("Chain not found".to_string());
        }

        // Get layer info before any mutable borrows
        let layer_infos: Vec<(ConnectionType, String, u32)> = {
            let chain = &self.chains[chain_id];
            if let ChainStatus::Disconnected = chain.status {
                return Ok(());
            }
            chain.layers.iter().rev().map(|l| (l.connection_type.clone(), l.connection_id.clone(), l.position as u32)).collect()
        };

        // Disconnect layers in reverse order and collect results
        let mut layer_results = Vec::new();
        for (connection_type, connection_id, position) in layer_infos {
            let result = self.disconnect_layer_by_info(&connection_type, &connection_id).await;
            layer_results.push((connection_type, connection_id, position, result));
        }

        // Now update the chain status
        let chain = self.chains.get_mut(chain_id).unwrap();
        chain.status = ChainStatus::Disconnecting;

        // Update each layer status
        for (connection_type, connection_id, position, result) in layer_results {
            let layer = chain.layers.iter_mut().find(|l| l.connection_type == connection_type && l.connection_id == connection_id).unwrap();
            match result {
                Ok(()) => {
                    layer.status = ChainLayerStatus::Disconnected;
                    layer.local_port = None;
                    layer.error = None;
                }
                Err(e) => {
                    layer.status = ChainLayerStatus::Error(e.clone());
                    layer.error = Some(e.clone());
                    chain.status = ChainStatus::Error(format!("Layer {} disconnect failed: {}", position, e));
                    return Err(format!("Failed to disconnect chain layer {}: {}", position, e));
                }
            }
        }

        chain.status = ChainStatus::Disconnected;
        chain.connected_at = None;
        chain.final_local_port = None;

        Ok(())
    }

    pub async fn get_chain(&self, chain_id: &str) -> Result<ConnectionChain, String> {
        self.chains.get(chain_id)
            .cloned()
            .ok_or_else(|| "Chain not found".to_string())
    }

    pub async fn list_chains(&self) -> Vec<ConnectionChain> {
        self.chains.values().cloned().collect()
    }

    pub async fn delete_chain(&mut self, chain_id: &str) -> Result<(), String> {
        if let Some(chain) = self.chains.get(chain_id) {
            if let ChainStatus::Connected = chain.status {
                self.disconnect_chain(chain_id).await?;
            }
        }

        self.chains.remove(chain_id);
        Ok(())
    }

    pub async fn update_chain_layers(&mut self, chain_id: &str, layers: Vec<ChainLayer>) -> Result<(), String> {
        let chain = self.chains.get_mut(chain_id)
            .ok_or_else(|| "Chain not found".to_string())?;

        // Can only update layers if chain is disconnected
        if let ChainStatus::Disconnected = chain.status {
            // Validate layers
            if layers.is_empty() {
                return Err("Chain must have at least one layer".to_string());
            }

            // Sort layers by position
            let mut sorted_layers = layers;
            sorted_layers.sort_by_key(|l| l.position);

            // Reassign positions to ensure continuity
            for (i, layer) in sorted_layers.iter_mut().enumerate() {
                layer.position = i;
            }

            chain.layers = sorted_layers;
            Ok(())
        } else {
            Err("Cannot update layers while chain is connected".to_string())
        }
    }

    async fn connect_layer(&self, layer: &ChainLayer) -> Result<u16, String> {
        match layer.connection_type {
            ConnectionType::Proxy => {
                // For proxy, we need to connect via proxy service
                // This assumes the proxy connection is already created
                let mut proxy_service = self.proxy_service.lock().await;
                proxy_service.connect_via_proxy(&layer.connection_id).await
            }
            ConnectionType::OpenVPN => {
                // Connect OpenVPN
                let mut openvpn_service = self.openvpn_service.lock().await;
                openvpn_service.connect(&layer.connection_id).await?;
                // Return a mock port for now - in real implementation, get from service
                Ok(1194 + layer.position as u16)
            }
            ConnectionType::WireGuard => {
                // Connect WireGuard
                let mut wireguard_service = self.wireguard_service.lock().await;
                wireguard_service.connect(&layer.connection_id).await?;
                Ok(51820 + layer.position as u16)
            }
            ConnectionType::IKEv2 => {
                // Call IKEv2 service (not implemented yet)
                Ok(500 + layer.position as u16)
            }
            ConnectionType::SSTP => {
                // Call SSTP service (not implemented yet)
                Ok(443 + layer.position as u16)
            }
            ConnectionType::L2TP => {
                // Call L2TP service (not implemented yet)
                Ok(1701 + layer.position as u16)
            }
            ConnectionType::PPTP => {
                // Call PPTP service (not implemented yet)
                Ok(1723 + layer.position as u16)
            }
            ConnectionType::SoftEther => {
                // Call SoftEther service (not implemented yet)
                Ok(443 + layer.position as u16)
            }
            ConnectionType::ZeroTier => {
                // Connect ZeroTier
                let mut zerotier_service = self.zerotier_service.lock().await;
                zerotier_service.connect(&layer.connection_id).await?;
                Ok(9993 + layer.position as u16)
            }
            ConnectionType::Tailscale => {
                // Connect Tailscale
                let mut tailscale_service = self.tailscale_service.lock().await;
                tailscale_service.connect(&layer.connection_id).await?;
                Ok(41641 + layer.position as u16)
            }
        }
    }

    async fn connect_layer_by_info(&self, connection_type: &ConnectionType, connection_id: &str) -> Result<u16, String> {
        match connection_type {
            ConnectionType::Proxy => {
                // For proxy, we need to connect via proxy service
                let mut proxy_service = self.proxy_service.lock().await;
                proxy_service.connect_via_proxy(connection_id).await
            }
            ConnectionType::OpenVPN => {
                // Connect OpenVPN
                let mut openvpn_service = self.openvpn_service.lock().await;
                openvpn_service.connect(connection_id).await?;
                Ok(1194)
            }
            ConnectionType::WireGuard => {
                // Connect WireGuard
                let mut wireguard_service = self.wireguard_service.lock().await;
                wireguard_service.connect(connection_id).await?;
                Ok(51820)
            }
            ConnectionType::IKEv2 => {
                // Call IKEv2 service (not implemented yet)
                Ok(500)
            }
            ConnectionType::SSTP => {
                // Call SSTP service (not implemented yet)
                Ok(443)
            }
            ConnectionType::L2TP => {
                // Call L2TP service (not implemented yet)
                Ok(1701)
            }
            ConnectionType::PPTP => {
                // Call PPTP service (not implemented yet)
                Ok(1723)
            }
            ConnectionType::SoftEther => {
                // Call SoftEther service (not implemented yet)
                Ok(443)
            }
            ConnectionType::ZeroTier => {
                // Connect ZeroTier
                let mut zerotier_service = self.zerotier_service.lock().await;
                zerotier_service.connect(connection_id).await?;
                Ok(9993)
            }
            ConnectionType::Tailscale => {
                // Connect Tailscale
                let mut tailscale_service = self.tailscale_service.lock().await;
                tailscale_service.connect(connection_id).await?;
                Ok(41641)
            }
        }
    }

    async fn disconnect_layer(&self, layer: &ChainLayer) -> Result<(), String> {
        match layer.connection_type {
            ConnectionType::Proxy => {
                let mut proxy_service = self.proxy_service.lock().await;
                proxy_service.disconnect_proxy(&layer.connection_id).await
            }
            ConnectionType::OpenVPN => {
                let mut openvpn_service = self.openvpn_service.lock().await;
                openvpn_service.disconnect(&layer.connection_id).await
            }
            ConnectionType::WireGuard => {
                let mut wireguard_service = self.wireguard_service.lock().await;
                wireguard_service.disconnect(&layer.connection_id).await
            }
            ConnectionType::IKEv2 => {
                // Call IKEv2 service (not implemented yet)
                Ok(())
            }
            ConnectionType::SSTP => {
                // Call SSTP service (not implemented yet)
                Ok(())
            }
            ConnectionType::L2TP => {
                // Call L2TP service (not implemented yet)
                Ok(())
            }
            ConnectionType::PPTP => {
                // Call PPTP service (not implemented yet)
                Ok(())
            }
            ConnectionType::SoftEther => {
                // Call SoftEther service (not implemented yet)
                Ok(())
            }
            ConnectionType::ZeroTier => {
                let mut zerotier_service = self.zerotier_service.lock().await;
                zerotier_service.disconnect(&layer.connection_id).await
            }
            ConnectionType::Tailscale => {
                let mut tailscale_service = self.tailscale_service.lock().await;
                tailscale_service.disconnect(&layer.connection_id).await
            }
        }
    }

    async fn disconnect_layer_by_info(&self, connection_type: &ConnectionType, connection_id: &str) -> Result<(), String> {
        match connection_type {
            ConnectionType::Proxy => {
                let mut proxy_service = self.proxy_service.lock().await;
                proxy_service.disconnect_proxy(connection_id).await
            }
            ConnectionType::OpenVPN => {
                let mut openvpn_service = self.openvpn_service.lock().await;
                openvpn_service.disconnect(connection_id).await
            }
            ConnectionType::WireGuard => {
                let mut wireguard_service = self.wireguard_service.lock().await;
                wireguard_service.disconnect(connection_id).await
            }
            ConnectionType::IKEv2 => {
                // Call IKEv2 service (not implemented yet)
                Ok(())
            }
            ConnectionType::SSTP => {
                // Call SSTP service (not implemented yet)
                Ok(())
            }
            ConnectionType::L2TP => {
                // Call L2TP service (not implemented yet)
                Ok(())
            }
            ConnectionType::PPTP => {
                // Call PPTP service (not implemented yet)
                Ok(())
            }
            ConnectionType::SoftEther => {
                // Call SoftEther service (not implemented yet)
                Ok(())
            }
            ConnectionType::ZeroTier => {
                let mut zerotier_service = self.zerotier_service.lock().await;
                zerotier_service.disconnect(connection_id).await
            }
            ConnectionType::Tailscale => {
                let mut tailscale_service = self.tailscale_service.lock().await;
                tailscale_service.disconnect(connection_id).await
            }
        }
    }
}

#[tauri::command]
pub async fn create_connection_chain(
    name: String,
    description: Option<String>,
    layers: Vec<ChainLayer>,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<String, String> {
    let mut service = chaining_service.lock().await;
    service.create_chain(name, description, layers).await
}

#[tauri::command]
pub async fn connect_connection_chain(
    chain_id: String,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<(), String> {
    let mut service = chaining_service.lock().await;
    service.connect_chain(&chain_id).await
}

#[tauri::command]
pub async fn disconnect_connection_chain(
    chain_id: String,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<(), String> {
    let mut service = chaining_service.lock().await;
    service.disconnect_chain(&chain_id).await
}

#[tauri::command]
pub async fn get_connection_chain(
    chain_id: String,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<ConnectionChain, String> {
    let service = chaining_service.lock().await;
    service.get_chain(&chain_id).await
}

#[tauri::command]
pub async fn list_connection_chains(
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<Vec<ConnectionChain>, String> {
    let service = chaining_service.lock().await;
    Ok(service.list_chains().await)
}

#[tauri::command]
pub async fn delete_connection_chain(
    chain_id: String,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<(), String> {
    let mut service = chaining_service.lock().await;
    service.delete_chain(&chain_id).await
}

#[tauri::command]
pub async fn update_connection_chain_layers(
    chain_id: String,
    layers: Vec<ChainLayer>,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<(), String> {
    let mut service = chaining_service.lock().await;
    service.update_chain_layers(&chain_id, layers).await
}

#[cfg(test)]
mod tests {
    use super::*;
    
    

    // For testing, we'll create a minimal chaining service
    // Note: In a real scenario, you'd want proper dependency injection or mocking
    
    fn create_test_layer(connection_type: ConnectionType, position: usize) -> ChainLayer {
        ChainLayer {
            id: format!("layer_{}", position),
            connection_type,
            connection_id: format!("conn_{}", position),
            position,
            status: ChainLayerStatus::Disconnected,
            local_port: None,
            error: None,
        }
    }

    #[test]
    fn test_connection_type_equality() {
        assert_eq!(ConnectionType::Proxy, ConnectionType::Proxy);
        assert_eq!(ConnectionType::OpenVPN, ConnectionType::OpenVPN);
        assert_eq!(ConnectionType::WireGuard, ConnectionType::WireGuard);
        assert_eq!(ConnectionType::ZeroTier, ConnectionType::ZeroTier);
        assert_eq!(ConnectionType::Tailscale, ConnectionType::Tailscale);
        
        assert_ne!(ConnectionType::Proxy, ConnectionType::OpenVPN);
        assert_ne!(ConnectionType::WireGuard, ConnectionType::ZeroTier);
    }

    #[test]
    fn test_chain_layer_serialization() {
        let layer = ChainLayer {
            id: "test_layer".to_string(),
            connection_type: ConnectionType::Proxy,
            connection_id: "proxy_conn_1".to_string(),
            position: 0,
            status: ChainLayerStatus::Disconnected,
            local_port: None,
            error: None,
        };
        
        // Test serialization
        let json = serde_json::to_string(&layer).unwrap();
        let deserialized: ChainLayer = serde_json::from_str(&json).unwrap();
        
        assert_eq!(deserialized.id, layer.id);
        assert_eq!(deserialized.connection_type, layer.connection_type);
        assert_eq!(deserialized.connection_id, layer.connection_id);
        assert_eq!(deserialized.position, layer.position);
        assert!(matches!(deserialized.status, ChainLayerStatus::Disconnected));
        assert!(deserialized.local_port.is_none());
        assert!(deserialized.error.is_none());
    }

    #[test]
    fn test_connection_chain_serialization() {
        let layers = vec![
            create_test_layer(ConnectionType::Proxy, 0),
            create_test_layer(ConnectionType::OpenVPN, 1),
        ];
        
        let chain = ConnectionChain {
            id: "test_chain".to_string(),
            name: "Test Chain".to_string(),
            description: Some("A test chain".to_string()),
            layers,
            status: ChainStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            final_local_port: None,
            error: None,
        };
        
        // Test serialization
        let json = serde_json::to_string(&chain).unwrap();
        let deserialized: ConnectionChain = serde_json::from_str(&json).unwrap();
        
        assert_eq!(deserialized.id, chain.id);
        assert_eq!(deserialized.name, chain.name);
        assert_eq!(deserialized.description, chain.description);
        assert_eq!(deserialized.layers.len(), chain.layers.len());
        assert!(matches!(deserialized.status, ChainStatus::Disconnected));
        assert!(deserialized.connected_at.is_none());
        assert!(deserialized.final_local_port.is_none());
        assert!(deserialized.error.is_none());
    }

    #[test]
    fn test_chain_layer_status_transitions() {
        let mut layer = create_test_layer(ConnectionType::Proxy, 0);
        
        // Initially disconnected
        assert!(matches!(layer.status, ChainLayerStatus::Disconnected));
        
        // Simulate connecting
        layer.status = ChainLayerStatus::Connecting;
        assert!(matches!(layer.status, ChainLayerStatus::Connecting));
        
        // Simulate successful connection
        layer.status = ChainLayerStatus::Connected;
        layer.local_port = Some(8080);
        assert!(matches!(layer.status, ChainLayerStatus::Connected));
        assert_eq!(layer.local_port, Some(8080));
        
        // Simulate error
        layer.status = ChainLayerStatus::Error("Connection failed".to_string());
        layer.error = Some("Connection failed".to_string());
        match &layer.status {
            ChainLayerStatus::Error(msg) => assert_eq!(msg, "Connection failed"),
            _ => panic!("Expected error status"),
        }
        assert_eq!(layer.error, Some("Connection failed".to_string()));
    }

    #[test]
    fn test_connection_chain_status_transitions() {
        let layers = vec![create_test_layer(ConnectionType::Proxy, 0)];
        let mut chain = ConnectionChain {
            id: "test_chain".to_string(),
            name: "Test Chain".to_string(),
            description: None,
            layers,
            status: ChainStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            final_local_port: None,
            error: None,
        };
        
        // Initially disconnected
        assert!(matches!(chain.status, ChainStatus::Disconnected));
        
        // Simulate connecting
        chain.status = ChainStatus::Connecting;
        assert!(matches!(chain.status, ChainStatus::Connecting));
        
        // Simulate successful connection
        chain.status = ChainStatus::Connected;
        chain.connected_at = Some(Utc::now());
        chain.final_local_port = Some(8080);
        assert!(matches!(chain.status, ChainStatus::Connected));
        assert!(chain.connected_at.is_some());
        assert_eq!(chain.final_local_port, Some(8080));
        
        // Simulate error
        chain.status = ChainStatus::Error("Chain failed".to_string());
        chain.error = Some("Chain failed".to_string());
        match &chain.status {
            ChainStatus::Error(msg) => assert_eq!(msg, "Chain failed"),
            _ => panic!("Expected error status"),
        }
        assert_eq!(chain.error, Some("Chain failed".to_string()));
    }
}