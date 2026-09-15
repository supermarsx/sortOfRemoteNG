//! Owned by t84-e12l: the typed-decode contract behind the section access
//! probe (addendum §5, §8).
//!
//! The probe (`api_access::READS`) only classifies privilege and decodes an
//! untyped value, so these tests tie it to the loaders:
//! - every READS field's `SynologyService` loader decodes the lanes' real DSM
//!   shape, so "available" means the panel read decodes;
//! - the loader's first request is the probe's call (API, method, version and
//!   every READS parameter), under a JSON and a plain `requestFormat`, so a
//!   manager change fails here until the probe follows.
//!
//! `hardwareInfo` and `notificationConfig` are not covered: DSM 7 provides
//! neither primary API (plan F1). The dashboard is not a READS field; its
//! per-part tolerance and logging are pinned at the end.

use super::*;
use super::{
    docker_shapes::{
        real_docker_containers, real_docker_images, real_docker_networks, real_docker_projects,
    },
    downloads_backup_shapes::{real_active_backup_devices, real_backup_tasks, real_download_tasks},
    foundation_shapes::{real_file_station_info, real_utilization},
    logs_shapes::{real_connection_logs, real_system_logs},
    network_shapes::{
        real_firewall_adapters, real_firewall_rules, real_firewall_rules_empty,
        real_network_interfaces, real_network_overview,
    },
    packages_services_shapes::{
        real_nfs_config, real_packages, real_services, real_smb_config, real_ssh_config,
    },
    security_shapes::{
        real_auto_block_config, real_blocked_ips, real_certificates, real_security_overview,
    },
    shares_users_shapes::{real_groups, real_shared_folders, real_users},
    storage_shapes::{real_disks, real_storage_overview, real_volumes},
    system_hardware_shapes::{real_power_schedule, real_ups_info},
    vmm_surveillance_shapes::{real_cameras, real_vms},
};
use crate::api_access::{read_spec, ReadCall, READS};
use std::{
    collections::{BTreeSet, HashMap},
    sync::Mutex,
    thread::{self, ThreadId},
};

/// READS fields whose primary API DSM 7 does not provide (plan F1).
const F1_ABSENT: [&str; 2] = ["hardwareInfo", "notificationConfig"];

/// Discovery maximum for every API here, above every manager's cap, so the
/// version a loader sends is its own cap and must equal the probe's.
const DISCOVERED_MAX: u32 = 10;

/// Parameters a loader sends that its probe deliberately leaves out: extra
/// columns and detail flags that do not decide whether DSM allows the read.
/// Anything else a loader adds must be added to READS as well.
const LOADER_ONLY: [(&str, &[&str]); 6] = [
    ("sharedFolders", &["additional"]),
    ("users", &["additional"]),
    ("packages", &["additional"]),
    ("vms", &["additional"]),
    ("downloadTasks", &["additional"]),
    ("cameras", &["basic", "streamInfo", "privilege"]),
];

// ── Fixtures without a lane ─────────────────────────────────────────

/// `systemInfo` read.
// shape: py-synologydsm-api tests/api_data/dsm_7/dsm/const_7_dsm_info.py (MIT), vcf-content-factory synology-system.md [observed DSM 7.3.2] (MIT)
fn real_system_info() -> Value {
    json!({
        "codepage": "enu",
        "model": "DS918+",
        "ram": 4096,
        "serial": "SYNTH0000",
        "temperature": 40,
        "temperature_warn": false,
        "time": "Sun Mar 29 19:33:41 2020",
        "uptime": 155084,
        "version": "24922",
        "version_string": "DSM 7.0-41222"
    })
}

/// `downloadStats` read.
// shape: py-synologydsm-api tests/api_data/dsm_6/download_station/const_6_download_station_stat.py (MIT)
fn real_download_stats() -> Value {
    json!({"speed_download": 89950232, "speed_upload": 0})
}

// ── Contract table ──────────────────────────────────────────────────

struct Contract {
    field: &'static str,
    /// Index into the field's READS alternatives; discovery lists only that
    /// alternative's API plus `also`.
    alternative: usize,
    /// Further APIs the loader calls after its first request.
    also: &'static [&'static str],
    /// DSM's answers, one per loader request, in order.
    responses: fn() -> Vec<Value>,
}

