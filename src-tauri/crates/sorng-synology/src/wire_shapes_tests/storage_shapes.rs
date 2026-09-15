//! Owned by t84-e12c: `SYNO.Storage.CGI.Storage load_info` (storage overview,
//! disks, volumes) and `SYNO.Storage.CGI.Smart` decoded from DSM's real shapes
//! into the unchanged IPC DTOs.
//!
//! Compatibility kept: sizes decode as JSON numbers as well as DSM's decimal
//! strings, and `hotSpares`/`ssdCaches`/`storagePools` may be absent. The old
//! flat DTO volume shape (`size_total`/`size_used`/`size_free` at the top
//! level) is not accepted: no DSM release is known to send it.

use super::*;

const STORAGE: &str = "SYNO.Storage.CGI.Storage";
const SMART: &str = "SYNO.Storage.CGI.Smart";

// ── Fixtures ────────────────────────────────────────────────────────

/// `storageOverview` read (DS1520+-class NAS, no `hotSpares` key).
// shape: vcf-content-factory api-maps/synology-storage.md load_info [observed DSM 7.3.2] (MIT)
pub(super) fn real_storage_overview() -> Value {
    json!({
        "detected_pools": [],
        "disks": [
            {"id": "sata1", "name": "Drive 1", "longName": "Drive 1", "device": "/dev/sata1", "model": "FIXTURE-HDD-10T", "vendor": "Seagate", "serial": "SYNTH0001", "firm": "SC60",
             "size_total": "10000831348736", "temp": 35, "status": "normal", "smart_status": "normal", "overview_status": "normal", "diskType": "SATA", "isSsd": false, "portType": "normal", "exceed_bad_sector_thr": false,
             "container": {"order": 0, "str": "DS1520+", "supportPwrBtnDisable": false, "type": "internal"}, "used_by": "reuse_1", "remain_life": {"trustable": true, "value": -1}, "unc": 0},
            {"id": "nvme0n1", "name": "Cache device 1", "longName": "Cache device 1", "device": "/dev/nvme0n1", "model": "FIXTURE-NVME-400G", "vendor": "Synology", "serial": "SYNTH0002", "firm": "S0000A0",
             "size_total": "400088457216", "temp": 41, "status": "normal", "smart_status": "normal", "diskType": "M.2 NVMe", "isSsd": true, "portType": "cache", "exceed_bad_sector_thr": false,
             "container": {"order": 0, "str": "DS1520+", "supportPwrBtnDisable": false, "type": "internal"}, "used_by": "shared_cache_1", "remain_life": {"trustable": true, "value": 98}}
        ],
        "env": {},
        "missing_pools": [],
        "overview_data": {},
        "ports": [],
        "sharedCaches": [{"id": "shared_cache_1", "device_type": "raid_1", "disks": ["nvme0n1"], "size": {"total": "400076964904", "used": "400076964904", "recyclable": "0"}}],
        "ssdCaches": [
            {"id": "alloc_cache_1_1", "status": "normal", "mode": "read", "device_type": "raid_1", "disks": ["nvme0n1"], "mountSpaceId": "volume_1", "path": "/volume1",
             "hit_rate": 37, "hit_rate_write": 0, "size": {"total": "107374182400", "occupied": "53687091200", "reusable": "0"}}
        ],
        "storagePools": [
            {"id": "reuse_1", "status": "normal", "device_type": "raid_6", "raidType": "multiple", "desc": "", "disks": ["sata1"], "cache_disks": ["nvme0n1"], "pool_path": "reuse_1",
             "size": {"total": "29987679764480", "used": "29987679764480"}, "uuid": "00000000-0000-4000-8000-000000000001"}
        ],
        "volumes": [
            {"id": "volume_1", "status": "normal", "fs_type": "btrfs", "vol_path": "/volume1", "vol_desc": "", "desc": "", "pool_path": "reuse_1", "container": "internal", "device_type": "raid_6", "raidType": "multiple",
             "size": {"free_inode": "0", "total": "28788160495616", "total_device": "29987667181568", "total_inode": "0", "used": "7632707117056"}, "uuid": "00000000-0000-4000-8000-000000000002"}
        ]
    })
}

/// `disks` read: the same `load_info` answer as `storageOverview`.
pub(super) fn real_disks() -> Value {
    real_storage_overview()
}

