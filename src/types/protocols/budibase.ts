// ── TypeScript types for sorng-budibase crate ────────────────────────────────

// ── Connection ────────────────────────────────────────────────────────────────

export interface BudibaseConnectionConfig {
  name: string;
  host: string;
  apiKey: string;
  appId?: string;
  timeoutSeconds?: number;
  skipTlsVerify?: boolean;
}

export interface BudibaseConnectionStatus {
  connected: boolean;
  host: string;
  version?: string;
  tenantId?: string;
}

// ── Apps ──────────────────────────────────────────────────────────────────────

export interface BudibaseAppIcon {
  name?: string;
  color?: string;
}

export interface BudibaseApp {
  _id?: string;
  name: string;
  url?: string;
  status?: string;
  deployed: boolean;
  createdAt?: string;
  updatedAt?: string;
  version?: string;
  tenantId?: string;
  lockedBy?: string;
  icon?: BudibaseAppIcon;
  features: Record<string, unknown>;
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

// ── Tables ───────────────────────────────────────────────────────────────────

export interface FieldLengthConstraint {
  minimum?: number;
  maximum?: number;
}

export interface FieldNumericConstraint {
  greaterThanOrEqualTo?: number;
  lessThanOrEqualTo?: number;
}

export interface FieldDateConstraint {
  latest?: string;
  earliest?: string;
}

export interface FieldConstraints {
  type?: string;
  presence?: boolean;
  length?: FieldLengthConstraint;
  numericality?: FieldNumericConstraint;
  inclusion?: string[];
  datetime?: FieldDateConstraint;
}

export interface TableFieldSchema {
  type: string;
  name?: string;
  constraints?: FieldConstraints;
  visible?: boolean;
  order?: number;
  width?: number;
  formula?: string;
  relationshipType?: string;
  tableId?: string;
  fieldName?: string;
  subtype?: string;
  autoColumn?: boolean;
}

export interface BudibaseTable {
  _id?: string;
  _rev?: string;
  name: string;
  type?: string;
  sourceId?: string;
  sourceType?: string;
  primaryDisplay?: string;
  schema: Record<string, TableFieldSchema>;
  createdAt?: string;
  updatedAt?: string;
  views: Record<string, unknown>;
}

export interface CreateTableRequest {
  name: string;
  schema: Record<string, TableFieldSchema>;
  primaryDisplay?: string;
  type?: string;
}

export interface UpdateTableRequest {
  _id: string;
  _rev?: string;
  name: string;
  schema: Record<string, TableFieldSchema>;
  primaryDisplay?: string;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type BudibaseRow = Record<string, unknown>;

export interface RangeFilter {
  low?: unknown;
  high?: unknown;
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
  fuzzy?: Record<string, string>;
  string?: Record<string, string>;
}

export interface RowSort {
  column: string;
  order?: string;
  type?: string;
}

export interface RowSearchRequest {
  query: RowSearchQuery;
  paginate?: boolean;
  bookmark?: unknown;
  limit?: number;
  sort?: RowSort;
}

export interface RowSearchResponse {
  rows: BudibaseRow[];
  totalRows?: number;
  hasNextPage?: boolean;
  bookmark?: unknown;
}

export interface BulkRowDeleteRequest {
  rows: BudibaseRow[];
}

export interface BulkRowResponse {
  successful: BudibaseRow[];
  failed: BudibaseRow[];
}

// ── Views ────────────────────────────────────────────────────────────────────

export interface BudibaseView {
  id?: string;
  name: string;
  tableId: string;
  type?: string;
  query?: unknown;
  schema?: Record<string, unknown>;
  primaryDisplay?: string;
}

export interface CreateViewRequest {
  name: string;
  tableId: string;
  type?: string;
  query?: unknown;
  schema?: Record<string, unknown>;
  primaryDisplay?: string;
}

export interface ViewQueryResponse {
  rows: BudibaseRow[];
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface BudibaseBuilderRole {
  global: boolean;
  apps: string[];
}

export interface BudibaseAdminRole {
  global: boolean;
}

export interface BudibaseUser {
  _id?: string;
  email: string;
  roles: Record<string, string>;
  firstName?: string;
  lastName?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  builder?: BudibaseBuilderRole;
  admin?: BudibaseAdminRole;
  tenantId?: string;
  forceResetPassword: boolean;
}

export interface CreateUserRequest {
  email: string;
  password?: string;
  roles: Record<string, string>;
  firstName?: string;
  lastName?: string;
  builder?: BudibaseBuilderRole;
  admin?: BudibaseAdminRole;
  forceResetPassword?: boolean;
}

export interface UpdateUserRequest {
  _id: string;
  email?: string;
  password?: string;
  roles: Record<string, string>;
  firstName?: string;
  lastName?: string;
  builder?: BudibaseBuilderRole;
  admin?: BudibaseAdminRole;
  forceResetPassword?: boolean;
}

export interface UserSearchResponse {
  data: BudibaseUser[];
  hasNextPage?: boolean;
  bookmark?: string;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export interface QueryParameter {
  name: string;
  defaultValue?: string;
}

export interface BudibaseQuery {
  _id?: string;
  name: string;
  datasourceId: string;
  queryVerb?: string;
  fields?: unknown;
  parameters?: QueryParameter[];
  transformer?: string;
  readable?: boolean;
  schema?: Record<string, unknown>;
}

export interface QueryPagination {
  limit?: number;
  page?: string;
}

export interface ExecuteQueryRequest {
  parameters: Record<string, unknown>;
  pagination?: QueryPagination;
}

export interface QueryExecutionResponse {
  data: unknown[];
  pagination?: QueryPagination;
}

// ── Automations ──────────────────────────────────────────────────────────────

export interface AutomationDefinition {
  trigger?: unknown;
  steps: unknown[];
}

export interface BudibaseAutomation {
  _id?: string;
  _rev?: string;
  name?: string;
  appId?: string;
  definition?: AutomationDefinition;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  disabled: boolean;
}

export interface CreateAutomationRequest {
  name: string;
  definition: AutomationDefinition;
  type?: string;
}

export interface TriggerAutomationRequest {
  fields: Record<string, unknown>;
  timeout?: number;
}

export interface TriggerAutomationResponse {
  message?: string;
  value?: unknown;
}

export interface AutomationStepLog {
  stepId?: string;
  status?: string;
  outputs?: unknown;
  inputs?: unknown;
}

export interface AutomationLog {
  _id?: string;
  automationId: string;
  status?: string;
  createdAt?: string;
  trigger?: unknown;
  steps: AutomationStepLog[];
}

export interface AutomationLogSearchRequest {
  automationId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  page?: number;
}

export interface AutomationLogSearchResponse {
  data: AutomationLog[];
  hasNextPage?: boolean;
  bookmark?: string;
}

// ── Datasources ──────────────────────────────────────────────────────────────

export interface BudibaseDatasource {
  _id?: string;
  _rev?: string;
  name: string;
  source: string;
  config: Record<string, unknown>;
  plus?: boolean;
  type?: string;
}

export interface CreateDatasourceRequest {
  name: string;
  source: string;
  config: Record<string, unknown>;
  plus?: boolean;
}

export interface UpdateDatasourceRequest {
  _id: string;
  _rev?: string;
  name?: string;
  source?: string;
  config?: Record<string, unknown>;
}

export interface DatasourceTestResponse {
  connected: boolean;
  error?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  bookmark?: string;
}
