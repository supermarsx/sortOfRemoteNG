//! System-wide information — load average, uptime, meminfo, vmstat, cpu stats, mounts, sysctl.

use crate::client;
use crate::error::ProcError;
use crate::types::*;
use chrono::{TimeZone, Utc};
use std::collections::HashMap;

/// Read /proc/loadavg.
/// Format: "0.45 0.30 0.25 2/456 12345"
pub async fn get_load_average(host: &ProcHost) -> Result<SystemLoad, ProcError> {
    let stdout = client::exec_shell_ok(host, "cat /proc/loadavg").await?;
    parse_loadavg(&stdout)
}

/// Read /proc/uptime and supplement with boot time and user count.
pub async fn get_uptime(host: &ProcHost) -> Result<UptimeInfo, ProcError> {
    let uptime_out = client::exec_shell_ok(host, "cat /proc/uptime").await?;
    let (uptime_secs, idle_secs) = parse_proc_uptime(&uptime_out)?;

    // Boot time from uptime_secs.
    let now = Utc::now();
    let boot_time = now - chrono::Duration::seconds(uptime_secs as i64);

    // User count (best effort).
    let users_count = match client::exec_shell(host, "who | wc -l").await {
        Ok((out, _, 0)) => out.trim().parse().unwrap_or(0),
        _ => 0,
    };

    Ok(UptimeInfo {
        uptime_secs,
        idle_secs,
        boot_time,
        users_count,
    })
}

/// Read /proc/meminfo as key-value pairs.
/// Keys include: MemTotal, MemFree, MemAvailable, Buffers, Cached, SwapTotal, SwapFree, etc.
pub async fn get_meminfo(host: &ProcHost) -> Result<HashMap<String, String>, ProcError> {
    let stdout = client::exec_shell_ok(host, "cat /proc/meminfo").await?;
    Ok(parse_kv_colon(&stdout))
}

/// Read /proc/vmstat as key-value pairs.
pub async fn get_vmstat(host: &ProcHost) -> Result<HashMap<String, String>, ProcError> {
    let stdout = client::exec_shell_ok(host, "cat /proc/vmstat").await?;
    Ok(parse_kv_space(&stdout))
}

/// Read /proc/stat for CPU stats.
/// Returns keys like "cpu" (aggregate), "cpu0", "cpu1", etc. with their jiffie values.
pub async fn get_cpu_stats(host: &ProcHost) -> Result<HashMap<String, String>, ProcError> {
    let stdout = client::exec_shell_ok(host, "cat /proc/stat").await?;
    let mut map = HashMap::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((key, value)) = line.split_once(char::is_whitespace) {
            map.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    Ok(map)
}

/// Read /proc/mounts — returns (device, mountpoint, fstype, options) per line.
pub async fn get_mounted_filesystems(host: &ProcHost) -> Result<Vec<MountEntry>, ProcError> {
    let stdout = client::exec_shell_ok(host, "cat /proc/mounts").await?;
    Ok(parse_mounts(&stdout))
}

/// Retrieve common sysctl values (kernel.*, vm.*, net.core.*, fs.*).
pub async fn get_system_limits(host: &ProcHost) -> Result<HashMap<String, String>, ProcError> {
    let stdout = client::exec_ok(
        host,
        "sysctl",
        &[
            "-a",
            "--pattern",
            "^(kernel\\.(pid_max|threads-max|hostname|osrelease)|vm\\.(swappiness|overcommit_memory|dirty_ratio)|net\\.core\\.(somaxconn|rmem_max|wmem_max)|fs\\.(file-max|nr_open))",
        ],
    )
    .await?;
    Ok(parse_sysctl(&stdout))
}

// ─── Mount Entry ────────────────────────────────────────────────────

/// A single entry from /proc/mounts.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MountEntry {
    pub device: String,
    pub mountpoint: String,
    pub fstype: String,
    pub options: String,
}

// ─── Parsing ────────────────────────────────────────────────────────

/// Parse /proc/loadavg.
fn parse_loadavg(output: &str) -> Result<SystemLoad, ProcError> {
    let line = output.trim();
    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.len() < 5 {
        return Err(ProcError::ParseError(format!(
            "Invalid loadavg format: {line}"
        )));
    }
    let (running, total) = tokens[3]
        .split_once('/')
        .ok_or_else(|| ProcError::ParseError(format!("Invalid running/total: {}", tokens[3])))?;

    Ok(SystemLoad {
        load_1min: tokens[0].parse().unwrap_or(0.0),
        load_5min: tokens[1].parse().unwrap_or(0.0),
        load_15min: tokens[2].parse().unwrap_or(0.0),
        running_processes: running.parse().unwrap_or(0),
        total_processes: total.parse().unwrap_or(0),
        last_pid: tokens[4].parse().unwrap_or(0),
    })
}

