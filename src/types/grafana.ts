// Grafana integration types (t42-grafana).
//
// 1:1 mirror of the wire shapes produced by `sorng-grafana/src/types.rs`.
// Serde convention in that crate is PER-FIELD explicit `#[serde(rename)]` to
// camelCase (there is NO container `rename_all`), so:
//   - single-word fields stay as-is (same in snake/camel),
//   - multi-word response fields are camelCase (matching each `rename`),
//   - EXCEPTION: `GrafanaConnectionConfig` and `GrafanaConnectionSummary` have
//     NO renames at all, so their multi-word fields are snake_case on the wire
//     (`use_tls`, `org_id`, `org_name`, `user_count`, ...). Mirrored exactly.
//
// Only the types reachable from the 46 REGISTERED commands
// (`sorng-commands-ops/src/ops_handler.rs`) are included. The crate defines a
// few more structs (HealthResponse, DashboardVersion, SaveDashboard*,
// AlertNotification, PanelPlugin*) bound only to unregistered commands — those
// are intentionally omitted (see the hook header / t42 plan R4).

// ── Connection ───────────────────────────────────────────────────────────────

/** Request struct for `grafana_connect`. No serde rename → snake_case wire. */
export interface GrafanaConnectionConfig {
  host: string;
  port?: number;
  use_tls?: boolean;
  accept_invalid_certs?: boolean;
  api_key?: string;
  username?: string;
  password?: string;
  org_id?: number;
  timeout_secs?: number;
}

/** Response of `grafana_connect`. No serde rename → snake_case wire. */
export interface GrafanaConnectionSummary {
  host: string;
  version: string;
  org_name: string;
  user_count: number;
  dashboard_count: number;
}

// ── Dashboards ───────────────────────────────────────────────────────────────

export interface Dashboard {
  id?: number;
  uid?: string;
  title?: string;
  url?: string;
  slug?: string;
  type?: string;
  tags?: string[];
  isStarred?: boolean;
  uri?: string;
  folderId?: number;
  folderUid?: string;
  folderTitle?: string;
  folderUrl?: string;
}

export interface DashboardMeta {
  type?: string;
  canSave?: boolean;
  canEdit?: boolean;
  canAdmin?: boolean;
  canStar?: boolean;
  canDelete?: boolean;
  slug?: string;
  url?: string;
  expires?: string;
  created?: string;
  updated?: string;
  updatedBy?: string;
  createdBy?: string;
  version?: number;
  hasAcl?: boolean;
  isFolder?: boolean;
  provisioned?: boolean;
  provisionedExternalId?: string;
}

export interface DashboardDetail {
  meta: DashboardMeta;
  /** Raw dashboard model JSON (serde_json::Value). */
  dashboard: unknown;
}

// ── Datasources ──────────────────────────────────────────────────────────────

export interface Datasource {
  id?: number;
  uid?: string;
  orgId?: number;
  name?: string;
  type?: string;
  typeLogoUrl?: string;
  access?: string;
  url?: string;
  password?: string;
  user?: string;
  database?: string;
  basicAuth?: boolean;
  basicAuthUser?: string;
  withCredentials?: boolean;
  isDefault?: boolean;
  jsonData?: unknown;
  secureJsonFields?: Record<string, boolean>;
  version?: number;
  readOnly?: boolean;
}

/** Request struct for `grafana_create_datasource`. */
export interface DatasourceCreateRequest {
  name: string;
  type: string;
  url?: string;
  access?: string;
  basicAuth?: boolean;
  basicAuthUser?: string;
  basicAuthPassword?: string;
  database?: string;
  user?: string;
  password?: string;
  jsonData?: unknown;
  isDefault?: boolean;
}

// ── Folders ──────────────────────────────────────────────────────────────────

export interface Folder {
  id?: number;
  uid?: string;
  title?: string;
  url?: string;
  hasAcl?: boolean;
  canSave?: boolean;
  canEdit?: boolean;
  canAdmin?: boolean;
  canDelete?: boolean;
  created?: string;
  updated?: string;
  createdBy?: string;
  updatedBy?: string;
  version?: number;
}

// ── Organizations ────────────────────────────────────────────────────────────

export interface OrgAddress {
  address1?: string;
  address2?: string;
  city?: string;
  zipCode?: string;
  state?: string;
  country?: string;
}

export interface Organization {
  id?: number;
  name?: string;
  address?: OrgAddress;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface GrafanaUser {
  id?: number;
  email?: string;
  name?: string;
  login?: string;
  theme?: string;
  orgId?: number;
  isGrafanaAdmin?: boolean;
  isDisabled?: boolean;
  isExternal?: boolean;
  authLabels?: string[];
  updatedAt?: string;
  createdAt?: string;
  avatarUrl?: string;
}

// ── Teams ────────────────────────────────────────────────────────────────────

export interface Team {
  id?: number;
  orgId?: number;
  name?: string;
  email?: string;
  avatarUrl?: string;
  memberCount?: number;
  permission?: number;
}

export interface TeamMember {
  orgId?: number;
  teamId?: number;
  userId?: number;
  authModule?: string;
  email?: string;
  name?: string;
  login?: string;
  avatarUrl?: string;
  labels?: string[];
  permission?: number;
}

// ── Alerts ───────────────────────────────────────────────────────────────────

/** Both the request (`grafana_create_alert_rule`) and response shape. Note the
 *  uppercase `orgID` / `folderUID` renames and the reserved-word `for` key. */
export interface AlertRule {
  id?: number;
  uid?: string;
  orgID?: number;
  folderUID?: string;
  ruleGroup?: string;
  title?: string;
  condition?: string;
  data?: unknown;
  updated?: string;
  noDataState?: string;
  execErrState?: string;
  for?: string;
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
  isPaused?: boolean;
}

// ── Annotations ──────────────────────────────────────────────────────────────

export interface Annotation {
  id?: number;
  alertId?: number;
  alertName?: string;
  dashboardId?: number;
  dashboardUID?: string;
  panelId?: number;
  userId?: number;
  userName?: string;
  newState?: string;
  prevState?: string;
  created?: number;
  updated?: number;
  time?: number;
  timeEnd?: number;
  text?: string;
  tags?: string[];
}

/** Request struct for `grafana_create_annotation`. */
export interface CreateAnnotationRequest {
  dashboardUID?: string;
  panelId?: number;
  time?: number;
  timeEnd?: number;
  tags?: string[];
  text: string;
}

// ── Playlists ────────────────────────────────────────────────────────────────

export interface PlaylistItem {
  type?: string;
  value?: string;
  order?: number;
  title?: string;
}

export interface Playlist {
  id?: number;
  name?: string;
  interval?: string;
  items?: PlaylistItem[];
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export interface Snapshot {
  id?: number;
  name?: string;
  key?: string;
  orgId?: number;
  userId?: number;
  external?: boolean;
  externalUrl?: string;
  dashboard?: unknown;
  expires?: string;
  created?: string;
  updated?: string;
  url?: string;
  deleteUrl?: string;
}

// ── Search ───────────────────────────────────────────────────────────────────

/** Request struct for `grafana_search_dashboards`. */
export interface SearchQuery {
  query?: string;
  tag?: string[];
  type?: string;
  dashboardIds?: number[];
  folderIds?: number[];
  starred?: boolean;
  limit?: number;
  page?: number;
}
