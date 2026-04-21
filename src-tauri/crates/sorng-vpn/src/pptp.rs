use crate::ras_helper;
use chrono::{DateTime, Utc};
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type PPTPServiceState = Arc<Mutex<PPTPService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PPTPConnection {
    pub id: String,
    pub name: String,
    pub config: PPTPConfig,
    pub status: PPTPStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub local_ip: Option<String>,
    pub remote_ip: Option<String>,
    pub ras_entry_name: Option<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum PPTPStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PPTPConfig {
    pub server: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub domain: Option<String>,
    pub require_mppe: Option<bool>,
    pub mppe_stateful: Option<bool>,
    pub refuse_eap: Option<bool>,
    pub refuse_pap: Option<bool>,
    pub refuse_chap: Option<bool>,
    pub refuse_mschap: Option<bool>,
    pub refuse_mschapv2: Option<bool>,
    pub nobsdcomp: Option<bool>,
    pub nodeflate: Option<bool>,
    pub no_vj_comp: Option<bool>,
    pub custom_options: Vec<String>,
}

pub struct PPTPService {
    connections: HashMap<String, PPTPConnection>,
    emitter: Option<DynEventEmitter>,
}

impl PPTPService {
    pub fn new() -> PPTPServiceState {
        Arc::new(Mutex::new(PPTPService {
            connections: HashMap::new(),
            emitter: None,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> PPTPServiceState {
        Arc::new(Mutex::new(PPTPService {
            connections: HashMap::new(),
            emitter: Some(emitter),
        }))
    }

    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "pptp",
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
        config: PPTPConfig,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let connection = PPTPConnection {
            id: id.clone(),
            name,
            config,
            status: PPTPStatus::Disconnected,
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
            .ok_or_else(|| "PPTP connection not found".to_string())?;

        if let PPTPStatus::Connected = connection.status {
            return Ok(());
        }

        connection.status = PPTPStatus::Connecting;
        let config = connection.config.clone();
        let entry_name = format!("SoRNG_PPTP_{}", &connection_id[..8]);

        #[cfg(windows)]
        {
            // Create RAS entry and connect via rasdial
            ras_helper::create_ras_entry(&entry_name, &config.server, "Pptp").await?;

            let username = config.username.as_deref().unwrap_or("");
            let password = config.password.as_deref().unwrap_or("");

            if let Err(e) = ras_helper::rasdial_connect(&entry_name, username, password).await {
                let _ = ras_helper::remove_ras_entry(&entry_name).await;
                connection.status = PPTPStatus::Error(e.clone());
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
            // Linux: use pppd with pptp plugin
            let pptp_binary = platform::resolve_binary("pptp")
                .map_err(|e| format!("pptp not found: {}", e))?;

            let mut args = vec![config.server.clone()];
            args.push("--nolaunchpppd".to_string());

            if config.require_mppe.unwrap_or(false) {
                args.push("require-mppe".to_string());
            }
            if config.nobsdcomp.unwrap_or(false) {
                args.push("nobsdcomp".to_string());
            }
            if config.nodeflate.unwrap_or(false) {
                args.push("nodeflate".to_string());
            }

            for opt in &config.custom_options {
                args.push(opt.clone());
            }

            let child = tokio::process::Command::new(pptp_binary)
                .args(&args)
                .spawn()
                .map_err(|e| format!("Failed to start pptp: {}", e))?;

            connection.process_id = child.id();
            connection.remote_ip = Some(config.server.clone());
        }

        connection.status = PPTPStatus::Connected;
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
            .ok_or_else(|| "PPTP connection not found".to_string())?;

        if let PPTPStatus::Disconnected = connection.status {
            return Ok(());
        }

        connection.status = PPTPStatus::Disconnecting;

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
        }

        connection.status = PPTPStatus::Disconnected;
        connection.connected_at = None;
        connection.local_ip = None;
        connection.remote_ip = None;
        connection.ras_entry_name = None;
        connection.process_id = None;

        self.emit_status(connection_id, "disconnected", serde_json::json!({}));

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<PPTPConnection, String> {
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "PPTP connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<PPTPConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.get(connection_id) {
            if let PPTPStatus::Connected = connection.status {
                self.disconnect(connection_id).await?;
            }
        }

        self.connections.remove(connection_id);
        Ok(())
    }

    pub async fn get_status(&self, connection_id: &str) -> Result<PPTPStatus, String> {
        let connection = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "PPTP connection not found".to_string())?;
        Ok(connection.status.clone())
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<PPTPConfig>,
    ) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "PPTP connection not found".to_string())?;

        if let Some(new_name) = name {
            connection.name = new_name;
        }
        if let Some(new_config) = config {
            connection.config = new_config;
        }
        Ok(())
    }
}
