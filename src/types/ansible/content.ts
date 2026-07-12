// Ansible — "Roles, Galaxy & Vault" (content) category domain types
// (t42-ansible-c1).
//
// 1:1 mirror of the role / vault / galaxy / config / module types in
// `src-tauri/crates/sorng-ansible/src/types.rs`.
//
// ⚠ WIRE-FORMAT — this crate has NO `#[serde(rename_all = "camelCase")]`, so
// STRUCT FIELD names are serialised VERBATIM in snake_case. Mirror the Rust field
// names exactly (`role_name`, `min_ansible_version`, `roles_path`, `param_type`,
// `return_values`, …). (Command ARG names are still camelCase — see the hook.)

// ─── Enums (Rust enums → string-literal unions) ──────────────────────────────

/** `RoleInitType` — scaffolding template for a new role. */
export type RoleInitType = "Default" | "Container" | "Network" | "Apb";

/** `ConfigOrigin` — where a config setting's value came from. */
export type ConfigOrigin =
  | "Default"
  | "ConfigFile"
  | "Environment"
  | "CommandLine";

// ─── Roles ───────────────────────────────────────────────────────────────

/** Which standard subdirectories a role contains. */
export interface RoleStructure {
  has_tasks: boolean;
  has_handlers: boolean;
  has_defaults: boolean;
  has_vars: boolean;
  has_files: boolean;
  has_templates: boolean;
  has_meta: boolean;
  has_tests: boolean;
  has_readme: boolean;
}

/** A supported platform declaration in role/galaxy metadata. */
export interface RolePlatform {
  name: string;
  versions: string[];
}

/** A role dependency reference. */
export interface RoleDependency {
  role: string;
  version: string | null;
  source: string | null;
}

/** Galaxy metadata block (`meta/main.yml` galaxy_info). */
export interface GalaxyRoleMeta {
  role_name: string | null;
  namespace: string | null;
  description: string | null;
  author: string | null;
  license: string | null;
  min_ansible_version: string | null;
  platforms: RolePlatform[];
  galaxy_tags: string[];
  dependencies: RoleDependency[];
}

/** An Ansible role discovered on disk (`ansible_roles_list` / `role_inspect`). */
export interface Role {
  name: string;
  path: string;
  namespace: string | null;
  version: string | null;
  description: string | null;
  author: string | null;
  license: string | null;
  min_ansible_version: string | null;
  platforms: RolePlatform[];
  dependencies: RoleDependency[];
  galaxy_info: GalaxyRoleMeta | null;
  structure: RoleStructure;
}

/** Options for scaffolding a new role (`ansible_role_init`). */
export interface RoleInitOptions {
  name: string;
  path: string | null;
  init_type: RoleInitType;
  offline: boolean;
}

// ─── Vault ───────────────────────────────────────────────────────────────

/** Options for `ansible_vault_rekey`. */
export interface VaultRekeyOptions {
  file_path: string;
  old_vault_password_file: string | null;
  new_vault_password_file: string | null;
  old_vault_id: string | null;
  new_vault_id: string | null;
}

/** Options for `ansible_vault_encrypt_string`. */
export interface VaultEncryptStringOptions {
  plaintext: string;
  variable_name: string;
  vault_password_file: string | null;
  vault_id: string | null;
}

/** Vault operation result (encrypt / decrypt / rekey). */
export interface VaultResult {
  success: boolean;
  output: string;
  encrypted: boolean | null;
}

// ─── Galaxy ──────────────────────────────────────────────────────────────

/** An installed Ansible Galaxy collection (`ansible_galaxy_list_collections`). */
export interface GalaxyCollection {
  namespace: string;
  name: string;
  version: string;
  path: string | null;
  description: string | null;
  authors: string[];
  dependencies: Record<string, string>;
  tags: string[];
  repository: string | null;
  homepage: string | null;
  documentation: string | null;
}

/** Install options for role / collection installs. */
export interface GalaxyInstallOptions {
  name: string;
  version: string | null;
  roles_path: string | null;
  collections_path: string | null;
  force: boolean;
  no_deps: boolean;
  requirements_file: string | null;
}

/** Search options for `ansible_galaxy_search`. */
export interface GalaxySearchOptions {
  query: string;
  galaxy_tags: string[];
  platforms: string[];
  author: string | null;
  order_by: string | null;
  page: number | null;
  page_size: number | null;
}

/** A Galaxy search / installed-role result row. */
export interface GalaxySearchResult {
  name: string;
  namespace: string;
  description: string | null;
  download_count: number | null;
  stars: number | null;
  created: string | null;
  modified: string | null;
}

// ─── Configuration & modules ────────────────────────────────────────────────

/** Parsed `ansible.cfg` (`ansible_config_parse_file`). */
export interface AnsibleConfig {
  source: string | null;
  sections: Record<string, Record<string, string>>;
}

/** A single effective configuration setting (`config_dump` / `config_get`). */
export interface ConfigSetting {
  key: string;
  value: string;
  section: string;
  origin: ConfigOrigin;
  default: string | null;
  description: string | null;
}

/** A documented module parameter. */
export interface ModuleParameter {
  name: string;
  description: string | null;
  param_type: string | null;
  required: boolean;
  default: unknown | null;
  choices: unknown[];
  aliases: string[];
}

/** A documented module return value. */
export interface ModuleReturnValue {
  name: string;
  description: string | null;
  returned: string | null;
  return_type: string | null;
  sample: unknown | null;
}

/** Module documentation (`ansible_module_doc`). */
export interface ModuleInfo {
  name: string;
  namespace: string | null;
  short_description: string | null;
  description: string | null;
  parameters: ModuleParameter[];
  examples: string | null;
  return_values: ModuleReturnValue[];
}
