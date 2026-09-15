use super::{connect, login_responses, ok, Nas};
use crate::{service::SynologyService, types::*};
use serde_json::json;

#[test]
fn actual_snake_case_system_and_utilization_fields_serialize_to_renderer_camel_case() {
    let file_station: FileStationInfo = serde_json::from_value(json!({"hostname":"fixture", "is_manager":false, "support_sharing":true, "support_virtual_protocol":["cifs","nfs","iso"]})).unwrap();
    assert_eq!(
        file_station.support_virtual_protocol.unwrap(),
        ["cifs", "nfs", "iso"]
    );
    let info:DsmInfo=serde_json::from_value(json!({"model":"fixture","ram":4096,"serial":"synthetic","temperature":40,"uptime":123,"version":"7","version_string":"7.2","cpu_clock_speed":2200,"sys_temp":40})).unwrap();
    let value = serde_json::to_value(info).unwrap();
    assert_eq!(value["versionString"], "7.2");
    assert_eq!(value["cpuClockSpeed"], 2200);
    let usage:SystemUtilization=serde_json::from_value(json!({"cpu":{"user_load":7.5,"system_load":2.0,"15min_load":0.5},"memory":{"total_real":100,"avail_real":75,"total_swap":20,"avail_swap":20},"network":[],"disk":[]})).unwrap();
    assert_eq!(usage.cpu.user_load, 7.5);
    assert_eq!(usage.memory.avail_real, 75);
    // DSM groups the disk rows with a total (addendum S§4 #2).
    let grouped:SystemUtilization=serde_json::from_value(json!({"cpu":{"user_load":4,"system_load":2,"15min_load":51},"memory":{"total_real":3867268,"avail_real":156188,"total_swap":4415404,"avail_swap":4146316},"network":[{"device":"total","rx":109549,"tx":45097}],"disk":{"disk":[{"device":"sata1","display_name":"Drive 1","read_access":3,"read_byte":55261,"type":"internal","utilization":12,"write_access":15,"write_byte":419425}],"total":{"device":"total","read_access":3,"read_byte":55261,"utilization":12,"write_access":15,"write_byte":419425}}})).unwrap();
    assert_eq!(grouped.disk.len(), 1);
    assert_eq!(grouped.disk[0].display_name.as_deref(), Some("Drive 1"));
    assert!(serde_json::from_value::<DsmInfo>(json!({"model":"not-complete"})).is_err());
}
/// Storage decodes DSM's `load_info` wire in the manager, so it is pinned
/// through the transport rather than through the IPC DTO.
#[tokio::test]
async fn storage_overview_decodes_dsm_load_info_and_rejects_a_missing_disk_table() {
    use wire_shapes_tests::{assert_schema_failure, service_with};
    const STORAGE: &str = "SYNO.Storage.CGI.Storage";
    // shape: vcf-content-factory api-maps/synology-storage.md load_info [observed DSM 7.3.2] (MIT), trimmed
    let dsm_7_3_2 = json!({"disks":[{"id":"sata1","name":"Drive 1","longName":"Drive 1","device":"/dev/sata1","model":"FIXTURE-HDD-10T","vendor":"Seagate","serial":"SYNTH0001","firm":"SC60","size_total":"10000831348736","temp":35,"status":"normal","smart_status":"normal","diskType":"SATA","container":{"order":0,"str":"DS1520+","type":"internal"}}],"ssdCaches":[],"storagePools":[{"id":"reuse_1","status":"normal","device_type":"raid_6","raidType":"multiple","desc":"","disks":["sata1"],"size":{"total":"29987679764480","used":"29987679764480"}}],"volumes":[{"id":"volume_1","status":"normal","fs_type":"btrfs","vol_path":"/volume1","vol_desc":"","pool_path":"reuse_1","size":{"total":"28788160495616","used":"7632707117056"}}]});
    let (service, nas) = service_with(
        &[(STORAGE, 1)],
        vec![ok(dsm_7_3_2), ok(json!({"volumes":[]}))],
    )
    .await;
    let storage = service.get_storage_overview().await.unwrap();
    assert_eq!(storage.disks[0].size_total, 10000831348736);
    assert_eq!(storage.volumes[0].size_free, 21155453378560);
    assert_eq!(storage.volumes[0].display_name.as_deref(), Some("volume1"));
    assert!(storage.hot_spares.is_empty());
    assert_schema_failure(&service.get_storage_overview().await.unwrap_err());
    assert_eq!(nas.requests().len(), 2);
}
#[tokio::test]
async fn sharing_creation_uses_documented_string_parameters_and_detects_item_failure() {
    for error in [0, 400] {
        let mut responses = login_responses(true);
        responses.push(ok(json!({"links":[{"id":"link-1","url":"https://fixture.invalid/sharing/token","error":error}]})));
        let nas = Nas::start(responses).await;
        let mut service = SynologyService::new();
        let receipt = connect(&mut service, &nas).await;
        let result = service
            .fs_create_share_link(
                &receipt,
                "/share/file",
                Some("synthetic"),
                Some("2026-12-31"),
            )
            .await;
        if error == 0 {
            assert_eq!(result.unwrap().id, "link-1");
        } else {
            assert!(result.is_err());
        }
        let request = nas.requests().pop().unwrap();
        assert_eq!(request.fields["path"], "\"/share/file\"");
        assert_eq!(request.fields["date_expired"], "\"2026-12-31\"");
        assert!(!request.target.contains("synthetic"));
        let count = nas.requests().len();
        assert!(service
            .fs_create_share_link(&receipt, "/share/file", Some("abcdefghijklmnopq"), None)
            .await
            .is_err());
        assert!(service
            .fs_create_share_link(&receipt, "/share/file", None, Some("2026-02-31"))
            .await
            .is_err());
        assert_eq!(nas.requests().len(), count);
    }
}
#[tokio::test]
async fn sharing_list_is_paginated_and_revoke_accepts_only_confirmed_empty_response() {
    let mut responses = login_responses(true);
    responses.push(ok(json!({"links":[{"id":"link-1","url":"https://fixture.invalid/share/token","path":"/share/file","has_password":true,"date_expired":"2026-12-31"}],"offset":0,"total":1})));
    responses.push(ok(json!([{"id":"link-1","error":400}])));
    responses.push(ok(json!({})));
    let nas = Nas::start(responses).await;
    let mut service = SynologyService::new();
    let receipt = connect(&mut service, &nas).await;
    let links = service.fs_list_share_links(&receipt, 0, 50).await.unwrap();
    assert_eq!(links.total, 1);
    assert_eq!(links.links[0].has_password, Some(true));
    assert!(service
        .fs_delete_share_links(&receipt, &["link-1".into()])
        .await
        .is_err());
    service
        .fs_delete_share_links(&receipt, &["link-1".into()])
        .await
        .unwrap();
    assert_eq!(nas.requests().last().unwrap().fields["id"], "\"link-1\"");
}
#[tokio::test]
async fn download_station_nested_transfer_and_per_task_results_are_checked() {
    let mut responses = login_responses(false);
    responses.push(ok(json!({"tasks":[{"id":"download-1","title":"Fixture","status":"downloading","size":100,"type":"http","username":"fixture","additional":{"transfer":{"size_downloaded":25,"speed_download":10},"detail":{"destination":"share","create_time":0}}}],"total":1,"offset":0})));
    responses.push(ok(json!([{"id":"download-1","error":403}])));
    responses.push(ok(json!([{"id":"other","error":0}])));
    responses.push(ok(json!([{"id":"download-1","error":0}])));
    let nas = Nas::start(responses).await;
    let mut service = SynologyService::new();
    connect(&mut service, &nas).await;
    let tasks = service.list_download_tasks().await.unwrap();
    assert_eq!(tasks[0].size_downloaded, 25);
    assert_eq!(tasks[0].percent_dn, Some(25.0));
    assert_eq!(tasks[0].destination.as_deref(), Some("share"));
    assert!(service.pause_download("download-1").await.is_err());
    assert!(service.resume_download("download-1").await.is_err());
    service.delete_download("download-1", false).await.unwrap();
    assert_eq!(
        nas.requests().last().unwrap().fields["force_complete"],
        "false"
    );
}

