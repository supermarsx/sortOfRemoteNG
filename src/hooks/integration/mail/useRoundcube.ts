// Roundcube Webmail administration hook.
//
// All 63 wrappers below match the commands registered from
// `sorng-roundcube/src/commands.rs`. Tauri command arguments use camelCase,
// while nested Rust structs keep their snake_case serde wire shape.

import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useIntegrationConnectionLifecycle } from "../../integrations/IntegrationSessionLifecycle";
import type {
  CreateRoundcubeContactRequest,
  CreateRoundcubeFilterRequest,
  CreateRoundcubeFolderRequest,
  CreateRoundcubeIdentityRequest,
  CreateRoundcubeUserRequest,
  RenameRoundcubeFolderRequest,
  RoundcubeAddressBook,
  RoundcubeCacheStats,
  RoundcubeConnectionConfig,
  RoundcubeConnectionSummary,
  RoundcubeContact,
  RoundcubeDbStats,
  RoundcubeFilter,
  RoundcubeFolder,
  RoundcubeIdentity,
  RoundcubeLogEntry,
  RoundcubePlugin,
  RoundcubePluginConfig,
  RoundcubeQuota,
  RoundcubeSmtpConfig,
  RoundcubeSystemConfig,
  RoundcubeUser,
  RoundcubeUserPreferences,
  UpdateRoundcubeContactRequest,
  UpdateRoundcubeFilterRequest,
  UpdateRoundcubeIdentityRequest,
  UpdateRoundcubeUserRequest,
} from "../../../types/mail/roundcube";

