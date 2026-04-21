//! Shared types for the Proxmox VE management crate.
//!
//! All types use `#[serde(rename_all = "camelCase")]` for TypeScript interop,
//! with `#[serde(alias = "...")]` where the PVE API uses snake_case or
//! other casing so we can deserialise API responses AND serialise to the frontend.

use serde::{Deserialize, Serialize};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Connection / Config
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Authentication method for connecting to PVE.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "method")]
pub enum ProxmoxAuthMethod {
    /// Username + password → ticket + CSRFPreventionToken
    Password {
        username: String,
        password: String,
        /// Optional realm (e.g. "pam", "pve", "ldap").  Defaults to "pam".
        #[serde(default = "default_realm")]
        realm: String,
        /// Optional OTP / TFA code
        #[serde(default)]
        otp: Option<String>,
    },
    /// API Token (PVEAPIToken header)
    ApiToken { token_id: String, secret: String },
}

fn default_realm() -> String {
    "pam".into()
}

/// Top-level configuration for connecting to a Proxmox VE host.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxmoxConfig {
    /// Hostname or IP of the PVE node (e.g. "pve.lab.local")
    pub host: String,
    /// Port (default 8006)
    #[serde(default = "default_port")]
    pub port: u16,
    /// Authentication method
    pub auth: ProxmoxAuthMethod,
    /// Skip TLS certificate verification (self-signed labs)
    #[serde(default)]
    pub insecure: bool,
    /// Request timeout in seconds
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    /// Fingerprint of the server TLS certificate (optional extra verification)
    #[serde(default)]
    pub fingerprint: Option<String>,
}

fn default_port() -> u16 {
    8006
}
fn default_timeout() -> u64 {
    30
}

impl Default for ProxmoxConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 8006,
            auth: ProxmoxAuthMethod::Password {
                username: "root".into(),
                password: String::new(),
                realm: "pam".into(),
                otp: None,
            },
            insecure: false,
            timeout_secs: 30,
            fingerprint: None,
        }
    }
}

