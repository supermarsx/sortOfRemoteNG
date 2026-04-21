import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  CephAlert,
  CephConnectionConfig,
  CephSession,
  ClusterDf,
  ClusterHealth,
  ClusterStatus,
  FilesystemInfo,
  HealthCheck,
  MdsInfo,
  MonitorInfo,
  OsdInfo,
  PerfMetrics,
  PgInfo,
  PoolInfo,
  RbdImage,
  RecoveryProgress,
  RgwBucket,
  RgwUser,
} from "../../types/ceph";

export function useCeph() {
  const [sessionId, setSessionId] = useState<string | null>(null);
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

  // --- Session ---
  const connect = (config: CephConnectionConfig) =>
    wrap(async () => {
      const s = await invoke<CephSession>("ceph_connect", { config });
      setSessionId(s.id);
      return s;
    });
  const disconnect = (id: string) =>
    wrap(() => invoke<void>("ceph_disconnect", { sessionId: id }));
  const listSessions = () =>
    wrap(() => invoke<CephSession[]>("ceph_list_sessions"));

  // --- Cluster ---
  const getClusterHealth = (id: string) =>
    wrap(() => invoke<ClusterHealth>("ceph_get_cluster_health", { sessionId: id }));
  const getClusterStatus = (id: string) =>
    wrap(() => invoke<ClusterStatus>("ceph_get_cluster_status", { sessionId: id }));
  const getClusterDf = (id: string) =>
    wrap(() => invoke<ClusterDf>("ceph_get_cluster_df", { sessionId: id }));
  const getClusterConfig = (id: string) =>
    wrap(() => invoke<Record<string, unknown>>("ceph_get_cluster_config", { sessionId: id }));
  const listServices = (id: string) =>
    wrap(() => invoke<unknown[]>("ceph_list_services", { sessionId: id }));

  // --- OSD ---
  const listOsds = (id: string) =>
    wrap(() => invoke<OsdInfo[]>("ceph_list_osds", { sessionId: id }));
  const getOsd = (id: string, osdId: number) =>
    wrap(() => invoke<OsdInfo>("ceph_get_osd", { sessionId: id, osdId }));

  // --- Pools ---
  const listPools = (id: string) =>
    wrap(() => invoke<PoolInfo[]>("ceph_list_pools", { sessionId: id }));
  const getPool = (id: string, name: string) =>
    wrap(() => invoke<PoolInfo>("ceph_get_pool", { sessionId: id, name }));

  // --- RBD ---
  const listRbdImages = (id: string, pool: string) =>
    wrap(() => invoke<RbdImage[]>("ceph_list_rbd_images", { sessionId: id, pool }));
  const getRbdImage = (id: string, pool: string, name: string) =>
    wrap(() => invoke<RbdImage>("ceph_get_rbd_image", { sessionId: id, pool, name }));

  // --- CephFS ---
  const listFilesystems = (id: string) =>
    wrap(() => invoke<FilesystemInfo[]>("ceph_list_filesystems", { sessionId: id }));
  const getFilesystem = (id: string, name: string) =>
    wrap(() => invoke<FilesystemInfo>("ceph_get_filesystem", { sessionId: id, name }));
  const createFilesystem = (
    id: string,
    name: string,
    metadataPool: string,
    dataPool: string,
  ) =>
    wrap(() =>
      invoke<FilesystemInfo>("ceph_create_filesystem", {
        sessionId: id,
        name,
        metadataPool,
        dataPool,
      }),
    );
  const removeFilesystem = (id: string, name: string) =>
    wrap(() => invoke<void>("ceph_remove_filesystem", { sessionId: id, name }));
  const listSubvolumes = (id: string, fsName: string, group?: string) =>
    wrap(() => invoke<string[]>("ceph_list_subvolumes", { sessionId: id, fsName, group }));
  const evictCephfsClient = (id: string, fsName: string, clientId: string) =>
    wrap(() =>
      invoke<void>("ceph_evict_cephfs_client", { sessionId: id, fsName, clientId }),
    );

  // --- RGW ---
  const listRgwUsers = (id: string) =>
    wrap(() => invoke<RgwUser[]>("ceph_list_rgw_users", { sessionId: id }));
  const getRgwUser = (id: string, userId: string) =>
    wrap(() => invoke<RgwUser>("ceph_get_rgw_user", { sessionId: id, userId }));
  const createRgwUser = (id: string, userId: string, displayName: string, email?: string) =>
    wrap(() =>
      invoke<RgwUser>("ceph_create_rgw_user", { sessionId: id, userId, displayName, email }),
    );
  const deleteRgwUser = (id: string, userId: string) =>
    wrap(() => invoke<void>("ceph_delete_rgw_user", { sessionId: id, userId }));
  const listRgwBuckets = (id: string, userId?: string) =>
    wrap(() => invoke<RgwBucket[]>("ceph_list_rgw_buckets", { sessionId: id, userId }));
  const getRgwBucket = (id: string, bucket: string) =>
    wrap(() => invoke<RgwBucket>("ceph_get_rgw_bucket", { sessionId: id, bucket }));
  const listRgwZones = (id: string) =>
    wrap(() => invoke<unknown[]>("ceph_list_rgw_zones", { sessionId: id }));

  // --- CRUSH ---
  const getCrushMap = (id: string) =>
    wrap(() => invoke<unknown>("ceph_get_crush_map", { sessionId: id }));
  const listCrushRules = (id: string) =>
    wrap(() => invoke<unknown[]>("ceph_list_crush_rules", { sessionId: id }));
  const getCrushTunables = (id: string) =>
    wrap(() => invoke<Record<string, unknown>>("ceph_get_crush_tunables", { sessionId: id }));

  // --- Monitors ---
  const listMonitors = (id: string) =>
    wrap(() => invoke<MonitorInfo[]>("ceph_list_monitors", { sessionId: id }));
  const getQuorumStatus = (id: string) =>
    wrap(() => invoke<unknown>("ceph_get_quorum_status", { sessionId: id }));
  const getMonitorMap = (id: string) =>
    wrap(() => invoke<unknown>("ceph_get_monitor_map", { sessionId: id }));
  const compactMonitorStore = (id: string, monitor: string) =>
    wrap(() => invoke<void>("ceph_compact_monitor_store", { sessionId: id, monitor }));

  // --- MDS ---
  const listMdsServers = (id: string) =>
    wrap(() => invoke<MdsInfo[]>("ceph_list_mds_servers", { sessionId: id }));
  const getMdsPerf = (id: string, mdsName: string) =>
    wrap(() => invoke<PerfMetrics>("ceph_get_mds_perf", { sessionId: id, mdsName }));
  const failoverMds = (id: string, fsName: string, rank: number) =>
    wrap(() => invoke<void>("ceph_failover_mds", { sessionId: id, fsName, rank }));

  // --- PGs ---
  const listPgs = (id: string, poolId?: number) =>
    wrap(() => invoke<PgInfo[]>("ceph_list_pgs", { sessionId: id, poolId }));
  const getPgSummary = (id: string) =>
    wrap(() => invoke<Record<string, number>>("ceph_get_pg_summary", { sessionId: id }));
  const repairPg = (id: string, pgid: string) =>
    wrap(() => invoke<void>("ceph_repair_pg", { sessionId: id, pgid }));
  const scrubPg = (id: string, pgid: string) =>
    wrap(() => invoke<void>("ceph_scrub_pg", { sessionId: id, pgid }));
  const deepScrubPg = (id: string, pgid: string) =>
    wrap(() => invoke<void>("ceph_deep_scrub_pg", { sessionId: id, pgid }));
  const listStuckPgs = (id: string, state?: string) =>
    wrap(() => invoke<PgInfo[]>("ceph_list_stuck_pgs", { sessionId: id, state }));

  // --- Performance ---
  const getPerfMetrics = (id: string) =>
    wrap(() => invoke<PerfMetrics>("ceph_get_perf_metrics", { sessionId: id }));
  const getSlowRequests = (id: string) =>
    wrap(() => invoke<unknown[]>("ceph_get_slow_requests", { sessionId: id }));
  const getOsdPerf = (id: string, osdId: number) =>
    wrap(() => invoke<PerfMetrics>("ceph_get_osd_perf", { sessionId: id, osdId }));
  const getPoolPerf = (id: string, poolName: string) =>
    wrap(() => invoke<PerfMetrics>("ceph_get_pool_perf", { sessionId: id, poolName }));
  const getPerformanceCounters = (id: string, daemon: string) =>
    wrap(() =>
      invoke<Record<string, unknown>>("ceph_get_performance_counters", { sessionId: id, daemon }),
    );
  const getRecoveryProgress = (id: string) =>
    wrap(() => invoke<RecoveryProgress>("ceph_get_recovery_progress", { sessionId: id }));

  // --- Alerts & Health ---
  const listHealthChecks = (id: string) =>
    wrap(() => invoke<HealthCheck[]>("ceph_list_health_checks", { sessionId: id }));
  const getHealthDetail = (id: string, code: string) =>
    wrap(() => invoke<HealthCheck>("ceph_get_health_detail", { sessionId: id, code }));
  const muteHealthCheck = (id: string, code: string, durationSec?: number) =>
    wrap(() =>
      invoke<void>("ceph_mute_health_check", { sessionId: id, code, durationSec }),
    );
  const unmuteHealthCheck = (id: string, code: string) =>
    wrap(() => invoke<void>("ceph_unmute_health_check", { sessionId: id, code }));
  const listAlerts = (id: string) =>
    wrap(() => invoke<CephAlert[]>("ceph_list_alerts", { sessionId: id }));
  const acknowledgeAlert = (id: string, alertId: string) =>
    wrap(() => invoke<void>("ceph_acknowledge_alert", { sessionId: id, alertId }));
  const clearAlert = (id: string, alertId: string) =>
    wrap(() => invoke<void>("ceph_clear_alert", { sessionId: id, alertId }));
  const getHealthSummary = (id: string) =>
    wrap(() => invoke<Record<string, unknown>>("ceph_get_health_summary", { sessionId: id }));

  return {
    sessionId,
    error,
    loading,
    connect,
    disconnect,
    listSessions,
    getClusterHealth,
    getClusterStatus,
    getClusterDf,
    getClusterConfig,
    listServices,
    listOsds,
    getOsd,
    listPools,
    getPool,
    listRbdImages,
    getRbdImage,
    listFilesystems,
    getFilesystem,
    createFilesystem,
    removeFilesystem,
    listSubvolumes,
    evictCephfsClient,
    listRgwUsers,
    getRgwUser,
    createRgwUser,
    deleteRgwUser,
    listRgwBuckets,
    getRgwBucket,
    listRgwZones,
    getCrushMap,
    listCrushRules,
    getCrushTunables,
    listMonitors,
    getQuorumStatus,
    getMonitorMap,
    compactMonitorStore,
    listMdsServers,
    getMdsPerf,
    failoverMds,
    listPgs,
    getPgSummary,
    repairPg,
    scrubPg,
    deepScrubPg,
    listStuckPgs,
    getPerfMetrics,
    getSlowRequests,
    getOsdPerf,
    getPoolPerf,
    getPerformanceCounters,
    getRecoveryProgress,
    listHealthChecks,
    getHealthDetail,
    muteHealthCheck,
    unmuteHealthCheck,
    listAlerts,
    acknowledgeAlert,
    clearAlert,
    getHealthSummary,
  };
}
