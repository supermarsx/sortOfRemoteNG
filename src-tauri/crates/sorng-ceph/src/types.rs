use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Connection & Session
// ---------------------------------------------------------------------------

/// Configuration for connecting to a Ceph Manager REST API endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CephConnectionConfig {
    /// Hostname or IP address of the ceph-mgr node.
    pub host: String,
    /// REST API port (default 8003 for the restful module).
    pub port: u16,
    /// Username for authentication.
    pub username: String,
    /// Password for authentication (used with basic auth).
    pub password: Option<String>,
    /// API token (alternative to username/password).
    pub api_token: Option<String>,
    /// Whether to use TLS (HTTPS).
    pub use_tls: bool,
    /// Whether to verify TLS certificates.
    pub verify_cert: bool,
    /// Request timeout in seconds.
    pub timeout_secs: u64,
}

impl Default for CephConnectionConfig {
    fn default() -> Self {
        Self {
            host: "localhost".into(),
            port: 8003,
            username: "admin".into(),
            password: None,
            api_token: None,
            use_tls: true,
            verify_cert: true,
            timeout_secs: 30,
        }
    }
}

/// An authenticated session against a Ceph cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CephSession {
    /// Unique session identifier.
    pub id: String,
    /// Connection configuration for this session.
    pub config: CephConnectionConfig,
    /// Ceph cluster FSID.
    pub cluster_id: Option<String>,
    /// Friendly cluster name.
    pub cluster_name: Option<String>,
    /// Timestamp when the session was established.
    pub connected_at: DateTime<Utc>,
    /// API token obtained after authentication.
    pub auth_token: Option<String>,
}

// ---------------------------------------------------------------------------
// Cluster Health
// ---------------------------------------------------------------------------

/// Overall health status of the cluster.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HealthStatus {
    #[serde(rename = "HEALTH_OK")]
    Ok,
    #[serde(rename = "HEALTH_WARN")]
    Warning,
    #[serde(rename = "HEALTH_ERR")]
    Error,
}

impl std::fmt::Display for HealthStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ok => write!(f, "HEALTH_OK"),
            Self::Warning => write!(f, "HEALTH_WARN"),
            Self::Error => write!(f, "HEALTH_ERR"),
        }
    }
}

/// A single health check entry reported by the cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheck {
    /// Check code, e.g. "OSD_DOWN", "PG_DEGRADED".
    pub code: String,
    /// Severity of this check.
    pub severity: HealthStatus,
    /// Human-readable summary.
    pub summary: String,
    /// Detailed description.
    pub detail: Vec<String>,
    /// Whether this check has been muted.
    pub muted: bool,
}

/// Status summary for monitors.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonStatusSummary {
    pub num_mons: u32,
    pub num_in_quorum: u32,
    pub quorum_names: Vec<String>,
}

/// Status summary for OSDs at the cluster level.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsdStatusSummary {
    pub num_osds: u32,
    pub num_up_osds: u32,
    pub num_in_osds: u32,
    pub num_remapped_pgs: u32,
}

/// Status summary for placement groups at the cluster level.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgStatusSummary {
    pub num_pgs: u32,
    pub num_active_clean: u32,
    pub num_degraded: u32,
    pub num_recovering: u32,
    pub num_undersized: u32,
    pub num_stale: u32,
    pub num_peering: u32,
}

/// Storage utilization statistics for the entire cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageStats {
    /// Total raw capacity in bytes.
    pub total_bytes: u64,
    /// Used bytes (after replication / EC overhead).
    pub used_bytes: u64,
    /// Available bytes.
    pub available_bytes: u64,
    /// Used percentage.
    pub used_percent: f64,
    /// Raw bytes used on all OSDs including replication.
    pub raw_used_bytes: u64,
    /// Total number of RADOS objects.
    pub num_objects: u64,
    /// Logical data bytes stored.
    pub data_bytes: u64,
    /// Number of pools.
    pub num_pools: u32,
}

