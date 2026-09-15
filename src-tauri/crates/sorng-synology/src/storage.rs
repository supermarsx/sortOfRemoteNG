//! Storage management — volumes, disks, pools, SMART, iSCSI.

use crate::client::SynoClient;
use crate::error::{SynologyErrorKind, SynologyResult};
use crate::types::*;
use crate::wire::{opt_i64_lenient, opt_string_or_number, opt_u64_lenient, u64_lenient};
use serde::Deserialize;

pub struct StorageManager;

const STORAGE_API: &str = "SYNO.Storage.CGI.Storage";
const SMART_API: &str = "SYNO.Storage.CGI.Smart";

// ── `SYNO.Storage.CGI.Storage load_info` ────────────────────────────
//
// Shapes: vcf-content-factory `synology-storage.md` (DS1520+, DSM 7.3.2) and
// py-synologydsm-api `const_6_storage_storage.py` (four DSM 6 NAS). DSM 7.3.2
// sends no `hotSpares`, DS213+ on DSM 6 no `ssdCaches`, and every size is a
// decimal string. `disks` and `volumes` stay required so a wrong payload never
// renders as empty tables.

/// The decoded overview; `StorageWire` conversion failures (a hot spare
/// without a disk id) surface as serde errors, so they keep the closed
/// `json_schema` diagnostic.
#[derive(Deserialize)]
#[serde(try_from = "StorageWire")]
struct StorageReply(StorageOverview);

#[derive(Deserialize)]
struct StorageWire {
    disks: Vec<DiskWire>,
    volumes: Vec<VolumeWire>,
    #[serde(rename = "storagePools", default)]
    storage_pools: Vec<PoolWire>,
    #[serde(rename = "ssdCaches", default)]
    ssd_caches: Vec<CacheWire>,
    #[serde(rename = "hotSpares", default)]
    hot_spares: Vec<HotSpareWire>,
}

#[derive(Deserialize)]
struct DiskWire {
    id: String,
    name: String,
    device: String,
    model: String,
    vendor: Option<String>,
    serial: Option<String>,
    firm: Option<String>,
    #[serde(deserialize_with = "u64_lenient")]
    size_total: u64,
    temp: Option<i32>,
    status: String,
    smart_status: Option<String>,
    #[serde(rename = "diskType")]
    disk_type: Option<String>,
    exceed_bad_sector_thr: Option<bool>,
    intf: Option<String>,
    /// `{"order":0,"str":"DS1520+","supportPwrBtnDisable":false,"type":"internal"}`
    container: Option<DiskContainerWire>,
}

#[derive(Deserialize)]
struct DiskContainerWire {
    pool: Option<String>,
    volume: Option<String>,
    r#type: Option<String>,
}

#[derive(Deserialize)]
struct VolumeWire {
    id: String,
    status: String,
    fs_type: Option<String>,
    pool_path: Option<String>,
    desc: Option<String>,
    vol_desc: Option<String>,
    vol_path: Option<String>,
    display_name: Option<String>,
    container: Option<String>,
    /// Required: a volume without its capacity is not a volume row.
    size: VolumeSizeWire,
}

/// `{"total":"28788160495616","used":"7632707117056",...}`.
#[derive(Deserialize)]
struct VolumeSizeWire {
    #[serde(deserialize_with = "u64_lenient")]
    total: u64,
    #[serde(deserialize_with = "u64_lenient")]
    used: u64,
}

#[derive(Deserialize)]
struct PoolWire {
    id: String,
    status: String,
    /// `raid_6`, `shr_with_2_disk_protect`: more useful than `raidType`,
    /// which DSM reports as `multiple` for every SHR/RAID pool.
    device_type: Option<String>,
    #[serde(rename = "raidType")]
    raid_type: Option<String>,
    size: Option<PoolSizeWire>,
    disks: Vec<String>,
    desc: Option<String>,
}

#[derive(Deserialize)]
struct PoolSizeWire {
    #[serde(default, deserialize_with = "opt_u64_lenient")]
    total: Option<u64>,
    #[serde(default, deserialize_with = "opt_u64_lenient")]
    used: Option<u64>,
}

/// DSM 7.3.2 `ssdCaches[]`: `size.{total,occupied,reusable}` strings,
/// `hit_rate`/`hit_rate_write` and member `disks`.
#[derive(Deserialize)]
struct CacheWire {
    id: String,
    status: String,
    size: CacheSizeWire,
    /// DSM's pre-computed read hit rate; its JSON type is unconfirmed, so a
    /// non-numeric value is dropped instead of failing the whole overview.
    hit_rate: Option<serde_json::Value>,
    disks: Vec<String>,
}

