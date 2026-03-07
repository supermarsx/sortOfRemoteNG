//! Sysctl management — runtime and persistent kernel parameter configuration.

use crate::client;
use crate::error::KernelError;
use crate::types::{KernelHost, SysctlCategory, SysctlEntry, SysctlSource};

/// Get all sysctl values via `sysctl -a`.
pub async fn get_all_sysctl(host: &KernelHost) -> Result<Vec<SysctlEntry>, KernelError> {
    let out = client::exec_shell(host, "sysctl -a 2>/dev/null").await?;
    let persistent = load_persistent_keys(host).await.unwrap_or_default();
    Ok(parse_sysctl_output(&out, &persistent))
}

/// Get a single sysctl value.
pub async fn get_sysctl(host: &KernelHost, key: &str) -> Result<SysctlEntry, KernelError> {
    let out = client::exec_ok(host, "sysctl", &[key]).await.map_err(|_| {
        KernelError::SysctlError(format!("key not found: {key}"))
    })?;
    let persistent = load_persistent_keys(host).await.unwrap_or_default();
    let (k, v) = parse_sysctl_line(out.trim()).ok_or_else(|| {
        KernelError::ParseError(format!("cannot parse sysctl output: {out}"))
    })?;
    let source = if persistent.contains(&k) {
        SysctlSource::Both
    } else {
        SysctlSource::Runtime
    };
    Ok(SysctlEntry { key: k, value: v, source })
}

/// Set a sysctl value at runtime (non-persistent).
pub async fn set_sysctl(
    host: &KernelHost,
    key: &str,
    value: &str,
) -> Result<(), KernelError> {
    let arg = format!("{key}={value}");
    client::exec_ok(host, "sysctl", &["-w", &arg]).await.map_err(|e| {
        KernelError::SysctlError(format!("failed to set {key}: {e}"))
    })?;
    Ok(())
}

/// Set a sysctl value persistently in /etc/sysctl.d/99-sorng.conf and apply it.
pub async fn set_sysctl_persistent(
    host: &KernelHost,
    key: &str,
    value: &str,
) -> Result<(), KernelError> {
    // Remove existing entry if present, then append
    let escaped_key = key.replace('.', "\\.");
    let cmd = format!(
        "sed -i '/^{escaped_key}\\s*=/d' /etc/sysctl.d/99-sorng.conf 2>/dev/null; \
         echo '{key} = {value}' >> /etc/sysctl.d/99-sorng.conf && \
         sysctl -w '{key}={value}'"
    );
    client::exec_shell(host, &cmd).await.map_err(|e| {
        KernelError::SysctlError(format!("failed to persist {key}: {e}"))
    })?;
    Ok(())
}

/// Remove a persistent sysctl entry.
pub async fn remove_sysctl_persistent(
    host: &KernelHost,
    key: &str,
) -> Result<(), KernelError> {
    let escaped_key = key.replace('.', "\\.");
    let cmd = format!(
        "sed -i '/^{escaped_key}\\s*=/d' /etc/sysctl.d/99-sorng.conf 2>/dev/null; true"
    );
    client::exec_shell(host, &cmd).await?;
    Ok(())
}

/// Reload all sysctl configuration files.
pub async fn reload_sysctl(host: &KernelHost) -> Result<(), KernelError> {
    client::exec_ok(host, "sysctl", &["--system"]).await.map_err(|e| {
        KernelError::SysctlError(format!("sysctl reload failed: {e}"))
    })?;
    Ok(())
}

/// Get sysctl entries filtered by category.
pub async fn get_sysctl_by_category(
    host: &KernelHost,
    category: &SysctlCategory,
) -> Result<Vec<SysctlEntry>, KernelError> {
    let prefix = category.prefix();
    let cmd = format!("sysctl -a 2>/dev/null | grep '^{prefix}'");
    let out = client::exec_shell(host, &cmd).await?;
    let persistent = load_persistent_keys(host).await.unwrap_or_default();
    Ok(parse_sysctl_output(&out, &persistent))
}