/// Comprehensive cluster health report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterHealth {
    /// Overall health status.
    pub overall_status: HealthStatus,
    /// Individual health checks.
    pub health_checks: Vec<HealthCheck>,
    /// Monitor status summary.
    pub mon_status: MonStatusSummary,
    /// OSD status summary.
    pub osd_status: OsdStatusSummary,
    /// Placement group status summary.
    pub pg_status: PgStatusSummary,
    /// Storage utilization.
    pub storage_stats: StorageStats,
}

// ---------------------------------------------------------------------------
// OSD
// ---------------------------------------------------------------------------

/// Operational status of an OSD daemon.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OsdStatus {
    Up,
    Down,
    In,
    Out,
    Destroyed,
}

impl std::fmt::Display for OsdStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Up => write!(f, "up"),
            Self::Down => write!(f, "down"),
            Self::In => write!(f, "in"),
            Self::Out => write!(f, "out"),
            Self::Destroyed => write!(f, "destroyed"),
        }
    }
}

/// Flags describing the current state set of an OSD.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OsdStateFlags {
    pub exists: bool,
    pub up: bool,
    pub is_in: bool,
    pub destroyed: bool,
    pub new: bool,
    pub nearfull: bool,
    pub full: bool,
    pub backfillfull: bool,
    pub noout: bool,
    pub noin: bool,
    pub nodown: bool,
    pub noup: bool,
}

/// Performance counters for a single OSD.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OsdPerfStats {
    pub commit_latency_ms: f64,
    pub apply_latency_ms: f64,
    pub read_ops: u64,
    pub write_ops: u64,
    pub read_bytes: u64,
    pub write_bytes: u64,
}

/// Detailed information about a single OSD.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsdInfo {
    /// OSD numeric ID (e.g. 0, 1, 2).
    pub id: u32,
    /// Unique UUID of the OSD.
    pub uuid: String,
    /// Display name (e.g. "osd.0").
    pub name: String,
    /// Hostname the OSD is running on.
    pub host: String,
    /// Device class (hdd, ssd, nvme).
    pub device_class: String,
    /// Primary status (Up/Down).
    pub status: OsdStatus,
    /// State flags.
    pub state: OsdStateFlags,
    /// CRUSH weight.
    pub weight: f64,
    /// Reweight factor (0.0–1.0).
    pub reweight: f64,
    /// CRUSH location map (e.g. {"host": "node1", "rack": "r1"}).
    pub crush_location: HashMap<String, String>,
    /// Epoch when this OSD was last marked up.
    pub up_from: u64,
    /// Epoch of last clean.
    pub last_clean: u64,
    /// Number of PGs mapped to this OSD.
    pub pg_count: u32,
    /// Current utilization percentage.
    pub utilization_percent: f64,
    /// Total capacity in bytes.
    pub total_bytes: u64,
    /// Used bytes on this OSD.
    pub used_bytes: u64,
    /// Data bytes (excluding BlueStore metadata).
    pub data_bytes: u64,
    /// OMAP data bytes.
    pub omap_bytes: u64,
    /// Per-OSD performance stats.
    pub perf_stats: OsdPerfStats,
}

/// A node in the OSD tree (CRUSH hierarchy).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsdTreeNode {
    pub id: i32,
    pub name: String,
    pub type_name: String,
    pub type_id: i32,
    pub weight: f64,
    pub children: Vec<i32>,
    pub status: Option<String>,
    pub reweight: Option<f64>,
    pub device_class: Option<String>,
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

/// Pool replication type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PoolType {
    Replicated,
    ErasureCoded,
}

impl std::fmt::Display for PoolType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Replicated => write!(f, "replicated"),
            Self::ErasureCoded => write!(f, "erasure"),
        }
    }
}

/// PG autoscale mode.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PgAutoscaleMode {
    #[serde(rename = "on")]
    On,
    #[serde(rename = "off")]
    Off,
    #[serde(rename = "warn")]
    Warn,
}

