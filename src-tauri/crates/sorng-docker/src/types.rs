// ── sorng-docker/src/types.rs ─────────────────────────────────────────────────
//! Comprehensive Docker daemon types.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

/// How to connect to the Docker daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerConnectionConfig {
    /// User-chosen identifier for this connection.
    pub name: String,
    /// Connection endpoint.
    pub endpoint: DockerEndpoint,
    /// TLS configuration (for tcp:// with TLS).
    #[serde(default)]
    pub tls: Option<DockerTlsConfig>,
    /// Request timeout in seconds.
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    /// SSH configuration for ssh:// endpoints.
    #[serde(default)]
    pub ssh: Option<DockerSshConfig>,
}

/// Endpoint variants.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DockerEndpoint {
    /// Unix socket, e.g. `/var/run/docker.sock`.
    #[serde(rename_all = "camelCase")]
    Unix { path: String },
    /// Named pipe on Windows, e.g. `//./pipe/docker_engine`.
    #[serde(rename_all = "camelCase")]
    NamedPipe { path: String },
    /// TCP endpoint, e.g. `tcp://192.168.1.10:2376`.
    #[serde(rename_all = "camelCase")]
    Tcp { host: String, port: u16 },
    /// SSH tunnel, e.g. `ssh://user@host`.
    #[serde(rename_all = "camelCase")]
    Ssh {
        host: String,
        port: Option<u16>,
        user: Option<String>,
    },
}

/// TLS configuration for remote Docker daemons.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerTlsConfig {
    pub ca_cert_path: Option<String>,
    pub client_cert_path: Option<String>,
    pub client_key_path: Option<String>,
    pub ca_cert_pem: Option<String>,
    pub client_cert_pem: Option<String>,
    pub client_key_pem: Option<String>,
    #[serde(default)]
    pub verify: bool,
}

/// SSH config for ssh:// Docker endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerSshConfig {
    pub identity_file: Option<String>,
    pub passphrase: Option<String>,
    pub password: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// System / Info
// ═══════════════════════════════════════════════════════════════════════════════

/// Docker system information (`docker info`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerSystemInfo {
    pub id: Option<String>,
    pub name: Option<String>,
    pub server_version: Option<String>,
    pub api_version: Option<String>,
    pub os: Option<String>,
    pub arch: Option<String>,
    pub kernel_version: Option<String>,
    pub total_memory: Option<i64>,
    pub cpus: Option<i32>,
    pub containers: Option<i32>,
    pub containers_running: Option<i32>,
    pub containers_paused: Option<i32>,
    pub containers_stopped: Option<i32>,
    pub images: Option<i32>,
    pub storage_driver: Option<String>,
    pub docker_root_dir: Option<String>,
    pub operating_system: Option<String>,
    pub runtime_default: Option<String>,
    pub swarm_active: Option<bool>,
    pub live_restore_enabled: Option<bool>,
}

/// Docker version info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerVersionInfo {
    pub version: Option<String>,
    pub api_version: Option<String>,
    pub min_api_version: Option<String>,
    pub git_commit: Option<String>,
    pub go_version: Option<String>,
    pub os: Option<String>,
    pub arch: Option<String>,
    pub build_time: Option<String>,
}

/// Disk usage summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerDiskUsage {
    pub images_count: i32,
    pub images_size: i64,
    pub containers_count: i32,
    pub containers_size: i64,
    pub volumes_count: i32,
    pub volumes_size: i64,
    pub build_cache_size: i64,
    pub total_size: i64,
}

/// Prune result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneResult {
    pub deleted_items: Vec<String>,
    pub space_reclaimed: i64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Containers
// ═══════════════════════════════════════════════════════════════════════════════

/// Container summary (list view).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerSummary {
    pub id: String,
    pub names: Vec<String>,
    pub image: String,
    pub image_id: String,
    pub command: Option<String>,
    pub created: Option<String>,
    pub state: ContainerState,
    pub status: Option<String>,
    pub ports: Vec<PortBinding>,
    pub labels: HashMap<String, String>,
    pub size_rw: Option<i64>,
    pub size_root_fs: Option<i64>,
    pub network_mode: Option<String>,
    pub mounts: Vec<MountPoint>,
}

