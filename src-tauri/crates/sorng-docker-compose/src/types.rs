// ── sorng-docker-compose/src/types.rs ──────────────────────────────────────────
//! Comprehensive Docker Compose types covering compose file models, CLI config
//! structs, runtime state, health, dependency graphs, profiles, and events.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
//  Compose File Model  (mirrors docker-compose spec v3.8 / Compose Spec)
// ═══════════════════════════════════════════════════════════════════════════════

/// Top-level compose file representation.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ComposeFile {
    /// Compose spec version (optional in modern compose).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Compose project name override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Service definitions keyed by service name.
    #[serde(default)]
    pub services: IndexMap<String, ServiceDefinition>,
    /// Named volumes.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub volumes: IndexMap<String, Option<VolumeDefinition>>,
    /// Named networks.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub networks: IndexMap<String, Option<NetworkDefinition>>,
    /// Named secrets.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub secrets: IndexMap<String, Option<SecretDefinition>>,
    /// Named configs.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub configs: IndexMap<String, Option<ConfigDefinition>>,
    /// Extensions (x-* keys).
    #[serde(default, flatten, skip_serializing_if = "HashMap::is_empty")]
    pub extensions: HashMap<String, serde_json::Value>,
}

/// Full service definition from a compose file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ServiceDefinition {
    // ── Image / Build ─────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build: Option<BuildConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pull_policy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,

    // ── Command / Entrypoint ──────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<StringOrList>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entrypoint: Option<StringOrList>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,

    // ── Container identity ────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domainname: Option<String>,

    // ── Networking ────────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ports: Vec<PortMapping>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub expose: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub networks: Option<ServiceNetworks>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_hosts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dns: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dns_search: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dns_opt: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mac_address: Option<String>,

    // ── Volumes / Storage ─────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub volumes: Vec<VolumeMount>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tmpfs: Vec<String>,

    // ── Environment ───────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<EnvMapping>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env_file: Vec<String>,

    // ── Dependencies / Ordering ───────────────────────────────────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<DependsOn>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub external_links: Vec<String>,

    // ── Health check ──────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub healthcheck: Option<HealthcheckConfig>,

    // ── Deploy ────────────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deploy: Option<DeployConfig>,

    // ── Restart ───────────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restart: Option<String>,

    // ── Logging ───────────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logging: Option<LoggingConfig>,

    // ── Resource limits (non-deploy) ──────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mem_limit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mem_reservation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memswap_limit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpus: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_shares: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_quota: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_period: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpuset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shm_size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pids_limit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oom_kill_disable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oom_score_adj: Option<i32>,

    // ── Capabilities / Security ───────────────────────────────────
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cap_add: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cap_drop: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub security_opt: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privileged: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub userns_mode: Option<String>,

    // ── Labels / Annotations ──────────────────────────────────────
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub labels: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub annotations: HashMap<String, String>,

    // ── Secrets & Configs ─────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub secrets: Vec<ServiceSecretRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub configs: Vec<ServiceConfigRef>,

    // ── Process / Exec ────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tty: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdin_open: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub init: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_signal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_grace_period: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ipc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cgroup_parent: Option<String>,

    // ── Devices / Sysctls ─────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub devices: Vec<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub sysctls: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ulimits: Vec<UlimitConfig>,

    // ── Profiles ──────────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub profiles: Vec<String>,

    // ── Misc ──────────────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub isolation: Option<String>,

    /// Extensions (x-* keys).
    #[serde(default, flatten, skip_serializing_if = "HashMap::is_empty")]
    pub extensions: HashMap<String, serde_json::Value>,
}

// ── Supporting sub-types ──────────────────────────────────────────────────────

/// A value that can be a plain string or a list of strings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StringOrList {
    String(String),
    List(Vec<String>),
}

/// Build configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BuildConfig {
    pub context: Option<String>,
    pub dockerfile: Option<String>,
    pub dockerfile_inline: Option<String>,
    #[serde(default)]
    pub args: HashMap<String, String>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    pub target: Option<String>,
    pub network: Option<String>,
    #[serde(default)]
    pub cache_from: Vec<String>,
    #[serde(default)]
    pub cache_to: Vec<String>,
    #[serde(default)]
    pub extra_hosts: Vec<String>,
    pub shm_size: Option<String>,
    #[serde(default)]
    pub ssh: Vec<String>,
    #[serde(default)]
    pub secrets: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub platforms: Vec<String>,
    pub privileged: Option<bool>,
    pub no_cache: Option<bool>,
    pub pull: Option<bool>,
}

