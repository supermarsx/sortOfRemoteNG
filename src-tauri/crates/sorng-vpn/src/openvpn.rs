use crate::persistence::{
    deserialize_profile_definitions, load_service_data, save_service_data,
    serialize_profile_definitions, Persistable, RestoreOutcome,
};
use crate::platform;
use chrono::{DateTime, Utc};
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{Duration, Instant};
use uuid::Uuid;
use zeroize::Zeroize;

pub type OpenVPNServiceState = Arc<Mutex<OpenVPNService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenVPNConnection {
    pub id: String,
    pub name: String,
    pub config: OpenVPNConfig,
    pub status: OpenVPNStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub process_id: Option<u32>,
    pub local_ip: Option<String>,
    pub remote_ip: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct OpenVPNSecretPresence {
    pub password: bool,
    pub inline_config: bool,
    pub client_key: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct OpenVPNConnectionView {
    #[serde(flatten)]
    pub connection: OpenVPNConnection,
    pub secret_presence: OpenVPNSecretPresence,
}

impl OpenVPNConnection {
    pub fn into_redacted_view(mut self) -> OpenVPNConnectionView {
        let secret_presence = OpenVPNSecretPresence {
            password: self.config.password.is_some(),
            inline_config: self.config.inline_config.is_some(),
            client_key: self.config.client_key.is_some(),
        };
        self.config.password = None;
        self.config.inline_config = None;
        self.config.client_key = None;
        OpenVPNConnectionView {
            connection: self,
            secret_presence,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct OpenVPNSecretMutation {
    pub clear_password: bool,
    pub clear_inline_config: bool,
    pub clear_client_key: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum OpenVPNStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenVPNConfig {
    pub config_file: Option<String>,
    /// Imported .ovpn content. Persisted only inside encrypted profile storage
    /// and materialized as an owner-only temporary file for process startup.
    pub inline_config: Option<String>,
    pub auth_file: Option<String>,
    pub ca_cert: Option<String>,
    pub client_cert: Option<String>,
    pub client_key: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub remote_host: Option<String>,
    pub remote_port: Option<u16>,
    pub protocol: Option<String>, // "udp" or "tcp"
    pub cipher: Option<String>,
    pub auth: Option<String>,
    pub tls_auth: Option<bool>,
    pub tls_auth_file: Option<String>,
    pub tls_crypt: Option<bool>,
    pub tls_crypt_file: Option<String>,
    pub compression: Option<bool>,
    pub mss_fix: Option<u16>,
    pub tun_mtu: Option<u16>,
    pub fragment: Option<u16>,
    pub mtu_discover: Option<bool>,
    pub keep_alive: Option<KeepAliveConfig>,
    pub route_no_pull: Option<bool>,
    pub routes: Vec<RouteConfig>,
    pub dns_servers: Vec<DNSConfig>,
    pub custom_options: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KeepAliveConfig {
    pub interval: u16,
    pub timeout: u16,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RouteConfig {
    pub network: String,
    pub netmask: String,
    pub gateway: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DNSConfig {
    pub server: String,
    pub domain: Option<String>,
}

#[async_trait::async_trait]
trait OpenVPNProcessTerminator: Send + Sync {
    async fn terminate_child(&self, child: &mut Child) -> Result<(), String>;
    async fn terminate_pid(&self, pid: u32) -> Result<(), String>;
}

struct SystemOpenVPNProcessTerminator;

#[async_trait::async_trait]
impl OpenVPNProcessTerminator for SystemOpenVPNProcessTerminator {
    async fn terminate_child(&self, child: &mut Child) -> Result<(), String> {
        terminate_openvpn_child(child).await
    }

    async fn terminate_pid(&self, pid: u32) -> Result<(), String> {
        terminate_openvpn_pid(pid).await
    }
}

pub struct OpenVPNService {
    connections: HashMap<String, OpenVPNConnection>,
    processes: HashMap<String, Child>,
    terminator: Arc<dyn OpenVPNProcessTerminator>,
    emitter: Option<DynEventEmitter>,
    storage: Option<sorng_storage::storage::SecureStorageState>,
    definitions_loaded: bool,
}

impl OpenVPNService {
    pub fn new() -> OpenVPNServiceState {
        Arc::new(Mutex::new(OpenVPNService {
            connections: HashMap::new(),
            processes: HashMap::new(),
            terminator: Arc::new(SystemOpenVPNProcessTerminator),
            emitter: None,
            storage: None,
            definitions_loaded: true,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> OpenVPNServiceState {
        Arc::new(Mutex::new(OpenVPNService {
            connections: HashMap::new(),
            processes: HashMap::new(),
            terminator: Arc::new(SystemOpenVPNProcessTerminator),
            emitter: Some(emitter),
            storage: None,
            definitions_loaded: true,
        }))
    }

    pub fn new_persistent(
        emitter: DynEventEmitter,
        storage: sorng_storage::storage::SecureStorageState,
    ) -> OpenVPNServiceState {
        Arc::new(Mutex::new(OpenVPNService {
            connections: HashMap::new(),
            processes: HashMap::new(),
            terminator: Arc::new(SystemOpenVPNProcessTerminator),
            emitter: Some(emitter),
            storage: Some(storage),
            definitions_loaded: false,
        }))
    }

    #[cfg(test)]
    fn new_with_terminator(terminator: Arc<dyn OpenVPNProcessTerminator>) -> OpenVPNServiceState {
        Arc::new(Mutex::new(OpenVPNService {
            connections: HashMap::new(),
            processes: HashMap::new(),
            terminator,
            emitter: None,
            storage: None,
            definitions_loaded: true,
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
            Err(e) => Err(format!(
                "OpenVPN profile storage is unreadable; stored profiles were left untouched: {e}"
            )),
        }
    }

    async fn persist_or_rollback(
        &mut self,
        previous: HashMap<String, OpenVPNConnection>,
    ) -> Result<(), String> {
        let Some(storage) = self.storage.clone() else {
            return Ok(());
        };
        if let Err(e) = save_service_data(self, &storage).await {
            self.connections = previous;
            return Err(format!(
                "OpenVPN profile change was not saved and has been rolled back: {e}"
            ));
        }
        Ok(())
    }

    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "openvpn",
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
        config: OpenVPNConfig,
    ) -> Result<String, String> {
        self.ensure_persisted_loaded().await?;
        validate_openvpn_profile_config(&config)?;
        let previous = self.connections.clone();
        let id = Uuid::new_v4().to_string();
        let connection = OpenVPNConnection {
            id: id.clone(),
            name,
            config,
            status: OpenVPNStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            process_id: None,
            local_ip: None,
            remote_ip: None,
        };

        self.connections.insert(id.clone(), connection);
        self.persist_or_rollback(previous).await?;
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        self.refresh_process_status(connection_id).await?;

        let config = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "OpenVPN connection not found".to_string())?
            .config
            .clone();
        if matches!(
            self.connections.get(connection_id).map(|c| &c.status),
            Some(OpenVPNStatus::Connected)
        ) {
            return Ok(());
        }
        validate_openvpn_profile_config(&config)?;

        if self.processes.contains_key(connection_id)
            || self
                .connections
                .get(connection_id)
                .and_then(|connection| connection.process_id)
                .is_some()
        {
            if let Err(cleanup_error) = self.cleanup_owned_process(connection_id).await {
                let error = format!(
                    "OpenVPN could not clean up the previously owned process; retry cleanup before reconnecting: {cleanup_error}"
                );
                self.set_connection_owned_error(connection_id, &error, None);
                return Err(error);
            }
        }

        if let Some(connection) = self.connections.get_mut(connection_id) {
            connection.status = OpenVPNStatus::Connecting;
            connection.process_id = None;
            connection.connected_at = None;
            connection.local_ip = None;
            connection.remote_ip = None;
        }
        self.emit_status(connection_id, "connecting", serde_json::json!({}));

        match spawn_ready_openvpn(&config, Duration::from_secs(45), self.terminator.as_ref()).await
        {
            Ok(mut child) => {
                let Some(pid) = child.id() else {
                    let failure = cleanup_failed_startup(
                        child,
                        "OpenVPN started without a process id".to_string(),
                        self.terminator.as_ref(),
                    )
                    .await;
                    let error = self.record_startup_failure(connection_id, failure);
                    return Err(error);
                };
                // A final race check catches a process that exited immediately
                // after printing the readiness marker.
                match child.try_wait() {
                    Ok(Some(status)) => {
                        let error = format!(
                            "OpenVPN exited immediately after becoming ready ({})",
                            format_exit_status(status)
                        );
                        self.set_connection_error(connection_id, &error);
                        return Err(error);
                    }
                    Ok(None) => {}
                    Err(e) => {
                        let failure = cleanup_failed_startup(
                            child,
                            format!("Failed to inspect the OpenVPN process after startup: {e}"),
                            self.terminator.as_ref(),
                        )
                        .await;
                        let error = self.record_startup_failure(connection_id, failure);
                        return Err(error);
                    }
                }

                self.processes.insert(connection_id.to_string(), child);
                if let Some(connection) = self.connections.get_mut(connection_id) {
                    connection.status = OpenVPNStatus::Connected;
                    connection.process_id = Some(pid);
                    connection.connected_at = Some(Utc::now());
                }
                self.emit_status(
                    connection_id,
                    "connected",
                    serde_json::json!({ "process_id": pid }),
                );
                Ok(())
            }
            Err(failure) => {
                let error = self.record_startup_failure(connection_id, failure);
                Err(error)
            }
        }
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let fallback_pid = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "OpenVPN connection not found".to_string())?
            .process_id;

        if let Some(connection) = self.connections.get_mut(connection_id) {
            connection.status = OpenVPNStatus::Disconnecting;
        }
        self.emit_status(connection_id, "disconnecting", serde_json::json!({}));

        if self.processes.contains_key(connection_id) || fallback_pid.is_some() {
            if let Err(cleanup_error) = self.cleanup_owned_process(connection_id).await {
                let error = format!(
                    "Failed to stop the owned OpenVPN process; ownership was retained for retry: {cleanup_error}"
                );
                self.set_connection_owned_error(connection_id, &error, fallback_pid);
                return Err(error);
            }
        }

        if let Some(connection) = self.connections.get_mut(connection_id) {
            connection.status = OpenVPNStatus::Disconnected;
            connection.process_id = None;
            connection.connected_at = None;
            connection.local_ip = None;
            connection.remote_ip = None;
        }

        self.emit_status(connection_id, "disconnected", serde_json::json!({}));

        Ok(())
    }

    pub async fn get_connection(
        &mut self,
        connection_id: &str,
    ) -> Result<OpenVPNConnection, String> {
        self.ensure_persisted_loaded().await?;
        self.refresh_process_status(connection_id).await?;
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "OpenVPN connection not found".to_string())
    }

    pub async fn list_connections(&mut self) -> Result<Vec<OpenVPNConnection>, String> {
        self.ensure_persisted_loaded().await?;
        let ids = self.connections.keys().cloned().collect::<Vec<_>>();
        for id in ids {
            self.refresh_process_status(&id).await?;
        }
        Ok(self.connections.values().cloned().collect())
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let connection = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "OpenVPN connection not found".to_string())?;
        if !matches!(connection.status, OpenVPNStatus::Disconnected)
            || connection.process_id.is_some()
            || self.processes.contains_key(connection_id)
        {
            self.disconnect(connection_id).await?;
        }

        let previous = self.connections.clone();
        self.connections.remove(connection_id);
        self.persist_or_rollback(previous).await
    }

    pub async fn get_status(&mut self, connection_id: &str) -> Result<OpenVPNStatus, String> {
        self.ensure_persisted_loaded().await?;
        self.refresh_process_status(connection_id).await?;
        let connection = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "OpenVPN connection not found".to_string())?;
        Ok(connection.status.clone())
    }

    pub async fn probe_connection_active(&mut self, connection_id: &str) -> Result<bool, String> {
        self.ensure_persisted_loaded().await?;
        self.refresh_process_status(connection_id).await?;
        let Some(connection) = self.connections.get(connection_id) else {
            return Ok(false);
        };
        let has_live_child = self.processes.contains_key(connection_id);
        let has_owned_pid = connection.process_id.is_some();

        match connection.status {
            OpenVPNStatus::Connected if has_live_child => Ok(true),
            OpenVPNStatus::Disconnected | OpenVPNStatus::Error(_)
                if !has_live_child && !has_owned_pid =>
            {
                Ok(false)
            }
            _ if has_live_child || has_owned_pid => Err(
                "OpenVPN still has an owned process, but its usable state could not be confirmed"
                    .to_string(),
            ),
            _ => Err(
                "OpenVPN runtime state is transitional or inconsistent; activity could not be confirmed"
                    .to_string(),
            ),
        }
    }

    async fn refresh_process_status(&mut self, connection_id: &str) -> Result<(), String> {
        enum ProcessObservation {
            Exited(String),
            InspectionFailed(String, Option<u32>),
        }

        let observation = match self.processes.get_mut(connection_id) {
            Some(child) => match child.try_wait() {
                Ok(Some(status)) => Some(ProcessObservation::Exited(format_exit_status(status))),
                Ok(None) => None,
                Err(e) => Some(ProcessObservation::InspectionFailed(
                    e.to_string(),
                    child.id(),
                )),
            },
            None => None,
        };

        match observation {
            Some(ProcessObservation::Exited(exit)) => {
                self.processes.remove(connection_id);
                self.set_connection_error(
                    connection_id,
                    &format!("OpenVPN process exited unexpectedly ({exit})"),
                );
            }
            Some(ProcessObservation::InspectionFailed(error, pid)) => {
                let message = format!(
                    "Failed to inspect the owned OpenVPN process; ownership was retained: {error}"
                );
                self.set_connection_owned_error(connection_id, &message, pid);
                return Err(message);
            }
            None => {}
        }
        Ok(())
    }

    async fn cleanup_owned_process(&mut self, connection_id: &str) -> Result<(), String> {
        if let Some(child) = self.processes.get_mut(connection_id) {
            self.terminator.terminate_child(child).await?;
            self.processes.remove(connection_id);
            return Ok(());
        }

        if let Some(pid) = self
            .connections
            .get(connection_id)
            .and_then(|connection| connection.process_id)
        {
            self.terminator.terminate_pid(pid).await?;
        }
        Ok(())
    }

    fn set_connection_error(&mut self, connection_id: &str, error: &str) {
        if let Some(connection) = self.connections.get_mut(connection_id) {
            connection.status = OpenVPNStatus::Error(error.to_string());
            connection.process_id = None;
            connection.connected_at = None;
            connection.local_ip = None;
            connection.remote_ip = None;
        }
        self.emit_status(
            connection_id,
            "error",
            serde_json::json!({ "error": error }),
        );
    }

    fn set_connection_owned_error(
        &mut self,
        connection_id: &str,
        error: &str,
        fallback_pid: Option<u32>,
    ) {
        let owned_pid = self
            .processes
            .get(connection_id)
            .and_then(Child::id)
            .or(fallback_pid)
            .or_else(|| {
                self.connections
                    .get(connection_id)
                    .and_then(|connection| connection.process_id)
            });
        if let Some(connection) = self.connections.get_mut(connection_id) {
            connection.status = OpenVPNStatus::Error(error.to_string());
            connection.process_id = owned_pid;
            connection.local_ip = None;
            connection.remote_ip = None;
        }
        self.emit_status(
            connection_id,
            "error",
            serde_json::json!({ "error": error, "process_id": owned_pid }),
        );
    }

    fn record_startup_failure(
        &mut self,
        connection_id: &str,
        failure: OpenVPNStartupFailure,
    ) -> String {
        let OpenVPNStartupFailure { message, child } = failure;
        if let Some(child) = child {
            let pid = child.id();
            self.processes.insert(connection_id.to_string(), child);
            self.set_connection_owned_error(connection_id, &message, pid);
        } else {
            self.set_connection_error(connection_id, &message);
        }
        message
    }

    pub async fn parse_ovpn_file(&self, ovpn_content: &str) -> Result<OpenVPNConfig, String> {
        let mut config = OpenVPNConfig {
            config_file: None,
            inline_config: Some(ovpn_content.to_string()),
            auth_file: None,
            ca_cert: None,
            client_cert: None,
            client_key: None,
            username: None,
            password: None,
            remote_host: None,
            remote_port: None,
            protocol: None,
            cipher: None,
            auth: None,
            tls_auth: None,
            tls_auth_file: None,
            tls_crypt: None,
            tls_crypt_file: None,
            compression: None,
            mss_fix: None,
            tun_mtu: None,
            fragment: None,
            mtu_discover: None,
            keep_alive: None,
            route_no_pull: None,
            routes: Vec::new(),
            dns_servers: Vec::new(),
            custom_options: Vec::new(),
        };

        let lines: Vec<&str> = ovpn_content.lines().collect();
        let mut i = 0;

        while i < lines.len() {
            let line = lines[i].trim();

            // Skip comments and empty lines
            if line.starts_with('#') || line.starts_with(';') || line.is_empty() {
                i += 1;
                continue;
            }

            // Parse remote directive
            if line.starts_with("remote ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.remote_host = Some(parts[1].to_string());
                    if parts.len() >= 3 {
                        config.remote_port = parts[2].parse().ok();
                    }
                }
            }
            // Parse port directive
            else if line.starts_with("port ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.remote_port = parts[1].parse().ok();
                }
            }
            // Parse proto directive
            else if line.starts_with("proto ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.protocol = Some(parts[1].to_string());
                }
            }
            // Parse cipher directive
            else if line.starts_with("cipher ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.cipher = Some(parts[1].to_string());
                }
            }
            // Parse auth directive
            else if line.starts_with("auth ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.auth = Some(parts[1].to_string());
                }
            }
            // Parse tls-auth directive
            else if line.starts_with("tls-auth ") {
                config.tls_auth = Some(true);
                config.tls_auth_file = line.split_whitespace().nth(1).map(ToString::to_string);
            }
            // Parse tls-crypt directive
            else if line.starts_with("tls-crypt ") {
                config.tls_crypt = Some(true);
                config.tls_crypt_file = line.split_whitespace().nth(1).map(ToString::to_string);
            }
            // Parse compress directive
            else if line.starts_with("compress ") || line == "compress" {
                config.compression = Some(true);
            }
            // Parse mssfix directive
            else if line.starts_with("mssfix ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.mss_fix = parts[1].parse().ok();
                }
            }
            // Parse tun-mtu directive
            else if line.starts_with("tun-mtu ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.tun_mtu = parts[1].parse().ok();
                }
            }
            // Parse fragment directive
            else if line.starts_with("fragment ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.fragment = parts[1].parse().ok();
                }
            }
            // Parse mtu-disc directive
            else if line.starts_with("mtu-disc ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.mtu_discover = Some(parts[1] == "yes");
                }
            }
            // Parse keepalive directive
            else if line.starts_with("keepalive ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    config.keep_alive = Some(KeepAliveConfig {
                        interval: parts[1].parse().unwrap_or(10),
                        timeout: parts[2].parse().unwrap_or(60),
                    });
                }
            }
            // Parse route-no-pull directive
            else if line == "route-no-pull" {
                config.route_no_pull = Some(true);
            }
            // Parse route directive
            else if line.starts_with("route ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    config.routes.push(RouteConfig {
                        network: parts[1].to_string(),
                        netmask: parts[2].to_string(),
                        gateway: parts.get(3).map(|s| s.to_string()),
                    });
                }
            }
            // Parse dhcp-option DNS directive
            else if line.starts_with("dhcp-option DNS ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    config.dns_servers.push(DNSConfig {
                        server: parts[2].to_string(),
                        domain: None,
                    });
                }
            }
            // Parse dhcp-option DOMAIN directive
            else if line.starts_with("dhcp-option DOMAIN ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 && !config.dns_servers.is_empty() {
                    if let Some(dns) = config.dns_servers.last_mut() {
                        dns.domain = Some(parts[2].to_string());
                    }
                }
            }
            // Handle inline certificates and keys
            else if line == "<ca>" {
                let mut cert_content = String::new();
                i += 1;
                while i < lines.len() && lines[i].trim() != "</ca>" {
                    cert_content.push_str(lines[i]);
                    cert_content.push('\n');
                    i += 1;
                }
                // In a real implementation, you'd save this to a temp file
                config.ca_cert = Some("inline_ca_cert".to_string());
            } else if line == "<cert>" {
                let mut cert_content = String::new();
                i += 1;
                while i < lines.len() && lines[i].trim() != "</cert>" {
                    cert_content.push_str(lines[i]);
                    cert_content.push('\n');
                    i += 1;
                }
                config.client_cert = Some("inline_client_cert".to_string());
            } else if line == "<key>" {
                let mut key_content = String::new();
                i += 1;
                while i < lines.len() && lines[i].trim() != "</key>" {
                    key_content.push_str(lines[i]);
                    key_content.push('\n');
                    i += 1;
                }
                config.client_key = Some("inline_client_key".to_string());
            } else if line == "<tls-auth>" {
                let mut tls_auth_content = String::new();
                i += 1;
                while i < lines.len() && lines[i].trim() != "</tls-auth>" {
                    tls_auth_content.push_str(lines[i]);
                    tls_auth_content.push('\n');
                    i += 1;
                }
                config.tls_auth = Some(true);
            } else if line == "<tls-crypt>" {
                let mut tls_crypt_content = String::new();
                i += 1;
                while i < lines.len() && lines[i].trim() != "</tls-crypt>" {
                    tls_crypt_content.push_str(lines[i]);
                    tls_crypt_content.push('\n');
                    i += 1;
                }
                config.tls_crypt = Some(true);
            }
            // Add other directives as custom options
            else if !line.is_empty() {
                config.custom_options.push(line.to_string());
            }

            i += 1;
        }

        Ok(config)
    }

    pub async fn create_connection_from_ovpn(
        &mut self,
        name: String,
        ovpn_content: String,
    ) -> Result<String, String> {
        let config = self.parse_ovpn_file(&ovpn_content).await?;
        self.create_connection(name, config).await
    }

    pub async fn update_connection_auth(
        &mut self,
        connection_id: &str,
        username: Option<String>,
        password: Option<String>,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let previous = self.connections.clone();
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "OpenVPN connection not found".to_string())?;
        if !matches!(connection.status, OpenVPNStatus::Disconnected) {
            return Err(
                "OpenVPN authentication can only be changed while disconnected".to_string(),
            );
        }

        connection.config.username = username;
        connection.config.password = password;
        self.persist_or_rollback(previous).await
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<OpenVPNConfig>,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if let Some(new_config) = config.as_ref() {
            let connection = self
                .connections
                .get(connection_id)
                .ok_or_else(|| "OpenVPN connection not found".to_string())?;
            if !matches!(connection.status, OpenVPNStatus::Disconnected) {
                return Err(
                    "OpenVPN runtime configuration can only be changed while disconnected"
                        .to_string(),
                );
            }
            validate_openvpn_profile_config(new_config)?;
        }
        let previous = self.connections.clone();
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "OpenVPN connection not found".to_string())?;

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
        mut config: Option<OpenVPNConfig>,
        secret_mutation: OpenVPNSecretMutation,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if config.is_none()
            && (secret_mutation.clear_password
                || secret_mutation.clear_inline_config
                || secret_mutation.clear_client_key)
        {
            let mut current = self
                .connections
                .get(connection_id)
                .ok_or_else(|| "OpenVPN connection not found".to_string())?
                .config
                .clone();
            if secret_mutation.clear_password {
                current.password = None;
            }
            if secret_mutation.clear_inline_config {
                current.inline_config = None;
            }
            if secret_mutation.clear_client_key {
                current.client_key = None;
            }
            config = Some(current);
        }
        if let Some(submitted) = config.as_mut() {
            let stored = &self
                .connections
                .get(connection_id)
                .ok_or_else(|| "OpenVPN connection not found".to_string())?
                .config;
            crate::persistence::merge_secret_update(
                &stored.password,
                &mut submitted.password,
                secret_mutation.clear_password,
                "OpenVPN password",
            )?;
            crate::persistence::merge_secret_update(
                &stored.inline_config,
                &mut submitted.inline_config,
                secret_mutation.clear_inline_config,
                "OpenVPN inline configuration",
            )?;
            crate::persistence::merge_secret_update(
                &stored.client_key,
                &mut submitted.client_key,
                secret_mutation.clear_client_key,
                "OpenVPN client key",
            )?;
        }
        self.update_connection(connection_id, name, config).await
    }

    pub async fn set_connection_key_files(
        &mut self,
        connection_id: &str,
        ca_cert: Option<String>,
        client_cert: Option<String>,
        client_key: Option<String>,
        tls_auth: Option<String>,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let previous = self.connections.clone();
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "OpenVPN connection not found".to_string())?;
        if !matches!(connection.status, OpenVPNStatus::Disconnected) {
            return Err("OpenVPN key files can only be changed while disconnected".to_string());
        }

        connection.config.ca_cert = ca_cert;
        connection.config.client_cert = client_cert;
        connection.config.client_key = client_key;

        connection.config.tls_auth = Some(tls_auth.is_some());
        connection.config.tls_auth_file = tls_auth;

        self.persist_or_rollback(previous).await
    }

    pub async fn validate_ovpn_config(&self, ovpn_content: &str) -> Result<Vec<String>, String> {
        validate_tracked_openvpn_config(ovpn_content)?;
        let mut warnings = Vec::new();
        let mut errors = Vec::new();

        let lines: Vec<&str> = ovpn_content.lines().collect();

        let mut has_remote = false;
        let mut has_ca = false;
        let mut has_cert = false;
        let mut has_key = false;

        for line in lines {
            let line = line.trim();

            if line.starts_with("remote ") {
                has_remote = true;
            } else if line == "<ca>" {
                has_ca = true;
            } else if line == "<cert>" {
                has_cert = true;
            } else if line == "<key>" {
                has_key = true;
            } else if line.starts_with("cipher ") {
                // Check if cipher is supported
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let cipher = parts[1];
                    if ![
                        "AES-256-GCM",
                        "AES-128-GCM",
                        "AES-256-CBC",
                        "AES-128-CBC",
                        "BF-CBC",
                    ]
                    .contains(&cipher)
                    {
                        warnings.push(format!("Potentially unsupported cipher: {}", cipher));
                    }
                }
            }
        }

        if !has_remote {
            errors.push("No remote server specified".to_string());
        }

        if !has_ca {
            warnings.push("No CA certificate specified - connection may not be secure".to_string());
        }

        if !has_cert && !has_key {
            warnings.push(
                "No client certificate or key specified - will use password authentication only"
                    .to_string(),
            );
        }

        if !errors.is_empty() {
            return Err(errors.join("; "));
        }

        Ok(warnings)
    }
}