/// Container detailed inspect.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerInspect {
    pub id: String,
    pub name: String,
    pub image: String,
    pub created: Option<String>,
    pub path: Option<String>,
    pub args: Vec<String>,
    pub state: ContainerStateDetail,
    pub config: ContainerConfig,
    pub host_config: HostConfig,
    pub network_settings: NetworkSettings,
    pub mounts: Vec<MountPoint>,
    pub restart_count: Option<i32>,
    pub platform: Option<String>,
}

/// Container running state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ContainerState {
    Created,
    Running,
    Paused,
    Restarting,
    Removing,
    Exited,
    Dead,
}

/// Detailed container state (from inspect).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerStateDetail {
    pub status: ContainerState,
    pub running: bool,
    pub paused: bool,
    pub restarting: bool,
    pub oom_killed: bool,
    pub dead: bool,
    pub pid: Option<i64>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub health: Option<HealthStatus>,
}

/// Health check status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthStatus {
    pub status: String,
    pub failing_streak: Option<i32>,
    pub log: Vec<HealthLogEntry>,
}

/// Single health check log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthLogEntry {
    pub start: Option<String>,
    pub end: Option<String>,
    pub exit_code: Option<i32>,
    pub output: Option<String>,
}

/// Container configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerConfig {
    pub hostname: Option<String>,
    pub domainname: Option<String>,
    pub user: Option<String>,
    pub env: Vec<String>,
    pub cmd: Vec<String>,
    pub entrypoint: Vec<String>,
    pub image: Option<String>,
    pub working_dir: Option<String>,
    pub labels: HashMap<String, String>,
    pub exposed_ports: HashMap<String, serde_json::Value>,
    pub volumes: HashMap<String, serde_json::Value>,
    pub stop_signal: Option<String>,
    pub stop_timeout: Option<i32>,
    pub health_check: Option<HealthCheckConfig>,
    pub tty: Option<bool>,
    pub open_stdin: Option<bool>,
    pub attach_stdin: Option<bool>,
    pub attach_stdout: Option<bool>,
    pub attach_stderr: Option<bool>,
}

/// Health check configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckConfig {
    pub test: Vec<String>,
    pub interval: Option<i64>,
    pub timeout: Option<i64>,
    pub retries: Option<i32>,
    pub start_period: Option<i64>,
    pub start_interval: Option<i64>,
}

/// Host config (resources, mounts, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostConfig {
    pub cpu_shares: Option<i64>,
    pub memory: Option<i64>,
    pub memory_swap: Option<i64>,
    pub memory_reservation: Option<i64>,
    pub nano_cpus: Option<i64>,
    pub cpu_period: Option<i64>,
    pub cpu_quota: Option<i64>,
    pub cpuset_cpus: Option<String>,
    pub cpuset_mems: Option<String>,
    pub oom_kill_disable: Option<bool>,
    pub pid_mode: Option<String>,
    pub ipc_mode: Option<String>,
    pub uts_mode: Option<String>,
    pub network_mode: Option<String>,
    pub privileged: Option<bool>,
    pub read_only_rootfs: Option<bool>,
    pub auto_remove: Option<bool>,
    pub restart_policy: Option<RestartPolicy>,
    pub port_bindings: HashMap<String, Vec<HostPortBinding>>,
    pub binds: Vec<String>,
    pub tmpfs: HashMap<String, String>,
    pub dns: Vec<String>,
    pub dns_search: Vec<String>,
    pub extra_hosts: Vec<String>,
    pub cap_add: Vec<String>,
    pub cap_drop: Vec<String>,
    pub security_opt: Vec<String>,
    pub devices: Vec<DeviceMapping>,
    pub log_config: Option<LogConfig>,
    pub runtime: Option<String>,
    pub shm_size: Option<i64>,
    pub sysctls: HashMap<String, String>,
    pub ulimits: Vec<Ulimit>,
}

