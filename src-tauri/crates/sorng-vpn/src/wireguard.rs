use crate::persistence::{
    deserialize_profile_definitions, load_service_data, save_service_data,
    serialize_profile_definitions, Persistable, RestoreOutcome,
};
use chrono::{DateTime, Utc};
use defguard_wireguard_rs::{
    host::Peer, key::Key, net::IpAddrMask, InterfaceConfiguration, WGApi, WireguardInterfaceApi,
};
use sorng_core::events::DynEventEmitter;
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// Platform-specific WGApi type alias.
///
/// On Windows the kernel implementation (`wireguard-nt`) is available;
/// on Unix we use the userspace implementation backed by BoringTun.
#[cfg(target_family = "windows")]
type WgHandle = WGApi<defguard_wireguard_rs::Kernel>;
#[cfg(unix)]
type WgHandle = WGApi<defguard_wireguard_rs::Userspace>;

/// Narrow runtime surface used by setup so post-create failures can be tested
/// without creating a real operating-system interface.
trait WireGuardRuntime {
    fn create_interface(&mut self) -> Result<(), String>;
    fn configure_interface(&self, config: &InterfaceConfiguration) -> Result<(), String>;
    fn assign_address(&self, address: &IpAddrMask) -> Result<(), String>;
    fn configure_dns(&self, dns: &[IpAddr], search_domains: &[&str]) -> Result<(), String>;
    fn configure_peer_routing(&self, peers: &[Peer]) -> Result<(), String>;
    fn remove_interface(&mut self) -> Result<(), String>;
}

impl WireGuardRuntime for WgHandle {
    fn create_interface(&mut self) -> Result<(), String> {
        WireguardInterfaceApi::create_interface(self).map_err(|error| error.to_string())
    }

    fn configure_interface(&self, config: &InterfaceConfiguration) -> Result<(), String> {
        WireguardInterfaceApi::configure_interface(self, config).map_err(|error| error.to_string())
    }

    fn assign_address(&self, address: &IpAddrMask) -> Result<(), String> {
        WireguardInterfaceApi::assign_address(self, address).map_err(|error| error.to_string())
    }

    fn configure_dns(&self, dns: &[IpAddr], search_domains: &[&str]) -> Result<(), String> {
        WireguardInterfaceApi::configure_dns(self, dns, search_domains)
            .map_err(|error| error.to_string())
    }

    fn configure_peer_routing(&self, peers: &[Peer]) -> Result<(), String> {
        WireguardInterfaceApi::configure_peer_routing(self, peers)
            .map_err(|error| error.to_string())
    }

    fn remove_interface(&mut self) -> Result<(), String> {
        WireguardInterfaceApi::remove_interface(self).map_err(|error| error.to_string())
    }
}

/// Read-only operating-system observation used only for profiles restored
/// after a process restart. The selected name is deterministic and app-owned;
/// custom interface names are deliberately never passed to this probe.
#[async_trait::async_trait]
trait WireGuardInterfaceActivityProbe: Send + Sync {
    async fn probe_exact_interface(&self, interface_name: &str) -> Result<bool, String>;
}

struct SystemWireGuardInterfaceActivityProbe;

#[async_trait::async_trait]
impl WireGuardInterfaceActivityProbe for SystemWireGuardInterfaceActivityProbe {
    async fn probe_exact_interface(&self, interface_name: &str) -> Result<bool, String> {
        #[cfg(unix)]
        {
            let socket_path = format!("/var/run/wireguard/{interface_name}.sock");
            let socket_exists = Path::new(&socket_path).try_exists().map_err(|error| {
                format!("Failed to inspect the WireGuard control socket: {error}")
            })?;
            if !socket_exists {
                return Ok(false);
            }

            let handle = WgHandle::new(interface_name.to_string()).map_err(|error| {
                format!("Failed to inspect the restored WireGuard interface: {error}")
            })?;
            handle.read_interface_data().map_err(|error| {
                format!("Failed to inspect the restored WireGuard interface: {error}")
            })?;
            return Ok(true);
        }

        #[cfg(windows)]
        {
            // Enumerating adapters is read-only and lets a successful query
            // prove absence without using wireguard-nt's open-or-create path.
            // The interface name is passed through the environment rather
            // than interpolated into PowerShell source.
            let powershell = crate::platform::resolve_binary("powershell")?;
            let output = tokio::process::Command::new(powershell)
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "$ErrorActionPreference='Stop'; try { $names = @(Get-NetAdapter -ErrorAction Stop | Select-Object -ExpandProperty Name); if ($names -contains $env:SORNG_WG_INTERFACE) { exit 0 } else { exit 3 } } catch { exit 4 }",
                ])
                .env("SORNG_WG_INTERFACE", interface_name)
                .output()
                .await
                .map_err(|error| {
                    format!("Failed to query Windows network adapters: {error}")
                })?;

            return match output.status.code() {
                Some(0) => Ok(true),
                Some(3) => Ok(false),
                _ => Err(
                    "Windows network-adapter query failed; WireGuard activity is uncertain"
                        .to_string(),
                ),
            };
        }

        #[cfg(not(any(unix, windows)))]
        {
            let _ = interface_name;
            Err("WireGuard interface activity probing is unsupported on this platform".to_string())
        }
    }
}

struct WireGuardSetupPlan {
    interface: InterfaceConfiguration,
    dns: Vec<IpAddr>,
    local_ip: Option<String>,
}

#[derive(Debug)]
struct WireGuardSetupFailure<R> {
    error: String,
    retained_runtime: Option<R>,
}

const INCOMPLETE_TEARDOWN_ERROR: &str =
    "A previous WireGuard interface teardown is incomplete; retry disconnect before reconnecting";
// Used only to validate every non-secret field when an IPC caller explicitly
// clears the required inline private key. The placeholder is never persisted
// or used to configure an interface.
const PRIVATE_KEY_CLEAR_VALIDATION_PLACEHOLDER: &str =
    "AAECAwQFBgcICQoLDA0OD/Dh0sO0pZaHeGlaSzwtHg8=";

/// Owns a newly-created interface until all setup stages have succeeded.  The
/// explicit rollback path reports teardown failures; `Drop` is a final safety
/// net for unwinding or a future early return.
struct CreatedWireGuardInterface<R: WireGuardRuntime> {
    runtime: Option<R>,
}

impl<R: WireGuardRuntime> CreatedWireGuardInterface<R> {
    fn create(mut runtime: R) -> Result<Self, String> {
        runtime
            .create_interface()
            .map_err(|error| format!("Failed to create WireGuard interface: {error}"))?;
        Ok(Self {
            runtime: Some(runtime),
        })
    }

    fn runtime(&self) -> &R {
        self.runtime
            .as_ref()
            .expect("created WireGuard runtime is present while armed")
    }

    fn finish(mut self) -> R {
        self.runtime
            .take()
            .expect("created WireGuard runtime is present on success")
    }

    fn rollback(mut self, cause: String) -> WireGuardSetupFailure<R> {
        let Some(mut runtime) = self.runtime.take() else {
            return WireGuardSetupFailure {
                error: cause,
                retained_runtime: None,
            };
        };
        match runtime.remove_interface() {
            Ok(()) => WireGuardSetupFailure {
                error: cause,
                retained_runtime: None,
            },
            Err(cleanup_error) => WireGuardSetupFailure {
                error: format!(
                    "{cause}; rollback also failed to remove the newly created WireGuard interface: {cleanup_error}"
                ),
                retained_runtime: Some(runtime),
            },
        }
    }
}

impl<R: WireGuardRuntime> Drop for CreatedWireGuardInterface<R> {
    fn drop(&mut self) {
        if let Some(runtime) = self.runtime.as_mut() {
            if let Err(error) = runtime.remove_interface() {
                log::error!(
                    "Failed to remove a newly created WireGuard interface while unwinding setup: {error}"
                );
            }
        }
    }
}

