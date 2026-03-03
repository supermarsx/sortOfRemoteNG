// ── sorng-ansible/src/types.rs ───────────────────────────────────────────────
//! Comprehensive Ansible type definitions covering connection configuration,
//! inventory (hosts, groups, variables), playbooks, tasks, handlers, roles,
//! vault, galaxy, facts, ad-hoc commands, and execution results.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Connection & Environment ───────────────────────────────────────────────

/// Top-level connection configuration for an Ansible control node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnsibleConnectionConfig {
    pub id: String,
    pub name: String,
    /// Path to the `ansible` binary (auto-detected if `None`).
    pub ansible_bin_path: Option<String>,
    /// Path to the `ansible-playbook` binary.
    pub ansible_playbook_bin_path: Option<String>,
    /// Path to the `ansible-vault` binary.
    pub ansible_vault_bin_path: Option<String>,
    /// Path to the `ansible-galaxy` binary.
    pub ansible_galaxy_bin_path: Option<String>,
    /// Working directory for command execution.
    pub working_directory: Option<String>,
    /// Path to `ansible.cfg`.
    pub config_path: Option<String>,
    /// Default inventory source (file path, directory, or comma-separated hosts).
    pub default_inventory: Option<String>,
    /// Default remote user.
    pub remote_user: Option<String>,
    /// Default private-key path.
    pub private_key_path: Option<String>,
    /// SSH common args (e.g. `"-o StrictHostKeyChecking=no"`).
    pub ssh_common_args: Option<String>,
    /// Extra environment variables to inject.
    pub env_vars: HashMap<String, String>,
    /// Vault password file path.
    pub vault_password_file: Option<String>,
    /// Whether to ask for the vault password interactively (not used in headless mode).
    pub ask_vault_pass: bool,
    /// Default verbosity level (0–4, mapping to `-v` through `-vvvv`).
    pub verbosity: u8,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
    /// Updated timestamp.
    pub updated_at: DateTime<Utc>,
    /// Arbitrary labels for UI grouping.
    pub labels: HashMap<String, String>,
}

/// Information returned after connecting / detecting Ansible.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnsibleInfo {
    pub version: String,
    pub python_version: String,
    pub config_file: Option<String>,
    pub default_module_path: Option<String>,
    pub executable: String,
    pub available_modules: Vec<String>,
    pub available_plugins: Vec<String>,
}

/// Overall status summary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AnsibleStatus {
    Available,
    NotInstalled,
    VersionMismatch,
    ConfigError,
    Unknown,
}

// ─── Inventory ──────────────────────────────────────────────────────────────

/// Complete inventory representation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Inventory {
    pub source: InventorySource,
    pub hosts: Vec<InventoryHost>,
    pub groups: Vec<InventoryGroup>,
    /// Timestamp of last parse / refresh.
    pub last_refreshed: Option<DateTime<Utc>>,
}

/// How the inventory was sourced.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum InventorySource {
    IniFile(String),
    YamlFile(String),
    Directory(String),
    Script(String),
    Plugin(String),
    Inline(String),
}

/// A single host in the inventory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryHost {
    pub name: String,
    pub ansible_host: Option<String>,
    pub ansible_port: Option<u16>,
    pub ansible_user: Option<String>,
    pub ansible_connection: Option<String>,
    pub ansible_python_interpreter: Option<String>,
    pub groups: Vec<String>,
    pub variables: HashMap<String, serde_json::Value>,
    pub enabled: bool,
}

/// A group in the inventory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryGroup {
    pub name: String,
    pub hosts: Vec<String>,
    pub children: Vec<String>,
    pub variables: HashMap<String, serde_json::Value>,
}

/// Parameters to add a host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddHostParams {
    pub name: String,
    pub ansible_host: Option<String>,
    pub ansible_port: Option<u16>,
    pub ansible_user: Option<String>,
    pub ansible_connection: Option<String>,
    pub groups: Vec<String>,
    pub variables: HashMap<String, serde_json::Value>,
}

/// Parameters to add a group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddGroupParams {
    pub name: String,
    pub children: Vec<String>,
    pub variables: HashMap<String, serde_json::Value>,
}

/// Dynamic inventory script configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicInventoryConfig {
    pub script_path: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub cache_ttl_secs: Option<u64>,
}

// ─── Playbooks ──────────────────────────────────────────────────────────────

/// A parsed playbook file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playbook {
    pub path: String,
    pub name: String,
    pub plays: Vec<Play>,
    pub raw_yaml: Option<String>,
    pub file_size: u64,
    pub last_modified: Option<DateTime<Utc>>,
}

