//! systemd-boot (gummiboot) management.
//!
//! Manages `/boot/loader/loader.conf` and `/boot/loader/entries/*.conf`,
//! plus `bootctl` operations.

use crate::client;
use crate::error::BootloaderError;
use crate::types::{BootloaderHost, SystemdBootConfig, SystemdBootEntry, SystemdBootStatus};

// ─── loader.conf ────────────────────────────────────────────────────

/// Parse `/boot/loader/loader.conf` into `SystemdBootConfig`.
pub async fn get_boot_config(host: &BootloaderHost) -> Result<SystemdBootConfig, BootloaderError> {
    let content = client::read_remote_file(host, "/boot/loader/loader.conf").await?;
    Ok(parse_loader_conf(&content))
}

fn parse_loader_conf(content: &str) -> SystemdBootConfig {
    let mut cfg = SystemdBootConfig {
        default_entry: None,
        timeout: None,
        console_mode: None,
        editor_enabled: None,
        auto_entries: None,
        auto_firmware: None,
    };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, val)) = line.split_once(char::is_whitespace) {
            let val = val.trim();
            match key {
                "default" => cfg.default_entry = Some(val.to_string()),
                "timeout" => cfg.timeout = val.parse().ok(),
                "console-mode" => cfg.console_mode = Some(val.to_string()),
                "editor" => cfg.editor_enabled = Some(val == "yes" || val == "1" || val == "true"),
                "auto-entries" => cfg.auto_entries = Some(val == "yes" || val == "1" || val == "true"),
                "auto-firmware" => cfg.auto_firmware = Some(val == "yes" || val == "1" || val == "true"),
                _ => {}
            }
        }
    }
    cfg
}

/// Write a complete `loader.conf`.
pub async fn set_boot_config(
    host: &BootloaderHost,
    config: &SystemdBootConfig,
) -> Result<(), BootloaderError> {
    let content = serialize_loader_conf(config);
    client::write_remote_file(host, "/boot/loader/loader.conf", &content).await
}

fn serialize_loader_conf(cfg: &SystemdBootConfig) -> String {
    let mut lines = Vec::new();
    if let Some(ref d) = cfg.default_entry {
        lines.push(format!("default {d}"));
    }
    if let Some(t) = cfg.timeout {
        lines.push(format!("timeout {t}"));
    }
    if let Some(ref c) = cfg.console_mode {
        lines.push(format!("console-mode {c}"));
    }
    if let Some(e) = cfg.editor_enabled {
        lines.push(format!("editor {}", if e { "yes" } else { "no" }));
    }
    if let Some(a) = cfg.auto_entries {
        lines.push(format!("auto-entries {}", if a { "yes" } else { "no" }));
    }
    if let Some(a) = cfg.auto_firmware {
        lines.push(format!("auto-firmware {}", if a { "yes" } else { "no" }));
    }
    lines.join("\n") + "\n"
}

// ─── Boot entries (/boot/loader/entries/*.conf) ─────────────────────

/// List all systemd-boot entries from `/boot/loader/entries/`.
pub async fn list_boot_entries(
    host: &BootloaderHost,
) -> Result<Vec<SystemdBootEntry>, BootloaderError> {
    let file_list = client::exec_ok(
        host,
        "find",
        &["/boot/loader/entries", "-name", "*.conf", "-type", "f"],
    )
    .await?;

    let mut entries = Vec::new();
    for path in file_list.lines() {
        let path = path.trim();
        if path.is_empty() {
            continue;
        }
        let content = client::read_remote_file(host, path).await?;
        let id = path
            .rsplit('/')
            .next()
            .unwrap_or(path)
            .trim_end_matches(".conf")
            .to_string();
        entries.push(parse_boot_entry(&id, &content));
    }
    Ok(entries)
}

/// Get a single boot entry by id.
pub async fn get_boot_entry(
    host: &BootloaderHost,
    id: &str,
) -> Result<SystemdBootEntry, BootloaderError> {
    let path = format!("/boot/loader/entries/{id}.conf");
    let content = client::read_remote_file(host, &path).await.map_err(|_| {
        BootloaderError::BootEntryNotFound(id.into())
    })?;
    Ok(parse_boot_entry(id, &content))
}