export const roundcubeApi = {
  // Connection lifecycle (4)
  connect: (id: string, config: RoundcubeConnectionConfig) =>
    invoke<RoundcubeConnectionSummary>("rc_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("rc_disconnect", { id }),
  listConnections: () => invoke<string[]>("rc_list_connections"),
  ping: (id: string) => invoke<RoundcubeConnectionSummary>("rc_ping", { id }),

  // Users (7)
  listUsers: (id: string) => invoke<RoundcubeUser[]>("rc_list_users", { id }),
  getUser: (id: string, userId: string) =>
    invoke<RoundcubeUser>("rc_get_user", { id, userId }),
  createUser: (id: string, req: CreateRoundcubeUserRequest) =>
    invoke<RoundcubeUser>("rc_create_user", { id, req }),
  updateUser: (id: string, userId: string, req: UpdateRoundcubeUserRequest) =>
    invoke<RoundcubeUser>("rc_update_user", { id, userId, req }),
  deleteUser: (id: string, userId: string) =>
    invoke<void>("rc_delete_user", { id, userId }),
  getUserPreferences: (id: string, userId: string) =>
    invoke<RoundcubeUserPreferences>("rc_get_user_preferences", {
      id,
      userId,
    }),
  updateUserPreferences: (
    id: string,
    userId: string,
    prefs: RoundcubeUserPreferences,
  ) =>
    invoke<RoundcubeUserPreferences>("rc_update_user_preferences", {
      id,
      userId,
      prefs,
    }),

  // Identities (6)
  listIdentities: (id: string, userId: string) =>
    invoke<RoundcubeIdentity[]>("rc_list_identities", { id, userId }),
  getIdentity: (id: string, userId: string, identityId: string) =>
    invoke<RoundcubeIdentity>("rc_get_identity", {
      id,
      userId,
      identityId,
    }),
  createIdentity: (
    id: string,
    userId: string,
    req: CreateRoundcubeIdentityRequest,
  ) => invoke<RoundcubeIdentity>("rc_create_identity", { id, userId, req }),
  updateIdentity: (
    id: string,
    userId: string,
    identityId: string,
    req: UpdateRoundcubeIdentityRequest,
  ) =>
    invoke<RoundcubeIdentity>("rc_update_identity", {
      id,
      userId,
      identityId,
      req,
    }),
  deleteIdentity: (id: string, userId: string, identityId: string) =>
    invoke<void>("rc_delete_identity", { id, userId, identityId }),
  setDefaultIdentity: (id: string, userId: string, identityId: string) =>
    invoke<void>("rc_set_default_identity", { id, userId, identityId }),

  // Address books and contacts (9)
  listAddressBooks: (id: string) =>
    invoke<RoundcubeAddressBook[]>("rc_list_address_books", { id }),
  getAddressBook: (id: string, bookId: string) =>
    invoke<RoundcubeAddressBook>("rc_get_address_book", { id, bookId }),
  listContacts: (id: string, bookId: string) =>
    invoke<RoundcubeContact[]>("rc_list_contacts", { id, bookId }),
  getContact: (id: string, bookId: string, contactId: string) =>
    invoke<RoundcubeContact>("rc_get_contact", { id, bookId, contactId }),
  createContact: (
    id: string,
    bookId: string,
    req: CreateRoundcubeContactRequest,
  ) => invoke<RoundcubeContact>("rc_create_contact", { id, bookId, req }),
  updateContact: (
    id: string,
    bookId: string,
    contactId: string,
    req: UpdateRoundcubeContactRequest,
  ) =>
    invoke<RoundcubeContact>("rc_update_contact", {
      id,
      bookId,
      contactId,
      req,
    }),
  deleteContact: (id: string, bookId: string, contactId: string) =>
    invoke<void>("rc_delete_contact", { id, bookId, contactId }),
  searchContacts: (id: string, bookId: string, query: string) =>
    invoke<RoundcubeContact[]>("rc_search_contacts", { id, bookId, query }),
  exportVcard: (id: string, bookId: string, contactId: string) =>
    invoke<string>("rc_export_vcard", { id, bookId, contactId }),

  // Folders and quota (9)
  listFolders: (id: string) =>
    invoke<RoundcubeFolder[]>("rc_list_folders", { id }),
  getFolder: (id: string, name: string) =>
    invoke<RoundcubeFolder>("rc_get_folder", { id, name }),
  createFolder: (id: string, req: CreateRoundcubeFolderRequest) =>
    invoke<void>("rc_create_folder", { id, req }),
  renameFolder: (id: string, req: RenameRoundcubeFolderRequest) =>
    invoke<void>("rc_rename_folder", { id, req }),
  deleteFolder: (id: string, name: string) =>
    invoke<void>("rc_delete_folder", { id, name }),
  subscribeFolder: (id: string, name: string) =>
    invoke<void>("rc_subscribe_folder", { id, name }),
  unsubscribeFolder: (id: string, name: string) =>
    invoke<void>("rc_unsubscribe_folder", { id, name }),
  purgeFolder: (id: string, name: string) =>
    invoke<void>("rc_purge_folder", { id, name }),
  getQuota: (id: string) => invoke<RoundcubeQuota>("rc_get_quota", { id }),

  // ManageSieve filters (8)
  listFilters: (id: string) =>
    invoke<RoundcubeFilter[]>("rc_list_filters", { id }),
  getFilter: (id: string, filterId: string) =>
    invoke<RoundcubeFilter>("rc_get_filter", { id, filterId }),
  createFilter: (id: string, req: CreateRoundcubeFilterRequest) =>
    invoke<RoundcubeFilter>("rc_create_filter", { id, req }),
  updateFilter: (
    id: string,
    filterId: string,
    req: UpdateRoundcubeFilterRequest,
  ) => invoke<RoundcubeFilter>("rc_update_filter", { id, filterId, req }),
  deleteFilter: (id: string, filterId: string) =>
    invoke<void>("rc_delete_filter", { id, filterId }),
  enableFilter: (id: string, filterId: string) =>
    invoke<void>("rc_enable_filter", { id, filterId }),
  disableFilter: (id: string, filterId: string) =>
    invoke<void>("rc_disable_filter", { id, filterId }),
  reorderFilters: (id: string, ids: string[]) =>
    invoke<void>("rc_reorder_filters", { id, ids }),

  // Plugins (6)
  listPlugins: (id: string) =>
    invoke<RoundcubePlugin[]>("rc_list_plugins", { id }),
  getPlugin: (id: string, name: string) =>
    invoke<RoundcubePlugin>("rc_get_plugin", { id, name }),
  enablePlugin: (id: string, name: string) =>
    invoke<void>("rc_enable_plugin", { id, name }),
  disablePlugin: (id: string, name: string) =>
    invoke<void>("rc_disable_plugin", { id, name }),
  getPluginConfig: (id: string, name: string) =>
    invoke<RoundcubePluginConfig>("rc_get_plugin_config", { id, name }),
  updatePluginConfig: (
    id: string,
    name: string,
    settings: Record<string, unknown>,
  ) => invoke<void>("rc_update_plugin_config", { id, name, settings }),

  // Settings, cache, and logs (7)
  getSystemConfig: (id: string) =>
    invoke<RoundcubeSystemConfig>("rc_get_system_config", { id }),
  updateSystemConfig: (id: string, config: RoundcubeSystemConfig) =>
    invoke<RoundcubeSystemConfig>("rc_update_system_config", { id, config }),
  getSmtpConfig: (id: string) =>
    invoke<RoundcubeSmtpConfig>("rc_get_smtp_config", { id }),
  updateSmtpConfig: (id: string, config: RoundcubeSmtpConfig) =>
    invoke<RoundcubeSmtpConfig>("rc_update_smtp_config", { id, config }),
  getCacheStats: (id: string) =>
    invoke<RoundcubeCacheStats>("rc_get_cache_stats", { id }),
  clearCache: (id: string) => invoke<void>("rc_clear_cache", { id }),
  getLogs: (id: string, limit?: number, level?: string) =>
    invoke<RoundcubeLogEntry[]>("rc_get_logs", { id, limit, level }),

  // Maintenance (7)
  vacuumDb: (id: string) => invoke<void>("rc_vacuum_db", { id }),
  optimizeDb: (id: string) => invoke<void>("rc_optimize_db", { id }),
  clearTempFiles: (id: string) => invoke<void>("rc_clear_temp_files", { id }),
  clearExpiredSessions: (id: string) =>
    invoke<void>("rc_clear_expired_sessions", { id }),
  getDbStats: (id: string) =>
    invoke<RoundcubeDbStats>("rc_get_db_stats", { id }),
  testSmtp: (id: string, to: string) =>
    invoke<boolean>("rc_test_smtp", { id, to }),
  testImap: (id: string, host: string, user: string, pass: string) =>
    invoke<boolean>("rc_test_imap", { id, host, user, pass }),
};

export type RoundcubeApi = typeof roundcubeApi;

const errorMessage = (error: unknown): string =>
  typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : String(error);

const isAlreadyDisconnected = (error: unknown): boolean =>
  /not connected|no connection/i.test(errorMessage(error));

/**
 * Owns one Roundcube backend handle. Successful connections are registered with
 * the shared integration-session lifecycle, which supplies reconnect,
 * session-close, and sub-tab-unmount teardown behavior.
 */
export function useRoundcube() {
  const lifecycle = useIntegrationConnectionLifecycle();
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<RoundcubeConnectionSummary | null>(
    null,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(0);
  const lastConnection = useRef<{
    id: string;
    config: RoundcubeConnectionConfig;
  } | null>(null);

  const run = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      inflight.current += 1;
      setIsLoading(true);
      setError(null);
      try {
        return await operation();
      } catch (operationError) {
        setError(errorMessage(operationError));
        throw operationError;
      } finally {
        inflight.current -= 1;
        if (inflight.current === 0) setIsLoading(false);
      }
    },
    [],
  );

  const connect = useCallback(
    async (id: string, config: RoundcubeConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      const key = `mail.roundcube:${id}`;
      const disconnectHandle = async () => {
        try {
          await roundcubeApi.disconnect(id);
        } catch (disconnectError) {
          if (!isAlreadyDisconnected(disconnectError)) throw disconnectError;
        } finally {
          setConnectionId(null);
          setSummary(null);
        }
      };

      try {
        await lifecycle.trackConnect(
          key,
          async () => {
            const nextSummary = await roundcubeApi.connect(id, config);
            lastConnection.current = { id, config };
            setConnectionId(id);
            setSummary(nextSummary);
            return nextSummary;
          },
          disconnectHandle,
        );
        return true;
      } catch (connectError) {
        setError(errorMessage(connectError));
        return false;
      } finally {
        setIsConnecting(false);
      }
    },
    [lifecycle],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    const id = connectionId;
    try {
      await lifecycle.trackDisconnect(`mail.roundcube:${id}`, async () => {
        try {
          await roundcubeApi.disconnect(id);
        } catch (disconnectError) {
          if (!isAlreadyDisconnected(disconnectError)) {
            throw disconnectError;
          }
        }
      });
    } catch (disconnectError) {
      setError(errorMessage(disconnectError));
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, [connectionId, lifecycle]);

  const reconnect = useCallback(async (): Promise<boolean> => {
    const previous = lastConnection.current;
    if (!previous) {
      setError("No successful Roundcube connection is available to reconnect.");
      return false;
    }
    return connect(previous.id, previous.config);
  }, [connect]);

  const refreshSummary = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      setSummary(await run(() => roundcubeApi.ping(connectionId)));
    } catch {
      // `run` keeps the original backend error visible.
    }
  }, [connectionId, run]);

  const clearError = useCallback(() => setError(null), []);

  return {
    connectionId,
    summary,
    isConnected: connectionId !== null,
    isConnecting,
    isLoading,
    error,
    setError,
    clearError,
    connect,
    disconnect,
    reconnect,
    refreshSummary,
    api: roundcubeApi,
    run,
  };
}

export type RoundcubeManager = ReturnType<typeof useRoundcube>;