/// Port mapping — short or long syntax.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PortMapping {
    Short(String),
    Long(PortMappingLong),
}

/// Long-form port mapping.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PortMappingLong {
    pub target: u16,
    pub published: Option<String>,
    pub host_ip: Option<String>,
    pub protocol: Option<String>,
    pub mode: Option<String>,
}

/// Service-specific network config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ServiceNetworkConfig {
    pub aliases: Option<Vec<String>>,
    pub ipv4_address: Option<String>,
    pub ipv6_address: Option<String>,
    pub link_local_ips: Option<Vec<String>>,
    pub mac_address: Option<String>,
    pub priority: Option<i32>,
}

/// Volume mount — short or long syntax.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum VolumeMount {
    Short(String),
    Long(VolumeMountLong),
}

/// Long-form volume mount.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VolumeMountLong {
    #[serde(rename = "type")]
    pub mount_type: Option<String>,
    pub source: Option<String>,
    pub target: String,
    pub read_only: Option<bool>,
    pub consistency: Option<String>,
    pub bind: Option<BindOptions>,
    pub volume: Option<VolumeOptions>,
    pub tmpfs: Option<TmpfsOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BindOptions {
    pub propagation: Option<String>,
    pub create_host_path: Option<bool>,
    pub selinux: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VolumeOptions {
    pub nocopy: Option<bool>,
    pub subpath: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TmpfsOptions {
    pub size: Option<i64>,
    pub mode: Option<u32>,
}

/// Environment variable mapping.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EnvMapping {
    Map(HashMap<String, serde_json::Value>),
    List(Vec<String>),
}

/// Service networks — can be a simple list of names or a map with config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ServiceNetworks {
    List(Vec<String>),
    Map(HashMap<String, Option<ServiceNetworkConfig>>),
}

impl Default for ServiceNetworks {
    fn default() -> Self {
        ServiceNetworks::List(Vec::new())
    }
}

/// depends_on with optional condition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DependsOn {
    /// Short form: list of service names.
    List(Vec<String>),
    /// Long form: map of service name → condition.
    Map(HashMap<String, DependsOnCondition>),
}

/// Condition for depends_on long form.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DependsOnCondition {
    pub condition: Option<String>,
    pub restart: Option<bool>,
}

/// Healthcheck configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HealthcheckConfig {
    pub test: Option<StringOrList>,
    pub interval: Option<String>,
    pub timeout: Option<String>,
    pub retries: Option<i32>,
    pub start_period: Option<String>,
    pub start_interval: Option<String>,
    pub disable: Option<bool>,
}

/// Deploy configuration (Swarm / Compose).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeployConfig {
    pub mode: Option<String>,
    pub replicas: Option<i32>,
    pub endpoint_mode: Option<String>,
    pub labels: Option<HashMap<String, String>>,
    pub placement: Option<PlacementConfig>,
    pub resources: Option<ResourceConfig>,
    pub restart_policy: Option<RestartPolicyConfig>,
    pub rollback_config: Option<UpdateConfig>,
    pub update_config: Option<UpdateConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlacementConfig {
    pub constraints: Option<Vec<String>>,
    pub preferences: Option<Vec<PlacementPreference>>,
    pub max_replicas_per_node: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlacementPreference {
    pub spread: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ResourceConfig {
    pub limits: Option<ResourceLimits>,
    pub reservations: Option<ResourceLimits>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ResourceLimits {
    pub cpus: Option<String>,
    pub memory: Option<String>,
    pub pids: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RestartPolicyConfig {
    pub condition: Option<String>,
    pub delay: Option<String>,
    pub max_attempts: Option<i32>,
    pub window: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateConfig {
    pub parallelism: Option<i32>,
    pub delay: Option<String>,
    pub failure_action: Option<String>,
    pub monitor: Option<String>,
    pub max_failure_ratio: Option<f64>,
    pub order: Option<String>,
}

/// Logging configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoggingConfig {
    pub driver: Option<String>,
    pub options: Option<HashMap<String, String>>,
}

/// Ulimit configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UlimitConfig {
    Single { name: String, value: i64 },
    Range { name: String, soft: i64, hard: i64 },
}

/// Volume definition at top level.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VolumeDefinition {
    pub driver: Option<String>,
    pub driver_opts: Option<HashMap<String, String>>,
    pub external: Option<ExternalResource>,
    pub labels: Option<HashMap<String, String>>,
    pub name: Option<String>,
}

/// Network definition at top level.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NetworkDefinition {
    pub driver: Option<String>,
    pub driver_opts: Option<HashMap<String, String>>,
    pub external: Option<ExternalResource>,
    pub internal: Option<bool>,
    pub attachable: Option<bool>,
    pub enable_ipv6: Option<bool>,
    pub ipam: Option<IpamConfig>,
    pub labels: Option<HashMap<String, String>>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpamConfig {
    pub driver: Option<String>,
    pub config: Option<Vec<IpamPoolConfig>>,
    pub options: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpamPoolConfig {
    pub subnet: Option<String>,
    pub ip_range: Option<String>,
    pub gateway: Option<String>,
    pub aux_addresses: Option<HashMap<String, String>>,
}

/// Secret definition at top level.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SecretDefinition {
    pub file: Option<String>,
    pub environment: Option<String>,
    pub external: Option<ExternalResource>,
    pub name: Option<String>,
    pub labels: Option<HashMap<String, String>>,
    pub driver: Option<String>,
    pub driver_opts: Option<HashMap<String, String>>,
    pub template_driver: Option<String>,
}

/// Config definition at top level.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConfigDefinition {
    pub file: Option<String>,
    pub environment: Option<String>,
    pub external: Option<ExternalResource>,
    pub name: Option<String>,
    pub labels: Option<HashMap<String, String>>,
    pub template_driver: Option<String>,
    pub content: Option<String>,
}

/// External resource flag.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ExternalResource {
    Bool(bool),
    Named { name: String },
}

