use crate::persistence::{
    deserialize_profile_definitions, load_service_data, save_service_data,
    serialize_profile_definitions, validate_persisted_profile_id, Persistable, RestoreOutcome,
};
#[cfg(windows)]
use crate::ras_helper;
#[cfg(not(windows))]
use crate::strongswan_helper;
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

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct L2TPSecretPresence {
    pub password: bool,
    pub psk: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct L2TPConnectionView {
    #[serde(flatten)]
    pub connection: L2TPConnection,
    pub secret_presence: L2TPSecretPresence,
}

impl L2TPConnection {
    pub fn into_redacted_view(mut self) -> L2TPConnectionView {
        let secret_presence = L2TPSecretPresence {
            password: self.config.password.is_some(),
            psk: self.config.psk.is_some(),
        };
        self.config.password = None;
        self.config.psk = None;
        L2TPConnectionView {
            connection: self,
            secret_presence,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct L2TPSecretMutation {
    pub clear_password: bool,
    pub clear_psk: bool,
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
#[serde(deny_unknown_fields)]
pub struct L2TPConfig {
    pub server: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub psk: Option<String>,
    pub ipsec_ike: Option<String>,
    pub ipsec_esp: Option<String>,
    pub ipsec_pfs: Option<String>,
    pub mru: Option<u16>,
    pub mtu: Option<u16>,
    pub lcp_echo_interval: Option<u32>,
    pub lcp_echo_failure: Option<u32>,
    pub require_chap: Option<bool>,
    pub refuse_chap: Option<bool>,
    pub require_mschap: Option<bool>,
    pub refuse_mschap: Option<bool>,
    pub require_mschapv2: Option<bool>,
    pub refuse_mschapv2: Option<bool>,
    pub require_eap: Option<bool>,
    pub refuse_eap: Option<bool>,
    pub require_pap: Option<bool>,
    pub refuse_pap: Option<bool>,
    pub ipsec_ikelifetime: Option<u32>,
    pub ipsec_lifetime: Option<u32>,
    pub ipsec_phase2alg: Option<String>,
    #[serde(default)]
    pub custom_options: Vec<String>,
}

pub struct L2TPService {
    connections: HashMap<String, L2TPConnection>,
    emitter: Option<DynEventEmitter>,
    storage: Option<sorng_storage::storage::SecureStorageState>,
    definitions_loaded: bool,
}

impl L2TPService {
    pub fn new() -> L2TPServiceState {
        Arc::new(Mutex::new(L2TPService {
            connections: HashMap::new(),
            emitter: None,
            storage: None,
            definitions_loaded: true,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> L2TPServiceState {
        Arc::new(Mutex::new(L2TPService {
            connections: HashMap::new(),
            emitter: Some(emitter),
            storage: None,
            definitions_loaded: true,
        }))
    }

    pub fn new_persistent(
        emitter: DynEventEmitter,
        storage: sorng_storage::storage::SecureStorageState,
    ) -> L2TPServiceState {
        Arc::new(Mutex::new(L2TPService {
            connections: HashMap::new(),
            emitter: Some(emitter),
            storage: Some(storage),
            definitions_loaded: false,
        }))
    }

    pub async fn restore_persisted(&mut self) -> Result<RestoreOutcome, String> {
        if self.definitions_loaded {
            return Ok(RestoreOutcome::Loaded);
        }
        let Some(storage) = self.storage.clone() else {
            self.definitions_loaded = true;
            return Ok(RestoreOutcome::Missing);
        };
        let outcome = load_service_data(self, &storage).await?;
        if outcome != RestoreOutcome::Locked {
            self.definitions_loaded = true;
        }
        Ok(outcome)
    }

    pub async fn ensure_persisted_loaded(&mut self) -> Result<(), String> {
        match self.restore_persisted().await {
            Ok(RestoreOutcome::Loaded | RestoreOutcome::Missing) => Ok(()),
            Ok(RestoreOutcome::Locked) => Err(
                "VPN profile storage is locked; unlock it in Settings -> Security and retry"
                    .to_string(),
            ),
            Err(error) => Err(format!(
                "L2TP profile storage is unreadable; stored profiles were left untouched: {error}"
            )),
        }
    }

    async fn persist_or_rollback(
        &mut self,
        previous: HashMap<String, L2TPConnection>,
    ) -> Result<(), String> {
        let Some(storage) = self.storage.clone() else {
            return Ok(());
        };
        if let Err(error) = save_service_data(self, &storage).await {
            self.connections = previous;
            return Err(format!(
                "L2TP profile change was not saved and has been rolled back: {error}"
            ));
        }
        Ok(())
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
        self.ensure_persisted_loaded().await?;
        let previous = self.connections.clone();
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
        self.persist_or_rollback(previous).await?;
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if !self.connections.contains_key(connection_id) {
            return Err("L2TP connection not found".to_string());
        }
        if self.probe_connection_active(connection_id).await? {
            return Ok(());
        }
        let connection = self
            .connections
            .get_mut(connection_id)
            .expect("checked above");

        connection.status = L2TPStatus::Connecting;
        let config = connection.config.clone();
        #[cfg(windows)]
        let entry_name = format!("SoRNG_L2TP_{}", &connection_id[..8]);

        #[cfg(windows)]
        {
            // Create the entry with the PSK through Add-VpnConnection's
            // supported L2tpPsk parameter, then apply the IPsec policy.
            ras_helper::create_l2tp_ras_entry(&entry_name, &config.server, config.psk.as_deref())
                .await?;

            let username = config.username.as_deref().unwrap_or("");
            let password = config.password.as_deref().unwrap_or("");

            if let Err(e) = ras_helper::rasdial_connect(&entry_name, username, password).await {
                let _ = ras_helper::remove_ras_entry(&entry_name).await;
                connection.status = L2TPStatus::Error(e.clone());
                self.emit_status(connection_id, "error", serde_json::json!({ "error": e }));
                return Err(e);
            }

            connection.ras_entry_name = Some(entry_name);
            connection.remote_ip = Some(config.server.clone());
        }

        #[cfg(not(windows))]
        {
            let conn_name = format!("sorng_l2tp_{}", &connection_id[..8]);
            match setup_strongswan_connection(&conn_name, &config).await {
                Ok(process_id) => connection.process_id = process_id,
                Err(setup_error) => {
                    let cleanup_error = strongswan_helper::cleanup_ipsec_files(&conn_name)
                        .await
                        .err();
                    let error = compose_setup_cleanup_error(setup_error, cleanup_error);
                    connection.status = L2TPStatus::Error(error.clone());
                    self.emit_status(
                        connection_id,
                        "error",
                        serde_json::json!({ "error": error }),
                    );
                    return Err(error);
                }
            }
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
        self.ensure_persisted_loaded().await?;
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "L2TP connection not found".to_string())?;

        connection.status = L2TPStatus::Disconnecting;

        #[cfg(windows)]
        let teardown_result =
            ras_helper::teardown_ras_entry(&format!("SoRNG_L2TP_{}", &connection_id[..8])).await;

        #[cfg(not(windows))]
        let teardown_result = {
            let mut errors = Vec::new();
            if let Some(pid) = connection.process_id {
                let status = tokio::process::Command::new("kill")
                    .arg(pid.to_string())
                    .status()
                    .await;
                if !matches!(status, Ok(status) if status.success()) {
                    errors.push("Failed to stop the L2TP process".to_string());
                }
            }
            if let Err(error) = strongswan_helper::teardown_ipsec_connection(&format!(
                "sorng_l2tp_{}",
                &connection_id[..8]
            ))
            .await
            {
                errors.push(error);
            }
            if errors.is_empty() {
                Ok(())
            } else {
                Err(errors.join("; "))
            }
        };

        if let Err(error) = teardown_result {
            connection.status = L2TPStatus::Error(error.clone());
            self.emit_status(
                connection_id,
                "error",
                serde_json::json!({ "error": error }),
            );
            return Err(error);
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

    pub async fn get_connection(&mut self, connection_id: &str) -> Result<L2TPConnection, String> {
        self.ensure_persisted_loaded().await?;
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "L2TP connection not found".to_string())
    }

    pub async fn list_connections(&mut self) -> Result<Vec<L2TPConnection>, String> {
        self.ensure_persisted_loaded().await?;
        Ok(self.connections.values().cloned().collect())
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if !self.connections.contains_key(connection_id) {
            return Ok(());
        }
        self.disconnect(connection_id).await?;
        let previous = self.connections.clone();
        self.connections.remove(connection_id);
        self.persist_or_rollback(previous).await
    }

    pub async fn get_status(&mut self, connection_id: &str) -> Result<L2TPStatus, String> {
        self.ensure_persisted_loaded().await?;
        let connection = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "L2TP connection not found".to_string())?;
        Ok(connection.status.clone())
    }

    pub async fn probe_connection_active(&mut self, connection_id: &str) -> Result<bool, String> {
        self.ensure_persisted_loaded().await?;
        if !self.connections.contains_key(connection_id) {
            return Err("L2TP connection not found".to_string());
        }
        #[cfg(not(windows))]
        return Err(
            "L2TP activity probing is unsupported without an isolated xl2tpd/pppd control plane"
                .to_string(),
        );
        #[cfg(windows)]
        {
            let active =
                ras_helper::is_ras_active(&format!("SoRNG_L2TP_{}", &connection_id[..8])).await?;
            let connection = self
                .connections
                .get_mut(connection_id)
                .expect("checked above");
            connection.status = if active {
                L2TPStatus::Connected
            } else {
                L2TPStatus::Disconnected
            };
            Ok(active)
        }
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<L2TPConfig>,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let previous = self.connections.clone();
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
        self.persist_or_rollback(previous).await
    }

    pub async fn update_connection_from_ipc(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        mut config: Option<L2TPConfig>,
        secret_mutation: L2TPSecretMutation,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if config.is_none() && (secret_mutation.clear_password || secret_mutation.clear_psk) {
            let mut current = self
                .connections
                .get(connection_id)
                .ok_or_else(|| "L2TP connection not found".to_string())?
                .config
                .clone();
            if secret_mutation.clear_password {
                current.password = None;
            }
            if secret_mutation.clear_psk {
                current.psk = None;
            }
            config = Some(current);
        }
        if let Some(submitted) = config.as_mut() {
            let stored = &self
                .connections
                .get(connection_id)
                .ok_or_else(|| "L2TP connection not found".to_string())?
                .config;
            crate::persistence::merge_secret_update(
                &stored.password,
                &mut submitted.password,
                secret_mutation.clear_password,
                "L2TP password",
            )?;
            crate::persistence::merge_secret_update(
                &stored.psk,
                &mut submitted.psk,
                secret_mutation.clear_psk,
                "L2TP PSK",
            )?;
        }
        self.update_connection(connection_id, name, config).await
    }
}

#[async_trait::async_trait]
impl Persistable for L2TPService {
    fn storage_key(&self) -> &'static str {
        crate::persistence::keys::L2TP
    }

    fn serialize_definitions(&self) -> Result<String, String> {
        let mut connections = self.connections.values().cloned().collect::<Vec<_>>();
        connections.sort_by(|left, right| left.id.cmp(&right.id));
        for connection in &mut connections {
            connection.status = L2TPStatus::Disconnected;
            connection.connected_at = None;
            connection.local_ip = None;
            connection.remote_ip = None;
            connection.ras_entry_name = None;
            connection.process_id = None;
        }
        serialize_profile_definitions(&connections)
    }

    fn deserialize_definitions(&mut self, data: &str) -> Result<(), String> {
        let mut restored = HashMap::new();
        for mut connection in deserialize_profile_definitions::<L2TPConnection>(data)? {
            validate_persisted_profile_id(&connection.id, "L2TP")?;
            connection.status = L2TPStatus::Disconnected;
            connection.connected_at = None;
            connection.local_ip = None;
            connection.remote_ip = None;
            connection.ras_entry_name = None;
            connection.process_id = None;
            let id = connection.id.clone();
            if restored.insert(id, connection).is_some() {
                return Err("L2TP profile data contains a duplicate id".to_string());
            }
        }
        self.connections = restored;
        Ok(())
    }
}

#[cfg(not(windows))]
fn compose_setup_cleanup_error(setup_error: String, cleanup_error: Option<String>) -> String {
    match cleanup_error {
        Some(cleanup_error) => {
            format!("{setup_error}; additionally failed to roll back VPN setup: {cleanup_error}")
        }
        None => setup_error,
    }
}

#[cfg(not(windows))]
async fn setup_strongswan_connection(
    _conn_name: &str,
    _config: &L2TPConfig,
) -> Result<Option<u32>, String> {
    Err(
        "L2TP/IPsec is not enabled on this platform because the backend does not yet create an isolated xl2tpd/pppd control profile and verify the PPP data plane; use the Windows native profile"
            .to_string(),
    )
}
