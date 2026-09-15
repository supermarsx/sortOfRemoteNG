//! Owned by t84-e12k: `logs.rs` decoders for system log items and current
//! connections (addendum §4 L5).

use super::*;

const SYSLOG: &str = "SYNO.Core.SyslogClient.Log";
const CURRENT_CONNECTION: &str = "SYNO.Core.CurrentConnection";

// ── Fixtures ────────────────────────────────────────────────────────

/// `systemLogs` read.
// shape: vcf-content-factory api-maps/synology-events.md [observed DSM 7.3.2] (MIT); dsm_helper Core/SyslogClient/Log.dart (Apache-2.0)
pub(super) fn real_system_logs() -> Value {
    json!({
        "errorCount": 0,
        "infoCount": 1,
        "items": [
            {"descr": "System successfully finished filesystem scrubbing on [Volume 1].", "level": "info", "logtype": "System", "orginalLogType": "system", "time": "2026/04/06 06:23:51", "who": "SYSTEM"},
            {"descr": "User [fixture-user-a] failed to sign in from [192.0.2.30].", "level": "warn", "logtype": "Connection", "orginalLogType": "connection", "time": "2026/04/06 06:20:02", "who": "fixture-user-a"}
        ],
        "total": 4660,
        "warnCount": 1
    })
}

/// `connectionLogs` read (active sessions).
// shape: pmilano1/synology-dsm-api docs/api-reference/probed/core-other.md [probed DSM 7.4] (MIT); dsm_helper Core/CurrentConnection.dart (Apache-2.0)
pub(super) fn real_connection_logs() -> Value {
    json!({
        "items": [
            {"can_be_kicked": true, "descr": "DiskStation Manager", "did": "", "from": "192.0.2.30", "is_otp_trusted": false, "location": "", "pid": 1, "protocol": "HTTP/HTTPS", "time": "2026/09/14 17:57:20", "type": "HTTP/HTTPS", "user_can_be_disabled": true, "who": "fixture-admin"},
            {"can_be_kicked": false, "descr": "", "from": "198.51.100.4", "pid": 2, "protocol": "SMB", "time": "2026/09/14 18:02:11", "type": "SMB", "user_can_be_disabled": false, "who": "fixture-user-a"}
        ],
        "systime": "Mon Sep 15 09:21:30 2026\n",
        "total": 2
    })
}

fn without(mut row: Value, key: &str) -> Value {
    row.as_object_mut().unwrap().remove(key);
    row
}

fn assert_requests(nas: &Nas, api: &str, version: u32, count: usize) {
    assert_eq!(nas.requests().len(), count);
    for index in 0..count {
        assert_eq!(request_api(nas, index), api);
        assert_eq!(request_method(nas, index), "list");
        assert_eq!(request_version(nas, index), version);
    }
}

// ── System logs ─────────────────────────────────────────────────────