#[derive(Deserialize)]
struct CacheSizeWire {
    #[serde(deserialize_with = "u64_lenient")]
    total: u64,
}

/// Hot spare rows were empty in every public sample; accept either id key.
#[derive(Deserialize)]
struct HotSpareWire {
    disk_id: Option<String>,
    id: Option<String>,
    pool_id: Option<String>,
}

fn non_empty(text: Option<String>) -> Option<String> {
    text.filter(|value| !value.is_empty())
}

impl From<DiskWire> for DiskInfo {
    fn from(disk: DiskWire) -> Self {
        Self {
            id: disk.id,
            name: disk.name,
            device: disk.device,
            model: disk.model,
            vendor: disk.vendor,
            serial: disk.serial,
            firmware: disk.firm,
            size_total: disk.size_total,
            temp: disk.temp,
            status: disk.status,
            smart_status: disk.smart_status,
            disk_type: disk.disk_type,
            exceed_bad_sector_thr: disk.exceed_bad_sector_thr,
            intf: disk.intf,
            container: disk.container.map(|container| DiskContainer {
                pool: container.pool,
                volume: container.volume,
                r#type: container.r#type,
            }),
        }
    }
}

impl From<VolumeWire> for VolumeInfo {
    fn from(volume: VolumeWire) -> Self {
        let VolumeSizeWire { total, used } = volume.size;
        // Derived from DSM's own numbers, truncated to two decimals.
        let usage_percent =
            (total > 0).then(|| (u128::from(used) * 10_000 / u128::from(total)) as f64 / 100.0);
        // DSM 7 sends no display name and usually an empty `vol_desc`; the
        // `/volume1` mount path gives the label DSM itself shows (`volume1`).
        let display_name = non_empty(volume.display_name)
            .or_else(|| non_empty(volume.vol_desc))
            .or_else(|| {
                non_empty(
                    volume
                        .vol_path
                        .map(|path| path.trim_start_matches('/').to_owned()),
                )
            });
        Self {
            id: volume.id,
            display_name,
            status: volume.status,
            fs_type: volume.fs_type,
            size_total: total,
            size_used: used,
            size_free: total.saturating_sub(used),
            usage_percent,
            pool_path: volume.pool_path,
            desc: volume.desc,
            container: volume.container,
        }
    }
}

impl From<PoolWire> for StoragePool {
    fn from(pool: PoolWire) -> Self {
        let (size_total, size_used) = pool
            .size
            .map_or((None, None), |size| (size.total, size.used));
        Self {
            id: pool.id,
            status: pool.status,
            raid_type: non_empty(pool.device_type).or_else(|| non_empty(pool.raid_type)),
            size_total,
            size_used,
            disks: pool.disks,
            desc: pool.desc,
        }
    }
}

impl From<CacheWire> for SsdCache {
    fn from(cache: CacheWire) -> Self {
        let read_hit = cache.hit_rate.and_then(|rate| match rate {
            serde_json::Value::Number(number) => number.as_f64(),
            serde_json::Value::String(text) => text.trim().parse().ok(),
            _ => None,
        });
        Self {
            id: cache.id,
            status: cache.status,
            size: cache.size.total,
            read_hit,
            disks: cache.disks,
        }
    }
}

impl TryFrom<HotSpareWire> for HotSpare {
    type Error = &'static str;

    fn try_from(spare: HotSpareWire) -> Result<Self, Self::Error> {
        Ok(Self {
            disk_id: non_empty(spare.disk_id)
                .or_else(|| non_empty(spare.id))
                .ok_or("hot spare without a disk id")?,
            pool_id: spare.pool_id,
        })
    }
}

impl TryFrom<StorageWire> for StorageReply {
    type Error = &'static str;

    fn try_from(wire: StorageWire) -> Result<Self, Self::Error> {
        Ok(Self(StorageOverview {
            disks: wire.disks.into_iter().map(DiskInfo::from).collect(),
            volumes: wire.volumes.into_iter().map(VolumeInfo::from).collect(),
            storage_pools: wire
                .storage_pools
                .into_iter()
                .map(StoragePool::from)
                .collect(),
            ssd_caches: wire.ssd_caches.into_iter().map(SsdCache::from).collect(),
            hot_spares: wire
                .hot_spares
                .into_iter()
                .map(HotSpare::try_from)
                .collect::<Result<_, _>>()?,
        }))
    }
}

// ── `SYNO.Storage.CGI.Smart` ────────────────────────────────────────
//
// No public sample of a successful SMART reply exists (S§7 #3), so every field
// is optional and several spellings are accepted. A reply with neither a
// health field nor attributes is a schema failure, never an empty SMART row.

#[derive(Deserialize)]
#[serde(try_from = "SmartWire")]
struct SmartReply(SmartInfo);

