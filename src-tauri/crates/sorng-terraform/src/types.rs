// ── sorng-terraform/src/types.rs ──────────────────────────────────────────────
//! Shared data structures for the Terraform crate.

use std::collections::HashMap;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── Connection & info ────────────────────────────────────────────────────────

/// Configuration for a Terraform working-directory connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerraformConnectionConfig {
    /// Path to the `terraform` binary (if empty, resolved from PATH).
    pub terraform_path: Option<String>,
    /// Working directory containing `.tf` files.
    pub working_dir: String,
    /// Optional backend config overrides (`-backend-config` key=value pairs).
    pub backend_configs: HashMap<String, String>,
    /// Environment variables to inject into every CLI call.
    pub env_vars: HashMap<String, String>,
    /// Optional path to a .terraformrc / terraform.rc CLI config file.
    pub cli_config_file: Option<String>,
    /// Data directory override (TF_DATA_DIR).
    pub data_dir: Option<String>,
}

/// Version & capability information returned after connecting.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerraformInfo {
    pub version: String,
    pub platform: String,
    pub providers: Vec<ProviderVersion>,
    pub working_dir: String,
    pub backend_type: Option<String>,
    pub workspace: String,
}

/// A provider with its locked version.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderVersion {
    pub namespace: String,
    pub name: String,
    pub version: String,
    pub source: String,
}

// ── Init ─────────────────────────────────────────────────────────────────────

/// Options for `terraform init`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InitOptions {
    /// Upgrade provider plugins to the latest allowed version.
    pub upgrade: bool,
    /// Reconfigure backend, ignoring previous config.
    pub reconfigure: bool,
    /// Migrate backend state from one type to another.
    pub migrate_state: bool,
    /// Additional `-backend-config` key=value overrides.
    pub backend_configs: HashMap<String, String>,
    /// `-plugin-dir` search paths.
    pub plugin_dirs: Vec<String>,
    /// Lock provider dependency hashes (`-lockfile` mode: readonly, none).
    pub lockfile_mode: Option<String>,
    /// Get plugins (`-get-plugins`).
    pub get_plugins: Option<bool>,
    /// Force copy state (for migration).
    pub force_copy: bool,
}

/// Result of a `terraform init` invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub providers_installed: Vec<ProviderVersion>,
    pub backend_type: Option<String>,
    pub duration_ms: u64,
}

// ── Plan ─────────────────────────────────────────────────────────────────────

/// Options for `terraform plan`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PlanOptions {
    /// Output the plan to a binary file.
    pub out: Option<String>,
    /// Destroy plan instead of create/update.
    pub destroy: bool,
    /// Refresh state before planning.
    pub refresh_only: bool,
    /// Target specific resources (list of address strings).
    pub targets: Vec<String>,
    /// Variable files (`-var-file`).
    pub var_files: Vec<String>,
    /// Individual variable overrides (`-var` key=value).
    pub vars: HashMap<String, String>,
    /// Replace specific resources (`-replace`).
    pub replace: Vec<String>,
    /// Concurrency (`-parallelism`).
    pub parallelism: Option<u32>,
    /// Compact warnings.
    pub compact_warnings: bool,
    /// Detailed exit code (0 = no changes, 1 = error, 2 = changes present).
    pub detailed_exitcode: bool,
    /// Lock state file.
    pub lock: Option<bool>,
    /// Lock timeout.
    pub lock_timeout: Option<String>,
    /// Generate machine-readable JSON.
    pub json: bool,
}

/// Parsed plan summary (from `terraform show -json <planfile>` or plan output).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanSummary {
    pub format_version: String,
    pub terraform_version: String,
    pub resource_changes: Vec<ResourceChange>,
    pub output_changes: Vec<OutputChange>,
    pub prior_state: Option<StateSnapshot>,
    pub configuration: Option<ConfigurationSummary>,
    pub add: usize,
    pub change: usize,
    pub destroy: usize,
    pub import_count: usize,
    pub has_changes: bool,
    pub plan_file: Option<String>,
    pub duration_ms: u64,
}

/// A single resource change from a plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceChange {
    pub address: String,
    pub module_address: Option<String>,
    pub mode: String,
    pub resource_type: String,
    pub name: String,
    pub provider_name: String,
    pub actions: Vec<ChangeAction>,
    pub before: Option<serde_json::Value>,
    pub after: Option<serde_json::Value>,
    pub after_unknown: Option<serde_json::Value>,
    pub before_sensitive: Option<serde_json::Value>,
    pub after_sensitive: Option<serde_json::Value>,
    pub action_reason: Option<String>,
}