#[tokio::test]
async fn system_logs_decode_dsm_items_and_send_the_log_selection() {
    let first = real_system_logs()["items"][0].clone();
    let original_only = without(without(first.clone(), "logtype"), "who");
    let (service, nas) = service_with(
        &[(SYSLOG, 1)],
        vec![
            ok(real_system_logs()),
            ok(json!({"items": [original_only], "total": 1})),
            ok(json!({"items": [], "total": 0})),
            // Regression: a bare row array (api_list passes it through).
            ok(json!([first])),
        ],
    )
    .await;

    let logs = service.get_system_logs(40, 20).await.unwrap();
    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0].id, None);
    assert_eq!(logs[0].time, "2026/04/06 06:23:51");
    assert_eq!(
        logs[0].msg,
        "System successfully finished filesystem scrubbing on [Volume 1]."
    );
    assert_eq!(logs[0].level, "info");
    assert_eq!(logs[0].user.as_deref(), Some("SYSTEM"));
    assert_eq!(logs[0].event, None);
    assert_eq!(logs[0].log_type.as_deref(), Some("System"));
    assert_eq!(logs[1].level, "warn");
    assert_eq!(logs[1].user.as_deref(), Some("fixture-user-a"));
    assert_eq!(
        serde_json::to_value(&logs[0]).unwrap(),
        json!({"id": null, "time": "2026/04/06 06:23:51", "msg": "System successfully finished filesystem scrubbing on [Volume 1].", "level": "info", "user": "SYSTEM", "event": null, "logType": "System"})
    );

    let fallback = service.get_system_logs(0, 1).await.unwrap();
    assert_eq!(fallback[0].log_type.as_deref(), Some("system"));
    assert_eq!(fallback[0].user, None);
    assert!(service.get_system_logs(0, 50).await.unwrap().is_empty());
    let bare = service.get_system_logs(0, 50).await.unwrap();
    assert_eq!(bare[0].time, "2026/04/06 06:23:51");

    assert_requests(&nas, SYSLOG, 1, 4);
    // `start` and `offset` both carry the offset; string params are JSON-quoted.
    assert_eq!(request_field(&nas, 0, "start").as_deref(), Some("40"));
    assert_eq!(request_field(&nas, 0, "offset").as_deref(), Some("40"));
    assert_eq!(request_field(&nas, 0, "limit").as_deref(), Some("20"));
    assert_eq!(request_field(&nas, 1, "start").as_deref(), Some("0"));
    assert_eq!(request_field(&nas, 1, "limit").as_deref(), Some("1"));
    for index in 0..4 {
        assert_eq!(
            request_field(&nas, index, "target").as_deref(),
            Some(r#""LOCAL""#)
        );
        assert_eq!(
            request_field(&nas, index, "logtype").as_deref(),
            Some(r#""system""#)
        );
    }
}

#[tokio::test]
async fn system_logs_send_raw_selection_to_plain_form_apis() {
    let (service, nas) =
        service_with_format(&[(SYSLOG, 1, None)], vec![ok(real_system_logs())]).await;

    assert_eq!(service.get_system_logs(5, 10).await.unwrap().len(), 2);
    assert_requests(&nas, SYSLOG, 1, 1);
    assert_eq!(request_field(&nas, 0, "start").as_deref(), Some("5"));
    assert_eq!(request_field(&nas, 0, "offset").as_deref(), Some("5"));
    assert_eq!(request_field(&nas, 0, "limit").as_deref(), Some("10"));
    assert_eq!(request_field(&nas, 0, "target").as_deref(), Some("LOCAL"));
    assert_eq!(request_field(&nas, 0, "logtype").as_deref(), Some("system"));
}

#[tokio::test]
async fn system_log_rows_without_time_never_reach_the_renderer() {
    let row = real_system_logs()["items"][0].clone();
    let mut null_time = row.clone();
    null_time["time"] = Value::Null;
    let (service, nas) = service_with(
        &[(SYSLOG, 1)],
        vec![
            // One good row and one without `time`: the whole read fails.
            ok(json!({"items": [row.clone(), without(row.clone(), "time")], "total": 2})),
            ok(json!({"items": [null_time], "total": 1})),
            ok(json!({"items": [without(row.clone(), "descr")], "total": 1})),
            ok(json!({"items": [without(row, "level")], "total": 1})),
            ok(json!({"total": 4660, "infoCount": 0})),
            // The old DTO-shaped rows: `id`/`msg` instead of DSM's keys.
            ok(json!([{"id": 1, "time": "2026/04/06 06:23:51", "msg": "old shape", "level": "info"}])),
        ],
    )
    .await;

    for _ in 0..6 {
        let error = service.get_system_logs(0, 50).await.unwrap_err();
        assert_schema_failure(&error);
    }
    assert_requests(&nas, SYSLOG, 1, 6);
}

// ── Current connections ─────────────────────────────────────────────

#[tokio::test]
async fn connections_decode_active_sessions_for_both_commands() {
    let first = real_connection_logs()["items"][0].clone();
    let minimal = without(
        without(without(first.clone(), "descr"), "protocol"),
        "can_be_kicked",
    );
    let (service, nas) = service_with(
        &[(CURRENT_CONNECTION, 3)],
        vec![
            ok(real_connection_logs()),
            ok(real_connection_logs()),
            ok(json!({"items": [minimal], "total": 1})),
            // Regression: a bare row array.
            ok(json!([first])),
        ],
    )
    .await;

    let logs = service.get_connection_logs(10, 25).await.unwrap();
    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0].time, "2026/09/14 17:57:20");
    assert_eq!(logs[0].ip, "192.0.2.30");
    assert_eq!(logs[0].user, "fixture-admin");
    assert_eq!(logs[0].r#type, "HTTP/HTTPS");
    assert_eq!(logs[0].description.as_deref(), Some("DiskStation Manager"));
    assert_eq!(logs[0].protocol.as_deref(), Some("HTTP/HTTPS"));
    assert_eq!(logs[0].can_be_kicked, Some(true));
    assert_eq!(logs[0].is_login, None);
    assert_eq!(logs[0].success, None);
    assert_eq!(logs[1].ip, "198.51.100.4");
    assert_eq!(logs[1].user, "fixture-user-a");
    assert_eq!(logs[1].can_be_kicked, Some(false));
    assert_eq!(
        serde_json::to_value(&logs[0]).unwrap(),
        json!({"time": "2026/09/14 17:57:20", "ip": "192.0.2.30", "user": "fixture-admin", "type": "HTTP/HTTPS", "isLogin": null, "success": null, "description": "DiskStation Manager", "protocol": "HTTP/HTTPS", "canBeKicked": true})
    );

    let active = service.get_active_connections().await.unwrap();
    assert_eq!(active.len(), 2);
    assert_eq!(active[1].r#type, "SMB");
    let sparse = service.get_active_connections().await.unwrap();
    assert_eq!(sparse[0].ip, "192.0.2.30");
    assert_eq!(sparse[0].description, None);
    assert_eq!(sparse[0].protocol, None);
    assert_eq!(sparse[0].can_be_kicked, None);
    let bare = service.get_connection_logs(0, 1).await.unwrap();
    assert_eq!(bare[0].user, "fixture-admin");

    // The managers clamp to version 2 of a NAS offering 3.
    assert_requests(&nas, CURRENT_CONNECTION, 2, 4);
    assert_eq!(request_field(&nas, 0, "offset").as_deref(), Some("10"));
    assert_eq!(request_field(&nas, 0, "limit").as_deref(), Some("25"));
    for index in [1, 2] {
        assert_eq!(request_field(&nas, index, "offset"), None);
        assert_eq!(request_field(&nas, index, "limit"), None);
    }
    assert_eq!(request_field(&nas, 3, "offset").as_deref(), Some("0"));
}

#[tokio::test]
async fn connection_rows_need_time_address_user_and_type() {
    let row = real_connection_logs()["items"][0].clone();
    let (service, nas) = service_with(
        &[(CURRENT_CONNECTION, 1)],
        vec![
            ok(json!({"items": [without(row.clone(), "time")], "total": 1})),
            ok(json!({"items": [without(row.clone(), "from")], "total": 1})),
            ok(json!({"items": [without(row.clone(), "who")], "total": 1})),
            ok(json!({"items": [without(row, "type")], "total": 1})),
            ok(json!({"systime": "Mon Sep 15 09:21:30 2026\n", "total": 0})),
            // The old DTO-shaped rows: `ip`/`user` instead of `from`/`who`.
            ok(json!([{"time": "2026/09/14 17:57:20", "ip": "192.0.2.30", "user": "fixture-admin", "type": "HTTP/HTTPS", "isLogin": true, "success": true}])),
        ],
    )
    .await;

    for index in 0..6 {
        let error = if index % 2 == 0 {
            service.get_connection_logs(0, 50).await.unwrap_err()
        } else {
            service.get_active_connections().await.unwrap_err()
        };
        assert_schema_failure(&error);
    }
    assert_requests(&nas, CURRENT_CONNECTION, 1, 6);
}

// ── Refusals ────────────────────────────────────────────────────────

#[tokio::test]
async fn log_reads_keep_dsm_refusals() {
    let (service, nas) = service_with(
        &[(SYSLOG, 1), (CURRENT_CONNECTION, 2)],
        vec![dsm_error(105), dsm_error(105), dsm_error(120)],
    )
    .await;

    let system = service.get_system_logs(0, 50).await.unwrap_err();
    assert!(
        matches!(system.kind, SynologyErrorKind::PermissionDenied),
        "{system}"
    );
    assert_dsm_failure(&system, 105);
    assert_eq!(
        system.to_string().lines().next(),
        Some("SYNO.Core.SyslogClient.Log: requires a DSM administrator account (code 105)")
    );

    let connections = service.get_connection_logs(0, 50).await.unwrap_err();
    assert!(
        matches!(connections.kind, SynologyErrorKind::PermissionDenied),
        "{connections}"
    );
    assert_dsm_failure(&connections, 105);

    let rejected = service.get_active_connections().await.unwrap_err();
    assert!(
        matches!(rejected.kind, SynologyErrorKind::ApiError(120)),
        "{rejected}"
    );
    assert_dsm_failure(&rejected, 120);

    assert_eq!(request_api(&nas, 0), SYSLOG);
    assert_eq!(request_api(&nas, 1), CURRENT_CONNECTION);
    assert_eq!(request_api(&nas, 2), CURRENT_CONNECTION);
    assert_eq!(nas.requests().len(), 3);
}
