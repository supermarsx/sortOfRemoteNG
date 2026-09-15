//! Owned by t84-e12f: `SYNO.Core.Package` list/get, `SYNO.Core.Service` get
//! and the SMB, NFS and Terminal (SSH) settings, decoded from DSM's real
//! envelopes and field names into the unchanged IPC DTOs.
//!
//! Compatibility kept: package and service lists also decode as a bare array
//! of DSM rows (what `api_list` passes through). The old DTO-shaped settings
//! replies are not kept: no evidence shows DSM ever sent `enabled`/`port`.

use super::*;
use crate::packages::PackagesManager;

const PACKAGE: &str = "SYNO.Core.Package";
const SERVICE: &str = "SYNO.Core.Service";
const SMB: &str = "SYNO.Core.FileServ.SMB";
const NFS: &str = "SYNO.Core.FileServ.NFS";
const TERMINAL: &str = "SYNO.Core.Terminal";

// ── Fixtures ────────────────────────────────────────────────────────

/// `packages` read.
// shape: N4S4/synology-api core_package.py list_installed/get_package Examples (MIT), dsm_helper Core/Package.dart (Apache-2.0)
pub(super) fn real_packages() -> Value {
    json!({
        "packages": [
            {
                "id": "SynthContainers",
                "name": "Synthetic Containers",
                "version": "24.0.2-1535",
                "timestamp": 1_739_228_562_839_u64,
                "additional": {
                    "dependent_packages": null,
                    "description": "Synthetic container runtime.",
                    "description_enu": "",
                    "dsm_app_page": "synth.sds.Containers",
                    "dsm_apps": "synth.sds.Application",
                    "is_uninstall_pages": true,
                    "maintainer": "Synthetic Maintainer",
                    "status": "running",
                    "status_code": 0,
                    "status_origin": "running"
                }
            },
            {
                "id": "SynthInsight",
                "name": "Synthetic Insight",
                "version": "2.1.0-2603",
                "timestamp": 1_697_094_982_290_u64,
                "additional": {
                    "description": "",
                    "dsm_apps": "synth.sds.Instance ",
                    "is_uninstall_pages": false,
                    "maintainer": "Synthetic Maintainer",
                    "status": "status_description",
                    "status_code": 0,
                    "status_origin": "stopped"
                }
            }
        ],
        "total": 2
    })
}

/// `services` read (v3 with `additional=["active_status"]`).
// shape: dsm_helper Core/Service.dart (Apache-2.0)
pub(super) fn real_services() -> Value {
    json!({
        "service": [
            {"additional": {"active_status": "active"}, "display_name_section_key": "firewall:firewall_service_opt_ssh", "enable_status": "enabled", "service_id": "ssh-shell"},
            {"additional": {"active_status": "inactive"}, "display_name_section_key": "helptoc:winmacnfs_mac", "enable_status": "disabled", "service_id": "atalk"},
            {"additional": {"active_status": "active"}, "display_name_section_key": "about:dsm", "enable_status": "static", "service_id": "synoscgi"}
        ]
    })
}

/// `smbConfig` read.
// shape: dsm_helper Core/FileServ/Smb.dart (Apache-2.0)
pub(super) fn real_smb_config() -> Value {
    json!({
        "disable_shadow_copy": false,
        "enable_adserver": null,
        "enable_op_lock": true,
        "enable_samba": true,
        "enable_server_signing": 0,
        "offline_files_support": false,
        "smb_encrypt_transport": 1,
        "smb_max_protocol": 3,
        "smb_min_protocol": 1,
        "vetofile": "",
        "wins": "",
        "workgroup": "SYNTHGROUP"
    })
}

/// `nfsConfig` read.
// shape: synology-csi pkg/dsm/webapi/share.go NfsInfo (Apache-2.0), dsm_helper Core/FileServ/Nfs.dart (Apache-2.0)
pub(super) fn real_nfs_config() -> Value {
    json!({
        "enable_nfs": false,
        "enable_nfs_v4": false,
        "enabled_minor_ver": 0,
        "nfs_v4_domain": "",
        "read_size": 8192,
        "support_encrypt_share": 1,
        "support_major_ver": 4,
        "support_minor_ver": 1,
        "unix_pri_enable": true,
        "write_size": 8192
    })
}