/// Compression mode for a pool.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CompressionMode {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "passive")]
    Passive,
    #[serde(rename = "aggressive")]
    Aggressive,
    #[serde(rename = "force")]
    Force,
}

/// Detailed information about a RADOS pool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolInfo {
    /// Numeric pool ID.
    pub id: u32,
    /// Pool name.
    pub name: String,
    /// Type of replication.
    pub pool_type: PoolType,
    /// Replication size (number of copies for replicated, ignored for EC).
    pub size: u32,
    /// Minimum number of replicas for I/O.
    pub min_size: u32,
    /// Number of placement groups.
    pub pg_num: u32,
    /// Number of placement groups for placement purposes.
    pub pgp_num: u32,
    /// PG autoscale mode.
    pub pg_autoscale_mode: PgAutoscaleMode,
    /// CRUSH rule name/ID applied to this pool.
    pub crush_rule: String,
    /// Application tag (rbd, cephfs, rgw, etc.).
    pub application: Option<String>,
    /// Maximum number of objects (0 = unlimited).
    pub quota_max_objects: u64,
    /// Maximum number of bytes (0 = unlimited).
    pub quota_max_bytes: u64,
    /// Bytes currently used.
    pub used_bytes: u64,
    /// Objects currently stored.
    pub used_objects: u64,
    /// Logical stored bytes.
    pub stored_bytes: u64,
    /// Compression mode.
    pub compression_mode: CompressionMode,
    /// Compression algorithm (snappy, zstd, lz4, zlib).
    pub compression_algorithm: Option<String>,
    /// Erasure code profile name (only for EC pools).
    pub erasure_code_profile: Option<String>,
    /// Whether the pool is marked for deletion.
    pub pool_delete_allowed: bool,
}

/// Per-pool stats from `ceph osd pool stats`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolStats {
    pub pool_name: String,
    pub pool_id: u32,
    pub client_io_rate: PoolIoRate,
    pub recovery_rate: PoolRecoveryRate,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PoolIoRate {
    pub read_ops_per_sec: u64,
    pub write_ops_per_sec: u64,
    pub read_bytes_per_sec: u64,
    pub write_bytes_per_sec: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PoolRecoveryRate {
    pub recovering_objects_per_sec: u64,
    pub recovering_bytes_per_sec: u64,
    pub recovering_keys_per_sec: u64,
}

// ---------------------------------------------------------------------------
// RBD (RADOS Block Device)
// ---------------------------------------------------------------------------

/// Information about an RBD image.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RbdImage {
    /// Image name.
    pub name: String,
    /// Pool the image resides in.
    pub pool: String,
    /// Namespace within the pool.
    pub namespace: Option<String>,
    /// Provisioned size in bytes.
    pub size_bytes: u64,
    /// Number of RADOS objects backing this image.
    pub num_objects: u64,
    /// Block name prefix in RADOS.
    pub block_name_prefix: String,
    /// Enabled features (layering, exclusive-lock, journaling, etc.).
    pub features: Vec<String>,
    /// Image flags.
    pub flags: Vec<String>,
    /// Creation timestamp.
    pub create_timestamp: Option<DateTime<Utc>>,
    /// Last access timestamp.
    pub access_timestamp: Option<DateTime<Utc>>,
    /// Last modify timestamp.
    pub modify_timestamp: Option<DateTime<Utc>>,
    /// Parent pool (if this is a clone).
    pub parent_pool: Option<String>,
    /// Parent image name.
    pub parent_image: Option<String>,
    /// Parent snapshot name.
    pub parent_snap: Option<String>,
    /// Stripe unit in bytes.
    pub stripe_unit: u64,
    /// Stripe count.
    pub stripe_count: u64,
    /// Object order (log2 of object size, default 22 = 4MB).
    pub order: u32,
    /// Data pool (for erasure-coded data pool backend).
    pub data_pool: Option<String>,
}

