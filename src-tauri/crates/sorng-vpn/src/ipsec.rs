use crate::platform;
use crate::ras_helper;
use chrono::{DateTime, Utc};
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type IPsecServiceState = Arc<Mutex<IPsecService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IPsecConnection {
    pub id: String,
    pub name: String,
    pub config: IPsecConfig,
    pub status: IPsecStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub local_ip: Option<String>,
    pub remote_ip: Option<String>,
    pub ras_entry_name: Option<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum IPsecStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IPsecConfig {
    pub server: String,
    pub auth_method: Option<String>, // "psk", "certificate", "eap"
    pub psk: Option<String>,
    pub certificate: Option<String>,
    pub private_key: Option<String>,
    pub ca_certificate: Option<String>,
    pub phase1_proposals: Option<String>,
    pub phase2_proposals: Option<String>,
    pub sa_lifetime: Option<u32>,
    pub dpd_delay: Option<u32>,
    pub dpd_timeout: Option<u32>,
    pub tunnel_mode: Option<bool>,
    pub custom_options: Vec<String>,
}

pub struct IPsecService {
    connections: HashMap<String, IPsecConnection>,
    emitter: Option<DynEventEmitter>,
}

impl IPsecService {
    pub fn new() -> IPsecServiceState {
        Arc::new(Mutex::new(IPsecService {
            connections: HashMap::new(),
            emitter: None,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> IPsecServiceState {
        Arc::new(Mutex::new(IPsecService {
            connections: HashMap::new(),
            emitter: Some(emitter),
        }))
    }

    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "ipsec",
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
        config: IPsecConfig,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let connection = IPsecConnection {
            id: id.clone(),
            name,
            config,
            status: IPsecStatus::Disconnected,
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
            .ok_or_else(|| "IPsec connection not found".to_string())?;

        if let IPsecStatus::Connected = connection.status {
            return Ok(());
        }

        connection.status = IPsecStatus::Connecting;
        let config = connection.config.clone();
        let entry_name = format!("SoRNG_IPsec_{}", &connection_id[..8]);

        #[cfg(windows)]
        {
            // Windows: use IKEv2 tunnel type as the closest RAS equivalent for raw IPsec
            ras_helper::create_ras_entry(&entry_name, &config.server, "Ikev2").await?;

            // Configure IPsec parameters via PowerShell
            if let Some(psk) = &config.psk {
                let binary = platform::resolve_binary("powershell")?;
                let script = format!(
                    "Set-VpnConnectionIPsecConfiguration -ConnectionName '{}' -AuthenticationMethod PSK -SharedSecret '{}' -Force",
                    entry_name, psk
                );
                let _ = tokio::process::Command::new(binary)
                    .args(["-NoProfile", "-Command", &script])
                    .output()
                    .await;
            }

            // rasdial doesn't use username/password for pure IPsec, but we try anyway
            let username = "";
            let password = "";

            if let Err(e) = ras_helper::rasdial_connect(&entry_name, username, password).await {
                let _ = ras_helper::remove_ras_entry(&entry_name).await;
                connection.status = IPsecStatus::Error(e.clone());
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
            // Linux: use strongSwan
            let conn_name = format!("sorng_ipsec_{}", &connection_id[..8]);
            let auth_method = config.auth_method.as_deref().unwrap_or("psk");

            let strongswan_auth = match auth_method {
                "certificate" => "pubkey",
                "eap" => "eap-mschapv2",
                _ => "psk",
            };

            strongswan_helper::write_ipsec_conf(
                &conn_name,
                &config.server,
                None,
                None,
                strongswan_auth,
                config.phase1_proposals.as_deref(),
                config.phase2_proposals.as_deref(),
            )
            .await?;

            // Write secrets based on auth type
            match auth_method {
                "psk" => {
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
                }
                "certificate" => {
                    if let Some(key_path) = &config.private_key {
                        strongswan_helper::write_ipsec_secrets(
                            &conn_name,
                            None,
                            &config.server,
                            "RSA",
                            key_path,
                        )
                        .await?;
                    }
                }
                _ => {}
            }

            strongswan_helper::ipsec_up(&conn_name).await?;
            connection.remote_ip = Some(config.server.clone());
        }

        connection.status = IPsecStatus::Connected;
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
            .ok_or_else(|| "IPsec connection not found".to_string())?;

        if let IPsecStatus::Disconnected = connection.status {
            return Ok(());
        }

        connection.status = IPsecStatus::Disconnecting;

        #[cfg(windows)]
        {
            if let Some(entry_name) = &connection.ras_entry_name {
                let _ = ras_helper::rasdial_disconnect(entry_name).await;
                let _ = ras_helper::remove_ras_entry(entry_name).await;
            }
        }

        #[cfg(not(windows))]
        {
            let conn_name = format!("sorng_ipsec_{}", &connection_id[..8]);
            let _ = strongswan_helper::ipsec_down(&conn_name).await;
            let _ = strongswan_helper::cleanup_ipsec_files(&conn_name).await;
        }

        connection.status = IPsecStatus::Disconnected;
        connection.connected_at = None;
        connection.local_ip = None;
        connection.remote_ip = None;
        connection.ras_entry_name = None;
        connection.process_id = None;

        self.emit_status(connection_id, "disconnected", serde_json::json!({}));

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<IPsecConnection, String> {
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "IPsec connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<IPsecConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.get(connection_id) {
            if let IPsecStatus::Connected = connection.status {
                self.disconnect(connection_id).await?;
            }
        }

        self.connections.remove(connection_id);
        Ok(())
    }

    pub async fn get_status(&self, connection_id: &str) -> Result<IPsecStatus, String> {
        let connection = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "IPsec connection not found".to_string())?;
        Ok(connection.status.clone())
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<IPsecConfig>,
    ) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "IPsec connection not found".to_string())?;

        if let Some(new_name) = name {
            connection.name = new_name;
        }
        if let Some(new_config) = config {
            connection.config = new_config;
        }
        Ok(())
    }
}