/// Restart policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestartPolicy {
    pub name: RestartPolicyType,
    pub maximum_retry_count: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RestartPolicyType {
    #[serde(rename = "")]
    None,
    #[serde(rename = "always")]
    Always,
    #[serde(rename = "unless-stopped")]
    UnlessStopped,
    #[serde(rename = "on-failure")]
    OnFailure,
}

/// Device mapping.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceMapping {
    pub path_on_host: String,
    pub path_in_container: String,
    pub cgroup_permissions: Option<String>,
}

/// Log configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogConfig {
    #[serde(rename = "type")]
    pub log_type: String,
    pub config: HashMap<String, String>,
}

/// Ulimit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ulimit {
    pub name: String,
    pub soft: i64,
    pub hard: i64,
}

/// Port binding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortBinding {
    pub container_port: u16,
    pub protocol: String,
    pub host_ip: Option<String>,
    pub host_port: Option<u16>,
}

/// Host port binding (for host config).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostPortBinding {
    pub host_ip: Option<String>,
    pub host_port: Option<String>,
}

/// Mount point.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MountPoint {
    #[serde(rename = "type")]
    pub mount_type: Option<String>,
    pub name: Option<String>,
    pub source: Option<String>,
    pub destination: Option<String>,
    pub driver: Option<String>,
    pub mode: Option<String>,
    pub rw: Option<bool>,
    pub propagation: Option<String>,
}

/// Network settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    pub bridge: Option<String>,
    pub gateway: Option<String>,
    pub ip_address: Option<String>,
    pub ip_prefix_len: Option<i32>,
    pub mac_address: Option<String>,
    pub networks: HashMap<String, ContainerNetwork>,
    pub ports: HashMap<String, Option<Vec<HostPortBinding>>>,
}

/// Container network attachment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerNetwork {
    pub network_id: Option<String>,
    pub endpoint_id: Option<String>,
    pub gateway: Option<String>,
    pub ip_address: Option<String>,
    pub ip_prefix_len: Option<i32>,
    pub ipv6_gateway: Option<String>,
    pub global_ipv6_address: Option<String>,
    pub mac_address: Option<String>,
    pub aliases: Option<Vec<String>>,
}

/// Create container request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateContainerConfig {
    pub name: Option<String>,
    pub image: String,
    pub cmd: Option<Vec<String>>,
    pub entrypoint: Option<Vec<String>>,
    pub env: Option<Vec<String>>,
    pub working_dir: Option<String>,
    pub user: Option<String>,
    pub hostname: Option<String>,
    pub domainname: Option<String>,
    pub labels: Option<HashMap<String, String>>,
    pub exposed_ports: Option<HashMap<String, serde_json::Value>>,
    pub volumes: Option<HashMap<String, serde_json::Value>>,
    pub tty: Option<bool>,
    pub open_stdin: Option<bool>,
    pub attach_stdin: Option<bool>,
    pub attach_stdout: Option<bool>,
    pub attach_stderr: Option<bool>,
    pub stop_signal: Option<String>,
    pub stop_timeout: Option<i32>,
    pub health_check: Option<HealthCheckConfig>,
    // HostConfig fields flattened for convenience
    pub port_bindings: Option<HashMap<String, Vec<HostPortBinding>>>,
    pub binds: Option<Vec<String>>,
    pub network_mode: Option<String>,
    pub restart_policy: Option<RestartPolicy>,
    pub memory: Option<i64>,
    pub memory_swap: Option<i64>,
    pub nano_cpus: Option<i64>,
    pub cpu_shares: Option<i64>,
    pub privileged: Option<bool>,
    pub read_only_rootfs: Option<bool>,
    pub auto_remove: Option<bool>,
    pub cap_add: Option<Vec<String>>,
    pub cap_drop: Option<Vec<String>>,
    pub security_opt: Option<Vec<String>>,
    pub dns: Option<Vec<String>>,
    pub extra_hosts: Option<Vec<String>>,
    pub tmpfs: Option<HashMap<String, String>>,
    pub devices: Option<Vec<DeviceMapping>>,
    pub log_config: Option<LogConfig>,
    pub runtime: Option<String>,
    pub shm_size: Option<i64>,
    pub sysctls: Option<HashMap<String, String>>,
    pub ulimits: Option<Vec<Ulimit>>,
    pub init: Option<bool>,
}