/// An RBD snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RbdSnapshot {
    /// Snapshot numeric ID.
    pub id: u64,
    /// Snapshot name.
    pub name: String,
    /// Size of the image at snapshot time.
    pub size_bytes: u64,
    /// Whether the snapshot is protected (required for cloning).
    pub protected: bool,
    /// Creation timestamp.
    pub timestamp: Option<DateTime<Utc>>,
}

/// RBD mirroring mode.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RbdMirrorMode {
    Disabled,
    Image,
    Pool,
}

/// Mirroring status for an RBD image.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RbdMirroringStatus {
    pub mode: RbdMirrorMode,
    pub state: String,
    pub is_primary: bool,
    pub peer_sites: Vec<RbdMirrorPeer>,
    pub last_update: Option<DateTime<Utc>>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RbdMirrorPeer {
    pub uuid: String,
    pub site_name: String,
    pub mirror_uuid: String,
    pub state: String,
    pub last_update: Option<DateTime<Utc>>,
    pub description: Option<String>,
}

/// An image in the RBD trash.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RbdTrashEntry {
    pub id: String,
    pub name: String,
    pub source: String,
    pub deletion_time: Option<DateTime<Utc>>,
    pub deferment_end_time: Option<DateTime<Utc>>,
}

// ---------------------------------------------------------------------------
// CephFS
// ---------------------------------------------------------------------------

/// Information about a CephFS filesystem.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CephFsInfo {
    /// Filesystem numeric ID.
    pub id: u32,
    /// Filesystem name.
    pub name: String,
    /// MDS map summary.
    pub mds_map: MdsMapSummary,
    /// Data pool names.
    pub data_pools: Vec<String>,
    /// Metadata pool name.
    pub metadata_pool: String,
    /// Maximum number of active MDS daemons.
    pub max_mds: u32,
    /// Number of active MDS daemons.
    pub in_count: u32,
    /// Number of MDS daemons currently up.
    pub up_count: u32,
    /// Number of standby MDS daemons.
    pub standby_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MdsMapSummary {
    pub epoch: u64,
    pub flags: Vec<String>,
    pub max_mds: u32,
    pub in_mds: Vec<String>,
    pub up_mds: Vec<String>,
}

/// CephFS client mount info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CephFsClient {
    pub id: u64,
    pub entity: String,
    pub ip_addr: String,
    pub mount_point: Option<String>,
    pub hostname: Option<String>,
    pub version: Option<String>,
}

/// A CephFS subvolume.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CephFsSubvolume {
    pub name: String,
    pub group: String,
    pub path: String,
    pub state: String,
    pub size_bytes: Option<u64>,
    pub quota_bytes: Option<u64>,
    pub created_at: Option<DateTime<Utc>>,
}

/// Directory stats in CephFS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryStats {
    pub path: String,
    pub files: u64,
    pub subdirs: u64,
    pub bytes: u64,
    pub quota_max_bytes: Option<u64>,
    pub quota_max_files: Option<u64>,
}

// ---------------------------------------------------------------------------
// MDS (Metadata Server)
// ---------------------------------------------------------------------------

/// State of an MDS daemon.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MdsState {
    Active,
    Standby,
    StandbyReplay,
    Stopping,
    Damaged,
    Rejoin,
    Creating,
    Starting,
    Unknown,
}

impl std::fmt::Display for MdsState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Active => write!(f, "active"),
            Self::Standby => write!(f, "standby"),
            Self::StandbyReplay => write!(f, "standby-replay"),
            Self::Stopping => write!(f, "stopping"),
            Self::Damaged => write!(f, "damaged"),
            Self::Rejoin => write!(f, "rejoin"),
            Self::Creating => write!(f, "creating"),
            Self::Starting => write!(f, "starting"),
            Self::Unknown => write!(f, "unknown"),
        }
    }
}

