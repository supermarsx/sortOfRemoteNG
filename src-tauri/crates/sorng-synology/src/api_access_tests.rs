use super::*;
use std::collections::{BTreeMap, BTreeSet};

/// Sources of every manager module plus the session code that calls DSM.
const SOURCES: [(&str, &str); 24] = [
    ("system.rs", include_str!("system.rs")),
    ("storage.rs", include_str!("storage.rs")),
    ("file_station.rs", include_str!("file_station.rs")),
    ("shares.rs", include_str!("shares.rs")),
    ("network.rs", include_str!("network.rs")),
    ("users.rs", include_str!("users.rs")),
    ("packages.rs", include_str!("packages.rs")),
    ("services.rs", include_str!("services.rs")),
    ("docker.rs", include_str!("docker.rs")),
    ("virtualization.rs", include_str!("virtualization.rs")),
    ("download_station.rs", include_str!("download_station.rs")),
    ("surveillance.rs", include_str!("surveillance.rs")),
    ("backup.rs", include_str!("backup.rs")),
    ("security.rs", include_str!("security.rs")),
    ("hardware.rs", include_str!("hardware.rs")),
    ("logs.rs", include_str!("logs.rs")),
    ("notifications.rs", include_str!("notifications.rs")),
    ("auth.rs", include_str!("auth.rs")),
    ("client.rs", include_str!("client.rs")),
    ("login_handshake.rs", include_str!("login_handshake.rs")),
    ("scoped_files.rs", include_str!("scoped_files.rs")),
    ("file_transfer.rs", include_str!("file_transfer.rs")),
    ("file_viewers.rs", include_str!("file_viewers.rs")),
    ("service.rs", include_str!("service.rs")),
];

/// Frontend `SYNOLOGY_SECTION_READS`, copied from
/// `src/utils/synology/synologyAccess.ts:84-121`.
const TS_SECTION_READS: [(&str, &[&str]); 18] = [
    (
        "dashboard",
        &[
            "systemInfo",
            "utilization",
            "storageOverview",
            "networkOverview",
        ],
    ),
    ("system", &["systemInfo", "utilization"]),
    ("storage", &["storageOverview", "disks", "volumes"]),
    ("fileStation", &["fileStationInfo"]),
    ("shares", &["sharedFolders"]),
    (
        "network",
        &["networkOverview", "networkInterfaces", "firewallRules"],
    ),
    ("users", &["users", "groups"]),
    ("packages", &["packages"]),
    (
        "services",
        &["services", "smbConfig", "nfsConfig", "sshConfig"],
    ),
    (
        "docker",
        &[
            "dockerContainers",
            "dockerImages",
            "dockerNetworks",
            "dockerProjects",
        ],
    ),
    ("vms", &["vms"]),
    ("downloads", &["downloadTasks", "downloadStats"]),
    ("surveillance", &["cameras"]),
    ("backup", &["backupTasks", "activeBackupDevices"]),
    (
        "security",
        &[
            "securityOverview",
            "blockedIps",
            "certificates",
            "autoBlockConfig",
        ],
    ),
    ("hardware", &["hardwareInfo", "upsInfo", "powerSchedule"]),
    ("logs", &["systemLogs", "connectionLogs"]),
    ("notifications", &["notificationConfig"]),
];

/// Read-only DSM methods; a probe must never call anything else.
const READ_METHODS: [&str; 9] = [
    "get",
    "getinfo",
    "list",
    "load",
    "load_info",
    "List",
    "system_get",
    "list_all",
    "list_device",
];

fn api_literals(source: &str) -> BTreeSet<String> {
    source
        .match_indices("\"SYNO.")
        .map(|(start, _)| {
            source[start + 1..]
                .chars()
                .take_while(|character| character.is_ascii_alphanumeric() || *character == '.')
                .collect::<String>()
        })
        // `"SYNO.FileStation."` is a prefix match, not an API.
        .filter(|api| !api.ends_with('.'))
        .collect()
}

fn valid_api_name(api: &str) -> bool {
    // Frontend `API_PATTERN`, synologyAccess.ts:268.
    api.strip_prefix("SYNO.").is_some_and(|rest| {
        (1..=120).contains(&rest.len())
            && rest
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.')
    })
}

#[test]
fn every_api_literal_the_crate_calls_has_a_privilege() {
    let mut missing = Vec::new();
    for (file, source) in SOURCES {
        for api in api_literals(source) {
            if privilege_for(&api).is_none() {
                missing.push(format!("{file}: {api}"));
            }
        }
    }
    assert!(missing.is_empty(), "missing privileges: {missing:?}");
    // The scan itself is live: it sees APIs in several managers.
    let found: BTreeSet<_> = SOURCES
        .iter()
        .flat_map(|(_, source)| api_literals(source))
        .collect();
    for api in [
        "SYNO.Core.System.Utilization",
        "SYNO.Docker.Container",
        "SYNO.FileStation.CopyMove",
        "SYNO.SurveillanceStation.Camera",
    ] {
        assert!(found.contains(api), "{api}");
    }
    assert!(found.len() > 85, "only {} API literals found", found.len());
}

