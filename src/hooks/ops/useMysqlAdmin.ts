// useMysqlAdmin — typed Tauri `invoke(...)` wrappers for the sorng-mysql-admin
// backend. Pairs 1:1 with `src-tauri/crates/sorng-mysql-admin/src/commands.rs`
// (101 `mysql_admin_*` commands, wired via slot `m` in
// `sorng-commands-ops::ops_handler`).
//
// Arg names match the Rust `#[tauri::command]` definitions exactly. Tauri
// maps JS camelCase args to Rust snake_case on the command boundary, so
// callers must use camelCase keys (e.g. `oldUser`, `logName`, `processId`).

import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  BackupConfig,
  BackupResult,
  BinlogEvent,
  BinlogFile,
  InnodbStatus,
  MysqlColumn,
  MysqlConnectionConfig,
  MysqlConnectionSummary,
  MysqlDatabase,
  MysqlGrant,
  MysqlIndex,
  MysqlProcess,
  MysqlTable,
  MysqlUser,
  MysqlVariable,
  ReplicationConfig,
  ReplicationStatus,
  SlowQueryEntry,
} from '../../types/mysqlAdmin';

// ─── Low-level invoke wrappers ────────────────────────────────────────────────

export const mysqlAdminApi = {
  // Connection (3)
  connect: (id: string, config: MysqlConnectionConfig) =>
    invoke<MysqlConnectionSummary>('mysql_admin_connect', { id, config }),
  disconnect: (id: string) => invoke<void>('mysql_admin_disconnect', { id }),
  listConnections: () => invoke<string[]>('mysql_admin_list_connections'),

  // Users & Grants (12)
  listUsers: (id: string) => invoke<MysqlUser[]>('mysql_admin_list_users', { id }),
  getUser: (id: string, user: string, host: string) =>
    invoke<MysqlUser>('mysql_admin_get_user', { id, user, host }),
  createUser: (
    id: string,
    user: string,
    host: string,
    password: string,
    plugin?: string,
  ) =>
    invoke<void>('mysql_admin_create_user', {
      id,
      user,
      host,
      password,
      plugin,
    }),
  dropUser: (id: string, user: string, host: string) =>
    invoke<void>('mysql_admin_drop_user', { id, user, host }),
  renameUser: (
    id: string,
    oldUser: string,
    oldHost: string,
    newUser: string,
    newHost: string,
  ) =>
    invoke<void>('mysql_admin_rename_user', {
      id,
      oldUser,
      oldHost,
      newUser,
      newHost,
    }),
  setPassword: (id: string, user: string, host: string, password: string) =>
    invoke<void>('mysql_admin_set_password', { id, user, host, password }),
  lockUser: (id: string, user: string, host: string) =>
    invoke<void>('mysql_admin_lock_user', { id, user, host }),
  unlockUser: (id: string, user: string, host: string) =>
    invoke<void>('mysql_admin_unlock_user', { id, user, host }),
  listGrants: (id: string, user: string, host: string) =>
    invoke<MysqlGrant[]>('mysql_admin_list_grants', { id, user, host }),
  grant: (
    id: string,
    privilege: string,
    database: string,
    table: string,
    user: string,
    host: string,
    withGrant: boolean,
  ) =>
    invoke<void>('mysql_admin_grant', {
      id,
      privilege,
      database,
      table,
      user,
      host,
      withGrant,
    }),
  revoke: (
    id: string,
    privilege: string,
    database: string,
    table: string,
    user: string,
    host: string,
  ) =>
    invoke<void>('mysql_admin_revoke', {
      id,
      privilege,
      database,
      table,
      user,
      host,
    }),
  flushPrivileges: (id: string) =>
    invoke<void>('mysql_admin_flush_privileges', { id }),

  // Replication (12)
  getMasterStatus: (id: string) =>
    invoke<ReplicationStatus>('mysql_admin_get_master_status', { id }),
  getSlaveStatus: (id: string) =>
    invoke<ReplicationStatus>('mysql_admin_get_slave_status', { id }),
  configureMaster: (id: string, config: ReplicationConfig) =>
    invoke<void>('mysql_admin_configure_master', { id, config }),
  startSlave: (id: string) => invoke<void>('mysql_admin_start_slave', { id }),
  stopSlave: (id: string) => invoke<void>('mysql_admin_stop_slave', { id }),
  resetSlave: (id: string) => invoke<void>('mysql_admin_reset_slave', { id }),
  changeMaster: (
    id: string,
    masterHost: string,
    masterPort: number,
    masterUser: string,
    masterPassword: string,
    masterLogFile?: string,
    masterLogPos?: number,
  ) =>
    invoke<void>('mysql_admin_change_master', {
      id,
      masterHost,
      masterPort,
      masterUser,
      masterPassword,
      masterLogFile,
      masterLogPos,
    }),
  skipCounter: (id: string, count: number) =>
    invoke<void>('mysql_admin_skip_counter', { id, count }),
  getGtidExecuted: (id: string) =>
    invoke<string>('mysql_admin_get_gtid_executed', { id }),
  getGtidPurged: (id: string) =>
    invoke<string>('mysql_admin_get_gtid_purged', { id }),
  setReadOnly: (id: string, enabled: boolean) =>
    invoke<void>('mysql_admin_set_read_only', { id, enabled }),

  // Databases (8)
  listDatabases: (id: string) =>
    invoke<MysqlDatabase[]>('mysql_admin_list_databases', { id }),
  getDatabase: (id: string, name: string) =>
    invoke<MysqlDatabase>('mysql_admin_get_database', { id, name }),
  createDatabase: (
    id: string,
    name: string,
    charset?: string,
    collation?: string,
  ) =>
    invoke<void>('mysql_admin_create_database', {
      id,
      name,
      charset,
      collation,
    }),
  dropDatabase: (id: string, name: string) =>
    invoke<void>('mysql_admin_drop_database', { id, name }),
  getDatabaseSize: (id: string, name: string) =>
    invoke<number>('mysql_admin_get_database_size', { id, name }),
  getDatabaseCharset: (id: string, name: string) =>
    invoke<string>('mysql_admin_get_database_charset', { id, name }),
  alterDatabaseCharset: (
    id: string,
    name: string,
    charset: string,
    collation: string,
  ) =>
    invoke<void>('mysql_admin_alter_database_charset', {
      id,
      name,
      charset,
      collation,
    }),
  listDatabaseTables: (id: string, db: string) =>
    invoke<MysqlTable[]>('mysql_admin_list_database_tables', { id, db }),

  // Tables (11)
  listTables: (id: string, db: string) =>
    invoke<MysqlTable[]>('mysql_admin_list_tables', { id, db }),
  getTable: (id: string, db: string, table: string) =>
    invoke<MysqlTable>('mysql_admin_get_table', { id, db, table }),
  describeTable: (id: string, db: string, table: string) =>
    invoke<MysqlColumn[]>('mysql_admin_describe_table', { id, db, table }),
  listIndexes: (id: string, db: string, table: string) =>
    invoke<MysqlIndex[]>('mysql_admin_list_indexes', { id, db, table }),
  createIndex: (
    id: string,
    db: string,
    table: string,
    name: string,
    columns: string[],
    unique: boolean,
  ) =>
    invoke<void>('mysql_admin_create_index', {
      id,
      db,
      table,
      name,
      columns,
      unique,
    }),
  dropIndex: (id: string, db: string, table: string, name: string) =>
    invoke<void>('mysql_admin_drop_index', { id, db, table, name }),
  analyzeTable: (id: string, db: string, table: string) =>
    invoke<string>('mysql_admin_analyze_table', { id, db, table }),
  optimizeTable: (id: string, db: string, table: string) =>
    invoke<string>('mysql_admin_optimize_table', { id, db, table }),
  repairTable: (id: string, db: string, table: string) =>
    invoke<string>('mysql_admin_repair_table', { id, db, table }),
  checkTable: (id: string, db: string, table: string) =>
    invoke<string>('mysql_admin_check_table', { id, db, table }),
  truncateTable: (id: string, db: string, table: string) =>
    invoke<void>('mysql_admin_truncate_table', { id, db, table }),
  getCreateStatement: (id: string, db: string, table: string) =>
    invoke<string>('mysql_admin_get_create_statement', { id, db, table }),
  getRowCount: (id: string, db: string, table: string) =>
    invoke<number>('mysql_admin_get_row_count', { id, db, table }),

  // Queries / Slow Log (11)
  isSlowLogEnabled: (id: string) =>
    invoke<boolean>('mysql_admin_is_slow_log_enabled', { id }),
  enableSlowLog: (id: string) =>
    invoke<void>('mysql_admin_enable_slow_log', { id }),
  disableSlowLog: (id: string) =>
    invoke<void>('mysql_admin_disable_slow_log', { id }),
  getSlowLogFile: (id: string) =>
    invoke<string>('mysql_admin_get_slow_log_file', { id }),
  getLongQueryTime: (id: string) =>
    invoke<number>('mysql_admin_get_long_query_time', { id }),
  setLongQueryTime: (id: string, seconds: number) =>
    invoke<void>('mysql_admin_set_long_query_time', { id, seconds }),
  listSlowQueries: (id: string, limit: number) =>
    invoke<SlowQueryEntry[]>('mysql_admin_list_slow_queries', { id, limit }),
  explainQuery: (id: string, db: string, sql: string) =>
    invoke<string>('mysql_admin_explain_query', { id, db, sql }),
  killQuery: (id: string, processId: number) =>
    invoke<void>('mysql_admin_kill_query', { id, processId }),
  getGlobalStatus: (id: string) =>
    invoke<MysqlVariable[]>('mysql_admin_get_global_status', { id }),
  getQueryCacheStatus: (id: string) =>
    invoke<MysqlVariable[]>('mysql_admin_get_query_cache_status', { id }),

  // InnoDB (9)
  getInnodbStatus: (id: string) =>
    invoke<InnodbStatus>('mysql_admin_get_innodb_status', { id }),
  getBufferPoolStats: (id: string) =>
    invoke<InnodbStatus>('mysql_admin_get_buffer_pool_stats', { id }),
  getEngineStatus: (id: string) =>
    invoke<string>('mysql_admin_get_engine_status', { id }),
  listInnodbLocks: (id: string) =>
    invoke<string>('mysql_admin_list_innodb_locks', { id }),
  listInnodbLockWaits: (id: string) =>
    invoke<string>('mysql_admin_list_innodb_lock_waits', { id }),
  getDeadlockInfo: (id: string) =>
    invoke<string>('mysql_admin_get_deadlock_info', { id }),
  getInnodbIoStats: (id: string) =>
    invoke<string>('mysql_admin_get_innodb_io_stats', { id }),
  getInnodbRowOperations: (id: string) =>
    invoke<string>('mysql_admin_get_innodb_row_operations', { id }),
  innodbForceRecoveryCheck: (id: string) =>
    invoke<string>('mysql_admin_innodb_force_recovery_check', { id }),

  // Variables & Status (10)
  listGlobalVariables: (id: string) =>
    invoke<MysqlVariable[]>('mysql_admin_list_global_variables', { id }),
  listSessionVariables: (id: string) =>
    invoke<MysqlVariable[]>('mysql_admin_list_session_variables', { id }),
  getGlobalVariable: (id: string, name: string) =>
    invoke<MysqlVariable>('mysql_admin_get_global_variable', { id, name }),
  getSessionVariable: (id: string, name: string) =>
    invoke<MysqlVariable>('mysql_admin_get_session_variable', { id, name }),
  setGlobalVariable: (id: string, name: string, value: string) =>
    invoke<void>('mysql_admin_set_global_variable', { id, name, value }),
  setSessionVariable: (id: string, name: string, value: string) =>
    invoke<void>('mysql_admin_set_session_variable', { id, name, value }),
  listStatusVariables: (id: string) =>
    invoke<MysqlVariable[]>('mysql_admin_list_status_variables', { id }),
  getStatusVariable: (id: string, name: string) =>
    invoke<MysqlVariable>('mysql_admin_get_status_variable', { id, name }),
  getServerInfo: (id: string) =>
    invoke<string>('mysql_admin_get_server_info', { id }),

  // Backup (7)
  createBackup: (id: string, config: BackupConfig) =>
    invoke<BackupResult>('mysql_admin_create_backup', { id, config }),
  restoreBackup: (id: string, db: string, path: string) =>
    invoke<void>('mysql_admin_restore_backup', { id, db, path }),
  listBackupFiles: (id: string, dir: string) =>
    invoke<BackupResult[]>('mysql_admin_list_backup_files', { id, dir }),
  getBackupSize: (id: string, path: string) =>
    invoke<number>('mysql_admin_get_backup_size', { id, path }),
  verifyBackup: (id: string, path: string) =>
    invoke<boolean>('mysql_admin_verify_backup', { id, path }),
  exportTable: (id: string, db: string, table: string, path: string) =>
    invoke<void>('mysql_admin_export_table', { id, db, table, path }),
  importSql: (id: string, db: string, path: string) =>
    invoke<void>('mysql_admin_import_sql', { id, db, path }),

  // Processes (8)
  listProcesses: (id: string) =>
    invoke<MysqlProcess[]>('mysql_admin_list_processes', { id }),
  getProcess: (id: string, pid: number) =>
    invoke<MysqlProcess>('mysql_admin_get_process', { id, pid }),
  killProcess: (id: string, pid: number) =>
    invoke<void>('mysql_admin_kill_process', { id, pid }),
  killProcessQuery: (id: string, pid: number) =>
    invoke<void>('mysql_admin_kill_process_query', { id, pid }),
  listProcessesByUser: (id: string, user: string) =>
    invoke<MysqlProcess[]>('mysql_admin_list_processes_by_user', { id, user }),
  listProcessesByDb: (id: string, db: string) =>
    invoke<MysqlProcess[]>('mysql_admin_list_processes_by_db', { id, db }),
  getMaxConnections: (id: string) =>
    invoke<number>('mysql_admin_get_max_connections', { id }),
  getThreadStats: (id: string) =>
    invoke<string>('mysql_admin_get_thread_stats', { id }),

  // Binary Logs (9)
  listBinlogs: (id: string) =>
    invoke<BinlogFile[]>('mysql_admin_list_binlogs', { id }),
  getCurrentBinlog: (id: string) =>
    invoke<BinlogFile>('mysql_admin_get_current_binlog', { id }),
  listBinlogEvents: (id: string, logName: string, limit: number) =>
    invoke<BinlogEvent[]>('mysql_admin_list_binlog_events', {
      id,
      logName,
      limit,
    }),
  purgeBinlogsTo: (id: string, logName: string) =>
    invoke<void>('mysql_admin_purge_binlogs_to', { id, logName }),
  purgeBinlogsBefore: (id: string, datetime: string) =>
    invoke<void>('mysql_admin_purge_binlogs_before', { id, datetime }),
  getBinlogFormat: (id: string) =>
    invoke<string>('mysql_admin_get_binlog_format', { id }),
  setBinlogFormat: (id: string, format: string) =>
    invoke<void>('mysql_admin_set_binlog_format', { id, format }),
  getBinlogExpireDays: (id: string) =>
    invoke<number>('mysql_admin_get_binlog_expire_days', { id }),
  setBinlogExpireDays: (id: string, days: number) =>
    invoke<void>('mysql_admin_set_binlog_expire_days', { id, days }),
  flushBinlogs: (id: string) =>
    invoke<void>('mysql_admin_flush_binlogs', { id }),
};