/// Information about a single MDS daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MdsInfo {
    /// MDS daemon name.
    pub name: String,
    /// Global ID.
    pub gid: u64,
    /// Rank within the MDS cluster (–1 for standby).
    pub rank: i32,
    /// Current state.
    pub state: MdsState,
    /// Network address.
    pub addr: String,
    /// If standby, which active MDS it prefers to follow.
    pub standby_for_name: Option<String>,
    /// Standby replay flag.
    pub standby_replay: bool,
}

/// Performance counters for an MDS daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MdsPerfStats {
    pub name: String,
    pub handle_client_request_latency_ms: f64,
    pub handle_slave_request_latency_ms: f64,
    pub inodes: u64,
    pub caps: u64,
    pub subtrees: u64,
    pub request_rate: f64,
}

// ---------------------------------------------------------------------------
// RGW (RADOS Gateway)
// ---------------------------------------------------------------------------

/// A RADOS Gateway user account.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwUser {
    pub user_id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub max_buckets: i32,
    pub suspended: bool,
    pub keys: Vec<RgwKey>,
    pub swift_keys: Vec<RgwSwiftKey>,
    pub caps: Vec<RgwCap>,
    pub bucket_quota: RgwQuota,
    pub user_quota: RgwQuota,
    pub op_mask: String,
    pub stats: Option<RgwUserStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwKey {
    pub access_key: String,
    pub secret_key: String,
    pub user: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwSwiftKey {
    pub user: String,
    pub secret_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwCap {
    #[serde(rename = "type")]
    pub cap_type: String,
    pub perm: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwQuota {
    pub enabled: bool,
    pub max_size: i64,
    pub max_size_kb: i64,
    pub max_objects: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwUserStats {
    pub size: u64,
    pub size_actual: u64,
    pub num_objects: u64,
}

/// An RGW bucket.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwBucket {
    pub name: String,
    pub owner: String,
    pub created_at: Option<DateTime<Utc>>,
    pub size_bytes: u64,
    pub num_objects: u64,
    pub zonegroup: Option<String>,
    pub placement_rule: Option<String>,
    pub versioning: Option<String>,
    pub mfa_delete: Option<String>,
    pub lifecycle: Option<String>,
    pub id: Option<String>,
    pub marker: Option<String>,
}

/// RGW usage record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwUsageEntry {
    pub user: String,
    pub categories: Vec<RgwUsageCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwUsageCategory {
    pub category: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub ops: u64,
    pub successful_ops: u64,
}

/// RGW zone info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwZoneInfo {
    pub id: String,
    pub name: String,
    pub domain_root: Option<String>,
    pub control_pool: Option<String>,
    pub gc_pool: Option<String>,
    pub log_pool: Option<String>,
    pub placement_pools: Vec<String>,
}

/// RGW zonegroup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwZoneGroup {
    pub id: String,
    pub name: String,
    pub is_master: bool,
    pub zones: Vec<RgwZoneRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwZoneRef {
    pub id: String,
    pub name: String,
}

/// RGW realm.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgwRealmInfo {
    pub id: String,
    pub name: String,
    pub current_period: Option<String>,
}

// ---------------------------------------------------------------------------
// Monitors
// ---------------------------------------------------------------------------

/// State of a monitor daemon.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MonitorState {
    Leader,
    Peon,
    Probing,
    Synchronizing,
    Electing,
}

impl std::fmt::Display for MonitorState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Leader => write!(f, "leader"),
            Self::Peon => write!(f, "peon"),
            Self::Probing => write!(f, "probing"),
            Self::Synchronizing => write!(f, "synchronizing"),
            Self::Electing => write!(f, "electing"),
        }
    }
}

/// Information about a single monitor daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub name: String,
    pub rank: u32,
    pub addr: String,
    pub state: MonitorState,
    pub health: HealthStatus,
    pub kb_total: u64,
    pub kb_used: u64,
    pub kb_avail: u64,
    pub store_stats: MonStoreStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonStoreStats {
    pub bytes_total: u64,
    pub bytes_sst: u64,
    pub bytes_log: u64,
    pub bytes_misc: u64,
    pub last_updated: Option<DateTime<Utc>>,
}

