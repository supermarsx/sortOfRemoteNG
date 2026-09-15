//! Owned by t84-e12d: `SYNO.Core.Share list`, `SYNO.Core.Share.Permission
//! list`, `SYNO.Core.User list` and `SYNO.Core.Group list` (addendum §4 L2).
//!
//! DSM wraps each list in an envelope (`shares`, `items`, `users`, `groups`).
//! A missing envelope key is a `json_schema` failure, never an empty table.
//! The bare arrays the pre-t84 decoders accepted (and the mock DSM's `legacy`
//! wire) still decode.

use super::*;

const SHARE: &str = "SYNO.Core.Share";
const SHARE_PERMISSION: &str = "SYNO.Core.Share.Permission";
const USER: &str = "SYNO.Core.User";
const GROUP: &str = "SYNO.Core.Group";

// ── Fixtures ────────────────────────────────────────────────────────

/// `sharedFolders` read.
// shape: py-synologydsm-api dsm_6/core/const_6_core_share.py (MIT), N4S4/synology-api core_share.list_folders (MIT), dsm_helper Core/Share.dart (Apache-2.0)
pub(super) fn real_shared_folders() -> Value {
    json!({
        "shares": [
            {
                "desc": "",
                "enable_recycle_bin": true,
                "encryption": 0,
                "hidden": false,
                "is_aclmode": true,
                "is_share_moving": false,
                "is_usb_share": false,
                "name": "public",
                "quota_value": 0,
                "share_quota_used": 0,
                "uuid": "00000000-0000-4000-8000-000000000001",
                "vol_path": "/volume1"
            },
            {
                "desc": "Synthetic containers",
                "enable_recycle_bin": false,
                "encryption": 1,
                "hidden": true,
                "is_aclmode": false,
                "is_share_moving": true,
                "is_usb_share": false,
                "name": "docker",
                "quota_value": 0,
                "share_quota_used": 0,
                "uuid": "00000000-0000-4000-8000-000000000002",
                "vol_path": "/volume2"
            }
        ],
        "total": 2
    })
}

/// Share permission rows (the `syn_get_share_permissions` action).
// shape: N4S4/synology-api core_share.SharePermission.get_folder_permissions docstring example (MIT)
pub(super) fn real_share_permissions() -> Value {
    json!({
        "items": [
            {"inherit": "rw", "is_admin": true, "is_custom": false, "is_deny": false, "is_readonly": false, "is_writable": true, "name": "fixture-admin"},
            {"inherit": "-", "is_admin": false, "is_custom": true, "is_deny": true, "is_readonly": false, "is_writable": false, "name": "fixture-guest"}
        ],
        "total": 2
    })
}

/// `users` read: list rows carry no `uid`; `expired` is a status word.
// shape: N4S4/synology-api core_user.user_list (MIT), dsm_helper Core/SynoUser.dart (Apache-2.0)
pub(super) fn real_users() -> Value {
    json!({
        "offset": 0,
        "total": 2,
        "users": [
            {"description": "System default user", "email": "", "expired": "now", "name": "fixture-admin"},
            {"description": "", "email": "viewer@example.invalid", "expired": "normal", "name": "fixture-viewer", "passwd_never_expire": true}
        ]
    })
}

/// `groups` read: list rows carry no `members`.
// shape: N4S4/synology-api core_group.get_groups (MIT)
pub(super) fn real_groups() -> Value {
    json!({
        "groups": [
            {"description": "System default admin group", "gid": 101, "name": "administrators"},
            {"description": "System default group", "gid": 100, "name": "users"}
        ],
        "offset": 0,
        "total": 2
    })
}

fn ipc(value: &impl serde::Serialize) -> Value {
    serde_json::to_value(value).unwrap()
}

// ── Shared folders ──────────────────────────────────────────────────