const fn contract(field: &'static str, responses: fn() -> Vec<Value>) -> Contract {
    Contract {
        field,
        alternative: 0,
        also: &[],
        responses,
    }
}

const CONTRACTS: [Contract; 36] = [
    contract("systemInfo", || vec![ok(real_system_info())]),
    contract("utilization", || vec![ok(real_utilization())]),
    contract("storageOverview", || vec![ok(real_storage_overview())]),
    contract("disks", || vec![ok(real_disks())]),
    contract("volumes", || vec![ok(real_volumes())]),
    contract("fileStationInfo", || vec![ok(real_file_station_info())]),
    contract("sharedFolders", || vec![ok(real_shared_folders())]),
    contract("networkOverview", || vec![ok(real_network_overview())]),
    contract("networkInterfaces", || vec![ok(real_network_interfaces())]),
    Contract {
        also: &["SYNO.Core.Security.Firewall.Rules"],
        ..contract("firewallRules", || {
            vec![
                ok(real_firewall_adapters()),
                ok(real_firewall_rules()),
                ok(real_firewall_rules_empty()),
            ]
        })
    },
    contract("users", || vec![ok(real_users())]),
    contract("groups", || vec![ok(real_groups())]),
    contract("packages", || vec![ok(real_packages())]),
    contract("services", || vec![ok(real_services())]),
    contract("smbConfig", || vec![ok(real_smb_config())]),
    contract("nfsConfig", || vec![ok(real_nfs_config())]),
    contract("sshConfig", || vec![ok(real_ssh_config())]),
    contract("dockerContainers", || vec![ok(real_docker_containers())]),
    contract("dockerImages", || vec![ok(real_docker_images())]),
    contract("dockerNetworks", || vec![ok(real_docker_networks())]),
    contract("dockerProjects", || vec![ok(real_docker_projects())]),
    Contract {
        alternative: 1,
        ..contract("dockerProjects", || vec![ok(real_docker_projects())])
    },
    contract("vms", || vec![ok(real_vms())]),
    contract("downloadTasks", || vec![ok(real_download_tasks())]),
    contract("downloadStats", || vec![ok(real_download_stats())]),
    contract("cameras", || vec![ok(real_cameras())]),
    contract("backupTasks", || vec![ok(real_backup_tasks())]),
    contract("activeBackupDevices", || {
        vec![ok(real_active_backup_devices())]
    }),
    contract("securityOverview", || vec![ok(real_security_overview())]),
    contract("blockedIps", || vec![ok(real_blocked_ips())]),
    contract("certificates", || vec![ok(real_certificates())]),
    contract("autoBlockConfig", || vec![ok(real_auto_block_config())]),
    contract("upsInfo", || vec![ok(real_ups_info())]),
    contract("powerSchedule", || vec![ok(real_power_schedule())]),
    contract("systemLogs", || vec![ok(real_system_logs())]),
    contract("connectionLogs", || vec![ok(real_connection_logs())]),
];

