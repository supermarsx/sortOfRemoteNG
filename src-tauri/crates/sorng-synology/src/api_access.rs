//! Static DSM access facts: which account class DSM allows for every API this
//! crate calls, and which read backs every field of the admin panel.
//!
//! Privileges come from DSM's own web API definitions (`allowUser`, `appPriv`
//! in the DSM 6/7 `.lib` files). APIs that belong to an optional package are
//! absent from `SYNO.API.Info` until the package is installed; their packages
//! are administrator-only in DSM. The tables are data only: nothing here talks
//! to a NAS, and the role of an account never hides a read DSM might allow
//! (delegated administration), it only chooses the explanation.

/// A DSM application privilege (Control Panel › Application Privileges).
#[derive(Debug, PartialEq, Eq)]
pub struct AppPrivilege {
    /// Name shown in DSM, e.g. "File Station".
    pub name: &'static str,
    /// DSM's application id, as used by `appPriv` and `Initdata.AppPrivilege`.
    pub dsm_id: &'static str,
}

pub static FILE_STATION: AppPrivilege = AppPrivilege {
    name: "File Station",
    dsm_id: "SYNO.SDS.App.FileStation3.Instance",
};
pub static DOWNLOAD_STATION: AppPrivilege = AppPrivilege {
    name: "Download Station",
    dsm_id: "SYNO.SDS.DownloadStation",
};
pub static SURVEILLANCE_STATION: AppPrivilege = AppPrivilege {
    name: "Surveillance Station",
    dsm_id: "SYNO.SDS.SurveillanceStation",
};

/// Account class DSM allows for an API.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiPrivilege {
    AnyUser,
    Administrator,
    Application(&'static AppPrivilege),
}

#[derive(Debug)]
pub struct ApiSpec {
    pub api: &'static str,
    pub privilege: ApiPrivilege,
    /// Package that provides the API, when it is not part of DSM itself.
    pub package: Option<&'static str>,
}

const CONTAINER_MANAGER: &str = "Container Manager";
const VIRTUAL_MACHINE_MANAGER: &str = "Virtual Machine Manager";
const HYPER_BACKUP: &str = "Hyper Backup";
const ACTIVE_BACKUP: &str = "Active Backup for Business";

const fn any(api: &'static str) -> ApiSpec {
    ApiSpec {
        api,
        privilege: ApiPrivilege::AnyUser,
        package: None,
    }
}
const fn admin(api: &'static str) -> ApiSpec {
    ApiSpec {
        api,
        privilege: ApiPrivilege::Administrator,
        package: None,
    }
}
const fn admin_package(api: &'static str, package: &'static str) -> ApiSpec {
    ApiSpec {
        api,
        privilege: ApiPrivilege::Administrator,
        package: Some(package),
    }
}
const fn app(api: &'static str, privilege: &'static AppPrivilege) -> ApiSpec {
    ApiSpec {
        api,
        privilege: ApiPrivilege::Application(privilege),
        package: None,
    }
}
const fn app_package(api: &'static str, privilege: &'static AppPrivilege) -> ApiSpec {
    ApiSpec {
        api,
        privilege: ApiPrivilege::Application(privilege),
        package: Some(privilege.name),
    }
}

