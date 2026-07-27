// Roundcube Webmail administration types.
//
// These interfaces mirror `sorng-roundcube/src/types.rs`. The Rust structs do
// not use a serde rename rule, so nested objects passed to Tauri use snake_case.
// Only top-level command arguments (`userId`, `bookId`, ...) are camelCase.

export interface RoundcubeConnectionConfig {
  base_url: string;
  username: string;
  password: string;
  timeout_secs?: number;
  tls_skip_verify?: boolean;
}

export interface RoundcubeConnectionSummary {
  host: string;
  version?: string | null;
  skin?: string | null;
  product_name?: string | null;
  plugins_count?: number | null;
}

export interface RoundcubeUserPreferences {
  language?: string | null;
  timezone?: string | null;
  date_format?: string | null;
  time_format?: string | null;
  skin?: string | null;
  page_size?: number | null;
  preview_pane?: boolean | null;
  html_editor?: boolean | null;
  compose_mode?: string | null;
}

export interface RoundcubeUser {
  id: string;
  username: string;
  mail_host?: string | null;
  language?: string | null;
  preferences?: RoundcubeUserPreferences | null;
  created?: string | null;
  last_login?: string | null;
}

export interface CreateRoundcubeUserRequest {
  username: string;
  mail_host?: string | null;
  language?: string | null;
}

export interface UpdateRoundcubeUserRequest {
  language?: string | null;
  preferences?: RoundcubeUserPreferences | null;
}

export interface RoundcubeIdentity {
  id: string;
  user_id: string;
  name: string;
  email: string;
  organization?: string | null;
  reply_to?: string | null;
  bcc?: string | null;
  signature?: string | null;
  html_signature?: boolean | null;
  is_standard?: boolean | null;
  changed?: string | null;
}

export interface CreateRoundcubeIdentityRequest {
  name: string;
  email: string;
  organization?: string | null;
  reply_to?: string | null;
  bcc?: string | null;
  signature?: string | null;
  html_signature?: boolean | null;
  is_standard?: boolean | null;
}

export interface UpdateRoundcubeIdentityRequest {
  name?: string | null;
  email?: string | null;
  organization?: string | null;
  reply_to?: string | null;
  bcc?: string | null;
  signature?: string | null;
  html_signature?: boolean | null;
  is_standard?: boolean | null;
}

export interface RoundcubeAddressBook {
  id: string;
  user_id?: string | null;
  name: string;
  readonly?: boolean | null;
  groups_count?: number | null;
  contacts_count?: number | null;
}

export interface RoundcubeContact {
  id: string;
  address_book_id?: string | null;
  name?: string | null;
  firstname?: string | null;
  surname?: string | null;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  notes?: string | null;
  vcard?: string | null;
}

export interface CreateRoundcubeContactRequest {
  name?: string | null;
  firstname?: string | null;
  surname?: string | null;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  notes?: string | null;
}

export type UpdateRoundcubeContactRequest = CreateRoundcubeContactRequest;

export interface RoundcubeFolder {
  name: string;
  delimiter?: string | null;
  special_use?: string | null;
  exists?: number | null;
  unseen?: number | null;
  subscribed?: boolean | null;
  children: RoundcubeFolder[];
}

export interface CreateRoundcubeFolderRequest {
  name: string;
  parent?: string | null;
}

export interface RenameRoundcubeFolderRequest {
  old_name: string;
  new_name: string;
}

export interface RoundcubeQuota {
  used_bytes?: number | null;
  total_bytes?: number | null;
  used_messages?: number | null;
  total_messages?: number | null;
}

export interface RoundcubeFilterCondition {
  header?: string | null;
  match_type?: string | null;
  value?: string | null;
}

export interface RoundcubeFilterAction {
  action_type?: string | null;
  target?: string | null;
  value?: string | null;
}

export interface RoundcubeFilter {
  id: string;
  name: string;
  enabled?: boolean | null;
  conditions: RoundcubeFilterCondition[];
  actions: RoundcubeFilterAction[];
  join_type?: string | null;
}

export interface CreateRoundcubeFilterRequest {
  name: string;
  enabled?: boolean | null;
  conditions: RoundcubeFilterCondition[];
  actions: RoundcubeFilterAction[];
  join_type?: string | null;
}

export interface UpdateRoundcubeFilterRequest {
  name?: string | null;
  enabled?: boolean | null;
  conditions?: RoundcubeFilterCondition[] | null;
  actions?: RoundcubeFilterAction[] | null;
  join_type?: string | null;
}

export interface RoundcubePlugin {
  name: string;
  version?: string | null;
  enabled?: boolean | null;
  description?: string | null;
  author?: string | null;
  homepage?: string | null;
}

export interface RoundcubePluginConfig {
  plugin_name: string;
  settings: Record<string, unknown>;
}

export interface RoundcubeSystemConfig {
  product_name?: string | null;
  skin?: string | null;
  default_host?: string | null;
  default_port?: number | null;
  smtp_server?: string | null;
  smtp_port?: number | null;
  support_url?: string | null;
  plugins_enabled: string[];
}

export interface RoundcubeSmtpConfig {
  server?: string | null;
  port?: number | null;
  user?: string | null;
  pass?: string | null;
  auth_type?: string | null;
}

export interface RoundcubeCacheStats {
  total_entries?: number | null;
  total_size_bytes?: number | null;
  expired_entries?: number | null;
}

export interface RoundcubeLogEntry {
  timestamp?: string | null;
  level?: string | null;
  message?: string | null;
  session_id?: string | null;
  user?: string | null;
}

export interface RoundcubeDbStats {
  size_bytes?: number | null;
  tables_count?: number | null;
  sessions_count?: number | null;
  cache_entries?: number | null;
}
