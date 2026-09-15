//! Owned by t84-e12j: `security.rs` decoders for the Security Advisor status,
//! auto block settings, blocked addresses and certificates (addendum §4 L5).

use super::*;

const SCAN_STATUS: &str = "SYNO.Core.SecurityScan.Status";
const AUTO_BLOCK: &str = "SYNO.Core.Security.AutoBlock";
const AUTO_BLOCK_RULES: &str = "SYNO.Core.Security.AutoBlock.Rules";
const CERTIFICATE: &str = "SYNO.Core.Certificate.CRT";

// ── Fixtures ────────────────────────────────────────────────────────

fn scan_item(category: &str, severity: &str, fail: Value) -> Value {
    json!({"category": category, "fail": fail, "failSeverity": severity, "progress": 100, "runningItem": "", "total": 3, "waitNum": 0})
}

fn clean() -> Value {
    json!({"danger": 0, "info": 0, "outOfDate": 0, "risk": 0, "warning": 0})
}

/// `securityOverview` read.
// shape: py-synologydsm-api tests/api_data/dsm_6/core/const_6_core_security.py (MIT)
pub(super) fn real_security_overview() -> Value {
    json!({
        "items": {
            "malware": scan_item("malware", "safe", clean()),
            "network": scan_item("network", "safe", clean()),
            "securitySetting": scan_item("securitySetting", "risk", json!({"danger": 0, "info": 1, "outOfDate": 0, "risk": 2, "warning": 0})),
            "systemCheck": scan_item("systemCheck", "safe", clean()),
            "update": scan_item("update", "outOfDate", json!({"danger": 0, "info": 0, "outOfDate": 1, "risk": 0, "warning": 0})),
            "userInfo": scan_item("userInfo", "warning", json!({"danger": 0, "info": 0, "outOfDate": 0, "risk": 0, "warning": 3}))
        },
        "lastScanTime": "1757894400",
        "startTime": "",
        "success": true,
        "sysProgress": 100,
        "sysStatus": "risk"
    })
}

/// `autoBlockConfig` read (`expire_day: 0` = block forever).
// shape: pmilano1/synology-dsm-api docs/api-reference/probed/core-security.md [probed DSM 7.4]; keys as in KastnerRG/krg-infra synology_security role (MIT)
pub(super) fn real_auto_block_config() -> Value {
    json!({"attempts": 10, "enable": true, "expire_day": 0, "within_mins": 5})
}

/// `blockedIps` read. No public success capture exists (audit S§7 #1): the
/// envelope and row keys are the lenient decoder's assumption.
// shape: synthetic, per addendum §4 L5 (AutoBlock.Rules list answers 5100 without params: probed core-security.md, KastnerRG (MIT))
pub(super) fn real_blocked_ips() -> Value {
    json!({"ip_info": [{"ip": "198.51.100.9", "recordtime": 1_757_894_400}], "total": 1})
}

/// `certificates` read.
// shape: field names from tailscale cmd/tailscale/cli/configure-synology-cert.go (BSD-3-Clause) and certimate pkg/sdk3rd/synologydsm/models.go (MIT); values synthetic
pub(super) fn real_certificates() -> Value {
    json!({
        "certificates": [{
            "desc": "",
            "id": "SYNTHcrt01",
            "is_broken": false,
            "is_default": true,
            "issuer": {"common_name": "Fixture CA", "country": "ZZ", "organization": "Fixture Org"},
            "renewable": false,
            "services": [{"display_name": "DSM Desktop Service", "isPkg": false, "owner": "root", "service": "default", "subscriber": "system"}],
            "signature_algorithm": "sha256WithRSAEncryption",
            "subject": {"common_name": "nas.example.invalid", "sub_alt_name": ["nas.example.invalid"]},
            "valid_from": "Nov  1 00:00:00 2025 GMT",
            "valid_till": "Nov  1 23:59:59 2026 GMT"
        }]
    })
}

fn assert_requests(nas: &Nas, api: &str, method: &str, count: usize) {
    assert_eq!(nas.requests().len(), count);
    for index in 0..count {
        assert_eq!(request_api(nas, index), api);
        assert_eq!(request_method(nas, index), method);
        assert_eq!(request_version(nas, index), 1);
    }
}

// ── Security Advisor status ─────────────────────────────────────────