/// Every `SYNO.*` API this crate calls, sorted by name.
pub static API_PRIVILEGES: &[ApiSpec] = &[
    admin_package("SYNO.ActiveBackup.Device", ACTIVE_BACKUP),
    admin_package("SYNO.ActiveBackup.Overview", ACTIVE_BACKUP),
    any("SYNO.API.Auth"),
    any("SYNO.API.Auth.Type"),
    any("SYNO.API.Auth.UIConfig"),
    any("SYNO.API.Info"),
    admin_package("SYNO.Backup.Repository", HYPER_BACKUP),
    admin_package("SYNO.Backup.Task", HYPER_BACKUP),
    admin_package("SYNO.ContainerManager.Project", CONTAINER_MANAGER),
    admin("SYNO.Core.Certificate.CRT"),
    admin("SYNO.Core.Certificate.LetsEncrypt"),
    any("SYNO.Core.CurrentConnection"),
    admin("SYNO.Core.DDNS.Record"),
    any("SYNO.Core.Desktop.Initdata"),
    // Not in any DSM catalog (the real API is Core.Network.DHCPServer.ClientList).
    admin("SYNO.Core.DHCP.Server"),
    admin("SYNO.Core.ExternalDevice.UPS"),
    admin("SYNO.Core.FileServ.FTP"),
    admin("SYNO.Core.FileServ.NFS"),
    // Rsync and WebDAV are not in the definitions; configured like the other file services.
    admin("SYNO.Core.FileServ.Rsync"),
    admin("SYNO.Core.FileServ.SMB"),
    admin("SYNO.Core.FileServ.WebDAV"),
    admin("SYNO.Core.Group"),
    admin("SYNO.Core.Group.Member"),
    admin("SYNO.Core.Hardware.BeepControl"),
    // Not in any DSM catalog; the hardware read falls back to SYNO.DSM.Info.
    admin("SYNO.Core.Hardware.Info"),
    admin("SYNO.Core.Hardware.Led.Brightness"),
    admin("SYNO.Core.Hardware.PowerSchedule"),
    admin("SYNO.Core.ISCSI.LUN"),
    admin("SYNO.Core.ISCSI.Target"),
    admin("SYNO.Core.Network"),
    admin("SYNO.Core.Network.Interface"),
    admin("SYNO.Core.Network.Proxy"),
    admin("SYNO.Core.Network.VPN.PPTP"),
    admin("SYNO.Core.Network.VPN.Profile"),
    admin("SYNO.Core.Notification.Event"),
    admin("SYNO.Core.Notification.Mail"),
    admin("SYNO.Core.Notification.Push.Mobile"),
    // Not in any DSM catalog; the notifications section reports it as not provided.
    admin("SYNO.Core.Notification.Setting"),
    admin("SYNO.Core.Notification.SMS"),
    admin("SYNO.Core.Package"),
    admin("SYNO.Core.Package.Control"),
    admin("SYNO.Core.Package.Feed"),
    admin("SYNO.Core.Package.Installation"),
    admin("SYNO.Core.Package.Server"),
    admin("SYNO.Core.Package.Uninstallation"),
    admin("SYNO.Core.Quota"),
    admin("SYNO.Core.Security.AutoBlock"),
    admin("SYNO.Core.Security.AutoBlock.Rules"),
    admin("SYNO.Core.Security.Firewall"),
    admin("SYNO.Core.Security.Firewall.Adapter"),
    admin("SYNO.Core.Security.Firewall.Rules"),
    admin("SYNO.Core.SecurityScan.Status"),
    admin("SYNO.Core.Service"),
    admin("SYNO.Core.Share"),
    admin("SYNO.Core.Share.Permission"),
    admin("SYNO.Core.Share.Snapshot"),
    admin("SYNO.Core.SyslogClient.Log"),
    admin("SYNO.Core.System"),
    admin("SYNO.Core.System.Process"),
    admin("SYNO.Core.System.Utilization"),
    admin("SYNO.Core.Terminal"),
    admin("SYNO.Core.Upgrade.Server"),
    admin("SYNO.Core.User"),
    admin_package("SYNO.Docker.Container", CONTAINER_MANAGER),
    admin_package("SYNO.Docker.Container.Log", CONTAINER_MANAGER),
    admin_package("SYNO.Docker.Container.Resource", CONTAINER_MANAGER),
    admin_package("SYNO.Docker.Image", CONTAINER_MANAGER),
    admin_package("SYNO.Docker.Network", CONTAINER_MANAGER),
    admin_package("SYNO.Docker.Project", CONTAINER_MANAGER),
    admin_package("SYNO.Docker.Registry", CONTAINER_MANAGER),
    app_package("SYNO.DownloadStation.Info", &DOWNLOAD_STATION),
    app_package("SYNO.DownloadStation.RSS.Site", &DOWNLOAD_STATION),
    app_package("SYNO.DownloadStation.Statistic", &DOWNLOAD_STATION),
    app_package("SYNO.DownloadStation.Task", &DOWNLOAD_STATION),
    any("SYNO.DSM.Info"),
    app("SYNO.FileStation.BackgroundTask", &FILE_STATION),
    app("SYNO.FileStation.CopyMove", &FILE_STATION),
    app("SYNO.FileStation.CreateFolder", &FILE_STATION),
    app("SYNO.FileStation.Delete", &FILE_STATION),
    app("SYNO.FileStation.Download", &FILE_STATION),
    app("SYNO.FileStation.Info", &FILE_STATION),
    app("SYNO.FileStation.List", &FILE_STATION),
    app("SYNO.FileStation.Rename", &FILE_STATION),
    app("SYNO.FileStation.Search", &FILE_STATION),
    app("SYNO.FileStation.Sharing", &FILE_STATION),
    app("SYNO.FileStation.Upload", &FILE_STATION),
    admin("SYNO.Storage.CGI.Smart"),
    admin("SYNO.Storage.CGI.Storage"),
    app_package("SYNO.SurveillanceStation.Camera", &SURVEILLANCE_STATION),
    app_package("SYNO.SurveillanceStation.HomeMode", &SURVEILLANCE_STATION),
    app_package("SYNO.SurveillanceStation.Info", &SURVEILLANCE_STATION),
    app_package("SYNO.SurveillanceStation.PTZ", &SURVEILLANCE_STATION),
    app_package("SYNO.SurveillanceStation.Recording", &SURVEILLANCE_STATION),
    admin_package("SYNO.Virtualization.API.Guest", VIRTUAL_MACHINE_MANAGER),
    admin_package(
        "SYNO.Virtualization.API.Guest.Action",
        VIRTUAL_MACHINE_MANAGER,
    ),
    admin_package("SYNO.Virtualization.API.Network", VIRTUAL_MACHINE_MANAGER),
];