/// List all sysctl.d configuration files.
pub async fn list_sysctl_files(host: &KernelHost) -> Result<Vec<String>, KernelError> {
    let cmd = "ls -1 /etc/sysctl.d/ /etc/sysctl.conf 2>/dev/null";
    let out = client::exec_shell(host, cmd).await?;
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Parse a specific sysctl config file.
pub async fn get_sysctl_file(
    host: &KernelHost,
    name: &str,
) -> Result<Vec<SysctlEntry>, KernelError> {
    let path = if name.starts_with('/') {
        name.to_string()
    } else {
        format!("/etc/sysctl.d/{name}")
    };
    let cmd = format!("cat '{}' 2>/dev/null", path.replace('\'', "'\\''"));
    let out = client::exec_shell(host, &cmd).await?;
    Ok(parse_sysctl_file_content(&out))
}

/// Write a complete sysctl config file.
pub async fn set_sysctl_file(
    host: &KernelHost,
    name: &str,
    entries: &[(&str, &str)],
) -> Result<(), KernelError> {
    let path = if name.starts_with('/') {
        name.to_string()
    } else {
        format!("/etc/sysctl.d/{name}")
    };
    let content: String = entries
        .iter()
        .map(|(k, v)| format!("{k} = {v}"))
        .collect::<Vec<_>>()
        .join("\n");
    let cmd = format!(
        "printf '%s\\n' '{}' > '{}'",
        content.replace('\'', "'\\''"),
        path.replace('\'', "'\\''")
    );
    client::exec_shell(host, &cmd).await?;
    Ok(())
}

/// Get network-related sysctl entries.
pub async fn get_network_sysctl(host: &KernelHost) -> Result<Vec<SysctlEntry>, KernelError> {
    let cmd = "sysctl -a 2>/dev/null | grep -E '^net\\.(ipv4|ipv6|core)\\.'";
    let out = client::exec_shell(host, cmd).await?;
    let persistent = load_persistent_keys(host).await.unwrap_or_default();
    Ok(parse_sysctl_output(&out, &persistent))
}

/// Get VM-related sysctl entries.
pub async fn get_vm_sysctl(host: &KernelHost) -> Result<Vec<SysctlEntry>, KernelError> {
    get_sysctl_by_category(host, &SysctlCategory::Vm).await
}

/// Get kernel sysctl entries.
pub async fn get_kernel_sysctl(host: &KernelHost) -> Result<Vec<SysctlEntry>, KernelError> {
    get_sysctl_by_category(host, &SysctlCategory::Kernel).await
}

/// Get filesystem sysctl entries.
pub async fn get_fs_sysctl(host: &KernelHost) -> Result<Vec<SysctlEntry>, KernelError> {
    get_sysctl_by_category(host, &SysctlCategory::Fs).await
}

// ─── Helpers ────────────────────────────────────────────────────────

fn parse_sysctl_output(text: &str, persistent_keys: &[String]) -> Vec<SysctlEntry> {
    text.lines()
        .filter_map(|line| {
            let (key, value) = parse_sysctl_line(line)?;
            let source = if persistent_keys.contains(&key) {
                SysctlSource::Both
            } else {
                SysctlSource::Runtime
            };
            Some(SysctlEntry { key, value, source })
        })
        .collect()
}

fn parse_sysctl_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    // Format: key = value  (sysctl -a uses " = ")
    // Or:     key=value     (some versions)
    let (key, value) = if let Some((k, v)) = trimmed.split_once('=') {
        (k.trim().to_string(), v.trim().to_string())
    } else {
        return None;
    };
    if key.is_empty() {
        return None;
    }
    Some((key, value))
}

fn parse_sysctl_file_content(text: &str) -> Vec<SysctlEntry> {
    text.lines()
        .filter_map(|line| {
            let (key, value) = parse_sysctl_line(line)?;
            Some(SysctlEntry { key, value, source: SysctlSource::Persistent })
        })
        .collect()
}

/// Load keys that appear in persistent sysctl configuration files.
async fn load_persistent_keys(host: &KernelHost) -> Result<Vec<String>, KernelError> {
    let cmd = "cat /etc/sysctl.d/*.conf /etc/sysctl.conf 2>/dev/null | \
               grep -v '^#' | grep '=' | awk -F= '{gsub(/^ +| +$/, \"\", $1); print $1}'";
    let out = client::exec_shell(host, cmd).await?;
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}