#[async_trait::async_trait]
impl Persistable for OpenVPNService {
    fn storage_key(&self) -> &'static str {
        crate::persistence::keys::OPENVPN
    }

    fn serialize_definitions(&self) -> Result<String, String> {
        let mut connections = self.connections.values().cloned().collect::<Vec<_>>();
        connections.sort_by(|a, b| a.id.cmp(&b.id));
        for connection in &mut connections {
            connection.status = OpenVPNStatus::Disconnected;
            connection.connected_at = None;
            connection.process_id = None;
            connection.local_ip = None;
            connection.remote_ip = None;
        }
        serialize_profile_definitions(&connections)
    }

    fn deserialize_definitions(&mut self, data: &str) -> Result<(), String> {
        let mut restored = HashMap::new();
        for mut connection in deserialize_profile_definitions::<OpenVPNConnection>(data)? {
            if connection.id.trim().is_empty() {
                return Err("OpenVPN profile has an empty id".to_string());
            }
            connection.status = OpenVPNStatus::Disconnected;
            connection.connected_at = None;
            connection.process_id = None;
            connection.local_ip = None;
            connection.remote_ip = None;
            let id = connection.id.clone();
            if restored.insert(id.clone(), connection).is_some() {
                return Err(format!("OpenVPN profile data contains duplicate id '{id}'"));
            }
        }
        self.connections = restored;
        Ok(())
    }
}