pub fn privilege_for(api: &str) -> Option<&'static ApiSpec> {
    API_PRIVILEGES.iter().find(|spec| spec.api == api)
}

/// One read-only DSM call. The probe sends exactly this API, method and
/// parameters (never anything from the renderer) at
/// `best_version(api, max_version)`. It is the first request its manager
/// sends, with a one-row page where the manager pages.
#[derive(Debug, PartialEq, Eq)]
pub struct ReadCall {
    pub api: &'static str,
    pub max_version: u32,
    pub method: &'static str,
    /// Sent as written.
    pub params: &'static [(&'static str, &'static str)],
    /// String values, sent after `params` and JSON-quoted when discovery
    /// declares the API's `requestFormat: "JSON"`, as `wire::string_param`
    /// does for the managers.
    pub string_params: &'static [(&'static str, &'static str)],
}

impl ReadCall {
    const fn with(mut self, params: &'static [(&'static str, &'static str)]) -> Self {
        self.params = params;
        self
    }

    const fn with_strings(
        mut self,
        string_params: &'static [(&'static str, &'static str)],
    ) -> Self {
        self.string_params = string_params;
        self
    }
}

/// A panel field and the calls that can read it. The first alternative present
/// in `SYNO.API.Info` is probed, as its manager does.
#[derive(Debug)]
pub struct ReadSpec {
    pub field: &'static str,
    pub alternatives: &'static [ReadCall],
}

const PAGE: &[(&str, &str)] = &[("offset", "0"), ("limit", "1")];

const fn call(api: &'static str, max_version: u32, method: &'static str) -> ReadCall {
    ReadCall {
        api,
        max_version,
        method,
        params: &[],
        string_params: &[],
    }
}
const fn page(api: &'static str, max_version: u32, method: &'static str) -> ReadCall {
    call(api, max_version, method).with(PAGE)
}
const fn read(field: &'static str, alternatives: &'static [ReadCall]) -> ReadSpec {
    ReadSpec {
        field,
        alternatives,
    }
}

const DSM_INFO: ReadCall = call("SYNO.DSM.Info", 2, "getinfo");
const STORAGE: ReadCall = call("SYNO.Storage.CGI.Storage", 1, "load_info");