/// Full monitor status including quorum info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonStatus {
    pub name: String,
    pub rank: u32,
    pub state: MonitorState,
    pub election_epoch: u64,
    pub quorum: Vec<u32>,
    pub quorum_names: Vec<String>,
    pub leader: String,
    pub outside_quorum: Vec<String>,
}

/// Monitor map.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonMap {
    pub epoch: u64,
    pub fsid: String,
    pub modified: Option<DateTime<Utc>>,
    pub created: Option<DateTime<Utc>>,
    pub mons: Vec<MonMapEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonMapEntry {
    pub rank: u32,
    pub name: String,
    pub addr: String,
    pub public_addr: String,
}

// ---------------------------------------------------------------------------
// CRUSH
// ---------------------------------------------------------------------------

/// Complete CRUSH map.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrushMap {
    pub rules: Vec<CrushRule>,
    pub buckets: Vec<CrushBucket>,
    pub types: Vec<CrushType>,
    pub tunables: CrushTunables,
}

/// A CRUSH placement rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrushRule {
    pub id: u32,
    pub name: String,
    pub type_name: String,
    pub steps: Vec<CrushRuleStep>,
}

/// A single step within a CRUSH rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrushRuleStep {
    pub op: String,
    pub item: Option<i32>,
    pub item_name: Option<String>,
    pub num: Option<u32>,
    #[serde(rename = "type")]
    pub step_type: Option<String>,
}

/// A bucket (node) in the CRUSH hierarchy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrushBucket {
    pub id: i32,
    pub name: String,
    pub type_name: String,
    pub type_id: i32,
    pub weight: f64,
    pub items: Vec<CrushBucketItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrushBucketItem {
    pub id: i32,
    pub weight: f64,
    pub pos: u32,
}

/// CRUSH hierarchy type definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrushType {
    pub type_id: u32,
    pub name: String,
}

/// CRUSH tunables.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrushTunables {
    pub choose_local_tries: u32,
    pub choose_local_fallback_tries: u32,
    pub choose_total_tries: u32,
    pub chooseleaf_descend_once: u32,
    pub chooseleaf_vary_r: u32,
    pub chooseleaf_stable: u32,
    pub straw_calc_version: u32,
    pub profile: Option<String>,
    pub optimal_tunables: bool,
}

// ---------------------------------------------------------------------------
// Placement Groups
// ---------------------------------------------------------------------------

/// Information about a single placement group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgInfo {
    /// PG identifier (e.g. "1.0a").
    pub pgid: String,
    /// Combined state string (e.g. "active+clean").
    pub state: String,
    /// OSDs in the up set.
    pub up: Vec<u32>,
    /// OSDs in the acting set.
    pub acting: Vec<u32>,
    /// Last scrub timestamp.
    pub last_scrub: Option<DateTime<Utc>>,
    /// Last deep scrub timestamp.
    pub last_deep_scrub: Option<DateTime<Utc>>,
    /// Number of objects in this PG.
    pub objects: u64,
    /// Bytes stored in this PG.
    pub bytes: u64,
    /// Read operations since last reset.
    pub read_ops: u64,
    /// Write operations since last reset.
    pub write_ops: u64,
    /// Read bytes since last reset.
    pub read_bytes: u64,
    /// Write bytes since last reset.
    pub write_bytes: u64,
    /// Up primary OSD.
    pub up_primary: u32,
    /// Acting primary OSD.
    pub acting_primary: u32,
}

/// PG state flags parsed from the state string.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PgStateFlags {
    pub active: bool,
    pub clean: bool,
    pub degraded: bool,
    pub recovering: bool,
    pub backfilling: bool,
    pub remapped: bool,
    pub peering: bool,
    pub undersized: bool,
    pub stale: bool,
    pub inconsistent: bool,
    pub repair: bool,
    pub scrubbing: bool,
    pub deep: bool,
    pub backfill_wait: bool,
    pub recovery_wait: bool,
    pub forced_recovery: bool,
    pub forced_backfill: bool,
    pub creating: bool,
    pub unknown: bool,
}

