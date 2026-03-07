//! Sysfs exploration — read/write /sys attributes, block device info.

use crate::client;
use crate::error::KernelError;
use crate::types::{KernelHost, SysfsAttribute};
use std::collections::HashMap;

/// Read a sysfs attribute value.
pub async fn read_sysfs(host: &KernelHost, path: &str) -> Result<String, KernelError> {
    let safe_path = validate_sysfs_path(path)?;
    let cmd = format!("cat '{}' 2>/dev/null", safe_path.replace('\'', "'\\''"));
    let out = client::exec_shell(host, &cmd).await?;
    Ok(out.trim().to_string())
}

/// Write a value to a sysfs attribute.
pub async fn write_sysfs(
    host: &KernelHost,
    path: &str,
    value: &str,
) -> Result<(), KernelError> {
    let safe_path = validate_sysfs_path(path)?;
    let cmd = format!(
        "echo '{}' > '{}'",
        value.replace('\'', "'\\''"),
        safe_path.replace('\'', "'\\''")
    );
    client::exec_shell(host, &cmd).await?;
    Ok(())
}

/// List entries under a sysfs directory.
pub async fn list_sysfs(host: &KernelHost, path: &str) -> Result<Vec<String>, KernelError> {
    let safe_path = validate_sysfs_path(path)?;
    let cmd = format!("ls -1 '{}' 2>/dev/null", safe_path.replace('\'', "'\\''"));
    let out = client::exec_shell(host, &cmd).await?;
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Get detailed sysfs attributes for a given directory, with writability check.
pub async fn get_sysfs_attributes(
    host: &KernelHost,
    dir: &str,
) -> Result<Vec<SysfsAttribute>, KernelError> {
    let safe_dir = validate_sysfs_path(dir)?;
    let cmd = format!(
        "for f in '{safe}'/*; do \
         [ -f \"$f\" ] || continue; \
         w=false; [ -w \"$f\" ] && w=true; \
         echo \"$f|$(cat $f 2>/dev/null | head -1)|$w\"; \
         done",
        safe = safe_dir.replace('\'', "'\\''")
    );
    let out = client::exec_shell(host, &cmd).await?;
    let mut attrs = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.splitn(3, '|').collect();
        if parts.len() < 3 {
            continue;
        }
        attrs.push(SysfsAttribute {
            path: parts[0].trim().to_string(),
            value: parts[1].trim().to_string(),
            writable: parts[2].trim() == "true",
        });
    }
    Ok(attrs)
}

/// Get block device information from /sys/block/.
pub async fn get_block_devices(
    host: &KernelHost,
) -> Result<Vec<HashMap<String, String>>, KernelError> {
    let cmd = "for dev in /sys/block/*; do \
               [ -d \"$dev\" ] || continue; \
               name=$(basename $dev); \
               size=$(cat $dev/size 2>/dev/null); \
               ro=$(cat $dev/ro 2>/dev/null); \
               removable=$(cat $dev/removable 2>/dev/null); \
               model=$(cat $dev/device/model 2>/dev/null); \
               vendor=$(cat $dev/device/vendor 2>/dev/null); \
               sched=$(cat $dev/queue/scheduler 2>/dev/null); \
               rotational=$(cat $dev/queue/rotational 2>/dev/null); \
               echo \"START $name\"; \
               echo \"size=$size\"; \
               echo \"ro=$ro\"; \
               echo \"removable=$removable\"; \
               echo \"model=$model\"; \
               echo \"vendor=$vendor\"; \
               echo \"scheduler=$sched\"; \
               echo \"rotational=$rotational\"; \
               done";
    let out = client::exec_shell(host, cmd).await?;
    let mut devices: Vec<HashMap<String, String>> = Vec::new();
    let mut current: Option<HashMap<String, String>> = None;
    for line in out.lines() {
        let trimmed = line.trim();
        if let Some(dev_name) = trimmed.strip_prefix("START ") {
            if let Some(map) = current.take() {
                devices.push(map);
            }
            let mut map = HashMap::new();
            map.insert("name".to_string(), dev_name.to_string());
            current = Some(map);
        } else if let Some((key, value)) = trimmed.split_once('=') {
            if let Some(ref mut map) = current {
                let v = value.trim().to_string();
                if !v.is_empty() {
                    map.insert(key.to_string(), v);
                }
            }
        }
    }
    if let Some(map) = current {
        devices.push(map);
    }
    Ok(devices)
}

/// Validate that a path is under /sys or /proc to prevent path traversal.
fn validate_sysfs_path(path: &str) -> Result<String, KernelError> {
    let normalized = path.trim();
    if normalized.starts_with("/sys/") || normalized.starts_with("/proc/") || normalized == "/sys" || normalized == "/proc" {
        if normalized.contains("..") {
            return Err(KernelError::PermissionDenied(
                "Path traversal not allowed".to_string(),
            ));
        }
        Ok(normalized.to_string())
    } else {
        Err(KernelError::PermissionDenied(format!(
            "Path must be under /sys/ or /proc/: {normalized}"
        )))
    }
}