fn validate_tracked_openvpn_config(content: &str) -> Result<(), String> {
    for line in content.lines() {
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        let Some(raw_directive) = trimmed.split_whitespace().next() else {
            continue;
        };
        let directive = raw_directive
            .trim_start_matches('-')
            .split('=')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(
            directive.as_str(),
            "config" | "daemon" | "log" | "log-append" | "syslog"
        ) {
            return Err(format!(
                "OpenVPN config directive '{directive}' is incompatible with tracked foreground startup and readiness"
            ));
        }
    }
    Ok(())
}

fn validate_openvpn_path(path: &str, kind: &str) -> Result<(), String> {
    if path.trim().is_empty()
        || path.starts_with('-')
        || path.chars().any(|character| character.is_control())
    {
        return Err(format!("Configured OpenVPN {kind} path is invalid"));
    }
    if !Path::new(path).is_file() {
        return Err(format!("Configured OpenVPN {kind} file does not exist"));
    }
    Ok(())
}

fn validate_openvpn_profile_config(config: &OpenVPNConfig) -> Result<(), String> {
    if let Some(config_file) = &config.config_file {
        validate_openvpn_path(config_file, "config")?;
        let content = std::fs::read_to_string(config_file)
            .map_err(|_| "Configured OpenVPN config file could not be read".to_string())?;
        if content.trim().is_empty() {
            return Err("Configured OpenVPN config file is empty".to_string());
        }
        validate_tracked_openvpn_config(&content)?;
    } else if let Some(inline_config) = &config.inline_config {
        if inline_config.trim().is_empty() {
            return Err("Inline OpenVPN config is empty".to_string());
        }
        validate_tracked_openvpn_config(inline_config)?;
    } else {
        if config
            .remote_host
            .as_deref()
            .map(str::trim)
            .filter(|host| !host.is_empty())
            .is_none()
        {
            return Err("Manual OpenVPN profiles require a remote host".to_string());
        }
        for option in &config.custom_options {
            validate_tracked_openvpn_config(option)?;
        }
        for (path, kind) in [
            (config.ca_cert.as_deref(), "CA certificate"),
            (config.client_cert.as_deref(), "client certificate"),
            (config.client_key.as_deref(), "client key"),
        ] {
            if let Some(path) = path {
                validate_openvpn_path(path, kind)?;
            }
        }
        if config.tls_auth.unwrap_or(false) && config.tls_crypt.unwrap_or(false) {
            return Err(
                "Manual OpenVPN profiles cannot enable both tls-auth and tls-crypt".to_string(),
            );
        }
        if config.tls_auth.unwrap_or(false) {
            let path = config.tls_auth_file.as_deref().ok_or_else(|| {
                "OpenVPN tls-auth is enabled but no key file is configured".to_string()
            })?;
            validate_openvpn_path(path, "tls-auth key")?;
        }
        if config.tls_crypt.unwrap_or(false) {
            let path = config.tls_crypt_file.as_deref().ok_or_else(|| {
                "OpenVPN tls-crypt is enabled but no key file is configured".to_string()
            })?;
            validate_openvpn_path(path, "tls-crypt key")?;
        }
    }

    if let Some(auth_file) = &config.auth_file {
        validate_openvpn_path(auth_file, "authentication")?;
    }
    Ok(())
}

