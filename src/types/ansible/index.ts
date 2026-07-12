// Ansible integration — shared/connection types + barrel (t42 §4b, crate lead
// t42-ansible-L).
//
// 1:1 mirror of the connection types in
// `src-tauri/crates/sorng-ansible/src/types.rs`.
//
// ⚠ WIRE-FORMAT NOTE — this crate does NOT set `#[serde(rename_all="camelCase")]`,
// so STRUCT field names are serialised VERBATIM in snake_case (`ansible_bin_path`,
// `working_directory`, `python_version`, …). This differs from most t42 crates.
// Tauri still camelCases COMMAND ARGUMENT names (`id`, `config`, `filePath`,
// `roleName`, …) — only the struct payload fields are snake_case. Category
// executors: mirror the Rust field names exactly (snake_case), and watch the
// `#[serde(rename = "become")]` fields on Play/Task/Handler/PlaybookRunOptions/
// AdHocOptions which serialise as `become`, not `use_become`.
//
// Domain types (inventory/playbooks/adhoc/facts/history and roles/vault/galaxy/
// config) live in the per-category files `./runs.ts` and `./content.ts`, owned by
// the category executor. Their re-exports are appended to the marked region at the
// end of this file by the per-crate integrator — keep this file's own declarations
// above that region.

/** `AnsibleStatus` — overall control-node status summary. */
export type AnsibleStatus =
  | "Available"
  | "NotInstalled"
  | "VersionMismatch"
  | "ConfigError"
  | "Unknown";

/** `AnsibleConnectionConfig` — the connect form's payload. Mirror of the Rust
 *  struct of the same name (snake_case wire fields, see note above). `id`/`name`
 *  are set to the persisted instance id/name by the shell; the `*_bin_path` fields
 *  auto-detect server-side when null. */
export interface AnsibleConnectionConfig {
  id: string;
  name: string;
  /** Path to the `ansible` binary (auto-detected if null). */
  ansible_bin_path: string | null;
  /** Path to the `ansible-playbook` binary. */
  ansible_playbook_bin_path: string | null;
  /** Path to the `ansible-vault` binary. */
  ansible_vault_bin_path: string | null;
  /** Path to the `ansible-galaxy` binary. */
  ansible_galaxy_bin_path: string | null;
  /** Working directory for command execution. */
  working_directory: string | null;
  /** Path to `ansible.cfg`. */
  config_path: string | null;
  /** Default inventory source (file, directory, or comma-separated hosts). */
  default_inventory: string | null;
  /** Default remote user. */
  remote_user: string | null;
  /** Default private-key path. */
  private_key_path: string | null;
  /** SSH common args (e.g. `"-o StrictHostKeyChecking=no"`). */
  ssh_common_args: string | null;
  /** Extra environment variables to inject. */
  env_vars: Record<string, string>;
  /** Vault password file path. */
  vault_password_file: string | null;
  /** Whether to prompt for the vault password interactively (unused headless). */
  ask_vault_pass: boolean;
  /** Default verbosity level (0–4, mapping to `-v` … `-vvvv`). */
  verbosity: number;
  /** RFC3339 created timestamp. */
  created_at: string;
  /** RFC3339 updated timestamp. */
  updated_at: string;
  /** Arbitrary labels for UI grouping. */
  labels: Record<string, string>;
}

/** Information returned by `ansible_connect` / `ansible_get_info` — the detected
 *  control-node identity. */
export interface AnsibleInfo {
  version: string;
  python_version: string;
  config_file: string | null;
  default_module_path: string | null;
  executable: string;
  available_modules: string[];
  available_plugins: string[];
}

// ── category type re-exports (appended by the per-crate integrator) ──────────
// export * from "./runs";
// export * from "./content";