/// Change action types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ChangeAction {
    #[serde(rename = "no-op")]
    NoOp,
    #[serde(rename = "create")]
    Create,
    #[serde(rename = "read")]
    Read,
    #[serde(rename = "update")]
    Update,
    #[serde(rename = "delete")]
    Delete,
    #[serde(rename = "create-then-delete")]
    CreateThenDelete,
    #[serde(rename = "delete-then-create")]
    DeleteThenCreate,
}

/// An output value change.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputChange {
    pub name: String,
    pub actions: Vec<ChangeAction>,
    pub before: Option<serde_json::Value>,
    pub after: Option<serde_json::Value>,
    pub after_unknown: bool,
    pub sensitive: bool,
}

// ── Plan result ──────────────────────────────────────────────────────────────

/// Raw plan result (before JSON parsing).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub plan_file: Option<String>,
    pub summary: Option<PlanSummary>,
    pub duration_ms: u64,
}

// ── Apply / Destroy ──────────────────────────────────────────────────────────

/// Options for `terraform apply` or `terraform destroy`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ApplyOptions {
    /// Apply a saved plan file instead of creating a new plan.
    pub plan_file: Option<String>,
    /// Auto-approve (skip interactive prompt).
    pub auto_approve: bool,
    /// Target specific resources.
    pub targets: Vec<String>,
    /// Variable files.
    pub var_files: Vec<String>,
    /// Individual variable overrides.
    pub vars: HashMap<String, String>,
    /// Replace resources.
    pub replace: Vec<String>,
    /// Concurrency.
    pub parallelism: Option<u32>,
    /// Compact warnings.
    pub compact_warnings: bool,
    /// Lock state file.
    pub lock: Option<bool>,
    /// Lock timeout.
    pub lock_timeout: Option<String>,
    /// JSON output mode.
    pub json: bool,
    /// Additional arbitrary CLI flags.
    pub extra_args: Vec<String>,
}

/// Result of `terraform apply` / `terraform destroy`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub resources_added: usize,
    pub resources_changed: usize,
    pub resources_destroyed: usize,
    pub outputs: HashMap<String, OutputValue>,
    pub duration_ms: u64,
}

// ── State ────────────────────────────────────────────────────────────────────

/// Snapshot of the Terraform state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateSnapshot {
    pub format_version: Option<String>,
    pub terraform_version: Option<String>,
    pub serial: Option<u64>,
    pub lineage: Option<String>,
    pub resources: Vec<StateResource>,
    pub outputs: HashMap<String, OutputValue>,
}

/// A resource in state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateResource {
    pub address: String,
    pub mode: String,
    pub resource_type: String,
    pub name: String,
    pub provider: String,
    pub module: Option<String>,
    pub instances: Vec<ResourceInstance>,
    pub tainted: bool,
}

/// A single instance of a resource (each count/for_each element).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceInstance {
    pub index_key: Option<serde_json::Value>,
    pub schema_version: Option<u64>,
    pub attributes: serde_json::Value,
    pub sensitive_attributes: Vec<String>,
    pub private: Option<String>,
    pub dependencies: Vec<String>,
    pub create_before_destroy: bool,
}

/// Options for `terraform import`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportOptions {
    pub address: String,
    pub resource_id: String,
    pub var_files: Vec<String>,
    pub vars: HashMap<String, String>,
    pub provider: Option<String>,
    pub lock: Option<bool>,
    pub lock_timeout: Option<String>,
}

/// Result of a state operation (mv, rm, import, taint, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateOperationResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ── Workspace ────────────────────────────────────────────────────────────────

/// Terraform workspace metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub name: String,
    pub is_current: bool,
}

// ── Output ───────────────────────────────────────────────────────────────────

/// A Terraform output value.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputValue {
    pub value: serde_json::Value,
    pub output_type: Option<serde_json::Value>,
    pub sensitive: bool,
}

// ── Providers ────────────────────────────────────────────────────────────────

/// Detailed provider information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub source: String,
    pub namespace: String,
    pub name: String,
    pub version_constraint: Option<String>,
    pub installed_version: Option<String>,
    pub platform: Option<String>,
    pub used_by: Vec<String>,
}

