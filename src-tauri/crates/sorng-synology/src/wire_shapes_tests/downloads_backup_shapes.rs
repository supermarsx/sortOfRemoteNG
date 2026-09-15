//! Owned by t84-e12i: Download Station tasks, Hyper Backup tasks and Active
//! Backup for Business devices, decoded from the shapes DSM sends.

use super::*;

const DS_TASK: &str = "SYNO.DownloadStation.Task";
const BACKUP_TASK: &str = "SYNO.Backup.Task";
const ABB_DEVICE: &str = "SYNO.ActiveBackup.Device";
const ABB_OVERVIEW: &str = "SYNO.ActiveBackup.Overview";

// ── Fixtures ────────────────────────────────────────────────────────

/// `downloadTasks` read (the guide's string numbers).
// shape: Synology Download Station Web API guide, SYNO.DownloadStation.Task list (field table only)
pub(super) fn real_download_tasks() -> Value {
    json!({
        "total": 1,
        "offset": 0,
        "tasks": [{
            "id": "dbid_001",
            "type": "http",
            "username": "fixture-user",
            "title": "fixture.iso",
            "size": "9427312332",
            "status": "downloading",
            "status_extra": null,
            "additional": {
                "detail": {"create_time": "1341210005", "destination": "downloads", "uri": "https://fixture.invalid/fixture.iso"},
                "transfer": {"size_downloaded": "4713656166", "size_uploaded": "0", "speed_download": "102400", "speed_upload": "0"}
            }
        }]
    })
}

/// `backupTasks` read.
// shape: lestoilfante/zabbix-integrations Hyper Backup template data.task_list[] (GPL-3.0, field names only) + pmilano1/synology-dsm-api hyper-backup/tasks.md (MIT)
pub(super) fn real_backup_tasks() -> Value {
    json!({
        "task_list": [{
            "task_id": 1,
            "name": "fixture-nightly",
            "repo_id": 1,
            "data_type": "data",
            "target_type": "cloud",
            "state": "backupable",
            "status": "none",
            "is_modified": false,
            "last_bkp_time": "2026/09/14 02:00:00",
            "last_bkp_end_time": "2026/09/14 02:12:30",
            "last_bkp_result": "done",
            "next_bkp_time": "2026/09/15 02:00"
        }],
        "is_restoring": false
    })
}

/// `activeBackupDevices` read.
// shape: pmilano1/synology-dsm-api docs/api-reference/activebackup/core/device.md, SYNO.ActiveBackup.Device list (MIT)
pub(super) fn real_active_backup_devices() -> Value {
    json!({
        "devices": [{
            "device_id": 1,
            "host_name": "fixture-pc-01",
            "host_ip": "192.0.2.20",
            "os_name": "Windows 11(64-bit)",
            "backup_type": 2,
            "login_time": 1757851200,
            "create_time": 1757851100,
            "task_count": 1,
            "agentless_auth_policy": 0
        }],
        "total": 1
    })
}

fn first_row(fixture: Value, key: &str) -> Value {
    fixture[key][0].clone()
}

fn without(mut row: Value, key: &str) -> Value {
    row.as_object_mut().unwrap().remove(key);
    row
}

/// Download Station tasks live on the plain-form `DownloadStation/task.cgi`.
async fn download_station(responses: Vec<Value>) -> (SynologyService, Nas) {
    let (mut service, nas) = service_with_format(&[(DS_TASK, 3, None)], responses).await;
    service
        .client
        .as_mut()
        .unwrap()
        .api_info
        .get_mut(DS_TASK)
        .unwrap()
        .path = "DownloadStation/task.cgi".into();
    (service, nas)
}

// ── Download Station ────────────────────────────────────────────────