/// The panel loader of `field`, with the arguments the renderer passes, as
/// its IPC JSON.
async fn load(service: &SynologyService, field: &str) -> Result<Value, SynologyError> {
    fn ipc<T: serde::Serialize>(result: Result<T, SynologyError>) -> Result<Value, SynologyError> {
        result.map(|value| serde_json::to_value(value).unwrap())
    }
    match field {
        "systemInfo" => ipc(service.get_system_info().await),
        "utilization" => ipc(service.get_utilization().await),
        "storageOverview" => ipc(service.get_storage_overview().await),
        "disks" => ipc(service.list_disks().await),
        "volumes" => ipc(service.list_volumes().await),
        "fileStationInfo" => ipc(service.get_file_station_info().await),
        "sharedFolders" => ipc(service.list_shared_folders().await),
        "networkOverview" => ipc(service.get_network_overview().await),
        "networkInterfaces" => ipc(service.list_network_interfaces().await),
        "firewallRules" => ipc(service.list_firewall_rules().await),
        "users" => ipc(service.list_users().await),
        "groups" => ipc(service.list_groups().await),
        "packages" => ipc(service.list_packages().await),
        "services" => ipc(service.list_services().await),
        "smbConfig" => ipc(service.get_smb_config().await),
        "nfsConfig" => ipc(service.get_nfs_config().await),
        "sshConfig" => ipc(service.get_ssh_config().await),
        "dockerContainers" => ipc(service.list_docker_containers().await),
        "dockerImages" => ipc(service.list_docker_images().await),
        "dockerNetworks" => ipc(service.list_docker_networks().await),
        "dockerProjects" => ipc(service.list_docker_projects().await),
        "vms" => ipc(service.list_vms().await),
        "downloadTasks" => ipc(service.list_download_tasks().await),
        "downloadStats" => ipc(service.get_download_stats().await),
        "cameras" => ipc(service.list_cameras().await),
        "backupTasks" => ipc(service.list_backup_tasks().await),
        "activeBackupDevices" => ipc(service.list_active_backup_devices().await),
        "securityOverview" => ipc(service.get_security_overview().await),
        "blockedIps" => ipc(service.list_blocked_ips().await),
        "certificates" => ipc(service.list_certificates().await),
        "autoBlockConfig" => ipc(service.get_auto_block_config().await),
        "upsInfo" => ipc(service.get_ups_info().await),
        "powerSchedule" => ipc(service.get_power_schedule().await),
        // The logs view pages 100 rows from the start.
        "systemLogs" => ipc(service.get_system_logs(0, 100).await),
        "connectionLogs" => ipc(service.get_connection_logs(0, 100).await),
        other => panic!("no loader for {other}"),
    }
}

fn loader_only(field: &str) -> &'static [&'static str] {
    LOADER_ONLY
        .iter()
        .find(|(name, _)| *name == field)
        .map(|&(_, keys)| keys)
        .unwrap_or_default()
}

/// Where the loader's first request differs from the probe's `call`. `limit`
/// is compared by presence only: the probe pages one row, the loader a view.
fn drift(
    call: &ReadCall,
    (api, method, version): (&str, &str, u32),
    fields: &HashMap<String, String>,
    json_format: bool,
    loader_only: &[&str],
) -> Vec<String> {
    let mut drift = Vec::new();
    if (api, method, version) != (call.api, call.method, call.max_version) {
        drift.push(format!(
            "loader sends {api} {method} v{version}, probe {} {} v{}",
            call.api, call.method, call.max_version
        ));
    }
    let strings = call.string_params.iter().map(|(key, value)| {
        let value = if json_format {
            Value::String((*value).to_owned()).to_string()
        } else {
            (*value).to_owned()
        };
        (*key, value)
    });
    let expected: Vec<(&str, String)> = call
        .params
        .iter()
        .map(|(key, value)| (*key, (*value).to_owned()))
        .chain(strings)
        .collect();
    for (key, value) in &expected {
        match fields.get(*key) {
            None => drift.push(format!("loader omits {key}")),
            Some(sent) if *key == "limit" => {
                if !sent.parse::<u64>().is_ok_and(|limit| limit >= 1) {
                    drift.push(format!("loader pages {key}={sent}"));
                }
            }
            Some(sent) if sent != value => {
                drift.push(format!("loader sends {key}={sent}, probe {key}={value}"))
            }
            Some(_) => {}
        }
    }
    let mut extra: Vec<&str> = fields
        .keys()
        .map(String::as_str)
        .filter(|key| {
            *key != "_sid"
                && !loader_only.contains(key)
                && !expected.iter().any(|(expected, _)| expected == key)
        })
        .collect();
    extra.sort_unstable();
    for key in extra {
        drift.push(format!("probe omits {key}={}", fields[key]));
    }
    drift
}

#[test]
fn contracts_cover_every_read_alternative_except_the_f1_absences() {
    let covered: Vec<(&str, usize)> = CONTRACTS
        .iter()
        .map(|contract| (contract.field, contract.alternative))
        .collect();
    let expected: Vec<(&str, usize)> = READS
        .iter()
        .filter(|spec| !F1_ABSENT.contains(&spec.field))
        .flat_map(|spec| (0..spec.alternatives.len()).map(move |index| (spec.field, index)))
        .collect();
    assert_eq!(covered, expected);
    let fields: BTreeSet<&str> = covered.iter().map(|(field, _)| *field).collect();
    assert_eq!(fields.len(), 35);
    for field in F1_ABSENT {
        assert!(read_spec(field).is_some(), "{field}");
    }
    for (field, keys) in LOADER_ONLY {
        assert!(fields.contains(field), "{field}");
        let call = &read_spec(field).unwrap().alternatives[0];
        for key in keys {
            assert!(
                !call
                    .params
                    .iter()
                    .chain(call.string_params)
                    .any(|(name, _)| name == key),
                "{field}: {key} is probed"
            );
        }
    }
}

