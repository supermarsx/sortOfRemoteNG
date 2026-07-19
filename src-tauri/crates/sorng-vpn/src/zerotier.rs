use crate::persistence::{
    deserialize_profile_definitions, load_service_data, save_service_data,
    serialize_profile_definitions, Persistable, RestoreOutcome,
};
use crate::platform;
use chrono::{DateTime, Utc};
use serde_json;
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

pub type ZeroTierServiceState = Arc<Mutex<ZeroTierService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ZeroTierConnection {
    pub id: String,
    pub name: String,
    pub config: ZeroTierConfig,
    pub status: ZeroTierStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub network_id: Option<String>,
    pub assigned_ips: Vec<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ZeroTierStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ZeroTierConfig {
    pub network_id: String,
    pub identity_secret: Option<String>,
    pub identity_public: Option<String>,
    pub allow_managed: Option<bool>,
    pub allow_global: Option<bool>,
    pub allow_default: Option<bool>,
    pub allow_dns: Option<bool>,
    pub zerotier_home: Option<String>,
    pub authtoken_secret: Option<String>,
}

pub struct ZeroTierService {
    connections: HashMap<String, ZeroTierConnection>,
    #[allow(dead_code)]
    emitter: Option<DynEventEmitter>,
    storage: Option<sorng_storage::storage::SecureStorageState>,
    definitions_loaded: bool,
    command_runner: Arc<dyn ZeroTierCommandRunner>,
}

struct ZeroTierCommandOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

#[async_trait::async_trait]
trait ZeroTierCommandRunner: Send + Sync {
    fn resolve_binary(&self) -> Result<PathBuf, String>;

    async fn output(&self, binary: &Path, args: &[String])
        -> Result<ZeroTierCommandOutput, String>;
}

struct SystemZeroTierCommandRunner;

#[async_trait::async_trait]
impl ZeroTierCommandRunner for SystemZeroTierCommandRunner {
    fn resolve_binary(&self) -> Result<PathBuf, String> {
        platform::resolve_binary("zerotier-cli")
            .map_err(|error| format!("Failed to find zerotier-cli binary: {error}"))
    }

    async fn output(
        &self,
        binary: &Path,
        args: &[String],
    ) -> Result<ZeroTierCommandOutput, String> {
        let output = Command::new(binary)
            .args(args)
            .output()
            .await
            .map_err(|error| error.to_string())?;
        Ok(ZeroTierCommandOutput {
            success: output.status.success(),
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
}

struct TemporaryZeroTierAuthToken {
    path: PathBuf,
    directory: PathBuf,
}

impl Drop for TemporaryZeroTierAuthToken {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_dir(&self.directory);
    }
}

fn create_secure_zerotier_auth_token(token: &str) -> Result<TemporaryZeroTierAuthToken, String> {
    let directory =
        std::env::temp_dir().join(format!("sortofremoteng-zerotier-auth-{}", Uuid::new_v4()));

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
        .map_err(|e| format!("Failed to create a private ZeroTier auth directory: {e}"))?;

    let path = directory.join("authtoken.secret");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut secret = token.as_bytes().to_vec();
    let write_result = options
        .open(&path)
        .and_then(|mut file| file.write_all(&secret));
    secret.zeroize();

    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&directory);
        return Err(format!(
            "Failed to write the private ZeroTier auth-token file: {error}"
        ));
    }

    Ok(TemporaryZeroTierAuthToken { path, directory })
}

fn zerotier_default_homes() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut homes = Vec::new();
        if let Some(program_data) = std::env::var_os("ProgramData") {
            homes.push(PathBuf::from(program_data).join("ZeroTier").join("One"));
        }
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            homes.push(PathBuf::from(local_app_data).join("ZeroTier"));
        }
        homes
    }
    #[cfg(target_os = "macos")]
    {
        vec![PathBuf::from("/Library/Application Support/ZeroTier/One")]
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        vec![PathBuf::from("/var/lib/zerotier-one")]
    }
}

fn discover_zerotier_control_port(configured_home: Option<&str>) -> u16 {
    let configured = configured_home.map(PathBuf::from).into_iter();
    configured
        .chain(zerotier_default_homes())
        .find_map(|home| {
            std::fs::read_to_string(home.join("zerotier-one.port"))
                .ok()?
                .trim()
                .parse::<u16>()
                .ok()
        })
        .unwrap_or(9993)
}

struct ZeroTierCliContext {
    binary: PathBuf,
    prefix_args: Vec<String>,
    auth_secret: Option<Zeroizing<String>>,
    _auth_file: Option<TemporaryZeroTierAuthToken>,
    command_runner: Arc<dyn ZeroTierCommandRunner>,
}

impl ZeroTierCliContext {
    fn prepare(
        config: &mut ZeroTierConfig,
        command_runner: Arc<dyn ZeroTierCommandRunner>,
    ) -> Result<Self, String> {
        let binary = command_runner.resolve_binary()?;
        Self::prepare_with_runner(config, binary, command_runner)
    }

    #[cfg(test)]
    fn prepare_with_binary(config: &mut ZeroTierConfig, binary: PathBuf) -> Result<Self, String> {
        Self::prepare_with_runner(config, binary, Arc::new(SystemZeroTierCommandRunner))
    }

    fn prepare_with_runner(
        config: &mut ZeroTierConfig,
        binary: PathBuf,
        command_runner: Arc<dyn ZeroTierCommandRunner>,
    ) -> Result<Self, String> {
        let auth_secret = config.authtoken_secret.take().map(Zeroizing::new);
        let auth_file = auth_secret
            .as_ref()
            .map(|secret| create_secure_zerotier_auth_token(secret.as_str()))
            .transpose()?;

        let mut prefix_args = Vec::new();
        if let Some(file) = &auth_file {
            prefix_args.push(format!("-D{}", file.directory.to_string_lossy()));
            prefix_args.push(format!(
                "-p{}",
                discover_zerotier_control_port(config.zerotier_home.as_deref())
            ));
        } else if let Some(home) = config.zerotier_home.as_deref() {
            prefix_args.push(format!("-D{home}"));
        }

        Ok(Self {
            binary,
            prefix_args,
            auth_secret,
            _auth_file: auth_file,
            command_runner,
        })
    }

    fn command_args(&self, command_args: &[String]) -> Vec<String> {
        self.prefix_args
            .iter()
            .chain(command_args)
            .cloned()
            .collect()
    }

    async fn run(
        &self,
        command_args: &[String],
        operation: &str,
    ) -> Result<ZeroTierCommandOutput, String> {
        let args = self.command_args(command_args);
        let output = self
            .command_runner
            .output(&self.binary, &args)
            .await
            .map_err(|e| format!("Failed to execute zerotier-cli for {operation}: {e}"))?;
        if !output.success {
            return Err(format!(
                "ZeroTier {operation} failed: {}",
                sanitize_zerotier_diagnostic(
                    &String::from_utf8_lossy(&output.stderr),
                    self.auth_secret.as_deref().map(String::as_str),
                )
            ));
        }
        Ok(output)
    }
}

fn sanitize_zerotier_diagnostic(input: &str, auth_secret: Option<&str>) -> String {
    let mut sanitized = input.trim().to_string();
    if let Some(secret) = auth_secret.filter(|secret| !secret.is_empty()) {
        sanitized = sanitized.replace(secret, "[REDACTED]");
    }
    let normalized = sanitized.split_whitespace().collect::<Vec<_>>().join(" ");
    let bounded = normalized.chars().take(600).collect::<String>();
    if bounded.is_empty() {
        "No diagnostic output was provided".to_string()
    } else {
        bounded
    }
}

fn validate_zerotier_profile(config: &ZeroTierConfig) -> Result<(), String> {
    if !is_valid_zerotier_network_id(&config.network_id) {
        return Err("ZeroTier network ID must be exactly 16 hexadecimal characters".to_string());
    }
    if config.identity_public.is_some() || config.identity_secret.is_some() {
        return Err(
            "ZeroTier identity is daemon-global and cannot be changed by a per-network profile; configure the intended identity in the protected ZeroTier home before connecting"
                .to_string(),
        );
    }
    if config
        .authtoken_secret
        .as_deref()
        .is_some_and(|token| token.trim().is_empty())
    {
        return Err("ZeroTier auth token cannot be empty".to_string());
    }
    if config
        .zerotier_home
        .as_deref()
        .is_some_and(|home| home.trim().is_empty())
    {
        return Err("ZeroTier home path cannot be empty".to_string());
    }
    Ok(())
}