/// `volumes` read: the same `load_info` answer as `storageOverview`.
pub(super) fn real_volumes() -> Value {
    real_storage_overview()
}

/// `selectedDiskSmart` read (not a READS probe).
// shape: synthetic; DSM shape unverified (S§7 #3)
pub(super) fn real_selected_disk_smart() -> Value {
    json!({
        "longName": "Drive 1",
        "health": "normal",
        "temp": "35",
        "power_on_hours": "12345",
        "reallocated_sectors": 0,
        "attributes": [
            {"id": "5", "name": "Reallocated_Sector_Ct", "current": "100", "worst": 100, "threshold": "10", "raw": 0, "status": "OK"},
            {"id": 9, "name": "Power_On_Hours", "current": 86, "worst": 86, "threshold": 0, "raw": "12345", "status": "OK"}
        ]
    })
}

// DS213+ with SHR-1 and two volumes: no `ssdCaches` key at all. Trimmed; the
// second volume's non-empty `vol_desc` is a synthetic variant.
// shape: py-synologydsm-api tests/api_data/dsm_6/storage/const_6_storage_storage.py DSM_6_STORAGE_STORAGE_DS213_PLUS_SHR1_2DISKS_2VOLS (MIT)
fn dsm6_ds213_storage() -> Value {
    json!({
        "disks": [
            {"id": "sda", "name": "Disk 1", "device": "/dev/sda", "model": "FIXTURE-HDD-2T", "vendor": "WDC", "serial": "SYNTH0101", "firm": "01.00A01",
             "size_total": "2000398934016", "temp": 30, "status": "normal", "smart_status": "normal", "diskType": "SATA", "exceed_bad_sector_thr": false,
             "container": {"order": 0, "str": "DS213+", "supportPwrBtnDisable": false, "type": "internal"}},
            {"id": "sdb", "name": "Disk 2", "device": "/dev/sdb", "model": "FIXTURE-HDD-2T", "vendor": "WDC", "serial": "SYNTH0102", "firm": "01.00A01",
             "size_total": "2000398934016", "temp": 31, "status": "normal", "smart_status": "normal", "diskType": "SATA", "exceed_bad_sector_thr": false,
             "container": {"order": 0, "str": "DS213+", "supportPwrBtnDisable": false, "type": "internal"}}
        ],
        "env": {},
        "hotSpareConf": {},
        "hotSpares": [],
        "iscsiLuns": [],
        "iscsiTargets": [],
        "ports": [],
        "storagePools": [
            {"id": "reuse_1", "status": "normal", "device_type": "shr_with_1_disk_protect", "raidType": "multiple", "desc": "SHR", "disks": ["sda", "sdb"], "pool_path": "reuse_1",
             "size": {"total": "1996417761280", "used": "1996417761280"}}
        ],
        "volumes": [
            {"id": "volume_1", "status": "normal", "fs_type": "ext4", "vol_path": "/volume1", "desc": "Located on Storage Pool 1, SHR", "pool_path": "reuse_1", "container": "internal",
             "size": {"free_inode": "121689412", "total": "1995435933696", "total_device": "1995435933696", "total_inode": "121798656", "used": "1684179374080"}},
            {"id": "volume_2", "status": "normal", "fs_type": "ext4", "vol_path": "/volume2", "vol_desc": "archive", "desc": "", "pool_path": "reuse_1", "container": "internal",
             "size": {"total": "981753856", "used": "0"}}
        ]
    })
}

fn assert_load_info_requests(nas: &Nas, count: usize) {
    assert_eq!(nas.requests().len(), count);
    for index in 0..count {
        assert_eq!(request_api(nas, index), STORAGE);
        assert_eq!(request_method(nas, index), "load_info");
        assert_eq!(request_version(nas, index), 1);
        assert_eq!(
            request_field(nas, index, "_sid").as_deref(),
            Some("fixture-sid")
        );
    }
}

// ── load_info ───────────────────────────────────────────────────────

