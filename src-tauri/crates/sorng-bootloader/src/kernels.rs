//! Installed kernel management.
//!
//! Scans `/boot/` for vmlinuz images, parses `/proc/cmdline`,
//! and manages kernel command-line parameters in GRUB.

use crate::client;
use crate::error::BootloaderError;
use crate::types::{BootParameter, BootloaderHost, KernelVersion};
use chrono::{DateTime, Utc};

/// List installed kernels by scanning `/boot/vmlinuz*` and `/boot/vmlinux*`.
pub async fn list_installed_kernels(
    host: &BootloaderHost,
) -> Result<Vec<KernelVersion>, BootloaderError> {
    // stat format: path\tmodify_epoch
    let output = client::exec_shell(
        host,
        "find /boot -maxdepth 1 \\( -name 'vmlinuz*' -o -name 'vmlinux*' \\) -printf '%p\\t%T@\\n' 2>/dev/null | sort -t$'\\t' -k2 -rn",
    )
    .await?;

    let mut kernels = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        let full_path = parts[0].to_string();
        let installed_at = parts.get(1).and_then(|epoch_str| {
            let secs = epoch_str.trim().parse::<f64>().ok()?;
            DateTime::<Utc>::from_timestamp(secs as i64, 0)
        });

        let filename = full_path.rsplit('/').next().unwrap_or(&full_path);
        // vmlinuz-6.6.10-arch1-1 -> version part after first '-'
        let version_str = filename
            .strip_prefix("vmlinuz-")
            .or_else(|| filename.strip_prefix("vmlinux-"))
            .unwrap_or(filename);

        // release = full version string, version = major part
        let release = version_str.to_string();
        let version = version_str
            .split('-')
            .next()
            .unwrap_or(version_str)
            .to_string();

        // Look for matching initrd
        let initrd_path = find_matching_initrd(host, version_str).await.ok();

        kernels.push(KernelVersion {
            version,
            release,
            full_path,
            initrd_path,
            installed_at,
        });
    }
    Ok(kernels)
}

async fn find_matching_initrd(
    host: &BootloaderHost,
    version: &str,
) -> Result<String, BootloaderError> {
    // Check common initrd naming patterns
    for pattern in &[
        format!("/boot/initramfs-{version}.img"),
        format!("/boot/initrd.img-{version}"),
        format!("/boot/initramfs-{version}-fallback.img"),
        format!("/boot/initrd-{version}"),
    ] {
        let (_, _, code) = client::exec(host, "test", &["-f", pattern]).await?;
        if code == 0 {
            return Ok(pattern.clone());
        }
    }
    Err(BootloaderError::Other("No matching initrd found".into()))
}

/// Get the currently running kernel version.
pub async fn get_running_kernel(host: &BootloaderHost) -> Result<String, BootloaderError> {
    let output = client::exec_ok(host, "uname", &["-r"]).await?;
    Ok(output.trim().to_string())
}

/// Get current kernel boot parameters from `/proc/cmdline`.
pub async fn get_kernel_params(
    host: &BootloaderHost,
) -> Result<Vec<BootParameter>, BootloaderError> {
    let cmdline = client::read_remote_file(host, "/proc/cmdline").await?;
    Ok(parse_cmdline(&cmdline))
}

fn parse_cmdline(cmdline: &str) -> Vec<BootParameter> {
    let mut params = Vec::new();
    for token in cmdline.split_whitespace() {
        if let Some((key, val)) = token.split_once('=') {
            params.push(BootParameter {
                key: key.to_string(),
                value: Some(val.to_string()),
            });
        } else {
            params.push(BootParameter {
                key: token.to_string(),
                value: None,
            });
        }
    }
    params
}

/// Set kernel parameters by rewriting `GRUB_CMDLINE_LINUX_DEFAULT` in `/etc/default/grub`.
pub async fn set_kernel_params(
    host: &BootloaderHost,
    params: &[BootParameter],
) -> Result<(), BootloaderError> {
    let value = params
        .iter()
        .map(|p| match &p.value {
            Some(v) => format!("{}={}", p.key, v),
            None => p.key.clone(),
        })
        .collect::<Vec<_>>()
        .join(" ");
    crate::grub::set_grub_param(host, "GRUB_CMDLINE_LINUX_DEFAULT", &value).await
}

/// Append a kernel parameter to `GRUB_CMDLINE_LINUX_DEFAULT`.
pub async fn add_kernel_param(
    host: &BootloaderHost,
    param: &BootParameter,
) -> Result<(), BootloaderError> {
    let cfg = crate::grub::get_grub_config(host).await?;
    let current = cfg
        .params
        .get("GRUB_CMDLINE_LINUX_DEFAULT")
        .cloned()
        .unwrap_or_default();
    let new_param = match &param.value {
        Some(v) => format!("{}={}", param.key, v),
        None => param.key.clone(),
    };
    let new_value = if current.is_empty() {
        new_param
    } else {
        format!("{current} {new_param}")
    };
    crate::grub::set_grub_param(host, "GRUB_CMDLINE_LINUX_DEFAULT", &new_value).await
}

/// Remove a kernel parameter from `GRUB_CMDLINE_LINUX_DEFAULT`.
pub async fn remove_kernel_param(
    host: &BootloaderHost,
    param: &BootParameter,
) -> Result<(), BootloaderError> {
    let cfg = crate::grub::get_grub_config(host).await?;
    let current = cfg
        .params
        .get("GRUB_CMDLINE_LINUX_DEFAULT")
        .cloned()
        .unwrap_or_default();
    let needle = match &param.value {
        Some(v) => format!("{}={}", param.key, v),
        None => param.key.clone(),
    };
    let filtered: Vec<&str> = current
        .split_whitespace()
        .filter(|tok| {
            if let Some((k, _)) = tok.split_once('=') {
                k != param.key
            } else {
                *tok != needle
            }
        })
        .collect();
    let new_value = filtered.join(" ");
    crate::grub::set_grub_param(host, "GRUB_CMDLINE_LINUX_DEFAULT", &new_value).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cmdline() {
        let params =
            parse_cmdline("BOOT_IMAGE=/vmlinuz-linux root=UUID=abc-123 rw quiet splash loglevel=3");
        assert_eq!(params.len(), 6);
        assert_eq!(params[0].key, "BOOT_IMAGE");
        assert_eq!(params[0].value.as_deref(), Some("/vmlinuz-linux"));
        assert_eq!(params[1].key, "root");
        assert_eq!(params[1].value.as_deref(), Some("UUID=abc-123"));
        assert_eq!(params[2].key, "rw");
        assert!(params[2].value.is_none());
        assert_eq!(params[3].key, "quiet");
        assert!(params[3].value.is_none());
        assert_eq!(params[5].key, "loglevel");
        assert_eq!(params[5].value.as_deref(), Some("3"));
    }

    #[test]
    fn test_parse_cmdline_empty() {
        let params = parse_cmdline("");
        assert!(params.is_empty());
    }
}
