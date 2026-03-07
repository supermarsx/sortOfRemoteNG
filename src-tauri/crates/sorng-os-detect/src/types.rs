//! Data types for OS and capabilities detection.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Host ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuth {
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsDetectHost {
    pub id: String,
    pub name: String,
    pub ssh: Option<SshConfig>,
    pub use_sudo: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── OS Family ──────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OsFamily {
    Linux,
    MacOS,
    FreeBSD,
    OpenBSD,
    NetBSD,
    Windows,
    Solaris,
    AIX,
    Unknown,
}

// ─── Linux Distribution ────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinuxDistro {
    Ubuntu,
    Debian,
    Fedora,
    CentOS,
    RHEL,
    Rocky,
    AlmaLinux,
    Arch,
    Manjaro,
    OpenSUSE,
    SLES,
    Gentoo,
    Void,
    Alpine,
    NixOS,
    Kali,
    ParrotOS,
    Clear,
    Amazon,
    Oracle,
    PhotonOS,
    Flatcar,
    CoreOS,
    RancherOS,
    CBLMariner,
    Wolfi,
    Unknown(String),
}

// ─── OS Version ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OsVersion {
    pub major: Option<u32>,
    pub minor: Option<u32>,
    pub patch: Option<u32>,
    pub build: Option<String>,
    pub codename: Option<String>,
    pub full_version_string: String,
}

// ─── Init System ────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InitSystem {
    Systemd,
    OpenRC,
    SysVInit,
    Runit,
    S6,
    Launchd,
    WindowsSCM,
    BSDInit,
    Unknown,
}

// ─── Package Manager ────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PackageManager {
    Apt,
    Dnf,
    Yum,
    Pacman,
    Zypper,
    Emerge,
    Apk,
    Nix,
    Xbps,
    Brew,
    Ports,
    Pkg,
    Winget,
    Chocolatey,
    Scoop,
    Flatpak,
    Snap,
    Unknown,
}

// ─── Shell ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
    pub version: Option<String>,
}

// ─── Architecture ───────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Architecture {
    X86_64,
    Aarch64,
    Armv7l,
    Riscv64,
    S390x,
    Ppc64le,
    Mips64,
    I686,
    Unknown(String),
}

// ─── Kernel ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelInfo {
    pub name: String,
    pub version: String,
    pub release: String,
    pub machine: String,
    pub os_type: String,
}

// ─── CPU ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuInfo {
    pub model: String,
    pub cores_physical: Option<u32>,
    pub cores_logical: Option<u32>,
    pub architecture: Architecture,
    pub frequency_mhz: Option<f64>,
    pub flags: Vec<String>,
    pub microcode: Option<String>,
    pub cache_size: Option<String>,
    pub vendor: Option<String>,
}

// ─── Memory ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryInfo {
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_available_bytes: u64,
    pub huge_pages: Option<u64>,
}

// ─── Disk ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskInfo {
    pub device: String,
    pub mount_point: String,
    pub fs_type: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
}

// ─── Network Interface ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub mac: Option<String>,
    pub ipv4_addrs: Vec<String>,
    pub ipv6_addrs: Vec<String>,
    pub state: String,
    pub mtu: Option<u32>,
    pub speed_mbps: Option<u32>,
    pub driver: Option<String>,
}

// ─── GPU ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub vendor: String,
    pub model: String,
    pub driver: Option<String>,
    pub vram_bytes: Option<u64>,
}

// ─── Virtualization ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualizationInfo {
    pub is_virtual: bool,
    pub hypervisor: String,
    pub container_runtime: Option<String>,
}

// ─── Security ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityInfo {
    pub selinux_enabled: bool,
    pub selinux_mode: Option<String>,
    pub apparmor_enabled: bool,
    pub firewall_backend: Option<String>,
    pub capabilities: Vec<String>,
}

