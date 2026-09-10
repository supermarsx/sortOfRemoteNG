//! Storage management — volumes, disks, pools, SMART, iSCSI.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct StorageManager;

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
        let v = client
            .best_version("SYNO.Storage.CGI.Storage", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Storage.CGI.Storage", v, "load_info", &[])
            .await
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
    pub async fn get_smart_info(client: &SynoClient, disk_id: &str) -> SynologyResult<SmartInfo> {
        let v = client
            .best_version("SYNO.Storage.CGI.Smart", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Storage.CGI.Smart", v, "get", &[("disk", disk_id)])
            .await
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