fn is_valid_zerotier_network_id(network_id: &str) -> bool {
    network_id.len() == 16
        && network_id
            .bytes()
            .all(|character| character.is_ascii_hexdigit())
}

fn canonical_zerotier_network_id(network_id: &str) -> String {
    network_id.to_ascii_lowercase()
}

fn zerotier_profile_may_own_membership(connection: &ZeroTierConnection, network_id: &str) -> bool {
    connection
        .network_id
        .as_deref()
        .is_some_and(|runtime_id| runtime_id.eq_ignore_ascii_case(network_id))
        && !matches!(connection.status, ZeroTierStatus::Disconnected)
}

fn zerotier_policy_commands(config: &ZeroTierConfig) -> Vec<Vec<String>> {
    [
        ("allowManaged", config.allow_managed),
        ("allowGlobal", config.allow_global),
        ("allowDefault", config.allow_default),
        ("allowDNS", config.allow_dns),
    ]
    .into_iter()
    .filter_map(|(setting, enabled)| {
        enabled.map(|enabled| {
            vec![
                "set".to_string(),
                config.network_id.clone(),
                setting.to_string(),
                enabled.to_string(),
            ]
        })
    })
    .collect()
}

impl ZeroTierService {
    fn duplicate_network_profile(
        &self,
        connection_id: Option<&str>,
        network_id: &str,
    ) -> Option<&ZeroTierConnection> {
        self.connections.values().find(|connection| {
            connection_id != Some(connection.id.as_str())
                && connection
                    .config
                    .network_id
                    .eq_ignore_ascii_case(network_id)
        })
    }

    fn active_network_owner(
        &self,
        connection_id: &str,
        network_id: &str,
    ) -> Option<&ZeroTierConnection> {
        self.connections.values().find(|connection| {
            connection.id != connection_id
                && zerotier_profile_may_own_membership(connection, network_id)
        })
    }

    fn duplicate_network_error(network_id: &str, conflict: &ZeroTierConnection) -> String {
        format!(
            "ZeroTier network {network_id} is already assigned to profile '{}' ({}); each ZeroTier network can have only one app profile because membership and policy are machine-wide",
            conflict.name, conflict.id
        )
    }