/// Parse /proc/uptime: "12345.67 98765.43"
fn parse_proc_uptime(output: &str) -> Result<(f64, f64), ProcError> {
    let tokens: Vec<&str> = output.trim().split_whitespace().collect();
    if tokens.len() < 2 {
        return Err(ProcError::ParseError(format!(
            "Invalid uptime format: {}",
            output.trim()
        )));
    }
    let uptime = tokens[0].parse::<f64>().map_err(|_| {
        ProcError::ParseError(format!("Invalid uptime value: {}", tokens[0]))
    })?;
    let idle = tokens[1].parse::<f64>().map_err(|_| {
        ProcError::ParseError(format!("Invalid idle value: {}", tokens[1]))
    })?;
    Ok((uptime, idle))
}

/// Parse "Key: Value" lines (meminfo style).
fn parse_kv_colon(output: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in output.lines() {
        let line = line.trim();
        if let Some((key, value)) = line.split_once(':') {
            map.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    map
}

/// Parse "key value" lines (vmstat style).
fn parse_kv_space(output: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in output.lines() {
        let line = line.trim();
        if let Some((key, value)) = line.split_once(char::is_whitespace) {
            map.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    map
}

/// Parse /proc/mounts.
fn parse_mounts(output: &str) -> Vec<MountEntry> {
    let mut mounts = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 4 {
            continue;
        }
        mounts.push(MountEntry {
            device: tokens[0].to_string(),
            mountpoint: tokens[1].to_string(),
            fstype: tokens[2].to_string(),
            options: tokens[3].to_string(),
        });
    }
    mounts
}

/// Parse sysctl -a output: "key = value".
fn parse_sysctl(output: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in output.lines() {
        let line = line.trim();
        if let Some((key, value)) = line.split_once('=') {
            map.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_loadavg() {
        let output = "0.45 0.30 0.25 2/456 12345\n";
        let load = parse_loadavg(output).unwrap();
        assert!((load.load_1min - 0.45).abs() < 0.001);
        assert!((load.load_5min - 0.30).abs() < 0.001);
        assert!((load.load_15min - 0.25).abs() < 0.001);
        assert_eq!(load.running_processes, 2);
        assert_eq!(load.total_processes, 456);
        assert_eq!(load.last_pid, 12345);
    }

    #[test]
    fn test_parse_proc_uptime() {
        let output = "123456.78 987654.32\n";
        let (up, idle) = parse_proc_uptime(output).unwrap();
        assert!((up - 123456.78).abs() < 0.01);
        assert!((idle - 987654.32).abs() < 0.01);
    }

    #[test]
    fn test_parse_meminfo() {
        let output = "\
MemTotal:       16384000 kB
MemFree:         1234567 kB
MemAvailable:    8000000 kB
Buffers:          500000 kB
Cached:          4000000 kB
SwapTotal:       8192000 kB
SwapFree:        8192000 kB
";
        let map = parse_kv_colon(output);
        assert_eq!(map.get("MemTotal").unwrap(), "16384000 kB");
        assert_eq!(map.get("MemFree").unwrap(), "1234567 kB");
        assert_eq!(map.get("SwapFree").unwrap(), "8192000 kB");
        assert_eq!(map.len(), 7);
    }

    #[test]
    fn test_parse_vmstat() {
        let output = "\
nr_free_pages 308641
nr_zone_inactive_anon 12345
nr_zone_active_anon 67890
pgpgin 1234567
pgpgout 7654321
";
        let map = parse_kv_space(output);
        assert_eq!(map.get("nr_free_pages").unwrap(), "308641");
        assert_eq!(map.get("pgpgin").unwrap(), "1234567");
        assert_eq!(map.len(), 5);
    }

    #[test]
    fn test_parse_mounts() {
        let output = "\
sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0
proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0
/dev/sda1 / ext4 rw,relatime,errors=remount-ro 0 0
tmpfs /run tmpfs rw,nosuid,nodev,size=3276864k,mode=755 0 0
";
        let mounts = parse_mounts(output);
        assert_eq!(mounts.len(), 4);
        assert_eq!(mounts[2].device, "/dev/sda1");
        assert_eq!(mounts[2].mountpoint, "/");
        assert_eq!(mounts[2].fstype, "ext4");
    }

    #[test]
    fn test_parse_sysctl() {
        let output = "\
kernel.pid_max = 4194304
kernel.threads-max = 126408
vm.swappiness = 60
fs.file-max = 9223372036854775807
net.core.somaxconn = 4096
";
        let map = parse_sysctl(output);
        assert_eq!(map.get("kernel.pid_max").unwrap(), "4194304");
        assert_eq!(map.get("vm.swappiness").unwrap(), "60");
        assert_eq!(map.get("net.core.somaxconn").unwrap(), "4096");
        assert_eq!(map.len(), 5);
    }

    #[test]
    fn test_parse_cpu_stats() {
        let output = "\
cpu  12345 678 9012 345678 901 0 234 0 0 0
cpu0 3000 200 2000 86000 200 0 60 0 0 0
cpu1 3100 178 2200 87000 250 0 50 0 0 0
";
        let mut map = HashMap::new();
        for line in output.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Some((key, value)) = line.split_once(char::is_whitespace) {
                map.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
        assert!(map.contains_key("cpu"));
        assert!(map.contains_key("cpu0"));
        assert!(map.contains_key("cpu1"));
    }
}
