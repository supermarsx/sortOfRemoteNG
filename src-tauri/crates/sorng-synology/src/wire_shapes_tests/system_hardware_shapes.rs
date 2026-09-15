//! Owned by t84-e12b: `SYNO.Core.System.Process list`,
//! `SYNO.Core.ExternalDevice.UPS get` and `SYNO.Core.Hardware.PowerSchedule load`
//! decoded from DSM's real shapes into the unchanged IPC DTOs.
//!
//! Legacy compatibility is kept only where DSM itself varies: process lists
//! decode bare or wrapped. The old flat UPS (`enabled`, `batteryCharge`) and
//! power schedule (`enabled`, `entries`) shapes are not accepted: no evidence
//! shows DSM ever sending them, so they were never a real wire format.

use super::*;

const PROCESS: &str = "SYNO.Core.System.Process";
const UPS: &str = "SYNO.Core.ExternalDevice.UPS";
const POWER_SCHEDULE: &str = "SYNO.Core.Hardware.PowerSchedule";

// ── Fixtures ────────────────────────────────────────────────────────

/// `processes` admin action (`syn_list_processes`).
// shape: pmilano1/synology-dsm-api docs/api-reference/probed/core-system.md [probed DSM 7.4] (MIT)
pub(super) fn real_processes() -> Value {
    json!({"process": [
        {"command": "/usr/syno/sbin/synoscgi", "cpu": 1, "mem": 20480, "mem_shared": 4096, "pid": 1234, "status": "S"},
        {"command": "fixture-worker", "cpu": 0.5, "mem": 0, "mem_shared": 0, "pid": 1, "status": "R"}
    ]})
}

/// `upsInfo` read, no UPS attached.
// shape: vcf-content-factory api-maps/synology-ups.md [observed DSM 7.3.2]; pmilano1 probed core-externaldevice.md [DSM 7.4] (MIT)
pub(super) fn real_ups_info() -> Value {
    json!({
        "ACL_enable": false, "ACL_list": [], "charge": 0, "delay_time": -1, "enable": false,
        "manufacture": "", "mode": "SLAVE", "model": "", "net_server_ip": "", "runtime": 0,
        "shutdown_device": false, "snmp_auth": false, "snmp_community": "", "snmp_server_ip": "",
        "snmp_version": "", "status": "usb_ups_status_unknown", "usb_ups_connect": false
    })
}

/// `powerSchedule` read.
// shape: N4S4/synology-api event_scheduler.py load_power_schedule example (MIT); dsm_helper pages/control_panel/power/power.dart (Apache-2.0)
pub(super) fn real_power_schedule() -> Value {
    json!({
        "poweroff_tasks": [{"enabled": true, "hour": 23, "min": 30, "weekdays": "0,6"}],
        "poweron_tasks": [{"enabled": true, "hour": 7, "min": 0, "weekdays": "1,2,3,4,5"}]
    })
}

fn assert_requests(nas: &Nas, api: &str, method: &str) {
    let count = nas.requests().len();
    assert!(count > 0);
    for index in 0..count {
        assert_eq!(request_api(nas, index), api);
        assert_eq!(request_method(nas, index), method);
        assert_eq!(request_version(nas, index), 1);
        assert_eq!(
            request_field(nas, index, "_sid").as_deref(),
            Some("fixture-sid")
        );
    }
}

// ── Processes ───────────────────────────────────────────────────────

#[tokio::test]
async fn processes_decode_the_probed_envelope_without_inventing_an_owner() {
    let bare = real_processes()["process"].clone();
    let (service, nas) = service_with(
        &[(PROCESS, 1)],
        vec![
            ok(real_processes()),
            // Regression: a bare row array still decodes.
            ok(bare),
            ok(json!({"total": 2})),
            ok(json!({"process": [{"pid": 7, "cpu": 0, "mem": 0, "status": "S"}]})),
            dsm_error(105),
        ],
    )
    .await;

    let rows = service.list_processes().await.unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].pid, 1234);
    assert_eq!(rows[0].name, "/usr/syno/sbin/synoscgi");
    assert_eq!(rows[0].cpu, 1.0);
    assert_eq!(rows[0].memory, 20_480.0);
    assert_eq!(rows[0].user, None);
    assert_eq!(rows[0].threads, None);
    assert_eq!(rows[1].cpu, 0.5);
    assert_eq!(
        serde_json::to_value(&rows[0]).unwrap(),
        json!({"pid": 1234, "name": "/usr/syno/sbin/synoscgi", "user": null, "cpu": 1.0, "memory": 20480.0, "threads": null})
    );

    let bare = service.list_processes().await.unwrap();
    assert_eq!(bare.len(), 2);
    assert_eq!(bare[1].name, "fixture-worker");

    // A missing `process` envelope and a row without `command` are schema failures.
    assert_schema_failure(&service.list_processes().await.unwrap_err());
    assert_schema_failure(&service.list_processes().await.unwrap_err());

    let denied = service.list_processes().await.unwrap_err();
    assert!(
        matches!(denied.kind, SynologyErrorKind::PermissionDenied),
        "{denied}"
    );
    assert_dsm_failure(&denied, 105);

    assert_eq!(nas.requests().len(), 5);
    assert_requests(&nas, PROCESS, "list");
}

