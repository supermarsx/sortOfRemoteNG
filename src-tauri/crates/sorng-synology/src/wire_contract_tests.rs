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
    let storage: StorageOverview = serde_json::from_value(
        json!({"disks":[],"volumes":[],"storage_pools":[],"ssd_caches":[],"hot_spares":[]}),
    )
    .unwrap();
    assert!(storage.storage_pools.is_empty());
    assert!(serde_json::from_value::<DsmInfo>(json!({"model":"not-complete"})).is_err());
    assert!(serde_json::from_value::<StorageOverview>(json!({"disks":[],"volumes":[]})).is_err());
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