    pub fn new() -> ZeroTierServiceState {
        Arc::new(Mutex::new(ZeroTierService {
            connections: HashMap::new(),
            emitter: None,
            storage: None,
            definitions_loaded: true,
            command_runner: Arc::new(SystemZeroTierCommandRunner),
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> ZeroTierServiceState {
        Arc::new(Mutex::new(ZeroTierService {
            connections: HashMap::new(),
            emitter: Some(emitter),
            storage: None,
            definitions_loaded: true,
            command_runner: Arc::new(SystemZeroTierCommandRunner),
        }))
    }

    pub fn new_persistent(
        emitter: DynEventEmitter,
        storage: sorng_storage::storage::SecureStorageState,
    ) -> ZeroTierServiceState {
        Arc::new(Mutex::new(ZeroTierService {
            connections: HashMap::new(),
            emitter: Some(emitter),
            storage: Some(storage),
            definitions_loaded: false,
            command_runner: Arc::new(SystemZeroTierCommandRunner),
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
                "ZeroTier profile storage is unreadable; stored profiles were left untouched: {e}"
            )),
        }
    }

    async fn persist_or_rollback(
        &mut self,
        previous: HashMap<String, ZeroTierConnection>,
    ) -> Result<(), String> {
        let Some(storage) = self.storage.clone() else {
            return Ok(());
        };
        if let Err(e) = save_service_data(self, &storage).await {
            self.connections = previous;
            return Err(format!(
                "ZeroTier profile change was not saved and has been rolled back: {e}"
            ));
        }
        Ok(())
    }

    #[allow(dead_code)]
    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "zerotier",
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
        mut config: ZeroTierConfig,
    ) -> Result<String, String> {
        self.ensure_persisted_loaded().await?;
        validate_zerotier_profile(&config)?;
        config.network_id = canonical_zerotier_network_id(&config.network_id);
        if let Some(conflict) = self.duplicate_network_profile(None, &config.network_id) {
            return Err(Self::duplicate_network_error(&config.network_id, conflict));
        }
        let previous = self.connections.clone();
        let id = Uuid::new_v4().to_string();
        let connection = ZeroTierConnection {
            id: id.clone(),
            name,
            config,
            status: ZeroTierStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            network_id: None,
            assigned_ips: Vec::new(),
            process_id: None,
        };

        self.connections.insert(id.clone(), connection);
        self.persist_or_rollback(previous).await?;
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let (mut config, retained_membership, current_status) = {
            let connection = self
                .connections
                .get(connection_id)
                .ok_or_else(|| "ZeroTier connection not found".to_string())?;
            (
                connection.config.clone(),
                connection.network_id.clone(),
                connection.status.clone(),
            )
        };

        if let Err(error) = validate_zerotier_profile(&config) {
            if retained_membership.is_some() {
                self.set_connection_error_preserving_membership(connection_id, &error);
            } else {
                self.set_connection_error(connection_id, &error);
            }
            return Err(error);
        }
        config.network_id = canonical_zerotier_network_id(&config.network_id);

        // Guard machine-wide conflicts before considering a cached owner token
        // reusable. Legacy duplicates must not bypass the single-owner rule.
        if let Some(conflict) =
            self.duplicate_network_profile(Some(connection_id), &config.network_id)
        {
            let error = Self::duplicate_network_error(&config.network_id, conflict);
            if retained_membership.is_some() {
                self.set_connection_error_preserving_membership(connection_id, &error);
            } else {
                self.set_connection_error(connection_id, &error);
            }
            return Err(error);
        }
        if let Some(conflict) = self.active_network_owner(connection_id, &config.network_id) {
            let error = format!(
                "ZeroTier network {} is currently owned by profile '{}' ({}); disconnect it before connecting another profile",
                config.network_id, conflict.name, conflict.id
            );
            if retained_membership.is_some() {
                self.set_connection_error_preserving_membership(connection_id, &error);
            } else {
                self.set_connection_error(connection_id, &error);
            }
            return Err(error);
        }

        let owned_network_id = match retained_membership {
            Some(owned_network_id) => {
                if !owned_network_id.eq_ignore_ascii_case(&config.network_id)
                    || !matches!(current_status, ZeroTierStatus::Connected)
                {
                    let error = format!(
                        "ZeroTier profile retains ownership of network {owned_network_id} after an incomplete cleanup; disconnect it before reconnecting"
                    );
                    self.set_connection_error_preserving_membership(connection_id, &error);
                    return Err(error);
                }
                Some(owned_network_id)
            }
            None => None,
        };

        if owned_network_id.is_none() {
            if let Some(connection) = self.connections.get_mut(connection_id) {
                connection.status = ZeroTierStatus::Connecting;
                connection.connected_at = None;
                connection.assigned_ips.clear();
            }
            self.emit_status(connection_id, "connecting", serde_json::json!({}));
        }

        let context =
            match ZeroTierCliContext::prepare(&mut config, Arc::clone(&self.command_runner)) {
                Ok(context) => context,
                Err(error) => {
                    if owned_network_id.is_some() {
                        self.set_connection_error_preserving_membership(connection_id, &error);
                    } else {
                        self.set_connection_error(connection_id, &error);
                    }
                    return Err(error);
                }
            };
        let network_id = config.network_id.clone();

        match fetch_zerotier_network_info(&context, &network_id).await {
            Ok(Some(info)) => {
                if owned_network_id.is_some() {
                    match classify_zerotier_readiness(Some(info)) {
                        ZeroTierReadiness::Ready(info) => {
                            if let Some(connection) = self.connections.get_mut(connection_id) {
                                connection.network_id = Some(network_id.clone());
                                connection.status = ZeroTierStatus::Connected;
                                connection.connected_at.get_or_insert_with(Utc::now);
                                connection.assigned_ips = info.assigned_ips;
                            }
                            self.emit_status(
                                connection_id,
                                "connected",
                                serde_json::json!({
                                    "network_id": network_id,
                                    "membership_reused": true,
                                }),
                            );
                            return Ok(());
                        }
                        ZeroTierReadiness::Failed(error) | ZeroTierReadiness::Pending(error) => {
                            let error = format!(
                                "Owned ZeroTier network {network_id} is not ready ({error}); disconnect it before retrying"
                            );
                            self.set_connection_error_preserving_membership(connection_id, &error);
                            return Err(error);
                        }
                    }
                } else {
                    let error = format!(
                        "ZeroTier network {network_id} is already joined outside this profile; the external membership was left unchanged"
                    );
                    self.set_connection_error(connection_id, &error);
                    return Err(error);
                }
            }
            Ok(None) => {
                if owned_network_id.is_some() {
                    if let Some(connection) = self.connections.get_mut(connection_id) {
                        connection.status = ZeroTierStatus::Connecting;
                        connection.connected_at = None;
                        connection.network_id = Some(network_id.clone());
                        connection.assigned_ips.clear();
                    }
                    self.emit_status(
                        connection_id,
                        "connecting",
                        serde_json::json!({ "recovering_missing_membership": true }),
                    );
                }
            }
            Err(error) => {
                if owned_network_id.is_some() {
                    self.set_connection_error_preserving_membership(connection_id, &error);
                } else {
                    self.set_connection_error(connection_id, &error);
                }
                return Err(error);
            }
        }

        let join = vec!["join".to_string(), network_id.clone()];
        if let Err(error) = context.run(&join, "join").await {
            // Even a failed join may have partially changed daemon-global
            // state. Keep a cleanup token until leave succeeds.
            if let Some(connection) = self.connections.get_mut(connection_id) {
                connection.network_id = Some(network_id.clone());
            }
            let error = self
                .cleanup_owned_membership_after_connect_failure(
                    connection_id,
                    &context,
                    &network_id,
                    error,
                )
                .await;
            return Err(error);
        }
        if let Some(connection) = self.connections.get_mut(connection_id) {
            // A successful join is the ownership boundary. Record it before
            // applying policy so every later failure can safely retry leave.
            connection.network_id = Some(network_id.clone());
        }

        for command in zerotier_policy_commands(&config) {
            if let Err(error) = context.run(&command, "network policy update").await {
                let error = self
                    .cleanup_owned_membership_after_connect_failure(
                        connection_id,
                        &context,
                        &network_id,
                        error,
                    )
                    .await;
                return Err(error);
            }
        }

        let network_info =
            match wait_for_zerotier_readiness(&context, &network_id, Duration::from_secs(45)).await
            {
                Ok(info) => info,
                Err(error) => {
                    let error = self
                        .cleanup_owned_membership_after_connect_failure(
                            connection_id,
                            &context,
                            &network_id,
                            error,
                        )
                        .await;
                    return Err(error);
                }
            };

        if let Some(connection) = self.connections.get_mut(connection_id) {
            connection.network_id = Some(network_id.clone());
            connection.status = ZeroTierStatus::Connected;
            connection.connected_at = Some(Utc::now());
            connection.assigned_ips = network_info.assigned_ips;
        }
        self.emit_status(
            connection_id,
            "connected",
            serde_json::json!({ "network_id": network_id }),
        );
        Ok(())
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let (mut config, network_id) = {
            let connection = self
                .connections
                .get(connection_id)
                .ok_or_else(|| "ZeroTier connection not found".to_string())?;
            if matches!(connection.status, ZeroTierStatus::Disconnected)
                && connection.network_id.is_none()
            {
                return Ok(());
            }
            (connection.config.clone(), connection.network_id.clone())
        };

        let Some(network_id) = network_id else {
            // No ownership token means the profile did not create this
            // machine-wide membership. Never issue leave for external state.
            if let Some(connection) = self.connections.get_mut(connection_id) {
                connection.status = ZeroTierStatus::Disconnected;
                connection.connected_at = None;
                connection.assigned_ips.clear();
            }
            self.emit_status(
                connection_id,
                "disconnected",
                serde_json::json!({ "membership_retained": true }),
            );
            return Ok(());
        };

        if let Some(other_owner) = self.active_network_owner(connection_id, &network_id) {
            let retained_for = format!("{} ({})", other_owner.name, other_owner.id);
            if let Some(connection) = self.connections.get_mut(connection_id) {
                connection.status = ZeroTierStatus::Disconnected;
                connection.connected_at = None;
                connection.network_id = None;
                connection.assigned_ips.clear();
            }
            self.emit_status(
                connection_id,
                "disconnected",
                serde_json::json!({
                    "membership_retained": true,
                    "retained_for_profile": retained_for,
                }),
            );
            return Ok(());
        }

        let context =
            match ZeroTierCliContext::prepare(&mut config, Arc::clone(&self.command_runner)) {
                Ok(context) => context,
                Err(error) => {
                    if let Some(connection) = self.connections.get_mut(connection_id) {
                        connection.status = ZeroTierStatus::Error(error.clone());
                    }
                    return Err(error);
                }
            };

        if let Some(connection) = self.connections.get_mut(connection_id) {
            connection.status = ZeroTierStatus::Disconnecting;
        }
        self.emit_status(connection_id, "disconnecting", serde_json::json!({}));

        let leave = vec!["leave".to_string(), network_id];
        if let Err(error) = context.run(&leave, "leave").await {
            if let Some(connection) = self.connections.get_mut(connection_id) {
                connection.status = ZeroTierStatus::Error(error.clone());
            }
            self.emit_status(
                connection_id,
                "error",
                serde_json::json!({ "error": &error }),
            );
            return Err(error);
        }

        if let Some(connection) = self.connections.get_mut(connection_id) {
            connection.status = ZeroTierStatus::Disconnected;
            connection.connected_at = None;
            connection.network_id = None;
            connection.assigned_ips.clear();
        }
        self.emit_status(connection_id, "disconnected", serde_json::json!({}));
        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<ZeroTierConnection, String> {
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "ZeroTier connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<ZeroTierConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn is_connection_active(&self, connection_id: &str) -> bool {
        let Some(connection) = self.connections.get(connection_id) else {
            return false;
        };
        let mut config = connection.config.clone();
        if validate_zerotier_profile(&config).is_err()
            || self
                .duplicate_network_profile(Some(connection_id), &config.network_id)
                .is_some()
            || self
                .active_network_owner(connection_id, &config.network_id)
                .is_some()
        {
            // A duplicate app profile must reach `connect`, where the
            // machine-wide ownership conflict is reported. Treating the live
            // membership as external here would create an unsafe independent
            // lifecycle lease for the same ZeroTier network.
            return false;
        }
        match ZeroTierCliContext::prepare(&mut config, Arc::clone(&self.command_runner)) {
            Ok(context) => matches!(
                fetch_zerotier_network_info(&context, &config.network_id).await,
                Ok(Some(NetworkInfo { ref status, .. })) if status.eq_ignore_ascii_case("OK")
            ),
            Err(_) => false,
        }
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if let Some(connection) = self.connections.get(connection_id) {
            if connection.network_id.is_some()
                || matches!(
                    connection.status,
                    ZeroTierStatus::Connected | ZeroTierStatus::Disconnecting
                )
            {
                self.disconnect(connection_id).await?;
            }
        }

        let previous = self.connections.clone();
        self.connections.remove(connection_id);
        self.persist_or_rollback(previous).await
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        mut config: Option<ZeroTierConfig>,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let current = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "ZeroTier connection not found".to_string())?;
        if config.is_some() && !matches!(current.status, ZeroTierStatus::Disconnected) {
            return Err(
                "Disconnect the ZeroTier profile before changing its configuration".to_string(),
            );
        }
        if let Some(new_config) = config.as_mut() {
            validate_zerotier_profile(new_config)?;
            new_config.network_id = canonical_zerotier_network_id(&new_config.network_id);
            if let Some(conflict) =
                self.duplicate_network_profile(Some(connection_id), &new_config.network_id)
            {
                return Err(Self::duplicate_network_error(
                    &new_config.network_id,
                    conflict,
                ));
            }
        }
        let previous = self.connections.clone();
        let connection = self
            .connections
            .get_mut(connection_id)
            .expect("connection existence checked above");

        if let Some(new_name) = name {
            connection.name = new_name;
        }
        if let Some(new_config) = config {
            connection.config = new_config;
        }
        self.persist_or_rollback(previous).await
    }

    fn set_connection_error(&mut self, connection_id: &str, error: &str) {
        if let Some(connection) = self.connections.get_mut(connection_id) {
            connection.status = ZeroTierStatus::Error(error.to_string());
            connection.connected_at = None;
            connection.network_id = None;
            connection.assigned_ips.clear();
        }
        self.emit_status(
            connection_id,
            "error",
            serde_json::json!({ "error": error }),
        );
    }

    fn set_connection_error_preserving_membership(&mut self, connection_id: &str, error: &str) {
        if let Some(connection) = self.connections.get_mut(connection_id) {
            connection.status = ZeroTierStatus::Error(error.to_string());
            connection.connected_at = None;
            connection.assigned_ips.clear();
        }
        self.emit_status(
            connection_id,
            "error",
            serde_json::json!({ "error": error, "cleanup_required": true }),
        );
    }

    async fn cleanup_owned_membership_after_connect_failure(
        &mut self,
        connection_id: &str,
        context: &ZeroTierCliContext,
        network_id: &str,
        operation_error: String,
    ) -> String {
        match cleanup_zerotier_membership(context, network_id).await {
            Ok(()) => {
                self.set_connection_error(connection_id, &operation_error);
                operation_error
            }
            Err(cleanup_error) => {
                let combined = format!(
                    "{operation_error}; ZeroTier cleanup leave failed and must be retried with disconnect: {cleanup_error}"
                );
                self.set_connection_error_preserving_membership(connection_id, &combined);
                combined
            }
        }
    }
}

#[async_trait::async_trait]
impl Persistable for ZeroTierService {
    fn storage_key(&self) -> &'static str {
        crate::persistence::keys::ZEROTIER
    }

    fn serialize_definitions(&self) -> Result<String, String> {
        let mut connections = self.connections.values().cloned().collect::<Vec<_>>();
        connections.sort_by(|a, b| a.id.cmp(&b.id));
        for connection in &mut connections {
            connection.status = ZeroTierStatus::Disconnected;
            connection.connected_at = None;
            connection.network_id = None;
            connection.assigned_ips.clear();
            connection.process_id = None;
        }
        serialize_profile_definitions(&connections)
    }

    fn deserialize_definitions(&mut self, data: &str) -> Result<(), String> {
        let mut restored = HashMap::new();
        for mut connection in deserialize_profile_definitions::<ZeroTierConnection>(data)? {
            if connection.id.trim().is_empty() {
                return Err("ZeroTier profile has an empty id".to_string());
            }
            if is_valid_zerotier_network_id(&connection.config.network_id) {
                connection.config.network_id =
                    canonical_zerotier_network_id(&connection.config.network_id);
            }
            connection.status = ZeroTierStatus::Disconnected;
            connection.connected_at = None;
            connection.network_id = None;
            connection.assigned_ips.clear();
            connection.process_id = None;
            let id = connection.id.clone();
            if restored.insert(id.clone(), connection).is_some() {
                return Err(format!(
                    "ZeroTier profile data contains duplicate id '{id}'"
                ));
            }
        }
        self.connections = restored;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NetworkInfo {
    assigned_ips: Vec<String>,
    status: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ZeroTierReadiness {
    Ready(NetworkInfo),
    Pending(String),
    Failed(String),
}

fn parse_zerotier_network_info(
    json: &str,
    network_id: &str,
) -> Result<Option<NetworkInfo>, String> {
    let networks: Vec<serde_json::Value> = serde_json::from_str(json)
        .map_err(|e| format!("Failed to parse ZeroTier network status: {e}"))?;

    for network in networks {
        let id = network
            .get("id")
            .or_else(|| network.get("nwid"))
            .and_then(|value| value.as_str());
        if !id.is_some_and(|id| id.eq_ignore_ascii_case(network_id)) {
            continue;
        }

        let assigned_ips = network
            .get("assignedAddresses")
            .and_then(|value| value.as_array())
            .map(|addresses| {
                addresses
                    .iter()
                    .filter_map(|address| address.as_str().map(ToString::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let status = network
            .get("status")
            .and_then(|value| value.as_str())
            .unwrap_or("UNKNOWN")
            .to_string();
        return Ok(Some(NetworkInfo {
            assigned_ips,
            status,
        }));
    }

    Ok(None)
}

fn classify_zerotier_readiness(info: Option<NetworkInfo>) -> ZeroTierReadiness {
    let Some(info) = info else {
        return ZeroTierReadiness::Pending("network is not listed yet".to_string());
    };
    match info.status.to_ascii_uppercase().as_str() {
        "OK" => ZeroTierReadiness::Ready(info),
        "ACCESS_DENIED" => ZeroTierReadiness::Failed(
            "ZeroTier network access was denied; authorize this device in ZeroTier Central"
                .to_string(),
        ),
        "NOT_FOUND" => ZeroTierReadiness::Failed(
            "ZeroTier network was not found; verify the 16-character network ID".to_string(),
        ),
        "PORT_ERROR" => ZeroTierReadiness::Failed(
            "ZeroTier reported a virtual network port error; inspect the local ZeroTier service and adapter permissions"
                .to_string(),
        ),
        "CLIENT_TOO_OLD" => ZeroTierReadiness::Failed(
            "The installed ZeroTier client is too old for this network; upgrade ZeroTier and retry"
                .to_string(),
        ),
        status => ZeroTierReadiness::Pending(format!("network status is {status}")),
    }
}

async fn fetch_zerotier_network_info(
    context: &ZeroTierCliContext,
    network_id: &str,
) -> Result<Option<NetworkInfo>, String> {
    let command = vec!["-j".to_string(), "listnetworks".to_string()];
    let output = context.run(&command, "network status query").await?;
    parse_zerotier_network_info(&String::from_utf8_lossy(&output.stdout), network_id)
}

async fn wait_for_zerotier_readiness(
    context: &ZeroTierCliContext,
    network_id: &str,
    timeout: Duration,
) -> Result<NetworkInfo, String> {
    let deadline = Instant::now() + timeout;
    loop {
        match classify_zerotier_readiness(fetch_zerotier_network_info(context, network_id).await?) {
            ZeroTierReadiness::Ready(info) => return Ok(info),
            ZeroTierReadiness::Failed(error) => return Err(error),
            ZeroTierReadiness::Pending(status) => {
                if Instant::now() >= deadline {
                    return Err(format!(
                        "ZeroTier network did not become ready within {} seconds ({status})",
                        timeout.as_secs()
                    ));
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

async fn cleanup_zerotier_membership(
    context: &ZeroTierCliContext,
    network_id: &str,
) -> Result<(), String> {
    let leave = vec!["leave".to_string(), network_id.to_string()];
    context.run(&leave, "partial join cleanup").await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    struct ScriptedZeroTierCommandRunner {
        resolve_error: Option<String>,
        responses: std::sync::Mutex<VecDeque<Result<ZeroTierCommandOutput, String>>>,
        calls: std::sync::Mutex<Vec<Vec<String>>>,
    }

    impl ScriptedZeroTierCommandRunner {
        fn new(responses: Vec<Result<ZeroTierCommandOutput, String>>) -> Self {
            Self {
                resolve_error: None,
                responses: std::sync::Mutex::new(responses.into()),
                calls: std::sync::Mutex::new(Vec::new()),
            }
        }

        fn with_resolve_error(error: &str) -> Self {
            Self {
                resolve_error: Some(error.to_string()),
                responses: std::sync::Mutex::new(VecDeque::new()),
                calls: std::sync::Mutex::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<Vec<String>> {
            self.calls.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl ZeroTierCommandRunner for ScriptedZeroTierCommandRunner {
        fn resolve_binary(&self) -> Result<PathBuf, String> {
            match &self.resolve_error {
                Some(error) => Err(error.clone()),
                None => Ok(PathBuf::from("zerotier-cli-test")),
            }
        }

        async fn output(
            &self,
            _binary: &Path,
            args: &[String],
        ) -> Result<ZeroTierCommandOutput, String> {
            self.calls.lock().unwrap().push(args.to_vec());
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Err(format!("unexpected ZeroTier command: {}", args.join(" "))))
        }
    }

    fn successful_output(stdout: &str) -> Result<ZeroTierCommandOutput, String> {
        Ok(ZeroTierCommandOutput {
            success: true,
            stdout: stdout.as_bytes().to_vec(),
            stderr: Vec::new(),
        })
    }

    fn failed_output(stderr: &str) -> Result<ZeroTierCommandOutput, String> {
        Ok(ZeroTierCommandOutput {
            success: false,
            stdout: Vec::new(),
            stderr: stderr.as_bytes().to_vec(),
        })
    }

    fn service_with_runner(command_runner: Arc<ScriptedZeroTierCommandRunner>) -> ZeroTierService {
        ZeroTierService {
            connections: HashMap::new(),
            emitter: None,
            storage: None,
            definitions_loaded: true,
            command_runner,
        }
    }

    fn persistent_test_state(
        storage: sorng_storage::storage::SecureStorageState,
    ) -> ZeroTierServiceState {
        Arc::new(Mutex::new(ZeroTierService {
            connections: HashMap::new(),
            emitter: None,
            storage: Some(storage),
            definitions_loaded: false,
            command_runner: Arc::new(SystemZeroTierCommandRunner),
        }))
    }

    fn default_zt_config() -> ZeroTierConfig {
        ZeroTierConfig {
            network_id: "8056c2e21c000001".to_string(),
            identity_secret: None,
            identity_public: None,
            allow_managed: Some(true),
            allow_global: Some(false),
            allow_default: Some(false),
            allow_dns: Some(true),
            zerotier_home: None,
            authtoken_secret: None,
        }
    }

    // ── Serde ───────────────────────────────────────────────────────────

    #[test]
    fn zerotier_status_serde_roundtrip() {
        let variants: Vec<ZeroTierStatus> = vec![
            ZeroTierStatus::Disconnected,
            ZeroTierStatus::Connecting,
            ZeroTierStatus::Connected,
            ZeroTierStatus::Disconnecting,
            ZeroTierStatus::Error("test".to_string()),
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: ZeroTierStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", v), format!("{:?}", back));
        }
    }

    #[test]
    fn zerotier_config_serde_roundtrip() {
        let cfg = default_zt_config();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: ZeroTierConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.network_id, "8056c2e21c000001");
        assert_eq!(back.allow_managed, Some(true));
    }

    #[test]
    fn frontend_snake_case_config_payload_deserializes() {
        let config: ZeroTierConfig = serde_json::from_value(serde_json::json!({
            "network_id": "8056c2e21c000001",
            "allow_managed": true,
            "allow_global": false,
            "allow_default": false,
            "allow_dns": true
        }))
        .unwrap();

        assert_eq!(config.network_id, "8056c2e21c000001");
        assert_eq!(config.allow_managed, Some(true));
        assert_eq!(config.allow_dns, Some(true));
        assert!(config.identity_secret.is_none());
    }

    #[test]
    fn policy_command_builder_wires_every_editable_network_permission() {
        let commands = zerotier_policy_commands(&default_zt_config());
        assert_eq!(
            commands,
            vec![
                vec!["set", "8056c2e21c000001", "allowManaged", "true"],
                vec!["set", "8056c2e21c000001", "allowGlobal", "false"],
                vec!["set", "8056c2e21c000001", "allowDefault", "false"],
                vec!["set", "8056c2e21c000001", "allowDNS", "true"],
            ]
        );
    }

    #[test]
    fn daemon_global_identity_is_rejected_by_per_network_profiles() {
        let mut config = default_zt_config();
        config.identity_secret = Some("private-node-identity".to_string());
        let error = validate_zerotier_profile(&config).unwrap_err();
        assert!(error.contains("daemon-global"));
        assert!(!error.contains("private-node-identity"));
    }

    #[test]
    fn inline_auth_token_uses_private_temp_home_without_secret_argv_and_cleans_up() {
        let configured_home =
            std::env::temp_dir().join(format!("sorng-zt-home-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&configured_home).unwrap();
        std::fs::write(configured_home.join("zerotier-one.port"), "43210\n").unwrap();

        let mut config = default_zt_config();
        config.zerotier_home = Some(configured_home.to_string_lossy().to_string());
        config.authtoken_secret = Some("local-service-secret".to_string());
        let context = ZeroTierCliContext::prepare_with_binary(
            &mut config,
            PathBuf::from("zerotier-cli-test"),
        )
        .unwrap();
        let args = context.command_args(&["join".to_string(), config.network_id.clone()]);
        let joined = args.join(" ");
        assert!(joined.contains("-p43210"));
        assert!(!joined.contains("local-service-secret"));
        assert!(!args.iter().any(|arg| arg.starts_with("-T")));

        let auth_file = context._auth_file.as_ref().unwrap();
        let auth_path = auth_file.path.clone();
        let auth_directory = auth_file.directory.clone();
        assert_eq!(
            std::fs::read_to_string(&auth_path).unwrap(),
            "local-service-secret"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&auth_path).unwrap().permissions().mode();
            assert_eq!(mode & 0o077, 0);
        }

        drop(context);
        assert!(!auth_path.exists());
        assert!(!auth_directory.exists());
        std::fs::remove_dir_all(configured_home).unwrap();
    }

    #[test]
    fn network_status_parser_and_readiness_are_truthful() {
        let ready = parse_zerotier_network_info(
            r#"[{"id":"8056c2e21c000001","status":"OK","assignedAddresses":["10.147.0.2/24"]}]"#,
            "8056c2e21c000001",
        )
        .unwrap();
        assert!(matches!(
            classify_zerotier_readiness(ready),
            ZeroTierReadiness::Ready(NetworkInfo { ref assigned_ips, .. })
                if assigned_ips == &["10.147.0.2/24"]
        ));

        let denied = parse_zerotier_network_info(
            r#"[{"nwid":"8056c2e21c000001","status":"ACCESS_DENIED","assignedAddresses":[]}]"#,
            "8056c2e21c000001",
        )
        .unwrap();
        assert!(matches!(
            classify_zerotier_readiness(denied),
            ZeroTierReadiness::Failed(ref error) if error.contains("authorize")
        ));
        assert!(matches!(
            classify_zerotier_readiness(None),
            ZeroTierReadiness::Pending(_)
        ));
    }

    #[test]
    fn zerotier_diagnostics_redact_inline_token_and_are_bounded() {
        let input = format!(
            "request rejected for local-service-secret {}",
            "x".repeat(800)
        );
        let diagnostic = sanitize_zerotier_diagnostic(&input, Some("local-service-secret"));
        assert!(!diagnostic.contains("local-service-secret"));
        assert!(diagnostic.contains("[REDACTED]"));
        assert!(diagnostic.chars().count() <= 600);
    }

    #[tokio::test]
    async fn external_membership_is_reused_by_preflight_but_direct_connect_never_adopts_it() {
        let network_json =
            r#"[{"id":"8056c2e21c000001","status":"OK","assignedAddresses":["10.147.0.2/24"]}]"#;
        let runner = Arc::new(ScriptedZeroTierCommandRunner::new(vec![
            successful_output(network_json),
            successful_output(network_json),
        ]));
        let mut service = service_with_runner(Arc::clone(&runner));
        let id = service
            .create_connection("External".to_string(), default_zt_config())
            .await
            .unwrap();

        // Session lifecycle preflight may reuse a machine-wide membership it
        // did not start. Direct profile connect must not adopt or reconfigure it.
        assert!(service.is_connection_active(&id).await);
        let error = service.connect(&id).await.unwrap_err();
        assert!(error.contains("already joined outside this profile"));
        assert!(service.connections[&id].network_id.is_none());
        assert!(matches!(
            service.connections[&id].status,
            ZeroTierStatus::Error(_)
        ));

        // Clearing the local error state must also leave the external network
        // untouched because this profile never received an ownership token.
        service.disconnect(&id).await.unwrap();
        assert!(matches!(
            service.connections[&id].status,
            ZeroTierStatus::Disconnected
        ));
        let calls = runner.calls();
        assert_eq!(
            calls,
            vec![
                vec!["-j".to_string(), "listnetworks".to_string()],
                vec!["-j".to_string(), "listnetworks".to_string()],
            ]
        );
        assert!(calls
            .iter()
            .flatten()
            .all(|argument| { argument != "join" && argument != "set" && argument != "leave" }));
    }

    #[tokio::test]
    async fn owned_connected_profile_reuses_only_live_ready_membership() {
        let runner = Arc::new(ScriptedZeroTierCommandRunner::new(vec![successful_output(
            r#"[{"id":"8056c2e21c000001","status":"OK","assignedAddresses":["10.147.0.9/24"]}]"#,
        )]));
        let mut service = service_with_runner(Arc::clone(&runner));
        let id = service
            .create_connection("Owned".to_string(), default_zt_config())
            .await
            .unwrap();
        let network_id = service.connections[&id].config.network_id.clone();
        {
            let connection = service.connections.get_mut(&id).unwrap();
            connection.status = ZeroTierStatus::Connected;
            connection.network_id = Some(network_id.clone());
            connection.assigned_ips = vec!["stale-address".to_string()];
        }

        service.connect(&id).await.unwrap();

        assert!(matches!(
            service.connections[&id].status,
            ZeroTierStatus::Connected
        ));
        assert_eq!(
            service.connections[&id].network_id.as_deref(),
            Some(network_id.as_str())
        );
        assert_eq!(service.connections[&id].assigned_ips, vec!["10.147.0.9/24"]);
        assert_eq!(
            runner.calls(),
            vec![vec!["-j".to_string(), "listnetworks".to_string()]]
        );
    }

    #[tokio::test]
    async fn owned_connected_profile_recovers_a_missing_membership() {
        let ready =
            r#"[{"id":"8056c2e21c000001","status":"OK","assignedAddresses":["10.147.0.10/24"]}]"#;
        let runner = Arc::new(ScriptedZeroTierCommandRunner::new(vec![
            successful_output("[]"),
            successful_output(""),
            successful_output(""),
            successful_output(""),
            successful_output(""),
            successful_output(""),
            successful_output(ready),
        ]));
        let mut service = service_with_runner(Arc::clone(&runner));
        let id = service
            .create_connection("Recover".to_string(), default_zt_config())
            .await
            .unwrap();
        let network_id = service.connections[&id].config.network_id.clone();
        {
            let connection = service.connections.get_mut(&id).unwrap();
            connection.status = ZeroTierStatus::Connected;
            connection.network_id = Some(network_id.clone());
            connection.assigned_ips = vec!["stale-address".to_string()];
        }

        service.connect(&id).await.unwrap();

        assert!(matches!(
            service.connections[&id].status,
            ZeroTierStatus::Connected
        ));
        assert_eq!(
            service.connections[&id].assigned_ips,
            vec!["10.147.0.10/24"]
        );
        assert_eq!(
            runner.calls(),
            vec![
                vec!["-j".to_string(), "listnetworks".to_string()],
                vec!["join".to_string(), network_id.clone()],
                vec![
                    "set".to_string(),
                    network_id.clone(),
                    "allowManaged".to_string(),
                    "true".to_string(),
                ],
                vec![
                    "set".to_string(),
                    network_id.clone(),
                    "allowGlobal".to_string(),
                    "false".to_string(),
                ],
                vec![
                    "set".to_string(),
                    network_id.clone(),
                    "allowDefault".to_string(),
                    "false".to_string(),
                ],
                vec![
                    "set".to_string(),
                    network_id,
                    "allowDNS".to_string(),
                    "true".to_string(),
                ],
                vec!["-j".to_string(), "listnetworks".to_string()],
            ]
        );
    }

    #[tokio::test]
    async fn owned_connected_query_failure_preserves_token_and_runs_no_mutation_command() {
        let runner = Arc::new(ScriptedZeroTierCommandRunner::new(vec![Err(
            "query transport failed".to_string(),
        )]));
        let mut service = service_with_runner(Arc::clone(&runner));
        let id = service
            .create_connection("Owned".to_string(), default_zt_config())
            .await
            .unwrap();
        let network_id = service.connections[&id].config.network_id.clone();
        {
            let connection = service.connections.get_mut(&id).unwrap();
            connection.status = ZeroTierStatus::Connected;
            connection.network_id = Some(network_id.clone());
        }

        let error = service.connect(&id).await.unwrap_err();
        assert!(error.contains("query transport failed"));
        assert!(matches!(
            service.connections[&id].status,
            ZeroTierStatus::Error(_)
        ));
        assert_eq!(
            service.connections[&id].network_id.as_deref(),
            Some(network_id.as_str())
        );
        assert_eq!(
            runner.calls(),
            vec![vec!["-j".to_string(), "listnetworks".to_string()]]
        );
    }

    #[tokio::test]
    async fn duplicate_guard_precedes_owned_membership_reuse() {
        let runner = Arc::new(ScriptedZeroTierCommandRunner::new(Vec::new()));
        let mut service = service_with_runner(Arc::clone(&runner));
        let first = service
            .create_connection("Office".to_string(), default_zt_config())
            .await
            .unwrap();
        let mut second_config = default_zt_config();
        second_config.network_id = "aaaaaaaaaaaaaaaa".to_string();
        let second = service
            .create_connection("Legacy duplicate".to_string(), second_config)
            .await
            .unwrap();
        let network_id = service.connections[&first].config.network_id.clone();
        {
            let connection = service.connections.get_mut(&second).unwrap();
            connection.config.network_id = network_id.clone();
            connection.status = ZeroTierStatus::Connected;
            connection.network_id = Some(network_id.clone());
        }

        let error = service.connect(&second).await.unwrap_err();
        assert!(error.contains("Office"));
        assert!(runner.calls().is_empty());
        assert_eq!(
            service.connections[&second].network_id.as_deref(),
            Some(network_id.as_str())
        );
        assert!(matches!(
            service.connections[&second].status,
            ZeroTierStatus::Error(_)
        ));
    }

    #[tokio::test]
    async fn failed_policy_and_cleanup_retain_owner_until_disconnect_retry_succeeds() {
        let runner = Arc::new(ScriptedZeroTierCommandRunner::new(vec![
            successful_output("[]"),
            successful_output(""),
            failed_output("policy denied"),
            failed_output("daemon busy"),
            successful_output(""),
        ]));
        let mut service = service_with_runner(Arc::clone(&runner));
        let id = service
            .create_connection("Owned".to_string(), default_zt_config())
            .await
            .unwrap();
        let network_id = service.connections[&id].config.network_id.clone();

        let error = service.connect(&id).await.unwrap_err();
        assert!(error.contains("policy denied"));
        assert!(error.contains("cleanup leave failed"));
        assert!(error.contains("daemon busy"));
        assert_eq!(
            service.connections[&id].network_id.as_deref(),
            Some(network_id.as_str())
        );
        assert!(matches!(
            service.connections[&id].status,
            ZeroTierStatus::Error(_)
        ));

        let reconnect_error = service.connect(&id).await.unwrap_err();
        assert!(reconnect_error.contains("incomplete cleanup"));
        assert_eq!(runner.calls().len(), 4);

        service.disconnect(&id).await.unwrap();
        assert!(service.connections[&id].network_id.is_none());
        assert!(matches!(
            service.connections[&id].status,
            ZeroTierStatus::Disconnected
        ));

        let calls = runner.calls();
        assert_eq!(calls[0], vec!["-j", "listnetworks"]);
        assert_eq!(calls[1], vec!["join", network_id.as_str()]);
        assert_eq!(calls[2][0], "set");
        assert_eq!(calls[3], vec!["leave", network_id.as_str()]);
        assert_eq!(calls[4], vec!["leave", network_id.as_str()]);
    }

    #[tokio::test]
    async fn active_probe_fails_closed_for_context_and_query_failures() {
        let resolver_failure = Arc::new(ScriptedZeroTierCommandRunner::with_resolve_error(
            "resolver unavailable",
        ));
        let mut service = service_with_runner(Arc::clone(&resolver_failure));
        let id = service
            .create_connection("Resolver failure".to_string(), default_zt_config())
            .await
            .unwrap();
        {
            let connection = service.connections.get_mut(&id).unwrap();
            connection.status = ZeroTierStatus::Connected;
            connection.network_id = Some(connection.config.network_id.clone());
        }
        assert!(!service.is_connection_active(&id).await);
        assert!(resolver_failure.calls().is_empty());

        let query_failure = Arc::new(ScriptedZeroTierCommandRunner::new(vec![Err(
            "query transport failed".to_string(),
        )]));
        let mut service = service_with_runner(Arc::clone(&query_failure));
        let id = service
            .create_connection("Query failure".to_string(), default_zt_config())
            .await
            .unwrap();
        {
            let connection = service.connections.get_mut(&id).unwrap();
            connection.status = ZeroTierStatus::Connected;
            connection.network_id = Some(connection.config.network_id.clone());
        }
        assert!(!service.is_connection_active(&id).await);
        assert_eq!(
            query_failure.calls(),
            vec![vec!["-j".to_string(), "listnetworks".to_string()]]
        );
    }

    #[tokio::test]
    async fn active_config_update_is_atomic_while_name_only_update_remains_allowed() {
        let runner = Arc::new(ScriptedZeroTierCommandRunner::new(Vec::new()));
        let mut service = service_with_runner(runner);
        let id = service
            .create_connection("Original".to_string(), default_zt_config())
            .await
            .unwrap();
        {
            let connection = service.connections.get_mut(&id).unwrap();
            connection.status = ZeroTierStatus::Connected;
            connection.network_id = Some(connection.config.network_id.clone());
        }
        let original_config = service.connections[&id].config.clone();
        let mut changed_config = original_config.clone();
        changed_config.allow_dns = Some(false);

        let error = service
            .update_connection(
                &id,
                Some("Must not partially apply".to_string()),
                Some(changed_config),
            )
            .await
            .unwrap_err();
        assert!(error.contains("before changing its configuration"));
        assert_eq!(service.connections[&id].name, "Original");
        assert_eq!(
            service.connections[&id].config.allow_dns,
            original_config.allow_dns
        );

        service
            .update_connection(&id, Some("Renamed while active".to_string()), None)
            .await
            .unwrap();
        assert_eq!(service.connections[&id].name, "Renamed while active");
        assert_eq!(
            service.connections[&id].config.allow_dns,
            original_config.allow_dns
        );
        assert_eq!(
            service.connections[&id].network_id.as_deref(),
            Some(original_config.network_id.as_str())
        );
    }

    // ── Connection CRUD ─────────────────────────────────────────────────

    #[tokio::test]
    async fn create_connection_returns_uuid() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test ZT".to_string(), default_zt_config())
            .await
            .unwrap();
        assert_eq!(id.len(), 36);
    }

    #[tokio::test]
    async fn create_connection_default_status() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_zt_config())
            .await
            .unwrap();
        let conn = svc.get_connection(&id).await.unwrap();
        assert!(matches!(conn.status, ZeroTierStatus::Disconnected));
        assert!(conn.connected_at.is_none());
    }

    #[tokio::test]
    async fn create_rejects_case_insensitive_duplicate_network_profiles() {
        let state = ZeroTierService::new();
        let mut service = state.lock().await;
        service
            .create_connection("Office".to_string(), default_zt_config())
            .await
            .unwrap();
        let mut duplicate = default_zt_config();
        duplicate.network_id = "8056C2E21C000001".to_string();

        let error = service
            .create_connection("Duplicate".to_string(), duplicate)
            .await
            .unwrap_err();
        assert!(error.contains("Office"));
        assert!(error.contains("machine-wide"));
        assert_eq!(service.connections.len(), 1);
    }

    #[tokio::test]
    async fn create_and_update_validate_zerotier_config_before_mutation() {
        let state = ZeroTierService::new();
        let mut service = state.lock().await;
        let mut invalid = default_zt_config();
        invalid.identity_secret = Some("daemon-secret".to_string());
        let error = service
            .create_connection("Invalid".to_string(), invalid.clone())
            .await
            .unwrap_err();
        assert!(error.contains("daemon-global"));
        assert!(!error.contains("daemon-secret"));
        assert!(service.connections.is_empty());

        let id = service
            .create_connection("Office".to_string(), default_zt_config())
            .await
            .unwrap();
        assert!(service
            .update_connection(&id, None, Some(invalid))
            .await
            .is_err());
        assert!(service.connections[&id].config.identity_secret.is_none());
    }

    #[tokio::test]
    async fn list_connections_empty() {
        let state = ZeroTierService::new();
        let svc = state.lock().await;
        assert!(svc.list_connections().await.is_empty());
    }

    #[tokio::test]
    async fn list_connections_after_create() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        svc.create_connection("ZT1".to_string(), default_zt_config())
            .await
            .unwrap();
        let mut second = default_zt_config();
        second.network_id = "aaaaaaaaaaaaaaaa".to_string();
        svc.create_connection("ZT2".to_string(), second)
            .await
            .unwrap();
        assert_eq!(svc.list_connections().await.len(), 2);
    }

    #[tokio::test]
    async fn get_connection_not_found() {
        let state = ZeroTierService::new();
        let svc = state.lock().await;
        assert!(svc.get_connection("nonexistent").await.is_err());
    }

    #[tokio::test]
    async fn delete_connection_removes_it() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_zt_config())
            .await
            .unwrap();
        svc.delete_connection(&id).await.unwrap();
        assert!(svc.get_connection(&id).await.is_err());
    }

    // ── update_connection ──────────────────────────────────────────────

    #[tokio::test]
    async fn update_connection_name() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Original".to_string(), default_zt_config())
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
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_zt_config())
            .await
            .unwrap();

        let mut new_config = default_zt_config();
        new_config.network_id = "aaaaaaaaaaaaaaaa".to_string();
        new_config.allow_global = Some(true);

        svc.update_connection(&id, None, Some(new_config))
            .await
            .unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.config.network_id, "aaaaaaaaaaaaaaaa");
        assert_eq!(conn.config.allow_global, Some(true));
    }

    #[tokio::test]
    async fn update_rejects_a_network_id_owned_by_another_profile() {
        let state = ZeroTierService::new();
        let mut service = state.lock().await;
        let first = service
            .create_connection("Office".to_string(), default_zt_config())
            .await
            .unwrap();
        let mut lab_config = default_zt_config();
        lab_config.network_id = "aaaaaaaaaaaaaaaa".to_string();
        let lab = service
            .create_connection("Lab".to_string(), lab_config.clone())
            .await
            .unwrap();
        lab_config.network_id = service.connections[&first].config.network_id.clone();

        let error = service
            .update_connection(&lab, None, Some(lab_config))
            .await
            .unwrap_err();
        assert!(error.contains("Office"));
        assert_eq!(
            service.connections[&lab].config.network_id,
            "aaaaaaaaaaaaaaaa"
        );
    }

    #[tokio::test]
    async fn update_connection_both() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_zt_config())
            .await
            .unwrap();

        let mut new_config = default_zt_config();
        new_config.allow_default = Some(true);

        svc.update_connection(&id, Some("Renamed".to_string()), Some(new_config))
            .await
            .unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Renamed");
        assert_eq!(conn.config.allow_default, Some(true));
    }

    #[tokio::test]
    async fn update_connection_not_found() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let result = svc
            .update_connection("nonexistent", Some("Name".to_string()), None)
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn update_connection_no_changes() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_zt_config())
            .await
            .unwrap();

        svc.update_connection(&id, None, None).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Test");
    }

    // ── is_connection_active ───────────────────────────────────────────

    #[tokio::test]
    async fn is_connection_active_disconnected() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_zt_config())
            .await
            .unwrap();
        assert!(!svc.is_connection_active(&id).await);
    }

    #[tokio::test]
    async fn is_connection_active_nonexistent() {
        let state = ZeroTierService::new();
        let svc = state.lock().await;
        assert!(!svc.is_connection_active("nonexistent").await);
    }

    #[tokio::test]
    async fn legacy_duplicate_profiles_reach_connect_and_fail_closed() {
        let state = ZeroTierService::new();
        let mut service = state.lock().await;
        let first = service
            .create_connection("Office".to_string(), default_zt_config())
            .await
            .unwrap();
        let mut lab_config = default_zt_config();
        lab_config.network_id = "aaaaaaaaaaaaaaaa".to_string();
        let second = service
            .create_connection("Legacy duplicate".to_string(), lab_config)
            .await
            .unwrap();
        let network_id = service.connections[&first].config.network_id.clone();
        service
            .connections
            .get_mut(&second)
            .unwrap()
            .config
            .network_id = network_id;

        // The duplicate must not be mistaken for an external active
        // membership by lifecycle preflight.
        assert!(!service.is_connection_active(&second).await);
        let error = service.connect(&second).await.unwrap_err();
        assert!(error.contains("Office"));
        assert!(error.contains(&first));
        assert!(matches!(
            service.connections[&second].status,
            ZeroTierStatus::Error(_)
        ));
        assert!(service.connections[&second].network_id.is_none());
    }

    #[tokio::test]
    async fn disconnect_never_leaves_membership_owned_by_another_profile() {
        let state = ZeroTierService::new();
        let mut service = state.lock().await;
        let first = service
            .create_connection("Office".to_string(), default_zt_config())
            .await
            .unwrap();
        let mut lab_config = default_zt_config();
        lab_config.network_id = "aaaaaaaaaaaaaaaa".to_string();
        let second = service
            .create_connection("Legacy duplicate".to_string(), lab_config)
            .await
            .unwrap();
        let network_id = service.connections[&first].config.network_id.clone();
        service
            .connections
            .get_mut(&second)
            .unwrap()
            .config
            .network_id = network_id.clone();
        for id in [&first, &second] {
            let connection = service.connections.get_mut(id).unwrap();
            connection.status = ZeroTierStatus::Connected;
            connection.network_id = Some(network_id.clone());
        }

        // No ZeroTier CLI is installed in this test environment. Success here
        // proves the non-owner path retained the global membership without
        // attempting `zerotier-cli leave`.
        service.disconnect(&first).await.unwrap();
        assert!(matches!(
            service.connections[&first].status,
            ZeroTierStatus::Disconnected
        ));
        assert!(service.connections[&first].network_id.is_none());
        assert!(matches!(
            service.connections[&second].status,
            ZeroTierStatus::Connected
        ));
        assert_eq!(
            service.connections[&second].network_id.as_deref(),
            Some(network_id.as_str())
        );
    }

    #[tokio::test]
    async fn concurrent_legacy_duplicate_connects_cannot_create_independent_owners() {
        let state = ZeroTierService::new();
        let (first, second) = {
            let mut service = state.lock().await;
            let first = service
                .create_connection("Office".to_string(), default_zt_config())
                .await
                .unwrap();
            let mut lab_config = default_zt_config();
            lab_config.network_id = "aaaaaaaaaaaaaaaa".to_string();
            let second = service
                .create_connection("Legacy duplicate".to_string(), lab_config)
                .await
                .unwrap();
            let network_id = service.connections[&first].config.network_id.clone();
            service
                .connections
                .get_mut(&second)
                .unwrap()
                .config
                .network_id = network_id;
            (first, second)
        };

        let first_state = Arc::clone(&state);
        let first_id = first.clone();
        let second_state = Arc::clone(&state);
        let second_id = second.clone();
        let (first_result, second_result) = tokio::join!(
            async move { first_state.lock().await.connect(&first_id).await },
            async move { second_state.lock().await.connect(&second_id).await }
        );
        assert!(first_result.unwrap_err().contains("Legacy duplicate"));
        assert!(second_result.unwrap_err().contains("Office"));

        let service = state.lock().await;
        assert!(service.connections.values().all(|connection| {
            connection.network_id.is_none()
                && !matches!(connection.status, ZeroTierStatus::Connected)
        }));
    }

    #[tokio::test]
    async fn disconnected_single_profile_never_leaves_external_membership() {
        let state = ZeroTierService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("External".to_string(), default_zt_config())
            .await
            .unwrap();
        service.disconnect(&id).await.unwrap();
        assert!(matches!(
            service.connections[&id].status,
            ZeroTierStatus::Disconnected
        ));
    }

    #[tokio::test]
    async fn persisted_uppercase_network_id_is_canonicalized_and_lowercase_status_matches() {
        let source = ZeroTierService::new();
        let mut source = source.lock().await;
        let id = source
            .create_connection("Legacy uppercase".to_string(), default_zt_config())
            .await
            .unwrap();
        source.connections.get_mut(&id).unwrap().config.network_id = "8056C2E21C000001".to_string();
        let encoded = source.serialize_definitions().unwrap();
        drop(source);

        let runner = Arc::new(ScriptedZeroTierCommandRunner::new(vec![successful_output(
            r#"[{"id":"8056c2e21c000001","status":"OK","assignedAddresses":["10.147.0.11/24"]}]"#,
        )]));
        let mut restored = service_with_runner(Arc::clone(&runner));
        restored.deserialize_definitions(&encoded).unwrap();
        assert_eq!(
            restored.connections[&id].config.network_id,
            "8056c2e21c000001"
        );
        assert!(restored.is_connection_active(&id).await);
        assert_eq!(
            runner.calls(),
            vec![vec!["-j".to_string(), "listnetworks".to_string()]]
        );

        let mut duplicate = default_zt_config();
        duplicate.network_id = "8056C2E21C000001".to_string();
        let error = restored
            .create_connection("Duplicate".to_string(), duplicate)
            .await
            .unwrap_err();
        assert!(error.contains("Legacy uppercase"));

        let connection = restored.connections.get_mut(&id).unwrap();
        connection.status = ZeroTierStatus::Connected;
        connection.network_id = Some("8056C2E21C000001".to_string());
        assert!(zerotier_profile_may_own_membership(
            connection,
            "8056c2e21c000001"
        ));
        assert!(parse_zerotier_network_info(
            r#"[{"id":"8056c2e21c000001","status":"OK"}]"#,
            "8056C2E21C000001"
        )
        .unwrap()
        .is_some());
    }

    #[tokio::test]
    async fn invalid_legacy_network_id_remains_visible_but_fail_closed_after_restore() {
        let source = ZeroTierService::new();
        let mut source = source.lock().await;
        let id = source
            .create_connection("Legacy invalid".to_string(), default_zt_config())
            .await
            .unwrap();
        source.connections.get_mut(&id).unwrap().config.network_id = "invalid-id".to_string();
        let encoded = source.serialize_definitions().unwrap();
        drop(source);

        let runner = Arc::new(ScriptedZeroTierCommandRunner::new(Vec::new()));
        let mut restored = service_with_runner(Arc::clone(&runner));
        restored.deserialize_definitions(&encoded).unwrap();
        assert_eq!(restored.connections[&id].config.network_id, "invalid-id");
        assert!(!restored.is_connection_active(&id).await);
        let error = restored.connect(&id).await.unwrap_err();
        assert!(error.contains("exactly 16 hexadecimal"));
        assert!(runner.calls().is_empty());
    }

    #[tokio::test]
    async fn persisted_profile_keeps_id_and_resets_runtime_state() {
        let state = ZeroTierService::new();
        let mut service = state.lock().await;
        let mut config = default_zt_config();
        config.authtoken_secret = Some("zt-secret".to_string());
        let id = service
            .create_connection("Office".to_string(), config)
            .await
            .unwrap();
        let connection = service.connections.get_mut(&id).unwrap();
        connection.status = ZeroTierStatus::Connected;
        connection.network_id = Some("aaaaaaaaaaaaaaaa".to_string());
        connection.assigned_ips = vec!["10.147.0.2".to_string()];
        let encoded = service.serialize_definitions().unwrap();
        drop(service);

        let restored_state = ZeroTierService::new();
        let mut restored = restored_state.lock().await;
        restored.deserialize_definitions(&encoded).unwrap();
        let connection = restored.get_connection(&id).await.unwrap();
        assert_eq!(connection.id, id);
        assert_eq!(
            connection.config.authtoken_secret.as_deref(),
            Some("zt-secret")
        );
        assert!(matches!(connection.status, ZeroTierStatus::Disconnected));
        assert!(connection.network_id.is_none());
        assert!(connection.assigned_ips.is_empty());
    }

    #[tokio::test]
    async fn persisted_legacy_duplicates_restore_for_cleanup_but_cannot_connect() {
        let source = ZeroTierService::new();
        let mut service = source.lock().await;
        let first = service
            .create_connection("Office".to_string(), default_zt_config())
            .await
            .unwrap();
        let mut lab_config = default_zt_config();
        lab_config.network_id = "aaaaaaaaaaaaaaaa".to_string();
        let second = service
            .create_connection("Legacy duplicate".to_string(), lab_config)
            .await
            .unwrap();
        let network_id = service.connections[&first].config.network_id.clone();
        service
            .connections
            .get_mut(&second)
            .unwrap()
            .config
            .network_id = network_id;
        let encoded = service.serialize_definitions().unwrap();
        drop(service);

        let restored = ZeroTierService::new();
        let mut service = restored.lock().await;
        service.deserialize_definitions(&encoded).unwrap();
        assert_eq!(service.connections.len(), 2);
        let error = service.connect(&first).await.unwrap_err();
        assert!(error.contains("Legacy duplicate"));
        // Profiles remain visible so the user can delete the duplicate.
        assert!(service.connections.contains_key(&first));
        assert!(service.connections.contains_key(&second));
    }

    #[tokio::test]
    async fn corrupt_profile_data_does_not_replace_live_definitions() {
        let state = ZeroTierService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_zt_config())
            .await
            .unwrap();
        assert!(service.deserialize_definitions("not-json").is_err());
        assert!(service.connections.contains_key(&id));
    }

    #[tokio::test]
    async fn profile_survives_storage_restart_with_the_same_id() {
        let root = std::env::temp_dir().join(format!("sorng-vpn-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("storage.json");
        let storage =
            sorng_storage::storage::SecureStorage::new(path.to_string_lossy().to_string());
        let first = persistent_test_state(storage.clone());
        let id = first
            .lock()
            .await
            .create_connection("Office".to_string(), default_zt_config())
            .await
            .unwrap();

        let restarted = persistent_test_state(storage);
        let mut service = restarted.lock().await;
        assert_eq!(
            service.restore_persisted().await.unwrap(),
            RestoreOutcome::Loaded
        );
        assert_eq!(service.get_connection(&id).await.unwrap().id, id);
        drop(service);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn failed_atomic_save_rolls_back_in_memory_change() {
        let blocker = std::env::temp_dir().join(format!("sorng-vpn-blocker-{}", Uuid::new_v4()));
        std::fs::write(&blocker, b"not a directory").unwrap();
        let impossible_path = blocker.join("storage.json");
        let storage = sorng_storage::storage::SecureStorage::new(
            impossible_path.to_string_lossy().to_string(),
        );
        let state = persistent_test_state(storage);
        let mut service = state.lock().await;
        let result = service
            .create_connection("Office".to_string(), default_zt_config())
            .await;
        assert!(result.is_err());
        assert!(service.connections.is_empty());
        drop(service);
        std::fs::remove_file(blocker).unwrap();
    }
}
