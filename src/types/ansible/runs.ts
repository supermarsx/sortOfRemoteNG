// Ansible — "Playbooks & Runs" (runs) category domain types (t42-ansible-c1).
//
// 1:1 mirror of the inventory / playbook / ad-hoc / facts / history / execution
// types in `src-tauri/crates/sorng-ansible/src/types.rs`.
//
// ⚠ WIRE-FORMAT — this crate has NO `#[serde(rename_all = "camelCase")]`, so
// STRUCT FIELD names are serialised VERBATIM in snake_case. Mirror the Rust field
// names exactly (`ansible_host`, `last_refreshed`, `check_mode`, `extra_vars`, …).
// The `use_become` fields on Play/Task/Handler/RoleReference/PlaybookRunOptions
// carry `#[serde(rename = "become")]`, so they serialise as `become` — that is the
// property name used below. (Command ARG names are still camelCase — see the hook.)

// ─── Enums (Rust enums → string-literal unions) ──────────────────────────────

/** `ExecutionStatus` — aggregate run outcome. */
export type ExecutionStatus =
  | "Running"
  | "Success"
  | "Failed"
  | "Unreachable"
  | "Cancelled"
  | "TimedOut";

/** `HostStatus` — per-host / per-task outcome. */
export type HostStatus = "Ok" | "Changed" | "Failed" | "Unreachable" | "Skipped";

/** `IssueSeverity` — playbook lint / syntax issue level. */
export type IssueSeverity = "Error" | "Warning" | "Info";

/** `CommandType` — history-entry command classification. */
export type CommandType =
  | "Playbook"
  | "AdHoc"
  | "VaultEncrypt"
  | "VaultDecrypt"
  | "GalaxyInstall"
  | "FactGather"
  | "RoleInit"
  | "Other";

// ─── Inventory ───────────────────────────────────────────────────────────────

/** `InventorySource` — externally-tagged enum: exactly one key is present, its
 *  value the source string, e.g. `{ IniFile: "/etc/ansible/hosts" }`. */
export type InventorySource =
  | { IniFile: string }
  | { YamlFile: string }
  | { Directory: string }
  | { Script: string }
  | { Plugin: string }
  | { Inline: string };

/** A single host in the inventory. */
export interface InventoryHost {
  name: string;
  ansible_host: string | null;
  ansible_port: number | null;
  ansible_user: string | null;
  ansible_connection: string | null;
  ansible_python_interpreter: string | null;
  groups: string[];
  variables: Record<string, unknown>;
  enabled: boolean;
}

/** A group in the inventory. */
export interface InventoryGroup {
  name: string;
  hosts: string[];
  children: string[];
  variables: Record<string, unknown>;
}

/** Complete inventory representation returned by parse / dynamic. */
export interface Inventory {
  source: InventorySource;
  hosts: InventoryHost[];
  groups: InventoryGroup[];
  last_refreshed: string | null;
}

/** Parameters to add a host (payload for `ansible_inventory_add_host`). */
export interface AddHostParams {
  name: string;
  ansible_host: string | null;
  ansible_port: number | null;
  ansible_user: string | null;
  ansible_connection: string | null;
  groups: string[];
  variables: Record<string, unknown>;
}

/** Parameters to add a group (payload for `ansible_inventory_add_group`). */
export interface AddGroupParams {
  name: string;
  children: string[];
  variables: Record<string, unknown>;
}

/** Dynamic-inventory script configuration (`ansible_inventory_dynamic`). */
export interface DynamicInventoryConfig {
  script_path: string;
  args: string[];
  env: Record<string, string>;
  cache_ttl_secs: number | null;
}

// ─── Playbooks ─────────────────────────────────────────────────────────────

/** Loop-control parameters on a task. */
export interface LoopControl {
  loop_var: string | null;
  index_var: string | null;
  label: string | null;
  pause: number | null;
  extended: boolean | null;
}