#[tokio::test]
async fn every_read_decodes_its_real_shape_and_its_first_request_is_the_probe_call() {
    // Every contract runs; the failures of all of them are reported together.
    let mut failures = Vec::new();
    let mut checked = 0;
    for contract in &CONTRACTS {
        let call = &read_spec(contract.field).unwrap().alternatives[contract.alternative];
        for format in [Some("JSON"), None] {
            let apis: Vec<(&str, u32, Option<&str>)> = std::iter::once(call.api)
                .chain(contract.also.iter().copied())
                .map(|api| (api, DISCOVERED_MAX, format))
                .collect();
            let responses = (contract.responses)();
            let expected_requests = responses.len();
            let (service, nas) = service_with_format(&apis, responses).await;
            let label = format!(
                "{} (alternative {}, requestFormat {format:?})",
                contract.field, contract.alternative
            );
            checked += 1;

            match load(&service, contract.field).await {
                Ok(Value::Array(rows)) if rows.is_empty() => {
                    failures.push(format!("{label}: no rows decoded"))
                }
                Ok(Value::Array(_) | Value::Object(_)) => {}
                Ok(other) => failures.push(format!("{label}: decoded {other}")),
                Err(error) => failures.push(format!("{label}: {error}")),
            }
            let sent = nas.requests().len();
            if sent != expected_requests {
                failures.push(format!(
                    "{label}: {sent} requests, expected {expected_requests}"
                ));
            }
            if sent == 0 {
                continue;
            }

            let first = (
                request_api(&nas, 0),
                request_method(&nas, 0),
                request_version(&nas, 0),
            );
            let differences = drift(
                call,
                (&first.0, &first.1, first.2),
                &nas.requests()[0].fields,
                format.is_some(),
                loader_only(contract.field),
            );
            failures.extend(
                differences
                    .into_iter()
                    .map(|difference| format!("{label}: {difference}")),
            );
        }
    }
    assert_eq!(checked, 72);
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
fn the_drift_guard_reports_every_difference_from_the_probe_call() {
    let services = &read_spec("services").unwrap().alternatives[0];
    let logs = &read_spec("systemLogs").unwrap().alternatives[0];
    let fields = |pairs: &[(&str, &str)]| -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    };
    let loader = fields(&[
        ("start", "0"),
        ("offset", "0"),
        ("limit", "100"),
        ("target", "\"LOCAL\""),
        ("logtype", "\"system\""),
        ("_sid", "fixture-sid"),
    ]);
    let request = ("SYNO.Core.SyslogClient.Log", "list", 1);
    assert!(drift(logs, request, &loader, true, &[]).is_empty());

    // A plain-format API gets raw strings; quoted ones are drift.
    assert_eq!(
        drift(logs, request, &loader, false, &[]),
        [
            "loader sends target=\"LOCAL\", probe target=LOCAL",
            "loader sends logtype=\"system\", probe logtype=system",
        ]
    );
    // Method, version and API changes.
    assert_eq!(
        drift(logs, ("SYNO.Core.SyslogClient.Log", "load", 2), &loader, true, &[]),
        ["loader sends SYNO.Core.SyslogClient.Log load v2, probe SYNO.Core.SyslogClient.Log list v1"]
    );
    // A dropped, a changed and an added parameter; an unusable page size.
    let changed = fields(&[
        ("offset", "5"),
        ("limit", "0"),
        ("target", "\"LOCAL\""),
        ("logtype", "\"system\""),
        ("type", "\"all\""),
    ]);
    assert_eq!(
        drift(logs, request, &changed, true, &[]),
        [
            "loader omits start",
            "loader sends offset=5, probe offset=0",
            "loader pages limit=0",
            "probe omits type=\"all\"",
        ]
    );
    assert!(drift(logs, request, &changed, true, &["type"]).len() == 3);
    // The services probe asks for the run state like the loader.
    assert_eq!(
        drift(
            services,
            ("SYNO.Core.Service", "get", 3),
            &fields(&[]),
            true,
            &[]
        ),
        ["loader omits additional"]
    );
}