impl PgStateFlags {
    /// Parse a PG state string like "active+clean+degraded" into flags.
    pub fn from_state_string(state: &str) -> Self {
        let mut flags = Self::default();
        for part in state.split('+') {
            match part.trim() {
                "active" => flags.active = true,
                "clean" => flags.clean = true,
                "degraded" => flags.degraded = true,
                "recovering" => flags.recovering = true,
                "backfilling" => flags.backfilling = true,
                "remapped" => flags.remapped = true,
                "peering" => flags.peering = true,
                "undersized" => flags.undersized = true,
                "stale" => flags.stale = true,
                "inconsistent" => flags.inconsistent = true,
                "repair" => flags.repair = true,
                "scrubbing" => flags.scrubbing = true,
                "deep" => flags.deep = true,
                "backfill_wait" => flags.backfill_wait = true,
                "recovery_wait" => flags.recovery_wait = true,
                "forced_recovery" => flags.forced_recovery = true,
                "forced_backfill" => flags.forced_backfill = true,
                "creating" => flags.creating = true,
                _ => flags.unknown = true,
            }
        }
        flags
    }
}

/// Summary of PG states across the cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgSummary {
    pub num_pgs: u32,
    pub states: HashMap<String, u32>,
    pub num_objects: u64,
    pub data_bytes: u64,
    pub num_bytes: u64,
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

/// Cluster-wide performance metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerfMetrics {
    pub iops_read: u64,
    pub iops_write: u64,
    pub throughput_read_bps: u64,
    pub throughput_write_bps: u64,
    pub latency_read_ms: f64,
    pub latency_write_ms: f64,
    pub recovery_rate_bps: u64,
    pub misplaced_objects: u64,
    pub degraded_objects: u64,
    pub client_io: ClientIo,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClientIo {
    pub read_ops_per_sec: u64,
    pub write_ops_per_sec: u64,
    pub read_bytes_per_sec: u64,
    pub write_bytes_per_sec: u64,
}

/// Recovery progress report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryProgress {
    pub objects_recovered: u64,
    pub objects_total: u64,
    pub bytes_recovered: u64,
    pub bytes_total: u64,
    pub recovery_rate_bps: u64,
    pub estimated_time_remaining_secs: Option<u64>,
    pub active_pgs_recovering: u32,
}

/// A historical performance data point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerfDataPoint {
    pub timestamp: DateTime<Utc>,
    pub value: f64,
}

/// A slow request captured by the cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlowRequest {
    pub ops_in_flight: u32,
    pub duration_ms: f64,
    pub description: String,
    pub initiated_at: Option<DateTime<Utc>>,
    pub osd: Option<String>,
    pub type_name: String,
}

/// Detailed per-OSD perf counters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsdPerfCounters {
    pub osd_id: u32,
    pub commit_latency_ms: f64,
    pub apply_latency_ms: f64,
    pub op_r: u64,
    pub op_w: u64,
    pub op_rw: u64,
    pub op_r_out_bytes: u64,
    pub op_w_in_bytes: u64,
    pub subop: u64,
    pub subop_in_bytes: u64,
    pub subop_latency_ms: f64,
    pub recovery_ops: u64,
    pub loadavg: f64,
    pub buffer_bytes: u64,
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/// Severity of a Ceph alert.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AlertSeverity {
    Critical,
    Warning,
    Info,
}

impl std::fmt::Display for AlertSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Critical => write!(f, "critical"),
            Self::Warning => write!(f, "warning"),
            Self::Info => write!(f, "info"),
        }
    }
}

