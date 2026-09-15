//! Owned by t84-e12a: the `wire` decoders, `SynoClient::api_list`, the lenient
//! `types` attributes (addendum §3.3 A) and the IPC shape of every widened or
//! added DTO field (§3.3 B/C), which the frontend mirrors as `x?: T | null`.

use super::*;
use crate::wire::string_param;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::BTreeSet;

const UTILIZATION: &str = "SYNO.Core.System.Utilization";
const USER: &str = "SYNO.Core.User";

// ── Fixtures ────────────────────────────────────────────────────────

/// `utilization` read.
// shape: py-synologydsm-api DSM_6_CORE_UTILIZATION, dsm_helper Core/System/Utilization.dart (Apache-2.0), vcf-content-factory synology-storage.md data.disk.{disk,total} [observed DSM 7.3.2] (MIT)
pub(super) fn real_utilization() -> Value {
    json!({
        "cpu": {"15min_load": 51, "1min_load": 37, "5min_load": 33, "device": "System", "other_load": 3, "system_load": 2, "user_load": 4},
        "disk": {
            "disk": [{"device": "sata1", "display_name": "Drive 1", "read_access": 3, "read_byte": 55261, "type": "internal", "utilization": 12, "write_access": 15, "write_byte": 419425}],
            "total": {"device": "total", "read_access": 3, "read_byte": 55261, "utilization": 12, "write_access": 15, "write_byte": 419425}
        },
        "lun": [],
        "memory": {"avail_real": 156188, "avail_swap": 4146316, "buffer": 15172, "cached": 2764756, "device": "Memory", "memory_size": 4194304, "real_usage": 24, "si_disk": 0, "so_disk": 0, "swap_usage": 6, "total_real": 3867268, "total_swap": 4415404},
        "network": [{"device": "total", "rx": 109549, "tx": 45097}, {"device": "eth0", "rx": 109549, "tx": 45097}],
        "space": {
            "total": {"device": "total", "read_access": 1, "read_byte": 27603, "utilization": 1, "write_access": 23, "write_byte": 132496},
            "volume": [{"device": "dm-4", "display_name": "volume1", "read_access": 1, "read_byte": 27603, "utilization": 1, "write_access": 23, "write_byte": 132496}]
        },
        "time": 1585503221
    })
}

/// `fileStationInfo` read (DSM 7 lists the protocols as an array).
// shape: N4S4/synology-api FileStation usage doc, SYNO.FileStation.Info get [DSM 7] (MIT)
pub(super) fn real_file_station_info() -> Value {
    json!({
        "enable_list_usergrp": false,
        "hostname": "fixture-nas",
        "is_manager": true,
        "items": [{"gid": 100}],
        "support_file_request": true,
        "support_sharing": true,
        "support_vfs": true,
        "support_virtual": {"enable_iso_mount": true, "enable_remote_mount": true},
        "support_virtual_protocol": ["cifs", "nfs", "iso"],
        "system_codepage": "enu",
        "uid": 1026
    })
}

// ── 1. wire decoders ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct Unsigned {
    #[serde(deserialize_with = "crate::wire::u64_lenient")]
    value: u64,
}

