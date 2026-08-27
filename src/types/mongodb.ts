/**
 * Renderer contracts for the native `sorng-mongodb` client.
 *
 * The Rust DTOs in `sorng-mongodb/src/mongodb/types.rs` do not use
 * `serde(rename_all)`, so nested config objects and returned records use
 * snake_case. Top-level Tauri command arguments remain camelCase.
 */

/** Any JSON value (documents are relaxed extended JSON from the backend). */
export type MongoJsonValue =
  | string
  | number
  | boolean
  | null
  | MongoJsonValue[]
  | { [key: string]: MongoJsonValue };

export type MongoDocument = Record<string, MongoJsonValue>;

export type MongoAuthMechanism =
  | "ScramSha256"
  | "ScramSha1"
  | "X509"
  | "AwsIam"
  | "None";

export type MongoReadPreference =
  | "primary"
  | "primaryPreferred"
  | "secondary"
  | "secondaryPreferred"
  | "nearest";

/**
 * Frontend-only fields persisted on a MongoDB Connection. The registry owner
 * declares them on `Connection`; until then the hook reads them through
 * {@link MongoConnectionFields} via `readMongoFields`.
 */
export interface MongoTlsFields {
  enabled?: boolean;
  caPath?: string;
  /** Combined PEM client certificate + key file path (driver style). */
  certKeyPath?: string;
  allowInvalid?: boolean;
}

export interface MongoConnectionFields {
  mongoAuthDatabase?: string;
  mongoReplicaSet?: string;
  /** Overrides host/port/credentials when set. Secret-bearing. */
  mongoConnectionString?: string;
  mongoTls?: MongoTlsFields;
  mongoDirectConnection?: boolean;
  mongoReadPreference?: MongoReadPreference;
  mongoAuthMechanism?: MongoAuthMechanism;
  mongoConnectTimeoutSecs?: number;
}

export interface MongoTlsConfig {
  enabled: boolean;
  ca_cert_path?: string | null;
  client_cert_path?: string | null;
  client_key_path?: string | null;
  allow_invalid_certificates?: boolean;
}

export interface MongoConnectionConfig {
  label?: string | null;
  hosts: string[];
  database?: string | null;
  username?: string | null;
  password?: string | null;
  auth_database?: string | null;
  auth_mechanism?: MongoAuthMechanism | null;
  replica_set?: string | null;
  read_preference?: string | null;
  direct_connection?: boolean | null;
  app_name?: string | null;
  connection_string?: string | null;
  connect_timeout_secs?: number | null;
  server_selection_timeout_secs?: number | null;
  /** Deliberately unused: the native service refuses SSH tunnels. */
  ssh_tunnel?: null;
  tls?: MongoTlsConfig | null;
}

export type MongoConnectionStatus = "Connected" | "Disconnected" | "Error";

export interface MongoSessionInfo {
  id: string;
  label: string;
  hosts: string[];
  database?: string | null;
  status: MongoConnectionStatus;
  connected_at: string;
  server_version?: string | null;
  replica_set?: string | null;
}

export interface MongoDatabaseInfo {
  name: string;
}

export interface MongoCollectionInfo {
  name: string;
  collection_type: string;
}

export interface MongoCollectionStats {
  namespace: string;
  count: number;
  size: number;
  storage_size: number;
  num_indexes: number;
  total_index_size: number;
  capped: boolean;
}

export interface MongoUserInfo {
  user: string;
  database: string;
  roles: { role: string; db: string }[];
}

export interface MongoServerStatus {
  host: string;
  version: string;
  uptime_secs: number;
  connections: { current: number; available: number; total_created: number };
}

export interface MongoReplicaSetMember {
  name: string;
  state_str: string;
  state: number;
  health: number;
  self?: boolean | null;
  uptime?: number | null;
}

/** Query form used by the Find tab. Text fields hold JSON edited by the user. */
export interface MongoFindQuery {
  filter: MongoDocument;
  projection?: MongoDocument | null;
  sort?: MongoDocument | null;
  limit: number;
  skip: number;
}

export interface MongoFindResult {
  documents: MongoDocument[];
  returned: number;
  has_more: boolean;
  elapsed_ms: number;
}

export type MongoAggregateResult = MongoFindResult;

export interface MongoInsertResult {
  inserted_count: number;
  inserted_ids: MongoJsonValue[];
}

export interface MongoUpdateResult {
  matched_count: number;
  modified_count: number;
  upserted_id?: MongoJsonValue | null;
}

export interface MongoDeleteResult {
  deleted_count: number;
}

export interface MongoIndexInfo {
  name: string;
  /** Key specification, e.g. `{"city": 1}`. */
  keys: MongoDocument;
  unique: boolean;
  sparse: boolean;
  /** Complete index specification as reported by the server (relaxed extended JSON). */
  options: MongoDocument;
}

export const MONGO_FIND_LIMIT_MAX = 1000;
export const MONGO_FIND_LIMIT_DEFAULT = 50;

export const MONGO_INSECURE_TLS_ACKNOWLEDGEMENT =
  "I understand that MongoDB certificate verification is disabled for this connection only";
