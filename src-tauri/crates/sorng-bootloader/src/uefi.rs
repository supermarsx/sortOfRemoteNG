//! UEFI boot management via `efibootmgr`.

use crate::client;
use crate::error::BootloaderError;
use crate::types::{BootloaderHost, UefiBootEntry, UefiInfo};

/// List all UEFI boot entries by parsing `efibootmgr -v`.
pub async fn list_uefi_entries(
    host: &BootloaderHost,
) -> Result<Vec<UefiBootEntry>, BootloaderError> {
    let output = client::exec_ok(host, "efibootmgr", &["-v"]).await?;
    Ok(parse_efibootmgr_entries(&output))
}

fn parse_efibootmgr_entries(output: &str) -> Vec<UefiBootEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        // Lines like: Boot0001* ubuntu	HD(1,...)/File(\EFI\ubuntu\shimx64.efi)
        // or:         Boot0002  Windows Boot Manager	HD(1,...)/File(...)
        if !line.starts_with("Boot") {
            continue;
        }
        // Skip BootCurrent, BootOrder, etc.
        let rest = &line[4..];
        if rest.starts_with("Current:") || rest.starts_with("Order:") || rest.starts_with("Next:") {
            continue;
        }

        // Parse boot number (4 hex digits)
        if rest.len() < 4 {
            continue;
        }
        let boot_num = rest[..4].to_string();
        if !boot_num.chars().all(|c| c.is_ascii_hexdigit()) {
            continue;
        }

        let after_num = &rest[4..];
        let active = after_num.starts_with('*');
        let description_start = if active { &after_num[1..] } else { after_num };
        let description_start = description_start.trim_start();

        // Split description from device path by tab or multiple spaces
        let (description, device_path, file_path) =
            if let Some(tab_pos) = description_start.find('\t') {
                let desc = description_start[..tab_pos].trim().to_string();
                let dp = description_start[tab_pos + 1..].trim().to_string();
                let fp = extract_file_path(&dp);
                (desc, Some(dp), fp)
            } else {
                (description_start.trim().to_string(), None, None)
            };

        entries.push(UefiBootEntry {
            boot_num,
            description,
            path: file_path,
            active,
            device_path,
        });
    }
    entries
}

fn extract_file_path(device_path: &str) -> Option<String> {
    // Look for File(\path\to\loader.efi)
    if let Some(start) = device_path.find("File(") {
        let rest = &device_path[start + 5..];
        if let Some(end) = rest.find(')') {
            return Some(rest[..end].replace('\\', "/"));
        }
    }
    None
}

/// Get the current UEFI boot order.
pub async fn get_boot_order(host: &BootloaderHost) -> Result<Vec<String>, BootloaderError> {
    let output = client::exec_ok(host, "efibootmgr", &[]).await?;
    Ok(parse_boot_order(&output))
}

fn parse_boot_order(output: &str) -> Vec<String> {
    for line in output.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("BootOrder:") {
            return rest
                .trim()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
    }
    Vec::new()
}

/// Set the UEFI boot order.
pub async fn set_boot_order(
    host: &BootloaderHost,
    order: &[String],
) -> Result<(), BootloaderError> {
    let order_str = order.join(",");
    client::exec_ok(host, "efibootmgr", &["-o", &order_str]).await?;
    Ok(())
}

/// Create a new UEFI boot entry.
pub async fn create_uefi_entry(
    host: &BootloaderHost,
    label: &str,
    loader: &str,
    params: Option<&str>,
) -> Result<String, BootloaderError> {
    // Detect ESP disk and partition
    let (disk, part) = detect_esp_disk_part(host).await?;
    let mut args = vec![
        "-c", "-d", &disk, "-p", &part, "-L", label, "-l", loader,
    ];
    if let Some(p) = params {
        args.push("-u");
        args.push(p);
    }
    client::exec_ok(host, "efibootmgr", &args).await
}

/// Delete a UEFI boot entry.
pub async fn delete_uefi_entry(
    host: &BootloaderHost,
    boot_num: &str,
) -> Result<(), BootloaderError> {
    client::exec_ok(host, "efibootmgr", &["-b", boot_num, "-B"]).await?;
    Ok(())
}

/// Activate a UEFI boot entry.
pub async fn activate_uefi_entry(
    host: &BootloaderHost,
    boot_num: &str,
) -> Result<(), BootloaderError> {
    client::exec_ok(host, "efibootmgr", &["-b", boot_num, "-a"]).await?;
    Ok(())
}

/// Deactivate a UEFI boot entry.
pub async fn deactivate_uefi_entry(
    host: &BootloaderHost,
    boot_num: &str,
) -> Result<(), BootloaderError> {
    client::exec_ok(host, "efibootmgr", &["-b", boot_num, "-A"]).await?;
    Ok(())
}

/// Set a one-time next boot entry.
pub async fn set_next_boot(
    host: &BootloaderHost,
    boot_num: &str,
) -> Result<(), BootloaderError> {
    client::exec_ok(host, "efibootmgr", &["-n", boot_num]).await?;
    Ok(())
}