/// Service secret reference.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ServiceSecretRef {
    Short(String),
    Long(ServiceSecretRefLong),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ServiceSecretRefLong {
    pub source: String,
    pub target: Option<String>,
    pub uid: Option<String>,
    pub gid: Option<String>,
    pub mode: Option<u32>,
}

/// Service config reference.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ServiceConfigRef {
    Short(String),
    Long(ServiceConfigRefLong),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ServiceConfigRefLong {
    pub source: String,
    pub target: Option<String>,
    pub uid: Option<String>,
    pub gid: Option<String>,
    pub mode: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLI Config types (parameters for compose commands)
// ═══════════════════════════════════════════════════════════════════════════════

/// Global compose CLI options shared across commands.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeGlobalOptions {
    /// Compose file paths (-f).
    #[serde(default)]
    pub files: Vec<String>,
    /// Project name override (-p).
    pub project_name: Option<String>,
    /// Project directory (--project-directory).
    pub project_directory: Option<String>,
    /// Active profiles (--profile).
    #[serde(default)]
    pub profiles: Vec<String>,
    /// Environment files (--env-file).
    #[serde(default)]
    pub env_files: Vec<String>,
    /// Progress output type (--progress).
    pub progress: Option<String>,
    /// Compose file resolution compatibility (--compatibility).
    pub compatibility: Option<bool>,
    /// Dry run mode (--dry-run).
    pub dry_run: Option<bool>,
    /// Custom working directory to run the command from.
    pub working_directory: Option<String>,
}

/// `docker compose up` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeUpConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
    pub detach: Option<bool>,
    pub build: Option<bool>,
    pub force_recreate: Option<bool>,
    pub no_recreate: Option<bool>,
    pub remove_orphans: Option<bool>,
    pub timeout: Option<i32>,
    pub scale: Option<HashMap<String, i32>>,
    pub no_deps: Option<bool>,
    pub pull: Option<String>,
    pub quiet_pull: Option<bool>,
    pub wait: Option<bool>,
    pub wait_timeout: Option<i32>,
    pub no_build: Option<bool>,
    pub no_start: Option<bool>,
    pub no_log_prefix: Option<bool>,
    pub abort_on_container_exit: Option<bool>,
    pub attach_dependencies: Option<bool>,
    pub always_recreate_deps: Option<bool>,
    pub renew_anon_volumes: Option<bool>,
    pub timestamps: Option<bool>,
    pub exit_code_from: Option<String>,
}

/// `docker compose down` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeDownConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub remove_orphans: Option<bool>,
    pub volumes: Option<bool>,
    pub images: Option<String>,
    pub timeout: Option<i32>,
}

/// `docker compose ps` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposePsConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
    pub all: Option<bool>,
    pub status: Option<Vec<String>>,
    pub filter: Option<String>,
    pub orphans: Option<bool>,
    pub no_trunc: Option<bool>,
}

/// `docker compose logs` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeLogsConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
    pub follow: Option<bool>,
    pub tail: Option<String>,
    pub timestamps: Option<bool>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub no_color: Option<bool>,
    pub no_log_prefix: Option<bool>,
}

/// `docker compose build` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeBuildConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
    pub no_cache: Option<bool>,
    pub pull: Option<bool>,
    pub build_args: Option<HashMap<String, String>>,
    pub progress_output: Option<String>,
    pub quiet: Option<bool>,
    pub ssh: Option<String>,
    pub with_dependencies: Option<bool>,
    pub memory: Option<String>,
}