#[tokio::test]
async fn download_tasks_decode_guide_strings_and_device_numbers() {
    // shape: py-synologydsm-api tests/api_data/dsm_6/download_station/const_6_download_station_task.py (MIT)
    let device_numbers = json!({
        "offset": 0,
        "total": 1,
        "tasks": [{
            "id": "dbid_2",
            "type": "bt",
            "username": "fixture-user",
            "title": "fixture-release",
            "size": 1_000,
            "status": "finished",
            "status_extra": {"error_detail": ""},
            "additional": {
                "detail": {"create_time": 1_550_089_068, "destination": "downloads/bt", "uri": "fixture.torrent"},
                "transfer": {"size_downloaded": 1_000, "size_uploaded": 250, "speed_download": 0, "speed_upload": 12}
            }
        }]
    });
    let (service, nas) =
        download_station(vec![ok(real_download_tasks()), ok(device_numbers)]).await;

    let tasks = service.list_download_tasks().await.unwrap();
    assert_eq!(tasks.len(), 1);
    let task = &tasks[0];
    assert_eq!(task.id, "dbid_001");
    assert_eq!(task.title, "fixture.iso");
    assert_eq!(task.status, "downloading");
    assert_eq!(task.r#type, "http");
    assert_eq!(task.username.as_deref(), Some("fixture-user"));
    assert_eq!(task.size, 9_427_312_332);
    assert_eq!(task.size_downloaded, 4_713_656_166);
    assert_eq!(task.size_uploaded, Some(0));
    assert_eq!(task.speed_download, Some(102_400));
    assert_eq!(task.speed_upload, Some(0));
    assert_eq!(task.percent_dn, Some(50.0));
    assert_eq!(task.destination.as_deref(), Some("downloads"));
    assert_eq!(
        task.uri.as_deref(),
        Some("https://fixture.invalid/fixture.iso")
    );
    assert_eq!(
        task.created_time.as_deref(),
        Some("2012-07-02T06:20:05+00:00")
    );
    let ipc = serde_json::to_value(task).unwrap();
    assert_eq!(ipc["sizeDownloaded"], 4_713_656_166_u64);
    assert_eq!(ipc["percentDn"], 50.0);
    assert_eq!(ipc["createdTime"], "2012-07-02T06:20:05+00:00");

    let numeric = service.list_download_tasks().await.unwrap();
    assert_eq!(numeric[0].size, 1_000);
    assert_eq!(numeric[0].size_downloaded, 1_000);
    assert_eq!(numeric[0].size_uploaded, Some(250));
    assert_eq!(numeric[0].speed_upload, Some(12));
    assert_eq!(numeric[0].percent_dn, Some(100.0));
    assert_eq!(
        numeric[0].created_time.as_deref(),
        Some("2019-02-13T20:17:48+00:00")
    );

    assert_eq!(nas.requests().len(), 2);
    for index in 0..2 {
        assert_eq!(request_api(&nas, index), DS_TASK);
        assert_eq!(request_method(&nas, index), "list");
        assert_eq!(request_version(&nas, index), 3);
        assert_eq!(
            request_field(&nas, index, "additional").as_deref(),
            Some("detail,transfer,file")
        );
        assert_eq!(request_field(&nas, index, "offset").as_deref(), Some("0"));
        assert_eq!(request_field(&nas, index, "limit").as_deref(), Some("500"));
        assert_eq!(
            nas.requests()[index].target.split('?').next(),
            Some("/webapi/DownloadStation/task.cgi")
        );
    }
}

#[tokio::test]
async fn download_tasks_without_transfer_report_no_progress_and_bad_shapes_fail() {
    let task = first_row(real_download_tasks(), "tasks");
    let mut no_transfer = task.clone();
    no_transfer["additional"] = json!({"detail": {"destination": "downloads"}});
    let no_additional = without(task.clone(), "additional");
    let mut empty_speeds = task.clone();
    empty_speeds["additional"]["transfer"] =
        json!({"size_downloaded": 10, "speed_download": "", "speed_upload": null});
    let mut unreadable_size = task.clone();
    unreadable_size["size"] = json!("about 9 GB");
    let mut transfer_without_count = task.clone();
    transfer_without_count["additional"]["transfer"] = json!({"speed_download": 1});
    let (service, nas) = download_station(vec![
        ok(json!({"tasks": [no_transfer, no_additional, empty_speeds]})),
        // Regression: a bare task array still decodes.
        ok(json!([task])),
        ok(json!({"total": 0, "offset": 0})),
        ok(json!({"tasks": [unreadable_size]})),
        ok(json!({"tasks": [transfer_without_count]})),
    ])
    .await;

    let tasks = service.list_download_tasks().await.unwrap();
    for task in &tasks[..2] {
        assert_eq!(task.size, 9_427_312_332);
        assert_eq!(task.size_downloaded, 0);
        assert_eq!(task.percent_dn, None);
        assert_eq!(task.size_uploaded, None);
        assert_eq!(task.speed_download, None);
        assert_eq!(task.speed_upload, None);
    }
    assert_eq!(tasks[0].destination.as_deref(), Some("downloads"));
    assert_eq!(tasks[0].created_time, None);
    assert_eq!(tasks[1].destination, None);
    assert!(serde_json::to_value(&tasks[0]).unwrap()["percentDn"].is_null());
    assert_eq!(tasks[2].size_downloaded, 10);
    assert_eq!(tasks[2].speed_download, None);
    assert_eq!(tasks[2].speed_upload, None);

    let bare = service.list_download_tasks().await.unwrap();
    assert_eq!(bare[0].id, "dbid_001");
    for _ in 0..3 {
        assert_schema_failure(&service.list_download_tasks().await.unwrap_err());
    }
    assert_eq!(nas.requests().len(), 5);
}

// ── Hyper Backup ────────────────────────────────────────────────────

#[tokio::test]
async fn backup_tasks_decode_task_list_status_and_backup_times() {
    let task = first_row(real_backup_tasks(), "task_list");
    let state_only = {
        let mut row = without(without(task.clone(), "status"), "last_bkp_end_time");
        row["task_id"] = json!(2);
        row
    };
    let result_only = {
        let mut row = without(
            without(without(task.clone(), "status"), "state"),
            "last_bkp_end_time",
        );
        row["last_bkp_time"] = json!(1_757_815_200);
        row["next_bkp_time"] = Value::Null;
        row
    };
    let identity_only = json!({"task_id": 4, "name": "fixture-new"});
    let (service, nas) = service_with(
        &[(BACKUP_TASK, 1)],
        vec![
            ok(real_backup_tasks()),
            ok(json!({"task_list": [state_only, result_only, identity_only], "is_restoring": false})),
            // Regression: a bare task array still decodes.
            ok(json!([task.clone()])),
            ok(json!({"is_restoring": false})),
            ok(json!({"task_list": [without(task, "task_id")]})),
        ],
    )
    .await;

    let tasks = service.list_backup_tasks().await.unwrap();
    assert_eq!(tasks.len(), 1);
    let nightly = &tasks[0];
    assert_eq!(nightly.task_id, 1);
    assert_eq!(nightly.name, "fixture-nightly");
    assert_eq!(nightly.status.as_deref(), Some("none"));
    assert_eq!(
        nightly.last_backup_time.as_deref(),
        Some("2026/09/14 02:12:30")
    );
    assert_eq!(
        nightly.next_backup_time.as_deref(),
        Some("2026/09/15 02:00")
    );
    assert_eq!(nightly.dest_type.as_deref(), Some("cloud"));
    assert_eq!(
        serde_json::to_value(nightly).unwrap(),
        json!({
            "taskId": 1,
            "name": "fixture-nightly",
            "status": "none",
            "lastBackupTime": "2026/09/14 02:12:30",
            "nextBackupTime": "2026/09/15 02:00",
            "destType": "cloud",
            "destPath": null,
            "totalSize": null,
            "transferredSize": null,
            "progress": null
        })
    );

    let partial = service.list_backup_tasks().await.unwrap();
    assert_eq!(partial[0].status.as_deref(), Some("backupable"));
    assert_eq!(
        partial[0].last_backup_time.as_deref(),
        Some("2026/09/14 02:00:00")
    );
    // A numeric time is kept as its text; a null next time is unknown.
    assert_eq!(partial[1].status.as_deref(), Some("done"));
    assert_eq!(partial[1].last_backup_time.as_deref(), Some("1757815200"));
    assert_eq!(partial[1].next_backup_time, None);
    assert_eq!(partial[2].task_id, 4);
    assert_eq!(partial[2].status, None);
    assert_eq!(partial[2].last_backup_time, None);
    assert_eq!(partial[2].next_backup_time, None);
    assert_eq!(partial[2].dest_type, None);

    let bare = service.list_backup_tasks().await.unwrap();
    assert_eq!(bare[0].name, "fixture-nightly");
    assert_schema_failure(&service.list_backup_tasks().await.unwrap_err());
    assert_schema_failure(&service.list_backup_tasks().await.unwrap_err());

    assert_eq!(nas.requests().len(), 5);
    for index in 0..5 {
        assert_eq!(request_api(&nas, index), BACKUP_TASK);
        assert_eq!(request_method(&nas, index), "list");
        assert_eq!(request_version(&nas, index), 1);
        assert_eq!(
            request_field(&nas, index, "additional").as_deref(),
            Some(r#"["last_bkp_time","next_bkp_time","last_bkp_result","is_modified"]"#)
        );
    }
}

// ── Active Backup for Business ──────────────────────────────────────

#[tokio::test]
async fn active_backup_devices_come_from_the_device_list() {
    let (service, nas) = service_with(
        &[(ABB_OVERVIEW, 1), (ABB_DEVICE, 1)],
        vec![
            ok(real_active_backup_devices()),
            // Regression: a bare device array still decodes.
            ok(json!([first_row(real_active_backup_devices(), "devices")])),
            ok(json!({"total": 0})),
            ok(json!({"devices": [without(first_row(real_active_backup_devices(), "devices"), "host_name")]})),
            dsm_error(105),
        ],
    )
    .await;

    let devices = service.list_active_backup_devices().await.unwrap();
    assert_eq!(devices.len(), 1);
    let device = &devices[0];
    assert_eq!(device.device_id, 1);
    assert_eq!(device.device_name, "fixture-pc-01");
    assert_eq!(device.ip_address.as_deref(), Some("192.0.2.20"));
    assert_eq!(device.os_name.as_deref(), Some("Windows 11(64-bit)"));
    assert_eq!(device.device_type.as_deref(), Some("2"));
    assert_eq!(device.status, None);
    assert_eq!(device.last_backup, None);
    assert_eq!(device.agent_version, None);
    assert_eq!(
        serde_json::to_value(device).unwrap(),
        json!({
            "deviceId": 1,
            "deviceName": "fixture-pc-01",
            "deviceType": "2",
            "status": null,
            "lastBackup": null,
            "agentVersion": null,
            "ipAddress": "192.0.2.20",
            "osName": "Windows 11(64-bit)"
        })
    );

    let bare = service.list_active_backup_devices().await.unwrap();
    assert_eq!(bare[0].device_name, "fixture-pc-01");
    assert_schema_failure(&service.list_active_backup_devices().await.unwrap_err());
    assert_schema_failure(&service.list_active_backup_devices().await.unwrap_err());

    let denied = service.list_active_backup_devices().await.unwrap_err();
    assert!(matches!(denied.kind, SynologyErrorKind::PermissionDenied));
    assert_dsm_failure(&denied, 105);

    assert_eq!(nas.requests().len(), 5);
    for index in 0..5 {
        assert_eq!(request_api(&nas, index), ABB_DEVICE);
        assert_eq!(request_method(&nas, index), "list");
        assert_eq!(request_version(&nas, index), 1);
        assert_eq!(request_field(&nas, index, "offset"), None);
    }
}

#[tokio::test]
async fn active_backup_devices_without_the_package_are_not_an_empty_table() {
    // Only the overview API (or nothing) discovered: no request, no fake `[]`.
    for apis in [&[(ABB_OVERVIEW, 1)][..], &[][..]] {
        let (service, nas) = service_with(apis, vec![ok(real_active_backup_devices())]).await;
        let error = service.list_active_backup_devices().await.unwrap_err();
        assert!(
            matches!(error.kind, SynologyErrorKind::ApiNotFound),
            "{error}"
        );
        assert_eq!(
            error.to_string(),
            "Active Backup for Business is not installed"
        );
        assert!(nas.requests().is_empty());
    }
}
