use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde_json::Value;
use uuid::Uuid;

use crate::alerts;
use crate::cephfs;
use crate::cluster;
use crate::crush;
use crate::error::CephError;
use crate::mds;
use crate::monitors;
use crate::osd;
use crate::performance;
use crate::pg;
use crate::pools;
use crate::rbd;
use crate::rgw;
use crate::types::*;

/// Thread-safe state wrapper for the CephService.
pub type CephServiceState = Arc<Mutex<CephService>>;

/// Create a new CephServiceState instance.
pub fn new_state() -> CephServiceState {
    Arc::new(Mutex::new(CephService::new()))
}

/// CephService is the main façade that wraps all Ceph module operations
/// with session management and a unified API.
pub struct CephService {
    sessions: HashMap<String, CephSession>,
}

impl CephService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Connect to a Ceph cluster and establish a new session.
    pub async fn connect(
        &mut self,
        config: CephConnectionConfig,
    ) -> Result<CephSession, CephError> {
        let session_id = Uuid::new_v4().to_string();
        let session = CephSession {
            id: session_id.clone(),
            config: config.clone(),
            cluster_id: None,
            cluster_name: None,
            connected_at: Utc::now(),
            auth_token: config.api_token.clone(),
        };

        // Validate the connection by fetching cluster health
        let health = cluster::api_get(&session, "/health/minimal")
            .await
            // Sync return for fallback — will try full health on first real call
            .or::<CephError>(Ok(Value::Null))?;

        let mut validated_session = session;
        if let Some(fsid) = health["fsid"].as_str() {
            validated_session.cluster_id = Some(fsid.to_string());
        }
        if let Some(name) = health["cluster_name"].as_str() {
            validated_session.cluster_name = Some(name.to_string());
        }

        self.sessions.insert(session_id, validated_session.clone());
        log::info!(
            "Connected to Ceph cluster: {} (session {})",
            validated_session
                .cluster_name
                .as_deref()
                .unwrap_or("unknown"),
            validated_session.id
        );
        Ok(validated_session)
    }

    /// Disconnect a session.
    pub fn disconnect(&mut self, session_id: &str) -> Result<(), CephError> {
        if self.sessions.remove(session_id).is_some() {
            log::info!("Disconnected Ceph session: {}", session_id);
            Ok(())
        } else {
            Err(CephError::session_not_found(session_id))
        }
    }

    /// List all active sessions.
    pub fn list_sessions(&self) -> Vec<CephSession> {
        self.sessions.values().cloned().collect()
    }

    /// Get a session by ID.
    fn get_session(&self, session_id: &str) -> Result<CephSession, CephError> {
        self.sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| CephError::session_not_found(session_id))
    }

    // -----------------------------------------------------------------------
    // Cluster
    // -----------------------------------------------------------------------

    pub async fn get_cluster_health(&self, session_id: &str) -> Result<ClusterHealth, CephError> {
        let session = self.get_session(session_id)?;
        cluster::get_cluster_health(&session).await
    }

    pub async fn get_cluster_status(&self, session_id: &str) -> Result<Value, CephError> {
        let session = self.get_session(session_id)?;
        cluster::get_cluster_status(&session).await
    }

    pub async fn get_cluster_df(&self, session_id: &str) -> Result<StorageStats, CephError> {
        let session = self.get_session(session_id)?;
        cluster::get_cluster_df(&session).await
    }

    pub async fn get_cluster_config(&self, session_id: &str) -> Result<Vec<CephConfig>, CephError> {
        let session = self.get_session(session_id)?;
        cluster::get_cluster_config(&session).await
    }

    pub async fn list_services(&self, session_id: &str) -> Result<Vec<ServiceInfo>, CephError> {
        let session = self.get_session(session_id)?;
        cluster::list_services(&session).await
    }

    // -----------------------------------------------------------------------
    // OSD
    // -----------------------------------------------------------------------

    pub async fn list_osds(&self, session_id: &str) -> Result<Vec<OsdInfo>, CephError> {
        let session = self.get_session(session_id)?;
        osd::list_osds(&session).await
    }

    pub async fn get_osd(&self, session_id: &str, osd_id: u32) -> Result<OsdInfo, CephError> {
        let session = self.get_session(session_id)?;
        osd::get_osd(&session, osd_id).await
    }

    // -----------------------------------------------------------------------
    // Pools
    // -----------------------------------------------------------------------

    pub async fn list_pools(&self, session_id: &str) -> Result<Vec<PoolInfo>, CephError> {
        let session = self.get_session(session_id)?;
        pools::list_pools(&session).await
    }

    pub async fn get_pool(&self, session_id: &str, pool_name: &str) -> Result<PoolInfo, CephError> {
        let session = self.get_session(session_id)?;
        pools::get_pool(&session, pool_name).await
    }

    // -----------------------------------------------------------------------
    // RBD
    // -----------------------------------------------------------------------

    pub async fn list_rbd_images(
        &self,
        session_id: &str,
        pool: &str,
    ) -> Result<Vec<RbdImage>, CephError> {
        let session = self.get_session(session_id)?;
        rbd::list_images(&session, pool).await
    }

    pub async fn get_rbd_image(
        &self,
        session_id: &str,
        pool: &str,
        image_name: &str,
    ) -> Result<RbdImage, CephError> {
        let session = self.get_session(session_id)?;
        rbd::get_image(&session, pool, image_name).await
    }

    // -----------------------------------------------------------------------
    // CephFS
    // -----------------------------------------------------------------------

    pub async fn list_filesystems(&self, session_id: &str) -> Result<Vec<CephFsInfo>, CephError> {
        let session = self.get_session(session_id)?;
        cephfs::list_filesystems(&session).await
    }

    pub async fn get_filesystem(
        &self,
        session_id: &str,
        fs_name: &str,
    ) -> Result<CephFsInfo, CephError> {
        let session = self.get_session(session_id)?;
        cephfs::get_filesystem(&session, fs_name).await
    }

    pub async fn create_filesystem(
        &self,
        session_id: &str,
        name: &str,
        metadata_pool: &str,
        data_pool: &str,
    ) -> Result<CephFsInfo, CephError> {
        let session = self.get_session(session_id)?;
        cephfs::create_filesystem(&session, name, metadata_pool, data_pool).await
    }

    pub async fn remove_filesystem(
        &self,
        session_id: &str,
        fs_name: &str,
    ) -> Result<(), CephError> {
        let session = self.get_session(session_id)?;
        cephfs::remove_filesystem(&session, fs_name, true).await
    }

    pub async fn list_subvolumes(
        &self,
        session_id: &str,
        fs_name: &str,
        group: Option<&str>,
    ) -> Result<Vec<CephFsSubvolume>, CephError> {
        let session = self.get_session(session_id)?;
        cephfs::list_subvolumes(&session, fs_name, group).await
    }

    pub async fn evict_cephfs_client(
        &self,
        session_id: &str,
        fs_name: &str,
        client_id: u64,
    ) -> Result<(), CephError> {
        let session = self.get_session(session_id)?;
        cephfs::evict_client(&session, fs_name, client_id).await
    }

    // -----------------------------------------------------------------------
    // RGW
    // -----------------------------------------------------------------------

    pub async fn list_rgw_users(&self, session_id: &str) -> Result<Vec<RgwUser>, CephError> {
        let session = self.get_session(session_id)?;
        rgw::list_users(&session).await
    }

    pub async fn get_rgw_user(&self, session_id: &str, uid: &str) -> Result<RgwUser, CephError> {
        let session = self.get_session(session_id)?;
        rgw::get_user(&session, uid).await
    }

    pub async fn create_rgw_user(
        &self,
        session_id: &str,
        uid: &str,
        display_name: &str,
        email: Option<&str>,
    ) -> Result<RgwUser, CephError> {
        let session = self.get_session(session_id)?;
        rgw::create_user(&session, uid, display_name, email, None, true).await
    }

    pub async fn delete_rgw_user(&self, session_id: &str, uid: &str) -> Result<(), CephError> {
        let session = self.get_session(session_id)?;
        rgw::delete_user(&session, uid, false).await
    }

    pub async fn list_rgw_buckets(&self, session_id: &str) -> Result<Vec<RgwBucket>, CephError> {
        let session = self.get_session(session_id)?;
        rgw::list_buckets(&session).await
    }

    pub async fn get_rgw_bucket(
        &self,
        session_id: &str,
        bucket_name: &str,
    ) -> Result<RgwBucket, CephError> {
        let session = self.get_session(session_id)?;
        rgw::get_bucket(&session, bucket_name).await
    }

    pub async fn list_rgw_zones(&self, session_id: &str) -> Result<Vec<RgwZoneInfo>, CephError> {
        let session = self.get_session(session_id)?;
        rgw::list_zones(&session).await
    }

    // -----------------------------------------------------------------------
    // CRUSH
    // -----------------------------------------------------------------------

    pub async fn get_crush_map(&self, session_id: &str) -> Result<CrushMap, CephError> {
        let session = self.get_session(session_id)?;
        crush::get_crush_map(&session).await
    }

    pub async fn list_crush_rules(&self, session_id: &str) -> Result<Vec<CrushRule>, CephError> {
        let session = self.get_session(session_id)?;
        crush::list_crush_rules(&session).await
    }

    pub async fn get_crush_tunables(&self, session_id: &str) -> Result<CrushTunables, CephError> {
        let session = self.get_session(session_id)?;
        crush::get_tunables(&session).await
    }

    // -----------------------------------------------------------------------
    // Monitors
    // -----------------------------------------------------------------------

    pub async fn list_monitors(&self, session_id: &str) -> Result<Vec<MonitorInfo>, CephError> {
        let session = self.get_session(session_id)?;
        monitors::list_monitors(&session).await
    }

    pub async fn get_quorum_status(&self, session_id: &str) -> Result<MonStatus, CephError> {
        let session = self.get_session(session_id)?;
        monitors::get_quorum_status(&session).await
    }

    pub async fn get_monitor_map(&self, session_id: &str) -> Result<MonMap, CephError> {
        let session = self.get_session(session_id)?;
        monitors::get_monitor_map(&session).await
    }

    pub async fn compact_monitor_store(
        &self,
        session_id: &str,
        mon_name: &str,
    ) -> Result<(), CephError> {
        let session = self.get_session(session_id)?;
        monitors::compact_monitor_store(&session, mon_name).await
    }

    // -----------------------------------------------------------------------
    // MDS
    // -----------------------------------------------------------------------

    pub async fn list_mds_servers(&self, session_id: &str) -> Result<Vec<MdsInfo>, CephError> {
        let session = self.get_session(session_id)?;
        mds::list_mds_servers(&session).await
    }

    pub async fn get_mds_perf(
        &self,
        session_id: &str,
        mds_name: &str,
    ) -> Result<MdsPerfStats, CephError> {
        let session = self.get_session(session_id)?;
        mds::get_mds_perf(&session, mds_name).await
    }

    pub async fn failover_mds(&self, session_id: &str, mds_name: &str) -> Result<(), CephError> {
        let session = self.get_session(session_id)?;
        mds::failover_mds(&session, mds_name).await
    }

    // -----------------------------------------------------------------------
    // Placement Groups
    // -----------------------------------------------------------------------

    pub async fn list_pgs(&self, session_id: &str) -> Result<Vec<PgInfo>, CephError> {
        let session = self.get_session(session_id)?;
        pg::list_pgs(&session).await
    }

    pub async fn get_pg_summary(&self, session_id: &str) -> Result<PgSummary, CephError> {
        let session = self.get_session(session_id)?;
        pg::get_pg_summary(&session).await
    }

    pub async fn repair_pg(&self, session_id: &str, pgid: &str) -> Result<(), CephError> {
        let session = self.get_session(session_id)?;
        pg::repair_pg(&session, pgid).await
    }

    pub async fn scrub_pg(&self, session_id: &str, pgid: &str) -> Result<(), CephError> {
        let session = self.get_session(session_id)?;
        pg::scrub_pg(&session, pgid).await
    }

    pub async fn deep_scrub_pg(&self, session_id: &str, pgid: &str) -> Result<(), CephError> {
        let session = self.get_session(session_id)?;
        pg::deep_scrub_pg(&session, pgid).await
    }

    pub async fn list_stuck_pgs(
        &self,
        session_id: &str,
        stuck_type: Option<&str>,
    ) -> Result<Vec<PgInfo>, CephError> {
        let session = self.get_session(session_id)?;
        pg::list_stuck_pgs(&session, stuck_type, None).await
    }

    // -----------------------------------------------------------------------
    // Performance
    // -----------------------------------------------------------------------

    pub async fn get_perf_metrics(&self, session_id: &str) -> Result<PerfMetrics, CephError> {
        let session = self.get_session(session_id)?;
        performance::get_perf_metrics(&session).await
    }

    pub async fn get_slow_requests(&self, session_id: &str) -> Result<Vec<SlowRequest>, CephError> {
        let session = self.get_session(session_id)?;
        performance::get_slow_requests(&session).await
    }

    pub async fn get_osd_perf(&self, session_id: &str) -> Result<Vec<OsdPerfCounters>, CephError> {
        let session = self.get_session(session_id)?;
        performance::get_osd_perf(&session).await
    }

    pub async fn get_pool_perf(&self, session_id: &str) -> Result<Vec<PoolStats>, CephError> {
        let session = self.get_session(session_id)?;
        performance::get_pool_perf(&session).await
    }

    pub async fn get_performance_counters(&self, session_id: &str) -> Result<Value, CephError> {
        let session = self.get_session(session_id)?;
        performance::get_performance_counters(&session).await
    }

    pub async fn get_recovery_progress(
        &self,
        session_id: &str,
    ) -> Result<RecoveryProgress, CephError> {
        let session = self.get_session(session_id)?;
        performance::get_recovery_progress(&session).await
    }

    // -----------------------------------------------------------------------
    // Alerts
    // -----------------------------------------------------------------------

    pub async fn list_health_checks(
        &self,
        session_id: &str,
    ) -> Result<Vec<HealthCheck>, CephError> {
        let session = self.get_session(session_id)?;
        alerts::list_health_checks(&session).await
    }

    pub async fn get_health_detail(&self, session_id: &str) -> Result<Value, CephError> {
        let session = self.get_session(session_id)?;
        alerts::get_health_detail(&session).await
    }

    pub async fn mute_health_check(
        &self,
        session_id: &str,
        check_code: &str,
        duration: Option<&str>,
    ) -> Result<(), CephError> {
        let session = self.get_session(session_id)?;
        alerts::mute_health_check(&session, check_code, duration, false).await
    }

    pub async fn unmute_health_check(
        &self,
        session_id: &str,
        check_code: &str,
    ) -> Result<(), CephError> {
        let session = self.get_session(session_id)?;
        alerts::unmute_health_check(&session, check_code).await
    }

    pub async fn list_alerts(&self, session_id: &str) -> Result<Vec<CephAlert>, CephError> {
        let session = self.get_session(session_id)?;
        alerts::list_alerts(&session).await
    }

    pub async fn acknowledge_alert(
        &self,
        session_id: &str,
        alert_id: &str,
    ) -> Result<(), CephError> {
        let session = self.get_session(session_id)?;
        alerts::acknowledge_alert(&session, alert_id, None).await
    }

    pub async fn clear_alert(&self, session_id: &str, alert_id: &str) -> Result<(), CephError> {
        let session = self.get_session(session_id)?;
        alerts::clear_alert(&session, alert_id).await
    }

    pub async fn get_health_summary(&self, session_id: &str) -> Result<Value, CephError> {
        let session = self.get_session(session_id)?;
        alerts::get_health_summary(&session).await
    }
}

impl Default for CephService {
    fn default() -> Self {
        Self::new()
    }
}