#[tokio::test]
async fn iscsi_vendor_wrappers_and_typed_identifiers_map_without_fabricated_data() {
    let mut responses = login_responses(false);
    responses.push(ok(json!({"luns":[{"uuid":"lun-a","name":"Fixture","size":1024,"status":"normal","allocated_size":512,"location":"/volume1","type":2}]})));
    responses.push(ok(json!({"targets":[{"target_id":7,"name":"Fixture","iqn":"iqn.fixture","status":"ready","max_sessions":2,"mapped_luns":[{"lun_uuid":"lun-a","mapping_index":0}]}]})));
    responses.push(ok(json!({"unrecognized":[]})));
    let nas = Nas::start(responses).await;
    let mut service = SynologyService::new();
    connect(&mut service, &nas).await;
    let luns = service.list_iscsi_luns().await.unwrap();
    assert_eq!(luns[0].lun_id, "lun-a");
    assert_eq!(luns[0].used_size, Some(512));
    assert!(luns[0].mapped_targets.is_none());
    let targets = service.list_iscsi_targets().await.unwrap();
    assert_eq!(targets[0].target_id, "7");
    assert_eq!(targets[0].mapped_luns, ["lun-a"]);
    assert!(service.list_iscsi_luns().await.is_err());
}

#[path = "wire_shapes_tests/mod.rs"]
mod wire_shapes_tests;
