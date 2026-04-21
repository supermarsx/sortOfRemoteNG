//! Kernel information — uname, architecture, modules, sysctl, kernel features.

use crate::client;
use crate::error::OsDetectError;
use crate::hardware::parse_architecture;
use crate::types::*;

/// Detect kernel info via `uname -a`.
pub async fn detect_kernel(host: &OsDetectHost) -> Result<KernelInfo, OsDetectError> {
    let name = client::exec_soft(host, "uname", &["-s"]).await;
    let version = client::exec_soft(host, "uname", &["-v"]).await;
    let release = client::exec_soft(host, "uname", &["-r"]).await;
    let machine = client::exec_soft(host, "uname", &["-m"]).await;
    let os_type = client::exec_soft(host, "uname", &["-o"]).await;

    Ok(KernelInfo {
        name: name.trim().to_string(),
        version: version.trim().to_string(),
        release: release.trim().to_string(),
        machine: machine.trim().to_string(),
        os_type: os_type.trim().to_string(),
    })
}

/// Detect system architecture via `uname -m`.
pub async fn detect_architecture(host: &OsDetectHost) -> Result<Architecture, OsDetectError> {
    let machine = client::exec_soft(host, "uname", &["-m"]).await;
    let arch = machine.trim();
    if arch.is_empty() {
        // Windows fallback
        let win_arch = client::shell_exec(host, "echo %PROCESSOR_ARCHITECTURE%").await;
        return Ok(parse_architecture(win_arch.trim()));
    }
    Ok(parse_architecture(arch))
}

/// List loaded kernel modules via `lsmod`.
pub async fn list_loaded_modules(host: &OsDetectHost) -> Result<Vec<String>, OsDetectError> {
    let stdout = client::exec_soft(host, "lsmod", &[]).await;
    if stdout.is_empty() {
        // macOS: kextstat
        let kext = client::exec_soft(host, "kextstat", &[]).await;
        if !kext.is_empty() {
            return Ok(parse_kextstat(&kext));
        }
        return Ok(Vec::new());
    }

    Ok(stdout
        .lines()
        .skip(1) // skip header
        .filter_map(|line| line.split_whitespace().next().map(|s| s.to_string()))
        .collect())
}

/// Query specific sysctl keys.
pub async fn get_sysctl_values(
    host: &OsDetectHost,
    keys: &[&str],
) -> Result<std::collections::HashMap<String, String>, OsDetectError> {
    let mut result = std::collections::HashMap::new();

    for key in keys {
        let val = client::exec_soft(host, "sysctl", &["-n", key]).await;
        let trimmed = val.trim();
        if !trimmed.is_empty() {
            result.insert(key.to_string(), trimmed.to_string());
        }
    }

    Ok(result)
}

/// Detect kernel features: cgroups version, namespace support, capabilities.
pub async fn detect_kernel_features(host: &OsDetectHost) -> Result<KernelFeatures, OsDetectError> {
    // cgroups
    let cgroups_v2 =
        client::shell_exec(host, "test -f /sys/fs/cgroup/cgroup.controllers && echo v2").await;
    let cgroups_version = if cgroups_v2.trim() == "v2" {
        "v2".to_string()
    } else {
        let cgroups_v1 = client::shell_exec(host, "test -d /sys/fs/cgroup/cpu && echo v1").await;
        if cgroups_v1.trim() == "v1" {
            "v1".to_string()
        } else {
            "none".to_string()
        }
    };

    // Namespaces
    let ns_dir = client::shell_exec(host, "ls /proc/self/ns/ 2>/dev/null").await;
    let namespaces: Vec<String> = ns_dir.split_whitespace().map(|s| s.to_string()).collect();

    // Capabilities
    let cap_last = client::shell_exec(host, "cat /proc/sys/kernel/cap_last_cap 2>/dev/null").await;
    let max_capability: u32 = cap_last.trim().parse().unwrap_or(0);

    // Seccomp
    let seccomp = client::shell_exec(host, "grep -c Seccomp /proc/self/status 2>/dev/null").await;
    let has_seccomp = seccomp.trim().parse::<u32>().unwrap_or(0) > 0;

    // BPF
    let bpf = client::shell_exec(host, "test -d /sys/fs/bpf && echo yes").await;
    let has_bpf = bpf.trim() == "yes";

    Ok(KernelFeatures {
        cgroups_version,
        namespaces,
        max_capability,
        has_seccomp,
        has_bpf,
    })
}

/// Extra struct for kernel features (not in public types for simplicity, returned by detect_kernel_features).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KernelFeatures {
    pub cgroups_version: String,
    pub namespaces: Vec<String>,
    pub max_capability: u32,
    pub has_seccomp: bool,
    pub has_bpf: bool,
}

// ─── Parsers ────────────────────────────────────────────────────────

fn parse_kextstat(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .skip(1)
        .filter_map(|line| {
            // Format: Index Refs Address Size Wired Name (Version) UUID <Linked Against>
            let parts: Vec<&str> = line.split_whitespace().collect();
            parts.get(5).map(|s| s.to_string())
        })
        .collect()
}