/// Safe config variant without secrets — for sending to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxmoxConfigSafe {
    pub host: String,
    pub port: u16,
    pub auth_method: String,
    pub username: Option<String>,
    pub token_id: Option<String>,
    pub insecure: bool,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session / Ticket
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Active PVE auth ticket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxmoxTicket {
    pub ticket: String,
    #[serde(alias = "CSRFPreventionToken")]
    pub csrf_token: String,
    pub username: String,
    pub connected_at: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Generic PVE API response wrappers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// PVE API always wraps results in `{ "data": ... }`.
#[derive(Debug, Deserialize)]
pub struct PveResponse<T> {
    pub data: T,
}

/// PVE API wraps task results in `{ "data": "UPID:..." }`.
#[derive(Debug, Deserialize)]
pub struct PveTaskResponse {
    pub data: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Cluster
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterStatus {
    #[serde(alias = "type")]
    pub item_type: String,
    pub name: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub online: Option<u8>,
    #[serde(default)]
    pub version: Option<u64>,
    #[serde(default)]
    pub quorate: Option<u8>,
    #[serde(default)]
    pub nodes: Option<u64>,
    #[serde(default)]
    pub nodeid: Option<u64>,
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default, alias = "local")]
    pub local_node: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterResource {
    #[serde(alias = "type")]
    pub resource_type: String,
    pub id: String,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub vmid: Option<u64>,
    #[serde(default)]
    pub maxcpu: Option<f64>,
    #[serde(default)]
    pub cpu: Option<f64>,
    #[serde(default)]
    pub maxmem: Option<u64>,
    #[serde(default)]
    pub mem: Option<u64>,
    #[serde(default)]
    pub maxdisk: Option<u64>,
    #[serde(default)]
    pub disk: Option<u64>,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub pool: Option<String>,
    #[serde(default)]
    pub template: Option<u8>,
    #[serde(default)]
    pub hastate: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterOptions {
    #[serde(default)]
    pub keyboard: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub console: Option<String>,
    #[serde(default)]
    pub email_from: Option<String>,
    #[serde(default)]
    pub http_proxy: Option<String>,
    #[serde(default)]
    pub mac_prefix: Option<String>,
    #[serde(default)]
    pub migration_type: Option<String>,
    #[serde(default)]
    pub migration_network: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterJoinInfo {
    pub config_digest: String,
    pub nodeid: u64,
    pub totem: serde_json::Value,
    #[serde(default)]
    pub preferred_node: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSummary {
    pub node: String,
    pub status: String,
    #[serde(default)]
    pub cpu: Option<f64>,
    #[serde(default)]
    pub maxcpu: Option<u32>,
    #[serde(default)]
    pub mem: Option<u64>,
    #[serde(default)]
    pub maxmem: Option<u64>,
    #[serde(default)]
    pub disk: Option<u64>,
    #[serde(default)]
    pub maxdisk: Option<u64>,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default, alias = "type")]
    pub item_type: Option<String>,
    #[serde(default)]
    pub ssl_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatus {
    #[serde(default)]
    pub cpu: Option<f64>,
    #[serde(default)]
    pub cpuinfo: Option<CpuInfo>,
    #[serde(default)]
    pub memory: Option<MemoryInfo>,
    #[serde(default)]
    pub rootfs: Option<DiskInfo>,
    #[serde(default)]
    pub swap: Option<MemoryInfo>,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub loadavg: Option<Vec<String>>,
    #[serde(default)]
    pub kversion: Option<String>,
    #[serde(default)]
    pub pveversion: Option<String>,
    #[serde(default)]
    pub idle: Option<f64>,
    #[serde(default)]
    pub wait: Option<f64>,
    #[serde(default)]
    pub ksm: Option<KsmInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    #[serde(default)]
    pub cpus: Option<u32>,
    #[serde(default)]
    pub cores: Option<u32>,
    #[serde(default)]
    pub sockets: Option<u32>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub mhz: Option<String>,
    #[serde(default)]
    pub hvm: Option<String>,
    #[serde(default)]
    pub flags: Option<String>,
    #[serde(default)]
    pub user_hz: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    #[serde(default)]
    pub total: Option<u64>,
    #[serde(default)]
    pub used: Option<u64>,
    #[serde(default)]
    pub free: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    #[serde(default)]
    pub total: Option<u64>,
    #[serde(default)]
    pub used: Option<u64>,
    #[serde(default)]
    pub avail: Option<u64>,
    #[serde(default)]
    pub free: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KsmInfo {
    #[serde(default)]
    pub shared: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeService {
    pub service: String,
    pub name: String,
    pub state: String,
    #[serde(default)]
    pub desc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDns {
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub dns1: Option<String>,
    #[serde(default)]
    pub dns2: Option<String>,
    #[serde(default)]
    pub dns3: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTime {
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub localtime: Option<u64>,
    #[serde(default)]
    pub time: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AptUpdate {
    #[serde(default)]
    pub package: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub old_version: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub section: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyslogEntry {
    #[serde(alias = "n")]
    pub line_number: u64,
    #[serde(alias = "t")]
    pub text: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  QEMU VM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum QemuStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(rename = "paused")]
    Paused,
    #[serde(other)]
    #[default]
    Unknown,
}

/// Concise VM summary from list endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QemuVmSummary {
    pub vmid: u64,
    pub name: Option<String>,
    pub status: QemuStatus,
    #[serde(default)]
    pub cpus: Option<u32>,
    #[serde(default)]
    pub maxmem: Option<u64>,
    #[serde(default)]
    pub maxdisk: Option<u64>,
    #[serde(default)]
    pub mem: Option<u64>,
    #[serde(default)]
    pub disk: Option<u64>,
    #[serde(default)]
    pub cpu: Option<f64>,
    #[serde(default)]
    pub netin: Option<u64>,
    #[serde(default)]
    pub netout: Option<u64>,
    #[serde(default)]
    pub diskread: Option<u64>,
    #[serde(default)]
    pub diskwrite: Option<u64>,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub template: Option<u8>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub pid: Option<u64>,
    #[serde(default)]
    pub qmpstatus: Option<String>,
    #[serde(default)]
    pub lock: Option<String>,
}

/// Full VM config (GET /api2/json/nodes/{node}/qemu/{vmid}/config).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QemuConfig {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub memory: Option<u64>,
    #[serde(default)]
    pub cores: Option<u32>,
    #[serde(default)]
    pub sockets: Option<u32>,
    #[serde(default)]
    pub cpu: Option<String>,
    #[serde(default)]
    pub ostype: Option<String>,
    #[serde(default)]
    pub bios: Option<String>,
    #[serde(default)]
    pub machine: Option<String>,
    #[serde(default)]
    pub boot: Option<String>,
    #[serde(default)]
    pub scsihw: Option<String>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub balloon: Option<u64>,
    #[serde(default)]
    pub onboot: Option<u8>,
    #[serde(default)]
    pub startup: Option<String>,
    #[serde(default)]
    pub tablet: Option<u8>,
    #[serde(default)]
    pub vga: Option<String>,
    #[serde(default)]
    pub numa: Option<u8>,
    #[serde(default)]
    pub hotplug: Option<String>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub protection: Option<u8>,
    /// IDE disks (ide0..ide3)
    #[serde(default)]
    pub ide0: Option<String>,
    #[serde(default)]
    pub ide1: Option<String>,
    #[serde(default)]
    pub ide2: Option<String>,
    #[serde(default)]
    pub ide3: Option<String>,
    /// SCSI disks (scsi0..scsi30)
    #[serde(default)]
    pub scsi0: Option<String>,
    #[serde(default)]
    pub scsi1: Option<String>,
    #[serde(default)]
    pub scsi2: Option<String>,
    #[serde(default)]
    pub scsi3: Option<String>,
    /// VirtIO disks
    #[serde(default)]
    pub virtio0: Option<String>,
    #[serde(default)]
    pub virtio1: Option<String>,
    #[serde(default)]
    pub virtio2: Option<String>,
    #[serde(default)]
    pub virtio3: Option<String>,
    /// SATA disks
    #[serde(default)]
    pub sata0: Option<String>,
    #[serde(default)]
    pub sata1: Option<String>,
    #[serde(default)]
    pub sata2: Option<String>,
    /// Network interfaces
    #[serde(default)]
    pub net0: Option<String>,
    #[serde(default)]
    pub net1: Option<String>,
    #[serde(default)]
    pub net2: Option<String>,
    #[serde(default)]
    pub net3: Option<String>,
    /// EFI disk
    #[serde(default)]
    pub efidisk0: Option<String>,
    /// TPM state
    #[serde(default)]
    pub tpmstate0: Option<String>,
    /// Serial/USB
    #[serde(default)]
    pub serial0: Option<String>,
    #[serde(default)]
    pub usb0: Option<String>,
    /// Cloud-init
    #[serde(default)]
    pub ciuser: Option<String>,
    #[serde(default)]
    pub cipassword: Option<String>,
    #[serde(default)]
    pub ipconfig0: Option<String>,
    #[serde(default)]
    pub ipconfig1: Option<String>,
    #[serde(default)]
    pub nameserver: Option<String>,
    #[serde(default)]
    pub searchdomain: Option<String>,
    #[serde(default)]
    pub sshkeys: Option<String>,
    #[serde(default)]
    pub citype: Option<String>,
    /// Digest for conditional updates
    #[serde(default)]
    pub digest: Option<String>,
    /// Catch-all for disks / options we don't explicitly list
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

/// Parameters for creating a QEMU VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QemuCreateParams {
    pub vmid: u64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub memory: Option<u64>,
    #[serde(default)]
    pub cores: Option<u32>,
    #[serde(default)]
    pub sockets: Option<u32>,
    #[serde(default)]
    pub cpu: Option<String>,
    #[serde(default)]
    pub ostype: Option<String>,
    #[serde(default)]
    pub bios: Option<String>,
    #[serde(default)]
    pub machine: Option<String>,
    #[serde(default)]
    pub scsihw: Option<String>,
    #[serde(default)]
    pub boot: Option<String>,
    #[serde(default)]
    pub onboot: Option<u8>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub cdrom: Option<String>,
    #[serde(default)]
    pub ide0: Option<String>,
    #[serde(default)]
    pub ide2: Option<String>,
    #[serde(default)]
    pub scsi0: Option<String>,
    #[serde(default)]
    pub virtio0: Option<String>,
    #[serde(default)]
    pub sata0: Option<String>,
    #[serde(default)]
    pub efidisk0: Option<String>,
    #[serde(default)]
    pub net0: Option<String>,
    #[serde(default)]
    pub net1: Option<String>,
    #[serde(default)]
    pub vga: Option<String>,
    #[serde(default)]
    pub serial0: Option<String>,
    #[serde(default)]
    pub tablet: Option<u8>,
    #[serde(default)]
    pub numa: Option<u8>,
    #[serde(default)]
    pub balloon: Option<u64>,
    #[serde(default)]
    pub hotplug: Option<String>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub protection: Option<u8>,
    #[serde(default)]
    pub pool: Option<String>,
    #[serde(default)]
    pub storage: Option<String>,
    #[serde(default)]
    pub start: Option<u8>,
    #[serde(default)]
    pub unique: Option<u8>,
    /// Cloud-init fields
    #[serde(default)]
    pub ciuser: Option<String>,
    #[serde(default)]
    pub cipassword: Option<String>,
    #[serde(default)]
    pub ipconfig0: Option<String>,
    #[serde(default)]
    pub sshkeys: Option<String>,
    #[serde(default)]
    pub citype: Option<String>,
    #[serde(default)]
    pub nameserver: Option<String>,
    #[serde(default)]
    pub searchdomain: Option<String>,
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

/// Parameters for cloning a QEMU VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QemuCloneParams {
    pub newid: u64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub full: Option<u8>,
    #[serde(default)]
    pub storage: Option<String>,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub pool: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub snapname: Option<String>,
    #[serde(default)]
    pub format: Option<String>,
}

/// Parameters for migrating a QEMU VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QemuMigrateParams {
    pub target: String,
    #[serde(default)]
    pub online: Option<u8>,
    #[serde(default)]
    pub force: Option<u8>,
    #[serde(default, rename = "with-local-disks")]
    pub with_local_disks: Option<u8>,
    #[serde(default, rename = "targetstorage")]
    pub target_storage: Option<String>,
}

/// Parameters for resizing a VM disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskResizeParams {
    pub disk: String,
    pub size: String,
}

/// VM status with runtime info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QemuStatusCurrent {
    pub status: QemuStatus,
    #[serde(default)]
    pub vmid: Option<u64>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub cpus: Option<u32>,
    #[serde(default)]
    pub cpu: Option<f64>,
    #[serde(default)]
    pub mem: Option<u64>,
    #[serde(default)]
    pub maxmem: Option<u64>,
    #[serde(default)]
    pub disk: Option<u64>,
    #[serde(default)]
    pub maxdisk: Option<u64>,
    #[serde(default)]
    pub netin: Option<u64>,
    #[serde(default)]
    pub netout: Option<u64>,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub pid: Option<u64>,
    #[serde(default)]
    pub qmpstatus: Option<String>,
    #[serde(default)]
    pub ha: Option<serde_json::Value>,
    #[serde(default)]
    pub spice: Option<u8>,
    #[serde(default)]
    pub agent: Option<u8>,
    #[serde(default)]
    pub lock: Option<String>,
    #[serde(default)]
    pub tags: Option<String>,
}

/// QEMU guest agent info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QemuAgentInfo {
    #[serde(default)]
    pub result: Option<serde_json::Value>,
}

/// QEMU feature check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QemuFeatureCheck {
    #[serde(default)]
    pub has_feature: Option<u8>,
    #[serde(default)]
    pub nodes: Option<Vec<String>>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  LXC Container
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum LxcStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(other)]
    #[default]
    Unknown,
}

