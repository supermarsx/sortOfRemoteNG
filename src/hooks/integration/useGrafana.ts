// useGrafana — real Tauri `invoke(...)` wrappers for the sorng-grafana backend.
//
// Binds the 46 Grafana commands actually registered in the Tauri handler
// (`sorng-commands-ops/src/ops_handler.rs`). The crate's `commands.rs` defines
// 10 further functions (ping, save_dashboard, list_dashboard_versions,
// get_dashboard_tags, switch_org, get_current_user, set_user_admin,
// list_alert_notifications, list_panel_plugins, get_panel_plugin) that are NOT
// wired into the handler — invoking them would fail at runtime, so they are
// intentionally not exposed here (see the panel header note / t42 plan R4).
//
// Every command is keyed by a connection `id` (the backend holds a map of live
// clients). Command arg names are camelCase — Tauri v2 maps them to the Rust
// snake_case `#[tauri::command]` params (e.g. `dsId` → `ds_id`). The `config`
// object mirrors `GrafanaConnectionConfig`'s serde wire shape, which has NO
// rename → snake_case (`use_tls`, `api_key`, `org_id`, ...).

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "./httpProxy";
import type {
  AlertRule,
  Annotation,
  CreateAnnotationRequest,
  Dashboard,
  DashboardDetail,
  Datasource,
  DatasourceCreateRequest,
  Folder,
  GrafanaConnectionConfig,
  GrafanaConnectionSummary,
  GrafanaUser,
  Organization,
  Playlist,
  SearchQuery,
  Snapshot,
  Team,
  TeamMember,
} from "../../types/grafana";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const grafanaApi = {
  // Connection lifecycle
  connect: (id: string, config: GrafanaConnectionConfig) =>
    invoke<GrafanaConnectionSummary>("grafana_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("grafana_disconnect", { id }),
  listConnections: () => invoke<string[]>("grafana_list_connections"),

  // Dashboards
  searchDashboards: (id: string, query: SearchQuery) =>
    invoke<Dashboard[]>("grafana_search_dashboards", { id, query }),
  getDashboard: (id: string, uid: string) =>
    invoke<DashboardDetail>("grafana_get_dashboard", { id, uid }),
  deleteDashboard: (id: string, uid: string) =>
    invoke<unknown>("grafana_delete_dashboard", { id, uid }),
  getHomeDashboard: (id: string) =>
    invoke<DashboardDetail>("grafana_get_home_dashboard", { id }),

  // Datasources
  listDatasources: (id: string) =>
    invoke<Datasource[]>("grafana_list_datasources", { id }),
  getDatasource: (id: string, dsId: number) =>
    invoke<Datasource>("grafana_get_datasource", { id, dsId }),
  createDatasource: (id: string, request: DatasourceCreateRequest) =>
    invoke<unknown>("grafana_create_datasource", { id, request }),
  deleteDatasource: (id: string, dsId: number) =>
    invoke<unknown>("grafana_delete_datasource", { id, dsId }),
  testDatasource: (id: string, dsId: number) =>
    invoke<boolean>("grafana_test_datasource", { id, dsId }),

  // Folders
  listFolders: (id: string) => invoke<Folder[]>("grafana_list_folders", { id }),
  getFolder: (id: string, uid: string) =>
    invoke<Folder>("grafana_get_folder", { id, uid }),
  createFolder: (id: string, title: string, uid?: string) =>
    invoke<Folder>("grafana_create_folder", { id, uid, title }),
  deleteFolder: (id: string, uid: string) =>
    invoke<unknown>("grafana_delete_folder", { id, uid }),

  // Organizations
  getCurrentOrg: (id: string) =>
    invoke<Organization>("grafana_get_current_org", { id }),
  listOrgs: (id: string) => invoke<Organization[]>("grafana_list_orgs", { id }),
  getOrg: (id: string, orgId: number) =>
    invoke<Organization>("grafana_get_org", { id, orgId }),
  createOrg: (id: string, name: string) =>
    invoke<unknown>("grafana_create_org", { id, name }),
  deleteOrg: (id: string, orgId: number) =>
    invoke<unknown>("grafana_delete_org", { id, orgId }),

  // Users
  listUsers: (id: string) =>
    invoke<GrafanaUser[]>("grafana_list_users", { id }),
  getUser: (id: string, userId: number) =>
    invoke<GrafanaUser>("grafana_get_user", { id, userId }),
  createUser: (
    id: string,
    login: string,
    password: string,
    name?: string,
    email?: string,
    orgId?: number,
  ) =>
    invoke<unknown>("grafana_create_user", {
      id,
      name,
      login,
      email,
      password,
      orgId,
    }),
  deleteUser: (id: string, userId: number) =>
    invoke<unknown>("grafana_delete_user", { id, userId }),

  // Teams
  listTeams: (id: string, query?: string) =>
    invoke<Team[]>("grafana_list_teams", { id, query }),
  getTeam: (id: string, teamId: number) =>
    invoke<Team>("grafana_get_team", { id, teamId }),
  createTeam: (id: string, name: string, email?: string) =>
    invoke<unknown>("grafana_create_team", { id, name, email }),
  deleteTeam: (id: string, teamId: number) =>
    invoke<unknown>("grafana_delete_team", { id, teamId }),
  listTeamMembers: (id: string, teamId: number) =>
    invoke<TeamMember[]>("grafana_list_team_members", { id, teamId }),
  addTeamMember: (id: string, teamId: number, userId: number) =>
    invoke<unknown>("grafana_add_team_member", { id, teamId, userId }),
  removeTeamMember: (id: string, teamId: number, userId: number) =>
    invoke<unknown>("grafana_remove_team_member", { id, teamId, userId }),

  // Alerts
  listAlertRules: (id: string, folderUid?: string, ruleGroup?: string) =>
    invoke<AlertRule[]>("grafana_list_alert_rules", {
      id,
      folderUid,
      ruleGroup,
    }),
  getAlertRule: (id: string, uid: string) =>
    invoke<AlertRule>("grafana_get_alert_rule", { id, uid }),
  createAlertRule: (id: string, rule: AlertRule) =>
    invoke<AlertRule>("grafana_create_alert_rule", { id, rule }),
  deleteAlertRule: (id: string, uid: string) =>
    invoke<unknown>("grafana_delete_alert_rule", { id, uid }),
  pauseAlertRule: (id: string, uid: string, paused: boolean) =>
    invoke<AlertRule>("grafana_pause_alert_rule", { id, uid, paused }),

  // Annotations
  listAnnotations: (
    id: string,
    from?: number,
    to?: number,
    dashboardId?: number,
    panelId?: number,
    tags?: string[],
    limit?: number,
  ) =>
    invoke<Annotation[]>("grafana_list_annotations", {
      id,
      from,
      to,
      dashboardId,
      panelId,
      tags,
      limit,
    }),
  createAnnotation: (id: string, request: CreateAnnotationRequest) =>
    invoke<Annotation>("grafana_create_annotation", { id, request }),
  deleteAnnotation: (id: string, annId: number) =>
    invoke<unknown>("grafana_delete_annotation", { id, annId }),

  // Playlists
  listPlaylists: (id: string) =>
    invoke<Playlist[]>("grafana_list_playlists", { id }),
  getPlaylist: (id: string, playlistId: number) =>
    invoke<Playlist>("grafana_get_playlist", { id, playlistId }),
  deletePlaylist: (id: string, playlistId: number) =>
    invoke<unknown>("grafana_delete_playlist", { id, playlistId }),

  // Snapshots
  listSnapshots: (id: string) =>
    invoke<Snapshot[]>("grafana_list_snapshots", { id }),
  createSnapshot: (
    id: string,
    dashboard: unknown,
    name?: string,
    expires?: number,
  ) =>
    invoke<unknown>("grafana_create_snapshot", {
      id,
      dashboard,
      name,
      expires,
    }),
  deleteSnapshot: (id: string, key: string) =>
    invoke<unknown>("grafana_delete_snapshot", { id, key }),
};

export type GrafanaApi = typeof grafanaApi;

// ─── React hook ──────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful Grafana session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, plus shared `isLoading`/`error`, and exposes the full
 * registered command surface via `api` (each call takes the connection id). The
 * `run` wrapper funnels arbitrary ops through the same loading/error handling.
 */
export function useGrafana() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<GrafanaConnectionSummary | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against overlapping in-flight ops flipping isLoading incorrectly.
  const inflight = useRef(0);

  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    inflight.current += 1;
    setIsLoading(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setIsLoading(false);
    }
  }, []);

  const connect = useCallback(
    async (id: string, config: GrafanaConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await grafanaApi.connect(id, withGlobalHttpProxy(config));
        setConnectionId(id);
        setSummary(s);
        return true;
      } catch (e) {
        setError(errMsg(e));
        return false;
      } finally {
        setIsConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      await grafanaApi.disconnect(connectionId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, [connectionId]);

  const clearError = useCallback(() => setError(null), []);

  return {
    // state
    connectionId,
    summary,
    isConnected: connectionId !== null,
    isConnecting,
    isLoading,
    error,
    setError,
    clearError,
    // lifecycle
    connect,
    disconnect,
    // full registered command surface + shared runner
    api: grafanaApi,
    run,
  };
}

export type GrafanaManager = ReturnType<typeof useGrafana>;
