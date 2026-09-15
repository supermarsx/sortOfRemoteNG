//! Owned by t84-e12h: Virtual Machine Manager guests and Surveillance Station
//! info, cameras and recordings, decoded from the shapes DSM documents.

use super::*;

const GUEST: &str = "SYNO.Virtualization.API.Guest";
const CAMERA: &str = "SYNO.SurveillanceStation.Camera";
const SS_INFO: &str = "SYNO.SurveillanceStation.Info";
const RECORDING: &str = "SYNO.SurveillanceStation.Recording";

// ── Fixtures ────────────────────────────────────────────────────────

/// `vms` read.
// shape: Synology Virtual Machine Manager API guide, SYNO.Virtualization.API.Guest list (field table only)
pub(super) fn real_vms() -> Value {
    json!({
        "guests": [
            {
                "autorun": 0,
                "description": "",
                "guest_id": "00000000-0000-0000-0000-000000000001",
                "guest_name": "fixture-vm-a",
                "status": "shutdown",
                "storage_id": "00000000-0000-0000-0000-00000000000a",
                "storage_name": "Fixture VM Storage",
                "vcpu_num": 1,
                "vdisks": [{"controller": 1, "unmap": false, "vdisk_id": "00000000-0000-0000-0000-0000000000d1", "vdisk_size": 10240}],
                "vnics": [{"mac": "02:00:00:00:00:01", "model": 1, "network_id": "00000000-0000-0000-0000-0000000000e1", "network_name": "Fixture VM Network", "vnic_id": "00000000-0000-0000-0000-0000000000f1"}],
                "vram_size": 1024
            },
            {
                "autorun": 2,
                "description": "synthetic",
                "guest_id": "00000000-0000-0000-0000-000000000002",
                "guest_name": "fixture-vm-b",
                "status": "running",
                "storage_id": "00000000-0000-0000-0000-00000000000a",
                "storage_name": "Fixture VM Storage",
                "vcpu_num": 4,
                "vdisks": [],
                "vnics": [],
                "vram_size": 8192
            }
        ]
    })
}

/// `cameras` read (List version 9: `ip`, stream settings in `stream1`).
// shape: Synology Surveillance Station Web API guide, SYNO.SurveillanceStation.Camera List v9 (field table only)
pub(super) fn real_cameras() -> Value {
    json!({
        "total": 2,
        "cameras": [
            {"id": 1, "name": "fixture-cam-front", "ip": "192.0.2.37", "port": 80, "model": "Generic_ONVIF", "vendor": "ONVIF", "status": 1, "channel": "1", "dsId": 0, "DINum": 0, "DONum": 0, "stream1": {"resolution": "640x480", "fps": 10}},
            {"id": 2, "name": "fixture-cam-yard", "ip": "192.0.2.38", "port": 554, "model": "Define", "vendor": "User", "status": 0, "channel": "1", "dsId": 0}
        ]
    })
}

/// Surveillance Station `getinfo` (an admin action, not a panel read).
// shape: Synology Surveillance Station Web API guide, SYNO.SurveillanceStation.Info getinfo (field table only)
pub(super) fn real_surveillance_info() -> Value {
    json!({
        "version": {"major": 6, "minor": 0, "build": 2250},
        "path": "/webman/3rdparty/SurveillanceStation",
        "customizedPortHttp": 9900,
        "customizedPortHttps": 9901,
        "cameraNumber": 20,
        "licenseNumber": 30,
        "maxCameraSupport": 40,
        "serial": "SYNTH0001",
        "userPriv": 1,
        "isLicenseEnough": 1,
        "allowSnapshot": true
    })
}

/// Recording `List` (an admin action). The second row adds the optional
/// times, with numbers sent as strings.
// shape: Synology Surveillance Station Web API guide, SYNO.SurveillanceStation.Recording List (field table only)
pub(super) fn real_recordings() -> Value {
    json!({
        "dsId": 0,
        "total": 2,
        "recordings": [
            {"id": 46, "cameraId": 13, "cameraName": "fixture-cam", "filePath": "20260914PM/fixture-cam-20260914-120000.avi", "sizeByte": 1041280, "width": 640, "height": 480, "videoCodec": "MJPEG", "audioCodec": ""},
            {"id": "47", "cameraId": 13, "cameraName": "fixture-cam", "startTime": 1757851200, "stopTime": "1757851500", "sizeByte": "2048", "videoCodec": "H264", "audioCodec": "AAC"}
        ]
    })
}