fn parse_boot_entry(id: &str, content: &str) -> SystemdBootEntry {
    let mut entry = SystemdBootEntry {
        id: id.to_string(),
        title: String::new(),
        version: None,
        machine_id: None,
        linux_path: String::new(),
        initrd: Vec::new(),
        options: None,
    };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, val)) = line.split_once(char::is_whitespace) {
            let val = val.trim().to_string();
            match key {
                "title" => entry.title = val,
                "version" => entry.version = Some(val),
                "machine-id" => entry.machine_id = Some(val),
                "linux" => entry.linux_path = val,
                "initrd" => entry.initrd.push(val),
                "options" => entry.options = Some(val),
                _ => {}
            }
        }
    }
    entry
}

/// Create a new boot entry file.
pub async fn create_boot_entry(
    host: &BootloaderHost,
    entry: &SystemdBootEntry,
) -> Result<(), BootloaderError> {
    let path = format!("/boot/loader/entries/{}.conf", entry.id);
    let content = serialize_boot_entry(entry);
    client::write_remote_file(host, &path, &content).await
}

/// Update an existing boot entry.
pub async fn update_boot_entry(
    host: &BootloaderHost,
    id: &str,
    entry: &SystemdBootEntry,
) -> Result<(), BootloaderError> {
    let path = format!("/boot/loader/entries/{id}.conf");
    // Verify it exists
    let (_, _, code) = client::exec(host, "test", &["-f", &path]).await?;
    if code != 0 {
        return Err(BootloaderError::BootEntryNotFound(id.into()));
    }
    let content = serialize_boot_entry(entry);
    client::write_remote_file(host, &path, &content).await
}

/// Delete a boot entry.
pub async fn delete_boot_entry(
    host: &BootloaderHost,
    id: &str,
) -> Result<(), BootloaderError> {
    let path = format!("/boot/loader/entries/{id}.conf");
    client::exec_ok(host, "rm", &["-f", &path]).await?;
    Ok(())
}

fn serialize_boot_entry(entry: &SystemdBootEntry) -> String {
    let mut lines = Vec::new();
    lines.push(format!("title   {}", entry.title));
    if let Some(ref v) = entry.version {
        lines.push(format!("version {v}"));
    }
    if let Some(ref m) = entry.machine_id {
        lines.push(format!("machine-id {m}"));
    }
    lines.push(format!("linux   {}", entry.linux_path));
    for i in &entry.initrd {
        lines.push(format!("initrd  {i}"));
    }
    if let Some(ref o) = entry.options {
        lines.push(format!("options {o}"));
    }
    lines.join("\n") + "\n"
}

// ─── bootctl operations ────────────────────────────────────────────

/// Set the default boot entry for all subsequent boots.
pub async fn set_default_boot_entry(
    host: &BootloaderHost,
    id: &str,
) -> Result<(), BootloaderError> {
    client::exec_ok(host, "bootctl", &["set-default", &format!("{id}.conf")]).await?;
    Ok(())
}

/// Set a one-shot boot entry (next boot only).
pub async fn set_oneshot_boot_entry(
    host: &BootloaderHost,
    id: &str,
) -> Result<(), BootloaderError> {
    client::exec_ok(host, "bootctl", &["set-oneshot", &format!("{id}.conf")]).await?;
    Ok(())
}

/// Install systemd-boot to the ESP.
pub async fn install_systemd_boot(host: &BootloaderHost) -> Result<String, BootloaderError> {
    client::exec_ok(host, "bootctl", &["install"]).await
}

/// Update systemd-boot in the ESP.
pub async fn update_systemd_boot(host: &BootloaderHost) -> Result<String, BootloaderError> {
    client::exec_ok(host, "bootctl", &["update"]).await
}

/// Parse `bootctl status` output.
pub async fn boot_status(host: &BootloaderHost) -> Result<SystemdBootStatus, BootloaderError> {
    let raw = client::exec_ok(host, "bootctl", &["status"]).await?;
    Ok(parse_bootctl_status(&raw))
}

