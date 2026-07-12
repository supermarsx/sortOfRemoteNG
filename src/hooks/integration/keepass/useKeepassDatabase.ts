// useKeepassDatabase — real Tauri `invoke(...)` wrappers for the sorng-keepass
// "database" command category (t42-keepass-c1).
//
// Binds the ~47 KDBX data-model commands: database lifecycle, the group tree,
// entries, per-entry history, and custom icons. Pairs 1:1 with the `keepass_*`
// commands in src-tauri/crates/sorng-keepass/src/keepass/commands.rs. Argument
// names match the Rust `#[tauri::command]` params exactly (camelCase, per Tauri's
// snake_case↔camelCase arg mapping) so no custom serializer is needed.
//
// Shape mirrors useVmware / useSFTPClient: a thin `keepassDatabaseApi` (one
// wrapper per command) plus a stateful `useKeepassDatabase()` hook that owns
// isLoading/error and a shared `run()` wrapper.

import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  KeePassDatabase,
  KeePassGroup,
  KeePassEntry,
  GroupTreeNode,
  EntrySummary,
  DatabaseFileInfo,
  SaveDatabaseOptions,
  CreateDatabaseRequest,
  OpenDatabaseRequest,
  TagCount,
} from "../../../types/keepass";
import type {
  GroupRequest,
  EntryRequest,
  EntryHistoryItem,
  EntryDiff,
  DatabaseStatistics,
  MergeConfig,
  MergeResult,
} from "../../../types/keepass/database";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const keepassDatabaseApi = {
  // ── Database lifecycle (15) ──────────────────────────────────────────────
  createDatabase: (req: CreateDatabaseRequest) =>
    invoke<KeePassDatabase>("keepass_create_database", { req }),
  openDatabase: (req: OpenDatabaseRequest) =>
    invoke<KeePassDatabase>("keepass_open_database", { req }),
  closeDatabase: (dbId: string, saveFirst: boolean) =>
    invoke<void>("keepass_close_database", { dbId, saveFirst }),
  closeAllDatabases: (saveFirst: boolean) =>
    invoke<void>("keepass_close_all_databases", { saveFirst }),
  saveDatabase: (dbId: string, options?: SaveDatabaseOptions) =>
    invoke<void>("keepass_save_database", { dbId, options }),
  lockDatabase: (dbId: string) =>
    invoke<void>("keepass_lock_database", { dbId }),
  unlockDatabase: (dbId: string, password?: string, keyFilePath?: string) =>
    invoke<void>("keepass_unlock_database", { dbId, password, keyFilePath }),
  listDatabases: () => invoke<KeePassDatabase[]>("keepass_list_databases"),
  backupDatabase: (dbId: string, backupDir?: string) =>
    invoke<string>("keepass_backup_database", { dbId, backupDir }),
  listBackups: (dbId: string) =>
    invoke<DatabaseFileInfo[]>("keepass_list_backups", { dbId }),
  changeMasterKey: (
    dbId: string,
    currentPassword?: string,
    currentKeyFile?: string,
    newPassword?: string,
    newKeyFile?: string,
  ) =>
    invoke<void>("keepass_change_master_key", {
      dbId,
      currentPassword,
      currentKeyFile,
      newPassword,
      newKeyFile,
    }),
  getDatabaseFileInfo: (filePath: string) =>
    invoke<DatabaseFileInfo>("keepass_get_database_file_info", { filePath }),
  getDatabaseStatistics: (dbId: string) =>
    invoke<DatabaseStatistics>("keepass_get_database_statistics", { dbId }),
  // `_source_file_path` is unused server-side (the remote path is taken from
  // `config.remotePath`) but is a required String arg, so it must be present.
  mergeDatabase: (dbId: string, config: MergeConfig, sourceFilePath = "") =>
    invoke<MergeResult>("keepass_merge_database", {
      dbId,
      sourceFilePath,
      config,
    }),
  updateDatabaseMetadata: (
    dbId: string,
    meta: {
      name?: string;
      description?: string;
      defaultUsername?: string;
      color?: string;
      recycleBinEnabled?: boolean;
    },
  ) =>
    invoke<void>("keepass_update_database_metadata", {
      dbId,
      name: meta.name,
      description: meta.description,
      defaultUsername: meta.defaultUsername,
      color: meta.color,
      recycleBinEnabled: meta.recycleBinEnabled,
    }),

  // ── Groups (12) ──────────────────────────────────────────────────────────
  createGroup: (dbId: string, req: GroupRequest) =>
    invoke<KeePassGroup>("keepass_create_group", { dbId, req }),
  getGroup: (dbId: string, groupUuid: string) =>
    invoke<KeePassGroup>("keepass_get_group", { dbId, groupUuid }),
  listGroups: (dbId: string) =>
    invoke<KeePassGroup[]>("keepass_list_groups", { dbId }),
  listChildGroups: (dbId: string, parentUuid: string) =>
    invoke<KeePassGroup[]>("keepass_list_child_groups", { dbId, parentUuid }),
  getGroupTree: (dbId: string) =>
    invoke<GroupTreeNode>("keepass_get_group_tree", { dbId }),
  getGroupPath: (dbId: string, groupUuid: string) =>
    invoke<string>("keepass_get_group_path", { dbId, groupUuid }),
  updateGroup: (dbId: string, groupUuid: string, req: GroupRequest) =>
    invoke<KeePassGroup>("keepass_update_group", { dbId, groupUuid, req }),
  deleteGroup: (dbId: string, groupUuid: string, permanent: boolean) =>
    invoke<void>("keepass_delete_group", { dbId, groupUuid, permanent }),
  moveGroup: (dbId: string, groupUuid: string, newParentUuid: string) =>
    invoke<void>("keepass_move_group", { dbId, groupUuid, newParentUuid }),
  sortGroups: (dbId: string, parentUuid: string) =>
    invoke<KeePassGroup[]>("keepass_sort_groups", { dbId, parentUuid }),
  groupEntryCount: (dbId: string, groupUuid: string, recursive: boolean) =>
    invoke<number>("keepass_group_entry_count", { dbId, groupUuid, recursive }),
  groupTags: (dbId: string, groupUuid: string) =>
    invoke<TagCount[]>("keepass_group_tags", { dbId, groupUuid }),

  // ── Entries (11) ─────────────────────────────────────────────────────────
  createEntry: (dbId: string, req: EntryRequest) =>
    invoke<KeePassEntry>("keepass_create_entry", { dbId, req }),
  getEntry: (dbId: string, entryUuid: string) =>
    invoke<KeePassEntry>("keepass_get_entry", { dbId, entryUuid }),
  listEntriesInGroup: (dbId: string, groupUuid: string) =>
    invoke<EntrySummary[]>("keepass_list_entries_in_group", {
      dbId,
      groupUuid,
    }),
  listAllEntries: (dbId: string) =>
    invoke<EntrySummary[]>("keepass_list_all_entries", { dbId }),
  listEntriesRecursive: (dbId: string, groupUuid: string) =>
    invoke<EntrySummary[]>("keepass_list_entries_recursive", {
      dbId,
      groupUuid,
    }),
  updateEntry: (dbId: string, entryUuid: string, req: EntryRequest) =>
    invoke<KeePassEntry>("keepass_update_entry", { dbId, entryUuid, req }),
  deleteEntry: (dbId: string, entryUuid: string, permanent: boolean) =>
    invoke<void>("keepass_delete_entry", { dbId, entryUuid, permanent }),
  restoreEntry: (dbId: string, entryUuid: string, targetGroupUuid?: string) =>
    invoke<void>("keepass_restore_entry", {
      dbId,
      entryUuid,
      targetGroupUuid,
    }),
  emptyRecycleBin: (dbId: string) =>
    invoke<number>("keepass_empty_recycle_bin", { dbId }),
  moveEntry: (dbId: string, entryUuid: string, targetGroupUuid: string) =>
    invoke<void>("keepass_move_entry", { dbId, entryUuid, targetGroupUuid }),
  copyEntry: (dbId: string, entryUuid: string, targetGroupUuid: string) =>
    invoke<KeePassEntry>("keepass_copy_entry", {
      dbId,
      entryUuid,
      targetGroupUuid,
    }),

  // ── Entry history (5) ────────────────────────────────────────────────────
  getEntryHistory: (dbId: string, entryUuid: string) =>
    invoke<EntryHistoryItem[]>("keepass_get_entry_history", {
      dbId,
      entryUuid,
    }),
  getEntryHistoryItem: (dbId: string, entryUuid: string, historyIndex: number) =>
    invoke<EntryHistoryItem>("keepass_get_entry_history_item", {
      dbId,
      entryUuid,
      historyIndex,
    }),
  restoreEntryFromHistory: (
    dbId: string,
    entryUuid: string,
    historyIndex: number,
  ) =>
    invoke<KeePassEntry>("keepass_restore_entry_from_history", {
      dbId,
      entryUuid,
      historyIndex,
    }),
  deleteEntryHistory: (dbId: string, entryUuid: string) =>
    invoke<void>("keepass_delete_entry_history", { dbId, entryUuid }),
  diffEntryWithHistory: (
    dbId: string,
    entryUuid: string,
    historyIndex: number,
  ) =>
    invoke<EntryDiff>("keepass_diff_entry_with_history", {
      dbId,
      entryUuid,
      historyIndex,
    }),

  // ── Custom icons (4) ─────────────────────────────────────────────────────
  // `_name` is an unused optional server-side arg; passed through for parity.
  addCustomIcon: (dbId: string, iconDataBase64: string, name?: string) =>
    invoke<string>("keepass_add_custom_icon", { dbId, iconDataBase64, name }),
  getCustomIcon: (dbId: string, iconUuid: string) =>
    invoke<string>("keepass_get_custom_icon", { dbId, iconUuid }),
  listCustomIcons: (dbId: string) =>
    invoke<string[]>("keepass_list_custom_icons", { dbId }),
  deleteCustomIcon: (dbId: string, iconUuid: string) =>
    invoke<void>("keepass_delete_custom_icon", { dbId, iconUuid }),
};