/// `sshConfig` read.
// shape: dsm_helper Core/Terminal.dart (Apache-2.0)
pub(super) fn real_ssh_config() -> Value {
    json!({
        "enable_ssh": true,
        "enable_telnet": false,
        "forbid_console": false,
        "ssh_cipher": [{"hardware_support": false, "in_use": true, "name": "aes256-ctr", "security_level": 2}],
        "ssh_kex": [],
        "ssh_mac": [],
        "ssh_port": 22
    })
}

fn package_row(id: &str, additional: Value) -> Value {
    json!({"id": id, "name": format!("Name of {id}"), "version": "1.0-1", "additional": additional})
}

fn additional_list(nas: &Nas, index: usize) -> Vec<String> {
    let raw = request_field(nas, index, "additional").expect("additional was sent");
    serde_json::from_str(&raw).expect("additional is a JSON list")
}

// ── Packages ────────────────────────────────────────────────────────

#[tokio::test]
async fn packages_decode_the_envelope_with_status_from_additional() {
    let partial = json!({"packages": [
        package_row("SynthStatusOnly", json!({"status": "stopped"})),
        {"id": "SynthBare", "name": "Synthetic Bare", "version": "1.0-1"}
    ], "total": 2});
    let bare = json!([package_row(
        "SynthBareArray",
        json!({"status_origin": "running"})
    )]);
    let (service, nas) = service_with(
        &[(PACKAGE, 2)],
        vec![
            ok(real_packages()),
            ok(partial),
            ok(bare),
            ok(json!({"total": 0})),
            ok(json!({"packages": [{"id": "SynthNoVersion", "name": "No version"}]})),
        ],
    )
    .await;

    let packages = service.list_packages().await.unwrap();
    assert_eq!(packages.len(), 2);
    let containers = &packages[0];
    assert_eq!(containers.id, "SynthContainers");
    assert_eq!(containers.name, "Synthetic Containers");
    assert_eq!(containers.version, "24.0.2-1535");
    assert_eq!(containers.status.as_deref(), Some("running"));
    assert_eq!(
        containers.description.as_deref(),
        Some("Synthetic container runtime.")
    );
    assert_eq!(containers.is_uninstall_pages, Some(true));
    assert_eq!(containers.update_version, None);
    let extra = containers.additional.as_ref().unwrap();
    assert_eq!(extra.maintainer.as_deref(), Some("Synthetic Maintainer"));
    assert_eq!(extra.dsm_apps.as_deref(), Some("synth.sds.Application"));
    assert_eq!(extra.dsm_app_page.as_deref(), Some("synth.sds.Containers"));
    // `status` holds a description key; the machine status is `status_origin`.
    assert_eq!(packages[1].status.as_deref(), Some("stopped"));
    assert_eq!(packages[1].is_uninstall_pages, Some(false));
    assert_eq!(
        serde_json::to_value(&packages[0]).unwrap(),
        json!({
            "id": "SynthContainers", "name": "Synthetic Containers", "version": "24.0.2-1535",
            "description": "Synthetic container runtime.", "status": "running", "isUninstallPages": true,
            "updateVersion": null,
            "additional": {"description": "Synthetic container runtime.", "maintainer": "Synthetic Maintainer", "dsmApps": "synth.sds.Application", "dsmAppPage": "synth.sds.Containers"}
        })
    );

    let partial = service.list_packages().await.unwrap();
    assert_eq!(partial[0].status.as_deref(), Some("stopped"));
    assert_eq!(partial[1].status, None);
    assert!(partial[1].additional.is_none());
    assert!(serde_json::to_value(&partial[1]).unwrap()["status"].is_null());

    // Regression: a bare array of DSM rows still decodes.
    let bare = service.list_packages().await.unwrap();
    assert_eq!(bare[0].id, "SynthBareArray");
    assert_eq!(bare[0].status.as_deref(), Some("running"));

    // Missing envelope key; a row without the required `version`.
    for _ in 0..2 {
        assert_schema_failure(&service.list_packages().await.unwrap_err());
    }

    assert_eq!(nas.requests().len(), 5);
    for index in 0..5 {
        assert_eq!(request_api(&nas, index), PACKAGE);
        assert_eq!(request_method(&nas, index), "list");
        assert_eq!(request_version(&nas, index), 1);
        let additional = additional_list(&nas, index);
        for key in [
            "status",
            "description",
            "maintainer",
            "dsm_apps",
            "is_uninstall_pages",
        ] {
            assert!(additional.iter().any(|item| item == key), "{key}");
        }
    }
}