#[test]
fn privilege_table_is_sorted_unique_and_names_valid_apis() {
    for pair in API_PRIVILEGES.windows(2) {
        assert!(
            pair[0].api.to_ascii_lowercase() < pair[1].api.to_ascii_lowercase(),
            "{} must sort before {}",
            pair[0].api,
            pair[1].api
        );
    }
    for spec in API_PRIVILEGES {
        assert!(valid_api_name(spec.api), "{}", spec.api);
        if let Some(package) = spec.package {
            // Frontend limit for `package`, synologyAccess.ts:340-344.
            assert!(!package.trim().is_empty() && package.len() <= 64);
        }
        if let ApiPrivilege::Application(app) = spec.privilege {
            assert!(!app.name.is_empty() && app.name.len() <= 64);
            assert!(app.dsm_id.starts_with("SYNO.SDS."));
        }
    }
}

#[test]
fn privilege_spot_checks_follow_dsm_definitions() {
    let spec = |api| privilege_for(api).unwrap();
    assert_eq!(
        spec("SYNO.Core.System.Utilization").privilege,
        ApiPrivilege::Administrator
    );
    assert_eq!(spec("SYNO.Core.System.Utilization").package, None);
    assert_eq!(spec("SYNO.DSM.Info").privilege, ApiPrivilege::AnyUser);
    assert_eq!(
        spec("SYNO.Core.CurrentConnection").privilege,
        ApiPrivilege::AnyUser
    );
    assert_eq!(
        spec("SYNO.Core.Desktop.Initdata").privilege,
        ApiPrivilege::AnyUser
    );
    assert_eq!(
        spec("SYNO.FileStation.List").privilege,
        ApiPrivilege::Application(&FILE_STATION)
    );
    assert_eq!(FILE_STATION.name, "File Station");
    assert_eq!(spec("SYNO.FileStation.List").package, None);
    assert_eq!(
        spec("SYNO.Docker.Container").package,
        Some("Container Manager")
    );
    assert_eq!(
        spec("SYNO.Docker.Container").privilege,
        ApiPrivilege::Administrator
    );
    assert_eq!(
        spec("SYNO.DownloadStation.Task").privilege,
        ApiPrivilege::Application(&DOWNLOAD_STATION)
    );
    assert_eq!(
        spec("SYNO.DownloadStation.Task").package,
        Some("Download Station")
    );
    assert_eq!(
        spec("SYNO.SurveillanceStation.Camera").privilege,
        ApiPrivilege::Application(&SURVEILLANCE_STATION)
    );
    assert_eq!(
        spec("SYNO.Virtualization.API.Guest").package,
        Some("Virtual Machine Manager")
    );
    assert_eq!(spec("SYNO.Backup.Task").package, Some("Hyper Backup"));
    assert_eq!(
        spec("SYNO.ActiveBackup.Overview").package,
        Some("Active Backup for Business")
    );
    assert!(privilege_for("SYNO.Fixture.Unknown").is_none());
}

#[test]
fn section_reads_equal_the_frontend_contract() {
    let rust: Vec<(&str, Vec<&str>)> = SECTION_READS
        .iter()
        .map(|(section, fields)| (*section, fields.to_vec()))
        .collect();
    let frontend: Vec<(&str, Vec<&str>)> = TS_SECTION_READS
        .iter()
        .map(|(section, fields)| (*section, fields.to_vec()))
        .collect();
    assert_eq!(rust, frontend);
    assert_eq!(SECTION_READS.len(), 18);
    let sections: BTreeSet<_> = SECTION_READS.iter().map(|(section, _)| section).collect();
    assert_eq!(sections.len(), 18);
    for (section, fields) in SECTION_READS {
        let unique: BTreeSet<_> = fields.iter().collect();
        assert_eq!(unique.len(), fields.len(), "{section}");
        assert!(!fields.is_empty());
        assert_eq!(section_reads(section), Some((*section, *fields)));
    }
    assert_eq!(section_reads("fixture-private-section"), None);
}

