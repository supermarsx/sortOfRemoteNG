//! /proc filesystem browsing — status, cmdline, environ, limits, maps, io, namespaces, cgroups.

use crate::client;
use crate::error::ProcError;
use crate::types::*;
use std::collections::HashMap;

/// Read /proc/<pid>/status and return as key-value pairs.
pub async fn get_proc_status(host: &ProcHost, pid: u32) -> Result<HashMap<String, String>, ProcError> {
    let stdout = client::exec_shell_ok(
        host,
        &format!("cat /proc/{pid}/status"),
    )
    .await
    .map_err(|_| ProcError::ProcessNotFound(pid))?;
    Ok(parse_proc_status(&stdout))
}

/// Read /proc/<pid>/cmdline (null-delimited).
pub async fn get_proc_cmdline(host: &ProcHost, pid: u32) -> Result<String, ProcError> {
    let stdout = client::exec_shell_ok(
        host,
        &format!("tr '\\0' ' ' < /proc/{pid}/cmdline"),
    )
    .await
    .map_err(|_| ProcError::ProcessNotFound(pid))?;
    Ok(stdout.trim().to_string())
}

/// Read /proc/<pid>/environ and parse into key=value pairs.
pub async fn get_proc_environ(host: &ProcHost, pid: u32) -> Result<ProcessEnvironment, ProcError> {
    let stdout = client::exec_shell_ok(
        host,
        &format!("tr '\\0' '\\n' < /proc/{pid}/environ"),
    )
    .await
    .map_err(|_| ProcError::ProcessNotFound(pid))?;
    Ok(ProcessEnvironment {
        pid,
        variables: parse_environ(&stdout),
    })
}

/// Read /proc/<pid>/limits.
pub async fn get_proc_limits(host: &ProcHost, pid: u32) -> Result<ProcessLimits, ProcError> {
    let stdout = client::exec_shell_ok(
        host,
        &format!("cat /proc/{pid}/limits"),
    )
    .await
    .map_err(|_| ProcError::ProcessNotFound(pid))?;
    parse_proc_limits(pid, &stdout)
}

/// Read /proc/<pid>/maps.
pub async fn get_proc_maps(host: &ProcHost, pid: u32) -> Result<Vec<MemoryMap>, ProcError> {
    let stdout = client::exec_shell_ok(
        host,
        &format!("cat /proc/{pid}/maps"),
    )
    .await
    .map_err(|_| ProcError::ProcessNotFound(pid))?;
    Ok(parse_proc_maps(&stdout))
}

/// Read /proc/<pid>/io.
pub async fn get_proc_io(host: &ProcHost, pid: u32) -> Result<ProcessIo, ProcError> {
    let stdout = client::exec_shell_ok(
        host,
        &format!("cat /proc/{pid}/io"),
    )
    .await
    .map_err(|_| ProcError::ProcessNotFound(pid))?;
    parse_proc_io(pid, &stdout)
}

/// Read /proc/<pid>/ns/ symlinks for namespace IDs.
pub async fn get_proc_namespaces(host: &ProcHost, pid: u32) -> Result<ProcessNamespace, ProcError> {
    let stdout = client::exec_shell_ok(
        host,
        &format!("ls -la /proc/{pid}/ns/ 2>/dev/null | tail -n +2"),
    )
    .await
    .map_err(|_| ProcError::ProcessNotFound(pid))?;
    Ok(parse_proc_namespaces(pid, &stdout))
}

/// Read /proc/<pid>/cgroup.
pub async fn get_proc_cgroup(host: &ProcHost, pid: u32) -> Result<CgroupInfo, ProcError> {
    let stdout = client::exec_shell_ok(
        host,
        &format!("cat /proc/{pid}/cgroup"),
    )
    .await
    .map_err(|_| ProcError::ProcessNotFound(pid))?;
    Ok(parse_proc_cgroup(&stdout))
}

// ─── Parsing ────────────────────────────────────────────────────────