#[tokio::test]
async fn storage_overview_decodes_dsm_7_string_sizes_without_hot_spares() {
    let (service, nas) = service_with(&[(STORAGE, 1)], vec![ok(real_storage_overview())]).await;

    let overview = service.get_storage_overview().await.unwrap();
    assert_eq!(overview.disks.len(), 2);
    let disk = &overview.disks[0];
    assert_eq!(disk.id, "sata1");
    assert_eq!(disk.name, "Drive 1");
    assert_eq!(disk.device, "/dev/sata1");
    assert_eq!(disk.size_total, 10_000_831_348_736);
    assert_eq!(disk.firmware.as_deref(), Some("SC60"));
    assert_eq!(disk.serial.as_deref(), Some("SYNTH0001"));
    assert_eq!(disk.temp, Some(35));
    assert_eq!(disk.smart_status.as_deref(), Some("normal"));
    assert_eq!(disk.disk_type.as_deref(), Some("SATA"));
    assert_eq!(disk.exceed_bad_sector_thr, Some(false));
    assert_eq!(
        disk.container.as_ref().unwrap().r#type.as_deref(),
        Some("internal")
    );
    assert_eq!(overview.disks[1].disk_type.as_deref(), Some("M.2 NVMe"));

    assert_eq!(overview.volumes.len(), 1);
    let volume = &overview.volumes[0];
    assert_eq!(volume.id, "volume_1");
    assert_eq!(volume.display_name.as_deref(), Some("volume1"));
    assert_eq!(volume.size_total, 28_788_160_495_616);
    assert_eq!(volume.size_used, 7_632_707_117_056);
    assert_eq!(volume.size_free, 21_155_453_378_560);
    assert_eq!(volume.usage_percent, Some(26.51));
    assert_eq!(volume.fs_type.as_deref(), Some("btrfs"));
    assert_eq!(volume.pool_path.as_deref(), Some("reuse_1"));
    assert_eq!(volume.container.as_deref(), Some("internal"));
    assert_eq!(
        serde_json::to_value(volume).unwrap(),
        json!({"id": "volume_1", "displayName": "volume1", "status": "normal", "fsType": "btrfs", "sizeTotal": 28788160495616u64, "sizeUsed": 7632707117056u64, "sizeFree": 21155453378560u64, "usagePercent": 26.51, "poolPath": "reuse_1", "desc": "", "container": "internal"})
    );

    let pool = &overview.storage_pools[0];
    assert_eq!(pool.raid_type.as_deref(), Some("raid_6"));
    assert_eq!(pool.size_total, Some(29_987_679_764_480));
    assert_eq!(pool.size_used, Some(29_987_679_764_480));
    assert_eq!(pool.disks, ["sata1"]);

    let cache = &overview.ssd_caches[0];
    assert_eq!(cache.id, "alloc_cache_1_1");
    assert_eq!(cache.size, 107_374_182_400);
    assert_eq!(cache.read_hit, Some(37.0));
    assert_eq!(cache.disks, ["nvme0n1"]);
    assert!(overview.hot_spares.is_empty());

    let ipc = serde_json::to_value(&overview).unwrap();
    assert_eq!(ipc["hotSpares"], json!([]));
    assert_eq!(ipc["disks"][0]["firmware"], "SC60");
    assert_eq!(ipc["disks"][0]["sizeTotal"], 10_000_831_348_736u64);
    assert_load_info_requests(&nas, 1);
}

#[tokio::test]
async fn storage_overview_decodes_dsm_6_without_ssd_caches() {
    let (service, nas) = service_with(&[(STORAGE, 1)], vec![ok(dsm6_ds213_storage())]).await;

    let overview = service.get_storage_overview().await.unwrap();
    assert!(overview.ssd_caches.is_empty());
    assert!(overview.hot_spares.is_empty());
    assert_eq!(overview.disks.len(), 2);
    assert_eq!(overview.disks[1].size_total, 2_000_398_934_016);
    assert_eq!(overview.disks[1].firmware.as_deref(), Some("01.00A01"));
    let [first, second] = &overview.volumes[..] else {
        panic!("two volumes expected");
    };
    // No `vol_desc`: the mount path names the volume; `desc` stays DSM's text.
    assert_eq!(first.display_name.as_deref(), Some("volume1"));
    assert_eq!(
        first.desc.as_deref(),
        Some("Located on Storage Pool 1, SHR")
    );
    assert_eq!(first.size_free, 311_256_559_616);
    assert_eq!(first.usage_percent, Some(84.4));
    // A non-empty `vol_desc` wins over the path.
    assert_eq!(second.display_name.as_deref(), Some("archive"));
    assert_eq!(second.size_used, 0);
    assert_eq!(second.usage_percent, Some(0.0));
    let pool = &overview.storage_pools[0];
    assert_eq!(pool.raid_type.as_deref(), Some("shr_with_1_disk_protect"));
    assert_eq!(pool.desc.as_deref(), Some("SHR"));
    assert_load_info_requests(&nas, 1);
}