/** A single task (recursive via block/rescue/always). */
export interface Task {
  name: string | null;
  module: string;
  args: Record<string, unknown>;
  /** `use_become` — serde-renamed to `become` on the wire. */
  become: boolean | null;
  become_user: string | null;
  when: unknown | null;
  with_items: unknown | null;
  loop_expr: unknown | null;
  loop_control: LoopControl | null;
  register: string | null;
  changed_when: unknown | null;
  failed_when: unknown | null;
  ignore_errors: boolean | null;
  no_log: boolean | null;
  delegate_to: string | null;
  run_once: boolean | null;
  notify: string[];
  tags: string[];
  block: Task[];
  rescue: Task[];
  always: Task[];
  retries: number | null;
  delay: number | null;
  until: unknown | null;
  environment: Record<string, string>;
}

/** A handler (a task that fires only on notification). */
export interface Handler {
  name: string;
  module: string;
  args: Record<string, unknown>;
  /** `use_become` — serde-renamed to `become` on the wire. */
  become: boolean | null;
  become_user: string | null;
  when: unknown | null;
  listen: string[];
  tags: string[];
}

/** Reference to a role inside a play. */
export interface RoleReference {
  role: string;
  vars: Record<string, unknown>;
  when: unknown | null;
  tags: string[];
  /** `use_become` — serde-renamed to `become` on the wire. */
  become: boolean | null;
  become_user: string | null;
}

/** A single play within a playbook. */
export interface Play {
  name: string | null;
  hosts: string;
  /** `use_become` — serde-renamed to `become` on the wire. */
  become: boolean | null;
  become_user: string | null;
  become_method: string | null;
  gather_facts: boolean | null;
  strategy: string | null;
  serial: unknown | null;
  max_fail_percentage: number | null;
  any_errors_fatal: boolean | null;
  connection: string | null;
  environment: Record<string, string>;
  vars: Record<string, unknown>;
  vars_files: string[];
  pre_tasks: Task[];
  tasks: Task[];
  post_tasks: Task[];
  handlers: Handler[];
  roles: RoleReference[];
  tags: string[];
}

/** A parsed playbook file (`ansible_playbook_parse`). */
export interface Playbook {
  path: string;
  name: string;
  plays: Play[];
  raw_yaml: string | null;
  file_size: number;
  last_modified: string | null;
}

/** Execution options for `ansible-playbook` (`run` / `check` / `diff`). */
export interface PlaybookRunOptions {
  playbook_path: string;
  inventory: string | null;
  limit: string | null;
  tags: string[];
  skip_tags: string[];
  extra_vars: Record<string, unknown>;
  extra_vars_files: string[];
  forks: number | null;
  check_mode: boolean;
  diff_mode: boolean;
  start_at_task: string | null;
  step: boolean;
  flush_cache: boolean;
  force_handlers: boolean;
  /** `use_become` — serde-renamed to `become` on the wire. */
  become: boolean | null;
  become_user: string | null;
  become_method: string | null;
  remote_user: string | null;
  private_key: string | null;
  ssh_common_args: string | null;
  timeout_secs: number | null;
  vault_password_file: string | null;
  verbosity: number | null;
  env_vars: Record<string, string>;
}

/** A single playbook validation issue (syntax-check / lint). */
export interface PlaybookIssue {
  line: number | null;
  column: number | null;
  message: string;
  severity: IssueSeverity;
  rule: string | null;
}

/** Playbook validation result (`syntax_check` / `lint`). */
export interface PlaybookValidation {
  valid: boolean;
  errors: PlaybookIssue[];
  warnings: PlaybookIssue[];
}

// ─── Ad-hoc commands ──────────────────────────────────────────────────────