/// Parse /proc/pid/status key:\tvalue format.
fn parse_proc_status(output: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in output.lines() {
        let line = line.trim();
        if let Some((key, value)) = line.split_once(':') {
            map.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    map
}

/// Parse environment variables from null-delimited (converted to newline) output.
fn parse_environ(output: &str) -> HashMap<String, String> {
    let mut vars = HashMap::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            vars.insert(key.to_string(), value.to_string());
        }
    }
    vars
}

/// Parse /proc/pid/limits.
/// Format:
/// Limit                     Soft Limit           Hard Limit           Units
/// Max open files            1024                 1048576              files
fn parse_proc_limits(pid: u32, output: &str) -> Result<ProcessLimits, ProcError> {
    let mut limits_map: HashMap<String, (String, String)> = HashMap::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Limit") {
            continue;
        }
        // The limit name can contain spaces, so we parse from the right.
        // Each numeric/unlimited field is right-aligned in fixed columns.
        // Strategy: split by two-or-more spaces to get tokens.
        let parts: Vec<&str> = line.splitn(4, "  ").filter(|s| !s.is_empty()).collect();
        if parts.len() < 3 {
            continue;
        }
        let name = parts[0].trim().to_string();
        let soft = parts[1].trim().to_string();
        let hard = parts[2].trim().to_string();
        limits_map.insert(name, (soft, hard));
    }

    let get_limit = |name: &str| -> LimitValue {
        limits_map
            .get(name)
            .map(|(s, h)| LimitValue { soft: s.clone(), hard: h.clone() })
            .unwrap_or_else(|| LimitValue { soft: "unlimited".into(), hard: "unlimited".into() })
    };

    Ok(ProcessLimits {
        pid,
        max_open_files: get_limit("Max open files"),
        max_processes: get_limit("Max processes"),
        max_stack_size: get_limit("Max stack size"),
        max_memory: get_limit("Max resident set"),
        max_file_size: get_limit("Max file size"),
        max_locked_memory: get_limit("Max locked memory"),
        max_address_space: get_limit("Max address space"),
        max_cpu_time: get_limit("Max cpu time"),
        max_core_file: get_limit("Max core file size"),
        max_nice: get_limit("Max nice priority"),
        max_realtime_priority: get_limit("Max realtime priority"),
    })
}

/// Parse /proc/pid/maps.
/// Format: address perms offset dev inode pathname
fn parse_proc_maps(output: &str) -> Vec<MemoryMap> {
    let mut maps = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let tokens: Vec<&str> = line.splitn(6, char::is_whitespace).collect();
        if tokens.len() < 5 {
            continue;
        }
        maps.push(MemoryMap {
            address_range: tokens[0].to_string(),
            permissions: tokens[1].to_string(),
            offset: tokens[2].to_string(),
            device: tokens[3].to_string(),
            inode: tokens[4].parse().unwrap_or(0),
            pathname: if tokens.len() > 5 { tokens[5].trim().to_string() } else { String::new() },
        });
    }
    maps
}

/// Parse /proc/pid/io.
/// Format: key: value (bytes)
fn parse_proc_io(pid: u32, output: &str) -> Result<ProcessIo, ProcError> {
    let mut map: HashMap<String, u64> = HashMap::new();
    for line in output.lines() {
        let line = line.trim();
        if let Some((key, value)) = line.split_once(':') {
            if let Ok(v) = value.trim().parse::<u64>() {
                map.insert(key.trim().to_string(), v);
            }
        }
    }
    Ok(ProcessIo {
        pid,
        read_bytes: map.get("read_bytes").copied().unwrap_or(0),
        write_bytes: map.get("write_bytes").copied().unwrap_or(0),
        read_syscalls: map.get("syscr").copied().unwrap_or(0),
        write_syscalls: map.get("syscw").copied().unwrap_or(0),
        cancelled_write_bytes: map.get("cancelled_write_bytes").copied().unwrap_or(0),
    })
}