fn append_openvpn_auth_args(args: &mut Vec<String>, config: &OpenVPNConfig) -> Result<(), String> {
    if let Some(auth_file) = &config.auth_file {
        validate_openvpn_path(auth_file, "authentication")?;
        args.extend(["--auth-user-pass".to_string(), auth_file.clone()]);
        args.push("--auth-nocache".to_string());
    } else if config.username.is_some() || config.password.is_some() {
        // A bare --auth-user-pass makes OpenVPN read from the child's stdin.
        args.push("--auth-user-pass".to_string());
        args.push("--auth-nocache".to_string());
    }
    Ok(())
}

fn build_openvpn_args(
    config: &OpenVPNConfig,
    inline_config_path: Option<&Path>,
) -> Result<Vec<String>, String> {
    validate_openvpn_profile_config(config)?;
    if let Some(config_file) = &config.config_file {
        let mut args = vec![
            "--config".to_string(),
            config_file.clone(),
            "--verb".to_string(),
            "3".to_string(),
        ];
        append_openvpn_auth_args(&mut args, config)?;
        return Ok(args);
    }
    if let Some(path) = inline_config_path {
        let path_string = path.to_string_lossy().to_string();
        validate_openvpn_path(&path_string, "temporary config")?;
        let mut args = vec![
            "--config".to_string(),
            path_string,
            "--verb".to_string(),
            "3".to_string(),
        ];
        append_openvpn_auth_args(&mut args, config)?;
        return Ok(args);
    }

    let mut args = vec![
        "--client".to_string(),
        "--dev".to_string(),
        "tun".to_string(),
    ];

    if let Some(remote_host) = &config.remote_host {
        args.extend(["--remote".to_string(), remote_host.clone()]);
    }
    if let Some(remote_port) = config.remote_port {
        args.extend(["--port".to_string(), remote_port.to_string()]);
    }
    if let Some(protocol) = &config.protocol {
        args.extend(["--proto".to_string(), protocol.clone()]);
    }
    if let Some(cipher) = &config.cipher {
        args.extend(["--cipher".to_string(), cipher.clone()]);
    }
    if let Some(auth) = &config.auth {
        args.extend(["--auth".to_string(), auth.clone()]);
    }
    if let Some(ca) = &config.ca_cert {
        args.extend(["--ca".to_string(), ca.clone()]);
    }
    if let Some(cert) = &config.client_cert {
        args.extend(["--cert".to_string(), cert.clone()]);
    }
    if let Some(key) = &config.client_key {
        args.extend(["--key".to_string(), key.clone()]);
    }
    append_openvpn_auth_args(&mut args, config)?;

    if config.tls_auth.unwrap_or(false) {
        let path = config.tls_auth_file.as_ref().ok_or_else(|| {
            "OpenVPN tls-auth is enabled but no key file is configured".to_string()
        })?;
        args.extend(["--tls-auth".to_string(), path.clone()]);
    }
    if config.tls_crypt.unwrap_or(false) {
        let path = config.tls_crypt_file.as_ref().ok_or_else(|| {
            "OpenVPN tls-crypt is enabled but no key file is configured".to_string()
        })?;
        args.extend(["--tls-crypt".to_string(), path.clone()]);
    }
    if config.compression.unwrap_or(false) {
        args.extend(["--compress".to_string(), "lz4".to_string()]);
    }
    if let Some(mss_fix) = config.mss_fix {
        args.extend(["--mssfix".to_string(), mss_fix.to_string()]);
    }
    if let Some(tun_mtu) = config.tun_mtu {
        args.extend(["--tun-mtu".to_string(), tun_mtu.to_string()]);
    }
    if let Some(fragment) = config.fragment {
        args.extend(["--fragment".to_string(), fragment.to_string()]);
    }
    if config.mtu_discover.unwrap_or(false) {
        args.extend(["--mtu-disc".to_string(), "yes".to_string()]);
    }
    if let Some(keep_alive) = &config.keep_alive {
        args.extend([
            "--keepalive".to_string(),
            keep_alive.interval.to_string(),
            keep_alive.timeout.to_string(),
        ]);
    }
    if config.route_no_pull.unwrap_or(false) {
        args.push("--route-nopull".to_string());
    }
    for route in &config.routes {
        args.extend([
            "--route".to_string(),
            route.network.clone(),
            route.netmask.clone(),
        ]);
        if let Some(gateway) = &route.gateway {
            args.push(gateway.clone());
        }
    }
    for dns in &config.dns_servers {
        args.extend([
            "--dhcp-option".to_string(),
            "DNS".to_string(),
            dns.server.clone(),
        ]);
        if let Some(domain) = &dns.domain {
            args.extend([
                "--dhcp-option".to_string(),
                "DOMAIN".to_string(),
                domain.clone(),
            ]);
        }
    }
    for option in &config.custom_options {
        args.extend(option.split_whitespace().map(ToString::to_string));
    }
    // Verbosity 3 reliably includes the canonical readiness marker without
    // exposing credentials.
    args.extend(["--verb".to_string(), "3".to_string()]);
    Ok(args)
}

struct SecureInlineConfig {
    path: PathBuf,
    directory: PathBuf,
}

impl SecureInlineConfig {
    fn path(&self) -> &Path {
        &self.path
    }

    async fn cleanup(&self) {
        let _ = tokio::fs::remove_file(&self.path).await;
        let _ = tokio::fs::remove_dir(&self.directory).await;
    }
}

impl Drop for SecureInlineConfig {
    fn drop(&mut self) {
        // Async cleanup is attempted at every normal call site. This fallback
        // also protects early returns and cancellation.
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_dir(&self.directory);
    }
}

#[cfg(unix)]
fn create_private_temp_directory(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;

    let mut builder = std::fs::DirBuilder::new();
    builder.mode(0o700).create(path)
}

#[cfg(not(unix))]
fn create_private_temp_directory(path: &Path) -> std::io::Result<()> {
    // On Windows this creates an unpredictable per-launch child directory
    // under the user's private temp tree and inherits that tree's ACL.
    std::fs::create_dir(path)
}

#[cfg(unix)]
fn create_private_inline_file(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;

    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
}

#[cfg(not(unix))]
fn create_private_inline_file(path: &Path) -> std::io::Result<std::fs::File> {
    OpenOptions::new().write(true).create_new(true).open(path)
}

async fn write_secure_inline_config(content: &str) -> Result<SecureInlineConfig, String> {
    let directory = std::env::temp_dir().join(format!("sortofremoteng-openvpn-{}", Uuid::new_v4()));
    create_private_temp_directory(&directory)
        .map_err(|e| format!("Failed to create a private OpenVPN temporary directory: {e}"))?;
    let path = directory.join("profile.ovpn");
    let file = match create_private_inline_file(&path) {
        Ok(file) => file,
        Err(e) => {
            let _ = std::fs::remove_dir(&directory);
            return Err(format!(
                "Failed to create a private OpenVPN temporary config: {e}"
            ));
        }
    };
    let temporary = SecureInlineConfig { path, directory };
    let mut file = tokio::fs::File::from_std(file);
    if let Err(e) = file.write_all(content.as_bytes()).await {
        drop(file);
        temporary.cleanup().await;
        return Err(format!("Failed to write the temporary OpenVPN config: {e}"));
    }
    if let Err(e) = file.flush().await {
        drop(file);
        temporary.cleanup().await;
        return Err(format!("Failed to flush the temporary OpenVPN config: {e}"));
    }
    drop(file);
    Ok(temporary)
}

struct OpenVPNStartupFailure {
    message: String,
    child: Option<Child>,
}

impl OpenVPNStartupFailure {
    fn before_process(message: String) -> Self {
        Self {
            message,
            child: None,
        }
    }
}

async fn cleanup_failed_startup(
    mut child: Child,
    startup_error: String,
    terminator: &dyn OpenVPNProcessTerminator,
) -> OpenVPNStartupFailure {
    match terminator.terminate_child(&mut child).await {
        Ok(()) => OpenVPNStartupFailure::before_process(startup_error),
        Err(cleanup_error) => OpenVPNStartupFailure {
            message: format!(
                "{startup_error}; cleanup failed and process ownership was retained: {cleanup_error}"
            ),
            child: Some(child),
        },
    }
}

async fn spawn_ready_openvpn(
    config: &OpenVPNConfig,
    timeout: Duration,
    terminator: &dyn OpenVPNProcessTerminator,
) -> Result<Child, OpenVPNStartupFailure> {
    let inline_path = match (&config.config_file, &config.inline_config) {
        (None, Some(content)) => Some(
            write_secure_inline_config(content)
                .await
                .map_err(OpenVPNStartupFailure::before_process)?,
        ),
        _ => None,
    };
    let args = match build_openvpn_args(config, inline_path.as_ref().map(SecureInlineConfig::path))
    {
        Ok(args) => args,
        Err(e) => {
            if let Some(temporary) = &inline_path {
                temporary.cleanup().await;
            }
            return Err(OpenVPNStartupFailure::before_process(e));
        }
    };
    let binary = match platform::resolve_binary("openvpn") {
        Ok(binary) => binary,
        Err(e) => {
            if let Some(temporary) = &inline_path {
                temporary.cleanup().await;
            }
            return Err(OpenVPNStartupFailure::before_process(format!(
                "Failed to find OpenVPN binary: {e}"
            )));
        }
    };
    let use_stdin_auth =
        config.auth_file.is_none() && (config.username.is_some() || config.password.is_some());
    let mut command = Command::new(binary);
    command
        .args(&args)
        .stdin(if use_stdin_auth {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            if let Some(temporary) = &inline_path {
                temporary.cleanup().await;
            }
            return Err(OpenVPNStartupFailure::before_process(format!(
                "Failed to start OpenVPN: {e}"
            )));
        }
    };

    if use_stdin_auth {
        let username = config.username.as_deref().unwrap_or_default();
        let password = config.password.as_deref().unwrap_or_default();
        let mut credentials = format!("{username}\n{password}\n").into_bytes();
        let write_result = match child.stdin.take() {
            Some(mut stdin) => stdin.write_all(&credentials).await,
            None => Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "OpenVPN stdin unavailable",
            )),
        };
        credentials.zeroize();
        if let Err(e) = write_result {
            if let Some(temporary) = &inline_path {
                temporary.cleanup().await;
            }
            return Err(cleanup_failed_startup(
                child,
                format!("Failed to provide OpenVPN credentials securely: {e}"),
                terminator,
            )
            .await);
        }
    }

    let ready = wait_for_openvpn_readiness(&mut child, timeout).await;
    if let Some(temporary) = &inline_path {
        temporary.cleanup().await;
    }
    if let Err(e) = ready {
        return Err(cleanup_failed_startup(child, e, terminator).await);
    }
    Ok(child)
}