/// Every field of `SynologyAdminData` (except `dashboard` and
/// `selectedDiskSmart`) plus `fileStationInfo`, with the managers' API, method
/// and maximum version. Paging reads ask for one row.
pub static READS: &[ReadSpec] = &[
    read("systemInfo", &[DSM_INFO]),
    read(
        "utilization",
        &[call("SYNO.Core.System.Utilization", 1, "get")],
    ),
    read("storageOverview", &[STORAGE]),
    read("disks", &[STORAGE]),
    read("volumes", &[STORAGE]),
    read(
        "fileStationInfo",
        &[call("SYNO.FileStation.Info", 2, "get")],
    ),
    read("sharedFolders", &[page("SYNO.Core.Share", 1, "list")]),
    read("networkOverview", &[call("SYNO.Core.Network", 1, "get")]),
    read(
        "networkInterfaces",
        &[call("SYNO.Core.Network.Interface", 1, "list")],
    ),
    // Rules are read per adapter (`Firewall.Rules load`); the adapter list
    // comes first.
    read(
        "firewallRules",
        &[call("SYNO.Core.Security.Firewall.Adapter", 1, "list")],
    ),
    read("users", &[page("SYNO.Core.User", 1, "list")]),
    read("groups", &[page("SYNO.Core.Group", 1, "list")]),
    read("packages", &[call("SYNO.Core.Package", 1, "list")]),
    read(
        "services",
        &[call("SYNO.Core.Service", 3, "get").with(&[("additional", r#"["active_status"]"#)])],
    ),
    read("smbConfig", &[call("SYNO.Core.FileServ.SMB", 3, "get")]),
    read("nfsConfig", &[call("SYNO.Core.FileServ.NFS", 2, "get")]),
    read("sshConfig", &[call("SYNO.Core.Terminal", 3, "get")]),
    read(
        "dockerContainers",
        &[page("SYNO.Docker.Container", 1, "list").with_strings(&[("type", "all")])],
    ),
    read("dockerImages", &[page("SYNO.Docker.Image", 1, "list")]),
    read("dockerNetworks", &[call("SYNO.Docker.Network", 1, "list")]),
    read(
        "dockerProjects",
        &[
            call("SYNO.ContainerManager.Project", 1, "list"),
            call("SYNO.Docker.Project", 1, "list"),
        ],
    ),
    read("vms", &[call("SYNO.Virtualization.API.Guest", 1, "list")]),
    read(
        "downloadTasks",
        &[page("SYNO.DownloadStation.Task", 3, "list")],
    ),
    read(
        "downloadStats",
        &[call("SYNO.DownloadStation.Statistic", 1, "getinfo")],
    ),
    read(
        "cameras",
        &[call("SYNO.SurveillanceStation.Camera", 9, "List")],
    ),
    read(
        "backupTasks",
        &[call("SYNO.Backup.Task", 1, "list").with(&[(
            "additional",
            r#"["last_bkp_time","next_bkp_time","last_bkp_result","is_modified"]"#,
        )])],
    ),
    read(
        "activeBackupDevices",
        &[call("SYNO.ActiveBackup.Device", 1, "list")],
    ),
    read(
        "securityOverview",
        &[call("SYNO.Core.SecurityScan.Status", 1, "system_get")],
    ),
    // DSM answers the list without parameters with 5100; these names are
    // unverified (audit S§7 #1), like the manager's.
    read(
        "blockedIps",
        &[page("SYNO.Core.Security.AutoBlock.Rules", 1, "list").with_strings(&[("type", "deny")])],
    ),
    read(
        "certificates",
        &[call("SYNO.Core.Certificate.CRT", 1, "list")],
    ),
    read(
        "autoBlockConfig",
        &[call("SYNO.Core.Security.AutoBlock", 1, "get")],
    ),
    read(
        "hardwareInfo",
        &[call("SYNO.Core.Hardware.Info", 1, "get"), DSM_INFO],
    ),
    read("upsInfo", &[call("SYNO.Core.ExternalDevice.UPS", 1, "get")]),
    read(
        "powerSchedule",
        &[call("SYNO.Core.Hardware.PowerSchedule", 1, "load")],
    ),
    read(
        "systemLogs",
        &[call("SYNO.Core.SyslogClient.Log", 1, "list")
            .with(&[("start", "0"), ("offset", "0"), ("limit", "1")])
            .with_strings(&[("target", "LOCAL"), ("logtype", "system")])],
    ),
    read(
        "connectionLogs",
        &[page("SYNO.Core.CurrentConnection", 2, "list")],
    ),
    read(
        "notificationConfig",
        &[call("SYNO.Core.Notification.Setting", 1, "get")],
    ),
];

pub fn read_spec(field: &str) -> Option<&'static ReadSpec> {
    READS.iter().find(|spec| spec.field == field)
}

/// Canonical section → read fields. Must equal the frontend's
/// `SYNOLOGY_SECTION_READS` (`src/utils/synology/synologyAccess.ts`).
pub static SECTION_READS: &[(&str, &[&str])] = &[
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

pub fn section_reads(section: &str) -> Option<(&'static str, &'static [&'static str])> {
    SECTION_READS
        .iter()
        .find(|(name, _)| *name == section)
        .copied()
}

#[cfg(test)]
#[path = "api_access_tests.rs"]
mod tests;
