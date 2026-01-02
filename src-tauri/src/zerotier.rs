use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::process::Command;
use std::process::Stdio;
use std::collections::HashMap;
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::fs;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde_json;
use tauri;

pub type ZeroTierServiceState = Arc<Mutex<ZeroTierService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ZeroTierConnection {
    pub id: String,
    pub name: String,
    pub config: ZeroTierConfig,
    pub status: ZeroTierStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub network_id: Option<String>,
    pub assigned_ips: Vec<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ZeroTierStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ZeroTierConfig {
    pub network_id: String,
    pub identity_secret: Option<String>,
    pub identity_public: Option<String>,
    pub allow_managed: Option<bool>,
    pub allow_global: Option<bool>,
    pub allow_default: Option<bool>,
    pub allow_dns: Option<bool>,
    pub zerotier_home: Option<String>,
    pub authtoken_secret: Option<String>,
}

pub struct ZeroTierService {
    connections: HashMap<String, ZeroTierConnection>,
}

impl ZeroTierService {
    pub fn new() -> ZeroTierServiceState {
        Arc::new(Mutex::new(ZeroTierService {
            connections: HashMap::new(),
        }))
    }

    pub async fn create_connection(&mut self, name: String, config: ZeroTierConfig) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let connection = ZeroTierConnection {
            id: id.clone(),
            name,
            config,
            status: ZeroTierStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            network_id: None,
            assigned_ips: Vec::new(),
            process_id: None,
        };

        self.connections.insert(id.clone(), connection);
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        // Check if connection exists first
        if !self.connections.contains_key(connection_id) {
            return Err("ZeroTier connection not found".to_string());
        }

        // Get the network_id before borrowing mutably
        let network_id = self.connections[connection_id].config.network_id.clone();

        // Get network information before borrowing mutably
        let network_info_result = self.get_network_info(&network_id).await;

        // Now borrow mutably
        let connection = self.connections.get_mut(connection_id).unwrap();

        if let ZeroTierStatus::Connected = connection.status {
            return Ok(());
        }

        connection.status = ZeroTierStatus::Connecting;

        // Join the ZeroTier network
        let output = Command::new("zerotier-cli")
            .args(&["join", &network_id])
            .output()
            .await
            .map_err(|e| format!("Failed to execute zerotier-cli: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            connection.status = ZeroTierStatus::Error(stderr.to_string());
            return Err(format!("ZeroTier join failed: {}", stderr));
        }

        connection.network_id = Some(network_id.clone());
        connection.status = ZeroTierStatus::Connected;
        connection.connected_at = Some(Utc::now());

        // Set assigned IPs if we got network info
        if let Ok(network_info) = network_info_result {
            connection.assigned_ips = network_info.assigned_ips;
        }

        Ok(())
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self.connections.get_mut(connection_id)
            .ok_or_else(|| "ZeroTier connection not found".to_string())?;

        if let ZeroTierStatus::Disconnected = connection.status {
            return Ok(());
        }

        connection.status = ZeroTierStatus::Disconnecting;

        if let Some(network_id) = &connection.network_id {
            // Leave the ZeroTier network
            let output = Command::new("zerotier-cli")
                .args(&["leave", network_id])
                .output()
                .await
                .map_err(|e| format!("Failed to execute zerotier-cli: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                connection.status = ZeroTierStatus::Error(stderr.to_string());
                return Err(format!("ZeroTier leave failed: {}", stderr));
            }
        }

        connection.status = ZeroTierStatus::Disconnected;
        connection.connected_at = None;
        connection.network_id = None;
        connection.assigned_ips.clear();

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<ZeroTierConnection, String> {
        self.connections.get(connection_id)
            .cloned()
            .ok_or_else(|| "ZeroTier connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<ZeroTierConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.get(connection_id) {
            if let ZeroTierStatus::Connected = connection.status {
                self.disconnect(connection_id).await?;
            }
        }

        self.connections.remove(connection_id);
        Ok(())
    }

    async fn get_network_info(&self, network_id: &str) -> Result<NetworkInfo, String> {
        let output = Command::new("zerotier-cli")
            .args(&["listnetworks", "-j"])
            .output()
            .await
            .map_err(|e| format!("Failed to get network info: {}", e))?;

        if !output.status.success() {
            return Err("Failed to get network information".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let networks: Vec<serde_json::Value> = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse network info: {}", e))?;

        for network in networks {
            if let Some(nwid) = network.get("nwid").and_then(|v| v.as_str()) {
                if nwid == network_id {
                    let assigned_ips = network.get("assignedAddresses")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|ip| ip.as_str().map(|s| s.to_string())).collect())
                        .unwrap_or_default();

                    return Ok(NetworkInfo {
                        assigned_ips,
                    });
                }
            }
        }

        Err("Network not found".to_string())
    }
}

#[derive(Debug)]
struct NetworkInfo {
    assigned_ips: Vec<String>,
}

#[tauri::command]
pub async fn create_zerotier_connection(
    name: String,
    config: ZeroTierConfig,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<String, String> {
    let mut service = zerotier_service.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_zerotier(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<(), String> {
    let mut service = zerotier_service.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_zerotier(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<(), String> {
    let mut service = zerotier_service.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_zerotier_connection(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<ZeroTierConnection, String> {
    let service = zerotier_service.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_zerotier_connections(
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<Vec<ZeroTierConnection>, String> {
    let service = zerotier_service.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_zerotier_connection(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<(), String> {
    let mut service = zerotier_service.lock().await;
    service.delete_connection(&connection_id).await
}