/// Concise LXC container summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LxcSummary {
    pub vmid: u64,
    #[serde(default)]
    pub name: Option<String>,
    pub status: LxcStatus,
    #[serde(default)]
    pub cpus: Option<u32>,
    #[serde(default)]
    pub maxmem: Option<u64>,
    #[serde(default)]
    pub maxdisk: Option<u64>,
    #[serde(default)]
    pub maxswap: Option<u64>,
    #[serde(default)]
    pub mem: Option<u64>,
    #[serde(default)]
    pub disk: Option<u64>,
    #[serde(default)]
    pub swap: Option<u64>,
    #[serde(default)]
    pub cpu: Option<f64>,
    #[serde(default)]
    pub netin: Option<u64>,
    #[serde(default)]
    pub netout: Option<u64>,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub template: Option<u8>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub lock: Option<String>,
    #[serde(default)]
    pub pid: Option<u64>,
    #[serde(default, alias = "type")]
    pub item_type: Option<String>,
}

/// Full LXC container config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LxcConfig {
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub memory: Option<u64>,
    #[serde(default)]
    pub swap: Option<u64>,
    #[serde(default)]
    pub cores: Option<u32>,
    #[serde(default)]
    pub cpulimit: Option<f64>,
    #[serde(default)]
    pub cpuunits: Option<u64>,
    #[serde(default)]
    pub rootfs: Option<String>,
    #[serde(default)]
    pub ostype: Option<String>,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(default)]
    pub unprivileged: Option<u8>,
    #[serde(default)]
    pub features: Option<String>,
    #[serde(default)]
    pub onboot: Option<u8>,
    #[serde(default)]
    pub startup: Option<String>,
    #[serde(default)]
    pub protection: Option<u8>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// Network interfaces
    #[serde(default)]
    pub net0: Option<String>,
    #[serde(default)]
    pub net1: Option<String>,
    #[serde(default)]
    pub net2: Option<String>,
    /// Mount points (mp0..mpN)
    #[serde(default)]
    pub mp0: Option<String>,
    #[serde(default)]
    pub mp1: Option<String>,
    #[serde(default)]
    pub mp2: Option<String>,
    #[serde(default)]
    pub nameserver: Option<String>,
    #[serde(default)]
    pub searchdomain: Option<String>,
    #[serde(default)]
    pub digest: Option<String>,
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