// ── Dashboard ───────────────────────────────────────────────────────

/// Warnings logged on this test's thread (a current-thread tokio test polls
/// the dashboard there).
struct WarningCapture;

static WARNINGS: Mutex<Vec<(ThreadId, String)>> = Mutex::new(Vec::new());
static CAPTURE: WarningCapture = WarningCapture;

impl log::Log for WarningCapture {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Warn
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            WARNINGS
                .lock()
                .unwrap()
                .push((thread::current().id(), record.args().to_string()));
        }
    }

    fn flush(&self) {}
}

fn capture_warnings() {
    // Another test may have installed it already.
    let _ = log::set_logger(&CAPTURE);
    log::set_max_level(log::LevelFilter::Warn);
}

fn warnings_on_this_thread() -> Vec<String> {
    let thread = thread::current().id();
    WARNINGS
        .lock()
        .unwrap()
        .iter()
        .filter(|(logged_on, _)| *logged_on == thread)
        .map(|(_, message)| message.clone())
        .collect()
}

const DSM_INFO: &str = "SYNO.DSM.Info";
const UTILIZATION: &str = "SYNO.Core.System.Utilization";
const STORAGE: &str = "SYNO.Storage.CGI.Storage";
const NETWORK: &str = "SYNO.Core.Network";

#[tokio::test]
async fn dashboard_keeps_readable_parts_when_utilization_does_not_decode() {
    capture_warnings();
    let (service, nas) = service_with(
        &[(DSM_INFO, 2), (UTILIZATION, 1), (STORAGE, 1), (NETWORK, 1)],
        vec![
            ok(real_system_info()),
            ok(json!({"cpu": "fixture-private-body", "memory": {}})),
            ok(real_storage_overview()),
            ok(real_network_overview()),
            // The hardware part falls back to DSM.Info.
            ok(real_system_info()),
        ],
    )
    .await;

    let dashboard = service.get_dashboard().await.unwrap();
    assert!(dashboard.utilization.is_none());
    assert_eq!(dashboard.system_info.unwrap().model, "DS918+");
    assert_eq!(dashboard.storage.unwrap().volumes.len(), 1);
    assert_eq!(dashboard.network.unwrap().hostname, "fixture-nas");
    assert!(dashboard.hardware.is_some());
    assert_eq!(nas.requests().len(), 5);
    assert_eq!(
        warnings_on_this_thread(),
        ["Synology dashboard part utilization unavailable (ParseError)"]
    );
}

#[tokio::test]
async fn dashboard_logs_only_the_closed_error_kind_of_each_failed_part() {
    capture_warnings();
    let (service, nas) = service_with(
        &[(DSM_INFO, 2), (UTILIZATION, 1), (STORAGE, 1)],
        vec![
            dsm_error(105),
            dsm_error(120),
            ok(json!({"disks": [], "volumes": "fixture-private-body"})),
            // The hardware fallback gets the fixture's code 999.
        ],
    )
    .await;

    let dashboard = service.get_dashboard().await.unwrap();
    assert_eq!(
        serde_json::to_value(&dashboard).unwrap(),
        json!({"systemInfo": null, "utilization": null, "storage": null, "network": null, "hardware": null})
    );
    // Network was never discovered, so it sends nothing.
    assert_eq!(nas.requests().len(), 4);
    let warnings = warnings_on_this_thread();
    assert_eq!(
        warnings,
        [
            "Synology dashboard part system_info unavailable (PermissionDenied)",
            "Synology dashboard part utilization unavailable (ApiError(120))",
            "Synology dashboard part storage unavailable (ParseError)",
            "Synology dashboard part network unavailable (ApiNotFound)",
            "Synology dashboard part hardware unavailable (ApiError(999))",
        ]
    );
    let port = service.client.as_ref().unwrap().config.port.to_string();
    for warning in &warnings {
        for private in ["fixture", "SYNO.", "code", "127.0.0.1", "http", &port] {
            assert!(!warning.contains(private), "{warning} contains {private}");
        }
    }
}
