#[cfg(windows)]
use crate::ras_helper;
use chrono::{DateTime, Utc};
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type SSTPServiceState = Arc<Mutex<SSTPService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SSTPConnection {
    pub id: String,
    pub name: String,
    pub config: SSTPConfig,
    pub status: SSTPStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub local_ip: Option<String>,
    pub remote_ip: Option<String>,
    pub ras_entry_name: Option<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct SSTPSecretPresence {
    pub password: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SSTPConnectionView {
    #[serde(flatten)]
    pub connection: SSTPConnection,
    pub secret_presence: SSTPSecretPresence,
}

impl SSTPConnection {
    pub fn into_redacted_view(mut self) -> SSTPConnectionView {
        let secret_presence = SSTPSecretPresence {
            password: self.config.password.is_some(),
        };
        self.config.password = None;
        SSTPConnectionView {
            connection: self,
            secret_presence,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct SSTPSecretMutation {
    pub clear_password: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum SSTPStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SSTPConfig {
    pub server: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub domain: Option<String>,
    pub certificate: Option<String>,
    pub ca_certificate: Option<String>,
    pub ignore_certificate: Option<bool>,
    pub proxy_host: Option<String>,
    pub proxy_port: Option<u16>,
    #[serde(default)]
    pub custom_options: Vec<String>,
}

pub struct SSTPService {
    connections: HashMap<String, SSTPConnection>,
    emitter: Option<DynEventEmitter>,
}

impl SSTPService {
    pub fn new() -> SSTPServiceState {
        Arc::new(Mutex::new(SSTPService {
            connections: HashMap::new(),
            emitter: None,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> SSTPServiceState {
        Arc::new(Mutex::new(SSTPService {
            connections: HashMap::new(),
            emitter: Some(emitter),
        }))
    }

    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "sstp",
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
        config: SSTPConfig,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let connection = SSTPConnection {
            id: id.clone(),
            name,
            config,
            status: SSTPStatus::Disconnected,
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
        if !self.connections.contains_key(connection_id) {
            return Err("SSTP connection not found".to_string());
        }
        #[cfg(not(windows))]
        {
            Err(
                "SSTP is not enabled on this platform because the backend cannot pass credentials to sstpc without exposing them in process arguments or verify PPP readiness"
                    .to_string(),
            )
        }

        #[cfg(windows)]
        {
            if self.probe_connection_active(connection_id).await? {
                return Ok(());
            }
            let connection = self
                .connections
                .get_mut(connection_id)
                .expect("checked above");
            connection.status = SSTPStatus::Connecting;
            let config = connection.config.clone();
            let entry_name = format!("SoRNG_SSTP_{}", &connection_id[..8]);

            // Create the Windows native SSTP entry, then connect via RAS.
            ras_helper::create_ras_entry(&entry_name, &config.server, "Sstp").await?;
            let username = config.username.as_deref().unwrap_or("");
            let password = config.password.as_deref().unwrap_or("");
            if let Err(e) = ras_helper::rasdial_connect(&entry_name, username, password).await {
                let _ = ras_helper::remove_ras_entry(&entry_name).await;
                connection.status = SSTPStatus::Error(e.clone());
                self.emit_status(connection_id, "error", serde_json::json!({ "error": e }));
                return Err(e);
            }

            connection.ras_entry_name = Some(entry_name);
            connection.remote_ip = Some(config.server.clone());
            connection.status = SSTPStatus::Connected;
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
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "SSTP connection not found".to_string())?;

        connection.status = SSTPStatus::Disconnecting;

        #[cfg(windows)]
        let teardown_result =
            ras_helper::teardown_ras_entry(&format!("SoRNG_SSTP_{}", &connection_id[..8])).await;

        #[cfg(not(windows))]
        let teardown_result = {
            if let Some(pid) = connection.process_id {
                let status = tokio::process::Command::new("kill")
                    .arg(pid.to_string())
                    .status()
                    .await;
                match status {
                    Ok(status) if status.success() => Ok(()),
                    _ => Err("Failed to stop the SSTP process".to_string()),
                }
            } else {
                Ok(())
            }
        };

        if let Err(error) = teardown_result {
            connection.status = SSTPStatus::Error(error.clone());
            self.emit_status(
                connection_id,
                "error",
                serde_json::json!({ "error": error }),
            );
            return Err(error);
        }

        connection.status = SSTPStatus::Disconnected;
        connection.connected_at = None;
        connection.local_ip = None;
        connection.remote_ip = None;
        connection.ras_entry_name = None;
        connection.process_id = None;

        self.emit_status(connection_id, "disconnected", serde_json::json!({}));

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<SSTPConnection, String> {
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "SSTP connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<SSTPConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        #[cfg(windows)]
        if self.connections.contains_key(connection_id) {
            self.disconnect(connection_id).await?;
        }

        self.connections.remove(connection_id);
        Ok(())
    }

    pub async fn get_status(&self, connection_id: &str) -> Result<SSTPStatus, String> {
        let connection = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "SSTP connection not found".to_string())?;
        Ok(connection.status.clone())
    }

    pub async fn probe_connection_active(&mut self, connection_id: &str) -> Result<bool, String> {
        if !self.connections.contains_key(connection_id) {
            return Err("SSTP connection not found".to_string());
        }
        #[cfg(not(windows))]
        return Err("SSTP activity probing is unavailable on this platform".to_string());
        #[cfg(windows)]
        {
            let active =
                ras_helper::is_ras_active(&format!("SoRNG_SSTP_{}", &connection_id[..8])).await?;
            let connection = self
                .connections
                .get_mut(connection_id)
                .expect("checked above");
            connection.status = if active {
                SSTPStatus::Connected
            } else {
                SSTPStatus::Disconnected
            };
            Ok(active)
        }
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<SSTPConfig>,
    ) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "SSTP connection not found".to_string())?;

        if let Some(new_name) = name {
            connection.name = new_name;
        }
        if let Some(new_config) = config {
            connection.config = new_config;
        }
        Ok(())
    }

    pub async fn update_connection_from_ipc(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        mut config: Option<SSTPConfig>,
        secret_mutation: SSTPSecretMutation,
    ) -> Result<(), String> {
        if config.is_none() && secret_mutation.clear_password {
            let mut current = self
                .connections
                .get(connection_id)
                .ok_or_else(|| "SSTP connection not found".to_string())?
                .config
                .clone();
            current.password = None;
            config = Some(current);
        }
        if let Some(submitted) = config.as_mut() {
            let stored = &self
                .connections
                .get(connection_id)
                .ok_or_else(|| "SSTP connection not found".to_string())?
                .config;
            crate::persistence::merge_secret_update(
                &stored.password,
                &mut submitted.password,
                secret_mutation.clear_password,
                "SSTP password",
            )?;
        }
        self.update_connection(connection_id, name, config).await
    }
}