#[tokio::test]
async fn storage_overview_regression_numeric_sizes_and_optional_collections() {
    let numeric = json!({
        "disks": [{"id": "sata1", "name": "Drive 1", "device": "/dev/sata1", "model": "FIXTURE-HDD-4T", "size_total": 4000787030016u64, "status": "normal"}],
        "volumes": [{"id": "volume_1", "status": "normal", "display_name": "Data", "vol_desc": "ignored", "vol_path": "/volume1", "size": {"total": 1000000000000u64, "used": 250000000000u64}}],
        "storagePools": [{"id": "reuse_1", "status": "normal", "raidType": "raid_5", "disks": ["sata1"], "size": {"total": 1000000000000u64}}],
        "ssdCaches": [{"id": "cache_1", "status": "normal", "size": {"total": 512110190592u64}, "hit_rate": "12.5", "disks": ["nvme0n1"]}],
        "hotSpares": [{"disk_id": "sata4", "pool_id": "reuse_1"}, {"id": "sata5"}]
    });
    let minimal = json!({
        "disks": [],
        "volumes": [{"id": "volume_9", "status": "crashed", "size": {"total": "0", "used": "0"}}],
        "storagePools": [{"id": "reuse_9", "status": "normal", "disks": []}],
        "ssdCaches": [{"id": "cache_9", "status": "normal", "size": {"total": "1"}, "hit_rate": {"Current": {}}, "disks": []}]
    });
    let (service, nas) = service_with(
        &[(STORAGE, 1)],
        vec![
            ok(numeric),
            ok(minimal),
            ok(json!({"disks": [], "volumes": []})),
        ],
    )
    .await;

    let overview = service.get_storage_overview().await.unwrap();
    assert_eq!(overview.disks[0].size_total, 4_000_787_030_016);
    assert_eq!(overview.disks[0].firmware, None);
    assert!(overview.disks[0].container.is_none());
    let volume = &overview.volumes[0];
    assert_eq!(volume.display_name.as_deref(), Some("Data"));
    assert_eq!(
        (volume.size_total, volume.size_used, volume.size_free),
        (1_000_000_000_000, 250_000_000_000, 750_000_000_000)
    );
    assert_eq!(volume.usage_percent, Some(25.0));
    let pool = &overview.storage_pools[0];
    // Without `device_type`, DSM's `raidType` is kept.
    assert_eq!(pool.raid_type.as_deref(), Some("raid_5"));
    assert_eq!(
        (pool.size_total, pool.size_used),
        (Some(1_000_000_000_000), None)
    );
    assert_eq!(overview.ssd_caches[0].size, 512_110_190_592);
    assert_eq!(overview.ssd_caches[0].read_hit, Some(12.5));
    assert_eq!(overview.hot_spares.len(), 2);
    assert_eq!(overview.hot_spares[0].disk_id, "sata4");
    assert_eq!(overview.hot_spares[0].pool_id.as_deref(), Some("reuse_1"));
    assert_eq!(overview.hot_spares[1].disk_id, "sata5");
    assert_eq!(overview.hot_spares[1].pool_id, None);

    let minimal = service.get_storage_overview().await.unwrap();
    let volume = &minimal.volumes[0];
    assert_eq!(volume.display_name, None);
    assert_eq!(volume.usage_percent, None);
    assert_eq!(volume.size_free, 0);
    assert_eq!(minimal.storage_pools[0].raid_type, None);
    assert_eq!(minimal.storage_pools[0].size_total, None);
    assert_eq!(minimal.ssd_caches[0].read_hit, None);

    let empty = service.get_storage_overview().await.unwrap();
    assert!(empty.disks.is_empty() && empty.volumes.is_empty());
    assert!(empty.storage_pools.is_empty() && empty.ssd_caches.is_empty());
    assert_load_info_requests(&nas, 3);
}