/// Entry from the `.terraform.lock.hcl` lock file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderLockEntry {
    pub source: String,
    pub version: String,
    pub constraints: Option<String>,
    pub hashes: Vec<String>,
}

/// Provider schema information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSchema {
    pub name: String,
    pub source: String,
    pub version: String,
    pub resource_types: Vec<SchemaResourceType>,
    pub data_source_types: Vec<SchemaResourceType>,
}

/// A resource/data-source type schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaResourceType {
    pub name: String,
    pub description: Option<String>,
    pub attributes: Vec<SchemaAttribute>,
    pub block_types: Vec<SchemaBlockType>,
}

/// A single attribute in a schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaAttribute {
    pub name: String,
    pub attr_type: Option<serde_json::Value>,
    pub description: Option<String>,
    pub required: bool,
    pub optional: bool,
    pub computed: bool,
    pub sensitive: bool,
}

/// A nested block type in a schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaBlockType {
    pub name: String,
    pub nesting_mode: String,
    pub min_items: Option<usize>,
    pub max_items: Option<usize>,
    pub attributes: Vec<SchemaAttribute>,
}

// ── Modules ──────────────────────────────────────────────────────────────────

/// A module reference (local or registry).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleRef {
    pub source: String,
    pub version: Option<String>,
    pub key: String,
    pub dir: Option<String>,
}

/// Options for searching the Terraform registry.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RegistrySearchOptions {
    pub query: String,
    pub provider: Option<String>,
    pub namespace: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub verified_only: bool,
}

/// A module from the Terraform registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryModule {
    pub id: String,
    pub namespace: String,
    pub name: String,
    pub provider: String,
    pub version: String,
    pub description: Option<String>,
    pub source: String,
    pub downloads: Option<u64>,
    pub published_at: Option<String>,
    pub verified: bool,
}

// ── Validate / fmt ───────────────────────────────────────────────────────────

/// Result of `terraform validate`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub error_count: usize,
    pub warning_count: usize,
    pub diagnostics: Vec<Diagnostic>,
    pub format_version: Option<String>,
}

/// A diagnostic message from validate / plan / apply.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: DiagnosticSeverity,
    pub summary: String,
    pub detail: Option<String>,
    pub range: Option<DiagnosticRange>,
    pub snippet: Option<DiagnosticSnippet>,
}

/// Diagnostic severity.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DiagnosticSeverity {
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "warning")]
    Warning,
}

/// Source location for a diagnostic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticRange {
    pub filename: String,
    pub start: DiagnosticPos,
    pub end: DiagnosticPos,
}

/// Line/column position.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticPos {
    pub line: usize,
    pub column: usize,
    pub byte: Option<usize>,
}

/// Code snippet attached to a diagnostic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticSnippet {
    pub context: Option<String>,
    pub code: String,
    pub start_line: usize,
    pub highlight_start_offset: Option<usize>,
    pub highlight_end_offset: Option<usize>,
    pub values: Vec<DiagnosticExprValue>,
}

/// Expression value in a diagnostic snippet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticExprValue {
    pub traversal: String,
    pub statement: String,
}

/// Result of `terraform fmt`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FmtResult {
    pub files_changed: Vec<String>,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

// ── Graph ────────────────────────────────────────────────────────────────────

/// Result of `terraform graph`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphResult {
    /// DOT-format graph output.
    pub dot: String,
    /// Parsed node list.
    pub nodes: Vec<GraphNode>,
    /// Parsed edge list.
    pub edges: Vec<GraphEdge>,
}

/// A node in the resource dependency graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub node_type: GraphNodeType,
}

/// Node type category.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum GraphNodeType {
    Resource,
    DataSource,
    Module,
    Provider,
    Variable,
    Output,
    Local,
    Root,
    Unknown,
}

/// An edge in the dependency graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
}

// ── HCL Analysis ─────────────────────────────────────────────────────────────

/// High-level analysis of a Terraform directory's HCL files.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HclAnalysis {
    pub variables: Vec<HclVariable>,
    pub outputs: Vec<HclOutput>,
    pub resources: Vec<HclResource>,
    pub data_sources: Vec<HclDataSource>,
    pub locals: Vec<HclLocal>,
    pub modules: Vec<HclModuleCall>,
    pub providers_required: Vec<HclRequiredProvider>,
    pub terraform_settings: Option<HclTerraformSettings>,
    pub files: Vec<String>,
}

