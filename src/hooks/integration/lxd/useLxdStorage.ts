// useLxdStorage — Storage & Cluster command slice for the LXD integration (t42 c4).
//
// Pairs 1:1 with the "Storage", "Server & Cluster", "Operations" and "Warnings"
// commands in `src-tauri/crates/sorng-lxd/src/commands.rs` (38 commands). The
// backend holds the active connection in Tauri state, so these run globally
// against it — the tab only gates on `connected`.
//
// Command argument names below use Tauri's camelCase form of the Rust command
// parameters (e.g. `vol_type` → `volType`, `new_name` → `newName`,
// `snapshot_name` → `snapshotName`, `expires_at` → `expiresAt`).

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LxdOperation } from "../../../types/lxd";
import type {
  CreateStorageBucketRequest,
  CreateStoragePoolRequest,
  CreateStorageVolumeRequest,
  LxdCluster,
  LxdClusterMember,
  LxdServer,
  LxdWarning,
  ServerResources,
  StorageBucket,
  StorageBucketKey,
  StoragePool,
  StoragePoolResources,
  StorageVolume,
  StorageVolumeSnapshot,
} from "../../../types/lxd/storage";

// ─── Low-level invoke wrappers (all 38 commands of the c4 slice) ────────────────

export const lxdStorageApi = {
  // Storage pools (6)
  listStoragePools: () => invoke<StoragePool[]>("lxd_list_storage_pools"),
  getStoragePool: (name: string) =>
    invoke<StoragePool>("lxd_get_storage_pool", { name }),
  createStoragePool: (req: CreateStoragePoolRequest) =>
    invoke<void>("lxd_create_storage_pool", { req }),
  updateStoragePool: (
    name: string,
    config: Record<string, string>,
    description?: string,
  ) => invoke<void>("lxd_update_storage_pool", { name, config, description }),
  deleteStoragePool: (name: string) =>
    invoke<void>("lxd_delete_storage_pool", { name }),
  getStoragePoolResources: (name: string) =>
    invoke<StoragePoolResources>("lxd_get_storage_pool_resources", { name }),

  // Storage volumes (7)
  listStorageVolumes: (pool: string) =>
    invoke<StorageVolume[]>("lxd_list_storage_volumes", { pool }),
  listCustomVolumes: (pool: string) =>
    invoke<StorageVolume[]>("lxd_list_custom_volumes", { pool }),
  getStorageVolume: (pool: string, volType: string, name: string) =>
    invoke<StorageVolume>("lxd_get_storage_volume", { pool, volType, name }),
  createStorageVolume: (req: CreateStorageVolumeRequest) =>
    invoke<void>("lxd_create_storage_volume", { req }),
  updateStorageVolume: (pool: string, name: string, patch: unknown) =>
    invoke<void>("lxd_update_storage_volume", { pool, name, patch }),
  deleteStorageVolume: (pool: string, name: string) =>
    invoke<void>("lxd_delete_storage_volume", { pool, name }),
  renameStorageVolume: (pool: string, name: string, newName: string) =>
    invoke<LxdOperation>("lxd_rename_storage_volume", { pool, name, newName }),

  // Volume snapshots (3)
  listVolumeSnapshots: (pool: string, volume: string) =>
    invoke<StorageVolumeSnapshot[]>("lxd_list_volume_snapshots", {
      pool,
      volume,
    }),
  createVolumeSnapshot: (
    pool: string,
    volume: string,
    snapshotName: string,
    expiresAt?: string,
  ) =>
    invoke<LxdOperation>("lxd_create_volume_snapshot", {
      pool,
      volume,
      snapshotName,
      expiresAt,
    }),
  deleteVolumeSnapshot: (pool: string, volume: string, snapshot: string) =>
    invoke<LxdOperation>("lxd_delete_volume_snapshot", {
      pool,
      volume,
      snapshot,
    }),

  // Buckets (5)
  listStorageBuckets: (pool: string) =>
    invoke<StorageBucket[]>("lxd_list_storage_buckets", { pool }),
  getStorageBucket: (pool: string, name: string) =>
    invoke<StorageBucket>("lxd_get_storage_bucket", { pool, name }),
  createStorageBucket: (req: CreateStorageBucketRequest) =>
    invoke<void>("lxd_create_storage_bucket", { req }),
  deleteStorageBucket: (pool: string, name: string) =>
    invoke<void>("lxd_delete_storage_bucket", { pool, name }),
  listBucketKeys: (pool: string, bucket: string) =>
    invoke<StorageBucketKey[]>("lxd_list_bucket_keys", { pool, bucket }),

  // Server & cluster (9)
  getServer: () => invoke<LxdServer>("lxd_get_server"),
  getServerResources: () =>
    invoke<ServerResources>("lxd_get_server_resources"),
  updateServerConfig: (config: Record<string, string>) =>
    invoke<void>("lxd_update_server_config", { config }),
  getCluster: () => invoke<LxdCluster>("lxd_get_cluster"),
  listClusterMembers: () =>
    invoke<LxdClusterMember[]>("lxd_list_cluster_members"),
  getClusterMember: (name: string) =>
    invoke<LxdClusterMember>("lxd_get_cluster_member", { name }),
  evacuateClusterMember: (name: string) =>
    invoke<LxdOperation>("lxd_evacuate_cluster_member", { name }),
  restoreClusterMember: (name: string) =>
    invoke<LxdOperation>("lxd_restore_cluster_member", { name }),
  removeClusterMember: (name: string, force: boolean) =>
    invoke<void>("lxd_remove_cluster_member", { name, force }),

  // Operations (4)
  listOperations: () => invoke<LxdOperation[]>("lxd_list_operations"),
  getOperation: (id: string) =>
    invoke<LxdOperation>("lxd_get_operation", { id }),
  cancelOperation: (id: string) =>
    invoke<void>("lxd_cancel_operation", { id }),
  waitOperation: (id: string, timeout?: number) =>
    invoke<LxdOperation>("lxd_wait_operation", { id, timeout }),

  // Warnings (4)
  listWarnings: () => invoke<LxdWarning[]>("lxd_list_warnings"),
  getWarning: (uuid: string) => invoke<LxdWarning>("lxd_get_warning", { uuid }),
  acknowledgeWarning: (uuid: string) =>
    invoke<void>("lxd_acknowledge_warning", { uuid }),
  deleteWarning: (uuid: string) =>
    invoke<void>("lxd_delete_warning", { uuid }),
};