// ─── Available Service ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableService {
    pub name: String,
    pub unit_type: Option<String>,
    pub state: String,
    pub enabled: Option<bool>,
}

// ─── Installed Package ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPackageInfo {
    pub name: String,
    pub version: String,
    pub source: Option<String>,
}

// ─── System Locale ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemLocale {
    pub lang: Option<String>,
    pub lc_all: Option<String>,
    pub keymap: Option<String>,
    pub timezone: Option<String>,
}

// ─── Hardware Profile ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareProfile {
    pub cpu: Option<CpuInfo>,
    pub memory: Option<MemoryInfo>,
    pub disks: Vec<DiskInfo>,
    pub network_interfaces: Vec<NetworkInterfaceInfo>,
    pub gpus: Vec<GpuInfo>,
    pub virtualization: Option<VirtualizationInfo>,
    pub dmi_vendor: Option<String>,
    pub dmi_product: Option<String>,
    pub dmi_serial: Option<String>,
}

// ─── Service Capabilities ───────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ServiceCapabilities {
    pub has_systemd: bool,
    pub has_docker: bool,
    pub has_podman: bool,
    pub has_lxc: bool,
    pub has_kvm: bool,
    pub has_firewalld: bool,
    pub has_ufw: bool,
    pub has_nftables: bool,
    pub has_iptables: bool,
    pub has_selinux: bool,
    pub has_apparmor: bool,
    pub has_samba: bool,
    pub has_nfs: bool,
    pub has_lvm: bool,
    pub has_zfs: bool,
    pub has_mdraid: bool,
    pub has_btrfs: bool,
    pub has_cron: bool,
    pub has_at: bool,
    pub has_anacron: bool,
    pub has_postfix: bool,
    pub has_dovecot: bool,
    pub has_nginx: bool,
    pub has_apache: bool,
    pub has_haproxy: bool,
    pub has_traefik: bool,
    pub has_openvpn: bool,
    pub has_wireguard: bool,
    pub has_fail2ban: bool,
    pub has_openldap: bool,
    pub has_freeipa: bool,
    pub has_bind: bool,
    pub has_dhcpd: bool,
    pub has_dnsmasq: bool,
    pub has_squid: bool,
    pub has_rsyslog: bool,
    pub has_syslog_ng: bool,
    pub has_journald: bool,
    pub has_grub: bool,
    pub has_python3: bool,
    pub has_perl: bool,
    pub has_ruby: bool,
    pub has_nodejs: bool,
    pub has_java: bool,
    pub has_php: bool,
    pub has_go: bool,
    pub has_rust: bool,
    pub has_gcc: bool,
    pub has_make: bool,
    pub has_git: bool,
    pub extra: HashMap<String, bool>,
}

// ─── Scan Section (for partial scans) ──────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanSection {
    OsFamily,
    Distro,
    Version,
    InitSystem,
    PackageManagers,
    Shell,
    Kernel,
    Hardware,
    Locale,
    Security,
    Services,
    Capabilities,
}

// ─── OsCapabilities — master struct ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsCapabilities {
    pub os_family: OsFamily,
    pub distro: Option<LinuxDistro>,
    pub version: OsVersion,
    pub init_system: InitSystem,
    pub package_managers: Vec<PackageManager>,
    pub default_shell: Option<ShellInfo>,
    pub available_shells: Vec<ShellInfo>,
    pub kernel: Option<KernelInfo>,
    pub architecture: Architecture,
    pub hardware: Option<HardwareProfile>,
    pub locale: Option<SystemLocale>,
    pub security: Option<SecurityInfo>,
    pub services: Vec<AvailableService>,
    pub capabilities: ServiceCapabilities,
    pub uptime_secs: Option<u64>,
    pub boot_time: Option<DateTime<Utc>>,
    pub hostname: Option<String>,
    pub domain: Option<String>,
    pub fqdn: Option<String>,
    pub detected_at: DateTime<Utc>,
}