#[tokio::test]
async fn storage_overview_rejects_missing_tables_and_incomplete_rows() {
    let mut no_size = real_storage_overview();
    no_size["volumes"][0]
        .as_object_mut()
        .unwrap()
        .remove("size");
    let mut no_total = real_storage_overview();
    no_total["volumes"][0]["size"]
        .as_object_mut()
        .unwrap()
        .remove("total");
    let mut no_used = real_storage_overview();
    no_used["volumes"][0]["size"]
        .as_object_mut()
        .unwrap()
        .remove("used");
    let mut bad_disk_size = real_storage_overview();
    bad_disk_size["disks"][0]["size_total"] = json!("unknown");
    let mut nameless_spare = real_storage_overview();
    nameless_spare["hotSpares"] = json!([{"pool_id": "reuse_1"}]);
    let mut cache_without_size = real_storage_overview();
    cache_without_size["ssdCaches"][0]
        .as_object_mut()
        .unwrap()
        .remove("size");
    let failures = vec![
        ok(json!({"volumes": []})),
        ok(json!({"disks": []})),
        ok(json!({})),
        json!({"success": true}),
        ok(no_size),
        ok(no_total),
        ok(no_used),
        ok(bad_disk_size),
        ok(nameless_spare),
        ok(cache_without_size),
    ];
    let count = failures.len();
    let (service, nas) = service_with(&[(STORAGE, 1)], failures).await;

    for case in 0..count {
        let error = service.get_storage_overview().await.unwrap_err();
        assert_schema_failure(&error);
        assert!(
            matches!(error.kind, SynologyErrorKind::ParseError),
            "case {case}: {error}"
        );
    }
    assert_load_info_requests(&nas, count);
}

#[tokio::test]
async fn disk_and_volume_lists_reuse_one_load_info_call() {
    let (service, nas) = service_with(
        &[(STORAGE, 1)],
        vec![ok(real_disks()), ok(real_volumes()), dsm_error(105)],
    )
    .await;

    let disks = service.list_disks().await.unwrap();
    assert_eq!(disks.len(), 2);
    assert_eq!(disks[0].size_total, 10_000_831_348_736);
    assert_eq!(nas.requests().len(), 1);
    let volumes = service.list_volumes().await.unwrap();
    assert_eq!(volumes[0].display_name.as_deref(), Some("volume1"));
    assert_eq!(nas.requests().len(), 2);

    let denied = service.get_storage_overview().await.unwrap_err();
    assert!(
        matches!(denied.kind, SynologyErrorKind::PermissionDenied),
        "{denied}"
    );
    assert_dsm_failure(&denied, 105);
    assert_load_info_requests(&nas, 3);
}

// ── SMART ───────────────────────────────────────────────────────────

#[tokio::test]
async fn smart_retries_an_unknown_get_method_with_get_health_info() {
    let (service, nas) = service_with(
        &[(SMART, 1)],
        vec![dsm_error(103), ok(real_selected_disk_smart())],
    )
    .await;

    let smart = service.get_smart_info("sata1").await.unwrap();
    // DSM did not echo an id: the requested disk is kept.
    assert_eq!(smart.disk_id, "sata1");
    assert_eq!(smart.disk_name.as_deref(), Some("Drive 1"));
    assert_eq!(smart.health_status.as_deref(), Some("normal"));
    assert_eq!(smart.temperature, Some(35));
    assert_eq!(smart.power_on_hours, Some(12_345));
    assert_eq!(smart.reallocated_sectors, Some(0));
    let attributes = smart.attributes.as_ref().unwrap();
    assert_eq!(attributes.len(), 2);
    assert_eq!(attributes[0].id, 5);
    assert_eq!(attributes[0].current, 100);
    assert_eq!(attributes[0].threshold, 10);
    assert_eq!(attributes[0].raw, "0");
    assert_eq!(attributes[1].raw, "12345");
    assert_eq!(attributes[1].status, "OK");
    assert_eq!(
        serde_json::to_value(&smart).unwrap()["healthStatus"],
        "normal"
    );

    assert_eq!(nas.requests().len(), 2);
    for (index, method) in ["get", "get_health_info"].into_iter().enumerate() {
        assert_eq!(request_api(&nas, index), SMART);
        assert_eq!(request_method(&nas, index), method);
        assert_eq!(request_version(&nas, index), 1);
        // JSON-format API: the disk id is a JSON string.
        assert_eq!(
            request_field(&nas, index, "disk").as_deref(),
            Some("\"sata1\"")
        );
    }
}

