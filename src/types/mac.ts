/**
 * TypeScript surface for the `sorng-mac` backend crate (Mandatory Access
 * Control frameworks: SELinux, AppArmor, TOMOYO, SMACK).
 *
 * Mirrors `src-tauri/crates/sorng-mac/src/types.rs`.
 *
 * The Rust types do not set a top-level `rename_all`, so struct field
 * names remain snake_case on the wire. Enums that carry
 * `#[serde(rename_all = "snake_case")]` serialise as snake_case string
 * literals — reflected here via string-literal unions.
 */

// ── Connection & Top-Level ──────────────────────────────────────────────────

export interface MacConnectionConfig {
  host: string;
  port?: number;
  ssh_user: string;
  ssh_password?: string;
  ssh_key?: string;
  timeout_secs?: number;
  sudo_password?: string;
}

export type MacSystemType =
  | 'se_linux'
  | 'app_armor'
  | 'tomoyo'
  | 'smack'
  | 'none';

export interface MacConnectionSummary {
  host: string;
  mac_system: MacSystemType;
  version?: string;
  enforcing: boolean;
  active_modules_count: number;
}

export interface MacDashboard {
  system_type: MacSystemType;
  mode: string;
  policy_version?: string;
  loaded_modules: number;
  active_booleans: number;
  denied_count_24h: number;
  profiles_count: number;
  last_audit?: string;
}

// ── SELinux ─────────────────────────────────────────────────────────────────

export type SelinuxMode = 'enforcing' | 'permissive' | 'disabled';

export interface SelinuxStatus {
  mode: SelinuxMode;
  policy_name: string;
  policy_version: string;
  max_kernel_policy_version: number;
  loaded_policy_type: string;
  root_login_allowed: boolean;
  max_open_files: number;
  max_categories: number;
  policy_deny_unknown: boolean;
}

export interface SelinuxBoolean {
  name: string;
  current_value: boolean;
  pending_value: boolean;
  description: string;
}

export interface SelinuxModule {
  name: string;
  version: string;
  priority: number;
  enabled: boolean;
  cil: boolean;
}

export interface SelinuxContext {
  user: string;
  role: string;
  type_field: string;
  level: string;
}

export interface SelinuxFileContext {
  pattern: string;
  context: string;
  file_type?: string;
}

export interface SelinuxPort {
  protocol: string;
  port_range: string;
  context_type: string;
}

export interface SelinuxUser {
  name: string;
  prefix: string;
  mls_level: string;
  mls_range: string;
  selinux_roles: string[];
}

export interface SelinuxRole {
  name: string;
  types: string[];
  default_type?: string;
}

export interface SelinuxPolicy {
  name: string;
  version: string;
  module_count: number;
  boolean_count: number;
}

export interface SelinuxAuditEntry {
  timestamp: string;
  event_type: string;
  source_context?: string;
  target_context?: string;
  target_class?: string;
  permission?: string;
  result: string;
  comm?: string;
  path?: string;
  pid?: number;
}

export interface SetBooleanRequest {
  name: string;
  value: boolean;
  persistent: boolean;
}

export interface SetModeRequest {
  mode: SelinuxMode;
  persistent: boolean;
}

export interface AddFileContextRequest {
  pattern: string;
  context_type: string;
  context: string;
}

export interface AddPortContextRequest {
  protocol: string;
  port_range: string;
  context_type: string;
}

export type ModuleAction = 'install' | 'remove' | 'enable' | 'disable';

export interface ManageModuleRequest {
  action: ModuleAction;
  name: string;
  data_base64?: string;
}

// ── AppArmor ────────────────────────────────────────────────────────────────

export interface AppArmorStatus {
  version: string;
  profiles_loaded: number;
  profiles_enforcing: number;
  profiles_complain: number;
  profiles_kill: number;
  profiles_unconfined: number;
  processes_confined: number;
  processes_unconfined: number;
}

export type AppArmorMode =
  | 'enforce'
  | 'complain'
  | 'kill'
  | 'unconfined'
  | 'disabled';

export interface AppArmorProfile {
  name: string;
  mode: AppArmorMode;
  pid_count: number;
  source_path?: string;
}

export interface AppArmorLogEntry {
  timestamp: string;
  profile_name: string;
  operation: string;
  denied: boolean;
  info?: string;
  comm?: string;
  requested_mask?: string;
  fsuid?: number;
  ouid?: number;
  target?: string;
}

export interface SetProfileModeRequest {
  profile_name: string;
  mode: AppArmorMode;
}

export interface CreateProfileRequest {
  program_path: string;
  template?: string;
  description?: string;
}

// ── TOMOYO ──────────────────────────────────────────────────────────────────

export interface TomoyoStatus {
  enabled: boolean;
  learning_domains: number;
  enforcing_domains: number;
  permissive_domains: number;
}

export type TomoyoMode = 'disabled' | 'learning' | 'permissive' | 'enforcing';

export interface TomoyoDomain {
  name: string;
  mode: TomoyoMode;
  rules_count: number;
}

export interface TomoyoRule {
  domain: string;
  permission: string;
  target: string;
}

export interface SetDomainModeRequest {
  domain: string;
  mode: TomoyoMode;
}

// ── SMACK ───────────────────────────────────────────────────────────────────

export interface SmackStatus {
  enabled: boolean;
  labels_count: number;
  rules_count: number;
  default_label: string;
}

export interface SmackLabel {
  name: string;
  associated_processes: number;
  access_count: number;
}

export interface SmackRule {
  subject: string;
  object: string;
  access: string;
}

export interface AddSmackRuleRequest {
  subject: string;
  object: string;
  access: string;
}

// ── Compliance ──────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type CheckStatus =
  | 'pass'
  | 'fail'
  | 'warning'
  | 'not_applicable'
  | 'error';

export interface ComplianceCheck {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  status: CheckStatus;
  remediation?: string;
}

export interface ComplianceResult {
  framework: string;
  total_checks: number;
  passed: number;
  failed: number;
  warnings: number;
  score_percent: number;
  checks: ComplianceCheck[];
  timestamp: string;
}