/// An alert from the Ceph health check system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CephAlert {
    pub id: String,
    pub severity: AlertSeverity,
    pub type_name: String,
    pub message: String,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub count: u64,
    pub entity: Option<String>,
    pub muted: bool,
    pub muted_until: Option<DateTime<Utc>>,
    pub acknowledged: bool,
    pub detail: Vec<String>,
}

// ---------------------------------------------------------------------------
// Erasure Coding
// ---------------------------------------------------------------------------

/// An erasure code profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErasureCodeProfile {
    pub name: String,
    pub plugin: String,
    pub k: u32,
    pub m: u32,
    pub technique: Option<String>,
    pub crush_failure_domain: String,
    pub crush_device_class: Option<String>,
}

// ---------------------------------------------------------------------------
// Cluster Config
// ---------------------------------------------------------------------------

/// A single Ceph configuration option.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CephConfig {
    pub section: String,
    pub name: String,
    pub value: String,
    pub source: String,
    pub mask: Option<String>,
    pub can_update_at_runtime: bool,
}

// ---------------------------------------------------------------------------
// Services / Daemons
// ---------------------------------------------------------------------------

/// Daemon type enum.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DaemonType {
    Mon,
    Osd,
    Mds,
    Mgr,
    Rgw,
    CrashCollector,
    Agent,
    RbdMirror,
    CephExporter,
}

impl std::fmt::Display for DaemonType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Mon => write!(f, "mon"),
            Self::Osd => write!(f, "osd"),
            Self::Mds => write!(f, "mds"),
            Self::Mgr => write!(f, "mgr"),
            Self::Rgw => write!(f, "rgw"),
            Self::CrashCollector => write!(f, "crash"),
            Self::Agent => write!(f, "agent"),
            Self::RbdMirror => write!(f, "rbd-mirror"),
            Self::CephExporter => write!(f, "ceph-exporter"),
        }
    }
}

/// Information about a running Ceph service/daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub type_name: DaemonType,
    pub id: String,
    pub status: String,
    pub hostname: String,
    pub daemon_type: String,
    pub version: Option<String>,
    pub running: bool,
    pub last_configured: Option<DateTime<Utc>>,
    pub memory_usage_bytes: Option<u64>,
}

// ---------------------------------------------------------------------------
// Request/creation parameter types
// ---------------------------------------------------------------------------

/// Parameters for creating a new pool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePoolParams {
    pub name: String,
    pub pool_type: PoolType,
    pub size: Option<u32>,
    pub min_size: Option<u32>,
    pub pg_num: Option<u32>,
    pub application: Option<String>,
    pub crush_rule: Option<String>,
    pub erasure_code_profile: Option<String>,
}

/// Parameters for creating a new OSD.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateOsdParams {
    pub host: String,
    pub device: String,
    pub device_class: Option<String>,
    pub db_device: Option<String>,
    pub wal_device: Option<String>,
}

/// Parameters for creating an RBD image.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRbdImageParams {
    pub pool: String,
    pub name: String,
    pub size_bytes: u64,
    pub features: Option<Vec<String>>,
    pub stripe_unit: Option<u64>,
    pub stripe_count: Option<u64>,
    pub data_pool: Option<String>,
    pub object_size: Option<u64>,
}

/// Parameters for creating an RGW user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRgwUserParams {
    pub user_id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub max_buckets: Option<i32>,
    pub generate_key: bool,
    pub access_key: Option<String>,
    pub secret_key: Option<String>,
    pub caps: Option<Vec<RgwCap>>,
}

/// Parameters for creating a CRUSH rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCrushRuleParams {
    pub name: String,
    pub root: String,
    pub failure_domain: String,
    pub device_class: Option<String>,
    pub rule_type: String,
}

/// Parameters for creating an erasure code profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateErasureCodeProfileParams {
    pub name: String,
    pub k: u32,
    pub m: u32,
    pub plugin: Option<String>,
    pub technique: Option<String>,
    pub crush_failure_domain: Option<String>,
    pub crush_device_class: Option<String>,
}