pub type WireGuardServiceState = Arc<Mutex<WireGuardService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WireGuardConnection {
    pub id: String,
    pub name: String,
    pub config: WireGuardConfig,
    pub status: WireGuardStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub interface_name: Option<String>,
    pub local_ip: Option<String>,
    pub peer_ip: Option<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct WireGuardSecretPresence {
    pub private_key: bool,
    pub preshared_key: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WireGuardConnectionView {
    #[serde(flatten)]
    pub connection: WireGuardConnection,
    pub secret_presence: WireGuardSecretPresence,
}

impl WireGuardConnection {
    pub fn into_redacted_view(mut self) -> WireGuardConnectionView {
        let secret_presence = WireGuardSecretPresence {
            private_key: self.config.private_key.is_some(),
            preshared_key: self.config.preshared_key.is_some(),
        };
        self.config.private_key = None;
        self.config.preshared_key = None;
        WireGuardConnectionView {
            connection: self,
            secret_presence,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct WireGuardSecretMutation {
    pub clear_private_key: bool,
    pub clear_preshared_key: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum WireGuardStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WireGuardConfig {
    pub private_key: Option<String>,
    pub public_key: Option<String>,
    pub preshared_key: Option<String>,
    pub endpoint: Option<String>,
    /// Addresses assigned to the local WireGuard interface. Older persisted
    /// profiles predate this field and therefore migrate to an empty list.
    #[serde(default)]
    pub addresses: Vec<String>,
    pub allowed_ips: Vec<String>,
    pub persistent_keepalive: Option<u16>,
    pub listen_port: Option<u16>,
    pub dns_servers: Vec<String>,
    pub mtu: Option<u16>,
    pub table: Option<String>,
    pub fwmark: Option<u32>,
    pub config_file: Option<String>,
    pub interface_name: Option<String>,
}

fn empty_wireguard_config() -> WireGuardConfig {
    WireGuardConfig {
        private_key: None,
        public_key: None,
        preshared_key: None,
        endpoint: None,
        addresses: Vec::new(),
        allowed_ips: Vec::new(),
        persistent_keepalive: None,
        listen_port: None,
        dns_servers: Vec::new(),
        mtu: None,
        table: None,
        fwmark: None,
        config_file: None,
        interface_name: None,
    }
}

fn validate_wireguard_supported_options(config: &WireGuardConfig) -> Result<(), String> {
    if let Some(table) = config.table.as_deref() {
        if !table.trim().eq_ignore_ascii_case("auto") {
            return Err(
                "WireGuard Table must be 'auto'; custom routing tables are not supported by the native runtime"
                    .to_string(),
            );
        }
    }
    if config.fwmark.is_some() {
        return Err(
            "WireGuard FwMark is not supported by the native runtime; remove it from the profile"
                .to_string(),
        );
    }
    Ok(())
}

fn require_wireguard_allowed_ips(config: &WireGuardConfig) -> Result<(), String> {
    if config.allowed_ips.is_empty() {
        return Err(
            "WireGuard AllowedIPs is required; specify at least one peer route explicitly"
                .to_string(),
        );
    }
    Ok(())
}

fn parse_wireguard_interface_addresses(
    config: &WireGuardConfig,
) -> Result<Vec<IpAddrMask>, String> {
    config
        .addresses
        .iter()
        .map(|address| {
            address
                .parse::<IpAddrMask>()
                .map_err(|error| format!("Invalid local interface address '{address}': {error}"))
        })
        .collect()
}

fn parse_wireguard_dns_servers(config: &WireGuardConfig) -> Result<Vec<IpAddr>, String> {
    config
        .dns_servers
        .iter()
        .map(|server| {
            server.parse::<IpAddr>().map_err(|error| {
                format!(
                    "WireGuard DNS entry '{server}' is not an IP address and cannot be applied by the native runtime: {error}"
                )
            })
        })
        .collect()
}

fn validate_wireguard_endpoint(endpoint: &str) -> Result<(), String> {
    let (host, port) = endpoint.rsplit_once(':').ok_or_else(|| {
        "WireGuard endpoint must include a host and port (for example vpn.example.com:51820)"
            .to_string()
    })?;
    if host.trim().is_empty() {
        return Err("WireGuard endpoint host cannot be empty".to_string());
    }
    if host.contains(':') && !(host.starts_with('[') && host.ends_with(']')) {
        return Err(
            "WireGuard IPv6 endpoints must use bracket notation, such as [::1]:51820".to_string(),
        );
    }
    let port = port
        .parse::<u16>()
        .map_err(|_| "WireGuard endpoint port must be a number from 1 to 65535".to_string())?;
    if port == 0 {
        return Err("WireGuard endpoint port must be a number from 1 to 65535".to_string());
    }
    Ok(())
}

fn validate_wireguard_config(config: &WireGuardConfig) -> Result<(), String> {
    validate_wireguard_supported_options(config)?;
    require_wireguard_allowed_ips(config)?;

    if let Some(interface_name) = config.interface_name.as_deref() {
        if interface_name.trim().is_empty() {
            return Err("WireGuard interface name cannot be empty".to_string());
        }
        #[cfg(target_os = "windows")]
        return Err(
            "Custom WireGuard interface names are not supported on Windows because an existing adapter cannot be safely distinguished from an app-owned interface; leave the interface name empty to use the isolated generated name"
                .to_string(),
        );
    }

    let private_key = config
        .private_key
        .as_deref()
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| "WireGuard private key is required".to_string())?;
    private_key.parse::<Key>().map_err(|_| {
        "WireGuard private key must be a valid 32-byte base64 or hexadecimal key".to_string()
    })?;

    let public_key = config
        .public_key
        .as_deref()
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| "WireGuard peer public key is required".to_string())?;
    public_key.parse::<Key>().map_err(|_| {
        "WireGuard peer public key must be a valid 32-byte base64 or hexadecimal key".to_string()
    })?;

    if let Some(preshared_key) = config.preshared_key.as_deref() {
        preshared_key.parse::<Key>().map_err(|_| {
            "WireGuard preshared key must be a valid 32-byte base64 or hexadecimal key".to_string()
        })?;
    }
    if let Some(endpoint) = config.endpoint.as_deref() {
        validate_wireguard_endpoint(endpoint)?;
    }

    parse_wireguard_interface_addresses(config)?;
    parse_wireguard_dns_servers(config)?;
    for allowed_ip in &config.allowed_ips {
        allowed_ip.parse::<IpAddrMask>().map_err(|error| {
            format!("Invalid WireGuard AllowedIPs entry '{allowed_ip}': {error}")
        })?;
    }
    Ok(())
}

fn deterministic_wireguard_interface_name(connection_id: &str) -> Option<String> {
    let id = Uuid::parse_str(connection_id).ok()?;
    Some(format!("sorng_{}", &id.simple().to_string()[..8]))
}

fn select_wireguard_interface_name(
    connection_id: &str,
    config: &WireGuardConfig,
) -> Result<(String, bool), String> {
    if let Some(interface_name) = config.interface_name.as_deref() {
        let interface_name = interface_name.trim();
        if interface_name.is_empty() {
            return Err("WireGuard interface name cannot be empty".to_string());
        }
        // User-selected names are never presumed to be owned by this app.
        return Ok((interface_name.to_string(), false));
    }
    deterministic_wireguard_interface_name(connection_id)
        .map(|name| (name, true))
        .ok_or_else(|| {
            "WireGuard profile id is invalid; save the profile again before connecting".to_string()
        })
}

fn reconcile_app_owned_runtime<R: WireGuardRuntime>(
    runtime: &mut R,
    open_before_remove: bool,
) -> Result<(), String> {
    // wireguard-nt must open an existing adapter before dropping it. Unix
    // runtimes can remove the exact named socket/interface directly.
    if open_before_remove {
        runtime
            .create_interface()
            .map_err(|error| format!("Failed to open stale WireGuard interface: {error}"))?;
    }
    runtime
        .remove_interface()
        .map_err(|error| format!("Failed to remove stale WireGuard interface: {error}"))
}

/// Remove a live runtime without losing the only ownership handle when the
/// operating-system teardown fails. Keeping the handle in the map makes a
/// later disconnect retry authoritative instead of falling back to speculative
/// interface discovery.
fn remove_runtime_handle<R: WireGuardRuntime>(
    handles: &mut HashMap<String, R>,
    connection_id: &str,
) -> Result<bool, String> {
    let Some(mut runtime) = handles.remove(connection_id) else {
        return Ok(false);
    };

    if let Err(error) = runtime.remove_interface() {
        handles.insert(connection_id.to_string(), runtime);
        return Err(format!("Failed to remove WireGuard interface: {error}"));
    }

    Ok(true)
}

fn parse_wireguard_number<T>(field: &str, value: &str) -> Result<T, String>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    value
        .parse::<T>()
        .map_err(|e| format!("Invalid WireGuard {field} value '{value}': {e}"))
}

fn parse_wireguard_fwmark(value: &str) -> Result<u32, String> {
    if let Some(hex) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        u32::from_str_radix(hex, 16)
            .map_err(|e| format!("Invalid WireGuard FwMark value '{value}': {e}"))
    } else {
        parse_wireguard_number("FwMark", value)
    }
}

fn comma_separated_wireguard_values(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn parse_wireguard_config_file(content: &str) -> Result<WireGuardConfig, String> {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Section {
        Interface,
        Peer,
    }

    let mut config = empty_wireguard_config();
    let mut section = None;
    let mut interface_sections = 0usize;
    let mut peer_sections = 0usize;

    for (index, raw_line) in content.lines().enumerate() {
        let line_number = index + 1;
        let line = raw_line
            .split_once('#')
            .map(|(value, _)| value)
            .unwrap_or(raw_line)
            .trim();
        if line.is_empty() || line.starts_with(';') {
            continue;
        }
        if line.eq_ignore_ascii_case("[Interface]") {
            interface_sections += 1;
            if interface_sections > 1 {
                return Err("WireGuard config contains more than one [Interface] section".into());
            }
            section = Some(Section::Interface);
            continue;
        }
        if line.eq_ignore_ascii_case("[Peer]") {
            peer_sections += 1;
            if peer_sections > 1 {
                return Err(
                    "WireGuard profiles currently support one peer; split a multi-peer config into separate profiles"
                        .into(),
                );
            }
            section = Some(Section::Peer);
            continue;
        }

        let (key, value) = line.split_once('=').ok_or_else(|| {
            format!("Invalid WireGuard config line {line_number}: expected key = value")
        })?;
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();
        let current = section.ok_or_else(|| {
            format!("WireGuard config line {line_number} appears before a section header")
        })?;

        match (current, key.as_str()) {
            (Section::Interface, "privatekey") => config.private_key = Some(value.to_string()),
            (Section::Interface, "address") => config
                .addresses
                .extend(comma_separated_wireguard_values(value)),
            (Section::Interface, "dns") => config
                .dns_servers
                .extend(comma_separated_wireguard_values(value)),
            (Section::Interface, "listenport") => {
                config.listen_port = Some(parse_wireguard_number("ListenPort", value)?)
            }
            (Section::Interface, "mtu") => config.mtu = Some(parse_wireguard_number("MTU", value)?),
            (Section::Interface, "table") => config.table = Some(value.to_string()),
            (Section::Interface, "fwmark") => config.fwmark = Some(parse_wireguard_fwmark(value)?),
            (Section::Interface, "saveconfig") if value.eq_ignore_ascii_case("false") => {}
            (Section::Interface, "saveconfig") => {
                return Err(
                    "WireGuard SaveConfig=true is not supported by the native runtime".to_string(),
                );
            }
            (Section::Interface, "preup" | "postup" | "predown" | "postdown") => {
                return Err(format!(
                    "WireGuard {key} hooks are not executed by the native runtime; remove the hook or configure it outside sortOfRemoteNG"
                ));
            }
            (Section::Peer, "publickey") => config.public_key = Some(value.to_string()),
            (Section::Peer, "presharedkey") => config.preshared_key = Some(value.to_string()),
            (Section::Peer, "endpoint") => config.endpoint = Some(value.to_string()),
            (Section::Peer, "allowedips") => config
                .allowed_ips
                .extend(comma_separated_wireguard_values(value)),
            (Section::Peer, "persistentkeepalive") => {
                config.persistent_keepalive =
                    Some(parse_wireguard_number("PersistentKeepalive", value)?)
            }
            _ => {
                return Err(format!(
                    "Unsupported WireGuard option '{}' on line {line_number}",
                    key
                ));
            }
        }
    }

    if interface_sections == 0 {
        return Err("WireGuard config is missing an [Interface] section".to_string());
    }
    if peer_sections == 0 {
        return Err("WireGuard config is missing a [Peer] section".to_string());
    }
    validate_wireguard_supported_options(&config)?;
    require_wireguard_allowed_ips(&config)?;
    Ok(config)
}

fn overlay_wireguard_config(
    mut from_file: WireGuardConfig,
    explicit: &WireGuardConfig,
) -> WireGuardConfig {
    macro_rules! overlay_option {
        ($field:ident) => {
            if explicit.$field.is_some() {
                from_file.$field = explicit.$field.clone();
            }
        };
    }
    overlay_option!(private_key);
    overlay_option!(public_key);
    overlay_option!(preshared_key);
    overlay_option!(endpoint);
    overlay_option!(persistent_keepalive);
    overlay_option!(listen_port);
    overlay_option!(mtu);
    overlay_option!(table);
    overlay_option!(fwmark);
    overlay_option!(interface_name);
    if !explicit.addresses.is_empty() {
        from_file.addresses = explicit.addresses.clone();
    }
    if !explicit.allowed_ips.is_empty() {
        from_file.allowed_ips = explicit.allowed_ips.clone();
    }
    if !explicit.dns_servers.is_empty() {
        from_file.dns_servers = explicit.dns_servers.clone();
    }
    from_file.config_file = explicit.config_file.clone();
    from_file
}

async fn resolve_wireguard_config(config: &WireGuardConfig) -> Result<WireGuardConfig, String> {
    let Some(path) = config.config_file.as_deref() else {
        validate_wireguard_config(config)?;
        return Ok(config.clone());
    };
    if path.trim().is_empty() {
        return Err("WireGuard config-file path cannot be empty".to_string());
    }
    let content = tokio::fs::read_to_string(Path::new(path))
        .await
        .map_err(|e| format!("Failed to read WireGuard config file '{path}': {e}"))?;
    let from_file = parse_wireguard_config_file(&content)
        .map_err(|e| format!("WireGuard config file '{path}' is invalid: {e}"))?;
    let resolved = overlay_wireguard_config(from_file, config);
    validate_wireguard_config(&resolved)
        .map_err(|error| format!("WireGuard config file '{path}' is invalid: {error}"))?;
    Ok(resolved)
}

pub struct WireGuardService {
    connections: HashMap<String, WireGuardConnection>,
    /// Live WGApi handles keyed by connection ID.  These are not
    /// serialisable so they live outside the connection struct.
    wg_handles: HashMap<String, WgHandle>,
    emitter: Option<DynEventEmitter>,
    storage: Option<sorng_storage::storage::SecureStorageState>,
    definitions_loaded: bool,
    /// Profiles loaded from persisted definitions need one exact OS-level
    /// observation because runtime handles and status are intentionally not
    /// serialised. Fresh in-process profiles never need this fallback.
    restored_profile_ids: HashSet<String>,
    interface_activity_probe: Arc<dyn WireGuardInterfaceActivityProbe>,
}

impl WireGuardService {
    pub fn new() -> WireGuardServiceState {
        Arc::new(Mutex::new(WireGuardService {
            connections: HashMap::new(),
            wg_handles: HashMap::new(),
            emitter: None,
            storage: None,
            definitions_loaded: true,
            restored_profile_ids: HashSet::new(),
            interface_activity_probe: Arc::new(SystemWireGuardInterfaceActivityProbe),
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> WireGuardServiceState {
        Arc::new(Mutex::new(WireGuardService {
            connections: HashMap::new(),
            wg_handles: HashMap::new(),
            emitter: Some(emitter),
            storage: None,
            definitions_loaded: true,
            restored_profile_ids: HashSet::new(),
            interface_activity_probe: Arc::new(SystemWireGuardInterfaceActivityProbe),
        }))
    }

    pub fn new_persistent(
        emitter: DynEventEmitter,
        storage: sorng_storage::storage::SecureStorageState,
    ) -> WireGuardServiceState {
        Arc::new(Mutex::new(WireGuardService {
            connections: HashMap::new(),
            wg_handles: HashMap::new(),
            emitter: Some(emitter),
            storage: Some(storage),
            definitions_loaded: false,
            restored_profile_ids: HashSet::new(),
            interface_activity_probe: Arc::new(SystemWireGuardInterfaceActivityProbe),
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
                "WireGuard profile storage is unreadable; stored profiles were left untouched: {e}"
            )),
        }
    }

    async fn persist_or_rollback(
        &mut self,
        previous: HashMap<String, WireGuardConnection>,
    ) -> Result<(), String> {
        let Some(storage) = self.storage.clone() else {
            return Ok(());
        };
        if let Err(e) = save_service_data(self, &storage).await {
            self.connections = previous;
            return Err(format!(
                "WireGuard profile change was not saved and has been rolled back: {e}"
            ));
        }
        Ok(())
    }

    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "wireguard",
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
        config: WireGuardConfig,
    ) -> Result<String, String> {
        self.ensure_persisted_loaded().await?;
        // Validate the effective runtime configuration before mutating the
        // profile map, including configs already parsed by the frontend.
        resolve_wireguard_config(&config).await?;
        let previous = self.connections.clone();
        let id = Uuid::new_v4().to_string();
        let connection = WireGuardConnection {
            id: id.clone(),
            name,
            config,
            status: WireGuardStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            interface_name: None,
            local_ip: None,
            peer_ip: None,
            process_id: None,
        };

        self.connections.insert(id.clone(), connection);
        self.persist_or_rollback(previous).await?;
        Ok(id)
    }

    /// Import a standard WireGuard `.conf` payload as an explicit, validated
    /// profile. The source content is never persisted or included in errors.
    pub async fn create_connection_from_conf(
        &mut self,
        name: String,
        content: String,
    ) -> Result<String, String> {
        self.ensure_persisted_loaded().await?;
        let mut config = parse_wireguard_config_file(&content)
            .map_err(|error| format!("WireGuard config import failed: {error}"))?;
        config.config_file = None;
        validate_wireguard_config(&config)
            .map_err(|error| format!("WireGuard config import failed: {error}"))?;
        self.create_connection(name, config).await
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        // Validate connection exists
        if !self.connections.contains_key(connection_id) {
            return Err("WireGuard connection not found".to_string());
        }

        // Early-return if already connected
        if let Some(conn) = self.connections.get(connection_id) {
            if matches!(conn.status, WireGuardStatus::Connected) {
                return Ok(());
            }
        }

        // A retained handle means an earlier teardown failed. Do not replace
        // the only authoritative ownership handle with a new runtime.
        if self.wg_handles.contains_key(connection_id) {
            let error = INCOMPLETE_TEARDOWN_ERROR.to_string();
            if let Some(connection) = self.connections.get_mut(connection_id) {
                connection.status = WireGuardStatus::Error(error.clone());
            }
            self.emit_status(
                connection_id,
                "error",
                serde_json::json!({ "error": &error }),
            );
            return Err(format!("WireGuard connection failed: {error}"));
        }

        // Resolve a selected standard `.conf` file into the same explicit
        // runtime model used by manually entered profiles.
        let stored_config = self.connections[connection_id].config.clone();
        let config = match resolve_wireguard_config(&stored_config).await {
            Ok(config) => config,
            Err(error) => {
                if let Some(connection) = self.connections.get_mut(connection_id) {
                    connection.status = WireGuardStatus::Error(error.clone());
                }
                self.emit_status(
                    connection_id,
                    "error",
                    serde_json::json!({ "error": &error }),
                );
                return Err(format!("WireGuard connection failed: {error}"));
            }
        };

        // Auto-generated names are the only interfaces we may safely regard
        // as app-owned after a restart. User-selected names are never removed
        // speculatively.
        let (interface_name, app_owned_name) =
            match select_wireguard_interface_name(connection_id, &config) {
                Ok(selection) => selection,
                Err(error) => {
                    if let Some(connection) = self.connections.get_mut(connection_id) {
                        connection.status = WireGuardStatus::Error(error.clone());
                    }
                    self.emit_status(
                        connection_id,
                        "error",
                        serde_json::json!({ "error": &error }),
                    );
                    return Err(format!("WireGuard connection failed: {error}"));
                }
            };

        if app_owned_name && !self.wg_handles.contains_key(connection_id) {
            if let Err(error) = Self::reconcile_app_owned_interface(&interface_name) {
                if let Some(connection) = self.connections.get_mut(connection_id) {
                    connection.status = WireGuardStatus::Error(error.clone());
                    // Preserve the exact deterministic ownership hint when a
                    // stale-interface inspection or cleanup failed. Activity
                    // probes must not later collapse this state to inactive.
                    connection.interface_name = Some(interface_name.clone());
                }
                self.emit_status(
                    connection_id,
                    "error",
                    serde_json::json!({ "error": &error }),
                );
                return Err(format!("WireGuard connection failed: {error}"));
            }
        }

        // Mark as connecting
        if let Some(conn) = self.connections.get_mut(connection_id) {
            conn.status = WireGuardStatus::Connecting;
            conn.interface_name = Some(interface_name.clone());
        }

        // Build and configure the WireGuard interface
        let result = self.setup_wireguard_interface(connection_id, &interface_name, &config);

        match result {
            Ok(local_ip) => {
                self.restored_profile_ids.remove(connection_id);
                let connection = self
                    .connections
                    .get_mut(connection_id)
                    .expect("connection_id verified above");

                connection.status = WireGuardStatus::Connected;
                connection.connected_at = Some(Utc::now());
                connection.local_ip = local_ip.clone();

                // Peer endpoint IP (from the config)
                connection.peer_ip = config.endpoint.as_ref().map(|ep| {
                    // Strip the port from "host:port"
                    ep.rsplit_once(':')
                        .map(|(host, _)| host.to_string())
                        .unwrap_or_else(|| ep.clone())
                });

                let peer_ip = connection.peer_ip.clone();

                self.emit_status(
                    connection_id,
                    "connected",
                    serde_json::json!({
                        "local_ip": local_ip,
                        "peer_ip": peer_ip,
                    }),
                );
                Ok(())
            }
            Err(err_msg) => {
                if let Some(conn) = self.connections.get_mut(connection_id) {
                    conn.status = WireGuardStatus::Error(err_msg.clone());
                    // A retained handle means rollback itself failed and the
                    // exact interface remains owned. When setup rollback did
                    // succeed, clear the transient name so inactivity is
                    // unambiguous and a later connect can retry normally.
                    if !self.wg_handles.contains_key(connection_id) {
                        conn.interface_name = None;
                    }
                }

                self.emit_status(
                    connection_id,
                    "error",
                    serde_json::json!({ "error": &err_msg }),
                );
                Err(format!("WireGuard connection failed: {}", err_msg))
            }
        }
    }

    fn reconcile_app_owned_interface(interface_name: &str) -> Result<(), String> {
        #[cfg(unix)]
        {
            // The userspace backend's exact ownership artifact is its control
            // socket. Avoid invoking cleanup at all when it is absent because
            // some platforms run DNS teardown after a NotFound socket.
            let socket_path = format!("/var/run/wireguard/{interface_name}.sock");
            if !Path::new(&socket_path).exists() {
                return Ok(());
            }
        }

        let mut runtime = WgHandle::new(interface_name.to_string())
            .map_err(|error| format!("Failed to inspect stale WireGuard interface: {error}"))?;
        reconcile_app_owned_runtime(&mut runtime, cfg!(target_os = "windows"))
    }

    fn build_setup_plan(
        interface_name: &str,
        config: &WireGuardConfig,
    ) -> Result<WireGuardSetupPlan, String> {
        // Everything that can be validated locally is resolved before the
        // operating-system interface exists.
        validate_wireguard_config(config)?;
        let peer = Self::build_peer(config)?;
        let private_key = config
            .private_key
            .as_deref()
            .expect("validated WireGuard config has a private key");
        let addresses = parse_wireguard_interface_addresses(config)?;
        let dns = parse_wireguard_dns_servers(config)?;
        let local_ip = addresses.first().map(|address| address.address.to_string());

        Ok(WireGuardSetupPlan {
            interface: InterfaceConfiguration {
                name: interface_name.to_string(),
                prvkey: private_key.to_string(),
                addresses,
                port: config.listen_port.unwrap_or(0),
                peers: vec![peer],
                mtu: config.mtu.map(u32::from),
            },
            dns,
            local_ip,
        })
    }

    fn configure_created_runtime<R: WireGuardRuntime>(
        runtime: R,
        plan: &WireGuardSetupPlan,
    ) -> Result<(R, Option<String>), WireGuardSetupFailure<R>> {
        let created =
            CreatedWireGuardInterface::create(runtime).map_err(|error| WireGuardSetupFailure {
                error,
                retained_runtime: None,
            })?;
        let setup_result = (|| {
            created
                .runtime()
                .configure_interface(&plan.interface)
                .map_err(|error| format!("Failed to configure WireGuard interface: {error}"))?;

            for address in &plan.interface.addresses {
                created.runtime().assign_address(address).map_err(|error| {
                    format!("Failed to assign WireGuard address {address}: {error}")
                })?;
            }

            if !plan.dns.is_empty() {
                created
                    .runtime()
                    .configure_dns(&plan.dns, &[])
                    .map_err(|error| format!("Failed to configure WireGuard DNS: {error}"))?;
            }

            created
                .runtime()
                .configure_peer_routing(&plan.interface.peers)
                .map_err(|error| format!("Failed to configure WireGuard peer routing: {error}"))?;
            Ok(())
        })();

        match setup_result {
            Ok(()) => Ok((created.finish(), plan.local_ip.clone())),
            Err(error) => Err(created.rollback(error)),
        }
    }

    fn configure_and_store_created_runtime<R: WireGuardRuntime>(
        handles: &mut HashMap<String, R>,
        connection_id: &str,
        runtime: R,
        plan: &WireGuardSetupPlan,
    ) -> Result<Option<String>, String> {
        if handles.contains_key(connection_id) {
            return Err(INCOMPLETE_TEARDOWN_ERROR.to_string());
        }

        match Self::configure_created_runtime(runtime, plan) {
            Ok((runtime, local_ip)) => {
                handles.insert(connection_id.to_string(), runtime);
                Ok(local_ip)
            }
            Err(failure) => {
                if let Some(runtime) = failure.retained_runtime {
                    handles.insert(connection_id.to_string(), runtime);
                }
                Err(failure.error)
            }
        }
    }

    /// Creates the WireGuard interface, configures it, and returns the
    /// local IP address (if any addresses were configured).
    fn setup_wireguard_interface(
        &mut self,
        connection_id: &str,
        interface_name: &str,
        config: &WireGuardConfig,
    ) -> Result<Option<String>, String> {
        let plan = Self::build_setup_plan(interface_name, config)?;
        let runtime = WgHandle::new(interface_name.to_string())
            .map_err(|error| format!("Failed to create WireGuard API: {error}"))?;
        Self::configure_and_store_created_runtime(
            &mut self.wg_handles,
            connection_id,
            runtime,
            &plan,
        )
    }

    /// Build a `Peer` from the user-supplied `WireGuardConfig`.
    fn build_peer(config: &WireGuardConfig) -> Result<Peer, String> {
        use defguard_wireguard_rs::key::Key;

        let pubkey_str = config
            .public_key
            .as_deref()
            .ok_or_else(|| "Peer public key is required".to_string())?;

        let pubkey: Key = pubkey_str
            .parse()
            .map_err(|e| format!("Invalid peer public key: {e}"))?;

        let mut peer = Peer::new(pubkey);

        // Preshared key
        if let Some(psk_str) = &config.preshared_key {
            let psk: Key = psk_str
                .parse()
                .map_err(|e| format!("Invalid preshared key: {e}"))?;
            peer.preshared_key = Some(psk);
        }

        // Endpoint
        if let Some(endpoint_str) = &config.endpoint {
            peer.set_endpoint(endpoint_str)
                .map_err(|e| format!("Invalid endpoint '{}': {e}", endpoint_str))?;
        }

        // Allowed IPs
        let allowed_ips: Vec<IpAddrMask> = config
            .allowed_ips
            .iter()
            .map(|s| {
                s.parse::<IpAddrMask>()
                    .map_err(|e| format!("Invalid allowed IP '{}': {e}", s))
            })
            .collect::<Result<Vec<_>, _>>()?;
        peer.set_allowed_ips(allowed_ips);

        // Persistent keepalive
        if let Some(keepalive) = config.persistent_keepalive {
            peer.persistent_keepalive_interval = Some(keepalive);
        }

        Ok(peer)
    }

    /// Remove and tear down a stored WGApi handle.
    ///
    /// On Windows `remove_interface` takes `&mut self`, on Unix it takes
    /// `&self`.  This helper abstracts that difference.
    fn remove_wg_handle(&mut self, connection_id: &str) -> Result<bool, String> {
        remove_runtime_handle(&mut self.wg_handles, connection_id)
    }

    fn teardown_connection_with<F>(
        &mut self,
        connection_id: &str,
        reconcile_app_owned: F,
    ) -> Result<(), String>
    where
        F: FnOnce(&str) -> Result<(), String>,
    {
        let deterministic_name = {
            let connection = self
                .connections
                .get(connection_id)
                .ok_or_else(|| "WireGuard connection not found".to_string())?;

            // A custom interface name is user-managed after process restart:
            // without the live handle we must never guess that it is ours.
            if connection.config.interface_name.is_some() {
                None
            } else {
                deterministic_wireguard_interface_name(connection_id)
            }
        };

        self.connections
            .get_mut(connection_id)
            .expect("connection_id verified above")
            .status = WireGuardStatus::Disconnecting;

        let teardown = match self.remove_wg_handle(connection_id) {
            Ok(true) => Ok(()),
            Ok(false) => {
                if let Some(interface_name) = deterministic_name.as_deref() {
                    reconcile_app_owned(interface_name)
                } else {
                    Ok(())
                }
            }
            Err(error) => Err(error),
        };

        if let Err(error) = teardown {
            let connection = self
                .connections
                .get_mut(connection_id)
                .expect("connection_id verified above");
            connection.status = WireGuardStatus::Error(error.clone());
            if connection.interface_name.is_none() {
                connection.interface_name = deterministic_name;
            }
            self.emit_status(
                connection_id,
                "error",
                serde_json::json!({ "error": &error }),
            );
            return Err(format!("WireGuard disconnection failed: {error}"));
        }

        let connection = self
            .connections
            .get_mut(connection_id)
            .expect("connection_id verified above");
        connection.status = WireGuardStatus::Disconnected;
        connection.connected_at = None;
        connection.local_ip = None;
        connection.peer_ip = None;
        connection.interface_name = None;
        connection.process_id = None;
        self.restored_profile_ids.remove(connection_id);

        self.emit_status(connection_id, "disconnected", serde_json::json!({}));
        Ok(())
    }

    async fn disconnect_with_reconciler<F>(
        &mut self,
        connection_id: &str,
        reconcile_app_owned: F,
    ) -> Result<(), String>
    where
        F: FnOnce(&str) -> Result<(), String>,
    {
        self.ensure_persisted_loaded().await?;
        self.teardown_connection_with(connection_id, reconcile_app_owned)
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        self.disconnect_with_reconciler(connection_id, Self::reconcile_app_owned_interface)
            .await
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<WireGuardConnection, String> {
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "WireGuard connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<WireGuardConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn probe_connection_active(&mut self, connection_id: &str) -> Result<bool, String> {
        self.ensure_persisted_loaded().await?;
        let Some(connection) = self.connections.get(connection_id) else {
            return Ok(false);
        };

        if let Some(handle) = self.wg_handles.get(connection_id) {
            handle.read_interface_data().map_err(|error| {
                format!(
                    "Failed to inspect the owned WireGuard interface; ownership was retained: {error}"
                )
            })?;
            return if matches!(connection.status, WireGuardStatus::Connected) {
                Ok(true)
            } else {
                Err(
                    "WireGuard retains a live interface handle, but readiness is not confirmed"
                        .to_string(),
                )
            };
        }

        if connection.interface_name.is_some() || connection.process_id.is_some() {
            return Err(
                "WireGuard retains interface ownership metadata, but the interface could not be safely inspected"
                    .to_string(),
            );
        }

        if self.restored_profile_ids.contains(connection_id) {
            // Persistence deliberately resets transient status and runtime
            // handles. For a deterministic app-owned name, query that exact
            // OS artifact before declaring the profile inactive. A custom
            // configured name remains user-managed and is never guessed; its
            // activity therefore remains uncertain until the user reconciles
            // it explicitly.
            if connection.config.interface_name.is_none() {
                let interface_name = deterministic_wireguard_interface_name(connection_id)
                    .ok_or_else(|| {
                        "WireGuard profile id is invalid; restored interface activity is uncertain"
                            .to_string()
                    })?;
                return self
                    .interface_activity_probe
                    .probe_exact_interface(&interface_name)
                    .await;
            }
            return Err(
                "WireGuard uses a custom interface name restored from storage; activity cannot be safely determined automatically"
                    .to_string(),
            );
        }

        match connection.status {
            WireGuardStatus::Disconnected | WireGuardStatus::Error(_) => Ok(false),
            _ => Err(
                "WireGuard runtime state is transitional or inconsistent; activity could not be confirmed"
                    .to_string(),
            ),
        }
    }

    async fn delete_connection_with_reconciler<F>(
        &mut self,
        connection_id: &str,
        reconcile_app_owned: F,
    ) -> Result<(), String>
    where
        F: FnOnce(&str) -> Result<(), String>,
    {
        self.ensure_persisted_loaded().await?;
        if !self.connections.contains_key(connection_id) {
            return Ok(());
        }

        // Always reconcile before deleting. Persisted definitions intentionally
        // restore as Disconnected and without a handle, while the exact
        // app-owned interface can survive a process restart.
        self.teardown_connection_with(connection_id, reconcile_app_owned)?;

        let previous = self.connections.clone();
        self.connections.remove(connection_id);
        self.restored_profile_ids.remove(connection_id);
        self.persist_or_rollback(previous).await
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        self.delete_connection_with_reconciler(connection_id, Self::reconcile_app_owned_interface)
            .await
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<WireGuardConfig>,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let current = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "WireGuard connection not found".to_string())?;

        if config.is_some() && !matches!(current.status, WireGuardStatus::Disconnected) {
            return Err(
                "WireGuard configuration can only be changed while the connection is disconnected"
                    .to_string(),
            );
        }

        if let Some(new_config) = config.as_ref() {
            // Reject unsupported or malformed explicit/imported configs before
            // changing either the name or config.
            resolve_wireguard_config(new_config).await?;
        }
        self.apply_connection_update(connection_id, name, config)
            .await
    }

    async fn apply_connection_update(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<WireGuardConfig>,
    ) -> Result<(), String> {
        let previous = self.connections.clone();
        let connection = self
            .connections
            .get_mut(connection_id)
            .expect("connection_id verified above");

        if let Some(new_name) = name {
            connection.name = new_name;
        }
        if let Some(new_config) = config {
            connection.config = new_config;
        }
        self.persist_or_rollback(previous).await
    }

    async fn update_connection_with_explicit_private_key_clear(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: WireGuardConfig,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        let current = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "WireGuard connection not found".to_string())?;
        if !matches!(current.status, WireGuardStatus::Disconnected) {
            return Err(
                "WireGuard configuration can only be changed while the connection is disconnected"
                    .to_string(),
            );
        }

        let mut validation_config = config.clone();
        validation_config.private_key = Some(PRIVATE_KEY_CLEAR_VALIDATION_PLACEHOLDER.to_string());
        resolve_wireguard_config(&validation_config).await?;
        self.apply_connection_update(connection_id, name, Some(config))
            .await
    }

    pub async fn update_connection_from_ipc(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        mut config: Option<WireGuardConfig>,
        secret_mutation: WireGuardSecretMutation,
    ) -> Result<(), String> {
        self.ensure_persisted_loaded().await?;
        if config.is_none()
            && (secret_mutation.clear_private_key || secret_mutation.clear_preshared_key)
        {
            let mut current = self
                .connections
                .get(connection_id)
                .ok_or_else(|| "WireGuard connection not found".to_string())?
                .config
                .clone();
            if secret_mutation.clear_private_key {
                current.private_key = None;
            }
            if secret_mutation.clear_preshared_key {
                current.preshared_key = None;
            }
            config = Some(current);
        }
        if let Some(submitted) = config.as_mut() {
            let stored = &self
                .connections
                .get(connection_id)
                .ok_or_else(|| "WireGuard connection not found".to_string())?
                .config;
            crate::persistence::merge_secret_update(
                &stored.private_key,
                &mut submitted.private_key,
                secret_mutation.clear_private_key,
                "WireGuard private key",
            )?;
            crate::persistence::merge_secret_update(
                &stored.preshared_key,
                &mut submitted.preshared_key,
                secret_mutation.clear_preshared_key,
                "WireGuard preshared key",
            )?;
        }
        if secret_mutation.clear_private_key {
            let config = config.expect("explicit private-key clear materializes current config");
            self.update_connection_with_explicit_private_key_clear(connection_id, name, config)
                .await
        } else {
            self.update_connection(connection_id, name, config).await
        }
    }

    /// Generate a traditional WireGuard config-file string.
    ///
    /// This is kept for diagnostic/export purposes even though the
    /// embedded implementation no longer writes temp files.
    #[allow(dead_code)]
    fn generate_config(
        &self,
        config: &WireGuardConfig,
        _interface_name: &str,
    ) -> Result<String, String> {
        let mut lines = Vec::new();

        lines.push("[Interface]".to_string());
        if let Some(private_key) = &config.private_key {
            lines.push(format!("PrivateKey = {}", private_key));
        }
        if let Some(listen_port) = config.listen_port {
            lines.push(format!("ListenPort = {}", listen_port));
        }
        if !config.addresses.is_empty() {
            lines.push(format!("Address = {}", config.addresses.join(",")));
        }
        if !config.dns_servers.is_empty() {
            lines.push(format!("DNS = {}", config.dns_servers.join(",")));
        }
        if let Some(mtu) = config.mtu {
            lines.push(format!("MTU = {}", mtu));
        }
        if let Some(table) = &config.table {
            lines.push(format!("Table = {}", table));
        }
        if let Some(fwmark) = config.fwmark {
            lines.push(format!("FwMark = {}", fwmark));
        }

        lines.push(String::new());
        lines.push("[Peer]".to_string());
        if let Some(public_key) = &config.public_key {
            lines.push(format!("PublicKey = {}", public_key));
        }
        if let Some(preshared_key) = &config.preshared_key {
            lines.push(format!("PresharedKey = {}", preshared_key));
        }
        if let Some(endpoint) = &config.endpoint {
            lines.push(format!("Endpoint = {}", endpoint));
        }
        if !config.allowed_ips.is_empty() {
            lines.push(format!("AllowedIPs = {}", config.allowed_ips.join(",")));
        }
        if let Some(persistent_keepalive) = config.persistent_keepalive {
            lines.push(format!("PersistentKeepalive = {}", persistent_keepalive));
        }

        Ok(lines.join("\n"))
    }

    #[allow(dead_code)] // Used in tests and for diagnostics
    fn extract_ip_from_output(&self, output: &str) -> Result<String, String> {
        for line in output.lines() {
            if line.trim().starts_with("inet ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    return Ok(parts[1].split('/').next().unwrap_or(parts[1]).to_string());
                }
            }
        }
        Err("No IP address found".to_string())
    }

    #[allow(dead_code)] // Used for diagnostics
    fn extract_peer_ip_from_wg(&self, output: &str) -> Option<String> {
        for line in output.lines() {
            if line.contains("endpoint:") {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 2 {
                    return Some(parts[1].trim().to_string());
                }
            }
        }
        None
    }
}

#[async_trait::async_trait]
impl Persistable for WireGuardService {
    fn storage_key(&self) -> &'static str {
        crate::persistence::keys::WIREGUARD
    }

    fn serialize_definitions(&self) -> Result<String, String> {
        let mut connections = self.connections.values().cloned().collect::<Vec<_>>();
        connections.sort_by(|a, b| a.id.cmp(&b.id));
        for connection in &mut connections {
            connection.status = WireGuardStatus::Disconnected;
            connection.connected_at = None;
            connection.interface_name = None;
            connection.local_ip = None;
            connection.peer_ip = None;
            connection.process_id = None;
        }
        serialize_profile_definitions(&connections)
    }

    fn deserialize_definitions(&mut self, data: &str) -> Result<(), String> {
        let mut restored = HashMap::new();
        for mut connection in deserialize_profile_definitions::<WireGuardConnection>(data)? {
            if connection.id.trim().is_empty() {
                return Err("WireGuard profile has an empty id".to_string());
            }
            connection.status = WireGuardStatus::Disconnected;
            connection.connected_at = None;
            connection.interface_name = None;
            connection.local_ip = None;
            connection.peer_ip = None;
            connection.process_id = None;
            let id = connection.id.clone();
            if restored.insert(id.clone(), connection).is_some() {
                return Err(format!(
                    "WireGuard profile data contains duplicate id '{id}'"
                ));
            }
        }
        self.restored_profile_ids = restored.keys().cloned().collect();
        self.connections = restored;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc as StdArc, Mutex as StdMutex};

    const TEST_PRIVATE_KEY: &str = "AAECAwQFBgcICQoLDA0OD/Dh0sO0pZaHeGlaSzwtHg8=";
    const TEST_PUBLIC_KEY: &str =
        "1111111111111111111111111111111111111111111111111111111111111111";
    const TEST_PRESHARED_KEY: &str =
        "2222222222222222222222222222222222222222222222222222222222222222";

    fn default_wg_config() -> WireGuardConfig {
        WireGuardConfig {
            private_key: Some(TEST_PRIVATE_KEY.to_string()),
            public_key: Some(TEST_PUBLIC_KEY.to_string()),
            preshared_key: None,
            endpoint: Some("vpn.example.com:51820".to_string()),
            addresses: vec!["10.7.0.2/24".to_string()],
            allowed_ips: vec!["0.0.0.0/0".to_string()],
            persistent_keepalive: Some(25),
            listen_port: None,
            dns_servers: vec!["1.1.1.1".to_string()],
            mtu: Some(1420),
            table: None,
            fwmark: None,
            config_file: None,
            interface_name: None,
        }
    }

    struct MockWireGuardInterfaceActivityProbe {
        result: Result<bool, String>,
        calls: StdMutex<Vec<String>>,
    }

    impl MockWireGuardInterfaceActivityProbe {
        fn new(result: Result<bool, String>) -> Self {
            Self {
                result,
                calls: StdMutex::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl WireGuardInterfaceActivityProbe for MockWireGuardInterfaceActivityProbe {
        async fn probe_exact_interface(&self, interface_name: &str) -> Result<bool, String> {
            self.calls.lock().unwrap().push(interface_name.to_string());
            self.result.clone()
        }
    }

    async fn restored_service_with_activity_probe(
        result: Result<bool, String>,
    ) -> (
        WireGuardServiceState,
        String,
        StdArc<MockWireGuardInterfaceActivityProbe>,
    ) {
        let source_state = WireGuardService::new();
        let mut source = source_state.lock().await;
        let id = source
            .create_connection("Restored".to_string(), default_wg_config())
            .await
            .unwrap();
        let encoded = source.serialize_definitions().unwrap();
        drop(source);

        let probe = StdArc::new(MockWireGuardInterfaceActivityProbe::new(result));
        let restored_state = WireGuardService::new();
        {
            let mut restored = restored_state.lock().await;
            restored.interface_activity_probe = probe.clone();
            restored.deserialize_definitions(&encoded).unwrap();
        }
        (restored_state, id, probe)
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum InjectedFailure {
        Create,
        Configure,
        Address,
        Dns,
        Routing,
        Remove,
    }

    #[derive(Debug)]
    struct FakeWireGuardRuntime {
        label: &'static str,
        log: StdArc<StdMutex<Vec<String>>>,
        failures: Vec<InjectedFailure>,
    }

    impl FakeWireGuardRuntime {
        fn record(&self, operation: &str) -> Result<(), String> {
            self.log
                .lock()
                .unwrap()
                .push(format!("{}:{operation}", self.label));
            let stage = match operation {
                "create" => InjectedFailure::Create,
                "configure" => InjectedFailure::Configure,
                "address" => InjectedFailure::Address,
                "dns" => InjectedFailure::Dns,
                "routing" => InjectedFailure::Routing,
                "remove" => InjectedFailure::Remove,
                _ => unreachable!(),
            };
            if self.failures.contains(&stage) {
                Err(format!("injected {operation} failure"))
            } else {
                Ok(())
            }
        }
    }

    impl WireGuardRuntime for FakeWireGuardRuntime {
        fn create_interface(&mut self) -> Result<(), String> {
            self.record("create")
        }

        fn configure_interface(&self, _config: &InterfaceConfiguration) -> Result<(), String> {
            self.record("configure")
        }

        fn assign_address(&self, _address: &IpAddrMask) -> Result<(), String> {
            self.record("address")
        }

        fn configure_dns(&self, _dns: &[IpAddr], _search: &[&str]) -> Result<(), String> {
            self.record("dns")
        }

        fn configure_peer_routing(&self, _peers: &[Peer]) -> Result<(), String> {
            self.record("routing")
        }

        fn remove_interface(&mut self) -> Result<(), String> {
            self.record("remove")
        }
    }

    fn setup_test_plan() -> WireGuardSetupPlan {
        let mut config = default_wg_config();
        config.endpoint = Some("127.0.0.1:51820".to_string());
        WireGuardService::build_setup_plan("sorng_test", &config).unwrap()
    }

    // ── Serde ───────────────────────────────────────────────────────────

    #[test]
    fn wireguard_status_serde_roundtrip() {
        let variants: Vec<WireGuardStatus> = vec![
            WireGuardStatus::Disconnected,
            WireGuardStatus::Connecting,
            WireGuardStatus::Connected,
            WireGuardStatus::Disconnecting,
            WireGuardStatus::Error("test".to_string()),
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: WireGuardStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", v), format!("{:?}", back));
        }
    }

    #[test]
    fn wireguard_config_serde_roundtrip() {
        let cfg = default_wg_config();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: WireGuardConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.endpoint, Some("vpn.example.com:51820".to_string()));
        assert_eq!(back.mtu, Some(1420));
        assert_eq!(back.addresses, vec!["10.7.0.2/24"]);
        assert_eq!(back.allowed_ips, vec!["0.0.0.0/0"]);
    }

    #[test]
    fn frontend_snake_case_config_payload_deserializes() {
        let config: WireGuardConfig = serde_json::from_value(serde_json::json!({
            "private_key": "private-base64",
            "public_key": "public-base64",
            "endpoint": "wg.example.com:51820",
            "addresses": ["10.44.0.2/24"],
            "allowed_ips": ["10.80.0.0/16", "fd80::/64"],
            "persistent_keepalive": 25,
            "dns_servers": ["10.44.0.53"]
        }))
        .unwrap();

        assert_eq!(config.addresses, vec!["10.44.0.2/24"]);
        assert_eq!(config.allowed_ips, vec!["10.80.0.0/16", "fd80::/64"]);
        assert_eq!(config.dns_servers, vec!["10.44.0.53"]);
        assert_eq!(config.endpoint.as_deref(), Some("wg.example.com:51820"));
    }

    #[test]
    fn legacy_wireguard_config_without_addresses_migrates_to_empty_list() {
        let mut value = serde_json::to_value(default_wg_config()).unwrap();
        value.as_object_mut().unwrap().remove("addresses");

        let migrated: WireGuardConfig = serde_json::from_value(value).unwrap();
        assert!(migrated.addresses.is_empty());
        assert_eq!(migrated.allowed_ips, vec!["0.0.0.0/0"]);
    }

    #[test]
    fn standard_config_file_parser_preserves_interface_and_peer_semantics() {
        let content = format!(
            r#"
                [Interface]
                PrivateKey = {TEST_PRIVATE_KEY}
                Address = 10.8.0.2/24, fd00::2/64
                DNS = 1.1.1.1, 2606:4700:4700::1111
                ListenPort = 51820
                MTU = 1420
                Table = auto

                [Peer]
                PublicKey = {TEST_PUBLIC_KEY}
                PresharedKey = {TEST_PRESHARED_KEY}
                Endpoint = vpn.example.com:51820
                AllowedIPs = 10.20.0.0/16, fd10::/64
                PersistentKeepalive = 25
            "#,
        );
        let parsed = parse_wireguard_config_file(&content).unwrap();

        assert_eq!(parsed.private_key.as_deref(), Some(TEST_PRIVATE_KEY));
        assert_eq!(parsed.addresses, vec!["10.8.0.2/24", "fd00::2/64"]);
        assert_eq!(parsed.dns_servers, vec!["1.1.1.1", "2606:4700:4700::1111"]);
        assert_eq!(parsed.public_key.as_deref(), Some(TEST_PUBLIC_KEY));
        assert_eq!(parsed.allowed_ips, vec!["10.20.0.0/16", "fd10::/64"]);
        assert_eq!(parsed.endpoint.as_deref(), Some("vpn.example.com:51820"));
        assert_eq!(parsed.persistent_keepalive, Some(25));
    }

    #[tokio::test]
    async fn selected_config_file_is_loaded_and_explicit_fields_override_it() {
        let path = std::env::temp_dir().join(format!("sorng-wg-{}.conf", Uuid::new_v4()));
        std::fs::write(
            &path,
            format!(
                "[Interface]\nPrivateKey = {TEST_PRIVATE_KEY}\nAddress = 10.8.0.2/24\n\n[Peer]\nPublicKey = {TEST_PUBLIC_KEY}\nAllowedIPs = 10.0.0.0/8\nEndpoint = file.example:51820\n"
            ),
        )
        .unwrap();
        let mut selected = empty_wireguard_config();
        selected.config_file = Some(path.to_string_lossy().to_string());
        selected.addresses = vec!["10.9.0.2/24".to_string()];

        let resolved = resolve_wireguard_config(&selected).await.unwrap();
        assert_eq!(resolved.private_key.as_deref(), Some(TEST_PRIVATE_KEY));
        assert_eq!(resolved.public_key.as_deref(), Some(TEST_PUBLIC_KEY));
        assert_eq!(resolved.allowed_ips, vec!["10.0.0.0/8"]);
        assert_eq!(resolved.addresses, vec!["10.9.0.2/24"]);
        assert_eq!(resolved.config_file, selected.config_file);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn config_file_rejects_multi_peer_and_unexecutable_hooks() {
        let multi_peer = "[Interface]\nPrivateKey=x\n[Peer]\nPublicKey=a\n[Peer]\nPublicKey=b\n";
        assert!(parse_wireguard_config_file(multi_peer)
            .unwrap_err()
            .contains("one peer"));

        let hook = "[Interface]\nPrivateKey=x\nPostUp=echo unsafe\n[Peer]\nPublicKey=a\n";
        assert!(parse_wireguard_config_file(hook)
            .unwrap_err()
            .contains("not executed"));
    }

    #[test]
    fn config_parser_rejects_unsupported_routing_and_missing_allowed_ips() {
        let table = format!(
            "[Interface]\nPrivateKey={TEST_PRIVATE_KEY}\nTable=123\n[Peer]\nPublicKey={TEST_PUBLIC_KEY}\nAllowedIPs=10.0.0.0/8\n"
        );
        assert!(parse_wireguard_config_file(&table)
            .unwrap_err()
            .contains("Table must be 'auto'"));

        let fwmark = format!(
            "[Interface]\nPrivateKey={TEST_PRIVATE_KEY}\nFwMark=0xca6c\n[Peer]\nPublicKey={TEST_PUBLIC_KEY}\nAllowedIPs=10.0.0.0/8\n"
        );
        assert!(parse_wireguard_config_file(&fwmark)
            .unwrap_err()
            .contains("FwMark is not supported"));

        let missing_allowed = format!(
            "[Interface]\nPrivateKey={TEST_PRIVATE_KEY}\n[Peer]\nPublicKey={TEST_PUBLIC_KEY}\n"
        );
        assert!(parse_wireguard_config_file(&missing_allowed)
            .unwrap_err()
            .contains("AllowedIPs is required"));
    }

    #[tokio::test]
    async fn create_and_update_reject_unsupported_options_before_mutation() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;

        let mut unsupported_create = default_wg_config();
        unsupported_create.table = Some("123".to_string());
        let create_error = service
            .create_connection("Rejected".to_string(), unsupported_create)
            .await
            .unwrap_err();
        assert!(create_error.contains("Table must be 'auto'"));
        assert!(service.connections.is_empty());

        let id = service
            .create_connection("Original".to_string(), default_wg_config())
            .await
            .unwrap();
        let mut unsupported_update = default_wg_config();
        unsupported_update.fwmark = Some(0xca6c);
        let update_error = service
            .update_connection(
                &id,
                Some("Must not be applied".to_string()),
                Some(unsupported_update),
            )
            .await
            .unwrap_err();
        assert!(update_error.contains("FwMark is not supported"));
        let unchanged = service.get_connection(&id).await.unwrap();
        assert_eq!(unchanged.name, "Original");
        assert!(unchanged.config.fwmark.is_none());
    }

    #[tokio::test]
    async fn authoritative_conf_import_returns_id_and_persists_explicit_config() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let content = format!(
            "[Interface]\nPrivateKey={TEST_PRIVATE_KEY}\nAddress=10.55.0.2/24\nDNS=1.1.1.1\n[Peer]\nPublicKey={TEST_PUBLIC_KEY}\nAllowedIPs=10.60.0.0/16\nEndpoint=127.0.0.1:51820\n"
        );

        let id = service
            .create_connection_from_conf("Imported".to_string(), content)
            .await
            .unwrap();
        assert_eq!(id.len(), 36);
        let imported = service.get_connection(&id).await.unwrap();
        assert_eq!(imported.name, "Imported");
        assert_eq!(imported.config.addresses, vec!["10.55.0.2/24"]);
        assert_eq!(imported.config.allowed_ips, vec!["10.60.0.0/16"]);
        assert!(imported.config.config_file.is_none());
    }

    #[tokio::test]
    async fn import_errors_do_not_echo_private_or_preshared_key_material() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let private_secret = "PRIVATE_SECRET_SENTINEL";
        let preshared_secret = "PRESHARED_SECRET_SENTINEL";
        let content = format!(
            "[Interface]\nPrivateKey={private_secret}\n[Peer]\nPublicKey={TEST_PUBLIC_KEY}\nPresharedKey={preshared_secret}\nAllowedIPs=10.0.0.0/8\n"
        );

        let error = service
            .create_connection_from_conf("Rejected".to_string(), content)
            .await
            .unwrap_err();
        assert!(!error.contains(private_secret));
        assert!(!error.contains(preshared_secret));
        assert!(service.connections.is_empty());
    }

    #[tokio::test]
    async fn authoritative_import_rejects_unsafe_or_ambiguous_conf_content() {
        let cases = [
            (
                format!(
                    "[Interface]\nPrivateKey={TEST_PRIVATE_KEY}\nTable=42\n[Peer]\nPublicKey={TEST_PUBLIC_KEY}\nAllowedIPs=10.0.0.0/8\n"
                ),
                "Table must be 'auto'",
            ),
            (
                format!(
                    "[Interface]\nPrivateKey={TEST_PRIVATE_KEY}\nFwMark=51820\n[Peer]\nPublicKey={TEST_PUBLIC_KEY}\nAllowedIPs=10.0.0.0/8\n"
                ),
                "FwMark is not supported",
            ),
            (
                format!(
                    "[Interface]\nPrivateKey={TEST_PRIVATE_KEY}\nPostUp=echo unsafe\n[Peer]\nPublicKey={TEST_PUBLIC_KEY}\nAllowedIPs=10.0.0.0/8\n"
                ),
                "not executed",
            ),
            (
                format!(
                    "[Interface]\nPrivateKey={TEST_PRIVATE_KEY}\n[Peer]\nPublicKey={TEST_PUBLIC_KEY}\n"
                ),
                "AllowedIPs is required",
            ),
            (
                format!(
                    "[Interface]\nPrivateKey={TEST_PRIVATE_KEY}\n[Peer]\nPublicKey={TEST_PUBLIC_KEY}\nAllowedIPs=10.0.0.0/8\n[Peer]\nPublicKey={TEST_PUBLIC_KEY}\nAllowedIPs=10.1.0.0/16\n"
                ),
                "one peer",
            ),
        ];

        for (content, expected) in cases {
            let state = WireGuardService::new();
            let mut service = state.lock().await;
            let error = service
                .create_connection_from_conf("Rejected".to_string(), content)
                .await
                .unwrap_err();
            assert!(error.contains(expected), "{expected}: {error}");
            assert!(service.connections.is_empty());
        }
    }

    #[test]
    fn interface_setup_addresses_do_not_reuse_peer_allowed_ips() {
        let mut config = default_wg_config();
        config.addresses = vec!["10.44.0.2/24".to_string()];
        config.allowed_ips = vec!["0.0.0.0/0".to_string(), "::/0".to_string()];

        let addresses = parse_wireguard_interface_addresses(&config).unwrap();
        assert_eq!(addresses.len(), 1);
        assert_eq!(addresses[0].address, "10.44.0.2".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn every_post_create_setup_failure_is_fatal_and_rolls_back() {
        let plan = setup_test_plan();
        for stage in [
            InjectedFailure::Configure,
            InjectedFailure::Address,
            InjectedFailure::Dns,
            InjectedFailure::Routing,
        ] {
            let log = StdArc::new(StdMutex::new(Vec::new()));
            let runtime = FakeWireGuardRuntime {
                label: "new",
                log: log.clone(),
                failures: vec![stage],
            };

            let failure = WireGuardService::configure_created_runtime(runtime, &plan)
                .expect_err("injected setup failure must remain fatal");
            let error = failure.error;
            assert!(failure.retained_runtime.is_none());
            assert!(error.contains("injected"), "stage {stage:?}: {error}");
            let operations = log.lock().unwrap().clone();
            assert_eq!(operations.first().map(String::as_str), Some("new:create"));
            assert_eq!(operations.last().map(String::as_str), Some("new:remove"));
            assert_eq!(
                operations
                    .iter()
                    .filter(|operation| operation.as_str() == "new:remove")
                    .count(),
                1,
                "stage {stage:?}: {operations:?}"
            );
        }
    }

    #[test]
    fn rollback_failure_is_reported_without_hiding_setup_failure() {
        let plan = setup_test_plan();
        let log = StdArc::new(StdMutex::new(Vec::new()));
        let runtime = FakeWireGuardRuntime {
            label: "new",
            log: log.clone(),
            failures: vec![InjectedFailure::Remove],
        };
        let created = CreatedWireGuardInterface::create(runtime).unwrap();
        let failure = created.rollback("injected configure failure".to_string());
        assert!(failure.error.contains("injected configure failure"));
        assert!(failure.error.contains("rollback also failed"));
        assert!(
            failure.retained_runtime.is_some(),
            "failed rollback must return the only authoritative runtime handle"
        );
        assert_eq!(
            log.lock().unwrap().as_slice(),
            ["new:create".to_string(), "new:remove".to_string()]
        );
        // Keep the plan construction in this test so changes to validation do
        // not accidentally make failure-injection coverage use invalid input.
        assert_eq!(plan.local_ip.as_deref(), Some("10.7.0.2"));
    }

    #[test]
    fn custom_name_failed_setup_retains_handle_blocks_reconnect_and_teardown_retries() {
        let connection_id = "123e4567-e89b-12d3-a456-426614174000";
        let mut config = default_wg_config();
        config.interface_name = Some("company-wg0".to_string());
        let (interface_name, app_owned_name) =
            select_wireguard_interface_name(connection_id, &config).unwrap();
        assert_eq!(interface_name, "company-wg0");
        assert!(!app_owned_name);

        let mut plan = setup_test_plan();
        plan.interface.name = interface_name;
        let owned_log = StdArc::new(StdMutex::new(Vec::new()));
        let runtime = FakeWireGuardRuntime {
            label: "custom",
            log: owned_log.clone(),
            failures: vec![InjectedFailure::Configure, InjectedFailure::Remove],
        };
        let mut handles = HashMap::new();

        let setup_error = WireGuardService::configure_and_store_created_runtime(
            &mut handles,
            connection_id,
            runtime,
            &plan,
        )
        .unwrap_err();
        assert!(setup_error.contains("injected configure failure"));
        assert!(setup_error.contains("rollback also failed"));
        assert!(
            handles.contains_key(connection_id),
            "custom interfaces need their live handle because restart reconciliation intentionally ignores their names"
        );
        assert_eq!(
            owned_log.lock().unwrap().as_slice(),
            [
                "custom:create".to_string(),
                "custom:configure".to_string(),
                "custom:remove".to_string(),
            ]
        );

        let replacement_log = StdArc::new(StdMutex::new(Vec::new()));
        let replacement = FakeWireGuardRuntime {
            label: "replacement",
            log: replacement_log.clone(),
            failures: Vec::new(),
        };
        let reconnect_error = WireGuardService::configure_and_store_created_runtime(
            &mut handles,
            connection_id,
            replacement,
            &plan,
        )
        .unwrap_err();
        assert_eq!(reconnect_error, INCOMPLETE_TEARDOWN_ERROR);
        assert!(
            replacement_log.lock().unwrap().is_empty(),
            "reconnect must be rejected before creating a replacement interface"
        );

        handles
            .get_mut(connection_id)
            .unwrap()
            .failures
            .retain(|failure| *failure != InjectedFailure::Remove);
        assert!(remove_runtime_handle(&mut handles, connection_id).unwrap());
        assert!(!handles.contains_key(connection_id));
        assert_eq!(
            owned_log
                .lock()
                .unwrap()
                .iter()
                .filter(|operation| operation.as_str() == "custom:remove")
                .count(),
            2,
            "explicit teardown must retry the failed rollback removal"
        );
    }

    #[test]
    fn restart_reconciliation_is_narrow_and_precedes_fresh_creation() {
        let connection_id = "123e4567-e89b-12d3-a456-426614174000";
        let config = default_wg_config();
        let (derived, app_owned) = select_wireguard_interface_name(connection_id, &config).unwrap();
        assert_eq!(derived, "sorng_123e4567");
        assert!(app_owned);

        let mut custom = config.clone();
        custom.interface_name = Some("company-wg0".to_string());
        let (custom_name, custom_owned) =
            select_wireguard_interface_name(connection_id, &custom).unwrap();
        assert_eq!(custom_name, "company-wg0");
        assert!(
            !custom_owned,
            "custom interfaces must never be auto-removed"
        );
        #[cfg(target_os = "windows")]
        assert!(validate_wireguard_config(&custom)
            .unwrap_err()
            .contains("cannot be safely distinguished"));
        #[cfg(not(target_os = "windows"))]
        validate_wireguard_config(&custom).unwrap();

        let log = StdArc::new(StdMutex::new(Vec::new()));
        let mut stale = FakeWireGuardRuntime {
            label: "stale",
            log: log.clone(),
            failures: Vec::new(),
        };
        reconcile_app_owned_runtime(&mut stale, false).unwrap();
        let fresh = FakeWireGuardRuntime {
            label: "fresh",
            log: log.clone(),
            failures: Vec::new(),
        };
        let plan = setup_test_plan();
        let (_runtime, local_ip) =
            WireGuardService::configure_created_runtime(fresh, &plan).unwrap();
        assert_eq!(local_ip.as_deref(), Some("10.7.0.2"));
        let operations = log.lock().unwrap().clone();
        assert_eq!(operations.first().map(String::as_str), Some("stale:remove"));
        assert_eq!(operations.get(1).map(String::as_str), Some("fresh:create"));
        assert!(!operations
            .iter()
            .any(|operation| operation == "fresh:remove"));
    }

    #[test]
    fn teardown_failure_retains_live_handle_for_retry() {
        let log = StdArc::new(StdMutex::new(Vec::new()));
        let mut handles = HashMap::from([(
            "connection".to_string(),
            FakeWireGuardRuntime {
                label: "owned",
                log: log.clone(),
                failures: vec![InjectedFailure::Remove],
            },
        )]);

        let error = remove_runtime_handle(&mut handles, "connection").unwrap_err();
        assert!(error.contains("injected remove failure"));
        assert!(
            handles.contains_key("connection"),
            "the authoritative handle must remain available for retry"
        );

        handles.get_mut("connection").unwrap().failures.clear();
        assert!(remove_runtime_handle(&mut handles, "connection").unwrap());
        assert!(!handles.contains_key("connection"));
        assert_eq!(
            log.lock()
                .unwrap()
                .iter()
                .filter(|operation| operation.as_str() == "owned:remove")
                .count(),
            2
        );
    }

    #[test]
    fn wireguard_connection_serde_roundtrip() {
        let conn = WireGuardConnection {
            id: "wg1".to_string(),
            name: "Test WG".to_string(),
            config: default_wg_config(),
            status: WireGuardStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            interface_name: None,
            local_ip: None,
            peer_ip: None,
            process_id: None,
        };
        let json = serde_json::to_string(&conn).unwrap();
        let back: WireGuardConnection = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "wg1");
        assert_eq!(back.name, "Test WG");
    }

    // ── Connection CRUD ─────────────────────────────────────────────────

    #[tokio::test]
    async fn create_connection_returns_uuid() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test WG".to_string(), default_wg_config())
            .await
            .unwrap();
        assert_eq!(id.len(), 36);
    }

    #[tokio::test]
    async fn create_connection_default_status() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_wg_config())
            .await
            .unwrap();
        let conn = svc.get_connection(&id).await.unwrap();
        assert!(matches!(conn.status, WireGuardStatus::Disconnected));
        assert!(conn.connected_at.is_none());
    }

    #[tokio::test]
    async fn list_connections_empty() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        assert!(svc.list_connections().await.is_empty());
    }

    #[tokio::test]
    async fn list_connections_after_create() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        svc.create_connection("WG1".to_string(), default_wg_config())
            .await
            .unwrap();
        svc.create_connection("WG2".to_string(), default_wg_config())
            .await
            .unwrap();
        assert_eq!(svc.list_connections().await.len(), 2);
    }

    #[tokio::test]
    async fn get_connection_not_found() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        assert!(svc.get_connection("nonexistent").await.is_err());
    }

    #[tokio::test]
    async fn delete_connection_removes_it() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_wg_config())
            .await
            .unwrap();
        svc.delete_connection_with_reconciler(&id, |_| Ok(()))
            .await
            .unwrap();
        assert!(svc.get_connection(&id).await.is_err());
    }

    #[tokio::test]
    async fn delete_nonexistent_is_ok() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        // delete_connection just removes from HashMap, doesn't error on missing
        svc.delete_connection("nonexistent").await.unwrap();
    }

    // ── Config generation ───────────────────────────────────────────────

    #[tokio::test]
    async fn generate_config_has_interface_section() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("[Interface]"));
        assert!(content.contains("[Peer]"));
    }

    #[tokio::test]
    async fn generate_config_with_keys() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains(&format!("PrivateKey = {TEST_PRIVATE_KEY}")));
        assert!(content.contains(&format!("PublicKey = {TEST_PUBLIC_KEY}")));
    }

    #[tokio::test]
    async fn generate_config_with_endpoint() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("Endpoint = vpn.example.com:51820"));
    }

    #[tokio::test]
    async fn generate_config_with_dns() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("DNS = 1.1.1.1"));
    }

    #[tokio::test]
    async fn generate_config_with_mtu() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("MTU = 1420"));
    }

    #[tokio::test]
    async fn generate_config_with_keepalive() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("PersistentKeepalive = 25"));
    }

    #[tokio::test]
    async fn generate_config_with_allowed_ips() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("AllowedIPs = 0.0.0.0/0"));
    }

    #[tokio::test]
    async fn generate_config_keeps_local_addresses_separate_from_allowed_ips() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("Address = 10.7.0.2/24"));
        assert!(content.contains("AllowedIPs = 0.0.0.0/0"));
        assert!(!content.contains("Address = 0.0.0.0/0"));
    }

    #[tokio::test]
    async fn generate_config_minimal() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = WireGuardConfig {
            private_key: None,
            public_key: None,
            preshared_key: None,
            endpoint: None,
            addresses: Vec::new(),
            allowed_ips: Vec::new(),
            persistent_keepalive: None,
            listen_port: None,
            dns_servers: Vec::new(),
            mtu: None,
            table: None,
            fwmark: None,
            config_file: None,
            interface_name: None,
        };
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("[Interface]"));
        assert!(content.contains("[Peer]"));
        // Should not contain optional fields
        assert!(!content.contains("PrivateKey"));
    }

    // ── Helper methods ──────────────────────────────────────────────────

    #[tokio::test]
    async fn extract_ip_from_output_valid() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let output = "3: wg0: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1420\n    inet 10.0.0.1/24 scope global wg0\n";
        let ip = svc.extract_ip_from_output(output).unwrap();
        assert_eq!(ip, "10.0.0.1");
    }

    #[tokio::test]
    async fn extract_ip_from_output_no_ip() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let result = svc.extract_ip_from_output("no ip info here");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn extract_peer_ip_from_wg_valid() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let output =
            "interface: wg0\n  public key: abc=\n  peer: xyz=\n    endpoint: 1.2.3.4:51820\n";
        let peer = svc.extract_peer_ip_from_wg(output);
        assert!(peer.is_some());
    }

    #[tokio::test]
    async fn extract_peer_ip_from_wg_none() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let peer = svc.extract_peer_ip_from_wg("no endpoint here");
        assert!(peer.is_none());
    }

    // ── update_connection ──────────────────────────────────────────────

    #[tokio::test]
    async fn update_connection_name() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Original".to_string(), default_wg_config())
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
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_wg_config())
            .await
            .unwrap();

        let mut new_config = default_wg_config();
        new_config.endpoint = Some("new-endpoint.example.com:51820".to_string());
        new_config.mtu = Some(1500);

        svc.update_connection(&id, None, Some(new_config))
            .await
            .unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(
            conn.config.endpoint,
            Some("new-endpoint.example.com:51820".to_string())
        );
        assert_eq!(conn.config.mtu, Some(1500));
    }

    #[tokio::test]
    async fn update_connection_both() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_wg_config())
            .await
            .unwrap();

        let mut new_config = default_wg_config();
        new_config.persistent_keepalive = Some(30);

        svc.update_connection(&id, Some("Renamed".to_string()), Some(new_config))
            .await
            .unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Renamed");
        assert_eq!(conn.config.persistent_keepalive, Some(30));
    }

    #[tokio::test]
    async fn update_connection_not_found() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let result = svc
            .update_connection("nonexistent", Some("Name".to_string()), None)
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn update_connection_no_changes() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_wg_config())
            .await
            .unwrap();

        // Update with None for both should be a no-op
        svc.update_connection(&id, None, None).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Test");
    }

    #[tokio::test]
    async fn connected_config_update_is_rejected_without_mutating_name_or_config() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Original".to_string(), default_wg_config())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status = WireGuardStatus::Connected;

        let mut changed = default_wg_config();
        changed.mtu = Some(1300);
        let error = service
            .update_connection(&id, Some("Rejected".to_string()), Some(changed))
            .await
            .unwrap_err();
        assert!(error.contains("only be changed while the connection is disconnected"));
        let unchanged = service.get_connection(&id).await.unwrap();
        assert_eq!(unchanged.name, "Original");
        assert_eq!(unchanged.config.mtu, Some(1420));

        service
            .update_connection(&id, Some("Name Only".to_string()), None)
            .await
            .unwrap();
        let renamed = service.get_connection(&id).await.unwrap();
        assert_eq!(renamed.name, "Name Only");
        assert!(matches!(renamed.status, WireGuardStatus::Connected));
    }

    #[tokio::test]
    async fn error_status_rejects_config_update_but_allows_name_only() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Original".to_string(), default_wg_config())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status =
            WireGuardStatus::Error("teardown pending".to_string());

        let mut changed = default_wg_config();
        changed.endpoint = Some("replacement.example.com:51820".to_string());
        let error = service
            .update_connection(&id, None, Some(changed))
            .await
            .unwrap_err();
        assert!(error.contains("only be changed while the connection is disconnected"));
        assert_eq!(
            service
                .get_connection(&id)
                .await
                .unwrap()
                .config
                .endpoint
                .as_deref(),
            Some("vpn.example.com:51820")
        );

        service
            .update_connection(&id, Some("Retryable".to_string()), None)
            .await
            .unwrap();
        let renamed = service.get_connection(&id).await.unwrap();
        assert_eq!(renamed.name, "Retryable");
        assert!(matches!(renamed.status, WireGuardStatus::Error(_)));
    }

    // ── is_connection_active ───────────────────────────────────────────

    #[tokio::test]
    async fn is_connection_active_disconnected() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_wg_config())
            .await
            .unwrap();
        assert!(!svc.probe_connection_active(&id).await.unwrap());
    }

    #[tokio::test]
    async fn is_connection_active_nonexistent() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        assert!(!svc.probe_connection_active("nonexistent").await.unwrap());
    }

    #[tokio::test]
    async fn activity_probe_never_reports_inactive_with_retained_interface_metadata() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Retry cleanup".to_string(), default_wg_config())
            .await
            .unwrap();
        let connection = service.connections.get_mut(&id).unwrap();
        connection.status = WireGuardStatus::Error("teardown failed".to_string());
        connection.interface_name = Some("sorng_retained".to_string());

        let error = service.probe_connection_active(&id).await.unwrap_err();
        assert!(error.contains("ownership metadata"));
        assert_eq!(
            service.connections[&id].interface_name.as_deref(),
            Some("sorng_retained")
        );
    }

    #[tokio::test]
    async fn activity_probe_fails_closed_for_connected_status_without_a_live_handle() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Inconsistent".to_string(), default_wg_config())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status = WireGuardStatus::Connected;

        let error = service.probe_connection_active(&id).await.unwrap_err();
        assert!(error.contains("inconsistent"));
    }

    #[tokio::test]
    async fn restored_activity_probe_reports_exact_deterministic_interface_present() {
        let (state, id, probe) = restored_service_with_activity_probe(Ok(true)).await;
        let mut service = state.lock().await;

        assert!(service.probe_connection_active(&id).await.unwrap());
        assert_eq!(
            probe.calls(),
            vec![deterministic_wireguard_interface_name(&id).unwrap()]
        );
    }

    #[tokio::test]
    async fn restored_activity_probe_reports_exact_deterministic_interface_absent() {
        let (state, id, probe) = restored_service_with_activity_probe(Ok(false)).await;
        let mut service = state.lock().await;

        assert!(!service.probe_connection_active(&id).await.unwrap());
        assert_eq!(
            probe.calls(),
            vec![deterministic_wireguard_interface_name(&id).unwrap()]
        );
    }

    #[tokio::test]
    async fn restored_activity_probe_propagates_exact_interface_query_error() {
        let (state, id, probe) =
            restored_service_with_activity_probe(Err("adapter enumeration denied".to_string()))
                .await;
        let mut service = state.lock().await;

        let error = service.probe_connection_active(&id).await.unwrap_err();
        assert!(error.contains("adapter enumeration denied"));
        assert_eq!(
            probe.calls(),
            vec![deterministic_wireguard_interface_name(&id).unwrap()]
        );
    }

    #[tokio::test]
    async fn restored_activity_probe_never_guesses_a_custom_interface_name() {
        let source_state = WireGuardService::new();
        let mut source = source_state.lock().await;
        let id = source
            .create_connection("Custom".to_string(), default_wg_config())
            .await
            .unwrap();
        // Windows rejects new custom names, but legacy persisted profiles can
        // still contain one and must remain visible without being guessed.
        source
            .connections
            .get_mut(&id)
            .unwrap()
            .config
            .interface_name = Some("company-wg0".to_string());
        let encoded = source.serialize_definitions().unwrap();
        drop(source);

        let probe = StdArc::new(MockWireGuardInterfaceActivityProbe::new(Ok(true)));
        let restored_state = WireGuardService::new();
        let mut restored = restored_state.lock().await;
        restored.interface_activity_probe = probe.clone();
        restored.deserialize_definitions(&encoded).unwrap();

        let error = restored.probe_connection_active(&id).await.unwrap_err();
        assert!(error.contains("custom interface name"));
        assert!(probe.calls().is_empty());
    }

    // ── Peer building ──────────────────────────────────────────────────

    #[test]
    fn build_peer_requires_public_key() {
        let mut cfg = default_wg_config();
        cfg.public_key = None;
        assert!(WireGuardService::build_peer(&cfg).is_err());
    }

    #[tokio::test]
    async fn persisted_profile_keeps_id_and_resets_runtime_state() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_wg_config())
            .await
            .unwrap();
        let connection = service.connections.get_mut(&id).unwrap();
        connection.status = WireGuardStatus::Connected;
        connection.interface_name = Some("sorng_test".to_string());
        connection.local_ip = Some("10.0.0.2".to_string());
        let encoded = service.serialize_definitions().unwrap();
        drop(service);

        let restored_state = WireGuardService::new();
        let mut restored = restored_state.lock().await;
        restored.deserialize_definitions(&encoded).unwrap();
        let connection = restored.get_connection(&id).await.unwrap();
        assert_eq!(connection.id, id);
        assert!(matches!(connection.status, WireGuardStatus::Disconnected));
        assert!(connection.interface_name.is_none());
        assert!(connection.local_ip.is_none());
    }

    #[tokio::test]
    async fn restart_disconnect_reconciles_exact_deterministic_interface() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_wg_config())
            .await
            .unwrap();
        service.connections.get_mut(&id).unwrap().status = WireGuardStatus::Connected;
        let encoded = service.serialize_definitions().unwrap();
        drop(service);

        let restored_state = WireGuardService::new();
        let mut restored = restored_state.lock().await;
        restored.deserialize_definitions(&encoded).unwrap();
        assert!(matches!(
            restored.connections[&id].status,
            WireGuardStatus::Disconnected
        ));

        let reconciled = StdArc::new(StdMutex::new(Vec::new()));
        let recorded = reconciled.clone();
        restored
            .disconnect_with_reconciler(&id, move |interface_name| {
                recorded.lock().unwrap().push(interface_name.to_string());
                Ok(())
            })
            .await
            .unwrap();

        assert_eq!(
            reconciled.lock().unwrap().as_slice(),
            [deterministic_wireguard_interface_name(&id).unwrap()]
        );
        let connection = restored.get_connection(&id).await.unwrap();
        assert!(matches!(connection.status, WireGuardStatus::Disconnected));
        assert!(connection.interface_name.is_none());
        assert!(connection.connected_at.is_none());
    }

    #[tokio::test]
    async fn restart_delete_reconciles_before_removing_profile() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_wg_config())
            .await
            .unwrap();
        let encoded = service.serialize_definitions().unwrap();
        drop(service);

        let restored_state = WireGuardService::new();
        let mut restored = restored_state.lock().await;
        restored.deserialize_definitions(&encoded).unwrap();
        let reconciled = StdArc::new(StdMutex::new(Vec::new()));
        let recorded = reconciled.clone();
        restored
            .delete_connection_with_reconciler(&id, move |interface_name| {
                recorded.lock().unwrap().push(interface_name.to_string());
                Ok(())
            })
            .await
            .unwrap();

        assert_eq!(
            reconciled.lock().unwrap().as_slice(),
            [deterministic_wireguard_interface_name(&id).unwrap()]
        );
        assert!(!restored.connections.contains_key(&id));
    }

    #[tokio::test]
    async fn delete_teardown_failure_preserves_profile_and_can_be_retried() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_wg_config())
            .await
            .unwrap();
        let expected_interface = deterministic_wireguard_interface_name(&id).unwrap();

        let error = service
            .delete_connection_with_reconciler(&id, |_| {
                Err("injected stale teardown failure".to_string())
            })
            .await
            .unwrap_err();
        assert!(error.contains("injected stale teardown failure"));
        let retained = service.get_connection(&id).await.unwrap();
        assert!(matches!(retained.status, WireGuardStatus::Error(_)));
        assert_eq!(
            retained.interface_name.as_deref(),
            Some(expected_interface.as_str())
        );

        service
            .delete_connection_with_reconciler(&id, |interface_name| {
                assert_eq!(interface_name, expected_interface);
                Ok(())
            })
            .await
            .unwrap();
        assert!(!service.connections.contains_key(&id));
    }

    #[tokio::test]
    async fn restart_disconnect_never_cleans_custom_interface_name() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Custom".to_string(), default_wg_config())
            .await
            .unwrap();
        service
            .connections
            .get_mut(&id)
            .unwrap()
            .config
            .interface_name = Some("company-wg0".to_string());
        let encoded = service.serialize_definitions().unwrap();
        drop(service);

        let restored_state = WireGuardService::new();
        let mut restored = restored_state.lock().await;
        restored.deserialize_definitions(&encoded).unwrap();
        let calls = StdArc::new(StdMutex::new(0usize));
        let called = calls.clone();
        restored
            .disconnect_with_reconciler(&id, move |_| {
                *called.lock().unwrap() += 1;
                Ok(())
            })
            .await
            .unwrap();

        assert_eq!(*calls.lock().unwrap(), 0);
        assert!(matches!(
            restored.connections[&id].status,
            WireGuardStatus::Disconnected
        ));
    }

    #[tokio::test]
    async fn persisted_legacy_profile_without_addresses_restores_safely() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Legacy".to_string(), default_wg_config())
            .await
            .unwrap();
        let encoded = service.serialize_definitions().unwrap();
        let mut envelope: serde_json::Value = serde_json::from_str(&encoded).unwrap();
        envelope["connections"][0]["config"]
            .as_object_mut()
            .unwrap()
            .remove("addresses");
        let legacy = serde_json::to_string(&envelope).unwrap();
        drop(service);

        let restored_state = WireGuardService::new();
        let mut restored = restored_state.lock().await;
        restored.deserialize_definitions(&legacy).unwrap();
        let connection = restored.get_connection(&id).await.unwrap();
        assert!(connection.config.addresses.is_empty());
        assert_eq!(connection.config.allowed_ips, vec!["0.0.0.0/0"]);
    }

    #[tokio::test]
    async fn corrupt_profile_data_does_not_replace_live_definitions() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_wg_config())
            .await
            .unwrap();
        assert!(service.deserialize_definitions("not-json").is_err());
        assert!(service.connections.contains_key(&id));
    }

    #[test]
    fn ipc_view_redacts_wireguard_keys_and_reports_presence() {
        let mut config = default_wg_config();
        config.preshared_key = Some(TEST_PRESHARED_KEY.to_string());
        let view = WireGuardConnection {
            id: "profile".to_string(),
            name: "Office".to_string(),
            config,
            status: WireGuardStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            interface_name: None,
            local_ip: None,
            peer_ip: None,
            process_id: None,
        }
        .into_redacted_view();

        let json = serde_json::to_string(&view).unwrap();
        assert!(!json.contains(TEST_PRIVATE_KEY));
        assert!(!json.contains(TEST_PRESHARED_KEY));
        assert_eq!(
            view.secret_presence,
            WireGuardSecretPresence {
                private_key: true,
                preshared_key: true,
            }
        );
    }

    #[tokio::test]
    async fn ipc_update_preserves_replaces_and_explicitly_clears_wireguard_secrets() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let mut config = default_wg_config();
        config.preshared_key = Some(TEST_PRESHARED_KEY.to_string());
        let id = service
            .create_connection("Office".to_string(), config)
            .await
            .unwrap();

        let mut omitted = default_wg_config();
        omitted.private_key = None;
        omitted.preshared_key = None;
        service
            .update_connection_from_ipc(
                &id,
                None,
                Some(omitted),
                WireGuardSecretMutation::default(),
            )
            .await
            .unwrap();
        assert_eq!(
            service.connections[&id].config.private_key.as_deref(),
            Some(TEST_PRIVATE_KEY)
        );
        assert_eq!(
            service.connections[&id].config.preshared_key.as_deref(),
            Some(TEST_PRESHARED_KEY)
        );

        let replacement_key = "3333333333333333333333333333333333333333333333333333333333333333";
        let mut replacement = default_wg_config();
        replacement.preshared_key = Some(replacement_key.to_string());
        service
            .update_connection_from_ipc(
                &id,
                None,
                Some(replacement),
                WireGuardSecretMutation::default(),
            )
            .await
            .unwrap();
        assert_eq!(
            service.connections[&id].config.preshared_key.as_deref(),
            Some(replacement_key)
        );

        service
            .update_connection_from_ipc(
                &id,
                None,
                None,
                WireGuardSecretMutation {
                    clear_preshared_key: true,
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(service.connections[&id].config.preshared_key.is_none());
    }

    #[tokio::test]
    async fn ipc_update_can_explicitly_clear_private_key_but_connect_validation_stays_strict() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let id = service
            .create_connection("Office".to_string(), default_wg_config())
            .await
            .unwrap();

        service
            .update_connection_from_ipc(
                &id,
                None,
                None,
                WireGuardSecretMutation {
                    clear_private_key: true,
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let stored = &service.connections[&id].config;
        assert!(stored.private_key.is_none());
        let error = resolve_wireguard_config(stored).await.unwrap_err();
        assert!(error.contains("private key is required"));
    }

    #[tokio::test]
    async fn create_still_rejects_a_missing_wireguard_private_key() {
        let state = WireGuardService::new();
        let mut service = state.lock().await;
        let mut config = default_wg_config();
        config.private_key = None;
        let error = service
            .create_connection("Invalid".to_string(), config)
            .await
            .unwrap_err();
        assert!(error.contains("private key is required"));
    }
}