/// Parameters for creating an LXC container.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LxcCreateParams {
    pub vmid: u64,
    pub ostemplate: String,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub memory: Option<u64>,
    #[serde(default)]
    pub swap: Option<u64>,
    #[serde(default)]
    pub cores: Option<u32>,
    #[serde(default)]
    pub rootfs: Option<String>,
    #[serde(default)]
    pub storage: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default, rename = "ssh-public-keys")]
    pub ssh_public_keys: Option<String>,
    #[serde(default)]
    pub net0: Option<String>,
    #[serde(default)]
    pub net1: Option<String>,
    #[serde(default)]
    pub unprivileged: Option<u8>,
    #[serde(default)]
    pub features: Option<String>,
    #[serde(default)]
    pub onboot: Option<u8>,
    #[serde(default)]
    pub start: Option<u8>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub pool: Option<String>,
    #[serde(default)]
    pub nameserver: Option<String>,
    #[serde(default)]
    pub searchdomain: Option<String>,
    #[serde(default)]
    pub mp0: Option<String>,
    #[serde(default)]
    pub mp1: Option<String>,
    #[serde(default)]
    pub ostype: Option<String>,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

/// Parameters for cloning an LXC container.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LxcCloneParams {
    pub newid: u64,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub full: Option<u8>,
    #[serde(default)]
    pub storage: Option<String>,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub pool: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub snapname: Option<String>,
}