#[tokio::test]
async fn shared_folders_decode_the_dsm_envelope_and_derive_the_share_path() {
    let (service, _nas) = service_with(&[(SHARE, 1)], vec![ok(real_shared_folders())]).await;

    let shares = service.list_shared_folders().await.unwrap();
    assert_eq!(shares.len(), 2);
    let public = &shares[0];
    assert_eq!(public.name, "public");
    assert_eq!(public.path, "/public");
    assert_eq!(public.vol_path.as_deref(), Some("/volume1"));
    assert_eq!(public.desc.as_deref(), Some(""));
    assert_eq!(public.is_aclmode, Some(true));
    assert_eq!(public.enable_recycle_bin, Some(true));
    assert_eq!(public.encryption, Some(0));
    assert_eq!(public.is_share_moving, Some(false));
    assert!(public.additional.is_none());
    let docker = &shares[1];
    assert_eq!(docker.path, "/docker");
    assert_eq!(docker.vol_path.as_deref(), Some("/volume2"));
    assert_eq!(docker.desc.as_deref(), Some("Synthetic containers"));
    assert_eq!(docker.is_aclmode, Some(false));
    assert_eq!(docker.enable_recycle_bin, Some(false));
    assert_eq!(docker.encryption, Some(1));
    assert_eq!(docker.is_share_moving, Some(true));

    // The IPC keys are the unchanged camelCase DTO.
    assert_eq!(
        ipc(public),
        json!({
            "name": "public",
            "path": "/public",
            "volPath": "/volume1",
            "desc": "",
            "isAclmode": true,
            "enableRecycleBin": true,
            "encryption": 0,
            "isShareMoving": false,
            "additional": null
        })
    );
}

#[tokio::test]
async fn shared_folders_request_keeps_its_api_method_version_and_params() {
    // Discovery offers v3, the manager caps at v1.
    let (service, nas) = service_with(&[(SHARE, 3)], vec![ok(real_shared_folders())]).await;
    service.list_shared_folders().await.unwrap();

    assert_eq!(nas.requests().len(), 1);
    assert_eq!(request_api(&nas, 0), SHARE);
    assert_eq!(request_method(&nas, 0), "list");
    assert_eq!(request_version(&nas, 0), 1);
    assert_eq!(
        request_field(&nas, 0, "additional").as_deref(),
        Some(r#"["volume_status","encryption","hidden","recyclebin"]"#)
    );
    assert_eq!(request_field(&nas, 0, "offset").as_deref(), Some("0"));
    assert_eq!(request_field(&nas, 0, "limit").as_deref(), Some("1000"));
    assert_eq!(
        request_field(&nas, 0, "_sid").as_deref(),
        Some("fixture-sid")
    );
}

#[tokio::test]
async fn shared_folders_without_the_envelope_or_a_name_are_schema_failures() {
    let (service, nas) = service_with(
        &[(SHARE, 1)],
        vec![
            ok(json!({"total": 0})),
            ok(json!({"items": [], "total": 0})),
            ok(json!({"shares": [{"vol_path": "/volume1"}], "total": 1})),
        ],
    )
    .await;

    for _ in 0..3 {
        let error = service.list_shared_folders().await.unwrap_err();
        assert_schema_failure(&error);
    }
    assert_eq!(nas.requests().len(), 3);
}

#[tokio::test]
async fn shared_folders_regression_bare_arrays_still_decode() {
    let (service, _nas) = service_with(
        &[(SHARE, 1)],
        vec![
            // DSM rows without the envelope.
            ok(real_shared_folders()["shares"].clone()),
            // The pre-t84 DTO shape: camelCase keys and an explicit path.
            ok(json!([{
                "name": "public",
                "path": "/public",
                "volPath": "/volume1",
                "desc": null,
                "isAclmode": true,
                "enableRecycleBin": false,
                "encryption": null,
                "isShareMoving": false,
                "additional": null
            }])),
            ok(json!([])),
        ],
    )
    .await;

    let bare = service.list_shared_folders().await.unwrap();
    assert_eq!(bare.len(), 2);
    assert_eq!(bare[1].path, "/docker");

    let legacy = service.list_shared_folders().await.unwrap();
    assert_eq!(legacy.len(), 1);
    assert_eq!(legacy[0].path, "/public");
    assert_eq!(legacy[0].vol_path.as_deref(), Some("/volume1"));
    assert_eq!(legacy[0].is_aclmode, Some(true));
    assert_eq!(legacy[0].enable_recycle_bin, Some(false));
    assert_eq!(legacy[0].is_share_moving, Some(false));
    assert_eq!(legacy[0].desc, None);

    assert!(service.list_shared_folders().await.unwrap().is_empty());
}

// ── Share permissions ───────────────────────────────────────────────

#[tokio::test]
async fn share_permissions_decode_the_items_envelope() {
    let (service, nas) =
        service_with(&[(SHARE_PERMISSION, 1)], vec![ok(real_share_permissions())]).await;

    let rows = service.get_share_permissions("public").await.unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].name, "fixture-admin");
    assert!(!rows[0].is_readonly);
    assert!(rows[0].is_writable);
    assert!(!rows[0].is_deny);
    assert_eq!(rows[0].is_custom, Some(false));
    assert_eq!(rows[1].name, "fixture-guest");
    assert!(rows[1].is_deny);
    assert!(!rows[1].is_writable);
    assert_eq!(rows[1].is_custom, Some(true));
    assert_eq!(
        ipc(&rows[1]),
        json!({"name": "fixture-guest", "isReadonly": false, "isWritable": false, "isDeny": true, "isCustom": true})
    );

    assert_eq!(request_api(&nas, 0), SHARE_PERMISSION);
    assert_eq!(request_method(&nas, 0), "list");
    assert_eq!(request_version(&nas, 0), 1);
    assert_eq!(
        request_field(&nas, 0, "name").as_deref(),
        Some(r#""public""#)
    );
}