#[derive(Deserialize)]
struct SmartWire {
    #[serde(default, deserialize_with = "opt_string_or_number")]
    disk_id: Option<String>,
    #[serde(default, deserialize_with = "opt_string_or_number")]
    id: Option<String>,
    disk_name: Option<String>,
    name: Option<String>,
    #[serde(rename = "longName")]
    long_name: Option<String>,
    health_status: Option<String>,
    health: Option<String>,
    smart_status: Option<String>,
    overview_status: Option<String>,
    #[serde(default, deserialize_with = "opt_i64_lenient")]
    temperature: Option<i64>,
    #[serde(default, deserialize_with = "opt_i64_lenient")]
    temp: Option<i64>,
    #[serde(default, deserialize_with = "opt_u64_lenient")]
    power_on_hours: Option<u64>,
    #[serde(default, deserialize_with = "opt_u64_lenient")]
    reallocated_sectors: Option<u64>,
    attributes: Option<Vec<SmartAttributeWire>>,
}

#[derive(Deserialize)]
struct SmartAttributeWire {
    #[serde(deserialize_with = "u64_lenient")]
    id: u64,
    name: String,
    #[serde(deserialize_with = "u64_lenient")]
    current: u64,
    #[serde(deserialize_with = "u64_lenient")]
    worst: u64,
    #[serde(deserialize_with = "u64_lenient")]
    threshold: u64,
    #[serde(deserialize_with = "crate::wire::string_or_number")]
    raw: String,
    status: String,
}

impl TryFrom<SmartAttributeWire> for SmartAttribute {
    type Error = &'static str;

    fn try_from(attribute: SmartAttributeWire) -> Result<Self, Self::Error> {
        Ok(Self {
            id: u32::try_from(attribute.id).map_err(|_| "SMART attribute id out of range")?,
            name: attribute.name,
            current: attribute.current,
            worst: attribute.worst,
            threshold: attribute.threshold,
            raw: attribute.raw,
            status: attribute.status,
        })
    }
}

impl TryFrom<SmartWire> for SmartReply {
    type Error = &'static str;