async fn forward_openvpn_output<R>(reader: R, source: &'static str, tx: mpsc::Sender<String>)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        // Sending to a closed receiver returns immediately; continuing the
        // loop still drains the pipe so a long-running OpenVPN process cannot
        // block on stdout/stderr after startup.
        let _ = tx.send(format!("{source}: {line}")).await;
    }
}

async fn wait_for_openvpn_readiness(child: &mut Child, timeout: Duration) -> Result<(), String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "OpenVPN stdout was not captured".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "OpenVPN stderr was not captured".to_string())?;
    let (tx, mut rx) = mpsc::channel::<String>(128);
    tokio::spawn(forward_openvpn_output(stdout, "stdout", tx.clone()));
    tokio::spawn(forward_openvpn_output(stderr, "stderr", tx.clone()));
    drop(tx);

    let deadline = Instant::now() + timeout;
    let mut diagnostics = Vec::<String>::new();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Failed to inspect OpenVPN startup: {e}"))?
        {
            while let Ok(line) = rx.try_recv() {
                remember_openvpn_diagnostic(&mut diagnostics, &line);
            }
            return Err(format!(
                "OpenVPN exited before tunnel readiness ({}){}",
                format_exit_status(status),
                diagnostic_suffix(&diagnostics)
            ));
        }

        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(format!(
                "OpenVPN tunnel did not become ready within {} seconds{}",
                timeout.as_secs(),
                diagnostic_suffix(&diagnostics)
            ));
        }

        match tokio::time::timeout(remaining.min(Duration::from_millis(250)), rx.recv()).await {
            Ok(Some(line)) => {
                remember_openvpn_diagnostic(&mut diagnostics, &line);
                match classify_openvpn_output(&line) {
                    OpenVpnOutputSignal::Ready => return Ok(()),
                    OpenVpnOutputSignal::Fatal => {
                        return Err(format!(
                            "OpenVPN reported a fatal startup error{}",
                            diagnostic_suffix(&diagnostics)
                        ));
                    }
                    OpenVpnOutputSignal::Other => {}
                }
            }
            Ok(None) => {
                // Both pipe readers ended while the process still appears
                // alive. Keep the bounded process poll without busy-spinning.
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(_) => {}
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenVpnOutputSignal {
    Ready,
    Fatal,
    Other,
}

fn classify_openvpn_output(line: &str) -> OpenVpnOutputSignal {
    let lower = line.to_ascii_lowercase();
    if lower.contains("initialization sequence completed") {
        OpenVpnOutputSignal::Ready
    } else if lower.contains("auth_failed")
        || lower.contains("options error:")
        || lower.contains("exiting due to fatal error")
        || lower.contains("cannot open tun/tap")
        || lower.contains("tls error:")
    {
        OpenVpnOutputSignal::Fatal
    } else {
        OpenVpnOutputSignal::Other
    }
}

fn remember_openvpn_diagnostic(diagnostics: &mut Vec<String>, line: &str) {
    let safe = sanitize_openvpn_diagnostic(line);
    if safe.is_empty() {
        return;
    }
    if diagnostics.len() == 4 {
        diagnostics.remove(0);
    }
    diagnostics.push(safe);
}

fn sanitize_openvpn_diagnostic(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    if lower.contains("password")
        || lower.contains("auth-user-pass")
        || lower.contains("private key")
        || lower.contains("auth_key")
    {
        return "OpenVPN diagnostic contained sensitive authentication details (redacted)"
            .to_string();
    }
    line.trim().chars().take(240).collect()
}

fn diagnostic_suffix(diagnostics: &[String]) -> String {
    if diagnostics.is_empty() {
        String::new()
    } else {
        format!(": {}", diagnostics.join(" | "))
    }
}

fn format_exit_status(status: std::process::ExitStatus) -> String {
    status
        .code()
        .map(|code| format!("exit code {code}"))
        .unwrap_or_else(|| "terminated by signal".to_string())
}

const OPENVPN_TERMINATION_TIMEOUT: Duration = Duration::from_secs(5);

async fn wait_for_openvpn_child_exit(child: &mut Child) -> Result<(), String> {
    match tokio::time::timeout(OPENVPN_TERMINATION_TIMEOUT, child.wait()).await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(e)) => Err(format!("failed to wait for OpenVPN process exit: {e}")),
        Err(_) => Err(format!(
            "timed out after {} seconds waiting for OpenVPN process exit",
            OPENVPN_TERMINATION_TIMEOUT.as_secs()
        )),
    }
}

async fn signal_openvpn_pid(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map_err(|e| format!("failed to launch the OpenVPN OS termination fallback: {e}"))?;
        if !status.success() {
            return Err(format!(
                "OpenVPN OS termination fallback failed ({})",
                format_exit_status(status)
            ));
        }
    }
    #[cfg(not(windows))]
    {
        let status = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map_err(|e| format!("failed to launch the OpenVPN OS termination fallback: {e}"))?;
        if !status.success() {
            return Err(format!(
                "OpenVPN OS termination fallback failed ({})",
                format_exit_status(status)
            ));
        }
    }
    Ok(())
}

async fn is_openvpn_pid_running(pid: u32) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output()
            .await
            .map_err(|e| format!("failed to inspect the OpenVPN process id: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "OpenVPN process-id inspection failed ({})",
                format_exit_status(output.status)
            ));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.lines().any(|line| {
            line.split(',')
                .nth(1)
                .map(|field| field.trim().trim_matches('"') == pid.to_string())
                .unwrap_or(false)
        }))
    }
    #[cfg(not(windows))]
    {
        let status = Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map_err(|e| format!("failed to inspect the OpenVPN process id: {e}"))?;
        Ok(status.success())
    }
}

async fn terminate_openvpn_child(child: &mut Child) -> Result<(), String> {
    match child.try_wait() {
        Ok(Some(_)) => return Ok(()),
        Ok(None) => {}
        Err(e) => {
            let Some(pid) = child.id() else {
                return Err(format!(
                    "failed to inspect the OpenVPN process before cleanup and no process id is available: {e}"
                ));
            };
            signal_openvpn_pid(pid).await.map_err(|fallback_error| {
                format!(
                    "failed to inspect the OpenVPN process before cleanup: {e}; {fallback_error}"
                )
            })?;
            return wait_for_openvpn_child_exit(child).await.map_err(|wait_error| {
                format!(
                    "failed to inspect the OpenVPN process before cleanup: {e}; OS fallback was sent but {wait_error}"
                )
            });
        }
    }

    let pid = child.id();
    let primary_error = match child.start_kill() {
        Ok(()) => match wait_for_openvpn_child_exit(child).await {
            Ok(()) => return Ok(()),
            Err(error) => error,
        },
        Err(error) => format!("failed to request OpenVPN process termination: {error}"),
    };

    let Some(pid) = pid else {
        return Err(format!(
            "{primary_error}; no process id is available for OS fallback"
        ));
    };
    signal_openvpn_pid(pid)
        .await
        .map_err(|fallback_error| format!("{primary_error}; {fallback_error}"))?;
    wait_for_openvpn_child_exit(child)
        .await
        .map_err(|wait_error| format!("{primary_error}; OS fallback was sent but {wait_error}"))
}

