#![allow(clippy::await_holding_lock)]

use serde_json::Value;
use tauri::State;

use crate::error::CephError;
use crate::service::CephServiceState;
use crate::types::*;

// ---------------------------------------------------------------------------
// Connection & Session Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_connect(
    state: State<'_, CephServiceState>,
    config: CephConnectionConfig,
) -> Result<CephSession, CephError> {
    let mut svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.connect(config).await
}

#[tauri::command]
pub async fn ceph_disconnect(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<(), CephError> {
    let mut svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.disconnect(&session_id)
}

#[tauri::command]
pub async fn ceph_list_sessions(
    state: State<'_, CephServiceState>,
) -> Result<Vec<CephSession>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    Ok(svc.list_sessions())
}

// ---------------------------------------------------------------------------
// Cluster Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_get_cluster_health(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<ClusterHealth, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_cluster_health(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_cluster_status(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Value, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_cluster_status(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_cluster_df(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<StorageStats, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_cluster_df(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_cluster_config(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<CephConfig>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_cluster_config(&session_id).await
}

#[tauri::command]
pub async fn ceph_list_services(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<ServiceInfo>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_services(&session_id).await
}

// ---------------------------------------------------------------------------
// OSD Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_list_osds(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<OsdInfo>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_osds(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_osd(
    state: State<'_, CephServiceState>,
    session_id: String,
    osd_id: u32,
) -> Result<OsdInfo, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_osd(&session_id, osd_id).await
}

// ---------------------------------------------------------------------------
// Pool Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_list_pools(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<PoolInfo>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_pools(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_pool(
    state: State<'_, CephServiceState>,
    session_id: String,
    pool_name: String,
) -> Result<PoolInfo, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_pool(&session_id, &pool_name).await
}

// ---------------------------------------------------------------------------
// RBD Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_list_rbd_images(
    state: State<'_, CephServiceState>,
    session_id: String,
    pool: String,
) -> Result<Vec<RbdImage>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_rbd_images(&session_id, &pool).await
}

#[tauri::command]
pub async fn ceph_get_rbd_image(
    state: State<'_, CephServiceState>,
    session_id: String,
    pool: String,
    image_name: String,
) -> Result<RbdImage, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_rbd_image(&session_id, &pool, &image_name).await
}

// ---------------------------------------------------------------------------
// CephFS Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_list_filesystems(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<CephFsInfo>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_filesystems(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_filesystem(
    state: State<'_, CephServiceState>,
    session_id: String,
    fs_name: String,
) -> Result<CephFsInfo, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_filesystem(&session_id, &fs_name).await
}

#[tauri::command]
pub async fn ceph_create_filesystem(
    state: State<'_, CephServiceState>,
    session_id: String,
    name: String,
    metadata_pool: String,
    data_pool: String,
) -> Result<CephFsInfo, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.create_filesystem(&session_id, &name, &metadata_pool, &data_pool)
        .await
}

#[tauri::command]
pub async fn ceph_remove_filesystem(
    state: State<'_, CephServiceState>,
    session_id: String,
    fs_name: String,
) -> Result<(), CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.remove_filesystem(&session_id, &fs_name).await
}

#[tauri::command]
pub async fn ceph_list_subvolumes(
    state: State<'_, CephServiceState>,
    session_id: String,
    fs_name: String,
    group: Option<String>,
) -> Result<Vec<CephFsSubvolume>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_subvolumes(&session_id, &fs_name, group.as_deref())
        .await
}

#[tauri::command]
pub async fn ceph_evict_cephfs_client(
    state: State<'_, CephServiceState>,
    session_id: String,
    fs_name: String,
    client_id: u64,
) -> Result<(), CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.evict_cephfs_client(&session_id, &fs_name, client_id)
        .await
}

// ---------------------------------------------------------------------------
// RGW Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_list_rgw_users(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<RgwUser>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_rgw_users(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_rgw_user(
    state: State<'_, CephServiceState>,
    session_id: String,
    uid: String,
) -> Result<RgwUser, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_rgw_user(&session_id, &uid).await
}

#[tauri::command]
pub async fn ceph_create_rgw_user(
    state: State<'_, CephServiceState>,
    session_id: String,
    uid: String,
    display_name: String,
    email: Option<String>,
) -> Result<RgwUser, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.create_rgw_user(&session_id, &uid, &display_name, email.as_deref())
        .await
}

#[tauri::command]
pub async fn ceph_delete_rgw_user(
    state: State<'_, CephServiceState>,
    session_id: String,
    uid: String,
) -> Result<(), CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.delete_rgw_user(&session_id, &uid).await
}

#[tauri::command]
pub async fn ceph_list_rgw_buckets(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<RgwBucket>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_rgw_buckets(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_rgw_bucket(
    state: State<'_, CephServiceState>,
    session_id: String,
    bucket_name: String,
) -> Result<RgwBucket, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_rgw_bucket(&session_id, &bucket_name).await
}

#[tauri::command]
pub async fn ceph_list_rgw_zones(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<RgwZoneInfo>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_rgw_zones(&session_id).await
}

// ---------------------------------------------------------------------------
// CRUSH Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_get_crush_map(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<CrushMap, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_crush_map(&session_id).await
}

