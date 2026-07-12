// useCyrusSasl — real Tauri `invoke(...)` wrappers for the sorng-cyrus-sasl
// backend, plus a stateful session hook for the Mail Server » Cyrus SASL sub-tab.
//
// Binds ALL 51 `sasl_*` commands from
// `src-tauri/crates/sorng-cyrus-sasl/src/commands.rs` (prefix is `sasl_`, NOT
// `cyrus_`). Every command is keyed by a connection `id` (the backend holds a map
// of live sessions). Argument names match the Rust `#[tauri::command]` params;
// Tauri converts snake_case params to camelCase on the JS side (`app_name` →
// `appName`). The `config` object mirrors `CyrusSaslConnectionConfig`'s serde wire
// shape (snake_case).

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AuxpropPlugin,
  CreateSaslUserRequest,
  CyrusSaslConnectionConfig,
  CyrusSaslConnectionSummary,
  SaslAppConfig,
  SaslDbEntry,
  SaslInfo,
  SaslMechanism,
  SaslTestResult,
  SaslUser,
  SaslauthConfig,
  SaslauthStatus,
  UpdateSaslUserRequest,
} from "../../../types/mail/cyrusSasl";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ─────────────────────

export const cyrusSaslApi = {
  // Connection lifecycle (4)
  connect: (id: string, config: CyrusSaslConnectionConfig) =>
    invoke<CyrusSaslConnectionSummary>("sasl_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("sasl_disconnect", { id }),
  listConnections: () => invoke<string[]>("sasl_list_connections"),
  ping: (id: string) => invoke<boolean>("sasl_ping", { id }),

  // Mechanisms (6)
  listMechanisms: (id: string) =>
    invoke<SaslMechanism[]>("sasl_list_mechanisms", { id }),
  getMechanism: (id: string, name: string) =>
    invoke<SaslMechanism>("sasl_get_mechanism", { id, name }),
  listAvailableMechanisms: (id: string) =>
    invoke<SaslMechanism[]>("sasl_list_available_mechanisms", { id }),
  listEnabledMechanisms: (id: string) =>
    invoke<string[]>("sasl_list_enabled_mechanisms", { id }),
  enableMechanism: (id: string, name: string) =>
    invoke<void>("sasl_enable_mechanism", { id, name }),
  disableMechanism: (id: string, name: string) =>
    invoke<void>("sasl_disable_mechanism", { id, name }),

  // Users & realms (7)
  listUsers: (id: string) => invoke<SaslUser[]>("sasl_list_users", { id }),
  getUser: (id: string, username: string, realm: string) =>
    invoke<SaslUser>("sasl_get_user", { id, username, realm }),
  createUser: (id: string, request: CreateSaslUserRequest) =>
    invoke<void>("sasl_create_user", { id, request }),
  updateUser: (
    id: string,
    username: string,
    realm: string,
    request: UpdateSaslUserRequest,
  ) => invoke<void>("sasl_update_user", { id, username, realm, request }),
  deleteUser: (id: string, username: string, realm: string) =>
    invoke<void>("sasl_delete_user", { id, username, realm }),
  testAuth: (id: string, username: string, realm: string, password: string) =>
    invoke<SaslTestResult>("sasl_test_auth", { id, username, realm, password }),
  listRealms: (id: string) => invoke<string[]>("sasl_list_realms", { id }),

  // saslauthd (9)
  getSaslauthdConfig: (id: string) =>
    invoke<SaslauthConfig>("sasl_get_saslauthd_config", { id }),
  setSaslauthdConfig: (id: string, config: SaslauthConfig) =>
    invoke<void>("sasl_set_saslauthd_config", { id, config }),
  getSaslauthdStatus: (id: string) =>
    invoke<SaslauthStatus>("sasl_get_saslauthd_status", { id }),
  startSaslauthd: (id: string) => invoke<void>("sasl_start_saslauthd", { id }),
  stopSaslauthd: (id: string) => invoke<void>("sasl_stop_saslauthd", { id }),
  restartSaslauthd: (id: string) =>
    invoke<void>("sasl_restart_saslauthd", { id }),
  setSaslauthdMechanism: (id: string, mech: string) =>
    invoke<void>("sasl_set_saslauthd_mechanism", { id, mech }),
  setSaslauthdFlags: (id: string, flags: string[]) =>
    invoke<void>("sasl_set_saslauthd_flags", { id, flags }),
  testSaslauthdAuth: (
    id: string,
    username: string,
    password: string,
    service: string,
    realm: string,
  ) =>
    invoke<SaslTestResult>("sasl_test_saslauthd_auth", {
      id,
      username,
      password,
      service,
      realm,
    }),

  // App config (7)
  listApps: (id: string) => invoke<string[]>("sasl_list_apps", { id }),
  getAppConfig: (id: string, appName: string) =>
    invoke<SaslAppConfig>("sasl_get_app_config", { id, appName }),
  setAppConfig: (id: string, appName: string, config: SaslAppConfig) =>
    invoke<void>("sasl_set_app_config", { id, appName, config }),
  deleteAppConfig: (id: string, appName: string) =>
    invoke<void>("sasl_delete_app_config", { id, appName }),
  getAppParam: (id: string, appName: string, key: string) =>
    invoke<string>("sasl_get_app_param", { id, appName, key }),
  setAppParam: (id: string, appName: string, key: string, value: string) =>
    invoke<void>("sasl_set_app_param", { id, appName, key, value }),
  deleteAppParam: (id: string, appName: string, key: string) =>
    invoke<void>("sasl_delete_app_param", { id, appName, key }),

  // auxprop (4)
  listAuxprop: (id: string) =>
    invoke<AuxpropPlugin[]>("sasl_list_auxprop", { id }),
  getAuxprop: (id: string, name: string) =>
    invoke<AuxpropPlugin>("sasl_get_auxprop", { id, name }),
  configureAuxprop: (
    id: string,
    name: string,
    settings: Record<string, string>,
  ) => invoke<void>("sasl_configure_auxprop", { id, name, settings }),
  testAuxprop: (id: string, name: string) =>
    invoke<SaslTestResult>("sasl_test_auxprop", { id, name }),

  // sasldb (6)
  listDbEntries: (id: string) =>
    invoke<SaslDbEntry[]>("sasl_list_db_entries", { id }),
  getDbEntry: (id: string, username: string, realm: string) =>
    invoke<SaslDbEntry[]>("sasl_get_db_entry", { id, username, realm }),
  setDbPassword: (
    id: string,
    username: string,
    realm: string,
    password: string,
  ) => invoke<void>("sasl_set_db_password", { id, username, realm, password }),
  deleteDbEntry: (id: string, username: string, realm: string) =>
    invoke<void>("sasl_delete_db_entry", { id, username, realm }),
  dumpDb: (id: string) => invoke<string>("sasl_dump_db", { id }),
  importDb: (id: string, data: string) =>
    invoke<void>("sasl_import_db", { id, data }),

  // Service (8)
  start: (id: string) => invoke<void>("sasl_start", { id }),
  stop: (id: string) => invoke<void>("sasl_stop", { id }),
  restart: (id: string) => invoke<void>("sasl_restart", { id }),
  reload: (id: string) => invoke<void>("sasl_reload", { id }),
  status: (id: string) => invoke<string>("sasl_status", { id }),
  version: (id: string) => invoke<string>("sasl_version", { id }),
  info: (id: string) => invoke<SaslInfo>("sasl_info", { id }),
  testConfig: (id: string) =>
    invoke<SaslTestResult>("sasl_test_config", { id }),
};

export type CyrusSaslApi = typeof cyrusSaslApi;

// ─── React hook ────────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful Cyrus SASL session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, plus shared `isLoading`/`error`, and exposes the full
 * 51-command surface via `api` (each call takes the connection id). The `run`
 * wrapper funnels arbitrary ops through the same loading/error handling.
 */
export function useCyrusSasl() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CyrusSaslConnectionSummary | null>(
    null,
  );
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
    async (id: string, config: CyrusSaslConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await cyrusSaslApi.connect(id, config);
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
      await cyrusSaslApi.disconnect(connectionId);
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
    // full command surface + shared runner
    api: cyrusSaslApi,
    run,
  };
}

export type CyrusSaslManager = ReturnType<typeof useCyrusSasl>;
