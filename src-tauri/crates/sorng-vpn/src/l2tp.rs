use crate::platform;
use crate::ras_helper;
use chrono::{DateTime, Utc};
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type L2TPServiceState = Arc<Mutex<L2TPService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct L2TPConnection {
    pub id: String,
    pub name: String,
    pub config: L2TPConfig,
    pub status: L2TPStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub local_ip: Option<String>,
    pub remote_ip: Option<String>,
    pub ras_entry_name: Option<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum L2TPStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct L2TPConfig {
    pub server: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub psk: Option<String>,
    pub ipsec_ike: Option<String>,
    pub ipsec_esp: Option<String>,
    pub ipsec_pfs: Option<bool>,
    pub mru: Option<u16>,
    pub mtu: Option<u16>,
    pub custom_options: Vec<String>,
}

pub struct L2TPService {
    connections: HashMap<String, L2TPConnection>,
    emitter: Option<DynEventEmitter>,
}

impl L2TPService {
    pub fn new() -> L2TPServiceState {
        Arc::new(Mutex::new(L2TPService {
            connections: HashMap::new(),
            emitter: None,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> L2TPServiceState {
        Arc::new(Mutex::new(L2TPService {
            connections: HashMap::new(),
            emitter: Some(emitter),
        }))
    }

    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "l2tp",
                "status": status,
            });
            if let (Some(base), Some(ext)) = (payload.as_object_mut(), extra.as_object()) {
                for (k, v) in ext {
                    base.insert(k.clone(), v.clone());
                }
            }
            let _ = emitter.emit_event("vpn::status-changed", payload);
        }
    }

    pub async fn create_connection(
        &mut self,
        name: String,
        config: L2TPConfig,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let connection = L2TPConnection {
            id: id.clone(),
            name,
            config,
            status: L2TPStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            local_ip: None,
            remote_ip: None,
            ras_entry_name: None,
            process_id: None,
        };

        self.connections.insert(id.clone(), connection);
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "L2TP connection not found".to_string())?;

        if let L2TPStatus::Connected = connection.status {
            return Ok(());
        }

        connection.status = L2TPStatus::Connecting;
        let config = connection.config.clone();
        let entry_name = format!("SoRNG_L2TP_{}", &connection_id[..8]);

        #[cfg(windows)]
        {
            // Create RAS entry with L2TP tunnel type
            ras_helper::create_ras_entry(&entry_name, &config.server, "L2tp").await?;

            // Set PSK if provided
            if let Some(psk) = &config.psk {
                let binary = platform::resolve_binary("powershell")?;
                let script = format!(
                    "Set-VpnConnectionIPsecConfiguration -ConnectionName '{}' -AuthenticationTransformConstants SHA256128 -CipherTransformConstants AES256 -DHGroup Group14 -EncryptionMethod AES256 -IntegrityCheckMethod SHA256 -PfsGroup None -AuthenticationMethod PSK -SharedSecret '{}' -Force",
                    entry_name, psk
                );
                let _ = tokio::process::Command::new(binary)
                    .args(["-NoProfile", "-Command", &script])
                    .output()
                    .await;
            }

            let username = config.username.as_deref().unwrap_or("");
            let password = config.password.as_deref().unwrap_or("");

            if let Err(e) = ras_helper::rasdial_connect(&entry_name, username, password).await {
                let _ = ras_helper::remove_ras_entry(&entry_name).await;
                connection.status = L2TPStatus::Error(e.clone());
                self.emit_status(
                    connection_id,
                    "error",
                    serde_json::json!({ "error": e }),
                );
                return Err(e);
            }

            connection.ras_entry_name = Some(entry_name);
            connection.remote_ip = Some(config.server.clone());
        }

        #[cfg(not(windows))]
        {
            // Linux: use strongSwan for IPsec + xl2tpd for L2TP
            let conn_name = format!("sorng_l2tp_{}", &connection_id[..8]);

            // Write IPsec config for L2TP
            strongswan_helper::write_ipsec_conf(
                &conn_name,
                &config.server,
                None,
                None,
                "psk",
                config.ipsec_ike.as_deref(),
                config.ipsec_esp.as_deref(),
            )
            .await?;

            // Write PSK secret
            if let Some(psk) = &config.psk {
                strongswan_helper::write_ipsec_secrets(
                    &conn_name,
                    None,
                    &config.server,
                    "PSK",
                    psk,
                )
                .await?;
            }

            // Bring up IPsec
            strongswan_helper::ipsec_up(&conn_name).await?;

            // Start xl2tpd
            let xl2tpd_binary = platform::resolve_binary("xl2tpd")
                .map_err(|e| format!("xl2tpd not found: {}", e))?;

            let child = tokio::process::Command::new(xl2tpd_binary)
                .args(["-D"])
                .spawn()
                .map_err(|e| format!("Failed to start xl2tpd: {}", e))?;

            connection.process_id = child.id();
            connection.remote_ip = Some(config.server.clone());
        }

        connection.status = L2TPStatus::Connected;
        connection.connected_at = Some(Utc::now());
        let local_ip = connection.local_ip.clone();
        let remote_ip = connection.remote_ip.clone();

        self.emit_status(
            connection_id,
            "connected",
            serde_json::json!({
                "local_ip": local_ip,
                "remote_ip": remote_ip,
            }),
        );

        Ok(())
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "L2TP connection not found".to_string())?;

        if let L2TPStatus::Disconnected = connection.status {
            return Ok(());
        }

        connection.status = L2TPStatus::Disconnecting;

        #[cfg(windows)]
        {
            if let Some(entry_name) = &connection.ras_entry_name {
                let _ = ras_helper::rasdial_disconnect(entry_name).await;
                let _ = ras_helper::remove_ras_entry(entry_name).await;
            }
        }

        #[cfg(not(windows))]
        {
            if let Some(pid) = connection.process_id {
                let _ = tokio::process::Command::new("kill")
                    .arg(pid.to_string())
                    .status()
                    .await;
            }

            let conn_name = format!("sorng_l2tp_{}", &connection_id[..8]);
            let _ = strongswan_helper::ipsec_down(&conn_name).await;
            let _ = strongswan_helper::cleanup_ipsec_files(&conn_name).await;
        }

        connection.status = L2TPStatus::Disconnected;
        connection.connected_at = None;
        connection.local_ip = None;
        connection.remote_ip = None;
        connection.ras_entry_name = None;
        connection.process_id = None;

        self.emit_status(connection_id, "disconnected", serde_json::json!({}));

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<L2TPConnection, String> {
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "L2TP connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<L2TPConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.get(connection_id) {
            if let L2TPStatus::Connected = connection.status {
                self.disconnect(connection_id).await?;
            }
        }

        self.connections.remove(connection_id);
        Ok(())
    }

    pub async fn get_status(&self, connection_id: &str) -> Result<L2TPStatus, String> {
        let connection = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "L2TP connection not found".to_string())?;
        Ok(connection.status.clone())
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<L2TPConfig>,
    ) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "L2TP connection not found".to_string())?;

        if let Some(new_name) = name {
            connection.name = new_name;
        }
        if let Some(new_config) = config {
            connection.config = new_config;
        }
        Ok(())
    }
}