#[tokio::test]
async fn security_overview_decodes_the_advisor_status_and_its_categories() {
    let mut numeric_time = real_security_overview();
    numeric_time["lastScanTime"] = json!(1_757_894_400);
    let never_scanned =
        json!({"items": {}, "lastScanTime": "", "sysProgress": 0, "sysStatus": "outOfDate"});
    let (service, nas) = service_with(
        &[(SCAN_STATUS, 1)],
        vec![
            ok(real_security_overview()),
            ok(numeric_time),
            ok(never_scanned),
            ok(json!({"sysStatus": "safe"})),
        ],
    )
    .await;

    let overview = service.get_security_overview().await.unwrap();
    assert_eq!(overview.scan_status.as_deref(), Some("risk"));
    assert_eq!(overview.scan_progress, Some(100));
    assert_eq!(overview.last_scan_time, Some(1_757_894_400));
    // This API does not report them: unknown, never `false` or an empty list.
    assert_eq!(overview.auto_block_enabled, None);
    assert_eq!(overview.firewall_enabled, None);
    assert_eq!(overview.https_enabled, None);
    assert_eq!(overview.advisor_score, None);
    assert!(overview.blocked_ips.is_none());
    assert!(overview.certificate_info.is_none());
    let categories = overview.categories.as_ref().unwrap();
    let names: Vec<_> = categories
        .iter()
        .map(|category| category.category.as_str())
        .collect();
    assert_eq!(
        names,
        [
            "malware",
            "network",
            "securitySetting",
            "systemCheck",
            "update",
            "userInfo"
        ]
    );
    assert_eq!(categories[2].severity.as_deref(), Some("risk"));
    assert_eq!(categories[2].risk, Some(2));
    assert_eq!(categories[2].info, Some(1));
    assert_eq!(categories[4].out_of_date, Some(1));
    assert_eq!(categories[5].warning, Some(3));

    let ipc = serde_json::to_value(&overview).unwrap();
    for key in [
        "autoBlockEnabled",
        "firewallEnabled",
        "httpsEnabled",
        "advisorScore",
        "blockedIps",
        "certificateInfo",
    ] {
        assert_eq!(ipc[key], Value::Null, "{key}");
    }
    assert_eq!(ipc["scanStatus"], "risk");
    assert_eq!(ipc["scanProgress"], 100);
    assert_eq!(ipc["lastScanTime"], 1_757_894_400);
    assert_eq!(
        ipc["categories"][4],
        json!({"category": "update", "severity": "outOfDate", "danger": 0, "risk": 0, "warning": 0, "info": 0, "outOfDate": 1})
    );

    let numeric = service.get_security_overview().await.unwrap();
    assert_eq!(numeric.last_scan_time, Some(1_757_894_400));
    let never = service.get_security_overview().await.unwrap();
    assert_eq!(never.last_scan_time, None);
    assert_eq!(never.scan_progress, Some(0));
    assert!(never.categories.unwrap().is_empty());
    let status_only = service.get_security_overview().await.unwrap();
    assert_eq!(status_only.scan_status.as_deref(), Some("safe"));
    assert!(status_only.categories.is_none());

    assert_requests(&nas, SCAN_STATUS, "system_get", 4);
    assert_eq!(request_field(&nas, 0, "offset"), None);
}

#[tokio::test]
async fn security_overview_rejects_bodies_that_are_not_an_advisor_status() {
    let mut listed_items = real_security_overview();
    listed_items["items"] = json!([scan_item("malware", "safe", clean())]);
    let mut fractional_progress = real_security_overview();
    fractional_progress["sysProgress"] = json!(12.5);
    let (service, nas) = service_with(
        &[(SCAN_STATUS, 1)],
        vec![
            // The DTO shape the old decoder expected is not DSM's answer.
            ok(json!({"autoBlockEnabled": true, "firewallEnabled": true, "httpsEnabled": true, "blockedIps": []})),
            ok(json!({})),
            json!({"success": true}),
            ok(listed_items),
            ok(fractional_progress),
        ],
    )
    .await;

    for _ in 0..5 {
        assert_schema_failure(&service.get_security_overview().await.unwrap_err());
    }
    assert_requests(&nas, SCAN_STATUS, "system_get", 5);
}

// ── Auto block ──────────────────────────────────────────────────────

#[tokio::test]
async fn auto_block_expire_day_zero_is_a_permanent_block() {
    let mut two_days = real_auto_block_config();
    two_days["expire_day"] = json!(2);
    two_days["enable"] = json!(false);
    let (service, nas) = service_with(
        &[(AUTO_BLOCK, 1)],
        vec![ok(real_auto_block_config()), ok(two_days)],
    )
    .await;

    let forever = service.get_auto_block_config().await.unwrap();
    assert!(forever.enabled);
    assert_eq!(forever.attempts, 10);
    assert_eq!(forever.within_minutes, 5);
    assert!(forever.block_forever);
    assert_eq!(forever.expire_days, Some(0));
    assert_eq!(forever.expire_minutes, None);
    assert_eq!(
        serde_json::to_value(&forever).unwrap(),
        json!({"enabled": true, "attempts": 10, "withinMinutes": 5, "blockForever": true, "expireMinutes": null, "expireDays": 0})
    );

    let expiring = service.get_auto_block_config().await.unwrap();
    assert!(!expiring.enabled);
    assert!(!expiring.block_forever);
    assert_eq!(expiring.expire_days, Some(2));
    assert_eq!(expiring.expire_minutes, Some(2880));

    assert_requests(&nas, AUTO_BLOCK, "get", 2);
}