#[tauri::command]
pub async fn ceph_list_crush_rules(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<CrushRule>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_crush_rules(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_crush_tunables(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<CrushTunables, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_crush_tunables(&session_id).await
}

// ---------------------------------------------------------------------------
// Monitor Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_list_monitors(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<MonitorInfo>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_monitors(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_quorum_status(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<MonStatus, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_quorum_status(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_monitor_map(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<MonMap, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_monitor_map(&session_id).await
}

#[tauri::command]
pub async fn ceph_compact_monitor_store(
    state: State<'_, CephServiceState>,
    session_id: String,
    mon_name: String,
) -> Result<(), CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.compact_monitor_store(&session_id, &mon_name).await
}

// ---------------------------------------------------------------------------
// MDS Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_list_mds_servers(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<MdsInfo>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_mds_servers(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_mds_perf(
    state: State<'_, CephServiceState>,
    session_id: String,
    mds_name: String,
) -> Result<MdsPerfStats, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_mds_perf(&session_id, &mds_name).await
}

#[tauri::command]
pub async fn ceph_failover_mds(
    state: State<'_, CephServiceState>,
    session_id: String,
    mds_name: String,
) -> Result<(), CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.failover_mds(&session_id, &mds_name).await
}

// ---------------------------------------------------------------------------
// Placement Group Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_list_pgs(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<PgInfo>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_pgs(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_pg_summary(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<PgSummary, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_pg_summary(&session_id).await
}

#[tauri::command]
pub async fn ceph_repair_pg(
    state: State<'_, CephServiceState>,
    session_id: String,
    pgid: String,
) -> Result<(), CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.repair_pg(&session_id, &pgid).await
}

#[tauri::command]
pub async fn ceph_scrub_pg(
    state: State<'_, CephServiceState>,
    session_id: String,
    pgid: String,
) -> Result<(), CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.scrub_pg(&session_id, &pgid).await
}

#[tauri::command]
pub async fn ceph_deep_scrub_pg(
    state: State<'_, CephServiceState>,
    session_id: String,
    pgid: String,
) -> Result<(), CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.deep_scrub_pg(&session_id, &pgid).await
}

#[tauri::command]
pub async fn ceph_list_stuck_pgs(
    state: State<'_, CephServiceState>,
    session_id: String,
    stuck_type: Option<String>,
) -> Result<Vec<PgInfo>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_stuck_pgs(&session_id, stuck_type.as_deref()).await
}

// ---------------------------------------------------------------------------
// Performance Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_get_perf_metrics(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<PerfMetrics, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_perf_metrics(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_slow_requests(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<SlowRequest>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_slow_requests(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_osd_perf(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<OsdPerfCounters>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_osd_perf(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_pool_perf(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<PoolStats>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_pool_perf(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_performance_counters(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Value, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_performance_counters(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_recovery_progress(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<RecoveryProgress, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_recovery_progress(&session_id).await
}

// ---------------------------------------------------------------------------
// Alert Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ceph_list_health_checks(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<HealthCheck>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_health_checks(&session_id).await
}

#[tauri::command]
pub async fn ceph_get_health_detail(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Value, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_health_detail(&session_id).await
}

#[tauri::command]
pub async fn ceph_mute_health_check(
    state: State<'_, CephServiceState>,
    session_id: String,
    check_code: String,
    duration: Option<String>,
) -> Result<(), CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.mute_health_check(&session_id, &check_code, duration.as_deref())
        .await
}

#[tauri::command]
pub async fn ceph_unmute_health_check(
    state: State<'_, CephServiceState>,
    session_id: String,
    check_code: String,
) -> Result<(), CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.unmute_health_check(&session_id, &check_code).await
}

#[tauri::command]
pub async fn ceph_list_alerts(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Vec<CephAlert>, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.list_alerts(&session_id).await
}

#[tauri::command]
pub async fn ceph_acknowledge_alert(
    state: State<'_, CephServiceState>,
    session_id: String,
    alert_id: String,
) -> Result<(), CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.acknowledge_alert(&session_id, &alert_id).await
}

#[tauri::command]
pub async fn ceph_clear_alert(
    state: State<'_, CephServiceState>,
    session_id: String,
    alert_id: String,
) -> Result<(), CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.clear_alert(&session_id, &alert_id).await
}

#[tauri::command]
pub async fn ceph_get_health_summary(
    state: State<'_, CephServiceState>,
    session_id: String,
) -> Result<Value, CephError> {
    let svc = state
        .lock()
        .map_err(|e| CephError::connection(format!("Failed to acquire lock: {}", e)))?;
    svc.get_health_summary(&session_id).await
}