#[tokio::test]
async fn package_get_decodes_the_flat_reply_so_is_running_works() {
    // shape: N4S4/synology-api core_package.py get_package Example (MIT)
    let running = json!({
        "additional": {"dsm_apps": " com.synth.media", "status": "running", "status_code": 0, "status_description": "retrieve from status script", "status_origin": "running"},
        "id": "SynthMedia",
        "name": "Synthetic Media",
        "timestamp": 1_739_228_562_839_u64,
        "version": "1.41.3-1"
    });
    let mut stopped = running.clone();
    stopped["additional"]["status_origin"] = json!("stopped");
    stopped["additional"]["status"] = json!("stopped");
    let (mut service, nas) = service_with(
        &[(PACKAGE, 1)],
        vec![
            ok(running.clone()),
            ok(stopped),
            ok(json!({"id": "SynthMedia", "name": "Synthetic Media", "version": "1"})),
            ok(running),
        ],
    )
    .await;
    let client = service.client.as_ref().unwrap();

    assert!(PackagesManager::is_running(client, "SynthMedia")
        .await
        .unwrap());
    assert!(!PackagesManager::is_running(client, "SynthMedia")
        .await
        .unwrap());
    // No status reported: not claimed as running.
    let unreported = PackagesManager::get_package(client, "SynthMedia")
        .await
        .unwrap();
    assert_eq!(unreported.status, None);

    for index in 0..3 {
        assert_eq!(request_api(&nas, index), PACKAGE);
        assert_eq!(request_method(&nas, index), "get");
        assert_eq!(
            request_field(&nas, index, "id").as_deref(),
            Some(r#""SynthMedia""#)
        );
        assert!(additional_list(&nas, index).iter().any(|k| k == "status"));
    }

    // A plain-form declaration sends the raw id.
    service
        .client
        .as_mut()
        .unwrap()
        .api_info
        .get_mut(PACKAGE)
        .unwrap()
        .request_format = None;
    let client = service.client.as_ref().unwrap();
    let package = PackagesManager::get_package(client, "SynthMedia")
        .await
        .unwrap();
    assert_eq!(package.status.as_deref(), Some("running"));
    assert_eq!(request_field(&nas, 3, "id").as_deref(), Some("SynthMedia"));
}

#[tokio::test]
async fn package_and_service_actions_encode_ids_per_request_format() {
    const CONTROL: &str = "SYNO.Core.Package.Control";
    const INSTALL: &str = "SYNO.Core.Package.Installation";
    const UNINSTALL: &str = "SYNO.Core.Package.Uninstallation";
    let done = || json!({"success": true});
    let (service, nas) = service_with_format(
        &[
            (CONTROL, 1, Some("JSON")),
            (INSTALL, 1, Some("JSON")),
            (UNINSTALL, 1, None),
            (SERVICE, 3, Some("JSON")),
        ],
        vec![done(), done(), done(), done(), done()],
    )
    .await;

    service.start_package("SynthMedia").await.unwrap();
    service.stop_package("SynthMedia").await.unwrap();
    service
        .install_package("SynthMedia", "/volume1")
        .await
        .unwrap();
    service.uninstall_package("SynthMedia").await.unwrap();
    let client = service.client.as_ref().unwrap();
    crate::services::ServicesManager::set_enabled(client, "ssh-shell", true)
        .await
        .unwrap();

    let expected = [
        (CONTROL, "start", r#""SynthMedia""#),
        (CONTROL, "stop", r#""SynthMedia""#),
        (INSTALL, "install", r#""SynthMedia""#),
        (UNINSTALL, "uninstall", "SynthMedia"),
        (SERVICE, "set", r#""ssh-shell""#),
    ];
    for (index, (api, method, id)) in expected.into_iter().enumerate() {
        assert_eq!(request_api(&nas, index), api);
        assert_eq!(request_method(&nas, index), method);
        assert_eq!(request_field(&nas, index, "id").as_deref(), Some(id));
    }
    assert_eq!(
        request_field(&nas, 2, "volume").as_deref(),
        Some(r#""/volume1""#)
    );
    assert_eq!(request_version(&nas, 4), 1);
    assert_eq!(request_field(&nas, 4, "enable").as_deref(), Some("true"));
}

// ── Services ────────────────────────────────────────────────────────

#[tokio::test]
async fn services_decode_v3_rows_with_their_active_status() {
    let bare = json!([{"service_id": "nfs-server", "display_name_section_key": "nfs:nfs_title", "enable_status": "enabled", "additional": {"active_status": "active"}}]);
    let (service, nas) = service_with(
        &[(SERVICE, 3)],
        vec![
            ok(real_services()),
            ok(bare),
            ok(json!({})),
            ok(json!({"service": [{"service_id": "ssh-shell", "display_name": "SSH"}]})),
            ok(json!({"service": [{"display_name": "SSH", "enable_status": "enabled"}]})),
        ],
    )
    .await;

    let services = service.list_services().await.unwrap();
    assert_eq!(services.len(), 3);
    assert_eq!(services[0].id, "ssh-shell");
    assert_eq!(services[0].name, "firewall:firewall_service_opt_ssh");
    assert!(services[0].enabled);
    assert_eq!(services[0].running, Some(true));
    assert_eq!(services[1].id, "atalk");
    assert!(!services[1].enabled);
    assert_eq!(services[1].running, Some(false));
    // `static` services are always on but not switchable, so not "enabled".
    assert!(!services[2].enabled);
    assert_eq!(services[2].running, Some(true));
    assert_eq!(
        serde_json::to_value(&services[0]).unwrap(),
        json!({"id": "ssh-shell", "name": "firewall:firewall_service_opt_ssh", "enabled": true, "running": true, "port": null, "serviceType": null})
    );

    // Regression: a bare array of DSM rows still decodes.
    let bare = service.list_services().await.unwrap();
    assert_eq!(bare[0].id, "nfs-server");
    assert_eq!(bare[0].running, Some(true));

    // Missing `service`; a row without `enable_status`; a row without `service_id`.
    for _ in 0..3 {
        assert_schema_failure(&service.list_services().await.unwrap_err());
    }

    assert_eq!(nas.requests().len(), 5);
    for index in 0..5 {
        assert_eq!(request_api(&nas, index), SERVICE);
        assert_eq!(request_method(&nas, index), "get");
        assert_eq!(request_version(&nas, index), 3);
        assert_eq!(
            request_field(&nas, index, "additional").as_deref(),
            Some(r#"["active_status"]"#)
        );
    }
}

#[tokio::test]
async fn services_at_v1_without_run_state_keep_running_unknown() {
    // shape: pmilano1/synology-dsm-api probed core-other.md SYNO.Core.Service get v1 [probed DSM 7.4] (MIT)
    let probed = json!({"service": [
        {"display_name": "SSH", "enable_status": "enabled", "service_id": "ssh-shell"},
        {"enable_status": "disabled", "service_id": "tftp"}
    ]});
    let (service, nas) = service_with(&[(SERVICE, 1)], vec![ok(probed)]).await;

    let services = service.list_services().await.unwrap();
    assert_eq!(services[0].name, "SSH");
    assert!(services[0].enabled);
    assert_eq!(services[0].running, None);
    assert_eq!(services[0].service_type, None);
    // Neither display name: the id is the only truthful label.
    assert_eq!(services[1].name, "tftp");
    let ipc = serde_json::to_value(&services[1]).unwrap();
    assert!(ipc["running"].is_null() && ipc["serviceType"].is_null() && ipc["port"].is_null());

    assert_eq!(request_version(&nas, 0), 1);
    assert_eq!(request_method(&nas, 0), "get");
}

#[tokio::test]
async fn service_reads_keep_dsm_refusals() {
    let (service, nas) = service_with(&[(SERVICE, 3)], vec![dsm_error(105)]).await;
    let denied = service.list_services().await.unwrap_err();
    assert!(matches!(denied.kind, SynologyErrorKind::PermissionDenied));
    assert_dsm_failure(&denied, 105);
    assert_eq!(request_api(&nas, 0), SERVICE);
}

// ── SMB / NFS / SSH ─────────────────────────────────────────────────

#[tokio::test]
async fn smb_settings_map_dsm_samba_names() {
    let mut text_levels = real_smb_config();
    text_levels["smb_min_protocol"] = json!("2");
    text_levels
        .as_object_mut()
        .unwrap()
        .remove("smb_max_protocol");
    let mut disabled = real_smb_config();
    disabled.as_object_mut().unwrap().remove("enable_samba");
    let (service, nas) = service_with(
        &[(SMB, 3)],
        vec![ok(real_smb_config()), ok(text_levels), ok(disabled)],
    )
    .await;

    let smb = service.get_smb_config().await.unwrap();
    assert!(smb.enabled);
    assert_eq!(smb.workgroup.as_deref(), Some("SYNTHGROUP"));
    assert_eq!(smb.min_protocol.as_deref(), Some("1"));
    assert_eq!(smb.max_protocol.as_deref(), Some("3"));
    assert_eq!(
        serde_json::to_value(&smb).unwrap(),
        json!({"enabled": true, "workgroup": "SYNTHGROUP", "description": null, "minProtocol": "1", "maxProtocol": "3", "enableSmb2": null, "enableSmb3": null})
    );
    let text = service.get_smb_config().await.unwrap();
    assert_eq!(text.min_protocol.as_deref(), Some("2"));
    assert_eq!(text.max_protocol, None);
    assert_schema_failure(&service.get_smb_config().await.unwrap_err());

    for index in 0..3 {
        assert_eq!(request_api(&nas, index), SMB);
        assert_eq!(request_method(&nas, index), "get");
        assert_eq!(request_version(&nas, index), 3);
    }
}

#[tokio::test]
async fn nfs_settings_map_dsm_nfs_names() {
    let mut enabled = real_nfs_config();
    enabled["enable_nfs"] = json!(true);
    enabled["enable_nfs_v4"] = json!(true);
    enabled["nfs_v4_domain"] = json!("nfs.synthetic.invalid");
    let (service, nas) = service_with(
        &[(NFS, 2)],
        vec![
            ok(real_nfs_config()),
            ok(enabled),
            ok(json!({"enable_nfs_v4": true, "nfs_v4_domain": ""})),
        ],
    )
    .await;

    let nfs = service.get_nfs_config().await.unwrap();
    assert!(!nfs.enabled);
    assert_eq!(nfs.enable_nfs_v4, Some(false));
    assert_eq!(nfs.domain, None);
    assert_eq!(
        serde_json::to_value(&nfs).unwrap(),
        json!({"enabled": false, "enableNfsV4": false, "domain": null})
    );
    let on = service.get_nfs_config().await.unwrap();
    assert!(on.enabled);
    assert_eq!(on.enable_nfs_v4, Some(true));
    assert_eq!(on.domain.as_deref(), Some("nfs.synthetic.invalid"));
    assert_schema_failure(&service.get_nfs_config().await.unwrap_err());

    for index in 0..3 {
        assert_eq!(request_api(&nas, index), NFS);
        assert_eq!(request_method(&nas, index), "get");
        assert_eq!(request_version(&nas, index), 2);
    }
}

#[tokio::test]
async fn ssh_settings_map_dsm_terminal_names_and_reject_invalid_ports() {
    let mut custom = real_ssh_config();
    custom["ssh_port"] = json!("2222");
    custom["enable_ssh"] = json!(false);
    let mut too_large = real_ssh_config();
    too_large["ssh_port"] = json!(70000);
    let mut missing = real_ssh_config();
    missing.as_object_mut().unwrap().remove("ssh_port");
    let (service, nas) = service_with(
        &[(TERMINAL, 3)],
        vec![
            ok(real_ssh_config()),
            ok(custom),
            ok(too_large),
            ok(missing),
            ok(json!({"enable_ssh": true, "ssh_port": -22})),
        ],
    )
    .await;

    let ssh = service.get_ssh_config().await.unwrap();
    assert!(ssh.enabled);
    assert_eq!(ssh.port, 22);
    assert_eq!(
        serde_json::to_value(&ssh).unwrap(),
        json!({"enabled": true, "port": 22})
    );
    let custom = service.get_ssh_config().await.unwrap();
    assert!(!custom.enabled);
    assert_eq!(custom.port, 2222);
    // 70000, a missing port and a negative port are schema failures, not port 0.
    for _ in 0..3 {
        assert_schema_failure(&service.get_ssh_config().await.unwrap_err());
    }

    for index in 0..5 {
        assert_eq!(request_api(&nas, index), TERMINAL);
        assert_eq!(request_method(&nas, index), "get");
        assert_eq!(request_version(&nas, index), 3);
    }
}
