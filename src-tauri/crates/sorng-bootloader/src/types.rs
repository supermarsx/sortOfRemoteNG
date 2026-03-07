//! Data types for bootloader management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── SSH / Host ─────────────────────────────────────────────────────

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
pub struct BootloaderHost {
    pub id: String,
    pub name: String,
    pub ssh: Option<SshConfig>,
    pub use_sudo: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── Bootloader type detection ──────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BootloaderType {
    Grub2,
    SystemdBoot,
    Grub1Legacy,
    Lilo,
    Syslinux,
    Refind,
    UBoot,
    Unknown,
}

// ─── Generic boot entry ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootEntry {
    pub id: String,
    pub title: String,
    pub kernel_path: Option<String>,
    pub initrd_path: Option<String>,
    pub root_device: Option<String>,
    pub kernel_params: Option<String>,
    pub is_default: bool,
    pub is_recovery: bool,
}

// ─── GRUB2 ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrubConfig {
    pub default_entry: String,
    pub timeout: i32,
    pub hidden_timeout: Option<i32>,
    pub gfx_mode: Option<String>,
    pub terminal_output: Option<String>,
    pub serial_command: Option<String>,
    pub custom_entries: Vec<GrubMenuEntry>,
    pub params: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrubMenuEntry {
    pub id: String,
    pub title: String,
    pub entry_class: Option<String>,
    pub kernel: Option<String>,
    pub initrd: Option<String>,
    pub root: Option<String>,
    pub extra_params: Option<String>,
    pub submenu_entries: Vec<GrubMenuEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrubEnvironment {
    pub saved_entry: Option<String>,
    pub next_entry: Option<String>,
    pub variables: HashMap<String, String>,
}

// ─── Grub script info ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrubScript {
    pub name: String,
    pub path: String,
    pub enabled: bool,
}

// ─── systemd-boot ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemdBootConfig {
    pub default_entry: Option<String>,
    pub timeout: Option<u32>,
    pub console_mode: Option<String>,
    pub editor_enabled: Option<bool>,
    pub auto_entries: Option<bool>,
    pub auto_firmware: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemdBootEntry {
    pub id: String,
    pub title: String,
    pub version: Option<String>,
    pub machine_id: Option<String>,
    pub linux_path: String,
    pub initrd: Vec<String>,
    pub options: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemdBootStatus {
    pub firmware: Option<String>,
    pub firmware_arch: Option<String>,
    pub secure_boot: Option<bool>,
    pub boot_into_firmware: Option<bool>,
    pub current_entry: Option<String>,
    pub default_entry: Option<String>,
    pub raw: String,
}

// ─── UEFI ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UefiBootEntry {
    pub boot_num: String,
    pub description: String,
    pub path: Option<String>,
    pub active: bool,
    pub device_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UefiInfo {
    pub firmware_vendor: Option<String>,
    pub firmware_version: Option<String>,
    pub secure_boot: Option<bool>,
    pub boot_current: Option<String>,
    pub boot_order: Vec<String>,
    pub entries: Vec<UefiBootEntry>,
}

// ─── Kernel ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelVersion {
    pub version: String,
    pub release: String,
    pub full_path: String,
    pub initrd_path: Option<String>,
    pub installed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootParameter {
    pub key: String,
    pub value: Option<String>,
}

// ─── Initramfs ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitramfsInfo {
    pub kernel_version: String,
    pub path: String,
    pub size_bytes: u64,
    pub modules: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InitramfsTool {
    Mkinitcpio,
    Dracut,
    UpdateInitramfs,
    Unknown,
}

// ─── Boot partition info ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootPartitionInfo {
    pub device: String,
    pub mount_point: String,
    pub fs_type: String,
    pub is_esp: bool,
}
