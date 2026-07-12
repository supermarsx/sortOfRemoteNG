// useLxdInstances — real Tauri `invoke(...)` wrappers for the sorng-lxd
// `instances` category (t42-lxd-c1): the compute lifecycle. Instances
// (containers + VMs), snapshots, backups, exec/console, logs, files, and
// migration/copy/publish — 37 commands total.
//
// Pairs 1:1 with the "Instances", "Snapshots", "Backups" and "Migration / Copy /
// Publish" command blocks in
//   src-tauri/crates/sorng-lxd/src/commands.rs
// Top-level argument keys match the Rust `#[tauri::command]` params exactly in
// camelCase — Tauri v2 maps camelCase arg keys to snake_case Rust params
// (`new_name` ← `newName`), so no custom serializer is needed. Struct-valued
// args (`req`) carry their own serde casing (see `../../../types/lxd/instances`).
//
// The active connection is global (held in the backend `LxdService` Tauri state),
// so none of these take a connection id — they act on the one open connection.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LxdOperation } from "../../../types/lxd";
import type {
  CreateBackupRequest,
  CreateInstanceRequest,
  CreateSnapshotRequest,
  Instance,
  InstanceBackup,
  InstanceConsoleRequest,
  InstanceExecRequest,
  InstanceSnapshot,
  InstanceState,
  MigrateInstanceRequest,
  RestoreSnapshotRequest,
  UpdateInstanceRequest,
} from "../../../types/lxd/instances";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const lxdInstancesApi = {
  // ── Instances (23) ──────────────────────────────────────────────────────────
  listInstances: () => invoke<Instance[]>("lxd_list_instances"),
  listContainers: () => invoke<Instance[]>("lxd_list_containers"),
  listVirtualMachines: () =>
    invoke<Instance[]>("lxd_list_virtual_machines"),
  getInstance: (name: string) =>
    invoke<Instance>("lxd_get_instance", { name }),
  getInstanceState: (name: string) =>
    invoke<InstanceState>("lxd_get_instance_state", { name }),
  createInstance: (req: CreateInstanceRequest) =>
    invoke<LxdOperation>("lxd_create_instance", { req }),
  updateInstance: (req: UpdateInstanceRequest) =>
    invoke<void>("lxd_update_instance", { req }),
  patchInstance: (name: string, patch: unknown) =>
    invoke<void>("lxd_patch_instance", { name, patch }),
  deleteInstance: (name: string) =>
    invoke<LxdOperation>("lxd_delete_instance", { name }),
  renameInstance: (name: string, newName: string) =>
    invoke<LxdOperation>("lxd_rename_instance", { name, newName }),
  startInstance: (name: string, stateful: boolean) =>
    invoke<LxdOperation>("lxd_start_instance", { name, stateful }),
  stopInstance: (
    name: string,
    force: boolean,
    stateful: boolean,
    timeout?: number,
  ) =>
    invoke<LxdOperation>("lxd_stop_instance", {
      name,
      force,
      stateful,
      timeout,
    }),
  restartInstance: (name: string, force: boolean, timeout?: number) =>
    invoke<LxdOperation>("lxd_restart_instance", { name, force, timeout }),
  freezeInstance: (name: string) =>
    invoke<LxdOperation>("lxd_freeze_instance", { name }),
  unfreezeInstance: (name: string) =>
    invoke<LxdOperation>("lxd_unfreeze_instance", { name }),
  execInstance: (name: string, req: InstanceExecRequest) =>
    invoke<LxdOperation>("lxd_exec_instance", { name, req }),
  consoleInstance: (name: string, req: InstanceConsoleRequest) =>
    invoke<LxdOperation>("lxd_console_instance", { name, req }),
  clearConsoleLog: (name: string) =>
    invoke<void>("lxd_clear_console_log", { name }),
  listInstanceLogs: (name: string) =>
    invoke<string[]>("lxd_list_instance_logs", { name }),
  getInstanceLog: (name: string, filename: string) =>
    invoke<string>("lxd_get_instance_log", { name, filename }),
  getInstanceFile: (name: string, path: string) =>
    invoke<string>("lxd_get_instance_file", { name, path }),
  pushInstanceFile: (
    name: string,
    path: string,
    content: string,
    uid?: number,
    gid?: number,
    mode?: string,
  ) =>
    invoke<void>("lxd_push_instance_file", {
      name,
      path,
      content,
      uid,
      gid,
      mode,
    }),
  deleteInstanceFile: (name: string, path: string) =>
    invoke<void>("lxd_delete_instance_file", { name, path }),

  // ── Snapshots (6) ─────────────────────────────────────────────────────────--
  listSnapshots: (instance: string) =>
    invoke<InstanceSnapshot[]>("lxd_list_snapshots", { instance }),
  getSnapshot: (instance: string, snapshot: string) =>
    invoke<InstanceSnapshot>("lxd_get_snapshot", { instance, snapshot }),
  createSnapshot: (req: CreateSnapshotRequest) =>
    invoke<LxdOperation>("lxd_create_snapshot", { req }),
  deleteSnapshot: (instance: string, snapshot: string) =>
    invoke<LxdOperation>("lxd_delete_snapshot", { instance, snapshot }),
  renameSnapshot: (instance: string, oldName: string, newName: string) =>
    invoke<LxdOperation>("lxd_rename_snapshot", {
      instance,
      oldName,
      newName,
    }),
  restoreSnapshot: (req: RestoreSnapshotRequest) =>
    invoke<void>("lxd_restore_snapshot", { req }),

  // ── Backups (5) ─────────────────────────────────────────────────────────────
  listBackups: (instance: string) =>
    invoke<InstanceBackup[]>("lxd_list_backups", { instance }),
  getBackup: (instance: string, backup: string) =>
    invoke<InstanceBackup>("lxd_get_backup", { instance, backup }),
  createBackup: (req: CreateBackupRequest) =>
    invoke<LxdOperation>("lxd_create_backup", { req }),
  deleteBackup: (instance: string, backup: string) =>
    invoke<LxdOperation>("lxd_delete_backup", { instance, backup }),
  renameBackup: (instance: string, oldName: string, newName: string) =>
    invoke<LxdOperation>("lxd_rename_backup", { instance, oldName, newName }),

  // ── Migration / Copy / Publish (3) ────────────────────────────────────────--
  migrateInstance: (req: MigrateInstanceRequest) =>
    invoke<LxdOperation>("lxd_migrate_instance", { req }),
  copyInstance: (
    sourceName: string,
    newName: string,
    instanceOnly: boolean,
    stateful: boolean,
  ) =>
    invoke<LxdOperation>("lxd_copy_instance", {
      sourceName,
      newName,
      instanceOnly,
      stateful,
    }),
  publishInstance: (
    instance: string,
    alias: string | undefined,
    isPublic: boolean,
    properties?: Record<string, string>,
  ) =>
    invoke<LxdOperation>("lxd_publish_instance", {
      instance,
      alias,
      public: isPublic,
      properties,
    }),
};

export type LxdInstancesApi = typeof lxdInstancesApi;

// ─── React hook ─────────────────────────────────────────────────────────────--

/**
 * Loading/error lifecycle for the LXD Instances tab. `run` wraps any
 * `lxdInstancesApi` call, tracking `isLoading` and surfacing errors with the
 * shared error idiom (Tauri rejects with a plain string via `err_str`); it
 * resolves to the value, or `undefined` on failure.
 */
export function useLxdInstances() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(
      fn: (api: LxdInstancesApi) => Promise<T>,
    ): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn(lxdInstancesApi);
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return { api: lxdInstancesApi, run, isLoading, error, clearError };
}

export type LxdInstancesManager = ReturnType<typeof useLxdInstances>;
