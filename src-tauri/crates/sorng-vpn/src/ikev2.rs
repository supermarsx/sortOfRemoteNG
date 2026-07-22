use crate::persistence::{
    deserialize_profile_definitions, load_service_data, save_service_data,
    serialize_profile_definitions, validate_persisted_profile_id, Persistable, RestoreOutcome,
};
#[cfg(windows)]
use crate::ras_helper;
use crate::routing::{VpnRoutingMode, VpnRoutingPolicy};
#[cfg(not(windows))]
use crate::strongswan_helper;
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

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct IKEv2SecretPresence {
    pub password: bool,
    pub private_key: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct IKEv2ConnectionView {
    #[serde(flatten)]
    pub connection: IKEv2Connection,
    pub secret_presence: IKEv2SecretPresence,
}

impl IKEv2Connection {
    pub fn into_redacted_view(mut self) -> IKEv2ConnectionView {
        let secret_presence = IKEv2SecretPresence {
            password: self.config.password.is_some(),
            private_key: self.config.private_key.is_some(),
        };
        self.config.password = None;
        self.config.private_key = None;
        IKEv2ConnectionView {
            connection: self,
            secret_presence,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct IKEv2SecretMutation {
    pub clear_password: bool,
    pub clear_private_key: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum IKEv2Status {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
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
    #[serde(default)]
    pub routing_mode: VpnRoutingMode,
    #[serde(default)]
    pub remote_subnets: Vec<String>,
    #[serde(default)]
    pub custom_options: Vec<String>,
}

impl IKEv2Config {
    fn validated_remote_subnets(&self) -> Result<Vec<String>, String> {
        VpnRoutingPolicy {
            routing_mode: self.routing_mode,
            remote_subnets: self.remote_subnets.clone(),
        }
        .validated_remote_subnets()
    }
}

pub struct IKEv2Service {
    connections: HashMap<String, IKEv2Connection>,
    emitter: Option<DynEventEmitter>,
    storage: Option<sorng_storage::storage::SecureStorageState>,
    definitions_loaded: bool,
}

impl IKEv2Service {
    pub fn new() -> IKEv2ServiceState {
        Arc::new(Mutex::new(IKEv2Service {
            connections: HashMap::new(),
            emitter: None,
            storage: None,
            definitions_loaded: true,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> IKEv2ServiceState {
        Arc::new(Mutex::new(IKEv2Service {
            connections: HashMap::new(),
            emitter: Some(emitter),
            storage: None,
            definitions_loaded: true,
        }))
    }

    pub fn new_persistent(
        emitter: DynEventEmitter,
        storage: sorng_storage::storage::SecureStorageState,
    ) -> IKEv2ServiceState {
        Arc::new(Mutex::new(IKEv2Service {
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
                "IKEv2 profile storage is unreadable; stored profiles were left untouched: {error}"
            )),
        }
    }

    async fn persist_or_rollback(
        &mut self,
        previous: HashMap<String, IKEv2Connection>,
    ) -> Result<(), String> {
        let Some(storage) = self.storage.clone() else {
            return Ok(());
        };
        if let Err(error) = save_service_data(self, &storage).await {
            self.connections = previous;
            return Err(format!(
                "IKEv2 profile change was not saved and has been rolled back: {error}"
            ));
        }
        Ok(())
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
        self.ensure_persisted_loaded().await?;
        config.validated_remote_subnets()?;
        let previous = self.connections.clone();
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
        self.persist_or_rollback(previous).await?;
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let config = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "IKEv2 connection not found".to_string())?
            .config
            .clone();
        let remote_subnets = config.validated_remote_subnets()?;
        if self.probe_connection_active(connection_id).await? {
            return Ok(());
        }
        let connection = self
            .connections
            .get_mut(connection_id)
            .expect("checked above");

        connection.status = IKEv2Status::Connecting;
        #[cfg(windows)]
        let entry_name = format!("SoRNG_IKEv2_{}", &connection_id[..8]);

        #[cfg(windows)]
        {
            if matches!(config.eap_method.as_deref(), Some("tls"))
                && (config.certificate.is_some()
                    || config.private_key.is_some()
                    || config.ca_certificate.is_some())
            {
                let error = "Windows EAP-TLS uses certificates from the current user's certificate store; certificate, private-key, and CA file fields are not imported by this backend"
                    .to_string();
                connection.status = IKEv2Status::Error(error.clone());
                self.emit_status(
                    connection_id,
                    "error",
                    serde_json::json!({ "error": error }),
                );
                return Err(error);
            }
            // Create RAS entry with IKEv2 tunnel type
            ras_helper::create_ras_entry(&entry_name, &config.server, "Ikev2").await?;

            if let Err(error) = ras_helper::configure_ras_routing(
                &entry_name,
                matches!(config.routing_mode, VpnRoutingMode::Split),
                &remote_subnets,
            )
            .await
            {
                let cleanup_error = ras_helper::remove_ras_entry(&entry_name).await.err();
                let error = compose_setup_cleanup_error(error, cleanup_error);
                connection.status = IKEv2Status::Error(error.clone());
                self.emit_status(
                    connection_id,
                    "error",
                    serde_json::json!({ "error": error }),
                );
                return Err(error);
            }

            // Set EAP method if specified
            if let Some(eap) = &config.eap_method {
                if let Err(error) = ras_helper::configure_ras_eap(&entry_name, eap).await {
                    let cleanup_error = ras_helper::remove_ras_entry(&entry_name).await.err();
                    let error = compose_setup_cleanup_error(error, cleanup_error);
                    connection.status = IKEv2Status::Error(error.clone());
                    self.emit_status(
                        connection_id,
                        "error",
                        serde_json::json!({ "error": error }),
                    );
                    return Err(error);
                }
            }

            let username = config.username.as_deref().unwrap_or("");
            let password = config.password.as_deref().unwrap_or("");

            if let Err(setup_error) =
                ras_helper::rasdial_connect(&entry_name, username, password).await
            {
                let cleanup_error = ras_helper::remove_ras_entry(&entry_name).await.err();
                let error = compose_setup_cleanup_error(setup_error, cleanup_error);
                connection.status = IKEv2Status::Error(error.clone());
                self.emit_status(
                    connection_id,
                    "error",
                    serde_json::json!({ "error": error }),
                );
                return Err(error);
            }

            connection.ras_entry_name = Some(entry_name);
            connection.remote_ip = Some(config.server.clone());
        }

        #[cfg(not(windows))]
        {
            let conn_name = format!("sorng_ikev2_{}", &connection_id[..8]);
            if let Err(setup_error) =
                setup_strongswan_connection(&conn_name, &config, &remote_subnets).await
            {
                let cleanup_error = strongswan_helper::cleanup_ipsec_files(&conn_name)
                    .await
                    .err();
                let error = compose_setup_cleanup_error(setup_error, cleanup_error);
                connection.status = IKEv2Status::Error(error.clone());
                self.emit_status(
                    connection_id,
                    "error",
                    serde_json::json!({ "error": error }),
                );
                return Err(error);
            }
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
        self.ensure_persisted_loaded().await?;
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "IKEv2 connection not found".to_string())?;

        connection.status = IKEv2Status::Disconnecting;

        #[cfg(windows)]
        let teardown_result =
            ras_helper::teardown_ras_entry(&format!("SoRNG_IKEv2_{}", &connection_id[..8])).await;

        #[cfg(not(windows))]
        let teardown_result = strongswan_helper::teardown_ipsec_connection(&format!(
            "sorng_ikev2_{}",
            &connection_id[..8]
        ))
        .await;

        if let Err(error) = teardown_result {
            connection.status = IKEv2Status::Error(error.clone());
            self.emit_status(
                connection_id,
                "error",
                serde_json::json!({ "error": error }),
            );
            return Err(error);
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

    pub async fn get_connection(&mut self, connection_id: &str) -> Result<IKEv2Connection, String> {
        self.ensure_persisted_loaded().await?;
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "IKEv2 connection not found".to_string())
    }

    pub async fn list_connections(&mut self) -> Result<Vec<IKEv2Connection>, String> {
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

    pub async fn get_status(&mut self, connection_id: &str) -> Result<IKEv2Status, String> {
        self.ensure_persisted_loaded().await?;
        let connection = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "IKEv2 connection not found".to_string())?;
        Ok(connection.status.clone())
    }

    pub async fn probe_connection_active(&mut self, connection_id: &str) -> Result<bool, String> {
        self.ensure_persisted_loaded().await?;
        self.connections
            .get(connection_id)
            .ok_or_else(|| "IKEv2 connection not found".to_string())?
            .config
            .validated_remote_subnets()?;
        #[cfg(windows)]
        let active =
            ras_helper::is_ras_active(&format!("SoRNG_IKEv2_{}", &connection_id[..8])).await?;
        #[cfg(not(windows))]
        let active =
            strongswan_helper::is_ipsec_active(&format!("sorng_ikev2_{}", &connection_id[..8]))
                .await?;
        let connection = self
            .connections
            .get_mut(connection_id)
            .expect("checked above");
        connection.status = if active {
            IKEv2Status::Connected
        } else {
            IKEv2Status::Disconnected
        };
        Ok(active)
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<IKEv2Config>,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let current_config = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "IKEv2 connection not found".to_string())?
            .config
            .clone();
        if let Some(config) = config.as_ref() {
            config.validated_remote_subnets()?;
            let changed = config != &current_config;
            if changed {
                let active = self.probe_connection_active(connection_id).await?;
                crate::routing::ensure_inactive_native_update("IKEv2", changed, active)?;
            }
        }
        let previous = self.connections.clone();
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
        self.persist_or_rollback(previous).await
    }

    pub async fn update_connection_from_ipc(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        mut config: Option<IKEv2Config>,
        secret_mutation: IKEv2SecretMutation,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if config.is_none() && (secret_mutation.clear_password || secret_mutation.clear_private_key)
        {
            let mut current = self
                .connections
                .get(connection_id)
                .ok_or_else(|| "IKEv2 connection not found".to_string())?
                .config
                .clone();
            if secret_mutation.clear_password {
                current.password = None;
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
                .ok_or_else(|| "IKEv2 connection not found".to_string())?
                .config;
            crate::persistence::merge_secret_update(
                &stored.password,
                &mut submitted.password,
                secret_mutation.clear_password,
                "IKEv2 password",
            )?;
            crate::persistence::merge_secret_update(
                &stored.private_key,
                &mut submitted.private_key,
                secret_mutation.clear_private_key,
                "IKEv2 private key",
            )?;
        }
        self.update_connection(connection_id, name, config).await
    }
}

#[async_trait::async_trait]
impl Persistable for IKEv2Service {
    fn storage_key(&self) -> &'static str {
        crate::persistence::keys::IKEV2
    }

    fn serialize_definitions(&self) -> Result<String, String> {
        let mut connections = self.connections.values().cloned().collect::<Vec<_>>();
        connections.sort_by(|left, right| left.id.cmp(&right.id));
        for connection in &mut connections {
            connection.status = IKEv2Status::Disconnected;
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
        for mut connection in deserialize_profile_definitions::<IKEv2Connection>(data)? {
            validate_persisted_profile_id(&connection.id, "IKEv2")?;
            connection.config.validated_remote_subnets()?;
            connection.status = IKEv2Status::Disconnected;
            connection.connected_at = None;
            connection.local_ip = None;
            connection.remote_ip = None;
            connection.ras_entry_name = None;
            connection.process_id = None;
            let id = connection.id.clone();
            if restored.insert(id, connection).is_some() {
                return Err("IKEv2 profile data contains a duplicate id".to_string());
            }
        }
        self.connections = restored;
        Ok(())
    }
}

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
    conn_name: &str,
    config: &IKEv2Config,
    remote_subnets: &[String],
) -> Result<(), String> {
    let (local_auth, remote_auth, eap_identity) = match config.eap_method.as_deref() {
        Some("mschapv2") => {
            let identity = config
                .username
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "IKEv2 EAP-MSCHAPv2 requires a non-empty username".to_string())?;
            if config.password.as_deref().unwrap_or_default().is_empty() {
                return Err("IKEv2 EAP-MSCHAPv2 requires a non-empty password".to_string());
            }
            ("eap-mschapv2", "pubkey", Some(identity))
        }
        Some("tls") => {
            return Err(
                "IKEv2 EAP-TLS is not enabled on this strongSwan backend because client certificate, private-key, CA, and AAA identity wiring must be configured together; use certificate authentication or a Windows native profile"
                    .to_string(),
            )
        }
        Some("peap") => {
            return Err(
                "IKEv2 PEAP is not enabled on this strongSwan backend because its inner authentication and AAA identity are not represented by this profile"
                    .to_string(),
            )
        }
        Some(_) => return Err("Unsupported IKEv2 EAP method".to_string()),
        None if config.certificate.is_some()
            || config.private_key.is_some()
            || config.ca_certificate.is_some() =>
        {
            return Err(
                "IKEv2 certificate authentication is not enabled on this strongSwan backend because certificate and CA staging is not implemented safely"
                    .to_string(),
            )
        }
        None => {
            if config.password.as_deref().unwrap_or_default().is_empty() {
                return Err("IKEv2 PSK authentication requires a non-empty secret".to_string());
            }
            ("psk", "psk", None)
        }
    };

    strongswan_helper::write_ipsec_conf(strongswan_helper::IpsecConnectionSpec {
        conn_name,
        server: &config.server,
        local_id: config.local_id.as_deref(),
        remote_id: config.remote_id.as_deref(),
        local_auth,
        remote_auth,
        eap_identity,
        phase1: config.phase1_algorithms.as_deref(),
        phase2: config.phase2_algorithms.as_deref(),
        remote_subnets,
    })
    .await?;

    if let Some(password) = &config.password {
        let secret_type = if local_auth.starts_with("eap") {
            "EAP"
        } else {
            "PSK"
        };
        strongswan_helper::write_ipsec_secrets(
            conn_name,
            eap_identity.or(config.local_id.as_deref()),
            config.remote_id.as_deref().unwrap_or(&config.server),
            secret_type,
            password,
        )
        .await?;
    }

    strongswan_helper::ipsec_up_transactional(conn_name).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn backend_probe_rejects_invalid_stored_routing_before_os_activity_check() {
        let state = IKEv2Service::new();
        let mut service = state.lock().await;
        let config = serde_json::from_value(serde_json::json!({
            "server": "ike.example.com"
        }))
        .unwrap();
        let id = service
            .create_connection("IKEv2".to_string(), config)
            .await
            .unwrap();
        let marker = "private-route-marker.example/24";
        let config = &mut service.connections.get_mut(&id).unwrap().config;
        config.routing_mode = VpnRoutingMode::Split;
        config.remote_subnets = vec![marker.to_string()];

        let error = service.probe_connection_active(&id).await.unwrap_err();
        assert!(!error.contains(marker));
        assert!(error.contains("remote_subnets"));
    }
}