/// A single play within a playbook.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Play {
    pub name: Option<String>,
    pub hosts: String,
    #[serde(rename = "become")]
    pub use_become: Option<bool>,
    pub become_user: Option<String>,
    pub become_method: Option<String>,
    pub gather_facts: Option<bool>,
    pub strategy: Option<String>,
    pub serial: Option<serde_json::Value>,
    pub max_fail_percentage: Option<f64>,
    pub any_errors_fatal: Option<bool>,
    pub connection: Option<String>,
    pub environment: HashMap<String, String>,
    pub vars: HashMap<String, serde_json::Value>,
    pub vars_files: Vec<String>,
    pub pre_tasks: Vec<Task>,
    pub tasks: Vec<Task>,
    pub post_tasks: Vec<Task>,
    pub handlers: Vec<Handler>,
    pub roles: Vec<RoleReference>,
    pub tags: Vec<String>,
}

/// A single task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub name: Option<String>,
    pub module: String,
    pub args: HashMap<String, serde_json::Value>,
    #[serde(rename = "become")]
    pub use_become: Option<bool>,
    pub become_user: Option<String>,
    pub when: Option<serde_json::Value>,
    pub with_items: Option<serde_json::Value>,
    pub loop_expr: Option<serde_json::Value>,
    pub loop_control: Option<LoopControl>,
    pub register: Option<String>,
    pub changed_when: Option<serde_json::Value>,
    pub failed_when: Option<serde_json::Value>,
    pub ignore_errors: Option<bool>,
    pub no_log: Option<bool>,
    pub delegate_to: Option<String>,
    pub run_once: Option<bool>,
    pub notify: Vec<String>,
    pub tags: Vec<String>,
    pub block: Vec<Task>,
    pub rescue: Vec<Task>,
    pub always: Vec<Task>,
    pub retries: Option<u32>,
    pub delay: Option<u32>,
    pub until: Option<serde_json::Value>,
    pub environment: HashMap<String, String>,
}

/// Loop control parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoopControl {
    pub loop_var: Option<String>,
    pub index_var: Option<String>,
    pub label: Option<String>,
    pub pause: Option<f64>,
    pub extended: Option<bool>,
}

/// A handler (a task that fires only on notification).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Handler {
    pub name: String,
    pub module: String,
    pub args: HashMap<String, serde_json::Value>,
    #[serde(rename = "become")]
    pub use_become: Option<bool>,
    pub become_user: Option<String>,
    pub when: Option<serde_json::Value>,
    pub listen: Vec<String>,
    pub tags: Vec<String>,
}

/// Reference to a role inside a play.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleReference {
    pub role: String,
    pub vars: HashMap<String, serde_json::Value>,
    pub when: Option<serde_json::Value>,
    pub tags: Vec<String>,
    #[serde(rename = "become")]
    pub use_become: Option<bool>,
    pub become_user: Option<String>,
}

/// Execution options for `ansible-playbook`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybookRunOptions {
    pub playbook_path: String,
    pub inventory: Option<String>,
    pub limit: Option<String>,
    pub tags: Vec<String>,
    pub skip_tags: Vec<String>,
    pub extra_vars: HashMap<String, serde_json::Value>,
    pub extra_vars_files: Vec<String>,
    pub forks: Option<u32>,
    pub check_mode: bool,
    pub diff_mode: bool,
    pub start_at_task: Option<String>,
    pub step: bool,
    pub flush_cache: bool,
    pub force_handlers: bool,
    #[serde(rename = "become")]
    pub use_become: Option<bool>,
    pub become_user: Option<String>,
    pub become_method: Option<String>,
    pub remote_user: Option<String>,
    pub private_key: Option<String>,
    pub ssh_common_args: Option<String>,
    pub timeout_secs: Option<u64>,
    pub vault_password_file: Option<String>,
    pub verbosity: Option<u8>,
    pub env_vars: HashMap<String, String>,
}

/// Playbook validation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybookValidation {
    pub valid: bool,
    pub errors: Vec<PlaybookIssue>,
    pub warnings: Vec<PlaybookIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybookIssue {
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub message: String,
    pub severity: IssueSeverity,
    pub rule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum IssueSeverity {
    Error,
    Warning,
    Info,
}

// ─── Execution Results ──────────────────────────────────────────────────────

/// Aggregated result of a playbook or ad-hoc run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub id: String,
    pub status: ExecutionStatus,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub duration_secs: Option<f64>,
    pub host_results: Vec<HostResult>,
    pub stats: PlayStats,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExecutionStatus {
    Running,
    Success,
    Failed,
    Unreachable,
    Cancelled,
    TimedOut,
}

/// Per-host result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostResult {
    pub host: String,
    pub status: HostStatus,
    pub task_results: Vec<TaskResult>,
    pub facts: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HostStatus {
    Ok,
    Changed,
    Failed,
    Unreachable,
    Skipped,
}

/// Per-task result on a given host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    pub task_name: String,
    pub module: String,
    pub status: HostStatus,
    pub changed: bool,
    pub msg: Option<String>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub rc: Option<i32>,
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub diff: Option<TaskDiff>,
    pub items: Vec<ItemResult>,
    pub skipped: bool,
    pub skip_reason: Option<String>,
    pub failed: bool,
    pub failure_reason: Option<String>,
}