/// Parse `ls -la /proc/<pid>/ns/` symlinks.
/// Lines: lrwxrwxrwx 1 root root 0 Jan 2 08:00 pid -> 'pid:[4026531836]'
fn parse_proc_namespaces(pid: u32, output: &str) -> ProcessNamespace {
    let mut ns_map: HashMap<String, String> = HashMap::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((_, target)) = line.split_once(" -> ") {
            let target = target.trim().trim_matches('\'');
            // target is like "pid:[4026531836]"
            if let Some((ns_name, ns_id)) = target.split_once(':') {
                ns_map.insert(ns_name.to_string(), ns_id.trim_matches(|c| c == '[' || c == ']').to_string());
            }
        }
    }

    let get_ns = |name: &str| -> String {
        ns_map.get(name).cloned().unwrap_or_default()
    };

    ProcessNamespace {
        pid,
        pid_ns: get_ns("pid"),
        mnt_ns: get_ns("mnt"),
        net_ns: get_ns("net"),
        uts_ns: get_ns("uts"),
        ipc_ns: get_ns("ipc"),
        user_ns: get_ns("user"),
        cgroup_ns: get_ns("cgroup"),
    }
}

/// Parse /proc/pid/cgroup.
/// V2: "0::/system.slice/sshd.service"
/// V1: "12:cpu,cpuacct:/system.slice" lines
fn parse_proc_cgroup(output: &str) -> CgroupInfo {
    let mut controllers = Vec::new();
    let mut path = String::new();
    let mut version = CgroupVersion::V2;

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(3, ':').collect();
        if parts.len() < 3 {
            continue;
        }
        let hierarchy = parts[0];
        let ctrl = parts[1];
        let cg_path = parts[2];

        if hierarchy == "0" && ctrl.is_empty() {
            // cgroup v2 unified hierarchy.
            version = CgroupVersion::V2;
            path = cg_path.to_string();
        } else {
            // cgroup v1 controller.
            version = CgroupVersion::V1;
            if path.is_empty() {
                path = cg_path.to_string();
            }
            for c in ctrl.split(',') {
                let c = c.trim();
                if !c.is_empty() && !controllers.contains(&c.to_string()) {
                    controllers.push(c.to_string());
                }
            }
        }
    }

    CgroupInfo {
        version,
        controllers,
        path,
        cpu_shares: None,
        memory_limit: None,
        io_weight: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_proc_status() {
        let output = "\
Name:\tsshd
Umask:\t0022
State:\tS (sleeping)
Tgid:\t1234
Pid:\t1234
PPid:\t1
Threads:\t1
VmPeak:\t   106256 kB
VmSize:\t   106256 kB
VmRSS:\t     5432 kB
";
        let map = parse_proc_status(output);
        assert_eq!(map.get("Name").unwrap(), "sshd");
        assert_eq!(map.get("State").unwrap(), "S (sleeping)");
        assert_eq!(map.get("Pid").unwrap(), "1234");
        assert_eq!(map.get("PPid").unwrap(), "1");
        assert_eq!(map.get("Threads").unwrap(), "1");
    }

    #[test]
    fn test_parse_environ() {
        let output = "\
HOME=/root
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
LANG=en_US.UTF-8
TERM=xterm
";
        let vars = parse_environ(output);
        assert_eq!(vars.get("HOME").unwrap(), "/root");
        assert_eq!(vars.get("LANG").unwrap(), "en_US.UTF-8");
        assert_eq!(vars.len(), 4);
    }

    #[test]
    fn test_parse_proc_maps() {
        let output = "\
55a1b2c3d000-55a1b2c40000 r--p 00000000 08:01 1234567 /usr/sbin/sshd
55a1b2c40000-55a1b2d10000 r-xp 00003000 08:01 1234567 /usr/sbin/sshd
7fff12345000-7fff12346000 rw-p 00000000 00:00 0       [stack]
7fff12400000-7fff12401000 r--p 00000000 00:00 0       [vvar]
";
        let maps = parse_proc_maps(output);
        assert_eq!(maps.len(), 4);
        assert_eq!(maps[0].address_range, "55a1b2c3d000-55a1b2c40000");
        assert_eq!(maps[0].permissions, "r--p");
        assert_eq!(maps[0].inode, 1234567);
        assert_eq!(maps[0].pathname, "/usr/sbin/sshd");
        assert_eq!(maps[2].pathname, "[stack]");
    }

    #[test]
    fn test_parse_proc_io() {
        let output = "\
rchar: 123456789
wchar: 987654321
syscr: 5000
syscw: 3000
read_bytes: 40960000
write_bytes: 20480000
cancelled_write_bytes: 4096
";
        let io = parse_proc_io(42, output).unwrap();
        assert_eq!(io.pid, 42);
        assert_eq!(io.read_bytes, 40960000);
        assert_eq!(io.write_bytes, 20480000);
        assert_eq!(io.read_syscalls, 5000);
        assert_eq!(io.write_syscalls, 3000);
        assert_eq!(io.cancelled_write_bytes, 4096);
    }

    #[test]
    fn test_parse_proc_namespaces() {
        let output = "\
lrwxrwxrwx 1 root root 0 Jan  2 08:00 cgroup -> 'cgroup:[4026531835]'
lrwxrwxrwx 1 root root 0 Jan  2 08:00 ipc -> 'ipc:[4026531839]'
lrwxrwxrwx 1 root root 0 Jan  2 08:00 mnt -> 'mnt:[4026531840]'
lrwxrwxrwx 1 root root 0 Jan  2 08:00 net -> 'net:[4026531992]'
lrwxrwxrwx 1 root root 0 Jan  2 08:00 pid -> 'pid:[4026531836]'
lrwxrwxrwx 1 root root 0 Jan  2 08:00 user -> 'user:[4026531837]'
lrwxrwxrwx 1 root root 0 Jan  2 08:00 uts -> 'uts:[4026531838]'
";
        let ns = parse_proc_namespaces(1234, output);
        assert_eq!(ns.pid, 1234);
        assert_eq!(ns.pid_ns, "4026531836");
        assert_eq!(ns.mnt_ns, "4026531840");
        assert_eq!(ns.net_ns, "4026531992");
        assert_eq!(ns.uts_ns, "4026531838");
        assert_eq!(ns.ipc_ns, "4026531839");
        assert_eq!(ns.user_ns, "4026531837");
        assert_eq!(ns.cgroup_ns, "4026531835");
    }

    #[test]
    fn test_parse_proc_cgroup_v2() {
        let output = "0::/system.slice/sshd.service\n";
        let cg = parse_proc_cgroup(output);
        assert_eq!(cg.version, CgroupVersion::V2);
        assert_eq!(cg.path, "/system.slice/sshd.service");
        assert!(cg.controllers.is_empty());
    }

    #[test]
    fn test_parse_proc_cgroup_v1() {
        let output = "\
12:cpu,cpuacct:/system.slice
11:memory:/system.slice
10:blkio:/system.slice
";
        let cg = parse_proc_cgroup(output);
        assert_eq!(cg.version, CgroupVersion::V1);
        assert!(cg.controllers.contains(&"cpu".to_string()));
        assert!(cg.controllers.contains(&"cpuacct".to_string()));
        assert!(cg.controllers.contains(&"memory".to_string()));
        assert!(cg.controllers.contains(&"blkio".to_string()));
    }

    #[test]
    fn test_parse_proc_limits() {
        let output = "\
Limit                     Soft Limit           Hard Limit           Units
Max cpu time              unlimited            unlimited            seconds
Max file size             unlimited            unlimited            bytes
Max open files            1024                 1048576              files
Max processes             63204                63204                processes
Max stack size            8388608              unlimited            bytes
Max resident set          unlimited            unlimited            bytes
Max locked memory         67108864             67108864             bytes
Max address space         unlimited            unlimited            bytes
Max core file size        0                    unlimited            bytes
Max nice priority         0                    0
Max realtime priority     0                    0
";
        let limits = parse_proc_limits(42, output).unwrap();
        assert_eq!(limits.pid, 42);
        assert_eq!(limits.max_open_files.soft, "1024");
        assert_eq!(limits.max_open_files.hard, "1048576");
        assert_eq!(limits.max_processes.soft, "63204");
        assert_eq!(limits.max_stack_size.hard, "unlimited");
    }
}