/// Parameters for migrating an LXC container.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LxcMigrateParams {
    pub target: String,
    #[serde(default)]
    pub online: Option<u8>,
    #[serde(default)]
    pub restart: Option<u8>,
    #[serde(default, rename = "target-storage")]
    pub target_storage: Option<String>,
    #[serde(default)]
    pub force: Option<u8>,
}

/// LXC status (current).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LxcStatusCurrent {
    pub status: LxcStatus,
    #[serde(default)]
    pub vmid: Option<u64>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub cpus: Option<u32>,
    #[serde(default)]
    pub cpu: Option<f64>,
    #[serde(default)]
    pub mem: Option<u64>,
    #[serde(default)]
    pub maxmem: Option<u64>,
    #[serde(default)]
    pub disk: Option<u64>,
    #[serde(default)]
    pub maxdisk: Option<u64>,
    #[serde(default)]
    pub swap: Option<u64>,
    #[serde(default)]
    pub maxswap: Option<u64>,
    #[serde(default)]
    pub netin: Option<u64>,
    #[serde(default)]
    pub netout: Option<u64>,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub pid: Option<u64>,
    #[serde(default)]
    pub ha: Option<serde_json::Value>,
    #[serde(default)]
    pub lock: Option<String>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default, alias = "type")]
    pub item_type: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Storage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSummary {
    pub storage: String,
    #[serde(default, alias = "type")]
    pub storage_type: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub total: Option<u64>,
    #[serde(default)]
    pub used: Option<u64>,
    #[serde(default)]
    pub avail: Option<u64>,
    #[serde(default)]
    pub active: Option<u8>,
    #[serde(default)]
    pub enabled: Option<u8>,
    #[serde(default)]
    pub shared: Option<u8>,
    #[serde(default)]
    pub used_fraction: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageContent {
    pub volid: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub used: Option<u64>,
    #[serde(default)]
    pub ctime: Option<u64>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub vmid: Option<u64>,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub verification: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageConfig {
    pub storage: String,
    #[serde(alias = "type")]
    pub storage_type: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub pool: Option<String>,
    #[serde(default)]
    pub server: Option<String>,
    #[serde(default)]
    pub export: Option<String>,
    #[serde(default)]
    pub nodes: Option<String>,
    #[serde(default)]
    pub shared: Option<u8>,
    #[serde(default)]
    pub disable: Option<u8>,
    #[serde(default)]
    pub maxfiles: Option<u64>,
    #[serde(default, rename = "prune-backups")]
    pub prune_backups: Option<String>,
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Network
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterface {
    pub iface: String,
    #[serde(default, alias = "type")]
    pub iface_type: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub method6: Option<String>,
    #[serde(default)]
    pub active: Option<u8>,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub netmask: Option<String>,
    #[serde(default)]
    pub gateway: Option<String>,
    #[serde(default)]
    pub address6: Option<String>,
    #[serde(default)]
    pub netmask6: Option<String>,
    #[serde(default)]
    pub gateway6: Option<String>,
    #[serde(default)]
    pub cidr: Option<String>,
    #[serde(default)]
    pub cidr6: Option<String>,
    #[serde(default)]
    pub bridge_ports: Option<String>,
    #[serde(default)]
    pub bridge_stp: Option<String>,
    #[serde(default)]
    pub bridge_fd: Option<String>,
    #[serde(default)]
    pub bridge_vlan_aware: Option<u8>,
    #[serde(default)]
    pub bond_mode: Option<String>,
    #[serde(default)]
    pub bond_primary: Option<String>,
    #[serde(default)]
    pub slaves: Option<String>,
    #[serde(default)]
    pub autostart: Option<u8>,
    #[serde(default)]
    pub comments: Option<String>,
    #[serde(default)]
    pub families: Option<Vec<String>>,
    #[serde(default)]
    pub mtu: Option<u64>,
    #[serde(default)]
    pub vlan_id: Option<u64>,
    #[serde(default)]
    pub vlan_raw_device: Option<String>,
    #[serde(default)]
    pub ovs_type: Option<String>,
    #[serde(default)]
    pub ovs_bridge: Option<String>,
    #[serde(default)]
    pub ovs_ports: Option<String>,
    #[serde(default)]
    pub ovs_tag: Option<u64>,
    #[serde(default)]
    pub ovs_options: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNetworkParams {
    pub iface: String,
    #[serde(alias = "type")]
    pub iface_type: String,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub netmask: Option<String>,
    #[serde(default)]
    pub gateway: Option<String>,
    #[serde(default)]
    pub address6: Option<String>,
    #[serde(default)]
    pub netmask6: Option<String>,
    #[serde(default)]
    pub gateway6: Option<String>,
    #[serde(default)]
    pub bridge_ports: Option<String>,
    #[serde(default)]
    pub bridge_vlan_aware: Option<u8>,
    #[serde(default)]
    pub autostart: Option<u8>,
    #[serde(default)]
    pub comments: Option<String>,
    #[serde(default)]
    pub mtu: Option<u64>,
    #[serde(default)]
    pub bond_mode: Option<String>,
    #[serde(default)]
    pub slaves: Option<String>,
    #[serde(default)]
    pub vlan_id: Option<u64>,
    #[serde(default)]
    pub vlan_raw_device: Option<String>,
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Snapshots
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSummary {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub snaptime: Option<u64>,
    #[serde(default)]
    pub vmstate: Option<u8>,
    #[serde(default)]
    pub parent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSnapshotParams {
    pub snapname: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub vmstate: Option<u8>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tasks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub upid: String,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub pid: Option<u64>,
    #[serde(default)]
    pub pstart: Option<u64>,
    #[serde(default)]
    pub starttime: Option<u64>,
    #[serde(default)]
    pub endtime: Option<u64>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, alias = "type")]
    pub task_type: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub exitstatus: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatus {
    pub status: String,
    #[serde(default)]
    pub exitstatus: Option<String>,
    #[serde(default, alias = "type")]
    pub task_type: Option<String>,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub pid: Option<u64>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub starttime: Option<u64>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub upid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLogLine {
    #[serde(alias = "n")]
    pub line_number: u64,
    #[serde(alias = "t")]
    pub text: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Backup
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupJobConfig {
    pub id: String,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub storage: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub compress: Option<String>,
    #[serde(default)]
    pub vmid: Option<String>,
    #[serde(default)]
    pub all: Option<u8>,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub pool: Option<String>,
    #[serde(default)]
    pub exclude: Option<String>,
    #[serde(default)]
    pub mailnotification: Option<String>,
    #[serde(default)]
    pub mailto: Option<String>,
    #[serde(default)]
    pub maxfiles: Option<u64>,
    #[serde(default, rename = "prune-backups")]
    pub prune_backups: Option<String>,
    #[serde(default)]
    pub enabled: Option<u8>,
    #[serde(default)]
    pub notes_template: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default, rename = "repeat-missed")]
    pub repeat_missed: Option<u8>,
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VzdumpParams {
    pub vmid: String,
    #[serde(default)]
    pub storage: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub compress: Option<String>,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub remove: Option<u8>,
    #[serde(default)]
    pub notes_template: Option<String>,
    #[serde(default)]
    pub maxfiles: Option<u64>,
    #[serde(default, rename = "prune-backups")]
    pub prune_backups: Option<String>,
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Firewall
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallRule {
    #[serde(default)]
    pub pos: Option<u64>,
    #[serde(alias = "type")]
    pub rule_type: String,
    pub action: String,
    #[serde(default)]
    pub enable: Option<u8>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub dest: Option<String>,
    #[serde(default)]
    pub sport: Option<String>,
    #[serde(default)]
    pub dport: Option<String>,
    #[serde(default)]
    pub proto: Option<String>,
    #[serde(default)]
    pub iface: Option<String>,
    #[serde(default)]
    pub macro_name: Option<String>,
    #[serde(default)]
    pub log: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallAlias {
    pub name: String,
    pub cidr: String,
    #[serde(default)]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallIpSet {
    pub name: String,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallIpSetEntry {
    pub cidr: String,
    #[serde(default)]
    pub nomatch: Option<u8>,
    #[serde(default)]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallOptions {
    #[serde(default)]
    pub enable: Option<u8>,
    #[serde(default)]
    pub policy_in: Option<String>,
    #[serde(default)]
    pub policy_out: Option<String>,
    #[serde(default)]
    pub log_level_in: Option<String>,
    #[serde(default)]
    pub log_level_out: Option<String>,
    #[serde(default)]
    pub dhcp: Option<u8>,
    #[serde(default)]
    pub ipfilter: Option<u8>,
    #[serde(default)]
    pub macfilter: Option<u8>,
    #[serde(default)]
    pub ndp: Option<u8>,
    #[serde(default)]
    pub radv: Option<u8>,
    #[serde(default)]
    pub input_policy: Option<String>,
    #[serde(default)]
    pub output_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallSecurityGroup {
    pub group: String,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub digest: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Pools
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolSummary {
    pub poolid: String,
    #[serde(default)]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolInfo {
    pub poolid: String,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub members: Option<Vec<PoolMember>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolMember {
    pub id: String,
    #[serde(alias = "type")]
    pub member_type: String,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub vmid: Option<u64>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub storage: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  High Availability (HA)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HaResource {
    pub sid: String,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub max_relocate: Option<u64>,
    #[serde(default)]
    pub max_restart: Option<u64>,
    #[serde(default, alias = "type")]
    pub resource_type: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HaGroup {
    pub group: String,
    #[serde(default)]
    pub nodes: Option<String>,
    #[serde(default)]
    pub restricted: Option<u8>,
    #[serde(default)]
    pub nofailback: Option<u8>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default, alias = "type")]
    pub item_type: Option<String>,
    #[serde(default)]
    pub digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HaStatus {
    #[serde(default)]
    pub quorum: Option<serde_json::Value>,
    #[serde(default)]
    pub manager_status: Option<serde_json::Value>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Ceph
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CephStatus {
    pub health: serde_json::Value,
    #[serde(default)]
    pub fsid: Option<String>,
    #[serde(default)]
    pub osdmap: Option<serde_json::Value>,
    #[serde(default)]
    pub pgmap: Option<serde_json::Value>,
    #[serde(default)]
    pub monmap: Option<serde_json::Value>,
    #[serde(default)]
    pub quorum: Option<Vec<u64>>,
    #[serde(default)]
    pub quorum_names: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CephOsd {
    pub id: u64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, alias = "in")]
    pub osd_in: Option<u8>,
    #[serde(default)]
    pub crush_weight: Option<f64>,
    #[serde(default)]
    pub device_class: Option<String>,
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub osd_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CephMonitor {
    pub name: String,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub addr: Option<String>,
    #[serde(default)]
    pub rank: Option<u64>,
    #[serde(default)]
    pub quorum: Option<bool>,
    #[serde(default)]
    pub ceph_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CephPool {
    pub pool_name: String,
    #[serde(default)]
    pub pool: Option<u64>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub min_size: Option<u64>,
    #[serde(default)]
    pub pg_num: Option<u64>,
    #[serde(default)]
    pub crush_rule_name: Option<String>,
    #[serde(default)]
    pub bytes_used: Option<u64>,
    #[serde(default)]
    pub percent_used: Option<f64>,
    #[serde(default)]
    pub application_metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCephPoolParams {
    pub name: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub min_size: Option<u64>,
    #[serde(default)]
    pub pg_num: Option<u64>,
    #[serde(default)]
    pub crush_rule: Option<String>,
    #[serde(default)]
    pub application: Option<String>,
    #[serde(default)]
    pub add_storages: Option<u8>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SDN (Software Defined Networking)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdnZone {
    pub zone: String,
    #[serde(default, alias = "type")]
    pub zone_type: Option<String>,
    #[serde(default)]
    pub dns: Option<String>,
    #[serde(default)]
    pub reversedns: Option<String>,
    #[serde(default)]
    pub dnszone: Option<String>,
    #[serde(default)]
    pub bridge: Option<String>,
    #[serde(default)]
    pub mtu: Option<u64>,
    #[serde(default)]
    pub nodes: Option<String>,
    #[serde(default)]
    pub ipam: Option<String>,
    #[serde(default)]
    pub tag: Option<u64>,
    #[serde(default)]
    pub vlan_protocol: Option<String>,
    #[serde(default)]
    pub peers: Option<String>,
    #[serde(default)]
    pub digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdnVnet {
    pub vnet: String,
    #[serde(default)]
    pub zone: Option<String>,
    #[serde(default)]
    pub alias: Option<String>,
    #[serde(default)]
    pub tag: Option<u64>,
    #[serde(default)]
    pub vlanaware: Option<u8>,
    #[serde(default, alias = "type")]
    pub item_type: Option<String>,
    #[serde(default)]
    pub digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdnSubnet {
    pub subnet: String,
    #[serde(default)]
    pub vnet: Option<String>,
    #[serde(default)]
    pub gateway: Option<String>,
    #[serde(default)]
    pub snat: Option<u8>,
    #[serde(default)]
    pub dhcp_range: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub dns_zone_prefix: Option<String>,
    #[serde(default, alias = "type")]
    pub item_type: Option<String>,
    #[serde(default)]
    pub digest: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Console (VNC / SPICE)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum ConsoleType {
    #[serde(rename = "vnc")]
    #[default]
    Vnc,
    #[serde(rename = "spice")]
    Spice,
    #[serde(rename = "term")]
    Term,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncTicket {
    pub ticket: String,
    pub port: String,
    pub user: String,
    pub upid: Option<String>,
    #[serde(default)]
    pub cert: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiceTicket {
    #[serde(alias = "type")]
    pub ticket_type: String,
    pub proxy: String,
    pub host: String,
    pub password: String,
    #[serde(alias = "tls-port")]
    pub tls_port: u16,
    #[serde(default, alias = "toggle-fullscreen")]
    pub toggle_fullscreen: Option<String>,
    #[serde(default, alias = "host-subject")]
    pub host_subject: Option<String>,
    #[serde(default, alias = "ca")]
    pub ca_cert: Option<String>,
    #[serde(default, alias = "delete-this-file")]
    pub delete_this_file: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermProxyTicket {
    pub ticket: String,
    pub port: String,
    pub user: String,
    #[serde(default)]
    pub upid: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Metrics / RRD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum RrdTimeframe {
    #[serde(rename = "hour")]
    #[default]
    Hour,
    #[serde(rename = "day")]
    Day,
    #[serde(rename = "week")]
    Week,
    #[serde(rename = "month")]
    Month,
    #[serde(rename = "year")]
    Year,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RrdDataPoint {
    pub time: f64,
    #[serde(flatten)]
    pub values: std::collections::HashMap<String, Option<f64>>,
}

/// Combined metrics response for frontend display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceMetrics {
    pub id: String,
    pub resource_type: String,
    pub data: Vec<RrdDataPoint>,
    pub timeframe: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Templates (Appliance)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplianceTemplate {
    #[serde(default)]
    pub package: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default, alias = "type")]
    pub template_type: Option<String>,
    #[serde(default)]
    pub section: Option<String>,
    #[serde(default)]
    pub headline: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub infopage: Option<String>,
    #[serde(default)]
    pub manageurl: Option<String>,
    #[serde(default)]
    pub sha512sum: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Cluster / Version info
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PveVersion {
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub release: Option<String>,
    #[serde(default)]
    pub repoid: Option<String>,
    #[serde(default)]
    pub console: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ACL / Permissions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclEntry {
    pub path: String,
    #[serde(default)]
    pub ugid: Option<String>,
    #[serde(default)]
    pub roleid: Option<String>,
    #[serde(default, alias = "type")]
    pub acl_type: Option<String>,
    #[serde(default)]
    pub propagate: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PveUser {
    pub userid: String,
    #[serde(default)]
    pub firstname: Option<String>,
    #[serde(default)]
    pub lastname: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub enable: Option<u8>,
    #[serde(default)]
    pub expire: Option<u64>,
    #[serde(default)]
    pub groups: Option<String>,
    #[serde(default)]
    pub keys: Option<String>,
    #[serde(default)]
    pub realm_type: Option<String>,
    #[serde(default)]
    pub tokens: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PveRole {
    pub roleid: String,
    #[serde(default)]
    pub privs: Option<String>,
    #[serde(default)]
    pub special: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PveGroup {
    pub groupid: String,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub users: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Replication
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicationJob {
    pub id: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default, alias = "type")]
    pub job_type: Option<String>,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub rate: Option<f64>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub disable: Option<u8>,
    #[serde(default)]
    pub remove_job: Option<String>,
    #[serde(default)]
    pub vmid: Option<u64>,
}
