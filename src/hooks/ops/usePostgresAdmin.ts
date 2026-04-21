import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Thin wrapper for Postgres admin Tauri commands (sorng-postgres-admin).
 *
 * Covers all 94 `pg_admin_*` commands registered via slot `b` in
 * `sorng-commands-ops::ops_handler`. Types are intentionally loose
 * (`unknown` / explicit request object) to keep this hook lightweight;
 * callers that need strong typing can cast results at the call site.
 */
export function usePostgresAdmin() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const wrap = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // --- Connection ---
  const connect = (config: unknown) =>
    wrap(async () => {
      const id = await invoke<string>("pg_admin_connect", { config });
      setConnectionId(id);
      return id;
    });
  const disconnect = (id: string) =>
    wrap(() => invoke<void>("pg_admin_disconnect", { id }));
  const listConnections = () =>
    wrap(() => invoke<string[]>("pg_admin_list_connections"));

  // --- Roles ---
  const listRoles = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_roles", { id }));
  const getRole = (id: string, name: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_role", { id, name }));
  const createRole = (id: string, spec: unknown) =>
    wrap(() => invoke<unknown>("pg_admin_create_role", { id, spec }));
  const alterRole = (id: string, spec: unknown) =>
    wrap(() => invoke<unknown>("pg_admin_alter_role", { id, spec }));
  const dropRole = (id: string, name: string) =>
    wrap(() => invoke<void>("pg_admin_drop_role", { id, name }));
  const renameRole = (id: string, oldName: string, newName: string) =>
    wrap(() => invoke<void>("pg_admin_rename_role", { id, oldName, newName }));
  const grantRole = (id: string, spec: unknown) =>
    wrap(() => invoke<void>("pg_admin_grant_role", { id, spec }));
  const revokeRole = (id: string, spec: unknown) =>
    wrap(() => invoke<void>("pg_admin_revoke_role", { id, spec }));
  const setRolePassword = (id: string, name: string, password: string) =>
    wrap(() => invoke<void>("pg_admin_set_role_password", { id, name, password }));
  const listRoleMemberships = (id: string, name: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_role_memberships", { id, name }));

  // --- Databases ---
  const listDatabases = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_databases", { id }));
  const getDatabase = (id: string, name: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_database", { id, name }));
  const createDatabase = (id: string, spec: unknown) =>
    wrap(() => invoke<unknown>("pg_admin_create_database", { id, spec }));
  const dropDatabase = (id: string, name: string) =>
    wrap(() => invoke<void>("pg_admin_drop_database", { id, name }));
  const renameDatabase = (id: string, oldName: string, newName: string) =>
    wrap(() => invoke<void>("pg_admin_rename_database", { id, oldName, newName }));
  const alterDatabaseOwner = (id: string, name: string, owner: string) =>
    wrap(() => invoke<void>("pg_admin_alter_database_owner", { id, name, owner }));
  const getDatabaseSize = (id: string, name: string) =>
    wrap(() => invoke<number>("pg_admin_get_database_size", { id, name }));
  const getDatabaseConnections = (id: string, name: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_get_database_connections", { id, name }));
  const terminateConnections = (id: string, name: string) =>
    wrap(() => invoke<void>("pg_admin_terminate_connections", { id, name }));
  const listDatabaseSchemas = (id: string, name: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_database_schemas", { id, name }));

  // --- pg_hba ---
  const listHba = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_hba", { id }));
  const addHba = (id: string, entry: unknown) =>
    wrap(() => invoke<void>("pg_admin_add_hba", { id, entry }));
  const removeHba = (id: string, index: number) =>
    wrap(() => invoke<void>("pg_admin_remove_hba", { id, index }));
  const updateHba = (id: string, index: number, entry: unknown) =>
    wrap(() => invoke<void>("pg_admin_update_hba", { id, index, entry }));
  const reloadHba = (id: string) =>
    wrap(() => invoke<void>("pg_admin_reload_hba", { id }));
  const getHbaRaw = (id: string) =>
    wrap(() => invoke<string>("pg_admin_get_hba_raw", { id }));
  const setHbaRaw = (id: string, contents: string) =>
    wrap(() => invoke<void>("pg_admin_set_hba_raw", { id, contents }));
  const validateHba = (id: string) =>
    wrap(() => invoke<unknown>("pg_admin_validate_hba", { id }));

  // --- Replication ---
  const getReplicationStatus = (id: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_replication_status", { id }));
  const listReplicationSlots = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_replication_slots", { id }));
  const createReplicationSlot = (id: string, spec: unknown) =>
    wrap(() => invoke<unknown>("pg_admin_create_replication_slot", { id, spec }));
  const dropReplicationSlot = (id: string, name: string) =>
    wrap(() => invoke<void>("pg_admin_drop_replication_slot", { id, name }));
  const createPhysicalReplicationSlot = (id: string, name: string) =>
    wrap(() =>
      invoke<unknown>("pg_admin_create_physical_replication_slot", { id, name }),
    );
  const createLogicalReplicationSlot = (
    id: string,
    name: string,
    plugin: string,
  ) =>
    wrap(() =>
      invoke<unknown>("pg_admin_create_logical_replication_slot", {
        id,
        name,
        plugin,
      }),
    );
  const getWalReceiverStatus = (id: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_wal_receiver_status", { id }));
  const promoteStandby = (id: string) =>
    wrap(() => invoke<void>("pg_admin_promote_standby", { id }));
  const getReplicationLag = (id: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_replication_lag", { id }));

  // --- Vacuum / Analyze / Reindex ---
  const getVacuumStats = (id: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_vacuum_stats", { id }));
  const vacuumTable = (id: string, spec: unknown) =>
    wrap(() => invoke<void>("pg_admin_vacuum_table", { id, spec }));
  const vacuumDatabase = (id: string, database: string, full: boolean) =>
    wrap(() =>
      invoke<void>("pg_admin_vacuum_database", { id, database, full }),
    );
  const analyze = (id: string, spec: unknown) =>
    wrap(() => invoke<void>("pg_admin_analyze", { id, spec }));
  const reindex = (id: string, spec: unknown) =>
    wrap(() => invoke<void>("pg_admin_reindex", { id, spec }));
  const getBloat = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_get_bloat", { id }));
  const getAutovacuumConfig = (id: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_autovacuum_config", { id }));
  const setAutovacuumConfig = (id: string, config: unknown) =>
    wrap(() => invoke<void>("pg_admin_set_autovacuum_config", { id, config }));

  // --- Extensions ---
  const listAvailableExtensions = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_available_extensions", { id }));
  const listInstalledExtensions = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_installed_extensions", { id }));
  const installExtension = (id: string, spec: unknown) =>
    wrap(() => invoke<unknown>("pg_admin_install_extension", { id, spec }));
  const uninstallExtension = (id: string, name: string) =>
    wrap(() => invoke<void>("pg_admin_uninstall_extension", { id, name }));
  const updateExtension = (id: string, name: string) =>
    wrap(() => invoke<unknown>("pg_admin_update_extension", { id, name }));
  const getExtension = (id: string, name: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_extension", { id, name }));

  // --- Stats / Activity / Locks / Settings ---
  const getDatabaseStats = (id: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_database_stats", { id }));
  const getTableStats = (id: string, schema: string, table: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_table_stats", { id, schema, table }));
  const getIndexStats = (id: string, schema: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_get_index_stats", { id, schema }));
  const getLocks = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_get_locks", { id }));
  const getActivity = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_get_activity", { id }));
  const getSettings = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_get_settings", { id }));
  const getSetting = (id: string, name: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_setting", { id, name }));
  const setSetting = (id: string, name: string, value: string) =>
    wrap(() => invoke<void>("pg_admin_set_setting", { id, name, value }));
  const reloadConfig = (id: string) =>
    wrap(() => invoke<void>("pg_admin_reload_config", { id }));
  const resetStats = (id: string, target: string) =>
    wrap(() => invoke<void>("pg_admin_reset_stats", { id, target }));

  // --- WAL ---
  const getWalInfo = (id: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_wal_info", { id }));
  const getCurrentLsn = (id: string) =>
    wrap(() => invoke<string>("pg_admin_get_current_lsn", { id }));
  const switchWal = (id: string) =>
    wrap(() => invoke<void>("pg_admin_switch_wal", { id }));
  const getArchiveStatus = (id: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_archive_status", { id }));
  const listWalFiles = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_wal_files", { id }));
  const getWalSize = (id: string) =>
    wrap(() => invoke<number>("pg_admin_get_wal_size", { id }));
  const checkpoint = (id: string) =>
    wrap(() => invoke<void>("pg_admin_checkpoint", { id }));

  // --- Tablespaces ---
  const listTablespaces = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_tablespaces", { id }));
  const getTablespace = (id: string, name: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_tablespace", { id, name }));
  const createTablespace = (id: string, spec: unknown) =>
    wrap(() => invoke<unknown>("pg_admin_create_tablespace", { id, spec }));
  const dropTablespace = (id: string, name: string) =>
    wrap(() => invoke<void>("pg_admin_drop_tablespace", { id, name }));
  const renameTablespace = (id: string, oldName: string, newName: string) =>
    wrap(() =>
      invoke<void>("pg_admin_rename_tablespace", { id, oldName, newName }),
    );
  const alterTablespaceOwner = (id: string, name: string, owner: string) =>
    wrap(() =>
      invoke<void>("pg_admin_alter_tablespace_owner", { id, name, owner }),
    );
  const getTablespaceSize = (id: string, name: string) =>
    wrap(() => invoke<number>("pg_admin_get_tablespace_size", { id, name }));
  const listTablespaceObjects = (id: string, name: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_tablespace_objects", { id, name }));

  // --- Schemas ---
  const listSchemas = (id: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_schemas", { id }));
  const getSchema = (id: string, name: string) =>
    wrap(() => invoke<unknown>("pg_admin_get_schema", { id, name }));
  const createSchema = (id: string, spec: unknown) =>
    wrap(() => invoke<unknown>("pg_admin_create_schema", { id, spec }));
  const dropSchema = (id: string, name: string, cascade: boolean) =>
    wrap(() => invoke<void>("pg_admin_drop_schema", { id, name, cascade }));
  const renameSchema = (id: string, oldName: string, newName: string) =>
    wrap(() =>
      invoke<void>("pg_admin_rename_schema", { id, oldName, newName }),
    );
  const alterSchemaOwner = (id: string, name: string, owner: string) =>
    wrap(() => invoke<void>("pg_admin_alter_schema_owner", { id, name, owner }));
  const grantSchema = (id: string, spec: unknown) =>
    wrap(() => invoke<void>("pg_admin_grant_schema", { id, spec }));
  const revokeSchema = (id: string, spec: unknown) =>
    wrap(() => invoke<void>("pg_admin_revoke_schema", { id, spec }));
  const listSchemaTables = (id: string, schema: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_schema_tables", { id, schema }));
  const listSchemaViews = (id: string, schema: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_schema_views", { id, schema }));
  const listSchemaFunctions = (id: string, schema: string) =>
    wrap(() =>
      invoke<unknown[]>("pg_admin_list_schema_functions", { id, schema }),
    );

  // --- Backup ---
  const pgDump = (id: string, spec: unknown) =>
    wrap(() => invoke<unknown>("pg_admin_pg_dump", { id, spec }));
  const pgRestore = (id: string, spec: unknown) =>
    wrap(() => invoke<unknown>("pg_admin_pg_restore", { id, spec }));
  const pgDumpall = (id: string, spec: unknown) =>
    wrap(() => invoke<unknown>("pg_admin_pg_dumpall", { id, spec }));
  const pgBasebackup = (id: string, spec: unknown) =>
    wrap(() => invoke<unknown>("pg_admin_pg_basebackup", { id, spec }));
  const listBackupFiles = (id: string, dir: string) =>
    wrap(() => invoke<unknown[]>("pg_admin_list_backup_files", { id, dir }));
  const verifyBackup = (id: string, path: string) =>
    wrap(() => invoke<unknown>("pg_admin_verify_backup", { id, path }));
  const getBackupSize = (id: string, path: string) =>
    wrap(() => invoke<number>("pg_admin_get_backup_size", { id, path }));

  return {
    connectionId,
    error,
    loading,
    // connection
    connect,
    disconnect,
    listConnections,
    // roles
    listRoles,
    getRole,
    createRole,
    alterRole,
    dropRole,
    renameRole,
    grantRole,
    revokeRole,
    setRolePassword,
    listRoleMemberships,
    // databases
    listDatabases,
    getDatabase,
    createDatabase,
    dropDatabase,
    renameDatabase,
    alterDatabaseOwner,
    getDatabaseSize,
    getDatabaseConnections,
    terminateConnections,
    listDatabaseSchemas,
    // pg_hba
    listHba,
    addHba,
    removeHba,
    updateHba,
    reloadHba,
    getHbaRaw,
    setHbaRaw,
    validateHba,
    // replication
    getReplicationStatus,
    listReplicationSlots,
    createReplicationSlot,
    dropReplicationSlot,
    createPhysicalReplicationSlot,
    createLogicalReplicationSlot,
    getWalReceiverStatus,
    promoteStandby,
    getReplicationLag,
    // vacuum
    getVacuumStats,
    vacuumTable,
    vacuumDatabase,
    analyze,
    reindex,
    getBloat,
    getAutovacuumConfig,
    setAutovacuumConfig,
    // extensions
    listAvailableExtensions,
    listInstalledExtensions,
    installExtension,
    uninstallExtension,
    updateExtension,
    getExtension,
    // stats
    getDatabaseStats,
    getTableStats,
    getIndexStats,
    getLocks,
    getActivity,
    getSettings,
    getSetting,
    setSetting,
    reloadConfig,
    resetStats,
    // wal
    getWalInfo,
    getCurrentLsn,
    switchWal,
    getArchiveStatus,
    listWalFiles,
    getWalSize,
    checkpoint,
    // tablespaces
    listTablespaces,
    getTablespace,
    createTablespace,
    dropTablespace,
    renameTablespace,
    alterTablespaceOwner,
    getTablespaceSize,
    listTablespaceObjects,
    // schemas
    listSchemas,
    getSchema,
    createSchema,
    dropSchema,
    renameSchema,
    alterSchemaOwner,
    grantSchema,
    revokeSchema,
    listSchemaTables,
    listSchemaViews,
    listSchemaFunctions,
    // backup
    pgDump,
    pgRestore,
    pgDumpall,
    pgBasebackup,
    listBackupFiles,
    verifyBackup,
    getBackupSize,
  };
}