/** Options for running an ad-hoc command (`ansible_adhoc_run`). */
export interface AdHocOptions {
  pattern: string;
  module: string;
  module_args: string | null;
  inventory: string | null;
  /** `use_become` — serde-renamed to `become` on the wire. */
  become: boolean | null;
  become_user: string | null;
  become_method: string | null;
  remote_user: string | null;
  private_key: string | null;
  forks: number | null;
  extra_vars: Record<string, unknown>;
  timeout_secs: number | null;
  poll: number | null;
  background: number | null;
  one_line: boolean;
  tree: string | null;
  vault_password_file: string | null;
  verbosity: number | null;
  env_vars: Record<string, string>;
}

// ─── Execution results ─────────────────────────────────────────────────────

/** Diff output for a single task. */
export interface TaskDiff {
  before: string;
  after: string;
  before_header: string | null;
  after_header: string | null;
}

/** Result for a single item when a task loops. */
export interface ItemResult {
  item: unknown;
  changed: boolean;
  failed: boolean;
  msg: string | null;
}

/** Per-task result on a given host. */
export interface TaskResult {
  task_name: string;
  module: string;
  status: HostStatus;
  changed: boolean;
  msg: string | null;
  stdout: string | null;
  stderr: string | null;
  rc: number | null;
  start_time: string | null;
  end_time: string | null;
  diff: TaskDiff | null;
  items: ItemResult[];
  skipped: boolean;
  skip_reason: string | null;
  failed: boolean;
  failure_reason: string | null;
}

/** Per-host result. */
export interface HostResult {
  host: string;
  status: HostStatus;
  task_results: TaskResult[];
  facts: Record<string, unknown> | null;
}

/** Summary statistics for a run. */
export interface PlayStats {
  ok: number;
  changed: number;
  unreachable: number;
  failed: number;
  skipped: number;
  rescued: number;
  ignored: number;
}

/** Aggregated result of a playbook or ad-hoc run. */
export interface ExecutionResult {
  id: string;
  status: ExecutionStatus;
  started_at: string;
  finished_at: string | null;
  duration_secs: number | null;
  host_results: HostResult[];
  stats: PlayStats;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  command: string;
}

// ─── Facts ───────────────────────────────────────────────────────────────

export interface MemoryFacts {
  total: number;
  free: number;
  used: number;
  swap_total: number;
  swap_free: number;
}

export interface NetworkInterfaceFacts {
  name: string;
  ipv4: string | null;
  ipv6: string | null;
  mac_address: string | null;
  mtu: number | null;
  active: boolean;
  speed: number | null;
  interface_type: string | null;
}

export interface MountFacts {
  mount: string;
  device: string;
  fstype: string;
  options: string;
  size_total: number | null;
  size_available: number | null;
}

export interface SelinuxFacts {
  status: string;
  mode: string | null;
  policy_version: string | null;
  config_mode: string | null;
}

/** Host facts gathered by the setup module (`ansible_facts_gather`). */
export interface HostFacts {
  hostname: string;
  fqdn: string | null;
  os_family: string | null;
  distribution: string | null;
  distribution_version: string | null;
  distribution_release: string | null;
  kernel: string | null;
  architecture: string | null;
  processor: string[];
  processor_count: number | null;
  memory_mb: MemoryFacts | null;
  interfaces: NetworkInterfaceFacts[];
  mounts: MountFacts[];
  ipv4_addresses: string[];
  ipv6_addresses: string[];
  uptime_seconds: number | null;
  python_version: string | null;
  selinux: SelinuxFacts | null;
  virtualization_type: string | null;
  virtualization_role: string | null;
  all_facts: Record<string, unknown>;
}

// ─── Execution history ─────────────────────────────────────────────────────

/** Stored execution run for history / audit. */
export interface ExecutionHistoryEntry {
  id: string;
  command_type: CommandType;
  command: string;
  started_at: string;
  finished_at: string | null;
  status: ExecutionStatus;
  exit_code: number | null;
  host_count: number;
  ok: number;
  changed: number;
  failed: number;
  unreachable: number;
  user: string | null;
  tags: string[];
}