/// `docker compose pull` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposePullConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
    pub quiet: Option<bool>,
    pub ignore_pull_failures: Option<bool>,
    pub include_deps: Option<bool>,
    pub no_parallel: Option<bool>,
    pub policy: Option<String>,
}

/// `docker compose push` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposePushConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
    pub ignore_push_failures: Option<bool>,
    pub include_deps: Option<bool>,
    pub quiet: Option<bool>,
}

/// `docker compose run` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeRunConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub service: String,
    pub command: Option<Vec<String>>,
    pub detach: Option<bool>,
    pub name: Option<String>,
    pub entrypoint: Option<String>,
    pub environment: Option<HashMap<String, String>>,
    pub labels: Option<HashMap<String, String>>,
    pub user: Option<String>,
    pub workdir: Option<String>,
    pub volumes: Option<Vec<String>>,
    pub publish: Option<Vec<String>>,
    pub no_deps: Option<bool>,
    pub rm: Option<bool>,
    pub service_ports: Option<bool>,
    pub use_aliases: Option<bool>,
    pub interactive: Option<bool>,
    pub tty: Option<bool>,
    pub build: Option<bool>,
    pub quiet_pull: Option<bool>,
    pub remove_orphans: Option<bool>,
    pub cap_add: Option<Vec<String>>,
    pub cap_drop: Option<Vec<String>>,
}

/// `docker compose exec` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeExecConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub service: String,
    pub command: Vec<String>,
    pub detach: Option<bool>,
    pub privileged: Option<bool>,
    pub user: Option<String>,
    pub workdir: Option<String>,
    pub environment: Option<HashMap<String, String>>,
    pub index: Option<i32>,
    pub interactive: Option<bool>,
    pub tty: Option<bool>,
}

/// `docker compose create` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeCreateConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
    pub build: Option<bool>,
    pub force_recreate: Option<bool>,
    pub no_recreate: Option<bool>,
    pub no_build: Option<bool>,
    pub pull: Option<String>,
    pub remove_orphans: Option<bool>,
    pub scale: Option<HashMap<String, i32>>,
}

/// Simple service command config (for stop, start, restart, pause, unpause, kill).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeServiceActionConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
    pub timeout: Option<i32>,
    pub signal: Option<String>,
}

/// `docker compose rm` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeRmConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
    pub force: Option<bool>,
    pub stop: Option<bool>,
    pub volumes: Option<bool>,
}

/// `docker compose cp` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeCpConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub service: String,
    pub source: String,
    pub destination: String,
    pub index: Option<i32>,
    pub follow_link: Option<bool>,
    pub archive: Option<bool>,
}

/// `docker compose top` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeTopConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
}

/// `docker compose port` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposePortConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub service: String,
    pub private_port: u16,
    pub protocol: Option<String>,
    pub index: Option<i32>,
}

/// `docker compose images` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeImagesConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
    pub quiet: Option<bool>,
}

/// `docker compose convert / config` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeConvertConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub format: Option<String>,
    pub resolve_image_digests: Option<bool>,
    pub no_interpolate: Option<bool>,
    pub no_normalize: Option<bool>,
    pub no_path_resolution: Option<bool>,
    pub services: Option<bool>,
    pub volumes_flag: Option<bool>,
    pub hash: Option<String>,
    pub images: Option<bool>,
    pub quiet: Option<bool>,
    pub output: Option<String>,
}

/// `docker compose events` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeEventsConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
    pub json: Option<bool>,
}

/// `docker compose watch` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeWatchConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub services: Option<Vec<String>>,
    pub no_up: Option<bool>,
    pub quiet: Option<bool>,
    pub prune: Option<bool>,
}

/// `docker compose alpha` / `docker compose scale` config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposeScaleConfig {
    #[serde(flatten)]
    pub global: ComposeGlobalOptions,
    pub scale: HashMap<String, i32>,
    pub no_deps: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Output / Response types
// ═══════════════════════════════════════════════════════════════════════════════

/// Compose project listing entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeProject {
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub config_files: String,
}