#[test]
fn every_read_field_belongs_to_exactly_the_listed_sections() {
    let mut membership: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (section, fields) in SECTION_READS {
        for field in *fields {
            membership.entry(field).or_default().push(section);
        }
    }
    let read_fields: BTreeSet<_> = READS.iter().map(|spec| spec.field).collect();
    assert_eq!(read_fields.len(), READS.len(), "READS fields are unique");
    assert_eq!(
        read_fields,
        membership.keys().copied().collect::<BTreeSet<_>>()
    );
    let expected: BTreeMap<&str, Vec<&str>> = [
        ("systemInfo", vec!["dashboard", "system"]),
        ("utilization", vec!["dashboard", "system"]),
        ("storageOverview", vec!["dashboard", "storage"]),
        ("networkOverview", vec!["dashboard", "network"]),
        ("disks", vec!["storage"]),
        ("volumes", vec!["storage"]),
        ("fileStationInfo", vec!["fileStation"]),
        ("sharedFolders", vec!["shares"]),
        ("networkInterfaces", vec!["network"]),
        ("firewallRules", vec!["network"]),
        ("users", vec!["users"]),
        ("groups", vec!["users"]),
        ("packages", vec!["packages"]),
        ("services", vec!["services"]),
        ("smbConfig", vec!["services"]),
        ("nfsConfig", vec!["services"]),
        ("sshConfig", vec!["services"]),
        ("dockerContainers", vec!["docker"]),
        ("dockerImages", vec!["docker"]),
        ("dockerNetworks", vec!["docker"]),
        ("dockerProjects", vec!["docker"]),
        ("vms", vec!["vms"]),
        ("downloadTasks", vec!["downloads"]),
        ("downloadStats", vec!["downloads"]),
        ("cameras", vec!["surveillance"]),
        ("backupTasks", vec!["backup"]),
        ("activeBackupDevices", vec!["backup"]),
        ("securityOverview", vec!["security"]),
        ("blockedIps", vec!["security"]),
        ("certificates", vec!["security"]),
        ("autoBlockConfig", vec!["security"]),
        ("hardwareInfo", vec!["hardware"]),
        ("upsInfo", vec!["hardware"]),
        ("powerSchedule", vec!["hardware"]),
        ("systemLogs", vec!["logs"]),
        ("connectionLogs", vec!["logs"]),
        ("notificationConfig", vec!["notifications"]),
    ]
    .into_iter()
    .collect();
    assert_eq!(membership, expected);
}

#[test]
fn read_calls_are_static_read_only_and_match_their_managers() {
    let sources: String = SOURCES.iter().map(|(_, source)| *source).collect();
    for spec in READS {
        assert!(!spec.alternatives.is_empty(), "{}", spec.field);
        assert_eq!(
            read_spec(spec.field).map(|found| found.field),
            Some(spec.field)
        );
        for call in spec.alternatives {
            assert!(privilege_for(call.api).is_some(), "{}", call.api);
            assert!(READ_METHODS.contains(&call.method), "{}", call.method);
            assert!((1..=10).contains(&call.max_version));
            assert!(
                call.params.is_empty() || call.params == [("offset", "0"), ("limit", "1")],
                "{}: only a one-row page is allowed",
                spec.field
            );
            assert!(
                sources.contains(&format!("\"{}\"", call.api)),
                "{}",
                call.api
            );
            assert!(
                sources.contains(&format!("\"{}\"", call.method)),
                "{}",
                call.method
            );
        }
    }
    assert!(read_spec("dashboard").is_none());
    assert!(read_spec("selectedDiskSmart").is_none());
}

#[test]
fn shared_calls_and_alternatives_follow_the_managers() {
    let apis = |field| {
        read_spec(field)
            .unwrap()
            .alternatives
            .iter()
            .map(|call| call.api)
            .collect::<Vec<_>>()
    };
    let storage = &read_spec("storageOverview").unwrap().alternatives[0];
    for field in ["disks", "volumes"] {
        assert_eq!(&read_spec(field).unwrap().alternatives[0], storage);
    }
    assert_eq!(storage.method, "load_info");
    assert_eq!(
        apis("hardwareInfo"),
        ["SYNO.Core.Hardware.Info", "SYNO.DSM.Info"]
    );
    assert_eq!(
        read_spec("hardwareInfo").unwrap().alternatives[1],
        read_spec("systemInfo").unwrap().alternatives[0]
    );
    assert_eq!(
        apis("dockerProjects"),
        ["SYNO.ContainerManager.Project", "SYNO.Docker.Project"]
    );
    assert_eq!(apis("utilization"), ["SYNO.Core.System.Utilization"]);
    let paged: BTreeSet<_> = READS
        .iter()
        .filter(|spec| !spec.alternatives[0].params.is_empty())
        .map(|spec| spec.field)
        .collect();
    assert_eq!(
        paged,
        BTreeSet::from([
            "connectionLogs",
            "dockerContainers",
            "dockerImages",
            "downloadTasks",
            "groups",
            "sharedFolders",
            "systemLogs",
            "users",
        ])
    );
}