/// Diff output for a single task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDiff {
    pub before: String,
    pub after: String,
    pub before_header: Option<String>,
    pub after_header: Option<String>,
}

/// Result for a single item when looping.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemResult {
    pub item: serde_json::Value,
    pub changed: bool,
    pub failed: bool,
    pub msg: Option<String>,
}

/// Summary statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayStats {
    pub ok: u32,
    pub changed: u32,
    pub unreachable: u32,
    pub failed: u32,
    pub skipped: u32,
    pub rescued: u32,
    pub ignored: u32,
}

// ─── Ad-Hoc Commands ────────────────────────────────────────────────────────

/// Options for running an ad-hoc command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdHocOptions {
    pub pattern: String,
    pub module: String,
    pub module_args: Option<String>,
    pub inventory: Option<String>,
    #[serde(rename = "become")]
    pub use_become: Option<bool>,
    pub become_user: Option<String>,
    pub become_method: Option<String>,
    pub remote_user: Option<String>,
    pub private_key: Option<String>,
    pub forks: Option<u32>,
    pub extra_vars: HashMap<String, serde_json::Value>,
    pub timeout_secs: Option<u64>,
    pub poll: Option<u32>,
    pub background: Option<u32>,
    pub one_line: bool,
    pub tree: Option<String>,
    pub vault_password_file: Option<String>,
    pub verbosity: Option<u8>,
    pub env_vars: HashMap<String, String>,
}

// ─── Roles ──────────────────────────────────────────────────────────────────

/// An Ansible role discovered on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub name: String,
    pub path: String,
    pub namespace: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub min_ansible_version: Option<String>,
    pub platforms: Vec<RolePlatform>,
    pub dependencies: Vec<RoleDependency>,
    pub galaxy_info: Option<GalaxyRoleMeta>,
    /// Subdirectories present (tasks, handlers, defaults, vars, files, templates, meta, tests).
    pub structure: RoleStructure,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleStructure {
    pub has_tasks: bool,
    pub has_handlers: bool,
    pub has_defaults: bool,
    pub has_vars: bool,
    pub has_files: bool,
    pub has_templates: bool,
    pub has_meta: bool,
    pub has_tests: bool,
    pub has_readme: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RolePlatform {
    pub name: String,
    pub versions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleDependency {
    pub role: String,
    pub version: Option<String>,
    pub source: Option<String>,
}

/// Options for scaffolding a new role.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleInitOptions {
    pub name: String,
    pub path: Option<String>,
    pub init_type: RoleInitType,
    pub offline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RoleInitType {
    Default,
    Container,
    Network,
    Apb,
}

// ─── Vault ──────────────────────────────────────────────────────────────────

/// Vault operation to perform.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEncryptOptions {
    pub content: String,
    pub vault_password_file: Option<String>,
    pub vault_id: Option<String>,
    pub output_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultDecryptOptions {
    pub content: String,
    pub vault_password_file: Option<String>,
    pub vault_id: Option<String>,
    pub output_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultRekeyOptions {
    pub file_path: String,
    pub old_vault_password_file: Option<String>,
    pub new_vault_password_file: Option<String>,
    pub old_vault_id: Option<String>,
    pub new_vault_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEncryptStringOptions {
    pub plaintext: String,
    pub variable_name: String,
    pub vault_password_file: Option<String>,
    pub vault_id: Option<String>,
}

/// Vault operation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultResult {
    pub success: bool,
    pub output: String,
    pub encrypted: Option<bool>,
}

// ─── Galaxy ─────────────────────────────────────────────────────────────────

/// An Ansible Galaxy role listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GalaxyRoleMeta {
    pub role_name: Option<String>,
    pub namespace: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub min_ansible_version: Option<String>,
    pub platforms: Vec<RolePlatform>,
    pub galaxy_tags: Vec<String>,
    pub dependencies: Vec<RoleDependency>,
}

/// An Ansible Galaxy collection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GalaxyCollection {
    pub namespace: String,
    pub name: String,
    pub version: String,
    pub path: Option<String>,
    pub description: Option<String>,
    pub authors: Vec<String>,
    pub dependencies: HashMap<String, String>,
    pub tags: Vec<String>,
    pub repository: Option<String>,
    pub homepage: Option<String>,
    pub documentation: Option<String>,
}

/// Galaxy install options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GalaxyInstallOptions {
    pub name: String,
    pub version: Option<String>,
    pub roles_path: Option<String>,
    pub collections_path: Option<String>,
    pub force: bool,
    pub no_deps: bool,
    pub requirements_file: Option<String>,
}

