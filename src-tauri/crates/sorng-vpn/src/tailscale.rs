use crate::persistence::{
    deserialize_profile_definitions, load_service_data, save_service_data,
    serialize_profile_definitions, Persistable, RestoreOutcome,
};
use crate::platform;
use chrono::{DateTime, Utc};
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::Zeroize;

pub type TailscaleServiceState = Arc<Mutex<TailscaleService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TailscaleConnection {
    pub id: String,
    pub name: String,
    pub config: TailscaleConfig,
    pub status: TailscaleStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub tailnet_ip: Option<String>,
    pub hostname: Option<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct TailscaleSecretPresence {
    pub auth_key: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TailscaleConnectionView {
    #[serde(flatten)]
    pub connection: TailscaleConnection,
    pub secret_presence: TailscaleSecretPresence,
}

impl TailscaleConnection {
    pub fn into_redacted_view(mut self) -> TailscaleConnectionView {
        let secret_presence = TailscaleSecretPresence {
            auth_key: self.config.auth_key.is_some(),
        };
        self.config.auth_key = None;
        TailscaleConnectionView {
            connection: self,
            secret_presence,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct TailscaleSecretMutation {
    pub clear_auth_key: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum TailscaleStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TailscaleConfig {
    pub auth_key: Option<String>,
    pub login_server: Option<String>,
    pub accept_routes: Option<bool>,
    pub accept_dns: Option<bool>,
    pub advertise_routes: Vec<String>,
    pub advertise_tags: Vec<String>,
    pub hostname: Option<String>,
    pub exit_node: Option<String>,
    pub exit_node_allow_lan_access: Option<bool>,
    pub ssh: Option<bool>,
    pub funnel: Option<bool>,
    pub state_dir: Option<String>,
    pub socket: Option<String>,
}

pub struct TailscaleService {
    connections: HashMap<String, TailscaleConnection>,
    /// Tailscale controls one machine-global daemon. At most one profile may
    /// own that daemon during this process lifetime.
    active_profile_id: Option<String>,
    #[allow(dead_code)]
    emitter: Option<DynEventEmitter>,
    storage: Option<sorng_storage::storage::SecureStorageState>,
    definitions_loaded: bool,
    command_runner: Arc<dyn TailscaleCommandRunner>,
}

#[derive(Debug, Clone)]
struct TailscaleCommandOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

#[async_trait::async_trait]
trait TailscaleCommandRunner: Send + Sync {
    async fn run(&self, args: &[String]) -> Result<TailscaleCommandOutput, String>;
}

struct SystemTailscaleCommandRunner;

#[async_trait::async_trait]
impl TailscaleCommandRunner for SystemTailscaleCommandRunner {
    async fn run(&self, args: &[String]) -> Result<TailscaleCommandOutput, String> {
        let binary = platform::resolve_binary("tailscale")
            .map_err(|error| format!("Failed to find tailscale binary: {error}"))?;
        let output = Command::new(binary)
            .args(args)
            .output()
            .await
            .map_err(|error| format!("Failed to execute tailscale: {error}"))?;

        Ok(TailscaleCommandOutput {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConnectOwnershipDecision {
    ReuseOwnedDaemon,
    RunUp,
    RejectExternalDaemon,
    RejectOtherProfile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DisconnectOwnershipDecision {
    RunDown,
    ClearLocalOnly,
    RejectOtherProfile,
}

fn decide_tailscale_connect_ownership(
    active_profile_id: Option<&str>,
    requested_profile_id: &str,
    daemon_running: bool,
) -> ConnectOwnershipDecision {
    match active_profile_id {
        Some(owner_id) if owner_id != requested_profile_id => {
            ConnectOwnershipDecision::RejectOtherProfile
        }
        Some(_) if daemon_running => ConnectOwnershipDecision::ReuseOwnedDaemon,
        Some(_) => ConnectOwnershipDecision::RunUp,
        None if daemon_running => ConnectOwnershipDecision::RejectExternalDaemon,
        None => ConnectOwnershipDecision::RunUp,
    }
}

fn decide_tailscale_disconnect_ownership(
    active_profile_id: Option<&str>,
    requested_profile_id: &str,
) -> DisconnectOwnershipDecision {
    match active_profile_id {
        Some(owner_id) if owner_id == requested_profile_id => DisconnectOwnershipDecision::RunDown,
        Some(_) => DisconnectOwnershipDecision::RejectOtherProfile,
        None => DisconnectOwnershipDecision::ClearLocalOnly,
    }
}

fn validate_tailscale_config(config: &TailscaleConfig) -> Result<(), String> {
    if config
        .state_dir
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(
            "Tailscale state_dir is not supported because profiles share the machine-wide daemon"
                .to_string(),
        );
    }
    if config
        .socket
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(
            "Tailscale socket is not supported because ownership is tracked for the machine-wide daemon"
                .to_string(),
        );
    }
    if config.funnel == Some(true) {
        return Err(
            "Tailscale Funnel cannot be enabled with 'tailscale up'; configure Funnel separately"
                .to_string(),
        );
    }
    Ok(())
}

/// A short-lived file used to pass a Tailscale auth key without exposing the
/// key in the process environment or argument list. Dropping this value is the
/// final cleanup guard for every command outcome, including spawn failures.
struct TemporaryTailscaleAuthKey {
    path: PathBuf,
    directory: PathBuf,
}

impl Drop for TemporaryTailscaleAuthKey {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_dir(&self.directory);
    }
}

fn create_secure_tailscale_auth_key(key: &str) -> Result<TemporaryTailscaleAuthKey, String> {
    let directory =
        std::env::temp_dir().join(format!("sortofremoteng-tailscale-auth-{}", Uuid::new_v4()));

    #[cfg(unix)]
    let directory_builder = {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = std::fs::DirBuilder::new();
        builder.mode(0o700);
        builder
    };
    #[cfg(not(unix))]
    let directory_builder = std::fs::DirBuilder::new();
    directory_builder
        .create(&directory)
        .map_err(|e| format!("Failed to create a private Tailscale auth directory: {e}"))?;

    let path = directory.join("auth.key");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut secret = key.as_bytes().to_vec();
    let write_result = options
        .open(&path)
        .and_then(|mut file| file.write_all(&secret));
    secret.zeroize();

    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&directory);
        return Err(format!(
            "Failed to write the private Tailscale auth-key file: {error}"
        ));
    }

    Ok(TemporaryTailscaleAuthKey { path, directory })
}

fn build_tailscale_up_args(config: &TailscaleConfig, auth_key_file: Option<&Path>) -> Vec<String> {
    let mut args = vec!["up".to_string()];

    if let Some(path) = auth_key_file {
        args.push(format!("--auth-key=file:{}", path.to_string_lossy()));
    }

    if let Some(login_server) = &config.login_server {
        args.push("--login-server".to_string());
        args.push(login_server.clone());
    }

    if let Some(accept_routes) = config.accept_routes {
        args.push(if accept_routes {
            "--accept-routes".to_string()
        } else {
            "--accept-routes=false".to_string()
        });
    }

    if let Some(accept_dns) = config.accept_dns {
        args.push(if accept_dns {
            "--accept-dns".to_string()
        } else {
            "--accept-dns=false".to_string()
        });
    }

    if !config.advertise_routes.is_empty() {
        args.push("--advertise-routes".to_string());
        args.push(config.advertise_routes.join(","));
    }

    if !config.advertise_tags.is_empty() {
        args.push("--advertise-tags".to_string());
        args.push(config.advertise_tags.join(","));
    }

    if let Some(hostname) = &config.hostname {
        args.push("--hostname".to_string());
        args.push(hostname.clone());
    }

    if let Some(exit_node) = &config.exit_node {
        args.push("--exit-node".to_string());
        args.push(exit_node.clone());
    }

    if let Some(exit_node_allow_lan_access) = config.exit_node_allow_lan_access {
        args.push(if exit_node_allow_lan_access {
            "--exit-node-allow-lan-access".to_string()
        } else {
            "--exit-node-allow-lan-access=false".to_string()
        });
    }

    if let Some(ssh) = config.ssh {
        args.push(if ssh {
            "--ssh".to_string()
        } else {
            "--ssh=false".to_string()
        });
    }

    args
}

fn tailscale_file_auth_unsupported(stderr: &str) -> bool {
    let message = stderr.to_ascii_lowercase();
    (message.contains("unknown flag") && message.contains("auth-key"))
        || (message.contains("invalid value") && message.contains("file:"))
        || (message.contains("invalid auth key") && message.contains("file:"))
}

fn sanitize_tailscale_diagnostic(stderr: &str) -> String {
    let normalized = stderr
        .split_whitespace()
        .map(|token| {
            if token.to_ascii_lowercase().contains("tskey-") {
                "[REDACTED]"
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    let sanitized = normalized.chars().take(600).collect::<String>();
    if sanitized.is_empty() {
        "No diagnostic output was provided".to_string()
    } else {
        sanitized
    }
}

impl TailscaleService {
    pub fn new() -> TailscaleServiceState {
        Arc::new(Mutex::new(TailscaleService {
            connections: HashMap::new(),
            active_profile_id: None,
            emitter: None,
            storage: None,
            definitions_loaded: true,
            command_runner: Arc::new(SystemTailscaleCommandRunner),
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> TailscaleServiceState {
        Arc::new(Mutex::new(TailscaleService {
            connections: HashMap::new(),
            active_profile_id: None,
            emitter: Some(emitter),
            storage: None,
            definitions_loaded: true,
            command_runner: Arc::new(SystemTailscaleCommandRunner),
        }))
    }

    pub fn new_persistent(
        emitter: DynEventEmitter,
        storage: sorng_storage::storage::SecureStorageState,
    ) -> TailscaleServiceState {
        Arc::new(Mutex::new(TailscaleService {
            connections: HashMap::new(),
            active_profile_id: None,
            emitter: Some(emitter),
            storage: Some(storage),
            definitions_loaded: false,
            command_runner: Arc::new(SystemTailscaleCommandRunner),
        }))
    }

    #[cfg(test)]
    fn new_with_command_runner(
        command_runner: Arc<dyn TailscaleCommandRunner>,
    ) -> TailscaleServiceState {
        Arc::new(Mutex::new(TailscaleService {
            connections: HashMap::new(),
            active_profile_id: None,
            emitter: None,
            storage: None,
            definitions_loaded: true,
            command_runner,
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
                "Tailscale profile storage is unreadable; stored profiles were left untouched: {e}"
            )),
        }
    }

    async fn persist_or_rollback(
        &mut self,
        previous: HashMap<String, TailscaleConnection>,
    ) -> Result<(), String> {
        let Some(storage) = self.storage.clone() else {
            return Ok(());
        };
        if let Err(e) = save_service_data(self, &storage).await {
            self.connections = previous;
            return Err(format!(
                "Tailscale profile change was not saved and has been rolled back: {e}"
            ));
        }
        Ok(())
    }

    #[allow(dead_code)]
    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "tailscale",
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
        config: TailscaleConfig,
    ) -> Result<String, String> {
        validate_tailscale_config(&config)?;
        self.ensure_persisted_loaded().await?;
        let previous = self.connections.clone();
        let id = Uuid::new_v4().to_string();
        let connection = TailscaleConnection {
            id: id.clone(),
            name,
            config,
            status: TailscaleStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            tailnet_ip: None,
            hostname: None,
            process_id: None,
        };

        self.connections.insert(id.clone(), connection);
        self.persist_or_rollback(previous).await?;
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let mut config = {
            let connection = self
                .connections
                .get(connection_id)
                .ok_or_else(|| "Tailscale connection not found".to_string())?;
            connection.config.clone()
        };

        if let Err(message) = validate_tailscale_config(&config) {
            if let Some(connection) = self.connections.get_mut(connection_id) {
                connection.status = TailscaleStatus::Error(message.clone());
            }
            return Err(message);
        }

        if matches!(
            decide_tailscale_connect_ownership(
                self.active_profile_id.as_deref(),
                connection_id,
                false,
            ),
            ConnectOwnershipDecision::RejectOtherProfile
        ) {
            let active_id = self
                .active_profile_id
                .as_deref()
                .expect("other-owner decision requires an owner");
            let active_name = self
                .connections
                .get(active_id)
                .map(|connection| connection.name.as_str())
                .unwrap_or("unknown profile");
            return Err(format!(
                "Tailscale is already controlled by profile '{active_name}' ({active_id}); disconnect it before connecting another Tailscale profile"
            ));
        }

        // Tailscale is machine-global. After a restart there is deliberately no
        // inferred profile owner, so a Running daemon must be treated as
        // external and never adopted or reconfigured by `tailscale up`.
        let daemon_status = match self.get_status_info().await {
            Ok(status) => status,
            Err(message) => {
                if let Some(connection) = self.connections.get_mut(connection_id) {
                    connection.status = TailscaleStatus::Error(message.clone());
                }
                return Err(message);
            }
        };

        match decide_tailscale_connect_ownership(
            self.active_profile_id.as_deref(),
            connection_id,
            daemon_status.is_running(),
        ) {
            ConnectOwnershipDecision::ReuseOwnedDaemon => {
                if let Some(connection) = self.connections.get_mut(connection_id) {
                    connection.status = TailscaleStatus::Connected;
                    connection.connected_at.get_or_insert_with(Utc::now);
                    connection.tailnet_ip = daemon_status.tailnet_ip;
                    connection.hostname = daemon_status.hostname;
                }
                return Ok(());
            }
            ConnectOwnershipDecision::RejectExternalDaemon => {
                let message = "Tailscale is already Running without a verified sortOfRemoteNG profile owner; disconnect the external daemon before connecting this profile".to_string();
                if let Some(connection) = self.connections.get_mut(connection_id) {
                    connection.status = TailscaleStatus::Error(message.clone());
                }
                return Err(message);
            }
            ConnectOwnershipDecision::RejectOtherProfile => {
                // This was checked before the status command. Keep the branch
                // exhaustive in case the pure ownership policy changes.
                return Err("Tailscale is already controlled by another profile".to_string());
            }
            ConnectOwnershipDecision::RunUp => {}
        }

        if let Some(connection) = self.connections.get_mut(connection_id) {
            connection.status = TailscaleStatus::Connecting;
        }

        // Current Tailscale supports `--auth-key=file:<path>`. This keeps the
        // key out of both argv and the environment; the private file is removed
        // immediately after `tailscale up` exits (and by Drop on every error).
        let auth_key_file = match config.auth_key.as_deref() {
            Some(key) => match create_secure_tailscale_auth_key(key) {
                Ok(file) => Some(file),
                Err(message) => {
                    if let Some(key) = config.auth_key.as_mut() {
                        key.zeroize();
                    }
                    if let Some(connection) = self.connections.get_mut(connection_id) {
                        connection.status = TailscaleStatus::Error(message.clone());
                    }
                    return Err(message);
                }
            },
            None => None,
        };
        if let Some(key) = config.auth_key.as_mut() {
            key.zeroize();
        }
        config.auth_key = None;

        let args = build_tailscale_up_args(
            &config,
            auth_key_file.as_ref().map(|file| file.path.as_path()),
        );
        // `tailscale up` mutates one machine-global daemon and may return an
        // error after applying some of that mutation. Record the exact profile
        // owner before spawning it so lifecycle compensation can always probe
        // and, when needed, issue the matching `down` instead of misclassifying
        // a partial start as an external daemon.
        self.active_profile_id = Some(connection_id.to_string());
        let output_result = self.command_runner.run(&args).await;
        drop(auth_key_file);

        let output = match output_result {
            Ok(output) => output,
            Err(error) => {
                let message = format!(
                    "Failed to execute tailscale: {}",
                    sanitize_tailscale_diagnostic(&error)
                );
                if let Some(connection) = self.connections.get_mut(connection_id) {
                    connection.status = TailscaleStatus::Error(message.clone());
                }
                return Err(message);
            }
        };

        if !output.success {
            let message = if tailscale_file_auth_unsupported(&output.stderr) {
                "The installed Tailscale CLI does not support secure file-backed auth keys; upgrade Tailscale before using a stored auth key"
                    .to_string()
            } else {
                format!(
                    "Tailscale connection failed: {}",
                    sanitize_tailscale_diagnostic(&output.stderr)
                )
            };
            if let Some(connection) = self.connections.get_mut(connection_id) {
                connection.status = TailscaleStatus::Error(message.clone());
            }
            return Err(message);
        }

        match self.get_status_info().await {
            Ok(status_info) if status_info.is_running() => {
                let connection = self
                    .connections
                    .get_mut(connection_id)
                    .expect("connection_id passed to function");
                connection.status = TailscaleStatus::Connected;
                connection.connected_at = Some(Utc::now());
                connection.tailnet_ip = status_info.tailnet_ip;
                connection.hostname = status_info.hostname;
                Ok(())
            }
            Ok(status_info) => {
                let message = format!(
                    "Tailscale up completed but the daemon reported BackendState '{}'",
                    sanitize_tailscale_diagnostic(&status_info.backend_state)
                );
                if let Some(connection) = self.connections.get_mut(connection_id) {
                    connection.status = TailscaleStatus::Error(message.clone());
                }
                Err(message)
            }
            Err(message) => {
                if let Some(connection) = self.connections.get_mut(connection_id) {
                    connection.status = TailscaleStatus::Error(message.clone());
                }
                Err(message)
            }
        }
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if !self.connections.contains_key(connection_id) {
            return Err("Tailscale connection not found".to_string());
        }

        match decide_tailscale_disconnect_ownership(
            self.active_profile_id.as_deref(),
            connection_id,
        ) {
            DisconnectOwnershipDecision::RejectOtherProfile => {
                let active_id = self
                    .active_profile_id
                    .as_deref()
                    .expect("other-owner decision requires an owner");
                let active_name = self
                    .connections
                    .get(active_id)
                    .map(|connection| connection.name.as_str())
                    .unwrap_or("unknown profile");
                return Err(format!(
                    "Cannot disconnect Tailscale profile '{connection_id}' because profile '{active_name}' ({active_id}) owns the machine-wide Tailscale connection"
                ));
            }
            DisconnectOwnershipDecision::ClearLocalOnly => {
                // With no verified owner, never issue the machine-global
                // `down` command. A Running daemon is external/unknown, so only
                // clear stale per-profile runtime presentation.
                let connection = self
                    .connections
                    .get_mut(connection_id)
                    .expect("connection existence checked above");
                connection.status = TailscaleStatus::Disconnected;
                connection.connected_at = None;
                connection.tailnet_ip = None;
                connection.hostname = None;
                return Ok(());
            }
            DisconnectOwnershipDecision::RunDown => {}
        }

        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "Tailscale connection not found".to_string())?;

        connection.status = TailscaleStatus::Disconnecting;

        let args = vec!["down".to_string()];
        let output = match self.command_runner.run(&args).await {
            Ok(output) => output,
            Err(error) => {
                let message = format!(
                    "Failed to execute tailscale: {}",
                    sanitize_tailscale_diagnostic(&error)
                );
                connection.status = TailscaleStatus::Error(message.clone());
                return Err(message);
            }
        };

        if !output.success {
            let message = format!(
                "Tailscale disconnection failed: {}",
                sanitize_tailscale_diagnostic(&output.stderr)
            );
            connection.status = TailscaleStatus::Error(message.clone());
            return Err(message);
        }

        connection.status = TailscaleStatus::Disconnected;
        connection.connected_at = None;
        connection.tailnet_ip = None;
        connection.hostname = None;
        self.active_profile_id = None;

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<TailscaleConnection, String> {
        self.connections
            .get(connection_id)
            .map(|connection| self.connection_for_api(connection))
            .ok_or_else(|| "Tailscale connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<TailscaleConnection> {
        self.connections
            .values()
            .map(|connection| self.connection_for_api(connection))
            .collect()
    }

    pub async fn probe_connection_active(&mut self, connection_id: &str) -> Result<bool, String> {
        self.ensure_persisted_loaded().await?;
        if !self.connections.contains_key(connection_id) {
            if self.active_profile_id.as_deref() == Some(connection_id) {
                return Err(
                    "Tailscale retains an owner token for a missing profile; activity is indeterminate"
                        .to_string(),
                );
            }
            return Ok(false);
        }
        if self.active_profile_id.as_deref() != Some(connection_id) {
            return Ok(false);
        }

        let status = self.get_status_info().await?;
        if status.is_running() {
            let connection = self
                .connections
                .get_mut(connection_id)
                .expect("connection existence checked above");
            connection.status = TailscaleStatus::Connected;
            connection.connected_at.get_or_insert_with(Utc::now);
            connection.tailnet_ip = status.tailnet_ip;
            connection.hostname = status.hostname;
            return Ok(true);
        }

        // The daemon itself has confirmed inactivity, so clearing the local
        // owner token here keeps a lifecycle release from leaving a stale
        // machine-global owner that would block another profile later.
        self.active_profile_id = None;
        let connection = self
            .connections
            .get_mut(connection_id)
            .expect("connection existence checked above");
        connection.status = TailscaleStatus::Disconnected;
        connection.connected_at = None;
        connection.tailnet_ip = None;
        connection.hostname = None;
        connection.process_id = None;
        Ok(false)
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if self.active_profile_id.as_deref() == Some(connection_id) {
            self.disconnect(connection_id).await?;
        }

        let previous = self.connections.clone();
        self.connections.remove(connection_id);
        self.persist_or_rollback(previous).await
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<TailscaleConfig>,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let current = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "Tailscale connection not found".to_string())?;
        if config.is_some() && !matches!(current.status, TailscaleStatus::Disconnected) {
            return Err(
                "Tailscale configuration can only be changed while the connection is disconnected"
                    .to_string(),
            );
        }
        if let Some(new_config) = config.as_ref() {
            validate_tailscale_config(new_config)?;
        }

        let previous = self.connections.clone();
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "Tailscale connection not found".to_string())?;

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
        mut config: Option<TailscaleConfig>,
        secret_mutation: TailscaleSecretMutation,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if config.is_none() && secret_mutation.clear_auth_key {
            let mut current = self
                .connections
                .get(connection_id)
                .ok_or_else(|| "Tailscale connection not found".to_string())?
                .config
                .clone();
            current.auth_key = None;
            config = Some(current);
        }
        if let Some(submitted) = config.as_mut() {
            let stored = &self
                .connections
                .get(connection_id)
                .ok_or_else(|| "Tailscale connection not found".to_string())?
                .config;
            crate::persistence::merge_secret_update(
                &stored.auth_key,
                &mut submitted.auth_key,
                secret_mutation.clear_auth_key,
                "Tailscale auth key",
            )?;
        }
        self.update_connection(connection_id, name, config).await
    }

    fn connection_for_api(&self, connection: &TailscaleConnection) -> TailscaleConnection {
        let mut view = connection.clone();
        if self.active_profile_id.as_deref() != Some(connection.id.as_str())
            && matches!(
                view.status,
                TailscaleStatus::Connecting
                    | TailscaleStatus::Connected
                    | TailscaleStatus::Disconnecting
            )
        {
            // Per-profile runtime state without the in-process ownership token
            // is stale. In particular, never attribute an external Running
            // daemon to a stored profile after restart.
            view.status = TailscaleStatus::Disconnected;
            view.connected_at = None;
            view.tailnet_ip = None;
            view.hostname = None;
            view.process_id = None;
        }
        view
    }

    async fn get_status_info(&self) -> Result<StatusInfo, String> {
        let args = vec!["status".to_string(), "--json".to_string()];
        let output = self.command_runner.run(&args).await.map_err(|error| {
            format!(
                "Failed to get Tailscale daemon status: {}",
                sanitize_tailscale_diagnostic(&error)
            )
        })?;

        if !output.success {
            return Err(format!(
                "Failed to get Tailscale daemon status: {}",
                sanitize_tailscale_diagnostic(&output.stderr)
            ));
        }

        parse_tailscale_status_info(&output.stdout)
    }
}

fn parse_tailscale_status_info(stdout: &str) -> Result<StatusInfo, String> {
    let status: serde_json::Value = serde_json::from_str(stdout)
        .map_err(|error| format!("Failed to parse Tailscale daemon status: {error}"))?;

    let backend_state = status
        .get("BackendState")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Tailscale daemon status is missing BackendState".to_string())?
        .to_string();

    let tailnet_ip = status
        .get("TailscaleIPs")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|ip| ip.as_str())
        .map(|s| s.to_string());

    let self_node = status.get("Self");
    let hostname = self_node
        .and_then(|node| node.get("HostName"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            self_node
                .and_then(|node| node.get("DNSName"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .map(ToString::to_string);

    Ok(StatusInfo {
        backend_state,
        tailnet_ip,
        hostname,
    })
}

#[async_trait::async_trait]
impl Persistable for TailscaleService {
    fn storage_key(&self) -> &'static str {
        crate::persistence::keys::TAILSCALE
    }

    fn serialize_definitions(&self) -> Result<String, String> {
        let mut connections = self.connections.values().cloned().collect::<Vec<_>>();
        connections.sort_by(|a, b| a.id.cmp(&b.id));
        for connection in &mut connections {
            connection.status = TailscaleStatus::Disconnected;
            connection.connected_at = None;
            connection.tailnet_ip = None;
            connection.hostname = None;
            connection.process_id = None;
        }
        serialize_profile_definitions(&connections)
    }

    fn deserialize_definitions(&mut self, data: &str) -> Result<(), String> {
        let mut restored = HashMap::new();
        for mut connection in deserialize_profile_definitions::<TailscaleConnection>(data)? {
            if connection.id.trim().is_empty() {
                return Err("Tailscale profile has an empty id".to_string());
            }
            connection.status = TailscaleStatus::Disconnected;
            connection.connected_at = None;
            connection.tailnet_ip = None;
            connection.hostname = None;
            connection.process_id = None;
            let id = connection.id.clone();
            if restored.insert(id.clone(), connection).is_some() {
                return Err(format!(
                    "Tailscale profile data contains duplicate id '{id}'"
                ));
            }
        }
        self.connections = restored;
        self.active_profile_id = None;
        Ok(())
    }
}

#[derive(Debug)]
struct StatusInfo {
    backend_state: String,
    tailnet_ip: Option<String>,
    hostname: Option<String>,
}

impl StatusInfo {
    fn is_running(&self) -> bool {
        self.backend_state.eq_ignore_ascii_case("running")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex as StdMutex;

    #[derive(Default)]
    struct MockTailscaleCommandRunner {
        calls: StdMutex<Vec<Vec<String>>>,
        responses: StdMutex<VecDeque<Result<TailscaleCommandOutput, String>>>,
    }

    impl MockTailscaleCommandRunner {
        fn with_responses(responses: Vec<Result<TailscaleCommandOutput, String>>) -> Arc<Self> {
            Arc::new(Self {
                calls: StdMutex::new(Vec::new()),
                responses: StdMutex::new(responses.into()),
            })
        }

        fn calls(&self) -> Vec<Vec<String>> {
            self.calls.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl TailscaleCommandRunner for MockTailscaleCommandRunner {
        async fn run(&self, args: &[String]) -> Result<TailscaleCommandOutput, String> {
            self.calls.lock().unwrap().push(args.to_vec());
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Err("unexpected Tailscale command".to_string()))
        }
    }

    fn successful_command() -> Result<TailscaleCommandOutput, String> {
        Ok(TailscaleCommandOutput {
            success: true,
            stdout: String::new(),
            stderr: String::new(),
        })
    }

    fn status_command(backend_state: &str) -> Result<TailscaleCommandOutput, String> {
        Ok(TailscaleCommandOutput {
            success: true,
            stdout: serde_json::json!({
                "BackendState": backend_state,
                "TailscaleIPs": ["100.64.0.7"],
                "Self": {
                    "ID": "n1234567890CNTRL",
                    "HostName": "test-node",
                    "DNSName": "test-node.example-tailnet.ts.net.",
                    "TailscaleIPs": ["100.64.0.7"]
                },
                "User": {
                    "12345": {"LoginName": "test@example.com"}
                }
            })
            .to_string(),
            stderr: String::new(),
        })
    }

    fn state_with_runner(runner: Arc<MockTailscaleCommandRunner>) -> TailscaleServiceState {
        TailscaleService::new_with_command_runner(runner)
    }

    fn default_ts_config() -> TailscaleConfig {
        TailscaleConfig {
            auth_key: Some("tskey-auth-xxx".to_string()),
            login_server: None,
            accept_routes: Some(true),
            accept_dns: Some(true),
            advertise_routes: Vec::new(),
            advertise_tags: Vec::new(),
            hostname: Some("test-node".to_string()),
            exit_node: None,
            exit_node_allow_lan_access: None,
            ssh: None,
            funnel: None,
            state_dir: None,
            socket: None,
        }
    }

    // ── Serde ───────────────────────────────────────────────────────────

    #[test]
    fn tailscale_status_serde_roundtrip() {
        let variants: Vec<TailscaleStatus> = vec![
            TailscaleStatus::Disconnected,
            TailscaleStatus::Connecting,
            TailscaleStatus::Connected,
            TailscaleStatus::Disconnecting,
            TailscaleStatus::Error("test".to_string()),
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: TailscaleStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", v), format!("{:?}", back));
        }
    }

    #[test]
    fn tailscale_config_serde_roundtrip() {
        let cfg = default_ts_config();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: TailscaleConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.hostname, Some("test-node".to_string()));
        assert_eq!(back.accept_routes, Some(true));
    }

    #[test]
    fn frontend_snake_case_config_payload_deserializes() {
        let config: TailscaleConfig = serde_json::from_value(serde_json::json!({
            "auth_key": "tskey-auth-example",
            "login_server": "https://controlplane.tailscale.com",
            "accept_routes": true,
            "accept_dns": false,
            "advertise_routes": ["10.90.0.0/16"],
            "advertise_tags": ["tag:remote"],
            "hostname": "remote-workstation",
            "ssh": true
        }))
        .unwrap();

        assert_eq!(config.auth_key.as_deref(), Some("tskey-auth-example"));
        assert_eq!(config.advertise_routes, vec!["10.90.0.0/16"]);
        assert_eq!(config.advertise_tags, vec!["tag:remote"]);
        assert_eq!(config.accept_dns, Some(false));
    }

    #[test]
    fn tailscale_up_args_use_file_auth_without_secret() {
        let config = default_ts_config();
        let path = Path::new("private-auth.key");
        let args = build_tailscale_up_args(&config, Some(path));
        let joined = args.join(" ");

        assert!(joined.contains("--auth-key=file:private-auth.key"));
        assert!(!joined.contains("tskey-auth-xxx"));
    }

    #[test]
    fn tailscale_up_args_never_include_funnel_flags() {
        let mut config = default_ts_config();
        config.funnel = Some(false);
        let args = build_tailscale_up_args(&config, None);

        assert!(args.iter().all(|arg| !arg.starts_with("--funnel")));
    }

    #[test]
    fn daemon_global_config_validation_is_fail_closed() {
        let mut state_dir = default_ts_config();
        state_dir.state_dir = Some("private-state".to_string());
        assert!(validate_tailscale_config(&state_dir)
            .unwrap_err()
            .contains("state_dir"));

        let mut socket = default_ts_config();
        socket.socket = Some("tailscaled.sock".to_string());
        assert!(validate_tailscale_config(&socket)
            .unwrap_err()
            .contains("socket"));

        let mut funnel = default_ts_config();
        funnel.funnel = Some(true);
        assert!(validate_tailscale_config(&funnel)
            .unwrap_err()
            .contains("Funnel"));

        let mut empty_legacy_fields = default_ts_config();
        empty_legacy_fields.state_dir = Some("  ".to_string());
        empty_legacy_fields.socket = Some(String::new());
        empty_legacy_fields.funnel = Some(false);
        validate_tailscale_config(&empty_legacy_fields).unwrap();
    }

    #[test]
    fn ownership_decisions_distinguish_external_and_verified_daemons() {
        assert_eq!(
            decide_tailscale_connect_ownership(None, "requested", true),
            ConnectOwnershipDecision::RejectExternalDaemon
        );
        assert_eq!(
            decide_tailscale_connect_ownership(None, "requested", false),
            ConnectOwnershipDecision::RunUp
        );
        assert_eq!(
            decide_tailscale_connect_ownership(Some("requested"), "requested", true),
            ConnectOwnershipDecision::ReuseOwnedDaemon
        );
        assert_eq!(
            decide_tailscale_connect_ownership(Some("requested"), "requested", false),
            ConnectOwnershipDecision::RunUp
        );
        assert_eq!(
            decide_tailscale_connect_ownership(Some("other"), "requested", false),
            ConnectOwnershipDecision::RejectOtherProfile
        );

        assert_eq!(
            decide_tailscale_disconnect_ownership(None, "requested"),
            DisconnectOwnershipDecision::ClearLocalOnly
        );
        assert_eq!(
            decide_tailscale_disconnect_ownership(Some("requested"), "requested"),
            DisconnectOwnershipDecision::RunDown
        );
        assert_eq!(
            decide_tailscale_disconnect_ownership(Some("other"), "requested"),
            DisconnectOwnershipDecision::RejectOtherProfile
        );
    }

    #[test]
    fn status_parser_distinguishes_running() {
        let running =
            parse_tailscale_status_info(&status_command("Running").unwrap().stdout).unwrap();
        let stopped =
            parse_tailscale_status_info(&status_command("Stopped").unwrap().stdout).unwrap();

        assert!(running.is_running());
        assert_eq!(running.hostname.as_deref(), Some("test-node"));
        assert!(!stopped.is_running());
        assert!(parse_tailscale_status_info("{}").is_err());
    }

    #[test]
    fn status_parser_uses_self_dns_name_when_hostname_is_missing() {
        let parsed = parse_tailscale_status_info(
            &serde_json::json!({
                "BackendState": "Running",
                "TailscaleIPs": ["100.64.0.8", "fd7a:115c:a1e0::8"],
                "Self": {
                    "ID": "n0987654321CNTRL",
                    "HostName": " ",
                    "DNSName": "fallback.example-tailnet.ts.net."
                },
                "User": {
                    "67890": {"LoginName": "must-not-be-used@example.com"}
                }
            })
            .to_string(),
        )
        .unwrap();

        assert_eq!(parsed.tailnet_ip.as_deref(), Some("100.64.0.8"));
        assert_eq!(
            parsed.hostname.as_deref(),
            Some("fallback.example-tailnet.ts.net.")
        );
    }

    #[test]
    fn temporary_auth_key_is_private_and_removed_on_drop() {
        let key_file = create_secure_tailscale_auth_key("tskey-auth-private").unwrap();
        let path = key_file.path.clone();
        let directory = key_file.directory.clone();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "tskey-auth-private"
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o077, 0);
        }

        drop(key_file);
        assert!(!path.exists());
        assert!(!directory.exists());
    }

    #[test]
    fn tailscale_diagnostics_redact_keys_and_are_bounded() {
        let input = format!("login failed for tskey-auth-secret {}", "x".repeat(800));
        let diagnostic = sanitize_tailscale_diagnostic(&input);
        assert!(!diagnostic.contains("tskey-auth-secret"));
        assert!(diagnostic.contains("[REDACTED]"));
        assert!(diagnostic.chars().count() <= 600);
    }

    #[test]
    fn unsupported_file_auth_is_classified_for_clear_upgrade_error() {
        assert!(tailscale_file_auth_unsupported(
            "invalid value file:C:\\temp\\auth.key for --auth-key"
        ));
        assert!(tailscale_file_auth_unsupported("unknown flag: --auth-key"));
        assert!(!tailscale_file_auth_unsupported("authentication failed"));
    }

    // ── Connection CRUD ─────────────────────────────────────────────────

    #[tokio::test]
    async fn create_connection_returns_uuid() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test TS".to_string(), default_ts_config())
            .await
            .unwrap();
        assert_eq!(id.len(), 36);
    }

    #[tokio::test]
    async fn create_connection_default_status() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_ts_config())
            .await
            .unwrap();
        let conn = svc.get_connection(&id).await.unwrap();
        assert!(matches!(conn.status, TailscaleStatus::Disconnected));
        assert!(conn.connected_at.is_none());
    }

    #[tokio::test]
    async fn create_rejects_unsupported_daemon_global_fields_before_mutation() {
        let state = TailscaleService::new();
        let mut service = state.lock().await;

        let mut configurations = Vec::new();
        let mut state_dir = default_ts_config();
        state_dir.state_dir = Some("private-state".to_string());
        configurations.push(state_dir);
        let mut socket = default_ts_config();
        socket.socket = Some("tailscaled.sock".to_string());
        configurations.push(socket);
        let mut funnel = default_ts_config();
        funnel.funnel = Some(true);
        configurations.push(funnel);

        for config in configurations {
            assert!(service
                .create_connection("Rejected".to_string(), config)
                .await
                .is_err());
            assert!(service.connections.is_empty());
        }
    }

    #[tokio::test]
    async fn list_connections_empty() {
        let state = TailscaleService::new();
        let svc = state.lock().await;
        assert!(svc.list_connections().await.is_empty());
    }

    #[tokio::test]
    async fn list_connections_after_create() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        svc.create_connection("TS1".to_string(), default_ts_config())
            .await
            .unwrap();
        svc.create_connection("TS2".to_string(), default_ts_config())
            .await
            .unwrap();
        assert_eq!(svc.list_connections().await.len(), 2);
    }

    #[tokio::test]
    async fn get_connection_not_found() {
        let state = TailscaleService::new();
        let svc = state.lock().await;
        assert!(svc.get_connection("nonexistent").await.is_err());
    }

    #[tokio::test]
    async fn delete_connection_removes_it() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_ts_config())
            .await
            .unwrap();
        svc.delete_connection(&id).await.unwrap();
        assert!(svc.get_connection(&id).await.is_err());
    }

    // ── update_connection ──────────────────────────────────────────────

    #[tokio::test]
    async fn update_connection_name() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Original".to_string(), default_ts_config())
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
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_ts_config())
            .await
            .unwrap();

        let mut new_config = default_ts_config();
        new_config.hostname = Some("new-hostname".to_string());
        new_config.accept_dns = Some(false);

        svc.update_connection(&id, None, Some(new_config))
            .await
            .unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.config.hostname, Some("new-hostname".to_string()));
        assert_eq!(conn.config.accept_dns, Some(false));
    }

    #[tokio::test]
    async fn update_rejects_unsupported_config_without_partial_mutation() {
        let state = TailscaleService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Original".to_string(), default_ts_config())
            .await
            .unwrap();
        let mut invalid = default_ts_config();
        invalid.socket = Some("tailscaled.sock".to_string());

        let error = service
            .update_connection(&id, Some("Should Not Persist".to_string()), Some(invalid))
            .await
            .unwrap_err();

        assert!(error.contains("socket"));
        let connection = service.get_connection(&id).await.unwrap();
        assert_eq!(connection.name, "Original");
        assert!(connection.config.socket.is_none());
    }

    #[tokio::test]
    async fn runtime_config_update_requires_disconnected_but_name_only_is_allowed() {
        let state = TailscaleService::new();
        let mut service = state.lock().await;
        let original = default_ts_config();
        let id = service
            .create_connection("Original".to_string(), original.clone())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status = TailscaleStatus::Connected;
        service.active_profile_id = Some(id.clone());

        let mut replacement = default_ts_config();
        replacement.hostname = Some("replacement-node".to_string());
        let error = service
            .update_connection(&id, Some("Rejected rename".to_string()), Some(replacement))
            .await
            .unwrap_err();
        assert!(error.contains("disconnected"));
        assert_eq!(service.connections[&id].name, "Original");
        assert_eq!(service.connections[&id].config.hostname, original.hostname);

        service
            .update_connection(&id, Some("Allowed rename".to_string()), None)
            .await
            .unwrap();
        assert_eq!(service.connections[&id].name, "Allowed rename");
        assert_eq!(service.connections[&id].config.hostname, original.hostname);
    }

    #[tokio::test]
    async fn update_connection_both() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_ts_config())
            .await
            .unwrap();

        let mut new_config = default_ts_config();
        new_config.exit_node = Some("exit-node-1".to_string());

        svc.update_connection(&id, Some("Renamed".to_string()), Some(new_config))
            .await
            .unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Renamed");
        assert_eq!(conn.config.exit_node, Some("exit-node-1".to_string()));
    }

    #[tokio::test]
    async fn update_connection_not_found() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let result = svc
            .update_connection("nonexistent", Some("Name".to_string()), None)
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn update_connection_no_changes() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_ts_config())
            .await
            .unwrap();

        svc.update_connection(&id, None, None).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Test");
    }

    // ── is_connection_active ───────────────────────────────────────────

    #[tokio::test]
    async fn is_connection_active_disconnected() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_ts_config())
            .await
            .unwrap();
        assert!(!svc.probe_connection_active(&id).await.unwrap());
    }

    #[tokio::test]
    async fn is_connection_active_nonexistent() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        assert!(!svc.probe_connection_active("nonexistent").await.unwrap());
    }

    #[tokio::test]
    async fn verified_owner_activity_requires_a_live_running_daemon() {
        let runner = MockTailscaleCommandRunner::with_responses(vec![
            status_command("Running"),
            status_command("Stopped"),
        ]);
        let state = state_with_runner(Arc::clone(&runner));
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status = TailscaleStatus::Connected;
        service.active_profile_id = Some(id.clone());

        assert!(service.probe_connection_active(&id).await.unwrap());
        assert!(!service.probe_connection_active(&id).await.unwrap());
        assert_eq!(service.active_profile_id, None);
        assert!(matches!(
            service.connections[&id].status,
            TailscaleStatus::Disconnected
        ));
        assert_eq!(
            runner.calls(),
            vec![
                vec!["status".to_string(), "--json".to_string()],
                vec!["status".to_string(), "--json".to_string()],
            ]
        );
    }

    #[tokio::test]
    async fn verified_owner_probe_queries_and_propagates_errors_despite_cached_error_status() {
        let runner = MockTailscaleCommandRunner::with_responses(vec![Err(
            "status query unavailable".to_string(),
        )]);
        let state = state_with_runner(Arc::clone(&runner));
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status =
            TailscaleStatus::Error("prior verification failed".to_string());
        service.active_profile_id = Some(id.clone());

        let error = service.probe_connection_active(&id).await.unwrap_err();
        assert!(error.contains("status query unavailable"));
        assert_eq!(service.active_profile_id.as_deref(), Some(id.as_str()));
        assert_eq!(
            runner.calls(),
            vec![vec!["status".to_string(), "--json".to_string()]]
        );
    }

    #[tokio::test]
    async fn stale_owner_with_stopped_daemon_runs_up_instead_of_trusting_cache() {
        let runner = MockTailscaleCommandRunner::with_responses(vec![
            status_command("Stopped"),
            successful_command(),
            status_command("Running"),
        ]);
        let state = state_with_runner(Arc::clone(&runner));
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status = TailscaleStatus::Connected;
        service.active_profile_id = Some(id.clone());

        service.connect(&id).await.unwrap();

        let calls = runner.calls();
        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0], vec!["status", "--json"]);
        assert_eq!(calls[1].first().map(String::as_str), Some("up"));
        assert_eq!(calls[2], vec!["status", "--json"]);
        assert!(matches!(
            service.connections[&id].status,
            TailscaleStatus::Connected
        ));
    }

    #[tokio::test]
    async fn stale_owner_status_query_failure_never_runs_up() {
        let runner = MockTailscaleCommandRunner::with_responses(vec![Err(
            "status query unavailable".to_string(),
        )]);
        let state = state_with_runner(Arc::clone(&runner));
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status = TailscaleStatus::Connected;
        service.active_profile_id = Some(id.clone());

        let error = service.connect(&id).await.unwrap_err();

        assert!(error.contains("status query unavailable"));
        assert_eq!(
            runner.calls(),
            vec![vec!["status".to_string(), "--json".to_string()]]
        );
        assert_eq!(service.active_profile_id.as_deref(), Some(id.as_str()));
        assert!(matches!(
            service.connections[&id].status,
            TailscaleStatus::Error(_)
        ));
    }

    #[tokio::test]
    async fn restart_with_running_daemon_rejects_unknown_owner_before_up() {
        let original = TailscaleService::new();
        let encoded = {
            let mut service = original.lock().await;
            service
                .create_connection("Office".to_string(), default_ts_config())
                .await
                .unwrap();
            service.serialize_definitions().unwrap()
        };

        let runner = MockTailscaleCommandRunner::with_responses(vec![status_command("Running")]);
        let restarted = state_with_runner(Arc::clone(&runner));
        let mut service = restarted.lock().await;
        service.deserialize_definitions(&encoded).unwrap();
        let id = service.connections.keys().next().unwrap().clone();

        let error = service.connect(&id).await.unwrap_err();

        assert!(error.contains("without a verified"));
        assert_eq!(service.active_profile_id, None);
        assert!(!service.probe_connection_active(&id).await.unwrap());
        assert!(matches!(
            service.get_connection(&id).await.unwrap().status,
            TailscaleStatus::Error(_)
        ));
        assert_eq!(
            runner.calls(),
            vec![vec!["status".to_string(), "--json".to_string()]]
        );
    }

    #[tokio::test]
    async fn unknown_owner_never_exposes_stale_profile_as_connected() {
        let state = TailscaleService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();
        let connection = service.connections.get_mut(&id).unwrap();
        connection.status = TailscaleStatus::Connected;
        connection.connected_at = Some(Utc::now());
        connection.tailnet_ip = Some("100.64.0.9".to_string());
        service.active_profile_id = None;

        assert!(!service.probe_connection_active(&id).await.unwrap());
        let view = service.get_connection(&id).await.unwrap();
        assert!(matches!(view.status, TailscaleStatus::Disconnected));
        assert!(view.connected_at.is_none());
        assert!(view.tailnet_ip.is_none());
        assert!(matches!(
            service.list_connections().await[0].status,
            TailscaleStatus::Disconnected
        ));
    }

    #[tokio::test]
    async fn verified_connect_logs_status_up_status_without_secrets_or_funnel() {
        let runner = MockTailscaleCommandRunner::with_responses(vec![
            status_command("Stopped"),
            successful_command(),
            status_command("Running"),
        ]);
        let state = state_with_runner(Arc::clone(&runner));
        let mut service = state.lock().await;
        let mut config = default_ts_config();
        config.funnel = Some(false);
        let id = service
            .create_connection("Office".to_string(), config)
            .await
            .unwrap();

        service.connect(&id).await.unwrap();

        let calls = runner.calls();
        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0], vec!["status", "--json"]);
        assert_eq!(calls[1].first().map(String::as_str), Some("up"));
        assert!(calls[1].iter().all(|arg| !arg.contains("tskey-auth-xxx")));
        assert!(calls[1].iter().all(|arg| !arg.starts_with("--funnel")));
        assert_eq!(calls[2], vec!["status", "--json"]);
        assert_eq!(service.active_profile_id.as_deref(), Some(id.as_str()));
        assert!(matches!(
            service.connections[&id].status,
            TailscaleStatus::Connected
        ));
    }

    #[tokio::test]
    async fn connect_errors_never_echo_auth_keys() {
        let runner = MockTailscaleCommandRunner::with_responses(vec![
            status_command("Stopped"),
            Ok(TailscaleCommandOutput {
                success: false,
                stdout: String::new(),
                stderr: "login rejected tskey-auth-super-secret".to_string(),
            }),
        ]);
        let state = state_with_runner(runner);
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();

        let error = service.connect(&id).await.unwrap_err();

        assert!(!error.contains("tskey-auth-super-secret"));
        assert!(error.contains("[REDACTED]"));
        if let TailscaleStatus::Error(stored_error) = &service.connections[&id].status {
            assert!(!stored_error.contains("tskey-auth-super-secret"));
        } else {
            panic!("connection should retain a redacted error");
        }
    }

    #[tokio::test]
    async fn failed_up_retains_exact_owner_for_compensating_down() {
        let runner = MockTailscaleCommandRunner::with_responses(vec![
            status_command("Stopped"),
            Ok(TailscaleCommandOutput {
                success: false,
                stdout: String::new(),
                stderr: "up failed after a possible partial mutation".to_string(),
            }),
            successful_command(),
        ]);
        let state = state_with_runner(Arc::clone(&runner));
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();

        let error = service.connect(&id).await.unwrap_err();

        assert!(error.contains("possible partial mutation"));
        assert_eq!(service.active_profile_id.as_deref(), Some(id.as_str()));
        service.disconnect(&id).await.unwrap();
        assert_eq!(service.active_profile_id, None);
        let calls = runner.calls();
        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0], vec!["status", "--json"]);
        assert_eq!(calls[1].first().map(String::as_str), Some("up"));
        assert_eq!(calls[2], vec!["down"]);
    }

    #[tokio::test]
    async fn unknown_owner_disconnect_clears_only_local_state_without_down() {
        let runner = MockTailscaleCommandRunner::with_responses(Vec::new());
        let state = state_with_runner(Arc::clone(&runner));
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status = TailscaleStatus::Connected;
        service.active_profile_id = None;

        service.disconnect(&id).await.unwrap();

        assert!(runner.calls().is_empty());
        assert!(matches!(
            service.connections[&id].status,
            TailscaleStatus::Disconnected
        ));
    }

    #[tokio::test]
    async fn verified_owner_disconnect_runs_exactly_one_down() {
        let runner = MockTailscaleCommandRunner::with_responses(vec![successful_command()]);
        let state = state_with_runner(Arc::clone(&runner));
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status = TailscaleStatus::Connected;
        service.active_profile_id = Some(id.clone());

        service.disconnect(&id).await.unwrap();

        assert_eq!(runner.calls(), vec![vec!["down".to_string()]]);
        assert_eq!(service.active_profile_id, None);
        assert!(matches!(
            service.connections[&id].status,
            TailscaleStatus::Disconnected
        ));
    }

    #[tokio::test]
    async fn machine_global_daemon_rejects_a_second_profile() {
        let runner = MockTailscaleCommandRunner::with_responses(vec![status_command("Running")]);
        let state = state_with_runner(Arc::clone(&runner));
        let mut service = state.lock().await;
        let first = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();
        let second = service
            .create_connection("Lab".to_string(), default_ts_config())
            .await
            .unwrap();
        service.connections.get_mut(&first).unwrap().status = TailscaleStatus::Connected;
        service.active_profile_id = Some(first.clone());

        // Same-profile acquisition verifies the daemon but never re-runs `up`.
        service.connect(&first).await.unwrap();
        let error = service.connect(&second).await.unwrap_err();
        assert!(error.contains("Office"));
        assert!(error.contains(&first));
        assert!(matches!(
            service.connections.get(&second).unwrap().status,
            TailscaleStatus::Disconnected
        ));
        assert_eq!(service.active_profile_id.as_deref(), Some(first.as_str()));
        assert_eq!(
            runner.calls(),
            vec![vec!["status".to_string(), "--json".to_string()]]
        );
    }

    #[tokio::test]
    async fn non_owner_can_never_run_machine_global_disconnect() {
        let runner = MockTailscaleCommandRunner::with_responses(Vec::new());
        let state = state_with_runner(Arc::clone(&runner));
        let mut service = state.lock().await;
        let first = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();
        let second = service
            .create_connection("Lab".to_string(), default_ts_config())
            .await
            .unwrap();
        service.connections.get_mut(&second).unwrap().status = TailscaleStatus::Connected;
        service.active_profile_id = Some(second.clone());

        let error = service.disconnect(&first).await.unwrap_err();
        assert!(error.contains("Lab"));
        assert_eq!(service.active_profile_id.as_deref(), Some(second.as_str()));
        assert!(matches!(
            service.connections.get(&second).unwrap().status,
            TailscaleStatus::Connected
        ));
        assert!(runner.calls().is_empty());
    }

    #[tokio::test]
    async fn concurrent_profile_acquisitions_preserve_the_single_owner() {
        let runner = MockTailscaleCommandRunner::with_responses(vec![status_command("Running")]);
        let state = state_with_runner(runner);
        let (first, second) = {
            let mut service = state.lock().await;
            let first = service
                .create_connection("Office".to_string(), default_ts_config())
                .await
                .unwrap();
            let second = service
                .create_connection("Lab".to_string(), default_ts_config())
                .await
                .unwrap();
            service.connections.get_mut(&first).unwrap().status = TailscaleStatus::Connected;
            service.active_profile_id = Some(first.clone());
            (first, second)
        };

        let owner_state = Arc::clone(&state);
        let owner_id = first.clone();
        let contender_state = Arc::clone(&state);
        let contender_id = second.clone();
        let (owner_result, contender_result) = tokio::join!(
            async move { owner_state.lock().await.connect(&owner_id).await },
            async move { contender_state.lock().await.connect(&contender_id).await }
        );

        owner_result.unwrap();
        assert!(contender_result.unwrap_err().contains("Office"));
        let service = state.lock().await;
        assert_eq!(service.active_profile_id.as_deref(), Some(first.as_str()));
        assert!(matches!(
            service.connections.get(&second).unwrap().status,
            TailscaleStatus::Disconnected
        ));
    }

    #[tokio::test]
    async fn persisted_profile_keeps_id_and_resets_runtime_state() {
        let state = TailscaleService::new();
        let mut service = state.lock().await;
        let mut config = default_ts_config();
        config.auth_key = Some("tskey-secret".to_string());
        let id = service
            .create_connection("Office".to_string(), config)
            .await
            .unwrap();
        let connection = service.connections.get_mut(&id).unwrap();
        connection.status = TailscaleStatus::Connected;
        connection.tailnet_ip = Some("100.64.0.1".to_string());
        let encoded = service.serialize_definitions().unwrap();
        drop(service);

        let restored_state = TailscaleService::new();
        let mut restored = restored_state.lock().await;
        restored.deserialize_definitions(&encoded).unwrap();
        let connection = restored.get_connection(&id).await.unwrap();
        assert_eq!(connection.id, id);
        assert_eq!(connection.config.auth_key.as_deref(), Some("tskey-secret"));
        assert!(matches!(connection.status, TailscaleStatus::Disconnected));
        assert!(connection.tailnet_ip.is_none());
    }

    #[tokio::test]
    async fn legacy_unsupported_profile_restores_but_cannot_execute() {
        let mut legacy_config = default_ts_config();
        legacy_config.state_dir = Some("legacy-state".to_string());
        legacy_config.socket = Some("legacy.sock".to_string());
        legacy_config.funnel = Some(true);
        let legacy_id = "legacy-profile".to_string();
        let encoded = serialize_profile_definitions(&[TailscaleConnection {
            id: legacy_id.clone(),
            name: "Legacy".to_string(),
            config: legacy_config,
            status: TailscaleStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            tailnet_ip: None,
            hostname: None,
            process_id: None,
        }])
        .unwrap();
        let runner = MockTailscaleCommandRunner::with_responses(Vec::new());
        let state = state_with_runner(Arc::clone(&runner));
        let mut service = state.lock().await;

        service.deserialize_definitions(&encoded).unwrap();
        assert!(service.connections.contains_key(&legacy_id));
        let error = service.connect(&legacy_id).await.unwrap_err();

        assert!(error.contains("state_dir"));
        assert!(runner.calls().is_empty());
        assert!(matches!(
            service.connections[&legacy_id].status,
            TailscaleStatus::Error(_)
        ));
    }

    #[tokio::test]
    async fn corrupt_profile_data_does_not_replace_live_definitions() {
        let state = TailscaleService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();
        assert!(service.deserialize_definitions("not-json").is_err());
        assert!(service.connections.contains_key(&id));
    }

    #[test]
    fn ipc_view_redacts_tailscale_auth_key_and_reports_presence() {
        let mut config = default_ts_config();
        config.auth_key = Some("TAILSCALE-AUTH-KEY-SENTINEL".to_string());
        let view = TailscaleConnection {
            id: "profile".to_string(),
            name: "Office".to_string(),
            config,
            status: TailscaleStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            tailnet_ip: None,
            hostname: None,
            process_id: None,
        }
        .into_redacted_view();

        let json = serde_json::to_string(&view).unwrap();
        assert!(!json.contains("TAILSCALE-AUTH-KEY-SENTINEL"));
        assert_eq!(
            view.secret_presence,
            TailscaleSecretPresence { auth_key: true }
        );
    }

    #[tokio::test]
    async fn ipc_update_preserves_replaces_and_explicitly_clears_tailscale_secret() {
        let state = TailscaleService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_ts_config())
            .await
            .unwrap();

        let mut omitted = default_ts_config();
        omitted.auth_key = Some(" ".to_string());
        service
            .update_connection_from_ipc(
                &id,
                None,
                Some(omitted),
                TailscaleSecretMutation::default(),
            )
            .await
            .unwrap();
        assert_eq!(
            service.connections[&id].config.auth_key.as_deref(),
            Some("tskey-auth-xxx")
        );

        let mut replacement = default_ts_config();
        replacement.auth_key = Some("tskey-auth-replacement".to_string());
        service
            .update_connection_from_ipc(
                &id,
                None,
                Some(replacement),
                TailscaleSecretMutation::default(),
            )
            .await
            .unwrap();
        assert_eq!(
            service.connections[&id].config.auth_key.as_deref(),
            Some("tskey-auth-replacement")
        );

        service
            .update_connection_from_ipc(
                &id,
                None,
                None,
                TailscaleSecretMutation {
                    clear_auth_key: true,
                },
            )
            .await
            .unwrap();
        assert!(service.connections[&id].config.auth_key.is_none());
    }
}