#[tokio::test]
async fn auto_block_requires_every_setting_dsm_sends() {
    let mut without_window = real_auto_block_config();
    without_window
        .as_object_mut()
        .unwrap()
        .remove("within_mins");
    let mut without_expiry = real_auto_block_config();
    without_expiry.as_object_mut().unwrap().remove("expire_day");
    let mut text_flag = real_auto_block_config();
    text_flag["enable"] = json!("maybe");
    let (service, nas) = service_with(
        &[(AUTO_BLOCK, 1)],
        vec![
            ok(without_window),
            ok(without_expiry),
            ok(text_flag),
            // The old DTO-shaped body: none of DSM's keys.
            ok(json!({"enabled": true, "attempts": 10, "withinMinutes": 5, "blockForever": true})),
            json!({"success": true}),
        ],
    )
    .await;

    for _ in 0..5 {
        assert_schema_failure(&service.get_auto_block_config().await.unwrap_err());
    }
    assert_requests(&nas, AUTO_BLOCK, "get", 5);
}

// ── Blocked addresses ───────────────────────────────────────────────

#[tokio::test]
async fn blocked_ips_send_list_parameters_and_decode_rule_rows() {
    let (service, nas) = service_with(
        &[(AUTO_BLOCK_RULES, 1)],
        vec![
            ok(real_blocked_ips()),
            ok(json!({"items": [
                {"ip": "198.51.100.10", "blocked_at": "2026/09/14 17:57:20", "reason": "login failures"},
                {"ip": "198.51.100.11", "time": 1_757_894_401, "meta": "manual"},
                {"ip": "2001:db8::1", "recordtime": "", "reason": ""}
            ], "total": 3})),
            ok(json!({"rules": [{"ip": "198.51.100.12"}]})),
            // Regression: a bare row array (api_list passes it through).
            ok(json!([{"ip": "198.51.100.13", "recordtime": "1757894402"}])),
        ],
    )
    .await;

    let blocked = service.list_blocked_ips().await.unwrap();
    assert_eq!(blocked.len(), 1);
    assert_eq!(blocked[0].ip, "198.51.100.9");
    assert_eq!(blocked[0].blocked_at.as_deref(), Some("1757894400"));
    assert_eq!(blocked[0].reason, None);
    assert_eq!(
        serde_json::to_value(&blocked).unwrap(),
        json!([{"ip": "198.51.100.9", "blockedAt": "1757894400", "reason": null}])
    );

    let items = service.list_blocked_ips().await.unwrap();
    assert_eq!(items.len(), 3);
    assert_eq!(items[0].blocked_at.as_deref(), Some("2026/09/14 17:57:20"));
    assert_eq!(items[0].reason.as_deref(), Some("login failures"));
    assert_eq!(items[1].blocked_at.as_deref(), Some("1757894401"));
    assert_eq!(items[1].reason.as_deref(), Some("manual"));
    // Empty strings are unknown values, not times or reasons.
    assert_eq!(items[2].blocked_at, None);
    assert_eq!(items[2].reason, None);

    let rules = service.list_blocked_ips().await.unwrap();
    assert_eq!(rules[0].ip, "198.51.100.12");
    assert_eq!(rules[0].blocked_at, None);
    let bare = service.list_blocked_ips().await.unwrap();
    assert_eq!(bare[0].blocked_at.as_deref(), Some("1757894402"));

    assert_requests(&nas, AUTO_BLOCK_RULES, "list", 4);
    for index in 0..4 {
        assert_eq!(request_field(&nas, index, "offset").as_deref(), Some("0"));
        assert_eq!(request_field(&nas, index, "limit").as_deref(), Some("1000"));
        // requestFormat JSON: the string parameter is JSON-quoted.
        assert_eq!(
            request_field(&nas, index, "type").as_deref(),
            Some(r#""deny""#)
        );
    }
}

#[tokio::test]
async fn blocked_ips_send_a_raw_type_to_plain_form_apis() {
    let (service, nas) =
        service_with_format(&[(AUTO_BLOCK_RULES, 1, None)], vec![ok(real_blocked_ips())]).await;

    assert_eq!(service.list_blocked_ips().await.unwrap().len(), 1);
    assert_requests(&nas, AUTO_BLOCK_RULES, "list", 1);
    assert_eq!(request_field(&nas, 0, "type").as_deref(), Some("deny"));
    assert_eq!(request_field(&nas, 0, "offset").as_deref(), Some("0"));
    assert_eq!(request_field(&nas, 0, "limit").as_deref(), Some("1000"));
}

#[tokio::test]
async fn blocked_ips_keep_dsm_errors_and_never_invent_an_empty_list() {
    let (service, nas) = service_with(
        &[(AUTO_BLOCK_RULES, 1)],
        vec![
            dsm_error(5100),
            ok(json!({"total": 0})),
            ok(json!({"ip_info": [{"recordtime": 1_757_894_400}], "total": 1})),
            ok(json!({"ip_info": [{"ip": "198.51.100.9", "reason": {"code": 1}}]})),
        ],
    )
    .await;

    let refused = service.list_blocked_ips().await.unwrap_err();
    assert!(
        matches!(refused.kind, SynologyErrorKind::ApiError(5100)),
        "{refused}"
    );
    assert_dsm_failure(&refused, 5100);
    assert_eq!(
        refused.to_string().lines().next(),
        Some("SYNO.Core.Security.AutoBlock.Rules: DSM error code 5100")
    );
    assert!(!refused.to_string().contains("access"), "{refused}");

    // Missing envelope, a row without its address, a wrongly typed reason.
    for _ in 0..3 {
        assert_schema_failure(&service.list_blocked_ips().await.unwrap_err());
    }
    assert_requests(&nas, AUTO_BLOCK_RULES, "list", 4);
}

// ── Certificates ────────────────────────────────────────────────────

#[tokio::test]
async fn certificates_unwrap_their_envelope_and_keep_bare_arrays() {
    let bare = real_certificates()["certificates"].clone();
    let mut without_id = real_certificates();
    without_id["certificates"][0]
        .as_object_mut()
        .unwrap()
        .remove("id");
    let (service, nas) = service_with(
        &[(CERTIFICATE, 1)],
        vec![
            ok(real_certificates()),
            // Regression: the bare array the old decoder accepted.
            ok(bare),
            ok(json!({"total": 1})),
            ok(without_id),
        ],
    )
    .await;

    let certificates = service.list_certificates().await.unwrap();
    assert_eq!(certificates.len(), 1);
    let certificate = &certificates[0];
    assert_eq!(certificate.id, "SYNTHcrt01");
    assert_eq!(certificate.desc, "");
    assert!(certificate.is_default);
    assert_eq!(certificate.is_broken, Some(false));
    assert_eq!(certificate.subject["common_name"], "nas.example.invalid");
    assert_eq!(certificate.issuer["organization"], "Fixture Org");
    assert_eq!(certificate.valid_from, "Nov  1 00:00:00 2025 GMT");
    assert_eq!(certificate.valid_till, "Nov  1 23:59:59 2026 GMT");
    assert_eq!(
        certificate.signature_algorithm.as_deref(),
        Some("sha256WithRSAEncryption")
    );
    let ipc = serde_json::to_value(certificate).unwrap();
    assert_eq!(ipc["validTill"], "Nov  1 23:59:59 2026 GMT");
    assert_eq!(ipc["isDefault"], true);

    let legacy = service.list_certificates().await.unwrap();
    assert_eq!(legacy[0].id, "SYNTHcrt01");

    assert_schema_failure(&service.list_certificates().await.unwrap_err());
    assert_schema_failure(&service.list_certificates().await.unwrap_err());
    assert_requests(&nas, CERTIFICATE, "list", 4);
    assert_eq!(request_field(&nas, 0, "offset"), None);
}

// ── Refusals ────────────────────────────────────────────────────────

#[tokio::test]
async fn security_reads_keep_dsm_permission_refusals() {
    let (service, nas) = service_with(
        &[
            (SCAN_STATUS, 1),
            (AUTO_BLOCK, 1),
            (AUTO_BLOCK_RULES, 1),
            (CERTIFICATE, 1),
        ],
        vec![dsm_error(105); 4],
    )
    .await;

    let refusals = [
        (
            SCAN_STATUS,
            service.get_security_overview().await.unwrap_err(),
        ),
        (
            AUTO_BLOCK,
            service.get_auto_block_config().await.unwrap_err(),
        ),
        (
            AUTO_BLOCK_RULES,
            service.list_blocked_ips().await.unwrap_err(),
        ),
        (CERTIFICATE, service.list_certificates().await.unwrap_err()),
    ];
    for (index, (api, error)) in refusals.iter().enumerate() {
        assert!(
            matches!(error.kind, SynologyErrorKind::PermissionDenied),
            "{error}"
        );
        assert_dsm_failure(error, 105);
        assert_eq!(
            error.to_string().lines().next(),
            Some(format!("{api}: requires a DSM administrator account (code 105)").as_str())
        );
        assert_eq!(request_api(&nas, index), *api);
    }
    assert_eq!(nas.requests().len(), 4);
}