export type LxdStorageApi = typeof lxdStorageApi;

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * Holds the primary list state for the Storage & Cluster tab and a `run` helper
 * that funnels every command through shared loading/error handling. Deeper,
 * selection-scoped reads (volumes, snapshots, buckets, per-item detail) and all
 * mutations are issued by the tab straight through `api`, wrapped in `run`.
 */
export function useLxdStorage() {
  const [pools, setPools] = useState<StoragePool[]>([]);
  const [server, setServer] = useState<LxdServer | null>(null);
  const [cluster, setCluster] = useState<LxdCluster | null>(null);
  const [members, setMembers] = useState<LxdClusterMember[]>([]);
  const [operations, setOperations] = useState<LxdOperation[]>([]);
  const [warnings, setWarnings] = useState<LxdWarning[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /** Run any command with shared loading/error handling; rethrows on failure so
   *  callers can branch, but always records the message for the tab to surface. */
  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    setIsLoading(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      if (mounted.current) setError(msg);
      throw e;
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  const refreshPools = useCallback(async () => {
    const list = await run(() => lxdStorageApi.listStoragePools());
    if (mounted.current) setPools(list);
    return list;
  }, [run]);

  const refreshServerCluster = useCallback(async () => {
    const [srv, cl, mem] = await run(() =>
      Promise.all([
        lxdStorageApi.getServer(),
        lxdStorageApi.getCluster(),
        lxdStorageApi.listClusterMembers(),
      ]),
    );
    if (mounted.current) {
      setServer(srv);
      setCluster(cl);
      setMembers(mem);
    }
  }, [run]);

  const refreshOperations = useCallback(async () => {
    const list = await run(() => lxdStorageApi.listOperations());
    if (mounted.current) setOperations(list);
    return list;
  }, [run]);

  const refreshWarnings = useCallback(async () => {
    const list = await run(() => lxdStorageApi.listWarnings());
    if (mounted.current) setWarnings(list);
    return list;
  }, [run]);

  return {
    // state
    pools,
    server,
    cluster,
    members,
    operations,
    warnings,
    isLoading,
    error,
    // loaders
    refreshPools,
    refreshServerCluster,
    refreshOperations,
    refreshWarnings,
    clearError,
    // low-level access for selection-scoped reads + all mutations
    run,
    api: lxdStorageApi,
  };
}

export type LxdStorageManager = ReturnType<typeof useLxdStorage>;