/// Galaxy search options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GalaxySearchOptions {
    pub query: String,
    pub galaxy_tags: Vec<String>,
    pub platforms: Vec<String>,
    pub author: Option<String>,
    pub order_by: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

/// Galaxy search result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GalaxySearchResult {
    pub name: String,
    pub namespace: String,
    pub description: Option<String>,
    pub download_count: Option<u64>,
    pub stars: Option<u64>,
    pub created: Option<String>,
    pub modified: Option<String>,
}

// ─── Facts ──────────────────────────────────────────────────────────────────

/// Host facts gathered by Ansible's setup module.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostFacts {
    pub hostname: String,
    pub fqdn: Option<String>,
    pub os_family: Option<String>,
    pub distribution: Option<String>,
    pub distribution_version: Option<String>,
    pub distribution_release: Option<String>,
    pub kernel: Option<String>,
    pub architecture: Option<String>,
    pub processor: Vec<String>,
    pub processor_count: Option<u32>,
    pub memory_mb: Option<MemoryFacts>,
    pub interfaces: Vec<NetworkInterfaceFacts>,
    pub mounts: Vec<MountFacts>,
    pub ipv4_addresses: Vec<String>,
    pub ipv6_addresses: Vec<String>,
    pub uptime_seconds: Option<u64>,
    pub python_version: Option<String>,
    pub selinux: Option<SelinuxFacts>,
    pub virtualization_type: Option<String>,
    pub virtualization_role: Option<String>,
    pub all_facts: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryFacts {
    pub total: u64,
    pub free: u64,
    pub used: u64,
    pub swap_total: u64,
    pub swap_free: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInterfaceFacts {
    pub name: String,
    pub ipv4: Option<String>,
    pub ipv6: Option<String>,
    pub mac_address: Option<String>,
    pub mtu: Option<u32>,
    pub active: bool,
    pub speed: Option<u32>,
    pub interface_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MountFacts {
    pub mount: String,
    pub device: String,
    pub fstype: String,
    pub options: String,
    pub size_total: Option<u64>,
    pub size_available: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelinuxFacts {
    pub status: String,
    pub mode: Option<String>,
    pub policy_version: Option<String>,
    pub config_mode: Option<String>,
}

// ─── Configuration ──────────────────────────────────────────────────────────

/// Parsed ansible.cfg.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnsibleConfig {
    pub source: Option<String>,
    pub sections: HashMap<String, HashMap<String, String>>,
}

/// A single configuration setting.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigSetting {
    pub key: String,
    pub value: String,
    pub section: String,
    pub origin: ConfigOrigin,
    pub default: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConfigOrigin {
    Default,
    ConfigFile,
    Environment,
    CommandLine,
}

/// Known Ansible module info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleInfo {
    pub name: String,
    pub namespace: Option<String>,
    pub short_description: Option<String>,
    pub description: Option<String>,
    pub parameters: Vec<ModuleParameter>,
    pub examples: Option<String>,
    pub return_values: Vec<ModuleReturnValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleParameter {
    pub name: String,
    pub description: Option<String>,
    pub param_type: Option<String>,
    pub required: bool,
    pub default: Option<serde_json::Value>,
    pub choices: Vec<serde_json::Value>,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleReturnValue {
    pub name: String,
    pub description: Option<String>,
    pub returned: Option<String>,
    pub return_type: Option<String>,
    pub sample: Option<serde_json::Value>,
}

// ─── Execution History ──────────────────────────────────────────────────────

/// Stored execution run for history / audit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionHistoryEntry {
    pub id: String,
    pub command_type: CommandType,
    pub command: String,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub status: ExecutionStatus,
    pub exit_code: Option<i32>,
    pub host_count: u32,
    pub ok: u32,
    pub changed: u32,
    pub failed: u32,
    pub unreachable: u32,
    pub user: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CommandType {
    Playbook,
    AdHoc,
    VaultEncrypt,
    VaultDecrypt,
    GalaxyInstall,
    FactGather,
    RoleInit,
    Other,
}