#[tokio::test]
async fn share_permissions_send_the_share_name_raw_to_a_plain_format_api() {
    let (service, nas) = service_with_format(
        &[(SHARE_PERMISSION, 1, None)],
        vec![ok(real_share_permissions())],
    )
    .await;

    service.get_share_permissions("2024").await.unwrap();
    assert_eq!(request_field(&nas, 0, "name").as_deref(), Some("2024"));
}

#[tokio::test]
async fn share_permissions_without_items_or_required_flags_are_schema_failures() {
    let (service, nas) = service_with(
        &[(SHARE_PERMISSION, 1)],
        vec![
            ok(json!({"total": 0})),
            ok(json!({"items": [{"name": "fixture-admin", "is_writable": true}], "total": 1})),
        ],
    )
    .await;

    for _ in 0..2 {
        let error = service.get_share_permissions("public").await.unwrap_err();
        assert_schema_failure(&error);
    }
    assert_eq!(nas.requests().len(), 2);
}

#[tokio::test]
async fn share_permissions_regression_bare_array_still_decodes() {
    let (service, _nas) = service_with(
        &[(SHARE_PERMISSION, 1)],
        vec![ok(real_share_permissions()["items"].clone())],
    )
    .await;

    let rows = service.get_share_permissions("public").await.unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].name, "fixture-admin");
}

// ── Users ───────────────────────────────────────────────────────────