#[tokio::test]
async fn smart_decodes_lenient_replies_and_never_invents_health() {
    let (service, nas) = service_with_format(
        &[(SMART, 1, None)],
        vec![
            // shape: synthetic; DSM shape unverified (S§7 #3)
            ok(json!({"disk_id": "sata2", "name": "Drive 2", "longName": "Drive 2 long", "smart_status": "normal", "overview_status": "warning", "temperature": 40})),
            // shape: synthetic; DSM shape unverified (S§7 #3)
            ok(json!({"id": 3, "overview_status": "abnormal", "health_status": ""})),
            // shape: synthetic; DSM shape unverified (S§7 #3)
            ok(json!({"attributes": []})),
            ok(json!({})),
            ok(json!({"name": "Drive 1", "temp": 35})),
            ok(json!({"health": "normal", "attributes": [{"id": 5, "name": "x"}]})),
        ],
    )
    .await;

    let both = service.get_smart_info("sata2").await.unwrap();
    assert_eq!(both.disk_id, "sata2");
    assert_eq!(both.disk_name.as_deref(), Some("Drive 2"));
    // `smart_status` and `overview_status` together are not a duplicate field.
    assert_eq!(both.health_status.as_deref(), Some("normal"));
    assert_eq!(both.temperature, Some(40));
    assert!(both.attributes.is_none());

    let numeric_id = service.get_smart_info("sata3").await.unwrap();
    assert_eq!(numeric_id.disk_id, "3");
    assert_eq!(numeric_id.health_status.as_deref(), Some("abnormal"));

    let attributes_only = service.get_smart_info("sata4").await.unwrap();
    assert_eq!(attributes_only.health_status, None);
    assert_eq!(
        attributes_only.attributes.as_deref().map(<[_]>::len),
        Some(0)
    );
    assert_eq!(
        serde_json::to_value(&attributes_only).unwrap(),
        json!({"diskId": "sata4", "diskName": null, "healthStatus": null, "temperature": null, "powerOnHours": null, "reallocatedSectors": null, "attributes": []})
    );

    // No health field and no attributes; an incomplete attribute row.
    for _ in 0..3 {
        assert_schema_failure(&service.get_smart_info("sata1").await.unwrap_err());
    }

    // Successful `get` answers never retry; a plain-format API gets the raw id.
    assert_eq!(nas.requests().len(), 6);
    for index in 0..6 {
        assert_eq!(request_method(&nas, index), "get");
    }
    assert_eq!(request_field(&nas, 0, "disk").as_deref(), Some("sata2"));
}

#[tokio::test]
async fn smart_keeps_refusals_and_retries_only_once() {
    let (service, nas) = service_with(
        &[(SMART, 1)],
        vec![
            dsm_error(105),
            dsm_error(103),
            dsm_error(103),
            dsm_error(114),
        ],
    )
    .await;

    let denied = service.get_smart_info("sata1").await.unwrap_err();
    assert!(
        matches!(denied.kind, SynologyErrorKind::PermissionDenied),
        "{denied}"
    );
    assert_dsm_failure(&denied, 105);
    assert_eq!(nas.requests().len(), 1);

    let unsupported = service.get_smart_info("sata1").await.unwrap_err();
    assert!(
        matches!(unsupported.kind, SynologyErrorKind::ApiError(103)),
        "{unsupported}"
    );
    assert_dsm_failure(&unsupported, 103);
    assert_eq!(nas.requests().len(), 3);
    assert_eq!(request_method(&nas, 1), "get");
    assert_eq!(request_method(&nas, 2), "get_health_info");

    let other = service.get_smart_info("sata1").await.unwrap_err();
    assert!(
        matches!(other.kind, SynologyErrorKind::ApiError(114)),
        "{other}"
    );
    assert_eq!(nas.requests().len(), 4);
    assert_eq!(request_method(&nas, 3), "get");
}
