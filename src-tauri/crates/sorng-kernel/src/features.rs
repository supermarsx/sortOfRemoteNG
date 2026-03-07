//! Kernel feature detection — /boot/config, cgroups, namespaces, LSMs, I/O schedulers.

use crate::client;
use crate::error::KernelError;
use crate::types::{KernelConfig, KernelHost, KernelVersion};
use std::collections::HashMap;

/// Get the running kernel version.
pub async fn get_kernel_version(host: &KernelHost) -> Result<KernelVersion, KernelError> {
    let version = client::exec_ok(host, "uname", &["-r"]).await?.trim().to_string();
    let full_string = client::exec_ok(host, "uname", &["-a"]).await?.trim().to_string();
    let release = client::exec_ok(host, "uname", &["-v"]).await?.trim().to_string();
    // Try to parse build date from full_string — usually the last date-like segment
    let build_date = extract_build_date(&full_string);
    Ok(KernelVersion { version, release, full_string, build_date })
}

fn extract_build_date(full: &str) -> Option<String> {
    // `uname -a` typically ends with something like "SMP Wed Jan 10 12:00:00 UTC 2024 x86_64"
    // We attempt a rough extraction of date parts
    let parts: Vec<&str> = full.split_whitespace().collect();
    if parts.len() >= 6 {
        // Look for a weekday abbreviation
        let weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        for (i, part) in parts.iter().enumerate() {
            if weekdays.contains(part) && i + 5 <= parts.len() {
                return Some(parts[i..i + 6].join(" "));
            }
        }
    }
    None
}

/// Read the kernel build configuration from /boot/config-$(uname -r) or /proc/config.gz.
pub async fn get_kernel_config(host: &KernelHost) -> Result<Vec<KernelConfig>, KernelError> {
    let cmd = "cat /boot/config-$(uname -r) 2>/dev/null || \
               (zcat /proc/config.gz 2>/dev/null)";
    let out = client::exec_shell(host, cmd).await?;
    if out.trim().is_empty() {
        return Err(KernelError::Other("Kernel config not available".into()));
    }
    Ok(parse_kernel_config(&out))
}

fn parse_kernel_config(text: &str) -> Vec<KernelConfig> {
    let mut configs = Vec::new();
    let mut current_section = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Section headers are comments like: # General setup
        if trimmed.starts_with('#') {
            if let Some(section) = trimmed.strip_prefix("# ") {
                if !section.contains('=') && !section.starts_with("CONFIG_") && section.len() < 60 {
                    current_section = section.to_string();
                }
            }
            // Also handle "# CONFIG_FOO is not set"
            if let Some(rest) = trimmed.strip_prefix("# CONFIG_") {
                if let Some(name) = rest.strip_suffix(" is not set") {
                    configs.push(KernelConfig {
                        option_name: format!("CONFIG_{name}"),
                        value: "n".to_string(),
                        section: current_section.clone(),
                    });
                }
            }
            continue;
        }
        // Regular config lines: CONFIG_FOO=y/m/"string"
        if let Some((key, value)) = trimmed.split_once('=') {
            if key.starts_with("CONFIG_") {
                configs.push(KernelConfig {
                    option_name: key.to_string(),
                    value: value.trim_matches('"').to_string(),
                    section: current_section.clone(),
                });
            }
        }
    }
    configs
}

/// Check whether a specific kernel config option is set.
pub async fn check_kernel_feature(
    host: &KernelHost,
    feature: &str,
) -> Result<Option<KernelConfig>, KernelError> {
    let config = get_kernel_config(host).await?;
    let normalized = if feature.starts_with("CONFIG_") {
        feature.to_string()
    } else {
        format!("CONFIG_{feature}")
    };
    Ok(config.into_iter().find(|c| c.option_name == normalized))
}

/// Detect cgroup version: returns 1 or 2.
pub async fn detect_cgroup_version(host: &KernelHost) -> Result<u8, KernelError> {
    let cmd = "stat -f -c '%T' /sys/fs/cgroup 2>/dev/null";
    let (out, _, _) = client::exec_shell_raw(host, cmd).await?;
    let fs_type = out.trim().to_lowercase();
    if fs_type.contains("cgroup2") || fs_type.contains("cgroupfs") {
        Ok(2)
    } else if fs_type.contains("tmpfs") {
        // cgroup v1 typically has /sys/fs/cgroup as tmpfs
        // Double-check by looking for cgroup2 mount
        let (mount_out, _, _) = client::exec_shell_raw(
            host,
            "mount | grep 'type cgroup2' | head -1",
        )
        .await?;
        if mount_out.trim().is_empty() {
            Ok(1)
        } else {
            // Hybrid setup, report v2
            Ok(2)
        }
    } else {
        Ok(1)
    }
}

/// Detect available Linux namespace types.
pub async fn detect_namespace_support(host: &KernelHost) -> Result<Vec<String>, KernelError> {
    let cmd = "ls -1 /proc/self/ns/ 2>/dev/null";
    let out = client::exec_shell(host, cmd).await?;
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Detect active LSMs (Linux Security Modules).
pub async fn detect_security_modules(host: &KernelHost) -> Result<Vec<String>, KernelError> {
    // Try /sys/kernel/security/lsm first, then /proc/sys/kernel/lsm
    let cmd = "cat /sys/kernel/security/lsm 2>/dev/null || \
               cat /proc/sys/kernel/lsm 2>/dev/null || echo ''";
    let out = client::exec_shell(host, cmd).await?;
    Ok(out
        .trim()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect())
}

/// Detect supported filesystem types.
pub async fn detect_filesystem_support(host: &KernelHost) -> Result<Vec<String>, KernelError> {
    let out = client::exec_shell(host, "cat /proc/filesystems 2>/dev/null").await?;
    Ok(out
        .lines()
        .map(|line| {
            // Format: "nodev\text4" or "\text4"
            let trimmed = line.trim();
            if let Some((_prefix, fs)) = trimmed.split_once('\t') {
                fs.trim().to_string()
            } else {
                trimmed.to_string()
            }
        })
        .filter(|s| !s.is_empty())
        .collect())
}

/// Detect available I/O schedulers per block device.
pub async fn detect_io_schedulers(
    host: &KernelHost,
) -> Result<HashMap<String, Vec<String>>, KernelError> {
    let cmd = "for dev in /sys/block/*/queue/scheduler; do \
               [ -f \"$dev\" ] && echo \"$(echo $dev | cut -d/ -f4):$(cat $dev)\"; \
               done";
    let out = client::exec_shell(host, cmd).await?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for line in out.lines() {
        if let Some((device, schedulers_str)) = line.split_once(':') {
            let schedulers: Vec<String> = schedulers_str
                .replace('[', "")
                .replace(']', "")
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            map.insert(device.trim().to_string(), schedulers);
        }
    }
    Ok(map)
}

/// Get the kernel command line from /proc/cmdline.
pub async fn get_kernel_command_line(host: &KernelHost) -> Result<String, KernelError> {
    let out = client::exec_shell(host, "cat /proc/cmdline 2>/dev/null").await?;
    Ok(out.trim().to_string())
}