/// A variable declaration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HclVariable {
    pub name: String,
    pub var_type: Option<String>,
    pub default: Option<serde_json::Value>,
    pub description: Option<String>,
    pub sensitive: bool,
    pub nullable: bool,
    pub validation_rules: Vec<String>,
    pub file: String,
    pub line: usize,
}

/// An output declaration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HclOutput {
    pub name: String,
    pub description: Option<String>,
    pub sensitive: bool,
    pub value_expr: Option<String>,
    pub depends_on: Vec<String>,
    pub file: String,
    pub line: usize,
}

/// A resource block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HclResource {
    pub resource_type: String,
    pub name: String,
    pub address: String,
    pub provider: Option<String>,
    pub count_expr: Option<String>,
    pub for_each_expr: Option<String>,
    pub depends_on: Vec<String>,
    pub lifecycle: Option<HclLifecycle>,
    pub provisioners: Vec<String>,
    pub file: String,
    pub line: usize,
}

/// A data source block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HclDataSource {
    pub data_type: String,
    pub name: String,
    pub address: String,
    pub provider: Option<String>,
    pub depends_on: Vec<String>,
    pub file: String,
    pub line: usize,
}

/// A locals block entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HclLocal {
    pub name: String,
    pub value_expr: Option<String>,
    pub file: String,
    pub line: usize,
}

/// A module call block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HclModuleCall {
    pub name: String,
    pub source: String,
    pub version: Option<String>,
    pub count_expr: Option<String>,
    pub for_each_expr: Option<String>,
    pub depends_on: Vec<String>,
    pub providers: HashMap<String, String>,
    pub file: String,
    pub line: usize,
}

/// A required_providers entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HclRequiredProvider {
    pub name: String,
    pub source: String,
    pub version_constraint: Option<String>,
}

/// terraform { ... } settings block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HclTerraformSettings {
    pub required_version: Option<String>,
    pub backend_type: Option<String>,
    pub backend_config: HashMap<String, serde_json::Value>,
    pub cloud_block: Option<HashMap<String, serde_json::Value>>,
    pub experiments: Vec<String>,
}

/// Lifecycle meta-argument.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HclLifecycle {
    pub create_before_destroy: Option<bool>,
    pub prevent_destroy: Option<bool>,
    pub ignore_changes: Vec<String>,
    pub replace_triggered_by: Vec<String>,
    pub preconditions: Vec<String>,
    pub postconditions: Vec<String>,
}

// ── Drift ────────────────────────────────────────────────────────────────────

/// Drift detection result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriftResult {
    pub has_drift: bool,
    pub drifted_resources: Vec<DriftedResource>,
    pub total_resources: usize,
    pub drift_percentage: f64,
    pub detected_at: DateTime<Utc>,
    pub duration_ms: u64,
}

/// A single resource that has drifted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriftedResource {
    pub address: String,
    pub resource_type: String,
    pub name: String,
    pub drift_type: DriftType,
    pub before: Option<serde_json::Value>,
    pub after: Option<serde_json::Value>,
    pub changed_attributes: Vec<String>,
}

/// Kind of drift detected.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DriftType {
    Modified,
    Deleted,
    Added,
}

// ── Configuration Summary ────────────────────────────────────────────────────

/// High-level configuration snapshot from a plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigurationSummary {
    pub provider_configs: HashMap<String, serde_json::Value>,
    pub root_module: Option<serde_json::Value>,
}

// ── Execution History ────────────────────────────────────────────────────────

/// Record of a Terraform command execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionHistoryEntry {
    pub id: String,
    pub connection_id: String,
    pub command_type: CommandType,
    pub args: Vec<String>,
    pub exit_code: i32,
    pub stdout_snippet: String,
    pub stderr_snippet: String,
    pub started_at: DateTime<Utc>,
    pub duration_ms: u64,
    pub workspace: Option<String>,
    pub working_dir: String,
    pub success: bool,
}

/// The type of Terraform command that was run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CommandType {
    Init,
    Plan,
    Apply,
    Destroy,
    Validate,
    Fmt,
    Import,
    Taint,
    Untaint,
    StateList,
    StateShow,
    StateMv,
    StateRm,
    StatePull,
    StatePush,
    WorkspaceNew,
    WorkspaceSelect,
    WorkspaceDelete,
    Output,
    Graph,
    Refresh,
    Get,
    ProvidersLock,
    ProvidersMirror,
    ProvidersSchema,
    ForceUnlock,
    Show,
    Console,
    Other(String),
}