/// Compose ps item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ComposePsItem {
    #[serde(alias = "ID", alias = "id")]
    pub id: String,
    #[serde(alias = "name")]
    pub name: String,
    #[serde(alias = "service")]
    pub service: String,
    #[serde(alias = "state")]
    pub state: String,
    #[serde(alias = "health", default)]
    pub health: Option<String>,
    #[serde(alias = "status", default)]
    pub status: Option<String>,
    #[serde(alias = "ports", default)]
    pub ports: Option<String>,
    #[serde(alias = "image", default)]
    pub image: Option<String>,
    #[serde(alias = "command", default)]
    pub command: Option<String>,
    #[serde(alias = "createdAt", alias = "created_at", default)]
    pub created_at: Option<String>,
    #[serde(alias = "exitCode", alias = "exit_code", default)]
    pub exit_code: Option<i32>,
    #[serde(alias = "publishers", default)]
    pub publishers: Option<Vec<PortPublisher>>,
    #[serde(alias = "labels", default)]
    pub labels: Option<String>,
}

/// Port publisher (from ps --format json in newer compose).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct PortPublisher {
    #[serde(alias = "URL", default)]
    pub url: Option<String>,
    #[serde(alias = "targetPort", alias = "TargetPort")]
    pub target_port: Option<u16>,
    #[serde(alias = "publishedPort", alias = "PublishedPort")]
    pub published_port: Option<u16>,
    #[serde(alias = "protocol", alias = "Protocol")]
    pub protocol: Option<String>,
}

/// Compose images item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeImageItem {
    pub container: Option<String>,
    pub repository: Option<String>,
    pub tag: Option<String>,
    pub image_id: Option<String>,
    pub size: Option<String>,
}

/// Compose top item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeTopItem {
    pub service: String,
    pub uid: Option<String>,
    pub pid: Option<String>,
    pub ppid: Option<String>,
    pub c: Option<String>,
    pub stime: Option<String>,
    pub tty: Option<String>,
    pub time: Option<String>,
    pub cmd: Option<String>,
}

/// Compose event from `docker compose events --json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeEvent {
    pub time: Option<String>,
    #[serde(rename = "type")]
    pub event_type: Option<String>,
    pub action: Option<String>,
    pub id: Option<String>,
    pub service: Option<String>,
    pub attributes: Option<HashMap<String, String>>,
}

/// Compose version information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeVersionInfo {
    pub version: String,
    pub is_v2_plugin: bool,
    pub raw_output: String,
}

/// Environment variable entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: Option<String>,
    pub source: Option<String>,
}

/// Parsed environment file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvFile {
    pub path: String,
    pub variables: Vec<EnvVar>,
    pub errors: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Service Health / Runtime State
// ═══════════════════════════════════════════════════════════════════════════════

/// Runtime status of a compose project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeProjectStatus {
    pub name: String,
    pub config_files: Vec<String>,
    pub service_count: usize,
    pub running_count: usize,
    pub stopped_count: usize,
    pub unhealthy_count: usize,
    pub services: Vec<ComposeServiceStatus>,
    pub last_checked: String,
}

/// Runtime status of a single service.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeServiceStatus {
    pub name: String,
    pub state: ServiceState,
    pub health: ServiceHealth,
    pub replicas_running: i32,
    pub replicas_desired: i32,
    pub image: Option<String>,
    pub ports: Vec<String>,
    pub container_ids: Vec<String>,
    pub exit_codes: Vec<Option<i32>>,
    pub restart_count: Option<i32>,
    pub uptime: Option<String>,
    pub cpu_percent: Option<f64>,
    pub memory_usage: Option<String>,
    pub memory_limit: Option<String>,
}

/// Service state enum.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ServiceState {
    Running,
    Stopped,
    Restarting,
    Exited,
    Paused,
    Dead,
    Created,
    Removing,
    Unknown,
}

/// Service health enum.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ServiceHealth {
    Healthy,
    Unhealthy,
    Starting,
    None,
    Unknown,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Dependency Graph
// ═══════════════════════════════════════════════════════════════════════════════

/// Edge in the dependency graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyEdge {
    pub from: String,
    pub to: String,
    pub condition: Option<String>,
}

/// Resolved dependency graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyGraph {
    pub services: Vec<String>,
    pub edges: Vec<DependencyEdge>,
    pub startup_order: Vec<String>,
    pub has_cycle: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Profile
// ═══════════════════════════════════════════════════════════════════════════════

/// Profile summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeProfile {
    pub name: String,
    pub services: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Validation
// ═══════════════════════════════════════════════════════════════════════════════

/// Compose file validation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeValidation {
    pub valid: bool,
    pub errors: Vec<ValidationIssue>,
    pub warnings: Vec<ValidationIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub service: Option<String>,
    pub field: Option<String>,
    pub message: String,
    pub severity: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Template
// ═══════════════════════════════════════════════════════════════════════════════

/// Compose template for scaffolding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeTemplate {
    pub name: String,
    pub description: String,
    pub category: String,
    pub tags: Vec<String>,
    pub content: String,
}