fn parse_bootctl_status(raw: &str) -> SystemdBootStatus {
    let mut status = SystemdBootStatus {
        firmware: None,
        firmware_arch: None,
        secure_boot: None,
        boot_into_firmware: None,
        current_entry: None,
        default_entry: None,
        raw: raw.to_string(),
    };

    for line in raw.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("Firmware:") {
            let val = val.trim();
            // e.g. "UEFI 2.70 (Lenovo 0.4720)"
            status.firmware = Some(val.to_string());
        } else if let Some(val) = line.strip_prefix("Firmware Arch:") {
            status.firmware_arch = Some(val.trim().to_string());
        } else if let Some(val) = line.strip_prefix("Secure Boot:") {
            let val = val.trim().to_lowercase();
            status.secure_boot = Some(val.contains("enabled") || val.contains("yes"));
        } else if let Some(val) = line.strip_prefix("Set up for boot into firmware:") {
            let val = val.trim().to_lowercase();
            status.boot_into_firmware = Some(val.contains("yes") || val.contains("supported"));
        } else if let Some(val) = line.strip_prefix("Default Boot Loader Entry:") {
            status.default_entry = Some(val.trim().to_string());
        } else if let Some(val) = line.strip_prefix("Selected Boot Loader Entry:") {
            status.current_entry = Some(val.trim().to_string());
        }
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOADER_CONF: &str = "\
default arch.conf
timeout 5
console-mode max
editor no
auto-entries yes
auto-firmware no
";

    #[test]
    fn test_parse_loader_conf() {
        let cfg = parse_loader_conf(LOADER_CONF);
        assert_eq!(cfg.default_entry.as_deref(), Some("arch.conf"));
        assert_eq!(cfg.timeout, Some(5));
        assert_eq!(cfg.console_mode.as_deref(), Some("max"));
        assert_eq!(cfg.editor_enabled, Some(false));
        assert_eq!(cfg.auto_entries, Some(true));
        assert_eq!(cfg.auto_firmware, Some(false));
    }

    #[test]
    fn test_serialize_loader_conf_roundtrip() {
        let cfg = parse_loader_conf(LOADER_CONF);
        let serialized = serialize_loader_conf(&cfg);
        let cfg2 = parse_loader_conf(&serialized);
        assert_eq!(cfg.default_entry, cfg2.default_entry);
        assert_eq!(cfg.timeout, cfg2.timeout);
        assert_eq!(cfg.editor_enabled, cfg2.editor_enabled);
    }

    const BOOT_ENTRY: &str = "\
title   Arch Linux
version 6.6.10-arch1-1
machine-id abc123
linux   /vmlinuz-linux
initrd  /intel-ucode.img
initrd  /initramfs-linux.img
options root=PARTUUID=xxxx rw quiet
";

    #[test]
    fn test_parse_boot_entry() {
        let entry = parse_boot_entry("arch", BOOT_ENTRY);
        assert_eq!(entry.id, "arch");
        assert_eq!(entry.title, "Arch Linux");
        assert_eq!(entry.version.as_deref(), Some("6.6.10-arch1-1"));
        assert_eq!(entry.linux_path, "/vmlinuz-linux");
        assert_eq!(entry.initrd.len(), 2);
        assert_eq!(entry.initrd[0], "/intel-ucode.img");
        assert!(entry.options.as_deref().unwrap().contains("quiet"));
    }

    const BOOTCTL_STATUS: &str = "\
System:
     Firmware: UEFI 2.70 (Lenovo 0.4720)
  Firmware Arch: x64
    Secure Boot: disabled
  Set up for boot into firmware: supported

Current Boot Loader:
      Product: systemd-boot 254.5-1-arch
Selected Boot Loader Entry:
        title: Arch Linux
Default Boot Loader Entry:
        title: Arch Linux
";

    #[test]
    fn test_parse_bootctl_status() {
        let status = parse_bootctl_status(BOOTCTL_STATUS);
        assert!(status.firmware.as_deref().unwrap().contains("UEFI 2.70"));
        assert_eq!(status.firmware_arch.as_deref(), Some("x64"));
        assert_eq!(status.secure_boot, Some(false));
        assert!(status.default_entry.is_some());
    }
}