/// Get UEFI firmware information including secure boot status.
pub async fn get_uefi_info(host: &BootloaderHost) -> Result<UefiInfo, BootloaderError> {
    let efi_output = client::exec_ok(host, "efibootmgr", &["-v"]).await?;
    let entries = parse_efibootmgr_entries(&efi_output);
    let boot_order = parse_boot_order(&efi_output);

    let boot_current = efi_output.lines().find_map(|l| {
        l.trim()
            .strip_prefix("BootCurrent:")
            .map(|v| v.trim().to_string())
    });

    // Try to read firmware vendor
    let firmware_vendor = client::read_remote_file(host, "/sys/firmware/efi/fw_vendor")
        .await
        .ok()
        .map(|s| s.trim().replace('\0', ""));

    // Try to read firmware version
    let firmware_version = client::read_remote_file(host, "/sys/firmware/efi/runtime")
        .await
        .ok()
        .map(|s| s.trim().to_string());

    // Secure boot status
    let secure_boot = detect_secure_boot(host).await.ok();

    Ok(UefiInfo {
        firmware_vendor,
        firmware_version,
        secure_boot,
        boot_current,
        boot_order,
        entries,
    })
}

async fn detect_secure_boot(host: &BootloaderHost) -> Result<bool, BootloaderError> {
    // Try mokutil first
    match client::exec(host, "mokutil", &["--sb-state"]).await {
        Ok((stdout, _, 0)) => {
            return Ok(stdout.to_lowercase().contains("secureboot enabled"));
        }
        _ => {}
    }
    // Fallback: read EFI variable
    let content = client::exec_shell(
        host,
        "od -An -t u1 /sys/firmware/efi/efivars/SecureBoot-* 2>/dev/null | tail -c 2",
    )
    .await
    .unwrap_or_default();
    Ok(content.trim() == "1")
}

async fn detect_esp_disk_part(host: &BootloaderHost) -> Result<(String, String), BootloaderError> {
    // Find the ESP mount point via findmnt
    let output = match client::exec_ok(host, "findmnt", &["-n", "-o", "SOURCE", "/boot/efi"]).await {
        Ok(out) => out,
        Err(_) => {
            // Some systems mount ESP at /efi
            client::exec_ok(host, "findmnt", &["-n", "-o", "SOURCE", "/efi"])
                .await
                .unwrap_or_else(|_| "/dev/sda1".to_string())
        }
    };

    let source = output.trim();
    // Parse e.g. /dev/sda1 -> disk=/dev/sda, part=1
    // or /dev/nvme0n1p1 -> disk=/dev/nvme0n1, part=1
    let (disk, part) = if source.contains("nvme") || source.contains("mmcblk") {
        // /dev/nvme0n1p1 — partition delimited by 'p' before digits
        if let Some(p_pos) = source.rfind('p') {
            let part_num = &source[p_pos + 1..];
            let disk_name = &source[..p_pos];
            (disk_name.to_string(), part_num.to_string())
        } else {
            (source.to_string(), "1".to_string())
        }
    } else {
        // /dev/sda1 — last digit run is partition
        let split_pos = source
            .rfind(|c: char| !c.is_ascii_digit())
            .map(|p| p + 1)
            .unwrap_or(source.len());
        let disk_name = &source[..split_pos];
        let part_num = &source[split_pos..];
        let part_num = if part_num.is_empty() { "1" } else { part_num };
        (disk_name.to_string(), part_num.to_string())
    };
    Ok((disk, part))
}

#[cfg(test)]
mod tests {
    use super::*;

    const EFI_OUTPUT: &str = "\
BootCurrent: 0001
Timeout: 5 seconds
BootOrder: 0001,0002,0003
Boot0001* ubuntu\tHD(1,GPT,...)/File(\\EFI\\ubuntu\\shimx64.efi)
Boot0002* Windows Boot Manager\tHD(1,GPT,...)/File(\\EFI\\Microsoft\\Boot\\bootmgfw.efi)
Boot0003  Network Boot\tPXEv4(...)
";

    #[test]
    fn test_parse_efibootmgr_entries() {
        let entries = parse_efibootmgr_entries(EFI_OUTPUT);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].boot_num, "0001");
        assert_eq!(entries[0].description, "ubuntu");
        assert!(entries[0].active);
        assert_eq!(
            entries[0].path.as_deref(),
            Some("/EFI/ubuntu/shimx64.efi")
        );
        assert_eq!(entries[1].description, "Windows Boot Manager");
        assert!(!entries[2].active);
    }

    #[test]
    fn test_parse_boot_order() {
        let order = parse_boot_order(EFI_OUTPUT);
        assert_eq!(order, vec!["0001", "0002", "0003"]);
    }

    #[test]
    fn test_extract_file_path() {
        assert_eq!(
            extract_file_path("HD(1,GPT,...)/File(\\EFI\\ubuntu\\shimx64.efi)"),
            Some("/EFI/ubuntu/shimx64.efi".to_string())
        );
        assert_eq!(extract_file_path("PXEv4(...)"), None);
    }
}
