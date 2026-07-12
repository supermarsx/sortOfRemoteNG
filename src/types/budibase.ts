// Budibase integration types — camelCase 1:1 mirror of the crate's wire shapes.
//
// Source: src-tauri/crates/sorng-budibase/src/types.rs
// All structs there derive `#[serde(rename_all = "camelCase")]`, so snake_case
// Rust fields serialize to camelCase JSON — mirrored here. Fields carrying an
// explicit `#[serde(rename = "...")]` (e.g. `_id`, `_rev`, `type`) keep that
// wire name. `Option<T>` fields become optional (`?`); serde `#[serde(default)]`
// collections are always present on the wire but modelled optional-friendly.

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

export interface BudibaseConnectionConfig {
  /** User-chosen identifier for this connection. */
  name: string;
  /** Budibase host URL (e.g. "https://budibase.example.com"). */
  host: string;
  /** API key for authentication. */
  apiKey: string;
  /** Optional app ID to scope operations to a specific app. */
  appId?: string | null;
  /** Request timeout in seconds. */
  timeoutSeconds?: number | null;
  /** Whether to skip TLS certificate verification. */
  skipTlsVerify?: boolean;
}

export interface BudibaseConnectionStatus {
  connected: boolean;
  host: string;
  version?: string | null;
  tenantId?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Apps
// ═══════════════════════════════════════════════════════════════════════════════

export interface BudibaseAppIcon {
  name?: string | null;
  color?: string | null;
}

export interface BudibaseApp {
  _id?: string | null;
  name: string;
  url?: string | null;
  status?: string | null;
  deployed?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  version?: string | null;
  tenantId?: string | null;
  lockedBy?: string | null;
  icon?: BudibaseAppIcon | null;
  features?: Record<string, unknown>;
}

export interface CreateAppRequest {
  name: string;
  url?: string;
  template?: string;
  useTemplate?: boolean;
  fileImport?: boolean;
  encryptionPassword?: string;
}

export interface UpdateAppRequest {
  name?: string;
  url?: string;
  icon?: BudibaseAppIcon;
}

export interface AppPublishResponse {
  _id: string;
  status: string;
}

export interface AppExportResponse {
  data: number[];
  filename: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tables
// ═══════════════════════════════════════════════════════════════════════════════

export interface FieldLengthConstraint {
  minimum?: number | null;
  maximum?: number | null;
}

export interface FieldNumericConstraint {
  greaterThanOrEqualTo?: number | null;
  lessThanOrEqualTo?: number | null;
}

export interface FieldDateConstraint {
  latest?: string | null;
  earliest?: string | null;
}

export interface FieldConstraints {
  type?: string | null;
  presence?: boolean | null;
  length?: FieldLengthConstraint | null;
  numericality?: FieldNumericConstraint | null;
  inclusion?: string[] | null;
  datetime?: FieldDateConstraint | null;
}

export interface TableFieldSchema {
  type: string;
  name?: string | null;
  constraints?: FieldConstraints | null;
  visible?: boolean | null;
  order?: number | null;
  width?: number | null;
  formula?: string | null;
  relationshipType?: string | null;
  tableId?: string | null;
  fieldName?: string | null;
  subtype?: string | null;
  autoColumn?: boolean | null;
}

export interface BudibaseTable {
  _id?: string | null;
  _rev?: string | null;
  name: string;
  type?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  primaryDisplay?: string | null;
  schema?: Record<string, TableFieldSchema>;
  createdAt?: string | null;
  updatedAt?: string | null;
  views?: Record<string, unknown>;
}

export interface CreateTableRequest {
  name: string;
  schema?: Record<string, TableFieldSchema>;
  primaryDisplay?: string | null;
  type?: string | null;
}

export interface UpdateTableRequest {
  _id: string;
  _rev?: string | null;
  name: string;
  schema?: Record<string, TableFieldSchema>;
  primaryDisplay?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rows
// ═══════════════════════════════════════════════════════════════════════════════

/** Generic row represented as a JSON map (Rust `BudibaseRow = HashMap<..>`). */
export type BudibaseRow = Record<string, unknown>;

export interface RangeFilter {
  low?: unknown;
  high?: unknown;
}

export interface RowSort {
  column: string;
  order?: string | null;
  type?: string | null;
}

export interface RowSearchQuery {
  equal?: Record<string, unknown>;
  notEqual?: Record<string, unknown>;
  contains?: Record<string, unknown>;
  notContains?: Record<string, unknown>;
  range?: Record<string, RangeFilter>;
  empty?: Record<string, unknown>;
  notEmpty?: Record<string, unknown>;
  oneOf?: Record<string, unknown[]>;
  fuzzy?: Record<string, string> | null;
  string?: Record<string, string> | null;
}

export interface RowSearchRequest {
  query: RowSearchQuery;
  paginate?: boolean;
  bookmark?: unknown;
  limit?: number;
  sort?: RowSort;
}

export interface RowSearchResponse {
  rows?: BudibaseRow[];
  totalRows?: number | null;
  hasNextPage?: boolean | null;
  bookmark?: unknown;
}

export interface BulkRowDeleteRequest {
  rows: BudibaseRow[];
}

export interface BulkRowResponse {
  successful?: BudibaseRow[];
  failed?: BudibaseRow[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Views
// ═══════════════════════════════════════════════════════════════════════════════

export interface BudibaseView {
  id?: string | null;
  name: string;
  tableId: string;
  type?: string | null;
  query?: unknown;
  schema?: Record<string, unknown> | null;
  primaryDisplay?: string | null;
}

export interface CreateViewRequest {
  name: string;
  tableId: string;
  type?: string | null;
  query?: unknown;
  schema?: Record<string, unknown> | null;
  primaryDisplay?: string | null;
}

export interface ViewQueryResponse {
  rows?: BudibaseRow[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════════

export interface BudibaseBuilderRole {
  global?: boolean;
  apps?: string[];
}

export interface BudibaseAdminRole {
  global?: boolean;
}

export interface BudibaseUser {
  _id?: string | null;
  email: string;
  roles?: Record<string, string>;
  firstName?: string | null;
  lastName?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  builder?: BudibaseBuilderRole | null;
  admin?: BudibaseAdminRole | null;
  tenantId?: string | null;
  forceResetPassword?: boolean;
}

export interface CreateUserRequest {
  email: string;
  password?: string | null;
  roles?: Record<string, string>;
  firstName?: string | null;
  lastName?: string | null;
  builder?: BudibaseBuilderRole | null;
  admin?: BudibaseAdminRole | null;
  forceResetPassword?: boolean;
}

export interface UpdateUserRequest {
  _id: string;
  email?: string | null;
  password?: string | null;
  roles?: Record<string, string>;
  firstName?: string | null;
  lastName?: string | null;
  builder?: BudibaseBuilderRole | null;
  admin?: BudibaseAdminRole | null;
  forceResetPassword?: boolean;
}

export interface UserSearchResponse {
  data?: BudibaseUser[];
  hasNextPage?: boolean | null;
  bookmark?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Queries (saved data-source queries)
// ═══════════════════════════════════════════════════════════════════════════════

export interface QueryParameter {
  name: string;
  defaultValue?: string | null;
}

export interface BudibaseQuery {
  _id?: string | null;
  name: string;
  datasourceId: string;
  queryVerb?: string | null;
  fields?: unknown;
  parameters?: QueryParameter[] | null;
  transformer?: string | null;
  readable?: boolean | null;
  schema?: Record<string, unknown> | null;
}

export interface QueryPagination {
  limit?: number | null;
  page?: string | null;
}

export interface ExecuteQueryRequest {
  parameters?: Record<string, unknown>;
  pagination?: QueryPagination;
}

export interface QueryExecutionResponse {
  data?: unknown[];
  pagination?: QueryPagination | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Automations
// ═══════════════════════════════════════════════════════════════════════════════

export interface AutomationDefinition {
  trigger?: unknown;
  steps?: unknown[];
}

export interface BudibaseAutomation {
  _id?: string | null;
  _rev?: string | null;
  name?: string | null;
  appId?: string | null;
  definition?: AutomationDefinition | null;
  type?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  disabled?: boolean;
}

export interface CreateAutomationRequest {
  name: string;
  definition: AutomationDefinition;
  type?: string | null;
}

export interface TriggerAutomationRequest {
  fields?: Record<string, unknown>;
  timeout?: number | null;
}

export interface TriggerAutomationResponse {
  message?: string | null;
  value?: unknown;
}

export interface AutomationStepLog {
  stepId?: string | null;
  status?: string | null;
  outputs?: unknown;
  inputs?: unknown;
}

export interface AutomationLog {
  _id?: string | null;
  automationId: string;
  status?: string | null;
  createdAt?: string | null;
  trigger?: unknown;
  steps?: AutomationStepLog[];
}

export interface AutomationLogSearchRequest {
  automationId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  page?: number | null;
}

export interface AutomationLogSearchResponse {
  data?: AutomationLog[];
  hasNextPage?: boolean | null;
  bookmark?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Datasources
// ═══════════════════════════════════════════════════════════════════════════════

export interface BudibaseDatasource {
  _id?: string | null;
  _rev?: string | null;
  name: string;
  source: string;
  config?: Record<string, unknown>;
  plus?: boolean | null;
  type?: string | null;
}

export interface CreateDatasourceRequest {
  name: string;
  source: string;
  config?: Record<string, unknown>;
  plus?: boolean | null;
}

export interface UpdateDatasourceRequest {
  _id: string;
  _rev?: string | null;
  name?: string | null;
  source?: string | null;
  config?: Record<string, unknown> | null;
}

export interface DatasourceTestResponse {
  connected: boolean;
  error?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pagination helpers
// ═══════════════════════════════════════════════════════════════════════════════

export interface PaginationParams {
  page?: number | null;
  limit?: number | null;
  bookmark?: string | null;
}
