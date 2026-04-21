use crate::platform;
use crate::ras_helper;
use chrono::{DateTime, Utc};
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type IKEv2ServiceState = Arc<Mutex<IKEv2Service>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IKEv2Connection {
    pub id: String,
    pub name: String,
    pub config: IKEv2Config,
    pub status: IKEv2Status,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub local_ip: Option<String>,
    pub remote_ip: Option<String>,
    pub ras_entry_name: Option<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum IKEv2Status {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IKEv2Config {
    pub server: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub certificate: Option<String>,
    pub private_key: Option<String>,
    pub ca_certificate: Option<String>,
    pub eap_method: Option<String>,
    pub phase1_algorithms: Option<String>,
    pub phase2_algorithms: Option<String>,
    pub local_id: Option<String>,
    pub remote_id: Option<String>,
    pub fragmentation: Option<bool>,
    pub mobike: Option<bool>,
    pub custom_options: Vec<String>,
}

pub struct IKEv2Service {
    connections: HashMap<String, IKEv2Connection>,
    emitter: Option<DynEventEmitter>,
}

impl IKEv2Service {
    pub fn new() -> IKEv2ServiceState {
        Arc::new(Mutex::new(IKEv2Service {
            connections: HashMap::new(),
            emitter: None,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> IKEv2ServiceState {
        Arc::new(Mutex::new(IKEv2Service {
            connections: HashMap::new(),
            emitter: Some(emitter),
        }))
    }

    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "ikev2",
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
        config: IKEv2Config,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let connection = IKEv2Connection {
            id: id.clone(),
            name,
            config,
            status: IKEv2Status::Disconnected,
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
            .ok_or_else(|| "IKEv2 connection not found".to_string())?;

        if let IKEv2Status::Connected = connection.status {
            return Ok(());
        }

        connection.status = IKEv2Status::Connecting;
        let config = connection.config.clone();
        let entry_name = format!("SoRNG_IKEv2_{}", &connection_id[..8]);

        #[cfg(windows)]
        {
            // Create RAS entry with IKEv2 tunnel type
            ras_helper::create_ras_entry(&entry_name, &config.server, "Ikev2").await?;

            // Set EAP method if specified
            if let Some(eap) = &config.eap_method {
                let binary = platform::resolve_binary("powershell")?;
                let script = format!(
                    "Set-VpnConnection -Name '{}' -AuthenticationMethod {} -Force",
                    entry_name, eap
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
                connection.status = IKEv2Status::Error(e.clone());
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
            // Linux: use strongSwan for IKEv2
            let conn_name = format!("sorng_ikev2_{}", &connection_id[..8]);

            let auth_method = if config.certificate.is_some() {
                "pubkey"
            } else if config.eap_method.is_some() {
                config.eap_method.as_deref().unwrap_or("eap-mschapv2")
            } else {
                "psk"
            };

            strongswan_helper::write_ipsec_conf(
                &conn_name,
                &config.server,
                config.local_id.as_deref(),
                config.remote_id.as_deref(),
                auth_method,
                config.phase1_algorithms.as_deref(),
                config.phase2_algorithms.as_deref(),
            )
            .await?;

            // Write secrets based on auth type
            if let Some(password) = &config.password {
                let secret_type = if auth_method.starts_with("eap") {
                    "EAP"
                } else {
                    "PSK"
                };
                strongswan_helper::write_ipsec_secrets(
                    &conn_name,
                    config.local_id.as_deref(),
                    &config.server,
                    secret_type,
                    password,
                )
                .await?;
            } else if let Some(key_path) = &config.private_key {
                strongswan_helper::write_ipsec_secrets(
                    &conn_name,
                    config.local_id.as_deref(),
                    &config.server,
                    "RSA",
                    key_path,
                )
                .await?;
            }

            strongswan_helper::ipsec_up(&conn_name).await?;
            connection.remote_ip = Some(config.server.clone());
        }

        connection.status = IKEv2Status::Connected;
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
            .ok_or_else(|| "IKEv2 connection not found".to_string())?;

        if let IKEv2Status::Disconnected = connection.status {
            return Ok(());
        }

        connection.status = IKEv2Status::Disconnecting;

        #[cfg(windows)]
        {
            if let Some(entry_name) = &connection.ras_entry_name {
                let _ = ras_helper::rasdial_disconnect(entry_name).await;
                let _ = ras_helper::remove_ras_entry(entry_name).await;
            }
        }

        #[cfg(not(windows))]
        {
            let conn_name = format!("sorng_ikev2_{}", &connection_id[..8]);
            let _ = strongswan_helper::ipsec_down(&conn_name).await;
            let _ = strongswan_helper::cleanup_ipsec_files(&conn_name).await;
        }

        connection.status = IKEv2Status::Disconnected;
        connection.connected_at = None;
        connection.local_ip = None;
        connection.remote_ip = None;
        connection.ras_entry_name = None;
        connection.process_id = None;

        self.emit_status(connection_id, "disconnected", serde_json::json!({}));

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<IKEv2Connection, String> {
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "IKEv2 connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<IKEv2Connection> {
        self.connections.values().cloned().collect()
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.get(connection_id) {
            if let IKEv2Status::Connected = connection.status {
                self.disconnect(connection_id).await?;
            }
        }

        self.connections.remove(connection_id);
        Ok(())
    }

    pub async fn get_status(&self, connection_id: &str) -> Result<IKEv2Status, String> {
        let connection = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "IKEv2 connection not found".to_string())?;
        Ok(connection.status.clone())
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<IKEv2Config>,
    ) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "IKEv2 connection not found".to_string())?;

        if let Some(new_name) = name {
            connection.name = new_name;
        }
        if let Some(new_config) = config {
            connection.config = new_config;
        }
        Ok(())
    }
}
