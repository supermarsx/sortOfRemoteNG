//! Initramfs / initrd management.
//!
//! Supports mkinitcpio (Arch), dracut (Fedora/RHEL), and update-initramfs (Debian/Ubuntu).

use crate::client;
use crate::error::BootloaderError;
use crate::types::{BootloaderHost, InitramfsInfo, InitramfsTool};
use std::collections::HashMap;

/// List initramfs images in `/boot/`.
pub async fn list_initramfs(host: &BootloaderHost) -> Result<Vec<InitramfsInfo>, BootloaderError> {
    let output = client::exec_shell(
        host,
        "find /boot -maxdepth 1 \\( -name 'initramfs*' -o -name 'initrd*' \\) -printf '%p\\t%s\\n' 2>/dev/null",
    )
    .await?;

    let mut images = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let path = parts[0].to_string();
        let size_bytes = parts[1].trim().parse::<u64>().unwrap_or(0);
        let filename = path.rsplit('/').next().unwrap_or(&path);

        // Extract kernel version from filename
        // initramfs-6.6.10-arch1-1.img -> 6.6.10-arch1-1
        // initrd.img-5.15.0-91-generic -> 5.15.0-91-generic
        let kernel_version = filename
            .strip_prefix("initramfs-")
            .or_else(|| filename.strip_prefix("initrd.img-"))
            .or_else(|| filename.strip_prefix("initrd-"))
            .map(|s| s.trim_end_matches(".img").trim_end_matches("-fallback"))
            .unwrap_or(filename)
            .to_string();

        images.push(InitramfsInfo {
            kernel_version,
            path,
            size_bytes,
            modules: Vec::new(), // populated on demand by list_initramfs_modules
        });
    }
    Ok(images)
}

/// Rebuild the initramfs for a specific kernel version.
pub async fn rebuild_initramfs(
    host: &BootloaderHost,
    kernel_version: &str,
) -> Result<String, BootloaderError> {
    let tool = detect_initramfs_tool(host).await?;
    match tool {
        InitramfsTool::Mkinitcpio => {
            client::exec_ok(host, "mkinitcpio", &["-p", kernel_version]).await
        }
        InitramfsTool::Dracut => {
            let output_path = format!("/boot/initramfs-{kernel_version}.img");
            client::exec_ok(host, "dracut", &["--force", &output_path, kernel_version]).await
        }
        InitramfsTool::UpdateInitramfs => {
            client::exec_ok(host, "update-initramfs", &["-u", "-k", kernel_version]).await
        }
        InitramfsTool::Unknown => Err(BootloaderError::CommandNotFound(
            "No initramfs tool found (tried mkinitcpio, dracut, update-initramfs)".into(),
        )),
    }
}

/// Get the initramfs configuration file content.
pub async fn get_initramfs_config(
    host: &BootloaderHost,
) -> Result<HashMap<String, String>, BootloaderError> {
    let tool = detect_initramfs_tool(host).await?;
    let config_path = match tool {
        InitramfsTool::Mkinitcpio => "/etc/mkinitcpio.conf",
        InitramfsTool::Dracut => "/etc/dracut.conf",
        InitramfsTool::UpdateInitramfs => "/etc/initramfs-tools/initramfs.conf",
        InitramfsTool::Unknown => {
            return Err(BootloaderError::CommandNotFound(
                "No initramfs tool found".into(),
            ));
        }
    };
    let content = client::read_remote_file(host, config_path).await?;
    Ok(parse_shell_config(&content))
}

fn parse_shell_config(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, val)) = line.split_once('=') {
            let key = key.trim().to_string();
            let val = val.trim().trim_matches('"').trim_matches('\'').to_string();
            map.insert(key, val);
        }
    }
    map
}

/// Set a configuration value in the initramfs config file.
pub async fn set_initramfs_config(
    host: &BootloaderHost,
    key: &str,
    value: &str,
) -> Result<(), BootloaderError> {
    let tool = detect_initramfs_tool(host).await?;
    let config_path = match tool {
        InitramfsTool::Mkinitcpio => "/etc/mkinitcpio.conf",
        InitramfsTool::Dracut => "/etc/dracut.conf",
        InitramfsTool::UpdateInitramfs => "/etc/initramfs-tools/initramfs.conf",
        InitramfsTool::Unknown => {
            return Err(BootloaderError::CommandNotFound(
                "No initramfs tool found".into(),
            ));
        }
    };

    let content = client::read_remote_file(host, config_path).await?;
    let needle = format!("{key}=");
    let new_line = format!("{key}=\"{value}\"");
    let mut found = false;
    let mut lines: Vec<String> = content
        .lines()
        .map(|l| {
            let trimmed = l.trim();
            if trimmed.starts_with(&needle) || trimmed.starts_with(&format!("#{needle}")) {
                found = true;
                new_line.clone()
            } else {
                l.to_string()
            }
        })
        .collect();
    if !found {
        lines.push(new_line);
    }
    let new_content = lines.join("\n");
    client::write_remote_file(host, config_path, &new_content).await
}