async fn terminate_openvpn_pid(pid: u32) -> Result<(), String> {
    if !is_openvpn_pid_running(pid).await? {
        return Ok(());
    }
    signal_openvpn_pid(pid).await?;

    let deadline = Instant::now() + OPENVPN_TERMINATION_TIMEOUT;
    loop {
        if !is_openvpn_pid_running(pid).await? {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "timed out after {} seconds verifying OpenVPN process exit",
                OPENVPN_TERMINATION_TIMEOUT.as_secs()
            ));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FailNTimesTerminator {
        remaining_failures: AtomicUsize,
    }

    impl FailNTimesTerminator {
        fn new(failures: usize) -> Self {
            Self {
                remaining_failures: AtomicUsize::new(failures),
            }
        }

        fn should_fail(&self) -> bool {
            self.remaining_failures
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |remaining| {
                    remaining.checked_sub(1)
                })
                .is_ok()
        }
    }

    #[async_trait::async_trait]
    impl OpenVPNProcessTerminator for FailNTimesTerminator {
        async fn terminate_child(&self, child: &mut Child) -> Result<(), String> {
            if self.should_fail() {
                return Err("injected OpenVPN child cleanup failure".to_string());
            }
            SystemOpenVPNProcessTerminator.terminate_child(child).await
        }

        async fn terminate_pid(&self, pid: u32) -> Result<(), String> {
            if self.should_fail() {
                return Err("injected OpenVPN PID cleanup failure".to_string());
            }
            SystemOpenVPNProcessTerminator.terminate_pid(pid).await
        }
    }

    fn spawn_sleeping_test_child() -> Child {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("powershell.exe");
            command.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("sleep");
            command.arg("30");
            command
        };
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("sleeping test child should spawn")
    }

    fn test_file_tree(config_content: &str) -> (PathBuf, PathBuf, PathBuf) {
        let directory = std::env::temp_dir().join(format!(
            "sortofremoteng openvpn args test {}",
            Uuid::new_v4()
        ));
        std::fs::create_dir(&directory).unwrap();
        let config_path = directory.join("profile with spaces.ovpn");
        let auth_path = directory.join("credentials with spaces.txt");
        std::fs::write(&config_path, config_content).unwrap();
        std::fs::write(&auth_path, "user\npassword\n").unwrap();
        (directory, config_path, auth_path)
    }

    fn remove_test_file_tree(directory: &Path) {
        let _ = std::fs::remove_dir_all(directory);
    }

    fn default_config() -> OpenVPNConfig {
        OpenVPNConfig {
            config_file: None,
            inline_config: None,
            auth_file: None,
            ca_cert: None,
            client_cert: None,
            client_key: None,
            username: None,
            password: None,
            remote_host: Some("vpn.example.com".to_string()),
            remote_port: Some(1194),
            protocol: Some("udp".to_string()),
            cipher: None,
            auth: None,
            tls_auth: None,
            tls_auth_file: None,
            tls_crypt: None,
            tls_crypt_file: None,
            compression: None,
            mss_fix: None,
            tun_mtu: None,
            fragment: None,
            mtu_discover: None,
            keep_alive: None,
            route_no_pull: None,
            routes: Vec::new(),
            dns_servers: Vec::new(),
            custom_options: Vec::new(),
        }
    }

    // ── Serde ───────────────────────────────────────────────────────────

    #[test]
    fn openvpn_status_serde_roundtrip() {
        let variants: Vec<OpenVPNStatus> = vec![
            OpenVPNStatus::Disconnected,
            OpenVPNStatus::Connecting,
            OpenVPNStatus::Connected,
            OpenVPNStatus::Disconnecting,
            OpenVPNStatus::Error("test error".to_string()),
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: OpenVPNStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", v), format!("{:?}", back));
        }
    }

    #[test]
    fn openvpn_config_serde_roundtrip() {
        let cfg = default_config();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: OpenVPNConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.remote_host, Some("vpn.example.com".to_string()));
        assert_eq!(back.remote_port, Some(1194));
    }

    #[test]
    fn frontend_snake_case_config_payload_deserializes() {
        let config: OpenVPNConfig = serde_json::from_value(serde_json::json!({
            "remote_host": "vpn.example.com",
            "remote_port": 1194,
            "protocol": "udp",
            "routes": [{
                "network": "10.20.0.0",
                "netmask": "255.255.0.0",
                "gateway": null
            }],
            "dns_servers": [{ "server": "10.20.0.53", "domain": "corp.test" }],
            "custom_options": ["--persist-tun"]
        }))
        .unwrap();

        assert_eq!(config.remote_host.as_deref(), Some("vpn.example.com"));
        assert_eq!(config.routes.len(), 1);
        assert_eq!(config.dns_servers[0].server, "10.20.0.53");
        assert_eq!(config.custom_options, vec!["--persist-tun"]);
    }

    #[test]
    fn openvpn_connection_serde_roundtrip() {
        let conn = OpenVPNConnection {
            id: "abc".to_string(),
            name: "Test VPN".to_string(),
            config: default_config(),
            status: OpenVPNStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            process_id: None,
            local_ip: None,
            remote_ip: None,
        };
        let json = serde_json::to_string(&conn).unwrap();
        let back: OpenVPNConnection = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "abc");
        assert_eq!(back.name, "Test VPN");
    }

    // ── Connection CRUD ─────────────────────────────────────────────────

    #[tokio::test]
    async fn create_connection_returns_uuid() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_config())
            .await
            .unwrap();
        assert!(!id.is_empty());
        // UUID format check
        assert_eq!(id.len(), 36);
    }

    #[tokio::test]
    async fn create_connection_initial_status_disconnected() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_config())
            .await
            .unwrap();
        let conn = svc.get_connection(&id).await.unwrap();
        assert!(matches!(conn.status, OpenVPNStatus::Disconnected));
    }

    #[tokio::test]
    async fn list_connections_empty() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        assert!(svc.list_connections().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn list_connections_after_create() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        svc.create_connection("VPN1".to_string(), default_config())
            .await
            .unwrap();
        svc.create_connection("VPN2".to_string(), default_config())
            .await
            .unwrap();
        assert_eq!(svc.list_connections().await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn get_connection_not_found() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let result = svc.get_connection("nonexistent").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn delete_connection_removes_it() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_config())
            .await
            .unwrap();
        svc.delete_connection(&id).await.unwrap();
        assert!(svc.get_connection(&id).await.is_err());
    }

    #[tokio::test]
    async fn is_connection_active_false_when_disconnected() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_config())
            .await
            .unwrap();
        assert!(!svc.probe_connection_active(&id).await.unwrap());
    }

    #[tokio::test]
    async fn is_connection_active_false_for_nonexistent() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        assert!(!svc.probe_connection_active("nonexistent").await.unwrap());
    }

    #[tokio::test]
    async fn activity_probe_never_reports_inactive_while_process_ownership_is_retained() {
        let state = OpenVPNService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Owned error".to_string(), default_config())
            .await
            .unwrap();
        let connection = service.connections.get_mut(&id).unwrap();
        connection.status = OpenVPNStatus::Error("inspection failed".to_string());
        connection.process_id = Some(4242);

        let error = service.probe_connection_active(&id).await.unwrap_err();
        assert!(error.contains("owned process"));
        assert_eq!(service.connections[&id].process_id, Some(4242));
    }

    #[tokio::test]
    async fn activity_probe_fails_closed_for_connected_state_without_an_owned_process() {
        let state = OpenVPNService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Inconsistent".to_string(), default_config())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status = OpenVPNStatus::Connected;

        let error = service.probe_connection_active(&id).await.unwrap_err();
        assert!(error.contains("inconsistent"));
    }

    #[tokio::test]
    async fn get_status_not_found() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        assert!(svc.get_status("nonexistent").await.is_err());
    }

    // ── Auth / key file updates ─────────────────────────────────────────

    #[tokio::test]
    async fn update_connection_auth() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_config())
            .await
            .unwrap();
        svc.update_connection_auth(&id, Some("user".to_string()), Some("pass".to_string()))
            .await
            .unwrap();
        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.config.username, Some("user".to_string()));
        assert_eq!(conn.config.password, Some("pass".to_string()));
    }

    #[tokio::test]
    async fn update_connection_auth_not_found() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let result = svc.update_connection_auth("nope", None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn set_connection_key_files() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_config())
            .await
            .unwrap();
        svc.set_connection_key_files(
            &id,
            Some("ca.pem".into()),
            Some("cert.pem".into()),
            Some("key.pem".into()),
            Some("ta.key".into()),
        )
        .await
        .unwrap();
        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.config.ca_cert, Some("ca.pem".to_string()));
        assert_eq!(conn.config.tls_auth, Some(true));
    }

    // ── .ovpn parsing ───────────────────────────────────────────────────

    #[tokio::test]
    async fn parse_ovpn_minimal() {
        let state = OpenVPNService::new();
        let svc = state.lock().await;
        let ovpn = "remote vpn.example.com 443\nproto tcp\ncipher AES-256-GCM\n";
        let cfg = svc.parse_ovpn_file(ovpn).await.unwrap();
        assert_eq!(cfg.remote_host, Some("vpn.example.com".to_string()));
        assert_eq!(cfg.remote_port, Some(443));
        assert_eq!(cfg.protocol, Some("tcp".to_string()));
        assert_eq!(cfg.cipher, Some("AES-256-GCM".to_string()));
    }

    #[tokio::test]
    async fn parse_ovpn_with_keepalive() {
        let state = OpenVPNService::new();
        let svc = state.lock().await;
        let ovpn = "remote host 1194\nkeepalive 10 120\n";
        let cfg = svc.parse_ovpn_file(ovpn).await.unwrap();
        let ka = cfg.keep_alive.unwrap();
        assert_eq!(ka.interval, 10);
        assert_eq!(ka.timeout, 120);
    }

    #[tokio::test]
    async fn parse_ovpn_with_routes_and_dns() {
        let state = OpenVPNService::new();
        let svc = state.lock().await;
        let ovpn = "remote host 1194\nroute 10.0.0.0 255.255.0.0\ndhcp-option DNS 8.8.8.8\n";
        let cfg = svc.parse_ovpn_file(ovpn).await.unwrap();
        assert_eq!(cfg.routes.len(), 1);
        assert_eq!(cfg.routes[0].network, "10.0.0.0");
        assert_eq!(cfg.dns_servers.len(), 1);
        assert_eq!(cfg.dns_servers[0].server, "8.8.8.8");
    }

    #[tokio::test]
    async fn parse_ovpn_skips_comments() {
        let state = OpenVPNService::new();
        let svc = state.lock().await;
        let ovpn = "# This is a comment\n; Another comment\nremote host 1194\n";
        let cfg = svc.parse_ovpn_file(ovpn).await.unwrap();
        assert_eq!(cfg.remote_host, Some("host".to_string()));
        assert!(cfg.custom_options.is_empty());
    }

    #[tokio::test]
    async fn parse_ovpn_inline_certs() {
        let state = OpenVPNService::new();
        let svc = state.lock().await;
        let ovpn = "remote host 1194\n<ca>\nMIIC...\n</ca>\n<cert>\nMIID...\n</cert>\n<key>\nMIIE...\n</key>\n";
        let cfg = svc.parse_ovpn_file(ovpn).await.unwrap();
        assert_eq!(cfg.ca_cert, Some("inline_ca_cert".to_string()));
        assert_eq!(cfg.client_cert, Some("inline_client_cert".to_string()));
        assert_eq!(cfg.client_key, Some("inline_client_key".to_string()));
    }

    #[tokio::test]
    async fn parse_ovpn_empty() {
        let state = OpenVPNService::new();
        let svc = state.lock().await;
        let cfg = svc.parse_ovpn_file("").await.unwrap();
        assert!(cfg.remote_host.is_none());
    }

    #[tokio::test]
    async fn parse_ovpn_route_no_pull() {
        let state = OpenVPNService::new();
        let svc = state.lock().await;
        let ovpn = "remote host 1194\nroute-no-pull\n";
        let cfg = svc.parse_ovpn_file(ovpn).await.unwrap();
        assert_eq!(cfg.route_no_pull, Some(true));
    }

    #[tokio::test]
    async fn parse_ovpn_mtu_settings() {
        let state = OpenVPNService::new();
        let svc = state.lock().await;
        let ovpn = "remote host 1194\ntun-mtu 1500\nmssfix 1400\nfragment 1300\nmtu-disc yes\n";
        let cfg = svc.parse_ovpn_file(ovpn).await.unwrap();
        assert_eq!(cfg.tun_mtu, Some(1500));
        assert_eq!(cfg.mss_fix, Some(1400));
        assert_eq!(cfg.fragment, Some(1300));
        assert_eq!(cfg.mtu_discover, Some(true));
    }

    // ── Config validation ───────────────────────────────────────────────

    #[tokio::test]
    async fn validate_ovpn_no_remote_fails() {
        let state = OpenVPNService::new();
        let svc = state.lock().await;
        let result = svc.validate_ovpn_config("cipher AES-256-GCM\n").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No remote"));
    }

    #[tokio::test]
    async fn validate_ovpn_with_remote_ok() {
        let state = OpenVPNService::new();
        let svc = state.lock().await;
        let result = svc
            .validate_ovpn_config(
                "remote vpn.example.com 1194\n<ca>\n</ca>\n<cert>\n</cert>\n<key>\n</key>\n",
            )
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn validate_ovpn_unsupported_cipher_warns() {
        let state = OpenVPNService::new();
        let svc = state.lock().await;
        let result = svc
            .validate_ovpn_config("remote host 1194\ncipher CHACHA20\n")
            .await
            .unwrap();
        assert!(result.iter().any(|w| w.contains("unsupported cipher")));
    }

    #[tokio::test]
    async fn validate_ovpn_no_certs_warns() {
        let state = OpenVPNService::new();
        let svc = state.lock().await;
        let warnings = svc
            .validate_ovpn_config("remote host 1194\n")
            .await
            .unwrap();
        assert!(
            !warnings.is_empty(),
            "Should produce warnings about missing certs"
        );
    }

    // ── create_connection_from_ovpn ─────────────────────────────────────

    #[tokio::test]
    async fn create_from_ovpn() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let ovpn = "remote myserver.com 443\nproto tcp\ncipher AES-256-GCM\n";
        let id = svc
            .create_connection_from_ovpn("MyVPN".to_string(), ovpn.to_string())
            .await
            .unwrap();
        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "MyVPN");
        assert_eq!(conn.config.remote_host, Some("myserver.com".to_string()));
    }

    // ── update_connection ──────────────────────────────────────────────

    #[tokio::test]
    async fn update_connection_name() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let config = default_config();
        let id = svc
            .create_connection("Original".to_string(), config)
            .await
            .unwrap();

        svc.update_connection(&id, Some("Updated Name".to_string()), None)
            .await
            .unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Updated Name");
    }

    #[tokio::test]
    async fn update_connection_config() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let config = default_config();
        let id = svc
            .create_connection("Test".to_string(), config)
            .await
            .unwrap();

        let mut new_config = default_config();
        new_config.remote_host = Some("new-host.example.com".to_string());
        new_config.remote_port = Some(443);

        svc.update_connection(&id, None, Some(new_config))
            .await
            .unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(
            conn.config.remote_host,
            Some("new-host.example.com".to_string())
        );
        assert_eq!(conn.config.remote_port, Some(443));
    }

    #[tokio::test]
    async fn update_connection_both() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let config = default_config();
        let id = svc
            .create_connection("Test".to_string(), config)
            .await
            .unwrap();

        let mut new_config = default_config();
        new_config.protocol = Some("tcp".to_string());

        svc.update_connection(&id, Some("Renamed".to_string()), Some(new_config))
            .await
            .unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Renamed");
        assert_eq!(conn.config.protocol, Some("tcp".to_string()));
    }

    #[tokio::test]
    async fn update_connection_not_found() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let result = svc
            .update_connection("nonexistent", Some("Name".to_string()), None)
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn update_connection_no_changes() {
        let state = OpenVPNService::new();
        let mut svc = state.lock().await;
        let config = default_config();
        let id = svc
            .create_connection("Test".to_string(), config)
            .await
            .unwrap();

        // Update with None for both should be a no-op
        svc.update_connection(&id, None, None).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Test");
    }

    #[test]
    fn command_builder_uses_foreground_process_and_log_readiness() {
        let args = build_openvpn_args(&default_config(), None).unwrap();
        assert!(args.contains(&"--remote".to_string()));
        assert!(args.contains(&"--verb".to_string()));
        assert!(!args.contains(&"--daemon".to_string()));
        assert!(!args.contains(&"--management-client".to_string()));
    }

    #[test]
    fn readiness_and_fatal_output_are_classified() {
        assert_eq!(
            classify_openvpn_output("Initialization Sequence Completed"),
            OpenVpnOutputSignal::Ready
        );
        assert_eq!(
            classify_openvpn_output("AUTH: Received control message: AUTH_FAILED"),
            OpenVpnOutputSignal::Fatal
        );
        assert_eq!(
            classify_openvpn_output("TCP connection established"),
            OpenVpnOutputSignal::Other
        );
    }

    #[test]
    fn startup_diagnostics_redact_authentication_details() {
        let safe = sanitize_openvpn_diagnostic("password=do-not-leak-this");
        assert!(safe.contains("redacted"));
        assert!(!safe.contains("do-not-leak-this"));
    }

    #[tokio::test]
    async fn persisted_profile_keeps_id_and_resets_runtime_state() {
        let state = OpenVPNService::new();
        let mut service = state.lock().await;
        let mut config = default_config();
        config.username = Some("alice".to_string());
        config.password = Some("secret".to_string());
        let id = service
            .create_connection("Office".to_string(), config)
            .await
            .unwrap();
        let connection = service.connections.get_mut(&id).unwrap();
        connection.status = OpenVPNStatus::Connected;
        connection.process_id = Some(1234);
        connection.connected_at = Some(Utc::now());
        let encoded = service.serialize_definitions().unwrap();
        drop(service);

        let restored_state = OpenVPNService::new();
        let mut restored = restored_state.lock().await;
        restored.deserialize_definitions(&encoded).unwrap();
        let connection = restored.get_connection(&id).await.unwrap();
        assert_eq!(connection.id, id);
        assert_eq!(connection.config.username.as_deref(), Some("alice"));
        assert_eq!(connection.config.password.as_deref(), Some("secret"));
        assert!(matches!(connection.status, OpenVPNStatus::Disconnected));
        assert!(connection.process_id.is_none());
        assert!(connection.connected_at.is_none());
    }

    #[tokio::test]
    async fn corrupt_profile_data_does_not_replace_live_definitions() {
        let state = OpenVPNService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_config())
            .await
            .unwrap();
        assert!(service.deserialize_definitions("not-json").is_err());
        assert!(service.connections.contains_key(&id));
    }

    #[test]
    fn config_file_args_preserve_auth_file_as_one_argument() {
        let (directory, config_path, auth_path) = test_file_tree("remote vpn.example.test 1194\n");
        let mut config = default_config();
        config.config_file = Some(config_path.to_string_lossy().to_string());
        config.auth_file = Some(auth_path.to_string_lossy().to_string());
        config.username = Some("argv-username-must-not-appear".to_string());
        config.password = Some("argv-password-must-not-appear".to_string());
        // Config-file content is authoritative for these fields.
        config.tls_auth = Some(true);
        config.tls_crypt = Some(true);
        config.routes.push(RouteConfig {
            network: "10.99.0.0".to_string(),
            netmask: "255.255.0.0".to_string(),
            gateway: None,
        });

        let args = build_openvpn_args(&config, None).unwrap();
        let auth_index = args
            .iter()
            .position(|arg| arg == "--auth-user-pass")
            .unwrap();
        assert_eq!(args[auth_index + 1], auth_path.to_string_lossy());
        assert!(!args.iter().any(|arg| arg.contains("argv-username")));
        assert!(!args.iter().any(|arg| arg.contains("argv-password")));
        assert!(!args.contains(&"--tls-auth".to_string()));
        assert!(!args.contains(&"--tls-crypt".to_string()));
        assert!(!args.contains(&"--route".to_string()));
        remove_test_file_tree(&directory);
    }

    #[test]
    fn inline_config_args_preserve_auth_file_as_one_argument() {
        let (directory, inline_path, auth_path) = test_file_tree("remote vpn.example.test 1194\n");
        let mut config = default_config();
        config.inline_config = Some("remote vpn.example.test 1194\n".to_string());
        config.auth_file = Some(auth_path.to_string_lossy().to_string());
        config.username = Some("ignored-stdin-user".to_string());
        config.password = Some("ignored-stdin-password".to_string());

        let args = build_openvpn_args(&config, Some(&inline_path)).unwrap();
        let auth_index = args
            .iter()
            .position(|arg| arg == "--auth-user-pass")
            .unwrap();
        assert_eq!(args[auth_index + 1], auth_path.to_string_lossy());
        assert_eq!(
            args.iter().filter(|arg| *arg == "--auth-user-pass").count(),
            1
        );
        assert!(!args.iter().any(|arg| arg.contains("ignored-stdin")));
        remove_test_file_tree(&directory);
    }

    #[test]
    fn config_source_without_auth_file_uses_bare_stdin_auth() {
        let (directory, inline_path, _) = test_file_tree("remote vpn.example.test 1194\n");
        let mut config = default_config();
        config.inline_config = Some("remote vpn.example.test 1194\n".to_string());
        config.username = Some("stdin-user-must-not-be-argv".to_string());
        config.password = Some("stdin-password-must-not-be-argv".to_string());

        let args = build_openvpn_args(&config, Some(&inline_path)).unwrap();
        let auth_index = args
            .iter()
            .position(|arg| arg == "--auth-user-pass")
            .unwrap();
        assert_eq!(args[auth_index + 1], "--auth-nocache");
        assert!(!args.iter().any(|arg| arg.contains("stdin-user")));
        assert!(!args.iter().any(|arg| arg.contains("stdin-password")));
        remove_test_file_tree(&directory);
    }

    #[test]
    fn lifecycle_directives_are_rejected_without_secret_values() {
        for directive in ["daemon", "--log", "log-append", "syslog"] {
            let content = format!(
                "  {directive} do-not-leak-this-path-or-value\nremote vpn.example.test 1194\n"
            );
            let error = validate_tracked_openvpn_config(&content).unwrap_err();
            assert!(error.contains(directive.trim_start_matches('-')));
            assert!(!error.contains("do-not-leak"));
        }

        validate_tracked_openvpn_config(
            " # daemon\n\t; log do-not-leak\nremote vpn.example.test 1194\n",
        )
        .unwrap();
    }

    #[test]
    fn selected_and_inline_configs_enforce_lifecycle_validation() {
        let secret = "do-not-leak-selected-log-path";
        let (directory, config_path, _) =
            test_file_tree(&format!("remote vpn.example.test 1194\nlog {secret}\n"));
        let mut selected = default_config();
        selected.config_file = Some(config_path.to_string_lossy().to_string());
        let selected_error = validate_openvpn_profile_config(&selected).unwrap_err();
        assert!(selected_error.contains("log"));
        assert!(!selected_error.contains(secret));

        let mut inline = default_config();
        inline.inline_config = Some(format!("remote vpn.example.test 1194\n--daemon {secret}\n"));
        let inline_error = validate_openvpn_profile_config(&inline).unwrap_err();
        assert!(inline_error.contains("daemon"));
        assert!(!inline_error.contains(secret));
        remove_test_file_tree(&directory);
    }

    #[test]
    fn selected_inline_and_manual_profiles_reject_nested_config_without_leaking_path() {
        let secret_path = "do-not-leak-nested-profile.ovpn";
        let (directory, config_path, _) = test_file_tree(&format!(
            "remote vpn.example.test 1194\nconfig {secret_path}\n"
        ));

        let mut selected = default_config();
        selected.config_file = Some(config_path.to_string_lossy().to_string());
        let selected_error = validate_openvpn_profile_config(&selected).unwrap_err();
        assert!(selected_error.contains("config"));
        assert!(!selected_error.contains(secret_path));

        let mut inline = default_config();
        inline.inline_config = Some(format!(
            "remote vpn.example.test 1194\n--config={secret_path}\n"
        ));
        let inline_error = validate_openvpn_profile_config(&inline).unwrap_err();
        assert!(inline_error.contains("config"));
        assert!(!inline_error.contains(secret_path));

        let mut manual = default_config();
        manual.custom_options = vec![format!("--config {secret_path}")];
        let manual_error = validate_openvpn_profile_config(&manual).unwrap_err();
        assert!(manual_error.contains("config"));
        assert!(!manual_error.contains(secret_path));

        remove_test_file_tree(&directory);
    }

    #[test]
    fn path_validation_errors_do_not_echo_sensitive_paths() {
        let mut config = default_config();
        let secret_path = std::env::temp_dir()
            .join(format!("missing-do-not-leak-{}", Uuid::new_v4()))
            .join("credentials.txt");
        config.auth_file = Some(secret_path.to_string_lossy().to_string());
        let error = build_openvpn_args(&config, None).unwrap_err();
        assert!(error.contains("authentication"));
        assert!(!error.contains("do-not-leak"));
    }

    #[test]
    fn manual_tls_auth_and_tls_crypt_are_mutually_exclusive() {
        let mut config = default_config();
        config.tls_auth = Some(true);
        config.tls_crypt = Some(true);
        config.tls_auth_file = Some("do-not-leak-auth-key".to_string());
        config.tls_crypt_file = Some("do-not-leak-crypt-key".to_string());
        let error = validate_openvpn_profile_config(&config).unwrap_err();
        assert!(error.contains("cannot enable both"));
        assert!(!error.contains("do-not-leak"));
    }

    #[tokio::test]
    async fn runtime_updates_require_disconnected_but_name_only_is_allowed() {
        let state = OpenVPNService::new();
        let mut service = state.lock().await;
        let original = default_config();
        let id = service
            .create_connection("Original".to_string(), original.clone())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status = OpenVPNStatus::Connected;

        let auth_error = service
            .update_connection_auth(
                &id,
                Some("new-user".to_string()),
                Some("new-pass".to_string()),
            )
            .await
            .unwrap_err();
        assert!(auth_error.contains("disconnected"));

        let mut replacement = default_config();
        replacement.remote_host = Some("replacement.example.test".to_string());
        let config_error = service
            .update_connection(&id, Some("Rejected rename".to_string()), Some(replacement))
            .await
            .unwrap_err();
        assert!(config_error.contains("disconnected"));

        let key_error = service
            .set_connection_key_files(
                &id,
                Some("ca.pem".to_string()),
                Some("cert.pem".to_string()),
                Some("key.pem".to_string()),
                None,
            )
            .await
            .unwrap_err();
        assert!(key_error.contains("disconnected"));

        service
            .update_connection(&id, Some("Allowed rename".to_string()), None)
            .await
            .unwrap();
        let connection = service.connections.get(&id).unwrap();
        assert_eq!(connection.name, "Allowed rename");
        assert_eq!(connection.config.remote_host, original.remote_host);
        assert!(connection.config.username.is_none());
        assert!(connection.config.client_key.is_none());
    }

    #[tokio::test]
    async fn disconnect_and_delete_retain_ownership_until_cleanup_retry_succeeds() {
        let terminator = Arc::new(FailNTimesTerminator::new(2));
        let state = OpenVPNService::new_with_terminator(terminator);
        let mut service = state.lock().await;
        let id = service
            .create_connection("Owned".to_string(), default_config())
            .await
            .unwrap();
        let child = spawn_sleeping_test_child();
        let pid = child.id().unwrap();
        service.processes.insert(id.clone(), child);
        let connection = service.connections.get_mut(&id).unwrap();
        connection.status = OpenVPNStatus::Connected;
        connection.process_id = Some(pid);

        let disconnect_error = service.disconnect(&id).await.unwrap_err();
        assert!(disconnect_error.contains("ownership was retained"));
        assert!(service.processes.contains_key(&id));
        assert_eq!(service.connections[&id].process_id, Some(pid));

        let delete_error = service.delete_connection(&id).await.unwrap_err();
        assert!(delete_error.contains("ownership was retained"));
        assert!(service.connections.contains_key(&id));
        assert!(service.processes.contains_key(&id));

        service.disconnect(&id).await.unwrap();
        assert!(!service.processes.contains_key(&id));
        assert!(matches!(
            service.connections[&id].status,
            OpenVPNStatus::Disconnected
        ));
        service.delete_connection(&id).await.unwrap();
        assert!(!service.connections.contains_key(&id));
    }

    #[tokio::test]
    async fn reconnect_cleanup_failure_does_not_start_a_duplicate_process() {
        let terminator = Arc::new(FailNTimesTerminator::new(1));
        let state = OpenVPNService::new_with_terminator(terminator);
        let mut service = state.lock().await;
        let id = service
            .create_connection("Owned".to_string(), default_config())
            .await
            .unwrap();
        let child = spawn_sleeping_test_child();
        let pid = child.id().unwrap();
        service.processes.insert(id.clone(), child);
        let connection = service.connections.get_mut(&id).unwrap();
        connection.status = OpenVPNStatus::Error("retry requested".to_string());
        connection.process_id = Some(pid);

        let error = service.connect(&id).await.unwrap_err();
        assert!(error.contains("previously owned process"));
        assert_eq!(service.processes.len(), 1);
        assert_eq!(service.processes[&id].id(), Some(pid));
        assert_eq!(service.connections[&id].process_id, Some(pid));

        service.disconnect(&id).await.unwrap();
        assert!(service.processes.is_empty());
    }

    #[tokio::test]
    async fn startup_cleanup_failure_records_child_and_disconnect_retries() {
        let terminator = Arc::new(FailNTimesTerminator::new(1));
        let child = spawn_sleeping_test_child();
        let pid = child.id().unwrap();
        let failure = cleanup_failed_startup(
            child,
            "OpenVPN readiness failed".to_string(),
            terminator.as_ref(),
        )
        .await;
        assert!(failure.child.is_some());
        assert!(failure.message.contains("cleanup failed"));

        let state = OpenVPNService::new_with_terminator(terminator);
        let mut service = state.lock().await;
        let id = service
            .create_connection("Startup failure".to_string(), default_config())
            .await
            .unwrap();
        let error = service.record_startup_failure(&id, failure);
        assert!(error.contains("ownership was retained"));
        assert_eq!(service.connections[&id].process_id, Some(pid));
        assert_eq!(service.processes[&id].id(), Some(pid));

        service.disconnect(&id).await.unwrap();
        assert!(service.processes.is_empty());
        assert!(service.connections[&id].process_id.is_none());
    }

    #[tokio::test]
    async fn inline_temp_creation_is_private_and_cleanup_is_best_effort() {
        let temporary = write_secure_inline_config("remote vpn.example.test 1194\n")
            .await
            .unwrap();
        assert_eq!(
            tokio::fs::read_to_string(temporary.path()).await.unwrap(),
            "remote vpn.example.test 1194\n"
        );
        assert!(temporary.path().is_file());
        assert!(temporary.directory.is_dir());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let directory_mode = std::fs::metadata(&temporary.directory)
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            let file_mode = std::fs::metadata(temporary.path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(directory_mode, 0o700);
            assert_eq!(file_mode, 0o600);
        }

        let path = temporary.path.clone();
        let directory = temporary.directory.clone();
        temporary.cleanup().await;
        drop(temporary);
        assert!(!path.exists());
        assert!(!directory.exists());
    }

    #[test]
    fn private_inline_file_creation_never_overwrites_existing_content() {
        let directory = std::env::temp_dir().join(format!(
            "sortofremoteng-openvpn-create-new-test-{}",
            Uuid::new_v4()
        ));
        create_private_temp_directory(&directory).unwrap();
        let path = directory.join("profile.ovpn");
        let first = create_private_inline_file(&path).unwrap();
        drop(first);
        std::fs::write(&path, "sentinel").unwrap();
        let second = create_private_inline_file(&path).unwrap_err();
        assert_eq!(second.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "sentinel");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&directory);
    }

    #[test]
    fn ipc_view_redacts_all_openvpn_secret_sentinels_and_reports_presence() {
        let mut config = default_config();
        config.password = Some("OPENVPN-PASSWORD-SENTINEL".to_string());
        config.inline_config = Some(
            "remote vpn.example.test 1194\n<key>OPENVPN-INLINE-KEY-SENTINEL</key>".to_string(),
        );
        config.client_key = Some("OPENVPN-CLIENT-KEY-SENTINEL".to_string());
        let view = OpenVPNConnection {
            id: "profile".to_string(),
            name: "Office".to_string(),
            config,
            status: OpenVPNStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            process_id: None,
            local_ip: None,
            remote_ip: None,
        }
        .into_redacted_view();

        let json = serde_json::to_string(&view).unwrap();
        assert!(!json.contains("OPENVPN-PASSWORD-SENTINEL"));
        assert!(!json.contains("OPENVPN-INLINE-KEY-SENTINEL"));
        assert!(!json.contains("OPENVPN-CLIENT-KEY-SENTINEL"));
        assert_eq!(
            view.secret_presence,
            OpenVPNSecretPresence {
                password: true,
                inline_config: true,
                client_key: true,
            }
        );
    }

    #[tokio::test]
    async fn ipc_update_preserves_replaces_and_explicitly_clears_openvpn_secrets() {
        let state = OpenVPNService::new();
        let mut service = state.lock().await;
        let mut config = default_config();
        config.password = Some("original-password".to_string());
        let id = service
            .create_connection("Office".to_string(), config)
            .await
            .unwrap();

        let mut omitted = default_config();
        omitted.password = Some("   ".to_string());
        service
            .update_connection_from_ipc(&id, None, Some(omitted), OpenVPNSecretMutation::default())
            .await
            .unwrap();
        assert_eq!(
            service.connections[&id].config.password.as_deref(),
            Some("original-password")
        );

        let mut replacement = default_config();
        replacement.password = Some("replacement-password".to_string());
        service
            .update_connection_from_ipc(
                &id,
                None,
                Some(replacement),
                OpenVPNSecretMutation::default(),
            )
            .await
            .unwrap();
        assert_eq!(
            service.connections[&id].config.password.as_deref(),
            Some("replacement-password")
        );

        service
            .update_connection_from_ipc(
                &id,
                None,
                None,
                OpenVPNSecretMutation {
                    clear_password: true,
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(service.connections[&id].config.password.is_none());
    }
}