fn first_row(fixture: Value, key: &str) -> Value {
    fixture[key][0].clone()
}

fn without(mut row: Value, key: &str) -> Value {
    row.as_object_mut().unwrap().remove(key);
    row
}

// ── Virtual Machine Manager ─────────────────────────────────────────

#[tokio::test]
async fn vm_guests_decode_the_guide_list_and_map_autorun_modes() {
    let restore_last = {
        let mut row = first_row(real_vms(), "guests");
        row["autorun"] = json!(1);
        row
    };
    let unreported = without(first_row(real_vms(), "guests"), "autorun");
    let (service, nas) = service_with(
        &[(GUEST, 1)],
        vec![
            ok(real_vms()),
            ok(json!({"guests": [restore_last, unreported]})),
            // Regression: a bare guest array still decodes.
            ok(json!([first_row(real_vms(), "guests")])),
            ok(json!({"total": 0})),
            ok(json!({"guests": [without(first_row(real_vms(), "guests"), "guest_id")]})),
            dsm_error(105),
        ],
    )
    .await;

    let guests = service.list_vms().await.unwrap();
    assert_eq!(guests.len(), 2);
    let guest = &guests[0];
    assert_eq!(guest.guest_id, "00000000-0000-0000-0000-000000000001");
    assert_eq!(guest.guest_name, "fixture-vm-a");
    assert_eq!(guest.status, "shutdown");
    assert_eq!(guest.description.as_deref(), Some(""));
    assert_eq!(guest.vcpu_num, 1);
    assert_eq!(guest.vram_size, 1024);
    assert_eq!(guest.autorun, Some(false));
    assert_eq!(guest.storage_name.as_deref(), Some("Fixture VM Storage"));
    assert_eq!(guest.storage_size, None);
    assert_eq!(guest.vnc_port, None);
    assert_eq!(guests[1].autorun, Some(true));
    assert_eq!(guests[1].vcpu_num, 4);
    assert_eq!(guests[1].vram_size, 8192);
    assert_eq!(
        serde_json::to_value(guest).unwrap(),
        json!({
            "guestId": "00000000-0000-0000-0000-000000000001",
            "guestName": "fixture-vm-a",
            "status": "shutdown",
            "description": "",
            "vcpuNum": 1,
            "vramSize": 1024,
            "autorun": false,
            "storageName": "Fixture VM Storage",
            "storageSize": null,
            "vncPort": null
        })
    );

    let modes = service.list_vms().await.unwrap();
    assert_eq!(modes[0].autorun, Some(true));
    assert_eq!(modes[1].autorun, None);

    let bare = service.list_vms().await.unwrap();
    assert_eq!(bare.len(), 1);
    assert_eq!(bare[0].guest_name, "fixture-vm-a");

    assert_schema_failure(&service.list_vms().await.unwrap_err());
    assert_schema_failure(&service.list_vms().await.unwrap_err());

    let denied = service.list_vms().await.unwrap_err();
    assert!(matches!(denied.kind, SynologyErrorKind::PermissionDenied));
    assert_dsm_failure(&denied, 105);

    assert_eq!(nas.requests().len(), 6);
    for index in 0..6 {
        assert_eq!(request_api(&nas, index), GUEST);
        assert_eq!(request_method(&nas, index), "list");
        assert_eq!(request_version(&nas, index), 1);
        assert_eq!(
            request_field(&nas, index, "additional").as_deref(),
            Some(r#"["status","autorun"]"#)
        );
    }
}

// ── Surveillance Station ────────────────────────────────────────────

#[tokio::test]
async fn cameras_decode_version_9_and_version_7_rows() {
    // shape: py-synologydsm-api tests/api_data/dsm_6/surveillance_station/const_6_surveillance_station_camera.py, List v7 (MIT)
    let version_7 = json!({
        "cameras": [{"id": 1, "name": "fixture-cam", "host": "192.0.2.101", "port": 554, "model": "Define", "vendor": "User", "status": 0, "camStatus": 1, "enabled": true, "recStatus": 1, "resolution": "1920x1080", "fps": 0, "snapshot_path": "/webapi/entry.cgi?api=SYNO.SurveillanceStation.Camera&method=GetSnapshot&version=1&cameraId=1"}],
        "total": 1,
        "keyTotalCnt": 0,
        "keyUsedCnt": 0,
        "timestamp": "1757851200"
    });
    let both_names = {
        let mut row = first_row(real_cameras(), "cameras");
        row["host"] = json!("fixture-cam.invalid");
        row["resolution"] = json!("1280x720");
        row["recStatus"] = json!(0);
        row["enabled"] = json!(false);
        row
    };
    let (service, nas) = service_with(
        &[(CAMERA, 9)],
        vec![
            ok(real_cameras()),
            ok(version_7),
            ok(json!({"cameras": [both_names]})),
            // Regression: a bare camera array still decodes.
            ok(json!([first_row(real_cameras(), "cameras")])),
            ok(json!({"total": 0})),
            ok(json!({"cameras": [without(first_row(real_cameras(), "cameras"), "id")]})),
        ],
    )
    .await;

    let cameras = service.list_cameras().await.unwrap();
    assert_eq!(cameras.len(), 2);
    let front = &cameras[0];
    assert_eq!(front.id, 1);
    assert_eq!(front.name, "fixture-cam-front");
    assert_eq!(front.ip.as_deref(), Some("192.0.2.37"));
    assert_eq!(front.port, 80);
    assert_eq!(front.model.as_deref(), Some("Generic_ONVIF"));
    assert_eq!(front.vendor.as_deref(), Some("ONVIF"));
    assert_eq!(front.status, 1);
    assert_eq!(front.enabled, None);
    assert_eq!(front.recording, None);
    assert_eq!(front.resolution.as_deref(), Some("640x480"));
    assert_eq!(front.fps, Some(10));
    assert_eq!(front.snapshot_path, None);
    assert_eq!(cameras[1].resolution, None);
    assert_eq!(cameras[1].fps, None);
    let ipc = serde_json::to_value(front).unwrap();
    assert_eq!(ipc["ip"], "192.0.2.37");
    assert!(ipc["enabled"].is_null() && ipc["recording"].is_null());

    let version_7_rows = service.list_cameras().await.unwrap();
    assert_eq!(version_7_rows[0].ip.as_deref(), Some("192.0.2.101"));
    assert_eq!(version_7_rows[0].enabled, Some(true));
    assert_eq!(version_7_rows[0].recording, Some(true));
    assert_eq!(version_7_rows[0].resolution.as_deref(), Some("1920x1080"));
    assert_eq!(version_7_rows[0].fps, Some(0));
    assert!(version_7_rows[0]
        .snapshot_path
        .as_deref()
        .unwrap()
        .contains("GetSnapshot"));

    let preferred = service.list_cameras().await.unwrap();
    assert_eq!(preferred[0].ip.as_deref(), Some("192.0.2.37"));
    assert_eq!(preferred[0].resolution.as_deref(), Some("1280x720"));
    assert_eq!(preferred[0].fps, Some(10));
    assert_eq!(preferred[0].recording, Some(false));
    assert_eq!(preferred[0].enabled, Some(false));

    let bare = service.list_cameras().await.unwrap();
    assert_eq!(bare.len(), 1);
    assert_eq!(bare[0].name, "fixture-cam-front");

    assert_schema_failure(&service.list_cameras().await.unwrap_err());
    assert_schema_failure(&service.list_cameras().await.unwrap_err());

    assert_eq!(nas.requests().len(), 6);
    for index in 0..6 {
        assert_eq!(request_api(&nas, index), CAMERA);
        assert_eq!(request_method(&nas, index), "List");
        assert_eq!(request_version(&nas, index), 9);
        for flag in ["basic", "streamInfo", "privilege"] {
            assert_eq!(
                request_field(&nas, index, flag).as_deref(),
                Some("true"),
                "{flag}"
            );
        }
    }
}

#[tokio::test]
async fn surveillance_info_maps_the_guide_counts() {
    let unreported = {
        let mut info = without(
            without(real_surveillance_info(), "cameraNumber"),
            "licenseNumber",
        );
        info["version"] = json!({"major": 9, "minor": 2, "build": "11850"});
        info
    };
    let (service, nas) = service_with(
        &[(SS_INFO, 8)],
        vec![
            ok(real_surveillance_info()),
            ok(unreported),
            ok(without(real_surveillance_info(), "version")),
        ],
    )
    .await;

    let info = service.get_surveillance_info().await.unwrap();
    assert_eq!(info.version.major, 6);
    assert_eq!(info.version.minor, 0);
    assert_eq!(info.version.build.as_deref(), Some("2250"));
    assert_eq!(info.camera_count, Some(20));
    assert_eq!(info.license_count, Some(30));
    assert_eq!(
        serde_json::to_value(&info).unwrap(),
        json!({"version": {"major": 6, "minor": 0, "build": "2250"}, "cameraCount": 20, "licenseCount": 30})
    );

    let other_user = service.get_surveillance_info().await.unwrap();
    assert_eq!(other_user.version.build.as_deref(), Some("11850"));
    assert_eq!(other_user.camera_count, None);
    assert_eq!(other_user.license_count, None);

    assert_schema_failure(&service.get_surveillance_info().await.unwrap_err());

    for index in 0..3 {
        assert_eq!(request_api(&nas, index), SS_INFO);
        assert_eq!(request_method(&nas, index), "getinfo");
        assert_eq!(request_version(&nas, index), 8);
    }
}

#[tokio::test]
async fn recordings_decode_the_guide_rows_and_quote_camera_ids_for_json_apis() {
    let (service, nas) = service_with(
        &[(RECORDING, 6)],
        vec![
            ok(real_recordings()),
            // Regression: a bare recording array still decodes.
            ok(json!([first_row(real_recordings(), "recordings")])),
            ok(json!({"dsId": 0, "total": 0})),
            ok(json!({"recordings": [without(first_row(real_recordings(), "recordings"), "sizeByte")]})),
        ],
    )
    .await;

    let recordings = service.list_recordings("13", 0, 50).await.unwrap();
    assert_eq!(recordings.len(), 2);
    let first = &recordings[0];
    assert_eq!(first.id, "46");
    assert_eq!(first.camera_id, 13);
    assert_eq!(first.camera_name.as_deref(), Some("fixture-cam"));
    assert_eq!(first.file_size, 1_041_280);
    assert_eq!(first.start_time, None);
    assert_eq!(first.stop_time, None);
    assert_eq!(first.event_type, None);
    let ipc = serde_json::to_value(first).unwrap();
    assert_eq!(ipc["id"], "46");
    assert_eq!(ipc["fileSize"], 1_041_280);
    assert!(ipc["startTime"].is_null() && ipc["stopTime"].is_null());
    let timed = &recordings[1];
    assert_eq!(timed.id, "47");
    assert_eq!(timed.start_time.as_deref(), Some("1757851200"));
    assert_eq!(timed.stop_time.as_deref(), Some("1757851500"));
    assert_eq!(timed.file_size, 2048);

    let bare = service.list_recordings("13", 0, 50).await.unwrap();
    assert_eq!(bare[0].id, "46");
    assert_schema_failure(&service.list_recordings("13", 0, 50).await.unwrap_err());
    assert_schema_failure(&service.list_recordings("13", 0, 50).await.unwrap_err());

    assert_eq!(nas.requests().len(), 4);
    for index in 0..4 {
        assert_eq!(request_api(&nas, index), RECORDING);
        assert_eq!(request_method(&nas, index), "List");
        assert_eq!(request_version(&nas, index), 6);
        assert_eq!(
            request_field(&nas, index, "cameraIds").as_deref(),
            Some(r#""13""#)
        );
        assert_eq!(request_field(&nas, index, "offset").as_deref(), Some("0"));
        assert_eq!(request_field(&nas, index, "limit").as_deref(), Some("50"));
    }

    // A plain-form declaration keeps the raw id list.
    let (plain, plain_nas) =
        service_with_format(&[(RECORDING, 6, None)], vec![ok(json!({"recordings": []}))]).await;
    assert!(plain
        .list_recordings("13,14", 10, 5)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        request_field(&plain_nas, 0, "cameraIds").as_deref(),
        Some("13,14")
    );
    assert_eq!(
        request_field(&plain_nas, 0, "offset").as_deref(),
        Some("10")
    );
}