/// Create container response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateContainerResponse {
    pub id: String,
    pub warnings: Vec<String>,
}

/// Container log options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContainerLogOptions {
    pub follow: Option<bool>,
    pub stdout: Option<bool>,
    pub stderr: Option<bool>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub timestamps: Option<bool>,
    pub tail: Option<String>,
}

/// Container exec configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecConfig {
    pub cmd: Vec<String>,
    pub attach_stdin: Option<bool>,
    pub attach_stdout: Option<bool>,
    pub attach_stderr: Option<bool>,
    pub tty: Option<bool>,
    pub env: Option<Vec<String>>,
    pub working_dir: Option<String>,
    pub user: Option<String>,
    pub privileged: Option<bool>,
}

/// Exec creation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecCreateResponse {
    pub id: String,
}

/// Exec inspect result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecInspect {
    pub id: String,
    pub running: bool,
    pub exit_code: Option<i32>,
    pub pid: Option<i64>,
}

/// Container stats snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerStats {
    pub container_id: String,
    pub name: String,
    pub cpu_percent: f64,
    pub memory_usage: i64,
    pub memory_limit: i64,
    pub memory_percent: f64,
    pub network_rx_bytes: i64,
    pub network_tx_bytes: i64,
    pub block_read_bytes: i64,
    pub block_write_bytes: i64,
    pub pids: i64,
    pub timestamp: String,
}

/// Container filesystem changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerChange {
    pub path: String,
    pub kind: i32, // 0=Modified, 1=Added, 2=Deleted
}

/// Container top (process list) result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerTop {
    pub titles: Vec<String>,
    pub processes: Vec<Vec<String>>,
}

/// Wait result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerWaitResult {
    pub status_code: i64,
    pub error: Option<String>,
}

/// List containers options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListContainersOptions {
    pub all: Option<bool>,
    pub limit: Option<i32>,
    pub size: Option<bool>,
    pub filters: Option<HashMap<String, Vec<String>>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Images
// ═══════════════════════════════════════════════════════════════════════════════

/// Image summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSummary {
    pub id: String,
    pub repo_tags: Vec<String>,
    pub repo_digests: Vec<String>,
    pub created: Option<String>,
    pub size: i64,
    pub virtual_size: Option<i64>,
    pub shared_size: Option<i64>,
    pub labels: HashMap<String, String>,
    pub containers: Option<i64>,
}

/// Image detailed inspect.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInspect {
    pub id: String,
    pub repo_tags: Vec<String>,
    pub repo_digests: Vec<String>,
    pub created: Option<String>,
    pub size: i64,
    pub virtual_size: Option<i64>,
    pub architecture: Option<String>,
    pub os: Option<String>,
    pub author: Option<String>,
    pub comment: Option<String>,
    pub docker_version: Option<String>,
    pub config: Option<ImageConfig>,
    pub rootfs: Option<ImageRootFs>,
}

/// Image config (from inspect).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageConfig {
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub env: Vec<String>,
    pub cmd: Vec<String>,
    pub entrypoint: Vec<String>,
    pub working_dir: Option<String>,
    pub labels: HashMap<String, String>,
    pub exposed_ports: HashMap<String, serde_json::Value>,
    pub volumes: HashMap<String, serde_json::Value>,
    pub stop_signal: Option<String>,
}

/// Image rootfs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageRootFs {
    #[serde(rename = "type")]
    pub rootfs_type: String,
    pub layers: Vec<String>,
}

/// Image history entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageHistoryEntry {
    pub id: Option<String>,
    pub created: Option<i64>,
    pub created_by: Option<String>,
    pub size: i64,
    pub comment: Option<String>,
    pub tags: Vec<String>,
}

/// Pull progress event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    pub status: String,
    pub id: Option<String>,
    pub progress: Option<String>,
    pub progress_detail: Option<ProgressDetail>,
    pub error: Option<String>,
}