// ── UPS ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn ups_maps_enable_and_reports_battery_only_for_a_live_ups() {
    // shape: vcf-content-factory synology-ups.md field set, UPS attached (values synthetic) (MIT)
    let connected = json!({
        "charge": 100, "enable": true, "mode": "MASTER", "model": "FIXTURE-UPS 1500",
        "runtime": 3600, "status": "usb_ups_status_online", "usb_ups_connect": true
    });
    let mut usb_only = real_ups_info();
    usb_only["usb_ups_connect"] = json!(true);
    usb_only["charge"] = json!(87.5);
    usb_only["runtime"] = json!("-1");
    let mut without_enable = real_ups_info();
    without_enable.as_object_mut().unwrap().remove("enable");
    let (service, nas) = service_with(
        &[(UPS, 1)],
        vec![
            ok(real_ups_info()),
            ok(connected),
            ok(usb_only),
            ok(without_enable),
            ok(json!({"enable": true})),
        ],
    )
    .await;

    let idle = service.get_ups_info().await.unwrap();
    assert!(!idle.enabled);
    assert_eq!(idle.status, "usb_ups_status_unknown");
    assert_eq!(idle.model, None);
    assert_eq!(idle.battery_charge, None);
    assert_eq!(idle.runtime_minutes, None);
    assert_eq!(idle.load_percent, None);
    assert_eq!(idle.server_type.as_deref(), Some("SLAVE"));
    assert_eq!(
        serde_json::to_value(&idle).unwrap(),
        json!({"enabled": false, "model": null, "status": "usb_ups_status_unknown", "batteryCharge": null, "loadPercent": null, "runtimeMinutes": null, "serverType": "SLAVE"})
    );

    let live = service.get_ups_info().await.unwrap();
    assert!(live.enabled);
    assert_eq!(live.model.as_deref(), Some("FIXTURE-UPS 1500"));
    assert_eq!(live.battery_charge, Some(100.0));
    assert_eq!(live.runtime_minutes, Some(60));
    assert_eq!(live.server_type.as_deref(), Some("MASTER"));

    // Connected over USB but not enabled: the charge is real; a negative
    // runtime placeholder is not a duration.
    let usb = service.get_ups_info().await.unwrap();
    assert!(!usb.enabled);
    assert_eq!(usb.battery_charge, Some(87.5));
    assert_eq!(usb.runtime_minutes, None);

    // `enable` and `status` are required DSM fields.
    assert_schema_failure(&service.get_ups_info().await.unwrap_err());
    assert_schema_failure(&service.get_ups_info().await.unwrap_err());

    assert_eq!(nas.requests().len(), 5);
    assert_requests(&nas, UPS, "get");
}

// ── Power schedule ──────────────────────────────────────────────────

#[tokio::test]
async fn power_schedule_lists_power_on_then_power_off_tasks() {
    let (service, nas) = service_with(
        &[(POWER_SCHEDULE, 1)],
        vec![
            ok(real_power_schedule()),
            ok(json!({})),
            ok(json!({"poweron_tasks": [{"enabled": false, "hour": 6, "min": 15, "weekdays": ""}], "poweroff_tasks": []})),
            ok(json!({"poweron_tasks": [{"enabled": true, "hour": 7, "min": 0, "weekdays": "1,x"}]})),
            ok(json!({"poweroff_tasks": [{"enabled": true, "min": 0, "weekdays": "1"}]})),
            json!({"success": true}),
        ],
    )
    .await;

    let schedule = service.get_power_schedule().await.unwrap();
    assert!(schedule.enabled);
    assert_eq!(schedule.entries.len(), 2);
    let on = &schedule.entries[0];
    assert_eq!(on.action, "poweron");
    assert_eq!((on.hour, on.minute), (7, 0));
    assert_eq!(on.weekday, [1, 2, 3, 4, 5]);
    assert!(on.enabled);
    let off = &schedule.entries[1];
    assert_eq!(off.action, "poweroff");
    assert_eq!((off.hour, off.minute), (23, 30));
    assert_eq!(off.weekday, [0, 6]);
    assert_eq!(
        serde_json::to_value(off).unwrap(),
        json!({"action": "poweroff", "hour": 23, "minute": 30, "weekday": [0, 6], "enabled": true})
    );

    let empty = service.get_power_schedule().await.unwrap();
    assert!(!empty.enabled);
    assert!(empty.entries.is_empty());

    let disabled = service.get_power_schedule().await.unwrap();
    assert!(!disabled.enabled);
    assert_eq!(disabled.entries.len(), 1);
    assert!(disabled.entries[0].weekday.is_empty());

    // An unparsable weekday, a task without `hour` and a reply without data
    // are schema failures, never a partial schedule.
    for _ in 0..3 {
        assert_schema_failure(&service.get_power_schedule().await.unwrap_err());
    }

    assert_eq!(nas.requests().len(), 6);
    assert_requests(&nas, POWER_SCHEDULE, "load");
}