    fn try_from(wire: SmartWire) -> Result<Self, Self::Error> {
        let health_status = non_empty(wire.health_status)
            .or_else(|| non_empty(wire.health))
            .or_else(|| non_empty(wire.smart_status))
            .or_else(|| non_empty(wire.overview_status));
        if health_status.is_none() && wire.attributes.is_none() {
            return Err("SMART reply without health status or attributes");
        }
        let attributes = wire
            .attributes
            .map(|rows| {
                rows.into_iter()
                    .map(SmartAttribute::try_from)
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?;
        Ok(Self(SmartInfo {
            // Filled with the requested disk when DSM does not echo an id.
            disk_id: non_empty(wire.disk_id)
                .or_else(|| non_empty(wire.id))
                .unwrap_or_default(),
            disk_name: non_empty(wire.disk_name)
                .or_else(|| non_empty(wire.name))
                .or_else(|| non_empty(wire.long_name)),
            health_status,
            temperature: wire
                .temperature
                .or(wire.temp)
                .and_then(|value| i32::try_from(value).ok()),
            power_on_hours: wire.power_on_hours,
            reallocated_sectors: wire.reallocated_sectors,
            attributes,
        }))
    }
}

// Explicit DSM wire shapes match Synology's own CSI driver; renderer DTOs are
// intentionally different (string identifiers and flattened mappings).
#[derive(serde::Deserialize)]
struct LunList {
    luns: Vec<LunWire>,
}
#[derive(serde::Deserialize)]
struct LunWire {
    uuid: String,
    name: String,
    size: u64,
    status: String,
    allocated_size: Option<u64>,
    location: Option<String>,
}
#[derive(serde::Deserialize)]
struct TargetList {
    targets: Vec<TargetWire>,
}
#[derive(serde::Deserialize)]
struct TargetWire {
    target_id: u64,
    name: String,
    iqn: String,
    status: String,
    max_sessions: Option<u32>,
    mapped_luns: Vec<MappedLun>,
}
#[derive(serde::Deserialize)]
struct MappedLun {
    lun_uuid: String,
}

impl StorageManager {
    /// Get high-level storage overview (all volumes + pools + disks).
    pub async fn get_overview(client: &SynoClient) -> SynologyResult<StorageOverview> {
        let v = client.best_version(STORAGE_API, 1).unwrap_or(1);
        let StorageReply(overview) = client.api_call(STORAGE_API, v, "load_info", &[]).await?;
        Ok(overview)
    }

    /// List all physical disks.
    pub async fn list_disks(client: &SynoClient) -> SynologyResult<Vec<DiskInfo>> {
        let overview = Self::get_overview(client).await?;
        Ok(overview.disks)
    }

    /// List all volumes.
    pub async fn list_volumes(client: &SynoClient) -> SynologyResult<Vec<VolumeInfo>> {
        let overview = Self::get_overview(client).await?;
        Ok(overview.volumes)
    }

    /// List all storage pools.
    pub async fn list_pools(client: &SynoClient) -> SynologyResult<Vec<StoragePool>> {
        let overview = Self::get_overview(client).await?;
        Ok(overview.storage_pools)
    }

    /// Get SMART info for a specific disk.
    ///
    /// `get` comes first: the DSM 6 and 7 `.lib` definitions list it
    /// (kwent/syno `definitions/{6.x,7.x}/_full.json`). A DSM 7.4 probe did not
    /// answer `get`, and N4S4/synology-api reads `get_health_info`, so only an
    /// "unknown method" answer (103) retries once with `get_health_info` and
    /// the same `disk`. Every other DSM error, including 105, propagates.
    pub async fn get_smart_info(client: &SynoClient, disk_id: &str) -> SynologyResult<SmartInfo> {
        let v = client.best_version(SMART_API, 1).unwrap_or(1);
        let disk = crate::wire::string_param(client, SMART_API, disk_id);
        let form = [("disk", disk.as_str())];
        let reply = match client.api_call(SMART_API, v, "get", &form).await {
            Err(error) if matches!(error.kind, SynologyErrorKind::ApiError(103)) => {
                client
                    .api_call(SMART_API, v, "get_health_info", &form)
                    .await
            }
            other => other,
        };
        let SmartReply(mut smart) = reply?;
        if smart.disk_id.is_empty() {
            disk_id.clone_into(&mut smart.disk_id);
        }
        Ok(smart)
    }

    /// Run a SMART test on a disk.
    pub async fn run_smart_test(
        client: &SynoClient,
        disk_id: &str,
        test_type: &str,
    ) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Storage.CGI.Smart", 1)
            .unwrap_or(1);
        client
            .api_call_void(
                "SYNO.Storage.CGI.Smart",
                v,
                "test",
                &[("disk", disk_id), ("type", test_type)],
            )
            .await
    }

    /// List SSD caches if any.
    pub async fn list_ssd_caches(client: &SynoClient) -> SynologyResult<Vec<SsdCache>> {
        let overview = Self::get_overview(client).await?;
        Ok(overview.ssd_caches)
    }

    /// List hot spare disks.
    pub async fn list_hot_spares(client: &SynoClient) -> SynologyResult<Vec<HotSpare>> {
        let overview = Self::get_overview(client).await?;
        Ok(overview.hot_spares)
    }

    /// List iSCSI LUNs.
    pub async fn list_iscsi_luns(client: &SynoClient) -> SynologyResult<Vec<IscsiLun>> {
        let v = client.best_version("SYNO.Core.ISCSI.LUN", 1).unwrap_or(1);
        let result: LunList = client
            .api_call(
                "SYNO.Core.ISCSI.LUN",
                v,
                "list",
                &[("additional", "[\"allocated_size\",\"status\"]")],
            )
            .await?;
        Ok(result
            .luns
            .into_iter()
            .map(|lun| IscsiLun {
                lun_id: lun.uuid,
                name: lun.name,
                size: lun.size,
                status: lun.status,
                used_size: lun.allocated_size,
                location: lun.location,
                mapped_targets: None,
            })
            .collect())
    }

    /// List iSCSI targets.
    pub async fn list_iscsi_targets(client: &SynoClient) -> SynologyResult<Vec<IscsiTarget>> {
        let v = client
            .best_version("SYNO.Core.ISCSI.Target", 1)
            .unwrap_or(1);
        let result: TargetList = client
            .api_call(
                "SYNO.Core.ISCSI.Target",
                v,
                "list",
                &[("additional", "[\"mapped_lun\",\"connected_sessions\"]")],
            )
            .await?;
        Ok(result
            .targets
            .into_iter()
            .map(|target| IscsiTarget {
                target_id: target.target_id.to_string(),
                name: target.name,
                iqn: target.iqn,
                status: target.status,
                max_sessions: target.max_sessions,
                mapped_luns: target
                    .mapped_luns
                    .into_iter()
                    .map(|lun| lun.lun_uuid)
                    .collect(),
            })
            .collect())
    }

    /// Get storage utilization in percentage for each volume.
    pub async fn get_volume_utilization(client: &SynoClient) -> SynologyResult<Vec<VolumeInfo>> {
        let overview = Self::get_overview(client).await?;
        Ok(overview.volumes)
    }
}
