//! Boot loader and boot mode detection.
//!
//! Detects which boot loader is installed and whether the system
//! booted in UEFI or legacy BIOS mode.

use crate::client;
use crate::error::BootloaderError;
use crate::types::{BootPartitionInfo, BootloaderHost, BootloaderType};

/// Detect the primary boot loader installed on the host.
pub async fn detect_bootloader(host: &BootloaderHost) -> Result<BootloaderType, BootloaderError> {
    // Check for systemd-boot first (bootctl exists and reports systemd-boot)
    if let Ok((stdout, _, 0)) = client::exec(host, "bootctl", &["is-installed"]).await {
        let _ = stdout;
        return Ok(BootloaderType::SystemdBoot);
    }
    // bootctl is-installed may not exist on older systemd — also check bootctl status
    if let Ok((stdout, _, 0)) = client::exec(host, "bootctl", &["status"]).await {
        if stdout.contains("systemd-boot") {
            return Ok(BootloaderType::SystemdBoot);
        }
    }

    // Check for GRUB2
    for cmd in &["grub-install", "grub2-install"] {
        let (_, _, code) = client::exec(host, "which", &[cmd]).await?;
        if code == 0 {
            return Ok(BootloaderType::Grub2);
        }
    }

    // Check for rEFInd
    let (_, _, code) = client::exec(host, "which", &["refind-install"]).await?;
    if code == 0 {
        return Ok(BootloaderType::Refind);
    }

    // Check for LILO
    let (_, _, code) = client::exec(host, "which", &["lilo"]).await?;
    if code == 0 {
        return Ok(BootloaderType::Lilo);
    }

    // Check for syslinux/extlinux
    let (_, _, code) = client::exec(host, "which", &["syslinux"]).await?;
    if code == 0 {
        return Ok(BootloaderType::Syslinux);
    }
    let (_, _, code) = client::exec(host, "which", &["extlinux"]).await?;
    if code == 0 {
        return Ok(BootloaderType::Syslinux);
    }

    // Check for U-Boot
    let (_, _, code) = client::exec(host, "which", &["fw_printenv"]).await?;
    if code == 0 {
        return Ok(BootloaderType::UBoot);
    }

    // Check for legacy GRUB (grub 0.97)
    let (_, _, code) = client::exec(host, "which", &["grub"]).await?;
    if code == 0 {
        // Distinguish GRUB1 from GRUB2 by checking version
        let (stdout, _, _) = client::exec(host, "grub", &["--version"]).await?;
        if !stdout.contains("2.") {
            return Ok(BootloaderType::Grub1Legacy);
        }
    }

    // Check for grub.cfg existence as a fallback
    for path in &["/boot/grub/grub.cfg", "/boot/grub2/grub.cfg"] {
        let (_, _, code) = client::exec(host, "test", &["-f", path]).await?;
        if code == 0 {
            return Ok(BootloaderType::Grub2);
        }
    }

    Ok(BootloaderType::Unknown)
}

/// Detect whether the system booted in UEFI or legacy BIOS mode.
pub async fn detect_boot_mode(host: &BootloaderHost) -> Result<String, BootloaderError> {
    let (_, _, code) = client::exec(host, "test", &["-d", "/sys/firmware/efi"]).await?;
    if code == 0 {
        Ok("uefi".to_string())
    } else {
        Ok("bios".to_string())
    }
}

/// Detect boot-related partitions (ESP, /boot).
pub async fn get_boot_partitions(
    host: &BootloaderHost,
) -> Result<Vec<BootPartitionInfo>, BootloaderError> {
    let output = client::exec_ok(
        host,
        "findmnt",
        &[
            "-n",
            "-o",
            "SOURCE,TARGET,FSTYPE",
            "-t",
            "vfat,ext4,ext2,xfs,btrfs",
        ],
    )
    .await?;

    let mut partitions = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let device = parts[0].to_string();
        let mount_point = parts[1].to_string();
        let fs_type = parts[2].to_string();

        // Include only boot-relevant mounts
        let is_boot_relevant = mount_point == "/boot"
            || mount_point == "/boot/efi"
            || mount_point == "/efi"
            || mount_point == "/boot/EFI";
        if !is_boot_relevant {
            continue;
        }

        let is_esp =
            (mount_point.contains("efi") || mount_point.contains("EFI")) && fs_type == "vfat";

        partitions.push(BootPartitionInfo {
            device,
            mount_point,
            fs_type,
            is_esp,
        });
    }

    // If no ESP found via mount, check for EFI system partition via lsblk
    if !partitions.iter().any(|p| p.is_esp) {
        if let Ok(lsblk_output) = client::exec_ok(
            host,
            "lsblk",
            &["-n", "-o", "NAME,FSTYPE,PARTTYPE,MOUNTPOINT"],
        )
        .await
        {
            for line in lsblk_output.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    // EFI System Partition GUID: c12a7328-f81f-11d2-ba4b-00a0c93ec93b
                    let parttype = parts.get(2).unwrap_or(&"");
                    if parttype.to_lowercase().contains("c12a7328") {
                        let mount = parts.get(3).unwrap_or(&"").to_string();
                        partitions.push(BootPartitionInfo {
                            device: format!(
                                "/dev/{}",
                                parts[0]
                                    .trim_start_matches('└')
                                    .trim_start_matches('├')
                                    .trim_start_matches('─')
                            ),
                            mount_point: if mount.is_empty() {
                                "(unmounted)".into()
                            } else {
                                mount
                            },
                            fs_type: parts.get(1).unwrap_or(&"vfat").to_string(),
                            is_esp: true,
                        });
                    }
                }
            }
        }
    }

    Ok(partitions)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Detection tests require actual host access, so we keep unit tests minimal.
    // Integration tests would use a real or mocked BootloaderHost.

    #[test]
    fn test_bootloader_type_serde() {
        let t = BootloaderType::Grub2;
        let json = serde_json::to_string(&t).unwrap();
        assert_eq!(json, "\"grub2\"");
        let parsed: BootloaderType = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, BootloaderType::Grub2);
    }

    #[test]
    fn test_bootloader_type_roundtrip() {
        for variant in &[
            BootloaderType::Grub2,
            BootloaderType::SystemdBoot,
            BootloaderType::Grub1Legacy,
            BootloaderType::Lilo,
            BootloaderType::Syslinux,
            BootloaderType::Refind,
            BootloaderType::UBoot,
            BootloaderType::Unknown,
        ] {
            let json = serde_json::to_string(variant).unwrap();
            let parsed: BootloaderType = serde_json::from_str(&json).unwrap();
            assert_eq!(&parsed, variant);
        }
    }
}