/// Progress detail.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressDetail {
    pub current: Option<i64>,
    pub total: Option<i64>,
}

/// Image build configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildConfig {
    pub dockerfile: Option<String>,
    pub tags: Vec<String>,
    pub build_args: HashMap<String, String>,
    pub labels: HashMap<String, String>,
    pub target: Option<String>,
    pub no_cache: Option<bool>,
    pub pull: Option<bool>,
    pub rm: Option<bool>,
    pub force_rm: Option<bool>,
    pub memory: Option<i64>,
    pub cpu_shares: Option<i64>,
    pub cpu_period: Option<i64>,
    pub cpu_quota: Option<i64>,
    pub platform: Option<String>,
    pub extra_hosts: Option<Vec<String>>,
    pub network_mode: Option<String>,
    pub squash: Option<bool>,
}

/// Build output stream event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildOutput {
    pub stream: Option<String>,
    pub error: Option<String>,
    pub error_detail: Option<BuildErrorDetail>,
    pub aux: Option<serde_json::Value>,
}

/// Build error detail.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildErrorDetail {
    pub message: Option<String>,
    pub code: Option<i32>,
}

/// List images options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListImagesOptions {
    pub all: Option<bool>,
    pub digests: Option<bool>,
    pub filters: Option<HashMap<String, Vec<String>>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Volumes
// ═══════════════════════════════════════════════════════════════════════════════

/// Volume info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub created_at: Option<String>,
    pub labels: HashMap<String, String>,
    pub scope: Option<String>,
    pub options: Option<HashMap<String, String>>,
    pub usage_data: Option<VolumeUsage>,
}

/// Volume usage.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeUsage {
    pub size: i64,
    pub ref_count: i64,
}

/// Create volume configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVolumeConfig {
    pub name: Option<String>,
    pub driver: Option<String>,
    pub driver_opts: Option<HashMap<String, String>>,
    pub labels: Option<HashMap<String, String>>,
}

/// List volumes options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListVolumesOptions {
    pub filters: Option<HashMap<String, Vec<String>>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Networks
// ═══════════════════════════════════════════════════════════════════════════════

/// Network info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub internal: bool,
    pub attachable: bool,
    pub ingress: bool,
    pub enable_ipv6: bool,
    pub created: Option<String>,
    pub labels: HashMap<String, String>,
    pub options: HashMap<String, String>,
    pub ipam: Option<IpamConfig>,
    pub containers: HashMap<String, NetworkContainer>,
}

/// IPAM configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpamConfig {
    pub driver: Option<String>,
    pub config: Vec<IpamPoolConfig>,
    pub options: Option<HashMap<String, String>>,
}

/// IPAM pool configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpamPoolConfig {
    pub subnet: Option<String>,
    pub gateway: Option<String>,
    pub ip_range: Option<String>,
    pub aux_addresses: Option<HashMap<String, String>>,
}

/// Container attached to a network.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkContainer {
    pub name: Option<String>,
    pub endpoint_id: Option<String>,
    pub mac_address: Option<String>,
    pub ipv4_address: Option<String>,
    pub ipv6_address: Option<String>,
}

/// Create network configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNetworkConfig {
    pub name: String,
    pub driver: Option<String>,
    pub internal: Option<bool>,
    pub attachable: Option<bool>,
    pub ingress: Option<bool>,
    pub enable_ipv6: Option<bool>,
    pub ipam: Option<IpamConfig>,
    pub labels: Option<HashMap<String, String>>,
    pub options: Option<HashMap<String, String>>,
}

/// Create network response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNetworkResponse {
    pub id: String,
    pub warning: Option<String>,
}

/// Connect container to network config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectNetworkConfig {
    pub container: String,
    pub endpoint_config: Option<EndpointConfig>,
}

/// Endpoint configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointConfig {
    pub ipam_config: Option<EndpointIpamConfig>,
    pub aliases: Option<Vec<String>>,
    pub links: Option<Vec<String>>,
}

/// Endpoint IPAM config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointIpamConfig {
    pub ipv4_address: Option<String>,
    pub ipv6_address: Option<String>,
}