#[tokio::test]
async fn users_decode_the_dsm_envelope_without_inventing_a_uid() {
    let (service, nas) = service_with(&[(USER, 1)], vec![ok(real_users())]).await;

    let users = service.list_users().await.unwrap();
    assert_eq!(users.len(), 2);
    assert_eq!(users[0].name, "fixture-admin");
    assert_eq!(users[0].uid, None);
    assert_eq!(users[0].description.as_deref(), Some("System default user"));
    assert_eq!(users[0].email.as_deref(), Some(""));
    assert_eq!(users[0].expired.as_deref(), Some("now"));
    assert_eq!(users[1].name, "fixture-viewer");
    assert_eq!(users[1].email.as_deref(), Some("viewer@example.invalid"));
    assert_eq!(users[1].expired.as_deref(), Some("normal"));
    assert_eq!(users[1].enable_home_service, None);

    // `uid` stays in the IPC as `null`, never 0 (root's uid) or a missing key.
    let first = ipc(&users[0]);
    assert!(first.as_object().unwrap().contains_key("uid"));
    assert_eq!(
        first,
        json!({
            "name": "fixture-admin",
            "uid": null,
            "description": "System default user",
            "email": "",
            "expired": "now",
            "enableHomeService": null
        })
    );

    assert_eq!(nas.requests().len(), 1);
    assert_eq!(request_api(&nas, 0), USER);
    assert_eq!(request_method(&nas, 0), "list");
    assert_eq!(request_version(&nas, 0), 1);
    assert_eq!(request_field(&nas, 0, "offset").as_deref(), Some("0"));
    assert_eq!(request_field(&nas, 0, "limit").as_deref(), Some("500"));
    assert_eq!(
        request_field(&nas, 0, "additional").as_deref(),
        Some(r#"["email","description","expired"]"#)
    );
}

#[tokio::test]
async fn users_without_the_envelope_or_a_name_are_schema_failures() {
    let (service, nas) = service_with(
        &[(USER, 1)],
        vec![
            ok(json!({"total": 0})),
            ok(json!({"offset": 0, "total": 1, "users": [{"description": "no name"}]})),
        ],
    )
    .await;

    for _ in 0..2 {
        let error = service.list_users().await.unwrap_err();
        assert_schema_failure(&error);
    }
    assert_eq!(nas.requests().len(), 2);
}

#[tokio::test]
async fn users_regression_legacy_bare_array_keeps_its_uid() {
    // The mock DSM `legacy` wire: bare user rows with a `uid`.
    let (service, _nas) = service_with(
        &[(USER, 1)],
        vec![ok(json!([
            {"name": "fixture-admin", "description": "System default user", "email": "", "expired": "normal", "uid": 1024},
            {"name": "fixture-viewer", "uid": 1026}
        ]))],
    )
    .await;

    let users = service.list_users().await.unwrap();
    assert_eq!(users.len(), 2);
    assert_eq!(users[0].uid, Some(1024));
    assert_eq!(users[1].uid, Some(1026));
    assert_eq!(users[1].email, None);
}

#[tokio::test]
async fn users_permission_denied_keeps_the_dsm_refusal() {
    let (service, nas) = service_with(&[(USER, 1)], vec![dsm_error(105)]).await;

    let error = service.list_users().await.unwrap_err();
    assert!(
        matches!(error.kind, SynologyErrorKind::PermissionDenied),
        "{error}"
    );
    assert_dsm_failure(&error, 105);
    assert_eq!(nas.requests().len(), 1);
}

// ── Groups ──────────────────────────────────────────────────────────

#[tokio::test]
async fn groups_decode_the_dsm_envelope_without_inventing_members() {
    let (service, nas) = service_with(&[(GROUP, 1)], vec![ok(real_groups())]).await;

    let groups = service.list_groups().await.unwrap();
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].name, "administrators");
    assert_eq!(groups[0].gid, 101);
    assert_eq!(
        groups[0].description.as_deref(),
        Some("System default admin group")
    );
    assert_eq!(groups[0].members, None);
    assert_eq!(groups[1].name, "users");
    assert_eq!(groups[1].gid, 100);

    // `members` stays in the IPC as `null`, never `[]` (which claims no members).
    assert_eq!(
        ipc(&groups[1]),
        json!({"name": "users", "gid": 100, "description": "System default group", "members": null})
    );

    assert_eq!(nas.requests().len(), 1);
    assert_eq!(request_api(&nas, 0), GROUP);
    assert_eq!(request_method(&nas, 0), "list");
    assert_eq!(request_version(&nas, 0), 1);
    assert_eq!(request_field(&nas, 0, "offset").as_deref(), Some("0"));
    assert_eq!(request_field(&nas, 0, "limit").as_deref(), Some("500"));
}

#[tokio::test]
async fn groups_without_the_envelope_or_a_gid_are_schema_failures() {
    let (service, nas) = service_with(
        &[(GROUP, 1)],
        vec![
            ok(json!({"total": 0})),
            ok(json!({"users": [], "total": 0})),
            ok(json!({"groups": [{"name": "administrators"}], "offset": 0, "total": 1})),
        ],
    )
    .await;

    for _ in 0..3 {
        let error = service.list_groups().await.unwrap_err();
        assert_schema_failure(&error);
    }
    assert_eq!(nas.requests().len(), 3);
}

#[tokio::test]
async fn groups_regression_legacy_bare_array_keeps_its_members() {
    // The mock DSM `legacy` wire: bare group rows with `members`.
    let (service, _nas) = service_with(
        &[(GROUP, 1)],
        vec![ok(json!([
            {"name": "administrators", "gid": 101, "description": "System default admin group", "members": ["fixture-admin"]},
            {"name": "users", "gid": 100, "members": ["fixture-admin", "fixture-viewer"]}
        ]))],
    )
    .await;

    let groups = service.list_groups().await.unwrap();
    assert_eq!(groups.len(), 2);
    assert_eq!(
        groups[0].members.as_deref(),
        Some(&["fixture-admin".to_owned()][..])
    );
    assert_eq!(groups[1].members.as_ref().map(Vec::len), Some(2));
    assert_eq!(groups[1].description, None);
}
