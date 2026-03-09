//! Data types for disk/storage management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Connection ─────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub timeout_secs: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuth {
    Password {
        password: String,
    },
    PrivateKey {
        key_path: String,
        passphrase: Option<String>,
    },
    Agent,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskHost {
    pub id: String,
    pub name: String,
    pub ssh: Option<SshConfig>,
    pub use_sudo: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── Block Devices ──────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockDevice {
    pub name: String,
    pub path: String,
    pub device_type: BlockDeviceType,
    pub size_bytes: u64,
    pub size_human: String,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub vendor: Option<String>,
    pub transport: Option<String>,
    pub ro: bool,
    pub rm: bool,
    pub hotplug: bool,
    pub state: Option<String>,
    pub children: Vec<BlockDevice>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockDeviceType {
    Disk,
    Part,
    Lvm,
    Raid,
    Loop,
    Crypt,
    Rom,
    Other(String),
}

// ─── Partitions ─────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Partition {
    pub device: String,
    pub number: u32,
    pub start_sector: u64,
    pub end_sector: u64,
    pub size_bytes: u64,
    pub size_human: String,
    pub partition_type: String,
    pub fs_type: Option<String>,
    pub label: Option<String>,
    pub uuid: Option<String>,
    pub flags: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PartitionTable {
    Gpt,
    Mbr,
    Unknown,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskPartitionInfo {
    pub device: String,
    pub table_type: PartitionTable,
    pub size_bytes: u64,
    pub partitions: Vec<Partition>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePartitionOpts {
    pub device: String,
    pub size: String,
    pub fs_type: Option<String>,
    pub label: Option<String>,
}

// ─── Filesystems ────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Filesystem {
    pub device: String,
    pub mount_point: Option<String>,
    pub fs_type: String,
    pub label: Option<String>,
    pub uuid: Option<String>,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub avail_bytes: u64,
    pub use_percent: f32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MkfsOpts {
    pub device: String,
    pub fs_type: String,
    pub label: Option<String>,
    pub options: Vec<String>,
}

// ─── Mount / Fstab ──────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MountEntry {
    pub device: String,
    pub mount_point: String,
    pub fs_type: String,
    pub options: Vec<String>,
    pub dump: u8,
    pub pass: u8,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MountOpts {
    pub device: String,
    pub mount_point: String,
    pub fs_type: Option<String>,
    pub options: Vec<String>,
    pub read_only: bool,
}

// ─── LVM ────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysicalVolume {
    pub pv_name: String,
    pub vg_name: Option<String>,
    pub pv_size: String,
    pub pv_free: String,
    pub pv_uuid: String,
    pub fmt: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeGroup {
    pub vg_name: String,
    pub vg_size: String,
    pub vg_free: String,
    pub pv_count: u32,
    pub lv_count: u32,
    pub vg_uuid: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogicalVolume {
    pub lv_name: String,
    pub vg_name: String,
    pub lv_path: String,
    pub lv_size: String,
    pub lv_uuid: String,
    pub lv_attr: String,
    pub origin: Option<String>,
    pub snap_percent: Option<String>,
    pub pool_lv: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLvOpts {
    pub name: String,
    pub vg_name: String,
    pub size: String,
    pub thin_pool: Option<String>,
}

// ─── ZFS ────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZfsPool {
    pub name: String,
    pub size: String,
    pub alloc: String,
    pub free: String,
    pub health: String,
    pub dedup_ratio: Option<String>,
    pub fragmentation: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZfsDataset {
    pub name: String,
    pub used: String,
    pub avail: String,
    pub refer: String,
    pub mount_point: Option<String>,
    pub compression: Option<String>,
    pub dataset_type: ZfsDatasetType,
    pub properties: HashMap<String, String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ZfsDatasetType {
    Filesystem,
    Volume,
    Snapshot,
    Bookmark,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZfsSnapshot {
    pub name: String,
    pub dataset: String,
    pub used: String,
    pub refer: String,
    pub creation: Option<String>,
}

// ─── mdraid ─────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MdArray {
    pub device: String,
    pub level: String,
    pub state: String,
    pub member_count: u32,
    pub active_count: u32,
    pub failed_count: u32,
    pub spare_count: u32,
    pub size: String,
    pub members: Vec<MdMember>,
    pub rebuild_percent: Option<f32>,
    pub uuid: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MdMember {
    pub device: String,
    pub number: u32,
    pub state: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateArrayOpts {
    pub device: String,
    pub level: String,
    pub members: Vec<String>,
    pub spare: Vec<String>,
    pub chunk_size: Option<String>,
}

// ─── SMART ──────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartInfo {
    pub device: String,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub firmware: Option<String>,
    pub passed: bool,
    pub temperature_c: Option<u32>,
    pub power_on_hours: Option<u64>,
    pub reallocated_sectors: Option<u64>,
    pub pending_sectors: Option<u64>,
    pub offline_uncorrectable: Option<u64>,
    pub attributes: Vec<SmartAttribute>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartAttribute {
    pub id: u16,
    pub name: String,
    pub value: u16,
    pub worst: u16,
    pub threshold: u16,
    pub raw: String,
    pub failing: bool,
}

// ─── Swap ───────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapEntry {
    pub filename: String,
    pub swap_type: String,
    pub size_kb: u64,
    pub used_kb: u64,
    pub priority: i32,
}

// ─── Usage ──────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskUsage {
    pub path: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub avail_bytes: u64,
    pub use_percent: f32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectorySize {
    pub path: String,
    pub size_bytes: u64,
    pub size_human: String,
}

// ─── Health ─────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskHealthCheck {
    pub total_disks: u32,
    pub total_partitions: u32,
    pub total_capacity_bytes: u64,
    pub used_bytes: u64,
    pub lvm_present: bool,
    pub zfs_present: bool,
    pub raid_present: bool,
    pub smart_healthy: bool,
    pub warnings: Vec<String>,
    pub checked_at: DateTime<Utc>,
}