/// List modules compiled into an initramfs image.
pub async fn list_initramfs_modules(
    host: &BootloaderHost,
    kernel_version: &str,
) -> Result<Vec<String>, BootloaderError> {
    let tool = detect_initramfs_tool(host).await?;

    let output = match tool {
        InitramfsTool::Mkinitcpio | InitramfsTool::UpdateInitramfs => {
            // lsinitramfs works on Debian; lsinitcpio on Arch
            let initrd = find_initramfs_path(host, kernel_version).await?;
            match client::exec_ok(host, "lsinitcpio", &[&initrd]).await {
                Ok(out) => out,
                Err(_) => client::exec_ok(host, "lsinitramfs", &[&initrd]).await?,
            }
        }
        InitramfsTool::Dracut => {
            let initrd = find_initramfs_path(host, kernel_version).await?;
            client::exec_ok(host, "lsinitrd", &[&initrd]).await?
        }
        InitramfsTool::Unknown => {
            return Err(BootloaderError::CommandNotFound(
                "No initramfs inspection tool found".into(),
            ));
        }
    };

    // Extract .ko module entries
    let modules: Vec<String> = output
        .lines()
        .filter(|l| {
            l.ends_with(".ko")
                || l.ends_with(".ko.zst")
                || l.ends_with(".ko.xz")
                || l.ends_with(".ko.gz")
        })
        .map(|l| {
            l.rsplit('/')
                .next()
                .unwrap_or(l)
                .trim_end_matches(".ko.zst")
                .trim_end_matches(".ko.xz")
                .trim_end_matches(".ko.gz")
                .trim_end_matches(".ko")
                .to_string()
        })
        .collect();

    Ok(modules)
}

async fn find_initramfs_path(
    host: &BootloaderHost,
    kernel_version: &str,
) -> Result<String, BootloaderError> {
    for candidate in &[
        format!("/boot/initramfs-{kernel_version}.img"),
        format!("/boot/initrd.img-{kernel_version}"),
        format!("/boot/initrd-{kernel_version}"),
        format!("/boot/initramfs-{kernel_version}-fallback.img"),
    ] {
        let (_, _, code) = client::exec(host, "test", &["-f", candidate]).await?;
        if code == 0 {
            return Ok(candidate.clone());
        }
    }
    Err(BootloaderError::Other(format!(
        "No initramfs found for kernel {kernel_version}"
    )))
}

/// Detect which initramfs tool is installed on the host.
pub async fn detect_initramfs_tool(
    host: &BootloaderHost,
) -> Result<InitramfsTool, BootloaderError> {
    // Check mkinitcpio (Arch Linux)
    let (_, _, code) = client::exec(host, "which", &["mkinitcpio"]).await?;
    if code == 0 {
        return Ok(InitramfsTool::Mkinitcpio);
    }
    // Check dracut (Fedora, RHEL, openSUSE)
    let (_, _, code) = client::exec(host, "which", &["dracut"]).await?;
    if code == 0 {
        return Ok(InitramfsTool::Dracut);
    }
    // Check update-initramfs (Debian, Ubuntu)
    let (_, _, code) = client::exec(host, "which", &["update-initramfs"]).await?;
    if code == 0 {
        return Ok(InitramfsTool::UpdateInitramfs);
    }
    Ok(InitramfsTool::Unknown)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_shell_config() {
        let content = r#"
# mkinitcpio config
MODULES=(btrfs)
BINARIES=()
FILES=()
HOOKS=(base udev autodetect modconf block filesystems keyboard fsck)
"#;
        let map = parse_shell_config(content);
        assert_eq!(map.get("MODULES").unwrap(), "(btrfs)");
        assert_eq!(
            map.get("HOOKS").unwrap(),
            "(base udev autodetect modconf block filesystems keyboard fsck)"
        );
    }

    #[test]
    fn test_parse_shell_config_dracut() {
        let content = r#"
# dracut.conf
hostonly="yes"
add_dracutmodules+=" lvm dm "
omit_dracutmodules+=" plymouth "
"#;
        let map = parse_shell_config(content);
        assert_eq!(map.get("hostonly").unwrap(), "yes");
        assert!(map.contains_key("add_dracutmodules+"));
    }
}