export type KeepassDatabaseApi = typeof keepassDatabaseApi;

// ─── React hook ───────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful hook over the KeePass "database" command surface. Owns `isLoading` /
 * `error` and a shared `run()` wrapper (mirrors useVmware), and exposes a handful
 * of `dbId`-bound convenience loaders for the tab's list views. The full command
 * surface is available via `api` for one-off actions.
 */
export function useKeepassDatabase(dbId: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against overlapping in-flight ops flipping isLoading incorrectly.
  const inflight = useRef(0);

  const run = useCallback(
    async <T>(op: () => Promise<T>): Promise<T> => {
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
    },
    [],
  );

  const loadGroups = useCallback(
    () => run(() => keepassDatabaseApi.listGroups(dbId)),
    [run, dbId],
  );

  const loadGroupTree = useCallback(
    () => run(() => keepassDatabaseApi.getGroupTree(dbId)),
    [run, dbId],
  );

  const loadAllEntries = useCallback(
    () => run(() => keepassDatabaseApi.listAllEntries(dbId)),
    [run, dbId],
  );

  const loadEntriesInGroup = useCallback(
    (groupUuid: string) =>
      run(() => keepassDatabaseApi.listEntriesInGroup(dbId, groupUuid)),
    [run, dbId],
  );

  const loadStatistics = useCallback(
    () => run(() => keepassDatabaseApi.getDatabaseStatistics(dbId)),
    [run, dbId],
  );

  const loadCustomIcons = useCallback(
    () => run(() => keepassDatabaseApi.listCustomIcons(dbId)),
    [run, dbId],
  );

  const loadEntryHistory = useCallback(
    (entryUuid: string) =>
      run(() => keepassDatabaseApi.getEntryHistory(dbId, entryUuid)),
    [run, dbId],
  );

  return {
    // state
    isLoading,
    error,
    setError,
    // shared wrapper (share so all actions get consistent error/loading)
    run,
    // convenience loaders
    loadGroups,
    loadGroupTree,
    loadAllEntries,
    loadEntriesInGroup,
    loadStatistics,
    loadCustomIcons,
    loadEntryHistory,
    // full command surface
    api: keepassDatabaseApi,
    dbId,
  };
}

export type KeepassDatabaseManager = ReturnType<typeof useKeepassDatabase>;