/// List networks options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListNetworksOptions {
    pub filters: Option<HashMap<String, Vec<String>>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Docker Compose
// ═══════════════════════════════════════════════════════════════════════════════

/// Compose project info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeProject {
    pub name: String,
    pub status: String,
    pub config_files: Vec<String>,
    pub services: Vec<ComposeService>,
}

/// Compose service info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeService {
    pub name: String,
    pub image: Option<String>,
    pub status: Option<String>,
    pub running: i32,
    pub desired: i32,
    pub ports: Vec<String>,
    pub container_ids: Vec<String>,
}

/// Compose up options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeUpConfig {
    pub project_name: Option<String>,
    pub files: Vec<String>,
    pub services: Option<Vec<String>>,
    pub detach: Option<bool>,
    pub build: Option<bool>,
    pub force_recreate: Option<bool>,
    pub no_recreate: Option<bool>,
    pub remove_orphans: Option<bool>,
    pub timeout: Option<i32>,
    pub scale: Option<HashMap<String, i32>>,
    pub env_file: Option<Vec<String>>,
    pub profiles: Option<Vec<String>>,
    pub no_deps: Option<bool>,
    pub pull: Option<String>,
    pub quiet_pull: Option<bool>,
    pub wait: Option<bool>,
}

/// Compose down options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeDownConfig {
    pub project_name: Option<String>,
    pub files: Vec<String>,
    pub remove_orphans: Option<bool>,
    pub volumes: Option<bool>,
    pub images: Option<String>,
    pub timeout: Option<i32>,
}

/// Compose logs options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeLogsConfig {
    pub project_name: Option<String>,
    pub files: Vec<String>,
    pub services: Option<Vec<String>>,
    pub follow: Option<bool>,
    pub tail: Option<String>,
    pub timestamps: Option<bool>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub no_color: Option<bool>,
}

/// Compose build options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeBuildConfig {
    pub project_name: Option<String>,
    pub files: Vec<String>,
    pub services: Option<Vec<String>>,
    pub no_cache: Option<bool>,
    pub pull: Option<bool>,
    pub build_args: Option<HashMap<String, String>>,
    pub progress: Option<String>,
    pub quiet: Option<bool>,
}

/// Compose pull options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposePullConfig {
    pub project_name: Option<String>,
    pub files: Vec<String>,
    pub services: Option<Vec<String>>,
    pub quiet: Option<bool>,
    pub ignore_pull_failures: Option<bool>,
    pub include_deps: Option<bool>,
}

/// Compose ps item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposePsItem {
    pub id: String,
    pub name: String,
    pub service: String,
    pub state: String,
    pub health: Option<String>,
    pub ports: Vec<String>,
    pub image: Option<String>,
    pub command: Option<String>,
    pub created_at: Option<String>,
    pub exit_code: Option<i32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════════════════════

/// Registry credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryCredentials {
    pub server_address: String,
    pub username: String,
    pub password: String,
    pub email: Option<String>,
}

/// Registry auth result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryAuthResult {
    pub status: String,
    pub identity_token: Option<String>,
}

/// Registry search result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySearchResult {
    pub name: String,
    pub description: Option<String>,
    pub star_count: Option<i64>,
    pub is_official: Option<bool>,
    pub is_automated: Option<bool>,
}

/// Registry catalog.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryCatalog {
    pub repositories: Vec<String>,
}

/// Image tag list for a repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTagList {
    pub name: String,
    pub tags: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════════════

/// Docker daemon event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub action: String,
    pub actor: DockerEventActor,
    pub time: Option<i64>,
    pub time_nano: Option<i64>,
    pub status: Option<String>,
    pub id: Option<String>,
    pub from: Option<String>,
}

/// Docker event actor.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerEventActor {
    pub id: Option<String>,
    pub attributes: HashMap<String, String>,
}

/// Event filter options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DockerEventFilter {
    pub since: Option<String>,
    pub until: Option<String>,
    pub filters: Option<HashMap<String, Vec<String>>>,
}