#[derive(Debug, Deserialize)]
struct OptionalUnsigned {
    #[serde(default, deserialize_with = "crate::wire::opt_u64_lenient")]
    value: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OptionalTime {
    #[serde(default, deserialize_with = "crate::wire::opt_i64_lenient")]
    value: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct Text {
    #[serde(deserialize_with = "crate::wire::string_or_number")]
    value: String,
}

#[derive(Debug, Deserialize)]
struct OptionalText {
    #[serde(default, deserialize_with = "crate::wire::opt_string_or_number")]
    value: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Protocols {
    #[serde(default, deserialize_with = "crate::wire::opt_csv_or_list")]
    value: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct Disks {
    #[serde(deserialize_with = "crate::wire::disk_rows")]
    value: Vec<DiskUtilization>,
}

#[derive(Debug, Deserialize)]
struct Flag {
    #[serde(deserialize_with = "crate::wire::bool_lenient")]
    value: bool,
}

/// Decodes `{"value": value}`.
fn field<T: DeserializeOwned>(value: &Value) -> Result<T, serde_json::Error> {
    serde_json::from_value(json!({ "value": value }))
}

/// Decodes `{}`.
fn absent<T: DeserializeOwned>() -> Result<T, serde_json::Error> {
    serde_json::from_value(json!({}))
}

#[test]
fn unsigned_decoders_accept_dsm_number_strings_and_nothing_else() {
    for value in [json!(123), json!("123"), json!(" 123 "), json!(123.0)] {
        assert_eq!(field::<Unsigned>(&value).unwrap().value, 123, "{value}");
    }
    assert_eq!(field::<Unsigned>(&json!(u64::MAX)).unwrap().value, u64::MAX);
    for value in [
        json!(-1),
        json!("x"),
        json!(1.5),
        Value::Null,
        json!(""),
        json!("-1"),
        json!(true),
        json!([1]),
    ] {
        assert!(field::<Unsigned>(&value).is_err(), "{value}");
    }
    assert!(absent::<Unsigned>().is_err());

    assert_eq!(absent::<OptionalUnsigned>().unwrap().value, None);
    for value in [Value::Null, json!(""), json!("  ")] {
        assert_eq!(field::<OptionalUnsigned>(&value).unwrap().value, None);
    }
    for value in [json!(4096), json!("4096"), json!(4096.0)] {
        assert_eq!(field::<OptionalUnsigned>(&value).unwrap().value, Some(4096));
    }
    for value in [json!(-1), json!("x"), json!(0.5), json!(false)] {
        assert!(field::<OptionalUnsigned>(&value).is_err(), "{value}");
    }

    let time = |value: Value| field::<OptionalTime>(&value).map(|decoded| decoded.value);
    assert_eq!(time(json!("1341210005")).unwrap(), Some(1_341_210_005));
    assert_eq!(time(json!(1_550_089_068)).unwrap(), Some(1_550_089_068));
    assert_eq!(time(json!(" -5 ")).unwrap(), Some(-5));
    assert_eq!(time(json!(-5)).unwrap(), Some(-5));
    assert_eq!(absent::<OptionalTime>().unwrap().value, None);
    for value in [Value::Null, json!(""), json!(" ")] {
        assert_eq!(time(value).unwrap(), None);
    }
    for value in [
        json!(1.5),
        json!(1.0),
        json!("soon"),
        json!(u64::MAX),
        json!({}),
    ] {
        assert!(time(value.clone()).is_err(), "{value}");
    }
}

#[test]
fn text_decoders_accept_numbers_and_strings() {
    for (value, expected) in [
        (json!(3543), "3543"),
        (json!("3.8-3543"), "3.8-3543"),
        (json!(-2), "-2"),
        (json!(""), ""),
    ] {
        assert_eq!(field::<Text>(&value).unwrap().value, expected);
    }
    for value in [Value::Null, json!(true), json!([]), json!({})] {
        assert!(field::<Text>(&value).is_err(), "{value}");
    }
    assert!(absent::<Text>().is_err());

    assert_eq!(absent::<OptionalText>().unwrap().value, None);
    assert_eq!(field::<OptionalText>(&Value::Null).unwrap().value, None);
    for value in [json!(2250), json!("2250")] {
        assert_eq!(
            field::<OptionalText>(&value).unwrap().value.as_deref(),
            Some("2250")
        );
    }
    assert!(field::<OptionalText>(&json!(true)).is_err());
}

#[test]
fn protocol_lists_accept_csv_or_arrays_and_keep_absence_distinct() {
    let decode = |value: Value| field::<Protocols>(&value).map(|decoded| decoded.value);
    assert_eq!(
        decode(json!("cifs,nfs, iso")).unwrap().unwrap(),
        ["cifs", "nfs", "iso"]
    );
    assert_eq!(decode(json!(["cifs"])).unwrap().unwrap(), ["cifs"]);
    assert_eq!(decode(json!(" , ")).unwrap(), Some(vec![]));
    assert_eq!(decode(json!("")).unwrap(), Some(vec![]));
    assert_eq!(decode(Value::Null).unwrap(), None);
    assert_eq!(absent::<Protocols>().unwrap().value, None);
    for value in [json!(5), json!([1]), json!({})] {
        assert!(decode(value.clone()).is_err(), "{value}");
    }
}

#[test]
fn disk_rows_accept_grouped_and_flat_disks_but_not_a_missing_group() {
    let grouped = field::<Disks>(&real_utilization()["disk"]).unwrap().value;
    assert_eq!(grouped.len(), 1);
    assert_eq!(grouped[0].device, "sata1");
    assert_eq!(grouped[0].display_name.as_deref(), Some("Drive 1"));
    assert_eq!(grouped[0].write_byte, Some(419_425));
    assert!(field::<Disks>(&json!([])).unwrap().value.is_empty());
    assert_eq!(
        field::<Disks>(&json!([{"device": "sata2"}])).unwrap().value[0].device,
        "sata2"
    );
    for value in [
        json!({"total": {}}),
        json!({"disk": {}}),
        Value::Null,
        json!("sata1"),
    ] {
        assert!(field::<Disks>(&value).is_err(), "{value}");
    }
}

#[test]
fn flags_accept_dsm_spellings_of_true_and_false_only() {
    for (value, expected) in [
        (json!(true), true),
        (json!(false), false),
        (json!(0), false),
        (json!(1), true),
        (json!("yes"), true),
        (json!("no"), false),
        (json!("true"), true),
        (json!("false"), false),
    ] {
        assert_eq!(field::<Flag>(&value).unwrap().value, expected, "{value}");
    }
    for value in [
        json!(2),
        json!(-1),
        json!(1.0),
        json!("maybe"),
        json!("YES"),
        json!(""),
        Value::Null,
    ] {
        assert!(field::<Flag>(&value).is_err(), "{value}");
    }
}

#[tokio::test]
async fn string_params_are_json_quoted_only_where_discovery_declares_json() {
    const CONTAINER: &str = "SYNO.Docker.Container";
    const DOWNLOADS: &str = "SYNO.DownloadStation.Task";
    let (mut service, nas) = service_with_format(
        &[(CONTAINER, 1, Some("JSON")), (DOWNLOADS, 3, None)],
        vec![ok(json!({"containers": []})), ok(json!({"tasks": []}))],
    )
    .await;
    let client = service.client.as_mut().unwrap();
    client.api_info.get_mut(DOWNLOADS).unwrap().path = "DownloadStation/task.cgi".into();
    let client = service.client.as_ref().unwrap();

    assert_eq!(string_param(client, CONTAINER, "all"), r#""all""#);
    assert_eq!(string_param(client, DOWNLOADS, "all"), "all");
    assert_eq!(
        string_param(client, CONTAINER, r#"quote" and \ slash"#),
        r#""quote\" and \\ slash""#
    );
    assert_eq!(string_param(client, DOWNLOADS, r#"a"b"#), r#"a"b"#);
    assert_eq!(string_param(client, "SYNO.Fixture.Unknown", "all"), "all");

    // The encoded value reaches DSM unchanged as a form field.
    let quoted = string_param(client, CONTAINER, "all");
    let rows: Vec<Value> = client
        .api_list(
            CONTAINER,
            1,
            "list",
            &[("type", quoted.as_str())],
            &["containers"],
        )
        .await
        .unwrap();
    assert!(rows.is_empty());
    let raw = string_param(client, DOWNLOADS, "all");
    client
        .api_list::<Value>(DOWNLOADS, 3, "list", &[("type", raw.as_str())], &["tasks"])
        .await
        .unwrap();
    assert_eq!(request_field(&nas, 0, "type").as_deref(), Some(r#""all""#));
    assert_eq!(request_field(&nas, 1, "type").as_deref(), Some("all"));
    assert_eq!(request_field(&nas, 1, "offset"), None);
    assert_eq!(request_api(&nas, 1), DOWNLOADS);
    assert_eq!(
        nas.requests()[1].target.split('?').next(),
        Some("/webapi/DownloadStation/task.cgi")
    );
}

// ── 2. api_list ─────────────────────────────────────────────────────

#[tokio::test]
async fn api_list_accepts_bare_and_enveloped_lists_but_never_invents_one() {
    let user = json!({"name": "fixture-user-a", "description": "synthetic"});
    let (service, nas) = service_with(
        &[(USER, 1)],
        vec![
            ok(json!([user])),
            ok(json!({"users": [user], "offset": 0, "total": 1})),
            ok(json!({"items": [user, user], "total": 2})),
            ok(json!({"users": [user], "items": [user, user]})),
            ok(json!({"total": 0})),
            ok(json!({"users": null, "total": 0})),
            ok(json!({"users": {"name": "fixture-user-a"}})),
            ok(json!({"users": [{"description": "no name"}]})),
            json!({"success": true}),
            ok(json!("users")),
        ],
    )
    .await;
    let client = service.client.as_ref().unwrap();
    let form = [("offset", "0"), ("limit", "-1")];
    let users = ["users"];
    let either = ["users", "items"];

    let bare: Vec<SynoUser> = client
        .api_list(USER, 1, "list", &form, &users)
        .await
        .unwrap();
    assert_eq!(bare.len(), 1);
    assert_eq!(bare[0].name, "fixture-user-a");
    assert_eq!(bare[0].uid, None);
    let wrapped: Vec<SynoUser> = client
        .api_list(USER, 1, "list", &form, &users)
        .await
        .unwrap();
    assert_eq!(wrapped[0].description.as_deref(), Some("synthetic"));
    let second_key: Vec<SynoUser> = client
        .api_list(USER, 1, "list", &form, &either)
        .await
        .unwrap();
    assert_eq!(second_key.len(), 2);
    let first_key_wins: Vec<SynoUser> = client
        .api_list(USER, 1, "list", &form, &either)
        .await
        .unwrap();
    assert_eq!(first_key_wins.len(), 1);
    // Missing key, null list, wrong list type, bad row, no data, scalar data.
    for _ in 0..6 {
        let error = client
            .api_list::<SynoUser>(USER, 1, "list", &form, &users)
            .await
            .unwrap_err();
        assert_schema_failure(&error);
        assert_eq!(
            error.to_string().lines().next(),
            Some("NAS returned an invalid or unsupported JSON response")
        );
    }

    assert_eq!(nas.requests().len(), 10);
    for index in 0..10 {
        assert_eq!(request_api(&nas, index), USER);
        assert_eq!(request_method(&nas, index), "list");
        assert_eq!(request_version(&nas, index), 1);
        assert_eq!(request_field(&nas, index, "offset").as_deref(), Some("0"));
        assert_eq!(request_field(&nas, index, "limit").as_deref(), Some("-1"));
        assert_eq!(
            request_field(&nas, index, "_sid").as_deref(),
            Some("fixture-sid")
        );
    }
}

#[tokio::test]
async fn api_list_keeps_dsm_refusals_and_their_closed_diagnostic() {
    assert_eq!(
        dsm_error(105).to_string(),
        r#"{"error":{"code":105},"success":false}"#
    );
    let (service, nas) = service_with(&[(USER, 1)], vec![dsm_error(105), dsm_error(120)]).await;
    let client = service.client.as_ref().unwrap();

    let denied = client
        .api_list::<SynoUser>(USER, 1, "list", &[], &["users"])
        .await
        .unwrap_err();
    assert!(matches!(denied.kind, SynologyErrorKind::PermissionDenied));
    assert_dsm_failure(&denied, 105);
    assert_eq!(
        denied.to_string(),
        concat!(
            "SYNO.Core.User: requires a DSM administrator account (code 105)\n",
            r#"synology-diagnostic:v1:{"stage":"api_response","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":105,"access":"administrator"}"#
        )
    );

    let rejected = client
        .api_list::<SynoUser>(USER, 1, "list", &[], &["users"])
        .await
        .unwrap_err();
    assert!(matches!(rejected.kind, SynologyErrorKind::ApiError(120)));
    assert_dsm_failure(&rejected, 120);
    assert!(!rejected.to_string().contains("access"));

    let missing = client
        .api_list::<SynoUser>("SYNO.Core.Group", 1, "list", &[], &["groups"])
        .await
        .unwrap_err();
    assert!(matches!(missing.kind, SynologyErrorKind::ApiNotFound));
    assert_eq!(nas.requests().len(), 2);
}

// ── 3-6. Lenient attributes on existing DTOs (§3.3 A) ───────────────

#[tokio::test]
async fn utilization_decodes_grouped_disks_and_the_flat_legacy_rows() {
    let mut flat = real_utilization();
    flat["disk"] = json!([]);
    let mut total_only = real_utilization();
    total_only["disk"] = json!({"total": {"device": "total"}});
    let (service, nas) = service_with(
        &[(UTILIZATION, 1)],
        vec![ok(real_utilization()), ok(flat), ok(total_only)],
    )
    .await;

    let usage = service.get_utilization().await.unwrap();
    assert_eq!(usage.disk.len(), 1);
    assert_eq!(usage.disk[0].device, "sata1");
    assert_eq!(usage.disk[0].display_name.as_deref(), Some("Drive 1"));
    assert_eq!(usage.disk[0].read_byte, Some(55_261));
    assert_eq!(usage.disk[0].utilization, Some(12.0));
    assert!(usage.network.iter().any(|row| row.device == "total"));
    assert_eq!(usage.memory.total_real, 3_867_268);
    assert_eq!(usage.cpu.fifteen_min_load, Some(51.0));
    // The renderer still receives a flat camelCase disk array.
    let ipc = serde_json::to_value(&usage).unwrap();
    assert_eq!(
        ipc["disk"],
        json!([{"device": "sata1", "displayName": "Drive 1", "readAccess": 3, "writeAccess": 15, "readByte": 55261, "writeByte": 419425, "utilization": 12.0}])
    );

    // Regression: the flat shape the app and the mock DSM used so far.
    assert!(service.get_utilization().await.unwrap().disk.is_empty());
    // A disk group without rows is a schema failure, not an empty table.
    assert_schema_failure(&service.get_utilization().await.unwrap_err());

    for index in 0..3 {
        assert_eq!(request_api(&nas, index), UTILIZATION);
        assert_eq!(request_method(&nas, index), "get");
        assert_eq!(request_version(&nas, index), 1);
    }
}

#[tokio::test]
async fn file_station_info_accepts_protocol_arrays_and_guide_csv() {
    let guide = json!({"hostname": "fixture-nas", "is_manager": true, "support_sharing": true, "support_virtual_protocol": "cifs,iso"});
    let mut without = real_file_station_info();
    without
        .as_object_mut()
        .unwrap()
        .remove("support_virtual_protocol");
    let (service, nas) = service_with(
        &[("SYNO.FileStation.Info", 2)],
        vec![
            ok(real_file_station_info()),
            // shape: Synology File Station Official API guide, SYNO.FileStation.Info get (field table only)
            ok(guide),
            ok(without),
        ],
    )
    .await;

    let dsm7 = service.get_file_station_info().await.unwrap();
    assert_eq!(dsm7.hostname, "fixture-nas");
    assert!(dsm7.is_manager && dsm7.support_sharing);
    assert_eq!(
        dsm7.support_virtual_protocol.unwrap(),
        ["cifs", "nfs", "iso"]
    );
    let csv = service.get_file_station_info().await.unwrap();
    assert_eq!(csv.support_virtual_protocol.unwrap(), ["cifs", "iso"]);
    let unreported = service.get_file_station_info().await.unwrap();
    assert_eq!(unreported.support_virtual_protocol, None);
    assert!(serde_json::to_value(unreported).unwrap()["supportVirtualProtocol"].is_null());
    assert_eq!(request_method(&nas, 0), "get");
    assert_eq!(request_version(&nas, 2), 2);
}

#[tokio::test]
async fn download_station_version_accepts_numbers_and_strings() {
    const INFO: &str = "SYNO.DownloadStation.Info";
    let (service, nas) = service_with_format(
        &[(INFO, 2, None)],
        vec![
            // shape: py-synologydsm-api download_station const (MIT)
            ok(json!({"is_manager": true, "version": 3543, "version_string": "3.8-3543"})),
            // shape: Synology Download Station Official API guide (field table only)
            ok(json!({"is_manager": false, "version": "3.8-3543"})),
            ok(json!({"is_manager": true, "version": null})),
        ],
    )
    .await;
    let numeric = service.get_download_station_info().await.unwrap();
    assert_eq!(numeric.version, "3543");
    assert_eq!(numeric.version_string.as_deref(), Some("3.8-3543"));
    assert_eq!(
        serde_json::to_value(&numeric).unwrap(),
        json!({"isManager": true, "version": "3543", "versionString": "3.8-3543"})
    );
    let text = service.get_download_station_info().await.unwrap();
    assert_eq!(text.version, "3.8-3543");
    assert!(!text.is_manager);
    assert_schema_failure(&service.get_download_station_info().await.unwrap_err());
    assert_eq!(request_method(&nas, 0), "getinfo");
    assert_eq!(request_version(&nas, 0), 2);
}

#[test]
fn surveillance_build_accepts_numbers_and_strings() {
    // shape: Synology Surveillance Station Web API guide §2.3.3.1 getinfo (field table only)
    let guide = json!({"version": {"major": 6, "minor": 0, "build": 2250}, "path": "/webman/3rdparty/SurveillanceStation", "customizedPortHttp": 9900, "customizedPortHttps": 9901, "cameraNumber": 20, "licenseNumber": 30, "maxCameraSupport": 40, "serial": "SYNTH0001", "userPriv": 1, "isLicenseEnough": 1, "allowSnapshot": true});
    let info: SurveillanceInfo = serde_json::from_value(guide).unwrap();
    assert_eq!(info.version.build.as_deref(), Some("2250"));
    // `cameraNumber` is mapped by the Surveillance lane; the DTO no longer
    // requires a count DSM only reports to Surveillance-login users.
    assert_eq!(info.camera_count, None);

    let build = |version: Value| {
        serde_json::from_value::<SurveillanceVersion>(version).map(|version| version.build)
    };
    assert_eq!(
        build(json!({"major": 9, "minor": 2, "build": "11850"})).unwrap(),
        Some("11850".into())
    );
    assert_eq!(
        build(json!({"major": 9, "minor": 2, "build": null})).unwrap(),
        None
    );
    assert_eq!(build(json!({"major": 9, "minor": 2})).unwrap(), None);
    assert!(build(json!({"major": 9, "minor": 2, "build": [1]})).is_err());
    let ipc = serde_json::to_value(
        serde_json::from_value::<SurveillanceInfo>(json!({"version": {"major": 9, "minor": 2}}))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        ipc,
        json!({"version": {"major": 9, "minor": 2, "build": null}, "cameraCount": null, "licenseCount": null})
    );
}

/// Addendum §3.3 A5 asked for `#[serde(alias = "device_id")]` on `did`. e2
/// already decodes both names as separate lenient fields and reads them
/// through `device_token()` (did first), which also accepts replies carrying
/// both keys; an alias would make such a reply a duplicate-field error.
#[test]
fn login_device_token_is_read_from_did_or_device_id() {
    let token = |value: Value| {
        serde_json::from_value::<LoginResult>(value)
            .unwrap()
            .device_token()
            .map(String::from)
    };
    assert_eq!(
        token(json!({"sid": "s", "synotoken": "t", "device_id": "d"})),
        Some("d".into())
    );
    assert_eq!(token(json!({"sid": "s", "did": "d"})), Some("d".into()));
    assert_eq!(token(json!({"sid": "s", "synotoken": "t"})), None);
}

// ── 7. IPC keys and null policy (§3.3 B/C) ──────────────────────────

/// One DTO's camelCase IPC contract. Key lists mirror
/// `src/types/hardware/synology.ts` (t84-e13).
struct IpcShape {
    dto: &'static str,
    round_trip: fn(Value) -> Result<Value, serde_json::Error>,
    /// Keys before t84 (§3.3 B keeps every name).
    keys: &'static [&'static str],
    /// §3.3 B: now `Option`, same key, `null` when DSM does not report it.
    widened: &'static [&'static str],
    /// §3.3 C: new optional keys.
    added: &'static [&'static str],
    /// Every field populated, camelCase.
    full: Value,
    /// Only the fields the DTO still requires.
    required: Value,
}

fn round_trip<T: DeserializeOwned + Serialize>(value: Value) -> Result<Value, serde_json::Error> {
    serde_json::to_value(serde_json::from_value::<T>(value)?)
}

fn shape<T: DeserializeOwned + Serialize>(
    dto: &'static str,
    keys: &'static [&'static str],
    widened: &'static [&'static str],
    added: &'static [&'static str],
    full: Value,
    required: Value,
) -> IpcShape {
    IpcShape {
        dto,
        round_trip: round_trip::<T>,
        keys,
        widened,
        added,
        full,
        required,
    }
}

fn ipc_shapes() -> Vec<IpcShape> {
    let time = "2026/09/15 12:00:00";
    vec![
        shape::<ProcessInfo>(
            "ProcessInfo",
            &["pid", "name", "user", "cpu", "memory", "threads"],
            &["user"],
            &[],
            json!({"pid": 1234, "name": "/usr/syno/sbin/synoscgi", "user": "fixture-user", "cpu": 1.5, "memory": 20480.5, "threads": 4}),
            json!({"pid": 1234, "name": "/usr/syno/sbin/synoscgi", "cpu": 1.5, "memory": 20480.5}),
        ),
        shape::<SmartInfo>(
            "SmartInfo",
            &[
                "diskId",
                "diskName",
                "healthStatus",
                "temperature",
                "powerOnHours",
                "reallocatedSectors",
                "attributes",
            ],
            &["diskName", "healthStatus", "attributes"],
            &[],
            json!({"diskId": "sata1", "diskName": "Drive 1", "healthStatus": "normal", "temperature": 38, "powerOnHours": 1200, "reallocatedSectors": 0,
                "attributes": [{"id": 5, "name": "Reallocated_Sector_Ct", "current": 100, "worst": 100, "threshold": 10, "raw": "0", "status": "ok"}]}),
            json!({"diskId": "sata1"}),
        ),
        shape::<NetworkOverview>(
            "NetworkOverview",
            &["hostname", "workgroup", "dns", "gateway", "interfaces"],
            &["interfaces"],
            &[],
            json!({"hostname": "fixture-nas", "workgroup": "WORKGROUP", "dns": ["192.0.2.53"], "gateway": "192.0.2.1",
                "interfaces": [{"id": "eth0", "name": "eth0", "mac": null, "ip": ["192.0.2.10"], "ipv6": [], "subnet": "255.255.255.0", "mtu": null, "linkSpeed": "1000", "status": "connected", "interfaceType": "lan"}]}),
            json!({"hostname": "fixture-nas", "dns": []}),
        ),
        shape::<NetworkInterface>(
            "NetworkInterface",
            &[
                "id",
                "name",
                "mac",
                "ip",
                "ipv6",
                "subnet",
                "mtu",
                "linkSpeed",
                "status",
                "interfaceType",
            ],
            &["mac"],
            &[],
            json!({"id": "eth0", "name": "LAN 1", "mac": "00:00:5e:00:53:01", "ip": ["192.0.2.10"], "ipv6": ["2001:db8::10"], "subnet": "255.255.255.0", "mtu": 1500, "linkSpeed": "1000", "status": "connected", "interfaceType": "lan"}),
            json!({"id": "eth0", "ip": [], "ipv6": [], "status": "connected"}),
        ),
        shape::<FirewallRule>(
            "FirewallRule",
            &[
                "id",
                "srcIp",
                "srcPort",
                "direction",
                "action",
                "protocol",
                "enabled",
            ],
            &[
                "srcIp",
                "srcPort",
                "direction",
                "action",
                "protocol",
                "enabled",
            ],
            &["adapter"],
            json!({"id": "1", "adapter": "global", "srcIp": "198.51.100.0/24", "srcPort": "all", "direction": "in", "action": "allow", "protocol": "all", "enabled": true}),
            json!({}),
        ),
        shape::<SynoUser>(
            "SynoUser",
            &[
                "name",
                "uid",
                "description",
                "email",
                "expired",
                "enableHomeService",
            ],
            &["uid"],
            &[],
            json!({"name": "fixture-user", "uid": 1026, "description": "synthetic", "email": "user@fixture.invalid", "expired": "normal", "enableHomeService": true}),
            json!({"name": "fixture-user"}),
        ),
        shape::<SynoGroup>(
            "SynoGroup",
            &["name", "gid", "description", "members"],
            &["members"],
            &[],
            json!({"name": "fixture-group", "gid": 100, "description": "synthetic", "members": ["fixture-user"]}),
            json!({"name": "fixture-group", "gid": 100}),
        ),
        shape::<PackageInfo>(
            "PackageInfo",
            &[
                "id",
                "name",
                "version",
                "description",
                "status",
                "isUninstallPages",
                "updateVersion",
                "additional",
            ],
            &["status"],
            &[],
            json!({"id": "SynoFixture", "name": "Fixture", "version": "1.0.0-0001", "description": "synthetic", "status": "running", "isUninstallPages": false, "updateVersion": "1.0.1-0001",
                "additional": {"description": "synthetic", "maintainer": "Fixture", "dsmApps": "SYNO.SDS.Fixture", "dsmAppPage": "SYNO.SDS.Fixture.Page"}}),
            json!({"id": "SynoFixture", "name": "Fixture", "version": "1.0.0-0001"}),
        ),
        shape::<ServiceStatus>(
            "ServiceStatus",
            &["id", "name", "enabled", "running", "port", "serviceType"],
            &["running", "serviceType"],
            &[],
            json!({"id": "ssh", "name": "SSH", "enabled": true, "running": true, "port": 22, "serviceType": "system"}),
            json!({"id": "ssh", "name": "SSH", "enabled": false}),
        ),
        shape::<DockerContainer>(
            "DockerContainer",
            &[
                "id",
                "name",
                "image",
                "status",
                "state",
                "created",
                "finishedAt",
                "upTime",
                "cpuPercent",
                "memoryUsage",
                "memoryLimit",
                "ports",
                "volumes",
            ],
            &["ports", "volumes"],
            &[],
            json!({"id": "0000000000000000", "name": "fixture", "image": "fixture/image:latest", "status": "running", "state": "running", "created": "2026-01-01T00:00:00Z", "finishedAt": "0001-01-01T00:00:00Z",
                "upTime": 3600, "cpuPercent": 1.5, "memoryUsage": 1_048_576, "memoryLimit": 2_097_152,
                "ports": [{"containerPort": 80, "hostPort": 8080, "protocol": "tcp", "hostIp": "0.0.0.0"}],
                "volumes": [{"source": "/volume1/docker/fixture", "destination": "/data", "mode": "rw"}]}),
            json!({"id": "0000000000000000", "name": "fixture", "image": "fixture/image:latest", "status": "running", "state": "running"}),
        ),
        shape::<DockerNetwork>(
            "DockerNetwork",
            &[
                "name",
                "id",
                "driver",
                "scope",
                "subnet",
                "gateway",
                "containers",
            ],
            &["scope"],
            &[],
            json!({"name": "bridge", "id": "0000000000000000", "driver": "bridge", "scope": "local", "subnet": "198.51.100.0/24", "gateway": "198.51.100.1", "containers": 2}),
            json!({"name": "bridge", "id": "0000000000000000", "driver": "bridge"}),
        ),
        shape::<DockerProject>(
            "DockerProject",
            &["name", "status", "services", "path"],
            &[],
            &["id"],
            json!({"id": "00000000-0000-0000-0000-000000000000", "name": "stack", "status": "RUNNING", "services": ["web"], "path": "/volume1/docker/stack"}),
            json!({"name": "stack", "status": "RUNNING", "services": []}),
        ),
        shape::<SurveillanceInfo>(
            "SurveillanceInfo",
            &["version", "cameraCount", "licenseCount"],
            &["cameraCount"],
            &[],
            json!({"version": {"major": 9, "minor": 2, "build": "11850"}, "cameraCount": 2, "licenseCount": 4}),
            json!({"version": {"major": 9, "minor": 2, "build": null}}),
        ),
        shape::<Camera>(
            "Camera",
            &[
                "id",
                "name",
                "ip",
                "port",
                "model",
                "vendor",
                "status",
                "enabled",
                "recording",
                "resolution",
                "fps",
                "streamPath",
                "snapshotPath",
            ],
            &["ip", "enabled"],
            &[],
            json!({"id": 1, "name": "Fixture Cam", "ip": "192.0.2.20", "port": 554, "model": "Fixture", "vendor": "Fixture", "status": 1, "enabled": true, "recording": false,
                "resolution": "1920x1080", "fps": 30, "streamPath": "rtsp://fixture.invalid/stream", "snapshotPath": "/snapshot"}),
            json!({"id": 1, "name": "Fixture Cam", "port": 554, "status": 1}),
        ),
        shape::<Recording>(
            "Recording",
            &[
                "id",
                "cameraId",
                "cameraName",
                "startTime",
                "stopTime",
                "fileSize",
                "eventType",
            ],
            &["startTime", "stopTime"],
            &[],
            json!({"id": "46", "cameraId": 1, "cameraName": "Fixture Cam", "startTime": "1757894400", "stopTime": "1757898000", "fileSize": 1_041_280, "eventType": "motion"}),
            json!({"id": "46", "cameraId": 1, "fileSize": 1_041_280}),
        ),
        shape::<BackupTaskInfo>(
            "BackupTaskInfo",
            &[
                "taskId",
                "name",
                "status",
                "lastBackupTime",
                "nextBackupTime",
                "destType",
                "destPath",
                "totalSize",
                "transferredSize",
                "progress",
            ],
            &["status"],
            &[],
            json!({"taskId": 1, "name": "Fixture backup", "status": "backupable", "lastBackupTime": "2026/09/14 01:00", "nextBackupTime": "2026/09/15 01:00",
                "destType": "local", "destPath": "/volume1/backup", "totalSize": 4096, "transferredSize": 2048, "progress": 0.5}),
            json!({"taskId": 1, "name": "Fixture backup"}),
        ),
        shape::<ActiveBackupDevice>(
            "ActiveBackupDevice",
            &[
                "deviceId",
                "deviceName",
                "deviceType",
                "status",
                "lastBackup",
                "agentVersion",
                "ipAddress",
            ],
            &["deviceType", "status"],
            &["osName"],
            json!({"deviceId": 1, "deviceName": "fixture-pc", "deviceType": "1", "status": "online", "lastBackup": "1757894400", "agentVersion": "2.7.0", "ipAddress": "192.0.2.30", "osName": "Windows"}),
            json!({"deviceId": 1, "deviceName": "fixture-pc"}),
        ),
        shape::<SecurityOverview>(
            "SecurityOverview",
            &[
                "autoBlockEnabled",
                "firewallEnabled",
                "httpsEnabled",
                "advisorScore",
                "blockedIps",
                "certificateInfo",
            ],
            &[
                "autoBlockEnabled",
                "firewallEnabled",
                "httpsEnabled",
                "blockedIps",
            ],
            &["scanStatus", "scanProgress", "lastScanTime", "categories"],
            json!({"autoBlockEnabled": true, "firewallEnabled": false, "httpsEnabled": true, "advisorScore": 90,
                "blockedIps": [{"ip": "198.51.100.9", "blockedAt": "1757894400", "reason": "login"}],
                "certificateInfo": {"id": "fixture", "desc": "synthetic", "subject": {"common_name": "fixture.invalid"}, "issuer": {"common_name": "fixture.invalid"},
                    "validFrom": "Jan  1 00:00:00 2026 GMT", "validTill": "Jan  1 00:00:00 2027 GMT", "isDefault": true, "isBroken": false, "signatureAlgorithm": "sha256WithRSAEncryption"},
                "scanStatus": "done", "scanProgress": 100, "lastScanTime": 1_757_894_400,
                "categories": [{"category": "network", "severity": "warning", "danger": 0, "risk": 1, "warning": 2, "info": 3, "outOfDate": 0}]}),
            json!({}),
        ),
        shape::<SecurityScanCategory>(
            "SecurityScanCategory",
            &[],
            &[],
            &[
                "category",
                "severity",
                "danger",
                "risk",
                "warning",
                "info",
                "outOfDate",
            ],
            json!({"category": "network", "severity": "warning", "danger": 0, "risk": 1, "warning": 2, "info": 3, "outOfDate": 0}),
            json!({"category": "network"}),
        ),
        shape::<BlockedIp>(
            "BlockedIp",
            &["ip", "blockedAt", "reason"],
            &["blockedAt"],
            &[],
            json!({"ip": "198.51.100.9", "blockedAt": "1757894400", "reason": "login"}),
            json!({"ip": "198.51.100.9"}),
        ),
        shape::<AutoBlockConfig>(
            "AutoBlockConfig",
            &[
                "enabled",
                "attempts",
                "withinMinutes",
                "blockForever",
                "expireMinutes",
            ],
            &[],
            &["expireDays"],
            json!({"enabled": true, "attempts": 10, "withinMinutes": 5, "blockForever": false, "expireMinutes": 2880, "expireDays": 2}),
            json!({"enabled": true, "attempts": 10, "withinMinutes": 5, "blockForever": true}),
        ),
        shape::<LogEntry>(
            "LogEntry",
            &["id", "time", "msg", "level", "user", "event", "logType"],
            &["id"],
            &[],
            json!({"id": 7, "time": time, "msg": "synthetic", "level": "info", "user": "fixture-user", "event": "login", "logType": "system"}),
            json!({"time": time, "msg": "synthetic", "level": "info"}),
        ),
        shape::<ConnectionEntry>(
            "ConnectionEntry",
            &["time", "ip", "user", "type", "isLogin", "success"],
            &["isLogin", "success"],
            &["description", "protocol", "canBeKicked"],
            json!({"time": time, "ip": "192.0.2.40", "user": "fixture-user", "type": "HTTP/HTTPS", "isLogin": true, "success": true, "description": "DSM", "protocol": "HTTPS", "canBeKicked": true}),
            json!({"time": time, "ip": "192.0.2.40", "user": "fixture-user", "type": "HTTP/HTTPS"}),
        ),
        // §3.3 A only changes decoding; these keys must not move either.
        shape::<FileStationInfo>(
            "FileStationInfo",
            &[
                "hostname",
                "isManager",
                "supportSharing",
                "supportVirtualProtocol",
            ],
            &[],
            &[],
            json!({"hostname": "fixture-nas", "isManager": true, "supportSharing": true, "supportVirtualProtocol": ["cifs", "iso"]}),
            json!({"hostname": "fixture-nas", "isManager": true, "supportSharing": true}),
        ),
        shape::<DownloadStationInfo>(
            "DownloadStationInfo",
            &["isManager", "version", "versionString"],
            &[],
            &[],
            json!({"isManager": true, "version": "3543", "versionString": "3.8-3543"}),
            json!({"isManager": true, "version": "3543"}),
        ),
    ]
}

fn object_keys(value: &Value) -> BTreeSet<&str> {
    value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect()
}

#[test]
fn widened_and_added_fields_keep_ipc_keys_and_serialize_unknown_values_as_null() {
    let shapes = ipc_shapes();
    let dtos: BTreeSet<_> = shapes.iter().map(|shape| shape.dto).collect();
    assert_eq!(dtos.len(), shapes.len());
    assert_eq!(shapes.len(), 25);

    let (mut widened, mut added) = (0, 0);
    for shape in &shapes {
        let dto = shape.dto;
        let expected: BTreeSet<&str> = shape.keys.iter().chain(shape.added).copied().collect();
        assert_eq!(
            expected.len(),
            shape.keys.len() + shape.added.len(),
            "{dto}: added keys are new and keys are unique"
        );
        for key in shape.widened {
            assert!(shape.keys.contains(key), "{dto}.{key} keeps its key");
            assert!(
                shape.required.get(*key).is_none(),
                "{dto}.{key} is optional"
            );
        }

        let full = (shape.round_trip)(shape.full.clone())
            .unwrap_or_else(|error| panic!("{dto} full: {error}"));
        assert_eq!(full, shape.full, "{dto}: every populated value survives");
        assert_eq!(object_keys(&full), expected, "{dto}: IPC keys");

        let unknown = (shape.round_trip)(shape.required.clone())
            .unwrap_or_else(|error| panic!("{dto} required: {error}"));
        let mut nulls = shape.required.as_object().unwrap().clone();
        for key in &expected {
            nulls.entry(*key).or_insert(Value::Null);
        }
        // Present with `null`, never an omitted key.
        assert_eq!(unknown, Value::Object(nulls), "{dto}: unknown values");
        for key in shape.widened.iter().chain(shape.added) {
            if shape.required.get(*key).is_none() {
                assert!(unknown.get(*key).is_some_and(Value::is_null), "{dto}.{key}");
            }
        }
        widened += shape.widened.len();
        added += shape.added.len();
    }
    // §3.3 B1-B25 widen 36 fields; §3.3 C adds 11 fields plus the 7-field
    // `SecurityScanCategory`.
    assert_eq!(widened, 36);
    assert_eq!(added, 18);
}

#[test]
fn widened_fields_accept_missing_and_null_dsm_values() {
    // A few DSM rows as they arrive, snake_case and without the widened keys.
    let user: SynoUser =
        serde_json::from_value(json!({"name": "fixture-user", "description": ""})).unwrap();
    assert_eq!(user.uid, None);
    let group: SynoGroup =
        serde_json::from_value(json!({"name": "administrators", "gid": 101, "description": null}))
            .unwrap();
    assert_eq!(group.members, None);
    let entry: ConnectionEntry = serde_json::from_value(
        json!({"time": "2026/09/15 12:00:00", "ip": "192.0.2.40", "user": "fixture-user", "type": "HTTP/HTTPS", "is_login": null, "can_be_kicked": true}),
    )
    .unwrap();
    assert_eq!((entry.is_login, entry.success), (None, None));
    assert_eq!(entry.can_be_kicked, Some(true));
    let device: ActiveBackupDevice = serde_json::from_value(
        json!({"device_id": 3, "device_name": "fixture-pc", "os_name": "Windows"}),
    )
    .unwrap();
    assert_eq!(device.os_name.as_deref(), Some("Windows"));
    let config: AutoBlockConfig = serde_json::from_value(
        json!({"enabled": true, "attempts": 10, "within_minutes": 5, "block_forever": true, "expire_days": 0}),
    )
    .unwrap();
    assert_eq!(config.expire_days, Some(0));
    let category: SecurityScanCategory =
        serde_json::from_value(json!({"category": "update", "out_of_date": 1})).unwrap();
    assert_eq!(category.out_of_date, Some(1));
    // Still required: a group without its id is not a row.
    assert!(serde_json::from_value::<SynoGroup>(json!({"name": "administrators"})).is_err());
}
