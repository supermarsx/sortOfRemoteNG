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

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct IPsecSecretPresence {
    pub psk: bool,
    pub private_key: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct IPsecConnectionView {
    #[serde(flatten)]
    pub connection: IPsecConnection,
    pub secret_presence: IPsecSecretPresence,
}

impl IPsecConnection {
    pub fn into_redacted_view(mut self) -> IPsecConnectionView {
        let secret_presence = IPsecSecretPresence {
            psk: self.config.psk.is_some(),
            private_key: self.config.private_key.is_some(),
        };
        self.config.psk = None;
        self.config.private_key = None;
        IPsecConnectionView {
            connection: self,
            secret_presence,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct IPsecSecretMutation {
    pub clear_psk: bool,
    pub clear_private_key: bool,
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
#[serde(deny_unknown_fields)]
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
    #[serde(default)]
    pub custom_options: Vec<String>,
}

pub struct IPsecService {
    connections: HashMap<String, IPsecConnection>,
    emitter: Option<DynEventEmitter>,
    storage: Option<sorng_storage::storage::SecureStorageState>,
    definitions_loaded: bool,
}

impl IPsecService {
    pub fn new() -> IPsecServiceState {
        Arc::new(Mutex::new(IPsecService {
            connections: HashMap::new(),
            emitter: None,
            storage: None,
            definitions_loaded: true,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> IPsecServiceState {
        Arc::new(Mutex::new(IPsecService {
            connections: HashMap::new(),
            emitter: Some(emitter),
            storage: None,
            definitions_loaded: true,
        }))
    }

    pub fn new_persistent(
        emitter: DynEventEmitter,
        storage: sorng_storage::storage::SecureStorageState,
    ) -> IPsecServiceState {
        Arc::new(Mutex::new(IPsecService {
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
                "IPsec profile storage is unreadable; stored profiles were left untouched: {error}"
            )),
        }
    }

    async fn persist_or_rollback(
        &mut self,
        previous: HashMap<String, IPsecConnection>,
    ) -> Result<(), String> {
        let Some(storage) = self.storage.clone() else {
            return Ok(());
        };
        if let Err(error) = save_service_data(self, &storage).await {
            self.connections = previous;
            return Err(format!(
                "IPsec profile change was not saved and has been rolled back: {error}"
            ));
        }
        Ok(())
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
        self.ensure_persisted_loaded().await?;
        let previous = self.connections.clone();
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
        self.persist_or_rollback(previous).await?;
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if !self.connections.contains_key(connection_id) {
            return Err("IPsec connection not found".to_string());
        }
        if self.probe_connection_active(connection_id).await? {
            return Ok(());
        }
        let connection = self
            .connections
            .get_mut(connection_id)
            .expect("checked above");

        connection.status = IPsecStatus::Connecting;
        let config = connection.config.clone();
        #[cfg(windows)]
        let entry_name = format!("SoRNG_IPsec_{}", &connection_id[..8]);

        #[cfg(windows)]
        {
            if config.psk.is_some() {
                return Err(
                    "Windows built-in IKEv2 profiles do not support client PSK authentication; use an L2TP/IPsec profile for a pre-shared key"
                        .to_string(),
                );
            }
            // Windows: use IKEv2 tunnel type as the closest RAS equivalent for raw IPsec
            ras_helper::create_ras_entry(&entry_name, &config.server, "Ikev2").await?;

            // rasdial doesn't use username/password for pure IPsec, but we try anyway
            let username = "";
            let password = "";

            if let Err(e) = ras_helper::rasdial_connect(&entry_name, username, password).await {
                let _ = ras_helper::remove_ras_entry(&entry_name).await;
                connection.status = IPsecStatus::Error(e.clone());
                self.emit_status(connection_id, "error", serde_json::json!({ "error": e }));
                return Err(e);
            }

            connection.ras_entry_name = Some(entry_name);
            connection.remote_ip = Some(config.server.clone());
        }

        #[cfg(not(windows))]
        {
            let conn_name = format!("sorng_ipsec_{}", &connection_id[..8]);
            if let Err(setup_error) = setup_strongswan_connection(&conn_name, &config).await {
                let cleanup_error = strongswan_helper::cleanup_ipsec_files(&conn_name)
                    .await
                    .err();
                let error = compose_setup_cleanup_error(setup_error, cleanup_error);
                connection.status = IPsecStatus::Error(error.clone());
                self.emit_status(
                    connection_id,
                    "error",
                    serde_json::json!({ "error": error }),
                );
                return Err(error);
            }
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
        self.ensure_persisted_loaded().await?;
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "IPsec connection not found".to_string())?;

        connection.status = IPsecStatus::Disconnecting;

        #[cfg(windows)]
        let teardown_result =
            ras_helper::teardown_ras_entry(&format!("SoRNG_IPsec_{}", &connection_id[..8])).await;

        #[cfg(not(windows))]
        let teardown_result = strongswan_helper::teardown_ipsec_connection(&format!(
            "sorng_ipsec_{}",
            &connection_id[..8]
        ))
        .await;

        if let Err(error) = teardown_result {
            connection.status = IPsecStatus::Error(error.clone());
            self.emit_status(
                connection_id,
                "error",
                serde_json::json!({ "error": error }),
            );
            return Err(error);
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

    pub async fn get_connection(&mut self, connection_id: &str) -> Result<IPsecConnection, String> {
        self.ensure_persisted_loaded().await?;
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "IPsec connection not found".to_string())
    }

    pub async fn list_connections(&mut self) -> Result<Vec<IPsecConnection>, String> {
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

    pub async fn get_status(&mut self, connection_id: &str) -> Result<IPsecStatus, String> {
        self.ensure_persisted_loaded().await?;
        let connection = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "IPsec connection not found".to_string())?;
        Ok(connection.status.clone())
    }

    pub async fn probe_connection_active(&mut self, connection_id: &str) -> Result<bool, String> {
        self.ensure_persisted_loaded().await?;
        if !self.connections.contains_key(connection_id) {
            return Err("IPsec connection not found".to_string());
        }
        #[cfg(windows)]
        let active =
            ras_helper::is_ras_active(&format!("SoRNG_IPsec_{}", &connection_id[..8])).await?;
        #[cfg(not(windows))]
        let active =
            strongswan_helper::is_ipsec_active(&format!("sorng_ipsec_{}", &connection_id[..8]))
                .await?;
        let connection = self
            .connections
            .get_mut(connection_id)
            .expect("checked above");
        connection.status = if active {
            IPsecStatus::Connected
        } else {
            IPsecStatus::Disconnected
        };
        Ok(active)
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<IPsecConfig>,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let previous = self.connections.clone();
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
        self.persist_or_rollback(previous).await
    }

    pub async fn update_connection_from_ipc(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        mut config: Option<IPsecConfig>,
        secret_mutation: IPsecSecretMutation,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if config.is_none() && (secret_mutation.clear_psk || secret_mutation.clear_private_key) {
            let mut current = self
                .connections
                .get(connection_id)
                .ok_or_else(|| "IPsec connection not found".to_string())?
                .config
                .clone();
            if secret_mutation.clear_psk {
                current.psk = None;
            }
            if secret_mutation.clear_private_key {
                current.private_key = None;
            }
            config = Some(current);
        }
        if let Some(submitted) = config.as_mut() {
            let stored = &self
                .connections
                .get(connection_id)
                .ok_or_else(|| "IPsec connection not found".to_string())?
                .config;
            crate::persistence::merge_secret_update(
                &stored.psk,
                &mut submitted.psk,
                secret_mutation.clear_psk,
                "IPsec PSK",
            )?;
            crate::persistence::merge_secret_update(
                &stored.private_key,
                &mut submitted.private_key,
                secret_mutation.clear_private_key,
                "IPsec private key",
            )?;
        }
        self.update_connection(connection_id, name, config).await
    }
}

#[async_trait::async_trait]
impl Persistable for IPsecService {
    fn storage_key(&self) -> &'static str {
        crate::persistence::keys::IPSEC
    }

    fn serialize_definitions(&self) -> Result<String, String> {
        let mut connections = self.connections.values().cloned().collect::<Vec<_>>();
        connections.sort_by(|left, right| left.id.cmp(&right.id));
        for connection in &mut connections {
            connection.status = IPsecStatus::Disconnected;
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
        for mut connection in deserialize_profile_definitions::<IPsecConnection>(data)? {
            validate_persisted_profile_id(&connection.id, "IPsec")?;
            connection.status = IPsecStatus::Disconnected;
            connection.connected_at = None;
            connection.local_ip = None;
            connection.remote_ip = None;
            connection.ras_entry_name = None;
            connection.process_id = None;
            let id = connection.id.clone();
            if restored.insert(id, connection).is_some() {
                return Err("IPsec profile data contains a duplicate id".to_string());
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
async fn setup_strongswan_connection(conn_name: &str, config: &IPsecConfig) -> Result<(), String> {
    match config.auth_method.as_deref().unwrap_or("psk") {
        "psk" => {}
        "certificate" => {
            return Err(
                "Legacy IPsec certificate authentication is disabled because certificate and CA staging is not implemented safely"
                    .to_string(),
            )
        }
        "eap" => {
            return Err(
                "Legacy IPsec EAP requires an explicit identity and credential model; use an IKEv2 profile instead"
                    .to_string(),
            )
        }
        _ => return Err("Unsupported legacy IPsec authentication method".to_string()),
    }
    let psk = config
        .psk
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Legacy IPsec PSK authentication requires a non-empty PSK".to_string())?;

    strongswan_helper::write_ipsec_conf(strongswan_helper::IpsecConnectionSpec {
        conn_name,
        server: &config.server,
        local_id: None,
        remote_id: None,
        local_auth: "psk",
        remote_auth: "psk",
        eap_identity: None,
        phase1: config.phase1_proposals.as_deref(),
        phase2: config.phase2_proposals.as_deref(),
    })
    .await?;
    strongswan_helper::write_ipsec_secrets(conn_name, None, &config.server, "PSK", psk).await?;
    strongswan_helper::ipsec_up_transactional(conn_name).await
}