// ─── React hook ───────────────────────────────────────────────────────────────

export interface UseMysqlAdminState {
  connections: string[];
  activeId: string | null;
  lastError: string | null;
  loading: boolean;
}

export function useMysqlAdmin() {
  const [state, setState] = useState<UseMysqlAdminState>({
    connections: [],
    activeId: null,
    lastError: null,
    loading: false,
  });

  const refreshConnections = useCallback(async () => {
    try {
      const connections = await mysqlAdminApi.listConnections();
      setState((s) => ({ ...s, connections, lastError: null }));
      return connections;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, lastError: msg }));
      throw e;
    }
  }, []);

  const connect = useCallback(
    async (id: string, config: MysqlConnectionConfig) => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const summary = await mysqlAdminApi.connect(id, config);
        const connections = await mysqlAdminApi.listConnections();
        setState((s) => ({
          ...s,
          connections,
          activeId: id,
          lastError: null,
          loading: false,
        }));
        return summary;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, lastError: msg, loading: false }));
        throw e;
      }
    },
    [],
  );

  const disconnect = useCallback(async (id: string) => {
    await mysqlAdminApi.disconnect(id);
    const connections = await mysqlAdminApi.listConnections();
    setState((s) => ({
      ...s,
      connections,
      activeId: s.activeId === id ? null : s.activeId,
    }));
  }, []);

  return {
    ...state,
    api: mysqlAdminApi,
    refreshConnections,
    connect,
    disconnect,
    setActiveId: (id: string | null) =>
      setState((s) => ({ ...s, activeId: id })),
  };
}

export default useMysqlAdmin;
